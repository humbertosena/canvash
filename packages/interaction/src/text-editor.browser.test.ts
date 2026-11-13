import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvasSection, type TextNode } from '@canvash/core';
import { TextEditorAdapter } from './text-editor.js';

describe('TextEditorAdapter (browser)', () => {
  let container: HTMLDivElement;
  let section: ReturnType<typeof createCanvasSection>;
  const sampleNode: TextNode = {
    id: 'text-1',
    type: 'text',
    x: 100,
    y: 80,
    width: 250,
    height: 60,
    rotation: 0,
    text: 'Olá mundo',
    fontSize: 20,
    fontSizeMode: 'auto',
    fontFamily: 'sans-serif',
    fontWeight: 400,
    textAlign: 'left',
    lineHeight: 1.25,
    visible: true,
    locked: false,
    style: {
      fill: '#2563eb',
      stroke: null,
      strokeWidth: 0,
      opacity: 1,
    },
  };

  beforeEach(() => {
    container = document.createElement('div');
    container.style.position = 'relative';
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);
    section = createCanvasSection();
  });

  it('inicia sessão de edição criando textarea com atributos e estilos corretos', () => {
    const editor = new TextEditorAdapter({ container, section });
    editor.start(sampleNode, false);

    expect(editor.isActive()).toBe(true);
    const textarea = editor.getTextArea();
    expect(textarea).not.toBeNull();
    expect(textarea?.value).toBe('Olá mundo');
    expect(textarea?.getAttribute('data-testid')).toBe('canvash-text-editor');
    expect(textarea?.style.position).toBe('absolute');
    expect(textarea?.style.color).toBe('rgb(37, 99, 235)'); // #2563eb

    editor.destroy();
    expect(editor.isActive()).toBe(false);
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('atualiza transform do textarea em resposta a mudanças de viewport', () => {
    const editor = new TextEditorAdapter({ container, section });
    editor.start(sampleNode, false);
    const textarea = editor.getTextArea()!;

    const initialTransform = textarea.style.transform;
    expect(initialTransform).toContain('translate');

    // Pan no viewport
    section.setViewport({ x: 100, y: 50, zoom: 2 });
    const updatedTransform = textarea.style.transform;
    expect(updatedTransform).not.toBe(initialTransform);
    expect(textarea.style.fontSize).toBe('40px'); // 20px * zoom 2

    editor.destroy();
  });

  it('confirma edição via Ctrl+Enter ou Meta+Enter e dispara onCommit', () => {
    const onCommit = vi.fn();
    const editor = new TextEditorAdapter({ container, section, onCommit });
    editor.start(sampleNode, false);
    const textarea = editor.getTextArea()!;

    textarea.value = 'Texto alterado';
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );

    expect(onCommit).toHaveBeenCalledWith('text-1', 'Texto alterado', false);
    expect(editor.isActive()).toBe(false);
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('confirma edição via blur', () => {
    const onCommit = vi.fn();
    const editor = new TextEditorAdapter({ container, section, onCommit });
    editor.start(sampleNode, false);
    const textarea = editor.getTextArea()!;

    textarea.value = 'Texto após blur';
    textarea.dispatchEvent(new FocusEvent('blur'));

    expect(onCommit).toHaveBeenCalledWith('text-1', 'Texto após blur', false);
    expect(editor.isActive()).toBe(false);
  });

  it('cancela edição via Escape e dispara onCancel', () => {
    const onCancel = vi.fn();
    const editor = new TextEditorAdapter({ container, section, onCancel });
    editor.start(sampleNode, false);
    const textarea = editor.getTextArea()!;

    textarea.value = 'Rascunho não salvo';
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(onCancel).toHaveBeenCalledWith('text-1', false);
    expect(editor.isActive()).toBe(false);
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('ignora confirmação e cancelamento durante composição ativa de IME', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const editor = new TextEditorAdapter({ container, section, onCommit, onCancel });
    editor.start(sampleNode, false);
    const textarea = editor.getTextArea()!;

    // Inicia composição IME
    textarea.dispatchEvent(new CompositionEvent('compositionstart'));

    // Tecla Escape durante composição não cancela a sessão
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(editor.isActive()).toBe(true);

    // Tecla Enter com Ctrl durante composição não confirma a sessão
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );
    expect(onCommit).not.toHaveBeenCalled();
    expect(editor.isActive()).toBe(true);

    // Encerra composição IME
    textarea.dispatchEvent(new CompositionEvent('compositionend'));

    // Agora Ctrl+Enter confirma normalmente
    textarea.value = 'Kanji 日本語';
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );
    expect(onCommit).toHaveBeenCalledWith('text-1', 'Kanji 日本語', false);
    expect(editor.isActive()).toBe(false);
  });

  it('sanitiza tags HTML ao confirmar', () => {
    const onCommit = vi.fn();
    const editor = new TextEditorAdapter({ container, section, onCommit });
    editor.start(sampleNode, false);
    const textarea = editor.getTextArea()!;

    textarea.value = '<p>Texto com <b>tags</b> e <a href="#">link</a></p>';
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }),
    );

    expect(onCommit).toHaveBeenCalledWith('text-1', 'Texto com tags e link', false);
  });

  it('iniciar nova sessão enquanto uma estiver ativa comita a anterior', () => {
    const onCommit = vi.fn();
    const editor = new TextEditorAdapter({ container, section, onCommit });
    editor.start(sampleNode, false);
    const textarea = editor.getTextArea()!;
    textarea.value = 'Primeira edição';

    const secondNode = { ...sampleNode, id: 'text-2', text: 'Segundo' };
    editor.start(secondNode, false);

    expect(onCommit).toHaveBeenCalledWith('text-1', 'Primeira edição', false);
    expect(editor.isActive()).toBe(true);
    expect(editor.getTextArea()?.value).toBe('Segundo');

    editor.destroy();
  });

  it('evento input ajusta a altura do textarea dinamicamente', () => {
    const editor = new TextEditorAdapter({ container, section });
    editor.start(sampleNode, false);
    const textarea = editor.getTextArea()!;

    textarea.value = 'Linha 1\nLinha 2\nLinha 3\nLinha 4\nLinha 5';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    expect(textarea.style.height).toBeDefined();
    editor.destroy();
  });

  it('Enter normal não confirma e mantém sessão ativa para quebra de linha', () => {
    const onCommit = vi.fn();
    const editor = new TextEditorAdapter({ container, section, onCommit });
    editor.start(sampleNode, false);
    const textarea = editor.getTextArea()!;

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(editor.isActive()).toBe(true);

    editor.destroy();
  });

  it('operações no-op quando inativo ou destruído não disparam erros', () => {
    const editor = new TextEditorAdapter({ container, section });
    expect(editor.getTextArea()).toBeNull();
    editor.commit();
    editor.cancel();

    editor.destroy();
    editor.destroy(); // Idempotente
    editor.start(sampleNode, false); // No-op se destruído
    expect(editor.isActive()).toBe(false);
  });
});
