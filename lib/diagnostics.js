/**
 * A small, bounded record of what the SSH half has been doing.
 *
 * ## Why this exists at all
 *
 * The obvious way to make a plugin observable is `ctx.logger.debug(...)`. That
 * is a dead end in this deployment, and it took a measurement to notice:
 *
 *  - the Host installs no console exporter, so `ctx.logger` calls reach a
 *    ring buffer (`LoggerService.buffer`) that nothing in the tree ever reads
 *    — verified by searching every shipped package for a reader;
 *  - `debug` is level 3 and every exporter default is level 1, so it is
 *    dropped before it even reaches that buffer.
 *
 * A `debug()` line therefore looks like observability in review and is
 * observationally identical to a comment. What a user can actually reach is the
 * `ssh_workspace_status` tool and the panel's status route, so the events are
 * kept where those two surfaces can serve them.
 *
 * ## Shape
 *
 * Bounded on purpose: a long-lived session that reconnects for days must not
 * grow without limit. Old entries fall off the front. Every entry is a plain
 * object of primitives so it can travel through the tool's output schema and a
 * JSON HTTP response without a custom serializer.
 *
 * @module @shiqyka/dsh-ssh-workspace/diagnostics
 */

/** Entries kept. Enough to explain "what just happened", small enough to print. */
export const CAPACITY = 40

/** Event kinds, kept as a closed set so a typo shows up in one place. */
export const KINDS = Object.freeze({
  connect: 'connect',
  disconnect: 'disconnect',
  reconnect: 'reconnect',
  degraded: 'degraded',
  forward: 'forward',
  /**
   * The fate of an upstream workaround (see patch-projection.js). Exists as its
   * own kind because it is the ONE signal whose whole purpose is to be noticed:
   * "upstream fixed it, delete the patch" is a message that must not be lost,
   * and `ctx.logger` cannot deliver it in this deployment.
   */
  upstream: 'upstream',
})

/**
 * A fixed-capacity event log.
 *
 * Deliberately not an EventEmitter: nothing subscribes, the log is read on
 * demand by the status surfaces, and an emitter would imply listeners that do
 * not exist.
 */
export class Diagnostics {
  /** @param {number} [capacity] - entries to keep (tests use a small one). */
  constructor (capacity = CAPACITY) {
    /** @type {Array<{at: number, kind: string, message: string, alias?: string}>} */
    this.entries = []
    this.capacity = Number.isInteger(capacity) && capacity > 0 ? capacity : CAPACITY
  }

  /**
   * Append one event.
   *
   * Never throws: a diagnostic that can fail the operation it is describing is
   * worse than no diagnostic, and every call site is inside a failure path.
   *
   * @param {string} kind - one of {@link KINDS}.
   * @param {string} message - short, human-readable, no secrets.
   * @param {object} [detail] - optional fields; `alias` is the common one.
   * @returns {void}
   */
  record (kind, message, detail = {}) {
    try {
      const entry = { at: Date.now(), kind: String(kind), message: String(message) }
      if (typeof detail.alias === 'string' && detail.alias !== '') entry.alias = detail.alias
      this.entries.push(entry)
      if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity)
    } catch { /* a diagnostic must never be the reason something fails */ }
  }

  /**
   * The retained entries, oldest first.
   *
   * @param {number} [limit] - return at most this many, keeping the newest.
   * @returns {Array<object>} copies, so a caller cannot mutate the log.
   */
  list (limit) {
    const all = this.entries.map(entry => ({ ...entry }))
    if (typeof limit === 'number' && limit > 0) return all.slice(-limit)
    return all
  }

  /** Drop everything (tests and a manual "clear" action). */
  clear () {
    this.entries.length = 0
  }
}
