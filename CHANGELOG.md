# 更新记录

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
