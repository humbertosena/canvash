import {
  decodeServerMessage,
  encodeClientMessage,
  type ClientMessage,
  type ServerMessage,
} from '@canvash/collaboration';
import type { ServerConnection } from '../types.js';

/**
 * Conexão de teste, sem rede: o teste faz o papel do cliente com `receive` e lê o que o servidor
 * mandou com `messages`. Fechar a conexão, de qualquer lado, avisa quem ouve `onClose`, de forma
 * síncrona, para o núcleo ser testado contra reentrada.
 */
export class FakeConnection implements ServerConnection {
  readonly sent: Uint8Array[] = [];
  closed: { readonly code: number; readonly reason: string | undefined } | undefined;
  private readonly frameListeners = new Set<(frame: Uint8Array) => void>();
  private readonly closeListeners = new Set<() => void>();
  private read = 0;

  send(frame: Uint8Array): void {
    if (this.closed === undefined) this.sent.push(frame);
  }

  close(code: number, reason?: string): void {
    if (this.closed !== undefined) return;
    this.closed = { code, reason };
    for (const listener of [...this.closeListeners]) listener();
  }

  onFrame(listener: (frame: Uint8Array) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  /** O cliente manda uma mensagem. */
  receive(message: ClientMessage): void {
    this.receiveFrame(encodeClientMessage(message));
  }

  /** O cliente manda bytes quaisquer. */
  receiveFrame(frame: Uint8Array): void {
    for (const listener of [...this.frameListeners]) listener(frame);
  }

  /** O cliente some: a conexão cai sem o servidor ter fechado. */
  drop(): void {
    this.close(1006, 'queda');
  }

  /** Tudo o que o servidor mandou até agora, decodificado. */
  messages(): ServerMessage[] {
    return this.sent.map((frame) => {
      const decoded = decodeServerMessage(frame);
      if (!decoded.ok)
        throw new Error(`o servidor mandou um quadro inválido: ${decoded.error.message}`);
      return decoded.value;
    });
  }

  /** O que o servidor mandou desde a última chamada. */
  take(): ServerMessage[] {
    const all = this.messages();
    const fresh = all.slice(this.read);
    this.read = all.length;
    return fresh;
  }
}
