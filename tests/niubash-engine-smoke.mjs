/**
 * The Niubash load-path probe, presence cache, auto-deploy kick, and the
 * store record they rely on (cd212c3 + 4dc6202).
 *
 * Five contracts, each with its own section:
 *
 *   1. **niubashCandidates** — the ordered three-level default placements
 *      (project roots, then `%USERPROFILE%`, then the legacy store root), a
 *      recorded `bashProvisioned` suppressing the whole list;
 *   2. **buildNiubashProbeScript** — one cmd sweep, `manifest.json` AND the
 *      bash executable per candidate, `@@<root>` markers only, cmd builtins
 *      exclusively;
 *   3. **the engine's presence cache** — `noteNiubashPresence` /
 *      `niubashPresenceOf` is the synchronous fact the injection gate reads;
 *      the project-placement bases come from the filesystem router's roots
 *      flipped into Windows spelling (`#projectRootsOf`);
 *   4. **kickNiubashAutoDeploy** — the gate matrix (win + `niubashAutoDeploy`
 *      + no record → one kick; concurrent second kick is a no-op; a record
 *      stands down; non-win/unconfigured/disposed are no-ops; a failure is
 *      recorded and clears the in-flight guard so the next connection can
 *      retry once) with the placement pinned to the user-directory default;
 *   5. **acquire** — a NEW connection kicks exactly once (a scripted ssh2
 *      client takes the handshake's place — no socket), a cache hit never
 *      kicks.
 *
 * Everything runs offline: ssh2 is a scripted stand-in package that the
 * sandbox copy of lib/ resolves FIRST (its own node_modules wins over the
 * peer root), execs answer from scripts, and `globalThis.fetch` throws.
 *
 * Run: node tests/niubash-engine-smoke.mjs
 */

import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// The engine chain resolves the DSH peer packages at module load (remote-fs.js
// via bash-payload.js); without an assembled (or generated stub) tree there is
// nothing to resolve against.
const coreRoot = process.env.DSH_CORE_ROOT
if (!coreRoot) {
  console.log('\n=== niubash engine smoke ===\n')
  console.log('  SKIP  DSH_CORE_ROOT is not set (engine.js needs @deepseek-ai/dsh-fs)')
  console.log('\n=== 0 passed, 0 failed, 1 suite skipped ===')
  process.exit(0)
}
process.env.DSH_PEER_ROOT = [coreRoot, process.env.DSH_PEER_ROOT].filter(Boolean).join(path.delimiter)

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
let failures = 0
function check (label, ok, detail) {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`) } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

console.log('\n=== niubash engine smoke ===\n')

// ---------------------------------------------------------------------------
// Sandbox: a lib/ copy plus a scripted ssh2 package. `requirePeer('ssh2')`
// tries the package tree next to the module first, so the COPY resolves the
// stand-in while the real ssh2 (a repo devDependency) is never loaded — and
// therefore never opens a socket.
// ---------------------------------------------------------------------------

const sandbox = mkdtempSync(path.join(tmpdir(), 'dsh-niubash-engine-'))
mkdirSync(path.join(sandbox, 'lib'), { recursive: true })
for (const file of readdirSync(path.join(pluginRoot, 'lib'))) copyFileSync(path.join(pluginRoot, 'lib', file), path.join(sandbox, 'lib', file))

const ssh2Stub = `\
'use strict'
const { EventEmitter } = require('node:events')
const instances = []
class Client extends EventEmitter {
  constructor () { super(); instances.push(this) }
  connect (config) {
    this.config = config
    setImmediate(() => this.emit('ready'))
  }
  sftp (callback) { setImmediate(() => callback(null, { __stubSftp: true })) }
  end () { setImmediate(() => this.emit('close')) }
  destroy () {}
}
module.exports = { Client, __instances: instances }
`
mkdirSync(path.join(sandbox, 'node_modules', 'ssh2'), { recursive: true })
writeFileSync(path.join(sandbox, 'node_modules', 'ssh2', 'package.json'), JSON.stringify({ name: 'ssh2', version: '0.0.0-stub', main: 'index.cjs' }))
writeFileSync(path.join(sandbox, 'node_modules', 'ssh2', 'index.cjs'), ssh2Stub)

const winBash = await import(pathToFileURL(path.join(sandbox, 'lib', 'win-bash.js')).href)
const { niubashCandidates, buildNiubashProbeScript, resolveWinBash } = winBash
const { BASH_PAYLOAD_PIN, NIUBASH_RUNTIME_RELATIVE, resolvePayloadPin } = await import(pathToFileURL(path.join(sandbox, 'lib', 'bash-payload.js')).href)
const { SshWorkspaceEngine, windowsRemotePath } = await import(pathToFileURL(path.join(sandbox, 'lib', 'engine.js')).href)
const { KINDS } = await import(pathToFileURL(path.join(sandbox, 'lib', 'diagnostics.js')).href)
const { HostConfigStore } = await import(pathToFileURL(path.join(sandbox, 'lib', 'store.js')).href)
const { HostStore } = await import(pathToFileURL(path.join(sandbox, 'lib', 'hosts.js')).href)

const sandboxRequire = createRequire(path.join(sandbox, 'noop.cjs'))
const { __instances: ssh2Instances } = sandboxRequire('ssh2')

// No real network anywhere in this suite.
globalThis.fetch = (input) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? input)
  throw new Error(`no-network-in-test: fetch(${url})`)
}

const NIUBASH_USER_ROOT = `%USERPROFILE%\\${NIUBASH_RUNTIME_RELATIVE}`
const NIUBASH_LEGACY_ROOT = `%USERPROFILE%\\.dsh-ssh-workspace\\bash\\${resolvePayloadPin().version}`

/** Poll until the predicate holds (the kick is fire-and-forget by design). */
async function until (predicate, { timeoutMs = 2000 } = {}) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition not met within the timeout')
    await new Promise(resolve => setImmediate(resolve))
  }
}

/** A hermetic host store (never the developer's real dsh-ssh.json). */
function hermeticStore (label) {
  const home = mkdtempSync(path.join(tmpdir(), `dsh-niubash-engine-store-${label}-`))
  return { home, store: new HostStore(path.join(home, 'ssh-config'), new HostConfigStore(path.join(home, 'store.json'))) }
}

// ---------------------------------------------------------------------------
console.log('[niubashCandidates: the ordered three-level default placements]')

{
  const candidates = niubashCandidates(undefined, [])
  check('an unconfigured host gets the user placement first',
    candidates.length === 2 && candidates[0].root === NIUBASH_USER_ROOT && candidates[0].placement === 'user',
    JSON.stringify(candidates))
  check('the legacy store root (pin version) is probed last',
    candidates[1].root === NIUBASH_LEGACY_ROOT && candidates[1].placement === 'legacy',
    JSON.stringify(candidates[1]))

  const withProjects = niubashCandidates(undefined, ['D:\\repo', 'D:/two/', '', '   '])
  // Only TRAILING separators are stripped: the Windows spelling is the
  // caller's contract (#projectRootsOf maps through windowsRemotePath), so
  // interior separators pass through verbatim.
  check('project roots come first, one candidate per mounted workspace, trailing separators stripped',
    withProjects.length === 4
    && withProjects[0].root === `D:\\repo\\${NIUBASH_RUNTIME_RELATIVE}` && withProjects[0].placement === 'project'
    && withProjects[1].root === `D:/two\\${NIUBASH_RUNTIME_RELATIVE}` && withProjects[1].placement === 'project',
    JSON.stringify(withProjects))
  check('blank project roots are filtered out', withProjects.slice(2).every(candidate => candidate.placement !== 'project'))

  const recorded = { bashProvisioned: { path: 'C:\\x\\bash.exe', root: 'C:\\x', version: '9', sha256: 'a'.repeat(64), provisionedAt: 1 } }
  check('a recorded bashProvisioned suppresses the whole default list (rung 2 owns it)',
    niubashCandidates(recorded, ['D:\\repo']).length === 0)
}

// ---------------------------------------------------------------------------
console.log('\n[buildNiubashProbeScript: one cmd sweep, markers only]')

{
  const candidates = niubashCandidates(undefined, ['D:\\repo'])
  const script = buildNiubashProbeScript(candidates)
  const exeRelative = resolvePayloadPin().executableRelativePath.replaceAll('/', '\\')
  check('every candidate checks its manifest AND its bash executable, then echoes the root',
    candidates.every(candidate => script.includes(
      `if exist "${candidate.root}\\manifest.json" if exist "${candidate.root}\\${exeRelative}" echo @@${candidate.root}`,
    )), script)
  check('the sweeps are joined with cmd & in candidate order',
    script.split(' & ').length === candidates.length, script)
  check('the probe EXECUTES nothing (if exist / echo only — the cmd red line)',
    !/where |dir |type |bash --/u.test(script), script)
  check('the executable relative path rides in Windows spelling',
    !script.includes('/') || !script.includes('winuxcmd/usr'), script)
}

// ---------------------------------------------------------------------------
console.log('\n[resolveWinBash rung 3a: probe, then verify, then believe]')

/** An engine double with scripted exec answers and a presence spy. */
function probeEngine (steps) {
  const calls = []
  const presence = []
  const diagnostics = []
  const engine = {
    diagnostics: { record: (kind, message, meta) => { diagnostics.push({ kind, message, meta }) } },
    noteNiubashPresence (alias, info) { presence.push({ alias, info }) },
    async exec (_alias, command, options) {
      calls.push({ command, options })
      const step = steps.shift()
      if (step === undefined) throw new Error(`unexpected exec: ${command}`)
      return { success: step.success ?? true, exitCode: step.exitCode ?? 0, stdout: step.stdout ?? '', stderr: '', timedOut: false, truncated: false, durationMs: 0 }
    },
  }
  return { engine, calls, presence, diagnostics }
}

const BASH_VERSION = 'GNU bash, version 5.2.26(1)-release (x86_64-pc-msys)\r\n'
{
  const { engine, calls, presence } = probeEngine([
    { stdout: `@@${NIUBASH_USER_ROOT}\r\n` },
    { stdout: BASH_VERSION },
  ])
  const bash = await resolveWinBash(engine, 'w', { entry: {} })
  const exeRelative = resolvePayloadPin().executableRelativePath.replaceAll('/', '\\')
  check('a placement hit is verified by real execution before it is believed',
    calls.length === 2 && calls[0].command.includes('if exist') && !calls[0].command.includes('where bash')
    && calls[1].command.endsWith(`\\"${NIUBASH_USER_ROOT}\\${exeRelative}\\" --version`.replaceAll('\\"', '"')),
    JSON.stringify(calls.map(call => call.command)))
  check('the verified placement answers as detected, with its PATH prefix',
    bash?.source === 'detected' && bash.path === `${NIUBASH_USER_ROOT}\\${exeRelative}`
    && bash.prefix === `set "PATH=${NIUBASH_USER_ROOT.replace(/[\\\\]+$/u, '')};${NIUBASH_USER_ROOT.replace(/[\\\\]+$/u, '')}\\winuxcmd\\usr\\bin;%PATH%" & `,
    JSON.stringify(bash))
  check('the probe-proven placement lands in the engine presence cache (the injection gate reads it)',
    presence.length === 1 && presence[0].info.root === NIUBASH_USER_ROOT
    && presence[0].info.placement === 'user' && presence[0].info.source === 'probe'
    && presence[0].info.releaseTag === resolvePayloadPin().releaseTag && presence[0].info.version === BASH_VERSION.trim(),
    JSON.stringify(presence))
}

{
  // NOTE (defect report, see the suite tail): on a real cmd.exe the %VAR% in
  // the echo payload expands, so the marker carries the CONCRETE root — which
  // the candidate match below (template vs concrete) can never pair. These
  // assertions pin the designed template-spelled behavior; the expansion gap
  // is reported to the implementer, not papered over.
  const { engine, calls, presence } = probeEngine([
    { stdout: `@@${NIUBASH_USER_ROOT}\r\n@@${NIUBASH_LEGACY_ROOT}\r\n` },
    { stdout: '', success: false, exitCode: 1 },
    { stdout: '', success: false, exitCode: 1 },
    { stdout: '' },
  ])
  const bash = await resolveWinBash(engine, 'w', { entry: {} })
  check('a placement whose bash stops verifying is skipped, the next candidate gets its turn',
    calls.length === 4 && calls[1].command.includes(`${NIUBASH_USER_ROOT}\\winuxcmd`)
    && calls[2].command.includes('.dsh-ssh-workspace'),
    JSON.stringify(calls.map(call => call.command)))
  check('no unverifiable candidate is cached or returned', presence.length === 0 && bash === undefined, JSON.stringify({ presence, bash }))
}

{
  const { engine, calls } = probeEngine([{ stdout: BASH_VERSION }])
  await resolveWinBash(engine, 'w', { entry: { bashProvisioned: { path: 'C:\\x\\bash.exe', root: 'C:\\x', version: '9', sha256: 'a'.repeat(64), provisionedAt: 1 } } })
  check('a recorded deployment skips the niubash probe entirely (rung 2 already owns it)',
    calls.length === 1 && !calls[0].command.includes('manifest.json'), JSON.stringify(calls.map(call => call.command)))
}

// ---------------------------------------------------------------------------
console.log('\n[the engine presence cache and the project-placement bases]')

{
  const { store, home } = hermeticStore('presence')
  const engine = new SshWorkspaceEngine({ store })
  try {
    check('a fresh engine reports no presence', engine.niubashPresenceOf('w') === undefined)
    engine.noteNiubashPresence('w', { root: 'C:\\x\\niubash', version: '9.9.9', placement: 'user', source: 'provisioned' })
    const cached = engine.niubashPresenceOf('w')
    check('noteNiubashPresence retains the fact with its arrival time',
      cached?.root === 'C:\\x\\niubash' && cached?.placement === 'user' && Number.isInteger(cached?.at), JSON.stringify(cached))
  } finally {
    engine.dispose()
    rmSync(home, { recursive: true, force: true })
  }
}

{
  // #projectRootsOf feeds rung 3a its level-1 bases: the router's served roots
  // for THIS host, flipped into Windows spelling.
  const { store, home } = hermeticStore('roots')
  const entryStore = store.entryStore
  entryStore.create({ alias: 'w', host: 'w.example', user: 'u', auth: { kind: 'agent' }, os: 'win' })
  const engine = new SshWorkspaceEngine({ store })
  const steps = []
  const calls = []
  const client = {
    exec (command, _options, callback) {
      calls.push(command)
      const step = steps.shift() ?? { stdout: '' }
      const stream = {
        stderr: { on () {} },
        on (event, handler) {
          if (event === 'data' && step.stdout !== '') handler(Buffer.from(step.stdout))
          else if (event === 'close') handler(step.code ?? 0)
        },
        signal () {},
        close () {},
        end () {},
      }
      callback(undefined, stream)
    },
    end () {},
  }
  engine.pool.set('w', { alias: 'w', client, sftp: undefined, streamSftp: undefined, idleAt: Date.now(), inFlight: 0, holds: 0, broken: false, agentForward: false, dialect: undefined, loginDialect: undefined, bash: undefined, resolvingBash: false })
  engine.fs = { listRoots: () => ['ssh://w/D:/repo', 'ssh://other/X', '/local/path'] }
  steps.push({ stdout: '' }, { stdout: '' }) // niubash sweep, well-known sweep — both silent
  try {
    const bash = await engine.remoteBash('w')
    check('a pinned win with silent sweeps resolves to none', bash === undefined, JSON.stringify(bash))
    check('the niubash sweep carries the mounted project root in Windows spelling',
      calls[0]?.includes(`if exist "D:\\repo\\${NIUBASH_RUNTIME_RELATIVE}\\manifest.json"`), calls[0])
    check('the sweep carries the user and legacy levels after the project level',
      calls[0]?.includes(`if exist "${NIUBASH_USER_ROOT}\\manifest.json"`)
      && calls[0]?.indexOf(`D:\\repo\\${NIUBASH_RUNTIME_RELATIVE}`) < calls[0]?.indexOf(NIUBASH_USER_ROOT)
      && calls[0]?.includes(`if exist "${NIUBASH_LEGACY_ROOT}\\manifest.json"`), calls[0])
    check('other hosts\' roots and non-ssh paths never reach the sweep',
      !calls[0]?.includes('other') && !calls[0]?.includes('/local/path'), calls[0])
    check('windowsRemotePath flips the SFTP drive spelling', windowsRemotePath('/D:/repo') === 'D:\\repo')
  } finally {
    engine.dispose()
    rmSync(home, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n[kickNiubashAutoDeploy: the gate matrix]')

/** A real engine wired for kick observation: everything behind the gate is a double. */
function kickHarness (storeLabel) {
  const { store, home } = hermeticStore(storeLabel)
  const engine = new SshWorkspaceEngine({ store })
  const touched = { execRaw: [], statPaths: [], withSftp: 0 }
  let loginGate = Promise.resolve('cmd')
  engine.loginDialect = () => loginGate
  engine.execRaw = async (_alias, command) => {
    touched.execRaw.push(command)
    return { success: true, exitCode: 0, stdout: command.includes('--version') ? 'GNU bash, version 5.2.26(1)-release\r\n' : 'C:\\Users\\u\r\n', stderr: '', timedOut: false, truncated: false, durationMs: 0 }
  }
  engine.withSftp = async (_alias, operation) => {
    touched.withSftp += 1
    return await operation({
      stat (target, callback) { touched.statPaths.push(target); callback(null, null) },
    })
  }
  return { engine, store, home, touched, setLoginGate: maker => { loginGate = maker() } }
}

{
  const { engine, store, home, touched } = kickHarness('matrix')
  try {
    store.entryStore.create({ alias: 'auto-win', host: 'h.example', user: 'u', auth: { kind: 'agent' }, os: 'win', niubashAutoDeploy: true })
    const kicked = engine.kickNiubashAutoDeploy('auto-win')
    check('win + niubashAutoDeploy + no record → the kick starts', kicked === true, String(kicked))
    check('the kick is registered in flight immediately (the shared guard)', engine.niubashAutoDeploying.has('auto-win'))
    await until(() => !engine.niubashAutoDeploying.has('auto-win'))
    check('the kicked deployment targets the user-directory placement (the receipt stat names it)',
      touched.statPaths[0] === `/C:/Users/u/.dsh/runtimes/plugins/dsh-ssh-workspace/niubash/.provisioned.json`
      && touched.statPaths[0].includes(NIUBASH_RUNTIME_RELATIVE.replaceAll('\\', '/')),
      JSON.stringify(touched.statPaths))
    check('the offline failure is recorded as a degraded diagnostic (never silent)',
      engine.diagnostics.list().some(entry => entry.kind === KINDS.degraded && entry.message.includes('niubash auto-deploy failed')),
      JSON.stringify(engine.diagnostics.list().map(entry => entry.message)))
    check('the in-flight guard cleared after the failure (the next connection may retry once)',
      !engine.niubashAutoDeploying.has('auto-win'))
    check('a kick after a failure starts again (键删后可再补一次)', engine.kickNiubashAutoDeploy('auto-win') === true)
    await until(() => !engine.niubashAutoDeploying.has('auto-win'))

    // A record that raced in (a dialog init finishing first) stands the kick down.
    const record = { path: 'C:\\Users\\u\\x\\bash.exe', root: 'C:\\Users\\u\\x', version: '9', sha256: 'a'.repeat(64), provisionedAt: Date.now() }
    store.entryStore.mutateHosts(entries => entries.map(entry => entry.alias === 'auto-win' ? { ...entry, bashProvisioned: record } : entry))
    check('a bashProvisioned record stands the kick down (the recorded target owns the deployment)',
      engine.kickNiubashAutoDeploy('auto-win') === false && !engine.niubashAutoDeploying.has('auto-win'))
  } finally {
    engine.dispose()
    rmSync(home, { recursive: true, force: true })
  }
}

{
  const { engine, store, home } = kickHarness('gates')
  try {
    store.entryStore.create({ alias: 'mac-auto', host: 'h.example', user: 'u', auth: { kind: 'agent' }, os: 'mac', niubashAutoDeploy: true })
    store.entryStore.create({ alias: 'win-manual', host: 'h.example', user: 'u', auth: { kind: 'agent' }, os: 'win' })
    check('a non-win host never kicks', engine.kickNiubashAutoDeploy('mac-auto') === false)
    check('a win host without the wish never kicks (absent reads false)',
      engine.kickNiubashAutoDeploy('win-manual') === false)
    check('an unknown alias never kicks', engine.kickNiubashAutoDeploy('nobody') === false)
    engine.dispose()
    check('a disposed engine never kicks', engine.kickNiubashAutoDeploy('win-manual') === false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

{
  const { engine, store, home } = kickHarness('concurrent')
  try {
    store.entryStore.create({ alias: 'auto-win', host: 'h.example', user: 'u', auth: { kind: 'agent' }, os: 'win', niubashAutoDeploy: true })
    let release
    engine.loginDialect = () => new Promise(resolve => { release = resolve })
    const first = engine.kickNiubashAutoDeploy('auto-win')
    const second = engine.kickNiubashAutoDeploy('auto-win')
    check('a second kick while one is airborne is a no-op', first === true && second === false, `${first}/${second}`)
    check('exactly one run is in flight', engine.niubashAutoDeploying.has('auto-win'))
    release('cmd')
    await until(() => !engine.niubashAutoDeploying.has('auto-win'))
    check('the airborne run settled (failure recorded; the guard is one-deep, not sticky)',
      engine.diagnostics.list().some(entry => entry.message.includes('niubash auto-deploy failed')))
  } finally {
    engine.dispose()
    rmSync(home, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n[acquire: a new connection kicks once, a cache hit never kicks]')

{
  const { store, home } = hermeticStore('acquire')
  try {
    store.entryStore.create({ alias: 'kickwin', host: '10.0.0.42', port: 22, user: 'ao', auth: { kind: 'password', password: 'kick-secret' }, os: 'win', niubashAutoDeploy: true })
    const engine = new SshWorkspaceEngine({ store })
    const kicks = []
    engine.kickNiubashAutoDeploy = alias => { kicks.push(alias); return true }
    try {
      const record = await engine.acquire('kickwin')
      check('a new connection is established through the scripted ssh2 client',
        record?.client === ssh2Instances.at(-1) && record?.sftp?.__stubSftp === true, JSON.stringify({ stubs: ssh2Instances.length }))
      check('a NEW connection kicks the auto-deploy exactly once',
        kicks.length === 1 && kicks[0] === 'kickwin', JSON.stringify(kicks))
      const again = await engine.acquire('kickwin')
      check('a cache hit reuses the record without another kick',
        again === record && kicks.length === 1, JSON.stringify(kicks))
    } finally {
      engine.dispose()
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n[store: the niubashAutoDeploy wish]')

{
  const { store, home } = hermeticStore('store')
  const entryStore = store.entryStore
  try {
    entryStore.create({ alias: 'a', host: 'h.example', user: 'u', auth: { kind: 'agent' }, niubashAutoDeploy: true })
    check('an explicit true is stored (and only true)',
      entryStore.find('a').niubashAutoDeploy === true)
    entryStore.create({ alias: 'b', host: 'h.example', user: 'u', auth: { kind: 'agent' }, niubashAutoDeploy: false })
    check('an explicit false never lands on disk (absent reads false everywhere)',
      !Object.hasOwn(entryStore.find('b'), 'niubashAutoDeploy'))
    entryStore.create({ alias: 'c', host: 'h.example', user: 'u', auth: { kind: 'agent' } })
    check('an absent wish keeps the entry byte-identical to an older version\'s',
      !Object.hasOwn(entryStore.find('c'), 'niubashAutoDeploy'))

    entryStore.update('c', { alias: 'c', host: 'h.example', user: 'u', auth: { kind: 'agent' }, niubashAutoDeploy: true })
    check('checking the box stores the wish', entryStore.find('c').niubashAutoDeploy === true)
    entryStore.update('c', { alias: 'c', host: 'h.example', user: 'u', auth: { kind: 'agent' }, niubashAutoDeploy: false })
    check('unchecking deletes the key (勾掉即删键)', !Object.hasOwn(entryStore.find('c'), 'niubashAutoDeploy'))

    // The rejection boundary: a hand-edited store carrying a non-boolean must
    // fail the next update loudly instead of being read as false.
    entryStore.mutateHosts(entries => entries.map(entry => entry.alias === 'a' ? { ...entry, niubashAutoDeploy: 'yes' } : entry))
    let threw
    try { entryStore.update('a', { alias: 'a', host: 'h.example', user: 'u', auth: { kind: 'agent' } }) } catch (error) { threw = error.message }
    check('a non-boolean niubashAutoDeploy is rejected by the validator',
      threw?.includes('niubashAutoDeploy must be a boolean when present'), String(threw))
    check('a non-boolean patch value cannot sneak past mergeEntry (only booleans merge)',
      !Object.hasOwn(entryStore.find('a'), 'unused') && entryStore.find('a').niubashAutoDeploy === 'yes')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n[reported defect (documented here, not papered over)]')
console.log(`  NOTE  the rung-3a hit→candidate match compares the template root
        (%USERPROFILE%\\…) with whatever the probe echoed. On a real cmd.exe the
        %VAR% inside the echo payload EXPANDS, so the marker carries the concrete
        root and the exact match can never pair it with the template candidate —
        the placement hit is skipped and resolution falls through to detection.
        Same pattern in routes.js /niubash/status. Cannot be confirmed offline
        (needs a real cmd), reported to the implementer with this suite.`)

rmSync(sandbox, { recursive: true, force: true })

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
