import type { CollaborationSession } from '@canvash/collaboration';
import { createCanvasSection } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AwarenessManager, type LocalAwarenessState } from './awareness.js';
import { YjsCollaborationProvider } from './provider.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { YjsCollaborationSession } from './session.js';
import { DeterministicTransportHub } from './transport.js';

const USER = { id: 'u-local', color: '#16a34a' };

function remoteState(overrides: Partial<LocalAwarenessState> = {}): LocalAwarenessState {
  return {
    sessionId: 'remota',
    userId: 'u-remota',
    userName: 'Remota',
    color: '#dc2626',
    cursor: { x: 1, y: 2 },
    selection: [],
    updatedAt: Date.now(),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('presença imune a relógio desalinhado (US-P.13, R18)', () => {
  it.each([
    ['adiantado em 60 s', 60_000],
    ['atrasado em 60 s', -60_000],
  ])(
    'emissor %s: a presença aparece e expira um timeout depois da última chegada',
    (_name, skew) => {
      const receiver = new AwarenessManager('local', USER, () => {});

      receiver.handleRemoteUpdate(remoteState({ updatedAt: Date.now() + skew }));
      expect(receiver.getPresences()).toHaveLength(1);
      expect(receiver.getPresences()[0]?.receivedAt).toBe(1_000_000);

      vi.advanceTimersByTime(29_000);
      expect(receiver.getPresences()).toHaveLength(1);

      // Nova chegada: o prazo recomeça dela, não do carimbo de quem publicou.
      receiver.handleRemoteUpdate(remoteState({ updatedAt: Date.now() + skew }));
      vi.advanceTimersByTime(29_000);
      expect(receiver.getPresences()).toHaveLength(1);

      vi.advanceTimersByTime(2_000);
      expect(receiver.getPresences()).toHaveLength(0);
      receiver.destroy();
    },
  );

  it('duas mensagens da mesma sessão continuam ordenadas pelo relógio de quem publica', () => {
    const receiver = new AwarenessManager('local', USER, () => {});

    receiver.handleRemoteUpdate(remoteState({ cursor: { x: 9, y: 9 }, updatedAt: 2_000 }));
    receiver.handleRemoteUpdate(remoteState({ cursor: { x: 1, y: 1 }, updatedAt: 1_000 }));

    expect(receiver.getPresences()[0]?.cursor).toEqual({ x: 9, y: 9 });
    receiver.destroy();
  });

  it('pela sessão: presença de emissor com relógio a 60 s não some ao chegar nem dura além do prazo', async () => {
    const server = new CollaborativeServerEmulator();
    const hub = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport: hub });
    const connected = await provider.connect({
      documentId: 'doc',
      section: createCanvasSection(),
    });
    if (!connected.ok) throw new Error(connected.error.code);
    const session = connected.value;

    hub.sendPresence('atrasada', remoteState({ sessionId: 'atrasada', updatedAt: 940_000 }));
    hub.sendPresence('adiantada', remoteState({ sessionId: 'adiantada', updatedAt: 1_060_000 }));
    await flush();
    expect(
      session
        .getPresences()
        .map((presence) => presence.sessionId)
        .sort(),
    ).toEqual(['adiantada', 'atrasada']);

    vi.advanceTimersByTime(29_000);
    expect(session.getPresences()).toHaveLength(2);
    vi.advanceTimersByTime(3_000);
    expect(session.getPresences()).toHaveLength(0);
    session.destroy();
  });
});

describe('offset do relógio do servidor na sessão (P6)', () => {
  it('é medido no welcome e de novo a cada volta do enlace', async () => {
    let serverClock = 1_005_000;
    const server = new CollaborativeServerEmulator('epoch-1', undefined, {
      now: () => serverClock,
    });
    const hub = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport: hub });
    const connected = await provider.connect({
      documentId: 'doc',
      section: createCanvasSection(),
    });
    if (!connected.ok) throw new Error(connected.error.code);
    // Tipado pela interface: é dela que o vínculo de presença lê o offset.
    const session: CollaborationSession = connected.value;

    expect(session.serverTimeOffsetMs).toBe(5_000);

    serverClock = 999_000;
    hub.dropLink(session.sessionId);
    hub.restoreLink(session.sessionId);
    await flush();

    expect(session.serverTimeOffsetMs).toBe(-1_000);
    session.destroy();
  });

  it('sessão construída direto com o hub, sem handshake, fica com offset zero', () => {
    const server = new CollaborativeServerEmulator('epoch-legado');
    const hub = new DeterministicTransportHub(server);
    const session = new YjsCollaborationSession(
      hub,
      { documentId: 'doc', section: createCanvasSection(), roomEpoch: 'epoch-legado' },
      'sess-1',
      server.getSnapshot(),
    );

    expect(session.serverTimeOffsetMs).toBe(0);
    session.destroy();
  });
});
