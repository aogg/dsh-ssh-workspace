/**
 * The win-bash resolver: probe script shape, output parsing, executable
 * verification, the three resolution rungs, and the cmd-side spellings.
 *
 * Everything in win-bash.js answers one question — "does this cmd-login
 * Windows host have a POSIX bash this plugin may drive?" — and every answer
 * is consumed by a dispatch decision (engine.remoteDialect, exec's bash
 * launcher, the provisioner's PATH prefix). The contracts pinned here:
 *
 *   1. the probe script speaks ONLY cmd builtins (`if exist`, `where`),
 *      sweeps the nine well-known locations in list order with `@@` markers,
 *      and never executes anything by itself;
 *   2. parsing judges by CONTENT: `@@` hits first (list order), then only
 *      absolute drive-letter paths that name bash; the two WSL launcher
 *      spellings are dropped at this single choke point, and Windows-path
 *      duplicates collapse case-insensitively;
 *   3. existence is never enough — every candidate answers `<bash> --version`
 *      before it is believed, a stale pin degrades to the next rung (with a
 *      diagnostics entry, never an error), and detection executes at most
 *      WIN_BASH_VERIFY_LIMIT candidates;
 *   4. `bashCwdOf` / `bashLaunchPrefix` produce the exact spellings the bash
 *      launcher and provisioned shim rely on.
 *
 * The pure half (everything) runs on a bare checkout: win-bash.js imports
 * only diagnostics.js, and the engine below is a scripted double.
 *
 * Run: node tests/win-bash-smoke.mjs
 */

import { createHash } from 'node:crypto'

const pluginRoot = new URL('..', import.meta.url).pathname

let passed = 0
let failures = 0
function check (label, ok, detail) {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`) } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const { buildBashProbeScript, parseBashProbeOutput, verifyBashExecutable, resolveWinBash, bashCwdOf, bashLaunchPrefix, isWslBashPath, WIN_BASH_VERIFY_LIMIT } = await import(new URL(`${pluginRoot}lib/win-bash.js`, import.meta.url).href)
const { KINDS } = await import(new URL(`${pluginRoot}lib/diagnostics.js`, import.meta.url).href)
const { normalizeHostBashPath, normalizeBashProvisioned, HostConfigStore } = await import(new URL(`${pluginRoot}lib/store.js`, import.meta.url).href)

console.log('\n=== win bash smoke ===\n')

// ---------------------------------------------------------------------------
console.log('[buildBashProbeScript]')
//
// The probe runs on the RAW cmd login shell, so every token in it must be a
// cmd builtin — a program call here would break the provisioning red line
// ("the remote side sees only the login shell, SFTP, and bash itself").

{
  const script = buildBashProbeScript()
  const candidates = [
    '%ProgramFiles%\\Git\\bin\\bash.exe',
    '%ProgramFiles%\\Git\\usr\\bin\\bash.exe',
    '%ProgramFiles(x86)%\\Git\\bin\\bash.exe',
    '%LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe',
    '%USERPROFILE%\\scoop\\shims\\bash.exe',
    '%USERPROFILE%\\scoop\\apps\\git\\current\\bin\\bash.exe',
    'C:\\ProgramData\\chocolatey\\bin\\bash.exe',
    'C:\\tools\\msys64\\usr\\bin\\bash.exe',
    'C:\\msys64\\usr\\bin\\bash.exe',
  ]
  check('the probe sweeps exactly the nine well-known locations',
    candidates.every(candidate => script.includes(`if exist "${candidate}" echo @@${candidate}`)),
    script)
  check('the candidates are joined with cmd & and the sweep ends with `where bash`',
    script.endsWith('& where bash') && script.split(' & ').length === candidates.length + 1, script)
  check('every hit echoes its concrete path behind the @@ marker',
    script.split('if exist ').length === candidates.length + 1 && (script.match(/echo @@/gu) ?? []).length === candidates.length, script)
  check('the probe EXECUTES nothing (only if exist / where / echo, all cmd builtins)',
    !/bash\.exe"|bash --|command -v/u.test(script.replace(/bash\.exe/g, '')), script)
  check('the WSL launcher location is deliberately absent from the sweep',
    !script.includes('System32') && !script.includes('WindowsApps'), script)
}

// ---------------------------------------------------------------------------
console.log('\n[parseBashProbeOutput]')

{
  // Realistic probe output: the script emits every @@ marker BEFORE it runs
  // `where bash` (cmd executes the `if exist` chain first), so the well-known
  // hits lead the result and the PATH hits follow in their line order.
  const found = parseBashProbeOutput([
    '@@C:\\Program Files\\Git\\bin\\bash.exe',
    '@@C:\\msys64\\usr\\bin\\bash.exe',
    'C:\\ProgramData\\chocolatey\\bin\\bash.exe',
    'D:\\tools\\msys64\\usr\\bin\\bash.exe',
    '',
  ].join('\r\n'))
  check('@@-marked hits lead the result, in the sweep\'s list order',
    found[0] === 'C:\\Program Files\\Git\\bin\\bash.exe' && found[1] === 'C:\\msys64\\usr\\bin\\bash.exe',
    JSON.stringify(found))
  check('path-shaped where hits follow the markers',
    found[2] === 'C:\\ProgramData\\chocolatey\\bin\\bash.exe' && found[3] === 'D:\\tools\\msys64\\usr\\bin\\bash.exe',
    JSON.stringify(found))
  check('the parse returns only real candidates (4 candidate lines in, 4 out)',
    found.length === 4, JSON.stringify(found))
  check('the sweep script itself is what guarantees markers before `where bash`',
    buildBashProbeScript().indexOf('echo @@') < buildBashProbeScript().lastIndexOf('& where bash'))
}

{
  const found = parseBashProbeOutput([
    'bash',
    'C:\\Windows\\System32\\bash.exe',
    'C:\\tools\\not-bash-at-all.txt',
    'INFO: Could not find files for the given pattern(s).',
    'relative/path/bash',
    '/usr/bin/bash',
    'bash.exe',
  ].join('\r\n'))
  check('bare names, INFO lines and non-drive paths are filtered out',
    found.length === 0, JSON.stringify(found))
}

{
  const found = parseBashProbeOutput([
    'C:\\Windows\\System32\\bash.exe',
    'c:/windows/system32/bash.exe',
    'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe',
    'C:/Users/u/AppData/Local/Microsoft/WindowsApps/bash.exe',
  ].join('\r\n'))
  check('both WSL launcher locations are excluded in concrete spellings',
    found.length === 0, JSON.stringify(found))
  check('the WSL filter is case- and separator-insensitive on real paths',
    isWslBashPath('c:/WINDOWS/SYSTEM32/bash.exe') && isWslBashPath('C:/Users/U/AppData/Local/Microsoft/WindowsApps/BASH.EXE')
      && !isWslBashPath('C:\\Program Files\\Git\\bin\\bash.exe') && !isWslBashPath('C:\\msys64\\usr\\bin\\bash.exe'))
}

{
  const found = parseBashProbeOutput([
    'C:\\Git\\bin\\bash.exe',
    'c:\\git\\bin\\bash.exe',
    'C:\\GIT\\BIN\\BASH.EXE',
    'D:\\other\\bash.exe',
  ].join('\r\n'))
  check('duplicates collapse case-insensitively and keep the first spelling',
    found.length === 2 && found[0] === 'C:\\Git\\bin\\bash.exe' && found[1] === 'D:\\other\\bash.exe',
    JSON.stringify(found))
}

{
  check('a marker carrying a WSL spelling is dropped at the same choke point',
    parseBashProbeOutput('@@C:\\Windows\\System32\\bash.exe').length === 0)
  check('empty output parses to no candidates', parseBashProbeOutput('').length === 0 && parseBashProbeOutput(undefined).length === 0)
}

// ---------------------------------------------------------------------------
console.log('\n[verifyBashExecutable]')

/** A settled exec outcome shaped like the engine's. */
function outcomeOf (stdout, extra = {}) {
  return { success: true, exitCode: 0, timedOut: false, truncated: false, stdout, stderr: '', durationMs: 0, ...extra }
}

/** An engine double that records every exec command and answers from a script. */
function engineDouble (steps) {
  const calls = []
  const diagnostics = []
  const engine = {
    diagnostics: { record: (kind, message, meta) => { diagnostics.push({ kind, message, meta }) } },
    async exec (_alias, command, options) {
      calls.push({ command, options })
      const step = steps.shift()
      if (step === undefined) throw new Error(`unexpected exec: ${command}`)
      return outcomeOf(step.stdout ?? '', step)
    },
  }
  return { engine, calls, diagnostics }
}

{
  const { engine, calls } = engineDouble([{ stdout: 'GNU bash, version 5.2.26(1)-release (x86_64-pc-msys)\r\n' }])
  const verified = await verifyBashExecutable(engine, 'w', 'C:\\Program Files\\Git\\bin\\bash.exe')
  check('a bash that answers --version verifies with its first output line',
    verified?.version === 'GNU bash, version 5.2.26(1)-release (x86_64-pc-msys)', JSON.stringify(verified))
  check('the verification really executes the candidate',
    calls[0].command === '"C:\\Program Files\\Git\\bin\\bash.exe" --version', calls[0].command)
}

{
  const { engine, calls } = engineDouble([{ stdout: 'GNU bash, version 5.1.16\r\n' }])
  const prefix = bashLaunchPrefix('C:\\payload\\bash\\1.5.0')
  await verifyBashExecutable(engine, 'w', 'C:\\payload\\bash\\1.5.0\\winuxcmd\\usr\\bin\\bash.exe', { prefix })
  check('a provisioned candidate carries the cmd PATH prefix in front of the launcher',
    calls[0].command.startsWith(prefix) && calls[0].command.endsWith('\\bash.exe" --version'), calls[0].command)
}

{
  const { engine } = engineDouble([
    { stdout: '', success: false, exitCode: 1 },
    { stdout: 'INFO: could not find the file', exitCode: 127 },
    { stdout: 'generated-by-some-other-tool v2', exitCode: 0 },
  ])
  check('a failing exec does not verify', await verifyBashExecutable(engine, 'w', 'C:\\dead\\bash.exe') === undefined)
  check('a non-zero exec does not verify even when the output mentions nothing useful',
    await verifyBashExecutable(engine, 'w', 'C:\\missing\\bash.exe') === undefined)
  check('success alone is not proof — the output must name bash',
    await verifyBashExecutable(engine, 'w', 'C:\\mystery\\bash.exe') === undefined)
}

// ---------------------------------------------------------------------------
console.log('[resolveWinBash]')

const PINNED = 'C:\\bash\\pinned\\bash.exe'
const PROVISIONED_PATH = 'C:\\Users\\u\\.dsh-ssh-workspace\\bash\\1.5.0\\winuxcmd\\usr\\bin\\bash.exe'
const PROVISIONED_ROOT = 'C:\\Users\\u\\.dsh-ssh-workspace\\bash\\1.5.0'
const provisionedOf = () => ({ path: PROVISIONED_PATH, root: PROVISIONED_ROOT, version: '1.5.0', sha256: 'a'.repeat(64), provisionedAt: 1_700_000_000_000 })
const BASH_VERSION = { stdout: 'GNU bash, version 5.2.26(1)-release\r\n' }

{
  // Rung 1: a working pin answers for itself and nothing else is consulted.
  const { engine, calls } = engineDouble([BASH_VERSION])
  const bash = await resolveWinBash(engine, 'w', { entry: { bashPath: PINNED } })
  check('a verified bashPath answers as the pinned rung',
    bash?.path === PINNED && bash?.source === 'pinned' && bash.version.startsWith('GNU bash'), JSON.stringify(bash))
  check('the pinned rung sends ONLY the --version (no sweep)',
    calls.length === 1 && calls[0].command === `"${PINNED}" --version`, JSON.stringify(calls.map(call => call.command)))
}

{
  // Rung degrade: a stale pin must not fail the host — it falls to the
  // provisioned copy WITH a diagnostics entry, and the dispatch keeps working.
  const { engine, calls, diagnostics } = engineDouble([
    { stdout: '', success: false, exitCode: 1 }, // the stale pin fails to answer
    BASH_VERSION, // the provisioned copy answers
  ])
  const bash = await resolveWinBash(engine, 'w', { entry: { bashPath: PINNED, bashProvisioned: provisionedOf() } })
  check('a stale pin degrades to the provisioned rung',
    bash?.path === PROVISIONED_PATH && bash?.source === 'provisioned', JSON.stringify(bash))
  check('the degrade is recorded as a diagnostics entry, not an error',
    diagnostics.length === 1 && diagnostics[0].kind === KINDS.degraded && diagnostics[0].message.includes(PINNED),
    JSON.stringify(diagnostics))
  check('the provisioned rung verifies with the payload PATH prefix',
    calls[1].command.startsWith(`set "PATH=${PROVISIONED_ROOT};${PROVISIONED_ROOT}\\winuxcmd\\usr\\bin;%PATH%" & `),
    calls[1].command)
}

{
  // Rung 3: both explicit rungs dead → one sweep, then the first candidate
  // that answers `--version` for real wins as `detected`.
  const { engine, calls } = engineDouble([
    { stdout: '', success: false, exitCode: 1 }, // pinned fails
    { stdout: '', success: false, exitCode: 1 }, // provisioned fails
    { stdout: '@@C:\\msys64\\usr\\bin\\bash.exe\r\nC:\\Windows\\System32\\bash.exe\r\n', code: 0 }, // the sweep
    BASH_VERSION, // the first candidate answers
  ])
  const bash = await resolveWinBash(engine, 'w', { entry: { bashPath: PINNED, bashProvisioned: provisionedOf() } })
  check('a fully degraded pair falls through to detection',
    bash?.path === 'C:\\msys64\\usr\\bin\\bash.exe' && bash?.source === 'detected', JSON.stringify(bash))
  check('the WSL spelling surfaced by the sweep is skipped, the msys64 candidate is executed',
    calls[3].command === '"C:\\msys64\\usr\\bin\\bash.exe" --version', JSON.stringify(calls.map(call => call.command)))
}

{
  // The verify limit: a sweep naming many candidates executes at most
  // WIN_BASH_VERIFY_LIMIT of them, in list order.
  const sweep = Array.from({ length: WIN_BASH_VERIFY_LIMIT + 2 }, (_, index) => `@@C:\\cand\\${index}\\bash.exe`).join('\r\n')
  const { engine, calls } = engineDouble([
    { stdout: sweep, code: 0 },
    ...Array.from({ length: WIN_BASH_VERIFY_LIMIT }, () => ({ stdout: '', success: false, exitCode: 1 })),
  ])
  const bash = await resolveWinBash(engine, 'w', { entry: {} })
  check('a sweep with no working candidate resolves to none (cmd fallback)', bash === undefined, JSON.stringify(bash))
  check('detection executes at most WIN_BASH_VERIFY_LIMIT candidates, in list order',
    calls.length === 1 + WIN_BASH_VERIFY_LIMIT
    && calls[1].command === `"C:\\cand\\0\\bash.exe" --version`
    && calls.at(-1).command === `"C:\\cand\\${WIN_BASH_VERIFY_LIMIT - 1}\\bash.exe" --version`,
    JSON.stringify(calls.map(call => call.command)))
  check('WIN_BASH_VERIFY_LIMIT is 4', WIN_BASH_VERIFY_LIMIT === 4, String(WIN_BASH_VERIFY_LIMIT))
}

// ---------------------------------------------------------------------------
console.log('\n[bashCwdOf / bashLaunchPrefix]')

for (const [input, expected] of [
  ['/D:/code', 'D:/code'],
  ['/D:/', 'D:/'],
  ['/D:', 'D:/'],
  ['/c/users/u', '/c/users/u'],
  ['D:\\code\\repo', 'D:/code/repo'],
  ['/home/u/proj', '/home/u/proj'],
  ['', ''],
]) {
  check(`bashCwdOf(${JSON.stringify(input)}) → ${JSON.stringify(expected)}`, bashCwdOf(input) === expected, JSON.stringify(bashCwdOf(input)))
}

{
  const prefix = bashLaunchPrefix('C:\\Users\\u\\.dsh-ssh-workspace\\bash\\1.5.0\\')
  check('the prefix sets PATH to the tree root, its bin, then the old PATH',
    prefix === `set "PATH=C:\\Users\\u\\.dsh-ssh-workspace\\bash\\1.5.0;C:\\Users\\u\\.dsh-ssh-workspace\\bash\\1.5.0\\winuxcmd\\usr\\bin;%PATH%" & `,
    JSON.stringify(prefix))
  check('the prefix ends with `& ` so a launcher can be prepended verbatim', prefix.endsWith(' & '))
  check('forward separators in the root pass through and doubled separators collapse',
    bashLaunchPrefix('C:/root//') === `set "PATH=C:/root;C:/root\\winuxcmd\\usr\\bin;%PATH%" & `,
    JSON.stringify(bashLaunchPrefix('C:/root//')))
}

// ---------------------------------------------------------------------------
console.log('\n[store: bashPath / bashProvisioned]')

for (const [input, expected] of [
  ['C:\\Git\\bin\\bash.exe', 'C:\\Git\\bin\\bash.exe'],
  ['  C:\\Git\\bin\\bash.exe  ', 'C:\\Git\\bin\\bash.exe'],
  ['C:\\Git\\bin\\', 'C:\\Git\\bin'],
  ['C:\\Git\\bin\\\\', 'C:\\Git\\bin'],
  ['', undefined],
  ['   ', undefined],
  [undefined, undefined],
  [null, undefined],
]) {
  check(`normalizeHostBashPath(${JSON.stringify(input)}) → ${JSON.stringify(expected)}`,
    normalizeHostBashPath(input) === expected, JSON.stringify(normalizeHostBashPath(input)))
}

{
  let quoted
  let newline
  try { normalizeHostBashPath('C:\\ba"sh.exe') } catch (error) { quoted = error.message }
  try { normalizeHostBashPath('C:\\bash.exe\n--evil') } catch (error) { newline = error.message }
  check('a double quote is rejected with its own message',
    quoted?.includes('bashPath must not contain quotes or line breaks'), String(quoted))
  check('a line break is rejected (a launch line cannot survive one)',
    newline?.includes('bashPath must not contain quotes or line breaks'), String(newline))
}

{
  const good = { path: PROVISIONED_PATH, root: PROVISIONED_ROOT, version: '1.5.0', sha256: 'a'.repeat(64), provisionedAt: 1_700_000_000_000 }
  check('a well-formed bashProvisioned normalizes to itself',
    JSON.stringify(normalizeBashProvisioned(good)) === JSON.stringify(good), JSON.stringify(normalizeBashProvisioned(good)))
  for (const broken of [
    undefined, null, 'nope', 42, [],
    { ...good, path: '' },
    { ...good, root: undefined },
    { ...good, version: '' },
    { ...good, sha256: undefined },
    { ...good, provisionedAt: 'not-a-number' },
    { path: PROVISIONED_PATH, root: PROVISIONED_ROOT, version: '1.5.0', sha256: 'a'.repeat(64) },
  ]) {
    check(`an unusable bashProvisioned (${Array.isArray(broken) ? 'an array' : JSON.stringify(broken)?.slice(0, 40) ?? String(broken)}) degrades to absent`,
      normalizeBashProvisioned(broken) === undefined, JSON.stringify(normalizeBashProvisioned(broken)))
  }
}

{
  // The public rejection boundary is the store API itself (validateHostEntry
  // is module-private, and the normalizer coerces before it could fire): the
  // documented contract is trim / strip / quote-newline rejection / blank
  // clears, all driven through create and update here.
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const home = mkdtempSync(path.join(tmpdir(), 'dsh-win-bash-store-'))
  try {
    const store = new HostConfigStore(path.join(home, 'store.json'))
    store.create({ alias: 'w', host: 'w.example', user: 'u', auth: { kind: 'agent' }, bashPath: 'C:\\Git\\bin\\bash.exe\\' })
    check('create stores the normalized (trimmed, trailing-separator-stripped) path',
      store.find('w').bashPath === 'C:\\Git\\bin\\bash.exe', JSON.stringify(store.find('w')))
    store.update('w', { bashPath: '   ' })
    check('a blank update clears the field (the editor always posts the key)',
      !Object.hasOwn(store.find('w'), 'bashPath'), JSON.stringify(store.find('w')))
    let quoted
    let newline
    try { store.update('w', { bashPath: 'C:\\ba"sh.exe' }) } catch (error) { quoted = error.message }
    try { store.create({ alias: 'w2', host: 'h.example', user: 'u', auth: { kind: 'agent' }, bashPath: 'C:\\bash.exe\n--evil' }) } catch (error) { newline = error.message }
    check('a quoted path is refused at the update boundary',
      quoted?.includes('bashPath must not contain quotes or line breaks'), String(quoted))
    check('a line break is refused at the create boundary',
      newline?.includes('bashPath must not contain quotes or line breaks'), String(newline))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
