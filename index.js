// dsh-model-picker — host half.
//
// This plugin is a pure client-side (DOM-only) plugin: it registers no host
// service and contributes nothing to the cordis host graph. The host half exists
// only so the package resolves; all behavior lives in client.js, which the host
// loads in the browser because package.json declares
//   dsh.client = { platform: "web", immediately: true, inject: [] }.

export const name = 'dsh-model-picker'

/** No-op host fiber: nothing to install on the server side. */
export function apply() {
  // Intentionally empty — see the comment above.
}

export function dispose() {
  // Intentionally empty — see the comment above.
}
