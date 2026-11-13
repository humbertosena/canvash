import { beforeEach, describe, expect, it } from 'vitest';
import { expectTypeOf } from 'vitest';
import { createCanvasSection, type CanvasSectionApi, type TextNode } from '@canvash/core';
import { attachInteractions, type AttachInteractionsOptions } from './index.js';

describe('attachInteractions (browser)', () => {
  let container: HTMLDivElement;
  let section: ReturnType<typeof createCanvasSection>;

  const sampleTextNode: TextNode = {
    id: 'text-test-1',
    type: 'text',
    x: 50,
    y: 50,
    width: 200,
    height: 40,
    rotation: 0,
    text: 'Texto inicial',
    fontSize: 16,
    fontSizeMode: 'auto',
    fontFamily: 'sans-serif',
    fontWeight: 'normal',
    textAlign: 'left',
    lineHeight: 1.25,
    visible: true,
    locked: false,
    style: {
      fill: '#111827',
      stroke: null,
      strokeWidth: 0,
      opacity: 1,
    },
  };

  it('AttachInteractionsOptions recebe a instância em section e não tem a chave antiga', () => {
    type LegacyKey = `${'bo'}${'ard'}`;

    expectTypeOf<AttachInteractionsOptions['section']>().toEqualTypeOf<CanvasSectionApi>();
    expectTypeOf<
      LegacyKey extends keyof AttachInteractionsOptions ? true : false
    >().toEqualTypeOf<false>();
  });

  beforeEach(() => {
    container = document.createElement('div');
    container.style.position = 'relative';
    container.style.width = '600px';
    container.style.height = '400px';
    document.body.appendChild(container);

    section = createCanvasSection();
    const res = section.dispatch({
      type: 'shape.create',
      shape: sampleTextNode,
    });
    expect(res.ok).toBe(true);
  });

  it('anexa e expõe getState, getData, getTextEditor, cancel e destroy', () => {
    const handle = attachInteractions({ section, element: container });
    expect(handle.getState()).toBe('idle');
    expect(handle.getData()).toEqual({ name: 'idle' });
    expect(handle.getTextEditor?.()).toBeDefined();

    handle.cancel();
    expect(handle.getState()).toBe('idle');

    handle.destroy();
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('abre textarea em duplo clique e confirma alteração atualizando o canvas', () => {
    const handle = attachInteractions({ section, element: container });
    const rect = container.getBoundingClientRect();

    // Simula duplo clique dentro do retângulo do texto (50..250, 50..90)
    container.dispatchEvent(
      new MouseEvent('dblclick', {
        clientX: rect.left + 70,
        clientY: rect.top + 70,
        button: 0,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('editing-text');
    const editor = handle.getTextEditor?.();
    expect(editor?.isActive()).toBe(true);

    const textarea = editor?.getTextArea();
    expect(textarea).not.toBeNull();
    expect(textarea?.value).toBe('Texto inicial');

    textarea!.value = 'Texto alterado com sucesso';
    textarea!.dispatchEvent(new FocusEvent('blur'));

    expect(handle.getState()).toBe('idle');
    expect(editor?.isActive()).toBe(false);

    const updatedNode = section.getSnapshot().document.nodes['text-test-1'] as TextNode;
    expect(updatedNode.text).toBe('Texto alterado com sucesso');

    handle.destroy();
  });

  it('cancela edição via Escape restaurando texto original', () => {
    const handle = attachInteractions({ section, element: container });
    const rect = container.getBoundingClientRect();

    container.dispatchEvent(
      new MouseEvent('dblclick', {
        clientX: rect.left + 70,
        clientY: rect.top + 70,
        button: 0,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('editing-text');
    const editor = handle.getTextEditor?.();
    const textarea = editor?.getTextArea();
    expect(textarea).not.toBeNull();
    textarea!.value = 'Não deve persistir';
    textarea!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(handle.getState()).toBe('idle');
    expect(editor?.isActive()).toBe(false);

    const node = section.getSnapshot().document.nodes['text-test-1'] as TextNode;
    expect(node.text).toBe('Texto inicial');

    handle.destroy();
  });

  it('handle.cancel() durante edição encerra sessão do textEditor', () => {
    const handle = attachInteractions({ section, element: container });
    const rect = container.getBoundingClientRect();

    container.dispatchEvent(
      new MouseEvent('dblclick', {
        clientX: rect.left + 70,
        clientY: rect.top + 70,
        button: 0,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('editing-text');
    handle.cancel();
    expect(handle.getState()).toBe('idle');
    expect(handle.getTextEditor?.()?.isActive()).toBe(false);

    handle.destroy();
  });
});
