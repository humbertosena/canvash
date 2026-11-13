#!/usr/bin/env node
// check-fast.mjs — executa concorrentemente os checks do estágio rápido (≤ 5 s).
// Executa em paralelo: typecheck incremental, lint, format, secrets, floor-guard e nomes legados.
// Uso: node scripts/check-fast.mjs
// Saída: 0 limpo; 1 se qualquer um dos checks falhar.

import { spawn } from 'node:child_process';
import path from 'node:path';

const binDir = path.resolve('node_modules', '.bin');
const env = {
  ...process.env,
  PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
};

const run = (name, cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (err) => reject({ name, error: err }));
    child.on('close', (code) => {
      if (code === 0) resolve({ name, stdout, stderr });
      else reject({ name, code, stdout, stderr });
    });
  });

// Incremental para caber no orçamento. O `--force` (o cache incremental aprovava arquivo movido
// entre projetos) roda no estágio de tarefa, por `pnpm typecheck`.
const runTypecheck = async () => {
  await run('tsconfig-guard', process.execPath, ['scripts/tsconfig-guard.mjs']);
  return run('tsc', 'tsc', ['-b']);
};

const start = performance.now();
const results = await Promise.allSettled([
  runTypecheck(),
  // Cache por conteúdo: arquivo, config e versão iguais têm o mesmo veredito. O cache fica em
  // node_modules/.cache (ignorado pelo git e pelos guards). O `check:full` repete os dois sem cache.
  run('lint', 'eslint', [
    '.',
    '--cache',
    '--cache-strategy',
    'content',
    '--cache-location',
    'node_modules/.cache/eslint/',
  ]),
  run('format', 'prettier', ['--check', '.', '--cache', '--cache-strategy', 'content']),
  run('secrets', 'gitleaks', ['dir', '.', '--redact', '--no-banner']),
  run('floor', process.execPath, ['scripts/floor-guard.mjs']),
  run('names', process.execPath, ['scripts/legacy-names-guard.mjs']),
]);

const failures = results.filter((r) => r.status === 'rejected').map((r) => r.reason);

if (failures.length > 0) {
  for (const failure of failures) {
    const header = `\n--- Falha em: ${failure.name} (código ${failure.code ?? 'erro'}) ---`;
    console.error(header);
    const output = (failure.stderr || failure.stdout || failure.error?.message || '').trim();
    if (output) console.error(output);
  }
  process.exit(1);
}

const elapsed = ((performance.now() - start) / 1000).toFixed(2);
console.log(`check:fast: limpo (${elapsed}s)`);
