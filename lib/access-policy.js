/**
 * Whether the browser half may serve private-network clients.
 *
 * ## Why this is not just `config.allowLan === true`
 *
 * The fence exists because these routes mount workspaces and move credentials,
 * so a deployment reachable from the open internet must not serve them. But
 * "reachable from somewhere else" used to be decided by the OPERATOR alone,
 * through one boolean, and the operator rarely remembers to set it: a DSH
 * instance whose webserver is bound to `0.0.0.0` is already listening on every
 * interface, and a browser on the LAN — or behind a Docker port mapping — then
 * gets `403 forbidden: loopback-only` for every panel request. The panel looks
 * broken while the only wrong thing was a missing opt-in.
 *
 * So the default is derived from the fact that already made the deployment
 * reachable: the bind address. Binding `0.0.0.0` IS the operator's statement
 * that the server may be reached from elsewhere; a loopback bind keeps the
 * historical fence with no change in behaviour.
 *
 * ## Three states, not two
 *
 *  - `true` — serve LAN clients, whatever the bind address (an operator may
 *    bind loopback and put a TLS terminator in front of it).
 *  - `false` — refuse LAN clients, whatever the bind address (a
 *    deliberately wide listener that must stay private to this machine).
 *  - absent — follow the bind address, as described above.
 *
 * Explicit configuration always wins. The derived value is a default, not a
 * policy, and an operator who says `false` must not be overruled by a bind
 * address they set for a different reason.
 *
 * A pure function so the decision can be executed by a test rather than
 * inferred from a running server: the interesting cases (absent config, a
 * missing webServer service, an unusual bind host) are exactly the ones a live
 * deployment makes hard to arrange.
 *
 * @module @shiqyka/dsh-ssh-workspace/access-policy
 */

/**
 * Resolve the effective LAN-access switch.
 *
 * @param {object} [input] - the decision inputs.
 * @param {boolean} [input.configAllowLan] - the operator's explicit switch.
 * @param {string} [input.bindHost] - the webserver's configured bind host.
 * @returns {boolean} whether private-network clients may call the routes.
 */
export function resolveAllowLan (input = {}) {
  const configured = input?.configAllowLan
  if (configured === true) return true
  if (configured === false) return false
  const bindHost = typeof input?.bindHost === 'string' ? input.bindHost.trim() : ''
  // `0.0.0.0` is the one bind value that means "every IPv4 interface". The
  // IPv6 wildcard (`::`) and a concrete interface address are NOT treated the
  // same way: `::` is also what a dual-stack loopback listener reports in some
  // setups, and a concrete address is a deliberate single-interface choice the
  // operator can pair with an explicit `allowLan: true`.
  return bindHost === '0.0.0.0'
}
