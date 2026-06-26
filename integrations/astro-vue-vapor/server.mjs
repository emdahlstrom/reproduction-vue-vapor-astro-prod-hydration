// SSR renderer for Vue Vapor islands. On the server, vapor SFCs use the modular
// `vue` and compile to a standard `ssrRender` (which @vue/server-renderer drives,
// ignoring `__vapor`). We supply the SSR context @astrojs/vue omits, plus a
// per-island id prefix so useId()/scoped ids match on hydration.
import { Suspense, createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { buildSlots, makeHost } from './_shared.mjs'

// SSR-compiled vapor SFCs carry `__vapor: true`; that is the precise signal.
const isVapor = (C) => !!(C && C.__vapor)

// Monotonic per-render-result counter for stable, unique island id prefixes.
const idCounters = new WeakMap()
function nextPrefix(result) {
  if (!result) return undefined
  const n = (idCounters.get(result) ?? 0) + 1
  idCounters.set(result, n)
  return `v${n}-`
}

export default {
  name: 'astro-vue-vapor',
  check: isVapor,
  async renderToStaticMarkup(Component, props, slotted) {
    const prefix = nextPrefix(this?.result)
    const slots = buildSlots(slotted, defineComponent, h)
    const app = createSSRApp(makeHost({ Suspense, h }, Component, props, slots))
    app.config.idPrefix = prefix
    const html = await renderToString(app, {})
    return { html, attrs: prefix ? { prefix } : {} }
  },
  supportsAstroStaticSlot: true,
}
