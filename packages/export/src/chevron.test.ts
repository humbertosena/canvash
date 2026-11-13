import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { exportSvg } from './index.js';

function sectionWithChevron(extra: Record<string, unknown> = {}) {
  const section = createCanvasSection();
  section.dispatch({
    type: 'shape.create',
    shape: {
      id: 'chev-svg',
      type: 'chevron',
      x: 10,
      y: 20,
      width: 100,
      height: 60,
      rotation: 0,
      style: { fill: '#3b82f6', stroke: '#1e3a8a', strokeWidth: 2, opacity: 1 },
      ...extra,
    } as never,
  });
  return section;
}

describe('exportSvg do chevron', () => {
  it.each([
    ['right', '10,20 85,20 110,50 85,80 10,80 35,50'],
    ['left', '85,50 110,80 35,80 10,50 35,20 110,20'],
    ['down', '10,20 60,35 110,20 110,65 60,80 10,65'],
    ['up', '60,20 110,35 110,80 60,65 10,80 10,35'],
  ])('exporta a direção %s como <polygon> com os 6 vértices', async (direction, points) => {
    const result = await exportSvg(sectionWithChevron({ direction }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain(
      `<polygon points="${points}" fill="#3b82f6" stroke="#1e3a8a" stroke-width="2" />`,
    );
  });

  it('aplica rotação, opacidade e a ausência de preenchimento', async () => {
    const result = await exportSvg(
      sectionWithChevron({
        rotation: Math.PI / 2,
        style: { fill: null, stroke: '#111827', strokeWidth: 1, opacity: 0.5 },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('fill="none" stroke="#111827" stroke-width="1" opacity="0.5"');
    expect(result.value).toContain('transform="rotate(90 60 50)"');
  });
});
