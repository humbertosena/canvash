import { createCanvasSection, type ChevronNode } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { matchKeyboardShortcut } from '../keyboard.js';
import { InteractionStateMachine } from '../state-machine.js';
import { toPreviewShape } from '../transform.js';
import { findAnchorTargetAtPoint } from './arrow.js';
import { buildCreateShapeInput, buildPreviewShape, computeCreationGeometry } from './create.js';
import { buildResizePreview, getLockedAspectRatio, resizeShape } from './resize.js';
import { rotateShapes } from './rotate.js';

const CHEVRON: ChevronNode = {
  id: 'cv',
  type: 'chevron',
  x: 100,
  y: 100,
  width: 120,
  height: 60,
  rotation: 0,
  direction: 'left',
  notchDepth: 0.3,
  visible: true,
  locked: false,
  style: { fill: '#3b82f6', stroke: '#000000', strokeWidth: 2, opacity: 1 },
};

describe('criação do chevron', () => {
  it('cria pela regra do retângulo: caixa livre sem Shift, 1:1 com Shift', () => {
    const free = computeCreationGeometry({
      tool: 'chevron',
      startWorld: { x: 100, y: 100 },
      currentWorld: { x: 40, y: 130 },
      shiftKey: false,
    });
    expect(free).toEqual({ type: 'chevron', x: 40, y: 100, width: 60, height: 30, rotation: 0 });

    const locked = computeCreationGeometry({
      tool: 'chevron',
      startWorld: { x: 100, y: 100 },
      currentWorld: { x: 40, y: 130 },
      shiftKey: true,
    });
    expect(locked).toMatchObject({ width: 60, height: 60 });
  });

  it('gera a entrada e o preview com direção e profundidade padrão do core', () => {
    const geometry = computeCreationGeometry({
      tool: 'chevron',
      startWorld: { x: 0, y: 0 },
      currentWorld: { x: 50, y: 40 },
      shiftKey: false,
    });
    expect(buildCreateShapeInput(geometry)).toEqual({
      type: 'chevron',
      x: 0,
      y: 0,
      width: 50,
      height: 40,
      rotation: 0,
    });
    expect(buildPreviewShape(geometry)).toMatchObject({ type: 'chevron', width: 50 });
  });

  it('a ferramenta chevron cria o nó pela máquina de estados e não tem atalho', () => {
    const section = createCanvasSection();
    const machine = new InteractionStateMachine(section);
    section.setTool('chevron');
    expect(machine.getIdleCursor()).toBe('crosshair');

    machine.process({
      type: 'POINTER_DOWN',
      pointerId: 6,
      pointerType: 'mouse',
      point: { x: 20, y: 30 },
      button: 0,
      buttons: 1,
      shiftKey: false,
      spaceKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    });
    machine.process({ type: 'POINTER_MOVE', pointerId: 6, point: { x: 120, y: 90 }, buttons: 1 });
    expect(section.getPreview()?.additions[0]).toMatchObject({ type: 'chevron' });
    machine.process({ type: 'POINTER_UP', pointerId: 6, point: { x: 120, y: 90 }, button: 0 });

    const [id] = section.getSnapshot().session.selectedIds;
    expect(section.getSnapshot().document.nodes[id!]).toMatchObject({
      type: 'chevron',
      direction: 'right',
      notchDepth: 0.25,
      x: 20,
      y: 30,
      width: 100,
      height: 60,
    });
    for (const key of ['v', 'V', 'e', 'E', '>']) {
      expect(matchKeyboardShortcut({ key })).toBeNull();
    }
  });
});

describe('redimensionamento e preview do chevron', () => {
  it('não trava a proporção e, com Shift, preserva a que a caixa tem', () => {
    expect(getLockedAspectRatio(CHEVRON)).toBeUndefined();

    const free = resizeShape(CHEVRON, 'se', { x: 300, y: 180 }) as ChevronNode;
    expect(free).toMatchObject({ direction: 'left', notchDepth: 0.3, width: 200, height: 80 });

    const kept = resizeShape(
      CHEVRON,
      'se',
      { x: 340, y: 190 },
      {
        preserveAspectRatio: true,
      },
    ) as ChevronNode;
    expect(kept.width / kept.height).toBeCloseTo(2, 9);
  });

  it('os previews de resize e de movimentação levam a direção e a profundidade', () => {
    expect(buildResizePreview({ ...CHEVRON, width: 150 })).toMatchObject({
      type: 'chevron',
      direction: 'left',
      notchDepth: 0.3,
      width: 150,
    });
    expect(toPreviewShape(CHEVRON)).toMatchObject({
      type: 'chevron',
      direction: 'left',
      notchDepth: 0.3,
    });
  });

  it('gira como qualquer figura de caixa, sem tocar na direção', () => {
    const [turned] = rotateShapes([CHEVRON], { x: 160, y: 130 }, Math.PI / 2);
    expect(turned).toMatchObject({ type: 'chevron', direction: 'left', rotation: Math.PI / 2 });
  });
});

describe('vínculo de seta com o chevron', () => {
  it('vincula no corpo e não vincula no entalhe', () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'cv',
        type: 'chevron',
        x: 0,
        y: 0,
        width: 90,
        height: 90,
        rotation: 0,
        direction: 'right',
        notchDepth: 0.25,
        style: { fill: '#3b82f6' },
      },
    });
    const document = section.getSnapshot().document;
    const hitTest = (point: { x: number; y: number }) =>
      section.hitTest(point, { includePreview: false });

    expect(findAnchorTargetAtPoint({ x: 45, y: 20 }, document, hitTest)).toMatchObject({
      targetId: 'cv',
    });
    expect(findAnchorTargetAtPoint({ x: 8, y: 45 }, document, hitTest)).toBeUndefined();
  });
});
