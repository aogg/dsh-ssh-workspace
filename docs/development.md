# 开发、调试与发布

> 定位：从源码到装进 profile 生效的完整流程。

## 源码结构

纯 loader 插件，无构建步骤：宿主半边是原生 ESM，浏览器半边是手写的单文件 bundle（`lib/client.js`，由 DSH 前端的 `window.__ModuleLoader__.load({id, factory})` 约定直接加载，不经打包器）。

| 文件 | 职责 |
| --- | --- |
| `lib/index.js` | 插件入口：`name` / `inject` 声明、引擎装配、`ctx.inject(['fs'])` 接管时序、工具与路由注册、系统提示公告 |
| `lib/engine.js` | SSH 引擎：按别名维护持久连接与 SFTP 通道、连接池、空闲回收、`exec` 远端命令 |
| `lib/remote-fs.js` | SFTP 文件系统后端：实现 `ctx.fs` 的远端方法（stat / 读写 / 列目录 / 原子写 / 流式读 / 变更监视等），`FsError` 语义与本地后端对齐；变更监视优先 `inotifywait` 推送，无则轮询 |
| `lib/protocol.js` | `ssh://` 路径：解析、规范化、`file:` URI、前缀判定、basename / dirname |
| `lib/patch-fs.js` | `ctx.fs` 接管：把远端方法装到部署已有的后端实例上，其余方法原样转发 |
| `lib/patch-shell.js` | `ctx.shell` 接管：`workdir` 为 `ssh://` 的 spec 改在远端执行（复用引擎连接），其余原样转发给本地执行器；实现 seam 的 handle 契约（`done` / `result` / `observed` / `kill` / `onExpiry` / `signal`） |
| `lib/patch-subprocess.js` | `ctx.subprocess` 接管：`cwd` 为 `ssh://` 的 spawn 在远端执行（rg/git 白名单、POSIX 脚本组装、seam handle 契约、TERM→KILL 阶梯）；scratch 镜像注册表（env 改写 + 远端 `mkdir -p`），供 fs 桥的 `rm`/`copyFile` 联动 |
| `lib/patch-terminal.js` | 终端接管：会话工作区是 `ssh://` 时把 PTY 开在远端；受停用围栏约束 |
| `lib/fs-shim.js` | 内建桥接：`node:fs/promises` 的 `mkdir`/`stat`/`lstat`/`realpath`/`readdir`/`copyFile`/`open`/`rm` 与 `node:path` 的 `isAbsolute`/`resolve`/`join`/`relative` 对 `ssh://` 拼写单独处理（含 `syncBuiltinESMExports`）；变更追踪的 SFTP 读句柄与 scratch 镜像落盘/联动，`readdir` 服务 `@` 补全 |
| `lib/hosts.js` | 主机解析：存储优先、`~/.ssh/config` 回退、行渲染 |
| `lib/secrets.js` | 凭据存储：密码 / 私钥口令的读写与清除，与 `hosts` 分区分离 |
| `lib/forward.js` | 端口转发引擎：listener 与 `forwardOut` 隧道的建立 / 拆除、按主机拆除（`closeForAlias`）、`holds` 引用计数 |
| `lib/forward-persist.js` | 已存映射：**意图**（`enabled`）与**事实**（`live`）分离、启动时自动开启、`closeById` / `closeAlias` 两条断开路径（后者逐条走前者） |
| `lib/transfer.js` | 文件传输：本机 ↔ 远端的流式 SFTP 拷贝与目录树上传（原子发布） |
| `lib/store.js` | `$DSH_HOME/dsh-ssh.json` 存储：校验、合并（保留未知字段）、原子写 |
| `lib/routes.js` | 浏览器半边的 22 条 HTTP 路由（hosts / save / delete / forget-key / disconnect / test / ls / status / mount / unmount / enable / forward / unforward / forward-save / toggle / delete / remember / probe / settings / transfer / download / upload） |
| `lib/shell.js` | 远端持久 shell 会话：`cd` / 导出变量 / 后台任务跨调用保留 |
| `lib/tools.js` | 10 个 `ssh_workspace_*` Agent 工具（schema / 渲染 / 执行） |
| `lib/peers.js` | 宿主依赖（`@deepseek-ai/*`、`ssh2`）的定位与加载 |
| `lib/client.js` | 浏览器半边：面板、添加工作区流程、标记装饰、全部样式与中英文案 |

## 依赖解析

`ssh2` 是本包的直接依赖（随 `npm install` 安装）；`@deepseek-ai/cordis`、`@deepseek-ai/dsh-fs`、`@deepseek-ai/dsh-tools` 声明为 peer，插件运行时由 `lib/peers.js` 按以下顺序定位（每处先找 `node_modules/<pkg>`，再直接按包名 require；结果按目录记忆化）：

1. 本包自身依赖树（总是先试，覆盖一切其它来源）；
2. 环境变量 `DSH_PEER_ROOT`（支持多路径，以 PATH 分隔符分隔）；
3. `DSH_PROFILE_DIR`（profile 目录）/ `DSH_PROFILE`（profile 名）；
4. `$DSH_HOME/profiles/<name>/node_modules`，profile 名依次取 `desktop`、`default`、`web`；
5. 应用内回退：`process.resourcesPath` 与 `process.execPath` 下的 `resources/app.asar/dsh/node_modules`、`resources/app/dsh/node_modules` 等，兼容 Electron 打包布局。

profile 安装（`pnpm install`）会让第 1 步命中 profile 内的解析链；直接从源码检出处加载时，依赖不在本包树下，需显式给 `DSH_PEER_ROOT` 指向加载器的 `node_modules`。

## 调试

两个半边都无编译步骤，"改完即所测"：

- **宿主半边**（`lib/*.js`，除 client）与 `client.js` 的**样式/文案**：改动进入已安装位置后重启 DSH 生效。调试源码检出的宿主半边可用 DSH 自带的 Electron 运行时：以 `ELECTRON_RUN_AS_NODE=1` 运行宿主源码脚本，并设 `DSH_PEER_ROOT` 指向 DSH 安装目录的 `node_modules`（参考 [architecture.md](./architecture.md) 的「peer 解析」顺序）。
- **浏览器半边**：`client.js` 由 DSH 前端按单文件包加载，改动需重装进 profile 并重启 DSH，再重载页面；文件头注释里写明其加载协议，无独立构建管线。

日志走 Cordis logger（`ctx.logger`），前缀 `ssh-workspace:`；面向模型的能力公告见 `lib/index.js` 的 `SSH_WORKSPACE_GUIDANCE`。

## 冒烟测试与 CI

`tests/` 下是一组按依赖分层的冒烟套件；`node tests/run.mjs` 依次以子进程运行
全部套件（也可 `node tests/run.mjs live acceptance` 只跑指定套件）。共 23 个套件，
断言数如下（下表按裸检出实测，`DSH_CORE_ROOT` / `DSH_WS_TEST_ALIAS` 未设置时
5 个套件 SKIP，其余 18 个套件合计 666 项断言）：

| 套件 | 前置 | 项数 | 覆盖 |
| --- | --- | --- | --- |
| `protocol-smoke` | 无 | 27 | `ssh://` 语法、规范化、前缀判定、basename / dirname、`file:` URI |
| `client-shape-smoke` | 无 | 57 | package.json 的 `dsh.client` / `exports` / `files`、bundle 装载约定、`node --check` 解析、停用工作区的会话收集行为、悬停提示文案 |
| `tree-transfer-smoke` | 无 | 41 | 目录树上传、原子发布、递归与失败路径 |
| `insert-once-smoke` | 无 | 18 | 拖入文件的 chip 只插入一次（HMR 重复插入的回归） |
| `locale-register-smoke` | 无 | 21 | 中英词典注册、重复注册不污染、`translate` 回落 |
| `detach-smoke` | 无 | 62 | 停用清单读写与脏数据退化、路径包含判定、`ctx.fs` 十个方法逐个断言被拒、重新启用两条路径、shell / terminal 拒绝且不拨号、工作区外照常可用、跨分区写入隔离、启用不得经过围栏探测 |
| `probe-smoke` | 无 | 15 | 内建桥三条身份探针无活连接时不拨号、挂载根外必须 `ENOENT`、有连接时取真实属性、broken 记录不算连接（直接数 `withSftp` / `acquire` 次数） |
| `phase6-smoke` | 无（有真框架时更全） | 36 | 失败与规模路径的回归：断连 close 不误判完成、rename 回退不误删目标、`listDir` 无 N+1 stat、`StreamTail` join 缓存 |
| `store-lock-smoke` | 无 | 15 | 主机存储的跨进程写锁：互斥与降级、死锁接管、并发 `mutateHosts` 不丢条目、`save()` 的替换语义 |
| `transfer-smoke` | 无 | 14 | 单文件传输的流式拷贝、原子替换、失败清理 |
| `shell-smoke` | 无 | 18 | 远端持久会话：`cd` / 变量 / 后台任务跨调用保留、关闭与超时 |
| `terminal-smoke` | 无 | 23 | 终端接管：`ssh://` cwd 的 PTY 开在远端、围栏拒绝、还原 |
| `transport-smoke` | 无 | 17 | 传输路由与流式通道（第二条 SFTP 通道、退化路径） |
| `forward-smoke` | 无 | 34 | 隧道本身：建立 / 拆除、`closeForAlias` 按主机拆除且**只拆该主机**、`holds` 引用计数、关闭转发不得断开主机 |
| `forward-persist-smoke` | 无 | 102 | 已存映射：意图 / 事实分离、端口预检三态、占用端口不落盘、自动开启幂等、连接断开留痕、**主动断开主机与端口行「断开」逐字段一致**（`live` / `enabled` / `error` 三元组） |
| `capabilities-smoke` | 无 | 19 | 主机能力探测（rg / git / inotifywait）与提示渲染 |
| `routes-smoke` | 无 | 121 | 22 条路由的请求 / 响应契约、两种卸载模式、归档、停用围栏、`sessionIds` 强制转字符串、断开必须连带拆除转发且走 `closeAlias`、下载失败必须是非 2xx |
| `secrets-smoke` | 无 | 26 | 凭据存储与加密、迁移、`~/.ssh/config` 明文兼容、密钥文件按需创建 |
| `lifecycle-smoke` | `DSH_CORE_ROOT` | SKIP | 真实 Cordis 下 5 种服务装配顺序的接管 / 路由 / 工具注册（期望 22 路由 / 10 工具） |
| `boot-smoke` | `DSH_CORE_ROOT`（远端段另需 `DSH_WS_TEST_ALIAS`） | SKIP | 生产顺序引导、`ctx.fs` 接管与还原、工具端到端、挂载 → 停用 → 读被拒 → 启用往返 |
| `tool-schemas-smoke` | `DSH_CORE_ROOT` | SKIP | 工具 schema 过真实 `assertSupportedJsonSchema` + render 冒烟 |
| `live-smoke` | `DSH_WS_TEST_ALIAS`（peers 可解析） | SKIP | 远端 SFTP 全量契约、写围栏、错误语义、原子写、symlink |
| `acceptance-smoke` | `DSH_CORE_ROOT` + `DSH_WS_TEST_ALIAS` | SKIP | 经补丁后 `ctx.fs` 的端到端验收（挂载 → 读写 → 围栏 → 卸载） |

环境变量（全部可选；未设置时对应套件 SKIP 并以 0 退出）：

- `DSH_CORE_ROOT`：含 `@deepseek-ai/*` 与 `ssh2` 的 `node_modules` 树（可从已安装应用组装）。套件从中取真 Cordis / dsh-fs / dsh-tools，并把同一路径转告 `DSH_PEER_ROOT` 供插件解析 peers。
- `DSH_WS_TEST_ALIAS`：存储 / `~/.ssh/config` 里可用的主机别名（不内置任何真实主机）。
- `DSH_WS_TEST_DIR`：远端暂存父目录（默认 `/tmp/dsh-ssh-workspace-test`）。

裸检出（无任何环境变量）`node tests/run.mjs` 会跑**依赖 `routes.js` / `remote-fs.js`
的那些套件**——`tests/peer-stubs.mjs` 自动生成最小 peer stub 根，让它们真正运行而不是
跳过（跳过的套件无法失败，正是这样一次跳过让一个调用了未导入函数的 upload 处理器
绿着发了出去）。只有需要**真实框架**的三个套件（`lifecycle` / `boot` /
`tool-schemas`）与需要真实主机的两个（`live` / `acceptance`）仍 SKIP 并给出原因。
这正是 CI 的形态，23/23 报告成功。
CI（`.github/workflows/ci.yml`）在 push / PR 上执行：`npm ci --ignore-scripts`
（`.npmrc` 的 `legacy-peer-deps` 使锁文件只含 ssh2 运行时树，`@deepseek-ai/*`
peer 由宿主提供）→ `node --check` 全部 `lib/*.js` → `node tests/run.mjs` →
`node scripts/check-doc-links.mjs` → `npm pack --dry-run`。

## 文档链接

`node scripts/check-doc-links.mjs` 校验三类目标，它们坏掉的方式各不相同：

| 类型 | 校验 | 为什么会坏 |
| --- | --- | --- |
| 相对路径 | 能从该文件所在目录解析到磁盘上的文件 | 改名或删除页面 |
| `#锚点` | 能在**同文件**（跨文件时在目标文件）的标题里找到 | 改了标题却忘了目录里那一条 |
| 仓库内的绝对 GitHub URL | 路径部分能落到工作树 | 重命名 `docs/` 下的文件 |

第三类是根 README 才有的形态，且**不能改回相对路径**：`package.json` 的 `files`
只发 `lib/`、`cordis.patch.yml` 与 `README.md`，而 npm 的包页面与仓库文件树没有
对应关系，`./docs/features.md` 在那里会解析成 `npmjs.com/package/…/docs/features.md`
——十篇文档、`CHANGELOG.md` 与头图全部 404。绝对 URL 在 npm 与 GitHub 上都能解析，
所以根 README 用绝对拼写，`docs/` 内部仍用相对拼写（只在仓库里阅读）。

CI 与 Release 都跑这个脚本：它守的是「已发布到 npm 的 README 不会指向 404」，
而那正是本地 `github.com` 上看起来一切正常、在 npm 上却全是死链的一类问题。

## 打包与安装

```
npm pack                                    # 生成 shiqyka-dsh-ssh-workspace-<version>.tgz
# 编辑 profile 的 package.json：@shiqyka/dsh-ssh-workspace 的依赖改为 file:<tgz 绝对路径>，并同步版本号
# 在 profile 目录执行 pnpm install             # 解包进 profile 的 node_modules
# 重启 DSH
```

要点：

- 包内容由 `package.json` 的 `files` 白名单控制：`lib/`、`cordis.patch.yml`、`README.md`。
- 每批改动**升一个 patch 版本号**，tgz 文件名随之变化，profile 依赖指向也要同步。
- 客户端接管依赖 `dsh.bundle.patch`（`cordis.patch.yml`）与 `dsh.client.platform: web` 声明，改动这些元数据同样需要重装。
- 不打包、不安装时，源码改动不影响已安装副本——已安装版本始终以 profile 内 `node_modules` 为准。

## 相关

- [architecture.md](./architecture.md) — 机制与 peer 解析细节
- [根 README](../README.md) — 安装与能力概览
