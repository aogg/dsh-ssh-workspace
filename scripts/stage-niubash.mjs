/**
 * Stage the official niubash win-x64 portable package into `runtime/niubash/`
 * (npm `prepack` lifecycle): fetch the LATEST GitHub release's portable
 * archive, digest-check it, discover its tree shape, and write the
 * `manifest.json` the runtime pin ({@link ../lib/bash-payload.js}
 * `resolvePayloadPin`) prefers over the bundled constant.
 *
 * Why prepack: the published package should be SELF-CONTAINED — it carries
 * the archive AND the pin describing it, so provisioning a Windows host
 * needs no network (the staged archive digest-verifies against the staged
 * manifest before any byte is uploaded). A bare developer checkout has no
 * `runtime/` at all and falls back to the bundled v1.5.0 pin + online
 * download, which is exactly the historical behavior.
 *
 * Guarantees this script keeps:
 * - OFFLINE SAFE: `--dry-run` (also auto-set by `npm pack --dry-run` via
 *   `npm_config_dry_run`) NEVER touches the network. It only validates what
 *   is already staged; when nothing is staged it prints a notice and exits 0
 *   so `npm run check` (which runs `npm pack --dry-run`) passes offline.
 * - IDEMPOTENT: a staged archive whose sha256 still matches its manifest
 *   short-circuits — re-running prepack never re-downloads 33 MB.
 * - LOCAL ARCHIVE: `NIUBASH_ARCHIVE=<path>` points at a local copy of the
 *   release asset (mirror / pre-fetched download) and skips the download.
 * - FAIL LOUD: when a real pack needs the archive and neither a local
 *   pointer nor the network can supply one, the script exits non-zero with
 *   the reason — a pack must never silently ship without a payload.
 * - SINGLE ROOT: an archive whose members share no single top-level
 *   directory (root-level files, or several distinct top-level roots) is
 *   rejected outright — staging it would write a `prefix: ""` manifest the
 *   runtime never trusts, dead weight the package ships forever.
 *
 * The tar walk here is DESCRIPTIVE (it discovers `prefix` and the bash
 * executable's relative path and digest so the manifest can freeze them).
 * The authoritative parse stays in `lib/bash-payload.js`
 * (`readBashTarGz`): at provision time the runtime re-parses the archive
 * with the member-safety guard and re-verifies the executable digest
 * against this very manifest, so a packer that misdescribes an archive is
 * caught before any byte reaches a host. The script cannot import that
 * module directly — it resolves the DSH peer packages at load time, which a
 * bare CI checkout does not have — hence the local header walk, written to
 * mirror the runtime walk field for field.
 *
 * Manifest schema (one JSON object, written pretty-printed with a trailing
 * newline):
 *   schemaVersion          1
 *   name / platform / arch payload identity ("bash" / "win" / "x64")
 *   upstream / upstreamUrl project name and GitHub URL
 *   releaseTag             the GitHub release tag ("v1.9.0")
 *   version                the version parsed out of the asset file name
 *   assetFile              the asset's file name (staged under runtime/niubash/)
 *   url                    the asset's browser_download_url
 *   sha256                 the archive's lowercase hex sha256
 *   bytes                  the archive's exact size
 *   extractor              always "tar.gz"
 *   prefix                 the archive's single root directory, trailing "/"
 *   executableRelativePath the bash executable inside the archive (forward slashes)
 *   executableSha256       that executable's lowercase hex sha256
 *   stagedAt               ISO 8601 instant of the staging run
 *
 * Run: node scripts/stage-niubash.mjs [--dry-run]
 * Env: NIUBASH_ARCHIVE=<path>   use a local release archive, skip download
 */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { gunzipSync } from 'node:zlib'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeDir = path.join(root, 'runtime', 'niubash')
const manifestPath = path.join(runtimeDir, 'manifest.json')

/** GitHub API endpoint answering the latest published release. */
const RELEASES_API = 'https://api.github.com/repos/unixwin/niubash/releases/latest'

/** The release asset this plugin provisions: the win-x64 portable tarball. */
const ASSET_PATTERN = /^niubash-v[0-9][0-9A-Za-z.]*-win-x64\.tar\.gz$/u

/** Guard for the in-memory gunzip step (mirror of the runtime parser's cap). */
const MAX_TAR_BYTES = 256 * 1024 * 1024

// ////////////////  校验参数  start  ////////////////////////////////////////////////
const dryRun = process.argv.includes('--dry-run')
  || process.env.npm_config_dry_run === 'true'
  || process.env.npm_config_dry_run === '1'
const localArchive = typeof process.env.NIUBASH_ARCHIVE === 'string' && process.env.NIUBASH_ARCHIVE.trim() !== ''
  ? path.resolve(process.env.NIUBASH_ARCHIVE.trim())
  : undefined
// ////////////////  校验参数  end ////////////////////////////////////////////////

// ////////////////  幂等：已暂存且一致则跳过  start  ////////////////////////////////////////////////
/**
 * The staged archive path named by an existing manifest, or undefined.
 *
 * @param {object} manifest - the staged manifest.
 * @returns {string | undefined} the archive path when it exists on disk.
 */
function stagedArchiveOf (manifest) {
  if (manifest === undefined || typeof manifest.assetFile !== 'string') return undefined
  const candidate = path.join(runtimeDir, manifest.assetFile)
  return existsSync(candidate) ? candidate : undefined
}

if (existsSync(manifestPath)) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    console.warn(`stage-niubash: existing manifest is unreadable (${error instanceof Error ? error.message : String(error)}); restaging`)
  }
  const staged = stagedArchiveOf(manifest)
  if (staged !== undefined) {
    // Size first, digest second — the same cheap-then-exact order the
    // runtime's staged-archive check uses.
    let consistent = statSync(staged).size === manifest.bytes
    if (consistent) consistent = (await sha256Of(staged)) === manifest.sha256
    if (consistent) {
      console.log(`stage-niubash: already staged — ${manifest.assetFile} (niubash ${manifest.version}, ${manifest.bytes} bytes, staged at ${manifest.stagedAt}); nothing to do`)
      process.exit(0)
    }
    console.warn('stage-niubash: staged archive does not match its manifest; restaging')
  }
}
// ////////////////  幂等：已暂存且一致则跳过  end ////////////////////////////////////////////////

// ////////////////  dry-run：绝不联网，只校验  start  ////////////////////////////////////////////////
if (dryRun) {
  if (existsSync(manifestPath)) {
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (error) {
      console.error(`stage-niubash: dry-run found an UNREADABLE manifest (${error instanceof Error ? error.message : String(error)}); the package would fall back to the bundled pin`)
      process.exit(0)
    }
    const staged = stagedArchiveOf(manifest)
    if (staged === undefined) {
      console.warn(`stage-niubash: dry-run — manifest names ${manifest.assetFile} but the archive is not staged; the package would fall back to the bundled pin`)
      process.exit(0)
    }
    const sizeOk = statSync(staged).size === manifest.bytes
    const digestOk = sizeOk && (await sha256Of(staged)) === manifest.sha256
    if (!digestOk) {
      console.warn(`stage-niubash: dry-run — staged archive failed its manifest check (size ${sizeOk ? 'ok' : 'MISMATCH'}, digest ${digestOk ? 'ok' : 'MISMATCH'}); the package would fall back to the bundled pin`)
      process.exit(0)
    }
    console.log(`stage-niubash: dry-run — staged payload is consistent (${manifest.assetFile}, niubash ${manifest.version}); the package ships it self-contained`)
    process.exit(0)
  }
  console.warn('stage-niubash: dry-run — nothing staged in runtime/niubash/ (run `npm run stage:niubash` once online); the package falls back to the bundled v1.5.0 pin + online download')
  process.exit(0)
}
// ////////////////  dry-run：绝不联网，只校验  end ////////////////////////////////////////////////

// ////////////////  准备数据：取得归档（本地指针 → GitHub 最新 release）  start  ////////////////////////////////////////////////
mkdirSync(runtimeDir, { recursive: true })

/**
 * The release asset to stage, from a local pointer or the latest release.
 *
 * @returns {Promise<{source: 'local'|'download', file: string, releaseTag: string, url: string}>}
 *   the resolved asset: `file` is the LOCAL file already holding the bytes.
 * @throws {Error} when neither path can produce an archive.
 */
async function resolveAsset () {
  if (localArchive !== undefined) {
    const info = await stat(localArchive).catch(() => undefined)
    if (info === undefined || !info.isFile()) {
      throw new Error(`NIUBASH_ARCHIVE does not name a readable file: ${localArchive}`)
    }
    const name = path.basename(localArchive)
    if (!ASSET_PATTERN.test(name)) {
      throw new Error(`NIUBASH_ARCHIVE file name ${JSON.stringify(name)} does not look like a niubash win-x64 portable package (${ASSET_PATTERN.source})`)
    }
    return { source: 'local', file: localArchive, releaseTag: `v${versionFromAssetName(name)}`, url: `https://github.com/unixwin/niubash/releases/download/v${versionFromAssetName(name)}/${name}` }
  }
  let release
  try {
    const response = await fetch(RELEASES_API, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-ssh-workspace-stage-niubash' },
      redirect: 'follow',
    })
    if (!response.ok) {
      throw new Error(`GitHub API answered HTTP ${response.status}`)
    }
    release = await response.json()
  } catch (error) {
    throw new Error(`could not read the latest niubash release from ${RELEASES_API} (${error instanceof Error ? error.message : String(error)}). ` +
      `Re-run once online, or set NIUBASH_ARCHIVE to a local copy of the release asset to stage offline`)
  }
  const asset = (Array.isArray(release?.assets) ? release.assets : [])
    .find(candidate => ASSET_PATTERN.test(String(candidate?.name ?? '')))
  if (asset === undefined) {
    throw new Error(`the latest niubash release ${JSON.stringify(release?.tag_name ?? '')} carries no ${ASSET_PATTERN.source} asset; stage a local archive with NIUBASH_ARCHIVE instead`)
  }
  const target = path.join(runtimeDir, asset.name)
  const response = await fetch(asset.browser_download_url, { redirect: 'follow' })
  if (!response.ok || response.body === null) {
    throw new Error(`downloading ${asset.browser_download_url} failed with HTTP ${response.status}; set NIUBASH_ARCHIVE to a locally fetched copy to provision from a mirror`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target))
  return { source: 'download', file: target, releaseTag: String(release.tag_name ?? `v${versionFromAssetName(asset.name)}`), url: asset.browser_download_url }
}

const asset = await resolveAsset()
// ////////////////  准备数据：取得归档  end ////////////////////////////////////////////////

// ////////////////  核心逻辑：摘要 + 形状发现 + 完整校验  start  ////////////////////////////////////////////////
const bytes = statSync(asset.file).size
if (bytes <= 0) throw new Error(`the resolved archive is empty: ${asset.file}`)
const sha256 = await sha256Of(asset.file)
const shape = inspectArchive(asset.file)
if (shape.executable === undefined) {
  throw new Error('the archive carries no bash.exe member — it is not a niubash win-x64 portable package')
}
const version = versionFromAssetName(path.basename(asset.file))

// The full verified parse, byte-for-byte what the runtime will enforce.
verifyArchiveLikeRuntime(asset.file, shape)

/** The manifest the runtime pin is built from. */
const manifest = {
  schemaVersion: 1,
  name: 'bash',
  platform: 'win',
  arch: 'x64',
  upstream: 'niubash',
  upstreamUrl: 'https://github.com/unixwin/niubash',
  releaseTag: asset.releaseTag,
  version,
  assetFile: path.basename(asset.file),
  url: asset.url,
  sha256,
  bytes,
  extractor: 'tar.gz',
  prefix: shape.prefix,
  executableRelativePath: shape.executable,
  executableSha256: shape.executableSha256,
  stagedAt: new Date().toISOString(),
}
// ////////////////  核心逻辑  end ////////////////////////////////////////////////

// ////////////////  返回整理：落盘 manifest + 清扫旧产物  start  ////////////////////////////////////////////////
if (asset.source === 'local') {
  const target = path.join(runtimeDir, manifest.assetFile)
  if (target !== asset.file) copyFileSync(asset.file, target)
}
// Sweep archives an earlier staging run left behind: the package must carry
// exactly one payload, the one the manifest names.
for (const entry of readdirSync(runtimeDir)) {
  if (entry === manifest.assetFile || entry === 'manifest.json') continue
  if (/\.tar\.gz$/u.test(entry)) {
    rmSync(path.join(runtimeDir, entry), { force: true })
    console.log(`stage-niubash: removed stale staged archive ${entry}`)
  }
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 })
console.log(`stage-niubash: staged ${manifest.assetFile} (niubash ${manifest.version} from ${manifest.releaseTag}, ${manifest.bytes} bytes, sha256 ${manifest.sha256.slice(0, 12)}…, source: ${asset.source})`)
console.log(`stage-niubash: manifest written to ${path.relative(root, manifestPath)} — the packaged plugin provisions offline from this payload`)
// ////////////////  返回整理  end ////////////////////////////////////////////////

/**
 * Hash one file with sha256.
 *
 * @param {string} file - the file to hash.
 * @returns {Promise<string>} the lowercase hex digest.
 */
async function sha256Of (file) {
  const hash = createHash('sha256')
  hash.update(await readFile(file))
  return hash.digest('hex')
}

/**
 * The version inside an asset file name (`niubash-v1.9.0-win-x64.tar.gz` →
 * `1.9.0`).
 *
 * @param {string} name - the asset file name.
 * @returns {string} the version substring.
 * @throws {Error} when the name does not match the expected shape.
 */
function versionFromAssetName (name) {
  const match = /^niubash-v([0-9][0-9A-Za-z.]*)-win-x64\.tar\.gz$/u.exec(name)
  if (match === null) throw new Error(`cannot read a niubash version out of ${JSON.stringify(name)}`)
  return match[1]
}

/**
 * The Windows-flavored tar-slip guard, mirrored from the runtime parser's
 * `safeBashMember` (a local twin — see the module doc for why this script
 * cannot import it). Names failing this check make the whole staging fail,
 * because the runtime parser would reject them at provision time anyway.
 *
 * @param {string} name - a member name relative to the archive root.
 * @returns {void} throws when the name must not be trusted.
 * @throws {Error} on an unsafe member name.
 */
function assertSafeMember (name) {
  if (name === '' || /[\\:\x00-\x1f]/u.test(name) || name.startsWith('/') || name.endsWith('/')
    || name.split('/').some(part => part === '' || part === '.' || part === '..' || /[. ]$/u.test(part)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.[^.]*)?$/iu.test(part))) {
    throw new Error(`unsafe bash payload archive member: ${JSON.stringify(name)}`)
  }
}

/**
 * Discover the archive's shape: its single root prefix and the bash
 * executable's relative path + digest.
 *
 * @param {string} file - the archive path.
 * @returns {{prefix: string, executable: string | undefined, executableSha256: string | undefined}}
 *   the shape facts (executable digest present only when a bash member was found).
 * @throws {Error} on malformed, truncated or unsafe archives.
 * @throws {Error} when the members share no single top-level root directory
 *   (root-level files, or several distinct top-level roots) — such a layout
 *   is not a niubash portable package and would stage a manifest the runtime
 *   can never trust, so it fails loudly here instead.
 */
function inspectArchive (file) {
  const tar = gunzipSync(readFileSync(file), { maxOutputLength: MAX_TAR_BYTES })
  const files = new Map() // full member name → Buffer (regular files only)
  const links = new Map() // full member name → link target
  const dirs = new Set() // full directory paths, trailing slash kept
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    // Directory members keep their trailing slash (`root/`); file members are
    // stored without one — the common-prefix walk below uses the DIRECTORY
    // path either way, and a root-directory member (`root/`, no interior
    // slash after its own name) must still contribute `root/`, not `''`.
    const headerName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/su, '')
    const name = headerName.replace(/\/+$/u, '')
    const size = tarOctal(header, 124, 136)
    const type = header.subarray(156, 157).toString('utf8').replace(/\0.*$/su, '') || '0'
    const link = header.subarray(157, 257).toString('utf8').replace(/\0.*$/su, '')
    if (offset + 512 + size > tar.length) throw new Error(`bash payload tar member truncated: ${JSON.stringify(name)}`)
    const data = tar.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
    const dirPath = headerName.includes('/')
      ? headerName.slice(0, headerName.lastIndexOf('/') + 1)
      : ''
    if (type === '5') {
      // Directories still contribute to the common-prefix discovery.
      dirs.add(dirPath === '' ? `${name}/` : dirPath)
      continue
    }
    if (type !== '0' && type !== '1') {
      throw new Error(`unsupported bash payload tar member type ${JSON.stringify(type)}: ${JSON.stringify(name)}`)
    }
    dirs.add(dirPath)
    if (type === '0') files.set(name, data)
    else links.set(name, link)
  }
  if (files.size === 0 && links.size === 0 && dirs.size === 0) throw new Error('bash payload archive carries no members')
  // The archive's single root = the longest directory path every member's
  // directory shares. A root-level file (no directory) forces `''`, and so
  // does an archive spreading over several distinct top-level roots — the
  // explicit check below rejects both, because the runtime parser requires
  // every member under one frozen prefix.
  let prefix = undefined
  for (const dir of dirs) {
    prefix = prefix === undefined ? dir : sharedLeadingDir(prefix, dir)
    if (prefix === '') break
  }
  const root = prefix ?? ''
  // A single-root archive is REQUIRED, and `''` is not one: the staged
  // manifest freezes `prefix`, and the runtime's `readPayloadManifest` only
  // accepts a prefix ending in "/" — an empty root would stage a payload
  // whose manifest the runtime never trusts, silently degrading to the
  // bundled pin while the package still carries the dead-weight archive.
  // Fail loudly at pack time instead of writing such a manifest.
  if (root === '') {
    throw new Error('bash payload archive has no single root directory — its members either sit at the archive root or spread over several distinct top-level directories, so the layout does not match a niubash win-x64 portable package (expected exactly one wrapping root directory, e.g. `niubash-v1.9.0/…`)')
  }
  for (const name of [...files.keys(), ...links.keys()]) {
    if (!name.startsWith(root)) throw new Error(`bash payload archive member outside the common root ${JSON.stringify(root)}: ${JSON.stringify(name)}`)
  }
  // The executable: the bash.exe member, preferring the canonical
  // winuxcmd/usr/bin spelling, then the shortest path. Hardlinks resolve to
  // their earlier regular-file target — the same rule the runtime applies.
  const bashNames = [...files.keys(), ...links.keys()]
    .filter(name => name.toLowerCase() === `${root}bash.exe` || name.toLowerCase().endsWith('/bash.exe'))
    .sort((a, b) => (a === `${root}winuxcmd/usr/bin/bash.exe` ? -1 : 0) - (b === `${root}winuxcmd/usr/bin/bash.exe` ? -1 : 0) || a.length - b.length)
  const executableName = bashNames[0]
  if (executableName === undefined) return { prefix: root, executable: undefined, executableSha256: undefined }
  const relative = executableName.slice(root.length)
  assertSafeMember(relative)
  let data = files.get(executableName)
  if (data === undefined) {
    const target = links.get(executableName)
    const targetName = target.startsWith(root) ? target : `${root}${target}`
    data = files.get(targetName)
    if (data === undefined) throw new Error(`bash payload tar hardlink with no earlier target: ${JSON.stringify(executableName)}`)
  }
  return { prefix: root, executable: relative, executableSha256: createHash('sha256').update(data).digest('hex') }
}

/**
 * One tar header numeric field, as octal — mirrored from the runtime parser.
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
 * Re-walk the archive enforcing EXACTLY what the runtime parser will: every
 * member safe, every member under the discovered prefix, the executable
 * digest stable. A staging run that fails here must not write a manifest —
 * the package would carry a payload the runtime refuses on first use.
 *
 * @param {string} file - the archive path.
 * @param {{prefix: string, executable: string}} shape - the discovered shape.
 * @returns {void} throws on any violation.
 * @throws {Error} when the runtime parser would reject this archive.
 */
function verifyArchiveLikeRuntime (file, shape) {
  const tar = gunzipSync(readFileSync(file), { maxOutputLength: MAX_TAR_BYTES })
  let offset = 0
  let sawExecutable = false
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/su, '').replace(/\/+$/u, '')
    const size = tarOctal(header, 124, 136)
    const type = header.subarray(156, 157).toString('utf8').replace(/\0.*$/su, '') || '0'
    if (offset + 512 + size > tar.length) throw new Error(`bash payload tar member truncated: ${JSON.stringify(rawName)}`)
    offset += 512 + Math.ceil(size / 512) * 512
    // Member order mirrors readBashTarGz exactly: the root-directory member
    // first, then the prefix check, then the per-name safety guard.
    if (rawName === shape.prefix.replace(/\/+$/u, '') && type === '5') continue
    if (!rawName.startsWith(shape.prefix)) throw new Error(`bash payload archive member outside the pinned root: ${JSON.stringify(rawName)}`)
    const relative = rawName.slice(shape.prefix.length)
    if (type !== '5') {
      // Files/links are checked with their file name; directories keep the
      // same guard on their relative path.
      assertSafeMember(relative)
      if (relative === shape.executable && type === '0') sawExecutable = true
    } else if (relative !== '') {
      assertSafeMember(relative)
    }
  }
  if (!sawExecutable) throw new Error(`bash payload archive does not carry ${shape.executable} as a regular file`)
}
