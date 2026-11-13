import {
  isFreeEndpoint,
  resolveAnchorPosition,
  type ArrowEndpoint,
  type ArrowInput,
  type ArrowMarkerType,
  type CanvasDocument,
  type Point,
  type PreviewShape,
  type ShapeNode,
} from '@canvash/core';

/** Tolerância mínima de comprimento para criação válida de seta (evita zero-length). */
export const DEFAULT_MIN_ARROW_LENGTH = 2;

/**
 * Âncoras notáveis normalizadas em nós com caixa.
 */
export const STANDARD_ANCHORS: readonly Point[] = [
  { x: 0.5, y: 0.5 }, // Centro
  { x: 0.5, y: 0 }, // Topo
  { x: 1, y: 0.5 }, // Direita
  { x: 0.5, y: 1 }, // Baixo
  { x: 0, y: 0.5 }, // Esquerda
  { x: 0, y: 0 }, // Top-Left
  { x: 1, y: 0 }, // Top-Right
  { x: 0, y: 1 }, // Bottom-Left
  { x: 1, y: 1 }, // Bottom-Right
];

/**
 * Calcula a coordenada de âncora normalizada relativa à geometria do alvo.
 */
export function computeNormalizedAnchor(target: ShapeNode, worldPoint: Point): Point {
  // A curva conta pela corda, como na resolução da âncora no core.
  if (target.type === 'line' || target.type === 'bezier') {
    const dx = target.end.x - target.start.x;
    const dy = target.end.y - target.start.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return { x: 0.5, y: 0.5 };
    const t = ((worldPoint.x - target.start.x) * dx + (worldPoint.y - target.start.y) * dy) / lenSq;
    const clampedT = Math.max(0, Math.min(1, t));
    return { x: clampedT, y: clampedT };
  }

  if (target.type === 'arrow') {
    const start = isFreeEndpoint(target.start) ? target.start : { x: 0, y: 0 };
    const end = isFreeEndpoint(target.end) ? target.end : { x: 0, y: 0 };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return { x: 0.5, y: 0.5 };
    const t = ((worldPoint.x - start.x) * dx + (worldPoint.y - start.y) * dy) / lenSq;
    const clampedT = Math.max(0, Math.min(1, t));
    return { x: clampedT, y: clampedT };
  }

  // target com caixa: rectangle, ellipse, text
  const centerX = target.x + target.width / 2;
  const centerY = target.y + target.height / 2;
  const dx = worldPoint.x - centerX;
  const dy = worldPoint.y - centerY;

  const invCos = Math.cos(-target.rotation);
  const invSin = Math.sin(-target.rotation);
  const localX = invCos * dx - invSin * dy;
  const localY = invSin * dx + invCos * dy;

  const rawAnchorX = localX / target.width + 0.5;
  const rawAnchorY = localY / target.height + 0.5;

  const clampedX = Math.max(0, Math.min(1, rawAnchorX));
  const clampedY = Math.max(0, Math.min(1, rawAnchorY));

  // Snap opcional para âncoras padrão quando próximo o suficiente (tolerância normalizada = 0.08)
  for (const std of STANDARD_ANCHORS) {
    const distSq = (clampedX - std.x) ** 2 + (clampedY - std.y) ** 2;
    if (distSq < 0.08 * 0.08) {
      return std;
    }
  }

  return {
    x: Math.round(clampedX * 1000) / 1000,
    y: Math.round(clampedY * 1000) / 1000,
  };
}

export interface TargetHitResult {
  readonly targetId: string;
  readonly anchor: Point;
  readonly resolvedPoint: Point;
}

/**
 * Localiza alvo candidato sob o ponto para vinculação de âncora.
 */
export function findAnchorTargetAtPoint(
  point: Point,
  document: CanvasDocument,
  hitTestFn: (
    point: Point,
    options?: { includeLocked?: boolean; includePreview?: boolean },
  ) => string | undefined,
  excludeId?: string,
): TargetHitResult | undefined {
  const hitId = hitTestFn(point, { includeLocked: false, includePreview: false });
  if (!hitId || hitId === excludeId) {
    return undefined;
  }

  const targetNode = document.nodes[hitId];
  // A curva Bézier, a chave e o traço à mão livre, que só têm traço, não recebem vínculo de seta.
  if (
    !targetNode ||
    targetNode.type === 'group' ||
    targetNode.type === 'board' ||
    targetNode.type === 'bezier' ||
    targetNode.type === 'brace' ||
    targetNode.type === 'ink' ||
    !targetNode.visible ||
    targetNode.locked
  ) {
    return undefined;
  }

  const anchor = computeNormalizedAnchor(targetNode, point);
  const resolvedPoint = resolveAnchorPosition(targetNode, anchor);

  return {
    targetId: targetNode.id,
    anchor,
    resolvedPoint,
  };
}

export interface ArrowCreationResult {
  readonly start: ArrowEndpoint;
  readonly end: ArrowEndpoint;
  readonly resolvedStart: Point;
  readonly resolvedEnd: Point;
  readonly length: number;
}

export interface ComputeArrowCreationParams {
  readonly startWorld: Point;
  readonly currentWorld: Point;
  readonly startTarget?: TargetHitResult | undefined;
  readonly endTarget?: TargetHitResult | undefined;
  readonly shiftKey?: boolean;
}

/**
 * Calcula os endpoints livres ou vinculados e a geometria resultante da seta em criação.
 */
export function computeArrowCreation(params: ComputeArrowCreationParams): ArrowCreationResult {
  const { startWorld, currentWorld, startTarget, endTarget, shiftKey } = params;

  const resolvedStart = startTarget ? startTarget.resolvedPoint : startWorld;
  let resolvedEnd = endTarget ? endTarget.resolvedPoint : currentWorld;

  if (shiftKey && !endTarget) {
    const dx = resolvedEnd.x - resolvedStart.x;
    const dy = resolvedEnd.y - resolvedStart.y;
    const angle = Math.atan2(dy, dx);
    const step = Math.PI / 4; // 45 graus
    const snappedAngle = Math.round(angle / step) * step;
    const distance = Math.hypot(dx, dy);

    resolvedEnd = {
      x: resolvedStart.x + distance * Math.cos(snappedAngle),
      y: resolvedStart.y + distance * Math.sin(snappedAngle),
    };
  }

  const startEndpoint: ArrowEndpoint = startTarget
    ? { targetId: startTarget.targetId, anchor: startTarget.anchor }
    : { x: resolvedStart.x, y: resolvedStart.y };

  const endEndpoint: ArrowEndpoint = endTarget
    ? { targetId: endTarget.targetId, anchor: endTarget.anchor }
    : { x: resolvedEnd.x, y: resolvedEnd.y };

  const length = Math.hypot(resolvedEnd.x - resolvedStart.x, resolvedEnd.y - resolvedStart.y);

  return {
    start: startEndpoint,
    end: endEndpoint,
    resolvedStart,
    resolvedEnd,
    length,
  };
}

/**
 * Verifica se a seta criada satisfaz o comprimento mínimo obrigatório.
 */
export function isArrowCreationValid(
  length: number,
  minLength = DEFAULT_MIN_ARROW_LENGTH,
): boolean {
  return length >= minLength;
}

export interface BuildArrowPreviewOptions {
  readonly start: ArrowEndpoint;
  readonly end: ArrowEndpoint;
  readonly startMarker?: ArrowMarkerType;
  readonly endMarker?: ArrowMarkerType;
  readonly previewId?: string;
}

/**
 * Constrói o PreviewShape de adição para renderização em tempo real da seta em criação.
 */
export function buildArrowPreviewShape(options: BuildArrowPreviewOptions): PreviewShape {
  return {
    id: options.previewId ?? '__preview_arrow__',
    type: 'arrow',
    start: options.start,
    end: options.end,
    startMarker: options.startMarker ?? 'none',
    endMarker: options.endMarker ?? 'arrow',
    visible: true,
    locked: false,
    style: {
      stroke: '#2563eb',
      strokeWidth: 2,
      opacity: 0.8,
    },
  };
}

export interface BuildArrowInputOptions {
  readonly start: ArrowEndpoint;
  readonly end: ArrowEndpoint;
  readonly startMarker?: ArrowMarkerType;
  readonly endMarker?: ArrowMarkerType;
  readonly stroke?: string;
  readonly strokeWidth?: number;
}

/**
 * Constrói o payload de entrada `ArrowInput` para despacho de criação via comando `shape.create`.
 */
export function buildArrowCreateInput(options: BuildArrowInputOptions): ArrowInput {
  return {
    type: 'arrow',
    start: options.start,
    end: options.end,
    startMarker: options.startMarker ?? 'none',
    endMarker: options.endMarker ?? 'arrow',
    style: {
      stroke: options.stroke ?? '#111827',
      strokeWidth: options.strokeWidth ?? 2,
      opacity: 1,
    },
  };
}
