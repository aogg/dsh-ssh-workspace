/**
 * The pinned bash payload: the archive reader's guards, the staged tree, the
 * receipt, and the provisioner's gates.
 *
 * The provisioner is the one place this plugin moves a whole program tree
 * onto a host, so every layer refuses to trust bytes it has not proven:
 * member names that could escape the extraction target, archive members
 * outside the pin's root prefix, member types the pin never uses, a hardlink
 * whose target never appeared, an executable whose digest differs from the
 * pin, and archive bytes whose digest or size differs from the pin. Each
 * guard gets its own failure here.
 *
 * Everything runs OFFLINE on a bare (or stubbed) checkout: the archive is a
 * tiny synthetic tar.gz built in-memory, the pin is a local stand-in whose
 * digests are computed from those bytes, and the payloadPath gate is fed
 * local files. No download, no SSH, no SFTP beyond refused/before-the-wire
 * recording doubles.
 *
 * Run: node tests/bash-payload-smoke.mjs
 */

import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// bash-payload.js reaches the shared SFTP primitives, which resolve the DSH
// peer packages; without an assembled (or generated stub) tree there is
// nothing to resolve against.
const coreRoot = process.env.DSH_CORE_ROOT
if (!coreRoot) {
  console.log('\n=== bash payload smoke ===\n')
  console.log('  SKIP  DSH_CORE_ROOT is not set (bash-payload.js needs @deepseek-ai/dsh-fs)')
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

const { BASH_PAYLOAD_PIN, bashReceiptText, bashExePathOf, provisionWinBash, readBashTarGz, listBashTarGzMembers, safeBashMember, sha256File, stageBashTree } = await import(pathToFileURL(path.join(pluginRoot, 'lib/bash-payload.js')).href)

console.log('\n=== bash payload smoke ===\n')

// ---------------------------------------------------------------------------
console.log('[BASH_PAYLOAD_PIN]')
//
// The pin is a supply-chain decision frozen in source; these are the
// invariants every consumer relies on, not the values themselves.

{
  check('the pin is complete: url, digest, size, extractor, prefix, executable and its digest',
    typeof BASH_PAYLOAD_PIN.url === 'string' && /^[0-9a-f]{64}$/u.test(BASH_PAYLOAD_PIN.sha256)
    && Number.isSafeInteger(BASH_PAYLOAD_PIN.bytes) && BASH_PAYLOAD_PIN.bytes > 0
    && BASH_PAYLOAD_PIN.extractor === 'tar.gz'
    && BASH_PAYLOAD_PIN.prefix.endsWith('/')
    && !BASH_PAYLOAD_PIN.executableRelativePath.includes('\\')
    && !BASH_PAYLOAD_PIN.executableRelativePath.startsWith('/')
    && /^[0-9a-f]{64}$/u.test(BASH_PAYLOAD_PIN.executableSha256),
    JSON.stringify(BASH_PAYLOAD_PIN))
  check('the url names the asset file', BASH_PAYLOAD_PIN.url.endsWith(`/${BASH_PAYLOAD_PIN.assetFile}`), BASH_PAYLOAD_PIN.url)
  check('the pin is frozen (consumers cannot widen what is trusted)', Object.isFrozen(BASH_PAYLOAD_PIN))
}

// ---------------------------------------------------------------------------
console.log('\n[safeBashMember]')
//
// One guard ahead of every filesystem write; each rejection class here is a
// Windows-flavored tar-slip spelling.

const MUST_REJECT = [
  ['an absolute POSIX path', '/etc/passwd'],
  ['a backslash spelling', 'a\\b.txt'],
  ['a drive-letter spelling', 'C:/evil.txt'],
  ['a parent-directory segment', 'a/../evil.txt'],
  ['a lone parent segment', '..'],
  ['an empty segment (doubled slash)', 'a//b.txt'],
  ['a dot segment', './x.txt'],
  ['a trailing dot', 'a/b.'],
  ['a trailing space', 'a/b '],
  ['a reserved device name', 'con'],
  ['a reserved device name with an extension', 'com1.txt'],
  ['another reserved device name', 'nul'],
  ['a control character', 'a\x01b'],
  ['a trailing slash (a directory spelled as a member)', 'a/b/'],
  ['the empty name', ''],
]
for (const [why, name] of MUST_REJECT) {
  let threw
  try { safeBashMember(name) } catch (error) { threw = error.message }
  check(`${why} (${JSON.stringify(name)}) is rejected`, threw?.includes('unsafe bash payload archive member'), String(threw))
}
check('a deep-but-honest relative member is accepted',
  safeBashMember('winuxcmd/usr/bin/bash.exe') === 'winuxcmd/usr/bin/bash.exe')
check('dots inside a name are not a rejection class', safeBashMember('a.b/c.d.txt') === 'a.b/c.d.txt')

// ---------------------------------------------------------------------------
console.log('\n[readBashTarGz]')
//
// A synthetic archive with the pin's shape: a root directory entry, the
// executable as a regular file, a duplicate parked as a HARDLINK to it (how
// the real payload packs duplicated executables), and an ordinary extra file.

/** The bytes every digest in the test pin is computed from. */
const EXE_BYTES = Buffer.from('#!/bin/bash\nsynthetic niubash payload bash\n')
const EXE_SHA = createHash('sha256').update(EXE_BYTES).digest('hex')
const README_BYTES = Buffer.from('synthetic payload readme\n')

/** A local stand-in for BASH_PAYLOAD_PIN with the same shape, tiny sizes. */
function testPin (overrides = {}) {
  return {
    name: 'bash', platform: 'win', arch: 'x64', version: '9.9.9-test',
    assetFile: 'synthetic.tar.gz', url: 'https://synthetic.invalid/synthetic.tar.gz',
    sha256: '0'.repeat(64), bytes: 0, extractor: 'tar.gz',
    prefix: 'pkg/',
    executableRelativePath: 'winuxcmd/usr/bin/bash.exe',
    executableSha256: EXE_SHA,
    ...overrides,
  }
}

/** One 512-byte tar header (ustar-flavored enough for the reader). */
function tarEntry (name, { type = '0', data = Buffer.alloc(0), link = '' } = {}) {
  const header = Buffer.alloc(512)
  header.write(name.slice(0, 100), 0, 'utf8')
  header.write(type, 156, 'utf8')
  if (link !== '') header.write(link.slice(0, 100), 157, 'utf8')
  header.write(`${data.length.toString(8)}\0`, 124, 'utf8')
  header.write('ustar\0', 257, 'utf8')
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512)
  return Buffer.concat([header, data, padding])
}

function tarGzOf (...entries) {
  return gzipSync(Buffer.concat(entries))
}

/**
 * One 512-byte tar header written the USTAR-SPLIT way — the spelling the
 * official niubash v1.5.0 asset uses for 7 of its 194 members: a path longer
 * than the 100-byte `name` field is stored as a `prefix` field (header
 * offset 345, 155 bytes — the leading directories) plus a `name` tail, and
 * the real path is `prefix + '/' + name`.
 *
 * @param {string} prefix - the leading directories; written verbatim when
 *   `prefixRaw` is given (the normalization cases spell it with surrounding
 *   blanks or a whitespace-only field), NUL-padded by the zeroed buffer
 *   otherwise.
 * @param {string} name - the tail; must fit the 100-byte field.
 * @param {object} [options] - same member options as {@link tarEntry}.
 * @returns {Buffer} the 512-byte header + data + padding.
 */
function tarSplitEntry (prefix, name, { type = '0', data = Buffer.alloc(0), link = '', prefixRaw } = {}) {
  const header = tarEntry(name, { type, data, link })
  header.write((prefixRaw ?? prefix).slice(0, 155), 345, 'utf8')
  return header
}

async function extract (archivePath, pin = testPin()) {
  return await readBashTarGz(archivePath, pin)
}

{
  const archive = path.join(mkdtempSync(path.join(tmpdir(), 'dsh-bash-payload-')), 'good.tar.gz')
  try {
    writeFileSync(archive, tarGzOf(
      tarEntry('pkg', { type: '5' }),
      tarEntry('pkg/winuxcmd/usr/bin/bash.exe', { data: EXE_BYTES }),
      tarEntry('pkg/README.txt', { data: README_BYTES }),
      tarEntry('pkg/winuxcmd/bin/bash.exe', { type: '1', link: 'pkg/winuxcmd/usr/bin/bash.exe' }),
    ))
    const { files, executableBytes, totalBytes } = await extract(archive)
    check('members come back with the pin prefix stripped',
      files.has('winuxcmd/usr/bin/bash.exe') && files.has('README.txt') && files.has('winuxcmd/bin/bash.exe') && !files.has('pkg/winuxcmd/usr/bin/bash.exe'),
      JSON.stringify([...files.keys()]))
    check('directory entries are consumed, not extracted', ![...files.keys()].some(name => name === '' || name.endsWith('/')), JSON.stringify([...files.keys()]))
    check('the executable bytes are byte-exact', executableBytes.equals(EXE_BYTES))
    check('a hardlink resolves to its earlier target\'s bytes',
      files.get('winuxcmd/bin/bash.exe').equals(EXE_BYTES))
    check('totalBytes counts regular files only (hardlinks add no bytes)',
      totalBytes === EXE_BYTES.length + README_BYTES.length, String(totalBytes))
  } finally {
    rmSync(path.dirname(archive), { recursive: true, force: true })
  }
}

{
  const archive = path.join(mkdtempSync(path.join(tmpdir(), 'dsh-bash-payload-')), 'hardlink-noprefix.tar.gz')
  try {
    writeFileSync(archive, tarGzOf(
      tarEntry('pkg/winuxcmd/usr/bin/bash.exe', { data: EXE_BYTES }),
      tarEntry('pkg/winuxcmd/bin/bash.exe', { type: '1', link: 'winuxcmd/usr/bin/bash.exe' }),
    ))
    const { files } = await extract(archive)
    check('a hardlink whose link name omits the prefix resolves the same way',
      files.get('winuxcmd/bin/bash.exe').equals(EXE_BYTES), JSON.stringify([...files.keys()]))
  } finally {
    rmSync(path.dirname(archive), { recursive: true, force: true })
  }
}

/** Every rejection below: build the archive, expect the reader to refuse. */
async function expectRefusal (label, entries, match, pinOverride = {}) {
  const archive = path.join(mkdtempSync(path.join(tmpdir(), 'dsh-bash-payload-')), 'bad.tar.gz')
  try {
    writeFileSync(archive, tarGzOf(...entries))
    let threw
    try { await extract(archive, testPin(pinOverride)) } catch (error) { threw = error.message }
    check(label, threw !== undefined && threw.includes(match), String(threw))
  } finally {
    rmSync(path.dirname(archive), { recursive: true, force: true })
  }
}

await expectRefusal('a member outside the pinned root is refused',
  [tarEntry('pkg/winuxcmd/usr/bin/bash.exe', { data: EXE_BYTES }), tarEntry('other/stray.txt', { data: Buffer.from('x') })],
  'outside the pinned root')
await expectRefusal('an unsafe member name inside the prefix is refused (tar-slip)',
  [tarEntry('pkg/../evil.txt', { data: Buffer.from('x') })],
  'unsafe bash payload archive member')
await expectRefusal('a symlink member is refused (the payload uses only files, dirs and hardlinks)',
  [
    tarEntry('pkg/winuxcmd/usr/bin/bash.exe', { data: EXE_BYTES }),
    tarEntry('pkg/winuxcmd/bin/bash', { type: '2', link: 'usr/bin/bash.exe' }),
  ],
  'unsupported bash payload tar member type')
await expectRefusal('a hardlink whose target never appeared is refused',
  [tarEntry('pkg/winuxcmd/bin/bash.exe', { type: '1', link: 'pkg/winuxcmd/usr/bin/bash.exe' })],
  'hardlink with no earlier target')
await expectRefusal('an executable whose bytes hash differently is refused',
  [tarEntry('pkg/winuxcmd/usr/bin/bash.exe', { data: Buffer.from('tampered\n') })],
  'not the pinned', { executableSha256: EXE_SHA })
await expectRefusal('an archive without the pinned executable is refused',
  [tarEntry('pkg/README.txt', { data: README_BYTES })],
  'does not carry')

{
  // The truncation case needs the BAD bytes written directly; build them here
  // where the splice is readable.
  const archive = path.join(mkdtempSync(path.join(tmpdir(), 'dsh-bash-payload-')), 'truncated.tar.gz')
  try {
    const tar = Buffer.concat([tarEntry('pkg/winuxcmd/usr/bin/bash.exe', { data: Buffer.alloc(64, 9) })])
    writeFileSync(archive, gzipSync(tar.subarray(0, 512 + 10)))
    let threw
    try { await extract(archive) } catch (error) { threw = error.message }
    check('a member whose bytes stop early is refused', threw?.includes('truncated'), String(threw))
  } finally {
    rmSync(path.dirname(archive), { recursive: true, force: true })
  }
}

{
  const archive = path.join(mkdtempSync(path.join(tmpdir(), 'dsh-bash-payload-')), 'plain.txt')
  try {
    writeFileSync(archive, 'this is not gzip at all\n')
    let threw
    try { await extract(archive) } catch (error) { threw = error.message }
    check('a non-gzip file is refused before any tar parsing', threw?.includes('not readable gzip'), String(threw))
  } finally {
    rmSync(path.dirname(archive), { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n[readBashTarGz: ustar prefix/name splits (33515e5)]')
//
// The official niubash v1.5.0 asset stores 7 of its 194 members the ustar
// way: a path longer than the 100-byte `name` field is split into a `prefix`
// field (header offset 345, 155 bytes — the leading directories) plus a
// `name` tail, and the real path is `prefix + '/' + name`. Before 33515e5
// the walk read the `name` field alone, so every split member arrived
// root-less and the pin-prefix guard refused it as "member outside the
// pinned root" — a false report about perfectly pinned bytes (exactly what
// the real asset produced). Every split fixture below is spelled so it
// CANNOT be represented without the prefix field: the joined path exceeds
// 100 bytes, the condition that forces a real packer to split.

// The v1.5.0-shaped split member: the root rides in `prefix`, the tail fills
// the 100-byte `name` field to its last byte (the hooks files the real asset
// splits live under exactly this directory tree).
const SPLIT_PREFIX = 'pkg'
const HOOKS_DIR = 'winuxcmd/opt/niugit/mingw64/share/git-core/templates/hooks/'
const SPLIT_TAIL = `${HOOKS_DIR}really-long-hook-name-filling-the-100byte`
const SPLIT_BYTES = Buffer.from('split member bytes\n')

check('fixture sanity: the split tail fills the 100-byte name field exactly',
  SPLIT_TAIL.length === 100, String(SPLIT_TAIL.length))
check('fixture sanity: the joined path is over 100 bytes (only a split header can carry it)',
  `${SPLIT_PREFIX}/${SPLIT_TAIL}`.length === 104 && `${SPLIT_PREFIX}/${SPLIT_TAIL}`.length > 100,
  String(`${SPLIT_PREFIX}/${SPLIT_TAIL}`.length))
// The counter-evidence in one line: the pre-fix name-only walk read exactly
// this tail, which carries no `pkg/` root, so its
// `!rawName.startsWith(pin.prefix)` guard HAD to fire ("outside the pinned
// root"). The happy path below is this same member extracting fine.
check('fixture sanity: the tail alone does NOT start with the pin prefix (the pre-fix walk refused exactly this)',
  !SPLIT_TAIL.startsWith(`${SPLIT_PREFIX}/`), SPLIT_TAIL)

{
  // The happy path: every member the pin needs, stored split — including the
  // root directory (prefix=`pkg`, name=``) and a legal-but-unusual split
  // spelling of the short executable (a real packer splits only >100-byte
  // paths, but ustar allows the spelling and the reader must join it all the
  // same). The whole archive must pass the pin gates unchanged: the join
  // happens BEFORE the prefix guard and BEFORE the executable digest check.
  const archive = path.join(mkdtempSync(path.join(tmpdir(), 'dsh-bash-payload-')), 'split.tar.gz')
  try {
    writeFileSync(archive, tarGzOf(
      tarSplitEntry(SPLIT_PREFIX, '', { type: '5' }),
      tarSplitEntry(SPLIT_PREFIX, 'winuxcmd/usr/bin/bash.exe', { data: EXE_BYTES }),
      tarSplitEntry(SPLIT_PREFIX, SPLIT_TAIL, { data: SPLIT_BYTES }),
      tarEntry('pkg/README.txt', { data: README_BYTES }),
    ))
    const { files, executableBytes, totalBytes } = await extract(archive)
    check('a split root directory member (prefix=pkg, name="") is consumed, not extracted',
      !files.has('') && !files.has('pkg') && !files.has('pkg/'), JSON.stringify([...files.keys()]))
    check('the split-stored executable still digest-checks against the pin (join runs before the gates)',
      executableBytes.equals(EXE_BYTES), JSON.stringify([...files.keys()]))
    check('a >100-byte real path reads as prefix/name joined, not as a root-less tail',
      files.get(SPLIT_TAIL)?.equals(SPLIT_BYTES) === true, JSON.stringify([...files.keys()]))
    check('the joined member is stored under its stripped real name (pkg/ stripped like any member)',
      files.has(SPLIT_TAIL) && !files.has(`pkg/${SPLIT_TAIL}`), JSON.stringify([...files.keys()]))
    check('a short member in the same archive is untouched (its all-NUL prefix field joins to itself)',
      files.get('README.txt')?.equals(README_BYTES) === true, JSON.stringify([...files.keys()]))
    check('totalBytes counts the split file like any regular file',
      totalBytes === EXE_BYTES.length + SPLIT_BYTES.length + README_BYTES.length, String(totalBytes))
  } finally {
    rmSync(path.dirname(archive), { recursive: true, force: true })
  }
}

{
  // Prefix-field normalization: NUL-padded (the buffer default), surrounded
  // by blanks, or space-padded across the full 155-byte field must all join
  // to the same real path — the reader strips NULs then trims, mirroring
  // tarOctal. A whitespace-ONLY prefix field reduces to '' and joins to
  // nothing: the name-only behavior (and every pre-33515e5 archive) is
  // unchanged.
  const archive = path.join(mkdtempSync(path.join(tmpdir(), 'dsh-bash-payload-')), 'split-padding.tar.gz')
  try {
    writeFileSync(archive, tarGzOf(
      tarSplitEntry(SPLIT_PREFIX, 'winuxcmd/usr/bin/bash.exe', { data: EXE_BYTES }),
      tarSplitEntry(SPLIT_PREFIX, 'winuxcmd/opt/hooks/a.txt', { data: Buffer.from('a\n'), prefixRaw: `  ${SPLIT_PREFIX}  \0` }),
      tarSplitEntry(SPLIT_PREFIX, 'winuxcmd/opt/hooks/b.txt', { data: Buffer.from('b\n'), prefixRaw: SPLIT_PREFIX.padEnd(155, ' ') }),
      tarSplitEntry('', 'pkg/README.txt', { data: README_BYTES, prefixRaw: '   \0' }),
    ))
    const { files } = await extract(archive)
    check('a prefix field of surrounding blanks + NUL padding joins to the clean spelling',
      files.get('winuxcmd/opt/hooks/a.txt')?.equals(Buffer.from('a\n')) === true, JSON.stringify([...files.keys()]))
    check('a prefix field space-padded across the full 155 bytes joins to the clean spelling',
      files.get('winuxcmd/opt/hooks/b.txt')?.equals(Buffer.from('b\n')) === true, JSON.stringify([...files.keys()]))
    check('a whitespace-only prefix field joins to nothing: the member reads name-only as before the fix',
      files.get('README.txt')?.equals(README_BYTES) === true, JSON.stringify([...files.keys()]))
  } finally {
    rmSync(path.dirname(archive), { recursive: true, force: true })
  }
}

{
  // Hardlinks: the member NAME may be split-stored and joins like any other
  // member, but the `linkname` field gets NO prefix processing — ustar
  // defines the prefix split for `name` only, and the pinned asset writes
  // full in-archive paths (≤100 bytes) as linknames.
  const archive = path.join(mkdtempSync(path.join(tmpdir(), 'dsh-bash-payload-')), 'split-hardlink.tar.gz')
  try {
    writeFileSync(archive, tarGzOf(
      tarEntry('pkg/winuxcmd/usr/bin/bash.exe', { data: EXE_BYTES }),
      tarSplitEntry(SPLIT_PREFIX, 'winuxcmd/bin/bash.exe', { type: '1', link: 'pkg/winuxcmd/usr/bin/bash.exe' }),
      tarSplitEntry(SPLIT_PREFIX, SPLIT_TAIL, { data: SPLIT_BYTES }),
      tarSplitEntry(SPLIT_PREFIX, 'winuxcmd/bin/bash-2.exe', { type: '1', link: SPLIT_TAIL }),
    ))
    const { files } = await extract(archive)
    check('a split-stored hardlink member resolves its plain full-path linkname to the earlier target',
      files.get('winuxcmd/bin/bash.exe')?.equals(EXE_BYTES) === true, JSON.stringify([...files.keys()]))
    check('a linkname that omits the root still resolves against the split target\'s joined key (no double join, no mismatch)',
      files.get('winuxcmd/bin/bash-2.exe')?.equals(SPLIT_BYTES) === true, JSON.stringify([...files.keys()]))
  } finally {
    rmSync(path.dirname(archive), { recursive: true, force: true })
  }
}

await expectRefusal('a hardlink whose >100-byte target truncates inside the 100-byte linkname field names nothing (no prefix rescue)',
  [
    tarEntry('pkg/winuxcmd/usr/bin/bash.exe', { data: EXE_BYTES }),
    tarEntry('pkg/link.exe', { type: '1', link: `pkg/${'x'.repeat(200)}` }),
  ],
  'hardlink with no earlier target')
await expectRefusal('a hardlink whose linkname sits outside the pinned root is still refused (the split join never applies to linknames)',
  [
    tarEntry('pkg/winuxcmd/usr/bin/bash.exe', { data: EXE_BYTES }),
    tarEntry('pkg/link.exe', { type: '1', link: 'outside/stray.txt' }),
  ],
  'hardlink with no earlier target')

// ---------------------------------------------------------------------------
console.log('\n[listBashTarGzMembers: the packer-side walk joins too]')
//
// The packaging-side twin of readBashTarGz (its other 33515e5 fix site).
// This walk had no suite of its own anywhere — the exact kind of gap a
// real-asset-only bug slips through — so its split behavior is pinned here.

{
  const archive = path.join(mkdtempSync(path.join(tmpdir(), 'dsh-bash-payload-')), 'list-split.tar.gz')
  try {
    writeFileSync(archive, tarGzOf(
      tarSplitEntry(SPLIT_PREFIX, '', { type: '5' }),
      tarSplitEntry(SPLIT_PREFIX, 'winuxcmd/usr/bin/bash.exe', { data: EXE_BYTES }),
      tarSplitEntry(SPLIT_PREFIX, SPLIT_TAIL, { data: SPLIT_BYTES }),
      tarEntry('pkg/README.txt', { data: README_BYTES }),
    ))
    const { prefix, members, bashMembers } = await listBashTarGzMembers(archive)
    check('the single root is discovered from split members (joined before the common-root walk)',
      prefix === 'pkg/', JSON.stringify(prefix))
    check('split members are keyed by their joined full name',
      members.has(`pkg/${SPLIT_TAIL}`) && members.has('pkg/winuxcmd/usr/bin/bash.exe'), JSON.stringify([...members.keys()]))
    check('a short member keys exactly as stored (the join is a no-op there)',
      members.has('pkg/README.txt'), JSON.stringify([...members.keys()]))
    check('directory members are not listed', !members.has('pkg') && !members.has('pkg/'), JSON.stringify([...members.keys()]))
    check('the split-stored executable is a bash.exe candidate', bashMembers.includes('pkg/winuxcmd/usr/bin/bash.exe'), JSON.stringify(bashMembers))
  } finally {
    rmSync(path.dirname(archive), { recursive: true, force: true })
  }
}

{
  const archive = path.join(mkdtempSync(path.join(tmpdir(), 'dsh-bash-payload-')), 'list-flat.tar.gz')
  try {
    writeFileSync(archive, tarGzOf(
      tarEntry('bash.exe', { data: EXE_BYTES }),
      tarEntry('readme.txt', { data: README_BYTES }),
    ))
    const { prefix } = await listBashTarGzMembers(archive)
    check('an archive whose members sit at the root reports an empty prefix (the packer rejects that layout)',
      prefix === '', JSON.stringify(prefix))
  } finally {
    rmSync(path.dirname(archive), { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n[stageBashTree]')

{
  const staging = mkdtempSync(path.join(tmpdir(), 'dsh-bash-stage-'))
  try {
    const files = new Map([
      ['winuxcmd/usr/bin/bash.exe', EXE_BYTES],
      ['README.txt', README_BYTES],
    ])
    const written = stageBashTree(files, staging)
    check('every member is written under the staging root, nested dirs created',
      written === 2
      && readFileSync(path.join(staging, 'winuxcmd', 'usr', 'bin', 'bash.exe')).equals(EXE_BYTES)
      && readFileSync(path.join(staging, 'README.txt')).equals(README_BYTES))
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
console.log('\n[sha256File / bashReceiptText / bashExePathOf]')

{
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-bash-hash-'))
  try {
    const file = path.join(dir, 'blob.bin')
    writeFileSync(file, Buffer.concat([Buffer.alloc(300_000, 1), EXE_BYTES]))
    check('sha256File streams to the same digest the one-shot hash computes',
      await sha256File(file) === createHash('sha256').update(Buffer.concat([Buffer.alloc(300_000, 1), EXE_BYTES])).digest('hex'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

{
  const receipt = bashReceiptText('winbox')
  const parsed = JSON.parse(receipt)
  check('the receipt is JSON with a trailing newline', receipt.endsWith('\n') && parsed.schemaVersion === 1, JSON.stringify(parsed))
  check('the receipt mirrors the pin\'s identity',
    parsed.name === BASH_PAYLOAD_PIN.name && parsed.version === BASH_PAYLOAD_PIN.version
    && parsed.upstream === BASH_PAYLOAD_PIN.upstream && parsed.upstreamUrl === BASH_PAYLOAD_PIN.upstreamUrl
    && parsed.url === BASH_PAYLOAD_PIN.url && parsed.assetFile === BASH_PAYLOAD_PIN.assetFile
    && parsed.bytes === BASH_PAYLOAD_PIN.bytes && parsed.sha256 === BASH_PAYLOAD_PIN.sha256
    && parsed.extractor === BASH_PAYLOAD_PIN.extractor
    && parsed.executable === BASH_PAYLOAD_PIN.executableRelativePath
    && parsed.executableSha256 === BASH_PAYLOAD_PIN.executableSha256,
    JSON.stringify(parsed))
  check('the receipt names the provisioner and the host',
    parsed.provisionedBy === 'dsh-ssh-workspace' && parsed.hostAlias === 'winbox', JSON.stringify(parsed))
  check('the receipt timestamp is an ISO instant', !Number.isNaN(Date.parse(parsed.provisionedAt)), String(parsed.provisionedAt))
}

{
  check('bashExePathOf joins the version dir with the executable\'s backslashed path',
    bashExePathOf('C:\\Users\\u\\.dsh-ssh-workspace\\bash\\1.5.0')
      === `C:\\Users\\u\\.dsh-ssh-workspace\\bash\\1.5.0\\${BASH_PAYLOAD_PIN.executableRelativePath.replaceAll('/', '\\')}`,
    bashExePathOf('C:\\Users\\u\\.dsh-ssh-workspace\\bash\\1.5.0'))
  check('a trailing separator on the version dir does not double up',
    bashExePathOf('C:\\bash\\1.5.0\\').endsWith('\\1.5.0\\winuxcmd\\usr\\bin\\bash.exe'))
}

// ---------------------------------------------------------------------------
console.log('\n[provisionWinBash: the gates]')
//
// The full deployment needs a live SFTP host; the gates below are the
// refusals that must fire BEFORE any bytes move, each against a recording
// double that fails loudly if the gate leaks past it.

/** An engine double for the provisioner: records every seam it touches. */
function provisionEngine ({ login = 'cmd', entry } = {}) {
  const touched = { execRaw: [], withSftp: [], mutateHosts: 0, forgetCaches: 0 }
  const engine = {
    logger: { warn: () => {}, info: () => {} },
    async loginDialect () { return login },
    store: {
      entry: () => entry,
      entryStore: {
        mutateHosts (mutate) { touched.mutateHosts += 1; return mutate([]) },
      },
    },
    async execRaw (_alias, command) {
      touched.execRaw.push(command)
      return { success: true, exitCode: 0, stdout: 'C:\\Users\\u\r\n', stderr: '', timedOut: false, truncated: false, durationMs: 0 }
    },
    async withSftp (_alias, operation) {
      touched.withSftp.push(operation)
      // A bare SFTP double: no receipt on the host (stat answers null), so
      // the provisioner proceeds past the reuse check.
      return await operation({
        stat (_path, callback) { callback(null, null) },
        readdir (_path, callback) { callback(new Error('no reading here')) },
        rename (_from, _to, callback) { callback(new Error('no renaming here')) },
        unlink (_path, callback) { callback(new Error('no unlinking here')) },
        rmdir (_path, callback) { callback(new Error('no rmdir here')) },
      })
    },
    forgetDialectCaches () { touched.forgetCaches += 1 },
  }
  return { engine, touched }
}

{
  const { engine, touched } = provisionEngine({ login: 'posix' })
  let threw
  try { await provisionWinBash(engine, 'posixbox', { payloadPath: '/unused.tar.gz' }) } catch (error) { threw = error.message }
  check('a POSIX login shell refuses provisioning with the dialect wording',
    threw?.includes('does not have a cmd.exe login shell') && threw.includes('posix'), String(threw))
  check('the refusal fires before ANY command or SFTP touches the host',
    touched.execRaw.length === 0 && touched.withSftp.length === 0, JSON.stringify(touched))
}

{
  const { engine, touched } = provisionEngine({ entry: undefined })
  let threw
  try { await provisionWinBash(engine, 'configonly', {}) } catch (error) { threw = error.message }
  check('an ~/.ssh/config fallback (no editable entry) refuses provisioning',
    threw?.includes('no editable store entry'), String(threw))
  check('the no-entry refusal fires before the HOME resolution',
    touched.execRaw.length === 0, JSON.stringify(touched.execRaw))
}

{
  // The payloadPath digest gate: wrong size refuses before the SFTP upload.
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-bash-provision-'))
  const { engine, touched } = provisionEngine({ entry: {} })
  try {
    const payload = path.join(dir, 'short.tar.gz')
    writeFileSync(payload, Buffer.alloc(5, 1))
    let threw
    try { await provisionWinBash(engine, 'winbox', { payloadPath: payload }) } catch (error) { threw = error.message }
    check('a payloadPath whose size differs from the pin is refused',
      threw?.includes(`bash payload archive is 5 bytes, not the pinned ${BASH_PAYLOAD_PIN.bytes}`), String(threw))
    check('the size refusal never uploaded (only the receipt stat reached SFTP)',
      touched.withSftp.length === 1 && touched.mutateHosts === 0, JSON.stringify(touched))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

{
  // Same gate, one step deeper: exact pinned size but wrong bytes → the
  // digest refuses unpinned bytes. The staged file is exactly
  // BASH_PAYLOAD_PIN.bytes, written as a sparse-ish zero buffer.
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-bash-provision-'))
  const { engine, touched } = provisionEngine({ entry: {} })
  try {
    const payload = path.join(dir, 'wrong-bytes.tar.gz')
    writeFileSync(payload, Buffer.alloc(BASH_PAYLOAD_PIN.bytes, 0))
    let threw
    try { await provisionWinBash(engine, 'winbox', { payloadPath: payload }) } catch (error) { threw = error.message }
    check('a payloadPath with the pinned size but a foreign digest is refused',
      threw?.includes('refusing unpinned bytes'), String(threw))
    check('the digest refusal never published anything',
      touched.mutateHosts === 0 && touched.forgetCaches === 0, JSON.stringify(touched))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
