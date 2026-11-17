import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { packDirOf, packedTarball } from './global-setup.js';

const packs = inject('canvashPacks');
const packageDir = fileURLToPath(new URL('../../packages/collaboration-yjs/', import.meta.url));
const rootNodeModules = fileURLToPath(new URL('../../node_modules/', import.meta.url));
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

const nodeBinaries = [
  process.execPath,
  ...(process.env.PACKAGING_NODE_BINARIES ?? '').split(delimiter).filter(Boolean),
];

const SMOKE_REPORT = `
console.log(
  JSON.stringify({
    entry: resolved.split('/@canvash/collaboration-yjs/')[1],
    version: COLLABORATION_YJS_VERSION,
  }),
);
`;

const SMOKE_IMPORT = `
import { COLLABORATION_YJS_VERSION, YjsCollaborationProvider } from '@canvash/collaboration-yjs';
const resolved = import.meta.resolve('@canvash/collaboration-yjs');
${SMOKE_REPORT}`;

const SMOKE_REQUIRE = `
const { COLLABORATION_YJS_VERSION, YjsCollaborationProvider } = require('@canvash/collaboration-yjs');
const resolved = require.resolve('@canvash/collaboration-yjs');
${SMOKE_REPORT}`;

const TYPED_USAGE = `
import {
  COLLABORATION_YJS_VERSION,
  YjsCollaborationProvider,
  YjsCollaborationSession,
  projectYDocToCanvasDocument,
  RECOVERY_LAYER_ID,
  type YjsGeometry,
  type YjsPlacement,
} from '@canvash/collaboration-yjs';
import type { CanvasSectionApi } from '@canvash/core';
import type { CollaborationProvider } from '@canvash/collaboration';

export const version: number = COLLABORATION_YJS_VERSION;
export const provider: CollaborationProvider = new YjsCollaborationProvider();
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
] as const;

let projectDir: string;
let tarballFiles: string[] = [];

// O build e o pack de todos os pacotes ficam no globalSetup, uma vez por execução.
beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'canvash-packaging-collab-yjs-'));

  // Core tarball
  const coreTarball = packedTarball(packs, '@canvash/core');
  const coreInstallDir = join(projectDir, 'node_modules', '@canvash', 'core');
  mkdirSync(coreInstallDir, { recursive: true });
  execFileSync('tar', ['-xzf', coreTarball, '-C', coreInstallDir, '--strip-components=1']);

  // Collaboration tarball
  const collabTarball = packedTarball(packs, '@canvash/collaboration');
  const collabInstallDir = join(projectDir, 'node_modules', '@canvash', 'collaboration');
  mkdirSync(collabInstallDir, { recursive: true });
  execFileSync('tar', ['-xzf', collabTarball, '-C', collabInstallDir, '--strip-components=1']);

  // Collaboration-yjs tarball
  const packedDir = packDirOf(packs, '@canvash/collaboration-yjs');
  const tarballs = readdirSync(packedDir).filter((name) => name.endsWith('.tgz'));
  expect(tarballs).toHaveLength(1);
  const tarball = join(packedDir, String(tarballs[0]));

  tarballFiles = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((entry) => entry.replace(/^package\//, ''))
    .sort();

  const installDir = join(projectDir, 'node_modules', '@canvash', 'collaboration-yjs');
  mkdirSync(installDir, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', installDir, '--strip-components=1']);

  // Disponibiliza as dependências externas (yjs, lib0) para o consumidor isolado
  const consumerModules = join(projectDir, 'node_modules');
  const packageModules = join(packageDir, 'node_modules');

  for (const dep of ['yjs', 'lib0']) {
    const target = existsSync(join(packageModules, dep))
      ? join(packageModules, dep)
      : join(rootNodeModules, dep);
    if (existsSync(target)) {
      symlinkSync(target, join(consumerModules, dep), 'dir');
    }
  }

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

describe('@canvash/collaboration-yjs packaging contract', () => {
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
        join(projectDir, 'node_modules', '@canvash', 'collaboration-yjs', 'package.json'),
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
        expect(data.version).toBe(1);
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
        expect(data.version).toBe(1);
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

// --- Colaboração em rede (0.2.0): transporte em memória, semeadura e entrada /testing ---

const NETWORK_SMOKE_BODY = `
let hub = new DeterministicTransportHub(new CollaborativeServerEmulator());
const harness = {
  createTransport: (context) => createMemoryTransport(hub)(context),
  dropLink: (sessionId) => {
    hub.dropLink(sessionId);
    setTimeout(() => hub.restoreLink(sessionId), 0);
  },
  failNextAppends: (_documentId, count) => hub.failNextCommits(count, 'STORAGE_UNAVAILABLE'),
};
const cases = transportContractCases(harness);

async function main() {
  let passed = 0;
  for (const contractCase of cases) {
    hub = new DeterministicTransportHub(new CollaborativeServerEmulator());
    await contractCase.run();
    passed += 1;
  }
  const invalid = encodeCanvasDocumentAsYjsState({ schemaVersion: 1 });
  console.log(
    JSON.stringify({
      testingEntry: testingResolved.split('/@canvash/collaboration-yjs/')[1],
      cases: cases.length >= 12,
      skipped: cases.filter((contractCase) => contractCase.skipped !== undefined).length,
      passed: passed === cases.length,
      seedRefusal: !invalid.ok && invalid.error.code,
      projection: typeof projectYjsStateToCanvasDocument,
    }),
  );
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

const NETWORK_MAIN_NAMES =
  'CollaborativeServerEmulator, DeterministicTransportHub, createMemoryTransport, ' +
  'encodeCanvasDocumentAsYjsState, projectYjsStateToCanvasDocument';

const NETWORK_TYPED_USAGE = `
import {
  YjsCollaborationProvider,
  createMemoryTransport,
  encodeCanvasDocumentAsYjsState,
  projectYjsStateToCanvasDocument,
  CollaborativeServerEmulator,
  DeterministicTransportHub,
  type LegacyTransportHub,
  type YjsProviderOptions,
} from '@canvash/collaboration-yjs';
import {
  transportContractCases,
  type ContractCase,
  type TransportContractHarness,
} from '@canvash/collaboration-yjs/testing';
import type { CanvasDocument } from '@canvash/core';
import type { CollaborationError, CreateTransport, Result } from '@canvash/collaboration';

const hub = new DeterministicTransportHub(new CollaborativeServerEmulator());
export const legacy: LegacyTransportHub = hub;
export const createTransport: CreateTransport = createMemoryTransport(hub);
export const options: YjsProviderOptions = { createTransport };
export const provider = new YjsCollaborationProvider(options);

export function seed(document: CanvasDocument): Result<Uint8Array, CollaborationError> {
  return encodeCanvasDocumentAsYjsState(document);
}
export function project(state: Uint8Array): Result<CanvasDocument, CollaborationError> {
  return projectYjsStateToCanvasDocument(state);
}

const harness: TransportContractHarness = {
  createTransport,
  dropLink: (sessionId: string) => hub.dropLink(sessionId),
};
export const cases: readonly ContractCase[] = transportContractCases(harness);
`;

describe('@canvash/collaboration-yjs: exports da colaboração em rede (US-P.8, US-P.15)', () => {
  const EXPECTED = {
    cases: true,
    skipped: 0,
    passed: true,
    seedRefusal: 'INVALID_DOCUMENT',
    projection: 'function',
  };

  it('o tarball traz a entrada /testing ao lado da principal', () => {
    expect(tarballFiles).toEqual(
      expect.arrayContaining([
        'dist/testing.mjs',
        'dist/testing.cjs',
        'dist/testing.d.mts',
        'dist/testing.d.cts',
      ]),
    );
    const pkg = JSON.parse(
      readFileSync(
        join(projectDir, 'node_modules', '@canvash', 'collaboration-yjs', 'package.json'),
        'utf8',
      ),
    );
    expect(pkg.exports['./testing']).toEqual({
      import: { types: './dist/testing.d.mts', default: './dist/testing.mjs' },
      require: { types: './dist/testing.d.cts', default: './dist/testing.cjs' },
    });
  });

  for (const bin of nodeBinaries) {
    it(`a suíte de contrato, importada do tarball, passa com o transporte em memória via ESM em ${bin}`, () => {
      const scriptPath = join(projectDir, 'network-import.mjs');
      writeFileSync(
        scriptPath,
        `import { ${NETWORK_MAIN_NAMES} } from '@canvash/collaboration-yjs';\n` +
          `import { transportContractCases } from '@canvash/collaboration-yjs/testing';\n` +
          `const testingResolved = import.meta.resolve('@canvash/collaboration-yjs/testing');\n` +
          NETWORK_SMOKE_BODY,
        'utf8',
      );

      const result = spawnSync(bin, [scriptPath], { cwd: projectDir, encoding: 'utf8' });

      // O stderr não é conferido: no Node 25+, o lib0 (via yjs) emite um ExperimentalWarning da
      // Web Storage ao ser importado (dmonad/lib0#146).
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        ...EXPECTED,
        testingEntry: 'dist/testing.mjs',
      });
    });

    it(`a suíte de contrato, importada do tarball, passa com o transporte em memória via CJS em ${bin}`, () => {
      const scriptPath = join(projectDir, 'network-require.cjs');
      writeFileSync(
        scriptPath,
        `const { ${NETWORK_MAIN_NAMES} } = require('@canvash/collaboration-yjs');\n` +
          `const { transportContractCases } = require('@canvash/collaboration-yjs/testing');\n` +
          `const testingResolved = require.resolve('@canvash/collaboration-yjs/testing');\n` +
          NETWORK_SMOKE_BODY,
        'utf8',
      );

      const result = spawnSync(bin, [scriptPath], { cwd: projectDir, encoding: 'utf8' });

      // O stderr não é conferido: no Node 25+, o lib0 (via yjs) emite um ExperimentalWarning da
      // Web Storage ao ser importado (dmonad/lib0#146).
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        ...EXPECTED,
        testingEntry: 'dist/testing.cjs',
      });
    });
  }

  for (const consumer of TYPE_CONSUMERS) {
    it(`transporte, semeadura e a entrada /testing compilam sob ${consumer.name}`, () => {
      const testSubdir = join(projectDir, `typecheck-network-${consumer.name}`);
      mkdirSync(testSubdir, { recursive: true });
      const ext = consumer.type === 'module' ? 'mts' : 'cts';
      writeFileSync(join(testSubdir, `consumer.${ext}`), NETWORK_TYPED_USAGE, 'utf8');
      const tsconfigPath = join(testSubdir, 'tsconfig.json');
      writeFileSync(
        tsconfigPath,
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: consumer.module,
            moduleResolution: consumer.resolution,
            strict: true,
            noEmit: true,
            skipLibCheck: false,
          },
          include: [`consumer.${ext}`],
        }),
        'utf8',
      );

      const result = spawnSync(process.execPath, [tsc, '-p', tsconfigPath], {
        cwd: testSubdir,
        encoding: 'utf8',
      });

      expect(result.stdout).toBe('');
      expect(result.status).toBe(0);
    });
  }
});
