import {
  resolveArrowEndpoints,
  type ArrowMarkerType,
  type BoardNode,
  type CanvasDocument,
  type CanvasPreview,
  type CanvasSnapshot,
  type Color,
  type FontWeight,
  type InkStroke,
  type Point,
  type ShapeLabel,
  type ShapeNode,
  type TextAlign,
  type TriangleVariant,
} from '@canvash/core';

/** Estilo materializado de desenho para um item projetado. */
export interface RenderableStyle {
  readonly fill: Color | null;
  readonly stroke: Color | null;
  readonly strokeWidth: number;
  readonly opacity: number;
}

export interface RenderableRectangle {
  readonly type: 'rectangle';
  readonly id: string;
  readonly layerId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly style: RenderableStyle;
  /** Texto da forma, quando ela tem; o renderer o quebra e recorta na área inscrita. */
  readonly label?: ShapeLabel | undefined;
}

export interface RenderableSquare {
  readonly type: 'square';
  readonly id: string;
  readonly layerId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly style: RenderableStyle;
  /** Texto da forma, quando ela tem; o renderer o quebra e recorta na área inscrita. */
  readonly label?: ShapeLabel | undefined;
}

export interface RenderableEllipse {
  readonly type: 'ellipse';
  readonly id: string;
  readonly layerId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly style: RenderableStyle;
  /** Texto da forma, quando ela tem; o renderer o quebra e recorta na área inscrita. */
  readonly label?: ShapeLabel | undefined;
}

export interface RenderableCircle {
  readonly type: 'circle';
  readonly id: string;
  readonly layerId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly style: RenderableStyle;
  /** Texto da forma, quando ela tem; o renderer o quebra e recorta na área inscrita. */
  readonly label?: ShapeLabel | undefined;
}

export interface RenderableDiamond {
  readonly type: 'diamond';
  readonly id: string;
  readonly layerId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly style: RenderableStyle;
  /** Texto da forma, quando ela tem; o renderer o quebra e recorta na área inscrita. */
  readonly label?: ShapeLabel | undefined;
}

export interface RenderableTriangle {
  readonly type: 'triangle';
  readonly id: string;
  readonly layerId: string;
  readonly variant: TriangleVariant;
  readonly apex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly style: RenderableStyle;
  /** Texto da forma, quando ela tem; o renderer o quebra e recorta na área inscrita. */
  readonly label?: ShapeLabel | undefined;
}

export interface RenderablePolygon {
  readonly type: 'polygon';
  readonly id: string;
  readonly layerId: string;
  readonly sides: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly style: RenderableStyle;
  /** Texto da forma, quando ela tem; o renderer o quebra e recorta na área inscrita. */
  readonly label?: ShapeLabel | undefined;
}

export interface RenderableCross {
  readonly type: 'cross';
  readonly id: string;
  readonly layerId: string;
  readonly armRatio: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly style: RenderableStyle;
  /** Texto da forma, quando ela tem; o renderer o quebra e recorta na área inscrita. */
  readonly label?: ShapeLabel | undefined;
}

export interface RenderableChevron {
  readonly type: 'chevron';
  readonly id: string;
  readonly layerId: string;
  readonly direction: 'right' | 'left' | 'up' | 'down';
  readonly notchDepth: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly style: RenderableStyle;
  /** Texto da forma, quando ela tem; o renderer o quebra e recorta na área inscrita. */
  readonly label?: ShapeLabel | undefined;
}

export interface RenderableBrace {
  readonly type: 'brace';
  readonly id: string;
  readonly layerId: string;
  readonly orientation: 'left' | 'right' | 'up' | 'down';
  readonly tipPosition: number;
  readonly curvature: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  /** Só traço: `fill` é sempre `null`. */
  readonly style: RenderableStyle;
}

export interface RenderableLine {
  readonly type: 'line';
  readonly id: string;
  readonly layerId: string;
  readonly start: Point;
  readonly end: Point;
  readonly style: RenderableStyle;
}

export interface RenderableBezier {
  readonly type: 'bezier';
  readonly id: string;
  readonly layerId: string;
  readonly start: Point;
  readonly control1: Point;
  readonly control2: Point;
  readonly end: Point;
  readonly style: RenderableStyle;
}

export interface RenderableText {
  readonly type: 'text';
  readonly id: string;
  readonly layerId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly text: string;
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly fontWeight: FontWeight;
  readonly textAlign: TextAlign;
  readonly lineHeight: number;
  readonly style: RenderableStyle;
}

export interface RenderableSticky {
  readonly type: 'sticky';
  readonly id: string;
  readonly layerId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly text: string;
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly fontWeight: FontWeight;
  readonly textAlign: TextAlign;
  readonly lineHeight: number;
  /** `fill` é a cor da nota. */
  readonly style: RenderableStyle;
}

export interface RenderableInk {
  readonly type: 'ink';
  readonly id: string;
  readonly layerId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  /** Pontos locais da caixa, de 0 a 1. */
  readonly strokes: readonly InkStroke[];
  /** Só a opacidade vale: cor, tipo e espessura são de cada traço. */
  readonly style: RenderableStyle;
}

export interface RenderableArrow {
  readonly type: 'arrow';
  readonly id: string;
  readonly layerId: string;
  readonly start: Point;
  readonly end: Point;
  readonly startMarker: ArrowMarkerType;
  readonly endMarker: ArrowMarkerType;
  readonly style: RenderableStyle;
}

/** A cor padrão do título do board na tela e na exportação. */
export const DEFAULT_BOARD_TITLE_COLOR = '#3f3f46';

/** Board: fundo com opacidade própria, borda de 1 unidade e o título acima do canto. */
export interface RenderableBoard {
  readonly type: 'board';
  readonly id: string;
  readonly layerId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** `null` não pinta o fundo (é o caso do board da prévia de criação). */
  readonly fill: Color | null;
  /** Opacidade só do fundo, de 0 a 1. */
  readonly fillOpacity: number;
  readonly stroke: Color | null;
  /** Sem título, o pintor não o desenha (a exportação do board omite o título). */
  readonly title?: string | undefined;
  readonly titleColor: Color;
}

/** Item projetado para renderização em ordem de desenho. */
export type RenderableItem =
  | RenderableBoard
  | RenderableRectangle
  | RenderableSquare
  | RenderableEllipse
  | RenderableCircle
  | RenderableDiamond
  | RenderableTriangle
  | RenderablePolygon
  | RenderableCross
  | RenderableChevron
  | RenderableBrace
  | RenderableLine
  | RenderableBezier
  | RenderableText
  | RenderableSticky
  | RenderableInk
  | RenderableArrow;

/** Cena projetada com a lista ordenada de itens para pintura. */
export interface ProjectedScene {
  readonly items: readonly RenderableItem[];
}

/** Filtro ou conjunto de consulta para culling de nós. Compatível diretamente com `Set<string>`. */
export interface CandidateIdFilter {
  readonly has: (id: string) => boolean;
}

/** Opções da projeção de cena. */
export interface ProjectSceneOptions {
  /** Preview efêmero a sobrepor/intercalar na cena. */
  readonly preview?: CanvasPreview | null | undefined;
  /** Conjunto opcional de IDs candidatos pré-filtrados (ex: via spatial index / culling). Compatível com `Set<string>`. */
  readonly candidateIds?: CandidateIdFilter | undefined;
  /** Cor do título dos boards. O padrão é `#3f3f46`. */
  readonly boardTitleColor?: string | undefined;
  /**
   * Com `false`, o `RenderableBoard` sai sem `title` e ninguém desenha o título (é o que a
   * exportação só do board pede). Padrão: `true`.
   */
  readonly boardTitles?: boolean | undefined;
}

/** O fragmento que carrega o `label` só quando a forma tem um, sem a chave com `undefined`. */
function labelOf(node: { readonly label?: ShapeLabel | undefined }): {
  readonly label?: ShapeLabel;
} {
  return node.label === undefined ? {} : { label: node.label };
}

function toRenderableBoard(
  node: BoardNode,
  layerId: string,
  titleColor: string,
  withBackground: boolean,
  withTitle: boolean,
): RenderableBoard {
  return {
    type: 'board',
    id: node.id,
    layerId,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    fill: withBackground ? node.style.fill : null,
    fillOpacity: node.style.fillOpacity,
    stroke: node.style.stroke,
    ...(withTitle ? { title: node.title } : {}),
    titleColor,
  };
}

function toRenderableItem(
  node: ShapeNode,
  layerId: string,
  getNodeById?: (id: string) => ShapeNode | undefined,
): RenderableItem | undefined {
  if (
    node.type === 'rectangle' ||
    node.type === 'square' ||
    node.type === 'ellipse' ||
    node.type === 'circle' ||
    node.type === 'diamond'
  ) {
    return {
      type: node.type,
      id: node.id,
      layerId,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rotation: node.rotation,
      style: {
        fill: node.style.fill,
        stroke: node.style.stroke,
        strokeWidth: node.style.strokeWidth,
        opacity: node.style.opacity,
      },
      ...labelOf(node),
    };
  }

  if (node.type === 'triangle') {
    return {
      type: 'triangle',
      id: node.id,
      layerId,
      variant: node.variant,
      apex: node.apex,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rotation: node.rotation,
      style: {
        fill: node.style.fill,
        stroke: node.style.stroke,
        strokeWidth: node.style.strokeWidth,
        opacity: node.style.opacity,
      },
      ...labelOf(node),
    };
  }

  if (node.type === 'polygon') {
    return {
      type: 'polygon',
      id: node.id,
      layerId,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rotation: node.rotation,
      sides: node.sides,
      style: {
        fill: node.style.fill,
        stroke: node.style.stroke,
        strokeWidth: node.style.strokeWidth,
        opacity: node.style.opacity,
      },
      ...labelOf(node),
    };
  }

  if (node.type === 'cross') {
    return {
      type: 'cross',
      id: node.id,
      layerId,
      armRatio: node.armRatio,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rotation: node.rotation,
      style: {
        fill: node.style.fill,
        stroke: node.style.stroke,
        strokeWidth: node.style.strokeWidth,
        opacity: node.style.opacity,
      },
      ...labelOf(node),
    };
  }

  if (node.type === 'chevron') {
    return {
      type: 'chevron',
      id: node.id,
      layerId,
      direction: node.direction,
      notchDepth: node.notchDepth,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rotation: node.rotation,
      style: {
        fill: node.style.fill,
        stroke: node.style.stroke,
        strokeWidth: node.style.strokeWidth,
        opacity: node.style.opacity,
      },
      ...labelOf(node),
    };
  }

  if (node.type === 'brace') {
    return {
      type: 'brace',
      id: node.id,
      layerId,
      orientation: node.orientation,
      tipPosition: node.tipPosition,
      curvature: node.curvature,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rotation: node.rotation,
      style: {
        fill: null,
        stroke: node.style.stroke,
        strokeWidth: node.style.strokeWidth,
        opacity: node.style.opacity,
      },
    };
  }

  if (node.type === 'bezier') {
    return {
      type: 'bezier',
      id: node.id,
      layerId,
      start: node.start,
      control1: node.control1,
      control2: node.control2,
      end: node.end,
      style: {
        fill: null,
        stroke: node.style.stroke,
        strokeWidth: node.style.strokeWidth,
        opacity: node.style.opacity,
      },
    };
  }

  if (node.type === 'line') {
    return {
      type: 'line',
      id: node.id,
      layerId,
      start: node.start,
      end: node.end,
      style: {
        fill: null,
        stroke: node.style.stroke,
        strokeWidth: node.style.strokeWidth,
        opacity: node.style.opacity,
      },
    };
  }

  if (node.type === 'text') {
    return {
      type: 'text',
      id: node.id,
      layerId,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rotation: node.rotation,
      text: node.text,
      fontSize: node.fontSize,
      fontFamily: node.fontFamily,
      fontWeight: node.fontWeight,
      textAlign: node.textAlign,
      lineHeight: node.lineHeight,
      style: {
        fill: node.style.fill,
        stroke: node.style.stroke,
        strokeWidth: node.style.strokeWidth,
        opacity: node.style.opacity,
      },
    };
  }

  if (node.type === 'sticky') {
    return {
      type: 'sticky',
      id: node.id,
      layerId,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rotation: node.rotation,
      text: node.text,
      fontSize: node.fontSize,
      fontFamily: node.fontFamily,
      fontWeight: node.fontWeight,
      textAlign: node.textAlign,
      lineHeight: node.lineHeight,
      style: {
        fill: node.style.fill,
        stroke: node.style.stroke,
        strokeWidth: node.style.strokeWidth,
        opacity: node.style.opacity,
      },
    };
  }

  if (node.type === 'ink') {
    return {
      type: 'ink',
      id: node.id,
      layerId,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rotation: node.rotation,
      strokes: node.strokes,
      style: { fill: null, stroke: null, strokeWidth: 0, opacity: node.style.opacity },
    };
  }

  if (node.type === 'arrow') {
    const endpoints = resolveArrowEndpoints(node, getNodeById ?? (() => undefined));
    return {
      type: 'arrow',
      id: node.id,
      layerId,
      start: endpoints.start,
      end: endpoints.end,
      startMarker: node.startMarker,
      endMarker: node.endMarker,
      style: {
        fill: null,
        stroke: node.style.stroke,
        strokeWidth: node.style.strokeWidth,
        opacity: node.style.opacity,
      },
    };
  }

  return undefined;
}

/**
 * Transforma um snapshot ou documento e opções em uma lista ordenada de desenho (RENDER-01).
 * Função pura e determinística. Camadas e nós ocultos ficam fora; a ordem respeita o documento.
 * Previews efêmeros substituem nós existentes na mesma posição visual e adições aparecem à frente.
 * Quando candidateIds for fornecido (culling), apenas nós com IDs candidatos são incluídos.
 */
export function projectScene(
  source: CanvasSnapshot | CanvasDocument,
  options?: ProjectSceneOptions,
): ProjectedScene {
  const document = 'document' in source ? source.document : source;
  const preview = options?.preview;
  const candidateIds = options?.candidateIds;
  const titleColor = options?.boardTitleColor ?? DEFAULT_BOARD_TITLE_COLOR;
  const withTitles = options?.boardTitles !== false;
  const items: RenderableItem[] = [];

  const getNodeById = (id: string): ShapeNode | undefined => {
    const node = preview?.updates[id] ?? document.nodes[id];
    if (!node || node.type === 'group' || node.type === 'board') return undefined;
    return node;
  };

  const renderShapeNode = (node: ShapeNode, layerId: string) => {
    if (candidateIds !== undefined && !candidateIds.has(node.id)) return;
    if (!node.visible) return;
    const item = toRenderableItem(node, layerId, getNodeById);
    if (item) items.push(item);
  };

  const renderBoardNode = (node: BoardNode, layerId: string, withBackground: boolean) => {
    if (candidateIds !== undefined && !candidateIds.has(node.id)) return;
    if (!node.visible) return;
    items.push(toRenderableBoard(node, layerId, titleColor, withBackground, withTitles));
  };

  /** Um filho de camada ou de board: a forma, ou os membros do grupo logo depois dele. */
  const renderChild = (childId: string, layerId: string) => {
    const node = preview?.updates[childId] ?? document.nodes[childId];
    if (!node || !node.visible || node.type === 'board') return;
    if (node.type === 'group') {
      for (const subId of node.childIds) {
        const childNode = preview?.updates[subId] ?? document.nodes[subId];
        if (childNode && childNode.type !== 'group' && childNode.type !== 'board') {
          renderShapeNode(childNode, layerId);
        }
      }
    } else {
      renderShapeNode(node, layerId);
    }
  };

  for (const layer of document.layers) {
    if (!layer.visible) continue;
    for (const childId of layer.childIds) {
      const node = preview?.updates[childId] ?? document.nodes[childId];
      if (!node || !node.visible) continue;
      if (node.type === 'board') {
        // A geometria pode vir do preview, mas os filhos são sempre os do documento: o board da
        // prévia não tem lista de filhos. O fundo vem antes deles pela própria ordem.
        renderBoardNode(node, layer.id, true);
        const stored = document.nodes[childId];
        if (stored?.type === 'board') {
          for (const boardChildId of stored.childIds) renderChild(boardChildId, layer.id);
        }
      } else {
        renderChild(childId, layer.id);
      }
    }
  }

  if (preview?.additions) {
    for (const addition of preview.additions) {
      // O board novo é só a moldura: o fundo cobriria o que ele vai adotar.
      if (addition.type === 'board') renderBoardNode(addition, 'preview', false);
      else renderShapeNode(addition, 'preview');
    }
  }

  return { items };
}
