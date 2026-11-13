import { createCanvasSection, type BoardNode, type CanvasSectionApi } from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { InteractionStateMachine } from './state-machine.js';

// Selecionar, redimensionar e girar o board (spec boards, §5.3): só o board muda, sem rotação.

const pointer = (type: 'POINTER_DOWN' | 'POINTER_MOVE' | 'POINTER_UP', x: number, y: number) => {
  const base = { pointerId: 1, point: { x, y } };
  if (type === 'POINTER_DOWN') {
    return {
      ...base,
      type,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      shiftKey: false,
      spaceKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    } as const;
  }
  return type === 'POINTER_MOVE'
    ? ({ ...base, type, buttons: 1 } as const)
    : ({ ...base, type, button: 0 } as const);
};

describe('InteractionStateMachine: board selecionado', () => {
  let section: CanvasSectionApi;
  let machine: InteractionStateMachine;

  const node = (id: string) => section.getSnapshot().document.nodes[id]!;
  const board = () => node('b') as BoardNode;

  beforeEach(() => {
    section = createCanvasSection();
    machine = new InteractionStateMachine(section);
    section.transact([
      {
        type: 'shape.create',
        shape: { id: 'b', type: 'board', x: 100, y: 200, width: 300, height: 150 },
      },
      {
        type: 'shape.create',
        shape: { id: 'c1', type: 'rectangle', x: 150, y: 230, width: 60, height: 40, rotation: 0 },
      },
      {
        type: 'shape.create',
        shape: { id: 'out', type: 'rectangle', x: 700, y: 200, width: 60, height: 40, rotation: 0 },
      },
      { type: 'board.attach', boardId: 'b', ids: ['c1'] },
    ] as never);
    section.setSelection(['b']);
  });

  it('US-BD.5: arrastar a alça se redimensiona só o board; os filhos ficam onde estavam', () => {
    const before = section.getSnapshot().revision;

    machine.process(pointer('POINTER_DOWN', 400, 350));
    expect(machine.getState()).toBe('resizing');
    machine.process(pointer('POINTER_MOVE', 460, 420));
    expect(section.getPreview()!.updates['b']).toMatchObject({
      type: 'board',
      width: 360,
      height: 220,
    });
    machine.process(pointer('POINTER_UP', 460, 420));

    expect(board()).toMatchObject({ x: 100, y: 200, width: 360, height: 220, childIds: ['c1'] });
    expect(node('c1')).toMatchObject({ x: 150, y: 230, width: 60, height: 40 });
    expect(section.getSnapshot().revision).toBe(before + 1);
    expect(section.getPreview()).toBeNull();
    section.undo();
    expect(board()).toMatchObject({ width: 300, height: 150 });
  });

  it('encolher o board para fora de um filho não tira o filho da lista', () => {
    machine.process(pointer('POINTER_DOWN', 400, 350));
    machine.process(pointer('POINTER_MOVE', 160, 210));
    machine.process(pointer('POINTER_UP', 160, 210));

    expect(board().childIds).toEqual(['c1']);
    expect(board()).toMatchObject({ width: 60, height: 10 });
  });

  it('a alça de rotação não existe: o ponto acima do board não gira nada', () => {
    machine.process(pointer('POINTER_DOWN', 250, 200 - 24 - 10));

    expect(machine.getState()).not.toBe('rotating');
    machine.process(pointer('POINTER_UP', 250, 200 - 24 - 10));
  });

  it('com o board locked, as alças não respondem', () => {
    section.dispatch({ type: 'shape.update', id: 'b', patch: { locked: true } } as never);

    machine.process(pointer('POINTER_DOWN', 400, 350));

    expect(machine.getState()).not.toBe('resizing');
  });

  it('em somente leitura, as alças não respondem', () => {
    section.setReadOnly(true);

    machine.process(pointer('POINTER_DOWN', 400, 350));

    expect(machine.getState()).not.toBe('resizing');
  });

  it('uma seleção múltipla com board não tem alças de redimensionar nem de girar', () => {
    section.setSelection(['b', 'out']);
    // A caixa agregada vai de (100, 176) a (760, 350); a alça sudeste ficaria em (760, 350).
    machine.process(pointer('POINTER_DOWN', 760, 350));

    expect(machine.getState()).not.toBe('resizing');
    expect(machine.getState()).not.toBe('rotating');
  });

  it('o cursor passa a de redimensionar sobre a alça, e a alça de rotação não existe', () => {
    const actions: string[] = [];
    machine.onAction((action) => {
      if (action.type === 'SET_CURSOR') actions.push(action.cursor);
    });

    machine.process({
      type: 'POINTER_MOVE',
      pointerId: 1,
      point: { x: 400, y: 350 },
      buttons: 0,
    });

    expect(actions.at(-1)).toMatch(/resize/);
  });

  it('US-BD.5: arrastar o board selecionado move o board e os descendentes pelo mesmo vetor, numa entrada', () => {
    const before = section.getSnapshot().revision;

    machine.process(pointer('POINTER_DOWN', 350, 320));
    machine.process(pointer('POINTER_MOVE', 380, 300));
    expect(machine.getState()).toBe('moving');
    const preview = section.getPreview()!.updates;
    expect(preview['b']).toMatchObject({ type: 'board', x: 130, y: 180 });
    expect(preview['c1']).toMatchObject({ x: 180, y: 210 });
    machine.process(pointer('POINTER_UP', 380, 300));

    expect(section.getSnapshot().revision).toBe(before + 1);
    expect(board()).toMatchObject({ x: 130, y: 180, childIds: ['c1'] });
    expect(node('c1')).toMatchObject({ x: 180, y: 210 });
    expect(node('out')).toMatchObject({ x: 700, y: 200 });
  });

  it('com um descendente locked, o arrasto do board não faz nada', () => {
    section.dispatch({ type: 'shape.update', id: 'c1', patch: { locked: true } });

    machine.process(pointer('POINTER_DOWN', 350, 320));
    machine.process(pointer('POINTER_MOVE', 380, 300));
    machine.process(pointer('POINTER_UP', 380, 300));

    expect(board()).toMatchObject({ x: 100, y: 200 });
    expect(machine.getState()).toBe('idle');
  });

  describe('pertença ao soltar (US-BD.3)', () => {
    let drops: Array<string | null>;

    beforeEach(() => {
      drops = [];
      machine = new InteractionStateMachine(section, {
        onDropTargetChange: (boardId) => drops.push(boardId),
      });
    });

    it('soltar o nó de fora com o centro no board o põe no board numa entrada, e o contorno vai e some', () => {
      section.setSelection(['out']);
      const before = section.getSnapshot().revision;

      // `out` (700..760 × 200..240) tem o centro em (730, 220); o board vai de (100, 200) a (400, 350).
      machine.process(pointer('POINTER_DOWN', 730, 220));
      machine.process(pointer('POINTER_MOVE', 200, 300));
      expect(section.getPreview()!.updates['out']).toMatchObject({ x: 170, y: 280 });
      expect(drops).toEqual(['b']);
      machine.process(pointer('POINTER_UP', 200, 300));

      expect(board().childIds).toEqual(['c1', 'out']);
      expect(section.getSnapshot().revision).toBe(before + 1);
      expect(drops).toEqual(['b', null]);
    });

    it('arrastar o filho para fora do board o devolve à camada; o contorno não aparece', () => {
      section.setSelection(['c1']);

      machine.process(pointer('POINTER_DOWN', 180, 250));
      machine.process(pointer('POINTER_MOVE', 580, 450));
      expect(drops).toEqual([]);
      machine.process(pointer('POINTER_UP', 580, 450));

      expect(board().childIds).toEqual([]);
      expect(section.getSnapshot().document.layers[0]!.childIds).toEqual(['b', 'c1', 'out']);
    });

    it('Esc no meio do arrasto apaga o contorno e não muda nada', () => {
      section.setSelection(['out']);

      machine.process(pointer('POINTER_DOWN', 730, 220));
      machine.process(pointer('POINTER_MOVE', 200, 300));
      machine.process({ type: 'CANCEL' });

      expect(drops).toEqual(['b', null]);
      expect(board().childIds).toEqual(['c1']);
    });
  });

  describe('clique e arrasto no fundo e no título (US-BD.6 e US-BD.7)', () => {
    // O board vai de (100, 200) a (400, 350); o título ocupa y de 176 a 200. O filho c1 está em (150, 230).
    beforeEach(() => {
      section.setSelection([]);
    });

    it('o clique no fundo vazio seleciona o board', () => {
      machine.process(pointer('POINTER_DOWN', 350, 320));
      machine.process(pointer('POINTER_UP', 350, 320));

      expect(section.getSnapshot().session.selectedIds).toEqual(['b']);
    });

    it('o clique num filho seleciona o filho, e não o board', () => {
      machine.process(pointer('POINTER_DOWN', 170, 250));
      machine.process(pointer('POINTER_UP', 170, 250));

      expect(section.getSnapshot().session.selectedIds).toEqual(['c1']);
    });

    it('o arrasto no fundo de um board não selecionado desenha a marquee e seleciona só os filhos pegos', () => {
      machine.process(pointer('POINTER_DOWN', 120, 215));
      machine.process(pointer('POINTER_MOVE', 300, 300));
      expect(machine.getState()).toBe('marquee');
      expect(section.getPreview()!.marquee).toMatchObject({
        x: 120,
        y: 215,
        width: 180,
        height: 85,
      });
      machine.process(pointer('POINTER_UP', 300, 300));

      expect(section.getSnapshot().session.selectedIds).toEqual(['c1']);
      expect(board()).toMatchObject({ x: 100, y: 200 });
    });

    it('com o board selecionado, o mesmo arrasto move o board', () => {
      section.setSelection(['b']);

      machine.process(pointer('POINTER_DOWN', 350, 320));
      machine.process(pointer('POINTER_MOVE', 380, 340));
      expect(machine.getState()).toBe('moving');
      machine.process(pointer('POINTER_UP', 380, 340));

      expect(board()).toMatchObject({ x: 130, y: 220 });
    });

    it('clicar no título seleciona o board', () => {
      machine.process(pointer('POINTER_DOWN', 150, 188));
      machine.process(pointer('POINTER_UP', 150, 188));

      expect(section.getSnapshot().session.selectedIds).toEqual(['b']);
    });

    it('arrastar o título move o board na hora, mesmo sem seleção prévia', () => {
      machine.process(pointer('POINTER_DOWN', 150, 188));
      machine.process(pointer('POINTER_MOVE', 190, 168));
      expect(machine.getState()).toBe('moving');
      machine.process(pointer('POINTER_UP', 190, 168));

      expect(board()).toMatchObject({ x: 140, y: 180 });
      expect(node('c1')).toMatchObject({ x: 190, y: 210 });
      expect(section.getSnapshot().session.selectedIds).toEqual(['b']);
    });

    it('o título de um board locked não seleciona nem arrasta', () => {
      section.dispatch({ type: 'shape.update', id: 'b', patch: { locked: true } } as never);

      machine.process(pointer('POINTER_DOWN', 150, 188));
      machine.process(pointer('POINTER_MOVE', 190, 168));
      machine.process(pointer('POINTER_UP', 190, 168));

      expect(board()).toMatchObject({ x: 100, y: 200 });
      expect(section.getSnapshot().session.selectedIds).toEqual([]);
    });

    it('com Shift, o clique no fundo acrescenta o board à seleção sem selecioná-lo na descida', () => {
      section.setSelection(['out']);

      machine.process({ ...pointer('POINTER_DOWN', 350, 320), shiftKey: true });
      machine.process(pointer('POINTER_UP', 350, 320));

      expect([...section.getSnapshot().session.selectedIds].sort()).toEqual(['b', 'out']);
    });
  });
});
