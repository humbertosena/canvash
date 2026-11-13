import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// O diff-base escolhe contra qual commit os checks de diff comparam. Cada caso monta um
// repositório descartável e consulta a função e a CLI.

interface DiffBaseModule {
  resolveDiffBase(options?: { base?: string; cwd?: string }): string;
  requestedBase(argv?: string[], env?: Record<string, string | undefined>): string;
}

const scriptUrl = new URL('../../scripts/diff-base.mjs', import.meta.url);
const script = fileURLToPath(scriptUrl);
const { resolveDiffBase, requestedBase } = (await import(scriptUrl.href)) as DiffBaseModule;
const repos: string[] = [];

function git(root: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(root: string, file: string, content: string): string {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', file);
  return git(root, 'rev-parse', 'HEAD');
}

function emptyRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'canvash-diff-base-'));
  repos.push(root);
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.email', 'diff-base@example.com');
  git(root, 'config', 'user.name', 'Diff Base');
  git(root, 'config', 'commit.gpgsign', 'false');
  return root;
}

const errorOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return '';
};

afterEach(() => {
  for (const root of repos.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('resolveDiffBase', () => {
  it('devolve o merge-base numa branch', () => {
    const root = emptyRepo();
    const base = commit(root, 'a.txt', 'a\n');
    git(root, 'checkout', '--quiet', '-b', 'feature');
    commit(root, 'b.txt', 'b\n');
    commit(root, 'c.txt', 'c\n');

    expect(resolveDiffBase({ base: 'main', cwd: root })).toBe(base);
  });

  it('recua para o primeiro pai num commit direto na main', () => {
    const root = emptyRepo();
    const parent = commit(root, 'a.txt', 'a\n');
    commit(root, 'b.txt', 'b\n');

    expect(resolveDiffBase({ base: 'main', cwd: root })).toBe(parent);
  });

  it('recua para o primeiro pai mesmo com a árvore de trabalho suja', () => {
    const root = emptyRepo();
    const parent = commit(root, 'a.txt', 'a\n');
    commit(root, 'b.txt', 'b\n');
    writeFileSync(join(root, 'b.txt'), 'alterado\n');
    writeFileSync(join(root, 'solto.txt'), 'solto\n');

    expect(resolveDiffBase({ base: 'main', cwd: root })).toBe(parent);
  });

  it('recua para o primeiro pai numa mesclagem na main', () => {
    const root = emptyRepo();
    commit(root, 'a.txt', 'a\n');
    git(root, 'checkout', '--quiet', '-b', 'feature');
    commit(root, 'b.txt', 'b\n');
    git(root, 'checkout', '--quiet', 'main');
    const mainTip = commit(root, 'c.txt', 'c\n');
    git(root, 'merge', '--quiet', '--no-ff', '--no-edit', 'feature');

    expect(resolveDiffBase({ base: 'main', cwd: root })).toBe(mainTip);
  });

  it('fica no HEAD num commit raiz', () => {
    const root = emptyRepo();
    const head = commit(root, 'a.txt', 'a\n');

    expect(resolveDiffBase({ base: 'main', cwd: root })).toBe(head);
  });

  it('diz que o repositório ainda não tem commit', () => {
    const root = emptyRepo();

    expect(errorOf(() => resolveDiffBase({ base: 'main', cwd: root }))).toContain(
      'o repositório ainda não tem commit',
    );
  });

  it('diz que a base não existe e anexa o stderr do git', () => {
    const root = emptyRepo();
    commit(root, 'a.txt', 'a\n');

    const message = errorOf(() => resolveDiffBase({ base: 'nao-existe', cwd: root }));

    expect(message).toContain('a base "nao-existe" não existe neste clone');
    expect(message).toContain('CONSTRAINTS_BASE (por exemplo origin/main)');
    expect(message).toContain('git: ');
  });

  it('recusa o clone raso em que o pai do HEAD não foi baixado', () => {
    const origin = emptyRepo();
    commit(origin, 'a.txt', 'a\n');
    commit(origin, 'b.txt', 'b\n');
    const root = mkdtempSync(join(tmpdir(), 'canvash-diff-base-raso-'));
    repos.push(root);
    git(tmpdir(), 'clone', '--quiet', '--depth', '1', pathToFileURL(origin).href, root);

    expect(errorOf(() => resolveDiffBase({ base: 'main', cwd: root }))).toContain(
      'o pai do HEAD não foi baixado (clone raso',
    );
  });

  it('aceita o commit raiz de um clone raso', () => {
    const origin = emptyRepo();
    const head = commit(origin, 'a.txt', 'a\n');
    const root = mkdtempSync(join(tmpdir(), 'canvash-diff-base-raso-'));
    repos.push(root);
    git(tmpdir(), 'clone', '--quiet', '--depth', '1', pathToFileURL(origin).href, root);

    expect(resolveDiffBase({ base: 'main', cwd: root })).toBe(head);
  });

  it('diz que não há ancestral comum', () => {
    const root = emptyRepo();
    commit(root, 'a.txt', 'a\n');
    git(root, 'checkout', '--quiet', '--orphan', 'avulsa');
    commit(root, 'b.txt', 'b\n');

    expect(errorOf(() => resolveDiffBase({ base: 'main', cwd: root }))).toContain(
      'sem ancestral comum entre main e HEAD (clone raso? use fetch-depth 0',
    );
  });
});

describe('requestedBase', () => {
  it('prefere --base, depois CONSTRAINTS_BASE, depois main', () => {
    expect(requestedBase(['node', 's', '--base', 'x'], { CONSTRAINTS_BASE: 'y' })).toBe('x');
    expect(requestedBase(['node', 's'], { CONSTRAINTS_BASE: 'y' })).toBe('y');
    expect(requestedBase(['node', 's'], {})).toBe('main');
  });

  it('trata CONSTRAINTS_BASE vazio como ausente, como o `${CONSTRAINTS_BASE:-main}` do shell', () => {
    expect(requestedBase(['node', 's'], { CONSTRAINTS_BASE: '' })).toBe('main');
  });

  it('recusa --base sem ref', () => {
    expect(errorOf(() => requestedBase(['node', 's', '--base'], {}))).toContain(
      '--base precisa de uma ref',
    );
  });
});

describe('diff-base: CLI e scripts que o usam', () => {
  const run = (file: string, cwd: string, base: string, ...args: string[]) =>
    spawnSync(process.execPath, [file, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, CONSTRAINTS_BASE: base },
    });

  it('imprime a base resolvida e sai com 0', () => {
    const root = emptyRepo();
    const parent = commit(root, 'a.txt', 'a\n');
    commit(root, 'b.txt', 'b\n');

    const result = run(script, root, 'nao-existe', '--base', 'main');

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${parent}\n`);
  });

  it('sai com 2, sem nada em stdout, quando a base não resolve', () => {
    const root = emptyRepo();
    commit(root, 'a.txt', 'a\n');

    const result = run(script, root, 'nao-existe');

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('diff-base: a base "nao-existe" não existe neste clone');
  });

  it.each(['check-diff-coverage', 'test-changed'])(
    '%s sai com 2 antes de executar a ferramenta quando a base não resolve',
    (name) => {
      const file = fileURLToPath(new URL(`../../scripts/${name}.mjs`, import.meta.url));

      const result = run(file, dirname(file), 'nao-existe');

      expect(result.status).toBe(2);
      expect(result.stderr).toContain(`${name}: a base "nao-existe" não existe neste clone`);
    },
  );
});
