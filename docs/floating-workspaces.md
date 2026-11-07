# 浮动远端工作区

> 定位：一个项目可以配多条 SSH 远端，但不必让它们各占一行侧栏——在工作区
> ⋯ 菜单里配置，选中后以不透明卡片**浮动**在该项目的位置上显示。本文写清
> 交互、存储、路由与实现落点。

## 它解决什么问题

一个项目经常需要连好几台机器（开发机、测试机、生产只读机……）。按普通方式
挂载，每一条都会在侧栏工作区列表里多占一行：项目 A 下面挂着 A-dev、A-test、
A-prod，切到项目 B 时这三行仍在，列表很快被撑满，而它们其实**只属于 A**。

浮动远端把这条关系显式化：

- 配置挂在**某个父工作区（项目）**名下（存的是父工作区的 id），所以 A 的远端
  在 B 的菜单里根本看不到；
- 不浮动时，它的工作区行与会话行**不在**正常工作区列表里出现（少三行）；
- 选中时，一个不透明卡片**从左侧滑入**，盖住侧栏工作区列表区域，卡片里就是
  该工作区的**原生行**——新建会话、⋯ 菜单、重命名、删除、归档、收藏、拖拽，
  以及其它插件注入的菜单项全部照旧，因为那仍是 DSH 画的那个节点。

**已按普通方式挂载的 ssh 工作区保持原样**：只有通过本功能配置的条目才隐藏
原行、走浮动显示。这条边界是刻意的——否则装上这个版本，用户现有的侧栏会突然
少掉几行，而他并没有要求过。

## 交互总览

### 入口：工作区行 ⋯ 菜单 →「SSH 远程工作区 ▸」

注入点在 DSH 官方的工作区行「更多」菜单里（portal 挂在 `body` 的
`[role="menu"]`）。我们的块**追加在菜单内容区末尾**：一条分隔线 + 一级项
「SSH 远程工作区」+ 自绘二级子菜单。

二级子菜单的内容（该父工作区自己的条目）：

| 行 | 说明 |
| --- | --- |
| 每条配置 | 自动名 + `alias@host` 小字 + 状态徽标（浮动中 / 已挂载 / 未挂载 / 主机缺失）；点击 = 选中（必要时挂载）并进入浮动显示，菜单随即关闭 |
| ＋ 添加此项目的 SSH 远端… | 打开添加对话框（见下） |
| 管理… | 打开管理面板（改名 / 上移下移 / 测试连接 / 删除（可选同时注销工作区）/ 清理失效条目） |
| 退出浮动显示 | 仅当浮动显示的是**本项目**的条目时出现 |

键盘可达：注入的行是 `role="menuitem"` 的 button，位于官方菜单自己的
viewport 里，Tab / Enter / Escape 走官方菜单的漫游路径。

### 选中：挂载在需要时才发生

点击一条配置时：

1. `POST /api/dsh-ssh-workspace/mount`，携带 `{ alias, remotePath, title, register: true }`；
2. 同路径已注册则复用返回的 `workspaceId`（不会重复建条目）；
3. 成功才进入浮动显示。失败（主机不存在、目录不存在、连接失败、目录不可写）
   走插件既有 toast 报错，**不进入浮动**——把列表整块盖住却给一张空卡片，
   是比报错更糟的结果。

### 浮动形态：原生行 + 浮动皮肤

- 列表容器（`position: relative` 的树体）里插入一个**插件自有的**绝对定位层：
  不透明背景（`--dsw-alias-bg-layer-2`，实色主题层，从不 rgba）、圆角、细边框、
  prominent 投影、左侧 3px 强调色带、`min-height: 100%`——整块列表可视区都被
  盖上，下面留白也不透出被隐藏的行。
- 卡片顶部是**我们画的**头部条：`浮动` 徽标 + 配置名 + `alias@host` 小字 +
  右侧关闭 ×。头部有自己的不透明层（`bg-layer-3`）与下边hairline，树从头部
  下方开始（`margin-top: 46px`），行不会滑到头部下面。
- 进入时整块区域做一次 `transform: translateX(-100%) → 0`、约 140ms ease-out
  的「左滑」入场；`prefers-reduced-motion` 下关闭动画。
- 卡片内只剩该浮动工作区的 `workspace:<id>` 行、它的会话行与它的折叠按钮；
  其它工作区行（含未分组桶）与会话行由一条 `display: none !important` 隐藏。
  行的原生交互全部保留。

### 退出

- 按头部 ×；
- 菜单里的「退出浮动显示」；
- 点开别的会话行 / 工作区行（自动退出，见下）；
- 在浮动的行上把该工作区**删除**：下一趟装饰 pass 发现工作区已不在注册表里，
  自动退出浮动，配置保留为「未挂载」。

刷新页面即退出浮动（浮动状态只在页面内存里），但**被隐藏的行仍按配置隐藏**
——隐藏是配置驱动的，不是一次性动作。

### 自动进入：点开会话就进入

浮动中的条目，其工作区行在非浮动时是隐藏的，所以从搜索或链接打开它的会话时
侧栏会看不到它。因此点击任何属于某个浮动配置条目的会话行，会自动进入该条目
的浮动显示（已经挂载着，不需要再挂）。反向也成立：点开其它会话行或别的
工作区行会退出浮动。

同时只有一个浮动；再选另一个直接切换（头部与内容随状态重绘）。

### 标题维度的隐藏

除侧栏行外，还有两处只有**标题**、没有 id 的表面：工作区选择器菜单行、会话页
hero 的工作区按钮。非浮动时，属于浮动配置条目的标题（来自注册表标题，回退到
远端路径 basename）在这两处一并隐藏。判定还要求该标题在本插件 marks 的远端
标题集合里（`remoteMarks.titles`），所以一个恰好同名的**本地**工作区不会被误伤。
浮动中不隐藏这两处——那正是看清"我现在在哪个工作区"的地方。

## 添加对话框

独立于侧栏「远程工作区」面板也能打开：它渲染在 `shell.overlay` 槽里，所以从
⋮ 菜单进去时不需要先开面板。一次完成「选主机 → 浏览远端目录 → 确认」：

1. 读 `GET /hosts`（含 `~/.ssh/config` 回退主机），默认选中第一台；没有主机给
   空态并提示先去面板添加；
2. 目录浏览复用 `GET /ls`，只列目录、按名排序、面包屑可点、可返回上级；主机配了
   `defaultPath` 时从那里开始；
3. **没有名称输入框**——名称自动生成，对话框只在目录字段下方预览将要得到的名
   字；
4. 确认后 `POST /floating/save`，成功即 toast「已添加『…』」并关闭。添加只是
   **配置**：不会挂载，也不会进入浮动（选中菜单项才挂载）。

## 管理面板

同一套对话框基础设施里的管理视图，按父工作区列出条目：

| 操作 | 语义 |
| --- | --- |
| 改名 | 写回配置的 `title`。**只改配置**：已注册的 DSH 工作区保留它自己的标题（用户可在原生行的 ⋯ 里重命名），下次新挂载时用配置名。与父工作区同名的改名自动追加 ` #2`、` #3`，不会出现两行同名 |
| 上移 / 下移 | `POST /floating/reorder`，回传整份 id 顺序，两个条目不会落成同一个位置 |
| 测试连接 | 复用 `POST /test`（连一次即释放），结果走 toast，附带往返毫秒数 |
| 删除 | 就地展开确认行；勾选「同时注销该 DSH 工作区」时，走与面板「卸载」**同一条** teardown 路径（`deregister`：停根 + 注销记录 + 归档会话 + 清停用标记），随后删除配置 |
| 清理失效条目 | 批量删除 `hostMissing` / `parentMissing` 的条目，清完报数 |

空态、加载中、错误三种状态都在（列表自己显示，不依赖面板）。

## 存储

`$DSH_HOME/dsh-ssh.json` 新增顶层段 `floating`：

```json
{
  "floating": [
    {
      "id": "fl-1a2b3c4d5e6f",
      "parentId": "<父工作区的 DSH workspace id>",
      "parentPath": "<父工作区路径，仅展示用>",
      "alias": "qiyk",
      "remotePath": "/home/qiyk/proj",
      "title": "proj · qiyk",
      "order": 0,
      "createdAt": 1730000000000,
      "updatedAt": 1730000000000
    }
  ]
}
```

归一化规则（`floatingOf`，见 `lib/store.js:651`）：

- 不是对象、缺 `id` / `parentId` / `alias`、`remotePath` 不是绝对路径的条目**整条
  丢弃**，错误只落在这一条上；
- `remotePath` 规范化（折叠 `//`、去尾斜杠、解 `..`）；`parentPath` 缺省为 `''`；
- `title` 缺省按自动名补齐；`order` 非数按 0；重复 id 保留第一条；
- 按 `order` 排序返回，等值按文件顺序；
- **读不懂的 `floating` 段退化为空数组**，绝不拖垮同一文件的 `hosts` /
  `secrets` / `knownHosts` / `forwards` / `workspaces`（`floating()` 读取失败同样
  返回空数组）。

### 自动命名

`basename(remotePath) + ' · ' + alias`（`autoFloatingTitle`，`lib/store.js:563`）：

| remotePath | alias | 名字 |
| --- | --- | --- |
| `/home/u/proj` | `box` | `proj · box` |
| `/D:/code/www` | `win` | `www · win` |
| `/D:/` | `win` | `D: · win` |
| `/` | `box` | `box`（远端根没有 basename，退化为别名） |

同一个父工作区下重名时追加 ` #2`、` #3`……（`uniqueFloatingTitle`，
`lib/store.js:590`）。改名同样走这套去重，所以重名不会落成两行同样的标签。

## 路由

全部挂在既有 `/api/dsh-ssh-workspace/*` 下，走同一套 guard（仅回环 + Host 头
校验 + POST 必须 JSON），没有独立端口：

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `/floating/list` | GET | 全部条目（可带 `?parentId=`），每条带上 join 后的状态：`workspacePath` / `workspaceId` / `workspaceTitle` / `parentTitle` / `mounted` / `disabled` / `registered` / `hostMissing` / `parentMissing` / `registryReady` / `hostAddr`（`user@host`）/ `hostTarget`（`host[:port]`）/ `hostOs` |
| `/floating/save` | POST | `{ parentId, parentPath?, alias, remotePath, title? }`；未知主机 400、相对路径 400；同一父工作区 + 同一 host + 同一目录**幂等**（返回既有条目，`created: false`） |
| `/floating/update` | POST | `{ id, title?, parentId?, parentPath?, alias?, remotePath? }`；改父工作区时排到新父的末尾；未知 id 404 |
| `/floating/delete` | POST | `{ id, deregister? }`；`deregister: true` 先按 `deregister` 模式 teardown 对应工作区（与「卸载」同一条路径），再删配置 |
| `/floating/reorder` | POST | `{ parentId, ids }`，该父的条目按 ids 重编号 0..n，其它父不动 |

状态判定的来源：`router.listRoots()` / `listDisabled()`（挂载与停用）、
工作区注册表（注册 id / 标题 / 父工作区是否存在）、`HostStore.rows()`（主机是否
存在、地址、`os`）。注册表**读不到**时 `registryReady: false`，此时
`parentMissing` 一律为 `false`——"探不到"不是"已删除"，不能让用户据此删掉一条
好配置。

## 实现落点

| 位置 | 内容 |
| --- | --- |
| `lib/store.js:563` / `:590` | `autoFloatingTitle` / `uniqueFloatingTitle`（纯函数） |
| `lib/store.js:651` | `floatingOf`：段归一化与排序 |
| `lib/store.js:1170` – `:1324` | `floating()` / `putFloating` / `updateFloating` / `deleteFloating` / `reorderFloating`（全部走 `#withDocumentLock` 与原子写） |
| `lib/routes.js:139` | `ROUTES.floating*` 五条路由常量 |
| `lib/routes.js:683` / `:720` | `floatingRowOf` / `floatingRows`：存储与实时状态的 join |
| `lib/routes.js:1358` – `:1494` | 五个 handler |
| `lib/routes.js:488` | `teardownWorkspace`：`unmount` 与 `floating/delete` 共用的拆解序列 |
| `lib/client.js:4383` | 浮动段的标记属性 / 图标 / 状态变量（本段开头有完整的设计说明） |
| `lib/client.js:4711` / `:4746` | `floatingMembership` / `floatingRowHidden`：隐藏集合的两个纯判定 |
| `lib/client.js:4773` | `passFloatingDisplay`：行隐藏 + 卡片的一趟对齐 |
| `lib/client.js:5114` | `installFloatingMenu`：⋯ 菜单注入（捕获 → pending → 追加 + 夹取） |
| `lib/client.js:4972` / `:5050` | `renderFloatingSubmenu` / `positionFloatingSubmenu` |
| `lib/client.js:5308` / `:5502` | `FloatingAddDialog` / `FloatingManageDialog` |
| `lib/client.js:5765` | `installFloatingWorkspaces`：装配 + 自动进入 / 退出点击桥 + disposer |
| `lib/client.js`（注入样式表） | 「floating remote workspaces」段的全部样式：卡片 / 头部 / 菜单块 / 对话框行；对话框本身在 `apply()` 里注册进 `shell.overlay` 槽 |

## 降级与已知限制

| 情况 | 行为 |
| --- | --- |
| 核心改了工作区「更多」按钮的 aria 模板或 `data-row-key` | 捕获不命中：菜单保持原样（少一项），浮动永不激活；不报错、不坏页 |
| 核心改了菜单 viewport 的类名 | 退化为往 `menu` 本体追加，仍能出现；位置可能略偏 |
| 注册表不可达 | 行不隐藏、浮动不激活（身份未知就不猜）；已有卡片保持最后一趟的状态，下一趟重试 |
| 浮动的目标被删除 | 自动退出浮动，配置保留为「未挂载」 |
| 父工作区被删除 | 条目保留为孤儿（管理面板标「父工作区已删除」），可删除或「清理失效条目」；重新绑定走 `floating/update` 的 `parentId`（后端已支持，界面暂不提供目标选择器） |
| 主机被删 / 改名 | 条目标「主机缺失」，管理面板可一键清理 |
| 页面刷新 | 退出浮动，但被隐藏的行仍隐藏（配置驱动） |
| 同时只有一个浮动 | 再选另一个直接切换 |
| 桌面上同一会话从搜索直接打开 | 会自动进入其浮动显示（点击路径）；不经过点击的入口不触发 |
| 侧栏处于搜索 / 折叠态 | 找不到工作区树时不画卡片，也不隐藏任何行（骨架不在就不硬套） |

## 相关

- [ui.md](./ui.md) — 界面出入口总览
- [features.md](./features.md) — 按能力域的功能清单
- [被扩展说明.md](./被扩展说明.md) — 对 DSH 官方菜单的注入契约与共存说明
- [unmount-modes.md](./unmount-modes.md) — 「同时注销该 DSH 工作区」走的同一条拆解路径
