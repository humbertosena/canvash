import type { CommitReceipt } from '@canvash/collaboration';
import * as Y from 'yjs';
import { initYjsDocument } from './crdt-schema.js';

export interface LogEntry {
  readonly commitId: string;
  readonly update: Uint8Array;
  readonly roomEpoch: string;
  readonly timestamp: number;
}

export class CollaborativeServerEmulator {
  private ydoc: Y.Doc;
  private roomEpoch: string;
  private log: LogEntry[] = [];
  private readonly receipts = new Map<string, CommitReceipt>();
  private isCrashed = false;

  constructor(initialEpoch = 'epoch-1', initialDoc?: Y.Doc) {
    this.roomEpoch = initialEpoch;
    this.ydoc = initialDoc ?? new Y.Doc();
    if (!initialDoc) {
      initYjsDocument(this.ydoc, this.roomEpoch);
    }
  }

  getRoomEpoch(): string {
    return this.roomEpoch;
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
    // Reconstrói o Y.Doc a partir do log durável
    const newDoc = new Y.Doc();
    initYjsDocument(newDoc, this.roomEpoch);
    for (const entry of this.log) {
      Y.applyUpdate(newDoc, entry.update);
    }
    this.ydoc.destroy();
    this.ydoc = newDoc;
  }

  /**
   * Grava um commit e retorna o recibo durável após persistência (COLLAB-13).
   */
  commitUpdate(
    commitId: string,
    update: Uint8Array,
    clientEpoch: string,
  ): { ok: true; receipt: CommitReceipt } | { ok: false; code: 'ROOM_EPOCH_MISMATCH' | 'CRASHED' } {
    if (this.isCrashed) {
      return { ok: false, code: 'CRASHED' };
    }
    if (clientEpoch !== this.roomEpoch) {
      return { ok: false, code: 'ROOM_EPOCH_MISMATCH' };
    }

    // Deduplicação: se o commit já foi gravado duravelmente, reemite o recibo existente (COLLAB-13)
    const existing = this.receipts.get(commitId);
    if (existing) {
      return { ok: true, receipt: existing };
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
  }
}
