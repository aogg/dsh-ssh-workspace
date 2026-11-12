/**
 * Dialect-dispatch and exec-option checks against in-memory doubles.
 *
 * Three seams whose regressions fail loudly in production but quietly in a
 * code review:
 *
 * 1. **The exec options bag** (737b096). `runRemoteCommand` hands ssh2's
 *    `client.exec` its options; ssh2 reads `opts.allowHalfOpen`
 *    unconditionally, so the non-forwarding arm MUST pass an object — an
 *    `undefined` there crashed every exec on every host. The double below
 *    destructures the bag exactly like real ssh2, so the historical bug
 *    reproduces as a TypeError instead of a silent pass.
 *
 * 2. **The login-shell dialect probe** (dd75ab6). `remoteDialect` asks the
 *    login shell to expand `%COMSPEC%`: cmd answers with a Windows path, a
 *    POSIX shell (or PowerShell) echoes the literal text, and every failure
 *    shape degrades to `posix`. The answer is cached on the pooled record —
 *    one probe per connection, a reconnect re-probes.
 *
 * 3. **The per-dialect command spellings** (dd75ab6): the subprocess script
 *    builder (`set "PATH=` / `cd /d` / `where` / `exit 127`, never `export`),
 *    the shell manager (`cmd.exe /k cd /d`, `%ERRORLEVEL%` on its own marker
 *    line), and the capability probe (`where` on cmd hosts, `command -v` on
 *    POSIX ones).
 *
 * 4. **The win-bash resolution probes** (2107b81, cd212c3): the login-shell
 *    fact gates everything, so a POSIX-login host pays exactly ONE probe
 *    (`%COMSPEC%`) and never sees the cmd-syntax bash sweeps, while a
 *    cmd-login host pays TWO bash-candidate probes before its command
 *    dialect settles — first the niubash three-level placement sweep
 *    (`manifest.json` + `bash.exe` per default placement), then the
 *    well-known locations + `where bash`. Every scripted step list below
 *    spells those probes out, so a silent change in the probe order breaks
 *    loudly here.
 *
 * Run: node tests/dialect-smoke.mjs
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// patch-subprocess.js reaches the shared SFTP primitives, which resolve the
// DSH peer packages; without an assembled (or generated stub) tree there is
// nothing to resolve against and the import below would crash the suite. The
// engine/shell halves stay peer-free, but the suite imports them together.
const coreRoot = process.env.DSH_CORE_ROOT
if (!coreRoot) {
  console.log('\n=== dialect smoke ===\n')
  console.log('  SKIP  DSH_CORE_ROOT is not set (patch-subprocess.js needs @deepseek-ai/dsh-fs)')
  console.log('\n=== 0 passed, 0 failed, 1 suite skipped ===')
  process.exit(0)
}
process.env.DSH_PEER_ROOT = [coreRoot, process.env.DSH_PEER_ROOT].filter(Boolean).join(path.delimiter)

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { SshWorkspaceEngine } = await import(pathToFileURL(path.join(pluginRoot, 'lib/engine.js')).href)
const { ShellManager } = await import(pathToFileURL(path.join(pluginRoot, 'lib/shell.js')).href)
const { installRemoteSubprocess, uninstallRemoteSubprocess } = await import(pathToFileURL(path.join(pluginRoot, 'lib/patch-subprocess.js')).href)
const { HostConfigStore } = await import(pathToFileURL(path.join(pluginRoot, 'lib/store.js')).href)
const { HostStore } = await import(pathToFileURL(path.join(pluginRoot, 'lib/hosts.js')).href)

// A hermetic host store: `remoteDialect` consults the entry's pinned `os`
// before probing, and the DEFAULT store would read the developer's real
// dsh-ssh.json — a test alias colliding with a real pinned host (e.g. a
// live `win` entry) would skip the probe and fail these tests for the wrong
// reason. Empty store ⇒ every alias here takes the probe path.
const storeHome = mkdtempSync(path.join(tmpdir(), 'dsh-dialect-store-'))
const HERMETIC_STORE = new HostStore(path.join(storeHome, 'ssh-config'), new HostConfigStore(path.join(storeHome, 'store.json')))

let passed = 0
let failures = 0
function check (label, ok, detail) {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`) } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/**
 * An ssh2 client double whose exec channels answer from a script of steps.
 *
 * Each step is `{ stdout, code }` (the channel emits the text, then closes
 * with that status), `{ error }` (the open itself fails), or `{ throws }`
 * (client.exec throws synchronously, like ssh2 does on a dead client). The
 * 737b096 regression is encoded at the top: real ssh2 dereferences the
 * options bag unconditionally, so a `undefined` bag dies right here.
 */
function execScriptedClient (steps) {
  const calls = []
  const client = {
    exec (command, options, callback) {
      const { allowHalfOpen } = options
      void allowHalfOpen
      calls.push({ command, options })
      const step = steps.shift()
      if (step === undefined) throw new Error(`unexpected exec: ${command}`)
      if (step.throws === true) throw new Error(step.message ?? 'exec channel is broken')
      if (step.error !== undefined) {
        callback(new Error(step.error))
        return
      }
      const stream = {
        stderr: { on () {} },
        on (event, handler) {
          if (event === 'data' && step.stdout !== undefined && step.stdout !== '') handler(Buffer.from(step.stdout))
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
  return { client, calls }
}

/** A pooled-record shape the engine accepts without a real connection. */
function pooledRecord (alias, client, extra = {}) {
  return {
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
    ...extra,
  }
}

/** An engine with one pre-pooled record served by a scripted ssh2 client. */
function dialectHarness (alias, steps, extra = {}) {
  const engine = new SshWorkspaceEngine({ store: HERMETIC_STORE })
  const { client, calls } = execScriptedClient(steps)
  const record = pooledRecord(alias, client, extra)
  engine.pool.set(alias, record)
  return { engine, calls, record }
}

console.log('\n=== dialect smoke ===\n')

// --- 737b096: the exec options bag is always an object ----------------------
{
  // An UNPINNED host pays one `echo %COMSPEC%` login probe before its first
  // command (the login-shell gate of the bash resolution, 2107b81). This
  // scripted answer is a POSIX spelling, so the resolution ends right there —
  // no bash-candidate probe follows, and the command rides the login shell.
  const { engine, calls, record } = dialectHarness('plain', [
    { stdout: 'hi\n', code: 0 },
    { stdout: 'hi\n', code: 0 },
    { stdout: 'hi\n', code: 0 },
  ])
  try {
    const outcome = await engine.exec('plain', 'echo hi')
    check('an unpinned host pays exactly one login probe, then the command reaches the client',
      calls.length === 2 && calls[0].command === 'echo %COMSPEC%' && calls[1].command === 'echo hi',
      JSON.stringify(calls.map(call => call.command)))
    check('a non-forwarding exec passes an EMPTY options object, not undefined',
      calls[1].options !== undefined && typeof calls[1].options === 'object' && JSON.stringify(calls[1].options) === '{}',
      String(calls[1].options))
    check('the command still runs to completion', outcome.success === true && outcome.stdout === 'hi\n', JSON.stringify(outcome))

    record.agentForward = true
    await engine.exec('plain', 'echo hi')
    check('a forwarding exec passes exactly the channel flag',
      JSON.stringify(calls[2].options) === JSON.stringify({ agentForward: true }), JSON.stringify(calls[2].options))
    check('a posix answer short-circuits the bash resolution (no second probe for later execs)',
      calls.length === 3 && !calls.some(call => call.command.includes('if exist')), JSON.stringify(calls.map(call => call.command)))
  } finally {
    engine.dispose()
  }
}

// --- dd75ab6: remoteDialect probes %COMSPEC% and caches the answer ----------
{
  // A cmd answer is no longer final (2107b81): the win-bash resolution sweeps
  // the bash locations with two cmd-syntax probes before the command dialect
  // settles (cd212c3 added the niubash three-level placement sweep in front).
  // The empty answers below mean "no bash anywhere", so the dialect stays the
  // historical cmd.
  const { engine, calls } = dialectHarness('win', [
    { stdout: 'C:\\Windows\\system32\\cmd.exe\r\n', code: 0 },
    { stdout: '', code: 0 },
    { stdout: '', code: 0 },
  ])
  try {
    const dialect = await engine.remoteDialect('win')
    check('an expanded COMSPEC path answers cmd', dialect === 'cmd', dialect)
    check('the probe asks the login shell to expand %COMSPEC%', calls[0]?.command === 'echo %COMSPEC%', calls[0]?.command)
    check('a cmd answer pays two more probes: niubash placements, then the well-known sweep',
      calls.length === 3
      && calls[1].command.includes('.dsh\\runtimes\\plugins') && !calls[1].command.includes('where bash')
      && calls[2].command.includes('if exist') && calls[2].command.includes('where bash'),
      JSON.stringify(calls.map(call => call.command)))
  } finally {
    engine.dispose()
  }
}

{
  const { engine } = dialectHarness('ps', [{ stdout: '%COMSPEC%\r\n', code: 0 }])
  try {
    check('a literal %COMSPEC% echo (POSIX or PowerShell) answers posix',
      await engine.remoteDialect('ps') === 'posix')
  } finally {
    engine.dispose()
  }
}

{
  const { engine } = dialectHarness('broken', [{ error: 'channel open failed' }])
  try {
    check('a failed probe exec degrades to posix', await engine.remoteDialect('broken') === 'posix')
  } finally {
    engine.dispose()
  }
}

{
  const { engine } = dialectHarness('dead', [{ throws: true }])
  try {
    check('a synchronously throwing exec degrades to posix', await engine.remoteDialect('dead') === 'posix')
  } finally {
    engine.dispose()
  }
}

{
  const { engine, calls } = dialectHarness('cached', [
    { stdout: 'C:\\Windows\\system32\\cmd.exe\r\n', code: 0 },
    { stdout: '', code: 0 },
    { stdout: '', code: 0 },
  ])
  try {
    const first = await engine.remoteDialect('cached')
    const second = await engine.remoteDialect('cached')
    check('a second call on the same connection answers from the cache', first === 'cmd' && second === 'cmd',
      `${first}/${second}`)
    check('the whole dialect costs exactly three probes: login, niubash placements, then the sweep',
      calls.length === 3 && calls[0].command === 'echo %COMSPEC%' && calls[2].command.includes('where bash'),
      JSON.stringify(calls.map(call => call.command)))
  } finally {
    engine.dispose()
  }
}

{
  // The answer dies with the record: close it, pool a fresh record whose
  // login shell answers literally, and the next call must re-probe (and
  // believe the NEW answer). The posix side of the reconnect is the
  // f698ae0 contract at the dialect level: a posix login shell pays ONLY the
  // login probe — the cmd-syntax bash sweep must never reach it.
  const engine = new SshWorkspaceEngine({ store: HERMETIC_STORE })
  try {
    const first = execScriptedClient([
      { stdout: 'C:\\Windows\\system32\\cmd.exe\r\n', code: 0 },
      { stdout: '', code: 0 },
      { stdout: '', code: 0 },
    ])
    engine.pool.set('rehomed', pooledRecord('rehomed', first.client))
    check('the first connection answers cmd from its probes',
      await engine.remoteDialect('rehomed') === 'cmd' && first.calls.length === 3)
    engine.closeRecord('rehomed', engine.pool.get('rehomed'))
    const reconnected = execScriptedClient([{ stdout: '%COMSPEC%\r\n', code: 0 }])
    engine.pool.set('rehomed', pooledRecord('rehomed', reconnected.client))
    const dialect = await engine.remoteDialect('rehomed')
    check('a reconnect probes again instead of trusting the old record',
      dialect === 'posix' && reconnected.calls.length === 1 && first.calls.length === 3,
      `dialect=${dialect} firstProbes=${first.calls.length} newProbes=${reconnected.calls.length}`)
    check('a posix answer costs one probe and no bash sweep ever fires',
      reconnected.calls.length === 1 && reconnected.calls[0].command === 'echo %COMSPEC%',
      `probes=${JSON.stringify(reconnected.calls.map(call => call.command))}`)
  } finally {
    engine.dispose()
  }
}

// --- dd75ab6: the capability probe speaks the host's dialect too ------------
{
  // On a cmd host WITHOUT bash the probe order is: %COMSPEC% login probe,
  // the niubash placement sweep (answers nothing here), the well-known bash
  // sweep (answers nothing either), then the `where` capability script —
  // calls[3] is the capability script.
  const { engine, calls } = dialectHarness('wintools', [
    { stdout: 'C:\\Windows\\system32\\cmd.exe\r\n', code: 0 },
    { stdout: '', code: 0 },
    { stdout: '', code: 0 },
    { stdout: 'rg\r\ngit\r\ndsh-probe-done\r\n', code: 0 },
  ])
  try {
    const result = await engine.probeCapabilities('wintools')
    const script = calls[3]?.command ?? ''
    check('a cmd host checks presence with where', script.includes('where rg') && script.includes('where git') && script.includes('where inotifywait'), script)
    check('the cmd probe does not use POSIX command -v', !script.includes('command -v'), script)
    check('the cmd probe joins its checks with &, not ;', script.includes(' & ') && !script.includes('; '), script)
    check('the probed capabilities read back truthfully',
      result.rg === true && result.git === true && result.inotifywait === false, JSON.stringify(result))
    check('the probe order is login, niubash placements, bash sweep, capabilities',
      calls.length === 4
      && calls[0].command === 'echo %COMSPEC%'
      && calls[1].command.includes('if exist') && !calls[1].command.includes('where bash')
      && calls[2].command.includes('where bash'),
      JSON.stringify(calls.map(call => call.command.slice(0, 40))))
  } finally {
    engine.dispose()
  }
}

{
  const { engine, calls } = dialectHarness('postools', [
    { stdout: '%COMSPEC%\r\n', code: 0 },
    { stdout: 'git\ndsh-probe-done\n', code: 0 },
  ])
  try {
    const result = await engine.probeCapabilities('postools')
    const script = calls[1]?.command ?? ''
    check('a posix host keeps the command -v probe', script.includes('command -v rg') && !script.includes('where '), script)
    check('the posix probe joins its checks with ;', script.includes('; '), script)
    check('a posix host reports the tools it answered', result.rg === false && result.git === true, JSON.stringify(result))
  } finally {
    engine.dispose()
  }
}

// --- dd75ab6: the subprocess script builder spells both dialects ------------
/**
 * Install the subprocess router over a double engine and run one git spec.
 *
 * @param {'posix' | 'cmd'} dialect - what the fake dialect probe answers.
 * @param {string} cwd - the spec's `ssh://` working directory.
 * @returns {Promise<{script: string, service: object}>} the built script.
 */
async function builtScript (dialect, cwd) {
  const { client, calls } = execScriptedClient([{ code: 0 }])
  const record = pooledRecord(cwd.startsWith('ssh://win') ? 'winhost' : 'linhost', client)
  const engine = {
    assertNotDisabled () {},
    async acquire () { return record },
    closeRecord () {},
    remoteDialect: async () => dialect,
  }
  const service = {
    spawn () { throw new Error('the local spawn must not run for a remote cwd') },
  }
  const ctx = { get: name => name === 'subprocess' ? service : undefined }
  const router = installRemoteSubprocess(ctx, { engine })
  try {
    const handle = service.spawn({
      argv: ['/opt/tools/bin/git', 'status', '--short'],
      cwd,
      graceMs: 500,
      env: { GIT_AUTHOR_NAME: 'dsh-test' },
    })
    const outcome = await handle.done
    if (outcome.exitCode !== 0) throw new Error(`the remote run did not settle cleanly: ${JSON.stringify(outcome)}`)
    if (calls.length !== 1) throw new Error(`expected one exec, saw ${calls.length}`)
    return { script: calls[0].command, service }
  } finally {
    uninstallRemoteSubprocess(service)
  }
}

{
  const { script } = await builtScript('cmd', 'ssh://winhost/D:/repo')
  check('the cmd script re-exports PATH with set', script.includes('set "PATH='), script)
  check('the cmd script moves across drives with cd /d', script.includes('cd /d "D:\\repo"'), script)
  check('the cmd script checks presence with where', script.includes('where git'), script)
  check('the cmd script exits 127 when the tool is missing', script.includes('exit 127'), script)
  check('the cmd script re-exports the spec env with set', script.includes('set "GIT_AUTHOR_NAME=dsh-test"'), script)
  check('the cmd script carries no POSIX export', !script.includes('export '), script)
  check('the cmd script invokes the translated argv', script.includes('git "status" "--short"'), script)
}

{
  const { script } = await builtScript('posix', 'ssh://linhost/home/repo')
  check('the posix script keeps the export PATH prelude', script.includes('export PATH='), script)
  check("the posix script re-exports the spec env with export", script.includes(`export GIT_AUTHOR_NAME='dsh-test'`), script)
  check("the posix script checks presence with command -v", script.includes(`command -v 'git'`), script)
  check("the posix script cds into the quoted workdir", script.includes(`cd '/home/repo'`), script)
  check('the posix script carries no cmd set re-export', !script.includes('set "PATH='), script)
}

// --- dd75ab6: the shell manager opens the host's shell ----------------------
/**
 * A PTY channel double that answers the marker the production code appends.
 * `scripts` records every raw script handed to `write`, so the dialect
 * spellings are asserted on the exact bytes the manager sends.
 */
function ptyChannel (results = {}) {
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

/** An engine double that opens prepared PTY channels and answers the probe. */
function shellEngine (dialect, prepared) {
  const opened = []
  return {
    opened,
    remoteDialect: async () => dialect,
    async openChannel (_alias, command, options) {
      const one = prepared[opened.length] ?? prepared.at(-1)
      opened.push({ command, options })
      return { channel: one.channel, release: () => {} }
    },
  }
}

{
  const prepared = ptyChannel({ 'echo hi': { output: 'hi', code: 0 } })
  const engine = shellEngine('cmd', [prepared])
  const shells = new ShellManager({ engine })
  const result = await shells.run('win', 'echo hi')
  check('a cmd host opens bare cmd.exe', engine.opened[0].command === 'cmd.exe', engine.opened[0].command)
  check('a cmd session still recovers output and status',
    result.output === 'hi' && result.exitCode === 0, JSON.stringify(result))

  const script = prepared.scripts[0]
  const lines = script.split('\n')
  check('the cmd marker line reads %ERRORLEVEL%', lines[0] === 'echo hi' && lines[1]?.startsWith('echo __DSH_WS_') && lines[1].includes('%ERRORLEVEL%'),
    JSON.stringify(script))
  check('the cmd marker line stands alone (nothing else on it)',
    lines[1] !== undefined && lines[1].trim() === lines[1] && !lines[1].includes('echo hi'), JSON.stringify(lines[1]))
  check('the cmd script uses no POSIX printf status capture',
    !script.includes('printf') && !script.includes('$?'), script)
}

{
  const prepared = ptyChannel({ 'echo hi': { output: 'hi', code: 0 } })
  const engine = shellEngine('cmd', [prepared])
  const shells = new ShellManager({ engine })
  await shells.run('win', 'echo hi', { cwd: '/D:/logs' })
  check('a cmd open with a cwd crosses drives with /k cd /d',
    engine.opened[0].command === 'cmd.exe /k cd /d "D:\\logs"', engine.opened[0].command)
}

{
  const prepared = ptyChannel({ 'echo hi': { output: 'hi', code: 0 } })
  const engine = shellEngine('posix', [prepared])
  const shells = new ShellManager({ engine })
  const result = await shells.run('lin', 'echo hi')
  check('a posix host still opens a login sh', engine.opened[0].command.startsWith('sh -l'), engine.opened[0].command)
  const lines = prepared.scripts[0].split('\n')
  check('the posix script keeps the printf status capture',
    lines[1]?.includes('printf') && lines[1].includes('$?') && !prepared.scripts[0].includes('%ERRORLEVEL%'),
    JSON.stringify(prepared.scripts[0]))
  check('the posix session still recovers output and status',
    result.output === 'hi' && result.exitCode === 0, JSON.stringify(result))
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
rmSync(storeHome, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
