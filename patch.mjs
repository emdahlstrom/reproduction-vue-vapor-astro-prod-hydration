// The two runtime edits, as string transforms on the build Astro bundles on the
// client: `vue/dist/vue.runtime-with-vapor.esm-browser.prod.js`. This is the
// single source of truth — verify.mjs applies these to prove each state, and
// running `node patch.mjs` regenerates patches/vue@3.6.0-beta.17.patch from them
// (wired via pnpm.patchedDependencies), so the shipped patch and the proof can
// never drift.
//
// The build is minified, so the targets are mangled names from 3.6.0-beta.17:
// handleSetupResult is `Tg`, callRender `mg`, EMPTY_OBJ `t`, isBlock `Jh`,
// proxyRefs `bn`; setRef is `Oy`, refs `u`, isTemplateRefKey `Yi`. Each transform
// asserts its target is present, so a vue bump that changes the codegen fails
// loudly instead of silently no-op'ing.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

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
  return src
    .replace(FIX1_TO, FIX1_FROM)
    .replace(FIX1B_ANCHOR_TO, FIX1B_ANCHOR_FROM)
    .replace(FIX1B_WRITE_TO, FIX1B_WRITE_FROM)
}

// `node patch.mjs` — regenerate patches/vue@3.6.0-beta.17.patch with the pnpm
// patch workflow and wire it via pnpm.patchedDependencies. Run after a vue bump,
// having first re-pointed the snippets above at the new codegen.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const VUE_PKG = 'vue@3.6.0-beta.17'
  const editDir = mkdtempSync(join(tmpdir(), 'vue-vapor-patch-'))
  const run = (...args) => {
    const r = spawnSync('pnpm', args, { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`)
  }
  try {
    run('patch', VUE_PKG, '--edit-dir', editDir)
    // Inside the unpacked package the build sits at dist/… (strip the `vue/` prefix).
    const file = join(editDir, VUE_PROD_BROWSER_BUILD.replace(/^vue\//, ''))
    writeFileSync(file, applyFix1b(applyFix1(toUnpatched(readFileSync(file, 'utf8')))))
    run('patch-commit', editDir)
  } finally {
    rmSync(editDir, { recursive: true, force: true })
  }
  console.log('Wrote patches/vue@3.6.0-beta.17.patch and wired pnpm.patchedDependencies.')
}
