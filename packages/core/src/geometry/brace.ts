import type { Point } from '../arrows.js';
import { bezierPoint } from './bezier.js';
import type { BoxGeometry } from './fit.js';

/** Para onde a ponta central aponta: `left` desenha `{`, `right` desenha `}`. */
export type BraceOrientation = 'left' | 'right' | 'up' | 'down';

/** O que o contorno da chave lê do nó. */
export interface BraceGeometry extends BoxGeometry {
  readonly orientation: BraceOrientation;
  /** Posição da ponta ao longo do eixo da chave, de 0 a 1. */
  readonly tipPosition: number;
  /** De 0 (cantos vivos) a 1 (raio máximo). */
  readonly curvature: number;
}

export type BraceSegment =
  | { readonly kind: 'line'; readonly to: Point }
  | {
      readonly kind: 'curve';
      readonly control1: Point;
      readonly control2: Point;
      readonly to: Point;
    };

/** Contorno da chave: um ponto de partida e os trechos, em coordenadas de mundo sem rotação. */
export interface BracePath {
  readonly start: Point;
  readonly segments: readonly BraceSegment[];
  /** Raio dos quatro arcos, em unidades de mundo. */
  readonly radius: number;
}

/** Controle de um quarto de círculo por uma cúbica: `4/3 · (√2 − 1)`. */
const KAPPA = 0.5522847498307936;

/** Teto de trechos por arco do achatamento: segura o custo com tolerância zero ou ínfima. */
const MAX_ARC_STEPS = 64;

/** Eixo da chave (onde a espinha corre) e profundidade (da ponta às pernas das pontas). */
function axes(node: BraceGeometry): { length: number; depth: number } {
  const vertical = node.orientation === 'left' || node.orientation === 'right';
  return vertical
    ? { length: node.height, depth: node.width }
    : { length: node.width, depth: node.height };
}

/**
 * Raio dos arcos: `curvature` vezes o maior raio que cabe, que é o menor entre a profundidade
 * dividida em duas (um arco e a espinha) e metade do menor trecho reto da espinha.
 */
export function braceRadius(node: BraceGeometry): number {
  const { length, depth } = axes(node);
  const tip = node.tipPosition * length;
  return node.curvature * Math.min(depth / 2, Math.min(tip, length - tip) / 2);
}

/**
 * Contorno da chave. A ponta fica na borda da caixa e as duas pernas das pontas na borda oposta;
 * a espinha corre a um raio da ponta, e cada canto é um quarto de círculo (cúbica). Com raio zero
 * é a polilinha de cantos vivos. O contorno cabe todo na caixa e encosta nos quatro lados dela.
 */
export function bracePath(node: BraceGeometry): BracePath {
  const { length, depth } = axes(node);
  const tip = node.tipPosition * length;
  const radius = braceRadius(node);
  const k = KAPPA * radius;
  const r = radius;

  // (u, v): `u` ao longo da espinha, `v` da ponta (0) às pernas (depth).
  const at = (u: number, v: number): Point => {
    switch (node.orientation) {
      case 'left':
        return { x: node.x + v, y: node.y + u };
      case 'right':
        return { x: node.x + node.width - v, y: node.y + u };
      case 'up':
        return { x: node.x + u, y: node.y + v };
      case 'down':
        return { x: node.x + u, y: node.y + node.height - v };
    }
  };
  const line = (u: number, v: number): BraceSegment => ({ kind: 'line', to: at(u, v) });
  const curve = (
    c1: [number, number],
    c2: [number, number],
    to: [number, number],
  ): BraceSegment => ({
    kind: 'curve',
    control1: at(...c1),
    control2: at(...c2),
    to: at(...to),
  });

  return {
    start: at(0, depth),
    radius,
    segments: [
      line(0, 2 * r),
      curve([0, 2 * r - k], [r - k, r], [r, r]),
      line(tip - r, r),
      curve([tip - r + k, r], [tip, k], [tip, 0]),
      curve([tip, k], [tip + r - k, r], [tip + r, r]),
      line(length - r, r),
      curve([length - r + k, r], [length, 2 * r - k], [length, 2 * r]),
      line(length, depth),
    ],
  };
}

/** Caixa da chave, sem o traço: o contorno fica todo dentro dela. */
export function braceBounds(node: BoxGeometry): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

/**
 * Polilinha que fica a até `tolerance` do contorno, em coordenadas de mundo sem rotação. Cada
 * arco de raio `r` com `n` trechos se afasta da corda no máximo `r · θ² / 8`, com `θ = π / 2n`.
 * Tolerância zero, negativa ou não finita usa o teto de trechos.
 */
export function flattenBrace(node: BraceGeometry, tolerance: number): readonly Point[] {
  const { start, segments, radius } = bracePath(node);
  const steps =
    radius === 0
      ? 1
      : tolerance > 0 && Number.isFinite(tolerance)
        ? Math.min(
            MAX_ARC_STEPS,
            Math.max(2, Math.ceil((Math.PI / 2) * Math.sqrt(radius / (8 * tolerance)))),
          )
        : MAX_ARC_STEPS;

  const points: Point[] = [start];
  let from = start;
  for (const segment of segments) {
    if (segment.kind === 'curve' && steps > 1) {
      const bezier = {
        start: from,
        control1: segment.control1,
        control2: segment.control2,
        end: segment.to,
      };
      for (let i = 1; i < steps; i++) points.push(bezierPoint(bezier, i / steps));
    }
    points.push(segment.to);
    from = segment.to;
  }
  return points;
}
