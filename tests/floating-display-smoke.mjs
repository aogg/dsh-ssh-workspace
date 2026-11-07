/**
 * The floating display: which rows hide, and the CSS that draws the card.
 *
 * Two things can silently break here and both look fine in a screenshot:
 *
 *   1. the HIDE SETS. Not floating, a configured floating remote's row (and its
 *      session rows) must leave the normal list — that is the whole point of
 *      the feature. Floating, the opposite: every row EXCEPT the floating
 *      workspace's own. Getting the two states confused either piles the rows
 *      back up or hides the workspace you are looking at.
 *   2. the CARD ITSELF. It has to be opaque (`bg-layer-*` is a solid theme
 *      surface), at least as tall as the visible list (`min-height: 100%`),
 *      visibly distinct from a normal row (badge, border, shadow, accent band)
 *      and slide in from the left (`translateX(-100%)` → 0, ~140ms).
 *
 * The pure half is extracted from lib/client.js and run for real; the CSS half
 * is asserted on the injected stylesheet text.
 *
 * Run: node tests/floating-display-smoke.mjs
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
let failures = 0
function check (label, ok, detail) {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`) } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

console.log('\n=== floating display smoke ===\n')

const source = readFileSync(path.join(pluginRoot, 'lib/client.js'), 'utf8')

// ---------------------------------------------------------------------------
console.log('[the pure decisions]')

const blockStart = source.indexOf('    function floatingMembership (')
const blockEnd = source.indexOf('     * Reconcile the whole floating decoration', blockStart)
if (blockStart < 0 || blockEnd < 0) throw new Error('client.js lost the floating membership helpers')
const pureSource = source.slice(blockStart, source.lastIndexOf('/**', blockEnd))
const { floatingMembership, floatingRowHidden } = new Function(`${pureSource}
  return { floatingMembership, floatingRowHidden }
`)()

/** The index shape the pass builds: path → id and id → session ids. */
function makeIndex () {
  return {
    pathToId: new Map([['ssh://box/srv/a', 'w-a'], ['ssh://box/srv/b', 'w-b']]),
    idToPath: new Map([['w-a', 'ssh://box/srv/a'], ['w-b', 'ssh://box/srv/b']]),
    idToSessions: new Map([['w-a', ['s1', 's2']], ['w-b', ['s9']], ['w-other', ['s7']]]),
  }
}

{
  const index = makeIndex()
  const items = [
    { id: 'f1', workspacePath: 'ssh://box/srv/a' },
    { id: 'f2', workspacePath: 'ssh://box/srv/b' },
    { id: 'f3', workspacePath: 'ssh://box/gone' },
  ]
  const membership = floatingMembership(items, index, null)
  check('every configured workspace contributes its id',
    [...membership.configuredIds].sort().join(',') === 'w-a,w-b',
    [...membership.configuredIds].join(','))
  check('every configured workspace contributes its session ids',
    [...membership.configuredSessions].sort().join(',') === 's1,s2,s9',
    [...membership.configuredSessions].join(','))
  check('an entry whose workspace is not registered contributes nothing (no guess)',
    !membership.configuredIds.has('w-gone'))
  check('nothing is "active" when not floating', membership.activeSessions.size === 0)

  check('NOT floating: the configured workspace row is hidden',
    floatingRowHidden('workspace:w-a', null, membership) === true)
  check('NOT floating: a configured session row is hidden',
    floatingRowHidden('session:s1', null, membership) === true)
  check('NOT floating: an unconfigured workspace row stays',
    floatingRowHidden('workspace:w-other', null, membership) === false)
  check('NOT floating: an unconfigured session row stays',
    floatingRowHidden('session:s7', null, membership) === false)
  check('the collapsed-sessions button follows its group',
    floatingRowHidden('overflow:w-a', null, membership) === true)

  const active = { id: 'f1', workspaceId: 'w-a' }
  const floating = floatingMembership(items, index, active)
  check('floating: the floating workspace row is NOT hidden',
    floatingRowHidden('workspace:w-a', active, floating) === false)
  check('floating: every other workspace row IS hidden',
    floatingRowHidden('workspace:w-b', active, floating) === true)
  check('floating: the ungrouped bucket row is hidden too (the card holds one workspace)',
    floatingRowHidden('workspace:', active, floating) === true)
  check('floating: the floating workspace sessions stay visible',
    floatingRowHidden('session:s1', active, floating) === false &&
      floatingRowHidden('session:s2', active, floating) === false)
  check('floating: any other session row is hidden',
    floatingRowHidden('session:s9', active, floating) === true)
  check('floating: the floating group\'s overflow button stays',
    floatingRowHidden('overflow:w-a', active, floating) === false)

  const restored = floatingMembership(items, index, null)
  check('exiting floating restores the configured-only hidden set',
    floatingRowHidden('session:s7', null, restored) === false &&
      floatingRowHidden('session:s1', null, restored) === true)

  check('rows of another surface (no recognized key) are untouched',
    floatingRowHidden('empty', active, floating) === false &&
      floatingRowHidden('', active, floating) === false)

  // A registry we cannot read is UNKNOWN, not "this workspace has no sessions":
  // hiding on that guess would hide the very rows the card exists to show.
  const unknownIndex = makeIndex()
  unknownIndex.idToSessions.delete('w-a')
  const unknown = floatingMembership(items, unknownIndex, active)
  check('unknown session membership is recorded as unknown',
    unknown.activeSessionsKnown === false)
  check('unknown membership hides no session rows',
    floatingRowHidden('session:s1', active, unknown) === false &&
      floatingRowHidden('session:s9', active, unknown) === false)
}

// ---------------------------------------------------------------------------
console.log('\n[the card is opaque, covering and distinct]')

const cardRule = /\[data-sshwsp-float-card\] \{([^}]*)\}/.exec(source)?.[1] ?? ''
check('the card rule exists', cardRule !== '')
check('the card is absolutely positioned and fills its region',
  /position:\s*absolute/.test(cardRule) && /inset:\s*0/.test(cardRule), cardRule)
check('the card covers at least the visible list (min-height: 100%)',
  /min-height:\s*100%/.test(cardRule), cardRule)
check('the card background is an OPAQUE theme layer, never rgba/transparent',
  /background:\s*var\(--dsw-alias-bg-layer-[123]/.test(cardRule) && !/background:[^;]*rgba/.test(cardRule),
  cardRule)
check('the card has a border and a prominent elevation',
  /border:\s*1px solid var\(--dsw-alias-border-l[0-9]/.test(cardRule) && /box-shadow:\s*var\(--dsw-elevation-prominent/.test(cardRule),
  cardRule)
check('the card has rounded corners', /border-radius:\s*\d+px/.test(cardRule), cardRule)
check('the card cannot be clicked through its own surface',
  /pointer-events:\s*none/.test(cardRule), cardRule)

const accentRule = /\[data-sshwsp-float-card\]::before \{([^}]*)\}/.exec(source)?.[1] ?? ''
check('a 3px accent band runs down the card\'s left edge',
  /width:\s*3px/.test(accentRule) && /bottom:\s*0/.test(accentRule) && /background:\s*var\(/.test(accentRule),
  accentRule)

// ---------------------------------------------------------------------------
console.log('\n[the header reads as a different thing from a workspace row]')

const headRule = /(?:^|\n)\[data-sshwsp-float-head\] \{([^}]*)\}/.exec(source)?.[1] ?? ''
check('the header rule exists', headRule !== '')
check('the header carries its own opaque surface (bg-layer-3)',
  /background:\s*var\(--dsw-alias-bg-layer-3/.test(headRule), headRule)
check('the header is separated from the rows by a hairline',
  /border-bottom:\s*1px solid var\(--dsw-alias-border-l2/.test(headRule), headRule)
check('the header is pinned inside the card, not in the scrolling tree',
  /position:\s*absolute/.test(headRule) && /height:\s*46px/.test(headRule), headRule)
check('the header\'s controls stay clickable although the card itself does not take pointers',
  source.includes('[data-sshwsp-float-card] > [data-sshwsp-float-head] { pointer-events: auto; }'))
check('the tree starts below the header so rows never slide under it',
  /\[data-sshwsp-float-on\] > \[role="tree"\] \{ margin-top: 46px; \}/.test(source))
check('the "floating" badge is filled with the accent color, not plain text',
  /\.sshwsp-float-badge \{[^}]*background:\s*var\(--dsw-alias-state-business-primary/.test(source))
check('the host address is spelled in the monospace face under the name',
  /\.sshwsp-float-addr \{[^}]*font-family:\s*var\(--dsw-font-markdown-code-font-family/.test(source))
check('the close button has a hover target big enough to hit',
  /\.sshwsp-float-close:hover[^{]*\{[^}]*background:/.test(source))

// ---------------------------------------------------------------------------
console.log('\n[the injected stylesheet is well formed]')

{
  // Only the template literal: slicing the whole function would count the
  // function's own braces as CSS.
  const literalStart = source.indexOf('tag.textContent = `') 
  const cssStart = literalStart + 'tag.textContent = `'.length
  const cssEnd = source.indexOf('`\n      document.head.appendChild(tag)', cssStart)
  const css = source.slice(cssStart, cssEnd)
  const opens = (css.match(/\{/g) ?? []).length
  const closes = (css.match(/\}/g) ?? []).length
  check('the stylesheet template has balanced braces', opens === closes, `${opens} { vs ${closes} }`)
  check('every floating attribute we paint has a rule',
    ['data-sshwsp-float-card', 'data-sshwsp-float-head', 'data-sshwsp-float-region',
      'data-sshwsp-float-on', 'data-sshwsp-float-hidden', 'data-sshwsp-float-item',
      'data-sshwsp-float-submenu'].every(attr => css.includes(attr)),
    'an attribute with no rule is decoration that silently does nothing')
}

console.log('\n[the card slides in from the left]')

check('the slide keyframes go from translateX(-100%) to 0',
  /@keyframes sshwsp-float-in \{ from \{ transform: translateX\(-100%\); \} to \{ transform: translateX\(0\); \} \}/.test(source))
check('the animation is ~140ms ease-out on the marked region',
  /\[data-sshwsp-float-region\]\[data-sshwsp-float-on\] \{ animation: sshwsp-float-in 140ms ease-out; \}/.test(source))
check('reduced motion turns the slide off',
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\[data-sshwsp-float-region\]\[data-sshwsp-float-on\] \{ animation: none; \}/.test(source))
check('the list body is the positioning context (no inline display fight with the core)',
  /\[data-sshwsp-float-region\] \{ position: relative; \}/.test(source))
check('hidden rows go through one !important rule, not inline styles',
  /\[data-sshwsp-float-hidden\] \{ display: none !important; \}/.test(source))
check('the tree is lifted above the card so its rows stay interactive',
  /\[data-sshwsp-float-region\] > \[role="tree"\] \{ position: relative; z-index: 1; \}/.test(source))

// ---------------------------------------------------------------------------
console.log('\n[wiring]')

check('apply() installs the floating decoration',
  /const detachFloating = installFloatingWorkspaces\(ctx\)/.test(source))
check('apply() releases it with the rest of the bridges',
  /detachFloating\(\)\s*\n\s*detachBridges\(\)/.test(source))
check('the dialogs sit in the shell overlay seat, independent of the sidebar panel',
  /slots\.inject\('shell\.overlay'/.test(source))
check('the display pass is scheduled on DOM mutations (self-heal)',
  /const observer = new MutationObserver\(\(records\) => \{\s*\n\s*if \(records\.some\(mutationTouchesMarks\)\) scheduleFloatingDisplay\(\)/.test(source))
check('entering floating is page memory only: the state is a plain module variable',
  /let floatingActive = null/.test(source))
check('the floating state is re-read from the configured list on every pass',
  /floatingMembership\(floatingStore\.items, index, active\)/.test(source))

// ---------------------------------------------------------------------------
console.log(`\n=== ${passed} passed, ${failures} failed ===`)
if (failures > 0) {
  console.log('\nfailures:')
  process.exitCode = 1
}
