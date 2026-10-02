import { defineConfig } from 'tsdown';
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    fetch: 'src/fetch.ts',
    browser: 'src/browser.ts',
    html: 'src/html.ts',
    ansi: 'src/ansi.ts',
    workers: 'src/workers.ts',
  },
  format: ['esm'],
  platform: 'neutral',
  dts: { sourcemap: false },
  sourcemap: false,
  clean: true,
  exports: false,
  deps: { neverBundle: true, dts: { neverBundle: true } },
  copy: [{ from: 'src/style.css', to: 'dist' }],
});
