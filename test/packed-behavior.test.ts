import { expect, it, vi } from 'vitest';
import { createStorage } from 'unstorage';
import { createPreviewService } from 'comark-link-preview';
it('optional cache persistence cannot hide successful previews or starve a queued document', async () => {
  const storage = createStorage({
    driver: {
      name: 'stalled-write',
      hasItem: async () => false,
      getKeys: async () => [],
      getItem: async () => null,
      setItem: async () => new Promise<void>(() => {}),
    },
  });
  const service = createPreviewService({
    storage,
    namespace: 'stalled-cache-fixture',
    concurrency: 1,
    deadlineMs: 2000,
    resolve: async (url) => ({ title: new URL(url).pathname }),
  });
  const visible = new Map<string, string>();
  const first = service.subscribe('https://example.com/first', (snapshot) => {
    if (snapshot.state === 'ready') visible.set('first', snapshot.metadata.title!);
  });
  const second = service.subscribe('https://example.com/second', (snapshot) => {
    if (snapshot.state === 'ready') visible.set('second', snapshot.metadata.title!);
  });
  await vi.waitFor(() => expect([...visible.values()]).toEqual(['/first', '/second']));
  first.unsubscribe();
  second.unsubscribe();
  service.dispose();
});
it('accepted Comark forms resolve visibly, and unfinished final input never spins or fetches', async () => {
  const { createPreviewController } = await import('comark-link-preview');
  const { renderPreviewHtml } = await import('comark-link-preview/html');
  for (const source of [
    ':: preview-card{href="https://example.com"}\n::',
    ':inline-preview[Label]{href="https://example.com"}',
  ]) {
    const c = createPreviewController({
      documentId: 'grammar',
      resolver: { resolve: async () => ({ title: 'Resolved preview' }) },
    });
    await c.update(source, { ended: true });
    await vi.waitFor(() => expect(c.getSnapshot().targets[0]?.snapshot.state).toBe('ready'));
    expect(await renderPreviewHtml(c.getSnapshot())).toContain('Resolved preview');
    c.dispose();
  }
  let fetched = false;
  const c = createPreviewController({
    documentId: 'unfinished',
    resolver: {
      resolve: async () => {
        fetched = true;
        return {};
      },
    },
  });
  await c.update('See :inline-preview{href="https://example.com', { ended: true });
  expect(fetched).toBe(false);
  expect(await renderPreviewHtml(c.getSnapshot())).not.toContain('aria-busy');
  c.dispose();
});
