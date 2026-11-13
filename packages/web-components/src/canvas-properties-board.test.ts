import { createCanvasSection, type BoardNode, type CanvasSectionApi } from '@canvash/core';
import { describe, expect, it, vi } from 'vitest';
import { CanvasPropertiesElement } from './canvas-properties.js';
import { defaultI18nEnUS, defaultI18nPtBR } from './i18n.js';

// Seção "Board" do painel de propriedades (spec boards, US-BD.10 e US-BD.17).

/** Texto do template: as partes fixas intercaladas com os valores, funções ignoradas. */
function templateText(result: unknown): string {
  if (Array.isArray(result)) return result.map(templateText).join('');
  if (result && typeof result === 'object' && 'strings' in result && 'values' in result) {
    const { strings, values } = result as { strings: readonly string[]; values: unknown[] };
    return strings.reduce(
      (text, part, i) => text + part + (i < values.length ? templateText(values[i]) : ''),
      '',
    );
  }
  if (typeof result === 'function' || result === undefined || result === null) return '';
  return String(result);
}

interface Testable {
  _onBoardTitle(event: unknown): void;
  _onBoardColor(field: 'fill' | 'stroke', event: unknown): void;
  _onBoardColorNone(field: 'fill' | 'stroke'): void;
  _onBoardFillOpacity(event: unknown): void;
  _onNumberChange(prop: 'x' | 'y' | 'width' | 'height' | 'rotation', event: unknown): void;
  _onColorChange(prop: 'fill' | 'stroke', event: unknown): void;
}

const input = (value: string) => ({ target: { value } });

function setup(selected: readonly string[] = ['b1']) {
  const el = new CanvasPropertiesElement();
  const section = createCanvasSection();
  el.section = section;
  section.transact([
    {
      type: 'shape.create',
      shape: {
        id: 'b1',
        type: 'board',
        x: 100,
        y: 200,
        width: 300,
        height: 150,
        title: 'Fluxo',
        style: { fill: '#ffffff', fillOpacity: 0.4, stroke: '#9ca3af' },
      },
    },
    {
      type: 'shape.create',
      shape: { id: 'b2', type: 'board', x: 600, y: 200, width: 200, height: 100, title: 'Outro' },
    },
    {
      type: 'shape.create',
      shape: { id: 'c1', type: 'rectangle', x: 150, y: 230, width: 60, height: 40, rotation: 0 },
    },
    {
      type: 'shape.create',
      shape: { id: 'r1', type: 'rectangle', x: 900, y: 0, width: 60, height: 40, rotation: 0 },
    },
    { type: 'board.attach', boardId: 'b1', ids: ['c1'] },
  ] as never);
  section.setSelection([...selected]);
  return {
    el,
    section,
    internals: el as unknown as Testable,
    html: (): string => templateText(el.render()),
  };
}

const board = (section: CanvasSectionApi, id: string) =>
  section.getSnapshot().document.nodes[id] as BoardNode;

describe('CanvasPropertiesElement: seção do board', () => {
  it('com um board mostra section-board e section-transform, sem rotação, conversões nem section-style', () => {
    const { html } = setup(['b1']);
    const out = html();

    expect(out).toContain('part="section-board"');
    expect(out).toContain('part="input-board-title"');
    expect(out).toContain('part="input-board-fill"');
    expect(out).toContain('part="input-board-fill-opacity"');
    expect(out).toContain('part="input-board-stroke"');
    expect(out).toContain('part="section-transform"');
    expect(out).toContain('part="input-x"');
    expect(out).toContain('part="input-height"');
    expect(out).not.toContain('part="input-rotation"');
    expect(out).not.toContain('part="btn-convert-type"');
    expect(out).not.toContain('part="section-style"');
  });

  it('com dois boards o campo de título some, e o resto da seção fica', () => {
    const { html } = setup(['b1', 'b2']);
    const out = html();

    expect(out).toContain('part="section-board"');
    expect(out).not.toContain('part="input-board-title"');
    expect(out).toContain('part="input-board-fill"');
  });

  it('com seleção mista os campos do board somem, e a seção de estilo volta para os outros nós', () => {
    const { html } = setup(['b1', 'r1']);
    const out = html();

    expect(out).not.toContain('part="section-board"');
    expect(out).toContain('part="section-style"');
    expect(out).toContain('part="input-rotation"');
  });

  it('o título muda por um shape.update, sem espaços nas pontas, em uma entrada de histórico', () => {
    const { section, internals } = setup(['b1']);
    const before = section.getSnapshot().revision;

    internals._onBoardTitle(input('  Jornada  '));

    expect(board(section, 'b1').title).toBe('Jornada');
    expect(section.getSnapshot().revision).toBe(before + 1);
    section.undo();
    expect(board(section, 'b1').title).toBe('Fluxo');
  });

  it('título vazio ou igual ao atual não gera comando e devolve o texto ao campo', () => {
    const { section, internals } = setup(['b1']);
    const before = section.getSnapshot().revision;
    const field = { target: { value: '   ' } };

    internals._onBoardTitle(field);
    internals._onBoardTitle(input('Fluxo'));

    expect(field.target.value).toBe('Fluxo');
    expect(section.getSnapshot().revision).toBe(before);
  });

  it('o fundo e a borda mudam de cor, e "Nenhum" grava null', () => {
    const { section, internals } = setup(['b1']);

    internals._onBoardColor('fill', input('#FF0000'));
    internals._onBoardColor('stroke', input('#00ff00'));
    expect(board(section, 'b1').style).toMatchObject({ fill: '#ff0000', stroke: '#00ff00' });

    internals._onBoardColorNone('fill');
    internals._onBoardColorNone('stroke');
    expect(board(section, 'b1').style).toMatchObject({ fill: null, stroke: null });
  });

  it('uma cor inválida não gera comando', () => {
    const { section, internals } = setup(['b1']);
    const before = section.getSnapshot().revision;

    internals._onBoardColor('fill', input('vermelho'));

    expect(section.getSnapshot().revision).toBe(before);
  });

  it('a opacidade do fundo vai de 0 a 100% e fica presa nos extremos', () => {
    const { section, internals } = setup(['b1']);

    internals._onBoardFillOpacity(input('70'));
    expect(board(section, 'b1').style.fillOpacity).toBeCloseTo(0.7);
    internals._onBoardFillOpacity(input('250'));
    expect(board(section, 'b1').style.fillOpacity).toBe(1);
    internals._onBoardFillOpacity(input('-5'));
    expect(board(section, 'b1').style.fillOpacity).toBe(0);
  });

  it('vários boards recebem a mudança numa transação, uma só entrada de histórico', () => {
    const { section, internals } = setup(['b1', 'b2']);
    const before = section.getSnapshot().revision;
    const transact = vi.spyOn(section, 'transact');

    internals._onBoardColor('fill', input('#123456'));

    expect(transact).toHaveBeenCalledTimes(1);
    expect(board(section, 'b1').style.fill).toBe('#123456');
    expect(board(section, 'b2').style.fill).toBe('#123456');
    expect(section.getSnapshot().revision).toBe(before + 1);
    section.undo();
    expect(board(section, 'b1').style.fill).toBe('#ffffff');
  });

  it('o estado misto aparece no HTML quando os boards diferem', () => {
    const { html } = setup(['b1', 'b2']);

    expect(html()).toContain('Misto');
  });

  it('largura e altura mudam só o board, sem mexer nos filhos', () => {
    const { section, internals } = setup(['b1']);

    internals._onNumberChange('width', input('500'));
    internals._onNumberChange('height', input('320'));

    expect(board(section, 'b1')).toMatchObject({ width: 500, height: 320, childIds: ['c1'] });
    expect(section.getSnapshot().document.nodes['c1']).toMatchObject({ x: 150, y: 230 });
  });

  it('X e Y movem o board e os filhos pelo mesmo vetor, cada mudança numa entrada de histórico', () => {
    const { section, internals } = setup(['b1']);
    const before = section.getSnapshot().revision;

    internals._onNumberChange('x', input('160'));
    internals._onNumberChange('y', input('250'));

    expect(board(section, 'b1')).toMatchObject({ x: 160, y: 250 });
    expect(section.getSnapshot().document.nodes['c1']).toMatchObject({ x: 210, y: 280 });
    expect(section.getSnapshot().revision).toBe(before + 2);
    section.undo();
    expect(board(section, 'b1')).toMatchObject({ x: 160, y: 200 });
    expect(section.getSnapshot().document.nodes['c1']).toMatchObject({ x: 210, y: 230 });
  });

  it('com um descendente bloqueado o X do board não muda nada', () => {
    const { section, internals } = setup(['b1']);
    section.dispatch({ type: 'shape.update', id: 'c1', patch: { locked: true } });
    const before = section.getSnapshot().revision;

    internals._onNumberChange('x', input('160'));

    expect(board(section, 'b1').x).toBe(100);
    expect(section.getSnapshot().revision).toBe(before);
  });

  it('na seleção mista, os patches genéricos só vão para os nós que não são boards', () => {
    const { section, internals } = setup(['b1', 'r1']);
    const dispatch = vi.spyOn(section, 'dispatch');
    const transact = vi.spyOn(section, 'transact');

    internals._onNumberChange('x', input('50'));
    internals._onColorChange('fill', input('#abcdef'));

    const sent = [
      ...dispatch.mock.calls.map(([command]) => command),
      ...transact.mock.calls.flatMap(([commands]) => commands),
    ] as { id: string }[];
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((command) => command.id === 'r1')).toBe(true);
    expect(board(section, 'b1')).toMatchObject({ x: 100 });
    expect(board(section, 'b1').style.fill).toBe('#ffffff');
  });

  it('tem as mensagens da seção em pt-BR e en-US', () => {
    const pt = defaultI18nPtBR.properties;
    const en = defaultI18nEnUS.properties;

    expect([pt.sectionBoard, pt.boardTitle, pt.boardBackground, pt.boardBackgroundOpacity]).toEqual(
      ['Board', 'Título', 'Fundo', 'Opacidade do fundo'],
    );
    expect([pt.boardBorder, pt.boardNone]).toEqual(['Borda', 'Nenhum']);
    expect([en.sectionBoard, en.boardTitle, en.boardBackground, en.boardBackgroundOpacity]).toEqual(
      ['Board', 'Title', 'Background', 'Background opacity'],
    );
    expect([en.boardBorder, en.boardNone]).toEqual(['Border', 'None']);
  });
});
