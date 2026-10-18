/**
 * Remote PTY terminals: route the harness's terminal primitive to an SSH host.
 *
 * The harness keeps a persistent-shell feature (`dsh-terminal-bash`) that talks
 * to `ctx.subprocess.spawnTerminal`. That primitive is a *local* one: it hands
 * the request to node-pty on this machine. So a persistent shell whose working
 * directory is an `ssh://` workspace would either fail or, worse, start a local
 * shell against a path that only exists on the remote host.
 *
 * This module closes that seam the same way `patch-subprocess.js` closes
 * `spawn`: when the spec's `cwd` names a remote workspace, the terminal is
 * opened as an SSH PTY channel instead of a local process, and the returned
 * handle satisfies the contract the harness's terminal session relies on
 * (`output`, `write`, `resize`, `done`, `inspectForeground`, `signalForeground`,
 * `terminate`).
 *
 * ## Why the argv is not reused
 *
 * `dsh-terminal-bash` builds `argv` from ITS dialect: on Windows that is
 * PowerShell and the session then speaks PowerShell to the process. A remote
 * POSIX host needs `sh`. Rather than hand a PowerShell command line to a POSIX
 * machine (which fails in ways that look like a plugin bug), the remote half
 * starts the remote host's own interactive POSIX shell and ignores the local
 * dialect. The session's readiness protocol is identical, because the harness
 * drives it over the same channel.
 *
 * ## Foreground inspection
 *
 * The local handle answers `inspectForeground()` from the machine's process
 * table. There is no equivalent that a single SSH channel can read cheaply, and
 * a wrong answer is worse than none: `dsh-terminal-bash` treats a foreground
 * process group as "still running" and would wait out its whole timeout before
 * settling. Returning `undefined` selects the harness's documented fallback —
 * readiness is inferred from output silence — which is correct and only slightly
 * less precise.
 *
 * @module @shiqyka/dsh-ssh-workspace/patch-terminal
 */

import { PassThrough } from 'node:stream'

import { isRemotePath } from './protocol.js'

/** Marker property carrying the router installed on a service instance. */
const INSTALLED = Symbol.for('@shiqyka/dsh-ssh-workspace/terminal-installed')

/** Marker property carrying the original `spawnTerminal` an install replaced. */
const ORIGINAL = Symbol.for('@shiqyka/dsh-ssh-workspace/terminal-original')

/**
 * One remote terminal: an SSH PTY channel exposed as the handle shape that
 * `dsh-terminal-bash` drives.
 */
class RemoteTerminalHandle {
  /**
   * @param {object} options - handle options.
   * @param {object} options.channel - the open ssh2 channel (a PTY).
   * @param {Function} options.release - releases the connection hold.
   * @param {string} options.alias - host alias.
   * @param {object} [options.logger] - a Cordis logger.
   */
  constructor (options) {
    this.alias = options.alias
    this.channel = options.channel
    this.logger = options.logger
    /** Local pid stand-in: a remote PTY has no local pid. */
    this.pid = -1
    /** Terminal output stream; the harness pipes this into its emulator. */
    this.output = new PassThrough()
    this.exited = false
    this.closed = false
    this.outcome = Promise.withResolvers()
    this.done = this.outcome.promise
    // The engine's own close handler also releases the hold, so this wrapper
    // must release at most once.
    const releaseOnce = options.release
    let released = false
    this.release = () => {
      if (released) return
      released = true
      releaseOnce()
    }
    this.channel.on('data', (chunk) => { this.#onData(chunk) })
    this.channel.stderr?.on?.('data', (chunk) => { this.#onData(chunk) })
    this.channel.once('close', (code, signal) => { this.#onClose(code, signal) })
    this.channel.once('error', (error) => { this.#fail(error) })
  }

  /** Whether the remote PTY has not yet reported its exit. */
  get running () {
    return !this.exited
  }

  /**
   * Forward one chunk of terminal bytes to the output stream.
   *
   * @param {Buffer|string} chunk - raw terminal bytes.
   */
  #onData (chunk) {
    if (this.exited) return
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
    if (!this.output.write(bytes)) {
      // The harness drains on its own schedule; pausing would need flow control
      // back into ssh2, which a channel does not expose. Buffering is bounded by
      // the harness's own scrollback cap, so letting PassThrough queue is right.
    }
  }

  /**
   * Settle the terminal when the channel closes.
   *
   * @param {number|null} code - exit status, null when the channel died.
   * @param {string|null} signal - exit signal, when one was reported.
   */
  #onClose (code, signal) {
    if (this.exited) return
    this.exited = true
    this.output.end()
    this.release()
    this.outcome.resolve({
      exitCode: typeof code === 'number' ? code : null,
      signal: typeof signal === 'string' ? signal : null,
    })
  }

  /**
   * Settle the terminal on a transport failure.
   *
   * @param {unknown} error - the failure.
   */
  #fail (error) {
    if (this.exited) return
    this.exited = true
    this.output.destroy(error instanceof Error ? error : new Error(String(error)))
    this.release()
    this.outcome.reject(error instanceof Error ? error : new Error(String(error)))
  }

  /**
   * Write input into the terminal.
   *
   * @param {string} data - keystrokes or pasted text.
   * @returns {Promise<void>} resolves once the channel accepted the bytes.
   */
  async write (data) {
    if (this.exited) throw new Error('terminal process has exited')
    await new Promise((resolve, reject) => {
      this.channel.write(data, (error) => {
        if (error !== undefined && error !== null) reject(error)
        else resolve()
      })
    })
  }

  /**
   * Resize the remote PTY.
   *
   * @param {number} cols - columns.
   * @param {number} rows - rows.
   * @returns {Promise<void>} resolves once the window change was sent.
   */
  async resize (cols, rows) {
    if (this.exited) throw new Error('terminal process has exited')
    await new Promise((resolve, reject) => {
      this.channel.setWindow(rows, cols, 0, 0, (error) => {
        if (error !== undefined && error !== null) reject(error)
        else resolve()
      })
    })
  }

  /**
   * Report no foreground information.
   *
   * A remote channel cannot read the host's process table cheaply, and a wrong
   * answer would make the harness wait out its whole readiness timeout. `undefined`
   * selects its output-silence fallback, which is correct.
   *
   * @returns {Promise<undefined>} always undefined.
   */
  async inspectForeground () {
    return undefined
  }

  /**
   * Deliver a signal to the terminal's foreground process.
   *
   * A PTY has no out-of-band signalling, so the conventional byte is written
   * instead: `\x03` (ETX) is what a terminal turns into SIGINT, and `\x1c`
   * (FS) is SIGQUIT. Other signals have no PTY equivalent and are refused
   * rather than silently ignored.
   *
   * @param {string} signal - the signal name.
   * @returns {Promise<number>} the pseudo process group id.
   * @throws {Error} for a signal a terminal cannot express.
   */
  async signalForeground (signal) {
    if (this.exited) throw new Error('terminal process has exited')
    if (signal === 'SIGINT') {
      await this.write('\u0003')
      return this.pid
    }
    if (signal === 'SIGQUIT') {
      await this.write('\u001c')
      return this.pid
    }
    if (signal === 'SIGTERM' || signal === 'SIGKILL' || signal === 'SIGHUP') {
      // Closing the channel makes the remote shell receive SIGHUP, which is the
      // closest available behaviour; terminate() is the documented path.
      await this.terminate()
      return this.pid
    }
    throw new Error(`signal ${signal} is not expressible over an SSH PTY`)
  }

  /**
   * Close the terminal and release its connection hold.
   *
   * @returns {Promise<void>} resolves once the channel is closed.
   */
  async terminate () {
    if (this.closed) return
    this.closed = true
    try { this.channel.close() } catch { /* channel already gone */ }
    this.release()
  }
}

/**
 * Router that opens remote PTYs and falls back to the local primitive.
 */
export class RemoteTerminalRouter {
  /**
   * @param {object} options - router options.
   * @param {import('./engine.js').SshWorkspaceEngine} options.engine - live engine.
   * @param {object} [options.logger] - a Cordis logger.
   */
  constructor (options) {
    this.engine = options.engine
    this.logger = options.logger
  }

  /**
   * Open one terminal, remotely when the cwd is an `ssh://` workspace.
   *
   * @param {object} spec - the harness's terminal spec.
   * @returns {Promise<RemoteTerminalHandle>} the handle.
   */
  async spawnTerminal (spec) {
    const parts = parseRemoteCwd(spec?.cwd)
    if (parts === undefined) throw new Error('ssh-workspace: spawnTerminal needs an ssh:// cwd')
    this.engine.assertNotDisabled(parts.alias, parts.remotePath)
    const cols = Number.isFinite(spec?.cols) && spec.cols > 0 ? Math.floor(spec.cols) : 80
    const rows = Number.isFinite(spec?.rows) && spec.rows > 0 ? Math.floor(spec.rows) : 24
    const term = typeof spec?.terminalType === 'string' && spec.terminalType !== '' ? spec.terminalType : 'xterm-256color'
    const command = parts.remotePath === '/' ? 'exec sh -l' : `cd ${quote(parts.remotePath)} && exec sh -l`
    const opened = await this.engine.openChannel(parts.alias, command, {
      signal: spec?.signal,
      pty: { cols, rows, term },
    })
    this.logger?.info?.(`ssh-workspace: opened remote terminal on ${parts.alias} in ${parts.remotePath}`)
    return new RemoteTerminalHandle({
      alias: parts.alias,
      channel: opened.channel,
      release: opened.release,
      logger: this.logger,
    })
  }
}

/**
 * Split an `ssh://alias/path` working directory.
 *
 * @param {unknown} value - the spec's cwd.
 * @returns {{alias: string, remotePath: string} | undefined} the parts, or undefined when local.
 */
function parseRemoteCwd (value) {
  if (!isRemotePath(value)) return undefined
  const match = /^ssh:\/\/([^/]+)(\/.*)?$/u.exec(value)
  if (match === null) return undefined
  return { alias: match[1], remotePath: match[2] !== undefined && match[2] !== '' ? match[2] : '/' }
}

/** Single-quote a value for a POSIX shell. */
function quote (value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

/**
 * Install the remote terminal half onto the live `ctx.subprocess` service.
 *
 * `spawn` may already be wrapped by {@link installRemoteSubprocess}; the two
 * installations are independent and only this symbol is consulted here.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @param {object} options - install options.
 * @param {import('./engine.js').SshWorkspaceEngine} options.engine - live engine.
 * @param {object} [options.logger] - a Cordis logger, when available.
 * @returns {RemoteTerminalRouter | undefined} the router, or undefined when no `subprocess` service is mounted.
 * @throws {Error} when the mounted service has no `spawnTerminal()` to wrap.
 */
export function installRemoteTerminal (ctx, options) {
  const target = ctx.get('subprocess')
  if (target === undefined || target === null) return undefined
  if (target[INSTALLED] !== undefined) return target[INSTALLED]

  const originalSpawnTerminal = target.spawnTerminal
  if (typeof originalSpawnTerminal !== 'function') {
    throw new Error('ssh-workspace: the mounted ctx.subprocess service has no spawnTerminal() to wrap')
  }
  const local = originalSpawnTerminal.bind(target)
  const router = new RemoteTerminalRouter(options)
  const spawnTerminal = function (spec) {
    if (spec !== null && typeof spec === 'object' && isRemotePath(spec.cwd)) {
      return router.spawnTerminal(spec)
    }
    return local(spec)
  }
  Object.defineProperty(target, 'spawnTerminal', { value: spawnTerminal, writable: true, configurable: true, enumerable: false })
  Object.defineProperty(target, INSTALLED, { value: router, writable: false, configurable: true, enumerable: false })
  // Remember the original so uninstall restores the real method: when the
  // service carried its own `spawnTerminal`, deleting the wrapper would leave
  // the instance without one at all.
  Object.defineProperty(target, ORIGINAL, { value: originalSpawnTerminal, writable: false, configurable: true, enumerable: false })
  options.logger?.info?.('ssh-workspace: took over ctx.subprocess.spawnTerminal for ssh:// cwds')
  return router
}

/**
 * Undo {@link installRemoteTerminal}, restoring the original `spawnTerminal`.
 *
 * @param {object | undefined} target - the patched service instance.
 * @returns {void}
 */
export function uninstallRemoteTerminal (target) {
  if (target === undefined || target === null) return
  if (target[INSTALLED] === undefined) return
  const original = target[ORIGINAL]
  if (original !== undefined) {
    Object.defineProperty(target, 'spawnTerminal', { value: original, writable: true, configurable: true, enumerable: false })
    delete target[ORIGINAL]
  } else if (Object.hasOwn(target, 'spawnTerminal')) {
    delete target.spawnTerminal
  }
  delete target[INSTALLED]
}
