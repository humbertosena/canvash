import type { DecodeOptions } from './codec.js';
import {
  createCollaborationError,
  err,
  ok,
  type CollaborationError,
  type Result,
} from './errors.js';
import { DEFAULT_MAX_FRAME_BYTES } from './protocol.js';

/**
 * O quadro binário do protocolo em texto, para meios que só levam texto, como SSE: base64 padrão
 * (RFC 4648 §4, com `=`), sem quebra de linha. É uma tradução do quadro inteiro, sem perda: o que
 * sai de `decodeFrameFromText` segue para `decodeClientMessage` ou `decodeServerMessage`.
 *
 * TypeScript puro, sem `Buffer`, `atob` ou `btoa`: roda igual no Node e no navegador.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const PAD = 61; // '='

const ENCODE = new Uint8Array(64);
/** Código do caractere → valor de 6 bits; -1 para o que está fora do alfabeto. */
const DECODE = new Int8Array(128).fill(-1);
for (let index = 0; index < ALPHABET.length; index += 1) {
  const code = ALPHABET.charCodeAt(index);
  ENCODE[index] = code;
  DECODE[code] = index;
}

function refuse(reason: string): Result<never, CollaborationError> {
  return err(createCollaborationError('PROTOCOL_ERROR', `Texto recusado: ${reason}`, { reason }));
}

export function encodeFrameAsText(frame: Uint8Array): string {
  const full = Math.floor(frame.byteLength / 3);
  const rest = frame.byteLength - full * 3;
  const out = new Uint8Array((full + (rest > 0 ? 1 : 0)) * 4);
  const symbol = (bits: number): number => ENCODE[bits & 63] ?? PAD;
  let read = 0;
  let write = 0;
  for (let group = 0; group < full; group += 1) {
    const chunk =
      ((frame[read] ?? 0) << 16) | ((frame[read + 1] ?? 0) << 8) | (frame[read + 2] ?? 0);
    out[write] = symbol(chunk >> 18);
    out[write + 1] = symbol(chunk >> 12);
    out[write + 2] = symbol(chunk >> 6);
    out[write + 3] = symbol(chunk);
    read += 3;
    write += 4;
  }
  if (rest === 1) {
    const chunk = (frame[read] ?? 0) << 16;
    out[write] = symbol(chunk >> 18);
    out[write + 1] = symbol(chunk >> 12);
    out[write + 2] = PAD;
    out[write + 3] = PAD;
  } else if (rest === 2) {
    const chunk = ((frame[read] ?? 0) << 16) | ((frame[read + 1] ?? 0) << 8);
    out[write] = symbol(chunk >> 18);
    out[write + 1] = symbol(chunk >> 12);
    out[write + 2] = symbol(chunk >> 6);
    out[write + 3] = PAD;
  }
  // Só há caracteres ASCII: decodificá-los como UTF-8 dá a mesma sequência.
  return new TextDecoder().decode(out);
}

/**
 * Volta do texto ao quadro. Nunca lança: recusa com `PROTOCOL_ERROR` o texto cujo tamanho já
 * indica um quadro acima de `maxFrameBytes` (antes de decodificar), o caractere fora do alfabeto
 * e o preenchimento errado. Só aceita a forma canônica: cada quadro tem um texto só.
 */
export function decodeFrameFromText(
  text: string,
  options: DecodeOptions = {},
): Result<Uint8Array, CollaborationError> {
  const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  // O maior texto que um quadro dentro do limite pode produzir.
  if (text.length > Math.ceil(maxFrameBytes / 3) * 4) return refuse('frame_too_large');
  if (text.length % 4 !== 0) return refuse('invalid_text');
  if (text.length === 0) return ok(new Uint8Array());

  let padding = 0;
  if (text.charCodeAt(text.length - 1) === PAD) padding += 1;
  if (text.charCodeAt(text.length - 2) === PAD) padding += 1;
  const byteLength = (text.length / 4) * 3 - padding;
  if (byteLength > maxFrameBytes) return refuse('frame_too_large');

  const sextet = (index: number): number => {
    const code = text.charCodeAt(index);
    return code < 128 ? (DECODE[code] ?? -1) : -1;
  };
  const out = new Uint8Array(byteLength);
  const groups = text.length / 4;
  let write = 0;
  for (let group = 0; group < groups; group += 1) {
    const at = group * 4;
    const last = group === groups - 1;
    const a = sextet(at);
    const b = sextet(at + 1);
    const c = last && padding === 2 ? 0 : sextet(at + 2);
    const d = last && padding >= 1 ? 0 : sextet(at + 3);
    if (a < 0 || b < 0 || c < 0 || d < 0) return refuse('invalid_text');
    const chunk = (a << 18) | (b << 12) | (c << 6) | d;
    if (last && padding === 2) {
      // Um byte só: os 4 bits baixos do segundo símbolo têm de ser zero.
      if ((b & 15) !== 0) return refuse('invalid_text');
      out[write] = chunk >> 16;
      write += 1;
    } else if (last && padding === 1) {
      // Dois bytes: os 2 bits baixos do terceiro símbolo têm de ser zero.
      if ((c & 3) !== 0) return refuse('invalid_text');
      out[write] = chunk >> 16;
      out[write + 1] = (chunk >> 8) & 255;
      write += 2;
    } else {
      out[write] = chunk >> 16;
      out[write + 1] = (chunk >> 8) & 255;
      out[write + 2] = chunk & 255;
      write += 3;
    }
  }
  return ok(out);
}
