// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createCanvasSection } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import {
  CanvasControls,
  CanvasLayers,
  CanvasProperties,
  CanvasSelectionMenu,
  CanvasSection,
  CanvasToolbar,
} from './panels.js';

/** O que o mini-menu usa do `<canvas-surface>`, sem elemento de verdade. */
function fakeSelectionCanvas() {
  return {
    interactionState: 'idle' as const,
    focus() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    addEventListener() {},
    removeEventListener() {},
  };
}

describe('React Panels (CanvasToolbar, CanvasLayers, CanvasProperties)', () => {
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

  it('renderiza CanvasToolbar com o elemento customizado <canvas-toolbar>', () => {
    const section = createCanvasSection();
    act(() => {
      root?.render(
        <CanvasToolbar section={section} orientation="vertical" className="custom-toolbar" />,
      );
    });

    const el = container?.querySelector('canvas-toolbar') as HTMLElement & {
      section?: unknown;
      orientation?: string;
    };
    expect(el).not.toBeNull();
    expect(el.section).toBe(section);
    expect(el.orientation).toBe('vertical');
    expect(el.getAttribute('class')).toContain('custom-toolbar');
  });

  it('renderiza CanvasToolbar com orientação padrão horizontal', () => {
    act(() => {
      root?.render(<CanvasToolbar />);
    });
    const el = container?.querySelector('canvas-toolbar') as HTMLElement & {
      orientation?: string;
    };
    expect(el.orientation).toBe('horizontal');
  });

  it('renderiza CanvasLayers com o elemento customizado <canvas-layers>', () => {
    const section = createCanvasSection();
    act(() => {
      root?.render(<CanvasLayers section={section} className="custom-layers" />);
    });

    const el = container?.querySelector('canvas-layers') as HTMLElement & {
      section?: unknown;
    };
    expect(el).not.toBeNull();
    expect(el.section).toBe(section);
    expect(el.getAttribute('class')).toContain('custom-layers');
  });

  it('renderiza CanvasProperties com o elemento customizado <canvas-properties>', () => {
    const section = createCanvasSection();
    act(() => {
      root?.render(<CanvasProperties section={section} className="custom-props" />);
    });

    const el = container?.querySelector('canvas-properties') as HTMLElement & {
      section?: unknown;
    };
    expect(el).not.toBeNull();
    expect(el.section).toBe(section);
    expect(el.getAttribute('class')).toContain('custom-props');
  });
  it('renderiza CanvasControls com section e canvas atribuídos como propriedades', () => {
    const section = createCanvasSection();
    const canvas = { zoomBy() {}, zoomTo() {}, fitToContent() {}, fitToSelection() {} };
    act(() => {
      root?.render(
        <CanvasControls section={section} canvas={canvas} className="custom-controls" />,
      );
    });

    const el = container?.querySelector('canvas-controls') as HTMLElement & {
      section?: unknown;
      canvas?: unknown;
    };
    expect(el).not.toBeNull();
    expect(el.section).toBe(section);
    expect(el.canvas).toBe(canvas);
    expect(el.getAttribute('class')).toContain('custom-controls');
  });

  it('CanvasControls acompanha a troca de section e de canvas, inclusive para nulo', () => {
    const first = createCanvasSection();
    const second = createCanvasSection();
    const canvas = { zoomBy() {}, zoomTo() {}, fitToContent() {}, fitToSelection() {} };
    act(() => {
      root?.render(<CanvasControls section={first} canvas={canvas} />);
    });
    const el = container?.querySelector('canvas-controls') as HTMLElement & {
      section?: unknown;
      canvas?: unknown;
    };

    act(() => {
      root?.render(<CanvasControls section={second} canvas={null} />);
    });

    expect(el.section).toBe(second);
    expect(el.canvas).toBeUndefined();
  });
  it('CanvasToolbar repassa hideHistory, hideZoom e compactReadonly ao elemento', () => {
    act(() => {
      root?.render(<CanvasToolbar hideHistory hideZoom compactReadonly />);
    });
    const el = container?.querySelector('canvas-toolbar') as HTMLElement & {
      hideHistory?: boolean;
      hideZoom?: boolean;
      compactReadonly?: boolean;
    };
    expect(el.hideHistory).toBe(true);
    expect(el.hideZoom).toBe(true);
    expect(el.compactReadonly).toBe(true);

    act(() => {
      root?.render(<CanvasToolbar />);
    });
    expect(el.hideHistory).toBe(false);
    expect(el.hideZoom).toBe(false);
    expect(el.compactReadonly).toBe(false);
  });
  it('os painéis repassam a prop slot ao elemento, para ocuparem as regiões do shell', () => {
    act(() => {
      root?.render(
        <>
          <CanvasToolbar slot="toolbar" />
          <CanvasLayers slot="left" />
          <CanvasProperties slot="properties" />
          <CanvasControls slot="controls" />
        </>,
      );
    });

    expect(container?.querySelector('canvas-toolbar')?.getAttribute('slot')).toBe('toolbar');
    expect(container?.querySelector('canvas-layers')?.getAttribute('slot')).toBe('left');
    expect(container?.querySelector('canvas-properties')?.getAttribute('slot')).toBe('properties');
    expect(container?.querySelector('canvas-controls')?.getAttribute('slot')).toBe('controls');
  });

  it('CanvasSection renderiza <canvas-section> com section, título e filhos nos slots', () => {
    const section = createCanvasSection();
    act(() => {
      root?.render(
        <CanvasSection section={section} projectTitle="Plano" className="meu-shell">
          <div slot="menu" id="conteudo-menu" />
          <CanvasToolbar slot="toolbar" />
        </CanvasSection>,
      );
    });

    const el = container?.querySelector('canvas-section') as HTMLElement & {
      section?: unknown;
      projectTitle?: string;
    };
    expect(el).not.toBeNull();
    expect(el.section).toBe(section);
    expect(el.projectTitle).toBe('Plano');
    expect(el.getAttribute('class')).toContain('meu-shell');
    expect(el.querySelector('#conteudo-menu')?.getAttribute('slot')).toBe('menu');
    expect(el.querySelector('canvas-toolbar')?.getAttribute('slot')).toBe('toolbar');
  });

  it('CanvasSection acompanha a troca de título e de section, inclusive para nulo', () => {
    const first = createCanvasSection();
    const second = createCanvasSection();
    act(() => {
      root?.render(<CanvasSection section={first} projectTitle="A" />);
    });
    const el = container?.querySelector('canvas-section') as HTMLElement & {
      section?: unknown;
      projectTitle?: string;
    };

    act(() => {
      root?.render(<CanvasSection section={second} projectTitle="B" />);
    });
    expect(el.section).toBe(second);
    expect(el.projectTitle).toBe('B');

    act(() => {
      root?.render(<CanvasSection />);
    });
    expect(el.section).toBeUndefined();
    expect(el.projectTitle).toBe('');
  });

  it('CanvasSection chama onTitleChange e onMenuToggle com os callbacks mais recentes', () => {
    const first = vi.fn();
    const second = vi.fn();
    const toggle = vi.fn();
    act(() => {
      root?.render(<CanvasSection onTitleChange={first} onMenuToggle={toggle} />);
    });
    const el = container?.querySelector('canvas-section') as HTMLElement;

    el.dispatchEvent(new CustomEvent('title-change', { detail: { title: 'Novo' } }));
    expect(first).toHaveBeenCalledWith('Novo');

    act(() => {
      root?.render(<CanvasSection onTitleChange={second} onMenuToggle={toggle} />);
    });
    el.dispatchEvent(new CustomEvent('title-change', { detail: { title: 'Outro' } }));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith('Outro');

    el.dispatchEvent(new CustomEvent('menu-toggle', { detail: { open: true } }));
    expect(toggle).toHaveBeenCalledWith(true);
  });

  it('CanvasSection sem callbacks ignora os eventos e remove os ouvintes ao desmontar', () => {
    act(() => {
      root?.render(<CanvasSection />);
    });
    const el = container?.querySelector('canvas-section') as HTMLElement;
    const remove = vi.spyOn(el, 'removeEventListener');

    expect(() => {
      el.dispatchEvent(new CustomEvent('title-change', { detail: { title: 'X' } }));
      el.dispatchEvent(new CustomEvent('menu-toggle', { detail: { open: false } }));
    }).not.toThrow();

    act(() => {
      root?.unmount();
    });
    root = null;
    expect(remove).toHaveBeenCalledWith('title-change', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('menu-toggle', expect.any(Function));
  });

  it('CanvasToolbar repassa os filhos, por exemplo um botão no slot end', () => {
    act(() => {
      root?.render(
        <CanvasToolbar slot="toolbar">
          <button slot="end" id="btn-extra" type="button">
            Extra
          </button>
        </CanvasToolbar>,
      );
    });

    const extra = container?.querySelector('canvas-toolbar > #btn-extra');
    expect(extra?.getAttribute('slot')).toBe('end');
    expect(extra?.textContent).toBe('Extra');
  });

  it('CanvasSection atribui menuItems, user, hideExport e hideShare como propriedades do elemento', () => {
    const menuItems = [{ id: 'new', label: 'Novo projeto' }];
    const user = { name: 'Ana Silva', avatarUrl: '/ana.png' };
    act(() => {
      root?.render(<CanvasSection menuItems={menuItems} user={user} hideExport hideShare />);
    });

    const el = container?.querySelector('canvas-section') as HTMLElement & {
      menuItems?: unknown;
      user?: unknown;
      hideExport?: boolean;
      hideShare?: boolean;
    };
    expect(el.menuItems).toBe(menuItems);
    expect(el.user).toBe(user);
    expect(el.hideExport).toBe(true);
    expect(el.hideShare).toBe(true);
    expect(el.hasAttribute('menu-items')).toBe(false);
    expect(el.hasAttribute('user')).toBe(false);
  });

  it('CanvasSection volta aos padrões ao tirar as props novas', () => {
    act(() => {
      root?.render(
        <CanvasSection
          menuItems={[{ id: 'a', label: 'A' }]}
          user={{ name: 'Ana' }}
          hideExport
          hideShare
        />,
      );
    });
    const el = container?.querySelector('canvas-section') as HTMLElement & {
      menuItems?: unknown;
      user?: unknown;
      hideExport?: boolean;
      hideShare?: boolean;
    };

    act(() => {
      root?.render(<CanvasSection />);
    });

    expect(el.menuItems).toEqual([]);
    expect(el.user).toBeUndefined();
    expect(el.hideExport).toBe(false);
    expect(el.hideShare).toBe(false);
  });

  it('CanvasSection repassa menu-select, export-request, share-request e avatar-click com os callbacks mais recentes', () => {
    const first = {
      onMenuSelect: vi.fn(),
      onExportRequest: vi.fn(),
      onShareRequest: vi.fn(),
      onAvatarClick: vi.fn(),
    };
    const second = {
      onMenuSelect: vi.fn(),
      onExportRequest: vi.fn(),
      onShareRequest: vi.fn(),
      onAvatarClick: vi.fn(),
    };
    act(() => {
      root?.render(<CanvasSection {...first} />);
    });
    const el = container?.querySelector('canvas-section') as HTMLElement;
    const add = vi.spyOn(el, 'addEventListener');

    el.dispatchEvent(new CustomEvent('menu-select', { detail: { id: 'open' } }));
    el.dispatchEvent(new CustomEvent('export-request', { detail: { format: 'svg' } }));
    el.dispatchEvent(new CustomEvent('share-request', { detail: {} }));
    el.dispatchEvent(new CustomEvent('avatar-click', { detail: {} }));
    expect(first.onMenuSelect).toHaveBeenCalledWith('open');
    expect(first.onExportRequest).toHaveBeenCalledWith('svg');
    expect(first.onShareRequest).toHaveBeenCalledTimes(1);
    expect(first.onAvatarClick).toHaveBeenCalledTimes(1);

    act(() => {
      root?.render(<CanvasSection {...second} />);
    });
    el.dispatchEvent(new CustomEvent('menu-select', { detail: { id: 'about' } }));
    el.dispatchEvent(new CustomEvent('export-request', { detail: { format: 'png' } }));
    el.dispatchEvent(new CustomEvent('share-request', { detail: {} }));
    el.dispatchEvent(new CustomEvent('avatar-click', { detail: {} }));

    expect(add).not.toHaveBeenCalled();
    expect(first.onMenuSelect).toHaveBeenCalledTimes(1);
    expect(second.onMenuSelect).toHaveBeenCalledWith('about');
    expect(second.onExportRequest).toHaveBeenCalledWith('png');
    expect(second.onShareRequest).toHaveBeenCalledTimes(1);
    expect(second.onAvatarClick).toHaveBeenCalledTimes(1);
  });

  it('CanvasSection passa sharing ao elemento e volta a off ao tirar a prop', () => {
    act(() => {
      root?.render(<CanvasSection sharing="connecting" />);
    });
    const el = container?.querySelector('canvas-section') as HTMLElement & { sharing?: string };
    expect(el.sharing).toBe('connecting');

    act(() => {
      root?.render(<CanvasSection sharing="on" />);
    });
    expect(el.sharing).toBe('on');

    act(() => {
      root?.render(<CanvasSection />);
    });
    expect(el.sharing).toBe('off');
  });

  it('CanvasSection repassa o detalhe do share-request e chama onShareStop uma vez por evento', () => {
    const onShareRequest = vi.fn();
    const onShareStop = vi.fn();
    act(() => {
      root?.render(<CanvasSection onShareRequest={onShareRequest} onShareStop={onShareStop} />);
    });
    const el = container?.querySelector('canvas-section') as HTMLElement;
    const remove = vi.spyOn(el, 'removeEventListener');

    el.dispatchEvent(new CustomEvent('share-request', { detail: { sharing: 'off' } }));
    el.dispatchEvent(new CustomEvent('share-stop', { detail: {} }));
    expect(onShareRequest).toHaveBeenCalledWith({ sharing: 'off' });
    expect(onShareStop).toHaveBeenCalledTimes(1);

    act(() => {
      root?.unmount();
    });
    root = null;
    expect(remove).toHaveBeenCalledWith('share-stop', expect.any(Function));
    el.dispatchEvent(new CustomEvent('share-stop', { detail: {} }));
    expect(onShareStop).toHaveBeenCalledTimes(1);
  });

  it('CanvasSection aceita onShareRequest sem argumentos e ignora share-stop sem callback', () => {
    const legacy: () => void = vi.fn();
    act(() => {
      root?.render(<CanvasSection onShareRequest={legacy} />);
    });
    const el = container?.querySelector('canvas-section') as HTMLElement;

    expect(() => {
      el.dispatchEvent(new CustomEvent('share-request', { detail: { sharing: 'on' } }));
      el.dispatchEvent(new CustomEvent('share-stop', { detail: {} }));
    }).not.toThrow();
    expect(legacy).toHaveBeenCalledTimes(1);
  });

  it('CanvasSection passa participants e hideParticipants ao elemento e volta ao padrão sem eles', () => {
    const participants = [
      { id: 'eu', name: 'Pessoa', color: '#2563eb', self: true },
      { id: 'a', name: 'Ana', color: '#dc2626' },
    ];
    act(() => {
      root?.render(<CanvasSection participants={participants} hideParticipants />);
    });
    const el = container?.querySelector('canvas-section') as HTMLElement & {
      participants?: unknown;
      hideParticipants?: boolean;
    };
    expect(el.participants).toBe(participants);
    expect(el.hideParticipants).toBe(true);

    const next = [...participants, { id: 'b', name: 'Caio', color: '#16a34a' }];
    act(() => {
      root?.render(<CanvasSection participants={next} />);
    });
    expect(el.participants).toBe(next);
    expect(el.hideParticipants).toBe(false);

    act(() => {
      root?.render(<CanvasSection />);
    });
    expect(el.participants).toEqual([]);
  });

  it('CanvasSection passa following ao elemento e repassa follow-change a onFollowChange', () => {
    const onFollowChange = vi.fn();
    act(() => {
      root?.render(<CanvasSection following="a" onFollowChange={onFollowChange} />);
    });
    const el = container?.querySelector('canvas-section') as HTMLElement & { following?: unknown };
    expect(el.following).toBe('a');

    el.dispatchEvent(new CustomEvent('follow-change', { detail: { sessionId: 'b' } }));
    el.dispatchEvent(new CustomEvent('follow-change', { detail: { sessionId: null } }));
    expect(onFollowChange).toHaveBeenNthCalledWith(1, 'b');
    expect(onFollowChange).toHaveBeenNthCalledWith(2, null);

    act(() => {
      root?.render(<CanvasSection />);
    });
    expect(el.following).toBeNull();
    act(() => {
      root?.unmount();
    });
    root = null;
    el.dispatchEvent(new CustomEvent('follow-change', { detail: { sessionId: 'c' } }));
    expect(onFollowChange).toHaveBeenCalledTimes(2);
  });

  it('CanvasSection sem os callbacks novos ignora os eventos e remove os ouvintes ao desmontar', () => {
    act(() => {
      root?.render(<CanvasSection />);
    });
    const el = container?.querySelector('canvas-section') as HTMLElement;
    const remove = vi.spyOn(el, 'removeEventListener');

    expect(() => {
      el.dispatchEvent(new CustomEvent('menu-select', { detail: { id: 'x' } }));
      el.dispatchEvent(new CustomEvent('export-request', { detail: { format: 'svg' } }));
      el.dispatchEvent(new CustomEvent('share-request', { detail: {} }));
      el.dispatchEvent(new CustomEvent('avatar-click', { detail: {} }));
    }).not.toThrow();

    act(() => {
      root?.unmount();
    });
    root = null;
    for (const type of ['menu-select', 'export-request', 'share-request', 'avatar-click']) {
      expect(remove).toHaveBeenCalledWith(type, expect.any(Function));
    }
  });

  it('CanvasSelectionMenu renderiza <canvas-selection-menu> com section, canvas e o painel no slot', () => {
    const section = createCanvasSection();
    const canvas = fakeSelectionCanvas();
    act(() => {
      root?.render(
        <CanvasSelectionMenu slot="overlay" section={section} canvas={canvas} className="meu-menu">
          <CanvasProperties slot="properties" />
        </CanvasSelectionMenu>,
      );
    });

    const el = container?.querySelector('canvas-selection-menu') as HTMLElement & {
      section?: unknown;
      canvas?: unknown;
    };
    expect(el).not.toBeNull();
    expect(el.section).toBe(section);
    expect(el.canvas).toBe(canvas);
    expect(el.getAttribute('slot')).toBe('overlay');
    expect(el.getAttribute('class')).toContain('meu-menu');
    expect(el.querySelector('canvas-properties')?.getAttribute('slot')).toBe('properties');
  });

  it('CanvasSelectionMenu acompanha a troca de section e de canvas, inclusive para nulo', () => {
    const first = createCanvasSection();
    const second = createCanvasSection();
    const canvas = fakeSelectionCanvas();
    act(() => {
      root?.render(<CanvasSelectionMenu section={first} canvas={canvas} />);
    });
    const el = container?.querySelector('canvas-selection-menu') as HTMLElement & {
      section?: unknown;
      canvas?: unknown;
    };

    act(() => {
      root?.render(<CanvasSelectionMenu section={second} canvas={null} />);
    });

    expect(el.section).toBe(second);
    expect(el.canvas).toBeUndefined();
  });

  it('CanvasToolbar chama onPropertiesPanelToggle com o callback mais recente e solta o ouvinte ao desmontar', () => {
    const first = vi.fn();
    const second = vi.fn();
    act(() => {
      root?.render(<CanvasToolbar onPropertiesPanelToggle={first} />);
    });
    const el = container?.querySelector('canvas-toolbar') as HTMLElement;
    const remove = vi.spyOn(el, 'removeEventListener');

    el.dispatchEvent(new CustomEvent('properties-panel-toggle', { detail: { open: true } }));
    expect(first).toHaveBeenCalledWith(true);

    act(() => {
      root?.render(<CanvasToolbar onPropertiesPanelToggle={second} />);
    });
    el.dispatchEvent(new CustomEvent('properties-panel-toggle', { detail: { open: false } }));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(false);

    act(() => {
      root?.unmount();
    });
    root = null;
    expect(remove).toHaveBeenCalledWith('properties-panel-toggle', expect.any(Function));
  });

  it('CanvasToolbar sem callback ignora o evento de propriedades', () => {
    act(() => {
      root?.render(<CanvasToolbar />);
    });
    const el = container?.querySelector('canvas-toolbar') as HTMLElement;

    expect(() =>
      el.dispatchEvent(new CustomEvent('properties-panel-toggle', { detail: { open: true } })),
    ).not.toThrow();
  });

  it('CanvasToolbar repassa propertiesOpen ao elemento', () => {
    act(() => {
      root?.render(<CanvasToolbar propertiesOpen />);
    });
    const el = container?.querySelector('canvas-toolbar') as HTMLElement & {
      propertiesOpen: boolean;
    };
    expect(el.propertiesOpen).toBe(true);

    act(() => {
      root?.render(<CanvasToolbar propertiesOpen={false} />);
    });
    expect(el.propertiesOpen).toBe(false);
  });

  it('CanvasToolbar repassa os eventos de nota, caneta e borracha com o callback mais recente', () => {
    const sticky = vi.fn();
    const pen = vi.fn();
    const eraser = vi.fn();
    const nextEraser = vi.fn();
    act(() => {
      root?.render(
        <CanvasToolbar
          onStickyColorChange={sticky}
          onPenSettingsChange={pen}
          onEraserSizeChange={eraser}
        />,
      );
    });
    const el = container?.querySelector('canvas-toolbar') as HTMLElement;
    const remove = vi.spyOn(el, 'removeEventListener');

    el.dispatchEvent(new CustomEvent('sticky-color-change', { detail: { color: '#fff' } }));
    el.dispatchEvent(
      new CustomEvent('pen-settings-change', { detail: { settings: { kind: 'pen' } } }),
    );
    el.dispatchEvent(new CustomEvent('eraser-size-change', { detail: { size: 'thick' } }));
    expect(sticky).toHaveBeenCalledWith({ color: '#fff' });
    expect(pen).toHaveBeenCalledWith({ settings: { kind: 'pen' } });
    expect(eraser).toHaveBeenCalledWith({ size: 'thick' });

    act(() => {
      root?.render(<CanvasToolbar onEraserSizeChange={nextEraser} />);
    });
    el.dispatchEvent(new CustomEvent('eraser-size-change', { detail: { size: 'thin' } }));
    expect(eraser).toHaveBeenCalledTimes(1);
    expect(nextEraser).toHaveBeenCalledWith({ size: 'thin' });
    // Sem os outros callbacks, os eventos não quebram.
    expect(() =>
      el.dispatchEvent(new CustomEvent('sticky-color-change', { detail: { color: '#000' } })),
    ).not.toThrow();

    act(() => {
      root?.unmount();
    });
    root = null;
    for (const type of ['sticky-color-change', 'pen-settings-change', 'eraser-size-change']) {
      expect(remove).toHaveBeenCalledWith(type, expect.any(Function));
    }
  });
});
