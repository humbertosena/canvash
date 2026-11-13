import type { Point } from './arrows.js';
import {
  at,
  colorOrNull,
  finite,
  isFull,
  isRecord,
  items,
  rejectUnknownKeys,
  report,
  unitInterval,
  type Path,
} from './checks.js';
import type { BoxGeometry } from './geometry/fit.js';
import type { ValidationIssue } from './result.js';

/** Tipo de ponta do traço: caneta, marcador ou marca-texto. */
export type InkKind = 'pen' | 'marker' | 'highlighter';

/** Espessura nomeada do traço; a medida em unidades do documento vem de `INK_WIDTHS`. */
export type InkWidth = 'thin' | 'medium' | 'thick';

/** Um traço de entrada: cor, tipo e espessura têm padrão (grafite, caneta, média). */
export interface InkStrokeInput {
  readonly points: readonly Point[];
  readonly color?: string | undefined;
  readonly kind?: InkKind | undefined;
  readonly width?: InkWidth | undefined;
}

/** O que `appendInkStroke` precisa de um elemento: a caixa e os traços. */
export interface InkGeometry extends BoxGeometry {
  readonly strokes: readonly InkStroke[];
}

/** Patch de `appendInkStroke`: só os traços, ou a caixa nova e todos os traços renormalizados. */
export interface InkAppendPatch {
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly strokes: readonly InkStroke[];
}

export interface InkStroke {
  /** Pontos em coordenadas locais da caixa, de 0 a 1 em cada eixo. Ao menos 1; no máximo 2.000. */
  readonly points: readonly Point[];
  /** `#rrggbb` ou `#rrggbbaa`, em minúsculas. */
  readonly color: string;
  readonly kind: InkKind;
  readonly width: InkWidth;
}

/** Um traço com os pontos em coordenadas de mundo, antes de entrar na caixa do elemento. */
export interface WorldInkStroke {
  readonly points: readonly Point[];
  readonly color: string;
  readonly kind: InkKind;
  readonly width: InkWidth;
}

/** O estilo do elemento é só a opacidade; cor, tipo e espessura são de cada traço. */
export interface InkStyle {
  readonly opacity: number;
}

export const INK_KINDS: readonly InkKind[] = Object.freeze(['pen', 'marker', 'highlighter']);
export const INK_WIDTH_NAMES: readonly InkWidth[] = Object.freeze(['thin', 'medium', 'thick']);

/** Espessura em unidades do documento, por tipo e tamanho. Esticar a caixa não a altera. */
export const INK_WIDTHS: Readonly<Record<InkKind, Readonly<Record<InkWidth, number>>>> =
  Object.freeze({
    pen: Object.freeze({ thin: 2, medium: 4, thick: 8 }),
    marker: Object.freeze({ thin: 4, medium: 8, thick: 16 }),
    highlighter: Object.freeze({ thin: 6, medium: 12, thick: 24 }),
  });

/** Opacidade do marca-texto, aplicada por traço sobre a do elemento. */
export const INK_HIGHLIGHTER_ALPHA = 0.4;

/** Paleta do botão da caneta; a primeira cor é a padrão. */
export const PEN_PALETTE: readonly string[] = Object.freeze([
  '#1f2937',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
]);

export const INK_LIMITS = Object.freeze({
  maxStrokes: 500,
  maxPoints: 20_000,
  maxPointsPerStroke: 2_000,
} as const);

/** Cor, tipo e espessura de um traço novo quando a entrada não os diz. */
export const DEFAULT_PEN_SETTINGS = Object.freeze({
  color: '#1f2937',
  kind: 'pen',
  width: 'medium',
} as const satisfies { color: string; kind: InkKind; width: InkWidth });

/** Espessura de um traço, em unidades do documento. */
export function inkStrokeWidth(kind: InkKind, width: InkWidth): number {
  return INK_WIDTHS[kind][width];
}

/** Opacidade própria do traço: o marca-texto é 0,4 e os demais são opacos. */
export function inkStrokeAlpha(kind: InkKind): number {
  return kind === 'highlighter' ? INK_HIGHLIGHTER_ALPHA : 1;
}

/** Caixa de lado mínimo 1 em torno do centro dado. */
function atLeastOne(min: number, max: number): [number, number] {
  if (max - min >= 1) return [min, max];
  const middle = (min + max) / 2;
  return [middle - 0.5, middle + 0.5];
}

/**
 * Caixa envolvente dos traços em mundo, sem rotação: o retângulo dos pontos mais metade da maior
 * espessura, com lados de pelo menos 1. Um ponto só, ou um traço reto horizontal, ainda têm caixa.
 */
export function inkBounds(
  strokes: ReadonlyArray<{
    readonly points: readonly Point[];
    readonly kind: InkKind;
    readonly width: InkWidth;
  }>,
): BoxGeometry {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let thickest = 0;
  for (const stroke of strokes) {
    thickest = Math.max(thickest, inkStrokeWidth(stroke.kind, stroke.width));
    for (const { x, y } of stroke.points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const margin = thickest / 2;
  const [left, right] = atLeastOne(minX - margin, maxX + margin);
  const [top, bottom] = atLeastOne(minY - margin, maxY + margin);
  return { x: left, y: top, width: right - left, height: bottom - top, rotation: 0 };
}

function clampUnit(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Leva pontos de mundo para o quadro de uma caixa sem rotação, em coordenadas de 0 a 1. */
function normalizePoints(points: readonly Point[], box: BoxGeometry): Point[] {
  return points.map((p) => ({
    x: clampUnit((p.x - box.x) / box.width),
    y: clampUnit((p.y - box.y) / box.height),
  }));
}

/**
 * Caixa e traços locais de um conjunto de traços em mundo. Os pontos locais ficam em `[0, 1]`,
 * com o erro de arredondamento recortado.
 */
export function normalizeInkStrokes(strokes: readonly WorldInkStroke[]): {
  readonly box: BoxGeometry;
  readonly strokes: InkStroke[];
} {
  const box = inkBounds(strokes);
  return {
    box,
    strokes: strokes.map((stroke) => ({
      points: normalizePoints(stroke.points, box),
      color: stroke.color,
      kind: stroke.kind,
      width: stroke.width,
    })),
  };
}

/** Entrada de criação a partir de um traço em mundo, com os pontos ainda por normalizar. */
export function inkInputFromStroke(
  stroke: Omit<InkStroke, 'points'> & { readonly worldPoints: readonly Point[] },
): { readonly type: 'ink'; readonly strokes: readonly InkStrokeInput[] } {
  return {
    type: 'ink',
    strokes: [
      { points: stroke.worldPoints, color: stroke.color, kind: stroke.kind, width: stroke.width },
    ],
  };
}

function rotateAbout(p: Point, center: Point, cos: number, sin: number): Point {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

/** Os traços do elemento em coordenadas de mundo, já com a rotação aplicada. */
export function inkStrokesToWorld(node: InkGeometry): WorldInkStroke[] {
  const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  const cos = Math.cos(node.rotation);
  const sin = Math.sin(node.rotation);
  return node.strokes.map((stroke) => ({
    color: stroke.color,
    kind: stroke.kind,
    width: stroke.width,
    points: stroke.points.map((p) => {
      const local = { x: node.x + p.x * node.width, y: node.y + p.y * node.height };
      return node.rotation === 0 ? local : rotateAbout(local, center, cos, sin);
    }),
  }));
}

/** Um comando do caminho suavizado de um traço, em quaisquer coordenadas. */
export type InkPathSegment =
  | { readonly kind: 'M'; readonly x: number; readonly y: number }
  | { readonly kind: 'L'; readonly x: number; readonly y: number }
  | {
      readonly kind: 'Q';
      readonly cx: number;
      readonly cy: number;
      readonly x: number;
      readonly y: number;
    };

/**
 * O caminho suavizado de um traço: curvas quadráticas cujos pontos de controle são os pontos do
 * traço e cujos destinos são os pontos médios dos segmentos, terminando em linha reta no último
 * ponto. É a mesma curva no Canvas (`quadraticCurveTo`) e no SVG (`Q`). Um ponto só não tem
 * caminho (é um pingo redondo) e dois pontos são uma linha.
 */
export function inkPathSegments(points: readonly Point[]): InkPathSegment[] {
  const first = points[0];
  if (first === undefined || points.length === 1) return [];
  const segments: InkPathSegment[] = [{ kind: 'M', x: first.x, y: first.y }];
  for (let index = 1; index < points.length - 1; index++) {
    const control = points[index]!;
    const next = points[index + 1]!;
    segments.push({
      kind: 'Q',
      cx: control.x,
      cy: control.y,
      x: (control.x + next.x) / 2,
      y: (control.y + next.y) / 2,
    });
  }
  const last = points[points.length - 1]!;
  segments.push({ kind: 'L', x: last.x, y: last.y });
  return segments;
}

/** Diz se mais um traço de `points` pontos cabe nos limites do elemento. */
export function canAppendInkStroke(node: Pick<InkGeometry, 'strokes'>, points: number): boolean {
  if (points < 1 || points > INK_LIMITS.maxPointsPerStroke) return false;
  if (node.strokes.length + 1 > INK_LIMITS.maxStrokes) return false;
  let total = points;
  for (const stroke of node.strokes) total += stroke.points.length;
  return total <= INK_LIMITS.maxPoints;
}

/**
 * Patch que acrescenta um traço, dado em pontos de mundo, a um elemento. Dentro da caixa atual só
 * o traço novo entra e os pontos antigos ficam como estão. Fora dela, a caixa cresce (na rotação
 * do elemento) e todos os pontos são renormalizados no mesmo patch.
 */
export function appendInkStroke(
  node: InkGeometry,
  stroke: Omit<InkStroke, 'points'> & { readonly worldPoints: readonly Point[] },
): InkAppendPatch {
  const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  const cos = Math.cos(node.rotation);
  const sin = Math.sin(node.rotation);
  // Os pontos novos entram no quadro sem rotação do elemento, o mesmo em que a caixa é medida.
  const inFrame =
    node.rotation === 0
      ? stroke.worldPoints.slice()
      : stroke.worldPoints.map((p) => rotateAbout(p, center, cos, -sin));

  const bounds = inkBounds([{ points: inFrame, kind: stroke.kind, width: stroke.width }]);
  const left = Math.min(node.x, bounds.x);
  const top = Math.min(node.y, bounds.y);
  const right = Math.max(node.x + node.width, bounds.x + bounds.width);
  const bottom = Math.max(node.y + node.height, bounds.y + bounds.height);
  const grows =
    left < node.x || top < node.y || right > node.x + node.width || bottom > node.y + node.height;

  if (!grows) {
    const added: InkStroke = {
      points: normalizePoints(inFrame, node),
      color: stroke.color,
      kind: stroke.kind,
      width: stroke.width,
    };
    return { strokes: [...node.strokes, added] };
  }

  const box: BoxGeometry = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    rotation: node.rotation,
  };
  const reframed: InkStroke[] = node.strokes.map((existing) => ({
    ...existing,
    points: normalizePoints(
      existing.points.map((p) => ({
        x: node.x + p.x * node.width,
        y: node.y + p.y * node.height,
      })),
      box,
    ),
  }));
  reframed.push({
    points: normalizePoints(inFrame, box),
    color: stroke.color,
    kind: stroke.kind,
    width: stroke.width,
  });
  // O centro da caixa nova, que está no quadro antigo, volta ao mundo pela rotação do elemento.
  const newCenter = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const worldCenter = node.rotation === 0 ? newCenter : rotateAbout(newCenter, center, cos, sin);
  return {
    x: worldCenter.x - box.width / 2,
    y: worldCenter.y - box.height / 2,
    width: box.width,
    height: box.height,
    strokes: reframed,
  };
}

const PEN_COLOR = (value: unknown, path: Path, issues: ValidationIssue[]): string => {
  const before = issues.length;
  const color = colorOrNull(value, path, issues);
  if (color === null && issues.length === before) {
    report(issues, path, 'type', 'must be a color string');
  }
  return color ?? DEFAULT_PEN_SETTINGS.color;
};

function kindCheck(value: unknown, path: Path, issues: ValidationIssue[]): InkKind {
  if (value === 'pen' || value === 'marker' || value === 'highlighter') return value;
  report(issues, path, 'format', 'must be "pen", "marker" or "highlighter"');
  return 'pen';
}

function widthCheck(value: unknown, path: Path, issues: ValidationIssue[]): InkWidth {
  if (value === 'thin' || value === 'medium' || value === 'thick') return value;
  report(issues, path, 'format', 'must be "thin", "medium" or "thick"');
  return 'medium';
}

const STROKE_KEYS = ['points', 'color', 'kind', 'width'];

/**
 * Como ler os traços: `local` são frações da caixa (`0` a `1`) com cor, tipo e espessura
 * obrigatórios, como no documento e no patch; `world` são números finitos de mundo, e
 * `local-input` são frações da caixa de uma entrada, nos dois casos com os três campos opcionais.
 */
export type InkReadMode = 'local' | 'world' | 'local-input';

/** Lê a lista de traços de uma entrada, de um patch ou de um documento. Os limites valem em todos. */
export function readInkStrokes(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
  mode: InkReadMode,
): InkStroke[] {
  if (!Array.isArray(value)) {
    report(issues, path, 'type', 'must be an array of strokes');
    return [];
  }
  if (value.length < 1 || value.length > INK_LIMITS.maxStrokes) {
    report(issues, path, 'range', `must have from 1 to ${INK_LIMITS.maxStrokes} strokes`);
    return [];
  }
  const strokes: InkStroke[] = [];
  let total = 0;
  for (const [index, item] of items(value)) {
    if (isFull(issues)) break;
    const strokePath = at(path, index);
    if (!isRecord(item)) {
      report(issues, strokePath, 'type', 'must be a stroke object');
      continue;
    }
    rejectUnknownKeys(item, STROKE_KEYS, strokePath, issues);
    const pointsPath = at(strokePath, 'points');
    const points = readPoints(item['points'], pointsPath, issues, mode);
    total += points.length;
    if (total > INK_LIMITS.maxPoints) {
      report(issues, path, 'range', `must have at most ${INK_LIMITS.maxPoints} points in total`);
      break;
    }
    const given = (key: string): boolean => item[key] !== undefined;
    const color =
      mode !== 'local' && !given('color')
        ? DEFAULT_PEN_SETTINGS.color
        : PEN_COLOR(item['color'], at(strokePath, 'color'), issues);
    const kind =
      mode !== 'local' && !given('kind')
        ? DEFAULT_PEN_SETTINGS.kind
        : kindCheck(item['kind'], at(strokePath, 'kind'), issues);
    const width =
      mode !== 'local' && !given('width')
        ? DEFAULT_PEN_SETTINGS.width
        : widthCheck(item['width'], at(strokePath, 'width'), issues);
    strokes.push({ points, color, kind, width });
  }
  return strokes;
}

function readPoints(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
  mode: InkReadMode,
): Point[] {
  if (!Array.isArray(value)) {
    report(issues, path, 'type', 'must be an array of points');
    return [];
  }
  if (value.length < 1 || value.length > INK_LIMITS.maxPointsPerStroke) {
    report(
      issues,
      path,
      'range',
      `must have from 1 to ${INK_LIMITS.maxPointsPerStroke} points per stroke`,
    );
    return [];
  }
  const coordinate = mode === 'world' ? finite : unitInterval;
  const points: Point[] = [];
  for (const [index, item] of items(value)) {
    if (isFull(issues)) break;
    const pointPath = at(path, index);
    if (!isRecord(item)) {
      report(issues, pointPath, 'type', 'must be a point with x and y');
      continue;
    }
    rejectUnknownKeys(item, ['x', 'y'], pointPath, issues);
    points.push({
      x: coordinate(item['x'], at(pointPath, 'x'), issues),
      y: coordinate(item['y'], at(pointPath, 'y'), issues),
    });
  }
  return points;
}
