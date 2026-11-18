import {
  createCollaborationError,
  ok,
  type CollaborationError,
  type CollaborationTransport,
  type SessionStatus,
  type TransportInbound,
  type TransportState,
  type TransportWelcome,
} from '@canvash/collaboration';
import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { initYjsDocument } from './crdt-schema.js';
import { YjsCollaborationProvider } from './provider.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { YjsCollaborationSession } from './session.js';
import { DeterministicTransportHub } from './transport.js';

/** Espera as microtarefas do envio em memória terminarem. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

function addRect(section: CanvasSectionApi, id: string): void {
  const result = section.dispatch({
    type: 'shape.create',
    shape: { id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
  });
  if (!result.ok) throw new Error(`não criou ${id}`);
}

function nodeIds(section: CanvasSectionApi): string[] {
  return Object.keys(section.getSnapshot().document.nodes).sort();
}

interface Peer {
  section: CanvasSectionApi;
  session: YjsCollaborationSession;
  statuses: SessionStatus[];
  errors: Array<CollaborationError['code'] | undefined>;
  receipts: string[];
}

async function room(count: number) {
  const server = new CollaborativeServerEmulator();
  const hub = new DeterministicTransportHub(server);
  const provider = new YjsCollaborationProvider({ server, transport: hub });
  const peers: Peer[] = [];
  for (let index = 0; index < count; index += 1) {
    const section = createCanvasSection();
    const connected = await provider.connect({ documentId: 'doc-queda', section });
    if (!connected.ok) throw new Error(connected.error.code);
    const peer: Peer = {
      section,
      session: connected.value,
      statuses: [],
      errors: [],
      receipts: [],
    };
    peer.session.onStatusChange((status, error) => {
      peer.statuses.push(status);
      peer.errors.push(error?.code);
    });
    peer.session.onCommitReceipt((receipt) => peer.receipts.push(receipt.commitId));
    peers.push(peer);
  }
  const destroy = (): void => {
    for (const peer of peers) peer.session.destroy();
    server.destroy();
  };
  return { server, hub, peers, destroy };
}

function logIds(server: CollaborativeServerEmulator): string[] {
  return server.getLog().map((entry) => entry.commitId);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('queda e volta do enlace pela sessão (US-P.4)', () => {
  it('três sessões convergem depois de uma perder o enlace, sem commit nem recibo duplicado', async () => {
    const { server, hub, peers, destroy } = await room(3);
    const [a, b, c] = peers as [Peer, Peer, Peer];

    hub.dropLink(a.session.sessionId);
    expect(a.session.status).toBe('reconnecting');
    addRect(a.section, 'de-a');
    addRect(b.section, 'de-b');
    addRect(c.section, 'de-c');
    await flush();
    // O que A editou sem enlace ainda não chegou ao servidor nem aos outros.
    expect(nodeIds(b.section)).toEqual(['de-b', 'de-c']);
    expect(nodeIds(a.section)).toEqual(['de-a']);

    hub.restoreLink(a.session.sessionId);
    await flush();

    const all = ['de-a', 'de-b', 'de-c'];
    expect(nodeIds(a.section)).toEqual(all);
    expect(nodeIds(b.section)).toEqual(all);
    expect(nodeIds(c.section)).toEqual(all);
    expect(a.statuses).toEqual(['reconnecting', 'connected']);
    expect(b.statuses).toEqual([]);
    // Um recibo por commit, e cada commit uma vez no log do servidor.
    const ids = logIds(server);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3);
    expect(a.receipts).toHaveLength(1);
    expect(new Set([...a.receipts, ...b.receipts, ...c.receipts]).size).toBe(3);
    const left = await a.session.leave();
    expect(left.ok).toBe(true);
    destroy();
  });

  it('edição feita durante a queda e durante o reenvio também chega', async () => {
    const { hub, peers, destroy } = await room(2);
    const [a, b] = peers as [Peer, Peer];

    hub.dropLink(a.session.sessionId);
    addRect(a.section, 'offline-1');
    addRect(a.section, 'offline-2');
    hub.restoreLink(a.session.sessionId);
    // Editada enquanto o reenvio das pendências ainda está em andamento.
    addRect(a.section, 'durante-o-reenvio');
    await flush();

    expect(nodeIds(b.section)).toEqual(['durante-o-reenvio', 'offline-1', 'offline-2']);
    expect(a.session.status).toBe('connected');
    expect(a.receipts).toHaveLength(3);
    expect((await a.session.leave()).ok).toBe(true);
    destroy();
  });

  it('servidor reiniciado: a sessão volta sozinha e confirma o que ficou pendente', async () => {
    const { server, hub, peers, destroy } = await room(2);
    const [a, b] = peers as [Peer, Peer];
    addRect(b.section, 'antes');
    await flush();

    server.crash();
    hub.dropLink(a.session.sessionId);
    hub.dropLink(b.session.sessionId);
    addRect(a.section, 'durante');
    await flush();
    server.restart();
    hub.restoreLink(a.session.sessionId);
    hub.restoreLink(b.session.sessionId);
    await flush();

    expect(nodeIds(a.section)).toEqual(['antes', 'durante']);
    expect(nodeIds(b.section)).toEqual(['antes', 'durante']);
    expect(a.statuses).toEqual(['reconnecting', 'connected']);
    const ids = logIds(server);
    expect(new Set(ids).size).toBe(ids.length);
    destroy();
  });

  it('ACK perdido: o servidor grava, a resposta se perde, e o reenvio traz o mesmo recibo, uma vez', async () => {
    vi.useFakeTimers();
    const { server, hub, peers, destroy } = await room(2);
    const [a, b] = peers as [Peer, Peer];
    hub.setNetworkOptions({ delayMs: 50 });

    addRect(a.section, 'em-voo');
    await flush();
    hub.dropLink(a.session.sessionId);
    await vi.advanceTimersByTimeAsync(50);
    // O servidor gravou, mas a sessão não soube.
    expect(logIds(server)).toHaveLength(1);
    expect(a.receipts).toEqual([]);

    hub.setNetworkOptions({});
    hub.restoreLink(a.session.sessionId);
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    expect(logIds(server)).toHaveLength(1);
    expect(a.receipts).toEqual(logIds(server));
    expect(a.session.getCommitReceipts()).toHaveLength(1);
    expect(nodeIds(b.section)).toEqual(['em-voo']);
    expect(a.session.status).toBe('connected');
    destroy();
  });

  it('a volta numa sala de outra epoch leva a error ROOM_EPOCH_MISMATCH, sem reenviar pendências', async () => {
    const { server, hub, peers, destroy } = await room(1);
    const [a] = peers as [Peer];

    hub.dropLink(a.session.sessionId);
    addRect(a.section, 'pendente');
    server.rotateEpoch('epoch-2');
    hub.restoreLink(a.session.sessionId);
    await flush();

    expect(a.session.status).toBe('error');
    expect(a.statuses).toEqual(['reconnecting', 'error']);
    expect(a.errors).toEqual([undefined, 'ROOM_EPOCH_MISMATCH']);
    expect(logIds(server)).toEqual([]);
    // Documento e pendências ficam para o host recuperar.
    expect(nodeIds(a.section)).toEqual(['pendente']);
    expect((await a.session.leave()).ok).toBe(false);
    expect(hub.getClientCount()).toBe(0);
    destroy();
  });

  it('o enlace tomado por outra conexão com o mesmo sessionId leva a error', async () => {
    const { hub, peers, destroy } = await room(1);
    const [a] = peers as [Peer];

    hub.attachLink(a.session.sessionId, {
      deliver() {},
      replaced() {},
      dropped() {},
      restored() {},
    });

    expect(a.session.status).toBe('error');
    expect(a.errors).toEqual(['DISCONNECTED']);
    destroy();
  });
});

/** Transporte controlado pelo teste: ele decide o que chega e quando o estado muda. */
function controlledTransport(welcome: TransportWelcome) {
  let state: TransportState = 'open';
  const inbound = new Set<(message: TransportInbound) => void>();
  const stateListeners = new Set<(state: TransportState, error?: CollaborationError) => void>();
  const commits: string[] = [];
  let closes = 0;
  const transport: CollaborationTransport = {
    get state() {
      return state;
    },
    open: () => Promise.resolve(ok(welcome)),
    commit(commitId, _update, roomEpoch) {
      commits.push(commitId);
      return Promise.resolve(ok({ commitId, roomEpoch, timestamp: 1, durable: true }));
    },
    sync: () => Promise.resolve(ok(new Uint8Array([0, 0]))),
    sendPresence() {},
    onInbound(listener) {
      inbound.add(listener);
      return () => inbound.delete(listener);
    },
    onStateChange(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    close() {
      closes += 1;
      state = 'closed';
    },
  };
  return {
    transport,
    commits,
    closes: () => closes,
    emit(message: TransportInbound): void {
      for (const listener of [...inbound]) listener(message);
    },
    setState(next: TransportState, error?: CollaborationError): void {
      state = next;
      for (const listener of [...stateListeners]) listener(next, error);
    },
  };
}

function controlledSession() {
  const roomDoc = new Y.Doc();
  initYjsDocument(roomDoc, 'epoch-1');
  const welcome: TransportWelcome = {
    roomEpoch: 'epoch-1',
    access: 'write',
    missing: Y.encodeStateAsUpdate(roomDoc),
    serverSyncState: Y.encodeStateVector(roomDoc),
    serverTime: 1,
  };
  const control = controlledTransport(welcome);
  const section = createCanvasSection();
  const session = new YjsCollaborationSession(
    control.transport,
    { documentId: 'doc', section },
    'sess-1',
    welcome,
  );
  const changes: Array<[SessionStatus, CollaborationError['code'] | undefined]> = [];
  session.onStatusChange((status, error) => changes.push([status, error?.code]));
  return { control, section, session, changes, welcome };
}

describe('sessão: eventos do transporte', () => {
  it('resync com outra epoch leva a error e fecha o transporte, sem reenviar', async () => {
    const { control, section, session, changes, welcome } = controlledSession();
    control.setState('reconnecting');
    addRect(section, 'pendente');
    control.setState('open');

    control.emit({ type: 'resync', welcome: { ...welcome, roomEpoch: 'epoch-2' } });
    await flush();

    expect(changes).toEqual([
      ['reconnecting', undefined],
      ['error', 'ROOM_EPOCH_MISMATCH'],
    ]);
    expect(control.commits).toEqual([]);
    expect(control.closes()).toBe(1);
    session.destroy();
  });

  it('erro fatal do servidor leva a error, fecha o transporte e guarda documento e pendências', async () => {
    const { control, section, session, changes } = controlledSession();
    addRect(section, 'r1');
    await flush();

    control.emit({
      type: 'error',
      fatal: true,
      error: createCollaborationError('UNAUTHORIZED', 'acesso revogado'),
    });
    addRect(section, 'depois');
    await flush();

    expect(changes).toEqual([['error', 'UNAUTHORIZED']]);
    expect(control.closes()).toBe(1);
    expect(control.commits).toHaveLength(1);
    expect(nodeIds(section)).toEqual(['depois', 'r1']);
    expect((await session.leave()).ok).toBe(false);
    session.destroy();
  });

  it('erro não fatal sem pedido vira aviso, sem mudar o status nem fechar', () => {
    const { control, session, changes } = controlledSession();

    control.emit({
      type: 'error',
      fatal: false,
      error: createCollaborationError('LIMIT_EXCEEDED', 'presença grande demais'),
    });

    expect(session.status).toBe('connected');
    expect(changes).toEqual([['connected', 'LIMIT_EXCEEDED']]);
    expect(control.closes()).toBe(0);
    session.destroy();
  });

  it('transporte que fecha com erro leva a error; fechado pela própria sessão, não', () => {
    const { control, session, changes } = controlledSession();

    control.setState('closed', createCollaborationError('PROTOCOL_ERROR', 'quadro inválido'));
    expect(changes).toEqual([['error', 'PROTOCOL_ERROR']]);

    const other = controlledSession();
    other.session.disconnect();
    other.control.setState('closed');
    expect(other.changes).toEqual([['disconnected', undefined]]);
    session.destroy();
    other.session.destroy();
  });

  it('recibo repetido do mesmo commit não dispara onCommitReceipt duas vezes', async () => {
    const { control, section, session } = controlledSession();
    const receipts: string[] = [];
    session.onCommitReceipt((receipt) => receipts.push(receipt.commitId));

    // O commit sai e, antes da resposta, uma volta do enlace reenvia a mesma pendência.
    addRect(section, 'r1');
    control.setState('reconnecting');
    control.setState('open');
    control.emit({ type: 'resync', welcome: welcomeOf() });
    await flush();

    expect(control.commits.length).toBeGreaterThanOrEqual(2);
    expect(new Set(control.commits).size).toBe(1);
    expect(receipts).toHaveLength(1);
    expect(session.getCommitReceipts()).toHaveLength(1);
    session.destroy();

    function welcomeOf(): TransportWelcome {
      return {
        roomEpoch: 'epoch-1',
        access: 'write',
        missing: new Uint8Array([0, 0]),
        serverSyncState: new Uint8Array([0]),
        serverTime: 2,
      };
    }
  });

  it('eventos depois de destroy são ignorados', () => {
    const { control, session, changes } = controlledSession();
    session.destroy();
    changes.length = 0;

    control.setState('reconnecting');
    control.emit({
      type: 'error',
      fatal: true,
      error: createCollaborationError('UNAUTHORIZED', 'tarde demais'),
    });

    expect(changes).toEqual([]);
  });
});
