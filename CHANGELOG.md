# 更新日志

本文件记录 dsh-ssh-workspace 的版本变更。0.1.16 之前的版本为未公开的本地迭代，未收录。

## [0.2.4] - 2026-10-18

> 0.2.3 的 tag 已推送，但该版本从未出现在 npm 上（`npm view` 当时 latest 仍为 0.2.2），
> 因此 0.2.3 与 0.2.4 的全部改动都在本版首次发布到 npm。

### 文档

- **新增 [docs/features.md](./docs/features.md)**：按能力域（工作区 / 文件读写 / 远端执行 /
  本机↔远端传输 / 端口转发 / 界面集成 / 主机与安全 / 配置项 / 降级矩阵 / 边界）列出
  完整功能清单。每项写清三件事：做什么、依赖什么、缺依赖时退化成什么样——降级不再
  散落在各专题页里靠读者自己拼。数字全部按当前源码与实测重新核对（22 条路由、
  10 个工具、4 个接管的 seam、23 个测试套件中活跃 18 个合计 663 项断言）。
- **清理内部流程文档**：删除 `docs/optimization-plan.md`（一次性安全扫描的修复清单，
  已完成）、`docs/roadmap.md`（候选功能待办）、`docs/_template.md`（写作模板）。
  这些是维护者自己的工作计划而非插件说明，留在文档集里会让读者把「已完成的待办」
  当成现状。三篇的结论已并入 features.md 与各专题页；根 README、`README.en.md` 与
  `docs/README.md` 的索引同步更新，不再有指向已删文件的链接。

### 新功能

- **端口转发持久化**：映射写入 `dsh-ssh.json` 的 `forwards` 分区，面板可开启 / 断开 /
  删除单条映射，并有「启动时自动开启隧道」总开关。核心是把**意图**（`enabled`，
  用户想要什么）与**事实**（`live`，当前是否真有 listener）分开存：按钮文案由事实
  决定，启动行为由意图决定，否则重启后连接尚未建立、按钮却写着「断开」就是谎报。
  已存映射强制严格端口模式——本地端口被占用就报错，不再静默漂移到临时端口，否则
  保存的 URL 会在下次启动时失真。新增 `POST /forward/probe` 做本地端口预检
  （`EADDRINUSE` / `EACCES` 分别给不同文案），但它只是提前告知原因，真正的权威
  仍是 `open()` 抛出的绑定错误。
- **面板列表上限**：主机、端口转发、已挂载工作区三个列表超过 5 条时改为滚动视口。
  上限高度按前 5 行的实测高度求和，不写死行高——行高会随描述、错误行、确认行
  以及面板宽度变化，写死会在一类行上露出半行、在另一类上只剩三行。没有溢出时
  不预留滚动条位置，渲染结果与加此功能前完全一致。
- **工作区停用 / 启用**：卸载改为**可逆**。默认的 `detach` 模式保留 DSH 工作区记录
  （侧边栏那一行仍在，置灰），该工作区的**会话也原样保留、不归档**——保留分组却归档
  内容，等于留下一个点开是空的标题，比删掉更让人困惑。勾选「同时删除工作区记录」
  才归档会话，用 DSH 原生 `workspaceRegistry.archiveSession()`：会话从列表隐藏但文件
  与记账槽位都不动，`unarchiveSession` 能把它们放回原位。没有引入任何新依赖，也没有
  绕过服务层去 unlink 会话日志（那是不可恢复的，而 DSH 并没有公开的删除会话 API）。
- **停用即全局停机**：停用的工作区对**除 SSH 连接外的一切操作**都被拒绝——读文件、
  列目录、写、变更监视、执行命令、开终端、glob / grep / git、文件传输。围栏挂在
  `engine.disabledWorkspaces` 上，在 `ctx.fs`、内建 fs 桥、`ctx.shell`、
  `ctx.subprocess`、终端接管层与两条传输路由里同时生效，且都在建立连接**之前**
  拒绝。主机面板、不带 cwd 的 `ssh_workspace_exec`、端口转发照常可用。
  刻意保留的例外：内建桥的 `stat` / `lstat` / `realpath` 不挡，因为 DSH 的 registry
  用它们做会话身份探针，在那里制造失败会让它把会话从工作区记账里剪掉——卸载一个
  工作区不该顺手改写它的会话归属。
- **`ssh_workspace_enable`**：新增工具与 `POST /enable` 路由，重新挂载并取消归档。
  启用前会 `stat` 验证远端目录仍存在，避免得到一个「看起来在服务、实际 ENOENT」
  的工作区。

### 变更

- `ssh_workspace_unmount` 的 `deregister` 默认值由 `true` 改为 **`false`**（即默认
  `detach`）。旧的 `deregister: true` 仍被识别为 `deregister` 模式，不会静默降级。
- `ssh_workspace_unmount` 参数新增 `mode` 与 `archiveSessions`，返回新增 `mode`、
  `archived[]`、`archiveFailed[]`。
- **`forget` 归一化为 `deregister`**：两者做的是同一件事，保留一个近乎重复的第三种
  模式正是「面板能为一台已不存在的记录提供启用按钮」这个缺陷的成因。旧拼写仍被接受，
  不再各自漂移。
- **「同时删除工作区记录」现在两边一起删**：删记录让侧栏那一行消失，同时清掉持久停用
  清单与运行时围栏，使面板那一行也消失。只删记录会留下「面板挂着启用按钮、实际任何
  地方都不存在、运行时还拒绝一切操作」的死状态。
- **卸载的两种后果只写在「卸载」按钮的悬停提示里**，不再在确认行里常驻一行说明：
  未勾选则工作区记录与会话都保留（左侧那一行仍在、置灰、随时可重新启用），勾选则
  工作区记录被删除、会话归档。展开确认行后「确认卸载」沿用同一个 `title`——那正是
  弹窗消失、提示最该在场的时刻。原 `mounted.removeRecordHint` 随之删除（复选框与
  按钮说的是同一件事，两处文案必然会漂移）。
- **断开主机与手动断开端口现在完全一致**：`hosts/disconnect` 改走
  `SavedForwardManager.closeAlias()`，逐条调用与端口行「断开」按钮相同的方法，因此
  映射保留、`enabled` 置为 `false`、`failures` 不记任何原因。此前它复用连接掉线的
  路径（`closeForAlias`），留下 `enabled: true` 与 `"SSH connection closed"`，面板据此
  渲染红字「连接已断开」——把用户主动执行成功的操作报成故障，还附带「启动时自动开启
  隧道」的暗示（用户刚刚明确关掉了它）。toast 也改为「已断开连接，同时关闭 N 条端口
  转发」，N 来自响应的 `closedForwards`；未装配 `SavedForwardManager` 时仍回退到旧
  路径（那时没有「意图」可关）。
- `ssh_workspace_status` 返回新增 `disabled[]`（已停用工作区）。
- `/status` 响应新增 `disabled[]`；浏览器端据此把侧边栏对应行置灰，**并让那一行的
  按钮不可点**（`pointer-events: none`）。置灰只是装饰，真正拒绝点击的是这条规则；
  用 CSS 而不是拦 DSH 的点击处理器，是因为后者会在宿主改版时崩。侧栏那一行本身
  仍可点击——展开分组是访问其会话的唯一途径，而 `detach` 明确保留了那些会话。
- `/status` 的 `workspaces[]` 新增 `sessionIds`，侧边栏里**停用工作区的会话行也一并
  置灰且整行不可点**。会话行是 `session:<id>`，本身不携带任何工作区信息，所以成员
  关系必须由服务端随响应下发；否则只有分组标题变灰，它下面的每个会话仍然是活的，
  而它的工作区围栏已经关死。
- **`archiveSessions` 的默认值改为跟随模式**：`detach` 不归档、`deregister` 归档，
  显式传值仍然优先。旧默认是「除非显式 false 否则一律归档」，于是不勾选「同时删除
  工作区记录」时也会把会话藏起来——而 `detach` 保留了工作区分组，等于把用户特意
  保留的那个分组清空：行还在，点开却是空的。
- **`POST /test` 改为探测后释放连接**：测试连接回答的是「这台主机是否可达」，不是
  「替我连上」。响应新增 `released`；被端口转发 `holds` 钉住的连接不会释放（响应带
  `heldBy` 说明原因），因为在那里拆连接会掐断用户没要求关闭的隧道。
- **`POST /hosts/disconnect` 连带拆除该主机的端口转发**：连接自身的 `close` 事件
  也会拆，但那不是可靠路径（client 被 `destroy()` 而不发事件、连接被替换、测试替身
  不实现事件）。改为按 alias 显式拆除，响应新增 `closedForwards`。

### 修复

- **停用工作区的会话没有置灰、仍然可用**：侧边栏只给工作区标题那一行打了标记，
  而会话藏在 `session:<id>` 行里，那条行**不携带任何工作区信息**，客户端无法自己
  推断归属。于是标题变灰、下面每个会话照常可点——围栏已关死、会话却是活的，是最
  糟的组合。修法分两处：`/status` 的 `workspaces[]` 下发 `sessionIds`（服务端本来
  就持有），客户端在收集工作区时把停用者的成员 id 一并记入 `disabledSessionIds`，
  再对 `[data-row-key^="session:"]` 行同样打标记。CSS 按行键分层：工作区标题只让
  按钮失效、标题本身仍可展开（那是看清「保留了哪些会话」的唯一途径），会话行则
  整行 `pointer-events: none` 并补 `setElementInert`（行本身就是「打开会话」那个
  控件，只灰按钮等于把唯一要紧的动作留着）。⏻ 图标只给标题，否则每行会话都盖一个，
  读起来像「N 个开关」。
- **客户端 bundle 语法错误也能全绿通过**：`client-shape-smoke` 的所有断言都把
  bundle 当**文本**读，一个解析不过的文件照样满足它们全部——这真的发生了（CSS 模板
  字符串里一个游离的反引号提前结束了字面量，整套件仍报 23/23）。新增 `node --check`
  解析检查（只解析不执行，保持零依赖），并先验证它确实能抓到那个故障。
- **HMR 重复插入**：向输入框拖入一个文件会生成约 22 个同样的 chip。根因是每次
  重新加载模块体都会新增一组 `document` 监听，而旧的监听并不会随旧闭包回收。
  改为把「已处理事件」集合挂在全局并以事件对象为键，一次派发只被消费一次；
  同时 `apply()` 返回 disposer 拆除监听。
- **本地化词典未更新**：`forwards.autoStart` 等新键渲染成原始键名。根因同上——
  重复 `register` 抛错被 `catch` 吞掉，`bind` 继续服务**旧**词典。改为经
  `ctx.effect` 注册以便随实例拆除，并让 `translate` 在拿到原始键名时回落到本地
  zh 表。
- **`.sshwsp-empty` 规则被误删**：列表改造时把这条规则一起删掉了，所有空态 /
  加载中 / 错误占位符静默失去内边距与居中。已恢复，并新增一条**渲染类 ↔ 样式
  声明一致性**检查防止再退化。
- **`ssh_workspace_enable` 会被自己的围栏挡住**：工具用 `engine.fs.stat()` 验证远端
  目录，而 `engine.fs` 正是那层围栏——它会拒绝停用工作区内的任何读取，于是「启用」
  在结构上不可能成功。改为走原始连接（`engine.withSftp`）直接 `stat`，与 HTTP 路由
  的做法一致。`ssh_workspace_mount` 有同一处问题：重新挂载一个已停用的工作区是复活
  它的常规方式，同样必须绕过围栏探测。两条都加了回归测试，并验证过把修复回退后
  测试确实变红。
- **`forget` 模式只清清单、不清围栏**：该模式删掉工作区记录后只调用
  `enableWorkspace()` 清持久清单，却没有 `enableRoot()` 摘掉运行时停用标记，于是留下
  一个「面板里已无这一行、运行时却仍拒绝一切操作」的工作区——而「启用」按钮恰好长在
  `forget` 清空的那份停用列表上，用户无从恢复。补上 `enableRoot()`，并加了回归测试
  （先写测试确认它变红，再修）。此缺陷随 `forget` 归一化一并覆盖到 `deregister`。
- **启动 DSH 会把所有已挂载工作区的主机连上**：`fs-shim` 的 `stat` / `lstat` /
  `realpath` 原本一律经 `engine.withSftp()`，而它内部的 `engine.acquire()` **就是建立
  连接**。这三条是被宿主主动调用的：`WorkspaceRegistry` 在 `init` 阶段对每个会话
  header 的 cwd 做 `realpath` + `stat`，侧边栏渲染时还会问每个工作区的状态。于是
  用户离开时全断开的状态，重启后被自己的元数据查询反向"打开"了。改为按**有没有活
  连接**分岔，判活看 `engine.pool` 而不是 `acquire()`：有连接时取真实属性（远端已
  删除仍会 `ENOENT`），无连接且路径在已挂载根内时给出词法 / 合成答案，无连接且在
  根外时 `ENOENT`。新增 `tests/probe-smoke.mjs`（15 项）直接数 `withSftp` /
  `acquire` 调用次数，把判活改回 `acquire()` 后 6 条变红。
- **`detach` 会把会话藏起来**：见「变更」里的 `archiveSessions` 默认值——保留工作区
  记录却不保留它的会话，等于把用户特意保留的分组清空。

### 测试

- 新增 `tests/forward-persist-smoke.mjs`、`tests/insert-once-smoke.mjs`、
  `tests/locale-register-smoke.mjs`。
- 新增 `tests/peer-stubs.mjs`：`DSH_CORE_ROOT` 未设置时自动生成最小 peer stub
  根，让依赖 `routes.js` / `remote-fs.js` 的套件真正**运行**而不是跳过。跳过
  的套件无法失败，而正是这样一次跳过让一个调用了未导入函数的 upload 处理器
  绿着发了出去。需要真实框架的三个套件（`lifecycle` / `boot` / `tool-schemas`）
  仍会明确 SKIP 并给出原因。
- 新增 `tests/detach-smoke.mjs`（62 项）：停用清单的读写与脏数据退化、路径包含判定、
  `ctx.fs` 十个方法逐个断言被拒、重新启用两条路径、shell / terminal 拒绝且**没有
  打开任何连接**、工作区外与别的 alias 必须照常可用、跨分区写入不互相覆盖、
  以及「启用 / 重新挂载不得经过围栏探测」这条回归。
- 新增 `tests/probe-smoke.mjs`（15 项）：内建桥的三条身份探针在**无活连接**时不得
  拨号、在挂载根外必须 `ENOENT`（不能凭空报"是目录"，那会把无关会话挂到这个工作区）、
  有活连接时仍取真实属性、活连接报缺失时必须透出 `ENOENT`、以及 broken 记录不算连接。
  断言方式是直接数 `withSftp` / `acquire` 的调用次数——"没有拨号"这件事只能这样证明。
  `routes-smoke` 增至 118 项（两种卸载模式、`detach` 不归档而 `deregister` 归档、
  显式 `archiveSessions` 优先、归档失败上报、启用流程、`deregister` 与
  `forget` 都必须同时清掉清单与围栏、`/status` 必须下发 `sessionIds` 并强制转字符串、
  缺字段退化为空数组、新路由的回环围栏、测试连接必须释放连接且被转发
  钉住时不释放、断开必须连带拆除该主机的转发、**断开主机必须走 `closeAlias`
  而非 `closeForAlias`**、关闭转发不得断开主机）。
  `forward-smoke` 增至 34 项，新增 `closeForAlias` 的按主机拆除与**只拆该主机**的断言。
  `forward-persist-smoke` 增至 102 项，新增**两条断开路径逐字段一致**的断言：比对
  `live` / `enabled` / `error` 三元组（面板正是靠这三个字段决定渲染），以及
  「主动断开不得留下任何可解释为故障的原因」。
  五条新行为都做过反向验证：把修复回退后对应断言确实变红（分别 4 / 3 / 4 / 2 / 1 条）。
- `client-shape-smoke` 增至 57 项：新增一组**行为**测试（把 `collectRemoteWorkspaces`
  抽出来真跑，断言停用工作区的会话进集合、在服务的不进、缺 `sessionIds` 不抛错）——
  原 bug 是漏了一条赋值而非漏了一个名字，grep 抓不到；另增 `node --check` 解析检查，
  因为此前所有断言都把 bundle 当文本读，一个语法错误的文件照样全绿。再增一组悬停
  提示的断言：中文提示必须同时写出「未勾选 → 保留」与「勾选 → 删除并归档」两个分支，
  英文提示单独按自身文本校验（`archived` 在别的键里也出现，按整包 grep 抓不到它
  只写了可逆那半），提示必须挂在「卸载」与「确认卸载」两个按钮上，且不得在行内
  另起一行重复同一句话。三条都做过反向验证：把旧文案放回去后 2 条变红，把常驻行
  加回去后「not duplicated」变红。
- `lifecycle` 期望路由数 21 → 22、工具数 9 → 10；`boot-smoke` 在真实主机上验证
  挂载 → 停用 → 读被拒 → 启用 的完整往返；`tool-schemas` 增至 160 项。
- 全套 `node tests/run.mjs` **23/23** 通过。

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
