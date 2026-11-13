import { createCanvasSection } from '@canvash/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CanvasToolbarElement } from './canvas-toolbar.js';

beforeAll(() => {
  if (!customElements.get('canvas-toolbar')) {
    customElements.define('canvas-toolbar', CanvasToolbarElement);
  }
});

afterEach(() => {
  document.body.innerHTML = '';
});

const separator = (toolbar: CanvasToolbarElement) =>
  toolbar.shadowRoot?.querySelector<HTMLElement>('[part~="end-separator"]') ?? null;

/** O slotchange chega depois do primeiro render: espera ele e o render que ele pede. */
async function settled(toolbar: CanvasToolbarElement): Promise<void> {
  await toolbar.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await toolbar.updateComplete;
}

function mount(options: { end?: boolean; vertical?: boolean } = {}): CanvasToolbarElement {
  const toolbar = document.createElement('canvas-toolbar') as CanvasToolbarElement;
  if (options.vertical) toolbar.orientation = 'vertical';
  if (options.end) {
    const button = document.createElement('button');
    button.slot = 'end';
    button.textContent = 'Playground';
    toolbar.append(button);
  }
  document.body.append(toolbar);
  return toolbar;
}

describe('<canvas-toolbar> no navegador real: divisor do slot end', () => {
  it('sem conteúdo no slot end não há divisor', async () => {
    const toolbar = mount();
    await settled(toolbar);

    expect(separator(toolbar)).toBeNull();
  });

  it('com um elemento no slot end, o divisor aparece antes dele; ao remover, some', async () => {
    const toolbar = mount({ end: true, vertical: true });
    await settled(toolbar);

    const divider = separator(toolbar);
    expect(divider?.getAttribute('role')).toBe('separator');
    expect(divider?.getAttribute('aria-orientation')).toBe('vertical');
    const slot = toolbar.shadowRoot?.querySelector('slot[name="end"]');
    expect(divider?.nextElementSibling).toBe(slot);

    toolbar.querySelector('[slot="end"]')?.remove();
    await settled(toolbar);
    expect(separator(toolbar)).toBeNull();
  });

  it('um elemento adicionado depois faz o divisor aparecer', async () => {
    const toolbar = mount();
    await settled(toolbar);

    const button = document.createElement('button');
    button.slot = 'end';
    toolbar.append(button);
    await settled(toolbar);

    expect(separator(toolbar)).not.toBeNull();
  });

  it('com compact-readonly em modo leitura, o slot end e o divisor continuam visíveis', async () => {
    const section = createCanvasSection();
    section.setReadOnly(true);
    const toolbar = mount({ end: true });
    toolbar.compactReadonly = true;
    toolbar.section = section;
    await settled(toolbar);

    expect(separator(toolbar)).not.toBeNull();
    const slotted = toolbar.querySelector<HTMLElement>('[slot="end"]');
    expect(slotted?.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(toolbar.shadowRoot?.querySelector('[data-tool="rectangle"]')).toBeNull();
  });
});
