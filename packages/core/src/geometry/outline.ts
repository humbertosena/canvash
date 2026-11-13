import type { Point } from '../arrows.js';
import type { BoxGeometry } from './fit.js';
import { rotatePoint } from './transform.js';

export interface OutlineDiamond extends BoxGeometry {
  readonly type: 'diamond';
}

export interface OutlineTriangle extends BoxGeometry {
  readonly type: 'triangle';
  readonly apex: number;
}

export interface OutlinePolygon extends BoxGeometry {
  readonly type: 'polygon';
  readonly sides: number;
}

export interface OutlineCross extends BoxGeometry {
  readonly type: 'cross';
  readonly armRatio: number;
}

export interface OutlineChevron extends BoxGeometry {
  readonly type: 'chevron';
  readonly direction: 'right' | 'left' | 'up' | 'down';
  readonly notchDepth: number;
}

export type OutlineShapeNode =
  OutlineDiamond | OutlineTriangle | OutlinePolygon | OutlineCross | OutlineChevron;

/**
 * Devolve os vértices do contorno do polígono no referencial local da caixa
 * (em coordenadas de mundo antes de aplicar a rotação em torno do centro).
 */
export function shapeOutline(node: OutlineShapeNode): readonly Point[] {
  const { x, y, width, height } = node;
  if (node.type === 'triangle') {
    return [
      { x: x + width * node.apex, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ];
  }
  const cx = x + width / 2;
  const cy = y + height / 2;
  if (node.type === 'cross') {
    // Doze vértices, em sentido horário a partir do topo do braço vertical. A espessura é a
    // mesma nos dois braços, e cada um vai de um lado ao outro da caixa.
    const half = (node.armRatio * Math.min(width, height)) / 2;
    return [
      { x: cx - half, y },
      { x: cx + half, y },
      { x: cx + half, y: cy - half },
      { x: x + width, y: cy - half },
      { x: x + width, y: cy + half },
      { x: cx + half, y: cy + half },
      { x: cx + half, y: y + height },
      { x: cx - half, y: y + height },
      { x: cx - half, y: cy + half },
      { x, y: cy + half },
      { x, y: cy - half },
      { x: cx - half, y: cy - half },
    ];
  }
  if (node.type === 'chevron') {
    // Seis vértices, em sentido horário. A profundidade é medida no eixo da direção.
    const right = x + width;
    const bottom = y + height;
    const alongX = node.notchDepth * width;
    const alongY = node.notchDepth * height;
    if (node.direction === 'right') {
      return [
        { x, y },
        { x: right - alongX, y },
        { x: right, y: cy },
        { x: right - alongX, y: bottom },
        { x, y: bottom },
        { x: x + alongX, y: cy },
      ];
    }
    if (node.direction === 'left') {
      return [
        { x: right - alongX, y: cy },
        { x: right, y: bottom },
        { x: x + alongX, y: bottom },
        { x, y: cy },
        { x: x + alongX, y },
        { x: right, y },
      ];
    }
    if (node.direction === 'down') {
      return [
        { x, y },
        { x: cx, y: y + alongY },
        { x: right, y },
        { x: right, y: bottom - alongY },
        { x: cx, y: bottom },
        { x, y: bottom - alongY },
      ];
    }
    return [
      { x: cx, y },
      { x: right, y: y + alongY },
      { x: right, y: bottom },
      { x: cx, y: bottom - alongY },
      { x, y: bottom },
      { x, y: y + alongY },
    ];
  }
  if (node.type === 'polygon') {
    // Inscrito no círculo de diâmetro `width`, a partir do topo. Com y para baixo, o ângulo
    // crescente percorre os vértices em sentido horário, como pede `pointInConvexPolygon`.
    const radius = width / 2;
    const step = (2 * Math.PI) / node.sides;
    return Array.from({ length: node.sides }, (_, k) => {
      const angle = -Math.PI / 2 + k * step;
      return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
    });
  }
  return [
    { x: cx, y },
    { x: x + width, y: cy },
    { x: cx, y: y + height },
    { x, y: cy },
  ];
}

/**
 * Devolve os vértices do contorno já rotacionados em torno do centro da caixa,
 * em coordenadas de mundo.
 */
export function worldShapeOutline(node: OutlineShapeNode): readonly Point[] {
  const local = shapeOutline(node);
  if (node.rotation === 0) return local;
  const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  return local.map((pt) => rotatePoint(pt, center, node.rotation));
}

/**
 * Diz se `point` está dentro (ou na borda) de um polígono convexo definido por `vertices`
 * em sentido horário (onde o interior tem produto vetorial `cross >= -1e-9`).
 */
export function pointInConvexPolygon(point: Point, vertices: readonly Point[]): boolean {
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % n]!;
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (cross < -1e-9) return false;
  }
  return true;
}

/**
 * Diz se `point` está dentro de um polígono qualquer, convexo ou não, pelo cruzamento de raios.
 * Pontos sobre a borda podem cair de qualquer lado: quem precisa da borda mede a distância.
 */
export function pointInPolygon(point: Point, vertices: readonly Point[]): boolean {
  const n = vertices.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = vertices[i]!;
    const b = vertices[j]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Contornos com reentrâncias: o teste de convexidade não vale e as consultas medem cada aresta. */
export function isConcaveOutline(node: OutlineShapeNode): boolean {
  return node.type === 'cross' || node.type === 'chevron';
}

/** Ponto dentro do contorno de `node`, pelo teste que serve à forma dele. */
export function pointInOutline(
  node: OutlineShapeNode,
  point: Point,
  vertices: readonly Point[],
): boolean {
  return isConcaveOutline(node)
    ? pointInPolygon(point, vertices)
    : pointInConvexPolygon(point, vertices);
}
