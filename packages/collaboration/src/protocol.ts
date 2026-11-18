import type { CollaborationErrorCode } from './errors.js';
import type { CollaborationCredentials, CommitReceipt, RoomAccess } from './types.js';

/** Versão do protocolo Canvash que este pacote fala. Vai no `hello` e volta no `welcome`. */
export const PROTOCOL_VERSION = 1;

/** Maior quadro aceito, se o host não configurar outro: 32 MiB. */
export const DEFAULT_MAX_FRAME_BYTES = 32 * 1024 * 1024;

/** Maior cabeçalho JSON de um quadro: 64 KiB. O que é grande vai no payload binário. */
export const MAX_FRAME_HEADER_BYTES = 64 * 1024;

/**
 * O que o cliente envia. `id` correlaciona pedido e resposta dentro de uma conexão; a identidade
 * de um commit é o `commitId`.
 */
export type ClientMessage =
  | {
      t: 'hello';
      v: number;
      provider: string;
      documentId: string;
      sessionId: string;
      roomEpoch?: string;
      credentials?: CollaborationCredentials;
      syncState: Uint8Array;
    }
  | { t: 'commit'; id: number; commitId: string; roomEpoch: string; update: Uint8Array }
  | { t: 'sync'; id: number; syncState: Uint8Array }
  | { t: 'presence'; state: unknown }
  | { t: 'bye' };

/** O que o servidor envia. O `from` de `update` e de `presence` é carimbado por ele. */
export type ServerMessage =
  | {
      t: 'welcome';
      v: number;
      roomEpoch: string;
      access: RoomAccess;
      missing: Uint8Array;
      serverSyncState: Uint8Array;
      serverTime: number;
      user?: { id: string; name?: string };
    }
  | { t: 'ack'; id: number; receipt: CommitReceipt }
  | { t: 'synced'; id: number; missing: Uint8Array }
  | { t: 'update'; commitId: string; from: string; update: Uint8Array }
  | { t: 'presence'; from: string; state: unknown }
  | {
      t: 'error';
      id?: number;
      code: CollaborationErrorCode;
      message: string;
      fatal: boolean;
      details?: unknown;
    };
