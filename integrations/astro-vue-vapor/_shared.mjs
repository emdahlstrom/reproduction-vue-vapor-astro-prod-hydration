// Helpers shared by the server and client renderers. They run against different
// `vue` builds (modular on the server, with-vapor on the client), so the vue
// primitives are passed in rather than imported here.

const isAsyncSetup = (fn) => fn?.constructor?.name === 'AsyncFunction'

// A component that emits an Astro slot as raw HTML (mirrors @astrojs/vue).
const makeStaticHtml = (defineComponent, h) =>
  defineComponent({
    props: { value: String, name: String },
    setup: ({ value, name }) =>
      value ? () => h('astro-slot', { name, innerHTML: value }) : () => null,
  })

/** Turn Astro's `slotted` map into Vue slot functions of StaticHtml vnodes. */
export function buildSlots(slotted, defineComponent, h) {
  const StaticHtml = makeStaticHtml(defineComponent, h)
  const slots = {}
  for (const [key, value] of Object.entries(slotted || {})) {
    slots[key] = () =>
      h(StaticHtml, { value, name: key === 'default' ? undefined : key })
  }
  return slots
}

/**
 * The vDOM host that wraps a vapor component so it renders as an Astro island:
 * a render function returning the component (inside a Suspense boundary when its
 * setup is async). Used identically by both renderers, so it lives here.
 */
export function makeHost({ Suspense, h }, Component, props, slots) {
  return {
    name: Component.name ? `${Component.name} Host` : undefined,
    render() {
      const content = h(Component, props || {}, slots)
      return isAsyncSetup(Component.setup) ? h(Suspense, null, content) : content
    },
  }
}
