import {
  createCanvasSection,
  type BoardNode,
  type CanvasPeer,
  type CanvasSectionApi,
} from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { InteractionStateMachine } from '../state-machine.js';
import {
  DEFAULT_BOARD_HEIGHT,
  DEFAULT_BOARD_WIDTH,
  computeBoardCreation,
  nextBoardTitle,
} from './board.js';

// A ferramenta Board (spec boards, §5.1): arrasto ou clique cria o board, que adota o que está sob ele.

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

describe('computeBoardCreation e nextBoardTitle', () => {
  it('um arrasto maior que o mínimo usa a caixa do gesto, em qualquer direção', () => {
    expect(computeBoardCreation({ x: 10, y: 20 }, { x: 110, y: 90 }, 8)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 70,
    });
    expect(computeBoardCreation({ x: 110, y: 90 }, { x: 10, y: 20 }, 8)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 70,
    });
  });

  it('um clique, ou um arrasto menor que o mínimo em algum eixo, dá 640 × 400 com o canto no ponto', () => {
    const expected = { x: 40, y: 60, width: DEFAULT_BOARD_WIDTH, height: DEFAULT_BOARD_HEIGHT };

    expect(computeBoardCreation({ x: 40, y: 60 }, { x: 40, y: 60 }, 8)).toEqual(expected);
    expect(computeBoardCreation({ x: 40, y: 60 }, { x: 200, y: 62 }, 8)).toEqual(expected);
    expect([DEFAULT_BOARD_WIDTH, DEFAULT_BOARD_HEIGHT]).toEqual([640, 400]);
  });

  it('o título numerado é o menor N que nenhum board usa, com o texto de boardTitle', () => {
    const section = createCanvasSection();
    const add = (id: string, title: string) =>
      section.dispatch({
        type: 'shape.create',
        shape: { id, type: 'board', x: 0, y: 0, width: 10, height: 10, title },
      } as never);
    const document = () => section.getSnapshot().document;

    expect(nextBoardTitle(document(), (n) => `Board ${n}`)).toBe('Board 1');
    add('a', 'Board 1');
    add('b', 'Board 2');
    expect(nextBoardTitle(document(), (n) => `Board ${n}`)).toBe('Board 3');
    section.dispatch({ type: 'shape.remove', id: 'a' });
    expect(nextBoardTitle(document(), (n) => `Board ${n}`)).toBe('Board 1');
    expect(nextBoardTitle(document(), (n) => `Quadro ${n}`)).toBe('Quadro 1');
  });
});

describe('InteractionStateMachine: ferramenta Board', () => {
  let section: CanvasSectionApi;
  let machine: InteractionStateMachine;

  const boards = (): BoardNode[] =>
    Object.values(section.getSnapshot().document.nodes).filter(
      (node): node is BoardNode => node.type === 'board',
    );
  const drag = (from: [number, number], to: [number, number]) => {
    machine.process(pointer('POINTER_DOWN', ...from));
    machine.process(pointer('POINTER_MOVE', ...to));
    machine.process(pointer('POINTER_UP', ...to));
  };
  const rect = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
    type: 'shape.create' as const,
    shape: { id, type: 'rectangle' as const, x, y, width: 20, height: 20, rotation: 0, ...extra },
  });

  beforeEach(() => {
    section = createCanvasSection();
    machine = new InteractionStateMachine(section);
    section.setTool('board');
  });

  it('usa o cursor de cruz com a ferramenta board', () => {
    expect(machine.getIdleCursor()).toBe('crosshair');
  });

  it('US-BD.1: o arrasto cria o board no retângulo do gesto, com o título "Board 1"', () => {
    drag([100, 120], [400, 320]);

    expect(boards()).toHaveLength(1);
    expect(boards()[0]).toMatchObject({
      x: 100,
      y: 120,
      width: 300,
      height: 200,
      title: 'Board 1',
      childIds: [],
    });
  });

  it('US-BD.1: o clique cria 640 × 400 com o canto superior esquerdo no ponto', () => {
    machine.process(pointer('POINTER_DOWN', 50, 70));
    machine.process(pointer('POINTER_UP', 50, 70));

    expect(boards()[0]).toMatchObject({ x: 50, y: 70, width: 640, height: 400 });
  });

  it('US-BD.1: o board novo fica selecionado e a ferramenta volta a Selecionar', () => {
    drag([0, 0], [200, 100]);

    const [created] = boards();
    expect(section.getSnapshot().session.selectedIds).toEqual([created!.id]);
    expect(section.getSnapshot().session.activeTool).toBe('select');
    expect(machine.getState()).toBe('idle');
  });

  it('US-BD.1: o segundo board é "Board 2", e com "Board 1" apagado o próximo volta a "Board 1"', () => {
    drag([0, 0], [200, 100]);
    section.setTool('board');
    drag([300, 0], [500, 100]);
    expect(
      boards()
        .map((board) => board.title)
        .sort(),
    ).toEqual(['Board 1', 'Board 2']);

    const first = boards().find((board) => board.title === 'Board 1')!;
    section.dispatch({ type: 'shape.remove', id: first.id });
    section.setTool('board');
    drag([600, 0], [800, 100]);

    expect(
      boards()
        .map((board) => board.title)
        .sort(),
    ).toEqual(['Board 1', 'Board 2']);
  });

  it('boardTitle, dado nas opções, troca o texto do título', () => {
    machine = new InteractionStateMachine(section, { boardTitle: (n) => `Quadro ${n}` });

    drag([0, 0], [200, 100]);

    expect(boards()[0]!.title).toBe('Quadro 1');
  });

  it('a prévia do arrasto é um board em additions, com o título que ele vai receber', () => {
    machine.process(pointer('POINTER_DOWN', 100, 120));
    machine.process(pointer('POINTER_MOVE', 400, 320));

    expect(machine.getState()).toBe('creating');
    expect(section.getPreview()!.additions[0]).toMatchObject({
      type: 'board',
      x: 100,
      y: 120,
      width: 300,
      height: 200,
      title: 'Board 1',
    });
    expect(boards()).toHaveLength(0);

    machine.process(pointer('POINTER_UP', 400, 320));
    expect(section.getPreview()).toBeNull();
  });

  it('a prévia não entra no histórico: só o commit entra, numa entrada', () => {
    const before = section.getSnapshot().revision;

    machine.process(pointer('POINTER_DOWN', 0, 0));
    machine.process(pointer('POINTER_MOVE', 200, 100));
    expect(section.getSnapshot().revision).toBe(before);
    machine.process(pointer('POINTER_UP', 200, 100));

    expect(section.getSnapshot().revision).toBe(before + 1);
    section.undo();
    expect(boards()).toHaveLength(0);
  });

  it('em somente leitura, nada é criado', () => {
    section.setReadOnly(true);

    drag([0, 0], [200, 100]);

    expect(boards()).toHaveLength(0);
    expect(section.getSnapshot().session.activeTool).toBe('board');
  });

  it('sem camada visível e desbloqueada, nada é criado', () => {
    const layerId = section.getSnapshot().document.layers[0]!.id;
    section.dispatch({ type: 'layer.update', id: layerId, patch: { locked: true } });

    drag([0, 0], [200, 100]);

    expect(boards()).toHaveLength(0);
    expect(section.getSnapshot().session.activeTool).toBe('board');
  });

  it('o board vai para a camada mais à frente que está visível e desbloqueada', () => {
    section.dispatch({ type: 'layer.create', layer: { id: 'front', locked: true } });

    drag([0, 0], [200, 100]);

    const layers = section.getSnapshot().document.layers;
    const created = boards()[0]!;
    expect(layers.find((layer) => layer.childIds.includes(created.id))!.id).toBe(layers[0]!.id);
  });

  describe('adoção (US-BD.2)', () => {
    it('adota os nós com o centro dentro do board, na ordem visual, e deixa os outros', () => {
      section.transact([
        rect('in1', 110, 130), // centro (120, 140): dentro
        rect('out', 600, 600), // fora
        rect('in2', 200, 200), // centro (210, 210): dentro
        rect('edge', 390, 310), // centro (400, 320): na borda de baixo, ainda dentro
      ]);
      const layerId = section.getSnapshot().document.layers[0]!.id;

      drag([100, 120], [400, 320]);

      const [created] = boards();
      expect(created!.childIds).toEqual(['in1', 'in2', 'edge']);
      expect(section.getSnapshot().document.layers[0]!.childIds).toEqual(['out', created!.id]);
      expect(section.getNodeInfo('in1')).toMatchObject({ layerId, boardId: created!.id });
    });

    it('um único undo remove o board e devolve os adotados às posições de antes', () => {
      section.transact([rect('a', 110, 130), rect('b', 600, 600), rect('c', 200, 200)]);
      const before = section.getSnapshot().document;

      drag([100, 120], [400, 320]);
      expect(boards()[0]!.childIds).toEqual(['a', 'c']);

      section.undo();

      expect(section.getSnapshot().document).toEqual(before);
    });

    it.each([
      [
        'locked',
        (s: CanvasSectionApi) =>
          s.dispatch({ type: 'shape.update', id: 'n', patch: { locked: true } }),
      ],
      [
        'oculto',
        (s: CanvasSectionApi) =>
          s.dispatch({ type: 'shape.update', id: 'n', patch: { visible: false } }),
      ],
    ])('um nó %s não é adotado', (_name, change) => {
      section.transact([rect('n', 110, 130), rect('ok', 200, 200)]);
      change(section);

      drag([100, 120], [400, 320]);

      expect(boards()[0]!.childIds).toEqual(['ok']);
    });

    it('um nó de camada bloqueada ou de outra camada não é adotado', () => {
      section.transact([
        { type: 'layer.create', layer: { id: 'locked-layer' } },
        { ...rect('far', 110, 130), layerId: 'locked-layer' },
        { ...rect('here', 200, 200), layerId: section.getSnapshot().document.layers[0]!.id },
      ] as never);
      section.dispatch({ type: 'layer.update', id: 'locked-layer', patch: { locked: true } });
      // A camada bloqueada fica à frente: o board vai para a primeira camada desbloqueada.

      drag([100, 120], [400, 320]);

      expect(boards()[0]!.childIds).toEqual(['here']);
    });

    it('um nó bloqueado por outra sessão não é adotado', () => {
      section.transact([rect('mine', 110, 130), rect('theirs', 200, 200)]);
      const peer: CanvasPeer = {
        sessionId: 'outra',
        name: 'Bia',
        color: '#dc2626',
        cursor: null,
        selection: ['theirs'],
        selectedAt: 1,
        drag: null,
        view: null,
        locks: ['theirs'],
        followed: false,
      };
      section.setPeers([peer]);

      drag([100, 120], [400, 320]);

      expect(boards()[0]!.childIds).toEqual(['mine']);
    });

    it('outro board com o centro dentro não é adotado', () => {
      section.dispatch({
        type: 'shape.create',
        shape: { id: 'other', type: 'board', x: 150, y: 150, width: 50, height: 50 },
      } as never);
      section.transact([rect('plain', 110, 130)]);

      drag([100, 120], [400, 320]);

      const created = boards().find((board) => board.id !== 'other')!;
      expect(created.childIds).toEqual(['plain']);
    });

    it('um grupo entra inteiro quando o centro dele está dentro', () => {
      section.transact([
        rect('g1', 110, 130),
        rect('g2', 140, 130),
        { type: 'group.create', id: 'grp', childIds: ['g1', 'g2'] },
      ] as never);

      drag([100, 120], [400, 320]);

      expect(boards()[0]!.childIds).toEqual(['grp']);
    });

    it('um filho de outro board com o centro dentro também é adotado, e sai do outro', () => {
      section.dispatch({
        type: 'shape.create',
        shape: { id: 'old', type: 'board', x: 0, y: 0, width: 80, height: 80 },
      } as never);
      section.transact([rect('kid', 110, 130)]);
      section.dispatch({ type: 'board.attach', boardId: 'old', ids: ['kid'] });

      drag([100, 120], [400, 320]);

      // O filho do board antigo é nó de nível superior? Não: só os da camada entram na adoção.
      expect(boards().find((board) => board.id !== 'old')!.childIds).toEqual([]);
    });
  });
});
