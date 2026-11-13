import {
  bezierBounds,
  isBoxShape,
  type Bounds,
  type BoardNode,
  type Point,
  type ShapeNode,
  type Viewport,
} from '@canvash/core';

/** Identificador de cada handle de controle da seleção. */
export type OverlayHandleId = 'tl' | 'tr' | 'br' | 'bl' | 'tc' | 'rc' | 'bc' | 'lc' | 'rot';

/** Posição de um handle de manipulação em coordenadas de tela (CSS px). */
export interface OverlayHandle {
  readonly id: OverlayHandleId;
  readonly x: number;
  readonly y: number;
}

/** Retângulo de seleção e handles em coordenadas de tela (CSS px). */
export interface SelectionOverlay {
  readonly bounds: Bounds;
  readonly handles: readonly OverlayHandle[];
  readonly rotationHandle?: OverlayHandle | undefined;
}

/** Opções customizáveis para a camada visual de overlays. */
export interface OverlayOptions {
  /** Cor do contorno de seleção. Padrão: '#6d5df6' (violeta, o acento da biblioteca). */
  readonly selectionColor?: string | undefined;
  /** Espessura do contorno de seleção em CSS px. Padrão: 1.5. */
  readonly selectionLineWidth?: number | undefined;
  /** Dimensão lateral de cada handle quadrado em CSS px. Padrão: 8. */
  readonly handleSize?: number | undefined;
  /** Preenchimento de cada handle. Padrão: '#ffffff' (branco). */
  readonly handleFill?: string | undefined;
  /** Cor de borda de cada handle. Padrão: '#6d5df6'. */
  readonly handleStroke?: string | undefined;
  /** Preenchimento do retângulo de marquee. Padrão: 'rgba(109, 93, 246, 0.08)'. */
  readonly marqueeFill?: string | undefined;
  /** Cor do contorno de marquee. Padrão: '#6d5df6'. */
  readonly marqueeStroke?: string | undefined;
  /** Espessura do traço de marquee em CSS px. Padrão: 1. */
  readonly marqueeLineWidth?: number | undefined;
  /** Padrão de traço do contorno de marquee. Padrão: [4, 4]. */
  readonly marqueeLineDash?: readonly number[] | undefined;
  /** Exibe o manipulador de rotação superior. Padrão: false. */
  readonly showRotationHandle?: boolean | undefined;
  /** Cor das guias efêmeras de snapping. Padrão: '#ec4899' (magenta / pink). */
  readonly guideColor?: string | undefined;
  /** Espessura do traço das guias de snapping em CSS px. Padrão: 1. */
  readonly guideLineWidth?: number | undefined;
  /** Padrão de traço das guias de snapping. Padrão: [4, 4]. */
  readonly guideLineDash?: readonly number[] | undefined;
  /** Cor do indicador da borracha. Padrão: '#334155'. */
  readonly eraserCursorColor?: string | undefined;
}

/** Guia visual efêmera de alinhamento magnético (snapping). */
export interface OverlayGuide {
  readonly axis: 'x' | 'y';
  readonly coordinate: number;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
}

/** Indicador da borracha sob o ponteiro: ponto em coordenadas de mundo e raio em CSS px. */
export interface OverlayEraserCursor {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** Parâmetros para pintura da camada de overlays. */
export interface PaintOverlaysParams {
  readonly viewport: Viewport;
  /** Bounds agregados dos nós selecionados em coordenadas de mundo. */
  readonly selectionBounds?: Bounds | null | undefined;
  /** Nós selecionados para renderização orientada de contorno e alças. */
  readonly selectedNodes?: readonly (ShapeNode | BoardNode)[] | undefined;
  /** Retângulo de marquee de seleção em andamento em coordenadas de mundo. */
  readonly marquee?: Bounds | null | undefined;
  /** Retângulo do board que receberia o arrasto em andamento, em coordenadas de mundo. */
  readonly dropTarget?: Bounds | null | undefined;
  /** Guias efêmeras de alinhamento magnético (snapping). */
  readonly guides?: readonly OverlayGuide[] | undefined;
  /** Indicador circular da borracha. Efêmero: nunca entra na exportação. */
  readonly eraserCursor?: OverlayEraserCursor | null | undefined;
  readonly options?: OverlayOptions | undefined;
}

/**
 * Converte os bounds agregados de seleção (em coordenadas de mundo)
 * para coordenadas de tela e gera as 8 âncoras de handles com dimensão constante em CSS px.
 */
export function computeSelectionOverlay(
  selectionWorldBounds: Bounds,
  viewport: Viewport,
): SelectionOverlay {
  const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
  const screenX = selectionWorldBounds.x * zoom + viewport.x;
  const screenY = selectionWorldBounds.y * zoom + viewport.y;
  const screenWidth = selectionWorldBounds.width * zoom;
  const screenHeight = selectionWorldBounds.height * zoom;

  const left = screenX;
  const right = screenX + screenWidth;
  const top = screenY;
  const bottom = screenY + screenHeight;
  const centerX = screenX + screenWidth / 2;
  const centerY = screenY + screenHeight / 2;

  const handles: readonly OverlayHandle[] = [
    { id: 'tl', x: left, y: top },
    { id: 'tr', x: right, y: top },
    { id: 'br', x: right, y: bottom },
    { id: 'bl', x: left, y: bottom },
    { id: 'tc', x: centerX, y: top },
    { id: 'rc', x: right, y: centerY },
    { id: 'bc', x: centerX, y: bottom },
    { id: 'lc', x: left, y: centerY },
  ];

  const rotY = top - 24;
  const rotationHandle: OverlayHandle = {
    id: 'rot',
    x: centerX,
    y: rotY,
  };

  return {
    bounds: {
      x: screenX,
      y: screenY,
      width: screenWidth,
      height: screenHeight,
    },
    handles,
    rotationHandle,
  };
}

/**
 * Pinta a camada superior de overlays (seleção e marquee) no Canvas 2D em CSS px.
 * Função defensiva e compatível com contextos completos ou mocks parciais.
 */
export function paintOverlays(
  context: CanvasRenderingContext2D,
  params: PaintOverlaysParams,
): void {
  const { viewport, selectionBounds, selectedNodes, marquee, guides, options } = params;
  if (
    !selectionBounds &&
    !marquee &&
    !params.dropTarget &&
    (!selectedNodes || selectedNodes.length === 0) &&
    (!guides || guides.length === 0) &&
    !params.eraserCursor
  ) {
    return;
  }

  const selectionColor = options?.selectionColor ?? '#6d5df6';
  const selectionLineWidth = options?.selectionLineWidth ?? 1.5;
  const handleSize = options?.handleSize ?? 8;
  const handleFill = options?.handleFill ?? '#ffffff';
  const handleStroke = options?.handleStroke ?? '#6d5df6';
  const marqueeFill = options?.marqueeFill ?? 'rgba(109, 93, 246, 0.08)';
  const marqueeStroke = options?.marqueeStroke ?? '#6d5df6';
  const marqueeLineWidth = options?.marqueeLineWidth ?? 1;
  const marqueeLineDash = options?.marqueeLineDash ?? [4, 4];
  const showRotationHandle = options?.showRotationHandle ?? false;
  const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
  const half = handleSize / 2;

  /** Caixa de seleção sem rotação, com as 8 alças e, se pedida, a alça de rotação. */
  const paintBoxSelection = (overlay: SelectionOverlay, onlyOutline = false): void => {
    const { bounds, handles, rotationHandle } = overlay;

    context.strokeStyle = selectionColor;
    context.lineWidth = selectionLineWidth;
    context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    // Numa seleção com board, só o contorno: o board não gira e não escala com outros nós.
    if (onlyOutline) return;

    for (const handle of handles) {
      const hx = handle.x - half;
      const hy = handle.y - half;
      context.fillStyle = handleFill;
      context.fillRect(hx, hy, handleSize, handleSize);
      context.strokeStyle = handleStroke;
      context.lineWidth = 1;
      context.strokeRect(hx, hy, handleSize, handleSize);
    }

    if (showRotationHandle && rotationHandle) {
      context.beginPath();
      context.strokeStyle = selectionColor;
      context.lineWidth = 1;
      context.moveTo(bounds.x + bounds.width / 2, bounds.y);
      context.lineTo(rotationHandle.x, rotationHandle.y);
      context.stroke();

      context.beginPath();
      context.arc(rotationHandle.x, rotationHandle.y, half, 0, Math.PI * 2);
      context.fillStyle = handleFill;
      context.fill();
      context.strokeStyle = handleStroke;
      context.lineWidth = 1;
      context.stroke();
    }
  };

  context.save();

  // 1. Desenho da Seleção
  if (selectedNodes && selectedNodes.length === 1) {
    const singleNode = selectedNodes[0];

    if (singleNode && isBoxShape(singleNode)) {
      const { x, y, width, height, rotation } = singleNode;
      const centerX = (x + width / 2) * zoom + viewport.x;
      const centerY = (y + height / 2) * zoom + viewport.y;
      const halfW = (width / 2) * zoom;
      const halfH = (height / 2) * zoom;
      const rot = rotation;

      context.save();
      context.translate(centerX, centerY);
      if (rot !== 0) {
        context.rotate(rot);
      }

      context.strokeStyle = selectionColor;
      context.lineWidth = selectionLineWidth;
      context.strokeRect(-halfW, -halfH, halfW * 2, halfH * 2);

      const handlesCoords: readonly (readonly [number, number])[] =
        singleNode.type === 'text'
          ? [
              [-halfW, -halfH],
              [halfW, -halfH],
              [halfW, 0],
              [halfW, halfH],
              [-halfW, halfH],
              [-halfW, 0],
            ]
          : [
              [-halfW, -halfH],
              [0, -halfH],
              [halfW, -halfH],
              [halfW, 0],
              [halfW, halfH],
              [0, halfH],
              [-halfW, halfH],
              [-halfW, 0],
            ];

      for (const coord of handlesCoords) {
        const hx = coord[0];
        const hy = coord[1];
        context.fillStyle = handleFill;
        context.fillRect(hx - half, hy - half, handleSize, handleSize);
        context.strokeStyle = handleStroke;
        context.lineWidth = 1;
        context.strokeRect(hx - half, hy - half, handleSize, handleSize);
      }

      if (showRotationHandle) {
        const rotY = -halfH - 24;
        context.beginPath();
        context.strokeStyle = selectionColor;
        context.lineWidth = 1;
        context.moveTo(0, -halfH);
        context.lineTo(0, rotY);
        context.stroke();

        context.beginPath();
        context.arc(0, rotY, half, 0, Math.PI * 2);
        context.fillStyle = handleFill;
        context.fill();
        context.strokeStyle = handleStroke;
        context.lineWidth = 1;
        context.stroke();
      }

      context.restore();
    } else if (singleNode && singleNode.type === 'board') {
      // O contorno e as 8 alças ficam no retângulo do board, sem a faixa do título e sem a alça
      // de rotação: o board não gira.
      const screen = {
        x: singleNode.x * zoom + viewport.x,
        y: singleNode.y * zoom + viewport.y,
        width: singleNode.width * zoom,
        height: singleNode.height * zoom,
      };
      const overlay = computeSelectionOverlay(
        { x: singleNode.x, y: singleNode.y, width: singleNode.width, height: singleNode.height },
        viewport,
      );
      context.strokeStyle = selectionColor;
      context.lineWidth = selectionLineWidth;
      context.strokeRect(screen.x, screen.y, screen.width, screen.height);
      for (const handle of overlay.handles) {
        context.fillStyle = handleFill;
        context.fillRect(handle.x - half, handle.y - half, handleSize, handleSize);
        context.strokeStyle = handleStroke;
        context.lineWidth = 1;
        context.strokeRect(handle.x - half, handle.y - half, handleSize, handleSize);
      }
    } else if (singleNode && singleNode.type === 'bezier') {
      // Caixa exata da curva com as alças de escala, linhas-guia de cada ponta ao seu controle,
      // alças quadradas nas pontas e redondas nos controles: as mesmas que a interação usa.
      paintBoxSelection(computeSelectionOverlay(bezierBounds(singleNode), viewport));
      const toScreen = (point: Point): Point => ({
        x: point.x * zoom + viewport.x,
        y: point.y * zoom + viewport.y,
      });
      const start = toScreen(singleNode.start);
      const end = toScreen(singleNode.end);
      const controls = [toScreen(singleNode.control1), toScreen(singleNode.control2)] as const;

      context.strokeStyle = selectionColor;
      context.lineWidth = 1;
      for (const [from, to] of [
        [start, controls[0]],
        [end, controls[1]],
      ] as const) {
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();
      }

      for (const point of [start, end]) {
        context.fillStyle = handleFill;
        context.fillRect(point.x - half, point.y - half, handleSize, handleSize);
        context.strokeStyle = handleStroke;
        context.strokeRect(point.x - half, point.y - half, handleSize, handleSize);
      }

      for (const point of controls) {
        context.beginPath();
        context.arc(point.x, point.y, half, 0, Math.PI * 2);
        context.fillStyle = handleFill;
        context.fill();
        context.strokeStyle = handleStroke;
        context.stroke();
      }
    } else if (singleNode && singleNode.type === 'line') {
      const { start, end } = singleNode;
      const sX = start.x * zoom + viewport.x;
      const sY = start.y * zoom + viewport.y;
      const eX = end.x * zoom + viewport.x;
      const eY = end.y * zoom + viewport.y;

      context.beginPath();
      context.strokeStyle = selectionColor;
      context.lineWidth = selectionLineWidth;
      context.moveTo(sX, sY);
      context.lineTo(eX, eY);
      context.stroke();

      const lineHandles: readonly (readonly [number, number])[] = [
        [sX, sY],
        [eX, eY],
      ];
      for (const coord of lineHandles) {
        const hx = coord[0];
        const hy = coord[1];
        context.fillStyle = handleFill;
        context.fillRect(hx - half, hy - half, handleSize, handleSize);
        context.strokeStyle = handleStroke;
        context.lineWidth = 1;
        context.strokeRect(hx - half, hy - half, handleSize, handleSize);
      }

      if (showRotationHandle) {
        const midX = (sX + eX) / 2;
        const midY = (sY + eY) / 2;
        const dx = eX - sX;
        const dy = eY - sY;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          const nx = dy / len;
          const ny = -dx / len;
          const rotX = midX + nx * 24;
          const rotY = midY + ny * 24;

          context.beginPath();
          context.strokeStyle = selectionColor;
          context.lineWidth = 1;
          context.moveTo(midX, midY);
          context.lineTo(rotX, rotY);
          context.stroke();

          context.beginPath();
          context.arc(rotX, rotY, half, 0, Math.PI * 2);
          context.fillStyle = handleFill;
          context.fill();
          context.strokeStyle = handleStroke;
          context.lineWidth = 1;
          context.stroke();
        }
      }
    }
  } else if (selectionBounds && selectionBounds.width >= 0 && selectionBounds.height >= 0) {
    paintBoxSelection(
      computeSelectionOverlay(selectionBounds, viewport),
      selectedNodes?.some((node) => node.type === 'board') === true,
    );
  }

  // 1b. Contorno do board que receberia o arrasto: 2 CSS px na cor de destaque
  if (params.dropTarget) {
    const { x, y, width, height } = params.dropTarget;
    context.strokeStyle = selectionColor;
    context.lineWidth = 2;
    context.strokeRect(x * zoom + viewport.x, y * zoom + viewport.y, width * zoom, height * zoom);
  }

  // 2. Desenho do Retângulo de Marquee
  if (marquee && marquee.width >= 0 && marquee.height >= 0) {
    const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
    const mx = marquee.x * zoom + viewport.x;
    const my = marquee.y * zoom + viewport.y;
    const mw = marquee.width * zoom;
    const mh = marquee.height * zoom;

    context.fillStyle = marqueeFill;
    context.fillRect(mx, my, mw, mh);

    context.strokeStyle = marqueeStroke;
    context.lineWidth = marqueeLineWidth;
    context.setLineDash([...marqueeLineDash]);
    context.strokeRect(mx, my, mw, mh);
    context.setLineDash([]);
  }

  // 3. Desenho de Guias Efêmeras de Snapping (INPUT-09)
  if (params.guides && params.guides.length > 0) {
    const guideColor = options?.guideColor ?? '#ec4899';
    const guideLineWidth = options?.guideLineWidth ?? 1;
    const guideLineDash = options?.guideLineDash ?? [4, 4];

    context.save();
    context.strokeStyle = guideColor;
    context.lineWidth = guideLineWidth;
    if (guideLineDash.length > 0) {
      context.setLineDash([...guideLineDash]);
    }

    const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
    for (const guide of params.guides) {
      context.beginPath();
      if (guide.axis === 'x') {
        const sx = guide.coordinate * zoom + viewport.x;
        const sy1 = guide.min !== undefined ? guide.min * zoom + viewport.y : -10000;
        const sy2 = guide.max !== undefined ? guide.max * zoom + viewport.y : 10000;
        context.moveTo(sx, sy1);
        context.lineTo(sx, sy2);
      } else {
        const sy = guide.coordinate * zoom + viewport.y;
        const sx1 = guide.min !== undefined ? guide.min * zoom + viewport.x : -10000;
        const sx2 = guide.max !== undefined ? guide.max * zoom + viewport.x : 10000;
        context.moveTo(sx1, sy);
        context.lineTo(sx2, sy);
      }
      context.stroke();
    }

    if (guideLineDash.length > 0) {
      context.setLineDash([]);
    }
    context.restore();
  }

  // 4. Indicador circular da borracha: raio fixo em CSS px, qualquer que seja o zoom.
  if (params.eraserCursor) {
    const { x, y, radius } = params.eraserCursor;
    context.save();
    context.strokeStyle = options?.eraserCursorColor ?? '#334155';
    context.lineWidth = 1;
    context.beginPath();
    context.arc(x * zoom + viewport.x, y * zoom + viewport.y, radius, 0, 2 * Math.PI);
    context.stroke();
    context.restore();
  }

  context.restore();
}
