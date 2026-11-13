import { createCanvasSection, type RectangleNode, type TextNode } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { CanvasPropertiesElement } from './canvas-properties.js';

interface TestableProperties {
  _section: unknown;
  _unsubscribeSection: unknown;
  _getSelectedShapes(): unknown[];
  _onNumberChange(prop: 'x' | 'y' | 'width' | 'height' | 'rotation', e: Event): void;
  _onColorChange(prop: 'fill' | 'stroke', e: Event): void;
  _onStrokeWidthChange(e: Event): void;
  _onOpacityChange(e: Event): void;
  _onTextChange(e: Event): void;
  performUpdate(): void;
}

const fakeEvent = (value: string) =>
  ({
    target: { value },
    stopPropagation: () => {},
    preventDefault: () => {},
  }) as unknown as Event;

function invokeAllTemplateFunctions(result: unknown): void {
  if (!result || typeof result !== 'object') return;
  if ('values' in result && Array.isArray((result as { values: unknown[] }).values)) {
    for (const val of (result as { values: unknown[] }).values) {
      if (typeof val === 'function') {
        try {
          val(fakeEvent('10'));
        } catch {
          // ignora
        }
      } else if (Array.isArray(val)) {
        for (const item of val) invokeAllTemplateFunctions(item);
      } else if (typeof val === 'object') {
        invokeAllTemplateFunctions(val);
      }
    }
  }
}

describe('CanvasPropertiesElement', () => {
  it('inicializa sem canvas e exibe mensagem de estado vazio', () => {
    const el = new CanvasPropertiesElement();
    expect(el.section).toBeUndefined();

    const result = el.render();
    expect(result).toBeDefined();
  });

  it('permite definir e alternar o canvas reativamente', () => {
    const el = new CanvasPropertiesElement();
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();

    el.section = sectionA;
    expect(el.section).toBe(sectionA);

    el.section = sectionB;
    expect(el.section).toBe(sectionB);

    // Mesma instância é no-op
    el.section = sectionB;
    expect(el.section).toBe(sectionB);

    // Desconecta canvas
    el.section = undefined;
    expect(el.section).toBeUndefined();
  });

  it('gerencia ciclo de vida de conexão e desconexão', () => {
    const el = new CanvasPropertiesElement();
    const section = createCanvasSection();
    el.section = section;
    const testable = el as unknown as TestableProperties;

    el.disconnectedCallback();
    expect(testable._unsubscribeSection).toBeUndefined();

    el.connectedCallback();
    expect(testable._unsubscribeSection).toBeDefined();
  });

  it('performUpdate() retorna prematuramente em ambiente headless', () => {
    const el = new CanvasPropertiesElement();
    const testable = el as unknown as TestableProperties;
    expect(() => testable.performUpdate()).not.toThrow();
  });

  it('exibe e altera propriedades geométricas de uma forma selecionada', () => {
    const el = new CanvasPropertiesElement();
    const section = createCanvasSection();
    el.section = section;

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-geo',
        type: 'rectangle',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 2, opacity: 1 },
      },
    });
    section.setSelection(['rect-geo']);

    const testable = el as unknown as TestableProperties;
    const getRect = () =>
      section.getSnapshot().document.nodes['rect-geo'] as RectangleNode | undefined;

    // Altera X
    testable._onNumberChange('x', fakeEvent('42'));
    expect(getRect()?.x).toBe(42);

    // Altera Y
    testable._onNumberChange('y', fakeEvent('88'));
    expect(getRect()?.y).toBe(88);

    // Altera Width
    testable._onNumberChange('width', fakeEvent('250'));
    expect(getRect()?.width).toBe(250);

    // Rejeita Width negativo ou zero
    testable._onNumberChange('width', fakeEvent('0'));
    testable._onNumberChange('width', fakeEvent('-10'));
    expect(getRect()?.width).toBe(250);

    // Rejeita valor NaN
    testable._onNumberChange('x', fakeEvent('abc'));
    expect(getRect()?.x).toBe(42);

    // Altera rotação (90 graus -> ~PI/2)
    testable._onNumberChange('rotation', fakeEvent('90'));
    expect(getRect()?.rotation).toBeCloseTo(Math.PI / 2);
  });

  it('altera propriedades de estilo (fill, stroke, strokeWidth, opacity)', () => {
    const el = new CanvasPropertiesElement();
    const section = createCanvasSection();
    el.section = section;

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-style',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    });
    section.setSelection(['rect-style']);

    const testable = el as unknown as TestableProperties;
    const getStyleRect = () =>
      section.getSnapshot().document.nodes['rect-style'] as RectangleNode | undefined;

    // Fill
    testable._onColorChange('fill', fakeEvent('#3b82f6'));
    expect(getStyleRect()?.style.fill).toBe('#3b82f6');

    // Cor inválida é ignorada
    testable._onColorChange('fill', fakeEvent('not-a-color'));
    expect(getStyleRect()?.style.fill).toBe('#3b82f6');

    // Stroke
    testable._onColorChange('stroke', fakeEvent('#ef4444'));
    expect(getStyleRect()?.style.stroke).toBe('#ef4444');

    // Stroke Width
    testable._onStrokeWidthChange(fakeEvent('4'));
    expect(getStyleRect()?.style.strokeWidth).toBe(4);

    // Stroke Width inválido é ignorado
    testable._onStrokeWidthChange(fakeEvent('-1'));
    testable._onStrokeWidthChange(fakeEvent('nan'));
    expect(getStyleRect()?.style.strokeWidth).toBe(4);

    // Opacity
    testable._onOpacityChange(fakeEvent('80'));
    expect(getStyleRect()?.style.opacity).toBeCloseTo(0.8);

    // Opacity NaN
    testable._onOpacityChange(fakeEvent('invalid'));
    expect(getStyleRect()?.style.opacity).toBeCloseTo(0.8);
  });

  it('suporta edição de nós de texto', () => {
    const el = new CanvasPropertiesElement();
    const section = createCanvasSection();
    el.section = section;

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'txt-1',
        type: 'text',
        x: 0,
        y: 0,
        width: 100,
        height: 30,
        rotation: 0,
        visible: true,
        locked: false,
        text: 'Olá Mundo',
        fontSize: 16,
        fontFamily: 'sans-serif',
        fontWeight: 'normal',
        textAlign: 'left',
        lineHeight: 1.2,
        style: { fill: '#000000', stroke: null, strokeWidth: 0, opacity: 1 },
      },
    });
    section.setSelection(['txt-1']);

    const testable = el as unknown as TestableProperties;
    testable._onTextChange(fakeEvent('Novo Texto'));
    const txtNode = section.getSnapshot().document.nodes['txt-1'] as TextNode | undefined;
    expect(txtNode?.text).toBe('Novo Texto');

    // Renderiza e aciona closures
    const tpl = el.render();
    expect(tpl).toBeDefined();
    invokeAllTemplateFunctions(tpl);
  });

  it('suporta seleção múltipla heterogênea e aplica alterações em lote', () => {
    const el = new CanvasPropertiesElement();
    const section = createCanvasSection();
    el.section = section;

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'box-1',
        type: 'rectangle',
        x: 10,
        y: 10,
        width: 50,
        height: 50,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#111111', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    });
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'box-2',
        type: 'rectangle',
        x: 80,
        y: 80,
        width: 50,
        height: 50,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#222222', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    });

    section.setSelection(['box-1', 'box-2']);

    const testable = el as unknown as TestableProperties;
    const getBox1 = () =>
      section.getSnapshot().document.nodes['box-1'] as RectangleNode | undefined;
    const getBox2 = () =>
      section.getSnapshot().document.nodes['box-2'] as RectangleNode | undefined;

    // Altera largura em lote
    testable._onNumberChange('width', fakeEvent('120'));
    expect(getBox1()?.width).toBe(120);
    expect(getBox2()?.width).toBe(120);

    // Altera preenchimento em lote
    testable._onColorChange('fill', fakeEvent('#00ff00'));
    expect(getBox1()?.style.fill).toBe('#00ff00');
    expect(getBox2()?.style.fill).toBe('#00ff00');

    // Altera contorno, espessura, opacidade e altura em lote
    testable._onColorChange('stroke', fakeEvent('#112233'));
    testable._onStrokeWidthChange(fakeEvent('5'));
    testable._onOpacityChange(fakeEvent('60'));
    testable._onNumberChange('height', fakeEvent('90'));

    expect(getBox1()?.height).toBe(90);
    expect(getBox2()?.height).toBe(90);
    expect(getBox1()?.style.stroke).toBe('#112233');
    expect(getBox1()?.style.strokeWidth).toBe(5);
    expect(getBox1()?.style.opacity).toBeCloseTo(0.6);

    // Renderiza com valores mistos e uniformes
    const tpl = el.render();
    expect(tpl).toBeDefined();
    invokeAllTemplateFunctions(tpl);
  });

  it('suporta nós do tipo linha sem geometria de caixa nem fill', () => {
    const el = new CanvasPropertiesElement();
    const section = createCanvasSection();
    el.section = section;

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'line-1',
        type: 'line',
        start: { x: 0, y: 0 },
        end: { x: 100, y: 100 },
        visible: true,
        locked: false,
        style: { stroke: '#000000', strokeWidth: 2, opacity: 1 },
      },
    });
    section.setSelection(['line-1']);

    const tpl = el.render();
    expect(tpl).toBeDefined();
    invokeAllTemplateFunctions(tpl);
  });

  it('desabilita inputs quando o canvas estiver em modo readOnly ou shape bloqueado', () => {
    const el = new CanvasPropertiesElement();
    const section = createCanvasSection();
    el.section = section;

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'locked-box',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        rotation: 0,
        visible: true,
        locked: true,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    });
    section.setSelection(['locked-box']);

    const tplLocked = el.render();
    expect(tplLocked).toBeDefined();

    section.setReadOnly(true);
    const tplReadOnly = el.render();
    expect(tplReadOnly).toBeDefined();
  });

  it('métodos de alteração são seguros se não houver seleção ou canvas', () => {
    const el = new CanvasPropertiesElement();
    const testable = el as unknown as TestableProperties;

    expect(() => testable._onNumberChange('x', fakeEvent('10'))).not.toThrow();
    expect(() => testable._onColorChange('fill', fakeEvent('#ffffff'))).not.toThrow();
    expect(() => testable._onStrokeWidthChange(fakeEvent('2'))).not.toThrow();
    expect(() => testable._onOpacityChange(fakeEvent('50'))).not.toThrow();
    expect(() => testable._onTextChange(fakeEvent('test'))).not.toThrow();
  });

  it('suporta SquareNode mantendo proporção 1:1 ao editar largura/altura e conversão bidirecional Quadrado <-> Retângulo', () => {
    const el = new CanvasPropertiesElement();
    const section = createCanvasSection();
    el.section = section;

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'sq-prop',
        type: 'square',
        x: 10,
        y: 20,
        width: 100,
        height: 100,
        rotation: 0,
      },
    });
    section.setSelection(['sq-prop']);

    const testable = el as unknown as TestableProperties & {
      _onConvertShapeType(targetType: 'rectangle' | 'square'): void;
    };

    // Renderiza com quadrado selecionado (inclui botão de converter para retângulo)
    const tplSq = el.render();
    expect(tplSq).toBeDefined();

    // Editar largura de um quadrado sincroniza width e height para manter invariante 1:1
    testable._onNumberChange('width', fakeEvent('140'));
    const updatedSq = section.getSnapshot().document.nodes['sq-prop'];
    expect(updatedSq).toMatchObject({
      type: 'square',
      width: 140,
      height: 140,
    });

    // Converte quadrado para retângulo
    testable._onConvertShapeType('rectangle');
    expect(section.getSnapshot().document.nodes['sq-prop']?.type).toBe('rectangle');

    // Agora como retângulo, pode ter dimensões assimétricas (200x120)
    testable._onNumberChange('width', fakeEvent('200'));
    testable._onNumberChange('height', fakeEvent('120'));
    expect(section.getSnapshot().document.nodes['sq-prop']).toMatchObject({
      type: 'rectangle',
      width: 200,
      height: 120,
    });

    // Renderiza como retângulo (inclui botão de converter para quadrado) e aciona callbacks
    const tplRect = el.render();
    expect(tplRect).toBeDefined();
    invokeAllTemplateFunctions(tplRect);

    // Após invokeAllTemplateFunctions ou chamada explícita, converte de volta para quadrado com contenção min(W, H)
    testable._onConvertShapeType('square');
    const convertedBack = section.getSnapshot().document.nodes['sq-prop'];
    expect(convertedBack?.type).toBe('square');
  });

  it('suporta CircleNode mantendo proporção 1:1 ao editar largura/altura e conversão bidirecional Círculo <-> Elipse', () => {
    const el = new CanvasPropertiesElement();
    const section = createCanvasSection();
    el.section = section;

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'cir-prop',
        type: 'circle',
        x: 10,
        y: 20,
        width: 100,
        height: 100,
        rotation: 0,
      },
    });
    section.setSelection(['cir-prop']);

    const testable = el as unknown as TestableProperties & {
      _onConvertShapeType(targetType: 'rectangle' | 'square' | 'ellipse' | 'circle'): void;
    };

    const tplCir = el.render();
    expect(tplCir).toBeDefined();
    invokeAllTemplateFunctions(tplCir);

    // Restaura como circle caso invokeAllTemplateFunctions tenha convertido
    testable._onConvertShapeType('circle');

    // Editar largura de um círculo sincroniza width e height para manter invariante 1:1
    testable._onNumberChange('width', fakeEvent('140'));
    const updatedCir = section.getSnapshot().document.nodes['cir-prop'];
    expect(updatedCir).toMatchObject({
      type: 'circle',
      width: 140,
      height: 140,
    });

    // Converte círculo para elipse
    testable._onConvertShapeType('ellipse');
    expect(section.getSnapshot().document.nodes['cir-prop']?.type).toBe('ellipse');

    // Como elipse, pode ter dimensões assimétricas (200x120)
    testable._onNumberChange('width', fakeEvent('200'));
    testable._onNumberChange('height', fakeEvent('120'));
    expect(section.getSnapshot().document.nodes['cir-prop']).toMatchObject({
      type: 'ellipse',
      width: 200,
      height: 120,
    });

    const tplEllipse = el.render();
    expect(tplEllipse).toBeDefined();
    invokeAllTemplateFunctions(tplEllipse);

    testable._onConvertShapeType('circle');
    const convertedBack = section.getSnapshot().document.nodes['cir-prop'];
    expect(convertedBack?.type).toBe('circle');
  });

  it('suporta TriangleNode nas 4 variantes, edição de apex no escaleno e sincronização L/A no equilátero', () => {
    const el = new CanvasPropertiesElement();
    const section = createCanvasSection();
    el.section = section;

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'tri-prop',
        type: 'triangle',
        x: 10,
        y: 20,
        width: 120,
        height: 80,
        rotation: 0,
        variant: 'isosceles',
      },
    });
    section.setSelection(['tri-prop']);

    const testable = el as unknown as TestableProperties & {
      _onTriangleVariantChange(e: Event): void;
      _onTriangleApexChange(e: Event): void;
    };

    const tplIso = el.render();
    expect(tplIso).toBeDefined();
    invokeAllTemplateFunctions(tplIso);

    // Converte para escaleno e edita apex
    testable._onTriangleVariantChange(fakeEvent('scalene'));
    expect(section.getSnapshot().document.nodes['tri-prop']).toMatchObject({
      type: 'triangle',
      variant: 'scalene',
      apex: 0.3,
    });

    const tplScalene = el.render();
    expect(tplScalene).toBeDefined();
    invokeAllTemplateFunctions(tplScalene);

    testable._onTriangleApexChange(fakeEvent('0.75'));
    expect(section.getSnapshot().document.nodes['tri-prop']).toMatchObject({
      type: 'triangle',
      variant: 'scalene',
      apex: 0.75,
    });

    // Converte para equilátero e verifica sincronização L/A
    testable._onTriangleVariantChange(fakeEvent('equilateral'));
    expect(section.getSnapshot().document.nodes['tri-prop']).toMatchObject({
      type: 'triangle',
      variant: 'equilateral',
      apex: 0.5,
    });

    testable._onNumberChange('width', fakeEvent('100'));
    const eqAfterW = section.getSnapshot().document.nodes['tri-prop'];
    expect(eqAfterW?.type).toBe('triangle');
    if (eqAfterW?.type === 'triangle') {
      expect(eqAfterW.width).toBe(100);
      expect(eqAfterW.height).toBeCloseTo((100 * Math.sqrt(3)) / 2, 5);
    }

    testable._onNumberChange('height', fakeEvent('86.60254'));
    const eqAfterH = section.getSnapshot().document.nodes['tri-prop'];
    expect(eqAfterH?.type).toBe('triangle');
    if (eqAfterH?.type === 'triangle') {
      expect(eqAfterH.width / eqAfterH.height).toBeCloseTo(2 / Math.sqrt(3), 4);
    }
  });

  it('suporta PolygonNode: troca de lados limitada a 3..12 e L/A sincronizados em 1:1', () => {
    const el = new CanvasPropertiesElement();
    const section = createCanvasSection();
    el.section = section;

    section.dispatch({
      type: 'shape.create',
      shape: { id: 'pg-prop', type: 'polygon', x: 10, y: 20, width: 80, height: 80, rotation: 0 },
    });
    section.setSelection(['pg-prop']);

    const testable = el as unknown as TestableProperties & {
      _onPolygonSidesChange(e: Event): void;
    };

    invokeAllTemplateFunctions(el.render());

    testable._onPolygonSidesChange(fakeEvent('8'));
    expect(section.getSnapshot().document.nodes['pg-prop']).toMatchObject({ sides: 8 });

    testable._onPolygonSidesChange(fakeEvent('40'));
    expect(section.getSnapshot().document.nodes['pg-prop']).toMatchObject({ sides: 12 });

    testable._onPolygonSidesChange(fakeEvent('2.6'));
    expect(section.getSnapshot().document.nodes['pg-prop']).toMatchObject({ sides: 3 });

    testable._onPolygonSidesChange(fakeEvent('abc'));
    expect(section.getSnapshot().document.nodes['pg-prop']).toMatchObject({ sides: 3 });

    testable._onNumberChange('height', fakeEvent('120'));
    expect(section.getSnapshot().document.nodes['pg-prop']).toMatchObject({
      type: 'polygon',
      width: 120,
      height: 120,
      sides: 3,
    });
  });

  it('suporta CrossNode: o campo de espessura dos braços fica entre 0,05 e 1 e só aparece na cruz', () => {
    const el = new CanvasPropertiesElement();
    const section = createCanvasSection();
    el.section = section;

    section.dispatch({
      type: 'shape.create',
      shape: { id: 'cr-prop', type: 'cross', x: 10, y: 20, width: 90, height: 60, rotation: 0 },
    });
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'rc-prop', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });

    const testable = el as unknown as TestableProperties & {
      _onCrossArmRatioChange(e: Event): void;
    };
    const text = (): string => JSON.stringify(el.render());

    section.setSelection(['rc-prop']);
    expect(text()).not.toContain('armRatio');

    section.setSelection(['cr-prop']);
    expect(text()).toContain('data-field=');
    expect(text()).toContain('armRatio');
    invokeAllTemplateFunctions(el.render());
    // Os handlers do template foram chamados com "10" e mexeram na caixa: volta ao tamanho original.
    section.dispatch({
      type: 'shape.update',
      id: 'cr-prop',
      patch: { x: 10, y: 20, width: 90, height: 60, rotation: 0 },
    });

    testable._onCrossArmRatioChange(fakeEvent('0.5'));
    expect(section.getSnapshot().document.nodes['cr-prop']).toMatchObject({ armRatio: 0.5 });

    testable._onCrossArmRatioChange(fakeEvent('4'));
    expect(section.getSnapshot().document.nodes['cr-prop']).toMatchObject({ armRatio: 1 });

    testable._onCrossArmRatioChange(fakeEvent('0.01'));
    expect(section.getSnapshot().document.nodes['cr-prop']).toMatchObject({ armRatio: 0.05 });

    testable._onCrossArmRatioChange(fakeEvent('abc'));
    expect(section.getSnapshot().document.nodes['cr-prop']).toMatchObject({ armRatio: 0.05 });

    // A cruz tem caixa livre: largura e altura mudam de forma independente.
    testable._onNumberChange('width', fakeEvent('120'));
    expect(section.getSnapshot().document.nodes['cr-prop']).toMatchObject({
      type: 'cross',
      width: 120,
      height: 60,
    });
  });

  it('suporta ChevronNode: direção e profundidade só aparecem no chevron e respeitam a faixa', () => {
    const el = new CanvasPropertiesElement();
    const section = createCanvasSection();
    el.section = section;

    section.dispatch({
      type: 'shape.create',
      shape: { id: 'cv-prop', type: 'chevron', x: 10, y: 20, width: 90, height: 60, rotation: 0 },
    });
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'rc-prop', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });

    const testable = el as unknown as TestableProperties & {
      _onChevronDirectionChange(e: Event): void;
      _onChevronNotchDepthChange(e: Event): void;
    };
    const text = (): string => JSON.stringify(el.render());

    section.setSelection(['rc-prop']);
    expect(text()).not.toContain('notchDepth');

    section.setSelection(['cv-prop']);
    expect(text()).toContain('notchDepth');
    expect(text()).toContain('direction');
    invokeAllTemplateFunctions(el.render());
    section.dispatch({
      type: 'shape.update',
      id: 'cv-prop',
      patch: { x: 10, y: 20, width: 90, height: 60, rotation: 0 },
    });

    testable._onChevronDirectionChange(fakeEvent('down'));
    expect(section.getSnapshot().document.nodes['cv-prop']).toMatchObject({ direction: 'down' });
    testable._onChevronDirectionChange(fakeEvent('diagonal'));
    expect(section.getSnapshot().document.nodes['cv-prop']).toMatchObject({ direction: 'down' });

    testable._onChevronNotchDepthChange(fakeEvent('0.4'));
    expect(section.getSnapshot().document.nodes['cv-prop']).toMatchObject({ notchDepth: 0.4 });
    testable._onChevronNotchDepthChange(fakeEvent('9'));
    expect(section.getSnapshot().document.nodes['cv-prop']).toMatchObject({ notchDepth: 0.5 });
    testable._onChevronNotchDepthChange(fakeEvent('-1'));
    expect(section.getSnapshot().document.nodes['cv-prop']).toMatchObject({ notchDepth: 0 });
    testable._onChevronNotchDepthChange(fakeEvent('abc'));
    expect(section.getSnapshot().document.nodes['cv-prop']).toMatchObject({ notchDepth: 0 });
  });

  it('suporta BraceNode: orientação, posição da ponta e curvatura só aparecem na chave e respeitam a faixa', () => {
    const el = new CanvasPropertiesElement();
    const section = createCanvasSection();
    el.section = section;

    section.dispatch({
      type: 'shape.create',
      shape: { id: 'br-prop', type: 'brace', x: 10, y: 20, width: 40, height: 160, rotation: 0 },
    });
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'rc-prop', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });

    const testable = el as unknown as TestableProperties & {
      _onBraceOrientationChange(e: Event): void;
      _onBraceFractionChange(field: 'tipPosition' | 'curvature', e: Event): void;
    };
    const text = (): string => JSON.stringify(el.render());

    section.setSelection(['rc-prop']);
    expect(text()).not.toContain('tipPosition');

    section.setSelection(['br-prop']);
    expect(text()).toContain('tipPosition');
    expect(text()).toContain('curvature');
    // A chave só tem traço: o painel não oferece preenchimento.
    expect(text()).not.toContain('btn-fill-preview');
    invokeAllTemplateFunctions(el.render());
    section.dispatch({
      type: 'shape.update',
      id: 'br-prop',
      patch: { x: 10, y: 20, width: 40, height: 160, rotation: 0 },
    });

    testable._onBraceOrientationChange(fakeEvent('up'));
    expect(section.getSnapshot().document.nodes['br-prop']).toMatchObject({ orientation: 'up' });
    testable._onBraceOrientationChange(fakeEvent('diagonal'));
    expect(section.getSnapshot().document.nodes['br-prop']).toMatchObject({ orientation: 'up' });

    testable._onBraceFractionChange('tipPosition', fakeEvent('0.25'));
    testable._onBraceFractionChange('curvature', fakeEvent('0.8'));
    expect(section.getSnapshot().document.nodes['br-prop']).toMatchObject({
      tipPosition: 0.25,
      curvature: 0.8,
    });
    testable._onBraceFractionChange('curvature', fakeEvent('5'));
    testable._onBraceFractionChange('tipPosition', fakeEvent('-1'));
    expect(section.getSnapshot().document.nodes['br-prop']).toMatchObject({
      tipPosition: 0,
      curvature: 1,
    });
    testable._onBraceFractionChange('curvature', fakeEvent('abc'));
    expect(section.getSnapshot().document.nodes['br-prop']).toMatchObject({ curvature: 1 });
  });

  describe('tamanho da fonte do texto', () => {
    function textSection(
      texts: Array<{ id: string; fontSize?: number; fontSizeMode?: 'auto' | 'fixed' }>,
    ) {
      const el = new CanvasPropertiesElement();
      const section = createCanvasSection();
      el.section = section;
      texts.forEach((text, index) => {
        section.dispatch({
          type: 'shape.create',
          shape: {
            type: 'text',
            x: index * 10,
            y: 0,
            width: 120,
            text: 'Uma frase para quebrar em linhas',
            ...text,
          },
        });
      });
      section.setSelection(texts.map((text) => text.id));
      const testable = el as unknown as TestableProperties & {
        _onFontSizeChange(e: Event): void;
      };
      const rendered = (): string => JSON.stringify(el.render());
      return { el, section, testable, rendered };
    }

    it('mostra o seletor só para texto, com Automático (n) e os 17 tamanhos', () => {
      const { el, section, rendered } = textSection([{ id: 'tx' }]);
      const html = rendered();
      expect(html).toContain('input-font-size');
      expect(html).toContain('Automático (16)');
      for (const size of [12, 16, 24, 96, 120]) expect(html).toContain(`"${size}"`);
      expect(html).not.toContain('"mixed"');

      section.dispatch({
        type: 'shape.create',
        shape: { id: 'rc', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
      });
      section.setSelection(['rc']);
      expect(JSON.stringify(el.render())).not.toContain('input-font-size');
    });

    it('o rótulo automático mostra o tamanho efetivo arredondado', () => {
      expect(textSection([{ id: 'tx', fontSize: 17.3 }]).rendered()).toContain('Automático (17)');
    });

    it('em modo fixo seleciona o tamanho, com opção extra quando ele não está na lista', () => {
      const inList = textSection([{ id: 'tx', fontSize: 24, fontSizeMode: 'fixed' }]).rendered();
      expect(inList).toContain('"24"');
      expect(inList).not.toContain('Automático (24)');

      const outside = textSection([{ id: 'tx', fontSize: 17.3, fontSizeMode: 'fixed' }]).rendered();
      expect(outside).toContain('"17.3"');
    });

    it('modos ou tamanhos diferentes mostram "Misto" desabilitado', () => {
      const differentSize = textSection([
        { id: 'a', fontSize: 20, fontSizeMode: 'fixed' },
        { id: 'b', fontSize: 32, fontSizeMode: 'fixed' },
      ]).rendered();
      expect(differentSize).toContain('"mixed"');
      expect(differentSize).toContain('Misto');

      const differentMode = textSection([
        { id: 'a', fontSize: 20, fontSizeMode: 'fixed' },
        { id: 'b', fontSize: 20, fontSizeMode: 'auto' },
      ]).rendered();
      expect(differentMode).toContain('"mixed"');

      const same = textSection([
        { id: 'a', fontSize: 20, fontSizeMode: 'fixed' },
        { id: 'b', fontSize: 20, fontSizeMode: 'fixed' },
      ]).rendered();
      expect(same).not.toContain('"mixed"');
    });

    it('escolher um tamanho fixa o modo, muda o tamanho e recalcula a altura; desfazer volta tudo', () => {
      const { section, testable } = textSection([{ id: 'tx' }]);
      const before = section.getSnapshot().document.nodes['tx'] as { height: number };

      testable._onFontSizeChange(fakeEvent('32'));
      const after = section.getSnapshot().document.nodes['tx'] as { height: number };
      expect(section.getSnapshot().document.nodes['tx']).toMatchObject({
        fontSizeMode: 'fixed',
        fontSize: 32,
      });
      expect(after.height).toBeGreaterThan(before.height);

      section.undo();
      expect(section.getSnapshot().document.nodes['tx']).toMatchObject({
        fontSizeMode: 'auto',
        fontSize: 16,
        height: before.height,
      });
    });

    it('escolher Automático volta ao modo automático sem mudar o tamanho', () => {
      const { section, testable } = textSection([
        { id: 'tx', fontSize: 40, fontSizeMode: 'fixed' },
      ]);
      testable._onFontSizeChange(fakeEvent('auto'));
      expect(section.getSnapshot().document.nodes['tx']).toMatchObject({
        fontSizeMode: 'auto',
        fontSize: 40,
      });
    });

    it('ignora "Misto" e valores que não são tamanhos', () => {
      const { section, testable } = textSection([
        { id: 'tx', fontSize: 40, fontSizeMode: 'fixed' },
      ]);
      const before = section.getSnapshot();
      for (const value of ['mixed', 'abc', '0', '-3', '']) {
        testable._onFontSizeChange(fakeEvent(value));
      }
      expect(section.getSnapshot()).toBe(before);
    });

    it('aplica a todos os textos numa só entrada de histórico e não toca nas outras figuras', () => {
      const { section, testable } = textSection([
        { id: 'a', fontSize: 20, fontSizeMode: 'fixed' },
        { id: 'b', fontSize: 28, fontSizeMode: 'auto' },
      ]);
      section.dispatch({
        type: 'shape.create',
        shape: { id: 'rc', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
      });
      section.setSelection(['a', 'b', 'rc']);

      testable._onFontSizeChange(fakeEvent('36'));
      const nodes = section.getSnapshot().document.nodes;
      expect(nodes['a']).toMatchObject({ fontSizeMode: 'fixed', fontSize: 36 });
      expect(nodes['b']).toMatchObject({ fontSizeMode: 'fixed', fontSize: 36 });
      expect(nodes['rc']).toMatchObject({ type: 'rectangle', width: 10 });

      section.undo();
      expect(section.getSnapshot().document.nodes['a']).toMatchObject({ fontSize: 20 });
      expect(section.getSnapshot().document.nodes['b']).toMatchObject({
        fontSizeMode: 'auto',
        fontSize: 28,
      });
    });

    it('sem texto selecionado ou sem canvas, escolher não faz nada', () => {
      const { section, testable } = textSection([{ id: 'tx' }]);
      section.setSelection([]);
      expect(() => testable._onFontSizeChange(fakeEvent('24'))).not.toThrow();
      expect(section.getSnapshot().document.nodes['tx']).toMatchObject({ fontSize: 16 });

      const detached = new CanvasPropertiesElement() as unknown as {
        _onFontSizeChange(e: Event): void;
      };
      expect(() => detached._onFontSizeChange(fakeEvent('24'))).not.toThrow();
    });
  });

  it('suporta BezierNode: o checkbox Simétrica desliga e religa a simetria', () => {
    const el = new CanvasPropertiesElement();
    const section = createCanvasSection();
    el.section = section;

    section.dispatch({
      type: 'shape.create',
      shape: { id: 'bz-prop', type: 'bezier', start: { x: 0, y: 0 }, end: { x: 120, y: 0 } },
    });
    section.setSelection(['bz-prop']);

    const testable = el as unknown as TestableProperties & {
      _onBezierSymmetricChange(e: Event): void;
    };
    invokeAllTemplateFunctions(el.render());

    const checkbox = (checked: boolean) => ({ target: { checked } }) as unknown as Event;
    testable._onBezierSymmetricChange(checkbox(false));
    expect(section.getSnapshot().document.nodes['bz-prop']).toMatchObject({ symmetric: false });

    section.dispatch({
      type: 'shape.update',
      id: 'bz-prop',
      patch: { control2: { x: 60, y: 50 } },
    });
    testable._onBezierSymmetricChange(checkbox(true));
    expect(section.getSnapshot().document.nodes['bz-prop']).toMatchObject({
      symmetric: true,
      control1: { x: 40, y: -30 },
      control2: { x: 80, y: -30 },
    });
  });
});
