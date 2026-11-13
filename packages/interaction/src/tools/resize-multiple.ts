import {
  bezierBounds,
  isBoxShape,
  layoutText,
  type CanvasSectionApi,
  type CanvasCommand,
  type BoardNode,
  type Bounds,
  type Point,
  type PreviewShape,
  type ShapeNode,
} from '@canvash/core';
import { buildResizePatch, buildResizePreview, type ResizeHandleId } from './resize.js';

/**
 * Calcula a bounding box alinhada aos eixos (AABB) agregada de uma lista de nós.
 */
export function computeAggregateBounds(nodes: readonly (ShapeNode | BoardNode)[]): Bounds | null {
  if (nodes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    if (node.type === 'board') {
      // O retângulo do board, sem a faixa do título: é o que as bordas alinham.
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    } else if (isBoxShape(node)) {
      const centerX = node.x + node.width / 2;
      const centerY = node.y + node.height / 2;
      const cos = Math.cos(node.rotation);
      const sin = Math.sin(node.rotation);
      const hw = node.width / 2;
      const hh = node.height / 2;

      // 4 cantos rotacionados
      const corners: readonly Point[] = [
        { x: centerX + (cos * -hw - sin * -hh), y: centerY + (sin * -hw + cos * -hh) },
        { x: centerX + (cos * hw - sin * -hh), y: centerY + (sin * hw + cos * -hh) },
        { x: centerX + (cos * hw - sin * hh), y: centerY + (sin * hw + cos * hh) },
        { x: centerX + (cos * -hw - sin * hh), y: centerY + (sin * -hw + cos * hh) },
      ];

      for (const pt of corners) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
    } else if (node.type === 'bezier') {
      const box = bezierBounds(node);
      if (box.x < minX) minX = box.x;
      if (box.y < minY) minY = box.y;
      if (box.x + box.width > maxX) maxX = box.x + box.width;
      if (box.y + box.height > maxY) maxY = box.y + box.height;
    } else if (node.type === 'line') {
      const pts = [node.start, node.end];
      for (const pt of pts) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/**
 * Posição de cada handle de controle da bounding box agregada.
 */
export interface MultiResizeHandlePoint {
  readonly id: ResizeHandleId;
  readonly x: number;
  readonly y: number;
}

/**
 * Retorna as posições dos 8 handles ao redor do bounding box coletivo.
 */
export function getMultiResizeHandles(bounds: Bounds): readonly MultiResizeHandlePoint[] {
  const left = bounds.x;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;
  const midX = bounds.x + bounds.width / 2;
  const midY = bounds.y + bounds.height / 2;

  return [
    { id: 'nw', x: left, y: top },
    { id: 'n', x: midX, y: top },
    { id: 'ne', x: right, y: top },
    { id: 'e', x: right, y: midY },
    { id: 'se', x: right, y: bottom },
    { id: 's', x: midX, y: bottom },
    { id: 'sw', x: left, y: bottom },
    { id: 'w', x: left, y: midY },
  ];
}

/**
 * Detecta se o ponto fornecido está sobre algum handle de seleção múltipla.
 */
export function findMultiResizeHandleAtPoint(
  bounds: Bounds,
  worldPoint: Point,
  toleranceWorld: number,
): ResizeHandleId | null {
  const handles = getMultiResizeHandles(bounds);
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
 * Retorna a âncora fixa oposta no espaço de mundo para o handle dado.
 */
export function getMultiResizeOppositeAnchor(bounds: Bounds, handle: ResizeHandleId): Point {
  const left = bounds.x;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;
  const midX = bounds.x + bounds.width / 2;
  const midY = bounds.y + bounds.height / 2;

  switch (handle) {
    case 'se':
    case 'br':
      return { x: left, y: top }; // âncora é nw
    case 'nw':
    case 'tl':
      return { x: right, y: bottom }; // âncora é se
    case 'ne':
    case 'tr':
      return { x: left, y: bottom }; // âncora é sw
    case 'sw':
    case 'bl':
      return { x: right, y: top }; // âncora é ne
    case 'e':
    case 'rc':
      return { x: left, y: midY }; // âncora é w
    case 'w':
    case 'lc':
      return { x: right, y: midY }; // âncora é e
    case 's':
    case 'bc':
      return { x: midX, y: top }; // âncora é n
    case 'n':
    case 'tc':
      return { x: midX, y: bottom }; // âncora é s
    default:
      return { x: left, y: top };
  }
}

/**
 * Calcula o fator de escala uniforme S respeitando a dimensão mínima sem flip.
 */
export function computeUniformScaleFactor(
  bounds: Bounds,
  handle: ResizeHandleId,
  currentPoint: Point,
  nodes: readonly ShapeNode[],
): number {
  const anchor = getMultiResizeOppositeAnchor(bounds, handle);
  const w0 = Math.max(1, bounds.width);
  const h0 = Math.max(1, bounds.height);

  let rawScale: number;

  switch (handle) {
    case 'se':
    case 'br': {
      const sx = (currentPoint.x - anchor.x) / w0;
      const sy = (currentPoint.y - anchor.y) / h0;
      rawScale = Math.max(sx, sy);
      break;
    }
    case 'nw':
    case 'tl': {
      const sx = (anchor.x - currentPoint.x) / w0;
      const sy = (anchor.y - currentPoint.y) / h0;
      rawScale = Math.max(sx, sy);
      break;
    }
    case 'ne':
    case 'tr': {
      const sx = (currentPoint.x - anchor.x) / w0;
      const sy = (anchor.y - currentPoint.y) / h0;
      rawScale = Math.max(sx, sy);
      break;
    }
    case 'sw':
    case 'bl': {
      const sx = (anchor.x - currentPoint.x) / w0;
      const sy = (currentPoint.y - anchor.y) / h0;
      rawScale = Math.max(sx, sy);
      break;
    }
    case 'e':
    case 'rc':
      rawScale = (currentPoint.x - anchor.x) / w0;
      break;
    case 'w':
    case 'lc':
      rawScale = (anchor.x - currentPoint.x) / w0;
      break;
    case 's':
    case 'bc':
      rawScale = (currentPoint.y - anchor.y) / h0;
      break;
    case 'n':
    case 'tc':
      rawScale = (anchor.y - currentPoint.y) / h0;
      break;
    default:
      rawScale = 1;
  }

  // Limite mínimo para evitar dimensões < 1 ou flip de nós
  let minSafeScale = 0.001;
  for (const node of nodes) {
    if (isBoxShape(node)) {
      const nodeMinDim = Math.min(node.width, node.height);
      if (nodeMinDim > 0) {
        minSafeScale = Math.max(minSafeScale, 1 / nodeMinDim);
      }
    } else if (node.type === 'line' || node.type === 'bezier') {
      const lineLen = Math.hypot(node.end.x - node.start.x, node.end.y - node.start.y);
      if (lineLen > 0) {
        minSafeScale = Math.max(minSafeScale, 1 / lineLen);
      }
    }
  }

  return Math.max(minSafeScale, rawScale);
}

/**
 * Escala uniformemente uma forma individual a partir de uma âncora fixa pelo fator S.
 * Garante zero skew mantendo a rotação nativa do nó.
 */
export function scaleShapeUniform(shape: ShapeNode, anchor: Point, scale: number): ShapeNode {
  if (isBoxShape(shape) && shape.type !== 'text') {
    const origCenterX = shape.x + shape.width / 2;
    const origCenterY = shape.y + shape.height / 2;

    const newCenterX = anchor.x + (origCenterX - anchor.x) * scale;
    const newCenterY = anchor.y + (origCenterY - anchor.y) * scale;
    const newWidth = Math.max(1, shape.width * scale);
    const newHeight = Math.max(1, shape.height * scale);

    return {
      ...shape,
      x: newCenterX - newWidth / 2,
      y: newCenterY - newHeight / 2,
      width: newWidth,
      height: newHeight,
      // Rotação estritamente inalterada: ZERO SKEW
      rotation: shape.rotation,
    };
  }

  if (shape.type === 'text') {
    const origCenterX = shape.x + shape.width / 2;
    const origCenterY = shape.y + shape.height / 2;

    const newCenterX = anchor.x + (origCenterX - anchor.x) * scale;
    const newCenterY = anchor.y + (origCenterY - anchor.y) * scale;
    const newWidth = Math.max(1, shape.width * scale);
    // Em tamanho fixo, escalar o grupo muda a largura de quebra e a altura vem do layout; a
    // fonte fica. No modo automático, caixa e fonte escalam juntas.
    const fixed = shape.fontSizeMode === 'fixed';
    const newHeight = fixed
      ? Math.max(
          1,
          layoutText(shape.text, {
            fontSize: shape.fontSize,
            fontFamily: shape.fontFamily,
            fontWeight: shape.fontWeight,
            lineHeight: shape.lineHeight,
            maxWidth: newWidth,
          }).height,
        )
      : Math.max(1, shape.height * scale);
    const newFontSize = fixed
      ? shape.fontSize
      : Math.max(1, Math.round(shape.fontSize * scale * 100) / 100);

    return {
      ...shape,
      x: newCenterX - newWidth / 2,
      y: newCenterY - newHeight / 2,
      width: newWidth,
      height: newHeight,
      fontSize: newFontSize,
      rotation: shape.rotation,
    };
  }

  if (shape.type === 'bezier') {
    const scalePoint = (point: Point): Point => ({
      x: anchor.x + (point.x - anchor.x) * scale,
      y: anchor.y + (point.y - anchor.y) * scale,
    });
    return {
      ...shape,
      start: scalePoint(shape.start),
      control1: scalePoint(shape.control1),
      control2: scalePoint(shape.control2),
      end: scalePoint(shape.end),
    };
  }

  if (shape.type === 'line') {
    const newStartX = anchor.x + (shape.start.x - anchor.x) * scale;
    const newStartY = anchor.y + (shape.start.y - anchor.y) * scale;
    const newEndX = anchor.x + (shape.end.x - anchor.x) * scale;
    const newEndY = anchor.y + (shape.end.y - anchor.y) * scale;

    return {
      ...shape,
      start: { x: newStartX, y: newStartY },
      end: { x: newEndX, y: newEndY },
    };
  }

  return shape;
}

/**
 * Escala toda a seleção múltipla uniformemente sem distorcer formas rotacionadas.
 */
export function scaleMultipleShapes(
  nodes: readonly ShapeNode[],
  bounds: Bounds,
  handle: ResizeHandleId,
  currentPoint: Point,
): readonly ShapeNode[] {
  const anchor = getMultiResizeOppositeAnchor(bounds, handle);
  const scale = computeUniformScaleFactor(bounds, handle, currentPoint, nodes);

  return nodes.map((node) => scaleShapeUniform(node, anchor, scale));
}

/**
 * Constrói os previews para os nós escalados.
 */
export function buildMultiResizePreviews(nodes: readonly ShapeNode[]): readonly PreviewShape[] {
  return nodes.map((node) => buildResizePreview(node));
}

/**
 * Constrói a lista de comandos `shape.update` para a alteração múltipla.
 */
export function buildMultiResizeCommands(nodes: readonly ShapeNode[]): readonly CanvasCommand[] {
  return nodes.map((node) => ({
    type: 'shape.update' as const,
    id: node.id,
    patch: buildResizePatch(node),
  }));
}

/**
 * Aplica a escala uniforme em todos os nós através de uma única transação atômica no canvas.
 */
export function executeMultiResize(section: CanvasSectionApi, nodes: readonly ShapeNode[]): void {
  if (nodes.length === 0) return;
  const commands = buildMultiResizeCommands(nodes);
  section.transact(commands);
}
