import type { ClientMessage, ServerMessage } from '@canvash/collaboration';
import * as Y from 'yjs';
import type { CollaborationServer, ConnectionRequest } from '../types.js';
import { FakeConnection } from './fake-connection.js';

type Hello = Extract<ClientMessage, { t: 'hello' }>;

/** Deixa o servidor processar o que depende de armazenamento (promessas já resolvidas). */
export async function settle(): Promise<void> {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
}

export interface OpenOptions {
  readonly sessionId: string;
  readonly documentId?: string;
  readonly roomEpoch?: string;
  readonly request?: ConnectionRequest;
}

/**
 * Um cliente de teste: uma conexão falsa e um `Y.Doc` que acompanha a sala. Faz o papel da sessão,
 * sem a sessão: manda `hello`, aplica o `welcome` e monta commits.
 */
export class TestClient {
  readonly doc = new Y.Doc();
  readonly connection = new FakeConnection();
  private nextId = 1;

  private constructor(readonly sessionId: string) {}

  /** Abre a conexão e manda o `hello`. Chame `joined()` para esperar o `welcome`. */
  static open(server: CollaborationServer, options: OpenOptions): TestClient {
    const client = new TestClient(options.sessionId);
    server.handleConnection(client.connection, options.request ?? { headers: new Headers() });
    const hello: Hello = {
      t: 'hello',
      v: 1,
      provider: 'yjs',
      documentId: options.documentId ?? 'doc-1',
      sessionId: options.sessionId,
      syncState: new Uint8Array(),
      ...(options.roomEpoch === undefined ? {} : { roomEpoch: options.roomEpoch }),
    };
    client.connection.receive(hello);
    return client;
  }

  /** Abre, espera o `welcome` e aplica o estado da sala. */
  static async join(server: CollaborationServer, options: OpenOptions): Promise<TestClient> {
    const client = TestClient.open(server, options);
    await client.joined();
    return client;
  }

  async joined(): Promise<void> {
    await settle();
    const welcome = this.connection.messages().find((message) => message.t === 'welcome');
    if (welcome === undefined) throw new Error(`a sessão ${this.sessionId} não recebeu o welcome`);
    Y.applyUpdate(this.doc, welcome.missing);
  }

  /** Aplica uma mudança no `Y.Doc` local e devolve o update que ela gerou. */
  edit(change: (doc: Y.Doc) => void): Uint8Array {
    let captured: Uint8Array | undefined;
    const listener = (update: Uint8Array): void => {
      captured = update;
    };
    this.doc.on('update', listener);
    this.doc.transact(() => change(this.doc));
    this.doc.off('update', listener);
    if (captured === undefined) throw new Error('a mudança não gerou update');
    return captured;
  }

  /** Manda um commit e devolve o `id` da mensagem. */
  commit(commitId: string, update: Uint8Array, roomEpoch?: string): number {
    const id = this.nextId;
    this.nextId += 1;
    this.connection.receive({
      t: 'commit',
      id,
      commitId,
      roomEpoch: roomEpoch ?? this.roomEpoch(),
      update,
    });
    return id;
  }

  roomEpoch(): string {
    const welcome = this.connection.messages().find((message) => message.t === 'welcome');
    if (welcome === undefined) throw new Error('sem welcome');
    return welcome.roomEpoch;
  }

  messages(): ServerMessage[] {
    return this.connection.messages();
  }

  /** Só as mensagens de um tipo, na ordem em que chegaram. */
  of<T extends ServerMessage['t']>(type: T): Array<Extract<ServerMessage, { t: T }>> {
    return this.connection
      .messages()
      .filter((message): message is Extract<ServerMessage, { t: T }> => message.t === type);
  }
}

/** Uma forma retangular no `Y.Doc`, no formato que o servidor projeta e valida. */
export function addRectangle(doc: Y.Doc, id: string, x = 0): void {
  const shapes = doc.getMap<Y.Map<unknown>>('shapes');
  const record = new Y.Map<unknown>();
  record.set('id', id);
  record.set('type', 'rectangle');
  record.set('generation', 1);
  record.set('isDeleted', false);
  record.set('placement', { parentId: 'layer-default', orderKey: `m_${id}` });
  record.set('geometry', { x, y: 0, width: 10, height: 10, rotation: 0 });
  shapes.set(id, record);
}

/** Um update que não é Yjs: não se aplica a documento nenhum. */
export const GARBAGE_UPDATE = new Uint8Array([255, 255, 255, 255, 255, 255, 255]);

/** Um registro de forma que não é um mapa: a projeção do documento falha. */
export function addBrokenShape(doc: Y.Doc, id: string): void {
  doc.getMap('shapes').set(id, 'isto não é um registro de forma');
}
