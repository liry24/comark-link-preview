import { defineConfig } from 'tsdown';
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  platform: 'neutral',
  dts: { sourcemap: false },
  sourcemap: false,
  clean: true,
  exports: false,
  deps: { neverBundle: true, dts: { neverBundle: true } },
  copy: [{ from: 'src/style.css', to: 'dist' }],
});
