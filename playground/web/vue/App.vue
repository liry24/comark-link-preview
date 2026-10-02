<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, shallowRef } from 'vue';
import { MarkdownDocument } from '@comark/vue';
import { initializePreviews } from 'comark-link-preview/browser';
import { createDemo, fixtureSource } from '../../shared/fixture.ts';
import { mountControls } from '../../shared/controls.ts';
const { controller, fixture } = createDemo('vue-fixture', location.origin);
const view = shallowRef(controller.getSnapshot());
const controls = ref<HTMLElement>();
const output = ref<HTMLElement>();
const unsubscribe = controller.subscribe((next) => {
  view.value = next;
});
let disposeControls = () => {};
let disposePreviews = () => {};
onMounted(() => {
  disposeControls = mountControls(controls.value!, controller, fixture);
  disposePreviews = initializePreviews(output.value!);
  void controller.update(fixtureSource, { ended: true });
});
onBeforeUnmount(() => {
  disposePreviews();
  disposeControls();
  unsubscribe();
  controller.dispose();
});
</script>
<template>
  <div ref="controls" />
  <section ref="output" data-preview-output><MarkdownDocument :value="view.value" /></section>
</template>
