import { DEFAULT_PRESENCE_TIMEOUT_MS, MAX_PRESENCE_RATE_HZ } from './limits.js';
import type { PresenceUpdate, RemotePresence } from './types.js';

export function isPresenceExpired(
  presence: RemotePresence,
  timeoutMs = DEFAULT_PRESENCE_TIMEOUT_MS,
  now = Date.now(),
): boolean {
  return now - presence.updatedAt > timeoutMs;
}

export interface PresenceThrottler {
  update(update: PresenceUpdate): void;
  flush(): void;
  destroy(): void;
}

/**
 * Cria um throttle com janela máxima de 20 atualizações/s (50 ms) por participante.
 * Descarta updates intermediários e garante envio do último estado no término da janela.
 */
export function createPresenceThrottler(
  onEmit: (update: PresenceUpdate) => void,
  maxRateHz = MAX_PRESENCE_RATE_HZ,
): PresenceThrottler {
  const minIntervalMs = Math.floor(1000 / Math.max(1, maxRateHz));
  let pendingUpdate: PresenceUpdate | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastEmitTime = 0;
  let isDestroyed = false;

  function emitNow(update: PresenceUpdate) {
    if (isDestroyed) return;
    lastEmitTime = Date.now();
    onEmit(update);
  }

  function scheduleEmit() {
    if (timer !== null || isDestroyed) return;
    const now = Date.now();
    const elapsed = now - lastEmitTime;
    const remaining = Math.max(0, minIntervalMs - elapsed);

    timer = setTimeout(() => {
      timer = null;
      if (pendingUpdate !== null && !isDestroyed) {
        const updateToSend = pendingUpdate;
        pendingUpdate = null;
        emitNow(updateToSend);
      }
    }, remaining);
  }

  return {
    update(update: PresenceUpdate) {
      if (isDestroyed) return;
      pendingUpdate = { ...pendingUpdate, ...update };
      const now = Date.now();
      if (now - lastEmitTime >= minIntervalMs && timer === null) {
        const updateToSend = pendingUpdate;
        pendingUpdate = null;
        emitNow(updateToSend);
      } else {
        scheduleEmit();
      }
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (pendingUpdate !== null && !isDestroyed) {
        const updateToSend = pendingUpdate;
        pendingUpdate = null;
        emitNow(updateToSend);
      }
    },
    destroy() {
      isDestroyed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pendingUpdate = null;
    },
  };
}
