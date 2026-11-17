import type {
  CollaborationError,
  CollaborationTransport,
  TransportHello,
  TransportInbound,
  TransportState,
} from '@canvash/collaboration';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createMemoryTransport } from './memory-transport.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { DeterministicTransportHub } from './transport.js';

const DOCUMENT_ID = 'doc-memoria';

function setup(now: () => number = () => 1_700_000_000_000) {
  const server = new CollaborativeServerEmulator('epoch-1', undefined, { now });
  const hub = new DeterministicTransportHub(server);
  const create = createMemoryTransport(hub);
  const transportOf = (sessionId: string): CollaborationTransport =>
    create({ documentId: DOCUMENT_ID, sessionId });
  return { server, hub, transportOf };
}

function helloOf(sessionId: string, extra: Partial<TransportHello> = {}): () => TransportHello {
  return () => ({
    provider: 'yjs',
    documentId: DOCUMENT_ID,
    sessionId,
    syncState: new Uint8Array(),
    ...extra,
  });
}

/** Um update Yjs válido que grava `key` no mapa `shapes`. */
function updateWith(key: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap('shapes').set(key, key);
  return Y.encodeStateAsUpdate(doc);
}

function collect(transport: CollaborationTransport): TransportInbound[] {
  const inbound: TransportInbound[] = [];
  transport.onInbound((message) => inbound.push(message));
  return inbound;
}

describe('createMemoryTransport: handshake', () => {
  it('abre, passa por connecting e devolve o welcome completo', async () => {
    const { server, transportOf } = setup(() => 4242);
    const transport = transportOf('a');
    const states: TransportState[] = [];
    transport.onStateChange((state) => states.push(state));

    expect(transport.state).toBe('idle');
    const result = await transport.open(helloOf('a'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roomEpoch).toBe('epoch-1');
    expect(result.value.access).toBe('write');
    expect(result.value.serverTime).toBe(4242);
    expect(result.value.user).toBeUndefined();
    expect(states).toEqual(['connecting', 'open']);
    expect(transport.state).toBe('open');

    // `missing` leva o cliente ao estado do servidor, e `serverSyncState` é o vetor dele.
    const client = new Y.Doc();
    Y.applyUpdate(client, result.value.missing);
    expect(Y.encodeStateVector(client)).toEqual(result.value.serverSyncState);
    const serverDoc = new Y.Doc();
    Y.applyUpdate(serverDoc, server.getSnapshot());
    expect(result.value.serverSyncState).toEqual(Y.encodeStateVector(serverDoc));
  });

  it('chama getHello em toda abertura e usa o vetor de estado dele', async () => {
    const { server, transportOf } = setup();
    await server.commitUpdate('c-1', updateWith('existente'), 'epoch-1');
    const known = new Y.Doc();
    Y.applyUpdate(known, server.getSnapshot());

    let calls = 0;
    const transport = transportOf('a');
    const result = await transport.open(() => {
      calls += 1;
      return helloOf('a', { syncState: Y.encodeStateVector(known) })();
    });

    expect(calls).toBe(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Quem já tem tudo recebe um update vazio: aplicá-lo não muda o vetor.
    const before = Y.encodeStateVector(known);
    Y.applyUpdate(known, result.value.missing);
    expect(Y.encodeStateVector(known)).toEqual(before);
  });

  it('devolve o acesso que o servidor concede', async () => {
    const { server, transportOf } = setup();
    server.setAccess('read');

    const result = await transportOf('a').open(helloOf('a'));

    expect(result.ok && result.value.access).toBe('read');
  });

  const refusals: Array<{
    name: string;
    hello: Partial<TransportHello>;
    code: CollaborationError['code'];
    crash?: boolean;
  }> = [
    {
      name: 'credencial recusada',
      hello: { credentials: { token: 'invalid_token' } },
      code: 'UNAUTHORIZED',
    },
    { name: 'epoch diferente', hello: { roomEpoch: 'epoch-9' }, code: 'ROOM_EPOCH_MISMATCH' },
    { name: 'provider diferente', hello: { provider: 'outro' }, code: 'UNSUPPORTED' },
    { name: 'servidor fora do ar', hello: {}, code: 'CONNECTION_FAILED', crash: true },
  ];

  it.each(refusals)(
    '$name volta como $code, sem lançar e sem cliente registrado',
    async ({ hello, code, crash }) => {
      const { server, hub, transportOf } = setup();
      if (crash) server.crash();
      const transport = transportOf('a');
      const changes: Array<[TransportState, CollaborationError['code'] | undefined]> = [];
      transport.onStateChange((state, error) => changes.push([state, error?.code]));

      const result = await transport.open(helloOf('a', hello));

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.code).toBe(code);
      expect(transport.state).toBe('closed');
      expect(changes).toEqual([
        ['connecting', undefined],
        ['closed', code],
      ]);
      expect(hub.getClientCount()).toBe(0);
    },
  );

  it('epoch diferente informa a do cliente e a do servidor', async () => {
    const { transportOf } = setup();

    const result = await transportOf('a').open(helloOf('a', { roomEpoch: 'epoch-9' }));

    expect(!result.ok && result.error.details).toEqual({
      clientEpoch: 'epoch-9',
      serverEpoch: 'epoch-1',
    });
  });

  it('open só vale uma vez por transporte', async () => {
    const { transportOf } = setup();
    const transport = transportOf('a');
    await transport.open(helloOf('a'));

    const again = await transport.open(helloOf('a'));

    expect(!again.ok && again.error.code).toBe('CONNECTION_FAILED');
    expect(transport.state).toBe('open');
  });
});

describe('createMemoryTransport: commit e sync', () => {
  it('commit devolve recibo durável e repete o mesmo recibo no reenvio', async () => {
    const { transportOf } = setup();
    const transport = transportOf('a');
    await transport.open(helloOf('a'));
    const update = updateWith('forma-1');

    const first = await transport.commit('commit-1', update, 'epoch-1');
    const second = await transport.commit('commit-1', update, 'epoch-1');

    expect(first.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('commit recusado');
    expect(first.value).toMatchObject({
      commitId: 'commit-1',
      roomEpoch: 'epoch-1',
      durable: true,
    });
    expect(second.value).toEqual(first.value);
  });

  it('o commit chega aos outros como update, com o from de quem enviou', async () => {
    const { transportOf } = setup();
    const a = transportOf('a');
    const b = transportOf('b');
    await a.open(helloOf('a'));
    await b.open(helloOf('b'));
    const inboundA = collect(a);
    const inboundB = collect(b);
    const update = updateWith('forma-1');

    await a.commit('commit-1', update, 'epoch-1');

    expect(inboundB).toEqual([{ type: 'update', commitId: 'commit-1', from: 'a', update }]);
    expect(inboundA).toEqual([]);
  });

  it('commit fora de open resolve com DISCONNECTED', async () => {
    const { transportOf } = setup();
    const transport = transportOf('a');

    const before = await transport.commit('commit-1', updateWith('x'), 'epoch-1');
    await transport.open(helloOf('a'));
    transport.close();
    const after = await transport.commit('commit-2', updateWith('y'), 'epoch-1');

    expect(!before.ok && before.error.code).toBe('DISCONNECTED');
    expect(!after.ok && after.error.code).toBe('DISCONNECTED');
  });

  it('epoch errada e bytes inválidos voltam tipados, sem lançar', async () => {
    const { server, transportOf } = setup();
    const transport = transportOf('a');
    await transport.open(helloOf('a'));
    const snapshot = server.getSnapshot();

    const epoch = await transport.commit('commit-1', updateWith('x'), 'epoch-9');
    const garbage = await transport.commit('commit-2', new Uint8Array([255, 254, 253]), 'epoch-1');

    expect(!epoch.ok && epoch.error.code).toBe('ROOM_EPOCH_MISMATCH');
    expect(!garbage.ok && garbage.error.code).toBe('INVALID_DOCUMENT');
    expect(server.getSnapshot()).toEqual(snapshot);
  });

  it('servidor fora do ar e partição voltam como DISCONNECTED', async () => {
    const { server, hub, transportOf } = setup();
    const transport = transportOf('a');
    await transport.open(helloOf('a'));

    server.crash();
    const crashed = await transport.commit('commit-1', updateWith('x'), 'epoch-1');
    server.restart();
    hub.setNetworkOptions({ dropMessages: true });
    const dropped = await transport.commit('commit-2', updateWith('y'), 'epoch-1');

    expect(!crashed.ok && crashed.error.code).toBe('DISCONNECTED');
    expect(!dropped.ok && dropped.error.code).toBe('DISCONNECTED');
  });

  it('sync devolve o que falta a partir do vetor dado', async () => {
    const { transportOf } = setup();
    const a = transportOf('a');
    const b = transportOf('b');
    await a.open(helloOf('a'));
    const welcome = await b.open(helloOf('b'));
    if (!welcome.ok) throw new Error('handshake recusado');
    const client = new Y.Doc();
    Y.applyUpdate(client, welcome.value.missing);

    await a.commit('commit-1', updateWith('nova'), 'epoch-1');
    const synced = await b.sync(Y.encodeStateVector(client));

    expect(synced.ok).toBe(true);
    if (!synced.ok) return;
    Y.applyUpdate(client, synced.value);
    expect(client.getMap('shapes').get('nova')).toBe('nova');
  });
});

describe('createMemoryTransport: presença, fechamento e substituição', () => {
  it('a presença chega aos outros com o from do enlace, nunca a quem publicou', async () => {
    const { transportOf } = setup();
    const a = transportOf('a');
    const b = transportOf('b');
    await a.open(helloOf('a'));
    await b.open(helloOf('b'));
    const inboundA = collect(a);
    const inboundB = collect(b);
    const state = { sessionId: 'a', userId: 'u-a', color: '#3b82f6', cursor: null, selection: [] };

    a.sendPresence(state);

    expect(inboundB).toEqual([{ type: 'presence', from: 'a', state }]);
    expect(inboundA).toEqual([]);
  });

  it('presença fora de open é descartada', async () => {
    const { transportOf } = setup();
    const a = transportOf('a');
    const b = transportOf('b');
    await b.open(helloOf('b'));
    const inboundB = collect(b);

    a.sendPresence({ sessionId: 'a' });

    expect(inboundB).toEqual([]);
  });

  it('close é idempotente, avisa a saída e não deixa cliente registrado', async () => {
    const { hub, transportOf } = setup();
    const a = transportOf('a');
    const b = transportOf('b');
    await a.open(helloOf('a'));
    await b.open(helloOf('b'));
    const inboundA = collect(a);
    const inboundB = collect(b);
    const states: TransportState[] = [];
    a.onStateChange((state) => states.push(state));

    a.close();
    a.close();
    await b.commit('commit-1', updateWith('x'), 'epoch-1');

    expect(a.state).toBe('closed');
    expect(states).toEqual(['closed']);
    expect(hub.getClientCount()).toBe(1);
    expect(inboundB).toEqual([{ type: 'presence', from: 'a', state: null }]);
    expect(inboundA).toEqual([]);
  });

  it('quem cancela a inscrição deixa de receber', async () => {
    const { transportOf } = setup();
    const a = transportOf('a');
    const b = transportOf('b');
    await a.open(helloOf('a'));
    await b.open(helloOf('b'));
    const inbound: TransportInbound[] = [];
    const unsubscribe = b.onInbound((message) => inbound.push(message));

    unsubscribe();
    await a.commit('commit-1', updateWith('x'), 'epoch-1');

    expect(inbound).toEqual([]);
  });

  it('o mesmo sessionId substitui o enlace anterior (4001), sem anunciar saída', async () => {
    const { hub, transportOf } = setup();
    const old = transportOf('a');
    const other = transportOf('b');
    await old.open(helloOf('a'));
    await other.open(helloOf('b'));
    const inboundOther = collect(other);
    const inboundOld = collect(old);
    const changes: Array<[TransportState, unknown]> = [];
    old.onStateChange((state, error) => changes.push([state, error?.details]));

    const replacement = transportOf('a');
    const welcome = await replacement.open(helloOf('a'));
    const inboundNew = collect(replacement);
    await other.commit('commit-1', updateWith('x'), 'epoch-1');
    old.close();

    expect(welcome.ok).toBe(true);
    expect(old.state).toBe('closed');
    expect(changes).toEqual([['closed', { closeCode: 4001, reason: 'replaced' }]]);
    expect(inboundOther).toEqual([]);
    expect(inboundOld).toEqual([]);
    expect(inboundNew).toHaveLength(1);
    // Fechar o enlace antigo não derruba o novo.
    expect(hub.getClientCount()).toBe(2);
    expect(replacement.state).toBe('open');
  });
});

describe('CollaborativeServerEmulator: reinício e bytes inválidos', () => {
  it('sala criada com initialDoc sobrevive a crash e restart', async () => {
    const initial = new Y.Doc();
    initial.getMap('shapes').set('semeada', 'semeada');
    const server = new CollaborativeServerEmulator('epoch-1', initial);
    await server.commitUpdate('commit-1', updateWith('depois'), 'epoch-1');

    server.crash();
    server.restart();

    const restored = new Y.Doc();
    Y.applyUpdate(restored, server.getSnapshot());
    expect(restored.getMap('shapes').get('semeada')).toBe('semeada');
    expect(restored.getMap('shapes').get('depois')).toBe('depois');
  });

  it('commitUpdate com bytes inválidos devolve INVALID_DOCUMENT e não muda a sala', () => {
    const server = new CollaborativeServerEmulator();
    const snapshot = server.getSnapshot();

    const result = server.commitUpdate('commit-1', new Uint8Array([255, 254, 253]), 'epoch-1');

    expect(result).toEqual({ ok: false, code: 'INVALID_DOCUMENT' });
    expect(server.getSnapshot()).toEqual(snapshot);
  });
});
