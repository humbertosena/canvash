import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// O `tsc -b` só verifica os projetos que o tsconfig.json da raiz referencia. O guard é o que
// impede um pacote de ficar fora do `pnpm typecheck` em silêncio.

const guard = fileURLToPath(new URL('../../scripts/tsconfig-guard.mjs', import.meta.url));
const workspaces: string[] = [];

/** Cria um workspace descartável com os arquivos dados e roda o guard dentro dele. */
function runGuard(files: Record<string, string>): { status: number | null; stderr: string } {
  const root = mkdtempSync(join(tmpdir(), 'canvash-tsconfig-guard-'));
  workspaces.push(root);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  const result = spawnSync(process.execPath, [guard], { cwd: root, encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr };
}

const solution = (...paths: string[]): string =>
  JSON.stringify({ files: [], references: paths.map((path) => ({ path })) });

const corePackage = {
  'packages/core/package.json': '{ "name": "@canvash/core" }',
  'packages/core/tsconfig.json': '{}',
  'packages/core/tsconfig.test.json': '{}',
};

afterEach(() => {
  for (const root of workspaces.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('tsconfig-guard', () => {
  it('passa quando ainda não existe nenhum pacote', () => {
    const result = runGuard({ 'tsconfig.json': solution('./tsconfig.node.json') });

    expect(result).toEqual({ status: 0, stderr: '' });
  });

  it('passa quando o pacote tem os dois projetos registrados na raiz', () => {
    const result = runGuard({
      ...corePackage,
      'tsconfig.json': solution(
        './tsconfig.node.json',
        './packages/core',
        './packages/core/tsconfig.test.json',
      ),
    });

    expect(result).toEqual({ status: 0, stderr: '' });
  });

  it('aceita a raiz com comentários e a referência pelo caminho do arquivo', () => {
    const result = runGuard({
      ...corePackage,
      'tsconfig.json': `{
        // Solução: lista os projetos, com "aspas // dentro de string" preservadas.
        "files": [],
        /* um por linha */
        "references": [
          { "path": "./packages/core/tsconfig.json" },
          { "path": "packages/core/tsconfig.test.json" }
        ]
      }`,
    });

    expect(result).toEqual({ status: 0, stderr: '' });
  });

  it('reprova o pacote sem projeto de testes', () => {
    const result = runGuard({
      'packages/core/package.json': '{}',
      'packages/core/tsconfig.json': '{}',
      'tsconfig.json': solution('./packages/core'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('falta packages/core/tsconfig.test.json');
  });

  it('reprova o pacote cujos projetos não estão registrados na raiz', () => {
    const result = runGuard({
      ...corePackage,
      'tsconfig.json': solution('./tsconfig.node.json', './packages/core'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'packages/core/tsconfig.test.json não está em "references" do tsconfig.json da raiz',
    );
    expect(result.stderr).not.toContain('packages/core/tsconfig.json não está');
  });

  it('lista todos os problemas de uma vez', () => {
    const result = runGuard({
      ...corePackage,
      'packages/renderer-canvas2d/package.json': '{}',
      'tsconfig.json': solution('./tsconfig.node.json'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('packages/core/tsconfig.json não está em "references"');
    expect(result.stderr).toContain('packages/core/tsconfig.test.json não está em "references"');
    expect(result.stderr).toContain('falta packages/renderer-canvas2d/tsconfig.json');
    expect(result.stderr).toContain('falta packages/renderer-canvas2d/tsconfig.test.json');
  });

  it('reprova o diretório de pacote com código e sem package.json', () => {
    const result = runGuard({
      'packages/novo/src/index.ts': 'export {};',
      'tsconfig.json': solution('./tsconfig.node.json'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('falta packages/novo/package.json');
  });

  it('ignora o resto de um pacote removido que só tem node_modules', () => {
    const result = runGuard({
      'packages/removido/node_modules/.cache/tsc/index.d.ts': 'export {};',
      'tsconfig.json': solution('./tsconfig.node.json'),
    });

    expect(result).toEqual({ status: 0, stderr: '' });
  });

  it('ignora o resto de um pacote removido que também tem dist e coverage', () => {
    const result = runGuard({
      'packages/removido/node_modules/.cache/tsc/index.d.ts': 'export {};',
      'packages/removido/dist/index.d.mts': 'export {};',
      'packages/removido/coverage/lcov.info': '',
      'tsconfig.json': solution('./tsconfig.node.json'),
    });

    expect(result).toEqual({ status: 0, stderr: '' });
  });

  it('ignora arquivos TypeScript dentro de .claude', () => {
    const result = runGuard({
      '.claude/worktrees/agent-1/src/index.ts': 'export {};',
      'tsconfig.node.json': JSON.stringify({ include: ['*.ts'] }),
      'tsconfig.json': solution('./tsconfig.node.json'),
    });

    expect(result).toEqual({ status: 0, stderr: '' });
  });

  it('passa quando todo arquivo TypeScript pertence a um projeto referenciado', () => {
    const result = runGuard({
      'vitest.config.ts': 'export default {};',
      'tests/tooling/guard.test.ts': 'export {};',
      'tsconfig.node.json': JSON.stringify({
        compilerOptions: { noUncheckedIndexedAccess: true },
        include: ['*.ts', 'tests/**/*.ts'],
      }),
      'tsconfig.json': solution('./tsconfig.node.json'),
    });

    expect(result).toEqual({ status: 0, stderr: '' });
  });

  it.each([
    ['em diretório que nenhum projeto inclui', 'examples/vanilla/src/main.ts'],
    ['com extensão que o include não lista', 'tests/tooling/helper.mts'],
    ['de declaração', 'types/global.d.ts'],
  ])('reprova arquivo TypeScript %s', (_label, file) => {
    const result = runGuard({
      [file]: 'export {};',
      'tsconfig.node.json': JSON.stringify({ include: ['*.ts', 'tests/**/*.ts'] }),
      'tsconfig.json': solution('./tsconfig.node.json'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${file} não pertence a nenhum projeto referenciado`);
  });

  it('reprova a raiz que deixa de referenciar o projeto dos arquivos de Node', () => {
    const result = runGuard({
      'vitest.config.ts': 'export default {};',
      'tsconfig.node.json': JSON.stringify({ include: ['*.ts'] }),
      'tsconfig.json': solution(),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('vitest.config.ts não pertence a nenhum projeto referenciado');
  });

  it.each([
    ['strict', { strict: false }],
    ['noImplicitAny', { noImplicitAny: false }],
    ['strictNullChecks', { strict: true, strictNullChecks: false }],
  ])('reprova o projeto que desliga %s', (flag, compilerOptions) => {
    const result = runGuard({
      ...corePackage,
      'packages/core/tsconfig.json': JSON.stringify({ compilerOptions }),
      'tsconfig.json': solution('./packages/core', './packages/core/tsconfig.test.json'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `packages/core/tsconfig.json desliga o modo strict ("${flag}": false)`,
    );
  });

  it('reprova o modo strict desligado no arquivo que o projeto estende', () => {
    const result = runGuard({
      ...corePackage,
      'tsconfig.base.json': JSON.stringify({ compilerOptions: { strict: false } }),
      'packages/core/tsconfig.json': JSON.stringify({ extends: '../../tsconfig.base.json' }),
      'tsconfig.json': solution('./packages/core', './packages/core/tsconfig.test.json'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('packages/core/tsconfig.json desliga o modo strict');
  });

  it.each([
    ['não a declara', {}],
    ['a desliga', { noUncheckedIndexedAccess: false }],
  ])('reprova o projeto com arquivos que %s', (_label, compilerOptions) => {
    const result = runGuard({
      'index.ts': 'export {};',
      'tsconfig.node.json': JSON.stringify({ compilerOptions, include: ['*.ts'] }),
      'tsconfig.json': solution('./tsconfig.node.json'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('tsconfig.node.json não liga "noUncheckedIndexedAccess"');
  });

  it('reprova a opção retirada do arquivo que o projeto estende', () => {
    const result = runGuard({
      'index.ts': 'export {};',
      'tsconfig.base.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'tsconfig.node.json': JSON.stringify({
        extends: './tsconfig.base.json',
        include: ['*.ts'],
      }),
      'tsconfig.json': solution('./tsconfig.node.json'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('tsconfig.node.json não liga "noUncheckedIndexedAccess"');
  });

  it('aceita a opção herdada do arquivo que o projeto estende', () => {
    const result = runGuard({
      'index.ts': 'export {};',
      'tsconfig.base.json': JSON.stringify({ compilerOptions: { noUncheckedIndexedAccess: true } }),
      'tsconfig.node.json': JSON.stringify({
        extends: './tsconfig.base.json',
        include: ['*.ts'],
      }),
      'tsconfig.json': solution('./tsconfig.node.json'),
    });

    expect(result).toEqual({ status: 0, stderr: '' });
  });

  it('não exige a opção de projeto sem arquivos (solução)', () => {
    const result = runGuard({ 'tsconfig.json': solution() });

    expect(result).toEqual({ status: 0, stderr: '' });
  });

  it('reprova a raiz sem tsconfig.json legível', () => {
    const result = runGuard({ 'tsconfig.json': '{ "references": [' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('não foi possível ler tsconfig.json');
  });

  describe('references entre pacotes para dependências workspace (questão 13)', () => {
    const dependentWorkspace = {
      ...corePackage,
      'packages/renderer-canvas2d/package.json': JSON.stringify({
        name: '@canvash/renderer-canvas2d',
        dependencies: { '@canvash/core': 'workspace:*' },
      }),
      'packages/renderer-canvas2d/tsconfig.json': solution('../core'),
      'packages/renderer-canvas2d/tsconfig.test.json': solution('./tsconfig.json', '../core'),
      'tsconfig.json': solution(
        './tsconfig.node.json',
        './packages/core',
        './packages/core/tsconfig.test.json',
        './packages/renderer-canvas2d',
        './packages/renderer-canvas2d/tsconfig.test.json',
      ),
    };

    it('passa quando dependência workspace: está referenciada nos dois tsconfigs do consumidor', () => {
      const result = runGuard(dependentWorkspace);

      expect(result).toEqual({ status: 0, stderr: '' });
    });

    it('reprova quando o tsconfig.json do consumidor não referencia o fornecedor', () => {
      const result = runGuard({
        ...dependentWorkspace,
        'packages/renderer-canvas2d/tsconfig.json': solution(),
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'packages/renderer-canvas2d/tsconfig.json não referencia packages/core/tsconfig.json (dependência de @canvash/core)',
      );
    });

    it('reprova quando o tsconfig.test.json do consumidor não referencia o fornecedor', () => {
      const result = runGuard({
        ...dependentWorkspace,
        'packages/renderer-canvas2d/tsconfig.test.json': solution('./tsconfig.json'),
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'packages/renderer-canvas2d/tsconfig.test.json não referencia packages/core/tsconfig.json (dependência de @canvash/core)',
      );
    });

    it('reprova dependência workspace: para pacote inexistente', () => {
      const result = runGuard({
        ...dependentWorkspace,
        'packages/renderer-canvas2d/package.json': JSON.stringify({
          name: '@canvash/renderer-canvas2d',
          dependencies: { '@canvash/fantasma': 'workspace:*' },
        }),
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'packages/renderer-canvas2d/package.json declara dependência "@canvash/fantasma" como workspace, mas o pacote não existe',
      );
    });
  });
});
