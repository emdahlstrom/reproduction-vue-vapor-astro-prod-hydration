import vue from '@astrojs/vue'
import { defineConfig } from 'astro/config'
import astroVueVapor from './integrations/astro-vue-vapor/index.mjs'

// Default `output: 'static'`: every page is prerendered, so the island is
// server-rendered into the HTML and then hydrated with `client:load`. No adapter
// needed. astroVueVapor() is registered BEFORE vue() so its `__vapor` check
// claims the `<script setup vapor>` SFC for SSR + client hydration.
export default defineConfig({
  integrations: [astroVueVapor(), vue()],
})
