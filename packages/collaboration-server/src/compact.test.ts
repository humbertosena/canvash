import { createCollaborationError } from '@canvash/collaboration';
import { projectYDocToCanvasDocument } from '@canvash/collaboration-yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createCollaborationServer } from './server.js';
import { createInstrumentedStorage } from './test-support/instrumented-storage.js';
import { createRecordingLogger } from './test-support/recording-logger.js';
import { TestClient, addRectangle, settle } from './test-support/test-client.js';
import type { CollaborationServerOptions } from './types.js';

function setup(extra: Partial<CollaborationServerOptions> = {}) {
  const storage = createInstrumentedStorage();
  const logger = createRecordingLogger();
  let clock = 1_000;
  const server = createCollaborationServer({
    storage,
    logger,
    now: () => clock,
    createEpoch: () => 'epoch-1',
    ...extra,
  });
  return {
    storage,
    logger,
    server,
    setClock(value: number) {
      clock = value;
    },
  };
}

function rectangle(client: TestClient, id: string, x = 0): Uint8Array {
  return client.edit((doc) => addRectangle(doc, id, x));
}

async function commitAll(client: TestClient, labels: readonly string[]): Promise<void> {
  for (const [index, label] of labels.entries()) {
    client.commit(`commit-${label}`, rectangle(client, label, index * 20));
    await settle();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('compact (US-S.6, COLLAB-15, R13)', () => {
  it('grava o snapshot até o último commit e esvazia o log, sem mexer nos clientes', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    await commitAll(a, ['r1', 'r2', 'r3']);

    const compacted = await server.compact('doc-1');

    expect(compacted).toEqual({ ok: true, value: undefined });
    expect(storage.calls.compact).toBe(1);
    const stored = await storage.load('doc-1');
    expect(stored.ok && stored.value?.log).toEqual([]);
    if (!stored.ok || stored.value === null) throw new Error('sala perdida');
    const rebuilt = new Y.Doc();
    Y.applyUpdate(rebuilt, stored.value.snapshot);
    expect(Object.keys(projectYDocToCanvasDocument(rebuilt).nodes).sort()).toEqual([
      'r1',
      'r2',
      'r3',
    ]);
    expect(stored.value.receipts.map((receipt) => receipt.commitId)).toEqual([
      'commit-r1',
      'commit-r2',
      'commit-r3',
    ]);
    expect(a.connection.closed).toBeUndefined();
  });

  it('cliente antigo da mesma epoch reconecta depois da compactação, converge e recebe o mesmo recibo no reenvio', async () => {
    const { server } = setup();
    const old = await TestClient.join(server, { sessionId: 'velho' });
    const writer = await TestClient.join(server, { sessionId: 'a' });
    await commitAll(writer, ['r1', 'r2']);
    const updates = old.of('update').map((message) => message.update);
    old.connection.drop();
    await commitAll(writer, ['r3']);
    await server.compact('doc-1');
    const resend = writer.of('ack')[0]?.receipt;

    // O cliente velho volta com o que já tinha (só o r1 e o r2 da época em que estava conectado).
    const back = TestClient.open(server, { sessionId: 'velho', roomEpoch: 'epoch-1' });
    for (const update of updates) Y.applyUpdate(back.doc, update);
    back.connection.messages();
    await back.joined();
    const again = back.commit('commit-r1', Y.encodeStateAsUpdate(writer.doc));
    await settle();

    expect(Object.keys(projectYDocToCanvasDocument(back.doc).nodes).sort()).toEqual([
      'r1',
      'r2',
      'r3',
    ]);
    expect(back.of('ack')).toEqual([{ t: 'ack', id: again, receipt: resend }]);
  });

  it('o recibo continua valendo depois da descarga e do recarregamento da sala', async () => {
    vi.useFakeTimers();
    const { server } = setup({ roomIdleMs: 1_000 });
    const a = await TestClient.join(server, { sessionId: 'a' });
    await vi.advanceTimersByTimeAsync(0);
    a.commit('commit-r1', rectangle(a, 'r1'));
    await vi.advanceTimersByTimeAsync(0);
    const receipt = a.of('ack')[0]?.receipt;
    await server.compact('doc-1');
    a.connection.drop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.getRoomStats('doc-1')).toBeUndefined();

    const back = await TestClient.join(server, { sessionId: 'a' });
    await vi.advanceTimersByTimeAsync(0);
    const id = back.commit('commit-r1', Y.encodeStateAsUpdate(a.doc));
    await vi.advanceTimersByTimeAsync(0);

    expect(back.of('ack')).toEqual([{ t: 'ack', id, receipt }]);
  });

  it('entra na fila da sala: roda depois do lote em voo e o snapshot já o inclui', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const release = storage.hold('append');
    a.commit('commit-r1', rectangle(a, 'r1'));
    await settle();

    const compaction = server.compact('doc-1');
    await settle();
    expect(storage.calls.compact).toBe(0);
    release();
    await compaction;

    expect(storage.log.map((call) => call.method).filter((method) => method !== 'load')).toEqual([
      'create',
      'append',
      'compact',
    ]);
    const stored = await storage.load('doc-1');
    expect(stored.ok && stored.value?.log).toEqual([]);
    if (!stored.ok || stored.value === null) throw new Error('sala perdida');
    const rebuilt = new Y.Doc();
    Y.applyUpdate(rebuilt, stored.value.snapshot);
    expect(Object.keys(projectYDocToCanvasDocument(rebuilt).nodes)).toEqual(['r1']);
  });

  it('sem commit novo desde a última compactação, não chama o armazenamento', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    await commitAll(a, ['r1']);
    await server.compact('doc-1');

    const again = await server.compact('doc-1');

    expect(again.ok).toBe(true);
    expect(storage.calls.compact).toBe(1);
  });

  it('falha do armazenamento devolve o erro e mantém a sala; a nova tentativa funciona', async () => {
    const { storage, logger, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    await commitAll(a, ['r1']);
    storage.failNext(
      'compact',
      createCollaborationError('STORAGE_UNAVAILABLE', 'SEGREDO do banco'),
    );

    const failed = await server.compact('doc-1');
    const retried = await server.compact('doc-1');

    expect(!failed.ok && failed.error.code).toBe('STORAGE_UNAVAILABLE');
    expect(retried.ok).toBe(true);
    expect(storage.calls.compact).toBe(2);
    expect(logger.dump()).not.toContain('SEGREDO');
    a.commit('commit-r2', rectangle(a, 'r2', 30));
    await settle();
    expect(a.of('ack')).toHaveLength(2);
  });

  it('numa sala que não está carregada, lê a que existe no armazenamento e a deixa para a descarga', async () => {
    vi.useFakeTimers();
    const { storage, server } = setup({ roomIdleMs: 1_000 });
    const a = await TestClient.join(server, { sessionId: 'a' });
    await vi.advanceTimersByTimeAsync(0);
    a.commit('commit-r1', rectangle(a, 'r1'));
    await vi.advanceTimersByTimeAsync(0);
    a.connection.drop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.getRoomStats('doc-1')).toBeUndefined();

    const compacted = await server.compact('doc-1');

    expect(compacted.ok).toBe(true);
    const stored = await storage.load('doc-1');
    expect(stored.ok && stored.value?.log).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.getRoomStats('doc-1')).toBeUndefined();
  });

  it('numa sala que não existe: NOT_FOUND, sem criar nada', async () => {
    const { storage, server } = setup();

    const result = await server.compact('doc-que-nao-existe');

    expect(!result.ok && result.error.code).toBe('NOT_FOUND');
    expect(storage.calls.create).toBe(0);
    expect(server.getRoomStats('doc-que-nao-existe')).toBeUndefined();
  });
});

describe('retenção de recibos (P8, receiptRetentionMs)', () => {
  it('o recibo mais antigo que o limite sai na compactação; o reenvio não muda o documento e recebe recibo novo', async () => {
    const { storage, server, setClock } = setup({ receiptRetentionMs: 5_000 });
    const a = await TestClient.join(server, { sessionId: 'a' });
    setClock(1_000);
    a.commit('commit-velho', rectangle(a, 'r1'));
    await settle();
    setClock(9_000);
    a.commit('commit-novo', rectangle(a, 'r2', 30));
    await settle();
    const [oldReceipt, newReceipt] = a.of('ack').map((ack) => ack.receipt);
    setClock(10_000);

    await server.compact('doc-1');

    expect(server.getRoomStats('doc-1')).toMatchObject({ receipts: 1 });
    const stored = await storage.load('doc-1');
    expect(stored.ok && stored.value?.receipts.map((receipt) => receipt.commitId)).toEqual([
      'commit-novo',
    ]);
    const vectorBefore = Y.encodeStateVector(a.doc);
    setClock(11_000);
    const id = a.commit('commit-velho', Y.encodeStateAsUpdate(a.doc));
    await settle();
    const resent = a.of('ack').find((ack) => ack.id === id);
    expect(resent?.receipt).toEqual({
      commitId: 'commit-velho',
      roomEpoch: 'epoch-1',
      timestamp: 11_000,
      durable: true,
    });
    expect(resent?.receipt).not.toEqual(oldReceipt);
    expect(Y.encodeStateVector(a.doc)).toEqual(vectorBefore);
    const late = await TestClient.join(server, { sessionId: 'late' });
    expect(Object.keys(projectYDocToCanvasDocument(late.doc).nodes).sort()).toEqual(['r1', 'r2']);
    expect(a.of('ack').at(-1)?.receipt).not.toEqual(newReceipt);
  });

  it('sem receiptRetentionMs, nenhum recibo sai, por mais antigo que seja', async () => {
    const { server, setClock } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    setClock(1_000);
    await commitAll(a, ['r1']);
    setClock(10_000_000_000);

    await server.compact('doc-1');

    expect(server.getRoomStats('doc-1')).toMatchObject({ receipts: 1 });
  });

  it('com a retenção configurada e sem commit novo, a compactação ainda poda os recibos antigos', async () => {
    const { server, setClock } = setup({ receiptRetentionMs: 5_000 });
    const a = await TestClient.join(server, { sessionId: 'a' });
    setClock(1_000);
    await commitAll(a, ['r1']);
    await server.compact('doc-1');
    expect(server.getRoomStats('doc-1')).toMatchObject({ receipts: 1 });

    setClock(20_000);
    await server.compact('doc-1');

    expect(server.getRoomStats('doc-1')).toMatchObject({ receipts: 0 });
  });
});
