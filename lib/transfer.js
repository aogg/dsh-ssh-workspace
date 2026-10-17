/**
 * Move file bytes between this machine and a remote host without putting them
 * through the model.
 *
 * The plugin already has two ways to touch remote files: the `ssh://` file
 * tools run one file at a time through the filesystem seam, and
 * `ssh_workspace_exec` runs a shell. Neither moves a file's bytes efficiently —
 * a file tool forces the content through the conversation, and a shell needs a
 * quoting-safe base64 pipeline the model has to get right. A development
 * workflow constantly hits the gap: push a build artifact up, pull a log or a
 * generated asset down.
 *
 * Both directions stream in chunks, so a large file costs bounded memory. An
 * upload stages into a sibling temp name and renames on completion, so a reader
 * never observes a half-written file — the same publication discipline the
 * filesystem half uses for `write`.
 *
 * @module @shiqyka/dsh-ssh-workspace/transfer
 */

import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

import {
  sftpCloseHandle,
  sftpMkdirp,
  sftpOpenHandle,
  sftpPublishRename,
  sftpReadHandle,
  sftpStatOrNull,
  sftpWriteHandle,
} from './remote-fs.js'

/** SFTP read chunk, matching the filesystem half's own transfer size. */
const CHUNK_BYTES = 256 * 1024

/** Refuse a single transfer larger than this. */
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024

/**
 * Copy one file up (local → remote) or down (remote → local).
 *
 * @param {import('./engine.js').SshWorkspaceEngine} engine - live engine.
 * @param {object} options - transfer request.
 * @param {string} options.alias - host alias.
 * @param {'upload'|'download'} options.direction - which way the bytes move.
 * @param {string} options.localPath - absolute local path (source for upload, destination for download).
 * @param {string} options.remotePath - absolute remote path (destination for upload, source for download).
 * @param {AbortSignal} [options.signal] - cancels mid-transfer.
 * @param {Function} [options.onProgress] - called with `{bytes, totalBytes}` as chunks land.
 * @returns {Promise<{bytes: number}>} how many bytes were copied.
 */
export async function transferFile (engine, options) {
  const { alias, direction, localPath, remotePath, signal, onProgress } = options
  signal?.throwIfAborted?.()
  if (direction === 'upload') return await uploadFile(engine, { alias, localPath, remotePath, signal, onProgress })
  return await downloadFile(engine, { alias, localPath, remotePath, signal, onProgress })
}

/**
 * Local → remote, staged then renamed.
 *
 * @param {import('./engine.js').SshWorkspaceEngine} engine - live engine.
 * @param {object} request - upload request.
 * @returns {Promise<{bytes: number}>} bytes copied.
 */
async function uploadFile (engine, request) {
  const { alias, localPath, remotePath, signal, onProgress } = request
  const info = await stat(localPath)
  if (!info.isFile()) throw new Error(`not a regular file: ${localPath}`)
  const total = info.size
  if (total > DEFAULT_MAX_BYTES) throw new Error(`refusing to upload ${total} bytes (limit ${DEFAULT_MAX_BYTES})`)
  await engine.withSftp(alias, async (sftp) => {
    await sftpMkdirp(sftp, remoteParentOf(remotePath), remotePath)
    const staging = `${remotePath.replace(/\/+$/u, '')}.dsh-up-${process.pid}-${Date.now().toString(36)}`
    let handle
    try {
      handle = await sftpOpenHandle(sftp, staging, 'w', remotePath)
      let written = 0
      for await (const chunk of createReadStream(localPath, { highWaterMark: CHUNK_BYTES })) {
        signal?.throwIfAborted?.()
        await sftpWriteHandle(sftp, handle, chunk, remotePath)
        written += chunk.length
        onProgress?.({ bytes: written, totalBytes: total })
      }
      await sftpCloseHandle(sftp, handle)
      handle = undefined
      // Publish last: until the rename the destination keeps its old content.
      await sftpPublishRename(sftp, staging, remotePath, remotePath)
    } catch (error) {
      if (handle !== undefined) { try { await sftpCloseHandle(sftp, handle) } catch { /* already gone */ } }
      try { await sftpUnlink(sftp, staging) } catch { /* staging never created */ }
      throw error
    }
  })
  return { bytes: total }
}

/**
 * Remote → local, staged then renamed.
 *
 * Reads to EOF rather than trusting the stat-time size, so a file that grows
 * while it is being pulled is copied in full instead of truncated.
 *
 * @param {import('./engine.js').SshWorkspaceEngine} engine - live engine.
 * @param {object} request - download request.
 * @returns {Promise<{bytes: number}>} bytes copied.
 */
async function downloadFile (engine, request) {
  const { alias, localPath, remotePath, signal, onProgress } = request
  let copied = 0
  await engine.withSftp(alias, async (sftp) => {
    const info = await sftpStatOrNull(sftp, remotePath)
    if (info === null) throw new Error(`remote file does not exist: ${remotePath}`)
    const total = typeof info.size === 'number' ? info.size : 0
    if (total > DEFAULT_MAX_BYTES) throw new Error(`refusing to download ${total} bytes (limit ${DEFAULT_MAX_BYTES})`)
    await mkdir(path.dirname(localPath), { recursive: true })
    const staging = `${localPath}.dsh-down-${process.pid}-${Date.now().toString(36)}`
    const out = createWriteStream(staging)
    // Drain before the first write so a fast reader never buffers unbounded.
    out.on('error', () => { /* surfaced through the awaited finish/close below */ })
    let handle
    try {
      handle = await sftpOpenHandle(sftp, remotePath, 'r', remotePath)
      for (;;) {
        signal?.throwIfAborted?.()
        const chunk = await sftpReadHandle(sftp, handle, copied, CHUNK_BYTES, remotePath)
        if (chunk.length === 0) break
        copied += chunk.length
        if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve))
        onProgress?.({ bytes: copied, totalBytes: total })
      }
      await sftpCloseHandle(sftp, handle)
      handle = undefined
      await new Promise((resolve, reject) => {
        out.once('error', reject)
        out.end(() => { resolve() })
      })
    } catch (error) {
      if (handle !== undefined) { try { await sftpCloseHandle(sftp, handle) } catch { /* already gone */ } }
      out.destroy()
      try { await unlink(staging) } catch { /* staging never created */ }
      throw error
    }
    await rename(staging, localPath)
  })
  return { bytes: copied }
}

/**
 * Copy a local directory tree up, preserving its shape.
 *
 * @param {import('./engine.js').SshWorkspaceEngine} engine - live engine.
 * @param {object} options - upload request.
 * @param {string} options.alias - host alias.
 * @param {string} options.localPath - local directory root.
 * @param {string} options.remotePath - remote directory root.
 * @param {AbortSignal} [options.signal] - cancels mid-walk.
 * @param {Function} [options.onProgress] - called per file with `{files, bytes, path}`.
 * @returns {Promise<{files: number, bytes: number}>} totals.
 */
export async function uploadTree (engine, options) {
  const { alias, localPath, remotePath, signal, onProgress } = options
  let files = 0
  let bytes = 0
  const walk = async (from, to) => {
    signal?.throwIfAborted?.()
    await engine.withSftp(alias, async (sftp) => { await sftpMkdirp(sftp, to, to) })
    const entries = await readdir(from, { withFileTypes: true })
    // Stable order keeps a repeated upload from reshuffling its own progress.
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      signal?.throwIfAborted?.()
      const source = path.join(from, entry.name)
      const target = `${to.replace(/\/+$/u, '')}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(source, target)
      } else if (entry.isFile()) {
        const result = await uploadFile(engine, { alias, localPath: source, remotePath: target, signal })
        files += 1
        bytes += result.bytes
        onProgress?.({ files, bytes, path: entry.name })
      }
    }
  }
  await walk(localPath, remotePath)
  return { files, bytes }
}

/** The remote parent of a remote path, without a trailing slash. */
function remoteParentOf (remotePath) {
  const normalized = remotePath.replace(/\/+$/u, '')
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return '/'
  return normalized.slice(0, index)
}

/** Unlink a remote path, ignoring a missing file. */
async function sftpUnlink (sftp, target) {
  await new Promise((resolve) => {
    sftp.unlink(target, () => { resolve() })
  })
}
