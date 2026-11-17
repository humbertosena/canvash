import type { LocalAwarenessState } from './awareness.js';

/**
 * Mensagem que o hub em memória entrega a um cliente registrado por `registerClient`. É o formato
 * anterior à interface `CollaborationTransport`; continua valendo para o hub e para
 * `YjsCollaborationSession.handleTransportMessage`.
 */
export interface TransportMessage {
  type: 'update' | 'presence';
  commitId?: string;
  payload: Uint8Array | LocalAwarenessState | null;
  senderSessionId: string;
}
