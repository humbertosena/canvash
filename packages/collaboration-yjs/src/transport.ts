import type {
  CollaborationError,
  CommitReceipt,
  Result,
  TransportHello,
  TransportWelcome,
} from '@canvash/collaboration';
import type { LocalAwarenessState } from './awareness.js';
import type { TransportMessage } from './legacy-message.js';
import type { CollaborativeServerEmulator } from './server-emulator.js';

export type { TransportMessage } from './legacy-message.js';

export interface TransportNetworkOptions {
  /** Simulação de atraso em ms */
  delayMs?: number;
  /** Simulação de perda/partição de pacotes */
  dropMessages?: boolean;
  /** Simulação de duplicação de pacotes */
  duplicateMessages?: boolean;
  /**
   * Entrega updates e presenças fora da ordem de envio: as mensagens ficam retidas e saem
   * embaralhadas a cada `settle()`. O embaralhamento é determinístico a partir de `reorderSeed`
   * e não depende do relógio.
   */
  reorderMessages?: boolean;
  /** Semente do embaralhamento. Padrão: 1. */
  reorderSeed?: number;
}

/** O lado do transporte de um enlace aberto por `createMemoryTransport`. */
export interface MemoryLink {
  deliver(msg: TransportMessage): void;
  /** Outro enlace com o mesmo `sessionId` tomou o lugar deste. */
  replaced(): void;
  /** O enlace caiu: nada chega nem sai até `restored`. */
  dropped(): void;
  /** O enlace pode voltar: o transporte refaz o handshake. */
  restored(): void;
}

/** Gerador pseudoaleatório pequeno e determinístico (mulberry32), em [0, 1). */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export class DeterministicTransportHub {
  private clients = new Map<string, (msg: TransportMessage) => void>();
  private networkOptions: TransportNetworkOptions = {};
  /** Enlaces abertos por `createMemoryTransport`. */
  private readonly links = new Map<string, MemoryLink>();
  /** Enlaces em queda, à espera de `restoreLink`. */
  private readonly droppedLinks = new Map<string, MemoryLink>();
  private commitFailures: { remaining: number; code: string } | null = null;
  private random = seededRandom(1);
  private pendingDeliveries = 0;
  private settleWaiters: Array<() => void> = [];
  /** Entregas retidas pela reordenação, na ordem de envio. */
  private held: Array<() => void> = [];

  constructor(private readonly server: CollaborativeServerEmulator) {}

  setNetworkOptions(options: TransportNetworkOptions): void {
    this.networkOptions = { ...options };
    this.random = seededRandom(options.reorderSeed ?? 1);
    // Desligar a reordenação não pode perder o que estava retido.
    if (!options.reorderMessages) this.releaseHeld();
  }

  registerClient(sessionId: string, onMessage: (msg: TransportMessage) => void): void {
    this.clients.set(sessionId, onMessage);
  }

  /** Handshake de um enlace: quem responde é o servidor emulado. */
  handshake(hello: TransportHello): Result<TransportWelcome, CollaborationError> {
    return this.server.handshake(hello);
  }

  /**
   * Liga um enlace já aceito no handshake. Se o mesmo `sessionId` já tinha outro, aberto ou em
   * queda, o antigo é avisado e perde o lugar, sem anúncio de saída: a sessão continua viva no
   * enlace novo.
   */
  attachLink(sessionId: string, link: MemoryLink): void {
    const previous = this.links.get(sessionId) ?? this.droppedLinks.get(sessionId);
    this.droppedLinks.delete(sessionId);
    this.links.set(sessionId, link);
    this.clients.set(sessionId, (msg) => link.deliver(msg));
    if (previous !== undefined && previous !== link) previous.replaced();
  }

  /** Desliga o enlace, se ele ainda for o dono do `sessionId`, e anuncia a saída aos outros. */
  detachLink(sessionId: string, link: MemoryLink): void {
    if (this.droppedLinks.get(sessionId) === link) {
      // A saída já foi anunciada na queda.
      this.droppedLinks.delete(sessionId);
      return;
    }
    if (this.links.get(sessionId) !== link) return;
    this.links.delete(sessionId);
    this.unregisterClient(sessionId);
  }

  /**
   * Simula a queda do enlace de uma sessão, sem ela pedir: o servidor a vê sair, e o transporte
   * vai a `reconnecting`.
   */
  dropLink(sessionId: string): void {
    const link = this.links.get(sessionId);
    if (link === undefined) return;
    this.links.delete(sessionId);
    this.droppedLinks.set(sessionId, link);
    this.unregisterClient(sessionId);
    link.dropped();
  }

  /** Simula a volta do enlace: o transporte refaz o handshake e entrega o `resync`. */
  restoreLink(sessionId: string): void {
    const link = this.droppedLinks.get(sessionId);
    if (link === undefined) return;
    this.droppedLinks.delete(sessionId);
    link.restored();
  }

  /**
   * Faz os próximos `count` commits voltarem com `code`, sem chegar ao servidor: é a falha de
   * gravação do armazenamento, que não derruba o enlace.
   */
  failNextCommits(count: number, code: string): void {
    this.commitFailures = count > 0 ? { remaining: count, code } : null;
  }

  /**
   * Entrega o que a reordenação reteve e resolve quando não há mais entrega atrasada ou retida a
   * caminho, inclusive as que as próprias entregas provocarem.
   */
  async settle(): Promise<void> {
    for (;;) {
      if (this.held.length > 0) {
        this.releaseHeld();
      } else if (this.pendingDeliveries > 0) {
        await new Promise<void>((resolve) => {
          this.settleWaiters.push(resolve);
        });
      } else {
        return;
      }
    }
  }

  /** Entrega as mensagens retidas, embaralhadas pela semente (Fisher–Yates). */
  private releaseHeld(): void {
    const batch = this.held.splice(0);
    for (let index = batch.length - 1; index > 0; index -= 1) {
      const other = Math.floor(this.random() * (index + 1));
      const moved = batch[index];
      const swapped = batch[other];
      if (moved !== undefined && swapped !== undefined) {
        batch[index] = swapped;
        batch[other] = moved;
      }
    }
    for (const task of batch) task();
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

        if (this.commitFailures !== null) {
          const { code } = this.commitFailures;
          this.commitFailures.remaining -= 1;
          if (this.commitFailures.remaining <= 0) this.commitFailures = null;
          resolve({ ok: false, code });
          return;
        }

        const serverRes = this.server.commitUpdate(commitId, update, clientEpoch, sessionId);
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
        this.defer(execute, this.networkOptions.delayMs);
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
      this.defer(execute, this.networkOptions.delayMs);
    } else {
      execute();
    }
  }

  private broadcast(msg: TransportMessage, excludeSessionId?: string): void {
    if (this.networkOptions.reorderMessages) {
      this.held.push(() => this.deliver(msg, excludeSessionId));
      return;
    }
    this.deliver(msg, excludeSessionId);
  }

  private deliver(msg: TransportMessage, excludeSessionId?: string): void {
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

  /** Agenda uma entrega e a conta, para `settle()` saber quando a rede simulada esvaziou. */
  private defer(task: () => void, delayMs: number): void {
    this.pendingDeliveries += 1;
    setTimeout(() => {
      try {
        task();
      } finally {
        this.pendingDeliveries -= 1;
        if (this.pendingDeliveries === 0) {
          for (const resolve of this.settleWaiters.splice(0)) resolve();
        }
      }
    }, delayMs);
  }

  destroy(): void {
    this.clients.clear();
    this.links.clear();
    this.droppedLinks.clear();
    this.commitFailures = null;
    this.held = [];
  }
}
