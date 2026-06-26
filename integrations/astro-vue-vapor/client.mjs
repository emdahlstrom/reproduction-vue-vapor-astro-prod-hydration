// Client renderer: a vDOM host + vaporInteropPlugin hydrates the standard
// ssrRender output (the SSR markers match). Mirrors @astrojs/vue's client.js.
//
// Imports bare `vue`, which the integration's Vite plugin redirects to the
// with-vapor build — the SAME module the vapor SFC resolves to. One shared copy
// is essential: two copies each carry their own `currentInstance`, so the vapor
// interop helpers read null and hydration crashes. Dynamic import keeps the
// runtime code-split.
const vuePromise = import('vue')

export default (element) => async (Component, props, _slotted, { client }) => {
  if (!element.hasAttribute('ssr') && client !== 'only') return
  const { createApp, createSSRApp, h, vaporInteropPlugin } = await vuePromise

  const isHydrate = client !== 'only'
  // Same vnode tree as the server (see server.mjs) so hydration markers align.
  const app = (isHydrate ? createSSRApp : createApp)({
    render: () => h(Component, props || {}),
  })
  app.use(vaporInteropPlugin)
  app.mount(element, isHydrate)
  // Deterministic "hydration done" signal: the listeners are now wired, so tests
  // can wait for this instead of racing the click.
  element.setAttribute('data-vapor-hydrated', '')
  element.addEventListener('astro:unmount', () => app.unmount(), { once: true })
}
