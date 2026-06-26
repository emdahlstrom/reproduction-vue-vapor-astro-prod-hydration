# Astro + Vue Vapor: island dead after hydration under the production runtime

An Astro app that SSRs and hydrates a single Vue **Vapor** island
(`<script setup vapor>`). Under the Vue 3.6 **production** runtime the island is
**dead after hydration** — the button's click handler never lands, clicks do
nothing — because Astro emits **non-inline** vapor codegen (a separate
`render()`), and the prod runtime's `handleSetupResult` drops that `render()`.
The `astro dev` runtime runs the identical codegen fine, so this is a runtime
bug, not a compiler one.

`beta.17` does **not** fix it (verified here against the latest beta). A
`@vue/runtime-vapor` patch does — shipped in `patches/` and wired via
`pnpm.patchedDependencies`, so `pnpm install` gives a working app out of the box.

- `vue@3.6.0-beta.17` (`@vue/runtime-vapor@3.6.0-beta.17`)
- `astro@7`, `@astrojs/vue@7`, `@vitejs/plugin-vue@6.0.7`, node 24

## Reproduce

```bash
pnpm install   # applies patches/vue@3.6.0-beta.17.patch → working island
pnpm verify    # toggles the patch off/on, builds each, drives headless Chromium
```

`pnpm verify` builds the site four ways and probes the island in a real browser:

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

By hand: `pnpm dev` (dev runtime, works) vs `pnpm build && pnpm preview` (prod
runtime + the shipped patch, works). To see it broken, drop the
`pnpm.patchedDependencies` entry, `pnpm install`, and rebuild.

## Why Astro triggers it

`@vitejs/plugin-vue` folds the template into `setup()` (inline) only when
`isUseInlineTemplate` holds — `!devServer && !devToolsEnabled`. Astro runs the
plugin during `astro build` with its `devServer` handle still set, so **every**
Vue component is compiled **non-inline** (a separate `render()`), even in the
production build. That non-inline output is the exact path the prod runtime bug
breaks. (The Vite-only sibling repro at `../vue-vapor-ssr-prod-hydration` forces
the same output with `features: { prodDevtools: true }`; in Astro it happens with
no flag.)

```js
// non-inline (what Astro emits): the handler is attached inside render(_ctx)
$evtclick = i(() => _ctx.count++)
```

## The two bugs (both still present on beta.17)

Both are the same pathology — the setup-state wiring lives in a `__DEV__`-gated
branch that the production build dead-code-eliminates.

**#1 — `handleSetupResult` never calls `render()`.** A non-inline `setup()`
returns the bindings object; in prod the discriminator that says "bindings +
separate render" vs "setup returned a block" is DCE'd, so the bindings object is
assigned straight to `instance.block` and `render()` never runs. The island
server-renders, then hydrates dead: the delegated `$evtclick` handler is
`undefined` on the live node.

**#1b — template ref never reaches the setup variable.** `setRef` writes a
`ref="el"` only to `instance.refs`; the `setupState[el] = node` write (which sets
the `const el = ref()` setup variable through its `proxyRefs` proxy) is
`__DEV__`-gated and DCE'd. So `el.value` stays `null` in `onMounted`. Masked by
#1 (no `render()`, no `onMounted`), it only surfaces once #1 is fixed — the
`#1 only` row above.

## The fix

`patches/vue@3.6.0-beta.17.patch` edits the build the Astro client bundles,
`vue/dist/vue.runtime-with-vapor.esm-browser.prod.js`:

1. **`handleSetupResult`** — restore the discriminator outside the `__DEV__`
   gate: for a non-block `setup()` result with a `render()`, set
   `instance.setupState = proxyRefs(result)` and call `render()` with it.
2. **`setRef`** — re-derive the setup-state handle and an "is this a real setup
   key" check, then write the node through it on the string-ref path.

The patch file is large because it diffs a minified single-line build. The two
edits are defined as exact string transforms in `patch.mjs` (the single source of
truth, used by both `verify.mjs` and `make-patch.mjs`); each asserts its target,
so a vue bump that changes the codegen fails loudly. Re-generate with
`node make-patch.mjs` after re-pointing `patch.mjs` at the new build.

## Layout

```
astro.config.mjs                  astroVueVapor() before @astrojs/vue
integrations/astro-vue-vapor/     SSR + client hydration for vapor islands
  index.mjs                       redirects client `vue` → with-vapor browser build
  server.mjs  client.mjs  _shared.mjs
src/components/Island.vue         the island: counter (#1) + template-ref probe (#1b)
src/pages/index.astro             mounts <Island client:load />
patch.mjs                         the two runtime edits as string transforms
make-patch.mjs                    regenerate patches/vue@3.6.0-beta.17.patch
verify.mjs                        4-state proof in headless Chromium
```

## Notes

- Verified in a real browser. happy-dom/jsdom are not reliable oracles here — they
  false-report the working case.
- The integration ships the **production** with-vapor browser build on the client
  (`astro build`) and keeps the **dev** build for `astro dev`; the SSR side uses
  the modular `vue`, which ssr-compiles vapor SFCs to a standard `ssrRender`.
