import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const manager = process.env.CLP_PACKAGE_MANAGER ?? 'npm';
const archive = resolve(process.env.CLP_TARBALL ?? 'artifacts/comark-link-preview-0.0.0.tgz');
const directory = mkdtempSync(join(tmpdir(), 'preview-consumer-'));
const command =
  manager === 'bun'
    ? (process.env.BUN_BINARY ?? 'bun')
    : process.platform === 'win32'
      ? `${manager}.cmd`
      : manager;
function run(cmd, args, cwd = directory) {
  const child = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    timeout: 180_000,
    env: { ...process.env, NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE ?? join(directory, '.npm') },
    shell: process.platform === 'win32' && cmd.endsWith('.cmd'),
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw Error(`${cmd} failed (${child.status})`);
}
try {
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: {
        'comark-link-preview': `file:${archive}`,
        comark: process.env.CLP_COMARK_VERSION ?? '0.7.0',
        '@comark/html': '0.7.0',
        '@comark/ansi': '0.7.0',
        unstorage: '1.17.5',
      },
    }),
  );
  run(command, ['install', '--ignore-scripts']);
  const consumer = String.raw`import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import linkPreview, { linkPreview as namedLinkPreview } from 'comark-link-preview';
import * as publicApi from 'comark-link-preview';
import { createMarkdownParser, parseMarkdown as parse } from 'comark';
import { createHtmlRenderer, renderHtmlFromDocument } from '@comark/html';
import { createAnsiRenderer, renderAnsiFromDocument } from '@comark/ansi';
import { createStorage } from 'unstorage';

assert.equal(linkPreview, namedLinkPreview);
assert.deepEqual(Object.keys(publicApi).sort(), ['default', 'linkPreview']);
assert.match(readFileSync(new URL(import.meta.resolve('comark-link-preview/style.css')), 'utf8'), /clp-card/);
for (const entry of ['browser', 'fetch', 'workers', 'html', 'ansi']) {
  await assert.rejects(import('comark-link-preview/' + entry), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
}
const inline = (href, title) => ':inline-preview{href="' + href + '"' + (title ? ' title="' + title + '"' : '') + '}';
const htmlResponse = (title = 'Final metadata') => new Response('<head><title>' + title + '</title><meta name="description" content="Metadata description"></head>', { headers: { 'content-type': 'text/html' } });
const watchdog = setTimeout(() => { console.error('Packed native plugin acceptance timed out'); process.exit(1); }, 10_000);
try {
  let startFetch;
  const started = new Promise(resolve => { startFetch = resolve; });
  let finish;
  let calls = 0;
  let completed = false;
  const plugin = linkPreview({
    allowedUrls: ['https://example.com/*'],
    fetch: async () => { calls++; startFetch(); return new Promise(resolve => { finish = resolve; }); },
  });
  const originalMarkdown = 'Before ' + inline('https://example.com/a#one', 'Author title') + ' and ' + inline('https://example.com/a#two') + '\n\nLater body.';
  const parsing = parse(originalMarkdown, { plugins: [plugin] }).then(document => { completed = true; return document; });
  await started;
  assert.equal(completed, false, 'native parse must await async metadata post work');
  assert.equal(calls, 1, 'fragment variants must share one request');
  finish(htmlResponse());
  const document = await parsing;
  const html = await renderHtmlFromDocument(document);
  assert.match(html, /Author title/);
  assert.match(html, /Final metadata/);
  assert.match(html, /Later body/);
  assert.doesNotMatch(html, /<inline-preview|<preview-card|aria-busy="true"/);
  assert.match(originalMarkdown, /inline-preview/, 'the application keeps original Markdown for editing');
  const frozenResult = JSON.stringify(document);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(JSON.stringify(document), frozenResult, 'settled document must not mutate later');

  let fetches = 0;
  const render = createHtmlRenderer({ plugins: [linkPreview({ fetch: async () => { fetches++; return htmlResponse(); } })] });
  for (const source of [inline('https://example.com/reuse'), inline('https://example.com/reuse')]) assert.match(await render(source), /Final metadata/);
  assert.equal(fetches, 1, 'native renderer reuse must use the plugin cache');
  for (const source of [':: preview-card{href="https://example.com/card"}\n::', ':inline-preview[Label]{href="https://example.com/label"}']) assert.match(await render(source), /Final metadata/);

  let allow = true;
  const redirectFetches = [];
  const authorizeCalls = [];
  const policyRender = createHtmlRenderer({ plugins: [linkPreview({
    authorize: (url, context) => { authorizeCalls.push(context.kind + ':' + url.pathname); return allow || url.pathname !== '/final'; },
    fetch: async (url, init) => {
      redirectFetches.push(url);
      assert.equal(init.redirect, 'manual');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.method, 'GET');
      assert.equal(new Headers(init.headers).get('accept'), 'text/html');
      return String(url).endsWith('/start') ? new Response(null, { status: 302, headers: { location: '/final' } }) : htmlResponse();
    },
  })] });
  assert.match(await policyRender(inline('https://example.com/start')), /Final metadata/);
  allow = false;
  assert.doesNotMatch(await policyRender(inline('https://example.com/start')), /Final metadata/);
  assert.deepEqual(redirectFetches, ['https://example.com/start', 'https://example.com/final']);
  assert.deepEqual(authorizeCalls, ['initial:/start', 'redirect:/final', 'initial:/start', 'redirect:/final']);
  let forbiddenFetches = 0;
  const denied = await createHtmlRenderer({ plugins: [linkPreview({ allowedUrls: [], fetch: async () => { forbiddenFetches++; return htmlResponse(); } })] })(inline('https://example.com/denied'));
  assert.equal(forbiddenFetches, 0);
  assert.match(denied, /<a href="https:\/\/example.com\/denied">/);

  const fallback = await createHtmlRenderer({ plugins: [linkPreview({ fetch: async () => { throw Error('unavailable'); } })] })(inline('https://example.com/fallback', 'Author fallback'));
  assert.match(fallback, /<a href="https:\/\/example.com\/fallback">Author fallback<\/a>/);
  assert.doesNotMatch(fallback, /aria-busy/);
  const timeout = await createHtmlRenderer({ plugins: [linkPreview({ limits: { deadlineMs: 20 }, fetch: async () => new Promise(() => {}) })] })(inline('https://example.com/timeout'));
  assert.match(timeout, /https:\/\/example.com\/timeout/);
  assert.doesNotMatch(timeout, /aria-busy="true"/);

  const storage = createStorage({ driver: { name: 'stalled-write', hasItem: async () => false, getKeys: async () => [], getItem: async () => null, setItem: async () => new Promise(() => {}) } });
  let completedRequests = 0;
  const stalled = await createHtmlRenderer({ plugins: [linkPreview({ storage, namespace: 'packed-stalled-write', concurrency: 1, limits: { deadlineMs: 500 }, fetch: async url => { completedRequests++; return htmlResponse(new URL(String(url)).pathname); } })] })(inline('https://example.com/first') + ' ' + inline('https://example.com/second'));
  assert.match(stalled, /clp-/);
  assert.match(stalled, /\/first/);
  assert.match(stalled, /\/second/);
  assert.equal(completedRequests, 2, 'a hanging write must release the fetch slot');
  const hangingRead = createStorage({ driver: { name: 'stalled-read', hasItem: async () => true, getKeys: async () => [], getItem: async () => new Promise(() => {}) } });
  const readFallback = await createHtmlRenderer({ plugins: [linkPreview({ storage: hangingRead, namespace: 'packed-stalled-read', limits: { deadlineMs: 20 }, fetch: async () => htmlResponse() })] })(inline('https://example.com/cache'));
  assert.doesNotMatch(readFallback, /aria-busy="true"/);

  let streamingFetches = 0;
  const parseStreaming = createMarkdownParser({ plugins: [linkPreview({ allowedUrls: ['https://example.com/*'], fetch: async () => { streamingFetches++; return htmlResponse('Native streaming'); } })] });
  const autoClosed = await parseStreaming('See :inline-preview{href="https://example.com"', { streaming: true });
  assert.match(await renderHtmlFromDocument(autoClosed), /Native streaming/);
  assert.equal(streamingFetches, 1, 'native auto-closed URL can be fetched under policy');
  const repeated = await parseStreaming('See ' + inline('https://example.com/') + '\n\nAppended paragraph.', { streaming: true });
  assert.match(await renderHtmlFromDocument(repeated), /Appended paragraph/);
  assert.equal(streamingFetches, 1);

  const ansiOptions = { output: 'ansi', fetch: async () => htmlResponse('ANSI title') };
  const ansiDocument = await parse('::preview-card{href="https://example.com/ansi"}\n::', { plugins: [linkPreview(ansiOptions)] });
  const ansi = await renderAnsiFromDocument(ansiDocument, { colors: false });
  assert.match(ansi, /ANSI title/);
  assert.match(ansi, /Metadata description/);
  assert.match(ansi, /https:\/\/example.com\/ansi/);
  assert.doesNotMatch(ansi, /clp-|⌄/);
  assert.match(await createAnsiRenderer({ colors: false, plugins: [linkPreview(ansiOptions)] })(inline('https://example.com/ansi')), /ANSI title/);
  console.log('Packed plugin acceptance passed: native parse, HTML, ANSI, async completion, policy, cache, deduplication, fallback and stalled storage.');
} finally {
  clearTimeout(watchdog);
}`;
  writeFileSync(join(directory, 'consumer.mjs'), consumer);
  run(process.execPath, ['consumer.mjs']);
  writeFileSync(
    join(directory, 'consumer.ts'),
    `import linkPreview, { linkPreview as namedLinkPreview } from 'comark-link-preview';
import { createMarkdownParser, type ComarkPlugin } from 'comark';
import { createHtmlRenderer } from '@comark/html';
import { createAnsiRenderer } from '@comark/ansi';
import { createStorage } from 'unstorage';
const options: NonNullable<Parameters<typeof linkPreview>[0]> = {
  allowedUrls: ['https://*.example.com/*'],
  authorize: async (url, context) => url.protocol === 'https:' && !context.signal.aborted,
  fetch: globalThis.fetch,
  limits: { deadlineMs: 500, maxBytes: 10000, maxRedirects: 2, maxFieldLength: 512, maxImages: 2 },
  storage: createStorage(), namespace: 'consumer-policy', ttlMs: 1000, concurrency: 2,
  logger: (event) => { const code: string = event.code; void code; },
  mediaUrl: (url, kind) => kind === 'image' ? '/media/' + encodeURIComponent(url) : undefined,
  output: 'web',
};
const plugin: ComarkPlugin = linkPreview(options);
const parse = createMarkdownParser({ plugins: [plugin] });
const render = createHtmlRenderer({ plugins: [namedLinkPreview(options)] });
const ansi = createAnsiRenderer({ plugins: [linkPreview({ ...options, output: 'ansi' })] });
void parse('Text'); void render('Text'); void ansi('Text');
`,
  );
  run(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    '--module',
    'NodeNext',
    '--target',
    'ES2022',
    '--lib',
    'ES2022,DOM,DOM.Iterable',
    'consumer.ts',
  ]);
  let installedBytes = 0;
  const visit = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) installedBytes += statSync(full).size;
    }
  };
  visit(join(directory, 'node_modules'));
  console.log(JSON.stringify({ manager, installedBytes, archiveBytes: statSync(archive).size }));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
