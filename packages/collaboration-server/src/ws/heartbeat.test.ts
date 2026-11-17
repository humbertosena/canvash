import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { WebSocket, WebSocketServer } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CollaborationServer, ConnectionRequest, ServerConnection } from '../types.js';
import { attachWebSocketServer } from './index.js';

/** Um socket do `ws` reduzido ao que o adaptador usa. */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: unknown[] = [];
  pings = 0;
  terminated = false;
  closedWith: { code: number; reason: string } | undefined;
  failPing = false;
  failClose = false;
  failSend = false;

  /** O `ws` chama o callback com `null` ou `undefined` quando o envio deu certo. */
  successValue: null | undefined = null;

  send(data: unknown, _options: unknown, callback: (error?: Error | null) => void): void {
    this.sent.push(data);
    callback(this.failSend ? new Error('falha de envio') : this.successValue);
  }

  ping(): void {
    if (this.failPing) throw new Error('socket fechado');
    this.pings += 1;
  }

  terminate(): void {
    this.terminated = true;
    this.readyState = 3;
    this.emit('close', 1006, Buffer.alloc(0));
  }

  close(code: number, reason: string): void {
    if (this.failClose) throw new Error('código inválido');
    this.closedWith = { code, reason };
    this.readyState = 3;
    this.emit('close', code, Buffer.from(reason));
  }
}

class FakeWss extends EventEmitter {
  options: { verifyClient?: unknown } = {};
}

function setup(allowed: (origin: string | undefined) => boolean = () => true) {
  const connections: Array<{ connection: ServerConnection; request: ConnectionRequest }> = [];
  const server = {
    handleConnection(connection: ServerConnection, request: ConnectionRequest) {
      connections.push({ connection, request });
    },
    isOriginAllowed: allowed,
  } as unknown as CollaborationServer;
  const wss = new FakeWss();
  return { server, wss, connections, asWss: wss as unknown as WebSocketServer };
}

function connect(wss: FakeWss, headers: Record<string, string | string[]> = {}): FakeSocket {
  const socket = new FakeSocket();
  wss.emit('connection', socket as unknown as WebSocket, { headers } as unknown as IncomingMessage);
  return socket;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('heartbeat do adaptador ws (US-S.8)', () => {
  it('manda um ping a cada ciclo e mantém a conexão que responde com pong', () => {
    vi.useFakeTimers();
    const { server, wss, asWss } = setup();
    attachWebSocketServer(server, asWss, { heartbeatMs: 1_000 });
    const socket = connect(wss);

    for (let cycle = 1; cycle <= 5; cycle += 1) {
      vi.advanceTimersByTime(1_000);
      expect(socket.pings).toBe(cycle);
      socket.emit('pong');
    }

    expect(socket.terminated).toBe(false);
  });

  it('sem pong em dois ciclos, a conexão cai', () => {
    vi.useFakeTimers();
    const { server, wss, asWss } = setup();
    attachWebSocketServer(server, asWss, { heartbeatMs: 1_000 });
    const socket = connect(wss);

    vi.advanceTimersByTime(1_000);
    expect(socket.terminated).toBe(false);
    vi.advanceTimersByTime(1_000);

    expect(socket.terminated).toBe(true);
    expect(socket.pings).toBe(1);
  });

  it('o pong que chega entre os dois ciclos salva a conexão', () => {
    vi.useFakeTimers();
    const { server, wss, asWss } = setup();
    attachWebSocketServer(server, asWss, { heartbeatMs: 1_000 });
    const socket = connect(wss);

    vi.advanceTimersByTime(1_000);
    vi.advanceTimersByTime(500);
    socket.emit('pong');
    vi.advanceTimersByTime(500);

    expect(socket.terminated).toBe(false);
    expect(socket.pings).toBe(2);
  });

  it('cada conexão tem o seu pong: a que cala cai, a que responde fica', () => {
    vi.useFakeTimers();
    const { server, wss, asWss } = setup();
    attachWebSocketServer(server, asWss, { heartbeatMs: 1_000 });
    const quiet = connect(wss);
    const alive = connect(wss);

    vi.advanceTimersByTime(1_000);
    alive.emit('pong');
    vi.advanceTimersByTime(1_000);

    expect(quiet.terminated).toBe(true);
    expect(alive.terminated).toBe(false);
  });

  it('a conexão que fechou sai do heartbeat; um ping que falha derruba o socket sem parar o ciclo', () => {
    vi.useFakeTimers();
    const { server, wss, asWss } = setup();
    attachWebSocketServer(server, asWss, { heartbeatMs: 1_000 });
    const gone = connect(wss);
    const broken = connect(wss);
    const fine = connect(wss);
    broken.failPing = true;
    gone.emit('close', 1000, Buffer.alloc(0));

    vi.advanceTimersByTime(1_000);

    expect(gone.pings).toBe(0);
    expect(broken.terminated).toBe(true);
    expect(fine.pings).toBe(1);
  });

  it('o padrão é um ciclo de 15 s', () => {
    vi.useFakeTimers();
    const { server, wss, asWss } = setup();
    attachWebSocketServer(server, asWss);
    const socket = connect(wss);

    vi.advanceTimersByTime(14_999);
    expect(socket.pings).toBe(0);
    vi.advanceTimersByTime(1);

    expect(socket.pings).toBe(1);
  });

  it('desligar solta o timer e o ouvinte de conexão', () => {
    vi.useFakeTimers();
    const { server, wss, asWss, connections } = setup();
    const detach = attachWebSocketServer(server, asWss, { heartbeatMs: 1_000 });
    const socket = connect(wss);

    detach();
    vi.advanceTimersByTime(10_000);
    connect(wss);

    expect(vi.getTimerCount()).toBe(0);
    expect(socket.pings).toBe(0);
    expect(connections).toHaveLength(1);
    expect(wss.listenerCount('connection')).toBe(0);
  });
});

describe('o socket como ServerConnection', () => {
  it('entrega os cabeçalhos do upgrade e a requisição como contexto', () => {
    const { server, wss, asWss, connections } = setup();
    attachWebSocketServer(server, asWss);

    connect(wss, { origin: 'https://app.test', 'x-lista': ['a', 'b'], cookie: 'sessao=1' });

    const request = connections[0]?.request;
    expect(request?.headers.get('origin')).toBe('https://app.test');
    expect(request?.headers.get('x-lista')).toBe('a, b');
    expect(request?.headers.get('cookie')).toBe('sessao=1');
    expect((request?.context as { headers: unknown }).headers).toMatchObject({
      cookie: 'sessao=1',
    });
  });

  it('cabeçalho que o Headers não aceita fica de fora, sem derrubar a conexão', () => {
    const { server, wss, asWss, connections } = setup();
    attachWebSocketServer(server, asWss);

    connect(wss, { 'cabeçalho inválido': 'x', origin: 'https://app.test' });

    expect(connections[0]?.request.headers.get('origin')).toBe('https://app.test');
  });

  it('send manda binário, só com o socket aberto; falha de envio termina o socket', () => {
    const { server, wss, asWss, connections } = setup();
    attachWebSocketServer(server, asWss);
    const socket = connect(wss);
    const connection = connections[0]?.connection;

    connection?.send(new Uint8Array([1, 2]));
    socket.successValue = undefined;
    connection?.send(new Uint8Array([5]));
    expect(socket.terminated).toBe(false);
    expect(socket.sent).toHaveLength(2);
    socket.sent.length = 1;
    socket.failSend = true;
    connection?.send(new Uint8Array([3]));
    expect(socket.terminated).toBe(true);
    connection?.send(new Uint8Array([4]));

    expect(socket.sent).toHaveLength(2);
  });

  it('close usa o código e o motivo; se o ws recusa o código, termina o socket', () => {
    const { server, wss, asWss, connections } = setup();
    attachWebSocketServer(server, asWss);
    const fine = connect(wss);
    const odd = connect(wss);
    odd.failClose = true;

    connections[0]?.connection.close(4001, 'substituída');
    connections[1]?.connection.close(1006, 'inválido');

    expect(fine.closedWith).toEqual({ code: 4001, reason: 'substituída' });
    expect(odd.terminated).toBe(true);
  });

  it('entrega o quadro como Uint8Array para Buffer, ArrayBuffer e lista de Buffer, e dá para tirar o ouvinte', () => {
    const { server, wss, asWss, connections } = setup();
    attachWebSocketServer(server, asWss);
    const socket = connect(wss);
    const frames: Uint8Array[] = [];
    const stop = connections[0]?.connection.onFrame((frame) => frames.push(frame));

    socket.emit('message', Buffer.from([1, 2]), true);
    socket.emit('message', new Uint8Array([3, 4]).buffer, true);
    socket.emit('message', [Buffer.from([5]), Buffer.from([6])], true);
    stop?.();
    socket.emit('message', Buffer.from([9]), true);

    expect(frames.map((frame) => [...frame])).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    expect(frames.every((frame) => frame.constructor === Uint8Array)).toBe(true);
  });

  it('avisa quem ouve o fechamento e deixa tirar o ouvinte; um error do socket não derruba o processo', () => {
    const { server, wss, asWss, connections } = setup();
    attachWebSocketServer(server, asWss);
    const socket = connect(wss);
    let closes = 0;
    const stop = connections[0]?.connection.onClose(() => {
      closes += 1;
    });

    expect(() => socket.emit('error', new Error('reset'))).not.toThrow();
    socket.emit('close', 1006, Buffer.alloc(0));
    stop?.();
    socket.emit('close', 1006, Buffer.alloc(0));

    expect(closes).toBe(1);
  });
});

describe('origem no upgrade (US-S.8, R19)', () => {
  function verify(
    wss: FakeWss,
    origin: string | undefined,
  ): { result: boolean; code?: number; message?: string } {
    let outcome: { result: boolean; code?: number; message?: string } | undefined;
    const verifyClient = wss.options.verifyClient as (
      info: { origin: string; secure: boolean; req: IncomingMessage },
      callback: (result: boolean, code?: number, message?: string) => void,
    ) => void;
    verifyClient(
      {
        origin: origin ?? '',
        secure: false,
        req: { headers: origin === undefined ? {} : { origin } } as IncomingMessage,
      },
      (result, code, message) => {
        outcome = {
          result,
          ...(code === undefined ? {} : { code }),
          ...(message === undefined ? {} : { message }),
        };
      },
    );
    if (outcome === undefined) throw new Error('o verifyClient não respondeu');
    return outcome;
  }

  it('a origem que o núcleo recusaria recebe 403 no upgrade; a permitida passa', () => {
    const { server, wss, asWss } = setup((origin) => origin === 'https://app.test');
    attachWebSocketServer(server, asWss);

    expect(verify(wss, 'https://app.test')).toEqual({ result: true });
    expect(verify(wss, 'https://atacante.test')).toEqual({
      result: false,
      code: 403,
      message: 'Forbidden',
    });
    expect(verify(wss, undefined)).toEqual({ result: false, code: 403, message: 'Forbidden' });
  });

  it('respeita o verifyClient que o host já tinha, nas formas síncrona e assíncrona, e o devolve ao desligar', () => {
    const syncHook = vi.fn(() => false);
    const asyncHook = vi.fn((_info: unknown, callback: (result: boolean, code?: number) => void) =>
      callback(false, 401),
    );
    const first = setup();
    first.wss.options.verifyClient = syncHook;
    const detachFirst = attachWebSocketServer(first.server, first.asWss);
    const second = setup();
    second.wss.options.verifyClient = asyncHook;
    attachWebSocketServer(second.server, second.asWss);

    expect(verify(first.wss, 'https://qualquer.test')).toEqual({ result: false });
    expect(verify(second.wss, 'https://qualquer.test')).toEqual({ result: false, code: 401 });
    detachFirst();

    expect(first.wss.options.verifyClient).toBe(syncHook);
  });

  it('o null que o ws põe no lugar de um verifyClient ausente vale por nenhum, e volta como estava', () => {
    const { server, wss, asWss } = setup();
    wss.options.verifyClient = null;
    const detach = attachWebSocketServer(server, asWss);

    expect(verify(wss, 'https://qualquer.test')).toEqual({ result: true });
    detach();

    expect(wss.options.verifyClient).toBeNull();
  });

  it('sem verifyClient prévio, desligar o deixa de novo sem nenhum', () => {
    const { server, wss, asWss } = setup();
    const detach = attachWebSocketServer(server, asWss);

    detach();

    expect('verifyClient' in wss.options).toBe(false);
  });
});
