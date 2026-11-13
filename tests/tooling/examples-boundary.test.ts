import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// Cada exemplo é um projeto isolado: a regra do dependency-cruiser é o que impede um exemplo de
// voltar a importar o código de outro.

const depcruise = fileURLToPath(new URL('../../node_modules/.bin/depcruise', import.meta.url));
const config = fileURLToPath(new URL('../../.dependency-cruiser.cjs', import.meta.url));
const workspaces: string[] = [];

/** Cria um workspace descartável com os arquivos dados e roda o depcruise dentro dele. */
function cruise(files: Record<string, string>): { status: number | null; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'canvash-examples-boundary-'));
  workspaces.push(root);
  const tsconfig = JSON.stringify({ compilerOptions: { allowJs: true } });
  for (const [file, content] of Object.entries({ 'tsconfig.json': tsconfig, ...files })) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  const result = spawnSync(depcruise, ['examples', '--config', config], {
    cwd: root,
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
  for (const root of workspaces.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('fronteira entre exemplos', () => {
  it('recusa um exemplo que importa código de outro exemplo', () => {
    const result = cruise({
      'examples/react/src/main.js':
        "import { x } from '../../vue/src/x.js';\nexport const y = x;\n",
      'examples/vue/src/x.js': 'export const x = 1;\n',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('exemplo-react-isolado');
  });

  it('aceita imports dentro do mesmo exemplo', () => {
    const result = cruise({
      'examples/react/src/main.js': "import { x } from './x.js';\nexport const y = x;\n",
      'examples/react/src/x.js': 'export const x = 1;\n',
    });

    expect(result.status).toBe(0);
  });
});
