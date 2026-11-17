import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeFrameFromText, encodeFrameAsText } from './codec-text.js';
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
} from './codec.js';
import type { CollaborationError, Result } from './errors.js';
import type { ClientMessage, ServerMessage } from './protocol.js';

function bytes(length: number, seed = 7): Uint8Array {
  const out = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) out[index] = (index * 31 + seed) & 0xff;
  return out;
}

function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function reasonOf(result: Result<unknown, CollaborationError>): unknown {
  if (result.ok) return 'ok';
  expect(result.error.code).toBe('PROTOCOL_ERROR');
  return (result.error.details as { reason?: unknown }).reason;
}

const CLIENT: ClientMessage[] = [
  {
    t: 'hello',
    v: 1,
    provider: 'yjs',
    documentId: 'doc-1',
    sessionId: 'sess-1',
    roomEpoch: 'e1',
    credentials: { token: 'abc' },
    syncState: bytes(33),
  },
  { t: 'commit', id: 1, commitId: 'c-1', roomEpoch: 'e1', update: bytes(1_000) },
  { t: 'sync', id: 2, syncState: new Uint8Array() },
  { t: 'presence', state: { cursor: { x: 1, y: 2 }, nome: 'Ação' } },
  { t: 'bye' },
];

const SERVER: ServerMessage[] = [
  {
    t: 'welcome',
    v: 1,
    roomEpoch: 'e1',
    access: 'write',
    missing: bytes(500),
    serverSyncState: bytes(9, 3),
    serverTime: 1_700_000_000_000,
    user: { id: 'u-1', name: 'Ana' },
  },
  { t: 'ack', id: 1, receipt: { commitId: 'c-1', roomEpoch: 'e1', timestamp: 1, durable: true } },
  { t: 'synced', id: 2, missing: bytes(64) },
  { t: 'update', commitId: 'c-1', from: 'sess-2', update: bytes(257) },
  { t: 'presence', from: 'sess-2', state: null },
  { t: 'error', code: 'STORAGE_UNAVAILABLE', message: 'tente de novo', fatal: false, id: 1 },
];

describe('codificação do quadro em texto (US-P.7, R15)', () => {
  it('ida e volta de cada mensagem do cliente pelo texto', () => {
    for (const message of CLIENT) {
      const text = encodeFrameAsText(encodeClientMessage(message));
      const frame = decodeFrameFromText(text);
      if (!frame.ok) throw new Error('texto recusado');
      const decoded = decodeClientMessage(frame.value);
      expect(decoded.ok && decoded.value).toEqual(message);
    }
  });

  it('ida e volta de cada mensagem do servidor pelo texto', () => {
    for (const message of SERVER) {
      const text = encodeFrameAsText(encodeServerMessage(message));
      const frame = decodeFrameFromText(text);
      if (!frame.ok) throw new Error('texto recusado');
      const decoded = decodeServerMessage(frame.value);
      expect(decoded.ok && decoded.value).toEqual(message);
    }
  });

  it('é o base64 padrão da RFC 4648, com preenchimento', () => {
    const vectors: Array<[string, string]> = [
      ['', ''],
      ['f', 'Zg=='],
      ['fo', 'Zm8='],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg=='],
      ['fooba', 'Zm9vYmE='],
      ['foobar', 'Zm9vYmFy'],
    ];
    for (const [plain, encoded] of vectors) {
      expect(encodeFrameAsText(ascii(plain))).toBe(encoded);
      const decoded = decodeFrameFromText(encoded);
      expect(decoded.ok && decoded.value).toEqual(ascii(plain));
    }
    // Os dois últimos símbolos do alfabeto padrão são + e /, não - e _.
    expect(encodeFrameAsText(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('+//+');
  });

  it('dá o mesmo texto que o Buffer do Node, de 0 a 20 bytes e com 1 MiB', () => {
    for (let length = 0; length <= 20; length += 1) {
      const frame = bytes(length, length);
      expect(encodeFrameAsText(frame)).toBe(Buffer.from(frame).toString('base64'));
    }
    const large = bytes(1024 * 1024);
    const text = encodeFrameAsText(large);
    expect(text === Buffer.from(large).toString('base64')).toBe(true);
    const back = decodeFrameFromText(text);
    expect(back.ok && Buffer.from(back.value).equals(Buffer.from(large))).toBe(true);
  });

  it('o texto não tem quebra de linha nem caractere fora do alfabeto', () => {
    const text = encodeFrameAsText(bytes(4_000));

    expect(text).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
    expect(text).not.toContain('\n');
  });

  it('qualquer sequência de bytes volta igual', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (frame) => {
        const decoded = decodeFrameFromText(encodeFrameAsText(frame));
        return decoded.ok && Buffer.from(decoded.value).equals(Buffer.from(frame));
      }),
      { numRuns: 300 },
    );
  });
});

describe('codificação em texto: recusas com PROTOCOL_ERROR, sem lançar', () => {
  it.each([
    ['caractere fora do alfabeto', 'Zm9*'],
    ['alfabeto de URL', 'Zm9-'],
    ['sublinhado', 'Zm9_'],
    ['espaço', 'Zm9 '],
    ['quebra de linha', 'Zm9v\nZm9v'],
    ['caractere não ASCII', 'Zm9ç'],
    ['tamanho que não é múltiplo de 4', 'Zm9vY'],
    ['um caractere só', 'Z'],
    ['preenchimento no meio', 'Zg==Zm9v'],
    ['três sinais de igual', 'Z==='],
    ['só preenchimento', '===='],
    ['igual antes de um símbolo', 'Zm=v'],
    ['bits sobrando depois de um byte', 'Zh=='],
    ['bits sobrando depois de dois bytes', 'Zm9='],
  ])('%s', (_name, text) => {
    expect(reasonOf(decodeFrameFromText(text))).toBe('invalid_text');
  });

  it('texto de quadro acima do limite é recusado antes de decodificar', () => {
    const frame = bytes(300);
    const text = encodeFrameAsText(frame);

    expect(reasonOf(decodeFrameFromText(text, { maxFrameBytes: 299 }))).toBe('frame_too_large');
    expect(decodeFrameFromText(text, { maxFrameBytes: 300 }).ok).toBe(true);
    // Um texto enorme e inválido é recusado pelo tamanho, sem ser percorrido.
    const huge = '*'.repeat(8 * 1024 * 1024);
    expect(reasonOf(decodeFrameFromText(huge, { maxFrameBytes: 1024 }))).toBe('frame_too_large');
  });

  it('o limite padrão é o do quadro binário: 32 MiB', () => {
    const justOver = 'A'.repeat(Math.ceil((32 * 1024 * 1024 + 3) / 3) * 4);

    expect(reasonOf(decodeFrameFromText(justOver))).toBe('frame_too_large');
  });

  it('texto qualquer nunca faz a decodificação lançar', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        return typeof decodeFrameFromText(text).ok === 'boolean';
      }),
      { numRuns: 300 },
    );
  });
});
