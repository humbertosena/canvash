import type {
  CollaborationError,
  CollaborationSession,
  PendingSummary,
  SessionStatus,
} from '@canvash/collaboration';
import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { YjsCollaborationProvider } from './provider.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { YjsCollaborationSession } from './session.js';
import { DeterministicTransportHub } from './transport.js';

async function flush(): Promise<void> {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
}

function addRect(section: CanvasSectionApi, id: string): void {
  const result = section.dispatch({
    type: 'shape.create',
    shape: { id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
  });
  if (!result.ok) throw new Error(`não criou ${id}`);
}

function setup() {
  const server = new CollaborativeServerEmulator();
  const hub = new DeterministicTransportHub(server);
  const provider = new YjsCollaborationProvider({ server, transport: hub });
  return { server, hub, provider };
}

describe('sinais da sessão para a interface do host (US-P.12)', () => {
  it('um ouvinte de ConnectOptions vê connecting → connected → reconnecting → connected → disconnected, e as pendências sobem e voltam a zero', async () => {
    const { hub, provider } = setup();
    const section = createCanvasSection();
    const statuses: SessionStatus[] = [];
    const connected = await provider.connect({
      documentId: 'doc',
      section,
      onStatusChange: (status) => statuses.push(status),
    });
    if (!connected.ok) throw new Error(connected.error.code);
    // Tipado pela interface: o host não precisa da classe concreta para ler os sinais.
    const session: CollaborationSession = connected.value;
    const pending: PendingSummary[] = [];
    session.onPendingChange((summary) => pending.push(summary));
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(session.getPending()).toEqual({ count: 0, bytes: 0 });

    hub.dropLink(session.sessionId);
    addRect(section, 'offline');
    await flush();
    expect(session.getPending().count).toBe(1);
    expect(session.getPending().bytes).toBeGreaterThan(0);

    hub.restoreLink(session.sessionId);
    await flush();
    expect(session.getPending()).toEqual({ count: 0, bytes: 0 });

    const left = await session.leave();

    expect(left.ok).toBe(true);
    expect(statuses).toEqual([
      'connecting',
      'connected',
      'reconnecting',
      'connected',
      'disconnected',
    ]);
    expect(pending.map((summary) => summary.count)).toEqual([1, 0]);
    expect(pending[0]?.bytes).toBeGreaterThan(0);
    expect(pending[1]).toEqual({ count: 0, bytes: 0 });
  });

  it('connect que falha avisa connecting e error ao ouvinte, e nada depois', async () => {
    const { hub, provider } = setup();
    const seen: Array<[SessionStatus, CollaborationError['code'] | undefined]> = [];

    const result = await provider.connect({
      documentId: 'doc',
      section: createCanvasSection(),
      credentials: { token: 'invalid_token' },
      onStatusChange: (status, error) => seen.push([status, error?.code]),
    });
    await flush();

    expect(result.ok).toBe(false);
    expect(seen).toEqual([
      ['connecting', undefined],
      ['error', 'UNAUTHORIZED'],
    ]);
    expect(hub.getClientCount()).toBe(0);
  });

  it('destroy avisa o disconnected final a todos os ouvintes, uma vez só', async () => {
    const { provider } = setup();
    const fromOptions: SessionStatus[] = [];
    const connected = await provider.connect({
      documentId: 'doc',
      section: createCanvasSection(),
      onStatusChange: (status) => fromOptions.push(status),
    });
    if (!connected.ok) throw new Error(connected.error.code);
    const session = connected.value;
    const fromListener: SessionStatus[] = [];
    session.onStatusChange((status) => fromListener.push(status));

    session.destroy();
    session.destroy();

    expect(fromOptions).toEqual(['connecting', 'connected', 'disconnected']);
    expect(fromListener).toEqual(['disconnected']);
    expect(session.status).toBe('disconnected');
  });

  it('quem já estava desconectado não recebe um segundo disconnected ao destruir', async () => {
    const { provider } = setup();
    const connected = await provider.connect({ documentId: 'doc', section: createCanvasSection() });
    if (!connected.ok) throw new Error(connected.error.code);
    const session = connected.value;
    const statuses: SessionStatus[] = [];
    session.onStatusChange((status) => statuses.push(status));

    session.disconnect();
    session.destroy();

    expect(statuses).toEqual(['disconnected']);
  });

  it('getCommitReceipts guarda no máximo receiptHistoryLimit recibos, os mais recentes', async () => {
    const { provider } = setup();
    const section = createCanvasSection();
    const connected = await provider.connect({
      documentId: 'doc',
      section,
      receiptHistoryLimit: 3,
    });
    if (!connected.ok) throw new Error(connected.error.code);
    const session = connected.value;
    const all: string[] = [];
    session.onCommitReceipt((receipt) => all.push(receipt.commitId));

    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      addRect(section, id);
      await flush();
    }

    expect(all).toHaveLength(5);
    expect(session.getCommitReceipts().map((receipt) => receipt.commitId)).toEqual(all.slice(2));
    session.destroy();
  });

  it('sem limite informado, guarda até mil recibos', async () => {
    const { provider } = setup();
    const section = createCanvasSection();
    const connected = await provider.connect({ documentId: 'doc', section });
    if (!connected.ok) throw new Error(connected.error.code);
    const session = connected.value;

    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      addRect(section, id);
      await flush();
    }

    expect(session.getCommitReceipts()).toHaveLength(5);
    session.destroy();
  });

  it('commit recusado conta nas pendências, e leave devolve PENDING_CHANGES', async () => {
    const { hub, provider } = setup();
    const section = createCanvasSection();
    const connected = await provider.connect({ documentId: 'doc', section });
    if (!connected.ok) throw new Error(connected.error.code);
    const session = connected.value;
    const counts: number[] = [];
    session.onPendingChange((summary) => counts.push(summary.count));
    hub.failNextCommits(1, 'INVALID_DOCUMENT');

    addRect(section, 'recusado');
    await flush();
    addRect(section, 'aceito');
    await flush();

    expect(session.getPending().count).toBe(1);
    // Sobe com cada commit e só desce quando um é confirmado.
    expect(counts).toEqual([1, 2, 1]);
    const left = await session.leave();
    expect(!left.ok && left.error.code).toBe('PENDING_CHANGES');
    session.destroy();
  });

  it('conteúdo que não coube no backlog conta como pendência até a reconciliação', async () => {
    const { hub, provider } = setup();
    const section = createCanvasSection();
    const connected = await provider.connect({
      documentId: 'doc',
      section,
      maxOfflineBacklogBytes: 64,
    });
    if (!connected.ok) throw new Error(connected.error.code);
    const session = connected.value;
    const counts: number[] = [];
    session.onPendingChange((summary) => counts.push(summary.count));

    hub.dropLink(session.sessionId);
    addRect(section, 'fora-da-fila');
    await flush();
    expect(session.getPending()).toEqual({ count: 1, bytes: 0 });
    hub.restoreLink(session.sessionId);
    await flush();

    expect(session.getPending()).toEqual({ count: 0, bytes: 0 });
    expect(counts).toEqual([1, 0]);
    session.destroy();
  });

  it('quem cancela a inscrição deixa de receber, e a sessão destruída não avisa pendência', async () => {
    const { provider } = setup();
    const section = createCanvasSection();
    const connected = await provider.connect({ documentId: 'doc', section });
    if (!connected.ok) throw new Error(connected.error.code);
    const session = connected.value;
    const counts: number[] = [];
    const unsubscribe = session.onPendingChange((summary) => counts.push(summary.count));

    unsubscribe();
    addRect(section, 'r1');
    await flush();

    expect(counts).toEqual([]);
    session.destroy();
  });

  it('a sessão construída direto com o hub também avisa o ouvinte de ConnectOptions', async () => {
    const server = new CollaborativeServerEmulator('epoch-legado');
    const hub = new DeterministicTransportHub(server);
    const statuses: SessionStatus[] = [];
    const session = new YjsCollaborationSession(
      hub,
      {
        documentId: 'doc',
        section: createCanvasSection(),
        roomEpoch: 'epoch-legado',
        onStatusChange: (status) => statuses.push(status),
      },
      'sess-1',
      server.getSnapshot(),
    );

    await session.leave();

    expect(session.access).toBe('write');
    expect(statuses).toEqual(['connected', 'disconnected']);
  });
});
