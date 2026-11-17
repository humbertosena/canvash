import {
  createCollaborationError,
  err,
  ok,
  type CollaborationError,
  type Result,
  type ServerMessage,
} from '@canvash/collaboration';
import * as Y from 'yjs';
import { applyAndValidate } from './commit-queue.js';
import type { CollaborationServerLogger } from './logger.js';
import { SUPPORTED_PROVIDER, type Room } from './room.js';
import type { RoomStorage } from './storage.js';

export interface MaintenanceOptions {
  readonly storage: RoomStorage;
  readonly logger: CollaborationServerLogger;
  readonly now: () => number;
  readonly createEpoch: () => string;
  readonly receiptRetentionMs: number | undefined;
}

const RETIRED = (): CollaborationError =>
  createCollaborationError(
    'ROOM_EPOCH_MISMATCH',
    'A sala trocou de epoch enquanto esperava na fila.',
  );

/**
 * Compacta a sala. Roda dentro da fila dela, então o documento em memória já inclui todo commit
 * que chegou antes: o snapshot vai até o último commit gravado (COLLAB-15).
 */
export async function compactRoom(
  room: Room,
  options: MaintenanceOptions,
): Promise<Result<void, CollaborationError>> {
  if (room.retired) return err(RETIRED());
  const retention = options.receiptRetentionMs;
  // Sem commit novo no log e sem retenção, não há o que compactar.
  if (room.logTail === undefined && retention === undefined) return ok(undefined);
  const cutoff = retention === undefined ? undefined : options.now() - retention;
  const compacted = await options.storage.compact(
    room.documentId,
    Y.encodeStateAsUpdate(room.doc),
    room.logTail ?? '',
    cutoff === undefined ? undefined : { dropReceiptsBefore: cutoff },
  );
  if (!compacted.ok) {
    options.logger.error('falha ao compactar a sala', {
      documentId: room.documentId,
      code: compacted.error.code,
    });
    return compacted;
  }
  room.logTail = undefined;
  if (cutoff !== undefined) {
    for (const [commitId, receipt] of room.receipts) {
      if (receipt.timestamp < cutoff) room.receipts.delete(commitId);
    }
  }
  return ok(undefined);
}

/**
 * Troca a epoch da sala (COLLAB-14). Roda dentro da fila dela: os commits que chegaram antes
 * terminam, com recibo da epoch antiga, e só então a epoch muda. `retire` tira a sala da memória
 * depois de os clientes serem derrubados.
 */
export async function rotateRoomEpoch(
  room: Room,
  options: MaintenanceOptions,
  snapshot: Uint8Array | undefined,
  retire: (room: Room) => void,
): Promise<Result<string, CollaborationError>> {
  if (room.retired) return err(RETIRED());
  const roomEpoch = options.createEpoch();
  const next = new Y.Doc();
  try {
    if (snapshot === undefined) {
      Y.applyUpdate(next, Y.encodeStateAsUpdate(room.doc));
    } else {
      // O snapshot vem do host: tem de ser um estado que projeta num documento válido.
      const checked = applyAndValidate(next, snapshot);
      if (!checked.ok) return checked;
    }
    next.getMap('meta').set('roomEpoch', roomEpoch);
    const reset = await options.storage.reset(room.documentId, {
      provider: SUPPORTED_PROVIDER,
      roomEpoch,
      snapshot: Y.encodeStateAsUpdate(next),
      log: [],
      receipts: [],
    });
    if (!reset.ok) {
      options.logger.error('falha ao trocar a epoch da sala', {
        documentId: room.documentId,
        code: reset.error.code,
      });
      return reset;
    }
  } finally {
    next.destroy();
  }

  room.retired = true;
  const notice: ServerMessage = {
    t: 'error',
    code: 'ROOM_EPOCH_MISMATCH',
    message: `A sala trocou de epoch: a nova é "${roomEpoch}". Reconecte sem informar a epoch.`,
    fatal: true,
    details: { serverEpoch: roomEpoch },
  };
  for (const client of room.dropClients()) {
    client.send(notice);
    client.close(4000, 'ROOM_EPOCH_MISMATCH');
  }
  retire(room);
  return ok(roomEpoch);
}
