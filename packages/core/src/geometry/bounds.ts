import { isFreeEndpoint, resolveEndpoint } from '../arrows.js';
import type { BoardNode, Point, ShapeNode } from '../shapes.js';
import { bezierBounds } from './bezier.js';
import { boardBox } from './board.js';
import { worldShapeOutline } from './outline.js';
import { halfStroke } from './shapes.js';

/** Caixa alinhada aos eixos. `(x, y)` é o canto de menor coordenada. */
export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ShapeBoundsOptions {
  /**
   * `true` (padrão) dá a caixa do que é pintado, com o traço: serve a culling e ao índice
   * espacial. `false` dá a caixa só da geometria: serve a moldura de seleção, resize e snapping.
   */
  readonly stroke?: boolean | undefined;
  /** Resolvedor opcional de nós para setas com endpoints vinculados. */
  readonly getNode?: ((id: string) => ShapeNode | undefined) | undefined;
}

function centeredBounds(center: Point, extentX: number, extentY: number): Bounds {
  return { x: center.x - extentX, y: center.y - extentY, width: 2 * extentX, height: 2 * extentY };
}

/** Caixa de um shape, já com a rotação aplicada. */
export function shapeBounds(
  shape: ShapeNode | BoardNode,
  options: ShapeBoundsOptions = {},
): Bounds {
  if (shape.type === 'board') return boardBox(shape, options.stroke !== false);
  const stroke = options.stroke === false ? 0 : halfStroke(shape.style);
  if (shape.type === 'line') {
    // A caixa do segmento alargada em meio stroke cobre a ponta reta e a redonda.
    const box = boundsFromPoints(shape.start, shape.end);
    return {
      x: box.x - stroke,
      y: box.y - stroke,
      width: box.width + 2 * stroke,
      height: box.height + 2 * stroke,
    };
  }

  if (shape.type === 'bezier') {
    // Caixa exata da curva: a dos pontos de controle sobraria além do arco.
    const box = bezierBounds(shape);
    return {
      x: box.x - stroke,
      y: box.y - stroke,
      width: box.width + 2 * stroke,
      height: box.height + 2 * stroke,
    };
  }

  if (shape.type === 'arrow') {
    const getNode = options.getNode;
    const start = isFreeEndpoint(shape.start)
      ? shape.start
      : getNode
        ? resolveEndpoint(shape.start, getNode)
        : { x: 0, y: 0 };
    const end = isFreeEndpoint(shape.end)
      ? shape.end
      : getNode
        ? resolveEndpoint(shape.end, getNode)
        : { x: 0, y: 0 };

    const markerPadding =
      shape.startMarker !== 'none' || shape.endMarker !== 'none'
        ? Math.max(stroke, (shape.style.strokeWidth || 1) * 3)
        : stroke;
    const padding = options.stroke === false ? 0 : markerPadding;
    const box = boundsFromPoints(start, end);
    return {
      x: box.x - padding,
      y: box.y - padding,
      width: box.width + 2 * padding,
      height: box.height + 2 * padding,
    };
  }

  // Sem rotação, a caixa sai direto dos campos do shape. Passar pelo centro arredondaria duas
  // vezes, e a caixa de um shape em (0,1; 0,1) deixaria de coincidir com ele.
  if (shape.rotation === 0) {
    return {
      x: shape.x - stroke,
      y: shape.y - stroke,
      width: shape.width + 2 * stroke,
      height: shape.height + 2 * stroke,
    };
  }

  if (
    shape.type === 'diamond' ||
    shape.type === 'triangle' ||
    shape.type === 'polygon' ||
    shape.type === 'cross' ||
    shape.type === 'chevron'
  ) {
    const vertices = worldShapeOutline(shape);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const v of vertices) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }
    return {
      x: minX - stroke,
      y: minY - stroke,
      width: maxX - minX + 2 * stroke,
      height: maxY - minY + 2 * stroke,
    };
  }

  const halfWidth = shape.width / 2;
  const halfHeight = shape.height / 2;
  const center = { x: shape.x + halfWidth, y: shape.y + halfHeight };
  const cos = Math.cos(shape.rotation);
  const sin = Math.sin(shape.rotation);

  if (
    shape.type === 'rectangle' ||
    shape.type === 'square' ||
    shape.type === 'text' ||
    shape.type === 'brace' ||
    shape.type === 'ink'
  ) {
    // Caixa dos quatro cantos do retângulo já alargado: o canto em esquadria do traço gira junto.
    const a = halfWidth + stroke;
    const b = halfHeight + stroke;
    return centeredBounds(
      center,
      Math.abs(a * cos) + Math.abs(b * sin),
      Math.abs(a * sin) + Math.abs(b * cos),
    );
  }

  // O traço fica a meio stroke da curva em toda direção: alarga-se a caixa da curva girada.
  // Girar a elipse de semi-eixos alargados daria uma caixa menor que o traço.
  return centeredBounds(
    center,
    Math.sqrt((halfWidth * cos) ** 2 + (halfHeight * sin) ** 2) + stroke,
    Math.sqrt((halfWidth * sin) ** 2 + (halfHeight * cos) ** 2) + stroke,
  );
}

/** Diz se as caixas se tocam. Encostar em um lado ou em um canto conta. */
export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return (
    a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
  );
}

/** Diz se `inner` cabe inteira em `outer`. Borda coincidente conta. */
export function boundsContain(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Menor caixa que cobre as duas. */
export function boundsUnion(a: Bounds, b: Bounds): Bounds {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Caixa com `a` e `b` em cantos opostos, dados em qualquer ordem. */
export function boundsFromPoints(a: Point, b: Point): Bounds {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}
