import {
  at,
  finite,
  isFull,
  isRecord,
  items,
  rejectUnknownKeys,
  report,
  RESERVED_KEY,
  type Path,
} from './checks.js';
import { deepFreeze } from './freeze.js';
import type { Point } from './shapes.js';
import type { CanvasLimits } from './limits.js';
import { fail, ok, validationError, type Result, type ValidationIssue } from './result.js';

/** Quantos participantes remotos o canvas guarda de uma vez. */
export const MAX_PEERS = 256;
/** Quantos IDs cabem em `selection`, `drag.ids`, `locks` e `released` de um participante. */
export const MAX_PEER_IDS = 1000;
/** Tamanho máximo do nome mostrado de um participante. */
export const MAX_PEER_NAME_LENGTH = 64;

/** Arrasto de mover de um participante: nós e deslocamento em mundo desde o início do gesto. */
export interface CanvasPeerDrag {
  readonly ids: readonly string[];
  readonly dx: number;
  readonly dy: number;
}

/** Enquadramento de um participante: centro do viewport em mundo e zoom. */
export interface CanvasPeerView {
  readonly center: Point;
  readonly zoom: number;
}

/**
 * Participante remoto da sessão, como o canvas o enxerga. É estado efêmero: não entra no
 * documento, no histórico nem na exportação.
 */
export interface CanvasPeer {
  /** Chave estável do participante. O core não a trata como identidade de usuário. */
  readonly sessionId: string;
  readonly name: string;
  /** Cor `#rrggbb`. */
  readonly color: string;
  readonly avatarUrl?: string;
  /** Posição do ponteiro em mundo, ou `null` fora do canvas. */
  readonly cursor: Point | null;
  readonly selection: readonly string[];
  /** Quando a seleção atual começou, no relógio do participante; só desempata bloqueios. */
  readonly selectedAt: number | null;
  readonly drag: CanvasPeerDrag | null;
  readonly view: CanvasPeerView | null;
  /** IDs que este participante detém como bloqueio depois do desempate. */
  readonly locks: readonly string[];
  /**
   * Descendentes de um board em `locks` que outro participante venceu na disputa: o bloqueio do
   * board não vale para eles. Só traz os disputados, então não cresce com o tamanho do board.
   */
  readonly released?: readonly string[];
  /** Este é o participante que a sessão local segue. */
  readonly followed: boolean;
}

/** Quem detém o bloqueio de um nó, como `CanvasSectionApi.getPeerLock` o devolve. */
export interface PeerLock {
  readonly sessionId: string;
  readonly name: string;
  readonly color: string;
}

export const NO_PEERS: readonly CanvasPeer[] = Object.freeze([]);

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const PEER_KEYS = [
  'sessionId',
  'name',
  'color',
  'avatarUrl',
  'cursor',
  'selection',
  'selectedAt',
  'drag',
  'view',
  'locks',
  'released',
  'followed',
] as const;

type Limit = number;

function readPoint(value: unknown, path: Path, issues: ValidationIssue[], max: Limit): Point {
  if (!isRecord(value)) {
    report(issues, path, 'type', 'must be an object');
    return { x: 0, y: 0 };
  }
  rejectUnknownKeys(value, ['x', 'y'], path, issues);
  const x = finite(value['x'], at(path, 'x'), issues);
  const y = finite(value['y'], at(path, 'y'), issues);
  if (Math.abs(x) > max) report(issues, at(path, 'x'), 'range', `must be within ±${max}`);
  if (Math.abs(y) > max) report(issues, at(path, 'y'), 'range', `must be within ±${max}`);
  return { x, y };
}

function readIds(value: unknown, path: Path, issues: ValidationIssue[]): string[] {
  if (!Array.isArray(value)) {
    report(issues, path, 'type', 'must be an array');
    return [];
  }
  if (value.length > MAX_PEER_IDS) {
    report(issues, path, 'range', `must have at most ${MAX_PEER_IDS} ids`);
    return [];
  }
  const ids: string[] = [];
  for (const [index, id] of items(value)) {
    if (isFull(issues)) break;
    if (typeof id !== 'string' || id === '' || id === RESERVED_KEY) {
      report(issues, at(path, index), 'type', 'must be a non-empty string');
    } else {
      ids.push(id);
    }
  }
  return ids;
}

function readDrag(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
  max: Limit,
): CanvasPeerDrag | null {
  if (value === null) return null;
  if (!isRecord(value)) {
    report(issues, path, 'type', 'must be an object or null');
    return null;
  }
  rejectUnknownKeys(value, ['ids', 'dx', 'dy'], path, issues);
  const ids = readIds(value['ids'], at(path, 'ids'), issues);
  const dx = finite(value['dx'], at(path, 'dx'), issues);
  const dy = finite(value['dy'], at(path, 'dy'), issues);
  if (Math.abs(dx) > max) report(issues, at(path, 'dx'), 'range', `must be within ±${max}`);
  if (Math.abs(dy) > max) report(issues, at(path, 'dy'), 'range', `must be within ±${max}`);
  return { ids, dx, dy };
}

function readView(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
  max: Limit,
): CanvasPeerView | null {
  if (value === null) return null;
  if (!isRecord(value)) {
    report(issues, path, 'type', 'must be an object or null');
    return null;
  }
  rejectUnknownKeys(value, ['center', 'zoom'], path, issues);
  const center = readPoint(value['center'], at(path, 'center'), issues, max);
  const zoom = finite(value['zoom'], at(path, 'zoom'), issues);
  if (zoom <= 0) report(issues, at(path, 'zoom'), 'range', 'must be greater than 0');
  return { center, zoom };
}

function readPeer(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
  max: Limit,
): CanvasPeer | undefined {
  if (!isRecord(value)) {
    report(issues, path, 'type', 'must be an object');
    return undefined;
  }
  rejectUnknownKeys(value, PEER_KEYS, path, issues);
  const text = (key: string, maxLength: number): string => {
    const field = value[key];
    if (typeof field !== 'string' || field === '') {
      report(issues, at(path, key), 'type', 'must be a non-empty string');
      return '';
    }
    if (field.length > maxLength) {
      report(issues, at(path, key), 'range', `must have at most ${maxLength} characters`);
    }
    return field;
  };
  const sessionId = text('sessionId', 256);
  const name = text('name', MAX_PEER_NAME_LENGTH);
  const color = text('color', 7);
  if (color !== '' && !HEX_COLOR.test(color)) {
    report(issues, at(path, 'color'), 'format', 'must be a #rrggbb color');
  }
  const avatar = value['avatarUrl'];
  if (avatar !== undefined && typeof avatar !== 'string') {
    report(issues, at(path, 'avatarUrl'), 'type', 'must be a string');
  }
  const cursor =
    value['cursor'] === null ? null : readPoint(value['cursor'], at(path, 'cursor'), issues, max);
  const selection = readIds(value['selection'], at(path, 'selection'), issues);
  const rawSelectedAt = value['selectedAt'];
  const selectedAt =
    rawSelectedAt === null ? null : finite(rawSelectedAt, at(path, 'selectedAt'), issues);
  const drag = readDrag(value['drag'], at(path, 'drag'), issues, max);
  const view = readView(value['view'], at(path, 'view'), issues, max);
  const locks = readIds(value['locks'], at(path, 'locks'), issues);
  const released =
    value['released'] === undefined
      ? undefined
      : readIds(value['released'], at(path, 'released'), issues);
  const followed = value['followed'];
  if (typeof followed !== 'boolean') {
    report(issues, at(path, 'followed'), 'type', 'must be a boolean');
  }
  return {
    sessionId,
    name,
    color,
    ...(typeof avatar === 'string' ? { avatarUrl: avatar } : {}),
    cursor,
    selection,
    selectedAt,
    drag,
    view,
    locks,
    ...(released === undefined ? {} : { released }),
    followed: followed === true,
  };
}

/**
 * Confere a lista de participantes recebida do host e devolve uma cópia congelada. Tudo ou
 * nada: um participante inválido recusa a lista inteira e o estado anterior continua.
 */
export function readPeers(
  input: unknown,
  limits: Required<CanvasLimits>,
): Result<readonly CanvasPeer[]> {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(input)) {
    report(issues, undefined, 'type', 'must be an array');
    return fail(validationError(issues));
  }
  if (input.length > MAX_PEERS) {
    report(issues, undefined, 'range', `must have at most ${MAX_PEERS} peers`);
    return fail(validationError(issues));
  }
  const peers: CanvasPeer[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of items(input)) {
    if (isFull(issues)) break;
    const peer = readPeer(entry, at(undefined, index), issues, limits.maxCoordinate);
    if (peer === undefined) continue;
    if (seen.has(peer.sessionId)) {
      report(issues, at(at(undefined, index), 'sessionId'), 'duplicate-id', 'is already used');
    }
    seen.add(peer.sessionId);
    peers.push(peer);
  }
  if (issues.length > 0) return fail(validationError(issues));
  return ok(deepFreeze(peers));
}
