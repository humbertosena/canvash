import { describe, expect, it, vi } from 'vitest';
import { createCanvasSection, type CanvasSectionApi } from './canvas-section.js';
import type { CanvasCommand } from './commands.js';

/** Gerador determinístico: `id-1`, `id-2`, ... O canvas gasta os dois primeiros ao nascer. */
function counter(): () => string {
  let count = 0;
  return () => `id-${++count}`;
}

const DOCUMENT_ID = 'id-1';
const LAYER_ID = 'id-2';
const FIRST_SHAPE_ID = 'id-3';

const RECTANGLE = {
  type: 'rectangle',
  x: 100,
  y: 80,
  width: 240,
  height: 120,
  rotation: 0,
} as const;
const LINE = { type: 'line', start: { x: 0, y: 0 }, end: { x: 30, y: 40 } } as const;

const DEFAULT_STYLE = { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 };

function newSection(): CanvasSectionApi {
  return createCanvasSection({ generateId: counter() });
}

/** Despacha um comando que o tipo recusaria, como chega de um consumidor JavaScript. */
function dispatchUntyped(
  section: CanvasSectionApi,
  command: unknown,
): ReturnType<CanvasSectionApi['dispatch']> {
  return section.dispatch(command as CanvasCommand);
}

describe('shape.create', () => {
  it('cria um retângulo com ID, camada e estilo padrão materializados', () => {
    const section = newSection();

    const result = section.dispatch({ type: 'shape.create', shape: RECTANGLE });

    expect(result).toEqual({
      ok: true,
      value: {
        revision: 1,
        changed: true,
        affectedIds: [FIRST_SHAPE_ID, LAYER_ID],
        createdIds: [FIRST_SHAPE_ID],
      },
    });
    const { document, revision } = section.getSnapshot();
    expect(revision).toBe(1);
    expect(document.nodes).toEqual({
      [FIRST_SHAPE_ID]: {
        id: FIRST_SHAPE_ID,
        type: 'rectangle',
        x: 100,
        y: 80,
        width: 240,
        height: 120,
        rotation: 0,
        visible: true,
        locked: false,
        style: DEFAULT_STYLE,
      },
    });
    expect(document.layers).toEqual([
      { id: LAYER_ID, name: 'Layer 1', visible: true, locked: false, childIds: [FIRST_SHAPE_ID] },
    ]);
    expect(document.id).toBe(DOCUMENT_ID);
  });

  it('cria uma elipse com a mesma geometria de caixa', () => {
    const section = newSection();

    const result = section.dispatch({
      type: 'shape.create',
      shape: { type: 'ellipse', x: -10, y: 5.5, width: 20, height: 8, rotation: 0.5 },
    });

    expect(result.ok).toBe(true);
    expect(section.getSnapshot().document.nodes[FIRST_SHAPE_ID]).toEqual({
      id: FIRST_SHAPE_ID,
      type: 'ellipse',
      x: -10,
      y: 5.5,
      width: 20,
      height: 8,
      rotation: 0.5,
      visible: true,
      locked: false,
      style: DEFAULT_STYLE,
    });
  });

  it('cria um quadrado quando width === height e rejeita se forem desiguais', () => {
    const section = newSection();

    const resultOk = section.dispatch({
      type: 'shape.create',
      shape: { type: 'square', x: 20, y: 30, width: 50, height: 50, rotation: 0 },
    });

    expect(resultOk.ok).toBe(true);
    expect(section.getSnapshot().document.nodes[FIRST_SHAPE_ID]).toEqual({
      id: FIRST_SHAPE_ID,
      type: 'square',
      x: 20,
      y: 30,
      width: 50,
      height: 50,
      rotation: 0,
      visible: true,
      locked: false,
      style: DEFAULT_STYLE,
    });

    const resultBad = section.dispatch({
      type: 'shape.create',
      shape: { type: 'square', x: 20, y: 30, width: 50, height: 60, rotation: 0 },
    });

    expect(resultBad.ok).toBe(false);
  });

  it('cria uma linha pelos dois extremos, com estilo sem preenchimento', () => {
    const section = newSection();

    const result = section.dispatch({ type: 'shape.create', shape: LINE });

    expect(result.ok).toBe(true);
    expect(section.getSnapshot().document.nodes[FIRST_SHAPE_ID]).toEqual({
      id: FIRST_SHAPE_ID,
      type: 'line',
      start: { x: 0, y: 0 },
      end: { x: 30, y: 40 },
      visible: true,
      locked: false,
      style: { stroke: '#000000', strokeWidth: 1, opacity: 1 },
    });
  });

  it('usa o ID, a camada, o estilo e os sinalizadores dados no comando', () => {
    const section = newSection();

    const result = section.dispatch({
      type: 'shape.create',
      layerId: LAYER_ID,
      shape: {
        ...RECTANGLE,
        id: 'meu-shape',
        visible: false,
        locked: true,
        style: { fill: null, opacity: 0.5 },
      },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        revision: 1,
        changed: true,
        affectedIds: ['meu-shape', LAYER_ID],
        createdIds: ['meu-shape'],
      },
    });
    const { document } = section.getSnapshot();
    expect(document.nodes['meu-shape']).toMatchObject({
      id: 'meu-shape',
      visible: false,
      locked: true,
      style: { fill: null, stroke: '#000000', strokeWidth: 1, opacity: 0.5 },
    });
    expect(document.layers[0]?.childIds).toEqual(['meu-shape']);
  });

  it('põe cada shape novo à frente dos anteriores', () => {
    const section = newSection();

    section.dispatch({ type: 'shape.create', shape: { ...RECTANGLE, id: 'fundo' } });
    section.dispatch({ type: 'shape.create', shape: { ...LINE, id: 'meio' } });
    const last = section.dispatch({ type: 'shape.create', shape: { ...RECTANGLE, id: 'frente' } });

    expect(last).toMatchObject({ ok: true, value: { revision: 3 } });
    expect(section.getSnapshot().document.layers[0]?.childIds).toEqual(['fundo', 'meio', 'frente']);
  });

  it('guarda as cores em minúsculas, com ou sem alfa', () => {
    const section = newSection();

    section.dispatch({
      type: 'shape.create',
      shape: { ...RECTANGLE, style: { fill: '#FFAA00', stroke: '#11223344' } },
    });

    expect(section.getSnapshot().document.nodes[FIRST_SHAPE_ID]?.style).toMatchObject({
      fill: '#ffaa00',
      stroke: '#11223344',
    });
  });

  it.each([
    ['π vira -π', Math.PI, -Math.PI],
    ['-π continua -π', -Math.PI, -Math.PI],
    ['um valor dentro da faixa não muda', 0.3, 0.3],
    ['três quartos de volta viram um quarto negativo', 1.5 * Math.PI, -0.5 * Math.PI],
    ['uma volta e meia negativa vira -π', -3 * Math.PI, -Math.PI],
  ])('normaliza a rotação em [-π, π): %s', (_label, given, expected) => {
    const section = newSection();

    section.dispatch({ type: 'shape.create', shape: { ...RECTANGLE, rotation: given } });

    const node = section.getSnapshot().document.nodes[FIRST_SHAPE_ID];
    expect(node).toMatchObject({ rotation: expect.closeTo(expected, 12) });
  });

  it('guarda zero no lugar de zero negativo', () => {
    const section = newSection();

    section.dispatch({ type: 'shape.create', shape: { ...RECTANGLE, x: -0, rotation: -0 } });

    const node = section.getSnapshot().document.nodes[FIRST_SHAPE_ID];
    if (node?.type !== 'rectangle') throw new Error('o shape criado é um retângulo');
    expect(Object.is(node.x, 0)).toBe(true);
    expect(Object.is(node.rotation, 0)).toBe(true);
  });

  it('guarda uma cópia do metadata, sem ligação com o objeto do chamador', () => {
    const section = newSection();
    const tags = ['a', 'b'];
    const metadata = { 'app:tags': tags, 'app:info': { count: 2, done: false, note: null } };

    section.dispatch({ type: 'shape.create', shape: { ...RECTANGLE, metadata } });
    tags.push('c');

    expect(section.getSnapshot().document.nodes[FIRST_SHAPE_ID]?.metadata).toEqual({
      'app:tags': ['a', 'b'],
      'app:info': { count: 2, done: false, note: null },
    });
  });

  it('cria linha horizontal e linha vertical: só extremos iguais nos dois eixos são recusados', () => {
    const section = newSection();

    const result = section.transact([
      {
        type: 'shape.create',
        shape: { type: 'line', id: 'h', start: { x: 0, y: 5 }, end: { x: 9, y: 5 } },
      },
      {
        type: 'shape.create',
        shape: { type: 'line', id: 'v', start: { x: 5, y: 0 }, end: { x: 5, y: 9 } },
      },
      { type: 'shape.update', id: 'h', patch: { end: { x: -3, y: 5 } } },
    ]);

    expect(result).toMatchObject({ ok: true, value: { createdIds: ['h', 'v'] } });
  });

  it('trata undefined explícito em campo opcional como campo ausente', () => {
    const section = newSection();

    const created = section.dispatch({
      type: 'shape.create',
      layerId: undefined,
      shape: {
        ...RECTANGLE,
        id: undefined,
        visible: undefined,
        locked: undefined,
        style: undefined,
        metadata: undefined,
      },
    });
    const styled = section.dispatch({
      type: 'shape.create',
      shape: { ...RECTANGLE, id: 'b', style: { fill: undefined, opacity: undefined } },
    });
    const patched = section.dispatch({
      type: 'shape.update',
      id: 'b',
      patch: {
        x: undefined,
        visible: undefined,
        style: { stroke: undefined },
        metadata: undefined,
      },
    });

    expect(created).toMatchObject({ ok: true, value: { createdIds: [FIRST_SHAPE_ID] } });
    expect(styled.ok).toBe(true);
    expect(patched).toMatchObject({ ok: true, value: { changed: false } });
    expect(section.getSnapshot().document.nodes['b']).toMatchObject({
      visible: true,
      style: DEFAULT_STYLE,
    });
  });

  it('guarda cópias dos extremos de uma linha, na criação e na alteração', () => {
    const section = newSection();
    const start = { x: 0, y: 0 };
    const end = { x: 30, y: 40 };
    const moved = { x: 7, y: 7 };

    section.dispatch({ type: 'shape.create', shape: { type: 'line', id: 'l', start, end } });
    section.dispatch({ type: 'shape.update', id: 'l', patch: { end: moved } });
    start.x = 99;
    moved.x = 99;

    expect(section.getSnapshot().document.nodes['l']).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 7, y: 7 },
    });
    expect(Object.isFrozen(start) || Object.isFrozen(end) || Object.isFrozen(moved)).toBe(false);
  });

  it('aceita metadata largo, com referência repetida e com objeto sem protótipo', () => {
    const section = newSection();
    const shared = { tag: 'x' };
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { k: 1 });
    const wide = Array.from({ length: 50 }, (_unused, index) => ({ index }));

    const result = section.dispatch({
      type: 'shape.create',
      shape: { ...RECTANGLE, metadata: { wide, first: shared, second: shared, bare } },
    } as CanvasCommand);

    expect(result.ok).toBe(true);
    const metadata = section.getSnapshot().document.nodes[FIRST_SHAPE_ID]?.metadata;
    expect(metadata).toEqual({ wide, first: { tag: 'x' }, second: { tag: 'x' }, bare: { k: 1 } });
    expect(metadata?.['first']).not.toBe(shared);
    expect(Object.isFrozen(shared)).toBe(false);
  });

  it('aceita os valores na borda das faixas de estilo', () => {
    const section = newSection();

    const result = section.transact([
      {
        type: 'shape.create',
        shape: { ...RECTANGLE, id: 'a', style: { strokeWidth: 0, opacity: 1 } },
      },
      { type: 'shape.create', shape: { ...RECTANGLE, id: 'b', style: { opacity: 0 } } },
    ]);

    expect(result.ok).toBe(true);
    expect(section.getSnapshot().document.nodes['a']?.style).toMatchObject({
      strokeWidth: 0,
      opacity: 1,
    });
    expect(section.getSnapshot().document.nodes['b']?.style).toMatchObject({ opacity: 0 });
  });

  it('guarda zero no lugar de zero negativo também dentro do metadata', () => {
    const section = newSection();

    section.dispatch({
      type: 'shape.create',
      shape: { ...RECTANGLE, metadata: { list: [-0], n: -0 } },
    });

    const metadata = section.getSnapshot().document.nodes[FIRST_SHAPE_ID]?.metadata;
    const list = metadata?.['list'];
    expect(Object.is(metadata?.['n'], 0)).toBe(true);
    expect(Array.isArray(list) && Object.is(list[0], 0)).toBe(true);
  });

  it('produz snapshots idênticos para os mesmos comandos e o mesmo gerador de IDs (CORE-02)', () => {
    const commands: CanvasCommand[] = [
      { type: 'shape.create', shape: RECTANGLE },
      { type: 'shape.create', shape: { ...LINE, style: { stroke: '#ABCDEF' } } },
      {
        type: 'shape.create',
        shape: { type: 'ellipse', x: 1, y: 2, width: 3, height: 4, rotation: 7 },
      },
    ];
    const first = newSection();
    const second = newSection();

    const firstResults = commands.map((command) => first.dispatch(command));
    const secondResults = commands.map((command) => second.dispatch(command));

    expect(secondResults).toEqual(firstResults);
    expect(second.getSnapshot()).toEqual(first.getSnapshot());
    expect(JSON.stringify(second.getSnapshot())).toBe(JSON.stringify(first.getSnapshot()));
    expect(Object.keys(first.getSnapshot().document.nodes)).toEqual(['id-3', 'id-4', 'id-5']);
  });

  it('publica um snapshot novo e deixa o anterior como estava', () => {
    const section = newSection();
    const before = section.getSnapshot();

    section.dispatch({ type: 'shape.create', shape: RECTANGLE });

    const after = section.getSnapshot();
    expect(after).not.toBe(before);
    expect(section.getSnapshot()).toBe(after);
    expect(before.revision).toBe(0);
    expect(before.document.nodes).toEqual({});
    expect(before.document.layers[0]?.childIds).toEqual([]);
  });

  it('congela o nó criado em todos os níveis', () => {
    const section = newSection();

    section.dispatch({
      type: 'shape.create',
      shape: { ...LINE, metadata: { 'app:points': [{ x: 1 }] } },
    });

    const { document } = section.getSnapshot();
    const node = document.nodes[FIRST_SHAPE_ID];
    if (node?.type !== 'line') throw new Error('o shape criado é uma linha');
    const points = node.metadata?.['app:points'];
    expect(Object.isFrozen(document.nodes)).toBe(true);
    expect(Object.isFrozen(node)).toBe(true);
    expect(Object.isFrozen(node.start)).toBe(true);
    expect(Object.isFrozen(node.style)).toBe(true);
    expect(Object.isFrozen(node.metadata)).toBe(true);
    expect(Object.isFrozen(points)).toBe(true);
    expect(Array.isArray(points) && Object.isFrozen(points[0])).toBe(true);
    expect(Object.isFrozen(document.layers[0]?.childIds)).toBe(true);
  });

  it('não acha nó por nome herdado de Object.prototype', () => {
    const section = newSection();

    section.dispatch({ type: 'shape.create', shape: RECTANGLE });

    const { nodes } = section.getSnapshot().document;
    expect(nodes['constructor']).toBeUndefined();
    expect(nodes['toString']).toBeUndefined();
    expect(nodes['__proto__']).toBeUndefined();
  });

  it('aceita um ID com nome de membro de Object.prototype', () => {
    const section = newSection();

    const result = section.dispatch({
      type: 'shape.create',
      shape: { ...RECTANGLE, id: 'constructor' },
    });

    expect(result).toMatchObject({ ok: true, value: { createdIds: ['constructor'] } });
    expect(section.getSnapshot().document.nodes['constructor']).toMatchObject({
      id: 'constructor',
    });
  });

  it('funciona destacado do canvas', () => {
    const { dispatch, getSnapshot } = newSection();

    const result = dispatch({ type: 'shape.create', shape: RECTANGLE });

    expect(result.ok).toBe(true);
    expect(getSnapshot().revision).toBe(1);
  });
});

describe('shape.create com entrada inválida', () => {
  const selfContained: Record<string, unknown> = {};
  selfContained['self'] = selfContained;
  const tooDeep = Array.from({ length: 40 }).reduce<unknown>((inner) => [inner], 'fundo');

  it.each([
    ['x não finito', { ...RECTANGLE, x: Number.NaN }, ['shape', 'x'], 'finite'],
    ['y infinito', { ...RECTANGLE, y: Number.POSITIVE_INFINITY }, ['shape', 'y'], 'finite'],
    ['x que não é número', { ...RECTANGLE, x: '10' }, ['shape', 'x'], 'type'],
    ['largura zero', { ...RECTANGLE, width: 0 }, ['shape', 'width'], 'range'],
    ['altura negativa', { ...RECTANGLE, height: -5 }, ['shape', 'height'], 'range'],
    ['largura não finita', { ...RECTANGLE, width: Number.NaN }, ['shape', 'width'], 'finite'],
    [
      'rotação ausente',
      { type: 'ellipse', x: 0, y: 0, width: 1, height: 1 },
      ['shape', 'rotation'],
      'type',
    ],
    [
      'rotação não finita',
      { ...RECTANGLE, rotation: Number.NEGATIVE_INFINITY },
      ['shape', 'rotation'],
      'finite',
    ],
    ['linha de comprimento zero', { ...LINE, end: { x: 0, y: 0 } }, ['shape'], 'zero-length'],
    [
      'extremo com coordenada não finita',
      { ...LINE, start: { x: Number.NaN, y: 0 } },
      ['shape', 'start', 'x'],
      'finite',
    ],
    ['extremo que não é um ponto', { ...LINE, start: [0, 0] }, ['shape', 'start'], 'type'],
    ['extremo ausente', { type: 'line', start: { x: 0, y: 0 } }, ['shape', 'end'], 'type'],
    [
      'extremo com campo a mais',
      { ...LINE, end: { x: 1, y: 1, z: 1 } },
      ['shape', 'end', 'z'],
      'unknown-field',
    ],
    [
      'opacidade acima de 1',
      { ...RECTANGLE, style: { opacity: 1.5 } },
      ['shape', 'style', 'opacity'],
      'range',
    ],
    [
      'opacidade negativa',
      { ...RECTANGLE, style: { opacity: -0.1 } },
      ['shape', 'style', 'opacity'],
      'range',
    ],
    [
      'largura de contorno negativa',
      { ...LINE, style: { strokeWidth: -1 } },
      ['shape', 'style', 'strokeWidth'],
      'range',
    ],
    [
      'cor fora do formato',
      { ...RECTANGLE, style: { fill: 'red' } },
      ['shape', 'style', 'fill'],
      'format',
    ],
    [
      'cor com cinco dígitos',
      { ...RECTANGLE, style: { stroke: '#12345' } },
      ['shape', 'style', 'stroke'],
      'format',
    ],
    [
      'cor que não é texto',
      { ...RECTANGLE, style: { fill: 42 } },
      ['shape', 'style', 'fill'],
      'type',
    ],
    [
      'preenchimento em linha',
      { ...LINE, style: { fill: '#000000' } },
      ['shape', 'style', 'fill'],
      'unknown-field',
    ],
    ['estilo que não é objeto', { ...RECTANGLE, style: 'bold' }, ['shape', 'style'], 'type'],
    [
      'campo de estilo desconhecido',
      { ...RECTANGLE, style: { dash: 2 } },
      ['shape', 'style', 'dash'],
      'unknown-field',
    ],
    [
      'tipo de shape desconhecido',
      { ...RECTANGLE, type: 'hexagon' },
      ['shape', 'type'],
      'unknown-type',
    ],
    [
      'tipo de shape ausente',
      { x: 0, y: 0, width: 1, height: 1, rotation: 0 },
      ['shape', 'type'],
      'unknown-type',
    ],
    [
      'campo com erro de digitação',
      { ...RECTANGLE, heigth: 3 },
      ['shape', 'heigth'],
      'unknown-field',
    ],
    [
      'campo de linha em retângulo',
      { ...RECTANGLE, start: { x: 0, y: 0 } },
      ['shape', 'start'],
      'unknown-field',
    ],
    ['shape que não é objeto', 'rectangle', ['shape'], 'type'],
    ['shape ausente', undefined, ['shape'], 'type'],
    ['visible que não é booleano', { ...RECTANGLE, visible: 'yes' }, ['shape', 'visible'], 'type'],
    ['locked que não é booleano', { ...LINE, locked: 1 }, ['shape', 'locked'], 'type'],
    ['metadata que não é objeto', { ...RECTANGLE, metadata: ['a'] }, ['shape', 'metadata'], 'type'],
    [
      'metadata com função',
      { ...RECTANGLE, metadata: { run: () => 1 } },
      ['shape', 'metadata', 'run'],
      'type',
    ],
    [
      'metadata com Date',
      { ...RECTANGLE, metadata: { when: new Date(0) } },
      ['shape', 'metadata', 'when'],
      'type',
    ],
    [
      'metadata com Map',
      { ...RECTANGLE, metadata: { map: new Map() } },
      ['shape', 'metadata', 'map'],
      'type',
    ],
    [
      'metadata com instância de classe',
      { ...RECTANGLE, metadata: { item: new (class Item {})() } },
      ['shape', 'metadata', 'item'],
      'type',
    ],
    [
      'metadata com undefined',
      { ...RECTANGLE, metadata: { gone: undefined } },
      ['shape', 'metadata', 'gone'],
      'type',
    ],
    [
      'metadata com número não finito',
      { ...RECTANGLE, metadata: { list: [1, Number.NaN] } },
      ['shape', 'metadata', 'list', 1],
      'finite',
    ],
    [
      'metadata que contém a si mesmo',
      { ...RECTANGLE, metadata: { loop: selfContained } },
      ['shape', 'metadata', 'loop', 'self'],
      'type',
    ],
    [
      'metadata aninhado demais',
      { ...RECTANGLE, metadata: { deep: tooDeep } },
      ['shape', 'metadata', 'deep', ...Array.from({ length: 31 }, () => 0)],
      'range',
    ],
    [
      'metadata com a chave __proto__',
      { ...RECTANGLE, metadata: JSON.parse('{"__proto__":1}') as unknown },
      ['shape', 'metadata', '__proto__'],
      'unknown-field',
    ],
    [
      'cor com sete dígitos',
      { ...RECTANGLE, style: { fill: '#1234567' } },
      ['shape', 'style', 'fill'],
      'format',
    ],
    [
      'metadata com a chave __proto__ em objeto aninhado',
      { ...RECTANGLE, metadata: JSON.parse('{"a":{"b":[{"__proto__":{"x":1}}]}}') as unknown },
      ['shape', 'metadata', 'a', 'b', 0, '__proto__'],
      'unknown-field',
    ],
    [
      'cor com nove dígitos',
      { ...RECTANGLE, style: { fill: '#123456789' } },
      ['shape', 'style', 'fill'],
      'format',
    ],
    [
      'cor com texto antes',
      { ...RECTANGLE, style: { fill: 'x#ffffff' } },
      ['shape', 'style', 'fill'],
      'format',
    ],
    [
      'cor com texto depois',
      { ...RECTANGLE, style: { stroke: '#ffffff;' } },
      ['shape', 'style', 'stroke'],
      'format',
    ],
    [
      'cor com espaço',
      { ...RECTANGLE, style: { stroke: ' #ffffff' } },
      ['shape', 'style', 'stroke'],
      'format',
    ],
    ['campo de caixa em linha', { ...LINE, width: 3 }, ['shape', 'width'], 'unknown-field'],
    ['rotação em linha', { ...LINE, rotation: 0 }, ['shape', 'rotation'], 'unknown-field'],
    [
      'metadata que é instância de classe',
      { ...RECTANGLE, metadata: new (class Meta {})() },
      ['shape', 'metadata'],
      'type',
    ],
    ['metadata que é Date', { ...RECTANGLE, metadata: new Date(0) }, ['shape', 'metadata'], 'type'],
    ['metadata nulo', { ...RECTANGLE, metadata: null }, ['shape', 'metadata'], 'type'],
    ['ID nulo', { ...RECTANGLE, id: null }, ['shape', 'id'], 'type'],
    ['visible nulo', { ...RECTANGLE, visible: null }, ['shape', 'visible'], 'type'],
    ['ID vazio', { ...RECTANGLE, id: '' }, ['shape', 'id'], 'type'],
    ['ID que não é texto', { ...RECTANGLE, id: 42 }, ['shape', 'id'], 'type'],
    ['ID reservado', { ...RECTANGLE, id: '__proto__' }, ['shape', 'id'], 'reserved-id'],
    [
      'ID igual ao do documento',
      { ...RECTANGLE, id: DOCUMENT_ID },
      ['shape', 'id'],
      'duplicate-id',
    ],
    ['ID igual ao de uma camada', { ...RECTANGLE, id: LAYER_ID }, ['shape', 'id'], 'duplicate-id'],
    ['ID igual ao de outro nó', { ...RECTANGLE, id: 'existente' }, ['shape', 'id'], 'duplicate-id'],
  ])('recusa %s sem alterar documento nem revisão', (_label, shape, path, rule) => {
    const section = newSection();
    section.dispatch({ type: 'shape.create', shape: { ...LINE, id: 'existente' } });
    const before = section.getSnapshot();

    const result = dispatchUntyped(section, { type: 'shape.create', shape });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: expect.any(String),
        details: { commandIndex: 0, issues: [{ path, rule, message: expect.any(String) }] },
      },
    });
    expect(section.getSnapshot()).toBe(before);
    expect(before.revision).toBe(1);
  });

  it.each([
    [
      'layerId que não é texto',
      { type: 'shape.create', shape: RECTANGLE, layerId: 7 },
      ['layerId'],
      'type',
    ],
    [
      'layerId nulo',
      { type: 'shape.create', shape: RECTANGLE, layerId: null },
      ['layerId'],
      'type',
    ],
    ['layerId vazio', { type: 'shape.create', shape: RECTANGLE, layerId: '' }, ['layerId'], 'type'],
    [
      'campo desconhecido no comando',
      { type: 'shape.create', shape: RECTANGLE, extra: true },
      ['extra'],
      'unknown-field',
    ],
    [
      'tipo de comando desconhecido',
      { type: 'shape.explode', shape: RECTANGLE },
      ['type'],
      'unknown-type',
    ],
    ['comando sem tipo', { shape: RECTANGLE }, ['type'], 'unknown-type'],
    ['comando nulo', null, [], 'type'],
    ['comando que é texto', 'shape.create', [], 'type'],
    ['comando que é array', [{ type: 'shape.create', shape: RECTANGLE }], [], 'type'],
  ])('recusa %s', (_label, command, path, rule) => {
    const section = newSection();
    const before = section.getSnapshot();

    const result = dispatchUntyped(section, command);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', details: { commandIndex: 0, issues: [{ path, rule }] } },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it('relata de uma vez todos os problemas da entrada', () => {
    const section = newSection();

    const result = dispatchUntyped(section, {
      type: 'shape.create',
      layerId: 0,
      shape: { ...RECTANGLE, x: Number.NaN, width: 0, id: '', style: { opacity: 2, fill: 'x' } },
    });

    if (result.ok || result.error.code !== 'VALIDATION_ERROR') {
      throw new Error('esperava VALIDATION_ERROR');
    }
    expect(
      result.error.details.issues.map((issue) => `${issue.path.join('.')}:${issue.rule}`).sort(),
    ).toEqual([
      'layerId:type',
      'shape.id:type',
      'shape.style.fill:format',
      'shape.style.opacity:range',
      'shape.width:range',
      'shape.x:finite',
    ]);
    expect(result.error.message).toContain('and 3 more');
  });

  it('devolve NOT_FOUND quando a camada do comando não existe', () => {
    const section = newSection();
    const before = section.getSnapshot();

    const result = section.dispatch({ type: 'shape.create', shape: RECTANGLE, layerId: 'sumida' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: expect.any(String),
        details: { kind: 'layer', id: 'sumida', commandIndex: 0 },
      },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it('não gasta ID do gerador quando o comando é recusado', () => {
    const section = newSection();

    dispatchUntyped(section, { type: 'shape.create', shape: { ...RECTANGLE, width: 0 } });
    section.dispatch({ type: 'shape.create', shape: RECTANGLE, layerId: 'sumida' });
    const result = section.dispatch({ type: 'shape.create', shape: RECTANGLE });

    expect(result).toMatchObject({
      ok: true,
      value: { createdIds: [FIRST_SHAPE_ID], revision: 1 },
    });
  });

  it.each([
    ['repete um ID em uso', ['doc', 'layer', 'layer']],
    ['repete o ID do documento', ['doc', 'layer', 'doc']],
    ['devolve texto vazio', ['doc', 'layer', '']],
    ['devolve o ID reservado', ['doc', 'layer', '__proto__']],
    ['devolve algo que não é texto', ['doc', 'layer', 7]],
  ])('lança TypeError e não altera nada quando o gerador %s', (_label, values) => {
    let next = 0;
    const section = createCanvasSection({ generateId: (() => values[next++]) as () => string });
    const before = section.getSnapshot();

    expect(() => section.dispatch({ type: 'shape.create', shape: RECTANGLE })).toThrow(TypeError);
    expect(section.getSnapshot()).toBe(before);
  });
});

describe('shape.update', () => {
  function sectionWithShapes(): CanvasSectionApi {
    const section = newSection();
    section.dispatch({ type: 'shape.create', shape: { ...RECTANGLE, id: 'rect' } });
    section.dispatch({ type: 'shape.create', shape: { ...LINE, id: 'line' } });
    return section;
  }

  it('altera só a geometria dada e mantém o resto do nó', () => {
    const section = sectionWithShapes();
    const before = section.getSnapshot();

    const result = section.dispatch({
      type: 'shape.update',
      id: 'rect',
      patch: { x: 5, width: 50 },
    });

    expect(result).toEqual({
      ok: true,
      value: { revision: 3, changed: true, affectedIds: ['rect'], createdIds: [] },
    });
    const after = section.getSnapshot();
    expect(after.document.nodes['rect']).toEqual({
      ...before.document.nodes['rect'],
      x: 5,
      width: 50,
    });
    expect(Object.isFrozen(after.document.nodes['rect'])).toBe(true);
    expect(before.document.nodes['rect']).toMatchObject({ x: 100, width: 240 });
  });

  it('reaproveita no snapshot novo o que não mudou', () => {
    const section = sectionWithShapes();
    const before = section.getSnapshot();

    section.dispatch({ type: 'shape.update', id: 'rect', patch: { y: 1 } });

    const after = section.getSnapshot();
    expect(after.document.layers).toBe(before.document.layers);
    expect(after.document.nodes['line']).toBe(before.document.nodes['line']);
    expect(after.document.nodes).not.toBe(before.document.nodes);
  });

  it('altera só os campos de estilo dados', () => {
    const section = sectionWithShapes();

    section.dispatch({
      type: 'shape.update',
      id: 'rect',
      patch: { style: { fill: null, strokeWidth: 3 } },
    });
    section.dispatch({ type: 'shape.update', id: 'line', patch: { style: { stroke: '#FF0000' } } });

    const { nodes } = section.getSnapshot().document;
    expect(nodes['rect']?.style).toEqual({
      fill: null,
      stroke: '#000000',
      strokeWidth: 3,
      opacity: 1,
    });
    expect(nodes['line']?.style).toEqual({ stroke: '#ff0000', strokeWidth: 1, opacity: 1 });
  });

  it('normaliza a rotação em [-π, π)', () => {
    const section = sectionWithShapes();

    section.dispatch({ type: 'shape.update', id: 'rect', patch: { rotation: 1.5 * Math.PI } });

    expect(section.getSnapshot().document.nodes['rect']).toMatchObject({
      rotation: expect.closeTo(-0.5 * Math.PI, 12),
    });
  });

  it('altera um extremo da linha e mantém o outro', () => {
    const section = sectionWithShapes();

    section.dispatch({ type: 'shape.update', id: 'line', patch: { end: { x: -7, y: 9 } } });

    expect(section.getSnapshot().document.nodes['line']).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: -7, y: 9 },
    });
  });

  it('parte do estilo atual do nó, não do estilo padrão', () => {
    const section = newSection();
    section.transact([
      {
        type: 'shape.create',
        shape: {
          ...RECTANGLE,
          id: 'r',
          style: { fill: '#ff0000', stroke: null, strokeWidth: 3, opacity: 0.4 },
        },
      },
      {
        type: 'shape.create',
        shape: { ...LINE, id: 'l', style: { stroke: '#00ff00', strokeWidth: 5, opacity: 0.2 } },
      },
    ]);

    section.dispatch({ type: 'shape.update', id: 'r', patch: { style: { opacity: 0.9 } } });
    section.dispatch({ type: 'shape.update', id: 'l', patch: { style: { strokeWidth: 7 } } });

    const { nodes } = section.getSnapshot().document;
    expect(nodes['r']?.style).toEqual({
      fill: '#ff0000',
      stroke: null,
      strokeWidth: 3,
      opacity: 0.9,
    });
    expect(nodes['l']?.style).toEqual({ stroke: '#00ff00', strokeWidth: 7, opacity: 0.2 });
  });

  it('converte quadrado para retângulo preservando dimensões, centro e estilo', () => {
    const section = newSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'sq',
        type: 'square',
        x: 10,
        y: 20,
        width: 60,
        height: 60,
        rotation: 0.2,
        style: { fill: '#aabbcc', stroke: '#112233', strokeWidth: 2, opacity: 0.8 },
      },
    });

    const updateRes = section.dispatch({
      type: 'shape.update',
      id: 'sq',
      patch: { type: 'rectangle' },
    });

    expect(updateRes.ok).toBe(true);
    const converted = section.getSnapshot().document.nodes['sq'];
    expect(converted).toMatchObject({
      id: 'sq',
      type: 'rectangle',
      x: 10,
      y: 20,
      width: 60,
      height: 60,
      rotation: 0.2,
      style: { fill: '#aabbcc', stroke: '#112233', strokeWidth: 2, opacity: 0.8 },
    });

    // Agora pode sofrer patch assimétrico de largura sem erro
    const asymmRes = section.dispatch({
      type: 'shape.update',
      id: 'sq',
      patch: { width: 120 },
    });
    expect(asymmRes.ok).toBe(true);
    const updated = section.getSnapshot().document.nodes['sq'];
    expect(updated?.type).toBe('rectangle');
    if (updated?.type === 'rectangle') {
      expect(updated.width).toBe(120);
    }
  });

  it('converte retângulo para quadrado com regra de contenção estrita min(W, H) e mesmo centro', () => {
    const section = newSection();
    // Retângulo horizontal: width 200 > height 100
    // Centro: (100 + 100, 50 + 50) = (200, 100)
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-h',
        type: 'rectangle',
        x: 100,
        y: 50,
        width: 200,
        height: 100,
        rotation: 0.5,
      },
    });

    const convRes = section.dispatch({
      type: 'shape.update',
      id: 'rect-h',
      patch: { type: 'square' },
    });

    expect(convRes.ok).toBe(true);
    const squareH = section.getSnapshot().document.nodes['rect-h'];
    expect(squareH).toMatchObject({
      id: 'rect-h',
      type: 'square',
      x: 150, // 100 + (200 - 100)/2
      y: 50, // 50 + (100 - 100)/2
      width: 100, // min(200, 100)
      height: 100,
      rotation: 0.5,
    });
    // Centro conferido: 150 + 50 = 200, 50 + 50 = 100
    expect(squareH?.type).toBe('square');
    if (squareH?.type === 'square') {
      expect(squareH.x + squareH.width / 2).toBe(200);
      expect(squareH.y + squareH.height / 2).toBe(100);
    }

    // Retângulo vertical: height 160 > width 80
    // Centro: (40 + 40, 60 + 80) = (80, 140)
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-v',
        type: 'rectangle',
        x: 40,
        y: 60,
        width: 80,
        height: 160,
        rotation: 0,
      },
    });

    section.dispatch({
      type: 'shape.update',
      id: 'rect-v',
      patch: { type: 'square' },
    });

    const squareV = section.getSnapshot().document.nodes['rect-v'];
    expect(squareV).toMatchObject({
      id: 'rect-v',
      type: 'square',
      x: 40, // 40 + (80 - 80)/2
      y: 100, // 60 + (160 - 80)/2
      width: 80,
      height: 80,
    });
    expect(squareV?.type).toBe('square');
    if (squareV?.type === 'square') {
      expect(squareV.x + squareV.width / 2).toBe(80);
      expect(squareV.y + squareV.height / 2).toBe(140);
    }
  });

  it('converte círculo para elipse preservando caixa, rotação e estilo, e elipse para círculo com min(W, H) no mesmo centro', () => {
    const section = newSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'ci',
        type: 'circle',
        x: 10,
        y: 20,
        width: 60,
        height: 60,
        rotation: 0.3,
        style: { fill: '#aabbcc', stroke: '#112233', strokeWidth: 2, opacity: 0.8 },
      },
    });

    const toEllipse = section.dispatch({
      type: 'shape.update',
      id: 'ci',
      patch: { type: 'ellipse' },
    });
    expect(toEllipse.ok).toBe(true);
    expect(section.getSnapshot().document.nodes['ci']).toMatchObject({
      id: 'ci',
      type: 'ellipse',
      x: 10,
      y: 20,
      width: 60,
      height: 60,
      rotation: 0.3,
      style: { fill: '#aabbcc', stroke: '#112233', strokeWidth: 2, opacity: 0.8 },
    });

    section.dispatch({
      type: 'shape.update',
      id: 'ci',
      patch: { x: 100, y: 50, width: 200, height: 100 },
    });

    const toCircle = section.dispatch({
      type: 'shape.update',
      id: 'ci',
      patch: { type: 'circle' },
    });
    expect(toCircle.ok).toBe(true);
    expect(section.getSnapshot().document.nodes['ci']).toMatchObject({
      id: 'ci',
      type: 'circle',
      x: 150,
      y: 50,
      width: 100,
      height: 100,
      rotation: 0.3,
    });
  });

  it('altera visibilidade e bloqueio', () => {
    const section = sectionWithShapes();

    section.dispatch({ type: 'shape.update', id: 'line', patch: { visible: false, locked: true } });

    expect(section.getSnapshot().document.nodes['line']).toMatchObject({
      visible: false,
      locked: true,
    });
  });

  it('substitui o metadata por uma cópia e o remove com null', () => {
    const section = sectionWithShapes();
    const metadata = { 'app:tag': 'a' };

    section.dispatch({ type: 'shape.update', id: 'rect', patch: { metadata } });
    metadata['app:tag'] = 'b';
    const withMetadata = section.getSnapshot().document.nodes['rect'];
    section.dispatch({ type: 'shape.update', id: 'rect', patch: { metadata: { 'app:other': 1 } } });
    const replaced = section.getSnapshot().document.nodes['rect'];
    section.dispatch({ type: 'shape.update', id: 'rect', patch: { metadata: null } });
    const removed = section.getSnapshot().document.nodes['rect'];

    expect(withMetadata?.metadata).toEqual({ 'app:tag': 'a' });
    expect(replaced?.metadata).toEqual({ 'app:other': 1 });
    expect(removed && 'metadata' in removed).toBe(false);
    expect(removed).toMatchObject({ id: 'rect', x: 100 });
  });

  it.each([
    ['os mesmos valores', { x: 100, width: 240, style: { fill: '#FFFFFF' } }],
    ['um patch vazio', {}],
    ['um estilo vazio', { style: {} }],
    ['metadata null em nó sem metadata', { metadata: null }],
    ['uma rotação equivalente à atual', { rotation: 2 * Math.PI }],
  ])('não gera revisão, snapshot nem evento com %s', (_label, patch) => {
    const section = sectionWithShapes();
    const before = section.getSnapshot();
    const listener = vi.fn();
    section.subscribe(listener);

    const result = dispatchUntyped(section, { type: 'shape.update', id: 'rect', patch });

    expect(result).toEqual({
      ok: true,
      value: { revision: 2, changed: false, affectedIds: [], createdIds: [] },
    });
    expect(section.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('emite um evento com o ID alterado', () => {
    const section = sectionWithShapes();
    const listener = vi.fn();
    section.subscribe(listener);

    section.dispatch({ type: 'shape.update', id: 'line', patch: { start: { x: 1, y: 1 } } });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      snapshot: section.getSnapshot(),
      origin: 'local',
      areas: ['document'],
      affectedIds: ['line'],
    });
  });

  it('devolve NOT_FOUND para ID que não existe, sem alterar nada (CORE-03)', () => {
    const section = sectionWithShapes();
    const before = section.getSnapshot();

    const result = section.dispatch({ type: 'shape.update', id: 'sumido', patch: { x: 1 } });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: expect.any(String),
        details: { kind: 'node', id: 'sumido', commandIndex: 0 },
      },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it('não trata o ID de uma camada como nó', () => {
    const section = sectionWithShapes();

    const result = section.dispatch({ type: 'shape.update', id: LAYER_ID, patch: { x: 1 } });

    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it.each([
    ['largura zero', 'rect', { width: 0 }, ['patch', 'width'], 'range'],
    ['coordenada não finita', 'rect', { x: Number.NaN }, ['patch', 'x'], 'finite'],
    [
      'opacidade fora da faixa',
      'rect',
      { style: { opacity: 2 } },
      ['patch', 'style', 'opacity'],
      'range',
    ],
    [
      'cor fora do formato',
      'line',
      { style: { stroke: 'blue' } },
      ['patch', 'style', 'stroke'],
      'format',
    ],
    ['campo desconhecido', 'rect', { heigth: 3 }, ['patch', 'heigth'], 'unknown-field'],
    ['troca de tipo', 'rect', { type: 'ellipse' }, ['patch', 'type'], 'unknown-field'],
    ['troca de ID', 'rect', { id: 'outro' }, ['patch', 'id'], 'unknown-field'],
    ['campo de retângulo em linha', 'line', { width: 3 }, ['patch', 'width'], 'unknown-field'],
    [
      'campo de linha em retângulo',
      'rect',
      { end: { x: 1, y: 1 } },
      ['patch', 'end'],
      'unknown-field',
    ],
    [
      'preenchimento em linha',
      'line',
      { style: { fill: null } },
      ['patch', 'style', 'fill'],
      'unknown-field',
    ],
    [
      'linha que ficaria com comprimento zero',
      'line',
      { end: { x: 0, y: 0 } },
      ['patch'],
      'zero-length',
    ],
    ['extremo inválido', 'line', { start: { x: 0 } }, ['patch', 'start', 'y'], 'type'],
    ['visible que não é booleano', 'rect', { visible: 0 }, ['patch', 'visible'], 'type'],
    ['metadata que não é objeto', 'rect', { metadata: 'x' }, ['patch', 'metadata'], 'type'],
    ['estilo que não é objeto', 'rect', { style: null }, ['patch', 'style'], 'type'],
  ])('recusa %s sem alterar documento nem revisão (CORE-03)', (_label, id, patch, path, rule) => {
    const section = sectionWithShapes();
    const before = section.getSnapshot();
    const listener = vi.fn();
    section.subscribe(listener);

    const result = dispatchUntyped(section, { type: 'shape.update', id, patch });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: expect.any(String),
        details: { commandIndex: 0, issues: [{ path, rule, message: expect.any(String) }] },
      },
    });
    expect(section.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    ['patch ausente', { type: 'shape.update', id: 'rect' }, ['patch'], 'type'],
    ['patch que é array', { type: 'shape.update', id: 'rect', patch: [] }, ['patch'], 'type'],
    ['ID ausente', { type: 'shape.update', patch: {} }, ['id'], 'type'],
    ['ID que não é texto', { type: 'shape.update', id: 3, patch: {} }, ['id'], 'type'],
    [
      'campo desconhecido',
      { type: 'shape.update', id: 'rect', patch: {}, x: 1 },
      ['x'],
      'unknown-field',
    ],
  ])('recusa comando com %s', (_label, command, path, rule) => {
    const section = sectionWithShapes();
    const before = section.getSnapshot();

    const result = dispatchUntyped(section, command);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', details: { commandIndex: 0, issues: [{ path, rule }] } },
    });
    expect(section.getSnapshot()).toBe(before);
  });
});

describe('shape.remove', () => {
  function sectionWithThree(): CanvasSectionApi {
    const section = newSection();
    for (const id of ['a', 'b', 'c']) {
      section.dispatch({ type: 'shape.create', shape: { ...RECTANGLE, id } });
    }
    return section;
  }

  it('retira o shape do mapa de nós e da camada na mesma revisão', () => {
    const section = sectionWithThree();
    const before = section.getSnapshot();

    const result = section.dispatch({ type: 'shape.remove', id: 'b' });

    expect(result).toEqual({
      ok: true,
      value: { revision: 4, changed: true, affectedIds: ['b', LAYER_ID], createdIds: [] },
    });
    const { document } = section.getSnapshot();
    expect(Object.keys(document.nodes)).toEqual(['a', 'c']);
    expect(document.layers[0]?.childIds).toEqual(['a', 'c']);
    expect(Object.keys(before.document.nodes)).toEqual(['a', 'b', 'c']);
    expect(before.document.layers[0]?.childIds).toEqual(['a', 'b', 'c']);
  });

  it('emite um evento com o nó removido e a camada dele', () => {
    const section = sectionWithThree();
    const listener = vi.fn();
    section.subscribe(listener);

    section.dispatch({ type: 'shape.remove', id: 'c' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'local', affectedIds: ['c', LAYER_ID] }),
    );
  });

  it('libera o ID removido para um shape novo', () => {
    const section = sectionWithThree();

    section.dispatch({ type: 'shape.remove', id: 'a' });
    const result = section.dispatch({ type: 'shape.create', shape: { ...LINE, id: 'a' } });

    expect(result).toMatchObject({ ok: true, value: { createdIds: ['a'] } });
    expect(section.getSnapshot().document.layers[0]?.childIds).toEqual(['b', 'c', 'a']);
  });

  it('devolve NOT_FOUND para ID que não existe, sem alterar nada', () => {
    const section = sectionWithThree();
    const before = section.getSnapshot();

    const result = section.dispatch({ type: 'shape.remove', id: 'sumido' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: expect.any(String),
        details: { kind: 'node', id: 'sumido', commandIndex: 0 },
      },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it.each([
    ['ID ausente', { type: 'shape.remove' }, ['id'], 'type'],
    ['ID vazio', { type: 'shape.remove', id: '' }, ['id'], 'type'],
    [
      'campo desconhecido',
      { type: 'shape.remove', id: 'a', force: true },
      ['force'],
      'unknown-field',
    ],
  ])('recusa comando com %s', (_label, command, path, rule) => {
    const section = sectionWithThree();
    const before = section.getSnapshot();

    const result = dispatchUntyped(section, command);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', details: { commandIndex: 0, issues: [{ path, rule }] } },
    });
    expect(section.getSnapshot()).toBe(before);
  });
});

describe('DiamondNode (Tarefa 101)', () => {
  it('cria, carrega, atualiza e desfaz/refaz losango com caixa livre', () => {
    const section = newSection();
    const createRes = section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'dm-1',
        type: 'diamond',
        x: 10,
        y: 20,
        width: 120,
        height: 80,
        rotation: 0.25,
        style: { fill: '#f59e0b', stroke: '#b45309', strokeWidth: 2, opacity: 0.9 },
      },
    });
    expect(createRes.ok).toBe(true);
    expect(section.getSnapshot().document.nodes['dm-1']).toMatchObject({
      id: 'dm-1',
      type: 'diamond',
      x: 10,
      y: 20,
      width: 120,
      height: 80,
      rotation: 0.25,
      style: { fill: '#f59e0b', stroke: '#b45309', strokeWidth: 2, opacity: 0.9 },
    });

    // Patch de geometria e estilo
    const updateRes = section.dispatch({
      type: 'shape.update',
      id: 'dm-1',
      patch: { width: 200, height: 100, style: { fill: '#ef4444' } },
    });
    expect(updateRes.ok).toBe(true);
    expect(section.getSnapshot().document.nodes['dm-1']).toMatchObject({
      type: 'diamond',
      width: 200,
      height: 100,
      style: { fill: '#ef4444' },
    });

    // Undo / Redo
    section.undo();
    expect(section.getSnapshot().document.nodes['dm-1']).toMatchObject({
      width: 120,
      height: 80,
      style: { fill: '#f59e0b' },
    });
    section.redo();
    expect(section.getSnapshot().document.nodes['dm-1']).toMatchObject({
      width: 200,
      height: 100,
      style: { fill: '#ef4444' },
    });

    // Carga via replaceDocument preserva diamond
    const doc = JSON.parse(JSON.stringify(section.getSnapshot().document)) as unknown;
    const section2 = newSection();
    expect(section2.replaceDocument(doc).ok).toBe(true);
    expect(section2.getSnapshot().document.nodes['dm-1']).toMatchObject({
      type: 'diamond',
      width: 200,
      height: 100,
    });
  });
});

describe('TriangleNode (Tarefa 104)', () => {
  it('cria triângulo, converte variantes (incluindo equilátero com fitAspect) e restaura no undo/redo', () => {
    const section = newSection();
    const createRes = section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'tri-1',
        type: 'triangle',
        x: 10,
        y: 20,
        width: 100,
        height: 100,
        rotation: 0,
      },
    });
    expect(createRes.ok).toBe(true);
    expect(section.getSnapshot().document.nodes['tri-1']).toMatchObject({
      id: 'tri-1',
      type: 'triangle',
      variant: 'isosceles',
      apex: 0.5,
      x: 10,
      y: 20,
      width: 100,
      height: 100,
    });

    // Converte para equilátero
    const eqRes = section.dispatch({
      type: 'shape.update',
      id: 'tri-1',
      patch: { variant: 'equilateral' },
    });
    expect(eqRes.ok).toBe(true);
    const expectedH = (100 * Math.sqrt(3)) / 2;
    expect(section.getSnapshot().document.nodes['tri-1']).toMatchObject({
      type: 'triangle',
      variant: 'equilateral',
      apex: 0.5,
      x: 10,
      y: expect.closeTo(20 + (100 - expectedH) / 2, 6),
      width: 100,
      height: expect.closeTo(expectedH, 6),
    });

    // Converte para escaleno (apex 0.5 -> 0.3)
    const scRes = section.dispatch({
      type: 'shape.update',
      id: 'tri-1',
      patch: { variant: 'scalene' },
    });
    expect(scRes.ok).toBe(true);
    expect(section.getSnapshot().document.nodes['tri-1']).toMatchObject({
      variant: 'scalene',
      apex: 0.3,
    });

    // Undo volta para equilátero
    section.undo();
    expect(section.getSnapshot().document.nodes['tri-1']).toMatchObject({
      variant: 'equilateral',
      apex: 0.5,
      height: expect.closeTo(expectedH, 6),
    });

    // Undo volta para isósceles 100x100
    section.undo();
    expect(section.getSnapshot().document.nodes['tri-1']).toMatchObject({
      variant: 'isosceles',
      apex: 0.5,
      x: 10,
      y: 20,
      width: 100,
      height: 100,
    });

    // Redo reaplica equilátero
    section.redo();
    expect(section.getSnapshot().document.nodes['tri-1']).toMatchObject({
      variant: 'equilateral',
      apex: 0.5,
      height: expect.closeTo(expectedH, 6),
    });
  });
});

describe('PolygonNode (Tarefa 107)', () => {
  it('cria polígono, troca o número de lados e restaura no undo/redo', () => {
    const section = newSection();
    expect(
      section.dispatch({
        type: 'shape.create',
        shape: { id: 'pg-1', type: 'polygon', x: 10, y: 20, width: 80, height: 80, rotation: 0 },
      }).ok,
    ).toBe(true);
    expect(section.getSnapshot().document.nodes['pg-1']).toMatchObject({
      type: 'polygon',
      sides: 5,
      x: 10,
      y: 20,
      width: 80,
      height: 80,
    });

    expect(section.dispatch({ type: 'shape.update', id: 'pg-1', patch: { sides: 8 } }).ok).toBe(
      true,
    );
    expect(section.getSnapshot().document.nodes['pg-1']).toMatchObject({
      sides: 8,
      x: 10,
      y: 20,
      width: 80,
      height: 80,
    });

    section.undo();
    expect(section.getSnapshot().document.nodes['pg-1']).toMatchObject({ sides: 5 });
    section.redo();
    expect(section.getSnapshot().document.nodes['pg-1']).toMatchObject({ sides: 8 });
  });

  it('recusa sides fora da faixa sem mudar o documento', () => {
    const section = newSection();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'pg-1', type: 'polygon', x: 0, y: 0, width: 50, height: 50, rotation: 0 },
    });
    const before = section.getSnapshot();

    const result = section.dispatch({ type: 'shape.update', id: 'pg-1', patch: { sides: 2 } });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        details: { issues: [expect.objectContaining({ rule: 'range' })] },
      },
    });
    expect(section.getSnapshot()).toBe(before);
  });
});

describe('BezierNode (Tarefa 110)', () => {
  const START = { x: 0, y: 0 };
  const END = { x: 10000, y: 0 };

  it('cria a curva simétrica padrão, edita um controle espelhando o outro e desfaz', () => {
    const section = newSection();
    expect(
      section.dispatch({
        type: 'shape.create',
        shape: { id: 'bz', type: 'bezier', start: START, end: END },
      }).ok,
    ).toBe(true);
    expect(section.getSnapshot().document.nodes['bz']).toMatchObject({
      type: 'bezier',
      symmetric: true,
      control1: { x: 10000 / 3, y: -2500 },
      control2: { x: 20000 / 3, y: -2500 },
    });

    section.dispatch({
      type: 'shape.update',
      id: 'bz',
      patch: { control1: { x: 1000, y: -4000 } },
    });
    expect(section.getSnapshot().document.nodes['bz']).toMatchObject({
      control1: { x: 1000, y: -4000 },
      control2: { x: 9000, y: -4000 },
    });

    section.undo();
    expect(section.getSnapshot().document.nodes['bz']).toMatchObject({
      control1: { x: 10000 / 3, y: -2500 },
    });
    section.redo();
    expect(section.getSnapshot().document.nodes['bz']).toMatchObject({
      control2: { x: 9000, y: -4000 },
    });
  });

  it.each([0.05, 1, 16])('hit-test no zoom %d acerta o traço e erra o meio da corda', (zoom) => {
    const section = newSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'bz',
        type: 'bezier',
        start: START,
        control1: { x: 0, y: 10000 },
        control2: { x: 10000, y: 10000 },
        end: END,
        style: { strokeWidth: 2 },
      },
    });
    section.setViewport({ x: 0, y: 0, zoom });
    const options = { includePreview: false } as const;

    // Pontos da curva em t = 0,5 e t = 0,3, e um pouco fora do traço na escala do zoom
    expect(section.hitTest({ x: 5000, y: 7500 }, options)).toBe('bz');
    const t = 0.3;
    const onCurve = {
      x: 3 * (1 - t) * t * t * 10000 + t * t * t * 10000,
      y: 3 * (1 - t) * (1 - t) * t * 10000 + 3 * (1 - t) * t * t * 10000,
    };
    expect(section.hitTest(onCurve, options)).toBe('bz');
    expect(section.hitTest({ x: 5000, y: 0 }, options)).toBeUndefined();
    // 20% além do alcance (meio traço mais a folga de 6 px): fora mesmo com o erro do achatamento
    expect(section.hitTest({ x: 5000, y: 7500 + (1 + 6 / zoom) * 1.2 }, options)).toBeUndefined();
  });

  it('respeita o limite de coordenada em todos os pontos, inclusive nos controles', () => {
    const section = newSection();
    const result = section.dispatch({
      type: 'shape.create',
      shape: {
        type: 'bezier',
        start: START,
        end: { x: 10, y: 0 },
        control1: { x: 5, y: 2e9 },
        symmetric: false,
      },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'LIMIT_EXCEEDED' } });
  });
});

describe('shape.update com label (US-SL.2)', () => {
  const BOX = { x: 0, y: 0, width: 100, height: 100, rotation: 0 } as const;
  const withLabel = (shape: Record<string, unknown>) => {
    const section = newSection();
    expect(
      dispatchUntyped(section, {
        type: 'shape.create',
        shape: { id: 's', ...BOX, ...shape, label: { text: 'Olá' } },
      }).ok,
    ).toBe(true);
    return section;
  };
  const labelOf = (section: CanvasSectionApi) =>
    (section.getSnapshot().document.nodes['s'] as { label?: Record<string, unknown> }).label;

  it('mescla só os campos dados sobre o label atual', () => {
    const section = withLabel({ type: 'rectangle' });

    const res = dispatchUntyped(section, {
      type: 'shape.update',
      id: 's',
      patch: { label: { verticalAlign: 'top' } },
    });

    expect(res.ok).toBe(true);
    expect(labelOf(section)).toEqual({
      text: 'Olá',
      fontSize: 16,
      fontFamily: 'sans-serif',
      fontWeight: 'normal',
      color: null,
      textAlign: 'center',
      verticalAlign: 'top',
    });
  });

  it.each([
    'rectangle',
    'square',
    'ellipse',
    'circle',
    'diamond',
    'triangle',
    'polygon',
    'cross',
    'chevron',
  ])('%s aceita o patch de label e a remoção dele', (type) => {
    const section = newSection();
    section.dispatch({ type: 'shape.create', shape: { id: 's', type, ...BOX } } as never);

    const added = dispatchUntyped(section, {
      type: 'shape.update',
      id: 's',
      patch: { label: { text: 'Olá', verticalAlign: 'bottom' } },
    });
    expect(added.ok).toBe(true);
    expect(labelOf(section)).toMatchObject({ text: 'Olá', verticalAlign: 'bottom' });

    const removed = dispatchUntyped(section, {
      type: 'shape.update',
      id: 's',
      patch: { label: null },
    });
    expect(removed.ok).toBe(true);
    expect(labelOf(section)).toBeUndefined();
  });

  it('na primeira vez, cria o label com os padrões e os campos dados', () => {
    const section = newSection();
    section.dispatch({ type: 'shape.create', shape: { id: 's', type: 'ellipse', ...BOX } });
    expect(labelOf(section)).toBeUndefined();

    dispatchUntyped(section, {
      type: 'shape.update',
      id: 's',
      patch: { label: { textAlign: 'right' } },
    });

    expect(labelOf(section)).toMatchObject({
      text: '',
      textAlign: 'right',
      verticalAlign: 'middle',
    });
  });

  it('label: null remove o texto, e a forma volta ao que era', () => {
    const section = withLabel({ type: 'diamond' });

    const res = dispatchUntyped(section, { type: 'shape.update', id: 's', patch: { label: null } });

    expect(res.ok).toBe(true);
    expect('label' in section.getSnapshot().document.nodes['s']!).toBe(false);
  });

  it.each([
    ['rectangle', 'square'],
    ['square', 'rectangle'],
    ['ellipse', 'circle'],
    ['circle', 'ellipse'],
  ])('converter %s em %s preserva o label', (from, to) => {
    const section = withLabel({ type: from });

    const res = dispatchUntyped(section, { type: 'shape.update', id: 's', patch: { type: to } });

    expect(res.ok).toBe(true);
    expect(section.getSnapshot().document.nodes['s']).toMatchObject({
      type: to,
      label: { text: 'Olá' },
    });
  });

  it('trocar a variante do triângulo e o número de lados do polígono preserva o label', () => {
    const triangle = withLabel({ type: 'triangle' });
    dispatchUntyped(triangle, { type: 'shape.update', id: 's', patch: { variant: 'right' } });
    expect(labelOf(triangle)).toMatchObject({ text: 'Olá' });

    const polygon = withLabel({ type: 'polygon', sides: 5 });
    dispatchUntyped(polygon, { type: 'shape.update', id: 's', patch: { sides: 8 } });
    expect(labelOf(polygon)).toMatchObject({ text: 'Olá' });
  });

  it('um patch de outro campo não toca o label', () => {
    const section = withLabel({ type: 'cross' });
    const before = labelOf(section);

    dispatchUntyped(section, { type: 'shape.update', id: 's', patch: { width: 140, height: 140 } });

    expect(labelOf(section)).toBe(before);
  });

  it('um valor inválido recusa o patch inteiro, sem alteração parcial', () => {
    const section = withLabel({ type: 'chevron' });
    const before = section.getSnapshot().document;

    const res = dispatchUntyped(section, {
      type: 'shape.update',
      id: 's',
      patch: { width: 300, label: { text: 'novo', fontSize: -1 } },
    });

    expect(res.ok).toBe(false);
    expect(section.getSnapshot().document).toBe(before);
  });

  it('recusa label em forma que não aceita (sticky, brace e ink)', () => {
    const section = newSection();
    section.dispatch({ type: 'shape.create', shape: { id: 'n', type: 'sticky', x: 0, y: 0 } });

    const res = dispatchUntyped(section, {
      type: 'shape.update',
      id: 'n',
      patch: { label: { text: 'x' } },
    });

    expect(res).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('desfazer a primeira edição devolve a forma sem label, e refazer o restaura', () => {
    const section = newSection();
    section.dispatch({ type: 'shape.create', shape: { id: 's', type: 'rectangle', ...BOX } });
    dispatchUntyped(section, {
      type: 'shape.update',
      id: 's',
      patch: { label: { text: 'Olá' } },
    });
    expect(labelOf(section)).toMatchObject({ text: 'Olá' });

    section.undo();
    expect('label' in section.getSnapshot().document.nodes['s']!).toBe(false);

    section.redo();
    expect(labelOf(section)).toMatchObject({ text: 'Olá' });
  });
});

describe('shape.remove com boards (spec boards, §3.2)', () => {
  /** Board `b` com o retângulo `c1`, o grupo `g` (m1, m2) e a seta `link` entre c1 e m1; `out` fica fora. */
  function boardWithChildren(): CanvasSectionApi {
    const section = newSection();
    const r = (id: string, x: number) => ({ ...RECTANGLE, id, x });
    const created = section.transact([
      {
        type: 'shape.create',
        shape: { id: 'b', type: 'board', x: 0, y: 0, width: 600, height: 400 },
      },
      { type: 'shape.create', shape: r('c1', 10) },
      { type: 'shape.create', shape: r('m1', 300) },
      { type: 'shape.create', shape: r('m2', 400) },
      { type: 'shape.create', shape: r('out', 900) },
      {
        type: 'shape.create',
        shape: {
          id: 'link',
          type: 'arrow',
          start: { targetId: 'c1', anchor: { x: 1, y: 0.5 } },
          end: { targetId: 'm1', anchor: { x: 0, y: 0.5 } },
        },
      },
      {
        type: 'shape.create',
        shape: {
          id: 'outside-arrow',
          type: 'arrow',
          start: { targetId: 'out', anchor: { x: 0, y: 0.5 } },
          end: { targetId: 'c1', anchor: { x: 1, y: 0.5 } },
        },
      },
      { type: 'group.create', id: 'g', childIds: ['m1', 'm2'] },
      { type: 'board.attach', boardId: 'b', ids: ['c1', 'g', 'link'] },
    ] as CanvasCommand[]);
    if (!created.ok) throw new Error(`fixture recusada: ${JSON.stringify(created.error)}`);
    return section;
  }
  const nodesOf = (section: CanvasSectionApi) => section.getSnapshot().document.nodes;

  it('US-BD.8 (core): remove o board e os descendentes numa transação, e o undo restaura tudo', () => {
    const section = boardWithChildren();
    const before = section.getSnapshot().document;

    const result = section.dispatch({ type: 'shape.remove', id: 'b' });

    expect(result.ok).toBe(true);
    expect(Object.keys(nodesOf(section)).sort()).toEqual(['out', 'outside-arrow']);
    section.undo();
    expect(section.getSnapshot().document).toEqual(before);
    expect(Object.keys(nodesOf(section)).sort()).toEqual(Object.keys(before.nodes).sort());
  });

  it('as setas ligadas a filhos removidos ficam com as pontas livres na última posição', () => {
    const section = boardWithChildren();

    section.dispatch({ type: 'shape.remove', id: 'b' });

    const arrow = nodesOf(section)['outside-arrow'] as { start: unknown; end: unknown };
    // O alvo que ficou continua ligado; a ponta que apontava para o filho removido virou livre.
    expect(arrow.start).toMatchObject({ targetId: 'out' });
    expect(arrow.end).toEqual({ x: 250, y: 140 });
  });

  it('um descendente locked recusa com LOCKED e o ID dele em lockedBy', () => {
    const section = boardWithChildren();
    section.dispatch({ type: 'shape.update', id: 'm2', patch: { locked: true } });
    const before = section.getSnapshot().document;

    const result = section.dispatch({ type: 'shape.remove', id: 'b' });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'LOCKED', details: { id: 'b', lockedBy: 'm2' } },
    });
    expect(section.getSnapshot().document).toBe(before);
  });

  it('a remoção de grupo fora de board segue como era', () => {
    const section = newSection();
    section.transact([
      { type: 'shape.create', shape: { ...RECTANGLE, id: 'a' } },
      { type: 'shape.create', shape: { ...RECTANGLE, id: 'b' } },
      { type: 'group.create', id: 'g', childIds: ['a', 'b'] },
    ] as CanvasCommand[]);
    section.dispatch({ type: 'shape.update', id: 'b', patch: { locked: true } });

    const result = section.dispatch({ type: 'shape.remove', id: 'g' });

    // Hoje a remoção do grupo não confere o bloqueio dos membros.
    expect(result.ok).toBe(true);
    expect(Object.keys(nodesOf(section))).toEqual([]);
  });

  it('remover um filho o tira de childIds do board', () => {
    const section = boardWithChildren();

    const result = section.dispatch({ type: 'shape.remove', id: 'c1' });

    expect(result.ok).toBe(true);
    expect((nodesOf(section)['b'] as unknown as { childIds: string[] }).childIds).toEqual([
      'g',
      'link',
    ]);
    expect(nodesOf(section)['c1']).toBeUndefined();
  });

  it('remover o grupo filho tira o grupo e os membros do board', () => {
    const section = boardWithChildren();

    section.dispatch({ type: 'shape.remove', id: 'g' });

    expect((nodesOf(section)['b'] as unknown as { childIds: string[] }).childIds).toEqual([
      'c1',
      'link',
    ]);
    expect(nodesOf(section)['m1']).toBeUndefined();
    expect(nodesOf(section)['m2']).toBeUndefined();
  });

  it('remover um membro de grupo dentro de board dissolve o grupo e devolve o outro ao board', () => {
    const section = boardWithChildren();

    const result = section.dispatch({ type: 'shape.remove', id: 'm1' });

    expect(result.ok).toBe(true);
    expect((nodesOf(section)['b'] as unknown as { childIds: string[] }).childIds).toEqual([
      'c1',
      'm2',
      'link',
    ]);
    expect(nodesOf(section)['g']).toBeUndefined();
    expect(section.getNodeInfo('m2')).toMatchObject({ boardId: 'b' });
    expect(section.getSnapshot().document.layers[0]!.childIds).toEqual([
      'b',
      'out',
      'outside-arrow',
    ]);
  });

  it('um grupo de três membros dentro de board só perde o membro removido', () => {
    const section = newSection();
    section.transact([
      {
        type: 'shape.create',
        shape: { id: 'b', type: 'board', x: 0, y: 0, width: 600, height: 400 },
      },
      ...['a', 'b2', 'c'].map((id) => ({ type: 'shape.create', shape: { ...RECTANGLE, id } })),
      { type: 'group.create', id: 'g', childIds: ['a', 'b2', 'c'] },
      { type: 'board.attach', boardId: 'b', ids: ['g'] },
    ] as CanvasCommand[]);

    section.dispatch({ type: 'shape.remove', id: 'b2' });

    const nodes = nodesOf(section);
    expect((nodes['g'] as unknown as { childIds: string[] }).childIds).toEqual(['a', 'c']);
    expect((nodes['b'] as unknown as { childIds: string[] }).childIds).toEqual(['g']);
  });

  it('um filho de board locked não é removido: lockedBy é o board', () => {
    const section = boardWithChildren();
    section.dispatch({ type: 'shape.update', id: 'b', patch: { locked: true } });

    const result = section.dispatch({ type: 'shape.remove', id: 'c1' });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'LOCKED', details: { lockedBy: 'b' } },
    });
  });
});
