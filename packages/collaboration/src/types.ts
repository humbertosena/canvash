import type { CanvasSectionApi, Result } from '@canvash/core';
import type { CollaborationError } from './errors.js';

export type SessionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export interface CollaborationCredentials {
  readonly token?: string;
  readonly [key: string]: unknown;
}

export interface PresenceUser {
  readonly id: string;
  readonly name?: string;
  readonly color: string;
  /** Foto opcional, repassada aos pares. */
  readonly avatarUrl?: string;
}

/** Ponto no espaço de mundo do canvas. */
export interface PresencePoint {
  readonly x: number;
  readonly y: number;
}

/** Arrasto de mover em andamento: nós e deslocamento em mundo desde o início do gesto. */
export interface PresenceDrag {
  readonly ids: readonly string[];
  readonly dx: number;
  readonly dy: number;
}

/** Centro do viewport em mundo e zoom, usados para seguir o apresentador. */
export interface PresenceView {
  readonly center: PresencePoint;
  readonly zoom: number;
}

export interface RemotePresence {
  readonly sessionId: string;
  readonly userId: string;
  readonly userName?: string;
  readonly color: string;
  /** Coordenadas no espaço de mundo do canvas (ou null se ponteiro fora da área de edição) */
  readonly cursor: { x: number; y: number } | null;
  /** IDs de nós atualmente selecionados pelo participante */
  readonly selection: readonly string[];
  /** Instante, no relógio de quem publica, em que a seleção atual começou. Desempata bloqueios. */
  readonly selectedAt?: number;
  readonly drag?: PresenceDrag | null;
  readonly view?: PresenceView | null;
  readonly avatarUrl?: string;
  readonly updatedAt: number;
}

export interface PresenceUpdate {
  readonly cursor?: { x: number; y: number } | null;
  readonly selection?: readonly string[];
  readonly userName?: string;
  readonly color?: string;
  readonly selectedAt?: number;
  readonly drag?: PresenceDrag | null;
  readonly view?: PresenceView | null;
  readonly avatarUrl?: string;
}

export interface CommitReceipt {
  readonly commitId: string;
  readonly roomEpoch: string;
  readonly timestamp: number;
  readonly durable: boolean;
}

export interface ConnectOptions {
  readonly documentId: string;
  readonly section: CanvasSectionApi;
  readonly credentials?: CollaborationCredentials;
  readonly user?: PresenceUser;
  /** Geração esperada da sala para verificação de compatibilidade (COLLAB-14). */
  readonly roomEpoch?: string;
  /** Limite de backlog offline em bytes (padrão: 20 MiB). */
  readonly maxOfflineBacklogBytes?: number;
  /**
   * Tempo sem notícias, em ms, para um participante sair da lista (padrão: 30 s). O estado local
   * é reenviado a cada um terço dele. Serve principalmente para testes rápidos.
   */
  readonly presenceTimeoutMs?: number;
  /** Chamado quando uma presença recebida é inválida e foi descartada. */
  readonly onPresenceError?: (violation: PresenceViolation) => void;
}

export interface CollaborationSession {
  readonly status: SessionStatus;
  readonly sessionId: string;
  readonly roomEpoch: string;
  readonly documentId: string;

  /** Atualiza o estado efêmero de presença do usuário local com limitação de taxa (COLLAB-05). */
  updatePresence(update: PresenceUpdate): void;

  /** Obtém a lista atual de participantes remotos ativos com presença não expirada. */
  getPresences(): readonly RemotePresence[];

  /** Obtém os recibos de commits confirmados pelo servidor. */
  getCommitReceipts(): readonly CommitReceipt[];

  /** Suspende o transporte temporariamente preservando documento, CRDT e histórico. */
  disconnect(): void;

  /** Retoma a conexão e sincroniza alterações pendentes. */
  reconnect(): Promise<Result<void, CollaborationError>>;

  /**
   * Encerra a vinculação com a sala. Requer confirmação durável de todas as alterações locais
   * a menos que `force: true` seja especificado.
   */
  leave(options?: { force?: boolean }): Promise<Result<void, CollaborationError>>;

  /** Libera todos os recursos, observers e subscriptions de forma idempotente. */
  destroy(): void;

  /** Registra listener de transições de status da sessão. */
  onStatusChange(listener: (status: SessionStatus, error?: CollaborationError) => void): () => void;

  /** Registra listener de alterações na lista de presenças ativas. */
  onPresenceChange(listener: (presences: readonly RemotePresence[]) => void): () => void;

  /** Registra listener para confirmações duráveis de commits pelo servidor. */
  onCommitReceipt(listener: (receipt: CommitReceipt) => void): () => void;
}

export interface CollaborationProvider {
  readonly name: string;
  connect(options: ConnectOptions): Promise<Result<CollaborationSession, CollaborationError>>;
}

export type PresenceViolationReason =
  | 'INVALID_SHAPE'
  | 'UNKNOWN_FIELD'
  | 'NOT_FINITE'
  | 'OUT_OF_RANGE'
  | 'TOO_MANY_IDS'
  | 'NAME_TOO_LONG'
  | 'INVALID_COLOR'
  | 'INVALID_AVATAR_URL';

export interface PresenceViolation {
  readonly reason: PresenceViolationReason;
  /** Caminho do campo que causou a recusa, por exemplo `drag.dx`. */
  readonly field: string;
}
