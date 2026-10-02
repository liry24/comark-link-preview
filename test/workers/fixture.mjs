import { parseMarkdown as parse } from 'comark';
import { createStorage } from 'unstorage';
import defaultLinkPreview, { linkPreview } from '../../dist/index.js';

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function elements(nodes) {
  return nodes.flatMap((node) =>
    typeof node === 'string' || node[0] === null ? [] : [node, ...elements(node.slice(2))],
  );
}

function completed(document) {
  check(
    elements(document.nodes).every(
      ([tag, attributes]) =>
        !['inline-preview', 'preview-card'].includes(tag) && attributes['aria-busy'] !== 'true',
    ),
    'parse must return a completed ordinary AST',
  );
}

function fallback(document, href, title) {
  completed(document);
  check(
    elements(document.nodes).some(
      ([tag, attributes, text]) => tag === 'a' && attributes.href === href && text === title,
    ),
    `expected an ordinary fallback link for ${href}`,
  );
  check(!JSON.stringify(document).includes('clp-card'), 'failed previews must not leave a card');
}

const inline = (href, title = '') => `:inline-preview{href="${href}" title="${title}"}`;

async function run() {
  const checks = [];
  check(linkPreview === defaultLinkPreview, 'default and named root exports must match');
  check(typeof globalThis.fetch === 'function', 'native Web Fetch must be available');
  check(typeof URLPattern === 'function', 'native URLPattern must be available');
  check(typeof process === 'undefined' && typeof Buffer === 'undefined', 'no Node compatibility required');
  check(typeof crypto.subtle.digest === 'function', 'native Web Crypto must be available');
  check(new URLPattern('https://preview.example/*').test('https://preview.example/article'), 'URLPattern');
  checks.push('web-runtime');

  const storage = createStorage();
  const requests = [];
  const policyCalls = [];
  let denyArticle = false;
  let releaseArticle;
  let articleStarted;
  const started = new Promise((resolve) => {
    articleStarted = resolve;
  });
  const article = new Promise((resolve) => {
    releaseArticle = resolve;
  });
  const html =
    '<head><title>Worker title</title><meta name="description" content="Worker description"></head>';

  // All Fetch objects and the response stream are created inside workerd. This
  // is deterministic API portability coverage, not a public-egress assertion.
  const fixtureFetch = async (input, init) => {
    const request = new Request(input, init);
    check(request.method === 'GET', 'metadata fetch must use GET');
    check(request.redirect === 'manual', 'redirects must stay under plugin policy');
    check(request.headers.get('accept') === 'text/html', 'metadata request must ask for HTML');
    check(init.credentials === 'omit', 'metadata fetch must omit credentials');
    check(init.signal instanceof AbortSignal, 'metadata fetch must receive a native AbortSignal');
    requests.push(request.url);
    if (request.url === 'https://preview.example/redirect') {
      return new Response(null, { status: 302, headers: { location: '/article' } });
    }
    if (request.url === 'https://preview.example/article') {
      articleStarted();
      await article;
      const bytes = new TextEncoder().encode(html);
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, 24));
            controller.enqueue(bytes.slice(24));
            controller.close();
          },
        }),
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }
    if (request.url === 'https://preview.example/offline') throw new TypeError('fixture unavailable');
    throw new Error(`unexpected fixture request: ${request.url}`);
  };
  const options = {
    fetch: fixtureFetch,
    storage,
    namespace: 'worker-portability-policy',
    allowedUrls: ['https://preview.example/*'],
    authorize: async (url, context) => {
      check(context.signal instanceof AbortSignal, 'policy must receive a native signal');
      policyCalls.push({ url: url.href, kind: context.kind, from: context.from?.href });
      await Promise.resolve();
      return !(denyArticle && url.pathname === '/article');
    },
  };
  const markdown = `Before ${inline('https://preview.example/redirect#inline', 'Author title')} after.\n\n::preview-card{href="https://preview.example/redirect#card"}\n::`;
  let settled = false;
  const pending = parse(markdown, { plugins: [linkPreview(options)] }).then((document) => {
    settled = true;
    return document;
  });
  await Promise.race([
    started,
    pending.then(() => {
      throw new Error('Comark completed before the fixture response was released');
    }),
  ]);
  check(!settled, 'Comark must await the metadata response');
  releaseArticle();
  const document = await pending;
  completed(document);
  const serialized = JSON.stringify(document);
  for (const text of ['Before ', ' after.', 'Author title', 'Worker title', 'Worker description']) {
    check(serialized.includes(text), `completed AST must contain ${text}`);
  }
  check(requests.length === 2, 'fragment variants must share one redirect and article fetch');
  check(
    policyCalls.some((call) => call.kind === 'redirect' && call.from === 'https://preview.example/redirect'),
    'redirect must pass through the asynchronous URL policy',
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  check(JSON.stringify(document) === serialized, 'returned AST must stay completed');
  checks.push('completed-ast');

  // A fresh plugin instance rules out an instance-local response being mistaken
  // for a shared unstorage hit. Cache keys exercise native SHA-256 as well.
  const keys = await storage.getKeys();
  check(keys.length === 1, 'shared unstorage must contain the completed preview');
  check(!keys[0].includes('preview.example'), 'cache keys must hash the URL');
  const cached = await parse(markdown, { plugins: [linkPreview(options)] });
  completed(cached);
  check(JSON.stringify(cached).includes('Worker title'), 'shared cache must preserve metadata');
  check(requests.length === 2, 'fresh plugin must read shared storage without refetching');
  checks.push('shared-cache');

  denyArticle = true;
  const denied = await parse(inline('https://preview.example/redirect', 'Denied'), {
    plugins: [linkPreview(options)],
  });
  fallback(denied, 'https://preview.example/redirect', 'Denied');
  check(requests.length === 2, 'denied cached redirect must not refetch');
  check(policyCalls.at(-1)?.kind === 'redirect', 'cached redirect must be reauthorized');
  checks.push('cached-redirect-policy');

  const outside = await parse(inline('https://outside.example/article', 'Outside'), {
    plugins: [linkPreview(options)],
  });
  fallback(outside, 'https://outside.example/article', 'Outside');
  check(requests.length === 2, 'URLPattern denial must prevent fetch');
  const failed = await parse(inline('https://preview.example/offline', 'Unavailable'), {
    plugins: [linkPreview(options)],
  });
  fallback(failed, 'https://preview.example/offline', 'Unavailable');
  check(requests.length === 3, 'network failure must settle as a fallback');
  checks.push('failure-fallback');

  await storage.dispose();
  return { ok: true, checks };
}

export default {
  async fetch() {
    try {
      return Response.json(await run());
    } catch (error) {
      return Response.json({ ok: false, error: String(error), stack: error.stack }, { status: 500 });
    }
  },
};
