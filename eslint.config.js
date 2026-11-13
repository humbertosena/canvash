import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Globais que o core não pode tocar: DOM, timers, rede e armazenamento, e os de
// Node, porque o core também roda em navegador. `globalThis` e `self` dariam acesso a todos.
const CORE_FORBIDDEN_GLOBALS = [
  'globalThis',
  'self',
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'HTMLElement',
  'customElements',
  'process',
  'Buffer',
];

export default defineConfig(
  // test-results/ e playwright-report/ são saída do Playwright, recriada durante uma rodada e2e:
  // lintá-las reprovava o check:fast com ENOENT quando um e2e rodava ao mesmo tempo.
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/coverage/',
    '**/.claude/',
    '**/test-results/',
    '**/playwright-report/',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Piso de qualidade: comentários de supressão não têm efeito.
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': 'allow-with-description' },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Uma diretiva triple-slash traria lib DOM ou tipos de Node para um projeto cujo tsconfig
    // não os declara, furando a separação que o typecheck garante.
    files: ['packages/**/*.{ts,mts,cts,tsx}'],
    rules: {
      '@typescript-eslint/triple-slash-reference': [
        'error',
        { lib: 'never', path: 'never', types: 'never' },
      ],
    },
  },
  {
    files: ['packages/core/**/*.{ts,mts,cts,tsx,js,mjs,cjs}'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...CORE_FORBIDDEN_GLOBALS.map((name) => ({
          name,
          message: 'O core não acessa DOM, timers, rede, armazenamento nem APIs de Node.',
        })),
      ],
    },
  },
);
