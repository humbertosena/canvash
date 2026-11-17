import {
  DEFAULT_MAX_FRAME_BYTES,
  createCollaborationError,
  err,
  type CollaborationError,
  type Result,
} from '@canvash/collaboration';
import { randomUUID } from 'node:crypto';
import { CLOSE_FATAL, serveConnection, type ConnectionContext } from './connection.js';
import { consoleLogger } from './logger.js';
import { openRoom, type Room } from './room.js';
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
    if (room === undefined || room.clients.size > 0) return;
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
    logger.error('falha ao abrir a sala', { documentId, code: error.code });
    return error.code === 'UNSUPPORTED'
      ? error
      : createCollaborationError(error.code, 'A sala não pôde ser aberta no armazenamento.');
  }

  function getRoom(documentId: string): Promise<Result<Room, CollaborationError>> {
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
      opening: openRoom(documentId, { storage: options.storage, createEpoch }).then((opened) => {
        if (opened.ok) {
          entry.room = opened.value;
          return opened;
        }
        // Sala que não abriu não fica registrada: a próxima conexão tenta de novo.
        if (rooms.get(documentId) === entry) rooms.delete(documentId);
        return err(publicFailure(documentId, opened.error));
      }),
    };
    rooms.set(documentId, entry);
    return entry.opening;
  }

  /** Chamada quando uma conexão larga a sala: sem clientes, começa o prazo da descarga. */
  function releaseRoom(room: Room): void {
    const entry = rooms.get(room.documentId);
    if (entry === undefined || entry.room !== room || room.clients.size > 0) return;
    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => unload(entry), roomIdleMs);
  }

  const context: ConnectionContext = {
    maxFrameBytes: options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES,
    maxClientsPerRoom: options.maxClientsPerRoom ?? DEFAULT_MAX_CLIENTS_PER_ROOM,
    helloTimeoutMs: options.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS,
    now: options.now ?? Date.now,
    logger,
    allowedOrigins: options.allowedOrigins,
    authorize: options.authorize,
    getRoom,
    releaseRoom,
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

    getRoomStats(documentId: string): RoomStats | undefined {
      const room = rooms.get(documentId)?.room;
      return room === undefined
        ? undefined
        : { clients: room.clients.size, receipts: room.receipts.size };
    },
  };
}
