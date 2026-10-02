import { expect, it, vi } from 'vitest';
import { createMarkdownParser, parseMarkdown as parse, type Node } from 'comark';
import { createHtmlRenderer, renderHtmlFromDocument } from '@comark/html';
import { createAnsiRenderer, renderAnsiFromDocument } from '@comark/ansi';
import { createStorage } from 'unstorage';
import { linkPreview } from '../src/index.ts';

function requestUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function response(html: string) {
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
const inline = (href = 'https://example.com/', title?: string) =>
  `:inline-preview{href="${href}"${title ? ` title="${title}"` : ''}}`;
const card = (href = 'https://example.com/') => `::preview-card{href="${href}"}\n::`;
function tags(nodes: Node[]): string[] {
  return nodes.flatMap((node) =>
    typeof node === 'string' || node[0] === null ? [] : [node[0], ...tags(node.slice(2) as Node[])],
  );
}

it('native parse awaits the asynchronous post hook and returns a completed ordinary HTML AST', async () => {
  let finish: ((value: Response) => void) | undefined;
  let complete = false;
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = parse(`Before ${inline()} after.\n\n${card()}`, {
    plugins: [linkPreview({ fetch })],
  }).then((document) => {
    complete = true;
    return document;
  });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(complete).toBe(false);
  finish?.(
    response('<head><title>Fetched title</title><meta name="description" content="Description"></head>'),
  );
  const document = await pending;
  expect(tags(document.nodes)).not.toEqual(expect.arrayContaining(['inline-preview', 'preview-card']));
  const html = await renderHtmlFromDocument(document);
  expect(html).toContain('Fetched title');
  expect(html).toContain('Description');
  expect(html).toContain('Before ');
  expect(html).toContain(' after.');
  expect(html).not.toContain('aria-busy="true"');
  const finished = JSON.stringify(document);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(JSON.stringify(document)).toBe(finished);
});

it.each([
  ':inline-preview[Label]{href="https://example.com/"}',
  ':: preview-card{href="https://example.com/"}\n::',
  '> A quoted :inline-preview{href="https://example.com/"}',
  '- List :inline-preview{href="https://example.com/"}',
])('supports native Comark grammar through plugins only: %s', async (source) => {
  const render = createHtmlRenderer({
    plugins: [linkPreview({ fetch: async () => response('<title>Resolved</title>') })],
  });
  expect(await render(source)).toContain('Resolved');
});

it('leaves ordinary Markdown links and code examples alone', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const document = await parse(
    '[Ordinary](https://example.com/)\n\n`:inline-preview{href="https://example.com/"}`',
    {
      plugins: [linkPreview({ fetch })],
    },
  );
  const html = await renderHtmlFromDocument(document);
  expect(fetch).not.toHaveBeenCalled();
  expect(html).toContain('href="https://example.com/"');
  expect(html).toContain('Ordinary');
  expect(html).toContain('<code>');
});

it('author title wins over fetched title and hostile fetched markup is escaped', async () => {
  const render = createHtmlRenderer({
    plugins: [
      linkPreview({
        fetch: async () =>
          response(
            '<head><title>&lt;script&gt;bad&lt;/script&gt;</title><meta name="description" content="&lt;img src=x onerror=alert(1)&gt;"></head>',
          ),
      }),
    ],
  });
  const html = await render(
    `${inline('https://example.com/a', 'Author title')} ${inline('https://example.com/b')}`,
  );
  expect(html).toContain('Author title');
  expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;');
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img src=x');
});

it('metadata failure and empty metadata settle as ordinary links with the author title or URL', async () => {
  for (const fetch of [
    async () => {
      throw Error('unavailable');
    },
    async () => response('<head></head>'),
    async () => new Response('not html', { headers: { 'content-type': 'text/plain' } }),
  ]) {
    const render = createHtmlRenderer({ plugins: [linkPreview({ fetch })] });
    const html = await render(
      `${inline('https://example.com/a', 'Author')} ${inline('https://example.com/b')}`,
    );
    expect(html).toContain('<a href="https://example.com/a">Author</a>');
    expect(html).toContain('<a href="https://example.com/b">https://example.com/b</a>');
    expect(html).not.toContain('aria-busy');
    expect(html).not.toContain('clp-card');
  }
});

it('does not create nested links or controls inside an existing interactive ancestor', async () => {
  const html = await createHtmlRenderer({
    plugins: [linkPreview({ fetch: async () => response('<title>Inner title</title>') })],
  })(`[See ${inline('https://example.com/', 'Author nested title')}](https://outer.example/)`);
  expect((html.match(/<a\b/gu) ?? []).length).toBe(1);
  expect(html).not.toContain('<button');
  expect(html).toContain('Author nested title');
});

it('supports the native ANSI renderer without an adapter or custom component map', async () => {
  const options = {
    fetch: async () =>
      response(
        '<head><title>Terminal title</title><meta name="description" content="Terminal description"></head>',
      ),
    output: 'ansi' as const,
  };
  const document = await parse(`${inline()}\n\n${card('https://example.com/card')}`, {
    plugins: [linkPreview(options)],
  });
  const ansi = await renderAnsiFromDocument(document, { colors: false });
  expect(ansi).toContain('Terminal title');
  expect(ansi).toContain('Terminal description');
  expect(ansi).toContain('https://example.com/');
  expect(ansi).not.toContain('clp-');
  expect(ansi).not.toContain('⌄');
  expect(await createAnsiRenderer({ colors: false, plugins: [linkPreview(options)] })(card())).toContain(
    'Terminal title',
  );
});

it('permits policy-approved native auto-closed URLs and still settles incomplete input', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response('<title>Auto-closed</title>'));
  const parseStreaming = createMarkdownParser({
    plugins: [linkPreview({ fetch, allowedUrls: ['https://example.com/*'] })],
  });
  const document = await parseStreaming('See :inline-preview{href="https://example.com"', {
    streaming: true,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await renderHtmlFromDocument(document)).toContain('Auto-closed');
});

it('repeated native streaming parses reuse metadata while preserving newly appended content', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response('<title>Cached title</title>'));
  const parseStreaming = createMarkdownParser({ plugins: [linkPreview({ fetch })] });
  const first = await parseStreaming(`Before ${inline()}`, { streaming: true });
  expect(await renderHtmlFromDocument(first)).toContain('Cached title');
  const second = await parseStreaming(`Before ${inline()}\n\nLater body ${inline()}`, { streaming: true });
  const html = await renderHtmlFromDocument(second);
  expect(html).toContain('Later body');
  expect(html).not.toContain('<inline-preview');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('deduplicates fragment variants but keeps distinct ordered queries distinct', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response('<title>Shared</title>'));
  await parse(
    `${inline('https://example.com/path#one')} ${inline('https://example.com/path#two')} ${inline('https://example.com/path?a=1&b=2')} ${inline('https://example.com/path?b=2&a=1')}`,
    { plugins: [linkPreview({ fetch })] },
  );
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls.map(([url]) => requestUrl(url))).toEqual(
    expect.arrayContaining([
      'https://example.com/path',
      'https://example.com/path?a=1&b=2',
      'https://example.com/path?b=2&a=1',
    ]),
  );
});

it('bounds concurrent fetches through the flat concurrency option', async () => {
  let active = 0;
  let maximum = 0;
  const releases: Array<() => void> = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active--;
    return response('<title>Finished</title>');
  });
  const parsing = parse([1, 2, 3].map((id) => inline(`https://example.com/${id}`)).join(' '), {
    plugins: [linkPreview({ fetch, concurrency: 1 })],
  });
  for (let count = 1; count <= 3; count++) {
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(count));
    releases.shift()?.();
  }
  expect(await renderHtmlFromDocument(await parsing)).toContain('Finished');
  expect(maximum).toBe(1);
});

it('a never-settling fetch is bounded and yields a final fallback even if it ignores abort', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Promise<Response>(() => {}));
  const logs: unknown[] = [];
  const started = performance.now();
  const document = await parse(inline(), {
    plugins: [linkPreview({ fetch, limits: { deadlineMs: 25 }, logger: (event) => logs.push(event) })],
  });
  expect(performance.now() - started).toBeLessThan(1000);
  expect(await renderHtmlFromDocument(document)).toContain(
    '<a href="https://example.com/">https://example.com/</a>',
  );
  expect(logs).toContainEqual({ code: 'timeout' });
  expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});

it('hanging optional cache writes neither hide successful metadata nor starve queued previews', async () => {
  const storage = createStorage({
    driver: {
      name: 'stalled-write',
      hasItem: async () => false,
      getKeys: async () => [],
      getItem: async () => null,
      setItem: async () => new Promise<void>(() => {}),
    },
  });
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
    response(`<title>${new URL(requestUrl(input)).pathname}</title>`),
  );
  const document = await parse(
    `${inline('https://example.com/first')} ${inline('https://example.com/second')}`,
    {
      plugins: [
        linkPreview({
          fetch,
          storage,
          namespace: 'stalled-write',
          concurrency: 1,
          limits: { deadlineMs: 200 },
        }),
      ],
    },
  );
  const html = await renderHtmlFromDocument(document);
  expect(html).toContain('/first');
  expect(html).toContain('/second');
  expect(html).toContain('clp-');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('a hanging cache read cannot leave native parse pending forever', async () => {
  const storage = createStorage({
    driver: {
      name: 'stalled-read',
      hasItem: async () => true,
      getKeys: async () => [],
      getItem: async () => new Promise<null>(() => {}),
    },
  });
  const started = performance.now();
  const document = await parse(inline(), {
    plugins: [
      linkPreview({
        fetch: async () => response('<title>Available</title>'),
        storage,
        namespace: 'stalled-read',
        limits: { deadlineMs: 25 },
      }),
    ],
  });
  expect(performance.now() - started).toBeLessThan(1000);
  expect(await renderHtmlFromDocument(document)).not.toContain('aria-busy="true"');
});

it('uses isolated default caches and requires explicit shared-storage namespaces', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response('<title>One</title>'));
  const render = createHtmlRenderer({ plugins: [linkPreview({ fetch })] });
  await render(inline());
  await render(inline());
  expect(fetch).toHaveBeenCalledTimes(1);
  await createHtmlRenderer({ plugins: [linkPreview({ fetch })] })(inline());
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(() => linkPreview({ storage: createStorage() })).toThrow(/namespace/iu);
});

it('mediaUrl can use a same-origin proxy and rejects unsafe replacements', async () => {
  const fetch: typeof globalThis.fetch = async () =>
    response(
      '<head><title>Media</title><link rel="icon" href="/icon.png"><meta property="og:image" content="/image.png"></head>',
    );
  const html = await createHtmlRenderer({
    plugins: [
      linkPreview({
        fetch,
        mediaUrl: (_url, kind) => (kind === 'image' ? '/media/image.png' : 'javascript:alert(1)'),
      }),
    ],
  })(card());
  expect(html).toContain('src="/media/image.png"');
  expect(html).not.toContain('javascript:');
  expect(html).not.toContain('src="https://example.com/icon.png"');
});

it('rejects unsafe destinations and malformed unfinished URLs without fetching', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response('<title>Never used</title>'));
  const parseStreaming = createMarkdownParser({ plugins: [linkPreview({ fetch })] });
  for (const source of [
    inline('javascript:alert(1)'),
    inline('https://user:password@example.com/'),
    'See :inline-preview{href="https://example.com',
  ]) {
    const html = await renderHtmlFromDocument(await parseStreaming(source, { streaming: true }));
    expect(html).not.toContain('aria-busy="true"');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('password');
  }
  expect(fetch).not.toHaveBeenCalled();
});

it('shared storage respects namespaces and expiry', async () => {
  const storage = createStorage();
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response('<title>Persisted</title>'));
  const render = (namespace: string) =>
    createHtmlRenderer({ plugins: [linkPreview({ fetch, storage, namespace, ttlMs: 100 })] });
  try {
    expect(await render('tenant-one')(inline())).toContain('Persisted');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await render('tenant-one')(inline())).toContain('Persisted');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await render('tenant-two')(inline())).toContain('Persisted');
    expect(fetch).toHaveBeenCalledTimes(2);
    now.mockReturnValue(1101);
    expect(await render('tenant-one')(inline())).toContain('Persisted');
    expect(fetch).toHaveBeenCalledTimes(3);
  } finally {
    now.mockRestore();
  }
});

it('keeps repeated documents separate and preserves IDs through SSR document serialization', async () => {
  const fetch: typeof globalThis.fetch = async () => response('<title>Repeated preview</title>');
  const plugin = linkPreview({ fetch });
  const first = await parse(inline(), { plugins: [plugin] });
  const second = await parse(inline(), { plugins: [plugin] });
  const firstHtml = await renderHtmlFromDocument(first);
  const secondHtml = await renderHtmlFromDocument(second);
  const firstTarget = /popovertarget="([^"]+)"/u.exec(firstHtml)?.[1];
  const secondTarget = /popovertarget="([^"]+)"/u.exec(secondHtml)?.[1];
  expect(firstTarget).toBeTruthy();
  expect(secondTarget).toBeTruthy();
  expect(secondTarget).not.toBe(firstTarget);
  expect(await renderHtmlFromDocument(JSON.parse(JSON.stringify(first)))).toBe(firstHtml);
  const render = () =>
    createHtmlRenderer({ plugins: [linkPreview({ fetch, idPrefix: 'article-one' })] })(inline());
  expect(await render()).toBe(await render());
});
