import { type CollaborationError } from '@canvash/collaboration';
import { describe, expect, it } from 'vitest';
import { createCollaborationServer } from './server.js';
import { createInstrumentedStorage } from './test-support/instrumented-storage.js';
import { createRecordingLogger } from './test-support/recording-logger.js';
import { TestClient, addRectangle, settle } from './test-support/test-client.js';

const REVOKED: CollaborationError = {
  code: 'UNAUTHORIZED',
  message: 'Seu acesso a este desenho foi revogado.',
  details: { motivo: 'revogado' },
};

function setup() {
  const storage = createInstrumentedStorage();
  const server = createCollaborationServer({
    storage,
    logger: createRecordingLogger(),
    createEpoch: () => 'epoch-1',
    // O acesso vem do cabeçalho `x-user`, para o teste dar uma identidade a cada sessão.
    authorize: (request) => ({
      allow: true,
      access: 'write',
      user: { id: request.headers.get('x-user') ?? 'anonimo' },
    }),
  });
  return { storage, server };
}

function join(
  server: ReturnType<typeof setup>['server'],
  sessionId: string,
  user: string,
  documentId = 'doc-1',
): Promise<TestClient> {
  return TestClient.join(server, {
    sessionId,
    documentId,
    request: { headers: new Headers({ 'x-user': user }) },
  });
}

function rectangle(client: TestClient, id: string, x = 0): Uint8Array {
  return client.edit((doc) => addRectangle(doc, id, x));
}

function nullsOf(client: TestClient): string[] {
  return client
    .of('presence')
    .filter((message) => message.state === null)
    .map((message) => message.from);
}

describe('disconnect (US-S.14, R13, P7)', () => {
  it('por userId: derruba as sessões dele com o erro dado, fatal, e os outros recebem o presence null delas', async () => {
    const { server } = setup();
    const a1 = await join(server, 'a1', 'u1');
    const a2 = await join(server, 'a2', 'u1');
    const b = await join(server, 'b', 'u2');
    a1.presence({ cursor: { x: 1, y: 1 } });
    a2.presence({ cursor: { x: 2, y: 2 } });

    const closed = await server.disconnect('doc-1', { userId: 'u1' }, REVOKED);

    expect(closed).toBe(2);
    for (const client of [a1, a2]) {
      expect(client.of('error')).toEqual([expect.objectContaining({ ...REVOKED, fatal: true })]);
      expect(client.connection.closed?.code).toBe(4000);
    }
    expect(b.connection.closed).toBeUndefined();
    expect(b.of('error')).toEqual([]);
    expect(nullsOf(b).sort()).toEqual(['a1', 'a2']);
    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 1 });
  });

  it('por sessionId: só aquela sessão', async () => {
    const { server } = setup();
    const a1 = await join(server, 'a1', 'u1');
    const a2 = await join(server, 'a2', 'u1');

    const closed = await server.disconnect('doc-1', { sessionId: 'a2' }, REVOKED);

    expect(closed).toBe(1);
    expect(a1.connection.closed).toBeUndefined();
    expect(a2.connection.closed?.code).toBe(4000);
  });

  it('com userId e sessionId, só a sessão que casa com os dois', async () => {
    const { server } = setup();
    const a1 = await join(server, 'a1', 'u1');
    const b1 = await join(server, 'b1', 'u2');

    const none = await server.disconnect('doc-1', { userId: 'u1', sessionId: 'b1' }, REVOKED);
    const one = await server.disconnect('doc-1', { userId: 'u2', sessionId: 'b1' }, REVOKED);

    expect(none).toBe(0);
    expect(one).toBe(1);
    expect(a1.connection.closed).toBeUndefined();
    expect(b1.connection.closed?.code).toBe(4000);
  });

  it('o userId é o autenticado, não o que a sessão declara na presença', async () => {
    const { server } = setup();
    const impostor = await join(server, 'x', 'u2');
    impostor.presence({ userId: 'u1' });

    const closed = await server.disconnect('doc-1', { userId: 'u1' }, REVOKED);

    expect(closed).toBe(0);
    expect(impostor.connection.closed).toBeUndefined();
  });

  it('filtro vazio derruba todos e a sala sai da memória; os dados ficam no armazenamento', async () => {
    const { storage, server } = setup();
    const a = await join(server, 'a', 'u1');
    const b = await join(server, 'b', 'u2');
    a.commit('commit-r1', rectangle(a, 'r1'));
    await settle();

    const closed = await server.disconnect('doc-1', {}, REVOKED);

    expect(closed).toBe(2);
    expect(a.connection.closed?.code).toBe(4000);
    expect(b.connection.closed?.code).toBe(4000);
    expect(server.getRoomStats('doc-1')).toBeUndefined();
    const stored = await storage.load('doc-1');
    expect(stored.ok && stored.value?.log.map((commit) => commit.commitId)).toEqual(['commit-r1']);
    const back = await join(server, 'c', 'u3');
    expect(Object.keys(back.doc.getMap('shapes').toJSON())).toEqual(['r1']);
  });

  it('só resolve depois de o último append em voo terminar, e o commit em voo sai com recibo', async () => {
    const { storage, server } = setup();
    const a = await join(server, 'a', 'u1');
    const release = storage.hold('append');
    a.commit('commit-r1', rectangle(a, 'r1'));
    await settle();

    let resolved = false;
    const disconnecting = server.disconnect('doc-1', {}, REVOKED).then((count) => {
      resolved = true;
      return count;
    });
    await settle();
    expect(resolved).toBe(false);
    expect(a.connection.closed).toBeUndefined();
    release();
    const closed = await disconnecting;

    expect(closed).toBe(1);
    expect(a.messages().map((message) => message.t)).toEqual(['welcome', 'ack', 'error']);
    expect(server.getRoomStats('doc-1')).toBeUndefined();
  });

  it('os commits já enfileirados terminam; o que a sessão expulsa manda depois é descartado', async () => {
    const { storage, server } = setup();
    const a = await join(server, 'a', 'u1');
    const b = await join(server, 'b', 'u2');
    const release = storage.hold('append');
    a.commit('commit-r1', rectangle(a, 'r1'));
    await settle();
    a.commit('commit-r2', rectangle(a, 'r2', 20));
    await settle();

    const disconnecting = server.disconnect('doc-1', { sessionId: 'a' }, REVOKED);
    a.commit('commit-tardio', rectangle(a, 'tardio', 40));
    release();
    await disconnecting;
    await settle();

    expect(a.of('ack').map((ack) => ack.receipt.commitId)).toEqual(['commit-r1', 'commit-r2']);
    expect(b.of('update').map((message) => message.commitId)).toEqual(['commit-r1', 'commit-r2']);
    const stored = await storage.load('doc-1');
    expect(stored.ok && stored.value?.log.map((commit) => commit.commitId)).toEqual([
      'commit-r1',
      'commit-r2',
    ]);
  });

  it('a presença que a sessão expulsa manda depois é descartada', async () => {
    const { storage, server } = setup();
    const a = await join(server, 'a', 'u1');
    const b = await join(server, 'b', 'u2');
    const release = storage.hold('append');
    a.commit('commit-r1', rectangle(a, 'r1'));
    await settle();

    const disconnecting = server.disconnect('doc-1', { sessionId: 'a' }, REVOKED);
    a.presence({ cursor: { x: 9, y: 9 } });
    release();
    await disconnecting;

    expect(b.of('presence').filter((message) => message.state !== null)).toEqual([]);
  });

  it('o erro dado vai ao cliente com código, mensagem e detalhes, como fatal', async () => {
    const { server } = setup();
    const a = await join(server, 'a', 'u1');

    await server.disconnect(
      'doc-1',
      { userId: 'u1' },
      {
        code: 'NOT_FOUND',
        message: 'O desenho foi excluído.',
      },
    );

    expect(a.of('error')).toEqual([
      { t: 'error', code: 'NOT_FOUND', message: 'O desenho foi excluído.', fatal: true },
    ]);
  });

  it('sala que não está carregada: resolve 0, sem carregar nada', async () => {
    const { storage, server } = setup();

    const closed = await server.disconnect('doc-1', {}, REVOKED);

    expect(closed).toBe(0);
    expect(storage.calls.load).toBe(0);
  });

  it('um filtro que não casa com ninguém resolve 0 e não mexe na sala', async () => {
    const { server } = setup();
    const a = await join(server, 'a', 'u1');

    const closed = await server.disconnect('doc-1', { userId: 'ninguem' }, REVOKED);

    expect(closed).toBe(0);
    expect(a.connection.closed).toBeUndefined();
    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 1 });
  });

  it('depois de derrubar todos, o compact que esperava na fila acha a sala outra vez, carregada do armazenamento', async () => {
    const { storage, server } = setup();
    const a = await join(server, 'a', 'u1');
    a.commit('commit-r1', rectangle(a, 'r1'));
    await settle();
    const release = storage.hold('append');
    a.commit('commit-r2', rectangle(a, 'r2', 20));
    await settle();

    const disconnecting = server.disconnect('doc-1', {}, REVOKED);
    const compacting = server.compact('doc-1');
    release();
    await disconnecting;
    const compacted = await compacting;

    expect(compacted.ok).toBe(true);
    const stored = await storage.load('doc-1');
    expect(stored.ok && stored.value?.log).toEqual([]);
  });
});
