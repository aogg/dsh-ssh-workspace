/**
 * Behavioural checks for the auto-injected "local-exec" skill.
 *
 * The skill is the model catalog's answer to "how do I run a command on THIS
 * machine while the session workspace is remote": its payload pins the
 * workdir-routing contract, and its visibility flags keep it out of the Web
 * skill menu while leaving it loadable by the model. Registration is
 * best-effort — a host without a skills service must only warn — and the
 * disposer must unregister and reset the shared verdict sink.
 *
 * These tests drive `lib/local-exec-skill.js` with a stub registry and stub
 * context, so no host framework and no SSH connection are involved. A final
 * section audits the wiring sources (index / routes / client / run.mjs) as
 * text, the way `routes-smoke` audits its bare identifiers — the pieces that
 * cannot be imported without peers still get pinned.
 *
 * Run: node tests/skill-local-exec-smoke.mjs
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
let failures = 0
function check (label, ok, detail) {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

console.log('\n=== local-exec skill smoke ===\n')

const skill = await import(pathToFileURL(path.join(pluginRoot, 'lib/local-exec-skill.js')).href)
const { LOCAL_EXEC_SKILL_NAME, localExecSkillPayload, installLocalExecSkill } = skill

// ---------------------------------------------------------------------------
// The payload: every field the host registry and the panel rely on
// ---------------------------------------------------------------------------
{
  const payload = localExecSkillPayload()

  check('the skill name is "local-exec"', payload.name === 'local-exec')
  check('LOCAL_EXEC_SKILL_NAME agrees with the payload', LOCAL_EXEC_SKILL_NAME === payload.name)
  check('the description is a non-empty string naming the workdir rule',
    typeof payload.description === 'string' && payload.description.includes('workdir'))

  // `source` is REQUIRED by the host's validateDefinition: without it the
  // skill tool fails on every load of the body.
  check('source is "runtime"', payload.source === 'runtime')

  check('whenToUse names a local target ($DSH_HOME)',
    typeof payload.whenToUse === 'string' && payload.whenToUse.includes('$DSH_HOME'))
  check('whenToUse names the DSH web UI (127.0.0.1:3080)',
    payload.whenToUse.includes('127.0.0.1:3080'))
  check('whenToUse covers the remote-tool-missing fallback',
    payload.whenToUse.includes('远端'))

  // The visibility contract: visible to the model's catalog, hidden from the
  // Web skill menu (which filters on userInvocable).
  check('invocation is the exact { modelInvocable: true, userInvocable: false } pair',
    payload.invocation !== null && typeof payload.invocation === 'object'
    && payload.invocation.modelInvocable === true && payload.invocation.userInvocable === false)

  // Body: the outline the task fixed — routing rule, explicit local workdir,
  // channel disambiguation, fences, forwards, mistakes.
  const body = typeof payload.content === 'string' ? payload.content : ''
  check('the body is a non-empty string', body.length > 0)
  check('the body states the workdir routing rule',
    body.includes('workdir') && body.includes('本机'))
  check('the body shows the explicit local-workdir spelling',
    body.includes('workdir: "/tmp"'))
  check('the body notes the remote default (no workdir → remote)',
    body.includes('默认值就是远端'))
  check('the body disambiguates ssh_workspace_exec / ssh_workspace_shell as explicitly remote',
    body.includes('ssh_workspace_exec') && body.includes('ssh_workspace_shell'))
  check('the body covers the glob/grep bridge whitelist (rg + git)',
    body.includes('rg') && body.includes('git'))
  check('the body covers the terminal-cwd rule',
    body.includes('terminal_open'))
  check('the body states read-only refuses remote commands',
    body.includes('read-only'))
  check('the body states local commands keep the local mode fence',
    body.includes('本机') && body.includes('沙箱'))
  check('the body states remote commands run unsandboxed as the remote user',
    body.includes('远端登录用户') && body.includes('sandbox_permissions'))
  check('the body covers the forward direction (remote → local)',
    body.includes('ssh_workspace_forward'))
  check('the body lists the classic mistakes section', body.includes('易错点'))
  check('the body warns against local paths inside remote commands',
    body.includes('远端命令') && body.includes('本机路径'))

  // Two calls produce fresh objects: a caller mutating one payload must not
  // reach the registry's copy or the next registration.
  check('each payload call returns a fresh object', localExecSkillPayload() !== payload)
}

// ---------------------------------------------------------------------------
// The installer: happy path
// ---------------------------------------------------------------------------
{
  const registered = []
  let disposeCalls = 0
  const skillsService = {
    register (payload) {
      registered.push(payload)
      return () => { disposeCalls += 1 }
    },
  }
  const log = { info: [], warn: [] }
  const ctx = {
    logger: { info: (m) => log.info.push(m), warn: (m) => log.warn.push(m) },
    reflect: { get: (name) => name === 'skills' ? skillsService : undefined },
  }
  const sink = { registered: false, payload: null }

  const dispose = installLocalExecSkill(ctx, sink)

  check('a present skills service registers exactly one skill', registered.length === 1)
  check('the registered name is "local-exec"', registered[0]?.name === 'local-exec')
  check('the sink reports registered with the payload',
    sink.registered === true && sink.payload === registered[0])
  check('the success path logs an info line', log.info.length === 1 && log.warn.length === 0)

  dispose()
  check('the disposer unregisters exactly once', disposeCalls === 1)
  check('the disposer resets the sink', sink.registered === false && sink.payload === null)
}

// ---------------------------------------------------------------------------
// The installer: absent / broken service must warn, never throw
// ---------------------------------------------------------------------------
{
  const makeCtx = (reflect) => ({
    logger: { info: () => {}, warn: () => {} },
    reflect,
  })

  // reflect.get('skills') answers undefined.
  const sinkA = { registered: false, payload: null }
  let threw = false
  let disposeA = null
  try {
    disposeA = installLocalExecSkill(makeCtx({ get: () => undefined }), sinkA)
  } catch { threw = true }
  check('no skills service: install does not throw', threw === false)
  check('no skills service: the sink stays unregistered', sinkA.registered === false && sinkA.payload === null)
  check('no skills service: the returned disposer is callable', typeof disposeA === 'function' && (() => { disposeA(); return true })())

  // No reflect at all (an older host build).
  const sinkB = { registered: true, payload: { stale: true } }
  installLocalExecSkill({ logger: { warn: () => {} } }, sinkB)
  check('no reflect service: the sink is cleared', sinkB.registered === false && sinkB.payload === null)

  // A skills service without register (a stub or a foreign shape).
  const sinkC = { registered: false, payload: null }
  installLocalExecSkill(makeCtx({ get: () => ({}) }), sinkC)
  check('a register-less service: the sink stays unregistered', sinkC.registered === false && sinkC.payload === null)
}

// The warn requirement is behavioral: the absence must be VISIBLE. Capture it.
{
  const warnings = []
  const ctx = {
    logger: { warn: (m) => warnings.push(m) },
    reflect: { get: () => undefined },
  }
  installLocalExecSkill(ctx, { registered: false, payload: null })
  check('a missing service logs a warning naming the skill',
    warnings.length === 1 && warnings[0].includes('local-exec'))
}

// ---------------------------------------------------------------------------
// The installer: a failing register must not break the plugin load
// ---------------------------------------------------------------------------
{
  const warnings = []
  const ctx = {
    logger: { info: () => {}, warn: (m) => warnings.push(m) },
    reflect: {
      get: () => ({
        register () { throw new Error('skill registry is closed for maintenance') },
      }),
    },
  }
  const sink = { registered: false, payload: null }
  let threw = false
  let dispose = null
  try {
    dispose = installLocalExecSkill(ctx, sink)
  } catch { threw = true }
  check('a throwing register does not propagate', threw === false)
  check('a throwing register leaves the sink unregistered', sink.registered === false && sink.payload === null)
  check('a throwing register logs the reason', warnings.length === 1 && warnings[0].includes('maintenance'))
  check('the failure path still returns a callable disposer', typeof dispose === 'function')
  dispose()
}

// A disposer-less register (a host that returns undefined) must still reset
// the sink and not throw on cleanup.
{
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    reflect: { get: () => ({ register: () => undefined }) },
  }
  const sink = { registered: true, payload: null }
  const dispose = installLocalExecSkill(ctx, sink)
  check('a register without a disposer still registers', sink.registered === true)
  let threw = false
  try { dispose() } catch { threw = true }
  check('disposing a disposer-less registration does not throw', threw === false && sink.registered === false)
}

// A THROWING disposer is teardown-time degradation: logged, swallowed there,
// and the sink still resets.
{
  let warnings = 0
  const ctx = {
    logger: { info: () => {}, warn: () => { warnings += 1 } },
    reflect: {
      get: () => ({ register: () => () => { throw new Error('registry already gone') } }),
    },
  }
  const sink = { registered: false, payload: null }
  const dispose = installLocalExecSkill(ctx, sink)
  let threw = false
  try { dispose() } catch { threw = true }
  check('a throwing disposer is contained', threw === false && warnings === 1 && sink.registered === false)
}

// ---------------------------------------------------------------------------
// The wiring (source audit — these files need peers to import)
// ---------------------------------------------------------------------------
{
  const index = readFileSync(path.join(pluginRoot, 'lib/index.js'), 'utf8')
  const routes = readFileSync(path.join(pluginRoot, 'lib/routes.js'), 'utf8')
  const client = readFileSync(path.join(pluginRoot, 'lib/client.js'), 'utf8')
  const runner = readFileSync(path.join(pluginRoot, 'tests/run.mjs'), 'utf8')

  check('index.js imports the installer', index.includes("from './local-exec-skill.js'"))
  check('index.js registers the skill inside ctx.effect',
    /ctx\.effect\(\s*\(\) => installLocalExecSkill\(ctx, localExecSkill\)/u.test(index))
  check('index.js keeps the verdict sink at apply scope',
    index.includes('const localExecSkill = { registered: false, payload: null }'))
  check('index.js hands the sink to makeRoutes', index.includes('localExecSkill,'))
  check('the system-prompt announcement points at the skill',
    index.includes('SSH_WORKSPACE_GUIDANCE') && index.includes('local-exec 技能有完整判定与写法'))

  check('routes.js declares the read-only skill route',
    routes.includes("skill: '/api/dsh-ssh-workspace/skill'"))
  check('the skill route answers GET through the shared guard',
    /path: ROUTES\.skill,[\s\S]{0,200}guard\(req, res, 'GET'\)/u.test(routes))
  check('the skill route reports the unregistered state instead of failing',
    routes.includes('registered: false') && routes.includes('deps.localExecSkill'))

  check('client.js fetches the skill for the panel', client.includes("skill: '/api/dsh-ssh-workspace/skill'"))
  check('client.js declares the panel section in zh and en',
    client.includes("'skill.title': '自动注入技能'") && client.includes("'skill.title': 'Auto-injected skill'"))
  check('client.js renders the read-only collapsible block',
    client.includes('sshwsp-skill-content') && client.includes('t(\'skill.notRegistered\')'))

  check('run.mjs carries the new suite', runner.includes("'skill-local-exec',"))
}

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
