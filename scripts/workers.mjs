import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

// Bundle the real built package for a Web-only runtime. No Node compatibility,
// deployment, Cloudflare credentials, or external network requests are needed.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../test/workers/fixture.mjs', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  conditions: ['workerd', 'worker', 'browser'],
  target: 'es2022',
  write: false,
});
const worker = new Miniflare({
  modules: true,
  script: bundle.outputFiles[0].text,
  compatibilityDate: '2026-07-30',
  compatibilityFlags: ['global_fetch_strictly_public'],
});

try {
  const response = await worker.dispatchFetch('https://worker.test/');
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.checks, [
    'web-runtime',
    'completed-ast',
    'shared-cache',
    'cached-redirect-policy',
    'failure-fallback',
  ]);
  console.log(`Local workerd portability passed: ${result.checks.join(', ')}.`);
  console.log('Fixture fetch only; hosted Cloudflare networking and egress boundaries were not tested.');
} finally {
  await worker.dispose();
}
