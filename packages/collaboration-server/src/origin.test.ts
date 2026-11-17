import { type ClientMessage } from '@canvash/collaboration';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCollaborationServer } from './server.js';
import { FakeConnection } from './test-support/fake-connection.js';
import { createInstrumentedStorage } from './test-support/instrumented-storage.js';
import { createRecordingLogger } from './test-support/recording-logger.js';
import type { CollaborationServerOptions, ConnectionRequest } from './types.js';

const HELLO: ClientMessage = {
  t: 'hello',
  v: 1,
  provider: 'yjs',
  documentId: 'doc-1',
  sessionId: 'sessao-a',
  syncState: new Uint8Array(),
};

function setup(extra: Partial<CollaborationServerOptions> = {}) {
  const storage = createInstrumentedStorage();
  const logger = createRecordingLogger();
  const server = createCollaborationServer({ storage, logger, ...extra });
  return { storage, logger, server };
}

function open(
  server: ReturnType<typeof setup>['server'],
  origin?: string,
  send: ClientMessage | undefined = HELLO,
): FakeConnection {
  const connection = new FakeConnection();
  const request: ConnectionRequest = {
    headers: new Headers(origin === undefined ? {} : { origin }),
  };
  server.handleConnection(connection, request);
  if (send !== undefined) connection.receive(send);
  return connection;
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('allowedOrigins no núcleo (US-S.8, R19)', () => {
  const allowedOrigins = ['https://app.exemplo.test', 'http://localhost:5173'];

  it.each(allowedOrigins)('a origem %s da lista entra', async (origin) => {
    const { server } = setup({ allowedOrigins });

    const connection = open(server, origin);
    await settle();

    expect(connection.messages().map((message) => message.t)).toEqual(['welcome']);
  });

  it('origem fora da lista: fecha com 4003, sem mensagem, sem authorize e sem carregar sala', async () => {
    const authorize = vi.fn(() => ({ allow: true as const, access: 'write' as const }));
    const { storage, server } = setup({ allowedOrigins, authorize });

    const connection = open(server, 'https://atacante.test');
    await settle();

    expect(connection.closed?.code).toBe(4003);
    expect(connection.messages()).toEqual([]);
    expect(authorize).not.toHaveBeenCalled();
    expect(storage.calls.load).toBe(0);
  });

  it('origem ausente com a lista configurada: fecha com 4003', async () => {
    const { server } = setup({ allowedOrigins });

    const connection = open(server, undefined);
    await settle();

    expect(connection.closed?.code).toBe(4003);
    expect(connection.messages()).toEqual([]);
  });

  it('a comparação é exata: outra porta, outro esquema ou barra no fim não valem', async () => {
    const { server } = setup({ allowedOrigins });

    for (const origin of [
      'http://localhost:5174',
      'https://localhost:5173',
      'http://localhost:5173/',
      'https://app.exemplo.test.atacante.test',
    ]) {
      expect(open(server, origin).closed?.code, origin).toBe(4003);
    }
  });

  it('a recusa vale antes do hello: fechou na hora e o prazo do hello não dispara depois', () => {
    vi.useFakeTimers();
    const { server } = setup({ allowedOrigins, helloTimeoutMs: 1_000 });

    const connection = open(server, 'https://atacante.test', undefined);
    expect(connection.closed?.code).toBe(4003);
    vi.advanceTimersByTime(5_000);

    expect(connection.messages()).toEqual([]);
    expect(connection.closed?.code).toBe(4003);
  });

  it('uma lista vazia recusa toda origem', () => {
    const { server } = setup({ allowedOrigins: [] });

    expect(open(server, 'https://app.exemplo.test').closed?.code).toBe(4003);
  });
});

describe('sem a lista de origens (R19)', () => {
  it('aceita qualquer origem, ou nenhuma, e avisa uma vez no logger', async () => {
    const { logger, server } = setup();

    const a = open(server, 'https://qualquer.test');
    const b = open(server, undefined, { ...HELLO, sessionId: 'b' });
    await settle();

    expect(a.closed).toBeUndefined();
    expect(b.closed).toBeUndefined();
    const warnings = logger.calls.filter(
      (call) => call.level === 'warn' && call.message.includes('allowedOrigins'),
    );
    expect(warnings).toHaveLength(1);
  });

  it('com a lista configurada, não há aviso de origem', () => {
    const { logger } = setup({ allowedOrigins: ['https://app.exemplo.test'] });

    expect(logger.calls.filter((call) => call.message.includes('allowedOrigins'))).toEqual([]);
  });

  it('um servidor sem authorize e sem lista tem os dois avisos, cada um uma vez', async () => {
    const { logger, server } = setup();

    open(server, 'https://x.test');
    open(server, 'https://y.test', { ...HELLO, sessionId: 'b' });
    await settle();

    const messages = logger.calls
      .filter((call) => call.level === 'warn')
      .map((call) => call.message);
    expect(messages.filter((message) => message.includes('authorize'))).toHaveLength(1);
    expect(messages.filter((message) => message.includes('allowedOrigins'))).toHaveLength(1);
  });
});
