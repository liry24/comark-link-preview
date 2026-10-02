import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createMarkdownParser } from 'comark';
import type { MarkdownDocument, Node, ComarkPlugin } from 'comark';
import { createPreviewSourceTracker } from '../src/comark/source.ts';
function previews(doc: MarkdownDocument) {
  const all: any[] = [];
  function walk(n: Node) {
    if (typeof n === 'string') return;
    if (['inline-preview', 'preview-card'].includes(String(n[0]))) all.push(n);
    for (const c of n.slice(2) as Node[]) walk(c);
  }
  for (const n of doc.nodes) walk(n);
  return all;
}
const fixtures = [
  ':: preview-card{href="https://one.example"}\n::',
  '::outer[See :inline-preview{href="https://one.example"}]\n::',
  '- | :inline-preview{href="https://one.example"} | two |\n  | --- | --- |',
  ':inline-preview[Label]{href="https://one.example"}',
  'See :inline-preview{href="https://one.example"} and :inline-preview{href="https://two.example"}',
  '> Quoted :inline-preview{href="https://one.example"}\n> next :inline-preview{href="https://two.example"}',
  '- Listed :inline-preview{href="https://one.example"}\n  next :inline-preview{href="https://two.example"}',
  '> - Nested :inline-preview{href="https://one.example"}\n>   next :inline-preview{href="https://two.example"}',
  '::outer\n  ::preview-card{href="https://one.example"}\n  ::\n::',
  '- ::outer\n  ::preview-card{href="https://one.example"}\n  ::\n  ::',
  '| :inline-preview{href="https://one.example"} | :inline-preview{href="https://two.example"} |\n| --- | --- |',
  '| one | two |\n| --- | --- |\n| before \\| :inline-preview{href="https://one.example"} | :inline-preview{href="https://two.example"} |',
  '> | :inline-preview{href="https://one.example"} | :inline-preview{href="https://two.example"} |\n> | --- | --- |',
  '| :inline-preview{href="https://one.example"} | :inline-preview{href="https://one.example"} |\n| --- | --- |',
  '---\ntitle: hello\n---\n\nSee :inline-preview{href="https://one.example"}',
  '# heading\r\n\r\nSee :inline-preview{href="https://one.example"}',
  'a~b :inline-preview{href="https://one.example"}',
  '` :inline-preview{href="https://fake.example"}` See :inline-preview{href="https://one.example"}',
  '\\:inline-preview{href="https://fake.example"} See :inline-preview{href="https://one.example"}',
  '```md\n::preview-card{href="https://fake.example"}\n::\n```\n\n::preview-card{href="https://one.example"}\n::',
];
for (const [i, source] of fixtures.entries())
  test(`source attribution fixture ${i}`, async () => {
    let raw = source;
    const tracking = createPreviewSourceTracker(() => raw);
    const parse = createMarkdownParser({
      autoUnwrap: false,
      autoClose: tracking.autoClose,
      plugins: [tracking.plugin],
    });
    const doc = await parse(raw, { streaming: true });
    const targets = previews(doc);
    assert.ok(targets.length > 0);
    for (const target of targets) {
      const start = target[1].$?.previewStart;
      assert.equal(typeof start, 'number', JSON.stringify({ source, target, doc }));
      const marker = source.slice(start).match(/^:+[ \t]*(?:inline-preview|preview-card)/)?.[0];
      assert.ok(marker, JSON.stringify({ source, target }));
      assert.ok(source.slice(start).includes(target[1].href));
    }
    const offsets = targets.map((n) => n[1].$.previewStart);
    assert.equal(new Set(offsets).size, offsets.length);
    const expected = [
      ...source.matchAll(
        /:+[ \t]*(?:inline-preview|preview-card)(?:\[[^\]]*\])?\{href="https:\/\/(?!fake)[^"]+"/g,
      ),
    ].map((m) => m.index);
    assert.deepEqual(offsets, expected);
  });
test('every character with nested containers, tail reuse, and synthetic table closure', async () => {
  let raw = '';
  const tracking = createPreviewSourceTracker(() => raw);
  const parse = createMarkdownParser({
    autoUnwrap: false,
    autoClose: tracking.autoClose,
    plugins: [tracking.plugin],
  });
  const source =
    '# Heading\n\n> - First :inline-preview{href="https://one.example"}\n>   second :inline-preview{href="https://two.example"}\n\n| :inline-preview{href="https://three.example"} | item |\n|---|---|\n\n::preview-card{href="https://four.example"}\n::\n\nFooter';
  for (const char of source) {
    raw += char;
    const doc = await parse(raw, { streaming: true });
    for (const target of previews(doc)) {
      assert.equal(typeof target[1].$?.previewStart, 'number', JSON.stringify({ raw, target, doc }));
    }
  }
});
test('author cannot forge reserved source-position markers', async () => {
  let raw = 'See :inline-preview{href="https://one.example" data-clp-source-start="999"}';
  const tracking = createPreviewSourceTracker(() => raw);
  const parse = createMarkdownParser({ autoClose: tracking.autoClose, plugins: [tracking.plugin] });
  const doc = await parse(raw, { streaming: true });
  const target = previews(doc)[0];
  assert.equal(target[1].$.previewStart, 4);
  assert.equal(target[1]['data-clp-source-start'], undefined);
});
test('unknown pre transform fails closed for the transformed tail', async () => {
  let raw = 'See :inline-preview{href="https://one.example" data-clp-source-start="999"}';
  const tracking = createPreviewSourceTracker(() => raw);
  const parse = createMarkdownParser<ComarkPlugin[]>({
    autoClose: tracking.autoClose,
    plugins: [
      {
        name: 'transform',
        pre(state) {
          state.markdown += '\nChanged';
        },
      },
      tracking.plugin,
    ],
  });
  const doc = await parse(raw, { streaming: true });
  const target = previews(doc)[0];
  assert.equal(target[1].$?.previewStart, undefined);
  assert.equal(target[1]['data-clp-source-start'], undefined);
});
test('forged author $.previewStart is removed when source mapping fails closed', async () => {
  let raw = '::preview-card\n---\n$: \'{"previewStart":999}\'\nhref: https://one.example\n---\n::';
  const tracking = createPreviewSourceTracker(() => raw);
  const parse = createMarkdownParser<ComarkPlugin[]>({
    autoClose: tracking.autoClose,
    plugins: [
      {
        name: 'transform',
        pre(state) {
          state.markdown += '\nChanged';
        },
      },
      tracking.plugin,
    ],
  });
  const doc = await parse(raw, { streaming: true });
  const target = previews(doc)[0];
  assert.equal(target[1].$?.previewStart, undefined);
  assert.equal(typeof target[1].$?.line, 'number');
});
test('trusted source offsets survive prefix reuse and cannot be overwritten through $', async () => {
  let raw = '::preview-card{href="https://one.example"}\n::\n\nMiddle\n\nTail';
  const tracking = createPreviewSourceTracker(() => raw);
  const parse = createMarkdownParser({ autoClose: tracking.autoClose, plugins: [tracking.plugin] });
  const first = await parse(raw, { streaming: true });
  const target = previews(first)[0];
  assert.equal(target[1].$.previewStart, 0);
  target[1].$.previewStart = 999;
  raw += ' next';
  const next = await parse(raw, { streaming: true });
  assert.strictEqual(previews(next)[0], target);
  assert.equal(target[1].$.previewStart, 0);
});
