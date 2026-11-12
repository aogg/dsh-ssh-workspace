# 更新日志

本文件记录 dsh-ssh-workspace 的版本变更。0.1.16 之前的版本为未公开的本地迭代，未收录。

## [0.3.0] - 2026-10-29

### 新增

- **Agent 提示词三级配置（全局 → SSH 主机 → 工作区）**：面板可为三级分别配置 glob 模式（命中 dsh 本机 md 文件即加载）与脚本条目（在本机执行，stdout 输出 `{"files":[…]}` 或裸数组指定要加载的 md），合并为该远程工作区内所有会话的系统提示词，每个文件严格按 `----[<绝对路径>]---start … ----[<绝对路径>]---end` 包裹、同文件跨级去重（保留首次）。每条配置有内容派生的稳定 id，下一级可按 id 整条禁用上一级条目（不是覆盖），三个配置入口（面板全局设置区、主机新增/编辑对话框折叠区、已挂载工作区行按钮）都能看到上一级条目并一键禁用/恢复；「预览展开结果」即时展开并列出文件与告警（脚本失败/坏 JSON/超时都是可读告警，不炸合并与面板）。存储扩展 `dsh-ssh.json` 新增顶层段 `agentPrompts`（向后兼容：旧文件无该段行为不变，`hosts`/`secrets`/`knownHosts` 不受影响；主机改名自动携带其配置、删除主机随之清理）。注入走 dsh 本体 `systemPrompt.section` 动态 section（`text` 每个模型步求值，按会话 cwd 匹配最长已挂载根），保存后运行中的会话下一个模型步自动生效；合并结果按（工作区，配置内容哈希）缓存。新增 5 条面板路由（`agent-prompts`/`global`/`host`/`workspace`/`preview`）、`lib/agent-prompts.js` 与两个冒烟套件（`agent-prompts` 66 项、`agent-prompts-routes` 23 项），专题文档见 [docs/agent-prompts.md](docs/agent-prompts.md)。

## [0.4.0] - 2026-11-10

### 新增

- **自动注入技能 `local-exec`（本机执行不走 SSH）**：插件经宿主 `skills.register` 向**模型技能目录**自动注册 `local-exec` 技能（`source: 'runtime'`、`invocation: { modelInvocable: true, userInvocable: false }`——输入框技能菜单不显示，仅模型目录可见、skill 工具可加载）。正文讲清「命令落点由 bash / pwsh 的 workdir 决定」：会话工作区是 `ssh://` 时显式传本地 workdir（如 `/tmp`）即在本机执行、不过 SSH，并覆盖通道辨析（`ssh_workspace_exec` / `ssh_workspace_shell` 明确远端、glob/grep 桥仅白名单 rg/git、终端 cwd 决定落点）、围栏（read-only 拒一切远端执行而读取不受影响、本机命令仍按本机模式围栏、远端命令以远端登录用户全权运行）、端口转发两方向与易错点（远端命令别引本机路径、临时文件各归各主机、远端通道不是绕过沙箱的手段）。注册防御式探测 `ctx.reflect.get('skills')`：服务缺失或 register 抛错只 `logger.warn` 并跳过，绝不炸插件加载；disposer 显式注销并复位结论 sink。系统提示公告的 workdir 段落新增一行指向该技能。新增只读路由 `GET /api/dsh-ssh-workspace/skill`（返回技能 name / description / whenToUse / content；未注册时返回明确的 `registered: false` 状态而非报错），面板「自动注入技能」只读折叠块展示名称 / 描述 / whenToUse / 正文（中英 i18n）。新增 `lib/local-exec-skill.js` 与冒烟套件 `skill-local-exec`（53 项），不加任何新配置项、常开。

- **浮动远端工作区（工作区 ⋯ 菜单 →「SSH 远程工作区 ▸」）**：一个项目需要多条 SSH 远端时，不必让它们各占一行侧栏——在该项目工作区行的 ⋯ 菜单里配置，条目挂在**该项目**名下（存父工作区 id），选中后一个**不透明卡片**从左侧滑入、盖住侧栏工作区列表，卡片顶部是插件画的头部条（`浮动` 徽标 + 配置名 + `alias@host` + 关闭 ×），卡内是该工作区的**原生行**（工作区行 + 会话行），因此新建会话、⋯ 菜单、重命名、删除、归档、收藏、拖拽与其它插件注入的菜单项全部照旧；已按普通方式挂载的 ssh 工作区保持原样。非浮动时该远端的工作区行与会话行从正常工作区列表隐藏（属性 + 一条 `!important` 规则 + MutationObserver 自愈），工作区选择器菜单行与会话页 hero 按标题隐藏。菜单块**只追加在官方菜单末尾**（带 marker 防重、注入后视口夹取），ao-local / better-sidebar 已注入的项原位保留；aria 模板/行键改版时捕获不命中，菜单原样、绝不坏页。添加对话框**没有名称输入框**（自动命名 `目录名 · 主机别名`，同父重名追加 ` #2`），管理面板支持改名（只改配置 title）、上移下移、测试连接、删除（可勾选同时注销该 DSH 工作区，走与「卸载」同一条 `deregister` 路径）与清理失效条目；添加/管理对话框注册在 `shell.overlay` 槽，不依赖侧栏面板。`dsh-ssh.json` 新增顶层段 `floating`（坏值降级为空数组，不影响 `hosts` 等既有段），新增 5 条路由（`floating/list`、`save`、`update`、`delete`、`reorder`，均带 mounted / registered / hostMissing / parentMissing 等 join 状态），新增 3 个冒烟套件（`floating-store` 59 项、`floating-menu` 37 项、`floating-display` 50 项），专题文档见 [docs/floating-workspaces.md](docs/floating-workspaces.md) 与 [docs/被扩展说明.md](docs/被扩展说明.md)。
- **主机别名标签（`aliasTag`，工作区名称下方的小标签）**：SSH 主机新增/编辑对话框新增「在工作区名称下显示主机标签」开关（**默认关**）。开启后，侧栏中凡是挂载自该主机的远端工作区行，其**工作区名称下方**显示一枚小标签，内容为该主机别名——多台主机的工作区挤在同一侧栏时分辨归属。标签为小号字体（10px）圆角药丸，样式跟随宿主主题变量（暗色自动适配），超宽省略号截断、`title` 悬停提示完整别名；带标签的行由 CSS 放开固定行高自然长高容纳第二行，不裁字、不压相邻行。实现走既有 `passRemoteMarks` 行装饰通道（MutationObserver 自愈、防重 marker 幂等、行复用原位改写）：别名沿 id / title / basename 三种行身份拼写落映射（与按 OS 分形同构），标签文本存 `data-sshwsp-aliastag` 属性、由 CSS `content: attr()` 渲染成空 span——绝不让真文本污染标记层赖以匹配行的 `row.textContent`；`/hosts` 拉取时机与 OS 分形相同（面板 `refresh()` + boot），改名 / 关开关后下次重绘刷新或零残留撤除。同主机的每个工作区行都有标签；浮动远端卡片显示的正是同一张原生行，随通道一并生效。字段全链路：store 校验（存在时必须为 boolean）/ normalize（缺省不落盘 `false`）/ merge（编辑器总发布尔，勾掉即删键）、`GET /hosts` 行返回（编辑器回显）、`hostSave` payload 白名单。`host-os-smoke` 新增 7 项（store 三态语义与坏值校验、`GET /hosts` 开关回显、`hostSave` 白名单与缺省关闭），`os-marks-smoke` 新增 14 项（`/hosts` 回复吸收白名单、别名身份落表、药丸插入 / 幂等 / 原位改写 / 零残留清除、textContent 不被污染、接线标记），文档见 [docs/hosts.md](docs/hosts.md) 与 [docs/ui.md](docs/ui.md) 的「主机别名标签」一节。

### 修复

- **浮动远端二级子菜单每次打开都「刷一下」**：⋯ 菜单里的「SSH 远程工作区」展开路径此前是「先整树清空重建（`sub.textContent = ''`）→ 后台刷新回来再整树重建一遍」，页面刚加载时还会先画「还没有配置」空态再翻成真条目，一次打开最多打两次 `/floating/list`（注入一次 + 展开一次）。现在三层修掉：① 条目列表写入 localStorage 缓存（`dsh-ssh-workspace:floating:v1`，版本化 key），客户端启动读回 `floatingStore`（`loaded = true`），首帧直接画上次数据，不再有空态→真条目的翻转——缓存只做显示提示、绝不作为操作依据，读写全程 try/catch 静默忽略（隐私模式 / 超配额 / 坏 JSON），fetch 失败仍保留上次数据；② `renderFloatingSubmenu` 先算廉价签名（条目 id / 标题 / `alias@host` / 状态徽标 + 浮动中状态），与屏上相同直接 return（DOM 节点身份不变、零可见变动），变了才离屏构建完整行数组、一次同步替换，子菜单不会被看到「先清空再重建」；③ boot / 菜单注入 / 展开子菜单共享同一个 in-flight 请求（stale-while-revalidate，一次打开一个请求），加 / 删 / 改名 / 排序 / 选中挂载等写路径用 `{ force: true }` 绕开共享，且只有最新发起的请求能写 store 与缓存（乱序回复直接丢弃）。`tests/floating-menu-smoke.mjs` 新增 localStorage 桩与 13 项断言（有缓存首帧即真条目、未变刷新不替换 DOM、变化时替换为新内容、写失败 / 读被拒 / 坏载荷静默不影响功能、并发共享与 force 绕开）。文档同步见 [docs/floating-workspaces.md](docs/floating-workspaces.md) 的「刷新：缓存 + 单次请求 + 无闪动重绘」一节。
- **浮动远端「添加」对话框不校验目录可写性**：`/ls` 早已返回 `writable`，但浮动添加对话框只看 `entries`，`writable: false` 的目录照样能存成配置，选中挂载后 Agent 第一次写文件才失败。现在按侧栏「新建远程工作区」对话框的既有口径：不可写时目录区显示红色警告（复用 `remote.notWritable` 文案）并禁用保存按钮，切主机 / 切目录都按对应 `/ls` 回复更新（加载中与出错不判可写，只有显式 `false` 才是否决）；同时删掉该对话框里没用的 `hostEditable`。`tests/floating-menu-smoke.mjs` 新增 8 项源码契约断言。文档同步：`/mount` 只校验目标存在且是目录（可写性不参与挂载判定）、改名去重范围是同一父工作区下的其它条目、补「单列表」（flat）视图的隐藏与卡片边界。
- **工作区标记按主机操作系统分形**：主机钉了 `os` 后，远端工作区在侧栏行、工作区选择器、会话页 hero 按钮、面板「已挂载的工作区」行的标记不再一律是通用双箭头——`win` 画四块圆角窗格、`mac` 画 ⌘ 命令键环形方、`linux` 画终端提示符 `>_`。React 图标与 DOM 装饰共用一份形状表（`OS_MARK_SHAPES`），钉值改动时标记 svg 按 `data-sshwsp-os` 原位替换而非残留旧形。OS 数据从 `ssh://alias/…` 路径解析别名、以 `/hosts` 的钉值建映射（只收 win/mac/linux 三值，未钉条目与 `~/.ssh/config` 回退主机保持通用标记）；拉取时机为面板 `refresh()`（编辑器保存即生效）与插件 boot 各一次。新增 `tests/os-marks-smoke.mjs`（36 项：别名解析、映射白名单、身份多拼写的 os 落表、形状表出形、钉值改动替换、接线标记）；`dialect-smoke` 与 `client-shape-smoke` 改为不再依赖开发者本地 store（注入隔离 store / 空映射沙箱）。
- **主机操作系统字段（`os`，win / mac / linux）**：主机条目新增可选 `os` 字段，钉死远端登录 shell 的命令方言——`win` → cmd.exe、`mac` / `linux` → POSIX shell，exec / 持久 shell / 终端 / 子进程桥 / 能力探测直接按它分派，不再发探测命令。面板主机编辑器新增「操作系统」下拉（Linux / macOS / Windows / 自动），**新建主机默认 Linux**；主机卡片的 meta 行显示当前生效值。兼容语义：缺省（老条目、手写条目、`~/.ssh/config` 回退）=「自动」，保持按连接探测的既有行为——一台探测出 Windows 的旧主机不会因为字段上线而翻车，编辑器里这类主机也先显示「自动」而不是默认 Linux，防止顺手一存就把方言钉错；选「自动」保存即删除字段、回到探测。保存时接受常见别名（`windows` → `win`，`macos` / `osx` / `darwin` → `mac`），认不出的值视为未设置不落盘。新增 `tests/host-os-smoke.mjs`（43 项），文档见 [docs/hosts.md](docs/hosts.md) 与 [docs/tools.md](docs/tools.md)。
- **局域网部署支持（`allowLan`）**：新增插件配置 `allowLan` 与可选 `allowedHosts`。`allowLan` 是**三态**（`lib/access-policy.js` 的纯函数 `resolveAllowLan`，决策可被测试直接执行）：显式 `true` / `false` 优先，缺省时跟随 `webserver.host`——绑 `0.0.0.0` 视为开启（绑全接口本身就是「允许被别处访问」的表态），绑回环或没有 webServer 时保持仅回环；所以已经监听全接口的部署不会因为少写一个开关就让面板每个请求都 403。默认模式的行为与文案逐字节不变（`forbidden: loopback-only` / `forbidden: unexpected Host header …`）。开启后来源地址放宽到私网段（IPv4 RFC1918、IPv6 ULA/链路本地，公网仍拒），`Host` 头接受三类值：本机真实网卡地址 + 端口（`os.networkInterfaces()` 收集，回环拼写始终有效）、`allowedHosts` 里配置的额外值（局域网主机名、反代拼写等）、以及**私网 IP 字面量**（IPv4 可带端口；IPv6 带方括号、可带端口）——Docker `-p` 端口映射 / `ssh -L` / 反向代理下浏览器发的是**宿主**的地址（例如 `172.19.0.199`），而容器只看得见自己的网卡（`172.21.0.199`），按「必须是本机网卡地址」判定时这类部署会被全拒。**主机名仍只认 `allowedHosts`**：rebinding 页面必须把自己的域名当 `Host` 发送，那个域名不在任何白名单里，所以防 DNS-rebinding 语义不变；公网 IP 字面量仍拒。被拒绝的请求另写一条 `ctx.logger.warn`（mode / 来源地址 / `Host` / 修复建议），响应体保持历史措辞。
- **「新建本地工作区」的应用内浏览降级**：宿主组合的是 browse 目录选择后端（只有 `list` / `createDirectory` 原语）时，「新建本地工作区」此前每次都先调原生 `pick` 动词、失败后把「directory picker failed: … needs the native capability; the composed picker serves "browse"」弹成 toast。现在改走带结构化错误的 Remote 命名空间，识别 `directory-picker/unavailable` 后切换到应用内「选择本地目录」对话框（逐级浏览、就地新建文件夹、确认选择，样式与现有对话框一致，中英文案齐全）；能力类型记在模块内，后续打开直接走对应交互，不再先失败一次。`globalThis.__DSH_DIRECTORY_PICKER__` 桌面桥仍是最优先，pick 成功或其他错误码时行为不变。

### 修复

- **`ssh_workspace_exec` 0ms 秒崩 `Cannot read properties of undefined (reading 'allowHalfOpen')`**：`runRemoteCommand` 在非 agent-forward 分支给 ssh2 的 `client.exec` 传了 `undefined` 当选项，而 ssh2 无条件读取选项包里的 `allowHalfOpen`，于是所有主机的快照命令一进通道就崩（上一版把回调放在选项位置、ssh2 兜底成 `{}` 才侥幸不崩）。现在非转发分支显式传 `{}`，转发分支保持 `{ agentForward: true }`。
- **Windows SSH 主机命令结构性全灭（按主机探测 shell 方言）**：Windows OpenSSH 默认登录 shell 是 cmd.exe，此前远端命令 / 持久 shell / 终端 / 子进程桥全部写死 POSIX 语法（`export PATH=…`、`sh -l`、`command -v`），一上 Windows 主机就报 `'export' 不是内部或外部命令` 或 `the remote shell closed`。现在引擎按连接探测登录 shell 方言（`echo %COMSPEC%`：cmd 展开成 Windows 路径、POSIX shell 原样回显；结果缓存在连接记录、重连重探；探测失败或 PowerShell 默认 shell 按 POSIX 兜底，不炸通道），并按方言分派：`ssh_workspace_exec` 带 cwd 用 `cd /d "D:\path"`；能力探测 cmd 主机走 `where`；子进程桥脚本（glob/grep 的 rg、变更追踪的 git）cmd 拼法为 `set "K=V"` + `if not exist … mkdir` + `where` 存在性检查 + 非 `exec` 调用；持久 shell 与 ssh:// 终端在 Windows 主机开 `cmd.exe`（`cmd /k cd /d` 先切目录再保持交互），退出标记 cmd 用 `%ERRORLEVEL%` 单独成行取回。PowerShell 默认 shell 的主机不适配（见 docs/tools.md 的 Windows 能力表与限制）。
- **`ssh_workspace_hosts` 输出炸 lossless JSON（`value is not lossless JSON`）**：`rows()` 给 ssh-config 来源的行带 `description: undefined`，lossless-JSON 编码对 undefined 值判非法；工具现在返回前剔除值为 undefined 的字段（schema 里 `description` 本就可选，缺失即不出现），并把行里早就在、却不在输出 schema 里的 `agentForward` / `compress` 两个布尔补进 schema。
- **ssh:// 工作区内 Windows 盘符绝对路径被当相对段**：`path.resolve` / `path.join` 的远端折叠除 POSIX 绝对参数外不认 `D:/x`——`join` 把盘符参数按相对段拼成 `ssh://win/D:/…/D:/…`，`resolve` 把它重置到本地世界丢掉远端上下文。现在已建立远端基底时，盘符绝对参数按**该主机**的远端绝对路径处理（Windows 主机工作区本来就根在 `/D:/…`，`D:\code\x` 归一为 `/D:/code/x`）；UNC（`\\srv\share`）与无远端基底时保持原「重置到本地」行为。
- **点「新建本地工作区」报 `cannot get property "remote" without inject`**：浏览降级改造新增的 `ctx.remote.directoryPicker` 访问点没有在客户端工厂的 cordis inject 声明里登记，而 cordis 对未声明的属性读取直接抛错（可选链也躲不掉，抛错发生在 getter 里）。现在 inject 数组补上 `'remote', 'remote.directoryPicker'`（对齐 dsh-client-ui-workspace 的声明方式）；同一个 apply ctx 覆盖 `makeLocalPicker` 与 `LocalDirectoryBrowser` 两个访问点，声明一次即可。
- **勾选「转发 ssh-agent」后目录浏览不可用**：引擎此前把 `agentForward` 塞进 ssh2 的连接级 config，而 ssh2 会把连接级该字段当成整条连接的转发许可——连接上没有配置 agent（key / password 认证正是如此）时 `connect()` 直接抛 `You must set a valid agent path to allow agent forwarding`，连接建不起来，SFTP 浏览随之全挂；即便有 agent 也会把转发请求加到包括只读 SFTP 在内的所有通道上。现在连接级不再携带该字段：转发意图记在连接记录上，由统一的 `channelExecOptions` 只在 exec / shell 命令通道上表达（快照 exec、`openChannel` 的监视器 / 终端 / 持久 shell、shell 与 subprocess 路由全部走它），SFTP 路径不受影响；需要转发而连接上没有 agent 时（key / password 认证）会探测本机 ssh-agent 并挂上（配置的密钥 / 密码仍是第一认证方式，认证类型不变），本机没有 agent 时转发空转、连接照常；agent 认证且无 ssh-agent 的明确报错保持不变。
- **`local-exec` 技能正文不再引用不存在的 `ssh_workspace_reverse_forward`**：正文④节原写反向（本机 → 远端，`ssh -R` 语义）转发「部署提供 `ssh_workspace_reverse_forward` 工具时可用」，但插件注册的模型工具只有 10 个 `ssh_workspace_*`（hosts / mount / unmount / enable / status / exec / transfer / shell / forward / unforward），其中没有 reverse_forward，`lib/forward.js` 也只实现「远端端口 → 本机 localhost」（`ssh -L` 语义）一个方向——那是一条悬空引用，模型照正文点名调用只会得到「工具不存在」。现在④节如实表述：本插件不提供反向（本机 → 远端）转发工具，远端侧要访问本机服务属于网络层问题（如远端经局域网直达本机 IP），不经本插件解决；节标题随之从「端口转发的两个方向」改为「端口转发的方向」。仅技能正文文字修正，运行行为无变化。

## [未发布]

### 新增

- **Niubash 载荷化（打包自动拉取官方最新便携包）**：新增 `scripts/stage-niubash.mjs`（npm `prepack` 生命周期，另暴露 `npm run stage:niubash` 便于手动执行）：向 GitHub 拉取 unixwin/niubash 的**最新 release** 的 win-x64 便携包资产（资产名 `niubash-v*-win-x64.tar.gz`），校验后 stage 进包内 `runtime/niubash/`（归档 + 生成的 `manifest.json`）。manifest 由打包脚本生成：`url` / `releaseTag` / `version` / `assetFile` / `sha256` / `bytes` / `stagedAt`，另加 `executableRelativePath` 与 `executableSha256`（打包时本地解包一次算出 bash.exe 摘要再写进 manifest，另含 pin 需要的 name / platform / arch / upstream / upstreamUrl / extractor / prefix）。**幂等与离线**：`runtime/niubash/` 里已有归档且与 manifest 一致 → 跳过下载；`--dry-run`（`npm pack --dry-run` 自动设置的 `npm_config_dry_run`）时**绝不联网**，只校验已 stage 内容（缺失时提示并以 0 退出，保证 `npm run check` 离线可过）；环境变量 `NIUBASH_ARCHIVE` 可指向本地归档跳过下载（镜像场景）；缺归档且不能下载时真实打包**明确报错**退出——绝不静默跳过导致包里没载荷。`package.json` `files` 白名单加 `runtime/`，`.gitignore` 排除 `runtime/`（33MB 级构建产物不入库）。`lib/bash-payload.js` 改造：pin 从「硬编码 v1.5.0 常量」改为「**优先读包内 `runtime/niubash/manifest.json`**（打包生成，`resolvePayloadPin()` / `resolvedPayload()`）」，manifest 缺失（开发者裸仓库）回退现有 v1.5.0 常量 + 在线下载逻辑；部署载荷来源顺序变为 `payloadPath` 本机副本 → **包内暂存归档**（digest 对 manifest 一致时直接使用，打包后的插件部署**完全离线**）→ 在线下载；部署校验链保持 归档 sha256 对 manifest/pin → 解包 → bash.exe sha256 对 manifest → 上传 → 远端 `--version`；新增 `listBashTarGzMembers`（打包侧形状发现：公共根 prefix + bash.exe 相对路径与摘要），运行时权威解析 `readBashTarGz` 不变。文档见 [docs/development.md](docs/development.md) 的「打包与安装」与 [docs/tools.md](docs/tools.md) 的 `ssh_workspace_bash`。
- **Niubash 三级加载路径（放置 / 解析约定）**：远端 win 主机上 Niubash 的放置路径按序三选一——① `<远端项目目录>\.dsh\runtimes\plugins\dsh-ssh-workspace\niubash\`（该主机挂载了项目工作区时可选）② `<远端用户目录>\.dsh\runtimes\plugins\dsh-ssh-workspace\niubash\`（默认推荐）③ 用户选择的目录（弹窗自定义输入，输入的目录即放置根、不再追加后缀）。`lib/bash-payload.js` 新增 `NIUBASH_RUNTIME_RELATIVE` 常量、`niubashRootFor(placement, bases)`（三级放置根计算）、`normalizeWindowsDir`（绝对 Windows 路径校验）；`provisionWinBash` 新增 `installRoot` / `placement` 选项（目标根由放置路径决定；`ssh_workspace_bash` 工具不带这两个选项时维持旧部署根 `~/.dsh-ssh-workspace/bash/<版本>` 不变），回执 `.provisioned.json` 与部署树内新增 **`manifest.json` 副本**（三级探测要求 `bash.exe + manifest.json` 都在才算）。**解析已有 Niubash 的顺序**：主机条目记录的路径优先（`bashProvisioned` 记录，whatever 放置方式，记录路径仍被信任）；未记录时按 ①→②→③ 默认位置探测（`lib/win-bash.js` 新增 `niubashCandidates` / `buildNiubashProbeScript`，一条 cmd `if exist` 嵌套 AND 扫全部候选，命中后仍 `--version` 实测；探测列表第 3 级取旧部署根 `%USERPROFILE%\.dsh-ssh-workspace\bash\<pin 版本>` 作为兼容网——自定义目录只可能通过记录找到）；**旧部署根既有条目继续兼容**，新初始化一律走新路径约定。`bashProvisioned` 记录扩展 `placement`（project / user / custom / legacy）与 `releaseTag` 字段（老记录缺省不影响可信度，`normalizeBashProvisioned` 白名单透传）。
- **win 主机「初始化 Niubash」按钮 + 弹窗**：`os === 'win'` 的主机卡片新增「初始化 Niubash」按钮（跟随现有按钮与对话框模式）。弹窗：显示当前状态（未初始化 / 已初始化：远端路径 + 版本 + 时间 + 放置方式 / 探测到已有部署但未记录），放置路径三选一（项目工作区下拉 = 该主机已挂载的工作区，没有时禁用并提示；用户目录默认推荐；自定义目录输入框），「开始初始化」发起部署并展示结果（上传文件数 / 字节 / 远端校验行）或错误；**进行中可取消**——浏览器 abort fetch 关闭 socket，服务端把同一 `AbortSignal` 一路传进引擎（下载 / 上传 / 远端校验全部响应中止）。已初始化状态下可查看详情、可重新初始化（换放置路径或升级版本，复用既有 force / 原子替换逻辑）。后端新增两条路由（遵守 `/api/dsh-ssh-workspace/*` 规范，**不做轮询**——状态以打开弹窗时的一次查询 + 初始化完成后的一次结果为准）：`GET /niubash/status?alias=`（有记录直答不发探测；无记录按三级默认位置探测一次，顺带返回本进程信任的载荷 pin 与可用的项目放置候选）与 `POST /niubash/init`（复用 `provisionWinBash`，目标根由放置路径决定）。路由总数 35 → 38。
- **Niubash 状态门控注入 + 自动注入内容全局展示页**：`lib/guidance.js` 新模块成为注入文本单一来源——`SSH_WORKSPACE_GUIDANCE` 公告全文（自 index.js 平移，index.js re-export 保持 API 兼容）、`niubashGuidanceSection`（ops 风格 Niubash 使用要点，改写自 dsh-ops `renderBashGuidance` 的 win32 分支：本机 MSYS Bash 而非 Linux/WSL/PowerShell、workdir 接受 `D:/repo` 与 `/d/repo`、drive-less `/tmp` 不是合法 workdir、MSYS 路径拼写、空格加引号、Bash 而非 PowerShell 语法、载荷自带 git/rg/awk 已入 PATH、远端不碰 Windows 自带程序，并**告诉目录地址与版本**）、`sshGuidanceForCwd`（门控判定：会话 cwd → 主机别名 → ①主机条目 `bashProvisioned` 记录 → ②引擎 `niubashPresence` 内存缓存（初始化完成 / 三级探测命中时写入）——**两者都无则返回基础公告逐字节不变，未初始化的主机一个字节都不加**；门控判定全程同步，绝不在注入点发网络探测）。index.js 的公告 section 改为动态 `text` 函数（宿主每个模型步求值，与 agent-prompts 同机制）。**好设计硬性条款落地**：面板新增「自动注入内容」只读展示区（原「自动注入技能」区升级为伞形区块），列出 `SSH_WORKSPACE_GUIDANCE` 全文、local-exec 技能（name / description / whenToUse / 正文 + 未注册显式状态）、各 win 主机的 Niubash 注入段（「命中 / 未命中」徽标 + 版本 + 命中主机的实际注入全文），数据来自新路由 `GET /api/dsh-ssh-workspace/injected`（公告全文 + 技能结论 + 各 win 主机命中状态与注入文本），面板打开时拉一次、每次 refresh 跟随更新。
- **Niubash 自动部署勾选框（`niubashAutoDeploy`，win 主机三态 + 两处后台触发）**：主机编辑器在选了 **Windows** 时（Bash 路径之后）新增「自动部署 Niubash」复选框，**三态**——新建主机默认勾选；编辑已有主机回显存储值，条目里没有该字段的存量主机默认不勾（一次普通保存绝不会凭空触发部署）；已初始化（有 `bashProvisioned` 记录）的主机置灰并把小字换成「已初始化：部署已存在」。勾选框下方小字注明默认部署目标 `<用户目录>\.dsh\runtimes\plugins\dsh-ssh-workspace\niubash\` 并注明放置路径可在「初始化 Niubash」弹窗更改——**编辑器不放路径输入**，换放置路径只有弹窗一个入口。字段全链路：store 校验（存在时必须为 boolean）/ normalize（`=== true` 才落盘，缺省视为 false）/ merge（编辑器总发布尔，勾掉即删键）、`hostSave` payload 白名单、`GET /hosts` 行返回 `niubashAutoDeploy` + `niubashProvisioned`（编辑器三态回显；`HostStore.rows()` 与工具输出 schema 不动）。**触发两处、共享同一把 in-flight 守卫、绝不阻塞**：① `hosts/save` 写入条目成功后，若 `os === 'win'` 且勾选且无部署记录，后台 kick 一次 `provisionWinBash`（HTTP 响应照常返回）；② 引擎 `acquire` 每次**新连接建立**后同样条件再补一次（保存时主机不可达的补偿重试；复用池化连接不触发）——每次连接至多一次，失败记诊断（`degraded`）与 `logger.warn`，不做重试风暴；引擎新入口 `kickNiubashAutoDeploy(alias)` 内部重读条目把关（含放置目标解析：条目已记录目标优先——有记录即不再触发，绝不并排部署第二棵树；否则用户目录默认 `placement: 'user'`），`niubashAutoDeploying` Set 挡同主机并发重入，成功与手动初始化同链路（写记录 + presence 缓存 + 注入门控即刻生效），结果经既有诊断日志 / presence 缓存 / 弹窗状态查询可见，**不推不拉不轮询**。弹窗放置路径三选一默认选中「用户目录」项（此前已是 `useState('user')`，本次补注释与文档固化该默认）。公告 `SSH_WORKSPACE_GUIDANCE` 的 `ssh_workspace_bash` 一行补「新建 win 主机默认自动部署」一句。文档见 [docs/hosts.md](docs/hosts.md) 的「自动部署」、[docs/ui.md](docs/ui.md) 与 [docs/features.md](docs/features.md)。

### 新增

- **Windows 主机 bash 化（探测 + 自备载荷 + 方言统一）**：Windows 类型主机（钉了 `os: "win"` 或探测出 cmd 登录 shell）不再把 Windows 自带程序当主力——**优先使用远端已有的 POSIX bash**：解析顺序为 ①主机条目新增的 `bashPath` 字段（面板编辑器手填，store 校验去空白 / 拒引号换行、留空即删）→ ②已部署载荷（条目新增 `bashProvisioned` 记录）→ ③自动探测（固定候选路径：`%ProgramFiles%` / `%ProgramFiles(x86)%` / `%LOCALAPPDATA%` 的 Git 两种布局、用户级 Git、scoop shim / apps、chocolatey、`C:\tools\msys64` / `C:\msys64`，外加 `where bash` 扫 PATH；`if exist` 单条 cmd 命令一次跑完所有候选，**排除 WSL 启动器** `%SystemRoot%\System32\bash.exe` 与 Store 别名）。每个候选都通过 SSH **实际执行 `bash --version`** 验证（exit 0 且输出含 bash 才算数），结果按连接记录缓存、重连重探。**有 bash 即按 POSIX 派发**：`exec` 命令外层只跑 `"<bash>" -s`，POSIX 命令经 exec 通道 stdin 喂入（彻底绕开 cmd→bash 双层引号——POSIX 脚本内嵌 cmd 命令行需要逐字符穿两层方言转义，stdin 则原样到达；脚本写完即关 stdin，bash 以末条命令状态退出）；子进程桥（rg/git）复用 `buildPosixScript` 同样走 stdin，**带 stdin 载荷的 spec 先把载荷 SFTP 暂存到远端 `/tmp` 再 `< 文件` 重定向**（bash 读脚本有预读，载荷与脚本共用通道会被吞）；`ctx.shell` 接缝（pwsh / bash 工具）的 POSIX 脚本同样经 `"bash" -s` + stdin 喂入（该接缝在无 bash 的 cmd 主机上维持原状——POSIX 脚本进 cmd 失败是既有缺口，本次不扩大也不掩盖）；持久 shell 与 ssh:// 终端直接以 `bash --noprofile --norc` 启动（`cd /d` 先切目录，进程直接启动）；能力探测与退出码标记自然回落 POSIX 拼法。**探测不到且未部署 → 回退现有 cmd.exe 行为一字不改**（用户已确认的选择，非 fail-closed）；PowerShell 默认 shell 的 win 主机维持「不适配」。**自备载荷**：钉版 pin（niubash v1.5.0 `niubash-v1.5.0-win-x64.tar.gz`，url / sha256 `da28cdc4…` / 32931587 字节 / 解包方式 / 可执行文件相对路径与其 sha256 全部写进 `lib/bash-payload.js` 并文档化；发布前已逐字节验证：GitHub release 直连可下、hash 与字节数精确匹配、node zlib+tar 可解、`winuxcmd/usr/bin/bash.exe` 成员 sha256 匹配）——新增 `ssh_workspace_bash` 工具（`action: detect|provision`，显式触发、默认绝不自动下载部署）：`provision` 在 **DSH 宿主侧**下载（或 `payloadPath` 提供本机副本）→ `node:crypto` 流式校验 sha256 与字节数 → **本机**解包（node 内建 zlib + 自写 tar 解析，只收普通文件 / 目录 / 硬链接三类成员，绝对路径 / `..` / 盘符 / ADS / 保留设备名直接拒绝，可执行成员 sha256 复核）→ 经现有 SFTP 通道把解包树整棵上传到远端 `<HOME>\.dsh-ssh-workspace\bash\<版本>\`（先传 `.stage-…` 兄弟目录再 rename 原子发布，中断最多留一个待清扫的 stage；强制重建先把旧树 rename 到 `.previous-…`，发布成功后才删）→ **远端执行 `bash --version` 做完整性确认**（经 cmd `set "PATH=树根;…"` 前缀让 bash shim 定位引擎；顺带让载荷自带的 rg / git 进入 PATH，远端 glob/grep 与变更追踪随之可用）→ 回执 `.provisioned.json` 随树写入（schema 对齐 dsh-ops 的回执模式：pin 的 url / sha256 / 解包方式 / 时间 / 主机别名）→ 版本 / 路径经 `mutateHosts` 记入主机条目并当场清方言缓存（下一条命令即 POSIX）。**红线：远端侧全程只接触 SFTP 写入与 bash 自身**，不碰 tar.exe / Expand-Archive / bitsadmin / curl。新增 `lib/win-bash.js`（候选清单 / 探测脚本与解析 / WSL 过滤 / 实测 / `bashCwdOf` 盘符拼写 / PATH 前缀）与 `lib/bash-payload.js`（pin / 摘要 / tar 解析 / 暂存 / 上传 / 回执 / 部署器）两个模块；`remoteDialect` 返回值形状保持 `'posix'|'cmd'` 封闭集不变（store / 文档 / 既有调用全部兼容），仅语义变为「win 主机有 bash 答 posix」。工具数 10→11（`hosts` 表新增 `bashPath` 列，编辑器新增 Bash 路径输入框与中英文案）。文档见 [docs/tools.md](docs/tools.md) 的 `ssh_workspace_bash` 与「Windows 主机上哪些能力可用」、[docs/hosts.md](docs/hosts.md) 的 `bashPath` / `bashProvisioned`、[docs/features.md](docs/features.md) 与 [docs/architecture.md](docs/architecture.md)。

### 新增

- **主机编辑器「测试连接」（新建与编辑都有）与新建时即可选默认目录（草稿探测通道）**：新增 `POST /api/dsh-ssh-workspace/probe` 路由，请求体携带**表单当前值**（`draft`），服务端经引擎的 `withDraftSftp` 为它开一条**一次性 SSH 连接**，测完 / 列完即关。三条刻意语义：① 不碰连接池——草稿可能与某台已保存主机同名但凭据不同，走池子会复用或挤掉用户正在用的连接；② TOFU **只验证不记录**——别名已有主机密钥记录时照样对照（已知变更过的密钥在测试 / 浏览流程同样被拦下、走就地恢复），但连接成功也不写入新记录，避免为改了名或从没保存的主机在共享的 `dsh-ssh.json` 里攒孤儿指纹（保存后的首次真实连接本来就会 TOFU）；③ 草稿密文只活在这一次连接的内存里，绝不落盘——编辑已存主机时留空的密码 / 口令由服务端从存储回填给这条草稿连接（表单不回显密文，「编辑 → 测试」不重输密码才可能通过），显式填写的新值优先。`action: 'test'` 只测连通（成功 toast 附往返毫秒数，失败按连接错误分类给出可操作提示）；`action: 'ls'` 与 `GET /ls` 同形应答（`path` 回显 / `entries` / `writable`），编辑器的「选择…」默认目录按钮因此不再要求「先保存主机」——表单填好连接信息即可浏览，浏览即实连，选完写回输入框、保存时规范化不变。必填字段（别名 / 主机 / 用户名 / 认证字段）没填好时「测试连接」与「选择…」都禁用并以悬停提示说明缺什么。文档见 [docs/ui.md](docs/ui.md) 的「草稿探测通道」与 [docs/hosts.md](docs/hosts.md)。

- **主机密钥不匹配的就地恢复**：目录列表 / 测试连接吃到「主机密钥与首次连接记录不一致」拒绝时，错误态不再是一句指回面板「忘记主机密钥」的死路文案——凡是可能吃到这个拒绝的地方（「新建远程工作区」对话框、目录浏览器、默认目录选择器、主机卡片的「测试连接」、主机编辑器的「测试连接」）都就地展开恢复区：先并列渲染**已记录 / 本次出示**两个指纹（含密钥类型与记录时间），点「忘记此主机密钥并重试」后进入**确认步骤**（再次并列双指纹 + 中间人警示：「若你没有预期到这次密钥变更，不要继续」），确认才调 `POST /hosts/forget-key` 清记录并**自动重试刚才失败的列表 / 测试**，重连即以新密钥重新 TOFU——插件从不静默信任变更后的密钥，主机卡片上独立的「忘记主机密钥」次级操作保持不变。支撑这件事的后端改造：拒绝错误挂上 `code: 'hostKeyMismatch'` 与结构化 `mismatch` 字段（`{alias, recorded, presented}`），`/ls`、`/test`、`/probe` 等路由经统一的 `routeErrorPayload` 把字段随错误体透传（`/test` 保持 200 `ok:false`、其余 400），客户端 `fetchJson` 把字段挂到抛出的错误上——**客户端渲染恢复区只读字段、从不解析报错文案**。新增冒烟套件 `probe-route`（52 项）与 `host-key-recovery-ui`（51 项），路由总数 34 → 35。文档见 [docs/ui.md](docs/ui.md) 的「主机密钥不匹配的就地恢复」与 [docs/troubleshooting.md](docs/troubleshooting.md) 第 4 条。

### 修复

- **`ssh_workspace_hosts` 在钉了「操作系统」的主机上整个报错（`value.hosts[N].os is not a declared property`）**：主机 `os` 字段上线时（store 的校验 / normalize / `HostStore.rows()` 输出、编辑器下拉、方言分派）漏改了本工具的输出 schema——`rows()` 恒带 `os` 键（未钉 OS 的行值为 `undefined`，返回前会被剔掉），凡是钉了 win / mac / linux 的主机（如数据文件里已保存的 `os: "linux"` 条目）一进结果，宿主对输出 schema 的 `additionalProperties: false` 校验就以「未声明的属性」拒绝**整个工具调用**，模型侧 `ssh_workspace_hosts` 完全不可用。现在 schema 补上可选的 `os`（`type: 'string'`，`enum` 直接引用 `store.js` 的 `HOST_OS`，缺省即「自动探测」），渲染表新增 `os` 列（`win` = cmd.exe、`mac` / `linux` = POSIX shell、`auto` = 按连接探测），模型据此选对命令方言；既有 dsh-ssh.json 数据无需任何手改。文档见 [docs/tools.md](docs/tools.md) 的 `ssh_workspace_hosts` 一节。

- **未钉 `os` 的 POSIX 主机被打上 cmd 方言（每条远端命令都带 `cd /d "…"` 前缀而坏掉）**：Windows 主机 bash 化上线时，`#resolveAndCacheBash` 无条件调用 `resolveWinBash`——三级解析落到第三级探测时发出的是 cmd 语法（`if exist "%ProgramFiles%\Git\bin\bash.exe" … & where bash`），在存量最常见的「自动」主机（未钉 `os`、登录 shell 是 sh / bash）上这是 POSIX sh 的语法错误（`Syntax error: "(" unexpected`、stdout 为空），探测得 0 候选 → `record.bash = null` → `remoteDialect` 把「bash 没有答案」误读成「cmd 主机没有 bash」，整台 POSIX 主机被缓存成 `cmd` 命令方言。这是旧逻辑（`loginDialect` 的 `echo %COMSPEC%` 短路链，那条链还在、只是新代码没先问它）弄丢的性质。现在登录 shell 先门住整条 bash 解析链：`#resolveAndCacheBash` 在 `resolveWinBash` 之前先解析 `loginDialect`——posix 登录 shell **完全跳过三级解析**（cmd 语法的探测命令一步都不发出，`record.bash = null` 语义不变），钉了 `win` 的主机在该处零往返短路成 `cmd`、照旧跑三级解析；`remoteDialect` 也在咨询 bash 之前先问 `loginDialect`，posix 登录 shell 直接答 `posix`（否则 `bash = null` 仍会被 `bash !== undefined ? 'posix' : 'cmd'` 映射成 cmd）。既有性质全部保持：`bashResolving` 共享 in-flight 与 token 写回守卫（登录门在 in-flight 窗口内，并发调用者共享同一次探测，`forgetDialectCaches` 落在窗口内仍使写回失效）、探测窗口内 `exec` 的 raw 直通（`resolvingBash === true` 读缓存不走共享任务）、`execRaw` / `loginDialect` 自身不经 bash 分派。同族路径核查：钉 `mac` / `linux` 的主机由 `remoteDialect` 首个短路挡下，不发任何探测；`bash-payload.js` 的 provision 本就以 `loginDialect !== 'cmd'` 给出明确报错（POSIX 主机无需部署），不改；`shell.js` / `patch-terminal.js` / `patch-subprocess.js` 都先过 `remoteDialect` 再取 bash，随方言修正自然恢复；`tools.js` 的 bash detect 对 POSIX 主机经 refresh 重解析后正确回报「无 bash、方言 posix」。JSDoc（`remoteBash` / `remoteDialect` / `#resolveAndCacheBash` / `loginDialect`）与 [docs/tools.md](docs/tools.md) 的 `ssh_workspace_bash` 一节对「探测只发生在 cmd 登录 shell 主机上」的表述一并订正。

## [0.2.7] - 2026-10-24

### 新增

- **连接事件可查**：`ssh_workspace_status` 与面板 status 路由新增 `events`，记录最近的连接 / 断连 / 重连 / 降级事件。
- **统一命令入口**：新增 `npm test` / `npm run lint` / `npm run check:docs` / `npm run check`，CI 与发布流程改用同一组命令。
- **贡献者与安全说明**：新增 `CONTRIBUTING.md`、`SECURITY.md`。
- **退役模式单独成文**：新增 [docs/upstream-workaround-pattern.md](docs/upstream-workaround-pattern.md)，写明上游补丁该在什么信号出现时撤掉。

### 修复

- **退役信号只写进无人读取的日志**：上游补丁的退役信号原先只进 `ctx.logger`，本部署无人读；现在经状态接口的 `upstreamWorkarounds` 字段与一条 `upstream` 事件暴露。
- **「探不到宿主」被当成「宿主仍有缺陷」**：上游补丁的探测从布尔改为六态，两者不再混为一谈。
- **断言失败只说结论**：`projection-real-smoke` 中「缺陷仍然存在」的失败信息现在直接给出删除补丁的步骤。
- **加载失败的 peer 包被静默跳过**：检测器新增 `broken`（解析到但加载失败），套件失败而非跳过，且不再被报成「没装」。
- **真包与替身并存被报成「真包」**：整树判定要求所查的每个包都是真的，并存时报 `mixed`。
- **`boot-smoke` 自己维护一份 peer 检测**：现在统一走检测器。
- **两个 stub 缺少 `__dshStub` 标记**：`dsh-tools` 与 `cordis` 的替身已补上。
- **`ssh2` 缺失被说成「宿主 peer 包」**：现在按角色区分，本包依赖缺失给出 `npm ci`。

### 测试

- 新增 `tests/peer-mode-smoke.mjs`，用四态合成树驱动检测器自身。

### 文档

- [docs/upstream-workarounds.md](docs/upstream-workarounds.md) 的退役判据改按状态集说明，删除步骤补齐相关字段。
- `development.md` 新增「日志与诊断」一节，并校正套件与断言计数。
- `troubleshooting.md` 的连接排查改为先看 `events`。

## [0.2.6] - 2026-10-21

### 修复

- **`ssh://` 会话打不开**：`cwd` 为 `ssh://` 的会话打开时报「历史加载失败」，删缓存也无效；现在能正常打开。
- **npm 装出第二份私有宿主**：安装本插件时 npm 会另装一份私有宿主副本，插件随之加载到第二份 `dsh-fs` / Cordis（服务实例分裂）；现已不再发生。
- **版本约束从未生效**：`package.json` 里写在 `dsh.engines` 下的版本要求不被读取，已删除，改由 `peerDependencies` 声明。

### 清理

- 删除 `patch-terminal.js` 中从未被调用的 `remoteTargetOf`。
- 13 个只在本文件内使用的 `export` 收回为内部定义。
- 去掉 `routes.js` 未使用的 import，以及两条没有调用方的客户端 API 映射。
- 删除 16 个没有任何引用的界面文案键（中英词典同步，现为 163 定义 / 163 引用）。
- 删除 `scripts/verify-sftp.mjs` 中的死代码，以及仓库根目录遗留的 `.peer-stubs/`。

### 文档

- 新增 [docs/upstream-workarounds.md](docs/upstream-workarounds.md)：登记绕开宿主缺陷的临时补丁，含退役信号与删除步骤。
- 根 README 的「快速开始」补上从源码仓库使用的步骤：`git clone` 后必须先 `npm ci` 再重启客户端，否则插件不会加载（`ssh2` 是直接依赖，不随 clone 到位）。
- 根 README 的版本号示例更新为 npm 上当前的 `latest`。
- 校正 `development.md` 等文档中的套件与断言计数。

## [0.2.5] - 2026-10-19

### 修复

- **文件上传可以落到远端工作区之外**：`ssh_workspace_transfer` 与面板上传此前只做模式与范围判定，缺少挂载根与符号链接判定，同一路径 `write` 会拒绝而上传照常落下。现在上传与 `write` 共用同一道判定，递归上传对每个创建的目录逐一判定。
- **远端 `workspace-write` 拒绝写 `/tmp`**：本地允许的暂存目录在远端被判成工作区外，导致远端构建全部失败。现在会话范围与挂载围栏都认该主机的 `/tmp`，且只对已有挂载根的主机生效。
- **读不懂的沙箱模式在远端等于放行**：三个被认可的模式之外的任意字符串会同时跳过模式围栏与范围围栏，命令面更是按最宽模式执行。现在写入与命令一律拒绝，文案不再把它说成用户选的「仅可查看」。
- **范围拒绝的文案指向一条一定会再失败的出路**：补上「目标还须在某个已挂载工作区内，否则先挂载」。
- **「仅可查看」没能挡住远端写入**：会话切到 `read-only` 后 `write` / `edit` 仍能改写远端文件且无任何提示，而模型的系统提示要求它先试。现在按会话模式拒绝。
- **围栏外写入被报成「在 danger-full-access 下被拒，可升权重试」**：挂载围栏与停用围栏改用各自的错误码，真实原因能直达模型。
- **`ssh_workspace_transfer` 的上传不受模式约束**：`read-only` 会话能上传而同一会话的 `write` 已被拒。现在上传同样受模式门禁约束，下载不受影响。
- **命令执行完全不看模式**：`ssh_workspace_exec`、`ssh_workspace_shell` 与 `workdir` 为 `ssh://` 的 `bash` / `pwsh` 在 `read-only` 会话下照常执行（含 `rm`）。现在统一拒绝；`close` 与读取类操作不受影响。
- **终端同样不受模式约束**：`terminal_open` 与内建侧边栏终端在 `read-only` 下照常开 shell；会话在运行中被切成 `read-only` 后仍继续接受命令。现在开 PTY 与逐次写入都要判定，控制字节（SIGINT、关闭）保留例外。
- **下载失败被浏览器存成文件**：`GET /download` 出错时回答 200 + JSON，被当作文件内容保存。现在按错误码返回 404 / 403 / 400 / 500。
- **`workspace-write` 没有收窄到会话自己的工作区**：可以写同一主机的兄弟根，也能写另一台主机的已挂载根。现在与本地一致。
- **策略解析失败被说成「用户选了仅可查看」**：文案改为说明这是接线问题、切换模式无用。
- **拒绝文案不再假装能升权**：这一族工具没有 `sandbox_permissions` 参数，改为给出「切换模式」这条真实出路。
- **在对话框里拖选文字会关掉整个流程**（[#1](https://github.com/siqyka/dsh-ssh-workspace/issues/1)）：遮罩的关闭判据改为「按下与松开都落在遮罩上」，只认主键，忙碌时拒绝关闭。

### 文档

- 补全命令执行面受模式约束的说明，并修正多处与实现相反的描述（「浏览目录」被说成已屏蔽、文件右键菜单遗漏上传与下载、路由与列表计数错误）。
- 补全错误码表（新增远端专用的 `FS_OUTSIDE_WORKSPACE`，补上 `FS_ABORTED`）。
- 两个 README 的全部仓库内链接与头图改为绝对 GitHub URL，修复 npm 页面上 12 个链接与头图失效。
- 新增 `scripts/check-doc-links.mjs`，校验文档链接、锚点与仓库内绝对 URL。

## [0.2.4] - 2026-10-18

> 0.2.3 的 tag 已推送，但该版本从未出现在 npm 上，因此 0.2.3 与 0.2.4 的全部改动都在本版首次发布。

### 修复

- **CI 在 Node 20 上崩溃**：代码用了 Node 22 才有的 `Promise.withResolvers()`，而 `engines.node` 声明 `>= 20`、CI 也按 Node 20 跑。0.2.3 因此完全没有发布出去。现在改为自带的等价实现。
- **停用工作区的会话没有置灰、仍然可用**：标题变灰而下面的会话照常可点。现在会话行一并置灰且不可点。
- **客户端 bundle 语法错误也能全绿通过**：测试把 bundle 当文本读，一个解析不过的文件照样满足全部断言。现在增加语法解析检查。
- **向输入框拖入一个文件会生成约 22 个同样的 chip**：模块重复加载时监听器叠加。现在一次派发只消费一次。
- **本地化词典未更新**：新键渲染成原始键名。
- **空态 / 加载中 / 错误占位符失去内边距与居中**：一条样式规则被误删，已恢复。
- **`ssh_workspace_enable` 会被自己的围栏挡住**：改用原始连接探测，`ssh_workspace_mount` 同一处问题一并修复。
- **`forget` 模式只清清单、不清围栏**：留下「面板里已无这一行、运行时却仍拒绝一切操作」的工作区，用户无从恢复。
- **启动 DSH 会把所有已挂载工作区的主机连上**：侧边栏渲染时的状态查询会真的建立连接。
- **`detach` 会把会话藏起来**：保留工作区记录却归档了它的会话。

### 新功能

- **端口转发持久化**：映射写入 `dsh-ssh.json`，面板可开启 / 断开 / 删除单条映射，并有「启动时自动开启隧道」总开关。已存映射强制严格端口模式，本地端口被占用就报错而非静默漂移。
- **面板列表滚动**：主机、端口转发、已挂载工作区、已停用工作区四个列表超过 5 条时改为滚动视口。
- **工作区停用 / 启用**：卸载改为可逆。默认保留工作区记录与会话（侧栏那一行仍在、置灰），可随时重新启用。
- **停用即全局停机**：停用的工作区对除 SSH 连接外的一切操作都被拒绝——读、写、列目录、变更监视、执行命令、开终端、glob / grep / git、文件传输。
- **`ssh_workspace_enable`**：新增工具与路由，重新挂载并取消归档；启用前会验证远端目录仍存在。

### 变更

- `ssh_workspace_unmount` 默认改为 `detach`（原为 `deregister`），新增 `mode` 与 `archiveSessions` 参数。
- `forget` 归一化为 `deregister`，旧拼写仍被接受。
- 「同时删除工作区记录」现在会同时清掉持久清单与运行时围栏。
- 断开主机与手动断开端口现在行为一致：映射保留、不留下任何可解释为故障的提示。
- `POST /test` 改为探测后释放连接；被端口转发钉住的连接不释放。
- `POST /hosts/disconnect` 连带拆除该主机的端口转发。

### 文档

- 新增 [docs/features.md](./docs/features.md)：按能力域列出完整功能清单，每项写清做什么、依赖什么、缺依赖时退化成什么样。
- 删除 `docs/optimization-plan.md`、`docs/roadmap.md`、`docs/_template.md` 三篇内部流程文档。

## [0.2.3] - 2026-10-17

### 新功能

- **远端 PTY 终端**：终端在 `ssh://` 工作目录上开在远端，补齐了此前唯一的能力缺口。启动的是远端自己的交互式 `sh`，不复用本机方言的命令行。
- **浏览器端下载**：文件选择对话框的每个文件行新增下载按钮，经 `GET /download` 流式取回字节并交给浏览器保存。

## [0.2.2] - 2026-10-17

### 新功能

- **端口转发恢复**：远端 dev server 映射到本机 `http://localhost:<port>`，映射随 SSH 连接存活，断开即关闭。
- **持久远端会话**：新增 `ssh_workspace_shell`，`cd`、导出的变量与后台任务跨调用保留。
- **本机 ↔ 远端传输**：新增 `ssh_workspace_transfer`，经 SFTP 双向拷贝，分块流式、不经对话内容；上传先写暂存名再 rename 发布。
- **`ssh_workspace_exec` 支持后台任务**：`run_in_background` 返回 job id，可用 `job_output` / `job_kill` 收集与终止。

### 变更

- **推送式变更监视**：远端有 `inotifywait` 时改用事件推送，变更即时上报；否则回落到自适应退避的轮询。
- **能力探测**：挂载时一次性探测 `rg` / `git` / `inotifywait`，缺失项提前给出提示。
- **每主机传输选项**：新增 `agentForward`（私钥不落到远端）与 `compress`，`~/.ssh/config` 中的对应项同样被识别。

### 修复

- 端口转发的状态查询链路此前仍在运行但入口被注释，导致「功能已屏蔽」的判断与实际不符。

## [0.2.1] - 2026-10-16

### 修复

- **`exec` 断连被误判为正常完成**：通道关闭时既无退出码也无信号，不再当成命令成功。
- **rename 回退误删目标**：远端不支持原子改名时，删除目标前先确认其存在，避免失败时误删无关文件。
- **`listDir` 串行 N+1 往返**：目录列举从 1+N 次降为 1 次。
- **主机存储的跨进程写入**：加入兄弟锁文件，读改写整体进入临界区。
- **`StreamTail` 重复拼接**：缓存拼接结果。

## [0.2.0] - 2026-10-14

### 新功能

- 新增 `POST /api/dsh-ssh-workspace/hosts/disconnect`：关闭指定别名的连接；仍有在途操作时返回提示而不是强行断开。主机卡片内联展示「已连接」状态。

### 变更

- HTTP 路由增至 10 条。

## [0.1.24] - 2026-10-06

### 变更

- 包名由 `@dsh-community/dsh-ssh-workspace` 改为 `@shiqyka/dsh-ssh-workspace`，以便发布到 npm。

### 安全

- 存储中的密码与私钥口令改为加密保存；`dsh-ssh.json` 不再出现明文。
- 启动时自动把老版本留下的明文凭据加密回写。
- 密钥文件缺失或被更换时，连接明确报错并提示重新保存该主机，而不是静默认证失败。

## [0.1.23] - 2026-10-01

### 修复

- 会话中 `@` 远端文件引用点击后预览报「读取失败：Maximum call stack size exceeded」：远端根下的裸路径会在路由与插件之间无限互相委派。

## [0.1.22] - 2026-10-01

### 安全

- 主机密钥 TOFU：首次连接记录指纹，之后不符即拒绝连接；新增「忘记主机密钥」入口。
- HTTP 路由增加 Host 头校验（仅接受回环地址）与 POST `Content-Type` 校验。
- 凭据存储文件与目录收紧权限，写路径接入符号链接围栏校验。

### 修复

- `exec` 输出跨块 UTF-8 解码安全，按字节截断不再切坏字符。
- `exec` 连接断开且无输出时自动重连重试一次。

### 性能

- SFTP 元数据短 TTL 缓存（仅读路径）。
- 远端变更监视自适应退避。
- `streamText` 按需启用第二条 SFTP 通道，大文件流式读取不占用共用通道。

### 工程

- 新增冒烟测试套件与运行器、GitHub Actions CI、锁文件。
- 引擎连接参数可配（空闲超时 / 连接超时 / keepalive / 回收扫描间隔）。

## [0.1.21] - 2026-10-01

### 变更

- 端口转发功能整体屏蔽，相关文档同步移除，本阶段不发布该功能。

## [0.1.20] - 2026-10-01

### 新增

- `@` 文件引用支持远端工作区：输入 `@` 即可搜索并插入远端文件路径。
- 文件进任务：侧边栏文件树支持拖拽到对话框，或右键「添加到任务」，以 `@` 引用形式插入。

## [0.1.19] - 2026-10-01

### 修复

- 0.1.18 引入的工作区向上探测崩溃（报 `not a remote workspace path: "ssh://<别名>"`）。

## [0.1.18] - 2026-10-01

### 新增

- 终端命令远程化：会话工作目录为 `ssh://` 时，命令以 POSIX shell 语义在远端执行。
- 远端文件搜索（ripgrep）与 git 变更追踪在远端执行。
- 远端变更监视（轮询式）。
- 大文件流式读取。
- 端口转发（本地监听 → 远端目标；0.1.21 起屏蔽）。

## [0.1.17] - 2026-10-01

### 新增

- 远程路径以 `@` 形式显示：`ssh://<别名>@/<路径>`（仅显示层，功能拼写不变）。

### 变更

- 发布文件脱敏：示例主机名与用户名替换为占位符；移除已废弃的第三方插件引用。

## [0.1.16] - 2026-10-01

### 修复

- 界面文案参数（如 `{ms}`）不再原样输出。
- 对话页工作区按钮标记匹配修复。
- 连接测试结果 toast 调整为顶部居中显示。

### 变更

- 远程工作区标记图标放大并按图标边界裁剪。
- 界面细节打磨：控件悬停 / 按下与焦点态、菜单与对话框入场动画（尊重 `prefers-reduced-motion`）、空 / 加载态、数字等宽排版。
