/**
 * The host entry's optional `os`: normalization, storage, dialect dispatch.
 *
 * `os` pins what the remote machine is (`win` / `mac` / `linux`), so the
 * engine can answer the login-shell dialect from config instead of probing
 * each connection — `win` speaks cmd.exe, `mac` / `linux` speak POSIX. The
 * field stays OPTIONAL on purpose: an entry without it (older versions,
 * hand-written stores, `~/.ssh/config` fallbacks) must keep the probe, which
 * is exactly how a probe-detected Windows host survives this field's
 * introduction. The contracts pinned here:
 *
 *   1. normalization collapses aliases (`windows` → `win`, `macos`/`osx`/
 *      `darwin` → `mac`) and reads anything else as "not set" — a typo must
 *      not silently pin the wrong OS;
 *   2. the editor always posts the key, so the "auto" choice (a blank value)
 *      DROPS the stored entry while an absent key (an older client) KEEPS it —
 *      the same blank/absent split `defaultPath` already obeys;
 *   3. `remoteDialect` answers a pinned OS without sending any probe command;
 *      only an unpinned entry reaches the `%COMSPEC%` probe.
 *
 * The pure half (normalization + store + rows) runs on a bare checkout; the
 * route half needs the peer tree (routes.js imports remote-fs.js).
 *
 * Run: node tests/host-os-smoke.mjs
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
let failures = 0
function check (label, ok, detail) {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`) } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const { normalizeHostOs, HOST_OS, HostConfigStore } = await import(pathToFileURL(path.join(pluginRoot, 'lib/store.js')).href)
const { HostStore } = await import(pathToFileURL(path.join(pluginRoot, 'lib/hosts.js')).href)

console.log('\n=== host os smoke ===\n')

// ---------------------------------------------------------------------------
console.log('[normalizeHostOs]')

for (const [input, expected] of [
  [undefined, undefined],
  [null, undefined],
  ['', undefined],
  ['   ', undefined],
  ['linux', 'linux'],
  ['win', 'win'],
  ['mac', 'mac'],
  // Outer whitespace and case are editor noise, never part of the value.
  [' Win ', 'win'],
  ['MACOS', 'mac'],
  // Accepted aliases collapse to the canonical three.
  ['windows', 'win'],
  ['osx', 'mac'],
  ['darwin', 'mac'],
  // Anything else is "not set": a typo must not pin the wrong OS.
  ['freebsd', undefined],
  ['windows95', undefined],
  [42, undefined],
  [{}, undefined],
]) {
  check(`${JSON.stringify(input)} normalizes to ${JSON.stringify(expected)}`,
    normalizeHostOs(input) === expected,
    JSON.stringify(normalizeHostOs(input)))
}

check('HOST_OS lists exactly the canonical three', JSON.stringify(HOST_OS) === JSON.stringify(['win', 'mac', 'linux']), JSON.stringify(HOST_OS))

// ---------------------------------------------------------------------------
console.log('\n[store semantics]')
//
// Written straight through the store (no HTTP): the stored entry is what the
// engine's dialect lookup and the routes read back, so the field must
// normalize on create AND obey the blank/absent merge rules on update.

{
  const home = mkdtempSync(path.join(tmpdir(), 'dsh-host-os-store-'))
  try {
    const store = new HostConfigStore(path.join(home, 'store.json'))

    const win = store.create({ alias: 'win', host: 'w.example', user: 'u', auth: { kind: 'agent' }, os: 'Windows' })
    check('create stores the pinned OS in canonical spelling', win.os === 'win', JSON.stringify(win.os))
    const stored = JSON.parse(readFileSync(store.path, 'utf8')).hosts.find(entry => entry.alias === 'win')
    check('the canonical value is what reaches the document', stored.os === 'win', JSON.stringify(stored))

    const bare = store.create({ alias: 'bare', host: 'b.example', user: 'u', auth: { kind: 'agent' } })
    check('a create without the key stores an entry without the key (older-version shape)',
      !Object.hasOwn(bare, 'os'), JSON.stringify(Object.keys(bare)))

    store.update('bare', { os: '' })
    check('a blank update still leaves no key behind', !Object.hasOwn(store.find('bare'), 'os'))

    store.update('win', { description: 'touched' })
    check('an update without the key keeps the pinned OS',
      store.find('win').os === 'win', JSON.stringify(store.find('win').os))

    store.update('win', { os: 'macos' })
    check('an update replaces the stored OS (aliases collapse)',
      store.find('win').os === 'mac', JSON.stringify(store.find('win').os))

    store.update('win', { os: 'auto' })
    check('an unknown spelling ("auto") reads as not set and drops the key',
      !Object.hasOwn(store.find('win'), 'os'), JSON.stringify(store.find('win')))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n[store semantics: the aliasTag opt-in]')
//
// The sidebar alias tag rides the same opt-in shape as the transport flags:
// absent = off (older entries, hand-written stores), true = on, and a boolean
// false never lands on disk — so an entry that never turned the tag on stays
// byte-identical to an older version's. A non-boolean value must fail
// validation with its own message instead of guessing a state.

{
  const home = mkdtempSync(path.join(tmpdir(), 'dsh-host-os-aliastag-'))
  try {
    const store = new HostConfigStore(path.join(home, 'store.json'))

    const tagged = store.create({ alias: 'tagged', host: 't.example', user: 'u', auth: { kind: 'agent' }, aliasTag: true })
    check('create with aliasTag:true stores the opt-in', tagged.aliasTag === true, JSON.stringify(tagged))
    const untagged = store.create({ alias: 'untagged', host: 'n.example', user: 'u', auth: { kind: 'agent' }, aliasTag: false })
    check('a false never lands on disk (off = absence of the key)',
      !Object.hasOwn(untagged, 'aliasTag'), JSON.stringify(Object.keys(untagged)))
    const bare = store.create({ alias: 'bare', host: 'b.example', user: 'u', auth: { kind: 'agent' } })
    check('a create without the key stores no key (older-version shape)',
      !Object.hasOwn(bare, 'aliasTag'), JSON.stringify(Object.keys(bare)))

    store.update('bare', { aliasTag: true })
    check('an update can turn the tag on', store.find('bare').aliasTag === true, JSON.stringify(store.find('bare')))
    store.update('bare', { aliasTag: false })
    check('turning the tag off drops the key again', !Object.hasOwn(store.find('bare'), 'aliasTag'), JSON.stringify(store.find('bare')))
    store.update('tagged', { description: 'touched' })
    check('an update without the key keeps the stored opt-in',
      store.find('tagged').aliasTag === true, JSON.stringify(store.find('tagged')))

    // A hand-written store may carry garbage: the next write must reject it.
    writeFileSync(store.path, JSON.stringify({
      hosts: [{ alias: 'broken', host: 'x.example', port: 22, user: 'u', auth: { kind: 'agent' }, aliasTag: 'yes' }],
    }))
    let threw
    try { store.update('broken', { description: 'touched' }) } catch (error) { threw = error.message }
    check('a non-boolean aliasTag fails validation with its own message',
      threw !== undefined && threw.includes('aliasTag must be a boolean when present'), String(threw))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n[rows: the field reaches the agent-facing surface]')

{
  const home = mkdtempSync(path.join(tmpdir(), 'dsh-host-os-rows-'))
  try {
    const store = new HostConfigStore(path.join(home, 'store.json'))
    store.create({ alias: 'pinned', host: 'p.example', user: 'u', auth: { kind: 'agent' }, os: 'win' })
    store.create({ alias: 'unpinned', host: 'u.example', user: 'u', auth: { kind: 'agent' } })
    // An ~/.ssh/config block the store does not shadow: the fallback row.
    writeFileSync(path.join(home, 'ssh-config'), 'Host confighost\n  HostName c.example\n  User cu\n')
    const hostStore = new HostStore(path.join(home, 'ssh-config'), store)

    const rows = hostStore.rows()
    check('a pinned entry reports its OS', rows.find(row => row.alias === 'pinned')?.os === 'win',
      JSON.stringify(rows.find(row => row.alias === 'pinned')))
    check('an unpinned entry reports no OS (the engine keeps probing)',
      rows.find(row => row.alias === 'unpinned')?.os === undefined,
      JSON.stringify(rows.find(row => row.alias === 'unpinned')))
    check('an ~/.ssh/config row reports no OS (not editable, always auto)',
      rows.find(row => row.alias === 'confighost')?.os === undefined,
      JSON.stringify(rows.find(row => row.alias === 'confighost')))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n[engine: a pinned OS answers without probing]')

// The same doubles dialect-smoke uses; repeated here so this suite stays
// self-contained (the pinned-OS branch lives in engine.js, not shell.js).

/** An ssh2 client double that RECORDS every exec and fails on surprises. */
function execScriptedClient (steps) {
  const calls = []
  const client = {
    exec (command, options, callback) {
      calls.push({ command, options })
      const step = steps.shift()
      if (step === undefined) throw new Error(`unexpected exec: ${command}`)
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
function pooledRecord (alias, client) {
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
  }
}

/** An engine over a temp host store, with one pre-pooled scripted record. */
async function osHarness (alias, entryExtra, steps) {
  const { SshWorkspaceEngine } = await import(pathToFileURL(path.join(pluginRoot, 'lib/engine.js')).href)
  const home = mkdtempSync(path.join(tmpdir(), 'dsh-host-os-engine-'))
  const entryStore = new HostConfigStore(path.join(home, 'store.json'))
  entryStore.create({ alias, host: 'h.example', user: 'u', auth: { kind: 'agent' }, ...entryExtra })
  const engine = new SshWorkspaceEngine({ store: new HostStore(path.join(home, 'ssh-config'), entryStore) })
  const { client, calls } = execScriptedClient(steps)
  engine.pool.set(alias, pooledRecord(alias, client))
  const cleanup = () => { engine.dispose(); rmSync(home, { recursive: true, force: true }) }
  return { engine, calls, cleanup }
}

{
  const { engine, calls, cleanup } = await osHarness('pinned-win', { os: 'win' }, [])
  try {
    const dialect = await engine.remoteDialect('pinned-win')
    check('a pinned win answers cmd', dialect === 'cmd', String(dialect))
    check('a pinned win sends NO probe command', calls.length === 0, JSON.stringify(calls))
  } finally { cleanup() }
}

{
  const { engine, calls, cleanup } = await osHarness('pinned-mac', { os: 'mac' }, [])
  try {
    check('a pinned mac answers posix', await engine.remoteDialect('pinned-mac') === 'posix')
    check('a pinned mac sends NO probe command', calls.length === 0, JSON.stringify(calls))
  } finally { cleanup() }
}

{
  const { engine, calls, cleanup } = await osHarness('pinned-linux', { os: 'linux' }, [])
  try {
    check('a pinned linux answers posix', await engine.remoteDialect('pinned-linux') === 'posix')
    check('a pinned linux sends NO probe command', calls.length === 0, JSON.stringify(calls))
  } finally { cleanup() }
}

{
  const { engine, calls, cleanup } = await osHarness('legacy-win', {}, [{ stdout: 'C:\\Windows\\system32\\cmd.exe\r\n', code: 0 }])
  try {
    check('an unpinned entry still probes (a probe-detected Windows host keeps working)',
      await engine.remoteDialect('legacy-win') === 'cmd')
    check('the unpinned probe is the historical %COMSPEC% expansion',
      calls[0]?.command === 'echo %COMSPEC%', calls[0]?.command)
  } finally { cleanup() }
}

// ---------------------------------------------------------------------------
// The route half drives the REAL handlers with a REAL store underneath.

const coreRoot = process.env.DSH_CORE_ROOT
if (!coreRoot) {
  console.log('  SKIP  DSH_CORE_ROOT is not set (routes.js needs the peer tree)')
  console.log(`\n=== ${passed} passed, ${failures} failed, 1 suite skipped ===`)
  process.exit(failures === 0 ? 0 : 1)
}
process.env.DSH_PEER_ROOT = [coreRoot, process.env.DSH_PEER_ROOT].filter(Boolean).join(path.delimiter)

const { makeRoutes, ROUTES } = await import(pathToFileURL(path.join(pluginRoot, 'lib/routes.js')).href)

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

/** A request double carrying the fields the fence reads. */
function fakeReq (options = {}) {
  const handlers = new Map()
  return {
    method: options.method ?? 'GET',
    url: options.url ?? '/',
    headers: options.headers ?? { host: 'localhost:4074' },
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
}

/** Drive one route and parse its JSON reply. */
async function call (routes, routePath, options = {}) {
  const route = routes.find(candidate => candidate.path === routePath)
  if (route === undefined) throw new Error(`route not registered: ${routePath}`)
  const { res, state } = fakeRes()
  const headers = { host: 'localhost:4074', ...(options.method === 'POST' ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) }
  await route.handler(fakeReq({ headers, ...options, headers }), res)
  let body = undefined
  try { body = JSON.parse(state.body) } catch { body = undefined }
  return { status: state.status, body }
}

/** The minimal editor payload the save route accepts. */
const form = (alias, extra = {}) => ({ alias, host: 'h.example', port: 22, user: 'u', auth: { kind: 'agent' }, ...extra })

console.log('\n[hosts/save + hosts: the route carries the field]')

{
  const home = mkdtempSync(path.join(tmpdir(), 'dsh-host-os-routes-'))
  try {
    const store = new HostConfigStore(path.join(home, 'store.json'))
    const engine = {
      // The real HostStore, so GET /hosts reads the same rows the save wrote.
      store: new HostStore(path.join(home, 'ssh-config'), store),
      forget () {},
      pool: new Map(),
    }
    const routes = makeRoutes({
      engine,
      router: { listRoots: () => [], assertEnabled () {} },
      forwards: { list: () => [] },
      shells: { list: () => [] },
      ctx: { get: () => undefined },
    })
    const hosts = async () => (await call(routes, ROUTES.hosts, { url: ROUTES.hosts })).body.hosts

    {
      const reply = await call(routes, ROUTES.hostSave, { method: 'POST', body: form('win', { os: 'win' }) })
      check('a save with a pinned OS answers ok', reply.status === 200 && reply.body.ok === true, JSON.stringify(reply.body))
      check('the pinned OS reached the store', store.find('win').os === 'win', JSON.stringify(store.find('win')))
      const row = (await hosts()).find(entry => entry.alias === 'win')
      check('GET /hosts surfaces the OS for the editor prefill', row?.os === 'win', JSON.stringify(row))
    }
    {
      const reply = await call(routes, ROUTES.hostSave, { method: 'POST', body: form('aliased', { os: 'macos' }) })
      check('an alias spelling is accepted (the editor only posts canonical values, an API caller need not)',
        reply.body.ok === true && store.find('aliased').os === 'mac', JSON.stringify(store.find('aliased')))
    }
    {
      const reply = await call(routes, ROUTES.hostSave, { method: 'POST', body: form('typo', { os: 'wingdows' }) })
      check('an unknown spelling saves as "auto" instead of failing the form',
        reply.body.ok === true && !Object.hasOwn(store.find('typo'), 'os'), JSON.stringify(store.find('typo')))
    }
    {
      await call(routes, ROUTES.hostSave, { method: 'POST', body: form('clearme', { os: 'linux' }) })
      const cleared = await call(routes, ROUTES.hostSave, { method: 'POST', body: { originalAlias: 'clearme', ...form('clearme', { os: '' }) } })
      check('a blank update (the editor\'s "auto") answers ok', cleared.body.ok === true, JSON.stringify(cleared.body))
      check('the blank dropped the pinned OS', !Object.hasOwn(store.find('clearme'), 'os'), JSON.stringify(store.find('clearme')))
      check('GET /hosts stops reporting the cleared OS',
        (await hosts()).find(entry => entry.alias === 'clearme')?.os === undefined)
    }
    {
      const reply = await call(routes, ROUTES.hostSave, { method: 'POST', body: form('tagon', { aliasTag: true }) })
      check('a save with the tag stores the opt-in (payload whitelist carries the field)',
        reply.body.ok === true && store.find('tagon').aliasTag === true, JSON.stringify(store.find('tagon')))
      const row = (await hosts()).find(entry => entry.alias === 'tagon')
      check('GET /hosts reports the tag on (the editor prefills the checkbox)',
        row?.aliasTag === true, JSON.stringify(row))
    }
    {
      // The editor always posts the boolean, so an absent key is an unchecked
      // box (or an older client) — both mean OFF, never "keep the old value".
      const reply = await call(routes, ROUTES.hostSave, { method: 'POST', body: { originalAlias: 'tagon', ...form('tagon') } })
      check('a save without the key answers ok', reply.body.ok === true, JSON.stringify(reply.body))
      check('the missing key turned the tag off in the store',
        !Object.hasOwn(store.find('tagon'), 'aliasTag'), JSON.stringify(store.find('tagon')))
      check('GET /hosts reports the tag off',
        (await hosts()).find(entry => entry.alias === 'tagon')?.aliasTag === false)
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
