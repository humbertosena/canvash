import { createCanvasSection, fitStickyFontSize, type StickyNode } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { matchKeyboardShortcut } from '../keyboard.js';
import { toPreviewShape } from '../transform.js';
import { buildResizePatch, buildResizePreview, resizeShape } from './resize.js';
import { scaleShapeUniform } from './resize-multiple.js';
import { rotateShapes } from './rotate.js';
import {
  DEFAULT_STICKY_COLOR,
  buildProvisionalSticky,
  buildStickyPreview,
  computeStickyCreation,
  isStickyColor,
  isStickyNode,
} from './sticky.js';

describe('computeStickyCreation', () => {
  it('um clique põe a nota 200 × 200 com o canto superior esquerdo no ponto', () => {
    expect(computeStickyCreation({ x: 40, y: 60 }, { x: 40, y: 60 }, 8)).toEqual({
      x: 40,
      y: 60,
      width: 200,
      height: 200,
    });
  });

  it('um arrasto curto em algum eixo ainda é clique', () => {
    const box = { x: 10, y: 10, width: 200, height: 200 };
    expect(computeStickyCreation({ x: 10, y: 10 }, { x: 13, y: 12 }, 8)).toEqual(box);
    expect(computeStickyCreation({ x: 10, y: 10 }, { x: 300, y: 12 }, 8)).toEqual(box);
    expect(computeStickyCreation({ x: 10, y: 10 }, { x: 12, y: 300 }, 8)).toEqual(box);
  });

  it('um arrasto maior usa a caixa do gesto, em qualquer direção', () => {
    const start = { x: 100, y: 100 };
    const cases = [
      { end: { x: 220, y: 180 }, box: { x: 100, y: 100, width: 120, height: 80 } },
      { end: { x: 20, y: 180 }, box: { x: 20, y: 100, width: 80, height: 80 } },
      { end: { x: 220, y: 40 }, box: { x: 100, y: 40, width: 120, height: 60 } },
      { end: { x: 20, y: 40 }, box: { x: 20, y: 40, width: 80, height: 60 } },
    ];
    for (const { end, box } of cases) {
      expect(computeStickyCreation(start, end, 8)).toEqual(box);
    }
  });
});

describe('nota provisória e preview', () => {
  const box = { x: 10, y: 20, width: 150, height: 120 };

  it('nasce vazia, automática, com a cor dada e a fonte do ajuste', () => {
    const note = buildProvisionalSticky(box, '#f8bbd0', 'sticky-1');
    expect(note).toMatchObject({
      id: 'sticky-1',
      type: 'sticky',
      ...box,
      rotation: 0,
      text: '',
      fontSizeMode: 'auto',
      textAlign: 'left',
      visible: true,
      locked: false,
      style: { fill: '#f8bbd0', stroke: null, strokeWidth: 0, opacity: 1 },
    });
    expect(note.fontSize).toBe(fitStickyFontSize(note));
  });

  it('o preview leva a caixa e a cor', () => {
    expect(buildStickyPreview(box, '#bbdefb', '__p__')).toEqual({
      id: '__p__',
      type: 'sticky',
      ...box,
      rotation: 0,
      style: { fill: '#bbdefb', opacity: 0.85 },
    });
  });

  it('o amarelo da paleta é a cor padrão', () => {
    expect(DEFAULT_STICKY_COLOR).toBe('#fff59d');
  });
});

describe('guardas', () => {
  it('isStickyColor aceita #rrggbb e #rrggbbaa em qualquer caixa', () => {
    for (const ok of ['#fff59d', '#FFF59D', '#fff59d80']) expect(isStickyColor(ok)).toBe(true);
    for (const bad of ['fff59d', '#fff', '#12345', 'amarelo', '', null, 3, undefined]) {
      expect(isStickyColor(bad)).toBe(false);
    }
  });

  it('isStickyNode reconhece só a nota', () => {
    expect(isStickyNode({ type: 'sticky' })).toBe(true);
    expect(isStickyNode({ type: 'text' })).toBe(false);
    expect(isStickyNode(null)).toBe(false);
    expect(isStickyNode('sticky')).toBe(false);
  });
});

describe('nota adesiva como figura de caixa', () => {
  const note: StickyNode = {
    id: 'n',
    type: 'sticky',
    x: 100,
    y: 100,
    width: 200,
    height: 150,
    rotation: 0,
    text: 'Reunião de planejamento',
    fontSize: 28,
    fontSizeMode: 'auto',
    fontFamily: 'serif',
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 1.4,
    visible: true,
    locked: false,
    style: { fill: '#bbdefb', stroke: null, strokeWidth: 0, opacity: 1 },
  };

  it('redimensiona livre pelas alças e Shift preserva a proporção', () => {
    const free = resizeShape(note, 'se', { x: 400, y: 300 }) as StickyNode;
    expect(free).toMatchObject({ width: 300, height: 200, text: 'Reunião de planejamento' });

    const kept = resizeShape(note, 'se', { x: 400, y: 300 }, { preserveAspectRatio: true });
    expect((kept as StickyNode).width / (kept as StickyNode).height).toBeCloseTo(200 / 150, 9);
  });

  it('o patch do resize leva só a caixa e o preview leva o texto, a fonte e a cor', () => {
    const resized = resizeShape(note, 'e', { x: 380, y: 175 }) as StickyNode;
    expect(buildResizePatch(resized)).toEqual({
      x: 100,
      y: 100,
      width: 280,
      height: 150,
    });
    expect(buildResizePreview(resized)).toMatchObject({
      type: 'sticky',
      width: 280,
      text: 'Reunião de planejamento',
      fontFamily: 'serif',
      fontWeight: 'bold',
      textAlign: 'center',
      lineHeight: 1.4,
      fontSizeMode: 'auto',
      style: { fill: '#bbdefb' },
    });
    expect(toPreviewShape(note)).toMatchObject({ type: 'sticky', text: 'Reunião de planejamento' });
  });

  it('a preview do canvas aceita a nota redimensionada e refaz a fonte no modo automático', () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'n', type: 'sticky', x: 100, y: 100, text: 'Reunião de planejamento' },
    });
    const created = section.getSnapshot().document.nodes['n'] as StickyNode;
    const resized = resizeShape(created, 'se', { x: 700, y: 700 }) as StickyNode;
    expect(section.setPreview({ updates: [buildResizePreview(resized)] }).ok).toBe(true);
    const shown = section.getPreview()?.updates['n'] as StickyNode;
    expect(shown).toMatchObject({ type: 'sticky', width: 600, height: 600 });
    // O preview refaz a fonte pelo ajuste: a nota maior comporta um tamanho maior.
    expect(shown.fontSize).toBeGreaterThan(created.fontSize);
  });

  it('a escala uniforme e a rotação preservam o texto e a cor', () => {
    const scaled = scaleShapeUniform(note, { x: 0, y: 0 }, 2) as StickyNode;
    expect(scaled).toMatchObject({ width: 400, height: 300, text: note.text, fontSize: 28 });
    const [turned] = rotateShapes([note], { x: 200, y: 175 }, Math.PI / 2);
    expect(turned).toMatchObject({ type: 'sticky', rotation: Math.PI / 2, text: note.text });
  });

  it('não tem atalho de teclado', () => {
    for (const key of ['n', 'N', 's', 'S', 'p', 'P', 'k', 'K']) {
      expect(matchKeyboardShortcut({ key })).toBeNull();
    }
  });
});
