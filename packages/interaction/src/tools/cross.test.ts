import { createCanvasSection, type CrossNode } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { InteractionStateMachine } from '../state-machine.js';
import { matchKeyboardShortcut } from '../keyboard.js';
import { findAnchorTargetAtPoint } from './arrow.js';
import { buildCreateShapeInput, buildPreviewShape, computeCreationGeometry } from './create.js';
import { buildResizePreview, resizeShape, type ResizeHandleId } from './resize.js';
import { scaleShapeUniform } from './resize-multiple.js';
import { buildRotatePatch, getRotationCenter, rotateShapes } from './rotate.js';
import { toPreviewShape } from '../transform.js';

const CROSS: CrossNode = {
  id: 'cr',
  type: 'cross',
  x: 100,
  y: 100,
  width: 120,
  height: 60,
  rotation: 0,
  armRatio: 0.4,
  visible: true,
  locked: false,
  style: { fill: '#ff8800', stroke: '#000000', strokeWidth: 2, opacity: 1 },
};

describe('criação da cruz', () => {
  it('cria pela regra do retângulo nos 4 quadrantes e livre sem Shift', () => {
    const start = { x: 100, y: 100 };
    const cases = [
      { to: { x: 160, y: 130 }, x: 100, y: 100 },
      { to: { x: 40, y: 130 }, x: 40, y: 100 },
      { to: { x: 160, y: 70 }, x: 100, y: 70 },
      { to: { x: 40, y: 70 }, x: 40, y: 70 },
    ];
    for (const c of cases) {
      const geometry = computeCreationGeometry({
        tool: 'cross',
        startWorld: start,
        currentWorld: c.to,
        shiftKey: false,
      });
      expect(geometry).toEqual({
        type: 'cross',
        x: c.x,
        y: c.y,
        width: 60,
        height: 30,
        rotation: 0,
      });
    }
  });

  it('Shift força a caixa 1:1, pelo lado maior', () => {
    const geometry = computeCreationGeometry({
      tool: 'cross',
      startWorld: { x: 100, y: 100 },
      currentWorld: { x: 40, y: 130 },
      shiftKey: true,
    });
    expect(geometry).toEqual({ type: 'cross', x: 40, y: 100, width: 60, height: 60, rotation: 0 });
  });

  it('gera a entrada e o preview da cruz com o armRatio padrão do core', () => {
    const geometry = computeCreationGeometry({
      tool: 'cross',
      startWorld: { x: 0, y: 0 },
      currentWorld: { x: 50, y: 40 },
      shiftKey: false,
    });
    expect(buildCreateShapeInput(geometry)).toEqual({
      type: 'cross',
      x: 0,
      y: 0,
      width: 50,
      height: 40,
      rotation: 0,
    });
    expect(buildPreviewShape(geometry)).toMatchObject({ type: 'cross', width: 50, height: 40 });
  });

  it('a ferramenta cross cria uma cruz pela máquina de estados e não tem atalho', () => {
    const section = createCanvasSection();
    const machine = new InteractionStateMachine(section);
    section.setTool('cross');
    expect(machine.getIdleCursor()).toBe('crosshair');

    machine.process({
      type: 'POINTER_DOWN',
      pointerId: 5,
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
    machine.process({ type: 'POINTER_MOVE', pointerId: 5, point: { x: 120, y: 90 }, buttons: 1 });
    expect(section.getPreview()?.additions[0]).toMatchObject({
      type: 'cross',
      width: 100,
      height: 60,
    });
    machine.process({ type: 'POINTER_UP', pointerId: 5, point: { x: 120, y: 90 }, button: 0 });

    const [id] = section.getSnapshot().session.selectedIds;
    expect(section.getSnapshot().document.nodes[id!]).toMatchObject({
      type: 'cross',
      armRatio: 1 / 3,
      x: 20,
      y: 30,
      width: 100,
      height: 60,
    });

    for (const key of ['x', 'X', '+', 'k', 'K']) {
      expect(matchKeyboardShortcut({ key })).toBeNull();
    }
  });
});

describe('redimensionamento da cruz', () => {
  const targets: Record<ResizeHandleId, { x: number; y: number }> = {
    nw: { x: 60, y: 80 },
    n: { x: 160, y: 40 },
    ne: { x: 260, y: 90 },
    e: { x: 280, y: 130 },
    se: { x: 270, y: 230 },
    s: { x: 160, y: 250 },
    sw: { x: 70, y: 220 },
    w: { x: 30, y: 130 },
  } as never;

  it('sem Shift o resize é livre e mantém o armRatio', () => {
    const resized = resizeShape(CROSS, 'se', { x: 300, y: 180 }) as CrossNode;
    expect(resized).toMatchObject({ type: 'cross', armRatio: 0.4, width: 200, height: 80 });
  });

  it('com Shift as 8 alças deixam a caixa 1:1, também com a cruz girada', () => {
    for (const rotation of [0, Math.PI / 4]) {
      const node = { ...CROSS, rotation };
      for (const [handle, point] of Object.entries(targets)) {
        const resized = resizeShape(node, handle as ResizeHandleId, point, {
          preserveAspectRatio: true,
        }) as CrossNode;
        expect(resized.type).toBe('cross');
        expect(resized.armRatio).toBe(0.4);
        expect(resized.width).toBeCloseTo(resized.height, 9);
      }
    }
  });

  it('o preview do resize e o da movimentação levam o armRatio', () => {
    expect(buildResizePreview({ ...CROSS, width: 150 })).toMatchObject({
      id: 'cr',
      type: 'cross',
      armRatio: 0.4,
      width: 150,
    });
    expect(toPreviewShape(CROSS)).toMatchObject({ id: 'cr', type: 'cross', armRatio: 0.4 });
  });
});

describe('seleção múltipla, rotação e vínculo de seta com a cruz', () => {
  it('a escala uniforme muda caixa e posição e preserva armRatio e rotação', () => {
    const scaled = scaleShapeUniform(
      { ...CROSS, rotation: 0.3 },
      { x: 100, y: 100 },
      2,
    ) as CrossNode;
    expect(scaled).toMatchObject({
      type: 'cross',
      armRatio: 0.4,
      rotation: 0.3,
      width: 240,
      height: 120,
    });
    expect(scaled.x + scaled.width / 2).toBeCloseTo(100 + (160 - 100) * 2, 9);
  });

  it('gira a cruz sozinha em torno do centro e monta o patch só com x, y e rotação', () => {
    expect(getRotationCenter([CROSS])).toEqual({ x: 160, y: 130 });
    const [turned] = rotateShapes([CROSS], { x: 160, y: 130 }, Math.PI / 2);
    expect(turned).toMatchObject({ type: 'cross', rotation: Math.PI / 2, armRatio: 0.4 });
    expect(buildRotatePatch(turned!)).toEqual({
      x: 100,
      y: 100,
      rotation: Math.PI / 2,
    });
  });

  it('a seta vincula-se à cruz sob o ponteiro', () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'cr',
        type: 'cross',
        x: 0,
        y: 0,
        width: 90,
        height: 90,
        rotation: 0,
        style: { fill: '#ff8800' },
      },
    });

    const hit = findAnchorTargetAtPoint({ x: 45, y: 45 }, section.getSnapshot().document, (point) =>
      section.hitTest(point, { includePreview: false }),
    );
    expect(hit).toMatchObject({ targetId: 'cr', anchor: { x: 0.5, y: 0.5 } });

    // O canto vazio da caixa não é alvo.
    expect(
      findAnchorTargetAtPoint({ x: 4, y: 4 }, section.getSnapshot().document, (point) =>
        section.hitTest(point, { includePreview: false }),
      ),
    ).toBeUndefined();
  });
});
