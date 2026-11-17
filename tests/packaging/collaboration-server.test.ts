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
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { packDirOf, packedTarball } from './global-setup.js';

// Contrato de distribuição de @canvash/collaboration-server: o tarball, instalado fora do
// workspace, funciona por `import` e por `require` em Node, sem DOM, e os tipos compilam para
// consumidores NodeNext (ESM e CJS) e Bundler.

const packs = inject('canvashPacks');
const packageDir = fileURLToPath(new URL('../../packages/collaboration-server/', import.meta.url));
const rootNodeModules = fileURLToPath(new URL('../../node_modules/', import.meta.url));
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const manifestVersion = (
  JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { version: string }
).version;

const nodeBinaries = [
  process.execPath,
  ...(process.env.PACKAGING_NODE_BINARIES ?? '').split(delimiter).filter(Boolean),
];

const SMOKE_REPORT = `
console.log(
  JSON.stringify({
    entry: resolved.split('/@canvash/collaboration-server/')[1],
    version: COLLABORATION_SERVER_VERSION,
    hasDocument: typeof document,
  }),
);
`;

const SMOKE_IMPORT = `
import { COLLABORATION_SERVER_VERSION } from '@canvash/collaboration-server';
const resolved = import.meta.resolve('@canvash/collaboration-server');
${SMOKE_REPORT}`;

const SMOKE_REQUIRE = `
const { COLLABORATION_SERVER_VERSION } = require('@canvash/collaboration-server');
const resolved = require.resolve('@canvash/collaboration-server');
${SMOKE_REPORT}`;

const TYPED_USAGE = `
import { COLLABORATION_SERVER_VERSION } from '@canvash/collaboration-server';

export const version: string = COLLABORATION_SERVER_VERSION;
`;

const TYPE_CONSUMERS = [
  { name: 'esm-nodenext', type: 'module', module: 'NodeNext', resolution: 'NodeNext' },
  { name: 'cjs-nodenext', type: 'commonjs', module: 'NodeNext', resolution: 'NodeNext' },
  { name: 'bundler', type: 'module', module: 'ESNext', resolution: 'Bundler' },
] as const;

let projectDir: string;
let tarballFiles: string[] = [];

const installTarball = (name: string, folder: string): void => {
  const installDir = join(projectDir, 'node_modules', '@canvash', folder);
  mkdirSync(installDir, { recursive: true });
  execFileSync('tar', [
    '-xzf',
    packedTarball(packs, name),
    '-C',
    installDir,
    '--strip-components=1',
  ]);
};

// O build e o pack de todos os pacotes ficam no globalSetup, uma vez por execução.
beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'canvash-packaging-collab-server-'));
  installTarball('@canvash/core', 'core');
  installTarball('@canvash/collaboration', 'collaboration');
  installTarball('@canvash/collaboration-yjs', 'collaboration-yjs');
  installTarball('@canvash/collaboration-server', 'collaboration-server');

  const packedDir = packDirOf(packs, '@canvash/collaboration-server');
  const tarballs = readdirSync(packedDir).filter((name) => name.endsWith('.tgz'));
  expect(tarballs).toHaveLength(1);
  tarballFiles = execFileSync('tar', ['-tzf', join(packedDir, String(tarballs[0]))], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .map((entry) => entry.replace(/^package\//, ''))
    .sort();

  // Dependências externas do pacote, para o consumidor isolado.
  const consumerModules = join(projectDir, 'node_modules');
  const packageModules = join(packageDir, 'node_modules');
  for (const dep of ['yjs', 'lib0', 'ws', '@types/ws', '@types/node']) {
    const target = existsSync(join(packageModules, dep))
      ? join(packageModules, dep)
      : join(rootNodeModules, dep);
    if (!existsSync(target)) continue;
    mkdirSync(dirname(join(consumerModules, dep)), { recursive: true });
    symlinkSync(target, join(consumerModules, dep), 'dir');
  }

  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({ name: 'packaging-consumer', private: true, type: 'module' }),
  );
});

afterAll(() => {
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

describe('@canvash/collaboration-server packaging contract', () => {
  // Os tipos que as duas entradas dividem saem num bloco em `dist/shared/`, dentro do `dist`.
  it('contém só o manifesto, o dist e os arquivos de apoio', () => {
    expect(tarballFiles).toEqual(
      expect.arrayContaining([
        'package.json',
        'README.md',
        'LICENSE',
        'CHANGELOG.md',
        'dist/index.mjs',
        'dist/index.cjs',
        'dist/index.d.mts',
        'dist/index.d.cts',
      ]),
    );
    const unexpected = tarballFiles.filter(
      (file) =>
        !/^(package\.json|(README|LICEN[CS]E|CHANGELOG)(\.md)?)$/i.test(file) &&
        !/^dist\/(shared\/)?[\w.-]+\.(mjs|cjs|d\.mts|d\.cts)(\.map)?$/.test(file),
    );
    expect(unexpected).toEqual([]);
    expect(tarballFiles.filter((file) => /\.test\./.test(file))).toEqual([]);
  });

  it('declara as entradas de import e de require, com os tipos de cada uma, sem citar o fonte', () => {
    const raw = readFileSync(
      join(projectDir, 'node_modules', '@canvash', 'collaboration-server', 'package.json'),
      'utf8',
    );
    const pkg = JSON.parse(raw) as {
      sideEffects: boolean;
      engines: { node: string };
      exports: Record<string, unknown>;
      dependencies: Record<string, string>;
    };

    expect(pkg.sideEffects).toBe(false);
    expect(pkg.engines.node).toBe('>=22');
    expect(pkg.exports['.']).toEqual({
      import: { types: './dist/index.d.mts', default: './dist/index.mjs' },
      require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
    });
    expect(raw).not.toContain('./src/');
    // As dependências internas saem com versão, não com o protocolo do workspace.
    for (const name of ['@canvash/core', '@canvash/collaboration', '@canvash/collaboration-yjs']) {
      expect(pkg.dependencies[name]).toBe(manifestVersion);
    }
  });

  describe('consumo de execução em Node, sem DOM', () => {
    for (const bin of nodeBinaries) {
      it(`importa via ESM em ${bin}`, () => {
        const scriptPath = join(projectDir, 'smoke-import.mjs');
        writeFileSync(scriptPath, SMOKE_IMPORT, 'utf8');

        const result = spawnSync(bin, [scriptPath], { cwd: projectDir, encoding: 'utf8' });

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout.trim())).toEqual({
          entry: 'dist/index.mjs',
          version: manifestVersion,
          hasDocument: 'undefined',
        });
      });

      it(`carrega via CJS em ${bin}`, () => {
        const scriptPath = join(projectDir, 'smoke-require.cjs');
        writeFileSync(scriptPath, SMOKE_REQUIRE, 'utf8');

        const result = spawnSync(bin, [scriptPath], { cwd: projectDir, encoding: 'utf8' });

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout.trim())).toEqual({
          entry: 'dist/index.cjs',
          version: manifestVersion,
          hasDocument: 'undefined',
        });
      });
    }
  });

  describe('resolução de tipos TypeScript', () => {
    for (const consumer of TYPE_CONSUMERS) {
      it(`compila com sucesso sob ${consumer.name}`, () => {
        const testSubdir = join(projectDir, `typecheck-${consumer.name}`);
        mkdirSync(testSubdir, { recursive: true });
        const ext = consumer.type === 'module' ? 'mts' : 'cts';
        writeFileSync(join(testSubdir, `consumer.${ext}`), TYPED_USAGE, 'utf8');
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
});

// --- Armazenamento de salas e a entrada /testing ---

const STORAGE_SMOKE_BODY = `
async function runAll(factory, reopen) {
  const cases = roomStorageContractCases(factory, { reopen });
  let passed = 0;
  for (const contractCase of cases) {
    await contractCase.run();
    passed += 1;
  }
  return {
    cases: cases.length >= 15,
    skipped: cases.filter((contractCase) => contractCase.skipped !== undefined).length,
    passed: passed === cases.length,
  };
}

async function main() {
  const memory = await runAll(() => createMemoryRoomStorage(), (storage) => storage);
  const directories = new WeakMap();
  const file = await runAll(
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'canvash-packaging-rooms-'));
      const storage = createFileRoomStorage({ directory });
      directories.set(storage, directory);
      return storage;
    },
    (storage) => createFileRoomStorage({ directory: directories.get(storage) }),
  );
  console.log(
    JSON.stringify({
      testingEntry: testingResolved.split('/@canvash/collaboration-server/')[1],
      memory,
      file,
    }),
  );
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

const STORAGE_TYPED_USAGE = `
import {
  createFileRoomStorage,
  createMemoryRoomStorage,
  type AppendBatch,
  type RoomStorage,
  type StoredCommit,
  type StoredRoom,
} from '@canvash/collaboration-server';
import {
  roomStorageContractCases,
  type ContractCase,
  type RoomStorageContractOptions,
} from '@canvash/collaboration-server/testing';

export const storage: RoomStorage = createMemoryRoomStorage();
export const onDisk: RoomStorage = createFileRoomStorage({ directory: './salas' });
export const options: RoomStorageContractOptions = { keepsReceipts: true };
export const cases: readonly ContractCase[] = roomStorageContractCases(() => storage, options);

export function sizeOf(room: StoredRoom, commit: StoredCommit, batch: AppendBatch): number {
  return room.snapshot.byteLength + commit.update.byteLength + batch.commits.length;
}
`;

describe('@canvash/collaboration-server: armazenamento de salas e entrada /testing', () => {
  const RAN = { cases: true, skipped: 0, passed: true };
  const EXPECTED = { memory: RAN, file: RAN };

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
        join(projectDir, 'node_modules', '@canvash', 'collaboration-server', 'package.json'),
        'utf8',
      ),
    ) as { exports: Record<string, unknown> };
    expect(pkg.exports['./testing']).toEqual({
      import: { types: './dist/testing.d.mts', default: './dist/testing.mjs' },
      require: { types: './dist/testing.d.cts', default: './dist/testing.cjs' },
    });
  });

  for (const bin of nodeBinaries) {
    it(`a suíte de contrato, importada do tarball, passa com o armazenamento em memória e o em arquivo via ESM em ${bin}`, () => {
      const scriptPath = join(projectDir, 'storage-import.mjs');
      writeFileSync(
        scriptPath,
        `import { createFileRoomStorage, createMemoryRoomStorage } from '@canvash/collaboration-server';\n` +
          `import { mkdtempSync } from 'node:fs';\nimport { tmpdir } from 'node:os';\nimport { join } from 'node:path';\n` +
          `import { roomStorageContractCases } from '@canvash/collaboration-server/testing';\n` +
          `const testingResolved = import.meta.resolve('@canvash/collaboration-server/testing');\n` +
          STORAGE_SMOKE_BODY,
        'utf8',
      );

      const result = spawnSync(bin, [scriptPath], { cwd: projectDir, encoding: 'utf8' });

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        ...EXPECTED,
        testingEntry: 'dist/testing.mjs',
      });
    });

    it(`a suíte de contrato, importada do tarball, passa com o armazenamento em memória e o em arquivo via CJS em ${bin}`, () => {
      const scriptPath = join(projectDir, 'storage-require.cjs');
      writeFileSync(
        scriptPath,
        `const { createFileRoomStorage, createMemoryRoomStorage } = require('@canvash/collaboration-server');\n` +
          `const { mkdtempSync } = require('node:fs');\nconst { tmpdir } = require('node:os');\nconst { join } = require('node:path');\n` +
          `const { roomStorageContractCases } = require('@canvash/collaboration-server/testing');\n` +
          `const testingResolved = require.resolve('@canvash/collaboration-server/testing');\n` +
          STORAGE_SMOKE_BODY,
        'utf8',
      );

      const result = spawnSync(bin, [scriptPath], { cwd: projectDir, encoding: 'utf8' });

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        ...EXPECTED,
        testingEntry: 'dist/testing.cjs',
      });
    });
  }

  for (const consumer of TYPE_CONSUMERS) {
    it(`o armazenamento e a entrada /testing compilam sob ${consumer.name}`, () => {
      const testSubdir = join(projectDir, `typecheck-storage-${consumer.name}`);
      mkdirSync(testSubdir, { recursive: true });
      const ext = consumer.type === 'module' ? 'mts' : 'cts';
      writeFileSync(join(testSubdir, `consumer.${ext}`), STORAGE_TYPED_USAGE, 'utf8');
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
      expect(result.status, result.stderr).toBe(0);
    });
  }
});

// --- Adaptador `ws` (entrada /ws) ---

const WS_SMOKE_BODY = `
async function main() {
  const server = createCollaborationServer({ storage: createMemoryRoomStorage() });
  const listening = await listenWebSocket(server, { port: 0 });
  if (!listening.ok) throw new Error(listening.error.message);
  const client = new WebSocket(listening.value.url);
  client.binaryType = 'arraybuffer';
  const welcome = await new Promise((resolve, reject) => {
    client.on('open', () =>
      client.send(
        encodeClientMessage({
          t: 'hello',
          v: 1,
          provider: 'yjs',
          documentId: 'doc-pacote',
          sessionId: 'sessao-pacote',
          syncState: new Uint8Array(),
        }),
      ),
    );
    client.on('message', (data) => {
      const decoded = decodeServerMessage(new Uint8Array(data));
      resolve(decoded.ok ? decoded.value : decoded.error);
    });
    client.on('error', reject);
  });
  await server.close();
  await listening.value.close();
  console.log(
    JSON.stringify({
      wsEntry: wsResolved.split('/@canvash/collaboration-server/')[1],
      url: /^ws:\\/\\/127\\.0\\.0\\.1:\\d+\\/collab$/.test(listening.value.url),
      welcome: welcome.t,
      attach: typeof attachWebSocketServer,
    }),
  );
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

const WS_TYPED_USAGE = `
import {
  createCollaborationServer,
  createMemoryRoomStorage,
  type CollaborationServer,
} from '@canvash/collaboration-server';
import {
  attachWebSocketServer,
  listenWebSocket,
  type ListenHandle,
  type ListenOptions,
  type WebSocketAdapterOptions,
} from '@canvash/collaboration-server/ws';
import type { CollaborationError, Result } from '@canvash/collaboration';
import { WebSocketServer } from 'ws';

const server: CollaborationServer = createCollaborationServer({ storage: createMemoryRoomStorage() });
const adapter: WebSocketAdapterOptions = { heartbeatMs: 1_000 };
const options: ListenOptions = { port: 0, host: '127.0.0.1', path: '/collab', ...adapter };
export const start = (): Promise<Result<ListenHandle, CollaborationError>> => listenWebSocket(server, options);
export const detach = (wss: WebSocketServer): (() => void) => attachWebSocketServer(server, wss, adapter);
`;

describe('@canvash/collaboration-server: entrada /ws (US-S.1, US-S.9)', () => {
  it('o tarball traz a entrada /ws e o manifesto declara import e require com os tipos de cada um', () => {
    expect(tarballFiles).toEqual(
      expect.arrayContaining(['dist/ws.mjs', 'dist/ws.cjs', 'dist/ws.d.mts', 'dist/ws.d.cts']),
    );
    const pkg = JSON.parse(
      readFileSync(
        join(projectDir, 'node_modules', '@canvash', 'collaboration-server', 'package.json'),
        'utf8',
      ),
    ) as { exports: Record<string, unknown>; dependencies: Record<string, string> };
    expect(pkg.exports['./ws']).toEqual({
      import: { types: './dist/ws.d.mts', default: './dist/ws.mjs' },
      require: { types: './dist/ws.d.cts', default: './dist/ws.cjs' },
    });
    expect(Object.keys(pkg.dependencies)).toEqual(expect.arrayContaining(['ws', '@types/ws']));
  });

  it('a entrada principal não carrega o ws: o núcleo funciona sem ele resolvível (C9)', () => {
    const noWs = mkdtempSync(join(tmpdir(), 'canvash-packaging-no-ws-'));
    try {
      const consumerModules = join(noWs, 'node_modules');
      mkdirSync(join(consumerModules, '@canvash'), { recursive: true });
      for (const folder of ['core', 'collaboration', 'collaboration-yjs', 'collaboration-server']) {
        symlinkSync(
          join(projectDir, 'node_modules', '@canvash', folder),
          join(consumerModules, '@canvash', folder),
          'dir',
        );
      }
      symlinkSync(join(projectDir, 'node_modules', 'yjs'), join(consumerModules, 'yjs'), 'dir');
      symlinkSync(join(projectDir, 'node_modules', 'lib0'), join(consumerModules, 'lib0'), 'dir');
      writeFileSync(join(noWs, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
      const script = join(noWs, 'no-ws.mjs');
      writeFileSync(
        script,
        `import { createCollaborationServer, createMemoryRoomStorage } from '@canvash/collaboration-server';\n` +
          `let wsResolvable = true;\n` +
          `try { await import('ws'); } catch { wsResolvable = false; }\n` +
          `const server = createCollaborationServer({ storage: createMemoryRoomStorage(), logger: { warn() {}, error() {} } });\n` +
          `console.log(JSON.stringify({ wsResolvable, server: typeof server.handleConnection }));\n`,
        'utf8',
      );

      const result = spawnSync(process.execPath, [script], { cwd: noWs, encoding: 'utf8' });

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({ wsResolvable: false, server: 'function' });
    } finally {
      rmSync(noWs, { recursive: true, force: true });
    }
  });

  for (const bin of nodeBinaries) {
    it(`sobe o servidor pela porta 0 e faz o handshake de um cliente ws via ESM em ${bin}`, () => {
      const scriptPath = join(projectDir, 'ws-import.mjs');
      writeFileSync(
        scriptPath,
        `import { createCollaborationServer, createMemoryRoomStorage } from '@canvash/collaboration-server';\n` +
          `import { attachWebSocketServer, listenWebSocket } from '@canvash/collaboration-server/ws';\n` +
          `import { encodeClientMessage, decodeServerMessage } from '@canvash/collaboration';\n` +
          `import { WebSocket } from 'ws';\n` +
          `const wsResolved = import.meta.resolve('@canvash/collaboration-server/ws');\n` +
          WS_SMOKE_BODY,
        'utf8',
      );

      const result = spawnSync(bin, [scriptPath], { cwd: projectDir, encoding: 'utf8' });

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        wsEntry: 'dist/ws.mjs',
        url: true,
        welcome: 'welcome',
        attach: 'function',
      });
    });

    it(`faz o mesmo via CJS em ${bin}`, () => {
      const scriptPath = join(projectDir, 'ws-require.cjs');
      writeFileSync(
        scriptPath,
        `const { createCollaborationServer, createMemoryRoomStorage } = require('@canvash/collaboration-server');\n` +
          `const { attachWebSocketServer, listenWebSocket } = require('@canvash/collaboration-server/ws');\n` +
          `const { encodeClientMessage, decodeServerMessage } = require('@canvash/collaboration');\n` +
          `const { WebSocket } = require('ws');\n` +
          `const wsResolved = require.resolve('@canvash/collaboration-server/ws');\n` +
          WS_SMOKE_BODY,
        'utf8',
      );

      const result = spawnSync(bin, [scriptPath], { cwd: projectDir, encoding: 'utf8' });

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        wsEntry: 'dist/ws.cjs',
        url: true,
        welcome: 'welcome',
        attach: 'function',
      });
    });
  }

  for (const consumer of TYPE_CONSUMERS) {
    it(`os tipos do adaptador compilam sob ${consumer.name}`, () => {
      const testSubdir = join(projectDir, `typecheck-ws-${consumer.name}`);
      mkdirSync(testSubdir, { recursive: true });
      const ext = consumer.type === 'module' ? 'mts' : 'cts';
      writeFileSync(join(testSubdir, `consumer.${ext}`), WS_TYPED_USAGE, 'utf8');
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
            types: ['node'],
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
