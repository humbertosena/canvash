// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createCanvasSection, type CanvasSectionApi, type CanvasSnapshot } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useCanvasSnapshot } from './useCanvasSnapshot.js';

describe('useCanvasSnapshot', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
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
    if (container) {
      container.remove();
      container = null;
    }
  });

  it('retorna null quando nenhum canvas é fornecido', () => {
    let capturedSnapshot: CanvasSnapshot | null = 'not-null' as unknown as CanvasSnapshot;

    function TestComponent({ section }: { section?: CanvasSectionApi | null }) {
      capturedSnapshot = useCanvasSnapshot(section);
      return null;
    }

    act(() => {
      root?.render(<TestComponent section={null} />);
    });

    expect(capturedSnapshot).toBeNull();
  });

  it('retorna o snapshot inicial do canvas', () => {
    const section = createCanvasSection();
    let capturedSnapshot: CanvasSnapshot | null = null;

    function TestComponent({ section }: { section: CanvasSectionApi }) {
      capturedSnapshot = useCanvasSnapshot(section);
      return null;
    }

    act(() => {
      root?.render(<TestComponent section={section} />);
    });

    expect(capturedSnapshot).not.toBeNull();
    expect(capturedSnapshot!.revision).toBe(0);
    expect(capturedSnapshot!.document.schemaVersion).toBe(1);
  });

  it('atualiza o snapshot quando o canvas é alterado por dispatch', () => {
    const section = createCanvasSection();
    let capturedSnapshot: CanvasSnapshot | null = null;

    let renders = 0;
    function TestComponent({ section }: { section: CanvasSectionApi }) {
      renders++;
      capturedSnapshot = useCanvasSnapshot(section);
      return <div data-rev={capturedSnapshot?.revision}>{capturedSnapshot?.revision}</div>;
    }

    act(() => {
      root?.render(<TestComponent section={section} />);
    });

    expect(capturedSnapshot!.revision).toBe(0);
    expect(renders).toBe(1);

    act(() => {
      const res = section.dispatch({
        type: 'shape.create',
        shape: { type: 'rectangle', x: 10, y: 10, width: 100, height: 50, rotation: 0 },
      });
      expect(res.ok).toBe(true);
    });

    expect(renders).toBe(2);
    expect(capturedSnapshot!.revision).toBe(1);
    expect(Object.keys(capturedSnapshot!.document.nodes)).toHaveLength(1);
  });

  it('desliga a assinatura quando o componente é desmontado', () => {
    const section = createCanvasSection();
    let renderCount = 0;

    function TestComponent({ section }: { section: CanvasSectionApi }) {
      renderCount++;
      useCanvasSnapshot(section);
      return null;
    }

    act(() => {
      root?.render(<TestComponent section={section} />);
    });

    const initialRenders = renderCount;

    act(() => {
      root?.unmount();
      root = null;
    });

    // Modificação após unmount não deve causar erros nem novas chamadas
    section.dispatch({
      type: 'shape.create',
      shape: { type: 'rectangle', x: 0, y: 0, width: 20, height: 20, rotation: 0 },
    });

    expect(renderCount).toBe(initialRenders);
  });
});
