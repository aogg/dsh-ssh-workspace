/**
 * HTTP route family for the remote-workspace plugin browser half.
 *
 * Loopback-only by default: these endpoints mount and unmount workspaces on
 * the host, so LAN-exposed deployments must not serve them. The fence mirrors
 * dsh-ssh's approach — reject any request whose remote address is not a
 * loopback one — and additionally requires the `Host` header to name this
 * server by one of its loopback spellings, so a DNS-rebinding page (which
 * reaches 127.0.0.1 from the browser while sending its own hostname) is
 * refused too. POST endpoints further require a JSON content type: a
 * cross-site HTML form (which can only send text/plain, urlencoded, or
 * multipart, and may craft a text/plain body that parses as JSON) cannot set
 * it, while the plugin's own browser half always does.
 *
 * The `allowLan` config relaxes the fence for LAN deployments (a webserver
 * bound to 0.0.0.0 reached from a LAN browser): the remote address may then be
 * any private-network address (IPv4 RFC1918, IPv6 ULA or link-local), and the
 * `Host` header must name this server — one of the machine's own addresses on
 * the listening port, a configured `allowedHosts` entry, or a private IP
 * literal (a Docker port mapping or a reverse proxy shows the browser the
 * HOST's address, not the one this process sees on its interface). A bare
 * hostname is still accepted only when `allowedHosts` lists it, which is what
 * keeps the anti-rebinding property: a rebound page must send its own
 * hostname and that name is not in any list. Without `allowLan` nothing
 * changes: the refusals keep their historical wording.
 *
 * @module @shiqyka/dsh-ssh-workspace/routes
 */

import os from 'node:os'
import { randomBytes } from 'node:crypto'
import { formatRemotePath, normalizeRemotePath, parseRemotePath } from './protocol.js'
import { probeLocalPort } from './forward.js'
import { normalizeHostDefaultPath } from './store.js'
import { LOCAL_EXEC_SKILL_NAME } from './local-exec-skill.js'
import { HOST_KEY_MISMATCH } from './connection-errors.js'
import { fenceUploadTarget, remoteParentOf, sftpUnlink, transferFile, uploadTree } from './transfer.js'
import {
  niubashRootFor,
  normalizeWindowsDir,
  provisionWinBash,
  resolvePayloadPin,
  resolvedPayload,
} from './bash-payload.js'
import {
  bashLaunchPrefix,
  buildNiubashProbeScript,
  niubashCandidateOfHit,
  niubashCandidates,
  parseBashProbeOutput,
  verifyBashExecutable,
} from './win-bash.js'
import { windowsRemotePath } from './engine.js'
import { SSH_WORKSPACE_GUIDANCE, niubashGuidanceSection } from './guidance.js'
import {
  sftpCloseHandle,
  sftpMkdirp,
  sftpOpenHandle,
  sftpPublishRename,
  sftpReadHandle,
  sftpStatOrNull,
  sftpWriteHandle,
} from './remote-fs.js'

/**
 * Refresh the merged agent prompts of every mounted workspace on one alias.
 *
 * Fire-and-forget: a refresh failure never fails the HTTP request that caused
 * it (the cache simply stays empty and the next model step recomputes).
 *
 * @param {object | undefined} prompts - the agent-prompt registry (see agent-prompts.js).
 * @param {string[]} mounted - canonical workspace paths currently served.
 * @param {string} alias - the host alias whose workspaces changed.
 * @returns {void}
 */
function refreshAliasPrompts (prompts, mounted, alias) {
  if (prompts === undefined || prompts === null) return
  const targets = mounted.filter(path => path.startsWith(`ssh://${alias}/`))
  void prompts.refreshAll(targets)
}

/**
 * Probe write access on one remote directory by creating a real file over SFTP.
 *
 * The previous probe shelled out (`test -w <path>`), which lies on Windows
 * hosts: their default shell is cmd.exe, which has no `test`, so every probe
 * exited non-zero and every directory — even the user's own profile — reported
 * as unwritable. Creating a file through the very SFTP channel the agent will
 * use is free of shell dialects and answers exactly the question that matters:
 * "can this account put bytes here?".
 *
 * Semantics differ from the old probe on purpose. A failed create IS the
 * answer (the directory is not writable to this account), so a permission
 * failure reports `writable: false`; only the readdir before this probe can
 * still fail the whole request. Nothing here may take the /ls route down
 * though, so every throw is caught inside.
 *
 * @param {object} sftp - the SFTP channel handed to the withSftp callback.
 * @param {string} dir - absolute remote directory that listed successfully.
 * @returns {Promise<boolean>} true when an empty file could be created in dir.
 */
async function probeWritableViaSftp (sftp, dir) {
  // Random suffix: a concurrent ls or a leftover probe file can never collide
  // with a real file, and the 'wx' open below never overwrites one either.
  const probePath = `${dir}/.dsh-wprobe-${randomBytes(6).toString('hex')}`
  try {
    try {
      // First choice 'wx': create-exclusive, so an existing file (ours or not)
      // makes the open fail instead of being clobbered.
      const handle = await sftpOpenHandle(sftp, probePath, 'wx', probePath)
      try { await sftpWriteHandle(sftp, handle, Buffer.alloc(0), probePath) } finally { await sftpCloseHandle(sftp, handle) }
      return true
    } catch {
      // A few SFTP servers reject the 'wx' flag string itself; retry once with
      // the default flag. The random name keeps the clobber risk negligible.
      const handle = await sftpOpenHandle(sftp, probePath, 'w', probePath)
      try { await sftpWriteHandle(sftp, handle, Buffer.alloc(0), probePath) } finally { await sftpCloseHandle(sftp, handle) }
      return true
    }
  } catch {
    // Both creates failed (permission denied, read-only share, …): that is the
    // probe's verdict, not a route error.
    return false
  } finally {
    // Clean up the probe file; an unlink failure never changes the verdict.
    await sftpUnlink(sftp, probePath)
  }
}

/** Route path constants. */
export const ROUTES = {
  hosts: '/api/dsh-ssh-workspace/hosts',
  hostSave: '/api/dsh-ssh-workspace/hosts/save',
  hostDefaultPath: '/api/dsh-ssh-workspace/hosts/default-path',
  hostDelete: '/api/dsh-ssh-workspace/hosts/delete',
  hostForgetKey: '/api/dsh-ssh-workspace/hosts/forget-key',
  hostDisconnect: '/api/dsh-ssh-workspace/hosts/disconnect',
  test: '/api/dsh-ssh-workspace/test',
  probe: '/api/dsh-ssh-workspace/probe',
  ls: '/api/dsh-ssh-workspace/ls',
  status: '/api/dsh-ssh-workspace/status',
  mount: '/api/dsh-ssh-workspace/mount',
  unmount: '/api/dsh-ssh-workspace/unmount',
  enable: '/api/dsh-ssh-workspace/enable',
  forward: '/api/dsh-ssh-workspace/forward',
  unforward: '/api/dsh-ssh-workspace/unforward',
  forwardSave: '/api/dsh-ssh-workspace/forward/save',
  forwardToggle: '/api/dsh-ssh-workspace/forward/toggle',
  forwardDelete: '/api/dsh-ssh-workspace/forward/delete',
  forwardRemember: '/api/dsh-ssh-workspace/forward/remember',
  forwardProbe: '/api/dsh-ssh-workspace/forward/probe',
  forwardSettings: '/api/dsh-ssh-workspace/forward/settings',
  transfer: '/api/dsh-ssh-workspace/transfer',
  download: '/api/dsh-ssh-workspace/download',
  upload: '/api/dsh-ssh-workspace/upload',
  agentPrompts: '/api/dsh-ssh-workspace/agent-prompts',
  agentPromptsGlobal: '/api/dsh-ssh-workspace/agent-prompts/global',
  agentPromptsHost: '/api/dsh-ssh-workspace/agent-prompts/host',
  agentPromptsWorkspace: '/api/dsh-ssh-workspace/agent-prompts/workspace',
  agentPromptsPreview: '/api/dsh-ssh-workspace/agent-prompts/preview',
  skill: '/api/dsh-ssh-workspace/skill',
  niubashStatus: '/api/dsh-ssh-workspace/niubash/status',
  niubashInit: '/api/dsh-ssh-workspace/niubash/init',
  injected: '/api/dsh-ssh-workspace/injected',
  floatingList: '/api/dsh-ssh-workspace/floating/list',
  floatingSave: '/api/dsh-ssh-workspace/floating/save',
  floatingUpdate: '/api/dsh-ssh-workspace/floating/update',
  floatingDelete: '/api/dsh-ssh-workspace/floating/delete',
  floatingReorder: '/api/dsh-ssh-workspace/floating/reorder',
}

/**
 * Check whether a request originated on the loopback interface.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {boolean} true when the remote address is loopback.
 */
function isLoopbackRequest (req) {
  const addr = req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? ''
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || addr === 'localhost'
}

/**
 * Check the request's `Host` header against the loopback names of the port
 * this server actually listens on.
 *
 * A loopback `remoteAddress` alone still lets a public page reach these
 * endpoints: a DNS-rebinding attack re-resolves an attacker-controlled
 * hostname to 127.0.0.1, and the browser then treats the request as
 * same-origin. Requiring the Host the browser sent to be one of the
 * loopback spellings of the listening port closes that path — a rebound
 * page's requests carry its own hostname and are refused here.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {boolean} true when the Host header names this loopback server.
 */
function isLoopbackHostHeader (req) {
  const port = req.socket?.localPort
  const host = req.headers?.host
  if (typeof host !== 'string' || host === '' || !Number.isInteger(port)) return false
  const allowed = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`])
  return allowed.has(host.toLowerCase())
}

/**
 * Unwrap the IPv4-mapped IPv6 spelling of an address.
 *
 * A socket may report `::ffff:192.168.1.10` for an IPv4 peer; the network
 * classes below are defined per family, so the mapped form is reduced to its
 * IPv4 part before classification.
 *
 * @param {string} address - the raw socket address.
 * @returns {string | undefined} the embedded IPv4 address, when present.
 */
function mappedIpv4Of (address) {
  const match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(address)
  return match === null ? undefined : match[1]
}

/**
 * Check whether an address is a loopback spelling, mapped forms included.
 *
 * @param {string} address - the raw socket address (may carry an IPv6 zone suffix).
 * @returns {boolean} true when the address names this host itself.
 */
function isLoopbackAddress (address) {
  const bare = address.split('%', 1)[0]
  if (bare === '127.0.0.1' || bare === '::1' || bare === 'localhost') return true
  return mappedIpv4Of(bare) === '127.0.0.1'
}

/**
 * Check whether an IPv4 address is in one of the RFC1918 private ranges.
 *
 * @param {string} address - a dotted-quad IPv4 address.
 * @returns {boolean} true for 10/8, 172.16/12 and 192.168/16.
 */
function isRfc1918 (address) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(address)
  if (match === null) return false
  const first = Number(match[1])
  const second = Number(match[2])
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
}

/**
 * Check whether an address belongs to a private network.
 *
 * `allowLan` accepts exactly these (plus loopback) as request origins:
 * addresses the public internet cannot route to — IPv4 RFC1918, IPv6 unique
 * local (fc00::/7) and IPv6 link-local (fe80::/10). A public address is still
 * refused: those endpoints mount workspaces and move credentials, and a
 * loopback-or-private rule keeps them off the open internet even when the
 * webserver is bound wide.
 *
 * @param {string} address - the raw socket address (may carry an IPv6 zone suffix).
 * @returns {boolean} true when the address is a private-network one.
 */
function isPrivateNetworkAddress (address) {
  const bare = address.split('%', 1)[0].toLowerCase()
  const v4 = mappedIpv4Of(bare) ?? bare
  if (isRfc1918(v4)) return true
  // fc00::/7 — hex first byte fc..fd; fe80::/10 — first byte fe80..febf.
  // The first hextet of either range always spells out four digits (it starts
  // with `f`, so no leading zero could be dropped).
  return /^f[cd][0-9a-f]{2}:/u.test(bare) || /^fe[89ab][0-9a-f]:/u.test(bare)
}

/**
 * Collect the `Host` spellings that name THIS server on the given port.
 *
 * The browser sends as `Host` the address it dialled, so on a LAN deployment
 * that is one of the machine's own interface addresses plus the listening
 * port. The list comes from `os.networkInterfaces()` (every non-internal
 * address, bracketed when IPv6), joined by the loopback spellings the
 * loopback-only mode has always accepted. Because a rebound page must send
 * its own hostname to complete the DNS-rebinding attack, an attacker hostname
 * is still absent from this list — the anti-rebinding property carries over
 * from the loopback fence unchanged.
 *
 * @param {number} port - the port this server actually listens on.
 * @returns {Set<string>} lowercase `Host` header values naming this server.
 */
function serverHostCandidates (port) {
  const allowed = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`])
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const entry of interfaces ?? []) {
      if (entry?.internal === true) continue
      if (typeof entry?.address !== 'string' || entry.address === '') continue
      const address = entry.address
      allowed.add(address.includes(':') ? `[${address.toLowerCase()}]:${port}` : `${address.toLowerCase()}:${port}`)
    }
  }
  return allowed
}

/**
 * Check whether a `Host` header is a bare private IP LITERAL, port optional.
 *
 * Why this is admitted at all, given the loopback fence refuses unknown Hosts:
 * the address a browser sends as `Host` is the one it dialled, which is not
 * necessarily one of this machine's own interfaces. A Docker `-p
 * 3080:3080` mapping, an `ssh -L` tunnel, or a reverse proxy all show the
 * browser the HOST's address, and the container only ever sees its own
 * (`172.21.x.y` while the browser dialled `172.19.x.y`). Refusing those made
 * the plugin unusable in the deployment shape it is most often installed in.
 *
 * The anti-rebinding property is not weakened, because a rebinding attack must
 * send the attacker's OWN HOSTNAME as `Host` — that is what makes the request
 * same-origin for the browser — and a hostname is not an IP literal. Private
 * literals are also not routable from the public internet, and public IP
 * literals stay refused (they would name a machine that is not this one, or
 * invite an open-internet origin).
 *
 * IPv6 literals must be bracketed (RFC 3986 authority syntax, and the only
 * unambiguous spelling next to an optional port). Only the private ranges
 * count, per {@link isPrivateNetworkAddress} — a loopback literal is already
 * accepted by the machine's own candidate list.
 *
 * @param {string} host - the lowercased `Host` header value.
 * @returns {boolean} true when the header is a private IPv4/IPv6 literal.
 */
function isPrivateHostLiteral (host) {
  // Bracketed IPv6, with or without a port: `[fd12:3456::1]:4074`. The zone
  // suffix (percent-encoded in a Host header) is tolerated because a
  // link-local literal is a legitimate spelling.
  const bracketed = /^\[([0-9a-z:.%]+)\](?::\d{1,5})?$/u.exec(host)
  if (bracketed !== null) return isPrivateNetworkAddress(bracketed[1])
  // Dotted quad, with or without a port: `192.168.1.10:4074`.
  const quad = /^(\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})?$/u.exec(host)
  if (quad !== null) return isRfc1918(quad[1])
  return false
}

/**
 * Check the request's `Host` header against the machine's own addresses, the
 * configured extras and private IP literals.
 *
 * A configured `allowedHosts` entry matches either verbatim or suffixed with
 * the listening port, so deployments behind a name the machine's interfaces
 * do not know (a LAN hostname, a reverse-proxied spelling) can admit it
 * explicitly without opening the door to every Host value.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {string[]} extraHosts - lowercase `allowedHosts` entries.
 * @returns {boolean} true when the Host header names this server.
 */
function isLanHostHeader (req, extraHosts) {
  const port = req.socket?.localPort
  const host = req.headers?.host
  if (typeof host !== 'string' || host === '') return false
  const lowered = host.toLowerCase()
  if (Number.isInteger(port) && serverHostCandidates(port).has(lowered)) return true
  if (extraHosts.some(entry => lowered === entry || (Number.isInteger(port) && lowered === `${entry}:${port}`))) return true
  return isPrivateHostLiteral(lowered)
}

/**
 * Check the request's `Content-Type` names JSON.
 *
 * Cross-site HTML forms can only send `text/plain`, `urlencoded`, or
 * `multipart` bodies — and a crafted `text/plain` body can still parse as
 * JSON. Requiring the JSON media type on POST endpoints closes that CSRF
 * path without a token; `fetch` with a non-simple content type triggers a
 * CORS preflight this server never approves.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {boolean} true when the declared type (parameters aside) is application/json.
 */
function isJsonContentType (req) {
  const header = req.headers?.['content-type']
  if (typeof header !== 'string') return false
  return header.split(';', 1)[0].trim().toLowerCase() === 'application/json'
}

/**
 * The HTTP status a failed `/download` should carry.
 *
 * The browser saves whatever body a 2xx response has, so "the file could not
 * be read" has to reach it as a non-2xx status — that is the only signal the
 * download flow honours. Codes come from the `FsError` the read path raises;
 * anything unrecognised is a genuine server-side failure, not a missing file.
 *
 * @param {unknown} error - the failure raised while opening or streaming.
 * @returns {number} the status to answer with.
 */
function statusForDownloadError (error) {
  switch (error?.code) {
    case 'FS_NOT_FOUND': return 404
    case 'FS_PERMISSION_DENIED': return 403
    case 'FS_SANDBOX_DENIED': return 403
    // The mount fence: the target exists in principle, but this deployment is
    // not serving that directory, so the request is forbidden rather than absent.
    case 'FS_OUTSIDE_WORKSPACE': return 403
    case 'FS_NOT_REGULAR_FILE': return 400
    case 'FS_NOT_DIRECTORY': return 400
    default: return 500
  }
}

/** Write a JSON response. */
function writeJson (res, status, body) {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  } catch { /* response already closed */ }
}

/**
 * The JSON body for a route step that failed inside the engine.
 *
 * Every connection failure reaches the browser as `{ error: message }`; when
 * the failure is a HOST-KEY MISMATCH the two fingerprints travel alongside as
 * structured fields (`code` + `mismatch`), because the panel renders them and
 * offers "forget this host key and retry" in place. Parsing the English
 * message for fingerprints would break the moment the wording moved, and the
 * engine already did the work of structuring them (see engine.js
 * `hostKeyMismatchError`). Routes that surface engine errors use this helper
 * so no call site forgets the structured half.
 *
 * @param {unknown} error - the thrown failure.
 * @returns {object} the JSON body (always carries `error`).
 */
function routeErrorPayload (error) {
  const body = { error: error instanceof Error ? error.message : String(error) }
  if (error instanceof Error && error.code === HOST_KEY_MISMATCH && error.mismatch !== undefined && error.mismatch !== null) {
    body.code = error.code
    body.mismatch = error.mismatch
  }
  return body
}

/** Read a JSON request body, returning null on failure. */
async function readJsonBody (req) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 4 * 1024 * 1024) { req.destroy(); resolve(null) }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { resolve(null) }
    })
    req.on('error', () => resolve(null))
  })
}

/** Extract a decoded query parameter. */
function queryParam (url, name) {
  const value = url.searchParams.get(name)
  return value === null ? undefined : value
}

/** Resolve an SFTP path (`.` = the login directory) to an absolute one. */
function sftpRealpath (sftp, target) {
  return new Promise((resolve, reject) => {
    sftp.realpath(target, (err, resolved) => {
      if (err) reject(err)
      else if (typeof resolved !== 'string' || !resolved.startsWith('/')) reject(new Error(`realpath did not return an absolute path: ${String(resolved)}`))
      else resolve(resolved)
    })
  })
}

/**
 * List one remote directory over an SFTP channel — the listing contract shared
 * by `GET /ls` (saved hosts) and the probe route's `ls` action (drafts).
 *
 * One place, so the two channels cannot drift apart: `.` resolves to the SSH
 * login directory (echoed back so the client can display a real absolute
 * path), entries map to the flat `{name, type, size, mtime}` rows, and the
 * writability verdict rides on the same channel (see probeWritableViaSftp).
 *
 * @param {object} sftp - the SFTP channel to list through.
 * @param {string} requestedPath - absolute remote path, or '' for the login dir.
 * @returns {Promise<{path: string, entries: object[], writable: boolean}>} the listing.
 */
async function listRemoteDirectory (sftp, requestedPath) {
  const path = requestedPath === '' ? await sftpRealpath(sftp, '.') : requestedPath
  const raw = await new Promise((resolve, reject) => {
    sftp.readdir(path, (err, list) => { if (err) reject(err); else resolve(list) })
  })
  const entries = raw.map(entry => ({
    name: entry.filename,
    type: entry.attrs.isDirectory() ? 'directory'
      : entry.attrs.isSymbolicLink() ? 'symlink'
      : 'file',
    size: entry.attrs.size,
    mtime: entry.attrs.mtime,
  }))
  const writable = await probeWritableViaSftp(sftp, path)
  return { path, entries, writable }
}

/**
 * Validate the probe request's `draft` into a resolved-shaped descriptor —
 * the same shape {@link HostStore#resolve} returns, so the engine's
 * `connectConfig` consumes it unchanged.
 *
 * Shape checks only (non-empty strings, integer port, known auth kind): the
 * domain verdicts (missing key file, blank password with no stored fallback)
 * belong to the engine, whose messages name the exact field to fix.
 *
 * @param {object | null} body - the parsed request body.
 * @returns {{draft?: object, error?: string}} the draft, or the refusal.
 */
function draftDescriptorOf (body) {
  const draft = body?.draft
  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) {
    return { error: 'draft is required: {alias, host, user, auth}' }
  }
  const alias = typeof draft.alias === 'string' ? draft.alias.trim() : ''
  const host = typeof draft.host === 'string' ? draft.host.trim() : ''
  const user = typeof draft.user === 'string' ? draft.user.trim() : ''
  if (alias === '') return { error: 'draft.alias is required' }
  if (host === '') return { error: 'draft.host is required' }
  if (user === '') return { error: 'draft.user is required' }
  const port = draft.port === undefined || draft.port === null || draft.port === '' ? 22 : draft.port
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: `draft.port must be an integer between 1 and 65535: ${JSON.stringify(draft.port)}` }
  }
  const rawAuth = draft.auth ?? {}
  if (rawAuth === null || typeof rawAuth !== 'object' || Array.isArray(rawAuth)) {
    return { error: 'draft.auth must be an object' }
  }
  const kind = rawAuth.kind
  if (kind !== 'key' && kind !== 'password' && kind !== 'agent') {
    return { error: `draft.auth.kind must be one of key, password, agent: ${JSON.stringify(kind)}` }
  }
  // Passwords and passphrases are NOT trimmed — they may legitimately contain
  // leading/trailing spaces; the other fields are identifiers and are.
  const raw = (value) => (typeof value === 'string' ? value : '')
  const trimmed = (value) => raw(value).trim()
  return {
    draft: {
      alias,
      host,
      port,
      user,
      auth: {
        kind,
        keyPath: trimmed(rawAuth.keyPath),
        passphrase: raw(rawAuth.passphrase),
        password: raw(rawAuth.password),
        agentPath: trimmed(rawAuth.agentPath),
      },
      agentForward: draft.agentForward === true,
      compress: draft.compress === true,
    },
  }
}

/** The unmount modes this endpoint accepts. */
const UNMOUNT_MODES = new Set(['detach', 'deregister', 'forget'])

/**
 * Resolve the unmount mode from a request body.
 *
 * Two spellings are honoured so the documented mode name and the older
 * `deregister` boolean cannot disagree silently: an explicit `mode` wins, and
 * otherwise `deregister: true` means "deregister" while its default means
 * "detach". Detach is the safe default — it is the only mode that keeps the
 * workspace record and the archived sessions recoverable in one click.
 *
 * `forget` is accepted as an alias of `deregister` rather than a third mode:
 * both delete the record, and the difference the old `forget` had (clearing the
 * detached mark) is now what `deregister` does too, because a record that is
 * gone everywhere must not leave a re-enable button behind.
 *
 * @param {object | null} body - the parsed request body.
 * @returns {'detach' | 'deregister'} the mode.
 */
function normalizeUnmountMode (body) {
  const requested = typeof body?.mode === 'string' ? body.mode.trim() : ''
  if (requested === 'detach') return 'detach'
  if (UNMOUNT_MODES.has(requested)) return 'deregister'
  return body?.deregister === true ? 'deregister' : 'detach'
}

/**
 * Archive every session accounted by one workspace.
 *
 * Archiving is registry-native: the session disappears from every grouping
 * surface, its file is untouched, and `unarchiveSession` restores it to its
 * recorded position. No other plugin is involved and nothing on disk is
 * unlinked.
 *
 * Failures are collected per session rather than aborting the batch: a session
 * with running work is refused by the registry (that is the documented
 * behaviour without `stopActivity`), and the user should still get the other
 * sessions archived plus a precise account of what was left.
 *
 * @param {object | undefined} registry - the workspace registry, when mounted.
 * @param {object | undefined} entity - the workspace entity.
 * @returns {Promise<{ok: string[], failed: Array<{sessionId: string, error: string}>}>} the outcome.
 */
async function archiveWorkspaceSessions (registry, entity) {
  const ok = []
  const failed = []
  if (entity === undefined || typeof registry?.archiveSession !== 'function') return { ok, failed }
  // `sessionIds` is already filtered by the registry to the sessions it still
  // considers members, so this cannot archive a detached orphan.
  for (const sessionId of entity.sessionIds ?? []) {
    try {
      await registry.archiveSession(sessionId)
      ok.push(sessionId)
    } catch (error) {
      failed.push({ sessionId, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { ok, failed }
}

/**
 * Unarchive every session accounted by one workspace.
 *
 * @param {object | undefined} registry - the workspace registry, when mounted.
 * @param {object | undefined} entity - the workspace entity.
 * @returns {Promise<{ok: string[], failed: Array<{sessionId: string, error: string}>}>} the outcome.
 */
async function unarchiveWorkspaceSessions (registry, entity) {
  const ok = []
  const failed = []
  if (entity === undefined || typeof registry?.unarchiveSession !== 'function') return { ok, failed }
  for (const sessionId of entity.sessionIds ?? []) {
    try {
      await registry.unarchiveSession(sessionId)
      ok.push(sessionId)
    } catch (error) {
      failed.push({ sessionId, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { ok, failed }
}

/**
 * Tear a remote workspace down and report what happened.
 *
 * Two callers need exactly this sequence: the `unmount` route (the panel's
 * 「卸载」) and `floating/delete` with 「同时注销该 DSH 工作区」 checked. They
 * differ only in how they got here, so the sequence lives in one place — a
 * second copy is how the two would drift apart on the next edit.
 *
 * Order matters: the root is fenced first (so nothing keeps writing while
 * sessions are archived), then the detached mark is persisted, the prompt cache
 * is dropped, sessions are archived (in `deregister` mode), and only then is
 * the workspace record deleted together with the detached marks — a record
 * deleted while its mark remained would leave the panel offering a re-enable
 * button for a workspace that no longer exists anywhere.
 *
 * @param {object} options - the collaborators.
 * @param {object} options.router - the remote file system root bookkeeper.
 * @param {object} options.store - `engine.store` (holds `entryStore`).
 * @param {object} [options.prompts] - the agent-prompt registry.
 * @param {object} options.ctx - the route context (for `workspaceRegistry`).
 * @param {string} options.workspacePath - the `ssh://` workspace path.
 * @param {'detach'|'deregister'} options.mode - how much to tear down.
 * @param {boolean} [options.archiveSessions] - override the mode default.
 * @returns {Promise<{wasMounted: boolean, deregistered: boolean, archived: string[], archiveFailed: Array<object>}>} the outcome.
 */
async function teardownWorkspace ({ router, store, prompts, ctx, workspacePath, mode, archiveSessions }) {
  const archive = typeof archiveSessions === 'boolean' ? archiveSessions : mode !== 'detach'
  const wasMounted = router.disableRoot(workspacePath)
  store.entryStore.disableWorkspace(workspacePath)
  prompts?.invalidateWorkspace(workspacePath)

  const registry = ctx.get('workspaceRegistry')
  const entity = registry?.list?.().find(candidate => candidate.path === workspacePath)
  const archived = archive ? await archiveWorkspaceSessions(registry, entity) : { ok: [], failed: [] }

  let deregistered = false
  if (mode !== 'detach') {
    if (entity !== undefined && typeof registry?.delete === 'function') {
      await registry.delete(entity.id)
      deregistered = true
    }
    router.enableRoot(workspacePath)
    store.entryStore.enableWorkspace(workspacePath)
  }
  return {
    wasMounted,
    deregistered,
    archived: archived.ok,
    archiveFailed: archived.failed,
  }
}

/**
 * Route family dependencies.
 * @typedef {object} RouteDeps
 * @property {import('./engine.js').SshWorkspaceEngine} engine
 * @property {import('./remote-fs.js').RemoteFileSystem} router
 * @property {import('./forward.js').ForwardManager} forwards
 * @property {import('./forward-persist.js').SavedForwardManager} [savedForwards]
 * @property {import('@deepseek-ai/cordis').Context} ctx
 * @property {boolean} [allowLan] - serve LAN browsers: accept private-network
 *   remote addresses and Host headers that name this machine — its own
 *   interface addresses, a private IP literal, or a configured extra. The
 *   caller resolves it (see `access-policy.js`: an absent config follows the
 *   webserver bind, so this is not simply `config.allowLan`).
 * @property {string[]} [allowedHosts] - extra `Host` values accepted in
 *   addition to the machine's own addresses; used with `allowLan`.
 */

/**
 * The access policy one route set enforces.
 *
 * @typedef {object} AccessPolicy
 * @property {boolean} allowLan - whether private-network origins are admitted.
 * @property {string[]} allowedHosts - normalized (lowercase, trimmed) extra Host values.
 */

/**
 * Decide whether a request may pass the route fence.
 *
 * This is the single place that encodes "who may call these endpoints", so the
 * shared `guard()` and the two byte-streaming routes (which re-apply the fence
 * around their non-JSON bodies) cannot drift apart.
 *
 * In the default loopback-only mode the refusals keep their historical
 * wording, byte for byte. In `allowLan` mode the two reasons stay
 * distinguishable: an unacceptable origin and an unacceptable Host header are
 * different failures, and both name their cause.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {AccessPolicy} policy - the resolved access policy.
 * @returns {{ error: string } | undefined} the 403 body when refused, else undefined.
 */
function accessRefusal (req, policy) {
  if (policy.allowLan !== true) {
    if (!isLoopbackRequest(req)) return { error: 'forbidden: loopback-only' }
    if (!isLoopbackHostHeader(req)) {
      return { error: `forbidden: unexpected Host header ${JSON.stringify(req.headers?.host ?? '')}` }
    }
    return undefined
  }
  const addr = req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? ''
  if (!isLoopbackAddress(addr) && !isPrivateNetworkAddress(addr)) {
    return { error: `forbidden: remote address ${JSON.stringify(addr)} is neither loopback nor a private network address` }
  }
  if (!isLanHostHeader(req, policy.allowedHosts)) {
    return { error: `forbidden: unexpected Host header ${JSON.stringify(req.headers?.host ?? '')}` }
  }
  return undefined
}

/**
 * Build every /api/dsh-ssh-workspace route.
 *
 * @param {RouteDeps} deps - engine, router, forwards, cordis context.
 * @returns {Array<object>} route descriptors for ctx.webServer.register().
 */
export function makeRoutes (deps) {
  const { engine, router, forwards, savedForwards, shells, ctx } = deps
  // The agent-prompt registry (optional so existing harnesses keep working):
  // it owns the per-workspace merge cache the three-level configuration feeds.
  const prompts = deps.prompts

  const accessPolicy = {
    allowLan: deps.allowLan === true,
    allowedHosts: (Array.isArray(deps.allowedHosts) ? deps.allowedHosts : [])
      .filter(entry => typeof entry === 'string' && entry.trim() !== '')
      .map(entry => entry.trim().toLowerCase()),
  }

  /**
   * Write one refusal to the host log, before the 403 goes out.
   *
   * The response body stays exactly as it always was — the panel and several
   * tests read those strings verbatim — but the body names neither the values
   * that were refused nor the knob that admits them. A LAN deployment hits this
   * constantly (the browser's `Host` is the HOST's address, not the one this
   * process sees on its own interface), so the log line carries the mode, the
   * peer, the Host and the two concrete fixes.
   *
   * @param {{ error: string }} refusal - the refusal the fence produced.
   * @param {import('node:http').IncomingMessage} req - the refused request.
   * @returns {void}
   */
  const logRefusal = (refusal, req) => {
    const remoteAddress = req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? ''
    ctx?.logger?.warn?.(
      `ssh-workspace: refused ${req.method ?? 'request'} ${req.url ?? ''} — `
      + `mode=${accessPolicy.allowLan ? 'allowLan' : 'loopback'}, `
      + `remoteAddress=${JSON.stringify(remoteAddress)}, `
      + `Host=${JSON.stringify(req.headers?.host ?? '')}, `
      + `reason=${JSON.stringify(refusal.error)}. `
      + 'Set allowLan: true to admit private-network clients, and add the host name to allowedHosts '
      + 'when the browser reaches the panel through a name this machine does not own.',
    )
  }

  const guard = (req, res, method) => {
    const refusal = accessRefusal(req, accessPolicy)
    if (refusal !== undefined) {
      logRefusal(refusal, req)
      writeJson(res, 403, refusal)
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    if (method === 'POST' && !isJsonContentType(req)) {
      writeJson(res, 415, { error: 'unsupported media type: POST endpoints require content-type: application/json' })
      return false
    }
    return true
  }

  // The download/upload fences answer with a bare "forbidden" rather than the
  // detailed wording (their responses stream bytes, and the browser-side
  // download flow surfaces the JSON body only as a failure blob). The verdict
  // itself is the same `accessRefusal` the shared guard applies.
  const refuseUnlessAllowed = (req, res) => {
    const refusal = accessRefusal(req, accessPolicy)
    if (refusal === undefined) return true
    // Logged here too: the streaming routes answer a bare "forbidden", which is
    // even less informative than the JSON wording above.
    logRefusal(refusal, req)
    writeJson(res, 403, { error: 'forbidden' })
    return false
  }

  // ---- floating workspace rows -------------------------------------------
  //
  // A stored floating entry names a parent workspace id, an alias and a remote
  // path — all of which can go stale independently: the host may be deleted,
  // the parent workspace may be deleted, the workspace record may be gone while
  // the stored entry survives. The browser half must see those as three
  // separate facts (each has its own wording and its own recovery), so the join
  // is computed here, once, and shipped with every reply.
  // Every entry of every floating reply joins against the same two sources, and
  // some replies are polled by the browser. A missing service is worth saying
  // once, not once per request.
  const warnedOnce = new Set()
  const warnOnce = (key, message, error) => {
    if (warnedOnce.has(key)) return
    warnedOnce.add(key)
    console.warn(message, error)
  }

  const hostRows = () => {
    try {
      return engine.store.rows()
    } catch (error) {
      // A store this plugin cannot read is a real problem, but it must not take
      // the floating list down with it: the entries still exist, they just
      // report every host as missing until the store is fixed.
      warnOnce('hosts', '[dsh-ssh-workspace] could not read the host list while joining floating workspaces:', error)
      return []
    }
  }

  /** Live state every floating entry is joined against, read once per request. */
  const floatingContext = () => {
    const roots = router.listRoots()
    const disabled = router.listDisabled()
    const hosts = hostRows()
    const hostByAlias = new Map(hosts.map(row => [row.alias, row]))
    let registryList
    try {
      registryList = ctx.get('workspaceRegistry')?.list?.()
    } catch (error) {
      // Same reasoning as hostRows: an unreachable registry means "unknown",
      // never "missing" — claiming a parent was deleted would invite the user
      // to delete a perfectly good entry.
      warnOnce('registry', '[dsh-ssh-workspace] workspace registry unavailable while joining floating workspaces:', error)
      registryList = undefined
    }
    const entities = Array.isArray(registryList) ? registryList : []
    return {
      roots,
      disabled,
      hostByAlias,
      registryReady: Array.isArray(registryList),
      byPath: new Map(entities.map(entity => [entity.path, entity])),
      byId: new Map(entities.map(entity => [String(entity.id), entity])),
    }
  }

  /**
   * One stored floating entry plus its live state.
   *
   * @param {object} item - the stored entry.
   * @param {object} [context] - the precomputed join (recomputed when absent).
   * @returns {object} the reply row.
   */
  const floatingRowOf = (item, context = floatingContext()) => {
    const workspacePath = formatRemotePath(item.alias, item.remotePath)
    const entity = context.byPath.get(workspacePath)
    const host = context.hostByAlias.get(item.alias)
    const parent = context.byId.get(item.parentId)
    return {
      ...item,
      workspacePath,
      ...(entity === undefined ? {} : { workspaceId: String(entity.id) }),
      // The registered title, so the browser half can hide the title-keyed
      // surfaces (workspace picker rows, the session hero chip) without
      // guessing a name from the stored path.
      workspaceTitle: entity !== undefined && typeof entity.title === 'string' ? entity.title : '',
      ...(parent === undefined ? {} : { parentTitle: typeof parent.title === 'string' ? parent.title : '' }),
      mounted: context.roots.includes(workspacePath),
      disabled: context.disabled.includes(workspacePath),
      registered: entity !== undefined,
      hostMissing: host === undefined,
      // `registryReady` guards the two "parent is gone" verdicts: a registry we
      // could not reach is unknown, not deleted.
      parentMissing: context.registryReady && item.parentId !== '' && parent === undefined,
      registryReady: context.registryReady,
      ...(host === undefined
        ? {}
        : {
            // Two spellings on purpose: `hostAddr` is who you log in as
            // (`user@host:port`, shown in the manage dialog), `hostTarget` is
            // the address alone, so the menu and the card can show the spec's
            // `alias@host` without repeating the alias inside it.
            hostAddr: `${host.user}@${host.host}${host.port === 22 ? '' : `:${host.port}`}`,
            hostTarget: `${host.host}${host.port === 22 ? '' : `:${host.port}`}`,
            hostOs: typeof host.os === 'string' ? host.os : '',
          }),
    }
  }

  /** Every stored floating entry, joined with live state (display order). */
  const floatingRows = () => {
    const context = floatingContext()
    let items
    try {
      items = engine.store.entryStore.floating()
    } catch (error) {
      warnOnce('floating', '[dsh-ssh-workspace] could not read the floating workspace section:', error)
      items = []
    }
    return items.map(item => floatingRowOf(item, context))
  }

  /**
   * The niubash `project` placements one host offers: its mounted workspace
   * roots, each as the canonical `ssh://` path the dialog selects by and the
   * Windows root the provisioner appends the runtime directory to.
   *
   * @param {string} alias - host alias.
   * @returns {Array<{workspacePath: string, root: string}>} mounted placements.
   */
  const projectPlacementsOf = (alias) => {
    const roots = router.listRoots()
    const prefix = `ssh://${alias}/`
    return roots
      .filter(path => typeof path === 'string' && path.startsWith(prefix))
      .map(path => ({ workspacePath: path, root: windowsRemotePath(path.slice(prefix.length)) }))
  }

  /**
   * The payload pin this process trusts, as the panel's dialog shows it:
   * staged-manifest derived (`source: 'manifest'`, self-contained package)
   * or the bundled fallback (`source: 'bundled'`, downloads on provision).
   *
   * @returns {object} the payload summary.
   */
  const payloadSummary = () => {
    const resolution = resolvedPayload()
    return {
      version: resolution.pin.version,
      releaseTag: resolution.pin.releaseTag,
      assetFile: resolution.pin.assetFile,
      source: resolution.manifest !== undefined ? 'manifest' : 'bundled',
      staged: resolution.stagedArchive !== undefined,
    }
  }

  return [
    // ---- hosts
    {
      kind: 'exact',
      path: ROUTES.hosts,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const query = queryParam(url, 'query') ?? ''
        // Store rows carry the non-secret auth details the editor needs to
        // prefill; secrets (password, passphrase) never leave the store file.
        const rows = engine.store.rows().map(row => {
          if (row.source !== 'store') return row
          const entry = engine.store.entry(row.alias) ?? {}
          const auth = entry.auth ?? {}
          return {
            ...row,
            keyPath: typeof auth.keyPath === 'string' ? auth.keyPath : undefined,
            agentPath: typeof auth.agentPath === 'string' ? auth.agentPath : undefined,
            agentForward: entry.agentForward === true,
            compress: entry.compress === true,
            // Whether the sidebar draws the host-alias tag under workspace
            // names mounted from this host (editor prefill).
            aliasTag: entry.aliasTag === true,
            // The workspace dialog prefills its initial directory from this.
            defaultPath: typeof entry.defaultPath === 'string' ? entry.defaultPath : undefined,
            // The editor's Niubash auto-deploy checkbox prefill (win hosts):
            // the stored wish, and whether a deployment already exists — the
            // pair that drives the checkbox's three states (new host default
            // on / old entry without the field off / initialized greyed out).
            // Panel-only prefill, exactly like defaultPath above: rows() (the
            // tool output) stays untouched.
            niubashAutoDeploy: entry.niubashAutoDeploy === true,
            niubashProvisioned: entry.bashProvisioned !== undefined,
          }
        })
        const filtered = query === ''
          ? rows
          : rows.filter(row => [row.alias, row.host, row.user, row.description ?? '', ...(row.tags ?? [])]
              .join(' ')
              .toLowerCase()
              .includes(query.toLowerCase()))
        writeJson(res, 200, { hosts: filtered })
      },
    },
    // ---- save host (create or update)
    {
      kind: 'exact',
      path: ROUTES.hostSave,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const originalAlias = typeof body?.originalAlias === 'string' && body.originalAlias.trim() !== ''
          ? body.originalAlias.trim()
          : undefined
        // defaultPath is validated up front so a bad path answers 400 with the
        // reason, instead of surfacing as a generic save failure below.
        try {
          normalizeHostDefaultPath(body?.defaultPath)
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          return
        }
        const payload = {
          alias: typeof body?.alias === 'string' ? body.alias : '',
          host: typeof body?.host === 'string' ? body.host : '',
          port: typeof body?.port === 'number' ? body.port : 22,
          user: typeof body?.user === 'string' ? body.user : '',
          auth: {
            kind: typeof body?.auth?.kind === 'string' ? body.auth.kind : 'agent',
            keyPath: typeof body?.auth?.keyPath === 'string' ? body.auth.keyPath : '',
            passphrase: typeof body?.auth?.passphrase === 'string' ? body.auth.passphrase : '',
            password: typeof body?.auth?.password === 'string' ? body.auth.password : '',
            agentPath: typeof body?.auth?.agentPath === 'string' ? body.auth.agentPath : '',
          },
          description: typeof body?.description === 'string' ? body.description : '',
          // Transport options: the editor always posts booleans, so a missing
          // field means "off" rather than "keep the previous value".
          agentForward: body?.agentForward === true,
          compress: body?.compress === true,
          // Same posting rule: the editor always sends the boolean, so a
          // missing field (an older client) means "off" rather than "keep".
          aliasTag: body?.aliasTag === true,
          // The win-host Niubash auto-deploy wish: the editor posts it
          // whenever the OS is win (unchecked posts false, clearing the
          // stored flag); absent (an older client) means off, so an existing
          // entry never gains a surprise deployment from an older save.
          niubashAutoDeploy: body?.niubashAutoDeploy === true,
          // Passed through verbatim; the store normalizes it, drops blanks and
          // throws on a non-absolute path (already pre-validated above).
          defaultPath: body?.defaultPath,
          // The pinned OS: the editor always posts it (a blank value means
          // "probe per connection" and drops the stored key); the store
          // normalizes accepted aliases and drops anything it cannot read.
          os: body?.os,
          // The pinned bash path: the editor posts it whenever the host is
          // of type win (a blank clears the stored value); the store
          // trims, rejects quote/line-break spellings, and drops blanks.
          bashPath: body?.bashPath,
        }
        const store = engine.store.entryStore
        try {
          // A store entry shadows the same alias in ~/.ssh/config, so creating
          // one where only a config block exists would silently change how that
          // alias resolves for every other ssh client too.
          const aliasTrimmed = payload.alias.trim()
          const storeEntry = aliasTrimmed === '' ? undefined : store.find(aliasTrimmed)
          if (aliasTrimmed !== '' && storeEntry === undefined && engine.store.sshConfigAliases().includes(aliasTrimmed)) {
            writeJson(res, 200, { ok: false, error: `alias ${JSON.stringify(aliasTrimmed)} is already defined in ~/.ssh/config; edit that file instead or pick another alias` })
            return
          }
          const entry = originalAlias === undefined
            ? store.create(payload)
            : store.update(originalAlias, payload)
          // A changed record must not keep serving the old connection.
          if (originalAlias !== undefined) engine.forget(originalAlias)
          engine.forget(entry.alias)
          // The host-level prompt configuration travels with the editor form:
          // an explicit payload replaces the level, and a rename without one
          // carries the old alias' level to the new name so it is not dropped.
          if (body?.agentPrompts !== undefined) {
            try { store.setHostAgentPrompts(entry.alias, body.agentPrompts) } catch { /* saved host stays; the level keeps its previous value */ }
          } else if (originalAlias !== undefined && entry.alias !== originalAlias) {
            try { store.renameHostAgentPrompts(originalAlias, entry.alias) } catch { /* nothing to move */ }
          }
          prompts?.invalidateAlias(originalAlias ?? entry.alias)
          if (originalAlias !== undefined && originalAlias !== entry.alias) prompts?.invalidateAlias(entry.alias)
          refreshAliasPrompts(prompts, router.listRoots(), entry.alias)
          // The win-host auto-deploy wish: when a just-saved host wants the
          // runtime and has none yet, kick ONE provisioning in the background.
          // Fire-and-forget on purpose — the HTTP response below must not wait
          // on a download + upload + verify cycle; the outcome surfaces through
          // the existing diagnostics log, the engine's niubash-presence cache
          // and the initialization dialog's status query (no polling, no push).
          // The engine's kick re-reads the store entry, so the gate here is the
          // shared in-flight guard in kickNiubashAutoDeploy.
          engine.kickNiubashAutoDeploy?.(entry.alias)
          writeJson(res, 200, { ok: true, alias: entry.alias, created: originalAlias === undefined })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ---- set one host's default directory (partial patch: defaultPath only)
    {
      kind: 'exact',
      path: ROUTES.hostDefaultPath,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const alias = typeof body?.alias === 'string' ? body.alias.trim() : ''
        if (alias === '') {
          writeJson(res, 400, { error: 'alias is required' })
          return
        }
        // Same verdict the editor's save carries: normalizeHostDefaultPath
        // throws with the accepted spellings in the message (/home/user,
        // /D:/code/www), and blank means "clear the stored field".
        try {
          normalizeHostDefaultPath(body?.path)
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          return
        }
        const store = engine.store.entryStore
        // Only store entries take a defaultPath. An alias known only to
        // ~/.ssh/config gets its own wording — that file is never edited by
        // this plugin, so "not editable" is the whole answer, not a hint.
        if (store.find(alias) === undefined) {
          const inConfig = engine.store.sshConfigAliases().includes(alias)
          writeJson(res, 400, {
            error: inConfig
              ? `alias ${JSON.stringify(alias)} comes from the ~/.ssh/config fallback, which is not editable — default paths are only stored for hosts saved in the host store`
              : `alias ${JSON.stringify(alias)} is not in the editable host store`,
          })
          return
        }
        try {
          // The patch carries ONLY the defaultPath key; mergeEntry keeps every
          // other stored field untouched. Verbatim pass-through keeps the
          // merge semantics: absent → keep, '' / null → clear (the editor
          // posts the key for the same reason), a value → normalized write.
          const entry = store.update(alias, { defaultPath: body?.path })
          // JSON has no undefined: null is the wire spelling of "field not
          // set" (it was cleared, or never had a value).
          writeJson(res, 200, { ok: true, defaultPath: typeof entry.defaultPath === 'string' ? entry.defaultPath : null })
        } catch (error) {
          // The pre-checks above already filtered the expected failures; what
          // is left (storage I/O, a concurrent rename) answers hostSave-style.
          writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ---- delete host
    {
      kind: 'exact',
      path: ROUTES.hostDelete,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const alias = typeof body?.alias === 'string' ? body.alias.trim() : ''
        if (alias === '') {
          writeJson(res, 400, { error: 'alias is required' })
          return
        }
        try {
          engine.store.entryStore.delete(alias)
          engine.forget(alias)
          // The prompt configuration is keyed by alias; a deleted host must not
          // leave it behind. Best-effort: the deletion itself already succeeded.
          try { engine.store.entryStore.setHostAgentPrompts(alias, null) } catch { /* nothing stored */ }
          prompts?.invalidateAlias(alias)
          writeJson(res, 200, { ok: true, alias })
        } catch (error) {
          const inConfig = engine.store.sshConfigAliases().includes(alias)
          writeJson(res, 200, {
            ok: false,
            error: inConfig
              ? `${alias} is defined in ~/.ssh/config, which this plugin never edits — remove the Host block there instead`
              : error instanceof Error ? error.message : String(error),
          })
        }
      },
    },
    // ---- forget recorded host key (TOFU re-trust)
    {
      kind: 'exact',
      path: ROUTES.hostForgetKey,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const alias = typeof body?.alias === 'string' ? body.alias.trim() : ''
        if (alias === '') {
          writeJson(res, 400, { error: 'alias is required' })
          return
        }
        try {
          const removed = engine.store.forgetHostKey(alias)
          // Drop the pooled connection so the next connect re-pins the key.
          engine.forget(alias)
          writeJson(res, 200, { ok: true, removed })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ---- disconnect (close the pooled connection for one host)
    {
      kind: 'exact',
      path: ROUTES.hostDisconnect,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const alias = typeof body?.alias === 'string' ? body.alias.trim() : ''
        if (alias === '') {
          writeJson(res, 400, { error: 'alias is required' })
          return
        }
        const record = engine.pool.get(alias)
        if (record === undefined) {
          writeJson(res, 200, { ok: true, disconnected: false })
          return
        }
        // Dropping a busy connection would fail whatever rides on it; let the
        // caller retry once the operations settle.
        if (record.inFlight > 0) {
          writeJson(res, 200, { ok: false, error: `the connection has ${record.inFlight} operation(s) in flight — disconnect again once it is idle` })
          return
        }
        try {
          // Requirement: dropping the SSH connection takes its port forwards
          // with it. The connection's own `close` event also tears them down,
          // but that event is not guaranteed — an ssh2 client destroyed without
          // emitting, or replaced by a reconnect, would leave listeners bound to
          // a record nobody owns. Closing by alias first makes it deterministic.
          //
          // This is a DELIBERATE disconnect, so the tunnels must end up exactly
          // where the panel's own "close" button leaves them: intent off and no
          // recorded failure. `closeForAlias` is the unplanned-drop path — it
          // keeps the intent on and records "SSH connection closed", which the
          // panel shows as a red "connection lost" line. A user who clicked
          // disconnect did not lose anything, and telling them otherwise makes
          // a working action look like a fault.
          const closedForwards = savedForwards === undefined
            ? (forwards?.closeForAlias?.(alias, 'SSH connection closed') ?? 0)
            : savedForwards.closeAlias(alias)
          engine.forget(alias)
          writeJson(res, 200, { ok: true, disconnected: true, closedForwards })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ---- test connection
    //
    // A probe, not a way to connect: it proves the host answers and then
    // releases the connection IT opened. Leaving that connection pooled made
    // "test" quietly double as "connect", so a user who only wanted to know
    // whether the host answers ended up with a live session they never asked
    // for.
    //
    // Two cases where the connection is deliberately kept:
    //   - it was ALREADY pooled before this probe (the user's own connection is
    //     not this request's to drop);
    //   - anything rides on it — an open port forward pins it with `holds`, and
    //     tearing it down there would break a tunnel the user did not ask to
    //     close.
    {
      kind: 'exact',
      path: ROUTES.test,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const alias = typeof body?.alias === 'string' ? body.alias.trim() : ''
        if (alias === '') {
          writeJson(res, 400, { error: 'alias is required' })
          return
        }
        const started = Date.now()
        try {
          const existed = engine.pool?.has?.(alias) === true
          const record = await engine.acquire(alias)
          const durationMs = Date.now() - started
          const held = (record?.holds ?? 0) > 0
          let released = false
          if (!existed && !held && (record?.inFlight ?? 0) === 0) {
            engine.forget(alias)
            released = true
          }
          writeJson(res, 200, {
            ok: true,
            durationMs,
            released,
            ...(held
              ? { heldBy: 'an open port forward still holds this connection' }
              : existed ? { heldBy: 'the connection was already open' } : {}),
          })
        } catch (error) {
          // `code`/`mismatch` ride along on a host-key refusal so the panel can
          // offer its in-place recovery instead of a dead-end message.
          writeJson(res, 200, { ok: false, durationMs: Date.now() - started, ...routeErrorPayload(error) })
        }
      },
    },
    // ---- probe a DRAFT host (editor test button + create-mode picker)
    //
    // `POST /test` answers for a SAVED alias and manages the pooled
    // connection; this endpoint connects with the form's CURRENT values, so
    // testing and directory browsing work before the host exists. The engine's
    // `withDraftSftp` owns the load-bearing semantics (own ephemeral
    // connection — the pool is neither read nor written; host key verified
    // against an existing record but never pinned; the draft's secrets die
    // with the connection). This handler validates, backfills stored secrets
    // for blank fields, and shapes the replies like /test and /ls so the
    // client renders both channels with the same code.
    {
      kind: 'exact',
      path: ROUTES.probe,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const { draft, error: draftError } = draftDescriptorOf(body)
        if (draftError !== undefined) {
          writeJson(res, 400, { error: draftError })
          return
        }
        const action = body?.action === 'ls' ? 'ls' : 'test'
        // Secrets are never echoed back to the browser, so an edit form's
        // password / passphrase fields arrive blank meaning "keep the stored
        // one". Backfill from the store when the draft's alias names a stored
        // host — otherwise "edit → test" without retyping the password would
        // always fail auth. The value feeds the ephemeral connection and dies
        // with it; nothing is written back.
        try {
          const stored = engine.store.entryStore.secretFor(draft.alias)
          if (draft.auth.kind === 'password' && draft.auth.password === '' && typeof stored?.password === 'string') draft.auth.password = stored.password
          if (draft.auth.kind === 'key' && draft.auth.passphrase === '' && typeof stored?.passphrase === 'string') draft.auth.passphrase = stored.passphrase
        } catch (error) {
          // An unreadable secret (lost key file) IS the probe's answer, not a
          // crash: saving the host would fail to connect the same way.
          writeJson(res, 200, { ok: false, ...routeErrorPayload(error) })
          return
        }
        const started = Date.now()
        try {
          if (action === 'test') {
            await engine.withDraftSftp(draft, async () => {})
            writeJson(res, 200, { ok: true, durationMs: Date.now() - started, probed: 'draft' })
            return
          }
          // action === 'ls': same reply shape as GET /ls (path echo, entries,
          // writable verdict) so the client's rendering is shared verbatim.
          const requestedPath = typeof body?.path === 'string' ? body.path : ''
          if (requestedPath !== '' && !requestedPath.startsWith('/')) {
            writeJson(res, 400, { error: `path must be absolute: ${JSON.stringify(requestedPath)}` })
            return
          }
          const listed = await engine.withDraftSftp(draft, (sftp) => listRemoteDirectory(sftp, requestedPath))
          writeJson(res, 200, { path: listed.path, entries: listed.entries, writable: listed.writable, probed: 'draft' })
        } catch (error) {
          // A draft hits the host-key refusal like any connection (the
          // verifier runs with pin=false but still checks existing records),
          // and the structured fingerprints must survive to the browser.
          writeJson(res, 400, routeErrorPayload(error))
        }
      },
    },
    // ---- remote directory listing
    {
      kind: 'exact',
      path: ROUTES.ls,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const alias = queryParam(url, 'alias')
        let path = queryParam(url, 'path') ?? ''
        if (alias === undefined || alias === '') {
          writeJson(res, 400, { error: 'alias query parameter is required' })
          return
        }
        if (path !== '' && !path.startsWith('/')) {
          writeJson(res, 400, { error: `path must be absolute: ${JSON.stringify(path)}` })
          return
        }
        try {
          const listed = await engine.withSftp(alias, (sftp) => listRemoteDirectory(sftp, path))
          writeJson(res, 200, { path: listed.path, entries: listed.entries, writable: listed.writable })
        } catch (error) {
          writeJson(res, 400, routeErrorPayload(error))
        }
      },
    },
    // ---- mount status
    {
      kind: 'exact',
      path: ROUTES.status,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const mounted = router.listRoots()
        const connections = [...engine.pool.entries()].map(([alias, record]) => ({
          alias,
          state: record.broken ? 'broken' : 'connected',
          inFlight: record.inFlight,
          idleAt: record.idleAt,
        }))
        // Registered remote Workspaces, so the browser half can mark them
        // wherever DSH draws them with its own folder glyph.
        let workspaces = []
        try {
          const registry = ctx.get('workspaceRegistry')
          workspaces = (registry?.list?.() ?? [])
            .filter(entity => typeof entity?.path === 'string' && entity.path.startsWith('ssh://'))
            .map(entity => ({
              id: String(entity.id ?? entity.path),
              path: entity.path,
              title: typeof entity.title === 'string' ? entity.title : '',
              // The browser half greys a detached workspace's own sessions, and
              // a session row carries only its id — so the membership has to
              // travel with the reply. Without it the row for the workspace goes
              // grey while the sessions inside it stay fully live.
              sessionIds: Array.isArray(entity.sessionIds) ? entity.sessionIds.map(String) : [],
            }))
        } catch { /* registry unavailable — the reply stands without the list */ }
        writeJson(res, 200, {
          mounted,
          // Detached workspaces: still registered, deliberately not served.
          // The panel derives "off" from this list alone, so a workspace can
          // never be shown as on while the fence says otherwise.
          disabled: router.listDisabled(),
          connections,
          workspaces,
          forwards: forwards.list(),
          // The saved half. `forwards` above stays the live view the agent
          // tools already consume; the panel needs the join to label a button
          // by what exists rather than by what was requested.
          ...(savedForwards === undefined
            ? {}
            : { forwardRows: savedForwards.list(), forwardSettings: savedForwards.settings() }),
          ...(shells === undefined ? {} : { shells: shells.list() }),
          // Recent connection and watcher events for the panel's status view.
          // The Host has no console exporter, so this is the only history a
          // user can actually reach (see lib/diagnostics.js).
          events: engine.diagnostics?.list(20) ?? [],
          // Current verdict per upstream workaround. Kept beside `events` for
          // the same reason: this is the channel that reaches a human, and
          // "one of our patches is obsolete, delete it" (probe: 'fixed') plus
          // "I could not judge the Host" (probe: 'unprobeable') both have to be
          // visible without reading a source file.
          upstreamWorkarounds: engine.upstreamWorkarounds ?? [],
        })
      },
    },
    // ---- mount
    {
      kind: 'exact',
      path: ROUTES.mount,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const alias = typeof body?.alias === 'string' ? body.alias.trim() : ''
        const remotePath = typeof body?.remotePath === 'string' ? body.remotePath.trim() : ''
        const title = typeof body?.title === 'string' ? body.title.trim() : ''
        const register = body?.register !== false
        if (alias === '' || remotePath === '' || !remotePath.startsWith('/')) {
          writeJson(res, 400, { error: 'alias and an absolute remotePath are required' })
          return
        }
        try {
          // Verify the target exists and is a directory.
          await engine.withSftp(alias, async (sftp) => {
            const stats = await new Promise((resolve, reject) => {
              sftp.stat(remotePath, (err, s) => { if (err) reject(err); else resolve(s) })
            })
            if (!stats.isDirectory()) throw new Error(`not a directory: ${remotePath}`)
          })
          const workspacePath = router.addRoot(alias, remotePath)
          // The merged prompt for this workspace may now be served; computing
          // it eagerly means the first model step of a fresh session already
          // carries it instead of one late step.
          void prompts?.refreshWorkspace(workspacePath)
          // Advisory capability probe; never let it fail the mount.
          let capabilities
          try {
            const probed = await engine.probeCapabilities(alias)
            if (probed.rg !== undefined || probed.git !== undefined || probed.inotifywait !== undefined) capabilities = probed
          } catch { /* best-effort */ }
          let registered = false
          let workspaceId
          if (register) {
            try {
              const registry = ctx.get('workspaceRegistry')
              const existing = registry.list().find(entity => entity.path === workspacePath)
              if (existing !== undefined) {
                workspaceId = String(existing.id ?? existing.path)
                registered = true
              } else if (typeof registry.createCanonical === 'function') {
                const entity = await registry.createCanonical(workspacePath, title || remotePath.split('/').pop())
                workspaceId = String(entity.id ?? workspacePath)
                registered = true
              }
            } catch (regError) {
              // Mounted in-process but not registered — still usable.
              return writeJson(res, 200, {
                ok: true,
                workspacePath,
                registered: false,
                error: `mounted but not registered: ${regError instanceof Error ? regError.message : String(regError)}`,
              })
            }
          }
          writeJson(res, 200, {
            ok: true,
            workspacePath,
            registered,
            ...(workspaceId !== undefined ? { workspaceId } : {}),
            ...(capabilities !== undefined ? { capabilities } : {}),
          })
        } catch (error) {
          writeJson(res, 400, routeErrorPayload(error))
        }
      },
    },
    // ---- unmount (detach / deregister)
    //
    // Two distinct requests share this endpoint because they both answer "stop
    // using this workspace" and differ only in how much is torn down:
    //
    //   detach      disable + archive sessions. The DSH workspace record
    //               survives, so the sidebar row stays visible (greyed) and the
    //               panel can re-enable it. Sessions disappear from every
    //               grouping surface but their files are untouched, and
    //               unarchiving restores each one to its recorded position.
    //               This is the DEFAULT: it is the only mode that is reversible.
    //   deregister  detach, then also delete the workspace record, so the row
    //               goes from the sidebar AND from this panel. Sessions are
    //               still archived, never deleted — DSH has no session-delete
    //               API and this plugin deliberately does not reach around the
    //               service layer to unlink session logs.
    //
    // The older `forget` spelling is accepted as an alias of `deregister`: the
    // two did the same thing to the record, and keeping a third near-duplicate
    // mode is how the panel ended up able to offer a re-enable button for a row
    // that no longer existed.
    {
      kind: 'exact',
      path: ROUTES.unmount,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const workspacePath = typeof body?.workspacePath === 'string' ? body.workspacePath.trim() : ''
        if (workspacePath === '') {
          writeJson(res, 400, { error: 'workspacePath is required' })
          return
        }
        const mode = normalizeUnmountMode(body)
        // Detaching alone must NOT archive: the workspace record survives, so
        // the sidebar group survives, and the sessions belonging to it must
        // keep showing up under it. Archiving them would empty the very group
        // the user asked to keep — the row would stay but read as an empty
        // workspace, which is a worse outcome than the one they declined.
        //
        // Archiving therefore follows the "also remove the workspace record"
        // opt-in, because that is the only action that takes the group away.
        // An explicit `archiveSessions` still wins, so a caller that wants the
        // split behaviour can ask for it.
        const archiveSessions = typeof body?.archiveSessions === 'boolean'
          ? body.archiveSessions
          : mode !== 'detach'
        try {
          const result = await teardownWorkspace({
            router,
            store: engine.store,
            prompts,
            ctx,
            workspacePath,
            mode,
            archiveSessions,
          })
          writeJson(res, 200, {
            ok: true,
            mode,
            wasMounted: result.wasMounted,
            deregistered: result.deregistered,
            archived: result.archived,
            // A session that could not be archived is reported, never silently
            // skipped: it stays visible in the UI and the user should know.
            ...(result.archiveFailed.length === 0 ? {} : { archiveFailed: result.archiveFailed }),
          })
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ---- enable (re-mount a detached workspace)
    {
      kind: 'exact',
      path: ROUTES.enable,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const workspacePath = typeof body?.workspacePath === 'string' ? body.workspacePath.trim() : ''
        if (workspacePath === '') {
          writeJson(res, 400, { error: 'workspacePath is required' })
          return
        }
        const parts = parseRemotePath(workspacePath)
        if (parts === undefined) {
          writeJson(res, 400, { error: `not a remote workspace path: ${JSON.stringify(workspacePath)}` })
          return
        }
        const unarchiveSessions = body?.unarchiveSessions !== false
        try {
          // The directory must still exist on the host, or enabling would
          // produce a workspace that looks served but answers ENOENT.
          await engine.withSftp(parts.alias, async (sftp) => {
            const stats = await new Promise((resolve, reject) => {
              sftp.stat(parts.remotePath, (err, s) => { if (err) reject(err); else resolve(s) })
            })
            if (!stats.isDirectory()) throw new Error(`not a directory on ${parts.alias}: ${parts.remotePath}`)
          })
          const mounted = router.addRoot(parts.alias, parts.remotePath)
          engine.store.entryStore.enableWorkspace(workspacePath)
          void prompts?.refreshWorkspace(mounted)

          const registry = ctx.get('workspaceRegistry')
          let entity = registry?.list?.().find(candidate => candidate.path === workspacePath)
          let registered = entity !== undefined
          if (entity === undefined && typeof registry?.createCanonical === 'function') {
            entity = await registry.createCanonical(workspacePath, parts.remotePath.split('/').pop())
            registered = true
          }
          const unarchived = unarchiveSessions && entity !== undefined
            ? await unarchiveWorkspaceSessions(registry, entity)
            : { ok: [], failed: [] }

          writeJson(res, 200, {
            ok: true,
            workspacePath: mounted,
            registered,
            unarchived: unarchived.ok,
            ...(unarchived.failed.length === 0 ? {} : { unarchiveFailed: unarchived.failed }),
          })
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ---- floating remote workspaces ----------------------------------------
    //
    // A project's own SSH remotes, configured from its sidebar row's ⋯ menu,
    // shown as a floating card instead of one more permanent sidebar row. The
    // section lives in `dsh-ssh.json` under `floating` (see store.js) and is
    // keyed by the PARENT's workspace id, so every project owns its own set.
    //
    // The list reply carries the join with live state — mounted / registered /
    // hostMissing / parentMissing — because the browser half must not guess
    // from a stored path whether the workspace behind it still exists.
    {
      kind: 'exact',
      path: ROUTES.floatingList,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const parentId = queryParam(url, 'parentId') ?? ''
        try {
          const rows = floatingRows()
          writeJson(res, 200, {
            items: parentId === '' ? rows : rows.filter(row => row.parentId === parentId),
          })
        } catch (error) {
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.floatingSave,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const parentId = typeof body?.parentId === 'string' ? body.parentId.trim() : ''
        const parentPath = typeof body?.parentPath === 'string' ? body.parentPath.trim() : ''
        const alias = typeof body?.alias === 'string' ? body.alias.trim() : ''
        const remotePath = typeof body?.remotePath === 'string' ? body.remotePath.trim() : ''
        const title = typeof body?.title === 'string' ? body.title.trim() : ''
        if (parentId === '' || alias === '' || remotePath === '') {
          writeJson(res, 400, { error: 'parentId, alias and remotePath are required' })
          return
        }
        if (!remotePath.startsWith('/')) {
          writeJson(res, 400, { error: 'remotePath must be an absolute remote path' })
          return
        }
        // A host that does not exist would produce a floating entry that can
        // never be mounted; saying so now is clearer than a status badge later.
        if (!hostRows().some(row => row.alias === alias)) {
          writeJson(res, 400, { error: `unknown SSH host ${JSON.stringify(alias)}` })
          return
        }
        try {
          // Idempotent: configuring the same directory of the same host under
          // the same project twice returns the existing entry (a second click
          // in the add dialog must not create a twin row).
          const existing = engine.store.entryStore.floating()
            .find(item => item.parentId === parentId && item.alias === alias && item.remotePath === normalizeRemotePath(remotePath))
          const item = existing !== undefined
            ? (title === '' ? existing : engine.store.entryStore.updateFloating(existing.id, { title }))
            : engine.store.entryStore.putFloating({ parentId, parentPath, alias, remotePath, title })
          writeJson(res, 200, { ok: true, created: existing === undefined, item: floatingRowOf(item) })
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.floatingUpdate,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const id = typeof body?.id === 'string' ? body.id.trim() : ''
        if (id === '') {
          writeJson(res, 400, { error: 'id is required' })
          return
        }
        // Renaming is a CONFIG rename only: it changes the name shown in the
        // menu and on the floating card. The registered DSH workspace keeps its
        // own title (the user can rename that natively from the row's ⋯ menu),
        // and the configured name is what a future mount registers with. This
        // keeps this plugin out of the registry's rename path entirely.
        const patch = {}
        if (typeof body?.title === 'string') patch.title = body.title.trim()
        if (typeof body?.parentId === 'string') patch.parentId = body.parentId.trim()
        if (typeof body?.parentPath === 'string') patch.parentPath = body.parentPath.trim()
        if (typeof body?.alias === 'string') patch.alias = body.alias.trim()
        if (typeof body?.remotePath === 'string') patch.remotePath = body.remotePath.trim()
        try {
          const item = engine.store.entryStore.updateFloating(id, patch)
          if (item === undefined) {
            writeJson(res, 404, { error: `no floating workspace ${JSON.stringify(id)}` })
            return
          }
          writeJson(res, 200, { ok: true, item: floatingRowOf(item) })
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.floatingDelete,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const id = typeof body?.id === 'string' ? body.id.trim() : ''
        if (id === '') {
          writeJson(res, 400, { error: 'id is required' })
          return
        }
        const deregister = body?.deregister === true
        try {
          const item = engine.store.entryStore.floating().find(candidate => candidate.id === id)
          if (item === undefined) {
            writeJson(res, 404, { error: `no floating workspace ${JSON.stringify(id)}` })
            return
          }
          let teardown
          if (deregister) {
            const workspacePath = formatRemotePath(item.alias, item.remotePath)
            teardown = await teardownWorkspace({
              router,
              store: engine.store,
              prompts,
              ctx,
              workspacePath,
              mode: 'deregister',
            })
          }
          // The configuration goes away in both cases: the user asked for this
          // entry to stop existing, and an entry pointing at a workspace that
          // was just deleted would only linger as a broken row.
          engine.store.entryStore.deleteFloating(id)
          writeJson(res, 200, {
            ok: true,
            removed: true,
            deregistered: teardown?.deregistered === true,
            ...(teardown === undefined ? {} : { archived: teardown.archived }),
          })
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.floatingReorder,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const parentId = typeof body?.parentId === 'string' ? body.parentId.trim() : ''
        if (parentId === '') {
          writeJson(res, 400, { error: 'parentId is required' })
          return
        }
        const ids = Array.isArray(body?.ids) ? body.ids.filter(id => typeof id === 'string') : []
        try {
          engine.store.entryStore.reorderFloating(parentId, ids)
          writeJson(res, 200, {
            ok: true,
            items: floatingRows().filter(row => row.parentId === parentId),
          })
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ---- agent prompt configuration (three levels) --------------------------
    //
    // GET    /agent-prompts          the whole configuration + mounted roots
    // POST   /agent-prompts/global     replace the global level
    // POST   /agent-prompts/host       replace one host's level (alias in body)
    // POST   /agent-prompts/workspace  replace one workspace's level
    // GET    /agent-prompts/preview    expand one workspace right now
    //
    // The levels carry {globs, scripts, disabled}; entries arrive as strings or
    // {pattern}/{command} objects and are normalized (ids derived) by the store.
    // A save invalidates the affected cache entries and eagerly re-merges, so
    // running sessions pick the change up at their next model step.
    {
      kind: 'exact',
      path: ROUTES.agentPrompts,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        let config
        try {
          config = engine.store.entryStore.agentPrompts()
        } catch (error) {
          writeJson(res, 200, { error: error instanceof Error ? error.message : String(error) })
          return
        }
        writeJson(res, 200, { ...config, mounted: router.listRoots() })
      },
    },
    {
      kind: 'exact',
      path: ROUTES.agentPromptsGlobal,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        try {
          const global = engine.store.entryStore.setGlobalAgentPrompts(body)
          prompts?.invalidateAll()
          void prompts?.refreshAll(router.listRoots())
          writeJson(res, 200, { ok: true, global })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.agentPromptsHost,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const alias = typeof body?.alias === 'string' ? body.alias.trim() : ''
        if (alias === '') {
          writeJson(res, 400, { error: 'alias is required' })
          return
        }
        try {
          const level = engine.store.entryStore.setHostAgentPrompts(alias, body)
          prompts?.invalidateAlias(alias)
          refreshAliasPrompts(prompts, router.listRoots(), alias)
          writeJson(res, 200, { ok: true, alias, level })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.agentPromptsWorkspace,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        let parts
        try {
          parts = parseRemotePath(typeof body?.workspacePath === 'string' ? body.workspacePath : '')
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          return
        }
        if (parts === undefined) {
          writeJson(res, 400, { error: 'workspacePath must be an ssh://<alias>/<abs-path> spelling' })
          return
        }
        const workspacePath = `ssh://${parts.alias}${parts.remotePath}`
        try {
          const level = engine.store.entryStore.setWorkspaceAgentPrompts(workspacePath, body)
          prompts?.invalidateWorkspace(workspacePath)
          void prompts?.refreshWorkspace(workspacePath)
          writeJson(res, 200, { ok: true, workspacePath, level })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.agentPromptsPreview,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const workspacePath = queryParam(url, 'workspacePath') ?? ''
        if (prompts === undefined || prompts === null) {
          writeJson(res, 500, { error: 'the agent-prompt registry is unavailable' })
          return
        }
        let parts
        try {
          parts = parseRemotePath(workspacePath)
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          return
        }
        if (parts === undefined) {
          writeJson(res, 400, { error: 'workspacePath query parameter is required' })
          return
        }
        try {
          const result = await prompts.preview(`ssh://${parts.alias}${parts.remotePath}`)
          writeJson(res, 200, {
            ok: true,
            workspacePath: `ssh://${parts.alias}${parts.remotePath}`,
            files: result.files,
            errors: result.errors,
            chars: result.text.length,
          })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ---- the auto-injected "local-exec" skill (read-only) -------------------
    //
    // GET /skill — the payload this plugin registered into the host's skill
    // registry, so the panel can show exactly what the model sees instead of
    // guessing. Registration is best-effort (no skills service, or a failing
    // register, only warns at load — see local-exec-skill.js), so the reply
    // reports that outcome rather than failing: `registered: false` with the
    // skill's name and a reason. The verdict travels through the
    // `localExecSkill` sink captured at apply time and mutated in place by
    // the registration effect.
    {
      kind: 'exact',
      path: ROUTES.skill,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const skill = deps.localExecSkill
        if (skill?.registered !== true || skill?.payload === null || skill?.payload === undefined) {
          writeJson(res, 200, {
            registered: false,
            name: LOCAL_EXEC_SKILL_NAME,
            error: 'the "local-exec" skill is not registered — the host skills service was unavailable at plugin load, or the registration failed (see the plugin startup log)',
          })
          return
        }
        const { name, description, whenToUse, content } = skill.payload
        writeJson(res, 200, { registered: true, name, description, whenToUse, content })
      },
    },
    // ---- Niubash runtime initialization (win hosts) --------------------------
    //
    // GET  /niubash/status?alias=X  — the initialization dialog's ONE query:
    // the recorded deployment (when the host entry carries one), else a
    // single three-level placement probe, plus the payload pin this process
    // trusts and the mounted project placements the dialog can offer.
    // POST /niubash/init            — start (or force-replace) a deployment
    // into the chosen placement; the request completes with the deployment
    // result (no polling — the browser cancels by aborting the fetch, which
    // aborts the provisioning through the same AbortSignal the engine gets).
    //
    // The probe respects the trust discipline everywhere else in this plugin:
    // existence is never enough — a probed tree must answer `--version` for
    // real before the dialog may call it initialized.
    {
      kind: 'exact',
      path: ROUTES.niubashStatus,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const alias = queryParam(url, 'alias')?.trim() ?? ''
        if (alias === '') {
          writeJson(res, 400, { error: 'alias query parameter is required' })
          return
        }
        const row = engine.store.rows().find(candidate => candidate.alias === alias)
        if (row === undefined) {
          writeJson(res, 400, { error: `alias ${JSON.stringify(alias)} is not a known host` })
          return
        }
        const entry = engine.store.entry(alias)
        const placements = projectPlacementsOf(alias)
        const record = entry?.bashProvisioned ?? undefined
        // ---- 已初始化（有记录）：一次读档即答，不发网络探测。
        if (record !== undefined) {
          writeJson(res, 200, {
            ok: true,
            alias,
            os: typeof row.os === 'string' ? row.os : '',
            editable: entry !== undefined,
            initialized: true,
            record,
            probe: { ran: false },
            placements,
            payload: payloadSummary(),
          })
          return
        }
        // ---- 无记录：按 1→2→3 默认位置探测一次（存在 + 实测才算）。
        try {
          const candidates = niubashCandidates(entry, placements.map(placement => placement.root))
          let found
          if (candidates.length > 0) {
            const outcome = await engine.exec(alias, buildNiubashProbeScript(candidates), { timeoutMs: 15_000 })
            const pin = resolvePayloadPin()
            const exeRelative = pin.executableRelativePath.replaceAll('/', '\\')
            for (const hitRoot of parseBashProbeOutput(outcome.stdout)) {
              // cmd expands %VAR% at line-parse time, so a hit's echo is the
              // CONCRETE root (`C:\Users\…`), while the user/legacy candidate
              // roots are `%USERPROFILE%` templates — equality can never hit.
              // Match through the same suffix judgment resolveWinBash uses.
              const candidate = niubashCandidateOfHit(hitRoot, candidates, pin.version)
              if (candidate === undefined) continue
              const exePath = `${hitRoot.replace(/[\\/]+$/u, '')}\\${exeRelative}`
              const verified = await verifyBashExecutable(engine, alias, exePath, {
                prefix: bashLaunchPrefix(hitRoot),
                timeoutMs: 15_000,
              })
              if (verified !== undefined) {
                found = {
                  root: hitRoot.replace(/[\\/]+$/u, ''),
                  path: exePath,
                  placement: candidate.placement,
                  version: verified.version,
                  releaseTag: pin.releaseTag,
                  source: 'probe',
                }
                // The injection gate reads this cache synchronously; a probe
                // that just PROVED the runtime live is the fact it wants.
                engine.noteNiubashPresence(alias, found)
                break
              }
            }
          }
          writeJson(res, 200, {
            ok: true,
            alias,
            os: typeof row.os === 'string' ? row.os : '',
            editable: entry !== undefined,
            initialized: found !== undefined,
            ...(found !== undefined ? { probed: found } : {}),
            probe: { ran: true, found: found !== undefined },
            placements,
            payload: payloadSummary(),
          })
        } catch (error) {
          // A probe failure (unreachable host, odd shell) is the dialog's
          // "not initialized" answer, not a route error — the user can still
          // choose a placement and initialize.
          writeJson(res, 200, {
            ok: true,
            alias,
            os: typeof row.os === 'string' ? row.os : '',
            editable: entry !== undefined,
            initialized: false,
            probe: { ran: true, found: false, error: error instanceof Error ? error.message : String(error) },
            placements,
            payload: payloadSummary(),
          })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.niubashInit,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const alias = typeof body?.alias === 'string' ? body.alias.trim() : ''
        const placement = typeof body?.placement === 'string' ? body.placement : ''
        if (alias === '') {
          writeJson(res, 400, { error: 'alias is required' })
          return
        }
        if (!['project', 'user', 'custom'].includes(placement)) {
          writeJson(res, 400, { error: 'placement must be one of project, user, custom' })
          return
        }
        // Only editable store entries can carry the deployment record — the
        // same gate the provisioner enforces, said here with the wording the
        // panel's other host-scoped routes use.
        if (engine.store.entryStore.find(alias) === undefined) {
          const inConfig = engine.store.sshConfigAliases().includes(alias)
          writeJson(res, 400, {
            error: inConfig
              ? `alias ${JSON.stringify(alias)} comes from the ~/.ssh/config fallback, which cannot carry a deployment record — save it in the host panel first`
              : `alias ${JSON.stringify(alias)} is not in the editable host store`,
          })
          return
        }
        // ---- 校验参数 → 准备 installRoot（按放置路径三选一）。
        let installRoot
        try {
          if (placement === 'project') {
            const placements = projectPlacementsOf(alias)
            const requested = typeof body?.projectPath === 'string' ? body.projectPath.trim() : ''
            const picked = requested === ''
              ? placements[0]
              : placements.find(candidate => candidate.workspacePath === requested || candidate.root.toLowerCase() === windowsRemotePath(requested).toLowerCase())
            if (picked === undefined) {
              throw new Error(requested === ''
                ? 'no project workspace is mounted from this host — mount one first, or choose another placement'
                : `projectPath ${JSON.stringify(requested)} is not a workspace mounted from this host`)
            }
            installRoot = niubashRootFor('project', { projectRoot: picked.root })
          } else if (placement === 'custom') {
            if (typeof body?.customRoot !== 'string' || body.customRoot.trim() === '') {
              throw new Error('customRoot is required for the custom placement')
            }
            installRoot = niubashRootFor('custom', { customRoot: body.customRoot })
          }
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          return
        }
        // ---- 取消通道：浏览器 abort 掉 fetch 会关闭 socket；同一
        // AbortSignal 一路传进引擎（下载 / 上传 / 远端校验全部响应）。
        const controller = new AbortController()
        let answered = false
        const onClose = () => {
          if (!answered) controller.abort(new Error('the initialization request was cancelled'))
        }
        req.on('close', onClose)
        try {
          const outcome = await provisionWinBash(engine, alias, {
            ...(installRoot !== undefined ? { installRoot } : {}),
            placement,
            ...(body?.force === true ? { force: true } : {}),
            signal: controller.signal,
          })
          const record = engine.store.entry(alias)?.bashProvisioned ?? undefined
          answered = true
          writeJson(res, 200, { ok: true, provisioned: outcome, record })
        } catch (error) {
          answered = true
          const aborted = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
          if (aborted) {
            // The browser is gone; nothing useful can be written to the
            // socket. Log so the cancelled attempt is not invisible.
            ctx?.logger?.warn?.(`ssh-workspace: niubash init on ${JSON.stringify(alias)} cancelled (${error instanceof Error ? error.message : String(error)})`)
            return
          }
          writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ---- the auto-injected content, in full (the 好设计 display-page rule) --
    //
    // GET /injected — everything this plugin injects into a session's model
    // context: the base announcement verbatim, the registered local-exec
    // skill payload, and per-host Niubash sections with their gate verdicts.
    // The plugin injects automatically, so the panel must be able to SHOW
    // exactly what the model sees — this route is that page's data.
    //
    // Which hosts appear: every Windows-type host (os === 'win') plus any
    // host carrying a provisioned record regardless of its pinned OS. Each
    // row names whether the gate HITS (record present, or a placement probe
    // proved the runtime live this process) and carries the exact text a
    // session on that host would receive after the announcement.
    {
      kind: 'exact',
      path: ROUTES.injected,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const skill = deps.localExecSkill
        const skillReply = skill?.registered === true && skill?.payload !== null && skill?.payload !== undefined
          ? (({ name, description, whenToUse, content }) => ({ registered: true, name, description, whenToUse, content }))(skill.payload)
          : { registered: false, name: LOCAL_EXEC_SKILL_NAME }
        const hosts = engine.store.rows()
          .filter(row => row.os === 'win' || engine.store.entry(row.alias)?.bashProvisioned !== undefined)
          .map(row => {
            const record = engine.store.entry(row.alias)?.bashProvisioned
            const presence = typeof engine.niubashPresenceOf === 'function' ? engine.niubashPresenceOf(row.alias) : undefined
            const hit = record !== undefined || presence !== undefined
            const info = record ?? presence
            return {
              alias: row.alias,
              os: typeof row.os === 'string' ? row.os : '',
              hit,
              ...(hit
                ? {
                    root: info?.root,
                    path: info?.path,
                    version: info?.version,
                    releaseTag: info?.releaseTag,
                    placement: info?.placement,
                    source: record !== undefined ? 'record' : presence?.source ?? 'probe',
                    text: niubashGuidanceSection(info, row.alias),
                  }
                : {}),
            }
          })
        writeJson(res, 200, { guidance: SSH_WORKSPACE_GUIDANCE, skill: skillReply, niubash: { hosts } })
      },
    },
    // ---- open port forward
    {
      kind: 'exact',
      path: ROUTES.forward,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const alias = typeof body?.alias === 'string' ? body.alias.trim() : ''
        const asPort = (value, label) => {
          const numeric = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : undefined)
          if (numeric === undefined) return undefined
          if (!Number.isInteger(numeric) || numeric < 0 || numeric > 65535) throw new Error(`${label} must be an integer between 0 and 65535`)
          return numeric
        }
        try {
          const remotePort = asPort(body?.remotePort, 'remotePort')
          if (remotePort === undefined || remotePort < 1) throw new Error('remotePort is required (1-65535)')
          const localPort = asPort(body?.localPort, 'localPort')
          const forward = await forwards.open(alias, {
            remotePort,
            ...(localPort !== undefined ? { localPort } : {}),
            ...(typeof body?.remoteHost === 'string' && body.remoteHost.trim() !== '' ? { remoteHost: body.remoteHost.trim() } : {}),
            ...(typeof body?.localHost === 'string' && body.localHost.trim() !== '' ? { localHost: body.localHost.trim() } : {}),
          })
          writeJson(res, 200, { ok: true, forward })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ---- close port forward
    {
      kind: 'exact',
      path: ROUTES.unforward,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const id = typeof body?.id === 'string' ? body.id.trim() : ''
        if (id === '') {
          writeJson(res, 400, { error: 'id is required' })
          return
        }
        try {
          writeJson(res, 200, { ok: true, closed: forwards.close(id) })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ---- saved forwards: create / toggle / delete / remember
    //
    // These sit beside the two transient routes above rather than replacing
    // them: the agent tools still open throwaway tunnels, and a user who wants
    // one of those kept can "remember" it afterwards.
    {
      kind: 'exact',
      path: ROUTES.forwardSave,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        if (savedForwards === undefined) { writeJson(res, 500, { error: 'saved forwards are unavailable' }); return }
        const body = await readJsonBody(req)
        const alias = typeof body?.alias === 'string' ? body.alias.trim() : ''
        const asPort = (value, label) => {
          const numeric = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : undefined)
          return numeric === undefined ? undefined : requireStoredPort(numeric, label)
        }
        try {
          const remotePort = asPort(body?.remotePort, 'remotePort')
          const rawLocal = asPort(body?.localPort, 'localPort')
          if (remotePort === undefined) throw new Error('remotePort is required (1-65535)')
          // A saved mapping pins its local port; "same as remote" is resolved
          // here, in the request, so the stored row records a real number.
          const localPort = rawLocal ?? remotePort
          const row = await savedForwards.create({
            alias,
            remotePort,
            localPort,
            ...(typeof body?.remoteHost === 'string' && body.remoteHost.trim() !== '' ? { remoteHost: body.remoteHost.trim() } : {}),
            ...(typeof body?.localHost === 'string' && body.localHost.trim() !== '' ? { localHost: body.localHost.trim() } : {}),
            open: body?.open !== false,
          })
          writeJson(res, 200, {
            ok: true,
            forward: row,
            ...(row.error === undefined ? {} : { error: row.error }),
          })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.forwardToggle,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        if (savedForwards === undefined) { writeJson(res, 500, { error: 'saved forwards are unavailable' }); return }
        const body = await readJsonBody(req)
        const id = typeof body?.id === 'string' ? body.id.trim() : ''
        if (id === '') { writeJson(res, 400, { error: 'id is required' }); return }
        const enabled = body?.enabled === true
        try {
          // The toggle follows the requested state, and the row it returns
          // reports the runtime truth: an `enabled: true` request that could
          // not bind comes back with `live: false` and an `error`.
          const row = enabled ? await savedForwards.openById(id) : savedForwards.closeById(id)
          writeJson(res, 200, { ok: row.error === undefined, forward: row, ...(row.error === undefined ? {} : { error: row.error }) })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          writeJson(res, 200, { ok: false, error: message, forward: savedForwards.rowById(id) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.forwardDelete,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        if (savedForwards === undefined) { writeJson(res, 500, { error: 'saved forwards are unavailable' }); return }
        const body = await readJsonBody(req)
        const id = typeof body?.id === 'string' ? body.id.trim() : ''
        if (id === '') { writeJson(res, 400, { error: 'id is required' }); return }
        try {
          writeJson(res, 200, { ok: true, deleted: savedForwards.remove(id) })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.forwardRemember,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        if (savedForwards === undefined) { writeJson(res, 500, { error: 'saved forwards are unavailable' }); return }
        const body = await readJsonBody(req)
        const id = typeof body?.id === 'string' ? body.id.trim() : ''
        if (id === '') { writeJson(res, 400, { error: 'id is required' }); return }
        try {
          writeJson(res, 200, { ok: true, forward: savedForwards.remember(id) })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ---- check a local port before the user commits to it
    {
      kind: 'exact',
      path: ROUTES.forwardProbe,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const host = (url.searchParams.get('localHost') ?? '127.0.0.1').trim() || '127.0.0.1'
        const rawPort = (url.searchParams.get('localPort') ?? '').trim()
        const port = rawPort === '' ? Number.NaN : Number(rawPort)
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          writeJson(res, 400, { error: 'localPort must be an integer between 1 and 65535' })
          return
        }
        try {
          const verdict = await probeLocalPort(host, port)
          writeJson(res, 200, {
            ok: true,
            available: verdict.ok,
            ...(verdict.ok ? {} : { code: verdict.code, error: describeProbeFailure(host, port, verdict.code) }),
          })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ---- saved forward preferences
    {
      kind: 'exact',
      path: ROUTES.forwardSettings,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        if (savedForwards === undefined) { writeJson(res, 500, { error: 'saved forwards are unavailable' }); return }
        const body = await readJsonBody(req)
        try {
          // Only `autoStart` is settable today; anything else in the body is
          // ignored so a stale browser cannot rewrite unrelated settings.
          const settings = savedForwards.setAutoStart(body?.autoStart === true)
          writeJson(res, 200, { ok: true, settings })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ---- move a file between this machine and a host
    {
      kind: 'exact',
      path: ROUTES.transfer,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const alias = typeof body?.alias === 'string' ? body.alias.trim() : ''
        const direction = body?.direction === 'download' ? 'download' : body?.direction === 'upload' ? 'upload' : ''
        const localPath = typeof body?.localPath === 'string' ? body.localPath.trim() : ''
        const remotePath = typeof body?.remotePath === 'string' ? body.remotePath.trim() : ''
        if (alias === '') { writeJson(res, 400, { error: 'alias is required' }); return }
        if (direction === '') { writeJson(res, 400, { error: 'direction must be upload or download' }); return }
        if (localPath === '') { writeJson(res, 400, { error: 'localPath is required' }); return }
        if (remotePath === '') { writeJson(res, 400, { error: 'remotePath is required' }); return }
        try {
          router.assertEnabled(alias, remotePath)
          const result = direction === 'upload' && body?.recursive === true
            ? await uploadTree(engine, { alias, localPath, remotePath, roots: router.roots })
            : await transferFile(engine, { alias, direction, localPath, remotePath, roots: router.roots })
          writeJson(res, 200, { ok: true, bytes: result.bytes, ...(result.files !== undefined ? { files: result.files } : {}) })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ---- stream one remote file to the browser
    //
    // Separate from `transfer` on purpose: that route moves a file to a path on
    // THIS machine (a tool-shaped, JSON answer), while the browser needs the
    // bytes themselves. Streaming them out keeps a download from being decoded
    // into a JSON string, which would inflate it and cap it at the body limit.
    {
      kind: 'exact',
      path: ROUTES.download,
      handler: async (req, res) => {
        if (!refuseUnlessAllowed(req, res)) return
        if (req.method !== 'GET') {
          writeJson(res, 405, { error: 'method not allowed' })
          return
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const alias = (url.searchParams.get('alias') ?? '').trim()
        const remotePath = (url.searchParams.get('path') ?? '').trim()
        if (alias === '' || remotePath === '') {
          writeJson(res, 400, { error: 'alias and path are required' })
          return
        }
        try {
          const { size, chunks } = await openRemoteRead(engine, alias, remotePath, router)
          res.writeHead(200, {
            'content-type': 'application/octet-stream',
            'content-length': String(size),
            'content-disposition': `attachment; filename="${basenameOf(remotePath)}"`,
          })
          for await (const chunk of chunks) res.write(chunk)
          res.end()
        } catch (error) {
          if (!res.headersSent) {
            // A failure must not look like a download. Answering 200 here used
            // to make the browser save the JSON error body under the remote
            // file's name: the client keys on `response.ok`, and a 200 blob of
            // `{"error":"..."}` is indistinguishable from file content once the
            // headers are gone. The status is the only channel the browser's
            // download flow respects, so it carries the failure.
            writeJson(res, statusForDownloadError(error), { error: error instanceof Error ? error.message : String(error) })
            return
          }
          res.end()
        }
      },
    },
    // ---- receive one file from the browser and write it to the host
    //
    // The browser posts the raw bytes as the request body (application/
    // octet-stream) rather than multipart: one file per request keeps the
    // streaming simple and avoids a multipart parser in the bundler-loaded
    // client. `path` names the remote directory, `name` the file inside it.
    {
      kind: 'exact',
      path: ROUTES.upload,
      handler: async (req, res) => {
        if (!refuseUnlessAllowed(req, res)) return
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'method not allowed' })
          return
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const alias = (url.searchParams.get('alias') ?? '').trim()
        const dir = (url.searchParams.get('path') ?? '').trim()
        const name = (url.searchParams.get('name') ?? '').trim()
        if (alias === '' || dir === '' || name === '') {
          writeJson(res, 400, { error: 'alias, path and name are required' })
          return
        }
        // A name is one path segment: a slash would let a request escape the
        // directory the user is looking at.
        if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
          writeJson(res, 400, { error: 'name must be a single path segment' })
          return
        }
        const remotePath = dir === '/' ? `/${name}` : `${dir.replace(/\/+$/u, '')}/${name}`
        try {
          const written = await writeRemoteFromRequest(engine, alias, remotePath, req, router)
          writeJson(res, 200, { ok: true, bytes: written, remotePath })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]
}

/**
 * Stream a request body into one remote file.
 *
 * The bytes go straight from the HTTP request into SFTP without buffering the
 * whole body: an upload can be far larger than what a JSON body limit allows,
 * and holding it in memory would defeat the point of streaming.
 *
 * Publication matches the filesystem half: write a sibling staging name, then
 * rename. A reader therefore never observes a half-written destination.
 *
 * @param {object} engine - live engine.
 * @param {string} alias - host alias.
 * @param {string} remotePath - absolute destination path.
 * @param {import('node:http').IncomingMessage} req - the request carrying the bytes.
 * @param {object} [router] - the filesystem router: the detached fence and the
 *   served-root set an upload is fenced against.
 * @returns {Promise<number>} how many bytes were written.
 */
async function writeRemoteFromRequest (engine, alias, remotePath, req, router) {
  router?.assertEnabled?.(alias, remotePath)
  return await engine.withSftp(alias, async (sftp) => {
    // The same reachability fence `write` and the transfer tool apply, run
    // before a single byte is staged. The browser panel reaches this route
    // directly, so without it a path outside every mounted workspace — or one
    // whose parent is a symlink escaping them — would land here while the model's
    // own `write` was refused. Policy (mode / session scope) is deliberately not
    // decided here: this is a user action on a directory the panel is showing,
    // and the mounted-root fence is the answer it owes.
    await fenceUploadTarget(sftp, alias, remotePath, router?.roots)
    await sftpMkdirp(sftp, remoteParentOf(remotePath), remotePath)
    const staging = `${remotePath.replace(/\/+$/u, '')}.dsh-up-${process.pid}-${Date.now().toString(36)}`
    let handle
    let written = 0
    try {
      handle = await sftpOpenHandle(sftp, staging, 'w', remotePath)
      for await (const chunk of req) {
        await sftpWriteHandle(sftp, handle, chunk, remotePath)
        written += chunk.length
      }
      await sftpCloseHandle(sftp, handle)
      handle = undefined
      await sftpPublishRename(sftp, staging, remotePath, remotePath)
      return written
    } catch (error) {
      if (handle !== undefined) { try { await sftpCloseHandle(sftp, handle) } catch { /* already gone */ } }
      try { await sftpUnlink(sftp, staging) } catch { /* staging never created */ }
      throw error
    }
  })
}

/**
 * An error that carries an `FsError` code without importing the peer class.
 *
 * `statusForDownloadError` branches on `code`, and the fence already raises a
 * real `FsError` with `FS_PERMISSION_DENIED` (detached) or `FS_OUTSIDE_WORKSPACE`
 * (unmounted) — so the two failures that this file raises itself must use the
 * same vocabulary, or a missing file would answer 500 and read as a server fault.
 *
 * @param {string} message - what went wrong, for the user.
 * @param {string} code - the `FsError` code.
 * @returns {Error} the error to throw.
 */
function codedError (message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

/**
 * Open one remote file for chunked reading.
 *
 * @param {object} engine - live engine.
 * @param {string} alias - host alias.
 * @param {string} remotePath - absolute remote path.
 * @param {object} [router] - the filesystem router, used for the detached fence.
 * @returns {Promise<{size: number, chunks: AsyncGenerator<Buffer>}>} the size and a chunk stream.
 */
async function openRemoteRead (engine, alias, remotePath, router) {
  router?.assertEnabled?.(alias, remotePath)
  return await engine.withSftp(alias, async (sftp) => {
    const info = await sftpStatOrNull(sftp, remotePath)
    if (info === null) throw codedError(`remote file does not exist: ${remotePath}`, 'FS_NOT_FOUND')
    if (typeof info.isDirectory === 'function' && info.isDirectory()) {
      throw codedError(`not a file: ${remotePath}`, 'FS_NOT_REGULAR_FILE')
    }
    const size = typeof info.size === 'number' ? info.size : 0
    const handle = await sftpOpenHandle(sftp, remotePath, 'r', remotePath)
    let position = 0
    let closed = false
    const closeOnce = async () => {
      if (closed) return
      closed = true
      try { await sftpCloseHandle(sftp, handle) } catch { /* already gone */ }
    }
    async function * generate () {
      try {
        for (;;) {
          const chunk = await sftpReadHandle(sftp, handle, position, 256 * 1024, remotePath)
          if (chunk.length === 0) break
          position += chunk.length
          yield chunk
        }
      } finally {
        await closeOnce()
      }
    }
    return { size, chunks: generate() }
  })
}

/** The final path segment, for the downloaded filename. */
function basenameOf (remotePath) {
  const trimmed = String(remotePath).replace(/\/+$/u, '')
  const index = trimmed.lastIndexOf('/')
  return (index < 0 ? trimmed : trimmed.slice(index + 1)).replaceAll('"', '_') || 'download'
}

/**
 * Validate a port a saved mapping may name.
 *
 * Distinct from the transient route's parser: a saved mapping is a promise
 * about a specific local URL, so 0 ("any free port") is not storable.
 *
 * @param {number} value - the candidate.
 * @param {string} label - field name for the error.
 * @returns {number} the port.
 * @throws {Error} when out of range.
 */
function requireStoredPort (value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${label} must be an integer between 1 and 65535`)
  }
  return value
}

/**
 * Turn a failed port probe into the sentence the panel shows.
 *
 * The two codes a user can actually act on are named; everything else keeps the
 * raw code so a bug report is still diagnosable.
 *
 * @param {string} host - the local interface probed.
 * @param {number} port - the local port probed.
 * @param {string | undefined} code - the bind error code.
 * @returns {string} the explanation.
 */
function describeProbeFailure (host, port, code) {
  if (code === 'EADDRINUSE') return `local port ${port} on ${host} is already in use`
  if (code === 'EACCES') return `local port ${port} on ${host} is not bindable (permission denied or reserved by the system)`
  if (code === 'EADDRNOTAVAIL') return `local address ${host} does not exist on this machine`
  return `local port ${port} on ${host} cannot be bound${code === undefined ? '' : ` (${code})`}`
}
