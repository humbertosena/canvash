import { createCanvasSection, type CanvasPeer } from '@canvash/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CanvasSurfaceElement } from './canvas-surface.js';
import type { TextEditSupersededEventDetail } from './events.js';

const holder: CanvasPeer = {
  sessionId: 'outra',
  name: 'Bia',
  color: '#dc2626',
  cursor: null,
  selection: ['txt'],
  selectedAt: 1,
  drag: null,
  view: null,
  locks: ['txt'],
  followed: false,
};

describe('<canvas-surface>: edição de texto superada por outro participante', () => {
  let element: CanvasSurfaceElement | undefined;

  beforeAll(() => {
    if (!customElements.get('canvas-surface')) {
      customElements.define('canvas-surface', CanvasSurfaceElement);
    }
  });

  afterEach(() => {
    element?.remove();
    element = undefined;
  });

  it('emite text-edit-superseded com o buffer e fecha o editor sem gravar', async () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'txt', type: 'text', x: 50, y: 50, width: 200, text: 'Original', fontSize: 16 },
    });
    const el = document.createElement('canvas-surface') as CanvasSurfaceElement;
    el.style.cssText = 'display:block;width:400px;height:300px';
    el.section = section;
    document.body.appendChild(el);
    element = el;
    await el.updateComplete;
    const details: TextEditSupersededEventDetail[] = [];
    el.addEventListener('text-edit-superseded', (event) =>
      details.push((event as CustomEvent<TextEditSupersededEventDetail>).detail),
    );

    const container = el.shadowRoot!.querySelector('.surface-container') as HTMLElement;
    const rect = container.getBoundingClientRect();
    container.dispatchEvent(
      new MouseEvent('dblclick', {
        clientX: rect.left + 60,
        clientY: rect.top + 60,
        button: 0,
        bubbles: true,
      }),
    );
    const textarea = container.querySelector('textarea')!;
    expect(textarea).not.toBeNull();
    textarea.value = 'Meu rascunho';

    section.setPeers([holder]);

    expect(details).toEqual([{ nodeId: 'txt', text: 'Meu rascunho' }]);
    expect(container.querySelector('textarea')).toBeNull();
    expect((section.getSnapshot().document.nodes['txt'] as { text: string }).text).toBe('Original');
  });
});
