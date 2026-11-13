import { describe, expect, it } from 'vitest';
import { CanvasSurfaceElement } from './canvas-surface.js';
import { CanvasLayersElement } from './canvas-layers.js';
import { CanvasPropertiesElement } from './canvas-properties.js';
import { CanvasToolbarElement } from './canvas-toolbar.js';

describe('Classes base dos elementos', () => {
  it('instancia e renderiza CanvasSurfaceElement', () => {
    const el = new CanvasSurfaceElement();
    expect(el).toBeInstanceOf(CanvasSurfaceElement);
    expect(el.section).toBeUndefined();
    const template = el.render();
    expect(template).toBeDefined();
  });

  it('instancia e renderiza CanvasToolbarElement', () => {
    const el = new CanvasToolbarElement();
    expect(el).toBeInstanceOf(CanvasToolbarElement);
    expect(el.section).toBeUndefined();
    const template = el.render();
    expect(template).toBeDefined();
  });

  it('instancia e renderiza CanvasPropertiesElement', () => {
    const el = new CanvasPropertiesElement();
    expect(el).toBeInstanceOf(CanvasPropertiesElement);
    expect(el.section).toBeUndefined();
    const template = el.render();
    expect(template).toBeDefined();
  });

  it('instancia e renderiza CanvasLayersElement', () => {
    const el = new CanvasLayersElement();
    expect(el).toBeInstanceOf(CanvasLayersElement);
    expect(el.section).toBeUndefined();
    const template = el.render();
    expect(template).toBeDefined();
  });
});
