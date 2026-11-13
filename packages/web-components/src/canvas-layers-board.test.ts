import {
  createCanvasSection,
  type CanvasNode,
  type CanvasSectionApi,
  type Layer,
} from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { CanvasLayersElement } from './canvas-layers.js';

// O board no painel de camadas (spec boards, US-BD.11): o título, os filhos aninhados da frente
// para o fundo e a reordenação entre os irmãos do board.

/** Texto do template: as partes fixas intercaladas com os valores, funções ignoradas. */
function templateText(result: unknown): string {
  if (Array.isArray(result)) return result.map(templateText).join('');
  if (result && typeof result === 'object' && 'strings' in result && 'values' in result) {
    const { strings, values } = result as { strings: readonly string[]; values: unknown[] };
    return strings.reduce(
      (text, part, i) => text + part + (i < values.length ? templateText(values[i]) : ''),
      '',
    );
  }
  if (typeof result === 'function' || result === undefined || result === null) return '';
  return String(result);
}

interface Testable {
  _selectNode(nodeId: string, event: KeyboardEvent): void;
  _reorderNode(layer: Layer, node: CanvasNode, direction: 'up' | 'down', e?: Event): void;
}

const rect = (id: string, x: number) => ({
  id,
  type: 'rectangle',
  x,
  y: 0,
  width: 20,
  height: 20,
  rotation: 0,
});

function setup() {
  const el = new CanvasLayersElement();
  const section = createCanvasSection();
  el.section = section;
  section.transact([
    {
      type: 'shape.create',
      shape: { id: 'b', type: 'board', x: 0, y: 0, width: 400, height: 300, title: 'Fluxo' },
    },
    { type: 'shape.create', shape: rect('c1', 10) },
    { type: 'shape.create', shape: rect('c2', 40) },
    { type: 'shape.create', shape: rect('m1', 70) },
    { type: 'shape.create', shape: rect('m2', 100) },
    { type: 'shape.create', shape: rect('out', 600) },
    { type: 'group.create', id: 'g', childIds: ['m1', 'm2'] },
    { type: 'board.attach', boardId: 'b', ids: ['c1', 'c2', 'g'] },
  ] as never);
  return {
    el,
    section,
    internals: el as unknown as Testable,
    html: (): string => templateText(el.render()),
  };
}

const node = (section: CanvasSectionApi, id: string) => section.getSnapshot().document.nodes[id]!;
const layer = (section: CanvasSectionApi) => section.getSnapshot().document.layers[0]!;

/** O trecho do HTML da linha do nó: do `data-node-id` dele até o `data-node-id` seguinte. */
function rowOf(html: string, id: string): string {
  const start = html.indexOf(`data-node-id=${id}`);
  expect(start).toBeGreaterThan(-1);
  const next = html.indexOf('data-node-id=', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

describe('CanvasLayersElement: board aninhado', () => {
  it('mostra o board com o título e, depois dele, os filhos da frente para o fundo', () => {
    const { html } = setup();
    const out = html();

    expect(rowOf(out, 'b')).toContain('Fluxo');
    const order = ['b', 'g', 'c2', 'c1'].map((id) => out.indexOf(`data-node-id=${id}`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out.indexOf('data-node-id=out')).toBeGreaterThan(-1);
  });

  it('mostra os membros do grupo que está dentro do board', () => {
    const { html } = setup();
    const out = html();

    expect(out.indexOf('data-node-id=m1')).toBeGreaterThan(out.indexOf('data-node-id=g'));
    expect(out.indexOf('data-node-id=m2')).toBeGreaterThan(out.indexOf('data-node-id=g'));
  });

  it('os filhos aparecem numa lista aninhada no item do board', () => {
    const { html } = setup();

    expect(html()).toContain('data-parent-id=b');
  });

  it('subir um filho reordena só em childIds do board', () => {
    const { section, internals } = setup();
    const layerBefore = [...layer(section).childIds];

    internals._reorderNode(layer(section), node(section, 'c1'), 'up');

    expect((node(section, 'b') as { childIds: readonly string[] }).childIds).toEqual([
      'c2',
      'c1',
      'g',
    ]);
    expect(layer(section).childIds).toEqual(layerBefore);
  });

  it('descer um filho reordena só em childIds do board', () => {
    const { section, internals } = setup();

    internals._reorderNode(layer(section), node(section, 'g'), 'down');

    expect((node(section, 'b') as { childIds: readonly string[] }).childIds).toEqual([
      'c1',
      'g',
      'c2',
    ]);
  });

  it('nos extremos do board o botão fica desabilitado', () => {
    const { html } = setup();
    const out = html();

    expect(rowOf(out, 'g')).toMatch(/data-action="node-up"[\s\S]*?\?disabled=true/);
    expect(rowOf(out, 'c2')).toMatch(/data-action="node-up"[\s\S]*?\?disabled=false/);
    expect(rowOf(out, 'c1')).toMatch(/data-action="node-down"[\s\S]*?\?disabled=true/);
    expect(rowOf(out, 'c2')).toMatch(/data-action="node-down"[\s\S]*?\?disabled=false/);
  });

  it('reordenar os membros do grupo dentro do board vale entre os irmãos do grupo', () => {
    const { section, internals } = setup();

    internals._reorderNode(layer(section), node(section, 'm1'), 'up');

    expect((node(section, 'g') as { childIds: readonly string[] }).childIds).toEqual(['m2', 'm1']);
  });

  it('com o board bloqueado os botões dos filhos ficam desabilitados', () => {
    const { section, html } = setup();
    section.dispatch({ type: 'shape.update', id: 'b', patch: { locked: true } });

    expect(rowOf(html(), 'c2')).toMatch(/data-action="node-up"[\s\S]*?\?disabled=true/);
  });

  it('com o board travado por outro participante, o filho não se seleciona pelo teclado e leva a marca', () => {
    const { section, internals, html } = setup();
    section.setPeers([
      {
        sessionId: 'outra',
        name: 'Bia',
        color: '#dc2626',
        cursor: null,
        selection: ['b'],
        selectedAt: 1,
        drag: null,
        view: null,
        locks: ['b'],
        followed: false,
      },
    ]);

    internals._selectNode('c1', { key: 'Enter' } as KeyboardEvent);
    internals._selectNode('m1', { key: 'Enter' } as KeyboardEvent);

    expect(section.getSnapshot().session.selectedIds).toEqual([]);
    expect(rowOf(html(), 'c1')).toContain('data-peer-locked=true');
    expect(rowOf(html(), 'm1')).toContain('data-peer-locked=true');
  });
});
