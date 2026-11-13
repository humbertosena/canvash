import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { exportSvg } from './index.js';

function sectionWithBrace(extra: Record<string, unknown> = {}) {
  const section = createCanvasSection();
  section.dispatch({
    type: 'shape.create',
    shape: {
      id: 'brace-svg',
      type: 'brace',
      x: 10,
      y: 20,
      width: 100,
      height: 200,
      rotation: 0,
      curvature: 1,
      style: { stroke: '#7c3aed', strokeWidth: 3, opacity: 1 },
      ...extra,
    } as never,
  });
  return section;
}

describe('exportSvg da chave', () => {
  it('exporta como <path> só de traço, com linhas e cúbicas', async () => {
    const result = await exportSvg(sectionWithBrace());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const match = /<path d="([^"]+)" fill="none" stroke="#7c3aed" stroke-width="3" \/>/.exec(
      result.value,
    );
    expect(match).not.toBeNull();
    const d = match![1]!;
    expect(d.startsWith('M 110 20 L 110 20 C ')).toBe(true);
    expect(d.match(/ C /g)).toHaveLength(4);
    expect(d.match(/ L /g)).toHaveLength(4);
    expect(d.endsWith('L 110 220')).toBe(true);
    // A ponta da chave, em (10, 120), é destino de uma cúbica.
    expect(d).toContain(', 10 120');
  });

  it('exporta a ponta para cada orientação na borda certa', async () => {
    const tips: Array<[string, string]> = [
      ['left', ', 10 120'],
      ['right', ', 110 120'],
    ];
    for (const [orientation, tip] of tips) {
      const result = await exportSvg(sectionWithBrace({ orientation }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toContain(tip);
    }
    const up = await exportSvg(sectionWithBrace({ orientation: 'up', width: 200, height: 100 }));
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    expect(up.value).toContain(', 110 20');
  });

  it('aplica rotação e opacidade e omite o traço quando não há cor', async () => {
    const turned = await exportSvg(
      sectionWithBrace({
        rotation: Math.PI / 2,
        style: { stroke: '#111827', strokeWidth: 1, opacity: 0.5 },
      }),
    );
    expect(turned.ok).toBe(true);
    if (!turned.ok) return;
    expect(turned.value).toContain('stroke="#111827" stroke-width="1" opacity="0.5"');
    expect(turned.value).toContain('transform="rotate(90 60 120)"');

    const plain = await exportSvg(sectionWithBrace({ style: { stroke: null, strokeWidth: 0 } }));
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    expect(plain.value).toMatch(/<path d="[^"]+" fill="none" \/>/);
  });
});
