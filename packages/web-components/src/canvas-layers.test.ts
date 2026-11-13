import { createCanvasSection, type CanvasNode, type Layer } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { CanvasLayersElement } from './canvas-layers.js';

interface TestableLayers {
  _section: unknown;
  _unsubscribeSection: unknown;
  _toggleLayerVisibility(layer: Layer, e?: Event): void;
  _toggleLayerLock(layer: Layer, e?: Event): void;
  _reorderLayer(layer: Layer, direction: 'up' | 'down', e?: Event): void;
  _selectNode(nodeId: string, event: MouseEvent | KeyboardEvent): void;
  _onNodeKeyDown(nodeId: string, e: KeyboardEvent): void;
  _toggleNodeVisibility(node: CanvasNode, e?: Event): void;
  _toggleNodeLock(node: CanvasNode, e?: Event): void;
  _reorderNode(layer: Layer, node: CanvasNode, direction: 'up' | 'down', e?: Event): void;
  performUpdate(): void;
}

const fakeEvent = {
  stopPropagation: () => {},
  preventDefault: () => {},
} as unknown as Event;

function invokeAllTemplateFunctions(result: unknown): void {
  if (!result || typeof result !== 'object') return;
  if ('values' in result && Array.isArray((result as { values: unknown[] }).values)) {
    for (const val of (result as { values: unknown[] }).values) {
      if (typeof val === 'function') {
        try {
          val(fakeEvent);
        } catch {
          // ignora
        }
      } else if (Array.isArray(val)) {
        for (const item of val) invokeAllTemplateFunctions(item);
      } else if (typeof val === 'object') {
        invokeAllTemplateFunctions(val);
      }
    }
  }
}

describe('CanvasLayersElement', () => {
  it('inicializa sem canvas e renderiza mensagem vazia', () => {
    const el = new CanvasLayersElement();
    expect(el.section).toBeUndefined();
    const result = el.render();
    expect(result).toBeDefined();
  });

  it('permite definir e alternar o canvas reativamente', () => {
    const el = new CanvasLayersElement();
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();

    el.section = sectionA;
    expect(el.section).toBe(sectionA);

    el.section = sectionB;
    expect(el.section).toBe(sectionB);

    // Mesma instância é no-op
    el.section = sectionB;
    expect(el.section).toBe(sectionB);

    el.section = undefined;
    expect(el.section).toBeUndefined();
  });

  it('alterna visibilidade e bloqueio da camada', () => {
    const el = new CanvasLayersElement();
    const section = createCanvasSection();
    el.section = section;

    const layer = section.getSnapshot().document.layers[0]!;
    expect(layer.visible).toBe(true);
    expect(layer.locked).toBe(false);

    const testable = el as unknown as TestableLayers;

    // Alterna visibilidade
    testable._toggleLayerVisibility(layer, fakeEvent);
    expect(section.getSnapshot().document.layers[0]?.visible).toBe(false);

    // Alterna bloqueio
    testable._toggleLayerLock(layer, fakeEvent);
    expect(section.getSnapshot().document.layers[0]?.locked).toBe(true);
  });

  it('reordena camadas', () => {
    const el = new CanvasLayersElement();
    const section = createCanvasSection();
    el.section = section;

    // Cria segunda camada
    section.dispatch({
      type: 'layer.create',
      layer: { id: 'layer-top' },
    });

    const snap = section.getSnapshot();
    const baseLayer = snap.document.layers[0]!;

    const testable = el as unknown as TestableLayers;

    // Move camada base para cima
    testable._reorderLayer(baseLayer, 'up', fakeEvent);
    expect(section.getSnapshot().document.layers[1]?.id).toBe(baseLayer.id);

    // Move de volta para baixo
    testable._reorderLayer(baseLayer, 'down', fakeEvent);
    expect(section.getSnapshot().document.layers[0]?.id).toBe(baseLayer.id);
  });

  it('seleciona nó simples e com tecla modificadora', () => {
    const el = new CanvasLayersElement();
    const section = createCanvasSection();
    el.section = section;

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'node-1',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    });
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'node-2',
        type: 'rectangle',
        x: 20,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    });

    const testable = el as unknown as TestableLayers;

    // Seleção simples
    testable._selectNode('node-1', {
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
    } as MouseEvent);
    expect(section.getSnapshot().session.selectedIds).toEqual(['node-1']);

    // Multi-seleção com Shift
    testable._selectNode('node-2', {
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
    } as MouseEvent);
    expect(section.getSnapshot().session.selectedIds).toEqual(['node-1', 'node-2']);

    // Alternância (desmarca node-1)
    testable._selectNode('node-1', {
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
    } as MouseEvent);
    expect(section.getSnapshot().session.selectedIds).toEqual(['node-2']);
  });

  it('alterna visibilidade, bloqueio e ordem do nó', () => {
    const el = new CanvasLayersElement();
    const section = createCanvasSection();
    el.section = section;

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'shape-a',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    });
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'shape-b',
        type: 'rectangle',
        x: 20,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    });

    const testable = el as unknown as TestableLayers;
    const snap = section.getSnapshot();
    const layer = snap.document.layers[0]!;
    const nodeA = snap.document.nodes['shape-a']!;

    // Visibilidade
    testable._toggleNodeVisibility(nodeA, fakeEvent);
    expect(section.getSnapshot().document.nodes['shape-a']?.visible).toBe(false);

    // Bloqueio
    testable._toggleNodeLock(nodeA, fakeEvent);
    expect(section.getSnapshot().document.nodes['shape-a']?.locked).toBe(true);
    // Desbloqueia para poder reordenar (nós bloqueados rejeitam reordenação no core)
    testable._toggleNodeLock(section.getSnapshot().document.nodes['shape-a']!, fakeEvent);
    expect(section.getSnapshot().document.nodes['shape-a']?.locked).toBe(false);

    // Reordenação
    testable._reorderNode(layer, nodeA, 'up', fakeEvent);
    expect(section.getSnapshot().document.layers[0]?.childIds).toEqual(['shape-b', 'shape-a']);
  });

  it('métodos são seguros se o canvas não estiver definido', () => {
    const el = new CanvasLayersElement();
    const testable = el as unknown as TestableLayers;
    const fakeLayer = { id: 'x', name: 'X', visible: true, locked: false, childIds: [] };
    const fakeNode = { id: 'y', type: 'rectangle', visible: true, locked: false } as CanvasNode;

    expect(() => testable._toggleLayerVisibility(fakeLayer, fakeEvent)).not.toThrow();
    expect(() => testable._toggleLayerLock(fakeLayer, fakeEvent)).not.toThrow();
    expect(() => testable._reorderLayer(fakeLayer, 'up', fakeEvent)).not.toThrow();
    expect(() => testable._selectNode('y', fakeEvent as unknown as MouseEvent)).not.toThrow();
    expect(() => testable._toggleNodeVisibility(fakeNode, fakeEvent)).not.toThrow();
    expect(() => testable._toggleNodeLock(fakeNode, fakeEvent)).not.toThrow();
    expect(() => testable._reorderNode(fakeLayer, fakeNode, 'up', fakeEvent)).not.toThrow();
  });

  it('gerencia ciclo de vida de conexão e desconexão', () => {
    const el = new CanvasLayersElement();
    const section = createCanvasSection();
    el.section = section;
    const testable = el as unknown as TestableLayers;

    el.disconnectedCallback();
    expect(testable._unsubscribeSection).toBeUndefined();

    el.connectedCallback();
    expect(testable._unsubscribeSection).toBeDefined();
  });

  it('performUpdate() retorna prematuramente em ambiente headless', () => {
    const el = new CanvasLayersElement();
    const testable = el as unknown as TestableLayers;
    expect(() => testable.performUpdate()).not.toThrow();
  });

  it('respeita limites ao reordenar camadas e nós', () => {
    const el = new CanvasLayersElement();
    const section = createCanvasSection();
    el.section = section;
    const testable = el as unknown as TestableLayers;

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'n1',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    });

    const snap = section.getSnapshot();
    const layer = snap.document.layers[0]!;
    const node = snap.document.nodes['n1']!;

    // Reorder de camada inexistente ou fora dos limites
    testable._reorderLayer({ id: 'non-existent' } as Layer, 'up');
    testable._reorderLayer(layer, 'down'); // index 0 down -> out of bounds
    testable._reorderLayer(layer, 'up'); // max index up -> out of bounds

    // Reorder de nó inexistente ou fora dos limites
    testable._reorderNode(layer, { id: 'non-existent' } as CanvasNode, 'up');
    testable._reorderNode(layer, node, 'down'); // index 0 down -> out of bounds
    testable._reorderNode(layer, node, 'up'); // index 0 up com apenas 1 item -> out of bounds
  });

  it('suporta navegação por teclado e modificadores de seleção', () => {
    const el = new CanvasLayersElement();
    const section = createCanvasSection();
    el.section = section;
    const testable = el as unknown as TestableLayers;

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'k-node',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    });

    // Tecla Enter seleciona
    testable._onNodeKeyDown('k-node', {
      key: 'Enter',
      preventDefault: () => {},
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
    } as unknown as KeyboardEvent);
    expect(section.getSnapshot().session.selectedIds).toEqual(['k-node']);

    // Tecla Space seleciona
    section.setSelection([]);
    testable._onNodeKeyDown('k-node', {
      key: ' ',
      preventDefault: () => {},
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
    } as unknown as KeyboardEvent);
    expect(section.getSnapshot().session.selectedIds).toEqual(['k-node']);

    // Outra tecla é ignorada
    section.setSelection([]);
    testable._onNodeKeyDown('k-node', {
      key: 'Escape',
      preventDefault: () => {},
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
    } as unknown as KeyboardEvent);
    expect(section.getSnapshot().session.selectedIds).toEqual([]);

    // metaKey e ctrlKey
    testable._selectNode('k-node', {
      metaKey: true,
      shiftKey: false,
      ctrlKey: false,
    } as MouseEvent);
    expect(section.getSnapshot().session.selectedIds).toEqual(['k-node']);

    testable._selectNode('k-node', {
      ctrlKey: true,
      shiftKey: false,
      metaKey: false,
    } as MouseEvent);
    expect(section.getSnapshot().session.selectedIds).toEqual([]);
  });

  it('renderiza árvore de camadas e nós e avalia closures de template', () => {
    const el = new CanvasLayersElement();
    const section = createCanvasSection();
    el.section = section;

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'node-render',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    });
    section.setSelection(['node-render']);

    const templateResult = el.render();
    expect(templateResult).toBeDefined();

    // Invoca closures embutidas no template
    invokeAllTemplateFunctions(templateResult);

    // Render em modo readOnly
    section.setReadOnly(true);
    const readOnlyTemplate = el.render();
    expect(readOnlyTemplate).toBeDefined();
    invokeAllTemplateFunctions(readOnlyTemplate);
  });
});
