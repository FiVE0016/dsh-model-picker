# dsh-model-picker

右栏原生 tab 页签：浏览并切换本会话可用的**全部模型**。

它走的是宿主自己的公开扩展路径——和宿主自带的 `dsh-client-ui-sidebar-files`（文件树）完全相同的两阶段注册，所以在右栏里是一个**真正的 tab 页签**，不是浮层：有胶囊、可关闭、可加入分屏、面板收起展开都跟着宿主自己的逻辑走。

数据来自宿主官方接口 `remote.session.modelCatalog()`，与右下角模型选择器**完全同源**——里面能选什么，右栏就列什么。

## 功能

- **原生右栏 tab**：`ctx.sidebarRightTabs.register()` + `sidebar.right.pane.tab` slot，`priority: 'extension'`；右栏顶部的「+」指南页里有入口，也可用命令面板打开。
- **完整模型目录**：按 provider 分组（DeepSeek 官方 / Hy3 / 账号 / 自定义…），每组带模型数量。
- **当前模型高亮**：`✓` 标记 + 行底色，顶部一行「当前：xxx（provider）」。
- **点击即切换**：调用宿主官方 `remote.session.selectModel({ sessionId, provider, model })`，和原生选择器同一条写入路径。
- **搜索过滤**：按模型名 / 来源名 / ID 过滤。
- **推理档提示**：多档推理的模型带 `N 档推理` 徽标；切换时自动带上该模型的 `defaultEffort`。
- **失败可见**：某个来源目录加载失败时明确列出原因，不伪装成可选。
- **中英双语**：`ctx.locale.register`，跟随宿主语言。

## 安装

### 方式 A：npm（已发布）

npm 包名 `@five0016/dsh-model-picker`（**已发布，latest = 0.3.2**）。

⚠ **作用域名必须贯穿到"注册名"**（2026-10-14 踩坑实证，本条此前写反过）：
宿主的客户端图（`dsh-client-modules`）按 bundle 行的 `name` 去解析模块，然后从模块所在目录
**向上找最近的 package.json，只认 `name` 字段与行名完全相等的那一个**（`nearestPackage`）。
所以下面四处**必须都是同一个带作用域的名字**，少改一处就会**静默**不加载客户端 bundle
（宿主半可能照常加载，但右栏 tab 直接消失、控制台**不报错**）：

| 位置 | 值 |
|---|---|
| `package.json` → `name` | `@five0016/dsh-model-picker` |
| `cordis.patch.yml` → `insert[].name` | `@five0016/dsh-model-picker` |
| `index.js` → `export const name` | `@five0016/dsh-model-picker` |
| `client.js` → `__ModuleLoader__.load({ id })` | `@five0016/dsh-model-picker` |

（只有"tab 内部身份"可以另取名：`sidebarRightTabs.register({ id })` 与
`ctx.slots.register({ key })` 用的是 `dsh-model-picker`，两者必须互相同名，但不必等于包名。）

```bash
cd ~/.dsh/profiles/desktop
pnpm add @five0016/dsh-model-picker
# 然后 ~/.dsh/profiles/desktop/package.json → dsh.profile.bundles 追加
#   "@five0016/dsh-model-picker"
```

### 方式 B：link 本地开发（当前在用）

桌面 profile 的插件装在 `~/.dsh/profiles/desktop/`。已装好（本次会话完成）：

```bash
# 1) 以 link: 方式加入 profile 依赖（与 dsh-fold-polish 相同机制）
#    依赖名必须写带作用域的包名，pnpm 才会在 node_modules\@five0016\ 下建软链
cd ~/.dsh/profiles/desktop
pnpm add "link:C:/Users/FiVE/Documents/deepseek-harness/default-workspace/plugins/dsh-model-picker"
# 再手动把 dependencies 的键名改成 "@five0016/dsh-model-picker"（pnpm add 可能按目录名写成无作用域的键）

# 2) 手动补进 dsh.profile.bundles（dsh plugin 是 pnpm 透传，不会自动写这个数组）
#    ~/.dsh/profiles/desktop/package.json → dsh.profile.bundles 追加
#    "@five0016/dsh-model-picker"
```

装好后确认四件事：

```bash
node -e "
const fs=require('fs'),path=require('path');
const prof='C:/Users/FiVE/.dsh/profiles/desktop';
const id='@five0016/dsh-model-picker';
const p=JSON.parse(fs.readFileSync(path.join(prof,'package.json'),'utf8'));
console.log('dependency:      ', id in p.dependencies);
console.log('in bundles:      ', p.dsh.profile.bundles.includes(id));
console.log('client.js reach: ', fs.existsSync(path.join(prof,'node_modules',id,'client.js')));
console.log('patch insert:    ', fs.readFileSync(path.join(prof,'node_modules',id,'cordis.patch.yml'),'utf8').includes(id));
"
```

改完 `client.js` 后必须 `pnpm install --offline` 刷 rev（见下方"生效"）。

## 生效

**只改了 `client.js`（前端代码）→ 刷新页面即可**（纯前端插件，不用重启应用）：

- DSH 窗口内 **F12 → Console → `location.reload()`**（最可靠）；
- 或 **Ctrl+R**；
- 或关窗重开。

**改了下面任一项 → 必须重启 DSH 应用**（这两处只在启动装配时读一次，刷新页面拿不到新值）：

- profile 的 `package.json`（`dependencies` / `dsh.profile.bundles`）；
- 插件自己的 `cordis.patch.yml`（bundle 行的 `id` / `name`）。

刷新后右栏顶部的「+」里应出现「模型」入口；命令面板搜「模型」也能打开。

## 打开方式

| 方式 | 操作 |
|---|---|
| 右栏指南页 | 右栏「+」→ 模型 |
| 快捷键 | `Ctrl+Alt+M`（commandId `sidebar.model-picker`，可在设置里改） |
| 命令面板 | 通过 shortcuts 服务注册，别名 `model` / `models` / `模型` |

## 验证

```bash
# 构建 src → client.js 并校验同步
node scripts/build.mjs
node scripts/build.mjs --check

# 无头冒烟测试（37 项断言）
node scripts/smoke.mjs
```

覆盖：bundle 注册形状、`inject` 服务名齐全、tab 类型（id/kind/priority/title/guide）、tab body（key 对齐 definition.id）、shortcut 注册与 `resolve().run()` 打开 tab、按 props 渲染 body（`useStore`/`t`/`reload`/`select`）、目录分组与失败项渲染、点击后 `selectModel` 的 sessionId/provider/model、dispose 清理、以及**缺 `ctx.shortcuts` 时 `apply()` 不抛异常**的韧性用例。

刷新后如果 tab 还是空白，先看控制台有没有 `[dsh-model-picker] ... 失败：` 的报错——那会直接指出是哪个宿主服务没拿到。

## 实现要点

- **两阶段 tab 注册**（与 `dsh-client-ui-sidebar-files` 同构）：
  ```js
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: 'dsh-model-picker', kind: 'model-picker', priority: 'extension',
    title: () => t('type.label'),
    guide: [{ id: 'models', commandId: 'sidebar.model-picker', order: 10, ... }]
  }), 'tab type')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: 'dsh-model-picker',      // 必须与 definition.id 相同
    locale: NS, store, inject: () => ({ hooks, t, reload, select })
  }, Body)), 'tab body')
  ```
- **body 通过 props 拿依赖**：`inject()` 的返回值会作为 props 传进组件，其中 `useStore` 是框架为本次注册声明的 `store` 绑定的读取 hook，`t` 是命名空间翻译器——和 `FilesBody({ useTabInfo, sessionId, useSessions, useStore, actions, ..., t, renderSlot })` 同一个约定。不要用闭包变量替代 props。
- **命令走 `ctx.shortcuts.register`**：宿主**没有** `shell.command` 这个 slot；命令/快捷键统一由 shortcuts 服务注册（`{ id, label, aliases, defaults, regions, modals, resolve }`），这也让指南页入口能显示快捷键文本。
- **每个宿主服务调用都有守卫**：`ctx.sidebarRightTabs?.register`、`ctx.slots?.inject`、`ctx.shortcuts?.register`、`ctx.locale?.register` 全部先判可用。某个服务缺失时只丢那一段功能并打 `console.error`，绝不让整个 `apply()` 抛异常——否则 fiber 一死，tab 还在但 body 全白（这正是本次修掉的坑）。
- **`dsh.client.inject`** 声明宿主依赖包（`dsh-api-session-controller`、`dsh-client-store`、`dsh-client-locale`、`dsh-client-ui-session`、`dsh-client-ui-sidebar-right`），宿主才把对应客户端模块提供给本插件；`exports.inject` 再声明 cordis 服务名，两处都要写。
- **`dsh.client.immediately: true`**：本插件不注册 conversation slot，没有它 bundle 永不执行。
- **UI 用 `React.createElement` + 内联样式 + `--dsw-*` 主题变量**，只依赖 `react` 和 `@deepseek-ai/dsh-client-store` 两个平台模块，不依赖 `dsh-client-ui-primitives`，减少宿主依赖面。
- **加载时机**：`apply()` 里就 `load()` 一次，首次打开 tab 时已有数据，不白屏。
- **目录结构兼容**：`directory.load()` 可能返回两种结构——旧版 `{catalog: {groups, default}}` 或新版 `{groups, current, ...}`。插件自动识别并映射为内部 catalog 格式 `{groups, default}`。

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` | 插件清单；`dsh.client` 声明平台 / immediately / inject |
| `cordis.patch.yml` | **bundle patch，`insert` 行是本插件能进 bundle 的关键** |
| `index.js` | 宿主机半（空实现，纯客户端插件无需宿主逻辑） |
| `src/client-entry.js` | ModuleLoader 入口，导出 `inject` + `apply(ctx, require)` |
| `src/browser.js` | tab 注册、目录拉取、React body、切换逻辑 |
| `scripts/build.mjs` | `src/*.js` → `client.js` 打包 + `--check` 同步校验 |
| `scripts/smoke.mjs` | 无头冒烟测试 |
| `client.js` | 构建产物（宿主实际加载的文件） |

## 已知限制

- `link:` 安装的是符号链接，DSH 重启后未必重读；改完代码要确认加载的是新 `client.js`（`node scripts/build.mjs` 后刷新）。
- 切换模型需要**当前会话已建立**；没有活动会话时点击会提示「未找到当前会话」。
- `guide` 里没有 `icon`（没引 `dsh-client-ui-primitives` 的 `GuideArtwork*`），指南页入口用默认图标。
- 模型目录来自宿主实时接口，`our-free-model` 等来源若本机不可用，会以「加载失败」形式如实呈现。
