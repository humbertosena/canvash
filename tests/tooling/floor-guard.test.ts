import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// O floor-guard compara a árvore de trabalho com a base. Cada caso monta um repositório
// descartável com um commit de base na `main` e altera os arquivos sem commitar.

const guard = fileURLToPath(new URL('../../scripts/floor-guard.mjs', import.meta.url));
const repos: string[] = [];

const DAY = 86_400_000;
const isoDate = (offsetDays: number): string =>
  new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

const constraints = (...rows: string[]): string =>
  [
    '# Constraints',
    '',
    '## Exceções',
    '',
    '| ID | Regra | Caminho | Motivo | Dono | Expira |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');

const BASE_TEST = [
  "it('soma', () => {",
  '  expect(1 + 1).toBe(2);',
  '});',
  "it('subtrai', () => {",
  '  expect(2 - 1).toBe(1);',
  '});',
  '',
].join('\n');

/** O mesmo teste com a primeira asserção trocada por outra. */
const CHANGED_TEST = BASE_TEST.replace('expect(1 + 1).toBe(2);', 'expect(1 + 2).toBe(3);');

function write(root: string, files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
}

function git(root: string, ...args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

interface GuardResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function commitAll(root: string, message: string): void {
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', message);
}

/** Cria um repositório descartável com um único commit `base` na `main`. */
function initRepo(base: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'canvash-floor-guard-'));
  repos.push(root);
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.email', 'guard@example.com');
  git(root, 'config', 'user.name', 'Guard');
  git(root, 'config', 'commit.gpgsign', 'false');
  write(root, base);
  commitAll(root, 'base');
  return root;
}

function guardIn(root: string, base = 'main'): GuardResult {
  const result = spawnSync(process.execPath, [guard], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CONSTRAINTS_BASE: base },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Cria a base com `base`, aplica `change` na árvore de trabalho e roda o guard. */
function runGuard(
  base: Record<string, string>,
  change: Record<string, string>,
  options: { base?: string } = {},
): GuardResult {
  const root = initRepo(base);
  write(root, change);
  return guardIn(root, options.base);
}

const BASE = { 'CONSTRAINTS.md': constraints(), 'src/math.test.ts': BASE_TEST };

const exceptionRow = (overrides: Partial<Record<'rule' | 'paths' | 'expires', string>> = {}) =>
  `| W1 | ${overrides.rule ?? 'assercao-removida'} | ${overrides.paths ?? '`src/math.test.ts`'} | Mudança de comportamento aprovada na spec | @dono | ${overrides.expires ?? isoDate(30)} |`;

afterEach(() => {
  for (const root of repos.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('floor-guard: asserção retirada', () => {
  it('acusa a asserção trocada quando não há exceção', () => {
    const result = runGuard(BASE, { 'src/math.test.ts': CHANGED_TEST });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[assercao-removida] src/math.test.ts');
  });

  it('passa quando uma exceção válida cobre o arquivo, e avisa a cobertura', () => {
    const result = runGuard(BASE, {
      'CONSTRAINTS.md': constraints(exceptionRow()),
      'src/math.test.ts': CHANGED_TEST,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('W1');
    expect(result.stdout).toContain('cobre 1 achado');
  });

  it('aceita a exceção que já estava na base', () => {
    const result = runGuard(
      { ...BASE, 'CONSTRAINTS.md': constraints(exceptionRow()) },
      { 'src/math.test.ts': CHANGED_TEST },
    );

    expect(result.status).toBe(0);
  });

  it('não cobre arquivo fora da lista de caminhos', () => {
    const result = runGuard(BASE, {
      'CONSTRAINTS.md': constraints(exceptionRow({ paths: '`src/other.test.ts`' })),
      'src/math.test.ts': CHANGED_TEST,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[assercao-removida] src/math.test.ts');
  });

  it('cobre cada arquivo de uma lista separada por vírgulas', () => {
    const result = runGuard(BASE, {
      'CONSTRAINTS.md': constraints(
        exceptionRow({ paths: '`src/other.test.ts`, `src/math.test.ts`' }),
      ),
      'src/math.test.ts': CHANGED_TEST,
    });

    expect(result.status).toBe(0);
  });
});

describe('floor-guard: exceção inválida não cobre nada', () => {
  it('acusa a exceção vencida e a asserção que ela cobriria', () => {
    const result = runGuard(
      { ...BASE, 'CONSTRAINTS.md': constraints(exceptionRow({ expires: isoDate(-1) })) },
      { 'src/math.test.ts': CHANGED_TEST },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[excecao-invalida]');
    expect(result.stderr).toContain('vencida');
    expect(result.stderr).toContain('[assercao-removida] src/math.test.ts');
  });

  it('acusa a validade além de 90 dias', () => {
    const result = runGuard(BASE, {
      'CONSTRAINTS.md': constraints(exceptionRow({ expires: isoDate(91) })),
      'src/math.test.ts': CHANGED_TEST,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[nova-excecao]');
    expect(result.stderr).toContain('90 dias');
  });

  it('acusa a exceção para uma regra que não admite exceção', () => {
    const result = runGuard(BASE, {
      'CONSTRAINTS.md': constraints(exceptionRow({ rule: 'checker-silenciado' })),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[nova-excecao]');
    expect(result.stderr).toContain('não admite exceção');
  });

  it('acusa a validade fora do formato de data', () => {
    const result = runGuard(BASE, {
      'CONSTRAINTS.md': constraints(exceptionRow({ expires: 'em breve' })),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('AAAA-MM-DD');
  });

  it('não deixa a exceção cobrir outra regra do piso', () => {
    const suppression = ['// @ts-', 'ignore'].join('');
    const result = runGuard(BASE, {
      'CONSTRAINTS.md': constraints(exceptionRow()),
      'src/math.test.ts': `${suppression}\n${BASE_TEST}`,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[checker-silenciado] src/math.test.ts');
  });
});

// Os literais que o guard procura são montados em pedaços para ele não acusar este arquivo.
const SUPPRESSED_SOURCE = [
  ['// eslint-', 'disable-next-line no-console'].join(''),
  'log(1);',
  '',
].join('\n');

describe('floor-guard: base do diff', () => {
  it('acusa a supressão de um commit feito direto na main com a árvore limpa', () => {
    const root = initRepo(BASE);
    write(root, { 'src/log.ts': SUPPRESSED_SOURCE });
    commitAll(root, 'commit direto na main');

    const result = guardIn(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[checker-silenciado] src/log.ts');
  });

  it('continua acusando o commit direto quando há um arquivo não rastreado na árvore', () => {
    const root = initRepo(BASE);
    write(root, { 'src/log.ts': SUPPRESSED_SOURCE });
    commitAll(root, 'commit direto na main');
    write(root, { 'notas.txt': 'rascunho\n' });

    const result = guardIn(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[checker-silenciado] src/log.ts');
  });

  it('compara com o próprio HEAD num repositório de um só commit', () => {
    const root = initRepo({ ...BASE, 'src/log.ts': SUPPRESSED_SOURCE });

    const result = guardIn(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('floor-guard: limpo');
  });

  it('checa a mesclagem na main contra o primeiro pai e aceita a exceção ainda na tabela', () => {
    const root = initRepo(BASE);
    git(root, 'checkout', '--quiet', '-b', 'feature');
    write(root, {
      'CONSTRAINTS.md': constraints(exceptionRow()),
      'src/math.test.ts': CHANGED_TEST,
    });
    commitAll(root, 'feature');
    git(root, 'checkout', '--quiet', 'main');
    write(root, { 'README.md': 'main\n' });
    commitAll(root, 'main');
    git(root, 'merge', '--quiet', '--no-ff', '--no-edit', 'feature');

    const result = guardIn(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('cobre 1 achado');
  });

  it('acusa a mesclagem que retira a linha de exceção no próprio commit', () => {
    const root = initRepo(BASE);
    git(root, 'checkout', '--quiet', '-b', 'feature');
    write(root, {
      'CONSTRAINTS.md': constraints(exceptionRow()),
      'src/math.test.ts': CHANGED_TEST,
    });
    commitAll(root, 'feature');
    git(root, 'checkout', '--quiet', 'main');
    write(root, { 'README.md': 'main\n' });
    commitAll(root, 'main');
    git(root, 'merge', '--quiet', '--no-ff', '--no-commit', 'feature');
    write(root, { 'CONSTRAINTS.md': constraints() });
    commitAll(root, 'mesclagem sem a exceção');

    const result = guardIn(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[assercao-removida] src/math.test.ts');
  });

  it('sai com 2 e aponta CONSTRAINTS_BASE quando a base não existe', () => {
    const result = runGuard(BASE, {}, { base: 'nao-existe' });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('a base "nao-existe" não existe neste clone');
    expect(result.stderr).toContain('CONSTRAINTS_BASE');
  });

  it('sai com 2 num clone raso em vez de comparar o HEAD consigo mesmo', () => {
    const origin = initRepo(BASE);
    write(origin, { 'src/log.ts': SUPPRESSED_SOURCE });
    commitAll(origin, 'commit direto na main');
    const root = mkdtempSync(join(tmpdir(), 'canvash-floor-guard-raso-'));
    repos.push(root);
    git(tmpdir(), 'clone', '--quiet', '--depth', '1', pathToFileURL(origin).href, root);

    const result = guardIn(root);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('floor-guard: o pai do HEAD não foi baixado (clone raso');
  });

  it('sai com 2 quando a base e o HEAD não têm ancestral comum', () => {
    const root = initRepo(BASE);
    git(root, 'checkout', '--quiet', '--orphan', 'avulsa');
    commitAll(root, 'raiz avulsa');

    const result = guardIn(root);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('sem ancestral comum entre main e HEAD');
  });
});

describe('floor-guard: teste facilitado', () => {
  it.each([
    ['it' + '.on' + 'ly('],
    ['it' + '.sk' + 'ip('],
    ['test' + '.fix' + 'me('],
    ['x' + 'it('],
  ])('acusa %s acrescentado num arquivo de teste', (call) => {
    const result = runGuard(BASE, {
      'src/math.test.ts': `${BASE_TEST}${call}'pula', () => {});\n`,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[teste-facilitado] src/math.test.ts');
  });
});
