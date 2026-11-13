import type { Point } from '../arrows.js';
import { distanceToSegment } from './shapes.js';

/** Quanto a tolerância cresce a cada rodada em que o resultado ainda passa de `maxPoints`. */
const TOLERANCE_GROWTH = 1.5;

/**
 * Uma rodada de Ramer–Douglas–Peucker, sem recursão: um traço longo não estoura a pilha. Mantém
 * as pontas e cada ponto que fica a mais de `tolerance` do segmento que o resumiria.
 */
function douglasPeucker(points: readonly Point[], tolerance: number): Point[] {
  const last = points.length - 1;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[last] = 1;
  const pending: Array<readonly [number, number]> = [[0, last]];
  for (let range = pending.pop(); range !== undefined; range = pending.pop()) {
    const [from, to] = range;
    const start = points[from]!;
    const end = points[to]!;
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let index = from + 1; index < to; index++) {
      const distance = distanceToSegment(points[index]!, start, end);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = index;
      }
    }
    if (farthest === -1) continue;
    keep[farthest] = 1;
    pending.push([from, farthest], [farthest, to]);
  }
  return points.filter((_, index) => keep[index] === 1);
}

/** Diagonal da caixa dos pontos: acima dela, qualquer tolerância resume tudo às duas pontas. */
function extentOf(points: readonly Point[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

/**
 * Simplifica uma polilinha aberta com Ramer–Douglas–Peucker, mantendo sempre as duas pontas. Com
 * mais de `maxPoints` pontos no resultado, a tolerância cresce 50% e a rodada repete sobre o que
 * sobrou, até caber. Cada ponto descartado numa rodada ficou a até a tolerância dela do
 * segmento que o substitui; com a primeira rodada bastando, o erro é no máximo `tolerance`.
 *
 * `maxPoints` abaixo de 2 vale 2, o mínimo que guarda as pontas. Uma lista com 0, 1 ou 2 pontos
 * volta como está.
 */
export function simplifyPolyline(
  points: readonly Point[],
  tolerance: number,
  maxPoints: number,
): readonly Point[] {
  if (points.length <= 2) return points.slice();
  const limit = Math.max(2, Math.floor(maxPoints));
  let current = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0;
  let result = douglasPeucker(points, current);
  if (result.length <= limit) return result;
  // Tolerância zero não cresce por multiplicação: parte de uma fração ínfima da extensão do traço.
  const extent = extentOf(points);
  while (result.length > limit) {
    current = current > 0 ? current * TOLERANCE_GROWTH : Math.max(extent * 1e-6, Number.MIN_VALUE);
    result = douglasPeucker(result, current);
  }
  return result;
}
