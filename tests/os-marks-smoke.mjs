/**
 * The per-OS workspace marks: alias→OS wiring and glyph selection.
 *
 * DSH draws every workspace with its own folder glyph; this plugin swaps it
 * for the remote mark after the fact. With the host `os` field the swap
 * became per-OS: `win` draws the window grid, `mac` the command key, `linux`
 * a shell prompt, and everything without a pin keeps the generic chevrons.
 * The contracts pinned here:
 *
 *   1. the alias is parsed from the `ssh://alias/…` path, and the alias→OS
 *      map only ever carries PINNED values — an unset `os` (auto) must not
 *      masquerade as a glyph;
 *   2. the os maps ride every identity spelling (id, title, path basename),
 *      because which spelling a surface can see differs per surface;
 *   3. the DOM builder emits the per-OS geometry from the same shape table
 *      the React icon uses, and stamps `data-sshwsp-os` so a later pass can
 *      REPLACE the node when the pin changes instead of leaving the previous
 *      glyph behind.
 *
 * The marks block (MARK_ATTR … scheduleRemoteMarks) is extracted from the
 * client source and run against stub `document` / `window` / `fetchJson` —
 * no browser, no React, no bundler; the rest of the wiring is pinned by
 * source markers the same way client-shape-smoke pins discovery.
 *
 * Run: node tests/os-marks-smoke.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)))

let passed = 0
let failures = 0
function check (label, ok, detail) {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`) } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

console.log('\n=== os marks smoke ===\n')

const source = readFileSync(`${pluginRoot}/lib/client.js`, 'utf8')

/** Slice from an anchor to the end of a named function (brace-matched). */
function sliceUntilFunctionEnd (startMarker, functionMarker) {
  const start = source.indexOf(startMarker)
  if (start < 0) throw new Error(`client.js lost the anchor ${JSON.stringify(startMarker)}`)
  const fnStart = source.indexOf(functionMarker, start)
  if (fnStart < 0) throw new Error(`client.js lost ${JSON.stringify(functionMarker)}`)
  let depth = 0
  for (let i = source.indexOf('{', fnStart); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error('unbalanced braces after the anchor')
}

const marksSource = sliceUntilFunctionEnd("const MARK_ATTR = 'data-sshwsp-mark'", 'function scheduleRemoteMarks () {')

/** The shape tables: from the viewbox constant through GENERIC_MARK_SHAPES. */
const shapesStart = source.indexOf('const REMOTE_MARK_VIEWBOX')
if (shapesStart < 0) throw new Error('client.js lost const REMOTE_MARK_VIEWBOX')
const shapesFnStart = source.indexOf('const GENERIC_MARK_SHAPES = {', shapesStart)
if (shapesFnStart < 0) throw new Error('client.js lost the shape tables')
let shapesDepth = 0
let shapesEnd = -1
for (let i = source.indexOf('{', shapesFnStart); i < source.length; i += 1) {
  if (source[i] === '{') shapesDepth += 1
  else if (source[i] === '}') {
    shapesDepth -= 1
    if (shapesDepth === 0) { shapesEnd = i + 1; break }
  }
}
if (shapesEnd < 0) throw new Error('unbalanced braces in the shape tables')
const shapesSource = source.slice(shapesStart, shapesEnd)

/** A minimal svg DOM: enough for createElementNS/setAttribute/appendChild. */
function makeNode (tag) {
  const node = {
    tag,
    attrs: {},
    children: [],
    style: {},
    setAttribute (name, value) { node.attrs[name] = String(value) },
    getAttribute (name) { return node.attrs[name] ?? null },
    appendChild (child) { node.children.push(child) },
    remove () { node.removed = true },
    querySelector () { return null },
  }
  return node
}

const documentStub = {
  createElementNS (_ns, tag) { return makeNode(tag) },
  querySelectorAll () { return [] },
}

let repaints = 0
const windowStub = { requestAnimationFrame: (fn) => { repaints += 1; fn() } }
const API_STUB = { status: '/status', hosts: '/hosts' }

/** Load the marks block with the stubs in scope, expose the seams. */
function loadMarks () {
  const factory = new Function('document', 'window', 'fetchJson', 'API', `
    ${shapesSource}
    ${marksSource}
    return { remoteMarks, hostOsByAlias, knownDisabledPaths, marksCtx,
      collectRemoteWorkspaces, aliasOfWorkspacePath, syncHostOsMarks,
      refreshHostOsMarks, syncRemoteWorkspaceMarks, createRemoteMarkNode,
      applyRemoteMark, clearRemoteMark, markHost }
  `)
  return factory(documentStub, windowStub, async () => ({ hosts: [] }), API_STUB)
}

// ---------------------------------------------------------------------------
console.log('[aliasOfWorkspacePath]')

{
  const marks = loadMarks()
  check('a workspace path parses to its alias', marks.aliasOfWorkspacePath('ssh://win/D:/code/www') === 'win')
  check('an alias may not contain slashes', marks.aliasOfWorkspacePath('ssh://a/b/c') === 'a')
  check('a bare ssh://host with no trailing slash still parses', marks.aliasOfWorkspacePath('ssh://host') === 'host')
  check('a local path has no alias', marks.aliasOfWorkspacePath('/home/user/project') === undefined)
  check('an empty scheme has no alias', marks.aliasOfWorkspacePath('ssh:///x') === undefined)
  check('a missing path is tolerated', marks.aliasOfWorkspacePath(undefined) === undefined)
}

// ---------------------------------------------------------------------------
console.log('\n[syncHostOsMarks: only pinned values reach the map]')

{
  const marks = loadMarks()
  repaints = 0
  marks.syncHostOsMarks([
    { alias: 'win', os: 'win' },
    { alias: 'mac-dind', os: 'mac' },
    { alias: 'auto-host' },
    { alias: 'cfg-host', os: undefined },
    { alias: '', os: 'linux' },
    { alias: 'bad', os: 'not-an-os' },
  ])
  check('a pinned alias lands in the map', marks.hostOsByAlias.get('win') === 'win' && marks.hostOsByAlias.get('mac-dind') === 'mac')
  check('an unset os stays out (the generic mark keeps serving it)',
    !marks.hostOsByAlias.has('auto-host') && !marks.hostOsByAlias.has('cfg-host'))
  check('a bogus alias or value never enters the map',
    !marks.hostOsByAlias.has('') && marks.hostOsByAlias.get('bad') !== 'not-an-os')
  check('absorbing a reply schedules a repaint', repaints === 1, String(repaints))
}

// ---------------------------------------------------------------------------
console.log('\n[collectRemoteWorkspaces: the OS rides every identity spelling]')

{
  const marks = loadMarks()
  marks.syncHostOsMarks([{ alias: 'win', os: 'win' }, { alias: 'mac-dind', os: 'mac' }])
  repaints = 0
  marks.collectRemoteWorkspaces([
    { workspaceId: 'w1', path: 'ssh://win/D:/code/www', title: 'www', sessionIds: ['s1'] },
    { id: 'w2', path: 'ssh://unknown-host/code', title: 'code' },
    { id: 'w3', path: 'ssh://mac-dind//Users/ao/proj', title: 'proj' },
    { id: 'w4', path: '/local/not-remote', title: 'local' },
  ], ['ssh://mac-dind//Users/ao/proj'])
  check('ids still collect for every remote row', marks.remoteMarks.ids.has('w1') && marks.remoteMarks.ids.has('w2') && marks.remoteMarks.ids.has('w3'))
  check('the os map answers by id', marks.remoteMarks.osIds.get('w1') === 'win' && marks.remoteMarks.osIds.get('w3') === 'mac')
  check('an unpinned alias leaves the id out of the os map', !marks.remoteMarks.osIds.has('w2'))
  check('the os map answers by title', marks.remoteMarks.osTitles.get('www') === 'win')
  check('the os map answers by path basename too (the hero chip fallback)',
    marks.remoteMarks.osTitles.get('www') === 'win' && marks.remoteMarks.osTitles.get('proj') === 'mac')
  check('a detached workspace keeps its os mapping (grey, but still shaped)',
    marks.remoteMarks.disabledIds.has('w3') && marks.remoteMarks.osIds.get('w3') === 'mac')
  check('a non-remote row collects nothing at all',
    !marks.remoteMarks.ids.has('w4') && !marks.remoteMarks.osIds.has('w4'))
}

// ---------------------------------------------------------------------------
console.log('\n[createRemoteMarkNode: the shape table drives the geometry]')

{
  const marks = loadMarks()
  const glyph = { getAttribute: (name) => (name === 'class' ? 'glyph-class' : name === 'width' || name === 'height' ? '16' : null) }

  const generic = marks.createRemoteMarkNode(glyph)
  check('the generic mark keeps the cropped chevron viewBox',
    generic.attrs.viewBox === '10.5 6.25 11.5 15', generic.attrs.viewBox)
  check('the generic mark stamps an empty os', generic.attrs['data-sshwsp-os'] === '')
  check('the generic mark is two stroked chevrons and copies the glyph class',
    generic.children.length === 2 && generic.children.every(child => child.tag === 'path') && generic.attrs.class === 'glyph-class')

  const win = marks.createRemoteMarkNode(glyph, 'win')
  check('win draws four rounded panes', win.children.length === 4 && win.children.every(child => child.tag === 'rect' && child.attrs.width === '5.2'))
  check('win stamps its os and the lighter stroke', win.attrs['data-sshwsp-os'] === 'win' && win.attrs['stroke-width'] === '1.5')

  const mac = marks.createRemoteMarkNode(glyph, 'mac')
  check('mac draws the command key as one closed loop',
    mac.children.length === 1 && mac.children[0].attrs.d.startsWith('M10 4v8') && mac.attrs['data-sshwsp-os'] === 'mac')

  const linux = marks.createRemoteMarkNode(glyph, 'linux')
  check('linux draws the two-stroke shell prompt',
    linux.children.length === 2 && linux.children.every(child => child.tag === 'path') && linux.attrs['data-sshwsp-os'] === 'linux')

  const unknown = marks.createRemoteMarkNode(glyph, 'not-an-os')
  check('an unknown os degrades to the generic shapes (but keeps its stamp)',
    unknown.children.length === 2 && unknown.attrs.viewBox === '10.5 6.25 11.5 15' && unknown.attrs['data-sshwsp-os'] === 'not-an-os')
}

// ---------------------------------------------------------------------------
console.log('\n[applyRemoteMark: a changed pin replaces the node in place]')

{
  const marks = loadMarks()
  const glyph = { getAttribute: () => null, style: {}, after: () => {} }
  glyph.after = (node) => { glyph.inserted = node }

  // First application: no mark exists yet → insert beside the hidden glyph.
  const host = { querySelector: () => null }
  marks.applyRemoteMark(host, glyph, 'win')
  check('a first application inserts the os glyph and hides the folder', glyph.style.display === 'none' && glyph.inserted.attrs['data-sshwsp-os'] === 'win')

  // Same os again: the existing mark must be kept, not rebuilt.
  const kept = glyph.inserted
  let removed = false
  kept.remove = () => { removed = true }
  kept.previousElementSibling = glyph
  const sameHost = { querySelector: () => kept }
  marks.applyRemoteMark(sameHost, glyph, 'win')
  check('the same pin keeps the existing node', removed === false && glyph.inserted === kept)

  // Pin changed win → mac: the old node goes, a mac node takes its place.
  marks.applyRemoteMark(sameHost, glyph, 'mac')
  check('a changed pin removes the old node and inserts the new glyph',
    removed === true && glyph.inserted !== kept && glyph.inserted.attrs['data-sshwsp-os'] === 'mac')
}

// ---------------------------------------------------------------------------
console.log('\n[wiring: the surfaces feed the os through]')

{
  check('the panel refresh feeds /hosts into the os map',
    source.includes('syncHostOsMarks(hostsData.hosts ?? [])'))
  check('plugin boot fetches the os map for non-panel surfaces',
    source.includes('refreshHostOsMarks()') && source.includes('refreshRemoteWorkspaceMarks()'))
  check('the mounted list picks the glyph from the row path',
    source.includes('hostOsByAlias.get(aliasOfWorkspacePath(wsPath))'))
  check('the flow menu keeps the generic remote icon (a concept, not a host)',
    source.includes("icon: RemoteMarkIcon"))
  for (const [label, marker] of [
    ['sidebar rows resolve id → title', 'remoteMarks.osIds.get(id)'],
    ['picker rows resolve by label', 'remoteMarks.osTitles.get(label)'],
    ['hero chip resolves by text', 'remoteMarks.osTitles.get(text)'],
  ]) {
    check(label, source.includes(marker), marker)
  }
  check('the React icon and the DOM builder share one shape table',
    source.includes('const OS_MARK_SHAPES') && (source.match(/OS_MARK_SHAPES/g) ?? []).length >= 3)
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
