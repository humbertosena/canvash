import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { exportSvg } from './index.js';

// O SVG só do board (spec board-export, §4.3 e §4.4; US-BE.1 a 4 e 10).

const rect = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'rectangle',
  x,
  y,
  width: 40,
  height: 30,
  rotation: 0,
  style: { fill: '#336699', stroke: null, strokeWidth: 0, opacity: 1 },
  ...extra,
});

/** O board de referência (100, 50, 300 × 200) com um filho que passa 50 da borda direita. */
function setup(
  board: Record<string, unknown> = {},
  extra: unknown[] = [],
  attach: string[] = ['child'],
): CanvasSectionApi {
  const section = createCanvasSection();
  const result = section.transact([
    {
      type: 'shape.create',
      shape: {
        id: 'b1',
        type: 'board',
        x: 100,
        y: 50,
        width: 300,
        height: 200,
        title: 'Segredo',
        ...board,
      },
    },
    { type: 'shape.create', shape: rect('child', 350, 100, { width: 100, height: 50 }) },
    {
      type: 'shape.create',
      shape: rect('over', 200, 120, {
        style: { fill: '#aa0000', stroke: null, strokeWidth: 0, opacity: 1 },
      }),
    },
    ...extra,
    ...(attach.length > 0 ? [{ type: 'board.attach', boardId: 'b1', ids: attach }] : []),
  ] as never);
  expect(result.ok).toBe(true);
  return section;
}

async function svgOf(section: CanvasSectionApi, options: Record<string, unknown> = {}) {
  const result = await exportSvg(section, { scope: { board: 'b1' }, ...options } as never);
  expect(result.ok).toBe(true);
  return result.ok ? result.value : '';
}

describe('exportSvg com o escopo de board', () => {
  it('US-BE.1: o viewBox é a área do board com a meia borda', async () => {
    const svg = await svgOf(setup());

    expect(svg).toContain('viewBox="99.5 49.5 301 201"');
    expect(svg).toContain('width="301" height="201"');
  });

  it('US-BE.1: com padding o viewBox cresce, e sem borda é só o retângulo', async () => {
    expect(await svgOf(setup(), { padding: 10 })).toContain('viewBox="89.5 39.5 321 221"');
    expect(
      await svgOf(setup({ style: { fill: '#ffffff', fillOpacity: 1, stroke: null } })),
    ).toContain('viewBox="100 50 300 200"');
  });

  it('US-BE.2: o filho fica num <g> recortado no retângulo, e o item do board fora dele', async () => {
    const svg = await svgOf(setup());

    expect(svg).toContain(
      '<clipPath id="canvash-board-clip-1"><rect x="100" y="50" width="300" height="200" /></clipPath>',
    );
    expect(svg).toContain('<g clip-path="url(#canvash-board-clip-1)">');
    const group = svg.indexOf('<g clip-path="url(#canvash-board-clip-1)">');
    const boardRect = svg.indexOf('x="100" y="50" width="300" height="200" fill="#ffffff"');
    const child = svg.indexOf('x="350" y="100" width="100" height="50"');
    expect(boardRect).toBeGreaterThan(-1);
    expect(boardRect).toBeLessThan(svg.indexOf('<clipPath'));
    expect(child).toBeGreaterThan(group);
    expect(svg.indexOf('</g>')).toBeGreaterThan(child);
  });

  it('US-BE.3: o fundo leva fill-opacity, a borda é um rect sem preenchimento, e nenhum leva opacity', async () => {
    const svg = await svgOf(
      setup({ style: { fill: '#ffeecc', fillOpacity: 0.5, stroke: '#d4d4d8' } }),
    );

    expect(svg).toContain(
      '<rect x="100" y="50" width="300" height="200" fill="#ffeecc" fill-opacity="0.5" />',
    );
    expect(svg).toContain(
      '<rect x="100" y="50" width="300" height="200" fill="none" stroke="#d4d4d8" stroke-width="1" />',
    );
    expect(svg).not.toMatch(/<rect[^>]* opacity=/);
  });

  it('US-BE.3: com fillOpacity 0 a borda continua', async () => {
    const svg = await svgOf(
      setup({ style: { fill: '#ffeecc', fillOpacity: 0, stroke: '#d4d4d8' } }),
    );

    expect(svg).not.toContain('fill="#ffeecc"');
    expect(svg).toContain('fill="none" stroke="#d4d4d8" stroke-width="1"');
  });

  it('US-BE.3: o título não aparece em nenhum <text>', async () => {
    const svg = await svgOf(setup());

    expect(svg).not.toContain('Segredo');
    expect(svg).not.toContain('<text');
  });

  it('US-BE.3: o nó que só se sobrepõe ao board não aparece', async () => {
    const svg = await svgOf(setup());

    expect(svg).not.toContain('#aa0000');
    expect(svg).not.toContain('x="200" y="120"');
  });

  it('US-BE.3: o filho oculto fica fora, um grupo filho entra com os membros e o locked entra', async () => {
    const section = setup(
      {},
      [
        {
          type: 'shape.create',
          shape: rect('hidden', 110, 60, {
            style: { fill: '#112233', stroke: null, strokeWidth: 0, opacity: 1 },
          }),
        },
        {
          type: 'shape.create',
          shape: rect('locked', 160, 60, {
            style: { fill: '#445566', stroke: null, strokeWidth: 0, opacity: 1 },
          }),
        },
        {
          type: 'shape.create',
          shape: rect('m1', 110, 200, {
            style: { fill: '#778899', stroke: null, strokeWidth: 0, opacity: 1 },
          }),
        },
        {
          type: 'shape.create',
          shape: rect('m2', 160, 200, {
            style: { fill: '#99aabb', stroke: null, strokeWidth: 0, opacity: 1 },
          }),
        },
        { type: 'group.create', id: 'g', childIds: ['m1', 'm2'] },
      ],
      ['child', 'hidden', 'locked', 'g'],
    );
    section.dispatch({ type: 'shape.update', id: 'hidden', patch: { visible: false } });
    section.dispatch({ type: 'shape.update', id: 'locked', patch: { locked: true } });

    const svg = await svgOf(section);

    expect(svg).not.toContain('#112233');
    for (const color of ['#445566', '#778899', '#99aabb']) expect(svg).toContain(color);
  });

  it('a nota e o texto da forma dentro do board seguem com os ids a partir de 2', async () => {
    const section = setup(
      {},
      [
        {
          type: 'shape.create',
          shape: {
            id: 'note',
            type: 'sticky',
            x: 120,
            y: 70,
            width: 100,
            height: 80,
            text: 'Nota',
          },
        },
        {
          type: 'shape.create',
          shape: rect('lbl', 240, 70, { label: { text: 'Olá' }, width: 100, height: 60 }),
        },
      ],
      ['child', 'note', 'lbl'],
    );

    const svg = await svgOf(section);

    expect(svg).toContain('id="canvash-board-clip-1"');
    expect(svg).toMatch(/id="canvash-sticky-[2-9]"/);
    expect(svg).toMatch(/id="canvash-label-[2-9]"/);
    expect(svg).not.toContain('id="canvash-sticky-1"');
    expect(svg).not.toContain('b1');
    expect(svg).not.toContain('"child"');
  });

  it('um board sem filhos exporta só o item dele, sem <g>', async () => {
    const svg = await svgOf(setup({}, [], []));

    expect(svg).not.toContain('<g clip-path');
    expect(svg).toContain('fill="#ffffff"');
  });

  it('o fundo da opção background cobre a área inteira, padding incluído, por baixo de tudo', async () => {
    const svg = await svgOf(setup(), { padding: 10, background: '#eeeeee' });

    expect(svg.indexOf('fill="#eeeeee"')).toBeLessThan(svg.indexOf('fill="#ffffff"'));
    expect(svg).toContain('<rect x="89.5" y="39.5" width="321" height="221" fill="#eeeeee" />');
  });
});

describe('exportSvg: erros de escopo (US-BE.4)', () => {
  const error = async (section: CanvasSectionApi, scope: unknown) => {
    const result = await exportSvg(section, { scope } as never);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('esperava erro');
    expect(result.error.code).toBe('INVALID_SCOPE');
    return result.error.details;
  };

  it('devolve o motivo certo para cada caso', async () => {
    const section = setup();
    expect(await error(section, { board: 'nope' })).toEqual({ reason: 'not-found', id: 'nope' });
    expect(await error(section, { board: 'child' })).toEqual({
      reason: 'not-a-board',
      id: 'child',
    });
    for (const scope of [
      { board: 42 },
      { board: '' },
      { board: 'b1', x: 0, width: 10 },
      {},
      null,
    ]) {
      expect(await error(section, scope)).toEqual({ reason: 'malformed' });
    }
  });

  it('board oculto e board em camada oculta dão hidden', async () => {
    expect(await error(setup({ visible: false }), { board: 'b1' })).toEqual({
      reason: 'hidden',
      id: 'b1',
    });
    const section = setup();
    section.dispatch({
      type: 'layer.update',
      id: section.getSnapshot().document.layers[0]!.id,
      patch: { visible: false },
    });
    expect(await error(section, { board: 'b1' })).toEqual({ reason: 'hidden', id: 'b1' });
  });

  it('os erros não mudam a revisão nem o histórico', async () => {
    const section = setup();
    const before = section.getSnapshot();

    await error(section, { board: 'nope' });
    await error(section, null);

    expect(section.getSnapshot().revision).toBe(before.revision);
    expect(section.getSnapshot().history).toEqual(before.history);
  });
});

describe('exportSvg: determinismo e overlays (US-BE.10)', () => {
  it('duas exportações seguidas dão a mesma string', async () => {
    const section = setup();

    expect(await svgOf(section)).toBe(await svgOf(section));
  });

  it('seleção, peers e bloqueios remotos não entram no SVG', async () => {
    const section = setup();
    const plain = await svgOf(section);

    section.setSelection(['b1']);
    section.setPeers([
      {
        sessionId: 'p',
        name: 'Participante Secreto',
        color: '#ab12cd',
        cursor: { x: 120, y: 80 },
        selection: ['child'],
        selectedAt: 1,
        drag: { ids: ['b1', 'child'], dx: 30, dy: 30 },
        view: null,
        locks: ['b1'],
        released: ['child'],
        followed: true,
      },
    ]);

    const withOverlays = await svgOf(section);

    expect(withOverlays).toBe(plain);
    expect(withOverlays).not.toContain('Secreto');
    expect(withOverlays.toLowerCase()).not.toContain('ab12cd');
  });
});

describe('exportSvg: escopos antigos', () => {
  it('o escopo malformado deixa de exportar o documento inteiro em silêncio', async () => {
    const result = await exportSvg(setup(), { scope: {} } as never);

    expect(result.ok).toBe(false);
  });
});
