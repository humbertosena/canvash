import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindCanvasPresence, type CanvasPresenceSession } from './bind-canvas-presence.js';
import { isPresenceExpired } from './presence.js';
import type { PresenceUpdate, RemotePresence } from './types.js';

const STYLE = { fill: '#ffffff', stroke: null, strokeWidth: 1, opacity: 1 } as const;

function sectionWithNode(): CanvasSectionApi {
  const section = createCanvasSection();
  section.dispatch({
    type: 'shape.create',
    shape: {
      id: 'a',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      visible: true,
      locked: false,
      style: STYLE,
    },
  });
  return section;
}

/** Sessão de teste: guarda o que o vínculo publica e deixa o teste entregar presenças. */
class FakeSession implements CanvasPresenceSession {
  serverTimeOffsetMs: number;
  readonly updates: PresenceUpdate[] = [];
  private presences: RemotePresence[] = [];
  private readonly listeners = new Set<(list: readonly RemotePresence[]) => void>();
  constructor(
    readonly sessionId: string,
    offset = 0,
  ) {
    this.serverTimeOffsetMs = offset;
  }
  updatePresence = (update: PresenceUpdate): void => {
    this.updates.push(update);
  };
  getPresences = (): readonly RemotePresence[] => this.presences;
  onPresenceChange = (listener: (list: readonly RemotePresence[]) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  emit(list: RemotePresence[]): void {
    this.presences = list;
    for (const listener of this.listeners) listener(list);
  }
  lastSelectedAt(): number | undefined {
    for (let index = this.updates.length - 1; index >= 0; index -= 1) {
      const update = this.updates[index];
      if (update !== undefined && 'selectedAt' in update) return update.selectedAt;
    }
    return undefined;
  }
}

function presenceOf(session: FakeSession, selectedAt: number | undefined): RemotePresence {
  return {
    sessionId: session.sessionId,
    userId: `user-${session.sessionId}`,
    color: '#dc2626',
    cursor: null,
    selection: ['a'],
    ...(selectedAt === undefined ? {} : { selectedAt }),
    updatedAt: Date.now(),
    receivedAt: Date.now(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isPresenceExpired: o que vale é a chegada (R18)', () => {
  const base: RemotePresence = {
    sessionId: 's',
    userId: 'u',
    color: '#000000',
    cursor: null,
    selection: [],
    updatedAt: 0,
  };

  it('com receivedAt, o relógio de quem publicou não conta', () => {
    const ahead = { ...base, updatedAt: 1_060_000, receivedAt: 1_000_000 };
    const behind = { ...base, updatedAt: 940_000, receivedAt: 1_000_000 };

    for (const presence of [ahead, behind]) {
      expect(isPresenceExpired(presence, 30_000, 1_000_000)).toBe(false);
      expect(isPresenceExpired(presence, 30_000, 1_030_000)).toBe(false);
      expect(isPresenceExpired(presence, 30_000, 1_030_001)).toBe(true);
    }
  });

  it('sem receivedAt, continua comparando o updatedAt', () => {
    expect(isPresenceExpired({ ...base, updatedAt: 1_000 }, 5_000, 3_000)).toBe(false);
    expect(isPresenceExpired({ ...base, updatedAt: 1_000 }, 5_000, 7_000)).toBe(true);
  });
});

describe('bindCanvasPresence: selectedAt no relógio do servidor (P6)', () => {
  it('carimba selectedAt com o relógio local mais o offset da sessão', () => {
    const session = new FakeSession('me', 5_000);
    const section = sectionWithNode();
    const binding = bindCanvasPresence({ session, section });

    section.setSelection(['a']);

    expect(session.lastSelectedAt()).toBe(1_005_000);
    binding.destroy();
  });

  it('sessão que não informa offset continua carimbando com o relógio local', () => {
    const session: CanvasPresenceSession & { updates: PresenceUpdate[] } = {
      sessionId: 'me',
      updates: [],
      updatePresence(update) {
        this.updates.push(update);
      },
      getPresences: () => [],
      onPresenceChange: () => () => {},
    };
    const section = sectionWithNode();
    const binding = bindCanvasPresence({ session, section });

    section.setSelection(['a']);

    expect(session.updates.at(-1)?.selectedAt).toBe(1_000_000);
    binding.destroy();
  });

  it('uma seleção já publicada não é carimbada de novo quando o offset muda', () => {
    const session = new FakeSession('me', 5_000);
    const section = sectionWithNode();
    const binding = bindCanvasPresence({ session, section });
    section.setSelection(['a']);

    session.serverTimeOffsetMs = -30_000;
    session.emit([]);
    vi.advanceTimersByTime(1_000);

    expect(session.lastSelectedAt()).toBe(1_005_000);
    binding.destroy();
  });

  it('relógios a 60 s de distância: as duas sessões elegem quem selecionou primeiro', () => {
    // B está com o relógio 60 s adiantado; o offset medido no handshake compensa.
    const sessionA = new FakeSession('a-sess', 0);
    const sessionB = new FakeSession('b-sess', -60_000);
    const sectionA = sectionWithNode();
    const sectionB = sectionWithNode();
    const lostA: string[] = [];
    const lostB: string[] = [];
    const bindingA = bindCanvasPresence({
      session: sessionA,
      section: sectionA,
      onLockLost: (nodeId, holder) => lostA.push(`${nodeId}:${holder.sessionId}`),
    });
    const bindingB = bindCanvasPresence({
      session: sessionB,
      section: sectionB,
      now: () => Date.now() + 60_000,
      onLockLost: (nodeId, holder) => lostB.push(`${nodeId}:${holder.sessionId}`),
    });

    // B seleciona primeiro; A, um segundo depois.
    sectionB.setSelection(['a']);
    vi.advanceTimersByTime(1_000);
    sectionA.setSelection(['a']);
    const stampA = sessionA.lastSelectedAt();
    const stampB = sessionB.lastSelectedAt();
    sessionA.emit([presenceOf(sessionB, stampB)]);
    sessionB.emit([presenceOf(sessionA, stampA)]);

    // No relógio do servidor, B veio 1 s antes, apesar de o relógio dele marcar 60 s depois.
    expect(stampB).toBe(1_000_000);
    expect(stampA).toBe(1_001_000);
    expect(lostA).toEqual(['a:b-sess']);
    expect(lostB).toEqual([]);
    expect(sectionA.getSnapshot().session.selectedIds).toEqual([]);
    expect(sectionB.getSnapshot().session.selectedIds).toEqual(['a']);
    bindingA.destroy();
    bindingB.destroy();
  });
});
