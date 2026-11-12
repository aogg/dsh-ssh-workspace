/**
 * The guidance gate (f39d997) and the announcement move (guidance.js).
 *
 * The contract this suite pins is the INJECTION GATE — `sshGuidanceForCwd` is
 * evaluated on every model step, synchronously, and must never drift:
 *
 *   1. the base announcement is byte-for-byte unchanged for every session
 *      that has not PROVEN a Niubash runtime: no ssh:// workspace, a local
 *      path, an unknown host, a host with neither a `bashProvisioned` record
 *      nor a presence-cache entry — identical bytes, not "roughly the same";
 *   2. a record present (the durable store authority) appends exactly
 *      `\n\n` + `niubashGuidanceSection(record, alias)` — the address and
 *      version of the deployed tree travel in the text;
 *   3. a presence-cache hit (a completed init or a verified placement probe
 *      from THIS process) hits the same way; a presence entry for a DIFFERENT
 *      host must not leak into this host's text;
 *   4. the gate never runs a remote probe — the engine double below has no
 *      exec at all, so any network attempt would crash the suite;
 *   5. index.js re-exports the moved announcement and helpers under their old
 *      names (old import paths keep working), sharing ONE copy with
 *      guidance.js.
 *
 * Run: node tests/guidance-smoke.mjs
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// The re-export audit imports lib/index.js, whose module graph resolves the
// DSH peer packages (remote-fs.js via engine.js → bash-payload.js).
const coreRoot = process.env.DSH_CORE_ROOT
if (!coreRoot) {
  console.log('\n=== guidance smoke ===\n')
  console.log('  SKIP  DSH_CORE_ROOT is not set (the index.js re-export audit needs the peer tree)')
  console.log('\n=== 0 passed, 0 failed, 1 suite skipped ===')
  process.exit(0)
}
process.env.DSH_PEER_ROOT = [coreRoot, process.env.DSH_PEER_ROOT].filter(Boolean).join(path.delimiter)

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
let failures = 0
function check (label, ok, detail) {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`) } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

console.log('\n=== guidance smoke ===\n')

const guidance = await import(pathToFileURL(path.join(pluginRoot, 'lib/guidance.js')).href)
const { SSH_WORKSPACE_GUIDANCE, niubashGuidanceSection, sshGuidanceForCwd } = guidance

/** An engine double with ONLY the two synchronous facts the gate may read. */
function gateEngine ({ entries = {}, presence = {} } = {}) {
  const reads = { entry: 0, presence: 0 }
  return {
    reads,
    store: { entry: alias => { reads.entry += 1; return entries[alias] } },
    niubashPresenceOf: alias => { reads.presence += 1; return presence[alias] },
  }
}

const RECORD = {
  path: 'C:\\Users\\ao\\.dsh\\runtimes\\plugins\\dsh-ssh-workspace\\niubash\\winuxcmd\\usr\\bin\\bash.exe',
  root: 'C:\\Users\\ao\\.dsh\\runtimes\\plugins\\dsh-ssh-workspace\\niubash',
  version: '1.5.0',
  sha256: 'a'.repeat(64),
  provisionedAt: 1_700_000_000_000,
  releaseTag: 'v1.5.0',
  placement: 'user',
}

// ---------------------------------------------------------------------------
console.log('[the base announcement is byte-for-byte for unproven sessions]')

{
  check('no engine at all → the base text', sshGuidanceForCwd('/code/www/repo', undefined) === SSH_WORKSPACE_GUIDANCE)
  check('a null engine → the base text', sshGuidanceForCwd('/code/www/repo', null) === SSH_WORKSPACE_GUIDANCE)
  const engine = gateEngine()
  check('a local cwd → the base text', sshGuidanceForCwd('/code/www/repo', engine) === SSH_WORKSPACE_GUIDANCE)
  check('an ssh:// workspace on an unknown host → the base text',
    sshGuidanceForCwd('ssh://nobody/code', engine) === SSH_WORKSPACE_GUIDANCE)
  check('an ssh:// workspace on an unproven win host → the base text, BYTE FOR BYTE',
    sshGuidanceForCwd('ssh://win-bare/D:/repo', engine) === SSH_WORKSPACE_GUIDANCE)
  check('a malformed cwd → the base text', sshGuidanceForCwd('not-a-remote-path', engine) === SSH_WORKSPACE_GUIDANCE)
  check('an undefined cwd → the base text', sshGuidanceForCwd(undefined, engine) === SSH_WORKSPACE_GUIDANCE)
  {
    // One gate call reads the record, then (only if no record) the presence —
    // exactly two synchronous reads, nothing else.
    const counting = gateEngine()
    sshGuidanceForCwd('ssh://win-bare/D:/repo', counting)
    check('the gate read both facts synchronously (record, then presence)', counting.reads.entry === 1 && counting.reads.presence === 1, JSON.stringify(counting.reads))
  }
  check('the double has no exec — the gate must never probe', !('exec' in gateEngine()))
}

// ---------------------------------------------------------------------------
console.log('\n[a proven runtime appends exactly the Niubash section]')

{
  const engine = gateEngine({ entries: { 'win-record': { bashProvisioned: RECORD } } })
  const text = sshGuidanceForCwd('ssh://win-record/D:/repo', engine)
  check('a record hit composes base + blank line + section',
    text === `${SSH_WORKSPACE_GUIDANCE}\n\n${niubashGuidanceSection(RECORD, 'win-record')}`,
    JSON.stringify(text.slice(SSH_WORKSPACE_GUIDANCE.length, SSH_WORKSPACE_GUIDANCE.length + 60)))
  check('the appended section names the deployed tree address',
    text.includes('C:\\Users\\ao\\.dsh\\runtimes\\plugins\\dsh-ssh-workspace\\niubash'), text.slice(-400))
  check('the appended section names the host and the version',
    text.includes('主机 win-record') && text.includes('1.5.0') && text.includes('（v1.5.0）'), text.slice(-400))
  check('the appended section carries the ops do-nots',
    text.includes('不是 Linux、不是 WSL、也不是 PowerShell') && text.includes('tar.exe'), text.slice(-400))
}

{
  const PRESENCE = { root: RECORD.root, path: RECORD.path, version: 'GNU bash, version 5.2.26(1)-release', releaseTag: 'v1.5.0', placement: 'project', source: 'probe', at: Date.now() }
  const engine = gateEngine({ presence: { 'win-probed': PRESENCE } })
  const text = sshGuidanceForCwd('ssh://win-probed/D:/repo', engine)
  check('a presence-cache hit appends the section built from the cached fact',
    text === `${SSH_WORKSPACE_GUIDANCE}\n\n${niubashGuidanceSection(PRESENCE, 'win-probed')}`)
  check('the presence fact names the probed root', text.includes(PRESENCE.root))
}

{
  // A presence entry for a DIFFERENT host must not leak: the gate is per-alias.
  const PRESENCE = { root: 'C:\\other\\niubash', version: '9', placement: 'user', source: 'probe', at: Date.now() }
  const engine = gateEngine({ presence: { 'other-host': PRESENCE } })
  const text = sshGuidanceForCwd('ssh://win-bare/D:/repo', engine)
  check('another host\'s presence never leaks into this host\'s text',
    text === SSH_WORKSPACE_GUIDANCE && !text.includes('C:\\other\\niubash'))
  check('an entry without a record does not shadow the presence read', engine.reads.presence === 1)
}

{
  const text = niubashGuidanceSection({}, 'win-bare')
  check('the section renders even with a factless info (placeholders, never a crash)',
    text.includes('(路径未知)') && text.includes('未知版本') && text.includes('主机 win-bare'), text)
  const anonymous = niubashGuidanceSection({ root: 'C:\\x', version: '9' })
  check('a missing alias falls back to 本主机', anonymous.includes('主机') && anonymous.includes('本主机'), anonymous.slice(0, 80))
}

// ---------------------------------------------------------------------------
console.log('\n[the announcement reflects the Niubash features]')

{
  check('the announcement names the auto-deploy default for new win hosts',
    SSH_WORKSPACE_GUIDANCE.includes('新建 win 主机默认自动部署 Niubash 载荷'), SSH_WORKSPACE_GUIDANCE.slice(0, 1200))
  check('the announcement still describes the bash provisioning line',
    SSH_WORKSPACE_GUIDANCE.includes('ssh_workspace_bash'))
}

// ---------------------------------------------------------------------------
console.log('\n[index.js re-exports the moved announcement (old import paths keep working)]')

{
  const source = readFileSync(path.join(pluginRoot, 'lib/index.js'), 'utf8')
  check('guidance.js is the single home of the text (index.js carries no announcement body)',
    !source.includes('本机已安装 dsh-ssh-workspace 插件'), 'the announcement body is still inlined in index.js')
  check('index.js re-exports the moved symbols',
    /export \{ SSH_WORKSPACE_GUIDANCE, niubashGuidanceSection, sshGuidanceForCwd \} from '\.\/guidance\.js'/u.test(source), source.match(/export \{[^}]*guidance[^}]*\}/gu)?.join(' | '))

  const plugin = await import(pathToFileURL(path.join(pluginRoot, 'lib/index.js')).href)
  check('SSH_WORKSPACE_GUIDANCE is importable from the package root, identical bytes',
    typeof plugin.SSH_WORKSPACE_GUIDANCE === 'string' && plugin.SSH_WORKSPACE_GUIDANCE === guidance.SSH_WORKSPACE_GUIDANCE)
  check('niubashGuidanceSection is the same function object', plugin.niubashGuidanceSection === guidance.niubashGuidanceSection)
  check('sshGuidanceForCwd is the same function object', plugin.sshGuidanceForCwd === guidance.sshGuidanceForCwd)
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
