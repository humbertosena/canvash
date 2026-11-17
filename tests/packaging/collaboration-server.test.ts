import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
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
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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

const CORE_TYPED_USAGE = `
import {
  createCollaborationServer,
  createFileRoomStorage,
  createMemoryRoomStorage,
  type RoomStorage,
  type ServerConnection,
} from '@canvash/collaboration-server';

declare function verifySession(
  cookie: string | null,
  token: string | undefined,
): Promise<{ id: string; name: string } | undefined>;
declare function canRead(user: { id: string }, documentId: string): Promise<boolean>;
declare function canWrite(user: { id: string }, documentId: string): Promise<boolean>;

const storage: RoomStorage = createFileRoomStorage({ directory: './rooms' });

export const server = createCollaborationServer({
  storage,
  allowedOrigins: ['https://app.exemplo.com'],
  authorize: async ({ documentId, sessionId, credentials, headers, context }) => {
    void sessionId;
    void context;
    const user = await verifySession(headers.get('cookie'), credentials?.token);
    if (user === undefined) return { allow: false };
    if (!(await canRead(user, documentId))) return { allow: false, code: 'NOT_FOUND' };
    return {
      allow: true,
      access: (await canWrite(user, documentId)) ? 'write' : 'read',
      user: { id: user.id, name: user.name },
    };
  },
});

interface MeuSocket {
  send(frame: Uint8Array): void;
  close(code: number, reason?: string): void;
  onMessage(listener: (frame: Uint8Array) => void): () => void;
  onClose(listener: () => void): () => void;
}

export function onConnect(socket: MeuSocket, headers: Headers): void {
  const connection: ServerConnection = {
    send: (frame) => socket.send(frame),
    close: (code, reason) => socket.close(code, reason),
    onFrame: (listener) => socket.onMessage(listener),
    onClose: (listener) => socket.onClose(listener),
  };
  server.handleConnection(connection, { headers });
}

export const memory = createCollaborationServer({ storage: createMemoryRoomStorage() });
export async function operate(): Promise<number> {
  const compacted = await server.compact('desenho-42');
  const rotated = await server.rotateEpoch('desenho-42', { snapshot: new Uint8Array() });
  const closed = await server.disconnect(
    'desenho-42',
    { userId: 'ana' },
    { code: 'NOT_FOUND', message: 'Desenho excluído.' },
  );
  await server.close();
  return Number(compacted.ok) + Number(rotated.ok) + closed;
}
`;

describe('@canvash/collaboration-server: o exemplo do núcleo com conexão genérica compila', () => {
  for (const consumer of TYPE_CONSUMERS) {
    it(`sob ${consumer.name}`, () => {
      const testSubdir = join(projectDir, `typecheck-core-${consumer.name}`);
      mkdirSync(testSubdir, { recursive: true });
      const ext = consumer.type === 'module' ? 'mts' : 'cts';
      writeFileSync(join(testSubdir, `consumer.${ext}`), CORE_TYPED_USAGE, 'utf8');
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
            lib: ['ES2022', 'DOM'],
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

// --- CLI e sobrevivência do commit ao SIGKILL (COLLAB-13, US-S.3, US-S.9) ---

const CLIENT_SCRIPT = `
import { decodeServerMessage, encodeClientMessage } from '@canvash/collaboration';
import { WebSocket } from 'ws';
import * as Y from 'yjs';

const [url, mode, commitId, updateB64] = process.argv.slice(2);

function addRectangle(doc, id) {
  const shapes = doc.getMap('shapes');
  const record = new Y.Map();
  record.set('id', id);
  record.set('type', 'rectangle');
  record.set('generation', 1);
  record.set('isDeleted', false);
  record.set('placement', { parentId: 'layer-default', orderKey: 'm_' + id });
  record.set('geometry', { x: 0, y: 0, width: 10, height: 10, rotation: 0 });
  shapes.set(id, record);
}

const socket = new WebSocket(url);
socket.binaryType = 'arraybuffer';
const doc = new Y.Doc();
let welcome;
const timer = setTimeout(() => { console.error('sem resposta'); process.exit(1); }, 8000);

socket.on('open', () =>
  socket.send(encodeClientMessage({
    t: 'hello', v: 1, provider: 'yjs', documentId: 'doc-crash', sessionId: 'sessao-' + mode,
    syncState: new Uint8Array(),
  })),
);
socket.on('message', (data) => {
  const decoded = decodeServerMessage(new Uint8Array(data));
  if (!decoded.ok) { console.error(decoded.error.message); process.exit(1); }
  const message = decoded.value;
  if (message.t === 'error') { console.error(JSON.stringify(message)); process.exit(1); }
  if (message.t === 'welcome') {
    welcome = message;
    Y.applyUpdate(doc, message.missing);
    let update;
    if (mode === 'commit') {
      const updates = [];
      doc.on('update', (u) => updates.push(u));
      addRectangle(doc, 'forma-do-crash');
      update = updates[0];
    } else {
      update = new Uint8Array(Buffer.from(updateB64, 'base64'));
    }
    socket.send(encodeClientMessage({ t: 'commit', id: 1, commitId: commitId || 'commit-crash', roomEpoch: message.roomEpoch, update }));
    globalThis.sentUpdate = update;
  }
  if (message.t === 'ack') {
    clearTimeout(timer);
    console.log(JSON.stringify({
      receipt: message.receipt,
      epoch: welcome.roomEpoch,
      update: Buffer.from(globalThis.sentUpdate).toString('base64'),
      shapes: Object.keys(doc.getMap('shapes').toJSON()),
    }));
    socket.close();
    process.exit(0);
  }
});
socket.on('error', (error) => { console.error(error.message); process.exit(1); });
`;

// O roteiro de docs/colaboracao-em-rede.md, com a URL vinda da CLI que o teste subiu.
const GUIDE_SCRIPT = `
import { createCanvasSection } from '@canvash/core';
import { YjsCollaborationProvider, createWebSocketTransport } from '@canvash/collaboration-yjs';

const url = process.argv[2];
const open = async (user) => {
  const provider = new YjsCollaborationProvider({
    createTransport: createWebSocketTransport({ url }),
  });
  const section = createCanvasSection();
  const connected = await provider.connect({
    documentId: 'desenho-42',
    section,
    user,
    seedEmptyRoom: false,
  });
  if (!connected.ok) throw new Error(connected.error.message);
  return { section, session: connected.value };
};

const ana = await open({ id: 'ana', name: 'Ana' });
const caio = await open({ id: 'caio', name: 'Caio' });
ana.section.dispatch({
  type: 'shape.create',
  shape: { id: 'r1', type: 'rectangle', x: 10, y: 10, width: 80, height: 40, rotation: 0 },
});
await new Promise((resolve) => setTimeout(resolve, 600));
console.log(JSON.stringify({
  caioSees: Object.keys(caio.section.getSnapshot().document.nodes),
  pending: ana.session.getPending(),
  receipts: ana.session.getCommitReceipts().length,
}));
ana.session.destroy();
caio.session.destroy();
`;

describe('@canvash/collaboration-server: CLI', () => {
  const cliPath = (): string =>
    join(projectDir, 'node_modules', '@canvash', 'collaboration-server', 'dist', 'cli.mjs');
  const children: ChildProcess[] = [];

  afterEach(() => {
    for (const child of children.splice(0)) child.kill('SIGKILL');
  });

  /** Sobe a CLI e espera a linha com a URL. */
  async function startCli(
    args: readonly string[],
  ): Promise<{ child: ChildProcess; url: string; stderr: () => string }> {
    const child = spawn(process.execPath, [cliPath(), ...args], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const url = await new Promise<string>((resolve, reject) => {
      let stdout = '';
      const timer = setTimeout(
        () => reject(new Error(`a CLI não anunciou a URL: ${stderr}`)),
        10_000,
      );
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        const match = /escutando em (ws:\/\/\S+)/.exec(stdout);
        if (match?.[1] !== undefined) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`a CLI saiu com ${code} antes de escutar: ${stderr}`));
      });
    });
    return { child, url, stderr: () => stderr };
  }

  function exited(child: ChildProcess): Promise<{ code: number | null; signal: string | null }> {
    return new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve({ code: child.exitCode, signal: child.signalCode });
        return;
      }
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
  }

  function runClient(args: readonly string[]): {
    receipt: unknown;
    epoch: string;
    update: string;
    shapes: string[];
  } {
    const script = join(projectDir, 'crash-client.mjs');
    writeFileSync(script, CLIENT_SCRIPT, 'utf8');
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: projectDir,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout.trim()) as ReturnType<typeof runClient>;
  }

  it('declara o bin e o tarball traz o dist/cli.mjs executável', () => {
    const pkg = JSON.parse(
      readFileSync(
        join(projectDir, 'node_modules', '@canvash', 'collaboration-server', 'package.json'),
        'utf8',
      ),
    ) as { bin: Record<string, string> };
    expect(pkg.bin).toEqual({ 'canvash-collab-server': './dist/cli.mjs' });
    expect(tarballFiles).toContain('dist/cli.mjs');
    const packedDir = packDirOf(packs, '@canvash/collaboration-server');
    const [tarball] = readdirSync(packedDir).filter((name) => name.endsWith('.tgz'));
    const listing = execFileSync('tar', ['-tvzf', join(packedDir, String(tarball))], {
      encoding: 'utf8',
    });
    expect(listing).toMatch(/^-rwx\S+.*package\/dist\/cli\.mjs$/m);
  });

  it('--help mostra o uso, avisa que é para desenvolvimento e sai com 0', () => {
    const result = spawnSync(process.execPath, [cliPath(), '--help'], {
      cwd: projectDir,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Uso: canvash-collab-server');
    expect(result.stdout).toContain('DESENVOLVIMENTO');
  });

  it('argumento inválido: explica no stderr e sai com 2', () => {
    const result = spawnSync(process.execPath, [cliPath(), '--port', 'abc'], {
      cwd: projectDir,
      encoding: 'utf8',
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--port');
    expect(result.stdout).toBe('');
  });

  it('sobe na porta pedida, avisa que é de desenvolvimento e sai com SIGTERM sem deixar processo', async () => {
    const free = await new Promise<number>((resolve) => {
      const probe = createNetServer().listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as AddressInfo;
        probe.close(() => resolve(port));
      });
    });
    const dataDir = mkdtempSync(join(tmpdir(), 'canvash-cli-data-'));
    try {
      const { child, url, stderr } = await startCli(['--port', String(free), '--data', dataDir]);

      expect(url).toBe(`ws://127.0.0.1:${free}/collab`);
      expect(stderr()).toContain('DESENVOLVIMENTO');
      child.kill('SIGTERM');
      const outcome = await exited(child);
      expect(outcome).toEqual({ code: 0, signal: null });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('o commit confirmado sobrevive ao SIGKILL: outra CLI no mesmo diretório entrega o commit e o mesmo recibo no reenvio', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'canvash-cli-crash-'));
    try {
      const first = await startCli(['--port', '0', '--data', dataDir]);
      const committed = runClient([first.url, 'commit', 'commit-crash']);
      first.child.kill('SIGKILL');
      expect(await exited(first.child)).toEqual({ code: null, signal: 'SIGKILL' });

      const second = await startCli(['--port', '0', '--data', dataDir]);
      const verified = runClient([second.url, 'verify', 'commit-crash', committed.update]);
      second.child.kill('SIGTERM');
      await exited(second.child);

      expect(verified.shapes).toEqual(['forma-do-crash']);
      expect(verified.epoch).toBe(committed.epoch);
      expect(verified.receipt).toEqual(committed.receipt);
      expect(readdirSync(join(dataDir, 'doc-crash'))).toContain('room.json');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('o roteiro do guia: a CLI e dois providers com createWebSocketTransport convergem e o recibo chega', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'canvash-cli-guide-'));
    try {
      const { child, url } = await startCli(['--port', '0', '--data', dataDir]);
      const script = join(projectDir, 'guide.mjs');
      writeFileSync(script, GUIDE_SCRIPT, 'utf8');

      const result = spawnSync(process.execPath, [script, url], {
        cwd: projectDir,
        encoding: 'utf8',
      });
      child.kill('SIGTERM');
      const outcome = await exited(child);

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        caioSees: ['r1'],
        pending: { count: 0, bytes: 0 },
        receipts: 1,
      });
      expect(outcome).toEqual({ code: 0, signal: null });
      expect(readdirSync(join(dataDir, 'desenho-42')).sort()).toEqual([
        'log.0.bin',
        'receipts.0.bin',
        'room.json',
        'snapshot.0.bin',
      ]);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('a origem fora de --origin recebe 403 e a da lista entra', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'canvash-cli-origin-'));
    try {
      const { child, url } = await startCli([
        '--port',
        '0',
        '--data',
        dataDir,
        '--origin',
        'http://localhost:5173',
      ]);
      const probe = (origin: string): string => {
        const script = join(projectDir, 'origin-probe.mjs');
        writeFileSync(
          script,
          `import { WebSocket } from 'ws';\n` +
            `const ws = new WebSocket(process.argv[2], { origin: process.argv[3] });\n` +
            `ws.on('open', () => { console.log('open'); ws.close(); });\n` +
            `ws.on('unexpected-response', (_q, r) => { console.log('HTTP ' + r.statusCode); process.exit(0); });\n` +
            `ws.on('error', () => undefined);\n` +
            `ws.on('close', () => process.exit(0));\n`,
          'utf8',
        );
        return spawnSync(process.execPath, [script, url, origin], {
          cwd: projectDir,
          encoding: 'utf8',
        }).stdout.trim();
      };

      expect(probe('http://atacante.test')).toBe('HTTP 403');
      expect(probe('http://localhost:5173')).toBe('open');
      child.kill('SIGTERM');
      await exited(child);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
