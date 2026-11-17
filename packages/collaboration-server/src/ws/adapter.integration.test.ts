import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { createConnection } from 'node:net';
import { projectYDocToCanvasDocument } from '@canvash/collaboration-yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { createCollaborationServer } from '../server.js';
import { createMemoryRoomStorage } from '../storage-memory.js';
import { createRecordingLogger } from '../test-support/recording-logger.js';
import { addRectangle } from '../test-support/test-client.js';
import type { CollaborationServer, CollaborationServerOptions } from '../types.js';
import { listenWebSocket, type ListenHandle, type ListenOptions } from './index.js';
import { NodeClient } from './test-support/node-client.js';

// Sockets de verdade, em loopback e na porta 0: o adaptador `ws` ligado ao núcleo.

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function start(
  serverOptions: Partial<CollaborationServerOptions> = {},
  listenOptions: Partial<ListenOptions> = {},
): Promise<{ server: CollaborationServer; handle: ListenHandle; url: string }> {
  const server = createCollaborationServer({
    storage: createMemoryRoomStorage(),
    logger: createRecordingLogger(),
    ...serverOptions,
  });
  const listening = await listenWebSocket(server, { port: 0, ...listenOptions });
  if (!listening.ok) throw new Error(`não escutou: ${listening.error.message}`);
  cleanups.push(async () => {
    await server.close();
    await listening.value.close();
  });
  return { server, handle: listening.value, url: listening.value.url };
}

async function join(url: string, sessionId: string, documentId = 'doc-1'): Promise<NodeClient> {
  const client = await NodeClient.join(url, { sessionId, documentId });
  cleanups.push(() => client.terminate());
  return client;
}

function nodesOf(client: NodeClient): string[] {
  return Object.keys(projectYDocToCanvasDocument(client.doc).nodes).sort();
}

/** A mesma porta, pelo HTTP comum (e, se dado, noutro caminho). */
function httpUrl(url: string, path?: string): string {
  const parsed = new URL(url);
  parsed.protocol = 'http:';
  if (path !== undefined) parsed.pathname = path;
  return parsed.toString();
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`${what} não aconteceu a tempo`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('três clientes por um WebSocket de verdade (US-S.1)', () => {
  it('convergem com edições concorrentes e recebem o ack de cada commit', async () => {
    const { url } = await start();
    const [a, b, c] = await Promise.all(['a', 'b', 'c'].map((sessionId) => join(url, sessionId)));
    if (a === undefined || b === undefined || c === undefined) throw new Error('faltou cliente');
    const epoch = a.roomEpoch();

    const receipts = await Promise.all([
      a.commit(
        'commit-a',
        a.edit((doc) => addRectangle(doc, 'ra', 0)),
        epoch,
      ),
      b.commit(
        'commit-b',
        b.edit((doc) => addRectangle(doc, 'rb', 30)),
        epoch,
      ),
      c.commit(
        'commit-c',
        c.edit((doc) => addRectangle(doc, 'rc', 60)),
        epoch,
      ),
    ]);

    expect(receipts.map((receipt) => receipt.commitId)).toEqual([
      'commit-a',
      'commit-b',
      'commit-c',
    ]);
    expect(receipts.every((receipt) => receipt.durable && receipt.roomEpoch === epoch)).toBe(true);
    await until(
      () => [a, b, c].every((client) => nodesOf(client).length === 3),
      'a convergência dos três documentos',
    );
    for (const client of [a, b, c]) expect(nodesOf(client)).toEqual(['ra', 'rb', 'rc']);
  });

  it('veem a presença uns dos outros, carimbada com o sessionId de cada um', async () => {
    const { url } = await start();
    const a = await join(url, 'a');
    const b = await join(url, 'b');

    a.presence({ sessionId: 'a', cursor: { x: 1, y: 2 } });
    await b.waitFor((message) => message.t === 'presence' && message.from === 'a');
    const late = await join(url, 'late');

    expect(b.of('presence')[0]).toMatchObject({ from: 'a', state: { cursor: { x: 1, y: 2 } } });
    expect(late.of('presence').map((message) => message.from)).toEqual(['a']);
  });

  it('o commit confirmado chega a quem entra depois, pelo welcome', async () => {
    const { url } = await start();
    const a = await join(url, 'a');
    await a.commit(
      'commit-a',
      a.edit((doc) => addRectangle(doc, 'r1')),
      a.roomEpoch(),
    );

    const late = await join(url, 'late');

    expect(nodesOf(late)).toEqual(['r1']);
  });

  it('quem sai manda o presence null aos outros', async () => {
    const { url } = await start();
    const a = await join(url, 'a');
    const b = await join(url, 'b');
    a.presence({ cursor: { x: 1, y: 1 } });
    await b.waitFor((message) => message.t === 'presence' && message.state !== null);

    a.close();

    await b.waitFor((message) => message.t === 'presence' && message.state === null);
  });

  it('bytes que não são um quadro: erro fatal PROTOCOL_ERROR e fechamento 4000', async () => {
    const { url } = await start();
    const client = await NodeClient.open(url, { sessionId: 'x' });
    cleanups.push(() => client.terminate());

    client.sendRaw(new Uint8Array([1, 2, 3]));

    const error = await client.waitFor((message) => message.t === 'error');
    expect(error).toMatchObject({ code: 'PROTOCOL_ERROR', fatal: true });
    expect((await client.waitClosed()).code).toBe(4000);
  });

  it('o mesmo sessionId numa conexão nova fecha a antiga com 4001', async () => {
    const { url } = await start();
    const old = await join(url, 'a');

    await join(url, 'a');

    expect((await old.waitClosed()).code).toBe(4001);
  });

  it('o authorize lê a requisição do upgrade: a URL e os cabeçalhos', async () => {
    const seen: Array<{ url: string | undefined; host: string | null }> = [];
    const { url } = await start({
      authorize: (request) => {
        const upgrade = request.context as { url?: string };
        seen.push({ url: upgrade.url, host: request.headers.get('host') });
        return { allow: true, access: 'write', user: { id: 'u-1' } };
      },
    });

    const client = await join(`${url}?token=abc`, 'a');

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('/collab?token=abc');
    expect(seen[0]?.host).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(client.of('welcome')[0]?.user).toEqual({ id: 'u-1' });
  });
});

describe('origem fora da lista (US-S.8, R19)', () => {
  const allowedOrigins = ['http://localhost:5173'];

  it('recebe HTTP 403 no upgrade; a da lista entra', async () => {
    const { url } = await start({ allowedOrigins });

    await expect(
      NodeClient.open(url, { sessionId: 'x', origin: 'http://atacante.test' }),
    ).rejects.toThrow('HTTP 403');
    await expect(NodeClient.open(url, { sessionId: 'y' })).rejects.toThrow('HTTP 403');
    const allowed = await NodeClient.join(url, { sessionId: 'z', origin: 'http://localhost:5173' });
    cleanups.push(() => allowed.terminate());

    expect(allowed.of('welcome')).toHaveLength(1);
  });
});

describe('listenWebSocket (US-S.1, US-S.9)', () => {
  it('escuta em 127.0.0.1 por padrão, na porta pedida, e a URL diz o caminho', async () => {
    const { url } = await start();

    expect(url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/collab$/);
  });

  it('o caminho é configurável; o upgrade em outro caminho é recusado', async () => {
    const { url } = await start({}, { path: '/salas' });

    expect(url.endsWith('/salas')).toBe(true);
    await expect(
      NodeClient.open(url.replace('/salas', '/outro'), { sessionId: 'x' }),
    ).rejects.toThrow(/HTTP (400|404)/);
    const client = await join(url, 'ok');
    expect(client.of('welcome')).toHaveLength(1);
  });

  it('porta ocupada: CONNECTION_FAILED com o código do sistema', async () => {
    const { url } = await start();
    const port = Number(new URL(url).port);
    const other = createCollaborationServer({
      storage: createMemoryRoomStorage(),
      logger: createRecordingLogger(),
    });

    const result = await listenWebSocket(other, { port });

    expect(!result.ok && result.error.code).toBe('CONNECTION_FAILED');
    expect(!result.ok && result.error.details).toEqual({ code: 'EADDRINUSE' });
  });

  it('requisição HTTP comum recebe 426', async () => {
    const { url } = await start();

    const response = await fetch(httpUrl(url));

    expect(response.status).toBe(426);
  });

  it('com o servidor HTTP do host, compartilha a porta e não o fecha', async () => {
    const http: Server = createServer((_request, response) => response.end('do host'));
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => http.close(() => resolve())));
    const server = createCollaborationServer({
      storage: createMemoryRoomStorage(),
      logger: createRecordingLogger(),
    });
    const listening = await listenWebSocket(server, { port: 0, server: http });
    if (!listening.ok) throw new Error('não escutou');
    cleanups.push(async () => {
      await server.close();
      await listening.value.close();
    });

    const client = await join(listening.value.url, 'a');
    await server.close();
    await listening.value.close();

    expect(client.of('welcome')).toHaveLength(1);
    expect(http.listening).toBe(true);
    const plain = await fetch(httpUrl(listening.value.url, '/'));
    expect(await plain.text()).toBe('do host');
  });

  it('com um servidor HTTP do host que ainda não escuta: CONNECTION_FAILED', async () => {
    const http = createServer();
    const server = createCollaborationServer({
      storage: createMemoryRoomStorage(),
      logger: createRecordingLogger(),
    });

    const result = await listenWebSocket(server, { port: 0, server: http });

    expect(!result.ok && result.error.code).toBe('CONNECTION_FAILED');
  });

  it('um quadro maior que maxPayloadBytes fecha a conexão com 1009', async () => {
    const { url } = await start({}, { maxPayloadBytes: 2_048 });
    const client = await join(url, 'a');

    client.sendRaw(new Uint8Array(4_096));

    expect((await client.waitClosed()).code).toBe(1009);
  });
});

describe('encerramento (US-S.1)', () => {
  it('fechar o listen fecha os clientes com 1001, solta a porta e o servidor HTTP, e é idempotente', async () => {
    const { server, handle, url } = await start();
    const a = await join(url, 'a');
    const b = await join(url, 'b');
    await server.close();

    const first = handle.close();
    const second = handle.close();

    expect(second).toBe(first);
    await first;
    expect((await a.waitClosed()).code).toBe(1001);
    expect((await b.waitClosed()).code).toBe(1001);
    const { port } = new URL(url);
    const refused = await new Promise<string>((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port: Number(port) });
      socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'erro'));
      socket.once('connect', () => {
        socket.destroy();
        resolve('conectou');
      });
    });
    expect(refused).toBe('ECONNREFUSED');
  });

  it('o cliente que não responde ao fechamento é terminado depois da tolerância', async () => {
    const { handle, url } = await start();
    const { port } = new URL(url);
    // Um cliente que faz o upgrade à mão e depois nunca lê nem responde ao frame de fechamento.
    const raw = createConnection({ host: '127.0.0.1', port: Number(port) });
    cleanups.push(() => {
      raw.destroy();
    });
    await new Promise<void>((resolve) => {
      raw.once('data', (data) => {
        expect(data.toString('latin1')).toContain('101');
        resolve();
      });
      raw.write(
        [
          'GET /collab HTTP/1.1',
          `Host: 127.0.0.1:${port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
          'Sec-WebSocket-Version: 13',
          '',
          '',
        ].join('\r\n'),
      );
    });
    // Lê o que o servidor manda (inclusive o frame de fechamento), mas nunca responde.
    raw.on('data', () => undefined);
    const dropped = new Promise<void>((resolve) => raw.once('close', () => resolve()));
    const started = Date.now();

    await handle.close();
    await dropped;

    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });
});
