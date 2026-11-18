import type { CollaborationSession, PresenceViolation } from '@canvash/collaboration';
import { createCanvasSection } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalAwarenessState } from './awareness.js';
import { YjsCollaborationProvider } from './provider.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { YjsCollaborationSession } from './session.js';
import { DeterministicTransportHub } from './transport.js';

async function flush(): Promise<void> {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
}

async function pair() {
  const server = new CollaborativeServerEmulator();
  const hub = new DeterministicTransportHub(server);
  const provider = new YjsCollaborationProvider({ server, transport: hub });
  const violations: PresenceViolation[] = [];
  const a = await provider.connect({
    documentId: 'doc',
    section: createCanvasSection(),
    user: { id: 'user-a', name: 'Ana', color: '#ff0000' },
  });
  const b = await provider.connect({
    documentId: 'doc',
    section: createCanvasSection(),
    user: { id: 'user-b', name: 'Bia', color: '#00ff00' },
    onPresenceError: (violation) => violations.push(violation),
  });
  if (!a.ok || !b.ok) throw new Error('conexão recusada');
  return { hub, a: a.value, b: b.value, violations };
}

function forged(sessionId: string): LocalAwarenessState {
  return {
    sessionId,
    userId: 'user-forjado',
    userName: 'Forjado',
    color: '#000000',
    cursor: { x: 9, y: 9 },
    selection: [],
    updatedAt: Date.now() + 60_000,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('identidade da presença (R16)', () => {
  it('presença com o sessionId de outra sessão é descartada e avisada', async () => {
    const { hub, a, b, violations } = await pair();
    a.updatePresence({ cursor: { x: 1, y: 1 } });
    await flush();
    expect(b.getPresences().map((presence) => presence.sessionId)).toEqual([a.sessionId]);

    // Um terceiro publica dizendo ser A: o envelope traz o remetente de verdade.
    hub.sendPresence('sess-impostor', forged(a.sessionId));
    await flush();

    const seen = b.getPresences();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.userId).toBe('user-a');
    expect(seen[0]?.cursor).toEqual({ x: 1, y: 1 });
    expect(violations).toEqual([{ reason: 'SESSION_MISMATCH', field: 'sessionId' }]);
    a.destroy();
    b.destroy();
  });

  it('presença em que o remetente é quem diz ser entra normalmente', async () => {
    const { hub, a, b, violations } = await pair();

    hub.sendPresence('sess-c', forged('sess-c'));
    await flush();

    expect(b.getPresences().map((presence) => presence.sessionId)).toContain('sess-c');
    expect(violations).toEqual([]);
    a.destroy();
    b.destroy();
  });

  it('a mensagem no formato antigo também é conferida contra o remetente', () => {
    const server = new CollaborativeServerEmulator('epoch-legado');
    const hub = new DeterministicTransportHub(server);
    const violations: PresenceViolation[] = [];
    const session = new YjsCollaborationSession(
      hub,
      {
        documentId: 'doc',
        section: createCanvasSection(),
        roomEpoch: 'epoch-legado',
        onPresenceError: (violation) => violations.push(violation),
      },
      'sess-1',
      server.getSnapshot(),
    );

    session.handleTransportMessage({
      type: 'presence',
      senderSessionId: 'sess-impostor',
      payload: forged('sess-vitima'),
    });

    expect(session.getPresences()).toEqual([]);
    expect(violations).toEqual([{ reason: 'SESSION_MISMATCH', field: 'sessionId' }]);
    session.destroy();
  });
});

describe('presença depois da queda e envio imediato (R17)', () => {
  it('depois da volta do enlace, os pares veem a sessão sem esperar o heartbeat', async () => {
    const { hub, a, b } = await pair();
    a.updatePresence({ cursor: { x: 5, y: 6 } });
    await flush();

    hub.dropLink(a.sessionId);
    await flush();
    expect(b.getPresences()).toEqual([]);
    hub.restoreLink(a.sessionId);
    await flush();

    // Nenhum timer avançou: não foi o heartbeat que trouxe a presença de volta.
    const seen = b.getPresences();
    expect(seen.map((presence) => presence.sessionId)).toEqual([a.sessionId]);
    expect(seen[0]?.cursor).toEqual({ x: 5, y: 6 });
    a.destroy();
    b.destroy();
  });

  it('reconnect() explícito também reanuncia a presença', async () => {
    const { a, b } = await pair();
    a.updatePresence({ cursor: { x: 5, y: 6 } });
    await flush();

    a.disconnect();
    await flush();
    expect(b.getPresences()).toEqual([]);
    await a.reconnect();
    await flush();

    expect(b.getPresences().map((presence) => presence.sessionId)).toEqual([a.sessionId]);
    a.destroy();
    b.destroy();
  });

  it('flushPresence envia já o que o throttle estava segurando', async () => {
    const { a, b } = await pair();
    // Tipado pela interface: o host não precisa da classe concreta.
    const session: CollaborationSession = a;
    session.updatePresence({ cursor: { x: 1, y: 1 } });
    await flush();
    session.updatePresence({ cursor: { x: 2, y: 2 } });
    await flush();
    expect(b.getPresences()[0]?.cursor).toEqual({ x: 1, y: 1 });

    session.flushPresence();
    await flush();

    expect(b.getPresences()[0]?.cursor).toEqual({ x: 2, y: 2 });
    a.destroy();
    b.destroy();
  });

  it('flushPresence depois de destroy não faz nada', async () => {
    const { a, b } = await pair();
    a.destroy();

    expect(() => a.flushPresence()).not.toThrow();
    b.destroy();
  });
});
