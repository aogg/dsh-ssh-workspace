# Windows SSH 远程工作区作业规约（dsh，给 LLM agent）

- 用途：当 dsh 会话工作区是 `ssh://<主机>/<Windows 盘符路径>`（Windows OpenSSH 主机）时，按本规约避坑作业。
- 来源：提炼自历史会话 `session-e8ce89e8-e16a-43cf-9905-1e69ccde2f3d`（工作区 `ssh://win/D:/code/www/gs/zuodian`）中真实发生的操作与报错，自动生成；只收录该会话实际踩到/验证过的坑，每条含现象与正确做法。
- 该会话远端环境基线：Windows OpenSSH，登录 shell = cmd.exe；已装 git，未装 ripgrep。

## 1. 文件检索：glob/grep 依赖远端 ripgrep，缺了整体失败
- 坑：远端没装 rg 时，glob/grep 工具直接报错退出，不返回部分结果：`glob search failed (exit 127): ssh-workspace: rg is not installed on this remote host`。这是环境缺失，不是路径写错，换路径重试无意义。
- 正确做法（按优先级）：
  - 能装就先给远端装 ripgrep（如 `winget install BurntSushi.ripgrep.MSVC`），装完 glob/grep 即恢复。
  - 不能装时用 `ssh_workspace_exec` 写 cmd 命令替代：列文件用 `dir /b /s <盘符路径>`，配 `| findstr /v /i "\\bin\\ \\obj\\"` 过滤构建产物噪音。
  - 搜内容用 `findstr /s /n /i "关键词1 关键词2" D:\dir\*.go`（多关键词空格分隔=或匹配），或 `git -C <仓库根> grep -n "关键词"`（远端有 git 时更好用）。

## 2. 命令方言：远端登录 shell 是 cmd.exe
- 坑：Windows OpenSSH 主机的命令在 cmd.exe 里执行，POSIX 命令（`ls`/`cat`/`grep`/`pwd`）会报「不是内部或外部命令」。
- 正确做法：
  - 列目录 `dir /b`（仅名字）、`dir /b /s`（递归）；搜内容 `findstr`；看文件 `type`；路径写盘符反斜杠 `D:\code\...`。
  - 多条命令用 `&` 连接（顺序执行，不依赖前条成功）：`dir /b D:\a & echo ---- & dir /b D:\b`。
  - cmd 的 for 循环变量是单百分号：`for %d in (a b c) do @(echo ===== %d ===== & dir /b /s D:\root\%d 2>nul)`（写成 .bat 文件才是 `%%d`）。
  - 丢弃 stderr 用 `2>nul`；过滤输出用 `| findstr /v /i "排除词"`。

## 3. bash 工具在 ssh:// Windows 工作区不可用
- 坑：会话工作区是 ssh:// 时，bash 工具会落到远端执行，但它自带的 bash 包装（先执行 `export` 再跑命令）不被 cmd.exe 认识。实测跑 `ver` 得到 `'export' 不是内部或外部命令`（返回乱码）、exit 1，目标命令根本没执行。
- 正确做法：远端命令一律用 `ssh_workspace_exec`（单条）或 `ssh_workspace_shell`（要保留 cd/变量时）；不要用 bash 工具发远端命令，也不要对着 `export` 报错反复重试。

## 4. exec 每次都是新 shell，cd/变量不保留
- 坑：`ssh_workspace_exec` 每次调用独立起 shell，上一条 `cd` 或 `set` 的变量下一条不存在。
- 正确做法：命令自带完整位置信息——绝对盘符路径、`git -C <仓库根> ...`；确实需要跨命令共享目录/变量（多步构建、装依赖）时改用 `ssh_workspace_shell` 持久会话。

## 5. 两套路径格式并存，别混用；工作区根 ≠ 仓库根
- 坑：read/write/edit 等 SFTP 工具用工作区相对路径（正斜杠，如 `zuodian/go/xxx/README.md`），远端命令用 Windows 盘符绝对路径（反斜杠）；把一种格式塞给另一边必失败。另外工作区挂载根不一定是 git 仓库根（本会话挂载根是 `D:\code\www\gs\zuodian`，仓库根是其下级 `zuodian\zuodian`）。
- 正确做法：文件工具传工作区相对路径；exec 命令传完整盘符路径；git 一律带 `git -C <仓库根>`，动手前先 `git -C <目录> rev-parse --show-toplevel` 确认仓库根。

## 6. 每条命令一次 SSH 往返，注意批量化
- 坑：每条 exec 都是一次 SSH 往返（局域网实测单次 55~373ms），一条条发又慢又碎片。
- 正确做法：相关的多条命令用 `&` 拼进一次 exec，中间用 `echo ----` 之类分隔符分段，一次拿全结果；只有依赖前条结果时才拆成多次调用。

## 7. 编码：远端 cmd 输出 GBK，报错可能乱码
- 坑：bash 工具通道返回的远端报错是 GBK 字节，显示成乱码（如 `'export' ?????ڲ???ⲿ???`）；`ssh_workspace_exec` 的正常输出（含 git log 中文提交说明）实测不乱——两条通道编码行为不一致，中文报错随时可能变乱码。
- 正确做法：见乱码先按「GBK 被错读」理解，别把乱码当业务错误分析；必要时命令前加 `chcp 65001 >nul` 切 UTF-8；从乱码输出里只提取可靠信号（命令名、exit code）。

## 8. 工具链以远端为准，先探测再假设
- 坑：远端工具集与 dsh 本机不一致（本会话：远端有 git、无 rg），按本地经验假设远端能力会连续撞墙。
- 正确做法：首次使用某命令前用 `where <命令>` 探测或直接小步验证；构建/测试依赖的工具链（go/node/php 等）先确认远端存在再跑；缺 rg 的替代方案见第 1 条。

## 9. 文件读写优先走 read/write/edit（SFTP），别绕命令
- 依据：会话内 read 经 SFTP 直读远端 README.md / config.yaml（含中文）全部成功，是整条链路里最稳的一层；大文件分块流式，不占远端 shell。
- 正确做法：能 read/edit 完成的读改就不要用 `type`/重定向拼命令；只有内容检索（第 1 条）和无文件语义的操作才走 exec。

## 10. 远端项目文件常含明文凭据
- 依据：会话读到的远端 config.yaml 类文件里直接写着数据库/Redis 明文密码。
- 正确做法：读取这类文件后，回复、文档、提交信息里一律省略或打码凭据字段，不原样转述、不落盘到其他文件。
