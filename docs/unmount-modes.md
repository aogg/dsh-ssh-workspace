# 工作区卸载：保留、置灰与删除会话

> 状态：**方案，未实施**。端口转发部分已落地，卸载部分只落这份文档。
>
> 本文覆盖需求 3 与 4：
> - 需求 3：卸载时是否连带删除工作区记录与会话，做成开关
> - 需求 4：卸载后对应记录置灰，并提供「启用」按钮

---

## 一、结论先行

| 子需求 | 可行性 | 依据 |
| --- | --- | --- |
| 卸载时只摘挂载、保留工作区记录 | ✅ **现在就能做** | 服务端已支持 `deregister: false`，只是 UI 写死为 `true` |
| 卸载时删除工作区记录 | ✅ 已实现 | `registry.delete(entity.id)` |
| 卸载时删除**会话** | ⚠️ **受限于宿主无公开 API** | 见 §四 |
| 卸载后置灰 + 启用按钮 | ✅ 可行 | 需新增一份持久化的「已停用」清单，见 §五 |

一句话：**需求的 3 和 4 里，只有「删除会话」是有硬阻塞的**，其余都是常规工程。而「置灰」有一个不明显的陷阱——它不能靠删除登记来实现，反而**必须保留登记**。

---

## 二、现状核实

### 卸载当前做了什么

服务端（`lib/routes.js`，unmount 路由）：

```js
const wasMounted = router.removeRoot(workspacePath)   // ① 内存：从 served-root 移除
if (deregister) {                                      // ② 持久：删登记
  const entity = registry?.list?.().find(c => c.path === workspacePath)
  if (entity !== undefined) await registry.delete(entity.id)
}
```

路由本身**已经支持** `deregister: false`：请求体里 `deregister !== false` 才执行 ②。也就是说「只卸载、不删登记」今天就能用。

真正的问题在 UI：面板把参数写死了。

```js
// lib/client.js，handleUnmount
body: JSON.stringify({ workspacePath, deregister: true })
```

所以用户点一次卸载，两件事同时发生，且无法选择。

### 两个动作的性质完全不同

| 动作 | 位置 | 生命周期 | 影响 |
| --- | --- | --- | --- |
| `removeRoot()` | `remote-fs.js` 的 `this.roots`（Set） | **进程内** | 该路径的写入被围栏拒绝 |
| `registry.delete()` | DSH 的 workspace registry | **持久** | 侧边栏那行消失，重启不再恢复 |

`removeRoot` 只是撤销「这个远端目录归我管」的写授权。它**不删远端文件、不断 SSH 连接**，读路径（`readText`/`stat`）也不受 roots 围栏约束——只有写受 `#assertWritable` 约束。这个区分对下面的设计是前提。

### 会话文件没有丢，只是失去了归属

在用户的磁盘上核对过 `ssh://qiyk/home/qiyk/test`：

| 项目 | 数量 |
| --- | --- |
| `sessions/--ssh-qiyk-home-qiyk-test--/` 下的会话目录 | 10 |
| `workspace.json` 里该工作区登记的 `sessionIds` | 3 |
| 未被任何工作区登记的孤儿会话 | 7 |

孤儿会话的 `session.v4.jsonl.zstd` 表头里 `cwd` 确实是该 `ssh://` 路径，内容完好。**它们是在工作区登记之前用该 cwd 开出来的会话**，登记发生时没被带上，之后一直是孤儿。

这一点直接决定了删除会话的范围必须显式定义：只删会计内的会漏掉孤儿，连孤儿一起删则可能删掉别的用途遗留的数据。

---

## 三、需求 3：「卸载并删除会话」的开关

### 三态语义

卸载对话框给三个选项，默认第一项：

| 选项 | `deregister` | 删会话 | 可恢复性 |
| --- | --- | --- | --- |
| **仅卸载**（默认） | `false` | 否 | 重启后自动恢复，会话全在 |
| **卸载并删除工作区记录** | `true` | 否 | 登记没了，会话文件仍在（成为孤儿） |
| **卸载并删除工作区记录与会话** | `true` | 是 | **不可恢复**，需输入工作区标题确认 |

第一项是真正安全的默认值：它对应上一轮回答里说的「用 `deregister: false` 即可保住登记与旧会话关联」。

### 为什么第一项安全

`index.js` 的启动恢复循环会遍历 registry，把所有 `ssh://` 项重新 `addRoot`：

```js
for (const entity of registry.list()) {
  const path = String(entity?.path ?? '')
  if (!isRemotePath(path)) continue
  activeRouter.addRoot(parts.alias, parts.remotePath)
}
```

`deregister: false` 保住了登记，于是重启后自动「复活」，连同 `sessionIds` 里的会话关联一起回来。代价是「列出但不可用」的中间状态：侧边栏还看得见，但文件打不开（写被围栏挡住）。这个中间状态正是需求 4 要处理的。

### 硬阻塞：DSH 没有删除会话的公开 API

逐个查过宿主包：

| 包 | 提供的方法 | 有无删除 |
| --- | --- | --- |
| `dsh-session-persistence` | `create` / `open` / `stat` / `list` / `flush` | **无** |
| `dsh-workspace` | `delete(id)` | 有，但文档明写「retaining its directory and every session log」 |

全 asar 搜 `deleteSession` / `session/delete`，只命中 `dsh-experimental-inspector` 的 devtools chunk 和 `session-query-sqlite` 的内部缓存裁剪——都不是公开 API。

**结论：想删会话，只能绕过服务层直接动磁盘。**

### 一次完整删除要清 5 处

漏任何一处都会留下脏数据：

| 位置 | 内容 |
| --- | --- |
| `<DSH_HOME>/sessions/<project>/<sessionId>/` | `session.v4.jsonl.zstd` |
| `storages/session_projcache/sessions/<sessionId>.json` | 投影缓存 |
| `workspace.json` 的 `global.archivedSessionIds` / `pinnedSessionIds` | 归档与置顶集合 |
| 工作区实体的 `sessionIds` | 会计关系 |
| session-manager 的标注 / 归档账本 | 若装了该插件 |

此外还必须先确认会话**没有在跑**——运行中的 live writer 持有租约，强删会损坏正在写的日志。

### 两条路线

#### 路线 A（推荐）：委托给已安装的 `dsh-session-manager`

用户 profile 里有 `dsh-session-manager@0.7.1`，它已经把这套活干完了。读过它的实现顺序：

```
POST /session-manager/api/delete  { sessionId }
  1. 发现并递归删除子智能体会话
  2. 身份与目录校验（防路径穿越、防符号链接）
  3. 停止仍活着的会话
  4. 先删子、后删父
  5. detachFromWorkspaces + unarchiveSession
  6. rm -rf 会话目录
  7. 清标注与归档账本
  8. 写投影缓存
```

自己在插件里重写一遍等于重造这个轮子，还会漏掉它已经踩过的坑。

**探测方式**：`ctx.get('sessionManager')` 不一定存在（它是 HTTP 插件，未必 provide 服务），所以要走 HTTP 内部调用，或退化为「检测包是否安装」再请求自身 webServer。

#### 路线 B（保底）：自己做，但只做安全子集

如果 session-manager 不在：**直接拒绝「删除会话」选项**，并明确告知「需要安装 dsh-session-manager，或先用它删除会话」。

绝不半删。半删会留下「登记已删、文件还在」的孤儿——用户的磁盘上已经有 7 个这种孤儿了，不该再制造。

### 会话范围必须显式定义

- **会计内**：`entity.sessionIds`（该工作区登记了 3 个）
- **孤儿**：header `cwd` 等于该路径但未被会计的（同一台机器上还有 7 个）

建议默认只删会计内的；孤儿单独给一个「同时清理 N 个未归属会话」的勾选项。孤儿可能是别的用途遗留的，静默删掉是灾难。

### 事务化

删除是不可恢复操作，必须先在只读阶段把所有校验跑完（会话存在、未被占用、路径在预期根内），再进入执行阶段。任何前置校验失败就整体拒绝，不进入部分删除。

---

## 四、需求 4：卸载后置灰 + 启用

### 关键发现：置灰不能靠删除登记

直觉做法是「删掉登记，再在 UI 里把它画成灰的」。这不成立——**登记删掉后，DSH 侧边栏那行就消失了**，灰行无处安放。

所以必须反过来：**保留 registry 登记，只 `removeRoot`**（即 `deregister: false`）。DSH 照常渲染那行，我们再通过已有的 DOM 装饰机制把它改成灰的。

### 但这会引入一个新 bug

`index.js` 的启动恢复循环会把 registry 里**所有** `ssh://` 项重新 `addRoot`。于是：

> 用户点「卸载」→ 重启 → 工作区**自己又活了**。

这正好是需求 4 要避免的。所以需要一个**持久化的「已停用」清单**：

```jsonc
"workspaces": {
  "settings": { "deleteSessionsOnUnmount": false },
  "disabled": ["ssh://qiyk/home/qiyk/test"]
}
```

恢复循环加一行跳过：

```js
if (disabledSet.has(path)) continue
```

**这才是需求 4 真正需要新增的状态。** 灰行本身不需要新状态——`detached = registry.paths − mounted` 已经能算出来。

### 置灰怎么画

复用现成的 `passRemoteMarks()`（`lib/client.js`）：

1. `/status` 增加 `disabled: string[]`
2. MutationObserver 那一轮里，对命中 disabled 的 workspace 行打 `data-sshwsp-disabled="1"`
3. CSS：`opacity: .45` + 行尾一个小标记「已断开」，`cursor` 保持可点

**不要拦点击。** 拦截 DSH 的行点击属于和宿主抢控制权，宿主一改版就会崩。只做视觉，操作入口放在插件面板里。

### 启用的完整动作

```
enableWorkspace(path):
  1. 从 store.workspaces.disabled 移除该路径
  2. router.addRoot(alias, remotePath)
  3. registry 里若有同 path 的实体 → 复用；没有 → createCanonical
  4. 可选：回填旧会话（默认关闭）
  5. 刷新 /status 与置灰
```

第 4 步的代价：`attachSession` 会 `realpath` + `stat` 校验 header 的 `cwd`，并要求结果**逐字等于** `record.path`。**主机此刻不可达时必然失败**。所以默认关闭，做成「恢复历史会话」复选框，失败时逐条报错而不是整体失败。

插入顺序也有坑：`attachSession` 总是 prepend，批量回填会把旧会话倒序插入，需要额外排序。

---

## 五、风险清单

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| 删会话无官方 API | 只能落盘删除，易留脏数据 | 优先委托 session-manager；缺失则拒绝该选项 |
| 半删 | 「登记已删、文件还在」的孤儿 | 事务化：先全量校验，再执行；校验失败整体拒绝 |
| 重启自动复活 | 卸载形同虚设 | `workspaces.disabled` 持久标记 + 恢复循环跳过 |
| 置灰拦截宿主行 | 宿主改版即崩 | 只做视觉，不拦点击 |
| 主机不可达时回填会话 | `attachSession` 必然失败 | 默认关闭；逐条报错而非整体失败 |
| 孤儿被静默删除 | 误删他处数据 | 孤儿单独勾选，默认不删 |
| 「列出但不可用」的中间态 | 用户以为能用、实际写入被拒 | 置灰 + 「已断开」标记 + 面板「启用」按钮 |
| 多进程并发写 store | 分区互相覆盖 | 沿用 `withFileLock`（store.js） |

---

## 六、实施顺序

排在端口转发之后，因为「保留登记」的卸载模式是「删除会话」模式的前提；反过来做会先写出一个删登记的破坏性路径。

| 批次 | 内容 | 验证 |
| --- | --- | --- |
| **1** | `store.js` 新增 `workspaces` 分区（`disabled` 列表 + `deleteSessionsOnUnmount`） | 新增 `workspace-prefs-smoke`：分区互不覆盖、并发写、脏 JSON 不覆盖他人分区 |
| **2** | `index.js` 恢复循环跳过 disabled；`/status` 暴露 `disabled` | `lifecycle` 扩充：重启不复活 |
| **3** | 三态卸载对话框；`deregister` 由选择决定 | 新增 `unmount-modes-smoke`：三种模式的请求参数、默认值、第三项需输入标题 |
| **4** | 委托 session-manager 删会话；缺失时拒绝 | `unmount-modes-smoke` 扩充：缺 session-manager 时拒绝、孤儿不静默删 |
| **5** | 置灰装饰 + 面板「启用」按钮 | `insert-once-smoke` 扩充：置灰装饰幂等、不重复挂监听 |

批次 1–2 是纯后端，可独立验证；批次 3 才动 UI。

---

## 七、与端口转发实现的一致性

已落地的端口转发（`lib/forward-persist.js`）确立了一个模式，本方案沿用：

| 概念 | 端口转发的做法 | 卸载的对应做法 |
| --- | --- | --- |
| 意图（用户想要什么） | `forwards.items[].enabled` | `workspaces.disabled` |
| 事实（现在是什么状态） | `ForwardManager.list()` | `router.listRoots()` |
| 二者分开存 | 是 | 是 |
| UI 按**事实**标注按钮 | 「关闭」只在有 listener 时显示 | 「启用」只在未挂载时显示 |
| 启动时按**意图**恢复 | `autoStart` 开关 | 恢复循环跳过 disabled |
| 失败要留痕 | `failures` Map → 行内 `error` | 回填会话逐条报错 |

核心原则相同：**按钮文案由事实决定，启动行为由意图决定。** 否则重启后连接还没建立、按钮却显示「关闭」，就是谎报。
