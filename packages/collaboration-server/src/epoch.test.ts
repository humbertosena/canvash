import { createCollaborationError } from '@canvash/collaboration';
import {
  encodeCanvasDocumentAsYjsState,
  projectYDocToCanvasDocument,
} from '@canvash/collaboration-yjs';
import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createCollaborationServer } from './server.js';
import { createInstrumentedStorage } from './test-support/instrumented-storage.js';
import { createRecordingLogger } from './test-support/recording-logger.js';
import { TestClient, addRectangle, settle } from './test-support/test-client.js';

function setup() {
  const storage = createInstrumentedStorage();
  let epochs = 0;
  const server = createCollaborationServer({
    storage,
    logger: createRecordingLogger(),
    createEpoch: () => `epoch-${(epochs += 1)}`,
  });
  return { storage, server };
}

function rectangle(client: TestClient, id: string, x = 0): Uint8Array {
  return client.edit((doc) => addRectangle(doc, id, x));
}

function nodesOf(client: TestClient): string[] {
  return Object.keys(projectYDocToCanvasDocument(client.doc).nodes).sort();
}

describe('rotateEpoch (US-S.6, COLLAB-14, R13)', () => {
  it('derruba os conectados com ROOM_EPOCH_MISMATCH fatal, grava a epoch nova e devolve o valor dela', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    a.commit('commit-r1', rectangle(a, 'r1'));
    await settle();

    const rotated = await server.rotateEpoch('doc-1');

    expect(rotated).toEqual({ ok: true, value: 'epoch-2' });
    for (const client of [a, b]) {
      expect(client.of('error')).toEqual([
        expect.objectContaining({
          code: 'ROOM_EPOCH_MISMATCH',
          fatal: true,
          details: { serverEpoch: 'epoch-2' },
        }),
      ]);
      expect(client.connection.closed?.code).toBe(4000);
    }
    expect(storage.calls.reset).toBe(1);
    const stored = await storage.load('doc-1');
    expect(stored.ok && stored.value).toMatchObject({
      roomEpoch: 'epoch-2',
      log: [],
      receipts: [],
    });
    expect(server.getRoomStats('doc-1')).toBeUndefined();
  });

  it('o snapshot novo é o estado atual, e quem entra sem roomEpoch recebe a epoch nova com o conteúdo', async () => {
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    a.commit('commit-r1', rectangle(a, 'r1'));
    await settle();
    await server.rotateEpoch('doc-1');

    const fresh = await TestClient.join(server, { sessionId: 'novo' });

    expect(fresh.roomEpoch()).toBe('epoch-2');
    expect(nodesOf(fresh)).toEqual(['r1']);
    expect(fresh.doc.getMap('meta').get('roomEpoch')).toBe('epoch-2');
  });

  it('o cliente antigo que reconecta com a epoch velha recebe ROOM_EPOCH_MISMATCH no hello', async () => {
    const { server } = setup();
    await TestClient.join(server, { sessionId: 'a' });
    await server.rotateEpoch('doc-1');

    const back = TestClient.open(server, { sessionId: 'a', roomEpoch: 'epoch-1' });
    await settle();

    expect(back.of('error')).toEqual([
      expect.objectContaining({
        code: 'ROOM_EPOCH_MISMATCH',
        fatal: true,
        details: { clientEpoch: 'epoch-1', serverEpoch: 'epoch-2' },
      }),
    ]);
  });

  it('com um snapshot dado, a sala nova tem só o conteúdo dele', async () => {
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    a.commit('commit-r1', rectangle(a, 'r1'));
    await settle();
    const seeded = encodeCanvasDocumentAsYjsState({
      ...createCanvasSection().getSnapshot().document,
      id: 'desenho-novo',
    });
    if (!seeded.ok) throw new Error('a semeadura falhou');

    const rotated = await server.rotateEpoch('doc-1', { snapshot: seeded.value });

    expect(rotated.ok).toBe(true);
    const fresh = await TestClient.join(server, { sessionId: 'novo' });
    expect(nodesOf(fresh)).toEqual([]);
    expect(projectYDocToCanvasDocument(fresh.doc).id).toBe('desenho-novo');
  });

  it('um snapshot que não é estado Yjs: INVALID_DOCUMENT, sem reset e sem derrubar ninguém', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });

    const rotated = await server.rotateEpoch('doc-1', {
      snapshot: new Uint8Array([255, 255, 255, 255]),
    });

    expect(!rotated.ok && rotated.error.code).toBe('INVALID_DOCUMENT');
    expect(storage.calls.reset).toBe(0);
    expect(a.connection.closed).toBeUndefined();
    expect(a.of('error')).toEqual([]);
  });

  it('o commit em voo termina com recibo da epoch antiga antes de a troca derrubar o cliente', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const release = storage.hold('append');
    a.commit('commit-r1', rectangle(a, 'r1'));
    await settle();

    const rotation = server.rotateEpoch('doc-1');
    await settle();
    expect(storage.calls.reset).toBe(0);
    release();
    await rotation;

    expect(a.messages().map((message) => message.t)).toEqual(['welcome', 'ack', 'error']);
    expect(a.of('ack')[0]?.receipt.roomEpoch).toBe('epoch-1');
    const fresh = await TestClient.join(server, { sessionId: 'novo' });
    expect(nodesOf(fresh)).toEqual(['r1']);
  });

  it('um commit que chega durante a troca é recusado e não vai ao armazenamento', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    const release = storage.hold('reset');
    const rotation = server.rotateEpoch('doc-1');
    await settle();

    const id = b.commit('commit-tardio', rectangle(b, 'tardio'));
    await settle();
    release();
    await rotation;

    expect(storage.calls.append).toBe(0);
    const fresh = await TestClient.join(server, { sessionId: 'novo' });
    expect(nodesOf(fresh)).toEqual([]);
    expect(b.of('error').some((error) => error.id === id || error.fatal)).toBe(true);
    void a;
  });

  it('falha do reset devolve o erro e deixa tudo como estava', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    storage.failNext('reset', createCollaborationError('STORAGE_UNAVAILABLE', 'disco fora'));

    const rotated = await server.rotateEpoch('doc-1');

    expect(!rotated.ok && rotated.error.code).toBe('STORAGE_UNAVAILABLE');
    expect(a.connection.closed).toBeUndefined();
    expect(a.of('error')).toEqual([]);
    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 1 });
    a.commit('commit-r1', rectangle(a, 'r1'));
    await settle();
    expect(a.of('ack')).toHaveLength(1);
  });

  it('numa sala que não está carregada, troca a epoch da que existe; numa que não existe, NOT_FOUND', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    a.connection.drop();
    await server.rotateEpoch('doc-1');
    const missing = await server.rotateEpoch('nao-existe');

    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');
    expect(storage.calls.create).toBe(1);
    const stored = await storage.load('doc-1');
    expect(stored.ok && stored.value?.roomEpoch).toBe('epoch-2');
    const fresh = await TestClient.join(server, { sessionId: 'novo' });
    expect(fresh.roomEpoch()).toBe('epoch-2');
    expect(Y.encodeStateVector(fresh.doc).byteLength).toBeGreaterThan(0);
  });
});
