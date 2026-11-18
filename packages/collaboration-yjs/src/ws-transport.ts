import {
  DEFAULT_MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  createCollaborationError,
  decodeServerMessage,
  encodeClientMessage,
  err,
  ok,
  type ClientMessage,
  type CollaborationCredentials,
  type CollaborationError,
  type CollaborationTransport,
  type CommitReceipt,
  type CreateTransport,
  type Result,
  type ServerMessage,
  type TransportHello,
  type TransportInbound,
  type TransportState,
  type TransportWelcome,
} from '@canvash/collaboration';
import {
  backoffDelay,
  resolveBackoff,
  type BackoffOptions,
  type ResolvedBackoff,
} from './backoff.js';

/** O que o transporte usa de um `WebSocket`: o do navegador, o global do Node ou o do pacote `ws`. */
export interface WebSocketLike {
  binaryType: string;
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: WebSocketEventLike) => void,
  ): void;
  removeEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: WebSocketEventLike) => void,
  ): void;
}

export interface WebSocketEventLike {
  readonly data?: unknown;
  readonly code?: number;
  readonly reason?: string;
}

export type WebSocketConstructorLike = new (url: string) => WebSocketLike;

export interface WebSocketTransportOptions {
  /** URL com esquema `wss:` ou `ws:`. O `ws:` (sem TLS) só vale para localhost, 127.0.0.1 e ::1, salvo `allowInsecure`. */
  readonly url: string;
  readonly allowInsecure?: boolean;
  /** Chamado a cada conexão; o resultado substitui as credenciais do `hello`. Bom para token que expira. */
  readonly getCredentials?: () =>
    CollaborationCredentials | undefined | Promise<CollaborationCredentials | undefined>;
  /** Até o `welcome`, a cada tentativa. Padrão 10 s. */
  readonly openTimeoutMs?: number;
  /** Até o `ack` ou o `synced`. Padrão 30 s. */
  readonly requestTimeoutMs?: number;
  readonly backoff?: BackoffOptions;
  /** Maior quadro aceito e enviado. Padrão `DEFAULT_MAX_FRAME_BYTES`. */
  readonly maxFrameBytes?: number;
  /** Acima disso em `bufferedAmount`, a presença é descartada. Padrão 1 MiB. */
  readonly presenceBackpressureBytes?: number;
  /** Para Node ou testes. Padrão: `globalThis.WebSocket`. */
  readonly WebSocket?: WebSocketConstructorLike;
  /** Sorteio do jitter do backoff, em [0, 1]. Padrão `Math.random`. */
  readonly random?: () => number;
}

const DEFAULT_OPEN_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_PRESENCE_BACKPRESSURE_BYTES = 1024 * 1024;
const NORMAL_CLOSURE = 1000;
const PROTOCOL_ERROR_CLOSURE = 1002;
/** Quanto tempo em `open` zera o backoff. */
const STABLE_OPEN_MS = 10_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

interface Config {
  readonly url: string;
  readonly openTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly maxFrameBytes: number;
  readonly presenceBackpressureBytes: number;
  readonly WebSocket: WebSocketConstructorLike;
  readonly backoff: ResolvedBackoff;
  readonly random: () => number;
}

function failure(
  message: string,
  details: { readonly reason: string; readonly [key: string]: unknown },
): CollaborationError {
  return createCollaborationError('CONNECTION_FAILED', message, details);
}

function disconnected(message: string): CollaborationError {
  return createCollaborationError('DISCONNECTED', message);
}

/** Confere as opções. Nada aqui lança: o que não serve volta como erro tipado no primeiro `open`. */
function resolveConfig(options: WebSocketTransportOptions): Result<Config, CollaborationError> {
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    return err(failure('A URL do transporte não é uma URL.', { reason: 'invalid_url' }));
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    return err(
      failure('A URL do transporte tem de ter o esquema wss: ou ws:.', { reason: 'invalid_url' }),
    );
  }
  if (url.username !== '' || url.password !== '') {
    return err(
      failure(
        'A URL do transporte não pode levar usuário nem senha: as credenciais vão no hello.',
        {
          reason: 'credentials_in_url',
        },
      ),
    );
  }
  if (
    url.protocol === 'ws:' &&
    options.allowInsecure !== true &&
    !LOOPBACK_HOSTS.has(url.hostname)
  ) {
    return err(
      failure(
        'O esquema ws: (sem TLS) só é aceito para localhost, 127.0.0.1 e ::1; use wss: ou allowInsecure.',
        {
          reason: 'insecure_url',
        },
      ),
    );
  }
  const numbers = {
    openTimeoutMs: options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    maxFrameBytes: options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES,
    presenceBackpressureBytes:
      options.presenceBackpressureBytes ?? DEFAULT_PRESENCE_BACKPRESSURE_BYTES,
  };
  for (const [field, value] of Object.entries(numbers)) {
    if (!Number.isFinite(value) || value <= 0) {
      return err(
        failure(`A opção ${field} tem de ser um número positivo.`, {
          reason: 'invalid_option',
          field,
        }),
      );
    }
  }
  const backoff = resolveBackoff(options.backoff);
  if (!backoff.ok) {
    return err(failure(backoff.error.message, { reason: 'invalid_option', field: 'backoff' }));
  }
  const WebSocketCtor =
    options.WebSocket ?? (globalThis as { WebSocket?: WebSocketConstructorLike }).WebSocket;
  if (WebSocketCtor === undefined) {
    return err(
      failure('Não há WebSocket neste ambiente; passe a opção WebSocket.', {
        reason: 'no_websocket',
      }),
    );
  }
  return ok({
    url: options.url,
    ...numbers,
    WebSocket: WebSocketCtor,
    backoff: backoff.value,
    random: options.random ?? Math.random,
  });
}

/** Os bytes de um quadro recebido, ou `undefined` se não é binário. */
function toBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return undefined;
}

function errorOf(message: Extract<ServerMessage, { t: 'error' }>): CollaborationError {
  return createCollaborationError(message.code, message.message, message.details);
}

/** Os erros que encerram as tentativas: tentar de novo não muda o que o servidor respondeu. */
const STOPPING_CODES: ReadonlySet<CollaborationError['code']> = new Set([
  'UNAUTHORIZED',
  'NOT_FOUND',
  'ROOM_EPOCH_MISMATCH',
  'UNSUPPORTED_VERSION',
  'UNSUPPORTED',
  'PROTOCOL_ERROR',
  'INVALID_DOCUMENT',
]);

function isStopping(error: CollaborationError): boolean {
  if (STOPPING_CODES.has(error.code)) return true;
  // Sala cheia passa; o `welcome` que não cabe no quadro não passa nunca.
  return (
    error.code === 'LIMIT_EXCEEDED' &&
    typeof error.details === 'object' &&
    error.details !== null &&
    (error.details as { reason?: unknown }).reason === 'welcome'
  );
}

/** O erro de um fechamento que encerra as tentativas, ou `undefined` se vale tentar de novo. */
function stoppingCloseError(code: number | undefined): CollaborationError | undefined {
  switch (code) {
    case 4001:
      return createCollaborationError('CONFLICT', 'A sessão foi substituída por outra conexão.', {
        reason: 'replaced',
        closeCode: code,
      });
    case 4003:
      return createCollaborationError(
        'UNAUTHORIZED',
        'O servidor não aceita a origem desta página.',
        {
          reason: 'origin',
          closeCode: code,
        },
      );
    case 4000:
      return createCollaborationError(
        'PROTOCOL_ERROR',
        'O servidor encerrou a conexão por erro fatal.',
        {
          reason: 'fatal_close',
          closeCode: code,
        },
      );
    case 1009:
      return createCollaborationError('LIMIT_EXCEEDED', 'Um quadro passou do limite do servidor.', {
        reason: 'frame',
        closeCode: code,
      });
    default:
      return undefined;
  }
}

interface PendingRequest {
  readonly resolve: (message: ServerMessage | CollaborationError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * `CollaborationTransport` sobre o `WebSocket` nativo, para o navegador falar com o servidor do
 * protocolo Canvash. Devolve a fábrica que o provider chama a cada `connect`: nada abre antes do
 * primeiro `open`, e opção inválida aparece ali como `CONNECTION_FAILED`, não como exceção.
 */
export function createWebSocketTransport(options: WebSocketTransportOptions): CreateTransport {
  return () => createTransport(options);
}

function createTransport(options: WebSocketTransportOptions): CollaborationTransport {
  let state: TransportState = 'idle';
  let config: Config | undefined;
  let getHello: (() => TransportHello) | undefined;
  let socket: WebSocketLike | undefined;
  let detachSocket: (() => void) | undefined;
  /** O socket atual já passou do `welcome`. */
  let established = false;
  /** O primeiro `open` já deu certo: a partir daí uma queda reconecta. */
  let hasOpened = false;
  /** Há uma tentativa de conexão em andamento (credenciais, socket ou handshake). */
  let attempting = false;
  let attempt = 0;
  let nextId = 1;
  const pending = new Map<number, PendingRequest>();
  const inboundListeners = new Set<(message: TransportInbound) => void>();
  const stateListeners = new Set<(state: TransportState, error?: CollaborationError) => void>();
  let finishOpen: ((result: Result<TransportWelcome, CollaborationError>) => void) | undefined;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;
  let stopWatching: (() => void) | undefined;

  /** O estado agora, sem o estreitamento de tipos que um `await` pelo meio desfaz. */
  function currentState(): TransportState {
    return state;
  }

  function setState(next: TransportState, error?: CollaborationError): void {
    if (state === next) return;
    state = next;
    for (const listener of [...stateListeners]) {
      try {
        listener(next, error);
      } catch {
        // Um ouvinte ruim não pode derrubar o enlace.
      }
    }
  }

  function emit(message: TransportInbound): void {
    for (const listener of [...inboundListeners]) {
      try {
        listener(message);
      } catch {
        // Idem.
      }
    }
  }

  function settleOpen(result: Result<TransportWelcome, CollaborationError>): void {
    const resolve = finishOpen;
    finishOpen = undefined;
    resolve?.(result);
  }

  function failPending(error: CollaborationError): void {
    for (const [id, request] of [...pending]) {
      pending.delete(id);
      clearTimeout(request.timer);
      request.resolve(error);
    }
  }

  /** Tira os ouvintes do socket e o fecha. Os eventos dele deixam de importar. */
  function dropSocket(code: number): void {
    detachSocket?.();
    detachSocket = undefined;
    const current = socket;
    socket = undefined;
    established = false;
    clearTimeout(openTimer);
    openTimer = undefined;
    try {
      current?.close(code);
    } catch {
      // O socket já estava fechado.
    }
  }

  /** O enlace acabou de vez: fecha o socket, resolve o que estava em aberto e vai a `closed`. */
  function terminate(error: CollaborationError | undefined, closeCode = NORMAL_CLOSURE): void {
    if (state === 'closed') return;
    dropSocket(closeCode);
    clearTimeout(reconnectTimer);
    clearTimeout(stableTimer);
    reconnectTimer = undefined;
    stableTimer = undefined;
    stopWatching?.();
    stopWatching = undefined;
    failPending(disconnected('O enlace foi fechado.'));
    settleOpen(err(error ?? disconnected('O enlace foi fechado antes do handshake terminar.')));
    setState('closed', error);
  }

  function protocolViolation(message: string): void {
    terminate(createCollaborationError('PROTOCOL_ERROR', message), PROTOCOL_ERROR_CLOSURE);
  }

  /** O enlace caiu, mas vale tentar de novo: pedidos em aberto voltam `DISCONNECTED` e o backoff corre. */
  function linkLost(cause: CollaborationError): void {
    if (state === 'closed') return;
    dropSocket(NORMAL_CLOSURE);
    clearTimeout(stableTimer);
    stableTimer = undefined;
    attempting = false;
    failPending(disconnected('O enlace caiu.'));
    setState('reconnecting', cause);
    scheduleReconnect();
  }

  function scheduleReconnect(): void {
    const resolved = config;
    if (resolved === undefined || reconnectTimer !== undefined) return;
    const wait = backoffDelay(attempt, resolved.backoff, resolved.random);
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void connectOnce();
    }, wait);
  }

  /** `online` ou a aba visível de novo: não espera o backoff. */
  function reconnectNow(): void {
    if (currentState() !== 'reconnecting' || reconnectTimer === undefined) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    void connectOnce();
  }

  function watchWindow(): void {
    const win = (globalThis as { window?: EventTarget }).window;
    const doc = (globalThis as { document?: EventTarget & { visibilityState?: string } }).document;
    if (win === undefined) return;
    const onOffline = (): void => {
      if (currentState() === 'open') linkLost(disconnected('O navegador ficou sem rede.'));
    };
    const onOnline = (): void => reconnectNow();
    const onVisibility = (): void => {
      if (doc?.visibilityState === 'visible') reconnectNow();
    };
    win.addEventListener('offline', onOffline);
    win.addEventListener('online', onOnline);
    doc?.addEventListener('visibilitychange', onVisibility);
    stopWatching = () => {
      win.removeEventListener('offline', onOffline);
      win.removeEventListener('online', onOnline);
      doc?.removeEventListener('visibilitychange', onVisibility);
    };
  }

  /** Falha antes de o enlace estar aberto: na primeira vez encerra, depois só o que não adianta repetir. */
  function handshakeFailed(error: CollaborationError): void {
    if (!hasOpened || isStopping(error)) terminate(error);
    else linkLost(error);
  }

  function handleWelcome(message: Extract<ServerMessage, { t: 'welcome' }>): void {
    if (message.v !== PROTOCOL_VERSION) {
      terminate(
        createCollaborationError(
          'UNSUPPORTED_VERSION',
          `O servidor fala a versão ${message.v} do protocolo.`,
          { supported: [PROTOCOL_VERSION] },
        ),
      );
      return;
    }
    const welcome: TransportWelcome = {
      roomEpoch: message.roomEpoch,
      access: message.access,
      missing: message.missing,
      serverSyncState: message.serverSyncState,
      serverTime: message.serverTime,
      ...(message.user === undefined ? {} : { user: message.user }),
    };
    clearTimeout(openTimer);
    openTimer = undefined;
    established = true;
    attempting = false;
    stableTimer = setTimeout(() => {
      stableTimer = undefined;
      attempt = 0;
    }, STABLE_OPEN_MS);
    setState('open');
    if (!hasOpened) {
      hasOpened = true;
      watchWindow();
      settleOpen(ok(welcome));
    } else {
      // O `hello` da reconexão já levou o vetor atual: o `welcome` traz o que falta.
      emit({ type: 'resync', welcome });
    }
  }

  function handleMessage(message: ServerMessage): void {
    if (!established) {
      if (message.t === 'welcome') handleWelcome(message);
      else if (message.t === 'error') handshakeFailed(errorOf(message));
      return;
    }
    switch (message.t) {
      case 'ack':
      case 'synced': {
        const request = pending.get(message.id);
        if (request === undefined) return;
        pending.delete(message.id);
        clearTimeout(request.timer);
        request.resolve(message);
        return;
      }
      case 'error': {
        const error = errorOf(message);
        if (message.fatal) {
          // A expulsão pelo servidor (documento excluído, acesso revogado) para as tentativas.
          if (isStopping(error)) terminate(error);
          else linkLost(error);
          return;
        }
        const request = message.id === undefined ? undefined : pending.get(message.id);
        if (message.id !== undefined && request !== undefined) {
          pending.delete(message.id);
          clearTimeout(request.timer);
          request.resolve(error);
          return;
        }
        if (message.id === undefined) emit({ type: 'error', error, fatal: false });
        return;
      }
      case 'update':
        emit({
          type: 'update',
          commitId: message.commitId,
          from: message.from,
          update: message.update,
        });
        return;
      case 'presence':
        emit({ type: 'presence', from: message.from, state: message.state });
        return;
      case 'welcome':
        // Um segundo welcome na mesma conexão não faz sentido: ignora.
        return;
    }
  }

  function onSocketMessage(event: WebSocketEventLike): void {
    const bytes = toBytes(event.data);
    if (bytes === undefined) {
      protocolViolation('O servidor mandou um quadro que não é binário.');
      return;
    }
    const decoded = decodeServerMessage(bytes, { maxFrameBytes: config?.maxFrameBytes });
    if (!decoded.ok) {
      protocolViolation(`Quadro inválido do servidor: ${decoded.error.message}`);
      return;
    }
    handleMessage(decoded.value);
  }

  function onSocketClose(event: WebSocketEventLike): void {
    const stopping = stoppingCloseError(event.code);
    if (stopping !== undefined) {
      terminate(stopping);
      return;
    }
    handshakeFailed(
      failure('O servidor fechou a conexão.', { reason: 'closed', closeCode: event.code }),
    );
  }

  function openSocket(
    resolved: Config,
    hello: TransportHello,
    credentials: CollaborationCredentials | undefined,
  ): void {
    const created = new resolved.WebSocket(resolved.url);
    created.binaryType = 'arraybuffer';
    socket = created;
    established = false;
    const onOpen = (): void => {
      try {
        created.send(
          encodeClientMessage({
            t: 'hello',
            v: PROTOCOL_VERSION,
            provider: hello.provider,
            documentId: hello.documentId,
            sessionId: hello.sessionId,
            ...(hello.roomEpoch === undefined ? {} : { roomEpoch: hello.roomEpoch }),
            ...(credentials === undefined ? {} : { credentials }),
            syncState: hello.syncState,
          }),
        );
      } catch {
        handshakeFailed(failure('Não foi possível enviar o hello.', { reason: 'hello_failed' }));
      }
    };
    const onError = (): void => undefined;
    created.addEventListener('open', onOpen);
    created.addEventListener('message', onSocketMessage);
    created.addEventListener('close', onSocketClose);
    created.addEventListener('error', onError);
    detachSocket = () => {
      created.removeEventListener('open', onOpen);
      created.removeEventListener('message', onSocketMessage);
      created.removeEventListener('close', onSocketClose);
      created.removeEventListener('error', onError);
    };
    openTimer = setTimeout(() => {
      handshakeFailed(
        failure(`O welcome não chegou em ${resolved.openTimeoutMs} ms.`, {
          reason: 'open_timeout',
        }),
      );
    }, resolved.openTimeoutMs);
  }

  /** Uma tentativa de conexão: `getHello`, `getCredentials`, socket e handshake. */
  async function connectOnce(): Promise<void> {
    const resolved = config;
    const makeHello = getHello;
    if (resolved === undefined || makeHello === undefined || attempting) return;
    attempting = true;
    let hello: TransportHello;
    try {
      hello = makeHello();
    } catch {
      terminate(failure('A sessão não montou o hello.', { reason: 'get_hello_failed' }));
      return;
    }
    let credentials = hello.credentials;
    if (options.getCredentials !== undefined) {
      try {
        credentials = await options.getCredentials();
      } catch {
        handshakeFailed(
          failure('Não foi possível obter as credenciais.', { reason: 'get_credentials_failed' }),
        );
        return;
      }
    }
    // O transporte pode ter sido fechado, ou ter caído de novo, enquanto as credenciais eram buscadas.
    const now = currentState();
    if (now !== 'connecting' && now !== 'reconnecting') return;
    openSocket(resolved, hello, credentials);
  }

  function request(
    build: (id: number) => ClientMessage,
    onResponse: (message: ServerMessage | CollaborationError) => void,
  ): void {
    const resolved = config;
    const current = socket;
    if (state !== 'open' || resolved === undefined || current === undefined) {
      onResponse(disconnected('O enlace não está aberto.'));
      return;
    }
    const id = nextId;
    nextId += 1;
    const frame = encodeClientMessage(build(id));
    if (frame.byteLength > resolved.maxFrameBytes) {
      onResponse(
        createCollaborationError('LIMIT_EXCEEDED', 'O quadro passa de maxFrameBytes.', {
          reason: 'commit',
          bytes: frame.byteLength,
          maxFrameBytes: resolved.maxFrameBytes,
        }),
      );
      return;
    }
    try {
      current.send(frame);
    } catch {
      onResponse(disconnected('O envio falhou.'));
      return;
    }
    const timer = setTimeout(() => {
      pending.delete(id);
      onResponse(disconnected(`Sem resposta em ${resolved.requestTimeoutMs} ms.`));
      // Sem resposta, o enlace está morto, mesmo que o navegador ainda não tenha percebido.
      linkLost(disconnected('O servidor parou de responder.'));
    }, resolved.requestTimeoutMs);
    pending.set(id, { resolve: onResponse, timer });
  }

  return {
    get state(): TransportState {
      return state;
    },

    open(makeHello) {
      if (state !== 'idle') {
        return Promise.resolve(
          err(failure('O transporte só abre uma vez.', { reason: 'already_opened' })),
        );
      }
      const resolved = resolveConfig(options);
      if (!resolved.ok) {
        setState('closed', resolved.error);
        return Promise.resolve(resolved);
      }
      config = resolved.value;
      getHello = makeHello;
      setState('connecting');
      const result = new Promise<Result<TransportWelcome, CollaborationError>>((resolve) => {
        finishOpen = resolve;
      });
      void connectOnce();
      return result;
    },

    commit(commitId, update, roomEpoch) {
      return new Promise<Result<CommitReceipt, CollaborationError>>((resolve) => {
        request(
          (id) => ({ t: 'commit', id, commitId, roomEpoch, update }),
          (answer) => {
            if ('code' in answer) resolve(err(answer));
            else if (answer.t === 'ack') resolve(ok(answer.receipt));
            else resolve(err(disconnected('Resposta inesperada ao commit.')));
          },
        );
      });
    },

    sync(syncState) {
      return new Promise<Result<Uint8Array, CollaborationError>>((resolve) => {
        request(
          (id) => ({ t: 'sync', id, syncState }),
          (answer) => {
            if ('code' in answer) resolve(err(answer));
            else if (answer.t === 'synced') resolve(ok(answer.missing));
            else resolve(err(disconnected('Resposta inesperada ao sync.')));
          },
        );
      });
    },

    sendPresence(presence) {
      const resolved = config;
      const current = socket;
      if (state !== 'open' || resolved === undefined || current === undefined) return;
      // A presença não pode atrasar commits: com o buffer cheio, ela é que perde.
      if (current.bufferedAmount > resolved.presenceBackpressureBytes) return;
      try {
        current.send(encodeClientMessage({ t: 'presence', state: presence }));
      } catch {
        // Sem garantia de entrega.
      }
    },

    onInbound(listener) {
      inboundListeners.add(listener);
      return () => inboundListeners.delete(listener);
    },

    onStateChange(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },

    close() {
      if (state === 'closed') return;
      if (state === 'open' && socket !== undefined) {
        try {
          socket.send(encodeClientMessage({ t: 'bye' }));
        } catch {
          // O fechamento abaixo cobre o resto.
        }
      }
      terminate(undefined);
    },
  };
}
