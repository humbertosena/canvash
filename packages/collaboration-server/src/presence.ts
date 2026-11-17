import type { Room, RoomClient } from './room.js';

export interface PresenceOptions {
  /** Maior quadro de presença aceito, em bytes. */
  readonly maxPresenceBytes: number;
  /** Intervalo mínimo entre dois repasses da mesma sessão, em ms. */
  readonly minIntervalMs: number;
  readonly now: () => number;
}

export interface PresenceChannel {
  /** Uma presença chegou da conexão. `frameBytes` é o tamanho do quadro que a trouxe. */
  receive(state: unknown, frameBytes: number): void;
  /** A conexão saiu: o que esperava a janela não é mais repassado. */
  dispose(): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A presença de uma conexão, do recebimento ao repasse (R16). O servidor garante a identidade e
 * os limites; o conteúdo, quem recebe valida.
 */
export function createPresenceChannel(
  room: Room,
  client: RoomClient,
  options: PresenceOptions,
): PresenceChannel {
  let lastSentAt: number | undefined;
  let waiting: { readonly state: unknown } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** O estado com a identidade imposta, ou `undefined` se a presença não vale. */
  function stamp(state: unknown): { readonly state: unknown } | undefined {
    if (state === null) return { state: null };
    if (!isRecord(state)) return undefined;
    // Quem se diz outra sessão não fala por ela.
    if ('sessionId' in state && state.sessionId !== client.sessionId) return undefined;
    const stamped: Record<string, unknown> = { ...state };
    if (client.user !== undefined) {
      // A identidade autenticada vale mais que a declarada. Nenhum campo novo entra.
      stamped.userId = client.user.id;
      if (client.user.name !== undefined) stamped.userName = client.user.name;
    }
    return { state: stamped };
  }

  function emit(state: unknown): void {
    lastSentAt = options.now();
    room.broadcastPresence(client.sessionId, state);
  }

  function clearWaiting(): void {
    clearTimeout(timer);
    timer = undefined;
    waiting = undefined;
  }

  return {
    receive(state, frameBytes) {
      const stamped = frameBytes > options.maxPresenceBytes ? undefined : stamp(state);
      if (stamped === undefined) {
        room.droppedPresence += 1;
        return;
      }
      if (stamped.state === null) {
        // Saída explícita: vale na hora e não deixa uma presença velha chegar depois.
        clearWaiting();
        room.presences.delete(client.sessionId);
        emit(null);
        return;
      }
      room.presences.set(client.sessionId, stamped.state);
      const elapsed = lastSentAt === undefined ? Infinity : options.now() - lastSentAt;
      if (elapsed >= options.minIntervalMs && timer === undefined) {
        emit(stamped.state);
        return;
      }
      // Dentro da janela: fica só a última, e ela sai quando a janela fecha.
      waiting = stamped;
      timer ??= setTimeout(
        () => {
          timer = undefined;
          const last = waiting;
          waiting = undefined;
          if (last !== undefined) emit(last.state);
        },
        Math.max(0, options.minIntervalMs - elapsed),
      );
    },

    dispose() {
      clearWaiting();
    },
  };
}
