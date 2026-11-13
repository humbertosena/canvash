import { existsSync, readdirSync } from 'node:fs';
import { playwright } from '@vitest/browser-playwright';
import { configDefaults, defineConfig } from 'vitest/config';

// Metas de cobertura por pacote.
const CORE = { statements: 90, lines: 90, functions: 90, branches: 85 };
const OTHER = { statements: 80, lines: 80, functions: 80, branches: 80 };

// Um limite por pacote, para um pacote fraco não se esconder atrás da média.
const packagesDir = new URL('./packages/', import.meta.url);
const packageNames = existsSync(packagesDir)
  ? readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : [];
const thresholds = Object.fromEntries(
  packageNames.map((name) => [`packages/${name}/src/**`, name === 'core' ? CORE : OTHER]),
);

// `test:changed` roda só os testes afetados: a cobertura de um pacote seria medida sobre os poucos
// arquivos carregados, e o limite por pacote reprovaria por falta de contexto. No estágio de tarefa
// o gate é o `check:diff-coverage`; os limites por pacote valem na suíte inteira (`check:full`).
const PARTIAL_RUN = process.env.CANVASH_PARTIAL_COVERAGE === '1';

const SERIAL_TESTS = ['tests/tooling/**/*.test.ts', 'tests/benchmarks/**/*.test.ts'];

export default defineConfig({
  test: {
    // Contorno para dmonad/lib0#146: o lib0 (via yjs) lê `typeof localStorage` ao ser importado e,
    // no Node 25+, isso emite um ExperimentalWarning por worker. Nenhum código do repositório usa a
    // Web Storage do Node; no Node 22 e 24 ela já vem desligada, então a flag não muda nada ali.
    // Remover quando um lib0 0.2.x trouxer a guarda `isBrowser`.
    execArgv: ['--no-experimental-webstorage'],
    // Jornadas Playwright têm runner próprio; os contratos de empacotamento rodam
    // por `pnpm test:packaging`, com configuração própria.
    exclude: [...configDefaults.exclude, 'tests/e2e/**', 'tests/packaging/**', '**/.claude/**'],
    // Um `.only` esquecido desligaria o resto da suíte com tudo verde.
    allowOnly: false,
    // Os testes de tests/tooling executam scripts e leem tsconfigs por processo, fora do grafo
    // de imports: sem isto, `vitest --changed` não os refaria quando um deles muda.
    forceRerunTriggers: [
      ...configDefaults.forceRerunTriggers,
      '**/scripts/**',
      '**/tsconfig*.json',
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx,mts,cts}'],
      reporter: ['text-summary', 'lcov'],
      thresholds: PARTIAL_RUN ? undefined : thresholds,
    },
    projects: [
      {
        test: {
          name: 'unit',
          exclude: [
            ...configDefaults.exclude,
            '**/*.browser.test.ts',
            'tests/e2e/**',
            'tests/packaging/**',
            ...SERIAL_TESTS,
            '**/.claude/**',
          ],
          environment: 'node',
        },
      },
      {
        // Testes que executam scripts por processo ou geram cenas grandes: em paralelo com a
        // suíte, estouravam o tempo por disputa de CPU. Rodam depois dela, um arquivo por vez.
        test: {
          name: 'serial',
          include: SERIAL_TESTS,
          environment: 'node',
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
      {
        test: {
          name: 'browser',
          include: ['packages/*/src/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: 'chromium', headless: true }],
          },
        },
      },
    ],
  },
});
