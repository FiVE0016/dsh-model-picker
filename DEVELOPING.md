# 开发与实现笔记

面向要改这个插件的人。**功能说明请看 [README.md](README.md)**，这里只放实现细节、兼容性、开发流程与踩过的坑。

## 目录结构

```
dsh-model-picker/
├── package.json          # 插件清单；dsh.client 声明平台 / immediately / inject
├── cordis.patch.yml      # bundle patch，insert 行是本插件能进 bundle 的关键
├── index.js              # 宿主机半（空实现，纯客户端插件无需宿主逻辑）
├── src/
│   ├── client-entry.js   # ModuleLoader 入口，导出 inject + apply(ctx, require)
│   └── browser.js        # tab 注册、目录拉取、React body、切换逻辑
├── scripts/
│   ├── build.mjs         # src/*.js → client.js 打包 + --check 同步校验
│   └── smoke.mjs         # 无头冒烟测试（37 项断言）
├── client.js             # 构建产物（宿主实际加载的文件）
├── README.md             # 功能说明
├── CHANGELOG.md          # 更新记录
└── DEVELOPING.md         # 本文件
```

## 两阶段 tab 注册

与宿主自带的 `dsh-client-ui-sidebar-files`（文件树）完全相同的两阶段注册：

```js
// 阶段 1：注册 tab 类型
ctx.effect(() => ctx.sidebarRightTabs.register({
  id: 'dsh-model-picker', kind: 'model-picker', priority: 'extension',
  title: () => t('type.label'),
  guide: [{ id: 'models', commandId: 'sidebar.model-picker', order: 10, ... }]
}), 'tab type')

// 阶段 2：注册 tab body
ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
  name: 'sidebar.right.pane.tab',
  key: 'dsh-model-picker',      // 必须与 definition.id 相同
  locale: NS, store, inject: () => ({ hooks, t, reload, select })
}, Body)), 'tab body')
```

**key 必须与 definition.id 相同**，否则 body 不会渲染到正确的 tab。

## body 通过 props 拿依赖

`inject()` 的返回值会作为 props 传进组件，其中：

- `useStore`：框架为本次注册声明的 `store` 绑定的读取 hook
- `t`：命名空间翻译器
- `reload`：重新加载目录
- `select`：切换模型

**不要用闭包变量替代 props**。这和 `FilesBody({ useTabInfo, sessionId, useSessions, useStore, actions, ..., t, renderSlot })` 是同一个约定。

## 命令走 ctx.shortcuts.register

宿主**没有** `shell.command` 这个 slot；命令/快捷键统一由 shortcuts 服务注册：

```js
ctx.shortcuts?.register({
  id: 'sidebar.model-picker',
  label: t('type.label'),
  aliases: ['model', 'models', '模型'],
  defaults: ['Ctrl+Alt+M'],
  regions: ['sidebar', 'modal'],
  resolve: () => { ... }
})
```

这也让指南页入口能显示快捷键文本。

## 每个宿主服务调用都有守卫

所有宿主服务调用都先判可用：

```js
ctx.sidebarRightTabs?.register  // 可选链
ctx.slots?.inject
ctx.shortcuts?.register
ctx.locale?.register
```

某个服务缺失时只丢那一段功能并打 `console.error`，**绝不让整个 `apply()` 抛异常**——否则 fiber 一死，tab 还在但 body 全白。

## 目录结构兼容

`directory.load()` 可能返回两种结构：

1. **旧版（wrapped）**：`{catalog: {groups, default}}` 或 `{value: {groups, default}}`
2. **新版（raw）**：`{groups, current, routable, failures, status, pending, error}`

插件自动识别并映射为内部 catalog 格式 `{groups, default}`：

```js
const catalog = value.catalog ?? value.value ?? {
  groups: value.groups ?? [],
  default: value.current ?? null
}
```

## 加载时机

`apply()` 里就 `load()` 一次，首次打开 tab 时已有数据，不白屏。

## 控制台 API

```js
__DSH_MODEL_PICKER__.boot      // 启动状态
__DSH_MODEL_PICKER__.open()    // 打开 tab
__DSH_MODEL_PICKER__.reload()  // 重新加载目录
__DSH_MODEL_PICKER__.select()  // 切换模型
__DSH_MODEL_PICKER__.stats()   // 当前 catalog 快照
```

## 验证

```bash
# 构建 src → client.js 并校验同步
node scripts/build.mjs
node scripts/build.mjs --check

# 无头冒烟测试（37 项断言）
node scripts/smoke.mjs
```

覆盖：bundle 注册形状、`inject` 服务名齐全、tab 类型（id/kind/priority/title/guide）、tab body（key 对齐 definition.id）、shortcut 注册与 `resolve().run()` 打开 tab、按 props 渲染 body（`useStore`/`t`/`reload`/`select`）、目录分组与失败项渲染、点击后 `selectModel` 的 sessionId/provider/model、dispose 清理、以及**缺 `ctx.shortcuts` 时 `apply()` 不抛异常**的韧性用例。

## 已知限制

- `link:` 安装的是符号链接，DSH 重启后未必重读；改完代码要确认加载的是新 `client.js`（`node scripts/build.mjs` 后刷新）。
- 切换模型需要**当前会话已建立**；没有活动会话时点击会提示「未找到当前会话」。
- `guide` 里没有 `icon`（没引 `dsh-client-ui-primitives` 的 `GuideArtwork*`），指南页入口用默认图标。
- 模型目录来自宿主实时接口，`our-free-model` 等来源若本机不可用，会以「加载失败」形式如实呈现。
