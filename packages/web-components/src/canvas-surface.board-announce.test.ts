import { createCanvasSection, type CanvasChange } from '@canvash/core';
import { describe, expect, it, vi } from 'vitest';
import { CanvasSurfaceElement } from './canvas-surface.js';

// US-BD.17: selecionar um board anuncia o título dele, não o id.

interface TestableCanvasSurface {
  _handleSectionChange(event: CanvasChange): void;
}

describe('CanvasSurfaceElement: anúncio da seleção de um board', () => {
  const select = (title: string, ids: readonly string[]) => {
    const el = new CanvasSurfaceElement();
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'b', type: 'board', x: 0, y: 0, width: 200, height: 100, title },
    });
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'r', type: 'rectangle', x: 300, y: 0, width: 50, height: 50, rotation: 0 },
    });
    el.section = section;
    section.setSelection([...ids]);
    const announce = vi.spyOn(el, 'announce');
    (el as unknown as TestableCanvasSurface)._handleSectionChange({
      snapshot: section.getSnapshot(),
      areas: ['selection'],
      origin: 'local',
      affectedIds: [],
    });
    return announce;
  };

  it('anuncia "Board <título> selecionado" com um board selecionado', () => {
    expect(select('Fluxo do cliente', ['b'])).toHaveBeenCalledWith(
      'Board Fluxo do cliente selecionado',
    );
  });

  it('mantém o anúncio genérico para os outros nós', () => {
    expect(select('Fluxo', ['r'])).toHaveBeenCalledWith('Objeto rectangle selecionado (r)');
  });
});
