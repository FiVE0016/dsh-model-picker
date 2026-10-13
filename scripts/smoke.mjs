// Headless smoke test for dsh-model-picker.
//
// Simulates the host: __ModuleLoader__, a ctx exposing the cordis services the
// plugin injects (locale, slots, sessions, remote.session, sidebarRight,
// sidebarRightTabs, effect), plus a React stub sufficient to render the tab body
// and click a row. Verifies the two-stage native tab registration, the catalog
// read, and the selectModel call.
//
// Run: node scripts/smoke.mjs

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundle = await readFile(path.join(root, 'client.js'), 'utf8')

// ------------------------------------------------------------------- mini react

// Parent links are attached so a test can assert structural relationships
// (e.g. that an effort chip sits in the SAME row as its model button). `parent`
// makes the tree cyclic, so every text dump below must use this helper.
const linkParents = (node, parent = null) => {
  if (node == null || typeof node !== 'object') return
  node.parent = parent
  for (const child of node.children ?? []) linkParents(child, node)
}

/** Cycle-safe text dump of a node subtree (skips `parent`). */
const dump = (node) => {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node !== 'object') return ''
  let text = typeof node.textContent === 'string' ? node.textContent : ''
  for (const child of node.children ?? []) text += dump(child)
  return text
}

const React = {
  createElement(type, props, ...children) {
    const flat = children.flat(Infinity).filter((c) => c != null)
    const node = { type, props: props ?? {}, children: flat }
    // Link the whole subtree INCLUDING this node, so an ancestor walk that
    // starts at any button can reach the tab root.
    linkParents(node, null)
    return node
  },
  useState(init) { return [init, () => {}] },
  useEffect(fn) { const r = fn(); return r },
  useMemo(fn) { return fn() },
  useCallback(fn) { return fn },
  useRef(v) { return { current: v } }
}

// ------------------------------------------------------------- host ctx harness

const CATALOG = {
  default: { provider: 'hy3', model: 'hy3-x0.00', reasoningEffort: 'high' },
  routableProviders: ['hy3', 'deepseek-official'],
  groups: [
    {
      id: 'hy3',
      name: 'Hy3',
      models: [
        { id: 'hy3-x0.00', name: 'Hy3 · x0.00→免费', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' } },
        { id: 'hy3-preview', name: 'Hy4 preview · x0.29' }
      ]
    },
    {
      id: 'deepseek-official',
      name: 'DeepSeek 官方',
      models: [
        { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' },
        { id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash' }
      ]
    }
  ],
  failures: [{ id: 'broken', name: '坏来源', message: 'boom' }]
}

const calls = []
const openTabCalls = []
const directoryForCalls = []

const registeredSlots = []
const registeredTabs = []
const registeredShortcuts = []
const dictionary = { zh: {}, en: {} }
const bound = () => (key, values) => {
  const raw = dictionary.zh[key] ?? key
  return raw.replace(/\{(\w+)\}/g, (m, k) => (values && k in values ? String(values[k]) : m))
}

// The framework's slot runtime calls `registration.store.create()` to mint one
// store instance per session, then hands that instance to the inject factory.
// Reproducing that here is what caught the real "handle.create is not a
// function" crash — a plain mock that never calls create() would not.
const minted = []
/** The framework hands the minted instance's own actions to inject(). */
const instance0Actions = () => minted[0].actions
const slots = {
  register(spec, Body) {
    if (spec.store === undefined || typeof spec.store.create !== 'function') {
      throw new TypeError('handle.create is not a function')
    }
    const instance = spec.store.create('sess-1')
    minted.push(instance)
    registeredSlots.push({
      spec,
      Body,
      // The framework passes the minted instance into inject(), so the body can
      // receive its actions and a bound useStore as props.
      inject: (sessionId, actions) => {
        const face = spec.inject(sessionId, actions)
        // Reproduce bindInjectSources' discipline: every `hooks` value is used as
        // a WeakMap key, so it must be an object. A non-object here is exactly
        // the "Invalid value used as weak map key" crash.
        for (const [name, source] of Object.entries(face.hooks ?? {})) {
          if (source === null || typeof source !== 'object') {
            throw new TypeError('Invalid value used as weak map key')
          }
          const hookName = 'use' + name[0].toUpperCase() + name.slice(1)
          face[hookName] = () => source.getSnapshot()
        }
        return face
      }
    })
    return () => {}
  },
  inject: (name, factory) => factory()
}

const ctx = {
  locale: {
    register(ns, dict) { dictionary.zh = dict.zh; dictionary.en = dict.en; return () => {} },
    bind: () => bound()
  },
  sessions: { list: { getSnapshot: () => ({ byId: { 'sess-1': {} }, currentId: 'sess-1' }) } },
  remote: {
    session: {
      // Every unary remote call resolves to RemoteResult<T> — { ok, value } or
      // { ok, error } — and never rejects for a carrier problem.
      modelCatalog: async () => { calls.push(['modelCatalog']); return { ok: true, value: CATALOG } },
      selectModel: async (req) => {
        calls.push(['selectModel', req])
        return { ok: true, value: { selected: { provider: req.provider, model: req.model } } }
      }
    }
  },
  sidebarRight: { openTab: (kind) => { openTabCalls.push(kind) } },
  // The host's per-session ModelDirectory: owns the shared catalog, resolves
  // reasoning metadata, and submits the complete provider/model/effort selection.
  modelDirectories: {
    directoryFor: (sessionId) => {
      directoryForCalls.push(sessionId)
      return {
        load: async () => {
          calls.push(['directory.load'])
          return { catalog: CATALOG, current: CATALOG.default }
        },
        select: async (selection) => {
          calls.push(['directory.select', selection])
          return { ok: true, value: undefined }
        }
      }
    }
  },
  sidebarRightTabs: {
    register: (def) => { registeredTabs.push(def); return () => {} }
  },
  shortcuts: {
    register: (def) => { registeredShortcuts.push(def); return () => {} }
  },
  slots,
  effect: (fn) => { const dispose = fn(); return dispose ?? (() => {}) }
}

// The ONLY module the bundle may require is `react` (from the Vite shell).
// Anything else must come from the host's client module graph, and a package
// that is not a graph row makes the require throw — which silently kills the
// whole plugin bundle. This is the bug that produced a blank tab body.
const hostModules = {}
const registrations = []
const win = { __ModuleLoader__: { load(reg) { registrations.push(reg) } } }

const fn = new Function('window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'React', bundle)
fn.call(globalThis, win, {}, () => 1, () => {}, class { observe() {} disconnect() {} }, React)

// ------------------------------------------------------------------------ assert

const assert = (cond, msg) => { if (!cond) { console.error('FAIL ' + msg); process.exitCode = 1 } else console.log('OK   ' + msg) }

assert(registrations.length === 1, 'bundle registered exactly one module')
const reg = registrations[0]

// The resolver the host hands to factory() throws on anything outside the graph,
// so a strict resolver here reproduces the real failure mode exactly.
const required = []
const mod = reg.factory((specifier) => {
  required.push(specifier)
  if (specifier === 'react') return React
  if (hostModules[specifier]) return hostModules[specifier]
  throw new Error(`client-modules: require("${specifier}") missed the module table`)
})

assert(Array.isArray(mod.inject), 'module exposes inject array')
for (const name of ['slots', 'locale', 'sessions', 'remote', 'remote.session', 'sidebarRight', 'sidebarRightTabs']) {
  assert(mod.inject.includes(name), `inject declares ${name}`)
}
assert(!mod.inject.includes('shortcuts'), 'inject does NOT declare shortcuts (removed in 0.3.1)')
assert(typeof mod.apply === 'function', 'module exposes apply(ctx, require)')

const dispose = mod.apply(ctx, (s) => {
  required.push(s)
  if (s === 'react') return React
  throw new Error(`client-modules: require("${s}") missed the module table`)
})

// Asserted AFTER apply(), because the bundle resolves `react` inside apply().
assert(required.length > 0 && required.every((s) => s === 'react'),
  `bundle requires only react (got ${JSON.stringify(required)})`)

// Stage 1: tab type registered with the right shape.
assert(registeredTabs.length === 1, `one tab type registered (got ${registeredTabs.length})`)
const def = registeredTabs[0]
assert(def.id === 'dsh-model-picker', `tab id is the plugin id (got ${def.id})`)
assert(def.kind === 'model-picker', `tab kind (got ${def.kind})`)
assert(def.priority === 'extension', `priority is extension (got ${def.priority})`)
assert(typeof def.title === 'function', 'definition has a title()')
assert(def.title() === '模型', `title() resolves through the dictionary (got "${def.title()}")`)
assert(Array.isArray(def.guide) && def.guide.length === 1, 'definition lists a guide entry')

// Stage 2: body registered under the same key.
const bodyRows = registeredSlots.filter((r) => r.spec?.name === 'sidebar.right.pane.tab')
assert(bodyRows.length === 1, `one tab body registered (got ${bodyRows.length})`)
assert(bodyRows[0].spec.key === def.id, `body key matches the definition id (got ${bodyRows[0].spec.key})`)
assert(typeof bodyRows[0].Body === 'function', 'body is a React component')

// No load happens before the framework mints an instance — the plugin must not
// mint a throwaway of its own, or `latest()` would point at the wrong store.
await new Promise((r) => setTimeout(r, 20))
assert(calls.length === 0, 'no catalog load before the framework mints a store')
assert(minted.length === 1, `framework minted exactly one store instance (got ${minted.length})`)

// 0.3.1: no shortcuts are registered. The tab is opened only by clicking its
// entry in the right-sidebar tab strip; the plugin stays out of the host's
// shortcut table entirely. This assertion locks that guarantee in place.
assert(registeredShortcuts.length === 0, `no shortcuts registered (got ${registeredShortcuts.length})`)

// Render the body the way the seat does: inject(sessionId, actions) returns the
// props, and the framework supplies the bound useStore for the minted instance.
const injected = bodyRows[0].inject('sess-1', instance0Actions())
const instance = minted[0]
assert(typeof instance.getSnapshot === 'function' && typeof instance.subscribe === 'function',
  'minted instance exposes getSnapshot/subscribe')
assert(typeof instance.actions?.setCatalog === 'function', 'minted instance exposes actions')

// inject() kicks the catalog load into the real instance; let it settle.
await new Promise((r) => setTimeout(r, 20))
const held = instance.getSnapshot()
assert(held.catalog !== null, 'the minted instance holds the catalog')
// The plugin must unwrap RemoteResult<T>: feeding the raw { ok, value } wrapper
// into the store leaves `groups` undefined and renders an empty panel.
assert(Array.isArray(held.catalog.groups) && held.catalog.groups.length === 2,
  `catalog unwrapped from RemoteResult (groups=${held.catalog?.groups?.length})`)
assert(held.catalog.default?.model === 'hy3-x0.00',
  `current model read from catalog.default (got ${held.catalog?.default?.model})`)
assert(held.loading === false && held.error === null, 'load settled without error')

// The catalog must come from the host's own per-session directory, so this tab
// and the composer's selector always agree.
assert(calls.some(([m]) => m === 'directory.load'), 'catalog loaded through ctx.modelDirectories')
assert(directoryForCalls.includes('sess-1'), 'directoryFor called with the active session')

const Body = bodyRows[0].Body
const tree = Body({
  ...injected,
  useStore: (selector) => selector(instance.getSnapshot()),
  sessionId: 'sess-1'
})
const findButtons = (node, out = []) => {
  if (node == null || typeof node !== 'object') return out
  if (node.type === 'button' && typeof node.props?.onClick === 'function') out.push(node)
  for (const child of node.children ?? []) findButtons(child, out)
  return out
}
const buttons = findButtons(tree)
const modelButtons = buttons.filter((b) => /deepseek-v4-pro|Hy3|hy3/.test(dump(b)))
assert(modelButtons.length >= 2, `panel renders model rows (got ${modelButtons.length})`)

// Reasoning efforts render as their own clickable chips, not a "N 档" badge.
const effortButtons = buttons.filter((b) => /^(Low|High)$/.test(dump(b).trim()))
assert(effortButtons.length === 2, `effort chips render for the model with reasoning (got ${effortButtons.length})`)

// Model and its efforts must share ONE row: the chips are siblings of the model
// button inside the same flex container, never a nested/stacked second row.
const chipHost = effortButtons[0]
/** Walk up to the container that also holds a model-name button. */
const rowOf = (node) => {
  let current = node
  while (current) {
    const siblings = current.children ?? []
    if (siblings.some((s) => s.type === 'button' && /deepseek-v4-pro|Hy3|hy3/.test(dump(s)))) {
      return current
    }
    current = current.parent
  }
  return null
}
const sharedRow = rowOf(chipHost)
assert(sharedRow !== null, 'effort chips share one row with the model button')
if (sharedRow) {
  // Styles live on props.style in this React stub.
  const style = sharedRow.props?.style ?? {}
  assert(style.display === 'flex', `the shared row is a flex container (got ${style.display})`)
  const kinds = (sharedRow.children ?? []).map((c) => c.type)
  assert(kinds.includes('button') && kinds.includes('span'),
    `model button and effort chips are siblings (children: ${kinds.join(', ')})`)
  const chips = sharedRow.children.find((c) => c.type === 'span')
  assert((chips?.children ?? []).length === 2 && (chips?.children ?? []).every((c) => c.type === 'button'),
    'both effort chips live in the same row as the model button')

  // Clipping guard: a row of 5+ efforts overflows a fixed-width flex line, so the
  // row must be allowed to wrap and the chips must not be pinned at full size.
  assert(style.flexWrap === 'wrap', `the row wraps instead of clipping (got ${style.flexWrap})`)
  const pad = String(style.padding ?? '')
  const padMatch = pad.match(/^(\d+)px/)
  assert(padMatch !== null && Number(padMatch[1]) >= 4,
    `the row keeps a side gutter (padding: ${pad})`)
  const chipStyle = chips.children[0]?.props?.style ?? {}
  assert(chipStyle.flex === '0 0 auto', 'chips never shrink below their text')
  assert(chipStyle.whiteSpace === 'nowrap', 'chip text never breaks mid-word')
  const chipGroupStyle = chips.props?.style ?? {}
  assert(chipGroupStyle.flexWrap === 'wrap',
    `the chip group itself wraps (got ${chipGroupStyle.flexWrap})`)

  // The chip group must receive the LEFTOVER WIDTH (flex 1 1 auto), not just its
  // intrinsic content width. With flex 0 1 auto it never gets enough room to
  // wrap, so a 5-chip row pushes the last chip past the panel edge and it is
  // clipped — the exact symptom reported.
  assert(chipGroupStyle.flex === '1 1 auto',
    `the chip group takes the leftover width so it can wrap (got ${chipGroupStyle.flex})`)
  assert(chipGroupStyle.minWidth === 0,
    `the chip group may shrink below its content width (got ${chipGroupStyle.minWidth})`)

  // Ancestor chain: EVERY layer from the tab root down to this row must allow
  // shrinking. One min-width or overflow:hidden above re-clips the last chip.
  const ancestors = []
  for (let n = sharedRow.parent; n; n = n.parent) ancestors.push(n)
  assert(ancestors.length >= 3, `the row sits under the body and group boxes (${ancestors.length} ancestors)`)
  for (const [index, node] of ancestors.entries()) {
    const s = node.props?.style ?? {}
    assert(s.overflow !== 'hidden' && s.overflowX !== 'hidden',
      `ancestor #${index} (${node.type}) does not clip horizontally`)
    assert(s.minWidth === undefined || s.minWidth === 0,
      `ancestor #${index} (${node.type}) may shrink (minWidth=${s.minWidth})`)

    // A rounded frame with no padding lets its children's backgrounds (the rows,
    // and their hover/active fill) poke outside the corner curve. Any ancestor
    // that draws a background AND a radius must also inset its children.
    if (s.background && s.background !== 'transparent' && s.borderRadius) {
      assert(typeof s.padding === 'string' && /\d/.test(s.padding),
        `ancestor #${index} (${node.type}) insets its children inside its radius (padding=${s.padding})`)
    }
  }
}

const flatText = dump(tree)
assert(flatText.includes('hy3-x0.00'), 'panel shows the current model')
assert(flatText.includes('deepseek-v4-pro'), 'panel lists DeepSeek models')
assert(flatText.includes('坏来源'), 'panel surfaces the provider failure')
assert(flatText.includes('DeepSeek 官方'), 'panel shows the group heading')
assert(!flatText.includes('status.current'), 'body translates through the injected t, not raw keys')

// Click a model row -> the shared directory submits the full selection.
const target = modelButtons.find((b) => dump(b).includes('deepseek-v4-pro'))
target.props.onClick()
await new Promise((r) => setTimeout(r, 20))

const dirSelects = calls.filter(([m]) => m === 'directory.select')
assert(dirSelects.length === 1, `exactly one directory.select call (got ${dirSelects.length})`)
assert(dirSelects[0][1].provider === 'deepseek-official', 'selection sent the right provider')
assert(dirSelects[0][1].model === 'deepseek-v4-pro', 'selection sent the right model')

// Click an effort chip -> same model, different effort (the whole point).
const before = calls.filter(([m]) => m === 'directory.select').length
effortButtons[0].props.onClick({ stopPropagation() {} })
await new Promise((r) => setTimeout(r, 20))
const effortSelects = calls.filter(([m]) => m === 'directory.select')
assert(effortSelects.length === before + 1, 'clicking an effort chip submits a selection')
const last = effortSelects[effortSelects.length - 1][1]
assert(last.model === 'hy3-x0.00', 'effort change keeps the active model')
assert(last.reasoningEffort === 'low', `effort change sends the clicked effort (got ${last.reasoningEffort})`)

// Multi-session regression (0.3.1): the framework mints one store per session
// and calls inject() for each. `live` is module-level and must rebind on every
// inject, otherwise a second session's store never gets filled and its panel
// comes up blank — the "opens empty on every new conversation" bug. This test
// mints a second instance the way the framework would and verifies the second
// inject actually reaches it.
{
  const storeHandle = bodyRows[0].spec.store
  assert(typeof storeHandle?.create === 'function', 'store handle exposes create()')
  const beforeLatest = storeHandle.latest()
  const second = storeHandle.create()
  assert(second !== beforeLatest, 'storeHandle.create() mints a distinct instance')
  assert(storeHandle.latest() === second, 'storeHandle.latest() points at the newest instance')
  assert(second.getSnapshot().catalog === null, 'second store starts empty')
  bodyRows[0].inject('sess-2', second.actions)
  await new Promise((r) => setTimeout(r, 20))
  assert(second.getSnapshot().catalog !== null,
    'the second session\'s store is filled too (regression: blank on every new conversation)')
}

// Disposal must not throw.
assert(typeof dispose === 'function', 'apply() returns a disposer')
dispose()

// Resilience: a host that lacks an optional service must not kill the fiber.
// This is the failure mode that produced a blank body — an unguarded
// ctx.shortcuts.register threw inside apply() and the whole plugin went dark.
{
  const sparseRegs = []
  const sparseWin = { __ModuleLoader__: { load(reg) { sparseRegs.push(reg) } } }
  new Function('window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'React', bundle)
    .call(globalThis, sparseWin, {}, () => 1, () => {}, class { observe() {} disconnect() {} }, React)
  const sparseMod = sparseRegs[0].factory((s) => (s === 'react' ? React : hostModules[s]))
  const sparseCtx = {
    ...ctx,
    slots: {
      register: (spec, Body) => { registeredSlots.push({ spec, Body }); return () => {} },
      inject: (name, factory) => factory()
    },
    sidebarRightTabs: { register: (def) => { registeredTabs.push(def); return () => {} } }
  }
  delete sparseCtx.shortcuts
  let threw = null
  let sparseDispose = null
  try {
    sparseDispose = sparseMod.apply(sparseCtx, (s) => (s === 'react' ? React : hostModules[s]))
  } catch (error) {
    threw = error
  }
  assert(threw === null, `apply() survives a host without ctx.shortcuts (${threw && threw.message})`)
  if (sparseDispose) sparseDispose()
}

console.log(process.exitCode ? '\nSMOKE FAILED' : '\nSMOKE PASSED')
