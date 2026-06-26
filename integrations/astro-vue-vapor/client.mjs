// Client renderer: a vDOM host + vaporInteropPlugin hydrates the standard
// ssrRender output (markers match). Mirrors @astrojs/vue's client.js.
//
// Imports bare `vue`, which the integration's Vite plugin redirects to the
// with-vapor build — the SAME module the vapor SFCs resolve to. That single
// shared copy is essential: two copies of the runtime each carry their own
// `currentInstance`, so the vapor slot/effect helpers read null and hydration
// crashes ("Cannot read properties of null (reading 'rawSlots')"). Dynamic so
// the runtime stays code-split.
import { buildSlots, makeHost } from './_shared.mjs'

const vuePromise = import('vue')

export default (element) => async (Component, props, slotted, { client }) => {
  if (!element.hasAttribute('ssr') && client !== 'only') return
  const { Suspense, createApp, createSSRApp, defineComponent, h, vaporInteropPlugin } =
    await vuePromise

  const slots = buildSlots(slotted, defineComponent, h)
  const isHydrate = client !== 'only'
  const app = (isHydrate ? createSSRApp : createApp)(
    makeHost({ Suspense, h }, Component, props, slots),
  )
  app.config.idPrefix = element.getAttribute('prefix') ?? undefined
  app.use(vaporInteropPlugin)
  app.mount(element, isHydrate)
  // Deterministic "hydration done" signal: the event listeners are now wired,
  // so tests (and anything else) can wait for this instead of racing the click.
  element.setAttribute('data-vapor-hydrated', '')
  element.addEventListener('astro:unmount', () => app.unmount(), { once: true })
}
