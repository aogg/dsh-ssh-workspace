/**
 * Preload (`node --require tests/support/no-net-preload.cjs`) that turns every
 * `fetch()` in the child process into a loud, recorded failure.
 *
 * The stage-niubash suite must prove the script NEVER touches the network on
 * its offline paths (`--dry-run` / `npm_config_dry_run`), and that a real run
 * with no local archive reaches for the GitHub API as the documented last
 * resort. Replacing `globalThis.fetch` does both: the replaced function appends
 * one JSON line per attempt to the file named by `NO_NET_FETCH_LOG` (so the
 * suite can assert exactly what was attempted, and to where) and then throws —
 * a download that silently succeeded or a suite that hung on a real socket
 * would both be worse than a deterministic refusal.
 *
 * CommonJS on purpose: `--require` preloads are CJS. Loaded before the ESM
 * entry, so the replacement is in place before any module code runs.
 */

'use strict'

const fs = require('node:fs')

const logFile = process.env.NO_NET_FETCH_LOG

/**
 * Record one blocked attempt (one JSON line) and throw the marker error.
 *
 * @param {string} url - the URL the code tried to fetch.
 * @returns {never} always throws.
 */
function block (url) {
  if (typeof logFile === 'string' && logFile !== '') {
    try { fs.appendFileSync(logFile, `${JSON.stringify({ url, at: Date.now() })}\n`) } catch { /* logging must never mask the refusal */ }
  }
  const error = new Error(`no-network-in-test: fetch(${url}) is not allowed in this suite`)
  error.code = 'NO_NETWORK_IN_TEST'
  throw error
}

globalThis.fetch = function blockedFetch (input, init) {
  const url = typeof input === 'string' || input instanceof URL
    ? String(input)
    : typeof input?.url === 'string' ? input.url : String(input)
  void init
  return block(url)
}
