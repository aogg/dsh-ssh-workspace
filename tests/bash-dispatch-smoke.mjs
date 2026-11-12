/**
 * The win-bash dispatch, end to end over doubles: which probes fire, what the
 * login shell actually receives, and what a POSIX script rides on.
 *
 * The regression this suite exists for is f698ae0: an unpinned POSIX host was
 * once fed the cmd-syntax bash probe (a syntax error there parsed to zero
 * candidates and flipped the host's dialect to cmd). The gate now is the
 * LOGIN dialect — posix never reaches the bash rungs — and every dispatch
 * site (exec, the subprocess bridge, the shell, the terminal) branches on
 * the verified bash only for a cmd-login host. The contracts pinned here:
 *
 *   1. an unpinned POSIX host pays exactly ONE probe (`echo %COMSPEC%`) and
 *      its execs stay raw — no launcher, no stdin, historical spellings;
 *   2. a pinned win with a verified bash dispatches POSIX: the outer command
 *      is only `"bash" -s` (plus a provisioned payload's PATH prefix), the
 *      caller's command travels over the channel stdin, and a cwd uses the
 *      drive-letter spelling (`/D:/repo` → `D:/repo`);
 *   3. a pinned win WITHOUT bash keeps the historical cmd spellings verbatim
 *      (`cd /d "D:\repo" && …`, no stdin);
 *   4. forgetDialectCaches re-derives on the live connection, and the probe
 *      window shares one in-flight resolution while window execs pass
 *      through raw — nothing deadlocks;
 *   5. the same branch decisions hold for the subprocess bridge, the
 *      persistent shell, the terminal, and the ssh_workspace_bash tool.
 *
 * Needs the peer tree (the subprocess bridge reaches the SFTP primitives);
 * run.mjs supplies the generated stub root.
 *
 * Run: node tests/bash-dispatch-smoke.mjs
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const coreRoot = process.env.DSH_CORE_ROOT
if (!coreRoot) {
  console.log('\n=== bash dispatch smoke ===\n')
  console.log('  SKIP  DSH_CORE_ROOT is not set (the subprocess bridge needs @deepseek-ai/dsh-fs)')
  console.log(`\n=== 0 passed, 0 failed, 1 suite skipped ===`)
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

const { SshWorkspaceEngine } = await import(pathToFileURL(path.join(pluginRoot, 'lib/engine.js')).href)
const { ShellManager } = await import(pathToFileURL(path.join(pluginRoot, 'lib/shell.js')).href)
const { HostConfigStore } = await import(pathToFileURL(path.join(pluginRoot, 'lib/store.js')).href)
const { HostStore } = await import(pathToFileURL(path.join(pluginRoot, 'lib/hosts.js')).href)
const { RemoteTerminalRouter } = await import(pathToFileURL(path.join(pluginRoot, 'lib/patch-terminal.js')).href)
const { installRemoteSubprocess, uninstallRemoteSubprocess } = await import(pathToFileURL(path.join(pluginRoot, 'lib/patch-subprocess.js')).href)
const { workspaceTools } = await import(pathToFileURL(path.join(pluginRoot, 'lib/tools.js')).href)

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

console.log('\n=== bash dispatch smoke ===\n')

// --- shared doubles ---------------------------------------------------------

const BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'
const PINNED = 'D:\\bash\\bash.exe'
const PROV_ROOT = 'C:\\Users\\u\\.dsh-ssh-workspace\\bash\\1.5.0'
const PROV_PATH = `${PROV_ROOT}\\winuxcmd\\usr\\bin\\bash.exe`
const PROVISION_PREFIX = `set "PATH=${PROV_ROOT};${PROV_ROOT}\\winuxcmd\\usr\\bin;%PATH%" & `
const BASH_VERSION = { stdout: 'GNU bash, version 5.2.26(1)-release (x86_64-pc-msys)\r\n', code: 0 }
const provisionedOf = () => ({ path: PROV_PATH, root: PROV_ROOT, version: '1.5.0', sha256: 'a'.repeat(64), provisionedAt: 1_700_000_000_000 })

/**
 * An ssh2 client double whose exec channels answer from a script of steps.
 * Every call is recorded with the bytes written to the channel, so the
 * bash-stdin contracts are asserted on what the LOGIN shell actually saw.
 * A step may carry `delayMs` to hold its answer open (probe windows).
 */
function scriptedClient (steps) {
  const calls = []
  const client = {
    exec (command, options, callback) {
      calls.push({ command, options, writes: [], ended: false })
      const call = calls[calls.length - 1]
      const step = steps.shift()
      if (step === undefined) throw new Error(`unexpected exec: ${command}`)
      const settle = () => {
        const stream = {
          stderr: { on () {} },
          on (event, handler) {
            if (event === 'data' && step.stdout !== undefined && step.stdout !== '') handler(Buffer.from(step.stdout))
            else if (event === 'close') handler(step.code ?? 0)
          },
          write (data) { call.writes.push(Buffer.isBuffer(data) ? data.toString('utf8') : String(data)) },
          end () { call.ended = true },
          signal () {},
          close () {},
        }
        callback(undefined, stream)
      }
      if (step.delayMs !== undefined && step.delayMs > 0) setTimeout(settle, step.delayMs)
      else settle()
    },
    end () {},
  }
  return { client, calls }
}

/**
 * A real engine over a temp store with one pre-pooled scripted record: the
 * entry's pinned fields (`os`, `bashPath`, `bashProvisioned`) drive the
 * resolution rungs, the steps answer the probes.
 */
async function engineHarness (alias, entryExtra, steps) {
  const home = mkdtempSync(path.join(tmpdir(), 'dsh-bash-dispatch-'))
  const entryStore = new HostConfigStore(path.join(home, 'store.json'))
  entryStore.create({ alias, host: 'h.example', user: 'u', auth: { kind: 'agent' }, ...entryExtra })
  // The provisioned record is written ONLY by the provisioner (mutateHosts),
  // never through create/update — mirror that here.
  if (entryExtra.bashProvisioned !== undefined) {
    entryStore.mutateHosts(entries => entries.map(entry => entry.alias === alias
      ? { ...entry, bashProvisioned: entryExtra.bashProvisioned }
      : entry))
  }
  const engine = new SshWorkspaceEngine({ store: new HostStore(path.join(home, 'ssh-config'), entryStore) })
  const { client, calls } = scriptedClient(steps)
  engine.pool.set(alias, {
    alias,
    client,
    sftp: undefined,
    streamSftp: undefined,
    idleAt: Date.now(),
    inFlight: 0,
    holds: 0,
    broken: false,
    agentForward: false,
    dialect: undefined,
    loginDialect: undefined,
    bash: undefined,
    resolvingBash: false,
  })
  return {
    engine,
    calls,
    record: engine.pool.get(alias),
    cleanup: () => { engine.dispose(); rmSync(home, { recursive: true, force: true }) },
  }
}

// ---------------------------------------------------------------------------
console.log('[engine: an unpinned POSIX host keeps its dialect and its raw execs]')
// f698ae0: the bash resolution used to run for every host and its cmd-syntax
// probe reached POSIX shells, where it parsed to nothing and misread the
// host as cmd. The login-dialect gate ends the resolution before any probe.

{
  const { engine, calls, cleanup } = await engineHarness('unpinned-posix', {}, [
    { stdout: '%COMSPEC%\r\n', code: 0 }, // the login probe, answered literally → posix
    { stdout: 'hi\n', code: 0 },
    { stdout: 'hi\n', code: 0 },
  ])
  try {
    check('an unpinned POSIX login shell answers posix', await engine.remoteDialect('unpinned-posix') === 'posix')
    check('the ONLY probe is the %COMSPEC% login probe',
      calls.length === 1 && calls[0].command === 'echo %COMSPEC%', JSON.stringify(calls.map(call => call.command)))
    check('no cmd-syntax probe (if exist / where bash) reaches a POSIX login shell',
      calls.every(call => !call.command.includes('if exist') && !call.command.includes('where bash')),
      JSON.stringify(calls.map(call => call.command)))

    const outcome = await engine.exec('unpinned-posix', 'echo hi')
    check('the exec rides the login shell raw: no bash launcher',
      calls[1].command === 'echo hi', JSON.stringify(calls.map(call => call.command)))
    check('the raw exec writes no stdin (the historical shape)',
      calls[1].writes.length === 0 && !calls[1].ended)
    check('the command completed', outcome.success === true && outcome.stdout === 'hi\n', JSON.stringify(outcome))

    await engine.exec('unpinned-posix', 'echo hi', { cwd: '/home/repo' })
    check('a cwd keeps the POSIX spelling on a POSIX host',
      calls[2].command === `cd '/home/repo' && echo hi`, calls[2].command)
    check('a settled posix answer never re-probes on later execs', calls.length === 3, String(calls.length))
  } finally { cleanup() }
}

// ---------------------------------------------------------------------------
console.log('\n[engine: a pinned win dispatches POSIX through its verified bash]')

{
  // Detected rung: the sweep names Git Bash, the candidate proves itself,
  // and every later command dispatches through it.
  const { engine, calls, cleanup } = await engineHarness('pinnedwin', { os: 'win' }, [
    { stdout: `@@${BASH}\r\n`, code: 0 },
    BASH_VERSION,
    { stdout: 'hi\n', code: 0 },
    { stdout: 'hi\n', code: 0 },
  ])
  try {
    check('a pinned win with a verified bash answers posix', await engine.remoteDialect('pinnedwin') === 'posix')
    check('the cost was one sweep plus one --version (still no %COMSPEC% for a pinned win)',
      calls.length === 2 && calls[0].command.includes('if exist') && calls[1].command === `"${BASH}" --version`,
      JSON.stringify(calls.map(call => call.command)))

    const outcome = await engine.exec('pinnedwin', 'echo hi')
    check('the outer command is EXACTLY the bash launcher',
      calls[2].command === `"${BASH}" -s`, JSON.stringify(calls.map(call => call.command)))
    check('the caller command reached bash over the channel stdin, and the stdin side ended',
      calls[2].writes.join('') === 'echo hi\n' && calls[2].ended === true, JSON.stringify(calls[2]))
    check('the command completed through the launcher', outcome.success === true && outcome.stdout === 'hi\n', JSON.stringify(outcome))

    await engine.exec('pinnedwin', 'echo hi', { cwd: '/D:/repo' })
    check('a cwd rides the stdin script in the drive-letter spelling bash resolves',
      calls[3].writes.join('') === `cd 'D:/repo' && echo hi\n`, JSON.stringify(calls[3].writes))
    check('the cmd side carries no cd prefix when bash dispatches',
      calls[3].command === `"${BASH}" -s`, calls[3].command)
    const bash = await engine.remoteBash('pinnedwin')
    check('the verified answer is cached with its source', bash?.path === BASH && bash?.source === 'detected', JSON.stringify(bash))
  } finally { cleanup() }
}

{
  // Provisioned rung: the payload's PATH prefix rides the launcher line so
  // the shim finds its engine (and the payload's git/rg join the PATH).
  const { engine, calls, cleanup } = await engineHarness('provwin', { os: 'win', bashProvisioned: provisionedOf() }, [
    BASH_VERSION,
    { stdout: 'hi\n', code: 0 },
  ])
  try {
    await engine.exec('provwin', 'echo hi')
    check('the provisioned rung verifies with the payload PATH prefix in front',
      calls[0].command === `${PROVISION_PREFIX}"${PROV_PATH}" --version`, calls[0].command)
    check('the dispatch outer carries the prefix before the launcher',
      calls[1].command === `${PROVISION_PREFIX}"${PROV_PATH}" -s`, calls[1].command)
    check('the resolution reports its source', (await engine.remoteBash('provwin'))?.source === 'provisioned')
  } finally { cleanup() }
}

{
  // Pinned rung: the owner's word counts, after one live verification.
  const { engine, calls, cleanup } = await engineHarness('pinwin', { os: 'win', bashPath: PINNED }, [
    BASH_VERSION,
    { stdout: 'hi\n', code: 0 },
  ])
  try {
    await engine.exec('pinwin', 'echo hi')
    check('a pinned bashPath verifies before dispatching',
      calls[0].command === `"${PINNED}" --version`, calls[0].command)
    check('the dispatch goes through the pinned executable',
      calls[1].command === `"${PINNED}" -s` && calls[1].writes.join('') === 'echo hi\n',
      JSON.stringify(calls[1]))
    check('the pinned rung never runs the sweep', calls.length === 2 && !calls.some(call => call.command.includes('where bash')))
  } finally { cleanup() }
}

{
  // Degrade: a stale pin falls to the provisioned copy with a diagnostics
  // entry — it must not turn every command into a hard error.
  const { engine, calls, cleanup } = await engineHarness('stalewin', { os: 'win', bashPath: 'C:\\dead\\bash.exe', bashProvisioned: provisionedOf() }, [
    { stdout: '', success: false, exitCode: 1 },
    BASH_VERSION,
    { stdout: 'hi\n', code: 0 },
  ])
  try {
    await engine.exec('stalewin', 'echo hi')
    check('a stale pin is verified first and fails',
      calls[0].command === '"C:\\dead\\bash.exe" --version' && calls[0].writes.length === 0, calls[0].command)
    check('the dispatch degrades to the provisioned launcher (prefix included)',
      calls[2].command === `${PROVISION_PREFIX}"${PROV_PATH}" -s`, calls[2].command)
    check('the degrade is recorded, not thrown',
      engine.diagnostics.entries.some(entry => entry.kind === 'degraded' && entry.message.includes('pinned bashPath did not verify')),
      JSON.stringify(engine.diagnostics.entries.map(entry => entry.message)))
  } finally { cleanup() }
}

// ---------------------------------------------------------------------------
console.log('\n[engine: a pinned win WITHOUT bash keeps the historical cmd spellings]')

{
  const { engine, calls, cleanup } = await engineHarness('nodbashwin', { os: 'win' }, [
    { stdout: '', code: 0 }, // the sweep answers nothing
    { stdout: 'hi\n', code: 0 },
    { stdout: 'hi\n', code: 0 },
  ])
  try {
    check('no bash on a pinned win answers cmd', await engine.remoteDialect('nodbashwin') === 'cmd')
    await engine.exec('nodbashwin', 'echo hi')
    check('the exec is the bare command line (verbatim historical shape)',
      calls[1].command === 'echo hi', JSON.stringify(calls.map(call => call.command)))
    check('the cmd fallback writes no stdin', calls[1].writes.length === 0 && !calls[1].ended)
    await engine.exec('nodbashwin', 'echo hi', { cwd: '/D:/repo' })
    check('a cwd crosses drives with the verbatim `cd /d` spelling',
      calls[2].command === 'cd /d "D:\\repo" && echo hi', calls[2].command)
    check('still no stdin on the cwd exec', calls[2].writes.length === 0)
    check('the negative answer is cached (the sweep ran once)',
      await engine.remoteDialect('nodbashwin') === 'cmd' && calls.length === 3, String(calls.length))
  } finally { cleanup() }
}

// ---------------------------------------------------------------------------
console.log('\n[engine: forgetDialectCaches re-derives on the live connection]')

{
  const { engine, calls, cleanup, record } = await engineHarness('forgetwin', { os: 'win', bashPath: PINNED }, [
    BASH_VERSION,
    { stdout: 'hi\n', code: 0 },
    BASH_VERSION,
    { stdout: 'again\n', code: 0 },
  ])
  try {
    await engine.exec('forgetwin', 'echo hi')
    engine.forgetDialectCaches('forgetwin')
    check('the cache reset keeps the connection (and its channels) alive',
      engine.pool.get('forgetwin') === record, 'the pooled record was replaced')
    await engine.exec('forgetwin', 'echo again')
    check('the next exec re-verifies the pinned bash before dispatching',
      calls[2].command === `"${PINNED}" --version` && calls[3].command === `"${PINNED}" -s`,
      JSON.stringify(calls.map(call => call.command)))
    check('the re-derived dispatch still rides stdin', calls[3].writes.join('') === 'echo again\n')
  } finally { cleanup() }
}

// ---------------------------------------------------------------------------
console.log('\n[engine: the probe window — shared in-flight, raw passthrough, no deadlock]')

{
  const { engine, calls, cleanup } = await engineHarness('windowwin', { os: 'win', bashPath: PINNED }, [
    { ...BASH_VERSION, delayMs: 30 }, // hold the verification open: the window
    { stdout: 'raw\n', code: 0 },     // a window exec
    BASH_VERSION,                     // the re-resolution's verification
    { stdout: 'ok\n', code: 0 },      // concurrent exec a
    { stdout: 'ok\n', code: 0 },      // concurrent exec b
  ])
  try {
    const pending = engine.remoteBash('windowwin')
    await sleep(5) // enter the window: the resolution is in flight, the cache unset
    const windowOutcome = await engine.exec('windowwin', 'echo raw')
    check('an exec inside the probe window passes through RAW (no launcher, no stdin)',
      calls[1].command === 'echo raw' && calls[1].writes.length === 0,
      JSON.stringify(calls.map(call => call.command)))
    check('the window exec completes instead of deadlocking', windowOutcome.stdout === 'raw\n', JSON.stringify(windowOutcome))
    const bash = await pending
    check('the shared resolution settles with the verified bash', bash?.path === PINNED, JSON.stringify(bash))
    check('exactly one verification so far', calls.filter(call => call.command.includes('--version')).length === 1)

    engine.forgetDialectCaches('windowwin')
    const [a, b] = await Promise.all([engine.exec('windowwin', 'echo a'), engine.exec('windowwin', 'echo b')])
    check('concurrent dispatchers share ONE re-resolution (verified once more, not twice)',
      calls.filter(call => call.command.includes('--version')).length === 2,
      JSON.stringify(calls.map(call => call.command)))
    check('both concurrent commands dispatched through the launcher',
      calls.at(-2).command === `"${PINNED}" -s` && calls.at(-1).command === `"${PINNED}" -s`,
      JSON.stringify(calls.slice(-2).map(call => call.command)))
    check('both concurrent commands completed', a.stdout === 'ok\n' && b.stdout === 'ok\n', JSON.stringify([a.stdout, b.stdout]))
  } finally { cleanup() }
}

// ---------------------------------------------------------------------------
console.log('\n[engine: probeCapabilities follows the dispatched dialect]')

{
  const { engine, calls, cleanup } = await engineHarness('capwin', { os: 'win', bashPath: PINNED }, [
    BASH_VERSION,
    { stdout: 'git\ndsh-probe-done\n', code: 0 },
  ])
  try {
    const result = await engine.probeCapabilities('capwin')
    check('on a bash host the probe itself dispatches through the launcher',
      calls[1].command === `"${PINNED}" -s`, calls[1].command)
    check('a win host WITH bash probes capabilities in POSIX syntax (on the channel stdin)',
      calls[1].writes.join('').includes('command -v rg') && !calls[1].writes.join('').includes('where rg'),
      JSON.stringify(calls[1].writes))
    check('the capabilities read back truthfully', result.rg === false && result.git === true && result.inotifywait === false, JSON.stringify(result))
  } finally { cleanup() }
}

// ---------------------------------------------------------------------------
console.log('\n[patch-subprocess: the win-bash branch feeds the POSIX script over stdin]')
//
// The same seam dialect-smoke drives, plus the bash arms. `remoteSpawnSpec`
// builds a real RemoteSubprocessRouter over a double engine and returns what
// the login shell received (outer command + stdin bytes), with an order log
// so staging-before-exec is provable.

function stagingSftp (log) {
  return {
    open (target, _flags, modeOrCallback, maybeCallback) {
      const callback = typeof modeOrCallback === 'function' ? modeOrCallback : maybeCallback
      log.opens.push(target)
      callback(undefined, { handle: 'h1' })
    },
    write (_handle, buffer, offset, length, _position, callback) {
      log.payloadWrites.push(buffer.subarray(offset, offset + length).toString('utf8'))
      callback(null)
    },
    close (_handle, callback) { callback(null) },
    unlink (target, callback) { log.unlinks.push(target); callback(null) },
  }
}

async function remoteSpawnSpec ({ bash, dialect = 'posix', cwd, argv, stdin }) {
  const log = { order: [], opens: [], payloadWrites: [], unlinks: [] }
  const calls = []
  const client = {
    exec (command, options, callback) {
      log.order.push('exec')
      const call = { command, writes: [], ended: false }
      calls.push(call)
      const stream = {
        stderr: { on () {} },
        on (event, handler) { if (event === 'close') handler(0) },
        write (data) { call.writes.push(Buffer.isBuffer(data) ? data.toString('utf8') : String(data)) },
        end () { call.ended = true },
        signal () {},
        close () {},
      }
      callback(undefined, stream)
    },
    end () {},
  }
  const record = {
    alias: 'winhost', client, sftp: undefined, streamSftp: undefined,
    idleAt: Date.now(), inFlight: 0, holds: 0, broken: false, agentForward: false,
  }
  const engine = {
    assertNotDisabled () {},
    async acquire () { return record },
    closeRecord () {},
    remoteDialect: async () => dialect,
    ...(bash === undefined ? {} : { remoteBash: async () => bash }),
    async withSftp (_alias, operation) { log.order.push('stage'); return operation(stagingSftp(log)) },
  }
  const service = { spawn () { throw new Error('the local spawn must not run for a remote cwd') } }
  const ctx = { get: name => name === 'subprocess' ? service : undefined }
  const router = installRemoteSubprocess(ctx, { engine })
  try {
    const handle = service.spawn({
      argv,
      cwd,
      graceMs: 500,
      env: { GIT_AUTHOR_NAME: 'dsh-test' },
      ...(stdin === undefined ? {} : { stdio: { stdin } }),
    })
    const outcome = await handle.done
    if (outcome.exitCode !== 0) throw new Error(`the remote run did not settle cleanly: ${JSON.stringify(outcome)}`)
    await sleep(5) // the staged payload's best-effort unlink rides release()
    return { calls, log }
  } finally {
    uninstallRemoteSubprocess(service)
  }
}

{
  const { calls, log } = await remoteSpawnSpec({
    bash: { path: BASH, source: 'detected' },
    cwd: 'ssh://winhost/D:/repo',
    argv: ['/opt/tools/bin/git', 'status', '--short'],
  })
  check('the outer command handed to cmd is only the bash launcher',
    calls[0].command === `"${BASH}" -s`, calls[0].command)
  check('the POSIX script traveled over the channel stdin (one write, then end)',
    calls[0].writes.length === 1 && calls[0].ended === true, JSON.stringify(calls[0]))
  const script = calls[0].writes[0]
  check('the inner script is the POSIX spelling (export prelude, no cmd set)',
    script.includes('export PATH=') && script.includes(`export GIT_AUTHOR_NAME='dsh-test'`) && !script.includes('set "PATH='), script)
  check('the inner script cds into the drive-letter spelling bash resolves',
    script.includes(`cd 'D:/repo'`), script)
  check('the inner script checks presence with command -v and execs git',
    script.includes(`command -v 'git'`) && script.includes(`exec 'git' 'status' '--short'`), script)
  check('no stdin payload was staged for a payloadless spec',
    log.order.filter(entry => entry === 'stage').length === 0 && log.opens.length === 0, JSON.stringify(log))
}

{
  const { calls, log } = await remoteSpawnSpec({
    bash: { path: BASH, source: 'detected', prefix: PROVISION_PREFIX },
    cwd: 'ssh://winhost/D:/repo',
    argv: ['/opt/tools/bin/rg', 'pattern', '.'],
    stdin: { data: 'stdin-payload-bytes' },
  })
  check('a payload cannot share the channel: the launcher line carries the payload prefix',
    calls[0].command === `${PROVISION_PREFIX}"${BASH}" -s`, calls[0].command)
  check('the stdin payload is staged over SFTP BEFORE the exec channel opens',
    log.order[0] === 'stage' && log.order[1] === 'exec' && log.opens.length === 1, JSON.stringify(log.order))
  check('the payload bytes reach the staged file verbatim',
    log.payloadWrites.join('') === 'stdin-payload-bytes', JSON.stringify(log.payloadWrites))
  const script = calls[0].writes[0]
  check('the inner script redirects the command from the staged file',
    script.includes(`exec 'rg' 'pattern' '.' < '/tmp/dsh-ws-stdin-`), script)
  check('the staged file is cleaned up after settle',
    log.unlinks.length === 1 && log.unlinks[0].startsWith('/tmp/dsh-ws-stdin-'), JSON.stringify(log.unlinks))
}

{
  // The fallback arm: a cmd host WITHOUT bash keeps the historical script,
  // character for character where it matters.
  const { calls } = await remoteSpawnSpec({
    bash: undefined,
    dialect: 'cmd',
    cwd: 'ssh://winhost/D:/repo',
    argv: ['/opt/tools/bin/git', 'status', '--short'],
  })
  const script = calls[0].command
  check('the cmd fallback re-exports PATH with set', script.includes('set "PATH='), script)
  check('the cmd fallback crosses drives with cd /d', script.includes('cd /d "D:\\repo"'), script)
  check('the cmd fallback checks presence with where and exits 127 when missing',
    script.includes('where git') && script.includes('exit 127'), script)
  check('the cmd fallback carries the env with set and never export',
    script.includes('set "GIT_AUTHOR_NAME=dsh-test"') && !script.includes('export '), script)
  check('the cmd fallback rides the command line (no stdin, no -s launcher)',
    calls[0].writes.length === 0 && !script.endsWith('-s'), JSON.stringify(calls[0]))
}

{
  // And a POSIX-dialect host without a bash double keeps the plain POSIX
  // script — the dispatch condition must not confuse "no bash" with cmd.
  const { calls } = await remoteSpawnSpec({
    bash: undefined,
    dialect: 'posix',
    cwd: 'ssh://linhost/home/repo',
    argv: ['/opt/tools/bin/git', 'status', '--short'],
  })
  const script = calls[0].command
  check('a POSIX host without a bash keeps the login-shell POSIX script (not a launcher)',
    script.startsWith('export ') && script.includes(`cd '/home/repo'`), script)
}

// ---------------------------------------------------------------------------
console.log('\n[shell: a win host with bash starts THAT bash directly]')

/** A PTY channel double that answers the marker the shell manager appends. */
function markerChannel (results = {}) {
  const handlers = new Map()
  const scripts = []
  const channel = {
    stderr: { on () {} },
    on (event, handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]) },
    once (event, handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]) },
    emit (event, value) { for (const handler of handlers.get(event) ?? []) handler(value) },
    write (script) {
      scripts.push(script)
      const marker = /__DSH_WS_[\w]+__/u.exec(script)?.[0]
      if (marker === undefined) return
      const command = script.split('\n')[0]
      const outcome = results[command] ?? { output: '', code: 0 }
      setTimeout(() => {
        channel.emit('data', Buffer.from(`${command}\r\n`))
        if (outcome.output !== '') channel.emit('data', Buffer.from(`${outcome.output}\r\n`))
        channel.emit('data', Buffer.from(`\r\n${marker}${outcome.code}${marker}\r\n`))
      }, 0)
    },
    close () { channel.emit('close') },
  }
  return { channel, scripts }
}

{
  const prepared = markerChannel({ 'echo hi': { output: 'hi', code: 0 } })
  const opened = []
  const engine = {
    remoteDialect: async () => 'posix',
    remoteBash: async () => ({ path: BASH, source: 'detected' }),
    async openChannel (_alias, command, options) {
      opened.push({ command, options })
      return { channel: prepared.channel, release: () => {} }
    },
  }
  const shells = new ShellManager({ engine })
  const result = await shells.run('w', 'echo hi')
  check('the win-bash session opens exactly `<bash> --noprofile --norc`',
    opened[0].command === `"${BASH}" --noprofile --norc`, opened[0].command)
  check('the open requests a PTY', opened[0].options?.pty !== undefined)
  check('the bash session still recovers output and status',
    result.output === 'hi' && result.exitCode === 0, JSON.stringify(result))
}

{
  const prepared = markerChannel({})
  const opened = []
  const engine = {
    remoteDialect: async () => 'posix',
    remoteBash: async () => ({ path: BASH, prefix: PROVISION_PREFIX }),
    async openChannel (_alias, command, options) {
      opened.push({ command, options })
      return { channel: prepared.channel, release: () => {} }
    },
  }
  const shells = new ShellManager({ engine })
  await shells.run('p', 'echo hi', { cwd: '/D:/logs' })
  check('the provisioned prefix rides FIRST, then the cd /d, then the launcher',
    opened[0].command === `${PROVISION_PREFIX}cd /d "D:\\logs" && "${BASH}" --noprofile --norc`, opened[0].command)
}

{
  const prepared = markerChannel({})
  const opened = []
  const engine = {
    remoteDialect: async () => 'posix',
    async openChannel (_alias, command, options) {
      opened.push({ command, options })
      return { channel: prepared.channel, release: () => {} }
    },
  }
  const shells = new ShellManager({ engine })
  await shells.run('lin', 'echo hi')
  check('a POSIX-dialect host without a bash keeps the login sh (no launcher, no --noprofile)',
    opened[0].command.startsWith('sh -l'), opened[0].command)
  // The cmd.exe fallback spellings (`cmd.exe`, `cmd.exe /k cd /d "D:\…"`)
  // are pinned verbatim by dialect-smoke's shell section; not repeated here.
}

// ---------------------------------------------------------------------------
console.log('\n[terminal: a win host with bash opens THAT bash with cd /d first]')

{
  const opened = []
  const engine = {
    assertNotDisabled () {},
    remoteDialect: async () => 'posix',
    remoteBash: async () => ({ path: BASH, source: 'detected' }),
    async openChannel (_alias, command, options) {
      opened.push({ command, options })
      const channel = {
        stderr: { on () {} },
        on () {}, once () {}, write () {}, end () {}, setWindow () {}, close () {},
      }
      return { channel, release: () => {} }
    },
  }
  const router = new RemoteTerminalRouter({ engine })
  await router.spawnTerminal({ cwd: 'ssh://winbox/D:/logs', argv: ['pwsh'], rows: 24, cols: 80 })
  check('the terminal opens `cd /d` into the drive path, then the bash launcher',
    opened[0].command === `cd /d "D:\\logs" && "${BASH}" --noprofile --norc`, opened[0].command)
  check('the bash terminal requests a PTY with the spec geometry',
    opened[0].options?.pty?.cols === 80 && opened[0].options?.pty?.rows === 24, JSON.stringify(opened[0].options?.pty))

  const root = new RemoteTerminalRouter({ engine })
  const rootOpens = []
  root.engine = { ...engine, async openChannel (_alias, command, options) { rootOpens.push({ command, options }); const channel = { stderr: { on () {} }, on () {}, once () {}, write () {}, end () {}, setWindow () {}, close () {} }; return { channel, release: () => {} } } }
  await root.spawnTerminal({ cwd: 'ssh://winbox/', argv: ['pwsh'], rows: 24, cols: 80 })
  check('a root cwd skips the cd and starts the bash directly',
    rootOpens[0].command === `"${BASH}" --noprofile --norc`, rootOpens[0].command)
  // The cmd.exe fallback (`cmd.exe /k cd /d "D:\…"`) is pinned verbatim by
  // terminal-smoke's cmd section; not repeated here.
}

// ---------------------------------------------------------------------------
console.log('\n[tools: ssh_workspace_bash detect / provision]')

{
  // detect: the bash resolution + dialect, verbatim into the output shape.
  const ctx = { get: () => ({ resolve: () => ({ mode: 'danger-full-access', workspaceRoot: '/local' }) }) }
  const toolOf = engine => workspaceTools(ctx, engine, undefined, { list: () => [] }, { list: () => [] })
    .find(candidate => candidate.name === 'ssh_workspace_bash')
  const tool = toolOf({
    remoteBash: async () => ({ path: BASH, source: 'pinned', version: 'GNU bash, version 5.2.26(1)-release' }),
    remoteDialect: async () => 'posix',
  })
  const result = await tool.execute({ alias: 'w', action: 'detect' }, { agent: { session: { id: 's1' } } })
  check('detect reports the verified bash with its source and version',
    result.ok === true && result.action === 'detect' && result.dialect === 'posix'
    && result.bash?.path === BASH && result.bash?.source === 'pinned' && result.bash?.version?.startsWith('GNU bash'),
    JSON.stringify(result))
  check('the schema pins the closed action enum (required)',
    JSON.stringify(tool.parameters.action.enum) === JSON.stringify(['detect', 'provision']) && tool.parameters.action.required === true,
    JSON.stringify(tool.parameters.action))
  check('the output schema carries the bash shape (source = the three rungs)',
    JSON.stringify(tool.output.schema.properties.bash.properties.source.enum) === JSON.stringify(['pinned', 'provisioned', 'detected'])
    && tool.output.schema.properties.provisioned.properties.reused.type === 'boolean',
    JSON.stringify(tool.output.schema.properties))

  const noneTool = toolOf({
    remoteBash: async () => undefined,
    remoteDialect: async () => 'cmd',
  })
  const none = await noneTool.execute({ alias: 'w', action: 'detect' }, { agent: { session: { id: 's1' } } })
  check('detect on a bash-less host answers cmd without a bash key', none.ok === true && none.dialect === 'cmd' && !('bash' in none), JSON.stringify(none))
  /** The render helper returns one content block; read its text. */
  const renderText = value => tool.output.render({}, value)[0]?.text ?? ''
  check('the render tells the agent what to do next (provision, cmd syntax)',
    renderText({ ok: true, action: 'detect', alias: 'w', dialect: 'cmd' }).includes('cmd.exe')
    && renderText({ ok: true, action: 'detect', alias: 'w', dialect: 'cmd' }).includes('provision'))
  check('the render spells out a fresh deployment',
    renderText({ ok: true, action: 'provision', alias: 'w', dialect: 'posix', provisioned: { reused: false, path: PROV_PATH, root: PROV_ROOT, version: '1.5.0', files: 3, bytes: 42, verify: 'GNU bash' } }).includes('deployed'))
}

{
  // provision: the real provisionWinBash runs behind the tool; its first
  // gate (a non-cmd login shell) must surface as a failed tool answer.
  const engine = {
    async loginDialect () { return 'posix' },
    store: { entry: () => undefined },
  }
  const ctx = { get: () => ({ resolve: () => ({ mode: 'danger-full-access', workspaceRoot: '/local' }) }) }
  const tool = workspaceTools(ctx, engine, undefined, { list: () => [] }, { list: () => [] }).find(candidate => candidate.name === 'ssh_workspace_bash')
  const refused = await tool.execute({ alias: 'posixbox', action: 'provision' }, { agent: { session: { id: 's1' } } })
  check('provisioning a POSIX host fails with the dialect gate wording',
    refused.ok === false && refused.action === 'provision' && refused.error?.includes('does not have a cmd.exe login shell'), JSON.stringify(refused))
}

{
  // The remote-command gate: read-only refuses BOTH actions before any probe.
  const engine = {
    async loginDialect () { throw new Error('must not be reached') },
    remoteBash: async () => { throw new Error('must not be reached') },
    remoteDialect: async () => { throw new Error('must not be reached') },
    store: { entry: () => undefined },
  }
  const ctx = { get: () => ({ resolve: () => ({ mode: 'read-only', workspaceRoot: '/local' }) }) }
  const tool = workspaceTools(ctx, engine, undefined, { list: () => [] }, { list: () => [] }).find(candidate => candidate.name === 'ssh_workspace_bash')
  const detect = await tool.execute({ alias: 'w', action: 'detect' }, { agent: { session: { id: 's1' } } })
  const provision = await tool.execute({ alias: 'w', action: 'provision' }, { agent: { session: { id: 's1' } } })
  check('read-only refuses detect (a probe still executes remotely)',
    detect.ok === false && detect.error !== undefined && detect.error.includes('read-only'), JSON.stringify(detect))
  check('read-only refuses provision before anything touches the host',
    provision.ok === false && provision.error.includes('read-only'), JSON.stringify(provision))
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
