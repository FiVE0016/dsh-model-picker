# 更新记录

## 0.3.3 — 三处静默失效修复（作用域贯穿 + 重启空目录重试 + 按会话取实例）

- **修：npm 作用域改名导致右栏 tab 直接消失（0.3.2 是坏版，装上必现）**。0.3.2 把包名改成 `@five0016/dsh-model-picker` 却没同步「注册名」：宿主的 `dsh-client-modules.nearestPackage()` 从模块目录向上找最近的 `package.json`，只认 `name` 字段与 bundle 行名**完全相等**的那一个——行名还是旧的 `dsh-model-picker`，匹配不上 → 静默判「无客户端 bundle」，tab 消失且零报错。修：四处同名（`package.json.name` / `cordis.patch.yml` 的 `insert[].name` / `index.js` 的 `export const name` / `client.js` 的 `__ModuleLoader__.load({ id })` 全部改为带作用域名）；profile 侧依赖键与 `dsh.profile.bundles` 项同步改。README 里「作用域只是发布用」的旧结论是错的，已改正。
- **修：每次重启后列表空、只显示「没有可用的模型。」，刷新页面才好**。DSH 启动早期模型渠道还没加载完，`directory.load()` 此时返回**合法的空目录**（`groups: []`、`ok: true`、无 error）；旧逻辑把「非 null」当「已加载」缓存，面板永远空。现在 `groups.length === 0` 视为**未就绪**：不缓存、每 2 秒自动重试（上限 30 次 ≈ 60 秒），渠道就绪后列表自己出现，无需刷新。
- **修：多会话下取 store 实例取错会话**。宿主按 `sessionId` 一个会话 mint 一个 store 实例（`resolveStore(handle, scopeBinding)`）；插件原先用 `latest()`（「最后 mint 的那个」）取实例，多会话时可能把目录写进别的会话的 store。现在 `defineStore.create(scopeKey)` 按 scopeKey 建索引、新增 `forScope(sessionId)`，`load()/select()/kick()/snapshot()` 全部按本会话 id 取。
- **测试**：smoke 补「注册 id === 包名」断言与多会话隔离回归（数据落在被注入的会话、另一个保持为空）；「mint 前不得加载」断言修正为按语义取快照。

## 0.3.2 — 鲸鱼图标
- **右栏「模型」tab 指南页菜单加图标** — 新增 `WhaleIcon` 自定义 SVG 组件，填入 `guide[].icon`。宿主内置图标库无鲸鱼，自绘一个与宿主图标风格一致的极简鲸鱼（body + tail fin + eye + water spout），fill="currentColor" 继承文字颜色。
- 查找 tab（dsh-fold-polish）同时加了 `IconSearchOutline16` 放大镜图标。

## 0.3.1 — 新对话面板空白修复 + 快捷键全删

- **修复：每次打开新对话面板空白** — `inject` 回调里 `live ?? storeHandle.latest()` 会让模块级变量 `live` 永久锁在第一次对话的实例上；`??` 短路使得后续所有新对话的 `inject` 都不再更新 `live`，`kick()` 一直读旧实例，新对话的 store 从未被填充。改为直接 `live = storeHandle.latest()`，让 `live` 跟随框架最新 mint 的实例。
- **删除所有快捷键与命令注册**（应你要求） — 移除 `ctx.shortcuts.register({ id: 'sidebar.model-picker', ... })` 整段（原绑定 `Ctrl+Alt+M`）；同步从 `inject` 服务清单移除 `'shortcuts'`，从 `package.json` 的 `dsh.client.inject` 里移除 `@deepseek-ai/dsh-client-shortcuts`。tab 现在只能靠右栏 tab 栏点击打开，不再占用任何组合键。

## 0.3.0 — 目录结构兼容修复

- **修复：目录加载后 catalog 为空** — `directory.load()` 返回 `{groups, current, routable, failures, status, pending, error}` 时，插件原先期望 `{catalog: {groups, default}}` 或 `{value: {groups, default}}`，导致 catalog 被设为 null。现在自动识别两种结构并映射为内部格式。
- **添加 `@deepseek-ai/dsh-api-remotes` 依赖** — 修复 `ctx.remote` 为 undefined 导致 `apiReady()` 永远返回 false 的问题。
- **清理调试代码** — 移除开发过程中添加的 `console.log` 和 `_debug` 暴露对象。
- **Smoke 测试通过** — 37 项断言全绿。

## 0.2.0 — 首次发布

- 右栏原生 tab 页签：浏览并切换本会话可用的全部模型
- 完整模型目录：按 provider 分组，当前模型高亮
- 点击即切换：调用宿主官方 `remote.session.selectModel()`
- 搜索过滤：按模型名 / 来源名 / ID 过滤
- 推理档提示：多档推理模型带徽标，切换时自动带上 `defaultEffort`
- 中英双语：跟随宿主语言
- 快捷键 `Ctrl+Alt+M`，命令面板别名 `model` / `models` / `模型`
