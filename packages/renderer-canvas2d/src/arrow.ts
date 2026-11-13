import type { ArrowMarkerType, Point } from '@canvash/core';
import type { RenderableArrow } from './scene.js';

/**
 * Ângulo de abertura das asas da cabeça de seta (30 graus em radianos).
 */
const ARROW_HEAD_ANGLE = Math.PI / 6;

/**
 * Calcula o comprimento da cabeça de seta em função da espessura do traço.
 */
export function getArrowHeadLength(strokeWidth: number): number {
  return Math.max(10, strokeWidth * 3.5);
}

/**
 * Calcula o raio do marcador circular ('dot') em função da espessura do traço.
 */
export function getArrowDotRadius(strokeWidth: number): number {
  return Math.max(4, strokeWidth * 1.8);
}

/**
 * Pinta o marcador ('arrow' ou 'dot') em um endpoint da seta.
 */
export function paintMarker(
  context: CanvasRenderingContext2D,
  point: Point,
  angle: number,
  marker: ArrowMarkerType,
  strokeColor: string,
  strokeWidth: number,
): void {
  if (marker === 'none') {
    return;
  }

  if (marker === 'dot') {
    const radius = getArrowDotRadius(strokeWidth);
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fillStyle = strokeColor;
    context.fill();
    return;
  }

  if (marker === 'arrow') {
    const headLength = getArrowHeadLength(strokeWidth);
    const leftX = point.x - headLength * Math.cos(angle - ARROW_HEAD_ANGLE);
    const leftY = point.y - headLength * Math.sin(angle - ARROW_HEAD_ANGLE);
    const rightX = point.x - headLength * Math.cos(angle + ARROW_HEAD_ANGLE);
    const rightY = point.y - headLength * Math.sin(angle + ARROW_HEAD_ANGLE);

    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineTo(leftX, leftY);
    context.lineTo(rightX, rightY);
    context.closePath();
    context.fillStyle = strokeColor;
    context.fill();
    context.strokeStyle = strokeColor;
    context.lineWidth = strokeWidth;
    context.stroke();
  }
}

/**
 * Pinta uma seta reta com suporte a marcadores opcionais no início e no fim.
 */
export function paintArrow(context: CanvasRenderingContext2D, item: RenderableArrow): void {
  const strokeColor = item.style.stroke;
  const strokeWidth = item.style.strokeWidth;
  if (strokeColor === null || strokeWidth <= 0) {
    return;
  }

  const { start, end, startMarker, endMarker } = item;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distanceSq = dx * dx + dy * dy;

  // Segmento de comprimento zero não é desenhado
  if (distanceSq <= 0.0001) {
    return;
  }

  // Linha principal
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.strokeStyle = strokeColor;
  context.lineWidth = strokeWidth;
  context.stroke();

  const angle = Math.atan2(dy, dx);

  // Marcador inicial (aponta para fora do segmento, sentido oposto a angle)
  if (startMarker !== 'none') {
    paintMarker(context, start, angle + Math.PI, startMarker, strokeColor, strokeWidth);
  }

  // Marcador final (aponta na direção do vetor da seta)
  if (endMarker !== 'none') {
    paintMarker(context, end, angle, endMarker, strokeColor, strokeWidth);
  }
}
