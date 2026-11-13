import type { Point } from '../arrows.js';

/** Margem numérica abaixo da qual dois parâmetros `t` contam como o mesmo ponto. */
const EPSILON = 1e-12;

/** Abaixo deste quadrado do comprimento (1e-9 unidades) um segmento é tratado como um ponto. */
const MIN_SEGMENT_SQUARED = 1e-18;

/** Parâmetros `t` do trecho `[lo, hi]` de uma reta em que a condição vale, ou `null`. */
type Interval = readonly [number, number];

/** Intersecção da reta `a + t·d` com o disco de centro `c` e raio `r`. */
function discInterval(a: Point, dx: number, dy: number, c: Point, r: number): Interval | null {
  const fx = a.x - c.x;
  const fy = a.y - c.y;
  const quad = dx * dx + dy * dy;
  const b = 2 * (dx * fx + dy * fy);
  const disc = b * b - 4 * quad * (fx * fx + fy * fy - r * r);
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  return [(-b - root) / (2 * quad), (-b + root) / (2 * quad)];
}

/**
 * Faixa de `t` em que `origin + t·rate` fica dentro de `[min, max]`: o corte de uma reta por uma
 * lâmina. `rate` zero só aceita a origem já dentro.
 */
function slab(origin: number, rate: number, min: number, max: number): Interval | null {
  if (Math.abs(rate) < EPSILON)
    return origin >= min && origin <= max ? [-Infinity, Infinity] : null;
  const t0 = (min - origin) / rate;
  const t1 = (max - origin) / rate;
  return t0 <= t1 ? [t0, t1] : [t1, t0];
}

/** Intersecção da reta com o retângulo orientado de `p` a `q`, de meia largura `r`. */
function barInterval(a: Point, dx: number, dy: number, p: Point, q: Point, r: number) {
  const length = Math.hypot(q.x - p.x, q.y - p.y);
  const ux = (q.x - p.x) / length;
  const uy = (q.y - p.y) / length;
  const along = slab((a.x - p.x) * ux + (a.y - p.y) * uy, dx * ux + dy * uy, 0, length);
  const across = slab(-(a.x - p.x) * uy + (a.y - p.y) * ux, -dx * uy + dy * ux, -r, r);
  if (along === null || across === null) return null;
  const lo = Math.max(along[0], across[0]);
  const hi = Math.min(along[1], across[1]);
  return lo <= hi ? ([lo, hi] as const) : null;
}

/**
 * O trecho de `[a, b]` que fica sob a cápsula de raio `r` em torno de `[p, q]` (a distância ao
 * segmento `pq` é de até `r`), como parâmetros `t` em `[0, 1]`, ou `null` se nenhum trecho de
 * comprimento positivo fica sob ela. A cápsula é convexa, então a intersecção é um trecho só: a
 * união dos dois discos das pontas com o retângulo entre elas.
 */
export function capsuleInterval(
  a: Point,
  b: Point,
  p: Point,
  q: Point,
  r: number,
): Interval | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx * dx + dy * dy < MIN_SEGMENT_SQUARED) {
    // Segmento de comprimento (quase) zero: é um ponto, dentro ou fora.
    return distanceToSegmentSquared(a, p, q) <= r * r ? [0, 1] : null;
  }
  const parts: Array<Interval | null> = [
    discInterval(a, dx, dy, p, r),
    discInterval(a, dx, dy, q, r),
  ];
  if (p.x !== q.x || p.y !== q.y) parts.push(barInterval(a, dx, dy, p, q, r));
  let lo = Infinity;
  let hi = -Infinity;
  for (const part of parts) {
    if (part === null) continue;
    lo = Math.min(lo, part[0]);
    hi = Math.max(hi, part[1]);
  }
  lo = Math.max(lo, 0);
  hi = Math.min(hi, 1);
  // Um toque só (tangente) ou nenhum: não há trecho sob a cápsula.
  return hi - lo > EPSILON ? [lo, hi] : null;
}

function distanceToSegmentSquared(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const along =
    lengthSquared === 0
      ? 0
      : Math.min(
          1,
          Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
        );
  const offX = point.x - (start.x + along * dx);
  const offY = point.y - (start.y + along * dy);
  return offX * offX + offY * offY;
}

/**
 * Os trechos de `[a, b]` que ficam fora da cápsula de raio `r` em torno de `[p, q]`, como pares
 * `[de, até]` de parâmetros `t` em `[0, 1]`, em ordem. Lista vazia: o segmento inteiro está sob a
 * cápsula. Uma cápsula que só toca o segmento (tangente) não o corta.
 */
export function segmentOutsideCapsule(
  a: Point,
  b: Point,
  p: Point,
  q: Point,
  r: number,
): ReadonlyArray<readonly [number, number]> {
  const inside = capsuleInterval(a, b, p, q, r);
  if (inside === null) return [[0, 1]];
  const outside: Array<readonly [number, number]> = [];
  if (inside[0] > 0) outside.push([0, inside[0]]);
  if (inside[1] < 1) outside.push([inside[1], 1]);
  return outside;
}
