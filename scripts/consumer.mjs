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
      },
    }),
  );
  run(command, ['install', '--ignore-scripts']);
  const consumer = `import assert from 'node:assert/strict';
import { createPreviewController } from 'comark-link-preview';
import { createFetchResolver } from 'comark-link-preview/fetch';
import { initializePreviews } from 'comark-link-preview/browser';
import { renderPreviewHtml } from 'comark-link-preview/html';
import { renderPreviewAnsi } from 'comark-link-preview/ansi';
import { createWorkersResolver } from 'comark-link-preview/workers';
import { readFileSync } from 'node:fs';
let emit, finish;
const controller = createPreviewController({ documentId: 'packed', resolver: { resolve: (_url, options) => new Promise(resolve => { emit = options.emit; finish = resolve; }) } });
await controller.update('See :inline-preview{href="https://example.com"}\\n\\nLater body');
await controller.end();
while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
assert.match(await renderPreviewHtml(controller.getSnapshot()), /aria-busy="true"/);
emit({ state: 'pending', metadata: { title: 'Arrived independently' } });
assert.match(await renderPreviewHtml(controller.getSnapshot()), /Arrived independently/);
finish({ title: 'Final title' });
while (controller.getSnapshot().targets[0].snapshot.state === 'pending') await new Promise(resolve => setTimeout(resolve, 1));
assert.match(await renderPreviewAnsi(controller.getSnapshot()), /Final title/);
assert.match(readFileSync(new URL(import.meta.resolve('comark-link-preview/style.css')), 'utf8'), /clp-card/);
assert.equal(typeof createFetchResolver, 'function'); assert.equal(typeof initializePreviews, 'function'); assert.equal(typeof createWorkersResolver, 'function');
controller.dispose(); console.log('Packed consumer rendered progressive HTML and final ANSI.');`;
  writeFileSync(join(directory, 'consumer.mjs'), consumer);
  run(process.execPath, ['consumer.mjs']);
  writeFileSync(
    join(directory, 'consumer.ts'),
    `import { createPreviewController, type PreviewView } from 'comark-link-preview';\nimport { createFetchResolver } from 'comark-link-preview/fetch';\nconst c = createPreviewController({ documentId: 'types', resolver: createFetchResolver({ allowedUrls: ['https://*.example.com/*'], authorize: async (url, context) => url.protocol === 'https:' && !context.signal.aborted }) });\nconst view: PreviewView = c.getSnapshot(); void view.value; c.dispose();\n`,
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
