import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getDocumentCollections, initYjsDocument } from './crdt-schema.js';
import { projectYDocToCanvasDocument, RECOVERY_LAYER_ID } from './projection.js';

describe('projectYDocToCanvasDocument', () => {
  it('cria camada de fallback se o documento não possuir camadas', () => {
    const ydoc = new Y.Doc();
    const doc = projectYDocToCanvasDocument(ydoc);
    expect(doc.layers.length).toBe(1);
    expect(doc.layers[0]?.id).toBe('layer-default');
    expect(doc.layers[0]?.name).toBe('Camada 1');
  });

  it('projeta nós de linha com geometria e estilos customizados', () => {
    const ydoc = new Y.Doc();
    initYjsDocument(ydoc);
    const { shapes } = getDocumentCollections(ydoc);

    const lineMap = new Y.Map<unknown>();
    lineMap.set('id', 'line-1');
    lineMap.set('type', 'line');
    lineMap.set('endpoints', {
      start: { x: 10, y: 20 },
      end: { x: 100, y: 150 },
    });
    lineMap.set('stroke', '#ff0000');
    lineMap.set('strokeWidth', 4);
    lineMap.set('opacity', 0.8);
    lineMap.set('visible', true);
    lineMap.set('locked', false);
    lineMap.set('placement', { parentId: 'layer-default', orderKey: 'm1' });
    shapes.set('line-1', lineMap);

    const doc = projectYDocToCanvasDocument(ydoc);
    const lineNode = doc.nodes['line-1'];
    expect(lineNode).toBeDefined();
    expect(lineNode?.type).toBe('line');
    if (lineNode?.type === 'line') {
      expect(lineNode.start).toEqual({ x: 10, y: 20 });
      expect(lineNode.end).toEqual({ x: 100, y: 150 });
      expect(lineNode.style.stroke).toBe('#ff0000');
      expect(lineNode.style.strokeWidth).toBe(4);
      expect(lineNode.style.opacity).toBe(0.8);
    }
  });

  it('projeta nós de seta com âncoras válidas e sanitiza âncoras para alvos inexistentes ou excluídos (COLLAB-10)', () => {
    const ydoc = new Y.Doc();
    initYjsDocument(ydoc);
    const { shapes } = getDocumentCollections(ydoc);

    // Shape alvo 1: ativo
    const target1 = new Y.Map<unknown>();
    target1.set('id', 'rect-target-1');
    target1.set('type', 'rectangle');
    target1.set('geometry', { x: 50, y: 50, width: 80, height: 80, rotation: 0 });
    target1.set('placement', { parentId: 'layer-default', orderKey: 'm0' });
    shapes.set('rect-target-1', target1);

    // Shape alvo 2: excluído
    const target2 = new Y.Map<unknown>();
    target2.set('id', 'rect-target-2');
    target2.set('type', 'rectangle');
    target2.set('isDeleted', true);
    shapes.set('rect-target-2', target2);

    // Seta 1: liga alvo 1 a alvo 2 (alvo 2 excluído deve ser rebaixado para free endpoint)
    const arrow1 = new Y.Map<unknown>();
    arrow1.set('id', 'arrow-1');
    arrow1.set('type', 'arrow');
    arrow1.set('endpoints', {
      start: { x: 0, y: 0, anchor: { targetId: 'rect-target-1' } },
      end: { x: 200, y: 200, anchor: { targetId: 'rect-target-2' } },
      startMarker: 'dot',
      endMarker: 'arrow',
    });
    arrow1.set('placement', { parentId: 'layer-default', orderKey: 'm2' });
    shapes.set('arrow-1', arrow1);

    // Seta 2: âncora para alvo inexistente
    const arrow2 = new Y.Map<unknown>();
    arrow2.set('id', 'arrow-2');
    arrow2.set('type', 'arrow');
    arrow2.set('endpoints', {
      start: { x: 10, y: 10, anchor: { targetId: 'non-existent' } },
      end: { x: 100, y: 100 },
    });
    arrow2.set('placement', { parentId: 'layer-default', orderKey: 'm3' });
    shapes.set('arrow-2', arrow2);

    const doc = projectYDocToCanvasDocument(ydoc);

    const a1 = doc.nodes['arrow-1'];
    expect(a1?.type).toBe('arrow');
    if (a1?.type === 'arrow') {
      expect(a1.start).toEqual({ targetId: 'rect-target-1', anchor: { x: 0.5, y: 0.5 } });
      expect(a1.end).toEqual({ x: 200, y: 200 }); // Alvo excluído sanitizado para free
      expect(a1.startMarker).toBe('dot');
      expect(a1.endMarker).toBe('arrow');
    }

    const a2 = doc.nodes['arrow-2'];
    expect(a2?.type).toBe('arrow');
    if (a2?.type === 'arrow') {
      expect(a2.start).toEqual({ x: 10, y: 10 }); // Alvo inexistente sanitizado para free
      expect(a2.end).toEqual({ x: 100, y: 100 });
      expect(a2.startMarker).toBe('none');
      expect(a2.endMarker).toBe('arrow');
    }
  });

  it('projeta nós de texto com alinhamento, estilos tipográficos e rotação', () => {
    const ydoc = new Y.Doc();
    initYjsDocument(ydoc);
    const { shapes } = getDocumentCollections(ydoc);

    const textMap = new Y.Map<unknown>();
    textMap.set('id', 'text-1');
    textMap.set('type', 'text');
    textMap.set('text', 'Olá Colaboração');
    textMap.set('fontSize', 24);
    textMap.set('fontFamily', 'monospace');
    textMap.set('fontWeight', 'bold');
    textMap.set('align', 'center');
    textMap.set('geometry', { x: 30, y: 40, width: 200, height: 50, rotation: 45 });
    textMap.set('fill', '#0000ff');
    textMap.set('placement', { parentId: 'layer-default', orderKey: 'm4' });
    shapes.set('text-1', textMap);

    const doc = projectYDocToCanvasDocument(ydoc);
    const textNode = doc.nodes['text-1'];
    expect(textNode?.type).toBe('text');
    if (textNode?.type === 'text') {
      expect(textNode.text).toBe('Olá Colaboração');
      expect(textNode.fontSize).toBe(24);
      expect(textNode.fontFamily).toBe('monospace');
      expect(textNode.fontWeight).toBe('bold');
      expect(textNode.textAlign).toBe('center');
      expect(textNode.style.fill).toBe('#0000ff');
      expect(textNode.rotation).toBe(45);
    }
  });

  it('projeta grupos com múltiplos nós filhos ordenados e descarta grupos vazios', () => {
    const ydoc = new Y.Doc();
    initYjsDocument(ydoc);
    const { shapes, groups } = getDocumentCollections(ydoc);

    // Grupo 1: com filhos
    const g1 = new Y.Map<unknown>();
    g1.set('id', 'group-1');
    g1.set('placement', { parentId: 'layer-default', orderKey: 'g0' });
    groups.set('group-1', g1);

    // Filhos do Grupo 1
    const child1 = new Y.Map<unknown>();
    child1.set('id', 'child-1');
    child1.set('type', 'rectangle');
    child1.set('geometry', { x: 10, y: 10, width: 20, height: 20, rotation: 0 });
    child1.set('placement', { parentId: 'group-1', orderKey: 'b' });
    shapes.set('child-1', child1);

    const child2 = new Y.Map<unknown>();
    child2.set('id', 'child-2');
    child2.set('type', 'rectangle');
    child2.set('geometry', { x: 30, y: 30, width: 20, height: 20, rotation: 0 });
    child2.set('placement', { parentId: 'group-1', orderKey: 'a' });
    shapes.set('child-2', child2);

    // Grupo 2: vazio (deve ser ignorado)
    const g2 = new Y.Map<unknown>();
    g2.set('id', 'group-empty');
    g2.set('placement', { parentId: 'layer-default', orderKey: 'g1' });
    groups.set('group-empty', g2);

    const doc = projectYDocToCanvasDocument(ydoc);

    expect(doc.nodes['group-1']).toBeDefined();
    expect(doc.nodes['group-empty']).toBeUndefined();

    const gNode = doc.nodes['group-1'];
    expect(gNode?.type).toBe('group');
    if (gNode?.type === 'group') {
      expect(gNode.childIds).toEqual(['child-2', 'child-1']); // Ordem 'a' antes de 'b'
    }

    const defaultLayer = doc.layers.find((l) => l.id === 'layer-default');
    expect(defaultLayer?.childIds).toContain('group-1');
  });

  it('recupera nós órfãos atribuindo-os à Camada de Recuperação (COLLAB-09)', () => {
    const ydoc = new Y.Doc();
    initYjsDocument(ydoc);
    const { shapes } = getDocumentCollections(ydoc);

    // Shape com pai inexistente
    const orphan = new Y.Map<unknown>();
    orphan.set('id', 'orphan-node');
    orphan.set('type', 'rectangle');
    orphan.set('geometry', { x: 100, y: 100, width: 50, height: 50, rotation: 0 });
    orphan.set('placement', { parentId: 'non-existent-layer', orderKey: 'm0' });
    shapes.set('orphan-node', orphan);

    const doc = projectYDocToCanvasDocument(ydoc);

    const recoveryLayer = doc.layers.find((l) => l.id === RECOVERY_LAYER_ID);
    expect(recoveryLayer).toBeDefined();
    expect(recoveryLayer?.childIds).toContain('orphan-node');

    // Valida que o documento projetado é 100% válido no core
    const section = createCanvasSection();
    const res = section.replaceDocument(doc);
    expect(res.ok).toBe(true);
  });

  it('projeta nós de elipse com estilos nulos e geometrias mínimas', () => {
    const ydoc = new Y.Doc();
    initYjsDocument(ydoc);
    const { shapes, layers } = getDocumentCollections(ydoc);

    // Camada deletada deve ser ignorada
    const delLayer = new Y.Map<unknown>();
    delLayer.set('id', 'layer-deleted');
    delLayer.set('isDeleted', true);
    layers.set('layer-deleted', delLayer);

    const ellipseMap = new Y.Map<unknown>();
    ellipseMap.set('id', 'ellipse-1');
    ellipseMap.set('type', 'ellipse');
    ellipseMap.set('geometry', { x: 5, y: 15, width: 60, height: 40, rotation: 10 });
    ellipseMap.set('fill', null);
    ellipseMap.set('stroke', null);
    ellipseMap.set('strokeWidth', null);
    ellipseMap.set('opacity', null);
    ellipseMap.set('placement', { parentId: 'layer-default', orderKey: 'm1' });
    shapes.set('ellipse-1', ellipseMap);

    const doc = projectYDocToCanvasDocument(ydoc);
    expect(doc.layers.find((l) => l.id === 'layer-deleted')).toBeUndefined();

    const node = doc.nodes['ellipse-1'];
    expect(node?.type).toBe('ellipse');
    if (node?.type === 'ellipse') {
      expect(node.style.fill).toBeNull();
      expect(node.style.stroke).toBeNull();
      expect(node.style.strokeWidth).toBe(1);
      expect(node.style.opacity).toBe(1);
    }
  });

  it('rebaixa grupo com pai inexistente para a primeira camada válida e reutiliza camada de recuperação existente', () => {
    const ydoc = new Y.Doc();
    initYjsDocument(ydoc);
    const { shapes, layers, groups } = getDocumentCollections(ydoc);

    // Já cria previamente a camada de recuperação
    const recLayer = new Y.Map<unknown>();
    recLayer.set('id', RECOVERY_LAYER_ID);
    recLayer.set('name', 'Camada de Recuperação');
    recLayer.set('orderKey', 'zz');
    layers.set(RECOVERY_LAYER_ID, recLayer);

    // Grupo com parentId inexistente
    const g = new Y.Map<unknown>();
    g.set('id', 'g-invalid-parent');
    g.set('placement', { parentId: 'non-existent-layer', orderKey: 'g0' });
    groups.set('g-invalid-parent', g);

    // Filho do grupo
    const child = new Y.Map<unknown>();
    child.set('id', 'g-child');
    child.set('type', 'rectangle');
    child.set('placement', { parentId: 'g-invalid-parent', orderKey: 'c0' });
    shapes.set('g-child', child);

    // Shape com pai inexistente
    const orphan = new Y.Map<unknown>();
    orphan.set('id', 'orphan-2');
    orphan.set('type', 'rectangle');
    orphan.set('placement', { parentId: 'another-bad-layer', orderKey: 'o0' });
    shapes.set('orphan-2', orphan);

    const doc = projectYDocToCanvasDocument(ydoc);
    expect(doc.nodes['g-invalid-parent']).toBeDefined();

    // Como o parentId era inexistente, o grupo deve cair na primeira camada
    const firstLayer = doc.layers[0]!;
    expect(firstLayer.childIds).toContain('g-invalid-parent');

    // Recovery layer só deve aparecer 1 vez
    const recLayers = doc.layers.filter((l) => l.id === RECOVERY_LAYER_ID);
    expect(recLayers.length).toBe(1);
    expect(recLayers[0]?.childIds).toContain('orphan-2');
  });

  it('projeta nós SquareNode garantindo invariante 1:1 e sincroniza criação, resize e conversão entre clientes Yjs (Tarefa 95)', async () => {
    const { YjsCollaborationProvider } = await import('./provider.js');
    const provider = new YjsCollaborationProvider();
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();

    const connA = await provider.connect({ documentId: 'doc-sq', section: sectionA });
    const connB = await provider.connect({ documentId: 'doc-sq', section: sectionB });
    expect(connA.ok && connB.ok).toBe(true);
    if (!connA.ok || !connB.ok) return;

    // 1. Cliente A cria um quadrado
    sectionA.dispatch({
      type: 'shape.create',
      shape: {
        id: 'sq-collab-1',
        type: 'square',
        x: 50,
        y: 60,
        width: 100,
        height: 100,
        rotation: 0,
      },
    });

    expect(sectionB.getSnapshot().document.nodes['sq-collab-1']).toMatchObject({
      type: 'square',
      x: 50,
      y: 60,
      width: 100,
      height: 100,
    });

    // 2. Cliente B redimensiona proporcionalmente para 160x160
    sectionB.dispatch({
      type: 'shape.update',
      id: 'sq-collab-1',
      patch: { width: 160, height: 160 },
    });

    expect(sectionA.getSnapshot().document.nodes['sq-collab-1']).toMatchObject({
      type: 'square',
      width: 160,
      height: 160,
    });

    // 3. Cliente A converte o quadrado em retângulo e altera dimensões assimétricas (200x120)
    sectionA.dispatch({
      type: 'shape.update',
      id: 'sq-collab-1',
      patch: { type: 'rectangle', width: 200, height: 120 },
    });

    expect(sectionB.getSnapshot().document.nodes['sq-collab-1']).toMatchObject({
      type: 'rectangle',
      width: 200,
      height: 120,
    });

    // 4. Cliente B converte o retângulo de volta para quadrado (regra min(200, 120) = 120)
    sectionB.dispatch({
      type: 'shape.update',
      id: 'sq-collab-1',
      patch: { type: 'square' },
    });

    expect(sectionA.getSnapshot().document.nodes['sq-collab-1']).toMatchObject({
      type: 'square',
      x: 90,
      y: 60,
      width: 120,
      height: 120,
    });

    connA.value.destroy();
    connB.value.destroy();
  });

  it('projeta nós CircleNode garantindo invariante 1:1 e sincroniza criação, resize e conversão entre clientes Yjs (Tarefa 99)', async () => {
    const { YjsCollaborationProvider } = await import('./provider.js');
    const provider = new YjsCollaborationProvider();
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();

    const connA = await provider.connect({ documentId: 'doc-c', section: sectionA });
    const connB = await provider.connect({ documentId: 'doc-c', section: sectionB });
    expect(connA.ok && connB.ok).toBe(true);
    if (!connA.ok || !connB.ok) return;

    sectionA.dispatch({
      type: 'shape.create',
      shape: {
        id: 'c-collab-1',
        type: 'circle',
        x: 50,
        y: 60,
        width: 100,
        height: 100,
        rotation: 0,
      },
    });

    expect(sectionB.getSnapshot().document.nodes['c-collab-1']).toMatchObject({
      type: 'circle',
      x: 50,
      y: 60,
      width: 100,
      height: 100,
    });

    sectionB.dispatch({
      type: 'shape.update',
      id: 'c-collab-1',
      patch: { type: 'ellipse', width: 200, height: 120 },
    });

    expect(sectionA.getSnapshot().document.nodes['c-collab-1']).toMatchObject({
      type: 'ellipse',
      width: 200,
      height: 120,
    });

    sectionA.dispatch({
      type: 'shape.update',
      id: 'c-collab-1',
      patch: { type: 'circle' },
    });

    expect(sectionB.getSnapshot().document.nodes['c-collab-1']).toMatchObject({
      type: 'circle',
      x: 90,
      y: 60,
      width: 120,
      height: 120,
    });

    connA.value.destroy();
    connB.value.destroy();
  });

  it('projeta nós TriangleNode preservando variant/apex e sincroniza alterações entre clientes Yjs (Tarefa 105)', async () => {
    const { YjsCollaborationProvider } = await import('./provider.js');
    const provider = new YjsCollaborationProvider();
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();

    const connA = await provider.connect({ documentId: 'doc-tr', section: sectionA });
    const connB = await provider.connect({ documentId: 'doc-tr', section: sectionB });
    expect(connA.ok && connB.ok).toBe(true);
    if (!connA.ok || !connB.ok) return;

    sectionA.dispatch({
      type: 'shape.create',
      shape: {
        id: 'tr-collab-1',
        type: 'triangle',
        x: 40,
        y: 50,
        width: 120,
        height: 80,
        rotation: 0,
        variant: 'isosceles',
      },
    });

    expect(sectionB.getSnapshot().document.nodes['tr-collab-1']).toMatchObject({
      type: 'triangle',
      variant: 'isosceles',
      apex: 0.5,
      width: 120,
      height: 80,
    });

    sectionB.dispatch({
      type: 'shape.update',
      id: 'tr-collab-1',
      patch: { variant: 'scalene', apex: 0.25 },
    });

    expect(sectionA.getSnapshot().document.nodes['tr-collab-1']).toMatchObject({
      type: 'triangle',
      variant: 'scalene',
      apex: 0.25,
    });

    sectionA.dispatch({
      type: 'shape.update',
      id: 'tr-collab-1',
      patch: { variant: 'equilateral' },
    });

    const nodeB = sectionB.getSnapshot().document.nodes['tr-collab-1'];
    expect(nodeB?.type).toBe('triangle');
    if (nodeB?.type === 'triangle') {
      expect(nodeB.variant).toBe('equilateral');
      expect(nodeB.apex).toBe(0.5);
      expect(nodeB.width / nodeB.height).toBeCloseTo(2 / Math.sqrt(3), 5);
    }

    connA.value.destroy();
    connB.value.destroy();
  });
});

describe('PolygonNode no Yjs (Tarefa 108)', () => {
  it('projeta polígono com caixa 1:1 pelo menor lado e sides dentro de 3 a 12', () => {
    const ydoc = new Y.Doc();
    initYjsDocument(ydoc);
    const { shapes } = getDocumentCollections(ydoc);
    const records: Array<[string, unknown]> = [
      ['pg-wide', 20],
      ['pg-few', 1],
      ['pg-frac', 6.4],
      ['pg-bad', 'muitos'],
    ];
    for (const [id, sides] of records) {
      const map = new Y.Map<unknown>();
      map.set('id', id);
      map.set('type', 'polygon');
      map.set('geometry', { x: 10, y: 20, width: 100, height: 80, rotation: 0 });
      map.set('sides', sides);
      map.set('placement', { parentId: 'layer-default', orderKey: id });
      shapes.set(id, map);
    }

    const doc = projectYDocToCanvasDocument(ydoc);

    expect(doc.nodes['pg-wide']).toMatchObject({
      type: 'polygon',
      sides: 12,
      x: 10,
      y: 20,
      width: 80,
      height: 80,
    });
    expect(doc.nodes['pg-few']).toMatchObject({ sides: 3 });
    expect(doc.nodes['pg-frac']).toMatchObject({ sides: 6 });
    expect(doc.nodes['pg-bad']).toMatchObject({ sides: 5 });
  });

  it('projeta polígono sem geometria nem sides com os valores padrão', () => {
    const ydoc = new Y.Doc();
    initYjsDocument(ydoc);
    const { shapes } = getDocumentCollections(ydoc);
    const map = new Y.Map<unknown>();
    map.set('id', 'pg-empty');
    map.set('type', 'polygon');
    map.set('placement', { parentId: 'layer-default', orderKey: 'a0' });
    shapes.set('pg-empty', map);

    expect(projectYDocToCanvasDocument(ydoc).nodes['pg-empty']).toMatchObject({
      type: 'polygon',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      sides: 5,
    });
  });

  it('sincroniza a troca de sides e o resize entre dois clientes', async () => {
    const { YjsCollaborationProvider } = await import('./provider.js');
    const provider = new YjsCollaborationProvider();
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();
    const connA = await provider.connect({ documentId: 'doc-pg', section: sectionA });
    const connB = await provider.connect({ documentId: 'doc-pg', section: sectionB });
    expect(connA.ok && connB.ok).toBe(true);
    if (!connA.ok || !connB.ok) return;

    sectionA.dispatch({
      type: 'shape.create',
      shape: { id: 'pg-c', type: 'polygon', x: 40, y: 50, width: 90, height: 90, rotation: 0 },
    });
    expect(sectionB.getSnapshot().document.nodes['pg-c']).toMatchObject({
      type: 'polygon',
      sides: 5,
      width: 90,
      height: 90,
    });

    sectionB.dispatch({ type: 'shape.update', id: 'pg-c', patch: { sides: 8 } });
    expect(sectionA.getSnapshot().document.nodes['pg-c']).toMatchObject({ sides: 8 });

    sectionA.dispatch({ type: 'shape.update', id: 'pg-c', patch: { width: 120, height: 120 } });
    expect(sectionB.getSnapshot().document.nodes['pg-c']).toMatchObject({
      sides: 8,
      width: 120,
      height: 120,
    });

    connA.value.destroy();
    connB.value.destroy();
  });
});

describe('BezierNode no Yjs (Tarefa 111)', () => {
  function project(fields: Record<string, unknown>) {
    const ydoc = new Y.Doc();
    initYjsDocument(ydoc);
    const { shapes } = getDocumentCollections(ydoc);
    const map = new Y.Map<unknown>();
    map.set('id', 'bz');
    map.set('type', 'bezier');
    map.set('placement', { parentId: 'layer-default', orderKey: 'a0' });
    for (const [key, value] of Object.entries(fields)) map.set(key, value);
    shapes.set('bz', map);
    return projectYDocToCanvasDocument(ydoc).nodes['bz'];
  }

  it('re-espelha control2 a partir de control1 na curva simétrica', () => {
    expect(
      project({
        endpoints: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
        control1: { x: 20, y: -30 },
        control2: { x: 0, y: 0 },
        symmetric: true,
        stroke: '#7c3aed',
        strokeWidth: 3,
      }),
    ).toEqual({
      id: 'bz',
      type: 'bezier',
      start: { x: 0, y: 0 },
      control1: { x: 20, y: -30 },
      control2: { x: 80, y: -30 },
      end: { x: 100, y: 0 },
      symmetric: true,
      visible: true,
      locked: false,
      style: { stroke: '#7c3aed', strokeWidth: 3, opacity: 1 },
    });
  });

  it('mantém controles livres sem simetria e usa o arco padrão sem dados', () => {
    expect(
      project({
        endpoints: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
        control1: { x: 20, y: -30 },
        control2: { x: 0, y: 50 },
        symmetric: false,
      }),
    ).toMatchObject({ symmetric: false, control2: { x: 0, y: 50 } });

    expect(
      project({ endpoints: { start: { x: 0, y: 0 }, end: { x: 120, y: 0 } }, symmetric: false }),
    ).toMatchObject({ control1: { x: 40, y: -30 }, control2: { x: 80, y: -30 } });

    expect(project({})).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
      symmetric: true,
      style: { stroke: '#000000', strokeWidth: 1, opacity: 1 },
    });
  });

  it('afasta as pontas coincidentes e corrige traço inválido', () => {
    const node = project({
      endpoints: { start: { x: 5, y: 5 }, end: { x: 5, y: 5 } },
      strokeWidth: 'grosso',
    });
    expect(node).toMatchObject({ start: { x: 5, y: 5 }, end: { x: 6, y: 5 } });
    expect(node).toMatchObject({ style: { strokeWidth: 1 } });
  });

  it('sincroniza os quatro pontos e a simetria entre dois clientes', async () => {
    const { YjsCollaborationProvider } = await import('./provider.js');
    const provider = new YjsCollaborationProvider();
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();
    const connA = await provider.connect({ documentId: 'doc-bz', section: sectionA });
    const connB = await provider.connect({ documentId: 'doc-bz', section: sectionB });
    expect(connA.ok && connB.ok).toBe(true);
    if (!connA.ok || !connB.ok) return;

    sectionA.dispatch({
      type: 'shape.create',
      shape: { id: 'bz', type: 'bezier', start: { x: 0, y: 0 }, end: { x: 120, y: 0 } },
    });
    expect(sectionB.getSnapshot().document.nodes['bz']).toEqual(
      sectionA.getSnapshot().document.nodes['bz'],
    );

    sectionB.dispatch({ type: 'shape.update', id: 'bz', patch: { symmetric: false } });
    sectionB.dispatch({ type: 'shape.update', id: 'bz', patch: { control2: { x: 70, y: 40 } } });
    expect(sectionA.getSnapshot().document.nodes['bz']).toMatchObject({
      symmetric: false,
      control1: { x: 40, y: -30 },
      control2: { x: 70, y: 40 },
    });

    connA.value.destroy();
    connB.value.destroy();
  });
});
