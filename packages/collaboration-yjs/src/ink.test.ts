import { appendInkStroke, createCanvasSection, type InkNode } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getDocumentCollections, initYjsDocument } from './crdt-schema.js';
import { projectYDocToCanvasDocument } from './projection.js';
import { YjsCollaborationProvider } from './provider.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { DeterministicTransportHub } from './transport.js';

const GOOD = { points: [{ x: 0.1, y: 0.2 }], color: '#1f2937', kind: 'pen', width: 'medium' };

function recordWith(fields: Record<string, unknown>): Y.Doc {
  const ydoc = new Y.Doc();
  initYjsDocument(ydoc);
  const { shapes } = getDocumentCollections(ydoc);
  const map = new Y.Map<unknown>();
  map.set('id', 'ink');
  map.set('type', 'ink');
  map.set('placement', { parentId: 'layer-default', orderKey: 'a0' });
  for (const [key, value] of Object.entries(fields)) map.set(key, value);
  shapes.set('ink', map);
  return ydoc;
}

const projectAll = (fields: Record<string, unknown>) =>
  projectYDocToCanvasDocument(recordWith(fields)).nodes;
const project = (fields: Record<string, unknown>): InkNode | undefined =>
  projectAll(fields)['ink'] as InkNode | undefined;

describe('traço à mão livre no Yjs: projeção', () => {
  it('um registro completo vira o elemento, com geometria, traços e opacidade', () => {
    const ink = project({
      geometry: { x: 5, y: 6, width: 220, height: 140, rotation: 0.3 },
      strokes: [
        GOOD,
        { points: [{ x: 1, y: 1 }], color: '#EF4444', kind: 'highlighter', width: 'thick' },
      ],
      opacity: 0.5,
    });
    expect(ink).toMatchObject({
      type: 'ink',
      x: 5,
      y: 6,
      width: 220,
      height: 140,
      rotation: 0.3,
      visible: true,
      locked: false,
      style: { opacity: 0.5 },
    });
    expect(ink!.strokes).toHaveLength(2);
    expect(ink!.strokes[1]).toMatchObject({ color: '#ef4444', kind: 'highlighter' });
  });

  it('sem geometria usa uma caixa padrão válida', () => {
    const ink = project({ strokes: [GOOD] });
    expect(ink).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('um registro sem traços, ou só com traços inválidos, não é projetado', () => {
    expect(project({})).toBeUndefined();
    expect(project({ strokes: [] })).toBeUndefined();
    expect(project({ strokes: 'x' })).toBeUndefined();
    expect(
      project({ strokes: [{ points: [], color: '#000000', kind: 'pen', width: 'thin' }] }),
    ).toBeUndefined();
  });

  it('descarta só os traços inválidos e mantém os bons', () => {
    const ink = project({
      strokes: [
        GOOD,
        { ...GOOD, kind: 'brush' },
        { ...GOOD, width: 'huge' },
        { ...GOOD, color: 'red' },
        { ...GOOD, color: 7 },
        { ...GOOD, points: 'x' },
        { ...GOOD, points: [{ x: 'a', y: 0 }] },
        { ...GOOD, points: [{ x: 0.5 }] },
        { ...GOOD, points: [null] },
        { ...GOOD, points: Array.from({ length: 2001 }, () => ({ x: 0, y: 0 })) },
        null,
        42,
      ],
    });
    expect(ink!.strokes).toEqual([{ ...GOOD, points: [{ x: 0.1, y: 0.2 }] }]);
  });

  it('recorta pontos fora de [0, 1] à faixa em vez de descartar o traço', () => {
    const ink = project({
      strokes: [
        {
          ...GOOD,
          points: [
            { x: -3, y: 9 },
            { x: 0.4, y: Number.NaN },
          ],
        },
      ],
    });
    // O ponto não finito invalida o traço; sem outro, o elemento some.
    expect(ink).toBeUndefined();
    const clamped = project({ strokes: [{ ...GOOD, points: [{ x: -3, y: 9 }] }] });
    expect(clamped!.strokes[0]!.points).toEqual([{ x: 0, y: 1 }]);
  });

  it('respeita 500 traços e 20.000 pontos no total', () => {
    const many = Array.from({ length: 600 }, () => GOOD);
    expect(project({ strokes: many })!.strokes).toHaveLength(500);
    const big = Array.from({ length: 12 }, () => ({
      ...GOOD,
      points: Array.from({ length: 2000 }, (_, i) => ({ x: (i % 10) / 10, y: 0.5 })),
    }));
    const total = project({ strokes: big })!.strokes.reduce((sum, s) => sum + s.points.length, 0);
    expect(total).toBe(20_000);
  });

  it('opacidade fora da faixa ou inválida volta à faixa', () => {
    expect(project({ strokes: [GOOD], opacity: 7 })!.style.opacity).toBe(1);
    expect(project({ strokes: [GOOD], opacity: -1 })!.style.opacity).toBe(0);
    expect(project({ strokes: [GOOD], opacity: 'x' })!.style.opacity).toBe(1);
  });

  it('um registro sem traço válido não derruba os demais elementos do documento', () => {
    const ydoc = recordWith({ strokes: [{ ...GOOD, kind: 'x' }] });
    const { shapes } = getDocumentCollections(ydoc);
    const rect = new Y.Map<unknown>();
    rect.set('id', 'ret');
    rect.set('type', 'rectangle');
    rect.set('placement', { parentId: 'layer-default', orderKey: 'a1' });
    rect.set('geometry', { x: 0, y: 0, width: 10, height: 10, rotation: 0 });
    shapes.set('ret', rect);
    const nodes = projectYDocToCanvasDocument(ydoc).nodes;
    expect(Object.keys(nodes)).toEqual(['ret']);
  });

  it('o documento projetado com o elemento passa pela validação do canvas', () => {
    const section = createCanvasSection();
    const document = projectYDocToCanvasDocument(
      recordWith({
        geometry: { x: 0, y: 0, width: 50, height: 50, rotation: 0 },
        strokes: [GOOD, { ...GOOD, kind: 'x' }],
      }),
    );
    expect(section.replaceDocument(document).ok).toBe(true);
  });
});

describe('traço à mão livre no Yjs: sincronização', () => {
  async function pair() {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();
    const connA = await provider.connect({ documentId: 'doc-ink', section: sectionA });
    const connB = await provider.connect({ documentId: 'doc-ink', section: sectionB });
    if (!connA.ok || !connB.ok) throw new Error('falha ao conectar');
    return { server, sectionA, sectionB, sessionA: connA.value, sessionB: connB.value };
  }

  const inkOf = (section: ReturnType<typeof createCanvasSection>): InkNode =>
    section.getSnapshot().document.nodes['ink'] as InkNode;

  const stroke = (worldPoints: Array<{ x: number; y: number }>) => ({
    color: '#1f2937',
    kind: 'pen' as const,
    width: 'medium' as const,
    worldPoints,
  });

  it('a criação e cada traço novo chegam ao outro cliente', async () => {
    const { server, sectionA, sectionB, sessionA, sessionB } = await pair();
    sectionA.dispatch({
      type: 'shape.create',
      shape: {
        id: 'ink',
        type: 'ink',
        strokes: [
          {
            points: [
              { x: 10, y: 10 },
              { x: 50, y: 40 },
            ],
          },
        ],
      },
    });
    expect(inkOf(sectionB)).toEqual(inkOf(sectionA));

    const patch = appendInkStroke(inkOf(sectionA), stroke([{ x: 200, y: 100 }]));
    sectionA.dispatch({ type: 'shape.update', id: 'ink', patch: patch as never });
    expect(inkOf(sectionB).strokes).toHaveLength(2);
    expect(inkOf(sectionB)).toEqual(inkOf(sectionA));

    sectionB.dispatch({ type: 'shape.update', id: 'ink', patch: { rotation: 0.4 } });
    expect(inkOf(sectionA).rotation).toBe(0.4);
    expect(inkOf(sectionA).strokes).toEqual(inkOf(sectionB).strokes);

    sessionA.destroy();
    sessionB.destroy();
    server.destroy();
  });

  it('geometria, traços e opacidade editados offline por clientes diferentes se somam', async () => {
    const { server, sectionA, sectionB, sessionA, sessionB } = await pair();
    sectionA.dispatch({
      type: 'shape.create',
      shape: { id: 'ink', type: 'ink', strokes: [{ points: [{ x: 10, y: 10 }] }] },
    });

    sessionA.disconnect();
    sectionA.dispatch({ type: 'shape.update', id: 'ink', patch: { style: { opacity: 0.3 } } });
    sectionB.dispatch({ type: 'shape.update', id: 'ink', patch: { x: 500, y: 500 } });
    await sessionA.reconnect();

    for (const section of [sectionA, sectionB]) {
      expect(inkOf(section)).toMatchObject({ x: 500, y: 500, style: { opacity: 0.3 } });
    }
    expect(inkOf(sectionA)).toEqual(inkOf(sectionB));

    sessionA.destroy();
    sessionB.destroy();
    server.destroy();
  });

  it('traços adicionados offline pelos dois clientes convergem para uma lista só e o outro fica recuperável', async () => {
    const { server, sectionA, sectionB, sessionA, sessionB } = await pair();
    sectionA.dispatch({
      type: 'shape.create',
      shape: {
        id: 'ink',
        type: 'ink',
        strokes: [
          {
            points: [
              { x: 10, y: 10 },
              { x: 40, y: 40 },
            ],
          },
        ],
      },
    });

    sessionA.disconnect();
    sectionA.dispatch({
      type: 'shape.update',
      id: 'ink',
      patch: appendInkStroke(inkOf(sectionA), stroke([{ x: 300, y: 300 }])) as never,
    });
    sectionB.dispatch({
      type: 'shape.update',
      id: 'ink',
      patch: appendInkStroke(inkOf(sectionB), stroke([{ x: -200, y: 20 }])) as never,
    });
    await sessionA.reconnect();

    expect(inkOf(sectionA)).toEqual(inkOf(sectionB));
    expect(inkOf(sectionA).strokes).toHaveLength(2);

    // O traço que perdeu fica recuperável, em mundo, no cliente que o viu sumir.
    const lost = [...sessionA.lastLostInkStrokes, ...sessionB.lastLostInkStrokes];
    expect(lost).toHaveLength(1);
    expect(lost[0]!.shapeId).toBe('ink');
    const lostPoint = lost[0]!.stroke.points[0]!;
    expect([300, -200]).toContain(lostPoint.x);

    // E volta ao quadro com o mesmo caminho do desenho: appendInkStroke com os pontos de mundo.
    const restored = appendInkStroke(inkOf(sectionA), {
      color: lost[0]!.stroke.color,
      kind: lost[0]!.stroke.kind,
      width: lost[0]!.stroke.width,
      worldPoints: lost[0]!.stroke.points,
    });
    expect(
      sectionA.dispatch({ type: 'shape.update', id: 'ink', patch: restored as never }).ok,
    ).toBe(true);
    expect(inkOf(sectionA).strokes).toHaveLength(3);

    sessionA.destroy();
    sessionB.destroy();
    server.destroy();
  });

  it('remover o elemento num cliente e acrescentar traço no outro converge', async () => {
    const { server, sectionA, sectionB, sessionA, sessionB } = await pair();
    sectionA.dispatch({
      type: 'shape.create',
      shape: { id: 'ink', type: 'ink', strokes: [{ points: [{ x: 10, y: 10 }] }] },
    });
    sessionA.disconnect();
    sectionA.dispatch({ type: 'shape.remove', id: 'ink' });
    sectionB.dispatch({
      type: 'shape.update',
      id: 'ink',
      patch: appendInkStroke(inkOf(sectionB), stroke([{ x: 80, y: 80 }])) as never,
    });
    await sessionA.reconnect();

    expect(sectionA.getSnapshot().document.nodes).toEqual(sectionB.getSnapshot().document.nodes);
    sessionA.destroy();
    sessionB.destroy();
    server.destroy();
  });
});
