import type { Point } from '../shapes.js';

/**
 * Enquadramento do mundo na tela: `tela = mundo * zoom + (x, y)`. O deslocamento está em CSS px,
 * local ao elemento e sem device pixel ratio.
 */
export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** Faixa de zoom aceita, com os dois extremos incluídos. */
export interface ZoomLimits {
  readonly min: number;
  readonly max: number;
}

export const DEFAULT_ZOOM_LIMITS: ZoomLimits = Object.freeze({ min: 0.05, max: 16 });

/** Leva o zoom para dentro da faixa. */
export function clampZoom(zoom: number, limits: ZoomLimits = DEFAULT_ZOOM_LIMITS): number {
  return Math.min(limits.max, Math.max(limits.min, zoom));
}

export function worldToScreen(viewport: Viewport, point: Point): Point {
  return { x: point.x * viewport.zoom + viewport.x, y: point.y * viewport.zoom + viewport.y };
}

/** Inversa de {@link worldToScreen}: é por ela que o input de ponteiro chega ao mundo. */
export function screenToWorld(viewport: Viewport, point: Point): Point {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  };
}

/**
 * Novo viewport com o zoom pedido, limitado à faixa, mantendo sob `anchor` (em tela) o mesmo
 * ponto de mundo.
 */
export function zoomAt(
  viewport: Viewport,
  anchor: Point,
  zoom: number,
  limits: ZoomLimits = DEFAULT_ZOOM_LIMITS,
): Viewport {
  const nextZoom = clampZoom(zoom, limits);
  // Sem mudança de zoom, refazer a conta só juntaria erro de arredondamento ao deslocamento a
  // cada pedido além do limite.
  if (nextZoom === viewport.zoom) return viewport;
  const world = screenToWorld(viewport, anchor);
  return { x: anchor.x - world.x * nextZoom, y: anchor.y - world.y * nextZoom, zoom: nextZoom };
}

/** Gira `point` ao redor de `center`. Ângulo em radianos; positivo leva o eixo x ao eixo y. */
export function rotatePoint(point: Point, center: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}
