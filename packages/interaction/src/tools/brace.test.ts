import { createCanvasSection, type BraceNode } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { matchKeyboardShortcut } from '../keyboard.js';
import { InteractionStateMachine } from '../state-machine.js';
import { toPreviewShape } from '../transform.js';
import { findAnchorTargetAtPoint } from './arrow.js';
import { buildCreateShapeInput, buildPreviewShape, computeCreationGeometry } from './create.js';
import { buildResizePreview, getLockedAspectRatio, resizeShape } from './resize.js';
import { scaleShapeUniform } from './resize-multiple.js';
import { rotateShapes } from './rotate.js';

const BRACE: BraceNode = {
  id: 'br',
  type: 'brace',
  x: 100,
  y: 100,
  width: 40,
  height: 160,
  rotation: 0,
  orientation: 'right',
  tipPosition: 0.3,
  curvature: 0.8,
  visible: true,
  locked: false,
  style: { stroke: '#7c3aed', strokeWidth: 5, opacity: 1 },
};

describe('criação da chave', () => {
  it('cria pela regra do retângulo: caixa livre sem Shift, 1:1 com Shift', () => {
    expect(
      computeCreationGeometry({
        tool: 'brace',
        startWorld: { x: 100, y: 100 },
        currentWorld: { x: 40, y: 130 },
        shiftKey: false,
      }),
    ).toEqual({ type: 'brace', x: 40, y: 100, width: 60, height: 30, rotation: 0 });
    expect(
      computeCreationGeometry({
        tool: 'brace',
        startWorld: { x: 100, y: 100 },
        currentWorld: { x: 40, y: 130 },
        shiftKey: true,
      }),
    ).toMatchObject({ width: 60, height: 60 });
  });

  it('o preview e a entrada não levam preenchimento nem parâmetros além do padrão do core', () => {
    const geometry = computeCreationGeometry({
      tool: 'brace',
      startWorld: { x: 0, y: 0 },
      currentWorld: { x: 50, y: 120 },
      shiftKey: false,
    });
    expect(buildCreateShapeInput(geometry)).toEqual({
      type: 'brace',
      x: 0,
      y: 0,
      width: 50,
      height: 120,
      rotation: 0,
    });
    const preview = buildPreviewShape(geometry);
    expect(preview).toMatchObject({ type: 'brace', width: 50, height: 120 });
    expect(preview.style).toEqual({ stroke: '#2563eb', strokeWidth: 2, opacity: 0.8 });
  });

  it('a ferramenta brace cria a chave pela máquina de estados e não tem atalho', () => {
    const section = createCanvasSection();
    const machine = new InteractionStateMachine(section);
    section.setTool('brace');
    expect(machine.getIdleCursor()).toBe('crosshair');

    machine.process({
      type: 'POINTER_DOWN',
      pointerId: 7,
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
    machine.process({ type: 'POINTER_MOVE', pointerId: 7, point: { x: 60, y: 190 }, buttons: 1 });
    expect(section.getPreview()?.additions[0]).toMatchObject({ type: 'brace' });
    machine.process({ type: 'POINTER_UP', pointerId: 7, point: { x: 60, y: 190 }, button: 0 });

    const [id] = section.getSnapshot().session.selectedIds;
    expect(section.getSnapshot().document.nodes[id!]).toMatchObject({
      type: 'brace',
      orientation: 'left',
      tipPosition: 0.5,
      curvature: 0.5,
      x: 20,
      y: 30,
      width: 40,
      height: 160,
    });
    for (const key of ['{', '}', '[', ']', 'b', 'B']) {
      expect(matchKeyboardShortcut({ key })).toBeNull();
    }
  });
});

describe('redimensionamento, rotação e escala da chave', () => {
  it('não trava a proporção e, ao esticar, a espessura do traço não muda', () => {
    expect(getLockedAspectRatio(BRACE)).toBeUndefined();
    const stretched = resizeShape(BRACE, 'se', { x: 300, y: 500 }) as BraceNode;
    expect(stretched).toMatchObject({
      width: 200,
      height: 400,
      orientation: 'right',
      tipPosition: 0.3,
      curvature: 0.8,
      style: { strokeWidth: 5 },
    });
  });

  it('Shift preserva a proporção atual da caixa', () => {
    const kept = resizeShape(
      BRACE,
      'se',
      { x: 260, y: 400 },
      {
        preserveAspectRatio: true,
      },
    ) as BraceNode;
    expect(kept.width / kept.height).toBeCloseTo(0.25, 9);
  });

  it('os previews de resize e de movimentação levam os parâmetros e o traço', () => {
    expect(buildResizePreview({ ...BRACE, height: 300 })).toMatchObject({
      type: 'brace',
      orientation: 'right',
      tipPosition: 0.3,
      curvature: 0.8,
      height: 300,
      style: { stroke: '#7c3aed', strokeWidth: 5 },
    });
    expect(toPreviewShape(BRACE)).toMatchObject({
      type: 'brace',
      orientation: 'right',
      tipPosition: 0.3,
      curvature: 0.8,
    });
  });

  it('a escala uniforme muda a caixa e mantém a espessura do traço', () => {
    const scaled = scaleShapeUniform(BRACE, { x: 100, y: 100 }, 2) as BraceNode;
    expect(scaled).toMatchObject({ width: 80, height: 320, style: { strokeWidth: 5 } });
  });

  it('gira como figura de caixa, sem tocar nos parâmetros', () => {
    const [turned] = rotateShapes([BRACE], { x: 120, y: 180 }, Math.PI / 2);
    expect(turned).toMatchObject({
      type: 'brace',
      rotation: Math.PI / 2,
      orientation: 'right',
      curvature: 0.8,
    });
  });
});

describe('vínculo de seta com a chave', () => {
  it('a chave não é alvo de vínculo, mesmo com o ponteiro sobre o traço', () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'br',
        type: 'brace',
        x: 0,
        y: 0,
        width: 100,
        height: 200,
        rotation: 0,
        curvature: 1,
        style: { strokeWidth: 6 },
      },
    });
    const hitTest = (point: { x: number; y: number }) =>
      section.hitTest(point, { includePreview: false });

    // O ponteiro está sobre a ponta, que o hit-test atinge...
    expect(hitTest({ x: 1, y: 100 })).toBe('br');
    // ...mas a seta não se vincula a ela.
    expect(
      findAnchorTargetAtPoint({ x: 1, y: 100 }, section.getSnapshot().document, hitTest),
    ).toBeUndefined();
  });
});
