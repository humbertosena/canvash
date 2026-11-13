// @vitest-environment jsdom
import { act, createRef, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasSurface, type CanvasSurfaceHandle } from './CanvasSurface.js';

describe('CanvasSurface (React Component)', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;
  let getContextSpy: { mockRestore(): void } | null = null;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    // O jsdom não implementa canvas 2D; sem o espião, cada montagem imprime um aviso sem autoria.
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    getContextSpy?.mockRestore();
    getContextSpy = null;
    if (container) {
      container.remove();
      container = null;
    }
  });

  it('lança TypeError se canvas externo e initialDocument forem combinados', () => {
    const section = createCanvasSection();
    const doc = section.getSnapshot().document;

    // React captura erro em render:
    expect(() => {
      act(() => {
        root?.render(<CanvasSurface section={section} initialDocument={doc} />);
      });
    }).toThrow(TypeError);
  });

  it('no modo interno cria uma instância própria e expõe via ref', () => {
    const ref = createRef<CanvasSurfaceHandle>();

    act(() => {
      root?.render(<CanvasSurface ref={ref} grid={true} gridSize={30} ariaLabel="Test Canvas" />);
    });

    expect(ref.current).not.toBeNull();
    expect(ref.current?.section).not.toBeNull();
    expect(ref.current?.element).not.toBeNull();
    expect(ref.current?.element?.tagName.toLowerCase()).toBe('canvas-surface');

    const el = ref.current?.element as HTMLElement & {
      readOnly?: boolean;
      grid?: boolean;
      gridSize?: number;
      ariaLabel?: string;
    };
    expect(el.grid).toBe(true);
    expect(el.gridSize).toBe(30);
    expect(el.ariaLabel).toBe('Test Canvas');
  });

  it('repassa gridHighlight ao elemento, ligado por padrão', () => {
    const highlightRef = createRef<CanvasSurfaceHandle>();
    const highlightOf = () =>
      (highlightRef.current?.element as HTMLElement & { gridHighlight?: string }).gridHighlight;
    act(() => {
      root?.render(<CanvasSurface ref={highlightRef} />);
    });
    expect(highlightOf()).toBe('on');

    act(() => {
      root?.render(<CanvasSurface ref={highlightRef} gridHighlight="off" />);
    });
    expect(highlightOf()).toBe('off');
  });

  it('repassa gridStyle ao elemento, com pontos como padrão', () => {
    const defaultRef = createRef<CanvasSurfaceHandle>();
    act(() => {
      root?.render(<CanvasSurface ref={defaultRef} />);
    });
    expect((defaultRef.current?.element as HTMLElement & { gridStyle?: string }).gridStyle).toBe(
      'dots',
    );

    act(() => {
      root?.render(<CanvasSurface ref={defaultRef} gridStyle="lines" />);
    });
    expect((defaultRef.current?.element as HTMLElement & { gridStyle?: string }).gridStyle).toBe(
      'lines',
    );
  });

  it('no modo externo usa a instância fornecida e não a destrói no unmount', () => {
    const externalSection = createCanvasSection();
    const destroySpy = vi.spyOn(externalSection, 'destroy');
    const ref = createRef<CanvasSurfaceHandle>();

    act(() => {
      root?.render(<CanvasSurface ref={ref} section={externalSection} />);
    });

    expect(ref.current?.section).toBe(externalSection);

    act(() => {
      root?.unmount();
      root = null;
    });

    // Canvas externo nunca deve ser destruído pelo wrapper (WC-05 / ADAPTER-03)
    expect(destroySpy).not.toHaveBeenCalled();
    expect(externalSection.getSnapshot().revision).toBe(0);
  });

  it('no modo interno destrói a instância no unmount definitivo', async () => {
    const ref = createRef<CanvasSurfaceHandle>();

    act(() => {
      root?.render(<CanvasSurface ref={ref} />);
    });

    const section = ref.current?.section as CanvasSectionApi;
    expect(section).toBeDefined();
    const destroySpy = vi.spyOn(section, 'destroy');

    act(() => {
      root?.unmount();
      root = null;
    });

    // Aguarda o microtask/timer de cleanup definitivo
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(destroySpy).toHaveBeenCalled();
  });

  it('resiste a React Strict Mode sem destruir ou duplicar instâncias indevidamente', () => {
    const ref = createRef<CanvasSurfaceHandle>();

    act(() => {
      root?.render(
        <StrictMode>
          <CanvasSurface ref={ref} ariaLabel="Strict Canvas" />
        </StrictMode>,
      );
    });

    expect(ref.current?.section).not.toBeNull();
    expect(ref.current?.element).not.toBeNull();
  });

  it('encaminha eventos disparados pelo elemento customizado para os callbacks', async () => {
    const onCanvasReady = vi.fn();
    const onDocumentChange = vi.fn();
    const onSelectionChange = vi.fn();
    const onViewportChange = vi.fn();
    const onToolChange = vi.fn();
    const onError = vi.fn();

    const ref = createRef<CanvasSurfaceHandle>();

    act(() => {
      root?.render(
        <CanvasSurface
          ref={ref}
          onCanvasReady={onCanvasReady}
          onDocumentChange={onDocumentChange}
          onSelectionChange={onSelectionChange}
          onViewportChange={onViewportChange}
          onToolChange={onToolChange}
          onError={onError}
        />,
      );
    });

    const el = ref.current?.element;
    expect(el).not.toBeNull();

    // Deixa a montagem do Lit acontecer (sem contexto 2D ela emite canvas-error) e limpa as chamadas
    // dela, para as contagens abaixo valerem só para os eventos simulados.
    await new Promise((resolve) => setTimeout(resolve, 0));
    onCanvasReady.mockClear();
    onDocumentChange.mockClear();
    onSelectionChange.mockClear();
    onViewportChange.mockClear();
    onToolChange.mockClear();
    onError.mockClear();

    // Dispara eventos simulados
    el?.dispatchEvent(
      new CustomEvent('canvas-ready', { detail: { section: ref.current?.section } }),
    );
    expect(onCanvasReady).toHaveBeenCalledTimes(1);

    el?.dispatchEvent(
      new CustomEvent('document-change', {
        detail: { document: {}, revision: 1, origin: 'local', affectedIds: [] },
      }),
    );
    expect(onDocumentChange).toHaveBeenCalledTimes(1);

    el?.dispatchEvent(new CustomEvent('selection-change', { detail: { selection: ['id-1'] } }));
    expect(onSelectionChange).toHaveBeenCalledTimes(1);

    el?.dispatchEvent(
      new CustomEvent('viewport-change', { detail: { viewport: { x: 10, y: 20, zoom: 1 } } }),
    );
    expect(onViewportChange).toHaveBeenCalledTimes(1);

    el?.dispatchEvent(new CustomEvent('tool-change', { detail: { tool: 'rectangle' } }));
    expect(onToolChange).toHaveBeenCalledTimes(1);

    el?.dispatchEvent(new CustomEvent('canvas-error', { detail: { error: 'mock error' } }));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('repassa text-edit-superseded a onTextEditSuperseded e remove o ouvinte ao desmontar', () => {
    const onTextEditSuperseded = vi.fn();
    const ref = createRef<CanvasSurfaceHandle>();
    act(() => {
      root?.render(<CanvasSurface ref={ref} onTextEditSuperseded={onTextEditSuperseded} />);
    });
    const el = ref.current?.element;

    el?.dispatchEvent(
      new CustomEvent('text-edit-superseded', { detail: { nodeId: 'n1', text: 'rascunho' } }),
    );
    expect(onTextEditSuperseded).toHaveBeenCalledWith({ nodeId: 'n1', text: 'rascunho' });

    act(() => {
      root?.unmount();
    });
    root = null;
    el?.dispatchEvent(
      new CustomEvent('text-edit-superseded', { detail: { nodeId: 'n1', text: 'outro' } }),
    );
    expect(onTextEditSuperseded).toHaveBeenCalledTimes(1);
  });

  it('expõe focus e fitToContent no handle', () => {
    const ref = createRef<CanvasSurfaceHandle>();

    act(() => {
      root?.render(<CanvasSurface ref={ref} />);
    });

    const el = ref.current?.element as HTMLElement & {
      focus: (opts?: FocusOptions) => void;
      fitToContent: (opts?: unknown) => void;
    };
    el.focus = vi.fn();
    el.fitToContent = vi.fn();

    ref.current?.focus({ preventScroll: true });
    expect(el.focus).toHaveBeenCalledWith({ preventScroll: true });

    ref.current?.fitToContent({ padding: 50 });
    expect(el.fitToContent).toHaveBeenCalledWith({ padding: 50 });

    ref.current?.focus();
    expect(el.focus).toHaveBeenCalledWith(undefined);

    ref.current?.fitToContent();
    expect(el.fitToContent).toHaveBeenCalledWith(undefined);
  });

  it('expõe zoomBy, zoomTo e fitToSelection no handle', () => {
    const ref = createRef<CanvasSurfaceHandle>();

    act(() => {
      root?.render(<CanvasSurface ref={ref} />);
    });

    const el = ref.current?.element as HTMLElement & {
      zoomBy: (factor: number) => void;
      zoomTo: (zoom: number) => void;
      fitToSelection: (opts?: unknown) => void;
    };
    el.zoomBy = vi.fn();
    el.zoomTo = vi.fn();
    el.fitToSelection = vi.fn();

    ref.current?.zoomBy(1.2);
    expect(el.zoomBy).toHaveBeenCalledWith(1.2);

    ref.current?.zoomTo(2);
    expect(el.zoomTo).toHaveBeenCalledWith(2);

    ref.current?.fitToSelection({ padding: 10 });
    expect(el.fitToSelection).toHaveBeenCalledWith({ padding: 10 });
  });

  it('no modo interno aceita initialDocument e inicializa o canvas com ele', () => {
    const tempSection = createCanvasSection();
    tempSection.dispatch({
      type: 'shape.create',
      shape: { type: 'rectangle', x: 20, y: 20, width: 40, height: 40, rotation: 0 },
    });
    const doc = tempSection.getSnapshot().document;

    const ref = createRef<CanvasSurfaceHandle>();
    act(() => {
      root?.render(<CanvasSurface ref={ref} initialDocument={doc} readOnly={true} />);
    });

    expect(ref.current?.section).not.toBeNull();
    const snap = ref.current?.section?.getSnapshot();
    expect(Object.keys(snap?.document.nodes ?? {})).toHaveLength(1);
  });

  it('atualiza o elemento customizado quando a prop section externa é alterada', () => {
    const section1 = createCanvasSection();
    const section2 = createCanvasSection();
    const ref = createRef<CanvasSurfaceHandle>();

    act(() => {
      root?.render(<CanvasSurface ref={ref} section={section1} />);
    });

    const el = ref.current?.element as HTMLElement & { section?: unknown };
    expect(el.section).toBe(section1);

    act(() => {
      root?.render(<CanvasSurface ref={ref} section={section2} />);
    });

    expect(el.section).toBe(section2);
  });
});
