/**
 * Route-level checks for the transfer/download surface.
 *
 * The `download` route is the one route that streams raw bytes instead of
 * answering JSON, which means it deliberately bypasses the shared `guard()`
 * helper and re-applies the fence itself. That makes its refusals worth testing
 * directly: a missing loopback check here would serve arbitrary remote files to
 * any web page that can reach the port.
 *
 * These tests drive the registered handler objects with synthetic request and
 * response doubles, so no server and no SSH host are involved.
 *
 * Run: node tests/routes-smoke.mjs
 */

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// routes.js pulls the SFTP primitives from remote-fs.js, which resolves the DSH
// peer packages; the suite needs the assembled tree even though it never opens
// a connection.
const coreRoot = process.env.DSH_CORE_ROOT
if (!coreRoot) {
  console.log('\n=== routes smoke ===\n')
  console.log('  SKIP  DSH_CORE_ROOT is not set (needs @deepseek-ai/dsh-fs)')
  console.log('\n=== 0 passed, 0 failed, 1 suite skipped ===')
  process.exit(0)
}
process.env.DSH_PEER_ROOT = [coreRoot, process.env.DSH_PEER_ROOT].filter(Boolean).join(path.delimiter)

const { makeRoutes, ROUTES } = await import(pathToFileURL(path.join(pluginRoot, 'lib/routes.js')).href)

let passed = 0
let failures = 0
function check (label, ok, detail) {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`) } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/** A response double that records what the handler wrote. */
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

/** A request double carrying the fields the fence reads. */
function fakeReq (options = {}) {
  const url = new URL(options.url ?? '/', 'http://localhost')
  const handlers = new Map()
  return {
    method: options.method ?? 'GET',
    url: options.url ?? '/',
    headers: options.headers ?? {},
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1', localPort: options.localPort ?? 4074 },
    on (event, handler) { handlers.set(event, handler) },
  }
}

/** A fake engine that serves one in-memory file. */
function fakeEngine (files) {
  const state = { opened: 0, closed: 0 }
  return {
    state,
    async withSftp (_alias, work) {
      return await work({
        stat (target, callback) {
          if (!files.has(target)) { callback(Object.assign(new Error('no such file'), { code: 2 })); return }
          const content = files.get(target)
          callback(null, { size: content.length, isDirectory: () => false, mode: 0o100644 })
        },
        open (target, flags, callback) {
          state.opened += 1
          const content = files.get(target)
          if (content === undefined) { callback(Object.assign(new Error('no such file'), { code: 2 })); return }
          callback(null, { __content: content, __position: 0 })
        },
        read (handle, buffer, offset, length, position, callback) {
          const slice = handle.__content.subarray(position, position + length)
          slice.copy(buffer, offset)
          callback(null, slice.length, buffer)
        },
        close (_handle, callback) { state.closed += 1; callback(null) },
      })
    },
  }
}

console.log('\n=== routes smoke ===\n')

const engine = fakeEngine(new Map([
  ['/srv/report.txt', Buffer.from('hello from the remote host')],
]))
const forwards = { list: () => [], open: async () => ({}), close: () => false }
const shells = { list: () => [], run: async () => ({}), close: () => 0 }
const routes = makeRoutes({ engine, router: {}, forwards, shells, ctx: { get: () => undefined } })
const download = routes.find(route => route.path === ROUTES.download)

check('the download route is registered', download !== undefined)
check('the transfer route is registered', routes.some(route => route.path === ROUTES.transfer))

{
  const { res, state } = fakeRes()
  await download.handler(fakeReq({ remoteAddress: '10.0.0.5' }), res)
  check('a non-loopback request is refused', state.status === 403, String(state.status))
}

{
  const { res, state } = fakeRes()
  await download.handler(fakeReq({ headers: { host: 'evil.example:4074' } }), res)
  check('a rebinding Host header is refused', state.status === 403, String(state.status))
}

{
  const { res, state } = fakeRes()
  await download.handler(fakeReq({ method: 'POST', headers: { host: 'localhost:4074' } }), res)
  check('a non-GET method is refused', state.status === 405, String(state.status))
}

{
  const { res, state } = fakeRes()
  await download.handler(fakeReq({ url: `${ROUTES.download}?alias=a`, headers: { host: 'localhost:4074' } }), res)
  check('a missing path is refused', state.status === 400, String(state.status))
}

{
  const { res, state } = fakeRes()
  await download.handler(fakeReq({
    url: `${ROUTES.download}?alias=a&path=${encodeURIComponent('/srv/report.txt')}`,
    headers: { host: 'localhost:4074' },
  }), res)
  check('a valid request streams the file', state.status === 200, String(state.status))
  check('the body is the remote content', state.body === 'hello from the remote host', JSON.stringify(state.body))
  check('the response declares a download disposition',
    String(state.headers?.['content-disposition'] ?? '').includes('attachment'), JSON.stringify(state.headers?.['content-disposition']))
  check('the file handle is closed after streaming', engine.state.closed === engine.state.opened && engine.state.opened > 0,
    `opened=${engine.state.opened} closed=${engine.state.closed}`)
}

{
  const { res, state } = fakeRes()
  await download.handler(fakeReq({
    url: `${ROUTES.download}?alias=a&path=${encodeURIComponent('/srv/missing.txt')}`,
    headers: { host: 'localhost:4074' },
  }), res)
  check('a missing remote file answers with an error, not a body',
    state.status === 200 && JSON.parse(state.body).error !== undefined, state.body)
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
