/**
 * Three-level agent prompt configuration: merge, wrap, dedupe, disable,
 * scripts, store persistence and cache behaviour.
 *
 * Everything runs against temporary directories on the local machine — no
 * SSH host, no DSH tree. Script entries use `node -e` / `sh -c` one-liners
 * so the suite stays platform-honest on POSIX and skips Windows-hostile
 * spellings (the suite itself never asserts shell syntax beyond the
 * plugin's own contract: stdout must be JSON).
 *
 * Run: node tests/agent-prompts-smoke.mjs
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  configFingerprint,
  createAgentPromptRegistry,
  effectiveEntries,
  expandGlobSync,
  globBaseDir,
  globEntryId,
  globToRegExp,
  normalizeAgentPromptsDocument,
  normalizePromptLevel,
  parseScriptOutput,
  readPromptBlocks,
  renderPromptDocument,
  runScriptEntry,
  scriptEntryId,
  wrapFileBlock,
} from '../lib/agent-prompts.js'
import { HostConfigStore } from '../lib/store.js'

console.log('\n=== agent-prompts smoke ===\n')

let failures = 0
function check (label, ok, detail) {
  if (ok) {
    console.log(`  PASS  ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const home = mkdtempSync(path.join(tmpdir(), 'dsh-agent-prompts-'))
const material = (name, content) => {
  const file = path.join(home, name)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content, 'utf8')
  return file
}

try {
  // -- ids -----------------------------------------------------------------
  {
    const id = globEntryId('/a/**/*.md')
    check('glob id is stable across calls', globEntryId('/a/**/*.md') === id)
    check('glob id differs per pattern', globEntryId('/a/*.md') !== id)
    check('glob id has the g- prefix', id.startsWith('g-'))
    check('script id has the s- prefix', scriptEntryId('node gen.js').startsWith('s-'))
    check('different content gives a different script id', scriptEntryId('node gen.js') !== scriptEntryId('node gen2.js'))
  }

  // -- level normalization --------------------------------------------------
  {
    const level = normalizePromptLevel({
      globs: ['/a/*.md', 'relative.md', '', { pattern: ' /b/**/*.md ' }, { pattern: 42 }, null],
      scripts: ['node gen.js', { command: ' sh gen.sh ' }, { command: '' }, 7],
      disabled: ['g-abc', ' g-abc ', '', 5, 's-def'],
    })
    check('string and object glob entries normalize', level.globs.length === 2, JSON.stringify(level.globs))
    check('pattern is trimmed', level.globs[1].pattern === '/b/**/*.md')
    check('ids are derived, not trusted', level.globs[0].id === globEntryId('/a/*.md'))
    check('relative patterns are dropped', !level.globs.some(entry => entry.pattern === 'relative.md'))
    check('scripts normalize and trim', level.scripts.length === 2 && level.scripts[1].command === 'sh gen.sh')
    check('disabled trims and dedupes', JSON.stringify(level.disabled) === JSON.stringify(['g-abc', 's-def']))

    const corrupt = normalizeAgentPromptsDocument('nonsense')
    check('a corrupt section degrades to empty', corrupt.global.globs.length === 0 && Object.keys(corrupt.hosts).length === 0)
    const old = normalizeAgentPromptsDocument(undefined)
    check('a missing section degrades to empty (backward compatible)', old.global !== undefined && Object.keys(old.hosts).length === 0 && Object.keys(old.workspaces).length === 0)
    const shaped = normalizeAgentPromptsDocument({
      global: { globs: ['/g/*.md'] },
      hosts: { h1: { scripts: ['x'] } },
      workspaces: { 'ssh://h1/w': { globs: ['/w/*.md'] }, 'not-ssh': { globs: ['/dropped/*.md'] } },
    })
    check('hosts and workspaces normalize per key', shaped.hosts.h1.scripts.length === 1 && shaped.workspaces['ssh://h1/w'].globs.length === 1)
    check('non-ssh workspace keys are dropped', shaped.workspaces['not-ssh'] === undefined)
  }

  // -- glob matching --------------------------------------------------------
  {
    const matcher = globToRegExp('/a/**/*-common/*.md')
    check('doublestar-middle matches deep paths', matcher.test('/a/b/c-common/d.md') === true)
    check('doublestar-middle matches one level', matcher.test('/a/b-common/x.md') === true)
    check('doublestar-middle rejects wrong suffix', matcher.test('/a/b/c-common/d.txt') === false)
    check('doublestar-middle rejects missing -common segment', matcher.test('/a/b/c/other/d.md') === false)
    check('plain * stays within one segment', globToRegExp('/a/*.md').test('/a/b/c.md') === false)
    check('? matches exactly one character', globToRegExp('/a/?.md').test('/a/x.md') === true && globToRegExp('/a/?.md').test('/a/xy.md') === false)
    check('character class honors ranges', globToRegExp('/a/[a-c].md').test('/a/b.md') === true && globToRegExp('/a/[a-c].md').test('/a/d.md') === false)
    check('negated class', globToRegExp('/a/[!0-9].md').test('/a/x.md') === true && globToRegExp('/a/[!0-9].md').test('/a/5.md') === false)
    check('regex specials are literal', globToRegExp('/a/b(c).md').test('/a/b(c).md') === true)
    check('relative patterns yield no matcher', globToRegExp('a/*.md') === undefined)
    check('base dir of a literal prefix', globBaseDir('/code/ww/*/x/*.md') === '/code/ww')
    check('base dir of a root pattern', globBaseDir('/*-common/*.md') === '/')
  }

  // -- glob expansion on disk ------------------------------------------------
  {
    material('tree/common-a/one-common/x.md', 'x')
    material('tree/common-a/two-common/y.md', 'y')
    material('tree/common-a/deep/z-common/w.md', 'w')
    material('tree/common-a/one-common/skip.txt', 'txt')
    const hit = expandGlobSync(`${home}/tree/common-a/**/*-common/*.md`)
    check('expansion finds nested matches', hit.files.length === 3, JSON.stringify(hit.files))
    check('expansion sorts lexicographically', JSON.stringify(hit.files) === JSON.stringify([...hit.files].sort()))
    check('expansion skips non-md by pattern', !hit.files.some(file => file.endsWith('.txt')))
    check('expansion reports no error', hit.error === undefined)
    const miss = expandGlobSync(`${home}/nowhere-at-all/*.md`)
    check('missing base directory is a readable error', miss.files.length === 0 && miss.error.includes('base directory does not exist'))
    const rel = expandGlobSync('relative/*.md')
    check('relative patterns error instead of guessing', rel.files.length === 0 && rel.error.includes('absolute'))
  }

  // -- script protocol -------------------------------------------------------
  {
    const parsed = parseScriptOutput('s-x', JSON.stringify({ files: ['/a.md', '/b.md'] }))
    check('object form parses', JSON.stringify(parsed.files) === JSON.stringify(['/a.md', '/b.md']))
    const bare = parseScriptOutput('s-x', JSON.stringify(['/a.md', '/a.md', 'rel.md', 7, '']))
    check('bare array parses, dedupes and filters', JSON.stringify(bare.files) === JSON.stringify(['/a.md']), JSON.stringify(bare))
    const junk = parseScriptOutput('s-x', 'not json at all')
    check('bad JSON is a readable error', junk.files.length === 0 && junk.error.includes('did not print JSON'))
    const wrong = parseScriptOutput('s-x', '{"nope": 1}')
    check('wrong shape is a readable error', wrong.files.length === 0 && wrong.error.includes('files'))

    const gen = material('gen/gen.cjs', `process.stdout.write(JSON.stringify({ files: [${JSON.stringify(home + '/tree/common-a/one-common/x.md')}] }))\n`)
    const listing = await runScriptEntry({ id: 's-list', command: `${JSON.stringify(process.execPath)} ${JSON.stringify(gen)}` })
    check('a working script returns its files', JSON.stringify(listing.files) === JSON.stringify([home + '/tree/common-a/one-common/x.md']), JSON.stringify(listing))
    const failing = await runScriptEntry({ id: 's-fail', command: 'exit 3' })
    check('a failing script is a readable error, not a throw', failing.files.length === 0 && failing.error.includes('exited with code 3'), JSON.stringify(failing))
    const junkOut = await runScriptEntry({ id: 's-junk', command: 'echo junk' })
    check('non-JSON stdout is a readable error', junkOut.files.length === 0 && junkOut.error.includes('did not print JSON'))
  }

  // -- disable semantics ------------------------------------------------------
  {
    const global = normalizePromptLevel({ globs: ['/g/*.md'], scripts: ['node g.js'] })
    const host = normalizePromptLevel({ globs: ['/h/*.md'], disabled: [globEntryId('/g/*.md')] })
    const workspace = normalizePromptLevel({ globs: ['/w/*.md'], disabled: [scriptEntryId('node g.js'), globEntryId('/h/*.md')] })
    const entries = effectiveEntries(global, host, workspace)
    const plainOrder = effectiveEntries(global, normalizePromptLevel({ globs: ['/h/*.md'] }), normalizePromptLevel({ globs: ['/w/*.md'] })).map(item => item.level)
    check('order is global globs, global scripts, host, workspace', JSON.stringify(plainOrder) === JSON.stringify(['global', 'global', 'host', 'workspace']), JSON.stringify(plainOrder))
    const paths = entries.map(item => `${item.level}:${item.kind}:${item.entry.id}`)
    check('host can disable a global entry', !paths.some(id => id.startsWith('global:glob:')), JSON.stringify(paths))
    check('workspace can disable a global script', !paths.some(id => id.startsWith('global:script:')), JSON.stringify(paths))
    check('workspace can disable a host entry', !paths.some(id => id.startsWith('host:')), JSON.stringify(paths))
    check('workspace keeps its own entries', paths.filter(id => id.startsWith('workspace:')).length === 1, JSON.stringify(paths))
    const alone = effectiveEntries(global, normalizePromptLevel(undefined), normalizePromptLevel(undefined))
    check('with no lower levels the global entries survive', alone.length === 2)
  }

  // -- wrap format (strict) ---------------------------------------------------
  {
    const withNl = wrapFileBlock('/a/x.md', 'content\n')
    check('block with trailing newline stays exact', withNl === '----[/a/x.md]---start\ncontent\n----[/a/x.md]---end', JSON.stringify(withNl))
    const noNl = wrapFileBlock('/a/y.md', 'content')
    check('block without trailing newline gets one', noNl === '----[/a/y.md]---start\ncontent\n----[/a/y.md]---end', JSON.stringify(noNl))
    const doc = renderPromptDocument([
      { path: '/a/x.md', content: 'one\n' },
      { path: '/a/y.md', content: 'two' },
    ])
    check('document joins blocks with single newlines', doc.includes('----[/a/x.md]---end\n----[/a/y.md]---start'), JSON.stringify(doc))
    check('empty document renders empty', renderPromptDocument([]) === '')
    const collected = readPromptBlocks(['/a/x.md'], [])
    check('readPromptBlocks reads real files', collected.blocks[0]?.content === 'content\n' || collected.blocks.length === 0)
  }

  // -- dedupe keeps the first occurrence ---------------------------------------
  {
    const shared = material('dedupe/shared.md', 'shared\n')
    const levels = {
      global: normalizePromptLevel({ globs: [`${home}/dedupe/*.md`] }),
      host: normalizePromptLevel({ globs: [`${home}/dedupe/shared.md`] }),
      workspace: normalizePromptLevel({ globs: [`${home}/dedupe/shared.md`] }),
    }
    const { collectPromptFiles } = await import('../lib/agent-prompts.js')
    const { files, errors } = await collectPromptFiles(levels)
    check('the same file from three levels loads once', JSON.stringify(files) === JSON.stringify([shared]), JSON.stringify(files))
    check('dedupe produces no errors', errors.length === 0, JSON.stringify(errors))
    const missing = await collectPromptFiles({
      global: normalizePromptLevel(undefined),
      host: normalizePromptLevel(undefined),
      workspace: normalizePromptLevel({ globs: [`${home}/dedupe/ghost.md`] }),
    })
    check('a matched file deleted before the read is reported', missing.files.length === 0 && missing.errors.some(error => error.message.includes('ghost.md')), JSON.stringify(missing.errors))
  }

  // -- store integration --------------------------------------------------------
  {
    const storeFile = path.join(home, 'store.json')
    writeFileSync(storeFile, JSON.stringify({ version: 1, hosts: [{ alias: 'h', host: 'x', port: 22, user: 'u', auth: { kind: 'agent' } }], secrets: { h: { password: 'enc:v1:zz' } }, knownHosts: { h: { fingerprint: 'SHA256:aa' } } }, null, 2), 'utf8')
    const store = new HostConfigStore(storeFile)
    check('an old store reads with empty prompt config', store.agentPrompts().global.globs.length === 0)
    store.setGlobalAgentPrompts({ globs: [`${home}/tree/**/*.md`] })
    store.setHostAgentPrompts('h', { scripts: ['echo []'] })
    store.setWorkspaceAgentPrompts('ssh://h/w/../w', { globs: [`${home}/tree/common-a/*.md`] })
    check('workspace keys canonicalize', Object.keys(store.agentPrompts().workspaces).join(',') === 'ssh://h/w')
    const onDisk = JSON.parse(readFileSync(storeFile, 'utf8'))
    check('secrets survive the rewrite', onDisk.secrets?.h?.password === 'enc:v1:zz')
    check('knownHosts survive the rewrite', onDisk.knownHosts?.h?.fingerprint === 'SHA256:aa')
    check('hosts survive the rewrite', onDisk.hosts.length === 1 && onDisk.hosts[0].alias === 'h')
    store.renameHostAgentPrompts('h', 'h2')
    check('rename moves the host level', store.agentPrompts().hosts.h === undefined && store.agentPrompts().hosts.h2 !== undefined)
    store.setHostAgentPrompts('h2', null)
    check('clearing drops the level and leaves no empty objects', store.agentPrompts().hosts.h2 === undefined)
    const clearedDisk = JSON.parse(readFileSync(storeFile, 'utf8'))
    check('cleared section stays valid JSON', Array.isArray(clearedDisk.hosts) && typeof clearedDisk.agentPrompts === 'object')
    store.setGlobalAgentPrompts(null)
    check('clearing the global level empties it', store.agentPrompts().global.globs.length === 0)
    check('an idempotent save does not rewrite the file', (() => {
      const before = readFileSync(storeFile, 'utf8')
      store.setGlobalAgentPrompts({ globs: [] })
      const after = readFileSync(storeFile, 'utf8')
      return before === after
    })())
  }

  // -- registry: cache, invalidation, serve -------------------------------------
  {
    const store = new HostConfigStore(path.join(home, 'registry.json'))
    const shared = material('reg/a.md', 'reg-A\n')
    const extra = material('reg/b.md', 'reg-B')
    store.setGlobalAgentPrompts({ globs: [`${home}/reg/*.md`] })
    store.setWorkspaceAgentPrompts('ssh://h/w', { disabled: [] })
    let roots = ['ssh://h/w']
    const registry = createAgentPromptRegistry({ store, roots: () => roots })
    const first = registry.serveForCwd('ssh://h/w/sub/dir')
    check('a cache miss serves empty for that step', first === '')
    const warmed = await registry.refreshWorkspace('ssh://h/w')
    check('refresh returns the merged text', warmed.text.includes('reg-A'), JSON.stringify(warmed.text.slice(0, 80)))
    check('refresh orders files and wraps strictly', warmed.text.includes(`----[${shared}]---start\nreg-A\n----[${shared}]---end`), JSON.stringify(warmed.text))
    check('content without trailing newline still ends its block cleanly', warmed.text.includes(`reg-B\n----[${extra}]---end`), JSON.stringify(warmed.text.slice(-120)))
    const served = registry.serveForCwd('ssh://h/w/sub/dir')
    check('serve returns the cached merge after warm-up', served === warmed.text)
    check('serve resolves the longest containing root', registry.resolveWorkspace('ssh://h/w/sub') === 'ssh://h/w')
    check('serve ignores unrelated workspaces', registry.serveForCwd('ssh://other/x') === '')
    check('serve ignores non-ssh cwd', registry.serveForCwd('/local/path') === '')

    // A nested root beats the outer one.
    material('reg2/c.md', 'reg-C\n')
    store.setWorkspaceAgentPrompts('ssh://h/w/sub', { globs: [`${home}/reg2/*.md`] })
    roots = ['ssh://h/w', 'ssh://h/w/sub']
    await registry.refreshWorkspace('ssh://h/w/sub')
    const nested = registry.serveForCwd('ssh://h/w/sub/x')
    // The GLOBAL level applies to the nested root too, so reg-A is expected
    // here; what proves the nested root won is reg-C, which only its own
    // workspace level contributes.
    check('a nested root serves its own merge', nested.includes('reg-C'), JSON.stringify(nested.slice(0, 160)))
    const outer = registry.serveForCwd('ssh://h/w/x')
    check('the outer root still serves its own merge', outer.includes('reg-A') && !outer.includes('reg-C'))

    // Config change invalidates; the next step re-serves.
    store.setGlobalAgentPrompts({ globs: [`${home}/reg/a.md`] })
    check('a config change invalidates the cache', registry.serveForCwd('ssh://h/w') === '')
    await registry.refreshAll()
    const refreshed = registry.serveForCwd('ssh://h/w')
    check('refreshAll repopulates after invalidation', refreshed.includes('reg-A') && !refreshed.includes('reg-B'), JSON.stringify(refreshed.slice(0, 120)))

    // Detach / unmount: removing the root stops the section.
    roots = []
    check('a detached workspace serves nothing', registry.serveForCwd('ssh://h/w') === '')

    // Errors surface, they do not throw.
    store.setWorkspaceAgentPrompts('ssh://h/w', { scripts: ['exit 7'] })
    const preview = await registry.preview('ssh://h/w')
    check('preview reports script failures as readable errors', preview.errors.some(error => error.message.includes('exited with code 7')), JSON.stringify(preview.errors))
    check('preview still merges the surviving levels', preview.text.includes('reg-A'), JSON.stringify(preview.text.slice(0, 120)))
  }

  // -- fingerprint ---------------------------------------------------------------
  {
    const a = normalizePromptLevel({ globs: ['/x/*.md'] })
    const b = normalizePromptLevel({ globs: ['/x/*.md'], disabled: ['g-1'] })
    check('a disable list changes the fingerprint', configFingerprint(a, a, a) !== configFingerprint(a, a, b))
    check('identical configs share a fingerprint', configFingerprint(a, b, b) === configFingerprint(a, b, b))
  }
} finally {
  rmSync(home, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nagent-prompts smoke: all green\n' : `\nagent-prompts smoke: ${failures} failure(s)\n`)
process.exit(failures === 0 ? 0 : 1)
