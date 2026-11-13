import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { exportSvg } from './index.js';

function sectionWith(notes: Array<Record<string, unknown>>) {
  const section = createCanvasSection();
  notes.forEach((note, index) => {
    const result = section.dispatch({
      type: 'shape.create',
      shape: {
        id: `n${index}`,
        type: 'sticky',
        x: 10 + index * 300,
        y: 20,
        width: 200,
        height: 100,
        fontSizeMode: 'fixed',
        fontSize: 20,
        ...note,
      } as never,
    });
    expect(result.ok).toBe(true);
  });
  return section;
}

describe('exportSvg da nota adesiva', () => {
  it('exporta sombra, corpo dobrado, dobra, recorte e uma linha de texto por linha', async () => {
    const result = await exportSvg(sectionWith([{ text: 'Olá\nmundo' }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const svg = result.value;

    expect(svg).toContain('<g>');
    expect(svg).toContain(
      '<rect x="10" y="22" width="200" height="100" fill="#000000" opacity="0.15" />',
    );
    expect(svg).toContain('<polygon points="10,20 210,20 210,96 186,120 10,120" fill="#fff59d" />');
    expect(svg).toContain('<polygon points="186,96 210,96 186,120" fill="#e0d88a" />');
    expect(svg).toContain(
      '<clipPath id="canvash-sticky-1"><rect x="10" y="20" width="200" height="100" /></clipPath>',
    );
    expect(svg.match(/<text /g)).toHaveLength(2);
    expect(svg).toContain('fill="#1f2937" clip-path="url(#canvash-sticky-1)">Olá</text>');
    expect(svg).toContain('>mundo</text>');
    expect(svg).toContain('font-size="20"');
  });

  it('usa texto claro sobre fundo escuro e mostra o contorno quando há traço', async () => {
    const result = await exportSvg(
      sectionWith([{ text: 'a', style: { fill: '#4c1d95', stroke: '#111827', strokeWidth: 3 } }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('fill="#4c1d95" stroke="#111827" stroke-width="3"');
    expect(result.value).toContain('fill="#ffffff" clip-path');
  });

  it('aplica rotação e opacidade no grupo inteiro', async () => {
    const result = await exportSvg(
      sectionWith([{ text: 'a', rotation: Math.PI / 2, style: { opacity: 0.5 } }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('<g opacity="0.5" transform="rotate(90 110 70)">');
  });

  it('dá um recorte próprio a cada nota', async () => {
    const result = await exportSvg(sectionWith([{ text: 'a' }, { text: 'b' }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('id="canvash-sticky-1"');
    expect(result.value).toContain('id="canvash-sticky-2"');
    expect(result.value.match(/<clipPath /g)).toHaveLength(2);
  });

  it('escapa o texto e nunca emite tags vindas dele', async () => {
    const result = await exportSvg(sectionWith([{ text: 'a & b "c" \'d\'' }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('a &amp; b &quot;c&quot; &apos;d&apos;');
  });

  it('a área de exportação inclui a sombra da nota', async () => {
    const result = await exportSvg(sectionWith([{ text: '' }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Caixa 200 × 100 em (10, 20), mais 8 de sombra em cada lado.
    expect(result.value).toContain('viewBox="2 12 216 116"');
  });

  it('nota totalmente transparente não aparece', async () => {
    const result = await exportSvg(sectionWith([{ text: 'a', style: { opacity: 0 } }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toContain('<g');
  });
});
