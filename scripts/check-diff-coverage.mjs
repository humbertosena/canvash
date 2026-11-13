#!/usr/bin/env node
// check-diff-coverage.mjs — cobertura das linhas alteradas (≥ 80%) contra a base de
// scripts/diff-base.mjs, que na própria main recua para o primeiro pai em vez de comparar com HEAD.
// Uso: node scripts/check-diff-coverage.mjs [--base <ref>]   (padrão: $CONSTRAINTS_BASE ou main)
// Saída: a do diff-cover; 2 quando a base não resolve ou o diff-cover não executa.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveDiffBaseOrExit } from './diff-base.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const base = resolveDiffBaseOrExit('check-diff-coverage', { cwd: root });

const result = spawnSync(
  'diff-cover',
  ['coverage/lcov.info', `--compare-branch=${base}`, '--include-untracked', '--fail-under=80'],
  { cwd: root, stdio: 'inherit' },
);
if (result.error) {
  console.error(
    'check-diff-coverage: não foi possível executar o diff-cover: ' + result.error.message,
  );
  process.exit(2);
}
process.exit(result.status ?? 2);
