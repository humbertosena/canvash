import {
  decodeServerMessage,
  encodeClientMessage,
  type ClientMessage,
  type CollaborationCredentials,
  type CommitReceipt,
  type ServerMessage,
} from '@canvash/collaboration';
import { WebSocket } from 'ws';
import * as Y from 'yjs';

export interface NodeClientOptions {
  readonly sessionId: string;
  readonly documentId?: string;
  readonly roomEpoch?: string;
  readonly origin?: string;
  readonly credentials?: CollaborationCredentials;
}

const WAIT_TIMEOUT_MS = 3_000;

/**
 * Cliente mínimo do protocolo, sobre o `ws` e o codec, para exercitar o adaptador de verdade: abre,
 * manda o `hello`, aplica o `welcome` num `Y.Doc` e guarda tudo o que o servidor manda. Não
 * reconecta e não deduplica: quem usa o cliente real é a tarefa 386.
 */
export class NodeClient {
  readonly doc = new Y.Doc();
  readonly messages: ServerMessage[] = [];
  closed: { readonly code: number; readonly reason: string } | undefined;
  private nextId = 1;
  private readonly listeners = new Set<() => void>();

  private constructor(private readonly socket: WebSocket) {
    socket.binaryType = 'arraybuffer';
    socket.on('message', (data: ArrayBuffer) => {
      const decoded = decodeServerMessage(new Uint8Array(data));
      if (!decoded.ok) throw new Error(`quadro inválido do servidor: ${decoded.error.message}`);
      this.messages.push(decoded.value);
      if (decoded.value.t === 'update') Y.applyUpdate(this.doc, decoded.value.update);
      this.notify();
    });
    socket.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString('utf8') };
      this.notify();
    });
    socket.on('error', () => undefined);
  }

  /** Abre a conexão e espera o upgrade. Falha com o status HTTP se o servidor recusou. */
  static async open(url: string, options: NodeClientOptions): Promise<NodeClient> {
    const socket = new WebSocket(url, {
      ...(options.origin === undefined ? {} : { origin: options.origin }),
    });
    const client = new NodeClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('unexpected-response', (_request, response) => {
        reject(new Error(`HTTP ${response.statusCode}`));
        response.resume();
      });
      socket.once('error', reject);
    });
    return client;
  }

  /** Abre, manda o `hello` e espera o `welcome`, aplicando o estado da sala. */
  static async join(url: string, options: NodeClientOptions): Promise<NodeClient> {
    const client = await NodeClient.open(url, options);
    client.send({
      t: 'hello',
      v: 1,
      provider: 'yjs',
      documentId: options.documentId ?? 'doc-1',
      sessionId: options.sessionId,
      syncState: new Uint8Array(),
      ...(options.roomEpoch === undefined ? {} : { roomEpoch: options.roomEpoch }),
      ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
    });
    const welcome = await client.waitFor((message) => message.t === 'welcome');
    if (welcome.t !== 'welcome') throw new Error('sem welcome');
    Y.applyUpdate(client.doc, welcome.missing);
    return client;
  }

  send(message: ClientMessage): void {
    this.socket.send(encodeClientMessage(message));
  }

  sendRaw(bytes: Uint8Array): void {
    this.socket.send(bytes);
  }

  /** Aplica uma mudança no `Y.Doc` local e devolve o update que ela gerou. */
  edit(change: (doc: Y.Doc) => void): Uint8Array {
    const updates: Uint8Array[] = [];
    const listener = (update: Uint8Array): void => {
      updates.push(update);
    };
    this.doc.on('update', listener);
    this.doc.transact(() => change(this.doc));
    this.doc.off('update', listener);
    const [update] = updates;
    if (update === undefined) throw new Error('a mudança não gerou update');
    return update;
  }

  /** Manda um commit e espera o ack dele. */
  async commit(commitId: string, update: Uint8Array, roomEpoch: string): Promise<CommitReceipt> {
    const id = this.nextId;
    this.nextId += 1;
    this.send({ t: 'commit', id, commitId, roomEpoch, update });
    const answer = await this.waitFor(
      (message) => (message.t === 'ack' || message.t === 'error') && message.id === id,
    );
    if (answer.t !== 'ack') throw new Error(`commit recusado: ${JSON.stringify(answer)}`);
    return answer.receipt;
  }

  presence(state: unknown): void {
    this.send({ t: 'presence', state });
  }

  roomEpoch(): string {
    const welcome = this.messages.find((message) => message.t === 'welcome');
    if (welcome === undefined) throw new Error('sem welcome');
    return welcome.roomEpoch;
  }

  of<T extends ServerMessage['t']>(type: T): Array<Extract<ServerMessage, { t: T }>> {
    return this.messages.filter(
      (message): message is Extract<ServerMessage, { t: T }> => message.t === type,
    );
  }

  /** Espera uma mensagem que casa, já recebida ou por vir. */
  async waitFor(match: (message: ServerMessage) => boolean): Promise<ServerMessage> {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    for (;;) {
      const found = this.messages.find(match);
      if (found !== undefined) return found;
      if (this.closed !== undefined)
        throw new Error(`conexão fechada (${this.closed.code}) sem a mensagem esperada`);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('a mensagem esperada não chegou a tempo');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.listeners.delete(wake);
          resolve();
        }, remaining);
        const wake = (): void => {
          clearTimeout(timer);
          resolve();
        };
        this.listeners.add(wake);
      });
    }
  }

  /** Espera até o servidor fechar a conexão. */
  async waitClosed(): Promise<{ readonly code: number; readonly reason: string }> {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    while (this.closed === undefined) {
      if (Date.now() > deadline) throw new Error('a conexão não fechou a tempo');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return this.closed;
  }

  close(): void {
    this.socket.close();
  }

  terminate(): void {
    this.socket.terminate();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
    this.listeners.clear();
  }
}
