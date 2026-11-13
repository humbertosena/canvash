import { createCanvasSection, type CanvasSectionApi, type InkNode } from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  InteractionStateMachine,
  type InteractionAction,
  type PointerDownInput,
} from './state-machine.js';

type Kind = 'POINTER_DOWN' | 'POINTER_MOVE' | 'POINTER_UP';

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

const pointer = (type: Kind, x: number, y: number, pointerId = 1) => {
  if (type === 'POINTER_DOWN') return down(x, y, { pointerId });
  const base = { pointerId, point: { x, y } };
  return type === 'POINTER_MOVE'
    ? ({ ...base, type, buttons: 1 } as const)
    : ({ ...base, type, button: 0 } as const);
};

describe('InteractionStateMachine: caneta', () => {
  let section: CanvasSectionApi;
  let machine: InteractionStateMachine;
  let actions: InteractionAction[];

  const inks = (): InkNode[] =>
    Object.values(section.getSnapshot().document.nodes).filter(
      (node): node is InkNode => node.type === 'ink',
    );

  /** Um gesto de `count` eventos de movimento em linha reta de (x0, y) a (x1, y). */
  const stroke = (x0: number, x1: number, y: number, count = 20): void => {
    machine.process(pointer('POINTER_DOWN', x0, y));
    for (let i = 1; i <= count; i++) {
      machine.process(pointer('POINTER_MOVE', x0 + ((x1 - x0) * i) / count, y + (i % 2)));
    }
    machine.process(pointer('POINTER_UP', x1, y));
  };

  beforeEach(() => {
    section = createCanvasSection();
    machine = new InteractionStateMachine(section);
    actions = [];
    machine.onAction((action) => actions.push(action));
    section.setTool('pen');
  });

  it('usa o cursor de cruz com a caneta e não tem atalho', () => {
    expect(machine.getIdleCursor()).toBe('crosshair');
    const withoutTool = machine.getIdleCursor();
    for (const key of ['p', 'P', 'e', 'E', 'b', 'B']) {
      machine.process({ type: 'KEY_DOWN', key, code: `Key${key.toUpperCase()}` });
    }
    expect(section.getSnapshot().session.activeTool).toBe('pen');
    expect(withoutTool).toBe('crosshair');
  });

  it('o padrão é grafite, caneta, média, e as configurações são lembradas', () => {
    expect(machine.getPenSettings()).toEqual({ color: '#1f2937', kind: 'pen', width: 'medium' });
    machine.setPenSettings({ color: '#EF4444', kind: 'marker', width: 'thick' });
    expect(machine.getPenSettings()).toEqual({ color: '#ef4444', kind: 'marker', width: 'thick' });
  });

  it('ignora campos inválidos e mantém os demais', () => {
    machine.setPenSettings({ color: '#3b82f6' });
    machine.setPenSettings({ color: 'azul', kind: 'brush', width: 'thin' });
    expect(machine.getPenSettings()).toEqual({ color: '#3b82f6', kind: 'pen', width: 'thin' });
    machine.setPenSettings({ color: '#12345', kind: 7, width: null });
    expect(machine.getPenSettings()).toEqual({ color: '#3b82f6', kind: 'pen', width: 'thin' });
    machine.setPenSettings({ color: '#11223380' });
    expect(machine.getPenSettings().color).toBe('#11223380');
  });

  it('pinta o traço em tempo real e só cria o elemento ao soltar', () => {
    machine.process(pointer('POINTER_DOWN', 10, 20));
    expect(machine.getState()).toBe('drawing');
    expect(actions).toContainEqual({ type: 'CAPTURE_POINTER', pointerId: 1 });
    expect(section.getPreview()?.additions[0]).toMatchObject({ type: 'ink' });

    machine.process(pointer('POINTER_MOVE', 60, 40));
    machine.process(pointer('POINTER_MOVE', 110, 20));
    const preview = section.getPreview()!.additions[0] as unknown as {
      strokes: Array<{ points: unknown[] }>;
    };
    expect(preview.strokes[0]!.points).toHaveLength(3);
    expect(inks()).toHaveLength(0);

    machine.process(pointer('POINTER_UP', 110, 20));
    expect(machine.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
    expect(inks()).toHaveLength(1);
    expect(actions).toContainEqual({ type: 'RELEASE_POINTER', pointerId: 1 });
  });

  it('um gesto com 500 eventos gera uma só entrada de histórico e menos pontos que o bruto', () => {
    const before = section.getSnapshot().revision;
    machine.process(pointer('POINTER_DOWN', 0, 100));
    for (let i = 1; i <= 500; i++) {
      machine.process(pointer('POINTER_MOVE', i, 100 + Math.sin(i / 40) * 30));
    }
    machine.process(pointer('POINTER_UP', 500, 100));

    expect(section.getSnapshot().revision).toBe(before + 1);
    const [ink] = inks();
    expect(ink!.strokes).toHaveLength(1);
    const count = ink!.strokes[0]!.points.length;
    expect(count).toBeGreaterThan(5);
    expect(count).toBeLessThan(500);
  });

  it('um traço de 5.000 amostras (coalescidas) fica com até 2.000 pontos', () => {
    machine.process(pointer('POINTER_DOWN', 0, 0));
    // 50 eventos de 100 amostras cada: o navegador entrega as intermediárias junto do evento.
    for (let batch = 0; batch < 50; batch++) {
      const coalescedPoints = Array.from({ length: 100 }, (_, k) => {
        const i = batch * 100 + k + 1;
        return { x: i * 0.2, y: Math.sin(i / 7) * 40 + (i % 3) };
      });
      machine.process({
        type: 'POINTER_MOVE',
        pointerId: 1,
        point: coalescedPoints[99]!,
        buttons: 1,
        coalescedPoints,
      });
    }
    // O preview em andamento cabe nos limites do canvas mesmo com mais de 2.000 amostras.
    const preview = section.getPreview()!.additions[0] as unknown as {
      strokes: Array<{ points: unknown[] }>;
    };
    expect(preview.strokes[0]!.points.length).toBeLessThanOrEqual(2000);
    expect(preview.strokes[0]!.points.length).toBeGreaterThan(1000);
    machine.process(pointer('POINTER_UP', 1000, 0));
    const [ink] = inks();
    expect(ink!.strokes[0]!.points.length).toBeLessThanOrEqual(2000);
    expect(ink!.strokes[0]!.points.length).toBeGreaterThan(50);
  });

  it('as amostras coalescidas entram todas, na ordem, e um evento sem elas usa o ponto', () => {
    machine.process(pointer('POINTER_DOWN', 0, 0));
    machine.process({
      type: 'POINTER_MOVE',
      pointerId: 1,
      point: { x: 30, y: 30 },
      buttons: 1,
      coalescedPoints: [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
        { x: 30, y: 30 },
      ],
    });
    machine.process({
      type: 'POINTER_MOVE',
      pointerId: 1,
      point: { x: 40, y: 40 },
      buttons: 1,
      coalescedPoints: [],
    });
    const preview = section.getPreview()!.additions[0] as unknown as {
      x: number;
      width: number;
      strokes: Array<{ points: Array<{ x: number; y: number }> }>;
    };
    const worldX = preview.strokes[0]!.points.map((p) =>
      Math.round(preview.x + p.x * preview.width),
    );
    expect(worldX).toEqual([0, 10, 20, 30, 40]);
  });

  it('um clique sem movimento cria um pingo de um ponto', () => {
    machine.process(pointer('POINTER_DOWN', 50, 50));
    machine.process(pointer('POINTER_UP', 50, 50));
    const [ink] = inks();
    expect(ink!.strokes[0]!.points).toHaveLength(1);
    expect(ink!.strokes[0]!.points[0]).toEqual({ x: 0.5, y: 0.5 });
  });

  it('um tremor menor que a tolerância também é um pingo', () => {
    machine.process(pointer('POINTER_DOWN', 50, 50));
    machine.process(pointer('POINTER_MOVE', 50.3, 50.2));
    machine.process(pointer('POINTER_UP', 50.3, 50.2));
    expect(inks()[0]!.strokes[0]!.points).toHaveLength(1);
  });

  it('a tolerância da simplificação é 0,75 CSS px dividido pelo zoom', () => {
    section.setViewport({ x: 0, y: 0, zoom: 4 });
    // Em zoom 4, 0,75 CSS px são 0,1875 de mundo: um desvio de 1 de mundo (4 px) fica.
    machine.process(pointer('POINTER_DOWN', 0, 0));
    machine.process(pointer('POINTER_MOVE', 200, 4));
    machine.process(pointer('POINTER_MOVE', 400, 0));
    machine.process(pointer('POINTER_UP', 400, 0));
    expect(inks()[0]!.strokes[0]!.points).toHaveLength(3);

    section.undo();
    section.setViewport({ x: 0, y: 0, zoom: 1 });
    // Em zoom 1, o mesmo desvio de 1 de mundo passa de 0,75 e fica; um de 0,5 some.
    machine.process(pointer('POINTER_DOWN', 0, 0));
    machine.process(pointer('POINTER_MOVE', 100, 0.5));
    machine.process(pointer('POINTER_MOVE', 200, 0));
    machine.process(pointer('POINTER_UP', 200, 0));
    expect(inks()[inks().length - 1]!.strokes[0]!.points).toHaveLength(2);
  });

  it('três gestos seguidos formam um elemento e três entradas de histórico', () => {
    const before = section.getSnapshot().revision;
    stroke(10, 100, 10);
    stroke(10, 100, 60);
    stroke(10, 100, 110);
    expect(inks()).toHaveLength(1);
    expect(inks()[0]!.strokes).toHaveLength(3);
    expect(section.getSnapshot().revision).toBe(before + 3);
  });

  it('desfazer remove o último traço, depois o anterior, e por fim o elemento', () => {
    stroke(10, 100, 10);
    stroke(10, 100, 60);
    section.undo();
    expect(inks()[0]!.strokes).toHaveLength(1);
    section.undo();
    expect(inks()).toHaveLength(0);
    // O elemento sumiu: o próximo traço cria outro.
    stroke(10, 100, 10);
    expect(inks()).toHaveLength(1);
    section.redo();
  });

  it('trocar de ferramenta e voltar inicia outro elemento', () => {
    stroke(10, 100, 10);
    section.setTool('select');
    section.setTool('pen');
    stroke(10, 100, 60);
    expect(inks()).toHaveLength(2);
  });

  it('desfazer o primeiro traço de um elemento com dois e continuar mantém o elemento', () => {
    stroke(10, 100, 10);
    stroke(10, 100, 60);
    section.undo();
    stroke(10, 100, 110);
    expect(inks()).toHaveLength(1);
    expect(inks()[0]!.strokes).toHaveLength(2);
  });

  it('um elemento apagado por fora faz o próximo traço criar outro', () => {
    stroke(10, 100, 10);
    section.dispatch({ type: 'shape.remove', id: inks()[0]!.id });
    stroke(10, 100, 60);
    expect(inks()).toHaveLength(1);
    expect(inks()[0]!.strokes).toHaveLength(1);
  });

  it('as configurações valem por traço: cada traço guarda as suas', () => {
    machine.setPenSettings({ color: '#ef4444', kind: 'marker', width: 'thick' });
    stroke(10, 100, 10);
    machine.setPenSettings({ color: '#3b82f6', kind: 'highlighter', width: 'thin' });
    stroke(10, 100, 60);
    const [ink] = inks();
    expect(ink!.strokes[0]).toMatchObject({ color: '#ef4444', kind: 'marker', width: 'thick' });
    expect(ink!.strokes[1]).toMatchObject({ color: '#3b82f6', kind: 'highlighter', width: 'thin' });
  });

  it('mudar a caneta no meio do gesto vale só para o próximo traço', () => {
    machine.process(pointer('POINTER_DOWN', 10, 10));
    machine.process(pointer('POINTER_MOVE', 60, 40));
    machine.setPenSettings({ color: '#ef4444' });
    machine.process(pointer('POINTER_UP', 110, 10));
    expect(inks()[0]!.strokes[0]!.color).toBe('#1f2937');
    stroke(10, 100, 100);
    expect(inks()[0]!.strokes[1]!.color).toBe('#ef4444');
  });

  it('um traço fora da caixa atual faz o elemento crescer e preserva os pontos antigos', () => {
    stroke(100, 200, 100);
    const first = inks()[0]!;
    const worldBefore = first.x + first.strokes[0]!.points[0]!.x * first.width;
    stroke(10, 400, 300);
    const [ink] = inks();
    expect(ink!.width).toBeGreaterThan(first.width);
    expect(ink!.height).toBeGreaterThan(first.height);
    expect(ink!.x + ink!.strokes[0]!.points[0]!.x * ink!.width).toBeCloseTo(worldBefore, 6);
  });

  it('Esc descarta o traço em andamento sem histórico nem elemento', () => {
    const before = section.getSnapshot().revision;
    machine.process(pointer('POINTER_DOWN', 10, 10));
    machine.process(pointer('POINTER_MOVE', 60, 40));
    machine.process({ type: 'KEY_DOWN', key: 'Escape', code: 'Escape' });
    expect(machine.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
    expect(inks()).toHaveLength(0);
    expect(section.getSnapshot().revision).toBe(before);
    expect(actions).toContainEqual({ type: 'RELEASE_POINTER', pointerId: 1 });
  });

  it('pointercancel descarta o traço, mas só o do ponteiro do gesto', () => {
    machine.process(pointer('POINTER_DOWN', 10, 10));
    machine.process({ type: 'POINTER_CANCEL', pointerId: 2 });
    expect(machine.getState()).toBe('drawing');
    machine.process({ type: 'POINTER_CANCEL', pointerId: 1 });
    expect(machine.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
    expect(inks()).toHaveLength(0);
  });

  it('ignora movimento e soltura de outro ponteiro', () => {
    machine.process(pointer('POINTER_DOWN', 10, 10));
    machine.process(pointer('POINTER_MOVE', 500, 500, 2));
    machine.process(pointer('POINTER_UP', 500, 500, 2));
    expect(machine.getState()).toBe('drawing');
    machine.process(pointer('POINTER_UP', 10, 10));
    expect(inks()[0]!.strokes[0]!.points).toHaveLength(1);
  });

  it('destruir a máquina no meio do gesto descarta o traço', () => {
    machine.process(pointer('POINTER_DOWN', 10, 10));
    machine.process(pointer('POINTER_MOVE', 60, 40));
    machine.process({ type: 'DESTROY' });
    expect(machine.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
    expect(inks()).toHaveLength(0);
  });

  it('pointer down com outro botão não desenha', () => {
    machine.process(down(10, 10, { button: 2 }));
    expect(machine.getState()).toBe('idle');
  });

  it('com a mão ou o Espaço, panorâmica no lugar de desenho', () => {
    machine.process(down(10, 10, { spaceKey: true }));
    expect(machine.getState()).toBe('panning');
  });

  it('o zoom entra na conversão do ponto de tela para mundo', () => {
    section.setViewport({ x: 100, y: 50, zoom: 2 });
    machine.process(pointer('POINTER_DOWN', 120, 70));
    machine.process(pointer('POINTER_UP', 120, 70));
    const [ink] = inks();
    // (120 − 100) / 2 = 10 e (70 − 50) / 2 = 10; a caixa é o pingo mais meia espessura.
    expect(ink!.x + ink!.width / 2).toBeCloseTo(10, 9);
    expect(ink!.y + ink!.height / 2).toBeCloseTo(10, 9);
  });
});

describe('InteractionStateMachine: caneta com limites e bloqueios', () => {
  let section: CanvasSectionApi;
  let machine: InteractionStateMachine;

  const inks = (): InkNode[] =>
    Object.values(section.getSnapshot().document.nodes).filter(
      (node): node is InkNode => node.type === 'ink',
    );
  const dab = (x: number, y: number): void => {
    machine.process(pointer('POINTER_DOWN', x, y));
    machine.process(pointer('POINTER_UP', x, y));
  };

  beforeEach(() => {
    section = createCanvasSection();
    machine = new InteractionStateMachine(section);
    section.setTool('pen');
  });

  it('readOnly não desenha', () => {
    section.setReadOnly(true);
    machine.process(pointer('POINTER_DOWN', 10, 10));
    expect(machine.getState()).toBe('idle');
    expect(inks()).toHaveLength(0);
  });

  it('sem camada visível e desbloqueada não desenha', () => {
    const layer = section.getSnapshot().document.layers[0]!;
    section.dispatch({ type: 'layer.update', id: layer.id, patch: { locked: true } });
    machine.process(pointer('POINTER_DOWN', 10, 10));
    expect(machine.getState()).toBe('idle');
    expect(inks()).toHaveLength(0);
  });

  it('um elemento bloqueado não recebe o traço: o próximo cria outro', () => {
    dab(10, 10);
    const [first] = inks();
    section.dispatch({ type: 'shape.update', id: first!.id, patch: { locked: true } });
    dab(200, 200);
    expect(inks()).toHaveLength(2);
    expect(section.getSnapshot().document.nodes[first!.id]).toMatchObject({
      strokes: first!.strokes,
    });
  });

  it('um elemento oculto também não recebe o traço', () => {
    dab(10, 10);
    const [first] = inks();
    section.dispatch({ type: 'shape.update', id: first!.id, patch: { visible: false } });
    dab(200, 200);
    expect(inks()).toHaveLength(2);
  });

  it('o 501º traço inicia outro elemento', () => {
    for (let i = 0; i < 500; i++) dab(i, 0);
    expect(inks()).toHaveLength(1);
    expect(inks()[0]!.strokes).toHaveLength(500);
    dab(600, 0);
    expect(inks()).toHaveLength(2);
    expect(
      inks()
        .map((ink) => ink.strokes.length)
        .sort((a, b) => a - b),
    ).toEqual([1, 500]);
  });

  it('um traço que estouraria 20.000 pontos inicia outro elemento', () => {
    // Dez traços de 2.000 pontos enchem o elemento até o teto.
    const full = Array.from({ length: 10 }, (_, s) => ({
      points: Array.from({ length: 2_000 }, (_, i) => ({ x: i * 0.5, y: s * 100 + (i % 2) * 40 })),
    }));
    expect(
      section.dispatch({ type: 'shape.create', shape: { id: 'cheio', type: 'ink', strokes: full } })
        .ok,
    ).toBe(true);
    // O elemento cheio não é o corrente (foi criado por fora): o traço começa um novo.
    dab(5, 5);
    expect(inks()).toHaveLength(2);

    // Já o elemento corrente que chegar ao teto é deixado para trás.
    const current = inks().find((ink) => ink.id !== 'cheio')!;
    section.dispatch({
      type: 'shape.update',
      id: current.id,
      patch: {
        strokes: Array.from({ length: 10 }, () => ({
          points: Array.from({ length: 2_000 }, (_, i) => ({ x: (i % 100) / 100, y: 0.5 })),
          color: '#000000',
          kind: 'pen',
          width: 'thin',
        })),
      } as never,
    });
    dab(300, 300);
    expect(inks()).toHaveLength(3);
  });
});
