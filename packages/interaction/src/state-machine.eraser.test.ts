import {
  createCanvasSection,
  inkStrokesToWorld,
  type CanvasSectionApi,
  type InkNode,
} from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  InteractionStateMachine,
  type InteractionAction,
  type PointerDownInput,
} from './state-machine.js';
import type { EraserCursor } from './tools/eraser.js';

function down(x: number, y: number, extra: Partial<PointerDownInput> = {}): PointerDownInput {
  return {
    type: 'POINTER_DOWN',
    pointerId: 1,
    point: { x, y },
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    shiftKey: false,
    spaceKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...extra,
  };
}
const move = (x: number, y: number, pointerId = 1) =>
  ({ type: 'POINTER_MOVE', pointerId, point: { x, y }, buttons: 1 }) as const;
const up = (x: number, y: number, pointerId = 1) =>
  ({ type: 'POINTER_UP', pointerId, point: { x, y }, button: 0 }) as const;

describe('InteractionStateMachine: borracha', () => {
  let section: CanvasSectionApi;
  let machine: InteractionStateMachine;
  let actions: InteractionAction[];
  let cursors: Array<EraserCursor | null>;

  /** Linha horizontal de (0, y) a (200, y), caneta média. */
  function addLine(id: string, y: number, extra: Record<string, unknown> = {}): void {
    expect(
      section.dispatch({
        type: 'shape.create',
        shape: {
          id,
          type: 'ink',
          strokes: [
            {
              points: [
                { x: 0, y },
                { x: 200, y },
              ],
            },
          ],
          ...extra,
        } as never,
      }).ok,
    ).toBe(true);
  }
  const node = (id: string): InkNode | undefined =>
    section.getSnapshot().document.nodes[id] as InkNode | undefined;
  const worldStrokes = (id: string) => inkStrokesToWorld(node(id)!);
  const sweep = (x: number, y0: number, y1: number): void => {
    machine.process(down(x, y0));
    machine.process(move(x, (y0 + y1) / 2));
    machine.process(move(x, y1));
    machine.process(up(x, y1));
  };

  beforeEach(() => {
    section = createCanvasSection();
    cursors = [];
    machine = new InteractionStateMachine(section, {
      onEraserCursorChange: (cursor) => cursors.push(cursor),
    });
    actions = [];
    machine.onAction((action) => actions.push(action));
    section.setTool('eraser');
  });

  it('usa o cursor invisível com a borracha e não tem atalho', () => {
    expect(machine.getIdleCursor()).toBe('none');
    for (const key of ['e', 'E', 'x', 'X']) {
      machine.process({ type: 'KEY_DOWN', key, code: `Key${key.toUpperCase()}` });
    }
    expect(section.getSnapshot().session.activeTool).toBe('eraser');
  });

  it('o tamanho padrão é médio e vale o que for definido; valor inválido é ignorado', () => {
    expect(machine.getEraserSize()).toBe('medium');
    machine.setEraserSize('thick');
    expect(machine.getEraserSize()).toBe('thick');
    machine.setEraserSize('enorme');
    machine.setEraserSize(undefined);
    expect(machine.getEraserSize()).toBe('thick');
  });

  it('passar pelo meio divide o traço em dois, no mesmo elemento, com as pontas na borda', () => {
    addLine('k', 100);
    sweep(100, 80, 120);
    const strokes = worldStrokes('k');
    expect(strokes).toHaveLength(2);
    // Raio médio (8) em zoom 1: apaga de x = 92 até x = 108 numa passada vertical em x = 100.
    expect(strokes[0]!.points[1]!.x).toBeCloseTo(100 - 8, 6);
    expect(strokes[1]!.points[0]!.x).toBeCloseTo(100 + 8, 6);
    expect(strokes[0]!.points[0]).toEqual({ x: 0, y: 100 });
    expect(strokes[1]!.points[1]!).toEqual({ x: 200, y: 100 });
  });

  it('passar pela ponta encurta o traço', () => {
    addLine('k', 100);
    sweep(2, 80, 120);
    const strokes = worldStrokes('k');
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.points[0]!.x).toBeCloseTo(10, 6);
  });

  it('um clique é uma passada de um ponto: apaga um círculo', () => {
    addLine('k', 100);
    machine.process(down(100, 100));
    machine.process(up(100, 100));
    expect(worldStrokes('k')).toHaveLength(2);
  });

  it('um pingo sob a borracha some, e o elemento sem traços é removido', () => {
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'dot', type: 'ink', strokes: [{ points: [{ x: 50, y: 50 }] }] },
    });
    machine.process(down(53, 50));
    machine.process(up(53, 50));
    expect(node('dot')).toBeUndefined();
  });

  it('uma passada que cruza três elementos altera os três numa só entrada de histórico', () => {
    addLine('a', 100);
    addLine('b', 140);
    addLine('c', 180);
    const before = section.getSnapshot().revision;
    machine.process(down(100, 80));
    for (let y = 81; y <= 200; y += 1) machine.process(move(100, y));
    machine.process(up(100, 200));

    for (const id of ['a', 'b', 'c']) expect(worldStrokes(id)).toHaveLength(2);
    expect(section.getSnapshot().revision).toBe(before + 1);
  });

  it('uma passada de 300 eventos é uma transação só', () => {
    addLine('k', 100);
    const before = section.getSnapshot().revision;
    machine.process(down(10, 100));
    for (let i = 1; i <= 300; i += 1)
      machine.process(move(10 + i * 0.6, 100 + Math.sin(i / 10) * 4));
    machine.process(up(190, 100));
    expect(section.getSnapshot().revision).toBe(before + 1);
  });

  it('uma passada no vazio não gera transação nem histórico', () => {
    addLine('k', 100);
    const before = section.getSnapshot().revision;
    sweep(100, 300, 340);
    expect(section.getSnapshot().revision).toBe(before);
    expect(node('k')!.strokes).toHaveLength(1);
  });

  it('mostra o preview durante a passada e só grava ao soltar', () => {
    addLine('k', 100);
    const original = node('k')!;
    machine.process(down(100, 80));
    machine.process(move(100, 120));
    expect(machine.getState()).toBe('erasing');
    const preview = section.getPreview()!.updates['k'] as unknown as {
      x: number;
      width: number;
      strokes: unknown[];
    };
    expect(preview.strokes).toHaveLength(2);
    // A caixa original fica no preview; a nova só vem no commit.
    expect(preview.x).toBe(original.x);
    expect(preview.width).toBe(original.width);
    expect(node('k')).toEqual(original);

    machine.process(up(100, 120));
    expect(section.getPreview()).toBeNull();
    expect(node('k')!.strokes).toHaveLength(2);
  });

  it('o elemento esvaziado fica oculto no preview e é removido ao soltar', () => {
    addLine('k', 100);
    machine.process(down(-10, 100));
    machine.process(move(100, 100));
    machine.process(move(210, 100));
    const preview = section.getPreview()!.updates['k'] as unknown as { visible: boolean };
    expect(preview.visible).toBe(false);
    expect(node('k')).toBeDefined();
    machine.process(up(210, 100));
    expect(node('k')).toBeUndefined();
  });

  it('desfazer restaura o elemento inteiro e refazer reaplica', () => {
    addLine('k', 100);
    const original = node('k')!;
    sweep(100, 80, 120);
    const erased = node('k')!;
    section.undo();
    expect(node('k')).toEqual(original);
    section.redo();
    expect(node('k')).toEqual(erased);
    // Também com a remoção.
    machine.process(down(-10, 100));
    machine.process(move(100, 100));
    machine.process(move(210, 100));
    machine.process(up(210, 100));
    expect(node('k')).toBeUndefined();
    section.undo();
    expect(node('k')).toEqual(erased);
  });

  it('Esc descarta a passada: o desenho volta e nenhuma entrada de histórico', () => {
    addLine('k', 100);
    const before = section.getSnapshot().revision;
    machine.process(down(100, 80));
    machine.process(move(100, 120));
    machine.process({ type: 'KEY_DOWN', key: 'Escape', code: 'Escape' });
    expect(machine.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
    expect(section.getSnapshot().revision).toBe(before);
    expect(node('k')!.strokes).toHaveLength(1);
    expect(actions).toContainEqual({ type: 'RELEASE_POINTER', pointerId: 1 });
  });

  it('pointercancel e destroy descartam sem histórico; o de outro ponteiro é ignorado', () => {
    addLine('k', 100);
    const before = section.getSnapshot().revision;
    machine.process(down(100, 80));
    machine.process(move(100, 120));
    machine.process({ type: 'POINTER_CANCEL', pointerId: 2 });
    expect(machine.getState()).toBe('erasing');
    machine.process({ type: 'POINTER_CANCEL', pointerId: 1 });
    expect(machine.getState()).toBe('idle');

    machine.process(down(100, 80));
    machine.process(move(100, 120));
    machine.process({ type: 'DESTROY' });
    expect(section.getPreview()).toBeNull();
    expect(section.getSnapshot().revision).toBe(before);
  });

  it('ignora movimento e soltura de outro ponteiro', () => {
    addLine('k', 100);
    machine.process(down(100, 80));
    machine.process(move(100, 120, 2));
    machine.process(up(100, 120, 2));
    expect(machine.getState()).toBe('erasing');
    machine.process(up(100, 120));
    expect(node('k')!.strokes).toHaveLength(2);
  });

  it('só elementos de traços mudam: figuras sob a passada ficam intactas', () => {
    addLine('k', 100);
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'ret', type: 'rectangle', x: 80, y: 60, width: 40, height: 80, rotation: 0 },
    });
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'txt', type: 'text', x: 90, y: 90, width: 60, text: 'Olá' },
    });
    const before = { ret: node('ret'), txt: node('txt') };
    sweep(100, 60, 140);
    expect(node('ret')).toEqual(before.ret);
    expect(node('txt')).toEqual(before.txt);
    expect(worldStrokes('k')).toHaveLength(2);
  });

  it('elementos ocultos, bloqueados ou em camada bloqueada são ignorados', () => {
    addLine('oculto', 100, { visible: false });
    addLine('bloqueado', 140, { locked: true });
    addLine('livre', 180);
    machine.process(down(100, 80));
    for (let y = 81; y <= 200; y += 1) machine.process(move(100, y));
    machine.process(up(100, 200));
    expect(node('oculto')!.strokes).toHaveLength(1);
    expect(node('bloqueado')!.strokes).toHaveLength(1);
    expect(worldStrokes('livre')).toHaveLength(2);

    const layer = section.getSnapshot().document.layers[0]!;
    section.dispatch({ type: 'layer.update', id: layer.id, patch: { locked: true } });
    const frozen = node('livre');
    sweep(40, 160, 200);
    expect(node('livre')).toEqual(frozen);
  });

  it('readOnly não apaga, mas o indicador segue o ponteiro', () => {
    addLine('k', 100);
    section.setReadOnly(true);
    machine.process(down(100, 100));
    expect(machine.getState()).toBe('idle');
    expect(cursors.at(-1)).toEqual({ x: 100, y: 100, radius: 8 });
    expect(node('k')!.strokes).toHaveLength(1);
  });

  it('o raio vem do tamanho: fina, média e grossa apagam 4, 8 e 16 CSS px', () => {
    const gap = (size: 'thin' | 'medium' | 'thick'): number => {
      section.dispatch({ type: 'shape.remove', id: 'k' });
      addLine('k', 100);
      machine.setEraserSize(size);
      sweep(100, 80, 120);
      const [left, right] = worldStrokes('k');
      return right!.points[0]!.x - left!.points[1]!.x;
    };
    expect(gap('thin')).toBeCloseTo(8, 6);
    expect(gap('medium')).toBeCloseTo(16, 6);
    expect(gap('thick')).toBeCloseTo(32, 6);
  });

  it('o raio em mundo é o raio em CSS px dividido pelo zoom', () => {
    section.setViewport({ x: 0, y: 0, zoom: 2 });
    addLine('k', 100);
    // Em zoom 2, a tela (200, 200) é o mundo (100, 100); o raio médio vale 4 de mundo.
    machine.process(down(200, 180));
    machine.process(move(200, 220));
    machine.process(up(200, 220));
    const [left, right] = worldStrokes('k');
    expect(right!.points[0]!.x - left!.points[1]!.x).toBeCloseTo(8, 6);
  });

  it('o indicador acompanha o ponteiro com o raio em CSS px e some ao esconder', () => {
    machine.process(move(30, 40));
    expect(cursors.at(-1)).toEqual({ x: 30, y: 40, radius: 8 });
    machine.setEraserSize('thick');
    machine.process(move(50, 60));
    expect(cursors.at(-1)).toEqual({ x: 50, y: 60, radius: 16 });
    machine.hideEraserCursor();
    expect(cursors.at(-1)).toBeNull();
    const count = cursors.length;
    machine.hideEraserCursor();
    expect(cursors).toHaveLength(count);
  });

  it('trocar de ferramenta esconde o indicador', () => {
    machine.process(move(30, 40));
    section.setTool('select');
    expect(cursors.at(-1)).toBeNull();
  });

  it('o indicador acompanha a passada em andamento e destruir o handle o esconde', () => {
    machine.process(down(10, 10));
    machine.process(move(20, 30));
    expect(cursors.at(-1)).toEqual({ x: 20, y: 30, radius: 8 });
    machine.process({ type: 'DESTROY' });
    expect(cursors.at(-1)).toBeNull();
  });

  it('sem quem desenhe o indicador, nada é publicado e nada quebra', () => {
    const quiet = new InteractionStateMachine(section);
    quiet.process(move(30, 40));
    expect(() => quiet.hideEraserCursor()).not.toThrow();
  });

  it('as amostras coalescidas entram todas na passada', () => {
    addLine('k', 100);
    machine.process(down(10, 90));
    machine.process({
      type: 'POINTER_MOVE',
      pointerId: 1,
      point: { x: 190, y: 110 },
      buttons: 1,
      coalescedPoints: [
        { x: 50, y: 110 },
        { x: 100, y: 90 },
        { x: 150, y: 110 },
        { x: 190, y: 110 },
      ],
    });
    machine.process(up(190, 110));
    // A passada em zigue-zague corta a linha em vários pontos.
    expect(worldStrokes('k').length).toBeGreaterThanOrEqual(3);
  });

  it('um traço que a passada deixa menor que 0,5 CSS px é descartado', () => {
    addLine('k', 100);
    // Apaga de 0,1 a 8 e de 8,3 a 16: sobraria um trecho de 0,3 entre as duas.
    machine.process(down(0, 100));
    machine.process(move(7.7, 100));
    machine.process(up(7.7, 100));
    const [first] = worldStrokes('k');
    expect(first!.points[0]!.x).toBeGreaterThanOrEqual(15.7 - 1e-6);
  });

  it('um traço de dois pontos cortado em ponta fica com o trecho restante', () => {
    addLine('k', 100);
    machine.process(down(200, 100));
    machine.process(up(200, 100));
    const [only] = worldStrokes('k');
    expect(only!.points[1]!.x).toBeCloseTo(192, 6);
  });
});
