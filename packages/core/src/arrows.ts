/** Ponto em coordenadas de mundo. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Tipos de marcadores nas pontas da seta. */
export type ArrowMarkerType = 'none' | 'arrow' | 'dot';

/** Endpoint livre em coordenadas de mundo. */
export interface FreeEndpoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Endpoint vinculado a um shape alvo.
 * `anchor` são coordenadas normalizadas (geralmente [0, 1]) relativas à caixa do alvo.
 */
export interface BindingEndpoint {
  readonly targetId: string;
  readonly anchor: Point;
}

/** Extremo de uma seta: pode ser livre ou vinculado a um shape. */
export type ArrowEndpoint = FreeEndpoint | BindingEndpoint;

/** Type guard para endpoint vinculado. */
export function isBindingEndpoint(endpoint: ArrowEndpoint): endpoint is BindingEndpoint {
  return typeof (endpoint as Partial<BindingEndpoint>).targetId === 'string';
}

/** Type guard para endpoint livre. */
export function isFreeEndpoint(endpoint: ArrowEndpoint): endpoint is FreeEndpoint {
  return !isBindingEndpoint(endpoint) && typeof (endpoint as Partial<FreeEndpoint>).x === 'number';
}

/** Geometria de um nó alvo aceita para cálculo de âncora. */
export type AnchorTarget =
  | { readonly type: 'line' | 'bezier'; readonly start: Point; readonly end: Point }
  | { readonly type: 'arrow'; readonly start: ArrowEndpoint; readonly end: ArrowEndpoint }
  | {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rotation: number;
    };

/**
 * Calcula a posição no mundo de uma âncora normalizada em relação à geometria do nó alvo.
 */
export function resolveAnchorPosition(target: AnchorTarget, anchor: Point): Point {
  // A curva Bézier não recebe vínculo pela interação nesta entrega; se um documento trouxer
  // um, a âncora corre pela corda, como na linha, e nunca vira coordenada inválida.
  if ('type' in target && (target.type === 'line' || target.type === 'bezier')) {
    return {
      x: target.start.x + anchor.x * (target.end.x - target.start.x),
      y: target.start.y + anchor.x * (target.end.y - target.start.y),
    };
  }

  if ('type' in target && target.type === 'arrow') {
    const start = isFreeEndpoint(target.start) ? target.start : { x: 0, y: 0 };
    const end = isFreeEndpoint(target.end) ? target.end : { x: 0, y: 0 };
    return {
      x: start.x + anchor.x * (end.x - start.x),
      y: start.y + anchor.x * (end.y - start.y),
    };
  }

  // target tem caixa e rotação (rectangle, ellipse, text)
  const boxTarget = target as {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly rotation: number;
  };
  const centerX = boxTarget.x + boxTarget.width / 2;
  const centerY = boxTarget.y + boxTarget.height / 2;
  const localX = (anchor.x - 0.5) * boxTarget.width;
  const localY = (anchor.y - 0.5) * boxTarget.height;
  const cos = Math.cos(boxTarget.rotation);
  const sin = Math.sin(boxTarget.rotation);

  return {
    x: centerX + (cos * localX - sin * localY),
    y: centerY + (sin * localX + cos * localY),
  };
}

/**
 * Resolve a coordenada de mundo de um endpoint de seta.
 */
export function resolveEndpoint(
  endpoint: ArrowEndpoint,
  getNode: (id: string) => AnchorTarget | undefined,
): Point {
  if (isBindingEndpoint(endpoint)) {
    const target = getNode(endpoint.targetId);
    if (target !== undefined) {
      return resolveAnchorPosition(target, endpoint.anchor);
    }
    return { x: 0, y: 0 };
  }
  return { x: endpoint.x, y: endpoint.y };
}

/**
 * Resolve ambos os extremos de uma seta em coordenadas de mundo.
 */
export function resolveArrowEndpoints(
  arrow: { readonly start: ArrowEndpoint; readonly end: ArrowEndpoint },
  getNode: (id: string) => AnchorTarget | undefined,
): { readonly start: Point; readonly end: Point } {
  return {
    start: resolveEndpoint(arrow.start, getNode),
    end: resolveEndpoint(arrow.end, getNode),
  };
}

const EPSILON = 1e-9;

function isClose(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
}

/**
 * Verifica se uma seta possui segmento de comprimento zero.
 */
export function isZeroLengthArrow(
  arrow: { readonly start: ArrowEndpoint; readonly end: ArrowEndpoint },
  getNode?: (id: string) => AnchorTarget | undefined,
): boolean {
  // Dois endpoints livres
  if (isFreeEndpoint(arrow.start) && isFreeEndpoint(arrow.end)) {
    return isClose(arrow.start, arrow.end);
  }

  // Dois endpoints vinculados ao mesmo nó com a mesma âncora
  if (
    isBindingEndpoint(arrow.start) &&
    isBindingEndpoint(arrow.end) &&
    arrow.start.targetId === arrow.end.targetId &&
    isClose(arrow.start.anchor, arrow.end.anchor)
  ) {
    return true;
  }

  // Se podemos resolver ambos via getNode
  if (getNode !== undefined) {
    const startPoint = resolveEndpoint(arrow.start, getNode);
    const endPoint = resolveEndpoint(arrow.end, getNode);
    return isClose(startPoint, endPoint);
  }

  return false;
}
