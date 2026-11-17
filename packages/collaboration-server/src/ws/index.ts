import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  DEFAULT_MAX_FRAME_BYTES,
  createCollaborationError,
  err,
  ok,
  type CollaborationError,
  type Result,
} from '@canvash/collaboration';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { CollaborationServer, ServerConnection } from '../types.js';

export interface WebSocketAdapterOptions {
  /** Intervalo do ping. Sem pong em dois ciclos, a conexão cai. Padrão 15 s. */
  readonly heartbeatMs?: number;
}

export interface ListenOptions extends WebSocketAdapterOptions {
  /** 0 escolhe uma porta livre. */
  readonly port: number;
  /** Padrão `127.0.0.1`: só a máquina local. */
  readonly host?: string;
  /** Caminho do upgrade. Padrão `/collab`. */
  readonly path?: string;
  /** Maior quadro que o `ws` entrega. Padrão `DEFAULT_MAX_FRAME_BYTES`; acompanhe o `maxFrameBytes` do servidor. */
  readonly maxPayloadBytes?: number;
  /**
   * Servidor HTTP do host, já escutando: o adaptador só pega o upgrade do caminho e não o fecha.
   * Sem ele, o adaptador cria o servidor HTTP e o fecha em `close()`.
   */
  readonly server?: Server;
}

export interface ListenHandle {
  readonly url: string;
  /** Fecha os clientes (1001), solta o heartbeat e, se foi o adaptador que o criou, o servidor HTTP. */
  close(): Promise<void>;
}

const SCHEME = 'ws';
const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_PATH = '/collab';
const CLOSE_GRACE_MS = 1_000;
const GOING_AWAY = 1001;

function toHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    try {
      for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
    } catch {
      // Um cabeçalho que o `Headers` não aceita não serve ao `authorize`: fica de fora.
    }
  }
  return headers;
}

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  // Cópia: o `ws` pode reusar o buffer do quadro.
  return new Uint8Array(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
}

function toConnection(socket: WebSocket): ServerConnection {
  return {
    send(frame) {
      if (socket.readyState !== socket.OPEN) return;
      // O callback do `ws` recebe `undefined` ou `null` quando o envio deu certo.
      socket.send(frame, { binary: true }, (error?: Error | null) => {
        if (error) socket.terminate();
      });
    },
    close(code, reason) {
      try {
        socket.close(code, reason);
      } catch {
        socket.terminate();
      }
    },
    onFrame(listener) {
      const handler = (data: RawData): void => listener(toBytes(data));
      socket.on('message', handler);
      return () => socket.off('message', handler);
    },
    onClose(listener) {
      socket.on('close', listener);
      return () => socket.off('close', listener);
    },
  };
}

type VerifyCallback = (
  result: boolean,
  code?: number,
  message?: string,
  headers?: Record<string, string>,
) => void;
type VerifyClient = (
  info: { origin: string; secure: boolean; req: IncomingMessage },
  callback: VerifyCallback,
) => void;

/**
 * Liga o núcleo a um `ws.WebSocketServer` que o host já criou. Cada socket vira uma
 * `ServerConnection`; os cabeçalhos do upgrade vão em `ConnectionRequest.headers` e a requisição
 * (`IncomingMessage`) em `ConnectionRequest.context`, para o `authorize` ler o que precisar.
 * Devolve a função que desliga: ela não fecha os sockets que já estão abertos.
 */
export function attachWebSocketServer(
  server: CollaborationServer,
  wss: WebSocketServer,
  options: WebSocketAdapterOptions = {},
): () => void {
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const tracked = new Map<WebSocket, { alive: boolean }>();

  // A origem que o núcleo recusaria é recusada já no upgrade, com HTTP 403.
  const wssOptions = wss.options as { verifyClient?: unknown };
  const hadVerifyClient = 'verifyClient' in wssOptions;
  const original = wssOptions.verifyClient;
  // O `ws` guarda `null` quando o host não pôs nenhum.
  const previous = typeof original === 'function' ? original : undefined;
  const verifyClient: VerifyClient = (info, callback) => {
    const origin = info.req.headers.origin;
    if (!server.isOriginAllowed(typeof origin === 'string' ? origin : undefined)) {
      callback(false, 403, 'Forbidden');
      return;
    }
    if (previous === undefined) callback(true);
    else if (previous.length >= 2) (previous as VerifyClient)(info, callback);
    else callback((previous as (info: Parameters<VerifyClient>[0]) => boolean)(info));
  };
  wssOptions.verifyClient = verifyClient;

  const onConnection = (socket: WebSocket, request: IncomingMessage): void => {
    // Sem um ouvinte de `error`, o erro de um socket derrubaria o processo.
    socket.on('error', () => undefined);
    const state = { alive: true };
    tracked.set(socket, state);
    socket.on('pong', () => {
      state.alive = true;
    });
    socket.on('close', () => {
      tracked.delete(socket);
    });
    server.handleConnection(toConnection(socket), {
      headers: toHeaders(request.headers),
      context: request,
    });
  };
  wss.on('connection', onConnection);

  const heartbeat = setInterval(() => {
    for (const [socket, state] of tracked) {
      if (!state.alive) {
        // Dois ciclos sem pong: a conexão morreu sem avisar.
        socket.terminate();
        tracked.delete(socket);
        continue;
      }
      state.alive = false;
      try {
        socket.ping();
      } catch {
        socket.terminate();
      }
    }
  }, heartbeatMs);
  heartbeat.unref();

  return () => {
    clearInterval(heartbeat);
    wss.off('connection', onConnection);
    if (hadVerifyClient) wssOptions.verifyClient = original;
    else delete wssOptions.verifyClient;
    tracked.clear();
  };
}

function failure(message: string, cause: unknown): CollaborationError {
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? String((cause as { code: unknown }).code)
      : undefined;
  return createCollaborationError(
    'CONNECTION_FAILED',
    message,
    code === undefined ? undefined : { code },
  );
}

function urlOf(host: string, port: number, path: string): string {
  // O esquema vem de uma constante: o servidor de referência escuta em texto puro, em loopback.
  return `${SCHEME}://${host.includes(':') ? `[${host}]` : host}:${port}${path}`;
}

/**
 * Cria o servidor HTTP e o WebSocket do núcleo (ou usa o `server` do host) e começa a escutar.
 * Falha de porta devolve `CONNECTION_FAILED` com o código do sistema em `details.code`.
 */
export async function listenWebSocket(
  server: CollaborationServer,
  options: ListenOptions,
): Promise<Result<ListenHandle, CollaborationError>> {
  const host = options.host ?? '127.0.0.1';
  const path = options.path ?? DEFAULT_PATH;
  const owned = options.server === undefined;
  const http =
    options.server ??
    createServer((_request, response) => {
      response.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Upgrade Required');
    });

  if (owned) {
    try {
      await new Promise<void>((resolve, reject) => {
        http.once('error', reject);
        http.listen(options.port, host, () => {
          http.off('error', reject);
          resolve();
        });
      });
    } catch (error) {
      return err(failure(`Não foi possível escutar em ${host}:${options.port}.`, error));
    }
  } else if (!http.listening) {
    return err(
      createCollaborationError(
        'CONNECTION_FAILED',
        'O servidor HTTP do host ainda não está escutando.',
      ),
    );
  }

  const address = http.address() as AddressInfo;
  const wss = new WebSocketServer({
    server: http,
    path,
    maxPayload: options.maxPayloadBytes ?? DEFAULT_MAX_FRAME_BYTES,
  });
  const detach = attachWebSocketServer(server, wss, options);
  let closing: Promise<void> | undefined;

  return ok({
    url: urlOf(owned ? host : address.address, address.port, path),
    close(): Promise<void> {
      closing ??= (async () => {
        detach();
        const closed = new Promise<void>((resolve) => wss.once('close', () => resolve()));
        wss.close();
        for (const client of wss.clients) client.close(GOING_AWAY, 'closing');
        const grace = new Promise<void>((resolve) => {
          setTimeout(resolve, CLOSE_GRACE_MS).unref();
        });
        await Promise.race([closed, grace]);
        for (const client of wss.clients) client.terminate();
        await closed;
        if (owned) {
          http.closeAllConnections();
          await new Promise<void>((resolve) => http.close(() => resolve()));
        }
      })();
      return closing;
    },
  });
}
