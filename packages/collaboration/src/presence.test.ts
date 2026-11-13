import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPresenceThrottler, isPresenceExpired } from './presence.js';
import type { RemotePresence } from './types.js';

describe('Gestão de Presença Efêmera (COLLAB-05)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('detecta expiração de presença após tempo limite', () => {
    const presence: RemotePresence = {
      sessionId: 's1',
      userId: 'u1',
      color: '#ff0000',
      cursor: { x: 10, y: 20 },
      selection: [],
      updatedAt: 1000,
    };

    expect(isPresenceExpired(presence, 5000, 3000)).toBe(false);
    expect(isPresenceExpired(presence, 5000, 7000)).toBe(true);
  });

  it('limita emissões a no máximo 20 Hz (50 ms) agrupando updates intermediários', () => {
    const emitted: unknown[] = [];
    const throttler = createPresenceThrottler((update) => {
      emitted.push(update);
    }, 20);

    // Primeiro envio dispara imediatamente
    throttler.update({ cursor: { x: 1, y: 1 } });
    expect(emitted.length).toBe(1);

    // 10 atualizações rápidas em 20 ms
    for (let i = 2; i <= 10; i++) {
      vi.advanceTimersByTime(2);
      throttler.update({ cursor: { x: i, y: i } });
    }

    // Ainda não emitiu os intermediários pois não passou a janela de 50 ms
    expect(emitted.length).toBe(1);

    // Avança além dos 50 ms para completar a janela
    vi.advanceTimersByTime(40);
    expect(emitted.length).toBe(2);
    expect(emitted[1]).toEqual({ cursor: { x: 10, y: 10 } });

    throttler.destroy();
  });

  it('flush emite imediatamente pendências ativas', () => {
    const emitted: unknown[] = [];
    const throttler = createPresenceThrottler((u) => emitted.push(u), 20);

    throttler.update({ cursor: { x: 10, y: 10 } });
    expect(emitted.length).toBe(1);

    throttler.update({ cursor: { x: 50, y: 50 } });
    expect(emitted.length).toBe(1);

    throttler.flush();
    expect(emitted.length).toBe(2);
    expect(emitted[1]).toEqual({ cursor: { x: 50, y: 50 } });

    throttler.destroy();
  });
});
