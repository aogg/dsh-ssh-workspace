/**
 * The auto-injected "local-exec" skill: the model catalog entry that explains
 * how to run a command on THIS machine while the session workspace is a
 * remote `ssh://` one.
 *
 * Why a skill and not more announcement text: the workdir-routing rule is one
 * sentence ("the workdir decides"), but the judgment around it is not — which
 * channel is unambiguously remote, what the mode fences refuse, which way a
 * port forward points, and the classic mistakes (local paths inside a remote
 * command). Announcement lines must stay short; a skill loads on demand and
 * can carry the full decision table.
 *
 * Visibility: `invocation: { modelInvocable: true, userInvocable: false }` —
 * the Web skill menu filters on `userInvocable`, so the skill stays out of the
 * input box while staying visible in the model's skill catalog and loadable
 * through the skill tool. `source: 'runtime'` is REQUIRED: the host's
 * `validateDefinition` rejects a registration without it, and the skill tool
 * then fails on every load of the body.
 *
 * Failure posture mirrors the plugin's other optional-surface wiring: no
 * `skills` service (or a failing `register`) means a logged warning and a
 * skipped registration — never a broken plugin load. The registration result
 * is reported into the caller-supplied `state` sink so the HTTP route and the
 * panel can show what actually happened.
 *
 * @module @shiqyka/dsh-ssh-workspace/local-exec-skill
 */

/** The skill's stable name in the model catalog. */
export const LOCAL_EXEC_SKILL_NAME = 'local-exec'

/**
 * The registration payload, as one function so the skill registration, the
 * `/skill` route and the panel all read the same text (no second copy to
 * drift).
 *
 * @returns {object} a fresh payload for `skills.register()`.
 */
export function localExecSkillPayload () {
  return {
    name: LOCAL_EXEC_SKILL_NAME,
    description: '命令执行落点判定：bash / pwsh 的 workdir 决定命令在本机还是远端执行——会话工作区是 ssh:// 时，显式传一个本地 workdir 即在本机执行，不必经过 SSH',
    // dsh-skill validateDefinition 强制要求 source 为字符串；'runtime' 是官方
    // SkillSource 枚举值，缺失则 skill 工具加载正文报错
    source: 'runtime',
    whenToUse: '要操作的命令目标在 DSH 本机而不是 SSH 远端时加载：$DSH_HOME、本机 docker、127.0.0.1:3080 的 DSH 本体接口、本机 git 仓库、http-shell 等本机服务；'
      + '或远端缺少所需工具、需要回本机执行时；以及不确定「这条命令到底会落在哪台机器」需要判定时',
    content: [
      '# 本机执行不走 SSH（workdir 决定落点）',
      '',
      '装了 dsh-ssh-workspace 插件、会话工作区是 `ssh://` 远端路径时，bash / pwsh 调用落在哪台机器**只由 workdir 参数决定**：',
      '',
      '- workdir 落在 `ssh://` 根内 → 远端执行；**会话工作区是远端时，不传 workdir 的默认值就是远端**；',
      '- workdir 是本地路径（如 `/tmp`、本机项目目录）→ 本机原执行器执行，完全不过 SSH。',
      '',
      '所以要「在本机跑」，只需给 bash / pwsh 调用**显式传一个本地 workdir**：',
      '',
      '```',
      'bash { command: "docker ps", workdir: "/tmp" }',
      '```',
      '',
      '## ① 目标在哪，命令就在哪跑',
      '',
      '先判断命令的目标在哪台机器，再选 workdir：',
      '',
      '- 目标是 DSH 本体（`127.0.0.1:3080` 的接口、`$DSH_HOME`、本机安装的插件）、本机 docker、本机 git 仓库、',
      '  http-shell 等本机服务 → 本机 workdir；',
      '- 目标是远端工作区里的文件 / 构建 / 进程 → `ssh://` workdir（或干脆不传，让默认值落在会话工作区）。',
      '',
      '## ② 通道辨析（不是所有通道都看 workdir）',
      '',
      '- `ssh_workspace_exec` / `ssh_workspace_shell`：**明确远端**——参数里就写着主机别名，不经过本机；',
      '- `glob` / `grep` 的远端桥：仅把 `rg`（搜索）与 `git`（变更追踪）转发到远端执行，其余子进程不走桥；',
      '- 终端（`terminal_open`）：cwd 是 `ssh://` 时 PTY 开在远端，本地 cwd 开在本机；',
      '- bash / pwsh：唯一「workdir 即开关」的通道，本技能的主角。',
      '',
      '## ③ 围栏（模式照旧生效，只是各自管各自那半边）',
      '',
      '- 会话是 **read-only** 时：一切远端命令执行都被拒绝（`ssh_workspace_exec`、`ssh_workspace_shell`、',
      '  远端 workdir 的 bash/pwsh、远端终端全在内——本机沙箱无法限制远端进程，只能拒绝）；',
      '  **读取不受影响**（read / glob / grep 走 SFTP）。要跑命令请把会话切到 workspace-write 或 danger-full-access；',
      '- 本机命令（本地 workdir）仍按**本机**沙箱模式围栏，与没有装本插件时完全一样；',
      '- 远端命令以**远端登录用户的完整权限**运行，不受本机文件沙箱约束（本机的 sandbox_permissions 跨不过 SSH）；',
      '  workspace-write 也收窄不了远端命令（限制进程需要内核边界，它跨不过 SSH），收窄的是文件写入。',
      '',
      '## ④ 端口转发的方向',
      '',
      '- `ssh_workspace_forward`（远端 → 本机）：把**远端**端口映射到本机 localhost，用于打开远端 dev server；',
      '  本插件**没有反向（本机 → 远端）转发工具**——远端侧要访问本机服务属于网络层问题（如远端经局域网',
      '  直达本机 IP），不经本插件解决；隧道随 SSH 连接存活，连接断开即关闭，可重新打开。',
      '',
      '## ⑤ 易错点',
      '',
      '- 远端命令里不要引用本机路径：`ssh_workspace_exec { command: "ls /tmp/x" }` 的 `/tmp/x` 在**远端主机**上，',
      '  不是本机的 /tmp——两边是两台机器，各有各的文件系统；',
      '- 临时文件各归各主机：远端构建的暂存文件放**远端**的 /tmp（该主机 /tmp 在写围栏内），本机脚本的暂存放本机 /tmp；',
      '- 远端通道不是绕过沙箱的手段：read-only 会拒绝，其余模式下命令以远端用户全权运行——',
      '  它比本机围栏**更宽**而不是更窄，别把本该本机做、受围栏保护的事推到远端去做。',
    ].join('\n'),
    // 宿主 skills/list（Web 技能菜单）与用户点名注入按 userInvocable 过滤：
    // false = 输入框技能菜单不显示，仅模型技能目录与 skill 工具可用
    invocation: { modelInvocable: true, userInvocable: false },
  }
}

/**
 * Register the skill once and report the outcome into `state`.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context
 *   (`ctx.logger` for the warn/info lines, `ctx.reflect.get('skills')` for the
 *   registry).
 * @param {{registered: boolean, payload: object | null}} state - the caller's
 *   sink, updated in place so the `/skill` route and the panel can show the
 *   registration verdict without reaching into the host registry.
 * @returns {Function} the effect cleanup: unregisters the skill and resets
 *   the sink (safe to call even when registration was skipped).
 */
export function installLocalExecSkill (ctx, state) {
  const logger = ctx?.logger
  const skills = ctx?.reflect?.get?.('skills')
  if (skills === undefined || skills === null || typeof skills.register !== 'function') {
    // No skills service is a legitimate deployment shape (host builds without
    // the skill registry). Warn so the absence is visible, skip, and leave the
    // sink reporting "not registered" — the panel route says the same.
    logger?.warn?.('ssh-workspace: skills service unavailable, the "local-exec" skill is not registered (workdir guidance lives in the system-prompt announcement only)')
    if (state !== undefined && state !== null) {
      state.registered = false
      state.payload = null
    }
    return () => {
      if (state !== undefined && state !== null) {
        state.registered = false
        state.payload = null
      }
    }
  }

  const payload = localExecSkillPayload()
  let disposeSkill = null
  try {
    disposeSkill = skills.register(payload)
    if (state !== undefined && state !== null) {
      state.registered = true
      state.payload = payload
    }
    logger?.info?.('ssh-workspace: skill "local-exec" registered (model catalog only — hidden from the Web skill menu)')
  } catch (error) {
    // A failing registration must not break the plugin load, but it must not
    // vanish either: the warning carries the reason for the panel's
    // "not registered" state to point at.
    logger?.warn?.(`ssh-workspace: skill "local-exec" registration failed: ${error instanceof Error ? error.message : String(error)}`)
    if (state !== undefined && state !== null) {
      state.registered = false
      state.payload = null
    }
  }

  return () => {
    if (state !== undefined && state !== null) {
      state.registered = false
      state.payload = null
    }
    if (typeof disposeSkill !== 'function') return
    try {
      disposeSkill()
    } catch (error) {
      // Teardown-time degradation only: the registry may already be gone.
      logger?.warn?.(`ssh-workspace: skill "local-exec" dispose failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
