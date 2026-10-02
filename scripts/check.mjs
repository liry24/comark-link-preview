import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
for (const name of ['format:check', 'build', 'lint', 'typecheck', 'test']) {
  const args = scripts[name].split(' ');
  if (args.shift() !== 'node') throw new Error('Checks must use the Node runtime');
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
