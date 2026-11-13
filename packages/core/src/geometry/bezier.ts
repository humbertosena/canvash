import type { Point } from '../arrows.js';

/** Curva cúbica de um segmento: as duas pontas e os dois pontos de controle. */
export interface BezierCurve {
  readonly start: Point;
  readonly control1: Point;
  readonly control2: Point;
  readonly end: Point;
}

/**
 * Fração do alcance (meio traço mais a folga) usada como tolerância do achatamento no hit-test e
 * no marquee. O alcance cresce na mesma medida, para a aproximação nunca errar por falta: o erro
 * fica todo do lado de fora, até 1/16 do alcance.
 */
export const FLATTEN_SHARE = 1 / 16;

/** Teto de segmentos de `flattenBezier`: segura o custo com tolerância zero ou ínfima. */
const MAX_SEGMENTS = 4096;

/** Ponto da curva no parâmetro `t`, de 0 (início) a 1 (fim). */
export function bezierPoint(curve: BezierCurve, t: number): Point {
  // Nas pontas, o ponto dado: a soma ponderada trocaria 0 por -0 em coordenada negativa.
  if (t <= 0) return curve.start;
  if (t >= 1) return curve.end;
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  const { start, control1, control2, end } = curve;
  return {
    x: a * start.x + b * control1.x + c * control2.x + d * end.x,
    y: a * start.y + b * control1.y + c * control2.y + d * end.y,
  };
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

/**
 * Menor e maior valor de um eixo da curva: as pontas e os pontos internos onde a derivada
 * `a·t² + b·t + c` zera.
 */
function axisRange(p0: number, p1: number, p2: number, p3: number): [number, number] {
  let min = Math.min(p0, p3);
  let max = Math.max(p0, p3);
  const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
  const b = 6 * (p0 - 2 * p1 + p2);
  const c = 3 * (p1 - p0);
  const roots: number[] = [];
  if (a === 0) {
    if (b !== 0) roots.push(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      // Forma estável: evita subtrair dois números quase iguais quando `b` domina.
      const q = -0.5 * (b + Math.sign(b || 1) * Math.sqrt(discriminant));
      roots.push(q / a);
      if (q !== 0) roots.push(c / q);
    }
  }
  for (const t of roots) {
    if (t > 0 && t < 1) {
      const value = cubicAt(p0, p1, p2, p3, t);
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  return [min, max];
}

/**
 * Caixa exata da curva, sem traço: a caixa dos pontos de controle sobra nas curvas abertas. Tem a
 * forma de `Bounds`, declarada aqui para `bounds.ts` poder importar este módulo sem ciclo.
 */
export function bezierBounds(curve: BezierCurve): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  const { start, control1, control2, end } = curve;
  const [minX, maxX] = axisRange(start.x, control1.x, control2.x, end.x);
  const [minY, maxY] = axisRange(start.y, control1.y, control2.y, end.y);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Polilinha que fica a até `tolerance` da curva, do início ao fim. A curva se afasta da corda de
 * um trecho de parâmetro `h` no máximo `h²·max|B''| / 8`: daí sai o número de trechos iguais.
 * Tolerância zero, negativa ou não finita usa o teto de segmentos.
 */
export function flattenBezier(curve: BezierCurve, tolerance: number): readonly Point[] {
  const { start, control1, control2, end } = curve;
  const bendX = Math.max(
    Math.abs(start.x - 2 * control1.x + control2.x),
    Math.abs(control1.x - 2 * control2.x + end.x),
  );
  const bendY = Math.max(
    Math.abs(start.y - 2 * control1.y + control2.y),
    Math.abs(control1.y - 2 * control2.y + end.y),
  );
  const maxSecondDerivative = 6 * Math.hypot(bendX, bendY);
  if (maxSecondDerivative === 0) return [start, end];

  const segments =
    tolerance > 0 && Number.isFinite(tolerance)
      ? Math.min(
          MAX_SEGMENTS,
          Math.max(1, Math.ceil(Math.sqrt(maxSecondDerivative / (8 * tolerance)))),
        )
      : MAX_SEGMENTS;
  return Array.from({ length: segments + 1 }, (_, k) => bezierPoint(curve, k / segments));
}

/**
 * Espelho de `control` pela mediatriz da corda `start`→`end`: a posição ao longo da corda se
 * inverte em torno do meio e o afastamento da corda fica. É a regra da curva simétrica.
 */
export function mirrorControl(start: Point, end: Point, control: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return control;
  const along =
    ((control.x - (start.x + end.x) / 2) * dx + (control.y - (start.y + end.y) / 2) * dy) /
    lengthSquared;
  return { x: control.x - 2 * along * dx, y: control.y - 2 * along * dy };
}

/**
 * Controles do arco padrão (US-06.1): a 1/3 e a 2/3 da corda, deslocados na perpendicular por
 * 1/4 do comprimento dela. Com y para baixo, o arco de uma corda da esquerda para a direita
 * sobe.
 */
export function defaultBezierControls(
  start: Point,
  end: Point,
): { readonly control1: Point; readonly control2: Point } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const offsetX = dy / 4;
  const offsetY = -dx / 4;
  return {
    control1: { x: start.x + dx / 3 + offsetX, y: start.y + dy / 3 + offsetY },
    control2: { x: start.x + (2 * dx) / 3 + offsetX, y: start.y + (2 * dy) / 3 + offsetY },
  };
}
