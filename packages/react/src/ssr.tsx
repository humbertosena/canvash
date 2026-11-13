import React, { type CSSProperties, type ReactElement } from 'react';
import type { CanvasSectionApi, CanvasSnapshot } from '@canvash/core';
import type {
  CanvasControlsProps,
  CanvasSurfaceProps,
  CanvasSelectionMenuProps,
  CanvasSectionProps,
  CanvasLayersProps,
  CanvasPropertiesProps,
  CanvasToolbarProps,
} from './index.js';

/**
 * Placeholder determinístico para renderização do CanvasSurface no servidor.
 * Não acessa `window` nem `customElements`.
 */
export function CanvasSurface(props: CanvasSurfaceProps): ReactElement {
  const { className, style, ariaLabel = 'Canvash Canvas' } = props;
  const mergedStyle: CSSProperties = {
    display: 'block',
    position: 'relative',
    width: '100%',
    height: '100%',
    minHeight: '200px',
    backgroundColor: 'var(--canvash-bg, #ffffff)',
    ...style,
  };

  return React.createElement('div', {
    className: className ? `canvash-placeholder ${className}` : 'canvash-placeholder',
    style: mergedStyle,
    role: 'region',
    'aria-label': ariaLabel,
    'data-canvash-ssr': 'true',
  });
}

export function CanvasToolbar(props: CanvasToolbarProps): ReactElement {
  const { className, style } = props;
  return React.createElement('div', {
    className: className
      ? `canvash-toolbar-placeholder ${className}`
      : 'canvash-toolbar-placeholder',
    style,
    'data-canvash-ssr': 'true',
  });
}

export function CanvasControls(props: CanvasControlsProps): ReactElement {
  const { className, style } = props;
  return React.createElement('div', {
    className: className
      ? `canvash-controls-placeholder ${className}`
      : 'canvash-controls-placeholder',
    style,
    'data-canvash-ssr': 'true',
  });
}

export function CanvasSelectionMenu(props: CanvasSelectionMenuProps): ReactElement {
  const { className, style } = props;
  return React.createElement('div', {
    className: className
      ? `canvash-selection-menu-placeholder ${className}`
      : 'canvash-selection-menu-placeholder',
    style,
    'data-canvash-ssr': 'true',
  });
}

export function CanvasSection(props: CanvasSectionProps): ReactElement {
  const { className, style, children } = props;
  return React.createElement(
    'div',
    {
      className: className ? `canvash-shell-placeholder ${className}` : 'canvash-shell-placeholder',
      style,
      'data-canvash-ssr': 'true',
    },
    children,
  );
}

export function CanvasLayers(props: CanvasLayersProps): ReactElement {
  const { className, style } = props;
  return React.createElement('div', {
    className: className ? `canvash-layers-placeholder ${className}` : 'canvash-layers-placeholder',
    style,
    'data-canvash-ssr': 'true',
  });
}

export function CanvasProperties(props: CanvasPropertiesProps): ReactElement {
  const { className, style } = props;
  return React.createElement('div', {
    className: className
      ? `canvash-properties-placeholder ${className}`
      : 'canvash-properties-placeholder',
    style,
    'data-canvash-ssr': 'true',
  });
}

/**
 * Hook seguro para SSR: no servidor retorna sempre `null` ou o snapshot inicial se o canvas for fornecido.
 */
export function useCanvasSnapshot(section?: CanvasSectionApi | null): CanvasSnapshot | null {
  return section ? section.getSnapshot() : null;
}
