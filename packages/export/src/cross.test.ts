import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { exportSvg } from './index.js';

function sectionWithCross(extra: Record<string, unknown> = {}) {
  const section = createCanvasSection();
  section.dispatch({
    type: 'shape.create',
    shape: {
      id: 'cross-svg',
      type: 'cross',
      x: 10,
      y: 20,
      width: 120,
      height: 90,
      rotation: 0,
      style: { fill: '#f59e0b', stroke: '#b45309', strokeWidth: 2, opacity: 1 },
      ...extra,
    } as never,
  });
  return section;
}

describe('exportSvg da cruz', () => {
  it('exporta como <polygon> com os 12 vértices do contorno', async () => {
    const result = await exportSvg(sectionWithCross());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toContain(
      '<polygon points="55,20 85,20 85,50 130,50 130,80 85,80 85,110 55,110 55,80 10,80 10,50 55,50" fill="#f59e0b" stroke="#b45309" stroke-width="2" />',
    );
  });

  it('usa o armRatio dado, aplica a rotação e a opacidade', async () => {
    const result = await exportSvg(
      sectionWithCross({
        armRatio: 1,
        rotation: Math.PI / 2,
        style: { fill: null, stroke: '#111827', strokeWidth: 1, opacity: 0.5 },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Com armRatio 1 e a caixa 120 × 90 a cruz ocupa a caixa: os vértices cobrem os 4 lados.
    expect(result.value).toContain('fill="none" stroke="#111827" stroke-width="1" opacity="0.5"');
    expect(result.value).toContain('transform="rotate(90 70 65)"');
  });

  it('a caixa de exportação cobre a cruz inteira, com o traço', async () => {
    const result = await exportSvg(sectionWithCross());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('viewBox="9 19 122 92"');
  });
});
