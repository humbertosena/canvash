import {
  zoomAt,
  type CanvasSectionApi,
  type Point,
  type Viewport,
  type ZoomLimits,
} from '@canvash/core';

export interface NormalizedWheelDelta {
  readonly dx: number;
  readonly dy: number;
}

export interface MinimalWheelEvent {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly clientX: number;
  readonly clientY: number;
  preventDefault?: () => void;
}

const LINE_HEIGHT_FALLBACK = 16;
const PAGE_HEIGHT_FALLBACK = 800;
const ZOOM_SENSITIVITY = 0.005;

/**
 * Normaliza os valores de deltaX e deltaY considerando deltaMode:
 * 0: Pixels (trackpad, mouse de alta precisão)
 * 1: Linhas (wheel padrão de mouse, ~16px por linha)
 * 2: Páginas (raro, ~800px por página)
 */
export function normalizeWheelDelta(
  event: Pick<MinimalWheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>,
  lineHeight = LINE_HEIGHT_FALLBACK,
  pageHeight = PAGE_HEIGHT_FALLBACK,
): NormalizedWheelDelta {
  let scale = 1;
  if (event.deltaMode === 1) {
    scale = lineHeight;
  } else if (event.deltaMode === 2) {
    scale = pageHeight;
  }

  return {
    dx: event.deltaX * scale,
    dy: event.deltaY * scale,
  };
}

export interface WheelAdapterOptions {
  element: HTMLElement;
  section: CanvasSectionApi;
  zoomLimits?: ZoomLimits;
}

export class WheelAdapter {
  private readonly element: HTMLElement;
  private readonly section: CanvasSectionApi;
  private readonly zoomLimits?: ZoomLimits;
  private destroyed = false;

  constructor(options: WheelAdapterOptions) {
    this.element = options.element;
    this.section = options.section;
    this.zoomLimits = options.zoomLimits;

    this.element.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (this.destroyed) return;

    // Intercepta e previne apenas eventos disparados sobre a superfície
    event.preventDefault();

    const normalized = normalizeWheelDelta(event);
    const rect = this.element.getBoundingClientRect();
    const anchor: Point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    const currentViewport = this.section.getSnapshot().session.viewport;

    if (event.ctrlKey || event.metaKey) {
      // Zoom ancorado no ponteiro
      // Math.exp garante proporção suave sem saltos em zoom in ou zoom out
      const factor = Math.exp(-normalized.dy * ZOOM_SENSITIVITY);
      const nextZoom = currentViewport.zoom * factor;
      const nextViewport = zoomAt(currentViewport, anchor, nextZoom, this.zoomLimits);
      this.section.setViewport(nextViewport);
    } else {
      // Pan comum por wheel
      const nextViewport: Viewport = {
        x: currentViewport.x - normalized.dx,
        y: currentViewport.y - normalized.dy,
        zoom: currentViewport.zoom,
      };
      this.section.setViewport(nextViewport);
    }
  };

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.element.removeEventListener('wheel', this.onWheel);
  }
}
