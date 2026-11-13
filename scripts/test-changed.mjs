#!/usr/bin/env node
// test-changed.mjs — roda só os testes afetados desde a base de scripts/diff-base.mjs, com
// cobertura parcial. Na própria main a base recua para o primeiro pai, então um commit direto
// ainda gera o lcov que o check-diff-coverage lê.
// Uso: node scripts/test-changed.mjs [--base <ref>] [argumentos do vitest]
// Saída: a do vitest; 2 quando a base não resolve ou o vitest não executa.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDiffBaseOrExit } from './diff-base.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const base = resolveDiffBaseOrExit('test-changed', { cwd: root });

// `--base <ref>` é deste script; o resto segue para o vitest.
const args = process.argv.slice(2);
const at = args.indexOf('--base');
if (at > -1) args.splice(at, 2);

const binDir = path.join(root, 'node_modules', '.bin');
const result = spawnSync(
  'vitest',
  ['run', '--changed', base, '--coverage', '--passWithNoTests', ...args],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      CANVASH_PARTIAL_COVERAGE: '1',
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    },
  },
);
if (result.error) {
  console.error('test-changed: não foi possível executar o vitest: ' + result.error.message);
  process.exit(2);
}
process.exit(result.status ?? 2);
