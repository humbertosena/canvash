import {
  DEFAULT_PEN_SETTINGS,
  INK_KINDS,
  INK_LIMITS,
  INK_WIDTH_NAMES,
  inkInputFromStroke,
  simplifyPolyline,
  type InkKind,
  type InkNode,
  type InkWidth,
  type Point,
  type PreviewShape,
} from '@canvash/core';

/** Cor, tipo e espessura dos próximos traços. */
export interface PenSettings {
  readonly color: string;
  readonly kind: InkKind;
  readonly width: InkWidth;
}

export const DEFAULT_PEN: PenSettings = DEFAULT_PEN_SETTINGS;

/** Tolerância da simplificação ao soltar o traço, em pixels CSS (dividida pelo zoom). */
export const PEN_SIMPLIFY_TOLERANCE_CSS_PX = 0.75;

export const PEN_PREVIEW_ID = '__preview_ink__';

const HEX_COLOR = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Cor `#rrggbb` ou `#rrggbbaa`. */
export function isPenColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

export function isInkNode(node: { readonly type: string }): node is InkNode {
  return node.type === 'ink';
}

/**
 * Aplica um pedido parcial às configurações atuais. Cada campo inválido é ignorado e os demais
 * valem: `color` em `#rrggbb`/`#rrggbbaa` (guardada em minúsculas), `kind` e `width` das uniões.
 */
export function mergePenSettings(
  current: PenSettings,
  patch: { readonly color?: unknown; readonly kind?: unknown; readonly width?: unknown },
): PenSettings {
  return {
    color: isPenColor(patch.color) ? patch.color.toLowerCase() : current.color,
    kind: (INK_KINDS as readonly unknown[]).includes(patch.kind)
      ? (patch.kind as InkKind)
      : current.kind,
    width: (INK_WIDTH_NAMES as readonly unknown[]).includes(patch.width)
      ? (patch.width as InkWidth)
      : current.width,
  };
}

/** Acrescenta um ponto bruto, sem repetir o último. Devolve se acrescentou. */
export function appendRawPoint(points: Point[], point: Point): boolean {
  const last = points[points.length - 1];
  if (last !== undefined && last.x === point.x && last.y === point.y) return false;
  points.push(point);
  return true;
}

/**
 * Os pontos que entram no documento: Ramer–Douglas–Peucker com 0,75 CSS px de tolerância
 * (dividido pelo zoom), no máximo 2.000 pontos. Um gesto que não sai da tolerância é um pingo.
 */
export function finalizeStroke(raw: readonly Point[], zoom: number): Point[] {
  const first = raw[0];
  if (first === undefined) return [];
  const tolerance = PEN_SIMPLIFY_TOLERANCE_CSS_PX / (zoom > 0 ? zoom : 1);
  const wandered = raw.some((p) => Math.hypot(p.x - first.x, p.y - first.y) > tolerance);
  if (!wandered) return [{ x: first.x, y: first.y }];
  return simplifyPolyline(raw, tolerance, INK_LIMITS.maxPointsPerStroke).map((p) => ({
    x: p.x,
    y: p.y,
  }));
}

/**
 * Pontos do desenho em andamento: os brutos até o teto por traço; acima dele, um a cada `k`
 * (com o último sempre), que custa uma passada só por movimento do ponteiro. A simplificação
 * de verdade só roda ao soltar.
 */
export function previewPoints(raw: readonly Point[]): readonly Point[] {
  const limit = INK_LIMITS.maxPointsPerStroke;
  if (raw.length <= limit) return raw;
  const stride = Math.ceil(raw.length / (limit - 1));
  const picked: Point[] = [];
  for (let index = 0; index < raw.length - 1; index += stride) picked.push(raw[index]!);
  picked.push(raw[raw.length - 1]!);
  return picked;
}

/** O traço em andamento como elemento provisório, à frente de tudo. */
export function buildPenPreview(raw: readonly Point[], settings: PenSettings): PreviewShape {
  return {
    id: PEN_PREVIEW_ID,
    ...inkInputFromStroke({ ...settings, worldPoints: previewPoints(raw) }),
  };
}
