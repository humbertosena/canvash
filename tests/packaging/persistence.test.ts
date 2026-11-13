import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { packDirOf, packedTarball } from './global-setup.js';
import { manifestVersion } from './manifest-version.js';

const packs = inject('canvashPacks');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

const nodeBinaries = [
  process.execPath,
  ...(process.env.PACKAGING_NODE_BINARIES ?? '').split(delimiter).filter(Boolean),
];

const SMOKE_REPORT = `
console.log(
  JSON.stringify({
    entry: resolved.split('/@canvash/persistence/')[1],
    version: PERSISTENCE_VERSION,
  }),
);
`;

const SMOKE_IMPORT = `
import { PERSISTENCE_VERSION, serializeDocument, parseDocument } from '@canvash/persistence';
const resolved = import.meta.resolve('@canvash/persistence');
${SMOKE_REPORT}`;

const SMOKE_REQUIRE = `
const { PERSISTENCE_VERSION, serializeDocument, parseDocument } = require('@canvash/persistence');
const resolved = require.resolve('@canvash/persistence');
${SMOKE_REPORT}`;

const TYPED_USAGE = `
import {
  PERSISTENCE_VERSION,
  serializeDocument,
  parseDocument,
  IndexedDbStorageAdapter,
  MemoryStorageAdapter,
  createAutosaveManager,
  type StorageAdapter,
  type AutosaveManager,
} from '@canvash/persistence';
import type { CanvasDocument } from '@canvash/core';

export const version: string = PERSISTENCE_VERSION;
export const adapter: StorageAdapter = new MemoryStorageAdapter();
`;

const TYPE_CONSUMERS = [
  {
    name: 'esm-nodenext',
    type: 'module',
    module: 'NodeNext',
    resolution: 'NodeNext',
    declaration: 'index.d.mts',
  },
  {
    name: 'cjs-nodenext',
    type: 'commonjs',
    module: 'NodeNext',
    resolution: 'NodeNext',
    declaration: 'index.d.cts',
  },
  {
    name: 'bundler',
    type: 'module',
    module: 'ESNext',
    resolution: 'Bundler',
    declaration: 'index.d.mts',
  },
];

let projectDir = '';
let tarballFiles: string[] = [];

// O build e o pack de todos os pacotes ficam no globalSetup, uma vez por execução.
beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'canvash-packaging-persistence-'));

  const coreTarball = packedTarball(packs, '@canvash/core');
  const coreInstallDir = join(projectDir, 'node_modules', '@canvash', 'core');
  mkdirSync(coreInstallDir, { recursive: true });
  execFileSync('tar', ['-xzf', coreTarball, '-C', coreInstallDir, '--strip-components=1']);

  const packedDir = packDirOf(packs, '@canvash/persistence');
  const tarballs = readdirSync(packedDir).filter((name) => name.endsWith('.tgz'));
  expect(tarballs).toHaveLength(1);
  const tarball = join(packedDir, String(tarballs[0]));

  tarballFiles = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((entry) => entry.replace(/^package\//, ''))
    .sort();

  const installDir = join(projectDir, 'node_modules', '@canvash', 'persistence');
  mkdirSync(installDir, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', installDir, '--strip-components=1']);

  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({ name: 'packaging-consumer', private: true, type: 'module' }),
  );
});

afterAll(() => {
  if (projectDir) {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

describe('@canvash/persistence packaging contract', () => {
  it('contém exatamente os artefatos esperados no tarball', () => {
    expect(tarballFiles).toEqual(
      expect.arrayContaining([
        'package.json',
        'README.md',
        'dist/index.mjs',
        'dist/index.cjs',
        'dist/index.d.mts',
        'dist/index.d.cts',
      ]),
    );

    const unexpected = tarballFiles.filter(
      (file) =>
        !/^(package\.json|(README|LICEN[CS]E|CHANGELOG)(\.md)?)$/i.test(file) &&
        !/^dist\/[\w.-]+\.(mjs|cjs|d\.mts|d\.cts)(\.map)?$/.test(file),
    );
    expect(unexpected).toEqual([]);
    expect(tarballFiles.filter((file) => /\.test\./.test(file))).toEqual([]);
  });

  it('declara package.json em conformidade', () => {
    const pkg = JSON.parse(
      readFileSync(
        join(projectDir, 'node_modules', '@canvash', 'persistence', 'package.json'),
        'utf8',
      ),
    );
    expect(pkg.sideEffects).toBe(false);
    expect(pkg.exports['.']).toEqual({
      import: { types: './dist/index.d.mts', default: './dist/index.mjs' },
      require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
    });
  });

  describe('consumo de execução (Node binaries)', () => {
    for (const bin of nodeBinaries) {
      it(`importa via ESM em ${bin}`, () => {
        const scriptPath = join(projectDir, 'smoke-import.mjs');
        writeFileSync(scriptPath, SMOKE_IMPORT, 'utf8');

        const result = spawnSync(bin, [scriptPath], {
          cwd: projectDir,
          encoding: 'utf8',
        });
        expect(result.status).toBe(0);
        const data = JSON.parse(result.stdout.trim());
        expect(data.entry).toBe('dist/index.mjs');
        expect(data.version).toBe(manifestVersion('persistence'));
      });

      it(`carrega via CJS em ${bin}`, () => {
        const scriptPath = join(projectDir, 'smoke-require.cjs');
        writeFileSync(scriptPath, SMOKE_REQUIRE, 'utf8');

        const result = spawnSync(bin, [scriptPath], {
          cwd: projectDir,
          encoding: 'utf8',
        });
        expect(result.status).toBe(0);
        const data = JSON.parse(result.stdout.trim());
        expect(data.entry).toBe('dist/index.cjs');
        expect(data.version).toBe(manifestVersion('persistence'));
      });
    }
  });

  describe('resolução de tipos TypeScript', () => {
    for (const consumer of TYPE_CONSUMERS) {
      it(`compila com sucesso sob ${consumer.name}`, () => {
        const testSubdir = join(projectDir, `typecheck-${consumer.name}`);
        mkdirSync(testSubdir, { recursive: true });

        const ext = consumer.type === 'module' ? 'mts' : 'cts';
        const sourceFile = join(testSubdir, `consumer.${ext}`);
        writeFileSync(sourceFile, TYPED_USAGE, 'utf8');

        const tsconfig = {
          compilerOptions: {
            target: 'ES2022',
            module: consumer.module,
            moduleResolution: consumer.resolution,
            strict: true,
            noEmit: true,
            skipLibCheck: false,
          },
          include: [`consumer.${ext}`],
        };

        const tsconfigPath = join(testSubdir, 'tsconfig.json');
        writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2), 'utf8');

        const result = spawnSync(process.execPath, [tsc, '-p', tsconfigPath], {
          cwd: testSubdir,
          encoding: 'utf8',
        });

        expect(result.status).toBe(0);
      });
    }
  });
});
