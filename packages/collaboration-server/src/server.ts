import {
  DEFAULT_MAX_FRAME_BYTES,
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

interface RoomEntry {
  readonly opening: Promise<Result<Room, CollaborationError>>;
  room: Room | undefined;
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
  if (options.authorize === undefined) {
    logger.warn('sem authorize: toda conexão recebe acesso write');
  }
  if (options.allowedOrigins === undefined) {
    logger.warn('sem allowedOrigins: o servidor aceita conexão de qualquer origem');
  }
  const rooms = new Map<string, RoomEntry>();

  function getRoom(documentId: string): Promise<Result<Room, CollaborationError>> {
    const existing = rooms.get(documentId);
    if (existing !== undefined) return existing.opening;
    const entry: RoomEntry = {
      room: undefined,
      opening: openRoom(documentId, { storage: options.storage, createEpoch }).then((opened) => {
        // Sala que não abriu não fica registrada: a próxima conexão tenta de novo.
        if (opened.ok) entry.room = opened.value;
        else if (rooms.get(documentId) === entry) rooms.delete(documentId);
        return opened;
      }),
    };
    rooms.set(documentId, entry);
    return entry.opening;
  }

  const context: ConnectionContext = {
    maxFrameBytes: options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES,
    helloTimeoutMs: options.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS,
    now: options.now ?? Date.now,
    logger,
    allowedOrigins: options.allowedOrigins,
    authorize: options.authorize,
    getRoom,
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
      return room === undefined ? undefined : { clients: room.clients.size };
    },
  };
}
