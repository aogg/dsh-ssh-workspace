/**
 * Windows-host bash resolution: find a usable POSIX bash on a host whose login
 * shell is cmd.exe, verify it for real, and spell the cmd-side launch lines
 * that hand commands to it.
 *
 * Why this module exists: Windows OpenSSH defaults the login shell to cmd.exe,
 * and every remote command this plugin sends has to speak the LOGIN shell's
 * dialect. A Git Bash / MSYS2 / niubash bash on such a host is a far better
 * command dialect than cmd (the whole POSIX script machinery becomes
 * reusable), so the engine resolves one per connection and dispatches POSIX
 * whenever a bash answers. Resolution is three rungs, most explicit first:
 *
 * 1. `bashPath` — the host entry's pinned executable (editor field). The
 *    owner said what to run; it only has to actually work.
 * 2. a provisioned copy (`bashProvisioned`, deployed by bash-payload.js) —
 *    bytes this plugin digest-checked at deployment time. The record's
 *    `path` is what makes an INITIALIZATION survive a restart, whatever
 *    placement convention produced it (the niubash three-level placement,
 *    or the legacy `~/.dsh-ssh-workspace/bash/<version>` root — recorded
 *    paths are trusted either way).
 * 3. detection — fixed well-known install locations (adapted from dsh-ops's
 *    `wellKnownCandidates`: Git for Windows, scoop, chocolatey, MSYS2), then
 *    `where bash` over the remote PATH. BEFORE that sweep, an entry with no
 *    provisioned record is first probed at the niubash default placements
 *    (project workspaces mounted from this host, then the user profile
 *    directory, then the legacy store root — see {@link niubashCandidates}):
 *    a tree this plugin (or the panel's init dialog) deployed, whose record
 *    is missing for any reason, is rediscovered without redeploying. The
 *    WSL launcher spellings are excluded: `%SystemRoot%\System32\bash.exe`
 *    and the Store alias `%LOCALAPPDATA%\Microsoft\WindowsApps\bash.exe`
 *    run a Linux distribution's bash, not a shell over this filesystem, and
 *    selecting one would silently move commands to another machine.
 *
 * Existence is never enough: every candidate is executed remotely
 * (`<bash> --version`) before it is believed, so a stale shim or a broken
 * install cannot win by merely existing. The answer is cached on the pooled
 * connection record by the engine (see `SshWorkspaceEngine#remoteBash`) and
 * re-derived on reconnect, like the dialect probe.
 *
 * This module is spelled for the cmd.exe login shell ON PURPOSE: detection
 * runs while the host is still undispatched (`cmd /c`-style command lines),
 * and the red line for provisioning forbids relying on anything beyond the
 * login shell itself plus bash — `if exist` / `where` / `set` are cmd
 * builtins, not extra programs.
 *
 * The two quote helpers below are local twins of `engine.cmdQuote` /
 * `engine.shellQuote`: importing them back from engine.js would make the
 * engine ↔ win-bash edge a cycle (engine.js calls into this module), so the
 * four characters are defined here once, with a comment naming the twin.
 *
 * @module @shiqyka/dsh-ssh-workspace/win-bash
 */

import { KINDS } from './diagnostics.js'
import { BASH_STORE_RELATIVE, NIUBASH_RUNTIME_RELATIVE, resolvePayloadPin } from './bash-payload.js'

/** Quote one argument for cmd.exe (local twin of `engine.cmdQuote`). */
function cmdArgQuote (value) {
  return `"${String(value)}"`
}

/**
 * Well-known bash install locations, as cmd spellings with env placeholders.
 *
 * cmd expands `%VAR%` on the command line before parsing, so one sweep
 * resolves per-user/per-machine roots remotely without a separate `echo`
 * round trip — and an undefined variable (32-bit Windows without
 * `ProgramFiles(x86)`) leaves the literal in place, which `if exist` simply
 * answers false for. The list is adapted from dsh-ops's bash
 * `wellKnownCandidates` (Git for Windows both layouts, the per-user install,
 * scoop shims, chocolatey, and the two MSYS2 roots); `%SystemRoot%\System32`
 * is deliberately absent — that spelling is the WSL launcher, filtered even
 * when `where bash` surfaces it.
 *
 * @type {readonly string[]}
 */
const WIN_BASH_CANDIDATES = Object.freeze([
  '%ProgramFiles%\\Git\\bin\\bash.exe',
  '%ProgramFiles%\\Git\\usr\\bin\\bash.exe',
  '%ProgramFiles(x86)%\\Git\\bin\\bash.exe',
  '%LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe',
  '%USERPROFILE%\\scoop\\shims\\bash.exe',
  '%USERPROFILE%\\scoop\\apps\\git\\current\\bin\\bash.exe',
  'C:\\ProgramData\\chocolatey\\bin\\bash.exe',
  'C:\\tools\\msys64\\usr\\bin\\bash.exe',
  'C:\\msys64\\usr\\bin\\bash.exe',
])

/** How many detected candidates get the real `--version` execution, in list order. */
export const WIN_BASH_VERIFY_LIMIT = 4

/**
 * The ordered niubash default placements probed when a host entry records no
 * provisioned copy — the "未记录时按 1→2→3 探测" half of the load-path
 * convention (a RECORDED path skips this entirely: rung 2 already trusts it).
 *
 * 1. `project` — every project workspace mounted from this host gets one
 *    candidate `<projectRoot>\.dsh\runtimes\plugins\dsh-ssh-workspace\niubash`.
 * 2. `user` — `%USERPROFILE%\.dsh\runtimes\plugins\dsh-ssh-workspace\niubash`
 *    (the default placement; the `%VAR%` spelling lets one cmd sweep resolve
 *    the concrete profile remotely, exactly like the well-known candidates).
 * 3. `legacy` — `%USERPROFILE%\.dsh-ssh-workspace\bash\<pin version>`: the
 *    store root pre-niubash deployments used. A deployment there is only
 *    TRUSTED via its record (rung 2), but probing it keeps an old install
 *    discoverable when the record was lost — and it is tried last so a
 *    niubash-convention tree always wins.
 *
 * The `user`/`legacy` roots above are `%VAR%` TEMPLATE spellings on purpose;
 * cmd expands `%VAR%` while PARSING the probe line, so a hit's echo carries
 * the CONCRETE path (`@@C:\Users\…`), and matching an echo back to these
 * candidates therefore goes through {@link niubashCandidateOfHit}'s suffix
 * judgment ({@link niubashPlacementOf}) — string equality against the
 * template can never hit. The `project` roots are concrete already (built
 * from the mounted roots) and match exactly.
 *
 * A `custom` placement exists only through its record (a user-chosen
 * directory is remembered nowhere else), so it is intentionally absent from
 * this probe list.
 *
 * @param {object | undefined} entry - the host store entry.
 * @param {string[]} [projectRoots] - mounted project roots on this host,
 *   Windows spellings, most relevant first.
 * @returns {Array<{root: string, placement: 'project'|'user'|'legacy'}>}
 *   ordered candidates; empty when a record already covers the host.
 */
export function niubashCandidates (entry, projectRoots = []) {
  // A recorded path outranks every default placement: rung 2 verifies it.
  if (entry?.bashProvisioned !== null && typeof entry?.bashProvisioned === 'object') return []
  const pin = resolvePayloadPin()
  const candidates = []
  for (const projectRoot of projectRoots) {
    if (typeof projectRoot === 'string' && projectRoot.trim() !== '') {
      candidates.push({ root: `${projectRoot.replace(/[\\/]+$/u, '')}\\${NIUBASH_RUNTIME_RELATIVE}`, placement: 'project' })
    }
  }
  candidates.push({ root: `%USERPROFILE%\\${NIUBASH_RUNTIME_RELATIVE}`, placement: 'user' })
  candidates.push({ root: `%USERPROFILE%\\${BASH_STORE_RELATIVE}\\${pin.version}`, placement: 'legacy' })
  return candidates
}

/**
 * The one-line cmd probe for the niubash default placements: an `if exist`
 * pair per candidate (the tree's `manifest.json` AND its bash executable —
 * both must exist for the marker to print), candidates in probe order.
 *
 * Nested `if exist` is the cmd AND — one command line sweeps every
 * placement with no extra program beyond the login shell, mirroring
 * {@link buildBashProbeScript}'s red line. The marker payload is ONLY the
 * root, so the parser reads hits in candidate order.
 *
 * Note what the echo actually carries: cmd expands `%VAR%` while PARSING
 * the line — BEFORE `if exist` runs — so a hit prints the marker followed
 * by the CONCRETE root (`@@C:\Users\ao\.dsh\…`), never the `%USERPROFILE%`
 * template spelling a candidate was built with. Matching echoes back to
 * candidates is {@link niubashCandidateOfHit}'s job, not equality.
 *
 * @param {Array<{root: string, placement: string}>} candidates - from
 *   {@link niubashCandidates}.
 * @returns {string} the probe command for the cmd.exe login shell.
 */
export function buildNiubashProbeScript (candidates) {
  const pin = resolvePayloadPin()
  const exeRelative = pin.executableRelativePath.replaceAll('/', '\\')
  return candidates
    .map(candidate => `if exist "${candidate.root}\\manifest.json" if exist "${candidate.root}\\${exeRelative}" echo @@${candidate.root}`)
    .join(' & ')
}

/**
 * The comparable key for a Windows path: separators unified to backslashes,
 * case-folded, trailing separators stripped (Windows paths are case- and
 * separator-insensitive; a trailing separator never distinguishes roots).
 *
 * @param {string} value - a Windows path in any spelling.
 * @returns {string} the normalized comparison key.
 */
function winPathKey (value) {
  return String(value).replaceAll('/', '\\').toLowerCase().replace(/[\\/]+$/u, '')
}

/**
 * Which niubash placement level a probed hit root belongs to, judged by
 * SUFFIX — never by equality against {@link niubashCandidates}' roots.
 *
 * Why suffix: cmd expands `%VAR%` while PARSING the probe line, before `if
 * exist` even runs, so `echo @@%USERPROFILE%\…` prints the CONCRETE path
 * (`@@C:\Users\ao\.dsh\…`) while the `user`/`legacy` candidate roots stay
 * template spellings — equality against the template can never hit. A
 * concrete echo is instead recognized by its fixed trailing layout:
 *
 * - `user`   — the path ends with
 *   `\.dsh\runtimes\plugins\dsh-ssh-workspace\niubash`
 *   ({@link NIUBASH_RUNTIME_RELATIVE} under the expanded profile directory);
 * - `legacy` — the path ends with `\.dsh-ssh-workspace\bash\<pinVersion>`
 *   ({@link BASH_STORE_RELATIVE} plus the pinned version directory the
 *   probe itself was spelled with, so the tail always matches the echoed
 *   tree).
 *
 * Separators, case and trailing separators are normalized first, so mixed
 * spellings still match. The `project` placement never enters this
 * judgment: its candidates are concrete (built from the mounted roots) and
 * match by exact key — see {@link niubashCandidateOfHit}, which tries
 * equality first and consults this judgment only for the template roots.
 * The two suffix tails are disjoint (`…\niubash` vs `…\bash\<version>`),
 * and each is boundary-anchored by its leading backslash, so a sibling
 * directory (`…\niubash-extra`) cannot false-match.
 *
 * @param {string} hitRoot - the concrete root a probe echoed back.
 * @param {string} pinVersion - the payload pin's version the probe was
 *   spelled with (the legacy tail carries it).
 * @returns {'user'|'legacy'|undefined} the placement level, or undefined
 *   when the path matches neither layout.
 */
export function niubashPlacementOf (hitRoot, pinVersion) {
  const key = winPathKey(hitRoot)
  if (key.endsWith(winPathKey(`\\${NIUBASH_RUNTIME_RELATIVE}`))) return 'user'
  const legacyTail = typeof pinVersion === 'string' && pinVersion.trim() !== ''
    ? winPathKey(`\\${BASH_STORE_RELATIVE}\\${pinVersion.trim()}`)
    : ''
  if (legacyTail !== '' && key.endsWith(legacyTail)) return 'legacy'
  return undefined
}

/**
 * The niubash candidate one probed hit root belongs to.
 *
 * Concrete roots (the `project` candidates, and any caller that passes
 * already-expanded spellings) match by exact normalized equality; the
 * template-spelled `user`/`legacy` candidates match through
 * {@link niubashPlacementOf}'s suffix judgment — cmd expands `%VAR%` at
 * line-parse time, so the echo carries the concrete path the template can
 * never equal. `path`/`prefix` are built from the echoed root itself by the
 * callers, so the matched placement is all this returns.
 *
 * @param {string} hitRoot - the root a probe echoed back (concrete on a
 *   real cmd host).
 * @param {Array<{root: string, placement: string}>} candidates - from
 *   {@link niubashCandidates}.
 * @param {string} pinVersion - the payload pin's version the probe was
 *   spelled with.
 * @returns {{root: string, placement: string} | undefined} the matched
 *   candidate, or undefined when the hit names no probed placement.
 */
export function niubashCandidateOfHit (hitRoot, candidates, pinVersion) {
  const list = Array.isArray(candidates) ? candidates : []
  const key = winPathKey(hitRoot)
  const exact = list.find(candidate => winPathKey(candidate.root) === key)
  if (exact !== undefined) return exact
  const placement = niubashPlacementOf(hitRoot, pinVersion)
  return placement === undefined ? undefined : list.find(candidate => candidate.placement === placement)
}

/**
 * Whether a candidate path is a WSL launcher rather than a POSIX bash over
 * this filesystem. Both spellings are normalized to backslashes and
 * lowercased first, so `%SystemRoot%` variants and mixed separators still
 * match. `System32\bash.exe` is the WSL distribution launcher; the Store
 * alias under `WindowsApps` resolves to the same program.
 *
 * @param {string} value - candidate path.
 * @returns {boolean} true when the path must not be selected.
 */
export function isWslBashPath (value) {
  const normalized = String(value).replaceAll('/', '\\').toLowerCase()
  return normalized.endsWith('\\windows\\system32\\bash.exe')
    || normalized.endsWith('\\microsoft\\windowsapps\\bash.exe')
}

/**
 * The one-line cmd probe for detection: an `if exist` per candidate (each
 * hit echoes its concrete path behind a marker) followed by `where bash`.
 *
 * The marker is the echo's ONLY payload, so the parser reads candidates in
 * list order before the PATH hits. `where` exits non-zero when it finds
 * nothing and prints an INFO line to stdout — the whole probe therefore
 * judges by CONTENT (`@@` markers and path-shaped lines), never by exit
 * status.
 *
 * @returns {string} the probe command for the cmd.exe login shell.
 */
export function buildBashProbeScript () {
  const probes = WIN_BASH_CANDIDATES.map(candidate => `if exist "${candidate}" echo @@${candidate}`)
  return `${probes.join(' & ')} & where bash`
}

/**
 * Parse the detection probe's output into ordered, de-duplicated candidates.
 *
 * `@@`-marked lines are the well-known hits (list order preserved);
 * remaining lines are `where bash` output, kept only when they look like an
 * absolute Windows path naming bash. WSL launcher spellings are dropped
 * here — the single choke point both probe halves flow through — and
 * duplicates collapse case-insensitively (Windows paths).
 *
 * @param {string} stdout - the probe's collected stdout.
 * @returns {string[]} concrete candidate paths, most preferred first.
 */
export function parseBashProbeOutput (stdout) {
  const found = []
  const seen = new Set()
  for (const rawLine of String(stdout ?? '').split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line === '') continue
    let candidate
    if (line.startsWith('@@')) candidate = line.slice(2)
    else if (/^[A-Za-z]:[\\/]/u.test(line) && /bash(\.exe)?$/iu.test(line)) candidate = line
    else continue
    if (isWslBashPath(candidate)) continue
    const key = candidate.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    found.push(candidate)
  }
  return found
}

/**
 * Verify one candidate by actually running it: `<bash> --version` through
 * the host's login shell, exit 0, and output that names bash.
 *
 * A file that merely exists (an abandoned shim, a corrupt install) fails
 * here and the next candidate gets its turn. The version line travels back
 * for display; `prefix` (see {@link bashLaunchPrefix}) is prepended when the
 * caller says so.
 *
 * @param {object} engine - the live engine (any object with an `exec`).
 * @param {string} alias - host alias.
 * @param {string} bashPath - candidate executable (Windows spelling).
 * @param {object} [options] - run options.
 * @param {string} [options.prefix] - cmd prefix line (PATH setup for a
 *   provisioned tree whose bash shim locates its engine through PATH).
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @param {number} [options.timeoutMs] - exec budget (default 15000).
 * @returns {Promise<{version: string} | undefined>} the version line, or
 *   undefined when the executable did not prove itself.
 */
export async function verifyBashExecutable (engine, alias, bashPath, options = {}) {
  const prefix = typeof options.prefix === 'string' ? options.prefix : ''
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 15_000
  const outcome = await engine.exec(alias, `${prefix}${cmdArgQuote(bashPath)} --version`, { timeoutMs, signal: options.signal })
  if (outcome.success !== true || !/bash/iu.test(outcome.stdout)) return undefined
  const version = outcome.stdout.split(/\r?\n/u).find(line => line.trim() !== '')
  return { version: typeof version === 'string' ? version.trim() : '' }
}

/**
 * The cmd prefix a provisioned payload's bash needs in front of its launch
 * line.
 *
 * The niubash `bash.exe` shim locates its engine (`niu.exe`, parked at the
 * tree root) through `NIU_SHELL` or PATH; a bare invocation from an arbitrary
 * cwd would answer "cannot locate niu.exe". Prepending the tree root and its
 * `winuxcmd\usr\bin` to PATH fixes that — and, as a deliberate side effect,
 * puts the payload's own git/rg/awk on the PATH of every script that bash
 * runs, which is what makes remote glob/grep and git tracking work on a
 * host that had neither. `set` is a cmd builtin, so the prefix adds no
 * program call beyond the login shell itself.
 *
 * @param {string} installRoot - the provisioned tree's root (Windows spelling).
 * @returns {string} a cmd prefix ending in `& `, safe to prepend.
 */
export function bashLaunchPrefix (installRoot) {
  const root = String(installRoot).replace(/[\\/]+$/u, '')
  return `set "PATH=${root};${root}\\winuxcmd\\usr\\bin;%PATH%" & `
}

/**
 * The cwd spelling a win host's bash script should `cd` into.
 *
 * Session paths on Windows hosts travel as SFTP absolutes (`/D:/code`), and
 * the drive-letter spelling is what a native-Windows bash resolves: strip
 * the SFTP leading slash and keep forward separators (`D:/code`). Anything
 * else passes through with separators unified.
 *
 * @param {string} value - a remote absolute path (SFTP or Windows spelling).
 * @returns {string} the path as bash on Windows should see it.
 */
export function bashCwdOf (value) {
  const slashed = String(value).replaceAll('\\', '/')
  const drive = /^\/([A-Za-z]):(.*)$/u.exec(slashed)
  if (drive !== null) return `${drive[1]}:${drive[2] === '' ? '/' : drive[2]}`
  return slashed
}

/**
 * Resolve the bash runtime for one Windows-type host: pinned, provisioned,
 * then detected, each rung verified by real execution.
 *
 * The caller (the engine) owns caching; this function is the one network
 * conversation. A pinned `bashPath` that fails verification does NOT fail
 * the host — it degrades to the next rung with a diagnostics entry, because
 * a stale pin must not turn every remote command into a hard error while a
 * working bash sits one rung below. The same applies to a provisioned copy
 * that stopped verifying.
 *
 * @param {object} engine - the live engine (`exec`, `diagnostics`).
 * @param {string} alias - host alias.
 * @param {object} [options] - resolution inputs.
 * @param {object} [options.entry] - the host store entry (`bashPath`,
 *   `bashProvisioned`), when one exists.
 * @param {string[]} [options.projectRoots] - mounted project roots on this
 *   host (Windows spellings), feeding the niubash `project` placement probe.
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @returns {Promise<{path: string, source: 'pinned'|'provisioned'|'detected', version?: string, prefix?: string} | undefined>}
 *   the verified bash, or undefined when the host has none (cmd fallback).
 */
export async function resolveWinBash (engine, alias, options = {}) {
  const entry = options.entry ?? undefined
  // Rung 1: the entry's pinned executable. The owner's word counts, but the
  // verification still runs — a pin names a file, not a working shell.
  const pinned = typeof entry?.bashPath === 'string' ? entry.bashPath.trim() : ''
  if (pinned !== '') {
    const verified = await verifyBashExecutable(engine, alias, pinned, { signal: options.signal })
    if (verified !== undefined) return { path: pinned, source: 'pinned', ...verified }
    engine.diagnostics?.record?.(KINDS.degraded, `pinned bashPath did not verify (${pinned}); falling back to the provisioned copy / detection`, { alias })
  }
  // Rung 2: the copy this plugin deployed, with its PATH prefix so the shim
  // finds its engine. A deployment-time digest check plus this live run is
  // the same two-step proof the provisioner itself applies.
  const provisioned = entry?.bashProvisioned
  if (provisioned !== null && typeof provisioned === 'object' && typeof provisioned.path === 'string' && provisioned.path !== '') {
    const prefix = typeof provisioned.root === 'string' && provisioned.root !== '' ? bashLaunchPrefix(provisioned.root) : ''
    const verified = await verifyBashExecutable(engine, alias, provisioned.path, { prefix, signal: options.signal })
    if (verified !== undefined) return { path: provisioned.path, source: 'provisioned', prefix, ...verified }
    engine.diagnostics?.record?.(KINDS.degraded, `provisioned bash did not verify (${provisioned.path}); falling back to detection`, { alias })
  }
  // Rung 3a: the niubash default placements (only when no record names a
  // tree). One sweep exec for `manifest.json` + `bash.exe` existence, then
  // real executions in placement order until one candidate answers for
  // itself — identical trust discipline to the well-known sweep below.
  const niubash = niubashCandidates(entry, Array.isArray(options.projectRoots) ? options.projectRoots : [])
  if (niubash.length > 0) {
    const pin = resolvePayloadPin()
    const exeRelative = pin.executableRelativePath.replaceAll('/', '\\')
    const outcome = await engine.exec(alias, buildNiubashProbeScript(niubash), { timeoutMs: 15_000, signal: options.signal })
    const hitRoots = parseBashProbeOutput(outcome.stdout)
    for (const hitRoot of hitRoots) {
      // cmd expands %VAR% at line-parse time, so a hit's echo is the
      // CONCRETE root (`C:\Users\…`), while the user/legacy candidate roots
      // are `%USERPROFILE%` templates — equality can never hit. Match
      // through the suffix judgment (project stays exact-equality).
      const candidate = niubashCandidateOfHit(hitRoot, niubash, pin.version)
      if (candidate === undefined) continue
      const path = `${hitRoot.replace(/[\\/]+$/u, '')}\\${exeRelative}`
      const prefix = bashLaunchPrefix(hitRoot)
      const verified = await verifyBashExecutable(engine, alias, path, { prefix, signal: options.signal })
      if (verified === undefined) continue
      // Cache the presence fact for the injection gate: a probed-and-working
      // niubash placement is exactly "探测到三级路径之一存在且可用".
      engine.noteNiubashPresence?.(alias, {
        root: hitRoot.replace(/[\\/]+$/u, ''),
        path,
        version: verified.version,
        releaseTag: pin.releaseTag,
        placement: candidate.placement,
        source: 'probe',
      })
      return { path, source: 'detected', prefix, ...verified }
    }
  }
  // Rung 3: detection. One sweep exec for existence, then real executions in
  // list order until one candidate answers for itself.
  const outcome = await engine.exec(alias, buildBashProbeScript(), { timeoutMs: 15_000, signal: options.signal })
  const candidates = parseBashProbeOutput(outcome.stdout)
  for (const candidate of candidates.slice(0, WIN_BASH_VERIFY_LIMIT)) {
    const verified = await verifyBashExecutable(engine, alias, candidate, { signal: options.signal })
    if (verified !== undefined) return { path: candidate, source: 'detected', ...verified }
  }
  return undefined
}
