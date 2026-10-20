# 更新日志

本文件记录 dsh-ssh-workspace 的版本变更。0.1.16 之前的版本为未公开的本地迭代，未收录。

## [0.2.6] - 2026-10-20

### 文档

- **上游临时补丁登记**：新增 [docs/upstream-workarounds.md](docs/upstream-workarounds.md)，
  给「绕开宿主缺陷」这一类改动建立登记制度——稳定 id、代码内框注、自动退役信号、删除步骤。
  首条登记的是 `UPSTREAM-1-working-directory-isAbsolute`（即下条修复）。
  配套改动：`lib/patch-projection.js` 在安装时先用一个 `ssh://` 值探测已注册的 schema，
  若宿主自己就能接受（说明上游已把 `refine(isAbsolute)` 改成 `refine((value) => isAbsolute(value))`），
  则**什么都不打**、返回 `upstreamFixed: true` 并打一行 INFO，把 workaround 变成会自我宣告的
  no-op 而不是静默的双重放宽；新增 `DSH_SSH_WORKSPACE_DISABLE_UPSTREAM_WORKAROUNDS`
  开关，便于在真实部署上验证某条补丁是否仍承重。
  `projection-real-smoke` 第一节加了注释说明「这一节变红＝上游已修好，应删补丁而非修测试」。

### 修复

- **`cwd` 是 `ssh://` 的会话打开时报「历史加载失败」**：界面上是
  `历史加载失败：failed to project session "session-…": [ { "code": "custom", "path": [], "message": "Invalid input" } ]（gateway/internal）`，
  只发生在远端会话，本地路径的会话不受影响，删投影缓存也没用。根因在宿主的
  `@deepseek-ai/dsh-working-directory`：它把会话目录注册成投影单元，schema 写成
  `z.string().min(1).refine(isAbsolute).nullable()`，而 `refine(isAbsolute)` 传给 zod 的是**函数值**
  ——模块在服务构造那一刻持有的那个 `isAbsolute`。插件的内建桥接替换 `node:path.isAbsolute` 并调用
  `syncBuiltinESMExports()`，只更新了 ESM **绑定**：读绑定的调用方（会话头校验、`fs-local`）能看到补丁，
  已经被当作值捕获的 schema 看不到。于是会话能建、能继续对话，但**重新加载历史**时
  `sessionProjections.restore` 的 `viewSchema.parse(header.cwd)` 对 `ssh://host/path` 返回 false，
  抛出的 zod 细节又被 gateway 兜底成 `gateway/internal`，提示里完全看不出真因。
  插件不改部署自带的 bundle（升级即失效），改为在 `lib/patch-projection.js` 把已注册单元的
  `stateSchema` / `wire.viewSchema` 换成惰性判定（`ssh://` 放行，其余交还原 schema），并用一层
  `register` 包装覆盖「插件先加载」的顺序。放宽范围只有 `ssh://` 一种形态：相对路径、空字符串照旧被拒，
  `null` 照旧通过，其它投影单元不动。
  反向验证：新增 `projection-relax-smoke`（54 项）与 `projection-real-smoke`（17 项，真实
  `SessionProjectionRegistry` + `WorkingDirectoryService` + 真实 zod，按生产顺序装配）；禁用修复后
  分别 9 条与 3 条断言变红，其中真实套件那条精确复现了 `Invalid input`。
  全套 `node tests/run.mjs` **27/27** 通过：裸检出 903 项 / 6 套件 SKIP，`DSH_CORE_ROOT`
  指向真实装配树时 1125 项 / 3 套件 SKIP（仅剩需真实 SSH 主机的 `live`、`acceptance`）。

## [0.2.5] - 2026-10-19

### 修复

- **`ssh_workspace_transfer` 上传的落点与 `write` 完全同步**：它是插件自己的工具，不经 `ctx.fs`，
  此前只做模式与范围两道判定，**缺了挂载根与符号链接 `realpath` 裁决**（`write` / `edit` 两道都有）。实测（真实 `transferFile` + 无挂载根
  的主机）：`write` 到 `ssh://qiyk/etc/cron.d/…` 报 `FS_OUTSIDE_WORKSPACE`，同一拼写的上传
  却把暂存文件写到了那里；父目录是指向围栏外的符号链接时同样照落。现在上传与 `write`
  共用同一对可达性判定（`transfer.js` 的 `fenceUploadTarget`，在任何字节发出之前），
  递归上传对**每个创建的目录**同样判定（空目录树也不先落下越界的空目录）；工具与浏览器
  面板的 `POST /upload` 都传 `router.roots`，所以两条用户路径一起被堵。`roots` 未提供时
  跳过围栏、按纯字节搬运对待（单元测试的形态），这是显式设计而非疏漏。
  反向验证：注释掉这一行后 8 条断言变红，其中两条直接把 `{"ok":true}` 写到
  `/etc/cron.d/dsh-probe` 并 `mkdir` 出了 `/etc/cron.d`；浏览器路由单独反证 3 条变红。
- **远端 `workspace-write` 拒绝写 `/tmp`，本地却不拒绝**：本地的可写根集合
  `writableRoots(policy)` 除 `workspaceRoot` 外还列了常量 `/tmp` 与 `os.tmpdir()`，
  包里的注释明写「漏掉它就会拒绝这个模式本来承诺允许的写入」。远端没跟上这条：`/tmp`
  被判成「工作区外」，于是**远端构建全部写不了暂存文件，本地同一份构建正常**。现在
  `workspace-write` 的会话范围与挂载围栏都认该主机的 `/tmp`（写围栏专用的
  `writeFenceRoots`，原始挂载根 + `/tmp`）；放宽**只对已有挂载根的主机生效**——什么都没
  挂载的主机仍然不可达，「先挂载」没有变松；`danger-full-access` 一并受益，否则会出现
  「更宽的模式反而更窄」的非单调结果。读探针、`node:fs` 桥、停用围栏继续按原始挂载根
  作答，不受放宽影响。反向验证：把 `/tmp` 判定改回恒假后 5 条断言变红，其中上传那条
  直接把 `FS_OUTSIDE_WORKSPACE` 抛在了 `/tmp/build/artifact.o` 上。
- **策略读不懂的模式在远端＝放行，在本地＝一律拒**：三个被认可的模式
  （`read-only` / `workspace-write` / `danger-full-access`）**之外**的任意字符串——未来
  新增的模式名、fold 损坏出的值——此前会**同时跳过模式围栏与范围围栏**，只剩挂载根；
  命令面更糟，`effective !== READ_ONLY` 就放行，等于按最宽模式跑 `rm`。本地后端对同样
  的输入走 containment 分支且 `writableRoots` 返回 `[]`，即写与命令都拒。现在远端对齐：
  写入与命令统一拒，且文案**不谎称**这是用户选的「仅可查看」——切换到那个读不懂的值
  修不好，文案列出被认可的三个模式。`undefined`（策略服务完全缺席）仍是「不受限」。
  反向验证：命令面改回旧判据后 6 条断言变红，含一条
  `{"success":true,"exitCode":0}` 的 `rm -rf`；写入面改回放行后 8 条变红（含
  `withSftp=1` 与真实落盘）。
- **范围拒绝的文案指向一条一定会再失败的出路**：`workspace-write` 拒绝工作区外的目标时
  说「切到 danger-full-access 就能写主机上的其他路径」，但若该目标同时**未挂载**，切宽
  之后仍被挂载围栏拒绝——模型要走两步弯路才撞上真正的原因。这与上一条已修过的「归错因
  导致重试」是同一类缺陷，只是位置低了一层。现在这句话补上「前提是它也在某个已挂载工作区
  内，否则切换无用，先 mount」。
- **公告与文档与实际不符（本轮改行为的三处同步）**：模型公告里「写入范围限制在已挂载的
  远端工作区内」补上 `/tmp` 与「上传同样过这两道围栏」；`features.md` 的范围表补 `/tmp`
  行、未知模式一段、「两条写路径」的措辞改为已成立并写明此前缺哪两道；`architecture.md`
  / `protocol.md` / `tools.md` / `troubleshooting.md` 同步；`fs-shim.js` 里指向已删除的
  `assertModeAllowsWrite` 的注释指针改指 `mode-gate.js:writeModeRefusal`。
- **测试**：`mode-gate-smoke` 88 → 115 项（`/tmp` 在范围与可达两面、换主机不跟、
  伪 `/tmpish` 前缀不被误认、未知模式在判定函数 / 命令面 / 路由层三处、路由层拒绝时
  `withSftp=0`）；`transfer-smoke` 25 → 38 项（上传四道围栏 + 工具把 roots 传下去 +
  未知模式），其 SFTP 替身补 `lstat` / `realpath` 与符号链接表；`detach-smoke` 72 → 73 项
  （`/tmp` 可达性用 `danger-full-access` 证——`read-only` 下模式围栏先答、证明不了哪道
  围栏在说话）；`routes-smoke` 121 → 126 项（浏览器上传：挂载根外拒绝且不开句柄、
  不 mkdir、`/tmp` 放行、范围内照常成功），其替身补 `lstat` / `realpath`；
  `live-smoke` 的「围栏外」样本从 `/tmp/…` 移到 `/etc/…`（`/tmp` 现在可达、不再能证明
  挂载围栏）并新增一条真机写 `/tmp` 成功的断言（qiyk 实测 51 项通过）。
  裸检出合计 775 → 821 项，`DSH_CORE_ROOT` 下 938 → 984 项，全套 24/24。
  真机跑出的两条既有失败与本轮无关并已用 pristine worktree 对照确认：`watch` 断言假设
  远端无 `inotifywait`（qiyk 恰好没有，走轮询后 watch **解析成功**而非拒绝，HEAD 同样
  失败）；`acceptance-smoke` 在 `.asar-full` 树下装配即失败（`cannot get property
  "sandboxPolicy" without inject`，HEAD 逐条一致），它的头部条件本就要求「组装好的
  DSH 树」。
- **「仅可查看」没能挡住远端写入**：会话切到 `read-only` 后，`write` / `edit` 仍能改写远端
  文件，且**没有任何提示**。原因是本机沙箱的实现位于 `SandboxedFileSystem.checkedTarget`
  这个原型方法里，而插件用同名自有属性覆盖了 `writeText` / `editText`——远端分支根本不
  经过它，于是三档模式对远端写入完全一致。更糟的是模型的系统提示明确要求它「不要仅凭
  策略就拒绝，先试」，所以它会试、会成功，从它的视角看完全合规。
  现在 `#assertWritable` 先按 `sandboxPolicy.mode` 判定（`writeText` / `editText` 的**第五
  个参数**，宿主两个工具都传），`read-only` 以 `FS_SANDBOX_DENIED` 拒绝，文案与本地一致。
  `editText` 此前连这个参数都没接，一并补上。模式缺席时回落到后端 `sandboxMode`（部署
  默认），而不是被读成「不限制」。反向验证：移除这条判定后 6 条新断言立刻变红。
- **围栏外写入会被告知「在 danger-full-access 下被拒，可升权重试」**：挂载围栏与停用围栏
  过去都返回 `FS_SANDBOX_DENIED`，而宿主的 `tool-fs` 会把这个码**改写成**
  `[sandbox: file access denied under <mode> mode]` 加一句升权提示。于是出现两句都错的
  话：模式可能已经是最宽的，而升权也绝不会让一个目录变成已挂载。现在两者各用自己的码
  ——挂载围栏 `FS_OUTSIDE_WORKSPACE`、停用围栏 `FS_PERMISSION_DENIED`（仍是 403）——原文
  直达模型。反向验证：改回旧码后 2 条断言变红。`/download` 的状态码映射同步补上
  `FS_OUTSIDE_WORKSPACE` → 403。
- **`ssh_workspace_transfer` 的上传同样绕过了模式**：它是插件自己的工具，不经 `ctx.fs`，
  所以路由那层门禁看不到它——`read-only` 会话能上传文件，而同一会话的 `write` 已被拒。
  现在它在执行前从会话解析 `sandboxPolicy`（与宿主工具同一条路径），`read-only` 下拒绝上传；
  下载只读远端、写本机，不设门禁。策略服务**缺席**＝部署不受限（保持原行为），
  策略**解析失败**按 `read-only` 处理——拒绝一次可重试的上传，好过在「仅可查看」会话里静默写入。
  反向验证：移除门禁后 3 条断言变红（上传返回 `{ok:true}`）。
- **命令执行面完全不看模式（上一轮修复遗漏的主路径）**：上一条只补了文件写入，而插件改远端
  有**六条**互不共享调用链的路。真实会话里发生过：`read-only` 会话执行
  `ssh_workspace_exec { command: "rm /home/qiyk/test/test.py" }`，拿到 `[exit code: 0]`，
  同一会话的 `write` 却是会被拒的。现在新增 `lib/mode-gate.js`，`ssh_workspace_exec`、
  `ssh_workspace_shell`、以及 workdir 为 `ssh://` 的 `bash` / `pwsh`（`patch-shell.js`）
  共用同一份判定，`read-only` 下直接拒绝。
  **为什么是拒绝而不是围栏**：本机沙箱回答「这条命令能不能写」靠的是把**进程**限制在工作区
  根内的内核边界（bwrap / seatbelt / 受限 ACL 令牌），这些机制一个也跨不过 SSH；远端命令以
  远端登录用户的完整权限运行，没有哪个 seam 能接收一个 `workspaceRoot`。用文本匹配猜命令是否
  会写也不是边界（`sh -c 'rm -rf ~'`、`find -delete`、`python -c …` 都像纯文本）。所以要么允许
  任意远端命令、让模式成为空话，要么拒绝、让模式说真话——选后者，并在文案里写明原因与出路。
  读取不受影响（`read` / `glob` / `grep` 走 SFTP）。`ssh_workspace_shell` 的 `close: true`
  不受限：关闭不改变远端任何东西，否则「仅可查看」会连已开着的会话都关不掉。
  反向验证：把门禁改成空操作后 14 条断言变红，其中一条正是 `{"success":true,"exitCode":0}`。
- **`terminal_open` / 侧边栏终端是第六条没被堵的路**：上一轮把它记为「已知缺口」并称当前部署
  不可达——那个判断站不住。`ctx.subprocess.spawnTerminal` 的 spec 里确实没有 owner（只有
  `cwd` / `argv` / `env`），门禁不能装在那里；但它也不是单一入口，宿主有**两条**路会走到它：
  `terminal_open` / `terminal_send` 经 `ctx.terminals` → `dsh-terminal-bash`，而**内建侧边栏
  终端**（`dsh-api-terminal-controller`）**直接**调用 `spawnTerminal`，完全不经过
  `ctx.terminals`。所以「把门禁装在 `ctx.terminals.spawn`」这个结论是错的——它会漏掉第二条，
  而只测工具路径的用例仍会通过。门禁现在装在 `patch-terminal.js` 的路由里，那是两条路唯一的
  汇合点；会话身份取自 `spec.env.DSH_SESSION_ID`（两个调用方都写它），再用
  `ctx.get('agents').get(id)` 换成 session。
  判定分**两半**，因为只拒「打开」只能保护本来就处于 `read-only` 的会话：开 PTY 时拒绝且不建
  通道；handle 的每次 `write` 重新读模式，在 `workspace-write` 下开的 shell 被切成 `read-only`
  后立刻停止接受命令——这是实际更常见的顺序（先开终端干活，再收窄模式）。控制字节例外：
  SIGINT 与关闭路径必须可用，否则「仅可查看」会变成「连你已经启动的命令都停不掉」。
  反向验证：把两处门禁都改成空操作后 6 条断言变红，其中 `reached=1` 证明通道真的被打开了。
- **测试**：新增 `mode-gate-smoke`（88 项，覆盖三档模式的解析结果、六种组合的放行/拒绝、
  「拒绝时未触达主机」、后台路径、持久 shell 的 close 例外、本地 workdir 透传、
  终端开/写两道门禁与控制字节例外、`workspace-write` 的范围判定（会话内 / 兄弟根 / 跨主机根 /
  `..` 拼写 / 本地 root 不参与比较）、策略解析失败与真实 read-only 的文案可分性、
  以及路由层真的读这份判定（`withSftp` 调用计数）、公告一致性），
  `detach-smoke` 62 → 72 项（模式围栏 8 项 + 错误码可分性 2 项），
  `transfer-smoke` 21 → 25 项（工具级模式门禁：拒绝上传 / 允许下载 / 无策略 / 策略解析失败，
  以及上传的范围判定：会话内允许 / 会话外拒绝 / `danger-full-access` 放行），
  `live-smoke` 与 `acceptance-smoke` 各补 4 项真机 / 端到端断言。全套 24/24 通过。
- **下载失败被浏览器存成文件**：`GET /download` 在响应头发送前出错时回答
  **200 + JSON**，而浏览器半边只判 `response.ok`——于是
  `{"error":"remote file does not exist: /srv/x.txt"}` 被当作文件内容存了下来，
  文件名还是原目标名。触发条件不是理论上的：列目录后文件被删、改权限、或目标
  其实是目录，都会走到这条路径。改为按 `FsError` 码给出真实状态
  （`FS_NOT_FOUND` → 404、`FS_PERMISSION_DENIED` / `FS_SANDBOX_DENIED` → 403、
  目标不是普通文件 → 400、其余 → 500）：**状态码是浏览器的下载流程唯一认的信号**，
  200 一旦发出去，响应体就再也无法与之区分。`openRemoteRead` 里那两处
  裸 `Error` 也改成带 `FsError` 码的错误，否则「文件不存在」会答 500 并被读成
  服务端故障。反向验证：把状态码改回 200，3 条新断言立刻变红。

- **`workspace-write` 没有收窄到会话自己的工作区**：本地后端用 `writableRoots(policy)` 判定，
  第一项就是 `policy.workspaceRoot`；远端只问「是否落在**任一**已挂载根内」，而根集合是部署级的。
  后果实测确认：会话工作区在 `ssh://qiyk/home/dev/proj` 时，可以写同一主机上的兄弟根，
  也能写**另一台主机**上的已挂载根——这两种本地会话都做不到。现在 `#assertWritable` 在模式判定
  之后、挂载围栏之前加入范围判定（`workspaceWriteScopeRefusal`），`ssh_workspace_transfer` 的
  上传走同一份判定，两条写路径不会再分叉。
  此前文档给出的理由是**错的**，不只是遗憾：它说 workspace root「是这台机器上的路径」，
  对远端没有意义。实测 `SandboxPolicyService.resolve({ session })` 返回的是
  `session.header.cwd` 原样——远端会话拿到的就是 `ssh://qiyk/home/dev/proj`，可以直接比较。
  无 agent 的调用解析出的是部署的本地 root，那种拼写不参与比较（否则每个远端写入都会被误拒）。
  反向验证：把范围判定改成空操作后 10 条断言变红，其中 `withSftp=1` 证明写入真的到达了主机；
  上传路径另有 2 条变红并返回 `{"ok":true}`。三处文档（`features.md` / `architecture.md` /
  `protocol.md`）与 `troubleshooting.md` 的判据表同步改了那句假理由。
- **策略解析失败被说成「用户选了仅可查看」**：`sessionModeOf` 的 fail-closed 是对的，但拒绝文案
  过去一律说「会话沙箱模式是 read-only」。解析失败（例如 `node:path` 的 `ssh://` 补丁没装上，
  `resolve()` 就会对每个远端会话抛错）时，用户面板上明明是 `danger-full-access`，模型却被告知
  当前是仅可查看——而且「切换模式」这条建议根本无效，坏的正是解析器。
  新增 `sessionPolicyOf` 把原因一起返回，`assertRemoteCommandAllowed` 接受完整策略对象，
  文案改为说明这是接线问题、切换模式无用、并引用底层错误。真正的 `read-only` 文案不变。
- **`ssh_workspace_exec` / `shell` 的拒绝文案不再假装能升权**：文案仍不承诺
  `sandbox_permissions`（这一族工具没有该参数），但补上了「切换模式」的明确出路。
- **在对话框里拖选文字会「自己关掉」整个流程**（[#1](https://github.com/siqyka/dsh-ssh-workspace/issues/1)）：
  三个对话框（主机编辑、目录浏览、新建远程工作区）的遮罩都用 `onClick: onClose` 判定「点了外面」。
  而 `click` 的事件目标是**按下点与松开点的最近公共祖先**：在输入框里拖选一段文字、把鼠标拖到
  对话框外再松开，按下在对话框内、松开在遮罩上，浏览器照样把 click 派发到遮罩——于是选字选到
  一半，整个流程消失。现在三处共用 `backdropDismiss(close)`，判据改成**按下与松开都落在遮罩上**，
  按下点才是可靠信号。
  三个附带的取舍都不是风格问题：**只认主键**（`click` 从不为副键派发，不设这道门会凭空给右键
  加上「关掉面板」，而右键本该只弹菜单；松开侧刻意不设门，因为 touch / pen 的 `pointerup` 在部分
  引擎里报 `button: -1`，门住它会让触屏点空白再也关不掉）；**状态写在元素上且每次 `pointerdown`
  无条件覆写**（按下后拖出窗口松手时多数平台不派发 `pointerup`，靠松手清理会让残留标志漏进下一次
  手势，反而在从对话框内按下时误关）；**忙碌时拒绝关闭**（存盘 / 传输 / 创建接纳中），否则会把仍在
  进行的请求连同它唯一的反馈一起丢掉——主机编辑与目录浏览此前连这道门禁都没有，是本轮一并补的。
  反向验证：把按下点判定去掉 → 3 条变红（含「按下在对话框内、松开在遮罩」这一条）；去掉主键门 →
  2 条变红；任一处退回 `onClick` → 4 条变红。文档里也写清了**三个对话框都没有 Escape 关闭**
  （收紧遮罩后唯一出口是可见的按钮），加 Escape 需要处理下拉框吞键的先后，需真机浏览器验证，
  不在本版范围内。
- **测试**：新增 `backdrop-dismiss-smoke`（28 项：真实 helper 喂假事件跑五种手势 + 主键 / 副键 /
  触屏 `-1` 三条按钮规则 + 逐组件忙碌门禁 + 源码接线守卫）。裸检出 821 → **849** 项
  （增量正好是这一套），全套 **25/25**。
  `DSH_CORE_ROOT` 指向真实装配树时重新实测为 **1054** 项（含 `tool-schemas` 160、`boot` 29）——
  这个数字与本文档此前记录的 938 / 984 对不上：同口径下 `e4c6726` 基线实测是 980，而记录的
  「前一值」是 938，差 42 项，我不打算为它编一个原因。基准值以本轮实测为准：
  裸检出基线 775（与旧记录一致，方法没问题）、装配树基线 980。

### 文档

- **命令执行面受模式约束**：`features.md` 新增「命令执行是另一条独立的写路径」一节，
  列出六条改远端的路及各自的判定位置，并说明为什么是拒绝而非围栏（当时 `terminal_*` 仍为空缺，
  同轮稍后已补齐，见上一节的「`terminal_open` / 侧边栏终端是第六条没被堵的路」）；
  `protocol.md` 的围栏一节、`tools.md` 的通用约定、`troubleshooting.md` 的判据表同步补充。
  模型公告里「本机沙箱策略不适用于远端命令」那句原本是完整描述，现在补上
  「因此 read-only 下命令执行也被拒绝」——否则模型会把一条它没预料到的拒绝当成 bug 反复重试。
- **修正与实现相反的描述**：`ui.md` 原称「浏览目录」入口「目前屏蔽（去掉注释即可
  恢复）」，实际它从未被注释过——按钮无条件渲染、面板接上了回调、对话框按状态渲染，
  `git log -S` 只回溯到 0.1.16 的初始提交。这句话会让读者以为整套能力不存在，
  而它承载着逐行下载、目录内上传与挂载后的能力提示。同一页的文件右键菜单只写了
  「添加到任务」，漏掉下载与上传两项（它们只对远端行出现、目录行的下载是禁用态），
  「文件面板与文档预览」一节也没提插件往该面板注入的上传按钮。
- **计数修正**：`architecture.md` 的 POST 路由枚举写「转发六条」实为**七条**
  （`forward/probe` 是 GET，原来被误算进去又被总数抵消）；`features.md` 与
  `CHANGELOG.md` 的「两条传输路由」实为**三条**（`transfer` / `download` / `upload`），
  「三个列表有上限」实为**四个**（漏掉「已停用」）；`/forward/probe` 的方法在
  `features.md`、`CHANGELOG.md` 里写成 POST，源码是 `guard(…, 'GET')`。
  `unmount-modes.md` 把「160 项」算给了三个套件，它其实只是 `tool-schemas` 单独一项。
- **补全错误码**：`troubleshooting.md` 的错误码表少了 `FS_ABORTED`（源码共 13 个），
  `features.md` 的「同一套 `FS_*` 码」后面只列了 7 个却没说这是节选。本轮新增远端专用的
  `FS_OUTSIDE_WORKSPACE` 后，`features.md` 改为「同一套 `FS_*` 码 + 一个远端专用码」，
  `troubleshooting.md` 补上三行（模式拒绝 / 挂载围栏 / 停用围栏）与一张「你看到的 → 真实
  原因 → 怎么办」对照表，`protocol.md`、`architecture.md`、两份 README 的围栏表述同步更正。
- **澄清「沙箱不适用」的范围**：`architecture.md` 的「沙箱边界」一节说的是 `ctx.shell` /
  `ctx.subprocess` 的 spec，但字面上容易被读成「所有远端写入都不受模式约束」——那正是本轮
  修掉的 bug。已加注说明文件写入与命令执行在这一点的区别。
- **`CHANGELOG` 版本顺序**：`0.2.0`（10-14）曾排在 `0.2.1`（10-16）**之前**，
  与「新→旧」的全篇顺序相反，已按日期归位。
- **补全遗漏的能力描述**：「浏览目录」对话框此前在 `features.md` 与两份 README 里
  完全没有条目，尽管它自带逐行下载、目录内上传与就地挂载；`features.md` 的
  「浏览器内上传 / 下载」也只写了文件树右键一处入口，实际有三处（面板头部按钮、
  文件树右键、目录浏览器）。下载失败的状态码语义同样是新增能力，一并写进
  `features.md` 的传输表。
- **修正 `ui.md` 的同页自相矛盾**：上一轮改「浏览目录」条目时把「同一个组件」
  改成「两个不同的组件」，但下节原本写的就是「不是同一个组件」，两处措辞打架。
  已统一为「两个组件」，并说明 `DirectoryBrowser` 与 `RemoteWorkspaceDialog`
  各自的职责边界（只有后者过滤到目录、只有前者带传输）。
- **npm 页面上 12 个链接与头图全部失效**：`package.json` 的 `files` 只发 `lib/`、
  `cordis.patch.yml`、`README.md`，而 README 用相对路径链到 `docs/` 十篇、
  `CHANGELOG.md` 与 `docs/assets/header.png`。npm 打包页与仓库文件树没有对应关系，
  这些相对路径在那里一律 404，头图也不显示。两个 README 的全部仓库内链接与头图改为
  **绝对 GitHub URL**（在 npm 与 GitHub 上都能解析）；`docs/` 内部仍用相对链接，
  因为它们只在仓库里阅读。同时补上缺失的「许可证 / License」标题——目录里一直
  链着 `#许可证`，而正文只有页脚的一个 `div`，点击不跳转。
- **新增 `scripts/check-doc-links.mjs`**：校验相对链接能落到文件、`#锚点` 能对上标题
  （含跨文件）、仓库内的绝对 GitHub URL 也能落到工作树。后一类正是 npm 修订后
  最容易悄悄腐坏的一类——重命名一篇文档就会让已发布的 README 指向 404。
  反向验证：删掉「许可证」标题后它立刻报 `dead anchor README.md #许可证`。

### 测试

- `routes-smoke` 118 → **121 项**：下载失败必须是非 2xx、缺文件答 404、目录目标答 400。
  全套 `node tests/run.mjs` **24/24** 通过，活跃 19 个套件合计 **775 项**断言。
- **计数修正（清点暴露出的旧错误）**：此前多处文档写「活跃 18 个套件合计 683 项」，那是
  **错的**，两个独立原因叠加——上一轮新增的 `mode-gate-smoke`（46 项）根本没被算进总数，
  而 `secrets-smoke` 打印的是 `=== all checks passed ===`（不含 `N passed` 字样），历次
  按摘要行求和都把它的 26 项漏掉了。本轮改为按 `PASS` 行逐个数，实测 24 个套件、活跃 19
  个、742 项，`development.md` / `features.md` / `unmount-modes.md` 三处同步改为实测值。
  更早的版本段落保留当时的原始数字，不再回改。

## [0.2.4] - 2026-10-18

> 0.2.3 的 tag 已推送，但该版本从未出现在 npm 上（`npm view` 当时 latest 仍为 0.2.2），
> 因此 0.2.3 与 0.2.4 的全部改动都在本版首次发布到 npm。

### 修复

- **`Promise.withResolvers()` 让 CI 在 Node 20 上崩溃**：`lib/patch-terminal.js` 用了这个
  Node 22 才加入的 API，而 `package.json` 声明 `engines.node >= 20`、CI 也按 Node 20 跑。
  结果是终端句柄一创建就抛 `TypeError`，`terminal-smoke` 整套崩溃、CI 与 Release 全红——
  **自 0.2.3 把 PtyTerminal 加进来起就一直红**，0.2.3 因此压根没发出去（npm 上 latest
  停在 0.2.2）。本地 Node 是 v24，有这个方法，所以本机永远复现不出来。
  改为模块内的 `deferred()`（形状与该方法返回值一致），并保留一行注释说明为何不用
  现成 API——否则下一个人会"顺手简化"回去。
  验证方式：把 `Promise.withResolvers` 从全局删掉以模拟 Node 20，修复前终端套件抛
  `TypeError` 崩溃，修复后全套 23/23 通过。此后 CI 才是可信的。

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
  保存的 URL 会在下次启动时失真。新增 `GET /forward/probe` 做本地端口预检
  （`EADDRINUSE` / `EACCES` 分别给不同文案），但它只是提前告知原因，真正的权威
  仍是 `open()` 抛出的绑定错误。
- **面板列表上限**：主机、端口转发、已挂载工作区、已停用工作区**四个**列表超过 5
  条时改为滚动视口。
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
  `ctx.subprocess`、终端接管层与三条传输路由（`transfer` / `download` / `upload`）
  里同时生效，且都在建立连接**之前**
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

## [0.2.0] - 2026-10-14

### 新功能

- 新增 `POST /api/dsh-ssh-workspace/hosts/disconnect`：关闭指定别名的连接池连接；
  仍有在途操作时返回提示而不是强行断开。客户端主机卡片内联展示「已连接」状态，
  可按需断开。

### 变更

- HTTP 路由增至 10 条，`lifecycle` 套件的预期路由数同步更新。

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
