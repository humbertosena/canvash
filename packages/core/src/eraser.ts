import type { Point } from './arrows.js';
import { capsuleInterval } from './geometry/capsule.js';
import type { BoxGeometry } from './geometry/fit.js';
import {
  inkBounds,
  inkStrokesToWorld,
  type InkAppendPatch,
  type InkGeometry,
  type InkStroke,
  type WorldInkStroke,
} from './ink.js';

export type EraserSize = 'thin' | 'medium' | 'thick';

export const ERASER_SIZE_NAMES: readonly EraserSize[] = Object.freeze(['thin', 'medium', 'thick']);

/** Raio da borracha em pixels CSS, por tamanho. O raio em mundo é este valor dividido pelo zoom. */
export const ERASER_RADII: Readonly<Record<EraserSize, number>> = Object.freeze({
  thin: 4,
  medium: 8,
  thick: 16,
});

/** Trecho restante mais curto que isto, em pixels CSS, é descartado em vez de virar um traço. */
export const ERASER_MIN_PIECE_CSS_PX = 0.5;

export interface EraserPass {
  /** Amostras do ponteiro em mundo, em ordem. Uma amostra só apaga um círculo. */
  readonly points: readonly Point[];
  /** Raio em unidades de mundo (pixels CSS ÷ zoom). */
  readonly radius: number;
  /** Trecho restante mais curto que isto, em unidades de mundo, é descartado. Padrão 0. */
  readonly minPieceLength?: number | undefined;
}

type Span = readonly [number, number];

/** O raio de uma borracha em mundo, no zoom dado. */
export function eraserRadiusWorld(size: EraserSize, zoom: number): number {
  return ERASER_RADII[size] / (zoom > 0 ? zoom : 1);
}

/**
 * Trechos de `t` em `[0, 1]` do segmento `a → b` que ficam sob alguma cápsula da passada, unidos e
 * em ordem. A passada é a sequência de cápsulas entre amostras consecutivas (ou um disco, se só
 * há uma amostra).
 */
function coveredSpans(a: Point, b: Point, pass: EraserPass): Span[] {
  const { points, radius } = pass;
  const minX = Math.min(a.x, b.x) - radius;
  const maxX = Math.max(a.x, b.x) + radius;
  const minY = Math.min(a.y, b.y) - radius;
  const maxY = Math.max(a.y, b.y) + radius;
  const spans: Array<[number, number]> = [];
  const count = Math.max(1, points.length - 1);
  for (let index = 0; index < count; index++) {
    const p = points[index];
    const q = points[index + 1] ?? p;
    if (p === undefined || q === undefined) continue;
    // Fora da caixa do segmento alargada pelo raio, a cápsula não toca: pula a conta.
    if (
      Math.max(p.x, q.x) < minX ||
      Math.min(p.x, q.x) > maxX ||
      Math.max(p.y, q.y) < minY ||
      Math.min(p.y, q.y) > maxY
    ) {
      continue;
    }
    const inside = capsuleInterval(a, b, p, q, radius);
    if (inside !== null) spans.push([inside[0], inside[1]]);
  }
  spans.sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  return merged;
}

/** O complemento de `covered` em `[0, 1]`. */
function outsideSpans(covered: readonly Span[]): Span[] {
  const outside: Array<[number, number]> = [];
  let cursor = 0;
  for (const [from, to] of covered) {
    if (from > cursor) outside.push([cursor, from]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < 1) outside.push([cursor, 1]);
  return outside;
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function distanceToPass(point: Point, pass: EraserPass): number {
  const { points } = pass;
  let best = Infinity;
  const count = Math.max(1, points.length - 1);
  for (let index = 0; index < count; index++) {
    const p = points[index];
    const q = points[index + 1] ?? p;
    if (p === undefined || q === undefined) continue;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const lengthSquared = dx * dx + dy * dy;
    const along =
      lengthSquared === 0
        ? 0
        : Math.min(1, Math.max(0, ((point.x - p.x) * dx + (point.y - p.y) * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(point.x - (p.x + along * dx), point.y - (p.y + along * dy)));
  }
  return best;
}

function pieceLength(points: readonly Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    length += Math.hypot(
      points[index]!.x - points[index - 1]!.x,
      points[index]!.y - points[index - 1]!.y,
    );
  }
  return length;
}

/** Corta um traço de dois ou mais pontos; devolve os trechos restantes, ou `null` se nada mudou. */
function cutStroke(stroke: WorldInkStroke, pass: EraserPass): readonly WorldInkStroke[] | null {
  const pieces: Point[][] = [];
  let piece: Point[] = [];
  let touched = false;
  const close = (): void => {
    if (piece.length >= 2) pieces.push(piece);
    piece = [];
  };

  for (let index = 1; index < stroke.points.length; index++) {
    const a = stroke.points[index - 1]!;
    const b = stroke.points[index]!;
    const covered = coveredSpans(a, b, pass);
    if (covered.length === 0) {
      if (piece.length === 0) piece.push(a);
      piece.push(b);
      continue;
    }
    touched = true;
    for (const [from, to] of outsideSpans(covered)) {
      const start = from === 0 ? a : lerp(a, b, from);
      const end = to === 1 ? b : lerp(a, b, to);
      if (from > 0) close();
      if (piece.length === 0) piece.push(start);
      piece.push(end);
      if (to < 1) close();
    }
    // Entrou sob a borracha sem trecho de fora até o fim do segmento: o trecho aberto termina.
    if (outsideSpans(covered).at(-1)?.[1] !== 1) close();
  }
  close();
  if (!touched) return null;

  const minimum = pass.minPieceLength ?? 0;
  return pieces
    .filter((points) => pieceLength(points) > 0 && pieceLength(points) >= minimum)
    .map((points) => ({ color: stroke.color, kind: stroke.kind, width: stroke.width, points }));
}

/**
 * Traços restantes depois da passada, em coordenadas de mundo. Traço inteiro sob a borracha some;
 * traço cruzado vira dois ou mais, com as pontas novas na borda da cápsula; as partes que a
 * borracha não toca ficam como estão. Um pingo (traço de um ponto) some se o ponto está sob a
 * borracha. Um trecho restante com um ponto só, ou abaixo de `minPieceLength`, é descartado.
 *
 * Quando a passada não toca nada, devolve a própria lista recebida.
 */
export function eraseFromStrokes(
  strokes: readonly WorldInkStroke[],
  pass: EraserPass,
): readonly WorldInkStroke[] {
  const result: WorldInkStroke[] = [];
  let changed = false;
  for (const stroke of strokes) {
    const first = stroke.points[0];
    if (first === undefined) {
      changed = true;
      continue;
    }
    if (stroke.points.length === 1) {
      if (distanceToPass(first, pass) <= pass.radius) changed = true;
      else result.push(stroke);
      continue;
    }
    const pieces = cutStroke(stroke, pass);
    if (pieces === null) {
      result.push(stroke);
    } else {
      changed = true;
      result.push(...pieces);
    }
  }
  return changed ? result : strokes;
}

function rotateAbout(p: Point, center: Point, cos: number, sin: number): Point {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

function unitClamp(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Leva traços em mundo de volta à caixa do elemento, sem mudá-la: o que a borracha deixa nunca sai
 * da caixa original, então só o arredondamento é recortado a `[0, 1]`. Serve ao preview da passada.
 */
export function inkStrokesToLocal(
  node: Pick<InkGeometry, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  strokes: readonly WorldInkStroke[],
): InkStroke[] {
  const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  const cos = Math.cos(-node.rotation);
  const sin = Math.sin(-node.rotation);
  return strokes.map((stroke) => ({
    color: stroke.color,
    kind: stroke.kind,
    width: stroke.width,
    points: stroke.points.map((point) => {
      const frame = node.rotation === 0 ? point : rotateAbout(point, center, cos, sin);
      return {
        x: unitClamp((frame.x - node.x) / node.width),
        y: unitClamp((frame.y - node.y) / node.height),
      };
    }),
  }));
}

/**
 * O patch que dá ao elemento os traços em mundo recebidos, com a caixa refeita como a envolvente
 * deles (`inkBounds`) e os pontos renormalizados, mantendo a rotação. `null` se não há traços.
 */
export function inkPatchFromWorldStrokes(
  node: Pick<InkGeometry, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  strokes: readonly WorldInkStroke[],
): InkAppendPatch | null {
  if (strokes.length === 0) return null;
  const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  const cos = Math.cos(-node.rotation);
  const sin = Math.sin(-node.rotation);
  const inFrame = strokes.map((stroke) => ({
    ...stroke,
    points:
      node.rotation === 0
        ? stroke.points
        : stroke.points.map((point) => rotateAbout(point, center, cos, sin)),
  }));
  const box: BoxGeometry = inkBounds(inFrame);
  const frameCenter = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const worldCenter =
    node.rotation === 0
      ? frameCenter
      : rotateAbout(frameCenter, center, Math.cos(node.rotation), Math.sin(node.rotation));
  const local = inkStrokesToLocal({ ...box, rotation: 0 }, inFrame);
  return {
    x: worldCenter.x - box.width / 2,
    y: worldCenter.y - box.height / 2,
    width: box.width,
    height: box.height,
    strokes: local,
  };
}

/**
 * Aplica a passada a um elemento e devolve o patch (traços e caixa renormalizados, rotação
 * mantida), ou `null` se o elemento ficou sem traços. Passada que não toca nada devolve um patch
 * com os mesmos traços; quem quiser distinguir usa `eraseFromStrokes` e compara a lista.
 */
export function eraseFromInk(node: InkGeometry, pass: EraserPass): InkAppendPatch | null {
  const world = inkStrokesToWorld(node);
  return inkPatchFromWorldStrokes(node, eraseFromStrokes(world, pass));
}
