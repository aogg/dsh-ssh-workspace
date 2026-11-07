/**
 * The workspace ⋯ menu injection: append-only, marker-guarded, degrade-safe.
 *
 * The menu itself belongs to DSH (`portal: true`, a `div[role="menu"]` on
 * `body`), and other plugins inject their own rows into it (ao-local's archive /
 * pin / quick-search / copy-path, better-sidebar's standalone-workspace item).
 * Our one non-negotiable contract is therefore APPEND ONLY: our block goes last,
 * nothing already in the menu is touched, and a marker attribute makes a second
 * injection impossible. Two more follow from that:
 *
 *   - a changed core aria template simply stops matching, and the native menu
 *     stays exactly as it was (one item missing, never a broken page);
 *   - the injected block still needs the menu clamped back into the viewport,
 *     because the core sized the card before the block existed.
 *
 * No browser and no bundler: the floating section is sliced out of
 * `lib/client.js` and driven against a minimal DOM double, so the click path,
 * the mutation path and the submenu rendering all run for real.
 *
 * Run: node tests/floating-menu-smoke.mjs
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

console.log('\n=== floating menu smoke ===\n')

// ---------------------------------------------------------------------------
// Minimal DOM double. Only what the floating section actually touches: element
// and text nodes, attributes, class names, textContent, the handful of selectors
// it queries, event listeners, and a MutationObserver that records appended /
// removed children.
// ---------------------------------------------------------------------------

const mutationQueue = []
const observers = []

class StubNode {
  constructor (tag, nodeType = 1) {
    this.tagName = String(tag).toUpperCase()
    this.nodeType = nodeType
    this.attributes = new Map()
    this.childNodes = []
    this.parentNode = null
    this.style = {}
    this.listeners = new Map()
    this.__text = ''
    this.__rect = null
    this.__innerHTML = ''
  }

  get children () { return this.childNodes.filter(node => node.nodeType === 1) }
  get firstChild () { return this.childNodes[0] ?? null }
  get firstElementChild () { return this.children[0] ?? null }
  get lastChild () { return this.childNodes[this.childNodes.length - 1] ?? null }
  get nextElementSibling () {
    if (this.parentNode === null) return null
    const siblings = this.parentNode.children
    const index = siblings.indexOf(this)
    return index < 0 ? null : siblings[index + 1] ?? null
  }
  get nextSibling () {
    if (this.parentNode === null) return null
    const index = this.parentNode.childNodes.indexOf(this)
    return index < 0 ? null : this.parentNode.childNodes[index + 1] ?? null
  }
  get parentElement () { return this.parentNode !== null && this.parentNode.nodeType === 1 ? this.parentNode : null }
  get isConnected () {
    let node = this
    while (node !== null) {
      if (node === documentDouble.body) return true
      node = node.parentNode
    }
    return false
  }

  get className () { return this.getAttribute('class') ?? '' }
  set className (value) { this.setAttribute('class', value) }

  get dataset () {
    const node = this
    return new Proxy({}, {
      get (_target, prop) { return node.getAttribute(`data-${String(prop).replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`) ?? undefined },
      set (_target, prop, value) {
        node.setAttribute(`data-${String(prop).replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value)
        return true
      },
    })
  }

  get textContent () {
    if (this.nodeType === 3) return this.__text
    return this.childNodes.map(node => node.textContent).join('')
  }

  set textContent (value) {
    for (const child of this.childNodes) child.parentNode = null
    this.childNodes = []
    if (value !== undefined && value !== null && String(value) !== '') {
      const text = new StubNode('#text', 3)
      text.__text = String(value)
      text.parentNode = this
      this.childNodes.push(text)
    }
  }

  set innerHTML (value) { this.__innerHTML = String(value) }
  get innerHTML () { return this.__innerHTML }

  setAttribute (name, value) { this.attributes.set(String(name), String(value)) }
  getAttribute (name) { return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null }
  hasAttribute (name) { return this.attributes.has(String(name)) }
  removeAttribute (name) { this.attributes.delete(String(name)) }

  appendChild (child) {
    child.parentNode = this
    this.childNodes.push(child)
    mutationQueue.push({ type: 'childList', target: this, addedNodes: [child], removedNodes: [] })
    return child
  }

  insertBefore (child, reference) {
    child.parentNode = this
    const index = reference === null || reference === undefined ? -1 : this.childNodes.indexOf(reference)
    if (index < 0) this.childNodes.push(child)
    else this.childNodes.splice(index, 0, child)
    mutationQueue.push({ type: 'childList', target: this, addedNodes: [child], removedNodes: [] })
    return child
  }

  removeChild (child) {
    const index = this.childNodes.indexOf(child)
    if (index >= 0) this.childNodes.splice(index, 1)
    child.parentNode = null
    mutationQueue.push({ type: 'childList', target: this, addedNodes: [], removedNodes: [child] })
    return child
  }

  remove () {
    if (this.parentNode !== null) this.parentNode.removeChild(this)
  }

  append (...nodes) { for (const node of nodes) this.appendChild(node) }

  addEventListener (type, handler, options) {
    const capture = options === true || options?.capture === true
    const key = `${type}:${capture ? 1 : 0}`
    if (!this.listeners.has(key)) this.listeners.set(key, new Set())
    this.listeners.get(key).add(handler)
  }

  removeEventListener (type, handler, options) {
    const capture = options === true || options?.capture === true
    const key = `${type}:${capture ? 1 : 0}`
    this.listeners.get(key)?.delete(handler)
  }

  listenersFor (type) {
    return [
      ...(this.listeners.get(`${type}:1`) ?? []),
      ...(this.listeners.get(`${type}:0`) ?? []),
    ]
  }

  closest (selector) {
    let node = this
    while (node !== null && node.nodeType === 1) {
      if (matchesSelector(node, selector)) return node
      node = node.parentNode
    }
    return null
  }

  contains (node) {
    let current = node
    while (current !== null) {
      if (current === this) return true
      current = current.parentNode
    }
    return false
  }

  matches (selector) { return matchesSelector(this, selector) }

  querySelector (selector) { return queryAll(this, selector)[0] ?? null }
  querySelectorAll (selector) { return queryAll(this, selector) }

  getBoundingClientRect () {
    return this.__rect ?? { top: 0, left: 0, right: 200, bottom: 100, width: 200, height: 100, x: 0, y: 0 }
  }

  focus () {}
  click () { dispatch(this, 'click', {}) }
}

function matchesSelector (element, selector) {
  if (typeof selector !== 'string' || element.nodeType !== 1) return false
  const compound = selector.trim()
  if (compound === '') return false
  const negative = /:not\(([^)]*)\)/.exec(compound)
  if (negative !== null) {
    const positive = compound.replace(negative[0], '')
    if (matchesSelector(element, negative[1])) return false
    return positive === '' ? true : matchesSelector(element, positive)
  }
  const tagMatch = /^([a-zA-Z][\w-]*)/.exec(compound)
  if (tagMatch !== null && element.tagName !== tagMatch[1].toUpperCase()) return false
  const tokenRe = /(\.[\w-]+)|(\[[^\]]+\])/g
  let token
  while ((token = tokenRe.exec(compound)) !== null) {
    if (token[1] !== undefined) {
      const wanted = token[1].slice(1)
      if (!String(element.getAttribute('class') ?? '').split(/\s+/).includes(wanted)) return false
      continue
    }
    const spec = token[2].slice(1, -1)
    const parsed = /^([\w-]+)(?:([*^$]?)=["']?([^"']*)["']?)?$/.exec(spec)
    if (parsed === null) return false
    const [, name, rawOperator, value] = parsed
    const actual = element.getAttribute(name)
    if (actual === null) return false
    // An empty operator group means plain `=`; only a really absent group means
    // "attribute exists", which the parser can never produce here.
    const operator = rawOperator === '' ? '=' : rawOperator
    if (operator === undefined) continue
    if (operator === '=' && actual !== value) return false
    if (operator === '*' && !actual.includes(value)) return false
    if (operator === '^' && !actual.startsWith(value)) return false
  }
  return true
}

/** Descendant selector chains only (what the floating code uses). */
function queryAll (root, selector) {
  const parts = []
  let depth = 0
  let current = ''
  for (const char of selector.trim()) {
    if (char === '[') depth += 1
    if (char === ']') depth -= 1
    if (char === ' ' && depth === 0) {
      if (current !== '') { parts.push(current); current = '' }
      continue
    }
    current += char
  }
  if (current !== '') parts.push(current)
  const results = []
  const walk = (node) => {
    for (const child of node.children) {
      if (matchesSelector(child, parts[parts.length - 1])) {
        let ancestor = child.parentNode
        let index = parts.length - 2
        while (index >= 0 && ancestor !== null) {
          if (matchesSelector(ancestor, parts[index])) index -= 1
          ancestor = ancestor.parentNode
        }
        if (index < 0) results.push(child)
      }
      walk(child)
    }
  }
  walk(root)
  return results
}

class MutationObserverStub {
  constructor (callback) {
    this.callback = callback
    this.targets = []
  }

  observe (target) { this.targets = [target]; observers.push(this) }
  disconnect () { this.targets = [] }
}

function flushMutations () {
  if (mutationQueue.length === 0) return
  const records = mutationQueue.splice(0, mutationQueue.length)
  for (const observer of observers) {
    if (observer.targets.length > 0) observer.callback(records)
  }
  // Callbacks may have caused new mutations (our own decoration); deliver once.
  if (mutationQueue.length > 0) flushMutations()
}

function dispatch (target, type, extra) {
  const event = {
    type,
    target,
    __stopped: false,
    stopPropagation () { this.__stopped = true },
    preventDefault () {},
    ...extra,
  }
  for (const handler of documentDouble.listenersFor(type).filter(handler => documentDouble.__capture.has(handler))) {
    handler(event)
  }
  let node = target
  while (node !== null && !event.__stopped) {
    for (const handler of node.listenersFor(type)) {
      if (documentDouble.__capture.has(handler)) continue
      handler(event)
    }
    node = node.parentNode
  }
  if (!event.__stopped) {
    for (const handler of documentDouble.listenersFor(type)) {
      if (!documentDouble.__capture.has(handler)) handler(event)
    }
  }
  return event
}

// Document double ----------------------------------------------------------
const documentDouble = new StubNode('#document', 9)
documentDouble.body = new StubNode('body', 1)
documentDouble.head = new StubNode('head', 1)
documentDouble.body.parentNode = documentDouble
documentDouble.head.parentNode = documentDouble
documentDouble.__capture = new WeakSet()
documentDouble.createElement = (tag) => new StubNode(tag)
documentDouble.createElementNS = (_ns, tag) => new StubNode(tag)
documentDouble.createTextNode = (text) => {
  const node = new StubNode('#text', 3)
  node.__text = String(text)
  return node
}
const realAdd = documentDouble.addEventListener.bind(documentDouble)
documentDouble.addEventListener = (type, handler, options) => {
  const capture = options === true || options?.capture === true
  if (capture) documentDouble.__capture.add(handler)
  realAdd(type, handler, options)
}
documentDouble.querySelector = (selector) => queryAll(documentDouble.body, selector)[0] ?? null
documentDouble.querySelectorAll = (selector) => queryAll(documentDouble.body, selector)

const windowDouble = {
  innerWidth: 1024,
  innerHeight: 800,
  requestAnimationFrame: (callback) => { callback(); return 1 },
}

// ---------------------------------------------------------------------------
// Slice the floating section out of the real bundle and give it its neighbours.
// ---------------------------------------------------------------------------
const source = readFileSync(path.join(pluginRoot, 'lib/client.js'), 'utf8')
const blockStart = source.indexOf('    const FLOAT_ITEM_ATTR =')
const blockEnd = source.indexOf('    // =========================================================================\n    // Composer file bridge', blockStart)
if (blockStart < 0 || blockEnd < 0) throw new Error('client.js lost the floating section')
const floatingSource = source.slice(blockStart, blockEnd)

const floatingPayload = { items: [] }
const fetchCalls = []
const API_STUB = {
  floatingList: '/api/dsh-ssh-workspace/floating/list',
  floatingSave: '/api/dsh-ssh-workspace/floating/save',
  floatingUpdate: '/api/dsh-ssh-workspace/floating/update',
  floatingDelete: '/api/dsh-ssh-workspace/floating/delete',
  floatingReorder: '/api/dsh-ssh-workspace/floating/reorder',
  mount: '/api/dsh-ssh-workspace/mount',
  hosts: '/api/dsh-ssh-workspace/hosts',
  ls: '/api/dsh-ssh-workspace/ls',
  test: '/api/dsh-ssh-workspace/test',
}

async function fetchJson (url) {
  fetchCalls.push(url)
  if (url.startsWith(API_STUB.floatingList)) return floatingPayload
  return {}
}

const translations = {
  'float.menuLabel': 'SSH 远程工作区',
  'float.subEmpty': 'empty',
  'float.subEmptyHint': 'empty hint',
  'float.add': 'add…',
  'float.manage': 'manage…',
  'float.exit': 'exit floating',
  'float.stateFloating': '浮动中',
  'float.stateMounted': '已挂载',
  'float.stateUnmounted': '未挂载',
  'float.hostMissing': '主机缺失',
  'float.badge': '浮动',
  'float.cardClose': 'close',
}
function translate (key) { return translations[key] ?? key }
function notifyUser () {}
const remoteMarksStub = { titles: new Set() }
const lastStatusStub = []

const factory = new Function(
  'document', 'window', 'React', 'translate', 'notifyUser', 'fetchJson', 'API',
  'remoteMarks', 'lastStatusWorkspaces', 'mutationTouchesMarks', 'lastStatusWorkspacesSet',
  'setTimeout', 'clearTimeout', 'KeyboardEvent', 'MutationObserver', 'console',
  `${floatingSource}
  return { installFloatingMenu, installFloatingWorkspaces, refreshFloatingEntries, floatingStore,
    renderFloatingSubmenu, selectFloatingEntry, enterFloating, exitFloating, floatingState: () => floatingActive }
`,
)

const floating = factory(
  documentDouble,
  windowDouble,
  {},
  translate,
  notifyUser,
  fetchJson,
  API_STUB,
  remoteMarksStub,
  lastStatusStub,
  () => true,
  lastStatusStub,
  setTimeout,
  clearTimeout,
  function KeyboardEvent (type, init) { return { type, ...init } },
  MutationObserverStub,
  console,
)

const flush = async () => {
  await new Promise(resolve => setTimeout(resolve, 0))
  flushMutations()
  await new Promise(resolve => setTimeout(resolve, 0))
}

// ---------------------------------------------------------------------------
// The sidebar: one real workspace row with its ⋯ trigger, plus a second row.
// ---------------------------------------------------------------------------
function buildSidebar () {
  const treeBody = documentDouble.createElement('div')
  treeBody.setAttribute('class', 'treeBody')
  const tree = documentDouble.createElement('div')
  tree.setAttribute('role', 'tree')
  treeBody.appendChild(tree)
  documentDouble.body.appendChild(treeBody)
  const rows = {}
  for (const [id, title] of [['w-parent', 'Proj'], ['w-other', 'Other']]) {
    const row = documentDouble.createElement('div')
    row.setAttribute('data-row-key', `workspace:${id}`)
    row.setAttribute('role', 'treeitem')
    const label = documentDouble.createElement('span')
    label.textContent = title
    const actions = documentDouble.createElement('button')
    actions.setAttribute('aria-label', `工作区“${title}”的操作`)
    row.append(label, actions)
    tree.appendChild(row)
    rows[id] = { row, actions }
  }
  return { treeBody, tree, rows }
}

function buildMenu (existingLabels = ['重命名', '删除工作区']) {
  const menu = documentDouble.createElement('div')
  menu.setAttribute('role', 'menu')
  const viewport = documentDouble.createElement('div')
  viewport.setAttribute('class', '_viewport_abc123')
  for (const label of existingLabels) {
    const item = documentDouble.createElement('button')
    item.setAttribute('role', 'menuitem')
    const icon = documentDouble.createElement('span')
    const text = documentDouble.createElement('span')
    text.textContent = label
    item.append(icon, text)
    viewport.appendChild(item)
  }
  menu.appendChild(viewport)
  return { menu, viewport }
}

const disposers = []
const { treeBody, tree, rows } = buildSidebar()
const menuDispose = floating.installFloatingMenu()
disposers.push(menuDispose)

// Seed the configured floating entries for the parent project.
floatingPayload.items = [
  {
    id: 'f1', parentId: 'w-parent', parentPath: 'ssh://box/p', alias: 'box',
    remotePath: '/srv/alpha', workspacePath: 'ssh://box/srv/alpha', title: 'alpha · box',
    hostAddr: 'u@box.example', hostTarget: 'box.example',
    mounted: true, registered: true, hostMissing: false, parentMissing: false,
  },
  {
    id: 'f2', parentId: 'w-parent', alias: 'ghost', remotePath: '/srv/x',
    workspacePath: 'ssh://ghost/srv/x', title: 'x · ghost', hostAddr: undefined,
    mounted: false, registered: false, hostMissing: true, parentMissing: false,
  },
]

// ---------------------------------------------------------------------------
console.log('[capture: only the workspace ⋯ anchor arms the injection]')

{
  // A click on something unrelated must not arm anything.
  dispatch(documentDouble.createElement('div'), 'click', {})
  const { menu, viewport } = buildMenu()
  documentDouble.body.appendChild(menu)
  await flush()
  check('an unrelated click injects nothing', viewport.querySelector('[data-sshwsp-float-item]') === null)
  menu.remove()

  // The ungrouped bucket has no workspace id: skipped, menu stays untouched.
  const bucket = documentDouble.createElement('div')
  bucket.setAttribute('data-row-key', 'workspace:')
  const bucketButton = documentDouble.createElement('button')
  bucketButton.setAttribute('aria-label', '工作区“未分组”的操作')
  bucket.appendChild(bucketButton)
  documentDouble.body.appendChild(bucket)
  dispatch(bucketButton, 'click', {})
  const ungrouped = buildMenu()
  documentDouble.body.appendChild(ungrouped.menu)
  await flush()
  check('the ungrouped bucket is skipped (no id to hang entries on)',
    ungrouped.viewport.querySelector('[data-sshwsp-float-item]') === null)
  ungrouped.menu.remove()
  bucket.remove()
}

console.log('\n[injection appends after every existing item]')

{
  const anchor = rows['w-parent'].actions
  dispatch(anchor, 'click', {})
  const { menu, viewport } = buildMenu()
  documentDouble.body.appendChild(menu)
  await flush()

  const existing = [...viewport.children].filter(child => child.getAttribute('role') === 'menuitem')
  check('the menu still carries its original rows',
    existing.length === 2 && existing[0].textContent === '重命名' && existing[1].textContent === '删除工作区',
    JSON.stringify(existing.map(item => item.textContent)))
  const wrap = viewport.querySelector('[data-sshwsp-float-item]')
  check('our block was injected', wrap !== null)
  check('our block is the LAST child (nothing appended after it)', viewport.lastChild === wrap)
  check('the injected row is a real menu item', wrap.querySelector('[role="menuitem"]') !== null)
  check('the injected row is labelled with the locale string',
    wrap.querySelector('[role="menuitem"]').textContent.includes('SSH 远程工作区'),
    wrap.querySelector('[role="menuitem"]').textContent)
  check('the injected row is keyboard-reachable through the menu\'s own roving focus',
    wrap.querySelector('[role="menuitem"]').getAttribute('aria-haspopup') === 'menu')

  const existingBeforeWrap = [...viewport.children].filter(child => child !== wrap && child.getAttribute('role') === 'menuitem')
  check('no existing item was removed, moved or reordered',
    JSON.stringify(existingBeforeWrap.map(item => item.textContent)) === JSON.stringify(['重命名', '删除工作区']))

  const countBefore = viewport.querySelectorAll('[data-sshwsp-float-item]').length
  // The menu mutating again must not double-inject.
  const noise = documentDouble.createElement('span')
  viewport.appendChild(noise)
  await flush()
  check('the marker prevents a second injection',
    viewport.querySelectorAll('[data-sshwsp-float-item]').length === countBefore,
    String(viewport.querySelectorAll('[data-sshwsp-float-item]').length))

  console.log('\n[submenu: one row per configured remote, plus the actions]')
  const topButton = wrap.querySelector('[role="menuitem"]')
  dispatch(topButton, 'click', {})
  await flush()
  const sub = wrap.querySelector('[data-sshwsp-float-submenu]')
  check('a nested menu opened', sub !== null && sub.hasAttribute('data-sshwsp-float-open'))
  check('the submenu is a nested role=menu', sub.getAttribute('role') === 'menu')
  const entryRows = [...sub.querySelectorAll('[role="menuitem"]')].filter(button => button.className === 'sshwsp-fitem')
  const texts = entryRows.map(button => button.textContent)
  check('the configured entries are listed with their generated names',
    texts.some(text => text.includes('alpha · box')) && texts.some(text => text.includes('x · ghost')),
    JSON.stringify(texts))
  check('each entry carries its host address as alias@host',
    texts.some(text => text.includes('box@box.example')), JSON.stringify(texts))
  check('a mounted entry is labelled mounted', texts.some(text => text.includes('已挂载')), JSON.stringify(texts))
  check('a missing host is labelled as such', texts.some(text => text.includes('主机缺失')), JSON.stringify(texts))
  check('the add action is present', texts.some(text => text.includes('add…')), JSON.stringify(texts))
  check('the manage action is present', texts.some(text => text.includes('manage…')), JSON.stringify(texts))
  check('the exit action is absent while nothing floats', !texts.some(text => text.includes('exit floating')), JSON.stringify(texts))
  check('the entries appear before the separators and actions',
    entryRows[0].textContent.includes('alpha · box'), entryRows[0].textContent)

  console.log('\n[submenu repaints from fresh state]')
  // The list is re-read from the server while the submenu is open (another tab
  // may have mounted or deleted an entry). The repaint must replace the rows,
  // not stack a second copy of them.
  const entriesBefore = sub.querySelectorAll('[role="menuitem"]').length
  const savedItems = floatingPayload.items
  floatingPayload.items = []
  await floating.refreshFloatingEntries()
  const emptyText = sub.textContent
  check('an empty configuration shows the empty state', emptyText.includes('empty'), emptyText)
  check('...and the stale entry rows are gone',
    !emptyText.includes('alpha · box'), emptyText)
  floatingPayload.items = savedItems
  await floating.refreshFloatingEntries()
  check('a later refresh restores the rows without duplicating them',
    sub.querySelectorAll('[role="menuitem"]').length === entriesBefore,
    `${sub.querySelectorAll('[role="menuitem"]').length} vs ${entriesBefore}`)

  console.log('\n[submenu: the floating entry and its exit action]')
  lastStatusStub.push({ id: 'w-alpha', path: 'ssh://box/srv/alpha', title: 'Alpha', sessionIds: ['s1'] })
  floating.enterFloating(floatingPayload.items[0], 'w-alpha')
  // Selecting an entry closes the menu, so the next open repaints from state.
  await floating.refreshFloatingEntries()
  await flush()
  const floatingTexts = [...sub.querySelectorAll('[role="menuitem"]')].map(button => button.textContent)
  check('the entry currently floating is marked as such',
    floatingTexts.some(text => text.includes('浮动中')), JSON.stringify(floatingTexts))
  check('an exit action appears while floating',
    floatingTexts.some(text => text.includes('exit floating')), JSON.stringify(floatingTexts))
  floating.exitFloating()
  lastStatusStub.length = 0
  await floating.refreshFloatingEntries()
  await flush()
  const afterExit = [...sub.querySelectorAll('[role="menuitem"]')].map(button => button.textContent)
  check('the exit action disappears once floating is left',
    !afterExit.some(text => text.includes('exit floating')), JSON.stringify(afterExit))

  console.log('\n[submenu: hover opens and a sibling row closes]')
  // Close it, then open by hovering the injected row (core submenu semantics).
  dispatch(documentDouble.body, 'keydown', { key: 'Escape' })
  check('Escape left it closed', !sub.hasAttribute('data-sshwsp-float-open'))
  dispatch(topButton, 'mouseover', {})
  check('hovering the injected row opens the submenu', sub.hasAttribute('data-sshwsp-float-open'))
  // Hovering an unrelated row of the same menu closes it (core parity).
  const existingItem = menu.querySelector('[role="menuitem"]')
  dispatch(existingItem, 'mouseover', {})
  check('hovering another menu row closes our submenu', !sub.hasAttribute('data-sshwsp-float-open'))
  dispatch(topButton, 'click', {})
  check('the click fallback still opens it', sub.hasAttribute('data-sshwsp-float-open'))

  console.log('\n[submenu: keyboard / pointer dismissal]')
  dispatch(documentDouble.body, 'keydown', { key: 'Escape' })
  check('Escape closes the submenu but leaves the native menu alone',
    !sub.hasAttribute('data-sshwsp-float-open') && menu.isConnected)

  // Reopen and close by clicking outside.
  dispatch(topButton, 'click', {})
  dispatch(documentDouble.createElement('div'), 'pointerdown', {})
  check('a pointerdown outside closes the submenu', !sub.hasAttribute('data-sshwsp-float-open'))
  menu.remove()
  await flush()
}

// ---------------------------------------------------------------------------
console.log('\n[viewport clamp after the menu grew]')

{
  const anchor = rows['w-parent'].actions
  dispatch(anchor, 'click', {})
  const { menu } = buildMenu()
  menu.__rect = { top: 700, left: 0, right: 300, bottom: 900, width: 300, height: 200 }
  documentDouble.body.appendChild(menu)
  await flush()
  // overflow = 900 - (800 - 12) = 112 -> top = 700 - 112 = 588
  check('the taller menu is pulled back into the viewport (12px margin)',
    menu.style.top === '588px', String(menu.style.top))
  menu.remove()
  await flush()
}

// ---------------------------------------------------------------------------
console.log('\n[degrade: an unrecognized anchor leaves the menu untouched]')

{
  const strange = documentDouble.createElement('button')
  strange.setAttribute('aria-label', 'Workspace settings')   // not the core template
  documentDouble.body.appendChild(strange)
  dispatch(strange, 'click', {})
  const { menu, viewport } = buildMenu()
  documentDouble.body.appendChild(menu)
  await flush()
  check('no block is injected when the aria template does not match',
    viewport.querySelector('[data-sshwsp-float-item]') === null)
  check('...and the native menu is not otherwise modified',
    viewport.children.length === 2, String(viewport.children.length))
  menu.remove()
  strange.remove()
  await flush()
}

// ---------------------------------------------------------------------------
console.log('\n[disposer]')

{
  // The floating section's own install/uninstall must take back what it added.
  const displayDispose = floating.installFloatingWorkspaces({
    get: () => undefined,
  })
  const before = documentDouble.listenersFor('click').length
  displayDispose()
  const after = documentDouble.listenersFor('click').length
  check('uninstalling removes its document listeners', after < before, `${before} -> ${after}`)
  check('the card and its markers are gone',
    documentDouble.querySelector('[data-sshwsp-float-card]') === null &&
      documentDouble.querySelector('[data-sshwsp-float-region]') === null)
}

// The menu disposer was installed separately above; call it last.
menuDispose()

console.log(`\n=== ${passed} passed, ${failures} failed ===`)
if (failures > 0) process.exitCode = 1
