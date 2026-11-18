import {
  createCollaborationError,
  err,
  ok,
  type CollaborationError,
  type CommitReceipt,
  type Result,
  type RoomAccess,
  type TransportHello,
  type TransportWelcome,
} from '@canvash/collaboration';
import * as Y from 'yjs';
import { initYjsDocument } from './crdt-schema.js';

export interface LogEntry {
  readonly commitId: string;
  readonly update: Uint8Array;
  readonly roomEpoch: string;
  readonly timestamp: number;
}

export interface ServerEmulatorOptions {
  /** Relógio do `welcome`. Padrão: `Date.now`. */
  readonly now?: () => number;
}

/** Confere se os bytes são um update Yjs legível, sem tocar o documento da sala. */
function isReadableUpdate(update: Uint8Array): boolean {
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, update);
    return true;
  } catch {
    return false;
  } finally {
    probe.destroy();
  }
}

export class CollaborativeServerEmulator {
  private ydoc: Y.Doc;
  private roomEpoch: string;
  private log: LogEntry[] = [];
  private readonly receipts = new Map<string, CommitReceipt>();
  private isCrashed = false;
  /** Estado com que a sala nasceu: o reinício parte dele e reaplica o log. */
  private readonly initialState: Uint8Array;
  private access: RoomAccess = 'write';
  /** Acesso concedido a cada sessão no handshake: é ele que vale nos commits dela. */
  private readonly sessionAccess = new Map<string, RoomAccess>();
  private readonly now: () => number;

  constructor(initialEpoch = 'epoch-1', initialDoc?: Y.Doc, options: ServerEmulatorOptions = {}) {
    this.roomEpoch = initialEpoch;
    this.ydoc = initialDoc ?? new Y.Doc();
    if (!initialDoc) {
      initYjsDocument(this.ydoc, this.roomEpoch);
    }
    this.initialState = Y.encodeStateAsUpdate(this.ydoc);
    this.now = options.now ?? Date.now;
  }

  /** Acesso que o handshake concede às próximas conexões. Padrão: `write`. */
  setAccess(access: RoomAccess): void {
    this.access = access;
  }

  /**
   * Handshake de um cliente: confere provider, credencial e epoch e devolve o que falta a ele,
   * o vetor de estado da sala e o relógio do servidor.
   */
  handshake(hello: TransportHello): Result<TransportWelcome, CollaborationError> {
    if (this.isCrashed) {
      return err(createCollaborationError('CONNECTION_FAILED', 'Servidor fora do ar'));
    }
    if (hello.provider !== 'yjs') {
      return err(
        createCollaborationError('UNSUPPORTED', `Provider "${hello.provider}" não é o da sala`, {
          provider: 'yjs',
        }),
      );
    }
    if (hello.credentials?.token === 'invalid_token') {
      return err(
        createCollaborationError(
          'UNAUTHORIZED',
          'Credenciais de autorização rejeitadas pelo backend',
        ),
      );
    }
    if (hello.roomEpoch !== undefined && hello.roomEpoch !== this.roomEpoch) {
      return err(
        createCollaborationError(
          'ROOM_EPOCH_MISMATCH',
          `Room epoch incompatível: esperado "${hello.roomEpoch}", atual no servidor "${this.roomEpoch}"`,
          { clientEpoch: hello.roomEpoch, serverEpoch: this.roomEpoch },
        ),
      );
    }
    this.sessionAccess.set(hello.sessionId, this.access);
    return ok({
      roomEpoch: this.roomEpoch,
      access: this.access,
      missing: Y.encodeStateAsUpdate(
        this.ydoc,
        hello.syncState.byteLength > 0 ? hello.syncState : undefined,
      ),
      serverSyncState: Y.encodeStateVector(this.ydoc),
      serverTime: this.now(),
    });
  }

  getRoomEpoch(): string {
    return this.roomEpoch;
  }

  /** O log durável da sala, em ordem: serve para conferir que nenhum commit entrou duas vezes. */
  getLog(): readonly LogEntry[] {
    return [...this.log];
  }

  getMissingUpdates(clientStateVector: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc, clientStateVector);
  }

  /**
   * Simula crash do servidor. Enquanto estiver em crash, recusa requisições.
   */
  crash(): void {
    this.isCrashed = true;
  }

  /**
   * Reinicia o servidor a partir do snapshot e log persistidos (COLLAB-13).
   */
  restart(): void {
    this.isCrashed = false;
    // Reconstrói o Y.Doc a partir do estado inicial da sala e do log durável
    const newDoc = new Y.Doc();
    Y.applyUpdate(newDoc, this.initialState);
    for (const entry of this.log) {
      Y.applyUpdate(newDoc, entry.update);
    }
    this.ydoc.destroy();
    this.ydoc = newDoc;
  }

  /**
   * Grava um commit e retorna o recibo durável após persistência (COLLAB-13). Com `sessionId`, o
   * acesso concedido àquela sessão no handshake é imposto: leitura não grava.
   */
  commitUpdate(
    commitId: string,
    update: Uint8Array,
    clientEpoch: string,
    sessionId?: string,
  ):
    | { ok: true; receipt: CommitReceipt }
    | {
        ok: false;
        code: 'ROOM_EPOCH_MISMATCH' | 'CRASHED' | 'INVALID_DOCUMENT' | 'UNAUTHORIZED';
      } {
    if (this.isCrashed) {
      return { ok: false, code: 'CRASHED' };
    }
    if (sessionId !== undefined && this.sessionAccess.get(sessionId) === 'read') {
      return { ok: false, code: 'UNAUTHORIZED' };
    }
    if (clientEpoch !== this.roomEpoch) {
      return { ok: false, code: 'ROOM_EPOCH_MISMATCH' };
    }

    // Deduplicação: se o commit já foi gravado duravelmente, reemite o recibo existente (COLLAB-13)
    const existing = this.receipts.get(commitId);
    if (existing) {
      return { ok: true, receipt: existing };
    }

    if (!isReadableUpdate(update)) {
      return { ok: false, code: 'INVALID_DOCUMENT' };
    }

    // Aplica no documento do servidor e grava no log durável
    Y.applyUpdate(this.ydoc, update);

    const entry: LogEntry = {
      commitId,
      update: new Uint8Array(update),
      roomEpoch: this.roomEpoch,
      timestamp: Date.now(),
    };
    this.log.push(entry);

    const receipt: CommitReceipt = {
      commitId,
      roomEpoch: this.roomEpoch,
      timestamp: entry.timestamp,
      durable: true,
    };
    this.receipts.set(commitId, receipt);

    return { ok: true, receipt };
  }

  /**
   * Compacta o log de updates em um snapshot único sem lacunas causais (COLLAB-15).
   */
  compact(): void {
    if (this.isCrashed) return;
    const snapshot = Y.encodeStateAsUpdate(this.ydoc);
    this.log = [
      {
        commitId: `snapshot-${Date.now()}`,
        update: snapshot,
        roomEpoch: this.roomEpoch,
        timestamp: Date.now(),
      },
    ];
  }

  /**
   * Migra ou restaura backup gerando nova epoch (COLLAB-14).
   */
  rotateEpoch(newEpoch: string): void {
    this.roomEpoch = newEpoch;
  }

  getSnapshot(): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  getUpdatesSince(stateVector?: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc, stateVector);
  }

  destroy(): void {
    this.ydoc.destroy();
    this.log = [];
    this.receipts.clear();
    this.sessionAccess.clear();
  }
}
