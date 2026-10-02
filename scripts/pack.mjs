import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
mkdirSync('artifacts', { recursive: true });
const filename = `${manifest.name}-${manifest.version}.tgz`;
const packed = spawnSync(
  process.env.BUN_BINARY ?? 'bun',
  ['pm', 'pack', '--filename', join('artifacts', filename), '--ignore-scripts'],
  { stdio: 'inherit' },
);
if (packed.error) throw packed.error;
if (packed.status !== 0) process.exit(packed.status ?? 1);
const archive = resolve('artifacts', filename);
const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
if (
  entries.some(
    (name) =>
      !name.startsWith('package/') ||
      name.includes('..') ||
      /(?:\.map$|playground\/|test\/|node_modules\/)/u.test(name),
  )
)
  throw Error('Unexpected tarball contents');
const directory = mkdtempSync(join(tmpdir(), 'preview-pack-'));
try {
  execFileSync('tar', ['-xzf', archive, '-C', directory]);
  const root = join(directory, 'package');
  let expandedBytes = 0;
  const visit = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) visit(full);
      else {
        expandedBytes += statSync(full).size;
        if (/\.(?:js|ts)$/u.test(full) && readFileSync(full, 'utf8').includes('sourceMappingURL'))
          throw Error('Source map reference in published file');
      }
    }
  };
  visit(root);
  for (const target of Object.values(manifest.exports)) {
    const paths = typeof target === 'string' ? [target] : Object.values(target);
    for (const path of paths)
      if (!statSync(join(root, path)).isFile()) throw Error(`Export is not a file: ${path}`);
  }
  console.log(JSON.stringify({ archive, tarballBytes: statSync(archive).size, expandedBytes }));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
