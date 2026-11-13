import { isFreeEndpoint } from '../arrows.js';
import { inkStrokeWidth } from '../ink.js';
import { shapeLabelArea } from '../label-area.js';
import { isLabelable } from '../shapes.js';
import type { BoardNode, InkNode, InkStyle, Point, ShapeNode, StrokeStyle } from '../shapes.js';
import { FLATTEN_SHARE, flattenBezier } from './bezier.js';
import { boardBox, boardHalfStroke } from './board.js';
import { flattenBrace } from './brace.js';
import { pointInOutline, shapeOutline } from './outline.js';
import { rotatePoint } from './transform.js';

/**
 * Metade da largura do traço pintado: zero quando o traço não tem cor ou não tem largura. O traço
 * à mão livre não tem contorno: a espessura é de cada traço e já está dentro da caixa.
 */
export function halfStroke(style: StrokeStyle | InkStyle): number {
  if (!('stroke' in style)) return 0;
  return style.stroke === null ? 0 : style.strokeWidth / 2;
}

/**
 * O ponto atinge o board: o retângulo com a faixa do título, e até um alcance (meia borda mais a
 * tolerância) para fora dele. O fundo é cheio mesmo sem preenchimento: o board vazio continua
 * clicável.
 */
function pointInBoard(board: BoardNode, point: Point, tolerance: number): boolean {
  const box = boardBox(board, false);
  const reach = boardHalfStroke(board) + tolerance;
  return (
    point.x >= box.x - reach &&
    point.x <= box.x + box.width + reach &&
    point.y >= box.y - reach &&
    point.y <= box.y + box.height + reach
  );
}

/**
 * O ponto atinge algum traço do elemento: a distância dele a um segmento (ou a um pingo) é de
 * até metade da espessura do traço mais a tolerância. O vazio da caixa não atinge.
 */
function pointInInk(shape: InkNode, point: Point, tolerance: number): boolean {
  const center = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  // No referencial da caixa, sem rotação, os pontos locais viram coordenadas diretas.
  const local = shape.rotation === 0 ? point : rotatePoint(point, center, -shape.rotation);
  if (
    local.x < shape.x - tolerance ||
    local.x > shape.x + shape.width + tolerance ||
    local.y < shape.y - tolerance ||
    local.y > shape.y + shape.height + tolerance
  ) {
    return false;
  }
  for (const stroke of shape.strokes) {
    const reach = inkStrokeWidth(stroke.kind, stroke.width) / 2 + tolerance;
    let previous: Point | undefined;
    for (const p of stroke.points) {
      const current = { x: shape.x + p.x * shape.width, y: shape.y + p.y * shape.height };
      if (distanceToSegment(local, previous ?? current, current) <= reach) return true;
      previous = current;
    }
  }
  return false;
}

export function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const px = point.x - start.x;
  const py = point.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  // Segmento de comprimento zero não tem direção em que projetar: vale a distância ao ponto.
  const along =
    lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, (px * dx + py * dy) / lengthSquared));
  const offX = px - along * dx;
  const offY = py - along * dy;
  return Math.sqrt(offX * offX + offY * offY);
}

/** Menor distância euclidiana de `point` aos segmentos de uma polilinha aberta. */
export function distanceToPolyline(point: Point, vertices: readonly Point[]): number {
  let minDistance = Infinity;
  for (let i = 1; i < vertices.length; i++) {
    const dist = distanceToSegment(point, vertices[i - 1]!, vertices[i]!);
    if (dist < minDistance) minDistance = dist;
  }
  return minDistance;
}

/** Menor distância euclidiana de `point` às arestas fechadas de um polígono. */
export function distanceToPolygon(point: Point, vertices: readonly Point[]): number {
  const n = vertices.length;
  let minDistance = Infinity;
  for (let i = 0; i < n; i++) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % n]!;
    const dist = distanceToSegment(point, a, b);
    if (dist < minDistance) minDistance = dist;
  }
  return minDistance;
}

// Passos da bisseção que acha o ponto mais próximo da elipse. Cada passo corta o intervalo ao
// meio: 64 esgotam a precisão de um número de ponto flutuante.
const ELLIPSE_STEPS = 64;
// Abaixo disto o divisor do y do ponto mais próximo já não tem dígitos confiáveis. É a raiz da
// precisão de um número de ponto flutuante: o ponto em que as duas contas do y erram igual.
const NEAR_AXIS = 1e-8;

/**
 * Distância de um ponto ao contorno de uma elipse centrada na origem e alinhada aos eixos, com
 * semi-eixos `a` e `b` positivos. `dx` e `dy` são as distâncias do ponto ao centro, sem sinal:
 * pela simetria, basta o primeiro quadrante.
 *
 * O ponto mais próximo do contorno é onde a normal da elipse passa pelo ponto dado. Essa
 * condição vira uma equação de uma variável, crescente, resolvida por bisseção (David Eberly,
 * "Distance from a Point to an Ellipse").
 */
export function distanceToEllipse(dx: number, dy: number, a: number, b: number): number {
  // O método pede o semi-eixo maior primeiro.
  if (a < b) return distanceToEllipse(dy, dx, b, a);
  if (dy === 0) {
    // Sobre o eixo maior, o ponto mais próximo só é a ponta da elipse a partir de certa
    // distância do centro; mais perto dele, fica acima do eixo.
    const focal = a * a - b * b;
    if (a * dx >= focal) return Math.abs(dx - a);
    const ratio = (a * dx) / focal;
    return Math.hypot(a * ratio - dx, b * Math.sqrt(1 - ratio * ratio));
  }

  const scaledX = dx / a;
  const scaledY = dy / b;
  const squareRatio = (a / b) ** 2;
  const numerator = squareRatio * scaledX;
  // A raiz está entre estes dois valores; fora da elipse o intervalo começa abaixo de zero.
  let low = scaledY - 1;
  let high = scaledX * scaledX + scaledY * scaledY < 1 ? 0 : Math.hypot(numerator, scaledY) - 1;
  for (let step = 0; step < ELLIPSE_STEPS; step += 1) {
    const middle = (low + high) / 2;
    const value = (numerator / (middle + squareRatio)) ** 2 + (scaledY / (middle + 1)) ** 2;
    if (value > 1) low = middle;
    else high = middle;
  }
  const root = (low + high) / 2;
  const nearestX = (squareRatio * dx) / (root + squareRatio);
  // O y do ponto mais próximo é `dy / (root + 1)`. Com o ponto quase sobre o eixo maior e
  // entre os focos, `root + 1` chega perto de zero e a divisão perde todos os dígitos; aí o y
  // sai da equação da elipse, a partir do x, que continua bem determinado.
  const divisor = root + 1;
  const nearestY =
    divisor > NEAR_AXIS ? dy / divisor : b * Math.sqrt(Math.max(0, 1 - (nearestX / a) ** 2));
  return Math.hypot(nearestX - dx, nearestY - dy);
}

/** Opções de {@link pointInShape}. */
export interface PointInShapeOptions {
  /** A área inscrita do texto conta como interior da forma elegível, mesmo sem texto. */
  readonly labelAreas?: boolean | undefined;
}

function hasLabelText(shape: { readonly label?: { readonly text: string } | undefined }): boolean {
  return shape.label !== undefined && shape.label.text !== '';
}

/**
 * Diz se o ponto (mundo) atinge o shape, com folga `tolerance` em unidades de mundo (≥ 0).
 *
 * O alcance é meio stroke visível mais a tolerância. Com preenchimento, atinge em toda a forma
 * e até um alcance para fora dela; sem preenchimento, só na faixa do contorno, um alcance para
 * fora e um para dentro; sem preenchimento nem traço visível, nunca. A linha atinge até um
 * alcance de distância do segmento, e só com traço visível; a curva Bézier, idem, medida na
 * polilinha que a aproxima, com o erro dela somado ao alcance. `visible` e `locked` não entram aqui.
 *
 * No retângulo a faixa tem o canto em esquadria, como a junta do traço. Na elipse, a faixa é
 * medida pela distância do ponto ao contorno.
 */
export function pointInShape(
  shape: ShapeNode | BoardNode,
  point: Point,
  tolerance: number,
  options: PointInShapeOptions = {},
): boolean {
  if (shape.type === 'board') return pointInBoard(shape, point, tolerance);
  if (shape.type === 'ink') return pointInInk(shape, point, tolerance);
  const stroke = halfStroke(shape.style);
  const reach = stroke + tolerance;
  if (shape.type === 'line') {
    return stroke > 0 && distanceToSegment(point, shape.start, shape.end) <= reach;
  }

  if (shape.type === 'bezier') {
    const error = reach * FLATTEN_SHARE;
    return stroke > 0 && distanceToPolyline(point, flattenBezier(shape, error)) <= reach + error;
  }

  if (shape.type === 'brace') {
    // A chave só tem traço: mede-se a distância à polilinha no referencial da caixa, sem rotação.
    const center = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
    const local = rotatePoint(point, center, -shape.rotation);
    const error = reach * FLATTEN_SHARE;
    return stroke > 0 && distanceToPolyline(local, flattenBrace(shape, error)) <= reach + error;
  }

  if (shape.type === 'arrow') {
    const start = isFreeEndpoint(shape.start) ? shape.start : { x: 0, y: 0 };
    const end = isFreeEndpoint(shape.end) ? shape.end : { x: 0, y: 0 };
    return stroke > 0 && distanceToSegment(point, start, end) <= reach;
  }

  const halfWidth = shape.width / 2;
  const halfHeight = shape.height / 2;
  const center = { x: shape.x + halfWidth, y: shape.y + halfHeight };
  // No referencial do shape a forma fica alinhada aos eixos e simétrica: basta um quadrante.
  const local = rotatePoint(point, center, -shape.rotation);

  // O texto da forma é clicável pela área inscrita, mesmo sem preenchimento e sem contorno.
  // Com `labelAreas`, a área conta também sem texto (o duplo clique que abre o editor).
  if (isLabelable(shape) && (options.labelAreas === true || hasLabelText(shape))) {
    const area = shapeLabelArea(shape);
    if (
      area !== null &&
      local.x >= area.x &&
      local.x <= area.x + area.width &&
      local.y >= area.y &&
      local.y <= area.y + area.height
    ) {
      return true;
    }
  }

  const filled = shape.style.fill !== null;
  if (!filled && stroke === 0) return false;

  if (
    shape.type === 'diamond' ||
    shape.type === 'triangle' ||
    shape.type === 'polygon' ||
    shape.type === 'cross' ||
    shape.type === 'chevron'
  ) {
    const vertices = shapeOutline(shape);
    const inside = pointInOutline(shape, local, vertices);
    return (filled && inside) || distanceToPolygon(local, vertices) <= reach;
  }

  const dx = Math.abs(local.x - center.x);
  const dy = Math.abs(local.y - center.y);

  if (shape.type === 'ellipse' || shape.type === 'circle') {
    const inside = (dx / halfWidth) ** 2 + (dy / halfHeight) ** 2 <= 1;
    return (filled && inside) || distanceToEllipse(dx, dy, halfWidth, halfHeight) <= reach;
  }

  // Distância com sinal à borda do retângulo, pelo lado mais próximo: negativa dentro dele.
  const outside = Math.max(dx - halfWidth, dy - halfHeight);
  if (outside > reach) return false;
  // Sem preenchimento, o miolo a mais de um alcance da borda é um buraco.
  return filled || outside >= -reach;
}
