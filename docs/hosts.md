# 主机配置与认证

> 定位：主机从哪里来、如何存储、如何在面板中管理。

## 来源与优先级

两类来源，按优先级：

| 来源 | 位置 | 可编辑 |
| --- | --- | --- |
| 主机存储（优先） | `$DSH_HOME/dsh-ssh.json` | 是（面板增删改） |
| OpenSSH 配置（回退） | `~/.ssh/config` | 否（只读） |

与存储同名的主机以存储为准，列表里也只出现一次（呈现为存储条目）。
存储文件读不懂时按空列表降级（不阻塞 `~/.ssh/config` 的主机），但**编辑**
时会明确报错，避免把读不懂的内容覆盖掉。

## 存储格式

`dsh-ssh.json` 是共享格式（`{ "version": 1, "hosts": [...] }`），DSH 的 SSH
工具链共用这一份主机列表。插件写入时保留顶层与条目里**不认识的字段**；
写入是原子的（暂存文件 + rename），文件权限收紧为 `0600`（目录 `0700`）。
除 `hosts` 外，文件另有 `knownHosts` 段记录主机密钥指纹（见「主机密钥校验」）
与 `secrets` 段保存加密后的凭据（见「认证与凭据」）。

条目字段：

| 字段 | 含义 |
| --- | --- |
| `alias` | 别名（用于 `ssh://` 与工具参数） |
| `host` / `port` / `user` | 连接目标；默认端口 22 |
| `auth` | `{ kind: "key" \| "password" \| "agent", keyPath?, passphrase?, password?, agentPath? }` |
| `description` / `tags` | 备注与标签（`ssh_workspace_hosts` 可搜索） |
| `os` | 可选枚举 `win` \| `mac` \| `linux`，**钉死主机的操作系统**，也就定了远端命令的 shell 方言：`mac` / `linux` → POSIX shell；`win` → 优先用主机自己的 POSIX bash（钉了 `bashPath`、部署过载荷或探测得到，见下），一个都没有才回退 cmd.exe（exec / shell / 终端 / 子进程桥全部跟随，见 [tools.md](./tools.md)）。缺省 = 不钉，引擎按连接探测登录 shell（老条目与 `~/.ssh/config` 回退主机的既有行为），所以面板编辑器里旧主机在保存前显示「自动」而不是默认 Linux——把一台探测出 Windows 的主机钉成 Linux 会让它的远端命令全部失灵。保存时接受常见别名（`windows` → `win`，`macos` / `osx` / `darwin` → `mac`），认不出的值视为未设置（不落盘）；选「自动」保存即删除该字段、回到探测 |
| `bashPath` | 可选字符串，**win 主机专用**。手动钉死该主机的 POSIX bash 可执行文件（如 `C:\Program Files\Git\bin\bash.exe`），是引擎 bash 解析的第一优先级（第二、三级为已部署载荷与自动探测，见 `ssh_workspace_bash`）；解析时仍会 `--version` 实测，失效的钉值会降级到下一级并记入诊断。保存时去除首尾空白与结尾分隔符，含引号或换行的值被拒绝（400）；留空保存即删除该字段、回到探测。mac / linux 主机忽略此字段 |
| `agentForward` | 布尔。在远端**命令通道**（exec / shell / 终端 / 持久 shell）上转发本机 ssh-agent，使远端命令（如远端 `git push`）能用本机密钥认证，私钥不落到远端；SFTP（浏览 / 传输）不受影响，认证方式也不因此改变 |
| `compress` | 布尔。传输压缩，以 CPU 换带宽，慢链路（跨国 / 移动网络）下明显更快 |
| `aliasTag` | 可选布尔。开启后，侧栏中挂载自该主机的**远端工作区行**在名称下方显示一枚小标签，内容为主机别名（小号字体、超宽省略、悬停显示完整别名，行自然长高容纳第二行），用于多台主机的工作区挤在同一侧栏时分清归属；表现与实现要点见 [ui.md](./ui.md) 的「主机别名标签」。缺省 = 关闭（不落盘 `false`），编辑器以复选框呈现，勾掉即删除该字段；编辑器保存后立即生效 |
| `defaultPath` | 可选字符串。面板「新建远程工作区」在该主机上浏览目录的**初始位置**（编辑器里的「新增工作区默认目录」），缺省 / 留空则打开 SSH 登录目录，字段不落盘。可在面板里浏览选定：新建工作区时勾选「设为本主机默认目录」，或在主机编辑器里用「选择…」按钮。保存时规范化：`\` 折算为 `/`、盘符路径补前导 `/`（`D:/code` → `/D:/code`）、折叠连续 `/`、除根 `/` 与裸盘符根（规范化为 `/D:/`）外去掉尾部 `/`；规范化后不是绝对路径的值会被拒绝（400）。示例：`/home/user` 或 `/D:/code/www` |
| `proxyJump` | 非空时解析明确拒绝（见下） |
| `bashProvisioned` | 可选对象，**由初始化流程写入**（面板的「初始化 Niubash」弹窗或 `ssh_workspace_bash action=provision`，经 `mutateHosts`），编辑器不碰：`{ path, root, version, sha256, provisionedAt, releaseTag?, placement? }` 记录部署到该主机的钉版 bash 载荷（可执行文件路径、部署树根、版本、归档 sha256、时间；`releaseTag` 是 niubash 的 GitHub release tag，`placement` 是放置方式 `project` / `user` / `custom` / `legacy`——老版本写入的记录没有这两个字段，**缺省不影响记录的可信度**）。它是 bash 解析的第二优先级，让部署在重启后仍然生效；形状损坏的记录按「未部署」降级（引擎回落到探测 / cmd），面板删除主机时随之消失 |
| `niubashAutoDeploy` | 可选布尔，**win 主机专用**。开启后，保存条目时（以及该主机每次**新连接建立**时）若尚无 `bashProvisioned` 记录，插件会在**后台**自动部署一次 Niubash 载荷到默认目标 `<用户目录>\.dsh\runtimes\plugins\dsh-ssh-workspace\niubash\`（`placement: 'user'`；条目已记录目标时以记录为准、不再重复部署）——HTTP 响应与挂载流程**都不等待**它，结果经既有诊断日志、引擎 presence 缓存与「初始化 Niubash」弹窗的状态查询可见。**一次连接至多一次**：失败记诊断、不重试风暴，下次新连接可再补一次，或由用户在弹窗手动初始化。缺省 = 关闭（不落盘 `false`）；编辑器以复选框呈现（新建主机默认勾选、已有主机回显存储值、已初始化置灰），勾掉即删除该字段。详见下节「Niubash 三级加载路径与初始化」 |
| `createdAt` / `updatedAt` | 时间戳 |

`agentForward` / `compress` / `aliasTag` / `os` / `bashPath` /
`niubashAutoDeploy` 都是**可选字段**：缺省等于既有默认（开关关闭、操作系统按
连接探测、bash 走探测、不自动部署），所以老版本写入的条目与新版本字节级兼容。
面板的主机编辑器里 `agentForward` / `compress` / `aliasTag` /
`niubashAutoDeploy` 以复选框呈现，勾掉即从文件中删除该字段，不会残留
`false`；`os` 以下拉呈现，选「自动」保存即删除该字段；`bashPath` 在选了
Windows 时出现（输入框），留空保存即删除该字段。

`agentForward` 是**逐通道**生效的：ssh2 的转发请求只能挂在 exec / shell 通道上，
连接级同名字段会把整条连接（含只读 SFTP）都卷进来，本插件不使用它。转发的
前提是连接上挂着一个可解析的本机 ssh-agent（`SSH_AUTH_SOCK` / pageant，或
agent 认证自带的 `agentPath`）：key / password 认证的主机勾选后若本机有 agent
会自动挂上（配置的密钥 / 密码仍是第一认证方式），本机没有 agent 时转发空转、
连接照常；agent 认证却找不到 ssh-agent 仍会在连接时报错。

## ~/.ssh/config 回退

只解析**具体的 `Host` 块**（含通配符的块忽略），读取 `hostname` / `port` /
`user` / `identityfile`（`%d` 展开为家目录）/ `password` / `identityagent` /
`forwardagent` / `compression`，同键按 OpenSSH 的 first-wins 规则。
`ForwardAgent` / `Compression` 按 OpenSSH 的 yes/no 语义归一为布尔（只有显式
`yes` 才算开启，其余一律关闭）。`Include` / `Match` / 通配符块会被跳过而不是
猜着解析——目标是「够用的回退」，不是完整解析器。

## 认证与凭据

- 密码与私钥口令**加密后**保存在 `dsh-ssh.json` 的 `secrets` 段，按别名存放：
  `{ "<alias>": { "password": "enc:v1:…", "passphrase": "enc:v1:…" } }`；
- 算法 AES-256-GCM，密钥是 `$DSH_HOME/dsh-ssh.key`（`0600`）里的 32 字节随机值，
  首次保存凭据时生成。密钥与存储**分文件**：只拿到 `dsh-ssh.json` 解不开内容；
  密钥文件丢失或被更换后，已有凭据无法解密，连接时会明确报错，在面板重新保存
  该主机即可恢复；
- 老版本写入的明文凭据由插件在**启动时自动加密回写**（每次启动检查一次，
  无明文则不动文件）；`~/.ssh/config` 的 `password` 关键字是只读回退，不会被改写；
- **不会回传到浏览器**——面板编辑时密码/口令字段永远为空，留空表示保持原值；
- 切换认证方式（key ↔ password ↔ agent）时无法把旧凭据带过去，必须当场填新凭据；
- key 认证在主机的 keyPath 不存在时，主机列表会给出 `keyReady: false`
  提示（`check-key`）。

> 密文不写进 `auth` 字段，是为了不破坏共享格式：DSH 其它 SSH 工具会把
> `auth.password` 当明文密码直接用。它们读不到本插件保存的密码，但同一主机
> 仍可用密钥 / agent / `~/.ssh/config` 连接。

## 主机密钥校验（TOFU）

每次连接都校验服务器出示的主机密钥（即 ssh 的 known_hosts 行为）：

- **首次连接**：把密钥的类型与 SHA256 指纹（连同当时的 host/port、时间）
  记入 `dsh-ssh.json` 的 `knownHosts` 段并按别名保存，放行——首次使用即信任；
- **指纹一致**：放行；
- **指纹不一致**：**拒绝连接**，错误信息同时给出已记录与本次出示的两个
  指纹（含记录时间），并提示下一步怎么办。拒绝以结构化字段随错误响应传递
  （`code: 'hostKeyMismatch'` + `mismatch`，见 [ui.md](./ui.md) 的「主机密钥不匹配的就地恢复」），
  客户端渲染与恢复都读字段、不解析文案；
- **就地恢复**：凡是可能吃到这个拒绝的界面——「新建远程工作区」对话框、
  目录浏览器、默认目录选择器、主机卡片的「测试连接」、主机编辑器的
  「测试连接」——错误态就地展开双指纹与**「忘记此主机密钥并重试」**（需确认，
  确认步骤再次并列两个指纹并给出中间人警示），确认后清记录并自动重试刚才
  失败的操作，下次连接重新 TOFU；
- 面板每张主机卡片也保留独立的「**忘记主机密钥**」次级操作（需就地确认）：
  仅在该主机确实重装系统或合法更换密钥后使用。忘记后，下次连接会重新信任
  并记录对方出示的密钥（重新 TOFU），同时丢弃该别名的既有连接。

记录按**别名**归属，存储主机与 `~/.ssh/config` 回退主机一视同仁。升级后的
首次连接会静默记录、无交互确认弹窗——这是有意取舍（在面板流程里插入确认
对话框成本高），因此：**若不确定某次指纹变化是否可信，先按 [troubleshooting.md](./troubleshooting.md)
的「主机密钥不匹配」条目与管理员核对，再决定是否忘记。**

**草稿探测连接同样受这套校验，但只验证、不记录**：主机编辑器的「测试连接」
与新建模式下的目录选择按表单草稿开一次性连接（见 [ui.md](./ui.md) 的「草稿探测通道」），
别名已有 TOFU 记录时照样对照（已知变更过的密钥在浏览 / 测试流程里同样被拦下、
走就地恢复），但连接成功也**不写入**新记录——为改了名或从没保存的主机留指纹，
只会在共享的 `dsh-ssh.json` 里攒孤儿记录，而保存后的首次真实连接本来就会 TOFU，
提前钉定买不到任何东西。草稿没有记录时放行本次握手（与「首次使用即信任」一致，
只是不留痕）。

## 面板管理

「远程工作区」面板可添加 / 编辑 / 删除主机（写回 `dsh-ssh.json`）。
改动立即生效：对应别名的旧连接会被丢弃，下一次操作按新配置重连。
删除主机**不会**自动卸载已挂载的远端工作区，但那些工作区会因主机不存在
而无法访问。每张卡片另有「测试连接」（按已保存配置实连一次后释放，
[ui.md](./ui.md)）与「忘记主机密钥」（见上节），只清主机密钥记录，
不动主机条目。主机编辑器（新建与编辑共用）自带「测试连接」与「选择…」
默认目录按钮，二者都按**表单当前值**经草稿探测通道实连——新建未保存的
主机也能先测通、先选目录，再保存。`os === 'win'` 的主机卡片还有
「初始化 Niubash」按钮（见下节）。

## Niubash 三级加载路径与初始化

Windows 类型主机上的 Niubash（插件自备的 POSIX Bash 运行时）有**三级放置
路径**，面板「初始化 Niubash」弹窗按此三选一：

1. `<远端项目目录>\.dsh\runtimes\plugins\dsh-ssh-workspace\niubash\` ——
   放进某个**已挂载的项目工作区**（该主机没有已挂载工作区时不可选）；
2. `<远端用户目录>\.dsh\runtimes\plugins\dsh-ssh-workspace\niubash\` ——
   放进**远端用户目录**（`%USERPROFILE%`），**默认推荐**；
3. 用户选择的目录 —— 弹窗自定义输入的绝对路径（Windows 盘符拼写）。

放置根就是载荷树根（回执 `.provisioned.json` 与 `manifest.json` 副本都在
树内）。**解析已有 Niubash 的顺序**：

- 主机条目记录的路径**优先**（`bashProvisioned` 记录，whatever 放置方式——
  记录的路径总是被信任）；
- 未记录时按 1 → 2 → 3 的默认位置探测：项目根逐个 → 用户目录 → 旧部署根
  `%USERPROFILE%\.dsh-ssh-workspace\bash\<版本>`（第 3 级在探测里取的是旧
  版本插件的部署根；**自定义目录只可能通过记录找到**——用户选的目录除记录
  外无处可记）。探测要求 `manifest.json` 与 bash.exe **都在**，且
  `bash --version` 实测通过才算数；
- **旧部署根兼容**：老版本部署在 `~/.dsh-ssh-workspace/bash/<版本>` 的既有
  条目继续可用（记录路径仍被信任）；新初始化一律走新路径约定。

初始化走两条既有风格的路由（不做轮询，状态以打开弹窗时的一次查询 +
初始化完成后的一次结果为准）：

- `GET /api/dsh-ssh-workspace/niubash/status?alias=X` —— 弹窗打开时的一次
  查询：已有记录直接回答（不发探测）；无记录则按三级默认位置探测一次
  （存在 + 实测），顺带返回本进程信任的载荷 pin（包内暂存 manifest 派生或
  内置 fallback）与可用的项目放置候选；
- `POST /api/dsh-ssh-workspace/niubash/init` —— 发起部署：`{ alias,
  placement?: 'project'|'user'|'custom', projectPath?, customRoot?, force? }`，
  placement 可缺省，缺省（或空白）即 `'user'`（用户目录，与弹窗默认一致），
  非法值照旧 400；复用 `provisionWinBash` 部署器（目标根由放置路径决定）；
  浏览器取消 fetch 会 abort 整个部署（同一 AbortSignal 一路传进引擎）。

初始化成功的记录（路径 / 版本 / 时间 / 来源）写入 `bashProvisioned`，同时
作为「Niubash 已初始化」事实进入系统提示词注入的门控判定（见
[features.md](./features.md) 的「Niubash 状态门控注入」）。

### 自动部署（`niubashAutoDeploy`）

主机编辑器在选了 **Windows** 时出现「自动部署 Niubash」复选框（存储字段
`niubashAutoDeploy`）：新建主机**默认勾选**，编辑已有主机回显存储值（条目里
没有该字段的旧主机默认不勾——一次普通保存绝不会给存量主机凭空部署），已初始化
（有 `bashProvisioned` 记录）的主机置灰并注明「已初始化」。复选框下方的小字说明
默认部署目标 `<用户目录>\.dsh\runtimes\plugins\dsh-ssh-workspace\niubash\`；
**编辑器里不放路径输入**，要换放置路径（项目 / 用户 / 自定义）走「初始化
Niubash」弹窗——目标只有一个地方可改，不出现两个会互相矛盾的面板。

触发有**两处**，都走引擎同一个入口、共享同一把 in-flight 守卫（同主机至多一个
部署在跑），并且**绝不阻塞**请求或连接：

- **保存时**：`hosts/save` 写入条目后，若 `os === 'win'` 且勾选且尚无部署记录，
  后台发起一次部署（默认目标为用户目录）；HTTP 响应照常返回，不等它；
- **挂载时**：该主机每次**新连接建立**后同样条件满足时再补一次——这是保存时
  主机不可达的补偿重试。每次连接至多一次，失败记入诊断日志（`degraded`），不
  做重试风暴；状态由「初始化 Niubash」弹窗的状态查询展示，用户可手动重试。

放置目标的解析顺序：条目已记录目标优先（有记录就不再触发——记录指向的部署已经
存在，自动部署绝不在它旁边再部署第二棵树）；否则用户目录默认。部署成功后与
手动初始化走完全相同的链路：写入 `bashProvisioned` 记录、更新引擎 presence
缓存、下一个模型步即注入「Niubash 已初始化」段。

## 不支持的连接方式

`proxyJump` / `ProxyCommand`（存储字段或 `~/.ssh/config` 里的
`ProxyJump` / `ProxyCommand`）：解析时**明确拒绝**并说明原因，而不是静默
按直连去试。需要跳板时请改用别的工具连接。

## 相关

- [ui.md](./ui.md)
- [troubleshooting.md](./troubleshooting.md)
