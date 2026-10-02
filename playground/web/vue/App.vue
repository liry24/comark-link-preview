<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, shallowRef } from 'vue';
import { MarkdownDocument } from '@comark/vue';
import { parseMarkdown, type MarkdownDocument as ComarkDocument } from 'comark';
import { linkPreview } from 'comark-link-preview';
import { createFixture, localMedia } from '../../shared/fixture.ts';
import { mountControls } from '../../shared/controls.ts';
const fixture = createFixture();
const options = {
  allowedUrls: ['https://example.test/*'],
  fetch: fixture.fetch,
  mediaUrl: localMedia,
  limits: { deadlineMs: 10_000 },
};
let plugin = linkPreview(options);
let revision = 0;
const view = shallowRef<ComarkDocument>({ nodes: [], meta: {}, frontmatter: {} });
const controls = ref<HTMLElement>();
let disposeControls = () => {};
onMounted(() => {
  disposeControls = mountControls(controls.value!, fixture, async (source, reset) => {
    const current = ++revision;
    if (reset) plugin = linkPreview(options);
    const document = await parseMarkdown(source, { plugins: [plugin] });
    if (current === revision) view.value = document;
  });
});
onBeforeUnmount(() => {
  revision++;
  disposeControls();
});
</script>
<template>
  <div ref="controls" />
  <section data-preview-output>
    <Suspense><MarkdownDocument :value="view" /></Suspense>
  </section>
</template>
