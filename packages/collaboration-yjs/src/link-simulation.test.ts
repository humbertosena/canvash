import type {
  CollaborationError,
  CollaborationTransport,
  TransportHello,
  TransportInbound,
  TransportState,
} from '@canvash/collaboration';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createMemoryTransport } from './memory-transport.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { DeterministicTransportHub } from './transport.js';

function setup() {
  const server = new CollaborativeServerEmulator();
  const hub = new DeterministicTransportHub(server);
  const create = createMemoryTransport(hub);
  const transportOf = (sessionId: string): CollaborationTransport =>
    create({ documentId: 'doc-enlace', sessionId });
  return { server, hub, transportOf };
}

function helloOf(sessionId: string, extra: Partial<TransportHello> = {}): () => TransportHello {
  return () => ({
    provider: 'yjs',
    documentId: 'doc-enlace',
    sessionId,
    syncState: new Uint8Array(),
    ...extra,
  });
}

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

afterEach(() => {
  vi.useRealTimers();
});

describe('hub em memória: queda e volta do enlace', () => {
  it('dropLink leva o transporte a reconnecting, anuncia a saída e recusa pedidos', async () => {
    const { hub, transportOf } = setup();
    const a = transportOf('a');
    const b = transportOf('b');
    await a.open(helloOf('a'));
    await b.open(helloOf('b'));
    const inboundB = collect(b);
    const states: TransportState[] = [];
    a.onStateChange((state) => states.push(state));

    hub.dropLink('a');
    const commit = await a.commit('commit-1', updateWith('x'), 'epoch-1');
    const sync = await a.sync(new Uint8Array());
    a.sendPresence({ sessionId: 'a' });

    expect(a.state).toBe('reconnecting');
    expect(states).toEqual(['reconnecting']);
    expect(!commit.ok && commit.error.code).toBe('DISCONNECTED');
    expect(!sync.ok && sync.error.code).toBe('DISCONNECTED');
    expect(inboundB).toEqual([{ type: 'presence', from: 'a', state: null }]);
    expect(hub.getClientCount()).toBe(1);
  });

  it('restoreLink refaz o handshake com um hello novo e entrega o que faltou como resync', async () => {
    const { hub, transportOf } = setup();
    const a = transportOf('a');
    const b = transportOf('b');
    const known = new Y.Doc();
    let hellos = 0;
    const welcome = await a.open(() => {
      hellos += 1;
      return helloOf('a', { syncState: Y.encodeStateVector(known) })();
    });
    if (!welcome.ok) throw new Error('handshake recusado');
    Y.applyUpdate(known, welcome.value.missing);
    await b.open(helloOf('b'));
    const inboundA = collect(a);
    const states: TransportState[] = [];
    a.onStateChange((state) => states.push(state));

    hub.dropLink('a');
    await b.commit('commit-1', updateWith('durante-a-queda'), 'epoch-1');
    hub.restoreLink('a');

    expect(hellos).toBe(2);
    expect(a.state).toBe('open');
    expect(states).toEqual(['reconnecting', 'open']);
    expect(inboundA).toHaveLength(1);
    const resync = inboundA[0];
    if (resync?.type !== 'resync') throw new Error('esperava resync');
    Y.applyUpdate(known, resync.welcome.missing);
    expect(known.getMap('shapes').get('durante-a-queda')).toBe('durante-a-queda');
    expect(Y.encodeStateVector(known)).toEqual(resync.welcome.serverSyncState);
    expect(hub.getClientCount()).toBe(2);
  });

  it('o enlace que volta numa sala de outra epoch fecha com o erro, sem cliente registrado', async () => {
    const { server, hub, transportOf } = setup();
    const a = transportOf('a');
    await a.open(helloOf('a', { roomEpoch: 'epoch-1' }));
    const changes: Array<[TransportState, CollaborationError['code'] | undefined]> = [];
    a.onStateChange((state, error) => changes.push([state, error?.code]));

    hub.dropLink('a');
    server.rotateEpoch('epoch-2');
    hub.restoreLink('a');

    expect(changes).toEqual([
      ['reconnecting', undefined],
      ['closed', 'ROOM_EPOCH_MISMATCH'],
    ]);
    expect(hub.getClientCount()).toBe(0);
  });

  it('ACK perdido: o commit em voo na queda volta DISCONNECTED, e o reenvio recebe o mesmo recibo', async () => {
    vi.useFakeTimers();
    const { server, hub, transportOf } = setup();
    const a = transportOf('a');
    await a.open(helloOf('a'));
    hub.setNetworkOptions({ delayMs: 50 });
    const update = updateWith('em-voo');

    const pending = a.commit('commit-1', update, 'epoch-1');
    hub.dropLink('a');
    await vi.advanceTimersByTimeAsync(50);
    const lost = await pending;
    hub.setNetworkOptions({});
    hub.restoreLink('a');
    const resent = await a.commit('commit-1', update, 'epoch-1');

    expect(!lost.ok && lost.error.code).toBe('DISCONNECTED');
    expect(resent.ok).toBe(true);
    // O servidor gravou uma vez só: o reenvio devolve o recibo do primeiro.
    const again = server.commitUpdate('commit-1', update, 'epoch-1');
    expect(again.ok && resent.ok && again.receipt).toEqual(resent.ok && resent.value);
  });

  it('fechar durante a queda não deixa enlace para voltar', async () => {
    const { hub, transportOf } = setup();
    const a = transportOf('a');
    await a.open(helloOf('a'));

    hub.dropLink('a');
    a.close();
    hub.restoreLink('a');

    expect(a.state).toBe('closed');
    expect(hub.getClientCount()).toBe(0);
  });

  it('outro transporte com o mesmo sessionId toma o lugar do que estava em queda', async () => {
    const { hub, transportOf } = setup();
    const old = transportOf('a');
    await old.open(helloOf('a'));
    hub.dropLink('a');

    const replacement = transportOf('a');
    await replacement.open(helloOf('a'));
    hub.restoreLink('a');

    expect(old.state).toBe('closed');
    expect(replacement.state).toBe('open');
    expect(hub.getClientCount()).toBe(1);
  });

  it('dropLink e restoreLink de quem não tem enlace são inofensivos', () => {
    const { hub } = setup();

    hub.dropLink('ninguem');
    hub.restoreLink('ninguem');

    expect(hub.getClientCount()).toBe(0);
  });
});

describe('hub em memória: falha de gravação e reordenação', () => {
  it('failNextCommits recusa os próximos commits sem tocar a sala e depois aceita', async () => {
    const { server, hub, transportOf } = setup();
    const a = transportOf('a');
    await a.open(helloOf('a'));
    const before = server.getSnapshot();
    const update = updateWith('x');

    hub.failNextCommits(2, 'STORAGE_UNAVAILABLE');
    const first = await a.commit('commit-1', update, 'epoch-1');
    const second = await a.commit('commit-1', update, 'epoch-1');
    const untouched = server.getSnapshot();
    const third = await a.commit('commit-1', update, 'epoch-1');

    expect(!first.ok && first.error.code).toBe('STORAGE_UNAVAILABLE');
    expect(!second.ok && second.error.code).toBe('STORAGE_UNAVAILABLE');
    expect(untouched).toEqual(before);
    expect(third.ok).toBe(true);
    expect(a.state).toBe('open');
  });

  async function deliveryOrder(seed: number): Promise<string[]> {
    const { hub, transportOf } = setup();
    const a = transportOf('a');
    const b = transportOf('b');
    await a.open(helloOf('a'));
    await b.open(helloOf('b'));
    const inboundB = collect(b);
    hub.setNetworkOptions({ reorderMessages: true, reorderSeed: seed });

    for (let index = 0; index < 8; index += 1) {
      await a.commit(`commit-${index}`, updateWith(`forma-${index}`), 'epoch-1');
    }
    expect(inboundB).toEqual([]);
    await hub.settle();

    return inboundB.map((message) => (message.type === 'update' ? message.commitId : message.type));
  }

  it('reorderMessages entrega tudo, fora da ordem de envio, e igual para a mesma semente', async () => {
    const sent = Array.from({ length: 8 }, (_, index) => `commit-${index}`);

    const first = await deliveryOrder(7);
    const second = await deliveryOrder(7);
    const other = await deliveryOrder(8);

    expect([...first].sort()).toEqual(sent);
    expect(first).not.toEqual(sent);
    expect(second).toEqual(first);
    expect([...other].sort()).toEqual(sent);
    expect(other).not.toEqual(first);
  });

  it('settle resolve na hora quando não há entrega pendente', async () => {
    const { hub } = setup();

    await expect(hub.settle()).resolves.toBeUndefined();
  });

  it('desligar a reordenação entrega o que estava retido', async () => {
    const { hub, transportOf } = setup();
    const a = transportOf('a');
    const b = transportOf('b');
    await a.open(helloOf('a'));
    await b.open(helloOf('b'));
    const inboundB = collect(b);
    hub.setNetworkOptions({ reorderMessages: true });
    await a.commit('commit-1', updateWith('x'), 'epoch-1');

    hub.setNetworkOptions({});

    expect(inboundB).toHaveLength(1);
  });

  it('settle espera também as entregas atrasadas por delayMs', async () => {
    const { hub, transportOf } = setup();
    const a = transportOf('a');
    const b = transportOf('b');
    await a.open(helloOf('a'));
    await b.open(helloOf('b'));
    const inboundB = collect(b);
    hub.setNetworkOptions({ delayMs: 5 });

    a.sendPresence({ sessionId: 'a' });
    expect(inboundB).toEqual([]);
    await hub.settle();

    expect(inboundB).toHaveLength(1);
  });
});
