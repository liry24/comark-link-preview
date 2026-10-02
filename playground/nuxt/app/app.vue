<script setup lang="ts">
import { MarkdownDocument } from '@comark/vue';
import { initializePreviews } from 'comark-link-preview/browser';
import { createDemo } from '../../shared/fixture.ts';
import { mountControls } from '../../shared/controls.ts';
const { data: initial } = await useAsyncData('preview-initial', () => $fetch('/api/document'));
if (!initial.value) throw new Error('Missing SSR fixture');
const { controller, fixture } = createDemo(
  initial.value.documentId,
  useRequestURL().origin,
  initial.value,
  true,
);
const view = shallowRef(controller.getSnapshot());
const controls = ref<HTMLElement>();
const output = ref<HTMLElement>();
let cleanup = () => {};
onMounted(() => {
  // The first client render is identical to the request-local SSR snapshot.
  const unsubscribe = controller.subscribe((next) => {
    view.value = next;
  });
  const disposePreviews = initializePreviews(output.value!);
  const disposeControls = mountControls(controls.value!, controller, fixture);
  controller.resume();
  cleanup = () => {
    disposePreviews();
    disposeControls();
    unsubscribe();
    controller.dispose();
  };
});
onBeforeUnmount(() => {
  cleanup();
  controller.dispose();
});
</script>
<template>
  <nav><a href="http://127.0.0.1:5173/">All examples</a></nav>
  <h1>Nuxt SSR + hydration</h1>
  <p>
    The server renders a suspended serializable snapshot. Metadata starts through a local endpoint only after
    hydration.
  </p>
  <div ref="controls" />
  <section ref="output" data-preview-output><MarkdownDocument :value="view.value" /></section>
</template>
