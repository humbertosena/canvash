import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { packDirOf, packedTarball } from './global-setup.js';
import { manifestVersion } from './manifest-version.js';

// Contrato de distribuição do @canvash/interaction (questão 11).
// O pacote e sua dependência @canvash/core são construídos e empacotados com `pnpm pack` pelo
// globalSetup e extraídos em um projeto temporário fora do workspace.

const packs = inject('canvashPacks');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

const nodeBinaries = [
  process.execPath,
  ...(process.env.PACKAGING_NODE_BINARIES ?? '').split(delimiter).filter(Boolean),
];

const SMOKE_REPORT = `
console.log(
  JSON.stringify({
    entry: resolved.split('/@canvash/interaction/')[1],
    version: INTERACTION_VERSION,
  }),
);
`;

const SMOKE_IMPORT = `
import { INTERACTION_VERSION } from '@canvash/interaction';
const resolved = import.meta.resolve('@canvash/interaction');
${SMOKE_REPORT}`;

const SMOKE_REQUIRE = `
const { INTERACTION_VERSION } = require('@canvash/interaction');
const resolved = require.resolve('@canvash/interaction');
${SMOKE_REPORT}`;

const TYPED_USAGE = `
import { INTERACTION_VERSION } from '@canvash/interaction';
export const version: string = INTERACTION_VERSION;
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
let installDir = '';
let tarballFiles: string[] = [];

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'canvash-packaging-interaction-'));

  // Instala o core empacotado pelo globalSetup
  const coreTarball = packedTarball(packs, '@canvash/core');
  const coreInstallDir = join(projectDir, 'node_modules', '@canvash', 'core');
  mkdirSync(coreInstallDir, { recursive: true });
  execFileSync('tar', ['-xzf', coreTarball, '-C', coreInstallDir, '--strip-components=1']);

  // Tarball do interaction, também do globalSetup
  const packedDir = packDirOf(packs, '@canvash/interaction');
  const tarballs = readdirSync(packedDir).filter((name) => name.endsWith('.tgz'));
  expect(tarballs).toHaveLength(1);
  const tarball = join(packedDir, String(tarballs[0]));

  tarballFiles = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((entry) => entry.replace(/^package\//, ''))
    .sort();

  installDir = join(projectDir, 'node_modules', '@canvash', 'interaction');
  mkdirSync(installDir, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', installDir, '--strip-components=1']);

  writeJson(join(projectDir, 'package.json'), { name: 'packaging-consumer', private: true });
  writeFileSync(join(projectDir, 'smoke.mjs'), SMOKE_IMPORT);
  writeFileSync(join(projectDir, 'smoke.cjs'), SMOKE_REQUIRE);
});

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe('tarball de @canvash/interaction', () => {
  it('contém só o manifest e o dist, sem fonte nem testes', () => {
    expect(tarballFiles).toEqual(
      expect.arrayContaining([
        'package.json',
        'dist/index.mjs',
        'dist/index.mjs.map',
        'dist/index.d.mts',
        'dist/index.cjs',
        'dist/index.cjs.map',
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

  it('declara exports explícitos para import e require, cada um com seus tipos', () => {
    const manifest = JSON.parse(readFileSync(join(installDir, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>;
    };

    expect(manifest.exports?.['.']).toEqual({
      import: { types: './dist/index.d.mts', default: './dist/index.mjs' },
      require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
    });
  });

  it('publica o manifesto só com entradas de dist, só com o registro no publishConfig e sem caminho de fonte', () => {
    const text = readFileSync(join(installDir, 'package.json'), 'utf8');
    const manifest = JSON.parse(text) as Record<string, unknown>;

    // O pnpm troca exports, main, module e types; o registro local fica, como trava da US-R.4.
    expect(manifest.publishConfig).toEqual({ registry: 'http://localhost:4873/' });
    expect({ main: manifest.main, module: manifest.module, types: manifest.types }).toEqual({
      main: './dist/index.cjs',
      module: './dist/index.mjs',
      types: './dist/index.d.cts',
    });
    expect(text).not.toContain('src/');
    for (const entry of [manifest.main, manifest.module, manifest.types]) {
      expect(tarballFiles).toContain(String(entry).replace(/^\.\//, ''));
    }
  });

  it('declara dependência interna de @canvash/core', () => {
    const manifest = JSON.parse(readFileSync(join(installDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    expect(manifest.dependencies).toEqual({
      '@canvash/core': manifestVersion('core'),
    });
  });

  it('traz sourcemaps autocontidos, só com fontes do pacote', () => {
    const maps = tarballFiles.filter((file) => /\.(mjs|cjs)\.map$/.test(file));
    expect(maps).toHaveLength(2);

    for (const file of maps) {
      const map = JSON.parse(readFileSync(join(installDir, file), 'utf8')) as {
        sources: string[];
        sourcesContent?: (string | null)[];
      };
      expect(map.sources.filter((source) => !source.startsWith('../src/'))).toEqual([]);
      expect(map.sourcesContent?.map((content) => typeof content)).toEqual(
        map.sources.map(() => 'string'),
      );
    }
  });

  for (const nodeBinary of nodeBinaries) {
    for (const [entry, script, file] of [
      ['import', 'smoke.mjs', 'dist/index.mjs'],
      ['require', 'smoke.cjs', 'dist/index.cjs'],
    ] as const) {
      it(`executa por ${entry} em ${nodeBinary}`, () => {
        const result = spawnSync(nodeBinary, [script], {
          cwd: projectDir,
          encoding: 'utf8',
          env: {},
        });

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
          entry: file,
          version: manifestVersion('interaction'),
        });
      });
    }
  }

  for (const consumer of TYPE_CONSUMERS) {
    it(`entrega tipos a um consumidor ${consumer.name}`, () => {
      const consumerDir = join(projectDir, consumer.name);
      mkdirSync(consumerDir);
      writeJson(join(consumerDir, 'package.json'), {
        name: consumer.name,
        private: true,
        type: consumer.type,
      });
      writeJson(join(consumerDir, 'tsconfig.json'), {
        compilerOptions: {
          target: 'ES2022',
          module: consumer.module,
          moduleResolution: consumer.resolution,
          lib: ['DOM', 'DOM.Iterable', 'ES2022'],
          types: [],
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          declaration: true,
          emitDeclarationOnly: true,
          outDir: 'out',
          skipLibCheck: false,
        },
        files: ['index.ts'],
      });
      writeFileSync(join(consumerDir, 'index.ts'), TYPED_USAGE);

      const result = spawnSync(process.execPath, [tsc, '-p', consumerDir, '--listFiles'], {
        cwd: projectDir,
        encoding: 'utf8',
      });
      const lines = result.stdout.split('\n').filter(Boolean);

      expect({
        status: result.status,
        errors: lines.filter((line) => line.includes('error TS')),
        declarations: lines
          .filter((line) => line.includes('/@canvash/interaction/'))
          .map((line) => line.split('/@canvash/interaction/')[1]),
      }).toEqual({ status: 0, errors: [], declarations: [`dist/${consumer.declaration}`] });
    });
  }
});
