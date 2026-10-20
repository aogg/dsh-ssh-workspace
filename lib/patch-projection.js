/**
 * UPSTREAM WORKAROUND #1 — keep the `workingDirectory` projection readable for
 * an `ssh://` cwd.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT UPSTREAM DOES (and the one-line fix that ends this module's life)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `@deepseek-ai/dsh-working-directory` registers the Session's directory as a
 * projection unit whose schema is built like this:
 *
 * ```js
 * const directorySchema = z.string().min(1).refine(isAbsolute).nullable()
 * ```
 *
 * `refine(isAbsolute)` hands zod the FUNCTION VALUE that the module's
 * `import { isAbsolute } from "node:path"` binding held when the service was
 * constructed. This plugin's builtin bridge (see fs-shim.js) replaces
 * `node:path.isAbsolute` and calls `syncBuiltinESMExports()`, which republishes
 * the new function on the ESM namespace — every module that READS the binding at
 * call time (the Session header check, `dsh-fs-local`, …) sees the patch. A
 * schema that captured the value does not: it keeps calling the original
 * `isAbsolute`, which answers `false` for `ssh://host/path`.
 *
 * The fix belongs upstream and is one line — read the binding instead of the
 * value:
 *
 * ```js
 * const directorySchema = z.string().min(1).refine((value) => isAbsolute(value)).nullable()
 * ```
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO REMOVE THIS WORKAROUND (see docs/upstream-workarounds.md)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * When a DSH release carries that fix, delete:
 *
 *   1. the `ctx.inject(['sessionProjections'], …)` block in lib/index.js;
 *   2. this file;
 *   3. tests/projection-relax-smoke.mjs and tests/projection-real-smoke.mjs;
 *   4. docs/upstream-workarounds.md and its index rows.
 *
 * You do not have to notice the release yourself: {@link installProjectionRelaxation}
 * probes the registered schema with an `ssh://` value and, when the schema
 * already accepts one, installs NOTHING — it leaves `register` untouched, relaxes
 * nothing, and logs one INFO line saying the workaround is no longer needed. So
 * an upstream upgrade turns this module into a self-announcing no-op instead of a
 * silent double-relaxation.
 *
 * The second signal is `tests/projection-real-smoke.mjs`: its first section
 * asserts the defect REPRODUCES, so it goes RED on the release that fixes it.
 * A red suite there means "delete the workaround", not "regression".
 *
 * Nothing is loosened beyond the `ssh://` scheme: a relative local path is still
 * rejected, `null` still passes, and every other member of the original schema
 * stays reachable through the prototype chain.
 *
 * @module @shiqyka/dsh-ssh-workspace/patch-projection
 */

import { isRemotePath } from './protocol.js'

/**
 * Stable id for this workaround.
 *
 * Grep-able on purpose: it appears in this file's banner, in the lib/index.js
 * installation block, in docs/upstream-workarounds.md and in the CHANGELOG, so
 * `grep -rn UPSTREAM-1-working-directory-isAbsolute .` lists every place that
 * has to be touched when the workaround is deleted.
 */
export const WORKAROUND_ID = 'UPSTREAM-1-working-directory-isAbsolute'

/** Projection unit whose schema captured `path.isAbsolute` as a value. */
export const RELAXED_KEY = 'workingDirectory'

/**
 * Everything needed to judge, later, whether this workaround is still load-
 * bearing: where the defect lives, what the fix is, and what proves it landed.
 */
export const UPSTREAM_FIX = Object.freeze({
  id: WORKAROUND_ID,
  package: '@deepseek-ai/dsh-working-directory',
  file: 'lib/index.js',
  defect: 'const directorySchema = z$1.string().min(1).refine(isAbsolute).nullable()',
  fix: 'const directorySchema = z$1.string().min(1).refine((value) => isAbsolute(value)).nullable()',
  reason: 'refine(isAbsolute) captures the predicate as a VALUE; the plugin patches the ESM BINDING only',
  removeWhen: 'the registered schema accepts an ssh:// value on its own (this module then installs nothing)',
  runbook: 'docs/upstream-workarounds.md',
})

/**
 * Environment switch that disables every upstream workaround in this plugin.
 *
 * Exists so an operator can verify "is the workaround still needed?" against a
 * real deployment without editing code: set it, restart DSH, and open a stored
 * `ssh://` session. It loads → upstream is fixed and the workaround can be
 * deleted. It reports `历史加载失败` → the workaround is still load-bearing.
 *
 * @type {string}
 */
export const DISABLE_ENV = 'DSH_SSH_WORKSPACE_DISABLE_UPSTREAM_WORKAROUNDS'

/** Marks a schema this module already relaxed (idempotence). */
const RELAXED_SCHEMA = Symbol.for('dsh-ssh-workspace.projection.schema')

/** Holds the live installation on the registry it patched. */
const RELAXED_REGISTRY = Symbol.for('dsh-ssh-workspace.projection.registry')

/**
 * A value only a remote-aware schema accepts.
 *
 * Deliberately not a real host: the probe must never depend on which aliases
 * exist, only on the schema's spelling rule.
 */
const REMOTE_PROBE = 'ssh://upstream-probe/absolute/path'

/**
 * Whether the environment asks this plugin to skip its upstream workarounds.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env] - the
 *   environment to read (defaults to `process.env`).
 * @returns {boolean} true when {@link DISABLE_ENV} holds a truthy spelling.
 */
export function workaroundsDisabled (env = process.env) {
  const raw = env?.[DISABLE_ENV]
  if (raw === undefined || raw === null) return false
  return /^(?:1|true|yes|on)$/iu.test(String(raw).trim())
}

/**
 * Whether a schema accepts a remote spelling on its own.
 *
 * This is the probe behind "is the workaround still needed?": the Host's fixed
 * schema would answer `true`, the defective one throws (`Invalid input`).
 *
 * @param {object | undefined | null} schema - a parser with `parse`.
 * @returns {boolean} true when `parse(REMOTE_PROBE)` returned without throwing.
 */
export function acceptsRemotePath (schema) {
  if (schema === null || typeof schema !== 'object') return false
  if (typeof schema.parse !== 'function') return false
  try {
    schema.parse(REMOTE_PROBE)
    return true
  } catch {
    return false
  }
}

/**
 * Whether this module (or a previous install of it) relaxed a schema.
 *
 * Used to tell "upstream fixed this" apart from "we already relaxed it": both
 * accept an `ssh://` value, and only the first means the workaround is obsolete.
 *
 * @param {object | undefined | null} schema - a schema to inspect.
 * @returns {boolean} true when the relaxation marker is present.
 */
function isRelaxed (schema) {
  return schema !== null && typeof schema === 'object' && schema[RELAXED_SCHEMA] === true
}

/**
 * Wrap one schema so a remote spelling validates without losing the original
 * rule for local paths.
 *
 * Returns the input unchanged — no wrapper at all — when the schema already
 * accepts an `ssh://` value on its own. That is the self-retiring path: after an
 * upstream fix there is nothing to relax, and the caller reports it.
 *
 * The wrapper inherits from the original schema, so anything the Host reads off
 * it (`_def`, refinements, `instanceof` checks) is still there; only `parse` is
 * replaced. The original `parse` keeps its own receiver, so its internals — and
 * any `this`-dependent behaviour — resolve exactly as before.
 *
 * @param {object | undefined | null} schema - the captured schema.
 * @returns {object | undefined | null} the relaxed schema, or the input unchanged
 *   when it is already relaxed, absent, not a parser, or already remote-aware.
 */
export function relaxSchema (schema) {
  if (schema === undefined || schema === null) return schema
  if (schema[RELAXED_SCHEMA] === true) return schema
  if (typeof schema.parse !== 'function') return schema
  // Upstream already reads the binding at call time (or the unit was registered
  // by something else that accepts remote spellings): leave it alone.
  if (acceptsRemotePath(schema)) return schema
  const relaxed = Object.create(schema)
  Object.defineProperty(relaxed, RELAXED_SCHEMA, { value: true, enumerable: false })
  Object.defineProperty(relaxed, 'parse', {
    value: function parse (value) {
      // The same predicate fs-shim.js patches `path.isAbsolute` with, so both
      // halves of the plugin agree on what "absolute" means for a remote target.
      if (isRemotePath(value)) return value
      return schema.parse(value)
    },
    writable: true,
    configurable: true,
    enumerable: false,
  })
  return relaxed
}

/**
 * Copy one projection definition with its two schemas relaxed.
 *
 * Returns the definition object itself when nothing had to change — the case
 * that matters after an upstream fix, so a registration is passed through
 * byte-identically rather than cloned for no reason.
 *
 * @param {object} definition - a `sessionProjections.register()` argument.
 * @returns {object} the definition, relaxed when it is the directory unit and
 *   its schemas still capture the predicate.
 */
export function relaxDefinition (definition) {
  if (definition === null || typeof definition !== 'object') return definition
  if (definition.key !== RELAXED_KEY) return definition
  const wire = definition.wire
  const hasWire = wire !== null && typeof wire === 'object'
  const stateSchema = relaxSchema(definition.stateSchema)
  const viewSchema = hasWire ? relaxSchema(wire.viewSchema) : undefined
  const stateChanged = stateSchema !== definition.stateSchema
  const wireChanged = hasWire && viewSchema !== wire.viewSchema
  if (!stateChanged && !wireChanged) return definition
  return {
    ...definition,
    stateSchema,
    wire: hasWire ? { ...wire, viewSchema } : wire,
  }
}

/**
 * The registered definition of the directory unit, when the registry exposes it.
 *
 * `registrations` is a Map of `{ def, cells, refs }` on the Host's
 * `SessionProjectionRegistry`; `def` is the erased copy every read path parses
 * through.
 *
 * @param {object} registry - the live `ctx.sessionProjections`.
 * @returns {object | undefined} the definition, or undefined when not found.
 */
function registeredDefinition (registry) {
  const table = registry?.registrations
  if (!(table instanceof Map)) return undefined
  const def = table.get(RELAXED_KEY)?.def
  return def !== null && typeof def === 'object' ? def : undefined
}

/**
 * Whether the registered unit already validates an `ssh://` value WITHOUT this
 * module — i.e. whether the upstream fix has shipped.
 *
 * Both schemas are considered, and a schema this module relaxed does not count
 * as upstream's work, so a second install cannot mistake its own patch for a fix.
 *
 * @param {object | undefined} def - the registered definition.
 * @returns {boolean} true when every present schema accepts a remote spelling
 *   and none of them is ours.
 */
function unitAcceptsRemote (def) {
  if (def === undefined) return false
  const wire = def.wire
  const candidates = [def.stateSchema, wire !== null && typeof wire === 'object' ? wire.viewSchema : undefined]
    .filter(schema => schema !== undefined && schema !== null)
  if (candidates.length === 0) return false
  if (candidates.some(isRelaxed)) return false
  return candidates.every(acceptsRemotePath)
}

/**
 * Relax the already-registered unit in place, if the registry exposes its table.
 *
 * The definition object is the registry's own erased copy (`def`), and every
 * read path parses through `def.stateSchema` / `def.wire.viewSchema`, so
 * replacing those two members covers `restore`, `viewCheckpoint`, `snapshot`,
 * `cachedSnapshot`, `hydrate`, and the change feed at once.
 *
 * @param {object} registry - the live `ctx.sessionProjections`.
 * @returns {boolean} whether a registered unit was found.
 */
function relaxRegistered (registry) {
  const def = registeredDefinition(registry)
  if (def === undefined) return false
  const stateSchema = relaxSchema(def.stateSchema)
  if (stateSchema !== def.stateSchema) def.stateSchema = stateSchema
  const wire = def.wire
  if (wire !== null && typeof wire === 'object') {
    const viewSchema = relaxSchema(wire.viewSchema)
    if (viewSchema !== wire.viewSchema) wire.viewSchema = viewSchema
  }
  return true
}

/**
 * Install the relaxation on the live projection registry.
 *
 * Three outcomes, all reported on the returned installation:
 *
 * - `upstreamFixed` — the registered schema already accepts `ssh://`: the
 *   workaround is obsolete, NOTHING is patched, and one INFO line says so. This
 *   is the self-retiring path described in the module banner.
 * - `relaxedInPlace` — the production order, where `working-directory`
 *   registered before this plugin loaded → its definition is relaxed in place.
 * - neither, with `enabled` true — the unit has not registered yet; `register`
 *   is wrapped so the unit is relaxed as it arrives (reload / test harness).
 *
 * `enabled` is false when {@link DISABLE_ENV} asks for the workarounds to be
 * skipped; nothing is patched in that case either.
 *
 * Idempotent per process: a second call returns the existing installation.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @param {object} [options] - install options.
 * @param {object} [options.logger] - a Cordis logger, when available.
 * @param {Record<string, string | undefined>} [options.env] - environment to
 *   read {@link DISABLE_ENV} from (defaults to `process.env`).
 * @returns {{id: string, enabled: boolean, relaxedInPlace: boolean,
 *   upstreamFixed: boolean, dispose: () => void} | undefined} the installation,
 *   or undefined when no projection registry is mounted.
 */
export function installProjectionRelaxation (ctx, { logger, env = process.env } = {}) {
  const registry = ctx?.get?.('sessionProjections') ?? ctx?.sessionProjections
  if (registry === undefined || registry === null) return undefined
  const existing = registry[RELAXED_REGISTRY]
  if (existing !== undefined) return existing

  const installed = {
    id: WORKAROUND_ID,
    enabled: false,
    relaxedInPlace: false,
    upstreamFixed: false,
    dispose: () => {},
  }

  Object.defineProperty(registry, RELAXED_REGISTRY, {
    value: installed,
    writable: false,
    configurable: true,
    enumerable: false,
  })

  if (workaroundsDisabled(env)) {
    logger?.warn?.(`ssh-workspace: ${WORKAROUND_ID} is disabled by ${DISABLE_ENV}; a stored ssh:// session will fail to load its history`)
    return installed
  }

  installed.enabled = true

  // Retire before patching: if the Host's own schema already accepts a remote
  // spelling there is nothing to fix, and mutating the service would only make
  // the removal step harder to judge later.
  if (unitAcceptsRemote(registeredDefinition(registry))) {
    installed.upstreamFixed = true
    logger?.info?.(`ssh-workspace: ${WORKAROUND_ID} is no longer needed — the Host's ${RELAXED_KEY} schema already accepts an ssh:// cwd, so nothing was patched; this workaround can be deleted (see ${UPSTREAM_FIX.runbook})`)
    return installed
  }

  installed.relaxedInPlace = relaxRegistered(registry)

  const originalRegister = registry.register
  if (typeof originalRegister === 'function') {
    const wrapped = function register (definition) {
      return originalRegister.call(this, relaxDefinition(definition))
    }
    Object.defineProperty(registry, 'register', {
      value: wrapped,
      writable: true,
      configurable: true,
      enumerable: false,
    })
    installed.dispose = () => {
      if (registry.register === wrapped) delete registry.register
    }
  }

  if (installed.relaxedInPlace) {
    logger?.info?.(`ssh-workspace: relaxed the ${RELAXED_KEY} projection schema so an ssh:// cwd validates (${WORKAROUND_ID})`)
  } else if (typeof originalRegister === 'function') {
    // Not a failure: the unit may simply not be mounted yet, and the register
    // wrapper above still catches it whenever it arrives.
    logger?.debug?.(`ssh-workspace: ${RELAXED_KEY} is not registered yet; its schema will be relaxed when it is`)
  }
  return installed
}

/**
 * Undo {@link installProjectionRelaxation}.
 *
 * The relaxed schemas themselves are left in place: they are a pure superset of
 * the original rule, so restoring the stricter parser would re-break a session
 * that is already open. Only the `register` wrapper is removed.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @returns {void}
 */
export function uninstallProjectionRelaxation (ctx) {
  const registry = ctx?.get?.('sessionProjections') ?? ctx?.sessionProjections
  const installed = registry?.[RELAXED_REGISTRY]
  if (installed === undefined) return
  installed.dispose()
  delete registry[RELAXED_REGISTRY]
}
