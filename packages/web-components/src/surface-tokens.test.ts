import { describe, expect, it } from 'vitest';
import { CanvasControlsElement } from './canvas-controls.js';
import { CanvasSurfaceElement } from './canvas-surface.js';
import { CanvasLayersElement } from './canvas-layers.js';
import { CanvasPropertiesElement } from './canvas-properties.js';
import { CanvasToolbarElement } from './canvas-toolbar.js';
import { CANVASH_CSS_TOKENS } from './theme.js';

/** CSS estático do componente, para conferir os padrões dos tokens. */
const cssOf = (component: { styles?: unknown }): string => {
  const styles = component.styles;
  const list = Array.isArray(styles) ? styles : [styles];
  return list
    .map((item) => (item as { cssText: string }).cssText)
    .join('\n')
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')');
};

const SURFACE = 'var(--canvash-surface-float, #ebecef)';
const BORDER = 'var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06))';
const TEXT = 'var(--canvash-text-float, #1f1f1f)';
const RADIUS_CARD = 'var(--canvash-radius-card, 16px)';

describe('tokens de superfície das ilhas flutuantes', () => {
  it('CANVASH_CSS_TOKENS lista os tokens novos, sem remover nem renomear os existentes', () => {
    expect(CANVASH_CSS_TOKENS).toMatchObject({
      surfaceFloat: '--canvash-surface-float',
      surfaceFloatBorder: '--canvash-surface-float-border',
      shadowFloat: '--canvash-shadow-float',
      radiusPill: '--canvash-radius-pill',
      radiusCard: '--canvash-radius-card',
      iconSize: '--canvash-icon-size',
      textFloat: '--canvash-text-float',
      fontFloat: '--canvash-font-float',
      accentSelect: '--canvash-accent-select',
      islandMargin: '--canvash-island-margin',
      boardTitleColor: '--canvash-board-title-color',
    });
    expect(CANVASH_CSS_TOKENS).toMatchObject({
      focusRing: '--canvash-focus-ring',
      canvasBg: '--canvash-canvas-bg',
      toolbarBg: '--canvash-toolbar-bg',
      toolbarBorder: '--canvash-toolbar-border',
      toolbarShadow: '--canvash-toolbar-shadow',
      toolbarRadius: '--canvash-toolbar-radius',
      menuBg: '--canvash-menu-bg',
      layersBg: '--canvash-layers-bg',
      propertiesBg: '--canvash-properties-bg',
      propertiesInputBg: '--canvash-properties-input-bg',
    });
  });

  it('toolbar: o token específico vence, depois o de superfície, depois o valor literal', () => {
    const css = cssOf(CanvasToolbarElement);

    expect(css).toContain(`var(--canvash-toolbar-bg, ${SURFACE})`);
    expect(css).toContain(`var(--canvash-toolbar-border, ${BORDER})`);
    expect(css).toContain(`var(--canvash-toolbar-radius, ${RADIUS_CARD})`);
    expect(css).toContain(`var(--canvash-toolbar-color, ${TEXT})`);
    expect(css).toContain('var(--canvash-menu-bg, var(--canvash-surface-float-hover, #d9dbe0))');
  });

  it('toolbar: ferramenta ativa em preto com ícone branco, foco escuro e sem azul', () => {
    const css = cssOf(CanvasToolbarElement);

    expect(css).toContain(`var(--canvash-btn-active-bg, ${TEXT})`);
    expect(css).toContain('var(--canvash-btn-active-color, #ffffff)');
    expect(css).toContain(`var(--canvash-focus-ring, ${TEXT})`);
    // O #3b82f6 que sobra na toolbar é a roda de cores do seletor da caneta, não a interface.
    for (const blue of ['#0284c7', '#e0f2fe', '#bae6fd', 'var(--canvash-focus-ring, #3b82f6)']) {
      expect(css).not.toContain(blue);
    }
  });

  it('camadas: cartão cinza com texto escuro, seleção em tom de cinza e sem azul', () => {
    const css = cssOf(CanvasLayersElement);

    expect(css).toContain(`var(--canvash-layers-bg, ${SURFACE})`);
    expect(css).toContain(`var(--canvash-layers-border, ${BORDER})`);
    expect(css).toContain(`var(--canvash-layers-title-color, ${TEXT})`);
    expect(css).toContain(`var(--canvash-node-selected-color, ${TEXT})`);
    for (const blue of ['#f0f9ff', '#0369a1', '#3b82f6']) {
      expect(css).not.toContain(blue);
    }
  });

  it('propriedades: cartão cinza, campos brancos e foco escuro', () => {
    const css = cssOf(CanvasPropertiesElement);

    expect(css).toContain(`var(--canvash-properties-bg, ${SURFACE})`);
    expect(css).toContain(`var(--canvash-properties-color, ${TEXT})`);
    expect(css).toContain(`var(--canvash-properties-border, ${BORDER})`);
    expect(css).toContain('var(--canvash-input-bg, #ffffff)');
    expect(css).toContain(`var(--canvash-focus-ring, ${TEXT})`);
    expect(css).not.toContain('#3b82f6');
  });

  it('controles do canvas e canvas usam os mesmos padrões de superfície e de foco', () => {
    const controls = cssOf(CanvasControlsElement);
    expect(controls).toContain(`var(--canvash-toolbar-bg, ${SURFACE})`);
    expect(controls).toContain(`var(--canvash-toolbar-radius, ${RADIUS_CARD})`);
    expect(controls).toContain(`var(--canvash-focus-ring, ${TEXT})`);

    expect(cssOf(CanvasSurfaceElement)).toContain(`var(--canvash-focus-ring, ${TEXT})`);
  });
});
