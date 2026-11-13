import { zoomAt, type Point, type Viewport, type ZoomLimits } from '@canvash/core';

/**
 * Calcula a distância euclidiana entre dois pontos de tela.
 */
export function computeTouchDistance(p1: Point, p2: Point): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * Calcula o ponto central (médio) entre dois pontos de tela.
 */
export function computeTouchCenter(p1: Point, p2: Point): Point {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
  };
}

/**
 * Aplica simultaneamente pan (deslocamento do centro) e pinch zoom
 * ancorado no novo centro dos dedos, respeitando os limites de zoom configurados.
 */
export function applyPinchPanZoom(
  currentViewport: Viewport,
  prevCenter: Point,
  newCenter: Point,
  prevDistance: number,
  newDistance: number,
  zoomLimits?: ZoomLimits,
): Viewport {
  // 1. Pan correspondente ao deslocamento vetorial do centro dos dedos
  const dx = newCenter.x - prevCenter.x;
  const dy = newCenter.y - prevCenter.y;

  let vp: Viewport = {
    x: currentViewport.x + dx,
    y: currentViewport.y + dy,
    zoom: currentViewport.zoom,
  };

  // 2. Pinch zoom ancorado no novo centro
  if (prevDistance > 0 && newDistance > 0) {
    const scaleFactor = newDistance / prevDistance;
    const nextZoom = vp.zoom * scaleFactor;
    vp = zoomAt(vp, newCenter, nextZoom, zoomLimits);
  }

  return vp;
}
