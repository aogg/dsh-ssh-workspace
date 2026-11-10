window.__ModuleLoader__.load({
  id: '@shiqyka/dsh-ssh-workspace',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { jsx, jsxs, Fragment } = require('react/jsx-runtime')

    // =========================================================================
    // API client
    // =========================================================================
    const API = {
      hosts: '/api/dsh-ssh-workspace/hosts',
      hostSave: '/api/dsh-ssh-workspace/hosts/save',
      hostDefaultPath: '/api/dsh-ssh-workspace/hosts/default-path',
      hostDelete: '/api/dsh-ssh-workspace/hosts/delete',
      hostForgetKey: '/api/dsh-ssh-workspace/hosts/forget-key',
      hostDisconnect: '/api/dsh-ssh-workspace/hosts/disconnect',
      test: '/api/dsh-ssh-workspace/test',
      ls: '/api/dsh-ssh-workspace/ls',
      status: '/api/dsh-ssh-workspace/status',
      mount: '/api/dsh-ssh-workspace/mount',
      unmount: '/api/dsh-ssh-workspace/unmount',
      enable: '/api/dsh-ssh-workspace/enable',
      unforward: '/api/dsh-ssh-workspace/unforward',
      forwardSave: '/api/dsh-ssh-workspace/forward/save',
      forwardToggle: '/api/dsh-ssh-workspace/forward/toggle',
      forwardDelete: '/api/dsh-ssh-workspace/forward/delete',
      forwardRemember: '/api/dsh-ssh-workspace/forward/remember',
      forwardProbe: '/api/dsh-ssh-workspace/forward/probe',
      forwardSettings: '/api/dsh-ssh-workspace/forward/settings',
      download: '/api/dsh-ssh-workspace/download',
      upload: '/api/dsh-ssh-workspace/upload',
      agentPrompts: '/api/dsh-ssh-workspace/agent-prompts',
      agentPromptsGlobal: '/api/dsh-ssh-workspace/agent-prompts/global',
      agentPromptsHost: '/api/dsh-ssh-workspace/agent-prompts/host',
      agentPromptsWorkspace: '/api/dsh-ssh-workspace/agent-prompts/workspace',
      agentPromptsPreview: '/api/dsh-ssh-workspace/agent-prompts/preview',
      floatingList: '/api/dsh-ssh-workspace/floating/list',
      floatingSave: '/api/dsh-ssh-workspace/floating/save',
      floatingUpdate: '/api/dsh-ssh-workspace/floating/update',
      floatingDelete: '/api/dsh-ssh-workspace/floating/delete',
      floatingReorder: '/api/dsh-ssh-workspace/floating/reorder',
    }

    async function fetchJson (url, init) {
      const res = await fetch(url, init)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        let message = text || res.statusText
        try {
          const parsed = JSON.parse(text)
          if (typeof parsed?.error === 'string' && parsed.error !== '') message = parsed.error
        } catch { /* not a JSON error body */ }
        throw new Error(message)
      }
      return res.json()
    }

    // =========================================================================
    // Locale
    // =========================================================================
    const NS = 'dsh-ssh-workspace'
    const zh = {
      'entry.label': '远程工作区',
      'panel.title': '远程工作区',
      'panel.empty': '暂无已配置的 SSH 主机',
      'panel.loading': '加载中…',
      'hosts.title': 'SSH 主机',
      'hosts.keyReady': '就绪',
      'hosts.keyMissing': '密钥缺失',
      'hosts.test': '测试连接',
      'hosts.testing': '连接中…',
      'hosts.testOk': '连接成功 ({ms}ms)',
      'hosts.testFail': '连接失败',
      'hosts.browse': '浏览目录',
      'hosts.add': '添加主机',
      'hosts.edit': '编辑',
      'hosts.delete': '删除',
      'hosts.deleteConfirm': '确认删除',
      'hosts.deleteCancel': '取消',
      'hosts.deleteDesc': '删除后，该主机已挂载的工作区将无法继续访问。',
      'hosts.deleting': '删除中…',
      'hosts.deleteFail': '删除失败',
      'hosts.forgetKey': '忘记主机密钥',
      'hosts.forgetKeyConfirm': '确认忘记',
      'hosts.forgetKeyDesc': '仅在该主机确实重装系统或更换了密钥后使用。忘记后，下次连接将重新信任并记录对方出示的密钥（TOFU）；若不确定，请先与管理员核对指纹。',
      'hosts.forgetKeyOk': '已忘记记录的密钥，下次连接将重新记录',
      'hosts.forgetKeyFail': '忘记主机密钥失败',
      'hosts.disconnect': '断开',
      'hosts.disconnecting': '断开中…',
      'hosts.disconnectOk': '已断开连接',
      'hosts.disconnectOkForwards': '已断开连接，同时关闭 {n} 条端口转发',
      'hosts.disconnectFail': '断开连接失败',
      'hosts.disconnectBusy': '连接上有操作进行中，空闲后才能断开',
      'editor.title.create': '添加 SSH 主机',
      'editor.title.edit': '编辑 SSH 主机',
      'editor.alias': '别名',
      'editor.aliasHint': '工作区路径中 ssh://<别名>/… 的别名',
      'editor.aliasHintEdit': '改名后，已经以旧别名挂载的工作区将无法访问',
      'editor.host': '主机地址',
      'editor.port': '端口',
      'editor.user': '用户名',
      'editor.os': '操作系统',
      'editor.osHint': '远端命令的 shell 方言：Windows 主机用 cmd.exe，Linux / macOS 用 POSIX shell。「自动」按连接探测，不改主机条目',
      'editor.osKind.linux': 'Linux',
      'editor.osKind.mac': 'macOS',
      'editor.osKind.win': 'Windows',
      'editor.osKind.auto': '自动（按连接探测）',
      'editor.auth': '认证方式',
      'editor.authKind.key': '密钥文件',
      'editor.authKind.password': '密码',
      'editor.authKind.agent': 'SSH Agent',
      'editor.keyPath': '私钥路径',
      'editor.keyPathHint': '例如 ~/.ssh/id_ed25519',
      'editor.passphrase': '私钥口令（可选）',
      'editor.secretKeep': '留空保持不变',
      'editor.password': '密码',
      'editor.agentPath': 'Agent 地址（可选）',
      'editor.agentPathHint': '留空使用系统默认（SSH_AUTH_SOCK / pageant）',
      'editor.description': '备注（可选）',
      'editor.defaultPath': '新增工作区默认目录（可选）',
      'editor.defaultPathHint': '新增远程工作区时目录浏览的初始位置；留空则打开 SSH 登录目录。示例：/home/user 或 /D:/code/www',
      'editor.badDefaultPath': '默认目录必须是绝对路径，例如 /home/user 或 /D:/code/www',
      'editor.defaultPathPick': '选择…',
      'editor.defaultPathPickHint': '先保存主机，再编辑选择',
      'editor.agentForward': '转发 ssh-agent',
      'editor.agentForwardHint': '让远端命令用本机的 ssh-agent 密钥认证（如远端 git push），私钥无需复制到远端',
      'editor.compress': '压缩传输',
      'editor.compressHint': '以 CPU 换带宽，慢链路（如跨国 / 移动网络）下明显更快',
      'editor.required': '请填写{field}',
      'editor.badPort': '端口必须是 1-65535 的整数',
      'editor.save': '保存',
      'editor.saving': '保存中…',
      'editor.cancel': '取消',
      'editor.saveFail': '保存失败',
      'picker.title': '选择默认目录',
      'picker.ok': '确定',
      'dialog.close': '关闭',
      'browser.title': '浏览 {alias}',
      'browser.loading': '加载中…',
      'browser.empty': '空目录',
      'browser.error': '无法加载目录',
      'browser.parent': '返回上级',
      'browser.mount': '挂载此目录',
      'browser.mounting': '挂载中…',
      'browser.download': '下载到本机',
      'browser.downloadFail': '下载失败',
      'browser.upload': '上传文件',
      'browser.uploading': '上传中…',
      'browser.uploadFail': '上传失败',
      'browser.mountOk': '已挂载为 {path}',
      'browser.mountFail': '挂载失败',
      'caps.rg': '注意：该主机未安装 ripgrep（rg），glob / grep 会以退出码 127 失败。',
      'caps.git': '注意：该主机未安装 git，工作区变更追踪（diff / 变更面板）已关闭。',
      'caps.inotifywait': '注意：该主机未安装 inotifywait，文件树 / 预览自动刷新使用轮询（约数秒延迟）。',
      'mounted.title': '已挂载的工作区',
      'mounted.none': '暂无已挂载的工作区',
      'mounted.unmount': '卸载',
      'mounted.unmounting': '卸载中…',
      'mounted.detachHint': '未勾选「同时删除工作区记录」则工作区记录与会话都保留，左侧那一行仍在（置灰），随时可以重新启用；勾选则工作区记录被删除、会话归档',
      'mounted.confirmDetach': '确认卸载',
      'mounted.detachOkKeep': '已卸载，工作区与会话都保留',
      'mounted.detachOk': '已卸载并归档 {n} 个会话',
      'mounted.detachPartial': '已卸载，但 {n} 个会话未能归档',
      'mounted.detachFail': '卸载失败',
      'mounted.removeRecord': '同时删除工作区记录',
      'detached.title': '已停用的工作区',
      'detached.none': '暂无已停用的工作区',
      'detached.hint': '这些工作区已卸载：文件读写与命令执行均不可用，SSH 连接仍保留',
      'detached.badge': '已停用',
      'detached.enable': '启用',
      'detached.enabling': '启用中…',
      'detached.enableOk': '已重新挂载 {path}',
      'detached.enableFail': '启用失败',
      'connections.inFlight': '进行中: {n}',
      'shells.title': '持久远端会话',
      'shells.alive': '存活',
      'shells.closed': '已结束',
      'forwards.title': '端口转发',
      'forwards.none': '暂无端口转发',
      'forwards.remotePort': '远端端口',
      'forwards.localPort': '本地端口（可选）',
      'forwards.localPlaceholder': '默认同远端',
      'forwards.open': '打开',
      'forwards.close': '关闭',
      'forwards.connections': '活跃连接: {n}',
      'forwards.fail': '端口转发失败',
      'forwards.save': '保存并转发',
      'forwards.saving': '保存中…',
      'forwards.enable': '开启',
      'forwards.disable': '断开',
      'forwards.enabled': '已开启',
      'forwards.disabled': '已断开',
      'forwards.remember': '记住',
      'forwards.rememberHint': '把这个临时映射保存下来，下次启动可自动开启',
      'forwards.delete': '删除',
      'forwards.deleteConfirm': '确认删除',
      'forwards.busy': '处理中…',
      'forwards.autoStart': '启动时自动开启隧道',
      'forwards.autoStartHint': '仅对「已开启」的映射生效；关闭时全部保持断开，需要手动点开启',
      'forwards.portBusy': '本地端口被占用',
      'forwards.portReserved': '本地端口不可绑定（被系统保留或权限不足）',
      'forwards.portFree': '本地端口可用',
      'forwards.checking': '检查端口…',
      'forwards.lost': '连接已断开',
      'refresh': '刷新',
      // ---- add-workspace flow
      'add.local': '新建本地工作区',
      'add.localDesc': '在这台设备上编辑、运行和测试文件。',
      'add.localBrowse.title': '选择本地目录',
      'add.localBrowse.up': '返回上级',
      'add.localBrowse.newFolder': '新建文件夹',
      'add.localBrowse.folderName': '文件夹名称',
      'add.localBrowse.create': '创建',
      'add.localBrowse.creating': '创建中…',
      'add.localBrowse.createFail': '创建失败：{msg}',
      'add.localBrowse.loading': '加载中…',
      'add.localBrowse.empty': '空目录',
      'add.localBrowse.loadError': '无法加载目录：{msg}',
      'add.localBrowse.pick': '选择此目录',
      'add.localBrowse.picking': '打开中…',
      'add.remote': '新建远程工作区',
      'add.remoteDesc': '选择已连接 SSH 主机上的工作目录。',
      'remote.title': '新建远程工作区',
      'remote.name': '工作区名称',
      'remote.namePlaceholder': '输入工作区名称',
      'remote.host': '远程主机',
      'remote.dir': '工作目录',
      'remote.up': '返回上级',
      'remote.loading': '加载中…',
      'remote.empty': '空目录',
      'remote.loadError': '无法加载目录：{msg}',
      'remote.notWritable': '当前 SSH 账号对这个目录没有写入权限，Agent 无法在这里工作。请换一个可写目录，或在远程主机上授予权限后重试。',
      'remote.create': '创建工作区',
      'remote.creating': '创建中…',
      'remote.cancel': '取消',
      'remote.createFail': '创建失败：{msg}',
      'remote.hostsFail': '无法获取主机列表：{msg}',
      'remote.setAsDefault': '设为本主机默认目录',
      'remote.setAsDefaultHint': '该主机来自 ~/.ssh/config 回退，不可编辑，无法记录默认目录',
      // ---- path breadcrumbs (shared by the remote dialog and both browsers)
      'path.crumbs': '路径导航',
      // ---- composer file bridge
      'mention.addToTask': '添加到任务',
      'mention.noComposer': '没有可插入的输入框',
      'mention.insertFail': '插入引用失败',
      'mention.unrepresentable': '该路径无法表示为引用',
      // ---- file tree transfers
      'transfer.download': '下载到本机',
      'transfer.upload': '上传文件到此目录',
      'transfer.downloadDirUnsupported': '暂不支持下载整个目录',
      'transfer.downloading': '正在下载 {name}…',
      'transfer.uploading': '正在上传…',
      'transfer.uploadingName': '正在上传 {name}…',
      'transfer.downloadFail': '下载失败',
      'transfer.uploadFail': '上传失败',
      'transfer.uploadOk': '已上传 {name}',
      'transfer.notRemote': '该文件不在远端工作区中',
      // ---- agent prompt configuration (three levels)
      'prompts.title': 'Agent 提示词',
      'prompts.hint': '三级配置（全局 → 主机 → 工作区）：命中的 md 文件合并为远程工作区会话的系统提示词；保存后运行中的会话在下一个模型步生效。',
      'prompts.globalConfig': '全局配置',
      'prompts.workspaceConfig': '提示词',
      'prompts.globalTitle': '全局 Agent 提示词',
      'prompts.workspaceTitle': '工作区 Agent 提示词',
      'prompts.hostConfig': 'Agent 提示词（本主机，可选）',
      'prompts.collapse': '收起',
      'prompts.expandHint': '为这台主机的远程工作区会话追加提示词材料',
      'prompts.globs': 'glob 模式（命中即加载 md 文件）',
      'prompts.globHint': 'dsh 本机上的绝对路径，如 /data/notes/**/*-common/*.md',
      'prompts.scripts': '脚本命令（stdout 输出要加载的 md 清单）',
      'prompts.scriptHint': '在 dsh 本机执行；stdout 输出 {"files":["/abs/a.md"]} 或裸数组',
      'prompts.addGlob': '添加 glob',
      'prompts.addScript': '添加脚本',
      'prompts.remove': '删除此条',
      'prompts.inherited': '上一级条目（取消勾选 = 禁用该条）',
      'prompts.groupGlobal': '全局',
      'prompts.groupHost': '主机 {alias}',
      'prompts.kindGlob': 'glob',
      'prompts.kindScript': '脚本',
      'prompts.previewTarget': '预览工作区',
      'prompts.preview': '预览展开结果',
      'prompts.previewing': '展开中…',
      'prompts.previewFiles': '将加载 {n} 个文件：',
      'prompts.previewNone': '没有命中任何文件（保存后同样不会注入）',
      'prompts.previewErrors': '{n} 条告警：',
      'prompts.previewFail': '预览失败',
      'prompts.save': '保存配置',
      'prompts.saving': '保存中…',
      'prompts.saveOk': '已保存；运行中的会话在下一个模型步自动生效',
      'prompts.saveFail': '保存失败',
      'float.menuLabel': 'SSH 远程工作区',
      'float.subEmpty': '此项目还没有配置浮动远端',
      'float.subEmptyHint': '用下面的「添加此项目的 SSH 远端…」配置一个',
      'float.add': '＋ 添加此项目的 SSH 远端…',
      'float.manage': '管理…',
      'float.exit': '退出浮动显示',
      'float.stateFloating': '浮动中',
      'float.stateMounted': '已挂载',
      'float.stateUnmounted': '未挂载',
      'float.hostMissing': '主机缺失',
      'float.parentMissing': '父工作区已删除',
      'float.selectFail': '进入浮动显示失败：{msg}',
      'float.notRegistered': '这个远端还没有注册为工作区，请先在菜单里选中它挂载',
      'float.badge': '浮动',
      'float.cardClose': '退出浮动显示',
      'float.addTitle': '添加 SSH 远端 · {name}',
      'float.addHint': '只在这个项目的浮动卡片里显示，不新增固定工作区行。名称自动生成（目录名 · 主机别名），之后可在「管理…」里改名。',
      'float.host': 'SSH 主机',
      'float.dir': '远端目录',
      'float.up': '返回上级',
      'float.loading': '加载中…',
      'float.loadError': '无法读取目录：{msg}',
      'float.emptyDir': '这个目录里没有子目录',
      'float.noHosts': '还没有可用的 SSH 主机，请先在「远程工作区」面板添加。',
      'float.hostsFail': '无法读取主机列表：{msg}',
      'float.cancel': '取消',
      'float.save': '添加',
      'float.saving': '添加中…',
      'float.saveFail': '添加失败：{msg}',
      'float.saved': '已添加「{name}」',
      'float.manageTitle': '管理浮动远端 · {name}',
      'float.manageHint': '这些远端只在这个项目里浮动显示，与其它项目的配置互不影响。',
      'float.manageEmpty': '这个项目还没有配置浮动远端',
      'float.rename': '名称',
      'float.moveUp': '上移',
      'float.moveDown': '下移',
      'float.test': '测试连接',
      'float.testing': '连接中…',
      'float.testOk': '连接成功（{ms}ms）',
      'float.testFail': '连接失败：{msg}',
      'float.delete': '删除',
      'float.deleteConfirm': '确认删除',
      'float.deleteDesc': '只删除这条浮动配置；下面勾选时同时注销它对应的 DSH 工作区（会话归档）。',
      'float.deleteDeregister': '同时注销该 DSH 工作区',
      'float.deleteFail': '删除失败：{msg}',
      'float.renameFail': '改名失败：{msg}',
      'float.reorderFail': '排序失败：{msg}',
      'float.prune': '清理失效条目',
      'float.pruned': '已清理 {n} 条失效配置',
      'float.pruneNone': '没有失效条目',
      'float.registered': '已注册',
    }
    const en = {
      'entry.label': 'Remote Workspace',
      'panel.title': 'Remote Workspaces',
      'panel.empty': 'No SSH hosts configured',
      'panel.loading': 'Loading…',
      'hosts.title': 'SSH Hosts',
      'hosts.keyReady': 'ready',
      'hosts.keyMissing': 'key missing',
      'hosts.test': 'Test',
      'hosts.testing': 'Connecting…',
      'hosts.testOk': 'Connected ({ms}ms)',
      'hosts.testFail': 'Connection failed',
      'hosts.browse': 'Browse',
      'hosts.add': 'Add host',
      'hosts.edit': 'Edit',
      'hosts.delete': 'Delete',
      'hosts.deleteConfirm': 'Confirm delete',
      'hosts.deleteCancel': 'Cancel',
      'hosts.deleteDesc': 'Workspaces already mounted on this host will stop being reachable.',
      'hosts.deleting': 'Deleting…',
      'hosts.deleteFail': 'Delete failed',
      'hosts.forgetKey': 'Forget key',
      'hosts.forgetKeyConfirm': 'Confirm forget',
      'hosts.forgetKeyDesc': 'Use this only after the host was reinstalled or its key genuinely changed. Forgetting makes the next connection trust and record whatever key the host presents (TOFU); when unsure, verify the fingerprint with the host owner first.',
      'hosts.forgetKeyOk': 'Recorded key forgotten — the next connection records it anew',
      'hosts.forgetKeyFail': 'Could not forget the host key',
      'hosts.disconnect': 'Disconnect',
      'hosts.disconnecting': 'Disconnecting…',
      'hosts.disconnectOk': 'Connection closed',
      'hosts.disconnectOkForwards': 'Connection closed, and {n} port forward(s) shut down with it',
      'hosts.disconnectFail': 'Could not disconnect',
      'hosts.disconnectBusy': 'The connection has operations in flight — disconnect again once it is idle',
      'editor.title.create': 'Add SSH host',
      'editor.title.edit': 'Edit SSH host',
      'editor.alias': 'Alias',
      'editor.aliasHint': 'The <alias> in ssh://<alias>/… workspace paths',
      'editor.aliasHintEdit': 'Renaming breaks workspaces already mounted under the old alias',
      'editor.host': 'Host',
      'editor.port': 'Port',
      'editor.user': 'User',
      'editor.os': 'Operating system',
      'editor.osHint': 'The remote shell dialect: Windows hosts speak cmd.exe, Linux / macOS speak a POSIX shell. "Auto" probes per connection and stores nothing',
      'editor.osKind.linux': 'Linux',
      'editor.osKind.mac': 'macOS',
      'editor.osKind.win': 'Windows',
      'editor.osKind.auto': 'Auto (probe per connection)',
      'editor.auth': 'Authentication',
      'editor.authKind.key': 'Key file',
      'editor.authKind.password': 'Password',
      'editor.authKind.agent': 'SSH agent',
      'editor.keyPath': 'Private key path',
      'editor.keyPathHint': 'e.g. ~/.ssh/id_ed25519',
      'editor.passphrase': 'Key passphrase (optional)',
      'editor.secretKeep': 'Leave blank to keep',
      'editor.password': 'Password',
      'editor.agentPath': 'Agent endpoint (optional)',
      'editor.agentPathHint': 'Blank uses the system default (SSH_AUTH_SOCK / pageant)',
      'editor.description': 'Note (optional)',
      'editor.defaultPath': 'Default directory for new workspaces (optional)',
      'editor.defaultPathHint': 'Where directory browsing starts for a new remote workspace; leave blank to open the SSH login directory. Examples: /home/user or /D:/code/www',
      'editor.badDefaultPath': 'The default directory must be an absolute path, for example /home/user or /D:/code/www',
      'editor.defaultPathPick': 'Pick…',
      'editor.defaultPathPickHint': 'Save the host first, then pick',
      'editor.agentForward': 'Forward ssh-agent',
      'editor.agentForwardHint': 'Let remote commands authenticate with this machine\'s ssh-agent keys (e.g. a remote git push) without copying the private key to the host',
      'editor.compress': 'Compress transfer',
      'editor.compressHint': 'Trades CPU for bandwidth; noticeably faster on a slow link (cross-region or mobile)',
      'editor.required': '{field} is required',
      'editor.badPort': 'Port must be an integer between 1 and 65535',
      'editor.save': 'Save',
      'editor.saving': 'Saving…',
      'editor.cancel': 'Cancel',
      'editor.saveFail': 'Save failed',
      'picker.title': 'Pick default directory',
      'picker.ok': 'OK',
      'dialog.close': 'Close',
      'browser.title': 'Browse {alias}',
      'browser.loading': 'Loading…',
      'browser.empty': 'Empty directory',
      'browser.error': 'Could not load directory',
      'browser.parent': 'Go up',
      'browser.mount': 'Mount this directory',
      'browser.mounting': 'Mounting…',
      'browser.download': 'Download to this machine',
      'browser.downloadFail': 'Download failed',
      'browser.upload': 'Upload file',
      'browser.uploading': 'Uploading…',
      'browser.uploadFail': 'Upload failed',
      'browser.mountOk': 'Mounted as {path}',
      'browser.mountFail': 'Mount failed',
      'caps.rg': 'Note: this host has no ripgrep (rg), so glob / grep will fail with exit code 127.',
      'caps.git': 'Note: this host has no git, so workspace change tracking (diff / changes panel) is off.',
      'caps.inotifywait': 'Note: this host has no inotifywait, so file tree / preview refresh falls back to polling (a few seconds behind).',
      'mounted.title': 'Mounted Workspaces',
      'mounted.none': 'No mounted workspaces',
      'mounted.unmount': 'Unmount',
      'mounted.unmounting': 'Unmounting…',
      'mounted.detachHint': 'Without "Also remove the workspace record" both the record and its sessions are kept — the sidebar row stays (greyed) and can be re-enabled at any time; with it the record is deleted and the sessions are archived',
      'mounted.confirmDetach': 'Confirm unmount',
      'mounted.detachOkKeep': 'Unmounted; the workspace and its sessions are both kept',
      'mounted.detachOk': 'Unmounted and archived {n} session(s)',
      'mounted.detachPartial': 'Unmounted, but {n} session(s) could not be archived',
      'mounted.detachFail': 'Unmount failed',
      'mounted.removeRecord': 'Also remove the workspace record',
      'detached.title': 'Detached Workspaces',
      'detached.none': 'No detached workspaces',
      'detached.hint': 'Unloaded: file access and command execution are refused, the SSH connection stays available',
      'detached.badge': 'off',
      'detached.enable': 'Enable',
      'detached.enabling': 'Enabling…',
      'detached.enableOk': 'Mounted {path} again',
      'detached.enableFail': 'Enable failed',
      'connections.inFlight': 'in flight: {n}',
      'shells.title': 'Persistent Remote Shells',
      'shells.alive': 'live',
      'shells.closed': 'ended',
      'forwards.title': 'Port Forwards',
      'forwards.none': 'No port forwards',
      'forwards.remotePort': 'Remote port',
      'forwards.localPort': 'Local port (optional)',
      'forwards.localPlaceholder': 'same as remote',
      'forwards.open': 'Open',
      'forwards.close': 'Close',
      'forwards.connections': 'active connections: {n}',
      'forwards.fail': 'Port forward failed',
      'forwards.save': 'Save and forward',
      'forwards.saving': 'Saving…',
      'forwards.enable': 'Turn on',
      'forwards.disable': 'Turn off',
      'forwards.enabled': 'on',
      'forwards.disabled': 'off',
      'forwards.remember': 'Remember',
      'forwards.rememberHint': 'Save this ad-hoc mapping so it can be opened again after a restart',
      'forwards.delete': 'Delete',
      'forwards.deleteConfirm': 'Confirm delete',
      'forwards.busy': 'Working…',
      'forwards.autoStart': 'Open saved tunnels on startup',
      'forwards.autoStartHint': 'Applies to mappings whose state is "on"; when off, every tunnel stays down until you turn it on',
      'forwards.portBusy': 'the local port is already in use',
      'forwards.portReserved': 'the local port cannot be bound (reserved by the system or permission denied)',
      'forwards.portFree': 'the local port is available',
      'forwards.checking': 'Checking the port…',
      'forwards.lost': 'connection lost',
      'refresh': 'Refresh',
      // ---- add-workspace flow
      'add.local': 'New local workspace',
      'add.localDesc': 'Edit, run and test files on this device.',
      'add.localBrowse.title': 'Choose a local directory',
      'add.localBrowse.up': 'Go up',
      'add.localBrowse.newFolder': 'New folder',
      'add.localBrowse.folderName': 'Folder name',
      'add.localBrowse.create': 'Create',
      'add.localBrowse.creating': 'Creating…',
      'add.localBrowse.createFail': 'Create failed: {msg}',
      'add.localBrowse.loading': 'Loading…',
      'add.localBrowse.empty': 'Empty directory',
      'add.localBrowse.loadError': 'Could not load the directory: {msg}',
      'add.localBrowse.pick': 'Choose this directory',
      'add.localBrowse.picking': 'Opening…',
      'add.remote': 'New remote workspace',
      'add.remoteDesc': 'Choose a working directory on a connected SSH host.',
      'remote.title': 'New Remote Workspace',
      'remote.name': 'Workspace name',
      'remote.namePlaceholder': 'Enter a workspace name',
      'remote.host': 'Remote host',
      'remote.dir': 'Working directory',
      'remote.up': 'Go up',
      'remote.loading': 'Loading…',
      'remote.empty': 'Empty directory',
      'remote.loadError': 'Could not load directory: {msg}',
      'remote.notWritable': 'The SSH account has no write permission on this directory, so the agent cannot work here. Choose a writable directory, or grant permission on the remote host and try again.',
      'remote.create': 'Create workspace',
      'remote.creating': 'Creating…',
      'remote.cancel': 'Cancel',
      'remote.createFail': 'Create failed: {msg}',
      'remote.hostsFail': 'Could not load hosts: {msg}',
      'remote.setAsDefault': 'Set as this host\'s default directory',
      'remote.setAsDefaultHint': 'This host comes from the ~/.ssh/config fallback and is read-only, so no default directory can be recorded',
      // ---- path breadcrumbs (shared by the remote dialog and both browsers)
      'path.crumbs': 'Path navigation',
      // ---- composer file bridge
      'mention.addToTask': 'Add to task',
      'mention.noComposer': 'No composer to insert into',
      'mention.insertFail': 'Could not insert the reference',
      'mention.unrepresentable': 'This path cannot be represented as a reference',
      // ---- file tree transfers
      'transfer.download': 'Download to this machine',
      'transfer.upload': 'Upload a file here',
      'transfer.downloadDirUnsupported': 'Downloading a whole directory is not supported yet',
      'transfer.downloading': 'Downloading {name}…',
      'transfer.uploading': 'Uploading…',
      'transfer.uploadingName': 'Uploading {name}…',
      'transfer.downloadFail': 'Download failed',
      'transfer.uploadFail': 'Upload failed',
      'transfer.uploadOk': 'Uploaded {name}',
      'transfer.notRemote': 'That file is not in a remote workspace',
      // ---- agent prompt configuration (three levels)
      'prompts.title': 'Agent Prompts',
      'prompts.hint': 'Three levels (global → host → workspace): matched md files merge into remote-session system prompts; running sessions pick changes up at their next model step.',
      'prompts.globalConfig': 'Global config',
      'prompts.workspaceConfig': 'Prompts',
      'prompts.globalTitle': 'Global agent prompts',
      'prompts.workspaceTitle': 'Workspace agent prompts',
      'prompts.hostConfig': 'Agent prompts (this host, optional)',
      'prompts.collapse': 'Collapse',
      'prompts.expandHint': 'Append prompt material for this host\'s remote sessions',
      'prompts.globs': 'Glob patterns (matches load md files)',
      'prompts.globHint': 'Absolute path on the DSH host, e.g. /data/notes/**/*-common/*.md',
      'prompts.scripts': 'Script commands (stdout lists the md files to load)',
      'prompts.scriptHint': 'Runs on the DSH host; stdout prints {"files":["/abs/a.md"]} or a bare array',
      'prompts.addGlob': 'Add glob',
      'prompts.addScript': 'Add script',
      'prompts.remove': 'Remove this entry',
      'prompts.inherited': 'Inherited entries (uncheck = disable)',
      'prompts.groupGlobal': 'Global',
      'prompts.groupHost': 'Host {alias}',
      'prompts.kindGlob': 'glob',
      'prompts.kindScript': 'script',
      'prompts.previewTarget': 'Preview workspace',
      'prompts.preview': 'Preview merged files',
      'prompts.previewing': 'Expanding…',
      'prompts.previewFiles': '{n} file(s) will load:',
      'prompts.previewNone': 'Nothing matched (nothing will be injected after save either)',
      'prompts.previewErrors': '{n} warning(s):',
      'prompts.previewFail': 'Preview failed',
      'prompts.save': 'Save',
      'prompts.saving': 'Saving…',
      'prompts.saveOk': 'Saved; running sessions pick it up at their next model step',
      'prompts.saveFail': 'Save failed',
      'float.menuLabel': 'SSH remote workspaces',
      'float.subEmpty': 'No floating remote configured for this project',
      'float.subEmptyHint': 'Use “Add an SSH remote for this project…” below',
      'float.add': '＋ Add an SSH remote for this project…',
      'float.manage': 'Manage…',
      'float.exit': 'Exit floating view',
      'float.stateFloating': 'floating',
      'float.stateMounted': 'mounted',
      'float.stateUnmounted': 'not mounted',
      'float.hostMissing': 'host missing',
      'float.parentMissing': 'parent workspace deleted',
      'float.selectFail': 'Could not enter the floating view: {msg}',
      'float.notRegistered': 'This remote is not registered as a workspace yet — select it from the menu to mount it first',
      'float.badge': 'Floating',
      'float.cardClose': 'Exit floating view',
      'float.addTitle': 'Add SSH remote · {name}',
      'float.addHint': 'Shown only inside this project\'s floating card — no permanent extra workspace row. The name is generated (directory · host alias) and can be renamed later under “Manage…”.',
      'float.host': 'SSH host',
      'float.dir': 'Remote directory',
      'float.up': 'Up one level',
      'float.loading': 'Loading…',
      'float.loadError': 'Cannot read the directory: {msg}',
      'float.emptyDir': 'No subdirectory here',
      'float.noHosts': 'No SSH host yet — add one in the “Remote Workspaces” panel first.',
      'float.hostsFail': 'Cannot read the host list: {msg}',
      'float.cancel': 'Cancel',
      'float.save': 'Add',
      'float.saving': 'Adding…',
      'float.saveFail': 'Add failed: {msg}',
      'float.saved': 'Added “{name}”',
      'float.manageTitle': 'Manage floating remotes · {name}',
      'float.manageHint': 'These remotes float inside this project only; other projects keep their own lists.',
      'float.manageEmpty': 'No floating remote configured for this project',
      'float.rename': 'Name',
      'float.moveUp': 'Move up',
      'float.moveDown': 'Move down',
      'float.test': 'Test connection',
      'float.testing': 'Connecting…',
      'float.testOk': 'Connected ({ms}ms)',
      'float.testFail': 'Connection failed: {msg}',
      'float.delete': 'Delete',
      'float.deleteConfirm': 'Confirm delete',
      'float.deleteDesc': 'Removes this floating entry only; ticking the box below also deregisters its DSH workspace (its sessions are archived).',
      'float.deleteDeregister': 'Also deregister the DSH workspace',
      'float.deleteFail': 'Delete failed: {msg}',
      'float.renameFail': 'Rename failed: {msg}',
      'float.reorderFail': 'Reorder failed: {msg}',
      'float.prune': 'Clean up broken entries',
      'float.pruned': 'Cleaned up {n} broken entry(ies)',
      'float.pruneNone': 'No broken entry',
      'float.registered': 'registered',
    }

    /** Expand `{name}` placeholders; keys absent from params stay literal. */
    function applyParams (text, params) {
      if (!params) return text
      let out = text
      for (const [k, v] of Object.entries(params)) {
        out = out.replace(`{${k}}`, String(v))
      }
      return out
    }

    /** Simple translate with placeholder substitution. */
    function makeTranslate (dict) {
      return (key, params) => applyParams(dict[key] ?? key, params)
    }

    // =========================================================================
    // CSS (injected once at module load)
    // =========================================================================
    const CSS_ID = '@shiqyka/dsh-ssh-workspace/client.css'
    function injectStyles () {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css="${CSS_ID}"]`)) return
      const tag = document.createElement('style')
      tag.dataset.plugin = '@shiqyka/dsh-ssh-workspace'
      tag.dataset.pluginCss = CSS_ID
      tag.textContent = `
.sshwsp { font-family: var(--dsw-font-family, system-ui, sans-serif); color: var(--dsw-alias-label-primary, #e0e0e0); padding: 24px; overflow-y: auto; height: 100%; }
.sshwsp h2 { font-size: 18px; font-weight: 600; margin: 0 0 16px; letter-spacing: -0.01em; }
.sshwsp h3 { font-size: 12px; font-weight: 500; margin: 24px 0 12px; color: var(--dsw-alias-label-secondary, #999); letter-spacing: 0.02em; }
.sshwsp-card { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.06)); border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.2)); border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; }
.sshwsp-host { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.sshwsp-host-info { flex: 1; min-width: 0; }
.sshwsp-host-alias { font-weight: 500; font-size: 14px; display: flex; align-items: center; gap: 8px; }
.sshwsp-host-addr { font-size: 12px; color: var(--dsw-alias-label-secondary, #888); font-family: var(--dsw-font-markdown-code-font-family, monospace); }
.sshwsp-host-meta { display: flex; gap: 8px; font-size: 11px; color: var(--dsw-alias-label-tertiary, #666); margin-top: 2px; }
.sshwsp-host-desc { font-size: 12px; color: var(--dsw-alias-label-secondary, #999); margin-top: 2px; overflow-wrap: anywhere; }
.sshwsp-host-actions { display: flex; gap: 6px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
.sshwsp-host-confirm { flex-basis: 100%; display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.08)); padding-top: 8px; }
.sshwsp-host-confirm span { flex: 1; font-size: 12px; color: var(--dsw-alias-label-tertiary, #666); }
.sshwsp-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 24px 0 12px; }
.sshwsp-section-head h3 { margin: 0; }
.sshwsp-btn { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.1)); border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,0.25)); color: var(--dsw-alias-label-primary, #e0e0e0); border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer; transition: background 120ms ease-out, transform 100ms ease-out; white-space: nowrap; }
.sshwsp-btn:hover { background: var(--dsw-alias-interactive-bg-active, rgba(127,127,127,0.16)); }
.sshwsp-btn:active:not(:disabled) { transform: scale(0.98); }
.sshwsp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.sshwsp-btn-primary { background: var(--dsw-alias-button-info-fill, #4a9eff); color: #fff; border-color: transparent; }
.sshwsp-btn-primary:hover { background: var(--dsw-alias-button-info-hover, #3d8ee6); }
.sshwsp-btn-danger { color: var(--dsw-alias-state-error-primary, #ff6b6b); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ff6b6b) 35%, transparent); }
.sshwsp-btn-danger:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ff6b6b) 12%, transparent); }
.sshwsp-btn:focus-visible, .sshwsp-icon-btn:focus-visible, .sshwsp-menuitem:focus-visible, .sshwsp-entry:focus-visible { outline: 2px solid var(--dsw-alias-button-info-fill, #4a9eff); outline-offset: 1px; }
.sshwsp-status { font-size: 11px; padding: 2px 6px; border-radius: 4px; }
.sshwsp-status-ok { color: var(--dsw-alias-state-success-primary, #4ade80); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #4ade80) 15%, transparent); }
.sshwsp-status-err { color: var(--dsw-alias-state-error-primary, #ff6b6b); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ff6b6b) 15%, transparent); }
.sshwsp-status-warn { color: var(--dsw-alias-state-warn-primary, #fbbf24); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #fbbf24) 15%, transparent); }
.sshwsp-toast { position: fixed; left: 50%; top: 40px; transform: translateX(-50%); z-index: 1100; box-sizing: border-box; max-width: min(480px, 90vw); padding: 9px 14px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25)); background: var(--dsw-alias-bg-layer-3, #1a1a1a); box-shadow: var(--dsw-elevation-prominent, 0 16px 48px rgba(0,0,0,0.4)); font-size: 12px; line-height: 1.5; cursor: pointer; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; animation: sshwsp-toast-in 160ms ease-out; }
.sshwsp-toast-ok { color: var(--dsw-alias-state-success-primary, #4ade80); }
.sshwsp-toast-err { color: var(--dsw-alias-state-error-primary, #ff6b6b); }
@keyframes sshwsp-toast-in { from { opacity: 0; transform: translate(-50%, -6px); } to { opacity: 1; transform: translate(-50%, 0); } }
.sshwsp-browser { border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.2)); border-radius: 8px; overflow: hidden; }
.sshwsp-browser-header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.06)); border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,0.25)); }
.sshwsp-browser-path { flex: 1; font-family: var(--dsw-font-markdown-code-font-family, monospace); font-size: 12px; color: var(--dsw-alias-label-secondary, #888); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sshwsp-browser-list { max-height: 360px; overflow-y: auto; }
.sshwsp-entry { display: flex; align-items: center; gap: 10px; width: 100%; box-sizing: border-box; padding: 8px 14px; border: none; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.08)); background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; transition: background 100ms ease-out; }
.sshwsp-entry:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.1)); }
.sshwsp-entry:last-child { border-bottom: none; }
.sshwsp-entry:disabled { opacity: 0.5; cursor: not-allowed; }
.sshwsp-entry-icon { width: 16px; height: 16px; color: var(--dsw-alias-label-secondary, #888); flex-shrink: 0; }
.sshwsp-entry-name { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sshwsp-entry-meta { font-size: 11px; color: var(--dsw-alias-label-tertiary, #666); font-family: var(--dsw-font-markdown-code-font-family, monospace); }
.sshwsp-mount { border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.2)); border-radius: 8px; padding: 10px 14px; margin-bottom: 6px; display: flex; align-items: center; gap: 12px; }
.sshwsp-mount-path { flex: 1; font-family: var(--dsw-font-markdown-code-font-family, monospace); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* A detached workspace row: dimmed but fully legible, and never given
   pointer-events:none — the whole point of the row is its Enable button. */
.sshwsp-mount-off { opacity: 0.62; }
.sshwsp-mount-off .sshwsp-mount-path { color: var(--dsw-alias-label-tertiary, #666); }
/* The "also remove the workspace record" opt-in inside an armed unmount row.
   It stays a checkbox rather than a second button because the two actions
   differ only in scope, and picking the wrong button here is unrecoverable
   for the row's visibility. */
.sshwsp-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary, #888); cursor: pointer; white-space: nowrap; }
.sshwsp-check input { margin: 0; cursor: pointer; }
/* Sidebar rows for detached workspaces. Set by passRemoteMarks; display-only,
   so a click still reaches DSH and the panel's Enable button stays the way
   back. Intercepting the host's own row click would break on its next
   redesign, which is a worse trade than a row that opens and shows an error. */
[data-sshwsp-disabled="1"] { opacity: 0.5; }
/* The power glyph marks the WORKSPACE header only. Applying it to every
   attribute carrier would stamp one on each session row too, which reads as
   "N separate switches" rather than "this workspace is off". */
[data-row-key^="workspace:"][data-sshwsp-disabled="1"]::after { content: "⏻"; margin-left: 6px; font-size: 10px; color: var(--dsw-alias-label-tertiary, #666); }
/* A detached workspace's row actions do nothing, so they are made inert rather
   than merely dimmed. pointer-events is used instead of a click interceptor:
   the buttons belong to DSH's own row, and patching its handlers breaks on the
   next redesign, while this rule survives any markup the row grows. The
   workspace HEADER stays clickable on purpose — expanding the group is how its
   sessions (kept per the detach contract) remain visible. */
[data-sshwsp-disabled="1"] button,
[data-sshwsp-disabled="1"] [role="button"] { pointer-events: none; opacity: 0.4; }
/* The sessions inside such a group are unreachable, row and all: the row
   itself IS the control that opens the session, so dimming only its buttons
   would leave the one action that matters. Keyed off the row key so this
   cannot reach the workspace header above, whose expand affordance is
   deliberately kept. The keyboard half is set by script; this is the mouse. */
[data-row-key^="session:"][data-sshwsp-disabled="1"] { pointer-events: none; cursor: not-allowed; }
/* Empty / loading / error placeholders. Every section renders one of these
   before it has rows, so this rule must exist even while the surrounding
   layout is being reworked: without it the placeholder collapses to an
   unstyled line and the panel looks half-loaded. */
.sshwsp-empty { text-align: center; padding: 32px 16px; color: var(--dsw-alias-label-tertiary, #666); font-size: 13px; }
/* Layout of the add-a-forward row: fixed footprint, not a stretched field.
   The host select is capped at 180px (half of the old 360px ceiling) and the
   two port boxes stay pinned to what a 7-digit port needs; leftover space on
   the right is simply empty. justify-content: flex-start keeps the row packed
   left instead of spreading the controls apart, and flex-wrap is the escape
   valve on a narrow panel — the row breaks rather than crushing the alias
   into an ellipsis.
   Scoping both rules under .sshwsp-forward-new is load-bearing, not cosmetic:
   .sshwsp-input sets width:100% with a single class, so a bare
   .sshwsp-input-port loses to it on source order however wide it declares
   itself. That is exactly what let every port box claim the full row and
   squeeze the select down to min-content.
   88px = 2px border + 16px padding + 70px of text: seven digits at 13px need
   ~51px, and the zh placeholder "默认同远端" (5 CJK glyphs, ~65px) fits. */
.sshwsp-forward-new { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: flex-start; margin: 0 0 8px; }
.sshwsp-forward-new .sshwsp-select { flex: 0 1 180px; width: 180px; min-width: 90px; max-width: 180px; }
.sshwsp-forward-new .sshwsp-input-port { flex: 0 0 auto; width: 88px; padding-left: 8px; padding-right: 8px; font-variant-numeric: tabular-nums; appearance: textfield; -moz-appearance: textfield; }
.sshwsp-forward-new .sshwsp-btn { flex: 0 0 auto; }
/* The spinner steals ~15px of the box and pushes the placeholder into an
   ellipsis. A port is typed, not stepped (min/max/validation still apply):
   drop it. */
.sshwsp-forward-new .sshwsp-input-port::-webkit-outer-spin-button,
.sshwsp-forward-new .sshwsp-input-port::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.sshwsp-forward-row { flex-wrap: wrap; }
/* A saved mapping with no live listener is dimmed, but stays fully operable:
   the row must still be readable enough to decide whether to turn it on. */
.sshwsp-forward-off .sshwsp-mount-path { color: var(--dsw-alias-label-tertiary, #666); }
.sshwsp-forward-error { flex-basis: 100%; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The shared .sshwsp-check spreads label and box to opposite ends, which is
   right for a two-line row but wrong here: the box must sit beside the label
   it belongs to, not float away from it. Compounded so it outranks
   .sshwsp-check regardless of where this rule lands in the sheet.
   display/flex-direction are repeated here on purpose: .sshwsp-check declares
   neither, relying on the .sshwsp-field class for display:flex, and this label
   does not carry that class. Without them the row falls back to display:inline
   and the title drops onto its own line. */
.sshwsp-check.sshwsp-forward-autostart { display: flex; flex-direction: row; align-items: center; margin: 0 0 10px; padding: 8px 0 0; border-top: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.08)); justify-content: flex-start; gap: 8px; }
.sshwsp-porthint { font-size: 11px; margin: -2px 0 8px; color: var(--dsw-alias-label-tertiary, #666); }
.sshwsp-porthint-busy { color: var(--dsw-alias-state-warn-primary, #fbbf24); }
.sshwsp-porthint-free { color: var(--dsw-alias-state-success-primary, #4ade80); }
/* Base size for a port box used outside the forward row (none today). Inside
   .sshwsp-forward-new the scoped rule above takes over, since a single class
   here would lose to .sshwsp-input's width:100%. */
.sshwsp-input-port { width: 88px; flex: none; }
/* A section with more than five rows becomes a scrolling viewport rather than
   a page-long column. CappedList sets max-height inline from the measured
   height of the first five rows; these rules only supply the flex column and,
   once it actually overflows, the scrolling.
   The gutter is reserved ALWAYS while scrolling (scrollbar-gutter: stable),
   because a scrollbar that appeared only on the sixth row would narrow the
   panel and reflow every row in it — a jump on the exact interaction that
   caused it. It is NOT reserved for a short list: those must render exactly
   as they did before the cap existed, with no 10px slot for an absent bar.
   overscroll-behavior keeps a flick at the end of a list from scrolling the
   whole panel behind it. */
.sshwsp-cap { display: flex; flex-direction: column; gap: 6px; }
.sshwsp-cap-scroll { overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding-right: 2px; }
/* Hosts and forwards are cards/rows that already bring their own bottom
   margin. Inside a flex column those margins stack ON TOP of the gap (they do
   not collapse), so a capped list would be spaced twice as loose as the same
   list uncapped. The cap owns the spacing; the rows drop theirs. */
.sshwsp-cap > .sshwsp-card, .sshwsp-cap > .sshwsp-mount { margin-bottom: 0; }
.sshwsp-conn { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 400; font-variant-numeric: tabular-nums; }
.sshwsp-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.sshwsp-dot-ok { background: var(--dsw-alias-state-success-primary, #4ade80); }
.sshwsp-dot-err { background: var(--dsw-alias-state-error-primary, #ff6b6b); }
.sshwsp-error { color: var(--dsw-alias-state-error-primary, #ff6b6b); font-size: 12px; margin-top: 4px; }
.sshwsp-backdrop { position: fixed; inset: 0; background: var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.5)); display: flex; align-items: center; justify-content: center; z-index: 1000; animation: sshwsp-fade-in 120ms ease-out; }
.sshwsp-dialog { background: var(--dsw-alias-bg-layer-3, #1a1a1a); border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25)); border-radius: 12px; width: 640px; max-width: 90vw; max-height: 80vh; display: flex; flex-direction: column; box-shadow: var(--dsw-elevation-prominent, 0 16px 48px rgba(0,0,0,0.4)); animation: sshwsp-dialog-in 140ms ease-out; }
.sshwsp-dialog-narrow { width: 480px; }
.sshwsp-dialog-title { padding: 16px 20px; font-size: 16px; font-weight: 600; border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,0.2)); }
.sshwsp-dialog-body { padding: 0; overflow-y: auto; flex: 1; }
.sshwsp-dialog-footer { padding: 12px 20px; border-top: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,0.2)); display: flex; justify-content: flex-end; gap: 8px; }
.sshwsp-form { padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }
.sshwsp-form-row { display: flex; gap: 12px; }
.sshwsp-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
.sshwsp-field-label { font-size: 12px; color: var(--dsw-alias-label-secondary, #999); }
.sshwsp-field-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary, #666); }
.sshwsp-check { flex-direction: row; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; }
.sshwsp-check-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sshwsp-check input[type="checkbox"] { flex: 0 0 auto; width: 16px; height: 16px; margin: 0; accent-color: var(--dsw-alias-button-info-fill, #4a9eff); cursor: pointer; }
.sshwsp-input { background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.06)); border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,0.25)); border-radius: 6px; color: var(--dsw-alias-label-primary, #e0e0e0); padding: 6px 10px; font-size: 13px; font-family: inherit; width: 100%; box-sizing: border-box; }
.sshwsp-input:focus { outline: none; border-color: var(--dsw-alias-button-info-fill, #4a9eff); }
.sshwsp-input:focus-visible { box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-button-info-fill, #4a9eff) 30%, transparent); }
.sshwsp-select { cursor: pointer; color-scheme: dark; }
.sshwsp-dlg-head { display: flex; align-items: center; gap: 8px; padding: 14px 18px; border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,0.2)); }
.sshwsp-dlg-head h2 { flex: 1; margin: 0; font-size: 15px; font-weight: 600; }
.sshwsp-icon-btn { background: none; border: 1px solid transparent; color: var(--dsw-alias-label-secondary, #999); border-radius: 6px; padding: 5px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: background 120ms ease-out, transform 100ms ease-out; }
.sshwsp-icon-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.1)); color: var(--dsw-alias-label-primary, #e0e0e0); }
.sshwsp-icon-btn:active:not(:disabled) { transform: scale(0.94); }
.sshwsp-icon-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.sshwsp-flowmenu { position: fixed; z-index: 1300; width: 300px; box-sizing: border-box; background: var(--dsw-alias-bg-layer-3, #1a1a1a); border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25)); border-radius: 10px; box-shadow: var(--dsw-elevation-prominent, 0 16px 48px rgba(0,0,0,0.4)); padding: 5px; animation: sshwsp-menu-in 120ms ease-out; }
.sshwsp-menuitem { display: flex; align-items: flex-start; gap: 10px; width: 100%; box-sizing: border-box; padding: 9px 10px; border: none; border-radius: 7px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.sshwsp-menuitem:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.1)); }
.sshwsp-menuitem:disabled { opacity: 0.5; cursor: not-allowed; }
.sshwsp-menuitem-icon { display: inline-flex; margin-top: 1px; color: var(--dsw-alias-label-secondary, #999); flex-shrink: 0; }
.sshwsp-menuitem-text { flex: 1; min-width: 0; }
.sshwsp-menuitem-title { display: block; font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary, #e0e0e0); }
.sshwsp-menuitem-desc { display: block; font-size: 12px; color: var(--dsw-alias-label-secondary, #888); margin-top: 2px; line-height: 1.45; overflow-wrap: anywhere; }
.sshwsp-menusep { height: 1px; margin: 5px 8px; background: var(--dsw-alias-border-l2, rgba(127,127,127,0.2)); }
.sshwsp-fileaction { display: inline-flex; align-items: center; height: 24px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25)); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #999); font: inherit; font-size: 12px; line-height: 1; white-space: nowrap; cursor: pointer; }
.sshwsp-fileaction:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.1)); color: var(--dsw-alias-label-primary, #e0e0e0); }
.sshwsp-fileaction:disabled { opacity: 0.5; cursor: not-allowed; }
.sshwsp-pathbar { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,0.25)); border-radius: 6px; background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.06)); }
.sshwsp-pathbar-path { flex: 1; min-width: 0; font-family: var(--dsw-font-markdown-code-font-family, monospace); font-size: 12px; color: var(--dsw-alias-label-secondary, #999); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
/* Breadcrumbs: clickable path segments. The container clips long paths so the
   dialog width wins; each segment ellipsizes under pressure (flex + min-width:0). */
.sshwsp-crumbs { flex: 1; min-width: 0; display: flex; align-items: center; overflow: hidden; white-space: nowrap; font-family: var(--dsw-font-markdown-code-font-family, monospace); font-size: 12px; }
.sshwsp-crumbs-sep { flex-shrink: 0; color: var(--dsw-alias-label-tertiary, #666); }
.sshwsp-crumbs-item { background: none; border: none; padding: 0; margin: 0 2px; font: inherit; color: var(--dsw-alias-label-secondary, #999); cursor: pointer; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.sshwsp-crumbs-item:hover:not(:disabled) { color: var(--dsw-alias-label-primary, #e0e0e0); text-decoration: underline; }
.sshwsp-crumbs-item:focus-visible { outline: 1px solid var(--dsw-alias-button-info-fill, #4a9eff); }
.sshwsp-crumbs-item:disabled { cursor: default; }
.sshwsp-crumbs-current { flex: 0 1 auto; min-width: 0; margin: 0 2px; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-primary, #e0e0e0); }
.sshwsp-warn { color: var(--dsw-alias-state-error-primary, #ff6b6b); font-size: 12px; line-height: 1.5; padding: 0 20px 12px; }
.sshwsp-dirlist { max-height: 260px; overflow-y: auto; border-top: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.08)); }
/* Agent prompt editor: one row per entry, upper-level entries as toggles. */
.sshwsp-prompt-row { display: flex; gap: 6px; align-items: center; margin: 0 0 6px; }
.sshwsp-prompt-row .sshwsp-input { flex: 1; min-width: 0; font-family: var(--dsw-font-markdown-code-font-family, monospace); font-size: 12px; }
.sshwsp-prompt-upper { border-top: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.08)); margin-top: 4px; padding-top: 8px; display: flex; flex-direction: column; gap: 2px; }
.sshwsp-prompt-group { font-size: 11px; color: var(--dsw-alias-label-tertiary, #666); margin: 6px 0 2px; }
.sshwsp-prompt-item { display: flex; gap: 8px; align-items: center; font-size: 12px; cursor: pointer; padding: 1px 0; }
.sshwsp-prompt-item input[type="checkbox"] { flex: 0 0 auto; width: 14px; height: 14px; margin: 0; accent-color: var(--dsw-alias-button-info-fill, #4a9eff); }
.sshwsp-prompt-kind { flex: 0 0 auto; font-size: 10px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.2)); color: var(--dsw-alias-label-tertiary, #666); }
.sshwsp-prompt-item-code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; font-family: var(--dsw-font-markdown-code-font-family, monospace); }
.sshwsp-prompt-section { display: flex; flex-direction: column; gap: 6px; }
.sshwsp-prompt-preview { max-height: 170px; overflow-y: auto; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.08)); border-radius: 6px; padding: 8px 10px; font-size: 12px; display: flex; flex-direction: column; gap: 2px; }
.sshwsp-prompt-preview-item { overflow-wrap: anywhere; font-family: var(--dsw-font-markdown-code-font-family, monospace); }
.sshwsp-prompt-preview-error { color: var(--dsw-alias-state-error-primary, #ff6b6b); overflow-wrap: anywhere; }
.sshwsp-prompt-warn { color: var(--dsw-alias-state-warn-primary, #fbbf24); overflow-wrap: anywhere; }
@keyframes sshwsp-menu-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: translateY(0); } }
@keyframes sshwsp-dialog-in { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
@keyframes sshwsp-fade-in { from { opacity: 0; } to { opacity: 1; } }
/* ---------- floating remote workspaces ----------
   The floating card covers the sidebar's workspace list. It is drawn as a
   PLUGIN-OWNED absolutely positioned layer inside the list body (which DSH
   already styles position: relative), so the native rows stay exactly where
   React put them — the only row-level change is a marker attribute that hides
   the rows outside the floating scope with one !important rule. Opaque colors
   only (bg-layer-2 is a solid theme surface, never rgba): a translucent card
   would show the hidden list bleeding through, which is the one thing this
   surface must not do. */
[data-sshwsp-float-hidden] { display: none !important; }
[data-sshwsp-float-region] { position: relative; }
[data-sshwsp-float-card] { position: absolute; inset: 0; min-height: 100%; z-index: 0; pointer-events: none; box-sizing: border-box; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25)); background: var(--dsw-alias-bg-layer-2, #212123); box-shadow: var(--dsw-elevation-prominent, 0 16px 48px rgba(0,0,0,0.4)); overflow: hidden; }
[data-sshwsp-float-card]::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--dsw-alias-state-business-primary, #4a9eff); }
[data-sshwsp-float-card] > [data-sshwsp-float-head] { pointer-events: auto; }
[data-sshwsp-float-head] { position: absolute; left: 0; right: 0; top: 0; height: 46px; z-index: 2; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25)); border-radius: 10px 10px 0 0; background: var(--dsw-alias-bg-layer-3, #1b1b22); cursor: default; }
[data-sshwsp-float-head] .sshwsp-float-badge { flex: none; padding: 1px 6px; border-radius: 999px; font-size: 10px; line-height: 16px; font-weight: 600; letter-spacing: 0.04em; color: var(--dsw-alias-label-primary-foreground, #fff); background: var(--dsw-alias-state-business-primary, #4a9eff); }
[data-sshwsp-float-head] .sshwsp-float-titles { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0; }
[data-sshwsp-float-head] .sshwsp-float-title { font-size: 13px; line-height: 18px; font-weight: 600; color: var(--dsw-alias-label-primary, #e0e0e0); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-sshwsp-float-head] .sshwsp-float-addr { font-size: 10px; line-height: 14px; color: var(--dsw-alias-label-tertiary, #888); font-family: var(--dsw-font-markdown-code-font-family, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-sshwsp-float-head] .sshwsp-float-close { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: none; border-radius: 5px; background: transparent; cursor: pointer; color: var(--dsw-alias-label-secondary, #999); }
[data-sshwsp-float-head] .sshwsp-float-close:hover, [data-sshwsp-float-head] .sshwsp-float-close:focus-visible { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.14)); color: var(--dsw-alias-label-primary, #e0e0e0); outline: none; }
[data-sshwsp-float-head] .sshwsp-float-close svg { width: 12px; height: 12px; }
[data-sshwsp-float-region] > [role="tree"] { position: relative; z-index: 1; }
/* The card's header is fixed inside it, so the tree starts below the header and
   scrolls inside its own box; the 46px matches the header height above. */
[data-sshwsp-float-on] > [role="tree"] { margin-top: 46px; }
[data-sshwsp-float-region][data-sshwsp-float-on] { animation: sshwsp-float-in 140ms ease-out; }
@keyframes sshwsp-float-in { from { transform: translateX(-100%); } to { transform: translateX(0); } }
/* Menu block injected into DSH's workspace ⋯ menu (see installFloatingMenu). */
[data-sshwsp-float-item] { position: relative; }
.sshwsp-frow { position: relative; }
[data-sshwsp-float-item] .sshwsp-fitem, [data-sshwsp-float-submenu] .sshwsp-fitem { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 34px; padding: 6px 8px; border: none; border-radius: var(--dsw-radius-md, 6px); background: transparent; cursor: pointer; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary, #e0e0e0); text-align: left; }
[data-sshwsp-float-item] .sshwsp-fitem:hover:not(:disabled), [data-sshwsp-float-item] .sshwsp-fitem:focus-visible:not(:disabled), [data-sshwsp-float-submenu] .sshwsp-fitem:hover:not(:disabled), [data-sshwsp-float-submenu] .sshwsp-fitem:focus-visible:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.14)); outline: none; }
[data-sshwsp-float-item] .sshwsp-fitem:disabled, [data-sshwsp-float-submenu] .sshwsp-fitem:disabled { opacity: 0.55; cursor: default; }
[data-sshwsp-float-item] .sshwsp-fitem-icon, [data-sshwsp-float-submenu] .sshwsp-fitem-icon { display: inline-flex; flex: none; width: 14px; height: 14px; align-items: center; justify-content: center; color: var(--dsw-alias-menu-icon, #999); }
[data-sshwsp-float-item] .sshwsp-fitem-icon svg, [data-sshwsp-float-submenu] .sshwsp-fitem-icon svg { width: 14px; height: 14px; }
[data-sshwsp-float-item] .sshwsp-fitem-text, [data-sshwsp-float-submenu] .sshwsp-fitem-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-sshwsp-float-item] .sshwsp-fitem-chevron, [data-sshwsp-float-submenu] .sshwsp-fitem-chevron { display: inline-flex; flex: none; width: 12px; height: 12px; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary, #888); }
[data-sshwsp-float-item] .sshwsp-fitem-chevron svg, [data-sshwsp-float-submenu] .sshwsp-fitem-chevron svg { width: 12px; height: 12px; }
[data-sshwsp-float-item] .sshwsp-fsep, [data-sshwsp-float-submenu] .sshwsp-fsep { height: 0.5px; margin: 3px 2px; background: var(--dsw-alias-border-l2, rgba(127,127,127,0.25)); }
[data-sshwsp-float-item] .sshwsp-fsub { position: absolute; bottom: -4px; left: calc(100% + 10px); z-index: 2; min-width: 200px; max-width: 320px; padding: 4px; display: none; background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-base, #1b1b22)); border: 0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25)); border-radius: var(--dsw-radius-md, 8px); box-shadow: var(--dsw-elevation-prominent, 0 16px 48px rgba(0,0,0,0.4)); }
[data-sshwsp-float-item] .sshwsp-fsub[data-sshwsp-float-open] { display: block; }
[data-sshwsp-float-item] .sshwsp-fsub[data-sshwsp-float-flip] { left: auto; right: calc(100% + 10px); bottom: auto; top: -4px; }
/* Hit bridge across the 10px gap: without it the pointer crosses a hole between
   the card and its submenu, which the core would read as "left the menu". */
[data-sshwsp-float-item] .sshwsp-fsub::before { content: ''; position: absolute; top: 0; bottom: 0; left: -10px; width: 10px; }
[data-sshwsp-float-item] .sshwsp-fsub[data-sshwsp-float-flip]::before { left: auto; right: -10px; }
[data-sshwsp-float-item] .sshwsp-fsub .sshwsp-fmeta { display: block; flex: none; font-size: 10px; line-height: 14px; color: var(--dsw-alias-label-tertiary, #888); font-family: var(--dsw-font-markdown-code-font-family, monospace); }
[data-sshwsp-float-submenu] .sshwsp-fitem-main { display: flex; flex-direction: column; align-items: flex-start; flex: 1; min-width: 0; }
[data-sshwsp-float-submenu] .sshwsp-fitem-state { flex: none; font-size: 10px; line-height: 16px; padding: 0 5px; border-radius: 999px; color: var(--dsw-alias-label-secondary, #999); border: 0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25)); }
[data-sshwsp-float-submenu] .sshwsp-fitem-state.is-on { color: var(--dsw-alias-state-success-primary, #4ade80); border-color: currentColor; }
[data-sshwsp-float-submenu] .sshwsp-fitem-state.is-bad { color: var(--dsw-alias-state-error-primary, #ff6b6b); border-color: currentColor; }
/* Floating add/manage dialog rows. */
.sshwsp-float-list { max-height: 300px; overflow-y: auto; border-top: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.08)); display: flex; flex-direction: column; }
.sshwsp-float-row { display: flex; flex-direction: column; gap: 4px; padding: 10px 20px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.08)); }
.sshwsp-float-row-head { display: flex; align-items: center; gap: 6px; }
.sshwsp-float-row-name { flex: 1; min-width: 0; }
.sshwsp-float-row-meta { font-size: 11px; color: var(--dsw-alias-label-tertiary, #666); font-family: var(--dsw-font-markdown-code-font-family, monospace); overflow-wrap: anywhere; }
.sshwsp-float-row-actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.sshwsp-float-state { font-size: 10px; padding: 0 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25)); color: var(--dsw-alias-label-tertiary, #666); }
.sshwsp-float-state.is-on { color: var(--dsw-alias-state-success-primary, #4ade80); border-color: currentColor; }
.sshwsp-float-state.is-bad { color: var(--dsw-alias-state-error-primary, #ff6b6b); border-color: currentColor; }
.sshwsp-float-confirm { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.1)); }
.sshwsp-float-confirm-line { display: flex; gap: 8px; align-items: center; font-size: 12px; }
@media (prefers-reduced-motion: reduce) {
  .sshwsp-toast, .sshwsp-flowmenu, .sshwsp-dialog, .sshwsp-backdrop { animation: none; }
  .sshwsp-btn, .sshwsp-icon-btn, .sshwsp-entry { transition: none; }
  [data-sshwsp-float-region][data-sshwsp-float-on] { animation: none; }
}
      `
      document.head.appendChild(tag)
    }

    // =========================================================================
    // SVG Icons
    // =========================================================================
    // Two 45° chevrons facing each other — the remote-workspace mark. Geometry
    // traced 1:1 from the reference bitmap (29×28): right chevron apex
    // (16.5, 11.5) with arms to (20, 8)/(20, 15); left chevron apex
    // (16.5, 15.5) with arms to (12.5, 11.5)/(12.5, 19.5). The viewBox crops
    // to the drawn chevrons (plus a hair of padding) — the full 29×28 canvas
    // would render the mark tiny and thin at 16px.
    const REMOTE_MARK_VIEWBOX = '10.5 6.25 11.5 15'

    // Per-host-OS mark shapes: one entry per pinned `os` value, consumed by the
    // React icon AND by the DOM decoration builder, so both surfaces draw the
    // exact same glyph from one source. All stroke-based, `currentColor`,
    // sized for 16px:
    //   win   — four rounded panes (the window grid);
    //   mac   — the command key (⌘), the looped square;
    //   linux — a shell prompt (`>_`), crisp where a penguin would be a blob.
    // Anything else (no os pinned, unknown alias, ~/.ssh/config rows) draws
    // the generic remote chevrons above.
    const OS_MARK_SHAPES = {
      win: { viewBox: '0 0 16 16', strokeWidth: 1.5, shapes: [
        { tag: 'rect', x: 2, y: 2, width: 5.2, height: 5.2, rx: 1.2 },
        { tag: 'rect', x: 8.8, y: 2, width: 5.2, height: 5.2, rx: 1.2 },
        { tag: 'rect', x: 2, y: 8.8, width: 5.2, height: 5.2, rx: 1.2 },
        { tag: 'rect', x: 8.8, y: 8.8, width: 5.2, height: 5.2, rx: 1.2 },
      ] },
      mac: { viewBox: '0 0 16 16', strokeWidth: 1.5, shapes: [
        { tag: 'path', d: 'M10 4v8a2 2 0 1 0 2-2H4a2 2 0 1 0 2 2V4a2 2 0 1 0-2 2h8a2 2 0 1 0-2-2' },
      ] },
      linux: { viewBox: '0 0 16 16', strokeWidth: 1.5, shapes: [
        { tag: 'path', d: 'M2.5 4.5L6.5 8L2.5 11.5' },
        { tag: 'path', d: 'M8.5 12.5H13.5' },
      ] },
    }

    /** The generic remote chevrons, expressed through the same shape table. */
    const GENERIC_MARK_SHAPES = {
      viewBox: REMOTE_MARK_VIEWBOX,
      strokeWidth: 2,
      shapes: [
        { tag: 'path', d: 'M20 8 L16.5 11.5 L20 15' },
        { tag: 'path', d: 'M12.5 11.5 L16.5 15.5 L12.5 19.5' },
      ],
    }

    /** Render one shape-table entry as an svg (React.createElement calls). */
    function markIconShapes (spec, size, props) {
      return React.createElement('svg', {
        viewBox: spec.viewBox, width: size, height: size, fill: 'none',
        stroke: 'currentColor', strokeWidth: spec.strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', ...props,
      },
        ...spec.shapes.map(shape => shape.tag === 'rect'
          ? React.createElement('rect', { x: shape.x, y: shape.y, width: shape.width, height: shape.height, rx: shape.rx })
          : React.createElement('path', { d: shape.d })))
    }

    /** The workspace mark for one host OS: per-OS glyph, else the chevrons. */
    function OsMarkIcon ({ os, size = 16, ...props }) {
      const spec = os !== undefined && os !== null && os !== '' ? OS_MARK_SHAPES[os] : undefined
      if (spec !== undefined) return markIconShapes(spec, size, { 'data-sshwsp-os': os, ...props })
      return markIconShapes(GENERIC_MARK_SHAPES, size, props)
    }

    function RemoteMarkIcon ({ size = 16, ...props }) {
      return markIconShapes(GENERIC_MARK_SHAPES, size, props)
    }

    function ServerIcon ({ size = 16, ...props }) {
      return React.createElement('svg', {
        viewBox: '0 0 16 16', width: size, height: size, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', ...props,
      },
        React.createElement('rect', { x: 2, y: 2.5, width: 12, height: 4.5, rx: 1 }),
        React.createElement('rect', { x: 2, y: 9, width: 12, height: 4.5, rx: 1 }),
        React.createElement('circle', { cx: 4.5, cy: 4.75, r: 0.5, fill: 'currentColor', stroke: 'none' }),
        React.createElement('circle', { cx: 4.5, cy: 11.25, r: 0.5, fill: 'currentColor', stroke: 'none' }),
      )
    }

    function FolderIcon ({ size = 16, ...props }) {
      return React.createElement('svg', {
        viewBox: '0 0 16 16', width: size, height: size, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', ...props,
      },
        React.createElement('path', { d: 'M2 4.5v7a1.5 1.5 0 001.5 1.5h9a1.5 1.5 0 001.5-1.5v-5.5A1.5 1.5 0 0012.5 4.5H8L6.5 3H3.5A1.5 1.5 0 002 4.5z' }),
      )
    }

    function FileIcon ({ size = 16, ...props }) {
      return React.createElement('svg', {
        viewBox: '0 0 16 16', width: size, height: size, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', ...props,
      },
        React.createElement('path', { d: 'M4 2h5.5L13 5.5V13a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z' }),
        React.createElement('path', { d: 'M9.5 2v3.5H13' }),
      )
    }

    function GlobeIcon ({ size = 16, ...props }) {
      return React.createElement('svg', {
        viewBox: '0 0 16 16', width: size, height: size, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', ...props,
      },
        React.createElement('circle', { cx: 8, cy: 8, r: 6 }),
        React.createElement('ellipse', { cx: 8, cy: 8, rx: 2.6, ry: 6 }),
        React.createElement('path', { d: 'M2 8h12' }),
      )
    }

    function ArrowLeftIcon ({ size = 16, ...props }) {
      return React.createElement('svg', {
        viewBox: '0 0 16 16', width: size, height: size, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', ...props,
      },
        React.createElement('path', { d: 'M12.5 8H3.5' }),
        React.createElement('path', { d: 'M7 4.5L3.5 8L7 11.5' }),
      )
    }

    function CloseIcon ({ size = 16, ...props }) {
      return React.createElement('svg', {
        viewBox: '0 0 16 16', width: size, height: size, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', ...props,
      },
        React.createElement('path', { d: 'M4 4l8 8' }),
        React.createElement('path', { d: 'M12 4l-8 8' }),
      )
    }

    // =========================================================================
    // Host card
    // =========================================================================
    function HostCard ({ host, t, conn, onTest, onBrowse, onEdit, onDelete, onForgetKey, onDisconnect, testState, deleteError, deleting }) {
      // null | 'delete' | 'forget' — only one confirmation row shows at a time.
      const [confirming, setConfirming] = React.useState(null)
      const [disconnecting, setDisconnecting] = React.useState(false)
      const testing = testState?.status === 'testing'
      const busy = (conn?.inFlight ?? 0) > 0
      // Only store entries are editable; ~/.ssh/config rows stay read-only.
      const editable = host.source === 'store'

      const actions = confirming === 'delete'
        ? [
            jsx('button', {
              key: 'confirm',
              className: 'sshwsp-btn sshwsp-btn-danger',
              disabled: deleting,
              onClick: () => onDelete(host.alias),
              children: deleting ? t('hosts.deleting') : t('hosts.deleteConfirm'),
            }),
            jsx('button', {
              key: 'cancel',
              className: 'sshwsp-btn',
              disabled: deleting,
              onClick: () => setConfirming(null),
              children: t('hosts.deleteCancel'),
            }),
          ]
        : confirming === 'forget'
          ? [
              jsx('button', {
                key: 'confirm',
                className: 'sshwsp-btn',
                onClick: () => { setConfirming(null); onForgetKey(host.alias) },
                children: t('hosts.forgetKeyConfirm'),
              }),
              jsx('button', {
                key: 'cancel',
                className: 'sshwsp-btn',
                onClick: () => setConfirming(null),
                children: t('hosts.deleteCancel'),
              }),
            ]
          : [
            jsx('button', {
              key: 'test',
              className: 'sshwsp-btn sshwsp-btn-primary',
              disabled: testing,
              onClick: () => onTest(host.alias),
              children: testing ? t('hosts.testing') : t('hosts.test'),
            }),
            conn && jsx('button', {
              key: 'disconnect',
              className: 'sshwsp-btn',
              disabled: busy || disconnecting,
              title: busy ? t('hosts.disconnectBusy') : undefined,
              onClick: async () => {
                setDisconnecting(true)
                try { await onDisconnect(host.alias) } finally { setDisconnecting(false) }
              },
              children: disconnecting ? t('hosts.disconnecting') : t('hosts.disconnect'),
            }),
            jsx('button', {
              key: 'browse',
              className: 'sshwsp-btn sshwsp-btn-primary',
              onClick: () => onBrowse(host.alias),
              children: t('hosts.browse'),
            }),
            editable && jsx('button', {
              key: 'edit',
              className: 'sshwsp-btn',
              onClick: () => onEdit(host),
              children: t('hosts.edit'),
            }),
            editable && jsx('button', {
              key: 'delete',
              className: 'sshwsp-btn sshwsp-btn-danger',
              onClick: () => setConfirming('delete'),
              children: t('hosts.delete'),
            }),
            // Offered for every host: keys are recorded per alias for store
            // and ~/.ssh/config hosts alike.
            jsx('button', {
              key: 'forget',
              className: 'sshwsp-btn',
              onClick: () => setConfirming('forget'),
              children: t('hosts.forgetKey'),
            }),
          ]

      return jsxs('div', { className: 'sshwsp-card sshwsp-host', children: [
        jsxs('div', { className: 'sshwsp-host-info', children: [
          jsxs('div', { className: 'sshwsp-host-alias', children: [
            jsx('span', { children: host.alias }),
            conn && jsxs('span', { className: 'sshwsp-conn', children: [
              jsx('span', { className: `sshwsp-dot ${conn.state === 'connected' ? 'sshwsp-dot-ok' : 'sshwsp-dot-err'}` }),
              jsx('span', { style: { color: conn.state === 'connected' ? 'var(--dsw-alias-state-success-primary, #4ade80)' : 'var(--dsw-alias-state-error-primary, #ff6b6b)' }, children: t(`connections.${conn.state}`) }),
              conn.inFlight > 0 && jsx('span', { style: { color: 'var(--dsw-alias-label-tertiary, #666)' }, children: t('connections.inFlight', { n: conn.inFlight }) }),
            ]}),
          ]}),
          jsx('div', { className: 'sshwsp-host-addr', children: `${host.user}@${host.host}:${host.port}` }),
          host.description && jsx('div', { className: 'sshwsp-host-desc', children: host.description }),
          jsxs('div', { className: 'sshwsp-host-meta', children: [
            // The OS (or "auto" for an entry that never pinned one) — the
            // editor.osKind.* labels double as the card's vocabulary.
            jsx('span', { children: host.os ? t(`editor.osKind.${host.os}`) : t('editor.osKind.auto') }),
            jsx('span', { children: '·' }),
            jsx('span', { children: t(`hosts.auth.${host.auth}`) }),
            jsx('span', { children: '·' }),
            jsx('span', {
              className: host.keyReady ? 'sshwsp-status sshwsp-status-ok' : 'sshwsp-status sshwsp-status-warn',
              children: host.keyReady ? t('hosts.keyReady') : t('hosts.keyMissing'),
            }),
            jsx('span', { children: '·' }),
            jsx('span', { children: t(`hosts.source.${host.source === 'store' ? 'store' : 'sshConfig'}`) }),
          ]}),
          deleteError && jsx('div', { className: 'sshwsp-error', children: deleteError }),
        ]}),
        jsx('div', { className: 'sshwsp-host-actions', children: actions }),
        confirming !== null && jsx('div', { className: 'sshwsp-host-confirm', children:
          jsx('span', { children: confirming === 'delete' ? t('hosts.deleteDesc') : t('hosts.forgetKeyDesc') }),
        }),
      ]})
    }

    /**
     * Backdrop props that dismiss on a press which both STARTS and ENDS on the
     * backdrop itself.
     *
     * `click` alone is not enough: a click is targeted at the nearest common
     * ancestor of the press and the release, so dragging a text selection out of
     * the dialog and letting go over the backdrop dispatches a click whose target
     * IS the backdrop — the dialog vanishes mid-selection, which reads as "the
     * panel closed itself". The press target is the reliable signal.
     *
     * The flag is rewritten on every pointerdown and lives on the element, so a
     * press released outside the window (where no pointerup is delivered at all)
     * cannot leave a stale "pressed" behind: the next press — from inside the
     * dialog too, since events bubble here — overwrites it, and that press is
     * recorded as starting outside.
     *
     * Only the primary button arms it. `click` never fires for the secondary
     * button, so an ungated pointer handler would ADD a right-click dismissal to
     * dialogs that never had one, popping the context menu on top of it. The
     * release side stays ungated on purpose: touch and pen report `button` as -1
     * on pointerup in some engines, and gating there would break tap-to-dismiss.
     *
     * @param {() => void} close dismissal, already carrying its own busy guard.
     * @returns {object} the props to spread onto a `sshwsp-backdrop`.
     */
    function backdropDismiss (close) {
      return {
        onPointerDown: (event) => {
          event.currentTarget.__sshwspPressed =
            event.button === 0 && event.target === event.currentTarget
        },
        onPointerUp: (event) => {
          const pressed = event.currentTarget.__sshwspPressed === true
          event.currentTarget.__sshwspPressed = false
          if (pressed && event.target === event.currentTarget) close()
        },
      }
    }

    // =========================================================================
    // Path breadcrumbs (shared by the remote dialog and the directory browsers)
    // =========================================================================
    /**
     * Split one absolute path into breadcrumb segments.
     *
     * Both separators are accepted on input — SFTP listings normally return
     * `/`, while a typed or stored default path may carry `\` — and display
     * always uses `/`. A Windows drive path (`/C:/Users/ao` or `C:\Users\ao`)
     * starts with the drive crumb (`C:`, target `/C:/`, the drive root);
     * a POSIX path (`/home/user`) starts with the root crumb (`/`, target
     * `/`). Every later crumb targets the path accumulated up to itself.
     *
     * @param {string | null | undefined} path - current absolute path.
     * @returns {Array<{label: string, target: string}>} crumbs in display
     *   order; the last one is the directory being viewed. Empty when there is
     *   no path to show.
     */
    function remotePathCrumbs (path) {
      if (typeof path !== 'string' || path === '') return []
      const unified = path.replaceAll('\\', '/')
      const absolute = unified.startsWith('/') ? unified : `/${unified}`
      const segments = absolute.split('/').filter((segment) => segment !== '')
      if (segments.length === 0) return [{ label: '/', target: '/' }]
      // Windows drive root (`C:`) or POSIX root: the first crumb differs.
      const driveRooted = /^[A-Za-z]:$/u.test(segments[0])
      const crumbs = driveRooted
        ? [{ label: segments[0], target: `/${segments[0]}/` }]
        : [{ label: '/', target: '/' }]
      let walked = driveRooted ? `/${segments[0]}` : ''
      for (let index = driveRooted ? 1 : 0; index < segments.length; index += 1) {
        walked = `${walked}/${segments[index]}`
        crumbs.push({ label: segments[index], target: walked })
      }
      return crumbs
    }

    /**
     * Clickable breadcrumb bar for the current directory.
     *
     * The last crumb (the directory being viewed) renders as plain text; every
     * other crumb is a button calling `onNavigate(target)`. Renders nothing
     * without a path, and every button inherits the caller's disabled state.
     *
     * @param {object} props - path, onNavigate, disabled, label (aria-label).
     * @returns {object | null} the nav element, or null without a path.
     */
    function PathBreadcrumb ({ path, onNavigate, disabled, label }) {
      const crumbs = remotePathCrumbs(path)
      if (crumbs.length === 0) return null
      const current = crumbs.length - 1
      return jsxs('nav', {
        className: 'sshwsp-crumbs',
        'aria-label': label,
        children: crumbs.map((crumb, index) => jsxs(Fragment, {
          children: [
            index > 0 && jsx('span', { className: 'sshwsp-crumbs-sep', 'aria-hidden': true, children: '/' }),
            index < current
              ? jsx('button', {
                  type: 'button',
                  className: 'sshwsp-crumbs-item',
                  title: crumb.target,
                  disabled: disabled === true,
                  onClick: () => onNavigate?.(crumb.target),
                  children: crumb.label,
                })
              : jsx('span', { className: 'sshwsp-crumbs-current', 'aria-current': 'location', children: crumb.label }),
          ],
        }, crumb.target)),
      })
    }

    // =========================================================================
    // Host editor dialog (create / edit a store entry)
    // =========================================================================
    function HostEditor ({ host, t, onClose, onSaved }) {
      const editing = host !== null
      const [alias, setAlias] = React.useState(editing ? host.alias : '')
      const [hostName, setHostName] = React.useState(editing ? host.host : '')
      const [port, setPort] = React.useState(editing ? String(host.port ?? 22) : '22')
      const [user, setUser] = React.useState(editing ? host.user : '')
      // The pinned OS drives the remote shell dialect (win → cmd.exe, mac /
      // linux → POSIX). A new host defaults to Linux; an existing entry that
      // never stored an OS stays "auto" — pre-selecting Linux here would pin
      // a probe-detected Windows host to the wrong dialect on the next save.
      const [osKind, setOsKind] = React.useState(editing ? (typeof host.os === 'string' && host.os !== '' ? host.os : 'auto') : 'linux')
      const [authKind, setAuthKind] = React.useState(editing ? host.auth : 'key')
      const [keyPath, setKeyPath] = React.useState(editing && host.auth === 'key' ? (host.keyPath ?? '') : '')
      const [passphrase, setPassphrase] = React.useState('')
      const [password, setPassword] = React.useState('')
      const [agentPath, setAgentPath] = React.useState(editing && host.auth === 'agent' ? (host.agentPath ?? '') : '')
      const [description, setDescription] = React.useState(editing && host.description ? host.description : '')
      const [agentForward, setAgentForward] = React.useState(editing && host.agentForward === true)
      const [compress, setCompress] = React.useState(editing && host.compress === true)
      // Initial directory for the new-remote-workspace dialog; '' = unset.
      const [defaultPath, setDefaultPath] = React.useState(editing && typeof host.defaultPath === 'string' ? host.defaultPath : '')
      // Lightweight remote directory chooser for defaultPath (nested dialog).
      const [pickingPath, setPickingPath] = React.useState(false)
      // The picker drives GET /ls, which needs a saved, editable host: a host
      // row only reaches this editor through the card's 编辑 button (store
      // rows), and a not-yet-saved host has no alias to list against.
      const canPick = editing && host.source === 'store'
      const [saving, setSaving] = React.useState(false)
      const [error, setError] = React.useState(null)
      // Agent prompts for THIS host (level ②). `undefined` = the section was
      // never expanded, so the payload omits the field entirely and the server
      // keeps (a rename even moves) whatever is stored — an untouched section
      // must not wipe the stored level.
      const [promptsOpen, setPromptsOpen] = React.useState(false)
      const [promptConfig, setPromptConfig] = React.useState(null)
      const [promptLevel, setPromptLevel] = React.useState(undefined)
      useAgentPromptConfig((data) => {
        setPromptConfig(data)
        const level = editing ? data.hosts?.[host.alias] : undefined
        if (level !== undefined && level !== null) {
          setPromptLevel({
            globs: (level.globs ?? []).map(entry => entry.pattern),
            scripts: (level.scripts ?? []).map(entry => entry.command),
            disabled: (level.disabled ?? []).slice(),
          })
        }
      })

      // Secrets are never sent back to the browser, so an untouched field is
      // empty on edit — blank means "keep the stored one".
      const keepPassword = editing && host.auth === 'password'
      const keepPassphrase = editing && host.auth === 'key'

      const field = (label, hint, input) => jsxs('label', { className: 'sshwsp-field', children: [
        jsx('span', { className: 'sshwsp-field-label', children: label }),
        input,
        hint != null && jsx('span', { className: 'sshwsp-field-hint', children: hint }),
      ]})

      const input = (value, onChange, options = {}) => jsx('input', {
        className: 'sshwsp-input',
        value,
        spellCheck: false,
        onChange: (event) => onChange(event.target.value),
        ...options,
      })

      // A checkbox row: label on the left, the box on the right, with an
      // optional hint underneath that explains the tradeoff.
      const checkbox = (label, hint, checked, onChange) => jsxs('label', { className: 'sshwsp-field sshwsp-check', children: [
        jsxs('span', { className: 'sshwsp-check-text', children: [
          jsx('span', { className: 'sshwsp-field-label', children: label }),
          hint != null && jsx('span', { className: 'sshwsp-field-hint', children: hint }),
        ]}),
        jsx('input', {
          type: 'checkbox',
          checked,
          onChange: (event) => onChange(event.target.checked),
        }),
      ]})

      const submit = async () => {
        if (!/^\d+$/u.test(port.trim())) { setError(t('editor.badPort')); return }
        const portNumber = Number.parseInt(port, 10)
        if (portNumber < 1 || portNumber > 65535) { setError(t('editor.badPort')); return }
        for (const [value, key] of [[alias, 'editor.alias'], [hostName, 'editor.host'], [user, 'editor.user']]) {
          if (value.trim() === '') { setError(t('editor.required', { field: t(key) })); return }
        }
        if (authKind === 'key' && keyPath.trim() === '') { setError(t('editor.required', { field: t('editor.keyPath') })); return }
        if (authKind === 'password' && password === '' && !keepPassword) { setError(t('editor.required', { field: t('editor.password') })); return }
        // Mirror the store's defaultPath rules before the round-trip: a
        // repairable drive spelling (`D:/code`) is fine, anything not readable
        // as an absolute path is rejected here with the same verdict the
        // server's 400 would carry.
        const trimmedDefaultPath = defaultPath.trim()
        if (trimmedDefaultPath !== '') {
          const candidate = trimmedDefaultPath.replaceAll('\\', '/')
          if (!candidate.startsWith('/') && !/^[A-Za-z]:(?:\/|$)/u.test(candidate)) { setError(t('editor.badDefaultPath')); return }
        }
        setSaving(true)
        setError(null)
        try {
          const result = await fetchJson(API.hostSave, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              originalAlias: editing ? host.alias : undefined,
              alias: alias.trim(),
              host: hostName.trim(),
              port: portNumber,
              user: user.trim(),
              auth: { kind: authKind, keyPath: keyPath.trim(), passphrase, password, agentPath: agentPath.trim() },
              description: description.trim(),
              agentForward,
              compress,
              // Always posted (even as ''): blank tells the server to clear
              // the stored defaultPath rather than keep the previous value.
              defaultPath: defaultPath.trim(),
              // Same posting rule for the OS: "auto" posts a blank, which
              // drops the stored key so the engine probes per connection.
              os: osKind === 'auto' ? '' : osKind,
              // Omitted while the section was never expanded: keeping the
              // stored level is the only non-surprising answer then.
              ...(promptLevel !== undefined ? { agentPrompts: promptPayload(promptLevel.globs, promptLevel.scripts, promptLevel.disabled) } : {}),
            }),
          })
          if (!result.ok) { setError(result.error ?? t('editor.saveFail')); return }
          onSaved?.()
        } catch (err) {
          setError(err.message)
        } finally {
          setSaving(false)
        }
      }

      // A save in flight must finish: unmounting here drops the request's only
      // feedback path while it is still writing to the host's store.
      const dismissBackdrop = () => { if (!saving) onClose() }

      return jsxs('div', { className: 'sshwsp-backdrop', ...backdropDismiss(dismissBackdrop), children: [
        jsxs('div', { className: 'sshwsp-dialog sshwsp-dialog-narrow', onClick: (event) => event.stopPropagation(), children: [
          jsx('div', { className: 'sshwsp-dialog-title', children: editing ? t('editor.title.edit') : t('editor.title.create') }),
          jsxs('div', { className: 'sshwsp-form', children: [
            field(t('editor.alias'), editing ? t('editor.aliasHintEdit') : t('editor.aliasHint'), input(alias, setAlias)),
            jsxs('div', { className: 'sshwsp-form-row', children: [
              field(t('editor.host'), null, input(hostName, setHostName)),
              jsxs('label', { className: 'sshwsp-field', style: { flex: '0 0 110px' }, children: [
                jsx('span', { className: 'sshwsp-field-label', children: t('editor.port') }),
                input(port, setPort, { inputMode: 'numeric' }),
              ]}),
            ]}),
            field(t('editor.user'), null, input(user, setUser)),
            field(t('editor.os'), t('editor.osHint'),
              jsxs('select', {
                className: 'sshwsp-input',
                value: osKind,
                onChange: (event) => setOsKind(event.target.value),
                children: [
                  jsx('option', { value: 'linux', children: t('editor.osKind.linux') }),
                  jsx('option', { value: 'mac', children: t('editor.osKind.mac') }),
                  jsx('option', { value: 'win', children: t('editor.osKind.win') }),
                  jsx('option', { value: 'auto', children: t('editor.osKind.auto') }),
                ],
              })),
            field(t('editor.auth'), null,
              jsxs('select', {
                className: 'sshwsp-input',
                value: authKind,
                onChange: (event) => setAuthKind(event.target.value),
                children: [
                  jsx('option', { value: 'key', children: t('editor.authKind.key') }),
                  jsx('option', { value: 'password', children: t('editor.authKind.password') }),
                  jsx('option', { value: 'agent', children: t('editor.authKind.agent') }),
                ],
              })),
            authKind === 'key' && field(t('editor.keyPath'), t('editor.keyPathHint'), input(keyPath, setKeyPath)),
            authKind === 'key' && field(t('editor.passphrase'), keepPassphrase ? t('editor.secretKeep') : null, input(passphrase, setPassphrase, { type: 'password' })),
            authKind === 'password' && field(t('editor.password'), keepPassword ? t('editor.secretKeep') : null, input(password, setPassword, { type: 'password' })),
            authKind === 'agent' && field(t('editor.agentPath'), t('editor.agentPathHint'), input(agentPath, setAgentPath)),
            field(t('editor.description'), null, input(description, setDescription)),
            // Input plus a browse button: picking beats typing an absolute
            // remote path by hand. The row is the shared .sshwsp-form-row so
            // the input keeps flexing and the button keeps its width inside
            // .sshwsp-dialog-narrow.
            jsxs('div', { className: 'sshwsp-form-row', children: [
              field(t('editor.defaultPath'), t('editor.defaultPathHint'), input(defaultPath, setDefaultPath)),
              jsx('button', {
                className: 'sshwsp-btn',
                style: { flex: '0 0 auto', alignSelf: 'flex-end' },
                disabled: !canPick,
                // The hint lives in the disabled title only — no extra row.
                title: canPick ? undefined : t('editor.defaultPathPickHint'),
                onClick: () => setPickingPath(true),
                children: t('editor.defaultPathPick'),
              }),
            ]}),
            checkbox(t('editor.agentForward'), t('editor.agentForwardHint'), agentForward, setAgentForward),
            checkbox(t('editor.compress'), t('editor.compressHint'), compress, setCompress),
            jsxs('div', { className: 'sshwsp-prompt-section', children: [
              jsx('button', {
                className: 'sshwsp-btn',
                title: t('prompts.expandHint'),
                onClick: () => {
                  const next = !promptsOpen
                  setPromptsOpen(next)
                  // Expanding with nothing stored starts an EMPTY draft: the
                  // section is now "touched", so saving writes it (an empty
                  // draft clears the level — that is what the user sees).
                  if (next && promptLevel === undefined) setPromptLevel({ globs: [], scripts: [], disabled: [] })
                },
                children: promptsOpen ? t('prompts.collapse') : t('prompts.hostConfig'),
              }),
              promptsOpen && promptLevel !== undefined && jsxs(Fragment, { children: [
                jsx('div', { className: 'sshwsp-entry-meta', children: t('prompts.hint') }),
                jsx(PromptEntryRows, { t, label: t('prompts.globs'), hint: t('prompts.globHint'), entries: promptLevel.globs, onChange: (globs) => setPromptLevel({ ...promptLevel, globs }), addLabel: t('prompts.addGlob'), placeholder: '/data/notes/**/*-common/*.md' }),
                jsx(PromptEntryRows, { t, label: t('prompts.scripts'), hint: t('prompts.scriptHint'), entries: promptLevel.scripts, onChange: (scripts) => setPromptLevel({ ...promptLevel, scripts }), addLabel: t('prompts.addScript'), placeholder: 'node /data/gen-prompts.js' }),
                promptConfig !== null && jsx(PromptInherited, {
                  t,
                  groups: [globalPromptGroup(promptConfig, t)],
                  disabled: promptLevel.disabled,
                  onToggle: (id, checked) => setPromptLevel({ ...promptLevel, disabled: toggleDisabled(promptLevel.disabled, id, checked) }),
                }),
              ]}),
            ]}),
            error && jsx('div', { className: 'sshwsp-error', children: error }),
          ]}),
          jsxs('div', { className: 'sshwsp-dialog-footer', children: [
            jsx('button', { className: 'sshwsp-btn', onClick: onClose, disabled: saving, children: t('editor.cancel') }),
            jsx('button', { className: 'sshwsp-btn sshwsp-btn-primary', onClick: submit, disabled: saving, children: saving ? t('editor.saving') : t('editor.save') }),
          ]}),
        ]}),
        // Nested second-layer dialog, rendered AFTER the editor dialog inside
        // the same backdrop. Both layers use .sshwsp-backdrop (fixed,
        // z-index:1000): the outer one creates a stacking context, and within
        // it this later child paints above the dialog — same z-index, DOM
        // order decides. No z-index bump needed (verified against the
        // stylesheet: .sshwsp-dialog carries no z-index of its own).
        pickingPath && jsx(DefaultPathPicker, {
          alias: host.alias,
          initialPath: defaultPath.trim() !== '' ? defaultPath.trim() : undefined,
          t,
          onCancel: () => setPickingPath(false),
          onPick: (picked) => { setDefaultPath(picked); setPickingPath(false) },
        }),
      ]})
    }

    // =========================================================================
    // Default-path picker (second layer on top of HostEditor)
    // =========================================================================
    /**
     * Lightweight remote directory chooser for the host editor's defaultPath.
     *
     * A trimmed-down RemoteWorkspaceDialog listing: directories only, ordered
     * by name; up button plus clickable breadcrumb navigation; loading /
     * empty / failure states. It exists so setting a default directory does
     * not require typing an absolute remote path by hand, and it opens on the
     * stored defaultPath when there is one (the likely destination) instead
     * of the SSH login directory.
     *
     * Stacking is DOM order, not z-index: both layers render
     * `.sshwsp-backdrop` (fixed, z-index 1000). The picker is a child of the
     * HostEditor backdrop, which forms its own stacking context, so within it
     * this later element paints above the dialog — no raised z-index needed
     * (the stylesheet gives `.sshwsp-dialog` no z-index of its own).
     *
     * @param {object} props - dialog props.
     * @param {string} props.alias - the host being edited (drives GET /ls).
     * @param {string} [props.initialPath] - directory to open first; absent
     *   lists the SSH login directory and adopts the path /ls echoes back.
     * @param {(key: string, params?: object) => string} props.t - translator.
     * @param {() => void} props.onCancel - close without picking.
     * @param {(path: string) => void} props.onPick - confirm with the
     *   currently shown absolute path.
     * @returns {object} the backdrop element.
     */
    function DefaultPathPicker ({ alias, initialPath, t, onCancel, onPick }) {
      // null until the first listing resolves — then the login directory (or
      // the stored defaultPath), per the echoed data.path below.
      const [path, setPath] = React.useState(null)
      const [entries, setEntries] = React.useState(null)
      const [writable, setWritable] = React.useState(true)
      const [loading, setLoading] = React.useState(false)
      const [loadError, setLoadError] = React.useState(null)
      const loadSeq = React.useRef(0)

      const loadDir = React.useCallback(async (target) => {
        const seq = ++loadSeq.current
        // Track the target immediately, then let the echoed data.path win:
        // the displayed path (and the OK button) must never lag one round-trip
        // behind, and an out-of-order answer is discarded by the seq guard.
        if (typeof target === 'string' && target !== '') setPath(target)
        setLoading(true)
        setLoadError(null)
        try {
          const query = typeof target === 'string' && target !== '' ? `&path=${encodeURIComponent(target)}` : ''
          const data = await fetchJson(`${API.ls}?alias=${encodeURIComponent(alias)}${query}`)
          if (seq !== loadSeq.current) return
          // Directories only: a default path is a browsing start, not a file.
          setEntries((data.entries ?? [])
            .filter((entry) => entry.type === 'directory')
            .sort((a, b) => a.name.localeCompare(b.name)))
          if (typeof data.path === 'string' && data.path !== '') setPath(data.path)
          setWritable(data.writable !== false)
        } catch (err) {
          if (seq === loadSeq.current) setLoadError(err.message)
        } finally {
          if (seq === loadSeq.current) setLoading(false)
        }
      }, [alias])

      React.useEffect(() => { loadDir(typeof initialPath === 'string' && initialPath !== '' ? initialPath : null) }, [loadDir, initialPath])

      const handleEntry = (entry) => {
        if (path == null) return
        loadDir(path === '/' ? `/${entry.name}` : `${path}/${entry.name}`)
      }

      const handleUp = () => {
        if (path == null || path === '/') return
        const idx = path.lastIndexOf('/')
        loadDir(idx <= 0 ? '/' : path.slice(0, idx))
      }

      // A listing in flight owns the dialog: closing mid-answer would show a
      // half-loaded state and drop the only view of why it failed. Idle
      // backdrops dismiss normally (no Escape — project-wide dialog rule).
      const dismissBackdrop = () => { if (!loading) onCancel() }

      return jsxs('div', { className: 'sshwsp-backdrop', ...backdropDismiss(dismissBackdrop), children: [
        jsxs('div', { className: 'sshwsp-dialog', onClick: (e) => e.stopPropagation(), children: [
          jsx('div', { className: 'sshwsp-dialog-title', children: t('picker.title') }),
          jsxs('div', { className: 'sshwsp-dialog-body', children: [
            jsxs('div', { className: 'sshwsp-form', children: [
              jsxs('div', { className: 'sshwsp-field', children: [
                jsxs('div', { className: 'sshwsp-pathbar', children: [
                  jsx('button', {
                    className: 'sshwsp-btn',
                    disabled: path == null || path === '/' || loading,
                    onClick: handleUp,
                    children: t('remote.up'),
                  }),
                  path == null
                    ? jsx('span', { className: 'sshwsp-pathbar-path', children: '…' })
                    : jsx(PathBreadcrumb, { path, disabled: loading, label: t('path.crumbs'), onNavigate: loadDir }),
                ]}),
              ]}),
            ]}),
            // A default directory the account cannot write makes every future
            // new-workspace attempt start with the red warning; surface the
            // verdict right here so the choice can be corrected immediately.
            path != null && !loading && loadError == null && !writable && jsx('div', { className: 'sshwsp-warn', children: t('remote.notWritable') }),
            jsx('div', { className: 'sshwsp-dirlist', children:
              loading
                ? jsx('div', { className: 'sshwsp-empty', children: t('remote.loading') })
                : loadError != null
                  ? jsx('div', { className: 'sshwsp-empty', children: t('remote.loadError', { msg: loadError }) })
                  : (entries?.length ?? 0) === 0
                    ? jsx('div', { className: 'sshwsp-empty', children: t('remote.empty') })
                    : entries.map((entry) =>
                        jsxs('button', {
                          key: entry.name,
                          type: 'button',
                          className: 'sshwsp-entry',
                          onClick: () => handleEntry(entry),
                          children: [
                            jsx('span', { className: 'sshwsp-entry-icon', children: React.createElement(FolderIcon) }),
                            jsx('span', { className: 'sshwsp-entry-name', children: entry.name }),
                          ],
                        })
                      ),
            }),
          ]}),
          jsxs('div', { className: 'sshwsp-dialog-footer', children: [
            jsx('button', { className: 'sshwsp-btn', disabled: loading, onClick: onCancel, children: t('remote.cancel') }),
            jsx('button', {
              className: 'sshwsp-btn sshwsp-btn-primary',
              disabled: path == null || loading,
              onClick: () => onPick?.(path),
              children: t('picker.ok'),
            }),
          ]}),
        ]}),
      ]})
    }

    // =========================================================================
    // Directory browser dialog
    // =========================================================================
    function DirectoryBrowser ({ alias, onClose, onMount, t }) {
      // null until the first listing resolves — then the SSH login directory.
      const [path, setPath] = React.useState(null)
      const [entries, setEntries] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState(null)
      const [mounting, setMounting] = React.useState(false)
      const [mountResult, setMountResult] = React.useState(null)
      // One transfer at a time: the entry name while it runs, so its row can
      // show progress and a second click cannot interleave two downloads.
      const [transferBusy, setTransferBusy] = React.useState(undefined)
      const [transferError, setTransferError] = React.useState(null)
      // Upload state is separate from download state: both can be idle at once,
      // and a failed upload must not clear a download's error or vice versa.
      const [uploadBusy, setUploadBusy] = React.useState(false)
      const [uploadError, setUploadError] = React.useState(null)
      const fileInputRef = React.useRef(null)
      const loadSeq = React.useRef(0)

      const loadDir = React.useCallback(async (p) => {
        const seq = ++loadSeq.current
        // Track the target immediately: the SSH round-trip must never leave the
        // displayed path (or the mount button) pointing at the previous directory.
        if (typeof p === 'string' && p !== '') setPath(p)
        setLoading(true)
        setError(null)
        setEntries(null)
        try {
          const query = typeof p === 'string' && p !== '' ? `&path=${encodeURIComponent(p)}` : ''
          const data = await fetchJson(`${API.ls}?alias=${encodeURIComponent(alias)}${query}`)
          if (seq !== loadSeq.current) return
          // Sort: directories first, then alphabetical.
          const sorted = (data.entries ?? []).sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory') return -1
            if (a.type !== 'directory' && b.type === 'directory') return 1
            return a.name.localeCompare(b.name)
          })
          setEntries(sorted)
          if (typeof data.path === 'string' && data.path !== '') setPath(data.path)
        } catch (err) {
          if (seq === loadSeq.current) setError(err.message)
        } finally {
          if (seq === loadSeq.current) setLoading(false)
        }
      }, [alias])

      React.useEffect(() => { loadDir(null) }, [loadDir])

      const handleEntry = (entry) => {
        if (entry.type !== 'directory' || path == null) return
        const next = path === '/' ? `/${entry.name}` : `${path}/${entry.name}`
        loadDir(next)
      }

      const handleUp = () => {
        if (path == null || path === '/') return
        const idx = path.lastIndexOf('/')
        const parent = idx <= 0 ? '/' : path.slice(0, idx)
        loadDir(parent)
      }

      /**
       * Send one local file into the directory currently being browsed.
       *
       * The bytes are posted as the raw request body (not multipart) so the
       * server can stream them straight into SFTP without a parser or a
       * temporary buffer; `path` is the directory already shown, so the file
       * lands where the user is looking rather than at a guessed root.
       */
      const handleUpload = async (file) => {
        if (path == null || file == null || uploadBusy) return
        setUploadBusy(true)
        setUploadError(null)
        try {
          const query = `?alias=${encodeURIComponent(alias)}&path=${encodeURIComponent(path)}&name=${encodeURIComponent(file.name)}`
          const response = await fetch(`${API.upload}${query}`, {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream' },
            body: file,
          })
          const text = await response.text().catch(() => '')
          let parsed
          try { parsed = JSON.parse(text) } catch { /* not JSON */ }
          if (!response.ok || parsed?.ok !== true) {
            throw new Error(parsed?.error ?? (text || `upload failed (${response.status})`))
          }
          await loadDir(path)
        } catch (err) {
          setUploadError(err.message)
        } finally {
          setUploadBusy(false)
        }
      }

      /** Open the hidden file picker, then upload whatever it returns. */
      const pickAndUpload = () => {
        if (path == null || uploadBusy) return
        const input = fileInputRef.current
        if (input == null) return
        input.value = ''
        input.click()
      }

      const handleFilePicked = (event) => {
        const file = event.target?.files?.[0]
        if (file !== undefined && file !== null) handleUpload(file)
      }

      /**
       * Pull one remote file down to the user's machine.
       *
       * The route streams the bytes back to this server, which hands them to the
       * browser as a blob so the ordinary download flow takes over. The bytes
       * never travel through the model, and `transferBusy` keeps one transfer at
       * a time so a second click cannot interleave progress with the first.
       */
      const handleDownload = async (entry) => {
        if (path == null || transferBusy) return
        const remotePath = path === '/' ? `/${entry.name}` : `${path}/${entry.name}`
        setTransferBusy(entry.name)
        setTransferError(null)
        try {
          const response = await fetch(`${API.download}?alias=${encodeURIComponent(alias)}&path=${encodeURIComponent(remotePath)}`)
          if (!response.ok) {
            const text = await response.text().catch(() => '')
            let message = text || `download failed (${response.status})`
            try {
              const parsed = JSON.parse(text)
              if (typeof parsed?.error === 'string' && parsed.error !== '') message = parsed.error
            } catch { /* not JSON */ }
            throw new Error(message)
          }
          const blob = await response.blob()
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = entry.name
          document.body.appendChild(anchor)
          anchor.click()
          anchor.remove()
          URL.revokeObjectURL(url)
        } catch (err) {
          setTransferError(err.message)
        } finally {
          setTransferBusy(undefined)
        }
      }

      const handleMount = async () => {
        setMounting(true)
        setMountResult(null)
        try {
          const result = await fetchJson(API.mount, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ alias, remotePath: path, register: true }),
          })
          setMountResult(result)
          if (result.ok) onMount?.(result)
        } catch (err) {
          setMountResult({ ok: false, error: err.message })
        } finally {
          setMounting(false)
        }
      }

      const formatSize = (bytes) => {
        if (bytes == null) return ''
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
      }

      // A transfer in flight owns the dialog: dropping it here would hide the
      // only row that reports success or failure, on a request still running.
      const dismissBackdrop = () => {
        if (!mounting && !uploadBusy && transferBusy === undefined) onClose()
      }

      return jsxs('div', { className: 'sshwsp-backdrop', ...backdropDismiss(dismissBackdrop), children: [
        jsxs('div', { className: 'sshwsp-dialog', onClick: (e) => e.stopPropagation(), children: [
          jsx('div', { className: 'sshwsp-dialog-title', children: t('browser.title', { alias }) }),
          jsxs('div', { className: 'sshwsp-dialog-body', children: [
            jsxs('div', { className: 'sshwsp-browser', children: [
              jsxs('div', { className: 'sshwsp-browser-header', children: [
                jsx('button', {
                  className: 'sshwsp-btn',
                  disabled: path == null || path === '/',
                  onClick: handleUp,
                  children: t('browser.parent'),
                }),
                // Breadcrumbs replace the dead path text: earlier segments jump
                // to their directory, the current one stays text; disabled while
                // a mount, upload or download owns the dialog.
                path == null
                  ? jsx('span', { className: 'sshwsp-browser-path', children: '…' })
                  : jsx(PathBreadcrumb, { path, disabled: mounting || uploadBusy || transferBusy !== undefined, label: t('path.crumbs'), onNavigate: loadDir }),
                jsx('button', {
                  className: 'sshwsp-btn',
                  disabled: path == null || uploadBusy,
                  title: t('browser.upload'),
                  onClick: pickAndUpload,
                  children: uploadBusy ? t('browser.uploading') : t('browser.upload'),
                }),
                jsx('input', {
                  ref: fileInputRef,
                  type: 'file',
                  style: { display: 'none' },
                  onChange: handleFilePicked,
                }),
              ]}),
              jsx('div', { className: 'sshwsp-browser-list', children:
                loading
                  ? jsx('div', { className: 'sshwsp-empty', children: t('browser.loading') })
                  : error
                    ? jsxs('div', { className: 'sshwsp-empty', children: [t('browser.error'), jsx('br', {}), jsx('span', { style: { fontSize: 11 }, children: error })] })
                    : entries?.length === 0
                      ? jsx('div', { className: 'sshwsp-empty', children: t('browser.empty') })
                      : entries?.map((entry) =>
                          jsxs('div', {
                            key: entry.name,
                            className: 'sshwsp-entry',
                            onClick: () => handleEntry(entry),
                            style: { cursor: entry.type === 'directory' ? 'pointer' : 'default' },
                            children: [
                              jsx('span', { className: 'sshwsp-entry-icon', children:
                                entry.type === 'directory'
                                  ? React.createElement(FolderIcon)
                                  : React.createElement(FileIcon),
                              }),
                              jsx('span', { className: 'sshwsp-entry-name', children: entry.name }),
                              entry.type !== 'directory' && jsx('span', { className: 'sshwsp-entry-meta', children: formatSize(entry.size) }),
                              entry.type !== 'directory' && jsx('button', {
                                className: 'sshwsp-icon-btn',
                                title: t('browser.download'),
                                'aria-label': t('browser.download'),
                                disabled: transferBusy !== undefined,
                                onClick: (event) => {
                                  event.stopPropagation()
                                  handleDownload(entry)
                                },
                                children: transferBusy === entry.name ? '…' : '↓',
                              }),
                            ],
                          })
                        )
              }),
            ]}),
            uploadError && jsxs('div', {
              className: 'sshwsp-status sshwsp-status-err',
              style: { marginTop: 8, padding: '8px 12px', borderRadius: 6 },
              children: [`${t('browser.uploadFail')}: `, uploadError],
            }),
            // A failed download names itself instead of vanishing into a toast
            // the user may miss while the dialog is open.
            transferError && jsxs('div', {
              className: 'sshwsp-status sshwsp-status-err',
              style: { marginTop: 8, padding: '8px 12px', borderRadius: 6 },
              children: [`${t('browser.downloadFail')}: `, transferError],
            }),
            mountResult && jsx('div', {
              className: mountResult.ok
                ? 'sshwsp-status sshwsp-status-ok'
                : 'sshwsp-status sshwsp-status-err',
              style: { marginTop: 12, padding: '8px 12px', borderRadius: 6 },
              children: mountResult.ok
                ? t('browser.mountOk', { path: mountResult.workspacePath })
                : `${t('browser.mountFail')}: ${mountResult.error ?? 'unknown'}`,
            }),
            // Capability advisories: only a tool the probe proved missing gets a
            // line, so an unprobeable host stays quiet instead of guessing.
            mountResult?.capabilities && jsxs('div', {
              style: { marginTop: 8, fontSize: 11, opacity: 0.8, display: 'flex', flexDirection: 'column', gap: 2 },
              children: capabilityNotes(mountResult.capabilities, t).map((note, index) => jsx('div', { key: index, children: note })),
            }),
          ]}),
          jsxs('div', { className: 'sshwsp-dialog-footer', children: [
            jsx('button', { className: 'sshwsp-btn', onClick: onClose, children: t('dialog.close') }),
            jsx('button', {
              className: 'sshwsp-btn sshwsp-btn-primary',
              disabled: mounting || path == null || mountResult?.ok === true,
              onClick: handleMount,
              children: mounting ? t('browser.mounting') : t('browser.mount'),
            }),
          ]}),
        ]}),
      ]})
    }

    // =========================================================================
    // Main panel
    // =========================================================================
    /** The local URL a forward is reachable at. */
    function forwardUrlOf (forward) {
      const host = forward.localHost === '0.0.0.0' || forward.localHost === '::' ? 'localhost' : forward.localHost
      return `http://${host}:${forward.localPort}`
    }

    /** How many rows a section shows before it starts scrolling. */
    const LIST_CAP = 5

    /** Layout effect when there is a DOM, plain effect otherwise. */
    const useLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect

    /**
     * Cap a section at LIST_CAP visible rows and scroll the rest.
     *
     * A `slice(0, 5)` would silently drop rows, which for a control panel is
     * worse than a long list: a tunnel you cannot see is a tunnel you cannot
     * turn off. The cap is a viewport, not a truncation — every row stays
     * reachable by scrolling, so it never removes an action.
     *
     * The height is MEASURED, not assumed. Rows in these sections are not a
     * uniform height: a host card grows with its description and with a
     * confirmation row, a forward row grows when an error line appears, and
     * any row can wrap taller on a narrow panel. A hardcoded `5 * 64px` would
     * show four and a half rows on one row shape and only three on another.
     * We sum the first LIST_CAP rows plus the flex gap, then pin that as the
     * max height — the exact boundary where the 6th row starts to scroll.
     *
     * Re-measure is driven by the rows themselves (not the box): a width
     * change reflows the rows, their heights change, and the observer fires.
     * Observing the box instead would feed back into itself, since we are the
     * ones setting its height.
     */
    function CappedList ({ className, children }) {
      const ref = React.useRef(null)
      const [capHeight, setCapHeight] = React.useState(null)
      const rows = React.Children.toArray(children)

      useLayoutEffect(() => {
        const el = ref.current
        if (el === null || typeof ResizeObserver === 'undefined') return undefined
        const measure = () => {
          const items = Array.from(el.children)
          if (items.length <= LIST_CAP) {
            setCapHeight(null)
            return
          }
          const style = window.getComputedStyle(el)
          const gap = Number.parseFloat(style.rowGap || style.gap || '0') || 0
          let height = gap * (LIST_CAP - 1)
          for (const item of items.slice(0, LIST_CAP)) height += item.getBoundingClientRect().height
          // +1 rounds the fractional pixels up rather than down: a sub-pixel
          // short cap would clip the fifth row and show a scrollbar early.
          setCapHeight(Math.ceil(height) + 1)
        }
        measure()
        const observer = new ResizeObserver(measure)
        for (const item of Array.from(el.children)) observer.observe(item)
        return () => observer.disconnect()
      }, [rows.length])

      return jsx('div', {
        ref,
        className: capHeight === null ? `sshwsp-cap ${className}` : `sshwsp-cap sshwsp-cap-scroll ${className}`,
        style: capHeight === null ? undefined : { maxHeight: `${capHeight}px` },
        children: rows,
      })
    }

    /**
     * Advisory notes for a capability probe result.
     *
     * Mirrors the tool-side wording: a capability the probe could not
     * determine is omitted rather than reported as missing.
     */
    function capabilityNotes (capabilities, t) {
      const notes = []
      if (capabilities.rg === false) notes.push(t('caps.rg'))
      if (capabilities.git === false) notes.push(t('caps.git'))
      if (capabilities.inotifywait === false) notes.push(t('caps.inotifywait'))
      return notes
    }

    // =========================================================================
    // Agent prompt configuration (three levels: global → host → workspace)
    // =========================================================================
    /** The global level of a fetched configuration as one display group. */
    function globalPromptGroup (config, t) {
      return {
        key: 'global',
        name: t('prompts.groupGlobal'),
        entries: [
          ...(config?.global?.globs ?? []).map(entry => ({ id: entry.id, kind: 'glob', text: entry.pattern })),
          ...(config?.global?.scripts ?? []).map(entry => ({ id: entry.id, kind: 'script', text: entry.command })),
        ],
      }
    }

    /** One host's level of a fetched configuration as a display group. */
    function hostPromptGroup (config, alias, t) {
      const level = config?.hosts?.[alias]
      return {
        key: `host:${alias}`,
        name: t('prompts.groupHost', { alias }),
        entries: [
          ...(level?.globs ?? []).map(entry => ({ id: entry.id, kind: 'glob', text: entry.pattern })),
          ...(level?.scripts ?? []).map(entry => ({ id: entry.id, kind: 'script', text: entry.command })),
        ],
      }
    }

    /** Add or remove one id from a disable list (enabled = the entry loads). */
    function toggleDisabled (disabled, id, enabled) {
      return enabled
        ? disabled.filter(entry => entry !== id)
        : (disabled.includes(id) ? disabled : [...disabled, id])
    }

    /** Raw payload from the editor's string arrays. */
    function promptPayload (globs, scripts, disabled) {
      return {
        globs: globs.map(value => value.trim()).filter(value => value !== ''),
        scripts: scripts.map(value => value.trim()).filter(value => value !== ''),
        disabled: disabled.slice(),
      }
    }

    /**
     * The editable rows of one kind (glob patterns or script commands).
     *
     * The editor keeps RAW STRINGS; the server derives ids and drops invalid
     * entries on save, so the client never re-implements that normalization.
     */
    function PromptEntryRows ({ t, label, hint, entries, onChange, addLabel, placeholder }) {
      return jsxs('div', { className: 'sshwsp-field', children: [
        jsx('span', { className: 'sshwsp-field-label', children: label }),
        hint != null && jsx('span', { className: 'sshwsp-field-hint', children: hint }),
        entries.map((value, index) => jsxs('div', { className: 'sshwsp-prompt-row', children: [
          jsx('input', {
            className: 'sshwsp-input',
            value,
            placeholder,
            spellCheck: false,
            onChange: (event) => {
              const next = entries.slice()
              next[index] = event.target.value
              onChange(next)
            },
          }),
          jsx('button', {
            className: 'sshwsp-btn',
            title: t('prompts.remove'),
            onClick: () => onChange(entries.filter((_, i) => i !== index)),
            children: '\u00d7',
          }),
        ], key: index })),
        jsx('div', { children: jsx('button', { className: 'sshwsp-btn', onClick: () => onChange([...entries, '']), children: addLabel }) }),
      ]})
    }

    /**
     * The upper-level entries with their enable toggles.
     *
     * Unchecking writes the entry's id into this level's disable list — the
     * entry stops contributing files entirely (it is NOT overridden or
     * edited); re-checking removes the id again.
     */
    function PromptInherited ({ t, groups, disabled, onToggle }) {
      const present = groups.filter(group => group.entries.length > 0)
      if (present.length === 0) return null
      return jsxs('div', { className: 'sshwsp-prompt-upper', children: [
        jsx('span', { className: 'sshwsp-field-label', children: t('prompts.inherited') }),
        present.map(group => jsxs('div', { children: [
          jsx('div', { className: 'sshwsp-prompt-group', children: group.name }),
          group.entries.map(entry => jsxs('label', { className: 'sshwsp-prompt-item', children: [
            jsx('input', {
              type: 'checkbox',
              checked: !disabled.includes(entry.id),
              onChange: (event) => onToggle(entry.id, event.target.checked),
            }),
            jsx('span', { className: 'sshwsp-prompt-kind', children: entry.kind === 'glob' ? t('prompts.kindGlob') : t('prompts.kindScript') }),
            jsx('span', { className: 'sshwsp-prompt-item-code', title: entry.text, children: entry.text }),
          ], key: entry.id })),
        ], key: group.key })),
      ]})
    }

    /** Fetch the whole configuration once; returns a disposer-safe loader. */
    function useAgentPromptConfig (onLoaded) {
      React.useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const data = await fetchJson(API.agentPrompts)
            if (alive) onLoaded(data)
          } catch { /* the panel works without the prompt configuration */ }
        })()
        return () => { alive = false }
      }, [])
    }

    /**
     * The standalone editor dialog: the panel's global entry and each mounted
     * workspace's entry both open this. Scope decides which level is edited
     * and which upper levels show up as disable toggles.
     */
    function AgentPromptsEditor ({ scope, alias, workspacePath, t, onClose, onSaved }) {
      const [loading, setLoading] = React.useState(true)
      const [globs, setGlobs] = React.useState([])
      const [scripts, setScripts] = React.useState([])
      const [disabled, setDisabled] = React.useState([])
      const [config, setConfig] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [previewTarget, setPreviewTarget] = React.useState(workspacePath ?? '')
      const [preview, setPreview] = React.useState(null)

      useAgentPromptConfig((data) => {
        setConfig(data)
        const level = scope === 'global'
          ? (data.global ?? { globs: [], scripts: [], disabled: [] })
          : scope === 'host'
            ? (data.hosts?.[alias] ?? { globs: [], scripts: [], disabled: [] })
            : (data.workspaces?.[workspacePath] ?? { globs: [], scripts: [], disabled: [] })
        setGlobs((level.globs ?? []).map(entry => entry.pattern))
        setScripts((level.scripts ?? []).map(entry => entry.command))
        setDisabled((level.disabled ?? []).slice())
        if (workspacePath === undefined) setPreviewTarget((data.mounted ?? [])[0] ?? '')
        setLoading(false)
      })

      const groups = () => {
        if (config === null || scope === 'global') return []
        return scope === 'host'
          ? [globalPromptGroup(config, t)]
          : [globalPromptGroup(config, t), hostPromptGroup(config, alias, t)]
      }

      const save = async () => {
        setSaving(true)
        setError(null)
        try {
          const body = scope === 'global'
            ? promptPayload(globs, scripts, disabled)
            : scope === 'host'
              ? { alias, ...promptPayload(globs, scripts, disabled) }
              : { workspacePath, ...promptPayload(globs, scripts, disabled) }
          const url = scope === 'global' ? API.agentPromptsGlobal : scope === 'host' ? API.agentPromptsHost : API.agentPromptsWorkspace
          const result = await fetchJson(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (result.ok === false) { setError(result.error ?? t('prompts.saveFail')); return }
          onSaved?.(t('prompts.saveOk'))
        } catch (err) {
          setError(err.message)
        } finally {
          setSaving(false)
        }
      }

      const runPreview = async () => {
        if (previewTarget === '') return
        setPreview({ busy: true })
        try {
          const result = await fetchJson(`${API.agentPromptsPreview}?workspacePath=${encodeURIComponent(previewTarget)}`)
          if (result.ok === false) { setPreview({ error: result.error ?? t('prompts.previewFail') }); return }
          setPreview({ files: result.files ?? [], errors: result.errors ?? [], chars: result.chars })
        } catch (err) {
          setPreview({ error: err.message })
        }
      }

      // A save in flight must finish; so must the initial load (its result is
      // the only thing that fills the rows).
      const dismissBackdrop = () => { if (!saving && !loading) onClose() }

      return jsxs('div', { className: 'sshwsp-backdrop', ...backdropDismiss(dismissBackdrop), children: [
        jsxs('div', { className: 'sshwsp-dialog', onClick: (event) => event.stopPropagation(), children: [
          jsx('div', { className: 'sshwsp-dialog-title', children: scope === 'global' ? t('prompts.globalTitle') : t('prompts.workspaceTitle') }),
          jsxs('div', { className: 'sshwsp-form', children: [
            jsx('div', { className: 'sshwsp-entry-meta', children: t('prompts.hint') }),
            jsx(PromptEntryRows, { t, label: t('prompts.globs'), hint: t('prompts.globHint'), entries: globs, onChange: setGlobs, addLabel: t('prompts.addGlob'), placeholder: '/data/notes/**/*-common/*.md' }),
            jsx(PromptEntryRows, { t, label: t('prompts.scripts'), hint: t('prompts.scriptHint'), entries: scripts, onChange: setScripts, addLabel: t('prompts.addScript'), placeholder: 'node /data/gen-prompts.js' }),
            jsx(PromptInherited, {
              t,
              groups: groups(),
              disabled,
              onToggle: (id, checked) => setDisabled(toggleDisabled(disabled, id, checked)),
            }),
            jsxs('div', { className: 'sshwsp-field', children: [
              jsx('span', { className: 'sshwsp-field-label', children: t('prompts.previewTarget') }),
              jsxs('div', { className: 'sshwsp-prompt-row', children: [
                jsx('select', {
                  className: 'sshwsp-input sshwsp-select',
                  value: previewTarget,
                  disabled: loading,
                  onChange: (event) => setPreviewTarget(event.target.value),
                  children: (config?.mounted ?? []).map(path => jsx('option', { key: path, value: path, children: path })),
                }),
                jsx('button', { className: 'sshwsp-btn', disabled: previewTarget === '' || preview?.busy === true, onClick: runPreview, children: preview?.busy === true ? t('prompts.previewing') : t('prompts.preview') }),
              ]}),
              preview !== null && jsxs('div', { className: 'sshwsp-prompt-preview', children: [
                preview.error != null && jsx('span', { className: 'sshwsp-prompt-preview-error', children: preview.error }),
                preview.files !== undefined && (preview.files.length === 0
                  ? jsx('span', { children: t('prompts.previewNone') })
                  : jsxs(Fragment, { children: [
                      jsx('span', { children: t('prompts.previewFiles', { n: preview.files.length }) }),
                      ...preview.files.map(file => jsx('span', { className: 'sshwsp-prompt-preview-item', children: file }, file)),
                    ] })),
                (preview.errors ?? []).length > 0 && jsxs(Fragment, { children: [
                  jsx('span', { className: 'sshwsp-prompt-warn', children: t('prompts.previewErrors', { n: preview.errors.length }) }),
                  ...preview.errors.map((entry, index) => jsx('span', { className: 'sshwsp-prompt-preview-error', children: entry.message }, index)),
                ] }),
              ] }),
            ]}),
            error && jsx('div', { className: 'sshwsp-error', children: error }),
          ]}),
          jsxs('div', { className: 'sshwsp-dialog-footer', children: [
            jsx('button', { className: 'sshwsp-btn', onClick: onClose, disabled: saving, children: t('editor.cancel') }),
            jsx('button', { className: 'sshwsp-btn sshwsp-btn-primary', onClick: save, disabled: saving || loading, children: saving ? t('prompts.saving') : t('prompts.save') }),
          ]}),
        ]}),
      ]})
    }

    function RemoteWorkspacePanel ({ t }) {
      const [hosts, setHosts] = React.useState([])
      const [status, setStatus] = React.useState({ mounted: [], disabled: [], connections: [], forwards: [], forwardRows: [], forwardSettings: { autoStart: false } })
      const [testStates, setTestStates] = React.useState({})
      const [browserAlias, setBrowserAlias] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      // undefined = closed, null = create, a host row = edit that host.
      const [editorHost, setEditorHost] = React.useState(undefined)
      const [deletingAlias, setDeletingAlias] = React.useState(null)
      const [deleteErrors, setDeleteErrors] = React.useState({})
      const [toast, setToast] = React.useState(null)
      const [forwardAlias, setForwardAlias] = React.useState('')
      const [forwardRemotePort, setForwardRemotePort] = React.useState('')
      const [forwardLocalPort, setForwardLocalPort] = React.useState('')
      const [forwardBusy, setForwardBusy] = React.useState(false)
      // Which saved row is mid-toggle, so only that row's button shows progress.
      const [forwardRowBusy, setForwardRowBusy] = React.useState(null)
      const [forwardDeleteId, setForwardDeleteId] = React.useState(null)
      // Advisory local-port verdict for the form, keyed by "host:port".
      const [portCheck, setPortCheck] = React.useState(null)
      // Which workspace row has an armed unmount confirmation, and the mode it
      // would run with. Arming is separate state so the first click is
      // reversible and cannot unload a workspace by accident.
      const [unmountConfirm, setUnmountConfirm] = React.useState(null)
      const [unmountMode, setUnmountMode] = React.useState('detach')
      const [unmountBusy, setUnmountBusy] = React.useState(null)
      const [enableBusy, setEnableBusy] = React.useState(null)
      // Agent-prompt editor: null = closed, { scope: 'global' } = the global
      // level, { scope: 'workspace', workspacePath } = one workspace's level.
      // The host-level entry lives inside the host editor dialog instead.
      const [promptEditor, setPromptEditor] = React.useState(null)

      // Transient test-connection result: auto-dismiss after a few seconds,
      // click to dismiss early. A fresh object per toast restarts the timer.
      React.useEffect(() => {
        if (toast === null) return undefined
        const timer = setTimeout(() => setToast(null), 3500)
        return () => clearTimeout(timer)
      }, [toast])

      const refresh = React.useCallback(async () => {
        setLoading(true)
        try {
          const [hostsData, statusData] = await Promise.all([
            fetchJson(API.hosts),
            fetchJson(API.status),
          ])
          setHosts(hostsData.hosts ?? [])
          setStatus(statusData)
          syncRemoteWorkspaceMarks(statusData.workspaces, statusData.disabled)
          // The same reply carries the pinned OS per host: the mark layer
          // repaints with per-OS glyphs once it is in.
          syncHostOsMarks(hostsData.hosts ?? [])
        } catch { /* silent */ }
        finally { setLoading(false) }
      }, [])

      React.useEffect(() => { refresh() }, [refresh])

      /**
       * Probe one host: connect, prove it works, then let the connection go.
       *
       * "Test" answers "does this host answer at all" — it is not a way to open
       * a session. The server releases the connection it just proved (unless an
       * open port forward pins it), so the panel's connection indicator does not
       * light up from a mere probe. The refresh below therefore reports what is
       * actually left rather than assuming the test left a connection behind.
       */
      const handleTest = async (alias) => {
        setTestStates((prev) => ({ ...prev, [alias]: { status: 'testing' } }))
        try {
          const result = await fetchJson(API.test, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ alias }),
          })
          setTestStates((prev) => ({
            ...prev,
            [alias]: { status: result.ok ? 'ok' : 'failed', durationMs: result.durationMs, error: result.error },
          }))
          setToast(result.ok
            ? { kind: 'ok', text: t('hosts.testOk', { ms: result.durationMs }) }
            : { kind: 'err', text: `${t('hosts.testFail')}${result.error ? `: ${result.error}` : ''}` })
          // The probe released its connection, so the indicator must be
          // re-read rather than optimistically marked connected.
          const s = await fetchJson(API.status)
          setStatus(s)
        } catch (err) {
          setTestStates((prev) => ({
            ...prev,
            [alias]: { status: 'failed', error: err.message },
          }))
          setToast({ kind: 'err', text: `${t('hosts.testFail')}: ${err.message}` })
        }
      }

      const handleDelete = async (alias) => {
        setDeletingAlias(alias)
        setDeleteErrors((prev) => {
          const next = { ...prev }
          delete next[alias]
          return next
        })
        try {
          const result = await fetchJson(API.hostDelete, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ alias }),
          })
          if (!result.ok) {
            setDeleteErrors((prev) => ({ ...prev, [alias]: result.error ?? t('hosts.deleteFail') }))
          } else {
            await refresh()
          }
        } catch (err) {
          setDeleteErrors((prev) => ({ ...prev, [alias]: err.message }))
        } finally {
          setDeletingAlias(null)
        }
      }

      const handleForgetKey = async (alias) => {
        try {
          const result = await fetchJson(API.hostForgetKey, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ alias }),
          })
          if (!result.ok) {
            setToast({ kind: 'err', text: `${t('hosts.forgetKeyFail')}${result.error ? `: ${result.error}` : ''}` })
          } else {
            setToast({ kind: 'ok', text: t('hosts.forgetKeyOk') })
            // The pooled connection was dropped server-side; refresh so the
            // connection rows stop claiming it is still up.
            const s = await fetchJson(API.status)
            setStatus(s)
          }
        } catch (err) {
          setToast({ kind: 'err', text: `${t('hosts.forgetKeyFail')}: ${err.message}` })
        }
      }

      const handleDisconnect = async (alias) => {
        try {
          const result = await fetchJson(API.hostDisconnect, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ alias }),
          })
          if (!result.ok) {
            setToast({ kind: 'err', text: `${t('hosts.disconnectFail')}${result.error ? `: ${result.error}` : ''}` })
            return
          }
          // Report the tunnels too: they went away because the user asked for
          // it, and saying so is what keeps this from looking like the failure
          // the panel would otherwise show for a dropped connection.
          const closedForwards = Number(result.closedForwards ?? 0)
          setToast({
            kind: 'ok',
            text: closedForwards > 0
              ? t('hosts.disconnectOkForwards').replace('{n}', String(closedForwards))
              : t('hosts.disconnectOk'),
          })
          // The connection is gone server-side; refresh so the indicator follows.
          try {
            const s = await fetchJson(API.status)
            setStatus(s)
          } catch { /* best-effort refresh */ }
        } catch (err) {
          setToast({ kind: 'err', text: `${t('hosts.disconnectFail')}: ${err.message}` })
        }
      }

      /**
       * Unload one workspace.
       *
       * Two steps on purpose. The first click only arms the row, because this
       * touches every session the workspace accounts for; the second click is
       * what actually runs it. The confirm text states what survives —
       * "archived" is not "deleted", and that distinction is the whole reason
       * this is reversible.
       *
       * Whether sessions are archived is decided by the mode, not sent as a
       * separate constant: keeping the workspace record (the default) means
       * the sidebar group and its sessions must stay, so archiving them would
       * empty the group the user chose to keep.
       */
      const handleUnmount = async (workspacePath, mode) => {
        setUnmountBusy(workspacePath)
        try {
          const effectiveMode = mode ?? 'detach'
          const result = await fetchJson(API.unmount, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ workspacePath, mode: effectiveMode }),
          })
          if (!result.ok) {
            setToast({ kind: 'err', text: `${t('mounted.detachFail')}${result.error ? `: ${result.error}` : ''}` })
          } else if ((result.archiveFailed ?? []).length > 0) {
            setToast({ kind: 'err', text: `${t('mounted.detachPartial')}: ${result.archiveFailed.length}` })
          } else if (effectiveMode === 'detach') {
            // No sessions were archived on purpose: the group stays populated.
            setToast({ kind: 'ok', text: t('mounted.detachOkKeep') })
          } else {
            setToast({ kind: 'ok', text: t('mounted.detachOk').replace('{n}', String((result.archived ?? []).length)) })
          }
          setUnmountConfirm(null)
          await refresh()
        } catch (err) {
          setToast({ kind: 'err', text: `${t('mounted.detachFail')}: ${err.message}` })
        } finally {
          setUnmountBusy(null)
        }
      }

      /** Mount a detached workspace again and unarchive its sessions. */
      const handleEnable = async (workspacePath) => {
        setEnableBusy(workspacePath)
        try {
          const result = await fetchJson(API.enable, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ workspacePath, unarchiveSessions: true }),
          })
          if (!result.ok) {
            setToast({ kind: 'err', text: `${t('detached.enableFail')}${result.error ? `: ${result.error}` : ''}` })
          } else {
            setToast({ kind: 'ok', text: t('detached.enableOk').replace('{path}', workspacePath) })
          }
          await refresh()
        } catch (err) {
          setToast({ kind: 'err', text: `${t('detached.enableFail')}: ${err.message}` })
        } finally {
          setEnableBusy(null)
        }
      }

      const handleForward = async () => {
        const remotePort = Number.parseInt(forwardRemotePort.trim(), 10)
        const localPortText = forwardLocalPort.trim()
        const localPort = localPortText === '' ? remotePort : Number.parseInt(localPortText, 10)
        const validPort = (value) => Number.isInteger(value) && value >= 1 && value <= 65535
        if (!validPort(remotePort) || !validPort(localPort)) {
          setToast({ kind: 'err', text: t('editor.badPort') })
          return
        }
        setForwardBusy(true)
        try {
          // A saved mapping pins its local port, so the form always sends one
          // (defaulting to the remote port) rather than asking for an ephemeral
          // port the store could not describe.
          const result = await fetchJson(API.forwardSave, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ alias: forwardAlias, remotePort, localPort }),
          })
          if (!result.ok) {
            setToast({ kind: 'err', text: `${t('forwards.fail')}: ${result.error ?? ''}` })
          } else {
            setForwardRemotePort('')
            setForwardLocalPort('')
            if (result.error !== undefined) setToast({ kind: 'err', text: `${t('forwards.fail')}: ${result.error}` })
          }
          await refresh()
        } catch (err) {
          setToast({ kind: 'err', text: `${t('forwards.fail')}: ${err.message}` })
        } finally {
          setForwardBusy(false)
          setPortCheck(null)
        }
      }

      /**
       * Check the local port the form would bind, before the user commits.
       *
       * Runs on blur rather than on every keystroke: a probe binds a real
       * listener, and doing that per character would both spam the OS and race
       * the user's typing. The verdict is advisory — the save path probes again
       * and the bind itself stays authoritative.
       */
      const checkForwardPort = async () => {
        const remotePort = Number.parseInt(forwardRemotePort.trim(), 10)
        const localPortText = forwardLocalPort.trim()
        const localPort = localPortText === '' ? remotePort : Number.parseInt(localPortText, 10)
        if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) { setPortCheck(null); return }
        const key = `127.0.0.1:${localPort}`
        setPortCheck({ key, state: 'checking' })
        try {
          const url = `${API.forwardProbe}?localHost=127.0.0.1&localPort=${localPort}`
          const result = await fetchJson(url)
          setPortCheck({ key, state: result.available === true ? 'free' : 'busy', code: result.code })
        } catch {
          // A probe that cannot run must not block the form: the save path is
          // the authority, and a failed probe says nothing about the port.
          setPortCheck(null)
        }
      }

      const handleForwardToggle = async (row) => {
        setForwardRowBusy(row.id)
        try {
          const result = await fetchJson(API.forwardToggle, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            // The requested state comes from the runtime fact, not from the
            // stored intent: a row whose intent is on but whose tunnel died is
            // still showing "turn on".
            body: JSON.stringify({ id: row.id, enabled: row.live !== true }),
          })
          if (!result.ok) {
            setToast({ kind: 'err', text: `${t('forwards.fail')}: ${result.error ?? ''}` })
          }
          await refresh()
        } catch (err) {
          setToast({ kind: 'err', text: `${t('forwards.fail')}: ${err.message}` })
        } finally {
          setForwardRowBusy(null)
        }
      }

      const handleForwardRemember = async (id) => {
        setForwardRowBusy(id)
        try {
          const result = await fetchJson(API.forwardRemember, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
          })
          if (!result.ok) setToast({ kind: 'err', text: `${t('forwards.fail')}: ${result.error ?? ''}` })
          await refresh()
        } catch (err) {
          setToast({ kind: 'err', text: `${t('forwards.fail')}: ${err.message}` })
        } finally {
          setForwardRowBusy(null)
        }
      }

      const handleForwardDelete = async (id) => {
        setForwardRowBusy(id)
        try {
          await fetchJson(API.forwardDelete, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
          })
          setForwardDeleteId(null)
          await refresh()
        } catch { /* silent */ } finally {
          setForwardRowBusy(null)
        }
      }

      /** Persist the auto-start preference. Optimistic, rolled back on failure. */
      const handleAutoStart = async (next) => {
        setStatus((prev) => ({ ...prev, forwardSettings: { ...(prev.forwardSettings ?? {}), autoStart: next } }))
        try {
          const result = await fetchJson(API.forwardSettings, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ autoStart: next }),
          })
          if (!result.ok) {
            setStatus((prev) => ({ ...prev, forwardSettings: { ...(prev.forwardSettings ?? {}), autoStart: !next } }))
            setToast({ kind: 'err', text: result.error ?? '' })
          }
        } catch (err) {
          setStatus((prev) => ({ ...prev, forwardSettings: { ...(prev.forwardSettings ?? {}), autoStart: !next } }))
          setToast({ kind: 'err', text: err.message })
        }
      }

      const handleUnforward = async (id) => {
        try {
          await fetchJson(API.unforward, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
          })
          refresh()
        } catch { /* silent */ }
      }
      const connMap = new Map()
      for (const c of status.connections ?? []) connMap.set(c.alias, c)

      return jsxs('div', { className: 'sshwsp', children: [
        jsxs('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }, children: [
          jsx('h2', { style: { margin: 0 }, children: t('panel.title') }),
          jsx('button', { className: 'sshwsp-btn', onClick: refresh, disabled: loading, children: t('refresh') }),
        ]}),

        // ---- Hosts
        jsxs('div', { className: 'sshwsp-section-head', children: [
          jsx('h3', { children: t('hosts.title') }),
          jsx('button', { className: 'sshwsp-btn', onClick: () => setEditorHost(null), children: t('hosts.add') }),
        ]}),
        hosts.length === 0
          ? jsx('div', { className: 'sshwsp-empty', children: loading ? t('panel.loading') : t('panel.empty') })
          : jsx(CappedList, {
              className: 'sshwsp-hosts',
              children: hosts.map((host) => jsx(HostCard, {
                key: host.alias,
                host,
                t,
                conn: connMap.get(host.alias),
                onTest: handleTest,
                onBrowse: setBrowserAlias,
                onEdit: (row) => setEditorHost(row),
                onDelete: handleDelete,
                onForgetKey: handleForgetKey,
                onDisconnect: handleDisconnect,
                testState: testStates[host.alias],
                deleteError: deleteErrors[host.alias],
                deleting: deletingAlias === host.alias,
              })),
            }),

        // ---- Agent prompts (three-level configuration entry)
        jsxs('div', { className: 'sshwsp-section-head', children: [
          jsx('h3', { children: t('prompts.title') }),
          jsx('button', { className: 'sshwsp-btn', onClick: () => setPromptEditor({ scope: 'global' }), children: t('prompts.globalConfig') }),
        ]}),
        jsx('div', { className: 'sshwsp-entry-meta', children: t('prompts.hint') }),

        // ---- Port forwards
        jsx('div', { className: 'sshwsp-section-head', children: [
          jsx('h3', { children: t('forwards.title') }),
        ]}),
        jsxs('div', { className: 'sshwsp-forward-new', children: [
          jsx('select', {
            className: 'sshwsp-input sshwsp-select',
            value: forwardAlias,
            disabled: forwardBusy || hosts.length === 0,
            onChange: (event) => setForwardAlias(event.target.value),
            children: [
              jsx('option', { value: '', children: t('remote.host') }),
              ...hosts.map((host) => jsx('option', { key: host.alias, value: host.alias, children: host.alias })),
            ],
          }),
          jsx('input', {
            className: 'sshwsp-input sshwsp-input-port',
            type: 'number',
            min: 1,
            max: 65535,
            // The box is deliberately narrow, so the placeholder is also the
            // only label: title keeps the full meaning reachable when the
            // text clips.
            placeholder: t('forwards.remotePort'),
            title: t('forwards.remotePort'),
            value: forwardRemotePort,
            disabled: forwardBusy,
            onChange: (event) => { setForwardRemotePort(event.target.value); setPortCheck(null) },
            onKeyDown: (event) => { if (event.key === 'Enter') handleForward() },
          }),
          jsx('input', {
            className: 'sshwsp-input sshwsp-input-port',
            type: 'number',
            min: 1,
            max: 65535,
            placeholder: t('forwards.localPlaceholder'),
            title: `${t('forwards.localPort')} — ${t('forwards.localPlaceholder')}`,
            value: forwardLocalPort,
            disabled: forwardBusy,
            onChange: (event) => { setForwardLocalPort(event.target.value); setPortCheck(null) },
            onBlur: checkForwardPort,
            onKeyDown: (event) => { if (event.key === 'Enter') handleForward() },
          }),
          jsx('button', {
            className: 'sshwsp-btn sshwsp-btn-primary',
            disabled: forwardBusy || forwardAlias === '' || forwardRemotePort.trim() === '',
            onClick: handleForward,
            children: forwardBusy ? t('forwards.saving') : t('forwards.save'),
          }),
        ]}),
        // The probe is advisory: it names the reason early, but the save path
        // probes again and the real bind stays the authority.
        portCheck !== null && jsx('div', {
          className: `sshwsp-porthint ${portCheck.state === 'busy' ? 'sshwsp-porthint-busy' : portCheck.state === 'free' ? 'sshwsp-porthint-free' : ''}`,
          children: portCheck.state === 'checking'
            ? t('forwards.checking')
            : portCheck.state === 'free'
              ? t('forwards.portFree')
              : portCheck.code === 'EADDRINUSE' ? t('forwards.portBusy') : t('forwards.portReserved'),
        }),
        jsx('label', {
          className: 'sshwsp-check sshwsp-forward-autostart',
          // The explanation is a hover tooltip rather than a permanent line:
          // it only matters the first time, and leaving it inline pushed the
          // saved-mapping list down on every render.
          title: t('forwards.autoStartHint'),
          // Checkbox first, label second: the box sits to the LEFT of the title.
          children: [
            jsx('input', {
              type: 'checkbox',
              checked: status.forwardSettings?.autoStart === true,
              onChange: (event) => handleAutoStart(event.target.checked),
            }),
            jsxs('span', { className: 'sshwsp-check-text', children: [
              jsx('span', { className: 'sshwsp-field-label', children: t('forwards.autoStart') }),
            ]}),
          ],
        }),
        (status.forwardRows ?? []).length === 0
          ? jsx('div', { className: 'sshwsp-empty', children: t('forwards.none') })
          : jsx(CappedList, { className: 'sshwsp-forwards', children: (status.forwardRows ?? []).map((forward) => {
              const busy = forwardRowBusy === forward.id
              const live = forward.live === true
              const url = forwardUrlOf(forward)
              return jsxs('div', {
                key: forward.id,
                className: `sshwsp-mount sshwsp-forward-row${live ? '' : ' sshwsp-forward-off'}`,
                children: [
                  jsx('span', {
                    className: 'sshwsp-mount-path',
                    children: `${forward.localHost}:${forward.localPort} → ${forward.alias}:${forward.remoteHost}:${forward.remotePort}`,
                  }),
                  // The state chip reports the runtime fact; the stored intent
                  // only decides whether a tunnel comes back on startup.
                  jsx('span', {
                    className: `sshwsp-status ${live ? 'sshwsp-status-ok' : 'sshwsp-status-warn'}`,
                    children: live ? t('forwards.enabled') : t('forwards.disabled'),
                  }),
                  live && forward.connections > 0 && jsx('span', { className: 'sshwsp-entry-meta', children: t('forwards.connections', { n: forward.connections }) }),
                  !live && typeof forward.error === 'string' && forward.error !== '' && jsx('span', {
                    className: 'sshwsp-error sshwsp-forward-error',
                    title: forward.error,
                    children: forward.error.includes('connection') ? t('forwards.lost') : forward.error,
                  }),
                  live && jsx('a', {
                    className: 'sshwsp-btn',
                    href: url,
                    target: '_blank',
                    rel: 'noreferrer',
                    children: t('forwards.open'),
                  }),
                  forward.persisted === true
                    ? jsx('button', {
                        className: 'sshwsp-btn',
                        disabled: busy,
                        // Label follows the runtime fact, so a dead tunnel never
                        // shows "turn off".
                        onClick: () => handleForwardToggle(forward),
                        children: busy ? t('forwards.busy') : live ? t('forwards.disable') : t('forwards.enable'),
                      })
                    : jsxs(Fragment, { children: [
                        // A transient tunnel (opened by the agent tool) can be
                        // closed here too, but it has no stored row to toggle:
                        // it can only be closed or kept.
                        jsx('button', {
                          className: 'sshwsp-btn sshwsp-btn-danger',
                          disabled: busy,
                          onClick: () => handleUnforward(forward.id),
                          children: t('forwards.close'),
                        }),
                        jsx('button', {
                          className: 'sshwsp-btn',
                          disabled: busy,
                          title: t('forwards.rememberHint'),
                          onClick: () => handleForwardRemember(forward.id),
                          children: busy ? t('forwards.busy') : t('forwards.remember'),
                        }),
                      ]}),
                  forward.persisted === true && forwardDeleteId === forward.id
                    ? jsxs(Fragment, { children: [
                        jsx('button', {
                          className: 'sshwsp-btn sshwsp-btn-danger',
                          disabled: busy,
                          onClick: () => handleForwardDelete(forward.id),
                          children: t('forwards.deleteConfirm'),
                        }),
                        jsx('button', {
                          className: 'sshwsp-btn',
                          disabled: busy,
                          onClick: () => setForwardDeleteId(null),
                          children: t('editor.cancel'),
                        }),
                      ]})
                    : forward.persisted === true && jsx('button', {
                        className: 'sshwsp-btn sshwsp-btn-danger',
                        disabled: busy,
                        onClick: () => setForwardDeleteId(forward.id),
                        children: t('forwards.delete'),
                      }),
                  // A saved row that is not live but whose intent is on means
                  // the tunnel went away by itself — clarify that it will come
                  // back only when auto-start is on and the plugin restarts.
                  forward.persisted === true && !live && forward.enabled === true && jsx('span', {
                    className: 'sshwsp-entry-meta',
                    children: status.forwardSettings?.autoStart === true ? t('forwards.autoStart') : '',
                  }),
                ],
              })
            })}),

        // ---- Mounted workspaces
        jsx('h3', { children: t('mounted.title') }),
        (status.mounted ?? []).length === 0
          ? jsx('div', { className: 'sshwsp-empty', children: t('mounted.none') })
          : jsx(CappedList, { className: 'sshwsp-mounts', children: (status.mounted ?? []).map((wsPath) => {
              const armed = unmountConfirm === wsPath
              const busy = unmountBusy === wsPath
              return jsxs('div', { key: wsPath, className: 'sshwsp-mount', children: [
                // The mark speaks the host's pinned OS when the panel knows it
                // (alias parsed straight off the ssh:// path); unknown stays the
                // generic remote chevrons.
                React.createElement(OsMarkIcon, {
                  os: hostOsByAlias.get(aliasOfWorkspacePath(wsPath)),
                  size: 16,
                  className: 'sshwsp-entry-icon',
                }),
                jsx('span', { className: 'sshwsp-mount-path', children: wsPath }),
                armed
                  ? jsxs(Fragment, { children: [
                      jsx('label', {
                        className: 'sshwsp-check',
                        children: [
                          jsx('input', {
                            type: 'checkbox',
                            checked: unmountMode === 'deregister',
                            onChange: (event) => setUnmountMode(event.target.checked ? 'deregister' : 'detach'),
                          }),
                          jsx('span', { children: t('mounted.removeRecord') }),
                        ],
                      }),
                      jsx('button', {
                        className: 'sshwsp-btn sshwsp-btn-danger',
                        disabled: busy,
                        // Same tooltip as the unarmed button: this IS that button
                        // once armed, and the armed state is the moment the
                        // consequence matters most — dropping the hint here would
                        // hide it exactly when the click becomes irreversible.
                        title: t('mounted.detachHint'),
                        onClick: () => handleUnmount(wsPath, unmountMode),
                        children: busy ? t('mounted.unmounting') : t('mounted.confirmDetach'),
                      }),
                      jsx('button', {
                        className: 'sshwsp-btn',
                        disabled: busy,
                        onClick: () => { setUnmountConfirm(null); setUnmountMode('detach') },
                        children: t('editor.cancel'),
                      }),
                    ]})
                  : jsxs(Fragment, { children: [
                      jsx('button', {
                        className: 'sshwsp-btn',
                        title: t('prompts.hint'),
                        onClick: () => setPromptEditor({ scope: 'workspace', workspacePath: wsPath }),
                        children: t('prompts.workspaceConfig'),
                      }),
                      jsx('button', {
                        className: 'sshwsp-btn sshwsp-btn-danger',
                        disabled: busy,
                        title: t('mounted.detachHint'),
                        onClick: () => { setUnmountConfirm(wsPath); setUnmountMode('detach') },
                        children: t('mounted.unmount'),
                      }),
                    ]}),
              ]})
            })}),

        // ---- Detached workspaces
        // Always rendered: an empty section is how the user learns that
        // "unmount" leaves something behind to re-enable, and where it went.
        jsx('h3', { children: t('detached.title') }),
        (status.disabled ?? []).length === 0
          ? jsx('div', { className: 'sshwsp-empty', children: t('detached.none') })
          : jsxs(Fragment, { children: [
              jsx('div', { className: 'sshwsp-entry-meta', children: t('detached.hint') }),
              jsx(CappedList, { className: 'sshwsp-mounts', children: (status.disabled ?? []).map((wsPath) => {
                const busy = enableBusy === wsPath
                return jsxs('div', { key: wsPath, className: 'sshwsp-mount sshwsp-mount-off', children: [
                  jsx('span', { className: 'sshwsp-mount-path', children: wsPath }),
                  jsx('span', { className: 'sshwsp-entry-meta', children: t('detached.badge') }),
                  jsx('button', {
                    className: 'sshwsp-btn',
                    disabled: busy,
                    onClick: () => handleEnable(wsPath),
                    children: busy ? t('detached.enabling') : t('detached.enable'),
                  }),
                ]})
              })}),
            ]}),

        // ---- Persistent remote shells
        // Only shown once the agent has opened one: an empty section would
        // suggest a control this panel does not own.
        (status.shells ?? []).length > 0 && jsxs('div', { children: [
          jsx('h3', { children: t('shells.title') }),
          (status.shells ?? []).map((shell) => jsxs('div', {
            key: `${shell.alias}:${shell.session}`,
            className: 'sshwsp-mount',
            children: [
              jsx('span', { className: 'sshwsp-mount-path', children: `${shell.alias} [${shell.session}]` }),
              jsx('span', {
                className: 'sshwsp-entry-meta',
                children: shell.alive ? t('shells.alive') : t('shells.closed'),
              }),
            ],
          })),
        ]}),

        // ---- Browser dialog
        browserAlias !== null && jsx(DirectoryBrowser, {
          alias: browserAlias,
          onClose: () => setBrowserAlias(null),
          onMount: () => { refresh(); setBrowserAlias(null) },
          t,
        }),

        // ---- Host editor dialog
        editorHost !== undefined && jsx(HostEditor, {
          host: editorHost,
          t,
          onClose: () => setEditorHost(undefined),
          onSaved: () => { setEditorHost(undefined); refresh() },
        }),

        // ---- Agent prompt editor dialog (global / per-workspace)
        promptEditor !== null && jsx(AgentPromptsEditor, {
          scope: promptEditor.scope,
          alias: promptEditor.workspacePath !== undefined
            ? promptEditor.workspacePath.replace(/^ssh:\/\/([^/]+)\//u, '$1')
            : undefined,
          workspacePath: promptEditor.workspacePath,
          t,
          onClose: () => setPromptEditor(null),
          onSaved: (message) => { setPromptEditor(null); if (message) setToast({ kind: 'ok', text: message }) },
        }),

        // ---- Test-result toast
        toast !== null && jsx('div', {
          className: `sshwsp-toast ${toast.kind === 'ok' ? 'sshwsp-toast-ok' : 'sshwsp-toast-err'}`,
          role: 'status',
          onClick: () => setToast(null),
          children: toast.text,
        }),
      ]})
    }

    // =========================================================================
    // Add-workspace flow (directoryFlow slot occupant)
    // =========================================================================
    // Built-in occupants (native / browse pickers) register at the default
    // priority. The slot core renders the entry with the *lowest* priority, so
    // a negative priority shadows them while leaving both installed.
    const FLOW_PRIORITY = -100

    /**
     * Marker a local pick returns when the host can only serve the in-app
     * browse interaction: the flow must open {@link LocalDirectoryBrowser}
     * instead of treating the outcome as a path (or a cancellation).
     */
    const LOCAL_PICK_BROWSE = Symbol('sshwsp:pick-via-browse')

    /**
     * The picking capability this host's directory-picker backend serves, as
     * learned by the last attempt. 'unknown' until one native verb has been
     * tried; 'browse' then short-circuits every later attempt straight into
     * the in-app browser instead of failing one doomed call first. Lives at
     * factory scope, so an HMR reload re-probes once — that is the intended
     * behaviour when the deployment's composed backend changes.
     */
    const localPickCapability = { kind: 'unknown' }

    /**
     * The client root context of the live materialization, parked at factory
     * scope the same way `marksCtx` is: the browse-fallback dialog renders
     * from the slot tree and needs the Remote face, and the slot inject
     * contract carries the component its declared face, not arbitrary
     * context objects. An HMR reload overwrites this with the fresh apply's
     * context, matching the component instances it serves.
     */
    let flowCtx = null

    /**
     * Classify one `directoryPicker.pick()` RemoteResult into the flow's next
     * action. Dependency-free on purpose, so the smoke suite drives the exact
     * branch table the dialog runs.
     *
     * @param {{ ok: true, value: string | null } | { ok: false, error: { code?: string, message?: string } } | undefined} result
     *   the Remote call's result, or undefined when no Remote face exists.
     * @returns {{ action: 'picked' | 'browse' | 'cancel' | 'error', path?: string, message?: string }}
     *   the verdict: a usable path, the browse fallback, an operator
     *   cancellation, or a failure to surface.
     */
    function localPickVerdict (result) {
      if (result === undefined) return { action: 'browse' }
      if (result.ok === true) {
        if (typeof result.value === 'string' && result.value !== '') return { action: 'picked', path: result.value }
        return { action: 'cancel' }
      }
      if (result.error?.code === 'directory-picker/unavailable') return { action: 'browse' }
      return { action: 'error', message: result.error?.message ?? 'directory picker failed' }
    }

    /**
     * The browse verbs of this host's directory-picker, in one face.
     *
     * The Remote namespace is preferred: its RemoteResult carries the
     * structured error the uiWorkspace wrapper flattens into an Error string.
     * When a host build has no Remote namespace, the uiWorkspace service is
     * the fallback and its thrown failures are normalized into the same
     * `{ ok, error }` shape.
     *
     * @param {{ remote?: { directoryPicker?: object }, get?: (name: string) => unknown }} ctx
     *   the client root context.
     * @returns {{ list: (path?: string, signal?: AbortSignal) => Promise<object>, createDirectory: (path: string, name: string) => Promise<object> } | null}
     *   the browse face, or null when this host offers neither.
     */
    function browseFaceOf (ctx) {
      const picker = ctx?.remote?.directoryPicker
      if (picker != null) {
        return {
          list: async (path, signal) => await picker.list(path, signal),
          createDirectory: async (path, name) => await picker.createDirectory(path, name),
        }
      }
      const uiWorkspace = ctx?.get?.('uiWorkspace')
      if (uiWorkspace == null) return null
      const normalize = async (work) => {
        try {
          return { ok: true, value: await work() }
        } catch (err) {
          return { ok: false, error: { message: err instanceof Error ? err.message : String(err) } }
        }
      }
      return {
        list: (path, signal) => normalize(() => uiWorkspace.listDirectory(path, signal)),
        createDirectory: (path, name) => normalize(() => uiWorkspace.createDirectory(path, name)),
      }
    }

    /**
     * The native directory picker for the flow's "local" arm.
     *
     * Preference order: the desktop preload bridge (unchanged, first), then —
     * unless the backend is already known to be browse-only — the native
     * `directoryPicker.pick()` verb through the Remote namespace, whose
     * RemoteResult keeps the structured error the uiWorkspace wrapper loses.
     * A `directory-picker/unavailable` refusal means the deployment composed
     * the browse backend: remember that, and hand back the browse marker so
     * the flow opens the in-app browser instead of toasting the raw error.
     * Every other refusal keeps the historical behavior — the message the
     * wrapper would have shown.
     *
     * @param {object} ctx - the client root context.
     * @returns {Promise<string|null|symbol>} picked path, null when cancelled,
     *   or {@link LOCAL_PICK_BROWSE} when the flow must browse in-app.
     */
    function makeLocalPicker (ctx) {
      return async () => {
        const desktop = globalThis.__DSH_DIRECTORY_PICKER__
        if (desktop !== undefined) return await desktop.pick()
        // Already known browse-only: skip the doomed native verb entirely.
        if (localPickCapability.kind === 'browse') return LOCAL_PICK_BROWSE
        const picker = ctx?.remote?.directoryPicker
        if (picker == null) {
          // A host without the Remote namespace predates the browse backend,
          // so the uiWorkspace wrapper is the only face — keep its behavior.
          const uiWorkspace = ctx.get?.('uiWorkspace')
          if (uiWorkspace == null) throw new Error('no directory picker available on this platform')
          const picked = await uiWorkspace.pickDirectory()
          localPickCapability.kind = 'native'
          return picked
        }
        const verdict = localPickVerdict(await picker.pick())
        if (verdict.action === 'picked') {
          localPickCapability.kind = 'native'
          return verdict.path
        }
        if (verdict.action === 'cancel') {
          localPickCapability.kind = 'native'
          return null
        }
        if (verdict.action === 'browse') {
          localPickCapability.kind = 'browse'
          return LOCAL_PICK_BROWSE
        }
        throw new Error(verdict.message)
      }
    }

    // The trigger (the sidebar "+" button or the menu entry) is not handed to
    // flow occupants, so remember where the last button press landed and drop
    // the chooser next to it. Freshness-bounded: a stale press must not
    // teleport the menu after a keyboard-shortcut open.
    let lastTriggerRect = null

    function trackTriggerRects () {
      if (typeof document === 'undefined') return
      document.addEventListener('mousedown', (event) => {
        const target = event.target
        if (!(target instanceof Element)) return
        const button = target.closest('button')
        if (button === null) return
        const rect = button.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) return
        lastTriggerRect = { left: rect.left, right: rect.right, top: rect.top, at: Date.now() }
      }, true)
    }

    const FLOW_MENU_WIDTH = 300

    /** Fixed position for the chooser popover, next to the flow trigger. */
    function flowMenuPosition (anchorEl) {
      const viewportW = window.innerWidth
      const viewportH = window.innerHeight
      const trigger = lastTriggerRect !== null && Date.now() - lastTriggerRect.at < 3000 ? lastTriggerRect : null
      let base
      if (trigger !== null) {
        base = { left: trigger.right + 8, top: trigger.top }
      } else {
        const parentRect = anchorEl?.parentElement?.getBoundingClientRect?.()
        base = parentRect != null && parentRect.width > 0
          ? { left: parentRect.right + 8, top: parentRect.top + 56 }
          : { left: (viewportW - FLOW_MENU_WIDTH) / 2, top: 96 }
      }
      return {
        left: Math.min(Math.max(8, base.left), Math.max(8, viewportW - FLOW_MENU_WIDTH - 8)),
        top: Math.min(Math.max(8, base.top), Math.max(8, viewportH - 180)),
      }
    }

    function AddChooser ({ busy, picking, onLocal, onRemote, onCancel, t }) {
      const anchorRef = React.useRef(null)
      const popoverRef = React.useRef(null)
      const [pos, setPos] = React.useState(null)
      const disabled = busy || picking

      React.useLayoutEffect(() => {
        const place = () => setPos(flowMenuPosition(anchorRef.current))
        place()
        window.addEventListener('resize', place)
        return () => window.removeEventListener('resize', place)
      }, [])

      React.useEffect(() => {
        const onDown = (event) => {
          const target = event.target
          if (!(target instanceof Element)) return
          if (popoverRef.current?.contains(target) === true) return
          if (anchorRef.current?.contains(target) === true) return
          onCancel()
        }
        const onKey = (event) => {
          if (event.key === 'Escape') onCancel()
        }
        document.addEventListener('mousedown', onDown, true)
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('mousedown', onDown, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [onCancel])

      const rows = [
        {
          key: 'local',
          icon: FolderIcon,
          title: picking ? t('remote.loading') : t('add.local'),
          desc: t('add.localDesc'),
          onClick: onLocal,
        },
        {
          key: 'remote',
          icon: RemoteMarkIcon,
          title: t('add.remote'),
          desc: t('add.remoteDesc'),
          onClick: onRemote,
        },
      ]

      return jsxs(Fragment, { children: [
        jsx('span', { ref: anchorRef, style: { position: 'absolute', width: 0, height: 0, pointerEvents: 'none' } }),
        pos !== null && jsx('div', {
          ref: popoverRef,
          className: 'sshwsp-flowmenu',
          role: 'menu',
          style: { left: pos.left, top: pos.top },
          children: rows.map((row) =>
            jsxs('button', {
              key: row.key,
              type: 'button',
              role: 'menuitem',
              className: 'sshwsp-menuitem',
              disabled,
              onClick: row.onClick,
              children: [
                jsx('span', { className: 'sshwsp-menuitem-icon', children: React.createElement(row.icon, { size: 16 }) }),
                jsxs('span', { className: 'sshwsp-menuitem-text', children: [
                  jsx('span', { className: 'sshwsp-menuitem-title', children: row.title }),
                  jsx('span', { className: 'sshwsp-menuitem-desc', children: row.desc }),
                ]}),
              ],
            })
          ),
        }),
      ]})
    }

    /**
     * Remote branch: name + host + directory picker, then mount. The mount
     * route registers the workspace under the typed name *before* the owner
     * adopts the path, so adoption resolves the existing record instead of
     * creating a duplicate under a derived title.
     */
    function RemoteWorkspaceDialog ({ t, busy, onCancel, onCreated }) {
      const [hosts, setHosts] = React.useState(null)
      const [hostsError, setHostsError] = React.useState(null)
      const [alias, setAlias] = React.useState('')
      const [name, setName] = React.useState('')
      const [path, setPath] = React.useState(null)
      const [entries, setEntries] = React.useState(null)
      const [writable, setWritable] = React.useState(true)
      const [loading, setLoading] = React.useState(false)
      const [loadError, setLoadError] = React.useState(null)
      const [creating, setCreating] = React.useState(false)
      const [createError, setCreateError] = React.useState(null)
      // 「设为本主机默认目录」：创建成功后把当前目录 POST 给
      // hosts/default-path。默认不勾——它改变主机存储，不该是创建的副作用
      // 默认值；换到不可编辑的主机时由 select 的 onChange 清掉。
      const [recordDefault, setRecordDefault] = React.useState(false)
      const loadSeq = React.useRef(0)

      React.useEffect(() => {
        let cancelled = false
        fetchJson(API.hosts)
          .then((data) => {
            if (cancelled) return
            const list = data.hosts ?? []
            setHosts(list)
            if (list.length > 0) setAlias(list[0].alias)
          })
          .catch((err) => { if (!cancelled) setHostsError(err.message) })
        return () => { cancelled = true }
      }, [])

      const loadDir = React.useCallback(async (target) => {
        if (alias === '') return
        const seq = ++loadSeq.current
        if (typeof target === 'string') setPath(target)
        setLoading(true)
        setLoadError(null)
        try {
          const query = typeof target === 'string' && target !== '' ? `&path=${encodeURIComponent(target)}` : ''
          const data = await fetchJson(`${API.ls}?alias=${encodeURIComponent(alias)}${query}`)
          if (seq !== loadSeq.current) return
          // Directories only — a remote workspace must point at a directory.
          setEntries((data.entries ?? [])
            .filter((entry) => entry.type === 'directory')
            .sort((a, b) => a.name.localeCompare(b.name)))
          if (typeof data.path === 'string' && data.path !== '') setPath(data.path)
          setWritable(data.writable !== false)
        } catch (err) {
          if (seq === loadSeq.current) setLoadError(err.message)
        } finally {
          if (seq === loadSeq.current) setLoading(false)
        }
      }, [alias])

      // The selected host's defaultPath (undefined when unset). Derived from
      // the loaded hosts list, so it also applies when the list arrives late
      // and the first host becomes selected. The effect below keys on the
      // VALUE, so a hosts refresh that yields the same string never re-runs it
      // — an unrelated refresh must not reset the user's browsing position.
      const selectedHost = hosts?.find((host) => host.alias === alias)
      const defaultPath = selectedHost?.defaultPath
      // Only store entries take a defaultPath: an ~/.ssh/config fallback host
      // is read-only, so the checkbox disables with an explaining title and
      // the create flow skips the recording step entirely.
      const hostEditable = selectedHost?.source !== 'ssh-config'

      // Initial directory per (host, its defaultPath): the host's default
      // directory when set, otherwise the SSH login directory (null target).
      // Switching hosts re-runs it with the new host's default directory; a
      // failed ls leaves the path shown so the user can navigate away.
      React.useEffect(() => { loadDir(typeof defaultPath === 'string' && defaultPath !== '' ? defaultPath : null) }, [loadDir, defaultPath])

      const handleEntry = (entry) => {
        if (path == null) return
        loadDir(path === '/' ? `/${entry.name}` : `${path}/${entry.name}`)
      }

      const handleUp = () => {
        if (path == null || path === '/') return
        const idx = path.lastIndexOf('/')
        loadDir(idx <= 0 ? '/' : path.slice(0, idx))
      }

      const handleCreate = async () => {
        setCreating(true)
        setCreateError(null)
        try {
          const result = await fetchJson(API.mount, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ alias, remotePath: path, title: name.trim(), register: true }),
          })
          if (!result.ok) throw new Error(result.error ?? 'unknown')
          // 挂载成功是主交付，默认目录记录只是附属动作：记录一步失败
          // （主机被并发删除、网络抖动等）不该让一个已经可用的工作区被
          // 当作失败回滚，也不该弹错打断接纳流程——catch 后 console.warn
          // 留痕即可，随后照常交付。200 + ok:false 也是失败（对齐
          // hostSave 风格），同样只留痕。
          if (recordDefault && hostEditable && typeof path === 'string') {
            try {
              const recording = await fetchJson(API.hostDefaultPath, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ alias, path }),
              })
              if (recording?.ok === false) {
                console.warn('[dsh-ssh-workspace] recording the default directory failed (workspace stays usable):', recording.error)
              }
            } catch (err) {
              console.warn('[dsh-ssh-workspace] recording the default directory failed (workspace stays usable):', err)
            }
          }
          // Fold the fresh registration into the mark source so the row DSH is
          // about to render already wears the remote mark.
          refreshRemoteWorkspaceMarks()
          // Stays disabled while the owner adopts the workspace.
          onCreated(result.workspacePath)
        } catch (err) {
          setCreateError(t('remote.createFail', { msg: err.message }))
          setCreating(false)
        }
      }

      const createDisabled = creating || busy || alias === '' || path == null || loading || loadError != null || !writable

      // The create POST must not be abandoned mid-flight; `busy` belongs to the
      // owner and covers the workspace it is adopting.
      const dismissBackdrop = () => { if (!creating && !busy) onCancel() }

      return jsxs('div', { className: 'sshwsp-backdrop', ...backdropDismiss(dismissBackdrop), children: [
        jsxs('div', { className: 'sshwsp-dialog', onClick: (e) => e.stopPropagation(), children: [
          jsxs('div', { className: 'sshwsp-dlg-head', children: [
            jsx('h2', { children: t('remote.title') }),
            jsx('button', {
              className: 'sshwsp-icon-btn',
              'aria-label': t('dialog.close'),
              onClick: onCancel,
              children: React.createElement(CloseIcon, { size: 14 }),
            }),
          ]}),
          jsxs('div', { className: 'sshwsp-dialog-body', children: [
            jsxs('div', { className: 'sshwsp-form', children: [
              jsxs('div', { className: 'sshwsp-field', children: [
                jsx('span', { className: 'sshwsp-field-label', children: t('remote.name') }),
                jsx('input', {
                  className: 'sshwsp-input',
                  value: name,
                  placeholder: t('remote.namePlaceholder'),
                  disabled: creating,
                  onChange: (e) => setName(e.target.value),
                }),
              ]}),
              jsxs('div', { className: 'sshwsp-field', children: [
                jsx('span', { className: 'sshwsp-field-label', children: t('remote.host') }),
                jsxs('div', { style: { position: 'relative', display: 'flex', alignItems: 'center' }, children: [
                  jsx('span', {
                    style: { position: 'absolute', left: 9, display: 'inline-flex', color: 'var(--dsw-alias-label-secondary, #999)', pointerEvents: 'none' },
                    children: React.createElement(GlobeIcon, { size: 14 }),
                  }),
                  jsx('select', {
                    className: 'sshwsp-input sshwsp-select',
                    style: { paddingLeft: 30 },
                    value: alias,
                    disabled: hosts == null || creating,
                    onChange: (e) => {
                      setAlias(e.target.value)
                      // 换到不可编辑（ssh-config 回退）的主机时勾选无处
                      // 落地，直接清掉，避免留下「勾了却不生效」的状态。
                      if ((hosts ?? []).find((host) => host.alias === e.target.value)?.source === 'ssh-config') setRecordDefault(false)
                    },
                    children: (hosts ?? []).map((host) => jsx('option', { key: host.alias, value: host.alias, children: host.alias })),
                  }),
                ]}),
              ]}),
              jsxs('div', { className: 'sshwsp-field', children: [
                jsx('span', { className: 'sshwsp-field-label', children: t('remote.dir') }),
                jsxs('div', { className: 'sshwsp-pathbar', children: [
                  jsx('button', {
                    className: 'sshwsp-icon-btn',
                    'aria-label': t('remote.up'),
                    disabled: path == null || path === '/' || creating,
                    onClick: handleUp,
                    children: React.createElement(ArrowLeftIcon, { size: 14 }),
                  }),
                  // Breadcrumbs replace the dead path text: earlier segments
                  // jump straight to their directory, the current one stays text.
                  path == null
                    ? jsx('span', { className: 'sshwsp-pathbar-path', children: '…' })
                    : jsx(PathBreadcrumb, { path, disabled: creating, label: t('path.crumbs'), onNavigate: loadDir }),
                ]}),
              ]}),
              jsxs('label', {
                className: 'sshwsp-field sshwsp-check',
                // ssh-config 回退主机整行只读：勾选无处落地，禁用并说明原因。
                title: hostEditable ? undefined : t('remote.setAsDefaultHint'),
                children: [
                  jsx('span', { className: 'sshwsp-check-text', children:
                    jsx('span', { className: 'sshwsp-field-label', children: t('remote.setAsDefault') })
                  }),
                  jsx('input', {
                    type: 'checkbox',
                    checked: recordDefault,
                    disabled: creating || !hostEditable,
                    onChange: (e) => setRecordDefault(e.target.checked),
                  }),
                ],
              }),
            ]}),
            path != null && !loading && loadError == null && !writable && jsx('div', { className: 'sshwsp-warn', children: t('remote.notWritable') }),
            createError != null && jsx('div', { className: 'sshwsp-warn', children: createError }),
            jsx('div', { className: 'sshwsp-dirlist', children:
              hostsError != null
                ? jsx('div', { className: 'sshwsp-empty', children: t('remote.hostsFail', { msg: hostsError }) })
                : hosts != null && hosts.length === 0
                  ? jsx('div', { className: 'sshwsp-empty', children: t('panel.empty') })
                  : loading
                    ? jsx('div', { className: 'sshwsp-empty', children: t('remote.loading') })
                    : loadError != null
                      ? jsx('div', { className: 'sshwsp-empty', children: t('remote.loadError', { msg: loadError }) })
                      : (entries?.length ?? 0) === 0
                        ? jsx('div', { className: 'sshwsp-empty', children: t('remote.empty') })
                        : entries.map((entry) =>
                            jsxs('button', {
                              key: entry.name,
                              type: 'button',
                              className: 'sshwsp-entry',
                              disabled: creating,
                              onClick: () => handleEntry(entry),
                              children: [
                                jsx('span', { className: 'sshwsp-entry-icon', children: React.createElement(FolderIcon) }),
                                jsx('span', { className: 'sshwsp-entry-name', children: entry.name }),
                              ],
                            })
                          )
            }),
          ]}),
          jsxs('div', { className: 'sshwsp-dialog-footer', children: [
            jsx('button', { className: 'sshwsp-btn', disabled: creating, onClick: onCancel, children: t('remote.cancel') }),
            jsx('button', {
              className: 'sshwsp-btn sshwsp-btn-primary',
              disabled: createDisabled,
              onClick: handleCreate,
              children: creating ? t('remote.creating') : t('remote.create'),
            }),
          ]}),
        ]}),
      ]})
    }

    // =========================================================================
    // Local directory browser (browse-capability fallback)
    // =========================================================================
    /**
     * In-app browser for LOCAL directories, shown when the host's composed
     * directory-picker serves the `browse` capability instead of the OS
     * chooser. Drives the browse verbs (`list`, `createDirectory`) through
     * {@link browseFaceOf}, styled after {@link RemoteWorkspaceDialog}.
     *
     * Failure display stays inside the dialog (its own warn rows), mirroring
     * the upstream browse dialog's contract: the flow owner's `onError` arm
     * is reserved for the picker, not for a listing that failed here.
     *
     * @param {object} props - dialog props.
     * @param {object} props.ctx - the client root context (for the browse face).
     * @param {(key: string, params?: object) => string} props.t - translator.
     * @param {boolean} props.busy - the owner is adopting a workspace.
     * @param {() => void} props.onCancel - close without picking.
     * @param {(path: string) => void} props.onPicked - the operator confirmed a directory.
     */
    function LocalDirectoryBrowser ({ ctx, t, busy, onCancel, onPicked }) {
      const face = React.useMemo(() => browseFaceOf(ctx ?? flowCtx), [ctx])
      const [path, setPath] = React.useState(null)
      const [crumbs, setCrumbs] = React.useState([])
      const [entries, setEntries] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [loadError, setLoadError] = React.useState(null)
      // The new-folder affordance: a name row revealed in the body, one
      // creation at a time.
      const [folderOpen, setFolderOpen] = React.useState(false)
      const [folderName, setFolderName] = React.useState('')
      const [creating, setCreating] = React.useState(false)
      const [createError, setCreateError] = React.useState(null)
      const [picking, setPicking] = React.useState(false)
      const loadSeq = React.useRef(0)

      const loadDir = React.useCallback(async (target) => {
        if (face == null) {
          setLoading(false)
          setLoadError(t('add.localBrowse.loadError', { msg: 'no directory picker available on this platform' }))
          return
        }
        const seq = ++loadSeq.current
        if (typeof target === 'string' && target !== '') setPath(target)
        setLoading(true)
        setLoadError(null)
        try {
          // Absent path = the host account's home directory, the documented
          // root of the browse backend.
          const result = await face.list(typeof target === 'string' && target !== '' ? target : undefined)
          if (seq !== loadSeq.current) return
          if (result.ok !== true) {
            setLoadError(result.error?.message ?? 'unknown error')
            return
          }
          const listing = result.value
          setEntries((listing?.entries ?? [])
            .filter((entry) => typeof entry?.path === 'string' && entry.path !== '')
            .sort((a, b) => a.name.localeCompare(b.name)))
          setCrumbs(Array.isArray(listing?.crumbs) ? listing.crumbs : [])
          if (typeof listing?.path === 'string' && listing.path !== '') setPath(listing.path)
        } catch (err) {
          if (seq === loadSeq.current) setLoadError(err instanceof Error ? err.message : String(err))
        } finally {
          if (seq === loadSeq.current) setLoading(false)
        }
      }, [face, t])

      React.useEffect(() => { loadDir(null) }, [loadDir])

      const handleEntry = (entry) => {
        if (loading || creating) return
        loadDir(entry.path)
      }

      // "Up" follows the ancestry the backend reported instead of slicing the
      // path string: a local host may be Windows, where '/'-slicing corrupts
      // `C:\…` spellings. The parent crumb is the second-to-last; at the root
      // (or home level without ancestry) there is nowhere to go.
      const handleUp = () => {
        const parent = crumbs.length >= 2 ? crumbs[crumbs.length - 2]?.path : crumbs[0]?.path
        if (typeof parent === 'string' && parent !== '' && parent !== path) loadDir(parent)
      }

      const handleCreate = async () => {
        const name = folderName.trim()
        if (name === '' || path == null || face == null || creating) return
        setCreating(true)
        setCreateError(null)
        try {
          const result = await face.createDirectory(path, name)
          if (result.ok !== true) throw new Error(result.error?.message ?? 'unknown error')
          setFolderOpen(false)
          setFolderName('')
          await loadDir(typeof result.value === 'string' && result.value !== '' ? result.value : path)
        } catch (err) {
          setCreateError(t('add.localBrowse.createFail', { msg: err instanceof Error ? err.message : String(err) }))
        } finally {
          setCreating(false)
        }
      }

      const handlePick = async () => {
        if (path == null || picking || busy) return
        setPicking(true)
        try {
          onPicked(path)
        } finally {
          setPicking(false)
        }
      }

      const pickDisabled = busy || picking || path == null || loading || loadError != null
      const dismissBackdrop = () => { if (!creating && !picking && !busy) onCancel() }

      return jsxs('div', { className: 'sshwsp-backdrop', ...backdropDismiss(dismissBackdrop), children: [
        jsxs('div', { className: 'sshwsp-dialog', onClick: (e) => e.stopPropagation(), children: [
          jsxs('div', { className: 'sshwsp-dlg-head', children: [
            jsx('h2', { children: t('add.localBrowse.title') }),
            jsx('button', {
              className: 'sshwsp-icon-btn',
              'aria-label': t('dialog.close'),
              onClick: onCancel,
              children: React.createElement(CloseIcon, { size: 14 }),
            }),
          ]}),
          jsxs('div', { className: 'sshwsp-dialog-body', children: [
            jsxs('div', { className: 'sshwsp-pathbar', children: [
              jsx('button', {
                className: 'sshwsp-icon-btn',
                'aria-label': t('add.localBrowse.up'),
                disabled: path == null || crumbs.length === 0 || loading || creating,
                onClick: handleUp,
                children: React.createElement(ArrowLeftIcon, { size: 14 }),
              }),
              // Breadcrumbs replace the dead path text; disabled while a load
              // or a folder creation is in flight, matching the up button.
              path == null
                ? jsx('span', { className: 'sshwsp-pathbar-path', children: '…' })
                : jsx(PathBreadcrumb, { path, disabled: loading || creating, label: t('path.crumbs'), onNavigate: loadDir }),
              jsx('button', {
                className: 'sshwsp-icon-btn',
                'aria-label': t('add.localBrowse.newFolder'),
                title: t('add.localBrowse.newFolder'),
                disabled: path == null || loading,
                onClick: () => { setFolderOpen((open) => !open); setCreateError(null) },
                children: React.createElement(FolderIcon),
              }),
            ]}),
            folderOpen && jsxs('div', { className: 'sshwsp-field', children: [
              jsx('span', { className: 'sshwsp-field-label', children: t('add.localBrowse.folderName') }),
              jsx('input', {
                className: 'sshwsp-input',
                value: folderName,
                disabled: creating,
                autoFocus: true,
                onChange: (e) => setFolderName(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleCreate(); return }
                  if (e.key === 'Escape') { e.preventDefault(); setFolderOpen(false); setCreateError(null) }
                },
              }),
              jsx('button', {
                className: 'sshwsp-btn',
                disabled: creating || folderName.trim() === '',
                onClick: handleCreate,
                children: creating ? t('add.localBrowse.creating') : t('add.localBrowse.create'),
              }),
            ]}),
            createError != null && jsx('div', { className: 'sshwsp-warn', children: createError }),
            jsx('div', { className: 'sshwsp-dirlist', children:
              loading
                ? jsx('div', { className: 'sshwsp-empty', children: t('add.localBrowse.loading') })
                : loadError != null
                  ? jsx('div', { className: 'sshwsp-empty', children: t('add.localBrowse.loadError', { msg: loadError }) })
                  : (entries?.length ?? 0) === 0
                    ? jsx('div', { className: 'sshwsp-empty', children: t('add.localBrowse.empty') })
                    : entries.map((entry) =>
                        jsxs('button', {
                          key: entry.path,
                          type: 'button',
                          className: 'sshwsp-entry',
                          disabled: creating,
                          onClick: () => handleEntry(entry),
                          children: [
                            jsx('span', { className: 'sshwsp-entry-icon', children: React.createElement(FolderIcon) }),
                            jsx('span', { className: 'sshwsp-entry-name', children: entry.name }),
                          ],
                        })
                      )
            }),
          ]}),
          jsxs('div', { className: 'sshwsp-dialog-footer', children: [
            jsx('button', { className: 'sshwsp-btn', disabled: creating || picking, onClick: onCancel, children: t('remote.cancel') }),
            jsx('button', {
              className: 'sshwsp-btn sshwsp-btn-primary',
              disabled: pickDisabled,
              onClick: handlePick,
              children: picking ? t('add.localBrowse.picking') : t('add.localBrowse.pick'),
            }),
          ]}),
        ]}),
      ]})
    }

    /**
     * Occupant of `sidebar.workspaces.directoryFlow` and
     * `conversation.hero.workspace.directoryFlow`. Local defers to the native
     * picker — falling back to the in-app browser when the host serves the
     * browse capability; remote opens {@link RemoteWorkspaceDialog} and mounts
     * the chosen directory before handing the canonical `ssh://` path to the
     * owner.
     */
    function AddWorkspaceFlow ({ open, busy, onPicked, onCancel, onError, pick, t }) {
      const [mode, setMode] = React.useState('choose')
      const [picking, setPicking] = React.useState(false)

      React.useEffect(() => {
        if (!open) {
          setMode('choose')
          setPicking(false)
        }
      }, [open])

      const handleLocal = async () => {
        setPicking(true)
        try {
          const picked = await pick()
          // The host's backend is browse-only: switch into the in-app browser
          // instead of toasting the picker's refusal. The capability is now
          // remembered, so later opens land here on the first press.
          if (picked === LOCAL_PICK_BROWSE) {
            setMode('localBrowse')
            return
          }
          if (typeof picked === 'string' && picked !== '') onPicked(picked)
          else onCancel()
        } catch (err) {
          onError(err instanceof Error ? err.message : String(err))
        } finally {
          setPicking(false)
        }
      }

      if (!open) return null
      if (mode === 'localBrowse') {
        return React.createElement(LocalDirectoryBrowser, {
          t,
          busy,
          onCancel,
          onPicked: (pickedPath) => onPicked(pickedPath),
        })
      }
      if (mode === 'remote') {
        return React.createElement(RemoteWorkspaceDialog, {
          t,
          busy,
          onCancel,
          onCreated: (workspacePath) => onPicked(workspacePath),
        })
      }
      return React.createElement(AddChooser, {
        t,
        busy,
        picking,
        onLocal: handleLocal,
        onRemote: () => setMode('remote'),
        onCancel,
      })
    }

    // =========================================================================
    // Panel icon (sidebar row glyph)
    // =========================================================================
    function RemoteWorkspaceIcon ({ size, active }) {
      return React.createElement(ServerIcon, { size, 'data-dsh-panel-entry': 'ssh-workspace' })
    }

    // =========================================================================
    // Panel page wrapper
    // =========================================================================
    function RemoteWorkspacePage ({ translate }) {
      return jsx('div', { 'data-dsh-plugin': 'ssh-workspace', style: { height: '100%' }, children:
        jsx(RemoteWorkspacePanel, { t: translate }),
      })
    }

    // =========================================================================
    // Remote-workspace marks (DOM decoration)
    // =========================================================================
    // DSH draws every workspace with its own folder glyph, and its slot ledger
    // has no seat for row icons, so SSH-backed workspaces get that glyph
    // swapped for the remote mark after the fact. The decoration stays
    // React-safe: React-owned nodes are never removed or re-parented — the
    // folder glyph is only hidden through an inline style React never rewrites
    // (no render sets `style` on those nodes), our own svg is inserted beside
    // it, and a MutationObserver re-applies the swap whenever React replaces
    // the nodes underneath.

    const MARK_ATTR = 'data-sshwsp-mark'
    const MARK_SELECTOR = `svg[${MARK_ATTR}]`
    const MARK_GLYPH_SELECTOR = `svg:not([${MARK_ATTR}])`
    // Identity sets rebuilt from the live workspaces store, or from /status
    // when that service is out of reach. Workspace rows match by id; menu
    // rows and the hero chip only carry the displayed title. The os maps ride
    // the same identities: an ssh:// path parses to its alias, and the alias's
    // pinned OS (from /hosts) picks the mark glyph — absent stays generic.
    const remoteMarks = { ids: new Set(), titles: new Set(), disabledIds: new Set(), disabledTitles: new Set(), disabledSessionIds: new Set(), osIds: new Map(), osTitles: new Map() }
    let marksCtx = null
    /** Pinned OS per host alias, as last reported by /hosts. */
    const hostOsByAlias = new Map()
    /**
     * Detached workspace paths, as last reported by /status.
     *
     * Kept separately from the identity sets because `readLiveWorkspaces()`
     * re-collects identities from DSH's own store, which knows nothing about
     * this plugin's detached list; without this the grey marks would vanish on
     * the next mutation pass.
     */
    const knownDisabledPaths = new Set()
    /**
     * The `workspaces` array of the last `/status` reply.
     *
     * Kept for the floating view: it needs each workspace's `sessionIds` to
     * decide which session rows to hide, and `/status` is the one source that
     * exists even when DSH's live workspaces service is not reachable.
     */
    let lastStatusWorkspaces = []

    /** Reset the identity sets from workspace-like records ({workspaceId|id, path, title}). */
    function collectRemoteWorkspaces (items, disabledPaths) {
      const disabled = new Set(Array.isArray(disabledPaths) ? disabledPaths : [])
      knownDisabledPaths.clear()
      for (const path of disabled) knownDisabledPaths.add(path)
      const ids = new Set()
      const titles = new Set()
      const disabledIds = new Set()
      const disabledTitles = new Set()
      const disabledSessionIds = new Set()
      const osIds = new Map()
      const osTitles = new Map()
      for (const item of Array.isArray(items) ? items : []) {
        if (typeof item?.path !== 'string' || !item.path.startsWith('ssh://')) continue
        const id = item.workspaceId ?? item.id
        if (id !== undefined && id !== null && String(id) !== '') ids.add(String(id))
        const title = typeof item.title === 'string' ? item.title.trim() : ''
        if (title !== '') titles.add(title)
        // The hero chip can fall back to the path basename while a fresh
        // session is still settling, so that spelling counts as identity too.
        const trimmedPath = item.path.replace(/[/\\]+$/, '')
        const segment = trimmedPath.slice(Math.max(trimmedPath.lastIndexOf('/'), trimmedPath.lastIndexOf('\\')) + 1)
        if (segment !== '') titles.add(segment)
        // The pinned OS travels with every identity spelling: rows match by
        // id or by title, so the glyph lookup must answer for both.
        const os = hostOsByAlias.get(aliasOfWorkspacePath(item.path))
        if (os !== undefined) {
          if (id !== undefined && id !== null && String(id) !== '') osIds.set(String(id), os)
          if (title !== '') osTitles.set(title, os)
          if (segment !== '') osTitles.set(segment, os)
        }
        // Detached identity is collected alongside, not derived later: the
        // sidebar row carries only the id or the title, and which one is
        // available differs per surface.
        if (!disabled.has(item.path)) continue
        if (id !== undefined && id !== null && String(id) !== '') disabledIds.add(String(id))
        if (title !== '') disabledTitles.add(title)
        if (segment !== '') disabledTitles.add(segment)
        // Session rows are keyed `session:<id>` and carry no workspace at all,
        // so membership has to be resolved here, while the workspace is still
        // in hand. Both sources can supply it: /status forwards the registry's
        // list, and DSH's own store exposes the same list per workspace view.
        for (const sessionId of Array.isArray(item.sessionIds) ? item.sessionIds : []) {
          if (sessionId !== undefined && sessionId !== null && String(sessionId) !== '') disabledSessionIds.add(String(sessionId))
        }
      }
      remoteMarks.ids = ids
      remoteMarks.titles = titles
      remoteMarks.disabledIds = disabledIds
      remoteMarks.disabledTitles = disabledTitles
      remoteMarks.disabledSessionIds = disabledSessionIds
      remoteMarks.osIds = osIds
      remoteMarks.osTitles = osTitles
    }

    /** The host alias of an `ssh://alias/…` workspace path (undefined otherwise). */
    function aliasOfWorkspacePath (path) {
      const match = /^ssh:\/\/([^/@\s]+)/u.exec(String(path ?? ''))
      return match === null ? undefined : match[1]
    }

    /** Update the mark source from a /status reply (panel fetch, flow completion). */
    function syncRemoteWorkspaceMarks (entries, disabledPaths) {
      lastStatusWorkspaces = Array.isArray(entries) ? entries : []
      collectRemoteWorkspaces(entries, disabledPaths)
      scheduleRemoteMarks()
      // Both decorations ride the same data; a fresh /status also has to reach
      // the floating pass (a workspace registered here may be the floating one).
      scheduleFloatingDisplay()
    }

    /** Fetch /status once and refresh the fallback mark source from it. */
    async function refreshRemoteWorkspaceMarks () {
      try {
        const data = await fetchJson(API.status)
        syncRemoteWorkspaceMarks(data.workspaces, data.disabled)
      } catch { /* status unavailable — keep the last known set */ }
    }

    /** Absorb a /hosts reply into the alias → pinned-OS map, then repaint. */
    function syncHostOsMarks (rows) {
      hostOsByAlias.clear()
      for (const row of Array.isArray(rows) ? rows : []) {
        // Only a pinned OS reaches the map: an unset field (auto) keeps the
        // generic mark, exactly as the host card spells it. The three-value
        // whitelist mirrors the store's normalization — a value that leaked
        // past it must not invent a fourth glyph.
        if (typeof row?.alias === 'string' && row.alias !== '' && (row.os === 'win' || row.os === 'mac' || row.os === 'linux')) {
          hostOsByAlias.set(row.alias, row.os)
        }
      }
      scheduleRemoteMarks()
    }

    /** Fetch /hosts once so non-panel surfaces get per-OS marks too. */
    async function refreshHostOsMarks () {
      try {
        syncHostOsMarks((await fetchJson(API.hosts)).hosts)
      } catch { /* hosts unavailable — marks stay generic */ }
    }

    /**
     * The remote-mark svg for one glyph: same box, stroke, and class.
     *
     * A pinned OS (`win` / `mac` / `linux`) picks its glyph from the shared
     * shape table; anything else draws the generic chevrons. The chosen OS
     * rides a `data-sshwsp-os` attribute so a later pass can replace the node
     * in place when the pin changes.
     */
    function createRemoteMarkNode (glyph, os) {
      const NS = 'http://www.w3.org/2000/svg'
      const spec = os !== undefined && os !== null && os !== '' ? OS_MARK_SHAPES[os] : undefined
      const shapes = spec?.shapes ?? GENERIC_MARK_SHAPES.shapes
      const mark = document.createElementNS(NS, 'svg')
      mark.setAttribute('viewBox', spec?.viewBox ?? GENERIC_MARK_SHAPES.viewBox)
      mark.setAttribute('width', glyph.getAttribute('width') ?? '16')
      mark.setAttribute('height', glyph.getAttribute('height') ?? '16')
      mark.setAttribute('fill', 'none')
      mark.setAttribute('stroke', 'currentColor')
      mark.setAttribute('stroke-width', String(spec?.strokeWidth ?? GENERIC_MARK_SHAPES.strokeWidth))
      mark.setAttribute('stroke-linecap', 'round')
      mark.setAttribute('stroke-linejoin', 'round')
      mark.setAttribute('aria-hidden', 'true')
      const glyphClass = glyph.getAttribute('class')
      if (glyphClass !== null) mark.setAttribute('class', glyphClass)
      mark.setAttribute(MARK_ATTR, '1')
      mark.setAttribute('data-sshwsp-os', os ?? '')
      for (const shape of shapes) {
        const node = document.createElementNS(NS, shape.tag)
        if (shape.tag === 'rect') {
          node.setAttribute('x', String(shape.x))
          node.setAttribute('y', String(shape.y))
          node.setAttribute('width', String(shape.width))
          node.setAttribute('height', String(shape.height))
          node.setAttribute('rx', String(shape.rx))
        } else {
          node.setAttribute('d', shape.d)
        }
        mark.appendChild(node)
      }
      return mark
    }

    /** Swap one host's folder glyph for the mark (idempotent, os-aware). */
    function applyRemoteMark (host, glyph, os) {
      glyph.style.display = 'none'
      const existing = host.querySelector(MARK_SELECTOR)
      if (existing === null) {
        glyph.after(createRemoteMarkNode(glyph, os))
        return
      }
      // A changed pin must not leave the previous glyph behind: replace the
      // node in place rather than comparing path-by-path.
      const want = os ?? ''
      if ((existing.getAttribute('data-sshwsp-os') ?? '') !== want) {
        existing.remove()
        glyph.after(createRemoteMarkNode(glyph, os))
        return
      }
      if (existing.previousElementSibling !== glyph) glyph.after(existing)
    }

    /** Undo the swap inside one host (the workspace stopped being remote). */
    function clearRemoteMark (host) {
      for (const mark of host.querySelectorAll(MARK_SELECTOR)) mark.remove()
      const glyph = host.querySelector(MARK_GLYPH_SELECTOR)
      if (glyph !== null && glyph.style.display === 'none') glyph.style.display = ''
    }

    /** Decide one host: swap when matched (with the row's OS), restore when gone. */
    function markHost (host, glyph, matched, os) {
      if (glyph === null) return
      if (matched) applyRemoteMark(host, glyph, os)
      else if (host.querySelector(MARK_SELECTOR) !== null) clearRemoteMark(host)
    }

    /** Re-read the live workspaces store when reachable; /status stands otherwise. */
    function readLiveWorkspaces () {
      try {
        const items = marksCtx?.get?.('workspaces')?.list?.getSnapshot?.()?.items
        // The live store knows the registration but never the detached list —
        // that is this plugin's own state. Pass the last known list through so
        // a re-read cannot erase which rows are greyed.
        if (Array.isArray(items)) collectRemoteWorkspaces(items, currentDisabledPaths())
      } catch { /* service unavailable — the last known set stands */ }
    }

    /** The detached paths as last reported by /status. */
    function currentDisabledPaths () {
      return [...knownDisabledPaths]
    }

    /**
     * Make one element refuse interaction itself, or restore it.
     *
     * Used for session rows, where the row — not a button — is the control:
     * DSH opens the session from the row's own click and its `treeitem` role
     * makes it focusable, so disabling only the buttons inside would leave the
     * keyboard path to the session wide open. The exact prior attribute values
     * are remembered per element, including "was absent": DSH sets its own
     * `tabindex` on these rows, and deleting it on restore would be a silent
     * change to a row we only meant to pass through.
     *
     * @param {Element} element - the row.
     * @param {boolean} inert - true to refuse interaction.
     * @returns {void}
     */
    function setElementInert (element, inert) {
      if (inert) {
        if (element.hasAttribute('data-sshwsp-selfinert')) return
        const prior = {}
        for (const name of ['inert', 'tabindex', 'aria-disabled']) {
          prior[name] = element.hasAttribute(name) ? element.getAttribute(name) : null
        }
        element.setAttribute('data-sshwsp-selfinert', '1')
        element.setAttribute('inert', '')
        element.setAttribute('tabindex', '-1')
        element.setAttribute('aria-disabled', 'true')
        element.dataset.sshwspSelfInertPrior = JSON.stringify(prior)
        return
      }
      if (!element.hasAttribute('data-sshwsp-selfinert')) return
      let prior = {}
      try { prior = JSON.parse(element.dataset.sshwspSelfInertPrior ?? '{}') } catch { /* damaged: fall through to absent */ }
      for (const name of ['inert', 'tabindex', 'aria-disabled']) {
        const was = prior[name] ?? null
        if (was === null) element.removeAttribute(name)
        else element.setAttribute(name, was)
      }
      element.removeAttribute('data-sshwsp-selfinert')
      delete element.dataset.sshwspSelfInertPrior
    }

    /**
     * Make a workspace row's action buttons refuse interaction, or restore them.
     *
     * Why not intercept clicks: those buttons are DSH's own, and replacing its
     * handlers means depending on markup we do not own — the next redesign
     * breaks it silently. Why not CSS alone: `pointer-events: none` stops the
     * mouse but NOT the keyboard, so a row reached with Tab still fires its
     * actions on Enter. `inert` covers both.
     *
     * Every attribute this adds is remembered per element and put back exactly,
     * including "was absent". Blindly calling removeAttribute on restore would
     * delete a `tabindex` or `aria-disabled` DSH had set itself, which is a
     * silent behaviour change on a row we never meant to touch.
     *
     * The workspace header itself is left interactive: expanding the group is
     * how the user sees the sessions `detach` deliberately keeps. Its SESSION
     * rows are a different case and get setElementInert — see the marks pass.
     *
     * @param {Element} row - the sidebar row.
     * @param {boolean} inert - true to disable its actions.
     * @returns {void}
     */
    function setRowActionsInert (row, inert) {
      // A nested menu's own rows live in a portal outside this row, so this
      // never reaches into DSH's popup — only the row's own triggers.
      for (const control of row.querySelectorAll('button, [role="button"]')) {
        if (inert) {
          if (control.hasAttribute('data-sshwsp-inert')) continue
          const prior = {}
          for (const name of ['inert', 'tabindex', 'aria-disabled']) {
            prior[name] = control.hasAttribute(name) ? control.getAttribute(name) : null
          }
          control.setAttribute('data-sshwsp-inert', '1')
          control.setAttribute('inert', '')
          control.setAttribute('tabindex', '-1')
          control.setAttribute('aria-disabled', 'true')
          control.dataset.sshwspInertPrior = JSON.stringify(prior)
        } else if (control.hasAttribute('data-sshwsp-inert')) {
          let prior = {}
          try { prior = JSON.parse(control.dataset.sshwspInertPrior ?? '{}') } catch { /* damaged: fall through to absent */ }
          for (const name of ['inert', 'tabindex', 'aria-disabled']) {
            const was = prior[name] ?? null
            if (was === null) control.removeAttribute(name)
            else control.setAttribute(name, was)
          }
          control.removeAttribute('data-sshwsp-inert')
          delete control.dataset.sshwspInertPrior
        }
      }
    }

    /**
     * Display-only spelling of a remote workspace path: insert the alias `@`
     * separator (`ssh://alias/path` → `ssh://alias@/path`) so the string reads
     * as an SSH address. Returns null when the text is not a remote path or
     * already carries the separator. Only the rendered text changes — copy
     * actions and every functional consumer keep the real spelling.
     */
    function displayRemotePath (raw) {
      const match = /^(ssh:\/\/[^/@\s]+)(\/.*)$/.exec(raw)
      if (match === null) return null
      return `${match[1]}@${match[2]}`
    }

    /** Walk every place DSH draws a workspace folder glyph and reconcile it. */
    function passRemoteMarks () {
      if (typeof document === 'undefined') return
      readLiveWorkspaces()

      // Sidebar workspace rows, keyed `workspace:<workspaceId>`; the row text
      // (the group label) doubles as identity when the store's ids differ.
      for (const row of document.querySelectorAll('[data-row-key^="workspace:"]')) {
        const host = row.firstElementChild
        if (host === null) continue
        const id = (row.getAttribute('data-row-key') ?? '').slice('workspace:'.length)
        const title = (row.textContent ?? '').trim()
        // Which glyph to draw: the id's OS first (rows are keyed), the title's
        // as fallback; both undefined → the generic chevrons.
        const os = remoteMarks.osIds.get(id) ?? (title !== '' ? remoteMarks.osTitles.get(title) : undefined)
        markHost(host, host.querySelector(MARK_GLYPH_SELECTOR), remoteMarks.ids.has(id) || (title !== '' && remoteMarks.titles.has(title)), os)
        // A detached workspace's row is inert, not merely grey: its actions
        // must not fire. See setRowActionsInert for why this is `inert` on the
        // buttons rather than a click interceptor on the row.
        const detached = remoteMarks.disabledIds.has(id) || (title !== '' && remoteMarks.disabledTitles.has(title))
        if (detached) row.setAttribute('data-sshwsp-disabled', '1')
        else if (row.hasAttribute('data-sshwsp-disabled')) row.removeAttribute('data-sshwsp-disabled')
        setRowActionsInert(row, detached)
      }

      // Session rows inside those groups, keyed `session:<sessionId>`. A
      // detached workspace's sessions are archived, but "archived" is only a
      // visibility filter — the row is still a live session that resumes work
      // against a workspace whose whole I/O fence is shut. Greying the group
      // header while leaving every session under it fully usable says the
      // opposite of what the workspace state means.
      for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
        const id = (row.getAttribute('data-row-key') ?? '').slice('session:'.length)
        const detached = id !== '' && remoteMarks.disabledSessionIds.has(id)
        if (detached) row.setAttribute('data-sshwsp-disabled', '1')
        else if (row.hasAttribute('data-sshwsp-disabled')) row.removeAttribute('data-sshwsp-disabled')
        setRowActionsInert(row, detached)
        setElementInert(row, detached)
      }

      // Workspace picker menu rows: icon cell + label cell, identity by label.
      for (const button of document.querySelectorAll('[role="menu"] button[role="menuitem"]')) {
        if (button.closest('.sshwsp-flowmenu') !== null) continue
        const host = button.firstElementChild
        if (host === null) continue
        const glyph = host.querySelector(MARK_GLYPH_SELECTOR)
        if (glyph === null) continue
        const label = (host.nextElementSibling?.textContent ?? '').trim()
        markHost(host, glyph, label !== '' && remoteMarks.titles.has(label), remoteMarks.osTitles.get(label))
      }

      // Hero workspace chip: folder glyph before the label, chevron after it.
      for (const chip of document.querySelectorAll('button[aria-haspopup="menu"]')) {
        const kids = [...chip.children]
        const label = kids.find(el => el.tagName === 'SPAN' && el.textContent.trim() !== '')
        if (label === undefined) continue
        const before = kids.slice(0, kids.indexOf(label)).find(el => el.tagName === 'svg' && !el.hasAttribute(MARK_ATTR))
        const after = kids.slice(kids.indexOf(label) + 1).find(el => el.tagName === 'svg')
        if (before === undefined || after === undefined) continue
        const text = label.textContent.trim()
        markHost(chip, before, text !== '' && remoteMarks.titles.has(text), remoteMarks.osTitles.get(text))
      }

      // Workspace hover cards (sidebar): dress the displayed `ssh://` path
      // with the alias `@`. The class token is DSH's hover-card path cell.
      for (const pathEl of document.querySelectorAll('[class*="_hoverPath"]')) {
        const text = pathEl.firstChild
        if (text === null || text.nodeType !== 3) continue
        const rewritten = displayRemotePath(text.data)
        if (rewritten !== null) text.data = rewritten
      }

      // DSH's PathLabel cells (file panel header, document preview, deliverables):
      // the directory segment carries the remote path prefix; the complete path
      // lives in the native tooltip. Both read with the alias `@`.
      for (const label of document.querySelectorAll('[data-path-label]')) {
        const directory = label.querySelector('[class*="_directory"]')
        if (directory !== null) {
          const text = directory.firstChild
          if (text !== null && text.nodeType === 3) {
            const rewritten = displayRemotePath(text.data)
            if (rewritten !== null) text.data = rewritten
          }
        }
        const title = label.getAttribute('title')
        if (title !== null) {
          const rewrittenTitle = displayRemotePath(title)
          if (rewrittenTitle !== null) label.setAttribute('title', rewrittenTitle)
        }
      }

      // File-tree rows: flag the referenceable ones as HTML5 drag sources (the
      // non-React property survives re-renders and stays inert until dragged).
      for (const row of document.querySelectorAll(TREE_ROW_SELECTOR)) {
        const draggable = rowReferenceKind(row) !== null
        if (row.draggable !== draggable) row.draggable = draggable
      }
    }

    let markPassQueued = false

    /** Coalesce a mutation burst into one pass on the next frame. */
    function scheduleRemoteMarks () {
      if (markPassQueued || typeof window === 'undefined') return
      markPassQueued = true
      window.requestAnimationFrame(() => {
        markPassQueued = false
        try { passRemoteMarks() } catch { /* decoration must never break the app */ }
      })
    }

    const MARKS_RELEVANT = '[data-row-key], [role="menu"], button[aria-haspopup="menu"], [class*="_hoverPath"], [data-path-label], [data-files-entry]'

    /** Whether one mutation record touches a workspace-bearing host. */
    function mutationTouchesMarks (record) {
      if (record.type === 'characterData') {
        // In-place text updates: e.g. the hero chip swapping its label from
        // the placeholder to a workspace title without any structural change.
        const parent = record.target.parentElement
        return parent !== null && (parent.matches(MARKS_RELEVANT) || parent.closest(MARKS_RELEVANT) !== null)
      }
      for (const node of [record.target, ...record.addedNodes, ...record.removedNodes]) {
        if (!(node instanceof Element)) continue
        if (node.matches(MARKS_RELEVANT) || node.closest(MARKS_RELEVANT) !== null) return true
        // Subtrees mount in one commit: the chip may arrive inside a wrapper
        // that itself matches nothing, so scan the added subtree once.
        if (node !== document.body && node.querySelector(MARKS_RELEVANT) !== null) return true
      }
      return false
    }

    /** Observe the app shell so the swap survives React re-renders. */
    function installRemoteWorkspaceMarks (ctx) {
      marksCtx = ctx
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
      const observer = new MutationObserver((records) => {
        if (records.some(mutationTouchesMarks)) scheduleRemoteMarks()
      })
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    }

    // =========================================================================
    // Floating remote workspaces (⋯ menu → submenu → floating display)
    // =========================================================================
    // One project often needs several SSH remotes, and every one of them would
    // otherwise take a permanent sidebar row — the pile-up this plugin exists
    // to avoid. A *floating* remote is stored under its parent project
    // (`floating` in dsh-ssh.json), injected into that project's native ⋯ menu
    // as a submenu, and, once selected, shown **in place of** the workspace
    // list: an opaque card that slides in from the left and carries that
    // workspace's OWN native row and session rows.
    //
    // Nothing is re-parented or re-rendered. The row-level effect is one marker
    // attribute plus one `display: none !important` rule, so new-session, the
    // ⋯ menu (with rename / delete AND every menu item other plugins inject),
    // archive / pin / drag all keep working — they are the same DOM nodes DSH
    // drew. The card is a plugin-owned sibling layer, inserted into the list
    // body DSH already styles `position: relative`.
    //
    // Three mechanisms share one data source, which is why they live together:
    //   1. the menu injection (DOM; capture click on the core aria template,
    //      append into the portal menu's viewport — the workspace-link-menu
    //      precedent of this plugin family);
    //   2. the floating display (attribute + CSS + MutationObserver self-heal —
    //      the workspace-focus-dom precedent);
    //   3. the add / manage dialogs (React, registered in the `shell.overlay`
    //      slot so they open independently of the sidebar panel).
    //
    // Degradation contract (same family): if the core changes its aria template
    // or row keys, the capture misses, the native menu stays exactly as it was
    // (one item missing, never a broken page), and the floating display simply
    // never activates. No plugin-owned class name is used as a hook.

    const FLOAT_ITEM_ATTR = 'data-sshwsp-float-item'
    const FLOAT_SUB_ATTR = 'data-sshwsp-float-submenu'
    const FLOAT_OPEN_ATTR = 'data-sshwsp-float-open'
    const FLOAT_FLIP_ATTR = 'data-sshwsp-float-flip'
    const FLOAT_REGION_ATTR = 'data-sshwsp-float-region'
    const FLOAT_ON_ATTR = 'data-sshwsp-float-on'
    const FLOAT_CARD_ATTR = 'data-sshwsp-float-card'
    const FLOAT_HEAD_ATTR = 'data-sshwsp-float-head'
    const FLOAT_HIDDEN_ATTR = 'data-sshwsp-float-hidden'

    /** 14px menu glyphs (the core menu's icon box); markup-only because these
     *  are inserted into DOM this plugin owns, not through the icon slots. */
    const FLOAT_CHEVRON_SVG = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>'
    const FLOAT_SERVER_SVG = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3" width="11" height="4.2" rx="1.1"/><rect x="2.5" y="8.8" width="11" height="4.2" rx="1.1"/><path d="M5 5.1h.01M5 10.9h.01"/></svg>'
    const FLOAT_PLUS_SVG = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.5v9"/><path d="M3.5 8h9"/></svg>'
    const FLOAT_GEAR_SVG = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2"/><path d="M8 1.8l.9 1.6 1.8-.4.5 1.8 1.8.5-.4 1.8 1.6.9-1.6.9.4 1.8-1.8.5-.5 1.8-1.8-.4-.9 1.6-.9-1.6-1.8.4-.5-1.8-1.8-.5.4-1.8L1.8 8l1.6-.9-.4-1.8 1.8-.5.5-1.8 1.8.4Z"/></svg>'
    const FLOAT_EXIT_SVG = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5H4.75A1.25 1.25 0 0 0 3.5 4.75v6.5a1.25 1.25 0 0 0 1.25 1.25H6.5"/><path d="M10 5.5L12.5 8L10 10.5"/><path d="M12.5 8H6.5"/></svg>'
    const FLOAT_CLOSE_SVG = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l8 8"/><path d="M12 4l-8 8"/></svg>'

    /**
     * The configured floating remotes as last read from `/floating/list`
     * (`loaded` distinguishes "not fetched yet" from "configured none").
     */
    const floatingStore = { items: [], loaded: false, error: null }
    /**
     * The one floating view currently shown, **page memory only**: a refresh
     * exits floating by design ("进入浮动的客户端状态只在本页内存"), while the
     * configured entries — and therefore the hidden rows — survive it.
     */
    let floatingActive = null
    /** The client root, for reading DSH's live workspaces store. */
    let floatingCtx = null
    /** The open submenu, so a background refresh can repaint it in place. */
    let floatingSubmenu = null
    /** Add / manage dialog state; `null` means no dialog is open. */
    const floatingDialog = { state: null, listeners: new Set() }

    // ---- entry list cache (localStorage; a display hint, never a source) ----

    /**
     * localStorage key of the last known `/floating/list` reply. Versioned: a
     * shape change bumps the suffix and older payloads are simply ignored.
     */
    const FLOATING_CACHE_KEY = 'dsh-ssh-workspace:floating:v1'

    /**
     * Read the cached entry list back.
     *
     * The cache exists for ONE purpose: the first submenu paint of a fresh page
     * shows the last known entries instead of an empty state that flips into
     * real rows once the fetch lands. It is a display hint only — never an
     * operational source (mount / select / manage always go through the live
     * `/floating/*` routes).
     *
     * @returns {object[]|null} the cached items, or null when there is no usable hint.
     */
    function readFloatingCache () {
      try {
        const storage = typeof window === 'undefined' ? null : window.localStorage
        if (storage === null || typeof storage.getItem !== 'function') return null
        const raw = storage.getItem(FLOATING_CACHE_KEY)
        if (typeof raw !== 'string' || raw === '') return null
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed?.items) ? parsed.items : null
      } catch (error) {
        // Privacy mode / denied storage / a damaged payload degrade to "no
        // hint" instead of an error: this read runs on every client boot, the
        // next `/floating/list` refresh is the actual source of truth, and the
        // cache contract is explicitly silent-ignore (it must never surface).
        return null
      }
    }

    /**
     * Persist the entry list after a successful refresh. Best effort by the
     * same contract as `readFloatingCache`: quota errors and private-mode
     * throws cost nothing but one cold first paint.
     *
     * @param {object[]} items - the freshly fetched entries.
     * @returns {void}
     */
    function writeFloatingCache (items) {
      try {
        const storage = typeof window === 'undefined' ? null : window.localStorage
        if (storage === null || typeof storage.setItem !== 'function') return
        storage.setItem(FLOATING_CACHE_KEY, JSON.stringify({ version: 1, items }))
      } catch (error) {
        // Silent-ignore contract (see readFloatingCache): a lost cache write is
        // not an error the user could act on.
      }
    }

    // Hydrate once when the client bundle evaluates, so the very first submenu
    // paint already carries the last known entries (`loaded = true`) — no
    // empty-state flip while the boot fetch is still in the air. Without a
    // cache the store keeps `loaded = false` and behaves exactly as before.
    const cachedFloatingItems = readFloatingCache()
    if (cachedFloatingItems !== null) {
      floatingStore.items = cachedFloatingItems
      floatingStore.loaded = true
    }

    /**
     * Open (or replace) the floating add / manage dialog.
     *
     * @param {object|null} state - `{ kind: 'add'|'manage', parentId, parentTitle, parentPath }`.
     * @returns {void}
     */
    function openFloatingDialog (state) {
      floatingDialog.state = state
      for (const listener of [...floatingDialog.listeners]) listener(state)
    }

    /** Close whichever floating dialog is open. */
    function closeFloatingDialog () {
      openFloatingDialog(null)
    }

    /** Subscribe a React component to the dialog state (component-local hook). */
    function useFloatingDialog () {
      const [state, setState] = React.useState(floatingDialog.state)
      React.useEffect(() => {
        const listener = (next) => setState(next)
        floatingDialog.listeners.add(listener)
        // The state may have changed between render and subscribe.
        setState(floatingDialog.state)
        return () => { floatingDialog.listeners.delete(listener) }
      }, [])
      return state
    }

    /** Warn at most once: this read happens on every decoration pass. */
    let floatingLiveStoreWarned = false

    /** Live workspaces from DSH's own store (empty when the service is absent). */
    function readLiveWorkspaceItems () {
      try {
        const items = floatingCtx?.get?.('workspaces')?.list?.getSnapshot?.()?.items
        return Array.isArray(items) ? items : []
      } catch (error) {
        // Optional service: without it the /status snapshot below still answers,
        // so this is informational and must not be logged per frame.
        if (!floatingLiveStoreWarned) {
          floatingLiveStoreWarned = true
          console.warn('[dsh-ssh-workspace] live workspaces unavailable for the floating view (the /status snapshot stands in):', error)
        }
        return []
      }
    }

    /**
     * The index the floating pass joins against: workspace path → id, and the
     * session ids each workspace owns.
     *
     * Two sources are merged because neither is sufficient: `/status` knows the
     * registration but is a snapshot, while DSH's live store is current but does
     * not exist in every host build. Live wins where both answer.
     *
     * @returns {{pathToId: Map<string,string>, idToPath: Map<string,string>, idToSessions: Map<string,string[]>}} the index.
     */
    function floatingWorkspaceIndex () {
      const pathToId = new Map()
      const idToPath = new Map()
      const idToSessions = new Map()
      const collect = (items) => {
        for (const item of Array.isArray(items) ? items : []) {
          const path = typeof item?.path === 'string' ? item.path : ''
          const rawId = item?.workspaceId ?? item?.id
          if (path === '' || rawId === undefined || rawId === null || String(rawId) === '') continue
          const id = String(rawId)
          pathToId.set(path, id)
          idToPath.set(id, path)
          idToSessions.set(id, (Array.isArray(item.sessionIds) ? item.sessionIds : []).map(String))
        }
      }
      collect(lastStatusWorkspaces)
      collect(readLiveWorkspaceItems())
      return { pathToId, idToPath, idToSessions }
    }

    /** The workspace title of one configured entry, for title-keyed surfaces. */
    function floatingWorkspaceTitle (item, index) {
      if (typeof item.workspaceTitle === 'string' && item.workspaceTitle.trim() !== '') return item.workspaceTitle.trim()
      const workspaceId = index.pathToId.get(item.workspacePath)
      const fromStatus = lastStatusWorkspaces.find(entry => String(entry?.id ?? entry?.workspaceId ?? '') === workspaceId)
      const title = typeof fromStatus?.title === 'string' ? fromStatus.title.trim() : ''
      if (title !== '') return title
      const trimmed = String(item.remotePath ?? '').replace(/\/+$/u, '')
      const base = trimmed.slice(trimmed.lastIndexOf('/') + 1)
      return base
    }

    /** Whether this client has a floating view to draw at all. */
    function hasFloatingConfiguration () {
      return floatingStore.items.length > 0 || floatingActive !== null
    }

    /** The in-flight `/floating/list` request shared by display-path refreshes. */
    let floatingRefreshInflight = null
    /** Monotonic token: only the newest-started request may write the store. */
    let floatingRefreshToken = 0

    /**
     * Read `/floating/list` and repaint whatever is on screen.
     *
     * Display-path callers (boot, menu injection, submenu open) SHARE one
     * in-flight request, so opening the ⋯ menu costs exactly one network round
     * trip: the submenu has already painted from the store (hydrated from
     * localStorage on boot), and the reply acts as a background revalidate —
     * with unchanged data `renderFloatingSubmenu` leaves the DOM untouched.
     * Mutation paths pass `{ force: true }`: their answer must reflect the
     * write that just happened, not an older shared read.
     *
     * @param {{force?: boolean}} [options] - `true` bypasses the in-flight share.
     * @returns {Promise<object[]>} the entry list as last known.
     */
    async function refreshFloatingEntries ({ force = false } = {}) {
      if (force !== true && floatingRefreshInflight !== null) return floatingRefreshInflight
      const token = ++floatingRefreshToken
      const request = (async () => {
        try {
          const data = await fetchJson(API.floatingList)
          // A superseded (older) reply must not clobber the store or the cache.
          if (token === floatingRefreshToken) {
            floatingStore.items = Array.isArray(data?.items) ? data.items : []
            floatingStore.error = null
            writeFloatingCache(floatingStore.items)
          }
        } catch (error) {
          if (token === floatingRefreshToken) {
            floatingStore.error = error instanceof Error ? error.message : String(error)
          }
          // The last known list stands: a failed refresh must not make configured
          // entries (or their hidden rows) flip back into the sidebar.
          console.warn('[dsh-ssh-workspace] could not refresh the floating workspace list:', error)
        }
        floatingStore.loaded = true
        renderFloatingSubmenu()
        scheduleFloatingDisplay()
        return floatingStore.items
      })()
      floatingRefreshInflight = request
      try {
        return await request
      } finally {
        if (floatingRefreshInflight === request) floatingRefreshInflight = null
      }
    }

    /** Entries configured under one parent workspace, in their stored order. */
    function floatingEntriesOf (parentId) {
      return floatingStore.items.filter(item => item.parentId === parentId)
    }

    /** The configured entry owning one session id, or undefined. */
    function floatingEntryForSession (sessionId, index = floatingWorkspaceIndex()) {
      if (sessionId === '') return undefined
      for (const item of floatingStore.items) {
        const workspaceId = index.pathToId.get(item.workspacePath)
        if (workspaceId === undefined) continue
        if ((index.idToSessions.get(workspaceId) ?? []).includes(sessionId)) return item
      }
      return undefined
    }

    /** Enter the floating view for one configured entry (already mounted). */
    function enterFloating (item, workspaceId) {
      const index = floatingWorkspaceIndex()
      const resolved = workspaceId !== undefined && workspaceId !== null && String(workspaceId) !== ''
        ? String(workspaceId)
        : index.pathToId.get(item.workspacePath)
      if (resolved === undefined) {
        notifyUser(translate('float.notRegistered'), 'err')
        return
      }
      floatingActive = {
        id: item.id,
        parentId: item.parentId,
        workspaceId: resolved,
        title: item.title,
        addr: floatingHostLabel(item),
        workspacePath: item.workspacePath,
      }
      scheduleFloatingDisplay()
    }

    /** Leave the floating view (the hidden rows come back in the same pass). */
    function exitFloating () {
      if (floatingActive === null) return
      floatingActive = null
      scheduleFloatingDisplay()
    }

    /**
     * Mount (or reuse) one entry's workspace and enter its floating view.
     *
     * Failure is reported as the plugin's toast and floating is NOT entered:
     * floating a workspace that does not exist would hide every other row in
     * exchange for an empty card.
     *
     * @param {object} item - the configured entry (from `/floating/list`).
     * @returns {Promise<boolean>} whether the floating view was entered.
     */
    async function selectFloatingEntry (item) {
      try {
        const result = await fetchJson(API.mount, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ alias: item.alias, remotePath: item.remotePath, title: item.title, register: true }),
        })
        if (result?.ok === false) throw new Error(result.error ?? 'mount failed')
        // Fresh data reflecting the mount just performed, not a shared read.
        await refreshFloatingEntries({ force: true })
        const fresh = floatingStore.items.find(candidate => candidate.id === item.id) ?? item
        enterFloating(fresh, result?.workspaceId ?? fresh.workspaceId)
        // The registration just appeared: let the marks decoration catch up.
        refreshRemoteWorkspaceMarks()
        return true
      } catch (error) {
        notifyUser(translate('float.selectFail', { msg: error instanceof Error ? error.message : String(error) }), 'err')
        return false
      }
    }

    /** Find the sidebar workspace tree (the scroller carrying DSH's row keys). */
    function findWorkspaceTree () {
      for (const tree of document.querySelectorAll('[role="tree"]')) {
        if (tree.querySelector('[data-row-key^="workspace:"]') !== null) return tree
      }
      return null
    }

    /** Direct child carrying one of our marker attributes (stub-DOM friendly). */
    function floatingChildOf (parent, attrName) {
      for (const child of parent.children ?? []) {
        if (typeof child.hasAttribute === 'function' && child.hasAttribute(attrName)) return child
      }
      return null
    }

    /** Build the floating card (header included) for one active workspace. */
    function buildFloatingCard (active) {
      const card = document.createElement('div')
      card.setAttribute(FLOAT_CARD_ATTR, '')
      const head = document.createElement('div')
      head.setAttribute(FLOAT_HEAD_ATTR, '')
      head.setAttribute('role', 'status')
      const badge = document.createElement('span')
      badge.className = 'sshwsp-float-badge'
      badge.textContent = translate('float.badge')
      const titles = document.createElement('div')
      titles.className = 'sshwsp-float-titles'
      const title = document.createElement('span')
      title.className = 'sshwsp-float-title'
      const addr = document.createElement('span')
      addr.className = 'sshwsp-float-addr'
      titles.append(title, addr)
      const close = document.createElement('button')
      close.type = 'button'
      close.className = 'sshwsp-float-close'
      close.setAttribute('aria-label', translate('float.cardClose'))
      close.title = translate('float.cardClose')
      close.innerHTML = FLOAT_CLOSE_SVG
      close.addEventListener('click', (event) => {
        event.stopPropagation()
        exitFloating()
      })
      head.append(badge, titles, close)
      card.append(head)
      return card
    }

    /** Keep the card's texts in step with the active entry (no rebuild). */
    function updateFloatingCard (card, active) {
      const head = floatingChildOf(card, FLOAT_HEAD_ATTR)
      if (head === null) return
      const title = head.querySelector('.sshwsp-float-title')
      const addr = head.querySelector('.sshwsp-float-addr')
      const close = head.querySelector('.sshwsp-float-close')
      if (title !== null && title.textContent !== active.title) title.textContent = active.title
      if (addr !== null && addr.textContent !== active.addr) addr.textContent = active.addr
      if (close !== null) {
        const label = `${translate('float.cardClose')} — ${active.title}`
        if (close.getAttribute('aria-label') !== label) close.setAttribute('aria-label', label)
      }
    }

    /** Put the card in place (idempotent) and mark its region for the CSS. */
    function ensureFloatingChrome (region, active) {
      let card = floatingChildOf(region, FLOAT_CARD_ATTR)
      if (card === null) {
        card = buildFloatingCard(active)
        const first = region.firstElementChild
        if (first === null) region.appendChild(card)
        else region.insertBefore(card, first)
      }
      updateFloatingCard(card, active)
      if (!region.hasAttribute(FLOAT_REGION_ATTR)) region.setAttribute(FLOAT_REGION_ATTR, '')
      if (!region.hasAttribute(FLOAT_ON_ATTR)) region.setAttribute(FLOAT_ON_ATTR, '')
    }

    /** Take the card and the region attributes away (exit floating). */
    function removeFloatingChrome () {
      for (const card of document.querySelectorAll(`[${FLOAT_CARD_ATTR}]`)) card.remove()
      for (const region of document.querySelectorAll(`[${FLOAT_REGION_ATTR}]`)) {
        region.removeAttribute(FLOAT_ON_ATTR)
        region.removeAttribute(FLOAT_REGION_ATTR)
      }
    }

    let floatingPassQueued = false

    /** Coalesce a mutation burst into one decoration pass on the next frame. */
    function scheduleFloatingDisplay () {
      if (floatingPassQueued || typeof window === 'undefined') return
      floatingPassQueued = true
      window.requestAnimationFrame(() => {
        floatingPassQueued = false
        try {
          passFloatingDisplay()
        } catch (error) {
          // Decoration must never break the app; report instead of swallowing.
          console.warn('[dsh-ssh-workspace] the floating display pass failed:', error)
        }
      })
    }

    /** The id sets one floating pass needs, computed from entries + the index. */
    function floatingMembership (items, index, active) {
      const configuredIds = new Set()
      const configuredSessions = new Set()
      for (const item of Array.isArray(items) ? items : []) {
        const workspaceId = index.pathToId.get(item.workspacePath)
        if (workspaceId === undefined) continue
        configuredIds.add(workspaceId)
        for (const sessionId of index.idToSessions.get(workspaceId) ?? []) configuredSessions.add(sessionId)
      }
      const activeSessions = active === null || active === undefined
        ? new Set()
        : new Set(index.idToSessions.get(active.workspaceId) ?? [])
      // Whether the membership of the floating workspace is actually known. An
      // empty set is ambiguous (a workspace with no sessions vs. a registry we
      // cannot read), and treating the second as the first would hide the very
      // sessions the card exists to show.
      const activeSessionsKnown = active === null || active === undefined
        ? true
        : index.idToSessions.has(active.workspaceId)
      return { configuredIds, configuredSessions, activeSessions, activeSessionsKnown }
    }

    /**
     * Whether one tree row must be hidden under the current floating state.
     *
     * Not floating: every row of a configured floating workspace (and its
     * session rows) leaves the normal list — that is what keeps the pile-up
     * away. Floating: every row EXCEPT the floating workspace's own, so the
     * card holds exactly one workspace's native rows.
     *
     * @param {string} key - the row's `data-row-key`.
     * @param {object|null} active - the floating target, or null.
     * @param {{configuredIds: Set<string>, configuredSessions: Set<string>, activeSessions: Set<string>}} membership - the id sets.
     * @returns {boolean} true when the row must be hidden.
     */
    function floatingRowHidden (key, active, membership) {
      if (typeof key !== 'string' || key === '') return false
      if (key.startsWith('workspace:') || key.startsWith('overflow:')) {
        const id = key.slice(key.indexOf(':') + 1)
        return active !== null && active !== undefined ? id !== active.workspaceId : membership.configuredIds.has(id)
      }
      if (key.startsWith('session:')) {
        const id = key.slice('session:'.length)
        if (active === null || active === undefined) return membership.configuredSessions.has(id)
        // Unknown membership: hiding on a guess could hide the floating
        // workspace's own sessions, so nothing is hidden.
        if (membership.activeSessionsKnown === false) return false
        return !membership.activeSessions.has(id)
      }
      return false
    }

    /**
     * Reconcile the whole floating decoration with the current state.
     *
     * One pass answers three questions:
     *  - is the active floating target still real (configured, workspace still
     *    registered)? If not, floating is dropped — that is what makes
     *    "delete the workspace from its own row" exit the card automatically;
     *  - which rows must be hidden;
     *  - is the card in place with the right texts.
     */
    function passFloatingDisplay () {
      if (typeof document === 'undefined') return
      const index = floatingWorkspaceIndex()
      // A floating target whose entry or workspace disappeared is stale. The
      // registry may legitimately be unreadable, so "unknown" (an empty index)
      // never counts as gone.
      if (floatingActive !== null) {
        const configured = floatingStore.items.some(item => item.id === floatingActive.id)
        const known = index.idToPath.size > 0
        const workspaceAlive = index.idToPath.has(floatingActive.workspaceId)
        if (!configured || (known && !workspaceAlive)) floatingActive = null
      }

      const active = floatingActive
      const membership = floatingMembership(floatingStore.items, index, active)

      const configuredTitles = new Set()
      for (const item of floatingStore.items) {
        const title = floatingWorkspaceTitle(item, index)
        if (title !== '' && remoteMarks.titles.has(title)) configuredTitles.add(title)
      }

      // Row-level hiding, scoped to the workspace tree when it is on screen:
      // search results are also `session:<id>` rows, and greying them out
      // because a floating card is up would break the one list that still lets
      // the user find a session of another workspace.
      // Keys are DSH's stable row contract: `workspace:<id>` / `session:<id>` /
      // `overflow:<id>` (the collapsed sessions button travels with its group).
      const tree = findWorkspaceTree()
      const rowScope = tree !== null ? tree.querySelectorAll('[data-row-key]') : []
      for (const row of rowScope) {
        const key = row.getAttribute('data-row-key') ?? ''
        if (floatingRowHidden(key, active, membership)) {
          if (!row.hasAttribute(FLOAT_HIDDEN_ATTR)) row.setAttribute(FLOAT_HIDDEN_ATTR, '')
        } else if (row.hasAttribute(FLOAT_HIDDEN_ATTR)) {
          row.removeAttribute(FLOAT_HIDDEN_ATTR)
        }
      }

      // Title-keyed surfaces (workspace picker rows, the session hero chip)
      // carry no workspace id at all. Hiding them is only meaningful while NOT
      // floating: with the card up, the current workspace must stay visible in
      // those surfaces. The marks identity set (`remoteMarks.titles`, which
      // already includes path basenames) gates the match, so a local workspace
      // that happens to share the title is never touched.
      if (active === null) {
        for (const button of document.querySelectorAll('[role="menu"] button[role="menuitem"]')) {
          if (button.closest(`[${FLOAT_ITEM_ATTR}]`) !== null) continue
          const label = (button.firstElementChild?.nextElementSibling?.textContent ?? '').trim()
          const hide = label !== '' && configuredTitles.has(label) && remoteMarks.titles.has(label)
          if (hide) {
            if (!button.hasAttribute(FLOAT_HIDDEN_ATTR)) button.setAttribute(FLOAT_HIDDEN_ATTR, '')
          } else if (button.hasAttribute(FLOAT_HIDDEN_ATTR)) {
            button.removeAttribute(FLOAT_HIDDEN_ATTR)
          }
        }
        for (const chip of document.querySelectorAll('button[aria-haspopup="menu"]')) {
          const kids = [...chip.children]
          const labelEl = kids.find(el => el.tagName === 'SPAN' && el.textContent.trim() !== '')
          if (labelEl === undefined) continue
          const label = labelEl.textContent.trim()
          const hide = configuredTitles.has(label) && remoteMarks.titles.has(label)
          if (hide) {
            if (!chip.hasAttribute(FLOAT_HIDDEN_ATTR)) chip.setAttribute(FLOAT_HIDDEN_ATTR, '')
          } else if (chip.hasAttribute(FLOAT_HIDDEN_ATTR)) {
            chip.removeAttribute(FLOAT_HIDDEN_ATTR)
          }
        }
      } else {
        for (const node of document.querySelectorAll(`[${FLOAT_HIDDEN_ATTR}]`)) {
          if ((node.getAttribute('data-row-key') ?? '') !== '') continue
          node.removeAttribute(FLOAT_HIDDEN_ATTR)
        }
      }

      // The card itself.
      const region = tree === null ? null : tree.parentElement
      if (active !== null && region !== null) ensureFloatingChrome(region, active)
      else removeFloatingChrome()
    }

    // ---- the workspace ⋯ menu injection -------------------------------------

    /**
     * The core workspace-⋯ anchor's aria label.
     *
     * Two concrete templates are the whole contract: zh 「工作区“{name}”的操作」
     * and en "Workspace actions for {name}". A changed template means the
     * capture misses and the native menu stays untouched — one missing item,
     * never a broken page. The keyboard path needs nothing extra: the injected
     * rows are `role="menuitem"` buttons inside the core menu's own viewport, so
     * Tab / Enter / Escape walk the same path the native rows use.
     *
     * @param {Element} anchor - the candidate button.
     * @returns {boolean} whether it is the workspace-actions trigger.
     */
    function isWorkspaceMenuAnchor (anchor) {
      const label = anchor.getAttribute('aria-label') ?? ''
      return label.startsWith('Workspace actions for ') || /^工作区“.+”的操作$/.test(label)
    }

    /**
     * Clamp the (now taller) menu back into the viewport.
     *
     * The core sizes the portaled menu before our block exists, so appending
     * rows can push its bottom past the frame. The core's own `scrollable`
     * max-height still guards; this just moves the card up first, 12px margin —
     * the same treatment ao-local / better-sidebar give their injections.
     */
    function clampFloatingMenuIntoViewport (menu) {
      try {
        const rect = menu.getBoundingClientRect()
        const overflowBottom = rect.bottom - (window.innerHeight - 12)
        if (overflowBottom > 0 && rect.top - overflowBottom >= 12) menu.style.top = `${rect.top - overflowBottom}px`
      } catch (error) {
        console.warn('[dsh-ssh-workspace] could not clamp the workspace menu into the viewport:', error)
      }
    }

    /** Close the native menu by its own anchor click; Escape is the fallback. */
    function closeFloatingNativeMenu (anchor) {
      if (anchor !== null && anchor !== undefined && anchor.isConnected === true && typeof anchor.click === 'function') {
        anchor.click()
        return
      }
      if (typeof KeyboardEvent !== 'function') return
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }

    /** Row wrapper giving a submenu its positioning context. */
    function buildFloatingRow (control, sub) {
      const holder = document.createElement('div')
      holder.className = 'sshwsp-frow'
      holder.appendChild(control)
      if (sub !== undefined) holder.appendChild(sub)
      return holder
    }

    /** One `role="menuitem"` button in the injected block / submenu. */
    function buildFloatingMenuItem (label, iconSvg, options) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'sshwsp-fitem'
      button.setAttribute('role', 'menuitem')
      button.setAttribute('aria-label', options?.ariaLabel ?? label)
      if (options?.hasPopup === true) {
        button.setAttribute('aria-haspopup', 'menu')
        button.setAttribute('aria-expanded', 'false')
      }
      if (options?.disabled === true) {
        button.disabled = true
        button.setAttribute('aria-disabled', 'true')
      }
      const icon = document.createElement('span')
      icon.className = 'sshwsp-fitem-icon'
      if (typeof iconSvg === 'string' && iconSvg !== '') icon.innerHTML = iconSvg
      const text = document.createElement('span')
      text.className = 'sshwsp-fitem-text'
      text.textContent = label
      button.append(icon, text)
      if (options?.chevron === true) {
        const chevron = document.createElement('span')
        chevron.className = 'sshwsp-fitem-chevron'
        chevron.innerHTML = FLOAT_CHEVRON_SVG
        button.appendChild(chevron)
      }
      return button
    }

    /** One separator line inside the injected block / submenu. */
    function buildFloatingSeparator () {
      const separator = document.createElement('div')
      separator.className = 'sshwsp-fsep'
      separator.setAttribute('role', 'separator')
      return separator
    }

    /**
     * The host spelling shown next to an entry's name: `alias@host`.
     *
     * The alias and the address are separate facts in the record, and the
     * generated name already carries the alias at its tail — this is the
     * compact "where does it point" line under it.
     */
    function floatingHostLabel (item) {
      if (item.hostMissing === true) return item.alias
      const target = typeof item.hostTarget === 'string' ? item.hostTarget : ''
      return target === '' ? item.alias : `${item.alias}@${target}`
    }

    /** The state badge text + class for one configured entry. */
    function floatingEntryState (item) {
      if (item.hostMissing === true) return { text: translate('float.hostMissing'), cls: 'is-bad' }
      if (floatingActive !== null && floatingActive.id === item.id) return { text: translate('float.stateFloating'), cls: 'is-on' }
      if (item.mounted === true) return { text: translate('float.stateMounted'), cls: 'is-on' }
      return { text: translate('float.stateUnmounted'), cls: '' }
    }

    /**
     * The submenu's cheap render signature: every fact the paint depends on
     * (entry id, title, host label, state badge) plus the floating state that
     * toggles the exit row. Equal signatures ⇒ equal DOM.
     *
     * @param {string} parentId - the parent workspace whose entries are shown.
     * @returns {string} the signature of what the submenu would paint.
     */
    function floatingSubmenuSignature (parentId) {
      const parts = [parentId]
      if (floatingActive !== null && floatingActive.parentId === parentId) parts.push(`active:${floatingActive.id}`)
      for (const item of floatingEntriesOf(parentId)) {
        const state = floatingEntryState(item)
        parts.push([item.id, item.title, floatingHostLabel(item), state.cls, state.text].join('\u0000'))
      }
      return parts.join('\u0001')
    }

    /**
     * Render the `SSH 远程工作区` submenu from the current entry list.
     *
     * Paints in two steps to stay flicker-free: the rows are built OFF the
     * submenu first (a plain array — no DOM touched), and only the completed
     * build replaces the content in one synchronous pass. A call whose
     * signature matches what is already painted returns before touching
     * anything, so reopening the menu keeps the very same DOM nodes — the old
     * "clear the tree, then rebuild it" (the reported per-open flicker) cannot
     * happen any more, and neither can the empty-state → real-rows flip.
     */
    function renderFloatingSubmenu () {
      if (floatingSubmenu === null) return
      const { sub, parentId, parentTitle, parentPath, anchor } = floatingSubmenu
      const signature = floatingSubmenuSignature(parentId)
      if (signature === sub.__sshwspFloatSignature) return
      const rows = []
      const entries = floatingEntriesOf(parentId)
      if (entries.length === 0) {
        rows.push(buildFloatingRow(buildFloatingMenuItem(translate('float.subEmpty'), '', { disabled: true })))
        const hint = document.createElement('div')
        hint.className = 'sshwsp-fitem'
        hint.style.cursor = 'default'
        const hintText = document.createElement('span')
        hintText.className = 'sshwsp-fitem-text'
        hintText.textContent = translate('float.subEmptyHint')
        hint.append(hintText)
        rows.push(buildFloatingRow(hint))
      }
      for (const item of entries) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'sshwsp-fitem'
        button.setAttribute('role', 'menuitem')
        const state = floatingEntryState(item)
        button.setAttribute('aria-label', `${item.title} — ${state.text}`)
        const icon = document.createElement('span')
        icon.className = 'sshwsp-fitem-icon'
        icon.innerHTML = FLOAT_SERVER_SVG
        const main = document.createElement('span')
        main.className = 'sshwsp-fitem-main'
        const title = document.createElement('span')
        title.className = 'sshwsp-fitem-text'
        title.textContent = item.title
        const meta = document.createElement('span')
        meta.className = 'sshwsp-fmeta'
        meta.textContent = floatingHostLabel(item)
        main.append(title, meta)
        const badge = document.createElement('span')
        badge.className = `sshwsp-fitem-state ${state.cls}`.trim()
        badge.textContent = state.text
        button.append(icon, main, badge)
        button.addEventListener('click', (event) => {
          event.stopPropagation()
          closeFloatingSubmenu()
          closeFloatingNativeMenu(anchor)
          void selectFloatingEntry(item)
        })
        rows.push(buildFloatingRow(button))
      }
      rows.push(buildFloatingSeparator())
      const addRow = buildFloatingMenuItem(translate('float.add'), FLOAT_PLUS_SVG)
      addRow.addEventListener('click', (event) => {
        event.stopPropagation()
        closeFloatingSubmenu()
        closeFloatingNativeMenu(anchor)
        openFloatingDialog({ kind: 'add', parentId, parentTitle, parentPath })
      })
      rows.push(buildFloatingRow(addRow))
      const manageRow = buildFloatingMenuItem(translate('float.manage'), FLOAT_GEAR_SVG)
      manageRow.addEventListener('click', (event) => {
        event.stopPropagation()
        closeFloatingSubmenu()
        closeFloatingNativeMenu(anchor)
        openFloatingDialog({ kind: 'manage', parentId, parentTitle, parentPath })
      })
      rows.push(buildFloatingRow(manageRow))
      if (floatingActive !== null && floatingActive.parentId === parentId) {
        rows.push(buildFloatingSeparator())
        const exitRow = buildFloatingMenuItem(translate('float.exit'), FLOAT_EXIT_SVG)
        exitRow.addEventListener('click', (event) => {
          event.stopPropagation()
          exitFloating()
          closeFloatingSubmenu()
          closeFloatingNativeMenu(anchor)
        })
        rows.push(buildFloatingRow(exitRow))
      }
      // One synchronous swap: the submenu is never seen empty mid-render, and
      // the signature is stored only for content that is actually on screen.
      sub.textContent = ''
      for (const row of rows) sub.appendChild(row)
      sub.__sshwspFloatSignature = signature
    }

    /** Position the submenu: right of the card, flipped left / up at the edge. */
    function positionFloatingSubmenu (holder, sub) {
      sub.removeAttribute(FLOAT_FLIP_ATTR)
      sub.style.left = ''
      sub.style.right = ''
      sub.style.top = ''
      sub.style.bottom = ''
      const rect = sub.getBoundingClientRect()
      if (rect.right > window.innerWidth - 8) sub.setAttribute(FLOAT_FLIP_ATTR, '')
      if (rect.bottom > window.innerHeight - 12) {
        const overflow = rect.bottom - (window.innerHeight - 12)
        sub.style.bottom = 'auto'
        sub.style.top = `${-overflow - 4}px`
      }
    }

    /** Open (and repaint) the injected submenu. */
    function openFloatingSubmenu (holder, sub, context) {
      closeFloatingSubmenu()
      floatingSubmenu = { holder, sub, ...context }
      sub.setAttribute(FLOAT_OPEN_ATTR, '')
      const trigger = holder.querySelector('button[aria-haspopup="menu"]')
      if (trigger !== null) trigger.setAttribute('aria-expanded', 'true')
      renderFloatingSubmenu()
      positionFloatingSubmenu(holder, sub)
      // Repaint with fresh state when the reply arrives (an entry may have been
      // mounted or deleted in another tab).
      void refreshFloatingEntries()
    }

    /** Close the injected submenu and forget its positioning tweaks. */
    function closeFloatingSubmenu () {
      if (floatingSubmenu === null) return
      const { holder, sub } = floatingSubmenu
      sub.removeAttribute(FLOAT_OPEN_ATTR)
      sub.removeAttribute(FLOAT_FLIP_ATTR)
      sub.style.left = ''
      sub.style.right = ''
      sub.style.top = ''
      sub.style.bottom = ''
      const trigger = holder.querySelector('button[aria-haspopup="menu"]')
      if (trigger !== null) trigger.setAttribute('aria-expanded', 'false')
      floatingSubmenu = null
    }

    /**
     * Install the ⋯ menu injection.
     *
     * Mechanism (identical to the family's workspace-link-menu precedent, so a
     * future reader only has to learn it once):
     *  1. capture-phase click on the workspace-actions anchor records the row's
     *     `workspace:<id>` and the anchor (the ungrouped bucket has no id, and
     *     is skipped);
     *  2. the menu is a `portal: true` React portal mounted on `body`; a body
     *     observer appends our block into its viewport once it appears;
     *  3. the block is appended LAST — nothing already in the menu is removed,
     *     reordered or overridden, so ao-local's archive / pin / quick-search /
     *     copy-path items and better-sidebar's own items stay exactly as they
     *     were;
     *  4. after appending, the menu is clamped back into the viewport;
     *  5. our marker attribute prevents a second injection, and the whole
     *     injection is torn down with the menu.
     *
     * @returns {() => void} the disposer.
     */
    function installFloatingMenu () {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
      let disposed = false
      let pendingParentId = null
      let pendingTitle = ''
      let pendingPath = ''
      let pendingAnchor = null
      let pendingTimer = undefined
      let injectedWrap = null
      let injectedMenu = null

      const clearPending = () => {
        pendingParentId = null
        pendingTitle = ''
        pendingPath = ''
        pendingAnchor = null
        if (pendingTimer !== undefined) {
          clearTimeout(pendingTimer)
          pendingTimer = undefined
        }
      }

      /** Hovering another row of the same menu closes our submenu (core parity). */
      const onMenuMouseOver = (event) => {
        const target = event.target
        if (injectedWrap === null || target === null || typeof target.closest !== 'function') return
        if (injectedWrap.contains(target)) return
        closeFloatingSubmenu()
      }

      const teardownInjection = () => {
        closeFloatingSubmenu()
        document.removeEventListener('keydown', onGlobalKeyDown, true)
        document.removeEventListener('pointerdown', onGlobalPointerDown, true)
        if (injectedMenu !== null) injectedMenu.removeEventListener('mouseover', onMenuMouseOver)
        injectedMenu = null
        injectedWrap = null
      }

      const onGlobalKeyDown = (event) => {
        if (event.key === 'Escape') closeFloatingSubmenu()
      }

      const onGlobalPointerDown = (event) => {
        const target = event.target
        if (injectedWrap === null || target === null || typeof target.closest !== 'function') {
          closeFloatingSubmenu()
          return
        }
        if (injectedWrap.contains(target)) return
        closeFloatingSubmenu()
      }

      /** Repaint on hover, and close a sibling submenu once the pointer leaves. */
      const onWrapMouseOver = (event) => {
        if (injectedWrap === null) return
        const target = event.target
        if (target === null || typeof target.closest !== 'function') return
        const holder = target.closest('.sshwsp-frow')
        if (holder === null || !injectedWrap.contains(holder)) return
        const sub = holder.querySelector(`[${FLOAT_SUB_ATTR}]`)
        if (sub !== null) {
          if (!sub.hasAttribute(FLOAT_OPEN_ATTR)) {
            const context = {
              parentId: injectedWrap.getAttribute('data-sshwsp-float-parent') ?? '',
              parentTitle: injectedWrap.getAttribute('data-sshwsp-float-parent-title') ?? '',
              parentPath: injectedWrap.getAttribute('data-sshwsp-float-parent-path') ?? '',
              // The anchor is captured on OUR wrapper, not read from the pending
              // slot: pending is cleared the moment the block is injected, and a
              // hover-open still needs a way to close the native menu.
              anchor: injectedWrap.__sshwspFloatAnchor ?? null,
            }
            openFloatingSubmenu(holder, sub, context)
          }
          return
        }
        closeFloatingSubmenu()
      }

      /** Append the block into the just-mounted portaled menu. */
      const onItemMounted = (menu) => {
        if (pendingParentId === null || disposed) return
        if (menu.querySelector(`[${FLOAT_ITEM_ATTR}]`) !== null) return
        const viewport = menu.querySelector('[class*="_viewport"]') ?? menu
        const context = {
          parentId: pendingParentId,
          parentTitle: pendingTitle,
          parentPath: pendingPath,
          anchor: pendingAnchor,
        }
        clearPending()

        const wrap = document.createElement('div')
        wrap.setAttribute(FLOAT_ITEM_ATTR, '')
        wrap.setAttribute('data-sshwsp-float-parent', context.parentId)
        wrap.setAttribute('data-sshwsp-float-parent-title', context.parentTitle)
        wrap.setAttribute('data-sshwsp-float-parent-path', context.parentPath)
        wrap.appendChild(buildFloatingSeparator())

        const topButton = buildFloatingMenuItem(translate('float.menuLabel'), FLOAT_SERVER_SVG, { hasPopup: true, chevron: true })
        const sub = document.createElement('div')
        sub.setAttribute('role', 'menu')
        sub.setAttribute(FLOAT_SUB_ATTR, '')
        const holder = buildFloatingRow(topButton, sub)
        wrap.appendChild(holder)
        topButton.addEventListener('click', (event) => {
          event.stopPropagation()
          if (sub.hasAttribute(FLOAT_OPEN_ATTR)) closeFloatingSubmenu()
          else openFloatingSubmenu(holder, sub, context)
        })
        wrap.addEventListener('mouseover', onWrapMouseOver)

        viewport.appendChild(wrap)
        // Own node, so a plain property is safe (no DOM attribute pollution).
        wrap.__sshwspFloatAnchor = context.anchor
        injectedWrap = wrap
        injectedMenu = menu
        menu.addEventListener('mouseover', onMenuMouseOver)
        document.addEventListener('keydown', onGlobalKeyDown, true)
        document.addEventListener('pointerdown', onGlobalPointerDown, true)
        // The menu was sized before this block existed: pull it back into frame.
        clampFloatingMenuIntoViewport(menu)
        // Fresh state for the first open (the boot fetch may have raced).
        void refreshFloatingEntries()
      }

      /** Capture phase: remember which workspace's menu was just opened. */
      const onCaptureClick = (event) => {
        if (disposed) return
        const target = event.target
        const anchor = target !== null && typeof target.closest === 'function' ? target.closest('button') : null
        if (anchor === null || !isWorkspaceMenuAnchor(anchor)) {
          if (pendingParentId !== null) clearPending()
          return
        }
        const rowEl = anchor.closest('[data-row-key^="workspace:"]')
        const rowKey = rowEl === null ? '' : (rowEl.getAttribute('data-row-key') ?? '')
        const parentId = rowKey.startsWith('workspace:') ? rowKey.slice('workspace:'.length) : ''
        if (parentId === '') {
          // The ungrouped bucket has no id: there is no project to hang entries
          // on, so the menu is left exactly as the core drew it.
          clearPending()
          return
        }
        // A click while a portal menu is already open is a CLOSE, not an open:
        // arming here would inject into whatever unrelated menu opens next.
        if (document.querySelector('[role="menu"]') !== null) {
          clearPending()
          return
        }
        pendingParentId = parentId
        pendingTitle = (rowEl.textContent ?? '').trim()
        pendingPath = floatingWorkspaceIndex().idToPath.get(parentId) ?? ''
        pendingAnchor = anchor
        if (pendingTimer !== undefined) clearTimeout(pendingTimer)
        // The portal mounts on the next tick; the window bounds any leak.
        pendingTimer = setTimeout(() => {
          pendingTimer = undefined
          clearPending()
        }, 800)
      }

      const observer = new MutationObserver((records) => {
        if (injectedWrap !== null && injectedWrap.isConnected === false) teardownInjection()
        if (pendingParentId === null || disposed) return
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeType !== 1) continue
            if (node.getAttribute('role') === 'menu') onItemMounted(node)
          }
        }
      })

      document.addEventListener('click', onCaptureClick, true)
      observer.observe(document.body, { childList: true })
      return () => {
        disposed = true
        document.removeEventListener('click', onCaptureClick, true)
        if (injectedWrap !== null) teardownInjection()
        observer.disconnect()
        clearPending()
      }
    }

    // ---- add / manage dialogs ----------------------------------------------

    /**
     * Add one SSH remote to a project's floating list.
     *
     * Deliberately has **no name field**: the server derives
     * `basename · alias` and de-duplicates within the parent, and the dialog
     * only previews the result. There is also no mount step here — adding is
     * configuration; selecting the entry from the menu is what mounts it.
     *
     * Writability follows the same contract as `RemoteWorkspaceDialog`: `/ls`
     * probes the SFTP channel the agent will actually use, and a
     * `writable: false` answer has to stop the save here — configuring a remote
     * the agent cannot work in only postpones the failure to the first edit.
     * Loading and error states judge nothing (`writable` keeps its last value,
     * both of which already keep the save disabled).
     */
    function FloatingAddDialog ({ t, state }) {
      const [hosts, setHosts] = React.useState(null)
      const [hostsError, setHostsError] = React.useState(null)
      const [alias, setAlias] = React.useState('')
      const [path, setPath] = React.useState(null)
      const [entries, setEntries] = React.useState(null)
      const [writable, setWritable] = React.useState(true)
      const [loading, setLoading] = React.useState(false)
      const [loadError, setLoadError] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      const [saveError, setSaveError] = React.useState(null)
      const loadSeq = React.useRef(0)

      React.useEffect(() => {
        let cancelled = false
        fetchJson(API.hosts)
          .then((data) => {
            if (cancelled) return
            const list = data.hosts ?? []
            setHosts(list)
            if (list.length > 0) setAlias(list[0].alias)
          })
          .catch((error) => { if (!cancelled) setHostsError(error.message) })
        return () => { cancelled = true }
      }, [])

      const selectedHost = hosts?.find((host) => host.alias === alias)
      const defaultPath = selectedHost?.defaultPath

      const loadDir = React.useCallback(async (target) => {
        if (alias === '') return
        const seq = ++loadSeq.current
        if (typeof target === 'string') setPath(target)
        setLoading(true)
        setLoadError(null)
        try {
          const query = typeof target === 'string' && target !== '' ? `&path=${encodeURIComponent(target)}` : ''
          const data = await fetchJson(`${API.ls}?alias=${encodeURIComponent(alias)}${query}`)
          if (seq !== loadSeq.current) return
          setEntries((data.entries ?? [])
            .filter((entry) => entry.type === 'directory')
            .sort((a, b) => a.name.localeCompare(b.name)))
          if (typeof data.path === 'string' && data.path !== '') setPath(data.path)
          // The verdict is for the directory this answer is about: a missing
          // field (older server) is not a "no", only an explicit false is.
          setWritable(data.writable !== false)
        } catch (error) {
          if (seq === loadSeq.current) setLoadError(error.message)
        } finally {
          if (seq === loadSeq.current) setLoading(false)
        }
      }, [alias])

      React.useEffect(() => {
        loadDir(typeof defaultPath === 'string' && defaultPath !== '' ? defaultPath : null)
      }, [loadDir, defaultPath])

      const handleEntry = (entry) => {
        if (path == null) return
        loadDir(path === '/' ? `/${entry.name}` : `${path}/${entry.name}`)
      }

      const handleUp = () => {
        if (path == null || path === '/') return
        const idx = path.lastIndexOf('/')
        loadDir(idx <= 0 ? '/' : path.slice(0, idx))
      }

      // The name the server will derive, shown so the user is not surprised by
      // a generated label (there is no field to type one into).
      const previewName = (() => {
        if (path == null || alias === '') return ''
        const trimmed = path.replace(/\/+$/u, '')
        const base = trimmed.slice(trimmed.lastIndexOf('/') + 1)
        return base === '' ? alias : `${base} · ${alias}`
      })()

      const save = async () => {
        if (path == null) return
        setSaving(true)
        setSaveError(null)
        try {
          const result = await fetchJson(API.floatingSave, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              parentId: state.parentId,
              parentPath: state.parentPath,
              alias,
              remotePath: path,
            }),
          })
          const saved = result?.item
          notifyUser(t('float.saved', { name: saved?.title ?? previewName }), 'ok')
          await refreshFloatingEntries({ force: true })
          closeFloatingDialog()
        } catch (error) {
          setSaveError(t('float.saveFail', { msg: error.message }))
          setSaving(false)
        }
      }

      const saveDisabled = saving || alias === '' || path == null || loading || loadError != null || !writable
      const dismissBackdrop = () => { if (!saving) closeFloatingDialog() }

      return jsxs('div', { className: 'sshwsp-backdrop', ...backdropDismiss(dismissBackdrop), children: [
        jsxs('div', { className: 'sshwsp-dialog', onClick: (e) => e.stopPropagation(), children: [
          jsxs('div', { className: 'sshwsp-dlg-head', children: [
            jsx('h2', { children: t('float.addTitle', { name: state.parentTitle !== '' ? state.parentTitle : state.parentId }) }),
            jsx('button', {
              className: 'sshwsp-icon-btn',
              'aria-label': t('dialog.close'),
              onClick: () => { if (!saving) closeFloatingDialog() },
              children: React.createElement(CloseIcon, { size: 14 }),
            }),
          ]}),
          jsxs('div', { className: 'sshwsp-dialog-body', children: [
            jsxs('div', { className: 'sshwsp-form', children: [
              jsx('div', { className: 'sshwsp-field', children:
                jsx('span', { className: 'sshwsp-field-hint', children: t('float.addHint') }),
              }),
              jsxs('div', { className: 'sshwsp-field', children: [
                jsx('span', { className: 'sshwsp-field-label', children: t('float.host') }),
                jsx('select', {
                  className: 'sshwsp-input sshwsp-select',
                  value: alias,
                  disabled: hosts == null || saving,
                  onChange: (e) => setAlias(e.target.value),
                  children: (hosts ?? []).map((host) => jsx('option', { key: host.alias, value: host.alias, children: host.alias })),
                }),
              ]}),
              jsxs('div', { className: 'sshwsp-field', children: [
                jsx('span', { className: 'sshwsp-field-label', children: t('float.dir') }),
                jsxs('div', { className: 'sshwsp-pathbar', children: [
                  jsx('button', {
                    className: 'sshwsp-icon-btn',
                    'aria-label': t('float.up'),
                    disabled: path == null || path === '/' || saving,
                    onClick: handleUp,
                    children: React.createElement(ArrowLeftIcon, { size: 14 }),
                  }),
                  path == null
                    ? jsx('span', { className: 'sshwsp-pathbar-path', children: '…' })
                    : jsx(PathBreadcrumb, { path, disabled: saving, label: t('path.crumbs'), onNavigate: loadDir }),
                ]}),
              ]}),
              previewName !== '' && jsx('div', { className: 'sshwsp-field', children:
                jsx('span', { className: 'sshwsp-field-hint', children: previewName }),
              }),
            ]}),
            // Same wording and position as `RemoteWorkspaceDialog`: the verdict
            // belongs to a resolved listing, so loading and error states show
            // neither this warning nor a guess about writability.
            path != null && !loading && loadError == null && !writable && jsx('div', { className: 'sshwsp-warn', children: t('remote.notWritable') }),
            saveError != null && jsx('div', { className: 'sshwsp-warn', children: saveError }),
            jsx('div', { className: 'sshwsp-dirlist', children:
              hostsError != null
                ? jsx('div', { className: 'sshwsp-empty', children: t('float.hostsFail', { msg: hostsError }) })
                : hosts != null && hosts.length === 0
                  ? jsx('div', { className: 'sshwsp-empty', children: t('float.noHosts') })
                  : loading
                    ? jsx('div', { className: 'sshwsp-empty', children: t('float.loading') })
                    : loadError != null
                      ? jsx('div', { className: 'sshwsp-empty', children: t('float.loadError', { msg: loadError }) })
                      : (entries?.length ?? 0) === 0
                        ? jsx('div', { className: 'sshwsp-empty', children: t('float.emptyDir') })
                        : entries.map((entry) =>
                            jsxs('button', {
                              key: entry.name,
                              type: 'button',
                              className: 'sshwsp-entry',
                              disabled: saving,
                              onClick: () => handleEntry(entry),
                              children: [
                                jsx('span', { className: 'sshwsp-entry-icon', children: React.createElement(FolderIcon) }),
                                jsx('span', { className: 'sshwsp-entry-name', children: entry.name }),
                              ],
                            })
                          )
            }),
          ]}),
          jsxs('div', { className: 'sshwsp-dialog-footer', children: [
            jsx('button', { className: 'sshwsp-btn', disabled: saving, onClick: () => closeFloatingDialog(), children: t('float.cancel') }),
            jsx('button', {
              className: 'sshwsp-btn sshwsp-btn-primary',
              disabled: saveDisabled,
              onClick: save,
              children: saving ? t('float.saving') : t('float.save'),
            }),
          ]}),
        ]}),
      ]})
    }

    /**
     * Manage one project's floating remotes: rename, reorder, test, delete
     * (optionally deregistering the DSH workspace), and clean up broken entries.
     *
     * The row order is the stored `order`; moving a row POSTs the whole id list
     * back so two rows never end up sharing a position.
     */
    function FloatingManageDialog ({ t, state }) {
      const [items, setItems] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [confirmId, setConfirmId] = React.useState(null)
      const [deregister, setDeregister] = React.useState(false)

      const reload = React.useCallback(async () => {
        try {
          const data = await fetchJson(`${API.floatingList}?parentId=${encodeURIComponent(state.parentId)}`)
          setItems(Array.isArray(data?.items) ? data.items : [])
          setError(null)
        } catch (err) {
          setError(err.message)
        }
      }, [state.parentId])

      React.useEffect(() => { void reload() }, [reload])

      const rename = async (item, title) => {
        const next = String(title ?? '').trim()
        if (next === '' || next === item.title) return
        setBusy(`rename:${item.id}`)
        try {
          await fetchJson(API.floatingUpdate, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: item.id, title: next }),
          })
          await reload()
          await refreshFloatingEntries({ force: true })
        } catch (err) {
          notifyUser(t('float.renameFail', { msg: err.message }), 'err')
        } finally {
          setBusy('')
        }
      }

      const move = async (item, delta) => {
        const ids = (items ?? []).map((entry) => entry.id)
        const from = ids.indexOf(item.id)
        const to = from + delta
        if (from < 0 || to < 0 || to >= ids.length) return
        ids.splice(to, 0, ids.splice(from, 1)[0])
        setBusy('reorder')
        try {
          await fetchJson(API.floatingReorder, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ parentId: state.parentId, ids }),
          })
          await reload()
          await refreshFloatingEntries({ force: true })
        } catch (err) {
          notifyUser(t('float.reorderFail', { msg: err.message }), 'err')
        } finally {
          setBusy('')
        }
      }

      const test = async (item) => {
        setBusy(`test:${item.id}`)
        try {
          const result = await fetchJson(API.test, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ alias: item.alias }),
          })
          if (result?.ok === false) throw new Error(result.error ?? 'unknown')
          notifyUser(t('float.testOk', { ms: result?.durationMs ?? 0 }), 'ok')
        } catch (err) {
          notifyUser(t('float.testFail', { msg: err.message }), 'err')
        } finally {
          setBusy('')
        }
      }

      const remove = async (item) => {
        setBusy(`delete:${item.id}`)
        try {
          await fetchJson(API.floatingDelete, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: item.id, deregister }),
          })
          if (floatingActive !== null && floatingActive.id === item.id) exitFloating()
          setConfirmId(null)
          setDeregister(false)
          await reload()
          await refreshFloatingEntries({ force: true })
        } catch (err) {
          notifyUser(t('float.deleteFail', { msg: err.message }), 'err')
        } finally {
          setBusy('')
        }
      }

      const prune = async () => {
        const broken = (items ?? []).filter((item) => item.hostMissing === true || item.parentMissing === true)
        if (broken.length === 0) {
          notifyUser(t('float.pruneNone'), 'ok')
          return
        }
        setBusy('prune')
        try {
          for (const item of broken) {
            await fetchJson(API.floatingDelete, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: item.id }),
            })
          }
          notifyUser(t('float.pruned', { n: broken.length }), 'ok')
          await reload()
          await refreshFloatingEntries({ force: true })
        } catch (err) {
          notifyUser(t('float.deleteFail', { msg: err.message }), 'err')
        } finally {
          setBusy('')
        }
      }

      const stateOf = (item) => {
        if (item.hostMissing === true) return { text: t('float.hostMissing'), cls: 'is-bad' }
        if (item.parentMissing === true) return { text: t('float.parentMissing'), cls: 'is-bad' }
        if (item.mounted === true) return { text: t('float.stateMounted'), cls: 'is-on' }
        if (item.registered === true) return { text: t('float.registered'), cls: '' }
        return { text: t('float.stateUnmounted'), cls: '' }
      }

      const busyAny = busy !== ''

      return jsxs('div', { className: 'sshwsp-backdrop', ...backdropDismiss(() => { if (!busyAny) closeFloatingDialog() }), children: [
        jsxs('div', { className: 'sshwsp-dialog', onClick: (e) => e.stopPropagation(), children: [
          jsxs('div', { className: 'sshwsp-dlg-head', children: [
            jsx('h2', { children: t('float.manageTitle', { name: state.parentTitle !== '' ? state.parentTitle : state.parentId }) }),
            jsx('button', {
              className: 'sshwsp-icon-btn',
              'aria-label': t('dialog.close'),
              onClick: () => { if (!busyAny) closeFloatingDialog() },
              children: React.createElement(CloseIcon, { size: 14 }),
            }),
          ]}),
          jsxs('div', { className: 'sshwsp-dialog-body', children: [
            jsxs('div', { className: 'sshwsp-form', children: [
              jsx('div', { className: 'sshwsp-field', children:
                jsx('span', { className: 'sshwsp-field-hint', children: t('float.manageHint') }),
              }),
            ]}),
            error != null && jsx('div', { className: 'sshwsp-warn', children: error }),
            jsx('div', { className: 'sshwsp-float-list', children:
              items == null
                ? jsx('div', { className: 'sshwsp-empty', children: t('float.loading') })
                : items.length === 0
                  ? jsx('div', { className: 'sshwsp-empty', children: t('float.manageEmpty') })
                  : items.map((item, index) => {
                      const status = stateOf(item)
                      const confirming = confirmId === item.id
                      return jsxs('div', { className: 'sshwsp-float-row', children: [
                        jsxs('div', { className: 'sshwsp-float-row-head', children: [
                          jsx('input', {
                            className: 'sshwsp-input sshwsp-float-row-name',
                            defaultValue: item.title,
                            'aria-label': `${t('float.rename')} — ${item.title}`,
                            disabled: busyAny,
                            onBlur: (event) => { void rename(item, event.target.value) },
                            onKeyDown: (event) => {
                              if (event.key === 'Enter') event.target.blur()
                            },
                          }),
                          jsx('span', { className: `sshwsp-float-state ${status.cls}`.trim(), children: status.text }),
                        ]}),
                        jsx('div', { className: 'sshwsp-float-row-meta', children:
                          `${typeof item.hostAddr === 'string' && item.hostAddr !== '' ? item.hostAddr : item.alias} · ${item.workspacePath}`,
                        }),
                        jsxs('div', { className: 'sshwsp-float-row-actions', children: [
                          jsx('button', {
                            className: 'sshwsp-btn',
                            disabled: busyAny || index === 0,
                            onClick: () => { void move(item, -1) },
                            children: t('float.moveUp'),
                          }),
                          jsx('button', {
                            className: 'sshwsp-btn',
                            disabled: busyAny || index === items.length - 1,
                            onClick: () => { void move(item, 1) },
                            children: t('float.moveDown'),
                          }),
                          jsx('button', {
                            className: 'sshwsp-btn',
                            disabled: busyAny || item.hostMissing === true,
                            onClick: () => { void test(item) },
                            children: busy === `test:${item.id}` ? t('float.testing') : t('float.test'),
                          }),
                          jsx('button', {
                            className: 'sshwsp-btn sshwsp-btn-danger',
                            disabled: busyAny,
                            onClick: () => {
                              setConfirmId(confirming ? null : item.id)
                              setDeregister(false)
                            },
                            children: t('float.delete'),
                          }),
                        ]}),
                        confirming && jsxs('div', { className: 'sshwsp-float-confirm', children: [
                          jsx('div', { className: 'sshwsp-float-confirm-line', children: t('float.deleteDesc') }),
                          jsxs('label', { className: 'sshwsp-float-confirm-line', children: [
                            jsx('input', {
                              type: 'checkbox',
                              checked: deregister,
                              disabled: busyAny,
                              onChange: (event) => setDeregister(event.target.checked),
                            }),
                            jsx('span', { children: t('float.deleteDeregister') }),
                          ]}),
                          jsxs('div', { className: 'sshwsp-float-confirm-line', children: [
                            jsx('button', {
                              className: 'sshwsp-btn',
                              disabled: busyAny,
                              onClick: () => { setConfirmId(null); setDeregister(false) },
                              children: t('float.cancel'),
                            }),
                            jsx('button', {
                              className: 'sshwsp-btn sshwsp-btn-danger',
                              disabled: busyAny,
                              onClick: () => { void remove(item) },
                              children: t('float.deleteConfirm'),
                            }),
                          ]}),
                        ]}),
                      ]})
                    })
            }),
          ]}),
          jsxs('div', { className: 'sshwsp-dialog-footer', children: [
            jsx('button', {
              className: 'sshwsp-btn',
              disabled: busyAny || items == null || items.length === 0,
              onClick: () => { void prune() },
              children: t('float.prune'),
            }),
            jsx('button', { className: 'sshwsp-btn', disabled: busyAny, onClick: () => closeFloatingDialog(), children: t('dialog.close') }),
          ]}),
        ]}),
      ]})
    }

    /** The single overlay-slot component: renders whichever dialog is open. */
    function FloatingWorkspaceDialogs ({ t }) {
      const state = useFloatingDialog()
      if (state === null) return null
      return state.kind === 'add'
        ? jsx(FloatingAddDialog, { t, state })
        : jsx(FloatingManageDialog, { t, state })
    }

    /**
     * Install every floating-workspace piece: the menu injection, the display
     * decoration (row hiding + card), and the auto-enter / exit click bridge.
     *
     * @param {object} ctx - the client root context.
     * @returns {() => void} the disposer (observed by `ctx.effect`).
     */
    function installFloatingWorkspaces (ctx) {
      floatingCtx = ctx
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
      const detachMenu = installFloatingMenu()
      void refreshFloatingEntries()

      /**
       * Click bridge: opening a session that belongs to a floating workspace
       * enters its floating view (its row is hidden otherwise, so the sidebar
       * would show nothing at all); opening any other session or workspace row
       * leaves the floating view.
       */
      const onCaptureClick = (event) => {
        const target = event.target
        if (target === null || typeof target.closest !== 'function') return
        if (target.closest(`[${FLOAT_ITEM_ATTR}]`) !== null) return
        const row = target.closest('[data-row-key]')
        if (row === null) return
        const key = row.getAttribute('data-row-key') ?? ''
        if (key.startsWith('session:')) {
          const sessionId = key.slice('session:'.length)
          const entry = floatingEntryForSession(sessionId)
          if (entry !== undefined) {
            if (floatingActive === null || floatingActive.id !== entry.id) enterFloating(entry)
            return
          }
          if (floatingActive !== null) exitFloating()
          return
        }
        if (key.startsWith('workspace:')) {
          const id = key.slice('workspace:'.length)
          if (floatingActive !== null && id !== floatingActive.workspaceId) exitFloating()
        }
      }

      const observer = new MutationObserver((records) => {
        if (records.some(mutationTouchesMarks)) scheduleFloatingDisplay()
      })
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      document.addEventListener('click', onCaptureClick, true)
      scheduleFloatingDisplay()

      return () => {
        detachMenu()
        document.removeEventListener('click', onCaptureClick, true)
        observer.disconnect()
        closeFloatingSubmenu()
        closeFloatingDialog()
        removeFloatingChrome()
        for (const node of document.querySelectorAll(`[${FLOAT_HIDDEN_ATTR}]`)) node.removeAttribute(FLOAT_HIDDEN_ATTR)
        // A toast raised by this feature must not outlive it.
        for (const toast of document.querySelectorAll('[data-sshwsp-toast]')) toast.remove()
      }
    }


    // =========================================================================
    // Composer file bridge (drag / right-click → @ reference)
    // =========================================================================
    // The file tree is DSH-owned DOM with no seat for plugin gestures, so drag
    // and right-click ride on delegated listeners: the marks pass flags
    // referenceable rows as drag sources, a drag carries only the custom MIME
    // below (never `text/plain`, so no editor double-inserts), and right-click
    // opens a plugin menu over the row. A reference is inserted exactly the way
    // the @ picker inserts one — through the session's `insert-reference`
    // event, with a span from the composer's own action face — so the chip,
    // its serialization, and its invalidation all behave as a picked mention.

    const DRAG_MIME = 'application/x-dsh-ssh-workspace-file'
    const TREE_ROW_SELECTOR = '[data-files-entry][data-files-path]'
    const COMPOSER_CARD_SELECTOR = '[data-composer-card]'
    const TASK_MENU_ATTR = 'data-sshwsp-taskmenu'

    /** Referenceable kind of one tree row (`file` | `directory`), or null. */
    function rowReferenceKind (row) {
      const kind = row.getAttribute('data-files-entry')
      return kind === 'file' || kind === 'directory' ? kind : null
    }

    /** The tree's workspace root as its own element reports it (session cwd). */
    function treeRootOf (row) {
      const value = row.closest('[data-files-state="tree"]')?.getAttribute('data-files-root')
      return value != null && value !== '' ? value : null
    }

    /** Slash-normalized, trailing-slash-free spelling used to compare roots. */
    function normalizeRoot (value) {
      return typeof value === 'string' ? value.replace(/\\/g, '/').replace(/\/+$/, '') : ''
    }

    /**
     * The @ token for one tree path: relative to `root`, `/`-separated, quoted
     * with the editor grammar's own rules. Returns null for a path the grammar
     * cannot represent.
     */
    function mentionToken (absPath, root, isDir) {
      let value = absPath.replace(/\\/g, '/')
      const base = normalizeRoot(root)
      if (base !== '' && value.startsWith(`${base}/`)) value = value.slice(base.length + 1)
      if (value === '') return null
      if (isDir) value += '/'
      if (/[\u0000-\u001f\u007f-\u009f"]/u.test(value)) return null
      if (!/\s/u.test(value)) return `@${value}`
      return isDir ? `@"${value}` : `@"${value}"`
    }

    /** The chip insert payload the @ picker would build for this path. */
    function referenceFor (absPath, mention, isDir) {
      const cut = absPath.replace(/[/\\]+$/, '')
      const slash = Math.max(cut.lastIndexOf('/'), cut.lastIndexOf('\\'))
      const name = cut.slice(slash + 1)
      return {
        source: 'reference',
        ref: mention,
        label: isDir ? `${name}/` : name,
        appearance: isDir ? 'folder' : 'file',
        clipboardText: mention,
      }
    }

    /** The main session's composer face: its action channel and session scope. */
    function resolveComposerTarget (ctx) {
      try {
        const value = ctx.get?.('uiSession')?.adapter?.current?.getSnapshot?.()
        const actions = value?.props?.inputActions
        const actx = value?.ctx
        if (actions == null || actx == null) return null
        return { actions, actx, sessionId: value.key }
      } catch {
        return null
      }
    }

    /** The composer session's workspace root, when the sessions store answers. */
    function readComposerRoot (ctx, sessionId) {
      try {
        const byId = ctx.get?.('sessions')?.list?.getSnapshot?.()?.byId
        const cwd = sessionId === undefined || sessionId === null ? undefined : byId?.[sessionId]?.cwd
        return typeof cwd === 'string' ? cwd : null
      } catch {
        return null
      }
    }

    /**
     * Insert one tree path as an @ reference into the main composer. Follows
     * the pick path (`slash/input-insert-reference` with a pick-time span) and
     * degrades to plain text through the same action face when no listener
     * claims it.
     */
    function addPathToTask (ctx, absPath, isDir, root) {
      const target = resolveComposerTarget(ctx)
      if (target === null) {
        notifyUser(translate('mention.noComposer'), 'err')
        return false
      }
      // Relative only when the tree stands on the composer's own root; any
      // other spelling stays absolute, which the Host resolves as it stands.
      const rootKey = normalizeRoot(root)
      const base = rootKey !== '' && rootKey === normalizeRoot(readComposerRoot(ctx, target.sessionId)) ? root : null
      const mention = mentionToken(absPath, base, isDir)
      if (mention === null) {
        notifyUser(translate('mention.unrepresentable'), 'err')
        return false
      }
      const reference = referenceFor(absPath, mention, isDir)
      let applied = false
      try {
        const span = target.actions.captureInsertion()
        applied = target.actx.bail(target.actx, 'slash/input-insert-reference', { reference, span }) === true
      } catch {
        applied = false
      }
      if (!applied) {
        try {
          const span = target.actions.captureInsertion()
          applied = target.actions.insertText(`${mention} `, span) !== false
        } catch {
          applied = false
        }
      }
      if (!applied) {
        notifyUser(translate('mention.insertFail'), 'err')
        return false
      }
      focusSoleComposer()
      return true
    }

    /** Best-effort focus of the single visible composer after an insert. */
    function focusSoleComposer () {
      try {
        const cards = [...document.querySelectorAll(COMPOSER_CARD_SELECTOR)].filter((card) => {
          const rect = card.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        })
        if (cards.length !== 1) return
        const input = cards[0].querySelector('[data-composer-input]')
        if (input == null) return
        input.focus({ preventScroll: true })
        // Lexical restores its stored selection (the chip's tail); the bare DOM
        // focus above alone would leave the caret at the document start.
        input.__lexicalEditor?.focus()
      } catch { /* best-effort */ }
    }

    let domToastTimer = null

    /** Toast for gestures with no React surface to report through. */
    function notifyUser (text, kind) {
      if (typeof document === 'undefined' || text == null) return
      for (const stale of document.querySelectorAll('.sshwsp-toast[data-sshwsp-toast]')) stale.remove()
      const el = document.createElement('div')
      el.setAttribute('data-sshwsp-toast', '1')
      el.className = `sshwsp-toast ${kind === 'ok' ? 'sshwsp-toast-ok' : 'sshwsp-toast-err'}`
      el.setAttribute('role', 'status')
      el.textContent = text
      el.addEventListener('click', () => el.remove())
      document.body.appendChild(el)
      clearTimeout(domToastTimer)
      domToastTimer = setTimeout(() => el.remove(), 3500)
    }

    // =========================================================================
    // Transfers from DSH's own file tree
    // =========================================================================
    //
    // The panel dialog above carries upload/download for the directories it
    // browses, but the files users actually work with are listed by DSH's own
    // "Files" panel, whose rows this plugin already hooks for @ references.
    // These helpers give those rows the same two transfers, so a remote file is
    // never left without a way in or out.

    /**
     * Split a tree row's `ssh://alias/abs/path` into its parts, or null.
     *
     * Mirrors `parseRemotePath` in protocol.js. That module is Node-side and is
     * not in the browser bundle's `require` set, so the grammar is restated here
     * — the same one the row attributes are written with, so the two cannot
     * disagree about what a remote path looks like.
     */
    function remoteTargetOf (absPath) {
      if (typeof absPath !== 'string' || !absPath.startsWith('ssh://')) return null
      const match = /^ssh:\/\/([^/]+)(\/.*)$/u.exec(absPath)
      if (match === null) return null
      const [, rawAlias, rawPath] = match
      const segments = []
      for (const segment of rawPath.split('/')) {
        if (segment === '' || segment === '.') continue
        if (segment === '..') {
          segments.pop()
          continue
        }
        segments.push(segment)
      }
      return { alias: rawAlias, remotePath: `/${segments.join('/')}` }
    }

    /** POSIX dirname of a remote absolute path. */
    function remoteDirOf (remotePath) {
      const cut = remotePath.replace(/\/+$/u, '').lastIndexOf('/')
      return cut <= 0 ? '/' : remotePath.slice(0, cut)
    }

    /** Save a fetched blob under `name` through the browser's download flow. */
    function saveBlob (blob, name) {
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = name
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    }

    /**
     * Pull one remote tree row down to this machine.
     *
     * The route streams raw bytes (see `ROUTES.download`), so the blob is
     * assembled without the base64 penalty a JSON answer would pay, and the
     * bytes never travel through the model.
     */
    async function downloadTreeRow (absPath) {
      const parts = remoteTargetOf(absPath)
      if (parts === null) {
        notifyUser(translate('transfer.notRemote'), 'err')
        return
      }
      const name = parts.remotePath.replace(/\/+$/u, '').split('/').pop() ?? ''
      const label = name === '' ? parts.remotePath : name
      notifyUser(translate('transfer.downloading', { name: label }), 'ok')
      try {
        const query = `?alias=${encodeURIComponent(parts.alias)}&path=${encodeURIComponent(parts.remotePath)}`
        const response = await fetch(`${API.download}${query}`)
        if (!response.ok) {
          const text = await response.text().catch(() => '')
          let message = text || `download failed (${response.status})`
          try {
            const parsed = JSON.parse(text)
            if (typeof parsed?.error === 'string' && parsed.error !== '') message = parsed.error
          } catch { /* not JSON */ }
          throw new Error(message)
        }
        saveBlob(await response.blob(), label)
      } catch (err) {
        notifyUser(`${translate('transfer.downloadFail')}: ${err.message}`, 'err')
      }
    }

    /**
     * Send one local file into the directory that holds `absPath`.
     *
     * Uploads land beside the row the user invoked it on. A directory row is
     * its own destination; a file row means its parent, which is what the user
     * is looking at.
     */
    function uploadTreeRow (absPath, isDir) {
      const parts = remoteTargetOf(absPath)
      if (parts === null) {
        notifyUser(translate('transfer.notRemote'), 'err')
        return
      }
      const dir = isDir ? parts.remotePath : remoteDirOf(parts.remotePath)
      const input = document.createElement('input')
      input.type = 'file'
      input.style.display = 'none'
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        input.remove()
        if (file === undefined || file === null) return
        void sendTreeUpload(parts.alias, dir, file)
      }, { once: true })
      document.body.appendChild(input)
      input.value = ''
      input.click()
    }

    /** POST one file's bytes to `dir` on `alias`, then report the outcome. */
    async function sendTreeUpload (alias, dir, file) {
      notifyUser(translate('transfer.uploadingName', { name: file.name }), 'ok')
      try {
        const query = `?alias=${encodeURIComponent(alias)}&path=${encodeURIComponent(dir)}&name=${encodeURIComponent(file.name)}`
        const response = await fetch(`${API.upload}${query}`, {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: file,
        })
        const text = await response.text().catch(() => '')
        let parsed
        try { parsed = JSON.parse(text) } catch { /* not JSON */ }
        if (!response.ok || parsed?.ok !== true) {
          throw new Error(parsed?.error ?? (text || `upload failed (${response.status})`))
        }
        notifyUser(translate('transfer.uploadOk', { name: file.name }), 'ok')
        // The listing belongs to DSH's own panel; nudge it to re-read rather
        // than claiming the new file is on screen.
        refreshFilesPanel()
      } catch (err) {
        notifyUser(`${translate('transfer.uploadFail')}: ${err.message}`, 'err')
      }
    }

    /**
     * Ask DSH's file panel to re-list after an out-of-band write.
     *
     * Its own reload control carries `data-files-reload`; clicking it keeps the
     * listing authoritative instead of this plugin re-implementing a re-read.
     * The sibling `data-files-auto-refresh` button must NOT be used — that one
     * toggles auto-refresh and would silently turn a panel setting off.
     */
    function refreshFilesPanel () {
      try {
        for (const button of document.querySelectorAll('[data-files-reload]')) {
          if (button instanceof HTMLElement) button.click()
        }
      } catch { /* decoration must never break the app */ }
    }

    // =========================================================================
    // File-panel header actions
    // =========================================================================

    /**
     * Upload control for DSH's own "Files" panel header.
     *
     * The slot passes `absolutePath`, the directory currently listed, so the
     * upload lands exactly where the user is looking. When that directory is
     * not a remote target the component renders nothing at all — a local
     * listing has no other side to send bytes to, and a dead control there
     * would misstate what the panel can do.
     *
     * Only upload lives here: the header always names a *directory*, and a
     * directory cannot be pulled down as one file. Download is offered per
     * file in the row menu, where the target is unambiguous.
     */
    function FilePanelTransferActions (props) {
      const absolutePath = typeof props?.absolutePath === 'string' ? props.absolutePath : ''
      const t = props?.t ?? translate
      const remote = remoteTargetOf(absolutePath)
      // Hooks must run unconditionally, so the state is declared before the
      // early return; a non-remote listing simply renders nothing.
      const [busy, setBusy] = React.useState(false)
      if (remote === null) return null

      const pickAndUpload = () => {
        if (busy) return
        const input = document.createElement('input')
        input.type = 'file'
        input.style.display = 'none'
        input.addEventListener('change', () => {
          const file = input.files?.[0]
          input.remove()
          if (file === undefined || file === null) return
          setBusy(true)
          void sendTreeUpload(remote.alias, remote.remotePath, file).finally(() => setBusy(false))
        }, { once: true })
        document.body.appendChild(input)
        input.value = ''
        input.click()
      }

      return jsx('button', {
        type: 'button',
        className: 'sshwsp-fileaction',
        disabled: busy,
        title: t('transfer.upload'),
        'aria-label': t('transfer.upload'),
        onClick: pickAndUpload,
        children: busy ? t('transfer.uploading') : t('transfer.upload'),
      })
    }

    let taskMenuEl = null
    let taskMenuDispose = null

    /** Tear the row menu down and detach its listeners. */
    function closeTaskMenu () {
      if (taskMenuEl !== null) {
        taskMenuEl.remove()
        taskMenuEl = null
      }
      if (taskMenuDispose !== null) {
        taskMenuDispose()
        taskMenuDispose = null
      }
    }

    /** The svg for one menu row, mirroring the page's own folder/file glyphs. */
    function createMenuIcon (isDir) {
      const SVG_NS = 'http://www.w3.org/2000/svg'
      const svg = document.createElementNS(SVG_NS, 'svg')
      svg.setAttribute('viewBox', '0 0 16 16')
      svg.setAttribute('width', '16')
      svg.setAttribute('height', '16')
      svg.setAttribute('fill', 'none')
      svg.setAttribute('stroke', 'currentColor')
      svg.setAttribute('stroke-width', '1.5')
      svg.setAttribute('stroke-linecap', 'round')
      svg.setAttribute('stroke-linejoin', 'round')
      svg.setAttribute('aria-hidden', 'true')
      const paths = isDir
        ? ['M2 4.5v7a1.5 1.5 0 001.5 1.5h9a1.5 1.5 0 001.5-1.5v-5.5A1.5 1.5 0 0012.5 4.5H8L6.5 3H3.5A1.5 1.5 0 002 4.5z']
        : ['M4 2h5.5L13 5.5V13a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z', 'M9.5 2v3.5H13']
      for (const d of paths) {
        const path = document.createElementNS(SVG_NS, 'path')
        path.setAttribute('d', d)
        svg.appendChild(path)
      }
      return svg
    }

    /** A hairline rule between the reference action and the transfer actions. */
    function createMenuSeparator () {
      const rule = document.createElement('div')
      rule.className = 'sshwsp-menusep'
      rule.setAttribute('role', 'separator')
      return rule
    }

    /**
     * One transfer action in the row menu.
     *
     * A disabled row still explains itself: the reason lives in the description
     * rather than disappearing into a tooltip, which is what the panel needs
     * when an action is unavailable for a visible cause (a directory download).
     */
    function createTransferItem ({ label, desc, disabled = false, onSelect }) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'sshwsp-menuitem'
      item.setAttribute('role', 'menuitem')
      if (disabled) item.disabled = true
      const icon = document.createElement('span')
      icon.className = 'sshwsp-menuitem-icon'
      icon.appendChild(createMenuIcon(false))
      const textWrap = document.createElement('span')
      textWrap.className = 'sshwsp-menuitem-text'
      const title = document.createElement('span')
      title.className = 'sshwsp-menuitem-title'
      title.textContent = label
      const description = document.createElement('span')
      description.className = 'sshwsp-menuitem-desc'
      description.textContent = desc
      textWrap.append(title, description)
      item.append(icon, textWrap)
      if (!disabled) {
        item.addEventListener('click', () => {
          closeTaskMenu()
          onSelect()
        })
      }
      return item
    }

    /** Open the row menu at the pointer, clamped to the viewport. */
    function openTaskMenu (ctx, absPath, isDir, root, x, y) {
      closeTaskMenu()
      const mention = mentionToken(absPath, root, isDir)

      const el = document.createElement('div')
      el.className = 'sshwsp-flowmenu'
      el.setAttribute('role', 'menu')
      el.setAttribute(TASK_MENU_ATTR, '1')
      el.style.left = `${Math.min(Math.max(8, x), Math.max(8, window.innerWidth - FLOW_MENU_WIDTH - 8))}px`
      el.style.top = `${Math.min(Math.max(8, y), Math.max(8, window.innerHeight - 120))}px`

      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'sshwsp-menuitem'
      item.setAttribute('role', 'menuitem')
      if (mention === null) item.disabled = true

      const icon = document.createElement('span')
      icon.className = 'sshwsp-menuitem-icon'
      icon.appendChild(createMenuIcon(isDir))
      const textWrap = document.createElement('span')
      textWrap.className = 'sshwsp-menuitem-text'
      const title = document.createElement('span')
      title.className = 'sshwsp-menuitem-title'
      title.textContent = translate('mention.addToTask')
      const desc = document.createElement('span')
      desc.className = 'sshwsp-menuitem-desc'
      desc.textContent = mention ?? translate('mention.unrepresentable')
      textWrap.append(title, desc)
      item.append(icon, textWrap)
      item.addEventListener('click', () => {
        closeTaskMenu()
        addPathToTask(ctx, absPath, isDir, root)
      })
      el.appendChild(item)

      // Transfers: only for rows that actually name a remote target. The same
      // panel can show a local workspace, where these routes have nothing to
      // talk to — offering the items there would promise a capability the row
      // does not have.
      const remote = remoteTargetOf(absPath)
      if (remote !== null) {
        el.appendChild(createMenuSeparator())
        el.appendChild(createTransferItem({
          label: translate('transfer.download'),
          desc: isDir ? translate('transfer.downloadDirUnsupported') : absPath,
          disabled: isDir,
          onSelect: () => { void downloadTreeRow(absPath) },
        }))
        el.appendChild(createTransferItem({
          label: translate('transfer.upload'),
          desc: isDir ? absPath : remoteDirOf(absPath),
          onSelect: () => uploadTreeRow(absPath, isDir),
        }))
      }

      document.body.appendChild(el)
      taskMenuEl = el

      const onDown = (event) => {
        const target = event.target
        if (target instanceof Node && el.contains(target)) return
        closeTaskMenu()
      }
      const onKey = (event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        closeTaskMenu()
      }
      const onDisplace = () => closeTaskMenu()
      document.addEventListener('mousedown', onDown, true)
      document.addEventListener('keydown', onKey, true)
      document.addEventListener('scroll', onDisplace, true)
      window.addEventListener('resize', onDisplace)
      window.addEventListener('blur', onDisplace)
      taskMenuDispose = () => {
        document.removeEventListener('mousedown', onDown, true)
        document.removeEventListener('keydown', onKey, true)
        document.removeEventListener('scroll', onDisplace, true)
        window.removeEventListener('resize', onDisplace)
        window.removeEventListener('blur', onDisplace)
      }
    }

    let dragPayload = null
    let dropCard = null

    /**
     * Events already handled by an earlier materialization of this bundle.
     *
     * The module loader memoizes factories, but HMR drops the cache entry and
     * runs the body again: a fresh closure, a fresh `composerBridgesInstalled`,
     * and a second set of listeners on the same `document`. The old ones are
     * not collected with the old closure, so a single drop would be consumed
     * once per past materialization — observed as a composer filling with the
     * same chip a couple of dozen times.
     *
     * It therefore CANNOT live in this closure, which is exactly what gets
     * replaced. It is parked on the global under a namespaced key so every
     * materialization shares one set, and it is keyed on the event object —
     * the same instance reaches every listener, and the entry dies with the
     * event, so nothing leaks and no unmount bookkeeping is needed.
     */
    const GESTURE_CLAIMS_KEY = '__dshSshWorkspaceGestureClaims__'
    const handledGestures = (() => {
      if (typeof WeakSet !== 'function') return null
      const scope = typeof globalThis === 'object' && globalThis !== null ? globalThis : null
      if (scope === null) return new WeakSet()
      const existing = scope[GESTURE_CLAIMS_KEY]
      if (existing instanceof WeakSet) return existing
      const created = new WeakSet()
      try {
        Object.defineProperty(scope, GESTURE_CLAIMS_KEY, {
          value: created,
          configurable: true,
          writable: false,
          enumerable: false,
        })
      } catch {
        return created
      }
      return created
    })()

    /** True the first time ANY materialization sees `event`; false afterwards. */
    function firstClaim (event) {
      if (handledGestures === null) return true
      if (handledGestures.has(event)) return false
      handledGestures.add(event)
      return true
    }

    /** Highlight the composer card under a carried path (inline style; React never owns it). */
    function setDropCard (card) {
      if (dropCard === card) return
      if (dropCard !== null) {
        dropCard.style.removeProperty('outline')
        dropCard.style.removeProperty('outline-offset')
      }
      dropCard = card
      if (card !== null) {
        card.style.setProperty('outline', '2px dashed var(--dsw-alias-button-info-fill, #4a9eff)')
        card.style.setProperty('outline-offset', '2px')
      }
    }

    /**
     * Delegated drag listeners: tree rows out, the composer card in.
     *
     * Returns a detach function so `apply`'s disposer can unwind this
     * materialization; the shared claim set additionally covers instances that
     * were replaced without it ever running (HMR, a second window's factory).
     */
    function installTreeDragBridge (ctx) {
      if (typeof document === 'undefined') return () => {}

      const onDragStart = (event) => {
        if (!firstClaim(event)) return
        const target = event.target
        if (!(target instanceof Element)) return
        const row = target.closest(TREE_ROW_SELECTOR)
        const kind = row === null ? null : rowReferenceKind(row)
        if (row === null || kind === null) return
        const path = row.getAttribute('data-files-path')
        if (path === null || path === '') return
        dragPayload = { path, isDir: kind === 'directory', root: treeRootOf(row) }
        const transfer = event.dataTransfer
        if (transfer !== null) {
          transfer.setData(DRAG_MIME, path)
          transfer.effectAllowed = 'copy'
        }
      }

      const onDragOver = (event) => {
        if (!firstClaim(event)) return
        if (dragPayload === null) return
        const target = event.target
        const card = target instanceof Element ? target.closest(COMPOSER_CARD_SELECTOR) : null
        setDropCard(card)
        if (card === null) return
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
      }

      const onDrop = (event) => {
        // Claimed before any state is touched: a stale instance's listener may
        // run first and clear its own payload, but only one materialization
        // gets to insert.
        if (!firstClaim(event)) return
        const payload = dragPayload
        dragPayload = null
        setDropCard(null)
        if (payload === null) return
        const target = event.target
        const card = target instanceof Element ? target.closest(COMPOSER_CARD_SELECTOR) : null
        if (card === null) return
        event.preventDefault()
        event.stopPropagation()
        addPathToTask(ctx, payload.path, payload.isDir, payload.root)
      }

      const onDragEnd = (event) => {
        // Not claimed: every instance must clear its own carried payload, and
        // clearing is idempotent.
        dragPayload = null
        setDropCard(null)
      }

      document.addEventListener('dragstart', onDragStart, true)
      document.addEventListener('dragover', onDragOver, true)
      document.addEventListener('drop', onDrop, true)
      document.addEventListener('dragend', onDragEnd, true)

      return () => {
        document.removeEventListener('dragstart', onDragStart, true)
        document.removeEventListener('dragover', onDragOver, true)
        document.removeEventListener('drop', onDrop, true)
        document.removeEventListener('dragend', onDragEnd, true)
      }
    }

    /** Delegated right-click listener: the row menu. Returns a detach function. */
    function installTreeMenuBridge (ctx) {
      if (typeof document === 'undefined') return () => {}
      const onContextMenu = (event) => {
        if (!firstClaim(event)) return
        const target = event.target
        if (!(target instanceof Element)) return
        if (target.closest(`[${TASK_MENU_ATTR}]`) !== null) {
          closeTaskMenu()
          return
        }
        const row = target.closest(TREE_ROW_SELECTOR)
        const kind = row === null ? null : rowReferenceKind(row)
        if (row === null || kind === null) return
        const path = row.getAttribute('data-files-path')
        if (path === null || path === '') return
        event.preventDefault()
        event.stopPropagation()
        openTaskMenu(ctx, path, kind === 'directory', treeRootOf(row), event.clientX, event.clientY)
      }
      document.addEventListener('contextmenu', onContextMenu, true)
      return () => document.removeEventListener('contextmenu', onContextMenu, true)
    }

    let composerBridgesInstalled = false

    /**
     * Install the delegated drag / right-click gestures once per module body.
     *
     * The flag only guards repeat calls inside ONE materialization; a reloaded
     * module body gets a fresh flag, which is why the handlers also consult the
     * shared claim set. The returned disposer detaches this materialization.
     */
    function installComposerBridges (ctx) {
      if (composerBridgesInstalled) return () => {}
      composerBridgesInstalled = true
      const disposers = [installTreeDragBridge(ctx), installTreeMenuBridge(ctx)]
      return () => {
        for (const dispose of disposers) {
          try { dispose() } catch { /* detach is best-effort */ }
        }
      }
    }

    // =========================================================================
    // Plugin apply
    // =========================================================================
    const PANEL_ID = 'ssh-workspace'
    const PANEL_ORDER = 45

    let translate = makeTranslate(zh)

    // Cordis guards every undeclared property read on the apply context
    // (`cannot get property … without inject` — an optional chain does not
    // help, the getter itself throws), so every face this module touches must
    // be declared here. `remote`/`remote.directoryPicker` back the browse
    // fallback: the same apply ctx flows into makeLocalPicker (through
    // flowInject) and into LocalDirectoryBrowser (through flowCtx), so one
    // declaration covers all three access points.
    const inject = ['slots', 'locale', 'remote', 'remote.directoryPicker']

    function apply (ctx) {
      injectStyles()
      trackTriggerRects()
      installRemoteWorkspaceMarks(ctx)
      flowCtx = ctx
      const detachBridges = installComposerBridges(ctx)
      // Floating remote workspaces: the ⋯ menu injection, the floating card and
      // the dialogs. Its disposer takes back every observer, listener, marker
      // and node it installed, so an HMR re-apply cannot stack a second copy.
      const detachFloating = installFloatingWorkspaces(ctx)
      refreshRemoteWorkspaceMarks()
      // Non-panel surfaces (sidebar rows, workspace picker, hero chip) never
      // open the panel's /hosts fetch — get the pinned-OS map here instead.
      refreshHostOsMarks()

      // Register locale dictionaries, then bind the host seat for the active
      // language. Placeholder expansion is layered on top: the bound seat is
      // not guaranteed to expand `{name}` across hosts, and a re-apply must
      // not lose it when the namespace is already registered.
      //
      // The registration MUST go through ctx.effect so its disposer runs when
      // this apply instance is torn down. A bare register() leaves the previous
      // instance holding (NS, zh); the next materialize then throws on the
      // duplicate, the catch swallows it, and bind() keeps serving the OLD
      // dictionary — every key added since silently renders as a raw key name.
      // Releasing on teardown makes the re-registration succeed instead.
      const registerDictionaries = () => {
        try {
          return ctx.locale?.register?.(NS, { zh, en }) ?? (() => {})
        } catch {
          return () => {}
        }
      }
      // `ctx.effect` is the documented owner for a disposable side effect, but
      // this plugin targets several host builds; fall back to a direct call so a
      // host without `effect` still gets dictionaries (just without teardown).
      if (typeof ctx.effect === 'function') {
        ctx.effect(registerDictionaries, 'ssh-workspace: locale dictionaries')
      } else {
        registerDictionaries()
      }

      try {
        const bound = ctx.locale?.bind?.(NS)
        if (bound !== undefined) {
          // A bound seat can answer with the key itself when the active
          // language lacks an entry (or when it serves a stale dictionary).
          // Fall back to the local zh table so a missing key degrades to
          // readable Chinese instead of leaking the namespace path into the UI.
          translate = (key, params) => {
            const out = bound(key)
            return out === undefined || out === null || out === key
              ? applyParams(zh[key] ?? key, params)
              : applyParams(out, params)
          }
        }
      } catch { /* locale unavailable — keep the zh fallback */ }

      const slots = ctx.slots

      // Sidebar row.
      slots.inject('sidebar.panellist', () => slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: PANEL_ORDER,
        label: () => translate('entry.label'),
      }, RemoteWorkspaceIcon))

      // Main page.
      slots.inject('main', () => slots.register({
        name: 'main',
        key: PANEL_ID,
        inject: () => ({ translate }),
      }, RemoteWorkspacePage))

      // File-panel header actions. DSH hands this slot `absolutePath` — the
      // directory the panel is showing — so a remote listing gets upload and
      // download right where the files are, without guessing the location.
      slots.inject('sidebar.right.tab.files.actions', () => slots.register({
        name: 'sidebar.right.tab.files.actions',
        id: `${PANEL_ID}-transfers`,
        inject: () => ({ t: translate }),
      }, FilePanelTransferActions))

      // Floating add / manage dialogs. They live in the shell's overlay seat so
      // they open from the workspace ⋯ menu without opening the sidebar panel —
      // an overlay slot is a list, so other plugins' overlays coexist with it.
      slots.inject('shell.overlay', () => slots.register({
        name: 'shell.overlay',
        id: `${PANEL_ID}-floating`,
        inject: () => ({ t: translate }),
      }, FloatingWorkspaceDialogs))

      // Add-workspace flow: shadow the built-in directory pickers so the entry
      // offers a local/remote choice. Registered into both holes through the
      // nested inject pattern — ui-workspace may declare them later or replace
      // their declarations, and `inject` waits for the declaration.
      const flowInject = () => ({ pick: makeLocalPicker(ctx), t: translate })
      slots.inject('conversation.hero.workspace.directoryFlow', () => slots.inject('sidebar.workspaces.directoryFlow', function* () {
        yield slots.register({
          name: 'conversation.hero.workspace.directoryFlow',
          priority: FLOW_PRIORITY,
          inject: flowInject,
        }, AddWorkspaceFlow)
        yield slots.register({
          name: 'sidebar.workspaces.directoryFlow',
          priority: FLOW_PRIORITY,
          inject: flowInject,
        }, AddWorkspaceFlow)
      }))

      // Cordis unmounts a plugin by calling the disposer `apply` returns. The
      // document-level gesture listeners are not owned by any ctx.effect, so
      // without this they would outlive the materialization that installed
      // them and every later one would stack on top.
      return () => {
        detachFloating()
        detachBridges()
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
