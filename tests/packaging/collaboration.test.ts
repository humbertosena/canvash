import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { packDirOf, packedTarball } from './global-setup.js';

const packs = inject('canvashPacks');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

const nodeBinaries = [
  process.execPath,
  ...(process.env.PACKAGING_NODE_BINARIES ?? '').split(delimiter).filter(Boolean),
];

const SMOKE_REPORT = `
console.log(
  JSON.stringify({
    entry: resolved.split('/@canvash/collaboration/')[1],
    version: COLLABORATION_VERSION,
  }),
);
`;

const SMOKE_IMPORT = `
import { COLLABORATION_VERSION, generateOrderKey, compareOrderKeys } from '@canvash/collaboration';
const resolved = import.meta.resolve('@canvash/collaboration');
${SMOKE_REPORT}`;

const SMOKE_REQUIRE = `
const { COLLABORATION_VERSION, generateOrderKey, compareOrderKeys } = require('@canvash/collaboration');
const resolved = require.resolve('@canvash/collaboration');
${SMOKE_REPORT}`;

const TYPED_USAGE = `
import {
  COLLABORATION_VERSION,
  generateOrderKey,
  compareOrderKeys,
  createPresenceThrottler,
  isPresenceExpired,
  MAX_OFFLINE_BACKLOG_BYTES,
  MAX_PRESENCE_RATE_HZ,
  type CollaborationProvider,
  type CollaborationSession,
  type RemotePresence,
  type SessionStatus,
} from '@canvash/collaboration';

export const version: number = COLLABORATION_VERSION;
export const key: string = generateOrderKey(null, null);
export const maxBytes: number = MAX_OFFLINE_BACKLOG_BYTES;
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
  projectDir = mkdtempSync(join(tmpdir(), 'canvash-packaging-collaboration-'));

  const coreTarball = packedTarball(packs, '@canvash/core');
  const coreInstallDir = join(projectDir, 'node_modules', '@canvash', 'core');
  mkdirSync(coreInstallDir, { recursive: true });
  execFileSync('tar', ['-xzf', coreTarball, '-C', coreInstallDir, '--strip-components=1']);

  const packedDir = packDirOf(packs, '@canvash/collaboration');
  const tarballs = readdirSync(packedDir).filter((name) => name.endsWith('.tgz'));
  expect(tarballs).toHaveLength(1);
  const tarball = join(packedDir, String(tarballs[0]));

  tarballFiles = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((entry) => entry.replace(/^package\//, ''))
    .sort();

  const installDir = join(projectDir, 'node_modules', '@canvash', 'collaboration');
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

describe('@canvash/collaboration packaging contract', () => {
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
        join(projectDir, 'node_modules', '@canvash', 'collaboration', 'package.json'),
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

// --- Colaboração em rede (0.2.0): protocolo, codec e interface de transporte (US-P.8) ---

const NETWORK_SMOKE_BODY = `
const hello = {
  t: 'hello',
  v: PROTOCOL_VERSION,
  provider: 'yjs',
  documentId: 'doc',
  sessionId: 'sess',
  syncState: new Uint8Array([1, 2, 3]),
};
const viaText = decodeFrameFromText(encodeFrameAsText(encodeClientMessage(hello)));
const back = decodeClientMessage(viaText.value);
const refused = decodeServerMessage(new Uint8Array([0, 0, 0, 9]));
console.log(
  JSON.stringify({
    version: PROTOCOL_VERSION,
    maxFrame: DEFAULT_MAX_FRAME_BYTES,
    roundTrip: back.ok && back.value.t === 'hello' && back.value.syncState.length === 3,
    refused: !refused.ok && refused.error.code,
    codes: COLLABORATION_ERROR_CODES.includes('PROTOCOL_ERROR'),
  }),
);
`;

const NETWORK_NAMES =
  'PROTOCOL_VERSION, DEFAULT_MAX_FRAME_BYTES, COLLABORATION_ERROR_CODES, encodeClientMessage, ' +
  'decodeClientMessage, decodeServerMessage, encodeFrameAsText, decodeFrameFromText';

const NETWORK_TYPED_USAGE = `
import {
  DEFAULT_MAX_FRAME_BYTES,
  MAX_FRAME_HEADER_BYTES,
  PROTOCOL_VERSION,
  decodeFrameFromText,
  decodeServerMessage,
  encodeClientMessage,
  encodeFrameAsText,
  ok,
  type ClientMessage,
  type CollaborationSession,
  type CollaborationTransport,
  type ConnectOptions,
  type CreateTransport,
  type PendingSummary,
  type RoomAccess,
  type ServerMessage,
  type TransportInbound,
  type TransportState,
  type TransportWelcome,
} from '@canvash/collaboration';

// Um transporte escrito pelo host como objeto literal, sem classe base e sem cast.
export const createTransport: CreateTransport = () => {
  const state: TransportState = 'idle';
  const welcome: TransportWelcome = {
    roomEpoch: 'e1',
    access: 'write',
    missing: new Uint8Array(),
    serverSyncState: new Uint8Array(),
    serverTime: 0,
  };
  const transport: CollaborationTransport = {
    state,
    open: () => Promise.resolve(ok(welcome)),
    commit: (commitId, _update, roomEpoch) =>
      Promise.resolve(ok({ commitId, roomEpoch, timestamp: 0, durable: true })),
    sync: () => Promise.resolve(ok(new Uint8Array())),
    sendPresence() {},
    onInbound: (_listener: (message: TransportInbound) => void) => () => {},
    onStateChange: () => () => {},
    close() {},
  };
  return transport;
};

export function describeSession(session: CollaborationSession): string {
  const pending: PendingSummary = session.getPending();
  const access: RoomAccess = session.access;
  const offset: number = session.serverTimeOffsetMs;
  session.flushPresence();
  const stop = session.onPendingChange((summary) => summary.count + summary.bytes);
  stop();
  return access + pending.count + offset;
}

export const options: Pick<ConnectOptions, 'onStatusChange' | 'seedEmptyRoom' | 'receiptHistoryLimit'> = {
  onStatusChange: (status, error) => status + (error?.code ?? ''),
  seedEmptyRoom: false,
  receiptHistoryLimit: 100,
};

const message: ClientMessage = { t: 'bye' };
export const text: string = encodeFrameAsText(encodeClientMessage(message));
const frame = decodeFrameFromText(text, { maxFrameBytes: DEFAULT_MAX_FRAME_BYTES });
export const decoded: ServerMessage | undefined = frame.ok
  ? (() => {
      const result = decodeServerMessage(frame.value);
      return result.ok ? result.value : undefined;
    })()
  : undefined;
export const limits: number = PROTOCOL_VERSION + MAX_FRAME_HEADER_BYTES;
`;

describe('@canvash/collaboration: exports da colaboração em rede (US-P.8)', () => {
  const EXPECTED = {
    version: 1,
    maxFrame: 32 * 1024 * 1024,
    roundTrip: true,
    refused: 'PROTOCOL_ERROR',
    codes: true,
  };

  for (const bin of nodeBinaries) {
    it(`protocolo, codec e codificação em texto funcionam via ESM em ${bin}`, () => {
      const scriptPath = join(projectDir, 'network-import.mjs');
      writeFileSync(
        scriptPath,
        `import { ${NETWORK_NAMES} } from '@canvash/collaboration';\n${NETWORK_SMOKE_BODY}`,
        'utf8',
      );

      const result = spawnSync(bin, [scriptPath], { cwd: projectDir, encoding: 'utf8' });

      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout.trim())).toEqual(EXPECTED);
    });

    it(`protocolo, codec e codificação em texto funcionam via CJS em ${bin}`, () => {
      const scriptPath = join(projectDir, 'network-require.cjs');
      writeFileSync(
        scriptPath,
        `const { ${NETWORK_NAMES} } = require('@canvash/collaboration');\n${NETWORK_SMOKE_BODY}`,
        'utf8',
      );

      const result = spawnSync(bin, [scriptPath], { cwd: projectDir, encoding: 'utf8' });

      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout.trim())).toEqual(EXPECTED);
    });
  }

  for (const consumer of TYPE_CONSUMERS) {
    it(`a interface de transporte e os sinais da sessão compilam sob ${consumer.name}`, () => {
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
