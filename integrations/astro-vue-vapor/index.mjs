import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

// The with-vapor browser build used on the client: it bundles Vue's full classic
// surface (createApp/createSSRApp/h/Suspense/…) PLUS Vapor + vaporInteropPlugin
// in one file, so the SFCs and the client renderer share a single runtime copy
// (one `currentInstance`). The modular `vue.runtime.esm-bundler.js` entry can't
// be used: it re-exports runtime-dom and runtime-vapor with `export *`, so names
// both export (createApp/createSSRApp) tree-shake to `undefined`.
//
// `astro build` ships the PRODUCTION build. Vue 3.6's stock prod vapor runtime
// has two `__DEV__`-gated bugs that only bite the NON-INLINE output Astro emits
// (a separate `render()`, see below): handleSetupResult never calls render() so
// the island hydrates dead, and setRef never writes a `ref="x"` to the setup
// variable. Both are fixed by patches/vue@3.6.0-beta.17.patch. `astro dev` keeps
// the DEV build, which hydrates non-inline output correctly.
const DEV_VAPOR_BUILD = require.resolve(
  'vue/dist/vue.runtime-with-vapor.esm-browser.js',
)
const PROD_VAPOR_BUILD = require.resolve(
  'vue/dist/vue.runtime-with-vapor.esm-browser.prod.js',
)

// True if a .vue source has a `<script setup vapor>` block (attrs in any order).
function isVaporSfc(source) {
  for (const tag of source.match(/<script\b[^>]*>/g) ?? []) {
    if (/\bsetup\b/.test(tag) && /\bvapor\b/.test(tag)) return true
  }
  return false
}

/**
 * Astro integration: SSR + hydrate Vue Vapor (`<script setup vapor>`) islands.
 * Pair with @astrojs/vue (it compiles the SFCs); register BEFORE it so this
 * renderer's `__vapor` check claims the vapor SFCs.
 */
export default function astroVueVapor() {
  return {
    name: 'astro-vue-vapor',
    hooks: {
      'astro:config:setup': ({ command, addRenderer, updateConfig }) => {
        // `astro build` ships PROD; `astro dev` keeps DEV. VAPOR_FORCE_DEV_RUNTIME
        // is a test-only escape hatch so verify.mjs can build a dev-runtime
        // control (same non-inline codegen, dev runtime) and show it stays alive.
        const useProd =
          command === 'build' && process.env.VAPOR_FORCE_DEV_RUNTIME !== '1'
        const WITH_VAPOR_BUILD = useProd ? PROD_VAPOR_BUILD : DEV_VAPOR_BUILD
        const clientEntry = fileURLToPath(new URL('./client.mjs', import.meta.url))

        // Is a `.vue` importer a vapor SFC? Read on demand and cached.
        const vaporCache = new Map()
        const importerIsVapor = (file) => {
          if (!file.endsWith('.vue')) return false
          let vapor = vaporCache.get(file)
          if (vapor === undefined) {
            try {
              vapor = isVaporSfc(readFileSync(file, 'utf8'))
            } catch {
              vapor = false
            }
            vaporCache.set(file, vapor)
          }
          return vapor
        }

        addRenderer({
          name: 'astro-vue-vapor',
          clientEntrypoint: clientEntry,
          serverEntrypoint: fileURLToPath(new URL('./server.mjs', import.meta.url)),
        })

        updateConfig({
          vite: {
            plugins: [
              {
                name: 'astro-vue-vapor:resolve',
                enforce: 'pre',
                // Route the vapor SFCs and the client renderer to the single
                // with-vapor build on the client. SSR keeps the modular `vue`.
                resolveId(id, importer, opts) {
                  if (id !== 'vue' || !importer || opts?.ssr) return
                  const file = importer.split('?')[0]
                  if (file === clientEntry || importerIsVapor(file))
                    return WITH_VAPOR_BUILD
                },
              },
            ],
          },
        })
      },
    },
  }
}
