import {
  COLLABORATION_ERROR_CODES,
  createCollaborationError,
  err,
  ok,
  type CollaborationError,
  type Result,
} from './errors.js';
import {
  DEFAULT_MAX_FRAME_BYTES,
  MAX_FRAME_HEADER_BYTES,
  type ClientMessage,
  type ServerMessage,
} from './protocol.js';

/**
 * Quadro do protocolo Canvash: `[u32 big-endian: tamanho do cabeçalho][cabeçalho JSON UTF-8]
 * [payload]`. Os campos binários da mensagem vão no payload, concatenados, sem base64; o
 * cabeçalho leva `bin`, o tamanho de cada um, na ordem fixa da mensagem.
 */

const LENGTH_PREFIX_BYTES = 4;

type Check = (value: unknown) => boolean;

interface MessageShape {
  readonly required: Readonly<Record<string, Check>>;
  readonly optional: Readonly<Record<string, Check>>;
  /** Campos binários, na ordem em que entram no payload. */
  readonly binary: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString: Check = (value) => typeof value === 'string';
const isBoolean: Check = (value) => typeof value === 'boolean';
const isFiniteNumber: Check = (value) => typeof value === 'number' && Number.isFinite(value);
const isCount: Check = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isAnything: Check = () => true;
const isAccess: Check = (value) => value === 'write' || value === 'read';
const isErrorCode: Check = (value) =>
  typeof value === 'string' && (COLLABORATION_ERROR_CODES as readonly string[]).includes(value);

/** Objeto com exatamente as chaves dadas: as obrigatórias presentes e nenhuma a mais. */
function isExact(
  value: unknown,
  required: Readonly<Record<string, Check>>,
  optional: Readonly<Record<string, Check>> = {},
): boolean {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    const check = required[key] ?? optional[key];
    if (check === undefined || !check(value[key])) return false;
  }
  return Object.keys(required).every((key) => key in value);
}

const isUser: Check = (value) => isExact(value, { id: isString }, { name: isString });
const isReceipt: Check = (value) =>
  isExact(value, {
    commitId: isString,
    roomEpoch: isString,
    timestamp: isFiniteNumber,
    durable: isBoolean,
  });

const CLIENT_SHAPES: Readonly<Record<string, MessageShape>> = {
  hello: {
    required: { v: isCount, provider: isString, documentId: isString, sessionId: isString },
    optional: { roomEpoch: isString, credentials: isRecord },
    binary: ['syncState'],
  },
  commit: {
    required: { id: isCount, commitId: isString, roomEpoch: isString },
    optional: {},
    binary: ['update'],
  },
  sync: { required: { id: isCount }, optional: {}, binary: ['syncState'] },
  presence: { required: { state: isAnything }, optional: {}, binary: [] },
  bye: { required: {}, optional: {}, binary: [] },
};

const SERVER_SHAPES: Readonly<Record<string, MessageShape>> = {
  welcome: {
    required: { v: isCount, roomEpoch: isString, access: isAccess, serverTime: isFiniteNumber },
    optional: { user: isUser },
    binary: ['missing', 'serverSyncState'],
  },
  ack: { required: { id: isCount, receipt: isReceipt }, optional: {}, binary: [] },
  synced: { required: { id: isCount }, optional: {}, binary: ['missing'] },
  update: { required: { commitId: isString, from: isString }, optional: {}, binary: ['update'] },
  presence: { required: { from: isString, state: isAnything }, optional: {}, binary: [] },
  error: {
    required: { code: isErrorCode, message: isString, fatal: isBoolean },
    optional: { id: isCount, details: isAnything },
    binary: [],
  },
};

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** Acha `__proto__`, `constructor` ou `prototype` como chave, em qualquer nível. */
function hasForbiddenKey(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
    } else if (isRecord(current)) {
      for (const key of Object.keys(current)) {
        if (FORBIDDEN_KEYS.has(key)) return true;
        pending.push(current[key]);
      }
    }
  }
  return false;
}

function refuse(reason: string, field?: string): Result<never, CollaborationError> {
  return err(
    createCollaborationError(
      'PROTOCOL_ERROR',
      `Quadro recusado: ${reason}${field === undefined ? '' : ` (${field})`}`,
      field === undefined ? { reason } : { reason, field },
    ),
  );
}

function encode(message: { readonly t: string }, shapes: Readonly<Record<string, MessageShape>>) {
  const source = message as Readonly<Record<string, unknown>>;
  const binary = shapes[message.t]?.binary ?? [];
  const parts = binary.map((name) => {
    const part = source[name];
    return part instanceof Uint8Array ? part : new Uint8Array();
  });
  const header: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (!binary.includes(key) && source[key] !== undefined) header[key] = source[key];
  }
  if (binary.length > 0) header.bin = parts.map((part) => part.byteLength);

  const head = new TextEncoder().encode(JSON.stringify(header));
  const payloadBytes = parts.reduce((total, part) => total + part.byteLength, 0);
  const frame = new Uint8Array(LENGTH_PREFIX_BYTES + head.byteLength + payloadBytes);
  new DataView(frame.buffer).setUint32(0, head.byteLength, false);
  frame.set(head, LENGTH_PREFIX_BYTES);
  let offset = LENGTH_PREFIX_BYTES + head.byteLength;
  for (const part of parts) {
    frame.set(part, offset);
    offset += part.byteLength;
  }
  return frame;
}

function decode(
  frame: Uint8Array,
  shapes: Readonly<Record<string, MessageShape>>,
  maxFrameBytes: number,
): Result<Record<string, unknown>, CollaborationError> {
  // O tamanho vem antes de tudo: um quadro grande demais não chega a ser lido.
  if (frame.byteLength > maxFrameBytes) return refuse('frame_too_large');
  if (frame.byteLength < LENGTH_PREFIX_BYTES) return refuse('truncated');
  const headerBytes = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(
    0,
    false,
  );
  if (headerBytes > MAX_FRAME_HEADER_BYTES) return refuse('header_too_large');
  if (headerBytes > frame.byteLength - LENGTH_PREFIX_BYTES) return refuse('truncated');

  let header: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      frame.subarray(LENGTH_PREFIX_BYTES, LENGTH_PREFIX_BYTES + headerBytes),
    );
    header = JSON.parse(text);
  } catch {
    return refuse('invalid_json');
  }
  if (!isRecord(header)) return refuse('invalid_header');
  if (hasForbiddenKey(header)) return refuse('forbidden_key');

  const type = header.t;
  const shape = typeof type === 'string' && Object.hasOwn(shapes, type) ? shapes[type] : undefined;
  if (shape === undefined) return refuse('unknown_type');

  for (const key of Object.keys(header)) {
    if (key === 't' || key === 'bin') continue;
    const check = shape.required[key] ?? shape.optional[key];
    if (check === undefined) return refuse('unknown_field', key);
    if (!check(header[key])) return refuse('invalid_field', key);
  }
  for (const key of Object.keys(shape.required)) {
    if (!(key in header)) return refuse('missing_field', key);
  }

  const payload = frame.subarray(LENGTH_PREFIX_BYTES + headerBytes);
  const message: Record<string, unknown> = {};
  for (const key of Object.keys(header)) {
    if (key !== 'bin') message[key] = header[key];
  }

  if (shape.binary.length === 0) {
    if ('bin' in header) return refuse('invalid_bin');
    if (payload.byteLength > 0) return refuse('payload_mismatch');
    return ok(message);
  }

  const sizes = header.bin;
  if (!Array.isArray(sizes) || sizes.length !== shape.binary.length || !sizes.every(isCount)) {
    return refuse('invalid_bin');
  }
  const total = (sizes as number[]).reduce((sum, size) => sum + size, 0);
  if (total !== payload.byteLength) return refuse('payload_mismatch');
  let offset = 0;
  for (const [index, name] of shape.binary.entries()) {
    const size = (sizes as number[])[index] ?? 0;
    // Cópia: a mensagem não fica presa ao buffer do quadro, que o transporte pode reusar.
    message[name] = payload.slice(offset, offset + size);
    offset += size;
  }
  return ok(message);
}

export interface DecodeOptions {
  /** Maior quadro aceito. Padrão: `DEFAULT_MAX_FRAME_BYTES`. */
  readonly maxFrameBytes?: number;
}

export function encodeClientMessage(message: ClientMessage): Uint8Array {
  return encode(message, CLIENT_SHAPES);
}

/** Decodifica um quadro vindo do cliente. Nunca lança: o que não serve volta `PROTOCOL_ERROR`. */
export function decodeClientMessage(
  frame: Uint8Array,
  options: DecodeOptions = {},
): Result<ClientMessage, CollaborationError> {
  const decoded = decode(frame, CLIENT_SHAPES, options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES);
  // A forma foi conferida campo a campo contra CLIENT_SHAPES.
  return decoded.ok ? ok(decoded.value as unknown as ClientMessage) : decoded;
}

export function encodeServerMessage(message: ServerMessage): Uint8Array {
  return encode(message, SERVER_SHAPES);
}

/** Decodifica um quadro vindo do servidor. Nunca lança: o que não serve volta `PROTOCOL_ERROR`. */
export function decodeServerMessage(
  frame: Uint8Array,
  options: DecodeOptions = {},
): Result<ServerMessage, CollaborationError> {
  const decoded = decode(frame, SERVER_SHAPES, options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES);
  // A forma foi conferida campo a campo contra SERVER_SHAPES.
  return decoded.ok ? ok(decoded.value as unknown as ServerMessage) : decoded;
}
