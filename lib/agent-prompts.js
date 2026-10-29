/**
 * Three-level agent system-prompt configuration for remote workspaces.
 *
 * A mounted remote workspace can have extra agent guidance merged into the
 * session's system prompt. The material lives on the DSH host's LOCAL
 * filesystem and is configured at three levels, merged in a fixed order:
 *
 *   1. global   — one plugin-level configuration (`agentPrompts.global`);
 *   2. host     — one per SSH host alias (`agentPrompts.hosts[<alias>]`);
 *   3. workspace— one per mounted workspace (`agentPrompts.workspaces[<path>]`).
 *
 * Each level holds glob entries (patterns whose matches load `.md` files) and
 * script entries (commands whose stdout names files as JSON), plus a
 * `disabled` list. A lower level may disable an upper-level entry BY ID:
 * disabling removes that entry entirely (its files vanish) without touching
 * the upper level's own configuration, and without preventing the lower level
 * from adding entries of its own.
 *
 * Every entry carries a stable id derived from its content (the glob pattern
 * or the script command), so a disable list survives reordering and
 * re-saving; editing an entry's content changes its id, which orphans any
 * disable record pointing at the old id (harmless: an unknown id disables
 * nothing and is dropped on the next save of that level).
 *
 * The merged result is injected as a DYNAMIC `systemPrompt` section: the
 * section's `text` is a function re-evaluated by the agent loop before every
 * model step, keyed by the session's `cwd`. Results are cached per workspace
 * under the fingerprint of that workspace's three-level configuration, so a
 * configuration change invalidates the cache while unchanged file contents
 * are served from it.
 *
 * @module @shiqyka/dsh-ssh-workspace/agent-prompts
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { parseRemotePath } from './protocol.js'

/** Name of the injected prompt section (visible in prompt diagnostics). */
export const PROMPT_SECTION_NAME = 'ssh-workspace:agent-prompts'

/**
 * Placement of the section: after the file-reference guidance (900) and
 * before the read-tool guidance (1100), so workspace-specific instructions
 * land beside the other context sections instead of inside the tool band.
 */
export const PROMPT_SECTION_ORDER = 950

/** Upper bound of entries per kind per level — a runaway editor must not turn into a runaway merge. */
export const MAX_ENTRIES_PER_KIND = 64

/** Upper bound of disable records per level. */
export const MAX_DISABLED = 512

/** Upper bound of files a single entry may contribute. */
export const MAX_FILES_PER_ENTRY = 512

/** Upper bound of one source file, in bytes; larger files are skipped with an error. */
export const MAX_FILE_BYTES = 1024 * 1024

/** Upper bound of the merged prompt, in characters; further files are skipped with an error. */
export const MAX_TOTAL_CHARS = 400_000

/** Script execution guard rails. */
export const SCRIPT_TIMEOUT_MS = 30_000
export const SCRIPT_MAX_BUFFER = 1024 * 1024

// ---------------------------------------------------------------------------
// Entry ids
// ---------------------------------------------------------------------------

/** Short sha256 prefix, the stable identity of one entry. */
function shortHash (text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 8)
}

/**
 * The stable id of a glob entry, derived from its pattern.
 *
 * @param {string} pattern - the glob pattern.
 * @returns {string} `g-<8 hex>`.
 */
export function globEntryId (pattern) {
  return `g-${shortHash(String(pattern))}`
}

/**
 * The stable id of a script entry, derived from its command.
 *
 * @param {string} command - the script command line.
 * @returns {string} `s-<8 hex>`.
 */
export function scriptEntryId (command) {
  return `s-${shortHash(String(command))}`
}

// ---------------------------------------------------------------------------
// Level normalization
// ---------------------------------------------------------------------------

/** The empty level every missing/corrupt configuration degrades to. */
export const EMPTY_LEVEL = Object.freeze({ globs: [], scripts: [], disabled: [] })

/**
 * Collect id strings from a raw `disabled` payload.
 *
 * Unknown ids are kept (an entry may be disabled here and defined later) but
 * capped: a corrupt file must not grow without bound.
 *
 * @param {unknown} raw - the raw disable list.
 * @returns {string[]} trimmed, deduplicated ids.
 */
function normalizeDisabled (raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const candidate of raw) {
    if (typeof candidate !== 'string') continue
    const id = candidate.trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= MAX_DISABLED) break
  }
  return out
}

/**
 * Normalize one raw level into the stored shape.
 *
 * Accepts entries as plain strings (`"/a/*.md"`, `"node gen.js"`) or as
 * objects (`{ pattern }` / `{ command }`); a stored `id` is recomputed from
 * the content so ids stay stable even when a hand-edited file omits them.
 * Invalid entries (empty, non-absolute glob pattern, wrong types) are dropped
 * rather than failing the whole level — a damaged level must not take the
 * host store down with it.
 *
 * @param {unknown} raw - the raw level payload.
 * @returns {{globs: {id: string, pattern: string}[], scripts: {id: string, command: string}[], disabled: string[]}} the normalized level.
 */
export function normalizePromptLevel (raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_LEVEL, globs: [], scripts: [], disabled: [] }
  const globs = []
  const rawGlobs = Array.isArray(raw.globs) ? raw.globs : []
  for (const candidate of rawGlobs) {
    const pattern = typeof candidate === 'string'
      ? candidate.trim()
      : (candidate !== null && typeof candidate === 'object' && typeof candidate.pattern === 'string' ? candidate.pattern.trim() : '')
    if (pattern === '' || !pattern.startsWith('/')) continue
    globs.push({ id: globEntryId(pattern), pattern })
    if (globs.length >= MAX_ENTRIES_PER_KIND) break
  }
  const scripts = []
  const rawScripts = Array.isArray(raw.scripts) ? raw.scripts : []
  for (const candidate of rawScripts) {
    const command = typeof candidate === 'string'
      ? candidate.trim()
      : (candidate !== null && typeof candidate === 'object' && typeof candidate.command === 'string' ? candidate.command.trim() : '')
    if (command === '') continue
    scripts.push({ id: scriptEntryId(command), command })
    if (scripts.length >= MAX_ENTRIES_PER_KIND) break
  }
  return { globs, scripts, disabled: normalizeDisabled(raw.disabled) }
}

/**
 * Normalize a whole `agentPrompts` document section.
 *
 * Missing or corrupt section degrades to the all-empty shape: an old store
 * without the section runs exactly as before, and unreadable section content
 * never blocks the panel.
 *
 * @param {unknown} raw - the raw section.
 * @returns {{global: object, hosts: Record<string, object>, workspaces: Record<string, object>}} normalized section.
 */
export function normalizeAgentPromptsDocument (raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { global: { ...EMPTY_LEVEL, globs: [], scripts: [], disabled: [] }, hosts: {}, workspaces: {} }
  }
  /** @type {Record<string, object>} */
  const hosts = {}
  if (raw.hosts !== null && typeof raw.hosts === 'object' && !Array.isArray(raw.hosts)) {
    for (const [alias, level] of Object.entries(raw.hosts)) {
      if (typeof alias !== 'string' || alias === '') continue
      hosts[alias] = normalizePromptLevel(level)
    }
  }
  /** @type {Record<string, object>} */
  const workspaces = {}
  if (raw.workspaces !== null && typeof raw.workspaces === 'object' && !Array.isArray(raw.workspaces)) {
    for (const [path, level] of Object.entries(raw.workspaces)) {
      if (typeof path !== 'string' || !path.startsWith('ssh://')) continue
      workspaces[path] = normalizePromptLevel(level)
    }
  }
  return { global: normalizePromptLevel(raw.global), hosts, workspaces }
}

// ---------------------------------------------------------------------------
// Glob matching
// ---------------------------------------------------------------------------

/**
 * Translate one glob pattern into an anchored regular expression.
 *
 * Supported syntax, per `/`-separated segment: `**` as a WHOLE segment spans
 * zero or more segments; `*` matches within one segment; `?` matches one
 * character within a segment; `[abc]` / `[a-z]` / `[!a-z]` are character
 * classes. Dotted names are matched like any other (no special case). `**`
 * inside a larger segment degrades to `*`.
 *
 * @param {string} pattern - the glob pattern (absolute).
 * @returns {RegExp | undefined} the matcher, or `undefined` when the pattern is not absolute.
 */
export function globToRegExp (pattern) {
  if (typeof pattern !== 'string' || !pattern.startsWith('/')) return undefined
  const parts = pattern.split('/').filter(segment => segment !== '')
  let source = '^/'
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part === '**') {
      // Zero or more whole segments, each consumed WITH its separator, so the
      // match never straddles a boundary mid-segment. As the last part it
      // additionally allows one final (file) segment without a separator.
      source += index === parts.length - 1 ? '(?:[^/]+/)*[^/]*' : '(?:[^/]+/)*'
      continue
    }
    source += segmentToRegExp(part)
    if (index < parts.length - 1) source += '/'
  }
  return new RegExp(`${source}$`, 'u')
}

/**
 * Translate one non-`**` segment.
 *
 * @param {string} segment - one pattern segment.
 * @returns {string} the regular-expression source for the segment.
 */
function segmentToRegExp (segment) {
  let out = ''
  let index = 0
  while (index < segment.length) {
    const char = segment[index]
    if (char === '*') {
      // `**` inside a segment behaves like `*` (minimatch-compatible).
      out += '[^/]*'
      index += segment[index + 1] === '*' ? 2 : 1
      continue
    }
    if (char === '?') {
      out += '[^/]'
      index += 1
      continue
    }
    if (char === '[') {
      const closing = findClassEnd(segment, index)
      if (closing !== -1) {
        let body = segment.slice(index + 1, closing)
        if (body.startsWith('!')) body = `^${body.slice(1)}`
        // A `/` never matches inside a segment, even when listed explicitly.
        out += `[${body.replace(/[/\\]/gu, '')}]`
        index = closing + 1
        continue
      }
      // Unterminated class: a literal `[`.
      out += '\\['
      index += 1
      continue
    }
    out += escapeRegExp(char)
    index += 1
  }
  return out
}

/**
 * Locate the `]` that closes a character class starting at `open`.
 *
 * A `]` immediately after `[` (or after the `!` negation) is a literal member,
 * so the scan starts two characters in — the POSIX rule.
 *
 * @param {string} segment - the pattern segment.
 * @param {number} open - index of the opening `[`.
 * @returns {number} index of the closing `]`, or -1 when unterminated.
 */
function findClassEnd (segment, open) {
  for (let index = open + 2; index < segment.length; index += 1) {
    if (segment[index] === ']') return index
  }
  return -1
}

/** Escape one literal character for a regular expression. */
function escapeRegExp (char) {
  return /[\\^$.*+?()[\]{}|]/u.test(char) ? `\\${char}` : char
}

/**
 * The longest literal directory prefix of a pattern — where the walk starts.
 *
 * @param {string} pattern - absolute glob pattern.
 * @returns {string} absolute base directory (no trailing slash; `/` for root).
 */
export function globBaseDir (pattern) {
  const segments = pattern.split('/')
  const literal = []
  for (const segment of segments.slice(1)) {
    if (segment === '' || /[*?[]/u.test(segment)) break
    literal.push(segment)
  }
  return literal.length === 0 ? '/' : `/${literal.join('/')}`
}

/** How deep the glob walk may recurse (`**` chains). */
const GLOB_MAX_DEPTH = 32

/** How many entries one glob walk may visit before it stops. */
const GLOB_MAX_VISITS = 20_000

/**
 * Expand one glob pattern against the local filesystem, synchronously.
 *
 * Only regular files match (directories never load). A symlink that resolves
 * to a file is included; a symlink to a directory is never followed, so a
 * cyclic tree cannot hang the merge. Matches sort lexicographically, which
 * keeps the merged order stable across runs.
 *
 * @param {string} pattern - absolute glob pattern.
 * @returns {{files: string[], error?: string}} matched absolute paths, or a readable error.
 */
export function expandGlobSync (pattern) {
  const matcher = globToRegExp(pattern)
  if (matcher === undefined) return { files: [], error: `glob pattern must be absolute: ${JSON.stringify(pattern)}` }
  const base = globBaseDir(pattern)
  if (!existsSync(base)) return { files: [], error: `glob base directory does not exist: ${base} (pattern ${JSON.stringify(pattern)})` }
  // A pattern with no wildcard names ONE file (the whole pattern is its own
  // base). Loading that exact file is the whole point of such an entry; the
  // directory walk below can never reach it because readdir on a file fails.
  let baseStat = null
  try { baseStat = statSync(base) } catch { baseStat = null }
  if (baseStat !== null && baseStat.isFile()) {
    return matcher.test(base) ? { files: [base] } : { files: [], error: `glob pattern names ${base} but does not match it` }
  }
  /** @type {string[]} */
  const files = []
  let visits = 0
  /**
   * Walk one directory level.
   *
   * @param {string} dir - absolute directory being listed.
   * @param {number} depth - remaining recursion budget.
   * @returns {void}
   */
  const walk = (dir, depth) => {
    if (depth < 0) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      // An unreadable directory prunes its subtree; the error surfaces only
      // when nothing matched at all (below).
      return
    }
    for (const entry of entries) {
      if (++visits > GLOB_MAX_VISITS) return
      const child = dir === '/' ? `/${entry.name}` : `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        walk(child, depth - 1)
        continue
      }
      let isFile = entry.isFile()
      if (!isFile && entry.isSymbolicLink()) {
        // Symlinked files count; symlinked directories do not (cycle safety).
        try { isFile = statSync(child).isFile() } catch { isFile = false }
      }
      if (isFile && matcher.test(child)) files.push(child)
    }
  }
  walk(base, GLOB_MAX_DEPTH)
  files.sort()
  if (files.length >= GLOB_MAX_VISITS) {
    return { files: files.slice(0, MAX_FILES_PER_ENTRY), error: `glob matched too many entries and was truncated: ${JSON.stringify(pattern)}` }
  }
  return { files: files.slice(0, MAX_FILES_PER_ENTRY) }
}

// ---------------------------------------------------------------------------
// Script entries
// ---------------------------------------------------------------------------

/** The `$DSH_HOME` directory scripts run in (same resolution as the store). */
export function dshHome () {
  const home = process.env.DSH_HOME
  return typeof home === 'string' && home !== '' ? home : join(homedir(), '.dsh')
}

/**
 * Run one script entry on the DSH host and read the files it names.
 *
 * The command runs through the platform shell (`sh -c` / `cmd /c`) with
 * `$DSH_HOME` as its working directory. stdout must be JSON — either
 * `{"files": ["/abs/a.md", …]}` or a bare `["/abs/a.md", …]`. Every failure
 * (non-zero exit, timeout, bad JSON, wrong shape) becomes a READABLE error on
 * the result; it never throws and never takes the merge or the panel down.
 *
 * @param {{id: string, command: string}} entry - the script entry.
 * @param {{timeoutMs?: number}} [options] - overrides (tests).
 * @returns {Promise<{files: string[], error?: string}>} absolute paths (deduplicated) or a readable error.
 */
export function runScriptEntry (entry, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : SCRIPT_TIMEOUT_MS
  const isWindows = process.platform === 'win32'
  const file = isWindows ? (process.env.comspec || 'cmd.exe') : '/bin/sh'
  const args = isWindows ? ['/d', '/s', '/c', entry.command] : ['-c', entry.command]
  return new Promise((resolve_) => {
    const finish = (result) => resolve_(result)
    try {
      execFile(file, args, {
        cwd: dshHome(),
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: SCRIPT_MAX_BUFFER,
        encoding: 'utf8',
        windowsHide: true,
      }, (error, stdout, stderr) => {
        if (error !== null && error !== undefined) {
          const killed = error.killed === true
          const code = typeof error.code === 'number' ? error.code : undefined
          const tail = String(stderr ?? '').trim().slice(-400)
          if (killed) finish({ files: [], error: `script ${entry.id} timed out after ${Math.round(timeoutMs / 1000)}s: ${JSON.stringify(entry.command)}` })
          else finish({ files: [], error: `script ${entry.id} exited with code ${code ?? 'unknown'}${tail === '' ? '' : `: ${tail}`}` })
          return
        }
        finish(parseScriptOutput(entry.id, String(stdout ?? '')))
      })
    } catch (error) {
      finish({ files: [], error: `script ${entry.id} could not start: ${error instanceof Error ? error.message : String(error)}` })
    }
    // execFile with maxBuffer kills on overflow and reports an error, so no
    // extra guard is needed on top of the callback above.
  })
}

/**
 * Parse a script's stdout into a file list.
 *
 * Accepts `{"files": [...]}` or a bare array; every element must be a
 * non-empty ABSOLUTE path string (relative entries are dropped — the material
 * lives on the host filesystem, so "relative to what" has no answer).
 *
 * @param {string} id - the entry id (for error messages).
 * @param {string} stdout - raw stdout.
 * @returns {{files: string[], error?: string}} the sanitized list or a readable error.
 */
export function parseScriptOutput (id, stdout) {
  let parsed
  try {
    parsed = JSON.parse(stdout.trim())
  } catch {
    return { files: [], error: `script ${id} did not print JSON (stdout head: ${JSON.stringify(stdout.trim().slice(0, 200))})` }
  }
  const raw = Array.isArray(parsed)
    ? parsed
    : (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.files) ? parsed.files : undefined)
  if (raw === undefined) {
    return { files: [], error: `script ${id} must print {"files":[…]} or a bare JSON array of absolute paths` }
  }
  const seen = new Set()
  const files = []
  for (const candidate of raw) {
    if (typeof candidate !== 'string' || candidate.trim() === '') continue
    const file = candidate.trim()
    if (!isAbsolute(file) || seen.has(file)) continue
    seen.add(file)
    files.push(file)
    if (files.length >= MAX_FILES_PER_ENTRY) break
  }
  return { files }
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * The entries that survive, in merge order, for one workspace.
 *
 * Order is global → host → workspace; within a level globs come before
 * scripts, each in array order. A level's `disabled` list removes upper-level
 * entries entirely: the host level may disable global entries, the workspace
 * level may disable global AND host entries. Lower levels never see their own
 * entries disabled from above.
 *
 * @param {object} globalLevel - normalized global level.
 * @param {object} hostLevel - normalized host level.
 * @param {object} workspaceLevel - normalized workspace level.
 * @returns {Array<{level: 'global'|'host'|'workspace', kind: 'glob'|'script', entry: object}>} effective entries.
 */
export function effectiveEntries (globalLevel, hostLevel, workspaceLevel) {
  const hostDisablesGlobal = new Set(hostLevel.disabled)
  const workspaceDisables = new Set(workspaceLevel.disabled)
  /** @type {Array<{level: string, kind: string, entry: object}>} */
  const out = []
  const pushLevel = (level, levelConfig) => {
    for (const entry of levelConfig.globs) out.push({ level, kind: 'glob', entry })
    for (const entry of levelConfig.scripts) out.push({ level, kind: 'script', entry })
  }
  for (const entry of globalLevel.globs) {
    if (hostDisablesGlobal.has(entry.id) || workspaceDisables.has(entry.id)) continue
    out.push({ level: 'global', kind: 'glob', entry })
  }
  for (const entry of globalLevel.scripts) {
    if (hostDisablesGlobal.has(entry.id) || workspaceDisables.has(entry.id)) continue
    out.push({ level: 'global', kind: 'script', entry })
  }
  for (const entry of hostLevel.globs) {
    if (workspaceDisables.has(entry.id)) continue
    out.push({ level: 'host', kind: 'glob', entry })
  }
  for (const entry of hostLevel.scripts) {
    if (workspaceDisables.has(entry.id)) continue
    out.push({ level: 'host', kind: 'script', entry })
  }
  pushLevel('workspace', workspaceLevel)
  return out
}

/**
 * Expand every effective entry and collect the named files, deduplicated.
 *
 * The same file named by several entries loads ONCE, at its first position.
 * Script-named files that do not exist (or are not regular files) produce a
 * readable error and are skipped; glob matches exist by construction but are
 * checked all the same, so a file deleted between the walk and the read is
 * reported rather than crashing the merge.
 *
 * @param {object} params - the three normalized levels.
 * @param {object} params.global - global level.
 * @param {object} params.host - host level (for the workspace's alias).
 * @param {object} params.workspace - workspace level.
 * @returns {Promise<{files: string[], errors: Array<{level: string, kind: string, id: string, message: string}>}>} ordered unique files and per-entry errors.
 */
export async function collectPromptFiles ({ global, host, workspace }) {
  /** @type {string[]} */
  const files = []
  const seen = new Set()
  /** @type {Array<{level: string, kind: string, id: string, message: string}>} */
  const errors = []
  for (const { level, kind, entry } of effectiveEntries(global, host, workspace)) {
    let expanded
    if (kind === 'glob') {
      try {
        expanded = expandGlobSync(entry.pattern)
      } catch (error) {
        errors.push({ level, kind, id: entry.id, message: `glob ${JSON.stringify(entry.pattern)} failed: ${error instanceof Error ? error.message : String(error)}` })
        continue
      }
      if (expanded.error !== undefined) errors.push({ level, kind, id: entry.id, message: expanded.error })
    } else {
      try {
        expanded = await runScriptEntry(entry)
      } catch (error) {
        // runScriptEntry resolves every failure into the result; this guard is
        // belt-and-braces for unexpected throws.
        errors.push({ level, kind, id: entry.id, message: `script ${JSON.stringify(entry.command)} failed: ${error instanceof Error ? error.message : String(error)}` })
        continue
      }
      if (expanded.error !== undefined) errors.push({ level, kind, id: entry.id, message: expanded.error })
    }
    for (const file of expanded.files) {
      if (seen.has(file)) continue
      let stat = null
      try { stat = statSync(file) } catch { stat = null }
      if (stat === null || !stat.isFile()) {
        errors.push({ level, kind, id: entry.id, message: `named file is missing or not a regular file: ${file}` })
        continue
      }
      seen.add(file)
      files.push(file)
    }
  }
  return { files, errors }
}

/**
 * Wrap one file's content in the strict block format.
 *
 * The markers carry the file's ABSOLUTE path; the content keeps its own
 * newlines, with exactly one added before the end marker when the file does
 * not end with one — the end marker always sits on its own line.
 *
 * @param {string} file - the file's absolute path.
 * @param {string} content - the file's UTF-8 content.
 * @returns {string} the wrapped block.
 */
export function wrapFileBlock (file, content) {
  const body = content.endsWith('\n') ? content : `${content}\n`
  return `----[${file}]---start\n${body}----[${file}]---end`
}

/** Lead-in above the merged blocks, in the plugin's voice. */
const PROMPT_PREAMBLE = [
  '以下内容是 dsh-ssh-workspace 插件为本工作区自动合并的 agent 系统提示词（按「全局 → 主机 → 项目」三级配置展开；每个 md 文件用其绝对路径包裹）。',
  '请把每个包裹块内的内容当作本工作区必须遵守的工作区级指引；包裹块本身是自动生成产物，勿在对话中逐字复述。',
].join('\n')

/**
 * Render the merged prompt document from collected blocks.
 *
 * @param {Array<{path: string, content: string}>} blocks - files in merge order.
 * @returns {string} the section text (empty when there are no blocks).
 */
export function renderPromptDocument (blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return ''
  return [PROMPT_PREAMBLE, ...blocks.map(block => wrapFileBlock(block.path, block.content))].join('\n')
}

/**
 * Read the collected files and produce the wrapped blocks.
 *
 * A file larger than {@link MAX_FILE_BYTES} is skipped with an error; the
 * total budget {@link MAX_TOTAL_CHARS} stops the merge with an error naming
 * what was left out — a runaway include must not push an entire system prompt
 * past every model's context window.
 *
 * @param {string[]} files - absolute paths in merge order.
 * @param {Array<{level: string, kind: string, id: string, message: string}>} errors - errors collected so far.
 * @returns {{blocks: Array<{path: string, content: string}>, errors: Array<object>, text: string}} blocks, augmented errors and the rendered text.
 */
export function readPromptBlocks (files, errors) {
  /** @type {Array<{path: string, content: string}>} */
  const blocks = []
  let total = 0
  for (const file of files) {
    let stat = null
    try { stat = statSync(file) } catch { stat = null }
    if (stat === null) {
      errors.push({ level: 'merge', kind: 'read', id: '', message: `file disappeared before it could be read: ${file}` })
      continue
    }
    if (stat.size > MAX_FILE_BYTES) {
      errors.push({ level: 'merge', kind: 'read', id: '', message: `file exceeds ${MAX_FILE_BYTES} bytes and was skipped: ${file}` })
      continue
    }
    let content
    try {
      content = readFileSync(file, 'utf8')
    } catch (error) {
      errors.push({ level: 'merge', kind: 'read', id: '', message: `file could not be read: ${file} — ${error instanceof Error ? error.message : String(error)}` })
      continue
    }
    total += content.length + file.length + 64
    if (total > MAX_TOTAL_CHARS) {
      errors.push({ level: 'merge', kind: 'read', id: '', message: `merged prompt exceeded ${MAX_TOTAL_CHARS} characters; remaining files were not loaded (next: ${file})` })
      break
    }
    blocks.push({ path: file, content })
  }
  return { blocks, errors, text: renderPromptDocument(blocks) }
}

/**
 * The fingerprint of one workspace's three-level configuration.
 *
 * The cache key: a change in ANY of the three levels (including a disable
 * list) yields a new fingerprint and invalidates the cached merge. Changes to
 * the underlying FILES do not — re-merging happens when the configuration
 * changes or the workspace is re-mounted (see docs/agent-prompts.md).
 *
 * @param {object} globalLevel - normalized global level.
 * @param {object} hostLevel - normalized host level.
 * @param {object} workspaceLevel - normalized workspace level.
 * @returns {string} sha256 hex of the canonical JSON.
 */
export function configFingerprint (globalLevel, hostLevel, workspaceLevel) {
  return createHash('sha256').update(JSON.stringify([globalLevel, hostLevel, workspaceLevel]), 'utf8').digest('hex')
}

// ---------------------------------------------------------------------------
// Registry (cache + injection surface)
// ---------------------------------------------------------------------------

/**
 * Build the per-workspace prompt registry.
 *
 * The registry owns the (workspace, config-fingerprint) cache and exposes the
 * synchronous `serveForCwd` the system-prompt section calls before every
 * model step. A cache miss returns `''` for that step and kicks an async
 * refresh; the next step (typically a second later) carries the merged text.
 *
 * @param {object} deps - collaborators.
 * @param {object} deps.store - the host config store (reads `agentPrompts`).
 * @param {() => string[]} deps.roots - canonical `ssh://` paths of the currently served workspaces.
 * @param {Console} [deps.logger] - optional logger for refresh failures.
 * @returns {object} the registry.
 */
export function createAgentPromptRegistry ({ store, roots, logger } = {}) {
  /** @type {Map<string, {hash: string, text: string, files: string[], errors: Array<object>}>} */
  const cache = new Map()
  /** @type {Map<string, Promise<{hash: string, text: string, files: string[], errors: Array<object>}>>} */
  const inflight = new Map()

  /**
   * The three normalized levels for one workspace path (or `undefined` paths
   * degrade to empty host/workspace levels).
   *
   * @param {string} [workspacePath] - canonical `ssh://` workspace path.
   * @param {string} [alias] - the host alias, when already parsed.
   * @returns {{global: object, host: object, workspace: object, hash: string}} levels and their fingerprint.
   */
  const levelsFor = (workspacePath, alias) => {
    let document = { global: EMPTY_LEVEL, hosts: {}, workspaces: {} }
    try {
      document = store.agentPrompts()
    } catch (error) {
      logger?.warn?.(`ssh-workspace: could not read the agent prompt configuration: ${error instanceof Error ? error.message : String(error)}`)
    }
    const aliasKey = alias ?? (typeof workspacePath === 'string' ? aliasOf(workspacePath) : undefined)
    const host = (aliasKey !== undefined && document.hosts?.[aliasKey] !== undefined)
      ? document.hosts[aliasKey]
      : EMPTY_LEVEL
    const workspace = (typeof workspacePath === 'string' && document.workspaces?.[workspacePath] !== undefined)
      ? document.workspaces[workspacePath]
      : EMPTY_LEVEL
    const global = document.global ?? EMPTY_LEVEL
    return { global, host, workspace, hash: configFingerprint(global, host, workspace) }
  }

  /** Best-effort alias extraction (never throws). */
  const aliasOf = (workspacePath) => {
    try {
      return parseRemotePath(workspacePath)?.alias
    } catch {
      // A malformed spelling still carries the alias lexically; parseRemotePath
      // throws on it, and the registry must never throw from a prompt hook.
      const match = /^ssh:\/\/([^/]+)\//u.exec(String(workspacePath))
      return match === null ? undefined : match[1]
    }
  }

  /**
   * Compute one workspace's merge (glob expansion + scripts + reads).
   *
   * Never rejects: an unexpected failure degrades to an empty merge WITH the
   * current fingerprint attached, so the failed result is cached like any
   * other — a cache entry whose hash can never match would recompute on every
   * model step instead of once per configuration change.
   *
   * @param {string} workspacePath - canonical workspace path.
   * @param {string} [alias] - pre-parsed alias.
   * @returns {Promise<{hash: string, text: string, files: string[], errors: Array<object>}>} the fresh result.
   */
  const compute = async (workspacePath, alias) => {
    const levels = levelsFor(workspacePath, alias)
    try {
      const { files, errors } = await collectPromptFiles(levels)
      const { blocks, errors: readErrors, text } = readPromptBlocks(files, errors)
      return { hash: levels.hash, text, files: blocks.map(block => block.path), errors: readErrors }
    } catch (error) {
      logger?.warn?.(`ssh-workspace: could not merge agent prompts for ${workspacePath}: ${error instanceof Error ? error.message : String(error)}`)
      return { hash: levels.hash, text: '', files: [], errors: [{ level: 'merge', kind: 'internal', id: '', message: error instanceof Error ? error.message : String(error) }] }
    }
  }

  /**
   * Refresh (and cache) one workspace's merge, deduplicating concurrent calls.
   *
   * @param {string} workspacePath - canonical workspace path.
   * @param {string} [alias] - pre-parsed alias.
   * @returns {Promise<{hash: string, text: string, files: string[], errors: Array<object>}>} the cached result.
   */
  const refreshWorkspace = (workspacePath, alias) => {
    if (typeof workspacePath !== 'string' || !workspacePath.startsWith('ssh://')) return Promise.resolve({ hash: '', text: '', files: [], errors: [] })
    const pending = inflight.get(workspacePath)
    if (pending !== undefined) return pending
    const parsedAlias = alias ?? aliasOf(workspacePath)
    const job = compute(workspacePath, parsedAlias)
      .then((result) => {
        cache.set(workspacePath, result)
        return result
      })
      .catch((error) => {
        logger?.warn?.(`ssh-workspace: could not merge agent prompts for ${workspacePath}: ${error instanceof Error ? error.message : String(error)}`)
        return { hash: '', text: '', files: [], errors: [{ level: 'merge', kind: 'internal', id: '', message: error instanceof Error ? error.message : String(error) }] }
      })
      .finally(() => { inflight.delete(workspacePath) })
    inflight.set(workspacePath, job)
    return job
  }

  return {
    /** Exposed for tests and the panel's status surface. */
    get size () { return cache.size },

    /**
     * The merged prompt text for a session cwd — the system-prompt hook.
     *
     * Synchronous by contract (the assembly calls `text` as a plain function).
     * On a fingerprint mismatch the stale value is dropped, an async refresh
     * starts, and `''` is returned for THIS step; the next step serves the
     * fresh text. Never throws.
     *
     * @param {unknown} cwd - the session's working directory.
     * @returns {string} the merged prompt, or `''` when not applicable yet.
     */
    serveForCwd (cwd) {
      try {
        if (typeof cwd !== 'string' || !cwd.startsWith('ssh://')) return ''
        const target = longestRootFor(cwd)
        if (target === undefined) return ''
        const levels = levelsFor(target)
        const cached = cache.get(target)
        if (cached !== undefined && cached.hash === levels.hash) return cached.text
        void refreshWorkspace(target)
        return ''
      } catch {
        return ''
      }
    },

    /**
     * The workspace path a session cwd resolves to (longest served root).
     *
     * @param {string} cwd - `ssh://alias/…` session cwd.
     * @returns {string | undefined} the canonical workspace path.
     */
    resolveWorkspace (cwd) {
      return longestRootFor(cwd)
    },

    /**
     * The cached result for one workspace, when fresh.
     *
     * @param {string} workspacePath - canonical workspace path.
     * @returns {{hash: string, text: string, files: string[], errors: Array<object>} | undefined} the cached entry.
     */
    peek (workspacePath) {
      const cached = cache.get(workspacePath)
      if (cached === undefined) return undefined
      return cached.hash === levelsFor(workspacePath).hash ? cached : undefined
    },

    /**
     * Compute fresh (bypassing any cache) and update the cache.
     *
     * The panel's preview route uses this: the shown file list is exactly
     * what the next model step will load, and the merge it triggers doubles
     * as a cache warm-up.
     *
     * @param {string} workspacePath - canonical workspace path.
     * @returns {Promise<{hash: string, text: string, files: string[], errors: Array<object>}>} the fresh result.
     */
    async preview (workspacePath) {
      const result = await compute(workspacePath)
      cache.set(workspacePath, result)
      return result
    },

    refreshWorkspace,

    /**
     * Refresh every workspace in the given list (mounted roots).
     *
     * @param {string[]} [workspacePaths] - defaults to the currently served roots.
     * @returns {Promise<unknown>} settles when all refreshes settle.
     */
    refreshAll (workspacePaths) {
      const list = Array.isArray(workspacePaths) ? workspacePaths : roots()
      return Promise.allSettled(list.map(path => refreshWorkspace(path)))
    },

    /** Drop one workspace's cached entry (unmount / config change). */
    invalidateWorkspace (workspacePath) {
      cache.delete(workspacePath)
    },

    /** Drop every cached entry of one host alias (host save/delete/rename). */
    invalidateAlias (alias) {
      for (const path of [...cache.keys()]) {
        if (aliasOf(path) === alias) cache.delete(path)
      }
    },

    /** Drop the whole cache (global config change). */
    invalidateAll () {
      cache.clear()
    },
  }

  /**
   * The served root that contains `cwd`, longest remote path first.
   *
   * @param {string} cwd - session cwd.
   * @returns {string | undefined} the canonical workspace path.
   */
  function longestRootFor (cwd) {
    if (typeof cwd !== 'string' || !cwd.startsWith('ssh://')) return undefined
    const slash = cwd.indexOf('/', 'ssh://'.length)
    if (slash === -1) return undefined
    const alias = cwd.slice('ssh://'.length, slash)
    const remotePath = cwd.slice(slash)
    let best
    for (const root of roots() ?? []) {
      if (typeof root !== 'string' || !root.startsWith(`ssh://${alias}/`)) continue
      const rootPath = root.slice(`ssh://${alias}`.length)
      if (remotePath === rootPath || remotePath.startsWith(`${rootPath === '/' ? '' : rootPath}/`)) {
        if (best === undefined || rootPath.length > best.slice(`ssh://${alias}`.length).length) best = root
      }
    }
    return best
  }
}
