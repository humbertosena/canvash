import { createCanvasSection, type CanvasSectionApi, type CanvasPeer } from '@canvash/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CanvasLayersElement } from './canvas-layers.js';
import { CanvasPropertiesElement } from './canvas-properties.js';

beforeAll(() => {
  if (!customElements.get('canvas-layers'))
    customElements.define('canvas-layers', CanvasLayersElement);
  if (!customElements.get('canvas-properties')) {
    customElements.define('canvas-properties', CanvasPropertiesElement);
  }
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { __xss?: boolean }).__xss;
});

const MARKUP = '<img src=x onerror="window.__xss = true"><b>Ana</b>';

const holder = (name: string): CanvasPeer => ({
  sessionId: 'outra',
  name,
  color: '#dc2626',
  cursor: null,
  selection: ['a'],
  selectedAt: 1,
  drag: null,
  view: null,
  locks: ['a'],
  followed: false,
});

function sectionWithNode(): CanvasSectionApi {
  const section = createCanvasSection();
  section.dispatch({
    type: 'shape.create',
    shape: {
      id: 'a',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      style: { fill: '#ffffff', stroke: null, strokeWidth: 1, opacity: 1 },
    },
  });
  return section;
}

describe('painéis com nó bloqueado por outro participante (navegador real)', () => {
  it('<canvas-layers>: cadeado na cor do participante, nome como texto e clique que não seleciona', async () => {
    const section = sectionWithNode();
    const layers = document.createElement('canvas-layers') as CanvasLayersElement;
    layers.section = section;
    document.body.append(layers);
    section.setPeers([holder(MARKUP)]);
    await layers.updateComplete;

    const lock = layers.shadowRoot!.querySelector<HTMLElement>('[part~="node-peer-lock"]')!;
    expect(lock).not.toBeNull();
    expect(lock.getAttribute('aria-label')).toBe(`Em edição por ${MARKUP}`);
    expect(getComputedStyle(lock).color).toBe('rgb(220, 38, 38)');
    expect(layers.shadowRoot!.querySelectorAll('img, b')).toHaveLength(0);
    expect((window as unknown as { __xss?: boolean }).__xss).toBeUndefined();

    layers.shadowRoot!.querySelector<HTMLElement>('[data-node-id="a"]')!.click();
    expect(section.getSnapshot().session.selectedIds).toEqual([]);
    const buttons = [...layers.shadowRoot!.querySelectorAll<HTMLButtonElement>('li button')];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });

  it('<canvas-layers>: o cadeado some quando o participante libera o nó', async () => {
    const section = sectionWithNode();
    const layers = document.createElement('canvas-layers') as CanvasLayersElement;
    layers.section = section;
    document.body.append(layers);
    section.setPeers([holder('Ana')]);
    await layers.updateComplete;
    expect(layers.shadowRoot!.querySelector('[part~="node-peer-lock"]')).not.toBeNull();

    section.setPeers([]);
    await layers.updateComplete;

    expect(layers.shadowRoot!.querySelector('[part~="node-peer-lock"]')).toBeNull();
    layers.shadowRoot!.querySelector<HTMLElement>('[data-node-id="a"]')!.click();
    expect(section.getSnapshot().session.selectedIds).toEqual(['a']);
  });

  it('<canvas-properties>: linha de aviso com o nome como texto e todos os campos desabilitados', async () => {
    const section = sectionWithNode();
    section.setSelection(['a']);
    const panel = document.createElement('canvas-properties') as CanvasPropertiesElement;
    panel.section = section;
    document.body.append(panel);
    section.setPeers([holder(MARKUP)]);
    await panel.updateComplete;

    const notice = panel.shadowRoot!.querySelector<HTMLElement>('[part~="peer-lock-notice"]')!;
    expect(notice.textContent?.trim()).toBe(`Em edição por ${MARKUP}`);
    expect(notice.getAttribute('role')).toBe('status');
    expect(panel.shadowRoot!.querySelectorAll('img, b')).toHaveLength(0);
    expect((window as unknown as { __xss?: boolean }).__xss).toBeUndefined();

    const fields = [
      ...panel.shadowRoot!.querySelectorAll<HTMLInputElement>('input, select, button'),
    ];
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((field) => field.disabled)).toBe(true);
  });

  it('<canvas-properties>: sem bloqueio os campos voltam a funcionar', async () => {
    const section = sectionWithNode();
    section.setSelection(['a']);
    const panel = document.createElement('canvas-properties') as CanvasPropertiesElement;
    panel.section = section;
    document.body.append(panel);
    section.setPeers([holder('Ana')]);
    await panel.updateComplete;
    section.setPeers([]);
    await panel.updateComplete;

    expect(panel.shadowRoot!.querySelector('[part~="peer-lock-notice"]')).toBeNull();
    const numeric = panel.shadowRoot!.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(numeric.disabled).toBe(false);
  });
});
