import { describe, expect, it } from 'vitest';
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
} from './codec.js';
import type { ClientMessage, ServerMessage } from './protocol.js';

/** O codec só usa TextEncoder, TextDecoder e DataView: tem de dar o mesmo resultado no navegador. */
describe('codec no navegador (US-P.7)', () => {
  const payload = Uint8Array.from({ length: 2048 }, (_, index) => index % 251);

  it('ida e volta das mensagens do cliente', () => {
    const messages: ClientMessage[] = [
      {
        t: 'hello',
        v: 1,
        provider: 'yjs',
        documentId: 'doc-1',
        sessionId: 'sess-1',
        credentials: { token: 'abc' },
        syncState: payload,
      },
      { t: 'commit', id: 1, commitId: 'c-1', roomEpoch: 'e1', update: payload },
      { t: 'sync', id: 2, syncState: new Uint8Array() },
      { t: 'presence', state: { cursor: { x: 1, y: 2 }, nome: 'Ação' } },
      { t: 'bye' },
    ];

    for (const message of messages) {
      const decoded = decodeClientMessage(encodeClientMessage(message));
      expect(decoded.ok && decoded.value).toEqual(message);
    }
  });

  it('ida e volta das mensagens do servidor, com os dois campos binários do welcome', () => {
    const messages: ServerMessage[] = [
      {
        t: 'welcome',
        v: 1,
        roomEpoch: 'e1',
        access: 'write',
        missing: payload,
        serverSyncState: payload.subarray(0, 9),
        serverTime: Date.now(),
      },
      {
        t: 'ack',
        id: 1,
        receipt: { commitId: 'c-1', roomEpoch: 'e1', timestamp: 1, durable: true },
      },
      { t: 'update', commitId: 'c-1', from: 'sess-2', update: payload },
      { t: 'error', code: 'PROTOCOL_ERROR', message: 'quadro inválido', fatal: true },
    ];

    for (const message of messages) {
      const decoded = decodeServerMessage(encodeServerMessage(message));
      expect(decoded.ok && decoded.value).toEqual(message);
    }
  });

  it('quadro inválido volta como PROTOCOL_ERROR, sem lançar', () => {
    const result = decodeServerMessage(new Uint8Array([0, 0, 0, 9, 1, 2]));

    expect(!result.ok && result.error.code).toBe('PROTOCOL_ERROR');
  });
});
