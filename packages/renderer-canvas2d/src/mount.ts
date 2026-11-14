import type { BoardNode, CanvasPeer, CanvasSectionApi, Result, ShapeNode } from '@canvash/core';
import type { GridOptions, GridPointer } from './grid.js';
import { paintGrid } from './grid.js';
import type { OverlayEraserCursor, OverlayGuide, OverlayOptions } from './overlays.js';
import { paintOverlays } from './overlays.js';
import { paintScene } from './painter.js';
import { createPeerGhostCache, paintPeerGhosts, type PeerGhostPaint } from './peer-ghosts.js';
import { paintPeerLocks, type PeerLockOutline } from './peer-locks-paint.js';
import { createPeersLayer } from './peers.js';
import { projectScene } from './scene.js';
import { createScheduler } from './scheduler.js';
import { shapeLabelLayoutCount } from './shape-label.js';

/** Opções para montagem do renderer Canvas 2D. */
export interface MountOptions {
  /** Instância do canvas com o estado de edição. */
  readonly section: CanvasSectionApi;
  /** Elemento hospedeiro no DOM onde o `<canvas>` será inserido. */
  readonly container: HTMLElement;
  /** Configuração opcional da camada visual de grid. */
  readonly grid?: GridOptions | undefined;
  /** Configuração opcional da camada visual de overlays de seleção e marquee. */
  readonly overlays?: OverlayOptions | undefined;
  /** Callback opcional invocado quando ocorre uma falha na renderização sem corromper o canvas. */
  readonly onError?: ((error: unknown) => void) | undefined;
  /** Opções da colaboração: o que o renderer desenha dos outros participantes. */
  readonly peers?: MountPeersOptions | undefined;
}

/** O que o renderer desenha dos participantes remotos. */
export interface MountPeersOptions {
  /**
   * Mostra o contorno simplificado dos nós que um participante está arrastando. Padrão: `true`.
   * Sem ele, os outros só veem a forma pular no commit.
   */
  readonly dragPreview?: boolean | undefined;
}

/** Métricas operacionais da instância do renderer. */
export interface RendererMetrics {
  /** Device Pixel Ratio ativo. */
  readonly dpr: number;
  /** Largura lógica em CSS px. */
  readonly width: number;
  /** Altura lógica em CSS px. */
  readonly height: number;
  /** Quantidade de itens projetados e desenhados no último ciclo. */
  readonly renderedItemsCount: number;
  /** Quantidade total acumulada de pinturas realizadas. */
  readonly paintCount: number;
  /** Duração em milissegundos do trabalho de renderização (JS + Canvas 2D) do último ciclo. */
  readonly lastPaintDurationMs?: number | undefined;
  /**
   * Quebras de texto das formas calculadas desde o início (uma por valor novo de texto, fonte,
   * alinhamento ou largura da área). Não cresce enquanto os textos não mudam.
   */
  readonly labelLayoutCount: number;
}

/** Controle da instância montada do renderer. */
export interface RendererHandle {
  /** Solicita repintura no próximo ciclo de animação. */
  readonly invalidate: () => void;
  /** Força recálculo de dimensões do host e backing store. */
  readonly resize: () => void;
  /** Retorna as métricas operacionais atuais. */
  readonly getMetrics: () => RendererMetrics;
  /** Define ou limpa as guias efêmeras de snapping nos overlays. */
  readonly setGuides: (guides: readonly OverlayGuide[] | null) => void;
  /** Retorna as guias efêmeras ativas nos overlays. */
  readonly getGuides: () => readonly OverlayGuide[];
  /**
   * Mostra (ou esconde, com `null`) o indicador circular da borracha: ponto em mundo e raio em
   * CSS px. A cor vem de `--canvash-eraser-cursor` no contêiner, se definida. Efêmero: nunca vai
   * para a exportação.
   */
  readonly setEraserCursor: (cursor: OverlayEraserCursor | null) => void;
  /** O indicador da borracha ativo, ou `null`. */
  readonly getEraserCursor: () => OverlayEraserCursor | null;
  /**
   * Contorna o board que receberia o que está sendo arrastado (`null` apaga). Efêmero: só
   * overlay, nunca vai para o documento, o histórico, o preview nem a exportação.
   */
  readonly setDropTarget: (boardId: string | null) => void;
  /** O board de destino contornado, ou `null`. */
  readonly getDropTarget: () => string | null;
  /** Posição do ponteiro para o realce do grid, em CSS px relativos ao canvas; `null` apaga. */
  readonly setGridPointer: (point: GridPointer | null) => void;
  readonly getGridPointer: () => GridPointer | null;
  /** Desmonta o canvas, desfaz inscrições e libera recursos. */
  readonly destroy: () => void;
}

export interface ContextUnavailableError {
  readonly code: 'CONTEXT_UNAVAILABLE';
  readonly message: string;
}

export interface ContainerInvalidError {
  readonly code: 'CONTAINER_INVALID';
  readonly message: string;
}

export interface DisposedRendererError {
  readonly code: 'DISPOSED';
  readonly message: string;
}

/** Erros possíveis retornados por operações do renderer. */
export type RendererError = ContextUnavailableError | ContainerInvalidError | DisposedRendererError;

/**
 * Monta o renderer Canvas 2D no container indicado.
 * Devolve Result<RendererHandle, RendererError>. Em caso de indisponibilidade de contexto
 * ou container inválido, devolve erro tipado sem corromper o canvas.
 */
export function mount(options: MountOptions): Result<RendererHandle, RendererError> {
  if (!options || !options.container || typeof options.container.appendChild !== 'function') {
    return {
      ok: false,
      error: {
        code: 'CONTAINER_INVALID',
        message: 'Container must be a valid HTMLElement',
      },
    };
  }

  const doc =
    options.container.ownerDocument ?? (typeof document !== 'undefined' ? document : null);

  if (!doc || typeof doc.createElement !== 'function') {
    return {
      ok: false,
      error: {
        code: 'CONTEXT_UNAVAILABLE',
        message: 'DOM Document is unavailable',
      },
    };
  }

  const canvas = doc.createElement('canvas');
  const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!context) {
    return {
      ok: false,
      error: {
        code: 'CONTEXT_UNAVAILABLE',
        message: 'Canvas 2D context is unavailable',
      },
    };
  }

  const win = doc.defaultView ?? (typeof window !== 'undefined' ? window : null);
  const getDpr = (): number => {
    return win && typeof win.devicePixelRatio === 'number' && win.devicePixelRatio > 0
      ? win.devicePixelRatio
      : 1;
  };

  const getContainerSize = (): { width: number; height: number } => {
    let width: number | undefined;
    let height: number | undefined;

    if (typeof options.container.clientWidth === 'number') {
      width = options.container.clientWidth;
      height = options.container.clientHeight;
    } else if (typeof options.container.getBoundingClientRect === 'function') {
      const rect = options.container.getBoundingClientRect();
      if (rect) {
        width = rect.width;
        height = rect.height;
      }
    }

    if (width === undefined && height === undefined && canvas.width > 0 && canvas.height > 0) {
      width = canvas.width;
      height = canvas.height;
    }

    return {
      width: Math.max(0, Math.round(width ?? 0)),
      height: Math.max(0, Math.round(height ?? 0)),
    };
  };

  let dpr = getDpr();
  let logicalWidth = 0;
  let logicalHeight = 0;
  let physicalWidth = 0;
  let physicalHeight = 0;
  let renderedItemsCount = 0;
  let paintCount = 0;
  let lastPaintDurationMs: number | undefined;
  let isDisposed = false;
  let activeGuides: readonly OverlayGuide[] = [];
  let dropTargetId: string | null = null;
  let eraserCursor: OverlayEraserCursor | null = null;
  let gridPointer: GridPointer | null = null;

  /** O realce só aparece com grid ligado, em pontos e sem `highlight: false`. */
  const isGridHighlightVisible = (): boolean => {
    const grid = options.grid;
    return (
      grid?.enabled !== false && (grid?.style ?? 'dots') !== 'lines' && grid?.highlight !== false
    );
  };

  /** Cor do indicador da borracha: `--canvash-eraser-cursor` no contêiner, se houver. */
  const eraserCursorColor = (): string | undefined => {
    if (eraserCursor === null || typeof win?.getComputedStyle !== 'function') return undefined;
    const value = win
      .getComputedStyle(options.container)
      .getPropertyValue('--canvash-eraser-cursor');
    return value.trim() === '' ? undefined : value.trim();
  };

  /** Cor do título dos boards: `--canvash-board-title-color` no contêiner, se houver. */
  const boardTitleColor = (): string | undefined => {
    if (typeof win?.getComputedStyle !== 'function') return undefined;
    const value = win
      .getComputedStyle(options.container)
      .getPropertyValue('--canvash-board-title-color')
      .trim();
    return value === '' ? undefined : value;
  };

  /**
   * Acento da seleção: `--canvash-accent-select` no contêiner, se definido. Cor em `#rrggbb` também
   * dá o preenchimento translúcido do marquee. As opções explícitas de `overlays` vencem.
   */
  const accentOptions = (): OverlayOptions => {
    if (typeof win?.getComputedStyle !== 'function') return {};
    const value = win
      .getComputedStyle(options.container)
      .getPropertyValue('--canvash-accent-select')
      .trim();
    if (value === '') return {};
    const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
    const marqueeFill = hex
      ? `rgba(${parseInt(hex[1]!, 16)}, ${parseInt(hex[2]!, 16)}, ${parseInt(hex[3]!, 16)}, 0.08)`
      : undefined;
    return {
      selectionColor: value,
      handleStroke: value,
      marqueeStroke: value,
      ...(marqueeFill ? { marqueeFill } : {}),
    };
  };

  const reportRenderError = (err: unknown): void => {
    if (typeof options.onError === 'function') {
      try {
        options.onError(err);
      } catch (handlerErr) {
        if (win && typeof win.reportError === 'function') {
          win.reportError(handlerErr);
        } else {
          console.error(handlerErr);
        }
      }
    } else if (win && typeof win.reportError === 'function') {
      win.reportError(err);
    } else {
      console.error(err);
    }
  };

  const dragPreviewEnabled = options.peers?.dragPreview !== false;
  const ghostCache = createPeerGhostCache();

  /** Os participantes com arrasto em andamento; o cache esquece os demais. */
  const draggingPeers = (): CanvasPeer[] => {
    const section = options.section;
    if (!dragPreviewEnabled || typeof section.getPeers !== 'function') return [];
    const dragging = section.getPeers().filter((peer) => peer.drag !== null);
    ghostCache.retain(new Set(dragging.map((peer) => peer.sessionId)));
    return dragging;
  };

  /** As prévias de arrasto dos participantes, já com o deslocamento de cada um. */
  const peerGhostPaints = (zoom: number): PeerGhostPaint[] => {
    const section = options.section;
    const dragging = draggingPeers();
    const paints: PeerGhostPaint[] = [];
    for (const peer of dragging) {
      const ghost = ghostCache.get(section, peer, zoom);
      if (ghost && peer.drag) {
        paints.push({ ghost, dx: peer.drag.dx, dy: peer.drag.dy, color: peer.color });
      }
    }
    return paints;
  };

  /** Caixas dos nós que cada participante detém, para o contorno de bloqueio. */
  const peerLockOutlines = (): PeerLockOutline[] => {
    const section = options.section;
    if (typeof section.getPeers !== 'function' || typeof section.getBounds !== 'function')
      return [];
    const outlines: PeerLockOutline[] = [];
    for (const peer of section.getPeers()) {
      for (const id of peer.locks) {
        const bounds = section.getBounds([id], { stroke: true, includePreview: false });
        if (bounds) outlines.push({ bounds, color: peer.color, name: peer.name });
      }
    }
    return outlines;
  };

  const render = (): void => {
    if (isDisposed || logicalWidth <= 0 || logicalHeight <= 0) {
      return;
    }

    if (typeof options.section?.getSnapshot !== 'function') {
      return;
    }

    try {
      const startTime =
        win && typeof win.performance?.now === 'function' ? win.performance.now() : 0;

      const snapshot = options.section.getSnapshot();
      const viewport = snapshot.session.viewport;
      const preview =
        typeof options.section.getPreview === 'function' ? options.section.getPreview() : null;

      let candidateIds: Set<string> | undefined;
      if (typeof options.section.queryBounds === 'function') {
        const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
        const worldViewport = {
          x: -viewport.x / zoom,
          y: -viewport.y / zoom,
          width: logicalWidth / zoom,
          height: logicalHeight / zoom,
        };
        const queried = options.section.queryBounds(worldViewport, {
          includePreview: true,
          includeHidden: false,
        });
        candidateIds = new Set(queried);
      }

      const scene = projectScene(snapshot, {
        preview,
        candidateIds,
        boardTitleColor: boardTitleColor(),
      });

      // 1. Reset da matriz para coordenadas físicas e limpeza integral da backing store
      if (typeof context.setTransform === 'function') {
        context.setTransform(1, 0, 0, 1, 0, 0);
      }
      if (typeof context.clearRect === 'function') {
        context.clearRect(0, 0, physicalWidth, physicalHeight);
      }

      // 2. Base em CSS pixels proporcional ao DPR
      if (typeof context.setTransform === 'function') {
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      // 3. Camada visual de fundo: Grid
      paintGrid(context, {
        viewport,
        width: logicalWidth,
        height: logicalHeight,
        options: options.grid,
        pointer: gridPointer,
      });

      // 4. Camada de cena em coordenadas de mundo com pan e zoom do viewport
      if (typeof context.save === 'function') {
        context.save();
      }
      if (typeof context.translate === 'function') {
        context.translate(viewport.x, viewport.y);
      }
      if (typeof context.scale === 'function') {
        context.scale(viewport.zoom, viewport.zoom);
      }

      paintScene(context, scene);

      if (typeof context.restore === 'function') {
        context.restore();
      }

      // 5. Camada visual de overlays: seleção e marquee em CSS px
      const selectedIds = snapshot.session.selectedIds ?? [];
      const selectedNodes = selectedIds
        .map((id) => {
          const baseNode = snapshot.document.nodes[id];
          if (!baseNode) return undefined;
          if (preview?.updates && id in preview.updates) {
            return preview.updates[id];
          }
          return baseNode;
        })
        .filter(
          (node): node is ShapeNode | BoardNode => node !== undefined && node.type !== 'group',
        );

      const selectionBounds =
        selectedIds.length > 0 && typeof options.section.getBounds === 'function'
          ? (options.section.getBounds(selectedIds, { stroke: true, includePreview: true }) ?? null)
          : null;
      const marquee = preview?.marquee ?? null;

      const dropBoard = dropTargetId === null ? undefined : snapshot.document.nodes[dropTargetId];
      const dropTarget =
        dropBoard?.type === 'board'
          ? { x: dropBoard.x, y: dropBoard.y, width: dropBoard.width, height: dropBoard.height }
          : null;

      paintOverlays(context, {
        viewport,
        selectionBounds,
        selectedNodes,
        marquee,
        dropTarget,
        guides: activeGuides,
        eraserCursor,
        options: {
          showRotationHandle: true,
          eraserCursorColor: eraserCursorColor(),
          ...(selectionBounds !== null || marquee !== null || dropTarget !== null
            ? accentOptions()
            : {}),
          ...options.overlays,
        },
      });

      // 6. Contorno dos nós que outros participantes selecionaram (bloqueio) e prévia do arrasto
      paintPeerLocks(context, viewport, peerLockOutlines());
      paintPeerGhosts(context, viewport, peerGhostPaints(viewport.zoom));

      paintCount += 1;
      renderedItemsCount = scene.items.length;
      if (startTime > 0 && typeof win?.performance?.now === 'function') {
        lastPaintDurationMs = Math.round((win.performance.now() - startTime) * 1000) / 1000;
      }
    } catch (err) {
      reportRenderError(err);
    }
  };

  const scheduler = createScheduler({
    onPaint: render,
    requestAnimationFrame:
      win && typeof win.requestAnimationFrame === 'function'
        ? (cb) => win.requestAnimationFrame(cb)
        : undefined,
    cancelAnimationFrame:
      win && typeof win.cancelAnimationFrame === 'function'
        ? (id) => win.cancelAnimationFrame(id)
        : undefined,
  });

  const updateDimensions = (): void => {
    try {
      dpr = getDpr();
      const size = getContainerSize();
      logicalWidth = size.width;
      logicalHeight = size.height;
      physicalWidth = Math.round(logicalWidth * dpr);
      physicalHeight = Math.round(logicalHeight * dpr);

      if (canvas.width !== physicalWidth) {
        canvas.width = physicalWidth;
      }
      if (canvas.height !== physicalHeight) {
        canvas.height = physicalHeight;
      }
      if (canvas.style) {
        const styleW = `${logicalWidth}px`;
        const styleH = `${logicalHeight}px`;
        if (canvas.style.width !== styleW) {
          canvas.style.width = styleW;
        }
        if (canvas.style.height !== styleH) {
          canvas.style.height = styleH;
        }
      }

      if (typeof context.setTransform === 'function') {
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    } catch (err) {
      reportRenderError(err);
    }
  };

  options.container.appendChild(canvas);
  updateDimensions();
  render();

  // Cursores dos peers: camada DOM acima do canvas, fora da exportação.
  const peersLayer = createPeersLayer(options.container);
  const refreshPeers = (): void => {
    const section = options.section;
    if (typeof section?.getPeers !== 'function' || typeof section.getSnapshot !== 'function')
      return;
    peersLayer.update(section.getPeers(), section.getSnapshot().session.viewport);
  };
  refreshPeers();

  const unsubscribe =
    typeof options.section?.subscribe === 'function'
      ? options.section.subscribe((change) => {
          scheduler.invalidate();
          // O fim de um arrasto tem de chegar ao cache mesmo que nenhum quadro seja desenhado antes
          // do gesto seguinte; senão o gesto novo herda o "já confirmado" do anterior e some.
          if (change.areas.includes('peers')) draggingPeers();
          if (change.areas.includes('peers') || change.areas.includes('viewport')) refreshPeers();
        })
      : () => {};

  const observer =
    win && typeof win.ResizeObserver === 'function'
      ? new win.ResizeObserver(() => {
          if (!isDisposed) {
            const previousWidth = logicalWidth;
            const previousHeight = logicalHeight;
            const previousDpr = dpr;
            updateDimensions();
            if (
              logicalWidth !== previousWidth ||
              logicalHeight !== previousHeight ||
              dpr !== previousDpr
            ) {
              if (logicalWidth > 0 && logicalHeight > 0) {
                render();
              }
            }
          }
        })
      : null;

  if (observer) {
    observer.observe(options.container);
  }

  // Monitora alterações de DPR via matchMedia (ex: zoom do navegador ou troca de monitor)
  const setupDprWatcher = (): (() => void) => {
    if (!win || typeof win.matchMedia !== 'function') {
      return () => {};
    }

    let mql: MediaQueryList | null = null;

    const handleDprChange = (): void => {
      if (isDisposed) return;
      const previousDpr = dpr;
      dpr = getDpr();
      if (dpr !== previousDpr) {
        updateDimensions();
        if (logicalWidth > 0 && logicalHeight > 0) {
          render();
        }
      }
      cleanup();
      attach();
    };

    const attach = (): void => {
      try {
        const currentDpr = getDpr();
        mql = win.matchMedia(`(resolution: ${currentDpr}dppx)`);
        if (typeof mql.addEventListener === 'function') {
          mql.addEventListener('change', handleDprChange);
        } else if (
          typeof (mql as unknown as { addListener?: (cb: () => void) => void }).addListener ===
          'function'
        ) {
          (mql as unknown as { addListener: (cb: () => void) => void }).addListener(
            handleDprChange,
          );
        }
      } catch {
        // Fallback defensivo caso o ambiente não suporte queries de resolution
      }
    };

    const cleanup = (): void => {
      if (!mql) return;
      try {
        if (typeof mql.removeEventListener === 'function') {
          mql.removeEventListener('change', handleDprChange);
        } else if (
          typeof (mql as unknown as { removeListener?: (cb: () => void) => void })
            .removeListener === 'function'
        ) {
          (mql as unknown as { removeListener: (cb: () => void) => void }).removeListener(
            handleDprChange,
          );
        }
      } catch {
        // Fallback defensivo
      }
      mql = null;
    };

    attach();
    return cleanup;
  };

  const removeDprWatcher = setupDprWatcher();

  const handle: RendererHandle = {
    invalidate: () => {
      if (isDisposed) return;
      scheduler.invalidate();
    },
    resize: () => {
      if (isDisposed) return;
      updateDimensions();
      if (logicalWidth > 0 && logicalHeight > 0) {
        render();
      }
    },
    getMetrics: () => ({
      dpr,
      width: logicalWidth,
      height: logicalHeight,
      renderedItemsCount,
      paintCount,
      lastPaintDurationMs,
      labelLayoutCount: shapeLabelLayoutCount(),
    }),
    setGuides: (guides) => {
      if (isDisposed) return;
      activeGuides = guides ? [...guides] : [];
      scheduler.invalidate();
    },
    getGuides: () => activeGuides,
    setDropTarget: (boardId) => {
      if (isDisposed) return;
      if (dropTargetId === boardId) return;
      dropTargetId = boardId;
      scheduler.invalidate();
    },
    getDropTarget: () => dropTargetId,
    setEraserCursor: (cursor) => {
      if (isDisposed) return;
      const same =
        cursor === eraserCursor ||
        (cursor !== null &&
          eraserCursor !== null &&
          cursor.x === eraserCursor.x &&
          cursor.y === eraserCursor.y &&
          cursor.radius === eraserCursor.radius);
      if (same) return;
      eraserCursor = cursor ? { ...cursor } : null;
      scheduler.invalidate();
    },
    getEraserCursor: () => eraserCursor,
    setGridPointer: (point) => {
      if (isDisposed) return;
      if (
        point === gridPointer ||
        (point && gridPointer && point.x === gridPointer.x && point.y === gridPointer.y)
      ) {
        return;
      }
      gridPointer = point ? { x: point.x, y: point.y } : null;
      if (isGridHighlightVisible()) scheduler.invalidate();
    },
    getGridPointer: () => gridPointer,
    destroy: () => {
      if (isDisposed) return;
      isDisposed = true;
      activeGuides = [];
      eraserCursor = null;
      gridPointer = null;
      scheduler.destroy();
      unsubscribe();
      peersLayer.destroy();
      ghostCache.clear();
      if (observer) {
        observer.disconnect();
      }
      removeDprWatcher();
      canvas.remove();
    },
  };

  return { ok: true, value: handle };
}
