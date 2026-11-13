import { describe, expect, it } from 'vitest';
import { createCanvasSection } from '@canvash/core';
import {
  CanvasSurface,
  CanvasControls,
  CanvasSelectionMenu,
  CanvasSection,
  CanvasToolbar,
  CanvasLayers,
  CanvasProperties,
  useCanvasSnapshot,
} from './ssr.js';

describe('SSR entry for @canvash/react', () => {
  it('renderiza CanvasSurface sem tocar no DOM', () => {
    const element = CanvasSurface({
      className: 'custom-class',
      style: { opacity: 0.8 },
      ariaLabel: 'SSR Canvas',
    });

    const props = element.props as Record<string, unknown>;
    const style = props['style'] as { opacity?: number } | undefined;
    expect(element.type).toBe('div');
    expect(String(props['className'])).toContain('canvash-placeholder');
    expect(String(props['className'])).toContain('custom-class');
    expect(props['aria-label']).toBe('SSR Canvas');
    expect(props['data-canvash-ssr']).toBe('true');
    expect(style?.opacity).toBe(0.8);
  });

  it('renderiza CanvasSurface com opções padrão', () => {
    const element = CanvasSurface({});
    const props = element.props as Record<string, unknown>;
    expect(props['className']).toBe('canvash-placeholder');
    expect(props['aria-label']).toBe('Canvash Canvas');
  });

  it('renderiza placeholders de painéis', () => {
    const toolbar = CanvasToolbar({ className: 'my-toolbar' });
    const toolbarProps = toolbar.props as Record<string, unknown>;
    expect(String(toolbarProps['className'])).toContain('canvash-toolbar-placeholder');
    expect(toolbarProps['data-canvash-ssr']).toBe('true');

    const layers = CanvasLayers({ className: 'my-layers' });
    const layersProps = layers.props as Record<string, unknown>;
    expect(String(layersProps['className'])).toContain('canvash-layers-placeholder');

    const panelProps = CanvasProperties({ className: 'my-props' });
    const panelPropsProps = panelProps.props as Record<string, unknown>;
    expect(String(panelPropsProps['className'])).toContain('canvash-properties-placeholder');

    const toolbarDefault = CanvasToolbar({});
    const toolbarDefaultProps = toolbarDefault.props as Record<string, unknown>;
    expect(toolbarDefaultProps['className']).toBe('canvash-toolbar-placeholder');

    const layersDefault = CanvasLayers({});
    const layersDefaultProps = layersDefault.props as Record<string, unknown>;
    expect(layersDefaultProps['className']).toBe('canvash-layers-placeholder');

    const propsDefault = CanvasProperties({});
    const propsDefaultProps = propsDefault.props as Record<string, unknown>;
    expect(propsDefaultProps['className']).toBe('canvash-properties-placeholder');
  });

  it('renderiza o placeholder dos controles do canvas sem tocar no DOM', () => {
    const element = CanvasControls({ className: 'my-controls' });
    const props = element.props as Record<string, unknown>;

    expect(element.type).toBe('div');
    expect(String(props['className'])).toContain('canvash-controls-placeholder');
    expect(String(props['className'])).toContain('my-controls');
    expect(props['data-canvash-ssr']).toBe('true');

    const defaults = CanvasControls({}).props as Record<string, unknown>;
    expect(defaults['className']).toBe('canvash-controls-placeholder');
  });

  it('renderiza o placeholder do shell com os filhos, sem tocar no DOM', () => {
    const child = CanvasSurface({});
    const element = CanvasSection({ className: 'meu-shell', children: child });
    const props = element.props as Record<string, unknown>;

    expect(element.type).toBe('div');
    expect(String(props['className'])).toContain('canvash-shell-placeholder');
    expect(String(props['className'])).toContain('meu-shell');
    expect(props['data-canvash-ssr']).toBe('true');
    expect(props['children']).toBe(child);

    const defaults = CanvasSection({}).props as Record<string, unknown>;
    expect(defaults['className']).toBe('canvash-shell-placeholder');
  });

  it('o placeholder do shell ignora menuItems, user, hideExport, hideShare e os callbacks novos', () => {
    const element = CanvasSection({
      menuItems: [{ id: 'new', label: 'Novo' }],
      user: { name: 'Ana' },
      hideExport: true,
      hideShare: true,
      onMenuSelect: () => undefined,
      onExportRequest: () => undefined,
      onShareRequest: () => undefined,
      onAvatarClick: () => undefined,
    });
    const props = element.props as Record<string, unknown>;

    expect(element.type).toBe('div');
    expect(Object.keys(props).sort()).toEqual([
      'children',
      'className',
      'data-canvash-ssr',
      'style',
    ]);
  });

  it('renderiza o placeholder do mini-menu da seleção, sem tocar no DOM', () => {
    const element = CanvasSelectionMenu({ className: 'meu-menu' });
    const props = element.props as Record<string, unknown>;

    expect(element.type).toBe('div');
    expect(String(props['className'])).toContain('canvash-selection-menu-placeholder');
    expect(String(props['className'])).toContain('meu-menu');
    expect(props['data-canvash-ssr']).toBe('true');

    const defaults = CanvasSelectionMenu({}).props as Record<string, unknown>;
    expect(defaults['className']).toBe('canvash-selection-menu-placeholder');
  });

  it('useCanvasSnapshot no SSR devolve snapshot do canvas ou null', () => {
    expect(useCanvasSnapshot(null)).toBeNull();
    expect(useCanvasSnapshot(undefined)).toBeNull();

    const section = createCanvasSection();
    const snap = useCanvasSnapshot(section);
    expect(snap).not.toBeNull();
    expect(snap?.revision).toBe(0);
  });
});
