import {
  appendInkStroke,
  createCanvasSection,
  eraseFromInk,
  type CanvasSectionApi,
  type InkNode,
  type InkStroke,
} from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { YjsCollaborationProvider } from './provider.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { DeterministicTransportHub } from './transport.js';

async function pair() {
  const server = new CollaborativeServerEmulator();
  const transport = new DeterministicTransportHub(server);
  const provider = new YjsCollaborationProvider({ server, transport });
  const sectionA = createCanvasSection();
  const sectionB = createCanvasSection();
  const connA = await provider.connect({ documentId: 'doc-erase', section: sectionA });
  const connB = await provider.connect({ documentId: 'doc-erase', section: sectionB });
  if (!connA.ok || !connB.ok) throw new Error('falha ao conectar');
  return { server, sectionA, sectionB, sessionA: connA.value, sessionB: connB.value };
}

const inkOf = (section: CanvasSectionApi): InkNode | undefined =>
  section.getSnapshot().document.nodes['ink'] as InkNode | undefined;

function createLine(section: CanvasSectionApi): void {
  section.dispatch({
    type: 'shape.create',
    shape: {
      id: 'ink',
      type: 'ink',
      strokes: [
        {
          points: [
            { x: 0, y: 100 },
            { x: 300, y: 100 },
          ],
        },
      ],
    },
  });
}

function erase(section: CanvasSectionApi, x: number): void {
  const patch = eraseFromInk(inkOf(section)!, {
    points: [
      { x, y: 80 },
      { x, y: 120 },
    ],
    radius: 8,
  });
  if (patch === null) section.dispatch({ type: 'shape.remove', id: 'ink' });
  else section.dispatch({ type: 'shape.update', id: 'ink', patch: patch as never });
}

function append(section: CanvasSectionApi, y: number): void {
  const patch = appendInkStroke(inkOf(section)!, {
    color: '#ef4444',
    kind: 'marker',
    width: 'thin',
    worldPoints: [
      { x: 20, y },
      { x: 280, y },
    ],
  });
  section.dispatch({ type: 'shape.update', id: 'ink', patch: patch as never });
}

const strokeKey = (stroke: InkStroke): string =>
  `${stroke.color}|${stroke.kind}|${stroke.points.length}`;

describe('traço à mão livre no Yjs: apagar versus adicionar', () => {
  it('apagar num cliente chega ao outro com os mesmos traços', async () => {
    const { server, sectionA, sectionB, sessionA, sessionB } = await pair();
    createLine(sectionA);
    erase(sectionA, 150);
    expect(inkOf(sectionB)!.strokes).toHaveLength(2);
    expect(inkOf(sectionB)).toEqual(inkOf(sectionA));

    sessionA.destroy();
    sessionB.destroy();
    server.destroy();
  });

  it('A apaga um trecho enquanto B adiciona um traço ao mesmo elemento: converge e o perdedor é recuperável', async () => {
    const { server, sectionA, sectionB, sessionA, sessionB } = await pair();
    createLine(sectionA);

    sessionA.disconnect();
    erase(sectionA, 150);
    append(sectionB, 160);
    await sessionA.reconnect();

    expect(inkOf(sectionA)).toEqual(inkOf(sectionB));
    const final = inkOf(sectionA)!;
    // Uma das duas listas venceu inteira (unidade "traços"): dois traços cortados, ou o original
    // mais o traço novo.
    const keys = final.strokes.map(strokeKey);
    expect(
      (final.strokes.length === 2 && keys.every((key) => key.startsWith('#1f2937|pen|2'))) ||
        keys.includes('#ef4444|marker|2'),
    ).toBe(true);

    // O que o cliente perdedor tinha e sumiu fica guardado, em mundo, para reacrescentar.
    const lost = [...sessionA.lastLostInkStrokes, ...sessionB.lastLostInkStrokes];
    expect(lost.length).toBeGreaterThan(0);
    for (const entry of lost) {
      expect(entry.shapeId).toBe('ink');
      expect(entry.stroke.points.length).toBeGreaterThanOrEqual(2);
    }

    sessionA.destroy();
    sessionB.destroy();
    server.destroy();
  });

  it('apagar em dois clientes ao mesmo tempo converge para uma só lista', async () => {
    const { server, sectionA, sectionB, sessionA, sessionB } = await pair();
    createLine(sectionA);

    sessionA.disconnect();
    erase(sectionA, 60);
    erase(sectionB, 240);
    await sessionA.reconnect();

    expect(inkOf(sectionA)).toEqual(inkOf(sectionB));
    const final = inkOf(sectionA)!;
    expect(final.strokes).toHaveLength(2);
    // Quem perdeu vê o próprio corte sumir do desenho e o guarda para recuperar.
    const lost = [...sessionA.lastLostInkStrokes, ...sessionB.lastLostInkStrokes];
    expect(lost.length).toBeGreaterThan(0);

    sessionA.destroy();
    sessionB.destroy();
    server.destroy();
  });

  it('o elemento esvaziado num cliente some no outro, sem projetar ink sem traço', async () => {
    const { server, sectionA, sectionB, sessionA, sessionB } = await pair();
    createLine(sectionA);
    sectionA.dispatch({ type: 'shape.remove', id: 'ink' });
    expect(inkOf(sectionB)).toBeUndefined();
    expect(Object.keys(sectionB.getSnapshot().document.nodes)).toEqual([]);

    sessionA.destroy();
    sessionB.destroy();
    server.destroy();
  });

  it('remover o elemento de um lado e apagar no outro converge', async () => {
    const { server, sectionA, sectionB, sessionA, sessionB } = await pair();
    createLine(sectionA);

    sessionA.disconnect();
    sectionA.dispatch({ type: 'shape.remove', id: 'ink' });
    erase(sectionB, 150);
    await sessionA.reconnect();

    expect(sectionA.getSnapshot().document.nodes).toEqual(sectionB.getSnapshot().document.nodes);

    sessionA.destroy();
    sessionB.destroy();
    server.destroy();
  });
});
