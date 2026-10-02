import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { createStorage } from 'unstorage';
import { createUrlPolicy } from '../src/core/policy.ts';
import { createPreviewService } from '../src/core/service.ts';
import { createFetchResolver } from '../src/fetch.ts';
import type { PreviewSnapshot } from '../src/core/types.ts';
let server: Server;
let origin: string;
const hits: string[] = [];
const headers: unknown[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? '');
    headers.push(req.headers);
    if (req.url === '/start') {
      res.writeHead(302, { location: '/final' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<head><title>Local fixture</title><meta property="og:title" content="Final metadata"></head>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing TCP port');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
async function settled(service: ReturnType<typeof createPreviewService>, url: string) {
  const snapshots: PreviewSnapshot[] = [];
  const sub = service.subscribe(url, (value) => snapshots.push(value));
  await vi.waitFor(() => expect(snapshots.at(-1)?.state).not.toBe('pending'));
  sub.unsubscribe();
  return snapshots.at(-1)!;
}
it('native URLPattern patterns are optional, deny-empty, normalized and composed with callback', async () => {
  const signal = new AbortController().signal;
  const context = { kind: 'initial' as const, signal };
  await expect(createUrlPolicy()(new URL('http://localhost/'), context)).resolves.toBeUndefined();
  await expect(
    createUrlPolicy({ allowedUrls: [] })(new URL('https://example.com/'), context),
  ).rejects.toMatchObject({ code: 'denied' });
  const policy = createUrlPolicy({
    allowedUrls: ['https://*.example.com/*'],
    authorize: (url) => url.pathname !== '/private',
  });
  await expect(policy(new URL('https://A.EXAMPLE.COM/path?q=1&q=2'), context)).resolves.toBeUndefined();
  for (const url of [
    'https://example.com/',
    'https://sub.example.com.evil/',
    'http://sub.example.com/',
    'https://sub.example.com/private',
  ])
    await expect(policy(new URL(url), context)).rejects.toMatchObject({ code: 'denied' });
});
it('invalid pattern configuration throws synchronously', () => {
  expect(() => createUrlPolicy({ allowedUrls: ['bad pattern'] })).toThrow(/pattern|URL/iu);
});
it('Native fetch follows only authorized redirects and policy mutation cannot rewrite requests', async () => {
  const calls: string[] = [];
  const offset = hits.length;
  const service = createPreviewService(
    createFetchResolver({
      authorize(url, context) {
        calls.push(`${context.kind}:${url.pathname}`);
        url.pathname = '/mutated';
        return true;
      },
    }),
  );
  expect((await settled(service, origin + '/start')).metadata.title).toBe('Final metadata');
  expect(hits.slice(offset)).toEqual(['/start', '/final']);
  expect(calls).toEqual(['initial:/start', 'redirect:/final']);
  expect(headers.at(-1)).not.toHaveProperty('authorization');
  expect(headers.at(-1)).not.toHaveProperty('cookie');
  service.dispose();
});
it('denies redirect before network and rechecks a cached redirect chain under current policy', async () => {
  const storage = createStorage();
  let permitFinal = true;
  const provider = createFetchResolver({ authorize: (url) => permitFinal || url.pathname !== '/final' });
  const service = createPreviewService({ ...provider, storage, namespace: 'tenant:resolver:policy-v1' });
  expect((await settled(service, origin + '/start')).state).toBe('ready');
  const before = hits.length;
  permitFinal = false;
  expect((await settled(service, origin + '/start')).state).toBe('failed');
  expect(hits.length).toBe(before);
  service.dispose();
  const deny = createPreviewService(createFetchResolver({ allowedUrls: [origin + '/start'] }));
  const offset = hits.length;
  expect((await settled(deny, origin + '/start')).state).toBe('failed');
  expect(hits.slice(offset)).toEqual(['/start']);
  deny.dispose();
});
it('bounds asynchronous authorization and never fetches after cancellation', async () => {
  let requests = 0;
  const service = createPreviewService({
    deadlineMs: 10,
    policy: { authorize: () => new Promise(() => {}) },
    resolve: async () => {
      requests++;
      return {};
    },
  });
  expect((await settled(service, origin + '/start')).state).toBe('failed');
  expect(requests).toBe(0);
  service.dispose();
});
it('a new subscriber reauthorizes completed data even while an older view remains mounted', async () => {
  let allow = true;
  let fetched = 0;
  const service = createPreviewService({
    policy: { authorize: () => allow },
    resolve: async () => {
      fetched++;
      return { title: 'Visible' };
    },
  });
  let first: PreviewSnapshot | undefined;
  const mounted = service.subscribe(origin + '/final', (snapshot) => {
    first = snapshot;
  });
  await vi.waitFor(() => expect(first?.state).toBe('ready'));
  allow = false;
  expect((await settled(service, origin + '/final')).state).toBe('failed');
  expect(fetched).toBe(1);
  mounted.unsubscribe();
  service.dispose();
});
