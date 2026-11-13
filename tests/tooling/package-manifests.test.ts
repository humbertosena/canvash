import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Dentro do repositório um pacote enxerga o outro pelo fonte, sem build: `exports` aponta para
// `src`, e `publishConfig` leva as entradas de `dist` ao manifesto do tarball (tests/packaging).
// Com `exports` em `dist`, typecheck e testes de um pacote dependeriam de um build anterior do
// outro, e um `dist` defasado responderia no lugar do código atual.

interface Manifest {
  name: string;
  exports?: Record<string, unknown>;
  files?: string[];
  publishConfig?: {
    exports?: Record<string, unknown>;
    main?: string;
    module?: string;
    types?: string;
  };
}

const packagesDir = fileURLToPath(new URL('../../packages/', import.meta.url));
const packages = readdirSync(packagesDir, { withFileTypes: true })
  .filter(
    (entry) => entry.isDirectory() && existsSync(join(packagesDir, entry.name, 'package.json')),
  )
  .map((entry) => {
    const dir = join(packagesDir, entry.name);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest;
    return {
      name: manifest.name,
      source: realpathSync(join(dir, 'src', 'index.ts')),
      dir,
      baseName: entry.name,
    };
  });

const TYPESCRIPT_CONSUMERS = [
  {
    label: 'NodeNext por import',
    options: { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext },
    mode: ts.ModuleKind.ESNext,
  },
  {
    label: 'NodeNext por require',
    options: { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext },
    mode: ts.ModuleKind.CommonJS,
  },
  {
    label: 'Bundler',
    options: { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
    mode: undefined,
  },
] as const;

// Um consumidor fora do workspace recebe cada pacote por symlink em node_modules, que é como o
// pnpm liga uma dependência `workspace:*`.
let consumerDir = '';

beforeAll(() => {
  consumerDir = mkdtempSync(join(tmpdir(), 'canvash-resolution-'));
  for (const { name, dir } of packages) {
    const link = join(consumerDir, 'node_modules', name);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(dir, link, 'dir');
  }
});

afterAll(() => {
  rmSync(consumerDir, { recursive: true, force: true });
});

describe.each(packages)('resolução de $name dentro do repositório', ({ name, source }) => {
  it.each(TYPESCRIPT_CONSUMERS)(
    'o TypeScript ($label) resolve para o fonte',
    ({ options, mode }) => {
      const resolution = ts.resolveModuleName(
        name,
        join(consumerDir, 'index.ts'),
        options,
        ts.sys,
        undefined,
        undefined,
        mode,
      );

      expect(resolution.resolvedModule?.resolvedFileName).toBe(source);
    },
  );

  it('o Node resolve para o fonte', () => {
    const consumer = createRequire(join(consumerDir, 'index.js'));

    expect(consumer.resolve(name)).toBe(source);
  });
});

// O manifesto tem dois mapas, e só o do repositório é exercitado no dia a dia. Sem estas
// conferências, um pacote sem `publishConfig`, ou com um subcaminho só em `exports`, passaria
// em tudo e publicaria um manifesto apontando para arquivos que não vão no tarball. Rodam sem
// build; o conteúdo do tarball continua provado em tests/packaging.
describe.each(packages)('manifesto de $name', ({ dir, baseName }) => {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest;
  const publish = manifest.publishConfig;
  const paths = (value: unknown): string[] =>
    typeof value === 'string' ? [value] : Object.values(value ?? {}).flatMap(paths);
  const withoutManifest = (list: string[]): string[] =>
    list.filter((path) => path !== './package.json');

  it('possui teste de empacotamento em tests/packaging (questão 11)', () => {
    const packagingTest = fileURLToPath(
      new URL(`../../tests/packaging/${baseName}.test.ts`, import.meta.url),
    );
    expect(existsSync(packagingTest)).toBe(true);
  });

  it('publica os mesmos subcaminhos que o repositório resolve', () => {
    expect(Object.keys(publish?.exports ?? {})).toEqual(Object.keys(manifest.exports ?? {}));
  });

  it('aponta o repositório para arquivos de fonte que existem', () => {
    const sources = withoutManifest(paths(manifest.exports));

    expect(sources).not.toEqual([]);
    expect(
      sources.filter((path) => !path.startsWith('./src/') || !existsSync(join(dir, path))),
    ).toEqual([]);
  });

  it('publica só entradas de dist, com tipos para import e para require', () => {
    const published = [
      ...withoutManifest(paths(publish?.exports)),
      publish?.main,
      publish?.module,
      publish?.types,
    ];

    expect(published.filter((path) => !path?.startsWith('./dist/'))).toEqual([]);
    expect(publish?.exports?.['.']).toEqual({
      import: { types: expect.any(String), default: expect.any(String) },
      require: { types: expect.any(String), default: expect.any(String) },
    });
    expect(manifest.files).toEqual(['dist', 'CHANGELOG.md']);
  });
});
