<script lang="ts">
  import { onMount } from 'svelte';
  import { MarkdownDocument } from '@comark/svelte';
  import { parseMarkdown, type MarkdownDocument as ComarkDocument } from 'comark';
  import { linkPreview } from 'comark-link-preview';
  import { createFixture, localMedia } from '../../shared/fixture.ts';
  import { mountControls } from '../../shared/controls.ts';
  let view = $state<ComarkDocument>({ nodes: [], meta: {}, frontmatter: {} });
  let controls: HTMLDivElement;
  onMount(() => {
    const fixture = createFixture();
    const options = {
      allowedUrls: ['https://example.test/*'],
      fetch: fixture.fetch,
      mediaUrl: localMedia,
      limits: { deadlineMs: 10_000 },
    };
    let plugin = linkPreview(options);
    let revision = 0;
    const disposeControls = mountControls(controls, fixture, async (source, reset) => {
      const current = ++revision;
      if (reset) plugin = linkPreview(options);
      const document = await parseMarkdown(source, { plugins: [plugin] });
      if (current === revision) view = document;
    });
    return () => { revision++; disposeControls(); };
  });
</script>
<div bind:this={controls}></div>
<section data-preview-output><MarkdownDocument value={view} /></section>
