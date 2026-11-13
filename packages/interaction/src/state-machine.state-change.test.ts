import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  InteractionStateMachine,
  type InteractionStateName,
  type PointerDownInput,
} from './state-machine.js';

const down = (x: number, y: number): PointerDownInput => ({
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
});

const move = (x: number, y: number, buttons = 1) =>
  ({ type: 'POINTER_MOVE', pointerId: 1, point: { x, y }, buttons }) as const;

const up = (x: number, y: number) =>
  ({ type: 'POINTER_UP', pointerId: 1, point: { x, y }, button: 0 }) as const;

describe('InteractionStateMachine: onStateChange', () => {
  let section: CanvasSectionApi;
  let states: InteractionStateName[];
  let machine: InteractionStateMachine;

  beforeEach(() => {
    section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'r1', type: 'rectangle', x: 100, y: 100, width: 100, height: 100, rotation: 0 },
    });
    states = [];
    machine = new InteractionStateMachine(section, {
      onStateChange: (name) => states.push(name),
    });
  });

  it('avisa cada transição uma vez, sem repetir o mesmo estado em seguida', () => {
    section.setSelection(['r1']);
    machine.process(down(150, 150));
    machine.process(move(160, 160));
    machine.process(move(170, 170));
    machine.process(up(170, 170));

    expect(states.length).toBeGreaterThanOrEqual(2);
    expect(states).toContain('moving');
    expect(states[states.length - 1]).toBe('idle');
    for (let i = 1; i < states.length; i += 1) expect(states[i]).not.toBe(states[i - 1]);
    // Os movimentos dentro do mesmo estado não geram aviso: são 2 movimentos e poucas transições.
    expect(states.filter((name) => name === 'moving')).toHaveLength(1);
  });

  it('não avisa nada com o ponteiro passando sobre o vazio, sem botão pressionado', () => {
    machine.process(move(10, 10, 0));
    machine.process(move(20, 20, 0));
    machine.process(move(150, 150, 0));

    expect(states).toEqual([]);
  });

  it('avisa a caneta desenhando e voltando a idle', () => {
    section.setTool('pen');

    machine.process(down(20, 20));
    machine.process(move(40, 30));
    machine.process(up(40, 30));

    expect(states).toEqual(['drawing', 'idle']);
  });

  it('Esc no meio do gesto volta a idle e avisa', () => {
    machine.process(down(150, 150));
    machine.process(move(170, 170));
    states.length = 0;

    machine.process({ type: 'KEY_DOWN', key: 'Escape', code: 'Escape' });

    expect(states).toEqual(['idle']);
  });

  it('getState() já devolve o novo estado quando o aviso chega', () => {
    const seen: Array<[InteractionStateName, InteractionStateName]> = [];
    const probe = new InteractionStateMachine(section, {
      onStateChange: (name) => seen.push([name, probe.getState()]),
    });

    probe.process(down(150, 150));
    probe.process(move(170, 170));
    probe.process(up(170, 170));

    expect(seen.length).toBeGreaterThan(0);
    for (const [name, current] of seen) expect(current).toBe(name);
  });

  it('sem a opção, a máquina funciona como antes', () => {
    const plain = new InteractionStateMachine(section);

    plain.process(down(150, 150));
    plain.process(move(170, 170));
    plain.process(up(170, 170));

    expect(plain.getState()).toBe('idle');
  });
});
