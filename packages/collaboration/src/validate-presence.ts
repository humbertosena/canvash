import { DEFAULT_LIMITS } from '@canvash/core';
import { err, ok, type Result } from './errors.js';
import { MAX_PRESENCE_IDS, MAX_PRESENCE_NAME_LENGTH } from './limits.js';
import type { PresenceUpdate, PresenceViolation, PresenceViolationReason } from './types.js';

/** Presença aceita: a atualização do usuário mais os campos de identidade da rede. */
export interface ValidatedPresence extends PresenceUpdate {
  readonly sessionId?: string;
  readonly userId?: string;
  readonly updatedAt?: number;
}

export interface ValidatePresenceOptions {
  /** Maior valor absoluto aceito em coordenadas e deslocamentos. Padrão: o do core. */
  readonly maxCoordinate?: number;
  /** Origem da página, que libera `avatarUrl` em `http:` da mesma origem. */
  readonly origin?: string;
}

const KNOWN_FIELDS = new Set([
  'sessionId',
  'userId',
  'updatedAt',
  'cursor',
  'selection',
  'userName',
  'color',
  'selectedAt',
  'drag',
  'view',
  'avatarUrl',
]);

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fail = (reason: PresenceViolationReason, field: string): PresenceViolation => ({
  reason,
  field,
});

function checkNumber(value: unknown, field: string, limit: number): PresenceViolation | null {
  if (typeof value !== 'number') return fail('INVALID_SHAPE', field);
  if (!Number.isFinite(value)) return fail('NOT_FINITE', field);
  if (Math.abs(value) > limit) return fail('OUT_OF_RANGE', field);
  return null;
}

function checkPoint(value: unknown, field: string, limit: number): PresenceViolation | null {
  if (!isRecord(value)) return fail('INVALID_SHAPE', field);
  return (
    checkNumber(value['x'], `${field}.x`, limit) ?? checkNumber(value['y'], `${field}.y`, limit)
  );
}

function checkIds(value: unknown, field: string): PresenceViolation | null {
  if (!Array.isArray(value)) return fail('INVALID_SHAPE', field);
  if (value.length > MAX_PRESENCE_IDS) return fail('TOO_MANY_IDS', field);
  return value.every((id) => typeof id === 'string') ? null : fail('INVALID_SHAPE', field);
}

function checkAvatarUrl(
  value: unknown,
  field: string,
  origin: string | undefined,
): PresenceViolation | null {
  if (typeof value !== 'string') return fail('INVALID_SHAPE', field);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('INVALID_AVATAR_URL', field);
  }
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:' && origin !== undefined && url.origin === origin) return null;
  if (url.protocol === 'data:' && value.startsWith('data:image/')) return null;
  return fail('INVALID_AVATAR_URL', field);
}

function checkField(
  key: string,
  value: unknown,
  limit: number,
  origin: string | undefined,
): PresenceViolation | null {
  switch (key) {
    case 'sessionId':
    case 'userId':
      return typeof value === 'string' ? null : fail('INVALID_SHAPE', key);
    case 'updatedAt':
    case 'selectedAt':
      if (typeof value !== 'number') return fail('INVALID_SHAPE', key);
      return Number.isFinite(value) ? null : fail('NOT_FINITE', key);
    case 'cursor':
      return value === null ? null : checkPoint(value, key, limit);
    case 'selection':
      return checkIds(value, key);
    case 'userName':
      if (typeof value !== 'string') return fail('INVALID_SHAPE', key);
      return value.length > MAX_PRESENCE_NAME_LENGTH ? fail('NAME_TOO_LONG', key) : null;
    case 'color':
      if (typeof value !== 'string') return fail('INVALID_SHAPE', key);
      return HEX_COLOR.test(value) ? null : fail('INVALID_COLOR', key);
    case 'drag':
      if (value === null) return null;
      if (!isRecord(value)) return fail('INVALID_SHAPE', key);
      return (
        checkIds(value['ids'], 'drag.ids') ??
        checkNumber(value['dx'], 'drag.dx', limit) ??
        checkNumber(value['dy'], 'drag.dy', limit)
      );
    case 'view': {
      if (value === null) return null;
      if (!isRecord(value)) return fail('INVALID_SHAPE', key);
      const point = checkPoint(value['center'], 'view.center', limit);
      if (point) return point;
      const zoom = value['zoom'];
      if (typeof zoom !== 'number') return fail('INVALID_SHAPE', 'view.zoom');
      if (!Number.isFinite(zoom)) return fail('NOT_FINITE', 'view.zoom');
      return zoom > 0 ? null : fail('OUT_OF_RANGE', 'view.zoom');
    }
    default:
      return checkAvatarUrl(value, key, origin);
  }
}

/**
 * Confere uma presença que veio da rede (ou do host) antes de aceitá-la. É tudo ou nada: a
 * primeira regra violada descarta a presença inteira, com o motivo e o campo. Função pura.
 */
export function validatePresence(
  value: unknown,
  options: ValidatePresenceOptions = {},
): Result<ValidatedPresence, PresenceViolation> {
  if (!isRecord(value)) return err(fail('INVALID_SHAPE', '(raiz)'));
  const limit = options.maxCoordinate ?? DEFAULT_LIMITS.maxCoordinate;
  for (const [key, field] of Object.entries(value)) {
    if (!KNOWN_FIELDS.has(key)) return err(fail('UNKNOWN_FIELD', key));
    // Campo opcional ausente, mesmo escrito como `undefined`, vale como ausente.
    if (field === undefined) continue;
    const violation = checkField(key, field, limit, options.origin);
    if (violation) return err(violation);
  }
  return ok(value as ValidatedPresence);
}
