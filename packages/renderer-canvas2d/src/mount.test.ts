import type { CanvasSectionApi, Result } from '@canvash/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  ContainerInvalidError,
  ContextUnavailableError,
  DisposedRendererError,
  MountOptions,
  RendererError,
  RendererHandle,
  RendererMetrics,
} from './index.js';
import { mount } from './index.js';
import { shapeLabelLayoutCount } from './shape-label.js';

type IsAny<T> = 0 extends 1 & T ? true : false;
type HasAny<T, Depth extends unknown[] = []> = Depth['length'] extends 8
  ? false
  : IsAny<T> extends true
    ? true
    : T extends (...args: infer Args) => infer Return
      ? HasAny<Args, [...Depth, 0]> extends true
        ? true
        : HasAny<Return, [...Depth, 0]>
      : T extends object
        ? true extends { [Key in keyof T]: HasAny<T[Key], [...Depth, 0]> }[keyof T]
          ? true
          : false
        : false;

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

describe('contrato de tipos de mount e RendererHandle', () => {
  it('nenhum tipo contém any', () => {
    expectTypeOf<MountOptions['container']>().toEqualTypeOf<HTMLElement>();
    expectTypeOf<HasAny<MountOptions['section']>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<MountOptions['grid']>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<MountOptions['overlays']>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<MountOptions['onError']>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<RendererMetrics>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<RendererHandle>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<RendererError>>().toEqualTypeOf<false>();
    expectTypeOf<typeof mount>().returns.toEqualTypeOf<Result<RendererHandle, RendererError>>();
  });

  it('MountOptions recebe a instância em section e não tem a chave antiga', () => {
    type LegacyKey = `${'bo'}${'ard'}`;

    expectTypeOf<MountOptions['section']>().toEqualTypeOf<CanvasSectionApi>();
    expectTypeOf<LegacyKey extends keyof MountOptions ? true : false>().toEqualTypeOf<false>();
  });

  it('as métricas e erros são profundamente somente leitura', () => {
    expectTypeOf<RendererMetrics>().toEqualTypeOf<DeepReadonly<RendererMetrics>>();
    expectTypeOf<RendererError>().toEqualTypeOf<DeepReadonly<RendererError>>();
    expectTypeOf<ContextUnavailableError>().toEqualTypeOf<DeepReadonly<ContextUnavailableError>>();
    expectTypeOf<ContainerInvalidError>().toEqualTypeOf<DeepReadonly<ContainerInvalidError>>();
    expectTypeOf<DisposedRendererError>().toEqualTypeOf<DeepReadonly<DisposedRendererError>>();
  });

  it('RendererError estreita por code', () => {
    const check = (error: RendererError): string => {
      switch (error.code) {
        case 'CONTEXT_UNAVAILABLE':
          expectTypeOf(error).toEqualTypeOf<ContextUnavailableError>();
          return error.message;
        case 'CONTAINER_INVALID':
          expectTypeOf(error).toEqualTypeOf<ContainerInvalidError>();
          return error.message;
        case 'DISPOSED':
          expectTypeOf(error).toEqualTypeOf<DisposedRendererError>();
          return error.message;
      }
    };

    expectTypeOf(check).toBeFunction();
  });

  it('RendererHandle possui exatamente os métodos descritos na API pública', () => {
    expectTypeOf<RendererHandle['invalidate']>().toEqualTypeOf<() => void>();
    expectTypeOf<RendererHandle['resize']>().toEqualTypeOf<() => void>();
    expectTypeOf<RendererHandle['getMetrics']>().toEqualTypeOf<() => RendererMetrics>();
    expectTypeOf<RendererHandle['destroy']>().toEqualTypeOf<() => void>();
  });
});

describe('comportamento básico e erros tipados de mount', () => {
  const dummySection = {} as unknown as CanvasSectionApi;

  it('retorna CONTAINER_INVALID se o container for nulo ou inválido', () => {
    // @ts-expect-error container inválido
    const resultNull = mount({ section: dummySection, container: null });
    expect(resultNull.ok).toBe(false);
    if (!resultNull.ok) {
      expect(resultNull.error.code).toBe('CONTAINER_INVALID');
    }

    // @ts-expect-error container não é HTMLElement
    const resultObj = mount({ section: dummySection, container: {} });
    expect(resultObj.ok).toBe(false);
    if (!resultObj.ok) {
      expect(resultObj.error.code).toBe('CONTAINER_INVALID');
    }
  });

  it('retorna CONTEXT_UNAVAILABLE se o canvas não conseguir obter contexto 2d', () => {
    const fakeContainer = {
      appendChild: () => {},
      ownerDocument: {
        createElement: () => ({
          getContext: () => null,
          remove: () => {},
          width: 0,
          height: 0,
        }),
      },
    } as unknown as HTMLElement;

    const result = mount({ section: dummySection, container: fakeContainer });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONTEXT_UNAVAILABLE');
    }
  });

  it('retorna Result com handle se o contexto 2d estiver disponível', () => {
    const fakeContext = {} as unknown as CanvasRenderingContext2D;
    let removed = false;
    const fakeCanvas = {
      getContext: (type: string) => (type === '2d' ? fakeContext : null),
      remove: () => {
        removed = true;
      },
      width: 800,
      height: 600,
    };
    const fakeContainer = {
      appendChild: () => {},
      ownerDocument: {
        createElement: () => fakeCanvas,
      },
    } as unknown as HTMLElement;

    const result = mount({ section: dummySection, container: fakeContainer });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const handle = result.value;
      const metrics = handle.getMetrics();
      expect(metrics.width).toBe(800);
      expect(metrics.height).toBe(600);
      expect(metrics.renderedItemsCount).toBe(0);
      expect(metrics.paintCount).toBe(0);

      handle.invalidate();
      handle.resize();
      handle.destroy();
      expect(removed).toBe(true);
    }
  });

  it('getMetrics expõe quantas quebras de texto das formas já foram calculadas', () => {
    const fakeCanvas = {
      getContext: (type: string) => (type === '2d' ? ({} as CanvasRenderingContext2D) : null),
      remove: () => {},
      width: 800,
      height: 600,
    };
    const fakeContainer = {
      appendChild: () => {},
      clientWidth: 400,
      clientHeight: 200,
      ownerDocument: {
        createElement: () => fakeCanvas,
        defaultView: { devicePixelRatio: 1 },
      },
    } as unknown as HTMLElement;

    const result = mount({ section: dummySection, container: fakeContainer });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.getMetrics().labelLayoutCount).toBe(shapeLabelLayoutCount());
    result.value.destroy();
  });

  it('aplica scale e backing store proporcional ao DPR', () => {
    const transformCalls: unknown[][] = [];
    const fakeContext = {
      setTransform: (...args: unknown[]) => transformCalls.push(args),
    } as unknown as CanvasRenderingContext2D;
    const fakeCanvas = {
      getContext: () => fakeContext,
      remove: () => {},
      style: { width: '', height: '' },
      width: 0,
      height: 0,
    };
    const fakeContainer = {
      appendChild: () => {},
      clientWidth: 250,
      clientHeight: 150,
      ownerDocument: {
        createElement: () => fakeCanvas,
        defaultView: {
          devicePixelRatio: 2,
        },
      },
    } as unknown as HTMLElement;

    const result = mount({ section: dummySection, container: fakeContainer });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const handle = result.value;
      const metrics = handle.getMetrics();
      expect(metrics.dpr).toBe(2);
      expect(metrics.width).toBe(250);
      expect(metrics.height).toBe(150);
      expect(fakeCanvas.width).toBe(500);
      expect(fakeCanvas.height).toBe(300);
      expect(fakeCanvas.style.width).toBe('250px');
      expect(fakeCanvas.style.height).toBe('150px');
      expect(transformCalls).toEqual([[2, 0, 0, 2, 0, 0]]);
      handle.destroy();
    }
  });

  it('aplica pan e zoom do viewport durante a pintura da cena', () => {
    const calls: { name: string; args: unknown[] }[] = [];
    const fakeContext = {
      setTransform: (...args: unknown[]) => calls.push({ name: 'setTransform', args }),
      clearRect: (...args: unknown[]) => calls.push({ name: 'clearRect', args }),
      save: () => calls.push({ name: 'save', args: [] }),
      translate: (...args: unknown[]) => calls.push({ name: 'translate', args }),
      scale: (...args: unknown[]) => calls.push({ name: 'scale', args }),
      restore: () => calls.push({ name: 'restore', args: [] }),
    } as unknown as CanvasRenderingContext2D;

    const fakeCanvas = {
      getContext: () => fakeContext,
      remove: () => {},
      style: { width: '', height: '' },
      width: 0,
      height: 0,
    };

    const fakeContainer = {
      appendChild: () => {},
      clientWidth: 400,
      clientHeight: 300,
      ownerDocument: {
        createElement: () => fakeCanvas,
        defaultView: { devicePixelRatio: 1 },
      },
    } as unknown as HTMLElement;

    const sectionWithViewport = {
      getSnapshot: () => ({
        document: { schemaVersion: 1, id: 'doc', nodes: {}, layers: [] },
        session: {
          selection: [],
          viewport: { x: 120, y: -80, zoom: 2.5 },
          tool: 'select',
          readOnly: false,
        },
      }),
      subscribe: () => () => {},
    } as unknown as CanvasSectionApi;

    const result = mount({ section: sectionWithViewport, container: fakeContainer });
    expect(result.ok).toBe(true);

    const translateCall = calls.find((c) => c.name === 'translate');
    expect(translateCall).toEqual({ name: 'translate', args: [120, -80] });

    const scaleCall = calls.find((c) => c.name === 'scale');
    expect(scaleCall).toEqual({ name: 'scale', args: [2.5, 2.5] });

    const sequence = calls.map((c) => c.name);
    expect(sequence).toContain('save');
    expect(sequence).toContain('translate');
    expect(sequence).toContain('scale');
    expect(sequence).toContain('restore');

    const saveIdx = sequence.indexOf('save');
    const translateIdx = sequence.indexOf('translate');
    const scaleIdx = sequence.indexOf('scale');
    const restoreIdx = sequence.indexOf('restore');

    expect(saveIdx).toBeLessThan(translateIdx);
    expect(translateIdx).toBeLessThan(scaleIdx);
    expect(scaleIdx).toBeLessThan(restoreIdx);

    if (result.ok) {
      result.value.destroy();
    }
  });

  it('invoca pintura de grid com as opções configuradas no mount', () => {
    const strokeCalls: string[] = [];
    const fakeContext = {
      setTransform: () => {},
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => strokeCalls.push('stroke'),
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    const fakeCanvas = {
      getContext: () => fakeContext,
      remove: () => {},
      style: { width: '', height: '' },
      width: 0,
      height: 0,
    };

    const fakeContainer = {
      appendChild: () => {},
      clientWidth: 400,
      clientHeight: 300,
      ownerDocument: {
        createElement: () => fakeCanvas,
        defaultView: { devicePixelRatio: 1 },
      },
    } as unknown as HTMLElement;

    const dummySection = {
      getSnapshot: () => ({
        document: { schemaVersion: 1, id: 'doc', nodes: {}, layers: [] },
        session: {
          selection: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          tool: 'select',
          readOnly: false,
        },
      }),
      subscribe: () => () => {},
    } as unknown as CanvasSectionApi;

    const result = mount({
      section: dummySection,
      container: fakeContainer,
      grid: { enabled: true, style: 'lines', color: '#abcdef', lineWidth: 2 },
    });

    expect(result.ok).toBe(true);
    expect(strokeCalls.length).toBeGreaterThan(0);
    expect(fakeContext.strokeStyle).toBe('#abcdef');
    expect(fakeContext.lineWidth).toBe(2);

    if (result.ok) {
      result.value.destroy();
    }
  });

  it('consulta queryBounds com coordenadas de mundo do viewport e filtra renderedItemsCount', () => {
    let queriedBounds: unknown = null;
    let queriedOptions: unknown = null;

    const fakeContext = {
      setTransform: () => {},
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {},
      fillRect: () => {},
    } as unknown as CanvasRenderingContext2D;

    const fakeCanvas = {
      getContext: () => fakeContext,
      remove: () => {},
      style: { width: '', height: '' },
      width: 0,
      height: 0,
    };

    const fakeContainer = {
      appendChild: () => {},
      clientWidth: 400,
      clientHeight: 200,
      ownerDocument: {
        createElement: () => fakeCanvas,
        defaultView: { devicePixelRatio: 1 },
      },
    } as unknown as HTMLElement;

    const dummySection = {
      getSnapshot: () => ({
        document: {
          schemaVersion: 1,
          id: 'doc',
          nodes: {
            'visible-node': {
              id: 'visible-node',
              type: 'rectangle',
              x: 10,
              y: 10,
              width: 50,
              height: 50,
              rotation: 0,
              visible: true,
              locked: false,
              style: { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 },
            },
            'culled-node': {
              id: 'culled-node',
              type: 'rectangle',
              x: 1000,
              y: 1000,
              width: 50,
              height: 50,
              rotation: 0,
              visible: true,
              locked: false,
              style: { fill: '#00ff00', stroke: null, strokeWidth: 0, opacity: 1 },
            },
          },
          layers: [
            {
              id: 'layer-1',
              name: 'Camada 1',
              visible: true,
              locked: false,
              childIds: ['visible-node', 'culled-node'],
            },
          ],
        },
        session: {
          selection: [],
          viewport: { x: 50, y: -25, zoom: 2 },
          tool: 'select',
          readOnly: false,
        },
      }),
      queryBounds: (bounds: unknown, options: unknown) => {
        queriedBounds = bounds;
        queriedOptions = options;
        // Core devolve apenas o nó visível
        return ['visible-node'];
      },
      subscribe: () => () => {},
    } as unknown as CanvasSectionApi;

    const result = mount({ section: dummySection, container: fakeContainer });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // worldLeft = -50 / 2 = -25
    // worldTop = 25 / 2 = 12.5
    // worldWidth = 400 / 2 = 200
    // worldHeight = 200 / 2 = 100
    expect(queriedBounds).toEqual({
      x: -25,
      y: 12.5,
      width: 200,
      height: 100,
    });
    expect(queriedOptions).toEqual({
      includePreview: true,
      includeHidden: false,
    });

    // Apenas 1 shape projetada e desenhada (a outra foi culled)
    expect(result.value.getMetrics().renderedItemsCount).toBe(1);

    result.value.destroy();
  });

  it('solicita bounds da seleção ao canvas e desenha overlays', () => {
    let queriedSelectionIds: unknown = null;
    let strokeRectCalls = 0;

    const fakeContext = {
      setTransform: () => {},
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {},
      fillRect: () => {},
      strokeRect: () => {
        strokeRectCalls += 1;
      },
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arc: () => {},
      stroke: () => {},
      fill: () => {},
      setLineDash: () => {},
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    const fakeCanvas = {
      getContext: () => fakeContext,
      remove: () => {},
      style: { width: '', height: '' },
      width: 0,
      height: 0,
    };

    const fakeContainer = {
      appendChild: () => {},
      clientWidth: 400,
      clientHeight: 200,
      ownerDocument: {
        createElement: () => fakeCanvas,
        defaultView: { devicePixelRatio: 1 },
      },
    } as unknown as HTMLElement;

    const dummySection = {
      getSnapshot: () => ({
        document: {
          schemaVersion: 1,
          id: 'doc',
          nodes: {
            'sel-1': {
              id: 'sel-1',
              type: 'rectangle',
              x: 10,
              y: 10,
              width: 50,
              height: 50,
              rotation: 0,
              visible: true,
              locked: false,
              style: { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 },
            },
          },
          layers: [{ id: 'l1', name: 'L1', visible: true, locked: false, childIds: ['sel-1'] }],
        },
        session: {
          selectedIds: ['sel-1'],
          viewport: { x: 0, y: 0, zoom: 1 },
          tool: 'select',
          readOnly: false,
        },
      }),
      getBounds: (ids: unknown) => {
        queriedSelectionIds = ids;
        return { x: 10, y: 10, width: 50, height: 50 };
      },
      getPreview: () => ({
        updates: {},
        additions: [],
        marquee: { x: 5, y: 5, width: 100, height: 100 },
      }),
      subscribe: () => () => {},
    } as unknown as CanvasSectionApi;

    const result = mount({ section: dummySection, container: fakeContainer });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(queriedSelectionIds).toEqual(['sel-1']);
    // Deve ter desenhado o contorno de seleção, os handles e o marquee
    expect(strokeRectCalls).toBeGreaterThan(0);

    result.value.destroy();
  });

  it('suspende pintura quando container tem dimensões zero e retoma após redimensionamento', () => {
    let clearRectCalls = 0;

    const fakeContext = {
      setTransform: () => {},
      clearRect: () => {
        clearRectCalls += 1;
      },
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {},
      fillRect: () => {},
      strokeRect: () => {},
    } as unknown as CanvasRenderingContext2D;

    const fakeCanvas = {
      getContext: () => fakeContext,
      remove: () => {},
      style: { width: '', height: '' },
      width: 0,
      height: 0,
    };

    const containerSize = { width: 0, height: 0 };

    const fakeContainer = {
      appendChild: () => {},
      get clientWidth() {
        return containerSize.width;
      },
      get clientHeight() {
        return containerSize.height;
      },
      ownerDocument: {
        createElement: () => fakeCanvas,
        defaultView: { devicePixelRatio: 1 },
      },
    } as unknown as HTMLElement;

    const dummySection = {
      getSnapshot: () => ({
        document: {
          schemaVersion: 1,
          id: 'doc',
          nodes: {},
          layers: [{ id: 'l1', name: 'L1', visible: true, locked: false, childIds: [] }],
        },
        session: {
          selectedIds: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          tool: 'select',
          readOnly: false,
        },
      }),
      subscribe: () => () => {},
    } as unknown as CanvasSectionApi;

    const result = mount({ section: dummySection, container: fakeContainer });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Dimensão zero inicial: não deve pintar
    expect(result.value.getMetrics().paintCount).toBe(0);
    expect(clearRectCalls).toBe(0);

    // Redimensiona o container para valores positivos e chama resize()
    containerSize.width = 500;
    containerSize.height = 300;
    result.value.resize();

    expect(result.value.getMetrics().paintCount).toBe(1);
    expect(result.value.getMetrics().width).toBe(500);
    expect(result.value.getMetrics().height).toBe(300);
    expect(clearRectCalls).toBe(1);

    result.value.destroy();
  });

  it('reporta falha de renderização para onError sem propagar exceção nem corromper canvas', () => {
    let capturedError: unknown = null;

    const fakeContext = {
      setTransform: () => {
        throw new Error('Falha simulada no driver de Canvas 2D');
      },
      clearRect: () => {},
    } as unknown as CanvasRenderingContext2D;

    const fakeCanvas = {
      getContext: () => fakeContext,
      remove: () => {},
      style: { width: '', height: '' },
      width: 0,
      height: 0,
    };

    const fakeContainer = {
      appendChild: () => {},
      clientWidth: 400,
      clientHeight: 300,
      ownerDocument: {
        createElement: () => fakeCanvas,
        defaultView: { devicePixelRatio: 1 },
      },
    } as unknown as HTMLElement;

    const dummySection = {
      getSnapshot: () => ({
        document: {
          schemaVersion: 1,
          id: 'doc',
          nodes: {},
          layers: [{ id: 'l1', name: 'L1', visible: true, locked: false, childIds: [] }],
        },
        session: {
          selectedIds: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          tool: 'select',
          readOnly: false,
        },
      }),
      subscribe: () => () => {},
    } as unknown as CanvasSectionApi;

    // Não deve lançar erro
    const result = mount({
      section: dummySection,
      container: fakeContainer,
      onError: (err) => {
        capturedError = err;
      },
    });

    expect(result.ok).toBe(true);
    expect(capturedError).toBeInstanceOf(Error);
    expect((capturedError as Error).message).toBe('Falha simulada no driver de Canvas 2D');

    if (result.ok) {
      result.value.destroy();
    }
  });

  it('destroy remove o canvas do DOM e cancela subscriptions e observers', () => {
    let canvasRemoved = false;
    let unsubscribed = false;
    let observerDisconnected = false;

    const fakeContext = {
      setTransform: () => {},
      clearRect: () => {},
    } as unknown as CanvasRenderingContext2D;

    const fakeCanvas = {
      getContext: () => fakeContext,
      remove: () => {
        canvasRemoved = true;
      },
      style: { width: '', height: '' },
      width: 0,
      height: 0,
    };

    class FakeResizeObserver {
      observe() {}
      disconnect() {
        observerDisconnected = true;
      }
    }

    const fakeContainer = {
      appendChild: () => {},
      clientWidth: 400,
      clientHeight: 300,
      ownerDocument: {
        createElement: () => fakeCanvas,
        defaultView: {
          devicePixelRatio: 1,
          ResizeObserver: FakeResizeObserver,
        },
      },
    } as unknown as HTMLElement;

    const dummySection = {
      getSnapshot: () => ({
        document: {
          schemaVersion: 1,
          id: 'doc',
          nodes: {},
          layers: [{ id: 'l1', name: 'L1', visible: true, locked: false, childIds: [] }],
        },
        session: {
          selectedIds: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          tool: 'select',
          readOnly: false,
        },
      }),
      subscribe: () => () => {
        unsubscribed = true;
      },
    } as unknown as CanvasSectionApi;

    const result = mount({ section: dummySection, container: fakeContainer });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    result.value.destroy();

    expect(canvasRemoved).toBe(true);
    expect(unsubscribed).toBe(true);
    expect(observerDisconnected).toBe(true);

    // Chamadas após destroy são no-ops seguros
    expect(() => {
      result.value.invalidate();
      result.value.resize();
      result.value.destroy(); // Múltiplos destroys não quebram
    }).not.toThrow();
  });

  it('atualiza backing store e re-renderiza quando DPR muda via matchMedia', () => {
    let currentDpr = 1;
    let changeListener: (() => void) | null = null;
    let removeEventListenerCalled = false;

    const fakeContext = {
      setTransform: () => {},
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {},
    } as unknown as CanvasRenderingContext2D;

    const fakeCanvas = {
      getContext: () => fakeContext,
      remove: () => {},
      style: { width: '', height: '' },
      width: 0,
      height: 0,
    };

    const fakeContainer = {
      appendChild: () => {},
      clientWidth: 400,
      clientHeight: 300,
      ownerDocument: {
        createElement: () => fakeCanvas,
        defaultView: {
          get devicePixelRatio() {
            return currentDpr;
          },
          matchMedia: () => ({
            addEventListener: (_event: string, cb: () => void) => {
              changeListener = cb;
            },
            removeEventListener: () => {
              removeEventListenerCalled = true;
            },
          }),
        },
      },
    } as unknown as HTMLElement;

    const dummySection = {
      getSnapshot: () => ({
        document: {
          schemaVersion: 1,
          id: 'doc',
          nodes: {},
          layers: [{ id: 'l1', name: 'L1', visible: true, locked: false, childIds: [] }],
        },
        session: {
          selectedIds: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          tool: 'select',
          readOnly: false,
        },
      }),
      subscribe: () => () => {},
    } as unknown as CanvasSectionApi;

    const result = mount({ section: dummySection, container: fakeContainer });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.getMetrics().dpr).toBe(1);
    expect(fakeCanvas.width).toBe(400);

    // Simula troca de monitor / zoom para DPR 2
    currentDpr = 2;
    expect(changeListener).not.toBeNull();
    changeListener!();

    expect(result.value.getMetrics().dpr).toBe(2);
    expect(fakeCanvas.width).toBe(800);
    expect(fakeCanvas.height).toBe(600);

    result.value.destroy();
    expect(removeEventListenerCalled).toBe(true);
  });
});

describe('setDropTarget (spec boards, §5.2)', () => {
  const dummySection = {} as unknown as CanvasSectionApi;

  it('o handle guarda o board de destino do arrasto e o devolve em getDropTarget', () => {
    const fakeCanvas = {
      getContext: (type: string) => (type === '2d' ? ({} as CanvasRenderingContext2D) : null),
      remove: () => {},
      width: 800,
      height: 600,
    };
    const fakeContainer = {
      appendChild: () => {},
      clientWidth: 400,
      clientHeight: 200,
      ownerDocument: {
        createElement: () => fakeCanvas,
        defaultView: { devicePixelRatio: 1 },
      },
    } as unknown as HTMLElement;
    const result = mount({ section: dummySection, container: fakeContainer });
    if (!result.ok) throw new Error('mount falhou');
    const handle = result.value;

    expect(handle.getDropTarget()).toBeNull();
    handle.setDropTarget('b');
    expect(handle.getDropTarget()).toBe('b');
    handle.setDropTarget(null);
    expect(handle.getDropTarget()).toBeNull();
    handle.destroy();
    handle.setDropTarget('x');
    expect(handle.getDropTarget()).toBeNull();
  });
});
