// SSR renderer for Vue Vapor islands. On the server the vapor SFC uses the
// modular `vue` and compiles to a standard `ssrRender`, which @vue/server-renderer
// drives (ignoring `__vapor`). Astro's `check` routes vapor SFCs here.
//
// Minimal on purpose: the single island takes no slots and uses no `useId()`, so
// Astro slot forwarding and a per-island `app.config.idPrefix` — both needed by a
// general renderer (and present in @astrojs/vue) — are intentionally left out.
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

// SSR-compiled vapor SFCs carry `__vapor: true` — the precise signal.
const isVapor = (C) => !!(C && C.__vapor)

export default {
  name: 'astro-vue-vapor',
  check: isVapor,
  async renderToStaticMarkup(Component, props) {
    // A vDOM host renders the vapor component as a child; the client mounts the
    // identical tree (see client.mjs) so the hydration markers line up.
    const app = createSSRApp({ render: () => h(Component, props || {}) })
    return { html: await renderToString(app) }
  },
}
