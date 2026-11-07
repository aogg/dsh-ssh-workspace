/**
 * The floating-workspace section: storage, naming, and the five routes.
 *
 * A floating remote is one project's own SSH remote — configured from that
 * project's sidebar ⋯ menu and shown as a card instead of a permanent row. The
 * contracts pinned here are the ones that go wrong quietly:
 *
 *   1. `floating` shares `dsh-ssh.json` with the shared host list, so a damaged
 *      entry must cost that entry and never the hosts;
 *   2. the add dialog has NO name field — the name is derived
 *      (`basename · alias`) and de-duplicated inside the parent, and that rule
 *      must survive both a create and a rename;
 *   3. the routes have to join stored paths with live state (mounted /
 *      registered / host missing / parent missing) instead of guessing;
 *   4. deleting an entry may also deregister its DSH workspace, which must go
 *      through the same teardown the panel's unmount uses.
 *
 * The store half runs on a bare checkout; the route half needs the peer tree
 * (routes.js imports remote-fs.js), exactly like routes-smoke.
 *
 * Run: node tests/floating-store-smoke.mjs
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

console.log('\n=== floating store smoke ===\n')

const { floatingOf, autoFloatingTitle, uniqueFloatingTitle, HostConfigStore } =
  await import(pathToFileURL(path.join(pluginRoot, 'lib/store.js')).href)

// ---------------------------------------------------------------------------
console.log('[autoFloatingTitle]')

check('basename and alias make the name', autoFloatingTitle('/home/u/proj', 'box') === 'proj · box', autoFloatingTitle('/home/u/proj', 'box'))
check('trailing slashes do not leak into the name', autoFloatingTitle('/home/u/proj/', 'box') === 'proj · box', autoFloatingTitle('/home/u/proj/', 'box'))
check('a Windows drive path keeps its directory name', autoFloatingTitle('/D:/code/www', 'win') === 'www · win', autoFloatingTitle('/D:/code/www', 'win'))
check('the bare drive root reads as its drive', autoFloatingTitle('/D:/', 'win') === 'D: · win', autoFloatingTitle('/D:/', 'win'))
check('the remote root has no basename, so the alias alone stands in', autoFloatingTitle('/', 'box') === 'box', autoFloatingTitle('/', 'box'))
check('an empty path degrades to the alias', autoFloatingTitle('', 'box') === 'box', autoFloatingTitle('', 'box'))

console.log('\n[uniqueFloatingTitle]')

check('a free name is returned unchanged', uniqueFloatingTitle([], 'proj · box') === 'proj · box')
check('a taken name gets #2', uniqueFloatingTitle(['proj · box'], 'proj · box') === 'proj · box #2', uniqueFloatingTitle(['proj · box'], 'proj · box'))
check('a taken #2 goes on to #3', uniqueFloatingTitle(['proj · box', 'proj · box #2'], 'proj · box') === 'proj · box #3')
check('non-string siblings are ignored, not compared', uniqueFloatingTitle([undefined, null, 7], 'x') === 'x')

// ---------------------------------------------------------------------------
console.log('\n[floatingOf: one damaged entry costs one entry]')

{
  const document = {
    floating: [
      { id: 'f1', parentId: 'w-parent', parentPath: 'ssh://box/parent', alias: 'box', remotePath: '/srv/a/', order: 2 },
      { id: 'f2', parentId: 'w-parent', alias: 'box', remotePath: '/srv/b', title: 'Mine', order: 1 },
      null,
      'junk',
      [],
      { id: '', parentId: 'w-parent', alias: 'box', remotePath: '/srv/c' },
      { id: 'f3', parentId: '', alias: 'box', remotePath: '/srv/c' },
      { id: 'f4', parentId: 'w-parent', alias: 'box', remotePath: 'relative/path' },
      { id: 'f1', parentId: 'w-parent', alias: 'box', remotePath: '/srv/duplicate-id' },
    ],
    hosts: [{ alias: 'box' }],
  }
  const items = floatingOf(document)
  check('only the usable entries survive', items.length === 2, JSON.stringify(items.map(item => item.id)))
  check('entries come back in order, not file order',
    JSON.stringify(items.map(item => item.id)) === JSON.stringify(['f2', 'f1']),
    JSON.stringify(items.map(item => item.id)))
  check('a missing title is derived, never left blank', items.find(item => item.id === 'f1')?.title === 'a · box')
  check('an explicit title wins', items.find(item => item.id === 'f2')?.title === 'Mine')
  check('a missing parentPath normalizes to an empty string', items.find(item => item.id === 'f2')?.parentPath === '')
  check('a relative remotePath is dropped, not guessed', !items.some(item => item.id === 'f4'))
  check('duplicate ids keep the first occurrence', !items.some(item => item.remotePath === '/srv/duplicate-id'))
  check('the section is a plain array, and a missing one is empty',
    Array.isArray(floatingOf({})) && floatingOf({}).length === 0 && floatingOf({ floating: 'junk' }).length === 0)
}

// ---------------------------------------------------------------------------
console.log('\n[HostConfigStore: create / rename / reorder / delete]')

const dir = mkdtempSync(path.join(tmpdir(), 'dsh-floating-'))
const file = path.join(dir, 'dsh-ssh.json')
try {
  const store = new HostConfigStore(file)
  // A foreign section and the shared host list must survive every write.
  store.save([{ alias: 'box', host: 'box.example', port: 22, user: 'u', auth: { kind: 'agent' }, custom: 'keep' }])
  store.disableWorkspace('ssh://box/srv/keep')

  const a = store.putFloating({ parentId: 'w-parent', parentPath: 'ssh://box/parent', alias: 'box', remotePath: '/srv/a' })
  const b = store.putFloating({ parentId: 'w-parent', alias: 'box', remotePath: '/srv/b' })
  const other = store.putFloating({ parentId: 'w-other', alias: 'box', remotePath: '/srv/a' })
  check('a create derives its name', a.title === 'a · box' && b.title === 'b · box', `${a.title} / ${b.title}`)
  check('the same directory under another parent is a separate entry with its own name',
    other.title === 'a · box' && other.parentId === 'w-other')
  check('new entries append (order 0, 1)', a.order === 0 && b.order === 1, `${a.order},${b.order}`)

  const clashing = store.putFloating({ parentId: 'w-parent', alias: 'box', remotePath: '/srv/a' })
  check('a second entry with the same auto name gets #2', clashing.title === 'a · box #2', clashing.title)
  store.deleteFloating(clashing.id)

  const renamed = store.updateFloating(b.id, { title: 'a · box' })
  check('a rename that collides is de-duplicated too', renamed.title === 'a · box #2', renamed.title)
  const renamedBack = store.updateFloating(b.id, { title: 'Beta' })
  check('a free rename is taken literally', renamedBack.title === 'Beta', renamedBack.title)

  store.reorderFloating('w-parent', [b.id, a.id])
  const ordered = store.floating().filter(item => item.parentId === 'w-parent')
  check('reorder renumbers the requested parent', ordered[0].id === b.id && ordered[1].id === a.id,
    ordered.map(item => item.id).join(','))
  check('reorder leaves other parents alone',
    store.floating().filter(item => item.parentId === 'w-other').length === 1)

  check('delete removes exactly one entry', store.deleteFloating(a.id) === true && store.floating().length === 2)
  check('deleting an unknown id is a no-op', store.deleteFloating('nope') === false)

  const document = JSON.parse(readFileSync(file, 'utf8'))
  check('the shared host list survives the floating writes',
    document.hosts.length === 1 && document.hosts[0].custom === 'keep', JSON.stringify(document.hosts))
  check('the detached-workspace list survives too',
    JSON.stringify(document.workspaces?.disabled) === JSON.stringify(['ssh://box/srv/keep']),
    JSON.stringify(document.workspaces))
  check('an unreadable floating section degrades to empty without losing hosts', (() => {
    const broken = path.join(dir, 'broken.json')
    const fsBroken = new HostConfigStore(broken)
    fsBroken.save([{ alias: 'box2', host: 'h', port: 22, user: 'u', auth: { kind: 'agent' } }])
    const raw = JSON.parse(readFileSync(broken, 'utf8'))
    raw.floating = 'junk'
    // Write the damaged document behind the store's back (a hand-edited file).
    writeFileSync(broken, JSON.stringify(raw))
    return fsBroken.floating().length === 0 && fsBroken.load().length === 1
  })())
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Route half. Needs the peer tree because routes.js imports remote-fs.js.
const coreRoot = process.env.DSH_CORE_ROOT
if (!coreRoot) {
  console.log('  SKIP  DSH_CORE_ROOT is not set (routes.js needs the DSH peer tree)')
  console.log(`\n=== ${passed} passed, ${failures} failed, 1 route section skipped ===`)
  process.exit(failures === 0 ? 0 : 1)
}
process.env.DSH_PEER_ROOT = [coreRoot, process.env.DSH_PEER_ROOT].filter(Boolean).join(path.delimiter)

const { makeRoutes, ROUTES } = await import(pathToFileURL(path.join(pluginRoot, 'lib/routes.js')).href)

function fakeRes () {
  const state = { status: undefined, headers: undefined, body: '', headersSent: false }
  const res = {
    get headersSent () { return state.headersSent },
    writeHead (status, headers) {
      state.status = status
      state.headers = headers
      state.headersSent = true
      return res
    },
    write (chunk) { state.body += String(chunk); return true },
    end (chunk) { if (chunk !== undefined) state.body += String(chunk); return res },
    on () {},
  }
  return { res, state }
}

function fakeReq (options = {}) {
  const handlers = new Map()
  return {
    method: options.method ?? 'GET',
    url: options.url ?? '/',
    headers: options.headers ?? { host: 'localhost:4074' },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1', localPort: 4074 },
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

const JSON_HEADERS = { host: 'localhost:4074', 'content-type': 'application/json' }

/** The fixture every route case starts from. */
function makeWorld (options = {}) {
  const dir2 = mkdtempSync(path.join(tmpdir(), 'dsh-floating-routes-'))
  const store = new HostConfigStore(path.join(dir2, 'dsh-ssh.json'))
  store.save([
    { alias: 'box', host: 'box.example', port: 22, user: 'u', auth: { kind: 'agent' } },
    { alias: 'box2', host: 'box2.example', port: 2222, user: 'u', auth: { kind: 'agent' } },
  ])
  const calls = { disabled: [], enabled: [], deleted: [], archived: [] }
  const entities = [
    { id: 'w-parent', path: '/code/proj', title: 'Proj', sessionIds: [] },
    { id: 'w-alpha', path: 'ssh://box/srv/alpha', title: 'Alpha', sessionIds: ['s1', 's2'] },
  ]
  const registry = {
    list: () => entities,
    delete: async (id) => { calls.deleted.push(id); const index = entities.findIndex(entity => entity.id === id); if (index >= 0) entities.splice(index, 1) },
    archiveSession: async (id) => { calls.archived.push(id) },
  }
  const router = {
    listRoots: () => (options.roots ?? ['ssh://box/srv/alpha']),
    listDisabled: () => (options.disabled ?? []),
    addRoot: (alias, remotePath) => `ssh://${alias}${remotePath}`,
    disableRoot: (workspacePath) => { calls.disabled.push(workspacePath); return true },
    enableRoot: (workspacePath) => { calls.enabled.push(workspacePath); return true },
  }
  const engine = {
    store: {
      rows: () => store.load().map(entry => ({
        alias: entry.alias,
        host: entry.host,
        port: entry.port,
        user: entry.user,
        source: 'store',
      })),
      entryStore: store,
    },
    withSftp: async () => { throw new Error('withSftp should not be reached from the floating routes') },
  }
  const ctx = { get: (name) => (name === 'workspaceRegistry' ? registry : undefined) }
  const routes = makeRoutes({ engine, router, ctx })
  const routeOf = (routePath) => routes.find(route => route.path === routePath)
  const cleanup = () => rmSync(dir2, { recursive: true, force: true })
  return { store, calls, entities, registry, routes, routeOf, cleanup }
}

async function call (routePath, request) {
  const world = makeWorld(request.worldOptions)
  const route = world.routeOf(routePath)
  const { res, state } = fakeRes()
  await route.handler(fakeReq({ url: routePath, ...request }), res)
  let body
  try { body = JSON.parse(state.body) } catch { body = undefined }
  world.cleanup()
  return { status: state.status, body }
}

console.log('\n[floating/list joins live state]')

{
  const world = makeWorld({ roots: ['ssh://box/srv/alpha'] })
  world.store.putFloating({ parentId: 'w-parent', parentPath: '/code/proj', alias: 'box', remotePath: '/srv/alpha' })
  world.store.putFloating({ parentId: 'w-parent', alias: 'ghost', remotePath: '/srv/x' })
  world.store.putFloating({ parentId: 'w-deleted-parent', alias: 'box2', remotePath: '/srv/y' })
  const { res, state } = fakeRes()
  await world.routeOf(ROUTES.floatingList).handler(fakeReq({ url: ROUTES.floatingList }), res)
  const body = JSON.parse(state.body)
  world.cleanup()
  const alpha = body.items.find(item => item.remotePath === '/srv/alpha')
  const ghost = body.items.find(item => item.remotePath === '/srv/x')
  const orphan = body.items.find(item => item.remotePath === '/srv/y')
  check('the list answers every stored entry', body.items.length === 3)
  check('a registered workspace carries its id and title',
    alpha.workspaceId === 'w-alpha' && alpha.registered === true && alpha.workspaceTitle === 'Alpha',
    JSON.stringify(alpha))
  check('a served path is reported mounted', alpha.mounted === true && alpha.disabled === false)
  check('the ssh:// spelling is assembled, not stored twice', alpha.workspacePath === 'ssh://box/srv/alpha')
  check('the host address is joined for display', alpha.hostAddr === 'u@box.example', alpha.hostAddr)
  check('…and the bare target is joined too (the menu spells alias@host)',
    alpha.hostTarget === 'box.example', String(alpha.hostTarget))
  check('a non-default port is shown', ghost.hostMissing === true)
  check('an alias no longer in the host list is flagged missing', ghost.hostMissing === true)
  check('a parent that is gone is flagged, not silently accepted',
    orphan.parentMissing === true, JSON.stringify(orphan))
  check('an existing parent is not flagged', alpha.parentMissing === false)
}

console.log('\n[floating/list?parentId=…]')

{
  const world = makeWorld()
  world.store.putFloating({ parentId: 'w-parent', alias: 'box', remotePath: '/srv/alpha' })
  world.store.putFloating({ parentId: 'w-parent2', alias: 'box', remotePath: '/srv/beta' })
  const { res, state } = fakeRes()
  await world.routeOf(ROUTES.floatingList).handler(fakeReq({ url: `${ROUTES.floatingList}?parentId=w-parent` }), res)
  const body = JSON.parse(state.body)
  world.cleanup()
  check('the parent filter narrows the reply', body.items.length === 1 && body.items[0].parentId === 'w-parent')
}

console.log('\n[floating/save]')

{
  const world = makeWorld()
  const route = world.routeOf(ROUTES.floatingSave)
  const send = async (body) => {
    const { res, state } = fakeRes()
    await route.handler(fakeReq({ method: 'POST', url: ROUTES.floatingSave, headers: JSON_HEADERS, body }), res)
    return { status: state.status, body: JSON.parse(state.body) }
  }
  const created = await send({ parentId: 'w-parent', parentPath: '/code/proj', alias: 'box', remotePath: '/srv/alpha' })
  check('a save creates the entry with a derived name',
    created.status === 200 && created.body.created === true && created.body.item.title === 'alpha · box',
    JSON.stringify(created.body))
  const again = await send({ parentId: 'w-parent', parentPath: '/code/proj', alias: 'box', remotePath: '/srv/alpha' })
  check('configuring the same path twice returns the same entry (no twin)',
    again.body.created === false && again.body.item.id === created.body.item.id)
  const badHost = await send({ parentId: 'w-parent', alias: 'nope', remotePath: '/srv/alpha' })
  check('an unknown host is refused instead of stored', badHost.status === 400 && /unknown SSH host/.test(badHost.body.error), JSON.stringify(badHost.body))
  const badPath = await send({ parentId: 'w-parent', alias: 'box', remotePath: 'srv/alpha' })
  check('a relative remote path is refused', badPath.status === 400 && /absolute/.test(badPath.body.error), JSON.stringify(badPath.body))
  const missing = await send({ alias: 'box', remotePath: '/srv/alpha' })
  check('a missing parent is refused', missing.status === 400, JSON.stringify(missing.body))
  world.cleanup()
}

console.log('\n[floating/update]')

{
  const world = makeWorld()
  const item = world.store.putFloating({ parentId: 'w-parent', alias: 'box', remotePath: '/srv/alpha' })
  const route = world.routeOf(ROUTES.floatingUpdate)
  const send = async (body, headers = JSON_HEADERS) => {
    const { res, state } = fakeRes()
    await route.handler(fakeReq({ method: 'POST', url: ROUTES.floatingUpdate, headers, body }), res)
    return { status: state.status, body: JSON.parse(state.body) }
  }
  const renamed = await send({ id: item.id, title: 'Alpha Prod' })
  check('a rename changes the stored title', renamed.body.item.title === 'Alpha Prod', JSON.stringify(renamed.body))
  const unknown = await send({ id: 'nope', title: 'x' })
  check('an unknown id answers 404', unknown.status === 404, JSON.stringify(unknown.body))
  const noType = await send({ id: item.id, title: 'x' }, { host: 'localhost:4074', 'content-type': 'text/plain' })
  check('a POST without a JSON content type is refused (415)', noType.status === 415, JSON.stringify(noType.body))
  const wrongMethod = await (async () => {
    const { res, state } = fakeRes()
    await route.handler(fakeReq({ method: 'GET', url: ROUTES.floatingUpdate }), res)
    return state.status
  })()
  check('a GET on a POST route answers 405', wrongMethod === 405, String(wrongMethod))
  world.cleanup()
}

console.log('\n[floating/delete]')

{
  const world = makeWorld()
  // `/srv/alpha` is the registered workspace in the fixture; `/srv/beta` is not,
  // so the two deletes exercise both the plain and the deregistering path.
  const keep = world.store.putFloating({ parentId: 'w-parent', alias: 'box', remotePath: '/srv/beta' })
  const gone = world.store.putFloating({ parentId: 'w-parent', alias: 'box', remotePath: '/srv/alpha' })
  const route = world.routeOf(ROUTES.floatingDelete)
  const send = async (body) => {
    const { res, state } = fakeRes()
    await route.handler(fakeReq({ method: 'POST', url: ROUTES.floatingDelete, headers: JSON_HEADERS, body }), res)
    return { status: state.status, body: JSON.parse(state.body) }
  }
  const plain = await send({ id: keep.id })
  check('deleting without the checkbox only drops the configuration',
    plain.body.ok === true && world.calls.deleted.length === 0 && world.calls.disabled.length === 0,
    JSON.stringify({ body: plain.body, calls: world.calls }))
  check('the other entry is untouched', world.store.floating().some(entry => entry.id === gone.id))

  const withTeardown = await send({ id: gone.id, deregister: true })
  check('the checkbox deregisters the DSH workspace',
    withTeardown.body.deregistered === true && world.calls.deleted.includes('w-alpha'),
    JSON.stringify({ body: withTeardown.body, calls: world.calls }))
  check('the teardown fences the root and clears the detached mark',
    world.calls.disabled.includes('ssh://box/srv/alpha') && world.calls.enabled.includes('ssh://box/srv/alpha'),
    JSON.stringify(world.calls))
  check('…and archives the workspace\'s sessions',
    JSON.stringify(world.calls.archived) === JSON.stringify(['s1', 's2']), JSON.stringify(world.calls.archived))
  check('the configuration goes away with it', world.store.floating().length === 0)
  world.cleanup()
}

console.log('\n[floating/reorder]')

{
  const world = makeWorld()
  const a = world.store.putFloating({ parentId: 'w-parent', alias: 'box', remotePath: '/srv/a' })
  const b = world.store.putFloating({ parentId: 'w-parent', alias: 'box', remotePath: '/srv/b' })
  const { res, state } = fakeRes()
  await world.routeOf(ROUTES.floatingReorder).handler(fakeReq({
    method: 'POST',
    url: ROUTES.floatingReorder,
    headers: JSON_HEADERS,
    body: { parentId: 'w-parent', ids: [b.id, a.id] },
  }), res)
  const body = JSON.parse(state.body)
  check('the reply is in the new order', body.items[0].id === b.id && body.items[1].id === a.id,
    JSON.stringify(body.items.map(item => item.id)))
  check('the stored order follows', world.store.floating()[0].id === b.id)
  world.cleanup()
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
