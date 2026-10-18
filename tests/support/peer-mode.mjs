/**
 * Helpers shared by the suites that need REAL DSH peer packages.
 *
 * A stub root (tests/peer-stubs.mjs) is enough for the plugin's own logic, but
 * three suites exercise the host's framework itself — Cordis service ordering,
 * profile boot, and the tool schema compiler. A stubbed `dsh-fs` has no
 * `assertSupportedJsonSchema`, and a stubbed `cordis` has no `Context`. Those
 * suites must SKIP (with a reason) rather than crash or silently "pass": a crash
 * reads as a broken build, and a false pass hides a real one.
 *
 * @module tests/support/peer-mode
 */

import { createRequire } from 'node:module'
import path from 'node:path'

/**
 * Whether the DSH peer packages reachable right now are real or stubbed.
 *
 * Detected by trying to load a symbol the stub deliberately omits. That is more
 * reliable than inspecting paths, because it answers the question the suite
 * actually cares about — "will this framework behave like the host's?" — instead
 * of "which directory did resolution happen to pick?".
 *
 * @returns {{real: boolean, reason: string}} the verdict.
 */
export function peerMode () {
  const root = process.env.DSH_CORE_ROOT
  if (!root) return { real: false, reason: 'DSH_CORE_ROOT is not set' }
  try {
    const requireFromRoot = createRequire(path.join(root, 'noop.cjs'))
    const fsPeer = requireFromRoot('@deepseek-ai/dsh-fs')
    if (fsPeer?.__dshStub === true) {
      return { real: false, reason: 'DSH_CORE_ROOT points at the generated stub root, not an assembled DSH tree' }
    }
    // A real tree also has Cordis itself; the stub root intentionally does not.
    requireFromRoot('@deepseek-ai/cordis')
    return { real: true, reason: '' }
  } catch (error) {
    return { real: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Skip a suite cleanly when the real framework is unavailable.
 *
 * Prints the same SKIP shape the suites already use and exits 0, so the runner
 * counts the suite as "reported success" for the right reason (nothing to run)
 * rather than as a failure.
 *
 * @param {string} suiteName - the suite's display name.
 * @param {string} needs - what it requires, for the message.
 * @returns {void} never returns (exits the process).
 */
export function skipWithoutRealPeers (suiteName, needs) {
  const mode = peerMode()
  if (mode.real) return
  console.log(`\n=== ${suiteName} ===\n`)
  console.log(`  SKIP  needs ${needs} (${mode.reason})`)
  console.log('\n=== 0 passed, 0 failed, 1 suite skipped ===')
  process.exit(0)
}
