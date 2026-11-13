import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// O guard lê scripts/legacy-names.json do repositório em que roda. Cada caso monta um
// repositório descartável com o JSON dele. Este arquivo não cita nome antigo: os nomes saem
// de concatenação, para nem o guard nem a varredura final os acusarem.

const guard = fileURLToPath(new URL('../../scripts/legacy-names-guard.mjs', import.meta.url));
const repos: string[] = [];

const WORD = 'Bo' + 'ard';
const word = 'bo' + 'ard';
const createOld = 'create' + WORD;
const createWithOld = 'create' + WORD + 'With';
const shellOld = word + '-shell';
const keyboard = 'key' + word;

type Guard = 'pending' | 'enforced' | 'type-context' | 'reserved';
const entry = (old: string, replacement: string, guardMode: Guard) => ({
  old,
  new: replacement,
  kind: 'identifier',
  slice: 'F1',
  guard: guardMode,
});

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

/** `tracked` entra no commit de base; `untracked` fica só na árvore de trabalho. */
function run(
  entries: ReturnType<typeof entry>[],
  tracked: Record<string, string>,
  untracked: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const root = mkdtempSync(join(tmpdir(), 'canvash-names-guard-'));
  repos.push(root);
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.email', 'guard@example.com');
  git(root, 'config', 'user.name', 'Guard');
  git(root, 'config', 'commit.gpgsign', 'false');
  write(root, { 'scripts/legacy-names.json': JSON.stringify({ entries }), ...tracked });
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'base');
  write(root, untracked);
  const result = spawnSync(process.execPath, [guard], { cwd: root, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

afterEach(() => {
  for (const root of repos.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('legacy-names-guard', () => {
  it('sai com 0 quando o JSON não tem entrada e o repositório não tem achado', () => {
    const result = run([], { 'src/a.ts': 'export const a = 1;\n' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('check:names: limpo');
  });

  it('acusa o nome antigo de uma entrada enforced num arquivo rastreado, com arquivo, linha e nome novo', () => {
    const result = run([entry(createOld, 'createCanvasSection', 'enforced')], {
      'src/a.ts': `export const a = 1;\nconst x = ${createOld}({});\n`,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`src/a.ts:2: ${createOld} → createCanvasSection`);
  });

  it('acusa a tag antiga num arquivo novo, ainda não rastreado', () => {
    const result = run(
      [{ ...entry(shellOld, 'canvas-section', 'enforced'), kind: 'tag' }],
      { 'src/a.ts': 'export const a = 1;\n' },
      { 'src/page.html': `<main>\n  <${shellOld}></${shellOld}>\n</main>\n` },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`src/page.html:2: ${shellOld} → canvas-section`);
  });

  it('não acusa uma entrada pending', () => {
    const result = run([entry(createWithOld, 'createCanvasSectionWith', 'pending')], {
      'src/a.ts': `const x = ${createWithOld}({});\n`,
    });

    expect(result.status).toBe(0);
  });

  it('não acusa keyboard, KeyboardAdapter, __clipboardFails nem as entradas reserved', () => {
    const adapter = 'Key' + word + 'Adapter';
    const clipboard = '__clip' + word + 'Fails';
    const node = WORD + 'Node';
    const lexical = run([entry(word, 'section', 'enforced')], {
      'src/a.ts': `const ${keyboard} = new ${adapter}(${clipboard});\n`,
    });
    const reserved = run(
      [
        entry(word, 'section', 'reserved'),
        entry(`'${word}'`, "'main'", 'reserved'),
        entry(node, 'CanvasNode', 'reserved'),
      ],
      { 'src/b.ts': `const ${word}: ${node} = { layer: '${word}' };\n` },
    );

    expect(lexical.status).toBe(0);
    expect(reserved.status).toBe(0);
  });

  it('acusa a entrada type-context só em posição de tipo', () => {
    const result = run([entry(WORD, 'CanvasSectionApi', 'type-context')], {
      'src/a.ts': `const s: ${WORD} = make();\n`,
      'src/b.ts': `import type { ${WORD} } from '@canvash/core';\n`,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`src/a.ts:1: ${WORD} → CanvasSectionApi`);
    expect(result.stderr).toContain(`src/b.ts:1: ${WORD} → CanvasSectionApi`);
  });

  it('não acusa a palavra usada em texto, mesmo com type-context', () => {
    const result = run([entry(WORD, 'CanvasSectionApi', 'type-context')], {
      'src/a.ts': [
        `const first = '${WORD} 1';`,
        `const toolbar = '${WORD} tools';`,
        `const area = { title: '${WORD}' };`,
        '',
      ].join('\n'),
    });

    expect(result.status).toBe(0);
  });
});
