/**
 * The "new local workspace" flow must survive a host whose composed
 * directory-picker serves only the browse capability.
 *
 * The reported failure: on such a deployment the flow called
 * `uiWorkspace.pickDirectory()` → `directoryPicker.pick()`, a verb the browse
 * backend cannot serve, and every press of "new local workspace" answered
 * with the raw refusal
 * (`directory picker failed: directoryPicker.pick needs the native capability; the
 * composed picker serves "browse"`).
 *
 * The fix, in three parts, each asserted here:
 *   1. the pick attempt goes through the Remote namespace, whose RemoteResult
 *      keeps the structured error the uiWorkspace wrapper flattens — so
 *      `directory-picker/unavailable` can be recognized and classified
 *      (`localPickVerdict`, driven below over the whole branch table);
 *   2. a browse verdict switches the flow into the in-app browser dialog and
 *      REMEMBERS the capability, so later opens skip the doomed verb
 *      (makeLocalPicker, rebuilt in a sandbox and driven twice);
 *   3. the dialog drives `list` / `createDirectory` through one browse face
 *      that prefers the Remote namespace and normalizes the uiWorkspace
 *      fallback into the same `{ ok, error }` shape (`browseFaceOf`).
 *
 * The desktop preload bridge stays the first choice, unchanged.
 *
 * Run: node tests/browse-fallback-smoke.mjs
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(here, '..')

const passes = []
const failures = []
function check (name, condition, detail) {
  if (condition) {
    passes.push(name)
    console.log(`  PASS  ${name}`)
  } else {
    failures.push(`${name}${detail === undefined ? '' : ` — ${detail}`}`)
    console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

console.log('\n=== browse fallback smoke ===\n')

const source = readFileSync(path.join(pluginRoot, 'lib/client.js'), 'utf8')

/** Pull one factory-scope function out of the client source by brace matching. */
function extractFunction (name) {
  const start = source.indexOf(`function ${name} (`)
  if (start < 0) throw new Error(`client.js does not define ${name}()`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`unbalanced braces in ${name}()`)
}

/** Slice a dictionary literal by brace matching (same trick as locale-register). */
function dictionaryLiteral (name) {
  const start = source.indexOf(`const ${name} = {`)
  if (start < 0) throw new Error(`client.js does not define ${name}`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  throw new Error(`unbalanced braces in ${name}`)
}

const BROWSE = Symbol('sshwsp:pick-via-browse')

/**
 * Rebuild the picker closure the bundle builds, against explicit stand-ins for
 * the factory-scope pieces it closes over.
 */
function buildPicker (capability) {
  const build = new Function('localPickCapability', 'LOCAL_PICK_BROWSE', `
    ${extractFunction('localPickVerdict')}
    ${extractFunction('makeLocalPicker')}
    return { makeLocalPicker, localPickVerdict, localPickCapability }
  `)
  return build(capability, BROWSE)
}

// ---------------------------------------------------------------------------
console.log('[localPickVerdict: the branch table]')

{
  const { localPickVerdict } = buildPicker({ kind: 'unknown' })
  const picked = localPickVerdict({ ok: true, value: '/home/user/project' })
  check('a real path classifies as picked', picked.action === 'picked' && picked.path === '/home/user/project', JSON.stringify(picked))
  const cancelled = localPickVerdict({ ok: true, value: null })
  check('a null value classifies as the operator cancelling', cancelled.action === 'cancel', JSON.stringify(cancelled))
  const empty = localPickVerdict({ ok: true, value: '' })
  check('an empty string is not a path (also a cancellation)', empty.action === 'cancel', JSON.stringify(empty))
  const unavailable = localPickVerdict({ ok: false, error: { code: 'directory-picker/unavailable', message: 'needs the native capability', details: { capability: 'browse' } } })
  check('the capability refusal classifies as the browse fallback', unavailable.action === 'browse', JSON.stringify(unavailable))
  const other = localPickVerdict({ ok: false, error: { code: 'gateway/internal', message: 'boom' } })
  check('any other refusal is an error carrying its message',
    other.action === 'error' && other.message === 'boom', JSON.stringify(other))
  const bare = localPickVerdict({ ok: false, error: {} })
  check('a refusal without a message still explains itself',
    bare.action === 'error' && typeof bare.message === 'string' && bare.message !== '', JSON.stringify(bare))
  const noFace = localPickVerdict(undefined)
  check('a host without the Remote face goes straight to browse', noFace.action === 'browse', JSON.stringify(noFace))
}

// ---------------------------------------------------------------------------
console.log('\n[makeLocalPicker: the remembered capability]')

{
  // The desktop preload bridge stays the very first choice and must not touch
  // the remembered capability.
  const sandbox = buildPicker({ kind: 'unknown' })
  globalThis.__DSH_DIRECTORY_PICKER__ = { pick: async () => '/from/desktop/bridge' }
  try {
    const picked = await sandbox.makeLocalPicker({ remote: { directoryPicker: { pick: async () => { throw new Error("must not be called") } } } })()
    check('the desktop bridge wins over everything', picked === '/from/desktop/bridge', String(picked))
    check('the desktop path does not set a capability kind', sandbox.localPickCapability.kind === 'unknown', sandbox.localPickCapability.kind)
  } finally {
    delete globalThis.__DSH_DIRECTORY_PICKER__
  }
}

{
  // First press on a browse-only deployment: the native verb is tried once,
  // its structured refusal is classified, the capability is remembered.
  let pickCalls = 0
  const sandbox = buildPicker({ kind: 'unknown' })
  const ctx = {
    remote: { directoryPicker: { pick: async () => { pickCalls += 1; return { ok: false, error: { code: 'directory-picker/unavailable', message: 'directoryPicker.pick needs the native capability; the composed picker serves "browse"', details: { capability: 'browse' } } } } } },
  }
  const first = await sandbox.makeLocalPicker(ctx)()
  check('the first press answers with the browse marker', first === BROWSE, String(first))
  check('the capability is remembered as browse', sandbox.localPickCapability.kind === 'browse', sandbox.localPickCapability.kind)
  const second = await sandbox.makeLocalPicker(ctx)()
  check('a later press short-circuits into browse without another native attempt',
    second === BROWSE && pickCalls === 1, `calls=${pickCalls}`)
}

{
  // A native-capable host: the RemoteResult's value flows through and the
  // capability is remembered as native.
  const sandbox = buildPicker({ kind: 'unknown' })
  const ctx = { remote: { directoryPicker: { pick: async () => ({ ok: true, value: '/home/user/project' }) } } }
  const picked = await sandbox.makeLocalPicker(ctx)()
  check('a native pick returns the path', picked === '/home/user/project', String(picked))
  check('the capability is remembered as native', sandbox.localPickCapability.kind === 'native', sandbox.localPickCapability.kind)
  const cancelled = await sandbox.makeLocalPicker({ remote: { directoryPicker: { pick: async () => ({ ok: true, value: null }) } } })()
  check('an operator cancellation returns null, not an error', cancelled === null, String(cancelled))
}

{
  // Other refusals keep the historical behavior: the message surfaces.
  const sandbox = buildPicker({ kind: 'unknown' })
  const attempt = sandbox.makeLocalPicker({ remote: { directoryPicker: { pick: async () => ({ ok: false, error: { code: 'gateway/internal', message: 'boom' } }) } } })()
  await check('an unrelated refusal throws with its message', attempt.then(() => false, (err) => err.message === 'boom'))
}

{
  // A host build without the Remote namespace keeps the uiWorkspace wrapper.
  const sandbox = buildPicker({ kind: 'unknown' })
  const picked = await sandbox.makeLocalPicker({ get: (name) => name === 'uiWorkspace' ? { pickDirectory: async () => '/from/wrapper' } : undefined })()
  check('without a Remote face the uiWorkspace wrapper still serves', picked === '/from/wrapper', String(picked))
  const attempt = sandbox.makeLocalPicker({ get: () => undefined })()
  await check('neither face explains the absence', attempt.then(() => false, (err) => err.message === 'no directory picker available on this platform'))
}

// ---------------------------------------------------------------------------
console.log('\n[browseFaceOf: one face, two hosts]')

{
  const { browseFaceOf } = (() => {
    const build = new Function(`${extractFunction('browseFaceOf')}; return browseFaceOf`)
    return { browseFaceOf: build() }
  })()

  // Remote namespace: the RemoteResult is passed through untouched.
  const seen = { listArgs: undefined, createArgs: undefined }
  const remoteCtx = {
    remote: {
      directoryPicker: {
        list: async (...args) => { seen.listArgs = args; return { ok: true, value: { path: '/home', entries: [], crumbs: [] } } },
        createDirectory: async (...args) => { seen.createArgs = args; return { ok: true, value: '/home/new' } },
      },
    },
  }
  const face = browseFaceOf(remoteCtx)
  check('the remote namespace builds a face', face !== null)
  const listed = await face.list('/home', undefined)
  check('list delegates with its arguments', listed.ok === true && seen.listArgs[0] === '/home', JSON.stringify(seen.listArgs))
  const created = await face.createDirectory('/home', 'new')
  check('createDirectory delegates with its arguments',
    created.ok === true && created.value === '/home/new' && seen.createArgs[1] === 'new', JSON.stringify(seen.createArgs))

  // uiWorkspace fallback: thrown failures are normalized into { ok, error }.
  const wrapperCtx = {
    get: (name) => name === 'uiWorkspace'
      ? {
          listDirectory: async () => ({ path: '/home', entries: [], crumbs: [] }),
          createDirectory: async () => { throw new Error('EEXIST: /home/new') },
        }
      : undefined,
  }
  const fallback = browseFaceOf(wrapperCtx)
  check('a uiWorkspace-only host still builds a face', fallback !== null)
  const wrapped = await fallback.list(undefined)
  check('the fallback wraps a success as ok', wrapped.ok === true && wrapped.value.path === '/home', JSON.stringify(wrapped))
  const failed = await fallback.createDirectory('/home', 'new')
  check('the fallback normalizes a thrown failure into the same shape',
    failed.ok === false && failed.error.message === 'EEXIST: /home/new', JSON.stringify(failed))
  check('a host with neither face has no browse dialog to open', browseFaceOf({}) === null)
}

// ---------------------------------------------------------------------------
console.log('\n[wiring]')

check('the flow recognizes the browse marker', source.includes('picked === LOCAL_PICK_BROWSE'))
check('the flow switches into the local browse mode', source.includes("setMode('localBrowse')"))
check('the local browse mode renders the browser dialog', source.includes('React.createElement(LocalDirectoryBrowser'))
check('the capability is remembered at factory scope', /const localPickCapability = \{ kind: 'unknown' \}/.test(source))
check('a remembered browse capability skips the native verb', source.includes("localPickCapability.kind === 'browse'"))
check('the client context is parked for the dialog (marksCtx pattern)', /let flowCtx = null/.test(source) && source.includes('flowCtx = ctx'))
check('the dialog drives the browse list verb', source.includes('face.list('))
check('the dialog drives the browse create verb', source.includes('face.createDirectory('))
check('the dialog follows the reported ancestry for Up (no path-string slicing)',
  /crumbs\[crumbs\.length - 2\]/.test(source))
check('dialog failures stay inside the dialog (sshwsp-warn rows)', /createError != null && jsx\('div', \{ className: 'sshwsp-warn'/.test(source))

// Locale parity for the new keys (the full parity lives in locale-register).
const zh = eval(`(${dictionaryLiteral('zh')})`) // eslint-disable-line no-eval
const en = eval(`(${dictionaryLiteral('en')})`) // eslint-disable-line no-eval
const localBrowseKeys = Object.keys(zh).filter((key) => key.startsWith('add.localBrowse.'))
check('the zh dictionary carries the new dialog keys', localBrowseKeys.length >= 12, `${localBrowseKeys.length} keys`)
check('every new key exists in en with real text',
  localBrowseKeys.every((key) => typeof en[key] === 'string' && en[key].length > 0 && en[key] !== key),
  localBrowseKeys.filter((key) => en[key] === undefined).join(', '))

console.log(`\n=== ${passes.length} passed, ${failures.length} failed ===`)
process.exit(failures.length === 0 ? 0 : 1)
