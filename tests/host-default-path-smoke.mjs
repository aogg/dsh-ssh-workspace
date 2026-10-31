/**
 * The host entry's optional `defaultPath`: normalization, storage, and the two
 * routes that carry it.
 *
 * `defaultPath` records where the new-remote-workspace dialog starts browsing
 * on a host. Windows OpenSSH servers spell absolute paths as `/D:/code/www`,
 * so the field must accept both the POSIX and the drive spelling — but a
 * relative path can only resolve on one side of the connection, so it is
 * refused outright (400 from the route, a throw from the store).
 *
 * Two route contracts are easy to break silently and pinned here:
 *   1. the editor always posts the key, so a blank value CLEARS the stored
 *      path while an absent key (an older client) KEEPS it;
 *   2. a refusal happens before the store is touched — a rejected save must
 *      not leave a half-created entry behind.
 *
 * The pure half (normalization + store semantics) runs on a bare checkout;
 * the route half needs the peer tree (routes.js imports remote-fs.js).
 *
 * Run: node tests/host-default-path-smoke.mjs
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

const { normalizeHostDefaultPath, HostConfigStore } = await import(pathToFileURL(path.join(pluginRoot, 'lib/store.js')).href)
const { HostStore } = await import(pathToFileURL(path.join(pluginRoot, 'lib/hosts.js')).href)

console.log('\n=== host default path smoke ===\n')

// ---------------------------------------------------------------------------
console.log('[normalizeHostDefaultPath]')

for (const [input, expected] of [
  [undefined, undefined],
  [null, undefined],
  ['', undefined],
  ['   ', undefined],
  ['D:\\code\\www', '/D:/code/www'],
  ['D:/code', '/D:/code'],
  ['D:', '/D:/'],
  ['/a//b/', '/a/b'],
  ['/', '/'],
  // Outer whitespace is editor noise, never part of the path.
  [' /home/user ', '/home/user'],
  // The bare drive root's canonical spelling is `/D:/` with the trailing
  // slash — that spelling is already canonical and normalizes to itself.
  ['/D:/', '/D:/'],
]) {
  check(`${JSON.stringify(input)} normalizes to ${JSON.stringify(expected)}`,
    normalizeHostDefaultPath(input) === expected,
    JSON.stringify(normalizeHostDefaultPath(input)))
}

{
  let thrown
  try { normalizeHostDefaultPath('relative/path') } catch (error) { thrown = error }
  check('a relative path throws', thrown instanceof Error, String(thrown))
  check('the refusal names absoluteness and shows an example',
    thrown instanceof Error && thrown.message.includes('absolute') && thrown.message.includes('/home/user'),
    thrown?.message)
}

// ---------------------------------------------------------------------------
console.log('\n[store semantics]')
//
// Written straight through the store (no HTTP): the stored entry is what the
// routes read back, so the field must normalize on create AND obey the
// blank/absent merge rules on update.

{
  const home = mkdtempSync(path.join(tmpdir(), 'dsh-default-path-store-'))
  try {
    const store = new HostConfigStore(path.join(home, 'store.json'))

    const win = store.create({ alias: 'win', host: 'w.example', user: 'u', auth: { kind: 'agent' }, defaultPath: 'D:\\code\\www' })
    check('create stores the normalized drive path', win.defaultPath === '/D:/code/www', JSON.stringify(win.defaultPath))
    const stored = JSON.parse(readFileSync(store.path, 'utf8')).hosts.find(entry => entry.alias === 'win')
    check('the normalized value is what reaches the document', stored.defaultPath === '/D:/code/www', JSON.stringify(stored))

    const bare = store.create({ alias: 'bare', host: 'b.example', user: 'u', auth: { kind: 'agent' } })
    check('a create without the key stores an entry without the key (older-version shape)',
      !Object.hasOwn(bare, 'defaultPath'), JSON.stringify(Object.keys(bare)))

    store.update('bare', { defaultPath: '' })
    check('a blank update still leaves no key behind', !Object.hasOwn(store.find('bare'), 'defaultPath'))

    store.update('win', { description: 'touched' })
    check('an update without the key keeps the stored path',
      store.find('win').defaultPath === '/D:/code/www', JSON.stringify(store.find('win').defaultPath))

    store.update('win', { defaultPath: '/srv/data/' })
    check('an update replaces the stored path (and drops the trailing slash)',
      store.find('win').defaultPath === '/srv/data', JSON.stringify(store.find('win').defaultPath))

    let thrown
    try { store.create({ alias: 'bad', host: 'h', user: 'u', auth: { kind: 'agent' }, defaultPath: 'nope' }) } catch (error) { thrown = error }
    check('a relative create throws out of the store', thrown instanceof Error, String(thrown))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// The route half drives the REAL handlers with a REAL store underneath, the
// same way agent-prompts-routes-smoke does.

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

/** The engine stubs every route needs besides the host store. */
const routeDeps = (engine) => ({
  engine,
  router: { listRoots: () => [], assertEnabled () {} },
  forwards: { list: () => [] },
  shells: { list: () => [] },
  ctx: { get: () => undefined },
})

console.log('\n[hosts/save + hosts: the route carries the field]')

{
  const home = mkdtempSync(path.join(tmpdir(), 'dsh-default-path-routes-'))
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
      const reply = await call(routes, ROUTES.hostSave, { method: 'POST', body: form('win', { defaultPath: 'D:\\code\\www' }) })
      check('a save with a drive spelling answers ok', reply.status === 200 && reply.body.ok === true, JSON.stringify(reply.body))
      check('the normalized path reached the store', store.find('win').defaultPath === '/D:/code/www', JSON.stringify(store.find('win')))
      const row = (await hosts()).find(entry => entry.alias === 'win')
      check('GET /hosts surfaces defaultPath for the dialog prefill', row?.defaultPath === '/D:/code/www', JSON.stringify(row))
    }
    {
      const reply = await call(routes, ROUTES.hostSave, { method: 'POST', body: form('mix', { defaultPath: 'D:/code' }) })
      check('a repairable drive spelling is accepted (not just the normalized form)',
        reply.body.ok === true && store.find('mix').defaultPath === '/D:/code', JSON.stringify(reply.body))
    }
    {
      const before = store.load().length
      const reply = await call(routes, ROUTES.hostSave, { method: 'POST', body: form('fresh', { defaultPath: 'relative/path' }) })
      check('a relative path answers 400', reply.status === 400, `${reply.status} ${JSON.stringify(reply.body)}`)
      check('the 400 explains absoluteness', String(reply.body.error).includes('absolute'), JSON.stringify(reply.body))
      check('the refused save left no entry behind', store.load().length === before && store.find('fresh') === undefined)
    }
    {
      const reply = await call(routes, ROUTES.hostSave, { method: 'POST', body: form('typed', { defaultPath: 42 }) })
      check('a non-string path answers 400 too (the type guard is reachable from the route)',
        reply.status === 400 && store.find('typed') === undefined, `${reply.status} ${JSON.stringify(reply.body)}`)
    }
    {
      await call(routes, ROUTES.hostSave, { method: 'POST', body: form('clearme', { defaultPath: '/home/user' }) })
      const cleared = await call(routes, ROUTES.hostSave, { method: 'POST', body: { originalAlias: 'clearme', ...form('clearme', { defaultPath: '' }) } })
      check('a blank update answers ok', cleared.body.ok === true, JSON.stringify(cleared.body))
      check('the blank cleared the stored path', !Object.hasOwn(store.find('clearme'), 'defaultPath'), JSON.stringify(store.find('clearme')))
      check('GET /hosts stops offering the cleared path',
        (await hosts()).find(entry => entry.alias === 'clearme')?.defaultPath === undefined)
    }
    {
      await call(routes, ROUTES.hostSave, { method: 'POST', body: form('keepme', { defaultPath: '/srv/data' }) })
      // An older client does not know the key: its update payload omits it.
      const kept = await call(routes, ROUTES.hostSave, { method: 'POST', body: { originalAlias: 'keepme', ...form('keepme', { description: 'touched' }) } })
      check('an update without the key keeps the stored path (old-client semantics)',
        kept.body.ok === true && store.find('keepme').defaultPath === '/srv/data', JSON.stringify(store.find('keepme')))
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

console.log('\n[hosts/default-path: the after-mount record route]')
//
// The new-remote-workspace dialog posts here after a successful mount when
// the user asked to remember the directory. The patch carries ONLY
// `{ alias, path }` — no auth, no host — so the contract under test is the
// partial-patch one: normalize, refuse before the store is touched, then
// merge without disturbing anything else stored about the host.

{
  const home = mkdtempSync(path.join(tmpdir(), 'dsh-default-path-patch-'))
  try {
    // A password-auth entry exercises the part a careless patch would break:
    // the update carries no auth key, so the store must walk the secretFor
    // preservation branch and keep the stored secret. The codec is bound to
    // a key file inside the temp home so the suite never touches ~/.dsh.
    const { SecretCodec } = await import(pathToFileURL(path.join(pluginRoot, 'lib/secrets.js')).href)
    const codec = new SecretCodec({ path: path.join(home, 'secrets.key') })
    const store = new HostConfigStore(path.join(home, 'store.json'), codec)
    store.create({
      alias: 'win', host: 'w.example', port: 2222, user: 'deploy',
      auth: { kind: 'password', password: 's3cret-pw' }, description: 'prod box',
    })
    // A second alias that exists ONLY in ~/.ssh/config gets its own refusal
    // wording (that file is never edited by this plugin).
    const configPath = path.join(home, 'ssh-config')
    writeFileSync(configPath, 'Host cfgonly\n  HostName c.example\n  User cfguser\n')
    const engine = { store: new HostStore(configPath, store), forget () {}, pool: new Map() }
    const routes = makeRoutes(routeDeps(engine))

    {
      const reply = await call(routes, ROUTES.hostDefaultPath, { method: 'POST', body: { alias: 'win', path: 'D:\\code' } })
      const after = store.find('win')
      check('a record answers ok with the normalized drive spelling',
        reply.status === 200 && reply.body.ok === true && reply.body.defaultPath === '/D:/code',
        `${reply.status} ${JSON.stringify(reply.body)}`)
      check('the stored value is the same normalized spelling the reply names',
        after.defaultPath === '/D:/code' && reply.body.defaultPath === after.defaultPath, JSON.stringify(after))
      check('the rest of the entry is untouched by the one-key patch',
        after.host === 'w.example' && after.port === 2222 && after.user === 'deploy' && after.description === 'prod box',
        JSON.stringify(after))
      check('auth survives a patch that carries no auth key', after.auth?.kind === 'password', JSON.stringify(after.auth))
      // The whole point of the secretFor preservation branch: a default-path
      // patch must not silently drop the password stored beside the entry.
      check('the stored secret survives the patch', store.secretFor('win')?.password === 's3cret-pw',
        JSON.stringify(store.secretFor('win')))
    }
    {
      // An older client (or a different caller) omits the key entirely.
      const reply = await call(routes, ROUTES.hostDefaultPath, { method: 'POST', body: { alias: 'win' } })
      check('a body without the path key keeps the stored path (merge semantics)',
        reply.status === 200 && reply.body.ok === true && reply.body.defaultPath === '/D:/code' &&
        store.find('win').defaultPath === '/D:/code', `${reply.status} ${JSON.stringify(reply.body)}`)
    }
    {
      const reply = await call(routes, ROUTES.hostDefaultPath, { method: 'POST', body: { alias: 'win', path: '   ' } })
      check('a blank path answers ok with null (the wire spelling of "not set")',
        reply.status === 200 && reply.body.ok === true && reply.body.defaultPath === null,
        `${reply.status} ${JSON.stringify(reply.body)}`)
      check('the cleared entry carries no defaultPath key at all',
        !Object.hasOwn(store.find('win'), 'defaultPath'), JSON.stringify(store.find('win')))
    }
    {
      const reply = await call(routes, ROUTES.hostDefaultPath, { method: 'POST', body: { alias: 'win', path: 'relative/path' } })
      check('a relative path answers 400 with the absoluteness explanation',
        reply.status === 400 && String(reply.body.error).includes('absolute'), `${reply.status} ${JSON.stringify(reply.body)}`)
      check('the refused patch left the stored entry alone', store.find('win').defaultPath === undefined)
    }
    {
      const reply = await call(routes, ROUTES.hostDefaultPath, { method: 'POST', body: { alias: 'win', path: 42 } })
      check('a non-string path answers 400 too', reply.status === 400, `${reply.status} ${JSON.stringify(reply.body)}`)
    }
    {
      const blank = await call(routes, ROUTES.hostDefaultPath, { method: 'POST', body: { alias: '   ', path: '/srv' } })
      const missing = await call(routes, ROUTES.hostDefaultPath, { method: 'POST', body: { path: '/srv' } })
      check('a blank alias answers 400 naming the requirement',
        blank.status === 400 && blank.body.error === 'alias is required', `${blank.status} ${JSON.stringify(blank.body)}`)
      check('a missing alias is the same refusal',
        missing.status === 400 && missing.body.error === 'alias is required', `${missing.status} ${JSON.stringify(missing.body)}`)
    }
    {
      const reply = await call(routes, ROUTES.hostDefaultPath, { method: 'POST', body: { alias: 'ghost', path: '/srv' } })
      check('an unknown alias answers 400 naming the editable store',
        reply.status === 400 && String(reply.body.error).includes('not in the editable host store'),
        `${reply.status} ${JSON.stringify(reply.body)}`)
    }
    {
      const reply = await call(routes, ROUTES.hostDefaultPath, { method: 'POST', body: { alias: 'cfgonly', path: '/srv' } })
      check('an ~/.ssh/config alias answers 400 with the read-only fallback wording',
        reply.status === 400 && String(reply.body.error).includes('~/.ssh/config'),
        `${reply.status} ${JSON.stringify(reply.body)}`)
    }
    {
      // Storage failures answer hostSave-style: 200 with ok:false, never a 500 —
      // the workspace is already mounted, so the record step must not read as a
      // server error.
      class BrokenStore extends HostConfigStore {
        update () { throw new Error('storage exploded') }
      }
      // Same file, so find() still sees the entry and only update() is broken.
      const broken = new BrokenStore(path.join(home, 'store.json'), codec)
      const brokenRoutes = makeRoutes(routeDeps({ store: new HostStore(configPath, broken), forget () {}, pool: new Map() }))
      const reply = await call(brokenRoutes, ROUTES.hostDefaultPath, { method: 'POST', body: { alias: 'win', path: '/srv' } })
      check('a storage failure answers 200 with ok:false and the reason',
        reply.status === 200 && reply.body.ok === false && String(reply.body.error).includes('storage exploded'),
        `${reply.status} ${JSON.stringify(reply.body)}`)
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
