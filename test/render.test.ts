import { expect, it, vi } from 'vitest';
import { renderMarkdown } from 'comark/render';
import { createPreviewController } from '../src/comark/controller.ts';
import { renderPreviewHtml } from '../src/html.ts';
import { renderPreviewAnsi, connectPreviewAnsi } from '../src/ansi.ts';
import { createPreviewService } from '../src/core/service.ts';
import { createWorkersResolver } from '../src/workers.ts';
it('keeps author semantic nodes and title on Markdown round-trip, escapes HTML output', async () => {
  const c = createPreviewController({
    documentId: 'render',
    resolver: { resolve: async () => ({ title: '<script>bad</script>', description: 'Description' }) },
  });
  await c.update('See :inline-preview{href="https://example.com" title="Author"}');
  await c.end();
  await vi.waitFor(() => expect(c.getSnapshot().targets[0]?.snapshot.state).toBe('ready'));
  const html = await renderPreviewHtml(c.getSnapshot());
  expect(html).toContain('Author');
  expect(html).not.toContain('<script>');
  expect(html).toContain('popover="manual"');
  const markdown = await renderMarkdown(c.getSnapshot().document);
  expect(markdown).toContain('inline-preview');
  expect(markdown).toContain('href="https://example.com"');
  expect(markdown).toContain('title="Author"');
  expect(markdown).not.toContain('Description');
  c.dispose();
});
it('ANSI handles previews as safe text; noninteractive output waits and prints once', async () => {
  let finish: ((metadata: { title: string }) => void) | undefined;
  const c = createPreviewController({
    documentId: 'ansi',
    resolver: {
      resolve: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
  });
  const writes: string[] = [];
  const disconnect = connectPreviewAnsi(c, { write: (text) => writes.push(text), isTTY: false });
  await c.update('::preview-card{href="https://example.com" title="Author"}\n::\n');
  await c.end();
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(writes).toHaveLength(0);
  finish?.({ title: 'OG' });
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toContain('Author');
  expect(writes[0]).toContain('https://example.com');
  expect(await renderPreviewAnsi(c.getSnapshot())).not.toContain('<');
  disconnect();
  c.dispose();
});
it('Workers uses fresh public fetch options, manual redirects and no caller headers', async () => {
  const calls: unknown[][] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
    calls.push(args);
    return new Response('<head><title>Worker</title></head>', { headers: { 'content-type': 'text/html' } });
  };
  try {
    const service = createPreviewService(
      createWorkersResolver({ publicFetch: 'global_fetch_strictly_public' }),
    );
    let ready = false;
    const subscription = service.subscribe('https://example.com', (snapshot) => {
      if (snapshot.state === 'ready') {
        expect(snapshot.metadata).toEqual({ title: 'Worker' });
        ready = true;
      }
    });
    await vi.waitFor(() => expect(ready).toBe(true));
    subscription.unsubscribe();
    service.dispose();
    expect(calls[0]?.[1]).toMatchObject({
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      headers: { accept: 'text/html' },
    });
  } finally {
    globalThis.fetch = original;
  }
});
