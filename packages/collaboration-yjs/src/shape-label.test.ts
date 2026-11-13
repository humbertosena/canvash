import { createCanvasSection, type CanvasSectionApi, type FontWeight } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getDocumentCollections, initYjsDocument } from './crdt-schema.js';
import { projectYDocToCanvasDocument } from './projection.js';
import { YjsCollaborationProvider } from './provider.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { DeterministicTransportHub } from './transport.js';

// O texto dentro das formas no Y.Doc (spec shape-label, US-SL.9, US-SL.13 e US-SL.14).

const BOX = { x: 0, y: 0, width: 100, height: 100, rotation: 0 } as const;
const NINE = [
  { type: 'rectangle' },
  { type: 'square' },
  { type: 'ellipse' },
  { type: 'circle' },
  { type: 'diamond' },
  { type: 'triangle' },
  { type: 'polygon', sides: 6 },
  { type: 'cross' },
  { type: 'chevron' },
] as const;

function recordWith(type: string, fields: Record<string, unknown>): Y.Doc {
  const ydoc = new Y.Doc();
  initYjsDocument(ydoc);
  const { shapes } = getDocumentCollections(ydoc);
  const map = new Y.Map<unknown>();
  map.set('id', 'shape');
  map.set('type', type);
  map.set('placement', { parentId: 'layer-default', orderKey: 'a0' });
  map.set('geometry', { ...BOX });
  for (const [key, value] of Object.entries(fields)) map.set(key, value);
  shapes.set('shape', map);
  return ydoc;
}

const project = (type: string, fields: Record<string, unknown>) =>
  projectYDocToCanvasDocument(recordWith(type, fields)).nodes['shape'] as unknown as {
    label?: Record<string, unknown>;
  };

async function twoSessions() {
  const server = new CollaborativeServerEmulator();
  const transport = new DeterministicTransportHub(server);
  const provider = new YjsCollaborationProvider({ server, transport });
  const sectionA = createCanvasSection();
  const sectionB = createCanvasSection();
  const connA = await provider.connect({ documentId: 'doc-label', section: sectionA });
  const connB = await provider.connect({ documentId: 'doc-label', section: sectionB });
  if (!connA.ok || !connB.ok) throw new Error('conexão recusada');
  return {
    sectionA,
    sectionB,
    sessionA: connA.value,
    sessionB: connB.value,
    close: () => {
      connA.value.destroy();
      connB.value.destroy();
      server.destroy();
    },
  };
}

const labelOf = (section: CanvasSectionApi, id = 's') =>
  (section.getSnapshot().document.nodes[id] as { label?: Record<string, unknown> } | undefined)
    ?.label;

describe('texto da forma no Y.Doc: projeção', () => {
  it.each(NINE)('$type: o registro com os campos label* vira o label', ({ type }) => {
    const label = project(type, {
      labelText: 'Olá',
      labelFontSize: 24,
      labelFontFamily: 'serif',
      labelFontWeight: 'bold',
      labelColor: '#ff0000',
      labelAlign: 'right',
      labelVerticalAlign: 'bottom',
    }).label;

    expect(label).toEqual({
      text: 'Olá',
      fontSize: 24,
      fontFamily: 'serif',
      fontWeight: 'bold',
      color: '#ff0000',
      textAlign: 'right',
      verticalAlign: 'bottom',
    });
  });

  it('sem labelText, não há label', () => {
    expect(project('rectangle', {}).label).toBeUndefined();
    expect(project('rectangle', { labelAlign: 'left' }).label).toBeUndefined();
    expect(project('rectangle', { labelText: 12 }).label).toBeUndefined();
  });

  it('o que falta ou não vale cai no padrão', () => {
    const label = project('rectangle', {
      labelText: 'x',
      labelFontSize: -3,
      labelFontFamily: '  ',
      labelFontWeight: 650,
      labelColor: 'azul',
      labelAlign: 'justify',
      labelVerticalAlign: 'baseline',
    }).label;

    expect(label).toEqual({
      text: 'x',
      fontSize: 16,
      fontFamily: 'sans-serif',
      fontWeight: 'normal',
      color: null,
      textAlign: 'center',
      verticalAlign: 'middle',
    });
  });

  it('o HTML sai do texto projetado, como na nota', () => {
    expect(project('rectangle', { labelText: '<b>Olá</b> <i>mundo</i>' }).label?.text).toBe(
      'Olá mundo',
    );
  });

  it('a cor em #rrggbbaa é aceita, e a cor nula vale cor automática', () => {
    expect(project('rectangle', { labelText: 'x', labelColor: '#ff000080' }).label?.color).toBe(
      '#ff000080',
    );
    expect(project('rectangle', { labelText: 'x', labelColor: null }).label?.color).toBeNull();
  });

  it('formas que não aceitam label ignoram os campos label*', () => {
    const doc = recordWith('brace', { labelText: 'x', orientation: 'left' });

    expect('label' in projectYDocToCanvasDocument(doc).nodes['shape']!).toBe(false);
  });
});

describe('texto da forma entre duas sessões (US-SL.13 e US-SL.14)', () => {
  it.each(NINE)('$type: A cria com label e B recebe o mesmo label', async ({ type, ...rest }) => {
    const { sectionA, sectionB, close } = await twoSessions();

    sectionA.dispatch({
      type: 'shape.create',
      shape: {
        id: 's',
        type,
        ...BOX,
        ...rest,
        label: {
          text: 'Olá',
          fontSize: 20,
          textAlign: 'left',
          verticalAlign: 'top',
          color: '#00ff00',
        },
      },
    } as never);

    expect(labelOf(sectionB)).toEqual(labelOf(sectionA));
    expect(labelOf(sectionB)).toMatchObject({
      text: 'Olá',
      fontSize: 20,
      textAlign: 'left',
      verticalAlign: 'top',
      color: '#00ff00',
    });
    close();
  });

  it.each<FontWeight>(['normal', 'bold', 100, 200, 300, 400, 500, 600, 700, 800, 900])(
    'labelFontWeight %s sobrevive ao envio e ao replaceDocument',
    async (fontWeight) => {
      const { sectionA, sectionB, close } = await twoSessions();

      sectionA.dispatch({
        type: 'shape.create',
        shape: { id: 's', type: 'rectangle', ...BOX, label: { text: 'x', fontWeight } },
      });

      expect(labelOf(sectionB)).toMatchObject({ fontWeight });
      expect(labelOf(sectionA)).toMatchObject({ fontWeight });
      close();
    },
  );

  it('mudar só o texto, só o alinhamento ou remover o label chega à outra sessão', async () => {
    const { sectionA, sectionB, close } = await twoSessions();
    sectionA.dispatch({
      type: 'shape.create',
      shape: { id: 's', type: 'ellipse', ...BOX, label: { text: 'um' } },
    });

    sectionA.dispatch({ type: 'shape.update', id: 's', patch: { label: { text: 'dois' } } });
    expect(labelOf(sectionB)).toMatchObject({ text: 'dois', textAlign: 'center' });
    sectionA.dispatch({
      type: 'shape.update',
      id: 's',
      patch: { label: { textAlign: 'right' } },
    });
    expect(labelOf(sectionB)).toMatchObject({ text: 'dois', textAlign: 'right' });
    sectionA.dispatch({ type: 'shape.update', id: 's', patch: { label: null } });
    expect(labelOf(sectionB)).toBeUndefined();
    expect(labelOf(sectionA)).toBeUndefined();
    close();
  });

  it('A muda o texto e B, ao mesmo tempo, o alinhamento: as duas mudanças sobrevivem', async () => {
    const { sectionA, sectionB, sessionB, close } = await twoSessions();
    sectionA.dispatch({
      type: 'shape.create',
      shape: { id: 's', type: 'rectangle', ...BOX, label: { text: 'original' } },
    });

    sessionB.disconnect();
    sectionA.dispatch({ type: 'shape.update', id: 's', patch: { label: { text: 'do A' } } });
    sectionB.dispatch({ type: 'shape.update', id: 's', patch: { label: { textAlign: 'right' } } });
    await sessionB.reconnect();

    for (const section of [sectionA, sectionB]) {
      expect(labelOf(section)).toMatchObject({ text: 'do A', textAlign: 'right' });
    }
    close();
  });

  it('A remove o label enquanto B muda o alinhamento: todas as sessões convergem sem texto', async () => {
    const { sectionA, sectionB, sessionB, close } = await twoSessions();
    sectionA.dispatch({
      type: 'shape.create',
      shape: { id: 's', type: 'rectangle', ...BOX, label: { text: 'original' } },
    });

    sessionB.disconnect();
    sectionA.dispatch({ type: 'shape.update', id: 's', patch: { label: null } });
    sectionB.dispatch({ type: 'shape.update', id: 's', patch: { label: { textAlign: 'right' } } });
    await sessionB.reconnect();

    expect(labelOf(sectionA)).toBeUndefined();
    expect(labelOf(sectionB)).toBeUndefined();
    expect(sectionB.getSnapshot().document.nodes['s']).toEqual(
      sectionA.getSnapshot().document.nodes['s'],
    );
    close();
  });

  it('o texto substituído por uma edição local é guardado como buffer de quem perde', async () => {
    const { sectionA, sessionA, close } = await twoSessions();
    sectionA.dispatch({
      type: 'shape.create',
      shape: { id: 's', type: 'rectangle', ...BOX, label: { text: 'primeiro' } },
    });

    sectionA.dispatch({ type: 'shape.update', id: 's', patch: { label: { text: 'segundo' } } });

    const session = sessionA as unknown as {
      lastReplacedTextBuffers: Array<{ shapeId: string; text: string }>;
    };
    expect(session.lastReplacedTextBuffers).toContainEqual({ shapeId: 's', text: 'primeiro' });
    close();
  });

  it('o undo local desfaz a alteração dos campos label* sem tocar o que a outra sessão fez', async () => {
    const { sectionA, sectionB, sessionA, close } = await twoSessions();
    const undo = sessionA.getUndoManager();
    sectionA.dispatch({
      type: 'shape.create',
      shape: { id: 's', type: 'rectangle', ...BOX, label: { text: 'um' } },
    });
    undo.stopCapturing();
    sectionB.dispatch({ type: 'shape.update', id: 's', patch: { x: 50 } });
    sectionA.dispatch({ type: 'shape.update', id: 's', patch: { label: { text: 'dois' } } });
    undo.stopCapturing();
    expect(labelOf(sectionB)).toMatchObject({ text: 'dois' });

    expect(undo.undo()).toBe(true);

    expect(labelOf(sectionA)).toMatchObject({ text: 'um' });
    expect(labelOf(sectionB)).toMatchObject({ text: 'um' });
    expect(sectionB.getSnapshot().document.nodes['s']).toMatchObject({ x: 50 });
    close();
  });
});
