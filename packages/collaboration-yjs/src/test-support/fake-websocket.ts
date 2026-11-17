import {
  decodeClientMessage,
  encodeServerMessage,
  type ClientMessage,
  type ServerMessage,
} from '@canvash/collaboration';

type EventName = 'open' | 'message' | 'close' | 'error';
type Listener = (event: { data?: unknown; code?: number; reason?: string }) => void;

/**
 * WebSocket controlado pelo teste: o teste faz o papel do servidor (`serverOpen`, `serverSend`,
 * `serverClose`) e lê o que o cliente mandou (`sentMessages`). Cada instância criada fica em
 * `FakeWebSocket.instances`, na ordem.
 */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  /** O último socket criado. */
  static last(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);
    if (socket === undefined) throw new Error('nenhum socket foi criado');
    return socket;
  }

  readyState = FakeWebSocket.CONNECTING;
  bufferedAmount = 0;
  binaryType = 'blob';
  readonly sent: Uint8Array[] = [];
  readonly closeCalls: Array<{ code: number | undefined; reason: string | undefined }> = [];
  /** `send` lança, como um socket que não está aberto. */
  failSend = false;
  private readonly listeners: Record<EventName, Set<Listener>> = {
    open: new Set(),
    message: new Set(),
    close: new Set(),
    error: new Set(),
  };

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: EventName, listener: Listener): void {
    this.listeners[type].add(listener);
  }

  removeEventListener(type: EventName, listener: Listener): void {
    this.listeners[type].delete(listener);
  }

  /** Quantos ouvintes ainda estão presos ao socket. */
  listenerCount(): number {
    return Object.values(this.listeners).reduce((total, set) => total + set.size, 0);
  }

  send(data: Uint8Array): void {
    if (this.failSend || this.readyState !== FakeWebSocket.OPEN) {
      throw new Error('InvalidStateError: o socket não está aberto');
    }
    this.sent.push(new Uint8Array(data));
  }

  /** O cliente fecha: o eco do fechamento chega na hora, como num servidor que responde. */
  close(code?: number, reason?: string): void {
    if (this.readyState >= FakeWebSocket.CLOSING) return;
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', { code: code ?? 1005, reason: reason ?? '' });
  }

  // O lado do servidor.

  serverOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }

  serverSend(message: ServerMessage): void {
    const frame = encodeServerMessage(message);
    this.emit('message', {
      data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength),
    });
  }

  /** Entrega qualquer coisa como dado da mensagem: texto, bytes, `Blob`. */
  serverSendRaw(data: unknown): void {
    this.emit('message', { data });
  }

  serverClose(code: number, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', { code, reason });
  }

  serverError(): void {
    this.emit('error', {});
  }

  /** O que o cliente mandou, decodificado. */
  sentMessages(): ClientMessage[] {
    return this.sent.map((frame) => {
      const decoded = decodeClientMessage(frame);
      if (!decoded.ok)
        throw new Error(`o cliente mandou um quadro inválido: ${decoded.error.message}`);
      return decoded.value;
    });
  }

  private emit(type: EventName, event: Parameters<Listener>[0]): void {
    for (const listener of [...this.listeners[type]]) listener(event);
  }
}
