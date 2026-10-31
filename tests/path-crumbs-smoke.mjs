/**
 * The breadcrumb helper behind the path bars.
 *
 * `remotePathCrumbs()` splits one absolute path into clickable segments and
 * `PathBreadcrumb` renders them. Both must speak two dialects: SFTP listings
 * return POSIX paths, while Windows hosts (and a stored `defaultPath`) spell
 * drive paths as `C:\Users\ao` or `/C:/Users/ao`. A split that kept the
 * backslashes, dropped the drive crumb, or targeted `/` for a drive root
 * would navigate the dialog to a path the SFTP server refuses.
 *
 * Like `backdropDismiss()`, the splitter is dependency-free on purpose, so the
 * suite extracts both functions from the client source and runs them against
 * synthetic jsx doubles — no browser, no React, no bundler.
 *
 * Run: node tests/path-crumbs-smoke.mjs
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(here, '..')

let passed = 0
let failures = 0
function check (label, ok, detail) {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`) } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

console.log('\n=== path crumbs smoke ===\n')

const source = readFileSync(path.join(pluginRoot, 'lib/client.js'), 'utf8')

/**
 * Pull one function out of the client source.
 *
 * Unlike {@link backdrop-dismiss-smoke}'s extractor, this one matches the
 * parameter list with parentheses first: `PathBreadcrumb ({ path, ... })`
 * destructures braces in its signature, so the body brace cannot be found by
 * searching for the first `{` after the name.
 */
function extractFunction (name) {
  const start = source.indexOf(`function ${name}`)
  if (start < 0) throw new Error(`client.js does not define ${name}()`)
  const openParen = source.indexOf('(', start)
  let depth = 0
  let closeParen = -1
  for (let i = openParen; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1
    else if (source[i] === ')') {
      depth -= 1
      if (depth === 0) { closeParen = i; break }
    }
  }
  const openBrace = source.indexOf('{', closeParen)
  depth = 0
  for (let i = openBrace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`unbalanced braces in ${name}()`)
}

const crumbsSource = extractFunction('remotePathCrumbs')
const breadcrumbSource = extractFunction('PathBreadcrumb')

/** The jsx double: record the element shape, nothing more. */
const jsx = (type, props) => ({ type, props })
const jsxs = jsx
const Fragment = Symbol('fragment')

const remotePathCrumbs = new Function(`${crumbsSource}; return remotePathCrumbs`)()
const PathBreadcrumb = new Function('jsx', 'jsxs', 'Fragment', `${crumbsSource}\n${breadcrumbSource}; return PathBreadcrumb`)(jsx, jsxs, Fragment)

// ---------------------------------------------------------------------------
console.log('[remotePathCrumbs: the split]')

check('no path yields no crumbs', JSON.stringify(remotePathCrumbs(null)) === '[]', JSON.stringify(remotePathCrumbs(null)))
check('an undefined path yields no crumbs', JSON.stringify(remotePathCrumbs(undefined)) === '[]')
check('an empty path yields no crumbs', JSON.stringify(remotePathCrumbs('')) === '[]')
check("the POSIX root is a single '/' crumb",
  JSON.stringify(remotePathCrumbs('/')) === JSON.stringify([{ label: '/', target: '/' }]),
  JSON.stringify(remotePathCrumbs('/')))

{
  const crumbs = remotePathCrumbs('/home/user')
  check('a POSIX path starts with the root crumb',
    JSON.stringify(crumbs) === JSON.stringify([
      { label: '/', target: '/' },
      { label: 'home', target: '/home' },
      { label: 'user', target: '/home/user' },
    ]), JSON.stringify(crumbs))
}

{
  const expected = JSON.stringify([
    { label: 'C:', target: '/C:/' },
    { label: 'Users', target: '/C:/Users' },
    { label: 'ao', target: '/C:/Users/ao' },
  ])
  check('a Windows drive path (server spelling) starts with the drive crumb',
    JSON.stringify(remotePathCrumbs('/C:/Users/ao')) === expected, JSON.stringify(remotePathCrumbs('/C:/Users/ao')))
  check('the same path with backslashes splits identically',
    JSON.stringify(remotePathCrumbs('C:\\Users\\ao')) === expected, JSON.stringify(remotePathCrumbs('C:\\Users\\ao')))
}

check('a bare drive letter is the drive root crumb',
  JSON.stringify(remotePathCrumbs('D:')) === JSON.stringify([{ label: 'D:', target: '/D:/' }]),
  JSON.stringify(remotePathCrumbs('D:')))

{
  const crumbs = remotePathCrumbs('/C:/Users/ao')
  check('every crumb target is a prefix of the current path (walking up stays in the chain)',
    crumbs.every(crumb => '/C:/Users/ao'.startsWith(crumb.target)),
    JSON.stringify(crumbs.map(crumb => crumb.target)))
  check('the last crumb targets exactly the normalized path', crumbs[crumbs.length - 1].target === '/C:/Users/ao')
}

// ---------------------------------------------------------------------------
console.log('\n[PathBreadcrumb: the bar]')

/** Flatten the stub element tree, keeping Fragments' children and dropping falsy slots. */
function elements (node, out = []) {
  if (node === null || node === undefined || node === false || node === true) return out
  if (Array.isArray(node)) { for (const child of node) elements(child, out); return out }
  if (typeof node === 'object' && node.type === Fragment) { elements(node.props.children, out); return out }
  if (typeof node === 'object' && node.props !== undefined) {
    out.push(node)
    elements(node.props.children, out)
  }
  return out
}

{
  const jumps = []
  const nav = PathBreadcrumb({ path: '/home/user', onNavigate: (target) => jumps.push(target), disabled: false, label: 'Path navigation' })
  check('the bar renders as a labelled nav', nav?.type === 'nav' && nav.props['aria-label'] === 'Path navigation', JSON.stringify(nav?.props?.['aria-label']))
  const buttons = elements(nav).filter(node => node.type === 'button')
  check('every earlier crumb is a button targeting its own directory',
    JSON.stringify(buttons.map(button => button.props.title)) === JSON.stringify(['/', '/home']),
    JSON.stringify(buttons.map(button => button.props.title)))
  for (const button of buttons) button.props.onClick()
  check('clicking a crumb navigates to its target', JSON.stringify(jumps) === JSON.stringify(['/', '/home']), JSON.stringify(jumps))
  const current = elements(nav).filter(node => node.type === 'span' && node.props['aria-current'] === 'location')
  check('the viewed directory is text, not another button',
    current.length === 1 && current[0].props.children === 'user' && buttons.every(button => button.props.children !== 'user'),
    JSON.stringify(current.map(node => node.props.children)))
}

{
  const nav = PathBreadcrumb({ path: '/C:/Users/ao', onNavigate: () => {}, disabled: false, label: 'Path navigation' })
  const buttons = elements(nav).filter(node => node.type === 'button')
  check('the drive crumb is itself clickable, targeting the drive root',
    buttons[0]?.props.title === '/C:/' && buttons[0]?.props.children === 'C:',
    JSON.stringify(buttons.map(button => [button.props.children, button.props.title])))
}

{
  const nav = PathBreadcrumb({ path: '/srv/data', onNavigate: () => {}, disabled: true, label: 'Path navigation' })
  const buttons = elements(nav).filter(node => node.type === 'button')
  check('a disabled bar disables every crumb button',
    buttons.length > 0 && buttons.every(button => button.props.disabled === true),
    JSON.stringify(buttons.map(button => button.props.disabled)))
}

check('no path renders no bar at all',
  PathBreadcrumb({ path: null, onNavigate: () => {}, disabled: false, label: 'Path navigation' }) === null)

// ---------------------------------------------------------------------------
console.log('\n[the wiring]')

check('both directory browsers render the shared breadcrumb bar',
  (source.match(/jsx\(PathBreadcrumb,/gu) ?? []).length >= 2,
  `${(source.match(/jsx\(PathBreadcrumb,/gu) ?? []).length} usage(s)`)
check("the bar's accessible name comes from the path.crumbs locale key",
  source.includes("label: t('path.crumbs')"))

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
process.exit(failures === 0 ? 0 : 1)
