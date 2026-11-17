import { describe, expect, it } from 'vitest';
import { decodeFrameFromText, encodeFrameAsText } from './codec-text.js';
import { decodeServerMessage, encodeServerMessage } from './codec.js';
import type { ServerMessage } from './protocol.js';

/** A codificação em texto é TypeScript puro: tem de bater com o base64 do próprio navegador. */
describe('codificação em texto no navegador (US-P.7, R15)', () => {
  it('dá o mesmo texto que o btoa do navegador', () => {
    const frame = Uint8Array.from({ length: 1_000 }, (_, index) => (index * 7) % 256);

    const expected = btoa(Array.from(frame, (byte) => String.fromCharCode(byte)).join(''));

    expect(encodeFrameAsText(frame)).toBe(expected);
  });

  it('ida e volta de uma mensagem do servidor pelo texto, como num evento SSE', () => {
    const message: ServerMessage = {
      t: 'welcome',
      v: 1,
      roomEpoch: 'e1',
      access: 'write',
      missing: Uint8Array.from({ length: 4_096 }, (_, index) => index % 251),
      serverSyncState: new Uint8Array([1, 2, 3]),
      serverTime: 1_700_000_000_000,
    };

    const text = encodeFrameAsText(encodeServerMessage(message));
    const frame = decodeFrameFromText(text);
    if (!frame.ok) throw new Error('texto recusado');
    const decoded = decodeServerMessage(frame.value);

    expect(decoded.ok && decoded.value).toEqual(message);
  });

  it('texto inválido volta como PROTOCOL_ERROR, sem lançar', () => {
    const result = decodeFrameFromText('não é base64');

    expect(!result.ok && result.error.code).toBe('PROTOCOL_ERROR');
  });
});
