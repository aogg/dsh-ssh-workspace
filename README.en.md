<div align="center">

<img src="https://raw.githubusercontent.com/siqyka/dsh-ssh-workspace/main/docs/assets/header.png" alt="dsh-ssh-workspace header" width="640" />

# dsh-ssh-workspace

**Use a directory on an SSH host as a DSH workspace.**

`read` / `write` / `edit` go straight over SFTP to read and write remote files —
no manual sync, no mount driver, no third-party filesystem.

[![version](https://img.shields.io/github/package-json/v/siqyka/dsh-ssh-workspace)](https://github.com/siqyka/dsh-ssh-workspace)
[![license](https://img.shields.io/github/license/siqyka/dsh-ssh-workspace)](https://github.com/siqyka/dsh-ssh-workspace/blob/main/LICENSE)
![node](https://img.shields.io/badge/node-%3E%3D%2020-brightgreen)
![dsh](https://img.shields.io/badge/DSH-%3E%3D%200.2.0--rc.1-blue)
![ssh2](https://img.shields.io/badge/ssh2-%5E1.17.0-lightgrey)

[简体中文](https://github.com/siqyka/dsh-ssh-workspace/blob/main/README.md) · **English**

</div>

---

<table>
<tr>
<td align="center" width="33%">

**Direct SFTP**

Reads, writes and edits run over SFTP
with full error semantics and atomic writes

</td>
<td align="center" width="33%">

**Remote execution**

Shell, ripgrep and git
all run on the remote host

</td>
<td align="center" width="33%">

**UI integration**

File tree, `@` references, drag-to-task
and a host management panel out of the box

</td>
</tr>
</table>

## Contents

- [Overview](#overview)
- [Quick start](#quick-start)
- [Host management](#host-management)
- [Configuration](#configuration)
- [Agent tools](#agent-tools)
- [Capabilities](#capabilities)
- [Limitations](#limitations)
- [Implementation notes](#implementation-notes)
- [Documentation index](#documentation-index)
- [License](#license)

## Overview

Workspace path syntax:

```
ssh://<alias>/<remote-absolute-path>
e.g.   ssh://myserver/home/user/project
```

In the UI these paths are **displayed** as `ssh://<alias>@/<remote-absolute-path>`
(an `@` is inserted after the alias, so it reads like an SSH address) — that is how
they appear on sidebar workspace-row hover cards, the right sidebar's "Files" panel
header, document-preview headers, and elsewhere. Copying and every functional use
(mounting, file operations, tool calls) still use the real spelling
`ssh://<alias>/<remote-absolute-path>`.

### The problem it solves

DSH routes all file operations through a single service abstraction, `ctx.fs`
(`@deepseek-ai/dsh-fs`). This plugin adds a "remote half" to that abstraction:

```
        DSH tool layer (read / write / edit / bash / glob / grep / Changes panel)
                                   │
                              ctx.fs router
                                   │
            ┌──────────────────────┴──────────────────────┐
            │                                             │
   ssh://<alias>/<path>                    everything else (E:\…, /home/…)
            │                                             │
   This plugin's SFTP backend ──► SSH host   The deployment's original local
                                            (sandbox) backend
```

So **everything about local workspaces stays as it was**, including the sandbox write
fence, version guards, and atomic writes; remote workspaces get the same tools and the
same error semantics.

## Quick start

1. **Install**: open the official desktop client and go to the **Plugins** page under
   **Settings** (or the plugins entry in the left navigation bar);
2. **Enter the source**: in the plugin manager's install field, use either of these and
   click Install:
   - **npm package** (distributed via npm, version pinning supported):
     `@shiqyka/dsh-ssh-workspace`, or pin a version
     `@shiqyka/dsh-ssh-workspace@0.2.7`
     ([npm page](https://www.npmjs.com/package/@shiqyka/dsh-ssh-workspace));
   - **repository address** (latest code from Git):
     `https://github.com/siqyka/dsh-ssh-workspace`
     (the plugin manager installs its dependencies for you; only a manual clone
     linked into a profile needs the next section)
3. **Restart**: restart the client once installation finishes, and you're ready to go.

From there:

```
Confirm your hosts in the "Remote Workspaces" panel (add one if needed)
        │
        ▼
"Add workspace → New remote workspace": pick a host, browse the remote directory, mount
        │
        ▼
Create a session in that workspace — file I/O, shell, search and change tracking
all land on the remote host automatically
```

### Using a source checkout

```bash
git clone https://github.com/siqyka/dsh-ssh-workspace.git
cd dsh-ssh-workspace
npm ci          # ssh2 is a direct dependency and does not arrive with a clone
```

Then restart the client.

## Host management

Host records live in `$DSH_HOME/dsh-ssh.json`; when that file is absent, the plugin
falls back to concrete `Host` blocks in `~/.ssh/config`. So **hosts you have already
configured need no re-entry**.

The "Remote Workspaces" panel can **add / edit / delete** hosts directly, writing back
to `$DSH_HOME/dsh-ssh.json` (atomic writes; fields the plugin doesn't recognize are
preserved). Hosts from `~/.ssh/config` are a **read-only fallback** — the panel never
modifies that file; when the same name exists in both, the store wins. Passwords / key
passphrases are **encrypted** in that store's `secrets` section (AES-256-GCM, key in
`$DSH_HOME/dsh-ssh.key`, owner-only) and are never sent back to the browser; leaving them
blank while editing keeps the current value. Deleting a
host does not automatically unmount its mounted workspaces, but those workspaces
become inaccessible since the host no longer exists.

> See [docs/hosts.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/docs/hosts.md) for the storage format, `~/.ssh/config` parsing
> rules, and the credential policy.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch |
| `announceToAgent` | `false` | Whether to inject a capability description (a system-prompt section) into every agent |
| `allowLan` | auto | LAN deployment: **follows the webserver bind by default** — enabled when it binds `0.0.0.0`, loopback-only otherwise (including no webServer); an explicit `true` / `false` wins |
| `allowedHosts` | `[]` | Extra `Host` values to admit (with `allowLan`), e.g. when the panel is reached by a LAN hostname |
| `engine.idleTimeoutMs` | `1800000` | Recycle a connection after it stays idle this long (ms) |
| `engine.connectTimeoutMs` | `15000` | Per-connect SSH handshake budget (ms) |
| `engine.keepaliveIntervalMs` | `15000` | Keepalive heartbeat interval (ms) |
| `engine.sweepIntervalMs` | `60000` | How often idle connections are swept (ms) |

> All four `engine` entries are optional (invalid values fall back to the defaults) and rarely need tuning.

### LAN deployments (`allowLan`)

By default only the **loopback interface** may call the browser routes
(`127.0.0.1` / `::1` / `localhost`). When the webserver binds `0.0.0.0` and the
browser sits on another LAN machine, requests are refused with
`forbidden: loopback-only` — that is the anti-DNS-rebinding fence, not a
malfunction.

`allowLan` has three states: an explicit `true` / `false` wins, and when it is
absent it **follows the webserver bind** (`webserver.host === '0.0.0.0'` counts
as enabled, because binding every interface is itself a statement that the
server may be reached from elsewhere; a loopback bind or no webServer keeps the
loopback fence). A deployment that binds `0.0.0.0` therefore needs no extra
configuration to open the panel from the LAN. Once enabled:

- the source address may be any **private-network** address (IPv4 `10/8`,
  `172.16/12`, `192.168/16`; IPv6 ULA `fc00::/7` and link-local `fe80::/10`);
  public addresses are still refused;
- the `Host` header may be any of three things: one of **this machine's own
  listening addresses** (each interface address plus the port; loopback
  spellings always work), a configured `allowedHosts` value, or a **private IP
  literal** (IPv4 with an optional port; IPv6 in brackets, port optional). The
  third is what makes Docker port mappings, `ssh -L` tunnels and reverse proxies
  work: the browser sends the address it dialled (the host's `172.19.0.199`),
  while the container only sees its own interface (`172.21.0.199`), so
  "must be one of MY addresses" refused every such deployment;
- a **hostname** is still admitted only when `allowedHosts` lists it: a
  rebinding attack must send its own domain as `Host`, and that name is in no
  list — so the anti-rebinding semantics are unchanged. Public IP literals are
  still refused;
- a refusal also writes one warn line with the `mode`, the source address, the
  `Host` and the fix; the response body keeps its historical wording
  (`forbidden: loopback-only` / `forbidden: unexpected Host header …`), so
  check the log when debugging;
- if the panel is reached by a name the machine's interfaces do not know (a
  LAN hostname, a reverse-proxy spelling), add it to `allowedHosts` (case and
  surrounding whitespace insensitive, with or without a port);
- the JSON content-type check on POST and the 405/415 handling are unchanged.

See [SECURITY.md](./SECURITY.md) for the full security discussion.

## Agent tools

| Tool | Purpose |
| --- | --- |
| `ssh_workspace_hosts` | List available hosts (store + `~/.ssh/config` candidates) |
| `ssh_workspace_mount` | Register a remote directory as a workspace and return an `ssh://` path |
| `ssh_workspace_unmount` | Detach a remote workspace (the record and its sessions are kept by default, so it is reversible; opting into "also remove the record" archives the sessions and deletes the record) |
| `ssh_workspace_enable` | Mount a detached workspace again and unarchive its sessions |
| `ssh_workspace_status` | Mounted / detached lists, connections, forwards, and persistent sessions |
| `ssh_workspace_exec` | Run a shell command **on the remote host** (optionally `run_in_background`) |
| `ssh_workspace_shell` | Run a command in a **persistent** remote shell; state survives between calls |
| `ssh_workspace_bash` | Detect / provision a POSIX bash on Windows-type hosts (detection executes candidates; provisioning uploads over SFTP and verifies remotely — no remote Windows built-ins involved) |
| `ssh_workspace_transfer` | Copy a file between this machine and the host (SFTP, bytes never enter the conversation) |
| `ssh_workspace_forward` | Map a remote port to this machine and return an openable URL |
| `ssh_workspace_unforward` | Close a port mapping and release the local port |

> For tool parameters, return fields, and error semantics, see [docs/tools.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/docs/tools.md).

## Capabilities

> The complete inventory by domain (dependencies, degradation, limits included) is in [docs/features.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/docs/features.md).

### Remote files

| Capability | Details |
| --- | --- |
| Full error semantics | `read` / `write` / `edit` run entirely over SFTP, with `FS_STALE_VERSION`, `FS_NOT_OBSERVED`, `FS_AMBIGUOUS_EDIT`, `FS_NOT_TEXT`, `FS_TOO_LARGE`, `FS_NOT_FOUND`, and so on |
| Atomic writes | A write first lands in a staging file in the same directory, then replaces the target. OpenSSH's `posix-rename@openssh.com` is preferred; when the server doesn't support it, the plugin degrades to "delete, then rename" (no longer atomic in that case) |
| Line-ending fidelity | Editing a CRLF file won't rewrite it to LF |
| Binary and encoding | Text reads reject NUL / invalid UTF-8; `readBytes` returns raw bytes |
| Write fence | Remote writes may only land inside a mounted remote workspace; anything outside returns `FS_OUTSIDE_WORKSPACE`. **The `read-only` mode also blocks remote writes** (`FS_SANDBOX_DENIED`). Reads are unrestricted |
| Large files stream | Previews and `read` stream remote files in 256 KiB chunks instead of loading the whole file into memory |
| Remote changes auto-refresh | Remote `inotifywait` push events are preferred (immediate, not bound by mtime precision); without it the plugin falls back to polling — about every 2 seconds, backing off while idle (after 15 quiet rounds to 5 s, after 30 to 10 s) and snapping back to 2 s on any change. On the polling path SFTP metadata has no sub-second timestamps, so consecutive rewrites of equal size within the same second may not trigger a refresh; additions, removals, and renames always do |

### Remote execution

| Capability | Details |
| --- | --- |
| Shell commands follow the workspace | With an `ssh://` session workspace, the `pwsh` / `bash` tools run on the remote host — one-shot commands, background jobs, timeouts, and cancellation all work through DSH's process contract; local `workdir` commands are unaffected. The dialect is per host: POSIX hosts speak a POSIX shell; Windows hosts dispatch POSIX through their own bash when one exists (detected, or provisioned via `ssh_workspace_bash`) and fall back to cmd.exe when not |
| Windows hosts get bash | A Windows-type host probes well-known locations (Git / scoop / chocolatey / MSYS2) plus `where bash` for a POSIX bash and verifies each candidate by actually running `--version` (cached per connection); when detection finds none, the pinned payload can be deployed explicitly (niubash — downloaded, digest-checked and unpacked on the DSH host, uploaded over SFTP, verified remotely), after which the payload's own rg / git work remotely too; without any bash the original cmd.exe behavior stands unchanged |
| glob / grep search the remote | They invoke **ripgrep (`rg`) on the remote host** and return real remote results; when ripgrep isn't installed there, the command fails clearly with an install hint (exit code 127) |
| Change tracking goes remote | The "Changes" (deliverables) panel uses **remote git** for per-turn snapshots and diffs — files changed by remote shell commands show up too (+N/−N, click through to the diff); when git isn't installed remotely this capability quietly turns itself off and nothing else is affected |
| Auto-injected `local-exec` skill | The plugin registers a `local-exec` skill into the **model skill catalog** automatically (`userInvocable: false` — hidden from the input-box skill menu): it explains that a command's landing spot is decided by the bash / pwsh `workdir` — with an `ssh://` session workspace, an explicit local workdir (e.g. `/tmp`) runs on this machine without SSH — and covers channel disambiguation (exec / shell / the glob-grep bridge / terminals), the sandbox fences, and port-forward directions. The panel's "Auto-injected skill" section shows the full text read-only |

### UI integration

| Capability | Details |
| --- | --- |
| New sessions work | The host's own `node:fs/promises` calls (the session controller's `mkdir`, the workspace registry's `realpath` / `stat`) also route `ssh://` paths over SFTP, and `node:path.isAbsolute` treats `ssh://` spellings as absolute — so you can create a session directly in a remote workspace |
| Automatic remount after restart | Registered `ssh://` workspaces are remounted from the persisted registry on next launch |
| The "Workspace Files" sidebar works | The file tree lists the remote directory directly and text previews are read over SFTP; `fs.fileUrl` returns the canonical `file:` URI of the **remote execution world** per the `dsh-fs` contract |
| `@` file references work remotely | The chat input's `@` completion draws candidates from the **remote** tree (recursive index + fuzzy ranking; queries containing `/` browse level by level; directory symlinks are never followed). A selection inserts `@relative/path`, and the model's `read` opens exactly that remote file |
| Drag or right-click a file onto the task | Files and folders in the tree can be **dragged straight onto the chat input** (dashed highlight while hovering; releasing inserts the reference chip) or picked via **right-click → "Add to task"** — both produce exactly what an `@` completion selection would |
| "Add workspace" gets a remote entry | DSH's "Add workspace" button becomes an anchored menu offering "New local workspace" (DSH's native picker; when the host only composes the in-app browse backend, it degrades automatically to an in-app "choose a local directory" dialog — browse level by level, create a folder in place, confirm the choice, with the capability remembered so later opens never fail once first) or "New remote workspace" (choose a host → browse the remote directory level by level → confirm the mount; unwritable directories produce a warning and refuse creation) |
| Remote workspaces wear a dedicated mark | Workspaces created by this plugin show the plugin's remote mark instead of the plain folder icon in sidebar rows, the workspace picker, and the session page's workspace button |
| Floating remote workspaces | When one project needs several SSH remotes, configure them under that project's workspace ⋯ menu → "SSH remote workspaces": the entries belong to **that project only** and take no permanent sidebar row. Selecting one slides an opaque card in from the left over the workspace list; the card holds the workspace's **own native rows**, so new-session, rename, delete, archive, pin, drag and every other plugin's injected menu items keep working. Names are generated (`directory · host alias`), and the add / manage dialogs cover rename, reorder, test connection, delete (optionally deregistering the DSH workspace) and cleanup of broken entries. See [docs/floating-workspaces.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/docs/floating-workspaces.md) |
| Host management panel | Add / edit / delete hosts (key paths, auth method, operating system win/mac/linux, a Windows host's Bash path, notes, …); changes take effect immediately and drop that alias's old connection. Optionally, sidebar workspace rows mounted from a host show a small alias tag under their names (`aliasTag`, off by default) to tell multiple hosts apart. `~/.ssh/config` hosts are shown read-only. "Test connection" only probes reachability (it releases the connection it opened, so a probe never doubles as "connect") and reports as a toast at the top that auto-dismisses after a few seconds (click to close early). Connection state is shown inline after the host name, and dropping a connection also tears down that host's port forwards |
| Directory browser dialog | A host card's "Browse directory" walks the remote tree level by level, uploads a file into the directory on screen, downloads individual files, and can "Mount this directory" in place |
| Uploads / downloads from the file panel | The "Workspace Files" panel header carries "Upload a file here"; the file tree's row menu adds "Download to this machine" / "Upload a file here" for remote rows only |

### Connection model

One long-lived connection per alias — one always-open SFTP channel, with shell
commands opening exec channels on the same connection; recycled after 30 minutes idle
(never while an operation is in flight).

The first connection records the server's host-key fingerprint (trust on first use);
a later key that differs is **refused** with both fingerprints in the message — a guard
against man-in-the-middle attacks. After a legitimate host reinstall, "Forget host key"
in the panel re-trusts on next connect.

## Limitations

Explicitly **not supported**:

- **Jump hosts / ProxyCommand**: the engine only connects directly to the target host
  (the `ssh2` client has no `proxyJump` wiring). Hosts with `proxyJump` /
  `ProxyCommand` are **explicitly rejected** at parse time with the reason stated,
  rather than silently attempted as direct connections; use another tool to connect
  when you need a jump host.
- **Where a shell command runs follows `workdir`.** With an `ssh://` session workspace,
  `pwsh` / `bash` commands run on the remote host — in the host's dialect (POSIX hosts
  speak a POSIX shell; Windows hosts dispatch POSIX through their own bash, falling back
  to cmd.exe when none exists), outside the
  local file sandbox (full permissions of the remote login user); local `workdir`
  commands stay on this machine inside the sandbox. For unmounted paths or host
  inspection, keep using `ssh_workspace_exec`.

## Implementation notes

<details>
<summary><b>Expand: the four core implementation paths</b> (no second fs service, bridging host built-ins, taking over ctx.subprocess, workspace registration bypassing realpath)</summary>

<br>

- **No second `fs` service**: remote methods are installed directly onto the
  deployment's already-mounted `ctx.fs` instance as own properties, and all other
  methods forward unchanged to the original backend (bound to its original receiver).
  Installation order doesn't matter.
- **Bridging the host's built-in modules**: `node:fs/promises` `mkdir` / `stat` /
  `lstat` / `realpath` / `readdir` and `node:path.isAbsolute` special-case `ssh://`
  spellings (including `syncBuiltinESMExports`), so calls that happen before any agent
  exists — creating sessions, registering workspaces — also go over SFTP. `node:path`
  `resolve` / `join` / `relative` understand `ssh://` too (change tracking folds git's
  repository paths with them), `copyFile` / `open` / `rm` serve snapshots and
  captures, and `readdir` serves `@` completion's remote directory scans.
- **Taking over `ctx.subprocess`**: subprocesses whose `cwd` is `ssh://` run on the
  remote host — glob / grep's ripgrep and change tracking's git both take this route
  (every other spawn forwards unchanged); the command whitelist, POSIX script
  assembly, and handle contract (`done` / `collected` / `terminate` ladder) match the
  local runtime.
- **Workspace registration bypasses `realpath`**: it goes through
  `createCanonical()`, preserving full persistence and ordered writes while bypassing
  the host's `realpath` assertion.

</details>

## Documentation index

| Doc | Contents |
| --- | --- |
| [features.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/docs/features.md) | **Feature reference**: the complete capability inventory by domain (workspaces / files / execution / transfer / forwarding / UI / security / config / degradation matrix / limits) |
| [architecture.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/docs/architecture.md) | Architecture & implementation: the `ctx.fs` / `ctx.shell` / `ctx.subprocess` takeovers, change watching & streaming, built-in bridges, engine & connection model |
| [protocol.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/docs/protocol.md) | The `ssh://` path protocol: syntax, normalization, display rules, `file:` URIs, the write fence and the detached fence |
| [hosts.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/docs/hosts.md) | Host configuration & auth: storage format, `~/.ssh/config` fallback, panel management |
| [tools.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/docs/tools.md) | Agent tool reference: the ten `ssh_workspace_*` tools |
| [ui.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/docs/ui.md) | UI guide: the panel, the dual "Add workspace" entry, remote-workspace marks, floating remotes, the port-forward and persistent-shell sections |
| [floating-workspaces.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/docs/floating-workspaces.md) | Floating remote workspaces: the ⋯-menu submenu, the floating card, the add/manage dialogs, storage and routes, degradation points |
| [被扩展说明.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/docs/被扩展说明.md) | DOM extensions of DSH's workspace ⋯ menu and workspace tree: coexistence with ao-local / better-sidebar, degradation matrix |
| [agent-prompts.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/docs/agent-prompts.md) | Three-level agent prompts (global → host → workspace): merge and disable semantics, script protocol, injection mechanism, refresh timing |
| [forward-persistence.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/docs/forward-persistence.md) | Port-forward persistence: intent vs. fact, the two disconnect paths agreeing, auto-start |
| [unmount-modes.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/docs/unmount-modes.md) | The two unmount modes: `detach` (reversible) vs. `deregister`, session archiving, the disable fence |
| [development.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/docs/development.md) | Development, debugging & release: source layout, dependency resolution, packaging |
| [upstream-workarounds.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/docs/upstream-workarounds.md) | Upstream workaround register: host defects, the one-line fix, the self-retiring signal, and the removal steps |
| [upstream-workaround-pattern.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/docs/upstream-workaround-pattern.md) | **The retirement pattern for upstream workarounds**: when it applies, the seven pieces, tri-state probing, a reachable notification channel, anti-patterns, and its cost boundary |
| [troubleshooting.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/docs/troubleshooting.md) | Troubleshooting & FAQ: error semantics, connection issues, known limitations |
| [CONTRIBUTING.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/CONTRIBUTING.md) | Contributing: environment, the three test tiers, code conventions, before you ship |
| [SECURITY.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/SECURITY.md) | Security policy: how credentials are stored, host-key verification, known boundaries, reporting |
| [CHANGELOG.md](https://github.com/siqyka/dsh-ssh-workspace/blob/main/CHANGELOG.md) | Changelog: additions, fixes and changes per version |

---

## License

<div align="center">

**[MIT](https://github.com/siqyka/dsh-ssh-workspace/blob/main/LICENSE) © 2026 siqyka**

<sub>SSH distance, local feel.</sub>

</div>
