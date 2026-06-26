# Astro + Vue Vapor: production island dead after hydration

A `<script setup vapor>` island server-renders, then hydrates **dead** under
Vue 3.6's production runtime: the button's `@click` never lands, clicks do
nothing. `astro dev` runs the identical codegen fine, so the bug is in
`@vue/runtime-vapor`, not the compiler. Still present on `vue@3.6.0-beta.17`.

Two production-only bugs, one root cause: the setup-state wiring lives in a
`__DEV__`-gated branch the prod build dead-code-eliminates. Both bite only the
**non-inline** codegen (a separate `render()` instead of the template folded into
`setup()`) — which is exactly what Astro emits, even in `astro build`.

- `vue@3.6.0-beta.17`, `astro@7`, `@astrojs/vue@7`, `@vitejs/plugin-vue@6.0.7`, node 24
- Companion pure-Vite repro: https://github.com/emdahlstrom/reproduction-vue-vapor-ssr-prod-hydration

## Run

```bash
pnpm install   # applies patches/vue@3.6.0-beta.17.patch → a working island
pnpm verify    # toggles the patch off/on, builds each, drives headless Chromium
```

`pnpm verify` builds the site four ways and probes the hydrated island in a real
browser:

```text
✓ unpatched            prod runtime, stock
    "count is 0" -> "count is 0"  $evtclick=undefined  ref: pending
✓ #1 only              prod runtime, handleSetupResult fixed
    "count is 0" -> "count is 1"  $evtclick=function  ref: ref-null
✓ #1 + #1b (full)      prod runtime, both fixed
    "count is 0" -> "count is 1"  $evtclick=function  ref: ref-ok
✓ dev runtime          control, same codegen
    "count is 0" -> "count is 1"  $evtclick=function  ref: ref-ok
```

Stock prod runtime: the click never registers (`$evtclick` is `undefined`).
Fix #1 revives the island but the template ref is still null. Fix #1b resolves
the ref. The dev runtime — same codegen — is alive throughout.

## Why Astro hits it

`@vitejs/plugin-vue` folds the template into `setup()` (inline) only when
`!devServer && !devToolsEnabled`. Astro runs the plugin during `astro build`
with its `devServer` handle still set, so **every** Vue component compiles
non-inline — a separate `render()` — even in the production build. That is the
path the prod runtime breaks. (The pure-Vite sibling forces the same output with
`features: { prodDevtools: true }`; in Astro it needs no flag.)

## Root cause and fixes

Both fixes target the minified `vue.runtime-with-vapor.esm-browser.prod.js`, the
build Astro bundles on the client. `patch.mjs` holds them as exact string
transforms — the single source of truth for both the shipped patch and
`pnpm verify` — and each asserts its target, so a vue bump fails loudly.

**#1 — `handleSetupResult` never calls `render()`** (`runtime-vapor/src/component.ts`).
A non-inline `setup()` returns the bindings object; in prod the branch that
detects "bindings + a separate `render()`" is `__DEV__`-gated and DCE'd, so the
object is assigned straight to `instance.block` and `render()` never runs. The
island hydrates dead — the delegated `$evtclick` handler is `undefined`.

```js
// before the bare `else instance.block = setupResult`, restore:
else if (!isBlock(setupResult) && component.render) {
  instance.setupState = proxyRefs(setupResult)
  instance.block = callRender(component.render, instance, instance.setupState)
}
```

**#1b — a string template ref never reaches the setup variable**
(`runtime-vapor/src/apiTemplateRef.ts`). `setRef` writes `ref="el"` only to
`instance.refs`; the `setupState[ref] = node` write — which sets the
`const el = ref()` variable through its `proxyRefs` proxy — is `__DEV__`-gated and
DCE'd, so `el.value` stays null in `onMounted`. Masked by #1. The fix un-gates the
`setupState` handle and that write, keeping the existing `canSetSetupRef` guard;
in the minified browser build the helpers are fully DCE'd, so the patch re-derives
them at the top of `setRef`.

Regenerate the patch after a vue bump (re-point the snippets in `patch.mjs`
first): `node patch.mjs`.

## Layout

```
astro.config.mjs                 astroVueVapor() registered before @astrojs/vue
integrations/astro-vue-vapor/
  index.mjs                      routes client `vue` → with-vapor build; picks prod/dev build
  server.mjs                     createSSRApp → renderToString
  client.mjs                     createSSRApp + vaporInteropPlugin → mount(el, hydrate)
src/components/Island.vue        counter (#1) + template-ref probe (#1b)
src/pages/index.astro            <Island client:load />
patch.mjs                        the two edits as string transforms; `node patch.mjs` regenerates the patch
verify.mjs                       4-state proof in headless Chromium
```

## Notes

- Verified in a real browser; happy-dom/jsdom false-report the working case.
- The client bundles the **production** with-vapor browser build (`astro build`)
  and keeps the **dev** build for `astro dev`. SSR uses the modular `vue`, which
  compiles vapor SFCs to a standard `ssrRender`.
