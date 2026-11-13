import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { exportSvg } from './index.js';

// Texto dentro das formas na exportação SVG (spec shape-label, US-SL.12).

const LABEL = { text: 'Olá' };

function sectionWith(shapes: Array<Record<string, unknown>>) {
  const section = createCanvasSection();
  shapes.forEach((shape, index) => {
    const result = section.dispatch({
      type: 'shape.create',
      shape: {
        id: `s${index}`,
        type: 'rectangle',
        x: 10 + index * 300,
        y: 20,
        width: 200,
        height: 100,
        rotation: 0,
        ...shape,
        // Sem contorno por padrão, para a área ser a da tabela (só a margem de 8).
        style: { stroke: null, strokeWidth: 0, ...(shape['style'] as object | undefined) },
      } as never,
    });
    expect(result.ok).toBe(true);
  });
  return section;
}

async function svgOf(shapes: Array<Record<string, unknown>>): Promise<string> {
  const result = await exportSvg(sectionWith(shapes));
  expect(result.ok).toBe(true);
  return result.ok ? result.value : '';
}

describe('exportSvg com o texto da forma (US-SL.12)', () => {
  it('traz um <text> por linha, recortado pela área inscrita, sem foreignObject', async () => {
    const svg = await svgOf([{ label: { text: 'Olá\nmundo' } }]);

    expect(svg).toContain('<clipPath id="canvash-label-1">');
    // A área do retângulo 200 × 100 em (10, 20), menos 8 de margem: (18, 28), 184 × 84.
    expect(svg).toContain('<rect x="18" y="28" width="184" height="84" />');
    expect(svg.match(/<text /g)).toHaveLength(2);
    expect(svg).toContain('clip-path="url(#canvash-label-1)">Olá</text>');
    expect(svg).toContain('>mundo</text>');
    expect(svg).toContain('font-family="sans-serif"');
    expect(svg).toContain('font-size="16"');
    expect(svg).toContain('font-weight="normal"');
    expect(svg).not.toContain('foreignObject');
  });

  it('o <text> vem depois do elemento da forma, na mesma ordem da pilha', async () => {
    const svg = await svgOf([{ label: LABEL }]);

    expect(svg.indexOf('<rect x="10" y="20"')).toBeLessThan(svg.indexOf('<clipPath'));
    expect(svg.indexOf('<clipPath')).toBeLessThan(svg.indexOf('<text '));
  });

  it('escapa o conteúdo e os atributos', async () => {
    const svg = await svgOf([
      { label: { text: 'A & B "x" \'y\'', fontFamily: 'Fonte "Z"', color: '#ff0000' } },
    ]);

    expect(svg).toContain('A &amp; B &quot;x&quot; &apos;y&apos;');
    expect(svg).toContain('font-family="Fonte &quot;Z&quot;"');
    expect(svg).toContain('fill="#ff0000"');
  });

  it('a cor automática segue o fundo: clara sobre escuro e escura sobre claro', async () => {
    const dark = await svgOf([
      { style: { fill: '#000000' }, label: LABEL },
      { style: { fill: '#ffffff' }, label: LABEL },
    ]);

    expect(dark).toMatch(/fill="#ffffff" clip-path="url\(#canvash-label-1\)"/);
    expect(dark).toMatch(/fill="#1f2937" clip-path="url\(#canvash-label-2\)"/);
  });

  it('a forma girada leva o transform rotate no <g> do texto', async () => {
    const svg = await svgOf([{ rotation: Math.PI / 6, label: LABEL }]);

    // Centro da caixa: (110, 70); a rotação é de 30 graus.
    const match = /<g transform="rotate\(([\d.]+) 110 70\)">/.exec(svg);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeCloseTo(30, 6);
  });

  it('a opacidade da forma vai para o <g> do texto', async () => {
    const svg = await svgOf([{ style: { opacity: 0.5 }, label: LABEL }]);

    expect(svg).toContain('<g opacity="0.5">');
    // O elemento da forma também a leva.
    expect(svg).toMatch(/<rect x="10" y="20"[^>]*opacity="0.5"/);
  });

  it('sem texto ou sem label, nada é acrescentado', async () => {
    const empty = await svgOf([{ label: { text: '' } }]);
    const absent = await svgOf([{}]);

    for (const svg of [empty, absent]) {
      expect(svg).not.toContain('<text ');
      expect(svg).not.toContain('clipPath');
    }
  });

  it('forma sem preenchimento e sem contorno ainda exporta o texto', async () => {
    const svg = await svgOf([
      { style: { fill: null, stroke: null, strokeWidth: 0 }, label: LABEL },
    ]);

    expect(svg).toContain('>Olá</text>');
  });

  it('as nove formas exportam o texto', async () => {
    const nine = [
      { type: 'rectangle' },
      { type: 'square', width: 100 },
      { type: 'ellipse' },
      { type: 'circle', width: 100 },
      { type: 'diamond' },
      { type: 'triangle' },
      { type: 'polygon', sides: 6, width: 120, height: 120 },
      { type: 'cross', width: 120, height: 120 },
      { type: 'chevron' },
    ].map((shape) => ({ ...shape, label: LABEL }));

    const svg = await svgOf(nine);

    expect(svg.match(/<text /g)).toHaveLength(nine.length);
    expect(svg.match(/<clipPath /g)).toHaveLength(nine.length);
  });

  it('numa cena com notas e formas com texto, todos os ids de clipPath são únicos e resolvem', async () => {
    const svg = await svgOf([
      { type: 'sticky', text: 'nota 1', fontSizeMode: 'fixed', fontSize: 20, height: 200 },
      { label: LABEL },
      { type: 'sticky', text: 'nota 2', fontSizeMode: 'fixed', fontSize: 20, height: 200 },
      { type: 'ellipse', label: LABEL },
    ]);

    const ids = [...svg.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1]!);
    const refs = new Set([...svg.matchAll(/clip-path="url\(#([^)]+)\)"/g)].map((m) => m[1]!));

    expect(ids).toEqual([
      'canvash-sticky-1',
      'canvash-label-2',
      'canvash-sticky-3',
      'canvash-label-4',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const ref of refs) expect(ids).toContain(ref);
    expect(refs.size).toBe(ids.length);
  });

  it('uma cena só com notas mantém os ids de hoje', async () => {
    const svg = await svgOf([
      { type: 'sticky', text: 'a', fontSizeMode: 'fixed', fontSize: 20, height: 200 },
      { type: 'sticky', text: 'b', fontSizeMode: 'fixed', fontSize: 20, height: 200 },
    ]);

    expect([...svg.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1])).toEqual([
      'canvash-sticky-1',
      'canvash-sticky-2',
    ]);
  });

  it('o texto não muda os limites da exportação', async () => {
    const plain = await svgOf([{}]);
    const withText = await svgOf([{ label: { text: 'x'.repeat(500) } }]);

    const header = (svg: string) => /<svg [^>]*>/.exec(svg)![0];
    expect(header(withText)).toBe(header(plain));
  });
});
