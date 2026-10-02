import { defineConfig } from 'oxfmt';
export default defineConfig({
  ignorePatterns: ['**/node_modules/**', '**/dist/**', '**/.nuxt/**', '**/.output/**'],
  singleQuote: true,
  printWidth: 110,
});
