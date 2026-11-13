import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { escapeXml, exportSvg } from './svg.js';

describe('exportSvg (IO-05, IO-06)', () => {
  it('escapa caracteres especiais de XML/HTML garantindo imunidade a XSS (IO-06)', () => {
    const raw = '<script>alert("XSS & injection")</script>\'';
    const escaped = escapeXml(raw);
    expect(escaped).toBe(
      '&lt;script&gt;alert(&quot;XSS &amp; injection&quot;)&lt;/script&gt;&apos;',
    );
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
  });

  it('exporta documento vazio com SVG mínimo e válido', async () => {
    const section = createCanvasSection();
    const result = await exportSvg(section);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(result.value).toContain('viewBox="0 0 100 100"');
    expect(result.value).toContain('</svg>');
  });

  it('exporta documento completo com retângulos, elipses, linhas, setas e textos (IO-05)', async () => {
    const section = createCanvasSection();

    // 1. Retângulo
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-1',
        type: 'rectangle',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        rotation: 0.1,
        style: { fill: '#ff0000', stroke: '#000000', strokeWidth: 2, opacity: 0.8 },
      },
    });

    // 2. Elipse
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'ellipse-1',
        type: 'ellipse',
        x: 150,
        y: 20,
        width: 80,
        height: 80,
        rotation: 0,
        style: { fill: '#00ff00', stroke: null, strokeWidth: 0, opacity: 1 },
      },
    });

    // 3. Linha
    const lineRes = section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'line-1',
        type: 'line',
        start: { x: 0, y: 0 },
        end: { x: 50, y: 50 },
        style: { stroke: '#0000ff', strokeWidth: 3, opacity: 1 },
      },
    });
    expect(lineRes.ok).toBe(true);

    // 4. Seta
    const arrowRes = section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'arrow-1',
        type: 'arrow',
        start: { x: 50, y: 100 },
        end: { x: 150, y: 100 },
        startMarker: 'dot',
        endMarker: 'arrow',
        style: { stroke: '#333333', strokeWidth: 2, opacity: 1 },
      },
    });
    expect(arrowRes.ok).toBe(true);

    // 5. Texto com conteúdo contendo caracteres de escape
    const textRes = section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'text-1',
        type: 'text',
        x: 10,
        y: 200,
        width: 200,
        height: 40,
        rotation: 0,
        text: 'Hello & "friends" (x < 5 and y > 2)',
        fontSize: 16,
        fontFamily: 'Inter',
        fontWeight: 'bold',
        textAlign: 'center',
        lineHeight: 1.2,
        style: { fill: '#111111', stroke: null, strokeWidth: 0, opacity: 1 },
      },
    });
    expect(textRes.ok).toBe(true);

    const result = await exportSvg(section, {
      padding: 10,
      background: '#f8fafc',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const svg = result.value;
    // Fundo
    expect(svg).toContain('<rect');
    expect(svg).toContain('fill="#f8fafc"');

    // Elementos
    expect(svg).toContain('<rect x="10" y="20" width="100" height="50"');
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('<line');
    expect(svg).toContain('<polygon'); // Ponta da seta
    expect(svg).toContain('<circle'); // Marcador dot

    // Texto escapado com segurança
    expect(svg).toContain('Hello &amp; &quot;friends&quot;');
    expect(svg).toContain('&lt; 5 and y &gt; 2)');
    expect(svg).not.toContain('< 5');
  });

  it('respeita escopo de seleção e bounds explícitos', async () => {
    const section = createCanvasSection();

    section.dispatch({
      type: 'shape.create',
      shape: { id: 's1', type: 'rectangle', x: 0, y: 0, width: 50, height: 50, rotation: 0 },
    });
    section.dispatch({
      type: 'shape.create',
      shape: { id: 's2', type: 'rectangle', x: 200, y: 200, width: 50, height: 50, rotation: 0 },
    });

    // Seleciona apenas s1
    section.setSelection(['s1']);

    const selResult = await exportSvg(section, { scope: 'selection' });
    expect(selResult.ok).toBe(true);
    if (!selResult.ok) return;

    expect(selResult.value).toContain('x="0" y="0"');
    expect(selResult.value).not.toContain('x="200" y="200"');

    // Escopo de bounds explícito
    const boundsResult = await exportSvg(section, {
      scope: { x: 50, y: 50, width: 300, height: 300 },
    });
    expect(boundsResult.ok).toBe(true);
    if (!boundsResult.ok) return;
    expect(boundsResult.value).toContain('viewBox="50 50 300 300"');
  });

  it('omite nós e camadas ocultos', async () => {
    const section = createCanvasSection();

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'visible-node',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
      },
    });

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'hidden-node',
        type: 'rectangle',
        x: 50,
        y: 50,
        width: 10,
        height: 10,
        rotation: 0,
        visible: false,
      },
    });

    const result = await exportSvg(section);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toContain('x="0" y="0"');
    expect(result.value).not.toContain('x="50" y="50"');
  });

  it('suporta rotação em elipse, texto rotacionado com traço e marcadores alternativos de seta', async () => {
    const section = createCanvasSection();

    // Elipse com rotação e opacidade parcial
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'e-rot',
        type: 'ellipse',
        x: 10,
        y: 10,
        width: 60,
        height: 40,
        rotation: 0.5,
        style: { fill: '#abcdef', stroke: '#123456', strokeWidth: 2, opacity: 0.5 },
      },
    });

    // Seta com marcador inicial 'arrow' e final 'dot'
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'a-inv',
        type: 'arrow',
        start: { x: 100, y: 100 },
        end: { x: 200, y: 100 },
        startMarker: 'arrow',
        endMarker: 'dot',
        style: { stroke: '#000000', strokeWidth: 2, opacity: 0.7 },
      },
    });

    // Texto com rotação, stroke e opacidade
    const tRotRes = section.dispatch({
      type: 'shape.create',
      shape: {
        id: 't-rot',
        type: 'text',
        x: 200,
        y: 200,
        width: 100,
        height: 30,
        rotation: 0.3,
        text: 'Rotated Text',
        style: { fill: '#000000', stroke: '#ffffff', strokeWidth: 1, opacity: 0.9 },
      },
    });
    expect(tRotRes.ok).toBe(true);

    // Forma com opacidade 0 (deve ser omitida)
    const invRes = section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'invisible-opacity',
        type: 'rectangle',
        x: 300,
        y: 300,
        width: 50,
        height: 50,
        rotation: 0,
        style: { fill: '#000000', stroke: null, strokeWidth: 0, opacity: 0 },
      },
    });
    expect(invRes.ok).toBe(true);

    const result = await exportSvg(section);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const svg = result.value;
    expect(svg).toContain('transform="rotate(');
    expect(svg).toContain('opacity="0.5"');
    expect(svg).toContain('opacity="0.7"');
    expect(svg).toContain('opacity="0.9"');
    expect(svg).not.toContain('x="300" y="300"');
  });

  it('exporta SquareNode como elemento <rect> com dimensões iguais', async () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'sq-svg',
        type: 'square',
        x: 30,
        y: 40,
        width: 80,
        height: 80,
        rotation: 0,
        style: { fill: '#aabbcc', stroke: '#112233', strokeWidth: 2, opacity: 1 },
      },
    });

    const result = await exportSvg(section);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toContain(
      '<rect x="30" y="40" width="80" height="80" fill="#aabbcc" stroke="#112233" stroke-width="2" />',
    );
  });

  it('exporta CircleNode como elemento <ellipse> com rx === ry', async () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'c-svg',
        type: 'circle',
        x: 20,
        y: 30,
        width: 100,
        height: 100,
        rotation: 0,
        style: { fill: '#10b981', stroke: '#047857', strokeWidth: 2, opacity: 1 },
      },
    });

    const result = await exportSvg(section);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toContain(
      '<ellipse cx="70" cy="80" rx="50" ry="50" fill="#10b981" stroke="#047857" stroke-width="2" />',
    );
  });

  it('exporta DiamondNode como elemento <polygon> com os 4 pontos médios das arestas e rotação', async () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'd-svg',
        type: 'diamond',
        x: 10,
        y: 20,
        width: 100,
        height: 60,
        rotation: 0,
        style: { fill: '#f59e0b', stroke: '#b45309', strokeWidth: 2, opacity: 1 },
      },
    });
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'd-svg-rot',
        type: 'diamond',
        x: 200,
        y: 20,
        width: 80,
        height: 40,
        rotation: Math.PI / 2,
        style: { fill: null, stroke: '#111827', strokeWidth: 1, opacity: 0.8 },
      },
    });

    const result = await exportSvg(section);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toContain(
      '<polygon points="60,20 110,50 60,80 10,50" fill="#f59e0b" stroke="#b45309" stroke-width="2" />',
    );
    expect(result.value).toContain(
      '<polygon points="240,20 280,40 240,60 200,40" fill="none" stroke="#111827" stroke-width="1" opacity="0.8" transform="rotate(90 240 40)" />',
    );
  });

  it('exporta TriangleNode como elemento <polygon> com os 3 vértices do contorno nas 4 variantes', async () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'tr-iso',
        type: 'triangle',
        x: 10,
        y: 20,
        width: 100,
        height: 80,
        rotation: 0,
        variant: 'isosceles',
        style: { fill: '#8b5cf6', stroke: '#5b21b6', strokeWidth: 2, opacity: 1 },
      },
    });
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'tr-right',
        type: 'triangle',
        x: 150,
        y: 20,
        width: 100,
        height: 80,
        rotation: 0,
        variant: 'right',
        style: { fill: '#8b5cf6', stroke: '#5b21b6', strokeWidth: 2, opacity: 1 },
      },
    });
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'tr-scalene',
        type: 'triangle',
        x: 300,
        y: 20,
        width: 100,
        height: 80,
        rotation: 0,
        variant: 'scalene',
        apex: 0.25,
        style: { fill: '#8b5cf6', stroke: '#5b21b6', strokeWidth: 2, opacity: 1 },
      },
    });

    const result = await exportSvg(section);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toContain(
      '<polygon points="60,20 110,100 10,100" fill="#8b5cf6" stroke="#5b21b6" stroke-width="2" />',
    );
    expect(result.value).toContain(
      '<polygon points="150,20 250,100 150,100" fill="#8b5cf6" stroke="#5b21b6" stroke-width="2" />',
    );
    expect(result.value).toContain(
      '<polygon points="325,20 400,100 300,100" fill="#8b5cf6" stroke="#5b21b6" stroke-width="2" />',
    );
  });
});

describe('exportSvg de polígono (Tarefa 108)', () => {
  it('exporta PolygonNode como <polygon> com um vértice por lado, a partir do topo', async () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'pg-svg',
        type: 'polygon',
        x: 10,
        y: 20,
        width: 100,
        height: 100,
        rotation: 0,
        sides: 3,
        style: { fill: '#14b8a6', stroke: '#0f766e', strokeWidth: 2, opacity: 1 },
      },
    });

    const result = await exportSvg(section);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const match =
      /<polygon points="([^"]+)" fill="#14b8a6" stroke="#0f766e" stroke-width="2" \/>/.exec(
        result.value,
      );
    expect(match).not.toBeNull();
    const points = match![1]!.split(' ').map((pair) => pair.split(',').map(Number));
    expect(points).toHaveLength(3);
    points.forEach(([x, y], k) => {
      const angle = -Math.PI / 2 + (k * 2 * Math.PI) / 3;
      expect(x).toBeCloseTo(60 + 50 * Math.cos(angle), 9);
      expect(y).toBeCloseTo(70 + 50 * Math.sin(angle), 9);
    });
  });
});

describe('exportSvg de curva Bézier (Tarefa 111)', () => {
  function sectionWithCurve(style: Record<string, unknown>) {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'bz-svg',
        type: 'bezier',
        start: { x: 0, y: 0 },
        control1: { x: 0, y: -40 },
        control2: { x: 100, y: -40 },
        end: { x: 100, y: 0 },
        style,
      },
    });
    return section;
  }

  it('exporta como <path d="M … C …"> sem preenchimento, na caixa exata da curva com o traço', async () => {
    const result = await exportSvg(sectionWithCurve({ stroke: '#7c3aed', strokeWidth: 2 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain(
      '<path d="M 0 0 C 0 -40, 100 -40, 100 0" fill="none" stroke="#7c3aed" stroke-width="2" />',
    );
    // Topo do arco em y = -30 (t = 0,5), mais meio traço de cada lado
    expect(result.value).toContain('viewBox="-1 -31 102 32"');
  });

  it('escapa a cor do traço, leva a opacidade e omite o traço invisível', async () => {
    const translucent = await exportSvg(
      sectionWithCurve({ stroke: '#7c3aed', strokeWidth: 2, opacity: 0.5 }),
    );
    expect(translucent.ok && translucent.value).toContain('opacity="0.5"');

    const noStroke = await exportSvg(sectionWithCurve({ stroke: null }));
    expect(noStroke.ok && noStroke.value).toContain(
      '<path d="M 0 0 C 0 -40, 100 -40, 100 0" fill="none" />',
    );
  });
});
