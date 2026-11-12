/**
 * Connect-failure classification and the enrichment the engine wraps it in.
 *
 * The engine used to pass ssh2's raw transport errors straight through, so a
 * real outage (an overlay-tunnel reboot leaving a host briefly unreachable)
 * surfaced as one opaque line: "Timed out while waiting for handshake" — no
 * host, no stage, no advice. This suite pins the three layers of the fix:
 *
 * 1. **The mapping** (`classifyConnectError`): every errno and message shape
 *    ssh2 / the OS actually emit — an `errnoException` carries `code`, the
 *    ready timeout carries `level: 'client-timeout'`, DNS failures arrive
 *    wrapped with `level: 'client-dns'` — must land on its documented kind.
 *    A stand-in cannot prove this: the strings and codes ARE the contract.
 * 2. **The enrichment** (`enrichConnectError`): the host-key refusal format
 *    the plugin already had (`host "alias" (user@host:port): …` + hint), the
 *    raw error preserved as `cause`, and a timeout naming how long it waited.
 * 3. **The wiring**: the host-key refusal must keep priority over the
 *    enrichment (asserted against the engine source, which the wiring needs —
 *    a real host-key mismatch needs a live SSH server), and a REAL engine
 *    acquire against a closed loopback port must reject with the enriched
 *    error AND land a `KINDS.error` entry in the diagnostics log the status
 *    surfaces read.
 *
 * Run: node tests/connection-errors-smoke.mjs
 */

import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// cd212c3 pulled bash-payload.js into engine.js's load chain, and
// bash-payload.js resolves the DSH peer packages (via remote-fs.js) at module
// load; without an assembled (or generated stub) tree there is nothing to
// resolve against.
const coreRoot = process.env.DSH_CORE_ROOT
if (!coreRoot) {
  console.log('\n=== connection errors smoke ===\n')
  console.log('  SKIP  DSH_CORE_ROOT is not set (engine.js now loads the bash payload chain)')
  console.log('\n=== 0 passed, 0 failed, 1 suite skipped ===')
  process.exit(0)
}
process.env.DSH_PEER_ROOT = [coreRoot, process.env.DSH_PEER_ROOT].filter(Boolean).join(path.delimiter)
const { CONNECT_ERROR_KINDS, classifyConnectError, enrichConnectError } = await import(pathToFileURL(path.join(pluginRoot, 'lib', 'connection-errors.js')).href)
const { SshWorkspaceEngine } = await import(pathToFileURL(path.join(pluginRoot, 'lib', 'engine.js')).href)
const { KINDS } = await import(pathToFileURL(path.join(pluginRoot, 'lib', 'diagnostics.js')).href)

let passed = 0
let failures = 0
function check (label, ok, detail) {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`) } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

console.log('\n=== connection-errors smoke ===\n')

// ------------------------------------------------------------ kind vocabulary
console.log('[the kind vocabulary is a closed, stable set]')

check('every advertised kind is a non-empty string',
  Object.values(CONNECT_ERROR_KINDS).every(kind => typeof kind === 'string' && kind !== ''))
check('the documented kinds all exist',
  ['timeout', 'refused', 'dns', 'unreachable', 'reset', 'protocol', 'auth', 'hostkey', 'unknown']
    .every(kind => Object.values(CONNECT_ERROR_KINDS).includes(kind)),
  JSON.stringify(Object.values(CONNECT_ERROR_KINDS)))

// ------------------------------------------------------------ classification
console.log('\n[the ssh2/OS error shapes map to their documented kinds]')

const kindOf = (error) => classifyConnectError(error).kind

// A1 + B6: ssh2's ready timeout (level client-timeout) and the OS TCP connect
// timeout share one kind, because neither error says whether TCP ever opened.
check('the ready-timeout message classifies as timeout (it contains "handshake" yet must NOT be protocol)',
  kindOf(new Error('Timed out while waiting for handshake')) === CONNECT_ERROR_KINDS.timeout,
  JSON.stringify(classifyConnectError(new Error('Timed out while waiting for handshake'))))
check('the same message with ssh2\'s client-timeout level classifies as timeout',
  kindOf(Object.assign(new Error('Timed out while waiting for handshake'), { level: 'client-timeout' })) === CONNECT_ERROR_KINDS.timeout)
check('an ETIMEDOUT socket error classifies as timeout',
  kindOf({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT 10.8.8.32:22' }) === CONNECT_ERROR_KINDS.timeout)

check('ECONNREFUSED classifies as refused',
  kindOf({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:2222' }) === CONNECT_ERROR_KINDS.refused)

check('ENOTFOUND classifies as dns',
  kindOf({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND nope.example' }) === CONNECT_ERROR_KINDS.dns)
check('a temporary DNS failure (EAI_AGAIN) classifies as dns too',
  kindOf({ code: 'EAI_AGAIN', message: 'getaddrinfo EAI_AGAIN nope.example' }) === CONNECT_ERROR_KINDS.dns)
check('ssh2\'s wrapped resolver error (level client-dns) classifies as dns even without a code',
  kindOf(Object.assign(new Error("Error while looking up IPv4 address for 'nope.example': getaddrinfo ENOTFOUND nope.example"), { level: 'client-dns' })) === CONNECT_ERROR_KINDS.dns)

check('EHOSTUNREACH classifies as unreachable',
  kindOf({ code: 'EHOSTUNREACH', message: 'connect EHOSTUNREACH 10.0.0.1:22' }) === CONNECT_ERROR_KINDS.unreachable)
check('ENETUNREACH classifies as unreachable',
  kindOf({ code: 'ENETUNREACH', message: 'connect ENETUNREACH 10.0.0.1:22' }) === CONNECT_ERROR_KINDS.unreachable)

check('ECONNRESET classifies as reset',
  kindOf({ code: 'ECONNRESET', message: 'read ECONNRESET' }) === CONNECT_ERROR_KINDS.reset)
check('ECONNABORTED classifies as reset',
  kindOf({ code: 'ECONNABORTED', message: 'connect ECONNABORTED 10.0.0.1:22' }) === CONNECT_ERROR_KINDS.reset)

check('"All configured authentication methods failed" classifies as auth',
  kindOf(new Error('All configured authentication methods failed')) === CONNECT_ERROR_KINDS.auth)
check('the engine\'s keyboard-interactive failure classifies as auth',
  kindOf(new Error('authentication failed (keyboard-interactive): Password:')) === CONNECT_ERROR_KINDS.auth)

check('the raw host-key fatal error classifies as hostkey',
  kindOf(Object.assign(new Error('Host denied (verification failed)'), { level: 'handshake' })) === CONNECT_ERROR_KINDS.hostkey)

check('"Key exchange failed" classifies as protocol',
  kindOf(Object.assign(new Error('Key exchange failed'), { level: 'handshake' })) === CONNECT_ERROR_KINDS.protocol)
check('an unmatched message classifies as unknown and echoes the raw text',
  (() => {
    const { kind, summary } = classifyConnectError(new Error('something odd happened'))
    return kind === CONNECT_ERROR_KINDS.unknown && summary === 'something odd happened'
  })())
check('a non-Error thrown value classifies as unknown without throwing',
  (() => {
    try {
      const { kind, summary } = classifyConnectError(undefined)
      return kind === CONNECT_ERROR_KINDS.unknown && summary === 'the connection failed'
    } catch { return false }
  })())

// --------------------------------------------------------------- enrichment
console.log('\n[enrichment follows the host-key refusal format and keeps the cause]')

const rawTimeout = Object.assign(new Error('Timed out while waiting for handshake'), { level: 'client-timeout' })
const enrichedTimeout = enrichConnectError('mac-dind', { user: 'root', host: '10.8.8.32', port: 22 }, rawTimeout, 15_000)
check('the first line names the alias and the exact endpoint dialled',
  enrichedTimeout.message.split('\n')[0] === 'host "mac-dind" (root@10.8.8.32:22): no answer from the server while connecting (waited 15s)',
  enrichedTimeout.message.split('\n')[0])
check('a timeout states the waited seconds from the connect budget',
  /waited 15s/u.test(enrichedTimeout.message))
check('the hint line follows and is actionable (names verification commands)',
  enrichedTimeout.message.split('\n').length >= 2 && /ssh -p <port> <user>@<host>/u.test(enrichedTimeout.message.split('\n')[1]),
  enrichedTimeout.message.split('\n')[1])
check('the raw ssh2 error is preserved as cause (same object, not a copy)',
  enrichedTimeout.cause === rawTimeout)
check('the classification rides along as a kind property',
  enrichedTimeout.kind === CONNECT_ERROR_KINDS.timeout, String(enrichedTimeout.kind))

const noWait = enrichConnectError('box', { user: 'u', host: 'h', port: 22 }, { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' })
check('a non-timeout failure does not claim waited seconds',
  !/waited /u.test(noWait.message), noWait.message)
check('a timeout without a known budget omits the seconds instead of printing NaN',
  !/waited|NaN/u.test(enrichConnectError('box', { user: 'u', host: 'h', port: 22 }, rawTimeout).message))
check('a refused failure tells the user what to check (sshd / port)',
  /sshd/u.test(noWait.message.split('\n')[1]), noWait.message.split('\n')[1])

// The engine normally builds this error; the priority pin below guards the
// ordering. Here we only pin that enrich never rewrites the hostkey KIND's
// contract — it wraps whatever it is given.
const enrichedUnknown = enrichConnectError('odd', { user: 'u', host: 'h', port: 22 }, new Error('weird'))
check('an unmatched failure echoes the raw message as the summary',
  enrichedUnknown.message.startsWith('host "odd" (u@h:22): weird\n'), enrichedUnknown.message.split('\n')[0])

// ------------------------------------------------- wiring: priority + diagnostics
console.log('\n[the engine refuses on host-key mismatch BEFORE enriching, and records failures]')

// Asserted against the source because a real mismatch needs a live SSH server
// presenting a second key — the same source-pin technique diagnostics-smoke
// uses for wiring that a stub cannot prove.
const engineSource = readFileSync(path.join(pluginRoot, 'lib', 'engine.js'), 'utf8')

check('the mismatch branch still rejects verbatim through hostKeyMismatchError',
  engineSource.includes('reject(hostKeyMismatchError(alias, resolved, hostKey.mismatch, error))'))
check('the mismatch branch precedes the enrichment in fail()',
  (() => {
    const mismatchAt = engineSource.indexOf('if (hostKey.mismatch !== undefined)')
    const enrichAt = engineSource.indexOf('enrichConnectError(alias, resolved, cause')
    return mismatchAt >= 0 && enrichAt > mismatchAt
  })())
check('fail() passes the connect budget as the timeout wait time',
  engineSource.includes('enrichConnectError(alias, resolved, cause, this.tuning.connectTimeoutMs)'))
check('failed connects are recorded under KINDS.error (which keeps the closed set honest)',
  engineSource.includes('KINDS.error'), 'engine.js does not reference KINDS.error')

// ------------------------------------- a REAL acquire against a closed port
console.log('\n[a real engine acquire on a dead port rejects enriched and lands in the log]')

// A real private key so connectConfig passes and the failure happens in the
// socket layer, exactly like production (the config-layer throws keep their
// own messages by design).
const scratchDir = mkdtempSync(path.join(tmpdir(), 'dsh-connect-errors-'))
const TEST_KEY_PATH = path.join(scratchDir, 'test-key.pem')
writeFileSync(TEST_KEY_PATH, generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey, { mode: 0o600 })

// Reserve-and-release an ephemeral port: binding port 0 gives one the OS just
// handed back, so nothing listens on it — loopback connect then gets a fast,
// deterministic refusal (environments that DROP instead of REFUSE degrade the
// same acquire to a timeout; the assertions below accept either).
const deadPort = await new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => resolve(port))
  })
})

{
  // A hermetic store: no ~/.ssh/config, no host store file — resolve() hands
  // the engine exactly the descriptor this test wants to dial.
  const deadStore = {
    resolve: (alias) => ({ alias, host: '127.0.0.1', port: deadPort, user: 'tester', auth: { kind: 'key', keyPath: TEST_KEY_PATH } }),
    knownHostKey: () => undefined,
    rememberHostKey: () => {},
  }
  const engine = new SshWorkspaceEngine({ store: deadStore, connectTimeoutMs: 5_000 })

  // An expected rejection, caught in order to be asserted — not swallowed.
  let connectError
  try {
    await engine.acquire('dead-host')
  } catch (error) {
    connectError = error
  }

  check('acquire rejects (never resolves) when the host refuses',
    connectError instanceof Error, 'acquire resolved instead of rejecting')
  if (connectError instanceof Error) {
    check('the rejection is enriched: first line names the alias and the dialled endpoint',
      connectError.message.startsWith(`host "dead-host" (tester@127.0.0.1:${deadPort}): `),
      connectError.message.split('\n')[0])
    // Loopback refusals are the norm; a sandboxed host that DROPs the packet
    // degrades to the same acquire timing out. Both prove the wiring; the
    // exact kind mapping was pinned above on synthetic errors.
    check('the rejection carries a classification kind (refused or, on DROP-firewalls, timeout)',
      connectError.kind === CONNECT_ERROR_KINDS.refused || connectError.kind === CONNECT_ERROR_KINDS.timeout,
      String(connectError.kind))
    check('the rejection keeps the raw socket error as cause',
      connectError.cause instanceof Error, String(connectError.cause))
    check('the hint advises checking sshd and the port',
      /sshd/u.test(connectError.message), connectError.message)

    const events = engine.diagnostics.list()
    const last = events[events.length - 1]
    check('the failure is recorded in the diagnostics log',
      last?.kind === KINDS.error, JSON.stringify(events))
    check('the recorded event names the alias',
      last?.alias === 'dead-host' && /dead-host/u.test(last?.message ?? ''), JSON.stringify(last))
    check('the recorded event names the classified kind and the endpoint',
      new RegExp(`connect failed \\(${String(connectError.kind)}\\): host "dead-host" \\(tester@127\\.0\\.0\\.1:${deadPort}\\)`, 'u').test(last?.message ?? ''), JSON.stringify(last))
  }

  engine.dispose()
}
rmSync(scratchDir, { recursive: true, force: true })

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
