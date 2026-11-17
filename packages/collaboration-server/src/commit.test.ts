import { createCollaborationError, type CommitReceipt } from '@canvash/collaboration';
import {
  encodeCanvasDocumentAsYjsState,
  projectYjsStateToCanvasDocument,
  projectYDocToCanvasDocument,
} from '@canvash/collaboration-yjs';
import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createCollaborationServer } from './server.js';
import { createInstrumentedStorage } from './test-support/instrumented-storage.js';
import { createRecordingLogger } from './test-support/recording-logger.js';
import {
  GARBAGE_UPDATE,
  TestClient,
  addBrokenShape,
  addRectangle,
  settle,
} from './test-support/test-client.js';
import type { CollaborationServerOptions } from './types.js';

function setup(extra: Partial<CollaborationServerOptions> = {}) {
  const storage = createInstrumentedStorage();
  const logger = createRecordingLogger();
  let clock = 1_000;
  const server = createCollaborationServer({
    storage,
    logger,
    now: () => (clock += 10),
    createEpoch: () => 'epoch-1',
    ...extra,
  });
  return { storage, logger, server };
}

/** O que cada sessão mandaria: um update por forma nova. */
function rectangle(client: TestClient, id: string, x = 0): Uint8Array {
  return client.edit((doc) => addRectangle(doc, id, x));
}

/** Um update de forma nova, de um documento que ainda não conhece a sala. */
function standaloneRectangle(id: string): Uint8Array {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => updates.push(update));
  addRectangle(doc, id);
  const [first] = updates;
  if (first === undefined) throw new Error('a forma não gerou update');
  return first;
}

function ackIds(client: TestClient): string[] {
  return client.of('ack').map((ack) => ack.receipt.commitId);
}

describe('commit simples (US-S.3)', () => {
  it('o remetente recebe o ack com o recibo, e os outros recebem o update com o from carimbado', async () => {
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    const update = rectangle(a, 'r1');

    const id = a.commit('commit-1', update);
    await settle();

    expect(a.of('ack')).toEqual([
      {
        t: 'ack',
        id,
        receipt: { commitId: 'commit-1', roomEpoch: 'epoch-1', timestamp: 1_030, durable: true },
      },
    ]);
    expect(a.of('update')).toEqual([]);
    expect(b.of('update')).toHaveLength(1);
    expect(b.of('update')[0]).toMatchObject({ commitId: 'commit-1', from: 'a' });
    expect([...(b.of('update')[0]?.update ?? [])]).toEqual([...update]);
    expect(b.of('ack')).toEqual([]);
  });

  it('o commit chega ao armazenamento, que guarda o update e o recibo, e à sala', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    a.commit('commit-1', rectangle(a, 'r1'));
    await settle();

    const stored = await storage.load('doc-1');
    expect(stored.ok && stored.value?.log.map((commit) => commit.commitId)).toEqual(['commit-1']);
    expect(stored.ok && stored.value?.log[0]?.receipt).toEqual({
      commitId: 'commit-1',
      roomEpoch: 'epoch-1',
      timestamp: 1_020,
      durable: true,
    });
    const late = await TestClient.join(server, { sessionId: 'late' });
    expect(Object.keys(projectYDocToCanvasDocument(late.doc).nodes)).toEqual(['r1']);
    expect(server.getRoomStats('doc-1')).toMatchObject({ receipts: 1 });
  });

  it('nenhum ack sai antes de o append terminar', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    const release = storage.hold('append');

    a.commit('commit-1', rectangle(a, 'r1'));
    await settle();
    expect(a.of('ack')).toEqual([]);
    expect(b.of('update')).toEqual([]);
    release();
    await settle();

    expect(ackIds(a)).toEqual(['commit-1']);
    expect(b.of('update')).toHaveLength(1);
  });

  it('duas sessões commitando ao mesmo tempo convergem e cada uma recebe só o update da outra', async () => {
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    const fromA = rectangle(a, 'ra');
    const fromB = rectangle(b, 'rb', 50);

    a.commit('commit-a', fromA);
    b.commit('commit-b', fromB);
    await settle();
    for (const message of a.of('update')) Y.applyUpdate(a.doc, message.update);
    for (const message of b.of('update')) Y.applyUpdate(b.doc, message.update);

    expect(a.of('update').map((message) => message.commitId)).toEqual(['commit-b']);
    expect(b.of('update').map((message) => message.commitId)).toEqual(['commit-a']);
    expect(Object.keys(projectYDocToCanvasDocument(a.doc).nodes).sort()).toEqual(['ra', 'rb']);
    expect([...Y.encodeStateVector(a.doc)]).toEqual([...Y.encodeStateVector(b.doc)]);
  });

  it('um commit enviado enquanto a sala carregava é processado depois do welcome', async () => {
    const { storage, server } = setup();
    const release = storage.hold('load');
    const a = TestClient.open(server, { sessionId: 'a' });
    const update = standaloneRectangle('r1');
    a.commit('commit-1', update, 'epoch-1');

    release();
    await settle();

    expect(a.messages().map((message) => message.t)).toEqual(['welcome', 'ack']);
  });
});

describe('recusas na chegada (US-S.3, R19)', () => {
  it('acesso read: UNAUTHORIZED não fatal, com o id, sem tocar armazenamento nem repassar', async () => {
    const { storage, server } = setup({
      authorize: (request) => ({
        allow: true,
        access: request.sessionId === 'leitor' ? 'read' : 'write',
      }),
    });
    const reader = await TestClient.join(server, { sessionId: 'leitor' });
    const writer = await TestClient.join(server, { sessionId: 'escritor' });

    const id = reader.commit('commit-1', rectangle(reader, 'r1'));
    await settle();

    expect(reader.of('error')).toEqual([
      expect.objectContaining({ id, code: 'UNAUTHORIZED', fatal: false }),
    ]);
    expect(reader.connection.closed).toBeUndefined();
    expect(storage.calls.append).toBe(0);
    expect(writer.of('update')).toEqual([]);
  });

  it('roomEpoch diferente: ROOM_EPOCH_MISMATCH não fatal, com o id', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });

    const id = a.commit('commit-1', rectangle(a, 'r1'), 'epoch-antiga');
    await settle();

    expect(a.of('error')).toEqual([
      expect.objectContaining({ id, code: 'ROOM_EPOCH_MISMATCH', fatal: false }),
    ]);
    expect(a.connection.closed).toBeUndefined();
    expect(storage.calls.append).toBe(0);
  });
});

describe('commitId repetido (US-S.4, COLLAB-13)', () => {
  it('reenviar um commit confirmado devolve o mesmo recibo, sem gravar nem repassar de novo', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    const update = rectangle(a, 'r1');
    a.commit('commit-1', update);
    await settle();
    const [original] = a.of('ack');

    const again = a.commit('commit-1', update);
    await settle();

    const acks = a.of('ack');
    expect(acks).toHaveLength(2);
    expect(acks[1]).toEqual({ t: 'ack', id: again, receipt: original?.receipt });
    expect(storage.calls.append).toBe(1);
    expect(b.of('update')).toHaveLength(1);
    const stored = await storage.load('doc-1');
    expect(stored.ok && stored.value?.log).toHaveLength(1);
  });

  it('o reenvio vindo de outra conexão da mesma sessão recebe o mesmo recibo', async () => {
    const { server } = setup();
    const first = await TestClient.join(server, { sessionId: 'a' });
    const update = rectangle(first, 'r1');
    first.commit('commit-1', update);
    await settle();
    const second = await TestClient.join(server, { sessionId: 'a' });

    second.commit('commit-1', update);
    await settle();

    expect(second.of('ack')[0]?.receipt).toEqual(first.of('ack')[0]?.receipt);
  });

  it('o mesmo commitId duas vezes no mesmo lote entra uma vez só e os dois recebem o mesmo ack', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    const release = storage.hold('append');
    a.commit('commit-0', rectangle(a, 'r0'));
    await settle();
    const update = rectangle(a, 'r1');
    const first = a.commit('commit-1', update);
    const second = a.commit('commit-1', update);

    release();
    await settle();

    const acks = a.of('ack');
    expect(acks.map((ack) => ack.id)).toEqual([1, first, second]);
    expect(acks[1]?.receipt).toEqual(acks[2]?.receipt);
    expect(storage.batches.map((batch) => batch.commits.map((commit) => commit.commitId))).toEqual([
      ['commit-0'],
      ['commit-1'],
    ]);
    expect(b.of('update').map((message) => message.commitId)).toEqual(['commit-0', 'commit-1']);
  });

  it('um reenvio que chega durante o append do original espera e recebe o recibo dele', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const update = rectangle(a, 'r1');
    const release = storage.hold('append');
    a.commit('commit-1', update);
    await settle();

    const retry = a.commit('commit-1', update);
    release();
    await settle();

    expect(a.of('ack').map((ack) => ack.id)).toContain(retry);
    expect(a.of('ack')[0]?.receipt).toEqual(a.of('ack')[1]?.receipt);
    expect(storage.calls.append).toBe(1);
  });
});

describe('lote (US-S.3, US-S.16, P4, P5)', () => {
  it('três commits que chegam durante a gravação saem num só append e recebem ack juntos, na ordem', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    const release = storage.hold('append');
    a.commit('commit-0', rectangle(a, 'r0'));
    await settle();

    a.commit('commit-1', rectangle(a, 'r1'));
    a.commit('commit-2', rectangle(a, 'r2'));
    a.commit('commit-3', rectangle(a, 'r3'));
    await settle();
    expect(a.of('ack')).toEqual([]);
    release();
    await settle();

    expect(storage.calls.append).toBe(2);
    expect(storage.batches.map((batch) => batch.commits.map((commit) => commit.commitId))).toEqual([
      ['commit-0'],
      ['commit-1', 'commit-2', 'commit-3'],
    ]);
    expect(ackIds(a)).toEqual(['commit-0', 'commit-1', 'commit-2', 'commit-3']);
    expect(b.of('update').map((message) => message.commitId)).toEqual([
      'commit-0',
      'commit-1',
      'commit-2',
      'commit-3',
    ]);
  });

  it('um lote tem no máximo maxBatchCommits commits; o resto vai no seguinte', async () => {
    const { storage, server } = setup({ maxBatchCommits: 2 });
    const a = await TestClient.join(server, { sessionId: 'a' });
    const release = storage.hold('append');
    a.commit('commit-0', rectangle(a, 'r0'));
    await settle();
    for (const label of ['1', '2', '3', '4', '5'])
      a.commit(`commit-${label}`, rectangle(a, `r${label}`));

    release();
    await settle();

    expect(storage.batches.map((batch) => batch.commits.length)).toEqual([1, 2, 2, 1]);
    expect(ackIds(a)).toEqual(['0', '1', '2', '3', '4', '5'].map((label) => `commit-${label}`));
  });

  it('o documento do lote traz o id original e encodeSnapshot reproduz a sala depois do lote', async () => {
    const section = createCanvasSection();
    const seeded = encodeCanvasDocumentAsYjsState({
      ...section.getSnapshot().document,
      id: 'desenho-42',
    });
    if (!seeded.ok) throw new Error('a semeadura falhou');
    const { storage, server } = setup();
    await storage.create('desenho-42', {
      provider: 'yjs',
      roomEpoch: 'epoch-semeada',
      snapshot: seeded.value,
      log: [],
      receipts: [],
    });
    const a = await TestClient.join(server, { sessionId: 'a', documentId: 'desenho-42' });
    a.commit('commit-1', rectangle(a, 'r1'));
    a.commit('commit-2', rectangle(a, 'r2', 30));
    await settle();

    const batches = storage.batches;
    const last = batches.at(-1);
    if (last === undefined) throw new Error('nenhum lote gravado');
    expect(last.document.id).toBe('desenho-42');
    expect(Object.keys(last.document.nodes).sort()).toEqual(['r1', 'r2']);
    const snapshot = projectYjsStateToCanvasDocument(last.encodeSnapshot());
    if (!snapshot.ok) throw new Error('a projeção do snapshot falhou');
    expect(snapshot.value).toEqual(last.document);
  });

  it('salas diferentes não se bloqueiam: o append preso de uma não segura a outra', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a', documentId: 'doc-1' });
    const b = await TestClient.join(server, { sessionId: 'b', documentId: 'doc-2' });
    const release = storage.hold('append', 'doc-1');

    a.commit('commit-1', rectangle(a, 'r1'));
    b.commit('commit-2', rectangle(b, 'r2'));
    await settle();

    expect(ackIds(b)).toEqual(['commit-2']);
    expect(a.of('ack')).toEqual([]);
    release();
    await settle();
    expect(ackIds(a)).toEqual(['commit-1']);
  });
});

describe('commit inválido (US-S.5, R10)', () => {
  it('bytes que não são um update: INVALID_DOCUMENT não fatal; o resto do lote é confirmado', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    const release = storage.hold('append');
    a.commit('commit-0', rectangle(a, 'r0'));
    await settle();

    a.commit('commit-1', rectangle(a, 'r1'));
    const bad = a.commit('commit-2', GARBAGE_UPDATE);
    a.commit('commit-3', rectangle(a, 'r3', 20));
    release();
    await settle();

    expect(a.of('error')).toEqual([
      expect.objectContaining({ id: bad, code: 'INVALID_DOCUMENT', fatal: false }),
    ]);
    expect(ackIds(a)).toEqual(['commit-0', 'commit-1', 'commit-3']);
    expect(storage.batches[1]?.commits.map((commit) => commit.commitId)).toEqual([
      'commit-1',
      'commit-3',
    ]);
    expect(b.of('update').map((message) => message.commitId)).toEqual([
      'commit-0',
      'commit-1',
      'commit-3',
    ]);
    const late = await TestClient.join(server, { sessionId: 'late' });
    expect(Object.keys(projectYDocToCanvasDocument(late.doc).nodes).sort()).toEqual([
      'r0',
      'r1',
      'r3',
    ]);
  });

  it('update que aplica mas não projeta em documento: INVALID_DOCUMENT, sem efeito nos seguintes', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const release = storage.hold('append');
    a.commit('commit-0', rectangle(a, 'r0'));
    await settle();
    const scratch = await TestClient.join(server, { sessionId: 'scratch' });
    const brokenUpdate = scratch.edit((doc) => addBrokenShape(doc, 'quebrada'));

    a.commit('commit-1', rectangle(a, 'r1'));
    const bad = a.commit('commit-2', brokenUpdate);
    a.commit('commit-3', rectangle(a, 'r3', 20));
    release();
    await settle();

    expect(a.of('error')).toEqual([
      expect.objectContaining({ id: bad, code: 'INVALID_DOCUMENT', fatal: false }),
    ]);
    expect(ackIds(a)).toEqual(['commit-0', 'commit-1', 'commit-3']);
    expect(storage.batches.at(-1)?.commits.map((commit) => commit.commitId)).toEqual([
      'commit-1',
      'commit-3',
    ]);
  });

  it('o commit inválido sozinho não grava nada', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });

    a.commit('commit-1', GARBAGE_UPDATE);
    await settle();

    expect(storage.calls.append).toBe(0);
    expect(a.of('error')).toHaveLength(1);
    expect(a.connection.closed).toBeUndefined();
  });
});

describe('falha do armazenamento (US-S.3, P4)', () => {
  it('STORAGE_UNAVAILABLE não fatal para cada commit do lote, sem aplicar nem repassar; o reenvio funciona', async () => {
    const { storage, logger, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    const release = storage.hold('append');
    a.commit('commit-0', rectangle(a, 'r0'));
    await settle();
    const first = rectangle(a, 'r1');
    const second = rectangle(a, 'r2', 20);
    const idFirst = a.commit('commit-1', first);
    const idSecond = a.commit('commit-2', second);
    release();
    await settle();
    const before = b.of('update').length;
    storage.failNext(
      'append',
      createCollaborationError('STORAGE_UNAVAILABLE', 'SEGREDO: senha do banco 1234'),
    );
    const retryFirst = a.commit('commit-4', rectangle(a, 'r4', 40));
    const retrySecond = a.commit('commit-5', rectangle(a, 'r5', 60));
    await settle();

    const errors = a.of('error');
    expect(errors.map((error) => [error.id, error.code, error.fatal])).toEqual([
      [retryFirst, 'STORAGE_UNAVAILABLE', false],
      [retrySecond, 'STORAGE_UNAVAILABLE', false],
    ]);
    expect(JSON.stringify(errors)).not.toContain('SEGREDO');
    expect(logger.dump()).not.toContain('SEGREDO');
    expect(b.of('update')).toHaveLength(before);
    expect(a.connection.closed).toBeUndefined();
    expect(idFirst).toBeLessThan(idSecond);

    const resend = a.commit('commit-4', rectangle(a, 'r4', 40));
    await settle();
    expect(a.of('ack').map((ack) => ack.id)).toContain(resend);
    expect(ackIds(a)).toContain('commit-4');
    expect(ackIds(a)).not.toContain('commit-5');
  });

  it('a sala não guarda o que não foi gravado: quem entra depois não vê o commit que falhou', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    storage.failNext('append', createCollaborationError('STORAGE_UNAVAILABLE', 'disco cheio'));

    a.commit('commit-1', rectangle(a, 'r1'));
    await settle();

    const late = await TestClient.join(server, { sessionId: 'late' });
    expect(projectYDocToCanvasDocument(late.doc).nodes).toEqual({});
    expect(server.getRoomStats('doc-1')).toMatchObject({ receipts: 0 });
  });
});

describe('conexão que sai antes do ack', () => {
  it('o commit confirmado fica gravado e o reenvio por outra conexão recebe o recibo', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const release = storage.hold('append');
    const update = rectangle(a, 'r1');
    a.commit('commit-1', update);
    await settle();

    a.connection.drop();
    release();
    await settle();
    const back = await TestClient.join(server, { sessionId: 'a' });
    back.commit('commit-1', update);
    await settle();

    expect(storage.calls.append).toBe(1);
    expect(ackIds(back)).toEqual(['commit-1']);
  });

  it('a descarga por ociosidade espera o lote em voo terminar', async () => {
    const { storage, server } = setup({ roomIdleMs: 0 });
    const a = await TestClient.join(server, { sessionId: 'a' });
    const release = storage.hold('append');
    a.commit('commit-1', rectangle(a, 'r1'));
    await settle();

    a.connection.drop();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(server.getRoomStats('doc-1')).toBeDefined();
    release();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(server.getRoomStats('doc-1')).toBeUndefined();
    const stored = await storage.load('doc-1');
    expect(stored.ok && stored.value?.log).toHaveLength(1);
  });
});

describe('o recibo', () => {
  it('leva o timestamp do relógio do servidor e a epoch da sala', async () => {
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });

    a.commit('commit-1', rectangle(a, 'r1'));
    await settle();

    const receipt: CommitReceipt | undefined = a.of('ack')[0]?.receipt;
    expect(receipt).toEqual({
      commitId: 'commit-1',
      roomEpoch: 'epoch-1',
      timestamp: expect.any(Number),
      durable: true,
    });
  });
});

describe('a cópia de validação acompanha a sala (ACK dentro do gatilho)', () => {
  it('muitos commits em sequência: o snapshot de cada lote é exatamente a sala naquele momento', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });

    for (let index = 0; index < 12; index += 1) {
      a.commit(`commit-${index}`, rectangle(a, `r${index}`, index * 20));
      await settle();
    }

    const last = storage.batches.at(-1);
    if (last === undefined) throw new Error('nenhum lote gravado');
    const snapshot = new Y.Doc();
    Y.applyUpdate(snapshot, last.encodeSnapshot());
    const late = await TestClient.join(server, { sessionId: 'late' });
    expect(Y.encodeStateVector(snapshot)).toEqual(Y.encodeStateVector(late.doc));
    expect(Object.keys(projectYDocToCanvasDocument(late.doc).nodes)).toHaveLength(12);
  });

  it('depois de uma falha de gravação, o commit que falhou não volta no documento nem no snapshot do lote seguinte', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    storage.failNext('append', createCollaborationError('STORAGE_UNAVAILABLE', 'disco fora'));
    a.commit('commit-falho', rectangle(a, 'falho', 0));
    await settle();

    // Outra sessão, que não conhece o `falho`: se a cópia de validação o guardasse, ele apareceria.
    b.commit('commit-bom', rectangle(b, 'bom', 40));
    await settle();

    const last = storage.batches.at(-1);
    if (last === undefined) throw new Error('nenhum lote gravado');
    expect(Object.keys(last.document.nodes)).toEqual(['bom']);
    const snapshot = new Y.Doc();
    Y.applyUpdate(snapshot, last.encodeSnapshot());
    expect(Object.keys(projectYDocToCanvasDocument(snapshot).nodes)).toEqual(['bom']);
  });

  it('com um commit inválido no meio, o snapshot do lote traz os válidos e só eles', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const release = storage.hold('append');
    a.commit('commit-0', rectangle(a, 'r0'));
    await settle();

    a.commit('commit-1', rectangle(a, 'r1', 20));
    a.commit('commit-ruim', GARBAGE_UPDATE);
    a.commit('commit-3', rectangle(a, 'r3', 40));
    release();
    await settle();

    const batch = storage.batches[1];
    if (batch === undefined) throw new Error('faltou o segundo lote');
    const snapshot = new Y.Doc();
    Y.applyUpdate(snapshot, batch.encodeSnapshot());
    expect(Object.keys(projectYDocToCanvasDocument(snapshot).nodes).sort()).toEqual([
      'r0',
      'r1',
      'r3',
    ]);
    a.commit('commit-4', rectangle(a, 'r4', 60));
    await settle();
    const next = storage.batches.at(-1);
    expect(Object.keys(next?.document.nodes ?? {}).sort()).toEqual(['r0', 'r1', 'r3', 'r4']);
  });
});
