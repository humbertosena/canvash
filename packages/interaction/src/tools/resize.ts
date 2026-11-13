import {
  bezierBounds,
  isFreeEndpoint,
  layoutText,
  mirrorControl,
  type ArrowNode,
  type BezierNode,
  type BoardNode,
  type Bounds,
  type RectangleNode,
  type Point,
  type PreviewShape,
  type ShapeNode,
  type TextNode,
} from '@canvash/core';
import { toPreviewShape } from '../transform.js';

/** Identificador de cada um dos 8 handles de caixa, das 2 pontas e dos 2 controles da curva Bézier. */
export type ResizeHandleId =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'tl'
  | 'tc'
  | 'tr'
  | 'rc'
  | 'br'
  | 'bc'
  | 'bl'
  | 'lc'
  | 'start'
  | 'end'
  | 'control1'
  | 'control2';

/** Posição de um handle de redimensionamento no espaço de coordenadas de mundo. */
export interface ResizeHandlePoint {
  readonly id: ResizeHandleId;
  readonly x: number;
  readonly y: number;
}

/**
 * Normaliza sinônimos de identificadores de handle (ex: 'tl' -> 'nw', 'br' -> 'se').
 */
export function normalizeHandleId(
  id: ResizeHandleId,
): 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'start' | 'end' | 'control1' | 'control2' {
  switch (id) {
    case 'tl':
      return 'nw';
    case 'tc':
      return 'n';
    case 'tr':
      return 'ne';
    case 'rc':
      return 'e';
    case 'br':
      return 'se';
    case 'bc':
      return 's';
    case 'bl':
      return 'sw';
    case 'lc':
      return 'w';
    default:
      return id;
  }
}

/**
 * Retorna as posições de todos os handles de redimensionamento do shape em coordenadas de mundo.
 */
export function getShapeResizeHandles(shape: ShapeNode | BoardNode): readonly ResizeHandlePoint[] {
  if (shape.type === 'board') {
    // O board não gira: as 8 alças ficam no retângulo dele, sem a faixa do título.
    const { x, y, width, height } = shape;
    const right = x + width;
    const bottom = y + height;
    const midX = x + width / 2;
    const midY = y + height / 2;
    return [
      { id: 'nw', x, y },
      { id: 'n', x: midX, y },
      { id: 'ne', x: right, y },
      { id: 'e', x: right, y: midY },
      { id: 'se', x: right, y: bottom },
      { id: 's', x: midX, y: bottom },
      { id: 'sw', x, y: bottom },
      { id: 'w', x, y: midY },
    ];
  }

  if (shape.type === 'bezier') {
    // Pontas e controles antes das alças da caixa: na coincidência, a alça da curva ganha.
    const { x, y, width, height } = bezierBounds(shape);
    const right = x + width;
    const bottom = y + height;
    const midX = x + width / 2;
    const midY = y + height / 2;
    return [
      { id: 'start', x: shape.start.x, y: shape.start.y },
      { id: 'end', x: shape.end.x, y: shape.end.y },
      { id: 'control1', x: shape.control1.x, y: shape.control1.y },
      { id: 'control2', x: shape.control2.x, y: shape.control2.y },
      { id: 'nw', x, y },
      { id: 'n', x: midX, y },
      { id: 'ne', x: right, y },
      { id: 'e', x: right, y: midY },
      { id: 'se', x: right, y: bottom },
      { id: 's', x: midX, y: bottom },
      { id: 'sw', x, y: bottom },
      { id: 'w', x, y: midY },
    ];
  }

  if (shape.type === 'line' || shape.type === 'arrow') {
    const start =
      shape.type === 'line'
        ? shape.start
        : isFreeEndpoint(shape.start)
          ? shape.start
          : { x: 0, y: 0 };
    const end =
      shape.type === 'line' ? shape.end : isFreeEndpoint(shape.end) ? shape.end : { x: 0, y: 0 };
    return [
      { id: 'start', x: start.x, y: start.y },
      { id: 'end', x: end.x, y: end.y },
    ];
  }

  const { x, y, width, height, rotation } = shape;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const halfW = width / 2;
  const halfH = height / 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  function toWorld(localX: number, localY: number): Point {
    return {
      x: centerX + (cos * localX - sin * localY),
      y: centerY + (sin * localX + cos * localY),
    };
  }

  if (shape.type === 'text') {
    return [
      { id: 'nw', ...toWorld(-halfW, -halfH) },
      { id: 'ne', ...toWorld(halfW, -halfH) },
      { id: 'e', ...toWorld(halfW, 0) },
      { id: 'se', ...toWorld(halfW, halfH) },
      { id: 'sw', ...toWorld(-halfW, halfH) },
      { id: 'w', ...toWorld(-halfW, 0) },
    ];
  }

  return [
    { id: 'nw', ...toWorld(-halfW, -halfH) },
    { id: 'n', ...toWorld(0, -halfH) },
    { id: 'ne', ...toWorld(halfW, -halfH) },
    { id: 'e', ...toWorld(halfW, 0) },
    { id: 'se', ...toWorld(halfW, halfH) },
    { id: 's', ...toWorld(0, halfH) },
    { id: 'sw', ...toWorld(-halfW, halfH) },
    { id: 'w', ...toWorld(-halfW, 0) },
  ];
}

/**
 * Detecta se o ponto fornecido está sobre algum handle de redimensionamento do shape,
 * respeitando a tolerância de busca.
 */
export function findResizeHandleAtPoint(
  shape: ShapeNode | BoardNode,
  worldPoint: Point,
  toleranceWorld: number,
): ResizeHandleId | null {
  const handles = getShapeResizeHandles(shape);
  const tolSq = toleranceWorld * toleranceWorld;

  for (const h of handles) {
    const dx = h.x - worldPoint.x;
    const dy = h.y - worldPoint.y;
    if (dx * dx + dy * dy <= tolSq) {
      return h.id;
    }
  }

  return null;
}

/**
 * Retorna a razão de aspecto obrigatória `W / H` quando a figura tem proporção travada,
 * ou `undefined` quando o redimensionamento é livre (respeitando Shift).
 */
export function getLockedAspectRatio(
  node:
    | ShapeNode['type']
    | BezierNode
    | {
        readonly type: ShapeNode['type'];
        readonly variant?: string | undefined;
        readonly width?: number | undefined;
        readonly height?: number | undefined;
      },
): number | undefined {
  const type = typeof node === 'string' ? node : node.type;
  if (isBezier(node)) {
    // A curva escala uniforme: a razão travada é a atual da caixa dela.
    const box = bezierResizeBox(node);
    return box.width / box.height;
  }
  if (type === 'square' || type === 'circle' || type === 'polygon') {
    return 1;
  }
  if (type === 'triangle' && typeof node !== 'string' && node.variant === 'equilateral') {
    return 2 / Math.sqrt(3);
  }
  return undefined;
}

/**
 * Indica se o tipo de forma ou nó possui proporção travada compulsória.
 */
export function isAspectRatioLocked(
  nodeOrType: Parameters<typeof getLockedAspectRatio>[0],
): boolean {
  return getLockedAspectRatio(nodeOrType) !== undefined;
}

/**
 * Opções para redimensionamento de shape.
 */
export interface ResizeShapeOptions {
  readonly preserveAspectRatio?: boolean;
}

/**
 * Redimensiona a geometria de um shape com a âncora oposta fixa no espaço de coordenadas de mundo.
 * Aplica dimensão mínima de 1 unidade sem flip e suporte a proporção com Shift (ou compulsória se getLockedAspectRatio).
 */
export function resizeShape(
  shape: BoardNode,
  handleId: ResizeHandleId,
  currentPoint: Point,
  options?: ResizeShapeOptions,
): BoardNode;
export function resizeShape(
  shape: ShapeNode,
  handleId: ResizeHandleId,
  currentPoint: Point,
  options?: ResizeShapeOptions,
): ShapeNode;
export function resizeShape(
  shape: ShapeNode | BoardNode,
  handleId: ResizeHandleId,
  currentPoint: Point,
  options?: ResizeShapeOptions,
): ShapeNode | BoardNode;
export function resizeShape(
  shape: ShapeNode | BoardNode,
  handleId: ResizeHandleId,
  currentPoint: Point,
  options?: ResizeShapeOptions,
): ShapeNode | BoardNode {
  const normHandle = normalizeHandleId(handleId);

  if (shape.type === 'board') return resizeBoard(shape, normHandle, currentPoint);

  if (shape.type === 'line') {
    return resizeLine(shape, normHandle, currentPoint, options?.preserveAspectRatio ?? false);
  }

  if (shape.type === 'arrow') {
    return resizeArrow(shape, normHandle, currentPoint);
  }

  if (shape.type === 'bezier') {
    return resizeBezier(shape, normHandle, currentPoint);
  }

  if (
    normHandle === 'start' ||
    normHandle === 'end' ||
    normHandle === 'control1' ||
    normHandle === 'control2'
  ) {
    return shape;
  }

  if (shape.type === 'text') {
    return resizeTextShape(shape, normHandle, currentPoint);
  }

  const shift = options?.preserveAspectRatio ?? false;
  // Na cruz, Shift pede braços iguais (caixa 1:1) e não a proporção que a caixa já tem.
  const lockedRatio =
    getLockedAspectRatio(shape) ?? (shift && shape.type === 'cross' ? 1 : undefined);
  const preserveAspectRatio = lockedRatio !== undefined || shift;
  return resizeBoxShape(shape, normHandle, currentPoint, preserveAspectRatio, lockedRatio);
}

/**
 * Redimensiona o board com a alça oposta fixa, sem flip e com no mínimo 1 × 1 unidade. Não há
 * proporção travada nem rotação: o Shift não muda nada, e os filhos não entram na conta.
 */
function resizeBoard(
  board: BoardNode,
  handle: ReturnType<typeof normalizeHandleId>,
  point: Point,
): BoardNode {
  let left = board.x;
  let top = board.y;
  let right = board.x + board.width;
  let bottom = board.y + board.height;
  if (handle.includes('w')) left = Math.min(point.x, right - 1);
  if (handle.includes('e')) right = Math.max(point.x, left + 1);
  if (handle.includes('n')) top = Math.min(point.y, bottom - 1);
  if (handle.includes('s')) bottom = Math.max(point.y, top + 1);
  return { ...board, x: left, y: top, width: right - left, height: bottom - top };
}

function isBezier(node: unknown): node is BezierNode {
  return typeof node === 'object' && node !== null && (node as BezierNode).type === 'bezier';
}

/**
 * Caixa exata da curva usada pelo resize, com cada lado de pelo menos 1: a curva reta tem caixa
 * sem altura (ou sem largura), e a razão dela seria infinita.
 */
function bezierResizeBox(shape: BezierNode): Bounds {
  const box = bezierBounds(shape);
  const width = Math.max(box.width, 1);
  const height = Math.max(box.height, 1);
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

/**
 * Alças da curva: as pontas e os controles movem o próprio ponto (na curva simétrica, o controle
 * espelhado acompanha, como o core faz no patch); as da caixa escalam os quatro pontos por igual
 * em torno da âncora oposta, com a proporção travada na atual.
 */
function resizeBezier(shape: BezierNode, handle: ResizeHandleId, currentPoint: Point): BezierNode {
  const point = { x: currentPoint.x, y: currentPoint.y };
  if (handle === 'start' || handle === 'end') {
    const moved = { ...shape, [handle]: point };
    return moved.symmetric
      ? { ...moved, control2: mirrorControl(moved.start, moved.end, moved.control1) }
      : moved;
  }
  if (handle === 'control1') {
    return {
      ...shape,
      control1: point,
      control2: shape.symmetric ? mirrorControl(shape.start, shape.end, point) : shape.control2,
    };
  }
  if (handle === 'control2') {
    return {
      ...shape,
      control1: shape.symmetric ? mirrorControl(shape.start, shape.end, point) : shape.control1,
      control2: point,
    };
  }
  if (
    handle !== 'nw' &&
    handle !== 'n' &&
    handle !== 'ne' &&
    handle !== 'e' &&
    handle !== 'se' &&
    handle !== 's' &&
    handle !== 'sw' &&
    handle !== 'w'
  ) {
    return shape;
  }

  // A caixa da curva vira um retângulo sem rotação: o resize de caixa já sabe manter a âncora
  // oposta, a dimensão mínima e a razão travada. Depois, os quatro pontos seguem a caixa.
  const box = bezierResizeBox(shape);
  const frame: RectangleNode = {
    id: shape.id,
    type: 'rectangle',
    ...box,
    rotation: 0,
    visible: true,
    locked: false,
    style: { fill: null, stroke: null, strokeWidth: 0, opacity: 1 },
  };
  const resized = resizeBoxShape(
    frame,
    handle,
    point,
    true,
    box.width / box.height,
  ) as RectangleNode;
  const scale = resized.width / box.width;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const to = { x: resized.x + resized.width / 2, y: resized.y + resized.height / 2 };
  const map = (p: Point): Point => ({
    x: to.x + (p.x - from.x) * scale,
    y: to.y + (p.y - from.y) * scale,
  });
  return {
    ...shape,
    start: map(shape.start),
    control1: map(shape.control1),
    control2: map(shape.control2),
    end: map(shape.end),
  };
}

function resizeArrow(shape: ArrowNode, handle: ResizeHandleId, currentPoint: Point): ArrowNode {
  if (handle === 'start') {
    return { ...shape, start: currentPoint };
  }
  if (handle === 'end') {
    return { ...shape, end: currentPoint };
  }
  return shape;
}

function resizeTextShape(
  shape: TextNode,
  requested: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w',
  currentPoint: Point,
): ShapeNode {
  // 1. Resize vertical direto NÃO é oferecido (INPUT-06 / Tarefa 44)
  if (requested === 'n' || requested === 's') {
    return shape;
  }

  // Em tamanho fixo a fonte não muda: os cantos só mexem na largura e valem como a alça lateral
  // do mesmo lado (a altura vem do layout).
  const handle: 'nw' | 'ne' | 'se' | 'sw' | 'e' | 'w' =
    shape.fontSizeMode === 'fixed' && requested !== 'e' && requested !== 'w'
      ? requested === 'ne' || requested === 'se'
        ? 'e'
        : 'w'
      : requested;

  const { width: w0, height: h0, rotation } = shape;
  const centerX0 = shape.x + w0 / 2;
  const centerY0 = shape.y + h0 / 2;
  const halfW0 = w0 / 2;
  const halfH0 = h0 / 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  function localToWorld(localX: number, localY: number): Point {
    return {
      x: centerX0 + (cos * localX - sin * localY),
      y: centerY0 + (sin * localX + cos * localY),
    };
  }

  // 2. Resize horizontal refaz o layout: ajusta a largura e recalcula a altura via layoutText
  if (handle === 'e' || handle === 'w') {
    const isEast = handle === 'e';
    const fixedAnchor = isEast ? localToWorld(-halfW0, -halfH0) : localToWorld(halfW0, -halfH0);

    const dWorldX = currentPoint.x - fixedAnchor.x;
    const dWorldY = currentPoint.y - fixedAnchor.y;

    const dLocX = cos * dWorldX + sin * dWorldY;
    const rawW = isEast ? dLocX : -dLocX;
    const newWidth = Math.max(1, rawW);

    const layout = layoutText(shape.text, {
      fontSize: shape.fontSize,
      fontFamily: shape.fontFamily,
      fontWeight: shape.fontWeight,
      lineHeight: shape.lineHeight,
      maxWidth: newWidth > 0 ? newWidth : undefined,
    });
    const newHeight = Math.max(1, layout.height);

    const relCenterX = isEast ? newWidth / 2 : -newWidth / 2;
    const relCenterY = newHeight / 2;

    const newCenterX = fixedAnchor.x + (cos * relCenterX - sin * relCenterY);
    const newCenterY = fixedAnchor.y + (sin * relCenterX + cos * relCenterY);

    return {
      ...shape,
      x: newCenterX - newWidth / 2,
      y: newCenterY - newHeight / 2,
      width: newWidth,
      height: newHeight,
    };
  }

  // 3. Escala uniforme de canto ('nw', 'ne', 'se', 'sw'): ajusta a caixa e o tamanho da fonte
  let anchorWorld: Point;
  let handleSignX = 0;
  let handleSignY = 0;

  switch (handle) {
    case 'se':
      anchorWorld = localToWorld(-halfW0, -halfH0);
      handleSignX = 1;
      handleSignY = 1;
      break;
    case 'nw':
      anchorWorld = localToWorld(halfW0, halfH0);
      handleSignX = -1;
      handleSignY = -1;
      break;
    case 'ne':
      anchorWorld = localToWorld(-halfW0, halfH0);
      handleSignX = 1;
      handleSignY = -1;
      break;
    case 'sw':
      anchorWorld = localToWorld(halfW0, -halfH0);
      handleSignX = -1;
      handleSignY = 1;
      break;
  }

  const dWorldX = currentPoint.x - anchorWorld.x;
  const dWorldY = currentPoint.y - anchorWorld.y;

  const dLocX = cos * dWorldX + sin * dWorldY;
  const dLocY = -sin * dWorldX + cos * dWorldY;

  const candW = handleSignX * dLocX;
  const candH = handleSignY * dLocY;

  const scaleX = w0 > 0 ? candW / w0 : 1;
  const scaleY = h0 > 0 ? candH / h0 : 1;
  const scale = Math.max(0.01, Math.max(scaleX, scaleY));

  const newWidth = Math.max(1, w0 * scale);
  const newHeight = Math.max(1, h0 * scale);
  const newFontSize = Math.max(1, Math.round(shape.fontSize * scale * 100) / 100);

  let relCenterX = 0;
  let relCenterY = 0;

  switch (handle) {
    case 'se':
      relCenterX = newWidth / 2;
      relCenterY = newHeight / 2;
      break;
    case 'nw':
      relCenterX = -newWidth / 2;
      relCenterY = -newHeight / 2;
      break;
    case 'ne':
      relCenterX = newWidth / 2;
      relCenterY = -newHeight / 2;
      break;
    case 'sw':
      relCenterX = -newWidth / 2;
      relCenterY = newHeight / 2;
      break;
  }

  const newCenterX = anchorWorld.x + (cos * relCenterX - sin * relCenterY);
  const newCenterY = anchorWorld.y + (sin * relCenterX + cos * relCenterY);

  return {
    ...shape,
    x: newCenterX - newWidth / 2,
    y: newCenterY - newHeight / 2,
    width: newWidth,
    height: newHeight,
    fontSize: newFontSize,
  };
}

function resizeLine(
  shape: ShapeNode & { type: 'line' },
  handle: 'start' | 'end' | string,
  currentPoint: Point,
  preserveAngle: boolean,
): ShapeNode {
  const isStart = handle === 'start';
  const fixedPoint = isStart ? shape.end : shape.start;

  let movingX = currentPoint.x;
  let movingY = currentPoint.y;

  let dx = movingX - fixedPoint.x;
  let dy = movingY - fixedPoint.y;

  if (preserveAngle) {
    // Snap a cada 45°
    const angle = Math.atan2(dy, dx);
    const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    const dist = Math.hypot(dx, dy);
    dx = dist * Math.cos(snapAngle);
    dy = dist * Math.sin(snapAngle);
    movingX = fixedPoint.x + dx;
    movingY = fixedPoint.y + dy;
  }

  // Garantir comprimento mínimo de 1 unidade para que start != end
  const length = Math.hypot(dx, dy);
  if (length < 1) {
    const origDx = (isStart ? shape.start.x : shape.end.x) - fixedPoint.x;
    const origDy = (isStart ? shape.start.y : shape.end.y) - fixedPoint.y;
    const origLen = Math.hypot(origDx, origDy) || 1;
    dx = (origDx / origLen) * 1;
    dy = (origDy / origLen) * 1;
    movingX = fixedPoint.x + dx;
    movingY = fixedPoint.y + dy;
  }

  if (isStart) {
    return {
      ...shape,
      start: { x: movingX, y: movingY },
      end: fixedPoint,
    };
  }

  return {
    ...shape,
    start: fixedPoint,
    end: { x: movingX, y: movingY },
  };
}

function resizeBoxShape(
  shape: Exclude<ShapeNode, { type: 'line' | 'arrow' | 'bezier' }>,
  handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w',
  currentPoint: Point,
  preserveAspectRatio: boolean,
  lockedRatio?: number | undefined,
): ShapeNode {
  const { width: w0, height: h0, rotation } = shape;
  const centerX0 = shape.x + w0 / 2;
  const centerY0 = shape.y + h0 / 2;
  const halfW0 = w0 / 2;
  const halfH0 = h0 / 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  function localToWorld(localX: number, localY: number): Point {
    return {
      x: centerX0 + (cos * localX - sin * localY),
      y: centerY0 + (sin * localX + cos * localY),
    };
  }

  // Localização da âncora fixa oposta e vetor do centro até a âncora
  let anchorWorld: Point;
  let handleSignX = 0;
  let handleSignY = 0;

  switch (handle) {
    case 'se':
      anchorWorld = localToWorld(-halfW0, -halfH0); // âncora é nw
      handleSignX = 1;
      handleSignY = 1;
      break;
    case 'nw':
      anchorWorld = localToWorld(halfW0, halfH0); // âncora é se
      handleSignX = -1;
      handleSignY = -1;
      break;
    case 'ne':
      anchorWorld = localToWorld(-halfW0, halfH0); // âncora é sw
      handleSignX = 1;
      handleSignY = -1;
      break;
    case 'sw':
      anchorWorld = localToWorld(halfW0, -halfH0); // âncora é ne
      handleSignX = -1;
      handleSignY = 1;
      break;
    case 'e':
      anchorWorld = localToWorld(-halfW0, 0); // âncora é w
      handleSignX = 1;
      handleSignY = 0;
      break;
    case 'w':
      anchorWorld = localToWorld(halfW0, 0); // âncora é e
      handleSignX = -1;
      handleSignY = 0;
      break;
    case 's':
      anchorWorld = localToWorld(0, -halfH0); // âncora é n
      handleSignX = 0;
      handleSignY = 1;
      break;
    case 'n':
      anchorWorld = localToWorld(0, halfH0); // âncora é s
      handleSignX = 0;
      handleSignY = -1;
      break;
  }

  // Vetor do mouse em relação à âncora fixa
  const dWorldX = currentPoint.x - anchorWorld.x;
  const dWorldY = currentPoint.y - anchorWorld.y;

  // Projeta nos eixos locais (desrotaciona)
  const dLocX = cos * dWorldX + sin * dWorldY;
  const dLocY = -sin * dWorldX + cos * dWorldY;

  // Dimensão candidata antes do clamp
  let candW = handleSignX !== 0 ? handleSignX * dLocX : w0;
  let candH = handleSignY !== 0 ? handleSignY * dLocY : h0;

  // Sem flip: dimensão mínima de 1 unidade
  candW = Math.max(1, candW);
  candH = Math.max(1, candH);

  // Preservação de proporção com Shift ou razão travada (lockedRatio = W / H)
  if (preserveAspectRatio) {
    const ratio = lockedRatio ?? w0 / h0;
    if (handleSignX !== 0 && handleSignY !== 0) {
      // Handle de canto
      const scaleX = candW / w0;
      const scaleY = candH / h0;
      const scale = Math.max(scaleX, scaleY);
      candW = Math.max(1, w0 * scale);
      candH = Math.max(1, candW / ratio);
      candW = candH * ratio;
    } else if (handleSignX !== 0) {
      // Handle de borda horizontal
      candH = Math.max(1, candW / ratio);
      candW = candH * ratio;
    } else if (handleSignY !== 0) {
      // Handle de borda vertical
      candW = Math.max(1, candH * ratio);
      candH = candW / ratio;
    }
  }

  // Novo centro a partir da âncora fixa
  // Vetor relativo local da âncora fixa até o novo centro:
  let relCenterX = 0;
  let relCenterY = 0;

  switch (handle) {
    case 'se':
      relCenterX = candW / 2;
      relCenterY = candH / 2;
      break;
    case 'nw':
      relCenterX = -candW / 2;
      relCenterY = -candH / 2;
      break;
    case 'ne':
      relCenterX = candW / 2;
      relCenterY = -candH / 2;
      break;
    case 'sw':
      relCenterX = -candW / 2;
      relCenterY = candH / 2;
      break;
    case 'e':
      relCenterX = candW / 2;
      relCenterY = 0;
      break;
    case 'w':
      relCenterX = -candW / 2;
      relCenterY = 0;
      break;
    case 's':
      relCenterX = 0;
      relCenterY = candH / 2;
      break;
    case 'n':
      relCenterX = 0;
      relCenterY = -candH / 2;
      break;
  }

  const newCenterX = anchorWorld.x + (cos * relCenterX - sin * relCenterY);
  const newCenterY = anchorWorld.y + (sin * relCenterX + cos * relCenterY);

  const newX = newCenterX - candW / 2;
  const newY = newCenterY - candH / 2;

  return {
    ...shape,
    x: newX,
    y: newY,
    width: candW,
    height: candH,
  };
}

/**
 * Converte o nó redimensionado em patch parcial para o comando `shape.update`.
 */
export function buildResizePatch(resizedShape: ShapeNode | BoardNode): Record<string, unknown> {
  if (resizedShape.type === 'bezier') {
    // Os quatro pontos: na curva simétrica, os controles já saem espelhados do resize.
    return {
      start: resizedShape.start,
      control1: resizedShape.control1,
      control2: resizedShape.control2,
      end: resizedShape.end,
    };
  }

  if (resizedShape.type === 'line' || resizedShape.type === 'arrow') {
    return {
      start: resizedShape.start,
      end: resizedShape.end,
    };
  }

  return {
    x: resizedShape.x,
    y: resizedShape.y,
    width: resizedShape.width,
    height: resizedShape.height,
    ...(resizedShape.type === 'text' ? { fontSize: resizedShape.fontSize } : {}),
  };
}

/**
 * Converte o nó em PreviewShape para visualização contínua durante o redimensionamento.
 */
export function buildResizePreview(resizedShape: ShapeNode | BoardNode): PreviewShape {
  return toPreviewShape(resizedShape);
}

/**
 * Retorna o cursor CSS apropriado para cada handle considerando a rotação da forma.
 */
export function getResizeCursor(handleId: ResizeHandleId, rotation = 0): string {
  const norm = normalizeHandleId(handleId);

  if (norm === 'start' || norm === 'end' || norm === 'control1' || norm === 'control2') {
    return 'crosshair';
  }

  // Ângulos base para os 8 handles (sentido horário a partir de n = 0)
  const baseAngles: Record<'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw', number> = {
    n: 0,
    ne: Math.PI / 4,
    e: Math.PI / 2,
    se: (3 * Math.PI) / 4,
    s: Math.PI,
    sw: (5 * Math.PI) / 4,
    w: (3 * Math.PI) / 2,
    nw: (7 * Math.PI) / 4,
  };

  const angle = (baseAngles[norm] + rotation) % (2 * Math.PI);
  const normalizedAngle = angle < 0 ? angle + 2 * Math.PI : angle;

  // 4 tipos de cursores bidirecionais
  const octant = Math.round(normalizedAngle / (Math.PI / 4)) % 8;
  switch (octant) {
    case 0:
    case 4:
      return 'ns-resize';
    case 1:
    case 5:
      return 'nesw-resize';
    case 2:
    case 6:
      return 'ew-resize';
    case 3:
    case 7:
      return 'nwse-resize';
    default:
      return 'pointer';
  }
}
