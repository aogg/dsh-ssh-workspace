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

import { readFileSync } from 'node:fs'
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

console.log('\n=== routes smoke ===\n')

// ---------------------------------------------------------------------------
// Bare-identifier audit (runs even when the DSH tree is absent)
//
// routes.js cannot be imported without @deepseek-ai/dsh-fs, so this suite
// skips on a plain checkout. That skip is exactly how a real bug shipped: the
// upload handler called `remoteParentOf`/`sftpUnlink`, which live in
// transfer.js and were never imported — the suite was green because it only
// exercised the refusal branches and never reached SFTP.
//
// This pass reads the source instead and proves that every SFTP helper the
// transfer routes call is imported or declared in the module.
// ---------------------------------------------------------------------------
{
  const source = readFileSync(path.join(pluginRoot, 'lib/routes.js'), 'utf8')
  const declared = new Set()
  const imported = new Set()
  for (const m of source.matchAll(/\bimport\s*\{([^}]+)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) imported.add(name)
    }
  }
  for (const m of source.matchAll(/\bimport\s+(\w+)\s+from/g)) imported.add(m[1])
  for (const m of source.matchAll(/\b(?:function|class)\s+(\w+)/g)) declared.add(m[1])
  for (const m of source.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=/g)) declared.add(m[1])

  const requiredHelpers = [
    'remoteParentOf', 'sftpUnlink', 'sftpMkdirp', 'sftpOpenHandle',
    'sftpReadHandle', 'sftpCloseHandle', 'sftpPublishRename', 'sftpStatOrNull',
  ]
  const missing = requiredHelpers.filter((helper) => {
    const used = new RegExp(`\\b${helper}\\s*\\(`).test(source)
    if (!used) return false
    return !(declared.has(helper) || imported.has(helper))
  })
  for (const helper of missing) {
    check(`routes.js can resolve ${helper}()`, false, 'called but neither declared nor imported')
  }
  if (missing.length === 0) {
    check('every SFTP helper the transfer routes call is imported', true)
  }
}

// routes.js pulls the SFTP primitives from remote-fs.js, which resolves the DSH
// peer packages; the suite needs the assembled tree even though it never opens
// a connection.
const coreRoot = process.env.DSH_CORE_ROOT
if (!coreRoot) {
  console.log('  SKIP  DSH_CORE_ROOT is not set (needs @deepseek-ai/dsh-fs)')
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

/**
 * A request double carrying the fields the fence reads.
 *
 * `body` is delivered the way `readJsonBody` consumes it — as data/end events —
 * so a handler's JSON parsing runs for real instead of being stubbed.
 */
function fakeReq (options = {}) {
  const url = new URL(options.url ?? '/', 'http://localhost')
  const handlers = new Map()
  return {
    method: options.method ?? 'GET',
    url: options.url ?? '/',
    headers: options.headers ?? {},
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1', localPort: options.localPort ?? 4074 },
    on (event, handler) {
      handlers.set(event, handler)
      if (options.body !== undefined && event === 'end') {
        // Deliver asynchronously so the handler's promise chain matches a real
        // socket: readers attach both listeners before any data arrives.
        setImmediate(() => {
          const dataHandler = handlers.get('data')
          if (dataHandler !== undefined) dataHandler(Buffer.from(JSON.stringify(options.body)))
          handler()
        })
      }
    },
  }
}

/** A fake engine that serves and accepts in-memory files. */
function fakeEngine (files) {
  const state = { opened: 0, closed: 0, renamed: [], unlinked: [], mkdirs: [] }
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
          if (flags === 'w') {
            // Writes go to a buffer the handle accumulates; publish renames it.
            callback(null, { __content: Buffer.alloc(0), __write: true, __target: target })
            return
          }
          const content = files.get(target)
          if (content === undefined) { callback(Object.assign(new Error('no such file'), { code: 2 })); return }
          callback(null, { __content: content, __position: 0 })
        },
        write (handle, buffer, offset, length, position, callback) {
          handle.__content = Buffer.concat([handle.__content, buffer.subarray(offset, offset + length)])
          callback(null)
        },
        read (handle, buffer, offset, length, position, callback) {
          const slice = handle.__content.subarray(position, position + length)
          slice.copy(buffer, offset)
          callback(null, slice.length, buffer)
        },
        close (_handle, callback) {
          state.closed += 1
          // A write handle publishes its bytes into the virtual filesystem on
          // close, which is what makes the following rename carry real content.
          // Without this the double loses every uploaded byte and the rename
          // publishes an empty file.
          if (_handle?.__write === true && typeof _handle.__target === 'string') {
            files.set(_handle.__target, _handle.__content ?? Buffer.alloc(0))
          }
          callback(null)
        },
        mkdir (target, callback) { state.mkdirs.push(target); callback(null) },
        rename (from, to, callback) {
          state.renamed.push([from, to])
          const content = files.get(from) ?? Buffer.alloc(0)
          files.delete(from)
          files.set(to, content)
          callback(null)
        },
        unlink (target, callback) { state.unlinked.push(target); files.delete(target); callback(null) },
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

// --- upload ---------------------------------------------------------------
const upload = routes.find(route => route.path === ROUTES.upload)
check('the upload route is registered', upload !== undefined)

{
  const { res, state } = fakeRes()
  await upload.handler(fakeReq({ remoteAddress: '10.0.0.5', method: 'POST' }), res)
  check('a non-loopback upload is refused', state.status === 403, String(state.status))
}

{
  const { res, state } = fakeRes()
  await upload.handler(fakeReq({ method: 'POST', headers: { host: 'evil.example:4074' } }), res)
  check('a rebinding Host header is refused for upload', state.status === 403, String(state.status))
}

{
  const { res, state } = fakeRes()
  await upload.handler(fakeReq({ method: 'GET', headers: { host: 'localhost:4074' } }), res)
  check('a non-POST upload is refused', state.status === 405, String(state.status))
}

{
  const { res, state } = fakeRes()
  await upload.handler(fakeReq({
    method: 'POST',
    url: `${ROUTES.upload}?alias=a&path=${encodeURIComponent('/srv')}`,
    headers: { host: 'localhost:4074' },
  }), res)
  check('an upload without a name is refused', state.status === 400, String(state.status))
}

{
  // A name carrying a separator would escape the directory being browsed.
  for (const hostile of ['../escape.txt', 'a/b.txt', 'a\\b.txt', '..', '.']) {
    const { res, state } = fakeRes()
    await upload.handler(fakeReq({
      method: 'POST',
      url: `${ROUTES.upload}?alias=a&path=${encodeURIComponent('/srv')}&name=${encodeURIComponent(hostile)}`,
      headers: { host: 'localhost:4074' },
    }), res)
    check(`the name ${JSON.stringify(hostile)} is refused as a path escape`, state.status === 400,
      `status=${state.status} body=${state.body}`)
  }
}

/**
 * A request double carrying a streamable body, for the routes that read bytes.
 *
 * The upload handler consumes `for await (const chunk of req)`, so the body is
 * exposed as an async iterator over fixed-size chunks — the same shape a real
 * IncomingMessage offers.
 */
function fakeUploadReq ({ url, host = 'localhost:4074', chunks, method = 'POST' }) {
  let index = 0
  return {
    method,
    url,
    headers: { host },
    socket: { remoteAddress: '127.0.0.1', localPort: 4074 },
    on () {},
    [Symbol.asyncIterator] () {
      return {
        async next () {
          if (index >= chunks.length) return { done: true, value: undefined }
          const value = chunks[index]
          index += 1
          return { done: false, value }
        },
      }
    },
  }
}

// --- upload: the write path itself ---------------------------------------
//
// The refusals above never reach SFTP, so they cannot catch a broken write.
// These drive the real body of the handler: bytes in, staged, renamed, and the
// directory created when it does not exist yet.
{
  const files = new Map()
  const localEngine = fakeEngine(files)
  const localRoutes = makeRoutes({
    engine: localEngine, router: {}, forwards, shells, ctx: { get: () => undefined },
  })
  const localUpload = localRoutes.find(route => route.path === ROUTES.upload)
  const { res, state } = fakeRes()
  await localUpload.handler(fakeUploadReq({
    url: `${ROUTES.upload}?alias=a&path=${encodeURIComponent('/srv/app')}&name=${encodeURIComponent('artifact.bin')}`,
    chunks: [Buffer.from('hello '), Buffer.from('remote')],
  }), res)
  const body = JSON.parse(state.body)
  check('a real upload succeeds', body.ok === true, state.body)
  check('a real upload reports the byte count', body.bytes === 'hello remote'.length, String(body.bytes))
  check('a real upload publishes by rename onto the destination',
    localEngine.state.renamed.length === 1 && localEngine.state.renamed[0][1] === '/srv/app/artifact.bin',
    JSON.stringify(localEngine.state.renamed))
  check('a real upload stages under a sibling temp name, not the destination',
    localEngine.state.renamed.length === 1 && localEngine.state.renamed[0][0] !== '/srv/app/artifact.bin',
    JSON.stringify(localEngine.state.renamed[0] ?? null))
  check('a real upload creates the destination directory',
    localEngine.state.mkdirs.includes('/srv/app'), JSON.stringify(localEngine.state.mkdirs))
  check('the destination ends up holding the uploaded bytes',
    files.get('/srv/app/artifact.bin')?.toString() === 'hello remote',
    String(files.get('/srv/app/artifact.bin')))
  check('the upload answers with the resolved remote path',
    body.remotePath === '/srv/app/artifact.bin', String(body.remotePath))
}

{
  // A root-level destination must not produce a doubled slash.
  const files = new Map()
  const localEngine = fakeEngine(files)
  const localRoutes = makeRoutes({
    engine: localEngine, router: {}, forwards, shells, ctx: { get: () => undefined },
  })
  const localUpload = localRoutes.find(route => route.path === ROUTES.upload)
  const { res, state } = fakeRes()
  await localUpload.handler(fakeUploadReq({
    url: `${ROUTES.upload}?alias=a&path=${encodeURIComponent('/')}&name=top.txt`,
    chunks: [Buffer.from('x')],
  }), res)
  check('an upload into the remote root joins without a doubled slash',
    JSON.parse(state.body).remotePath === '/top.txt', state.body)
}

// --- saved forwards -------------------------------------------------------
//
// These routes are the browser's whole control surface for a stored mapping, so
// the refusals matter as much as the happy paths: an endpoint that accepted a
// mapping with no fixed local port, or that let a rebinding page toggle a
// tunnel, would be a real hole.
{
  const { SavedForwardManager } = await import(pathToFileURL(path.join(pluginRoot, 'lib/forward-persist.js')).href)
  const { ForwardManager } = await import(pathToFileURL(path.join(pluginRoot, 'lib/forward.js')).href)
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { HostConfigStore } = await import(pathToFileURL(path.join(pluginRoot, 'lib/store.js')).href)

  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-routes-forwards-'))
  try {
    const store = new HostConfigStore(path.join(dir, 'dsh-ssh.json'))
    /** A live manager whose engine double never accepts anything. */
    const forwards = new ForwardManager({ engine: { async acquire () { throw new Error('no connection in this test') } } })
    const saved = new SavedForwardManager({ forwards, store })
    const savedRoutes = makeRoutes({
      engine, router: {}, forwards, savedForwards: saved, shells, ctx: { get: () => undefined },
    })
    const find = (routePath) => savedRoutes.find(route => route.path === routePath)

    check('the saved-forward routes are registered',
      [ROUTES.forwardSave, ROUTES.forwardToggle, ROUTES.forwardDelete, ROUTES.forwardRemember, ROUTES.forwardProbe, ROUTES.forwardSettings]
        .every(routePath => find(routePath) !== undefined),
      JSON.stringify(savedRoutes.map(route => route.path)))

    // Status needs a root list from the router; this suite has no real one.
    const statusRoute = find(ROUTES.status)
    {
      const { res, state } = fakeRes()
      const statusRoutes = makeRoutes({
        engine: { ...engine, pool: new Map() },
        router: { listRoots: () => [] },
        forwards,
        savedForwards: saved,
        shells,
        ctx: { get: () => undefined },
      })
      await statusRoutes.find(route => route.path === ROUTES.status).handler(
        fakeReq({ url: ROUTES.status, headers: { host: 'localhost:4074' } }), res)
      const body = JSON.parse(state.body)
      check('status reports the saved forward rows', Array.isArray(body.forwardRows), JSON.stringify(Object.keys(body)))
      check('status reports the auto-start preference', body.forwardSettings?.autoStart === false, JSON.stringify(body.forwardSettings))
    }

    // Fences on every new POST endpoint.
    for (const routePath of [ROUTES.forwardSave, ROUTES.forwardToggle, ROUTES.forwardDelete, ROUTES.forwardRemember, ROUTES.forwardSettings]) {
      const route = find(routePath)
      const { res, state } = fakeRes()
      await route.handler(fakeReq({ method: 'POST', remoteAddress: '10.0.0.5', headers: { 'content-type': 'application/json' } }), res)
      check(`${routePath} refuses a non-loopback request`, state.status === 403, String(state.status))

      const { res: res2, state: state2 } = fakeRes()
      await route.handler(fakeReq({ method: 'POST', headers: { host: 'evil.example:4074', 'content-type': 'application/json' } }), res2)
      check(`${routePath} refuses a rebinding Host header`, state2.status === 403, String(state2.status))

      const { res: res3, state: state3 } = fakeRes()
      await route.handler(fakeReq({ method: 'POST', headers: { host: 'localhost:4074', 'content-type': 'text/plain' } }), res3)
      check(`${routePath} requires a JSON content type`, state3.status === 415, String(state3.status))
    }

    // A saved mapping must name a fixed local port.
    {
      const { res, state } = fakeRes()
      await find(ROUTES.forwardSave).handler(fakeReq({
        method: 'POST',
        headers: { host: 'localhost:4074', 'content-type': 'application/json' },
        body: { alias: 'a', remotePort: 5173, localPort: 0 },
      }), res)
      const body = JSON.parse(state.body)
      check('a saved mapping with localPort 0 is refused', body.ok === false && typeof body.error === 'string', state.body)
      check('the refusal explains the port range', String(body.error).includes('1 and 65535'), String(body.error))
      check('nothing was stored for the refused mapping', store.forwards().items.length === 0)
    }

    // Deleting an id that is not stored reports false rather than throwing.
    {
      const { res, state } = fakeRes()
      await find(ROUTES.forwardDelete).handler(fakeReq({
        method: 'POST',
        headers: { host: 'localhost:4074', 'content-type': 'application/json' },
        body: { id: 'fwd-missing' },
      }), res)
      const body = JSON.parse(state.body)
      check('deleting an unknown saved id reports false', body.ok === true && body.deleted === false, state.body)
    }

    // The settings route stores the preference and ignores everything else.
    {
      const { res, state } = fakeRes()
      await find(ROUTES.forwardSettings).handler(fakeReq({
        method: 'POST',
        headers: { host: 'localhost:4074', 'content-type': 'application/json' },
        body: { autoStart: true, nonsense: 'ignored' },
      }), res)
      const body = JSON.parse(state.body)
      check('the settings route stores autoStart', body.ok === true && body.settings?.autoStart === true, state.body)
      check('the preference reached the store', store.forwards().settings.autoStart === true)
      check('an unknown setting did not reach the document',
        JSON.parse(readFileSync(path.join(dir, 'dsh-ssh.json'), 'utf8')).forwards.settings.nonsense === undefined)
    }

    // The probe validates its input before binding anything.
    {
      const { res, state } = fakeRes()
      await find(ROUTES.forwardProbe).handler(fakeReq({
        url: `${ROUTES.forwardProbe}?localPort=0`, headers: { host: 'localhost:4074' },
      }), res)
      check('the probe refuses port 0', state.status === 400, String(state.status))
    }
    {
      const { res, state } = fakeRes()
      await find(ROUTES.forwardProbe).handler(fakeReq({
        url: `${ROUTES.forwardProbe}?localHost=127.0.0.1&localPort=1`, headers: { host: 'localhost:4074' },
      }), res)
      const body = JSON.parse(state.body)
      check('the probe answers with a verdict', body.ok === true && typeof body.available === 'boolean', state.body)
      if (body.available === false) {
        check('an unavailable port comes with an explanation', typeof body.error === 'string' && body.error !== '', state.body)
      }
    }

    forwards.dispose()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)