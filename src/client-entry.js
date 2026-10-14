// DSH client-plugin entry. Built into ../client.js by scripts/build.mjs.
//
// The host calls `registration.factory(require)` with ITS OWN resolver, so keep
// the `require` parameter and use it for platform modules (`react`). Local
// modules come from the wrapper's MODULES registry.
//
// Contract (mirrors the host's own client plugins, e.g. dsh-client-ui-sidebar-files):
//   exports.inject  — cordis service names the host fiber must provide
//   exports.apply(ctx) — called with the plugin ctx; injected services hang off it
//
// `dsh.client.immediately: true` in package.json is what puts this row in the
// boot graph — this plugin registers no conversation slot, so without it the
// bundle would load but never execute.
//
// The registration id MUST equal the package name (the scoped npm name). The
// host serves this bundle under the client-graph row id, and that row id is the
// package name: dsh-client-modules resolves the row's module and only accepts
// the nearest package.json whose `name` matches the row name exactly. Under an
// unscoped id the host decides the package "declares no client bundle", serves
// nothing, and the sidebar tab vanishes with no logged error.
window.__ModuleLoader__.load({
  id: '@five0016/dsh-model-picker',
  factory: (require) => {
    const local = window.__DSH_MODEL_PICKER_MODULES__ ?? {}
    const plugin = local['./src/browser.js']

    return {
      name: '@five0016/dsh-model-picker',
      inject: plugin.inject,
      apply(ctx) {
        return plugin.apply(ctx, require)
      },
      dispose() {
        // Handled by the disposer apply() returns.
      }
    }
  }
})
