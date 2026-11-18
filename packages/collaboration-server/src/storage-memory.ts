import {
  createCollaborationError,
  err,
  ok,
  type CollaborationError,
  type CommitReceipt,
  type Result,
} from '@canvash/collaboration';
import type {
  AppendBatch,
  CompactOptions,
  RoomStorage,
  StoredCommit,
  StoredRoom,
} from './storage.js';

interface RoomRecord {
  provider: string;
  roomEpoch: string;
  snapshot: Uint8Array;
  log: StoredCommit[];
  receipts: CommitReceipt[];
}

function copyCommit(commit: StoredCommit): StoredCommit {
  return {
    commitId: commit.commitId,
    update: commit.update.slice(),
    receipt: { ...commit.receipt },
  };
}

function toRecord(room: StoredRoom): RoomRecord {
  return {
    provider: room.provider,
    roomEpoch: room.roomEpoch,
    snapshot: room.snapshot.slice(),
    log: room.log.map(copyCommit),
    receipts: room.receipts.map((receipt) => ({ ...receipt })),
  };
}

function missing(documentId: string): Result<never, CollaborationError> {
  return err(
    createCollaborationError('NOT_FOUND', `A sala "${documentId}" não existe no armazenamento.`),
  );
}

/**
 * Armazenamento em memória: guarda o snapshot, o log e todos os recibos de cada sala, e entrega
 * cópias. Serve ao desenvolvimento e aos testes; nada sobrevive ao processo.
 */
export function createMemoryRoomStorage(): RoomStorage {
  const rooms = new Map<string, RoomRecord>();

  return {
    load(documentId) {
      const record = rooms.get(documentId);
      return Promise.resolve(
        ok(record === undefined ? null : (toRecord(record) satisfies StoredRoom)),
      );
    },

    create(documentId, room) {
      if (rooms.has(documentId)) {
        return Promise.resolve(
          err(createCollaborationError('CONFLICT', `A sala "${documentId}" já existe.`)),
        );
      }
      rooms.set(documentId, toRecord(room));
      return Promise.resolve(ok(undefined));
    },

    append(documentId, batch: AppendBatch) {
      const record = rooms.get(documentId);
      if (record === undefined) return Promise.resolve(missing(documentId));
      // O lote entra de uma vez: nada depois desta linha pode falhar.
      record.log.push(...batch.commits.map(copyCommit));
      return Promise.resolve(ok(undefined));
    },

    compact(documentId, snapshot, throughCommitId, options: CompactOptions = {}) {
      const record = rooms.get(documentId);
      if (record === undefined) return Promise.resolve(missing(documentId));
      const through = record.log.findIndex((commit) => commit.commitId === throughCommitId);
      const dropped = through < 0 ? [] : record.log.splice(0, through + 1);
      record.snapshot = snapshot.slice();
      const cutoff = options.dropReceiptsBefore;
      record.receipts = [...record.receipts, ...dropped.map((commit) => commit.receipt)].filter(
        (receipt) => cutoff === undefined || receipt.timestamp >= cutoff,
      );
      return Promise.resolve(ok(undefined));
    },

    reset(documentId, room) {
      if (!rooms.has(documentId)) return Promise.resolve(missing(documentId));
      rooms.set(documentId, toRecord(room));
      return Promise.resolve(ok(undefined));
    },
  };
}
