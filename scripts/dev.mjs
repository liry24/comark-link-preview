import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bin = (path) => fileURLToPath(new URL(`../node_modules/${path}`, import.meta.url));
if (!process.env.CLP_USE_PACKED) {
  const build = spawnSync(process.execPath, [bin('tsdown/dist/run.mjs')], { cwd: root, stdio: 'inherit' });
  if (build.error) throw build.error;
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const children = [];
let stopping = false;
let exitCode = 0;
const commands = [
  {
    name: 'Library watch',
    cwd: root,
    args: [bin('tsdown/dist/run.mjs'), '--watch', '--no-clean'],
    url: 'rebuilds packaged entries on source changes',
  },
  {
    name: 'Vite',
    cwd: root,
    args: [bin('vite/bin/vite.js'), '--config', 'playground/web/vite.config.ts'],
    url: 'http://127.0.0.1:5173/',
  },
  {
    name: 'Angular',
    cwd: fileURLToPath(new URL('../playground/', import.meta.url)),
    args: [bin('@angular/cli/bin/ng.js'), 'serve', '--host', '127.0.0.1', '--port', '4200'],
    url: 'http://127.0.0.1:4200/',
  },
  {
    name: 'Nuxt',
    cwd: root,
    args: [bin('nuxt/bin/nuxt.mjs'), 'dev', 'playground/nuxt', '--host', '127.0.0.1', '--port', '3000'],
    url: 'http://127.0.0.1:3000/',
  },
];
function signalTree(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])], {
        stdio: 'ignore',
      });
    } else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') console.error(error);
  }
}
function stop(code = 0) {
  exitCode = Math.max(exitCode, code);
  if (stopping) return;
  stopping = true;
  for (const child of children) signalTree(child, 'SIGTERM');
  // Keep the shutdown deadline alive even if a launcher exits before its descendants.
  setTimeout(() => {
    for (const child of children) signalTree(child, 'SIGKILL');
  }, 4000);
}
for (const command of commands.filter(
  (entry) => !process.env.CLP_USE_PACKED || entry.name !== 'Library watch',
)) {
  const child = spawn(process.execPath, command.args, {
    cwd: command.cwd,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    env: { ...process.env, NG_CLI_ANALYTICS: 'false', NUXT_TELEMETRY_DISABLED: '1' },
  });
  children.push(child);
  console.log(`[${command.name}] ${command.url} (Node ${process.version})`);
  child.once('error', (error) => {
    console.error(`[${command.name}] failed to start:`, error);
    stop(1);
  });
  child.once('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[${command.name}] exited unexpectedly (${code ?? signal}). Stopping all playgrounds.`);
      stop(code || 1);
    }
    if (children.every((process) => process.exitCode !== null || process.signalCode !== null))
      process.exitCode = exitCode;
  });
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
