import type { CollaborationError, SessionStatus } from '@canvash/collaboration';
import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
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

function nodeIds(section: CanvasSectionApi): string[] {
  return Object.keys(section.getSnapshot().document.nodes).sort();
}

/**
 * Tamanho, em bytes, do commit de um retângulo numa sessão que já editou: os limites dos testes
 * são múltiplos dele. O primeiro commit de uma sessão é maior, porque leva também as camadas.
 */
async function rectCommitBytes(): Promise<number> {
  const server = new CollaborativeServerEmulator();
  const provider = new YjsCollaborationProvider({
    server,
    transport: new DeterministicTransportHub(server),
  });
  const section = createCanvasSection();
  const connected = await provider.connect({ documentId: 'medida', section });
  if (!connected.ok) throw new Error(connected.error.code);
  addRect(section, 'primeiro');
  await flush();
  addRect(section, 'medida');
  await flush();
  const bytes = server.getLog()[1]?.update.byteLength ?? 0;
  connected.value.destroy();
  return bytes;
}

async function room(maxOfflineBacklogBytes: number) {
  const server = new CollaborativeServerEmulator();
  const hub = new DeterministicTransportHub(server);
  const provider = new YjsCollaborationProvider({ server, transport: hub });
  const sectionA = createCanvasSection();
  const sectionB = createCanvasSection();
  const a = await provider.connect({
    documentId: 'doc',
    section: sectionA,
    maxOfflineBacklogBytes,
  });
  const b = await provider.connect({ documentId: 'doc', section: sectionB });
  if (!a.ok || !b.ok) throw new Error('conexão recusada');
  const changes: Array<[SessionStatus, CollaborationError | undefined]> = [];
  a.value.onStatusChange((status, error) => changes.push([status, error]));
  const receipts: string[] = [];
  a.value.onCommitReceipt((receipt) => receipts.push(receipt.commitId));
  return { server, hub, sectionA, sectionB, session: a.value, other: b.value, changes, receipts };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('backlog cheio e reconciliação (US-P.11)', () => {
  it('uma edição offline que estoura o limite converge com o servidor depois da volta do enlace', async () => {
    const { server, hub, sectionA, sectionB, session, changes, receipts } = await room(64);

    hub.dropLink(session.sessionId);
    addRect(sectionA, 'r1');
    addRect(sectionA, 'r2');
    await flush();

    // O aviso informa o limite configurado, uma vez, e o conteúdo fica no documento local.
    expect(session.status).toBe('error');
    expect(changes.map(([status, error]) => [status, error?.code])).toEqual([
      ['reconnecting', undefined],
      ['error', 'LIMIT_EXCEEDED'],
    ]);
    const error = changes[1]?.[1];
    expect(error?.message).toContain('64 bytes');
    expect(error?.message).not.toContain('20 MiB');
    expect(error?.details).toMatchObject({ limitBytes: 64, currentBacklogBytes: 0 });
    expect(nodeIds(sectionA)).toEqual(['r1', 'r2']);
    const left = await session.leave();
    expect(!left.ok && left.error.code).toBe('PENDING_CHANGES');

    hub.restoreLink(session.sessionId);
    await flush();

    expect(nodeIds(sectionB)).toEqual(['r1', 'r2']);
    expect(session.status).toBe('connected');
    expect(changes.map(([status]) => status)).toEqual(['reconnecting', 'error', 'connected']);
    // Um commit de reconciliação levou tudo.
    expect(server.getLog()).toHaveLength(1);
    expect(receipts).toEqual(server.getLog().map((entry) => entry.commitId));
    expect((await session.leave()).ok).toBe(true);
  });

  it('a reconciliação substitui as pendências e não leva de novo o que o servidor já tinha', async () => {
    const oneRect = await rectCommitBytes();
    const { server, hub, sectionA, sectionB, session } = await room(Math.floor(oneRect * 1.5));
    addRect(sectionA, 'confirmado');
    await flush();
    const before = server.getSnapshot();

    hub.dropLink(session.sessionId);
    addRect(sectionA, 'na-fila');
    addRect(sectionA, 'estourou');
    await flush();
    expect(session.status).toBe('error');
    hub.restoreLink(session.sessionId);
    await flush();

    expect(nodeIds(sectionB)).toEqual(['confirmado', 'estourou', 'na-fila']);
    expect(session.status).toBe('connected');
    // Só entrou o commit de reconciliação: a pendência foi coberta por ele.
    expect(server.getLog()).toHaveLength(2);
    const reconciliation = server.getLog()[1]?.update ?? new Uint8Array();
    expect(reconciliation.byteLength).toBeLessThan(server.getSnapshot().byteLength);
    // Sozinho, ele não reconstrói o que já estava confirmado...
    const alone = new Y.Doc();
    Y.applyUpdate(alone, reconciliation);
    expect(alone.getMap('shapes').has('confirmado')).toBe(false);
    // ...e, sobre o estado anterior do servidor, traz exatamente o que faltava.
    const onTop = new Y.Doc();
    Y.applyUpdate(onTop, before);
    Y.applyUpdate(onTop, reconciliation);
    expect([...onTop.getMap('shapes').keys()].sort()).toEqual([
      'confirmado',
      'estourou',
      'na-fila',
    ]);
    expect((await session.leave()).ok).toBe(true);
  });

  it('o que se edita enquanto a reconciliação está em voo também chega', async () => {
    vi.useFakeTimers();
    const { hub, sectionA, sectionB, session } = await room(64);
    hub.dropLink(session.sessionId);
    addRect(sectionA, 'r1');
    await flush();

    hub.setNetworkOptions({ delayMs: 20 });
    hub.restoreLink(session.sessionId);
    addRect(sectionA, 'durante');
    await vi.advanceTimersByTimeAsync(20);
    await flush();
    await vi.advanceTimersByTimeAsync(20);
    await flush();
    // O reanúncio de presença também viaja com atraso: deixa a rede simulada esvaziar.
    await vi.advanceTimersByTimeAsync(100);
    await hub.settle();

    expect(nodeIds(sectionB)).toEqual(['durante', 'r1']);
    expect(session.status).toBe('connected');
    expect((await session.leave()).ok).toBe(true);
  });

  it('com o enlace aberto, a reconciliação sai quando a fila esvazia', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1 - Number.EPSILON);
    const oneRect = await rectCommitBytes();
    const { server, hub, sectionA, sectionB, session, changes } = await room(
      Math.floor(oneRect * 1.5),
    );
    addRect(sectionA, 'antes');
    await flush();
    hub.failNextCommits(1, 'STORAGE_UNAVAILABLE');

    addRect(sectionA, 'na-fila');
    await flush();
    addRect(sectionA, 'estourou');
    await flush();
    expect(session.status).toBe('error');
    expect(server.getLog()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(500);
    await flush();

    expect(nodeIds(sectionB)).toEqual(['antes', 'estourou', 'na-fila']);
    expect(session.status).toBe('connected');
    expect(changes.map(([status, error]) => [status, error?.code])).toEqual([
      ['connected', 'STORAGE_UNAVAILABLE'],
      ['error', 'LIMIT_EXCEEDED'],
      ['connected', undefined],
    ]);
    expect((await session.leave()).ok).toBe(true);
  });

  it('reconciliação recusada por tamanho deixa a sessão em error, com as mudanças para o host exportar', async () => {
    const { hub, sectionA, session, changes } = await room(64);
    hub.dropLink(session.sessionId);
    addRect(sectionA, 'r1');
    await flush();

    hub.failNextCommits(1, 'LIMIT_EXCEEDED');
    hub.restoreLink(session.sessionId);
    await flush();

    expect(session.status).toBe('error');
    expect(changes.at(-1)?.[1]?.code).toBe('LIMIT_EXCEEDED');
    expect(nodeIds(sectionA)).toEqual(['r1']);
    const left = await session.leave();
    expect(!left.ok && left.error.code).toBe('PENDING_CHANGES');
    session.destroy();
  });

  it('sessão construída direto com o hub: disconnect, estouro e reconnect convergem', async () => {
    const server = new CollaborativeServerEmulator('epoch-legado');
    const hub = new DeterministicTransportHub(server);
    const section = createCanvasSection();
    const session = new YjsCollaborationSession(
      hub,
      { documentId: 'doc', section, roomEpoch: 'epoch-legado', maxOfflineBacklogBytes: 64 },
      'sess-1',
      server.getSnapshot(),
    );
    const statuses: SessionStatus[] = [];
    session.onStatusChange((status) => statuses.push(status));

    session.disconnect();
    addRect(section, 'r1');
    await flush();
    expect(session.status).toBe('error');
    const result = await session.reconnect();
    await flush();

    expect(result.ok).toBe(true);
    expect(session.status).toBe('connected');
    expect(statuses).toEqual(['disconnected', 'error', 'reconnecting', 'connected']);
    const roomDoc = new Y.Doc();
    Y.applyUpdate(roomDoc, server.getSnapshot());
    expect(roomDoc.getMap('shapes').has('r1')).toBe(true);
    expect((await session.leave()).ok).toBe(true);
  });
});
