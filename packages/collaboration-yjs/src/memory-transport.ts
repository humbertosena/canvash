import {
  createCollaborationError,
  err,
  ok,
  type CollaborationError,
  type CollaborationErrorCode,
  type CollaborationTransport,
  type CommitReceipt,
  type CreateTransport,
  type Result,
  type TransportHello,
  type TransportInbound,
  type TransportState,
  type TransportWelcome,
} from '@canvash/collaboration';
import type { LocalAwarenessState } from './awareness.js';
import type { DeterministicTransportHub, MemoryLink, TransportMessage } from './transport.js';

/** Código de fechamento do enlace que perdeu o lugar para outro com o mesmo `sessionId`. */
const CLOSE_REPLACED = 4001;

/** Códigos que o hub e o emulador devolvem num commit recusado → erro do contrato. */
const COMMIT_ERRORS: Readonly<Record<string, { code: CollaborationErrorCode; message: string }>> = {
  ROOM_EPOCH_MISMATCH: {
    code: 'ROOM_EPOCH_MISMATCH',
    message: 'A sala está em outra epoch',
  },
  INVALID_DOCUMENT: {
    code: 'INVALID_DOCUMENT',
    message: 'O update não é um update válido do provider',
  },
  STORAGE_UNAVAILABLE: {
    code: 'STORAGE_UNAVAILABLE',
    message: 'O servidor não conseguiu gravar o commit',
  },
  NETWORK_PARTITION: { code: 'DISCONNECTED', message: 'O commit não chegou ao servidor' },
  CRASHED: { code: 'DISCONNECTED', message: 'O servidor não respondeu ao commit' },
};

function commitError(code: string): CollaborationError {
  const known = COMMIT_ERRORS[code];
  if (known === undefined) {
    return createCollaborationError('DISCONNECTED', 'O commit não foi confirmado', {
      reason: code,
    });
  }
  return createCollaborationError(known.code, known.message, { reason: code });
}

function notOpen(): CollaborationError {
  return createCollaborationError('DISCONNECTED', 'O transporte não está aberto');
}

/**
 * O hub em memória como implementação de `CollaborationTransport`: handshake, commits, sync e
 * presença passam pelo servidor emulado do hub, com as mesmas opções de atraso, perda,
 * duplicação e reordenação. `hub.dropLink` e `hub.restoreLink` simulam a queda e a volta do
 * enlace. Serve a testes e ao exemplo local; não há rede.
 */
export function createMemoryTransport(hub: DeterministicTransportHub): CreateTransport {
  return ({ sessionId }): CollaborationTransport => {
    let state: TransportState = 'idle';
    let currentHello: (() => TransportHello) | null = null;
    /** Muda a cada queda: a resposta de um pedido feito antes dela não vale mais. */
    let linkGeneration = 0;
    const inboundListeners = new Set<(message: TransportInbound) => void>();
    const stateListeners = new Set<(state: TransportState, error?: CollaborationError) => void>();

    const setState = (next: TransportState, error?: CollaborationError): void => {
      state = next;
      for (const listener of [...stateListeners]) listener(next, error);
    };

    const deliver = (message: TransportInbound): void => {
      for (const listener of [...inboundListeners]) listener(message);
    };

    const link: MemoryLink = {
      deliver(msg: TransportMessage): void {
        if (state !== 'open') return;
        if (msg.type === 'presence') {
          deliver({ type: 'presence', from: msg.senderSessionId, state: msg.payload });
          return;
        }
        if (msg.payload instanceof Uint8Array && msg.commitId !== undefined) {
          deliver({
            type: 'update',
            commitId: msg.commitId,
            from: msg.senderSessionId,
            update: msg.payload,
          });
        }
      },

      replaced(): void {
        if (state === 'closed') return;
        linkGeneration += 1;
        setState(
          'closed',
          createCollaborationError('DISCONNECTED', 'O enlace foi substituído por outra conexão', {
            closeCode: CLOSE_REPLACED,
            reason: 'replaced',
          }),
        );
      },

      dropped(): void {
        if (state !== 'open') return;
        linkGeneration += 1;
        setState('reconnecting');
      },

      restored(): void {
        if (state !== 'reconnecting' || currentHello === null) return;
        const welcome = hub.handshake(currentHello());
        if (!welcome.ok) {
          // Erro de handshake na reconexão é fatal: tentar de novo daria o mesmo resultado.
          setState('closed', welcome.error);
          return;
        }
        hub.attachLink(sessionId, link);
        // Primeiro `open`, depois o `resync`: quem o recebe já pode reenviar pendências.
        setState('open');
        deliver({ type: 'resync', welcome: welcome.value });
      },
    };

    return {
      get state() {
        return state;
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
        currentHello = getHello;
        setState('connecting');
        const welcome = hub.handshake(getHello());
        if (!welcome.ok) {
          setState('closed', welcome.error);
          return Promise.resolve(welcome);
        }
        hub.attachLink(sessionId, link);
        setState('open');
        return Promise.resolve(welcome);
      },

      async commit(
        commitId: string,
        update: Uint8Array,
        roomEpoch: string,
      ): Promise<Result<CommitReceipt, CollaborationError>> {
        if (state !== 'open') return err(notOpen());
        const generation = linkGeneration;
        const result = await hub.sendUpdate(sessionId, commitId, update, roomEpoch);
        // O enlace caiu com o pedido em voo: a resposta se perdeu, mesmo que o servidor tenha
        // gravado. Quem reenviar o mesmo `commitId` recebe o recibo.
        if (generation !== linkGeneration) return err(notOpen());
        return result.ok ? ok(result.receipt) : err(commitError(result.code));
      },

      sync(syncState: Uint8Array): Promise<Result<Uint8Array, CollaborationError>> {
        if (state !== 'open') return Promise.resolve(err(notOpen()));
        return Promise.resolve(ok(hub.syncWithServer(syncState)));
      },

      sendPresence(presence: unknown): void {
        if (state !== 'open') return;
        // O hub só repassa; quem recebe valida o conteúdo.
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
        linkGeneration += 1;
        setState('closed');
        hub.detachLink(sessionId, link);
        inboundListeners.clear();
        stateListeners.clear();
      },
    };
  };
}
