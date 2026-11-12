/**
 * DSH remote-workspace plugin — host half.
 *
 * Publishes a `ctx.fs` that serves ordinary host paths from the deployment's
 * own (sandboxed) local backend and `ssh://<alias>/<abs-path>` targets over
 * SFTP, so a folder on a remote machine can be registered as a DSH workspace
 * and used by the ordinary file tools. The Host's own builtin calls for the
 * same targets — `node:fs/promises` operations and `node:path` spellings —
 * are bridged too (see fs-shim.js), because creating a session and attaching
 * it to its workspace happen before any agent exists. Commands against a
 * remote workspace travel through the two execution seams, both patched onto
 * the live services: `ctx.shell` for the pwsh/bash tools (patch-shell.js) and
 * `ctx.subprocess` for the file tools' helpers — remote glob/grep via
 * ripgrep, and change tracking via git (patch-subprocess.js).
 *
 * Agent tools: ssh_workspace_hosts, ssh_workspace_mount, ssh_workspace_unmount,
 * ssh_workspace_enable, ssh_workspace_status, ssh_workspace_exec,
 * ssh_workspace_bash, ssh_workspace_forward, ssh_workspace_unforward.
 *
 * @module @shiqyka/dsh-ssh-workspace
 */

import { SshWorkspaceEngine } from './engine.js'
import { RemoteFileSystem } from './remote-fs.js'
import { ForwardManager } from './forward.js'
import { SavedForwardManager } from './forward-persist.js'
import { ShellManager } from './shell.js'
import { installRemoteFileSystem, uninstallRemoteFileSystem } from './patch-fs.js'
import { installRemoteShell, uninstallRemoteShell } from './patch-shell.js'
import { installRemoteSubprocess, uninstallRemoteSubprocess } from './patch-subprocess.js'
import { installRemoteTerminal, uninstallRemoteTerminal } from './patch-terminal.js'
import { installBuiltinBridge, uninstallBuiltinBridge } from './fs-shim.js'
import { installProjectionRelaxation, uninstallProjectionRelaxation } from './patch-projection.js'
import { isRemotePath, parseRemotePath } from './protocol.js'
import { workspaceTools } from './tools.js'
import { makeRoutes } from './routes.js'
import { createAgentPromptRegistry, PROMPT_SECTION_NAME, PROMPT_SECTION_ORDER } from './agent-prompts.js'
import { installLocalExecSkill } from './local-exec-skill.js'
import { resolveAllowLan } from './access-policy.js'
import { SSH_GUIDANCE_SECTION_NAME, sshGuidanceForCwd } from './guidance.js'

/** Stable Cordis plugin name. */
export const name = 'ssh-workspace'

/**
 * Services required before the surfaces can mount.
 *
 * Note `fs` is deliberately NOT listed here: a profile applies its patch layer
 * after its bundles, so the filesystem backend may not exist yet at plugin
 * load. It is injected on the service BODY instead (see {@link apply}), which
 * runs as soon as the backend appears and re-runs across reloads.
 *
 * `systemPrompt` (agent guidance) is optional and read with `ctx.get()`, so a
 * deployment without it still activates. `webServer` is optional too: the HTTP
 * routes for the browser half wait for it in a second injection, so the plugin
 * is equally usable headless (agent tools only) and in the Web GUI.
 */
export const inject = ['tools']

/** Relative order of the announcement section inside the tool-guidance band. */
const SECTION_ORDER = 155

// The announcement text moved to guidance.js (so the injection, the
// `/injected` route and the panel's display page read ONE copy); it is
// re-exported below for API compatibility.

/**
 * Mount the SSH workspace engine, the `ctx.fs` router, and the agent tools.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @param {object} [config] - resolved plugin config.
 * @param {boolean} [config.enabled] - master switch (default true).
 * @param {boolean} [config.announceToAgent] - add the system-prompt section.
 * @param {boolean} [config.allowLan] - serve the browser half to LAN clients.
 *   Three states: `true` always, `false` never, absent = follow the
 *   webserver's bind address (`0.0.0.0` enables it, anything else keeps the
 *   loopback fence). See {@link resolveAllowLan}. When enabled, the HTTP
 *   routes accept private-network remote addresses (IPv4 RFC1918, IPv6
 *   ULA/link-local) and a `Host` header that is either this machine's own
 *   address or a private IP literal — a bare hostname still has to be listed
 *   in `allowedHosts`, which keeps the DNS-rebinding fence.
 * @param {string[]} [config.allowedHosts] - extra `Host` header values accepted
 *   beside the machine's own addresses (with `allowLan`); e.g. a LAN hostname.
 * @param {object} [config.engine] - connection tuning overrides:
 *   `idleTimeoutMs`, `connectTimeoutMs`, `keepaliveIntervalMs`,
 *   `sweepIntervalMs` (see {@link SshWorkspaceEngine}).
 * @returns {void}
 */
export function apply (ctx, config = {}) {
  if (config.enabled === false) return

  const engine = new SshWorkspaceEngine({ logger: ctx.logger, ...(config.engine ?? {}) })
  // The detached-workspace list is loaded up front, not in the registry
  // injection below: the shell, subprocess and terminal halves never wait for
  // the registry, and a workspace that stays runnable until a later activation
  // step would be "off" only in the file panel.
  let detachedWorkspaces = []
  try {
    detachedWorkspaces = engine.store.entryStore.workspaces().disabled
    engine.setDisabledWorkspaces(detachedWorkspaces)
  } catch (error) {
    ctx.logger?.warn?.(`ssh-workspace: could not read the detached-workspace list: ${error instanceof Error ? error.message : String(error)}`)
  }
  // Secrets written by older versions sit in the shared store as plaintext;
  // move them into the encrypted section once, best-effort, so a store this
  // plugin cannot understand is left alone instead of clobbered.
  try {
    const encrypted = engine.store.entryStore.encryptStoredSecrets()
    if (encrypted > 0) {
      ctx.logger?.info?.(`ssh-workspace: encrypted ${encrypted} host secret(s) that were still stored in plaintext`)
    }
  } catch (error) {
    ctx.logger?.warn?.(`ssh-workspace: could not encrypt stored host secrets: ${error instanceof Error ? error.message : String(error)}`)
  }
  // Local listeners mapped to remote ports ride the pooled connections; their
  // lifecycle follows the engine (see forward.js). The saved half sits on top:
  // the store holds which mappings the user wants, and this manager joins that
  // intent onto the listeners that actually exist.
  const forwards = new ForwardManager({ engine, logger: ctx.logger })
  const savedForwards = new SavedForwardManager({ forwards, store: engine.store.entryStore, logger: ctx.logger })
  forwards.onClosed = (entry, reason) => { savedForwards.noteClosed(entry, reason) }
  // Persistent remote shells hold their own connections and keep their state;
  // they close with the plugin.
  const shells = new ShellManager({ engine, logger: ctx.logger })

  // The three-level agent system-prompt registry (global → host → workspace).
  // It reads its configuration from the shared store and caches one merge per
  // mounted workspace under the config fingerprint; the served-root list is
  // read live from the router (an empty list before the fs seam installs is
  // fine — `serveForCwd` then finds no root and answers '').
  const prompts = createAgentPromptRegistry({
    store: engine.store.entryStore,
    roots: () => (typeof router?.listRoots === 'function' ? router.listRoots() : []),
    logger: ctx.logger,
  })

  // System prompt sections: the tool-guidance announcement only when the
  // profile asked for it, and the merged workspace prompts whenever the
  // deployment has a systemPrompt service at all.
  try {
    const systemPrompt = ctx.get('systemPrompt')
    if (systemPrompt) {
      if (config.announceToAgent === true) {
        ctx.effect(
          () => systemPrompt.section({
            name: SSH_GUIDANCE_SECTION_NAME,
            order: SECTION_ORDER,
            // Re-evaluated by the agent loop before EVERY model step: the
            // base announcement, plus the session host's Niubash section
            // ONLY when the state gate says the host has the runtime
            // (guidance.js). An uninitialized host receives the base text
            // byte-for-byte — not one extra byte.
            text: (assembly) => sshGuidanceForCwd(assembly?.agent?.session?.header?.cwd, engine),
          }),
          'ssh-workspace: guidance',
        )
      }
      // The merged workspace prompts ride in REGARDLESS of the guidance
      // switch: with no configuration the text resolves to '' and the empty
      // section is dropped at render time, so an unused feature costs
      // nothing — while a configured one does not silently depend on an
      // unrelated announcement flag.
      ctx.effect(
        () => systemPrompt.section({
          name: PROMPT_SECTION_NAME,
          order: PROMPT_SECTION_ORDER,
          // Re-evaluated by the agent loop before EVERY model step; see
          // agent-prompts.js for the cache and the refresh triggers.
          text: (assembly) => prompts.serveForCwd(assembly?.agent?.session?.header?.cwd),
        }),
        'ssh-workspace: agent prompts',
      )
    }
  } catch {
    // systemPrompt not available, skip guidance
  }

  // The auto-injected "local-exec" skill (workdir decides where a command
  // runs). Registration probes `ctx.reflect.get('skills')` defensively — a
  // host build without the skill registry only logs a warning and skips,
  // never breaks the plugin load. The verdict lands in this sink, which the
  // `/skill` route below reads so the panel can show what the model actually
  // sees (registered payload, or the explicit not-registered state).
  const localExecSkill = { registered: false, payload: null }
  ctx.effect(
    () => installLocalExecSkill(ctx, localExecSkill),
    'ssh-workspace: local-exec skill',
  )

  /**
   * The router installed onto the live `ctx.fs`, shared with the route half.
   *
   * @type {import('./remote-fs.js').RemoteFileSystem | undefined}
   */
  let router

  /**
   * Take over the live `ctx.fs` once it exists.
   *
   * @param {import('@deepseek-ai/cordis').Context} scoped - the context the
   *   injected service body runs in (owns the effects below).
   * @returns {void}
   */
  const install = (scoped) => {
    // The deployment already mounted its own local backend under this name, so
    // the remote methods are installed onto that ONE live instance rather than
    // re-provided (Cordis refuses a second provide('fs')).
    router = installRemoteFileSystem(scoped, { engine }, RemoteFileSystem)
    if (router === undefined) {
      scoped.logger?.warn?.('ssh-workspace: ctx.fs was not available; the remote workspace cannot be served')
      return
    }
    engine.attachFileSystem(router)

    // The Host's own builtin calls do not travel through `ctx.fs`, and several
    // run on a new session's cwd before its agent exists — the Session
    // controller's `mkdir`, the Workspace registry's `realpath`/`stat`, and the
    // Session service's `path.isAbsolute` header check — so both builtins are
    // bridged for `ssh://` targets too.
    installBuiltinBridge({ engine, router, logger: scoped.logger })

    scoped.effect(() => () => {
      // Drop the patch before the engine goes away so a late call cannot reach a
      // disposed connection pool; shells and forwards close first among the
      // engine's consumers so their channels are gone before the connections drop.
      uninstallBuiltinBridge()
      uninstallRemoteFileSystem(scoped.get('fs'))
      shells.dispose()
      forwards.dispose()
      engine.dispose()
    }, 'ssh-workspace: fs patch')

    scoped.effect(
      () => {
        const installed = workspaceTools(ctx, engine, router, forwards, shells).map(tool => ctx.tools.register(tool))
        return () => { for (const dispose of installed) dispose() }
      },
      'ssh-workspace: tools',
    )
  }

  // Opening saved tunnels at startup is opt-in (the `autoStart` preference in
  // the store, written by the panel). It runs on a later tick and never throws:
  // an unreachable host must not delay or fail the plugin's own activation, and
  // a mapping that cannot bind is reported in the panel like any other failure
  // rather than taking the profile down.
  const startSavedForwards = () => {
    setTimeout(() => {
      savedForwards.autoStart().catch((error) => {
        ctx.logger?.warn?.(`ssh-workspace: could not auto-open saved port forwards: ${error instanceof Error ? error.message : String(error)}`)
      })
    }, 0)
  }
  startSavedForwards()

  // `ctx.inject` runs `install` immediately when `fs` is already available and
  // otherwise as soon as it is provided — which is what makes the takeover
  // independent of where this plugin sits relative to the backend in the
  // profile's entry list.
  ctx.inject(['fs'], install)

  // ┌─ UPSTREAM WORKAROUND #1 — delete this block when upstream fixes it ──────
  // │ Reading a STORED session's history re-validates every projection value,
  // │ and the unit carrying a session's directory captured `path.isAbsolute` as
  // │ a function VALUE before this plugin could patch it — so an `ssh://` cwd
  // │ fails its schema and the browser reports "历史加载失败". Relaxing that one
  // │ schema is what makes those sessions openable again.
  // │
  // │ Upstream fix (one line, in @deepseek-ai/dsh-working-directory lib/index.js):
  // │   refine(isAbsolute)  →  refine((value) => isAbsolute(value))
  // │
  // │ Removal: delete this block, lib/patch-projection.js, the two
  // │ projection-*-smoke suites, and docs/upstream-workarounds.md.
  // │ You do not have to watch for the release: installProjectionRelaxation
  // │ probes the registered schema and, once it accepts an ssh:// value on its
  // │ own, patches nothing and reports `probe: 'fixed'` — the workaround retires
  // │ itself. That verdict is recorded on the engine (NOT in ctx.logger, which
  // │ nothing in this deployment reads): look for it in ssh_workspace_status →
  // │ upstreamWorkarounds, or an `upstream` event. tests/projection-real-smoke.mjs
  // │ goes RED on that release, which is the second signal. To check a deployment
  // │ by hand, restart DSH with DSH_SSH_WORKSPACE_DISABLE_UPSTREAM_WORKAROUNDS=1
  // │ and open a stored ssh:// session: it loads → the workaround is obsolete.
  // │ Runbook: docs/upstream-workarounds.md · id: UPSTREAM-1-working-directory-isAbsolute
  // └──────────────────────────────────────────────────────────────────────────
  ctx.inject(['sessionProjections'], (scoped) => {
    const installed = installProjectionRelaxation(scoped, { logger: scoped.logger })
    if (installed === undefined) {
      scoped.logger?.warn?.('ssh-workspace: sessionProjections was not available; stored ssh:// sessions may fail to load')
      return
    }
    // The verdict has to land somewhere a user can reach. `ctx.logger` cannot
    // carry it (no console exporter; debug is below every level), so it goes on
    // the engine, which serves it through the status tool and the panel route.
    engine.noteUpstreamWorkaround(installed.id, { probe: installed.probe, detail: installed.detail })
    scoped.effect(() => () => { uninstallProjectionRelaxation(scoped) }, 'ssh-workspace: projection schema')
  })

  // The shell seam allows ONE executor per context and the deployment's local
  // executor is already mounted, so the remote half is installed onto that
  // live instance too (see patch-shell.js): a spec whose workdir is an
  // `ssh://` target runs on the host, everything else through the original
  // local executor unchanged.
  ctx.inject(['shell'], (scoped) => {
    const shellRouter = installRemoteShell(scoped, { engine, logger: scoped.logger })
    if (shellRouter === undefined) {
      scoped.logger?.warn?.('ssh-workspace: ctx.shell was not available; remote command execution is disabled')
      return
    }
    scoped.effect(() => () => { uninstallRemoteShell(scoped.get('shell')) }, 'ssh-workspace: shell patch')
  })

  // The file tools' helpers spawn short-lived child processes through
  // ctx.subprocess, and two of them can legitimately carry a remote workspace
  // as cwd — the search tool's ripgrep and the change tracker's git. The
  // remote half is installed onto that live service the same way (see
  // patch-subprocess.js): specs whose cwd is an `ssh://` target run on the
  // remote machine, everything else through the original spawn unchanged.
  ctx.inject(['subprocess'], (scoped) => {
    const subprocessRouter = installRemoteSubprocess(scoped, { engine, logger: scoped.logger })
    if (subprocessRouter === undefined) {
      scoped.logger?.warn?.('ssh-workspace: ctx.subprocess was not available; remote glob/grep and git support are disabled')
      return
    }
    scoped.effect(() => () => { uninstallRemoteSubprocess(scoped.get('subprocess')) }, 'ssh-workspace: subprocess patch')
  })

  // A persistent terminal is the same seam one layer up: the harness's terminal
  // backend asks `ctx.subprocess.spawnTerminal` for a PTY, which is a LOCAL
  // primitive. Without this, a persistent shell whose cwd is an ssh:// workspace
  // either fails or starts a local shell against a path that only exists on the
  // host. Installing here makes the harness's own terminal tools work remotely.
  ctx.inject(['subprocess'], (scoped) => {
    const terminalRouter = installRemoteTerminal(scoped, { engine, logger: scoped.logger })
    if (terminalRouter === undefined) {
      scoped.logger?.warn?.('ssh-workspace: ctx.subprocess was not available; remote terminals are disabled')
      return
    }
    scoped.effect(() => () => { uninstallRemoteTerminal(scoped.get('subprocess')) }, 'ssh-workspace: terminal patch')
  })

  // The served-root set lives in memory while the workspace registration is
  // durable, so without this a restart would leave ssh:// workspaces listed in
  // the UI but unserved — and their writes fenced off. Re-mount whatever the
  // registry still lists; like the route injection below, this also installs
  // the patch itself when it happens to activate first.
  ctx.inject(['fs', 'workspaceRegistry'], (scoped) => {
    const activeRouter = router ?? installRemoteFileSystem(scoped, { engine }, RemoteFileSystem)
    if (activeRouter === undefined) return
    const registry = scoped.get('workspaceRegistry')
    if (typeof registry?.list !== 'function') return
    // Workspaces the user detached: their registration survives so the row
    // stays visible and re-enableable, but the plugin must NOT re-mount them —
    // that would make "off" last only until the next restart.
    const detached = detachedWorkspaces
    const detachedSet = new Set(detached)
    let restored = 0
    for (const entity of registry.list()) {
      const path = String(entity?.path ?? '')
      if (!isRemotePath(path)) continue
      if (detachedSet.has(path)) continue
      try {
        const parts = parseRemotePath(path)
        activeRouter.addRoot(parts.alias, parts.remotePath)
        restored += 1
        // Warm the prompt cache for the restored workspace so a session that
        // opens right after a restart does not spend its first step without it.
        void prompts.refreshWorkspace(path)
      } catch (error) {
        scoped.logger?.warn?.(`ssh-workspace: could not re-mount "${path}": ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (restored > 0) scoped.logger?.info?.(`ssh-workspace: re-mounted ${restored} remote workspace(s) from the registry`)
    if (detachedSet.size > 0) scoped.logger?.info?.(`ssh-workspace: ${detachedSet.size} detached remote workspace(s) left unserved`)
  })

  // The browser half. Its routes need BOTH the filesystem (to mount through)
  // and the deployment's web server, and either may appear after this plugin
  // loads — so wait for both instead of giving up on a first look. A deployment
  // without a web server simply never gets the HTTP surface, while the agent
  // tools above still work.
  ctx.inject(['fs', 'webServer'], (scoped) => {
    const webServer = scoped.get('webServer')
    if (webServer === undefined || webServer === null) return
    // The fs injection normally got here first; installing is idempotent, so
    // this also covers the reverse activation order.
    const activeRouter = router ?? installRemoteFileSystem(scoped, { engine }, RemoteFileSystem)
    if (activeRouter === undefined) return
    scoped.effect(
      () => {
        const routes = makeRoutes({
          engine,
          router: activeRouter,
          forwards,
          savedForwards,
          shells,
          ctx: scoped,
          prompts,
          // The registered "local-exec" skill verdict — see the effect above.
          localExecSkill,
          // The browser half's fence. `allowLan` is three-state: an explicit
          // true/false wins, and an absent one follows the bind address — a
          // webserver listening on 0.0.0.0 is already reachable from the LAN,
          // and a panel that answers 403 there looks broken rather than fenced.
          // `webServer.host` is the resolved bind literal ('127.0.0.1' or
          // '0.0.0.0'), so no address parsing is needed here.
          allowLan: resolveAllowLan({ configAllowLan: config.allowLan, bindHost: webServer.host }),
          allowedHosts: Array.isArray(config.allowedHosts) ? config.allowedHosts : [],
        })
        const disposers = routes.map(route => webServer.register(route))
        scoped.logger?.info?.(`ssh-workspace: registered ${routes.length} HTTP routes for the browser half`)
        return () => { for (const dispose of disposers) dispose() }
      },
      'ssh-workspace: routes',
    )
  })
}

export { SshWorkspaceEngine, RemoteFileSystem }
export { formatRemotePath, parseRemotePath, isRemotePath, normalizeRemotePath } from './protocol.js'
export { SSH_WORKSPACE_GUIDANCE, niubashGuidanceSection, sshGuidanceForCwd } from './guidance.js'
