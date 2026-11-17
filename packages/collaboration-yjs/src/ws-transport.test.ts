import {
  encodeServerMessage,
  type CollaborationError,
  type CollaborationTransport,
  type CommitReceipt,
  type ServerMessage,
  type TransportHello,
  type TransportInbound,
  type TransportState,
} from '@canvash/collaboration';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket } from './test-support/fake-websocket.js';
import { createWebSocketTransport, type WebSocketTransportOptions } from './ws-transport.js';

type Welcome = Extract<ServerMessage, { t: 'welcome' }>;

const URL_OK = 'wss://exemplo.test/collab';

function hello(overrides: Partial<TransportHello> = {}): TransportHello {
  return {
    provider: 'yjs',
    documentId: 'doc-1',
    sessionId: 'sessao-a',
    syncState: new Uint8Array([1, 2, 3]),
    ...overrides,
  };
}

function welcome(overrides: Partial<Welcome> = {}): Welcome {
  return {
    t: 'welcome',
    v: 1,
    roomEpoch: 'epoch-1',
    access: 'write',
    missing: new Uint8Array([9, 9]),
    serverSyncState: new Uint8Array([8]),
    serverTime: 1_700_000_000_000,
    ...overrides,
  };
}

function receipt(commitId = 'commit-1'): CommitReceipt {
  return { commitId, roomEpoch: 'epoch-1', timestamp: 5, durable: true };
}

interface Harness {
  readonly transport: CollaborationTransport;
  readonly states: Array<{ state: TransportState; error?: CollaborationError }>;
  readonly inbound: TransportInbound[];
}

function build(extra: Partial<WebSocketTransportOptions> = {}): Harness {
  const transport = createWebSocketTransport({
    url: URL_OK,
    WebSocket: FakeWebSocket as unknown as WebSocketTransportOptions['WebSocket'],
    random: () => 0.5,
    ...extra,
  })({ documentId: 'doc-1', sessionId: 'sessao-a' });
  const states: Harness['states'] = [];
  const inbound: TransportInbound[] = [];
  transport.onStateChange((state, error) => states.push({ state, ...(error ? { error } : {}) }));
  transport.onInbound((message) => inbound.push(message));
  return { transport, states, inbound };
}

/** Abre o transporte e faz o handshake até o `welcome`. */
async function openTransport(
  extra: Partial<WebSocketTransportOptions> = {},
  welcomeMessage: Welcome = welcome(),
): Promise<Harness> {
  const harness = build(extra);
  const opening = harness.transport.open(() => hello());
  await flush();
  FakeWebSocket.last().serverOpen();
  FakeWebSocket.last().serverSend(welcomeMessage);
  const result = await opening;
  if (!result.ok) throw new Error(`o handshake falhou: ${result.error.message}`);
  return harness;
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

beforeEach(() => {
  FakeWebSocket.reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('opções e validação (US-W.5)', () => {
  it('createWebSocketTransport não abre nada: a fábrica devolve transportes ociosos e independentes', () => {
    const create = createWebSocketTransport({
      url: URL_OK,
      WebSocket: FakeWebSocket as unknown as WebSocketTransportOptions['WebSocket'],
    });

    const first = create({ documentId: 'a', sessionId: 's1' });
    const second = create({ documentId: 'b', sessionId: 's2' });

    expect(first).not.toBe(second);
    expect(first.state).toBe('idle');
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it.each([
    ['uma URL que não é URL', 'isto não é uma url', 'invalid_url'],
    ['http', 'http://exemplo.test/collab', 'invalid_url'],
    ['https', 'https://exemplo.test/collab', 'invalid_url'],
    ['texto vazio', '', 'invalid_url'],
    ['ws:// fora de loopback', 'ws://exemplo.test/collab', 'insecure_url'],
    ['ws:// num IP da rede', 'ws://192.168.0.10:4321/collab', 'insecure_url'],
    ['usuário e senha na URL', 'wss://ana:segredo@exemplo.test/collab', 'credentials_in_url'],
    ['senha na URL', 'wss://:segredo@exemplo.test/collab', 'credentials_in_url'],
  ])(
    '%s: o primeiro open falha com CONNECTION_FAILED e details.reason %s, sem abrir socket',
    async (_name, url, reason) => {
      const { transport, states } = build({ url });

      const result = await transport.open(() => hello());

      expect(!result.ok && result.error.code).toBe('CONNECTION_FAILED');
      expect(!result.ok && result.error.details).toMatchObject({ reason });
      expect(transport.state).toBe('closed');
      expect(states.at(-1)?.state).toBe('closed');
      expect(FakeWebSocket.instances).toHaveLength(0);
    },
  );

  it.each([
    ['ws://localhost:4321/collab'],
    ['ws://127.0.0.1:4321/collab'],
    ['ws://[::1]:4321/collab'],
    ['wss://exemplo.test/collab'],
  ])('%s é aceita', async (url) => {
    const { transport } = build({ url });

    const opening = transport.open(() => hello());
    await flush();

    expect(FakeWebSocket.last().url).toBe(url);
    transport.close();
    await opening;
  });

  it('ws:// fora de loopback passa com allowInsecure', async () => {
    const { transport } = build({ url: 'ws://exemplo.test/collab', allowInsecure: true });

    const opening = transport.open(() => hello());
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(1);
    transport.close();
    await opening;
  });

  it.each([
    ['openTimeoutMs', { openTimeoutMs: 0 }],
    ['requestTimeoutMs', { requestTimeoutMs: -5 }],
    ['maxFrameBytes', { maxFrameBytes: Number.NaN }],
    ['presenceBackpressureBytes', { presenceBackpressureBytes: 0 }],
    ['backoff', { backoff: { initialMs: 0 } }],
  ] as const)(
    '%s inválido: CONNECTION_FAILED com details.reason invalid_option',
    async (field, extra) => {
      const { transport } = build(extra);

      const result = await transport.open(() => hello());

      expect(!result.ok && result.error.details).toMatchObject({ reason: 'invalid_option', field });
      expect(FakeWebSocket.instances).toHaveLength(0);
    },
  );

  it('sem WebSocket disponível (nem injetado nem global): reason no_websocket', async () => {
    vi.stubGlobal('WebSocket', undefined);
    const transport = createWebSocketTransport({ url: URL_OK })({
      documentId: 'a',
      sessionId: 's',
    });

    const result = await transport.open(() => hello());

    expect(!result.ok && result.error.details).toMatchObject({ reason: 'no_websocket' });
  });

  it('sem a opção WebSocket, usa o global', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const transport = createWebSocketTransport({ url: URL_OK })({
      documentId: 'a',
      sessionId: 's',
    });

    const opening = transport.open(() => hello());
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(1);
    transport.close();
    await opening;
  });

  it('um segundo open no mesmo transporte falha sem abrir outro socket', async () => {
    const { transport } = await openTransport();

    const again = await transport.open(() => hello());

    expect(!again.ok && again.error.code).toBe('CONNECTION_FAILED');
    expect(!again.ok && again.error.details).toMatchObject({ reason: 'already_opened' });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(transport.state).toBe('open');
  });
});

describe('handshake (US-W.1, US-W.5)', () => {
  it('abre o socket em modo arraybuffer, manda o hello e resolve com o welcome inteiro', async () => {
    const { transport, states } = build();

    const opening = transport.open(() => hello({ roomEpoch: 'epoch-1' }));
    await flush();
    const socket = FakeWebSocket.last();
    expect(transport.state).toBe('connecting');
    expect(socket.binaryType).toBe('arraybuffer');
    expect(socket.sent).toHaveLength(0);
    socket.serverOpen();
    socket.serverSend(welcome({ user: { id: 'u-1', name: 'Ana' } }));
    const result = await opening;

    expect(socket.sentMessages()).toEqual([
      {
        t: 'hello',
        v: 1,
        provider: 'yjs',
        documentId: 'doc-1',
        sessionId: 'sessao-a',
        roomEpoch: 'epoch-1',
        syncState: new Uint8Array([1, 2, 3]),
      },
    ]);
    expect(result).toEqual({
      ok: true,
      value: {
        roomEpoch: 'epoch-1',
        access: 'write',
        missing: new Uint8Array([9, 9]),
        serverSyncState: new Uint8Array([8]),
        serverTime: 1_700_000_000_000,
        user: { id: 'u-1', name: 'Ana' },
      },
    });
    expect(transport.state).toBe('open');
    expect(states.map((entry) => entry.state)).toEqual(['connecting', 'open']);
  });

  it('as credenciais vão só no hello, nunca na URL', async () => {
    const { transport } = build();

    const opening = transport.open(() => hello({ credentials: { token: 'SEGREDO-123' } }));
    await flush();
    const socket = FakeWebSocket.last();
    socket.serverOpen();
    socket.serverSend(welcome());
    await opening;

    expect(socket.url).toBe(URL_OK);
    expect(socket.url).not.toContain('SEGREDO');
    expect(socket.sentMessages()[0]).toMatchObject({
      t: 'hello',
      credentials: { token: 'SEGREDO-123' },
    });
  });

  it('getCredentials substitui as do hello, mesmo assíncrono, e devolver undefined tira as credenciais', async () => {
    const withToken = build({ getCredentials: async () => ({ token: 'renovado' }) });
    const opening = withToken.transport.open(() => hello({ credentials: { token: 'velho' } }));
    await flush();
    FakeWebSocket.last().serverOpen();
    FakeWebSocket.last().serverSend(welcome());
    await opening;
    expect(FakeWebSocket.last().sentMessages()[0]).toMatchObject({
      credentials: { token: 'renovado' },
    });

    FakeWebSocket.reset();
    const without = build({ getCredentials: () => undefined });
    const second = without.transport.open(() => hello({ credentials: { token: 'velho' } }));
    await flush();
    FakeWebSocket.last().serverOpen();
    FakeWebSocket.last().serverSend(welcome());
    await second;
    expect(FakeWebSocket.last().sentMessages()[0]).not.toHaveProperty('credentials');
  });

  it('nem credencial nem payload vão ao console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const { transport } = build();

    const opening = transport.open(() => hello({ credentials: { token: 'SEGREDO-123' } }));
    await flush();
    FakeWebSocket.last().serverOpen();
    FakeWebSocket.last().serverSendRaw('texto que não é quadro');
    await opening;

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('getHello é chamado uma vez; se lança, o open falha com CONNECTION_FAILED e não abre socket', async () => {
    const { transport } = build();

    const result = await transport.open(() => {
      throw new Error('sessão destruída');
    });

    expect(!result.ok && result.error.code).toBe('CONNECTION_FAILED');
    expect(!result.ok && result.error.details).toMatchObject({ reason: 'get_hello_failed' });
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('getCredentials que lança falha o open com reason get_credentials_failed', async () => {
    const { transport } = build({
      getCredentials: () => {
        throw new Error('token indisponível');
      },
    });

    const result = await transport.open(() => hello());

    expect(!result.ok && result.error.details).toMatchObject({ reason: 'get_credentials_failed' });
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('sem welcome em openTimeoutMs: CONNECTION_FAILED open_timeout, socket fechado e transporte closed', async () => {
    vi.useFakeTimers();
    const { transport, states } = build({ openTimeoutMs: 2_000 });

    const opening = transport.open(() => hello());
    await vi.advanceTimersByTimeAsync(1_999);
    expect(transport.state).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1);
    const result = await opening;

    expect(!result.ok && result.error.code).toBe('CONNECTION_FAILED');
    expect(!result.ok && result.error.details).toMatchObject({ reason: 'open_timeout' });
    expect(transport.state).toBe('closed');
    expect(FakeWebSocket.last().closeCalls).toHaveLength(1);
    expect(states.at(-1)?.error?.code).toBe('CONNECTION_FAILED');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('o prazo vale do início da conexão até o welcome, não só depois de o socket abrir', async () => {
    vi.useFakeTimers();
    const { transport } = build({ openTimeoutMs: 1_000 });

    const opening = transport.open(() => hello());
    await vi.advanceTimersByTimeAsync(500);
    FakeWebSocket.last().serverOpen();
    await vi.advanceTimersByTimeAsync(500);
    const result = await opening;

    expect(!result.ok && result.error.details).toMatchObject({ reason: 'open_timeout' });
  });

  it('o socket que não abre (erro e fechamento 1006): CONNECTION_FAILED com o código do fechamento', async () => {
    const { transport } = build();

    const opening = transport.open(() => hello());
    await flush();
    FakeWebSocket.last().serverError();
    FakeWebSocket.last().serverClose(1006);
    const result = await opening;

    expect(!result.ok && result.error.code).toBe('CONNECTION_FAILED');
    expect(!result.ok && result.error.details).toMatchObject({ closeCode: 1006 });
    expect(transport.state).toBe('closed');
  });

  it.each([
    ['UNAUTHORIZED', 'credenciais recusadas'],
    ['NOT_FOUND', 'documento excluído'],
    ['ROOM_EPOCH_MISMATCH', 'epoch velha'],
    ['UNSUPPORTED_VERSION', 'versão'],
    ['LIMIT_EXCEEDED', 'sala cheia'],
    ['STORAGE_UNAVAILABLE', 'disco fora'],
  ] as const)(
    'o error %s do servidor no handshake chega à sessão com o código e a mensagem',
    async (code, message) => {
      const { transport, states } = build();

      const opening = transport.open(() => hello());
      await flush();
      FakeWebSocket.last().serverOpen();
      FakeWebSocket.last().serverSend({
        t: 'error',
        code,
        message,
        fatal: true,
        details: { x: 1 },
      });
      const result = await opening;

      expect(result).toEqual({ ok: false, error: { code, message, details: { x: 1 } } });
      expect(transport.state).toBe('closed');
      expect(FakeWebSocket.last().closeCalls).toHaveLength(1);
      expect(states.at(-1)).toMatchObject({ state: 'closed', error: { code } });
    },
  );

  it('welcome com outra versão do protocolo: UNSUPPORTED_VERSION', async () => {
    const { transport } = build();

    const opening = transport.open(() => hello());
    await flush();
    FakeWebSocket.last().serverOpen();
    FakeWebSocket.last().serverSend(welcome({ v: 2 }));
    const result = await opening;

    expect(!result.ok && result.error.code).toBe('UNSUPPORTED_VERSION');
  });

  it('mensagem que não é welcome nem error antes do handshake terminar é ignorada', async () => {
    const { transport, inbound } = build();

    const opening = transport.open(() => hello());
    await flush();
    FakeWebSocket.last().serverOpen();
    FakeWebSocket.last().serverSend({ t: 'presence', from: 'b', state: null });
    FakeWebSocket.last().serverSend(welcome());
    const result = await opening;

    expect(result.ok).toBe(true);
    expect(inbound).toEqual([]);
  });
});

describe('pedidos e respostas (US-W.1)', () => {
  it('commit leva um id por conexão e resolve com o recibo do ack de mesmo id', async () => {
    const { transport } = await openTransport();
    const socket = FakeWebSocket.last();

    const first = transport.commit('commit-1', new Uint8Array([1]), 'epoch-1');
    const second = transport.commit('commit-2', new Uint8Array([2]), 'epoch-1');
    socket.serverSend({ t: 'ack', id: 2, receipt: receipt('commit-2') });
    socket.serverSend({ t: 'ack', id: 1, receipt: receipt('commit-1') });

    expect(await first).toEqual({ ok: true, value: receipt('commit-1') });
    expect(await second).toEqual({ ok: true, value: receipt('commit-2') });
    expect(socket.sentMessages().slice(1)).toEqual([
      {
        t: 'commit',
        id: 1,
        commitId: 'commit-1',
        roomEpoch: 'epoch-1',
        update: new Uint8Array([1]),
      },
      {
        t: 'commit',
        id: 2,
        commitId: 'commit-2',
        roomEpoch: 'epoch-1',
        update: new Uint8Array([2]),
      },
    ]);
  });

  it('sync resolve com o que falta, pelo mesmo id', async () => {
    const { transport } = await openTransport();

    const pending = transport.sync(new Uint8Array([4, 5]));
    FakeWebSocket.last().serverSend({ t: 'synced', id: 1, missing: new Uint8Array([7, 7, 7]) });

    expect(await pending).toEqual({ ok: true, value: new Uint8Array([7, 7, 7]) });
    expect(FakeWebSocket.last().sentMessages()[1]).toEqual({
      t: 'sync',
      id: 1,
      syncState: new Uint8Array([4, 5]),
    });
  });

  it('error não fatal com id resolve o pedido com o erro, sem fechar o enlace', async () => {
    const { transport, inbound } = await openTransport();

    const commit = transport.commit('c', new Uint8Array(), 'epoch-1');
    const sync = transport.sync(new Uint8Array());
    FakeWebSocket.last().serverSend({
      t: 'error',
      id: 1,
      code: 'INVALID_DOCUMENT',
      message: 'documento inválido',
      fatal: false,
      details: { motivo: 'x' },
    });
    FakeWebSocket.last().serverSend({
      t: 'error',
      id: 2,
      code: 'PROTOCOL_ERROR',
      message: 'sync ruim',
      fatal: false,
    });

    expect(await commit).toEqual({
      ok: false,
      error: { code: 'INVALID_DOCUMENT', message: 'documento inválido', details: { motivo: 'x' } },
    });
    expect(await sync).toMatchObject({ ok: false, error: { code: 'PROTOCOL_ERROR' } });
    expect(transport.state).toBe('open');
    expect(inbound).toEqual([]);
  });

  it('resposta com id desconhecido, ou repetida, é ignorada', async () => {
    const { transport, inbound } = await openTransport();
    const pending = transport.commit('c', new Uint8Array(), 'epoch-1');

    FakeWebSocket.last().serverSend({ t: 'ack', id: 99, receipt: receipt('outro') });
    FakeWebSocket.last().serverSend({ t: 'ack', id: 1, receipt: receipt('c') });
    FakeWebSocket.last().serverSend({ t: 'ack', id: 1, receipt: receipt('c') });

    expect(await pending).toEqual({ ok: true, value: receipt('c') });
    expect(transport.state).toBe('open');
    expect(inbound).toEqual([]);
  });

  it('sem resposta em requestTimeoutMs: o pedido resolve com DISCONNECTED e o socket é fechado', async () => {
    vi.useFakeTimers();
    const { transport } = await openTransport({ requestTimeoutMs: 5_000 });
    const pending = transport.commit('c', new Uint8Array(), 'epoch-1');

    await vi.advanceTimersByTimeAsync(4_999);
    expect(FakeWebSocket.last().closeCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } });
    expect(FakeWebSocket.last().closeCalls).toHaveLength(1);
  });

  it('commit e sync fora de open resolvem na hora com DISCONNECTED, sem mandar nada', async () => {
    const idle = build();
    expect(await idle.transport.commit('c', new Uint8Array(), 'epoch-1')).toMatchObject({
      ok: false,
      error: { code: 'DISCONNECTED' },
    });
    expect(await idle.transport.sync(new Uint8Array())).toMatchObject({
      ok: false,
      error: { code: 'DISCONNECTED' },
    });

    const connecting = build();
    const opening = connecting.transport.open(() => hello());
    await flush();
    expect(await connecting.transport.commit('c', new Uint8Array(), 'epoch-1')).toMatchObject({
      ok: false,
      error: { code: 'DISCONNECTED' },
    });
    expect(FakeWebSocket.last().sent).toHaveLength(0);
    connecting.transport.close();
    await opening;

    const closed = await openTransport();
    closed.transport.close();
    expect(await closed.transport.sync(new Uint8Array())).toMatchObject({
      ok: false,
      error: { code: 'DISCONNECTED' },
    });
  });

  it('commit maior que maxFrameBytes: LIMIT_EXCEEDED com reason commit, sem mandar o quadro', async () => {
    const { transport } = await openTransport({ maxFrameBytes: 1_024 });

    const result = await transport.commit('c', new Uint8Array(2_000), 'epoch-1');

    expect(!result.ok && result.error.code).toBe('LIMIT_EXCEEDED');
    expect(!result.ok && result.error.details).toMatchObject({ reason: 'commit' });
    expect(FakeWebSocket.last().sent).toHaveLength(1);
  });

  it('send que lança resolve o pedido com DISCONNECTED', async () => {
    const { transport } = await openTransport();
    FakeWebSocket.last().failSend = true;

    const result = await transport.commit('c', new Uint8Array(), 'epoch-1');

    expect(!result.ok && result.error.code).toBe('DISCONNECTED');
  });
});

describe('o que chega sem ser pedido', () => {
  it('entrega update e presence à sessão, na ordem', async () => {
    const { inbound } = await openTransport();

    FakeWebSocket.last().serverSend({
      t: 'update',
      commitId: 'c-9',
      from: 'sessao-b',
      update: new Uint8Array([4]),
    });
    FakeWebSocket.last().serverSend({
      t: 'presence',
      from: 'sessao-b',
      state: { cursor: { x: 1, y: 2 } },
    });
    FakeWebSocket.last().serverSend({ t: 'presence', from: 'sessao-b', state: null });

    expect(inbound).toEqual([
      { type: 'update', commitId: 'c-9', from: 'sessao-b', update: new Uint8Array([4]) },
      { type: 'presence', from: 'sessao-b', state: { cursor: { x: 1, y: 2 } } },
      { type: 'presence', from: 'sessao-b', state: null },
    ]);
  });

  it('error não fatal sem id vira inbound error', async () => {
    const { transport, inbound } = await openTransport();

    FakeWebSocket.last().serverSend({
      t: 'error',
      code: 'LIMIT_EXCEEDED',
      message: 'presença grande demais',
      fatal: false,
      details: { reason: 'presence' },
    });

    expect(inbound).toEqual([
      {
        type: 'error',
        fatal: false,
        error: {
          code: 'LIMIT_EXCEEDED',
          message: 'presença grande demais',
          details: { reason: 'presence' },
        },
      },
    ]);
    expect(transport.state).toBe('open');
  });

  it('quadro que não decodifica fecha o enlace com PROTOCOL_ERROR, fatal, e resolve os pedidos com DISCONNECTED', async () => {
    const { transport, states } = await openTransport();
    const pending = transport.commit('c', new Uint8Array(), 'epoch-1');

    FakeWebSocket.last().serverSendRaw(new Uint8Array([1, 2, 3]).buffer);

    expect(await pending).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } });
    expect(transport.state).toBe('closed');
    expect(states.at(-1)).toMatchObject({ state: 'closed', error: { code: 'PROTOCOL_ERROR' } });
    expect(FakeWebSocket.last().closeCalls).toHaveLength(1);
  });

  it.each([
    ['texto', 'isto é texto'],
    ['um Blob', { size: 3, type: '' }],
    ['nada', undefined],
  ])('quadro de %s conta como malformado', async (_name, data) => {
    const { transport, states } = await openTransport();

    FakeWebSocket.last().serverSendRaw(data);

    expect(transport.state).toBe('closed');
    expect(states.at(-1)?.error?.code).toBe('PROTOCOL_ERROR');
  });

  it('aceita o quadro como ArrayBuffer ou como qualquer visão de bytes, mesmo com deslocamento', async () => {
    const { inbound } = await openTransport();
    const frame = encodeServerMessage({ t: 'presence', from: 'b', state: 1 });
    const padded = new Uint8Array(frame.byteLength + 7);
    padded.set(frame, 5);

    FakeWebSocket.last().serverSendRaw(padded.subarray(5, 5 + frame.byteLength));
    FakeWebSocket.last().serverSendRaw(frame.buffer.slice(0));
    FakeWebSocket.last().serverSendRaw(new DataView(padded.buffer, 5, frame.byteLength));

    expect(inbound).toEqual([
      { type: 'presence', from: 'b', state: 1 },
      { type: 'presence', from: 'b', state: 1 },
      { type: 'presence', from: 'b', state: 1 },
    ]);
  });

  it('quadro maior que maxFrameBytes é malformado', async () => {
    const { transport, states } = await openTransport({ maxFrameBytes: 512 });

    FakeWebSocket.last().serverSend({
      t: 'update',
      commitId: 'c',
      from: 'b',
      update: new Uint8Array(2_000),
    });

    expect(transport.state).toBe('closed');
    expect(states.at(-1)?.error?.code).toBe('PROTOCOL_ERROR');
  });

  it('error fatal com o enlace aberto leva o transporte a closed, com o erro', async () => {
    const { transport, states } = await openTransport();

    FakeWebSocket.last().serverSend({
      t: 'error',
      code: 'NOT_FOUND',
      message: 'o documento foi excluído',
      fatal: true,
    });

    expect(transport.state).toBe('closed');
    expect(states.at(-1)).toMatchObject({ state: 'closed', error: { code: 'NOT_FOUND' } });
  });

  it('um ouvinte que lança não impede os outros, e removê-lo funciona', async () => {
    const { transport } = await openTransport();
    const heard: string[] = [];
    transport.onInbound(() => {
      throw new Error('ouvinte ruim');
    });
    const stop = transport.onInbound((message) => heard.push(message.type));
    transport.onInbound((message) => heard.push(`outro:${message.type}`));

    FakeWebSocket.last().serverSend({ t: 'presence', from: 'b', state: null });
    stop();
    FakeWebSocket.last().serverSend({ t: 'presence', from: 'b', state: null });

    expect(heard).toEqual(['presence', 'outro:presence', 'outro:presence']);
  });
});

describe('presença', () => {
  it('sendPresence manda o estado, e null para anunciar a saída', async () => {
    const { transport } = await openTransport();

    transport.sendPresence({ cursor: { x: 1, y: 2 } });
    transport.sendPresence(null);

    expect(FakeWebSocket.last().sentMessages().slice(1)).toEqual([
      { t: 'presence', state: { cursor: { x: 1, y: 2 } } },
      { t: 'presence', state: null },
    ]);
  });

  it('é descartada fora de open: ociosa, conectando e fechada', async () => {
    const idle = build();
    idle.transport.sendPresence({ a: 1 });
    expect(FakeWebSocket.instances).toHaveLength(0);

    const connecting = build();
    const opening = connecting.transport.open(() => hello());
    await flush();
    FakeWebSocket.last().serverOpen();
    connecting.transport.sendPresence({ a: 1 });
    expect(FakeWebSocket.last().sentMessages()).toHaveLength(1);
    connecting.transport.close();
    await opening;
    connecting.transport.sendPresence({ a: 1 });
    expect(FakeWebSocket.last().sent).toHaveLength(1);
  });

  it('com bufferedAmount acima de presenceBackpressureBytes, é descartada; abaixo, passa', async () => {
    const { transport } = await openTransport({ presenceBackpressureBytes: 1_000 });
    const socket = FakeWebSocket.last();

    socket.bufferedAmount = 1_001;
    transport.sendPresence({ cursor: { x: 1, y: 1 } });
    socket.bufferedAmount = 1_000;
    transport.sendPresence({ cursor: { x: 2, y: 2 } });

    expect(socket.sentMessages().slice(1)).toEqual([
      { t: 'presence', state: { cursor: { x: 2, y: 2 } } },
    ]);
  });

  it('um send que lança não derruba a sessão: a presença é perdida', async () => {
    const { transport } = await openTransport();
    FakeWebSocket.last().failSend = true;

    expect(() => transport.sendPresence({ a: 1 })).not.toThrow();
  });
});

describe('close (US-W.4)', () => {
  it('em idle vai a closed, sem socket, e é idempotente', () => {
    const { transport, states } = build();

    transport.close();
    transport.close();

    expect(transport.state).toBe('closed');
    expect(states.map((entry) => entry.state)).toEqual(['closed']);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('durante o handshake, fecha o socket com 1000, resolve o open com DISCONNECTED e não deixa timer', async () => {
    vi.useFakeTimers();
    const { transport } = build();
    const opening = transport.open(() => hello());
    await vi.advanceTimersByTimeAsync(0);

    transport.close();
    const result = await opening;

    expect(!result.ok && result.error.code).toBe('DISCONNECTED');
    expect(FakeWebSocket.last().closeCalls).toEqual([{ code: 1000, reason: undefined }]);
    expect(FakeWebSocket.last().listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('com o enlace aberto, avisa com bye, fecha com 1000, resolve os pedidos e solta tudo', async () => {
    vi.useFakeTimers();
    const { transport, states } = await openTransport();
    const pending = transport.commit('c', new Uint8Array(), 'epoch-1');
    const socket = FakeWebSocket.last();

    transport.close();
    transport.close();

    expect(await pending).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } });
    expect(socket.sentMessages().at(-1)).toEqual({ t: 'bye' });
    expect(socket.closeCalls).toEqual([{ code: 1000, reason: undefined }]);
    expect(socket.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(states.map((entry) => entry.state)).toEqual(['connecting', 'open', 'closed']);
    expect(states.at(-1)?.error).toBeUndefined();
  });

  it('depois de closed, o que o socket ainda mandar é ignorado', async () => {
    const { transport, inbound, states } = await openTransport();
    const socket = FakeWebSocket.last();
    transport.close();
    const before = states.length;

    socket.serverSend({ t: 'presence', from: 'b', state: null });
    socket.serverClose(1006);

    expect(inbound).toEqual([]);
    expect(states).toHaveLength(before);
  });

  it('o ouvinte de estado pode ser removido', async () => {
    const { transport } = build();
    const heard: string[] = [];
    const stop = transport.onStateChange((state) => heard.push(state));
    stop();

    transport.close();

    expect(heard).toEqual([]);
  });
});
