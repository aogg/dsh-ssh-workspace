/**
 * Persistent remote shells: one long-lived PTY per (host, session) that keeps
 * its state — working directory, exported variables, background jobs — across
 * tool calls.
 *
 * Why not route the harness's own persistent bash/pwsh tools to the host? Those
 * tools take their argv from `dsh-terminal-bash`, which builds the command line
 * for THIS machine's dialect: on Windows it starts PowerShell and speaks
 * PowerShell to it. A remote POSIX host needs `sh`, and handing it a PowerShell
 * argv produces a session that fails in confusing ways rather than saying "wrong
 * dialect". A separate tool makes the remote dialect explicit: one POSIX shell,
 * documented as such.
 *
 * The channel is a real SSH PTY (`client.exec(command, {pty})`), so the remote
 * side echoes and line-buffers like a terminal. A marker is appended to every
 * command so the session can tell where the output of one call ends; the marker
 * carries the exit status, which is the only reliable way to recover it from a
 * PTY stream.
 *
 * @module @shiqyka/dsh-ssh-workspace/shell
 */

/** Fresh marker per command, so a program that prints one cannot fake an end. */
let markerSequence = 0

/** How long a send waits for its marker before giving up. */
const DEFAULT_TIMEOUT_MS = 60_000

/** Output retained per session before the oldest is dropped. */
const MAX_BUFFER_BYTES = 1024 * 1024

/**
 * One persistent remote shell.
 *
 * Created by {@link ShellManager#open}. Not exported for direct construction:
 * the manager owns the connection hold, and a session that outlived its hold
 * would let the idle sweeper close the connection underneath it.
 */
class RemoteShell {
  /**
   * @param {object} options - session options.
   * @param {string} options.alias - host alias.
   * @param {object} options.channel - the open ssh2 channel.
   * @param {Function} options.release - releases the connection hold.
   * @param {string} options.key - the session key.
   * @param {object} [options.logger] - a Cordis logger.
   */
  constructor (options) {
    this.alias = options.alias
    this.key = options.key
    this.channel = options.channel
    // The engine's own close handler also releases the hold, so this wrapper
    // must release at most once: a shell that closes and is then disposed would
    // otherwise decrement the counter twice.
    const releaseOnce = options.release
    let released = false
    this.release = () => {
      if (released) return
      released = true
      releaseOnce()
    }
    this.logger = options.logger
    this.closed = false
    /** @type {string} */
    this.buffer = ''
    /** @type {{marker: string, resolve: Function, reject: Function, timer: any} | undefined} */
    this.pending = undefined
    this.channel.on('data', (chunk) => { this.#onData(chunk) })
    this.channel.stderr?.on?.('data', (chunk) => { this.#onData(chunk) })
    this.channel.once('close', () => { this.#onClose() })
  }

  /** Whether the session can still run commands. */
  get alive () {
    return !this.closed
  }

  /**
   * Append decoded output and, when the completion marker arrives, settle.
   *
   * The marker is printed as `<marker><code><marker>`, so the completion is
   * recognized by the DIGITS between two markers — a terminal also echoes the
   * `printf` line that carries the marker, but that echo shows `%s` where the
   * digits belong, so it cannot be mistaken for a completion.
   *
   * @param {Buffer|string} chunk - raw terminal bytes.
   */
  #onData (chunk) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    this.buffer += text
    if (this.buffer.length > MAX_BUFFER_BYTES) {
      this.buffer = this.buffer.slice(this.buffer.length - MAX_BUFFER_BYTES)
    }
    const pending = this.pending
    if (pending === undefined) return
    const marker = escapeRegExp(pending.marker)
    const match = new RegExp(`${marker}(-?\\d+)${marker}`, 'u').exec(this.buffer)
    if (match === null) return
    // Everything before the completion image is this command's output.
    const raw = this.buffer.slice(0, match.index)
    this.buffer = ''
    this.pending = undefined
    clearTimeout(pending.timer)
    pending.resolve({ raw, exitCode: Number.parseInt(match[1], 10) })
  }

  /** Fail the pending send when the transport dies. */
  #onClose () {
    this.closed = true
    const pending = this.pending
    this.pending = undefined
    if (pending !== undefined) {
      clearTimeout(pending.timer)
      pending.reject(new Error('the remote shell closed (connection dropped or session ended)'))
    }
    this.release()
    this.logger?.debug?.(`ssh-workspace: remote shell ${this.key} closed`)
  }

  /**
   * Run one command and collect its output up to the exit marker.
   *
   * @param {string} command - the command line (POSIX shell syntax).
   * @param {object} [options] - send options.
   * @param {number} [options.timeoutMs] - how long to wait for the marker.
   * @param {AbortSignal} [options.signal] - cancels the wait (the command keeps running).
   * @returns {Promise<{output: string, exitCode: number|null}>} collected output and status.
   */
  async run (command, options = {}) {
    if (this.closed) throw new Error('the remote shell is closed; open a new session')
    if (this.pending !== undefined) throw new Error('the remote shell is still running another command; wait for it or open a second session')
    markerSequence += 1
    const marker = `__DSH_WS_${process.pid}_${Date.now().toString(36)}_${markerSequence}__`
    // `$?` is captured immediately after the command, before anything else can
    // overwrite it, and printed inside the marker so one line carries both.
    const script = `${command}\nprintf '\\n${marker}%s${marker}\\n' "$?"\n`
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS
    const settled = new Promise((resolve, reject) => {
      // Deliberately NOT unref'd: this timer is the only thing that fails a send
      // whose marker never arrives. An unref'd timer would be free to never run
      // while the process is otherwise idle, leaving the caller hanging — which
      // is exactly the failure it exists to prevent.
      const timer = setTimeout(() => {
        if (this.pending?.marker !== marker) return
        this.pending = undefined
        reject(new Error(`the remote shell did not answer within ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending = { marker, resolve, reject, timer }
    })
    const onAbort = () => {
      const pending = this.pending
      if (pending?.marker !== marker) return
      this.pending = undefined
      clearTimeout(pending.timer)
      pending.reject(new Error('the remote shell command was cancelled'))
    }
    if (options.signal !== undefined && options.signal !== null && typeof options.signal.addEventListener === 'function') {
      if (options.signal.aborted === true) onAbort()
      else options.signal.addEventListener('abort', onAbort, { once: true })
    }
    try {
      this.channel.write(script)
    } catch (error) {
      this.pending = undefined
      throw error
    }
    try {
      const completion = await settled
      return { output: stripEcho(completion.raw), exitCode: completion.exitCode }
    } finally {
      options.signal?.removeEventListener?.('abort', onAbort)
    }
  }

  /** Close the session and release its connection hold. */
  close () {
    if (this.closed) return
    this.closed = true
    const pending = this.pending
    this.pending = undefined
    if (pending !== undefined) {
      clearTimeout(pending.timer)
      pending.reject(new Error('the remote shell was closed'))
    }
    try { this.channel.close() } catch { /* channel already gone */ }
    this.release()
  }
}

/**
 * Drop the terminal's echo of the command line.
 *
 * A PTY echoes what was written, so the collected text begins with the command
 * (and the newline the terminal adds for it). The caller already knows the
 * command, so leaving it in would let the model read its own input back as
 * output — and, worse, would put the marker's own `printf` line in the output.
 *
 * @param {string} text - raw collected output.
 * @returns {string} output without the leading echo.
 */
function stripEcho (text) {
  // A terminal turns every newline into CRLF; normalize before splitting so the
  // echo is exactly one line.
  const normalized = text.replace(/\r\n/gu, '\n')
  const newline = normalized.indexOf('\n')
  if (newline < 0) return normalized.trim()
  return normalized.slice(newline + 1).trim()
}

/** Escape a literal for use inside a RegExp. */
function escapeRegExp (value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * Owns every open remote shell, keyed by host and session.
 *
 * One session per key: a second call with the same key reuses the live shell,
 * which is what makes `cd` and exported variables survive between calls. All
 * sessions close with the plugin, and a host's sessions close when that host's
 * connection is dropped — the channel cannot outlive its connection.
 */
export class ShellManager {
  /**
   * @param {object} options - manager options.
   * @param {import('./engine.js').SshWorkspaceEngine} options.engine - live engine.
   * @param {object} [options.logger] - a Cordis logger.
   */
  constructor (options) {
    this.engine = options.engine
    this.logger = options.logger
    /** @type {Map<string, RemoteShell>} session key → live shell. */
    this.shells = new Map()
  }

  /**
   * Open (or reuse) a persistent shell for one host.
   *
   * @param {string} alias - host alias.
   * @param {object} [options] - open options.
   * @param {string} [options.session] - session name; distinct names get distinct shells.
   * @param {string} [options.cwd] - initial remote working directory.
   * @param {AbortSignal} [options.signal] - cancels the open.
   * @returns {Promise<RemoteShell>} the live shell.
   */
  async open (alias, options = {}) {
    const name = typeof options.session === 'string' && options.session.trim() !== '' ? options.session.trim() : 'default'
    const key = `${alias}\u0000${name}`
    const existing = this.shells.get(key)
    if (existing !== undefined && existing.alive) return existing
    if (existing !== undefined) this.shells.delete(key)
    const cwd = typeof options.cwd === 'string' && options.cwd !== '' ? options.cwd : undefined
    const command = cwd === undefined
      ? 'sh -l'
      : `cd ${quote(cwd)} && exec sh -l`
    const opened = await this.engine.openChannel(alias, command, {
      signal: options.signal,
      // A real terminal: the remote shell echoes and keeps `$?` usable. 80x24
      // is the conventional default; nothing in this flow resizes.
      pty: { cols: 80, rows: 24, term: 'xterm-256color' },
    })
    const shell = new RemoteShell({
      alias,
      key,
      channel: opened.channel,
      release: opened.release,
      logger: this.logger,
    })
    this.shells.set(key, shell)
    this.logger?.info?.(`ssh-workspace: opened remote shell ${name} on ${alias}`)
    return shell
  }

  /**
   * Run one command in a host's persistent shell, opening it when needed.
   *
   * @param {string} alias - host alias.
   * @param {string} command - POSIX shell command.
   * @param {object} [options] - run options.
   * @returns {Promise<{output: string, exitCode: number|null, reused: boolean}>} the result.
   */
  async run (alias, command, options = {}) {
    const key = `${alias}\u0000${typeof options.session === 'string' && options.session.trim() !== '' ? options.session.trim() : 'default'}`
    const reused = this.shells.has(key) && this.shells.get(key).alive
    const shell = await this.open(alias, options)
    const result = await shell.run(command, { timeoutMs: options.timeoutMs, signal: options.signal })
    return { ...result, reused }
  }

  /**
   * Close one session, or every session for one host.
   *
   * @param {string} alias - host alias.
   * @param {string} [session] - session name; omitted closes them all for the host.
   * @returns {number} how many sessions were closed.
   */
  close (alias, session) {
    let closed = 0
    for (const [key, shell] of [...this.shells]) {
      const [shellAlias, shellName] = key.split('\u0000')
      if (shellAlias !== alias) continue
      if (session !== undefined && shellName !== session) continue
      shell.close()
      this.shells.delete(key)
      closed += 1
    }
    return closed
  }

  /** Describe every live session. */
  list () {
    return [...this.shells.entries()].map(([key, shell]) => {
      const [alias, session] = key.split('\u0000')
      return { alias, session, alive: shell.alive }
    })
  }

  /** Close every session; called when the plugin unloads. */
  dispose () {
    for (const shell of [...this.shells.values()]) shell.close()
    this.shells.clear()
  }
}

/** Single-quote a value for a POSIX shell. */
function quote (value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}
