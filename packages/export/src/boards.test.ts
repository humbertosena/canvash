import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { exportSvg } from './index.js';
import { prepareExportContext } from './bounds.js';

// Boards na exportação do documento (spec boards, US-BD.13): fundo com opacidade, borda de 1
// unidade, título, filhos à frente e a faixa do título na caixa de exportação.

const CARD = { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 };

function setup(
  boardExtra: Record<string, unknown> = {},
  options: { readonly selected?: readonly string[] } = {},
): CanvasSectionApi {
  const section = createCanvasSection();
  const result = section.transact([
    {
      type: 'shape.create',
      shape: {
        id: 'b',
        type: 'board',
        x: 100,
        y: 200,
        width: 300,
        height: 150,
        title: 'Fluxo',
        style: { fill: '#00ff00', fillOpacity: 0.5, stroke: null },
        ...boardExtra,
      },
    },
    {
      type: 'shape.create',
      shape: {
        id: 'c',
        type: 'rectangle',
        x: 120,
        y: 230,
        width: 40,
        height: 30,
        rotation: 0,
        style: CARD,
      },
    },
    {
      type: 'shape.create',
      shape: {
        id: 'm1',
        type: 'rectangle',
        x: 200,
        y: 230,
        width: 30,
        height: 30,
        rotation: 0,
        style: CARD,
      },
    },
    {
      type: 'shape.create',
      shape: {
        id: 'm2',
        type: 'rectangle',
        x: 240,
        y: 230,
        width: 30,
        height: 30,
        rotation: 0,
        style: CARD,
      },
    },
    {
      type: 'shape.create',
      shape: {
        id: 'out',
        type: 'rectangle',
        x: 900,
        y: 600,
        width: 50,
        height: 50,
        rotation: 0,
        style: CARD,
      },
    },
    { type: 'group.create', id: 'g', childIds: ['m1', 'm2'] },
    { type: 'board.attach', boardId: 'b', ids: ['c', 'g'] },
  ] as never);
  expect(result.ok).toBe(true);
  section.setSelection([...(options.selected ?? [])]);
  return section;
}

async function svgOf(section: CanvasSectionApi, scope?: 'selection'): Promise<string> {
  const result = await exportSvg(section, scope ? { scope } : {});
  expect(result.ok).toBe(true);
  return result.ok ? result.value : '';
}

describe('exportSvg com boards (US-BD.13)', () => {
  it('desenha o fundo com fill-opacity, o título e os filhos à frente do fundo', async () => {
    const svg = await svgOf(setup());

    expect(svg).toContain(
      '<rect x="100" y="200" width="300" height="150" fill="#00ff00" fill-opacity="0.5" />',
    );
    expect(svg).toContain('>Fluxo</text>');
    const background = svg.indexOf('fill="#00ff00"');
    const child = svg.indexOf('x="120" y="230"');
    const member = svg.indexOf('x="200" y="230"');
    expect(background).toBeGreaterThan(-1);
    expect(child).toBeGreaterThan(background);
    expect(member).toBeGreaterThan(child);
  });

  it('desenha a borda de 1 unidade num <rect> sem preenchimento', async () => {
    const svg = await svgOf(setup({ style: { fill: null, fillOpacity: 0.5, stroke: '#0000ff' } }));

    expect(svg).toContain(
      '<rect x="100" y="200" width="300" height="150" fill="none" stroke="#0000ff" stroke-width="1" />',
    );
    expect(svg).not.toContain('fill-opacity');
  });

  it('o título sai com a cor fixa #3f3f46, na fonte de 14, recortado pela faixa', async () => {
    const svg = await svgOf(setup());

    expect(svg).toMatch(
      /<text x="100" y="[\d.]+" font-family="sans-serif" font-size="14" fill="#3f3f46" clip-path="url\(#canvash-board-1\)">Fluxo<\/text>/,
    );
    expect(svg).toContain(
      '<clipPath id="canvash-board-1"><rect x="100" y="176" width="300" height="24" /></clipPath>',
    );
  });

  it('o título com <, & e aspas sai escapado', async () => {
    const svg = await svgOf(setup({ title: `A < B & "c" 'd'` }));

    expect(svg).toContain('>A &lt; B &amp; &quot;c&quot; &apos;d&apos;</text>');
    expect(svg).not.toContain('A < B');
  });

  it('um board sem fundo e sem borda só leva o título', async () => {
    const svg = await svgOf(setup({ style: { fill: null, fillOpacity: 0.5, stroke: null } }));

    expect(svg).not.toContain('x="100" y="200" width="300"');
    expect(svg).toContain('>Fluxo</text>');
  });

  it('um board oculto não sai, nem os filhos dele', async () => {
    const svg = await svgOf(setup({ visible: false }));

    expect(svg).not.toContain('Fluxo');
    expect(svg).not.toContain('x="120" y="230"');
    expect(svg).toContain('x="900" y="600"');
  });
});

describe('caixa de exportação com boards', () => {
  it('inclui a faixa do título e meia unidade da borda', () => {
    const section = setup({ style: { fill: '#00ff00', fillOpacity: 0.5, stroke: '#0000ff' } });

    const { bounds } = prepareExportContext(section, {});

    // O board vai de (99.5, 175.5) até (400.5, 350.5); o retângulo de fora estende até (950, 650).
    expect(bounds).toEqual({ x: 99.5, y: 175.5, width: 850.5, height: 474.5 });
  });

  it('com scope selection e um board selecionado, a caixa e as formas são as do board e dos descendentes', async () => {
    const section = setup({}, { selected: ['b'] });

    const { bounds, candidateIds } = prepareExportContext(section, { scope: 'selection' });

    expect(bounds).toEqual({ x: 100, y: 176, width: 300, height: 174 });
    expect([...candidateIds!].sort()).toEqual(['b', 'c', 'm1', 'm2']);
    const svg = await svgOf(section, 'selection');
    expect(svg).toContain('>Fluxo</text>');
    expect(svg).toContain('x="120" y="230"');
    expect(svg).toContain('x="200" y="230"');
    expect(svg).not.toContain('x="900" y="600"');
  });

  it('com um filho selecionado, o board não entra', async () => {
    const section = setup({}, { selected: ['c'] });

    const { bounds, candidateIds } = prepareExportContext(section, { scope: 'selection' });

    expect(bounds).toEqual({ x: 120, y: 230, width: 40, height: 30 });
    expect([...candidateIds!]).toEqual(['c']);
    expect(await svgOf(section, 'selection')).not.toContain('Fluxo');
  });

  it('o board vazio sozinho tem a caixa dele com a faixa do título', () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'solo',
        type: 'board',
        x: 10,
        y: 50,
        width: 80,
        height: 40,
        style: { fill: null, fillOpacity: 1, stroke: null },
      },
    });

    const { bounds } = prepareExportContext(section, {});

    expect(bounds).toEqual({ x: 10, y: 26, width: 80, height: 64 });
  });
});
