import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCollaborationError,
  type CollaborationSession,
  type SessionStatus,
} from '@canvash/collaboration';
import {
  YjsCollaborationProvider,
  createWebSocketTransport,
  type WebSocketTransportOptions,
} from '@canvash/collaboration-yjs';
import { transportContractCases } from '@canvash/collaboration-yjs/testing';
import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createCollaborationServer } from '../server.js';
import { createFileRoomStorage } from '../storage-file.js';
import { createMemoryRoomStorage } from '../storage-memory.js';
import type { RoomStorage } from '../storage.js';
import {
  createInstrumentedStorage,
  type InstrumentedStorage,
} from '../test-support/instrumented-storage.js';
import { createRecordingLogger } from '../test-support/recording-logger.js';
import type { CollaborationServer } from '../types.js';
import { listenWebSocket, type ListenHandle } from './index.js';

// O cliente real (`createWebSocketTransport`, com o WebSocket global do Node) contra o servidor
// real (`listenWebSocket`), em loopback e na porta 0, passando pelo provider e pela sessão Yjs.

const SLOW = 20_000;
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface World {
  readonly storage: InstrumentedStorage;
  readonly server: CollaborationServer;
  readonly handle: ListenHandle;
  readonly url: string;
  readonly port: number;
  /** O socket mais recente de cada sessão, para o teste derrubá-lo pelo lado do servidor. */
  readonly sockets: Map<string, IncomingMessage['socket']>;
  /** Quantas conexões cada sessão fez (cada `authorize` é uma conexão). */
  readonly connections: Map<string, number>;
  stop(): Promise<void>;
}

async function startWorld(
  options: { readonly storage?: RoomStorage; readonly port?: number } = {},
): Promise<World> {
  const storage = createInstrumentedStorage(options.storage ?? createMemoryRoomStorage());
  const sockets = new Map<string, IncomingMessage['socket']>();
  const connections = new Map<string, number>();
  const server = createCollaborationServer({
    storage,
    logger: createRecordingLogger(),
    authorize: (request) => {
      sockets.set(request.sessionId, (request.context as IncomingMessage).socket);
      connections.set(request.sessionId, (connections.get(request.sessionId) ?? 0) + 1);
      return { allow: true, access: 'write', user: { id: request.sessionId } };
    },
  });
  const listening = await listenWebSocket(server, { port: options.port ?? 0 });
  if (!listening.ok) throw new Error(`não escutou: ${listening.error.message}`);
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await server.close();
    await listening.value.close();
  };
  cleanups.push(stop);
  return {
    storage,
    server,
    handle: listening.value,
    url: listening.value.url,
    port: Number(new URL(listening.value.url).port),
    sockets,
    connections,
    stop,
  };
}

function transportOptions(
  url: string,
  extra: Partial<WebSocketTransportOptions> = {},
): WebSocketTransportOptions {
  return {
    url,
    WebSocket: globalThis.WebSocket as unknown as WebSocketTransportOptions['WebSocket'],
    backoff: { initialMs: 20, maxMs: 100 },
    ...extra,
  };
}

async function until(condition: () => boolean, what: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`${what} não aconteceu a tempo`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function addRect(section: CanvasSectionApi, id: string, x = 0): void {
  const result = section.dispatch({
    type: 'shape.create',
    shape: { id, type: 'rectangle', x, y: 0, width: 10, height: 10, rotation: 0 },
  });
  if (!result.ok) throw new Error(`não criou ${id}`);
}

function nodeIds(section: CanvasSectionApi): string[] {
  return Object.keys(section.getSnapshot().document.nodes).sort();
}

interface Peer {
  readonly section: CanvasSectionApi;
  readonly session: CollaborationSession;
  readonly statuses: SessionStatus[];
  readonly errors: Array<string | undefined>;
}

async function joinPeer(
  world: World,
  documentId = 'doc-real',
  extra: Partial<WebSocketTransportOptions> = {},
): Promise<Peer> {
  const provider = new YjsCollaborationProvider({
    createTransport: createWebSocketTransport(transportOptions(world.url, extra)),
  });
  const section = createCanvasSection();
  const statuses: SessionStatus[] = [];
  const errors: Array<string | undefined> = [];
  const connected = await provider.connect({
    documentId,
    section,
    seedEmptyRoom: false,
    onStatusChange: (status, error) => {
      statuses.push(status);
      errors.push(error?.code);
    },
  });
  if (!connected.ok) throw new Error(`não conectou: ${connected.error.message}`);
  cleanups.push(() => connected.value.destroy());
  return { section, session: connected.value, statuses, errors };
}

async function loggedCommitIds(storage: RoomStorage, documentId = 'doc-real'): Promise<string[]> {
  const stored = await storage.load(documentId);
  if (!stored.ok || stored.value === null) throw new Error('sala não gravada');
  return stored.value.log.map((commit) => commit.commitId);
}

describe('os casos de contrato do transporte contra o servidor real (US-W.1)', () => {
  it.each(
    transportContractCases({
      // A fábrica e os ganchos são montados por teste, no `run` abaixo.
      createTransport: () => {
        throw new Error('montado por teste');
      },
      dropLink: () => undefined,
    }).map((contractCase) => contractCase.name),
  )(
    '%s',
    async (name) => {
      const world = await startWorld();
      const transports: Array<{ close(): void }> = [];
      const create = createWebSocketTransport(transportOptions(world.url));
      const cases = transportContractCases({
        createTransport: (context) => {
          const transport = create(context);
          transports.push(transport);
          return transport;
        },
        // Derruba o socket pelo lado do servidor: o transporte tem de voltar sozinho.
        dropLink: (sessionId) => {
          world.sockets.get(sessionId)?.destroy();
        },
        failNextAppends: (_documentId, count) => {
          world.storage.failNext(
            'append',
            createCollaborationError('STORAGE_UNAVAILABLE', 'disco fora'),
            count,
          );
        },
      });
      const contractCase = cases.find((candidate) => candidate.name === name);
      if (contractCase === undefined) throw new Error(`caso desconhecido: ${name}`);
      cleanups.push(() => {
        for (const transport of transports) transport.close();
      });

      await contractCase.run();
    },
    SLOW,
  );
});

describe('três sessões Yjs pela rede (US-W.1, US-W.2)', () => {
  it(
    'convergem com edições concorrentes, sem commit duplicado, e cada recibo chega com o socket aberto',
    async () => {
      const world = await startWorld();
      const [a, b, c] = await Promise.all([joinPeer(world), joinPeer(world), joinPeer(world)]);
      if (a === undefined || b === undefined || c === undefined) throw new Error('faltou sessão');

      addRect(a.section, 'ra', 0);
      addRect(b.section, 'rb', 30);
      addRect(c.section, 'rc', 60);

      await until(
        () => [a, b, c].every((peer) => nodeIds(peer.section).length === 3),
        'a convergência',
      );
      await until(
        () => [a, b, c].every((peer) => peer.session.getPending().count === 0),
        'os recibos duráveis',
      );
      for (const peer of [a, b, c]) expect(nodeIds(peer.section)).toEqual(['ra', 'rb', 'rc']);
      const ids = await loggedCommitIds(world.storage);
      expect(new Set(ids).size).toBe(ids.length);
      for (const peer of [a, b, c]) expect(world.connections.get(peer.session.sessionId)).toBe(1);
    },
    SLOW,
  );

  it(
    'uma sessão perde o enlace (o servidor derruba o socket): todas editam e convergem sozinhas',
    async () => {
      const world = await startWorld();
      const [a, b, c] = await Promise.all([joinPeer(world), joinPeer(world), joinPeer(world)]);
      if (a === undefined || b === undefined || c === undefined) throw new Error('faltou sessão');
      addRect(a.section, 'antes', 0);
      await until(
        () => [a, b, c].every((peer) => nodeIds(peer.section).length === 1),
        'a edição inicial',
      );

      world.sockets.get(a.session.sessionId)?.destroy();
      addRect(a.section, 'a-offline', 30);
      addRect(b.section, 'b-durante', 60);
      addRect(c.section, 'c-durante', 90);

      await until(
        () => [a, b, c].every((peer) => nodeIds(peer.section).length === 4),
        'a convergência depois da queda',
      );
      await until(
        () => [a, b, c].every((peer) => peer.session.getPending().count === 0),
        'os recibos depois da queda',
      );
      expect(nodeIds(a.section)).toEqual(['a-offline', 'antes', 'b-durante', 'c-durante']);
      expect(a.statuses).toContain('reconnecting');
      expect(world.connections.get(a.session.sessionId)).toBeGreaterThanOrEqual(2);
      const ids = await loggedCommitIds(world.storage);
      expect(new Set(ids).size).toBe(ids.length);
    },
    SLOW,
  );

  it(
    'o servidor reinicia com armazenamento em arquivo: os clientes reconectam sozinhos e reenviam o que estava pendente',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'canvash-restart-'));
      cleanups.push(() => rm(directory, { recursive: true, force: true }));
      const first = await startWorld({ storage: createFileRoomStorage({ directory }) });
      const a = await joinPeer(first);
      const b = await joinPeer(first);
      addRect(a.section, 'antes', 0);
      await until(() => nodeIds(b.section).length === 1, 'a edição antes do reinício');
      await until(() => a.session.getPending().count === 0, 'o recibo antes do reinício');

      await first.stop();
      addRect(a.section, 'a-sem-servidor', 30);
      addRect(b.section, 'b-sem-servidor', 60);
      await until(
        () => a.statuses.includes('reconnecting') && b.statuses.includes('reconnecting'),
        'as sessões perceberem a queda',
      );
      const second = await startWorld({
        storage: createFileRoomStorage({ directory }),
        port: first.port,
      });

      await until(
        () => [a, b].every((peer) => nodeIds(peer.section).length === 3),
        'a convergência depois do reinício',
      );
      await until(
        () => [a, b].every((peer) => peer.session.getPending().count === 0),
        'os recibos depois do reinício',
      );
      expect(nodeIds(a.section)).toEqual(['a-sem-servidor', 'antes', 'b-sem-servidor']);
      const ids = await loggedCommitIds(second.storage);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(3);
      const room = join(directory, 'doc-real', 'room.json');
      expect(JSON.parse(await readFile(room, 'utf8'))).toMatchObject({ format: 1 });
    },
    SLOW,
  );

  it(
    'o socket meio aberto (o servidor não responde): o timeout do pedido detecta e a mesma sessão volta, sem commit duplicado',
    async () => {
      const world = await startWorld();
      const a = await joinPeer(world, 'doc-real', { requestTimeoutMs: 300 });
      const b = await joinPeer(world);
      const release = world.storage.hold('append');

      addRect(a.section, 'travado', 0);
      await until(
        () => (world.connections.get(a.session.sessionId) ?? 0) >= 2,
        'a sessão reconectar sem o servidor ter notado a queda',
      );
      // A conexão antiga foi substituída pela nova: a sala não ficou com duas da mesma sessão.
      expect(world.server.getRoomStats('doc-real')).toMatchObject({ clients: 2 });
      release();

      await until(() => nodeIds(b.section).length === 1, 'o commit chegar ao par');
      await until(() => a.session.getPending().count === 0, 'o recibo');
      expect(a.statuses).toContain('reconnecting');
      const ids = await loggedCommitIds(world.storage);
      expect(new Set(ids).size).toBe(ids.length);
      expect(nodeIds(a.section)).toEqual(['travado']);
    },
    SLOW,
  );

  it(
    'o armazenamento falha duas vezes e depois aceita: o recibo chega sem o socket fechar',
    async () => {
      const world = await startWorld();
      const a = await joinPeer(world);
      const b = await joinPeer(world);
      world.storage.failNext(
        'append',
        createCollaborationError('STORAGE_UNAVAILABLE', 'disco fora'),
        2,
      );

      addRect(a.section, 'persistente', 0);

      await until(() => a.session.getPending().count === 0, 'o recibo depois das falhas');
      await until(() => nodeIds(b.section).length === 1, 'o par receber o commit');
      expect(world.storage.calls.append).toBeGreaterThanOrEqual(3);
      expect(world.connections.get(a.session.sessionId)).toBe(1);
      expect(a.statuses).not.toContain('reconnecting');
      const ids = await loggedCommitIds(world.storage);
      expect(ids).toHaveLength(1);
    },
    SLOW,
  );

  it(
    'depois da queda e da volta, os pares veem a presença da sessão sem esperar o heartbeat (US-W.7)',
    async () => {
      const world = await startWorld();
      const a = await joinPeer(world);
      const b = await joinPeer(world);
      const isThere = (): boolean =>
        b.session.getPresences().some((presence) => presence.sessionId === a.session.sessionId);
      a.session.updatePresence({ cursor: { x: 5, y: 5 } });
      await until(isThere, 'a presença chegar');
      // A saída e a volta podem ser mais rápidas que a espiada: um ouvinte guarda que a sessão sumiu.
      let sawAbsent = false;
      b.session.onPresenceChange(() => {
        if (!isThere()) sawAbsent = true;
      });

      world.sockets.get(a.session.sessionId)?.destroy();
      await until(() => sawAbsent, 'a saída da sessão chegar aos pares');
      await until(isThere, 'a presença voltar depois do resync', 5_000);

      expect(a.statuses).toContain('reconnecting');
    },
    SLOW,
  );
});

describe('expulsão pelo servidor (US-S.14, US-W.3, R13)', () => {
  it.each([
    ['NOT_FOUND', 'O documento foi excluído.'],
    ['UNAUTHORIZED', 'Seu acesso foi revogado.'],
  ] as const)(
    'disconnect com %s leva a sessão a error com o código e nenhuma nova conexão é tentada',
    async (code, message) => {
      const world = await startWorld();
      const expelled = await joinPeer(world);
      const other = await joinPeer(world);
      const before = world.connections.get(expelled.session.sessionId);

      const closed = await world.server.disconnect(
        'doc-real',
        { sessionId: expelled.session.sessionId },
        { code, message },
      );

      expect(closed).toBe(1);
      await until(() => expelled.statuses.at(-1) === 'error', 'o status virar error');
      expect(expelled.errors.at(-1)).toBe(code);
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(world.connections.get(expelled.session.sessionId)).toBe(before);
      expect(expelled.statuses).not.toContain('reconnecting');
      expect(other.session.status).toBe('connected');
    },
    SLOW,
  );
});
