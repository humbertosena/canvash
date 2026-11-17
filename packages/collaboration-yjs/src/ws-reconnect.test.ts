import { type CollaborationErrorCode, type ServerMessage } from '@canvash/collaboration';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket } from './test-support/fake-websocket.js';
import { build, hello, openTransport, type Harness, welcome } from './test-support/ws-harness.js';
import type { WebSocketTransportOptions } from './ws-transport.js';

type ErrorMessage = Extract<ServerMessage, { t: 'error' }>;

beforeEach(() => {
  FakeWebSocket.reset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const FAST: Partial<WebSocketTransportOptions> = { random: () => 1 };

/** O servidor atende a tentativa em curso: abre o socket e manda o welcome. */
async function acceptAttempt(message: ServerMessage = welcome()): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  FakeWebSocket.last().serverOpen();
  FakeWebSocket.last().serverSend(message);
  await vi.advanceTimersByTimeAsync(0);
}

/** Deixa passar a espera do backoff e a tentativa seguinte começar. */
async function waitForAttempt(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

function errorMessage(
  code: CollaborationErrorCode,
  extra: Partial<ErrorMessage> = {},
): ErrorMessage {
  return { t: 'error', code, message: `erro ${code}`, fatal: true, ...extra };
}

/** Abre, derruba o enlace e deixa a primeira tentativa de reconexão começar. */
async function reconnecting(extra: Partial<WebSocketTransportOptions> = {}): Promise<Harness> {
  const harness = await openTransport({ ...FAST, ...extra });
  FakeWebSocket.last().serverClose(1006);
  await waitForAttempt(500);
  expect(FakeWebSocket.instances).toHaveLength(2);
  return harness;
}

const STOPS: Array<[string, ErrorMessage]> = [
  ['UNAUTHORIZED', errorMessage('UNAUTHORIZED')],
  ['NOT_FOUND', errorMessage('NOT_FOUND')],
  ['ROOM_EPOCH_MISMATCH', errorMessage('ROOM_EPOCH_MISMATCH')],
  ['UNSUPPORTED_VERSION', errorMessage('UNSUPPORTED_VERSION', { details: { supported: [1] } })],
  ['UNSUPPORTED', errorMessage('UNSUPPORTED')],
  ['PROTOCOL_ERROR', errorMessage('PROTOCOL_ERROR')],
  ['INVALID_DOCUMENT', errorMessage('INVALID_DOCUMENT')],
  [
    'LIMIT_EXCEEDED com reason welcome',
    errorMessage('LIMIT_EXCEEDED', { details: { reason: 'welcome' } }),
  ],
];

const RETRIES: Array<[string, ErrorMessage]> = [
  [
    'LIMIT_EXCEEDED com reason clients',
    errorMessage('LIMIT_EXCEEDED', { details: { reason: 'clients' } }),
  ],
  [
    'LIMIT_EXCEEDED com reason rooms',
    errorMessage('LIMIT_EXCEEDED', { details: { reason: 'rooms' } }),
  ],
  ['STORAGE_UNAVAILABLE', errorMessage('STORAGE_UNAVAILABLE')],
  ['CONNECTION_FAILED', errorMessage('CONNECTION_FAILED')],
];

describe('queda e volta (US-W.2)', () => {
  it('a queda leva a reconnecting, resolve os pedidos com DISCONNECTED e volta a open com o resync inteiro', async () => {
    const { transport, states, inbound } = await openTransport({ ...FAST });
    const pending = transport.commit('c', new Uint8Array(), 'epoch-1');

    FakeWebSocket.last().serverClose(1006);

    expect(await pending).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } });
    expect(transport.state).toBe('reconnecting');
    await waitForAttempt(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(transport.state).toBe('reconnecting');
    await acceptAttempt(
      welcome({
        roomEpoch: 'epoch-1',
        missing: new Uint8Array([5]),
        user: { id: 'u-1' },
        serverTime: 42,
      }),
    );

    expect(transport.state).toBe('open');
    expect(states.map((entry) => entry.state)).toEqual([
      'connecting',
      'open',
      'reconnecting',
      'open',
    ]);
    expect(inbound).toEqual([
      {
        type: 'resync',
        welcome: {
          roomEpoch: 'epoch-1',
          access: 'write',
          missing: new Uint8Array([5]),
          serverSyncState: new Uint8Array([8]),
          serverTime: 42,
          user: { id: 'u-1' },
        },
      },
    ]);
  });

  it('cada tentativa chama getHello e getCredentials de novo, e o hello leva o que eles devolvem agora', async () => {
    let version = 0;
    const getHello = vi.fn(() => {
      version += 1;
      return hello({
        syncState: new Uint8Array([version]),
        credentials: { token: `velho-${version}` },
      });
    });
    let tokens = 0;
    const getCredentials = vi.fn(() => ({ token: `token-${(tokens += 1)}` }));
    const harness = build({ ...FAST, getCredentials });
    const opening = harness.transport.open(getHello);
    await vi.advanceTimersByTimeAsync(0);
    FakeWebSocket.last().serverOpen();
    FakeWebSocket.last().serverSend(welcome());
    await opening;
    FakeWebSocket.last().serverClose(1006);

    await waitForAttempt(500);
    FakeWebSocket.last().serverOpen();

    expect(getHello).toHaveBeenCalledTimes(2);
    expect(getCredentials).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.last().sentMessages()[0]).toMatchObject({
      t: 'hello',
      syncState: new Uint8Array([2]),
      credentials: { token: 'token-2' },
    });
  });

  it('o backoff é exponencial com jitter completo: a espera é sorteada entre 0 e o teto', async () => {
    const harness = build({
      backoff: { initialMs: 100, maxMs: 1_000, factor: 2 },
      random: () => 1,
    });
    const opening = harness.transport.open(() => hello());
    await vi.advanceTimersByTimeAsync(0);
    FakeWebSocket.last().serverOpen();
    FakeWebSocket.last().serverSend(welcome());
    await opening;
    FakeWebSocket.last().serverClose(1006);

    const waits: number[] = [];
    for (const ceiling of [100, 200, 400, 800, 1_000, 1_000]) {
      const before = FakeWebSocket.instances.length;
      await vi.advanceTimersByTimeAsync(ceiling - 1);
      expect(FakeWebSocket.instances).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeWebSocket.instances).toHaveLength(before + 1);
      waits.push(ceiling);
      FakeWebSocket.last().serverClose(1006);
    }

    expect(waits).toEqual([100, 200, 400, 800, 1_000, 1_000]);
  });

  it('com sorteio 0 a nova tentativa é imediata', async () => {
    const harness = build({ random: () => 0 });
    const opening = harness.transport.open(() => hello());
    await vi.advanceTimersByTimeAsync(0);
    FakeWebSocket.last().serverOpen();
    FakeWebSocket.last().serverSend(welcome());
    await opening;

    FakeWebSocket.last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('o backoff zera depois de 10 s em open, e não zera antes', async () => {
    const { transport } = await openTransport({ ...FAST });
    FakeWebSocket.last().serverClose(1006);
    await waitForAttempt(500);
    await acceptAttempt();
    await vi.advanceTimersByTimeAsync(9_999);
    FakeWebSocket.last().serverClose(1006);
    // Menos de 10 s em open: o contador seguiu e a espera é a da segunda tentativa.
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
    await acceptAttempt();
    await vi.advanceTimersByTimeAsync(10_000);
    FakeWebSocket.last().serverClose(1006);

    await vi.advanceTimersByTimeAsync(499);
    expect(FakeWebSocket.instances).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);

    expect(FakeWebSocket.instances).toHaveLength(4);
    expect(transport.state).toBe('reconnecting');
  });

  it('sem limite de tentativas: segue tentando depois de muitas falhas', async () => {
    const { transport } = await openTransport({ ...FAST });
    FakeWebSocket.last().serverClose(1006);

    for (let attempt = 0; attempt < 40; attempt += 1) {
      await vi.advanceTimersByTimeAsync(30_000);
      FakeWebSocket.last().serverClose(1006);
    }

    expect(FakeWebSocket.instances.length).toBeGreaterThan(40);
    expect(transport.state).toBe('reconnecting');
  });

  it('a tentativa que não recebe welcome em openTimeoutMs é abandonada e a seguinte vem com backoff', async () => {
    const { transport } = await openTransport({ ...FAST, openTimeoutMs: 2_000 });
    FakeWebSocket.last().serverClose(1006);
    await waitForAttempt(500);
    FakeWebSocket.last().serverOpen();

    await vi.advanceTimersByTimeAsync(2_000);

    expect(FakeWebSocket.instances[1]?.closeCalls).toHaveLength(1);
    expect(transport.state).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('commit e sync enquanto reconecta resolvem com DISCONNECTED, sem mandar nada', async () => {
    const { transport } = await openTransport({ ...FAST });
    FakeWebSocket.last().serverClose(1006);
    const sentBefore = FakeWebSocket.last().sent.length;

    const commit = await transport.commit('c', new Uint8Array(), 'epoch-1');
    const sync = await transport.sync(new Uint8Array());
    transport.sendPresence({ a: 1 });

    expect(commit).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } });
    expect(sync).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } });
    expect(FakeWebSocket.last().sent).toHaveLength(sentBefore);
  });

  it('o que o socket velho ainda mandar depois da queda é ignorado', async () => {
    const { transport, inbound } = await reconnecting();
    const old = FakeWebSocket.instances[0];

    old?.serverSend({ t: 'presence', from: 'b', state: null });
    old?.serverClose(1006);

    expect(inbound).toEqual([]);
    expect(transport.state).toBe('reconnecting');
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('o timeout de um pedido derruba o enlace: DISCONNECTED, reconnecting e resync', async () => {
    const { transport, inbound } = await openTransport({ ...FAST, requestTimeoutMs: 5_000 });
    const pending = transport.commit('c', new Uint8Array(), 'epoch-1');

    await vi.advanceTimersByTimeAsync(5_000);

    expect(await pending).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } });
    expect(transport.state).toBe('reconnecting');
    expect(FakeWebSocket.instances[0]?.closeCalls).toHaveLength(1);
    await waitForAttempt(500);
    await acceptAttempt();
    expect(transport.state).toBe('open');
    expect(inbound.map((message) => message.type)).toEqual(['resync']);
  });

  it('getHello que lança numa reconexão encerra com o erro: a sessão não existe mais', async () => {
    let calls = 0;
    const harness = build({ ...FAST });
    const opening = harness.transport.open(() => {
      calls += 1;
      if (calls > 1) throw new Error('sessão destruída');
      return hello();
    });
    await vi.advanceTimersByTimeAsync(0);
    FakeWebSocket.last().serverOpen();
    FakeWebSocket.last().serverSend(welcome());
    await opening;

    FakeWebSocket.last().serverClose(1006);
    await waitForAttempt(500);

    expect(harness.transport.state).toBe('closed');
    expect(harness.states.at(-1)?.error?.details).toMatchObject({ reason: 'get_hello_failed' });
  });

  it('getCredentials que lança numa reconexão é uma falha passageira: tenta de novo', async () => {
    let calls = 0;
    const harness = build({
      ...FAST,
      getCredentials: () => {
        calls += 1;
        if (calls === 2) throw new Error('token indisponível');
        return { token: 't' };
      },
    });
    const opening = harness.transport.open(() => hello());
    await vi.advanceTimersByTimeAsync(0);
    FakeWebSocket.last().serverOpen();
    FakeWebSocket.last().serverSend(welcome());
    await opening;
    FakeWebSocket.last().serverClose(1006);

    await waitForAttempt(500);
    expect(harness.transport.state).toBe('reconnecting');
    expect(FakeWebSocket.instances).toHaveLength(1);
    await waitForAttempt(1_000);
    await acceptAttempt();

    expect(harness.transport.state).toBe('open');
  });
});

describe('erros que param de tentar (US-W.3, R7, R13)', () => {
  it.each(STOPS)(
    '%s no handshake da reconexão: closed com o erro, sem nova tentativa',
    async (_name, message) => {
      const { transport, states } = await reconnecting();

      FakeWebSocket.last().serverOpen();
      FakeWebSocket.last().serverSend(message);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10 * 60_000);

      expect(transport.state).toBe('closed');
      expect(states.at(-1)).toMatchObject({ state: 'closed', error: { code: message.code } });
      expect(FakeWebSocket.instances).toHaveLength(2);
    },
  );

  it.each(STOPS)(
    '%s como error fatal com o enlace aberto: closed com o erro, sem nova tentativa',
    async (_name, message) => {
      const { transport, states } = await openTransport({ ...FAST });

      FakeWebSocket.last().serverSend(message);
      await vi.advanceTimersByTimeAsync(10 * 60_000);

      expect(transport.state).toBe('closed');
      expect(states.at(-1)).toMatchObject({ state: 'closed', error: { code: message.code } });
      expect(FakeWebSocket.instances).toHaveLength(1);
    },
  );

  it.each([
    [4001, 'CONFLICT', 'replaced'],
    [4003, 'UNAUTHORIZED', 'origin'],
    [4000, 'PROTOCOL_ERROR', 'fatal_close'],
    [1009, 'LIMIT_EXCEEDED', 'frame'],
  ] as const)(
    'fechamento %i com o enlace aberto: closed com %s e reason %s',
    async (closeCode, code, reason) => {
      const { transport, states } = await openTransport({ ...FAST });

      FakeWebSocket.last().serverClose(closeCode);
      await vi.advanceTimersByTimeAsync(10 * 60_000);

      expect(transport.state).toBe('closed');
      expect(states.at(-1)).toMatchObject({
        state: 'closed',
        error: { code, details: { reason, closeCode } },
      });
      expect(FakeWebSocket.instances).toHaveLength(1);
    },
  );

  it.each([
    [4001, 'CONFLICT'],
    [4003, 'UNAUTHORIZED'],
    [4000, 'PROTOCOL_ERROR'],
    [1009, 'LIMIT_EXCEEDED'],
  ] as const)('fechamento %i no handshake da reconexão: closed com %s', async (closeCode, code) => {
    const { transport, states } = await reconnecting();

    FakeWebSocket.last().serverClose(closeCode);
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(transport.state).toBe('closed');
    expect(states.at(-1)?.error?.code).toBe(code);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('a sessão substituída (4001) chega com mais nada tentando: nem timer sobra', async () => {
    const { transport } = await openTransport({ ...FAST });

    FakeWebSocket.last().serverClose(4001);

    expect(transport.state).toBe('closed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('um quadro inválido com o enlace aberto continua sendo fatal e não tenta de novo', async () => {
    const { transport } = await openTransport({ ...FAST });

    FakeWebSocket.last().serverSendRaw('texto');
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(transport.state).toBe('closed');
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('erros que tentam de novo (US-W.3, R7)', () => {
  it.each(RETRIES)(
    '%s no handshake da reconexão: segue em reconnecting e tenta de novo',
    async (_name, message) => {
      const { transport } = await reconnecting();

      FakeWebSocket.last().serverOpen();
      FakeWebSocket.last().serverSend(message);
      await vi.advanceTimersByTimeAsync(0);

      expect(transport.state).toBe('reconnecting');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(FakeWebSocket.instances).toHaveLength(3);
      await acceptAttempt();
      expect(transport.state).toBe('open');
    },
  );

  it.each(RETRIES)(
    '%s como error fatal com o enlace aberto: reconecta sozinho',
    async (_name, message) => {
      const { transport } = await openTransport({ ...FAST });

      FakeWebSocket.last().serverSend(message);
      await vi.advanceTimersByTimeAsync(0);

      expect(transport.state).toBe('reconnecting');
      await waitForAttempt(500);
      expect(FakeWebSocket.instances).toHaveLength(2);
    },
  );

  it.each([1000, 1001, 1006, 1011, 1012, 1013])(
    'fechamento %i com o enlace aberto: reconnecting e nova tentativa',
    async (closeCode) => {
      const { transport } = await openTransport({ ...FAST });

      FakeWebSocket.last().serverClose(closeCode);

      expect(transport.state).toBe('reconnecting');
      await waitForAttempt(500);
      expect(FakeWebSocket.instances).toHaveLength(2);
    },
  );

  it('falha de rede na tentativa (erro e fechamento 1006 antes de abrir) segue o backoff', async () => {
    const { transport } = await reconnecting();

    FakeWebSocket.last().serverError();
    FakeWebSocket.last().serverClose(1006);

    expect(transport.state).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('na primeira abertura não há nova tentativa, nem para erro transitório: a sessão decide', async () => {
    const harness = build({ ...FAST });
    const opening = harness.transport.open(() => hello());
    await vi.advanceTimersByTimeAsync(0);
    FakeWebSocket.last().serverOpen();
    FakeWebSocket.last().serverSend(
      errorMessage('LIMIT_EXCEEDED', { details: { reason: 'clients' } }),
    );

    const result = await opening;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(!result.ok && result.error.code).toBe('LIMIT_EXCEEDED');
    expect(harness.transport.state).toBe('closed');
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('janela do navegador (R3)', () => {
  function stubBrowser() {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    return { win, doc };
  }

  it('offline derruba o socket na hora e vai a reconnecting', async () => {
    const { win } = stubBrowser();
    const { transport } = await openTransport({ ...FAST });
    const pending = transport.commit('c', new Uint8Array(), 'epoch-1');

    win.dispatchEvent(new Event('offline'));

    expect(transport.state).toBe('reconnecting');
    expect(FakeWebSocket.instances[0]?.closeCalls).toHaveLength(1);
    expect(await pending).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } });
  });

  it('online cancela a espera e tenta já', async () => {
    const { win } = stubBrowser();
    const { transport } = await openTransport({ ...FAST });
    win.dispatchEvent(new Event('offline'));
    await vi.advanceTimersByTimeAsync(100);
    expect(FakeWebSocket.instances).toHaveLength(1);

    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeWebSocket.instances).toHaveLength(2);
    await acceptAttempt();
    expect(transport.state).toBe('open');
  });

  it('a aba que volta a ficar visível cancela a espera e tenta já; escondida, não faz nada', async () => {
    const { doc } = stubBrowser();
    await openTransport({ ...FAST });
    FakeWebSocket.last().serverClose(1006);

    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.instances).toHaveLength(1);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('online com o enlace aberto ou com uma tentativa em curso não abre outro socket', async () => {
    const { win } = stubBrowser();
    await openTransport({ ...FAST });
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.instances).toHaveLength(1);

    FakeWebSocket.last().serverClose(1006);
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('offline e online com o transporte ainda ocioso ou na primeira abertura não fazem nada', async () => {
    const { win } = stubBrowser();
    const harness = build({ ...FAST });
    win.dispatchEvent(new Event('offline'));
    const opening = harness.transport.open(() => hello());
    await vi.advanceTimersByTimeAsync(0);
    win.dispatchEvent(new Event('offline'));
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(harness.transport.state).toBe('connecting');
    harness.transport.close();
    await opening;
  });

  it('close() tira os ouvintes de window e document', async () => {
    const { win, doc } = stubBrowser();
    const add = vi.spyOn(win, 'addEventListener');
    const remove = vi.spyOn(win, 'removeEventListener');
    const addDoc = vi.spyOn(doc, 'addEventListener');
    const removeDoc = vi.spyOn(doc, 'removeEventListener');
    const { transport } = await openTransport({ ...FAST });

    transport.close();

    expect(add.mock.calls.map((call) => call[0]).sort()).toEqual(['offline', 'online']);
    expect(remove.mock.calls.map((call) => call[0]).sort()).toEqual(['offline', 'online']);
    expect(addDoc.mock.calls.map((call) => call[0])).toEqual(['visibilitychange']);
    expect(removeDoc.mock.calls.map((call) => call[0])).toEqual(['visibilitychange']);
    win.dispatchEvent(new Event('offline'));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('um erro que encerra de vez também tira os ouvintes', async () => {
    const { win } = stubBrowser();
    const remove = vi.spyOn(win, 'removeEventListener');
    await openTransport({ ...FAST });

    FakeWebSocket.last().serverClose(4001);

    expect(remove.mock.calls.map((call) => call[0]).sort()).toEqual(['offline', 'online']);
  });

  it('sem window (Node), nada é registrado e o transporte funciona', async () => {
    const { transport } = await openTransport({ ...FAST });

    FakeWebSocket.last().serverClose(1006);
    await waitForAttempt(500);

    expect(FakeWebSocket.instances).toHaveLength(2);
    transport.close();
  });
});

describe('close() durante a reconexão (US-W.4)', () => {
  it('durante a espera do backoff, cancela a tentativa e não deixa timer', async () => {
    const { transport } = await openTransport({ ...FAST });
    FakeWebSocket.last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(100);

    transport.close();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(transport.state).toBe('closed');
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('durante o handshake de uma tentativa, fecha o socket dela e solta tudo', async () => {
    const { transport } = await reconnecting();
    const attempt = FakeWebSocket.last();

    transport.close();
    attempt.serverOpen();
    attempt.serverSend(welcome());

    expect(transport.state).toBe('closed');
    expect(attempt.closeCalls).toEqual([{ code: 1000, reason: undefined }]);
    expect(attempt.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('close() com o enlace aberto zera o timer de estabilidade', async () => {
    const { transport } = await openTransport({ ...FAST });
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    transport.close();

    expect(vi.getTimerCount()).toBe(0);
  });
});
