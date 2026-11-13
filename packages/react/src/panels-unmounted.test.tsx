// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createCanvasSection } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CanvasControls,
  CanvasLayers,
  CanvasProperties,
  CanvasSelectionMenu,
  CanvasSection,
  CanvasToolbar,
} from './panels.js';

// Os efeitos dos painéis só agem com o elemento montado. Aqui o ref nunca é preenchido, para provar
// que, sem elemento, eles não fazem nada e não lançam.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  // O React atribui o elemento ao objeto do ref; este descarta a atribuição e segue nulo.
  const useRef = () => ({
    get current() {
      return null;
    },
    set current(value: unknown) {
      void value;
    },
  });
  return { ...actual, useRef, default: { ...actual, useRef } };
});

describe('React Panels: sem elemento montado', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
  });

  it('os efeitos de todos os painéis são no-op e não lançam', () => {
    const section = createCanvasSection();
    const canvas = {
      interactionState: 'idle' as const,
      focus() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
      addEventListener() {},
      removeEventListener() {},
    };

    expect(() => {
      act(() => {
        root?.render(
          <CanvasSection
            section={section}
            projectTitle="Plano"
            menuItems={[{ id: 'a', label: 'A' }]}
          >
            <CanvasToolbar slot="toolbar" section={section} />
            <CanvasLayers slot="left" section={section} />
            <CanvasProperties slot="properties" section={section} />
            <CanvasControls slot="controls" section={section} />
            <CanvasSelectionMenu slot="overlay" section={section} canvas={canvas} />
          </CanvasSection>,
        );
      });
    }).not.toThrow();

    const shell = container?.querySelector('canvas-section') as HTMLElement & { section?: unknown };
    expect(shell).not.toBeNull();
    expect(shell.section).toBeUndefined();
  });
});
