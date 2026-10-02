<script setup lang="ts">
import { MarkdownDocument } from '@comark/vue';
import { parseMarkdown } from 'comark';
import { linkPreview } from 'comark-link-preview';
import { createFixture, fixtureSource, localMedia } from '../../shared/fixture.ts';
import { mountControls } from '../../shared/controls.ts';

// Request-local plugin and deterministic HTML fetch. The SSR payload is the final AST.
const { data: initial } = await useAsyncData('preview-document', async () => {
  const fixture = createFixture(0);
  return parseMarkdown(fixtureSource, {
    plugins: [
      linkPreview({
        allowedUrls: ['https://example.test/*'],
        fetch: fixture.fetch,
        mediaUrl: localMedia,
        limits: { deadlineMs: 10_000 },
      }),
    ],
  });
});
if (!initial.value) throw new Error('Missing SSR document');
const view = shallowRef(initial.value);
const controls = ref<HTMLElement>();
let revision = 0;
let cleanup = () => {};
onMounted(() => {
  const fixture = createFixture();
  const options = {
    allowedUrls: ['https://example.test/*'],
    fetch: fixture.fetch,
    mediaUrl: localMedia,
    limits: { deadlineMs: 10_000 },
  };
  let plugin = linkPreview(options);
  cleanup = mountControls(controls.value!, fixture, async (source, reset) => {
    const current = ++revision;
    if (reset) plugin = linkPreview(options);
    const document = await parseMarkdown(source, { plugins: [plugin] });
    if (current === revision) view.value = document;
  });
});
onBeforeUnmount(() => {
  revision++;
  cleanup();
});
</script>
<template>
  <nav><a href="http://127.0.0.1:5173/">All examples</a></nav>
  <h1>Nuxt SSR + hydration</h1>
  <p>
    The server awaits the same standard plugin and sends complete preview HTML. The client hydrates that
    document.
  </p>
  <div ref="controls" />
  <section data-preview-output><MarkdownDocument :value="view" /></section>
</template>
