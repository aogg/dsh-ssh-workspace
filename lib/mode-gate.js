/**
 * The remote-mutation gate: one answer to "may this session change the remote
 * host?", shared by every surface that can.
 *
 * Why a shared module rather than a check per tool: the plugin owns SIX ways to
 * write to a host, and they do not share a call path.
 *
 * | surface                        | reaches the host through     |
 * | ------------------------------ | ---------------------------- |
 * | `write` / `edit` tools         | `ctx.fs` router   (gated)    |
 * | `ssh_workspace_transfer`       | SFTP staging      (gated)    |
 * | `ssh_workspace_exec`           | `engine.exec`     ← here      |
 * | `ssh_workspace_shell`          | PTY channel       ← here      |
 * | `bash` / `pwsh` with ssh cwd   | `ctx.shell`       ← here      |
 * | `terminal_open` with ssh cwd   | `ctx.subprocess.spawnTerminal` ← here |
 * | the sidebar's browser terminal | same primitive, called directly ← here |
 *
 * The terminal surface needs a word of explanation, because the obvious place
 * to gate it is wrong: `spawnTerminal`'s spec carries no owner, and TWO callers
 * reach it — `ctx.terminals` (for `terminal_open` / `terminal_send`) and
 * `dsh-api-terminal-controller` (the sidebar terminal), which bypasses
 * `ctx.terminals` entirely. A gate on `ctx.terminals.spawn` would therefore
 * miss the second path while a test of the tool path stayed green. The gate
 * lives in `patch-terminal.js` instead — the one point both converge on — and
 * resolves the session from `spec.env.DSH_SESSION_ID`, which both stamp.
 *
 * Gating only the filesystem family was a real defect, not a theoretical one:
 * a `read-only` session ran `rm /home/qiyk/test/test.py` through
 * `ssh_workspace_exec` and got exit 0, because command execution never consults
 * the mode at all.
 *
 * The filesystem half of the gate lives with the router (`remote-fs.js`), but the
 * SCOPE question — "is this target inside the session's own workspace?" — is
 * answered here too, because the transfer tool needs the same answer and the two
 * must not drift. See {@link workspaceWriteScopeRefusal}.
 *
 * Why command execution is refused outright rather than filtered: the local
 * sandbox answers "may this command write?" by confining the PROCESS — a kernel
 * boundary (bwrap / seatbelt / an ACL-restricted token). None of that crosses
 * an SSH connection: the remote command runs as the remote login user, with
 * that user's full permissions. There is no seam to hand a `workspaceRoot` to,
 * and parsing a command line to guess whether it mutates is not a boundary —
 * `sh -c 'rm -rf ~'` reads as pure text.
 *
 * So the choice is: allow arbitrary remote commands and let the mode be a lie,
 * or refuse them under `read-only` and keep the mode honest. This module does
 * the second, and says so in the refusal so the model does not retry blindly.
 *
 * Reads are NOT lost: `read` / `glob` / `grep` / `ops_*` serve them over SFTP
 * and are unaffected. What is lost is arbitrary command execution (a remote
 * `git status`, a build) — which the user unlocks by switching the session to
 * `workspace-write` or `danger-full-access`, an explicit, visible action.
 *
 * @module @shiqyka/dsh-ssh-workspace/mode-gate
 */

/**
 * The mode that forbids mutation. Named once so the three seams cannot drift.
 *
 * @type {string}
 */
export const READ_ONLY = 'read-only'

/**
 * Resolve a session's effective sandbox mode.
 *
 * Three outcomes, deliberately distinguished:
 * - the effective mode string, when a policy service is composed;
 * - `undefined`, when the composition has NO sandbox policy — an unconfined
 *   deployment must behave as before rather than silently become read-only;
 * - `'read-only'`, when a policy exists but cannot resolve. Failing closed is
 *   the safe direction for a mutation gate: the cost is a refused command the
 *   user can re-issue after switching modes, against silently writing while the
 *   session says "view only".
 *
 * @param {object} ctx - host plugin context.
 * @param {object} [session] - the calling agent's session, when there is one.
 * @returns {string | undefined} the effective mode, `undefined` when unconfined.
 */
export function sessionModeOf (ctx, session) {
  return sessionPolicyOf(ctx, session)?.mode
}

/**
 * Resolve a session's whole policy — mode AND workspace root — with the reason
 * attached when it could not be resolved.
 *
 * The distinction between "the policy says read-only" and "the policy could not
 * be read" matters for the MESSAGE, not the decision: both refuse, but only the
 * first may claim the user chose `read-only`. Reporting a broken policy service
 * as a deliberate "view only" setting sends the user to a mode switch that
 * cannot help, and hides a real defect behind a plausible sentence.
 *
 * Why the resolution can fail at all: `SandboxPolicyService.resolve` runs
 * `session.header.cwd` through `path.isAbsolute`, and an `ssh://` spelling is
 * only "absolute" because `fs-shim.js` patches `node:path`. If that patch is
 * missing — a different host build, an install that skipped it — every remote
 * session throws here. That is a bug in the wiring, and it must be readable as
 * one.
 *
 * @param {object} ctx - host plugin context.
 * @param {object} [session] - the calling agent's session, when there is one.
 * @returns {{mode: string, workspaceRoot?: string, unresolved?: true, reason?: string} | undefined}
 *   `undefined` when the composition has no sandbox policy at all.
 */
export function sessionPolicyOf (ctx, session) {
  const policy = ctx?.get?.('sandboxPolicy') ?? ctx?.sandboxPolicy
  if (policy === undefined || policy === null || typeof policy.resolve !== 'function') return undefined
  try {
    const resolved = policy.resolve(session === undefined || session === null ? {} : { session })
    const mode = typeof resolved?.mode === 'string' ? resolved.mode : READ_ONLY
    const root = typeof resolved?.workspaceRoot === 'string' && resolved.workspaceRoot !== '' ? resolved.workspaceRoot : undefined
    return root === undefined ? { mode } : { mode, workspaceRoot: root }
  } catch (error) {
    return {
      mode: READ_ONLY,
      unresolved: true,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * The mode carried by a resolved execution spec.
 *
 * The shell seam forwards the caller's per-call policy (`sandboxPolicy`), which
 * is the ONLY carrier of a session override — a session switched to
 * `read-only` logs a `sandbox/mode` event that reaches the executor no other
 * way. An absent policy means an unsandboxed caller, not a denial.
 *
 * @param {object} [spec] - a resolved execution spec.
 * @returns {string | undefined} the effective mode, `undefined` when unsandboxed.
 */
export function specModeOf (spec) {
  const mode = spec?.sandboxPolicy?.mode
  return typeof mode === 'string' && mode !== '' ? mode : undefined
}

/**
 * The refusal text for a refused remote command.
 *
 * Written to be actionable in one read: it names the mode (so the model knows
 * this is a policy denial and not a broken path), names the target, states why
 * it cannot be confined, and lists what still works. It deliberately does NOT
 * promise `sandbox_permissions`: the bash/pwsh tools add that hint themselves
 * when escalation is advertised, and the plugin's own tools have no such field —
 * inventing one here would send the model after a parameter that does not exist.
 *
 * Two different causes produce this refusal and they must not share a sentence:
 * a session the user actually set to `read-only` (switch the mode and retry
 * works), and a policy that could not be RESOLVED (switching the mode cannot
 * help, because the resolver is what is broken). The second is reported as the
 * wiring problem it is — `sessionModeOf`'s fail-closed default must not be
 * dressed up as the user's deliberate choice.
 *
 * @param {string} action - what was refused, e.g. `run a command`.
 * @param {string} [target] - the host or workspace the action named.
 * @param {{reason?: string}} [trouble] - present when the policy failed to resolve.
 * @returns {string} the model-facing refusal.
 */
export function remoteReadOnlyMessage (action, target, trouble) {
  const where = typeof target === 'string' && target !== '' ? ` on ${target}` : ''
  if (typeof trouble?.reason === 'string' && trouble.reason !== '') {
    return `cannot ${action}${where}: the session's sandbox policy could not be resolved (${trouble.reason}), ` +
      'so this remote command was refused rather than run unconfined. This is a wiring problem, not a mode you chose — ' +
      'switching the session mode will not help. The resolver needs the workspace path to read as absolute, which for an ' +
      'ssh:// workspace depends on the plugin\'s node:path patch having been installed at load time. ' +
      'Reading still works through read / glob / grep / ops_* (they use SFTP and need no command).'
  }
  return `cannot ${action}${where}: the session sandbox mode is "${READ_ONLY}" and a remote command cannot be confined — ` +
    'the local file sandbox (bwrap / seatbelt / an ACL-restricted token) does not cross an SSH connection, so the remote ' +
    'command would run as the remote login user with that user\'s full permissions. ' +
    'Reading still works through read / glob / grep / ops_* (they use SFTP and need no command). ' +
    'To run commands here, switch this session to workspace-write or danger-full-access.'
}

/**
 * The refusal for a write that stays on a mounted host but leaves the SESSION's
 * own workspace.
 *
 * `workspace-write` is a containment promise, not a "somewhere on the right host"
 * promise: the local backend enforces it with `writableRoots(policy)`, whose first
 * entry is `policy.workspaceRoot`. The remote half used to answer a weaker
 * question — "is this inside ANY mounted root?" — and the root set is
 * deployment-wide, so a session rooted at `ssh://qiyk/home/dev/proj` could write
 * a sibling root, and even a root on a DIFFERENT host, without any local
 * counterpart.
 *
 * The previous justification for that was wrong, not merely unfortunate: it
 * claimed `workspaceRoot` is always a path on THIS machine. Measured against the
 * real service, `resolve()` returns `session.header.cwd` verbatim, and for a
 * remote session that is the `ssh://` spelling — usable for comparison, which is
 * exactly what happens here.
 *
 * An agentless call has no session cwd, so its root is the deployment's local
 * one. That spelling cannot be compared to a remote target, and it must not be:
 * it would refuse every write. {@link writeScopeRootOf} returns undefined there
 * and the caller falls back to the mounted-root fence alone.
 *
 * @param {string} mode - the effective sandbox mode.
 * @param {string | undefined} scopeRoot - the session's `ssh://` workspace root.
 * @param {{alias: string, remotePath: string, displayPath: string}} parts - the target.
 * @returns {string | undefined} the refusal text, or undefined when in scope.
 */
export function workspaceWriteScopeRefusal (mode, scopeRoot, parts) {
  if (mode !== 'workspace-write') return undefined
  if (scopeRoot === undefined || scopeRoot === null || scopeRoot === '') return undefined
  const root = remotePartsOfSpelling(scopeRoot)
  // A local root (no session cwd) says nothing about a directory on the host.
  if (root === undefined) return undefined
  // Normalise the target too, not just the root: the router hands over an
  // already-normalised path, but this helper is also reachable from the transfer
  // tool with a caller-supplied spelling, and `/ws/../elsewhere/x` must not read
  // as inside `/ws` because of how it was typed.
  const target = normalizeRemoteSpelling(parts.remotePath)
  if (root.alias !== parts.alias) {
    return `cannot write "${parts.displayPath}": file access denied under workspace-write mode — ` +
      `this session's workspace is on host "${root.alias}", not on "${parts.alias}". ` +
      'Switch this session to danger-full-access to write on another host.'
  }
  if (!isUnderRemoteRoot(root.remotePath, target)) {
    return `cannot write "${parts.displayPath}": file access denied under workspace-write mode — ` +
      `the session workspace is "${scopeRoot}", and workspace-write only permits writing inside it. ` +
      'Switch this session to danger-full-access for paths elsewhere on the host.'
  }
  return undefined
}

/**
 * The session workspace root, when it is a remote spelling that can be compared
 * against a remote target.
 *
 * @param {{mode?: string, workspaceRoot?: string} | undefined} policy - a resolved policy.
 * @returns {string | undefined} the `ssh://` root, or undefined for a local one.
 */
export function writeScopeRootOf (policy) {
  const root = policy?.workspaceRoot
  if (typeof root !== 'string' || root === '') return undefined
  return remotePartsOfSpelling(root) === undefined ? undefined : root
}

/**
 * Split an `ssh://alias/path` spelling.
 *
 * Kept local rather than imported from `protocol.js` so this module stays free of
 * peer dependencies: it is loaded by the shell and terminal seams, which must
 * work even when the filesystem half is not composed.
 *
 * @param {string} value - a candidate spelling.
 * @returns {{alias: string, remotePath: string} | undefined} the parts, or undefined.
 */
function remotePartsOfSpelling (value) {
  if (typeof value !== 'string' || !value.startsWith('ssh://')) return undefined
  const match = /^ssh:\/\/([^/]+)(\/.*)?$/u.exec(value)
  if (match === null) return undefined
  return { alias: match[1], remotePath: normalizeRemoteSpelling(match[2]) }
}

/**
 * Collapse a remote path lexically: `//` collapses, `.` drops, `..` pops without
 * escaping the root.
 *
 * @param {string} [raw] - the path portion of a spelling.
 * @returns {string} the normalized absolute path.
 */
function normalizeRemoteSpelling (raw) {
  const segments = []
  for (const segment of String(raw ?? '/').split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return `/${segments.join('/')}`
}

/**
 * Whether `child` is `parent` or lies beneath it.
 *
 * @param {string} parent - the containing remote path.
 * @param {string} child - the candidate descendant.
 * @returns {boolean} true when contained.
 */
function isUnderRemoteRoot (parent, child) {
  if (child === parent) return true
  return child.startsWith(parent === '/' ? '/' : `${parent}/`)
}

/**
 * Refuse a remote command unless the mode permits arbitrary host execution.
 *
 * `danger-full-access`, `workspace-write`, and an absent mode (a composition
 * with no sandbox at all) all allow. For `workspace-write` this is a real
 * limitation and is documented as one: a command cannot be narrowed to the
 * session workspace remotely, because containing a PROCESS needs the kernel
 * boundary that does not cross SSH. File writes are narrowed instead (see
 * {@link workspaceWriteScopeRefusal}); a command that writes outside the
 * workspace remains possible, and no text check would change that.
 *
 * What the mode still buys for commands is the one answer it can give honestly:
 * `read-only` refuses them.
 *
 * @param {string | object | undefined} mode - the effective sandbox mode, or a
 *   resolved policy object (so the "could not resolve" cause travels with it).
 * @param {string} action - what is being refused, for the message.
 * @param {string} [target] - the host or workspace named by the call.
 * @returns {void}
 * @throws {Error} when the mode forbids executing a remote command.
 */
export function assertRemoteCommandAllowed (mode, action, target) {
  // Accepting the resolved policy as well as the bare string keeps the five
  // call sites from having to destructure it — and, more importantly, lets the
  // resolution FAILURE reach the message instead of being flattened into an
  // indistinguishable "read-only".
  const effective = typeof mode === 'object' && mode !== null ? mode.mode : mode
  if (effective !== READ_ONLY) return
  const trouble = typeof mode === 'object' && mode !== null && mode.unresolved === true
    ? { reason: mode.reason }
    : undefined
  throw new Error(remoteReadOnlyMessage(action, target, trouble))
}
