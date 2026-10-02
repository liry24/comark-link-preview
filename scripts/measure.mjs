import { build } from 'esbuild';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { writeFileSync, statSync } from 'node:fs';

const bundle = await build({
  entryPoints: ['dist/index.js'],
  bundle: true,
  minify: true,
  sourcemap: false,
  write: false,
  platform: 'browser',
  format: 'esm',
});
const bytes = bundle.outputFiles[0].contents;
const probe = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    String.raw`
import assert from 'node:assert/strict';
import { createMarkdownParser } from 'comark';
const start = performance.now();
const { default: linkPreview } = await import('./dist/index.js');
const imported = performance.now();
let fetchCount = 0;
const parse = createMarkdownParser({ plugins: [linkPreview({
  fetch: async () => { fetchCount++; return new Response('<head><title>Fixture title</title></head>', { headers: { 'content-type': 'text/html' } }); },
})] });
const source = ('Paragraph :inline-preview{href="https://example.com/"} body.\n\n').repeat(30);
const parseCount = 50;
const parseStart = performance.now();
for (let index = 0; index < parseCount; index++) {
  const document = await parse(source + '\n\nUpdate ' + index, { streaming: true });
  assert.ok(JSON.stringify(document.nodes).includes('Fixture title'));
}
const done = performance.now();
assert.equal(fetchCount, 1);
console.log(JSON.stringify({
  coldImportMs: imported - start,
  repeatParseMs: done - parseStart,
  averageParseMs: (done - parseStart) / parseCount,
  parseCount,
  sourceBytes: Buffer.byteLength(source),
  previewOccurrences: 30,
  fetchCount,
  heapUsed: process.memoryUsage().heapUsed,
}));
`,
  ],
  { encoding: 'utf8', timeout: 30_000 },
);
if (probe.error) throw probe.error;
if (probe.status !== 0) throw Error(probe.stderr || `Measurement failed (${probe.status})`);
const measurement = {
  archiveBytes: statSync('artifacts/comark-link-preview-0.0.0.tgz').size,
  entryBundles: {
    index: { minified: bytes.length, gzip: gzipSync(bytes).length, brotli: brotliCompressSync(bytes).length },
  },
  runtime: JSON.parse(probe.stdout),
};
writeFileSync('artifacts/measurements.json', JSON.stringify(measurement, null, 2) + '\n');
console.log(JSON.stringify(measurement, null, 2));
