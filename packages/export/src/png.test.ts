import { createCanvasSection } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportPng } from './png.js';

describe('exportPng (IO-05, IO-07)', () => {
  it('rejeita imediatamente dimensões que excedem o limite de pixels sem alocar (IO-07)', async () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 's1',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 5000,
        height: 5000,
        rotation: 0,
      },
    });

    // 5000 * 5000 = 25.000.000 pixels > 16.000.000 padrão
    const result = await exportPng(section);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('LIMIT_EXCEEDED');
    expect(result.error.message).toContain('exceed maximum limit');
  });

  it('respeita maxPixels customizado', async () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 's1',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
      },
    });

    const result = await exportPng(section, { maxPixels: 500 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LIMIT_EXCEEDED');
  });

  it('reporta UNSUPPORTED_ENVIRONMENT em runtime Node sem canvas', async () => {
    const origOffscreen = (globalThis as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas;
    const origDoc = (globalThis as unknown as { document?: unknown }).document;

    // Remove OffscreenCanvas e document para simular Node puro
    delete (globalThis as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas;
    delete (globalThis as unknown as { document?: unknown }).document;

    try {
      const section = createCanvasSection();
      const result = await exportPng(section);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('UNSUPPORTED_ENVIRONMENT');
    } finally {
      (globalThis as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas = origOffscreen;
      (globalThis as unknown as { document?: unknown }).document = origDoc;
    }
  });

  describe('com mock de OffscreenCanvas', () => {
    let origOffscreen: unknown;
    let lastContext: Record<string, unknown> | undefined;

    beforeEach(() => {
      origOffscreen = (globalThis as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas;

      class FakeOffscreenCanvas {
        width: number;
        height: number;
        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
        }
        getContext() {
          return (lastContext = {
            save: vi.fn(),
            restore: vi.fn(),
            scale: vi.fn(),
            translate: vi.fn(),
            rotate: vi.fn(),
            rect: vi.fn(),
            clip: vi.fn(),
            fillRect: vi.fn(),
            strokeRect: vi.fn(),
            beginPath: vi.fn(),
            arc: vi.fn(),
            ellipse: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            closePath: vi.fn(),
            fill: vi.fn(),
            stroke: vi.fn(),
            fillText: vi.fn(),
            strokeText: vi.fn(),
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 1,
            globalAlpha: 1,
            bezierCurveTo: vi.fn(),
          });
        }
        async convertToBlob() {
          return new Blob(['fake-png-bytes'], { type: 'image/png' });
        }
      }

      (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = FakeOffscreenCanvas;
    });

    afterEach(() => {
      (globalThis as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas = origOffscreen;
    });

    it('renderiza e exporta Blob PNG com sucesso em ambiente compatível', async () => {
      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 's1',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
        },
      });

      const result = await exportPng(section, { background: '#ffffff', scale: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeInstanceOf(Blob);
      expect(result.value.type).toBe('image/png');
    });

    it('renderiza e exporta Blob PNG de um SquareNode com sucesso', async () => {
      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'sq1',
          type: 'square',
          x: 10,
          y: 10,
          width: 80,
          height: 80,
          rotation: 0,
        },
      });

      const result = await exportPng(section, { background: '#ffffff', scale: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeInstanceOf(Blob);
      expect(result.value.type).toBe('image/png');
    });

    it('pinta o texto da forma no PNG, recortado na área e com a opacidade da forma (US-SL.12)', async () => {
      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'lb',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          style: { fill: '#ffffff', stroke: null, strokeWidth: 0, opacity: 0.5 },
          label: { text: 'Olá' },
        },
      });

      const result = await exportPng(section, { scale: 2 });

      expect(result.ok).toBe(true);
      expect(lastContext?.fillText).toHaveBeenCalledWith(
        'Olá',
        expect.any(Number),
        expect.any(Number),
      );
      expect(lastContext?.clip).toHaveBeenCalled();
      expect(lastContext?.rect).toHaveBeenCalledWith(-92, -42, 184, 84);
      expect(lastContext?.globalAlpha).toBe(0.5);
    });

    it('renderiza a curva Bézier com bezierCurveTo no PNG (Tarefa 111)', async () => {
      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'bz1',
          type: 'bezier',
          start: { x: 0, y: 0 },
          control1: { x: 0, y: -40 },
          control2: { x: 100, y: -40 },
          end: { x: 100, y: 0 },
          style: { strokeWidth: 2 },
        },
      });

      const result = await exportPng(section, { scale: 2 });
      expect(result.ok).toBe(true);
      expect(lastContext?.bezierCurveTo).toHaveBeenCalledWith(0, -40, 100, -40, 100, 0);
    });

    it('renderiza e exporta Blob PNG de um CircleNode com sucesso', async () => {
      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'c1',
          type: 'circle',
          x: 10,
          y: 10,
          width: 80,
          height: 80,
          rotation: 0,
        },
      });

      const result = await exportPng(section, { background: '#ffffff', scale: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeInstanceOf(Blob);
      expect(result.value.type).toBe('image/png');
    });

    it('aguarda document.fonts.ready quando presente', async () => {
      const origDoc = (globalThis as unknown as { document?: unknown }).document;
      let fontWaitCalled = false;

      (globalThis as unknown as { document: unknown }).document = {
        fonts: {
          ready: new Promise((resolve) => {
            fontWaitCalled = true;
            resolve(undefined);
          }),
        },
      };

      try {
        const section = createCanvasSection();
        const result = await exportPng(section, { fontTimeoutMs: 50 });
        expect(result.ok).toBe(true);
        expect(fontWaitCalled).toBe(true);
      } finally {
        (globalThis as unknown as { document?: unknown }).document = origDoc;
      }
    });
  });

  describe('com fallback para HTMLCanvasElement (DOM)', () => {
    let origDoc: unknown;
    let origOffscreen: unknown;

    beforeEach(() => {
      origOffscreen = (globalThis as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas;
      origDoc = (globalThis as unknown as { document?: unknown }).document;

      delete (globalThis as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas;

      (globalThis as unknown as { document: unknown }).document = {
        createElement: (tag: string) => {
          if (tag !== 'canvas') return null;
          return {
            width: 0,
            height: 0,
            getContext: () => ({
              save: vi.fn(),
              restore: vi.fn(),
              scale: vi.fn(),
              translate: vi.fn(),
              fillRect: vi.fn(),
              strokeRect: vi.fn(),
              fillStyle: '',
              strokeStyle: '',
              lineWidth: 1,
              globalAlpha: 1,
            }),
            toBlob: (cb: (b: Blob | null) => void) => {
              cb(new Blob(['dom-png'], { type: 'image/png' }));
            },
          };
        },
      };
    });

    afterEach(() => {
      (globalThis as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas = origOffscreen;
      (globalThis as unknown as { document?: unknown }).document = origDoc;
    });

    it('renderiza e gera Blob via toBlob do HTMLCanvasElement', async () => {
      const section = createCanvasSection();
      const result = await exportPng(section);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeInstanceOf(Blob);
    });
  });
});
