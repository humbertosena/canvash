import { createCanvasSection, type BoardNode } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardTitleEditor } from './board-title-editor.js';

// O <input> sobre a faixa do título do board (spec boards, US-BD.6 e US-BD.17).

describe('BoardTitleEditor (navegador)', () => {
  let container: HTMLDivElement;
  let section: ReturnType<typeof createCanvasSection>;
  let editor: BoardTitleEditor;
  const onCommit = vi.fn();
  const onCancel = vi.fn();

  const board: BoardNode = {
    id: 'b',
    type: 'board',
    x: 100,
    y: 200,
    width: 300,
    height: 150,
    visible: true,
    locked: false,
    title: 'Fluxo',
    style: { fill: '#ffffff', fillOpacity: 0.4, stroke: '#9ca3af' },
    childIds: [],
  };

  beforeEach(() => {
    container = document.createElement('div');
    container.style.position = 'relative';
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);
    section = createCanvasSection();
    onCommit.mockClear();
    onCancel.mockClear();
    editor = new BoardTitleEditor({
      container,
      section,
      label: 'Título do board',
      onCommit,
      onCancel,
    });
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  const start = () => {
    editor.start(board);
    return editor.getInput()!;
  };

  it('cobre a faixa inteira do título, com o texto selecionado, rótulo e limite de 200', () => {
    const input = start();

    expect(input.tagName).toBe('INPUT');
    expect(input.value).toBe('Fluxo');
    expect(input.getAttribute('aria-label')).toBe('Título do board');
    expect(input.maxLength).toBe(200);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
    expect(document.activeElement).toBe(input);
    expect(input.style.width).toBe('300px');
    expect(input.style.height).toBe('24px');
    expect(input.style.transform).toBe('translate(100px, 176px)');
    expect(input.style.background).toContain('--canvash-canvas-bg');
  });

  it('acompanha o zoom e o pan', () => {
    const input = start();

    section.setViewport({ x: 30, y: 10, zoom: 2 });

    expect(input.style.width).toBe('600px');
    expect(input.style.height).toBe('48px');
    expect(input.style.transform).toBe('translate(230px, 362px)');
    expect(input.style.fontSize).toBe('28px');
  });

  it('Enter confirma com o texto digitado', () => {
    const input = start();
    input.value = 'Jornada';

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onCommit).toHaveBeenCalledWith('b', 'Jornada');
    expect(editor.isActive()).toBe(false);
    expect(container.querySelector('input')).toBeNull();
  });

  it('Esc cancela sem confirmar', () => {
    const input = start();
    input.value = 'Jornada';

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(onCancel).toHaveBeenCalledWith('b');
    expect(onCommit).not.toHaveBeenCalled();
    expect(editor.isActive()).toBe(false);
  });

  it('perder o foco confirma', () => {
    const input = start();
    input.value = 'Jornada';

    input.blur();

    expect(onCommit).toHaveBeenCalledWith('b', 'Jornada');
  });

  it('durante a composição de IME o Enter não confirma', () => {
    const input = start();

    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onCommit).not.toHaveBeenCalled();
    expect(editor.isActive()).toBe(true);
  });

  it('as teclas do editor não chegam aos atalhos do canvas', () => {
    const input = start();
    const onKey = vi.fn();
    container.addEventListener('keydown', onKey);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

    expect(onKey).not.toHaveBeenCalled();
  });

  it('o editor fica fora do documento', () => {
    start();

    expect(Object.keys(section.getSnapshot().document.nodes)).toEqual([]);
  });

  it('destroy fecha o editor aberto como cancelamento', () => {
    start();

    editor.destroy();

    expect(onCancel).toHaveBeenCalledWith('b');
    expect(container.querySelector('input')).toBeNull();
  });
});
