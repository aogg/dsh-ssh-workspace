/**
 * Transfer checks: the upload/downpath paths must move bytes without ever
 * leaving a half-written destination observable.
 *
 * These drive `transfer.js` against an in-memory SFTP double, so the properties
 * under test — staged publication, cleanup of staging on failure, and
 * chunk-by-chunk progress — are visible without a live host:
 *
 * - an upload publishes by rename, so the destination only ever holds the old
 *   content or the complete new content;
 * - a failed upload removes its staging file and leaves the destination alone;
 * - a download reports progress per chunk and lands the full byte sequence.
 *
 * Run: node tests/transfer-smoke.mjs
 */

import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

// transfer.js reaches the shared SFTP primitives, which resolve the DSH peer
// packages; without an assembled tree there is nothing to resolve against.
const coreRoot = process.env.DSH_CORE_ROOT
if (!coreRoot) {
  console.log('\n=== transfer smoke ===\n')
  console.log('  SKIP  DSH_CORE_ROOT is not set (needs @deepseek-ai/dsh-fs)')
  console.log('\n=== 0 passed, 0 failed, 1 suite skipped ===')
  process.exit(0)
}
process.env.DSH_PEER_ROOT = [coreRoot, process.env.DSH_PEER_ROOT].filter(Boolean).join(path.delimiter)

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { transferFile, uploadTree } = await import(pathToFileURL(path.join(pluginRoot, 'lib/transfer.js')).href)

let passed = 0
let failures = 0
function check (label, ok, detail) {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`) } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/**
 * An SFTP double over a Map, with the subset `transfer.js` uses.
 *
 * `failAfter` makes the Nth write throw, which is how the mid-transfer failure
 * (and therefore the staging cleanup) is exercised.
 */
function fakeSftp (options = {}) {
  const files = new Map(options.files ?? [])
  const state = { writes: 0, renamed: [], unlinked: [] }
  const failAfter = options.failAfter ?? Number.POSITIVE_INFINITY
  const handles = new Map()
  let nextHandle = 1
  // `mkdir` marks a path as a directory; `stat` reports the marker, so the
  // production code's "is this a directory" check sees the truth.
  const dirs = new Set(options.dirs ?? [])
  const entryAt = (target) => {
    if (files.has(target)) return { kind: 'file', bytes: files.get(target) }
    if (dirs.has(target)) return { kind: 'directory' }
    return undefined
  }
  const sftp = {
    _extensions: {},
    stat (target, callback) {
      const entry = entryAt(target)
      if (entry === undefined) { callback(Object.assign(new Error('no such file'), { code: 2 })); return }
      callback(null, {
        isFile: () => entry.kind === 'file',
        isDirectory: () => entry.kind === 'directory',
        size: entry.kind === 'file' ? entry.bytes.length : 0,
        mode: entry.kind === 'directory' ? 0o755 : 0o644,
        mtime: 0,
      })
    },
    mkdir (target, _attrs, callback) { if (typeof _attrs === 'function') callback = _attrs; dirs.add(target); callback(null) },
    open (target, flags, _attrs, callback) {
      if (typeof _attrs === 'function') callback = _attrs
      const handle = { id: nextHandle++, target, flags }
      handles.set(handle.id, handle)
      // `w` truncates: opening for write is what creates the destination file.
      if (flags === 'w' || flags === 'w+') files.set(target, Buffer.alloc(0))
      callback(null, handle)
    },
    write (handle, buffer, offset, length, position, callback) {
      if (typeof callback !== 'function') return
      state.writes += 1
      if (state.writes > failAfter) { callback(Object.assign(new Error('write refused'), { code: 4 })); return }
      const current = files.get(handle.target) ?? Buffer.alloc(0)
      const slice = buffer.subarray(offset, offset + length)
      const at = position === undefined || position === null ? current.length : position
      const next = Buffer.alloc(Math.max(current.length, at + slice.length))
      current.copy(next, 0)
      slice.copy(next, at)
      files.set(handle.target, next)
      callback(null)
    },
    close (handle, callback) { handles.delete(handle.id); callback(null) },
    read (handle, buffer, offset, length, position, callback) {
      const current = files.get(handle.target) ?? Buffer.alloc(0)
      const at = position ?? 0
      const slice = current.subarray(at, at + length)
      // The production reader hands its own buffer, which an SFTP double
      // receives as a plain Uint8Array; set() works on both shapes.
      if (typeof buffer.set === 'function') buffer.set(slice, offset)
      else slice.copy(buffer, offset)
      callback(null, slice.length, buffer)
    },
    readdir (target, callback) { callback(null, []) },
    rename (from, to, callback) {
      state.renamed.push([from, to])
      const entry = files.get(from) ?? Buffer.alloc(0)
      files.delete(from)
      files.set(to, entry)
      callback(null)
    },
    unlink (target, callback) { state.unlinked.push(target); files.delete(target); callback(null) },
    ext_openssh_rename (from, to, callback) {
      state.renamed.push([from, to])
      const entry = files.get(from) ?? Buffer.alloc(0)
      files.delete(from)
      files.set(to, entry)
      callback(null)
    },
  }
  return { sftp, files, dirs, state }
}

/** An engine whose only job is to hand the double to `withSftp`. */
function fakeEngine (sftp) {
  return {
    async withSftp (_alias, operation) { return await operation(sftp) },
    capabilities: new Map(),
    async probeCapabilities () { return { rg: true, git: true, inotifywait: true } },
  }
}

console.log('\n=== transfer smoke ===\n')

const scratch = await mkdtemp(path.join(tmpdir(), 'dsh-transfer-'))
try {
  // --- upload publishes by rename and never leaves a partial destination ----
  {
    const source = path.join(scratch, 'artifact.bin')
    const payload = Buffer.from('x'.repeat(1024))
    await writeFile(source, payload)
    const { sftp, files, state } = fakeSftp({ dirs: ['/srv', '/srv/app'] })
    // Seed the destination with its previous content: the property under test
    // is that it survives until the rename flips it atomically.
    files.set('/srv/app/artifact.bin', new Uint8Array(Buffer.from('old')))
    const progress = []
    const result = await transferFile(fakeEngine(sftp), {
      alias: 'test',
      direction: 'upload',
      localPath: source,
      remotePath: '/srv/app/artifact.bin',
      onProgress: (event) => progress.push(event),
    })
    check('upload reports the copied byte count', result.bytes === payload.length, String(result.bytes))
    check('upload publishes by rename', state.renamed.length === 1 && state.renamed[0][1] === '/srv/app/artifact.bin',
      JSON.stringify(state.renamed))
    check('upload stages under a sibling temp name, not the destination',
      state.renamed[0][0] !== '/srv/app/artifact.bin' && state.renamed[0][0].startsWith('/srv/app/artifact.bin.dsh-up-'),
      state.renamed[0][0])
    check('upload reports progress as chunks land', progress.length >= 1 && progress.at(-1).bytes === payload.length,
      JSON.stringify(progress.at(-1)))
    check('the destination ends up holding the uploaded bytes',
      files.get('/srv/app/artifact.bin')?.length === payload.length)
  }

  // --- a failed upload cleans up staging and leaves the destination intact ---
  {
    const source = path.join(scratch, 'failing.bin')
    // Larger than one 256 KB chunk, so the transfer genuinely issues several
    // writes and `failAfter: 0` refuses the very first one.
    await writeFile(source, Buffer.alloc(300 * 1024, 0x79))
    const { sftp, files, state } = fakeSftp({ dirs: ['/srv', '/srv/app'], failAfter: 0 })
    files.set('/srv/app/failing.bin', Buffer.from('previous'))
    let failed = false
    try {
      await transferFile(fakeEngine(sftp), {
        alias: 'test',
        direction: 'upload',
        localPath: source,
        remotePath: '/srv/app/failing.bin',
      })
    } catch { failed = true }
    check('a failing upload surfaces the failure', failed)
    check('a failing upload never renames onto the destination', state.renamed.length === 0)
    check('a failing upload removes its staging file',
      state.unlinked.some(target => target.startsWith('/srv/app/failing.bin.dsh-up-')),
      JSON.stringify(state.unlinked))
    check('a failing upload leaves the previous destination content in place',
      Buffer.from(files.get('/srv/app/failing.bin')).toString() === 'previous')
  }

  // --- download lands the full sequence and reports progress ----------------
  {
    const { sftp, files } = fakeSftp({ dirs: ['/srv', '/srv/app', '/srv/tree'] })
    files.set('/srv/app/log.txt', new Uint8Array(Buffer.from('hello-remote')))
    const target = path.join(scratch, 'log.txt')
    const result = await transferFile(fakeEngine(sftp), {
      alias: 'test',
      direction: 'download',
      localPath: target,
      remotePath: '/srv/app/log.txt',
    })
    check('download reports the copied byte count', result.bytes === 'hello-remote'.length, String(result.bytes))
    check('download writes the full content', await readFile(target, 'utf8') === 'hello-remote')
  }

  // --- a missing remote source is an error, not an empty file --------------
  {
    const { sftp } = fakeSftp({ dirs: ['/srv', '/srv/app'] })
    let message
    try {
      await transferFile(fakeEngine(sftp), {
        alias: 'test',
        direction: 'download',
        localPath: path.join(scratch, 'absent.txt'),
        remotePath: '/srv/app/absent.txt',
      })
    } catch (error) { message = error.message }
    check('a missing remote source fails loudly', typeof message === 'string' && message.includes('does not exist'), message)
  }

  // --- a tree upload recreates the shape ----------------------------------
  {
    const tree = path.join(scratch, 'tree')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(path.join(tree, 'nested'), { recursive: true })
    await writeFile(path.join(tree, 'a.txt'), 'a')
    await writeFile(path.join(tree, 'nested', 'b.txt'), 'bb')
    const { sftp, files } = fakeSftp({ dirs: ['/srv', '/srv/app', '/srv/tree'] })
    const result = await uploadTree(fakeEngine(sftp), { alias: 'test', localPath: tree, remotePath: '/srv/tree' })
    check('a tree upload counts its files', result.files === 2, String(result.files))
    check('a tree upload recreates nested paths', files.has('/srv/tree/nested/b.txt'),
      JSON.stringify([...files.keys()]))
  }

  // --- the upload tool answers to the session's sandbox mode ---------------
  //
  // `ssh_workspace_transfer` does not travel through `ctx.fs`, so the router's
  // mode gate never sees it. Without its own check, a `read-only` session could
  // upload a file while `write` was refused — the same hole, one tool over.
  // It must resolve the policy from the calling agent's session itself.
  {
    const { workspaceTools } = await import(pathToFileURL(path.join(pluginRoot, 'lib/tools.js')).href)
    const modeOf = { current: undefined }
    /** A policy service whose mode the test drives. */
    const policyCtx = {
      get (name) {
        if (name === 'sandboxPolicy') return { resolve: () => ({ mode: modeOf.current, workspaceRoot: '/local/root' }) }
        return undefined
      },
    }
    /** An engine whose SFTP double is fresh per call. */
    const uploadEngine = () => {
      const { sftp } = fakeSftp({ dirs: ['/srv', '/srv/app'] })
      return { ...fakeEngine(sftp), assertNotDisabled () {} }
    }
    const toolOf = (context) => workspaceTools(context, uploadEngine(), undefined, undefined, undefined)
      .find(tool => tool.name === 'ssh_workspace_transfer')

    const transfer = toolOf(policyCtx)
    check('the transfer tool is registered', transfer !== undefined)

    const source = path.join(scratch, 'tree', 'a.txt')
    const call = (direction, context = policyCtx) => toolOf(context).execute(
      { alias: 'test', direction, localPath: source, remotePath: '/srv/app/up.txt' },
      { agent: { session: { id: 's1' } } },
    )

    modeOf.current = 'read-only'
    const denied = await call('upload')
    check('a read-only session cannot upload', denied.ok === false, JSON.stringify(denied))
    check('the upload refusal names the mode', /read-only/u.test(denied.error ?? ''), String(denied.error))

    modeOf.current = 'workspace-write'
    const allowed = await call('upload')
    check('workspace-write still uploads', allowed.ok === true, JSON.stringify(allowed))

    // A deployment without a sandbox policy must behave as it always did: no
    // policy service at all is "unconfined", not "read-only".
    modeOf.current = undefined
    const unconfinedResult = await call('upload', { get: () => undefined })
    check('no policy service means unconfined, not read-only', unconfinedResult.ok === true, JSON.stringify(unconfinedResult))

    // A policy that cannot resolve fails CLOSED for a mutation gate: a refused
    // upload is retryable, while writing during "view only" is not detectable.
    const brokenCtx = { get: (name) => name === 'sandboxPolicy' ? { resolve: () => { throw new Error('boom') } } : undefined }
    const brokenResult = await call('upload', brokenCtx)
    check('an unresolvable policy refuses the upload rather than guessing', brokenResult.ok === false, JSON.stringify(brokenResult))

    // An UPLOAD answers to the same workspace SCOPE rule as write / edit. The two
    // are separate implementations — the tool resolves the policy itself while the
    // router gets it as the fifth argument — so a drift between them would let an
    // upload land exactly where a write is refused.
    {
      const scopedEngine = () => {
        const { sftp } = fakeSftp({ dirs: ['/srv', '/srv/app', '/srv/other'] })
        return { ...fakeEngine(sftp), assertNotDisabled () {} }
      }
      const scopedCtx = (root) => ({
        get (name) {
          if (name === 'sandboxPolicy') return { resolve: () => ({ mode: 'workspace-write', workspaceRoot: root }) }
          return undefined
        },
      })
      const scopedTool = (context) => workspaceTools(context, scopedEngine(), undefined, undefined, undefined)
        .find(tool => tool.name === 'ssh_workspace_transfer')

      // Inside the session workspace: allowed.
      modeOf.current = 'workspace-write'
      const inside = await scopedTool(scopedCtx('ssh://test/srv/app')).execute(
        { alias: 'test', direction: 'upload', localPath: source, remotePath: '/srv/app/up.txt' },
        { agent: { session: { id: 's1' } } },
      )
      check('workspace-write uploads inside the session workspace', inside.ok === true, JSON.stringify(inside))

      // A sibling directory on the same host, mounted but outside the workspace.
      const outside = await scopedTool(scopedCtx('ssh://test/srv/app')).execute(
        { alias: 'test', direction: 'upload', localPath: source, remotePath: '/srv/other/up.txt' },
        { agent: { session: { id: 's1' } } },
      )
      check('workspace-write refuses an upload outside the session workspace', outside.ok === false, JSON.stringify(outside))
      check('the scope refusal names the workspace',
        /ssh:\/\/test\/srv\/app/u.test(outside.error ?? ''), String(outside.error))

      // danger-full-access is not scope-checked: that IS the documented way out.
      const fullCtx = {
        get (name) {
          if (name === 'sandboxPolicy') return { resolve: () => ({ mode: 'danger-full-access', workspaceRoot: 'ssh://test/srv/app' }) }
          return undefined
        },
      }
      const full = await scopedTool(fullCtx).execute(
        { alias: 'test', direction: 'upload', localPath: source, remotePath: '/srv/other/up.txt' },
        { agent: { session: { id: 's1' } } },
      )
      check('danger-full-access uploads outside the session workspace', full.ok === true, JSON.stringify(full))
    }

    // A DOWNLOAD is not gated: it reads the remote side and writes locally, so
    // "view only" is exactly the mode where it should keep working.
    const downloadSftp = fakeSftp({ dirs: ['/srv', '/srv/app'], files: [['/srv/app/down.txt', new Uint8Array(Buffer.from('x'))]] })
    const downloadTool = workspaceTools(policyCtx, { ...fakeEngine(downloadSftp.sftp), assertNotDisabled () {} }, undefined, undefined, undefined)
      .find(tool => tool.name === 'ssh_workspace_transfer')
    modeOf.current = 'read-only'
    const downloadResult = await downloadTool.execute(
      { alias: 'test', direction: 'download', localPath: path.join(scratch, 'down.txt'), remotePath: '/srv/app/down.txt' },
      { agent: { session: { id: 's1' } } },
    )
    check('read-only still allows a download', downloadResult.ok === true, JSON.stringify(downloadResult))
  }
} finally {
  await rm(scratch, { recursive: true, force: true })
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
