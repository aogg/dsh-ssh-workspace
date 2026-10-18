/**
 * Behavioural checks for detaching a remote workspace.
 *
 * Two properties are load-bearing and neither is visible from a happy-path
 * call:
 *
 * 1. A detached workspace is refused for EVERY operation — reading a file,
 *    listing a directory, writing, observing, running a command, opening a
 *    terminal, spawning a subprocess, transferring bytes — not just for
 *    writes. Leaving reads open would mean the panel says "off" while the
 *    file panel still serves content.
 *
 * 2. Detaching is durable and reversible: the registration survives so the
 *    sidebar row stays visible, the disabled list survives a restart, and the
 *    sessions are archived rather than deleted.
 *
 * Run: node tests/detach-smoke.mjs
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
let failures = 0
function check (label, ok, detail) {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

console.log('\n=== detach smoke ===\n')

const coreRoot = process.env.DSH_CORE_ROOT
if (!coreRoot) {
  console.log('  SKIP  DSH_CORE_ROOT is not set (needs @deepseek-ai/dsh-fs)')
  console.log(`\n=== ${passed} passed, ${failures} failed, 1 suite skipped ===`)
  process.exit(failures === 0 ? 0 : 1)
}
process.env.DSH_PEER_ROOT = [coreRoot, process.env.DSH_PEER_ROOT].filter(Boolean).join(path.delimiter)

const { HostConfigStore, workspacesOf } = await import(pathToFileURL(path.join(pluginRoot, 'lib/store.js')).href)
const { RemoteFileSystem } = await import(pathToFileURL(path.join(pluginRoot, 'lib/remote-fs.js')).href)
const { SshWorkspaceEngine } = await import(pathToFileURL(path.join(pluginRoot, 'lib/engine.js')).href)
const { installRemoteShell } = await import(pathToFileURL(path.join(pluginRoot, 'lib/patch-shell.js')).href)
const { RemoteTerminalRouter } = await import(pathToFileURL(path.join(pluginRoot, 'lib/patch-terminal.js')).href)
const { formatRemotePath, isInsideAnyRemoteWorkspace } = await import(pathToFileURL(path.join(pluginRoot, 'lib/protocol.js')).href)

// ---------------------------------------------------------------------------
// The store section
// ---------------------------------------------------------------------------
{
  const home = mkdtempSync(path.join(tmpdir(), 'dsh-ws-detach-'))
  try {
    const store = new HostConfigStore(path.join(home, 'dsh-ssh.json'))

    check('a fresh store has nothing detached', store.workspaces().disabled.length === 0)

    const written = store.disableWorkspace('ssh://alpha/home/dev/proj')
    check('disabling records the path', written.includes('ssh://alpha/home/dev/proj'), JSON.stringify(written))
    check('isWorkspaceDisabled answers true afterwards', store.isWorkspaceDisabled('ssh://alpha/home/dev/proj'))

    store.disableWorkspace('ssh://alpha/home/dev/proj')
    check('disabling twice does not duplicate the entry',
      store.workspaces().disabled.filter(entry => entry === 'ssh://alpha/home/dev/proj').length === 1,
      JSON.stringify(store.workspaces().disabled))

    // Two workspaces on one host must be independent.
    store.disableWorkspace('ssh://alpha/home/dev/other')
    store.enableWorkspace('ssh://alpha/home/dev/proj')
    check('enabling removes only its own entry', store.isWorkspaceDisabled('ssh://alpha/home/dev/other'))
    check('enabling cleared the entry it named', !store.isWorkspaceDisabled('ssh://alpha/home/dev/proj'))

    check('the file on disk holds the list', readFileSync(path.join(home, 'dsh-ssh.json'), 'utf8').includes('disabled'))

    // A local path is not a remote workspace and must be rejected outright.
    let rejected = false
    try {
      store.disableWorkspace('C:/Users/dev/proj')
    } catch {
      rejected = true
    }
    check('a local path is refused by the section writer', rejected)
    check('the refusal stored nothing', store.workspaces().disabled.every(entry => entry.startsWith('ssh://')))

    // A damaged section degrades to "nothing detached" rather than throwing:
    // losing the list only costs a re-mount, while throwing loses the hosts.
    check('a non-object section degrades to empty', workspacesOf({ workspaces: 'nope' }).disabled.length === 0)
    check('a missing section degrades to empty', workspacesOf({}).disabled.length === 0)
    check('non-string entries are dropped',
      workspacesOf({ workspaces: { disabled: [42, null, 'ssh://a/b', 'ssh://a/b'] } }).disabled.length === 1)
    check('duplicate entries collapse',
      workspacesOf({ workspaces: { disabled: ['ssh://a/b', 'ssh://a/b'] } }).disabled.join(',') === 'ssh://a/b')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// The containment predicate the fence is built on
// ---------------------------------------------------------------------------
{
  const disabled = ['ssh://alpha/home/dev/proj']
  check('the workspace itself is inside', isInsideAnyRemoteWorkspace(disabled, 'alpha', '/home/dev/proj'))
  check('a child is inside', isInsideAnyRemoteWorkspace(disabled, 'alpha', '/home/dev/proj/src/a.js'))
  check('a sibling sharing a prefix is NOT inside', !isInsideAnyRemoteWorkspace(disabled, 'alpha', '/home/dev/project'))
  check('another host is NOT inside', !isInsideAnyRemoteWorkspace(disabled, 'beta', '/home/dev/proj'))
  check('the parent directory is NOT inside', !isInsideAnyRemoteWorkspace(disabled, 'alpha', '/home/dev'))
  check('an empty list matches nothing', !isInsideAnyRemoteWorkspace([], 'alpha', '/home/dev/proj'))
  check('a malformed entry does not deny everything',
    !isInsideAnyRemoteWorkspace(['ssh://', 'nonsense'], 'alpha', '/home/dev/proj'))
}

// ---------------------------------------------------------------------------
// The filesystem fence: every operation, not just writes
// ---------------------------------------------------------------------------
{
  const engine = new SshWorkspaceEngine({})
  // The connection layer is never reached in this block: every call below is
  // refused before any SFTP work, which is part of what the test proves.
  engine.withSftp = async () => { throw new Error('the fence let an operation reach SFTP') }
  const router = new RemoteFileSystem({ engine })
  const workspace = formatRemotePath('alpha', '/home/dev/proj')
  router.addRoot('alpha', '/home/dev/proj')

  const target = { targetKey: workspace, displayPath: workspace }
  const childTarget = { targetKey: `${workspace}/src/a.js`, displayPath: `${workspace}/src/a.js` }

  // Before detaching, the write fence is what answers (no root covers an
  // outside path); after detaching, the detached fence answers first.
  router.disableRoot(workspace)
  check('the disabled list reports the path', router.listDisabled().includes(workspace), JSON.stringify(router.listDisabled()))
  check('the served roots no longer hold it', !router.listRoots().includes(workspace))

  const ops = [
    ['stat', () => router.stat(target)],
    ['lstat', () => router.lstat(workspace, {})],
    ['readText', () => router.readText(target)],
    ['readBytes', () => router.readBytes(target)],
    ['readByteRange', () => router.readByteRange(target, { offset: 0, length: 1 })],
    ['listDir', () => router.listDir(target)],
    ['watch', () => router.watch(target, () => {})],
    ['streamText', () => router.streamText(target)],
    ['writeText', () => router.writeText(target, 'x')],
    ['editText', () => router.editText(target, { oldString: 'a', newString: 'b' })],
  ]
  for (const [name, run] of ops) {
    let refused = false
    let message = ''
    try {
      await run()
    } catch (error) {
      refused = true
      message = error instanceof Error ? error.message : String(error)
    }
    check(`${name} is refused inside a detached workspace`, refused, 'the call succeeded')
    if (refused) check(`${name} names the workspace as detached`, /detached/u.test(message), message)
  }

  check('the refusal reaches a child path too', router.isDetached('alpha', '/home/dev/proj/src/deep/file.js'))
  check('a path outside the workspace is not refused', !router.isDetached('alpha', '/tmp/scratch.txt'))
  check('another host is not refused', !router.isDetached('beta', '/home/dev/proj'))

  // Re-enabling must clear the mark, including via addRoot.
  router.enableRoot(workspace)
  check('enabling lifts the mark', !router.isDetached('alpha', '/home/dev/proj'))
  router.disableRoot(workspace)
  router.addRoot('alpha', '/home/dev/proj')
  check('mounting again also lifts the mark', !router.isDetached('alpha', '/home/dev/proj'))
  check('and the path is served again', router.listRoots().includes(workspace))
}

// ---------------------------------------------------------------------------
// The command seams: shell, terminal, subprocess
// ---------------------------------------------------------------------------
{
  const engine = new SshWorkspaceEngine({})
  let opened = 0
  engine.openChannel = async () => { opened += 1; throw new Error('reached the connection layer') }
  engine.acquire = async () => { opened += 1; throw new Error('reached the connection layer') }
  engine.disabledWorkspaces = new Set([formatRemotePath('alpha', '/home/dev/proj')])

  // Installed through the documented seam, which is how DSH itself reaches it.
  const shellTarget = { execute: async () => { opened += 1; return {} } }
  const shellRouter = installRemoteShell({ get: (name) => (name === 'shell' ? shellTarget : undefined) }, { engine })
  check('installing the shell seam returns a router', shellRouter !== undefined)
  let shellRefused = false
  try {
    await shellTarget.execute({ workdir: 'ssh://alpha/home/dev/proj', command: 'echo hi', timeoutMs: 0, onExpiry: 'none' })
  } catch (error) {
    shellRefused = /detached/u.test(error instanceof Error ? error.message : String(error))
  }
  check('a shell command in a detached workspace is refused', shellRefused)

  const terminal = new RemoteTerminalRouter({ engine })
  let terminalRefused = false
  try {
    await terminal.spawnTerminal({ cwd: 'ssh://alpha/home/dev/proj' })
  } catch (error) {
    terminalRefused = /detached/u.test(error instanceof Error ? error.message : String(error))
  }
  check('a terminal in a detached workspace is refused', terminalRefused)
  check('no connection was opened by any refusal', opened === 0, `opened=${opened}`)

  // The SSH connection itself stays available: a cwd outside every detached
  // workspace is ordinary host operation and must not be blocked.
  check('a cwd outside the detached workspace is allowed', !engine.isDisabledTarget('alpha', '/tmp'))
  check('the same alias outside the workspace is allowed', !engine.isDisabledTarget('alpha', '/home/dev/other'))
  check('another host is allowed', !engine.isDisabledTarget('beta', '/home/dev/proj'))
}

// ---------------------------------------------------------------------------
// Cross-section survival: the disabled list must not evict other sections
// ---------------------------------------------------------------------------
{
  const home = mkdtempSync(path.join(tmpdir(), 'dsh-ws-detach-'))
  try {
    const store = new HostConfigStore(path.join(home, 'dsh-ssh.json'))
    store.putForward({
      id: 'fwd-keep', alias: 'alpha', remotePort: 5173, localPort: 5173, enabled: true,
    })
    store.disableWorkspace('ssh://alpha/home/dev/proj')
    check('writing the disabled list kept the saved forwards',
      store.forwards().items.some(item => item.id === 'fwd-keep'),
      JSON.stringify(store.forwards().items))
    store.setForwardAutoStart(true)
    check('writing a forward setting kept the disabled list',
      store.isWorkspaceDisabled('ssh://alpha/home/dev/proj'))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Re-enabling must not be blocked by the fence it is lifting
// ---------------------------------------------------------------------------
//
// Both `ssh_workspace_mount` and `ssh_workspace_enable` verify the remote
// directory exists before writing anything durable. Probing through `engine.fs`
// looks natural and is WRONG: that router is the fence, and it refuses every
// read inside a detached workspace — so enabling a detached workspace, or
// mounting it again, would have been impossible by construction. Both now go
// through the raw connection, which this block pins.
{
  const { workspaceTools } = await import(pathToFileURL(path.join(pluginRoot, 'lib/tools.js')).href)
  const engine = new SshWorkspaceEngine({})
  let rawProbes = 0
  let routerProbes = 0
  engine.withSftp = async (_alias, fn) => {
    rawProbes += 1
    return await fn({ stat: (_path, cb) => cb(undefined, { isDirectory: () => true }) })
  }
  const router = new RemoteFileSystem({ engine })
  // A router that fails the probe loudly if anyone routes through it: this is
  // exactly what a detached workspace does to a read.
  router.stat = async () => {
    routerProbes += 1
    throw new Error('router probe: the remote workspace is detached')
  }
  router.listDir = async () => {
    routerProbes += 1
    throw new Error('router probe: the remote workspace is detached')
  }
  const tools = workspaceTools({ get: () => undefined }, engine, router, { list: () => [] }, { list: () => [] })

  const mount = await tools.find(tool => tool.name === 'ssh_workspace_mount')
    .execute({ alias: 'alpha', remotePath: '/home/dev/proj', register: false }, {})
  check('mounting does not probe through the fenced router', routerProbes === 0, `router probes=${routerProbes}`)
  check('mounting succeeded without the fenced router', mount.ok === true, JSON.stringify(mount))
  check('mounting verified the directory over the raw connection', rawProbes >= 1, `raw probes=${rawProbes}`)

  const beforeEnable = routerProbes
  const enable = await tools.find(tool => tool.name === 'ssh_workspace_enable')
    .execute({ workspacePath: 'ssh://alpha/home/dev/proj' }, {})
  check('enabling does not probe through the fenced router', routerProbes === beforeEnable, `router probes=${routerProbes}`)
  check('enabling a detached workspace succeeds', enable.ok === true, JSON.stringify(enable))
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
