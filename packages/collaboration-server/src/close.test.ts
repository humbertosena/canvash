import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCollaborationServer } from './server.js';
import { FakeConnection } from './test-support/fake-connection.js';
import { createInstrumentedStorage } from './test-support/instrumented-storage.js';
import { createRecordingLogger } from './test-support/recording-logger.js';
import { TestClient, addRectangle, settle } from './test-support/test-client.js';
import type { CollaborationServerOptions } from './types.js';

function setup(extra: Partial<CollaborationServerOptions> = {}) {
  const storage = createInstrumentedStorage();
  const server = createCollaborationServer({
    storage,
    logger: createRecordingLogger(),
    createEpoch: () => 'epoch-1',
    ...extra,
  });
  return { storage, server };
}

function rectangle(client: TestClient, id: string, x = 0): Uint8Array {
  return client.edit((doc) => addRectangle(doc, id, x));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('close (US-S.6, R13)', () => {
  it('espera o lote em voo: o commit sai com recibo, fica gravado, e depois os clientes fecham com 1001', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    const release = storage.hold('append');
    a.commit('commit-r1', rectangle(a, 'r1'));
    await settle();

    let closed = false;
    const closing = server.close().then(() => {
      closed = true;
    });
    await settle();
    expect(closed).toBe(false);
    expect(a.connection.closed).toBeUndefined();
    release();
    await closing;

    expect(a.of('ack')).toHaveLength(1);
    expect(b.of('update')).toHaveLength(1);
    expect(a.connection.closed?.code).toBe(1001);
    expect(b.connection.closed?.code).toBe(1001);
    const stored = await storage.load('doc-1');
    expect(stored.ok && stored.value?.log.map((commit) => commit.commitId)).toEqual(['commit-r1']);
    expect(server.getRoomStats('doc-1')).toBeUndefined();
  });

  it('chamado duas vezes, devolve a mesma promessa', async () => {
    const { server } = setup();
    await TestClient.join(server, { sessionId: 'a' });

    const first = server.close();
    const second = server.close();

    expect(second).toBe(first);
    await first;
    expect(server.close()).toBe(first);
  });

  it('depois de close, a conexão nova é fechada com 1001, sem mensagem e sem tocar o armazenamento', async () => {
    const { storage, server } = setup();
    await server.close();
    const loads = storage.calls.load;

    const late = TestClient.open(server, { sessionId: 'tardia' });
    await settle();

    expect(late.connection.closed?.code).toBe(1001);
    expect(late.messages()).toEqual([]);
    expect(storage.calls.load).toBe(loads);
  });

  it('fecha também a conexão que ainda não mandou o hello, sem deixar o prazo dela pendurado', async () => {
    vi.useFakeTimers();
    const { server } = setup({ helloTimeoutMs: 10_000 });
    const silent = new FakeConnection();
    server.handleConnection(silent, { headers: new Headers() });

    await server.close();

    expect(silent.closed?.code).toBe(1001);
    expect(silent.messages()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a conexão que ainda estava entrando na sala fecha com 1001, sem welcome', async () => {
    const { storage, server } = setup();
    const release = storage.hold('load');
    const joining = TestClient.open(server, { sessionId: 'a' });
    await settle();

    const closing = server.close();
    release();
    await closing;
    await settle();

    expect(joining.connection.closed?.code).toBe(1001);
    expect(joining.of('welcome')).toEqual([]);
  });

  it('um commit que chega depois de close() é descartado; o cliente o mantém pendente', async () => {
    const { storage, server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const release = storage.hold('append');
    a.commit('commit-r1', rectangle(a, 'r1'));
    await settle();

    const closing = server.close();
    a.commit('commit-tardio', rectangle(a, 'tardio', 40));
    release();
    await closing;

    expect(a.of('ack').map((ack) => ack.receipt.commitId)).toEqual(['commit-r1']);
    const stored = await storage.load('doc-1');
    expect(stored.ok && stored.value?.log.map((commit) => commit.commitId)).toEqual(['commit-r1']);
  });

  it('não deixa timer ligado: descarga por ociosidade e janelas de presença', async () => {
    vi.useFakeTimers();
    const { server } = setup({ roomIdleMs: 60_000 });
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    await vi.advanceTimersByTimeAsync(0);
    a.presence({ cursor: { x: 1, y: 1 } });
    a.presence({ cursor: { x: 2, y: 2 } });
    b.connection.drop();

    await server.close();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('num servidor sem salas, resolve', async () => {
    const { server } = setup();

    await expect(server.close()).resolves.toBeUndefined();
  });
});
