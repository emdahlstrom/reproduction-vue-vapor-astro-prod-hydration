<script setup vapor lang="ts">
import { onMounted, ref } from 'vue'

// Bug #1 probe: a reactive counter. Its @click handler is attached inside the
// NON-INLINE render() Astro emits (a separate render(), not folded into setup()).
// If the prod runtime's handleSetupResult drops that render() — assigning the
// setup() bindings object straight to instance.block — the button hydrates dead:
// $evtclick is undefined and clicks do nothing.
const count = ref(0)

// Bug #1b probe: a setup-variable template ref. setRef should write the <p> into
// `el`, so `el.value` is the element in onMounted. In non-inline prod the
// `setupState[ref] = node` write is __DEV__-gated and dead-code-eliminated, so
// `el.value` stays null even once #1 lets render() run. Masked by #1 (no render,
// no onMounted), so it only shows once #1 is fixed.
const el = ref<HTMLElement | null>(null)
const refState = ref('pending')
onMounted(() => {
  refState.value = el.value ? 'ref-ok' : 'ref-null'
})
</script>

<template>
  <div>
    <button type="button" @click="count++">count is {{ count }}</button>
    <p ref="el" data-ref-probe>ref: {{ refState }}</p>
  </div>
</template>
