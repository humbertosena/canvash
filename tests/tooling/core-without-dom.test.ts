import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// O core não usa DOM, Canvas, timers de navegador, rede nem armazenamento. O
// tsconfig do pacote torna isso um erro de tipo; este teste compila sondas com as opções
// reais do pacote para a garantia não se perder numa edição de tsconfig.

const coreTsconfig = fileURLToPath(new URL('../../packages/core/tsconfig.json', import.meta.url));
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

const FORBIDDEN_VALUES = [
  'document',
  'window',
  'navigator',
  'requestAnimationFrame',
  'setTimeout',
  'setInterval',
  'fetch',
  'WebSocket',
  'localStorage',
  'indexedDB',
  'process',
];
const FORBIDDEN_TYPES = ['HTMLElement', 'CanvasRenderingContext2D', 'Buffer'];

const probes: string[] = [];

/** Compila um arquivo avulso com as opções de compilação do código do core. */
function compileWithCoreOptions(source: string): { status: number | null; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'canvash-core-probe-'));
  probes.push(dir);
  // Módulo ES, como o pacote: sem isto a sonda seria CommonJS para o TypeScript.
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(dir, 'probe.ts'), source);
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      extends: coreTsconfig,
      // A sonda só verifica: sem references, o projeto não precisa emitir.
      compilerOptions: { composite: false, emitDeclarationOnly: false, noEmit: true },
      include: ['probe.ts'],
      exclude: [],
    }),
  );
  const result = spawnSync(process.execPath, [tsc, '-p', dir, '--pretty', 'false'], {
    encoding: 'utf8',
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

afterEach(() => {
  for (const dir of probes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('opções de compilação do código do core', () => {
  it('aceitam ECMAScript puro', () => {
    const result = compileWithCoreOptions(
      'export const total = [1, 2, 3].map((n) => Math.round(n * Date.now())).length;\n' +
        'export const index = new Map<string, number>([[JSON.stringify({}), 1]]);\n',
    );

    expect(result).toEqual({ status: 0, output: '' });
  });

  it('recusam DOM, timers, rede, armazenamento e globais de Node', () => {
    const source = [
      ...FORBIDDEN_VALUES.map((name) => `void ${name};`),
      ...FORBIDDEN_TYPES.map((name, index) => `export type T${index} = ${name};`),
    ].join('\n');

    const result = compileWithCoreOptions(source);

    const accepted = [...FORBIDDEN_VALUES, ...FORBIDDEN_TYPES].filter(
      (name) => !result.output.includes(`Cannot find name '${name}'`),
    );
    expect(accepted).toEqual([]);
    expect(result.status).not.toBe(0);
  });

  it('recusam módulos de Node', () => {
    const result = compileWithCoreOptions("import { readFileSync } from 'node:fs';\n");

    expect(result.output).toContain("Cannot find name 'node:fs'");
    expect(result.status).not.toBe(0);
  });
});
