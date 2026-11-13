import { createCanvasSection, fitStickyFontSize, type StickyNode } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getDocumentCollections, initYjsDocument } from './crdt-schema.js';
import { projectYDocToCanvasDocument } from './projection.js';
import { YjsCollaborationProvider } from './provider.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { YjsCollaborationSession } from './session.js';
import { DeterministicTransportHub } from './transport.js';

function recordWith(fields: Record<string, unknown>): Y.Doc {
  const ydoc = new Y.Doc();
  initYjsDocument(ydoc);
  const { shapes } = getDocumentCollections(ydoc);
  const map = new Y.Map<unknown>();
  map.set('id', 'note');
  map.set('type', 'sticky');
  map.set('placement', { parentId: 'layer-default', orderKey: 'a0' });
  for (const [key, value] of Object.entries(fields)) map.set(key, value);
  shapes.set('note', map);
  return ydoc;
}

const project = (fields: Record<string, unknown>): StickyNode =>
  projectYDocToCanvasDocument(recordWith(fields)).nodes['note'] as StickyNode;

describe('nota adesiva no Yjs: projeção', () => {
  it('um registro completo vira a nota, com a cor vinda de fill', () => {
    const note = project({
      geometry: { x: 5, y: 6, width: 220, height: 140, rotation: 0.3 },
      text: 'Olá',
      fontSize: 24,
      fontSizeMode: 'fixed',
      fontFamily: 'serif',
      fontWeight: 'bold',
      align: 'center',
      lineHeight: 1.5,
      fill: '#f8bbd0',
      stroke: '#111111',
      strokeWidth: 2,
      opacity: 0.8,
    });
    expect(note).toMatchObject({
      type: 'sticky',
      x: 5,
      y: 6,
      width: 220,
      height: 140,
      rotation: 0.3,
      text: 'Olá',
      fontSize: 24,
      fontSizeMode: 'fixed',
      fontFamily: 'serif',
      fontWeight: 'bold',
      textAlign: 'center',
      lineHeight: 1.5,
      style: { fill: '#f8bbd0', stroke: '#111111', strokeWidth: 2, opacity: 0.8 },
    });
  });

  it('um registro vazio vira uma nota padrão válida: amarela, 200 × 200, automática', () => {
    const note = project({});
    expect(note).toMatchObject({
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      text: '',
      fontSizeMode: 'auto',
      fontFamily: 'sans-serif',
      fontWeight: 'normal',
      textAlign: 'left',
      lineHeight: 1.25,
      style: { fill: '#fff59d' },
    });
    expect(note.fontSize).toBe(fitStickyFontSize(note));
  });

  it('valores fora do contrato voltam ao padrão', () => {
    const note = project({
      geometry: { x: 0, y: 0, width: -5, height: 0, rotation: 0 },
      fontSizeMode: 'huge',
      fontFamily: '   ',
      fontWeight: 'ultra',
      align: 'justify',
      lineHeight: -2,
      fill: 'amarelo',
    });
    expect(note).toMatchObject({
      width: 1,
      height: 1,
      fontSizeMode: 'auto',
      fontFamily: 'sans-serif',
      fontWeight: 'normal',
      textAlign: 'left',
      lineHeight: 1.25,
      style: { fill: '#fff59d' },
    });
  });

  it('no modo fixo o tamanho vale, com o padrão 16 para valor inválido', () => {
    expect(project({ fontSizeMode: 'fixed', fontSize: 33 }).fontSize).toBe(33);
    expect(project({ fontSizeMode: 'fixed', fontSize: 'x' }).fontSize).toBe(16);
    expect(project({ fontSizeMode: 'fixed', fontSize: -4 }).fontSize).toBe(16);
  });

  it('no modo automático o tamanho gravado é ignorado e refeito pelo ajuste', () => {
    const note = project({ fontSize: 7, text: 'Uma frase comprida para a fonte encolher na nota' });
    expect(note.fontSizeMode).toBe('auto');
    expect(note.fontSize).toBe(fitStickyFontSize(note));
  });

  it('remove tags HTML do texto remoto', () => {
    expect(project({ text: 'a<b>negrito</b><script>x</script>' }).text).toBe('anegritox');
  });

  it('o documento projetado com a nota passa pela validação do canvas', () => {
    const section = createCanvasSection();
    const doc = projectYDocToCanvasDocument(
      recordWith({
        geometry: { x: 0, y: 0, width: 150, height: 90, rotation: 0 },
        text: '<i>x</i>',
        fill: 'rosa',
        lineHeight: 'm',
        fontSizeMode: 'fixed',
        fontSize: 'x',
      }),
    );
    expect(section.replaceDocument(doc).ok).toBe(true);
  });
});

describe('nota adesiva no Yjs: sincronização', () => {
  async function pair() {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();
    const connA = await provider.connect({ documentId: 'doc-sticky', section: sectionA });
    const connB = await provider.connect({ documentId: 'doc-sticky', section: sectionB });
    if (!connA.ok || !connB.ok) throw new Error('falha ao conectar');
    return { server, sectionA, sectionB, sessionA: connA.value, sessionB: connB.value };
  }

  it('a criação e as edições chegam ao outro cliente, com a fonte refeita', async () => {
    const { server, sectionA, sectionB, sessionA, sessionB } = await pair();
    sectionA.dispatch({
      type: 'shape.create',
      shape: {
        id: 'note',
        type: 'sticky',
        x: 10,
        y: 20,
        width: 180,
        height: 120,
        text: 'Olá',
        textAlign: 'center',
        lineHeight: 1.5,
        style: { fill: '#bbdefb' },
      },
    });
    expect(sectionB.getSnapshot().document.nodes['note']).toEqual(
      sectionA.getSnapshot().document.nodes['note'],
    );

    sectionB.dispatch({
      type: 'shape.update',
      id: 'note',
      patch: { text: 'Um texto bem mais longo, que obriga a fonte a encolher dentro da nota' },
    });
    const a = sectionA.getSnapshot().document.nodes['note'] as StickyNode;
    expect(a.text).toContain('bem mais longo');
    expect(a.fontSize).toBe(fitStickyFontSize(a));
    expect(sectionB.getSnapshot().document.nodes['note']).toEqual(a);

    sessionA.destroy();
    sessionB.destroy();
    server.destroy();
  });

  it('texto e cor editados offline por dois clientes se somam e convergem', async () => {
    const { server, sectionA, sectionB, sessionA, sessionB } = await pair();
    sectionA.dispatch({
      type: 'shape.create',
      shape: { id: 'note', type: 'sticky', x: 0, y: 0, text: 'início' },
    });

    sessionA.disconnect();
    sectionA.dispatch({ type: 'shape.update', id: 'note', patch: { text: 'editado por A' } });
    sectionB.dispatch({ type: 'shape.update', id: 'note', patch: { style: { fill: '#c8e6c9' } } });
    await sessionA.reconnect();

    const expected = { text: 'editado por A', style: { fill: '#c8e6c9' } };
    expect(sectionA.getSnapshot().document.nodes['note']).toMatchObject(expected);
    expect(sectionB.getSnapshot().document.nodes['note']).toMatchObject(expected);
    expect(sectionA.getSnapshot().document.nodes['note']).toEqual(
      sectionB.getSnapshot().document.nodes['note'],
    );

    sessionA.destroy();
    sessionB.destroy();
    server.destroy();
  });

  it('textos editados offline pelos dois clientes convergem para um só e o outro fica recuperável', async () => {
    const { server, sectionA, sectionB, sessionA, sessionB } = await pair();
    sectionA.dispatch({
      type: 'shape.create',
      shape: { id: 'note', type: 'sticky', x: 0, y: 0, text: 'início' },
    });

    sessionA.disconnect();
    sectionA.dispatch({ type: 'shape.update', id: 'note', patch: { text: 'versão A' } });
    sectionB.dispatch({ type: 'shape.update', id: 'note', patch: { text: 'versão B' } });
    await sessionA.reconnect();

    const finalA = sectionA.getSnapshot().document.nodes['note'] as StickyNode;
    const finalB = sectionB.getSnapshot().document.nodes['note'] as StickyNode;
    expect(finalA).toEqual(finalB);
    expect(['versão A', 'versão B']).toContain(finalA.text);
    // O texto que perdeu continua guardado nos buffers de quem o substituiu.
    const recovered = [...sessionA.lastReplacedTextBuffers, ...sessionB.lastReplacedTextBuffers];
    expect(recovered.map((entry) => entry.text)).toContain('início');

    sessionA.destroy();
    sessionB.destroy();
    server.destroy();
  });

  it('o texto substituído é registrado ao editar a nota', () => {
    const server = new CollaborativeServerEmulator('epoch-1');
    const transport = new DeterministicTransportHub(server);
    const section = createCanvasSection();
    const session = new YjsCollaborationSession(
      transport,
      { documentId: 'doc-buffer', section, roomEpoch: 'epoch-1' },
      'sess-sticky-buffer',
    );
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'note', type: 'sticky', x: 0, y: 0, text: 'Original' },
    });
    section.dispatch({ type: 'shape.update', id: 'note', patch: { text: 'Substituído' } });
    expect(session.lastReplacedTextBuffers[0]).toEqual({ shapeId: 'note', text: 'Original' });
    session.destroy();
  });

  it('modo e tamanho fixos viajam e movem a nota sem refazer a fonte', async () => {
    const { server, sectionA, sectionB, sessionA, sessionB } = await pair();
    sectionA.dispatch({
      type: 'shape.create',
      shape: {
        id: 'note',
        type: 'sticky',
        x: 0,
        y: 0,
        text: 'fixa',
        fontSizeMode: 'fixed',
        fontSize: 40,
      },
    });
    sectionB.dispatch({ type: 'shape.update', id: 'note', patch: { x: 300, y: 100, width: 500 } });
    expect(sectionA.getSnapshot().document.nodes['note']).toMatchObject({
      fontSizeMode: 'fixed',
      fontSize: 40,
      x: 300,
      width: 500,
    });

    sessionA.destroy();
    sessionB.destroy();
    server.destroy();
  });
});
