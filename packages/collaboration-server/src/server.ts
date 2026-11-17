import {
  DEFAULT_MAX_FRAME_BYTES,
  MAX_PRESENCE_RATE_HZ,
  createCollaborationError,
  err,
  type CollaborationError,
  type Result,
} from '@canvash/collaboration';
import { randomUUID } from 'node:crypto';
import { submitCommit, type CommitQueueOptions } from './commit-queue.js';
import { CLOSE_FATAL, serveConnection, type ConnectionContext } from './connection.js';
import { consoleLogger } from './logger.js';
import { compactRoom, rotateRoomEpoch, type MaintenanceOptions } from './maintenance.js';
import { isOwnError, openRoom, type PendingCommit, type Room } from './room.js';
import type {
  CollaborationServer,
  CollaborationServerOptions,
  ConnectionRequest,
  RoomStats,
  ServerConnection,
} from './types.js';

const DEFAULT_HELLO_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CLIENTS_PER_ROOM = 50;
const DEFAULT_MAX_ROOMS = 1000;
const DEFAULT_ROOM_IDLE_MS = 60_000;
const DEFAULT_MAX_BATCH_COMMITS = 64;
const DEFAULT_MAX_PRESENCE_BYTES = 16 * 1024;

interface RoomEntry {
  readonly opening: Promise<Result<Room, CollaborationError>>;
  room: Room | undefined;
  /** Prazo para descarregar a sala, enquanto ela está sem clientes. */
  idleTimer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Servidor de colaboração, independente do meio. Não toca o armazenamento ao ser criado: cada
 * sala é carregada na primeira conexão que a pede (R12).
 */
export function createCollaborationServer(
  options: CollaborationServerOptions,
): CollaborationServer {
  const createEpoch = options.createEpoch ?? (() => randomUUID());
  const logger = options.logger ?? consoleLogger;
  const maxRooms = options.maxRooms ?? DEFAULT_MAX_ROOMS;
  const roomIdleMs = options.roomIdleMs ?? DEFAULT_ROOM_IDLE_MS;
  if (options.authorize === undefined) {
    logger.warn('sem authorize: toda conexão recebe acesso write');
  }
  if (options.allowedOrigins === undefined) {
    logger.warn('sem allowedOrigins: o servidor aceita conexão de qualquer origem');
  }
  const rooms = new Map<string, RoomEntry>();

  /** Tira a sala da memória. Só a de um carregamento que terminou e está sem clientes. */
  function unload(entry: RoomEntry): void {
    const room = entry.room;
    if (room === undefined || room.clients.size > 0 || room.busy) return;
    clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
    if (rooms.get(room.documentId) === entry) rooms.delete(room.documentId);
    room.doc.destroy();
  }

  /** Dá lugar a uma sala nova descarregando as ociosas. */
  function makeRoomFor(documentId: string): boolean {
    if (rooms.has(documentId) || rooms.size < maxRooms) return true;
    for (const entry of [...rooms.values()]) {
      if (entry.idleTimer !== undefined) unload(entry);
      if (rooms.size < maxRooms) return true;
    }
    return false;
  }

  /** A mensagem do armazenamento é do host e pode ter endereço, caminho ou credencial. */
  function publicFailure(documentId: string, error: CollaborationError): CollaborationError {
    if (isOwnError(error)) return error;
    logger.error('falha ao abrir a sala', { documentId, code: error.code });
    return createCollaborationError(error.code, 'A sala não pôde ser aberta no armazenamento.');
  }

  function acquireRoom(
    documentId: string,
    create: boolean,
  ): Promise<Result<Room, CollaborationError>> {
    const existing = rooms.get(documentId);
    if (existing !== undefined) {
      // Quem pede a sala a segura: a descarga só volta a valer quando ninguém a usa.
      clearTimeout(existing.idleTimer);
      existing.idleTimer = undefined;
      return existing.opening;
    }
    if (!makeRoomFor(documentId)) {
      return Promise.resolve(
        err(
          createCollaborationError(
            'LIMIT_EXCEEDED',
            `O servidor já tem ${maxRooms} salas carregadas.`,
            { reason: 'rooms' },
          ),
        ),
      );
    }
    const entry: RoomEntry = {
      room: undefined,
      idleTimer: undefined,
      opening: openRoom(documentId, { storage: options.storage, createEpoch, create }).then(
        (opened) => {
          if (opened.ok) {
            entry.room = opened.value;
            // Quando a fila esvazia com a sala sem clientes, começa o prazo da descarga.
            opened.value.onSettled = () => releaseRoom(opened.value);
            return opened;
          }
          // Sala que não abriu não fica registrada: a próxima conexão tenta de novo.
          if (rooms.get(documentId) === entry) rooms.delete(documentId);
          return err(publicFailure(documentId, opened.error));
        },
      ),
    };
    rooms.set(documentId, entry);
    return entry.opening;
  }

  const getRoom = (documentId: string): Promise<Result<Room, CollaborationError>> =>
    acquireRoom(documentId, true);

  /** Chamada quando uma conexão larga a sala: sem clientes, começa o prazo da descarga. */
  function releaseRoom(room: Room): void {
    const entry = rooms.get(room.documentId);
    if (entry === undefined || entry.room !== room || room.clients.size > 0 || room.busy) return;
    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => unload(entry), roomIdleMs);
  }

  /** A sala trocou de epoch: sai da memória na hora, sem esperar a ociosidade. */
  function retireRoom(room: Room): void {
    const entry = rooms.get(room.documentId);
    if (entry === undefined || entry.room !== room) return;
    clearTimeout(entry.idleTimer);
    rooms.delete(room.documentId);
    room.doc.destroy();
  }

  const maintenance: MaintenanceOptions = {
    storage: options.storage,
    logger,
    now: options.now ?? Date.now,
    createEpoch,
    receiptRetentionMs: options.receiptRetentionMs,
  };

  /** Roda a tarefa na fila de uma sala que já existe, carregando-a se preciso, sem criá-la. */
  async function inExistingRoom<T>(
    documentId: string,
    task: (room: Room) => Promise<Result<T, CollaborationError>>,
  ): Promise<Result<T, CollaborationError>> {
    const acquired = await acquireRoom(documentId, false);
    if (!acquired.ok) return acquired;
    const room = acquired.value;
    try {
      return await room.enqueue(() => task(room));
    } finally {
      releaseRoom(room);
    }
  }

  const commitQueue: CommitQueueOptions = {
    storage: options.storage,
    logger,
    now: options.now ?? Date.now,
    maxBatchCommits: options.maxBatchCommits ?? DEFAULT_MAX_BATCH_COMMITS,
  };

  const context: ConnectionContext = {
    maxFrameBytes: options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES,
    maxClientsPerRoom: options.maxClientsPerRoom ?? DEFAULT_MAX_CLIENTS_PER_ROOM,
    presence: {
      maxPresenceBytes: options.maxPresenceBytes ?? DEFAULT_MAX_PRESENCE_BYTES,
      minIntervalMs: Math.floor(1000 / Math.max(1, options.presenceRateHz ?? MAX_PRESENCE_RATE_HZ)),
    },
    helloTimeoutMs: options.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS,
    now: options.now ?? Date.now,
    logger,
    allowedOrigins: options.allowedOrigins,
    authorize: options.authorize,
    getRoom,
    releaseRoom,
    submitCommit: (room: Room, pending: PendingCommit) => submitCommit(room, commitQueue, pending),
  };

  return {
    handleConnection(connection: ServerConnection, request: ConnectionRequest): void {
      try {
        serveConnection(context, connection, request);
      } catch {
        try {
          connection.close(CLOSE_FATAL, 'INTERNAL');
        } catch {
          // A conexão já estava perdida.
        }
      }
    },

    compact(documentId: string) {
      return inExistingRoom(documentId, (room) => compactRoom(room, maintenance));
    },

    rotateEpoch(documentId: string, rotateOptions: { readonly snapshot?: Uint8Array } = {}) {
      return inExistingRoom(documentId, (room) =>
        rotateRoomEpoch(room, maintenance, rotateOptions.snapshot, retireRoom),
      );
    },

    getRoomStats(documentId: string): RoomStats | undefined {
      const room = rooms.get(documentId)?.room;
      return room === undefined
        ? undefined
        : {
            clients: room.clients.size,
            receipts: room.receipts.size,
            droppedPresence: room.droppedPresence,
          };
    },
  };
}
