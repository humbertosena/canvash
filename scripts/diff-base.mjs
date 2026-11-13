#!/usr/bin/env node
// diff-base.mjs — resolve a base dos checks de diff (floor-guard, diff-cover e vitest --changed).
// Uso: node scripts/diff-base.mjs [--base <ref>]   (padrão: $CONSTRAINTS_BASE ou main)
// Saída: imprime o SHA da base e sai com 0; sai com 2 quando a base não pode ser resolvida.
//
// Numa branch, a base é o merge-base com a ref. Na própria main o merge-base é o HEAD e o diff
// sairia vazio, então a base recua para o primeiro pai: num commit direto o diff é esse commit, numa
// mesclagem é o conjunto da branch. Commits anteriores ao HEAD não entram. Num commit raiz não há
// pai, e a base fica no HEAD; num clone raso que cortou o pai, a resolução falha.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export class DiffBaseError extends Error {}

/** A ref pedida: `--base <ref>`, senão `$CONSTRAINTS_BASE`, senão `main`. */
export function requestedBase(argv = process.argv, env = process.env) {
  const i = argv.indexOf('--base');
  // Vazio conta como ausente, como o `${CONSTRAINTS_BASE:-main}` que os scripts do package.json usavam.
  if (i === -1) return env.CONSTRAINTS_BASE || 'main';
  const ref = argv[i + 1];
  if (!ref) throw new DiffBaseError('--base precisa de uma ref');
  return ref;
}

const git = (args, cwd) => {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out: out.trim(), err: '' };
  } catch (e) {
    const err = typeof e?.stderr === 'string' ? e.stderr : String(e?.message ?? e);
    return { ok: false, out: '', err: err.trim() };
  }
};

// Só roda depois que o merge-base falhou: o caminho feliz não paga por estes processos.
function diagnose(base, cwd, mergeBaseError) {
  const detail = mergeBaseError ? '\n  git: ' + mergeBaseError : '';
  const exists = (rev) => git(['rev-parse', '--verify', '--quiet', rev], cwd).ok;
  if (!git(['rev-parse', '--git-dir'], cwd).ok) return 'fora de um repositório git' + detail;
  if (!exists('HEAD^{commit}')) return 'o repositório ainda não tem commit' + detail;
  if (!exists(`${base}^{commit}`)) {
    return (
      `a base "${base}" não existe neste clone: defina CONSTRAINTS_BASE (por exemplo origin/main) ` +
      'ou faça fetch da branch' +
      detail
    );
  }
  return (
    `sem ancestral comum entre ${base} e HEAD (clone raso? use fetch-depth 0 ou git fetch ` +
    '--unshallow)' +
    detail
  );
}

/**
 * Devolve o SHA contra o qual os checks de diff comparam. Lança `DiffBaseError` com o diagnóstico
 * quando a base não existe, o repositório não tem commit, não há ancestral comum ou o clone raso
 * cortou o pai do HEAD.
 */
export function resolveDiffBase({ base = requestedBase(), cwd = process.cwd() } = {}) {
  const mergeBase = git(['merge-base', base, 'HEAD'], cwd);
  if (!mergeBase.ok) throw new DiffBaseError(diagnose(base, cwd, mergeBase.err));
  // Um só processo dá o SHA do HEAD e o do primeiro pai, ausente num commit raiz.
  const head = git(['rev-list', '--parents', '--max-count=1', 'HEAD'], cwd);
  if (!head.ok) throw new DiffBaseError('não foi possível ler o HEAD\n  git: ' + head.err);
  const [headSha, firstParent] = head.out.split(' ');
  if (mergeBase.out !== headSha) return mergeBase.out;
  if (firstParent) return firstParent;
  // Num clone raso o rev-list esconde o pai cortado; comparar com o HEAD daria um diff vazio e o
  // guard aprovaria sem olhar nada. O objeto do commit ainda registra o pai.
  const raw = git(['cat-file', 'commit', headSha], cwd);
  if (!raw.ok) throw new DiffBaseError('não foi possível ler o commit HEAD\n  git: ' + raw.err);
  if (/^parent /m.test(raw.out.split('\n\n')[0])) {
    throw new DiffBaseError(
      'o pai do HEAD não foi baixado (clone raso): use fetch-depth 0 ou git fetch --deepen=1',
    );
  }
  return headSha;
}

/** Resolve a base ou encerra o processo com 2, prefixando o diagnóstico com `name`. */
export function resolveDiffBaseOrExit(name, options) {
  try {
    return resolveDiffBase(options);
  } catch (e) {
    console.error(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false; // entrada que não é arquivo (REPL, -e): não é execução como CLI
  }
})();

if (isMain) process.stdout.write(resolveDiffBaseOrExit('diff-base') + '\n');
