/**
 * The relaxation, against the REAL `dsh-working-directory` schema and REAL zod.
 *
 * `projection-relax-smoke` proves the logic with a schema double. That is not
 * enough here: the whole defect lives in a zod detail — `.refine(isAbsolute)`
 * captures the predicate as a VALUE, so republishing the ESM binding cannot
 * reach it — and a double could accidentally be relaxed by a mechanism that
 * does not exist for real zod. This suite therefore mounts the Host's own
 * `SessionProjectionRegistry` and `WorkingDirectoryService` from an assembled
 * DSH tree, in the production order (service first, plugin patch second), and
 * drives the exact read path a history load takes.
 *
 * SKIPs without DSH_CORE_ROOT pointing at a real tree: a stub root cannot stand
 * in for zod, and a false pass would be worse than an honest skip.
 *
 * Run: DSH_CORE_ROOT=/path/to/node_modules node tests/projection-real-smoke.mjs
 */

import { syncBuiltinESMExports } from 'node:module'
import nodePath from 'node:path'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { skipWithoutRealPeers } from './support/peer-mode.mjs'

const coreRoot = process.env.DSH_CORE_ROOT
if (!coreRoot) {
  console.log('\n=== projection real smoke ===\n')
  console.log('  SKIP  DSH_CORE_ROOT is not set (needs the assembled DSH tree with zod)')
  console.log('\n=== 0 passed, 0 failed, 1 suite skipped ===')
  process.exit(0)
}
skipWithoutRealPeers('projection real smoke', 'the assembled DSH tree (dsh-session-projection, dsh-working-directory, zod)')

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requireFromCore = createRequire(path.join(coreRoot, 'noop.cjs'))

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

console.log('\n=== projection real smoke ===\n')
console.log(`[core: ${coreRoot}]`)

const { Context } = requireFromCore('@deepseek-ai/cordis')
const { SessionProjectionRegistry } = await import(pathToFileURL(requireFromCore.resolve('@deepseek-ai/dsh-session-projection')).href)
const { WorkingDirectoryService } = await import(pathToFileURL(requireFromCore.resolve('@deepseek-ai/dsh-working-directory')).href)
const { installProjectionRelaxation, uninstallProjectionRelaxation } = await import(pathToFileURL(path.join(pluginRoot, 'lib/patch-projection.js')).href)

const SSH_CWD = 'ssh://qiyk/home/qiyk/test'
const LOCAL_CWD = path.resolve(pluginRoot)

/** Mount the two host services in the order the roster uses. */
function mountHost () {
  const ctx = new Context()
  new SessionProjectionRegistry(ctx)
  // The one service `working-directory` touches at construction.
  ctx.systemPrompt = { context () {}, getContextOrder: () => 0 }
  const service = new WorkingDirectoryService(ctx, { defaultDirectory: path.parse(pluginRoot).root })
  return { ctx, service }
}

/** The exact read a cold history load performs. */
function probe (ctx, cwd) {
  try {
    const restored = ctx.sessionProjections.restore({}, [], 0, { cwd }, 0)
    return { ok: true, value: restored.snapshot.values.workingDirectory }
  } catch (error) {
    return { ok: false, message: error.message.replace(/\s+/g, ' ').trim() }
  }
}

// ---------------------------------------------------------------------------
// 1. The bug, on the real schema: an ssh:// cwd fails the view schema.
//    This is what the browser reports as 历史加载失败 … Invalid input.
//
//    ⚠ READ THIS BEFORE "FIXING" A RED LINE HERE. This section asserts the Host
//    defect STILL EXISTS. It goes red on the DSH release that changes
//    `refine(isAbsolute)` to `refine((value) => isAbsolute(value))` — and a red
//    there means the upstream workaround has done its job and must be DELETED
//    (lib/patch-projection.js, its index.js block, this suite, and
//    docs/upstream-workarounds.md). It is not a regression.
// ---------------------------------------------------------------------------
const { ctx } = mountHost()
{
  const result = probe(ctx, SSH_CWD)
  check('the real workingDirectory viewSchema rejects an ssh:// cwd (the reported bug)',
    result.ok === false && /Invalid input/.test(result.message), result.ok ? `unexpectedly passed: ${result.value}` : result.message)
  check('...while the same schema accepts a local absolute path', probe(ctx, LOCAL_CWD).ok === true)
  check('=> the UPSTREAM-1 workaround is therefore still load-bearing on this Host build',
    result.ok === false)
}

// ---------------------------------------------------------------------------
// 2. Patching `node:path` the way fs-shim.js does is NOT enough.
//    This is the half of the diagnosis that has to stay true, or the relaxation
//    would be unnecessary.
// ---------------------------------------------------------------------------
{
  const original = nodePath.isAbsolute
  nodePath.isAbsolute = function isAbsolute (candidate) {
    if (typeof candidate === 'string' && /^ssh:\/\//i.test(candidate)) return true
    return original(candidate)
  }
  try {
    syncBuiltinESMExports()
    check('the patched binding does answer true for ssh://', nodePath.isAbsolute(SSH_CWD) === true)
    check('...yet the already-built schema still rejects it (the capture, not the binding)',
      probe(ctx, SSH_CWD).ok === false)
  } finally {
    nodePath.isAbsolute = original
    syncBuiltinESMExports()
  }
}

// ---------------------------------------------------------------------------
// 3. The plugin's relaxation fixes every read path that parses the value.
// ---------------------------------------------------------------------------
{
  const installed = installProjectionRelaxation(ctx, {})
  check('the relaxation found the already-registered unit in place', installed?.relaxedInPlace === true)
  check('...and did not conclude the Host was already fixed (it is not, on this build)',
    installed?.upstreamFixed === false)

  const restored = probe(ctx, SSH_CWD)
  check('restore() now yields the ssh:// cwd', restored.ok === true && restored.value === SSH_CWD,
    restored.ok ? restored.value : restored.message)

  const checkpoint = { workingDirectory: { ver: 1, seq: 2, val: SSH_CWD } }
  const listed = ctx.sessionProjections.viewCheckpoint(checkpoint)
  check('viewCheckpoint (the zero-I/O listing rung) yields it too',
    listed?.workingDirectory === SSH_CWD, JSON.stringify(listed?.workingDirectory))

  const withRow = ctx.sessionProjections.restore(checkpoint, [], 0, { cwd: SSH_CWD }, 0)
  check('restore() with a usable checkpoint row yields it',
    withRow?.snapshot?.values?.workingDirectory === SSH_CWD,
    JSON.stringify(withRow?.snapshot?.values?.workingDirectory))
}

// ---------------------------------------------------------------------------
// 4. Nothing else was loosened: the real zod rules still hold.
// ---------------------------------------------------------------------------
{
  check('a relative local cwd is still rejected', probe(ctx, 'relative/dir').ok === false)
  check('an empty cwd is still rejected', probe(ctx, '').ok === false)
  check('a null cwd still passes (a session with no recorded directory)',
    probe(ctx, null).ok === true)
  check('a local absolute cwd still passes unchanged',
    probe(ctx, LOCAL_CWD).ok === true && probe(ctx, LOCAL_CWD).value === LOCAL_CWD)
}

// ---------------------------------------------------------------------------
// 5. A unit that registers AFTER the plugin installed is relaxed on arrival —
//    the reload / harness order.
// ---------------------------------------------------------------------------
{
  const fresh = new Context()
  new SessionProjectionRegistry(fresh)
  fresh.systemPrompt = { context () {}, getContextOrder: () => 0 }

  const installed = installProjectionRelaxation(fresh, {})
  check('installing before the unit exists reports no in-place find', installed?.relaxedInPlace === false)

  new WorkingDirectoryService(fresh, { defaultDirectory: path.parse(pluginRoot).root })
  const result = probe(fresh, SSH_CWD)
  check('the unit registered afterwards is relaxed on arrival',
    result.ok === true && result.value === SSH_CWD, result.ok ? result.value : result.message)
}

// ---------------------------------------------------------------------------
// 6. Disposal keeps an already-open session loading.
// ---------------------------------------------------------------------------
{
  uninstallProjectionRelaxation(ctx)
  const result = probe(ctx, SSH_CWD)
  check('after uninstall an open ssh:// session still loads',
    result.ok === true && result.value === SSH_CWD, result.ok ? result.value : result.message)
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
