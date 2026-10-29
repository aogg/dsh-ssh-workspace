# Agent 提示词三级配置

> 定位：为远程工作区会话自动合并 agent 系统提示词的三级配置——全局 → SSH 主机 →
> 工作区；配置存哪、如何展开合并、如何禁用上一级条目、脚本协议是什么、
> 注入走的哪条 API、什么时机刷新生效。

## 概览

挂载的远程工作区可以配置若干「提示词材料」（dsh 宿主机本地的 md 文件），插件把它们
合并成一段文本，注入给**工作区内所有会话**的系统提示词。材料在三个层级上配置，
按固定顺序展开合并：

```
全局（插件级）→ SSH 主机级（每台 host 一份）→ 项目级（每个已挂载工作区一份）
```

典型用法：全局放团队通用规范，主机放该机器特有的约定（如路径布局、服务清单），
工作区放项目专属指引；下一级可以按条**禁用**上一级某条，也可以新增自己的条目。

## 存储格式

配置保存在共享存储 `$DSH_HOME/dsh-ssh.json` 的**新增顶层段 `agentPrompts`** 里
（与 `knownHosts` / `secrets` / `forwards` / `workspaces` 并列，本插件自有、不与
DSH 其它 SSH 工具共享语义）：

```json
{
  "version": 1,
  "hosts": [ … ],
  "secrets": { … },
  "knownHosts": { … },
  "agentPrompts": {
    "global": {
      "globs":   [{ "id": "g-1a2b3c4d", "pattern": "/data/notes/**/*-common/*.md" }],
      "scripts": [{ "id": "s-4d3c2b1a", "command": "node /data/gen-prompts.js" }],
      "disabled": []
    },
    "hosts": {
      "myserver": {
        "globs":   [{ "id": "g-…", "pattern": "/srv/wiki/*.md" }],
        "scripts": [],
        "disabled": ["g-1a2b3c4d"]
      }
    },
    "workspaces": {
      "ssh://myserver/srv/proj": {
        "globs": [],
        "scripts": [{ "id": "s-…", "command": "sh /srv/proj/.prompts.sh" }],
        "disabled": ["s-4d3c2b1a"]
      }
    }
  }
}
```

- **向后兼容**：旧文件没有 `agentPrompts` 段时按「三级全空」运行，行为与升级前完全
  一致；段内容读不懂时降级为空（与 `forwards` / `workspaces` 段同一容错策略），
  `hosts` / `secrets` / `knownHosts` 等现有字段不受任何影响。
- **id 稳定且从内容派生**：glob 条目 id = `g-` + sha256(pattern) 前 8 位 hex，
  脚本条目 id = `s-` + sha256(command) 前 8 位。id 在读取/保存时总是重算，手工编辑
  文件漏写 id 也能正常跑；**修改条目内容会改变它的 id**，下一级指向旧 id 的禁用
  记录因此失效（孤儿 id 不禁用任何东西，保存该级配置时被清除——这是有意的：内容
  改了就是另一条配置）。
- 每级字段：`globs[]`、`scripts[]`、`disabled[]`。每类条目每级上限 64 条，
  `disabled` 上限 512 条；非法条目（空串、glob 非绝对路径等）在归一化时**丢弃**
  而不是报错——损坏的配置不能拖垮主机存储与面板。
- 工作区键是**规范拼写** `ssh://<别名>/<规范化路径>`（`ssh://a/x/../x` 与
  `ssh://a/x` 是同一个键）。

## 合并算法

对某个工作区（别名 `A`，路径 `P`）：

1. **取三级配置**：`global` → `hosts[A]` → `workspaces[P]`（缺席按空级处理）。
2. **禁用过滤**（见下节）后得到生效条目序列，顺序固定：
   全局 globs → 全局 scripts → 主机 globs → 主机 scripts → 工作区 globs →
   工作区 scripts（每类内部按数组顺序）。
3. **逐条展开**：
   - glob 条目：在 dsh 宿主机本地文件系统上展开（支持 `**`（独占一段时跨任意层）、
     `*`、`?`、`[a-z]` / `[!a-z]`；点开头文件无特殊待遇）。命中**普通文件**才加载
     （目录不加载；符号链接指向文件算文件，指向目录不追以避免环）。结果按字典序
     排序，保证合并顺序稳定。整段无通配符的模式视为「指名单个文件」。
   - 脚本条目：见「脚本协议」。
4. **去重**：跨所有条目按绝对路径去重，**保留首次出现**（顺序决定加载位置）。
5. **读取与包裹**：逐个读为 UTF-8，每个文件严格按下面的格式包裹（包裹块之间以
   换行连接；文件内容末尾没有换行时补一个，保证结束标记独立成行）：

   ```
   ----[<文件绝对路径>]---start
   <文件内容>
   ----[<文件绝对路径>]---end
   ```

6. **加前置说明**后成为该工作区的 section 文本（无任何命中时为空串，section
   在渲染时被整体丢弃，零开销）。

防失控护栏：单文件超过 1 MiB 跳过并记告警；合并结果超过 400,000 字符停止加载
并记告警（告警可在面板「预览展开结果」里看到，也会记录在合并缓存结果里）。

### 禁用语义

- `disabled` 记录的是**上一级条目的 id**：主机级可以禁用全局条目；工作区级可以
  禁用全局**和**主机条目。下一级的条目不会被上一级禁用。
- 禁用 = 该条**整体不生效**（它的文件全部消失），不是覆盖或改写；上一级的存储
  不受影响，恢复勾选即整条回来。
- 同一条目被多级同时禁用时，任意一级禁用即生效。

## 脚本协议

- **在哪跑**：dsh 宿主机本地（与 glob 同一侧），POSIX 用 `sh -c`、Windows 用
  `cmd /c`，工作目录为 `$DSH_HOME`。
- **输出契约**：stdout 必须是 JSON——`{"files": ["/abs/a.md", …]}` 或裸数组
  `["/abs/a.md", …]`。元素必须是非空**绝对路径**字符串（相对路径没有解析基准，
  直接丢弃）；自动去重。
- **失败语义**：非零退出码、超时（30 秒，SIGKILL）、stdout 超过 1 MiB、JSON 解析
  失败、输出形状不对——全部变成**可读的告警**（含条目 id、退出码、stderr 尾窗
  400 字符或 stdout 头 200 字符），该条产出为空；**绝不炸合并、绝不炸面板、
  绝不炸服务**，其余条目照常展开。告警在面板「预览展开结果」中可见。
- 脚本列出的文件不存在时同样记告警并跳过该文件。

## 注入机制（为什么是 `systemPrompt.section`）

调研了 dsh 本体（`@deepseek-ai/dsh`）可用的注入面后，选择了 **`systemPrompt`
服务的动态 section**：

- dsh 的 `@deepseek-ai/dsh-system-prompt` 提供 `systemPrompt.section({ name, order,
  text })`，其中 **`text` 可以是函数**，由 agent 循环（`dsh-agent-loop` 的
  `preStep`）在**每个模型步**调用 `systemPrompt.assemble()` 时求值；组装上下文带
  `context.agent.session.header.cwd`——正是「会话在哪个工作区」的判定依据。
- 本插件已有同一先例：工具指引 section（`plugin:dsh-ssh-workspace`）就是用
  `ctx.get('systemPrompt')` 注册的。三级提示词 section（`ssh-workspace:agent-prompts`，
  order 950，位于文件引用指引与读工具指引之间）注册方式相同，不依赖任何
  hooks.json / SessionStart 外部机制，不改宿主。
- 空 `text` 在渲染管线里被过滤，所以本地会话与未配置的远程会话零开销。
- **没有选择** `.dsh/rules/` 写文件的退化方案：正式 API 存在且已验证
  （`dsh-agent-loop` → `assemble` → `renderPrompt` → 会话面上的 system 消息），
  写文件方案还要处理清理、远端写权限、与其它 rules 的混淆，劣势明显。

**运行中的会话是否回灌？——会。** `assemble()` 每个模型步重新求值 section text：
配置保存触发缓存失效并重算后，**正在运行的会话在它的下一个模型步就拿到新提示词**。
呈现方式由模型路由能力决定（`dsh-agent-loop` 的 `SystemPromptProjection`）：
deepseek 路由声明 `systemPromptUpdate: "in-history"`，变更后的提示词作为新的
system 消息追加进历史；不支持的路由则替换首个 system 节点。两条路径都不需要
重开会话。缓存按（工作区, 配置指纹）对齐，配置未变时每步只做一次 Map 查找。

## 刷新时机

合并结果按（工作区, 配置内容哈希）缓存在内存（`lib/agent-prompts.js` 的
registry）；哈希覆盖该工作区相关的全部三级配置（含各级 `disabled`）。

| 时机 | 行为 |
| --- | --- |
| 插件启动 / dsh 重启 | 注册 section；对 registry 里已登记的远程工作区异步预热缓存。首个模型步若缓存未就绪，该步返回空串（无此 section），下一步到位 |
| 保存全局配置 | 失效全部缓存 → 立即重算所有已挂载工作区 |
| 保存主机配置 / 主机增、改（含改名）、删 | 失效该别名相关缓存 → 重算该主机的已挂载工作区；改名时配置随新别名（存储层 `renameHostAgentPrompts`） |
| 保存工作区配置 | 失效该工作区缓存 → 立即重算该工作区 |
| mount / re-mount / enable | 成功后立即重算该工作区（新会话第一步就带上） |
| unmount / detach | 删除该工作区的缓存条目（围栏已拒绝一切操作，section 因根匹配失败自然为空） |
| 会话启动 | 无需动作：cwd 前缀匹配最长已挂载根 + 缓存命中即注入；未命中触发异步重算 |
| 运行中的会话 | 见上节——下一个模型步生效，无需重开 |
| md 文件内容本身变化 | **不会**自动触发（缓存键是配置哈希，不是文件 mtime）；在面板改一下该级配置（保存）或重挂载即可重算。这是有意的取舍：监控任意远端/本地文件变化成本高且边界模糊 |

## 面板入口（三个）

1. **全局**：「远程工作区」面板 → 「Agent 提示词」区 → 「全局配置」。
2. **主机级**：主机「添加 / 编辑」对话框 → 「Agent 提示词（本主机，可选）」折叠区，
   随主机表单一起保存（不展开 = 不动已有配置；改名后配置自动跟到新别名）。
3. **工作区级**：面板「已挂载的工作区」每行的「提示词」按钮。

主机级与工作区级的编辑界面都能看到**上一级的条目**（全局；工作区级还能看到其
主机级），取消勾选即禁用、重新勾选即恢复。「预览展开结果」选择一个已挂载工作区，
当场展开 glob、执行脚本，显示将加载的文件清单与告警——预览的结果同时会预热缓存。

## 路由

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/api/dsh-ssh-workspace/agent-prompts` | GET | 整份配置（三级，归一化后）+ 已挂载根列表 |
| `/api/dsh-ssh-workspace/agent-prompts/global` | POST | 替换全局级 `{globs, scripts}` |
| `/api/dsh-ssh-workspace/agent-prompts/host` | POST | 替换主机级 `{alias, globs, scripts, disabled}` |
| `/api/dsh-ssh-workspace/agent-prompts/workspace` | POST | 替换工作区级 `{workspacePath, globs, scripts, disabled}` |
| `/api/dsh-ssh-workspace/agent-prompts/preview` | GET | `?workspacePath=…` 即时展开，回 `{files, errors, chars}` |

条目在请求体里可用字符串（`"/a/*.md"`）或对象（`{pattern}` / `{command}`）；
`disabled` 为 id 数组。所有 POST 与其它面板路由一样受回环 + Host + JSON
content-type 三重围栏约束。

## 生效条件（改代码 / 改配置分开看）

- **改配置**（面板操作或手改 `dsh-ssh.json`）：只需保存。宿主半边每次合并前都重新
  读存储文件，web 面板按「保存」刷新；运行中的会话下一个模型步生效，**无需重启
  dsh、无需刷新 web、更无需强刷**。手改 JSON 后连保存都不用点（无配置内容哈希
  之外的额外状态），但浏览器里已打开的编辑对话框不会自动回填，重新打开即可。
- **改插件代码**（本仓库 `lib/**`）：profile 以 `link:` 方式安装本包
  （`/root/.dsh/profiles/web/package.json` 里
  `"@shiqyka/dsh-ssh-workspace": "link:/code/www/my/github/dsh-ssh-workspace"`；
  `ls -i` 对比 profile 安装点与仓库的 `lib/client.js` 为同一 inode，宿主加载的
  就是这份内容）。两个半边都不热载：
  - **宿主半边（`lib/index.js` / `agent-prompts.js` / `store.js` / `routes.js`）**
    在 dsh 进程启动时加载，**要重启 dsh 才生效**（只刷新 web 没用）。
  - **客户端半边（`lib/client.js`）** 由 `dsh-client-modules` 按文件元数据
    （mtime/ctime/size → rev）装配，rev 更新走 HMR watch（`rebuilt()`，只在 dev
    构建链下运行）。生产形态没有 watcher，重启前 rev 不变，**同样要重启 dsh**。
  - **重启 dsh 之后**，web 端**普通刷新即可**：client 模块 URL 自带 rev，rev 变了
    缓存键就变了，无需强刷（强刷无害但非必需）。

## 相关

- [hosts.md](./hosts.md) — 存储格式与共享约定
- [architecture.md](./architecture.md) — 客户端半边与路由注册
- [ui.md](./ui.md) — 面板结构
