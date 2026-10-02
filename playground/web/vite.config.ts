import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
  root: fromHere('./'),
  publicDir: fromHere('../shared/public'),
  plugins: [react({ include: /\/react\/.*\.[jt]sx$/ }), vue(), svelte()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, fs: { allow: [fromHere('../../')] } },
  build: {
    outDir: fromHere('../../.playground-dist/web'),
    emptyOutDir: true,
    sourcemap: false,
    rolldownOptions: {
      input: Object.fromEntries(
        ['index', 'react', 'vue', 'svelte', 'html'].map((name) => [
          name,
          fromHere(name === 'index' ? 'index.html' : `${name}/index.html`),
        ]),
      ),
    },
  },
});
