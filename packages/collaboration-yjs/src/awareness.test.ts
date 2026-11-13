import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AwarenessManager, type LocalAwarenessState } from './awareness.js';

const USER = { id: 'u1', name: 'Ana', color: '#2563eb' };

function remoteState(overrides: Partial<LocalAwarenessState> = {}): LocalAwarenessState {
  return {
    sessionId: 'remote-1',
    userId: 'ur',
    userName: 'Remota',
    color: '#dc2626',
    cursor: null,
    selection: [],
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('AwarenessManager: campos novos, heartbeat e validação', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mantém o participante parado nos pares por 60 s com o heartbeat (US-PC.2)', () => {
    const sender = new AwarenessManager('a', USER, (state) => {
      if (state) receiver.handleRemoteUpdate(state);
    });
    const receiver = new AwarenessManager('b', { id: 'u2', color: '#16a34a' }, () => {});
    sender.updateLocal({ cursor: { x: 1, y: 2 } });

    vi.advanceTimersByTime(60_000);

    expect(receiver.getPresences().map((p) => p.sessionId)).toEqual(['a']);
    sender.destroy();
    receiver.destroy();
  });

  it('sem heartbeat a presença expira em 30 s', () => {
    const receiver = new AwarenessManager('b', { id: 'u2', color: '#16a34a' }, () => {});
    receiver.handleRemoteUpdate(remoteState({ updatedAt: Date.now() }));
    expect(receiver.getPresences()).toHaveLength(1);

    vi.advanceTimersByTime(31_000);

    expect(receiver.getPresences()).toHaveLength(0);
    receiver.destroy();
  });

  it('respeita o timeout configurado e reenvia a cada um terço dele', () => {
    const sent: Array<LocalAwarenessState | null> = [];
    const manager = new AwarenessManager('a', USER, (state) => sent.push(state), 3_000);

    vi.advanceTimersByTime(3_000);

    expect(sent.filter(Boolean).length).toBeGreaterThanOrEqual(2);
    manager.destroy();
  });

  it('o heartbeat não muda selectedAt nem a seleção', () => {
    const sent: LocalAwarenessState[] = [];
    const manager = new AwarenessManager('a', USER, (state) => state && sent.push(state));
    manager.updateLocal({ selection: ['n1'], selectedAt: 555 });

    vi.advanceTimersByTime(35_000);

    const last = sent.at(-1)!;
    expect(sent.length).toBeGreaterThan(1);
    expect(last.selectedAt).toBe(555);
    expect(last.selection).toEqual(['n1']);
    manager.destroy();
  });

  it('leva drag, view e avatarUrl do estado local e para a presença remota', () => {
    const sent: LocalAwarenessState[] = [];
    const manager = new AwarenessManager(
      'a',
      { ...USER, avatarUrl: 'https://x.com/a.png' },
      (state) => state && sent.push(state),
    );
    manager.updateLocal({
      drag: { ids: ['n1'], dx: 4, dy: 5 },
      view: { center: { x: 1, y: 2 }, zoom: 2 },
    });
    expect(sent.at(-1)).toMatchObject({
      avatarUrl: 'https://x.com/a.png',
      drag: { ids: ['n1'], dx: 4, dy: 5 },
      view: { center: { x: 1, y: 2 }, zoom: 2 },
    });

    const receiver = new AwarenessManager('b', { id: 'u2', color: '#16a34a' }, () => {});
    receiver.handleRemoteUpdate(sent.at(-1)!);
    expect(receiver.getPresences()[0]).toMatchObject({
      avatarUrl: 'https://x.com/a.png',
      drag: { ids: ['n1'], dx: 4, dy: 5 },
      view: { center: { x: 1, y: 2 }, zoom: 2 },
    });
    manager.destroy();
    receiver.destroy();
  });

  it('descarta presença inválida, avisa onInvalid e mantém a anterior', () => {
    const invalid: unknown[] = [];
    const receiver = new AwarenessManager(
      'b',
      { id: 'u2', color: '#16a34a' },
      () => {},
      30_000,
      (violation) => invalid.push(violation),
    );
    receiver.handleRemoteUpdate(remoteState({ cursor: { x: 1, y: 1 } }));

    receiver.handleRemoteUpdate(
      remoteState({ cursor: { x: NaN, y: 0 }, updatedAt: Date.now() + 1 }),
    );
    receiver.handleRemoteUpdate(remoteState({ color: 'vermelho', updatedAt: Date.now() + 2 }));

    expect(receiver.getPresences()).toHaveLength(1);
    expect(receiver.getPresences()[0]?.cursor).toEqual({ x: 1, y: 1 });
    expect(invalid).toEqual([
      { reason: 'NOT_FINITE', field: 'cursor.x' },
      { reason: 'INVALID_COLOR', field: 'color' },
    ]);
    receiver.destroy();
  });

  it('uma presença inválida de quem ainda não estava na lista não a cria', () => {
    const receiver = new AwarenessManager('b', { id: 'u2', color: '#16a34a' }, () => {});
    receiver.handleRemoteUpdate({ ...remoteState(), extra: 1 } as unknown as LocalAwarenessState);

    expect(receiver.getPresences()).toHaveLength(0);
    receiver.destroy();
  });

  it('presença atrasada ou duplicada não sobrescreve a mais nova (vale o último updatedAt)', () => {
    const receiver = new AwarenessManager('b', { id: 'u2', color: '#16a34a' }, () => {});
    receiver.handleRemoteUpdate(remoteState({ cursor: { x: 9, y: 9 }, updatedAt: 2000 }));
    receiver.handleRemoteUpdate(remoteState({ cursor: { x: 1, y: 1 }, updatedAt: 1000 }));
    receiver.handleRemoteUpdate(remoteState({ cursor: { x: 9, y: 9 }, updatedAt: 2000 }));

    expect(receiver.getPresences()).toHaveLength(1);
    expect(receiver.getPresences()[0]?.cursor).toEqual({ x: 9, y: 9 });
    receiver.destroy();
  });

  it('ao conhecer alguém novo, responde na hora com o próprio estado, uma vez só', () => {
    const sent: LocalAwarenessState[] = [];
    const manager = new AwarenessManager('a', USER, (state) => state && sent.push(state));
    manager.updateLocal({ cursor: { x: 1, y: 1 } });
    const before = sent.length;

    manager.handleRemoteUpdate(remoteState({ sessionId: 'novo', updatedAt: Date.now() }));
    expect(sent.length).toBe(before + 1);
    expect(sent.at(-1)).toMatchObject({ sessionId: 'a', cursor: { x: 1, y: 1 } });

    manager.handleRemoteUpdate(remoteState({ sessionId: 'novo', updatedAt: Date.now() + 5 }));
    expect(sent.length).toBe(before + 1);
    manager.destroy();
  });

  it('flush envia na hora o último estado, como o drag nulo ao soltar', () => {
    const sent: LocalAwarenessState[] = [];
    const manager = new AwarenessManager('a', USER, (state) => state && sent.push(state));
    manager.updateLocal({ drag: { ids: ['n1'], dx: 1, dy: 1 } });
    manager.updateLocal({ drag: null });

    manager.flush();

    expect(sent.at(-1)?.drag).toBeNull();
    manager.destroy();
  });
});
