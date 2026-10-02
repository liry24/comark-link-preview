import { fileURLToPath } from 'node:url';
export default defineNuxtConfig({
  compatibilityDate: '2026-10-02',
  devtools: { enabled: false },
  ssr: true,
  css: [fileURLToPath(new URL('../shared/page.css', import.meta.url))],
  dir: { public: '../shared/public' },
  sourcemap: { server: false, client: false },
  vite: { server: { fs: { allow: [fileURLToPath(new URL('../../', import.meta.url))] } } },
  devServer: { host: '127.0.0.1', port: 3000 },
});
