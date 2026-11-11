/**
 * The client half of recording a host's default directory: the create
 * dialog's 「设为本主机默认目录」 checkbox and the host editor's
 * DefaultPathPicker.
 *
 * Why source pins instead of path-crumbs-smoke's extract-and-run: the picker
 * and the dialog are React components driven by useState/useRef/useCallback
 * and a fetchJson round-trip, so re-running them would need a hooks simulator
 * plus a fetch stub — a harness more brittle than what it verifies. The
 * wiring contracts below are therefore pinned the way backdrop-dismiss-smoke
 * pins its per-dialog guards: slice the component source and read it. The
 * behavioral core these slices lean on (route semantics, normalization, the
 * seq-guarded listing shape) is covered where it can run for real —
 * host-default-path-smoke and path-crumbs-smoke.
 *
 * Run: node tests/default-path-ui-smoke.mjs
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

console.log('\n=== default path ui smoke ===\n')

const source = readFileSync(path.join(pluginRoot, 'lib/client.js'), 'utf8')
const routesSource = readFileSync(path.join(pluginRoot, 'lib/routes.js'), 'utf8')

/** One component's source, from its declaration to the next sibling. */
function sliceOf (name) {
  const start = source.indexOf(`function ${name} (`)
  if (start < 0) throw new Error(`client.js does not define ${name}()`)
  const next = source.indexOf('\n    function ', start + 1)
  return source.slice(start, next < 0 ? source.length : next)
}

// ---------------------------------------------------------------------------
console.log('[the route spelling travels with the client]')

const DEFAULT_PATH_URL = '/api/dsh-ssh-workspace/hosts/default-path'
check('the client API carries the same URL the server registers',
  source.includes(DEFAULT_PATH_URL) && routesSource.includes(DEFAULT_PATH_URL),
  'client and server must not drift apart on the route spelling')
check('the record step fetches through the shared constant, not a literal',
  /await fetchJson\(API\.hostDefaultPath,/.test(source))

// ---------------------------------------------------------------------------
console.log('\n[RemoteWorkspaceDialog: the record checkbox]')

{
  const dialog = sliceOf('RemoteWorkspaceDialog')

  check('the checkbox starts unchecked (recording must not be a create default)',
    dialog.includes('const [recordDefault, setRecordDefault] = React.useState(false)'))
  check('only store hosts count as editable (an ~/.ssh/config host is read-only)',
    dialog.includes("const hostEditable = selectedHost?.source !== 'ssh-config'"))
  check('the checkbox is locked while creating and on read-only hosts',
    dialog.includes('disabled: creating || !hostEditable,'))
  check('the locked row explains itself through the hint key',
    dialog.includes("title: hostEditable ? undefined : t('remote.setAsDefaultHint')"))
  check('switching to an ssh-config host clears the check',
    /source === 'ssh-config'\) setRecordDefault\(false\)/.test(dialog))

  const mountFailed = dialog.indexOf('if (!result.ok) throw')
  const record = dialog.indexOf("if (recordDefault && hostEditable && typeof path === 'string')")
  check('the record step is gated on the checkbox, an editable host, and a real path',
    record > 0, 'the guard was not found')
  check('the record step runs only after the create succeeded',
    record > mountFailed && mountFailed > 0, `create@${mountFailed} record@${record}`)
  check('the record POST carries exactly alias and path',
    dialog.includes('body: JSON.stringify({ alias, path }),'))

  // 挂载成功是主交付：记录失败只留痕，不回滚、不弹错。 The regex anchors the
  // catch body to the single warn line, so a rethrow cannot sneak back in.
  check('a failed record is contained (warn, never rethrown)',
    /catch \(err\) \{\s*console\.warn\('\[dsh-ssh-workspace\] recording the default directory failed[^\n]*\n\s*\}/.test(dialog))
}

// ---------------------------------------------------------------------------
console.log('\n[HostEditor: the pick button]')

{
  const editor = sliceOf('HostEditor')

  // Picking dials the draft-probe channel (POST /probe), so it no longer
  // needs a saved host — it needs the same thing the test button needs: a
  // complete, connectable form. The old gate (editing && source === 'store')
  // is what made new hosts unable to pick a default directory.
  check('picking is gated on the connectable draft, not on a saved host',
    editor.includes('const canProbe = draft !== null') &&
    editor.includes('disabled: !canProbe,') &&
    !editor.includes("const canPick = editing && host.source === 'store'"),
    'the pick button must key on the draft, like the test button')
  check('the picker receives the memoized draft (a fresh object per render would re-run its initial-listing effect)',
    editor.includes('const draft = React.useMemo(draftPayload,') &&
    // The leading comment block may grow; what must stay is the wiring: the
    // picker's FIRST prop after it is the memoized `draft`.
    /pickingPath && jsx\(DefaultPathPicker, \{(?:\s*\/\/[^\n]*)*\s*draft,/u.test(editor))
  check('the disabled button explains what is missing',
    editor.includes("title: canProbe ? undefined : t('editor.pickNeedsTarget')"))
  check('clicking opens the second-layer picker',
    editor.includes('onClick: () => setPickingPath(true),'))
  check('the picker starts from the field\'s content when there is one',
    editor.includes("initialPath: defaultPath.trim() !== '' ? defaultPath.trim() : undefined,"))
  check('OK writes the pick into the field and closes the picker',
    editor.includes('onPick: (picked) => { setDefaultPath(picked); setPickingPath(false) },'))

  // The editor's own probe (test button) shares the draft channel.
  check('the test button probes through POST /probe with the draft',
    editor.includes('body: JSON.stringify({ action: \'test\', draft }),'))
  check('the probe is offered only when the draft is complete',
    editor.includes('disabled: !canProbe || testing,'))
  check('a probe failure with structured fingerprints opens the mismatch card',
    editor.includes('setTestMismatch(mismatchOf(result))') && editor.includes('setTestMismatch(mismatchOf(err))'))
  check('the confirmed recovery forgets the key and re-runs the probe',
    editor.includes('body: JSON.stringify({ alias: testMismatch?.alias ?? alias.trim() }),') &&
    editor.includes('await runTest()'))
  check('a successful probe toasts the duration and stays inline',
    editor.includes("onToast?.({ kind: 'ok', text: t('editor.testOk', { ms: result.durationMs }) })") &&
    editor.includes("t('editor.testOk', { ms: testResult.durationMs })"))
}

// ---------------------------------------------------------------------------
console.log('\n[DefaultPathPicker: the second layer]')

{
  const picker = sliceOf('DefaultPathPicker')

  check('OK confirms the SHOWN path (the echoed data.path, not a stale target)',
    picker.includes('onClick: () => onPick?.(path),'))
  check('OK stays disabled until a listing resolves and none is in flight',
    picker.includes('disabled: path == null || loading,'))

  // Two listings racing (double-click a crumb, type-and-up) must not let the
  // slower answer paint over the newer one.
  check('every listing is seq-stamped',
    picker.includes('const seq = ++loadSeq.current'))
  check('an out-of-order answer is discarded',
    picker.includes('if (seq !== loadSeq.current) return'))
  check('a failed stale answer cannot clobber the live error state',
    /if \(seq !== loadSeq\.current\) return\n\s+setLoadError\(err\.message\)/.test(picker))
  check('a host-key refusal is kept structured beside the message',
    picker.includes('setLoadMismatch(mismatchOf(err))'))
  check('the mismatch renders the recovery card instead of dead-end text',
    picker.includes('!loading && loadMismatch !== null && jsx(HostKeyMismatchCard, {'))
  check('the confirmed recovery forgets the key and re-lists the attempted path',
    picker.includes('await forgetHostKeyFor(loadMismatch?.alias ?? draft?.alias ?? \'\')') &&
    picker.includes('await loadDir(path)'))
  check('an ordinary failure keeps its plain retry',
    picker.includes("onClick: () => loadDir(path), children: t('remote.retry') }"))
  check('the listing goes through the shared channel helper (draft vs saved)',
    picker.includes('await fetchRemoteListing(target, { draft })'))

  check('files are filtered out (a default path is a browsing start, not a file)',
    picker.includes(".filter((entry) => entry.type === 'directory')"))
  check('the surviving directories are name-ordered',
    picker.includes('.sort((a, b) => a.name.localeCompare(b.name))'))
  check('no initial path opens the SSH login directory (a null target)',
    /loadDir\(typeof initialPath === 'string' && initialPath !== '' \? initialPath : null\)/.test(picker))
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
