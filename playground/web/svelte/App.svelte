<script lang="ts">
  import { onMount } from 'svelte';
  import { MarkdownDocument } from '@comark/svelte';
  import { initializePreviews } from 'comark-link-preview/browser';
  import { createDemo, fixtureSource } from '../../shared/fixture.ts';
  import { mountControls } from '../../shared/controls.ts';
  const { controller, fixture } = createDemo('svelte-fixture', location.origin);
  let view = $state(controller.getSnapshot());
  let controls: HTMLDivElement;
  let output: HTMLElement;
  onMount(() => {
    const unsubscribe = controller.subscribe(next => { view = next; });
    const disposeControls = mountControls(controls, controller, fixture);
    const disposePreviews = initializePreviews(output);
    void controller.update(fixtureSource, { ended: true });
    return () => { disposePreviews(); disposeControls(); unsubscribe(); controller.dispose(); };
  });
</script>
<div bind:this={controls}></div>
<section bind:this={output} data-preview-output><MarkdownDocument value={view.value} /></section>
