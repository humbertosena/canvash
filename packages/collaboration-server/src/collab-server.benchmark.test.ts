import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeCanvasDocumentAsYjsState } from '@canvash/collaboration-yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { createCollaborationServer } from './server.js';
import { createFileRoomStorage } from './storage-file.js';
import type { RoomStorage } from './storage.js';
import { benchmarkDocument, percentile } from './test-support/bench-scene.js';
import { FakeConnection } from './test-support/fake-connection.js';
import { createInstrumentedStorage } from './test-support/instrumented-storage.js';
import { createRecordingLogger } from './test-support/recording-logger.js';
import { addRectangle } from './test-support/test-client.js';
import * as Y from 'yjs';

// Medição, não gate (SPEC-collab-server, decisão 1): o tempo de ACK do servidor com validação por
// projeção a cada commit, em salas de 1.000 e de 10.000 nós. Sem `CANVASH_BENCH=1` roda uma
// escala pequena, só para provar que a medição funciona; com ela, a escala completa e o relatório.

const FULL = process.env.CANVASH_BENCH === '1';
const SIZES = FULL ? [1_000, 10_000] : [200];
const SAMPLES = FULL ? 40 : 6;
const STORAGE_DELAY_MS = 50;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Uma conexão falsa que avisa quando cada `ack` chega. */
class TimedConnection extends FakeConnection {
  private readonly waiters = new Map<number, () => void>();

  override send(frame: Uint8Array): void {
    super.send(frame);
    const decoded = this.messages().at(-1);
    if (decoded?.t === 'ack') this.waiters.get(decoded.id)?.();
  }

  ackOf(id: number): Promise<number> {
    const started = performance.now();
    return new Promise((resolve) => {
      this.waiters.set(id, () => resolve(performance.now() - started));
    });
  }
}

/** Armazenamento em que cada `append` leva `delayMs`, como um banco remoto. */
function slow(inner: RoomStorage, delayMs: number): RoomStorage {
  return {
    ...inner,
    load: (documentId) => inner.load(documentId),
    create: (documentId, room) => inner.create(documentId, room),
    compact: (documentId, snapshot, through, options) =>
      inner.compact(documentId, snapshot, through, options),
    reset: (documentId, room) => inner.reset(documentId, room),
    async append(documentId, batch) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return inner.append(documentId, batch);
    },
  };
}

interface Seeded {
  readonly server: ReturnType<typeof createCollaborationServer>;
  readonly storage: ReturnType<typeof createInstrumentedStorage>;
}

async function seededServer(nodes: number, delayMs = 0): Promise<Seeded> {
  const directory = await mkdtemp(join(tmpdir(), 'canvash-bench-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const base = createFileRoomStorage({ directory });
  const state = encodeCanvasDocumentAsYjsState(benchmarkDocument(nodes, 'doc-bench'));
  if (!state.ok) throw new Error('a semeadura falhou');
  await base.create('doc-bench', {
    provider: 'yjs',
    roomEpoch: 'epoch-bench',
    snapshot: state.value,
    log: [],
    receipts: [],
  });
  const storage = createInstrumentedStorage(delayMs > 0 ? slow(base, delayMs) : base);
  const server = createCollaborationServer({ storage, logger: createRecordingLogger() });
  cleanups.push(() => server.close());
  return { server, storage };
}

interface BenchClient {
  readonly connection: TimedConnection;
  readonly doc: Y.Doc;
  nextId: number;
  welcomeBytes: number;
}

async function joinBench(server: Seeded['server'], sessionId: string): Promise<BenchClient> {
  const connection = new TimedConnection();
  server.handleConnection(connection, { headers: new Headers() });
  connection.receive({
    t: 'hello',
    v: 1,
    provider: 'yjs',
    documentId: 'doc-bench',
    sessionId,
    syncState: new Uint8Array(),
  });
  const deadline = Date.now() + 30_000;
  while (connection.sent.length === 0) {
    if (Date.now() > deadline) throw new Error('o welcome não chegou');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const welcome = connection.messages()[0];
  if (welcome?.t !== 'welcome') throw new Error(`esperava welcome: ${JSON.stringify(welcome)}`);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, welcome.missing);
  return { connection, doc, nextId: 1, welcomeBytes: connection.sent[0]?.byteLength ?? 0 };
}

/** Um commit de uma forma nova, e o tempo até o ack dele. */
async function timedCommit(client: BenchClient, commitId: string): Promise<number> {
  const updates: Uint8Array[] = [];
  client.doc.on('update', (update: Uint8Array) => updates.push(update));
  client.doc.transact(() => addRectangle(client.doc, commitId, 0));
  const update = updates.at(-1);
  if (update === undefined) throw new Error('a edição não gerou update');
  const id = client.nextId;
  client.nextId += 1;
  const acked = client.connection.ackOf(id);
  client.connection.receive({ t: 'commit', id, commitId, roomEpoch: 'epoch-bench', update });
  return acked;
}

describe('ACK do servidor (medição, sem gate)', () => {
  it.each(SIZES)(
    'sala de %i nós, armazenamento em arquivo: ACK p50 e p95 e tamanho do welcome',
    async (nodes) => {
      const { server } = await seededServer(nodes);
      const client = await joinBench(server, 'a');

      const times: number[] = [];
      for (let index = 0; index < SAMPLES; index += 1) {
        times.push(await timedCommit(client, `solo-${nodes}-${index}`));
      }

      const result = {
        nodes,
        welcomeBytes: client.welcomeBytes,
        ackP50Ms: Number(percentile(times, 0.5).toFixed(2)),
        ackP95Ms: Number(percentile(times, 0.95).toFixed(2)),
      };
      console.log(`MEDIÇÃO ack-arquivo ${JSON.stringify(result)}`);
      expect(result.ackP95Ms).toBeGreaterThan(0);
      expect(result.welcomeBytes).toBeGreaterThan(nodes * 20);
    },
    300_000,
  );

  it.each(SIZES.flatMap((nodes) => [2, 10].map((clients) => [nodes, clients] as const)))(
    'sala de %i nós, gravação de 50 ms, %i clientes: ACK p50 e p95 e tamanho médio do lote',
    async (nodes, clients) => {
      const { server, storage } = await seededServer(nodes, STORAGE_DELAY_MS);
      const members = await Promise.all(
        Array.from({ length: clients }, (_unused, index) => joinBench(server, `c${index}`)),
      );
      const appendsBefore = storage.calls.append;
      const perClient = Math.max(3, Math.floor(SAMPLES / 2));

      const timesPerClient = await Promise.all(
        members.map(async (member, memberIndex) => {
          const times: number[] = [];
          for (let index = 0; index < perClient; index += 1) {
            times.push(
              await timedCommit(member, `par-${nodes}-${clients}-${memberIndex}-${index}`),
            );
          }
          return times;
        }),
      );

      const times = timesPerClient.flat();
      const appends = storage.calls.append - appendsBefore;
      const result = {
        nodes,
        clients,
        commits: times.length,
        appends,
        meanBatch: Number((times.length / appends).toFixed(2)),
        ackP50Ms: Number(percentile(times, 0.5).toFixed(2)),
        ackP95Ms: Number(percentile(times, 0.95).toFixed(2)),
      };
      console.log(`MEDIÇÃO ack-lote ${JSON.stringify(result)}`);
      expect(result.appends).toBeGreaterThan(0);
      expect(result.meanBatch).toBeGreaterThanOrEqual(1);
    },
    300_000,
  );
});
