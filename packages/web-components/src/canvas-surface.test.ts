import { createCanvasSection, type CanvasChange } from '@canvash/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CanvasSurfaceElement } from './canvas-surface.js';

interface TestableCanvasSurface {
  _container: HTMLElement | null;
  _mounted: boolean;
  _isInternal: boolean;
  _internalSection: unknown;
  _rendererHandle: { destroy: () => void } | undefined;
  _mount(): void;
  _unmount(): void;
  _remountRenderer(): void;
  _handleSectionChange(event: CanvasChange): void;
  firstUpdated(): void;
  updated(changedProperties: Map<string, unknown>): void;
}

function createMockContainer(failContext = false) {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const fakeContext = {
    save: () => {},
    restore: () => {},
    scale: () => {},
    translate: () => {},
    clearRect: () => {},
    fillRect: () => {},
    beginPath: () => {},
    stroke: () => {},
    fill: () => {},
    setLineDash: () => {},
  };
  let removed = false;
  const fakeCanvas = {
    getContext: (type: string) => (type === '2d' && !failContext ? fakeContext : null),
    remove: () => {
      removed = true;
    },
    width: 800,
    height: 600,
    style: {} as Record<string, string>,
  };
  const container = {
    clientWidth: 800,
    clientHeight: 600,
    style: {} as Record<string, string>,
    appendChild: () => {},
    ownerDocument: {
      createElement: (tag: string) => (tag === 'canvas' ? fakeCanvas : {}),
      createComment: () => ({}),
    },
    addEventListener: (type: string, handler: (...args: unknown[]) => void) => {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener: (type: string, handler: (...args: unknown[]) => void) => {
      const list = listeners.get(type) ?? [];
      listeners.set(
        type,
        list.filter((h) => h !== handler),
      );
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    focus: () => {},
    querySelector: () => container,
  };
  return { container: container as unknown as HTMLElement, fakeCanvas, isRemoved: () => removed };
}

describe('CanvasSurfaceElement', () => {
  it('inicializa com valores padrão para propriedades escalares', () => {
    const el = new CanvasSurfaceElement();
    expect(el.readOnly).toBe(false);
    expect(el.grid).toBe(false);
    expect(el.gridSize).toBe(20);
    expect(el.ariaLabel).toBe('Canvash Canvas');
    expect(el.section).toBeUndefined();
  });

  it('permite atribuir e trocar a instância do canvas externamente', () => {
    const el = new CanvasSurfaceElement();
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();

    el.section = sectionA;
    expect(el.section).toBe(sectionA);

    el.section = sectionB;
    expect(el.section).toBe(sectionB);

    // Atribuir a mesma instância é no-op
    el.section = sectionB;
    expect(el.section).toBe(sectionB);
  });

  it('trocar o canvas quando montado e conectado desmonta anterior e remonta novo', () => {
    const el = new CanvasSurfaceElement();
    const { container } = createMockContainer();
    const testable = el as unknown as TestableCanvasSurface;

    testable._container = container;
    Object.defineProperty(el, 'isConnected', { value: true, configurable: true });

    testable._mount();
    expect(testable._mounted).toBe(true);

    const sectionB = createCanvasSection();
    el.section = sectionB;

    expect(el.section).toBe(sectionB);
    expect(testable._mounted).toBe(true);
  });

  it('dispose() não destrói canvas fornecido pelo host (WC-05)', () => {
    const el = new CanvasSurfaceElement();
    const externalSection = createCanvasSection();
    const destroySpy = vi.spyOn(externalSection, 'destroy');

    el.section = externalSection;
    el.dispose();

    expect(destroySpy).not.toHaveBeenCalled();
  });

  it('fitToContent() não faz nada se não houver canvas ou se o documento estiver vazio', () => {
    const el = new CanvasSurfaceElement();
    expect(() => el.fitToContent()).not.toThrow();

    const section = createCanvasSection();
    const setViewportSpy = vi.spyOn(section, 'setViewport');

    el.section = section;
    el.fitToContent();

    expect(setViewportSpy).not.toHaveBeenCalled();
  });

  it('fitToContent() enquadra e centraliza shapes existentes no viewport', () => {
    const el = new CanvasSurfaceElement();
    const section = createCanvasSection();

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-1',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#000', stroke: '#fff', strokeWidth: 1, opacity: 1 },
      },
    });

    el.section = section;

    // Simula dimensões de container
    Object.defineProperty(el, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true });

    el.fitToContent({ padding: 50 });

    const vp = section.getSnapshot().session.viewport;
    expect(vp.zoom).toBeGreaterThan(0);
    expect(Number.isFinite(vp.x)).toBe(true);
    expect(Number.isFinite(vp.y)).toBe(true);

    // Com padding omitido (usa padrão 40)
    el.fitToContent();
    expect(section.getSnapshot().session.viewport.zoom).toBeGreaterThan(0);
  });

  it('fitToContent() ignora shapes de dimensões zero', () => {
    const el = new CanvasSurfaceElement();
    const section = createCanvasSection();

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'zero-rect',
        type: 'rectangle',
        x: 50,
        y: 50,
        width: 0,
        height: 0,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#000', stroke: '#fff', strokeWidth: 0, opacity: 1 },
      },
    });

    el.section = section;
    const setViewportSpy = vi.spyOn(section, 'setViewport');

    el.fitToContent();
    expect(setViewportSpy).not.toHaveBeenCalled();
  });

  it('delega focus() para o elemento container quando invocado', () => {
    const el = new CanvasSurfaceElement();
    expect(() => el.focus()).not.toThrow();

    const { container } = createMockContainer();
    const testable = el as unknown as TestableCanvasSurface;
    testable._container = container;

    const focusSpy = vi.spyOn(container, 'focus');
    el.focus();
    expect(focusSpy).toHaveBeenCalled();
  });

  it('firstUpdated() obtém container e monta se conectado', () => {
    const el = new CanvasSurfaceElement();
    const { container } = createMockContainer();
    const testable = el as unknown as TestableCanvasSurface;

    Object.defineProperty(el, 'renderRoot', {
      value: { querySelector: () => container },
      configurable: true,
    });
    Object.defineProperty(el, 'isConnected', { value: true, configurable: true });

    testable.firstUpdated();
    expect(testable._mounted).toBe(true);
  });

  it('monta com container e cria canvas interno emitindo canvas-ready', () => {
    const el = new CanvasSurfaceElement();
    const { container } = createMockContainer();
    const testable = el as unknown as TestableCanvasSurface;
    const events: string[] = [];

    el.addEventListener('canvas-ready', () => {
      events.push('canvas-ready');
    });

    testable._container = container;
    Object.defineProperty(el, 'isConnected', { value: true, configurable: true });

    testable._mount();
    expect(el.section).toBeDefined();
    expect(events).toContain('canvas-ready');

    // Chamar _mount() repetido quando já montado é no-op
    testable._mount();
    expect(events).toHaveLength(1);

    // Desconecta limpo
    el.disconnectedCallback();
    expect(testable._mounted).toBe(false);

    // Reconecta
    el.connectedCallback();
    expect(testable._mounted).toBe(true);

    // dispose do canvas interno
    el.dispose();
    expect(el.section).toBeUndefined();
  });

  it('emite canvas-ready com { section } e canvas-error na falha, e nenhum evento com o nome antigo', () => {
    const list = JSON.parse(
      readFileSync(new URL('../../../scripts/legacy-names.json', import.meta.url), 'utf8'),
    ) as { entries: { old: string; kind: string }[] };
    const legacyEvents = list.entries.filter((e) => e.kind === 'event').map((e) => e.old);
    const received: string[] = [];
    let detail: { section?: unknown } | undefined;

    for (const failContext of [false, true]) {
      const el = new CanvasSurfaceElement();
      const { container } = createMockContainer(failContext);
      for (const name of [...legacyEvents, 'canvas-ready', 'canvas-error']) {
        el.addEventListener(name, (event) => {
          received.push(name);
          if (name === 'canvas-ready')
            detail = (event as CustomEvent<{ section?: unknown }>).detail;
        });
      }
      const testable = el as unknown as TestableCanvasSurface;
      testable._container = container;
      testable._mount();
    }

    expect(legacyEvents).toHaveLength(2);
    expect(received).toEqual(['canvas-ready', 'canvas-error']);
    expect(detail?.section).toBeDefined();
  });

  it('_mount() retorna cedo se _container for nulo', () => {
    const el = new CanvasSurfaceElement();
    const testable = el as unknown as TestableCanvasSurface;
    testable._container = null;
    testable._mount();
    expect(testable._mounted).toBe(false);
  });

  it('_mount() aplica readOnly se a propriedade estiver ativa', () => {
    const el = new CanvasSurfaceElement();
    const { container } = createMockContainer();
    const testable = el as unknown as TestableCanvasSurface;

    el.readOnly = true;
    testable._container = container;
    testable._mount();

    expect(el.section?.getSnapshot().session.readOnly).toBe(true);
  });

  it('emite canvas-error se o contexto 2D falhar na montagem', () => {
    const el = new CanvasSurfaceElement();
    const { container } = createMockContainer(true);
    const testable = el as unknown as TestableCanvasSurface;
    let errorReceived = false;

    el.addEventListener('canvas-error', () => {
      errorReceived = true;
    });

    testable._container = container;
    testable._mount();

    expect(errorReceived).toBe(true);
  });

  it('reage a eventos de canvas change despachando eventos DOM tipados', () => {
    const el = new CanvasSurfaceElement();
    const { container } = createMockContainer();
    const testable = el as unknown as TestableCanvasSurface;
    const received: string[] = [];

    el.addEventListener('document-change', () => received.push('document-change'));
    el.addEventListener('selection-change', () => received.push('selection-change'));
    el.addEventListener('viewport-change', () => received.push('viewport-change'));
    el.addEventListener('tool-change', () => received.push('tool-change'));

    testable._container = container;
    testable._mount();

    const section = el.section!;
    const snap = section.getSnapshot();

    const changeEvent: CanvasChange = {
      snapshot: snap,
      areas: ['document', 'selection', 'viewport', 'tool'],
      origin: 'local',
      affectedIds: ['rect-1'],
    };

    testable._handleSectionChange(changeEvent);

    expect(received).toContain('document-change');
    expect(received).toContain('selection-change');
    expect(received).toContain('viewport-change');
    expect(received).toContain('tool-change');
  });

  it('reage a atualizações de propriedades de grid e readOnly', () => {
    const el = new CanvasSurfaceElement();
    const { container } = createMockContainer();
    const testable = el as unknown as TestableCanvasSurface;

    testable._container = container;
    testable._mount();

    el.readOnly = true;
    el.grid = true;
    el.gridSize = 30;

    const changed = new Map<string, unknown>();
    changed.set('readOnly', false);
    changed.set('grid', false);
    changed.set('gridSize', 20);

    testable.updated(changed);

    expect(el.section?.getSnapshot().session.readOnly).toBe(true);
  });

  it('_remountRenderer() não faz nada se não estiver montado', () => {
    const el = new CanvasSurfaceElement();
    const testable = el as unknown as TestableCanvasSurface;
    expect(() => testable._remountRenderer()).not.toThrow();
  });

  it('_remountRenderer() lida com falha de contexto no remount', () => {
    const el = new CanvasSurfaceElement();
    const { container } = createMockContainer(true);
    const testable = el as unknown as TestableCanvasSurface;

    testable._container = container;
    testable._mount();

    // Tenta remount
    testable._remountRenderer();
    expect(testable._rendererHandle).toBeUndefined();
  });

  it('_handleSectionChange() ignora eventos exclusivos de preview', () => {
    const el = new CanvasSurfaceElement();
    const { container } = createMockContainer();
    const testable = el as unknown as TestableCanvasSurface;
    const events: string[] = [];

    el.addEventListener('document-change', () => events.push('document-change'));

    testable._container = container;
    testable._mount();

    const changeEvent: CanvasChange = {
      snapshot: el.section!.getSnapshot(),
      areas: ['preview'],
      origin: 'local',
      affectedIds: [],
    };

    testable._handleSectionChange(changeEvent);
    expect(events).toHaveLength(0);
  });

  it('performUpdate() retorna prematuramente em ambiente sem document.createComment', () => {
    const el = new CanvasSurfaceElement();
    const testable = el as unknown as { performUpdate(): void };
    expect(() => testable.performUpdate()).not.toThrow();
  });

  it('connectedCallback() é no-op se container ainda não estiver pronto', () => {
    const el = new CanvasSurfaceElement();
    const testable = el as unknown as TestableCanvasSurface;
    testable._container = null;
    expect(() => el.connectedCallback()).not.toThrow();
    expect(testable._mounted).toBe(false);
  });

  it('firstUpdated() não remonta se já estiver montado ou desconectado', () => {
    const el = new CanvasSurfaceElement();
    const { container } = createMockContainer();
    const testable = el as unknown as TestableCanvasSurface;

    Object.defineProperty(el, 'renderRoot', {
      value: { querySelector: () => container },
      configurable: true,
    });
    // desconectado
    Object.defineProperty(el, 'isConnected', { value: false, configurable: true });
    testable.firstUpdated();
    expect(testable._mounted).toBe(false);

    // já montado
    testable._mounted = true;
    testable.firstUpdated();
    expect(testable._mounted).toBe(true);
  });

  it('delega focus() para super se container não tiver método focus', () => {
    const el = new CanvasSurfaceElement();
    const testable = el as unknown as TestableCanvasSurface;
    testable._container = {} as HTMLElement;
    expect(() => el.focus()).not.toThrow();
  });

  it('_unmount() é idempotente quando chamado múltiplas vezes', () => {
    const el = new CanvasSurfaceElement();
    const { container } = createMockContainer();
    const testable = el as unknown as TestableCanvasSurface;

    testable._container = container;
    testable._mount();
    testable._unmount();
    expect(() => testable._unmount()).not.toThrow();
  });

  it('troca de canvas quando não conectado não remonta imediatamente', () => {
    const el = new CanvasSurfaceElement();
    const { container } = createMockContainer();
    const testable = el as unknown as TestableCanvasSurface;

    testable._container = container;
    testable._mount();
    // simula desconexão
    Object.defineProperty(el, 'isConnected', { value: false, configurable: true });

    const sectionB = createCanvasSection();
    el.section = sectionB;
    expect(el.section).toBe(sectionB);
    expect(testable._mounted).toBe(false);
  });

  it('reage a atualizações de apenas gridSize no updated()', () => {
    const el = new CanvasSurfaceElement();
    const { container } = createMockContainer();
    const testable = el as unknown as TestableCanvasSurface;

    testable._container = container;
    testable._mount();

    const changed = new Map<string, unknown>();
    changed.set('gridSize', 20);

    testable.updated(changed);
    expect(testable._mounted).toBe(true);
  });

  it('50 ciclos sucessivos de connect/disconnect preservam o documento e desmontam limpamente (WC-04)', () => {
    const el = new CanvasSurfaceElement();
    const { container } = createMockContainer();
    const testable = el as unknown as TestableCanvasSurface;
    testable._container = container;

    // Monta inicialmente
    el.connectedCallback();
    const section = el.section!;
    expect(section).toBeDefined();

    // Adiciona shape no documento
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'persisted-node',
        type: 'rectangle',
        x: 10,
        y: 10,
        width: 100,
        height: 100,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    });

    // 50 ciclos de disconnect e connect
    for (let i = 0; i < 50; i++) {
      el.disconnectedCallback();
      expect(testable._mounted).toBe(false);
      expect(testable._rendererHandle).toBeUndefined();

      el.connectedCallback();
      expect(testable._mounted).toBe(true);
      expect(el.section).toBe(section);
    }

    // Desconecta final e confere que o documento está intacto
    el.disconnectedCallback();
    expect(testable._mounted).toBe(false);
    expect(section.getSnapshot().document.nodes['persisted-node']).toBeDefined();
  });
});

describe('CanvasSurfaceElement: superfície', () => {
  it('pinta o fundo do host com o token --canvash-canvas-bg, com padrão #f2f3f5', () => {
    const styles = CanvasSurfaceElement.styles as { cssText: string };

    expect(styles.cssText).toContain('background: var(--canvash-canvas-bg, #f2f3f5)');
  });
});

/** Contêiner falso cujo contexto 2D registra as operações de pontos (rect) e de linhas (lineTo). */
function createRecordingContainer() {
  const ops = { rects: 0, lines: 0 };
  const noop = (): void => {};
  const context = {
    save: noop,
    restore: noop,
    scale: noop,
    translate: noop,
    setTransform: noop,
    clearRect: noop,
    fillRect: noop,
    beginPath: noop,
    moveTo: noop,
    stroke: noop,
    fill: noop,
    setLineDash: noop,
    rect: () => {
      ops.rects += 1;
    },
    lineTo: () => {
      ops.lines += 1;
    },
  };
  const canvas = {
    getContext: () => context,
    remove: noop,
    width: 800,
    height: 600,
    style: {} as Record<string, string>,
  };
  const container = {
    clientWidth: 800,
    clientHeight: 600,
    style: {} as Record<string, string>,
    appendChild: noop,
    ownerDocument: {
      createElement: (tag: string) => (tag === 'canvas' ? canvas : {}),
      createComment: () => ({}),
    },
    addEventListener: noop,
    removeEventListener: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    focus: noop,
    querySelector: () => container,
  };
  return { container: container as unknown as HTMLElement, ops };
}

describe('CanvasSurfaceElement: estilo do grid', () => {
  it('tem pontos como estilo padrão e expõe o atributo grid-style', () => {
    const el = new CanvasSurfaceElement();

    expect(el.gridStyle).toBe('dots');
    const properties = CanvasSurfaceElement.properties as Record<string, { attribute?: string }>;
    expect(properties['gridStyle']?.attribute).toBe('grid-style');
  });

  it('pinta pontos por padrão e linhas com gridStyle "lines"', () => {
    const dots = createRecordingContainer();
    const dotsEl = new CanvasSurfaceElement();
    const dotsTestable = dotsEl as unknown as TestableCanvasSurface;
    dotsTestable._container = dots.container;
    dotsTestable._mount();

    expect(dots.ops.rects).toBeGreaterThan(0);
    expect(dots.ops.lines).toBe(0);

    const lines = createRecordingContainer();
    const linesEl = new CanvasSurfaceElement();
    linesEl.gridStyle = 'lines';
    const linesTestable = linesEl as unknown as TestableCanvasSurface;
    linesTestable._container = lines.container;
    linesTestable._mount();

    expect(lines.ops.lines).toBeGreaterThan(0);
    expect(lines.ops.rects).toBe(0);
  });

  it('remonta o renderer quando gridStyle muda depois de montado', () => {
    const { container, ops } = createRecordingContainer();
    const el = new CanvasSurfaceElement();
    const testable = el as unknown as TestableCanvasSurface;
    testable._container = container;
    testable._mount();
    expect(ops.lines).toBe(0);

    el.gridStyle = 'lines';
    testable.updated(new Map<string, unknown>([['gridStyle', 'dots']]));

    expect(ops.lines).toBeGreaterThan(0);
  });

  it('o tamanho do grid continua valendo no estilo de pontos', () => {
    const small = createRecordingContainer();
    const smallEl = new CanvasSurfaceElement();
    smallEl.grid = true;
    smallEl.gridSize = 20;
    (smallEl as unknown as TestableCanvasSurface)._container = small.container;
    (smallEl as unknown as TestableCanvasSurface)._mount();

    const large = createRecordingContainer();
    const largeEl = new CanvasSurfaceElement();
    largeEl.grid = true;
    largeEl.gridSize = 100;
    (largeEl as unknown as TestableCanvasSurface)._container = large.container;
    (largeEl as unknown as TestableCanvasSurface)._mount();

    expect(large.ops.rects).toBeLessThan(small.ops.rects);
  });
});

describe('CanvasSurfaceElement: zoom e enquadramento', () => {
  const rectangle = (id: string, x: number, y: number, width: number, height: number) => ({
    type: 'shape.create' as const,
    shape: {
      id,
      type: 'rectangle' as const,
      x,
      y,
      width,
      height,
      rotation: 0,
      style: { fill: '#000000', stroke: null, strokeWidth: 0, opacity: 1 },
    },
  });

  /** Elemento com canvas externo e o contêiner falso de 800 × 600 CSS px. */
  function setup() {
    const el = new CanvasSurfaceElement();
    const section = createCanvasSection();
    const { container } = createMockContainer();
    (el as unknown as TestableCanvasSurface)._container = container;
    el.section = section;
    return { el, section };
  }

  const centerWorld = (section: ReturnType<typeof createCanvasSection>) => {
    const { x, y, zoom } = section.getSnapshot().session.viewport;
    return { x: (400 - x) / zoom, y: (300 - y) / zoom };
  };

  it('zoomBy() multiplica o zoom mantendo o ponto central do contêiner', () => {
    const { el, section } = setup();
    section.setViewport({ x: 37, y: -12, zoom: 1 });
    const before = centerWorld(section);

    el.zoomBy(1.2);

    expect(section.getSnapshot().session.viewport.zoom).toBeCloseTo(1.2, 10);
    const after = centerWorld(section);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('zoomBy() respeita os limites de zoom e não republica o viewport no limite', () => {
    const { el, section } = setup();
    section.setViewport({ x: 0, y: 0, zoom: 15 });

    el.zoomBy(10);
    expect(section.getSnapshot().session.viewport.zoom).toBe(16);

    const spy = vi.spyOn(section, 'setViewport');
    el.zoomBy(10);
    expect(spy).not.toHaveBeenCalled();
  });

  it('zoomBy() e zoomTo() ignoram fator inválido e canvas ausente', () => {
    const lonely = new CanvasSurfaceElement();
    expect(() => lonely.zoomBy(1.2)).not.toThrow();
    expect(() => lonely.zoomTo(2)).not.toThrow();

    const { el, section } = setup();
    const spy = vi.spyOn(section, 'setViewport');
    el.zoomBy(0);
    el.zoomBy(-2);
    el.zoomBy(Number.NaN);
    el.zoomTo(0);
    el.zoomTo(Number.POSITIVE_INFINITY);
    expect(spy).not.toHaveBeenCalled();
  });

  it('zoomTo() leva ao zoom pedido ancorado no centro, sem mudar o documento', () => {
    const { el, section } = setup();
    section.setViewport({ x: 100, y: 50, zoom: 0.37 });
    const before = centerWorld(section);
    const revision = section.getSnapshot().revision;

    el.zoomTo(1);

    expect(section.getSnapshot().session.viewport.zoom).toBe(1);
    expect(centerWorld(section).x).toBeCloseTo(before.x, 6);
    expect(centerWorld(section).y).toBeCloseTo(before.y, 6);
    expect(section.getSnapshot().revision).toBe(revision);
  });

  it('fitToSelection() enquadra só os nós selecionados', () => {
    const { el, section } = setup();
    section.dispatch(rectangle('a', 0, 0, 100, 100));
    section.dispatch(rectangle('b', 5000, 5000, 100, 100));
    section.setSelection(['a']);

    el.fitToSelection({ padding: 50 });

    const { x, y, zoom } = section.getSnapshot().session.viewport;
    // 100 × 100 numa área útil de 700 × 500: zoom = 5, caixa centralizada em (400, 300)
    expect(zoom).toBeCloseTo(5, 6);
    expect(x + 50 * zoom).toBeCloseTo(400, 6);
    expect(y + 50 * zoom).toBeCloseTo(300, 6);
  });

  it('fitToSelection() não faz nada sem seleção, sem canvas ou sem área', () => {
    const lonely = new CanvasSurfaceElement();
    expect(() => lonely.fitToSelection()).not.toThrow();

    const { el, section } = setup();
    section.dispatch(rectangle('a', 0, 0, 100, 100));
    const spy = vi.spyOn(section, 'setViewport');

    el.fitToSelection();
    expect(spy).not.toHaveBeenCalled();

    section.setSelection(['a']);
    (el as unknown as TestableCanvasSurface)._container = {
      clientWidth: 0,
      clientHeight: 0,
    } as unknown as HTMLElement;
    el.fitToSelection();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('CanvasSurfaceElement: estado da interação', () => {
  interface StateTestable {
    _container: HTMLElement | null;
    _mount(): void;
    _onInteractionStateChange(state: string): void;
  }

  it('interactionState é idle antes de montar e depois de montar', () => {
    const el = new CanvasSurfaceElement();
    expect(el.interactionState).toBe('idle');

    const { container } = createMockContainer();
    (el as unknown as StateTestable)._container = container;
    (el as unknown as StateTestable)._mount();

    expect(el.interactionState).toBe('idle');
  });

  it('emite interaction-state-change a cada mudança, composto e com borbulhamento', () => {
    const el = new CanvasSurfaceElement();
    const events: CustomEvent[] = [];
    el.addEventListener('interaction-state-change', (event) => events.push(event as CustomEvent));
    const internals = el as unknown as StateTestable;

    internals._onInteractionStateChange('moving');
    expect(el.interactionState).toBe('moving');
    internals._onInteractionStateChange('idle');

    expect(events.map((event) => event.detail)).toEqual([{ state: 'moving' }, { state: 'idle' }]);
    expect(events[0]?.bubbles).toBe(true);
    expect(events[0]?.composed).toBe(true);
  });

  it('ao desmontar, o estado volta a idle e o fim do gesto é avisado', () => {
    const el = new CanvasSurfaceElement();
    const { container } = createMockContainer();
    const internals = el as unknown as StateTestable & { _unmount(): void };
    internals._container = container;
    internals._mount();
    internals._onInteractionStateChange('resizing');
    const events: CustomEvent[] = [];
    el.addEventListener('interaction-state-change', (event) => events.push(event as CustomEvent));

    internals._unmount();

    expect(el.interactionState).toBe('idle');
    expect(events.map((event) => event.detail)).toEqual([{ state: 'idle' }]);
  });
});
