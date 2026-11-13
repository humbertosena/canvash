import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  computeClickSelection,
  executeClickSelection,
  isClickGesture,
  resolveSelectableId,
} from './select.js';

describe('isClickGesture', () => {
  it('considera movimento menor que 3 CSS px como click', () => {
    expect(isClickGesture({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(true);
    expect(isClickGesture({ x: 10, y: 10 }, { x: 12, y: 11 })).toBe(true); // dist: sqrt(2^2 + 1^2) = 2.23 < 3
  });

  it('reprova movimento igual ou maior que 3 CSS px', () => {
    expect(isClickGesture({ x: 10, y: 10 }, { x: 13, y: 10 })).toBe(false); // dist: 3
    expect(isClickGesture({ x: 10, y: 10 }, { x: 13, y: 14 })).toBe(false); // dist: 5
  });

  it('respeita threshold customizado', () => {
    expect(isClickGesture({ x: 0, y: 0 }, { x: 4, y: 0 }, 5)).toBe(true);
    expect(isClickGesture({ x: 0, y: 0 }, { x: 6, y: 0 }, 5)).toBe(false);
  });
});

describe('computeClickSelection', () => {
  it('sem hitId e sem shift limpa a seleção', () => {
    expect(computeClickSelection(['shape-1', 'shape-2'], undefined, false)).toEqual([]);
  });

  it('sem hitId com shift mantém a seleção existente', () => {
    expect(computeClickSelection(['shape-1', 'shape-2'], undefined, true)).toEqual([
      'shape-1',
      'shape-2',
    ]);
  });

  it('com hitId e sem shift seleciona exclusivamente o shape atingido', () => {
    expect(computeClickSelection(['shape-1'], 'shape-2', false)).toEqual(['shape-2']);
    expect(computeClickSelection([], 'shape-1', false)).toEqual(['shape-1']);
  });

  it('com hitId e com shift adiciona shape que não estava selecionado', () => {
    expect(computeClickSelection(['shape-1'], 'shape-2', true)).toEqual(['shape-1', 'shape-2']);
  });

  it('com hitId e com shift remove shape que já estava selecionado (toggle)', () => {
    expect(computeClickSelection(['shape-1', 'shape-2'], 'shape-1', true)).toEqual(['shape-2']);
    expect(computeClickSelection(['shape-1'], 'shape-1', true)).toEqual([]);
  });
});

describe('executeClickSelection com CanvasSectionApi real', () => {
  let section: CanvasSectionApi;

  beforeEach(() => {
    section = createCanvasSection();
    // Cria shape 1
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-1',
        type: 'rectangle',
        x: 10,
        y: 10,
        width: 100,
        height: 100,
        rotation: 0,
      },
    });
    // Cria shape 2
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-2',
        type: 'rectangle',
        x: 150,
        y: 10,
        width: 100,
        height: 100,
        rotation: 0,
      },
    });
    // Cria shape bloqueado
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-locked',
        type: 'rectangle',
        x: 300,
        y: 10,
        width: 100,
        height: 100,
        rotation: 0,
        locked: true,
      },
    });
    // Cria shape oculto
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-hidden',
        type: 'rectangle',
        x: 450,
        y: 10,
        width: 100,
        height: 100,
        rotation: 0,
        visible: false,
      },
    });
  });

  it('clicar sobre rect-1 seleciona rect-1', () => {
    executeClickSelection(section, { x: 50, y: 50 }, false);
    expect(section.getSnapshot().session.selectedIds).toEqual(['rect-1']);
  });

  it('clicar sobre rect-2 sem shift substitui a seleção por rect-2', () => {
    section.setSelection(['rect-1']);
    executeClickSelection(section, { x: 180, y: 50 }, false);
    expect(section.getSnapshot().session.selectedIds).toEqual(['rect-2']);
  });

  it('clicar sobre rect-2 com shift acumula na seleção', () => {
    section.setSelection(['rect-1']);
    executeClickSelection(section, { x: 180, y: 50 }, true);
    expect(section.getSnapshot().session.selectedIds).toEqual(['rect-1', 'rect-2']);
  });

  it('clicar novamente sobre rect-1 com shift desmarca rect-1', () => {
    section.setSelection(['rect-1', 'rect-2']);
    executeClickSelection(section, { x: 50, y: 50 }, true);
    expect(section.getSnapshot().session.selectedIds).toEqual(['rect-2']);
  });

  it('clicar no vazio sem shift limpa a seleção', () => {
    section.setSelection(['rect-1']);
    executeClickSelection(section, { x: 800, y: 800 }, false);
    expect(section.getSnapshot().session.selectedIds).toEqual([]);
  });

  it('clicar sobre shape bloqueado não seleciona (INPUT-03)', () => {
    section.setSelection(['rect-1']);
    executeClickSelection(section, { x: 350, y: 50 }, false);
    // Como está bloqueado, hitTest não encontra e trata como vazio sem shift -> limpa
    expect(section.getSnapshot().session.selectedIds).toEqual([]);
  });

  it('clicar sobre shape invisível não seleciona (INPUT-03)', () => {
    section.setSelection(['rect-1']);
    executeClickSelection(section, { x: 500, y: 50 }, false);
    expect(section.getSnapshot().session.selectedIds).toEqual([]);
  });

  it('clicar sobre membro de um grupo seleciona o grupo como uma unidade atômica (INPUT-08)', () => {
    // Agrupa rect-1 e rect-2 em grp-1
    const res = section.dispatch({
      type: 'group.create',
      id: 'grp-1',
      childIds: ['rect-1', 'rect-2'],
    });
    expect(res.ok).toBe(true);

    // Clica sobre rect-1 (x: 50, y: 50) -> deve selecionar grp-1
    executeClickSelection(section, { x: 50, y: 50 }, false);
    expect(section.getSnapshot().session.selectedIds).toEqual(['grp-1']);

    // Clica sobre rect-2 (x: 180, y: 50) com shift -> deve desmarcar grp-1
    executeClickSelection(section, { x: 180, y: 50 }, true);
    expect(section.getSnapshot().session.selectedIds).toEqual([]);

    // Clica sobre rect-2 sem shift -> seleciona grp-1 novamente
    executeClickSelection(section, { x: 180, y: 50 }, false);
    expect(section.getSnapshot().session.selectedIds).toEqual(['grp-1']);
  });

  it('resolveSelectableId retorna id original se nó não pertence a grupo', () => {
    const doc = section.getSnapshot().document;
    expect(resolveSelectableId(doc, 'rect-1')).toBe('rect-1');
    expect(resolveSelectableId(doc, undefined)).toBeUndefined();
  });
});
