/**
 * The Niubash panel routes and the injected-content page (024b2d0, f39d997,
 * 4dc6202): `GET /niubash/status`, `POST /niubash/init`, `GET /injected`,
 * plus the hostSave / hosts-list wiring of the auto-deploy wish.
 *
 * The contracts under test:
 *
 *   1. **status answers from the record first** — an entry carrying a
 *      `bashProvisioned` record answers `initialized: true` with ONE store
 *      read and no probing at all; a bare entry pays exactly one three-level
 *      sweep and one `--version` execution, reports the probed placement and
 *      feeds the engine presence cache; a failed probe is the dialog's "not
 *      initialized" answer, not a route error;
 *   2. **init validates before it provisions** — alias/placement shapes, the
 *      editable-store gate (an ~/.ssh/config fallback cannot carry the
 *      record), the project/custom placement inputs; `placement: 'user'`
 *      rides through to the provisioner (the receipt stat names the
 *      `%USERPROFILE%` root); a browser abort (`req → close`) reaches the
 *      provisioner as an AbortSignal and writes NOTHING to the socket;
 *   3. **the injected-content page** shows exactly what the model sees — the
 *      announcement verbatim, one row per Windows-type host plus any host
 *      with a record (a mac host without one is absent), hit rows carrying
 *      the placement facts and the exact section text, unhit win rows
 *      present but marked;
 *   4. **the auto-deploy wish round-trips** — hostSave persists
 *      `niubashAutoDeploy` (store-normalized: only true lands on disk) and
 *      kicks the engine once per save; the hosts list echoes both prefill
 *      fields.
 *
 * Handlers are driven with synthetic request/response doubles, so no server,
 * no SSH host, and no network are involved (`globalThis.fetch` throws; the
 * offline init paths are proven through the reuse gate and the stub's own
 * marker error).
 *
 * Run: node tests/niubash-routes-smoke.mjs
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// routes.js pulls the SFTP primitives from remote-fs.js, which resolves the
// DSH peer packages; the suite needs the assembled (or stub) tree even though
// it never opens a connection.
const coreRoot = process.env.DSH_CORE_ROOT
if (!coreRoot) {
  console.log('\n=== niubash routes smoke ===\n')
  console.log('  SKIP  DSH_CORE_ROOT is not set (routes.js needs @deepseek-ai/dsh-fs)')
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

console.log('\n=== niubash routes smoke ===\n')

const { makeRoutes, ROUTES } = await import(pathToFileURL(path.join(pluginRoot, 'lib/routes.js')).href)
const { HostConfigStore } = await import(pathToFileURL(path.join(pluginRoot, 'lib/store.js')).href)
const { HostStore } = await import(pathToFileURL(path.join(pluginRoot, 'lib/hosts.js')).href)
const { BASH_PAYLOAD_PIN, NIUBASH_RUNTIME_RELATIVE, resolvePayloadPin } = await import(pathToFileURL(path.join(pluginRoot, 'lib/bash-payload.js')).href)
const { SSH_WORKSPACE_GUIDANCE, niubashGuidanceSection } = await import(pathToFileURL(path.join(pluginRoot, 'lib/guidance.js')).href)

// What a real cmd.exe echoes for the user level: %VAR% expands while cmd
// PARSES the probe line, so the hit marker carries the CONCRETE root — the
// `%USERPROFILE%` template spelling the candidate list was built with can
// never equal it, and the route must recognize the hit through the same
// suffix judgment resolveWinBash uses (999f24f).
const CONCRETE_USER_ROOT = `C:\\Users\\ao\\${NIUBASH_RUNTIME_RELATIVE}`

// No real network anywhere in this suite.
const fetchAttempts = []
globalThis.fetch = (input) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? input)
  fetchAttempts.push(url)
  return Promise.reject(new Error('no-network-in-test'))
}

// ---------------------------------------------------------------------------
// Doubles, shaped like probe-route-smoke's.
// ---------------------------------------------------------------------------

/** A response double that records what the handler wrote. */
function fakeRes () {
  const state = { status: undefined, headers: undefined, body: '', headersSent: false }
  const res = {
    get headersSent () { return state.headersSent },
    writeHead (status, headers) { state.status = status; state.headers = headers; state.headersSent = true; return res },
    write (chunk) { state.body += String(chunk); return true },
    end (chunk) { if (chunk !== undefined) state.body += String(chunk); return res },
    on () {},
  }
  return { res, state }
}

/** A request double; returns a `fire` so tests can raise `close` mid-handler. */
function fakeReq (options = {}) {
  const handlers = new Map()
  const req = {
    method: options.method ?? 'POST',
    url: options.url ?? '/',
    headers: options.headers ?? { host: 'localhost:4074', 'content-type': 'application/json' },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1', localPort: options.localPort ?? 4074 },
    on (event, handler) {
      handlers.set(event, handler)
      if (options.body !== undefined && event === 'end') {
        setImmediate(() => {
          const dataHandler = handlers.get('data')
          if (dataHandler !== undefined) dataHandler(Buffer.from(JSON.stringify(options.body)))
          handler()
        })
      }
    },
  }
  return { req, fire: event => { const handler = handlers.get(event); if (handler !== undefined) handler() } }
}

async function call (route, options = {}) {
  const { res, state } = fakeRes()
  const { req, fire } = fakeReq(options)
  const done = route.handler(req, res)
  return { done, fire, state, get reply () { return done.then(() => {
    let parsed
    try { parsed = JSON.parse(state.body) } catch { parsed = undefined }
    return { status: state.status, body: parsed, raw: state.body }
  }) } }
}

async function callJson (route, options = {}) {
  const outcome = await call(route, options)
  return await outcome.reply
}

// ---------------------------------------------------------------------------
// A seeded hermetic store shared by the route halves.
// ---------------------------------------------------------------------------

const home = mkdtempSync(path.join(tmpdir(), 'dsh-niubash-routes-'))
const entryStore = new HostConfigStore(path.join(home, 'dsh-ssh.json'))
entryStore.create({ alias: 'win-record', host: '10.0.0.1', port: 22, user: 'ao', auth: { kind: 'agent' }, os: 'win' })
entryStore.create({ alias: 'win-bare', host: '10.0.0.2', port: 22, user: 'ao', auth: { kind: 'agent' }, os: 'win' })
entryStore.create({ alias: 'mac-host', host: '10.0.0.3', port: 22, user: 'ao', auth: { kind: 'agent' }, os: 'mac' })
const WIN_RECORD = { path: 'C:\\Users\\ao\\.dsh\\runtimes\\plugins\\dsh-ssh-workspace\\niubash\\winuxcmd\\usr\\bin\\bash.exe', root: 'C:\\Users\\ao\\.dsh\\runtimes\\plugins\\dsh-ssh-workspace\\niubash', version: '1.5.0', sha256: BASH_PAYLOAD_PIN.sha256, provisionedAt: 1_700_000_000_000, releaseTag: 'v1.5.0', placement: 'user' }
entryStore.mutateHosts(entries => entries.map(entry => entry.alias === 'win-record' ? { ...entry, bashProvisioned: WIN_RECORD } : entry))

// An alias that exists ONLY in the ~/.ssh/config fallback (never editable).
writeFileSync(path.join(home, 'ssh-config'), 'Host config-only\n  HostName 10.0.0.9\n  User deploy\n')
const hostStore = new HostStore(path.join(home, 'ssh-config'), entryStore)

const router = { listRoots: () => ['ssh://win-record/D:/repo', 'ssh://win-bare/D:/other'] }

/** A recording engine base over the real store; sections extend it. */
function routeEngine (overrides = {}) {
  const engine = {
    store: hostStore,
    router,
    diagnostics: { list: () => [], record: () => {} },
    execCalls: [],
    presence: new Map(),
    noteNiubashPresence (alias, info) { engine.presence.set(alias, { ...info, at: Date.now() }) },
    niubashPresenceOf (alias) { return engine.presence.get(alias) },
    kickCalls: [],
    kickNiubashAutoDeploy (alias) { engine.kickCalls.push(alias); return true },
    // The save route drops the cached connection for a changed record.
    forget () {},
    async exec (_alias, command, options) {
      engine.execCalls.push({ command, options })
      const step = engine.steps?.shift()
      if (step === undefined) throw new Error(`unexpected exec: ${command}`)
      return { success: step.success ?? true, exitCode: step.exitCode ?? 0, stdout: step.stdout ?? '', stderr: '', timedOut: false, truncated: false, durationMs: 0 }
    },
    ...overrides,
  }
  return engine
}

function routesOf (engine) {
  return makeRoutes({ engine, router, forwards: { list: () => [] }, ctx: { get: () => undefined } })
}

// ---------------------------------------------------------------------------
console.log('[GET /niubash/status: the record answers, the bare host probes]')

{
  const engine = routeEngine({ steps: [] })
  engine.exec = async () => { throw new Error('a recorded host must not be probed') }
  const routes = routesOf(engine)
  const status = routes.find(route => route.path === ROUTES.niubashStatus)
  const reply = await callJson(status, { method: 'GET', url: `${ROUTES.niubashStatus}?alias=win-record`, headers: { host: 'localhost:4074' } })
  check('the route is registered', status !== undefined, String(status))
  check('a recorded host answers initialized without any probe',
    reply.status === 200 && reply.body.initialized === true && reply.body.probe.ran === false, reply.raw)
  check('the record travels verbatim (path/root/version/releaseTag/placement)',
    reply.body.record?.path === WIN_RECORD.path && reply.body.record?.placement === 'user' && reply.body.record?.releaseTag === 'v1.5.0',
    JSON.stringify(reply.body.record))
  check('the mounted project placements ride along (canonical ssh:// path + Windows root)',
    reply.body.placements?.[0]?.workspacePath === 'ssh://win-record/D:/repo'
    && reply.body.placements?.[0]?.root === 'D:\\repo', JSON.stringify(reply.body.placements))
  check('the payload summary names the pin source (bare checkout → bundled)',
    reply.body.payload?.source === 'bundled' && reply.body.payload?.version === BASH_PAYLOAD_PIN.version, JSON.stringify(reply.body.payload))
  check('bad requests answer 400 (missing alias / unknown alias)',
    (await callJson(status, { method: 'GET', url: ROUTES.niubashStatus, headers: { host: 'localhost:4074' } })).status === 400
    && (await callJson(status, { method: 'GET', url: `${ROUTES.niubashStatus}?alias=nobody`, headers: { host: 'localhost:4074' } })).status === 400)
}

{
  // The echo spells the CONCRETE root cmd expanded (never the template the
  // candidate was built with), so the hit must be matched into the sweep's
  // three-level candidates through the suffix judgment — a template-vs-
  // concrete equality would silently skip it and answer not-initialized.
  const engine = routeEngine({ steps: [
    { stdout: `@@${CONCRETE_USER_ROOT}\r\n` },
    { stdout: 'GNU bash, version 5.2.26(1)-release (x86_64-pc-msys)\r\n' },
  ] })
  const routes = routesOf(engine)
  const status = routes.find(route => route.path === ROUTES.niubashStatus)
  const reply = await callJson(status, { method: 'GET', url: `${ROUTES.niubashStatus}?alias=win-bare`, headers: { host: 'localhost:4074' } })
  const sweep = engine.execCalls[0]?.command ?? ''
  check('a bare host pays exactly one sweep plus one --version',
    reply.body.initialized === true && engine.execCalls.length === 2
    && sweep.includes('manifest.json') && !sweep.includes('where bash')
    && engine.execCalls[1].command.includes('--version'), JSON.stringify(engine.execCalls.map(call => call.command)))
  check('the sweep offered all three levels (project, user, legacy) for this host',
    sweep.includes(`if exist "D:\\other\\${NIUBASH_RUNTIME_RELATIVE}\\manifest.json"`)
    && sweep.includes(`if exist "%USERPROFILE%\\${NIUBASH_RUNTIME_RELATIVE}\\manifest.json"`)
    && sweep.includes(`if exist "%USERPROFILE%\\.dsh-ssh-workspace\\bash\\${BASH_PAYLOAD_PIN.version}\\manifest.json"`), sweep)
  check('the concrete hit line is matched into the sweep\'s three-level candidates (placement recognized, never by template equality)',
    reply.body.probe.found === true && reply.body.probed?.placement === 'user'
    && reply.body.probed?.root === CONCRETE_USER_ROOT
    && reply.body.probed?.root !== `%USERPROFILE%\\${NIUBASH_RUNTIME_RELATIVE}`
    && reply.body.probed?.path === `${CONCRETE_USER_ROOT}\\${resolvePayloadPin().executableRelativePath.replaceAll('/', '\\')}`
    && reply.body.probed?.releaseTag === BASH_PAYLOAD_PIN.releaseTag,
    JSON.stringify(reply.body))
  check('the probe-proven runtime feeds the engine presence cache with the concrete root',
    engine.presence.get('win-bare')?.source === 'probe' && engine.presence.get('win-bare')?.placement === 'user'
    && engine.presence.get('win-bare')?.root === CONCRETE_USER_ROOT, JSON.stringify([...engine.presence]))
}

{
  const engine = routeEngine({ steps: [] })
  engine.exec = async () => { throw new Error('host unreachable') }
  const routes = routesOf(engine)
  const status = routes.find(route => route.path === ROUTES.niubashStatus)
  const reply = await callJson(status, { method: 'GET', url: `${ROUTES.niubashStatus}?alias=win-bare`, headers: { host: 'localhost:4074' } })
  check('a failed probe is the not-initialized answer, not a route error',
    reply.status === 200 && reply.body.ok === true && reply.body.initialized === false
    && reply.body.probe.ran === true && reply.body.probe.found === false && reply.body.probe.error.includes('host unreachable'),
    reply.raw)
}

// ---------------------------------------------------------------------------
console.log('\n[POST /niubash/init: validation, placement, cancellation]')

{
  const engine = routeEngine()
  const routes = routesOf(engine)
  const init = routes.find(route => route.path === ROUTES.niubashInit)
  const missingAlias = await callJson(init, { body: { placement: 'user' } })
  const badPlacement = await callJson(init, { body: { alias: 'win-bare', placement: 'legacy' } })
  const configOnly = await callJson(init, { body: { alias: 'config-only', placement: 'user' } })
  const unknown = await callJson(init, { body: { alias: 'nobody', placement: 'user' } })
  const noProject = await callJson(init, { body: { alias: 'win-bare', placement: 'project', projectPath: 'ssh://mac-host/none' } })
  const noCustom = await callJson(init, { body: { alias: 'win-bare', placement: 'custom' } })
  check('the route is registered', init !== undefined, String(init))
  check('a missing alias answers 400', missingAlias.status === 400)
  check('a placement outside the closed set answers 400', badPlacement.status === 400 && badPlacement.body.error.includes('project, user, custom'), badPlacement.raw)
  check('an ~/.ssh/config fallback names the real limitation (it cannot carry the record)',
    configOnly.status === 400 && configOnly.body.error.includes('~/.ssh/config fallback'), configOnly.raw)
  check('an unknown alias answers 400 with its own wording',
    unknown.status === 400 && unknown.body.error.includes('not in the editable host store'), unknown.raw)
  check('a project placement naming no mounted workspace answers 400',
    noProject.status === 400 && noProject.body.error.includes('not a workspace mounted from this host'), noProject.raw)
  check('a custom placement without a directory answers 400',
    noCustom.status === 400 && noCustom.body.error.includes('customRoot is required'), noCustom.raw)
}

{
  // The offline SUCCESS path: a matching receipt + a live verification reuses
  // the tree — no payload download, no publish, one store read.
  const engine = routeEngine()
  engine.loginDialect = async () => 'cmd'
  engine.execRaw = async (_alias, command) => {
    engine.execCalls.push(command)
    const stdout = command.includes('--version')
      ? 'GNU bash, version 5.2.26(1)-release (x86_64-pc-msys)\r\n'
      : 'C:\\Users\\ao\r\n'
    return { success: true, exitCode: 0, stdout, stderr: '', timedOut: false, truncated: false, durationMs: 0 }
  }
  const receipt = Buffer.from(JSON.stringify({ schemaVersion: 1, name: 'bash', version: BASH_PAYLOAD_PIN.version, sha256: BASH_PAYLOAD_PIN.sha256 }))
  const statPaths = []
  engine.withSftp = async (_alias, operation) => await operation({
    stat (target, callback) { statPaths.push(target); callback(null, { isFile: () => true }) },
    open (target, flags, callback) { callback(null, { __handle: target }) },
    read (handle, buffer, _offset, length, position, callback) {
      if (position === 0 && handle.__handle !== undefined) {
        buffer.set(receipt.subarray(0, Math.min(length, receipt.length)))
        callback(null, receipt.length)
      } else callback(null, 0)
    },
    close (handle, callback) { callback(null) },
  })
  const routes = routesOf(engine)
  const init = routes.find(route => route.path === ROUTES.niubashInit)
  const reply = await callJson(init, { body: { alias: 'win-bare', placement: 'user' } })
  check('the user placement stats the receipt at the %USERPROFILE% conventional root',
    statPaths[0] === `/C:/Users/ao/.dsh/runtimes/plugins/dsh-ssh-workspace/niubash/.provisioned.json`
    && statPaths[0].includes(NIUBASH_RUNTIME_RELATIVE.replaceAll('\\', '/')), JSON.stringify(statPaths))
  check('a matching receipt reuses the tree: ok:true, placement echoed, offline',
    reply.body.ok === true && reply.body.provisioned?.reused === true && reply.body.provisioned?.placement === 'user'
    && reply.body.provisioned?.version === BASH_PAYLOAD_PIN.version && reply.body.provisioned?.releaseTag === BASH_PAYLOAD_PIN.releaseTag,
    reply.raw)
  check('the reuse path fetched nothing', fetchAttempts.length === 0, JSON.stringify(fetchAttempts))
}

{
  // Nothing staged and no reuse → the route's provisioner reaches for the pin
  // URL, the stub catches it, and the browser gets ok:false with the reason.
  fetchAttempts.length = 0
  const engine = routeEngine()
  engine.loginDialect = async () => 'cmd'
  engine.execRaw = async (_alias, command) => ({ success: true, exitCode: 0, stdout: command.includes('--version') ? 'GNU bash\r\n' : 'C:\\Users\\ao\r\n', stderr: '', timedOut: false, truncated: false, durationMs: 0 })
  engine.withSftp = async (_alias, operation) => await operation({
    stat (_target, callback) { callback(null, null) },
  })
  const routes = routesOf(engine)
  const init = routes.find(route => route.path === ROUTES.niubashInit)
  const reply = await callJson(init, { body: { alias: 'win-bare', placement: 'user' } })
  check('without reuse the run falls through to the download (the documented last resort)',
    fetchAttempts.at(-1) === BASH_PAYLOAD_PIN.url, JSON.stringify(fetchAttempts))
  check('the offline download failure answers ok:false with the stub\'s marker',
    reply.body.ok === false && reply.body.error.includes('no-network-in-test'), reply.raw)
}

{
  // The browser aborts the fetch → the socket closes → the route aborts the
  // provisioner through one AbortSignal and writes NOTHING to the socket.
  const engine = routeEngine()
  const seenSignals = []
  engine.loginDialect = (alias, options) => new Promise((resolve, reject) => {
    seenSignals.push(options?.signal)
    options?.signal?.addEventListener('abort', () => reject(options.signal.reason ?? new Error('aborted')))
  })
  const routes = routesOf(engine)
  const init = routes.find(route => route.path === ROUTES.niubashInit)
  const pending = await call(init, { body: { alias: 'win-bare', placement: 'user' } })
  await new Promise(resolve => setImmediate(resolve)) // let the handler register its close listener
  pending.fire('close')
  await pending.done
  check('the request close aborted the provisioner\'s signal',
    seenSignals.length === 1 && seenSignals[0].aborted === true, JSON.stringify(seenSignals.map(signal => signal.aborted)))
  check('an aborted init writes nothing to the (dead) socket', pending.state.body === '' && pending.state.headersSent === false, JSON.stringify(pending.state))
}

// ---------------------------------------------------------------------------
console.log('\n[GET /injected: the page shows exactly what the model sees]')

{
  const engine = routeEngine()
  engine.presence.set('win-presence', { root: 'C:\\Users\\ao\\.dsh\\runtimes\\plugins\\dsh-ssh-workspace\\niubash', path: 'C:\\Users\\ao\\.dsh\\runtimes\\plugins\\dsh-ssh-workspace\\niubash\\winuxcmd\\usr\\bin\\bash.exe', version: 'GNU bash, version 5.2.26(1)-release', releaseTag: 'v1.5.0', placement: 'user', source: 'probe', at: Date.now() })
  entryStore.create({ alias: 'win-presence', host: '10.0.0.4', port: 22, user: 'ao', auth: { kind: 'agent' }, os: 'win' })
  const routes = routesOf(engine)
  const injected = routes.find(route => route.path === ROUTES.injected)
  const reply = await callJson(injected, { method: 'GET', url: ROUTES.injected, headers: { host: 'localhost:4074' } })
  check('the route is registered', injected !== undefined, String(injected))
  check('the announcement travels verbatim', reply.body.guidance === SSH_WORKSPACE_GUIDANCE)
  const rows = reply.body.niubash.hosts
  const byAlias = Object.fromEntries(rows.map(row => [row.alias, row]))
  check('a mac host without a record is absent from the page', byAlias['mac-host'] === undefined, JSON.stringify(rows.map(row => row.alias)))
  check('a record hit carries the placement facts and the exact section text',
    byAlias['win-record'].hit === true && byAlias['win-record'].source === 'record'
    && byAlias['win-record'].root === WIN_RECORD.root && byAlias['win-record'].placement === 'user'
    && byAlias['win-record'].text === niubashGuidanceSection(WIN_RECORD, 'win-record'), JSON.stringify(byAlias['win-record']))
  check('a presence-only hit is marked with its probe source',
    byAlias['win-presence'].hit === true && byAlias['win-presence'].source === 'probe'
    && byAlias['win-presence'].text === niubashGuidanceSection(engine.presence.get('win-presence'), 'win-presence'), JSON.stringify(byAlias['win-presence']))
  check('an unhit win host stays listed but marked and textless',
    byAlias['win-bare'].hit === false && byAlias['win-bare'].text === undefined && byAlias['win-bare'].root === undefined, JSON.stringify(byAlias['win-bare']))
}

// ---------------------------------------------------------------------------
console.log('\n[hostSave: the auto-deploy wish round-trips and kicks]')

{
  const engine = routeEngine()
  const routes = routesOf(engine)
  const save = routes.find(route => route.path === ROUTES.hostSave)
  const hosts = routes.find(route => route.path === ROUTES.hosts)

  const created = await callJson(save, { body: { alias: 'saved-win', host: '10.0.0.20', port: 22, user: 'ao', auth: { kind: 'agent' }, os: 'win', niubashAutoDeploy: true, description: '' } })
  check('a new win host with the wish saves ok', created.body.ok === true && created.body.created === true, created.raw)
  check('the wish is stored', hostStore.entry('saved-win').niubashAutoDeploy === true)
  check('a save kicks the engine once', engine.kickCalls.length === 1 && engine.kickCalls[0] === 'saved-win', JSON.stringify(engine.kickCalls))

  // An edit carries originalAlias (the editor's update spelling).
  const unchecked = await callJson(save, { body: { originalAlias: 'saved-win', alias: 'saved-win', host: '10.0.0.20', port: 22, user: 'ao', auth: { kind: 'agent' }, os: 'win', niubashAutoDeploy: false, description: '' } })
  check('unchecking saves ok and deletes the stored key (勾掉即删键)',
    unchecked.body.ok === true && !Object.hasOwn(hostStore.entry('saved-win'), 'niubashAutoDeploy'), unchecked.raw)
  check('the save route kicks again (the engine gate owns stand-down)',
    engine.kickCalls.length === 2, JSON.stringify(engine.kickCalls))

  const rows = await callJson(hosts, { method: 'GET', url: ROUTES.hosts, headers: { host: 'localhost:4074' } })
  const byAlias = Object.fromEntries(rows.body.hosts.map(row => [row.alias, row]))
  check('the hosts list echoes the prefill pair (wish + provisioned)',
    byAlias['saved-win']?.niubashAutoDeploy === false && byAlias['saved-win']?.niubashProvisioned === false
    && byAlias['win-record']?.niubashAutoDeploy === false && byAlias['win-record']?.niubashProvisioned === true
    && byAlias['win-bare']?.niubashProvisioned === false, JSON.stringify({ saved: byAlias['saved-win'], record: byAlias['win-record'] }))
}

rmSync(home, { recursive: true, force: true })

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
