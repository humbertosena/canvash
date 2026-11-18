import { type ClientMessage, type ServerMessage } from '@canvash/collaboration';
import {
  encodeCanvasDocumentAsYjsState,
  projectYjsStateToCanvasDocument,
} from '@canvash/collaboration-yjs';
import { createCanvasSection, validateDocument, type CanvasDocument } from '@canvash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createCollaborationServer } from './server.js';
import { FakeConnection } from './test-support/fake-connection.js';
import { createInstrumentedStorage } from './test-support/instrumented-storage.js';
import { createRecordingLogger } from './test-support/recording-logger.js';
import type { CollaborationServerOptions, ConnectionRequest } from './types.js';

type Hello = Extract<ClientMessage, { t: 'hello' }>;

const REQUEST: ConnectionRequest = { headers: new Headers() };

function hello(overrides: Partial<Hello> = {}): Hello {
  return {
    t: 'hello',
    v: 1,
    provider: 'yjs',
    documentId: 'doc-1',
    sessionId: 'sessao-a',
    syncState: new Uint8Array(),
    ...overrides,
  };
}

function setup(extra: Partial<CollaborationServerOptions> = {}) {
  const storage = createInstrumentedStorage();
  const logger = createRecordingLogger();
  let epochs = 0;
  const server = createCollaborationServer({
    storage,
    logger,
    createEpoch: () => `epoch-${(epochs += 1)}`,
    ...extra,
  });
  return { storage, logger, server };
}

function connect(server: ReturnType<typeof setup>['server'], overrides: Partial<Hello> = {}) {
  const connection = new FakeConnection();
  server.handleConnection(connection, REQUEST);
  connection.receive(hello(overrides));
  return connection;
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

function only<T extends ServerMessage['t']>(
  connection: FakeConnection,
  type: T,
): Extract<ServerMessage, { t: T }> {
  const found = connection.messages().find((message) => message.t === type);
  if (found === undefined) throw new Error(`o servidor não mandou "${type}"`);
  return found as Extract<ServerMessage, { t: T }>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('salas sob demanda (US-S.13, R12)', () => {
  it('criar o servidor não toca o armazenamento', () => {
    const { storage } = setup();

    expect(storage.log).toEqual([]);
  });

  it('a primeira conexão carrega a sala uma vez; as simultâneas esperam a mesma carga', async () => {
    const { storage, server } = setup();

    const connections = ['a', 'b', 'c'].map((sessionId) => connect(server, { sessionId }));
    await settle();

    expect(storage.calls.load).toBe(1);
    expect(storage.calls.create).toBe(1);
    const epochs = connections.map((connection) => only(connection, 'welcome').roomEpoch);
    expect(new Set(epochs)).toEqual(new Set(['epoch-1']));
    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 3 });
  });

  it('cada documentId é uma sala, carregada na primeira conexão dela', async () => {
    const { storage, server } = setup();

    connect(server, { documentId: 'doc-1' });
    connect(server, { documentId: 'doc-2', sessionId: 'b' });
    await settle();

    expect(
      storage.log.filter((call) => call.method === 'load').map((call) => call.documentId),
    ).toEqual(['doc-1', 'doc-2']);
    expect(server.getRoomStats('doc-3')).toBeUndefined();
  });

  it('getRoomStats conta os clientes e os recibos guardados', async () => {
    const { storage, server } = setup();
    const doc = new Y.Doc();
    doc.getMap('meta').set('roomEpoch', 'epoch-guardada');
    await storage.create('doc-1', {
      provider: 'yjs',
      roomEpoch: 'epoch-guardada',
      snapshot: Y.encodeStateAsUpdate(doc),
      log: [],
      receipts: [
        { commitId: 'c1', roomEpoch: 'epoch-guardada', timestamp: 1, durable: true },
        { commitId: 'c2', roomEpoch: 'epoch-guardada', timestamp: 2, durable: true },
      ],
    });

    connect(server);
    await settle();

    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 1, receipts: 2 });
  });
});

describe('descarga da sala ociosa (R12)', () => {
  it('sem clientes por roomIdleMs, a sala sai da memória sem gravar nada, e a próxima conexão a relê', async () => {
    vi.useFakeTimers();
    const { storage, server } = setup({ roomIdleMs: 5_000 });
    const first = connect(server);
    await vi.advanceTimersByTimeAsync(0);
    const epoch = only(first, 'welcome').roomEpoch;
    first.drop();
    const writesBefore = storage.calls.append + storage.calls.compact + storage.calls.reset;

    await vi.advanceTimersByTimeAsync(4_999);
    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 0, receipts: 0 });
    await vi.advanceTimersByTimeAsync(1);

    expect(server.getRoomStats('doc-1')).toBeUndefined();
    expect(storage.calls.append + storage.calls.compact + storage.calls.reset).toBe(writesBefore);
    const again = connect(server);
    await vi.advanceTimersByTimeAsync(0);
    expect(only(again, 'welcome').roomEpoch).toBe(epoch);
    expect(storage.calls.load).toBe(2);
    expect(storage.calls.create).toBe(1);
  });

  it('uma conexão que chega antes do prazo cancela a descarga', async () => {
    vi.useFakeTimers();
    const { storage, server } = setup({ roomIdleMs: 5_000 });
    const first = connect(server);
    await vi.advanceTimersByTimeAsync(0);
    first.drop();
    await vi.advanceTimersByTimeAsync(4_000);

    const second = connect(server, { sessionId: 'b' });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 1 });
    expect(second.closed).toBeUndefined();
    expect(storage.calls.load).toBe(1);
  });

  it('a sala que ninguém chegou a entrar (epoch errada) também sai depois do prazo', async () => {
    vi.useFakeTimers();
    const { server } = setup({ roomIdleMs: 5_000 });
    const refused = connect(server, { roomEpoch: 'epoch-que-nao-existe' });
    await vi.advanceTimersByTimeAsync(0);
    expect(refused.closed?.code).toBe(4000);
    expect(server.getRoomStats('doc-1')).toBeDefined();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(server.getRoomStats('doc-1')).toBeUndefined();
  });

  it('a conexão que cai enquanto a sala carrega deixa a sala para descarregar, sem cliente', async () => {
    vi.useFakeTimers();
    const { storage, server } = setup({ roomIdleMs: 5_000 });
    const release = storage.hold('load');
    const connection = connect(server);
    connection.drop();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 0, receipts: 0 });

    await vi.advanceTimersByTimeAsync(5_000);

    expect(server.getRoomStats('doc-1')).toBeUndefined();
  });

  it('com dois clientes, a sala só é descarregada depois que o último sai', async () => {
    vi.useFakeTimers();
    const { server } = setup({ roomIdleMs: 1_000 });
    const a = connect(server, { sessionId: 'a' });
    const b = connect(server, { sessionId: 'b' });
    await vi.advanceTimersByTimeAsync(0);

    a.drop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 1 });
    b.drop();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(server.getRoomStats('doc-1')).toBeUndefined();
  });
});

describe('sala semeada pelo host (US-S.12, R11)', () => {
  function savedDocument(): CanvasDocument {
    const section = createCanvasSection();
    for (const [index, id] of ['r1', 'r2', 'r3'].entries()) {
      const created = section.dispatch({
        type: 'shape.create',
        shape: { id, type: 'rectangle', x: index * 20, y: 5, width: 10, height: 10, rotation: 0 },
      });
      if (!created.ok) throw new Error(`não criou ${id}`);
    }
    const base = section.getSnapshot().document;
    const layer = base.layers[0];
    if (layer === undefined) throw new Error('documento sem camada');
    const document: CanvasDocument = {
      ...base,
      id: 'desenho-42',
      layers: [
        { ...layer, id: 'camada-fundo', name: 'Fundo', childIds: ['r1', 'r2'] },
        { ...layer, id: 'camada-frente', name: 'Frente', childIds: ['r3'] },
      ],
    };
    if (!validateDocument(document).ok) throw new Error('o documento de teste não é válido');
    return document;
  }

  it('depois da descarga e de uma nova conexão, a sala tem os mesmos nós e o mesmo id, sem camada a mais', async () => {
    vi.useFakeTimers();
    const document = savedDocument();
    const seeded = encodeCanvasDocumentAsYjsState(document);
    if (!seeded.ok) throw new Error('a semeadura falhou');
    const { storage, server } = setup({ roomIdleMs: 1_000 });
    // O host semeia dentro do load dele: grava uma vez, e o load seguinte devolve o gravado.
    await storage.create('desenho-42', {
      provider: 'yjs',
      roomEpoch: 'epoch-semeada',
      snapshot: seeded.value,
      log: [],
      receipts: [],
    });
    const projectionOf = async (): Promise<CanvasDocument> => {
      const connection = connect(server, { documentId: 'desenho-42' });
      await vi.advanceTimersByTimeAsync(0);
      const client = new Y.Doc();
      Y.applyUpdate(client, only(connection, 'welcome').missing);
      connection.drop();
      const projected = projectYjsStateToCanvasDocument(Y.encodeStateAsUpdate(client));
      if (!projected.ok) throw new Error('a projeção falhou');
      return projected.value;
    };

    const first = await projectionOf();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.getRoomStats('desenho-42')).toBeUndefined();
    const second = await projectionOf();

    for (const projected of [first, second]) {
      expect(projected.id).toBe('desenho-42');
      expect(projected.layers.map((layer) => layer.id)).toEqual(['camada-fundo', 'camada-frente']);
      expect(projected.nodes).toEqual(document.nodes);
    }
    expect(storage.calls.create).toBe(1);
  });
});

describe('limites (R12)', () => {
  it('maxClientsPerRoom: a conexão a mais recebe LIMIT_EXCEEDED fatal com details.reason clients', async () => {
    const { server } = setup({ maxClientsPerRoom: 2 });
    connect(server, { sessionId: 'a' });
    connect(server, { sessionId: 'b' });
    await settle();

    const third = connect(server, { sessionId: 'c' });
    await settle();

    expect(only(third, 'error')).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      fatal: true,
      details: { reason: 'clients' },
    });
    expect(third.closed?.code).toBe(4000);
    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 2 });
  });

  it('com a sala cheia, o mesmo sessionId ainda substitui a conexão antiga', async () => {
    const { server } = setup({ maxClientsPerRoom: 2 });
    const old = connect(server, { sessionId: 'a' });
    connect(server, { sessionId: 'b' });
    await settle();

    const fresh = connect(server, { sessionId: 'a' });
    await settle();

    expect(old.closed?.code).toBe(4001);
    expect(only(fresh, 'welcome').v).toBe(1);
  });

  it('quando alguém sai, há lugar de novo', async () => {
    const { server } = setup({ maxClientsPerRoom: 1 });
    const a = connect(server, { sessionId: 'a' });
    await settle();
    a.drop();

    const b = connect(server, { sessionId: 'b' });
    await settle();

    expect(only(b, 'welcome').v).toBe(1);
  });

  it('maxRooms: a sala a mais recebe LIMIT_EXCEEDED fatal com details.reason rooms; as já carregadas seguem abertas', async () => {
    const { storage, server } = setup({ maxRooms: 2 });
    connect(server, { documentId: 'doc-1', sessionId: 'a' });
    connect(server, { documentId: 'doc-2', sessionId: 'b' });
    await settle();

    const third = connect(server, { documentId: 'doc-3', sessionId: 'c' });
    const again = connect(server, { documentId: 'doc-1', sessionId: 'd' });
    await settle();

    expect(only(third, 'error')).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      fatal: true,
      details: { reason: 'rooms' },
    });
    expect(only(again, 'welcome').v).toBe(1);
    expect(storage.log.some((call) => call.documentId === 'doc-3')).toBe(false);
  });

  it('o limite conta as salas ainda carregando', async () => {
    const { storage, server } = setup({ maxRooms: 1 });
    const release = storage.hold('load');
    connect(server, { documentId: 'doc-1', sessionId: 'a' });

    const second = connect(server, { documentId: 'doc-2', sessionId: 'b' });
    await settle();

    expect(only(second, 'error').details).toEqual({ reason: 'rooms' });
    release();
    await settle();
  });

  it('uma sala ociosa dá o lugar a uma sala nova, em vez de recusá-la', async () => {
    const { server } = setup({ maxRooms: 1, roomIdleMs: 60_000 });
    const first = connect(server, { documentId: 'doc-1', sessionId: 'a' });
    await settle();
    first.drop();

    const second = connect(server, { documentId: 'doc-2', sessionId: 'b' });
    await settle();

    expect(only(second, 'welcome').v).toBe(1);
    expect(server.getRoomStats('doc-1')).toBeUndefined();
  });

  it('o padrão são 50 clientes por sala', async () => {
    const { server } = setup();
    for (let index = 0; index < 50; index += 1) connect(server, { sessionId: `s${index}` });
    await settle();

    const extra = connect(server, { sessionId: 'a-mais' });
    await settle();

    expect(only(extra, 'error').details).toEqual({ reason: 'clients' });
    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 50 });
  });
});

describe('welcome maior que maxFrameBytes (decisão 1 da spec do protocolo)', () => {
  it('LIMIT_EXCEEDED fatal com details.reason welcome, tamanho no logger e ninguém entra na sala', async () => {
    const { storage, logger, server } = setup({ maxFrameBytes: 2_048 });
    const doc = new Y.Doc();
    doc.getMap('meta').set('roomEpoch', 'epoch-grande');
    doc.getMap('meta').set('lixo', 'x'.repeat(4_000));
    await storage.create('doc-1', {
      provider: 'yjs',
      roomEpoch: 'epoch-grande',
      snapshot: Y.encodeStateAsUpdate(doc),
      log: [],
      receipts: [],
    });
    const old = connect(server, { sessionId: 'a', syncState: Y.encodeStateVector(doc) });
    await settle();
    expect(only(old, 'welcome').v).toBe(1);

    const big = connect(server, { sessionId: 'b' });
    await settle();

    expect(only(big, 'error')).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      fatal: true,
      details: { reason: 'welcome' },
    });
    expect(big.closed?.code).toBe(4000);
    const logged = logger.calls.find((call) => call.message.includes('welcome'));
    expect(logged?.fields).toMatchObject({ documentId: 'doc-1', sessionId: 'b' });
    expect(typeof logged?.fields?.bytes).toBe('number');
    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 1 });
  });

  it('a recusa por welcome grande não derruba a conexão antiga do mesmo sessionId', async () => {
    const { storage, server } = setup({ maxFrameBytes: 2_048 });
    const doc = new Y.Doc();
    doc.getMap('meta').set('roomEpoch', 'epoch-grande');
    doc.getMap('meta').set('lixo', 'x'.repeat(4_000));
    await storage.create('doc-1', {
      provider: 'yjs',
      roomEpoch: 'epoch-grande',
      snapshot: Y.encodeStateAsUpdate(doc),
      log: [],
      receipts: [],
    });
    const old = connect(server, { sessionId: 'a', syncState: Y.encodeStateVector(doc) });
    await settle();

    const retry = connect(server, { sessionId: 'a' });
    await settle();

    expect(old.closed).toBeUndefined();
    expect(only(retry, 'error').details).toEqual({ reason: 'welcome' });
  });
});
