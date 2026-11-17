import {
  createCollaborationError,
  encodeServerMessage,
  err,
  ok,
  type CollaborationError,
  type CommitReceipt,
  type Result,
  type RoomAccess,
  type ServerMessage,
} from '@canvash/collaboration';
import { initYjsDocument } from '@canvash/collaboration-yjs';
import * as Y from 'yjs';
import type { RoomStorage, StoredRoom } from './storage.js';

/** O único provider que este servidor hospeda. */
export const SUPPORTED_PROVIDER = 'yjs';

/** Um cliente dentro da sala: a conexão já passou do `hello`. */
export interface RoomClient {
  readonly sessionId: string;
  readonly access: RoomAccess;
  /** Identidade que o `authorize` informou. */
  readonly user?: { readonly id: string; readonly name?: string };
  /** Manda uma mensagem. `false` quando a conexão não aceitou. */
  send(message: ServerMessage): boolean;
  /** Manda um quadro já codificado: um `update` para vários clientes é codificado uma vez só. */
  sendFrame(frame: Uint8Array): boolean;
  /** Fecha a conexão do cliente, sem esperar por nada. */
  close(code: number, reason: string): void;
}

/** Um commit esperando na fila da sala. */
export interface PendingCommit {
  readonly client: RoomClient;
  /** O `id` da mensagem, para o `ack` ou o `error` voltar a quem mandou. */
  readonly id: number;
  readonly commitId: string;
  readonly update: Uint8Array;
}

export class Room {
  readonly clients = new Map<string, RoomClient>();
  /** A última presença de cada sessão, para o recém-chegado. Só em memória. */
  readonly presences = new Map<string, unknown>();
  /** Presenças descartadas por identidade, formato ou tamanho. */
  droppedPresence = 0;
  /** Commits que chegaram e ainda não entraram num lote. */
  readonly pending: PendingCommit[] = [];
  /** Há um lote de commits agendado na fila. */
  flushScheduled = false;
  /** Avisa que a fila esvaziou: a sala sem clientes pode esperar a descarga. */
  onSettled: (() => void) | undefined;
  private tail: Promise<void> = Promise.resolve();
  private queued = 0;

  constructor(
    readonly documentId: string,
    readonly roomEpoch: string,
    readonly doc: Y.Doc,
    /** `commitId` → recibo, para reenviar o mesmo `ack`. */
    readonly receipts: Map<string, CommitReceipt>,
  ) {}

  /** Põe o cliente na sala. Devolve o que estava no lugar dele, se havia. */
  add(client: RoomClient): RoomClient | undefined {
    const previous = this.clients.get(client.sessionId);
    this.clients.set(client.sessionId, client);
    return previous;
  }

  /** Tira o cliente da sala, só se ele ainda for o dono do `sessionId`. */
  remove(client: RoomClient): boolean {
    if (this.clients.get(client.sessionId) !== client) return false;
    this.clients.delete(client.sessionId);
    return true;
  }

  /** O que falta a quem tem o estado `syncState`. Vazio vale por "nada". */
  missingFor(syncState: Uint8Array): Result<Uint8Array, CollaborationError> {
    try {
      return ok(Y.encodeStateAsUpdate(this.doc, syncState.byteLength > 0 ? syncState : undefined));
    } catch {
      return err(
        createCollaborationError(
          'PROTOCOL_ERROR',
          'O syncState não é um vetor de estado legível.',
          {
            reason: 'syncState',
          },
        ),
      );
    }
  }

  /** Manda a presença de `sessionId` a todos os outros clientes, codificada uma vez só. */
  broadcastPresence(sessionId: string, state: unknown): void {
    const frame = encodeServerMessage({ t: 'presence', from: sessionId, state });
    for (const client of this.clients.values()) {
      if (client.sessionId !== sessionId) client.sendFrame(frame);
    }
  }

  serverSyncState(): Uint8Array {
    return Y.encodeStateVector(this.doc);
  }

  /** A sala tem trabalho na fila ou em andamento. */
  get busy(): boolean {
    return this.queued > 0;
  }

  /** Roda a tarefa depois de tudo o que já está na fila da sala, uma por vez. */
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    this.queued += 1;
    const run = this.tail.then(task);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    const done = (): void => {
      this.queued -= 1;
      if (this.queued === 0) this.onSettled?.();
    };
    run.then(done, done);
    return run;
  }
}

/** Reconstrói a sala guardada: snapshot, depois o log em ordem. */
function rebuildRoom(documentId: string, stored: StoredRoom): Result<Room, CollaborationError> {
  if (stored.provider !== SUPPORTED_PROVIDER) {
    return err(
      createCollaborationError(
        'UNSUPPORTED',
        `A sala "${documentId}" foi guardada pelo provider "${stored.provider}", e este servidor só hospeda "${SUPPORTED_PROVIDER}".`,
        { provider: stored.provider },
      ),
    );
  }
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, stored.snapshot);
    for (const commit of stored.log) Y.applyUpdate(doc, commit.update);
  } catch {
    doc.destroy();
    return err(
      createCollaborationError(
        'STORAGE_UNAVAILABLE',
        `O estado guardado da sala "${documentId}" não é um estado Yjs legível.`,
      ),
    );
  }
  const receipts = new Map<string, CommitReceipt>();
  for (const receipt of stored.receipts) receipts.set(receipt.commitId, receipt);
  for (const commit of stored.log) receipts.set(commit.commitId, commit.receipt);
  return ok(new Room(documentId, stored.roomEpoch, doc, receipts));
}

export interface OpenRoomOptions {
  readonly storage: RoomStorage;
  readonly createEpoch: () => string;
}

/**
 * Carrega a sala do armazenamento ou, se ela não existe, cria uma vazia e a grava. Quem perde a
 * corrida de criação (`CONFLICT`) relê a sala que o outro gravou.
 */
export async function openRoom(
  documentId: string,
  options: OpenRoomOptions,
): Promise<Result<Room, CollaborationError>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const loaded = await options.storage.load(documentId);
    if (!loaded.ok) return loaded;
    if (loaded.value !== null) return rebuildRoom(documentId, loaded.value);

    // Sala nova: nunca `initYjsDocument` sobre uma sala que já existe.
    const roomEpoch = options.createEpoch();
    const doc = new Y.Doc();
    initYjsDocument(doc, roomEpoch);
    const created = await options.storage.create(documentId, {
      provider: SUPPORTED_PROVIDER,
      roomEpoch,
      snapshot: Y.encodeStateAsUpdate(doc),
      log: [],
      receipts: [],
    });
    if (created.ok) return ok(new Room(documentId, roomEpoch, doc, new Map()));
    doc.destroy();
    if (created.error.code !== 'CONFLICT') return created;
  }
  return err(
    createCollaborationError(
      'STORAGE_UNAVAILABLE',
      `Não foi possível abrir a sala "${documentId}": ela some e aparece entre a carga e a criação.`,
    ),
  );
}
