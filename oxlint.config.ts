import { defineConfig } from 'oxlint';
export default defineConfig({
  categories: { correctness: 'error', suspicious: 'error' },
  options: { typeAware: true },
  plugins: ['typescript', 'import', 'vitest'],
  env: { browser: true, node: true },
  ignorePatterns: ['**/dist/**', '**/.nuxt/**', '**/.output/**', '**/node_modules/**'],
  overrides: [
    {
      files: ['playground/**/*.ts', 'playground/**/*.tsx'],
      rules: {
        'typescript/no-unsafe-type-assertion': 'off',
        'typescript/no-unnecessary-type-parameters': 'off',
        'no-unmodified-loop-condition': 'off',
      },
    },
    {
      files: ['test/**/*.ts'],
      rules: {
        'typescript/no-unsafe-type-assertion': 'off',
        'typescript/no-explicit-any': 'off',
        'vitest/no-conditional-expect': 'off',
      },
    },
  ],
  rules: {
    'typescript/no-floating-promises': 'error',
    'import/no-cycle': 'error',
    'import/no-unassigned-import': ['error', { allow: ['**/*.css'] }],
  },
});
