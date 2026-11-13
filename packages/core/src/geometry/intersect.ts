import { isFreeEndpoint } from '../arrows.js';
import { inkStrokeWidth, inkStrokesToWorld } from '../ink.js';
import type {
  ArrowNode,
  BezierNode,
  BoardNode,
  BraceNode,
  ChevronNode,
  CircleNode,
  CrossNode,
  DiamondNode,
  EllipseNode,
  InkNode,
  LineNode,
  Point,
  PolygonNode,
  RectangleNode,
  ShapeNode,
  SquareNode,
  StickyNode,
  TextNode,
  TriangleNode,
} from '../shapes.js';
import {
  boundsContain,
  boundsFromPoints,
  boundsIntersect,
  shapeBounds,
  type Bounds,
} from './bounds.js';
import { FLATTEN_SHARE, flattenBezier } from './bezier.js';
import { flattenBrace } from './brace.js';
import { isConcaveOutline, pointInOutline, worldShapeOutline } from './outline.js';
import { rotatePoint } from './transform.js';
import { distanceToEllipse, distanceToPolygon, distanceToSegment, halfStroke } from './shapes.js';

const ORIGIN: Point = { x: 0, y: 0 };

/**
 * Retângulo girado em torno do próprio centro. `(cos, sin)` é a direção do lado de semi-comprimento
 * `halfWidth`; o de `halfHeight` fica na perpendicular.
 */
interface OrientedBox {
  readonly center: Point;
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly cos: number;
  readonly sin: number;
}

/**
 * O que o retângulo, o texto ou a linha pintam: a caixa alargada em meio stroke, ou o traço de pontas
 * retas, que sem traço visível se reduz ao segmento.
 */
function paintedBox(
  shape: RectangleNode | SquareNode | LineNode | TextNode | StickyNode | ArrowNode,
): OrientedBox {
  const stroke = halfStroke(shape.style);
  if (shape.type === 'line' || shape.type === 'arrow') {
    const start =
      shape.type === 'line'
        ? shape.start
        : isFreeEndpoint(shape.start)
          ? shape.start
          : { x: 0, y: 0 };
    const end =
      shape.type === 'line' ? shape.end : isFreeEndpoint(shape.end) ? shape.end : { x: 0, y: 0 };
    return segmentBox(start, end, stroke);
  }
  const halfWidth = shape.width / 2;
  const halfHeight = shape.height / 2;
  return {
    center: { x: shape.x + halfWidth, y: shape.y + halfHeight },
    halfWidth: halfWidth + stroke,
    halfHeight: halfHeight + stroke,
    cos: Math.cos(shape.rotation),
    sin: Math.sin(shape.rotation),
  };
}

/** Traço de pontas retas do segmento `start`→`end`, com meia largura `stroke`. */
function segmentBox(start: Point, end: Point, stroke: number): OrientedBox {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  // Pela hipotenusa, não pela soma dos quadrados: em uma linha muito curta os quadrados
  // somem, e o comprimento viraria zero.
  const length = Math.hypot(dx, dy) || 1;
  return {
    center: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    halfWidth: length / 2,
    halfHeight: stroke,
    // Pela razão dos catetos, sem passar por um ângulo: exato em linha reta nos eixos.
    cos: dx / length,
    sin: dy / length,
  };
}

/**
 * O traço da curva toca `rect`: cada trecho da polilinha que a aproxima vira o traço de pontas
 * retas dele, alargado pelo erro da aproximação para não errar por falta.
 */
function bezierIntersectsRect(shape: BezierNode, rect: Bounds): boolean {
  const stroke = halfStroke(shape.style);
  const error = stroke * FLATTEN_SHARE;
  const vertices = flattenBezier(shape, error);
  for (let i = 1; i < vertices.length; i++) {
    if (boxIntersectsRect(segmentBox(vertices[i - 1]!, vertices[i]!, stroke + error), rect)) {
      return true;
    }
  }
  return false;
}

/**
 * O traço da chave toca `rect`: a polilinha que aproxima o contorno, girada com a caixa, vira uma
 * sequência de traços de pontas retas alargados pelo erro da aproximação.
 */
function braceIntersectsRect(shape: BraceNode, rect: Bounds): boolean {
  const stroke = halfStroke(shape.style);
  const error = stroke * FLATTEN_SHARE;
  const center = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  const vertices = flattenBrace(shape, error).map((vertex) =>
    shape.rotation === 0 ? vertex : rotatePoint(vertex, center, shape.rotation),
  );
  for (let i = 1; i < vertices.length; i++) {
    if (boxIntersectsRect(segmentBox(vertices[i - 1]!, vertices[i]!, stroke + error), rect)) {
      return true;
    }
  }
  return false;
}

/**
 * Os traços do elemento, girados com a caixa, tocam `rect`: cada trecho vira um traço de pontas
 * retas e cada vértice, um quadrado do tamanho da espessura, o que cobre a junta e o pingo.
 */
function inkIntersectsRect(shape: InkNode, rect: Bounds): boolean {
  for (const stroke of inkStrokesToWorld(shape)) {
    const reach = inkStrokeWidth(stroke.kind, stroke.width) / 2;
    let previous: Point | undefined;
    for (const vertex of stroke.points) {
      const square: OrientedBox = {
        center: vertex,
        halfWidth: reach,
        halfHeight: reach,
        cos: 1,
        sin: 0,
      };
      if (boxIntersectsRect(square, rect)) return true;
      if (previous !== undefined && boxIntersectsRect(segmentBox(previous, vertex, reach), rect)) {
        return true;
      }
      previous = vertex;
    }
  }
  return false;
}

/**
 * Eixos separadores: duas formas convexas não se tocam só se, em algum eixo, as sombras delas
 * ficam afastadas. Para dois retângulos bastam os dois eixos de cada um.
 */
function boxIntersectsRect(box: OrientedBox, rect: Bounds): boolean {
  const rectHalfWidth = rect.width / 2;
  const rectHalfHeight = rect.height / 2;
  const dx = rect.x + rectHalfWidth - box.center.x;
  const dy = rect.y + rectHalfHeight - box.center.y;
  const cos = Math.abs(box.cos);
  const sin = Math.abs(box.sin);
  return (
    Math.abs(dx) <= rectHalfWidth + box.halfWidth * cos + box.halfHeight * sin &&
    Math.abs(dy) <= rectHalfHeight + box.halfWidth * sin + box.halfHeight * cos &&
    Math.abs(dx * box.cos + dy * box.sin) <=
      box.halfWidth + rectHalfWidth * cos + rectHalfHeight * sin &&
    Math.abs(dy * box.cos - dx * box.sin) <=
      box.halfHeight + rectHalfWidth * sin + rectHalfHeight * cos
  );
}

/** Polígonos pintados por contorno: `DiamondNode`, `TriangleNode`, `PolygonNode` e `CrossNode`. */
type OutlinedShape = DiamondNode | TriangleNode | PolygonNode | CrossNode | ChevronNode;

/** Alguma aresta do contorno, alargada em `stroke`, toca o retângulo. */
function edgesTouchRect(vertices: readonly Point[], stroke: number, rect: Bounds): boolean {
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const start = vertices[i]!;
    const end = vertices[(i + 1) % n]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    const edgeBox: OrientedBox = {
      center: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
      halfWidth: length / 2 + stroke,
      halfHeight: stroke,
      cos: dx / length,
      sin: dy / length,
    };
    if (boxIntersectsRect(edgeBox, rect)) return true;
  }
  return false;
}

/**
 * Verifica se o traço ou o interior de um polígono (convexo ou com reentrâncias) toca `rect`.
 * Tocar é ter um canto do retângulo dentro do polígono ou a meio stroke dele, ou uma aresta
 * alargada que cruza o retângulo; o segundo caso cobre o polígono que cabe todo dentro de `rect`.
 */
function outlineIntersectsRect(shape: OutlinedShape, rect: Bounds): boolean {
  const vertices = worldShapeOutline(shape);
  const stroke = halfStroke(shape.style);
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const rectCorners: readonly Point[] = [
    { x: rect.x, y: rect.y },
    { x: right, y: rect.y },
    { x: right, y: bottom },
    { x: rect.x, y: bottom },
  ];

  for (const corner of rectCorners) {
    if (pointInOutline(shape, corner, vertices) || distanceToPolygon(corner, vertices) <= stroke) {
      return true;
    }
  }

  return edgesTouchRect(vertices, stroke, rect);
}

/** Os quatro cantos de `rect` no referencial da elipse: centro na origem e eixos alinhados. */
function cornersInEllipseFrame(
  shape: EllipseNode | CircleNode,
  rect: Bounds,
): [Point, Point, Point, Point] {
  const center = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  const cos = Math.cos(shape.rotation);
  const sin = Math.sin(shape.rotation);
  const toLocal = (x: number, y: number): Point => {
    const dx = x - center.x;
    const dy = y - center.y;
    return { x: dx * cos + dy * sin, y: dy * cos - dx * sin };
  };
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return [
    toLocal(rect.x, rect.y),
    toLocal(right, rect.y),
    toLocal(right, bottom),
    toLocal(rect.x, bottom),
  ];
}

// Passos da busca do ponto de um lado do retângulo mais próximo da elipse. Cada passo reduz o
// trecho a dois terços: 40 passos deixam um erro abaixo de um décimo de milionésimo do lado.
const EDGE_STEPS = 40;

/**
 * Menor distância de um segmento ao contorno da elipse, para um segmento todo fora dela. Fora
 * de uma forma convexa, a distância a ela é uma função convexa do ponto: ao longo do segmento
 * tem um só vale, que a busca ternária encontra.
 */
function segmentToEllipse(from: Point, to: Point, a: number, b: number): number {
  const at = (t: number): number =>
    distanceToEllipse(
      Math.abs(from.x + (to.x - from.x) * t),
      Math.abs(from.y + (to.y - from.y) * t),
      a,
      b,
    );
  let low = 0;
  let high = 1;
  for (let step = 0; step < EDGE_STEPS; step += 1) {
    const third = (high - low) / 3;
    if (at(low + third) < at(high - third)) high -= third;
    else low += third;
  }
  return at((low + high) / 2);
}

function ellipseIntersectsRect(shape: EllipseNode | CircleNode, rect: Bounds): boolean {
  const a = shape.width / 2;
  const b = shape.height / 2;
  const corners = cornersInEllipseFrame(shape, rect);
  const last = corners[3];

  // A elipse sem o traço: no referencial em que ela é o círculo unitário, `rect` vira um
  // paralelogramo, e tocá-la é conter o centro ou ter um lado a no máximo 1 da origem.
  const center = { x: shape.x + a, y: shape.y + b };
  if (boundsContain(rect, { ...center, width: 0, height: 0 })) return true;
  const toUnit = (corner: Point): Point => ({ x: corner.x / a, y: corner.y / b });
  let previous = last;
  for (const corner of corners) {
    if (distanceToSegment(ORIGIN, toUnit(previous), toUnit(corner)) <= 1) return true;
    previous = corner;
  }

  // Sem tocar a elipse, o retângulo está todo fora dela: toca o traço se algum lado dele chega
  // a meio stroke do contorno.
  const stroke = halfStroke(shape.style);
  if (stroke === 0) return false;
  previous = last;
  for (const corner of corners) {
    if (segmentToEllipse(previous, corner, a, b) <= stroke) return true;
    previous = corner;
  }
  return false;
}

/** Caixa justa do traço de pontas retas: a do segmento, mais a projeção de meio stroke na normal. */
function lineStrokeBounds(shape: LineNode): Bounds {
  const box = boundsFromPoints(shape.start, shape.end);
  const stroke = halfStroke(shape.style);
  const length = Math.hypot(box.width, box.height);
  const growX = (stroke * box.height) / length;
  const growY = (stroke * box.width) / length;
  return {
    x: box.x - growX,
    y: box.y - growY,
    width: box.width + 2 * growX,
    height: box.height + 2 * growY,
  };
}

/**
 * Diz se o retângulo fica inteiro no miolo de uma forma sem preenchimento, sem encostar no
 * contorno: aí não há nada pintado para tocar. O miolo é a forma encolhida em meio stroke.
 */
function insideHollow(
  shape:
    | RectangleNode
    | SquareNode
    | EllipseNode
    | CircleNode
    | DiamondNode
    | TriangleNode
    | PolygonNode
    | CrossNode
    | ChevronNode
    | TextNode
    | StickyNode,
  rect: Bounds,
): boolean {
  if (shape.type === 'text') return false;
  if (shape.style.fill !== null) return false;
  const stroke = halfStroke(shape.style);
  const a = shape.width / 2;
  const b = shape.height / 2;

  if (
    shape.type === 'diamond' ||
    shape.type === 'triangle' ||
    shape.type === 'polygon' ||
    shape.type === 'cross' ||
    shape.type === 'chevron'
  ) {
    const vertices = worldShapeOutline(shape);
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    const corners: readonly Point[] = [
      { x: rect.x, y: rect.y },
      { x: right, y: rect.y },
      { x: right, y: bottom },
      { x: rect.x, y: bottom },
    ];
    const cornersInside = corners.every(
      (corner) =>
        pointInOutline(shape, corner, vertices) && distanceToPolygon(corner, vertices) > stroke,
    );
    // Com reentrâncias, quatro cantos dentro não bastam: uma ponta do contorno pode entrar no retângulo.
    return cornersInside && (!isConcaveOutline(shape) || !edgesTouchRect(vertices, stroke, rect));
  }

  if (shape.type === 'ellipse' || shape.type === 'circle') {
    // Dentro de uma forma convexa, a distância ao contorno é côncava: sobre o retângulo, o
    // menor valor está em um canto. Basta os quatro cantos ficarem dentro da elipse e a mais
    // de meio stroke do contorno.
    return cornersInEllipseFrame(shape, rect).every((corner) => {
      const dx = Math.abs(corner.x);
      const dy = Math.abs(corner.y);
      return (dx / a) ** 2 + (dy / b) ** 2 < 1 && distanceToEllipse(dx, dy, a, b) > stroke;
    });
  }

  // O miolo do retângulo é o retângulo encolhido em meio stroke, convexo: o retângulo de
  // seleção cabe nele quando os quatro cantos cabem. Traço que fecha o miolo não deixa buraco.
  const center = { x: shape.x + a, y: shape.y + b };
  const cos = Math.cos(shape.rotation);
  const sin = Math.sin(shape.rotation);
  return [rect.x, rect.x + rect.width].every((x) =>
    [rect.y, rect.y + rect.height].every((y) => {
      const dx = x - center.x;
      const dy = y - center.y;
      return (
        Math.abs(dx * cos + dy * sin) < a - stroke && Math.abs(dy * cos - dx * sin) < b - stroke
      );
    }),
  );
}

/**
 * O que a forma pinta (com o stroke visível) toca ou cruza o retângulo. Encostar conta.
 *
 * Usa a geometria, não a caixa: retângulo e elipse girados contam pela forma girada, e a linha
 * pelo traço de pontas retas. Forma sem preenchimento só é tocada no contorno, como no
 * hit-test: um retângulo inteiro dentro do miolo dela não a toca.
 *
 * Na elipse, o traço é medido pela distância ao contorno, como em `pointInShape`.
 */
export function shapeIntersectsRect(shape: ShapeNode | BoardNode, rect: Bounds): boolean {
  // O que não toca a caixa do shape não toca o shape: descarta cedo o que está longe, antes
  // das contas mais caras da forma exata.
  if (!boundsIntersect(shapeBounds(shape), rect)) return false;
  // O board é um retângulo cheio, com a faixa do título: tocar a caixa é tocá-lo.
  if (shape.type === 'board') return true;
  if (shape.type === 'line' || shape.type === 'arrow') {
    return boxIntersectsRect(paintedBox(shape), rect);
  }
  if (shape.type === 'bezier') return bezierIntersectsRect(shape, rect);
  if (shape.type === 'brace') return braceIntersectsRect(shape, rect);
  if (shape.type === 'ink') return inkIntersectsRect(shape, rect);
  const touches =
    shape.type === 'ellipse' || shape.type === 'circle'
      ? ellipseIntersectsRect(shape, rect)
      : shape.type === 'diamond' ||
          shape.type === 'triangle' ||
          shape.type === 'polygon' ||
          shape.type === 'cross' ||
          shape.type === 'chevron'
        ? outlineIntersectsRect(shape, rect)
        : boxIntersectsRect(paintedBox(shape), rect);
  return touches && !insideHollow(shape, rect);
}

/** A forma inteira (com o stroke visível) cabe no retângulo. Borda coincidente conta. */
export function shapeInsideRect(shape: ShapeNode | BoardNode, rect: Bounds): boolean {
  // A caixa de shapeBounds é justa para retângulo e elipse; a da linha sobra além das pontas.
  return boundsContain(rect, shape.type === 'line' ? lineStrokeBounds(shape) : shapeBounds(shape));
}
