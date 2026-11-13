import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CanvasSelectionMenuElement } from './canvas-selection-menu.js';

// Desagrupar dois grupos com o foco no botão, no navegador: o foco vai a Agrupar sem um segundo
// desenho agendado de dentro de `updated()` (o `change-in-update` do Lit, US-GA.7).

if (!customElements.get('canvas-selection-menu-groups-test')) {
  customElements.define('canvas-selection-menu-groups-test', CanvasSelectionMenuElement);
}

const rectangle = (id: string, x: number) => ({
  type: 'shape.create' as const,
  shape: {
    id,
    type: 'rectangle' as const,
    x,
    y: 200,
    width: 50,
    height: 50,
    rotation: 0,
    style: { fill: '#000000', stroke: null, strokeWidth: 0, opacity: 1 },
  },
});

interface UpdatedHook {
  updated(changed: Map<string, unknown>): void;
}

describe('<canvas-selection-menu>: foco depois de Desagrupar (navegador)', () => {
  let host: HTMLElement;
  let el: CanvasSelectionMenuElement;
  let section: CanvasSectionApi;

  const shadow = () => el.shadowRoot!;
  const buttons = () => [...shadow().querySelectorAll<HTMLElement>('.menu button')];
  const button = (action: string) =>
    shadow().querySelector<HTMLElement>(`.menu [data-action="${action}"]`)!;
  const settle = async () => {
    await el.updateComplete;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await el.updateComplete;
  };

  beforeEach(async () => {
    host = document.createElement('div');
    host.style.cssText = 'position:relative;width:1000px;height:700px';
    host.tabIndex = -1;
    document.body.append(host);

    section = createCanvasSection();
    section.dispatch(rectangle('a', 100));
    section.dispatch(rectangle('b', 200));
    section.dispatch(rectangle('c', 400));
    section.dispatch(rectangle('d', 500));
    section.dispatch({ type: 'group.create', id: 'g1', childIds: ['a', 'b'] });
    section.dispatch({ type: 'group.create', id: 'g2', childIds: ['c', 'd'] });
    el = document.createElement('canvas-selection-menu-groups-test') as CanvasSelectionMenuElement;
    host.append(el);
    el.section = section;
    // O canvas é um elemento de verdade (o menu o observa); `host` ganha o que o menu lê dele.
    Object.assign(host, { interactionState: 'idle' });
    el.canvas = host as unknown as CanvasSelectionMenuElement['canvas'];
    section.setSelection(['g1', 'g2']);
    await settle();
    await settle();
  });

  afterEach(() => {
    host.remove();
  });

  it('dois grupos: Desagrupar leva o foco a Agrupar sem reagendar o desenho em updated()', async () => {
    expect(buttons().map((b) => b.dataset['action'])).toEqual([
      'bring-to-front',
      'send-to-back',
      'group',
      'ungroup',
      'delete',
    ]);
    // A condição do aviso do Lit: ao fim de `updated()`, já há outro desenho pendente.
    const reentrant: Map<string, unknown>[] = [];
    const hook = el as unknown as UpdatedHook;
    const original = hook.updated.bind(el);
    hook.updated = (changed) => {
      original(changed);
      if (el.isUpdatePending) reentrant.push(changed);
    };

    // Como no ponteiro: o foco (mousedown) e o clique chegam em tarefas separadas.
    button('ungroup').focus();
    await el.updateComplete;
    button('ungroup').click();
    await settle();
    await settle();

    expect(section.getSnapshot().document.nodes['g1']).toBeUndefined();
    expect(section.getSnapshot().document.nodes['g2']).toBeUndefined();
    expect(buttons().map((b) => b.dataset['action'])).toEqual([
      'bring-to-front',
      'send-to-back',
      'group',
      'delete',
    ]);
    expect(shadow().activeElement).toBe(button('group'));
    expect(button('group').getAttribute('tabindex')).toBe('0');
    expect(reentrant).toEqual([]);
  });
});
