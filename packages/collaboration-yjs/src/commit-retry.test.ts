import type { CollaborationError, SessionStatus } from '@canvash/collaboration';
import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YjsCollaborationProvider } from './provider.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { DeterministicTransportHub } from './transport.js';

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

async function connected() {
  const server = new CollaborativeServerEmulator();
  const hub = new DeterministicTransportHub(server);
  const provider = new YjsCollaborationProvider({ server, transport: hub });
  const section = createCanvasSection();
  const result = await provider.connect({ documentId: 'doc-reenvio', section });
  if (!result.ok) throw new Error(result.error.code);
  const session = result.value;
  const changes: Array<[SessionStatus, CollaborationError['code'] | undefined]> = [];
  session.onStatusChange((status, error) => changes.push([status, error?.code]));
  const receipts: string[] = [];
  session.onCommitReceipt((receipt) => receipts.push(receipt.commitId));
  return { server, hub, section, session, changes, receipts };
}

beforeEach(() => {
  vi.useFakeTimers();
  // Sorteio no teto: as esperas são exatamente 500 ms, 1 s, 2 s...
  vi.spyOn(Math, 'random').mockReturnValue(1 - Number.EPSILON);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('reenvio com o enlace aberto (US-P.10)', () => {
  it('o armazenamento falha duas vezes e depois aceita: recibo sem queda do enlace, e leave devolve ok', async () => {
    const { server, hub, section, session, changes, receipts } = await connected();
    hub.failNextCommits(2, 'STORAGE_UNAVAILABLE');

    addRect(section, 'r1');
    await flush();
    expect(receipts).toEqual([]);
    expect(server.getLog()).toEqual([]);

    // Primeira nova tentativa em até 0,5 s: falha de novo.
    await vi.advanceTimersByTimeAsync(499);
    expect(changes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(changes).toHaveLength(2);
    expect(receipts).toEqual([]);

    // Segunda, em até 1 s: aceita.
    await vi.advanceTimersByTimeAsync(999);
    expect(receipts).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await flush();

    expect(receipts).toHaveLength(1);
    expect(server.getLog().map((entry) => entry.commitId)).toEqual(receipts);
    // Avisos, sem transição: o enlace nunca caiu.
    expect(changes).toEqual([
      ['connected', 'STORAGE_UNAVAILABLE'],
      ['connected', 'STORAGE_UNAVAILABLE'],
    ]);
    expect(session.status).toBe('connected');
    expect((await session.leave()).ok).toBe(true);
  });

  it('uma rodada com sucesso zera o backoff', async () => {
    const { hub, section, session, receipts } = await connected();

    hub.failNextCommits(2, 'STORAGE_UNAVAILABLE');
    addRect(section, 'r1');
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    expect(receipts).toHaveLength(1);

    // A próxima falha volta a esperar 0,5 s, não 2 s.
    hub.failNextCommits(1, 'STORAGE_UNAVAILABLE');
    addRect(section, 'r2');
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    await flush();

    expect(receipts).toHaveLength(2);
    session.destroy();
  });

  it('vários commits que falharam são reenviados juntos, em ordem, pelo mesmo commitId', async () => {
    const { server, hub, section, session, receipts } = await connected();
    hub.failNextCommits(2, 'STORAGE_UNAVAILABLE');

    addRect(section, 'r1');
    addRect(section, 'r2');
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    await flush();

    expect(receipts).toHaveLength(2);
    expect(server.getLog().map((entry) => entry.commitId)).toEqual(receipts);
    expect(new Set(receipts).size).toBe(2);
    session.destroy();
  });

  it('commit recusado de vez não entra na rodada de reenvio', async () => {
    const { server, hub, section, session, receipts } = await connected();
    hub.failNextCommits(1, 'INVALID_DOCUMENT');
    addRect(section, 'recusado');
    await flush();
    hub.failNextCommits(1, 'STORAGE_UNAVAILABLE');
    addRect(section, 'transitorio');
    await flush();

    await vi.advanceTimersByTimeAsync(500);
    await flush();

    expect(receipts).toHaveLength(1);
    expect(server.getLog()).toHaveLength(1);
    const left = await session.leave();
    expect(!left.ok && left.error.details).toEqual({ pendingCount: 1 });
    session.destroy();
  });

  it('se o enlace cai durante a espera, a rodada não envia: o reenvio fica com a volta do enlace', async () => {
    const { server, hub, section, session, receipts } = await connected();
    hub.failNextCommits(1, 'STORAGE_UNAVAILABLE');
    addRect(section, 'r1');
    await flush();

    hub.dropLink(session.sessionId);
    await vi.advanceTimersByTimeAsync(500);
    await flush();
    expect(server.getLog()).toEqual([]);

    hub.restoreLink(session.sessionId);
    await flush();

    expect(receipts).toHaveLength(1);
    expect(session.status).toBe('connected');
    session.destroy();
  });

  it('destroy e disconnect durante a espera cancelam o timer do reenvio', async () => {
    const first = await connected();
    first.hub.failNextCommits(1, 'STORAGE_UNAVAILABLE');
    addRect(first.section, 'r1');
    await flush();
    first.session.destroy();

    const second = await connected();
    second.hub.failNextCommits(1, 'STORAGE_UNAVAILABLE');
    addRect(second.section, 'r1');
    await flush();
    second.session.disconnect();
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();

    expect(first.server.getLog()).toEqual([]);
    expect(second.server.getLog()).toEqual([]);
    second.session.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
