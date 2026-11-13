import { isFreeEndpoint } from './arrows.js';
import { isLabelable, type BoardNode, type CanvasNode, type ShapeNode } from './shapes.js';

/** Limites de tamanho de um documento. O host pode baixá-los, nunca subi-los. */
export interface CanvasLimits {
  /** Máximo de nós do documento. O padrão, e o teto, é 100.000. */
  readonly maxNodes?: number | undefined;
  /**
   * Maior valor absoluto de uma coordenada, dimensão ou largura de traço, em unidades do
   * documento. O padrão, e o teto, é 10.000.000: é até onde as conversões de coordenadas mantêm
   * a precisão prometida.
   */
  readonly maxCoordinate?: number | undefined;
  /** Máximo de caracteres em um nó de texto. O padrão, e o teto, é 1.000.000. */
  readonly maxTextLength?: number | undefined;
}

export const DEFAULT_LIMITS: Required<CanvasLimits> = Object.freeze(
  Object.defineProperty(
    {
      maxNodes: 100_000,
      maxCoordinate: 10_000_000,
    },
    'maxTextLength',
    {
      value: 1_000_000,
      writable: false,
      enumerable: false,
      configurable: false,
    },
  ) as Required<CanvasLimits>,
);

/**
 * Completa os limites dados com os padrões.
 *
 * @throws {TypeError} Se `limits` não for um objeto.
 * @throws {RangeError} Se um limite não for um número positivo até o padrão, ou se `maxNodes`
 * não for inteiro.
 */
export function resolveLimits(limits: CanvasLimits = {}): Required<CanvasLimits> {
  // Conferido sem estreitar o tipo: os limites continuam sendo lidos pelos nomes declarados.
  if (typeof limits !== 'object' || limits === null || Array.isArray(limits)) {
    throw new TypeError('limits must be an object');
  }
  const maxNodes = limits.maxNodes ?? DEFAULT_LIMITS.maxNodes;
  const maxCoordinate = limits.maxCoordinate ?? DEFAULT_LIMITS.maxCoordinate;
  const maxTextLength = limits.maxTextLength ?? DEFAULT_LIMITS.maxTextLength;
  if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > DEFAULT_LIMITS.maxNodes) {
    throw new RangeError(`limits.maxNodes must be an integer from 1 to ${DEFAULT_LIMITS.maxNodes}`);
  }
  // A comparação sozinha converteria texto ou objeto em número: o tipo é conferido antes.
  if (
    typeof maxCoordinate !== 'number' ||
    !(maxCoordinate > 0 && maxCoordinate <= DEFAULT_LIMITS.maxCoordinate)
  ) {
    throw new RangeError(
      `limits.maxCoordinate must be greater than 0 and at most ${DEFAULT_LIMITS.maxCoordinate}`,
    );
  }
  if (
    !Number.isInteger(maxTextLength) ||
    maxTextLength < 1 ||
    maxTextLength > DEFAULT_LIMITS.maxTextLength
  ) {
    throw new RangeError(
      `limits.maxTextLength must be an integer from 1 to ${DEFAULT_LIMITS.maxTextLength}`,
    );
  }
  return { maxNodes, maxCoordinate, maxTextLength };
}

/**
 * A coordenada, dimensão ou largura de traço do shape que mais passa do limite, em valor
 * absoluto, ou `undefined` se todas cabem. O traço conta mesmo sem cor: a largura fica guardada
 * e passa a pintar quando a cor voltar. Dentro do limite, toda caixa do shape é finita.
 */
export function coordinateOverflow(shape: CanvasNode, maxCoordinate: number): number | undefined {
  if (shape.type === 'group') return undefined;
  let values: number[];
  if (shape.type === 'line') {
    values = [shape.start.x, shape.start.y, shape.end.x, shape.end.y];
  } else if (shape.type === 'bezier') {
    values = [shape.start, shape.control1, shape.control2, shape.end].flatMap((p) => [p.x, p.y]);
  } else if (shape.type === 'arrow') {
    values = [];
    if (isFreeEndpoint(shape.start)) {
      values.push(shape.start.x, shape.start.y);
    } else {
      values.push(shape.start.anchor.x, shape.start.anchor.y);
    }
    if (isFreeEndpoint(shape.end)) {
      values.push(shape.end.x, shape.end.y);
    } else {
      values.push(shape.end.anchor.x, shape.end.anchor.y);
    }
  } else {
    values = [shape.x, shape.y, shape.width, shape.height];
  }
  // A espessura do traço à mão livre é fixa, por tipo, e nunca passa de 24.
  if ('strokeWidth' in shape.style) values.push(shape.style.strokeWidth);
  const largest = Math.max(...values.map(Math.abs));
  return largest > maxCoordinate ? largest : undefined;
}

/**
 * Quantidade de caracteres que excede o limite máximo para texto, ou `undefined` se respeita o
 * teto. Vale para o texto livre e para o texto dentro das formas (`label.text`).
 */
export function textLengthOverflow(
  shape: ShapeNode | BoardNode,
  maxTextLength: number,
): number | undefined {
  if (shape.type === 'text' && shape.text.length > maxTextLength) {
    return shape.text.length;
  }
  if (shape.type === 'board' && shape.title.length > maxTextLength) {
    return shape.title.length;
  }
  if (isLabelable(shape) && shape.label !== undefined && shape.label.text.length > maxTextLength) {
    return shape.label.text.length;
  }
  return undefined;
}
