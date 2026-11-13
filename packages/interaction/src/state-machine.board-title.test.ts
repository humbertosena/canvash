import { createCanvasSection, type BoardNode, type CanvasSectionApi } from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { InteractionStateMachine, type InteractionAction } from './state-machine.js';

// Editor do título do board (spec boards, US-BD.6): o duplo clique abre; commit e cancelamento
// fecham; só um `shape.update {title}` entra no histórico.

const doubleClick = (x: number, y: number) =>
  ({ type: 'DOUBLE_CLICK', point: { x, y }, button: 0 }) as const;

/** Um ponto na faixa do título do board `b` (x 100..400, y 176..200). */
const IN_TITLE = { x: 150, y: 188 } as const;

describe('InteractionStateMachine: editor do título do board', () => {
  let section: CanvasSectionApi;
  let machine: InteractionStateMachine;
  let actions: InteractionAction[];

  const board = () => section.getSnapshot().document.nodes['b'] as BoardNode;
  const revision = () => section.getSnapshot().revision;

  beforeEach(() => {
    section = createCanvasSection();
    machine = new InteractionStateMachine(section);
    actions = [];
    machine.onAction((action) => actions.push(action));
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'b', type: 'board', x: 100, y: 200, width: 300, height: 150, title: 'Fluxo' },
    });
  });

  it('o duplo clique na faixa do título seleciona o board e abre o editor', () => {
    machine.process(doubleClick(IN_TITLE.x, IN_TITLE.y));

    expect(machine.getState()).toBe('editing-text');
    expect(section.getSnapshot().session.selectedIds).toEqual(['b']);
    expect(actions.find((a) => a.type === 'START_BOARD_TITLE_EDIT')).toMatchObject({
      node: { id: 'b', title: 'Fluxo' },
    });
  });

  it('o duplo clique no corpo do board não abre o editor', () => {
    machine.process(doubleClick(200, 260));

    expect(machine.getState()).toBe('idle');
    expect(actions.some((a) => a.type === 'START_BOARD_TITLE_EDIT')).toBe(false);
  });

  it('confirmar grava o título sem espaços nas pontas, em uma só entrada de histórico', () => {
    machine.process(doubleClick(IN_TITLE.x, IN_TITLE.y));
    const before = revision();

    machine.commitBoardTitle('  Jornada do cliente  ');

    expect(machine.getState()).toBe('idle');
    expect(board().title).toBe('Jornada do cliente');
    expect(revision()).toBe(before + 1);
    expect(actions.at(-2)).toEqual({ type: 'END_TEXT_EDIT' });
    section.undo();
    expect(board().title).toBe('Fluxo');
  });

  it('título vazio ou só com espaços não gera comando', () => {
    machine.process(doubleClick(IN_TITLE.x, IN_TITLE.y));
    const before = revision();

    machine.commitBoardTitle('   ');

    expect(machine.getState()).toBe('idle');
    expect(board().title).toBe('Fluxo');
    expect(revision()).toBe(before);
  });

  it('título igual ao atual não gera comando', () => {
    machine.process(doubleClick(IN_TITLE.x, IN_TITLE.y));
    const before = revision();

    machine.commitBoardTitle(' Fluxo ');

    expect(board().title).toBe('Fluxo');
    expect(revision()).toBe(before);
  });

  it('cancelar fecha o editor sem comando', () => {
    machine.process(doubleClick(IN_TITLE.x, IN_TITLE.y));
    const before = revision();

    machine.cancelBoardTitle();

    expect(machine.getState()).toBe('idle');
    expect(board().title).toBe('Fluxo');
    expect(revision()).toBe(before);
    expect(actions.at(-2)).toEqual({ type: 'END_TEXT_EDIT' });
  });

  it('o Esc do gesto (cancel) também fecha o editor sem comando', () => {
    machine.process(doubleClick(IN_TITLE.x, IN_TITLE.y));

    machine.cancel();

    expect(machine.getState()).toBe('idle');
    expect(board().title).toBe('Fluxo');
  });

  it('o editor não abre com o board bloqueado', () => {
    section.dispatch({ type: 'shape.update', id: 'b', patch: { locked: true } });

    machine.process(doubleClick(IN_TITLE.x, IN_TITLE.y));

    expect(machine.getState()).toBe('idle');
  });

  it('o editor não abre em camada bloqueada', () => {
    const layerId = section.getSnapshot().document.layers[0]!.id;
    section.dispatch({ type: 'layer.update', id: layerId, patch: { locked: true } });

    machine.process(doubleClick(IN_TITLE.x, IN_TITLE.y));

    expect(machine.getState()).toBe('idle');
  });

  it('o editor não abre em somente leitura', () => {
    section.setReadOnly(true);

    machine.process(doubleClick(IN_TITLE.x, IN_TITLE.y));

    expect(machine.getState()).toBe('idle');
  });

  it('commitBoardTitle e cancelBoardTitle fora da edição não fazem nada', () => {
    const before = revision();

    machine.commitBoardTitle('Outro');
    machine.cancelBoardTitle();

    expect(machine.getState()).toBe('idle');
    expect(revision()).toBe(before);
  });

  it('o título passa de 200 caracteres cortado no commit', () => {
    machine.process(doubleClick(IN_TITLE.x, IN_TITLE.y));

    machine.commitBoardTitle('x'.repeat(250));

    expect(board().title).toHaveLength(200);
  });
});
