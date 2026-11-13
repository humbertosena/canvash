import { createCanvasSection, fitStickyFontSize, type StickyNode } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextEditorAdapter } from './text-editor.js';

describe('TextEditorAdapter editando nota adesiva (navegador)', () => {
  let container: HTMLDivElement;
  let section: ReturnType<typeof createCanvasSection>;
  let editor: TextEditorAdapter;
  const onCommit = vi.fn();
  const onCancel = vi.fn();

  const note = (overrides: Partial<StickyNode> = {}): StickyNode => ({
    id: 'note-1',
    type: 'sticky',
    x: 100,
    y: 80,
    width: 200,
    height: 150,
    rotation: 0,
    text: 'Olá',
    fontSize: 40,
    fontSizeMode: 'auto',
    fontFamily: 'sans-serif',
    fontWeight: 'normal',
    textAlign: 'left',
    lineHeight: 1.25,
    visible: true,
    locked: false,
    style: { fill: '#fff59d', stroke: null, strokeWidth: 0, opacity: 1 },
    ...overrides,
  });

  beforeEach(() => {
    container = document.createElement('div');
    container.style.position = 'relative';
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);
    section = createCanvasSection();
    onCommit.mockClear();
    onCancel.mockClear();
    editor = new TextEditorAdapter({ container, section, onCommit, onCancel });
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  it('o editor ganha o fundo da nota, a cor derivada e a margem interna', () => {
    editor.start(note(), false);
    const textarea = editor.getTextArea()!;
    expect(textarea.style.background).toContain('rgb(255, 245, 157)');
    expect(textarea.style.color).toBe('rgb(31, 41, 55)');
    expect(textarea.style.padding).toBe('12px');
    expect(textarea.style.width).toBe('200px');
    expect(textarea.style.height).toBe('150px');
    expect(textarea.value).toBe('Olá');
  });

  it('o texto fica claro sobre um fundo escuro', () => {
    editor.start(note({ style: { fill: '#4c1d95', stroke: null, strokeWidth: 0, opacity: 1 } }));
    expect(editor.getTextArea()!.style.color).toBe('rgb(255, 255, 255)');
  });

  it('acompanha o zoom e o pan do canvas, também na margem', () => {
    editor.start(note(), false);
    const textarea = editor.getTextArea()!;
    section.setViewport({ x: 30, y: 10, zoom: 2 });
    expect(textarea.style.width).toBe('400px');
    expect(textarea.style.height).toBe('300px');
    expect(textarea.style.padding).toBe('24px');
    expect(textarea.style.transform).toContain('translate(');
  });

  it('no modo automático, digitar refaz o tamanho da fonte do editor', () => {
    const base = note({ text: '' });
    editor.start(base, true);
    const textarea = editor.getTextArea()!;
    const empty = parseFloat(textarea.style.fontSize);
    expect(empty).toBe(fitStickyFontSize(base));

    textarea.value = 'Uma frase comprida o bastante para obrigar a fonte a encolher na nota';
    textarea.dispatchEvent(new Event('input'));
    const typed = parseFloat(textarea.style.fontSize);
    expect(typed).toBeLessThan(empty);
    expect(typed).toBe(fitStickyFontSize({ ...base, text: textarea.value }));

    textarea.value = '';
    textarea.dispatchEvent(new Event('input'));
    expect(parseFloat(textarea.style.fontSize)).toBe(empty);
  });

  it('no modo fixo a fonte do editor é a da nota, e o zoom a escala', () => {
    editor.start(note({ fontSizeMode: 'fixed', fontSize: 28 }), false);
    const textarea = editor.getTextArea()!;
    textarea.value = 'Uma frase comprida o bastante para obrigar a fonte a encolher na nota';
    textarea.dispatchEvent(new Event('input'));
    expect(textarea.style.fontSize).toBe('28px');
    section.setViewport({ x: 0, y: 0, zoom: 2 });
    expect(textarea.style.fontSize).toBe('56px');
  });

  it('a altura da nota é fixa: digitar não a faz crescer', () => {
    editor.start(note({ fontSizeMode: 'fixed', fontSize: 40 }), false);
    const textarea = editor.getTextArea()!;
    textarea.value = 'linha\n'.repeat(30);
    textarea.dispatchEvent(new Event('input'));
    expect(textarea.style.height).toBe('150px');
  });

  it('Ctrl+Enter confirma, Esc cancela e Enter só quebra a linha', () => {
    editor.start(note(), true);
    const textarea = editor.getTextArea()!;
    textarea.value = 'novo texto';

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    textarea.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(editor.isActive()).toBe(true);

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(onCommit).toHaveBeenCalledWith('note-1', 'novo texto', true);
    expect(editor.isActive()).toBe(false);

    editor.start(note(), false);
    editor
      .getTextArea()!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    expect(onCancel).toHaveBeenCalledWith('note-1', false);
    expect(editor.isActive()).toBe(false);
  });

  it('o blur confirma a edição', () => {
    editor.start(note(), false);
    editor.getTextArea()!.value = 'por blur';
    editor.getTextArea()!.dispatchEvent(new Event('blur'));
    expect(onCommit).toHaveBeenCalledWith('note-1', 'por blur', false);
  });

  it('durante a composição do IME, Esc e Ctrl+Enter não encerram a sessão', () => {
    editor.start(note(), false);
    const textarea = editor.getTextArea()!;
    textarea.dispatchEvent(new Event('compositionstart'));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );
    expect(editor.isActive()).toBe(true);

    textarea.dispatchEvent(new Event('compositionend'));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(editor.isActive()).toBe(false);
  });

  it('texto confirmado não é interpretado como HTML', () => {
    editor.start(note(), true);
    editor.getTextArea()!.value = 'a<img src=x onerror=alert(1)>b';
    editor.commit();
    expect(onCommit).toHaveBeenCalledWith('note-1', 'ab', true);
    expect(container.querySelector('img')).toBeNull();
  });
});
