/**
 * Persistent-shell checks against an in-memory channel double.
 *
 * The properties that matter here are the ones a real PTY makes hard to
 * observe deterministically:
 *
 * - a command's output is separated from the marker line, so the model never
 *   reads the exit-marker syntax as output;
 * - the exit status is recovered from the marker, including a non-zero one;
 * - a second call reuses the live session (that is what makes `cd` survive);
 * - a session that dies fails the pending call instead of hanging;
 * - closing releases the connection hold exactly once.
 *
 * Run: node tests/shell-smoke.mjs
 */

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { ShellManager } = await import(pathToFileURL(path.join(pluginRoot, 'lib/shell.js')).href)

let passed = 0
let failures = 0
function check (label, ok, detail) {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`) } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/**
 * A channel double that behaves like a PTY running a tiny shell.
 *
 * `write` parses the marker the production code appended, "runs" the command
 * (a lookup table of canned results), then emits the echo, the output and the
 * marker line — the order a real terminal produces.
 */
function fakeChannel (options = {}) {
  const handlers = new Map()
  const emitted = []
  const state = { writes: 0 }
  const results = options.results ?? {}
  const channel = {
    stderr: { on () {} },
    on (event, handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]) },
    once (event, handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]) },
    emit (event, value) { for (const handler of handlers.get(event) ?? []) handler(value) },
    write (script) {
      state.writes += 1
      const marker = /__DSH_WS_[\w]+__/u.exec(script)?.[0]
      if (marker === undefined) return
      const command = script.split('\n')[0]
      if (options.onWrite !== undefined) options.onWrite(command, () => {})
      const outcome = results[command] ?? { output: '', code: 0 }
      // Echo first (the PTY echoes what was typed), then output, then marker.
      emitted.push(`${command}\r\n`)
      setTimeout(() => {
        channel.emit('data', Buffer.from(`${command}\r\n`))
        if (outcome.output !== '') channel.emit('data', Buffer.from(`${outcome.output}\r\n`))
        channel.emit('data', Buffer.from(`\r\n${marker}${outcome.code}${marker}\r\n`))
      }, 0)
    },
    close () { channel.emit('close') },
  }
  return { channel, state, emitted }
}

/** An engine double handing out one prepared channel per `open`. */
function fakeEngine (channels) {
  const opened = []
  return {
    opened,
    /** No workspace is detached in this suite. */
    assertNotDisabled () {},
    async openChannel (_alias, command, options) {
      const prepared = channels[opened.length] ?? channels.at(-1)
      opened.push({ command, options })
      return { channel: prepared.channel, release: prepared.release ?? (() => {}) }
    },  }
}

console.log('\n=== shell smoke ===\n')

// --- one command round trip ------------------------------------------------
{
  const prepared = fakeChannel({ results: { 'echo hi': { output: 'hi', code: 0 } } })
  const engine = fakeEngine([prepared])
  const shells = new ShellManager({ engine })
  const result = await shells.run('test', 'echo hi')
  check('a command returns its output without the echoed command line',
    result.output === 'hi', JSON.stringify(result.output))
  check('a command returns its exit status', result.exitCode === 0, String(result.exitCode))
  check('the first call opens a new session', result.reused === false)
  check('the shell is started as POSIX sh',
    engine.opened[0].command.startsWith('sh') || engine.opened[0].command.includes('sh -l'),
    engine.opened[0].command)
  check('the channel is opened with a PTY', engine.opened[0].options.pty !== undefined)
}

// --- a non-zero status is reported, not swallowed ---------------------------
{
  const prepared = fakeChannel({ results: { 'exit 3': { output: '', code: 3 } } })
  const shells = new ShellManager({ engine: fakeEngine([prepared]) })
  const result = await shells.run('test', 'exit 3')
  check('a non-zero exit status survives the marker', result.exitCode === 3, String(result.exitCode))
}

// --- the second call reuses the live session -------------------------------
{
  const prepared = fakeChannel({ results: { 'cd /srv': { output: '', code: 0 }, pwd: { output: '/srv', code: 0 } } })
  const engine = fakeEngine([prepared])
  const shells = new ShellManager({ engine })
  await shells.run('test', 'cd /srv')
  const second = await shells.run('test', 'pwd')
  check('a second call reuses the session', second.reused === true)
  check('only one channel was opened for two calls', engine.opened.length === 1, String(engine.opened.length))
  check('state from the first call is visible in the second', second.output === '/srv', JSON.stringify(second.output))
}

// --- independent sessions do not share state -------------------------------
{
  const first = fakeChannel({ results: { pwd: { output: '/one', code: 0 } } })
  const second = fakeChannel({ results: { pwd: { output: '/two', code: 0 } } })
  const engine = fakeEngine([first, second])
  const shells = new ShellManager({ engine })
  const a = await shells.run('test', 'pwd', { session: 'a' })
  const b = await shells.run('test', 'pwd', { session: 'b' })
  check('two named sessions get separate channels', engine.opened.length === 2, String(engine.opened.length))
  check('two named sessions keep separate state', a.output === '/one' && b.output === '/two',
    JSON.stringify([a.output, b.output]))
  check('list reports both sessions', shells.list().length === 2, JSON.stringify(shells.list()))
}

// --- a session that dies fails the pending call ----------------------------
{
  const prepared = fakeChannel({ results: { 'sleep 100': { output: '', code: 0 } } })
  // Never answer: the close is the only thing that settles the call.
  prepared.channel.write = () => {}
  const engine = fakeEngine([prepared])
  const shells = new ShellManager({ engine })
  const pending = shells.run('test', 'sleep 100', { timeoutMs: 5000 })
  await new Promise((resolve) => setTimeout(resolve, 10))
  prepared.channel.close()
  let message
  try { await pending } catch (error) { message = error.message }
  check('a dropped session fails the pending command instead of hanging',
    typeof message === 'string' && message.includes('closed'), message)
}

// --- closing releases the hold exactly once --------------------------------
{
  const prepared = fakeChannel({ results: { 'true': { output: '', code: 0 } } })
  let releases = 0
  prepared.release = () => { releases += 1 }
  const shells = new ShellManager({ engine: fakeEngine([prepared]) })
  await shells.run('test', 'true')
  const closed = shells.close('test', 'default')
  check('close reports the session it closed', closed === 1, String(closed))
  check('close releases the connection hold', releases === 1, String(releases))
  check('a closed session is gone from list', shells.list().length === 0)
  shells.dispose()
  check('dispose does not double-release', releases === 1, String(releases))
}

// --- a timeout is an error, not an empty success ---------------------------
{
  const prepared = fakeChannel({ results: { 'forever': { output: '', code: 0 } } })
  prepared.channel.write = () => {}
  const shells = new ShellManager({ engine: fakeEngine([prepared]) })
  let message
  try { await shells.run('test', 'forever', { timeoutMs: 30 }) } catch (error) { message = error.message }
  check('a command that never answers times out', typeof message === 'string' && message.includes('did not answer'), message)
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
