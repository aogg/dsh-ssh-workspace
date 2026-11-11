/**
 * The client half of the in-place host-key-mismatch recovery.
 *
 * The user-reported dead end: a directory dialog (or a card's test button)
 * hit the host-key refusal and its error text pointed at the panel's
 * 「忘记主机密钥」 — unreachable from inside the dialog. Now every surface
 * that can hit the refusal renders the structured fingerprints and a
 * confirm-gated "forget and retry" IN PLACE:
 *
 *   - `fetchJson` must forward the structured fields the server sends
 *     (`code` + `mismatch`) — the recovery renders from those fields and
 *     must never parse the refusal's prose;
 *   - the four connect surfaces (remote dialog, directory browser, default
 *     picker, host card) must route such failures to `HostKeyMismatchCard`
 *     and keep an ordinary retry for everything else;
 *   - the editor's own probe (draft channel) must do the same;
 *   - every confirmed recovery must POST hosts/forget-key and then re-run
 *     exactly the operation that failed.
 *
 * Why source pins instead of rendering: these are React components over
 * hooks and fetch round-trips (see default-path-ui-smoke's header for the
 * same reasoning). The behavioural core they lean on — the structured
 * payload, the forget route, the TOFU re-pin — is covered where it can run
 * for real (probe-route-smoke).
 *
 * Run: node tests/host-key-recovery-ui-smoke.mjs
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(here, '..')

let passed = 0
let failures = 0
function check (label, ok, detail) {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`) } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

console.log('\n=== host key recovery ui smoke ===\n')

const source = readFileSync(path.join(pluginRoot, 'lib/client.js'), 'utf8')

/** One component's source, from its declaration to the next sibling. */
function sliceOf (name) {
  const start = source.indexOf(`function ${name} (`)
  if (start < 0) throw new Error(`client.js does not define ${name}()`)
  const next = source.indexOf('\n    function ', start + 1)
  return source.slice(start, next < 0 ? source.length : next)
}

// ---------------------------------------------------------------------------
console.log('[the structured refusal survives the client transport]')

check('the client knows the same code string the engine and routes share',
  /const HOST_KEY_MISMATCH = 'hostKeyMismatch'/.test(source) &&
  source.includes("body.code === 'hostKeyMismatch'") === false,
  'the constant must not drift into ad-hoc literals')
{
  const fetchJson = source.indexOf('async function fetchJson')
  const fetchSlice = source.slice(fetchJson, fetchJson + 1600)
  check('fetchJson attaches code + mismatch from an error body',
    fetchSlice.includes('error.code = parsed.code') && fetchSlice.includes('error.mismatch = parsed.mismatch'),
    'a 4xx refusal must not lose its structured fingerprints')
  check('fetchJson still reduces the body to the message when it is not a mismatch',
    fetchSlice.includes("parsed?.error === 'string'") || fetchSlice.includes("typeof parsed?.error === 'string'"),
    'plain errors keep their message')
}
check('mismatchOf is the single "is this a mismatch" check',
  (source.match(/mismatchOf\(/g) ?? []).length >= 7,
  'call sites must not re-derive the check')
check('the mismatch card exists and is confirm-gated',
  sliceOf('HostKeyMismatchCard').includes('const [confirming, setConfirming] = React.useState(false)') &&
  sliceOf('HostKeyMismatchCard').includes('onClick: onConfirm,') &&
  /setConfirming\(true\)/.test(sliceOf('HostKeyMismatchCard')))

// ---------------------------------------------------------------------------
console.log('\n[the card renders both fingerprints and the MITM warning]')

{
  const card = sliceOf('HostKeyMismatchCard')
  check('the recorded fingerprint renders with its key type',
    card.includes("t('hostkey.recorded')") && card.includes('recorded.keyType') && card.includes('recorded.fingerprint'))
  check('the presented fingerprint renders with its key type',
    card.includes("t('hostkey.presented')") && card.includes('presented.keyType') && card.includes('presented.fingerprint'))
  check('the confirm step shows the man-in-the-middle warning before forgetting',
    card.includes("t('hostkey.confirmHint')"))
  check('the confirm step never skips to onConfirm directly',
    // The confirming branch executes onConfirm; the offer branch only ARMS
    // (`setConfirming(true)`). Both spellings must exist — an arm-less card
    // (one button straight to onConfirm) would skip the warning step.
    /onClick: \(\) => setConfirming\(true\)/.test(card) && card.includes('onClick: onConfirm,'),
    'arming must come between the offer and the action')
}

// ---------------------------------------------------------------------------
console.log('\n[the saved-host dialogs route refusals to the card]')

for (const [name, errorState, mismatchState] of [
  ['RemoteWorkspaceDialog', 'loadError', 'loadMismatch'],
  ['DirectoryBrowser', 'error', 'mismatch'],
  ['DefaultPathPicker', 'loadError', 'loadMismatch'],
]) {
  const slice = sliceOf(name)
  check(`${name}: a thrown listing error is inspected for the structured mismatch`,
    slice.includes(`set${mismatchState.charAt(0).toUpperCase()}${mismatchState.slice(1)}(mismatchOf(err))`),
    'the refusal must be detected on the error object, not the message')
  check(`${name}: the card replaces the plain error state on a refusal`,
    slice.includes(`jsx(HostKeyMismatchCard, {`))
  check(`${name}: an ordinary failure keeps a retry button`,
    slice.includes("t('remote.retry')"),
    'a transient listing error must stay one click from a retry')
  check(`${name}: the confirmed recovery forgets the alias, then re-lists the attempted path`,
    slice.includes('await forgetHostKeyFor(') && /await loadDir\(path\)/.test(slice),
    'forgetting without retrying leaves the user half-done')
  check(`${name}: a failed forget surfaces instead of vanishing`,
    slice.includes("t('hosts.forgetKeyFail')"),
    'the card must not silently swallow a failed recovery')
}

// ---------------------------------------------------------------------------
console.log('\n[the host card and its test probe]')

{
  const card = sliceOf('HostCard')
  check('the card renders the recovery card for its own alias',
    card.includes('mismatch != null && jsx(HostKeyMismatchCard, {'))
  check('the card confirm targets the row\'s alias',
    card.includes('onMismatchConfirm?.(host.alias)'))

  const panel = source.slice(source.indexOf('function RemoteWorkspacePanel'), source.indexOf('function RemoteWorkspacePanel') + 24000)
  check('the panel keeps per-host mismatch state',
    panel.includes('const [keyMismatches, setKeyMismatches] = React.useState({})'))
  check('a /test ok:false with structured fingerprints opens the card on that row',
    panel.includes('mismatchOf(result)'))
  check('a thrown /test with structured fingerprints opens it too',
    panel.includes('mismatchOf(err)'))
  check('a clean test clears the row\'s mismatch',
    /const mismatch = result\.ok \? null : mismatchOf\(result\)/.test(panel))
  check('the panel recovery forgets and then re-runs the probe',
    panel.includes('async function confirmForgetAndTest') || panel.includes('const confirmForgetAndTest = async'),
    panel.includes('await handleTest(alias)').toString())
}

// ---------------------------------------------------------------------------
console.log('\n[the editor probe shares the same recovery]')

{
  const editor = sliceOf('HostEditor')
  check('the editor probe keeps its structured mismatch',
    editor.includes('const [testMismatch, setTestMismatch] = React.useState(null)'))
  check('the editor renders the card inline next to the probe result',
    editor.includes('testMismatch !== null && jsx(HostKeyMismatchCard, {'))
  check('the editor confirm forgets the mismatch alias (or the draft alias), then re-probes',
    editor.includes('body: JSON.stringify({ alias: testMismatch?.alias ?? alias.trim() }),') &&
    editor.includes('await runTest()'))
}

// ---------------------------------------------------------------------------
console.log('\n[the listing channel helper]')

{
  const helper = source.slice(source.indexOf('async function fetchRemoteListing'), source.indexOf('async function forgetHostKeyFor'))
  check('the draft branch posts the ls action to /probe with the draft',
    helper.includes("action: 'ls'") && helper.includes('API.probe'))
  check('the saved branch keeps the GET /ls spelling',
    helper.includes('API.ls'))
  check('forgetHostKeyFor is the single forget helper for the recovery flows',
    // Four recovery call sites (picker / browser / remote dialog / panel) plus
    // the definition itself (`function forgetHostKeyFor (` — space before the
    // paren, hence the ` ?` in the pattern).
    (source.match(/forgetHostKeyFor ?\(/g) ?? []).length >= 5 &&
    // Helper body + editor confirm + the panel's legacy card button.
    (source.match(/API\.hostForgetKey/g) ?? []).length >= 3,
    `direct call sites: ${(source.match(/forgetHostKeyFor\(/g) ?? []).length}`)
}

// ---------------------------------------------------------------------------
console.log('\n[the locale carries the recovery vocabulary in both languages]')

for (const key of [
  'hostkey.title', 'hostkey.recorded', 'hostkey.presented', 'hostkey.recordedAt',
  'hostkey.forgetAndRetry', 'hostkey.confirmHint', 'hostkey.confirmYes', 'hostkey.forgetting',
  'editor.test', 'editor.testing', 'editor.testOk', 'editor.testFail', 'editor.pickNeedsTarget',
  'remote.retry',
]) {
  const zhQuoted = `'${key}': '`
  const occurrences = (source.match(new RegExp(zhQuoted.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu')) ?? []).length
  check(`${key} is defined in zh and en`, occurrences === 2, `found ${occurrences} definition(s)`)
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
