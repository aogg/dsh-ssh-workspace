/**
 * Route-level checks for the three-level agent prompt configuration.
 *
 * The five `/agent-prompts*` routes are the panel's only write path for the
 * configuration, and `hosts/save` / `hosts/delete` carry integration rules of
 * their own (the form's `agentPrompts` payload, rename moving the level,
 * delete clearing it). Those rules are worth exercising through the REAL
 * handlers with a REAL store underneath, so a normalization change cannot
 * silently strand the panel's edits.
 *
 * Like routes-smoke, the handlers are driven with synthetic request/response
 * doubles; routes.js needs the assembled DSH tree to import, so the suite
 * skips without one.
 *
 * Run: node tests/agent-prompts-routes-smoke.mjs
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
let failures = 0
function check (label, ok, detail) {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`) } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const coreRoot = process.env.DSH_CORE_ROOT
if (!coreRoot) {
  console.log('  SKIP  DSH_CORE_ROOT is not set (routes.js needs the peer tree)')
  console.log(`\n=== ${passed} passed, ${failures} failed, 1 suite skipped ===`)
  process.exit(failures === 0 ? 0 : 1)
}
process.env.DSH_PEER_ROOT = [coreRoot, process.env.DSH_PEER_ROOT].filter(Boolean).join(path.delimiter)

const { makeRoutes, ROUTES } = await import(pathToFileURL(path.join(pluginRoot, 'lib/routes.js')).href)
const { HostConfigStore } = await import(pathToFileURL(path.join(pluginRoot, 'lib/store.js')).href)
const { createAgentPromptRegistry } = await import(pathToFileURL(path.join(pluginRoot, 'lib/agent-prompts.js')).href)

/** A response double that records what the handler wrote. */
function fakeRes () {
  const state = { status: undefined, headers: undefined, body: '', headersSent: false }
  const res = {
    get headersSent () { return state.headersSent },
    writeHead (status, headers) { state.status = status; state.headers = headers; state.headersSent = true; return res },
    write (chunk) { state.body += String(chunk); return true },
    end (chunk) { if (chunk !== undefined) state.body += String(chunk); return res },
    on () {},
  }
  return { res, state }
}

/** A request double carrying the fields the fence reads. */
function fakeReq (options = {}) {
  const handlers = new Map()
  return {
    method: options.method ?? 'GET',
    url: options.url ?? '/',
    headers: options.headers ?? { host: 'localhost:4074' },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1', localPort: options.localPort ?? 4074 },
    on (event, handler) {
      handlers.set(event, handler)
      if (options.body !== undefined && event === 'end') {
        setImmediate(() => {
          const dataHandler = handlers.get('data')
          if (dataHandler !== undefined) dataHandler(Buffer.from(JSON.stringify(options.body)))
          handler()
        })
      }
    },
  }
}

/** Drive one route and parse its JSON reply. */
async function call (routes, routePath, options = {}) {
  const route = routes.find(candidate => candidate.path === routePath)
  if (route === undefined) throw new Error(`route not registered: ${routePath}`)
  const { res, state } = fakeRes()
  const headers = { host: 'localhost:4074', ...(options.method === 'POST' ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) }
  await route.handler(fakeReq({ headers, ...options, headers }), res)
  let body = undefined
  try { body = JSON.parse(state.body) } catch { body = undefined }
  return { status: state.status, body }
}

console.log('\n=== agent-prompts routes smoke ===\n')

const home = mkdtempSync(path.join(tmpdir(), 'dsh-agent-prompts-routes-'))
const material = (name, content) => {
  const file = path.join(home, name)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content, 'utf8')
  return file
}

try {
  const fileA = material('mat/a.md', 'route-A\n')
  material('mat/b.md', 'route-B\n')
  const store = new HostConfigStore(path.join(home, 'store.json'))
  store.create({ alias: 'al', host: 'h.example', port: 22, user: 'u', auth: { kind: 'agent' } })

  /** The served roots, mutable so tests can detach/attach without a real router. */
  let roots = ['ssh://al/w']
  const router = { listRoots: () => [...roots] }
  const engine = {
    // Only the store half and the connection-forget half are touched here.
    store: { entryStore: store, sshConfigAliases: () => [] },
    forget () {},
    pool: new Map(),
  }
  const prompts = createAgentPromptRegistry({ store, roots: () => roots })
  const routes = makeRoutes({ engine, router, forwards: { list: () => [] }, shells: { list: () => [] }, ctx: { get: () => undefined }, prompts })

  // -- the fence still applies ----------------------------------------------
  {
    const refused = await call(routes, ROUTES.agentPrompts, { remoteAddress: '10.0.0.5' })
    check('a non-loopback request is refused', refused.status === 403, String(refused.status))
    const rebound = await call(routes, ROUTES.agentPrompts, { headers: { host: 'evil.example:4074' } })
    check('a rebinding Host header is refused', rebound.status === 403, String(rebound.status))
    const wrongMethod = await call(routes, ROUTES.agentPromptsGlobal, { method: 'GET' })
    check('a GET on the save endpoint is refused', wrongMethod.status === 405, String(wrongMethod.status))
  }

  // -- GET the whole configuration --------------------------------------------
  {
    store.setGlobalAgentPrompts({ globs: [`${home}/mat/*.md`] })
    const reply = await call(routes, ROUTES.agentPrompts)
    check('GET returns the normalized global level', reply.body.global.globs.length === 1, JSON.stringify(reply.body))
    check('GET returns the mounted roots', JSON.stringify(reply.body.mounted) === JSON.stringify(['ssh://al/w']), JSON.stringify(reply.body.mounted))
    check('GET returns empty host/workspace maps when nothing is stored', Object.keys(reply.body.hosts).length === 0 && Object.keys(reply.body.workspaces).length === 0)
  }

  // -- POST the global level ---------------------------------------------------
  {
    const reply = await call(routes, ROUTES.agentPromptsGlobal, {
      method: 'POST',
      body: { globs: [`${home}/mat/a.md`], scripts: [] },
    })
    check('POST global answers ok with the stored level', reply.body.ok === true && reply.body.global.globs[0].pattern === `${home}/mat/a.md`, JSON.stringify(reply.body))
    const onDisk = JSON.parse(readFileSync(path.join(home, 'store.json'), 'utf8'))
    check('the level reached the shared file', onDisk.agentPrompts?.global?.globs?.[0]?.pattern === `${home}/mat/a.md`, JSON.stringify(onDisk.agentPrompts))
    const bad = await call(routes, ROUTES.agentPromptsGlobal, { method: 'POST', body: { globs: 'not-an-array' } })
    check('a malformed payload still saves (entries dropped), not 500', bad.body.ok === true && bad.body.global.globs.length === 0, JSON.stringify(bad.body))
  }

  // -- POST a host level ---------------------------------------------------------
  {
    const reply = await call(routes, ROUTES.agentPromptsHost, {
      method: 'POST',
      body: { alias: 'al', globs: [], scripts: ['echo []'], disabled: ['g-zzz'] },
    })
    check('POST host stores the level under the alias', reply.body.ok === true && store.agentPrompts().hosts.al.scripts.length === 1, JSON.stringify(reply.body))
    check('the disable list is stored verbatim', JSON.stringify(store.agentPrompts().hosts.al.disabled) === JSON.stringify(['g-zzz']))
    const missing = await call(routes, ROUTES.agentPromptsHost, { method: 'POST', body: { globs: [] } })
    check('a missing alias is a 400', missing.status === 400, JSON.stringify(missing.body))
  }

  // -- POST a workspace level -------------------------------------------------------
  {
    const reply = await call(routes, ROUTES.agentPromptsWorkspace, {
      method: 'POST',
      body: { workspacePath: 'ssh://al/w/../w', globs: [`${home}/mat/b.md`] },
    })
    check('POST workspace canonicalizes the key', reply.body.ok === true && store.agentPrompts().workspaces['ssh://al/w'] !== undefined, JSON.stringify(store.agentPrompts().workspaces))
    const bad = await call(routes, ROUTES.agentPromptsWorkspace, { method: 'POST', body: { workspacePath: 'not-ssh', globs: [] } })
    check('a non-ssh path is a 400', bad.status === 400, JSON.stringify(bad.body))
  }

  // -- GET preview --------------------------------------------------------------------
  {
    store.setGlobalAgentPrompts({ globs: [`${home}/mat/*.md`] })
    store.setWorkspaceAgentPrompts('ssh://al/w', { scripts: ['exit 9'] })
    const reply = await call(routes, ROUTES.agentPromptsPreview, { url: `${ROUTES.agentPromptsPreview}?workspacePath=${encodeURIComponent('ssh://al/w')}` })
    check('preview answers ok', reply.body.ok === true, JSON.stringify(reply.body))
    check('preview lists the merged files in order', JSON.stringify(reply.body.files) === JSON.stringify([fileA, path.join(home, 'mat/b.md')]), JSON.stringify(reply.body.files))
    check('preview reports the script failure as a readable error', reply.body.errors.some(error => String(error.message).includes('exited with code 9')), JSON.stringify(reply.body.errors))
    check('preview reports the prompt size', typeof reply.body.chars === 'number' && reply.body.chars > 0, String(reply.body.chars))
    const bad = await call(routes, ROUTES.agentPromptsPreview, { url: ROUTES.agentPromptsPreview })
    check('preview without a workspacePath is a 400', bad.status === 400, JSON.stringify(bad.body))
  }

  // -- hosts/save carries the form's prompt payload ------------------------------------
  {
    const reply = await call(routes, ROUTES.hostSave, {
      method: 'POST',
      body: { alias: 'beta', host: 'b.example', port: 22, user: 'u', auth: { kind: 'agent' }, agentPrompts: { globs: [`${home}/mat/a.md`] } },
    })
    check('creating a host with agentPrompts stores the level', reply.body.ok === true && store.agentPrompts().hosts.beta?.globs?.[0]?.pattern === `${home}/mat/a.md`, JSON.stringify(store.agentPrompts().hosts))
    const renamed = await call(routes, ROUTES.hostSave, {
      method: 'POST',
      body: { originalAlias: 'beta', alias: 'beta2', host: 'b.example', port: 22, user: 'u', auth: { kind: 'agent' } },
    })
    check('a rename without a payload moves the level', renamed.body.ok === true && store.agentPrompts().hosts.beta2 !== undefined && store.agentPrompts().hosts.beta === undefined, JSON.stringify(Object.keys(store.agentPrompts().hosts)))
    const deleted = await call(routes, ROUTES.hostDelete, { method: 'POST', body: { alias: 'beta2' } })
    check('deleting the host clears its level', deleted.body.ok === true && store.agentPrompts().hosts.beta2 === undefined, JSON.stringify(Object.keys(store.agentPrompts().hosts)))
  }

  // -- the registry the routes share is the one the panel preview shows -----------------
  {
    store.setGlobalAgentPrompts({ globs: [`${home}/mat/*.md`] })
    const preview = await call(routes, ROUTES.agentPromptsPreview, { url: `${ROUTES.agentPromptsPreview}?workspacePath=${encodeURIComponent('ssh://al/w')}` })
    const cached = prompts.peek('ssh://al/w')
    check('preview warms the cache the model step reads', cached !== undefined && JSON.stringify(cached.files) === JSON.stringify(preview.body.files), JSON.stringify(cached?.files))
  }
} finally {
  rmSync(home, { recursive: true, force: true })
}

console.log(failures === 0 ? `\nagent-prompts routes smoke: all green (${passed} checks)\n` : `\nagent-prompts routes smoke: ${failures} failure(s)\n`)
process.exit(failures === 0 ? 0 : 1)
