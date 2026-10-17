# 更新日志

本文件记录 dsh-ssh-workspace 的版本变更。0.1.16 之前的版本为未公开的本地迭代，未收录。

## [0.2.3] - 2026-10-17

### 新功能

- **远端 PTY 终端（`spawnTerminal` 接管）**：新增 `lib/patch-terminal.js`，把部署的
  `ctx.subprocess.spawnTerminal` 在 `ssh://` 工作目录上路由为 SSH PTY 通道。这补上
  了此前唯一的能力缺口——部署自带的持久 bash/pwsh 工具在远端工作区上要么失败、
  要么在本机对着一个只存在于远端的路径启动 shell。返回值满足
  `dsh-terminal-bash` 所依赖的句柄契约（`output` / `write` / `resize` / `done` /
  `inspectForeground` / `signalForeground` / `terminate`）。
  两处刻意的取舍：`argv` 不复用（那是本机方言，远端 POSIX 主机跑不了），改为启动
  远端自己的交互式 `sh`；`inspectForeground` 返回 `undefined` 而非猜测，从而选择
  上层文档化的「输出静默」兜底判定，避免一个错误答案让它等满整个超时。
- **浏览器端下载**：文件选择对话框的每个文件行新增下载按钮，经新增的
  `GET /download` 流式路由取回字节并交给浏览器保存。该路由直接返回原始字节而
  非 JSON（避免 base64 膨胀与体积上限），因此自行重新施加回环来源与 `Host`
  头双重校验，并只接受 GET。

### 测试

- 新增 `tests/terminal-smoke.mjs`（23 项）、`tests/transport-smoke.mjs`（17 项）、
  `tests/routes-smoke.mjs`（11 项），合计 51 项新断言。
- `tool-schemas` 补上 `ssh_workspace_shell`，现在覆盖全部 9 个工具（141 项）。
- `transport-smoke` 首次覆盖 `agentForward` / `compress` 的三层传递（JSON 存储 →
  描述符 → ssh2 配置），以及后台任务的两种路径：有 `jobs` 时注册并返回 id，
  无 `jobs` 时降级为内联执行而不是返回一个没人能读的 id。

## [0.2.2] - 2026-10-17

### 新功能

- **端口转发恢复**：`ssh_workspace_forward` / `ssh_workspace_unforward` 与面板转发
  区重新启用（0.1.21 屏蔽时保留了全部实现）。远端 dev server 映射到本机
  `http://localhost:<port>`，映射随 SSH 连接存活，断开即关闭。
- **持久远端会话**：新增 `ssh_workspace_shell`，在同一 (主机, 会话名) 上维持一个
  POSIX `sh`，`cd`、导出的变量与后台任务跨调用保留。刻意不复用部署自带的
  persistent bash/pwsh 工具——那套工具按**本机方言**构造命令行，Windows 上是
  PowerShell，远端无法运行。
- **本机 ↔ 远端传输**：新增 `ssh_workspace_transfer`，经 SFTP 双向拷贝文件，分块
  流式、不经对话内容；上传先写同级暂存名再 rename 发布，目标文件在被替换前
  始终是旧内容或完整新内容。`recursive: true` 可上传整个本地目录树。
- **`ssh_workspace_exec` 支持后台任务**：`run_in_background: true` 返回 job id，
  输出进入任务环形缓冲，可用 `job_output` / `job_kill` 收集与终止。

### 变更

- **推送式变更监视**：远端有 `inotifywait` 时改用事件推送，变更即时上报且不受
  mtime 秒级精度限制；未安装或无法建立监视时自动回落到原有轮询（2s / 5s / 10s
  自适应退避）。监视通道断开后自动重新挂上轮询，不会静默失效。
- **能力探测**：挂载时一次性探测 `rg` / `git` / `inotifywait`，缺失项在工具返回
  与面板里给出提示，不必等踩到 127 或发现变更面板不工作才知道。探测结果按主机
  缓存，连接关闭时失效。
- **每主机传输选项**：新增 `agentForward`（远端命令用本机 ssh-agent 密钥认证，
  私钥不落到远端）与 `compress`（以 CPU 换带宽）。`~/.ssh/config` 的
  `ForwardAgent` / `Compression` 同样被识别，面板里可开关。

### 修复

- 端口转发的状态查询链路此前仍在运行但入口被注释，导致"功能已屏蔽"的判断
  与实际不符；本次一并澄清并恢复。

## [0.2.0] - 2026-10-14

### 新功能

- 新增 `POST /api/dsh-ssh-workspace/hosts/disconnect`：关闭指定别名的连接池连接；
  仍有在途操作时返回提示而不是强行断开。客户端主机卡片内联展示「已连接」状态，
  可按需断开。

### 变更

- HTTP 路由增至 10 条，`lifecycle` 套件的预期路由数同步更新。

## [0.2.1] - 2026-10-16

### 修复

- **exec 断连误判为正常完成**：通道 `close` 时既无退出码也无信号（`close(undefined)`）
  与 `close(null)` 同等视为传输中断，不再settle成"命令成功"。
- **rename 回退误删目标**：远端无 `posix-rename` 扩展时，`unlink` 目标前先 `stat`
  确认其存在，否则原样抛出 rename 错误，避免失败时误删无关文件。
- **`listDir` 串行 N+1 stat**：直接消费 `readdir` 返回的 `entry.attrs`，仅在缺失时
  回退 `stat`，目录列举从 1+N 次串行往返降为 1 次。
- **存储跨进程写入**：引入零依赖 `O_EXCL` 兄弟锁文件，`mutateHosts` 把读改写整体
  放进临界区；create / update / delete / rememberHostKey / forgetHostKey /
  encryptStoredSecrets 全部改走该路径。
- **`StreamTail` 重复 join**：缓存 join 结果，`push` 时失效，`readFrom` / `finalize`
  共用。

### 测试

- 新增 `tests/phase6-smoke.mjs`（36 项）与 `tests/store-lock-smoke.mjs`（15 项）。

## [0.1.24] - 2026-10-06

### 变更

- 包名由 `@dsh-community/dsh-ssh-workspace` 改为 `@shiqyka/dsh-ssh-workspace`，并加
  `publishConfig.access = "public"`，以便发布到 npm；`cordis.patch.yml` 的插件行
  名称与 `lib/client.js` 的 client 插件 id 已同步。安装时在插件管理界面填 npm 包名
  `@shiqyka/dsh-ssh-workspace`（也可填仓库地址）。

### 安全

- 存储中的密码与私钥口令改为**加密保存**：AES-256-GCM，密文写入 `dsh-ssh.json`
  的 `secrets` 段（按别名），密钥是 `$DSH_HOME/dsh-ssh.key`（`0600`）里的 32 字节
  随机值，首次保存凭据时生成；`auth` 字段不再携带 `password` / `passphrase`。
- 启动时自动把老版本留下的明文凭据加密回写进 `secrets` 段（best-effort，
  迁移条数写入日志），此后 `dsh-ssh.json` 不再出现明文。
- 密钥文件缺失或被更换时，连接明确报错并提示在面板重新保存该主机，而不是
  静默认证失败。

## [0.1.23] - 2026-10-01

### 修复

- 修复会话中 `@` 远端文件引用点击后预览报「读取失败：Maximum call stack size exceeded」：
  远端工作区根下的裸路径会在 `ctx.fs` 路由与本插件之间无限互相委派；`resolve` / `lstat`
  现统一经 `remoteSourceOf` 消化两种裸拼写（相对名继承远端 cwd、绝对 POSIX 名按别名映射），
  不再回递本地后端。

## [0.1.22] - 2026-10-01

### 安全

- 主机密钥 TOFU：首次连接记录指纹，之后不符即拒绝连接；新增 `hosts/forget-key`
  路由与面板「忘记主机密钥」入口。
- HTTP 路由增加 Host 头校验（仅接受回环地址）与 POST `Content-Type` 校验（非 JSON 返回 415）。
- 凭据存储文件 0600、目录 0700，临时文件随机命名；写路径（复制 / 删除 / 发布）
  接入 realpath 围栏校验。

### 修复

- `exec` 输出跨块 UTF-8 解码安全，按字节截断不再切坏字符。
- `exec` 连接断开且无输出时自动重连重试一次。

### 性能

- SFTP 元数据 1.5s TTL 缓存（仅读路径，写 / 删 / 挂载等主动失效）。
- 远端变更监视自适应退避（2s → 5s → 10s）。
- `streamText` 按需启用第二 SFTP 通道，大文件流式读取不占用共用通道。

### 工程

- 新增 `tests/` 脱敏冒烟套件与运行器、GitHub Actions CI、`package-lock.json`、`.npmrc`。
- 引擎连接参数可配（空闲超时 / 连接超时 / keepalive / 回收扫描间隔）。
- `package.json` 补充 repository / homepage / bugs 元数据。

## [0.1.21] - 2026-10-01

### 变更

- 端口转发功能整体屏蔽（面板、工具、公告、路由均注释保留，可随时恢复）；
  相关文档同步移除，本阶段不发布该功能。

## [0.1.20] - 2026-10-01

### 新增

- `@` 文件引用支持远端工作区：输入 `@` 即可搜索并插入远端文件路径。
- 文件进任务：侧边栏文件树支持拖拽到对话框，或右键「添加到任务」，以 `@` 引用形式插入。

## [0.1.19] - 2026-10-01

### 修复

- 修复 0.1.18 引入的工作区向上探测崩溃（报 `not a remote workspace path: "ssh://<别名>"`）：
  路径拼写桥接对裸别名 `ssh://<别名>` 回退原生实现，恢复探测的平静终止。

## [0.1.18] - 2026-10-01

### 新增

- 终端命令远程化：会话工作目录为 `ssh://` 时，命令以 POSIX shell 语义在远端执行，
  前台 / 后台任务、增量输出与取消等行为与本地一致。
- 远端文件搜索（ripgrep）与 git 变更追踪在远端执行。
- 远端变更监视（轮询式）。
- 大文件流式读取（分块惰性读取，跨块 UTF-8 安全）。
- 端口转发（本地监听 → 远端目标；0.1.21 起屏蔽）。

## [0.1.17] - 2026-10-01

### 新增

- 远程路径以 `@` 形式显示：工作区悬停卡片与文件面板路径标签显示
  `ssh://<别名>@/<路径>`（仅显示层，功能拼写不变）。

### 变更

- 发布文件脱敏：示例主机名与用户名替换为占位符；移除已废弃的第三方插件引用；
  README 与 docs 同步更新。

## [0.1.16] - 2026-10-01

### 修复

- 界面文案参数（如 `{ms}`）不再原样输出：插件改为注入 `locale` 服务。
- 对话页工作区按钮标记匹配修复（会话落地前按路径末段匹配、原地文本替换、
  整棵子树挂载时补齐扫描）。
- 连接测试结果 toast 调整为顶部居中显示。

### 变更

- 远程工作区标记图标放大并按图标边界裁剪，16px 下更清晰。
- 界面细节打磨：控件悬停 / 按下与焦点态、菜单与对话框入场动画
  （尊重 `prefers-reduced-motion`）、语义化按钮与空 / 加载态、数字等宽排版。
