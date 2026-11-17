import {
  PROTOCOL_VERSION,
  createCollaborationError,
  decodeClientMessage,
  encodeServerMessage,
  type ClientMessage,
  type CollaborationError,
  type CollaborationErrorCode,
  type Result,
  type RoomAccess,
  type ServerMessage,
} from '@canvash/collaboration';
import { runAuthorize } from './authorize.js';
import type { CollaborationServerLogger } from './logger.js';
import { createPresenceChannel, type PresenceChannel, type PresenceOptions } from './presence.js';
import { SUPPORTED_PROVIDER, type PendingCommit, type Room, type RoomClient } from './room.js';
import type {
  AuthorizeRequest,
  AuthorizeResult,
  ConnectionRequest,
  ServerConnection,
} from './types.js';

/** O `documentId` é também o nome no armazenamento: nada de caminho. */
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Código de fechamento depois de um erro fatal. O cliente decide pelo `error`, não por ele. */
export const CLOSE_FATAL = 4000;
/** Conexão substituída por outra com o mesmo `sessionId`. */
export const CLOSE_REPLACED = 4001;
/** Origem fora de `allowedOrigins`. */
export const CLOSE_ORIGIN = 4003;
const CLOSE_NORMAL = 1000;

type Hello = Extract<ClientMessage, { t: 'hello' }>;

/** O que a conexão pede ao servidor. */
export interface ConnectionContext {
  readonly maxFrameBytes: number;
  readonly maxClientsPerRoom: number;
  readonly presence: Omit<PresenceOptions, 'now'>;
  readonly helloTimeoutMs: number;
  readonly now: () => number;
  readonly logger: CollaborationServerLogger;
  readonly allowedOrigins: readonly string[] | undefined;
  readonly authorize:
    ((request: AuthorizeRequest) => AuthorizeResult | Promise<AuthorizeResult>) | undefined;
  getRoom(documentId: string): Promise<Result<Room, CollaborationError>>;
  /** A conexão larga a sala: sem clientes, ela passa a esperar a descarga por ociosidade. */
  releaseRoom(room: Room): void;
  /** Entrega um commit à fila da sala. */
  submitCommit(room: Room, pending: PendingCommit): void;
}

type Phase = 'awaiting-hello' | 'joining' | 'joined' | 'closed';

/**
 * Atende uma conexão do `hello` até o fechamento. Não conhece o meio: só fala com a
 * `ServerConnection`.
 */
export function serveConnection(
  context: ConnectionContext,
  connection: ServerConnection,
  request: ConnectionRequest,
): void {
  const origin = request.headers.get('origin') ?? undefined;
  if (context.allowedOrigins !== undefined && !context.allowedOrigins.includes(origin ?? '')) {
    // Antes de tudo: sem mensagem, sem prazo de hello e sem chamar o `authorize` (R19).
    context.logger.info?.('conexão recusada: origem fora de allowedOrigins', {
      reason: 'origin',
      originPresent: origin !== undefined,
    });
    try {
      connection.close(CLOSE_ORIGIN, 'origin');
    } catch {
      // A conexão já estava perdida.
    }
    return;
  }
  let phase: Phase = 'awaiting-hello';
  let room: Room | undefined;
  let client: RoomClient | undefined;
  let presence: PresenceChannel | undefined;
  const early: Array<{ readonly message: ClientMessage; readonly bytes: number }> = [];
  const unsubscribe: Array<() => void> = [];

  const helloTimer = setTimeout(() => {
    fatal('PROTOCOL_ERROR', `O hello não chegou em ${context.helloTimeoutMs} ms.`, {
      reason: 'hello_timeout',
    });
  }, context.helloTimeoutMs);

  function sendFrame(frame: Uint8Array): boolean {
    if (phase === 'closed') return false;
    try {
      connection.send(frame);
      return true;
    } catch {
      return false;
    }
  }

  function send(message: ServerMessage): boolean {
    return sendFrame(encodeServerMessage(message));
  }

  /** Solta tudo o que a conexão prendia, uma vez só. */
  function finish(): boolean {
    if (phase === 'closed') return false;
    phase = 'closed';
    clearTimeout(helloTimer);
    for (const stop of unsubscribe.splice(0)) stop();
    presence?.dispose();
    if (room !== undefined && client !== undefined && room.remove(client)) {
      // Só quem sai de verdade avisa os outros; a conexão substituída (4001) não passa por aqui.
      room.presences.delete(client.sessionId);
      room.broadcastPresence(client.sessionId, null);
      context.releaseRoom(room);
    }
    return true;
  }

  function closeWith(code: number, reason: string): void {
    if (!finish()) return;
    try {
      connection.close(code, reason);
    } catch {
      // A conexão já estava perdida.
    }
  }

  function fatal(code: CollaborationErrorCode, message: string, details?: unknown): void {
    if (phase === 'closed') return;
    send({
      t: 'error',
      code,
      message,
      fatal: true,
      ...(details === undefined ? {} : { details }),
    });
    closeWith(CLOSE_FATAL, code);
  }

  function fatalFrom(error: CollaborationError): void {
    fatal(error.code, error.message, error.details);
  }

  async function join(hello: Hello): Promise<void> {
    if (hello.v !== PROTOCOL_VERSION) {
      return fatal('UNSUPPORTED_VERSION', `A versão ${hello.v} do protocolo não é suportada.`, {
        supported: [PROTOCOL_VERSION],
      });
    }
    if (!DOCUMENT_ID.test(hello.documentId)) {
      return fatal('INVALID_DOCUMENT', 'O documentId tem de casar com ^[A-Za-z0-9_-]{1,128}$.');
    }

    let access: RoomAccess = 'write';
    let user: RoomClient['user'];
    if (context.authorize !== undefined) {
      const decision = await runAuthorize(
        context.authorize,
        {
          documentId: hello.documentId,
          sessionId: hello.sessionId,
          credentials: hello.credentials,
          origin,
          headers: request.headers,
          context: request.context,
        },
        context.logger,
      );
      if (phase !== 'joining') return;
      if (!decision.allow) {
        return fatal(
          decision.code,
          decision.reason === undefined
            ? 'Acesso recusado.'
            : `Acesso recusado: ${decision.reason}`,
        );
      }
      access = decision.access;
      user = decision.user;
    }

    if (hello.provider !== SUPPORTED_PROVIDER) {
      return fatal('UNSUPPORTED', `O provider "${hello.provider}" não é o deste servidor.`, {
        provider: SUPPORTED_PROVIDER,
      });
    }

    const opened = await context.getRoom(hello.documentId);
    if (!opened.ok) {
      if (phase === 'joining') fatalFrom(opened.error);
      return;
    }
    const joined = opened.value;
    try {
      if (phase !== 'joining') return;

      if (
        !joined.clients.has(hello.sessionId) &&
        joined.clients.size >= context.maxClientsPerRoom
      ) {
        return fatal('LIMIT_EXCEEDED', `A sala já tem ${context.maxClientsPerRoom} clientes.`, {
          reason: 'clients',
        });
      }
      if (hello.roomEpoch !== undefined && hello.roomEpoch !== joined.roomEpoch) {
        return fatalFrom(
          createCollaborationError(
            'ROOM_EPOCH_MISMATCH',
            `Room epoch incompatível: esperado "${hello.roomEpoch}", atual no servidor "${joined.roomEpoch}".`,
            { clientEpoch: hello.roomEpoch, serverEpoch: joined.roomEpoch },
          ),
        );
      }
      const missing = joined.missingFor(hello.syncState);
      if (!missing.ok) return fatalFrom(missing.error);

      // O welcome é montado antes de o cliente entrar: um welcome que não cabe recusa a
      // conexão nova sem derrubar a antiga do mesmo sessionId.
      const welcomeFrame = encodeServerMessage({
        t: 'welcome',
        v: PROTOCOL_VERSION,
        roomEpoch: joined.roomEpoch,
        access,
        missing: missing.value,
        serverSyncState: joined.serverSyncState(),
        serverTime: context.now(),
        ...(user === undefined ? {} : { user }),
      });
      if (welcomeFrame.byteLength > context.maxFrameBytes) {
        context.logger.error('welcome maior que maxFrameBytes; a conexão foi recusada', {
          documentId: hello.documentId,
          sessionId: hello.sessionId,
          bytes: welcomeFrame.byteLength,
          maxFrameBytes: context.maxFrameBytes,
        });
        return fatal(
          'LIMIT_EXCEEDED',
          'O estado da sala não cabe em um quadro do protocolo; tentar de novo não resolve.',
          { reason: 'welcome' },
        );
      }

      const self: RoomClient = {
        sessionId: hello.sessionId,
        access,
        ...(user === undefined ? {} : { user }),
        send,
        sendFrame,
        close: closeWith,
      };
      room = joined;
      client = self;
      const replaced = joined.add(self);
      // A sessão continua viva na conexão nova: a antiga sai sem aviso aos outros.
      replaced?.close(CLOSE_REPLACED, 'substituída');
      presence = createPresenceChannel(joined, self, { ...context.presence, now: context.now });
      sendFrame(welcomeFrame);
      // O recém-chegado vê quem já está na sala (R17).
      for (const [sessionId, state] of joined.presences) {
        if (sessionId !== self.sessionId) send({ t: 'presence', from: sessionId, state });
      }
      phase = 'joined';
      for (const { message, bytes } of early.splice(0)) route(message, bytes);
    } finally {
      // Quem não chegou a entrar deixa a sala para a descarga por ociosidade.
      if (client === undefined) context.releaseRoom(joined);
    }
  }

  function rejectCommit(id: number, code: CollaborationErrorCode, message: string): void {
    send({ t: 'error', id, code, message, fatal: false });
  }

  function handleCommit(message: Extract<ClientMessage, { t: 'commit' }>): void {
    if (room === undefined || client === undefined) return;
    if (client.access === 'read') {
      return rejectCommit(message.id, 'UNAUTHORIZED', 'Esta sessão só tem acesso de leitura.');
    }
    if (message.roomEpoch !== room.roomEpoch || room.retired) {
      return rejectCommit(
        message.id,
        'ROOM_EPOCH_MISMATCH',
        `Room epoch incompatível: esperado "${message.roomEpoch}", atual no servidor "${room.roomEpoch}".`,
      );
    }
    const known = room.receipts.get(message.commitId);
    if (known !== undefined) {
      // ACK perdido: o mesmo recibo, sem aplicar nem repassar de novo (COLLAB-13).
      send({ t: 'ack', id: message.id, receipt: known });
      return;
    }
    context.submitCommit(room, {
      client,
      id: message.id,
      commitId: message.commitId,
      update: message.update,
    });
  }

  function route(message: ClientMessage, bytes: number): void {
    if (phase !== 'joined' || room === undefined) return;
    switch (message.t) {
      case 'hello':
        fatal('PROTOCOL_ERROR', 'O hello só vale como primeira mensagem da conexão.');
        return;
      case 'sync': {
        const missing = room.missingFor(message.syncState);
        if (missing.ok) send({ t: 'synced', id: message.id, missing: missing.value });
        else {
          send({
            t: 'error',
            id: message.id,
            code: missing.error.code,
            message: missing.error.message,
            fatal: false,
            details: missing.error.details,
          });
        }
        return;
      }
      case 'commit':
        handleCommit(message);
        return;
      case 'presence':
        presence?.receive(message.state, bytes);
        return;
      case 'bye':
        closeWith(CLOSE_NORMAL, 'bye');
        return;
      default:
        return;
    }
  }

  function onFrame(frame: Uint8Array): void {
    if (phase === 'closed') return;
    const decoded = decodeClientMessage(frame, { maxFrameBytes: context.maxFrameBytes });
    if (!decoded.ok) return fatalFrom(decoded.error);
    const message = decoded.value;
    switch (phase) {
      case 'awaiting-hello':
        if (message.t !== 'hello') {
          fatal('PROTOCOL_ERROR', 'A primeira mensagem da conexão tem de ser o hello.');
          return;
        }
        clearTimeout(helloTimer);
        phase = 'joining';
        join(message).catch((error: unknown) => {
          context.logger.error('erro interno ao entrar na sala', {
            code: 'CONNECTION_FAILED',
            cause: error instanceof Error ? error.name : typeof error,
          });
          fatal('CONNECTION_FAILED', 'Erro interno do servidor ao entrar na sala.');
        });
        return;
      case 'joining':
        early.push({ message, bytes: frame.byteLength });
        return;
      default:
        route(message, frame.byteLength);
    }
  }

  unsubscribe.push(
    connection.onFrame(onFrame),
    connection.onClose(() => finish()),
  );
}
