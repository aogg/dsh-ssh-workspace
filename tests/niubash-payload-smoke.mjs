/**
 * The Niubash payload pin and the provisioner's load path (cd212c3).
 *
 * Where the pin comes from and where the bytes come from are two separate
 * trust decisions, and this suite pins both:
 *
 *   1. **pin resolution** — `resolvePayloadPin` prefers the staged manifest
 *      (`runtime/niubash/manifest.json`, written by the pack-time stager),
 *      validates every field strictly, and DEGRADES to the bundled v1.5.0
 *      constant on anything unusable (unreadable JSON, a missing or
 *      malformed field, a prefix without its trailing slash). A half-written
 *      manifest must never become a provisioning pin;
 *   2. **payload source order** — `provisionWinBash` takes an explicit
 *      `payloadPath` first, then the package's own digest-verified staged
 *      archive (which is what makes a packaged plugin provision offline),
 *      and only then the pin's URL over the network. Every source passes the
 *      same size + sha256 gates, so a refusal names the gate, and the
 *      download really is the LAST resort;
 *   3. **placement** — `niubashRootFor` spells the three-level convention
 *      (`project` / `user` / `custom`), `installRoot`/`placement` ride the
 *      provision call to the tree root the receipt names, and the receipt
 *      carries `placement`/`releaseTag` for the record.
 *
 * Everything runs OFFLINE: the staged manifest lives in a sandbox copy of
 * `lib/` (so the repo's own `runtime/` is never touched), the archive is a
 * tiny synthetic tar.gz whose digests feed the fixture manifest, and
 * `globalThis.fetch` is replaced by a stub that records and throws — a
 * download attempt announces itself instead of reaching a socket.
 *
 * Run: node tests/niubash-payload-smoke.mjs
 */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// bash-payload.js reaches the shared SFTP primitives, which resolve the DSH
// peer packages; without an assembled (or generated stub) tree there is
// nothing to resolve against.
const coreRoot = process.env.DSH_CORE_ROOT
if (!coreRoot) {
  console.log('\n=== niubash payload smoke ===\n')
  console.log('  SKIP  DSH_CORE_ROOT is not set (bash-payload.js needs @deepseek-ai/dsh-fs)')
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

console.log('\n=== niubash payload smoke ===\n')

// ---------------------------------------------------------------------------
// Fixtures + the sandboxed lib copy. The copy is what makes the staged
// manifest testable without touching the repo tree: `stagedManifestPath()`
// resolves relative to the module's own URL.
// ---------------------------------------------------------------------------

const BASH_BYTES = Buffer.from('#!/bin/sh\nsynthetic niubash payload\n')
const BASH_SHA = createHash('sha256').update(BASH_BYTES).digest('hex')
const ASSET_NAME = 'niubash-v9.9.9-win-x64.tar.gz'

function tarEntry (name, { type = '0', data = Buffer.alloc(0) } = {}) {
  const header = Buffer.alloc(512)
  header.write(name.slice(0, 100), 0, 'utf8')
  header.write(type, 156, 'utf8')
  header.write(`${data.length.toString(8)}\0`, 124, 'utf8')
  header.write('ustar\0', 257, 'utf8')
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)])
}

const ARCHIVE_BYTES = gzipSync(Buffer.concat([
  tarEntry('niubash-v9.9.9-win-x64', { type: '5' }),
  tarEntry(`niubash-v9.9.9-win-x64/winuxcmd/usr/bin/bash.exe`, { data: BASH_BYTES }),
  tarEntry('niubash-v9.9.9-win-x64/README.txt', { data: Buffer.from('synthetic payload readme\n') }),
]))
const ARCHIVE_SHA = createHash('sha256').update(ARCHIVE_BYTES).digest('hex')

/** The manifest the pack-time stager would have written for ARCHIVE_BYTES. */
function fixtureManifest (overrides = {}) {
  return {
    schemaVersion: 1,
    name: 'bash',
    platform: 'win',
    arch: 'x64',
    upstream: 'niubash',
    upstreamUrl: 'https://github.com/unixwin/niubash',
    releaseTag: 'v9.9.9',
    version: '9.9.9',
    assetFile: ASSET_NAME,
    url: `https://github.com/unixwin/niubash/releases/download/v9.9.9/${ASSET_NAME}`,
    sha256: ARCHIVE_SHA,
    bytes: ARCHIVE_BYTES.length,
    extractor: 'tar.gz',
    prefix: 'niubash-v9.9.9-win-x64/',
    executableRelativePath: 'winuxcmd/usr/bin/bash.exe',
    executableSha256: BASH_SHA,
    stagedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const sandbox = mkdtempSync(path.join(tmpdir(), 'dsh-niubash-payload-'))
mkdirSync(path.join(sandbox, 'lib'), { recursive: true })
for (const file of readdirSync(path.join(pluginRoot, 'lib'))) copyFileSync(path.join(pluginRoot, 'lib', file), path.join(sandbox, 'lib', file))
const runtimeDir = path.join(sandbox, 'runtime', 'niubash')

function writeStaged (manifest, archiveBytes = ARCHIVE_BYTES) {
  mkdirSync(runtimeDir, { recursive: true })
  writeFileSync(path.join(runtimeDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(path.join(runtimeDir, manifest.assetFile), archiveBytes)
}

function clearStaged () {
  rmSync(path.join(sandbox, 'runtime'), { recursive: true, force: true })
}

const payload = await import(pathToFileURL(path.join(sandbox, 'lib', 'bash-payload.js')).href)
const { BASH_PAYLOAD_PIN, NIUBASH_RUNTIME_RELATIVE, readPayloadManifest, resolvePayloadPin, resolvedPayload, resetPayloadResolution, payloadStagedArchiveReady, provisionWinBash, niubashRootFor, bashReceiptText, bashExePathOf } = payload

// No real network anywhere in this suite: a download attempt announces itself.
const fetchAttempts = []
globalThis.fetch = (input) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? input)
  fetchAttempts.push(url)
  return Promise.reject(new Error(`no-network-in-test: fetch(${url})`))
}

// ---------------------------------------------------------------------------
console.log('[resolvePayloadPin prefers a valid staged manifest]')

writeStaged(fixtureManifest())
resetPayloadResolution()

{
  const manifest = readPayloadManifest()
  check('a well-formed staged manifest validates', manifest !== undefined, JSON.stringify(manifest))
  const pin = resolvePayloadPin()
  check('the pin mirrors the manifest identity (not the bundled constant)',
    pin.version === '9.9.9' && pin.releaseTag === 'v9.9.9' && pin.sha256 === ARCHIVE_SHA
    && pin.bytes === ARCHIVE_BYTES.length && pin.prefix === 'niubash-v9.9.9-win-x64/'
    && pin.executableRelativePath === 'winuxcmd/usr/bin/bash.exe' && pin.executableSha256 === BASH_SHA,
    JSON.stringify(pin))
  check('the derived pin is frozen', Object.isFrozen(pin))
  check('the derived pin carries the canonical field set',
    Object.keys(pin).length === Object.keys(BASH_PAYLOAD_PIN).length
    && Object.keys(pin).every(field => Object.hasOwn(BASH_PAYLOAD_PIN, field)),
    JSON.stringify(Object.keys(pin)))
  const resolution = resolvedPayload()
  check('resolvedPayload names the manifest as its source', resolution.manifest !== undefined)
  check('resolvedPayload points at the staged archive', resolution.stagedArchive === path.join(runtimeDir, ASSET_NAME))
  check('the staged archive verifies against the manifest digest (async half included)',
    await payloadStagedArchiveReady() === path.join(runtimeDir, ASSET_NAME))
}

// ---------------------------------------------------------------------------
console.log('\n[a damaged manifest degrades to the bundled pin]')

const BAD_MANIFESTS = [
  ['unreadable JSON', 'not-json-at-all'],
  ['a JSON array', JSON.stringify([fixtureManifest()])],
  ['JSON null', 'null'],
  ['missing sha256', JSON.stringify(fixtureManifest({ sha256: undefined }))],
  ['an uppercase sha256 (the pin freezes lowercase)', JSON.stringify(fixtureManifest({ sha256: ARCHIVE_SHA.toUpperCase() }))],
  ['a short sha256', JSON.stringify(fixtureManifest({ sha256: 'abc123' }))],
  ['an http (non-https) url', JSON.stringify(fixtureManifest({ url: 'http://example.com/a.tar.gz' }))],
  ['a wrong extractor', JSON.stringify(fixtureManifest({ extractor: 'zip' }))],
  ['a prefix without its trailing slash', JSON.stringify(fixtureManifest({ prefix: 'niubash-v9.9.9-win-x64' }))],
  ['an absolute prefix', JSON.stringify(fixtureManifest({ prefix: '/niubash-v9.9.9-win-x64/' }))],
  ['a backslashed executable path', JSON.stringify(fixtureManifest({ executableRelativePath: 'winuxcmd\\usr\\bin\\bash.exe' }))],
  ['a missing executable digest', JSON.stringify(fixtureManifest({ executableSha256: undefined }))],
  ['bytes as a string', JSON.stringify(fixtureManifest({ bytes: String(ARCHIVE_BYTES.length) }))],
  ['bytes zero', JSON.stringify(fixtureManifest({ bytes: 0 }))],
  ['a missing assetFile', JSON.stringify(fixtureManifest({ assetFile: undefined }))],
  ['a blank releaseTag', JSON.stringify(fixtureManifest({ releaseTag: '' }))],
]
for (const [label, raw] of BAD_MANIFESTS) {
  clearStaged()
  mkdirSync(runtimeDir, { recursive: true })
  writeFileSync(path.join(runtimeDir, 'manifest.json'), `${raw}\n`)
  resetPayloadResolution()
  const manifest = readPayloadManifest()
  const pin = resolvePayloadPin()
  check(`${label} → manifest unusable, bundled pin serves`,
    manifest === undefined && pin === BASH_PAYLOAD_PIN && Object.isFrozen(pin),
    JSON.stringify(manifest)?.slice(0, 80))
}
clearStaged()
resetPayloadResolution()

// ---------------------------------------------------------------------------
console.log('\n[a staged archive that fails its manifest check is not a source]')

{
  writeStaged(fixtureManifest({ bytes: ARCHIVE_BYTES.length + 1 }))
  resetPayloadResolution()
  const resolution = resolvedPayload()
  check('a size mismatch drops the staged archive from the resolution',
    resolution.pin.version === '9.9.9' && resolution.stagedArchive === undefined,
    JSON.stringify({ version: resolution.pin.version, staged: resolution.stagedArchive }))
  check('the size-mismatched staged archive never verifies ready',
    await payloadStagedArchiveReady() === undefined)
  clearStaged()
  resetPayloadResolution()
}

// ---------------------------------------------------------------------------
console.log('\n[payload source order: payloadPath → staged archive → download]')

/**
 * A provisioner engine double: cmd login shell, an editable entry, %USERPROFILE%
 * answering, and an SFTP channel that serves the receipt stat then refuses
 * everything further (the payload gates run BEFORE the publish, so reaching
 * the refusal proves the gates passed). `execRaw --version` answers GNU bash.
 */
function provisionEngine ({ entry = {} } = {}) {
  const touched = { execRaw: [], withSftp: [], statPaths: [], mutateHosts: 0 }
  let statReply = null
  const engine = {
    logger: { warn: () => {}, info: () => {} },
    async loginDialect () { return 'cmd' },
    store: {
      entry: () => ({ ...entry }),
      entryStore: { mutateHosts (mutate) { touched.mutateHosts += 1; return mutate([]) } },
    },
    async execRaw (_alias, command) {
      touched.execRaw.push(command)
      const stdout = command.includes('--version')
        ? 'GNU bash, version 5.2.26(1)-release (x86_64-pc-msys)\r\n'
        : 'C:\\Users\\u\r\n'
      return { success: true, exitCode: 0, stdout, stderr: '', timedOut: false, truncated: false, durationMs: 0 }
    },
    async withSftp (_alias, operation) {
      touched.withSftp.push(operation.length)
      if (touched.withSftp.length === 1) {
        return await operation({
          stat (target, callback) { touched.statPaths.push(target); callback(null, statReply) },
          open (target, flags, callback) { callback(new Error('no reading here')) },
        })
      }
      throw new Error('sftp refused (test double)')
    },
    forgetDialectCaches () { touched.forgetCaches += 1 },
    noteNiubashPresence () {},
  }
  return { engine, touched, setStatReply: value => { statReply = value } }
}

async function provisionRefusal (engine, alias, options) {
  try {
    await provisionWinBash(engine, alias, options)
    return { resolved: true }
  } catch (error) {
    return { error }
  }
}

{
  // Source 1: an explicit payloadPath is consulted FIRST — even when the
  // staged archive is valid, a bogus payloadPath must be the thing that
  // fails, or the documented order is a lie.
  writeStaged(fixtureManifest())
  resetPayloadResolution()
  const bogus = path.join(sandbox, 'bogus-payload.tar.gz')
  writeFileSync(bogus, Buffer.alloc(7, 1))
  const { engine, touched } = provisionEngine({})
  const { error } = await provisionRefusal(engine, 'winbox', { payloadPath: bogus })
  check('a wrong-size payloadPath is refused with the size-gate wording',
    error?.message === `bash payload archive is 7 bytes, not the pinned ${ARCHIVE_BYTES.length}`, String(error))
  check('the payloadPath gate fired before any second SFTP touch (no publish, no download)',
    touched.withSftp.length === 1 && fetchAttempts.length === 0 && touched.mutateHosts === 0,
    JSON.stringify({ withSftp: touched.withSftp.length, fetch: fetchAttempts.length }))
  rmSync(bogus, { force: true })
  clearStaged()
  resetPayloadResolution()
}

{
  // Source 2: without payloadPath, the digest-verified staged archive feeds
  // the whole flow offline — the gates pass and the refusal comes from the
  // publish stage (the SFTP double), never from a digest or the network.
  writeStaged(fixtureManifest())
  resetPayloadResolution()
  const before = fetchAttempts.length
  const { engine, touched } = provisionEngine({})
  const { error } = await provisionRefusal(engine, 'winbox', {})
  check('the staged archive passes the size gate (nothing re-downloaded, no fetch marker)',
    error !== undefined && !error.message.includes('no-network-in-test')
    && !error.message.includes('not the pinned') && !error.message.includes('bash payload archive is'),
    String(error))
  check('the staged-archive run reached the publish stage (second SFTP touch)',
    error?.message.includes('sftp refused (test double)') && touched.withSftp.length >= 2, String(error))
  check('the staged-archive run stayed offline', fetchAttempts.length === before, JSON.stringify(fetchAttempts))
  clearStaged()
  resetPayloadResolution()
}

{
  // Source 3 (last resort): with nothing staged and no payloadPath, the
  // provisioner reaches for the pin's URL — and the stub catches it.
  const { engine } = provisionEngine({})
  const { error } = await provisionRefusal(engine, 'winbox', {})
  check('with no staged archive the pin URL is fetched (the documented last resort)',
    fetchAttempts.at(-1) === BASH_PAYLOAD_PIN.url, JSON.stringify(fetchAttempts))
  check('the download attempt is what fails the run (stub marker surfaces)',
    error?.message.includes('no-network-in-test'), String(error))
}

// ---------------------------------------------------------------------------
console.log('\n[niubashRootFor spells the three-level convention]')

{
  const RUNTIME = NIUBASH_RUNTIME_RELATIVE
  check('the runtime relative path is the documented conventional suffix',
    RUNTIME === '.dsh\\runtimes\\plugins\\dsh-ssh-workspace\\niubash', JSON.stringify(RUNTIME))
  check('the user placement resolves against the remote profile directory',
    niubashRootFor('user', { home: 'C:\\Users\\u' }) === `C:\\Users\\u\\${RUNTIME}`,
    niubashRootFor('user', { home: 'C:\\Users\\u' }))
  check('the project placement resolves against the remote project directory',
    niubashRootFor('project', { projectRoot: 'D:\\code\\repo' }) === `D:\\code\\repo\\${RUNTIME}`,
    niubashRootFor('project', { projectRoot: 'D:\\code\\repo' }))
  check('the custom placement IS the user-chosen directory (no suffix appended)',
    niubashRootFor('custom', { customRoot: 'D:\\bash\\here\\' }) === 'D:\\bash\\here',
    niubashRootFor('custom', { customRoot: 'D:\\bash\\here\\' }))
  check('forward-slash spellings normalize to backslashes',
    niubashRootFor('user', { home: 'C:/Users/u' }) === `C:\\Users\\u\\${RUNTIME}`)
  let userError
  let unknownError
  try { niubashRootFor('user', {}) } catch (error) { userError = error.message }
  try { niubashRootFor('machine', {}) } catch (error) { unknownError = error.message }
  check('a missing home names the placement and its base',
    userError?.includes('the remote profile directory') && userError.includes('user'), String(userError))
  check('an unknown placement names the closed set',
    unknownError?.includes('project, user, custom'), String(unknownError))
}

// ---------------------------------------------------------------------------
console.log('\n[installRoot / placement reach the tree root the receipt names]')

{
  // placement 'user' resolves %USERPROFILE% remotely and lands the tree at the
  // conventional user-directory root — the exact spelling the kick targets.
  writeStaged(fixtureManifest())
  resetPayloadResolution()
  const { engine, touched, setStatReply } = provisionEngine({})
  setStatReply({ isFile: () => true, isDirectory: () => false })
  // A receipt matching the pin makes the run stop at reuse: no payload, no
  // publish — the whole flow proves itself offline through the receipt alone.
  const receipt = Buffer.from(JSON.stringify({
    schemaVersion: 1, name: 'bash', version: '9.9.9', sha256: ARCHIVE_SHA,
  }))
  engine.withSftp = async (_alias, operation) => await operation({
    stat (target, callback) { touched.statPaths.push(target); callback(null, { isFile: () => true }) },
    open (target, flags, callback) { callback(null, { __handle: target }) },
    read (handle, buffer, _offset, length, position, callback) {
      if (position === 0 && handle.__handle !== undefined) {
        buffer.set(receipt.subarray(0, Math.min(length, receipt.length)))
        callback(null, receipt.length)
      } else callback(null, 0)
    },
    close (handle, callback) { callback(null) },
  })
  const outcome = await provisionWinBash(engine, 'winbox', { placement: 'user' })
  check('the user placement stats the receipt at the conventional user-directory root',
    touched.statPaths[0] === '/C:/Users/u/.dsh/runtimes/plugins/dsh-ssh-workspace/niubash/.provisioned.json',
    JSON.stringify(touched.statPaths))
  check('the resolved %USERPROFILE% is asked exactly once (home resolution stays in the provisioner)',
    touched.execRaw.filter(command => command === 'echo %USERPROFILE%').length === 1, JSON.stringify(touched.execRaw))
  check('a matching receipt reuses the tree (no payload, no publish, offline)',
    outcome.reused === true && outcome.placement === 'user' && outcome.version === '9.9.9'
    && outcome.releaseTag === 'v9.9.9' && outcome.root === 'C:\\Users\\u\\.dsh\\runtimes\\plugins\\dsh-ssh-workspace\\niubash'
    && outcome.path === 'C:\\Users\\u\\.dsh\\runtimes\\plugins\\dsh-ssh-workspace\\niubash\\winuxcmd\\usr\\bin\\bash.exe',
    JSON.stringify(outcome))
  check('the reuse path verified the executable by running it',
    outcome.verify.startsWith('GNU bash') && touched.execRaw.some(command => command.includes('--version')), JSON.stringify(outcome.verify))
  clearStaged()
  resetPayloadResolution()
}

{
  // installRoot (the project/custom placements the routes compute) skips the
  // HOME round trip entirely and names the tree root verbatim.
  writeStaged(fixtureManifest())
  resetPayloadResolution()
  const installRoot = 'D:\\repo\\.dsh\\runtimes\\plugins\\dsh-ssh-workspace\\niubash'
  const { engine, touched } = provisionEngine({})
  const { error } = await provisionRefusal(engine, 'winbox', { installRoot, placement: 'project' })
  check('an installRoot run never resolves %USERPROFILE%',
    touched.execRaw.every(command => command !== 'echo %USERPROFILE%'), JSON.stringify(touched.execRaw))
  check('the receipt stat names the installRoot (SFTP spelling, normalized)',
    touched.statPaths[0] === '/D:/repo/.dsh/runtimes/plugins/dsh-ssh-workspace/niubash/.provisioned.json',
    JSON.stringify(touched.statPaths))
  check('the publish-stage refusal still ends the run (the gates passed)',
    error?.message.includes('sftp refused (test double)'), String(error))
  clearStaged()
  resetPayloadResolution()
}

{
  // No placement, no installRoot → the LEGACY store root, keyed by the pin's
  // version (the historical ssh_workspace_bash shape, unchanged).
  const { engine, touched } = provisionEngine({})
  await provisionRefusal(engine, 'winbox', {})
  check('a bare provision targets the legacy store root with the pin version',
    touched.statPaths[0] === `/C:/Users/u/.dsh-ssh-workspace/bash/${BASH_PAYLOAD_PIN.version}/.provisioned.json`,
    JSON.stringify(touched.statPaths))
}

// ---------------------------------------------------------------------------
console.log('\n[the receipt and the record carry placement / releaseTag]')

{
  // The fixture manifest doubles as the pin here (same field names), so the
  // receipt test does not depend on which pin the sandbox currently resolves.
  const receipt = JSON.parse(bashReceiptText('winbox', fixtureManifest(), { placement: 'user' }))
  check('a placement lands on the receipt verbatim', receipt.placement === 'user', JSON.stringify(receipt))
  check('the receipt names the release tag', receipt.releaseTag === 'v9.9.9', JSON.stringify(receipt))
  const bare = JSON.parse(bashReceiptText('winbox'))
  check('the historical (no-placement) receipt stays placement-free',
    bare.placement === undefined && bare.releaseTag === BASH_PAYLOAD_PIN.releaseTag, JSON.stringify(bare))
  check('bashExePathOf joins the pin executable in Windows spelling',
    bashExePathOf('C:\\tree\\root').endsWith('\\winuxcmd\\usr\\bin\\bash.exe'), bashExePathOf('C:\\tree\\root'))
}

rmSync(sandbox, { recursive: true, force: true })

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
