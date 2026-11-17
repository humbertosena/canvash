import type { CollaborationError, CommitReceipt, Result } from '@canvash/collaboration';
import type { CanvasDocument } from '@canvash/core';

/** Um commit gravado: o update e o recibo que o servidor deu a ele. */
export interface StoredCommit {
  readonly commitId: string;
  readonly update: Uint8Array;
  readonly receipt: CommitReceipt;
}

/** O que `load` devolve e o que `create` e `reset` recebem. */
export interface StoredRoom {
  readonly provider: string; // 'yjs'
  readonly roomEpoch: string;
  /** Estado Yjs compactado. */
  readonly snapshot: Uint8Array;
  /** Commits depois do snapshot, em ordem. Pode ser vazio. */
  readonly log: readonly StoredCommit[];
  /** Recibos de commits que já saíram do log (compactados) e que o armazenamento guardou. */
  readonly receipts: readonly CommitReceipt[];
}

/** Um lote de commits já validados, gravado de uma vez. */
export interface AppendBatch {
  /** De 1 a `maxBatchCommits`, em ordem. */
  readonly commits: readonly StoredCommit[];
  /** Documento projetado e validado depois do lote, com o `id` original. */
  readonly document: CanvasDocument;
  /** Estado Yjs completo depois do lote. Só é calculado quando é chamado. */
  encodeSnapshot(): Uint8Array;
}

export interface CompactOptions {
  /** Recibos com `timestamp` menor que este valor saem. Sem ele, todos ficam. */
  readonly dropReceiptsBefore?: number;
}

/**
 * Onde as salas moram. O servidor só fala com esta interface; o host pluga o banco dele.
 *
 * O contrato é de estado, não de formato: `load` devolve uma sala equivalente à gravada, isto é,
 * aplicar `snapshot` e depois `log` reproduz todos os lotes confirmados. Um armazenamento sem log
 * grava `batch.encodeSnapshot()` a cada `append` e devolve `log` vazio.
 */
export interface RoomStorage {
  /** `null` quando a sala não existe. */
  load(documentId: string): Promise<Result<StoredRoom | null, CollaborationError>>;
  /** Falha com `CONFLICT` se a sala já existe. */
  create(documentId: string, room: StoredRoom): Promise<Result<void, CollaborationError>>;
  /**
   * Só resolve `ok` depois de o lote inteiro estar gravado de forma durável. Tudo ou nada.
   * Falha com `NOT_FOUND` se a sala não existe, sem criá-la.
   */
  append(documentId: string, batch: AppendBatch): Promise<Result<void, CollaborationError>>;
  /**
   * Troca o snapshot e descarta o log até `throughCommitId`, inclusive, de forma atômica.
   * O servidor chama dentro da fila da sala, com o estado completo até o último commit gravado;
   * um armazenamento sem log pode, por isso, só trocar o snapshot. Preserva os recibos, salvo os
   * mais antigos que `options.dropReceiptsBefore`. Um `throughCommitId` que não está no log não
   * descarta nada. Falha com `NOT_FOUND` se a sala não existe.
   */
  compact(
    documentId: string,
    snapshot: Uint8Array,
    throughCommitId: string,
    options?: CompactOptions,
  ): Promise<Result<void, CollaborationError>>;
  /**
   * Começa uma epoch nova: snapshot novo, log e recibos como vêm em `room`. Falha com
   * `NOT_FOUND` se a sala não existe.
   */
  reset(documentId: string, room: StoredRoom): Promise<Result<void, CollaborationError>>;
}
