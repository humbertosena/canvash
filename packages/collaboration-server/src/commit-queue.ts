import {
  createCollaborationError,
  encodeServerMessage,
  err,
  ok,
  type CollaborationError,
  type CommitReceipt,
  type Result,
  type ServerMessage,
} from '@canvash/collaboration';
import { projectYDocToCanvasDocument } from '@canvash/collaboration-yjs';
import { validateDocument, type CanvasDocument } from '@canvash/core';
import * as Y from 'yjs';
import type { CollaborationServerLogger } from './logger.js';
import type { PendingCommit, Room } from './room.js';
import type { RoomStorage, StoredCommit } from './storage.js';

export interface CommitQueueOptions {
  readonly storage: RoomStorage;
  readonly logger: CollaborationServerLogger;
  readonly now: () => number;
  readonly maxBatchCommits: number;
}

/** Cópia do documento da sala, para validar sem tocar o original. */
function cloneDoc(source: Y.Doc, extra: readonly Uint8Array[] = []): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(source));
  for (const update of extra) Y.applyUpdate(copy, update);
  return copy;
}

/** Aplica o update na cópia e confere que o resultado projeta num documento válido (R10). */
export function applyAndValidate(
  work: Y.Doc,
  update: Uint8Array,
): Result<CanvasDocument, CollaborationError> {
  try {
    Y.applyUpdate(work, update);
    const checked = validateDocument(projectYDocToCanvasDocument(work));
    if (checked.ok) return ok(checked.value);
  } catch {
    // Update ilegível, ou estado que a projeção não aceita: cai na recusa abaixo.
  }
  return err(
    createCollaborationError('INVALID_DOCUMENT', 'O commit não produz um documento válido.'),
  );
}

interface Accepted {
  readonly pending: PendingCommit;
  readonly receipt: CommitReceipt;
}

type Answer =
  | { readonly kind: 'known'; readonly pending: PendingCommit; readonly receipt: CommitReceipt }
  | { readonly kind: 'accepted'; readonly entry: Accepted }
  | { readonly kind: 'repeated'; readonly pending: PendingCommit; readonly of: Accepted }
  | { readonly kind: 'invalid'; readonly pending: PendingCommit };

function replyError(
  pending: PendingCommit,
  code: CollaborationError['code'],
  message: string,
): void {
  pending.client.send({ t: 'error', id: pending.id, code, message, fatal: false });
}

function replyAck(pending: PendingCommit, receipt: CommitReceipt): void {
  pending.client.send({ t: 'ack', id: pending.id, receipt });
}

/** Repassa o update aos outros clientes da sala, codificado uma vez só. */
function forward(room: Room, entry: Accepted): void {
  const message: ServerMessage = {
    t: 'update',
    commitId: entry.pending.commitId,
    from: entry.pending.client.sessionId,
    update: entry.pending.update,
  };
  const frame = encodeServerMessage(message);
  for (const client of room.clients.values()) {
    if (client.sessionId !== entry.pending.client.sessionId) client.sendFrame(frame);
  }
}

async function processBatch(
  room: Room,
  options: CommitQueueOptions,
  batch: readonly PendingCommit[],
): Promise<void> {
  const answers: Answer[] = [];
  const accepted: Accepted[] = [];
  const byCommitId = new Map<string, Accepted>();
  let work = cloneDoc(room.doc);
  let projected: CanvasDocument | undefined;

  for (const pending of batch) {
    const known = room.receipts.get(pending.commitId);
    if (known !== undefined) {
      answers.push({ kind: 'known', pending, receipt: known });
      continue;
    }
    const first = byCommitId.get(pending.commitId);
    if (first !== undefined) {
      answers.push({ kind: 'repeated', pending, of: first });
      continue;
    }
    const checked = applyAndValidate(work, pending.update);
    if (!checked.ok) {
      // O update pode ter deixado a cópia pela metade: recomeça dela com o que já foi aceito.
      work.destroy();
      work = cloneDoc(
        room.doc,
        accepted.map((entry) => entry.pending.update),
      );
      answers.push({ kind: 'invalid', pending });
      continue;
    }
    projected = checked.value;
    const entry: Accepted = {
      pending,
      receipt: {
        commitId: pending.commitId,
        roomEpoch: room.roomEpoch,
        timestamp: options.now(),
        durable: true,
      },
    };
    accepted.push(entry);
    byCommitId.set(pending.commitId, entry);
    answers.push({ kind: 'accepted', entry });
  }

  let stored = true;
  if (accepted.length > 0 && projected !== undefined) {
    const document = projected;
    const commits: StoredCommit[] = accepted.map((entry) => ({
      commitId: entry.pending.commitId,
      update: entry.pending.update,
      receipt: entry.receipt,
    }));
    const appended = await options.storage.append(room.documentId, {
      commits,
      document,
      encodeSnapshot: () => Y.encodeStateAsUpdate(work),
    });
    if (appended.ok) {
      // Gravado: só agora o commit passa a valer na sala.
      for (const entry of accepted) {
        Y.applyUpdate(room.doc, entry.pending.update);
        room.receipts.set(entry.pending.commitId, entry.receipt);
      }
      room.logTail = accepted.at(-1)?.pending.commitId;
    } else {
      stored = false;
      options.logger.error('falha ao gravar o lote de commits', {
        documentId: room.documentId,
        code: appended.error.code,
        commits: accepted.length,
      });
    }
  }
  work.destroy();

  for (const answer of answers) {
    switch (answer.kind) {
      case 'known':
        replyAck(answer.pending, answer.receipt);
        break;
      case 'invalid':
        replyError(answer.pending, 'INVALID_DOCUMENT', 'O commit não produz um documento válido.');
        break;
      case 'accepted':
        if (stored) {
          replyAck(answer.entry.pending, answer.entry.receipt);
          forward(room, answer.entry);
        } else {
          replyError(
            answer.entry.pending,
            'STORAGE_UNAVAILABLE',
            'O commit não foi gravado; reenvie.',
          );
        }
        break;
      case 'repeated':
        if (stored) replyAck(answer.pending, answer.of.receipt);
        else
          replyError(answer.pending, 'STORAGE_UNAVAILABLE', 'O commit não foi gravado; reenvie.');
        break;
    }
  }
}

/** Esvazia a fila de commits da sala, um lote por vez, dentro da fila da sala. */
async function flush(room: Room, options: CommitQueueOptions): Promise<void> {
  room.flushScheduled = false;
  const batch = room.pending.splice(0, options.maxBatchCommits);
  if (room.retired) {
    // A sala trocou de epoch: o que esperava na fila é da epoch antiga.
    for (const pending of batch) {
      replyError(pending, 'ROOM_EPOCH_MISMATCH', 'A sala trocou de epoch; reconecte.');
    }
  } else if (batch.length > 0) {
    try {
      await processBatch(room, options, batch);
    } catch {
      options.logger.error('erro interno ao processar o lote de commits', {
        documentId: room.documentId,
        code: 'STORAGE_UNAVAILABLE',
        commits: batch.length,
      });
      for (const pending of batch) {
        replyError(pending, 'STORAGE_UNAVAILABLE', 'O commit não foi gravado; reenvie.');
      }
    }
  }
  schedule(room, options);
}

function schedule(room: Room, options: CommitQueueOptions): void {
  if (room.flushScheduled || room.pending.length === 0) return;
  room.flushScheduled = true;
  void room.enqueue(() => flush(room, options));
}

/**
 * Entrega um commit à fila da sala. A fila processa um lote por vez: os commits que chegam
 * enquanto um `append` está em voo esperam e formam o próximo lote, na ordem de chegada.
 */
export function submitCommit(
  room: Room,
  options: CommitQueueOptions,
  pending: PendingCommit,
): void {
  room.pending.push(pending);
  schedule(room, options);
}
