import type { CollaborationError, SessionStatus, TransportInbound } from '@canvash/collaboration';
import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createLegacyHubTransport, isLegacyTransportHub } from './legacy-hub-transport.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { YjsCollaborationSession } from './session.js';
import { DeterministicTransportHub } from './transport.js';

function setup() {
  const server = new CollaborativeServerEmulator('epoch-legado');
  const hub = new DeterministicTransportHub(server);
  return { server, hub };
}

function updateWith(key: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap('shapes').set(key, key);
  return Y.encodeStateAsUpdate(doc);
}

const RECT = {
  type: 'shape.create' as const,
  shape: { id: 'r1', type: 'rectangle' as const, x: 0, y: 0, width: 10, height: 10, rotation: 0 },
};

/** Espera as microtarefas do envio em memória terminarem. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

describe('isLegacyTransportHub', () => {
  it('reconhece o hub pela forma e recusa o resto', () => {
    const { hub } = setup();

    expect(isLegacyTransportHub(hub)).toBe(true);
    expect(isLegacyTransportHub(null)).toBe(false);
    expect(isLegacyTransportHub('hub')).toBe(false);
    expect(isLegacyTransportHub({ registerClient() {}, sendUpdate() {} })).toBe(false);
    expect(isLegacyTransportHub(createLegacyHubTransport(hub, 's1', 'epoch-legado'))).toBe(false);
  });
});

describe('createLegacyHubTransport', () => {
  it('attach registra o cliente na hora e deixa o enlace aberto', () => {
    const { hub } = setup();
    const transport = createLegacyHubTransport(hub, 's1', 'epoch-legado');

    transport.attach();

    expect(transport.state).toBe('open');
    expect(hub.getClientCount()).toBe(1);
  });

  it('open registra, traz o que falta e usa a epoch informada pela sessão', async () => {
    const { server, hub } = setup();
    server.commitUpdate('c-1', updateWith('existente'), 'epoch-legado');
    const transport = createLegacyHubTransport(hub, 's1', 'epoch-legado');
    const known = new Y.Doc();

    const welcome = await transport.open(() => ({
      provider: 'yjs',
      documentId: 'doc',
      sessionId: 's1',
      syncState: Y.encodeStateVector(known),
    }));
    const again = await transport.open(() => ({
      provider: 'yjs',
      documentId: 'doc',
      sessionId: 's1',
      syncState: new Uint8Array(),
    }));

    if (!welcome.ok) throw new Error('open recusado');
    expect(welcome.value.roomEpoch).toBe('epoch-legado');
    expect(welcome.value.access).toBe('write');
    Y.applyUpdate(known, welcome.value.missing);
    expect(known.getMap('shapes').get('existente')).toBe('existente');
    expect(!again.ok && again.error.code).toBe('CONNECTION_FAILED');
    expect(hub.getClientCount()).toBe(1);
  });

  it('hub que recusa o registro vira CONNECTION_FAILED, sem lançar', async () => {
    const { hub } = setup();
    hub.registerClient = () => {
      throw new Error('falha injetada');
    };
    const transport = createLegacyHubTransport(hub, 's1', 'epoch-legado');
    const changes: Array<[string, CollaborationError['code'] | undefined]> = [];
    transport.onStateChange((state, error) => changes.push([state, error?.code]));

    const result = await transport.open(() => ({
      provider: 'yjs',
      documentId: 'doc',
      sessionId: 's1',
      syncState: new Uint8Array([0]),
    }));

    expect(!result.ok && result.error.code).toBe('CONNECTION_FAILED');
    expect(!result.ok && result.error.details).toEqual({ cause: 'falha injetada' });
    expect(changes).toEqual([
      ['connecting', undefined],
      ['closed', 'CONNECTION_FAILED'],
    ]);
  });

  it('commit, sync e presença passam pelo hub; fora de open, nada sai', async () => {
    const { server, hub } = setup();
    const a = createLegacyHubTransport(hub, 'a', 'epoch-legado');
    const b = createLegacyHubTransport(hub, 'b', 'epoch-legado');
    const inboundB: TransportInbound[] = [];
    const unsubscribe = b.onInbound((message) => inboundB.push(message));
    const update = updateWith('forma');

    const early = await a.commit('c-0', update, 'epoch-legado');
    const earlySync = await a.sync(new Uint8Array([0]));
    a.sendPresence({ sessionId: 'a' });
    a.attach();
    b.attach();
    const committed = await a.commit('c-1', update, 'epoch-legado');
    const wrongEpoch = await a.commit('c-2', update, 'epoch-outra');
    const synced = await b.sync(new Uint8Array([0]));
    a.sendPresence({ sessionId: 'a' });
    unsubscribe();
    a.sendPresence({ sessionId: 'a' });

    expect(!early.ok && early.error.code).toBe('DISCONNECTED');
    expect(!earlySync.ok && earlySync.error.code).toBe('DISCONNECTED');
    expect(committed.ok && committed.value.commitId).toBe('c-1');
    expect(!wrongEpoch.ok && wrongEpoch.error.code).toBe('ROOM_EPOCH_MISMATCH');
    expect(synced.ok && synced.value).toEqual(server.getSnapshot());
    expect(inboundB).toEqual([
      { type: 'update', commitId: 'c-1', from: 'a', update },
      { type: 'presence', from: 'a', state: { sessionId: 'a' } },
    ]);
  });

  it('close desregistra uma vez só e é idempotente', () => {
    const { hub } = setup();
    const a = createLegacyHubTransport(hub, 'a', 'epoch-legado');
    const b = createLegacyHubTransport(hub, 'b', 'epoch-legado');
    const inboundB: TransportInbound[] = [];
    b.onInbound((message) => inboundB.push(message));
    a.attach();
    b.attach();

    a.close();
    a.close();

    expect(a.state).toBe('closed');
    expect(hub.getClientCount()).toBe(1);
    expect(inboundB).toEqual([{ type: 'presence', from: 'a', state: null }]);
  });
});

describe('sessão construída direto com o hub antigo', () => {
  it('registra o cliente no construtor, envia commits e os confirma', async () => {
    const { server, hub } = setup();
    const section = createCanvasSection();
    const session = new YjsCollaborationSession(
      hub,
      { documentId: 'doc', section, roomEpoch: 'epoch-legado' },
      'sess-1',
      server.getSnapshot(),
    );

    section.dispatch(RECT);
    await flush();

    expect(session.status).toBe('connected');
    expect(session.roomEpoch).toBe('epoch-legado');
    expect(hub.getClientCount()).toBe(1);
    expect(session.getCommitReceipts()).toHaveLength(1);
    const room = new Y.Doc();
    Y.applyUpdate(room, server.getSnapshot());
    expect(room.getMap('shapes').has('r1')).toBe(true);
    session.destroy();
    expect(hub.getClientCount()).toBe(0);
  });

  it('o construtor lança o que registerClient lançar, como antes', () => {
    const { server, hub } = setup();
    hub.registerClient = () => {
      throw new Error('falha injetada');
    };

    expect(
      () =>
        new YjsCollaborationSession(
          hub,
          { documentId: 'doc', section: createCanvasSection(), roomEpoch: 'epoch-legado' },
          'sess-1',
          server.getSnapshot(),
        ),
    ).toThrow('falha injetada');
  });

  it('disconnect e reconnect reabrem pelo hub e trazem o que faltou', async () => {
    const { server, hub } = setup();
    const section = createCanvasSection();
    const session = new YjsCollaborationSession(
      hub,
      { documentId: 'doc', section, roomEpoch: 'epoch-legado' },
      'sess-1',
      server.getSnapshot(),
    );
    const other = createCanvasSection();
    const otherSession = new YjsCollaborationSession(
      hub,
      { documentId: 'doc', section: other, roomEpoch: 'epoch-legado' },
      'sess-2',
      server.getSnapshot(),
    );

    session.disconnect();
    expect(hub.getClientCount()).toBe(1);
    other.dispatch(RECT);
    await flush();
    const result = await session.reconnect();

    expect(result.ok).toBe(true);
    expect(session.status).toBe('connected');
    expect(hub.getClientCount()).toBe(2);
    expect(section.getSnapshot().document.nodes.r1).toBeDefined();
    session.destroy();
    otherSession.destroy();
  });

  it('reconnect com o hub recusando o registro devolve o erro e vai a error', async () => {
    const { server, hub } = setup();
    const session = new YjsCollaborationSession(
      hub,
      { documentId: 'doc', section: createCanvasSection(), roomEpoch: 'epoch-legado' },
      'sess-1',
      server.getSnapshot(),
    );
    const statuses: SessionStatus[] = [];
    session.onStatusChange((status) => statuses.push(status));
    session.disconnect();
    hub.registerClient = () => {
      throw new Error('falha injetada');
    };

    const result = await session.reconnect();

    expect(!result.ok && result.error.code).toBe('CONNECTION_FAILED');
    expect(statuses).toEqual(['disconnected', 'reconnecting', 'error']);
    session.destroy();
  });

  it('reconnect com o enlace ainda aberto sincroniza sem reabrir nem anunciar saída', async () => {
    const { server, hub } = setup();
    const section = createCanvasSection();
    const session = new YjsCollaborationSession(
      hub,
      { documentId: 'doc', section, roomEpoch: 'epoch-legado' },
      'sess-1',
      server.getSnapshot(),
    );
    const seen: unknown[] = [];
    hub.registerClient('observador', (msg) => seen.push(msg));
    // Marca em `meta`: a projeção do canvas ignora, e a sessão a recebe como qualquer update.
    const outside = new Y.Doc();
    outside.getMap('meta').set('por-fora', 'por-fora');
    server.commitUpdate('c-fora', Y.encodeStateAsUpdate(outside), 'epoch-legado');

    const result = await session.reconnect();

    expect(result.ok).toBe(true);
    expect(seen).toEqual([]);
    expect(session.getYDoc().getMap('meta').get('por-fora')).toBe('por-fora');
    session.destroy();
  });

  it('reconnect e leave depois de destroy respondem sem tocar o hub', async () => {
    const { server, hub } = setup();
    const session = new YjsCollaborationSession(
      hub,
      { documentId: 'doc', section: createCanvasSection(), roomEpoch: 'epoch-legado' },
      'sess-1',
      server.getSnapshot(),
    );
    session.destroy();

    const reconnected = await session.reconnect();
    const left = await session.leave();

    expect(!reconnected.ok && reconnected.error.code).toBe('DISCONNECTED');
    expect(left.ok).toBe(true);
    expect(hub.getClientCount()).toBe(0);
  });
});
