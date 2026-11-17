import {
  createCollaborationError,
  type ClientMessage,
  type ServerMessage,
} from '@canvash/collaboration';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createCollaborationServer } from './server.js';
import { createMemoryRoomStorage } from './storage-memory.js';
import type { StoredRoom } from './storage.js';
import { FakeConnection } from './test-support/fake-connection.js';
import { createInstrumentedStorage } from './test-support/instrumented-storage.js';
import { createRecordingLogger } from './test-support/recording-logger.js';
import type { CollaborationServerOptions, ConnectionRequest } from './types.js';

type Hello = Extract<ClientMessage, { t: 'hello' }>;
type ErrorMessage = Extract<ServerMessage, { t: 'error' }>;

const REQUEST: ConnectionRequest = { headers: new Headers() };
const NOW = 1_700_000_000_000;

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
  let epochs = 0;
  const server = createCollaborationServer({
    storage,
    logger: createRecordingLogger(),
    now: () => NOW,
    createEpoch: () => `epoch-${(epochs += 1)}`,
    ...extra,
  });
  return { storage, server };
}

function connect(server: ReturnType<typeof setup>['server'], message?: ClientMessage) {
  const connection = new FakeConnection();
  server.handleConnection(connection, REQUEST);
  if (message !== undefined) connection.receive(message);
  return connection;
}

/** Deixa o servidor processar o que depende de armazenamento (promessas já resolvidas). */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

function only<T extends ServerMessage['t']>(
  messages: readonly ServerMessage[],
  type: T,
): Extract<ServerMessage, { t: T }> {
  const found = messages.find((message) => message.t === type);
  if (found === undefined)
    throw new Error(`o servidor não mandou "${type}": ${JSON.stringify(messages.map((m) => m.t))}`);
  return found as Extract<ServerMessage, { t: T }>;
}

function fatalError(connection: FakeConnection): ErrorMessage {
  const error = only(connection.messages(), 'error');
  expect(error.fatal).toBe(true);
  return error;
}

function storedRoom(overrides: Partial<StoredRoom> = {}): StoredRoom {
  const doc = new Y.Doc();
  doc.getMap('meta').set('roomEpoch', 'epoch-guardada');
  doc.getMap('meta').set('marca', 'do-snapshot');
  return {
    provider: 'yjs',
    roomEpoch: 'epoch-guardada',
    snapshot: Y.encodeStateAsUpdate(doc),
    log: [],
    receipts: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('handshake: sala nova e sala guardada (US-S.2)', () => {
  it('a primeira conexão cria a sala vazia e recebe o welcome com o estado dela', async () => {
    const { storage, server } = setup();

    const connection = connect(server, hello());
    await settle();

    const welcome = only(connection.messages(), 'welcome');
    expect(welcome).toMatchObject({ v: 1, roomEpoch: 'epoch-1', access: 'write', serverTime: NOW });
    expect(storage.calls).toMatchObject({ load: 1, create: 1 });
    const client = new Y.Doc();
    Y.applyUpdate(client, welcome.missing);
    expect(client.getMap('meta').get('roomEpoch')).toBe('epoch-1');
    expect([...welcome.serverSyncState]).toEqual([...Y.encodeStateVector(client)]);
    expect(connection.closed).toBeUndefined();
    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 1 });
  });

  it('a sala que o armazenamento já tem é reconstruída por snapshot e log, sem recriar nada', async () => {
    const { storage, server } = setup();
    const logUpdate = new Y.Doc();
    logUpdate.getMap('meta').set('marca-log', 'do-log');
    await storage.create(
      'doc-1',
      storedRoom({
        log: [
          {
            commitId: 'commit-1',
            update: Y.encodeStateAsUpdate(logUpdate),
            receipt: {
              commitId: 'commit-1',
              roomEpoch: 'epoch-guardada',
              timestamp: 5,
              durable: true,
            },
          },
        ],
      }),
    );
    const createsBefore = storage.calls.create;

    const connection = connect(server, hello());
    await settle();

    const welcome = only(connection.messages(), 'welcome');
    expect(welcome.roomEpoch).toBe('epoch-guardada');
    const client = new Y.Doc();
    Y.applyUpdate(client, welcome.missing);
    expect(client.getMap('meta').get('marca')).toBe('do-snapshot');
    expect(client.getMap('meta').get('marca-log')).toBe('do-log');
    expect(storage.calls.create).toBe(createsBefore);
  });

  it('o welcome traz só o que falta a quem já tem parte do estado', async () => {
    const { storage, server } = setup();
    const stored = storedRoom();
    await storage.create('doc-1', stored);
    const known = new Y.Doc();
    Y.applyUpdate(known, stored.snapshot);
    const before = Y.encodeStateVector(known);

    const connection = connect(server, hello({ syncState: before }));
    await settle();

    const welcome = only(connection.messages(), 'welcome');
    const probe = new Y.Doc();
    Y.applyUpdate(probe, welcome.missing);
    expect(probe.getMap('meta').size).toBe(0);
    expect([...welcome.serverSyncState]).toEqual([...before]);
  });

  it('o roomEpoch certo no hello entra; a sala fica com uma conexão por sessão', async () => {
    const { storage, server } = setup();
    await storage.create('doc-1', storedRoom());

    const connection = connect(server, hello({ roomEpoch: 'epoch-guardada' }));
    await settle();

    expect(only(connection.messages(), 'welcome').roomEpoch).toBe('epoch-guardada');
  });

  it('mensagens que chegam enquanto a sala carrega esperam o welcome, na ordem', async () => {
    const { storage, server } = setup();
    const release = storage.hold('load');
    const connection = connect(server, hello());
    connection.receive({ t: 'sync', id: 7, syncState: new Uint8Array() });

    release();
    await settle();

    expect(connection.messages().map((message) => message.t)).toEqual(['welcome', 'synced']);
  });
});

describe('handshake: cada recusa, sem sala nem conexão pendurada (US-S.2)', () => {
  async function expectRefused(
    connection: FakeConnection,
    code: ErrorMessage['code'],
  ): Promise<ErrorMessage> {
    await settle();
    const error = fatalError(connection);
    expect(error.code).toBe(code);
    expect(connection.closed?.code).toBe(4000);
    expect(connection.messages().map((message) => message.t)).toEqual(['error']);
    return error;
  }

  it('versão que o servidor não suporta: UNSUPPORTED_VERSION com details.supported, sem carregar sala', async () => {
    const { storage, server } = setup();

    const error = await expectRefused(connect(server, hello({ v: 2 })), 'UNSUPPORTED_VERSION');

    expect(error.details).toEqual({ supported: [1] });
    expect(storage.calls.load).toBe(0);
  });

  it.each([
    ['vazio', ''],
    ['com barra', 'a/b'],
    ['com ponto-ponto', '../fora'],
    ['com espaço', 'doc 1'],
    ['acima de 128 caracteres', 'x'.repeat(129)],
  ])('documentId %s: INVALID_DOCUMENT, sem carregar sala', async (_name, documentId) => {
    const { storage, server } = setup();

    await expectRefused(connect(server, hello({ documentId })), 'INVALID_DOCUMENT');

    expect(storage.calls.load).toBe(0);
    expect(server.getRoomStats(documentId)).toBeUndefined();
  });

  it('documentId de 128 caracteres válidos entra', async () => {
    const { server } = setup();

    const connection = connect(server, hello({ documentId: `A${'b_-'.repeat(42)}Z` }));
    await settle();

    expect(only(connection.messages(), 'welcome').v).toBe(1);
  });

  it('provider que não é o da sala: UNSUPPORTED, sem carregar sala', async () => {
    const { storage, server } = setup();

    const error = await expectRefused(
      connect(server, hello({ provider: 'automerge' })),
      'UNSUPPORTED',
    );

    expect(error.details).toEqual({ provider: 'yjs' });
    expect(storage.calls.load).toBe(0);
  });

  it('sala guardada por outro provider: UNSUPPORTED, e a sala não fica carregada', async () => {
    const { storage, server } = setup();
    await storage.create('doc-1', storedRoom({ provider: 'automerge' }));

    await expectRefused(connect(server, hello()), 'UNSUPPORTED');

    expect(server.getRoomStats('doc-1')).toBeUndefined();
  });

  it('roomEpoch diferente da sala: ROOM_EPOCH_MISMATCH com as duas epochs', async () => {
    const { storage, server } = setup();
    await storage.create('doc-1', storedRoom());

    const error = await expectRefused(
      connect(server, hello({ roomEpoch: 'epoch-antiga' })),
      'ROOM_EPOCH_MISMATCH',
    );

    expect(error.details).toEqual({ clientEpoch: 'epoch-antiga', serverEpoch: 'epoch-guardada' });
    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 0 });
  });

  it('syncState que não é um vetor de estado: PROTOCOL_ERROR', async () => {
    const { server } = setup();

    await expectRefused(
      connect(server, hello({ syncState: new Uint8Array([255, 255, 255, 255, 255, 255]) })),
      'PROTOCOL_ERROR',
    );
    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 0 });
  });

  it('falha do armazenamento na carga: STORAGE_UNAVAILABLE, e a conexão seguinte tenta de novo', async () => {
    const { storage, server } = setup();
    storage.failNext('load', createCollaborationError('STORAGE_UNAVAILABLE', 'disco fora'));

    await expectRefused(connect(server, hello()), 'STORAGE_UNAVAILABLE');
    const again = connect(server, hello());
    await settle();

    expect(only(again.messages(), 'welcome').roomEpoch).toBe('epoch-1');
    expect(storage.calls.load).toBe(2);
  });

  it('sala guardada com snapshot ilegível: STORAGE_UNAVAILABLE, sem sala carregada', async () => {
    const { storage, server } = setup();
    await storage.create('doc-1', storedRoom({ snapshot: new Uint8Array([9, 9, 9, 9]) }));

    await expectRefused(connect(server, hello()), 'STORAGE_UNAVAILABLE');

    expect(server.getRoomStats('doc-1')).toBeUndefined();
  });

  it('create que perde a corrida (CONFLICT) relê a sala que o outro criou', async () => {
    const { storage, server } = setup();
    const original = storage.load.bind(storage);
    let first = true;
    storage.load = async (documentId) => {
      if (first) {
        first = false;
        const result = await original(documentId);
        // Entre o `load` vazio e o `create`, outro processo cria a sala.
        await storage.inner.create(documentId, storedRoom({ roomEpoch: 'epoch-do-outro' }));
        return result;
      }
      return original(documentId);
    };

    const connection = connect(server, hello());
    await settle();

    expect(only(connection.messages(), 'welcome').roomEpoch).toBe('epoch-do-outro');
  });
});

describe('quadros que não são o hello (US-S.2)', () => {
  it('a primeira mensagem não é hello: PROTOCOL_ERROR fatal', async () => {
    const { storage, server } = setup();
    const connection = connect(server, {
      t: 'commit',
      id: 1,
      commitId: 'c',
      roomEpoch: 'e',
      update: new Uint8Array(),
    });
    await settle();

    expect(fatalError(connection).code).toBe('PROTOCOL_ERROR');
    expect(connection.closed?.code).toBe(4000);
    expect(storage.calls.load).toBe(0);
  });

  it('bytes que não são um quadro: PROTOCOL_ERROR fatal', () => {
    const { server } = setup();
    const connection = connect(server);

    connection.receiveFrame(new Uint8Array([1, 2, 3]));

    expect(fatalError(connection).code).toBe('PROTOCOL_ERROR');
    expect(connection.closed?.code).toBe(4000);
  });

  it('quadro acima de maxFrameBytes: PROTOCOL_ERROR fatal', () => {
    const { server } = setup({ maxFrameBytes: 64 });
    const connection = connect(server);

    connection.receive(hello({ syncState: new Uint8Array(200) }));

    expect(fatalError(connection).code).toBe('PROTOCOL_ERROR');
  });

  it('silêncio além de helloTimeoutMs: PROTOCOL_ERROR fatal e fechamento', () => {
    vi.useFakeTimers();
    const { server } = setup({ helloTimeoutMs: 1_000 });
    const connection = connect(server);

    vi.advanceTimersByTime(999);
    expect(connection.closed).toBeUndefined();
    vi.advanceTimersByTime(1);

    expect(fatalError(connection).code).toBe('PROTOCOL_ERROR');
    expect(connection.closed?.code).toBe(4000);
  });

  it('o hello a tempo desarma o prazo', async () => {
    vi.useFakeTimers();
    const { server } = setup({ helloTimeoutMs: 1_000 });
    const connection = connect(server, hello());
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(connection.closed).toBeUndefined();
    expect(connection.messages().map((message) => message.t)).toEqual(['welcome']);
  });

  it('um segundo hello na mesma conexão: PROTOCOL_ERROR fatal', async () => {
    const { server } = setup();
    const connection = connect(server, hello());
    await settle();

    connection.receive(hello());

    expect(fatalError(connection).code).toBe('PROTOCOL_ERROR');
    expect(connection.closed?.code).toBe(4000);
    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 0 });
  });

  it('a conexão que cai antes de a sala carregar não entra na sala', async () => {
    const { storage, server } = setup();
    const release = storage.hold('load');
    const connection = connect(server, hello());

    connection.drop();
    release();
    await settle();

    expect(connection.messages()).toEqual([]);
    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 0 });
  });
});

describe('depois do hello: sync e bye', () => {
  it('sync devolve synced com o que falta, com o mesmo id', async () => {
    const { storage, server } = setup();
    await storage.create('doc-1', storedRoom());
    const connection = connect(server, hello());
    await settle();
    connection.take();

    connection.receive({ t: 'sync', id: 42, syncState: new Uint8Array() });

    const synced = only(connection.messages(), 'synced');
    expect(synced.id).toBe(42);
    const probe = new Y.Doc();
    Y.applyUpdate(probe, synced.missing);
    expect(probe.getMap('meta').get('marca')).toBe('do-snapshot');
  });

  it('sync com um vetor de estado inválido: erro não fatal com o id', async () => {
    const { server } = setup();
    const connection = connect(server, hello());
    await settle();
    connection.take();

    connection.receive({
      t: 'sync',
      id: 5,
      syncState: new Uint8Array([255, 255, 255, 255, 255, 255]),
    });

    const error = only(connection.messages(), 'error');
    expect(error).toMatchObject({ id: 5, code: 'PROTOCOL_ERROR', fatal: false });
    expect(connection.closed).toBeUndefined();
  });

  it('bye fecha a conexão com 1000 e tira o cliente da sala', async () => {
    const { server } = setup();
    const connection = connect(server, hello());
    await settle();

    connection.receive({ t: 'bye' });

    expect(connection.closed?.code).toBe(1000);
    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 0 });
  });

  it('a conexão que cai sai da sala', async () => {
    const { server } = setup();
    const connection = connect(server, hello());
    await settle();

    connection.drop();

    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 0 });
  });
});

describe('mesmo sessionId: a conexão nova toma o lugar (4001)', () => {
  it('a antiga fecha com 4001, a nova recebe o welcome e a sala fica com um cliente', async () => {
    const { server } = setup();
    const old = connect(server, hello());
    await settle();

    const fresh = connect(server, hello());
    await settle();

    expect(old.closed?.code).toBe(4001);
    expect(old.messages().map((message) => message.t)).toEqual(['welcome']);
    expect(only(fresh.messages(), 'welcome').v).toBe(1);
    expect(fresh.closed).toBeUndefined();
    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 1 });
  });

  it('o fechamento tardio da conexão antiga não derruba a nova', async () => {
    const { server } = setup();
    const old = connect(server, hello());
    await settle();
    const fresh = connect(server, hello());
    await settle();

    old.drop();
    old.receive({ t: 'bye' });

    expect(fresh.closed).toBeUndefined();
    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 1 });
  });

  it('sessões diferentes convivem na mesma sala', async () => {
    const { server } = setup();
    const a = connect(server, hello({ sessionId: 'a' }));
    const b = connect(server, hello({ sessionId: 'b' }));
    await settle();

    expect(a.closed).toBeUndefined();
    expect(b.closed).toBeUndefined();
    expect(server.getRoomStats('doc-1')).toMatchObject({ clients: 2 });
  });
});

describe('o núcleo não conhece o meio (US-S.10)', () => {
  it('roda inteiro sobre a conexão falsa, com o armazenamento em memória', async () => {
    const server = createCollaborationServer({ storage: createMemoryRoomStorage() });
    const connection = new FakeConnection();

    server.handleConnection(connection, REQUEST);
    connection.receive(hello());
    await settle();

    expect(connection.messages().map((message) => message.t)).toEqual(['welcome']);
  });

  it('handleConnection não lança, nem com uma conexão que lança ao enviar', () => {
    const { server } = setup();
    const connection = new FakeConnection();
    connection.send = () => {
      throw new Error('socket quebrado');
    };

    expect(() => {
      server.handleConnection(connection, REQUEST);
      connection.receiveFrame(new Uint8Array([1]));
    }).not.toThrow();
    expect(connection.closed?.code).toBe(4000);
  });
});
