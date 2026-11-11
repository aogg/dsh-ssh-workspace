/**
 * The draft-probe surface: `POST /probe` (the host editor's test button and
 * the create-mode directory picker) plus the structured host-key-mismatch
 * channel every listing/test route now speaks.
 *
 * The probe endpoint exists so "test connection" and "browse directories"
 * work with the FORM's current values, before a host is ever saved. Its
 * safety properties are the point of this suite:
 *
 *   1. a draft probe NEVER touches the pool (a draft may name an alias that
 *      already has a live pooled connection with different credentials);
 *   2. a draft probe NEVER writes the store — no host entry, no TOFU
 *      host-key pin, no secret: probing must not litter the shared
 *      dsh-ssh.json with records for hosts that are renamed or abandoned;
 *   3. blank secret fields are backfilled from the stored secret (the editor
 *      never echoes secrets back, so "edit → test" without retyping the
 *      password must still work);
 *   4. a host-key refusal travels to the browser with STRUCTURED
 *      fingerprints (code + mismatch), not just prose, on all three routes
 *      that can hit it (/probe, /test, /ls) — the panel's in-place recovery
 *      renders from those fields and must never parse the message text.
 *
 * The verifier's pin/no-pin semantics themselves are exercised against a real
 * HostConfigStore through the module-level `makeHostKeyVerifier` (the engine's
 * private method delegates to it), because those lines are the TOFU contract
 * and a handshake would be needed otherwise.
 *
 * These tests drive the registered handler objects with synthetic request and
 * response doubles, so no server and no SSH host are involved.
 *
 * Run: node tests/probe-route-smoke.mjs
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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

console.log('\n=== probe route smoke ===\n')

// routes.js pulls the SFTP primitives from remote-fs.js, which resolves the DSH
// peer packages; the suite needs the assembled tree even though it never opens
// a connection (the same guard routes-smoke uses).
const coreRoot = process.env.DSH_CORE_ROOT
if (!coreRoot) {
  console.log('  SKIP  DSH_CORE_ROOT is not set (needs @deepseek-ai/dsh-fs)')
  console.log(`\n=== ${passed} passed, ${failures} failed, 1 suite skipped ===`)
  process.exit(failures === 0 ? 0 : 1)
}
process.env.DSH_PEER_ROOT = [coreRoot, process.env.DSH_PEER_ROOT].filter(Boolean).join(path.delimiter)

const { makeRoutes, ROUTES } = await import(pathToFileURL(path.join(pluginRoot, 'lib/routes.js')).href)
const { HostConfigStore } = await import(pathToFileURL(path.join(pluginRoot, 'lib/store.js')).href)
const { HostStore } = await import(pathToFileURL(path.join(pluginRoot, 'lib/hosts.js')).href)
const { SshWorkspaceEngine, makeHostKeyVerifier, hostKeyMismatchError } = await import(pathToFileURL(path.join(pluginRoot, 'lib/engine.js')).href)
const { HOST_KEY_MISMATCH } = await import(pathToFileURL(path.join(pluginRoot, 'lib/connection-errors.js')).href)

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

/** A request double carrying the fields the fence reads (JSON body included). */
function fakeReq (options = {}) {
  const handlers = new Map()
  return {
    method: options.method ?? 'POST',
    url: options.url ?? '/',
    headers: options.headers ?? { host: 'localhost:4074', 'content-type': 'application/json' },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1', localPort: options.localPort ?? 4074 },
    on (event, handler) {
      handlers.set(event, handler)
      if (options.body !== undefined && event === 'end') {
        // Delivered the way readJsonBody consumes it — data, then end.
        setImmediate(() => {
          const dataHandler = handlers.get('data')
          if (dataHandler !== undefined) dataHandler(Buffer.from(JSON.stringify(options.body)))
          handler()
        })
      }
    },
  }
}

async function post (route, body, options = {}) {
  const { res, state } = fakeRes()
  await route.handler(fakeReq({ ...options, body }), res)
  let parsed
  try { parsed = JSON.parse(state.body) } catch { parsed = undefined }
  return { status: state.status, body: parsed, raw: state.body }
}

/** An SFTP readdir row as the ssh2 client carries it. */
function listingAttrs ({ directory }) {
  return {
    size: directory ? 0 : 4,
    mtime: 1234567890,
    isDirectory: () => directory,
    isSymbolicLink: () => false,
  }
}

/**
 * An SFTP double over an in-memory tree, shaped like routes-smoke's — enough
 * for the listing contract (readdir + realpath + the write probe).
 */
function sftpDouble (files, directories) {
  return {
    readdir (target, callback) {
      if (!directories.has(target)) { callback(Object.assign(new Error('no such file'), { code: 2 })); return }
      const rows = []
      for (const dir of directories) {
        if (dir !== target && path.posix.dirname(dir) === target) {
          rows.push({ filename: path.posix.basename(dir), attrs: listingAttrs({ directory: true }) })
        }
      }
      for (const file of files.keys()) {
        if (path.posix.dirname(file) === target) {
          rows.push({ filename: path.posix.basename(file), attrs: listingAttrs({ directory: false }) })
        }
      }
      callback(null, rows)
    },
    open (target, _flags, callback) { callback(null, { __write: true, __target: target }) },
    write (_handle, _buffer, _offset, _length, _position, callback) { callback(null) },
    close (_handle, callback) { callback(null) },
    unlink (target, callback) { files.delete(target); callback(null) },
    realpath (target, callback) {
      if (target === '.') { callback(null, '/home/draft'); return }
      if (!directories.has(target) && !files.has(target)) { callback(Object.assign(new Error('no such file'), { code: 2 }), null); return }
      callback(null, target)
    },
  }
}

/** A store seeded with one password-auth host (secret encrypted on create). */
function seededStore (dir) {
  const store = new HostConfigStore(path.join(dir, 'dsh-ssh.json'))
  store.create({
    alias: 'stored-host',
    host: '10.0.0.9',
    port: 22,
    user: 'deploy',
    auth: { kind: 'password', password: 'stored-secret', passphrase: '', keyPath: '', agentPath: '' },
    description: '',
  })
  return store
}

// ---------------------------------------------------------------------------
console.log('[registration and fences]')
{
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-probe-fence-'))
  try {
    const store = seededStore(dir)
    const engine = {
      pool: new Map(),
      store: { entryStore: store },
      async withDraftSftp () { throw new Error('not expected in this section') },
    }
    const routes = makeRoutes({ engine, router: {}, forwards: { list: () => [] }, ctx: { get: () => undefined } })
    const probe = routes.find(route => route.path === ROUTES.probe)

    check('the probe route is registered', probe !== undefined, JSON.stringify(routes.map(route => route.path)))

    {
      const reply = await post(probe, { action: 'test', draft: { alias: 'a', host: 'h', user: 'u', auth: { kind: 'agent' } } }, { remoteAddress: '10.0.0.5' })
      check('a non-loopback probe is refused', reply.status === 403, String(reply.status))
    }
    {
      const { res, state } = fakeRes()
      await probe.handler(fakeReq({ method: 'GET', body: undefined }), res)
      check('the probe answers POST only', state.status === 405, String(state.status))
    }
    {
      const { res, state } = fakeRes()
      await probe.handler(fakeReq({ headers: { host: 'localhost:4074', 'content-type': 'text/plain' }, body: {} }), res)
      check('the probe requires a JSON content type', state.status === 415, String(state.status))
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n[draft validation]')
{
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-probe-valid-'))
  try {
    const store = seededStore(dir)
    const engine = {
      pool: new Map(),
      store: { entryStore: store },
      async withDraftSftp () { throw new Error('a refused draft must not reach the engine') },
    }
    const routes = makeRoutes({ engine, router: {}, forwards: { list: () => [] }, ctx: { get: () => undefined } })
    const probe = routes.find(route => route.path === ROUTES.probe)
    const draft = { alias: 'a', host: 'h', port: 22, user: 'u', auth: { kind: 'agent' } }

    for (const [label, mutate] of [
      ['a missing alias is refused', (d) => { d.alias = '' }],
      ['a blank alias is refused', (d) => { d.alias = '   ' }],
      ['a blank host is refused', (d) => { d.host = '' }],
      ['a blank user is refused', (d) => { d.user = '' }],
      ['port 0 is refused', (d) => { d.port = 0 }],
      ['port 70000 is refused', (d) => { d.port = 70000 }],
      ['a non-integer port is refused', (d) => { d.port = '22' }],
      ['an unknown auth kind is refused', (d) => { d.auth.kind = 'magic' }],
      ['a missing draft object is refused', undefined],
    ]) {
      const broken = JSON.parse(JSON.stringify(draft))
      if (mutate !== undefined) mutate(broken)
      const reply = await post(probe, mutate === undefined
        ? { action: 'test' }
        : { action: 'test', draft: broken })
      check(label, reply.status === 400 && typeof reply.body?.error === 'string', `${reply.status} ${reply.raw}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n[a test probe connects, reports, and writes nothing]')
{
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-probe-ok-'))
  try {
    const store = seededStore(dir)
    const captured = []
    const engine = {
      // Deliberately a Map the probe cannot confuse with the pool: every
      // pool-touching code path would show here.
      pool: new Map([['stored-host', { pooled: true }]]),
      forget (alias) { engine.forgotten.push(alias) },
      forgotten: [],
      store: { entryStore: store },
      async withDraftSftp (resolved, operation) {
        captured.push(resolved)
        return await operation(sftpDouble(new Map(), new Set(['/home/draft'])))
      },
    }
    const routes = makeRoutes({ engine, router: {}, forwards: { list: () => [] }, ctx: { get: () => undefined } })
    const probe = routes.find(route => route.path === ROUTES.probe)

    const reply = await post(probe, {
      action: 'test',
      draft: { alias: 'fresh-box', host: '10.0.0.10', port: 2222, user: 'ao', auth: { kind: 'password', password: 'draft-secret' }, agentForward: true, compress: true },
    })
    check('a draft test answers ok', reply.body?.ok === true, reply.raw)
    check('a draft test reports the round trip', Number.isInteger(reply.body?.durationMs), reply.raw)
    check('the engine saw exactly one draft descriptor', captured.length === 1, JSON.stringify(captured.length))
    check('the descriptor carries the form values verbatim',
      captured[0]?.alias === 'fresh-box' && captured[0]?.host === '10.0.0.10' && captured[0]?.port === 2222 && captured[0]?.user === 'ao',
      JSON.stringify(captured[0]))
    check('the descriptor carries the auth and transport flags',
      captured[0]?.auth?.kind === 'password' && captured[0]?.auth?.password === 'draft-secret' && captured[0]?.agentForward === true && captured[0]?.compress === true,
      JSON.stringify(captured[0]))
    check('the draft secret reached the ephemeral connect, never the store',
      readFileSync(path.join(dir, 'dsh-ssh.json'), 'utf8').includes('draft-secret') === false,
      'the draft password leaked into dsh-ssh.json')
    check('the probed alias gained no host entry', store.find('fresh-box') === undefined)
    check('a probe for a saved-host alias left the pooled record alone',
      engine.pool.get('stored-host')?.pooled === true && engine.forgotten.length === 0,
      JSON.stringify({ pool: [...engine.pool.keys()], forgotten: engine.forgotten }))

    // The create-mode picker uses the ls action; its reply must keep the same
    // shape GET /ls answers with (path echo, entries, writable).
    const files = new Map([['/home/draft/notes.txt', Buffer.from('hi')]])
    const directories = new Set(['/home/draft', '/home/draft/projects'])
    engine.withDraftSftp = async (resolved, operation) => await operation(sftpDouble(files, directories))
    const listing = await post(probe, {
      action: 'ls',
      draft: { alias: 'fresh-box', host: '10.0.0.10', port: 22, user: 'ao', auth: { kind: 'agent' } },
    })
    check('a draft listing answers the /ls shape (path, entries, writable)',
      typeof listing.body?.path === 'string' && Array.isArray(listing.body?.entries) && typeof listing.body?.writable === 'boolean',
      listing.raw)
    check('a draft listing without a path starts at the login directory',
      listing.body?.path === '/home/draft', listing.raw)
    check('a draft listing maps entries to name/type rows',
      listing.body?.entries?.some(entry => entry.name === 'projects' && entry.type === 'directory') === true,
      listing.raw)
    check('an absolute draft path is honoured verbatim', (await post(probe, {
      action: 'ls',
      path: '/home/draft/projects',
      draft: { alias: 'fresh-box', host: '10.0.0.10', port: 22, user: 'ao', auth: { kind: 'agent' } },
    })).body?.path === '/home/draft/projects', 'path echo lost')
    check('a relative draft path is refused', (await post(probe, {
      action: 'ls',
      path: 'relative/dir',
      draft: { alias: 'fresh-box', host: '10.0.0.10', port: 22, user: 'ao', auth: { kind: 'agent' } },
    })).status === 400, 'relative paths must not reach SFTP')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n[blank secrets are backfilled from the stored ones]')
{
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-probe-secret-'))
  try {
    const store = seededStore(dir)
    check('the seeded secret decrypts', store.secretFor('stored-host')?.password === 'stored-secret', 'seed broken')
    const captured = []
    const engine = {
      pool: new Map(),
      store: { entryStore: store },
      async withDraftSftp (resolved, operation) { captured.push(resolved); return await operation() },
    }
    const routes = makeRoutes({ engine, router: {}, forwards: { list: () => [] }, ctx: { get: () => undefined } })
    const probe = routes.find(route => route.path === ROUTES.probe)

    await post(probe, {
      action: 'test',
      draft: { alias: 'stored-host', host: '10.0.0.9', port: 22, user: 'deploy', auth: { kind: 'password', password: '' } },
    })
    check('a blank draft password is backfilled from the stored secret',
      captured[0]?.auth?.password === 'stored-secret', JSON.stringify(captured[0]?.auth))

    // Same rule for a key-auth passphrase.
    store.create({
      alias: 'keyed-host',
      host: '10.0.0.11',
      port: 22,
      user: 'deploy',
      auth: { kind: 'key', keyPath: '~/.ssh/id_ed25519', passphrase: 'key-pass', password: '', agentPath: '' },
      description: '',
    })
    captured.length = 0
    await post(probe, {
      action: 'test',
      draft: { alias: 'keyed-host', host: '10.0.0.11', port: 22, user: 'deploy', auth: { kind: 'key', keyPath: '~/.ssh/id_ed25519', passphrase: '' } },
    })
    check('a blank draft passphrase is backfilled from the stored secret',
      captured[0]?.auth?.passphrase === 'key-pass', JSON.stringify(captured[0]?.auth))

    // An explicit draft value wins — the user may be testing a NEW password
    // before saving it.
    captured.length = 0
    await post(probe, {
      action: 'test',
      draft: { alias: 'stored-host', host: '10.0.0.9', port: 22, user: 'deploy', auth: { kind: 'password', password: 'rotated-secret' } },
    })
    check('an explicit draft password is kept (never overwritten by the store)',
      captured[0]?.auth?.password === 'rotated-secret', JSON.stringify(captured[0]?.auth))

    // An unknown alias has nothing to backfill from: the blank travels as-is
    // and the engine's own "uses password auth but the store holds no
    // password" class of error is the verdict.
    captured.length = 0
    await post(probe, {
      action: 'test',
      draft: { alias: 'unknown', host: 'h', port: 22, user: 'u', auth: { kind: 'password', password: '' } },
    })
    check('a blank password for an unknown alias is left blank for the engine to refuse',
      captured.length === 1 && (captured[0]?.auth?.password ?? '') === '', JSON.stringify(captured[0]?.auth))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n[the structured mismatch reaches the browser on every route]')
{
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-probe-mismatch-'))
  try {
    const store = new HostConfigStore(path.join(dir, 'dsh-ssh.json'))
    const recorded = { keyType: 'ssh-ed25519', fingerprint: 'SHA256:mwFaRecorded', recordedAt: 1700000000000 }
    const presented = { keyType: 'ssh-ed25519', fingerprint: 'SHA256:YKBrPresented' }
    const refusal = hostKeyMismatchError('win-dind', { user: 'ao', host: '10.8.8.32', port: 22 }, { recorded, presented }, new Error('verification failed'))

    // The error itself is the contract the routes forward.
    check('the refusal carries the stable code', refusal.code === HOST_KEY_MISMATCH, String(refusal.code))
    check('the refusal carries the alias to forget', refusal.mismatch?.alias === 'win-dind', JSON.stringify(refusal.mismatch))
    check('the refusal carries both fingerprints with key types',
      refusal.mismatch?.recorded?.fingerprint === 'SHA256:mwFaRecorded' && refusal.mismatch?.presented?.fingerprint === 'SHA256:YKBrPresented' &&
      refusal.mismatch?.recorded?.keyType === 'ssh-ed25519' && refusal.mismatch?.presented?.keyType === 'ssh-ed25519',
      JSON.stringify(refusal.mismatch))
    check('the refusal keeps the recorded-at stamp', refusal.mismatch?.recorded?.recordedAt === 1700000000000, JSON.stringify(refusal.mismatch?.recorded))
    check('the message still names both fingerprints for humans',
      refusal.message.includes('SHA256:mwFaRecorded') && refusal.message.includes('SHA256:YKBrPresented'),
      refusal.message)

    const draftRoutes = makeRoutes({
      engine: {
        pool: new Map(),
        store: { entryStore: store },
        async withDraftSftp () { throw refusal },
      },
      router: {},
      forwards: { list: () => [] },
      ctx: { get: () => undefined },
    })
    const probe = draftRoutes.find(route => route.path === ROUTES.probe)
    const probeReply = await post(probe, { action: 'test', draft: { alias: 'win-dind', host: 'h', user: 'u', auth: { kind: 'agent' } } })
    check('a probe refusal is a 400 with the structured code',
      probeReply.status === 400 && probeReply.body?.code === HOST_KEY_MISMATCH, probeReply.raw)
    check('the probe refusal names both fingerprints as fields, not prose',
      probeReply.body?.mismatch?.recorded?.fingerprint === 'SHA256:mwFaRecorded' && probeReply.body?.mismatch?.presented?.fingerprint === 'SHA256:YKBrPresented',
      probeReply.raw)

    // The saved-host channels forward the same structure: /test answers
    // 200 ok:false, /ls answers 400 — both must carry code + mismatch.
    const engine = {
      pool: new Map(),
      // The forget route talks to the HostStore wrapper, the probe route to
      // the entry store — both spellings exist on the real engine.
      store: { entryStore: store, forgetHostKey: (alias) => store.forgetHostKey(alias) },
      async acquire () { throw refusal },
      async withSftp () { throw refusal },
      forget () {},
      assertNotDisabled () {},
    }
    const savedRoutes = makeRoutes({ engine, router: {}, forwards: { list: () => [] }, ctx: { get: () => undefined } })
    const testReply = await post(savedRoutes.find(route => route.path === ROUTES.test), { alias: 'win-dind' })
    check('a /test refusal answers ok:false with the structured code and mismatch',
      testReply.body?.ok === false && testReply.body?.code === HOST_KEY_MISMATCH && testReply.body?.mismatch?.alias === 'win-dind',
      testReply.raw)
    const { res, state } = fakeRes()
    await savedRoutes.find(route => route.path === ROUTES.ls).handler(
      fakeReq({ method: 'GET', url: `${ROUTES.ls}?alias=win-dind`, headers: { host: 'localhost:4074' } }), res)
    const lsBody = JSON.parse(state.body)
    check('an /ls refusal answers 400 with the structured code and mismatch',
      state.status === 400 && lsBody?.code === HOST_KEY_MISMATCH && lsBody?.mismatch?.presented?.fingerprint === 'SHA256:YKBrPresented',
      state.body)

    // The recovery half: forget-key clears the real record so the next
    // connect re-pins via TOFU.
    store.rememberHostKey('win-dind', { host: '10.8.8.32', port: 22, keyType: 'ssh-ed25519', fingerprint: 'SHA256:mwFaRecorded' })
    check('the record exists before the forget', store.knownHostKey('win-dind') !== undefined)
    const forgetReply = await post(savedRoutes.find(route => route.path === ROUTES.hostForgetKey), { alias: 'win-dind' })
    check('forget-key answers ok', forgetReply.body?.ok === true, forgetReply.raw)
    check('forget-key cleared the recorded key', store.knownHostKey('win-dind') === undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n[the verifier: drafts verify but never pin]')
{
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-probe-verifier-'))
  try {
    const store = new HostConfigStore(path.join(dir, 'dsh-ssh.json'))
    const engine = new SshWorkspaceEngine({ store: new HostStore(undefined, store) })
    const resolved = { alias: 'probe-box', host: '10.0.0.42', port: 22, user: 'ao' }
    // The verifier fingerprints whatever buffer it is handed, so "the same
    // key" here means the same BUFFER — the exact bytes a real handshake
    // would present twice for an unchanged host.
    const firstKey = Buffer.from('ed25519-public-blob-first')
    const changedKey = Buffer.from('ed25519-public-blob-changed')

    let pinnedFingerprint
    {
      const state = {}
      const accepted = makeHostKeyVerifier(engine, resolved, state, false)(firstKey)
      check('a draft with no record is accepted', accepted === true)
      check('a draft with no record writes NO pin', store.knownHostKey('probe-box') === undefined,
        JSON.stringify(store.knownHostKey('probe-box')))
      check('a draft with no record arms no mismatch', state.mismatch === undefined)
    }
    {
      const state = {}
      const accepted = makeHostKeyVerifier(engine, resolved, state, true)(firstKey)
      const record = store.knownHostKey('probe-box')
      pinnedFingerprint = record?.fingerprint
      check('a real connect with no record is accepted and pins (TOFU)', accepted === true)
      check('the pin landed in the store as a SHA256 fingerprint',
        typeof pinnedFingerprint === 'string' && pinnedFingerprint.startsWith('SHA256:'),
        JSON.stringify(record))
    }
    {
      const state = {}
      const accepted = makeHostKeyVerifier(engine, resolved, state, false)(changedKey)
      check('a draft presenting a DIFFERENT key than the pin is refused', accepted === false)
      check('the refusal arms both sides on the connect state',
        state.mismatch?.recorded?.fingerprint === pinnedFingerprint &&
        typeof state.mismatch?.presented?.fingerprint === 'string' && state.mismatch?.presented?.fingerprint !== pinnedFingerprint,
        JSON.stringify(state.mismatch))
      check('the draft refusal did not overwrite the recorded pin',
        store.knownHostKey('probe-box')?.fingerprint === pinnedFingerprint,
        JSON.stringify(store.knownHostKey('probe-box')))
    }
    // A draft is keyed by ALIAS: the pinned key again is accepted (verify,
    // not re-pin), which is what makes browse-then-connect seamless.
    {
      const acceptedSame = makeHostKeyVerifier(engine, resolved, {}, false)(firstKey)
      check('a draft presenting the pinned key again is accepted', acceptedSame === true)
    }

    engine.dispose()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
