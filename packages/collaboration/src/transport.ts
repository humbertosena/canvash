import type { CollaborationError, Result } from './errors.js';
import type { CollaborationCredentials, CommitReceipt, RoomAccess } from './types.js';

export type { RoomAccess } from './types.js';

/** Estado do enlace, independente do status da sessão. */
export type TransportState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface TransportHello {
  /** Provider negociado no handshake, por exemplo `'yjs'`. */
  readonly provider: string;
  readonly documentId: string;
  readonly sessionId: string;
  /** Ausente: aceita a epoch atual da sala. */
  readonly roomEpoch?: string;
  readonly credentials?: CollaborationCredentials;
  /** Vetor de estado do cliente. Os bytes são opacos aqui: o significado é do provider. */
  readonly syncState: Uint8Array;
}

export interface TransportWelcome {
  readonly roomEpoch: string;
  readonly access: RoomAccess;
  /** O que o cliente não tem (opaco). */
  readonly missing: Uint8Array;
  /** Vetor de estado do servidor (opaco). Com ele a sessão calcula o que falta lá. */
  readonly serverSyncState: Uint8Array;
  /** Relógio do servidor, em ms, no envio do `welcome`. */
  readonly serverTime: number;
  /** Identidade que o servidor autenticou, quando o `authorize` do host a informa. */
  readonly user?: { readonly id: string; readonly name?: string };
}

/** O que chega sem ter sido pedido. */
export type TransportInbound =
  | {
      readonly type: 'update';
      readonly commitId: string;
      /** `sessionId` de quem enviou, carimbado pelo servidor. */
      readonly from: string;
      readonly update: Uint8Array;
    }
  | {
      readonly type: 'presence';
      /** `sessionId` de quem publicou, carimbado pelo servidor. */
      readonly from: string;
      /** Quem recebe valida com `validatePresence`; `null` anuncia a saída. */
      readonly state: unknown;
    }
  | { readonly type: 'error'; readonly error: CollaborationError; readonly fatal: boolean }
  /** `welcome` de uma reconexão: o que falta desde o vetor de estado atual da sessão. */
  | { readonly type: 'resync'; readonly welcome: TransportWelcome };

/**
 * Tudo o que a sessão conhece da rede. A interface é estrutural: um objeto literal com estes
 * membros é um transporte válido, sem classe base.
 */
export interface CollaborationTransport {
  readonly state: TransportState;
  /**
   * Abre o enlace e faz o handshake. Não lança: erro de rede, de versão, de auth ou de epoch vem
   * tipado. `getHello` é chamado em toda conexão, inclusive nas reconexões, para o `hello` levar o
   * vetor de estado atual da sessão e credenciais renovadas.
   */
  open(getHello: () => TransportHello): Promise<Result<TransportWelcome, CollaborationError>>;
  /**
   * Envia um commit e resolve com o recibo durável. Reenviar o mesmo `commitId` devolve o mesmo
   * recibo.
   */
  commit(
    commitId: string,
    update: Uint8Array,
    roomEpoch: string,
  ): Promise<Result<CommitReceipt, CollaborationError>>;
  /** Pede ao servidor o que falta a partir de `syncState`. */
  sync(syncState: Uint8Array): Promise<Result<Uint8Array, CollaborationError>>;
  /** Publica a presença local; `null` anuncia a saída. Sem garantia de entrega. */
  sendPresence(state: unknown): void;
  onInbound(listener: (message: TransportInbound) => void): () => void;
  onStateChange(listener: (state: TransportState, error?: CollaborationError) => void): () => void;
  /** Fecha o enlace e libera timers e listeners. Idempotente. */
  close(): void;
}

export type CreateTransport = (context: {
  readonly documentId: string;
  readonly sessionId: string;
}) => CollaborationTransport;
