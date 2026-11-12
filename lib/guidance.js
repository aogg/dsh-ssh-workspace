/**
 * The model-facing text this plugin injects into the system prompt, in one
 * place so the injection and the panel's global display page cannot drift.
 *
 * Two layers:
 * - {@link SSH_WORKSPACE_GUIDANCE} — the static tool announcement (moved here
 *   from index.js verbatim; index.js re-exports it for API compat).
 * - {@link niubashGuidanceSection} — the per-host Niubash usage notes, gated
 *   by {@link sshGuidanceForCwd}: a host with NO initialization record and no
 *   verified three-level placement gets NOT ONE BYTE appended — the gate is
 *   the whole point (a Windows host without the runtime has no business
 *   reading Niubash usage notes, and a macOS host even less).
 *
 * The gate is SYNCHRONOUS by design: the host evaluates section text on every
 * model step, so no remote probe may run here. It reads two facts only —
 * the host entry's `bashProvisioned` record (the durable authority) and the
 * engine's in-memory niubash-presence cache (filled by completed inits and
 * by the three-level placement probes in win-bash.js and the panel's status
 * route, which DO talk to the network — elsewhere, on their own schedule).
 *
 * @module @shiqyka/dsh-ssh-workspace/guidance
 */

import { parseRemotePath } from './protocol.js'

/** Stable Cordis plugin name (mirrors index.js; kept here to avoid a cycle). */
const PLUGIN_SECTION_NAME = 'plugin:dsh-ssh-workspace'

/**
 * Model-facing announcement describing the remote-workspace capability.
 *
 * Verbatim the text index.js has always injected — the module exists so the
 * injection, the `/injected` route and the panel display read ONE copy.
 *
 * @type {string}
 */
export const SSH_WORKSPACE_GUIDANCE = [
  '本机已安装 dsh-ssh-workspace 插件（远程工作区）：可以把一台 SSH 主机上的目录当作 DSH 工作区使用。',
  '',
  '工作区路径语法：`ssh://<主机别名>/<远端绝对路径>`，例如 `ssh://myserver/home/user/project`。',
  '当会话工作区是这种路径时，read / write / edit 会通过 SFTP 直接读写远端文件，无需手动同步。',
  '',
  '工具：ssh_workspace_hosts（列出主机）、ssh_workspace_mount（挂载远端目录为工作区）、',
  'ssh_workspace_unmount（卸载工作区，默认 `detach` 可逆：保留工作区记录与会话，只是停用）、',
  'ssh_workspace_enable（重新启用被停用的工作区）、ssh_workspace_status（查看当前状态）、',
  'ssh_workspace_exec（在远端执行命令）、ssh_workspace_shell（在远端开持久会话，cd 与变量跨调用保留）、',
  'ssh_workspace_bash（探测/部署 Windows 主机的 POSIX bash；新建 win 主机默认自动部署 Niubash 载荷）、',
  'ssh_workspace_transfer（本机与远端之间传文件，不经对话内容）、',
  'ssh_workspace_forward / ssh_workspace_unforward（把远端端口映射到本机 / 关闭映射）。',
  '主机列表在「远程工作区」面板中管理（添加 / 编辑 / 删除），写入 $DSH_HOME/dsh-ssh.json；~/.ssh/config 为只读回退。',
  '',
  '远端工作区的能力与限制（重要）：',
  '- read / write / edit / glob / grep 都在远端生效：glob / grep 会调用远端主机上的 ripgrep（rg）搜索远端内容，',
  '  返回的是远端路径；远端未安装 rg 时会得到明确的安装提示（退出码 127）。',
  '- 工作区变更追踪（diff / 变更面板）使用远端 git，需要远端主机安装 git；未安装时该功能自动关闭。',
  '- 远端变更监视（文件树 / 预览自动刷新）优先使用远端 inotifywait 推送事件（即时、不受 mtime 精度限制）；',
  '  未安装时回退到轮询（约 2 秒一次，同一秒内等长的连续改写可能不触发刷新）。',
  '- 端口转发：ssh_workspace_forward 把远端端口映射到本机（例如远端 dev server 的 5173），返回可打开的',
  '  http://localhost:<port> 地址；映射随 SSH 连接存活，连接断开即自动关闭，可再次调用重新打开；',
  '  ssh_workspace_unforward 主动关闭并释放本地端口。注意远端应用可能有自己的 host / 回调白名单校验',
  '  （如 Vite 的 server.allowedHosts、Next 的 allowedDevOrigins、OAuth 的 redirect URI），需要一并放行 localhost。',
  '- 会话工作区是 ssh:// 时，pwsh / bash 工具的 workdir 会落到远端，命令在远端主机执行，',
  '  方言按主机判定：Linux/macOS 主机是 POSIX shell（bash/sh）；Windows 类型主机（钉了 win 或探测出',
  '  cmd 登录 shell）优先使用远端已有的 POSIX bash——引擎按固定候选路径（Git / scoop / chocolatey / MSYS2）',
  '  加 PATH 逐个探测，并用 `bash --version` 实测后才算数（结果按连接缓存）；探测不到可用',
  '  ssh_workspace_bash action=provision 部署钉版载荷（DSH 侧下载/解包，仅经 SFTP 上传 + 远端 bash 自检，',
  '  不依赖远端 Windows 自带程序），部署后远端 rg / git 也随载荷可用；都没有才回退 cmd.exe（命令按 cmd',
  '  语法写，如 where / dir，而非 ls / cat）。',
  '  登录 shell 被改成 PowerShell 的 Windows 主机维持「不适配」（按 POSIX 兜底、会报错，详见 docs/tools.md）。',
  '  命令落点由 workdir 决定：显式传本地 workdir（如 /tmp）即在本机执行、不过 SSH；',
  '  模型技能目录中的 local-exec 技能有完整判定与写法（workdir 路由、通道辨析、围栏与端口转发）。',
  '- 远端命令不受本机文件沙箱约束，以远端登录用户的完整权限运行；本机沙箱策略（sandbox_permissions）不适用于远端命令。',
  '- 因此**会话处于「仅可查看」（read-only）时，所有远端写入与命令执行都被拒绝**：write / edit、',
  '  ssh_workspace_transfer 的上传、ssh_workspace_exec、ssh_workspace_shell、workdir 落在远端的',
  '  bash / pwsh 调用，以及 cwd 为 ssh:// 的终端（terminal_open；内建侧边栏终端同样受限），都会返回一条说明',
  '  （本机沙箱无法限制远端进程，所以只能拒绝，不能只围栏）。已经开着的远端终端在切成 read-only 后也会停止',
  '  接受输入——只有控制字节（SIGINT、关闭）例外。',
  '  读取不受影响（read / glob / grep 走 SFTP，不需要执行命令）。要执行命令，把会话切到',
  '  workspace-write 或 danger-full-access。',
  '- 文件写入另有两条围栏：必须落在已挂载的工作区根之内、或该主机的 /tmp 之下（与本地一致：本地的可写根',
  '  集合除工作区外还含 /tmp，所以远端构建能写暂存文件），越界返回 `FS_OUTSIDE_WORKSPACE`；',
  '  工作区被停用时返回 `FS_PERMISSION_DENIED`，文案带 `the remote workspace is detached`。',
  '  这两条扩展权限也解不开，先挂载 / 先启用。ssh_workspace_transfer 的上传与面板上传同样过这两条围栏，',
  '  且在任何字节发出之前判定——write 会拒绝的落点，上传同样拒绝。',
  '- workspace-write 下写入还要求落在**本会话自己的工作区**之内（与本地同一条规则）：写兄弟目录或另一台',
  '  主机的已挂载根会返回 `FS_SANDBOX_DENIED`，文案会点名会话工作区（该主机的 /tmp 除外）。命令执行做不到这一层收窄——',
  '  限制进程需要内核边界，而它跨不过 SSH——所以 workspace-write 下的远端命令仍以远端登录用户权限运行。',
  '- 被停用（unmount `detach`）的工作区对除 SSH 连接外的一切操作都被拒绝：读写、列目录、变更监视、执行命令、',
  '  开终端、glob / grep / git、传输都会失败。这是停用造成的，不是远端文件不存在；用 ssh_workspace_enable 恢复。',
  '- 端口转发的**已存映射**（面板里保存的那些）有独立的「意图」状态：连接断开时映射保留、',
  '  下次可一键重开，不会被当成故障；由 ssh_workspace_forward 临时打开的隧道则随连接消失。',
  '- 大文件读取按块流式传输（预览 / read 不会把整个文件读进内存）；写入采用「暂存文件 + 原子替换」。',
].join('\n')

/** The section name index.js registers the announcement under. */
export const SSH_GUIDANCE_SECTION_NAME = PLUGIN_SECTION_NAME

/**
 * The Niubash usage notes appended AFTER the announcement for a session
 * whose host has the runtime — the ops-style do's and the do-nots.
 *
 * The wording is adapted from dsh-ops's bash guidance (its win32 branch):
 * this is a local MSYS-semantics Bash on a Windows host, NOT Linux, NOT WSL,
 * NOT PowerShell. It names the deployment's address and version first (the
 * model should know WHERE the runtime it is using lives), then the rules.
 *
 * @param {object} info - the presence fact (`root`, `version`, `placement`, …).
 * @param {string} [alias] - the host alias, when known.
 * @returns {string} the section text (multi-line).
 */
export function niubashGuidanceSection (info, alias) {
  const where = typeof info?.root === 'string' && info.root !== '' ? info.root : '(路径未知)'
  const version = typeof info?.version === 'string' && info.version !== '' ? info.version : '未知版本'
  const releaseTag = typeof info?.releaseTag === 'string' && info.releaseTag !== '' ? `（${info.releaseTag}）` : ''
  const hostLabel = typeof alias === 'string' && alias !== '' ? `主机 ${alias}` : '本主机'
  return [
    `# Niubash 已初始化（${hostLabel}）`,
    '',
    `${hostLabel}已初始化 Niubash（POSIX Bash 运行时）：`,
    `- 目录地址：\`${where}\``,
    `- 版本：${version}${releaseTag}`,
    '',
    '使用要点：',
    '- 这是该 Windows 主机上的本机 Niubash Bash——不是 Linux、不是 WSL、也不是 PowerShell；',
    '  按本机 MSYS Bash 语义写命令。',
    '- bash / pwsh 工具的 workdir 接受 `D:/repo` 与 `/d/repo` 两种拼写；不带盘符的 `/tmp` 或 `/`',
    '  不是合法的 Windows workdir。',
    '- 命令内部使用 MSYS 路径拼写（如 `/d/repo/file.txt`），含空格的路径加引号。',
    '- 用 Bash 而非 PowerShell 语法：`$VAR`、`$(command)`、glob、重定向、管道；',
    '  不要用 `%VAR%`、`Get-ChildItem` 之类的 PowerShell 拼法。',
    '- 载荷自带的 git / rg / awk 已随树部署并进入 PATH（引擎会在派发时补 PATH 前缀），',
    '  远端 glob/grep（rg）与变更追踪（git）随之可用，无需另装。',
    '- 不碰 Windows 自带程序：不调用 tar.exe / Expand-Archive / bitsadmin / curl——',
    '  解包与传输由插件在 DSH 侧完成（SFTP 写入 + 该 bash 执行），远端不需要也不应依赖它们。',
  ].join('\n')
}

/**
 * The guidance text for one session cwd: the base announcement, plus the
 * host's Niubash section ONLY when the gate says the host has the runtime.
 *
 * The gate answers from two synchronous facts, in order:
 * 1. the host entry's `bashProvisioned` record (the durable store authority —
 *    an initialization writes it and it survives restarts);
 * 2. the engine's presence cache (a completed init or a verified placement
 *    probe landed there; dies with the process, re-proven on demand).
 *
 * Neither present → the base text byte-for-byte. A cwd that is not an
 * `ssh://` workspace (a local session) → the base text too: the Niubash
 * notes describe a REMOTE runtime and a local session is not using one.
 *
 * @param {string | undefined} cwd - the session workspace path.
 * @param {object | undefined} engine - the live engine (`store.entry`,
 *   `niubashPresenceOf`); absent → base text only.
 * @returns {string} the announcement text for this session.
 */
export function sshGuidanceForCwd (cwd, engine) {
  if (engine === undefined || engine === null) return SSH_WORKSPACE_GUIDANCE
  const parts = parseRemotePath(typeof cwd === 'string' ? cwd : '')
  if (parts === undefined || parts === null) return SSH_WORKSPACE_GUIDANCE
  const alias = parts.alias
  // 1) the durable record wins — the host entry is what "已初始化" means.
  const record = engine.store?.entry?.(alias)?.bashProvisioned
  if (record !== null && typeof record === 'object') {
    return `${SSH_WORKSPACE_GUIDANCE}\n\n${niubashGuidanceSection(record, alias)}`
  }
  // 2) the in-memory presence (probe-proven or just-provisioned this process).
  const presence = typeof engine.niubashPresenceOf === 'function' ? engine.niubashPresenceOf(alias) : undefined
  if (presence !== undefined && presence !== null) {
    return `${SSH_WORKSPACE_GUIDANCE}\n\n${niubashGuidanceSection(presence, alias)}`
  }
  return SSH_WORKSPACE_GUIDANCE
}
