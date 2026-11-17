import {
  createCollaborationError,
  err,
  ok,
  type CollaborationError,
  type CollaborationTransport,
  type CommitReceipt,
  type Result,
  type TransportHello,
  type TransportInbound,
  type TransportState,
  type TransportWelcome,
} from '@canvash/collaboration';
import * as Y from 'yjs';
import type { LocalAwarenessState } from './awareness.js';
import { commitError, transportNotOpen } from './commit-errors.js';
import type { TransportMessage } from './legacy-message.js';

/**
 * A parte do hub em memória que a sessão usava antes de existir `CollaborationTransport`.
 * Declarada aqui, por forma, para a sessão continuar aceitando o hub sem importar a classe.
 */
export interface LegacyTransportHub {
  registerClient(sessionId: string, onMessage: (msg: TransportMessage) => void): void;
  unregisterClient(sessionId: string): void;
  syncWithServer(clientStateVector: Uint8Array): Uint8Array;
  sendUpdate(
    sessionId: string,
    commitId: string,
    update: Uint8Array,
    clientEpoch: string,
  ): Promise<{ ok: true; receipt: CommitReceipt } | { ok: false; code: string }>;
  sendPresence(sessionId: string, state: LocalAwarenessState | null): void;
}

/** Vetor de estado vazio: pede ao hub o estado inteiro da sala. */
const EMPTY_STATE_VECTOR = new Uint8Array([0]);

export function isLegacyTransportHub(value: unknown): value is LegacyTransportHub {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.registerClient === 'function' &&
    typeof candidate.sendUpdate === 'function' &&
    typeof candidate.syncWithServer === 'function'
  );
}

export interface LegacyHubTransport extends CollaborationTransport {
  /**
   * Registra o cliente no hub na hora, sem handshake, como a sessão fazia no construtor. Lança o
   * que `registerClient` lançar.
   */
  attach(): void;
}

/**
 * O hub antigo atrás da interface de transporte, com as mesmas chamadas de antes: `registerClient`
 * ao abrir, `syncWithServer` para o que falta, `sendUpdate` e `sendPresence`, `unregisterClient`
 * ao fechar. Não há handshake: a epoch é a que a sessão informa.
 */
export function createLegacyHubTransport(
  hub: LegacyTransportHub,
  sessionId: string,
  fallbackEpoch: string,
): LegacyHubTransport {
  let state: TransportState = 'idle';
  const inboundListeners = new Set<(message: TransportInbound) => void>();
  const stateListeners = new Set<(state: TransportState, error?: CollaborationError) => void>();

  const setState = (next: TransportState, error?: CollaborationError): void => {
    state = next;
    for (const listener of [...stateListeners]) listener(next, error);
  };

  const onMessage = (msg: TransportMessage): void => {
    if (state !== 'open') return;
    if (msg.type === 'presence') {
      const message: TransportInbound = {
        type: 'presence',
        from: msg.senderSessionId,
        state: msg.payload,
      };
      for (const listener of [...inboundListeners]) listener(message);
      return;
    }
    if (msg.payload instanceof Uint8Array) {
      const message: TransportInbound = {
        type: 'update',
        commitId: msg.commitId ?? '',
        from: msg.senderSessionId,
        update: msg.payload,
      };
      for (const listener of [...inboundListeners]) listener(message);
    }
  };

  return {
    get state() {
      return state;
    },

    attach(): void {
      hub.registerClient(sessionId, onMessage);
      setState('open');
    },

    open(getHello: () => TransportHello): Promise<Result<TransportWelcome, CollaborationError>> {
      if (state !== 'idle') {
        return Promise.resolve(
          err(
            createCollaborationError(
              'CONNECTION_FAILED',
              'open() só vale uma vez por transporte; crie outro pela fábrica',
            ),
          ),
        );
      }
      setState('connecting');
      const hello = getHello();
      try {
        hub.registerClient(sessionId, onMessage);
        const missing = hub.syncWithServer(hello.syncState);
        // O hub não informa o vetor de estado da sala: ele sai do estado inteiro dela.
        const serverSyncState = Y.encodeStateVectorFromUpdate(
          hub.syncWithServer(EMPTY_STATE_VECTOR),
        );
        setState('open');
        return Promise.resolve(
          ok({
            roomEpoch: hello.roomEpoch ?? fallbackEpoch,
            access: 'write' as const,
            missing,
            serverSyncState,
            serverTime: Date.now(),
          }),
        );
      } catch (cause) {
        const error = createCollaborationError(
          'CONNECTION_FAILED',
          'O hub recusou o registro do cliente',
          { cause: cause instanceof Error ? cause.message : String(cause) },
        );
        setState('closed', error);
        return Promise.resolve(err(error));
      }
    },

    async commit(
      commitId: string,
      update: Uint8Array,
      roomEpoch: string,
    ): Promise<Result<CommitReceipt, CollaborationError>> {
      if (state !== 'open') return err(transportNotOpen());
      const result = await hub.sendUpdate(sessionId, commitId, update, roomEpoch);
      return result.ok ? ok(result.receipt) : err(commitError(result.code));
    },

    sync(syncState: Uint8Array): Promise<Result<Uint8Array, CollaborationError>> {
      if (state !== 'open') return Promise.resolve(err(transportNotOpen()));
      return Promise.resolve(ok(hub.syncWithServer(syncState)));
    },

    sendPresence(presence: unknown): void {
      if (state !== 'open') return;
      hub.sendPresence(sessionId, presence as LocalAwarenessState | null);
    },

    onInbound(listener: (message: TransportInbound) => void): () => void {
      inboundListeners.add(listener);
      return () => {
        inboundListeners.delete(listener);
      };
    },

    onStateChange(
      listener: (state: TransportState, error?: CollaborationError) => void,
    ): () => void {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },

    close(): void {
      if (state === 'closed') return;
      const wasOpen = state === 'open';
      setState('closed');
      if (wasOpen) hub.unregisterClient(sessionId);
      inboundListeners.clear();
      stateListeners.clear();
    },
  };
}
