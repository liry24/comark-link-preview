import { build } from 'esbuild';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { writeFileSync, statSync } from 'node:fs';
const results = {};
for (const entry of ['index', 'browser', 'fetch', 'workers', 'html', 'ansi']) {
  const result = await build({
    entryPoints: [`dist/${entry}.js`],
    bundle: true,
    minify: true,
    sourcemap: false,
    write: false,
    platform: entry === 'ansi' ? 'node' : 'browser',
    format: 'esm',
  });
  const bytes = result.outputFiles[0].contents;
  results[entry] = {
    minified: bytes.length,
    gzip: gzipSync(bytes).length,
    brotli: brotliCompressSync(bytes).length,
  };
}
const probe = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `const start=performance.now(); const {createPreviewController}=await import('./dist/index.js'); const imported=performance.now(); const c=createPreviewController({documentId:'bench',resolver:{resolve:async()=>({title:'Fixture'})}}); const source=('Paragraph :inline-preview{href="https://example.com"} body.\\n\\n').repeat(30); for(let i=0;i<source.length;i+=40)await c.update(source.slice(0,i+40));await c.end();const done=performance.now();c.dispose();console.log(JSON.stringify({coldImportMs:imported-start,streamParseMs:done-imported,heapUsed:process.memoryUsage().heapUsed}));`,
  ],
  { encoding: 'utf8' },
);
if (probe.status !== 0) throw Error(probe.stderr);
const measurement = {
  archiveBytes: statSync('artifacts/comark-link-preview-0.0.0.tgz').size,
  entryBundles: results,
  runtime: JSON.parse(probe.stdout),
};
writeFileSync('artifacts/measurements.json', JSON.stringify(measurement, null, 2) + '\n');
console.log(JSON.stringify(measurement, null, 2));
