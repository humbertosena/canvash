import {
  createCanvasSection,
  shapeLabelArea,
  shapeLabelColor,
  type LabelableNode,
  type RectangleNode,
  type ShapeLabel,
} from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextEditorAdapter } from './text-editor.js';

// O <textarea> sobre a área inscrita do texto da forma (spec shape-label, US-SL.8).

describe('TextEditorAdapter editando o texto de uma forma (navegador)', () => {
  let container: HTMLDivElement;
  let section: ReturnType<typeof createCanvasSection>;
  let editor: TextEditorAdapter;
  const onCommit = vi.fn();
  const onCancel = vi.fn();

  const LABEL: ShapeLabel = {
    text: 'Olá',
    fontSize: 20,
    fontFamily: 'sans-serif',
    fontWeight: 'bold',
    color: null,
    textAlign: 'right',
    verticalAlign: 'middle',
  };
  const rectangle = (overrides: Partial<RectangleNode> = {}): RectangleNode => ({
    id: 'r1',
    type: 'rectangle',
    x: 100,
    y: 80,
    width: 200,
    height: 100,
    rotation: 0,
    visible: true,
    locked: false,
    style: { fill: '#ffffff', stroke: null, strokeWidth: 0, opacity: 1 },
    label: LABEL,
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

  const start = (node: LabelableNode, isNew = false) => {
    editor.start(node, isNew);
    return editor.getTextArea()!;
  };

  it('cobre a área inscrita, com o texto, a fonte, a cor e o alinhamento da forma', () => {
    const node = rectangle();
    const area = shapeLabelArea(node)!;

    const textarea = start(node);

    expect(textarea.value).toBe('Olá');
    expect(textarea.style.width).toBe(`${area.width}px`);
    expect(textarea.style.height).toBe(`${area.height}px`);
    expect(textarea.style.fontSize).toBe('20px');
    expect(textarea.style.fontFamily).toContain('sans-serif');
    expect(textarea.style.fontWeight).toBe('bold');
    expect(textarea.style.textAlign).toBe('right');
    expect(textarea.style.lineHeight).toBe('1.25');
    expect(textarea.style.background).toContain('transparent');
    expect(textarea.style.color).toBe('rgb(31, 41, 55)');
  });

  it('a cor é a de shapeLabelColor: clara sobre fundo escuro, e a explícita quando dada', () => {
    const dark = rectangle({
      style: { fill: '#000000', stroke: null, strokeWidth: 0, opacity: 1 },
    });
    expect(start(dark).style.color).toBe(rgbOf(shapeLabelColor(dark)));
    editor.cancel();

    const explicit = rectangle({ label: { ...LABEL, color: '#ff0000' } });
    expect(start(explicit).style.color).toBe('rgb(255, 0, 0)');
  });

  it('numa forma sem label, abre vazio com os padrões', () => {
    const textarea = start(rectangle({ label: undefined } as never));

    expect(textarea.value).toBe('');
    expect(textarea.style.fontSize).toBe('16px');
    expect(textarea.style.textAlign).toBe('center');
  });

  it('posiciona o centro da área e gira em torno do centro da caixa, com o zoom e o pan', () => {
    const node = rectangle({ rotation: Math.PI / 6 });
    const textarea = start(node);
    section.setViewport({ x: 30, y: 10, zoom: 2 });

    const area = shapeLabelArea(node)!;
    expect(textarea.style.width).toBe(`${area.width * 2}px`);
    expect(textarea.style.height).toBe(`${area.height * 2}px`);
    expect(textarea.style.fontSize).toBe('40px');
    // O centro da caixa em tela: (200 × 2 + 30, 130 × 2 + 10) = (430, 270).
    expect(textarea.style.transform).toContain('translate(430px, 270px)');
    // O navegador normaliza o ângulo: 0,5235987… vira 0,523599 radianos.
    expect(textarea.style.transform).toContain('rotate(0.5235');
  });

  it('verticalAlign move o texto com padding-top, sem passar da área', () => {
    const tops = (['top', 'middle', 'bottom'] as const).map((verticalAlign) => {
      const textarea = start(rectangle({ label: { ...LABEL, verticalAlign } }));
      const padding = parseFloat(textarea.style.paddingTop);
      editor.cancel();
      return padding;
    });

    expect(tops[0]).toBe(0);
    expect(tops[1]).toBeGreaterThan(0);
    expect(tops[2]).toBeGreaterThan(tops[1]!);
  });

  it('digitar recalcula o padding-top: mais texto, menos folga; nunca negativo', () => {
    const textarea = start(rectangle());
    const short = parseFloat(textarea.style.paddingTop);

    textarea.value = Array.from({ length: 3 }, () => 'linha').join('\n');
    textarea.dispatchEvent(new Event('input'));
    const three = parseFloat(textarea.style.paddingTop);
    textarea.value = Array.from({ length: 40 }, () => 'linha').join('\n');
    textarea.dispatchEvent(new Event('input'));
    const overflow = parseFloat(textarea.style.paddingTop);

    expect(three).toBeLessThan(short);
    expect(overflow).toBe(0);
  });

  it('o commit devolve o texto sem HTML; Esc cancela; blur grava', () => {
    const textarea = start(rectangle());
    textarea.value = '<b>Novo</b> texto';
    editor.commit();
    expect(onCommit).toHaveBeenCalledWith('r1', 'Novo texto', false);

    const again = start(rectangle());
    again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onCancel).toHaveBeenCalledWith('r1', false);

    const third = start(rectangle());
    third.value = 'por blur';
    third.dispatchEvent(new Event('blur'));
    expect(onCommit).toHaveBeenLastCalledWith('r1', 'por blur', false);
  });

  it('Ctrl+Enter confirma, e Enter sozinho quebra a linha', () => {
    const textarea = start(rectangle());
    textarea.value = 'a';

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onCommit).not.toHaveBeenCalled();
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );
    expect(onCommit).toHaveBeenCalledWith('r1', 'a', false);
  });
});

function rgbOf(hex: string): string {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}
