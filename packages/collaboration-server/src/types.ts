import type { CollaborationCredentials, RoomAccess } from '@canvash/collaboration';
import type { CollaborationServerLogger } from './logger.js';
import type { RoomStorage } from './storage.js';

/** Uma conexão, em qualquer meio: `ws`, o WebSocket do framework do host ou SSE+POST (R8). */
export interface ServerConnection {
  send(frame: Uint8Array): void;
  close(code: number, reason?: string): void;
  onFrame(listener: (frame: Uint8Array) => void): () => void;
  onClose(listener: () => void): () => void;
}

/** O que o host sabe da requisição que abriu a conexão (R9). */
export interface ConnectionRequest {
  /** Cabeçalhos do upgrade, ou os que o host montar. O `Origin` é lido daqui. */
  readonly headers: Headers;
  /** Qualquer coisa que o host queira entregar ao `authorize`. O servidor não lê. */
  readonly context?: unknown;
}

export interface AuthorizeRequest {
  readonly documentId: string;
  readonly sessionId: string;
  readonly credentials: CollaborationCredentials | undefined;
  /** O `Origin` da requisição, se veio. */
  readonly origin: string | undefined;
  readonly headers: Headers;
  /** O que o host entregou em `ConnectionRequest.context`. O servidor não lê. */
  readonly context: unknown;
}

export type AuthorizeResult =
  | {
      readonly allow: true;
      readonly access: RoomAccess;
      readonly user?: { readonly id: string; readonly name?: string };
    }
  | {
      readonly allow: false;
      /** `UNAUTHORIZED` por padrão. `NOT_FOUND` esconde que o documento existe (R9). */
      readonly code?: 'UNAUTHORIZED' | 'NOT_FOUND';
      readonly reason?: string;
    };

export interface CollaborationServerOptions {
  readonly storage: RoomStorage;
  /** Sem ele, toda conexão recebe acesso `write` e o servidor avisa uma vez no logger. */
  readonly authorize?: (request: AuthorizeRequest) => AuthorizeResult | Promise<AuthorizeResult>;
  /**
   * Origens aceitas, em comparação exata. Vale no núcleo, para qualquer meio: origem fora da
   * lista, ou ausente, fecha a conexão com 4003 antes de qualquer mensagem (R19). Sem a lista,
   * aceita qualquer origem e avisa uma vez no logger.
   */
  readonly allowedOrigins?: readonly string[];
  /** Padrão: `warn` e `error` no console. */
  readonly logger?: CollaborationServerLogger;
  /** Maior quadro aceito e enviado. Padrão `DEFAULT_MAX_FRAME_BYTES` (32 MiB). */
  readonly maxFrameBytes?: number;
  /** Prazo para o `hello` chegar depois de a conexão abrir. Padrão 10 s. */
  readonly helloTimeoutMs?: number;
  /** Epoch de uma sala nova. Padrão `crypto.randomUUID()`. */
  readonly createEpoch?: () => string;
  /** Relógio do `welcome`. Padrão `Date.now`. */
  readonly now?: () => number;
}

export interface RoomStats {
  /** Conexões que passaram do `hello` e estão na sala. */
  readonly clients: number;
}

export interface CollaborationServer {
  /** Entrega uma conexão já aberta ao núcleo. Não lança. */
  handleConnection(connection: ServerConnection, request: ConnectionRequest): void;
  /** `undefined` quando a sala não está carregada. */
  getRoomStats(documentId: string): RoomStats | undefined;
}
