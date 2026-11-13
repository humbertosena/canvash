import { describe, expect, it } from 'vitest';
import { createCanvasSection } from './canvas-section.js';
import { at } from './checks.js';
import { shapeBounds } from './geometry/bounds.js';
import { fitAspect } from './geometry/fit.js';
import { shapeInsideRect, shapeIntersectsRect } from './geometry/intersect.js';
import { shapeOutline } from './geometry/outline.js';
import { pointInShape } from './geometry/shapes.js';
import type { ValidationIssue } from './result.js';
import { mirrorControl } from './geometry/bezier.js';
import {
  normalizeRotation,
  patchShape,
  readShapeInput,
  readStoredShape,
  type BezierNode,
  type CircleNode,
  type PolygonNode,
  type SquareNode,
  type TriangleNode,
} from './shapes.js';

describe('normalizeRotation', () => {
  it.each([0, 0.3, -0.3, -Math.PI, 3, -3])('devolve %d sem alterar: já está na faixa', (angle) => {
    expect(normalizeRotation(angle)).toBe(angle);
  });

  it.each([
    [Math.PI, -Math.PI],
    [1.5 * Math.PI, -0.5 * Math.PI],
    [-1.5 * Math.PI, 0.5 * Math.PI],
    [2 * Math.PI, 0],
    [-2 * Math.PI, 0],
    [7, 7 - 2 * Math.PI],
    [-7, 2 * Math.PI - 7],
    [100 * Math.PI + 1, 1],
  ])('leva %d para [-π, π)', (angle, expected) => {
    const normalized = normalizeRotation(angle);

    expect(normalized).toBeCloseTo(expected, 9);
    expect(normalized).toBeGreaterThanOrEqual(-Math.PI);
    expect(normalized).toBeLessThan(Math.PI);
  });

  it('devolve -π quando o arredondamento deixaria o resultado fora da faixa', () => {
    // Para este ângulo, a redução dá -3.1415926535901235, um pouco abaixo de -π.
    expect(normalizeRotation(-12563.229021705583)).toBe(-Math.PI);
  });
});

describe('SquareNode validation and patching', () => {
  it('readShapeInput aceita quadrado com largura e altura iguais', () => {
    const issues: ValidationIssue[] = [];
    const factory = readShapeInput(
      { type: 'square', x: 10, y: 20, width: 50, height: 50, rotation: 0 },
      undefined,
      issues,
    );

    expect(issues).toEqual([]);
    expect(factory).toBeDefined();
    const node = factory!('sq-1');
    expect(node).toMatchObject({
      id: 'sq-1',
      type: 'square',
      x: 10,
      y: 20,
      width: 50,
      height: 50,
      rotation: 0,
    });
  });

  it('readShapeInput recusa quadrado com largura e altura desiguais', () => {
    const issues: ValidationIssue[] = [];
    readShapeInput(
      { type: 'square', x: 10, y: 20, width: 50, height: 60, rotation: 0 },
      undefined,
      issues,
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        rule: 'invalid-geometry',
        message: 'square width and height must be equal',
      }),
    );
  });

  it('readStoredShape valida quadrado e rejeita dimensões assimétricas', () => {
    const issuesOk: ValidationIssue[] = [];
    const pathOk = at(at(undefined, 'nodes'), 'sq-2');
    const square = readStoredShape(
      {
        id: 'sq-2',
        type: 'square',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
      pathOk,
      issuesOk,
    );

    expect(issuesOk).toEqual([]);
    expect(square?.type).toBe('square');

    const issuesBad: ValidationIssue[] = [];
    const pathBad = at(at(undefined, 'nodes'), 'sq-3');
    readStoredShape(
      {
        id: 'sq-3',
        type: 'square',
        x: 0,
        y: 0,
        width: 100,
        height: 100.5,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
      pathBad,
      issuesBad,
    );

    expect(issuesBad).toContainEqual(
      expect.objectContaining({
        rule: 'invalid-geometry',
      }),
    );
  });

  it('patchShape preserva a invariante 1:1 para nós square', () => {
    const baseSquare: SquareNode = {
      id: 'sq-4',
      type: 'square',
      x: 10,
      y: 10,
      width: 40,
      height: 40,
      rotation: 0,
      visible: true,
      locked: false,
      style: { fill: '#fff', stroke: '#000', strokeWidth: 1, opacity: 1 },
    };

    const issuesOk: ValidationIssue[] = [];
    const patchPath = at(undefined, 'patch');
    const patchedOk = patchShape(baseSquare, { width: 80, height: 80 }, patchPath, issuesOk);
    expect(issuesOk).toEqual([]);
    expect(patchedOk.type).toBe('square');
    if (patchedOk.type === 'square') {
      expect(patchedOk.width).toBe(80);
      expect(patchedOk.height).toBe(80);
    }

    const issuesBad: ValidationIssue[] = [];
    patchShape(
      baseSquare,
      { width: 90 }, // altera só a largura sem mudar a altura
      patchPath,
      issuesBad,
    );
    expect(issuesBad).toContainEqual(
      expect.objectContaining({
        rule: 'invalid-geometry',
        message: 'square width and height must be equal',
      }),
    );
  });
});

describe('CircleNode validation and patching', () => {
  it('readShapeInput aceita círculo com largura e altura iguais e recusa desiguais', () => {
    const issuesOk: ValidationIssue[] = [];
    const factory = readShapeInput(
      { type: 'circle', x: 10, y: 20, width: 50, height: 50, rotation: 0 },
      undefined,
      issuesOk,
    );

    expect(issuesOk).toEqual([]);
    expect(factory).toBeDefined();
    expect(factory!('ci-1')).toMatchObject({
      id: 'ci-1',
      type: 'circle',
      x: 10,
      y: 20,
      width: 50,
      height: 50,
      rotation: 0,
    });

    const issuesBad: ValidationIssue[] = [];
    readShapeInput(
      { type: 'circle', x: 10, y: 20, width: 50, height: 60, rotation: 0 },
      undefined,
      issuesBad,
    );
    expect(issuesBad).toContainEqual(
      expect.objectContaining({
        rule: 'invalid-geometry',
        message: 'circle width and height must be equal',
      }),
    );
  });

  it('readStoredShape valida círculo e rejeita dimensões assimétricas', () => {
    const issuesOk: ValidationIssue[] = [];
    const pathOk = at(at(undefined, 'nodes'), 'ci-2');
    const circle = readStoredShape(
      {
        id: 'ci-2',
        type: 'circle',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
      pathOk,
      issuesOk,
    );

    expect(issuesOk).toEqual([]);
    expect(circle?.type).toBe('circle');

    const issuesBad: ValidationIssue[] = [];
    const pathBad = at(at(undefined, 'nodes'), 'ci-3');
    readStoredShape(
      {
        id: 'ci-3',
        type: 'circle',
        x: 0,
        y: 0,
        width: 100,
        height: 100.5,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
      pathBad,
      issuesBad,
    );

    expect(issuesBad).toContainEqual(
      expect.objectContaining({
        rule: 'invalid-geometry',
        message: 'circle width and height must be equal',
      }),
    );
  });

  it('patchShape preserva a invariante 1:1 para nós circle e recusa conversão cruzada inválida', () => {
    const baseCircle = {
      id: 'ci-4',
      type: 'circle' as const,
      x: 10,
      y: 10,
      width: 40,
      height: 40,
      rotation: 0,
      visible: true,
      locked: false,
      style: { fill: '#fff', stroke: '#000', strokeWidth: 1, opacity: 1 },
    };

    const issuesOk: ValidationIssue[] = [];
    const patchPath = at(undefined, 'patch');
    const patchedOk = patchShape(baseCircle, { width: 80, height: 80 }, patchPath, issuesOk);
    expect(issuesOk).toEqual([]);
    expect(patchedOk.type).toBe('circle');

    const issuesBad: ValidationIssue[] = [];
    patchShape(baseCircle, { width: 90 }, patchPath, issuesBad);
    expect(issuesBad).toContainEqual(
      expect.objectContaining({
        rule: 'invalid-geometry',
        message: 'circle width and height must be equal',
      }),
    );

    const issuesCross: ValidationIssue[] = [];
    patchShape(baseCircle, { type: 'square' }, patchPath, issuesCross);
    expect(issuesCross).toContainEqual(
      expect.objectContaining({
        rule: 'unknown-field',
        path: ['patch', 'type'],
      }),
    );
  });

  it('hit-test, marquee e fitAspect seguem a geometria exata do círculo', () => {
    const circle: CircleNode = {
      id: 'ci-geo',
      type: 'circle',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      visible: true,
      locked: false,
      style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 2, opacity: 1 },
    };

    expect(pointInShape(circle, { x: 50, y: 50 }, 0)).toBe(true);
    expect(pointInShape(circle, { x: 2, y: 2 }, 0)).toBe(false);

    expect(shapeIntersectsRect(circle, { x: 40, y: 40, width: 20, height: 20 })).toBe(true);
    expect(shapeIntersectsRect(circle, { x: 1, y: 1, width: 3, height: 3 })).toBe(false);

    const hollowCircle: CircleNode = {
      ...circle,
      style: { fill: null, stroke: '#000000', strokeWidth: 2, opacity: 1 },
    };
    expect(shapeIntersectsRect(hollowCircle, { x: 40, y: 40, width: 20, height: 20 })).toBe(false);
    expect(shapeIntersectsRect(hollowCircle, { x: 48, y: 0, width: 4, height: 4 })).toBe(true);

    const fitted = fitAspect({ x: 10, y: 20, width: 200, height: 100, rotation: 0.5 }, 1);
    expect(fitted).toEqual({ x: 60, y: 20, width: 100, height: 100, rotation: 0.5 });
  });
});

describe('TriangleNode validation, outline, hit-test and patching', () => {
  it('readShapeInput aplica padrões (isosceles, apex 0.5) e valida invariantes de variante e ápice', () => {
    const issuesOk: ValidationIssue[] = [];
    const factory = readShapeInput(
      { type: 'triangle', x: 10, y: 20, width: 100, height: 80, rotation: 0 },
      undefined,
      issuesOk,
    );
    expect(issuesOk).toEqual([]);
    expect(factory!('tr-1')).toMatchObject({
      id: 'tr-1',
      type: 'triangle',
      variant: 'isosceles',
      apex: 0.5,
      x: 10,
      y: 20,
      width: 100,
      height: 80,
    });

    // Right triangle default apex = 0, scalene default apex = 0.3
    const issuesRight: ValidationIssue[] = [];
    const rightFactory = readShapeInput(
      { type: 'triangle', variant: 'right', x: 0, y: 0, width: 60, height: 80, rotation: 0 },
      undefined,
      issuesRight,
    );
    expect(issuesRight).toEqual([]);
    expect(rightFactory!('tr-r')).toMatchObject({ variant: 'right', apex: 0 });

    const issuesScalene: ValidationIssue[] = [];
    const scaleneFactory = readShapeInput(
      { type: 'triangle', variant: 'scalene', x: 0, y: 0, width: 60, height: 80, rotation: 0 },
      undefined,
      issuesScalene,
    );
    expect(issuesScalene).toEqual([]);
    expect(scaleneFactory!('tr-s')).toMatchObject({ variant: 'scalene', apex: 0.3 });

    // Recusa variante desconhecida
    const issuesBadVar: ValidationIssue[] = [];
    readShapeInput(
      { type: 'triangle', variant: 'obtuse', x: 0, y: 0, width: 50, height: 50, rotation: 0 },
      undefined,
      issuesBadVar,
    );
    expect(issuesBadVar).toContainEqual(expect.objectContaining({ rule: 'format' }));

    // Recusa apex fora de [0, 1]
    const issuesBadApex: ValidationIssue[] = [];
    readShapeInput(
      {
        type: 'triangle',
        variant: 'scalene',
        apex: 1.5,
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        rotation: 0,
      },
      undefined,
      issuesBadApex,
    );
    expect(issuesBadApex).toContainEqual(expect.objectContaining({ rule: 'invalid-geometry' }));

    // Recusa isosceles com apex != 0.5
    const issuesIsoApex: ValidationIssue[] = [];
    readShapeInput(
      {
        type: 'triangle',
        variant: 'isosceles',
        apex: 0.2,
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        rotation: 0,
      },
      undefined,
      issuesIsoApex,
    );
    expect(issuesIsoApex).toContainEqual(expect.objectContaining({ rule: 'invalid-geometry' }));

    // Recusa right com apex != 0
    const issuesRightApex: ValidationIssue[] = [];
    readShapeInput(
      {
        type: 'triangle',
        variant: 'right',
        apex: 0.5,
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        rotation: 0,
      },
      undefined,
      issuesRightApex,
    );
    expect(issuesRightApex).toContainEqual(expect.objectContaining({ rule: 'invalid-geometry' }));

    // Recusa equilateral com razão H/W incorreta
    const issuesEqRatio: ValidationIssue[] = [];
    readShapeInput(
      {
        type: 'triangle',
        variant: 'equilateral',
        apex: 0.5,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
      },
      undefined,
      issuesEqRatio,
    );
    expect(issuesEqRatio).toContainEqual(expect.objectContaining({ rule: 'invalid-geometry' }));
  });

  it('readStoredShape valida triângulo armazenado e rejeita invariantes violadas', () => {
    const issuesOk: ValidationIssue[] = [];
    const pathOk = at(at(undefined, 'nodes'), 'tr-stored');
    const stored = readStoredShape(
      {
        id: 'tr-stored',
        type: 'triangle',
        variant: 'equilateral',
        apex: 0.5,
        x: 0,
        y: 0,
        width: 100,
        height: (100 * Math.sqrt(3)) / 2,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
      pathOk,
      issuesOk,
    );
    expect(issuesOk).toEqual([]);
    expect(stored?.type).toBe('triangle');

    const issuesBad: ValidationIssue[] = [];
    readStoredShape(
      {
        id: 'tr-stored-bad',
        type: 'triangle',
        variant: 'equilateral',
        apex: 0.5,
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
      pathOk,
      issuesBad,
    );
    expect(issuesBad).toContainEqual(expect.objectContaining({ rule: 'invalid-geometry' }));
  });

  it('patchShape converte entre as 4 variantes de triângulo seguindo US-04.2', () => {
    const patchPath = at(undefined, 'patch');
    const baseIso: TriangleNode = {
      id: 'tr-conv',
      type: 'triangle',
      variant: 'isosceles',
      apex: 0.5,
      x: 10,
      y: 20,
      width: 100,
      height: 100,
      rotation: 0,
      visible: true,
      locked: false,
      style: { fill: '#fff', stroke: '#000', strokeWidth: 1, opacity: 1 },
    };

    // Isósceles -> Retângulo: apex = 0, caixa preservada
    const issuesRight: ValidationIssue[] = [];
    const toRight = patchShape(baseIso, { variant: 'right' }, patchPath, issuesRight);
    expect(issuesRight).toEqual([]);
    expect(toRight).toMatchObject({
      variant: 'right',
      apex: 0,
      x: 10,
      y: 20,
      width: 100,
      height: 100,
    });

    // Retângulo (apex 0) -> Escaleno: apex vira 0.3
    const issuesScalene1: ValidationIssue[] = [];
    const toScalene1 = patchShape(toRight, { variant: 'scalene' }, patchPath, issuesScalene1);
    expect(issuesScalene1).toEqual([]);
    expect(toScalene1).toMatchObject({ variant: 'scalene', apex: 0.3 });

    // Escaleno com apex customizado (0.75) -> Escaleno mantém 0.75
    const issuesScaleneCustom: ValidationIssue[] = [];
    const customScalene = patchShape(
      toScalene1,
      { apex: 0.75 },
      patchPath,
      issuesScaleneCustom,
    ) as TriangleNode;
    expect(issuesScaleneCustom).toEqual([]);
    expect(customScalene.apex).toBe(0.75);

    const issuesScaleneKeep: ValidationIssue[] = [];
    const keepScalene = patchShape(
      customScalene,
      { variant: 'scalene' },
      patchPath,
      issuesScaleneKeep,
    );
    expect(issuesScaleneKeep).toEqual([]);
    expect(keepScalene).toMatchObject({ variant: 'scalene', apex: 0.75 });

    // Escaleno (0.75) -> Equilátero: apex = 0.5 e fitAspect(box, 2/sqrt(3))
    const issuesEq: ValidationIssue[] = [];
    const toEq = patchShape(customScalene, { variant: 'equilateral' }, patchPath, issuesEq);
    expect(issuesEq).toEqual([]);
    const expectedH = (100 * Math.sqrt(3)) / 2;
    expect(toEq).toMatchObject({
      variant: 'equilateral',
      apex: 0.5,
      x: 10,
      y: expect.closeTo(20 + (100 - expectedH) / 2, 6),
      width: 100,
      height: expect.closeTo(expectedH, 6),
    });

    // Equilátero -> Isósceles com resize livre
    const issuesBackIso: ValidationIssue[] = [];
    const backIso = patchShape(
      toEq,
      { variant: 'isosceles', height: 120 },
      patchPath,
      issuesBackIso,
    );
    expect(issuesBackIso).toEqual([]);
    expect(backIso).toMatchObject({ variant: 'isosceles', apex: 0.5, width: 100, height: 120 });
  });

  it('shapeOutline, pointInShape, shapeIntersectsRect e shapeBounds seguem o contorno real do triângulo', () => {
    const tri: TriangleNode = {
      id: 'tr-geo',
      type: 'triangle',
      variant: 'isosceles',
      apex: 0.5,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      visible: true,
      locked: false,
      style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 2, opacity: 1 },
    };

    expect(shapeOutline(tri)).toEqual([
      { x: 50, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);

    // Centro da base/miolo atinge; canto superior esquerdo (5, 5) fora do triângulo não atinge
    expect(pointInShape(tri, { x: 50, y: 60 }, 0)).toBe(true);
    expect(pointInShape(tri, { x: 5, y: 5 }, 0)).toBe(false);

    // Marquee no canto superior vazio (2, 2, 10, 10) não toca
    expect(shapeIntersectsRect(tri, { x: 2, y: 2, width: 10, height: 10 })).toBe(false);
    expect(shapeIntersectsRect(tri, { x: 45, y: 50, width: 10, height: 10 })).toBe(true);

    // Triângulo oco (fill: null): retângulo pequeno dentro do miolo não toca
    const hollowTri: TriangleNode = {
      ...tri,
      style: { fill: null, stroke: '#000000', strokeWidth: 2, opacity: 1 },
    };
    expect(shapeIntersectsRect(hollowTri, { x: 45, y: 70, width: 10, height: 10 })).toBe(false);
    expect(shapeIntersectsRect(hollowTri, { x: 48, y: 0, width: 4, height: 4 })).toBe(true);

    // Bounds com rotação
    const rotatedBounds = shapeBounds({ ...tri, rotation: Math.PI / 4 });
    expect(rotatedBounds.width).toBeGreaterThan(50);
  });
});

describe('PolygonNode validation, outline, hit-test and patching', () => {
  const POLY: PolygonNode = {
    id: 'pg',
    type: 'polygon',
    sides: 5,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    visible: true,
    locked: false,
    style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 2, opacity: 1 },
  };

  it('readShapeInput cria pentágono por padrão e aceita de 3 a 12 lados', () => {
    const issues: ValidationIssue[] = [];
    const factory = readShapeInput(
      { type: 'polygon', x: 10, y: 20, width: 80, height: 80, rotation: 0 },
      undefined,
      issues,
    );
    expect(issues).toEqual([]);
    expect(factory!('pg-1')).toMatchObject({
      id: 'pg-1',
      type: 'polygon',
      sides: 5,
      x: 10,
      y: 20,
      width: 80,
      height: 80,
    });

    for (const sides of [3, 12]) {
      const okIssues: ValidationIssue[] = [];
      const ok = readShapeInput(
        { type: 'polygon', sides, x: 0, y: 0, width: 10, height: 10, rotation: 0 },
        undefined,
        okIssues,
      );
      expect(okIssues).toEqual([]);
      expect(ok!('pg')).toMatchObject({ sides });
    }
  });

  it.each([2, 13, 4.5, Number.NaN])('readShapeInput recusa sides = %d com range', (sides) => {
    const issues: ValidationIssue[] = [];
    readShapeInput(
      { type: 'polygon', sides, x: 0, y: 0, width: 10, height: 10, rotation: 0 },
      undefined,
      issues,
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        path: ['sides'],
        rule: Number.isNaN(sides) ? 'finite' : 'range',
      }),
    );
  });

  it('readShapeInput e readStoredShape recusam caixa que não é 1:1', () => {
    const inputIssues: ValidationIssue[] = [];
    readShapeInput(
      { type: 'polygon', x: 0, y: 0, width: 100, height: 80, rotation: 0 },
      undefined,
      inputIssues,
    );
    expect(inputIssues).toContainEqual(expect.objectContaining({ rule: 'invalid-geometry' }));

    const storedIssues: ValidationIssue[] = [];
    readStoredShape({ ...POLY, height: 80 }, at(at(undefined, 'nodes'), 'pg'), storedIssues);
    expect(storedIssues).toContainEqual(
      expect.objectContaining({ path: ['nodes', 'pg'], rule: 'invalid-geometry' }),
    );
  });

  it('readStoredShape lê polígono armazenado e exige sides válido', () => {
    const issues: ValidationIssue[] = [];
    expect(readStoredShape({ ...POLY }, at(at(undefined, 'nodes'), 'pg'), issues)).toEqual(POLY);
    expect(issues).toEqual([]);

    const missing: ValidationIssue[] = [];
    const withoutSides: Record<string, unknown> = { ...POLY };
    delete withoutSides['sides'];
    readStoredShape(withoutSides, at(at(undefined, 'nodes'), 'pg'), missing);
    expect(missing).toContainEqual(
      expect.objectContaining({ path: ['nodes', 'pg', 'sides'], rule: 'type' }),
    );

    const tooMany: ValidationIssue[] = [];
    readStoredShape({ ...POLY, sides: 20 }, at(at(undefined, 'nodes'), 'pg'), tooMany);
    expect(tooMany).toContainEqual(
      expect.objectContaining({ path: ['nodes', 'pg', 'sides'], rule: 'range' }),
    );
  });

  it('readShapeInput e patchShape recusam campos de outros tipos', () => {
    const inputIssues: ValidationIssue[] = [];
    readShapeInput(
      { type: 'polygon', variant: 'isosceles', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
      undefined,
      inputIssues,
    );
    expect(inputIssues).toContainEqual(expect.objectContaining({ rule: 'unknown-field' }));

    const patchIssues: ValidationIssue[] = [];
    patchShape(POLY, { type: 'rectangle' }, at(undefined, 'patch'), patchIssues);
    expect(patchIssues).toContainEqual(expect.objectContaining({ rule: 'unknown-field' }));
  });

  it('shapeOutline devolve o polígono regular inscrito, primeiro vértice no topo, em sentido horário', () => {
    const outline = shapeOutline(POLY);
    const step = (2 * Math.PI) / 5;
    expect(outline).toHaveLength(5);
    outline.forEach((vertex, k) => {
      const angle = -Math.PI / 2 + k * step;
      expect(vertex.x).toBeCloseTo(50 + 50 * Math.cos(angle), 9);
      expect(vertex.y).toBeCloseTo(50 + 50 * Math.sin(angle), 9);
    });
    expect(outline[0]).toEqual({ x: 50, y: 0 });
    // Segundo vértice à direita do primeiro: sentido horário na tela
    expect(outline[1]!.x).toBeCloseTo(97.5528258, 6);
    expect(outline[1]!.y).toBeCloseTo(34.5491503, 6);

    const square = shapeOutline({ ...POLY, sides: 4, x: 10, y: 20 });
    const expected = [
      { x: 60, y: 20 },
      { x: 110, y: 70 },
      { x: 60, y: 120 },
      { x: 10, y: 70 },
    ];
    square.forEach((vertex, k) => {
      expect(vertex.x).toBeCloseTo(expected[k]!.x, 9);
      expect(vertex.y).toBeCloseTo(expected[k]!.y, 9);
    });
    expect(shapeOutline({ ...POLY, sides: 12 })).toHaveLength(12);
  });

  it('hit-test e marquee seguem o contorno: canto e faixa abaixo da base do pentágono ficam de fora', () => {
    expect(pointInShape(POLY, { x: 50, y: 50 }, 0)).toBe(true);
    expect(pointInShape(POLY, { x: 5, y: 5 }, 0)).toBe(false);
    // A base do pentágono fica em y ≈ 90,45: y = 96 está dentro da caixa, mas fora do traço.
    expect(pointInShape(POLY, { x: 50, y: 96 }, 0)).toBe(false);
    expect(pointInShape(POLY, { x: 50, y: 91 }, 0)).toBe(true);

    expect(shapeIntersectsRect(POLY, { x: 1, y: 1, width: 8, height: 8 })).toBe(false);
    expect(shapeIntersectsRect(POLY, { x: 40, y: 94, width: 20, height: 5 })).toBe(false);
    expect(shapeIntersectsRect(POLY, { x: 45, y: 45, width: 10, height: 10 })).toBe(true);

    const hollow: PolygonNode = {
      ...POLY,
      style: { fill: null, stroke: '#000000', strokeWidth: 2, opacity: 1 },
    };
    expect(pointInShape(hollow, { x: 50, y: 50 }, 0)).toBe(false);
    expect(shapeIntersectsRect(hollow, { x: 45, y: 45, width: 10, height: 10 })).toBe(false);
    expect(shapeIntersectsRect(hollow, { x: 48, y: 0, width: 4, height: 4 })).toBe(true);
  });

  it('shapeBounds do polígono girado envolve o contorno girado e o traço', () => {
    const rotated = { ...POLY, rotation: Math.PI };
    const bounds = shapeBounds(rotated);
    // Girado meia volta, o vértice do topo vai para a base: y de 9,55 a 100, mais 1 de meio traço.
    expect(bounds.x).toBeCloseTo(50 - 47.5528258 - 1, 6);
    expect(bounds.y).toBeCloseTo(100 - 90.4508497 - 1, 6);
    expect(bounds.width).toBeCloseTo(2 * 47.5528258 + 2, 6);
    expect(bounds.height).toBeCloseTo(90.4508497 + 2, 6);
  });

  it('patchShape troca sides mantendo centro e tamanho e recusa valores fora da faixa', () => {
    const path = at(undefined, 'patch');
    const issues: ValidationIssue[] = [];
    const hexagon = patchShape({ ...POLY, x: 10, y: 20 }, { sides: 6 }, path, issues);
    expect(issues).toEqual([]);
    expect(hexagon).toMatchObject({ sides: 6, x: 10, y: 20, width: 100, height: 100 });

    const bad: ValidationIssue[] = [];
    patchShape(POLY, { sides: 13 }, path, bad);
    expect(bad).toContainEqual(
      expect.objectContaining({ path: ['patch', 'sides'], rule: 'range' }),
    );
  });

  it('patchShape exige caixa 1:1 depois do patch', () => {
    const path = at(undefined, 'patch');
    const both: ValidationIssue[] = [];
    expect(patchShape(POLY, { width: 60, height: 60 }, path, both)).toMatchObject({
      width: 60,
      height: 60,
      sides: 5,
    });
    expect(both).toEqual([]);

    const onlyWidth: ValidationIssue[] = [];
    patchShape(POLY, { width: 60 }, path, onlyWidth);
    expect(onlyWidth).toContainEqual(
      expect.objectContaining({ path: ['patch'], rule: 'invalid-geometry' }),
    );
  });
});

describe('BezierNode validation, patching, hit-test and marquee', () => {
  const ARC: BezierNode = {
    id: 'bz',
    type: 'bezier',
    start: { x: 0, y: 0 },
    control1: { x: 0, y: 100 },
    control2: { x: 100, y: 100 },
    end: { x: 100, y: 0 },
    symmetric: true,
    visible: true,
    locked: false,
    style: { stroke: '#000000', strokeWidth: 2, opacity: 1 },
  };
  const PATH = at(undefined, 'patch');

  function create(input: Record<string, unknown>) {
    const issues: ValidationIssue[] = [];
    const factory = readShapeInput({ type: 'bezier', ...input }, undefined, issues);
    return { issues, node: issues.length === 0 ? (factory!('bz') as BezierNode) : undefined };
  }

  it('readShapeInput cria arco simétrico padrão só com início e fim', () => {
    const { issues, node } = create({ start: { x: 0, y: 0 }, end: { x: 120, y: 0 } });
    expect(issues).toEqual([]);
    expect(node).toEqual({
      id: 'bz',
      type: 'bezier',
      start: { x: 0, y: 0 },
      control1: { x: 40, y: -30 },
      control2: { x: 80, y: -30 },
      end: { x: 120, y: 0 },
      symmetric: true,
      visible: true,
      locked: false,
      style: { stroke: '#000000', strokeWidth: 1, opacity: 1 },
    });
  });

  it('readShapeInput simétrica deriva o controle que faltar', () => {
    const fromFirst = create({
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      control1: { x: 20, y: -30 },
    });
    expect(fromFirst.node).toMatchObject({
      control1: { x: 20, y: -30 },
      control2: { x: 80, y: -30 },
    });

    const fromSecond = create({
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      control2: { x: 90, y: 10 },
    });
    expect(fromSecond.node).toMatchObject({
      control1: { x: 10, y: 10 },
      control2: { x: 90, y: 10 },
    });
  });

  it('readShapeInput aceita controles coerentes, livres sem simetria, e recusa os incoerentes', () => {
    const { start, control1, control2, end, symmetric } = ARC;
    expect(create({ start, control1, control2, end, symmetric }).issues).toEqual([]);

    const free = create({
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      control1: { x: 10, y: 50 },
      control2: { x: 30, y: -70 },
      symmetric: false,
    });
    expect(free.issues).toEqual([]);
    expect(free.node).toMatchObject({ symmetric: false, control2: { x: 30, y: -70 } });

    const broken = create({
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      control1: { x: 10, y: 50 },
      control2: { x: 30, y: -70 },
    });
    expect(broken.issues).toEqual([
      expect.objectContaining({ path: [], rule: 'invalid-geometry' }),
    ]);
  });

  it('a tolerância da simetria cresce com a corda', () => {
    const chord = 1e6;
    const start = { x: 0, y: 0 };
    const end = { x: chord, y: 0 };
    const control1 = { x: 1000, y: 500 };
    const mirrored = mirrorControl(start, end, control1);
    // 0,5 está abaixo de 1e-6·1e6 = 1, e 2 está acima
    expect(
      create({ start, end, control1, control2: { ...mirrored, y: mirrored.y + 0.5 } }).issues,
    ).toEqual([]);
    expect(
      create({ start, end, control1, control2: { ...mirrored, y: mirrored.y + 2 } }).issues,
    ).toContainEqual(expect.objectContaining({ rule: 'invalid-geometry' }));
  });

  it('readShapeInput recusa início igual ao fim, preenchimento e campos de caixa', () => {
    expect(create({ start: { x: 5, y: 5 }, end: { x: 5, y: 5 } }).issues).toEqual([
      expect.objectContaining({ rule: 'zero-length' }),
    ]);
    expect(
      create({ start: { x: 0, y: 0 }, end: { x: 9, y: 0 }, style: { fill: '#ff0000' } }).issues,
    ).toContainEqual(expect.objectContaining({ path: ['style', 'fill'], rule: 'unknown-field' }));
    expect(create({ start: { x: 0, y: 0 }, end: { x: 9, y: 0 }, width: 4 }).issues).toContainEqual(
      expect.objectContaining({ path: ['width'], rule: 'unknown-field' }),
    );
    expect(
      create({ start: { x: 0, y: 0 }, end: { x: 9, y: 0 }, symmetric: 'sim' }).issues,
    ).toContainEqual(expect.objectContaining({ path: ['symmetric'], rule: 'type' }));
    expect(
      create({ start: { x: 0, y: 0 }, end: { x: 9, y: 0 }, control1: { x: 1 } }).issues,
    ).toContainEqual(expect.objectContaining({ path: ['control1', 'y'] }));
  });

  it('readStoredShape lê a curva inteira e confere a simetria', () => {
    const path = at(at(undefined, 'nodes'), 'bz');
    const issues: ValidationIssue[] = [];
    expect(readStoredShape({ ...ARC }, path, issues)).toEqual(ARC);
    expect(issues).toEqual([]);

    const broken: ValidationIssue[] = [];
    readStoredShape({ ...ARC, control2: { x: 90, y: 100 } }, path, broken);
    expect(broken).toEqual([
      expect.objectContaining({ path: ['nodes', 'bz'], rule: 'invalid-geometry' }),
    ]);

    const missing: ValidationIssue[] = [];
    const withoutControl: Record<string, unknown> = { ...ARC };
    delete withoutControl['control1'];
    readStoredShape(withoutControl, path, missing);
    expect(missing).toContainEqual(
      expect.objectContaining({ path: ['nodes', 'bz', 'control1'], rule: 'type' }),
    );

    const zero: ValidationIssue[] = [];
    readStoredShape({ ...ARC, end: { x: 0, y: 0 } }, path, zero);
    expect(zero).toContainEqual(expect.objectContaining({ rule: 'zero-length' }));
  });

  it('patchShape simétrico espelha o controle que não veio', () => {
    const issues: ValidationIssue[] = [];
    expect(patchShape(ARC, { control1: { x: 10, y: 60 } }, PATH, issues)).toMatchObject({
      control1: { x: 10, y: 60 },
      control2: { x: 90, y: 60 },
    });
    expect(patchShape(ARC, { control2: { x: 70, y: 40 } }, PATH, issues)).toMatchObject({
      control1: { x: 30, y: 40 },
      control2: { x: 70, y: 40 },
    });
    // Mover uma ponta mantém control1 e re-espelha control2 na corda nova
    expect(patchShape(ARC, { end: { x: 200, y: 0 } }, PATH, issues)).toMatchObject({
      control1: { x: 0, y: 100 },
      control2: { x: 200, y: 100 },
    });
    expect(issues).toEqual([]);
  });

  it('patchShape recusa controles incoerentes e início igual ao fim', () => {
    const broken: ValidationIssue[] = [];
    patchShape(ARC, { control1: { x: 10, y: 60 }, control2: { x: 10, y: 60 } }, PATH, broken);
    expect(broken).toEqual([
      expect.objectContaining({ path: ['patch'], rule: 'invalid-geometry' }),
    ]);

    const zero: ValidationIssue[] = [];
    patchShape(ARC, { end: { x: 0, y: 0 } }, PATH, zero);
    expect(zero).toEqual([expect.objectContaining({ rule: 'zero-length' })]);

    const unknown: ValidationIssue[] = [];
    patchShape(ARC, { rotation: 1 }, PATH, unknown);
    expect(unknown).toContainEqual(expect.objectContaining({ rule: 'unknown-field' }));
  });

  it('desligar a simetria libera os controles; religar re-espelha control2 a partir de control1', () => {
    const issues: ValidationIssue[] = [];
    const free = patchShape(ARC, { symmetric: false }, PATH, issues) as BezierNode;
    const bent = patchShape(free, { control2: { x: 60, y: -20 } }, PATH, issues) as BezierNode;
    expect(bent).toMatchObject({
      symmetric: false,
      control1: { x: 0, y: 100 },
      control2: { x: 60, y: -20 },
    });

    expect(patchShape(bent, { symmetric: true }, PATH, issues)).toMatchObject({
      symmetric: true,
      control1: { x: 0, y: 100 },
      control2: { x: 100, y: 100 },
    });
    expect(issues).toEqual([]);
  });

  it('patch só de estilo não reescreve os controles', () => {
    const tilted: BezierNode = {
      ...ARC,
      start: { x: 0.1, y: 0.7 },
      end: { x: 93.3, y: 41.9 },
      control1: { x: 13.7, y: 77.1 },
    };
    const exact = { ...tilted, control2: mirrorControl(tilted.start, tilted.end, tilted.control1) };
    const issues: ValidationIssue[] = [];
    const patched = patchShape(exact, { style: { strokeWidth: 3 } }, PATH, issues) as BezierNode;
    expect(issues).toEqual([]);
    expect(patched.control2).toBe(exact.control2);
  });

  it('hit-test acerta o traço e não a corda', () => {
    expect(pointInShape(ARC, { x: 50, y: 75 }, 0)).toBe(true);
    expect(pointInShape(ARC, { x: 50, y: 75.9 }, 0)).toBe(true);
    expect(pointInShape(ARC, { x: 50, y: 77 }, 0)).toBe(false);
    expect(pointInShape(ARC, { x: 50, y: 77 }, 2)).toBe(true);
    // Meio da corda e miolo do arco: nada pintado
    expect(pointInShape(ARC, { x: 50, y: 0 }, 0)).toBe(false);
    expect(pointInShape(ARC, { x: 50, y: 40 }, 0)).toBe(false);
    // Sem traço visível, nunca
    expect(
      pointInShape({ ...ARC, style: { ...ARC.style, stroke: null } }, { x: 50, y: 75 }, 5),
    ).toBe(false);
  });

  it.each([0.01, 1, 100])(
    'marquee toca pelo traço, não pela corda nem pelo miolo, na escala %d',
    (scale) => {
      const scaled: BezierNode = {
        ...ARC,
        start: { x: 0, y: 0 },
        control1: { x: 0, y: 100 * scale },
        control2: { x: 100 * scale, y: 100 * scale },
        end: { x: 100 * scale, y: 0 },
        style: { ...ARC.style, strokeWidth: 2 * scale },
      };
      const rect = (x: number, y: number, size: number) => ({
        x: x * scale,
        y: y * scale,
        width: size * scale,
        height: size * scale,
      });
      expect(shapeIntersectsRect(scaled, rect(45, 70, 10))).toBe(true);
      expect(shapeIntersectsRect(scaled, rect(45, 2, 10))).toBe(false);
      expect(shapeIntersectsRect(scaled, rect(40, 30, 20))).toBe(false);
      // Encostar no meio traço de fora conta; um pouco além, não
      expect(shapeIntersectsRect(scaled, rect(45, 75.9, 4))).toBe(true);
      expect(shapeIntersectsRect(scaled, rect(45, 76.5, 4))).toBe(false);
    },
  );

  it('shapeBounds é a caixa exata da curva mais meio traço, e shapeInsideRect a usa', () => {
    expect(shapeBounds(ARC)).toEqual({ x: -1, y: -1, width: 102, height: 77 });
    expect(shapeBounds(ARC, { stroke: false })).toEqual({ x: 0, y: 0, width: 100, height: 75 });
    expect(shapeInsideRect(ARC, { x: -1, y: -1, width: 102, height: 77 })).toBe(true);
    expect(shapeInsideRect(ARC, { x: 0, y: 0, width: 101, height: 76 })).toBe(false);
  });
});

describe('ShapeLabel: texto dentro das formas (US-SL.1)', () => {
  const BOX = { x: 0, y: 0, width: 100, height: 100, rotation: 0 };
  const LABELABLE: readonly Record<string, unknown>[] = [
    { type: 'rectangle' },
    { type: 'square' },
    { type: 'ellipse' },
    { type: 'circle' },
    { type: 'diamond' },
    { type: 'triangle' },
    { type: 'polygon', sides: 6 },
    { type: 'cross' },
    { type: 'chevron', direction: 'up' },
  ];
  const DEFAULTS = {
    text: 'Olá',
    fontSize: 16,
    fontFamily: 'sans-serif',
    fontWeight: 'normal',
    color: null,
    textAlign: 'center',
    verticalAlign: 'middle',
  };

  function read(input: Record<string, unknown>) {
    const issues: ValidationIssue[] = [];
    const factory = readShapeInput(input, undefined, issues);
    return { issues, node: factory?.('s1') };
  }

  it.each(LABELABLE)('$type aceita label e completa os padrões', (shape) => {
    const { issues, node } = read({ ...BOX, ...shape, label: { text: 'Olá' } });

    expect(issues).toEqual([]);
    expect(node).toMatchObject({ type: shape['type'], label: DEFAULTS });
  });

  it.each(LABELABLE)('$type sem label continua sem o campo', (shape) => {
    const { issues, node } = read({ ...BOX, ...shape });

    expect(issues).toEqual([]);
    expect(node).toBeDefined();
    expect('label' in node!).toBe(false);
  });

  it('um label parcial completa só o que falta e mantém o que foi dado', () => {
    const { issues, node } = read({
      ...BOX,
      type: 'rectangle',
      label: {
        text: 'Título',
        fontSize: 24,
        fontWeight: 600,
        textAlign: 'left',
        verticalAlign: 'top',
        color: '#ff0000',
      },
    });

    expect(issues).toEqual([]);
    expect(node).toMatchObject({
      label: {
        text: 'Título',
        fontSize: 24,
        fontFamily: 'sans-serif',
        fontWeight: 600,
        color: '#ff0000',
        textAlign: 'left',
        verticalAlign: 'top',
      },
    });
  });

  it('um label vazio é aceito (o texto pode ser vazio)', () => {
    const { issues, node } = read({ ...BOX, type: 'ellipse', label: {} });

    expect(issues).toEqual([]);
    expect(node).toMatchObject({ label: { ...DEFAULTS, text: '' } });
  });

  it.each([
    ['brace', { orientation: 'right' }],
    ['line', { start: { x: 0, y: 0 }, end: { x: 10, y: 10 } }],
    [
      'bezier',
      {
        start: { x: 0, y: 0 },
        end: { x: 10, y: 10 },
        control1: { x: 0, y: 10 },
        control2: { x: 10, y: 0 },
      },
    ],
    ['arrow', { start: { x: 0, y: 0 }, end: { x: 10, y: 10 } }],
    ['ink', { strokes: [] }],
    ['text', { text: 'x' }],
    ['sticky', { text: 'x' }],
  ])('%s recusa label com unknown-field', (type, extra) => {
    const { issues } = read({ ...BOX, type, ...extra, label: { text: 'Olá' } });

    expect(issues).toContainEqual(
      expect.objectContaining({ rule: 'unknown-field', path: ['label'] }),
    );
  });

  it.each([
    ['HTML no texto', { text: '<b>oi</b>' }, 'text', 'format'],
    ['fontSize zero', { fontSize: 0 }, 'fontSize', 'range'],
    ['fontSize negativo', { fontSize: -4 }, 'fontSize', 'range'],
    ['cor inválida', { color: 'vermelho' }, 'color', 'format'],
    ['textAlign fora da lista', { textAlign: 'justify' }, 'textAlign', 'format'],
    ['verticalAlign fora da lista', { verticalAlign: 'baseline' }, 'verticalAlign', 'format'],
    ['fontWeight fora da faixa', { fontWeight: 650 }, 'fontWeight', 'range'],
    ['fontFamily vazia', { fontFamily: '' }, 'fontFamily', 'type'],
    ['chave desconhecida', { rotation: 1 }, 'rotation', 'unknown-field'],
  ])('recusa %s', (_name, label, key, rule) => {
    const { issues } = read({ ...BOX, type: 'rectangle', label: { text: 'ok', ...label } });

    expect(issues).toContainEqual(expect.objectContaining({ rule, path: ['label', key] }));
  });

  it('recusa um label que não é objeto', () => {
    const { issues } = read({ ...BOX, type: 'rectangle', label: 'texto' });

    expect(issues).toContainEqual(expect.objectContaining({ rule: 'type', path: ['label'] }));
  });

  it('shape.create com label inválido não cria nada nem altera o documento', () => {
    const section = createCanvasSection();
    const before = section.getSnapshot();

    const result = section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'r1',
        type: 'rectangle',
        ...BOX,
        // Valor fora da lista: o tipo o recusa, e a execução também.
        label: { text: 'ok', verticalAlign: 'baseline' as 'top' },
      },
    });

    expect(result.ok).toBe(false);
    expect(section.getSnapshot().document).toBe(before.document);
  });

  it('shape.create de um retângulo com label guarda o nó com os padrões', () => {
    const section = createCanvasSection();

    section.dispatch({
      type: 'shape.create',
      shape: { id: 'r1', type: 'rectangle', ...BOX, label: { text: 'Olá' } },
    });

    expect(section.getSnapshot().document.nodes['r1']).toMatchObject({ label: DEFAULTS });
  });
});
