/**
 * The pack-time payload stager (`scripts/stage-niubash.mjs`), driven as a child
 * process exactly the way npm's `prepack` lifecycle drives it.
 *
 * The script's own guarantees are the contract under test:
 *
 *   1. a REAL run (no `--dry-run`) stages a local release archive into
 *      `runtime/niubash/`, discovers the archive's single root prefix and its
 *      bash executable's relative path + digest, and freezes all of it into
 *      `manifest.json` — plus the identity fields (release tag, version, URL,
 *      archive sha256 and exact byte size) the runtime pin needs;
 *   2. staging is IDEMPOTENT: an already-staged archive whose size and sha256
 *      still match its manifest short-circuits (re-running prepack never
 *      re-copies), while a tampered staged archive is detected and restaged;
 *   3. OFFLINE SAFE: a dry-run (`--dry-run` argv or `npm_config_dry_run`, the
 *      spelling npm sets for `npm pack --dry-run`) NEVER touches the network —
 *      every offline shape (nothing staged / consistent / archive missing /
 *      size mismatch) answers with a notice and exit 0;
 *   4. FAIL LOUD: a real run with neither a local archive pointer nor a
 *      network answers exit 1, and a bad asset (non-gzip bytes, an archive
 *      without the bash executable, a pointer that is not a file, a file name
 *      that is not a niubash win-x64 package name) is refused before any
 *      manifest is written;
 *   5. SINGLE ROOT: an archive whose members share no single top-level root
 *      directory (members sitting at the archive root, or spread over several
 *      distinct top-level roots) is refused with exit 1 and an error naming
 *      the layout problem — no manifest is written and a payload an earlier
 *      run already staged survives byte-identical (the regression asserts the
 *      fix that turned this documented requirement into real code).
 *
 * Everything runs offline: the archive is a tiny synthetic tar.gz built here,
 * the network is replaced by `tests/support/no-net-preload.cjs` (which records
 * every `fetch` attempt into a log file and throws), and the script runs from a
 * per-case sandbox copy so the repo's own `runtime/` is never touched.
 *
 * Run: node tests/stage-niubash-smoke.mjs
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stageScript = path.join(pluginRoot, 'scripts', 'stage-niubash.mjs')
const noNetPreload = path.join(pluginRoot, 'tests', 'support', 'no-net-preload.cjs')

let passed = 0
let failures = 0
function check (label, ok, detail) {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`) } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

console.log('\n=== stage niubash smoke ===\n')

// ---------------------------------------------------------------------------
// Fixtures: a synthetic niubash-shaped archive, small enough to stage instantly.
// ---------------------------------------------------------------------------

const BASH_BYTES = Buffer.from('#!/bin/sh\nsynthetic niubash payload\n')
const BASH_SHA = createHash('sha256').update(BASH_BYTES).digest('hex')
const README_BYTES = Buffer.from('synthetic payload readme\n')
const ASSET_NAME = 'niubash-v9.9.9-win-x64.tar.gz'
const GOOD_PREFIX = 'niubash-v9.9.9-win-x64/'
const EXE_RELATIVE = 'winuxcmd/usr/bin/bash.exe'

/** One 512-byte tar header, ustar-flavored enough for the script's walk. */
function tarEntry (name, { type = '0', data = Buffer.alloc(0) } = {}) {
  const header = Buffer.alloc(512)
  header.write(name.slice(0, 100), 0, 'utf8')
  header.write(type, 156, 'utf8')
  header.write(`${data.length.toString(8)}\0`, 124, 'utf8')
  header.write('ustar\0', 257, 'utf8')
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512)
  return Buffer.concat([header, data, padding])
}

function tarGzOf (...entries) {
  return gzipSync(Buffer.concat(entries))
}

/** The well-shaped payload archive: one root, bash.exe inside, an extra file. */
function goodArchive () {
  return tarGzOf(
    tarEntry(GOOD_PREFIX.replace(/\/$/u, ''), { type: '5' }),
    tarEntry(`${GOOD_PREFIX}${EXE_RELATIVE}`, { data: BASH_BYTES }),
    tarEntry(`${GOOD_PREFIX}README.txt`, { data: README_BYTES }),
  )
}

// ---------------------------------------------------------------------------
// Harness: a sandbox whose scripts/ copy IS the repo script (byte-verified), a
// runtime/ tree that lives only in the sandbox, and a no-network child env.
// ---------------------------------------------------------------------------

/** A fresh sandbox: <dir>/scripts/stage-niubash.mjs (copy), nothing else. */
function sandbox () {
  const dir = path.join(tmpdir(), `dsh-stage-niubash-${Math.random().toString(36).slice(2)}-`)
  mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  const copy = path.join(dir, 'scripts', 'stage-niubash.mjs')
  copyFileSync(stageScript, copy)
  check('the sandboxed script is byte-identical to the repo script',
    readFileSync(copy).equals(readFileSync(stageScript)), copy)
  return dir
}

/**
 * Run the staged script inside a sandbox.
 *
 * @param {string} dir - the sandbox root (the script derives `runtime/` from
 *   its own location, so the sandbox isolates the repo tree).
 * @param {object} [options] - run options.
 * @param {string[]} [options.args] - extra argv (e.g. `--dry-run`).
 * @param {Record<string, string>} [options.env] - extra env (NIUBASH_ARCHIVE,
 *   npm_config_dry_run).
 * @param {boolean} [options.noNet] - install the fetch blocker (default true).
 * @returns {{status: number, stdout: string, stderr: string, fetchLog: Array<{url: string}>}}
 *   the child's outcome plus the parsed network-attempt log.
 */
function runStage (dir, { args = [], env = {}, noNet = true } = {}) {
  const fetchLog = path.join(dir, 'fetch-log.jsonl')
  rmSync(fetchLog, { force: true })
  // Dry-run is a PER-CASE decision: `npm run check` exports
  // npm_config_dry_run=true to the whole suite, and an inherited value would
  // silently turn every real-staging case into a dry run. Strip it so only
  // the cases that name it run offline.
  const { npm_config_dry_run: _inheritedDryRun, ...restEnv } = process.env
  const childEnv = {
    ...restEnv,
    ...env,
    NO_NET_FETCH_LOG: fetchLog,
  }
  if (noNet) childEnv.NODE_OPTIONS = `--require ${JSON.stringify(noNetPreload)}`
  const result = spawnSync(process.execPath, [path.join(dir, 'scripts', 'stage-niubash.mjs'), ...args], {
    cwd: dir,
    env: childEnv,
    encoding: 'utf8',
  })
  const fetchAttempts = existsSync(fetchLog)
    ? readFileSync(fetchLog, 'utf8').split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line))
    : []
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', fetchLog: fetchAttempts }
}

const manifestOf = dir => JSON.parse(readFileSync(path.join(dir, 'runtime', 'niubash', 'manifest.json'), 'utf8'))

/** An offline archive copy for NIUBASH_ARCHIVE, staged under <dir>/incoming/. */
function localArchive (dir, bytes, name = ASSET_NAME) {
  mkdirSync(path.join(dir, 'incoming'), { recursive: true })
  const file = path.join(dir, 'incoming', name)
  writeFileSync(file, bytes)
  return file
}

// ---------------------------------------------------------------------------
console.log('[a real run stages the archive and freezes the manifest]')

{
  const dir = sandbox()
  try {
    const archive = localArchive(dir, goodArchive())
    const outcome = runStage(dir, { env: { NIUBASH_ARCHIVE: archive } })
    check('staging a local archive exits 0', outcome.status === 0, `exit ${outcome.status} — ${outcome.stderr}`)
    check('staging never touches the network when NIUBASH_ARCHIVE is set', outcome.fetchLog.length === 0, JSON.stringify(outcome.fetchLog))
    check('the manifest lands at runtime/niubash/manifest.json', existsSync(path.join(dir, 'runtime', 'niubash', 'manifest.json')))

    const manifest = manifestOf(dir)
    const expected = {
      schemaVersion: 1,
      name: 'bash',
      platform: 'win',
      arch: 'x64',
      upstream: 'niubash',
      upstreamUrl: 'https://github.com/unixwin/niubash',
      releaseTag: 'v9.9.9',
      version: '9.9.9',
      assetFile: ASSET_NAME,
      url: `https://github.com/unixwin/niubash/releases/download/v9.9.9/${ASSET_NAME}`,
      sha256: createHash('sha256').update(goodArchive()).digest('hex'),
      bytes: goodArchive().length,
      extractor: 'tar.gz',
      prefix: GOOD_PREFIX,
      executableRelativePath: EXE_RELATIVE,
      executableSha256: BASH_SHA,
    }
    check('the manifest freezes every pin field the runtime validates',
      Object.entries(expected).every(([field, value]) => manifest[field] === value),
      JSON.stringify({ expected, actual: manifest }))
    check('stagedAt is an ISO instant', typeof manifest.stagedAt === 'string' && !Number.isNaN(Date.parse(manifest.stagedAt)), String(manifest.stagedAt))

    const stagedArchive = path.join(dir, 'runtime', 'niubash', ASSET_NAME)
    check('the archive is staged under runtime/niubash/ byte-exact',
      existsSync(stagedArchive) && readFileSync(stagedArchive).equals(goodArchive()))
    const raw = readFileSync(path.join(dir, 'runtime', 'niubash', 'manifest.json'), 'utf8')
    check('the manifest is pretty-printed JSON with one trailing newline', raw === `${JSON.stringify(manifest, null, 2)}\n`, JSON.stringify(raw.slice(-40)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

{
  // A leftover archive from an earlier staging must be swept: the package
  // carries exactly one payload, the one the manifest names.
  const dir = sandbox()
  try {
    const stale = tarGzOf(tarEntry('old-pkg/README.txt', { data: Buffer.from('stale') }))
    mkdirSync(path.join(dir, 'runtime', 'niubash'), { recursive: true })
    writeFileSync(path.join(dir, 'runtime', 'niubash', 'niubash-v1.0.0-win-x64.tar.gz'), stale)
    const archive = localArchive(dir, goodArchive())
    const outcome = runStage(dir, { env: { NIUBASH_ARCHIVE: archive } })
    check('staging over an older payload exits 0', outcome.status === 0, outcome.stderr)
    check('the stale staged archive is swept',
      !existsSync(path.join(dir, 'runtime', 'niubash', 'niubash-v1.0.0-win-x64.tar.gz'))
      && outcome.stdout.includes('removed stale staged archive'), outcome.stdout)
    check('only the named payload remains', readFileSync(path.join(dir, 'runtime', 'niubash', ASSET_NAME)).equals(goodArchive()))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n[idempotence and restaging]')

{
  const dir = sandbox()
  try {
    const archive = localArchive(dir, goodArchive())
    const first = runStage(dir, { env: { NIUBASH_ARCHIVE: archive } })
    check('the first staging run exits 0', first.status === 0, first.stderr)
    const before = readFileSync(path.join(dir, 'runtime', 'niubash', 'manifest.json'), 'utf8')

    const second = runStage(dir, { env: { NIUBASH_ARCHIVE: archive } })
    check('a second staging run short-circuits with exit 0', second.status === 0, second.stderr)
    check('the short-circuit names itself ("already staged")', second.stdout.includes('already staged'), second.stdout)
    check('the short-circuit leaves the manifest byte-identical (stagedAt untouched)',
      readFileSync(path.join(dir, 'runtime', 'niubash', 'manifest.json'), 'utf8') === before)

    // A staged archive that no longer matches its manifest is restaged, not
    // silently shipped.
    const staged = path.join(dir, 'runtime', 'niubash', ASSET_NAME)
    const tampered = Buffer.from(readFileSync(staged))
    tampered[tampered.length - 1] ^= 0xff
    writeFileSync(staged, tampered)
    const third = runStage(dir, { env: { NIUBASH_ARCHIVE: archive } })
    check('a tampered staged archive is detected and restaged', third.status === 0 && third.stderr.includes('does not match its manifest'), third.stderr)
    check('the restaged archive is the fixture again', readFileSync(staged).equals(goodArchive()))
    check('the restaged manifest replaces the old one (new stagedAt)',
      readFileSync(path.join(dir, 'runtime', 'niubash', 'manifest.json'), 'utf8') !== before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n[dry-run never touches the network and answers exit 0]')

{
  const dir = sandbox()
  try {
    // npm pack --dry-run sets npm_config_dry_run; the argv spelling must work
    // standalone too.
    for (const [label, options] of [
      ['npm_config_dry_run=1 (the npm pack --dry-run spelling)', { env: { npm_config_dry_run: '1' } }],
      ['--dry-run (the standalone argv spelling)', { args: ['--dry-run'] }],
    ]) {
      const outcome = runStage(dir, options)
      check(`${label}: nothing staged → exit 0`, outcome.status === 0, `exit ${outcome.status} — ${outcome.stderr}`)
      // The nothing-staged notice is a console.warn (stderr), by design — it
      // is a notice, not a failure, and must not fail `npm run check`.
      check(`${label}: the notice says the package falls back to the bundled pin`,
        `${outcome.stdout}${outcome.stderr}`.includes('nothing staged') && `${outcome.stdout}${outcome.stderr}`.includes('v1.5.0'),
        `${outcome.stdout}${outcome.stderr}`)
      check(`${label}: no network attempt`, outcome.fetchLog.length === 0, JSON.stringify(outcome.fetchLog))
      check(`${label}: no runtime/ tree is created`, !existsSync(path.join(dir, 'runtime')), 'runtime/ appeared during a dry run')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

{
  const dir = sandbox()
  try {
    const archive = localArchive(dir, goodArchive())
    check('precondition: the staging run succeeded', runStage(dir, { env: { NIUBASH_ARCHIVE: archive } }).status === 0)

    // The idempotence short-circuit runs BEFORE the dry-run validator, so a
    // consistent staged payload never reaches the "consistent" message —
    // `npm pack --dry-run` after a real stage answers "already staged". That
    // ordering is exactly what keeps `npm run check` offline and green.
    const consistent = runStage(dir, { env: { npm_config_dry_run: 'true' } })
    check('a consistent staged payload short-circuits with exit 0 (idempotence outranks dry-run)',
      consistent.status === 0 && consistent.stdout.includes('already staged'), `${consistent.status} — ${consistent.stdout}${consistent.stderr}`)
    check('the offline check stays offline', consistent.fetchLog.length === 0, JSON.stringify(consistent.fetchLog))

    rmSync(path.join(dir, 'runtime', 'niubash', ASSET_NAME))
    const missing = runStage(dir, { env: { npm_config_dry_run: '1' } })
    check('a manifest whose archive is missing answers exit 0 with the fallback notice',
      missing.status === 0 && missing.stderr.includes('not staged'), `${missing.status} — ${missing.stderr}`)
    check('the missing-archive check stays offline', missing.fetchLog.length === 0, JSON.stringify(missing.fetchLog))

    // Size mismatch (a truncated archive) is the other degrade-with-notice
    // shape: the manifest stays, the package would fall back to the pin.
    writeFileSync(path.join(dir, 'runtime', 'niubash', ASSET_NAME), goodArchive().subarray(0, 32))
    const truncated = runStage(dir, { env: { npm_config_dry_run: 'true' } })
    check('a size-mismatched staged archive answers exit 0 with the fallback notice',
      truncated.status === 0 && truncated.stderr.includes('fall back'), `${truncated.status} — ${truncated.stderr}`)
    check('the mismatch check stays offline', truncated.fetchLog.length === 0, JSON.stringify(truncated.fetchLog))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n[a real run with no local archive reaches for the release API]')

{
  const dir = sandbox()
  try {
    const outcome = runStage(dir, {})
    check('no archive pointer + no network → exit 1', outcome.status === 1, `exit ${outcome.status} — ${outcome.stdout}`)
    check('the refusal explains both remedies (re-run online / NIUBASH_ARCHIVE)',
      outcome.stderr.includes('could not read the latest niubash release') && outcome.stderr.includes('NIUBASH_ARCHIVE'), outcome.stderr)
    check('exactly one network attempt was made, to the releases API',
      outcome.fetchLog.length === 1 && outcome.fetchLog[0].url === 'https://api.github.com/repos/unixwin/niubash/releases/latest',
      JSON.stringify(outcome.fetchLog))
    check('no manifest is written after the failed fetch', !existsSync(path.join(dir, 'runtime', 'niubash', 'manifest.json')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n[bad assets are refused before any manifest is written]')

{
  const dir = sandbox()
  try {
    const notGzip = localArchive(dir, Buffer.from('plain text, not gzip at all\n'))
    const outcome = runStage(dir, { env: { NIUBASH_ARCHIVE: notGzip } })
    check('a non-gzip asset refuses with exit 1', outcome.status === 1, `exit ${outcome.status}`)
    check('the non-gzip refusal writes no manifest', !existsSync(path.join(dir, 'runtime', 'niubash', 'manifest.json')))
    check('the non-gzip refusal names an error', /Error|gzip|header/u.test(outcome.stderr), outcome.stderr.slice(0, 200))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

{
  const dir = sandbox()
  try {
    const noBash = localArchive(dir, tarGzOf(
      tarEntry('niubash-v9.9.9-win-x64', { type: '5' }),
      tarEntry('niubash-v9.9.9-win-x64/README.txt', { data: README_BYTES }),
    ))
    const outcome = runStage(dir, { env: { NIUBASH_ARCHIVE: noBash } })
    check('an archive without bash.exe refuses with exit 1', outcome.status === 1, `exit ${outcome.status}`)
    check('the no-bash refusal carries its own wording',
      outcome.stderr.includes('carries no bash.exe member'), outcome.stderr)
    check('the no-bash refusal writes no manifest', !existsSync(path.join(dir, 'runtime', 'niubash', 'manifest.json')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

{
  const dir = sandbox()
  try {
    const missing = path.join(dir, 'incoming', 'not-there.tar.gz')
    const outcome = runStage(dir, { env: { NIUBASH_ARCHIVE: missing } })
    check('a NIUBASH_ARCHIVE that is not a readable file refuses with exit 1',
      outcome.status === 1 && outcome.stderr.includes('does not name a readable file'), `${outcome.status} — ${outcome.stderr}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

{
  const dir = sandbox()
  try {
    const wrongName = localArchive(dir, goodArchive(), 'some-other-tool-v1.tar.gz')
    const outcome = runStage(dir, { env: { NIUBASH_ARCHIVE: wrongName } })
    check('a file name that is not a niubash win-x64 package refuses with exit 1',
      outcome.status === 1 && outcome.stderr.includes('does not look like a niubash win-x64'), `${outcome.status} — ${outcome.stderr}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

{
  // The single-root requirement is REAL code now (999f24f): inspectArchive
  // used to answer exit 0 with a `prefix: ""` manifest for both shapes below
  // (the membership check `!name.startsWith('')` can never fire). Each must
  // be refused loudly — exit 1, an error naming the layout problem, and no
  // rewrite of a payload an earlier run already staged: the refusal happens
  // before the copy, the stale sweep, and the manifest write, so nothing in
  // runtime/ may move.
  const multiRoot = tarGzOf(
    tarEntry('a', { type: '5' }),
    tarEntry('a/bash.exe', { data: BASH_BYTES }),
    tarEntry('b', { type: '5' }),
    tarEntry('b/tool.exe', { data: Buffer.from('tool') }),
  )
  const flatRoot = tarGzOf(
    tarEntry('bash.exe', { data: BASH_BYTES }),
    tarEntry('readme.txt', { data: README_BYTES }),
  )
  for (const [label, bytes] of [
    ['a two-root archive (a/…, b/…)', multiRoot],
    ['an archive whose members sit at the root (no common directory)', flatRoot],
  ]) {
    const dir = sandbox()
    try {
      // Pre-stage a GOOD payload first. With a CONSISTENT stage the
      // idempotence short-circuit outranks the pointer — a bad
      // NIUBASH_ARCHIVE never even reaches the inspector — which is a
      // designed precedence worth pinning, and the reason the refusal case
      // below tampers the staged archive first: a stage that is present but
      // inconsistent is the shape that actually reaches inspectArchive.
      check(`${label}: precondition — a good archive stages first`,
        runStage(dir, { env: { NIUBASH_ARCHIVE: localArchive(dir, goodArchive()) } }).status === 0, 'the precondition staging failed')
      const manifestBefore = readFileSync(path.join(dir, 'runtime', 'niubash', 'manifest.json'))
      const stagedGood = readFileSync(path.join(dir, 'runtime', 'niubash', ASSET_NAME))
      const consistent = runStage(dir, { env: { NIUBASH_ARCHIVE: localArchive(dir, bytes) } })
      check(`${label}: a consistent stage short-circuits without inspecting the new pointer (idempotence outranks)`,
        consistent.status === 0 && consistent.stdout.includes('already staged')
        && readFileSync(path.join(dir, 'runtime', 'niubash', 'manifest.json')).equals(manifestBefore)
        && readFileSync(path.join(dir, 'runtime', 'niubash', ASSET_NAME)).equals(stagedGood),
        `${consistent.status} — ${consistent.stdout}${consistent.stderr}`)

      // Stage present but inconsistent (the suite's restaging shape): the
      // short-circuit falls through and the bad archive reaches the
      // inspector. The refusal must touch nothing that is already there.
      const stagedPath = path.join(dir, 'runtime', 'niubash', ASSET_NAME)
      const tampered = Buffer.from(readFileSync(stagedPath))
      tampered[tampered.length - 1] ^= 0xff
      writeFileSync(stagedPath, tampered)
      const outcome = runStage(dir, { env: { NIUBASH_ARCHIVE: localArchive(dir, bytes) } })
      check(`${label} is rejected with exit 1`, outcome.status === 1, `exit ${outcome.status} — ${outcome.stderr.slice(0, 200)}`)
      check(`${label}: the refusal names the single-root requirement`,
        outcome.stderr.includes('no single root directory'), outcome.stderr.slice(0, 300))
      check(`${label}: the existing manifest is left byte-identical (never rewritten with a prefix:"" shape)`,
        readFileSync(path.join(dir, 'runtime', 'niubash', 'manifest.json')).equals(manifestBefore),
        'the staged manifest changed during a refused staging run')
      check(`${label}: the existing staged archive survives byte-identical (no sweep, no overwrite)`,
        readFileSync(stagedPath).equals(tampered),
        'the staged archive changed during a refused staging run')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
