import { expect, it, vi } from 'vitest';
import { createPreviewController } from '../src/comark/controller.ts';
import type { PreviewMetadata, PreviewResolver, PreviewSnapshot } from '../src/core/types.ts';
function fixture() {
  const requests: {
    url: string;
    emit: (snapshot: PreviewSnapshot) => void;
    finish: (metadata: PreviewMetadata) => void;
    signal: AbortSignal;
  }[] = [];
  const resolve: PreviewResolver = (url, options) =>
    new Promise((complete) => {
      requests.push({ url, emit: options.emit, finish: complete, signal: options.signal });
    });
  return { requests, resolve };
}
it('never fetches autoclosured href and fetches confirmed literal inline before stream end', async () => {
  const f = fixture();
  const c = createPreviewController({ documentId: 'doc', resolver: { resolve: f.resolve } });
  const beginning = 'See :inline-preview{href="https://example.com';
  for (const char of beginning) await c.append(char);
  expect(f.requests).toHaveLength(0);
  expect(c.getSnapshot().targets[0]?.confirmed).toBe(false);
  await c.append('"}');
  await vi.waitFor(() => expect(f.requests).toHaveLength(1));
  expect(c.getSnapshot().targets[0]?.confirmed).toBe(true);
  c.dispose();
  expect(f.requests[0]?.signal.aborted).toBe(true);
});
it('skeleton and later body are independent from metadata and occurrence IDs differ for same URL', async () => {
  const f = fixture();
  const c = createPreviewController({ documentId: 'doc', resolver: { resolve: f.resolve } });
  await c.update('::preview-card{href="https://example.com"}\n::\n');
  const id = c.getSnapshot().targets[0]?.id;
  expect(c.getSnapshot().targets[0]?.snapshot.state).toBe('pending');
  await c.append('\nBody keeps coming. See :inline-preview{href="https://example.com"}');
  await vi.waitFor(() => expect(f.requests).toHaveLength(1));
  const snapshot = c.getSnapshot();
  expect(snapshot.targets).toHaveLength(2);
  expect(snapshot.targets[0]?.id).toBe(id);
  expect(snapshot.targets[1]?.id).not.toBe(id);
  expect(JSON.stringify(snapshot.value)).toContain('Body keeps coming');
  f.requests[0]?.emit({ state: 'pending', metadata: { title: 'Metadata only' } });
  expect(c.getSnapshot().targets.map((t) => t.snapshot.metadata.title)).toEqual([
    'Metadata only',
    'Metadata only',
  ]);
  f.requests[0]?.finish({ title: 'Done' });
  await vi.waitFor(() => expect(c.getSnapshot().targets[0]?.snapshot.state).toBe('ready'));
  expect(c.getSnapshot().source).toContain('Body keeps coming');
  c.dispose();
});
it('holds block attrs for leading YAML and cancels when later props replace href', async () => {
  const f = fixture();
  const c = createPreviewController({ documentId: 'doc', resolver: { resolve: f.resolve } });
  await c.update('::preview-card{href="https://first.example"}\n');
  expect(f.requests).toHaveLength(0);
  await c.append('---\nhref: https://second.example\n---\n');
  await vi.waitFor(() => expect(f.requests[0]?.url).toBe('https://second.example/'));
  await c.append('Body\n```yaml [props]\nhref: https://third.example');
  expect(f.requests[0]?.signal.aborted).toBe(true);
  await c.append('\n```\n::\n');
  await vi.waitFor(() => expect(f.requests[1]?.url).toBe('https://third.example/'));
  c.dispose();
});
it('edits cancel stale work and cannot roll document back', async () => {
  const f = fixture();
  const c = createPreviewController({ documentId: 'doc', resolver: { resolve: f.resolve } });
  await c.update('See :inline-preview{href="https://old.example"}');
  await vi.waitFor(() => expect(f.requests).toHaveLength(1));
  await c.update('New body :inline-preview{href="https://new.example"}');
  await vi.waitFor(() => expect(f.requests).toHaveLength(2));
  f.requests[0]?.finish({ title: 'Stale' });
  f.requests[1]?.finish({ title: 'Current' });
  await vi.waitFor(() => expect(c.getSnapshot().targets[0]?.snapshot.state).toBe('ready'));
  expect(c.getSnapshot().targets[0]?.snapshot.metadata.title).toBe('Current');
  expect(c.getSnapshot().source).toMatch(/^New body/u);
  c.dispose();
});
it('does not resolve dynamic href and JSON SSR snapshot resumes only unresolved data after hydration', async () => {
  const f = fixture();
  const first = createPreviewController({ documentId: 'server', resolver: { resolve: f.resolve } });
  await first.update('See :inline-preview{:href="frontmatter.link"}');
  expect(f.requests).toHaveLength(0);
  await first.update('See :inline-preview{href="https://example.com" title="Author"}');
  const initial = JSON.parse(JSON.stringify(first.getSnapshot()));
  first.dispose();
  const g = fixture();
  const client = createPreviewController({ documentId: 'server', initial, resolver: { resolve: g.resolve } });
  expect(client.getSnapshot().value).toEqual(initial.value);
  expect(g.requests).toHaveLength(0);
  client.resume();
  await vi.waitFor(() => expect(g.requests).toHaveLength(1));
  client.dispose();
});
it('late appended duplicate adopts existing ready metadata without refetching', async () => {
  const f = fixture();
  const c = createPreviewController({ documentId: 'duplicates', resolver: { resolve: f.resolve } });
  await c.update('First :inline-preview{href="https://example.com"}');
  await vi.waitFor(() => expect(f.requests).toHaveLength(1));
  f.requests[0]?.finish({ title: 'Ready' });
  await vi.waitFor(() => expect(c.getSnapshot().targets[0]?.snapshot.state).toBe('ready'));
  await c.append(' Second :inline-preview{href="https://example.com#section"}');
  expect(c.getSnapshot().targets.map((target) => target.snapshot.state)).toEqual(['ready', 'ready']);
  expect(f.requests).toHaveLength(1);
  c.dispose();
});
it('invalid scheme is terminal without network and malformed SSR metadata is rejected', async () => {
  const f = fixture();
  const c = createPreviewController({ documentId: 'unsafe', resolver: { resolve: f.resolve } });
  await c.update('See :inline-preview{href="javascript:alert(1)"}');
  await c.end();
  expect(f.requests).toHaveLength(0);
  expect(c.getSnapshot().targets[0]?.snapshot.state).toBe('failed');
  const initial = JSON.parse(JSON.stringify(c.getSnapshot()));
  initial.targets[0].snapshot.metadata.title = ['img', { onerror: 'bad' }];
  expect(() =>
    createPreviewController({ documentId: 'unsafe', initial, resolver: { resolve: f.resolve } }),
  ).toThrow('Invalid preview snapshot');
  c.dispose();
});
it('spaced nested block cannot confirm an unfinished later props region', async () => {
  const f = fixture();
  const c = createPreviewController({ documentId: 'nested', resolver: { resolve: f.resolve } });
  await c.update(
    '::preview-card{href="https://old.example"}\n:: child\nBody\n::\n```yaml [props]\nhref: https://partial.example\n```',
  );
  expect(c.getSnapshot().targets[0]?.confirmed).toBe(false);
  expect(f.requests).toHaveLength(0);
  c.dispose();
});
