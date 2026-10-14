// dsh-model-picker — native right-sidebar tab for browsing and switching models.
//
// Registers a real tab type in the host's right sidebar (the same two-stage
// public path the host's own dsh-client-ui-sidebar-files walks), lists every
// model the host currently advertises grouped by provider, highlights the
// active one, and switches the session model on click through the host's own
// remote API.
//
// Host API (verified against the desktop bundle):
//   ctx.sidebarRightTabs.register({ id, kind, priority, title, guide? })
//   ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name, key, locale, store, inject }, Body))
//   ctx.sidebarRight.openTab(kind, options?)
//   ctx.remote.session.modelCatalog()  -> { default, routableProviders, groups[], failures[] }
//   ctx.remote.session.selectModel({ sessionId, provider, model, reasoningEffort? }) -> { selected }
//   ctx.sessions.list.getSnapshot()    -> { byId, currentId }
//   useTabInfo() inside the body        -> { sidebar, panel, tab }

const NS = 'dsh-model-picker'
const TAB_ID = NS
const TAB_KIND = 'model-picker'

/** Cordis service names this client fiber wants injected. */
export const inject = [
  'slots',
  'locale',
  'sessions',
  'modelDirectories',
  'remote',
  'remote.session',
  'sidebarRight',
  'sidebarRightTabs'
]

/** Dictionary: zh is the key-set source of truth. */
const zh = {
  'type.label': '模型',
  'guide.title': '模型',
  'guide.description': '浏览并切换本会话可用的全部模型',
  'empty.models': '没有可用的模型。',
  'empty.search': '没有匹配的模型。',
  'status.loading': '正在刷新模型列表…',
  'status.current': '当前',
  'status.reloading': '正在刷新模型列表…',
  'error.load': '目录加载失败：{message}',
  'error.switch': '切换失败：{message}',
  'error.noSession': '未找到当前会话，无法切换模型。',
  'error.noApi': '模型接口不可用。',
  'search.placeholder': '搜索模型…',
  'action.refresh': '刷新',
  'action.refreshing': '刷新中…',
  'group.count': '{count} 个模型',
  'group.failed': '{name} 加载失败：{message}',
  'badge.efforts': '{count} 档推理',
  'badge.current': '当前'
}

const en = {
  'type.label': 'Models',
  'guide.title': 'Models',
  'guide.description': 'Browse and switch every model available to this session',
  'empty.models': 'No models available.',
  'empty.search': 'No matching models.',
  'status.loading': 'Refreshing the model list…',
  'status.current': 'Current',
  'status.reloading': 'Refreshing the model list…',
  'error.load': 'Catalog failed to load: {message}',
  'error.switch': 'Switch failed: {message}',
  'error.noSession': 'No active session; cannot switch models.',
  'error.noApi': 'The model API is unavailable.',
  'search.placeholder': 'Search models…',
  'action.refresh': 'Refresh',
  'action.refreshing': 'Refreshing…',
  'group.count': '{count} models',
  'group.failed': '{name} failed to load: {message}',
  'badge.efforts': '{count} effort levels',
  'badge.current': 'Current'
}

/** Fill a `{placeholder}` template with values. */
function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (values && key in values ? String(values[key]) : match))
}

/** Last-resort translator: the zh table, so the body never renders raw keys. */
const fallbackT = (key, values) => fill(zh[key] ?? key, values)

/**
 * A snapshot store with the face the host's `createSnapshotStore` exposes:
 * `getSnapshot()` / `subscribe(fn)` / `set(next)` / `update(mutator)`.
 */
function createSnapshotStore(initial) {
  let value = initial
  const listeners = new Set()
  const notify = () => { for (const fn of [...listeners]) fn() }
  return {
    getSnapshot: () => value,
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    set(next) {
      if (next === value) return
      value = next
      notify()
    },
    update(mutator) {
      const draft = { ...value }
      mutator(draft)
      this.set(draft)
    }
  }
}

/**
 * A store handle with the face the host's `defineStore` returns, because
 * `ctx.slots.register({ store })` calls `store.create()` on it:
 *
 *   { spec, create(scopeKey) -> { actions, getSnapshot, subscribe, store } }
 *
 * The framework mints one instance per session from a factory, so the
 * registration must declare a FACTORY, never a shared live store. Handing it a
 * live store crashes the slot with "handle.create is not a function".
 *
 * Implemented locally rather than `require()`-ing @deepseek-ai/dsh-client-store:
 * that package is a shell-registered module (not a graph row), and requiring it
 * from a plugin bundle is a gamble this plugin does not need to take. The shape
 * below matches the host's contract exactly.
 */
/** Scope key the framework uses when a store has no session binding (scope: 'root'). */
const ROOT_SCOPE_KEY = '__root__'

function defineStore(decl) {
  // Every instance this handle mints, newest last. The slot framework does not
  // hand the instance to the inject factory (it passes sessionId + actions), so
  // the plugin recovers the live instance through this ledger.
  const minted = []
  // The framework mints ONE instance per scope key and caches it:
  // renderer `resolveStore(handle, scopeBinding)` does `handle.create(key)` with
  // `key = scopeBinding.key`, i.e. the SESSION ID (client-ui-renderer L1688-1704).
  // So the ledger must be keyed by that same scope key.
  //
  // Why this matters: `latest()` is "the most recently minted instance", which in
  // a multi-session window belongs to whichever session minted last -- NOT
  // necessarily the one this panel renders. Writing the catalog into that other
  // instance leaves THIS panel reading its own empty state: "没有可用的模型。",
  // an empty "当前：", and no error anywhere. Taking the instance for the panel's
  // own session id is the fix.
  const byScope = new Map()
  return {
    spec: decl,
    create(scopeKey) {
      const store = createSnapshotStore(decl.init())
      const actions = {}
      for (const key of Object.keys(decl.actions ?? {})) {
        const mutate = decl.actions[key]
        actions[key] = (...params) => {
          store.update((draft) => { mutate(draft, ...params) })
        }
      }
      const instance = {
        actions,
        getSnapshot: () => store.getSnapshot(),
        subscribe: (fn) => store.subscribe(fn),
        store
      }
      minted.push(instance)
      byScope.set(scopeKey === undefined || scopeKey === null ? ROOT_SCOPE_KEY : scopeKey, instance)
      return instance
    },
    /** The instance the framework minted for one scope key (session id), or null. */
    forScope: (scopeKey) => byScope.get(scopeKey === undefined || scopeKey === null ? ROOT_SCOPE_KEY : scopeKey) ?? null,
    /** The most recently minted instance, or null before the framework called create(). */
    latest: () => (minted.length > 0 ? minted[minted.length - 1] : null)
  }
}

export function apply(ctx, require) {
  const t = ctx.locale.bind(NS)
  const React = require('react')
  const { useCallback, useEffect, useMemo, useRef, useState } = React

  // ------------------------------------------------------------------ icons

  // The host's built-in icon set (@deepseek-ai/dsh-client-ui-primitives) has no
  // whale glyph, so the model-picker contributes its own. The signature matches
  // the IconProps contract ({size, className}) the host's icon components
  // expose, and fill="currentColor" inherits the chip's text colour.
  function WhaleIcon({ size = 16, className }) {
    return React.createElement('svg', {
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      className,
      fill: 'currentColor',
      xmlns: 'http://www.w3.org/2000/svg'
    },
      // Body
      React.createElement('path', {
        d: 'M2.5 9C2.5 6.5 4.5 5 7 5h3c1.5 0 3 1 3.5 2.5L15 9l-1.5 1.5C12.5 12 10 12 8 12H5.5C3.5 12 2.5 10.5 2.5 9z'
      }),
      // Tail fin
      React.createElement('path', {
        d: 'M12 7l2-1v4l-2-1z'
      }),
      // Eye
      React.createElement('circle', { cx: '5.5', cy: '8.5', r: '0.5', fill: '#fff' }),
      // Water spout
      React.createElement('path', {
        d: 'M7 3v2M6 3.5c0 .5.5 1 1 1s1-.5 1-1'
      })
    )
  }

  // ------------------------------------------------------------------ the store

  // The per-session instance the framework mints for this registration. Kept
  // here so the eager load and the reload/select actions can drive it.
  let live = null
  // The sessionId the framework itself handed to inject(). Guessing the session
  // (from the sessions list) can pick a wrong or stale one, and selectModel then
  // silently targets nothing — the "click does not switch" failure.
  let boundSessionId = null

  const storeHandle = defineStore({
    init: () => ({
      catalog: null,
      loading: false,
      switching: false,
      error: null,
      filter: ''
    }),
    actions: {
      setCatalog: (d, catalog) => { d.catalog = catalog },
      setLoading: (d, loading) => { d.loading = loading },
      setSwitching: (d, switching) => { d.switching = switching },
      setError: (d, error) => { d.error = error },
      setFilter: (d, filter) => { d.filter = filter }
    }
  })

  /** The framework-given sessionId first, the sessions list only as backup. */
  const currentSessionId = () => {
    if (boundSessionId !== null) return boundSessionId
    try {
      const snap = ctx.sessions?.list?.getSnapshot?.()
      if (snap) {
        if (snap.currentId) return snap.currentId
        const ids = Object.keys(snap.byId ?? {})
        if (ids.length > 0) return ids[ids.length - 1]
      }
    } catch { /* fall through */ }
    return null
  }

  // The host's own model surface drives everything through the per-session
  // ModelDirectory (ctx.modelDirectories.directoryFor): it owns the shared
  // catalog, resolves reasoning metadata, guards selection with a generation
  // counter, and publishes `pending`. Using it keeps this tab and the composer's
  // own selector showing the same thing after either one switches.
  const directoryFor = (sessionId) => {
    const resolver = ctx.modelDirectories
    if (typeof resolver?.directoryFor !== 'function') return null
    try {
      return resolver.directoryFor(sessionId) ?? null
    } catch {
      return null
    }
  }

  /** Reasoning metadata for one provider/model, straight from the catalog. */
  const reasoningFor = (catalog, provider, modelId) => {
    const group = (catalog?.groups ?? []).find((g) => g.id === provider)
    const model = (group?.models ?? []).find((m) => m.id === modelId)
    return model?.reasoning
  }

  const api = () => ctx.remote?.session
  const apiReady = () => {
    const face = api()
    return typeof face?.modelCatalog === 'function' && typeof face?.selectModel === 'function'
  }

  /** Declared initial state, used until this session's instance is minted. */
  const EMPTY_STATE = { catalog: null, loading: false, switching: false, error: null, filter: '' }

  /**
   * The store instance THIS panel renders: the one the framework minted for the
   * panel's own session id. `live` / `latest()` are only a fallback for a host
   * that hands no session id — never the primary path, because `latest()` is
   * "whatever session minted last" and in a multi-session window that is a
   * different instance than the panel's (see defineStore above).
   */
  const liveInstance = (sessionId = currentSessionId()) => {
    if (sessionId !== null) {
      const scoped = storeHandle.forScope(sessionId)
      if (scoped !== null) return scoped
    }
    return live ?? storeHandle.latest()
  }

  /** Snapshot of this panel's own instance, or the declared initial state. */
  const snapshot = () => {
    const instance = liveInstance()
    return instance !== null ? instance.getSnapshot() : EMPTY_STATE
  }

  /** Re-read the catalog. Exposed to the body as the `reload` action. */
  const reload = () => { void load() }

  // ---- 启动早期目录为空时的自动重试（「重启后没有可用模型」的病根修复）----
  // 宿主刚启动时，模型渠道（providers）是异步加载的：remote 面已经可用，但
  // 目录还是空（groups 为空数组）。旧逻辑把空目录当作结果缓存下来，面板就
  // 永远空；刷新页面时渠道已就绪，才恢复——这就是「每次重启必空、刷新就好」
  // 的完整闭环（探针实测：重启后 groups=0、刷新后 groups=24）。
  // 现在：目录为空 = 尚未就绪 → 不缓存、定时重试，渠道就绪后列表自己出现；
  // 超过上限才按「真没有模型」显示。
  const EMPTY_CATALOG_RETRY_MS = 2000
  const EMPTY_CATALOG_MAX_RETRIES = 30   // 最长约 60 秒
  let emptyCatalogRetries = 0

  /** 目录为空时安排一次重试；返回 true 表示「已安排，调用方应结束本次加载」。 */
  const retryIfEmptyCatalog = (catalog) => {
    if ((catalog?.groups?.length ?? 0) > 0) {
      emptyCatalogRetries = 0
      return false
    }
    if (emptyCatalogRetries < EMPTY_CATALOG_MAX_RETRIES) {
      emptyCatalogRetries += 1
      setTimeout(() => { void load() }, EMPTY_CATALOG_RETRY_MS)
      return true
    }
    console.warn(`[${NS}] 宿主目录持续为空（已重试 ${EMPTY_CATALOG_MAX_RETRIES} 次），按空目录显示`)
    return false
  }

  async function load() {
    // Resolve the instance by SESSION, not by "last minted": renderer.resolveStore
    // mints one instance per session id, so latest() may belong to another session.
    const sessionId = currentSessionId()
    const instance = liveInstance(sessionId)
    if (instance === null) {
      // Nothing to write into yet (this session's instance is not minted).
      // Say so instead of vanishing — a silent return here is exactly how
      // "panel is empty and no error anywhere" used to happen.
      console.warn(`[${NS}] load(): 本会话的 store 实例还没 mint 出来，本次加载跳过`)
      return
    }
    if (sessionId === null) {
      instance.actions.setError(t('error.noSession'))
      return
    }
    const directory = directoryFor(sessionId)
    if (directory === null) {
      // Fall back to the raw remote face when the model-selection service is
      // unavailable (older host, or a session type that opts out).
      if (!apiReady()) {
        instance.actions.setError(t('error.noApi'))
        return
      }
      instance.actions.setLoading(true)
      instance.actions.setError(null)
      try {
        const result = await api().modelCatalog()
        if (result?.ok !== true) {
          instance.actions.setLoading(false)
          instance.actions.setError(t('error.load', { message: result?.error?.message ?? '未知错误' }))
          return
        }
        instance.actions.setLoading(false)
        if (retryIfEmptyCatalog(result.value)) return
        instance.actions.setCatalog(result.value)
        instance.actions.setError(null)
      } catch (error) {
        instance.actions.setLoading(false)
        instance.actions.setError(t('error.load', { message: error instanceof Error ? error.message : String(error) }))
      }
      return
    }

    instance.actions.setLoading(true)
    instance.actions.setError(null)
    try {
      // The directory owns the shared catalog and the durable projection, so
      // `current` reflects what the composer's own selector would show.
      const value = await directory.load()
      
      // Handle both structures:
      // 1. {catalog: {groups, default}} or {value: {groups, default}} (old/wrapped)
      // 2. {groups, current, routable, failures, status, pending, error} (new/raw)
      const catalog = value.catalog ?? value.value ?? {
        groups: value.groups ?? [],
        default: value.current ?? null
      }
      
      instance.actions.setLoading(false)
      if (retryIfEmptyCatalog(catalog)) return
      instance.actions.setCatalog(catalog)
      instance.actions.setError(null)
    } catch (error) {
      instance.actions.setLoading(false)
      instance.actions.setError(t('error.load', { message: error instanceof Error ? error.message : String(error) }))
    }
  }

  /**
   * Apply a complete selection: provider + model + optional reasoning effort.
   * Switching only the effort keeps provider/model and re-submits.
   */
  async function select(provider, modelId, effort) {
    // Same as load(): resolve the instance by session, not by "last minted".
    const sessionId = currentSessionId()
    const instance = liveInstance(sessionId)
    if (instance === null) {
      console.warn(`[${NS}] select(): 本会话的 store 实例还没 mint 出来，忽略这次切换`)
      return
    }
    if (sessionId === null) {
      instance.actions.setError(t('error.noSession'))
      return
    }
    const directory = directoryFor(sessionId)
    if (directory === null) {
      if (!apiReady()) {
        instance.actions.setError(t('error.noApi'))
        return
      }
    }

    const current = snapshot()
    const previous = current.catalog?.default
    // Same model, only the effort changes: keep the provider/model and re-submit.
    const sameModel = previous?.provider === provider && previous?.model === modelId
    const nextProvider = sameModel ? previous.provider : provider
    const nextModel = sameModel ? previous.model : modelId
    const nextEffort = effort ?? (sameModel
      ? previous?.reasoningEffort
      : reasoningFor(current.catalog, nextProvider, nextModel)?.defaultEffort)

    // Optimistic: the chip flips immediately so the click feels instant.
    instance.actions.setSwitching(true)
    instance.actions.setError(null)
    instance.actions.setCatalog(current.catalog && previous
      ? {
          ...current.catalog,
          default: {
            provider: nextProvider,
            model: nextModel,
            ...nextEffort === void 0 ? {} : { reasoningEffort: nextEffort }
          }
        }
      : current.catalog)

    const selection = {
      provider: nextProvider,
      model: nextModel,
      ...nextEffort === void 0 ? {} : { reasoningEffort: nextEffort }
    }

    let result
    try {
      result = directory === null
        ? await api().selectModel({ sessionId, ...selection })
        : await directory.select(selection)
    } catch (error) {
      instance.actions.setSwitching(false)
      instance.actions.setError(t('error.switch', { message: error instanceof Error ? error.message : String(error) }))
      void load()
      return
    }

    if (result?.ok !== true) {
      instance.actions.setSwitching(false)
      instance.actions.setError(t('error.switch', { message: result?.error?.message ?? '未知错误' }))
      void load()
      return
    }

    const latest = snapshot()
    instance.actions.setSwitching(false)
    instance.actions.setError(null)
    const selected = directory === null ? result.value?.selected : null
    if (selected) {
      instance.actions.setCatalog(latest.catalog && latest.catalog.default
        ? { ...latest.catalog, default: { ...selected } }
        : latest.catalog)
    }
  }

  // ------------------------------------------------------------- the tab body

  // The seat passes the injected object in as props, so the body reads its
  // dependencies from them: `useStore` is the framework-bound reader for the
  // `store` this registration declared, `t` the namespace translator, and
  // `reload` / `select` this plugin's own actions.
  const Body = (props) => {
    const useStore = props?.useStore
    const storeActions = props?.actions
    const translate = typeof props?.t === 'function' ? props.t : fallbackT
    const reloadAction = typeof props?.reload === 'function' ? props.reload : reload
    const selectAction = typeof props?.select === 'function' ? props.select : select

    // Read through the framework hook when it is available; fall back to a
    // local subscription so the body still renders if props arrive differently.
    const fallback = useState(() => snapshot())
    const local = useStore ? undefined : fallback
    useEffect(() => {
      if (useStore || !live) return
      return live.subscribe(() => local[1](live.getSnapshot()))
    }, [useStore])

    const state = useStore ? useStore((s) => s) : local[0]
    const { catalog, loading, switching, error, filter } = state ?? snapshot()

    const groups = useMemo(() => {
      const needle = (filter ?? '').trim().toLowerCase()
      return (catalog?.groups ?? []).map((group) => ({
        ...group,
        models: needle
          ? (group.models ?? []).filter((m) => `${group.name ?? ''} ${m.name ?? ''} ${m.id ?? ''}`.toLowerCase().includes(needle))
          : (group.models ?? [])
      })).filter((group) => group.models.length > 0)
    }, [catalog, filter])

    const shown = groups.reduce((sum, g) => sum + g.models.length, 0)

    // Display name of the active effort, resolved from the same catalog.
    const effortLabel = (() => {
      const def = catalog?.default
      if (!def?.reasoningEffort) return null
      const efforts = reasoningFor(catalog, def.provider, def.model)?.efforts ?? []
      return efforts.find((e) => e.id === def.reasoningEffort)?.name ?? def.reasoningEffort
    })()

    const setFilter = useCallback((value) => {
      (storeActions ?? live?.actions)?.setFilter?.(value)
    }, [storeActions])

    // One row: the model name on the left selects the model; the effort chips on
    // the right select the reasoning level. Two sibling buttons inside one flex
    // row — never nested, which would be invalid HTML and break the click.
    const row = (group, model) => {
      const active = !!catalog?.default && catalog.default.provider === group.id && catalog.default.model === model.id
      const efforts = model.reasoning?.efforts ?? []
      const selectedEffort = active
        ? (catalog.default.reasoningEffort ?? model.reasoning?.defaultEffort)
        : model.reasoning?.defaultEffort

      const rowStyle = {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '2px 8px',
        width: '100%',
        boxSizing: 'border-box',
        // Every ancestor must let this row shrink: a single min-width anywhere
        // above forces the row wider than the tab and clips the last chip.
        minWidth: 0,
        padding: '5px 6px',
        borderRadius: 8,
        background: active ? 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.22))' : 'transparent'
      }

      // Left: the model itself. It shrinks first so the chips always keep room.
      const modelButton = React.createElement(
        'button',
        {
          key: 'pick',
          type: 'button',
          disabled: switching,
          onClick: () => void selectAction(group.id, model.id, undefined),
          title: model.name || model.id,
          'aria-current': active ? 'true' : 'false',
          style: {
            flex: '0 1 auto',
            minWidth: 0,
            maxWidth: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            border: 0,
            padding: '3px 2px',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            textAlign: 'left',
            cursor: switching ? 'progress' : 'pointer',
            opacity: switching ? 0.6 : 1
          }
        },
        React.createElement('span', {
          style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
        }, model.name || model.id),
        active && React.createElement('span', { style: { flex: '0 0 auto', fontSize: 12, opacity: 0.9 } }, '✓')
      )

      const children = [modelButton]

      // Right: the effort chips, only when the adapter publishes them.
      //
      // The group takes all the width the model name leaves (flex: 1 1 auto with
      // minWidth: 0) and wraps internally. Giving it the leftover WIDTH rather
      // than only its intrinsic content width is what lets a 5-chip row break
      // onto a second line instead of pushing the last chip past the panel edge.
      if (efforts.length > 0) {
        children.push(React.createElement(
          'span',
          {
            key: 'efforts',
            style: {
              flex: '1 1 auto',
              minWidth: 0,
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 3,
              marginLeft: 0
            }
          },
          efforts.map((effort) => {
            const on = selectedEffort === effort.id
            return React.createElement(
              'button',
              {
                key: effort.id,
                type: 'button',
                disabled: switching,
                title: effort.description ?? effort.name,
                onClick: (event) => {
                  event.stopPropagation()
                  void selectAction(group.id, model.id, effort.id)
                },
                'aria-pressed': on ? 'true' : 'false',
                style: {
                  border: 0,
                  borderRadius: 100,
                  padding: '2px 7px',
                  fontSize: 10,
                  lineHeight: '15px',
                  whiteSpace: 'nowrap',
                  flex: '0 0 auto',
                  cursor: switching ? 'progress' : 'pointer',
                  background: on ? 'var(--dsw-alias-button-fill, #555)' : 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.2))',
                  color: on ? 'var(--dsw-alias-label-on-primary, #fff)' : 'var(--dsw-alias-label-secondary, #aaa)',
                  fontWeight: on ? 600 : 400
                }
              },
              effort.name ?? effort.id
            )
          })
        ))
      }

      return React.createElement('div', {
        key: `${group.id}/${model.id}`,
        style: rowStyle
      }, children)
    }

    return React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          // THE layout fix: with the default content-box, `width: 100%` sizes
          // only the content and ADDS padding on top, so every padded row and
          // group box came out ~12px wider than the tab — pushing chips past
          // the rounded frame and clipping the last letters. Border-box makes
          // width include padding, so 100% really means "fits the parent".
          boxSizing: 'border-box',
          minWidth: 0,
          maxWidth: '100%',
          font: '400 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif',
          color: 'var(--dsw-alias-label-primary, #eee)'
        }
      },
      // Current model + refresh
      React.createElement(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 8px', flex: '0 0 auto' } },
        React.createElement(
          'div',
          { style: { flex: '1 1 auto', minWidth: 0, fontSize: 12, color: 'var(--dsw-alias-label-secondary, #9a9a9a)' } },
          translate('status.current') + '：',
          React.createElement('b', {
            style: { color: 'var(--dsw-alias-label-primary, #eee)', fontWeight: 600, marginLeft: 4 }
          }, catalog?.default?.model ?? '—'),
          effortLabel
            ? React.createElement('span', { style: { marginLeft: 6, opacity: 0.85 } }, `· ${effortLabel}`)
            : null,
          catalog?.default?.provider
            ? React.createElement('span', { style: { marginLeft: 4, opacity: 0.75 } }, `(${catalog.default.provider})`)
            : null
        ),
        React.createElement('button', {
          type: 'button',
          onClick: reloadAction,
          disabled: loading,
          title: translate('action.refresh'),
          style: {
            flex: '0 0 auto',
            width: 28,
            height: 28,
            border: 0,
            borderRadius: 8,
            background: 'transparent',
            color: 'inherit',
            cursor: loading ? 'progress' : 'pointer',
            opacity: loading ? 0.5 : 1
          }
        }, loading ? '…' : '⟳')
      ),
      // Search
      React.createElement(
        'div',
        { style: { padding: '0 12px 8px', flex: '0 0 auto' } },
        React.createElement('input', {
          type: 'search',
          value: filter,
          placeholder: translate('search.placeholder'),
          onChange: (event) => setFilter(event.target.value),
          style: {
            width: '100%',
            height: 32,
            padding: '0 10px',
            borderRadius: 8,
            border: '1px solid var(--dsw-alias-divider, rgba(127,127,127,.3))',
            background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08))',
            color: 'inherit',
            font: 'inherit',
            outline: 'none'
          }
        })
      ),
      // Body. The horizontal padding IS the gutter the chips need: too little
      // and the rightmost chip's last letter gets clipped by the panel edge.
      // Vertical scrolling only — horizontal wrapping is handled by the rows.
      React.createElement(
        'div',
        {
          style: {
            flex: '1 1 auto',
            boxSizing: 'border-box',
            minWidth: 0,
            minHeight: 0,
            maxWidth: '100%',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            padding: '0 10px 16px'
          }
        },
        error
          ? React.createElement('div', {
              style: {
                margin: '4px 4px 8px',
                padding: '8px 10px',
                borderRadius: 10,
                fontSize: 12,
                background: 'rgba(208,64,64,.12)',
                color: '#ff6b6b',
                whiteSpace: 'pre-wrap'
              }
            }, error)
          : null,
        loading && !catalog
          ? React.createElement('div', {
              style: { padding: '8px 6px', fontSize: 12, color: 'var(--dsw-alias-label-secondary, #9a9a9a)' }
            }, translate('status.loading'))
          : null,
        catalog && shown === 0 && !error
          ? React.createElement('div', {
              style: { padding: '8px 6px', fontSize: 12, color: 'var(--dsw-alias-label-secondary, #9a9a9a)' }
            }, translate(filter ? 'empty.search' : 'empty.models'))
          : null,
        ...groups.map((group) =>
          React.createElement(
            'div',
            {
              key: group.id,
              style: {
                // Box sizing must match the rows: maxWidth 100% has to INCLUDE
                // this box's own padding, or the frame itself overflows the tab.
                boxSizing: 'border-box',
                // minWidth: 0 lets the rows inside shrink below their content
                // width; without it a wide row forces the whole tab wider and
                // the host clips it at the panel edge.
                minWidth: 0,
                maxWidth: '100%',
                margin: '4px 0 10px',
                // The padding is what keeps each row INSIDE the rounded frame.
                // With zero padding a row's own background — and its hover /
                // active fill — sits flush against the group's rounded corners
                // and visibly pokes outside the curve.
                padding: '2px 4px',
                borderRadius: 10,
                background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.07))'
              }
            },
            React.createElement(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  boxSizing: 'border-box',
                  padding: '8px 10px 6px',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '.04em',
                  textTransform: 'uppercase',
                  color: 'var(--dsw-alias-label-secondary, #8d8d8d)'
                }
              },
              React.createElement('span', null, group.name ?? group.id),
              React.createElement('span', { style: { fontWeight: 600, letterSpacing: 0, textTransform: 'none', opacity: 0.7 } },
                fill(translate('group.count'), { count: group.models.length }))
            ),
            ...group.models.map((model) => row(group, model))
          )
        ),
        ...(catalog?.failures ?? []).map((failure) =>
          React.createElement('div', {
            key: `fail-${failure.id}`,
            style: {
              margin: '4px',
              padding: '8px 10px',
              borderRadius: 10,
              fontSize: 12,
              background: 'rgba(208,64,64,.1)',
              color: '#ff6b6b'
            }
          }, fill(translate('group.failed'), { name: failure.name ?? failure.id ?? '', message: failure.message ?? '' }))
        )
      )
    )
  }

  // ------------------------------------------------------- the two registrations

  const disposers = []
  const problem = (label, error) => {
    console.error(`[dsh-model-picker] ${label} 失败：`, error)
  }

  // Boot trace. Readable from the console as __DSH_MODEL_PICKER__.boot, so a
  // blank tab can be attributed to a stage without guessing.
  const boot = { stages: [], error: null }
  const mark = (stage, detail) => {
    boot.stages.push(stage + (detail === undefined ? '' : ` (${detail})`))
    console.log(`[dsh-model-picker] ${stage}${detail === undefined ? '' : ' ' + detail}`)
  }

  mark('apply 进入')

  // Stage 1: the tab type.
  disposers.push(ctx.effect(() => {
    if (typeof ctx.sidebarRightTabs?.register !== 'function') {
      problem('tab 类型注册', 'ctx.sidebarRightTabs.register 不可用')
      boot.error = 'sidebarRightTabs.register 不可用'
      return () => {}
    }
    const dispose = ctx.sidebarRightTabs.register({
      id: TAB_ID,
      kind: TAB_KIND,
      priority: 'extension',
      title: () => t('type.label'),
      guide: [{
        id: 'models',
        commandId: 'sidebar.model-picker',
        order: 10,
        title: () => t('guide.title'),
        description: () => t('guide.description'),
        icon: WhaleIcon
      }]
    })
    mark('tab 类型已注册')
    return dispose
  }, NS + ': tab type'))

  // Stage 2: the tab body.
  //
  // `store` must be a HANDLE (something with create()), never a live instance:
  // the framework mints one instance per session from it and hands the body a
  // bound `useStore` plus the instance's `actions` as props automatically.
  //
  // `inject` receives (sessionId, actions) — NOT the store instance. Its return
  // value becomes props, and any `hooks` entry must be an OBJECT (the framework
  // keys a WeakMap with it), so only real observables belong there.
  disposers.push(ctx.effect(() => {
    if (typeof ctx.slots?.inject !== 'function') {
      problem('tab 内容注册', 'ctx.slots.inject 不可用')
      boot.error = 'slots.inject 不可用'
      return () => {}
    }
    const dispose = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab',
      key: TAB_ID,
      locale: NS,
      store: storeHandle,
      inject: (sessionId, actions) => {
        // The framework-given sessionId is authoritative: selectModel must hit
        // exactly the session this tab renders, never a guess from the list.
        if (typeof sessionId === 'string' && sessionId.length > 0) boundSessionId = sessionId
        // The framework minted the instance behind this inject call; recover it
        // so the load and reload/select drive the store the body reads.
        //
        // The seat calls inject() AFTER apply() returns (it renders the body
        // once the registration is complete), so kick — declared further down
        // in apply — is already initialized by the time this runs. The initial-
        // load effect also calls kick, but the guard inside makes the second
        // call a no-op.
        // Always take the framework's latest-minted instance, never the cached
        // `live`. `live` is a module-level variable that survives across
        // sessions; if it were kept on subsequent inject calls the new session's
        // store would never be assigned — kick() would still read the old
        // instance and the panel would come up empty. That is exactly the
        // "opens blank on every new conversation" bug.
        // Bind to THIS panel's instance — the one the framework minted for the
        // session id it just handed us (renderer calls handle.create(sessionId)).
        // Falling back to latest() keeps an older host working, but latest() is
        // "whichever session minted last", so it must never be the primary path.
        live = typeof sessionId === 'string' && sessionId.length > 0 ? storeHandle.forScope(sessionId) : null
        live = live ?? storeHandle.latest()
        if (live !== null) kick()
        return {
          actions,
          t,
          reload,
          select
        }
      }
    }, Body))
    mark('tab 内容已注册')
    return dispose
  }, NS + ': tab body'))

  // Dictionaries.
  disposers.push(ctx.effect(() => {
    if (typeof ctx.locale?.register !== 'function') return () => {}
    return ctx.locale.register(NS, { zh, en })
  }, NS + ': dictionaries'))

  // Command registration removed in 0.3.1 at user request: this plugin registers
  // no shortcuts / commands / aliases. The tab is opened by clicking its entry
  // in the right-sidebar tab strip (or by another host action that calls
  // ctx.sidebarRight.openTab).

  // Load the catalog as soon as there is an instance to fill. `ctx.remote.*`
  // namespaces mount asynchronously, so this also retries until the API answers
  // instead of leaving the panel empty on a slow boot.
  //
  // Called from TWO places on purpose: the apply() effect (fires early, when
  // there is usually nothing to fill yet) and storeHandle.create() (fires the
  // moment the framework mints the real instance). The guards below make both
  // calls idempotent, so a race never double-loads.
  let loadAttempts = 0
  const kick = () => {
    const instance = liveInstance()
    if (instance === null) return
    const state = instance.getSnapshot()
    if (state.catalog !== null || state.loading) return
    if (!apiReady()) {
      // Give the remote face a few chances to mount before reporting a problem.
      if (loadAttempts < 10) {
        loadAttempts += 1
        setTimeout(() => {
          const next = liveInstance()
          if (next !== null && next.getSnapshot().catalog === null && !next.getSnapshot().loading) kick()
        }, 300)
      } else {
        instance.actions.setError(t('error.noApi'))
      }
      return
    }
    void load()
  }
  disposers.push(ctx.effect(() => { kick(); return () => {} }, NS + ': initial load'))

  mark('apply 完成')

  const hostWindow = (typeof window !== 'undefined' ? window : null)
  if (hostWindow) {
    hostWindow.__DSH_MODEL_PICKER__ = {
      plugin: NS,
      boot,
      open: () => { ctx.sidebarRight?.openTab?.(TAB_KIND) },
      reload,
      select,
      stats: () => ({ ...boot, catalog: snapshot().catalog })
    }
  }

  return () => {
    for (const dispose of disposers.splice(0)) {
      try { dispose?.() } catch { /* ignore */ }
    }
    if (hostWindow) delete hostWindow.__DSH_MODEL_PICKER__
  }
}
