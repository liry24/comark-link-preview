import { expect, it, vi } from 'vitest';
import { createHtmlRenderer } from '@comark/html';
import { createStorage } from 'unstorage';
import { linkPreview } from '../src/index.ts';
import { createUrlPolicy } from '../src/core/policy.ts';

function requestUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

const source = ':inline-preview{href="https://example.com/start"}';
const response = () =>
  new Response('<head><title>Final metadata</title></head>', { headers: { 'content-type': 'text/html' } });

it('native URLPattern patterns are optional, deny-empty, normalized and composed with callback', async () => {
  const context = { kind: 'initial' as const, signal: new AbortController().signal };
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
  ]) {
    await expect(policy(new URL(url), context)).rejects.toMatchObject({ code: 'denied' });
  }
});

it('invalid policy configuration fails synchronously', () => {
  expect(() => linkPreview({ allowedUrls: ['bad pattern'] })).toThrow(/pattern|URL/iu);
});

it('flat policy options deny the initial URL before fetch', async () => {
  for (const policy of [{ allowedUrls: [] }, { authorize: () => false }]) {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
    const html = await createHtmlRenderer({ plugins: [linkPreview({ fetch, ...policy })] })(source);
    expect(fetch).not.toHaveBeenCalled();
    expect(html).toContain('<a href="https://example.com/start">');
    expect(html).not.toContain('Final metadata');
  }
});

it('fetches with fresh anonymous GET options and authorizes every manual redirect', async () => {
  const authorizations: string[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
    new URL(requestUrl(input)).pathname === '/start'
      ? new Response(null, { status: 302, headers: { location: '/final' } })
      : response(),
  );
  const html = await createHtmlRenderer({
    plugins: [
      linkPreview({
        fetch,
        authorize(url, context) {
          authorizations.push(`${context.kind}:${url.pathname}`);
          url.pathname = '/must-not-rewrite';
          return true;
        },
      }),
    ],
  })(source);
  expect(html).toContain('Final metadata');
  expect(fetch.mock.calls.map(([url]) => requestUrl(url))).toEqual([
    'https://example.com/start',
    'https://example.com/final',
  ]);
  expect(authorizations).toEqual(['initial:/start', 'redirect:/final']);
  for (const [, init] of fetch.mock.calls) {
    expect(init).toMatchObject({
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      headers: { accept: 'text/html' },
    });
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    expect(new Headers(init?.headers).has('cookie')).toBe(false);
  }
});

it('denies a redirect before its network request and reauthorizes cached redirect chains', async () => {
  let permitFinal = true;
  const storage = createStorage();
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
    requestUrl(input).endsWith('/start')
      ? new Response(null, { status: 302, headers: { location: '/final' } })
      : response(),
  );
  const render = createHtmlRenderer({
    plugins: [
      linkPreview({
        fetch,
        storage,
        namespace: 'policy-test',
        authorize: (url) => permitFinal || url.pathname !== '/final',
      }),
    ],
  });
  expect(await render(source)).toContain('Final metadata');
  permitFinal = false;
  expect(await render(source)).not.toContain('Final metadata');
  expect(fetch).toHaveBeenCalledTimes(2);
  const deniedFetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(null, { status: 302, headers: { location: '/final' } }),
  );
  const denied = await createHtmlRenderer({
    plugins: [linkPreview({ fetch: deniedFetch, allowedUrls: ['https://example.com/start'] })],
  })(source);
  expect(deniedFetch).toHaveBeenCalledTimes(1);
  expect(denied).not.toContain('Final metadata');
});

it('bounds an asynchronous authorization that never settles, without fetching afterward', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
  const html = await createHtmlRenderer({
    plugins: [
      linkPreview({ fetch, limits: { deadlineMs: 25 }, authorize: () => new Promise<boolean>(() => {}) }),
    ],
  })(source);
  expect(html).toContain('<a href="https://example.com/start">');
  expect(fetch).not.toHaveBeenCalled();
});

it('rechecks current authorization for every parse even when metadata is cached', async () => {
  let allowed = true;
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
  const render = createHtmlRenderer({ plugins: [linkPreview({ fetch, authorize: () => allowed })] });
  expect(await render(source)).toContain('Final metadata');
  allowed = false;
  expect(await render(source)).not.toContain('Final metadata');
  expect(fetch).toHaveBeenCalledTimes(1);
});
