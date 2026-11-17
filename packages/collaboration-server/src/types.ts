import type {
  CollaborationCredentials,
  CollaborationError,
  Result,
  RoomAccess,
} from '@canvash/collaboration';
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
  /** Clientes ao mesmo tempo numa sala. Padrão 50. A conexão a mais recebe `LIMIT_EXCEEDED`. */
  readonly maxClientsPerRoom?: number;
  /** Salas carregadas ao mesmo tempo. Padrão 1000. A sala a mais recebe `LIMIT_EXCEEDED`. */
  readonly maxRooms?: number;
  /** Tempo sem clientes até a sala sair da memória. Padrão 60 s. */
  readonly roomIdleMs?: number;
  /** Maior presença aceita, em bytes do quadro. Acima disso é descartada. Padrão 16 KiB. */
  readonly maxPresenceBytes?: number;
  /** Presenças repassadas por sessão e por segundo. Padrão 20 (`MAX_PRESENCE_RATE_HZ`). */
  readonly presenceRateHz?: number;
  /**
   * Idade, em ms, a partir da qual um recibo pode sair na compactação. Sem ele, nenhum sai. Um
   * commit reenviado sem recibo guardado é aplicado de novo, sem mudar o documento, e recebe um
   * recibo novo (P8).
   */
  readonly receiptRetentionMs?: number;
  /** Commits por gravação: o lote fecha com este tanto. Padrão 64. */
  readonly maxBatchCommits?: number;
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
  /** Recibos que a sala guarda para reenviar o mesmo `ack`. */
  readonly receipts: number;
  /** Presenças descartadas desde que a sala foi carregada: identidade, formato ou tamanho. */
  readonly droppedPresence: number;
}

export interface CollaborationServer {
  /** Entrega uma conexão já aberta ao núcleo. Não lança. */
  handleConnection(connection: ServerConnection, request: ConnectionRequest): void;
  /**
   * Grava o snapshot atual e descarta o log até o último commit, preservando os recibos (salvo os
   * mais antigos que `receiptRetentionMs`). Entra na fila da sala, depois dos commits já
   * enfileirados. Carrega a sala se ela existe no armazenamento e não está na memória; sala que
   * não existe falha com `NOT_FOUND`.
   */
  compact(documentId: string): Promise<Result<void, CollaborationError>>;
  /**
   * Começa uma epoch nova: grava o snapshot (o dado, que tem de ser um estado Yjs válido, ou o
   * atual), esvazia log e recibos, manda `ROOM_EPOCH_MISMATCH` fatal a todos os conectados e os
   * desconecta. Quem volta com a epoch antiga recebe o mesmo erro no `hello`; entrar na nova é
   * decisão do cliente (sem `roomEpoch` no `hello`). Devolve a epoch nova.
   */
  rotateEpoch(
    documentId: string,
    options?: { readonly snapshot?: Uint8Array },
  ): Promise<Result<string, CollaborationError>>;
  /**
   * Derruba as sessões da sala que casam com o filtro, com um erro fatal tipado (R13, P7). O
   * `userId` é o da identidade que o `authorize` informou; com `userId` e `sessionId`, casa quem
   * tem os dois. Filtro vazio derruba todas e descarrega a sala da memória (o servidor não apaga
   * nada do armazenamento). Resolve com quantas sessões fechou, depois de os commits já
   * enfileirados terminarem, com recibo; o que as sessões derrubadas mandarem depois é
   * descartado. Sala que não está carregada resolve 0, sem ser carregada.
   */
  disconnect(
    documentId: string,
    filter: { readonly userId?: string; readonly sessionId?: string },
    error: CollaborationError,
  ): Promise<number>;
  /**
   * Para de aceitar conexões, espera as filas das salas (commit em voo termina com recibo ou
   * fica pendente no cliente), fecha os clientes com 1001 e solta os timers. Chamado de novo,
   * devolve a mesma promessa.
   */
  close(): Promise<void>;
  /** `undefined` quando a sala não está carregada. */
  getRoomStats(documentId: string): RoomStats | undefined;
}
