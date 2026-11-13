import * as Y from 'yjs';

export interface YjsGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface YjsPlacement {
  parentId: string;
  orderKey: string;
}

export interface YjsEndpoints {
  start: { x: number; y: number; anchor?: { targetId: string; side?: string } };
  end: { x: number; y: number; anchor?: { targetId: string; side?: string } };
  startMarker?: 'dot';
  endMarker?: 'arrow';
}

export interface YjsShapeRecord {
  id: string;
  type:
    | 'rectangle'
    | 'square'
    | 'ellipse'
    | 'circle'
    | 'diamond'
    | 'triangle'
    | 'polygon'
    | 'cross'
    | 'chevron'
    | 'brace'
    | 'sticky'
    | 'ink'
    | 'line'
    | 'bezier'
    | 'arrow'
    | 'text'
    | 'board';
  geometry?: YjsGeometry;
  variant?: 'equilateral' | 'isosceles' | 'right' | 'scalene';
  apex?: number;
  sides?: number;
  /** Espessura dos braços da cruz como fração do lado menor. */
  armRatio?: number;
  /** Para onde a ponta do chevron aponta. */
  direction?: 'right' | 'left' | 'up' | 'down';
  /** Profundidade da ponta e do entalhe do chevron, de 0 a 0,5. */
  notchDepth?: number;
  /** Para onde a ponta central da chave aponta. */
  orientation?: 'left' | 'right' | 'up' | 'down';
  /** Posição da ponta da chave ao longo do eixo, de 0 a 1. */
  tipPosition?: number;
  /** Curvatura da chave, de 0 a 1. */
  curvature?: number;
  /** Pontas da linha, da seta e da curva Bézier. */
  endpoints?: YjsEndpoints;
  control1?: { x: number; y: number };
  control2?: { x: number; y: number };
  symmetric?: boolean;
  text?: string;
  fontSize?: number;
  /** `auto`: a fonte acompanha a escala da caixa. `fixed`: só a largura muda no resize. */
  fontSizeMode?: 'auto' | 'fixed';
  fontFamily?: string;
  fontWeight?: string;
  align?: string;
  /** Entrelinha do texto da nota adesiva. */
  lineHeight?: number;
  /** Elemento de traços: a lista inteira, em pontos locais, como um valor atômico. */
  strokes?: unknown;
  /**
   * Texto dentro da forma fechada. Cada campo é uma unidade de conflito; sem `labelText`
   * a forma não tem texto, qualquer que seja o resto.
   */
  labelText?: string;
  labelFontSize?: number;
  labelFontFamily?: string;
  labelFontWeight?: string | number;
  /** `null`: cor automática pelo contraste com o preenchimento. */
  labelColor?: string | null;
  labelAlign?: string;
  labelVerticalAlign?: string;
  fill?: string | null;
  stroke?: string | null;
  strokeWidth?: number;
  opacity?: number;
  /** Board: o título, de uma linha. */
  title?: string;
  /** Board: a opacidade só do fundo, de 0 a 1. */
  fillOpacity?: number;
  placement: YjsPlacement;
  generation: number;
  isDeleted: boolean;
}

export interface YjsLayerRecord {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  orderKey: string;
  isDeleted: boolean;
}

export interface YjsGroupRecord {
  id: string;
  placement: YjsPlacement;
  generation: number;
  isDeleted: boolean;
}

export interface YjsDocumentCollections {
  readonly meta: Y.Map<unknown>;
  readonly shapes: Y.Map<Y.Map<unknown>>;
  readonly layers: Y.Map<Y.Map<unknown>>;
  readonly groups: Y.Map<Y.Map<unknown>>;
}

export function getDocumentCollections(doc: Y.Doc): YjsDocumentCollections {
  return {
    meta: doc.getMap('meta'),
    shapes: doc.getMap('shapes'),
    layers: doc.getMap('layers'),
    groups: doc.getMap('groups'),
  };
}

export function initYjsDocument(doc: Y.Doc, roomEpoch = 'epoch-1'): void {
  const { meta, layers } = getDocumentCollections(doc);
  if (!meta.has('roomEpoch')) {
    meta.set('roomEpoch', roomEpoch);
    meta.set('schemaVersion', 1);
    meta.set('createdAt', Date.now());
  }

  // Cria camada padrão inicial se não houver camadas
  if (layers.size === 0) {
    const defaultLayer = new Y.Map<unknown>();
    defaultLayer.set('id', 'layer-default');
    defaultLayer.set('name', 'Camada 1');
    defaultLayer.set('visible', true);
    defaultLayer.set('locked', false);
    defaultLayer.set('orderKey', 'm');
    defaultLayer.set('isDeleted', false);
    layers.set('layer-default', defaultLayer);
  }
}
