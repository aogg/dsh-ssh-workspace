/**
 * The builtin-fs identity probes must not open SSH connections.
 *
 * DSH asks `node:fs/promises` about `ssh://` paths on its own initiative, long
 * before the user does anything: the Workspace registry canonicalizes and stats
 * every session cwd while it indexes headers at boot, and the sidebar asks each
 * workspace for its status as it renders. Those calls reach this plugin through
 * the builtin bridge — not through `ctx.fs`, which is fenced separately.
 *
 * The bridge used to answer every `stat`/`lstat`/`realpath` by calling
 * `engine.withSftp`, and `withSftp` calls `engine.acquire`, which CONNECTS. The
 * result was that simply starting DSH dialled every host named by a mounted
 * workspace, so a user who had left the app with nothing connected found every
 * connection up again after a restart.
 *
 * These checks pin the fix from both sides: a probe with no live connection
 * must not dial, and a probe with one must still tell the truth.
 *
 * Run: node tests/probe-smoke.mjs
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
let failures = 0
function check (label, ok, detail) {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

console.log('\n=== probe smoke ===\n')

// `remote-fs.js` resolves `@deepseek-ai/dsh-fs` through requirePeer. The runner
// points DSH_CORE_ROOT at a peer root (the generated stubs when the assembly is
// not present); locally this file can be run directly, so reproduce that here.
if (process.env.DSH_CORE_ROOT) {
  process.env.DSH_PEER_ROOT = [process.env.DSH_CORE_ROOT, process.env.DSH_PEER_ROOT]
    .filter(Boolean)
    .join(path.delimiter)
}

const { RemoteFileSystem } = await import(pathToFileURL(path.join(pluginRoot, 'lib/remote-fs.js')).href)
const { installBuiltinBridge, uninstallBuiltinBridge } = await import(pathToFileURL(path.join(pluginRoot, 'lib/fs-shim.js')).href)
const fsPromises = (await import('node:fs/promises')).default

const ALIAS = 'probehost'
const ROOT = '/home/dev/proj'
const WORKSPACE = `ssh://${ALIAS}${ROOT}`

/**
 * A fake engine that records every attempt to reach the network.
 *
 * `acquire` is the connection point, so counting its calls is exactly the
 * assertion that matters: "did this probe dial?"
 */
function makeEngine ({ live = false, statFails = false } = {}) {
  const calls = { acquire: 0, withSftp: 0 }
  const attrs = {
    size: 42,
    mode: 0o040755,
    uid: 1000,
    gid: 1000,
    ino: 1,
    dev: 1,
    nlink: 2,
    atime: 100,
    mtime: 200,
    isFile: () => false,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  }
  const sftp = {
    stat (target, cb) {
      if (statFails) { const error = new Error('No such file'); error.code = 2; cb(error); return }
      cb(undefined, attrs)
    },
    lstat (target, cb) { this.stat(target, cb) },
  }
  const record = { alias: ALIAS, sftp, broken: false, inFlight: 0, holds: 0, idleAt: Date.now() }
  const pool = new Map()
  if (live) pool.set(ALIAS, record)
  return {
    calls,
    pool,
    engine: {
      pool,
      async acquire (alias) { calls.acquire += 1; return record },
      async withSftp (alias, operation) { calls.withSftp += 1; return await operation(sftp, record) },
    },
  }
}

function makeRouter () {
  const router = Object.create(RemoteFileSystem.prototype)
  router.engine = undefined
  router.roots = new Set([WORKSPACE])
  router.cache = new Map()
  return router
}

const home = mkdtempSync(path.join(tmpdir(), 'dsh-ws-probe-'))
try {
  // ---------------------------------------------------------------------
  // 1. No live connection: an identity probe must not dial.
  // ---------------------------------------------------------------------
  {
    const { engine, calls } = makeEngine({ live: false })
    const router = makeRouter()
    installBuiltinBridge({ engine, router })
    try {
      const stats = await fsPromises.stat(`${WORKSPACE}/.`)
      check('stat on a mounted root answers without dialling',
        calls.withSftp === 0 && calls.acquire === 0,
        `withSftp=${calls.withSftp} acquire=${calls.acquire}`)
      check('stat still reports a directory, so membership survives',
        typeof stats?.isDirectory === 'function' && stats.isDirectory() === true)

      const linkStats = await fsPromises.lstat(WORKSPACE)
      check('lstat on a mounted root answers without dialling',
        calls.withSftp === 0 && calls.acquire === 0,
        `withSftp=${calls.withSftp} acquire=${calls.acquire}`)
      check('lstat reports a directory too', linkStats.isDirectory() === true)

      const resolved = await fsPromises.realpath(WORKSPACE)
      check('realpath answers lexically without dialling',
        calls.withSftp === 0 && calls.acquire === 0 && resolved === WORKSPACE,
        `withSftp=${calls.withSftp} resolved=${resolved}`)

      // The synthetic answer must be honest about being synthetic: it claims a
      // directory (true, the plugin verified it at mount) and nothing else.
      check('the synthetic Stats does not claim to be a file', stats.isFile() === false)
      check('the synthetic Stats does not claim to be a symlink', stats.isSymbolicLink() === false)
    } finally {
      uninstallBuiltinBridge()
    }
  }

  // ---------------------------------------------------------------------
  // 2. Outside every mounted root, an unconnected probe must miss rather
  //    than invent a directory — a wrong "yes" would attach unrelated
  //    sessions to this workspace.
  // ---------------------------------------------------------------------
  {
    const { engine, calls } = makeEngine({ live: false })
    const router = makeRouter()
    installBuiltinBridge({ engine, router })
    try {
      let code
      try {
        await fsPromises.stat(`ssh://${ALIAS}/home/dev/elsewhere`)
      } catch (error) {
        code = error?.code
      }
      check('an unconnected probe outside the root reports ENOENT', code === 'ENOENT', String(code))
      check('...and still did not dial', calls.withSftp === 0, `withSftp=${calls.withSftp}`)
      check('...nor acquire a connection', calls.acquire === 0, `acquire=${calls.acquire}`)
    } finally {
      uninstallBuiltinBridge()
    }
  }

  // ---------------------------------------------------------------------
  // 3. With a live connection the probe tells the truth from the host.
  //    A shortcut that always answered "directory" would make a deleted
  //    workspace look healthy forever.
  // ---------------------------------------------------------------------
  {
    const { engine, calls } = makeEngine({ live: true })
    const router = makeRouter()
    installBuiltinBridge({ engine, router })
    try {
      const stats = await fsPromises.stat(WORKSPACE)
      check('a connected probe reads the real attributes', stats.size === 42, String(stats.size))
      check('...through the pooled connection', calls.withSftp === 1, `withSftp=${calls.withSftp}`)
      check('...without re-acquiring', calls.acquire === 0, `acquire=${calls.acquire}`)
    } finally {
      uninstallBuiltinBridge()
    }
  }

  // ---------------------------------------------------------------------
  // 4. A live connection that answers "missing" must surface ENOENT, not
  //    the synthetic directory.
  // ---------------------------------------------------------------------
  {
    const { engine } = makeEngine({ live: true, statFails: true })
    const router = makeRouter()
    installBuiltinBridge({ engine, router })
    try {
      let code
      try {
        await fsPromises.stat(WORKSPACE)
      } catch (error) {
        code = error?.code
      }
      check('a live probe honours the host saying the path is gone', code === 'ENOENT', String(code))
    } finally {
      uninstallBuiltinBridge()
    }
  }

  // ---------------------------------------------------------------------
  // 5. A broken pooled record must count as "not connected", so the plugin
  //    does not treat a dead tunnel as a reason to trust stale answers.
  // ---------------------------------------------------------------------
  {
    const { engine, calls } = makeEngine({ live: true })
    engine.pool.get(ALIAS).broken = true
    const router = makeRouter()
    installBuiltinBridge({ engine, router })
    try {
      await fsPromises.stat(WORKSPACE)
      check('a broken record does not send the probe to the network',
        calls.withSftp === 0, `withSftp=${calls.withSftp}`)
    } finally {
      uninstallBuiltinBridge()
    }
  }
} finally {
  rmSync(home, { recursive: true, force: true })
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
