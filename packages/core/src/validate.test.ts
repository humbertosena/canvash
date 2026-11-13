import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  createCanvasSection,
  createCanvasSectionWith,
  type CanvasSectionApi,
  type CommitCandidate,
} from './canvas-section.js';
import type { CanvasCommand } from './commands.js';
import type { CanvasDocument } from './document.js';
import type { CanvasChange } from './events.js';
import { DEFAULT_LIMITS, type CanvasLimits } from './limits.js';
import { validationError } from './result.js';
import { validateDocument } from './validate.js';

const FIXTURES = new URL('../../../tests/fixtures/documents/', import.meta.url);

interface Fixture {
  readonly name: string;
  readonly description: string;
  readonly document: unknown;
  readonly expected?: {
    readonly code: string;
    readonly issues?: unknown;
    readonly details?: unknown;
  };
}

function fixtures(kind: 'valid' | 'invalid'): Fixture[] {
  const dir = new URL(`${kind}/`, FIXTURES);
  return readdirSync(fileURLToPath(dir))
    .filter((file) => file.endsWith('.json'))
    .map((file) => ({
      name: file,
      ...(JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as Omit<Fixture, 'name'>),
    }));
}

function counter(): () => string {
  let count = 0;
  return () => `id-${++count}`;
}

const STYLE = { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 };

function rect(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    visible: true,
    locked: false,
    style: { ...STYLE },
    ...over,
  };
}

function layer(
  id: string,
  childIds: unknown,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id, name: `Layer ${id}`, visible: true, locked: false, childIds, ...over };
}

/** Documento válido com os nós dados em uma camada só; `over` troca campos do documento. */
function doc(
  nodes: Record<string, unknown>[],
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'doc',
    nodes: Object.fromEntries(nodes.map((node) => [node['id'], node])),
    layers: [
      layer(
        'l1',
        nodes.map((node) => node['id']),
      ),
    ],
    ...over,
  };
}

function expectIssue(input: unknown, path: (string | number)[], rule: string): void {
  expect(validateDocument(input)).toEqual({
    ok: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: expect.any(String),
      details: { issues: [{ path, rule, message: expect.any(String) }] },
    },
  });
}

describe('validateDocument', () => {
  it('aceita o documento de um canvas e devolve uma cópia igual, congelada e sem protótipo no mapa de nós', () => {
    const section = createCanvasSection({ generateId: counter() });
    section.transact([
      {
        type: 'shape.create',
        shape: {
          type: 'rectangle',
          id: 'r',
          x: 1,
          y: 2,
          width: 3,
          height: 4,
          rotation: 0.5,
          metadata: { 'app:k': [1, { a: null }] },
        },
      },
      {
        type: 'shape.create',
        shape: { type: 'line', id: 'l', start: { x: 0, y: 0 }, end: { x: 5, y: 5 } },
      },
      { type: 'layer.create', layer: { id: 'top', locked: true, metadata: { 'app:n': 1 } } },
    ]);
    const original = section.getSnapshot().document;

    const fromObject = validateDocument(original);
    const fromJson = validateDocument(JSON.parse(JSON.stringify(original)));

    for (const result of [fromObject, fromJson]) {
      if (!result.ok) throw new Error(`esperava sucesso: ${result.error.message}`);
      expect(result.value).toEqual(original);
      expect(result.value).not.toBe(original);
      expect(result.value.nodes['r']).not.toBe(original.nodes['r']);
      expect(Object.getPrototypeOf(result.value.nodes)).toBeNull();
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.nodes['r']?.metadata?.['app:k'])).toBe(true);
      expect(Object.isFrozen(result.value.layers[0]?.childIds)).toBe(true);
      expect(Object.keys(result.value.nodes)).toEqual(['r', 'l']);
      expect(JSON.stringify(result.value)).toBe(JSON.stringify(original));
    }
  });

  it('normaliza cor, rotação e zero negativo como os comandos', () => {
    const result = validateDocument(
      doc([
        rect('a', {
          x: -0,
          rotation: 1.5 * Math.PI,
          style: { ...STYLE, fill: '#AABBCC', stroke: '#11223344' },
        }),
      ]),
    );

    if (!result.ok) throw new Error('esperava sucesso');
    const node = result.value.nodes['a'];
    if (node?.type !== 'rectangle') throw new Error('esperava um retângulo');
    expect(node.style).toMatchObject({ fill: '#aabbcc', stroke: '#11223344' });
    expect(node.rotation).toBeCloseTo(-0.5 * Math.PI, 12);
    expect(Object.is(node.x, 0)).toBe(true);
  });

  it('não guarda nem altera a entrada', () => {
    const input = doc([rect('a', { metadata: { 'app:list': [1] } })], {
      metadata: { 'app:title': 'x' },
    });
    const copy = structuredClone(input);

    const result = validateDocument(input);
    (input['nodes'] as Record<string, Record<string, unknown>>)['a']!['x'] = 999;
    (input['metadata'] as Record<string, unknown>)['app:title'] = 'mudou';

    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.value.nodes['a']).toMatchObject({ x: 0 });
    expect(result.value.metadata).toEqual({ 'app:title': 'x' });
    expect(copy).not.toEqual(input);
  });

  it.each(fixtures('valid'))('aceita a fixture $name', ({ document }) => {
    const result = validateDocument(document);

    if (!result.ok) throw new Error(`esperava sucesso: ${JSON.stringify(result.error.details)}`);
    expect(JSON.parse(JSON.stringify(result.value))).toEqual(document);
  });

  it.each(fixtures('invalid'))('recusa a fixture $name', ({ document, expected }) => {
    const result = validateDocument(document);

    if (result.ok) throw new Error('esperava erro');
    expect(result.error.code).toBe(expected?.code);
    if (expected?.issues !== undefined)
      expect(result.error.details).toMatchObject({ issues: expected.issues });
    if (expected?.details !== undefined) expect(result.error.details).toEqual(expected.details);
  });

  it.each([
    ['um texto', 'documento', [], 'type'],
    ['null', null, [], 'type'],
    ['um array', [], [], 'type'],
    [
      'versão ausente',
      { id: 'doc', nodes: {}, layers: [layer('l1', [])] },
      ['schemaVersion'],
      'type',
    ],
    ['versão fracionária', doc([], { schemaVersion: 1.5 }), ['schemaVersion'], 'type'],
    ['versão zero', doc([], { schemaVersion: 0 }), ['schemaVersion'], 'type'],
    ['versão em texto', doc([], { schemaVersion: '1' }), ['schemaVersion'], 'type'],
    ['campo desconhecido no documento', doc([], { selection: [] }), ['selection'], 'unknown-field'],
    ['ID de documento vazio', doc([], { id: '' }), ['id'], 'type'],
    ['ID de documento reservado', doc([], { id: '__proto__' }), ['id'], 'reserved-id'],
    ['nodes que é array', doc([], { nodes: [] }), ['nodes'], 'type'],
    [
      'nodes ausente',
      { schemaVersion: 1, id: 'doc', layers: [layer('l1', [])] },
      ['nodes'],
      'type',
    ],
    [
      'nó nulo',
      doc([], { nodes: { a: null }, layers: [layer('l1', ['a'])] }),
      ['nodes', 'a'],
      'type',
    ],
    [
      'nó que é uma lista',
      doc([], { nodes: { a: [] }, layers: [layer('l1', ['a'])] }),
      ['nodes', 'a'],
      'type',
    ],
    [
      'nó que não é objeto',
      doc([], { nodes: { a: 'x' }, layers: [layer('l1', ['a'])] }),
      ['nodes', 'a'],
      'type',
    ],
    [
      'nó sob a chave reservada',
      doc([], { nodes: JSON.parse('{"__proto__":{}}') as unknown }),
      ['nodes', '__proto__'],
      'reserved-id',
    ],
    ['nó com o ID do documento', doc([rect('doc')]), ['nodes', 'doc', 'id'], 'duplicate-id'],
    [
      'nó sem um campo obrigatório',
      doc([rect('a', { visible: undefined })]),
      ['nodes', 'a', 'visible'],
      'type',
    ],
    ['nó sem estilo', doc([rect('a', { style: undefined })]), ['nodes', 'a', 'style'], 'type'],
    [
      'nó com coordenada não finita',
      doc([rect('a', { y: Number.NaN })]),
      ['nodes', 'a', 'y'],
      'finite',
    ],
    [
      'nó com opacidade fora da faixa',
      doc([rect('a', { style: { ...STYLE, opacity: 2 } })]),
      ['nodes', 'a', 'style', 'opacity'],
      'range',
    ],
    [
      'nó com cor fora do formato',
      doc([rect('a', { style: { ...STYLE, fill: 'red' } })]),
      ['nodes', 'a', 'style', 'fill'],
      'format',
    ],
    [
      'linha com preenchimento',
      doc([
        {
          id: 'l',
          type: 'line',
          start: { x: 0, y: 0 },
          end: { x: 1, y: 1 },
          visible: true,
          locked: false,
          style: { ...STYLE },
        },
      ]),
      ['nodes', 'l', 'style', 'fill'],
      'unknown-field',
    ],
    [
      'metadata de nó que não é JSON',
      doc([rect('a', { metadata: { when: new Date(0) } })]),
      ['nodes', 'a', 'metadata', 'when'],
      'type',
    ],
    ['metadata de documento inválido', doc([], { metadata: 'x' }), ['metadata'], 'type'],
    ['layers que não é array', doc([], { layers: {} }), ['layers'], 'type'],
    ['camada que não é objeto', doc([], { layers: [null] }), ['layers', 0], 'type'],
    [
      'camada sem nome',
      doc([], { layers: [layer('l1', [], { name: undefined })] }),
      ['layers', 0, 'name'],
      'type',
    ],
    [
      'camada com campo desconhecido',
      doc([], { layers: [layer('l1', [], { opacity: 1 })] }),
      ['layers', 0, 'opacity'],
      'unknown-field',
    ],
    [
      'camada com o ID do documento',
      doc([], { layers: [layer('doc', [])] }),
      ['layers', 0, 'id'],
      'duplicate-id',
    ],
    [
      'camada com ID reservado',
      doc([], { layers: [layer('__proto__', [])] }),
      ['layers', 0, 'id'],
      'reserved-id',
    ],
    [
      'childIds que não é array',
      doc([], { layers: [layer('l1', 'a')] }),
      ['layers', 0, 'childIds'],
      'type',
    ],
    [
      'childIds com item que não é texto',
      doc([], { layers: [layer('l1', [7])] }),
      ['layers', 0, 'childIds', 0],
      'type',
    ],
    [
      'nó citado duas vezes na mesma camada',
      doc([rect('a')], { layers: [layer('l1', ['a', 'a'])] }),
      ['layers', 0, 'childIds', 1],
      'multiple-parents',
    ],
    [
      'metadata de camada inválido',
      doc([], { layers: [layer('l1', [], { metadata: 1 })] }),
      ['layers', 0, 'metadata'],
      'type',
    ],
  ])('recusa %s', (_label, input, path, rule) => {
    expectIssue(input, path, rule);
  });

  it('recusa metadata que contém a si mesmo, sem estourar a pilha', () => {
    const loop: Record<string, unknown> = {};
    loop['self'] = loop;

    expectIssue(
      doc([rect('a', { metadata: { loop } })]),
      ['nodes', 'a', 'metadata', 'loop', 'self'],
      'type',
    );
  });

  it('recusa documento que contém a si mesmo', () => {
    const input = doc([]);
    (input['nodes'] as Record<string, unknown>)['eu'] = input;
    (input['layers'] as unknown[]).push(input['layers']);

    const result = validateDocument(input);

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('devolve UNSUPPORTED_VERSION para versão futura, antes de olhar o resto', () => {
    const result = validateDocument({ schemaVersion: 7, tudo: 'diferente' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNSUPPORTED_VERSION',
        message: expect.any(String),
        details: { found: 7, supported: 1 },
      },
    });
  });

  it.each(['constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
    'recusa como referência quebrada o filho %s, nome que todo objeto herda',
    (name) => {
      expectIssue(
        doc([], { layers: [layer('l1', [name])] }),
        ['layers', 0, 'childIds', 0],
        'broken-reference',
      );
    },
  );

  it.each([
    ['a si mesma', [layer('l1', ['l1'])], ['layers', 0, 'childIds', 0]],
    ['outra camada', [layer('l1', []), layer('l2', ['l1'])], ['layers', 1, 'childIds', 0]],
    ['o documento', [layer('l1', ['doc'])], ['layers', 0, 'childIds', 0]],
  ])(
    'recusa a camada que cita %s como filho: é o ciclo possível neste schema',
    (_l, layers, path) => {
      // A única hierarquia do schema 1 é camada → nó: só um nó pode ser filho.
      expectIssue(doc([], { layers }), path, 'broken-reference');
    },
  );

  it.each([
    ['Map', new Map([['a', rect('a')]])],
    ['Set', new Set([rect('a')])],
    ['Date', new Date(0)],
  ])('recusa nodes que é %s, em vez de carregar um documento sem nós', (_label, nodes) => {
    const section = createCanvasSection({ generateId: counter() });
    const before = section.getSnapshot();
    const input = doc([], { nodes });

    expectIssue(input, ['nodes'], 'type');
    expect(section.replaceDocument(input).ok).toBe(false);
    expect(section.getSnapshot()).toBe(before);
  });

  it('não relata como repetido o ID que já foi recusado por não ser texto', () => {
    const result = validateDocument(
      doc([], { id: 5, layers: [layer(1 as unknown as string, []), layer('', [])] }),
    );

    if (result.ok || result.error.code !== 'VALIDATION_ERROR') throw new Error('esperava erro');
    expect(result.error.details.issues.map(({ path, rule }) => ({ path, rule }))).toEqual([
      { path: ['id'], rule: 'type' },
      { path: ['layers', 0, 'id'], rule: 'type' },
      { path: ['layers', 1, 'id'], rule: 'type' },
    ]);
  });

  it('não cita de novo, como referência quebrada, o nó que já foi recusado', () => {
    expectIssue(doc([rect('a', { width: 0 })]), ['nodes', 'a', 'width'], 'range');
  });

  it('não confere a chave nem o ID do documento em um nó cujo ID já foi recusado', () => {
    const input = doc([], { nodes: { a: rect('a', { id: 5 }) }, layers: [layer('l1', ['a'])] });

    expectIssue(input, ['nodes', 'a', 'id'], 'type');
  });

  it('para de juntar problemas depois de cem', () => {
    const nodes = Array.from({ length: 500 }, (_unused, index) => rect(`n${index}`, { width: 0 }));

    const result = validateDocument(doc(nodes));

    if (result.ok || result.error.code !== 'VALIDATION_ERROR') throw new Error('esperava erro');
    expect(result.error.details.issues).toHaveLength(100);
  });

  it('para também nas camadas e nas referências quando os problemas passam de cem', () => {
    const many = Array.from({ length: 150 }, () => null);

    const layersResult = validateDocument(doc([], { layers: many }));
    const childrenResult = validateDocument(doc([], { layers: [layer('l1', many)] }));
    const orphans = Object.fromEntries(
      Array.from({ length: 150 }, (_unused, index) => [`n${index}`, rect(`n${index}`)]),
    );
    const orphansResult = validateDocument(doc([], { nodes: orphans }));

    for (const result of [layersResult, childrenResult, orphansResult]) {
      if (result.ok || result.error.code !== 'VALIDATION_ERROR') throw new Error('esperava erro');
      expect(result.error.details.issues).toHaveLength(100);
    }
  });

  it.each([
    [
      'um nó com milhares de campos desconhecidos',
      () =>
        doc([rect('a', Object.fromEntries(Array.from({ length: 5000 }, (_u, i) => [`k${i}`, i])))]),
    ],
    [
      'metadata com milhares de valores inválidos',
      () =>
        doc([], {
          metadata: Object.fromEntries(
            Array.from({ length: 5000 }, (_u, i) => [`k${i}`, undefined]),
          ),
        }),
    ],
    [
      'nós com mais de um problema cada',
      () =>
        doc(Array.from({ length: 500 }, (_u, i) => rect(`n${i}`, { width: 0, height: 0, x: 'x' }))),
    ],
  ])('o teto de cem problemas vale para %s', (_label, input) => {
    const result = validateDocument(input());

    if (result.ok || result.error.code !== 'VALIDATION_ERROR') throw new Error('esperava erro');
    expect(result.error.details.issues).toHaveLength(100);
    expect(result.error.message).toMatch(/\(and 97 more\)$/);
  });

  it.each([
    ['camadas', (list: unknown[]) => doc([], { layers: list })],
    ['IDs de uma camada', (list: unknown[]) => doc([], { layers: [layer('l1', list)] })],
    ['metadata', (list: unknown[]) => doc([], { metadata: { list } })],
  ])(
    'para de ler a lista de %s no teto de problemas, sem copiar o comprimento dela',
    (_label, input) => {
      // Um array esparso pode ter `length` de bilhões e caber em poucos bytes: copiá-lo antes
      // de conferir custaria memória que a entrada não ocupa. A posição 500 denuncia quem a lê.
      const list = new Array<unknown>(100_000);
      let read = false;
      Object.defineProperty(list, 500, {
        get: () => {
          read = true;
          return undefined;
        },
      });

      const result = validateDocument(input(list));

      if (result.ok || result.error.code !== 'VALIDATION_ERROR') throw new Error('esperava erro');
      expect(result.error.details.issues).toHaveLength(100);
      expect(read).toBe(false);
    },
  );

  it('recusa como referência quebrada o nó citado que a lista de chaves de nodes não traz', () => {
    // Própria, mas não enumerável: Object.hasOwn a enxerga, Object.keys não.
    const hidden = { real: rect('real') };
    Object.defineProperty(hidden, 'ghost', { value: rect('ghost'), enumerable: false });
    // Proxy que responde por uma chave que não lista.
    const lying = new Proxy<Record<string, unknown>>(
      { real: rect('real') },
      {
        getOwnPropertyDescriptor: (target, key) =>
          key === 'ghost'
            ? { value: rect('ghost'), enumerable: true, configurable: true, writable: true }
            : Reflect.getOwnPropertyDescriptor(target, key),
      },
    );

    for (const nodes of [hidden, lying]) {
      const asChild = doc([], { nodes, layers: [layer('l1', ['ghost', 'real'])] });
      const asLayer = doc([], { nodes, layers: [layer('ghost', ['real'])] });

      expectIssue(asChild, ['layers', 0, 'childIds', 0], 'broken-reference');
      expect(validateDocument(asLayer).ok).toBe(true);
    }
  });

  it('aceita metadata de outro contexto de execução, e continua recusando o que não é JSON', () => {
    // Objeto criado em outra janela, iframe ou contexto de vm tem outro Object.prototype.
    const foreign = (source: string): unknown => runInNewContext(source);
    const metadata = '{ "app": { "tags": ["a", { "n": 1 }] } }';

    const accepted = validateDocument(doc([], { metadata: foreign(`JSON.parse('${metadata}')`) }));

    expect(accepted).toMatchObject({ ok: true, value: { metadata: JSON.parse(metadata) } });
    for (const source of ['new Date(0)', 'new Map()', 'new (class Tag { name = "x" })()']) {
      expectIssue(doc([], { metadata: foreign(source) }), ['metadata'], 'type');
      expectIssue(doc([], { metadata: { inner: foreign(source) } }), ['metadata', 'inner'], 'type');
    }
  });

  it('aceita metadata com até 100.000 valores e recusa acima disso', () => {
    // O objeto e a lista contam como valores: 2 + 99.998 = 100.000.
    const atLimit = { list: Array.from({ length: 99_998 }, (_unused, index) => index + 1) };
    const beyond = { list: [...atLimit.list, 99_999] };

    expect(validateDocument(doc([], { metadata: atLimit }))).toMatchObject({
      ok: true,
      value: { metadata: atLimit },
    });
    expectIssue(doc([], { metadata: beyond }), ['metadata'], 'range');
  });

  it('recusa metadata que repete o mesmo objeto até passar do máximo de valores', () => {
    // 25 objetos; cada nível cita duas vezes o de baixo, e copiar tudo seriam 2^24 cópias.
    let shared: unknown = 1;
    for (let level = 0; level < 24; level += 1) shared = { a: shared, b: shared };

    expectIssue(doc([], { metadata: { root: shared } }), ['metadata'], 'range');
  });

  it('copia uma só vez o mesmo metadata citado por vários nós', () => {
    const shared = { list: Array.from({ length: 49_000 }, (_unused, index) => index) };
    const nodes = Array.from({ length: 100 }, (_unused, index) =>
      rect(`n${index}`, { metadata: shared }),
    );

    const result = validateDocument(doc(nodes));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copies = Object.values(result.value.nodes).map((node) => node.metadata);
    expect(copies[0]).toEqual(shared);
    expect(copies[0]).not.toBe(shared);
    expect(new Set(copies).size).toBe(1);
    expect(Object.isFrozen(copies[0])).toBe(true);
    expect(Object.isFrozen(shared)).toBe(false);
  });

  it('não compartilha a cópia entre validações diferentes', () => {
    const shared = { tag: 'x' };

    const first = validateDocument(doc([rect('a', { metadata: shared })]));
    const second = validateDocument(doc([rect('a', { metadata: shared })]));

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.nodes['a']?.metadata).not.toBe(second.value.nodes['a']?.metadata);
  });

  it('continua apontando o problema de um metadata inválido em cada nó que o cita', () => {
    const invalid = { when: new Date(0) };
    const input = doc([rect('a', { metadata: invalid }), rect('b', { metadata: invalid })]);

    const result = validateDocument(input);

    expect(result).toMatchObject({
      ok: false,
      error: {
        details: {
          issues: [
            { path: ['nodes', 'a', 'metadata', 'when'], rule: 'type' },
            { path: ['nodes', 'b', 'metadata', 'when'], rule: 'type' },
          ],
        },
      },
    });
  });

  it('aceita um documento grande', () => {
    const nodes = Array.from({ length: 5000 }, (_unused, index) => rect(`n${index}`, { x: index }));

    const result = validateDocument(doc(nodes));

    expect(result.ok && Object.keys(result.value.nodes).length).toBe(5000);
  });
});

describe('limites padrão', () => {
  it('são exportados congelados: ninguém sobe o teto de todos os canvas', () => {
    expect(DEFAULT_LIMITS).toEqual({ maxNodes: 100_000, maxCoordinate: 10_000_000 });
    expect(Object.isFrozen(DEFAULT_LIMITS)).toBe(true);
  });
});

describe('limites na validação', () => {
  it('aceita coordenada no limite de 10 milhões e recusa além dele', () => {
    const atLimit = validateDocument(doc([rect('a', { x: -10_000_000, width: 10_000_000 })]));
    const beyond = validateDocument(
      doc([rect('a', { x: 5 }), rect('b', { height: 10_000_000.5 })]),
    );
    const line = validateDocument(
      doc([
        {
          id: 'l',
          type: 'line',
          start: { x: 0, y: 0 },
          end: { x: 0, y: -2e7 },
          visible: true,
          locked: false,
          style: { stroke: null, strokeWidth: 0, opacity: 1 },
        },
      ]),
    );

    expect(atLimit.ok).toBe(true);
    expect(beyond).toEqual({
      ok: false,
      error: {
        code: 'LIMIT_EXCEEDED',
        message: expect.any(String),
        details: { limit: 'coordinate', max: 10_000_000, actual: 10_000_000.5 },
      },
    });
    expect(line).toMatchObject({
      ok: false,
      error: { details: { limit: 'coordinate', actual: 2e7 } },
    });
  });

  it('aplica limites menores dados nas opções', () => {
    const input = doc([rect('a'), rect('b', { x: 600 }), rect('c')]);

    expect(validateDocument(input, { limits: { maxNodes: 3, maxCoordinate: 600 } }).ok).toBe(true);
    expect(validateDocument(input, { limits: { maxNodes: 2 } })).toMatchObject({
      ok: false,
      error: { code: 'LIMIT_EXCEEDED', details: { limit: 'nodes', max: 2, actual: 3 } },
    });
    expect(validateDocument(input, { limits: { maxCoordinate: 599 } })).toMatchObject({
      ok: false,
      error: { code: 'LIMIT_EXCEEDED', details: { limit: 'coordinate', max: 599, actual: 600 } },
    });
  });

  it('relata o erro de validação antes do de limite de coordenada', () => {
    const result = validateDocument(doc([rect('a', { x: 2e7 }), rect('b', { width: 0 })]));

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it.each([
    [{ maxNodes: 0 }],
    [{ maxNodes: 1.5 }],
    [{ maxNodes: 100_001 }],
    [{ maxNodes: Number.NaN }],
    [{ maxCoordinate: 0 }],
    [{ maxCoordinate: -1 }],
    [{ maxCoordinate: 10_000_001 }],
    [{ maxCoordinate: Number.NaN }],
  ])('lança RangeError para o limite inválido %j', (limits) => {
    expect(() => validateDocument(doc([]), { limits })).toThrow(RangeError);
    expect(() => createCanvasSection({ limits })).toThrow(RangeError);
  });

  it.each([['5'], [true], [[7]], [' 12 '], [{ valueOf: () => 5 }]])(
    'lança RangeError para maxCoordinate que não é número: %j',
    (maxCoordinate) => {
      const limits = { maxCoordinate } as unknown as CanvasLimits;

      expect(() => validateDocument(doc([]), { limits })).toThrow(RangeError);
      expect(() => createCanvasSection({ limits })).toThrow(RangeError);
    },
  );

  it.each([['x'], [[]], [7], [null]])(
    'lança TypeError para limits que não é objeto: %j',
    (given) => {
      const limits = given as unknown as CanvasLimits;

      expect(() => validateDocument(doc([]), { limits })).toThrow(
        new TypeError('limits must be an object'),
      );
      expect(() => createCanvasSection({ limits })).toThrow(
        new TypeError('limits must be an object'),
      );
    },
  );

  it('conta a largura do traço como dimensão: no limite passa, além dele é recusada', () => {
    const wide = (strokeWidth: number): Record<string, unknown> =>
      rect('a', { rotation: Math.PI / 4, style: { ...STYLE, strokeWidth } });
    const line = {
      id: 'l',
      type: 'line',
      start: { x: 0, y: 0 },
      end: { x: 5, y: 5 },
      visible: true,
      locked: false,
      style: { stroke: null, strokeWidth: 1e9, opacity: 1 },
    };

    expect(validateDocument(doc([wide(10_000_000)])).ok).toBe(true);
    expect(validateDocument(doc([wide(1.7e308)]))).toMatchObject({
      ok: false,
      error: {
        code: 'LIMIT_EXCEEDED',
        details: { limit: 'coordinate', max: 10_000_000, actual: 1.7e308 },
      },
    });
    expect(validateDocument(doc([line]))).toMatchObject({
      ok: false,
      error: { code: 'LIMIT_EXCEEDED', details: { limit: 'coordinate', actual: 1e9 } },
    });
  });
});

describe('replaceDocument', () => {
  const RECT = { type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 } as const;

  function create(id: string, x = 0): CanvasCommand {
    return { type: 'shape.create', shape: { ...RECT, id, x } };
  }

  /** Canvas com histórico, redo, seleção, viewport, ferramenta e preview. */
  function busySection(): CanvasSectionApi {
    const section = createCanvasSection({ generateId: counter() });
    section.dispatch(create('velho'));
    section.dispatch(create('outro', 50));
    section.dispatch({ type: 'shape.update', id: 'velho', patch: { y: 5 } });
    section.undo();
    section.setSelection(['velho']);
    section.setViewport({ x: 10, y: 20, zoom: 2 });
    section.setTool('hand');
    section.setPreview({
      updates: [{ ...RECT, id: 'velho', x: 900 }],
      marquee: { x: 0, y: 0, width: 1, height: 1 },
    });
    return section;
  }

  const NEW_DOCUMENT = doc([rect('novo', { x: 300 })]);

  it('substitui o documento, limpa histórico, seleção e preview, mantém o viewport e avança a revisão', () => {
    const section = busySection();
    const before = section.getSnapshot();
    const changes: CanvasChange[] = [];
    section.subscribe((change) => changes.push(change));

    const result = section.replaceDocument(NEW_DOCUMENT);

    const after = section.getSnapshot();
    expect(result).toEqual({ ok: true, value: undefined });
    expect(JSON.parse(JSON.stringify(after.document))).toEqual(NEW_DOCUMENT);
    expect(Object.isFrozen(after.document)).toBe(true);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.history).toEqual({ canUndo: false, canRedo: false });
    expect(after.session).toEqual({
      selectedIds: [],
      viewport: { x: 10, y: 20, zoom: 2 },
      activeTool: 'hand',
      readOnly: false,
    });
    expect(after.session.viewport).toBe(before.session.viewport);
    expect(section.getPreview()).toBeNull();
    expect(changes).toEqual([
      {
        snapshot: after,
        origin: 'load',
        areas: ['document', 'selection', 'history', 'preview'],
        affectedIds: [],
      },
    ]);
    expect(section.undo()).toMatchObject({ ok: true, value: { changed: false } });
    expect(section.redo()).toMatchObject({ ok: true, value: { changed: false } });
    expect(Object.keys(before.document.nodes)).toEqual(['velho', 'outro']);
  });

  it('só cita nas áreas o que de fato mudou', () => {
    const section = createCanvasSection({ generateId: counter() });
    const listener = vi.fn();
    section.subscribe(listener);

    section.replaceDocument(NEW_DOCUMENT);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'load', areas: ['document'] }),
    );
    expect(section.getSnapshot().revision).toBe(1);
  });

  it('refaz as consultas e a posição dos nós sobre o documento novo', () => {
    const section = busySection();

    section.replaceDocument(doc([rect('novo', { x: 300 }), rect('acima', { x: 300 })]));

    const without = { includePreview: false };
    expect(section.hitTest({ x: 5, y: 5 }, without)).toBeUndefined();
    expect(section.hitTest({ x: 55, y: 5 }, without)).toBeUndefined();
    expect(section.hitTestAll({ x: 305, y: 5 }, without)).toEqual(['acima', 'novo']);
    expect(section.queryBounds({ x: -1e6, y: -1e6, width: 2e6, height: 2e6 }, without)).toEqual([
      'novo',
      'acima',
    ]);
    // O índice refeito na carga guarda a caixa com o traço: meio ponto além da geometria.
    expect(section.queryBounds({ x: 299.6, y: 2, width: 0.2, height: 0.2 }, without)).toEqual([
      'novo',
      'acima',
    ]);
    expect(section.queryBounds({ x: 299.2, y: 2, width: 0.2, height: 0.2 }, without)).toEqual([]);
    expect(section.getNodeInfo('acima')).toEqual({
      layerId: 'l1',
      index: 1,
      visible: true,
      locked: false,
    });
    expect(section.getNodeInfo('velho')).toBeUndefined();
  });

  it('deixa o canvas editável sobre o documento novo, com o histórico recomeçando', () => {
    const section = busySection();
    section.replaceDocument(NEW_DOCUMENT);

    const duplicate = section.dispatch(create('novo'));
    const created = section.dispatch(create('velho'));
    const moved = section.dispatch({ type: 'shape.update', id: 'novo', patch: { x: 1 } });

    expect(duplicate).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(created.ok).toBe(true);
    expect(moved.ok).toBe(true);
    expect(section.getSnapshot().document.layers[0]?.childIds).toEqual(['novo', 'velho']);
    expect(section.undo().ok && section.undo().ok).toBe(true);
    expect(section.undo()).toMatchObject({ ok: true, value: { changed: false } });
    expect(JSON.parse(JSON.stringify(section.getSnapshot().document))).toEqual(NEW_DOCUMENT);
  });

  it('aceita o documento de outro canvas e não fica ligado a ele', () => {
    const source = createCanvasSection({ generateId: counter() });
    source.dispatch(create('a'));
    const target = createCanvasSection();

    expect(target.replaceDocument(source.getSnapshot().document).ok).toBe(true);
    source.dispatch({ type: 'shape.update', id: 'a', patch: { x: 77 } });

    expect(target.getSnapshot().document.nodes['a']).toMatchObject({ x: 0 });
    expect(target.getSnapshot().document.nodes['a']).not.toBe(
      source.getSnapshot().document.nodes['a'],
    );
  });

  it('restaura o viewport dado na opção, no mesmo evento', () => {
    const section = busySection();
    const listener = vi.fn();
    section.subscribe(listener);

    const result = section.replaceDocument(NEW_DOCUMENT, { viewport: { x: -5, y: -6, zoom: 40 } });

    expect(result.ok).toBe(true);
    expect(section.getSnapshot().session).toEqual({
      selectedIds: [],
      viewport: { x: -5, y: -6, zoom: 16 },
      activeTool: 'hand',
      readOnly: false,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        areas: ['document', 'selection', 'viewport', 'history', 'preview'],
      }),
    );
  });

  it('com o viewport que já está em vigor, não cita a área nem troca a referência dele', () => {
    const section = createCanvasSection({ generateId: counter() });
    section.setViewport({ x: 10, y: 20, zoom: 2 });
    const viewport = section.getSnapshot().session.viewport;
    const changes: CanvasChange[] = [];
    section.subscribe((change) => changes.push(change));

    const loaded = section.replaceDocument(NEW_DOCUMENT, { viewport: { x: 10, y: 20, zoom: 2 } });

    expect(loaded.ok).toBe(true);
    expect(changes.map((change) => change.areas)).toEqual([['document']]);
    expect(section.getSnapshot().session.viewport).toBe(viewport);
  });

  it('mantém o viewport quando as opções não trazem um', () => {
    const section = busySection();

    expect(section.replaceDocument(NEW_DOCUMENT, {}).ok).toBe(true);
    expect(section.replaceDocument(NEW_DOCUMENT, { viewport: undefined }).ok).toBe(true);
    expect(section.getSnapshot().session.viewport).toEqual({ x: 10, y: 20, zoom: 2 });
  });

  it.each([
    ['viewport inválido', { viewport: { x: 0, y: 0, zoom: 0 } }, ['viewport', 'zoom'], 'range'],
    ['viewport que não é objeto', { viewport: 3 }, ['viewport'], 'type'],
    ['opção desconhecida', { keepHistory: true }, ['keepHistory'], 'unknown-field'],
    ['opções que não são objeto', 'viewport', [], 'type'],
  ])('recusa %s nas opções, sem carregar nada', (_label, options, path, rule) => {
    const section = busySection();
    const before = section.getSnapshot();
    const replace = section.replaceDocument as (input: unknown, options: unknown) => unknown;

    const result = replace(NEW_DOCUMENT, options);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', details: { issues: [{ path, rule }] } },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it.each([
    ['referência quebrada', doc([], { layers: [layer('l1', ['sumido'])] }), 'VALIDATION_ERROR'],
    ['ID repetido', doc([], { layers: [layer('l1', []), layer('l1', [])] }), 'VALIDATION_ERROR'],
    [
      'nó em duas camadas',
      doc([rect('a')], { layers: [layer('l1', ['a']), layer('l2', ['a'])] }),
      'VALIDATION_ERROR',
    ],
    ['número não finito', doc([rect('a', { x: Number.POSITIVE_INFINITY })]), 'VALIDATION_ERROR'],
    ['versão futura', doc([], { schemaVersion: 2 }), 'UNSUPPORTED_VERSION'],
    ['coordenada além do limite', doc([rect('a', { x: 1e9 })]), 'LIMIT_EXCEEDED'],
    ['entrada que não é documento', 'documento.json', 'VALIDATION_ERROR'],
  ])('com %s, devolve erro tipado e mantém tudo como estava (CORE-08)', (_label, input, code) => {
    const section = busySection();
    const before = section.getSnapshot();
    const preview = section.getPreview();
    const listener = vi.fn();
    section.subscribe(listener);

    const result = section.replaceDocument(input);

    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(section.getSnapshot()).toBe(before);
    expect(section.getPreview()).toBe(preview);
    expect(listener).not.toHaveBeenCalled();
    expect(section.hitTest({ x: 55, y: 5 }, { includePreview: false })).toBe('outro');
    expect(section.redo()).toMatchObject({ ok: true, value: { changed: true } });
  });

  it('aplica os limites do canvas', () => {
    const section = createCanvasSection({ limits: { maxNodes: 1, maxCoordinate: 1000 } });
    const before = section.getSnapshot();

    const tooMany = section.replaceDocument(doc([rect('a'), rect('b')]));
    const tooFar = section.replaceDocument(doc([rect('a', { x: 1001 })]));
    const fits = section.replaceDocument(doc([rect('a', { x: 1000 })]));

    expect(tooMany).toMatchObject({
      ok: false,
      error: { code: 'LIMIT_EXCEEDED', details: { limit: 'nodes', max: 1, actual: 2 } },
    });
    expect(tooFar).toMatchObject({
      ok: false,
      error: { code: 'LIMIT_EXCEEDED', details: { limit: 'coordinate', max: 1000, actual: 1001 } },
    });
    expect(fits.ok).toBe(true);
    expect(section.getSnapshot()).not.toBe(before);
  });

  it('vale em modo somente leitura e não o desliga', () => {
    const section = busySection();
    section.setReadOnly(true);

    expect(section.replaceDocument(NEW_DOCUMENT).ok).toBe(true);
    expect(section.getSnapshot().session.readOnly).toBe(true);
    expect(section.dispatch(create('x'))).toMatchObject({
      ok: false,
      error: { code: 'READ_ONLY' },
    });
  });

  it('devolve REENTRANT_DISPATCH quando chamado de dentro de um listener', () => {
    const section = busySection();
    const inner: unknown[] = [];
    const unsubscribe = section.subscribe(() => inner.push(section.replaceDocument(NEW_DOCUMENT)));

    section.setTool('select');
    unsubscribe();

    expect(inner).toEqual([
      { ok: false, error: expect.objectContaining({ code: 'REENTRANT_DISPATCH' }) },
    ]);
    expect(Object.keys(section.getSnapshot().document.nodes)).toEqual(['velho', 'outro']);
  });

  it('passa pela admissão do commit, com origem load e sem patch', () => {
    const refusal = validationError([{ path: [], rule: 'range', message: 'refused by the gate' }]);
    const candidates: CommitCandidate[] = [];
    let open = true;
    const section = createCanvasSectionWith({ generateId: counter() }, (candidate) => {
      candidates.push(candidate);
      return open ? undefined : refusal;
    });
    section.dispatch(create('velho'));
    const before = section.getSnapshot();

    open = false;
    const refused = section.replaceDocument(NEW_DOCUMENT);
    open = true;
    const accepted = section.replaceDocument(NEW_DOCUMENT);

    expect(refused).toEqual({ ok: false, error: refusal });
    expect(accepted.ok).toBe(true);
    expect(candidates.map((candidate) => candidate.origin)).toEqual(['local', 'load', 'load']);
    expect(candidates[1]?.patch).toBeUndefined();
    expect(candidates[1]?.before).toBe(before.document);
    expect((candidates[1]?.after as CanvasDocument).nodes['novo']).toMatchObject({ x: 300 });
    expect(section.getSnapshot().revision).toBe(before.revision + 1);
  });

  it('recusado na admissão, deixa o histórico como estava', () => {
    const refusal = validationError([{ path: [], rule: 'range', message: 'refused by the gate' }]);
    const section = createCanvasSectionWith({ generateId: counter() }, ({ origin }) =>
      origin === 'load' ? refusal : undefined,
    );
    section.dispatch(create('velho'));
    const before = section.getSnapshot();

    expect(section.replaceDocument(NEW_DOCUMENT)).toEqual({ ok: false, error: refusal });

    expect(section.getSnapshot()).toBe(before);
    expect(section.undo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(Object.keys(section.getSnapshot().document.nodes)).toEqual([]);
  });

  it('entrega congelado o evento da carga', () => {
    const section = busySection();
    const changes: CanvasChange[] = [];
    section.subscribe((change) => changes.push(change));

    section.replaceDocument(NEW_DOCUMENT);

    expect(changes).toHaveLength(1);
    expect(Object.isFrozen(changes[0])).toBe(true);
    expect(Object.isFrozen(changes[0]?.areas)).toBe(true);
    expect(Object.isFrozen(changes[0]?.affectedIds)).toBe(true);
  });

  it('funciona destacado do canvas', () => {
    const { replaceDocument, getSnapshot } = createCanvasSection();

    expect(replaceDocument(NEW_DOCUMENT).ok).toBe(true);
    expect(Object.keys(getSnapshot().document.nodes)).toEqual(['novo']);
  });
});

describe('limites nos comandos', () => {
  const RECT = { type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 } as const;

  it('recusa criar além do máximo de nós, inclusive no meio de uma transação', () => {
    const section = createCanvasSection({ generateId: counter(), limits: { maxNodes: 2 } });
    section.dispatch({ type: 'shape.create', shape: { ...RECT, id: 'a' } });
    const before = section.getSnapshot();

    const result = section.transact([
      { type: 'shape.create', shape: { ...RECT, id: 'b' } },
      { type: 'shape.create', shape: { ...RECT, id: 'c' } },
    ]);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'LIMIT_EXCEEDED',
        message: expect.any(String),
        details: { limit: 'nodes', max: 2, actual: 3, commandIndex: 1 },
      },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it('conta os nós removidos na mesma transação como vaga', () => {
    const section = createCanvasSection({ generateId: counter(), limits: { maxNodes: 2 } });
    section.transact([
      { type: 'shape.create', shape: { ...RECT, id: 'a' } },
      { type: 'shape.create', shape: { ...RECT, id: 'b' } },
    ]);

    const result = section.transact([
      { type: 'shape.remove', id: 'a' },
      { type: 'shape.create', shape: { ...RECT, id: 'c' } },
    ]);

    expect(result.ok).toBe(true);
    expect(section.dispatch({ type: 'shape.create', shape: { ...RECT, id: 'd' } })).toMatchObject({
      ok: false,
      error: {
        code: 'LIMIT_EXCEEDED',
        details: { limit: 'nodes', max: 2, actual: 3, commandIndex: 0 },
      },
    });
  });

  it.each([
    [
      'criar com coordenada além do limite',
      { type: 'shape.create', shape: { ...RECT, x: 10_000_001 } },
      10_000_001,
    ],
    [
      'criar com dimensão além do limite',
      { type: 'shape.create', shape: { ...RECT, height: 2e7 } },
      2e7,
    ],
    [
      'criar linha com extremo além do limite',
      {
        type: 'shape.create',
        shape: { type: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: -10_000_000.5 } },
      },
      10_000_000.5,
    ],
    ['mover para além do limite', { type: 'shape.update', id: 'a', patch: { y: -3e7 } }, 3e7],
    [
      'criar com traço além do limite',
      { type: 'shape.create', shape: { ...RECT, style: { strokeWidth: 2e7 } } },
      2e7,
    ],
    [
      'alargar o traço além do limite',
      { type: 'shape.update', id: 'a', patch: { style: { strokeWidth: 1.7e308 } } },
      1.7e308,
    ],
  ] as const)('recusa %s', (_label, command, actual) => {
    const section = createCanvasSection({ generateId: counter() });
    section.dispatch({ type: 'shape.create', shape: { ...RECT, id: 'a' } });
    const before = section.getSnapshot();

    const result = section.dispatch(command);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'LIMIT_EXCEEDED',
        message: expect.any(String),
        details: { limit: 'coordinate', max: 10_000_000, actual, commandIndex: 0 },
      },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it.each([
    ['x do retângulo', { ...RECT, x: -100.5 }],
    ['y do retângulo', { ...RECT, y: 100.5 }],
    ['largura do retângulo', { ...RECT, width: 100.5 }],
    ['altura do retângulo', { ...RECT, height: 100.5 }],
    ['x do início da linha', { type: 'line', start: { x: -100.5, y: 0 }, end: { x: 1, y: 1 } }],
    ['y do início da linha', { type: 'line', start: { x: 0, y: 100.5 }, end: { x: 1, y: 1 } }],
    ['x do fim da linha', { type: 'line', start: { x: 0, y: 0 }, end: { x: 100.5, y: 1 } }],
    ['y do fim da linha', { type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: -100.5 } }],
  ] as const)('recusa %s além do limite, no comando e na carga', (_label, shape) => {
    const section = createCanvasSection({ generateId: counter(), limits: { maxCoordinate: 100 } });
    const refused = {
      ok: false,
      error: { code: 'LIMIT_EXCEEDED', details: { limit: 'coordinate', max: 100, actual: 100.5 } },
    };
    // O mesmo shape como um documento o guarda, vindo de um canvas sem o limite.
    const wide = createCanvasSection({ generateId: counter() });
    wide.dispatch({ type: 'shape.create', shape: { ...shape, id: 'n' } });
    const stored: unknown = JSON.parse(JSON.stringify(wide.getSnapshot().document));

    expect(section.dispatch({ type: 'shape.create', shape: { ...shape, id: 'n' } })).toMatchObject(
      refused,
    );
    expect(validateDocument(stored, { limits: { maxCoordinate: 100 } })).toMatchObject(refused);
    expect(section.replaceDocument(stored)).toMatchObject(refused);
    expect(section.getSnapshot().revision).toBe(0);
  });

  it('aceita coordenada exatamente no limite e aplica o limite menor do canvas', () => {
    const wide = createCanvasSection({ generateId: counter() });
    const narrow = createCanvasSection({ generateId: counter(), limits: { maxCoordinate: 100 } });

    expect(
      wide.dispatch({ type: 'shape.create', shape: { ...RECT, x: -10_000_000, width: 10_000_000 } })
        .ok,
    ).toBe(true);
    expect(narrow.dispatch({ type: 'shape.create', shape: { ...RECT, x: 100 } }).ok).toBe(true);
    expect(narrow.dispatch({ type: 'shape.create', shape: { ...RECT, x: 100.5 } })).toMatchObject({
      ok: false,
      error: { code: 'LIMIT_EXCEEDED', details: { limit: 'coordinate', max: 100, actual: 100.5 } },
    });
  });
});

describe('square document validation', () => {
  it('valida documento contendo nós square 1:1', () => {
    const input = doc([
      {
        id: 'sq-1',
        type: 'square',
        x: 10,
        y: 10,
        width: 50,
        height: 50,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    ]);
    const result = validateDocument(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes['sq-1']?.type).toBe('square');
  });

  it('rejeita documento com square onde width !== height', () => {
    const input = doc([
      {
        id: 'sq-bad',
        type: 'square',
        x: 10,
        y: 10,
        width: 50,
        height: 60,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    ]);
    const result = validateDocument(input);
    expect(result.ok).toBe(false);
    if (result.ok || result.error.code !== 'VALIDATION_ERROR') {
      throw new Error('esperava VALIDATION_ERROR');
    }
    expect(result.error.details.issues).toContainEqual(
      expect.objectContaining({
        rule: 'invalid-geometry',
        path: ['nodes', 'sq-bad'],
      }),
    );
  });
});

describe('circle document validation', () => {
  it('valida documento contendo nós circle 1:1 e rejeita onde width !== height', () => {
    const okDoc = doc([
      {
        id: 'ci-1',
        type: 'circle',
        x: 10,
        y: 10,
        width: 50,
        height: 50,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    ]);
    const okRes = validateDocument(okDoc);
    expect(okRes.ok).toBe(true);

    const badDoc = doc([
      {
        id: 'ci-bad',
        type: 'circle',
        x: 10,
        y: 10,
        width: 50,
        height: 60,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    ]);
    const badRes = validateDocument(badDoc);
    expect(badRes.ok).toBe(false);
    if (badRes.ok || badRes.error.code !== 'VALIDATION_ERROR') {
      throw new Error('esperava VALIDATION_ERROR');
    }
    expect(badRes.error.details.issues).toContainEqual(
      expect.objectContaining({
        rule: 'invalid-geometry',
        path: ['nodes', 'ci-bad'],
      }),
    );
  });
});

describe('documento armazenado com label (US-SL.13 e US-SL.3)', () => {
  const STORED_LABEL = {
    text: 'Olá',
    fontSize: 16,
    fontFamily: 'sans-serif',
    fontWeight: 'normal',
    color: null,
    textAlign: 'center',
    verticalAlign: 'middle',
  };
  const documentWith = (label: unknown): CanvasDocument => {
    const base = createCanvasSection({ generateId: counter() });
    base.dispatch({
      type: 'shape.create',
      shape: { id: 'r', type: 'rectangle', x: 0, y: 0, width: 100, height: 100, rotation: 0 },
    });
    const { document } = base.getSnapshot();
    const node = document.nodes['r']!;
    const withLabel = label === undefined ? node : { ...node, label };
    return { ...document, nodes: { ...document.nodes, r: withLabel } } as unknown as CanvasDocument;
  };

  it('aceita o documento com label completo e o sem label', () => {
    expect(validateDocument(documentWith(STORED_LABEL)).ok).toBe(true);
    expect(validateDocument(documentWith(undefined)).ok).toBe(true);
  });

  it('devolve uma cópia que mantém o label', () => {
    const res = validateDocument(documentWith(STORED_LABEL));

    expect(res.ok && res.value.nodes['r']).toMatchObject({ label: STORED_LABEL });
  });

  it.each([
    [
      'incompleto (sem verticalAlign)',
      { ...STORED_LABEL, verticalAlign: undefined },
      'verticalAlign',
    ],
    ['com cor inválida', { ...STORED_LABEL, color: 'azul' }, 'color'],
    ['com verticalAlign inválido', { ...STORED_LABEL, verticalAlign: 'baseline' }, 'verticalAlign'],
    ['com fontSize zero', { ...STORED_LABEL, fontSize: 0 }, 'fontSize'],
    ['com chave desconhecida', { ...STORED_LABEL, extra: 1 }, 'extra'],
  ])('recusa um label %s', (_name, label, key) => {
    const res = validateDocument(documentWith(label));

    expect(res).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(JSON.stringify(res)).toContain(`"label","${key}"`);
  });

  it('recusa um label que não é objeto', () => {
    expect(validateDocument(documentWith('texto'))).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR' },
    });
  });

  it('conta o texto do label no limite maxTextLength', () => {
    const res = validateDocument(documentWith({ ...STORED_LABEL, text: 'x'.repeat(11) }), {
      limits: { maxTextLength: 10 },
    });

    expect(res).toMatchObject({
      ok: false,
      error: { code: 'LIMIT_EXCEEDED', details: { limit: 'text', max: 10, actual: 11 } },
    });
  });
});

describe('limite do texto da forma nos comandos (US-SL.3)', () => {
  const limited = () =>
    createCanvasSection({ generateId: counter(), limits: { maxTextLength: 10 } });
  const BOX = { x: 0, y: 0, width: 100, height: 100, rotation: 0 } as const;

  it('shape.create com label acima do limite falha como o texto livre', () => {
    const section = limited();

    const res = section.dispatch({
      type: 'shape.create',
      shape: { id: 'r', type: 'rectangle', ...BOX, label: { text: 'x'.repeat(11) } },
    });

    expect(res).toMatchObject({
      ok: false,
      error: { code: 'LIMIT_EXCEEDED', details: { limit: 'text', max: 10, actual: 11 } },
    });
  });

  it('shape.update com label acima do limite falha, e o nó segue como estava', () => {
    const section = limited();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'r', type: 'rectangle', ...BOX, label: { text: 'ok' } },
    });

    const res = section.dispatch({
      type: 'shape.update',
      id: 'r',
      patch: { label: { text: 'x'.repeat(11) } },
    });

    expect(res).toMatchObject({ ok: false, error: { code: 'LIMIT_EXCEEDED' } });
    expect(section.getSnapshot().document.nodes['r']).toMatchObject({ label: { text: 'ok' } });
  });
});

describe('validateDocument com boards (spec boards, §3.4)', () => {
  function board(
    id: string,
    childIds: unknown = [],
    over: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id,
      type: 'board',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      title: 'Board',
      style: { fill: '#ffffff', fillOpacity: 1, stroke: '#d4d4d8' },
      childIds,
      visible: true,
      locked: false,
      ...over,
    };
  }

  /** Documento com o board `b` na camada e os nós dados soltos (fora da camada) para o teste listar. */
  function withBoard(
    nodes: Record<string, unknown>[],
    layerChildIds: string[],
    over: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      schemaVersion: 1,
      id: 'doc',
      nodes: Object.fromEntries(nodes.map((node) => [node['id'], node])),
      layers: [layer('l1', layerChildIds)],
      ...over,
    };
  }

  it('aceita o board com filhos, um grupo dentro dele e as listas vazias', () => {
    const input = withBoard(
      [
        board('b', ['r1', 'g']),
        rect('r1'),
        { id: 'g', type: 'group', childIds: ['m1', 'm2'], visible: true, locked: false },
        rect('m1'),
        rect('m2'),
        board('empty'),
      ],
      ['b', 'empty'],
    );

    const result = validateDocument(input);

    if (!result.ok) throw new Error(`esperava sucesso: ${JSON.stringify(result.error.details)}`);
    expect(result.value.nodes['b']).toMatchObject({ type: 'board', childIds: ['r1', 'g'] });
    expect(JSON.parse(JSON.stringify(result.value))).toEqual(input);
  });

  it('aceita fill e stroke nulos e metadata', () => {
    const input = withBoard(
      [
        board('b', [], {
          style: { fill: null, fillOpacity: 0, stroke: null },
          metadata: { 'app:k': 1 },
        }),
      ],
      ['b'],
    );

    expect(validateDocument(input).ok).toBe(true);
  });

  it('o documento produzido pelos comandos de board passa', () => {
    const section = createCanvasSection({ generateId: counter() });
    section.transact([
      {
        type: 'shape.create',
        shape: { id: 'b', type: 'board', x: 0, y: 0, width: 300, height: 200 },
      },
      {
        type: 'shape.create',
        shape: { id: 'r1', type: 'rectangle', x: 1, y: 1, width: 5, height: 5, rotation: 0 },
      },
      {
        type: 'shape.create',
        shape: { id: 'r2', type: 'rectangle', x: 9, y: 1, width: 5, height: 5, rotation: 0 },
      },
      { type: 'group.create', id: 'g', childIds: ['r1', 'r2'] },
      { type: 'board.attach', boardId: 'b', ids: ['g'] },
    ] as never);

    const result = validateDocument(JSON.parse(JSON.stringify(section.getSnapshot().document)));

    expect(result.ok).toBe(true);
  });

  it.each([
    [
      'board dentro de board',
      withBoard([board('a', ['c']), board('c')], ['a']),
      ['nodes', 'a', 'childIds', 0],
      'nested-board',
    ],
    [
      'board entre os membros de um grupo',
      withBoard(
        [
          { id: 'g', type: 'group', childIds: ['r', 'c'], visible: true, locked: false },
          rect('r'),
          board('c'),
        ],
        ['g'],
      ),
      ['nodes', 'g', 'childIds', 1],
      'board-in-group',
    ],
    [
      'filho inexistente',
      withBoard([board('a', ['nada'])], ['a']),
      ['nodes', 'a', 'childIds', 0],
      'broken-reference',
    ],
    [
      'board que cita a si mesmo',
      withBoard([board('a', ['a'])], ['a']),
      ['nodes', 'a', 'childIds', 0],
      'broken-reference',
    ],
    [
      'filho repetido',
      withBoard([board('a', ['r', 'r']), rect('r')], ['a']),
      ['nodes', 'a', 'childIds', 1],
      'duplicate-id',
    ],
    [
      'nó em dois boards',
      withBoard([board('a', ['r']), board('b2', ['r']), rect('r')], ['a', 'b2']),
      ['nodes', 'b2', 'childIds', 0],
      'multiple-parents',
    ],
    [
      'nó na camada e em um board',
      withBoard([board('a', ['r']), rect('r')], ['a', 'r']),
      ['layers', 0, 'childIds', 1],
      'multiple-parents',
    ],
    [
      'nó no board e em um grupo',
      withBoard(
        [
          board('a', ['r']),
          { id: 'g', type: 'group', childIds: ['r', 'q'], visible: true, locked: false },
          rect('r'),
          rect('q'),
        ],
        ['a', 'g'],
      ),
      ['nodes', 'g', 'childIds', 0],
      'multiple-parents',
    ],
    [
      'membro de grupo repetido no board',
      withBoard(
        [
          board('a', ['g', 'm']),
          { id: 'g', type: 'group', childIds: ['m', 'n'], visible: true, locked: false },
          rect('m'),
          rect('n'),
        ],
        ['a'],
      ),
      ['nodes', 'a', 'childIds', 1],
      'multiple-parents',
    ],
    [
      'nó que nenhum pai lista',
      withBoard([board('a'), rect('solto')], ['a']),
      ['nodes', 'solto'],
      'missing-parent',
    ],
    [
      'título vazio',
      withBoard([board('a', [], { title: '' })], ['a']),
      ['nodes', 'a', 'title'],
      'type',
    ],
    [
      'título que não é texto',
      withBoard([board('a', [], { title: 3 })], ['a']),
      ['nodes', 'a', 'title'],
      'type',
    ],
    [
      'título ausente',
      withBoard([board('a', [], { title: undefined })], ['a']),
      ['nodes', 'a', 'title'],
      'type',
    ],
    [
      'título com 201 caracteres',
      withBoard([board('a', [], { title: 'a'.repeat(201) })], ['a']),
      ['nodes', 'a', 'title'],
      'range',
    ],
    [
      'título com quebra de linha',
      withBoard([board('a', [], { title: 'a\nb' })], ['a']),
      ['nodes', 'a', 'title'],
      'format',
    ],
    [
      'título com tags HTML',
      withBoard([board('a', [], { title: '<i>x</i>' })], ['a']),
      ['nodes', 'a', 'title'],
      'format',
    ],
    [
      'fillOpacity acima de 1',
      withBoard(
        [board('a', [], { style: { fill: '#ffffff', fillOpacity: 2, stroke: null } })],
        ['a'],
      ),
      ['nodes', 'a', 'style', 'fillOpacity'],
      'range',
    ],
    [
      'fillOpacity negativa',
      withBoard(
        [board('a', [], { style: { fill: '#ffffff', fillOpacity: -1, stroke: null } })],
        ['a'],
      ),
      ['nodes', 'a', 'style', 'fillOpacity'],
      'range',
    ],
    [
      'largura zero',
      withBoard([board('a', [], { width: 0 })], ['a']),
      ['nodes', 'a', 'width'],
      'range',
    ],
    [
      'altura negativa',
      withBoard([board('a', [], { height: -1 })], ['a']),
      ['nodes', 'a', 'height'],
      'range',
    ],
    [
      'rotation no board',
      withBoard([board('a', [], { rotation: 0 })], ['a']),
      ['nodes', 'a', 'rotation'],
      'unknown-field',
    ],
    [
      'strokeWidth no estilo',
      withBoard(
        [board('a', [], { style: { fill: null, fillOpacity: 1, stroke: null, strokeWidth: 1 } })],
        ['a'],
      ),
      ['nodes', 'a', 'style', 'strokeWidth'],
      'unknown-field',
    ],
    [
      'estilo sem fillOpacity',
      withBoard([board('a', [], { style: { fill: null, stroke: null } })], ['a']),
      ['nodes', 'a', 'style', 'fillOpacity'],
      'type',
    ],
    [
      'childIds que não é lista',
      withBoard([board('a', 'r')], ['a']),
      ['nodes', 'a', 'childIds'],
      'type',
    ],
    [
      'filho que não é ID',
      withBoard([board('a', [3])], ['a']),
      ['nodes', 'a', 'childIds', 0],
      'type',
    ],
  ])('recusa %s', (_name, input, path, rule) => {
    expectIssue(input, path as (string | number)[], rule as string);
  });

  it('coordenada ou título acima dos limites dão LIMIT_EXCEEDED', () => {
    const tooFar = withBoard([board('a', [], { x: 1e12 })], ['a']);
    const tooLong = withBoard([board('a', [], { title: 'abcdefgh' })], ['a']);

    expect(validateDocument(tooFar)).toMatchObject({
      ok: false,
      error: { code: 'LIMIT_EXCEEDED' },
    });
    expect(validateDocument(tooLong, { limits: { maxTextLength: 5 } })).toMatchObject({
      ok: false,
      error: { code: 'LIMIT_EXCEEDED', details: { limit: 'text' } },
    });
  });
});
