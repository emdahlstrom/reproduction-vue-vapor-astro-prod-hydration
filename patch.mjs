// Single source of truth for the two runtime edits, as string transforms on
// `vue/dist/vue.runtime-with-vapor.esm-browser.prod.js` — the build the Astro
// client bundles (see integrations/astro-vue-vapor/index.mjs). Both make-patch.mjs
// (which produces patches/vue@3.6.0-beta.17.patch) and verify.mjs use these, so
// the shipped patch and the proof can never drift.
//
// The file is minified, so the targets are mangled names from the 3.6.0-beta.17
// build: handleSetupResult is `Tg`, callRender `mg`, EMPTY_OBJ `t`, isBlock `Jh`,
// proxyRefs `bn`; setRef is `Oy`, refs `u`, isTemplateRefKey `Yi`. Each transform
// asserts its exact target is present, so a vue bump that changes the codegen
// fails loudly instead of silently no-op'ing.

export const VUE_PROD_BROWSER_BUILD =
  'vue/dist/vue.runtime-with-vapor.esm-browser.prod.js'

// Bug #1 — handleSetupResult. In prod the dev-only discriminator branch is
// dead-code-eliminated, so a NON-INLINE setup() (returns bindings + a separate
// render()) hits the bare `else` and the bindings object is assigned as the
// block; render() never runs and the island hydrates dead. Restore the branch:
// proxyRefs the bindings and call render() with them.
const FIX1_FROM = 'e===t&&n.render?r.block=mg(n.render,r,e):r.block=e'
const FIX1_TO =
  'e===t&&n.render?r.block=mg(n.render,r,e):!Jh(e)&&n.render?(r.setupState=bn(e),r.block=mg(n.render,r,r.setupState)):r.block=e'

// Bug #1b — setRef. In prod the `setupState[ref] = node` write is dead-code-
// eliminated, so a string template ref reaches only `instance.refs`, never the
// `const el = ref()` setup variable, leaving `el.value` null. Re-derive the
// setup-state handle + a "is this a real setup key" check at the top of setRef
// (where `e` is still the instance), then write through it on the string-ref path
// (`instance.setupState` is a proxyRefs proxy, so `ss[ref]=node` sets el.value).
const FIX1B_ANCHOR_FROM = 'let u=e.refs===t?e.refs={}:e.refs,d=(e,t)=>!(t&&Yi(u,t));'
const FIX1B_ANCHOR_TO =
  FIX1B_ANCHOR_FROM +
  'let vaporSS=e.setupState,vaporSSok=!!vaporSS&&vaporSS!==t,vaporCanSS=n=>vaporSSok&&!Yi(u,n)&&Object.prototype.hasOwnProperty.call(vaporSS,n);'
const FIX1B_WRITE_FROM = 'else e?u[r]=c:t&&(d(r,o)&&(r.value=c),o&&(u[o]=c))'
const FIX1B_WRITE_TO =
  'else e?(u[r]=c,vaporCanSS(r)&&(vaporSS[r]=c)):t&&(d(r,o)&&(r.value=c),o&&(u[o]=c))'

function replaceOnce(src, from, to, label) {
  const i = src.indexOf(from)
  if (i === -1) throw new Error(`patch target not found (${label}); the 3.6.0-beta.17 codegen may have changed`)
  if (src.indexOf(from, i + from.length) !== -1) throw new Error(`patch target not unique (${label})`)
  return src.slice(0, i) + to + src.slice(i + from.length)
}

/** Apply only bug #1 (handleSetupResult). */
export const applyFix1 = (src) => replaceOnce(src, FIX1_FROM, FIX1_TO, '#1 handleSetupResult')

/** Apply only bug #1b (setRef), layered on #1. */
export const applyFix1b = (src) =>
  replaceOnce(
    replaceOnce(src, FIX1B_ANCHOR_FROM, FIX1B_ANCHOR_TO, '#1b setRef anchor'),
    FIX1B_WRITE_FROM,
    FIX1B_WRITE_TO,
    '#1b setRef write',
  )

/** Reverse both fixes — used to recover the pristine runtime from any state. */
export function toUnpatched(src) {
  let out = src
  if (out.includes(FIX1_TO)) out = out.replace(FIX1_TO, FIX1_FROM)
  if (out.includes(FIX1B_ANCHOR_TO)) out = out.replace(FIX1B_ANCHOR_TO, FIX1B_ANCHOR_FROM)
  if (out.includes(FIX1B_WRITE_TO)) out = out.replace(FIX1B_WRITE_TO, FIX1B_WRITE_FROM)
  return out
}

/** True if `src` is the stock, unpatched runtime. */
export const isUnpatched = (src) => src.includes(FIX1_FROM) && !src.includes(FIX1_TO)
