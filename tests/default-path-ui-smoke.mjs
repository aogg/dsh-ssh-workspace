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

  check('picking is offered only for saved store hosts (GET /ls needs an alias)',
    editor.includes("const canPick = editing && host.source === 'store'"))
  check('the button is disabled with its hint when picking is unavailable',
    editor.includes('disabled: !canPick,') &&
    editor.includes("title: canPick ? undefined : t('editor.defaultPathPickHint')"))
  check('clicking opens the second-layer picker',
    editor.includes('onClick: () => setPickingPath(true),'))
  check('the picker starts from the field\'s content when there is one',
    editor.includes("initialPath: defaultPath.trim() !== '' ? defaultPath.trim() : undefined,"))
  check('OK writes the pick into the field and closes the picker',
    editor.includes('onPick: (picked) => { setDefaultPath(picked); setPickingPath(false) },'))
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
    picker.includes('if (seq === loadSeq.current) setLoadError(err.message)'))

  check('files are filtered out (a default path is a browsing start, not a file)',
    picker.includes(".filter((entry) => entry.type === 'directory')"))
  check('the surviving directories are name-ordered',
    picker.includes('.sort((a, b) => a.name.localeCompare(b.name))'))
  check('no initial path opens the SSH login directory (a null target)',
    /loadDir\(typeof initialPath === 'string' && initialPath !== '' \? initialPath : null\)/.test(picker))
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
