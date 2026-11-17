import type {
  CollaborationError,
  CommitReceipt,
  Result,
  TransportHello,
  TransportWelcome,
} from '@canvash/collaboration';
import type { LocalAwarenessState } from './awareness.js';
import type { CollaborativeServerEmulator } from './server-emulator.js';

export interface TransportMessage {
  type: 'update' | 'presence';
  commitId?: string;
  payload: Uint8Array | LocalAwarenessState | null;
  senderSessionId: string;
}

export interface TransportNetworkOptions {
  /** Simulação de atraso em ms */
  delayMs?: number;
  /** Simulação de perda/partição de pacotes */
  dropMessages?: boolean;
  /** Simulação de duplicação de pacotes */
  duplicateMessages?: boolean;
}

export class DeterministicTransportHub {
  private clients = new Map<string, (msg: TransportMessage) => void>();
  private networkOptions: TransportNetworkOptions = {};
  /** Enlaces abertos por `createMemoryTransport`: `sessionId` → aviso de substituição. */
  private readonly links = new Map<string, () => void>();

  constructor(private readonly server: CollaborativeServerEmulator) {}

  setNetworkOptions(options: TransportNetworkOptions): void {
    this.networkOptions = { ...options };
  }

  registerClient(sessionId: string, onMessage: (msg: TransportMessage) => void): void {
    this.clients.set(sessionId, onMessage);
  }

  /** Handshake de um enlace: quem responde é o servidor emulado. */
  handshake(hello: TransportHello): Result<TransportWelcome, CollaborationError> {
    return this.server.handshake(hello);
  }

  /**
   * Liga um enlace já aceito no handshake. Se o mesmo `sessionId` já tinha um, o antigo é avisado
   * por `onReplaced` e perde o lugar, sem anúncio de saída: a sessão continua viva no enlace novo.
   */
  attachLink(
    sessionId: string,
    onMessage: (msg: TransportMessage) => void,
    onReplaced: () => void,
  ): void {
    const previous = this.links.get(sessionId);
    this.links.set(sessionId, onReplaced);
    this.clients.set(sessionId, onMessage);
    previous?.();
  }

  /** Desliga o enlace, se ele ainda for o dono do `sessionId`, e anuncia a saída aos outros. */
  detachLink(sessionId: string, onReplaced: () => void): void {
    if (this.links.get(sessionId) !== onReplaced) return;
    this.links.delete(sessionId);
    this.unregisterClient(sessionId);
  }

  /** Quantos clientes estão registrados agora: serve para conferir que nada fica abandonado. */
  getClientCount(): number {
    return this.clients.size;
  }

  unregisterClient(sessionId: string): void {
    this.clients.delete(sessionId);
    // Notifica desconexão aos outros clientes
    this.broadcast({
      type: 'presence',
      senderSessionId: sessionId,
      payload: null,
    });
  }

  syncWithServer(clientStateVector: Uint8Array): Uint8Array {
    return this.server.getMissingUpdates(clientStateVector);
  }

  sendUpdate(
    sessionId: string,
    commitId: string,
    update: Uint8Array,
    clientEpoch: string,
  ): Promise<{ ok: true; receipt: CommitReceipt } | { ok: false; code: string }> {
    return new Promise((resolve) => {
      const execute = () => {
        if (this.networkOptions.dropMessages) {
          resolve({ ok: false, code: 'NETWORK_PARTITION' });
          return;
        }

        const serverRes = this.server.commitUpdate(commitId, update, clientEpoch);
        if (!serverRes.ok) {
          resolve({ ok: false, code: serverRes.code });
          return;
        }

        // Difunde para os outros clientes conectados
        const msg: TransportMessage = {
          type: 'update',
          commitId,
          payload: update,
          senderSessionId: sessionId,
        };

        this.broadcast(msg, sessionId);

        if (this.networkOptions.duplicateMessages) {
          // Reenvia duplicata simulada
          this.broadcast(msg, sessionId);
        }

        resolve({ ok: true, receipt: serverRes.receipt });
      };

      if (this.networkOptions.delayMs && this.networkOptions.delayMs > 0) {
        setTimeout(execute, this.networkOptions.delayMs);
      } else {
        execute();
      }
    });
  }

  sendPresence(sessionId: string, state: LocalAwarenessState | null): void {
    if (this.networkOptions.dropMessages) return;

    const msg: TransportMessage = {
      type: 'presence',
      senderSessionId: sessionId,
      payload: state,
    };

    const execute = () => {
      this.broadcast(msg, sessionId);
      if (this.networkOptions.duplicateMessages) {
        this.broadcast(msg, sessionId);
      }
    };

    if (this.networkOptions.delayMs && this.networkOptions.delayMs > 0) {
      setTimeout(execute, this.networkOptions.delayMs);
    } else {
      execute();
    }
  }

  private broadcast(msg: TransportMessage, excludeSessionId?: string): void {
    for (const [id, clientFn] of this.clients.entries()) {
      if (id !== excludeSessionId) {
        try {
          clientFn(msg);
        } catch {
          // Silencia erros de clientes desconectados
        }
      }
    }
  }

  destroy(): void {
    this.clients.clear();
    this.links.clear();
  }
}
