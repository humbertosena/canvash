import {
  createPresenceThrottler,
  DEFAULT_PRESENCE_TIMEOUT_MS,
  isPresenceExpired,
  validatePresence,
  type PresenceDrag,
  type PresenceThrottler,
  type PresenceUpdate,
  type PresenceUser,
  type PresenceView,
  type PresenceViolation,
  type RemotePresence,
} from '@canvash/collaboration';

export interface LocalAwarenessState {
  readonly sessionId: string;
  readonly userId: string;
  userName?: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selection: readonly string[];
  selectedAt?: number;
  drag?: PresenceDrag | null;
  view?: PresenceView | null;
  avatarUrl?: string;
  updatedAt: number;
}

/** Intervalo da limpeza de presenças expiradas. */
const PURGE_INTERVAL_MS = 1000;

export class AwarenessManager {
  private localState: LocalAwarenessState;
  private readonly remotePresences = new Map<string, RemotePresence>();
  private readonly listeners = new Set<(presences: readonly RemotePresence[]) => void>();
  private throttler: PresenceThrottler;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private isDestroyed = false;

  constructor(
    sessionId: string,
    user: PresenceUser,
    private readonly broadcastFn: (state: LocalAwarenessState | null) => void,
    timeoutMs = DEFAULT_PRESENCE_TIMEOUT_MS,
    private readonly onInvalid?: (violation: PresenceViolation) => void,
  ) {
    this.localState = {
      sessionId,
      userId: user.id,
      userName: user.name,
      color: user.color,
      cursor: null,
      selection: [],
      ...(user.avatarUrl === undefined ? {} : { avatarUrl: user.avatarUrl }),
      updatedAt: Date.now(),
    };

    this.throttler = createPresenceThrottler((update) => {
      this.localState = {
        ...this.localState,
        ...update,
        selection: update.selection ? [...update.selection] : this.localState.selection,
        updatedAt: Date.now(),
      };
      this.broadcastFn(this.localState);
    });

    // Timer periódico de limpeza de presenças expiradas
    this.cleanupTimer = setInterval(
      () => {
        this.purgeExpired(timeoutMs);
      },
      Math.min(PURGE_INTERVAL_MS, Math.max(100, Math.floor(timeoutMs / 3))),
    );

    // Heartbeat: quem fica parado reenvia o estado a cada um terço do timeout e não expira
    const heartbeatMs = Math.max(100, Math.floor(timeoutMs / 3));
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.localState.updatedAt < heartbeatMs) return;
      this.localState = { ...this.localState, updatedAt: Date.now() };
      this.broadcastFn(this.localState);
    }, heartbeatMs);
  }

  updateLocal(update: PresenceUpdate): void {
    if (this.isDestroyed) return;
    this.throttler.update(update);
  }

  /** Envia já o estado pendente, por exemplo o `drag: null` ao soltar. */
  flush(): void {
    if (this.isDestroyed) return;
    this.throttler.flush();
  }

  handleRemoteUpdate(remoteState: LocalAwarenessState | null): void {
    if (this.isDestroyed || !remoteState) return;
    if (remoteState.sessionId === this.localState.sessionId) return; // Ignora eco local

    const checked = validatePresence(remoteState, { origin: pageOrigin() });
    if (!checked.ok) {
      this.onInvalid?.(checked.error);
      return;
    }

    const updatedAt = remoteState.updatedAt || Date.now();
    const known = this.remotePresences.get(remoteState.sessionId);
    // Duplicada, atrasada ou fora de ordem: vale o último `updatedAt` de cada sessão.
    if (known && updatedAt <= known.updatedAt) return;

    const isNewcomer = known === undefined;
    this.remotePresences.set(remoteState.sessionId, {
      sessionId: remoteState.sessionId,
      userId: remoteState.userId,
      userName: remoteState.userName,
      color: remoteState.color,
      cursor: remoteState.cursor,
      selection: remoteState.selection,
      ...(remoteState.selectedAt === undefined ? {} : { selectedAt: remoteState.selectedAt }),
      ...(remoteState.drag === undefined ? {} : { drag: remoteState.drag }),
      ...(remoteState.view === undefined ? {} : { view: remoteState.view }),
      ...(remoteState.avatarUrl === undefined ? {} : { avatarUrl: remoteState.avatarUrl }),
      updatedAt,
    });

    // Quem chega só conhece quem se mexe: responde já com o próprio estado, para ele não esperar
    // o próximo heartbeat para me ver. Só na primeira vez, para as duas pontas não se repetirem.
    if (isNewcomer) {
      this.localState = { ...this.localState, updatedAt: Date.now() };
      this.broadcastFn(this.localState);
    }
    this.notify();
  }

  handleRemoteDisconnect(sessionId: string): void {
    if (this.isDestroyed) return;
    if (this.remotePresences.delete(sessionId)) {
      this.notify();
    }
  }

  getPresences(): readonly RemotePresence[] {
    return Array.from(this.remotePresences.values());
  }

  subscribe(listener: (presences: readonly RemotePresence[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  purgeExpired(timeoutMs = DEFAULT_PRESENCE_TIMEOUT_MS, now = Date.now()): void {
    if (this.isDestroyed) return;
    let changed = false;
    for (const [id, presence] of this.remotePresences.entries()) {
      if (isPresenceExpired(presence, timeoutMs, now)) {
        this.remotePresences.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.notify();
    }
  }

  destroy(): void {
    this.isDestroyed = true;
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.throttler.destroy();
    // Envia sinal de saída aos pares
    this.broadcastFn(null);
    this.remotePresences.clear();
    this.listeners.clear();
  }

  private notify(): void {
    const list = this.getPresences();
    for (const l of this.listeners) {
      l(list);
    }
  }
}

/** Origem da página, que libera `avatarUrl` em `http:` da mesma origem. */
function pageOrigin(): string | undefined {
  return typeof location === 'undefined' ? undefined : location.origin;
}
