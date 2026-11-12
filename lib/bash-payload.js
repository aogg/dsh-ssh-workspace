/**
 * The pinned Windows bash payload and its provisioner: download (or take a
 * locally supplied copy), digest-check, unpack ON THE DSH HOST, upload the
 * whole tree over SFTP, verify the remote bash by executing it, and record
 * the deployment.
 *
 * The pin names the public `niubash` releases — the same artifact the
 * dsh-ops distribution provisions for the same job — a `.tar.gz` that node's
 * own `zlib` plus a small tar reader can open on ANY host platform, which is
 * the whole reason this format was chosen: unpacking must not depend on the
 * remote side (no remote tar.exe, no Expand-Archive, no curl/bitsadmin) and
 * must not drag in a native archive dependency on the DSH host either. The
 * red line this module keeps: the remote side sees exactly two things — SFTP
 * writes and executions of the bash this payload carries. Every cmd builtin
 * the flow touches (`set` for PATH, `if exist`/`where` during detection) is
 * part of the login shell itself, never a separate program.
 *
 * Where the pin comes from: `scripts/stage-niubash.mjs` (npm's `prepack`
 * lifecycle) fetches the LATEST niubash win-x64 release, digest-checks it,
 * stages the archive into `runtime/niubash/` and writes the
 * `runtime/niubash/manifest.json` that describes it ({@link readPayloadManifest}).
 * A packaged plugin therefore carries its own payload AND its own pin, and
 * {@link resolvePayloadPin} prefers that manifest. In a bare developer
 * checkout (no staged runtime) the manifest is absent and the module falls
 * back to {@link BASH_PAYLOAD_PIN}, the verified v1.5.0 constant with the
 * historical online-download path — so `npm run check` and the smoke gates
 * keep working offline.
 *
 * Layout on the remote host: the placement root chosen at init time
 * (`<远端项目目录>\.dsh\runtimes\plugins\dsh-ssh-workspace\niubash`,
 * `<远端用户目录>\.dsh\runtimes\plugins\dsh-ssh-workspace\niubash`, or a
 * user-chosen directory — see {@link niubashRootFor}) holding the extracted
 * tree plus the receipt file ({@link BASH_RECEIPT_FILE}) and the staged
 * manifest copy inside it, published by an SFTP rename of a fully-uploaded
 * `.stage-…` sibling (an interrupted upload never becomes the installed
 * version). The receipt mirrors dsh-ops's `.provisioned.json` discipline: it
 * names the pin that produced the bytes, and a tree whose receipt matches
 * the pin is reused instead of re-uploaded. Deployments made by older plugin
 * versions live under the legacy store root
 * (`<HOME>\.dsh-ssh-workspace\bash\<version>`); their recorded paths stay
 * trusted — only new inits use the niubash placement convention.
 *
 * Deployment is EXPLICIT: the only entry point is
 * {@link provisionWinBash}, called from the `ssh_workspace_bash` tool.
 * Nothing here runs automatically.
 *
 * @module @shiqyka/dsh-ssh-workspace/bash-payload
 */

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { open, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { gunzipSync } from 'node:zlib'

import { bashLaunchPrefix, verifyBashExecutable } from './win-bash.js'
import {
  sftpCloseHandle,
  sftpMkdirp,
  sftpOpenHandle,
  sftpReadHandle,
  sftpStatOrNull,
  sftpWriteHandle,
} from './remote-fs.js'

/**
 * The FALLBACK payload pin, used only when the package carries no staged
 * manifest (`runtime/niubash/manifest.json` — a bare developer checkout).
 * The packaged plugin replaces this with the manifest
 * `scripts/stage-niubash.mjs` generates from the latest niubash release at
 * pack time; see {@link resolvePayloadPin}. Editing any field is a
 * supply-chain decision — the sha256 must be re-verified against freshly
 * downloaded bytes, never assumed.
 *
 * Provenance: `niubash` (https://github.com/unixwin/niubash) v1.5.0, the
 * Rust bash-compatible shell for Windows; the digest values were verified
 * byte-for-byte against the published release before being frozen here (the
 * archive hash, the archive size, and the sha256 of the bash executable
 * inside it). `prefix` is the single root directory the archive unpacks
 * into; members outside it are rejected.
 *
 * @type {object}
 */
export const BASH_PAYLOAD_PIN = Object.freeze({
  name: 'bash',
  platform: 'win',
  arch: 'x64',
  version: '1.5.0',
  releaseTag: 'v1.5.0',
  assetFile: 'niubash-v1.5.0-win-x64.tar.gz',
  url: 'https://github.com/unixwin/niubash/releases/download/v1.5.0/niubash-v1.5.0-win-x64.tar.gz',
  sha256: 'da28cdc4e2e87f777ee0eae71386276f9c6a0ed135c1e2baad943acd8d349b87',
  bytes: 32931587,
  extractor: 'tar.gz',
  prefix: 'niubash-v1.5.0-win-x64/',
  executableRelativePath: 'winuxcmd/usr/bin/bash.exe',
  executableSha256: '06ae67a4432b21a79838960adbdbdf5c1f08ecb54ae6da58f603cd9d2ed96ca0',
  upstream: 'niubash',
  upstreamUrl: 'https://github.com/unixwin/niubash',
})

/**
 * Where the packaged payload + manifest live, relative to the package root.
 * `scripts/stage-niubash.mjs` stages the archive here and writes
 * `manifest.json` beside it; `package.json` `files` ships the whole
 * directory, so a published plugin is self-contained (provisioning needs no
 * network when the staged archive digest-checks).
 *
 * @type {string}
 */
export const NIUBASH_RUNTIME_DIR = 'runtime/niubash'

/** The staged manifest's file name, inside {@link NIUBASH_RUNTIME_DIR}. */
export const NIUBASH_MANIFEST_FILE = 'manifest.json'

/**
 * The manifest fields a staged payload must carry for its pin to be usable.
 * Every entry is a required string (with a per-field shape noted in the
 * value) — an unreadable or incomplete manifest degrades to the fallback
 * pin instead of poisoning provisioning with half a description.
 *
 * @type {ReadonlyMap<string, (value: string) => boolean>}
 */
const MANIFEST_STRING_FIELDS = Object.freeze(new Map([
  ['name', value => value.length > 0],
  ['platform', value => value.length > 0],
  ['arch', value => value.length > 0],
  ['upstream', value => value.length > 0],
  ['upstreamUrl', value => /^https:\/\//u.test(value)],
  ['releaseTag', value => value.length > 0],
  ['version', value => value.length > 0],
  ['assetFile', value => value.length > 0],
  ['url', value => /^https:\/\//u.test(value)],
  ['sha256', value => /^[0-9a-f]{64}$/u.test(value)],
  ['extractor', value => value === 'tar.gz'],
  // The archive's single root directory, with the trailing slash — the same
  // shape BASH_PAYLOAD_PIN.prefix has always had.
  ['prefix', value => value.endsWith('/') && !value.startsWith('/')],
  // Forward-slash member path inside the archive (no leading slash).
  ['executableRelativePath', value => !value.includes('\\') && !value.startsWith('/') && value.length > 0],
  ['executableSha256', value => /^[0-9a-f]{64}$/u.test(value)],
]))

/** The manifest's numeric fields with their predicates. */
const MANIFEST_NUMBER_FIELDS = Object.freeze(new Map([
  ['bytes', value => Number.isSafeInteger(value) && value > 0],
]))

/** The marker file a provisioned version directory carries (inside the tree root). */
export const BASH_RECEIPT_FILE = '.provisioned.json'

/**
 * The LEGACY remote store root, relative to the host user's profile
 * directory — where deployments made before the niubash placement
 * convention live (`<HOME>\.dsh-ssh-workspace\bash\<version>`). Still fully
 * supported: a host entry whose record names a tree there keeps working
 * (recorded paths are trusted), and the `ssh_workspace_bash` tool keeps
 * provisioning there. New inits from the panel use
 * {@link NIUBASH_RUNTIME_RELATIVE} instead.
 */
export const BASH_STORE_RELATIVE = '.dsh-ssh-workspace\\bash'

/**
 * The niubash runtime directory, relative to a placement base, where NEW
 * deployments land: `<base>\.dsh\runtimes\plugins\dsh-ssh-workspace\niubash`
 * with `<base>` being the remote project directory (a mounted workspace
 * root), the remote user profile directory (the default), or a user-chosen
 * root (custom). The placement root IS the payload tree root — receipt and
 * staged-manifest copy included — so the three-level probe needs exactly one
 * directory check per candidate.
 */
export const NIUBASH_RUNTIME_RELATIVE = '.dsh\\runtimes\\plugins\\dsh-ssh-workspace\\niubash'

/** Guard for the in-memory gunzip step (the tar is ~65 MB for the pinned payload). */
const MAX_TAR_BYTES = 256 * 1024 * 1024

/** SFTP write chunk, matching the transfer half's own transfer size. */
const CHUNK_BYTES = 256 * 1024

// ---------------------------------------------------------------------------
// Staged payload manifest (pack-time) and the derived pin
// ---------------------------------------------------------------------------

/**
 * The absolute path of the staged manifest inside THIS package, computed from
 * the module URL so it resolves in the installed layout (`<pkg>/lib/…` →
 * `<pkg>/runtime/niubash/manifest.json`) and in a bare checkout alike.
 *
 * @returns {string} the manifest path (not guaranteed to exist).
 */
function stagedManifestPath () {
  return fileURLToPath(new URL(`../${NIUBASH_RUNTIME_DIR}/${NIUBASH_MANIFEST_FILE}`, import.meta.url))
}

/**
 * The absolute path of the staged archive inside THIS package, for one asset
 * file name.
 *
 * @param {string} assetFile - the archive's file name (`niubash-v…-win-x64.tar.gz`).
 * @returns {string} the archive path (not guaranteed to exist).
 */
function stagedArchivePath (assetFile) {
  // fileURLToPath needs a URL, and an asset file name with characters that
  // are significant in URLs would be misread — encode the path segments, then
  // put the plain separators back.
  return fileURLToPath(new URL(`../${NIUBASH_RUNTIME_DIR}/${encodeURIComponent(assetFile)}`.replaceAll('%2F', '/'), import.meta.url))
}

/**
 * Read and validate the staged payload manifest (pack-time generated), or
 * `undefined` when this is a bare checkout without one.
 *
 * Validation is strict on PURPOSE: a half-written or tampered manifest must
 * degrade to the fallback pin ({@link BASH_PAYLOAD_PIN}) — whose provenance
 * was verified byte-for-byte — rather than become a provisioning pin with
 * guessed-at fields. `stagedAt` is carried through unvalidated (display
 * only), everything else must match {@link MANIFEST_STRING_FIELDS} /
 * {@link MANIFEST_NUMBER_FIELDS}.
 *
 * @returns {object | undefined} the manifest, or undefined when absent or unusable.
 */
export function readPayloadManifest () {
  const file = stagedManifestPath()
  if (!existsSync(file)) return undefined
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    // 打包产物 manifest 损坏时回退内置 pin；记录原因便于排查包内容。
    console.warn(`ssh-workspace: unreadable staged payload manifest at ${file} (${error instanceof Error ? error.message : String(error)}); falling back to the bundled pin`)
    return undefined
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  for (const [field, ok] of MANIFEST_STRING_FIELDS) {
    const value = raw[field]
    if (typeof value !== 'string' || !ok(value)) {
      console.warn(`ssh-workspace: staged payload manifest field ${JSON.stringify(field)} is missing or malformed; falling back to the bundled pin`)
      return undefined
    }
  }
  for (const [field, ok] of MANIFEST_NUMBER_FIELDS) {
    const value = raw[field]
    if (!ok(value)) {
      console.warn(`ssh-workspace: staged payload manifest field ${JSON.stringify(field)} is missing or malformed; falling back to the bundled pin`)
      return undefined
    }
  }
  return raw
}

/**
 * Build a pin object from a validated staged manifest.
 *
 * @param {object} manifest - the manifest {@link readPayloadManifest} returned.
 * @returns {object} a frozen pin with exactly {@link BASH_PAYLOAD_PIN}'s shape.
 */
function pinFromManifest (manifest) {
  return Object.freeze({
    name: manifest.name,
    platform: manifest.platform,
    arch: manifest.arch,
    version: manifest.version,
    releaseTag: manifest.releaseTag,
    assetFile: manifest.assetFile,
    url: manifest.url,
    sha256: manifest.sha256,
    bytes: manifest.bytes,
    extractor: manifest.extractor,
    prefix: manifest.prefix,
    executableRelativePath: manifest.executableRelativePath,
    executableSha256: manifest.executableSha256,
    upstream: manifest.upstream,
    upstreamUrl: manifest.upstreamUrl,
  })
}

/**
 * The payload resolution for THIS process, computed once: the pin (staged
 * manifest preferred, bundled {@link BASH_PAYLOAD_PIN} fallback), the raw
 * manifest when one was used, and the staged archive path when the package
 * carries the archive AND its bytes still digest-match the manifest.
 *
 * The staged archive check is what makes a packaged plugin provision fully
 * offline: a byte-verified copy sits inside the package, so the download
 * (and `payloadPath`) become fallbacks rather than requirements. A staged
 * archive that does NOT match its manifest is ignored — never provisioned
 * from.
 *
 * @returns {{pin: object, manifest: object | undefined, stagedArchive: string | undefined}}
 *   the resolution. `pin` is always a frozen object of the canonical shape.
 */
export function resolvedPayload () {
  if (cachedResolution !== null) return cachedResolution
  const manifest = readPayloadManifest()
  if (manifest === undefined) {
    cachedResolution = { pin: BASH_PAYLOAD_PIN, manifest: undefined, stagedArchive: undefined }
    return cachedResolution
  }
  const pin = pinFromManifest(manifest)
  let stagedArchive
  const candidate = stagedArchivePath(pin.assetFile)
  if (existsSync(candidate)) {
    // Size first (cheap), digest second — a renamed/partial staged archive
    // must never become a provisioning source.
    let size = 0
    try { size = statSync(candidate).size } catch { size = -1 }
    if (size === pin.bytes) {
      // The digest runs asynchronously; kick it off and let the promise fill
      // the answer in before provisioning reads `stagedArchive`. Callers that
      // need certainty await {@link payloadStagedArchiveReady} first.
      stagedArchive = candidate
      stagedArchiveDigestTask = sha256File(candidate).then(digest => {
        stagedArchiveDigest = digest === pin.sha256 ? candidate : undefined
        return stagedArchiveDigest
      }).catch(() => { stagedArchiveDigest = undefined })
    } else {
      console.warn(`ssh-workspace: staged payload archive is ${size} bytes, not the manifest's ${pin.bytes}; it will not be used as a provisioning source`)
    }
  }
  cachedResolution = { pin, manifest, stagedArchive }
  return cachedResolution
}

/**
 * Await the staged archive's digest verification started by
 * {@link resolvedPayload}, and return the usable staged archive path
 * (undefined when there is none, or it failed the check).
 *
 * @returns {Promise<string | undefined>} the verified staged archive path.
 */
export async function payloadStagedArchiveReady () {
  const resolution = resolvedPayload()
  if (stagedArchiveDigestTask !== null) await stagedArchiveDigestTask
  return stagedArchiveDigest ?? resolution.stagedArchive
}

/** Module-scope cache for {@link resolvedPayload} (computed once per process). */
let cachedResolution = null

/** In-flight digest verification of the staged archive (null = none). */
let stagedArchiveDigestTask = null

/** The digest-verified staged archive path (undefined until proven). */
let stagedArchiveDigest = undefined

/**
 * The pin provisioning trusts in THIS process: the staged manifest's pin
 * when the package carries one, else the bundled {@link BASH_PAYLOAD_PIN}.
 *
 * @returns {object} a frozen pin of the canonical shape.
 */
export function resolvePayloadPin () {
  return resolvedPayload().pin
}

/** Drop the module-scope payload resolution (used by tests / hot reload). */
export function resetPayloadResolution () {
  cachedResolution = null
  stagedArchiveDigestTask = null
  stagedArchiveDigest = undefined
}

/**
 * The SHA-256 of one file, streamed so the ~33 MB archive never sits in
 * memory twice during verification.
 *
 * @param {string} file - the file to hash.
 * @returns {Promise<string>} the lowercase hex digest.
 */
export async function sha256File (file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file, { highWaterMark: CHUNK_BYTES })) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

/**
 * Reject an archive member name that could escape the extraction target:
 * absolute paths, backslash or drive-letter spellings, `..` segments, empty
 * or dot segments, trailing dots/spaces and reserved device names — the
 * Windows-flavored tightening of the usual tar-slip guard. The check runs
 * BEFORE any filesystem write.
 *
 * @param {string} name - the member name as recorded in the tar.
 * @returns {string} the same name, when safe.
 * @throws {Error} when the name must not be extracted.
 */
export function safeBashMember (name) {
  if (name === '' || /[\\:\x00-\x1f]/u.test(name) || name.startsWith('/') || name.endsWith('/')
    || name.split('/').some(part => part === '' || part === '.' || part === '..' || /[. ]$/u.test(part)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.[^.]*)?$/iu.test(part))) {
    throw new Error(`unsafe bash payload archive member: ${JSON.stringify(name)}`)
  }
  return name
}

/**
 * Parse one tar header field as octal.
 *
 * @param {Buffer} header - the 512-byte header block.
 * @param {number} start - field start offset.
 * @param {number} end - field end offset.
 * @returns {number} the parsed value.
 */
function tarOctal (header, start, end) {
  const text = header.subarray(start, end).toString('utf8').replace(/\0.*$/su, '').trim()
  const value = Number.parseInt(text, 8)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid bash payload tar numeric field: ${JSON.stringify(text)}`)
  return value
}

/**
 * The full member name of one tar header, joining the ustar `prefix` split
 * back onto the 100-byte `name` field. Trailing slashes are KEPT — directory
 * members are stored with one (`root/`) and some callers derive the member's
 * directory from this exact spelling; strip them at the call site when a
 * bare name is wanted.
 *
 * ustar (POSIX.1-1988) spells paths longer than 100 bytes as TWO header
 * fields: `name` (offset 0, 100 bytes) holds the tail and `prefix` (offset
 * 345, 155 bytes) holds the leading directories; the real path is
 * `prefix + '/' + name`. Reading `name` alone misreads every split member as
 * a root-less path. This is not hypothetical: the official niubash v1.5.0
 * win-x64 asset (sha256 `da28cdc4…`, byte-verified) is packed exactly this
 * way — 7 of its 194 members split, all `winuxcmd/opt/niugit/mingw64/share/
 * git-core/templates/hooks/*` files whose `prefix` field carries the
 * `niubash-v1.5.0-win-x64` root — which is what made the name-only walk
 * report phantom outside-the-root members. A member stored entirely in
 * `name` (empty `prefix`, the other 187) joins to itself, so the fix is
 * invisible to short paths. NUL and surrounding whitespace are stripped from
 * the prefix field, mirroring how {@link tarOctal} reads numeric fields.
 *
 * @param {Buffer} header - the 512-byte header block.
 * @returns {string} the joined member name (trailing slash kept when the
 *   header stored one).
 */
function tarMemberName (header) {
  const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/su, '')
  const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/su, '').trim()
  return prefix !== '' ? `${prefix}/${name}` : name
}

/**
 * Read a gzipped tar archive into a member map, enforcing the pin's root
 * prefix and the payload's own executable digest.
 *
 * Member types are the three the payload actually uses: regular files (`0`),
 * directories (`5`) and hardlinks (`1`, resolved to the bytes of their
 * earlier target — the payload packs duplicated executables this way).
 * Anything else (symlinks, devices, PAX members) is rejected rather than
 * guessed at: the provisioned tree must be exactly the bytes the pin
 * digest-checked.
 *
 * ustar prefix/name splits are joined BEFORE any pin-prefix check or
 * {@link safeBashMember} call (see {@link tarMemberName} for the split
 * semantics and the real v1.5.0 evidence — 7 of 194 members). The root
 * directory member keeps its existing skip path: whether its header stored
 * the root as a plain name (`root/`) or split it (`prefix` = root, empty
 * `name`), the join plus the trailing-slash strip below reduce both to the
 * bare root, which the `type === '5'` skip consumes. Hardlink `linkname`
 * fields get NO prefix join — ustar defines the prefix split for `name`
 * only — and none is needed: the pinned asset writes full in-archive paths
 * (root included, ≤100 bytes) as linknames, so the strip-or-reject
 * resolution below stands unchanged and a >100-byte linkname keeps failing
 * as an unknown target.
 *
 * @param {string} archive - path to the verified .tar.gz file.
 * @param {object} [pin] - the pin (defaults to {@link BASH_PAYLOAD_PIN}).
 * @returns {Promise<{files: Map<string, Buffer>, executableBytes: Buffer, totalBytes: number}>}
 *   prefix-stripped member paths → bytes, the payload executable's bytes,
 *   and the sum of file bytes.
 * @throws {Error} on a malformed, truncated, unsafe or unexpected archive.
 */
export async function readBashTarGz (archive, pin = BASH_PAYLOAD_PIN) {
  const bytes = await readFile(archive)
  let tar
  try {
    tar = gunzipSync(bytes, { maxOutputLength: MAX_TAR_BYTES })
  } catch (error) {
    throw new Error(`bash payload archive is not readable gzip: ${error instanceof Error ? error.message : String(error)}`)
  }
  const files = new Map()
  let executableBytes
  let totalBytes = 0
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const rawName = tarMemberName(header).replace(/\/+$/u, '')
    const size = tarOctal(header, 124, 136)
    const type = header.subarray(156, 157).toString('utf8').replace(/\0.*$/su, '') || '0'
    const link = header.subarray(157, 257).toString('utf8').replace(/\0.*$/su, '')
    if (offset + 512 + size > tar.length) throw new Error(`bash payload tar member truncated: ${JSON.stringify(rawName)}`)
    const data = tar.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
    if (rawName === pin.prefix.replace(/\/+$/u, '') && type === '5') continue
    if (!rawName.startsWith(pin.prefix)) throw new Error(`bash payload archive member outside the pinned root: ${JSON.stringify(rawName)}`)
    const name = safeBashMember(rawName.slice(pin.prefix.length))
    if (type === '5') continue
    if (type === '1') {
      const target = files.get(safeBashMember(link.startsWith(pin.prefix) ? link.slice(pin.prefix.length) : link))
      if (target === undefined) throw new Error(`bash payload tar hardlink with no earlier target: ${JSON.stringify(rawName)}`)
      files.set(name, target)
    } else if (type === '0') {
      files.set(name, data)
      totalBytes += data.length
    } else {
      throw new Error(`unsupported bash payload tar member type ${JSON.stringify(type)}: ${JSON.stringify(rawName)}`)
    }
    if (name === pin.executableRelativePath) executableBytes = files.get(name)
  }
  if (executableBytes === undefined) throw new Error(`bash payload archive does not carry ${pin.executableRelativePath}`)
  const executableSha = createHash('sha256').update(executableBytes).digest('hex')
  if (executableSha !== pin.executableSha256) {
    throw new Error(`bash payload executable hashed to ${executableSha}, not the pinned ${pin.executableSha256}`)
  }
  return { files, executableBytes, totalBytes }
}

/**
 * List a gzipped tar archive's members WITHOUT any pin: names, types, sizes
 * and raw data buffers keyed by full (unstripped) member name.
 *
 * This is the packaging-side counterpart of {@link readBashTarGz}:
 * `scripts/stage-niubash.mjs` runs it against a freshly downloaded release
 * to DISCOVER the archive's root prefix and its bash executable's relative
 * path — facts the runtime pin then freezes into the staged manifest. The
 * header walk mirrors {@link readBashTarGz} exactly (same octal fields, same
 * member-type rejection, same ustar prefix/name join via
 * {@link tarMemberName} — without it the walk collapses the real v1.5.0
 * asset's 7 split members to root-less paths and reports no single root) so
 * what the packer sees is what the provisioner will later re-parse;
 * hardlinks are listed by name with their link target (no resolution — the
 * packer only needs names and the executable's bytes).
 *
 * @param {string} archive - path to the .tar.gz file.
 * @returns {Promise<{prefix: string, members: Map<string, {type: string, data: Buffer, link: string}>, bashMembers: string[]}>}
 *   the detected single root prefix (with trailing slash; `''` when the
 *   members sit at the archive root), every regular-file member keyed by full
 *   name, and the names of members whose path ends in `bash.exe` (the
 *   payload executable candidates, most nested first).
 * @throws {Error} on malformed or unsupported archives.
 */
export async function listBashTarGzMembers (archive) {
  const bytes = await readFile(archive)
  let tar
  try {
    tar = gunzipSync(bytes, { maxOutputLength: MAX_TAR_BYTES })
  } catch (error) {
    throw new Error(`bash payload archive is not readable gzip: ${error instanceof Error ? error.message : String(error)}`)
  }
  const members = new Map()
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const rawName = tarMemberName(header).replace(/\/+$/u, '')
    const size = tarOctal(header, 124, 136)
    const type = header.subarray(156, 157).toString('utf8').replace(/\0.*$/su, '') || '0'
    const link = header.subarray(157, 257).toString('utf8').replace(/\0.*$/su, '')
    if (offset + 512 + size > tar.length) throw new Error(`bash payload tar member truncated: ${JSON.stringify(rawName)}`)
    const data = tar.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
    if (type === '5') continue // directories carry no bytes the packer needs
    if (type !== '0' && type !== '1') {
      throw new Error(`unsupported bash payload tar member type ${JSON.stringify(type)}: ${JSON.stringify(rawName)}`)
    }
    members.set(rawName, { type, data, link })
  }
  if (members.size === 0) throw new Error('bash payload archive carries no members')
  // The common leading directory across every member is the archive's single
  // root prefix; an archive whose members sit at several roots has none and
  // is rejected (the runtime parser would reject it too — `prefix` is frozen
  // into the manifest).
  let prefix = undefined
  for (const name of members.keys()) {
    const dir = name.includes('/') ? name.slice(0, name.lastIndexOf('/') + 1) : ''
    prefix = prefix === undefined ? dir : sharedLeadingDir(prefix, dir)
    if (prefix === '') break
  }
  const root = prefix ?? ''
  const bashMembers = [...members.keys()]
    .filter(name => name.toLowerCase().endsWith('/bash.exe') || name.toLowerCase() === 'bash.exe')
    .sort((a, b) => a.length - b.length)
  return { prefix: root, members, bashMembers }
}

/**
 * The longest leading directory two path prefixes share, boundary-aligned.
 *
 * @param {string} a - one directory prefix, trailing slash included.
 * @param {string} b - the other directory prefix, trailing slash included.
 * @returns {string} the shared prefix with its trailing slash, or `''`.
 */
function sharedLeadingDir (a, b) {
  let cut = 0
  const limit = Math.min(a.length, b.length)
  for (let i = 0; i < limit; i += 1) {
    if (a[i] !== b[i]) break
    if (a[i] === '/') cut = i + 1
  }
  return a.slice(0, cut)
}

/**
 * Write one extracted tree to a local staging directory.
 *
 * @param {Map<string, Buffer>} files - prefix-stripped member paths → bytes.
 * @param {string} staging - the empty staging directory.
 * @returns {number} how many files were written.
 */
export function stageBashTree (files, staging) {
  let written = 0
  for (const [name, data] of files) {
    const target = join(staging, name)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, data, { mode: 0o644 })
    written += 1
  }
  return written
}

/**
 * The receipt text for one provisioned tree: which pin produced these bytes,
 * and (for niubash-convention placements) where the tree was placed.
 *
 * @param {string} alias - the host the payload is being deployed to.
 * @param {object} [pin] - the pin (defaults to the bundled
 *   {@link BASH_PAYLOAD_PIN} so historical call sites keep their exact
 *   receipt; the provisioner passes ITS resolved pin explicitly).
 * @param {object} [extra] - additional receipt fields (`placement`):
 *   appended verbatim when present.
 * @returns {string} the JSON document with a trailing newline.
 */
export function bashReceiptText (alias, pin = BASH_PAYLOAD_PIN, extra = {}) {
  return `${JSON.stringify({
    schemaVersion: 1,
    name: pin.name,
    version: pin.version,
    releaseTag: pin.releaseTag,
    upstream: pin.upstream,
    upstreamUrl: pin.upstreamUrl,
    url: pin.url,
    assetFile: pin.assetFile,
    bytes: pin.bytes,
    sha256: pin.sha256,
    extractor: pin.extractor,
    executable: pin.executableRelativePath,
    executableSha256: pin.executableSha256,
    provisionedBy: 'dsh-ssh-workspace',
    provisionedAt: new Date().toISOString(),
    hostAlias: alias,
    ...(typeof extra?.placement === 'string' && extra.placement !== '' ? { placement: extra.placement } : {}),
  }, null, 2)}\n`
}

/**
 * Read a receipt file from the remote tree over SFTP, or undefined when it
 * is absent or unreadable (a tree without a receipt is never trusted).
 *
 * @param {object} sftp - a live SFTP channel.
 * @param {string} receiptPath - the SFTP spelling of the receipt file.
 * @returns {Promise<object | undefined>} the parsed receipt.
 */
async function readRemoteReceipt (sftp, receiptPath) {
  const info = await sftpStatOrNull(sftp, receiptPath)
  if (info === null || typeof info.isFile !== 'function' || !info.isFile()) return undefined
  const handle = await sftpOpenHandle(sftp, receiptPath, 'r', receiptPath)
  try {
    const chunks = []
    let at = 0
    for (;;) {
      const chunk = await sftpReadHandle(sftp, handle, at, CHUNK_BYTES, receiptPath)
      if (chunk.length === 0) break
      chunks.push(chunk)
      at += chunk.length
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      return value !== null && typeof value === 'object' ? value : undefined
    } catch {
      return undefined
    }
  } finally {
    await sftpCloseHandle(sftp, handle)
  }
}

/**
 * Rename one remote path over SFTP.
 *
 * @param {object} sftp - a live SFTP channel.
 * @param {string} from - source (SFTP spelling).
 * @param {string} to - destination (SFTP spelling).
 * @returns {Promise<void>} resolves on success, rejects on the server error.
 */
function sftpRename (sftp, from, to) {
  return new Promise((resolve, reject) => {
    sftp.rename(from, to, (error) => { if (error) reject(error); else resolve() })
  })
}

/**
 * Remove one remote directory tree over SFTP (files, then directories
 * bottom-up). Used only for trees this provisioner published (the version
 * directory it is about to replace and its stage siblings); the walk never
 * follows symlinks — entries are removed by type, and a link-shaped entry is
 * unlinked, not descended.
 *
 * @param {object} sftp - a live SFTP channel.
 * @param {string} directory - the SFTP spelling of the tree root.
 * @returns {Promise<void>} resolves when the tree is gone or nothing was there.
 */
async function sftpRmTree (sftp, directory) {
  const info = await sftpStatOrNull(sftp, directory)
  if (info === null) return
  if (typeof info.isDirectory !== 'function' || !info.isDirectory()) {
    await new Promise((resolve) => { sftp.unlink(directory, () => { resolve() }) })
    return
  }
  const entries = await new Promise((resolve) => {
    sftp.readdir(directory, (error, list) => { resolve(error ? [] : list) })
  })
  for (const entry of entries) {
    const child = `${directory.replace(/\/+$/u, '')}/${entry.filename}`
    const childInfo = await sftpStatOrNull(sftp, child)
    if (childInfo !== null && typeof childInfo.isDirectory === 'function' && childInfo.isDirectory()) {
      await sftpRmTree(sftp, child)
    } else {
      await new Promise((resolve) => { sftp.unlink(child, () => { resolve() }) })
    }
  }
  await new Promise((resolve) => { sftp.rmdir(directory, () => { resolve() }) })
}

/**
 * The Windows spelling of the payload executable inside a tree root.
 *
 * @param {string} versionDir - the provisioned tree's root (`…\niubash`,
 *   or the legacy `…\.dsh-ssh-workspace\bash\<version>`).
 * @param {object} [pin] - the pin (defaults to the bundled
 *   {@link BASH_PAYLOAD_PIN} so historical call sites keep their exact
 *   spelling; the provisioner passes ITS resolved pin explicitly).
 * @returns {string} `<versionDir>\winuxcmd\usr\bin\bash.exe`.
 */
export function bashExePathOf (versionDir, pin = BASH_PAYLOAD_PIN) {
  return `${versionDir.replace(/[\\/]+$/u, '')}\\${pin.executableRelativePath.replaceAll('/', '\\')}`
}

/**
 * The SFTP spelling of a Windows absolute path (`C:\Users\u` → `/C:/Users/u`).
 *
 * @param {string} winPath - a Windows absolute path.
 * @returns {string} the path as the Windows OpenSSH SFTP server spells it.
 */
function sftpSpellingOf (winPath) {
  const forward = String(winPath).replaceAll('\\', '/')
  return /^[A-Za-z]:\//u.test(forward) ? `/${forward}` : forward
}

/**
 * Normalize a user/host-supplied directory into a backslashed Windows
 * absolute path with separators and trailing separators unified.
 *
 * @param {unknown} value - the candidate directory (either separator style).
 * @param {string} what - what the value names, for the error message.
 * @returns {string} the normalized Windows path.
 * @throws {Error} when the value is blank or not an absolute Windows path
 *   (drive-letter, UNC or volume-guid spelling).
 */
export function normalizeWindowsDir (value, what = 'directory') {
  const candidate = String(value ?? '').trim().replaceAll('/', '\\')
  if (candidate === '') throw new Error(`${what} must not be blank`)
  if (!/^([A-Za-z]:[\\/]|\\\\|\\\\\\?\\[A-Za-z]:\\)/u.test(candidate)) {
    throw new Error(`${what} must be an absolute Windows path (drive-letter or UNC spelling), got ${JSON.stringify(String(value))}`)
  }
  return candidate.replace(/[\\/]+$/u, '')
}

/**
 * The niubash placement root for one placement choice — the tree root the
 * provisioner publishes into, and the address the load-path probe and the
 * injected guidance name.
 *
 * The three-level convention:
 * 1. `project` — `<远端项目目录>\.dsh\runtimes\plugins\dsh-ssh-workspace\niubash`
 *    (only meaningful when the host has a mounted project workspace).
 * 2. `user` — `<远端用户目录>\.dsh\runtimes\plugins\dsh-ssh-workspace\niubash`
 *    (the default; `%USERPROFILE%` is resolved by the provisioner itself).
 * 3. `custom` — a user-chosen absolute Windows directory.
 *
 * @param {'project'|'user'|'custom'} placement - the chosen level.
 * @param {object} bases - the resolved bases.
 * @param {string} [bases.home] - the remote profile directory (`user` level).
 * @param {string} [bases.projectRoot] - the remote project directory
 *   (`project` level).
 * @param {string} [bases.customRoot] - the user-chosen root (`custom` level).
 * @returns {string} the Windows-spelled tree root.
 * @throws {Error} when the chosen level's base is missing or not absolute.
 */
export function niubashRootFor (placement, { home, projectRoot, customRoot } = {}) {
  if (placement === 'project') {
    const root = normalizeWindowsDir(projectRoot, 'the project directory (placement "project")')
    return `${root}\\${NIUBASH_RUNTIME_RELATIVE}`
  }
  if (placement === 'user') {
    const root = normalizeWindowsDir(home, 'the remote profile directory (placement "user")')
    return `${root}\\${NIUBASH_RUNTIME_RELATIVE}`
  }
  if (placement === 'custom') {
    // The user-chosen directory IS the placement (no suffix is appended):
    // the dialog's custom input stands in for the whole conventional path of
    // levels 1–2, so the tree lands exactly where the user typed.
    return normalizeWindowsDir(customRoot, 'the custom placement root (placement "custom")')
  }
  throw new Error(`unknown niubash placement ${JSON.stringify(placement)}; expected one of project, user, custom`)
}

/**
 * Provision the pinned bash payload onto one Windows-type host.
 *
 * Flow: verify the host is dispatchable (a cmd login shell — a
 * PowerShell-default host is refused with the same wording the dialect
 * docs use), resolve the payload bytes (a locally supplied `payloadPath`,
 * else the package's own digest-verified staged archive, else a scripted
 * download of the pin's URL — see {@link resolvePayloadPin} for where the
 * pin comes from), unpack locally, publish the tree to the chosen install
 * root via a staged SFTP upload plus rename, write the receipt and a copy
 * of the staged manifest (they ride inside the uploaded tree — the load-path
 * probe requires `bash.exe` + `manifest.json`), execute the remote bash for
 * real, record the deployment on the host entry, and clear the engine's
 * dialect caches so the next command dispatches POSIX immediately.
 *
 * The install root: `options.installRoot` wins when given (the
 * project/custom niubash placements computed by {@link niubashRootFor});
 * `options.placement === 'user'` resolves the default niubash placement
 * against the freshly resolved `%USERPROFILE%` (home resolution stays in
 * ONE place — here); without either, the LEGACY store root
 * `<HOME>\.dsh-ssh-workspace\bash\<version>` is used — the
 * `ssh_workspace_bash` tool's historical shape, kept unchanged.
 *
 * Every failure keeps the previous state: an existing verified version is
 * reused (or, with `force`, renamed aside first and only removed after the
 * new tree published), and an interrupted run leaves at most a `.stage-…`
 * sibling the next run sweeps.
 *
 * @param {object} engine - the live engine.
 * @param {string} alias - host alias.
 * @param {object} [options] - provision options.
 * @param {string} [options.installRoot] - absolute Windows directory the
 *   tree publishes into (a niubash placement root from {@link niubashRootFor}).
 *   Absent = the legacy `<HOME>\.dsh-ssh-workspace\bash\<version>` root.
 * @param {'project'|'user'|'custom'} [options.placement] - which placement
 *   level `installRoot` was derived from; recorded on the entry and in the
 *   receipt, and reported in the deployment result.
 * @param {string} [options.payloadPath] - local archive on the DSH host
 *   holding the pinned bytes (offline / mirror delivery); digest-checked
 *   against the pin like a download.
 * @param {boolean} [options.force] - replace an existing provisioned tree
 *   even when its receipt matches.
 * @param {AbortSignal} [options.signal] - cancels download / upload / verify.
 * @returns {Promise<{reused: boolean, path: string, root: string, version: string, releaseTag: string, placement: string, files: number, bytes: number, verify: string}>}
 *   the deployment record.
 * @throws {Error} when the host is not a cmd-login Windows type, the store
 *   has no editable entry for the alias, the payload cannot be obtained or
 *   verified, the upload fails, or the remote bash does not prove itself.
 */
export async function provisionWinBash (engine, alias, options = {}) {
  // The pin this process trusts: the staged manifest when the package
  // carries one, else the bundled constant. Resolved once here so every
  // check below (receipt match, digest, tree shape) names the SAME bytes.
  const pin = resolvePayloadPin()
  // A PowerShell-default win host cannot run the cmd spellings this flow is
  // built from — and a POSIX host has nothing to provision. loginDialect is
  // the raw login-shell fact (no bash consultation), exactly the right gate.
  const login = await engine.loginDialect(alias, { signal: options.signal })
  if (login !== 'cmd') {
    throw new Error(`host ${JSON.stringify(alias)} does not have a cmd.exe login shell (${login}); the pinned payload provisions Windows-type hosts only — a POSIX host already has its own bash`)
  }
  const entry = engine.store.entry(alias)
  if (entry === undefined) {
    throw new Error(`host ${JSON.stringify(alias)} has no editable store entry (an ~/.ssh/config fallback cannot carry the provisioned-bash record); save it in the host panel first`)
  }
  // The remote HOME anchors the install path. Resolved through the RAW login
  // shell (the gate above guarantees the cmd dialect; the wrapped `exec`
  // would hand `%USERPROFILE%` to a bash that cannot expand it), never
  // assumed. A caller-supplied installRoot (project / custom placements)
  // skips this round trip; the `user` placement still wants it.
  const needsHome = !(
    typeof options.installRoot === 'string' && options.installRoot.trim() !== ''
  ) || options.placement === 'user'
  let home = ''
  if (needsHome) {
    const homeOutcome = await engine.execRaw(alias, 'echo %USERPROFILE%', { timeoutMs: 15_000, signal: options.signal })
    home = homeOutcome.stdout.trim()
    if (homeOutcome.success !== true || !/^[A-Za-z]:[\\/]/u.test(home)) {
      throw new Error(`could not resolve %USERPROFILE% on ${JSON.stringify(alias)}: ${homeOutcome.error ?? homeOutcome.stdout.trim() ?? 'empty answer'}`)
    }
  }
  const versionDir = typeof options.installRoot === 'string' && options.installRoot.trim() !== ''
    ? normalizeWindowsDir(options.installRoot, 'installRoot')
    : options.placement === 'user'
      ? `${home.replace(/[\\/]+$/u, '')}\\${NIUBASH_RUNTIME_RELATIVE}`
      : `${home.replace(/[\\/]+$/u, '')}\\${BASH_STORE_RELATIVE}\\${pin.version}`
  const versionDirSftp = sftpSpellingOf(versionDir)
  const exePath = bashExePathOf(versionDir, pin)
  const exePathSftp = sftpSpellingOf(exePath)
  const receiptPathSftp = `${versionDirSftp}/${BASH_RECEIPT_FILE}`
  // The verification rides the RAW login shell too: its command line is a
  // cmd spelling (`set "PATH=…" & "<bash>" --version`) that the wrapped exec
  // would wrongly feed to a previously-resolved bash as stdin script.
  const loginShellRunner = { exec: (runnerAlias, command, runOptions) => engine.execRaw(runnerAlias, command, runOptions) }
  const verifyWith = async () => {
    const outcome = await verifyBashExecutable(loginShellRunner, alias, exePath, {
      prefix: bashLaunchPrefix(versionDir),
      signal: options.signal,
      timeoutMs: 30_000,
    })
    return outcome === undefined ? undefined : outcome.version
  }
  // Reuse when the tree is already there with a receipt matching this pin —
  // re-verified by execution, because a receipt only says what ONCE landed.
  const existing = await engine.withSftp(alias, (sftp) => readRemoteReceipt(sftp, receiptPathSftp))
  const receiptMatches = existing !== undefined
    && existing.schemaVersion === 1
    && existing.name === pin.name
    && existing.version === pin.version
    && existing.sha256 === pin.sha256
  if (receiptMatches && options.force !== true) {
    const verify = await verifyWith()
    if (verify !== undefined) {
      return { reused: true, path: exePath, root: versionDir, version: pin.version, releaseTag: pin.releaseTag, placement: placementOf(options), files: 0, bytes: 0, verify }
    }
    engine.logger?.warn?.(`ssh-workspace: provisioned bash on ${alias} stopped verifying; re-deploying`)
  }
  if (receiptMatches === false && existing !== undefined && options.force !== true) {
    throw new Error(`${JSON.stringify(alias)} already has a provisioned bash tree that this pin does not name (${versionDir}); pass force to replace it`)
  }
  // ---- payload bytes ------------------------------------------------------
  // Source order: an explicit local copy (mirror), then the package's own
  // digest-verified staged archive (a packaged plugin provisions offline),
  // then the scripted download of the pin's URL. Every source lands in the
  // same staging file and passes the SAME size + sha256 gates, so the
  // downstream verification cannot tell them apart.
  const staging = mkdtempSync(join(tmpdir(), 'dsh-ssh-ws-bash-'))
  let files = 0
  let totalBytes = 0
  let previous
  try {
    const archive = join(staging, pin.assetFile)
    let fromPath = ''
    if (typeof options.payloadPath === 'string' && options.payloadPath.trim() !== '') {
      fromPath = options.payloadPath.trim()
    } else {
      const staged = await payloadStagedArchiveReady()
      if (staged !== undefined) fromPath = staged
    }
    if (fromPath !== '') {
      const info = await stat(fromPath)
      if (!info.isFile()) throw new Error(`payloadPath is not a regular file: ${fromPath}`)
      await pipeline(createReadStream(fromPath, { highWaterMark: CHUNK_BYTES }), createWriteStream(archive))
    } else {
      const response = await fetch(pin.url, { signal: options.signal, redirect: 'follow' })
      if (!response.ok || response.body === null) {
        throw new Error(`downloading ${pin.url} failed with HTTP ${response.status}; pass payloadPath with a locally fetched copy of ${pin.assetFile} to provision from a mirror`)
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))
    }
    const size = statSync(archive).size
    if (size !== pin.bytes) {
      throw new Error(`bash payload archive is ${size} bytes, not the pinned ${pin.bytes}`)
    }
    const actualSha = await sha256File(archive)
    if (actualSha !== pin.sha256) {
      throw new Error(`bash payload archive hashed to ${actualSha}, not the pinned ${pin.sha256}; refusing unpinned bytes`)
    }
    const extracted = await readBashTarGz(archive, pin)
    files = stageBashTree(extracted.files, staging)
    totalBytes = extracted.totalBytes
    writeFileSync(join(staging, BASH_RECEIPT_FILE), bashReceiptText(alias, pin, { placement: placementOf(options) }), { mode: 0o644 })
    // The staged manifest rides along too: the load-path probe and the
    // "already initialized" checks read `bash.exe` + `manifest.json` from the
    // tree, so the placement carries its own description of its bytes.
    const manifest = resolvedPayload().manifest
    if (manifest !== undefined) {
      writeFileSync(join(staging, NIUBASH_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 })
    }
    // ---- publish ----------------------------------------------------------
    // The version directory is only ever replaced by the rename of a fully
    // uploaded `.stage-…` sibling, so an interrupted upload never publishes a
    // partial tree; the tree being replaced (force) moves aside first and is
    // removed only after the new one published. The sibling parks next to the
    // target — the install root's parent (for the legacy root that is the
    // store root, exactly as before).
    const parentSftp = sftpSpellingOf(versionDir.replace(/[\\/]+[^\\/]+$/u, ''))
    const stageSiblingSftp = `${parentSftp}/.stage-${process.pid}-${Date.now().toString(36)}`
    let published = false
    try {
      await engine.withSftp(alias, async (sftp) => {
        await sftpMkdirp(sftp, stageSiblingSftp, stageSiblingSftp)
      })
      const uploaded = await uploadStagedTree(engine, alias, staging, stageSiblingSftp, options.signal)
      files = uploaded.files
      totalBytes = uploaded.bytes
      await engine.withSftp(alias, async (sftp) => {
        const targetInfo = await sftpStatOrNull(sftp, versionDirSftp)
        if (targetInfo !== null) {
          previous = `${versionDirSftp}.previous-${process.pid}-${Date.now().toString(36)}`
          await sftpRename(sftp, versionDirSftp, previous)
        }
        await sftpRename(sftp, stageSiblingSftp, versionDirSftp)
      })
      published = true
    } finally {
      // A stage sibling left behind by a failure is swept here and, failing
      // that, by the next run's mkdirp+rename cycle — best-effort on purpose:
      // a refused cleanup must not mask the error that aborted the publish.
      if (!published) {
        try {
          await engine.withSftp(alias, (sftp) => sftpRmTree(sftp, stageSiblingSftp))
        } catch (error) {
          engine.logger?.warn?.(`ssh-workspace: could not sweep the stage directory ${stageSiblingSftp}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  // ---- remote integrity check --------------------------------------------
  const verify = await verifyWith()
  if (verify === undefined) {
    throw new Error(`the provisioned bash at ${exePath} did not answer "--version" on ${JSON.stringify(alias)}; the tree was left in place for diagnosis and the host keeps its previous dialect`)
  }
  // ---- record -------------------------------------------------------------
  // The entry record is what makes the deployment survive a restart: the
  // resolution rung consults it before probing anything. mutateHosts keeps
  // every other field (and every other host) untouched. `placement` and
  // `releaseTag` name the niubash-convention placement (legacy deployments
  // record neither — their absence is how an old record is told apart).
  const recordedAt = Date.now()
  const placement = placementOf(options)
  engine.store.entryStore.mutateHosts(entries => entries.map(candidate => (
    candidate.alias === alias
      ? { ...candidate, bashProvisioned: { path: exePath, root: versionDir, version: pin.version, sha256: pin.sha256, provisionedAt: recordedAt, releaseTag: pin.releaseTag, placement } }
      : candidate
  )))
  engine.forgetDialectCaches(alias)
  // The injection gate reads this cache synchronously on every model step;
  // a completed init is the strongest possible presence fact.
  engine.noteNiubashPresence?.(alias, { root: versionDir, path: exePath, version: pin.version, releaseTag: pin.releaseTag, placement, source: 'provisioned' })
  // The displaced previous tree is removed after the new one published and
  // verified; its removal must not fail the deployment.
  if (previous !== undefined) {
    try {
      await engine.withSftp(alias, (sftp) => sftpRmTree(sftp, previous))
    } catch (error) {
      engine.logger?.warn?.(`ssh-workspace: could not remove the previous bash tree ${previous}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { reused: false, path: exePath, root: versionDir, version: pin.version, releaseTag: pin.releaseTag, placement, files, bytes: totalBytes, verify }
}

/**
 * The placement level a provision call records: the caller's `placement`
 * when it named one, `'legacy'` otherwise (the historical
 * `~/.dsh-ssh-workspace/bash/<version>` root).
 *
 * @param {object} options - the provision options.
 * @returns {string} one of project, user, custom, legacy.
 */
function placementOf (options) {
  return typeof options.placement === 'string' && options.placement !== '' ? options.placement : 'legacy'
}

/**
 * Upload one staged local tree into a fresh remote directory.
 *
 * Deliberately a plain SFTP byte-mover: the destination is a plugin-owned
 * path under the host profile (`~/.dsh-ssh-workspace/…`), not a mounted
 * workspace, so the workspace write fences do not apply and none is passed.
 *
 * @param {object} engine - the live engine.
 * @param {string} alias - host alias.
 * @param {string} staging - local staged tree root.
 * @param {string} stageDirSftp - the remote destination (SFTP spelling).
 * @param {AbortSignal} [signal] - cancels mid-upload.
 * @returns {Promise<{files: number, bytes: number}>} totals.
 */
async function uploadStagedTree (engine, alias, staging, stageDirSftp, signal) {
  let files = 0
  let bytes = 0
  const walk = async (from, to) => {
    signal?.throwIfAborted?.()
    const entries = readdirSync(from, { withFileTypes: true })
    for (const entry of entries) {
      signal?.throwIfAborted?.()
      const source = join(from, entry.name)
      const target = `${to.replace(/\/+$/u, '')}/${entry.name}`
      if (entry.isDirectory()) {
        await engine.withSftp(alias, (sftp) => sftpMkdirp(sftp, target, target))
        await walk(source, target)
      } else if (entry.isFile()) {
        const size = statSync(source).size
        await engine.withSftp(alias, async (sftp) => {
          const handle = await sftpOpenHandle(sftp, target, 'w', target)
          try {
            let at = 0
            for (;;) {
              signal?.throwIfAborted?.()
              const chunk = await readFileChunk(source, at, CHUNK_BYTES)
              if (chunk.length === 0) break
              await sftpWriteHandle(sftp, handle, chunk, target)
              at += chunk.length
            }
          } finally {
            await sftpCloseHandle(sftp, handle)
          }
        })
        files += 1
        bytes += size
      }
    }
  }
  await walk(staging, stageDirSftp)
  return { files, bytes }
}

/** One file chunk, resolving to an empty buffer past EOF. */
async function readFileChunk (file, position, length) {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, position)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}
