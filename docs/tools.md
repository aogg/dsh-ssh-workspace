# Agent 工具参考

> 定位：五个 `ssh_workspace_*` 工具的用途、参数与返回。

这些工具都不复制文件能力：文件内容由 `ctx.fs`（SFTP）服务，`read` / `write` /
`edit` 已经能在远端工作区工作；会话工作区为 `ssh://` 时，pwsh / bash 工具的
命令也由本插件路由到远端执行，glob / grep 的 ripgrep 与工作区变更追踪的 git
同样（走 `ctx.subprocess` 接管）。工具补齐的是主机发现、挂载/卸载、状态，
以及**不依赖挂载的远端命令执行**。

## ssh_workspace_hosts

列出可用主机：存储条目 + `~/.ssh/config` 的具体 Host 块。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `query` | 否 | 大小写不敏感，匹配 alias / host / user / description / tags |

返回 `hosts[]`，每项含 `alias`、`host`、`port`、`user`、`auth`
（`key` / `password` / `agent`）、`keyReady`、`source`（`store` / `ssh-config`）、
`description`、`tags`。

## ssh_workspace_mount

把远端目录挂载为工作区。挂载前会先 `stat` 验证目录**真实存在且是目录**，
失败返回明确错误（`no such directory on <alias>: <path>`）。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `alias` | 是 | 来自 `ssh_workspace_hosts` |
| `remotePath` | 是 | 远端绝对目录路径，如 `/home/user/project` |
| `title` | 否 | 工作区显示名（默认取目录名） |
| `register` | 否 | 是否同时登记为持久工作区（默认 `true`） |

返回 `ok`、`workspacePath`（`ssh://` 拼写，可直接用作会话工作区）、`title`、
`registered`、`workspaceId`、`entryCount`、`error`。
登记失败时仍挂载在进程内，`error` 给出登记失败的原因。

## ssh_workspace_unmount

停止服务一个已挂载的远端目录，并在登记过时删除工作区记录
（活动中的会话保留自己持有的路径副本）。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `workspacePath` | 是 | `ssh_workspace_mount` 返回的 `ssh://` 路径 |
| `deregister` | 否 | 是否同时删除持久工作区记录（默认 `true`） |

返回 `ok`、`wasMounted`、`deregistered`、`error`。

## ssh_workspace_status

无参数。返回当前挂载点 `mounted[]`、活动连接
`connections[{ alias, state, inFlight }]`（`state` 为 `connected` / `broken`）、
打开中的端口转发 `forwards[]`、持久会话 `shells[{ alias, session, alive }]`，
以及 `fsPatched`（远端服务是否在役）。

## ssh_workspace_exec

**在远端**执行 shell 命令，不依赖工作区挂载：主机巡检、挂载前查看目录、
会话工作区之外的路径都走它（工作区内的日常命令直接用 pwsh / bash 工具，
`ssh://` workdir 已被路由到远端）。

每次调用是一个**全新进程**：`cd`、导出的变量、后台任务都不会保留。需要保留
状态时用 `ssh_workspace_shell`。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `alias` | 是 | 主机别名 |
| `command` | 是 | 远端 shell 命令 |
| `cwd` | 否 | 远端工作目录 |
| `timeoutMs` | 否 | 超时毫秒（默认 60000）；`run_in_background` 时忽略 |
| `run_in_background` | 否 | 作为后台任务启动，立即返回 job id |

返回 `success`、`exitCode`（整数或 null）、`timedOut`、`stdout`、`stderr`、
`truncated`、`durationMs`、`error`；后台模式下额外返回 `jobId`，用
`job_output` / `job_kill` 收集与终止。部署没有 `ctx.jobs`（或该 owner 无控制器）
时自动内联执行，不会返回无人能读的 id。

## ssh_workspace_shell

在**持久**的远端 shell 里执行命令：同一 (主机, 会话名) 上维持一个 POSIX `sh`，
`cd`、导出的变量与后台任务跨调用保留，等同于一直使用同一个终端。

远端 shell **固定是 POSIX `sh`**，即使本机是 Windows 也请写 POSIX 语法。
部署自带的 persistent bash / pwsh 工具按本机方言构造命令行（Windows 上是
PowerShell），无法驱动远端主机，因此本插件单独提供这个工具而不是接管它们。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `alias` | 是 | 主机别名 |
| `command` | 否 | POSIX shell 命令；`close: true` 时可省 |
| `session` | 否 | 会话名（默认 `default`），不同名字互不干扰 |
| `close` | 否 | 关闭该会话并释放，而不是执行命令 |
| `timeoutMs` | 否 | 等待命令结束的毫秒（默认 60000） |

返回 `ok`、`output`、`exitCode`、`session`、`reused`（本次调用是否复用了已有
会话）；关闭时返回 `closed`（关闭的会话数）。

退出码通过命令行末尾追加的标记行取回：PTY 没有独立退出通道，`$?` 被立即
捕获并随标记一起打印，因此输出里的标记行不会混进 `output`。

## ssh_workspace_transfer

在**本机与远端**之间经 SFTP 双向拷贝文件，字节不经过对话内容。适合推送构建
产物、拉取日志；**不**用于编辑文件（挂载工作区里的 read / write / edit 已经
直接读写远端）。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `alias` | 是 | 主机别名 |
| `direction` | 是 | `upload`（本机 → 远端）或 `download`（远端 → 本机） |
| `localPath` | 是 | 本机绝对路径（上传的源 / 下载的目标） |
| `remotePath` | 是 | 远端绝对路径（上传的目标 / 下载的源） |
| `recursive` | 否 | 上传整个本地目录树（仅 `upload`） |

返回 `ok`、`bytes`、`files`（递归时）、`error`。

上传**先写同级暂存名再 rename 发布**：目标文件在被替换之前，读到的始终是旧
内容或完整新内容，不会是半截文件。上传失败会清掉暂存文件并保留目标原内容。
下载读至 EOF 而非依赖 stat 时的长度，因此传输期间变长的文件会被完整取回。
单文件上限 1 GiB。

## ssh_workspace_forward

把远端端口映射到本机（等价 `ssh -L`）：远端 dev server 变成可打开的
`http://localhost:<port>`。映射骑在连接池里的 SSH 连接上，连接断开即自动关闭；
重复映射同一目标返回已有条目。注意远端应用可能有自己的 host / 回调白名单
（Vite 的 `server.allowedHosts`、Next 的 `allowedDevOrigins`、OAuth 的
redirect URI），需要一并放行 localhost。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `alias` | 是 | 主机别名 |
| `remotePort` | 是 | 远端端口 |
| `localPort` | 否 | 本地端口，默认同远端；被占用时自动另选，传 0 由系统分配 |
| `remoteHost` | 否 | SSH 服务端拨号的目标（默认 `127.0.0.1`） |
| `localHost` | 否 | 本地监听地址（默认 `127.0.0.1`，仅本机；`0.0.0.0` 暴露到局域网） |

## ssh_workspace_unforward

关闭一条端口转发并释放本地端口。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 来自 `ssh_workspace_forward` 或 `ssh_workspace_status` |

## 通用约定

- 路径一律使用 `ssh://` 实际拼写（不含显示用的 `@`）；
- 错误语义与 `ctx.fs` 同一套（`FS_*` 码），写入围栏对工具触发的写同样生效；
- glob / grep 在远端工作区调用**远端主机的 ripgrep**（需远端已安装 `rg`，
  缺失时命令以退出码 127 失败并附安装提示）；工作区变更追踪用**远端 git**
  （未安装时该功能自动降级，不阻断会话）。本地工作区不受影响。
- 挂载时探测 `rg` / `git` / `inotifywait`，缺失项在挂载结果与面板里直接提示；
  远端有 `inotifywait` 时变更监视走事件推送，否则回落到轮询。

## 相关

- [protocol.md](./protocol.md)
- [根 README](../README.md)
