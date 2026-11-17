import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCollaborationServer } from './server.js';
import { createInstrumentedStorage } from './test-support/instrumented-storage.js';
import { createRecordingLogger } from './test-support/recording-logger.js';
import { TestClient, settle } from './test-support/test-client.js';
import type { CollaborationServerOptions } from './types.js';

function setup(extra: Partial<CollaborationServerOptions> = {}) {
  const storage = createInstrumentedStorage();
  const logger = createRecordingLogger();
  const server = createCollaborationServer({
    storage,
    logger,
    createEpoch: () => 'epoch-1',
    ...extra,
  });
  return { storage, logger, server };
}

function presencesOf(client: TestClient): Array<{ from: string; state: unknown }> {
  return client.of('presence').map((message) => ({ from: message.from, state: message.state }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('identidade da presença (US-S.15, R16)', () => {
  it('repassa aos outros com o from carimbado e não devolve ao remetente', async () => {
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });

    a.presence({ sessionId: 'a', cursor: { x: 1, y: 2 }, updatedAt: 5 });

    expect(presencesOf(b)).toEqual([
      { from: 'a', state: { sessionId: 'a', cursor: { x: 1, y: 2 }, updatedAt: 5 } },
    ]);
    expect(presencesOf(a)).toEqual([]);
  });

  it('a presença sem sessionId também vale, carimbada com o from', async () => {
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });

    a.presence({ cursor: { x: 1, y: 2 } });

    expect(presencesOf(b)).toEqual([{ from: 'a', state: { cursor: { x: 1, y: 2 } } }]);
  });

  it('com user do authorize, userId e userName são sobrescritos; o que o cliente declarou não chega', async () => {
    const { server } = setup({
      authorize: () => ({ allow: true, access: 'write', user: { id: 'u-17', name: 'Ana Souza' } }),
    });
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });

    a.presence({
      sessionId: 'a',
      userId: 'u-do-outro',
      userName: 'Outra Pessoa',
      cursor: { x: 1, y: 1 },
    });

    expect(presencesOf(b)[0]?.state).toEqual({
      sessionId: 'a',
      userId: 'u-17',
      userName: 'Ana Souza',
      cursor: { x: 1, y: 1 },
    });
  });

  it('o userId é imposto mesmo quando o cliente não declara nenhum', async () => {
    const { server } = setup({
      authorize: () => ({ allow: true, access: 'write', user: { id: 'u-17' } }),
    });
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });

    a.presence({ cursor: { x: 1, y: 1 }, userName: 'Declarado pelo cliente' });

    expect(presencesOf(b)[0]?.state).toEqual({
      userId: 'u-17',
      cursor: { x: 1, y: 1 },
      userName: 'Declarado pelo cliente',
    });
  });

  it('sem user, repassa o que veio, sem campo novo', async () => {
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });

    a.presence({ userId: 'declarado', userName: 'Declarado', color: '#aabbcc' });

    expect(presencesOf(b)[0]?.state).toEqual({
      userId: 'declarado',
      userName: 'Declarado',
      color: '#aabbcc',
    });
  });

  it('presença com sessionId de outra sessão é descartada e contada em RoomStats', async () => {
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });

    a.presence({ sessionId: 'b', cursor: { x: 1, y: 1 } });

    expect(presencesOf(b)).toEqual([]);
    expect(server.getRoomStats('doc-1')).toMatchObject({ droppedPresence: 1 });
  });

  it.each([['texto'], [42], [true], [[1, 2]]])(
    'estado que não é objeto nem null (%j) é descartado e contado',
    async (state) => {
      const { server } = setup();
      const a = await TestClient.join(server, { sessionId: 'a' });
      const b = await TestClient.join(server, { sessionId: 'b' });

      a.presence(state);

      expect(presencesOf(b)).toEqual([]);
      expect(server.getRoomStats('doc-1')).toMatchObject({ droppedPresence: 1 });
    },
  );

  it('um acesso read também publica presença', async () => {
    const { server } = setup({
      authorize: (request) => ({
        allow: true,
        access: request.sessionId === 'leitor' ? 'read' : 'write',
      }),
    });
    const reader = await TestClient.join(server, { sessionId: 'leitor' });
    const writer = await TestClient.join(server, { sessionId: 'escritor' });

    reader.presence({ cursor: { x: 1, y: 1 } });

    expect(presencesOf(writer)).toHaveLength(1);
  });
});

describe('limites da presença (R16)', () => {
  it('presença maior que maxPresenceBytes é descartada e contada; a menor passa', async () => {
    const { server } = setup({ maxPresenceBytes: 300 });
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });

    a.presence({ selection: Array.from({ length: 200 }, (_, index) => `forma-${index}`) });
    a.presence({ selection: ['r1'] });

    expect(presencesOf(b).map((entry) => entry.state)).toEqual([{ selection: ['r1'] }]);
    expect(server.getRoomStats('doc-1')).toMatchObject({ droppedPresence: 1 });
  });

  it('o padrão é 16 KiB por presença', async () => {
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });

    a.presence({ selection: Array.from({ length: 1_000 }, (_, index) => `forma-${index}`) });
    a.presence({ selection: Array.from({ length: 1_800 }, (_, index) => `forma-${index}`) });

    expect(presencesOf(b)).toHaveLength(1);
    expect(server.getRoomStats('doc-1')).toMatchObject({ droppedPresence: 1 });
  });

  it('o conteúdo da presença nunca vai ao logger', async () => {
    const { logger, server } = setup({ maxPresenceBytes: 100 });
    const a = await TestClient.join(server, { sessionId: 'a' });
    await TestClient.join(server, { sessionId: 'b' });

    a.presence({ userName: 'MARCA-NOME', selection: Array.from({ length: 50 }, () => 'MARCA-ID') });
    a.presence({ sessionId: 'outra', userName: 'MARCA-NOME' });

    expect(logger.dump()).not.toContain('MARCA');
  });
});

describe('taxa da presença (R16)', () => {
  it('a primeira passa na hora, o excesso guarda só a última e a manda no fim da janela', async () => {
    vi.useFakeTimers();
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    await vi.advanceTimersByTimeAsync(0);

    a.presence({ cursor: { x: 1, y: 0 } });
    a.presence({ cursor: { x: 2, y: 0 } });
    a.presence({ cursor: { x: 3, y: 0 } });

    expect(presencesOf(b).map((entry) => entry.state)).toEqual([{ cursor: { x: 1, y: 0 } }]);
    await vi.advanceTimersByTimeAsync(49);
    expect(presencesOf(b)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(presencesOf(b).map((entry) => entry.state)).toEqual([
      { cursor: { x: 1, y: 0 } },
      { cursor: { x: 3, y: 0 } },
    ]);
  });

  it('100 presenças em 1 s viram um repasse a cada 50 ms, no máximo, e a última sempre chega', async () => {
    vi.useFakeTimers();
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    await vi.advanceTimersByTimeAsync(0);
    const deliveredAt: number[] = [];
    let seen = 0;
    const sample = (): void => {
      for (; seen < presencesOf(b).length; seen += 1) deliveredAt.push(Date.now());
    };

    for (let step = 0; step < 100; step += 1) {
      a.presence({ cursor: { x: step, y: 0 } });
      sample();
      await vi.advanceTimersByTimeAsync(10);
      sample();
    }
    await vi.advanceTimersByTimeAsync(100);
    sample();

    // 100 presenças em 1 s viram uma por janela de 50 ms: 20 dentro do segundo, mais a que
    // fecha a última janela.
    expect(deliveredAt.length).toBeLessThanOrEqual(21);
    for (let index = 1; index < deliveredAt.length; index += 1) {
      expect(
        (deliveredAt[index] ?? 0) - (deliveredAt[index - 1] ?? 0),
        `entre o repasse ${index - 1} e o ${index}`,
      ).toBeGreaterThanOrEqual(50);
    }
    expect(presencesOf(b).at(-1)?.state).toEqual({ cursor: { x: 99, y: 0 } });
  });

  it('presenceRateHz muda a janela', async () => {
    vi.useFakeTimers();
    const { server } = setup({ presenceRateHz: 5 });
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    await vi.advanceTimersByTimeAsync(0);

    a.presence({ cursor: { x: 1, y: 0 } });
    a.presence({ cursor: { x: 2, y: 0 } });
    await vi.advanceTimersByTimeAsync(199);
    expect(presencesOf(b)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(presencesOf(b)).toHaveLength(2);
  });

  it('a taxa é por sessão: uma sessão ocupada não segura a outra', async () => {
    vi.useFakeTimers();
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    const c = await TestClient.join(server, { sessionId: 'c' });
    await vi.advanceTimersByTimeAsync(0);

    a.presence({ cursor: { x: 1, y: 0 } });
    a.presence({ cursor: { x: 2, y: 0 } });
    b.presence({ cursor: { x: 9, y: 0 } });

    expect(presencesOf(c).map((entry) => entry.from)).toEqual(['a', 'b']);
  });

  it('depois de uma pausa maior que a janela, a presença seguinte passa na hora', async () => {
    vi.useFakeTimers();
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    await vi.advanceTimersByTimeAsync(0);
    a.presence({ cursor: { x: 1, y: 0 } });

    await vi.advanceTimersByTimeAsync(500);
    a.presence({ cursor: { x: 2, y: 0 } });

    expect(presencesOf(b)).toHaveLength(2);
  });
});

describe('o recém-chegado e a saída (US-S.15, R17)', () => {
  it('recebe a presença atual dos outros logo depois do welcome, e não a própria', async () => {
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    a.presence({ cursor: { x: 1, y: 1 } });
    b.presence({ cursor: { x: 2, y: 2 } });
    a.presence({ cursor: { x: 5, y: 5 } });

    const late = await TestClient.join(server, { sessionId: 'late' });

    expect(late.messages().map((message) => message.t)).toEqual([
      'welcome',
      'presence',
      'presence',
    ]);
    expect(presencesOf(late)).toEqual([
      { from: 'a', state: { cursor: { x: 5, y: 5 } } },
      { from: 'b', state: { cursor: { x: 2, y: 2 } } },
    ]);
  });

  it('a última presença guardada é a recebida, mesmo a que ainda espera a janela', async () => {
    vi.useFakeTimers();
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    await vi.advanceTimersByTimeAsync(0);
    a.presence({ cursor: { x: 1, y: 0 } });
    a.presence({ cursor: { x: 2, y: 0 } });

    const late = await TestClient.join(server, { sessionId: 'late' });
    await vi.advanceTimersByTimeAsync(0);

    expect(presencesOf(late)).toEqual([{ from: 'a', state: { cursor: { x: 2, y: 0 } } }]);
  });

  it('quem fecha a conexão manda presence null aos outros, e some da lista do próximo recém-chegado', async () => {
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    a.presence({ cursor: { x: 1, y: 1 } });

    a.connection.drop();

    expect(presencesOf(b)).toEqual([
      { from: 'a', state: { cursor: { x: 1, y: 1 } } },
      { from: 'a', state: null },
    ]);
    const late = await TestClient.join(server, { sessionId: 'late' });
    expect(presencesOf(late)).toEqual([]);
  });

  it('bye também manda presence null', async () => {
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });

    a.connection.receive({ t: 'bye' });

    expect(presencesOf(b)).toEqual([{ from: 'a', state: null }]);
  });

  it('substituir a conexão (4001) não manda presence null; fechar a nova manda', async () => {
    const { server } = setup();
    const old = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    old.presence({ cursor: { x: 1, y: 1 } });

    const fresh = await TestClient.join(server, { sessionId: 'a' });

    expect(old.connection.closed?.code).toBe(4001);
    expect(presencesOf(b)).toEqual([{ from: 'a', state: { cursor: { x: 1, y: 1 } } }]);
    expect(presencesOf(fresh)).toEqual([]);
    fresh.connection.drop();
    expect(presencesOf(b).at(-1)).toEqual({ from: 'a', state: null });
  });

  it('o presence null do cliente é repassado na hora e apaga a presença guardada', async () => {
    vi.useFakeTimers();
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    await vi.advanceTimersByTimeAsync(0);
    a.presence({ cursor: { x: 1, y: 1 } });
    a.presence({ cursor: { x: 2, y: 2 } });

    a.presence(null);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(presencesOf(b)).toEqual([
      { from: 'a', state: { cursor: { x: 1, y: 1 } } },
      { from: 'a', state: null },
    ]);
    const late = await TestClient.join(server, { sessionId: 'late' });
    await vi.advanceTimersByTimeAsync(0);
    expect(presencesOf(late)).toEqual([]);
  });

  it('a presença que esperava a janela não chega depois de a conexão sair', async () => {
    vi.useFakeTimers();
    const { server } = setup();
    const a = await TestClient.join(server, { sessionId: 'a' });
    const b = await TestClient.join(server, { sessionId: 'b' });
    await vi.advanceTimersByTimeAsync(0);
    a.presence({ cursor: { x: 1, y: 1 } });
    a.presence({ cursor: { x: 2, y: 2 } });

    a.connection.drop();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(presencesOf(b)).toEqual([
      { from: 'a', state: { cursor: { x: 1, y: 1 } } },
      { from: 'a', state: null },
    ]);
  });

  it('presença enviada junto com o hello espera o welcome e depois é repassada', async () => {
    const { server } = setup();
    const b = await TestClient.join(server, { sessionId: 'b' });
    const a = TestClient.open(server, { sessionId: 'a' });
    a.presence({ cursor: { x: 1, y: 1 } });
    await settle();

    expect(a.messages().map((message) => message.t)).toEqual(['welcome']);
    expect(presencesOf(b)).toEqual([{ from: 'a', state: { cursor: { x: 1, y: 1 } } }]);
  });
});
