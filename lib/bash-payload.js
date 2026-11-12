/**
 * The pinned Windows bash payload and its provisioner: download (or take a
 * locally supplied copy), digest-check, unpack ON THE DSH HOST, upload the
 * whole tree over SFTP, verify the remote bash by executing it, and record
 * the deployment.
 *
 * The pin names the public `niubash` v1.5.0 release — the same artifact the
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
 * Layout on the remote host:
 * `<HOME>\.dsh-ssh-workspace\bash\<version>\` — the extracted tree plus the
 * receipt file ({@link BASH_RECEIPT_FILE}) inside it, published by an SFTP
 * rename of a fully-uploaded `.stage-…` sibling (an interrupted upload never
 * becomes the installed version). The receipt mirrors dsh-ops's
 * `.provisioned.json` discipline: it names the pin that produced the bytes,
 * and a tree whose receipt matches the pin is reused instead of re-uploaded.
 *
 * Deployment is EXPLICIT: the only entry point is
 * {@link provisionWinBash}, called from the `ssh_workspace_bash` tool.
 * Nothing here runs automatically.
 *
 * @module @shiqyka/dsh-ssh-workspace/bash-payload
 */

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, mkdirSync, mkdtempSync, open, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
 * The pinned payload: url, asset name, exact bytes, digest, unpack shape and
 * the executable the tree must carry. Editing any field is a supply-chain
 * decision — the sha256 must be re-verified against freshly downloaded
 * bytes, never assumed.
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

/** The marker file a provisioned version directory carries (inside the tree root). */
export const BASH_RECEIPT_FILE = '.provisioned.json'

/** The remote store root, relative to the host user's profile directory. */
export const BASH_STORE_RELATIVE = '.dsh-ssh-workspace\\bash'

/** Guard for the in-memory gunzip step (the tar is ~65 MB for the pinned payload). */
const MAX_TAR_BYTES = 256 * 1024 * 1024

/** SFTP write chunk, matching the transfer half's own transfer size. */
const CHUNK_BYTES = 256 * 1024

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
    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/su, '').replace(/\/+$/u, '')
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
 * The receipt text for one provisioned tree: which pin produced these bytes.
 *
 * @param {string} alias - the host the payload is being deployed to.
 * @returns {string} the JSON document with a trailing newline.
 */
export function bashReceiptText (alias) {
  const pin = BASH_PAYLOAD_PIN
  return `${JSON.stringify({
    schemaVersion: 1,
    name: pin.name,
    version: pin.version,
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
 * The Windows spelling of the payload executable inside a version directory.
 *
 * @param {string} versionDir - `<HOME>\.dsh-ssh-workspace\bash\<version>`.
 * @returns {string} `<versionDir>\winuxcmd\usr\bin\bash.exe`.
 */
export function bashExePathOf (versionDir) {
  return `${versionDir.replace(/[\\/]+$/u, '')}\\${BASH_PAYLOAD_PIN.executableRelativePath.replaceAll('/', '\\')}`
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
 * Provision the pinned bash payload onto one Windows-type host.
 *
 * Flow: verify the host is dispatchable (a cmd login shell — a
 * PowerShell-default host is refused with the same wording the dialect
 * docs use), resolve the payload bytes (a locally supplied `payloadPath`
 * that digest-matches the pin, else a scripted download of the pinned
 * URL), unpack locally, publish the tree to
 * `<HOME>\.dsh-ssh-workspace\bash\<version>` via a staged SFTP upload plus
 * rename, write the receipt (it rides inside the uploaded tree), execute
 * the remote bash for real, record the deployment on the host entry, and
 * clear the engine's dialect caches so the next command dispatches POSIX
 * immediately.
 *
 * Every failure keeps the previous state: an existing verified version is
 * reused (or, with `force`, renamed aside first and only removed after the
 * new tree published), and an interrupted run leaves at most a `.stage-…`
 * sibling the next run sweeps.
 *
 * @param {object} engine - the live engine.
 * @param {string} alias - host alias.
 * @param {object} [options] - provision options.
 * @param {string} [options.payloadPath] - local archive on the DSH host
 *   holding the pinned bytes (offline / mirror delivery); digest-checked
 *   against the pin like a download.
 * @param {boolean} [options.force] - replace an existing provisioned tree
 *   even when its receipt matches.
 * @param {AbortSignal} [options.signal] - cancels download / upload / verify.
 * @returns {Promise<{reused: boolean, path: string, root: string, version: string, files: number, bytes: number, verify: string}>}
 *   the deployment record.
 * @throws {Error} when the host is not a cmd-login Windows type, the store
 *   has no editable entry for the alias, the payload cannot be obtained or
 *   verified, the upload fails, or the remote bash does not prove itself.
 */
export async function provisionWinBash (engine, alias, options = {}) {
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
  // assumed.
  const homeOutcome = await engine.execRaw(alias, 'echo %USERPROFILE%', { timeoutMs: 15_000, signal: options.signal })
  const home = homeOutcome.stdout.trim()
  if (homeOutcome.success !== true || !/^[A-Za-z]:[\\/]/u.test(home)) {
    throw new Error(`could not resolve %USERPROFILE% on ${JSON.stringify(alias)}: ${homeOutcome.error ?? homeOutcome.stdout.trim() ?? 'empty answer'}`)
  }
  const versionDir = `${home.replace(/[\\/]+$/u, '')}\\${BASH_STORE_RELATIVE}\\${BASH_PAYLOAD_PIN.version}`
  const versionDirSftp = sftpSpellingOf(versionDir)
  const exePath = bashExePathOf(versionDir)
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
    && existing.name === BASH_PAYLOAD_PIN.name
    && existing.version === BASH_PAYLOAD_PIN.version
    && existing.sha256 === BASH_PAYLOAD_PIN.sha256
  if (receiptMatches && options.force !== true) {
    const verify = await verifyWith()
    if (verify !== undefined) {
      return { reused: true, path: exePath, root: versionDir, version: BASH_PAYLOAD_PIN.version, files: 0, bytes: 0, verify }
    }
    engine.logger?.warn?.(`ssh-workspace: provisioned bash on ${alias} stopped verifying; re-deploying`)
  }
  if (receiptMatches === false && existing !== undefined && options.force !== true) {
    throw new Error(`${JSON.stringify(alias)} already has a provisioned bash tree that this pin does not name (${versionDir}); pass force to replace it`)
  }
  // ---- payload bytes ------------------------------------------------------
  const staging = mkdtempSync(join(tmpdir(), 'dsh-ssh-ws-bash-'))
  let files = 0
  let totalBytes = 0
  let previous
  try {
    const archive = join(staging, BASH_PAYLOAD_PIN.assetFile)
    if (typeof options.payloadPath === 'string' && options.payloadPath.trim() !== '') {
      const info = await stat(options.payloadPath.trim())
      if (!info.isFile()) throw new Error(`payloadPath is not a regular file: ${options.payloadPath}`)
      await pipeline(createReadStream(options.payloadPath.trim(), { highWaterMark: CHUNK_BYTES }), createWriteStream(archive))
    } else {
      const response = await fetch(BASH_PAYLOAD_PIN.url, { signal: options.signal, redirect: 'follow' })
      if (!response.ok || response.body === null) {
        throw new Error(`downloading ${BASH_PAYLOAD_PIN.url} failed with HTTP ${response.status}; pass payloadPath with a locally fetched copy of ${BASH_PAYLOAD_PIN.assetFile} to provision from a mirror`)
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))
    }
    const size = statSync(archive).size
    if (size !== BASH_PAYLOAD_PIN.bytes) {
      throw new Error(`bash payload archive is ${size} bytes, not the pinned ${BASH_PAYLOAD_PIN.bytes}`)
    }
    const actualSha = await sha256File(archive)
    if (actualSha !== BASH_PAYLOAD_PIN.sha256) {
      throw new Error(`bash payload archive hashed to ${actualSha}, not the pinned ${BASH_PAYLOAD_PIN.sha256}; refusing unpinned bytes`)
    }
    const extracted = await readBashTarGz(archive)
    files = stageBashTree(extracted.files, staging)
    totalBytes = extracted.totalBytes
    writeFileSync(join(staging, BASH_RECEIPT_FILE), bashReceiptText(alias), { mode: 0o644 })
    // ---- publish ----------------------------------------------------------
    // The version directory is only ever replaced by the rename of a fully
    // uploaded `.stage-…` sibling, so an interrupted upload never publishes a
    // partial tree; the tree being replaced (force) moves aside first and is
    // removed only after the new one published.
    const storeRootSftp = sftpSpellingOf(`${home.replace(/[\\/]+$/u, '')}\\${BASH_STORE_RELATIVE}`)
    const stageDirSftp = `${storeRootSftp}/.stage-${process.pid}-${Date.now().toString(36)}`
    let published = false
    try {
      await engine.withSftp(alias, async (sftp) => {
        await sftpMkdirp(sftp, stageDirSftp, stageDirSftp)
      })
      const uploaded = await uploadStagedTree(engine, alias, staging, stageDirSftp, options.signal)
      files = uploaded.files
      totalBytes = uploaded.bytes
      await engine.withSftp(alias, async (sftp) => {
        const targetInfo = await sftpStatOrNull(sftp, versionDirSftp)
        if (targetInfo !== null) {
          previous = `${versionDirSftp}.previous-${process.pid}-${Date.now().toString(36)}`
          await sftpRename(sftp, versionDirSftp, previous)
        }
        await sftpRename(sftp, stageDirSftp, versionDirSftp)
      })
      published = true
    } finally {
      // A stage sibling left behind by a failure is swept here and, failing
      // that, by the next run's mkdirp+rename cycle — best-effort on purpose:
      // a refused cleanup must not mask the error that aborted the publish.
      if (!published) {
        try {
          await engine.withSftp(alias, (sftp) => sftpRmTree(sftp, stageDirSftp))
        } catch (error) {
          engine.logger?.warn?.(`ssh-workspace: could not sweep the stage directory ${stageDirSftp}: ${error instanceof Error ? error.message : String(error)}`)
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
  // every other field (and every other host) untouched.
  const recordedAt = Date.now()
  engine.store.entryStore.mutateHosts(entries => entries.map(candidate => (
    candidate.alias === alias
      ? { ...candidate, bashProvisioned: { path: exePath, root: versionDir, version: BASH_PAYLOAD_PIN.version, sha256: BASH_PAYLOAD_PIN.sha256, provisionedAt: recordedAt } }
      : candidate
  )))
  engine.forgetDialectCaches(alias)
  // The displaced previous tree is removed after the new one published and
  // verified; its removal must not fail the deployment.
  if (previous !== undefined) {
    try {
      await engine.withSftp(alias, (sftp) => sftpRmTree(sftp, previous))
    } catch (error) {
      engine.logger?.warn?.(`ssh-workspace: could not remove the previous bash tree ${previous}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { reused: false, path: exePath, root: versionDir, version: BASH_PAYLOAD_PIN.version, files, bytes: totalBytes, verify }
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
