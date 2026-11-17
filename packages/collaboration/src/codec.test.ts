import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
} from './codec.js';
import type { CollaborationError, Result } from './errors.js';
import {
  DEFAULT_MAX_FRAME_BYTES,
  MAX_FRAME_HEADER_BYTES,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from './protocol.js';

const MIB = 1024 * 1024;

function bytes(length: number, seed = 7): Uint8Array {
  const out = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) out[index] = (index * 31 + seed) & 0xff;
  return out;
}

const PAYLOADS: ReadonlyArray<[string, Uint8Array]> = [
  ['vazio', new Uint8Array()],
  ['pequeno', bytes(17)],
  ['de 1 MiB', bytes(MIB)],
];

const RECEIPT = { commitId: 'c-1', roomEpoch: 'e1', timestamp: 1_700_000_000_000, durable: true };

function clientMessages(payload: Uint8Array): ClientMessage[] {
  return [
    {
      t: 'hello',
      v: PROTOCOL_VERSION,
      provider: 'yjs',
      documentId: 'doc-1',
      sessionId: 'sess-1',
      roomEpoch: 'e1',
      credentials: { token: 'abc', papel: 'editor' },
      syncState: payload,
    },
    { t: 'hello', v: 1, provider: 'yjs', documentId: 'd', sessionId: 's', syncState: payload },
    { t: 'commit', id: 3, commitId: 'c-1', roomEpoch: 'e1', update: payload },
    { t: 'sync', id: 4, syncState: payload },
  ];
}

function serverMessages(payload: Uint8Array): ServerMessage[] {
  return [
    {
      t: 'welcome',
      v: PROTOCOL_VERSION,
      roomEpoch: 'e1',
      access: 'write',
      missing: payload,
      serverSyncState: bytes(9, 3),
      serverTime: 1_700_000_000_123,
      user: { id: 'u-1', name: 'Ana' },
    },
    {
      t: 'welcome',
      v: 1,
      roomEpoch: 'e1',
      access: 'read',
      missing: bytes(5),
      serverSyncState: payload,
      serverTime: 0,
    },
    { t: 'synced', id: 4, missing: payload },
    { t: 'update', commitId: 'c-1', from: 'sess-2', update: payload },
  ];
}

const CLIENT_WITHOUT_BINARY: ClientMessage[] = [
  { t: 'presence', state: { sessionId: 's', cursor: { x: 1, y: 2 }, selection: ['a'] } },
  { t: 'presence', state: null },
  { t: 'bye' },
];

const SERVER_WITHOUT_BINARY: ServerMessage[] = [
  { t: 'ack', id: 3, receipt: RECEIPT },
  { t: 'presence', from: 'sess-2', state: { sessionId: 'sess-2', cursor: null } },
  { t: 'presence', from: 'sess-2', state: null },
  {
    t: 'error',
    id: 3,
    code: 'LIMIT_EXCEEDED',
    message: 'grande demais',
    fatal: false,
    details: { reason: 'commit', limit: 10 },
  },
  { t: 'error', code: 'UNSUPPORTED_VERSION', message: 'versão', fatal: true },
];

/** Monta um quadro à mão: cabeçalho como texto (ou objeto) e payload. */
function frameOf(header: unknown, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const text = typeof header === 'string' ? header : JSON.stringify(header);
  const head = new TextEncoder().encode(text);
  const frame = new Uint8Array(4 + head.byteLength + payload.byteLength);
  new DataView(frame.buffer).setUint32(0, head.byteLength, false);
  frame.set(head, 4);
  frame.set(payload, 4 + head.byteLength);
  return frame;
}

/**
 * Confere a mensagem decodificada contra a original. Os campos binários são comparados de forma
 * nativa: a igualdade profunda do executor percorre um array de 1 MiB elemento a elemento.
 */
function expectSameMessage(
  decoded: Result<{ readonly t: string }, CollaborationError>,
  message: { readonly t: string },
): void {
  if (!decoded.ok) throw new Error(`recusado: ${JSON.stringify(decoded.error.details)}`);
  const actual = decoded.value as Readonly<Record<string, unknown>>;
  const expected = message as Readonly<Record<string, unknown>>;
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const key of Object.keys(expected)) {
    const want = expected[key];
    const got = actual[key];
    if (want instanceof Uint8Array) {
      expect(got).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(got as Uint8Array).equals(Buffer.from(want)), key).toBe(true);
    } else {
      expect(got, key).toEqual(want);
    }
  }
}

function reasonOf(result: Result<unknown, CollaborationError>): unknown {
  if (result.ok) return 'ok';
  expect(result.error.code).toBe('PROTOCOL_ERROR');
  return (result.error.details as { reason?: unknown }).reason;
}

describe('codec: ida e volta (US-P.1)', () => {
  it.each(PAYLOADS)('mensagens do cliente com payload %s', (_name, payload) => {
    for (const message of clientMessages(payload)) {
      expectSameMessage(decodeClientMessage(encodeClientMessage(message)), message);
    }
  });

  it.each(PAYLOADS)('mensagens do servidor com payload %s', (_name, payload) => {
    for (const message of serverMessages(payload)) {
      expectSameMessage(decodeServerMessage(encodeServerMessage(message)), message);
    }
  });

  it('mensagens sem campo binário', () => {
    for (const message of CLIENT_WITHOUT_BINARY) {
      const decoded = decodeClientMessage(encodeClientMessage(message));
      expect(decoded.ok && decoded.value).toEqual(message);
    }
    for (const message of SERVER_WITHOUT_BINARY) {
      const decoded = decodeServerMessage(encodeServerMessage(message));
      expect(decoded.ok && decoded.value).toEqual(message);
    }
  });

  it('o welcome leva dois campos binários de tamanhos diferentes, inclusive vazios', () => {
    const cases: Array<[Uint8Array, Uint8Array]> = [
      [bytes(100), bytes(7, 1)],
      [new Uint8Array(), bytes(7, 1)],
      [bytes(100), new Uint8Array()],
      [new Uint8Array(), new Uint8Array()],
    ];
    for (const [missing, serverSyncState] of cases) {
      const message: ServerMessage = {
        t: 'welcome',
        v: 1,
        roomEpoch: 'e1',
        access: 'write',
        missing,
        serverSyncState,
        serverTime: 5,
      };
      const decoded = decodeServerMessage(encodeServerMessage(message));
      expect(decoded.ok && decoded.value).toEqual(message);
    }
  });

  it('campo opcional ausente continua ausente, sem virar undefined', () => {
    const decoded = decodeClientMessage(
      encodeClientMessage({
        t: 'hello',
        v: 1,
        provider: 'yjs',
        documentId: 'd',
        sessionId: 's',
        syncState: new Uint8Array(),
      }),
    );

    expect(decoded.ok && Object.keys(decoded.value).sort()).toEqual([
      'documentId',
      'provider',
      'sessionId',
      'syncState',
      't',
      'v',
    ]);
  });

  it('o quadro é [u32 big-endian][cabeçalho JSON][payload], sem base64', () => {
    const update = bytes(10);
    const frame = encodeClientMessage({
      t: 'commit',
      id: 1,
      commitId: 'c',
      roomEpoch: 'e',
      update,
    });

    const headerLength = new DataView(frame.buffer).getUint32(0, false);
    const header = JSON.parse(
      new TextDecoder().decode(frame.subarray(4, 4 + headerLength)),
    ) as Record<string, unknown>;

    expect(header).toEqual({ t: 'commit', id: 1, commitId: 'c', roomEpoch: 'e', bin: [10] });
    expect(frame.subarray(4 + headerLength)).toEqual(update);
    expect(frame.byteLength).toBe(4 + headerLength + 10);
  });

  it('o que sai da decodificação é cópia: mexer no quadro depois não muda a mensagem', () => {
    const frame = encodeServerMessage({
      t: 'update',
      commitId: 'c',
      from: 's',
      update: bytes(8),
    });
    const decoded = decodeServerMessage(frame);
    frame.fill(0);

    expect(decoded.ok && decoded.value.t === 'update' && decoded.value.update).toEqual(bytes(8));
  });
});

describe('codec: recusas com PROTOCOL_ERROR, sem lançar (US-P.1)', () => {
  it('quadro maior que maxFrameBytes é recusado antes de ler o cabeçalho', () => {
    const big = new Uint8Array(33 * MIB);

    expect(reasonOf(decodeClientMessage(big))).toBe('frame_too_large');
    expect(reasonOf(decodeServerMessage(big))).toBe('frame_too_large');
    expect(reasonOf(decodeClientMessage(bytes(200), { maxFrameBytes: 100 }))).toBe(
      'frame_too_large',
    );
    expect(DEFAULT_MAX_FRAME_BYTES).toBe(32 * MIB);
  });

  it('quadro que cabe exatamente no limite é aceito', () => {
    const frame = encodeClientMessage({ t: 'bye' });

    expect(decodeClientMessage(frame, { maxFrameBytes: frame.byteLength }).ok).toBe(true);
    expect(reasonOf(decodeClientMessage(frame, { maxFrameBytes: frame.byteLength - 1 }))).toBe(
      'frame_too_large',
    );
  });

  it('cabeçalho maior que MAX_FRAME_HEADER_BYTES', () => {
    const header = { t: 'presence', state: 'x'.repeat(MAX_FRAME_HEADER_BYTES) };

    expect(reasonOf(decodeClientMessage(frameOf(header)))).toBe('header_too_large');
    expect(MAX_FRAME_HEADER_BYTES).toBe(64 * 1024);
  });

  it('quadro sem os 4 bytes do tamanho, ou com tamanho de cabeçalho além do quadro', () => {
    expect(reasonOf(decodeClientMessage(new Uint8Array()))).toBe('truncated');
    expect(reasonOf(decodeClientMessage(new Uint8Array([0, 0, 0])))).toBe('truncated');
    const beyond = frameOf({ t: 'bye' });
    new DataView(beyond.buffer).setUint32(0, beyond.byteLength, false);
    expect(reasonOf(decodeClientMessage(beyond))).toBe('truncated');
  });

  it.each([
    ['JSON inválido', '{"t":', 'invalid_json'],
    ['UTF-8 inválido', new Uint8Array([0xff, 0xfe]), 'invalid_json'],
    ['array', '[]', 'invalid_header'],
    ['null', 'null', 'invalid_header'],
    ['número', '5', 'invalid_header'],
  ])('cabeçalho que não é um objeto JSON: %s', (_name, header, reason) => {
    const frame =
      typeof header === 'string'
        ? frameOf(header)
        : (() => {
            const out = new Uint8Array(4 + header.byteLength);
            new DataView(out.buffer).setUint32(0, header.byteLength, false);
            out.set(header, 4);
            return out;
          })();

    expect(reasonOf(decodeClientMessage(frame))).toBe(reason);
    expect(reasonOf(decodeServerMessage(frame))).toBe(reason);
  });

  it('t desconhecido, ausente ou de outra direção', () => {
    expect(reasonOf(decodeClientMessage(frameOf({ t: 'explodir' })))).toBe('unknown_type');
    expect(reasonOf(decodeClientMessage(frameOf({})))).toBe('unknown_type');
    expect(reasonOf(decodeClientMessage(frameOf({ t: 5 })))).toBe('unknown_type');
    // `ack` só existe do servidor para o cliente, e `bye`, do cliente para o servidor.
    expect(reasonOf(decodeClientMessage(frameOf({ t: 'ack', id: 1, receipt: RECEIPT })))).toBe(
      'unknown_type',
    );
    expect(reasonOf(decodeServerMessage(frameOf({ t: 'bye' })))).toBe('unknown_type');
  });

  it('campo desconhecido', () => {
    const result = decodeClientMessage(frameOf({ t: 'bye', extra: 1 }));

    expect(reasonOf(result)).toBe('unknown_field');
    expect(!result.ok && result.error.details).toEqual({ reason: 'unknown_field', field: 'extra' });
  });

  it('campo obrigatório ausente', () => {
    const commit = decodeClientMessage(frameOf({ t: 'commit', id: 1, roomEpoch: 'e', bin: [0] }));
    const presence = decodeClientMessage(frameOf({ t: 'presence' }));
    const error = decodeServerMessage(frameOf({ t: 'error', code: 'NOT_FOUND', message: 'm' }));

    expect(!commit.ok && commit.error.details).toEqual({
      reason: 'missing_field',
      field: 'commitId',
    });
    expect(!presence.ok && presence.error.details).toEqual({
      reason: 'missing_field',
      field: 'state',
    });
    expect(!error.ok && error.error.details).toEqual({ reason: 'missing_field', field: 'fatal' });
  });

  const wrongTypes: Array<[string, 'client' | 'server', Record<string, unknown>, string]> = [
    [
      'v texto',
      'client',
      { t: 'hello', v: '1', provider: 'yjs', documentId: 'd', sessionId: 's', bin: [0] },
      'v',
    ],
    [
      'v fracionário',
      'client',
      { t: 'hello', v: 1.5, provider: 'yjs', documentId: 'd', sessionId: 's', bin: [0] },
      'v',
    ],
    [
      'provider número',
      'client',
      { t: 'hello', v: 1, provider: 7, documentId: 'd', sessionId: 's', bin: [0] },
      'provider',
    ],
    [
      'roomEpoch número',
      'client',
      {
        t: 'hello',
        v: 1,
        provider: 'yjs',
        documentId: 'd',
        sessionId: 's',
        roomEpoch: 1,
        bin: [0],
      },
      'roomEpoch',
    ],
    [
      'credentials array',
      'client',
      {
        t: 'hello',
        v: 1,
        provider: 'yjs',
        documentId: 'd',
        sessionId: 's',
        credentials: [],
        bin: [0],
      },
      'credentials',
    ],
    [
      'id negativo',
      'client',
      { t: 'commit', id: -1, commitId: 'c', roomEpoch: 'e', bin: [0] },
      'id',
    ],
    ['id texto', 'client', { t: 'sync', id: 'x', bin: [0] }, 'id'],
    [
      'access inválido',
      'server',
      { t: 'welcome', v: 1, roomEpoch: 'e', access: 'admin', serverTime: 1, bin: [0, 0] },
      'access',
    ],
    [
      'serverTime texto',
      'server',
      { t: 'welcome', v: 1, roomEpoch: 'e', access: 'read', serverTime: 'agora', bin: [0, 0] },
      'serverTime',
    ],
    [
      'user sem id',
      'server',
      {
        t: 'welcome',
        v: 1,
        roomEpoch: 'e',
        access: 'read',
        serverTime: 1,
        user: { name: 'x' },
        bin: [0, 0],
      },
      'user',
    ],
    [
      'user com campo a mais',
      'server',
      {
        t: 'welcome',
        v: 1,
        roomEpoch: 'e',
        access: 'read',
        serverTime: 1,
        user: { id: 'u', admin: true },
        bin: [0, 0],
      },
      'user',
    ],
    ['recibo incompleto', 'server', { t: 'ack', id: 1, receipt: { commitId: 'c' } }, 'receipt'],
    [
      'recibo com durable texto',
      'server',
      { t: 'ack', id: 1, receipt: { ...RECEIPT, durable: 'sim' } },
      'receipt',
    ],
    ['from número', 'server', { t: 'presence', from: 1, state: null }, 'from'],
    [
      'código de erro desconhecido',
      'server',
      { t: 'error', code: 'EXPLODIU', message: 'm', fatal: true },
      'code',
    ],
    [
      'fatal texto',
      'server',
      { t: 'error', code: 'NOT_FOUND', message: 'm', fatal: 'sim' },
      'fatal',
    ],
    [
      'message número',
      'server',
      { t: 'error', code: 'NOT_FOUND', message: 5, fatal: true },
      'message',
    ],
  ];

  it.each(wrongTypes)('campo de tipo errado: %s', (_name, side, header, field) => {
    const frame = frameOf(header);
    const result = side === 'client' ? decodeClientMessage(frame) : decodeServerMessage(frame);

    expect(!result.ok && result.error.details).toEqual({ reason: 'invalid_field', field });
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'chave %s em qualquer nível do cabeçalho',
    (key) => {
      const top = frameOf(`{"t":"bye","${key}":1}`);
      const inState = frameOf(`{"t":"presence","state":{"a":{"${key}":1}}}`);
      const inArray = frameOf(`{"t":"presence","state":[{"${key}":1}]}`);
      const inCredentials = frameOf(
        `{"t":"hello","v":1,"provider":"yjs","documentId":"d","sessionId":"s","credentials":{"${key}":"x"},"bin":[0]}`,
      );
      const inDetails = frameOf(
        `{"t":"error","code":"NOT_FOUND","message":"m","fatal":true,"details":{"${key}":1}}`,
      );

      expect(reasonOf(decodeClientMessage(top))).toBe('forbidden_key');
      expect(reasonOf(decodeClientMessage(inState))).toBe('forbidden_key');
      expect(reasonOf(decodeClientMessage(inArray))).toBe('forbidden_key');
      expect(reasonOf(decodeClientMessage(inCredentials))).toBe('forbidden_key');
      expect(reasonOf(decodeServerMessage(inDetails))).toBe('forbidden_key');
    },
  );

  it('bin presente em mensagem sem campo binário, ou payload sobrando nela', () => {
    expect(reasonOf(decodeClientMessage(frameOf({ t: 'bye', bin: [] })))).toBe('invalid_bin');
    expect(reasonOf(decodeClientMessage(frameOf({ t: 'bye' }, bytes(3))))).toBe('payload_mismatch');
  });

  it('bin ausente, de tamanho errado ou com valor que não é inteiro não negativo', () => {
    const base = { t: 'sync', id: 1 };

    expect(reasonOf(decodeClientMessage(frameOf(base)))).toBe('invalid_bin');
    expect(reasonOf(decodeClientMessage(frameOf({ ...base, bin: 'x' })))).toBe('invalid_bin');
    expect(reasonOf(decodeClientMessage(frameOf({ ...base, bin: [] })))).toBe('invalid_bin');
    expect(reasonOf(decodeClientMessage(frameOf({ ...base, bin: [0, 0] })))).toBe('invalid_bin');
    expect(reasonOf(decodeClientMessage(frameOf({ ...base, bin: [-1] })))).toBe('invalid_bin');
    expect(reasonOf(decodeClientMessage(frameOf({ ...base, bin: [1.5] })))).toBe('invalid_bin');
    expect(reasonOf(decodeClientMessage(frameOf({ ...base, bin: ['3'] })))).toBe('invalid_bin');
  });

  it('soma dos tamanhos diferente do payload', () => {
    const header = {
      t: 'welcome',
      v: 1,
      roomEpoch: 'e',
      access: 'read',
      serverTime: 1,
      bin: [2, 2],
    };

    expect(reasonOf(decodeServerMessage(frameOf(header, bytes(3))))).toBe('payload_mismatch');
    expect(reasonOf(decodeServerMessage(frameOf(header, bytes(5))))).toBe('payload_mismatch');
    expect(decodeServerMessage(frameOf(header, bytes(4))).ok).toBe(true);
  });

  it('quadro truncado em cada posição nunca lança e nunca é aceito', () => {
    const frames = [
      encodeClientMessage(clientMessages(bytes(40))[0] as ClientMessage),
      encodeClientMessage({ t: 'commit', id: 1, commitId: 'c', roomEpoch: 'e', update: bytes(40) }),
      encodeServerMessage(serverMessages(bytes(40))[0] as ServerMessage),
    ];
    for (const frame of frames) {
      for (let length = 0; length < frame.byteLength; length += 1) {
        const cut = frame.slice(0, length);
        const client = decodeClientMessage(cut);
        const server = decodeServerMessage(cut);
        expect(client.ok || server.ok).toBe(false);
      }
    }
  });

  it('bytes quaisquer nunca fazem a decodificação lançar', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (frame) => {
        const client = decodeClientMessage(frame);
        const server = decodeServerMessage(frame);
        return typeof client.ok === 'boolean' && typeof server.ok === 'boolean';
      }),
      { numRuns: 300 },
    );
  });

  it('cabeçalho JSON qualquer, com payload qualquer, nunca faz a decodificação lançar', () => {
    fc.assert(
      fc.property(fc.json(), fc.uint8Array({ maxLength: 40 }), (header, payload) => {
        const frame = frameOf(header, payload);
        return (
          typeof decodeClientMessage(frame).ok === 'boolean' &&
          typeof decodeServerMessage(frame).ok === 'boolean'
        );
      }),
      { numRuns: 300 },
    );
  });
});
