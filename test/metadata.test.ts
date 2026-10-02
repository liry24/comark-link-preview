import { describe, expect, it } from 'vitest';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { createMetadataParser } from '../src/metadata/parser.ts';
import { createResolver } from '../src/metadata/resolver.ts';
import { createPreviewCache } from '../src/core/cache.ts';
import { fetchIdentity, safeUrl } from '../src/core/url.ts';
import type { PreviewSnapshot, TransportResponse } from '../src/core/types.ts';

describe('metadata streaming', () => {
  it('emits independent title candidates, retains priority and withholds media until base is final', () => {
    const updates: unknown[] = [];
    const parser = createMetadataParser({
      url: 'https://example.com/a/',
      emit: (data) => updates.push(data),
    });
    parser.write('<head><title>HTML &amp; title</title><link rel="icon" href="favicon.ico">');
    expect(parser.snapshot()).toEqual({ title: 'HTML & title' });
    parser.write('<meta property="og:title" content="OG"><meta property="og:title" content="ignored">');
    expect(parser.snapshot()).toEqual({ title: 'OG' });
    parser.write(
      '<base href="https://cdn.example.com/"><meta property="og:image" content="a.png"><meta property="og:image:alt" content="Alt">',
    );
    expect(parser.snapshot()).toEqual({
      title: 'OG',
      favicon: 'https://cdn.example.com/favicon.ico',
      images: [{ url: 'https://cdn.example.com/a.png', alt: 'Alt' }],
    });
    parser.write('</head><body><meta property="og:title" content="body ignored">');
    expect(parser.done).toBe(true);
    expect(parser.end().title).toBe('OG');
    expect(updates.length).toBeGreaterThan(2);
  });
  it('preserves image associations, excludes unsafe media and ignores template content', () => {
    const parser = createMetadataParser({ url: 'https://example.com/' });
    parser.write(
      '<head><template><meta property="og:title" content="evil"></template><meta property="og:image" content="https://example.com/1.png"><meta property="og:image:width" content="120"><meta property="og:image" content="http://example.com/2.png"><meta property="og:image:height" content="60"></head>',
    );
    expect(parser.end()).toEqual({ images: [{ url: 'https://example.com/1.png', width: 120 }] });
  });
  it('matches parse5 title entity extraction across per-character chunks', () => {
    const html =
      '<!doctype html><html><head><title>A &amp; B &lt;x&gt;</title></head><body>ignored</body></html>';
    const parser = createMetadataParser({ url: 'https://example.com/' });
    for (const char of html) parser.write(char);
    const document = parse(html);
    const element = (node: DefaultTreeAdapterTypes.ChildNode): node is DefaultTreeAdapterTypes.Element =>
      'tagName' in node;
    const title = document.childNodes
      .filter(element)
      .find((node) => node.tagName === 'html')
      ?.childNodes.filter(element)
      .find((node) => node.tagName === 'head')
      ?.childNodes.filter(element)
      .find((node) => node.tagName === 'title');
    expect(parser.end().title).toBe(
      title?.childNodes.map((node) => ('value' in node ? node.value : '')).join(''),
    );
  });
});

function response(
  chunks: string[],
  headers = { 'content-type': 'text/html; charset=utf-8' },
): TransportResponse {
  return {
    status: 200,
    headers: new Headers(headers),
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
  };
}
it('resolver yields pending before ready and releases the body at head end', async () => {
  let cancelled = false;
  const updates: PreviewSnapshot[] = [];
  const resolve = createResolver(async () => ({
    status: 200,
    headers: new Headers({ 'content-type': 'text/html' }),
    body: new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('<head><title>A</title>'));
        c.enqueue(new TextEncoder().encode('<meta property="og:title" content="B"></head>'));
      },
      cancel() {
        cancelled = true;
      },
    }),
  }));
  const result = await resolve('https://example.com/', {
    signal: new AbortController().signal,
    emit: (update) => updates.push(update),
  });
  expect(result.title).toBe('B');
  expect(updates[0]?.state).toBe('pending');
  expect(updates.at(-1)?.state).toBe('ready');
  expect(cancelled).toBe(true);
});
it('rejects response byte limit and encoding, including malformed UTF8', async () => {
  const resolve = createResolver(async () => response(['<head><title>Too long']), { maxBytes: 4 });
  await expect(
    resolve('https://example.com', { signal: new AbortController().signal, emit() {} }),
  ).rejects.toMatchObject({ code: 'limit' });
  const nonUtf = createResolver(async () => response([], { 'content-type': 'text/html; charset=shift_jis' }));
  await expect(
    nonUtf('https://example.com', { signal: new AbortController().signal, emit() {} }),
  ).rejects.toMatchObject({ code: 'encoding' });
});
it('rejects unsupported schemes and credentials without claiming SSRF protection', () => {
  for (const url of ['https://u:p@example.com/', 'javascript:alert(1)']) expect(safeUrl(url)).toBeUndefined();
  expect(safeUrl('http://localhost/')).toBeDefined();
  expect(fetchIdentity('https://example.com/?b=1&a=2&a=3#section')).toBe('https://example.com/?b=1&a=2&a=3');
});
it('isolates instance caches and validates stored metadata', async () => {
  const one = createPreviewCache();
  const two = createPreviewCache();
  await one.set('https://example.com/', { title: 'Cached' });
  expect(await one.get('https://example.com/')).toEqual({ metadata: { title: 'Cached' }, redirects: [] });
  expect(await two.get('https://example.com/')).toBeUndefined();
  await one.set('https://invalid.example/', { favicon: 'http://localhost/' });
  expect(await one.get('https://invalid.example/')).toBeUndefined();
});
it('does not attach discarded image attributes to the preceding retained image', () => {
  const parser = createMetadataParser({ url: 'https://example.com/', maxImages: 1 });
  parser.write(
    '<head><meta property="og:image" content="one.png"><meta property="og:image" content="two.png"><meta property="og:image:alt" content="Second"><meta property="og:image:width" content="222"></head>',
  );
  expect(parser.end().images).toEqual([{ url: 'https://example.com/one.png' }]);
});
it('chooses first safe media and falls back from invalid OG to Twitter image', () => {
  const parser = createMetadataParser({ url: 'https://example.com/' });
  parser.write(
    '<head><link rel="icon" href="http://unsafe.example/i"><link rel="icon" href="/icon.svg"><meta property="og:image" content="http://unsafe.example/i"><meta name="twitter:image" content="/twitter.png"></head>',
  );
  expect(parser.end()).toEqual({
    favicon: 'https://example.com/icon.svg',
    images: [{ url: 'https://example.com/twitter.png' }],
  });
});
