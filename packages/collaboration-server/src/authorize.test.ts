import {
  type ClientMessage,
  type CollaborationError,
  type ServerMessage,
} from '@canvash/collaboration';
import { describe, expect, it, vi } from 'vitest';
import { createCollaborationServer } from './server.js';
import { FakeConnection } from './test-support/fake-connection.js';
import { createInstrumentedStorage } from './test-support/instrumented-storage.js';
import { createRecordingLogger } from './test-support/recording-logger.js';
import type {
  AuthorizeRequest,
  AuthorizeResult,
  CollaborationServerOptions,
  ConnectionRequest,
} from './types.js';

type Hello = Extract<ClientMessage, { t: 'hello' }>;

function hello(overrides: Partial<Hello> = {}): Hello {
  return {
    t: 'hello',
    v: 1,
    provider: 'yjs',
    documentId: 'doc-1',
    sessionId: 'sessao-a',
    syncState: new Uint8Array(),
    ...overrides,
  };
}

function setup(
  authorize: CollaborationServerOptions['authorize'],
  extra: Partial<CollaborationServerOptions> = {},
) {
  const storage = createInstrumentedStorage();
  const logger = createRecordingLogger();
  const server = createCollaborationServer({
    storage,
    logger,
    now: () => 1_700_000_000_000,
    ...(authorize === undefined ? {} : { authorize }),
    ...extra,
  });
  return { storage, logger, server };
}

function connect(
  server: ReturnType<typeof setup>['server'],
  message: ClientMessage = hello(),
  request: ConnectionRequest = { headers: new Headers() },
): FakeConnection {
  const connection = new FakeConnection();
  server.handleConnection(connection, request);
  connection.receive(message);
  return connection;
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

function only<T extends ServerMessage['t']>(
  connection: FakeConnection,
  type: T,
): Extract<ServerMessage, { t: T }> {
  const found = connection.messages().find((message) => message.t === type);
  if (found === undefined) throw new Error(`o servidor não mandou "${type}"`);
  return found as Extract<ServerMessage, { t: T }>;
}

describe('authorize: identidade e acesso (US-S.11, R9)', () => {
  it('recebe documentId, sessionId, credenciais, origem, cabeçalhos e o contexto do host', async () => {
    const received: AuthorizeRequest[] = [];
    const { server } = setup((request) => {
      received.push(request);
      return { allow: true, access: 'write' };
    });
    const context = { rota: '/collab?x=1' };

    const connection = connect(server, hello({ credentials: { token: 'abc' } }), {
      headers: new Headers({ origin: 'http://app.test', 'x-user': 'ana' }),
      context,
    });
    await settle();

    expect(received).toHaveLength(1);
    const [request] = received;
    expect(request).toMatchObject({
      documentId: 'doc-1',
      sessionId: 'sessao-a',
      credentials: { token: 'abc' },
      origin: 'http://app.test',
      context,
    });
    expect(request?.headers.get('x-user')).toBe('ana');
    expect(only(connection, 'welcome').access).toBe('write');
  });

  it('lê um cabeçalho, devolve a identidade e ela aparece no welcome', async () => {
    const { server } = setup((request) => ({
      allow: true,
      access: 'write',
      user: { id: request.headers.get('x-user-id') ?? 'anonimo', name: 'Ana Souza' },
    }));

    const connection = connect(server, hello(), {
      headers: new Headers({ 'x-user-id': 'u-17' }),
    });
    await settle();

    expect(only(connection, 'welcome').user).toEqual({ id: 'u-17', name: 'Ana Souza' });
  });

  it('só id e name chegam ao welcome; o resto do que o hook devolver fica de fora', async () => {
    const { server } = setup(
      () =>
        ({
          allow: true,
          access: 'write',
          user: { id: 'u-1', email: 'ana@exemplo.test', role: 'admin' },
        }) as AuthorizeResult,
    );

    const connection = connect(server);
    await settle();

    expect(only(connection, 'welcome').user).toEqual({ id: 'u-1' });
  });

  it('o acesso read do hook vai ao welcome', async () => {
    const { server } = setup(() => ({ allow: true, access: 'read' }));

    const connection = connect(server);
    await settle();

    expect(only(connection, 'welcome').access).toBe('read');
    expect(only(connection, 'welcome').user).toBeUndefined();
  });

  it('o hook assíncrono é esperado antes do welcome', async () => {
    let release: (result: AuthorizeResult) => void = () => undefined;
    const { server } = setup(
      () =>
        new Promise<AuthorizeResult>((resolve) => {
          release = resolve;
        }),
    );

    const connection = connect(server);
    await settle();
    expect(connection.messages()).toEqual([]);
    release({ allow: true, access: 'write' });
    await settle();

    expect(only(connection, 'welcome').v).toBe(1);
  });
});

describe('authorize: recusa (R9)', () => {
  async function refusal(result: () => AuthorizeResult | Promise<AuthorizeResult>) {
    const { storage, server } = setup(result);
    const connection = connect(server);
    await settle();
    return { storage, server, connection };
  }

  it('recusa simples: UNAUTHORIZED fatal, fechamento 4000 e nenhuma sala carregada', async () => {
    const { storage, server, connection } = await refusal(() => ({ allow: false }));

    expect(connection.messages()).toEqual([
      expect.objectContaining({ t: 'error', code: 'UNAUTHORIZED', fatal: true }),
    ]);
    expect(connection.closed?.code).toBe(4000);
    expect(storage.calls.load).toBe(0);
    expect(server.getRoomStats('doc-1')).toBeUndefined();
  });

  it('o código NOT_FOUND do hook chega ao cliente, fatal (R9)', async () => {
    const { connection } = await refusal(() => ({
      allow: false,
      code: 'NOT_FOUND',
      reason: 'desenho excluído',
    }));

    const error = only(connection, 'error');
    expect(error).toMatchObject({ code: 'NOT_FOUND', fatal: true });
    expect(error.message).toContain('desenho excluído');
  });

  it('o motivo do hook entra na mensagem do erro', async () => {
    const { connection } = await refusal(() => ({
      allow: false,
      reason: 'sem permissão no projeto',
    }));

    expect(only(connection, 'error').message).toContain('sem permissão no projeto');
  });

  it('exceção do hook conta como UNAUTHORIZED e vai para o logger, sem a mensagem da exceção', async () => {
    const logger = createRecordingLogger();
    const server = createCollaborationServer({
      storage: createInstrumentedStorage(),
      logger,
      authorize: () => {
        throw new Error('SEGREDO: senha do banco é 1234');
      },
    });

    const connection = connect(server);
    await settle();

    expect(only(connection, 'error')).toMatchObject({ code: 'UNAUTHORIZED', fatal: true });
    expect(logger.calls.filter((call) => call.level === 'error')).toHaveLength(1);
    expect(logger.calls.find((call) => call.level === 'error')?.fields).toMatchObject({
      documentId: 'doc-1',
      sessionId: 'sessao-a',
    });
    expect(logger.dump()).not.toContain('SEGREDO');
  });

  it('rejeição da promessa do hook também conta como UNAUTHORIZED', async () => {
    const { connection } = await refusal(() => Promise.reject(new Error('banco fora')));

    expect(only(connection, 'error')).toMatchObject({ code: 'UNAUTHORIZED', fatal: true });
  });

  it.each([
    ['sem allow', {}],
    ['acesso desconhecido', { allow: true, access: 'admin' }],
    ['acesso ausente', { allow: true }],
    ['usuário sem id', { allow: true, access: 'write', user: { name: 'sem id' } }],
    ['nada', undefined],
  ])('resposta fora do contrato (%s) conta como UNAUTHORIZED', async (_name, result) => {
    const { connection } = await refusal(() => result as unknown as AuthorizeResult);

    expect(only(connection, 'error')).toMatchObject({ code: 'UNAUTHORIZED', fatal: true });
  });

  it('um código de recusa que não é UNAUTHORIZED nem NOT_FOUND vira UNAUTHORIZED', async () => {
    const { connection } = await refusal(
      () =>
        ({
          allow: false,
          code: 'LIMIT_EXCEEDED',
        }) as unknown as AuthorizeResult,
    );

    expect(only(connection, 'error').code).toBe('UNAUTHORIZED');
  });

  it('a conexão que cai enquanto o hook responde não entra na sala', async () => {
    let release: (result: AuthorizeResult) => void = () => undefined;
    const { storage, server } = setup(
      () =>
        new Promise<AuthorizeResult>((resolve) => {
          release = resolve;
        }),
    );
    const connection = connect(server);
    await settle();

    connection.drop();
    release({ allow: true, access: 'write' });
    await settle();

    expect(storage.calls.load).toBe(0);
    expect(server.getRoomStats('doc-1')).toBeUndefined();
  });
});

describe('authorize: ordem das validações', () => {
  it('versão ou documentId inválidos recusam antes de o hook ser chamado', async () => {
    const authorize = vi.fn((): AuthorizeResult => ({ allow: true, access: 'write' }));
    const { server } = setup(authorize);

    connect(server, hello({ v: 9 }));
    connect(server, hello({ documentId: '../x', sessionId: 'b' }));
    await settle();

    expect(authorize).not.toHaveBeenCalled();
  });

  it('o hook é chamado antes de a sala ser carregada, e a recusa não revela se a sala existe', async () => {
    const { storage, server } = setup(() => ({ allow: false }));
    await storage.create('doc-1', {
      provider: 'yjs',
      roomEpoch: 'epoch-x',
      snapshot: new Uint8Array(),
      log: [],
      receipts: [],
    });
    const before = storage.calls.load;

    const connection = connect(server, hello({ roomEpoch: 'outra-epoch' }));
    await settle();

    expect(only(connection, 'error').code).toBe('UNAUTHORIZED');
    expect(storage.calls.load).toBe(before);
  });
});

describe('sem authorize (R19)', () => {
  it('toda conexão recebe acesso write, e o servidor avisa uma vez no logger', async () => {
    const { logger, server } = setup(undefined);

    const a = connect(server, hello({ sessionId: 'a' }));
    const b = connect(server, hello({ sessionId: 'b' }));
    await settle();

    expect(only(a, 'welcome').access).toBe('write');
    expect(only(b, 'welcome').access).toBe('write');
    const warnings = logger.calls.filter(
      (call) => call.level === 'warn' && call.message.includes('authorize'),
    );
    expect(warnings).toHaveLength(1);
  });

  it('com authorize, não há aviso de authorize', () => {
    const { logger } = setup(() => ({ allow: true, access: 'write' }));

    expect(logger.calls.filter((call) => call.message.includes('authorize'))).toEqual([]);
  });
});

describe('o logger não recebe segredo (R9, R19)', () => {
  it('credencial, cabeçalho e conteúdo marcados não aparecem em nenhuma chamada do logger', async () => {
    const logger = createRecordingLogger();
    const storage = createInstrumentedStorage();
    storage.failNext('load', {
      code: 'STORAGE_UNAVAILABLE',
      message: 'MARCA-ERRO-DO-BANCO conexão recusada em 10.0.0.1',
    } satisfies CollaborationError);
    const server = createCollaborationServer({
      storage,
      logger,
      authorize: (request) => {
        if (request.sessionId === 'quebra') throw new Error('MARCA-EXCECAO-DO-HOOK');
        return { allow: true, access: 'write' };
      },
    });
    const headers = new Headers({
      authorization: 'Bearer MARCA-CABECALHO',
      cookie: 'sessao=MARCA-COOKIE',
      origin: 'http://MARCA-ORIGEM.test',
    });

    connect(server, hello({ credentials: { token: 'MARCA-CREDENCIAL' } }), { headers });
    connect(server, hello({ sessionId: 'quebra', credentials: { token: 'MARCA-CREDENCIAL' } }), {
      headers,
    });
    await settle();

    expect(logger.calls.length).toBeGreaterThan(0);
    expect(logger.dump()).not.toContain('MARCA');
  });
});
