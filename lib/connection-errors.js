/**
 * Classification and enrichment of the raw failures an SSH connect can die with.
 *
 * ssh2 surfaces connect failures as bare transport errors — an `ETIMEDOUT`
 * socket error, "Timed out while waiting for handshake", "All configured
 * authentication methods failed" — and the engine used to pass them through
 * untouched. A real outage (an overlay-tunnel reboot leaving a host briefly
 * unreachable) then reached the user as one opaque line: no host name, no
 * stage, no advice, nothing to act on. This module gives every failure a
 * stable kind, a one-line summary and an actionable hint, wrapped in the same
 * shape the host-key refusal already uses —
 * `host "alias" (user@host:port): <summary>` followed by the hint — with the
 * raw ssh2 error preserved as `cause`.
 *
 * Classification follows the connect lifecycle:
 *
 *  - network (TCP never established): `timeout`, `refused`, `dns`,
 *    `unreachable`, `reset`;
 *  - protocol (TCP established, the SSH handshake broke): `protocol`;
 *  - authentication (handshake fine, credentials refused): `auth`;
 *  - host key (our own TOFU pin rejected the server): `hostkey`;
 *  - `unknown` as the fallback, echoing the raw message.
 *
 * One error cannot always be pinned to a single layer: ssh2's ready timeout
 * fires both when TCP never opens and when the port answers but the handshake
 * stalls. Both share the `timeout` kind, and the hint names both possible
 * causes instead of pretending to know which one it was.
 *
 * @module @shiqyka/dsh-ssh-workspace/connection-errors
 */

/** The closed set of kinds {@link classifyConnectError} can return. */
export const CONNECT_ERROR_KINDS = Object.freeze({
  timeout: 'timeout',
  refused: 'refused',
  dns: 'dns',
  unreachable: 'unreachable',
  reset: 'reset',
  protocol: 'protocol',
  auth: 'auth',
  hostkey: 'hostkey',
  unknown: 'unknown',
})

/** The message of an error-like value, or `''` when it has none. */
function messageOf (error) {
  if (typeof error?.message === 'string') return error.message
  return ''
}

/** The `code` of an error-like value, when ssh2/net carried one as a string. */
function codeOf (error) {
  return typeof error?.code === 'string' ? error.code : undefined
}

/** The ssh2 `level` of an error-like value (`client-timeout`, `handshake`, …). */
function levelOf (error) {
  return typeof error?.level === 'string' ? error.level : undefined
}

/**
 * Classify one raw connect failure.
 *
 * Pure function over the error: no network, no engine state, so tests can pin
 * every mapping with synthetic error objects shaped exactly like the ones
 * ssh2 and the OS emit (an `errnoException` carries `code`; ssh2's own
 * timeouts carry `level: 'client-timeout'`; DNS failures arrive wrapped with
 * `level: 'client-dns'`).
 *
 * @param {unknown} error - the raw ssh2/socket error (or any thrown value).
 * @returns {{kind: string, summary: string, hint: string}} the stable kind,
 *   a one-line English summary for the message headline, and an actionable
 *   hint for the lines that follow it.
 */
export function classifyConnectError (error) {
  const message = messageOf(error)
  const code = codeOf(error)
  const level = levelOf(error)

  // Our own host-key pin rejecting the server. The engine usually intercepts
  // this one earlier and raises hostKeyMismatchError with both fingerprints;
  // this arm covers the raw ssh2 fatal error reaching classification directly.
  if (/host denied \(verification failed\)|host key verification failed/iu.test(message)) {
    return {
      kind: CONNECT_ERROR_KINDS.hostkey,
      summary: 'the server presented a host key that was rejected',
      hint: 'The key does not match the one recorded for this host. Verify that a key change is legitimate, then use "forget host key" for this host in the remote-workspace panel and connect again; if you did not expect a key change, treat it as a possible man-in-the-middle and do not proceed.',
    }
  }

  // The ready timeout: ssh2 gives up after `readyTimeout` and emits exactly
  // this message (level client-timeout); an OS-level TCP connect timeout
  // arrives as an ETIMEDOUT socket error instead. Both mean "the host did not
  // answer in time", and neither says whether TCP ever opened — so one kind
  // carries both possible causes in its hint.
  if (level === 'client-timeout' || code === 'ETIMEDOUT' || /timed out while waiting for handshake/iu.test(message)) {
    return {
      kind: CONNECT_ERROR_KINDS.timeout,
      summary: 'no answer from the server while connecting',
      hint: 'The host did not answer in time. Either the host was unreachable (wrong IP or port in the panel, the host is powered off, a firewall drops the packets, or a VPN / overlay tunnel between this machine and the host is down), or the port answered but the SSH handshake stalled (something that is not sshd owns the port, sshd is hung or badly overloaded, or a middle box interferes). Check the host is online and reachable — try "ssh -p <port> <user>@<host>" or "ping <host>" from this machine — then reconnect.',
    }
  }

  // The host is reachable and explicitly said "nothing listens here".
  if (code === 'ECONNREFUSED') {
    return {
      kind: CONNECT_ERROR_KINDS.refused,
      summary: 'the server actively refused the connection on that port',
      hint: 'The host is reachable, but nothing is listening on the configured port: sshd may not be running, or the port saved in the panel is wrong. Check the sshd service on the host (e.g. "systemctl status sshd") and confirm the port in the panel matches the port sshd listens on.',
    }
  }

  // The name never became an address. ssh2 wraps the resolver error ("Error
  // while looking up IPv4 address for 'x': getaddrinfo ENOTFOUND …"), so the
  // message match catches it even when the code lives on the inner error.
  if (level === 'client-dns' || code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /getaddrinfo /iu.test(message)) {
    return {
      kind: CONNECT_ERROR_KINDS.dns,
      summary: 'the host name could not be resolved to an address',
      hint: 'This machine could not look up the host name: check the spelling of the host name or IP in the panel, and that it resolves from THIS machine (try "ping <host>" locally) — a name that resolves elsewhere but not here is still this failure.',
    }
  }

  // The network itself has no route: wrong subnet, downed interface or tunnel.
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return {
      kind: CONNECT_ERROR_KINDS.unreachable,
      summary: 'no network route to the host',
      hint: 'Nothing routes to the host from this machine: confirm both are on the same network or subnet, that the VPN / tunnel carrying the route is up, and that the host is powered on.',
    }
  }

  // The connection was cut mid-establishment — transient by nature.
  if (code === 'ECONNRESET' || code === 'ECONNABORTED') {
    return {
      kind: CONNECT_ERROR_KINDS.reset,
      summary: 'the connection was cut while being established',
      hint: 'Something reset the connection mid-way — transient network trouble, a strict firewall, or an intermediary device dropping the session. Retry once; if it keeps failing, check the network path (VPN, tunnel, firewall) between this machine and the host.',
    }
  }

  // The handshake got far enough for sshd to refuse every credential offered.
  if (/all configured authentication methods failed|authentication failed/iu.test(message)) {
    return {
      kind: CONNECT_ERROR_KINDS.auth,
      summary: 'the server rejected the configured credentials',
      hint: 'Every authentication method the plugin offered was refused: check the user name, and the password / private key / agent configured for this host in the panel. A local "ssh <user>@<host>" with the same credentials shows whether the credentials or the plugin configuration is at fault.',
    }
  }

  // TCP opened but the SSH protocol broke before completing: the port speaks
  // something else, sshd died mid-handshake, or an intermediary meddles.
  if (level === 'handshake' || level === 'protocol' || /handshake|banner exchange|key exchange|algorithm negotiation|protocol mismatch/iu.test(message)) {
    return {
      kind: CONNECT_ERROR_KINDS.protocol,
      summary: 'the SSH handshake broke before it completed',
      hint: 'The port answered but not with a working SSH server: another service may own the port, sshd may have crashed or be overloaded, or a middle box intercepts the session. "ssh -p <port> <user>@<host> -v" from this machine shows exactly where the handshake stops.',
    }
  }

  // Nothing matched: echo the raw message as the summary so the user still
  // sees what went wrong, with the generic pointers in the hint.
  return {
    kind: CONNECT_ERROR_KINDS.unknown,
    summary: message !== '' ? message : 'the connection failed',
    hint: 'No known failure pattern matched. Check the host is reachable and the credentials are right; the recent events in "ssh_workspace_status" often show when the failures started.',
  }
}

/**
 * Wrap one raw connect failure in the plugin's standard connect-failure shape.
 *
 * The result reads like the host-key refusal: the first line names the host
 * alias and the exact `user@host:port` the engine dialled, followed by the
 * classified summary and the actionable hint. The raw error travels as
 * `cause`, so nothing ssh2 reported is lost for logs and debugging. For a
 * timeout, the summary also states how long the engine waited
 * (`waitMs`, the engine's `connectTimeoutMs`), because "timed out" without a
 * number invites the question "how long?".
 *
 * The returned error carries the classification as a `kind` property so
 * callers (the engine's diagnostics line) can name the category without
 * re-classifying or parsing the message.
 *
 * @param {string} alias - the host alias the engine was connecting.
 * @param {object} resolved - the resolved descriptor that was dialled.
 * @param {unknown} error - the raw ssh2/socket error.
 * @param {number} [waitMs] - the connect budget that elapsed on a timeout.
 * @returns {Error} the enriched error (`kind` property, `cause` preserved).
 */
export function enrichConnectError (alias, resolved, error, waitMs = undefined) {
  const { kind, summary, hint } = classifyConnectError(error)
  // A resolve() that threw would never reach here (the engine builds the
  // descriptor first), but a defensive fallback keeps the headline readable
  // instead of printing `undefined@undefined:undefined` on a half-shaped one.
  const user = typeof resolved?.user === 'string' && resolved.user !== '' ? resolved.user : 'unknown-user'
  const host = typeof resolved?.host === 'string' && resolved.host !== '' ? resolved.host : 'unknown-host'
  const port = resolved?.port ?? '?'
  let headline = summary
  if (kind === CONNECT_ERROR_KINDS.timeout && Number.isFinite(waitMs) && waitMs > 0) {
    headline = `${summary} (waited ${Math.round(waitMs / 1000)}s)`
  }
  const enriched = new Error(
    `host ${JSON.stringify(alias)} (${user}@${host}:${port}): ${headline}\n${hint}`,
    { cause: error },
  )
  enriched.kind = kind
  return enriched
}
