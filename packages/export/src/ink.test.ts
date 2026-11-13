import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { exportSvg } from './index.js';

function sectionWith(strokes: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  const section = createCanvasSection();
  const result = section.dispatch({
    type: 'shape.create',
    shape: { id: 'k1', type: 'ink', strokes, ...extra } as never,
  });
  expect(result.ok).toBe(true);
  return section;
}

const LINE = [
  { x: 10, y: 10 },
  { x: 60, y: 40 },
  { x: 110, y: 10 },
];

async function svgOf(section: ReturnType<typeof createCanvasSection>): Promise<string> {
  const result = await exportSvg(section);
  expect(result.ok).toBe(true);
  return result.ok ? result.value : '';
}

describe('exportSvg do traço à mão livre', () => {
  it('exporta um <path> por traço com curvas quadráticas, pontas e juntas redondas', async () => {
    const svg = await svgOf(sectionWith([{ points: LINE }]));
    expect(svg).toContain('<g>');
    expect(svg).toContain(
      '<path d="M10 10 Q60 40 85 25 L110 10" fill="none" stroke="#1f2937" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />',
    );
    expect(svg.match(/<path /g)).toHaveLength(1);
  });

  it('um <path> para cada traço, cada um com a sua cor e espessura', async () => {
    const svg = await svgOf(
      sectionWith([
        { points: LINE, color: '#ef4444', kind: 'marker', width: 'thick' },
        { points: LINE, color: '#3b82f6', kind: 'pen', width: 'thin' },
      ]),
    );
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).toContain('stroke="#ef4444" stroke-width="16"');
    expect(svg).toContain('stroke="#3b82f6" stroke-width="2"');
  });

  it('o marca-texto sai com stroke-opacity 0,4 e a cor com alfa é separada', async () => {
    const svg = await svgOf(
      sectionWith([
        { points: LINE, color: '#eab308', kind: 'highlighter', width: 'medium' },
        { points: LINE, color: '#00000080', kind: 'pen', width: 'medium' },
      ]),
    );
    expect(svg).toContain(
      'stroke="#eab308" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.4"',
    );
    expect(svg).toContain('stroke="#000000" stroke-width="4"');
    expect(svg).toContain('stroke-opacity="0.502"');
    expect(svg).not.toContain('#00000080');
  });

  it('um ponto único vira <circle> e dois pontos, uma linha', async () => {
    const svg = await svgOf(
      sectionWith([
        { points: [{ x: 5, y: 5 }], color: '#ef4444', kind: 'marker', width: 'thick' },
        {
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
          ],
        },
      ]),
    );
    expect(svg).toContain('<circle cx="5" cy="5" r="8" fill="#ef4444" />');
    expect(svg).toContain('d="M0 0 L20 0"');
  });

  it('um pingo de marca-texto leva fill-opacity', async () => {
    const svg = await svgOf(
      sectionWith([{ points: [{ x: 5, y: 5 }], kind: 'highlighter', width: 'thin' }]),
    );
    expect(svg).toContain('fill-opacity="0.4"');
  });

  it('aplica rotação e opacidade do elemento no grupo', async () => {
    const svg = await svgOf(
      sectionWith(
        [{ points: [{ x: 0.5, y: 0.5 }], color: '#000000', kind: 'pen', width: 'thin' }],
        {
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          rotation: Math.PI / 2,
          style: { opacity: 0.5 },
        },
      ),
    );
    expect(svg).toContain('<g opacity="0.5" transform="rotate(90 50 20)">');
  });

  it('arredonda os números do caminho a 3 casas', async () => {
    const svg = await svgOf(
      sectionWith([
        {
          points: [
            { x: 0.123456, y: 0.987654 },
            { x: 10.55555, y: 3.33333 },
          ],
        },
      ]),
    );
    expect(svg).toContain('d="M0.123 0.988 L10.556 3.333"');
  });

  it('o SVG não leva nada além do que o exportador monta (sem tags soltas)', async () => {
    const svg = await svgOf(sectionWith([{ points: LINE, color: '#ef4444' }]));
    expect(svg).not.toMatch(/<script|onload|javascript:/i);
  });

  it('a área exportada cobre o traço com a margem', async () => {
    const svg = await svgOf(sectionWith([{ points: LINE, kind: 'highlighter', width: 'thick' }]));
    // Caixa: pontos de 10 a 110 em x e de 10 a 40 em y, mais meia espessura (12).
    expect(svg).toContain('viewBox="-2 -2 124 54"');
  });
});
