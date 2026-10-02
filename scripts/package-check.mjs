import { spawnSync } from 'node:child_process';
for (const script of ['node_modules/tsdown/dist/run.mjs', 'scripts/pack.mjs', 'scripts/consumer.mjs']) {
  const child = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}
