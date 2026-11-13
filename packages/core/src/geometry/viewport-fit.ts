import type { Bounds } from './bounds.js';
import { clampZoom, type Viewport, type ZoomLimits } from './transform.js';

/** Tamanho da área de apresentação, em CSS px. */
export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface FitViewportOptions {
  /** Margem em CSS px em cada lado. Padrão: 40. */
  readonly padding?: number | undefined;
  /** Faixa de zoom aceita. Padrão: `DEFAULT_ZOOM_LIMITS`. */
  readonly limits?: ZoomLimits | undefined;
}

const DEFAULT_PADDING = 40;

/**
 * Viewport que centraliza `bounds` numa área de apresentação do tamanho `size`, com o maior zoom
 * que cabe, limitado à faixa de zoom. Devolve `null` quando `bounds` ou `size` não têm área ou
 * algum valor não é finito.
 */
export function fitViewportToBounds(
  bounds: Bounds,
  size: ViewportSize,
  options: FitViewportOptions = {},
): Viewport | null {
  const padding = options.padding ?? DEFAULT_PADDING;
  const values = [
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    size.width,
    size.height,
    padding,
  ];
  if (!values.every(Number.isFinite)) return null;
  if (bounds.width <= 0 || bounds.height <= 0 || size.width <= 0 || size.height <= 0) return null;

  const availableWidth = Math.max(1, size.width - 2 * padding);
  const availableHeight = Math.max(1, size.height - 2 * padding);
  const zoom = clampZoom(
    Math.min(availableWidth / bounds.width, availableHeight / bounds.height),
    options.limits,
  );

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return { x: size.width / 2 - centerX * zoom, y: size.height / 2 - centerY * zoom, zoom };
}
