import { describe, expectTypeOf, it } from 'vitest';
import type {
  ArrowEndpoint,
  BoardInput,
  BoardNode,
  BoardStyle,
  CanvasSectionApi,
  CanvasChange,
  CanvasCommand,
  CanvasDocument,
  CanvasError,
  CanvasErrorCode,
  CanvasNode,
  CanvasPeer,
  PeerLock,
  CanvasPreview,
  CanvasSnapshot,
  Bounds,
  BoundsOptions,
  ChangeArea,
  ChangeOrigin,
  CommandReceipt,
  CreateCanvasSectionOptions,
  HistoryReceipt,
  HitTestOptions,
  JsonObject,
  Layer,
  MarqueeOptions,
  NodeInfo,
  Point,
  PreviewInput,
  QueryBoundsOptions,
  ReplaceDocumentOptions,
  Result,
  SessionState,
  ShapeInput,
  ShapeNode,
  ShapePatch,
  ValidationIssue,
  Viewport,
} from './index.js';
import { createCanvasSection, isBoardNode, validateDocument } from './index.js';

// Contrato de tipos da API pública: sem `any`, uniões discriminadas que estreitam e
// dados somente leitura em todos os níveis. As asserções são conferidas pelo `pnpm typecheck`;
// em execução, cada teste só confirma que o arquivo carrega.

type IsAny<T> = 0 extends 1 & T ? true : false;

/** `true` se `any` aparece em algum nível de `T`: propriedades, itens, parâmetros ou retorno. */
type HasAny<T, Depth extends unknown[] = []> = Depth['length'] extends 8
  ? false
  : IsAny<T> extends true
    ? true
    : T extends (...args: infer Args) => infer Return
      ? HasAny<Args, [...Depth, 0]> extends true
        ? true
        : HasAny<Return, [...Depth, 0]>
      : T extends object
        ? true extends { [Key in keyof T]: HasAny<T[Key], [...Depth, 0]> }[keyof T]
          ? true
          : false
        : false;

/** O mesmo tipo com `readonly` em toda propriedade e em todo array, em todos os níveis. */
type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends ReadonlyMap<infer Key, infer Value>
      ? ReadonlyMap<Key, DeepReadonly<Value>>
      : T extends object
        ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
        : T;

describe('contrato de tipos: ausência de any', () => {
  it('o detector de any acusa any em qualquer nível', () => {
    expectTypeOf<HasAny<{ a: { b: [string, { c: unknown }] } }>>().toEqualTypeOf<false>();
    // eslint não deixa escrever any; `ReturnType<typeof JSON.parse>` é any por definição.
    expectTypeOf<HasAny<{ a: { b: ReturnType<typeof JSON.parse>[] } }>>().toEqualTypeOf<true>();
    expectTypeOf<HasAny<(input: ReturnType<typeof JSON.parse>) => void>>().toEqualTypeOf<true>();
    expectTypeOf<HasAny<() => { x: ReturnType<typeof JSON.parse> }>>().toEqualTypeOf<true>();
  });

  it('nenhum tipo da API pública contém any', () => {
    expectTypeOf<HasAny<CanvasSectionApi>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<CanvasSnapshot>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<CanvasCommand>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<CanvasError>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<CanvasChange>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<CanvasPreview>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<PreviewInput>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<CreateCanvasSectionOptions>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<typeof createCanvasSection>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<typeof validateDocument>>().toEqualTypeOf<false>();
  });
});

describe('contrato de tipos: somente leitura', () => {
  it('snapshot, evento, preview, erros e receipts são somente leitura em todos os níveis', () => {
    expectTypeOf<CanvasSnapshot>().toEqualTypeOf<DeepReadonly<CanvasSnapshot>>();
    expectTypeOf<CanvasDocument>().toEqualTypeOf<DeepReadonly<CanvasDocument>>();
    expectTypeOf<SessionState>().toEqualTypeOf<DeepReadonly<SessionState>>();
    expectTypeOf<CanvasChange>().toEqualTypeOf<DeepReadonly<CanvasChange>>();
    expectTypeOf<CanvasPreview>().toEqualTypeOf<DeepReadonly<CanvasPreview>>();
    expectTypeOf<CanvasError>().toEqualTypeOf<DeepReadonly<CanvasError>>();
    expectTypeOf<CommandReceipt>().toEqualTypeOf<DeepReadonly<CommandReceipt>>();
    expectTypeOf<HistoryReceipt>().toEqualTypeOf<DeepReadonly<HistoryReceipt>>();
    expectTypeOf<NodeInfo>().toEqualTypeOf<DeepReadonly<NodeInfo>>();
  });

  it('os comandos e as demais entradas também não pedem objetos mutáveis', () => {
    expectTypeOf<CanvasCommand>().toEqualTypeOf<DeepReadonly<CanvasCommand>>();
    expectTypeOf<PreviewInput>().toEqualTypeOf<DeepReadonly<PreviewInput>>();
    expectTypeOf<CreateCanvasSectionOptions>().toEqualTypeOf<
      DeepReadonly<CreateCanvasSectionOptions>
    >();
  });

  it('atribuir a um campo do snapshot é erro de tipo', () => {
    const check = (snapshot: CanvasSnapshot, node: ShapeNode, layer: Layer): void => {
      // @ts-expect-error -- `selectedIds` é um array somente leitura
      snapshot.session.selectedIds.push('a');
      // @ts-expect-error -- `viewport` é somente leitura
      snapshot.session.viewport.zoom = 2;
      // @ts-expect-error -- `canUndo` é somente leitura
      snapshot.history.canUndo = true;
      // @ts-expect-error -- o estilo de um nó é somente leitura
      node.style.opacity = 0;
      // @ts-expect-error -- `nodes` não aceita atribuição
      snapshot.document.nodes[node.id] = node;
      // @ts-expect-error -- `visible` é somente leitura
      layer.visible = false;
    };

    expectTypeOf(check).toBeFunction();
  });
});

describe('contrato de tipos: uniões discriminadas', () => {
  it('CanvasError estreita por code, com os detalhes de cada erro', () => {
    expectTypeOf<CanvasErrorCode>().toEqualTypeOf<
      | 'VALIDATION_ERROR'
      | 'NOT_FOUND'
      | 'LOCKED'
      | 'LIMIT_EXCEEDED'
      | 'UNSUPPORTED_VERSION'
      | 'READ_ONLY'
      | 'REENTRANT_DISPATCH'
      | 'DISPOSED'
      | 'COLLABORATION_ACTIVE'
    >();

    const check = (error: CanvasError): string => {
      switch (error.code) {
        case 'VALIDATION_ERROR':
          expectTypeOf(error.details.issues).toEqualTypeOf<readonly ValidationIssue[]>();
          expectTypeOf(error.details.commandIndex).toEqualTypeOf<number | undefined>();
          return error.code;
        case 'NOT_FOUND':
          expectTypeOf(error.details.kind).toEqualTypeOf<'node' | 'layer'>();
          expectTypeOf(error.details.id).toBeString();
          return error.code;
        case 'LOCKED':
          expectTypeOf(error.details.lockedBy).toBeString();
          return error.code;
        case 'LIMIT_EXCEEDED':
          expectTypeOf(error.details.limit).toEqualTypeOf<'nodes' | 'coordinate' | 'text'>();
          expectTypeOf(error.details.actual).toBeNumber();
          return error.code;
        case 'UNSUPPORTED_VERSION':
          expectTypeOf(error.details).toEqualTypeOf<{
            readonly found: number;
            readonly supported: number;
          }>();
          return error.code;
        default:
          // As uniões públicas podem ganhar membros: o consumidor trata o resto em um default.
          expectTypeOf(error.code).toEqualTypeOf<
            'READ_ONLY' | 'REENTRANT_DISPATCH' | 'DISPOSED' | 'COLLABORATION_ACTIVE'
          >();
          expectTypeOf(error.message).toBeString();
          return error.code;
      }
    };

    expectTypeOf(check).toBeFunction();
  });

  it('Result estreita por ok e aceita outro tipo de erro', () => {
    const check = (result: Result<CommandReceipt>): number => {
      if (result.ok) {
        expectTypeOf(result.value).toEqualTypeOf<CommandReceipt>();
        return result.value.revision;
      }
      expectTypeOf(result.error).toEqualTypeOf<CanvasError>();
      return -1;
    };

    expectTypeOf(check).toBeFunction();
    expectTypeOf<Result<string, { readonly code: 'X' }>>().toEqualTypeOf<
      | { readonly ok: true; readonly value: string }
      | { readonly ok: false; readonly error: { readonly code: 'X' } }
    >();
  });

  it('CanvasCommand estreita por type', () => {
    expectTypeOf<CanvasCommand['type']>().toEqualTypeOf<
      | 'shape.create'
      | 'shape.update'
      | 'shape.remove'
      | 'layer.create'
      | 'layer.update'
      | 'layer.reorder'
      | 'node.reorder'
      | 'group.create'
      | 'group.ungroup'
      | 'board.attach'
      | 'board.detach'
    >();

    const check = (command: CanvasCommand): void => {
      if (command.type === 'shape.create') {
        expectTypeOf(command.shape).toEqualTypeOf<ShapeInput>();
        expectTypeOf(command.layerId).toEqualTypeOf<string | undefined>();
      } else if (command.type === 'shape.update') {
        expectTypeOf(command.patch).toEqualTypeOf<ShapePatch>();
      } else if (command.type === 'node.reorder') {
        expectTypeOf(command.index).toBeNumber();
      } else if (command.type === 'group.create') {
        expectTypeOf(command.childIds).toEqualTypeOf<readonly string[]>();
      } else if (command.type === 'group.ungroup') {
        expectTypeOf(command.id).toBeString();
      } else if (command.type === 'board.attach') {
        expectTypeOf(command.boardId).toBeString();
        expectTypeOf(command.ids).toEqualTypeOf<readonly string[]>();
      } else if (command.type === 'board.detach') {
        expectTypeOf(command.ids).toEqualTypeOf<readonly string[]>();
      }
    };

    expectTypeOf(check).toBeFunction();
  });

  it('o board é um nó próprio, fora de ShapeNode', () => {
    expectTypeOf<Extract<CanvasNode, { type: 'board' }>>().toEqualTypeOf<BoardNode>();
    expectTypeOf<Extract<ShapeNode, { type: 'board' }>>().toBeNever();
    expectTypeOf<BoardNode['type']>().toEqualTypeOf<'board'>();
    expectTypeOf<BoardNode['childIds']>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<BoardNode['title']>().toBeString();
    expectTypeOf<BoardNode['style']>().toEqualTypeOf<BoardStyle>();
    expectTypeOf<BoardStyle['fill']>().toEqualTypeOf<string | null>();
    expectTypeOf<BoardStyle['stroke']>().toEqualTypeOf<string | null>();
    expectTypeOf<BoardStyle['fillOpacity']>().toBeNumber();
    // @ts-expect-error -- o board não gira
    void ({} as BoardNode).rotation;
  });

  it('BoardInput entra em ShapeInput e não aceita rotação nem filhos', () => {
    expectTypeOf<Extract<ShapeInput, { type: 'board' }>>().toEqualTypeOf<BoardInput>();
    expectTypeOf<BoardInput['title']>().toEqualTypeOf<string | undefined>();
    // @ts-expect-error -- o board não gira
    void ({} as BoardInput).rotation;
    // @ts-expect-error -- a pertença muda só pelos comandos de board
    void ({} as BoardInput).childIds;
  });

  it('isBoardNode estreita para BoardNode e devolve false para os outros nós', () => {
    const check = (node: CanvasNode): number => {
      if (isBoardNode(node)) {
        expectTypeOf(node).toEqualTypeOf<BoardNode>();
        return node.childIds.length;
      }
      expectTypeOf(node).not.toMatchTypeOf<BoardNode>();
      return 0;
    };
    expectTypeOf(check).toBeFunction();
    expectTypeOf(isBoardNode).parameter(0).toEqualTypeOf<CanvasNode>();
  });

  it('os nós estreitam por type', () => {
    expectTypeOf<CanvasNode['type']>().toEqualTypeOf<
      | 'rectangle'
      | 'square'
      | 'ellipse'
      | 'circle'
      | 'diamond'
      | 'triangle'
      | 'polygon'
      | 'cross'
      | 'chevron'
      | 'brace'
      | 'sticky'
      | 'ink'
      | 'bezier'
      | 'line'
      | 'text'
      | 'arrow'
      | 'group'
      | 'board'
    >();

    const check = (node: CanvasNode): number => {
      if (node.type === 'group') {
        expectTypeOf(node.childIds).toEqualTypeOf<readonly string[]>();
        return node.childIds.length;
      }
      if (node.type === 'line') {
        expectTypeOf(node.start).toEqualTypeOf<Point>();
        // @ts-expect-error -- linha não tem preenchimento
        void node.style.fill;
        return node.end.x;
      }
      if (node.type === 'bezier') {
        expectTypeOf(node.control1).toEqualTypeOf<Point>();
        // @ts-expect-error -- curva não tem preenchimento
        void node.style.fill;
        return node.end.x;
      }
      if (node.type === 'brace') {
        expectTypeOf(node.tipPosition).toBeNumber();
        // @ts-expect-error -- chave não tem preenchimento
        void node.style.fill;
        return node.width;
      }
      if (node.type === 'arrow') {
        expectTypeOf(node.start).toEqualTypeOf<ArrowEndpoint>();
        // @ts-expect-error -- seta não tem preenchimento
        void node.style.fill;
        return 0;
      }
      if (node.type === 'ink') {
        expectTypeOf(node.strokes.length).toBeNumber();
        // @ts-expect-error -- o traço à mão livre não tem preenchimento
        void node.style.fill;
        return node.width;
      }
      expectTypeOf(node.style.fill).toEqualTypeOf<string | null>();
      return node.width;
    };

    expectTypeOf(check).toBeFunction();
  });

  it('as áreas e origens de evento são uniões de literais', () => {
    expectTypeOf<ChangeArea>().toEqualTypeOf<
      'document' | 'selection' | 'viewport' | 'tool' | 'readOnly' | 'history' | 'preview' | 'peers'
    >();
    expectTypeOf<ChangeOrigin>().toEqualTypeOf<'local' | 'remote' | 'load' | 'history'>();
  });
});

describe('contrato de tipos: CanvasSectionApi', () => {
  it('cada método tem a assinatura documentada', () => {
    expectTypeOf<CanvasSectionApi['getSnapshot']>().toEqualTypeOf<() => CanvasSnapshot>();
    expectTypeOf<CanvasSectionApi['subscribe']>().toEqualTypeOf<
      (listener: (change: CanvasChange) => void) => () => void
    >();
    expectTypeOf<CanvasSectionApi['dispatch']>().toEqualTypeOf<
      (command: CanvasCommand) => Result<CommandReceipt>
    >();
    expectTypeOf<CanvasSectionApi['transact']>().toEqualTypeOf<
      (commands: readonly CanvasCommand[]) => Result<CommandReceipt>
    >();
    expectTypeOf<CanvasSectionApi['undo']>().toEqualTypeOf<() => Result<HistoryReceipt>>();
    expectTypeOf<CanvasSectionApi['redo']>().toEqualTypeOf<() => Result<HistoryReceipt>>();
    expectTypeOf<CanvasSectionApi['setSelection']>().toEqualTypeOf<
      (ids: readonly string[]) => Result<void>
    >();
    expectTypeOf<CanvasSectionApi['setViewport']>().toEqualTypeOf<
      (viewport: Viewport) => Result<void>
    >();
    expectTypeOf<CanvasSectionApi['setTool']>().toEqualTypeOf<(tool: string) => Result<void>>();
    expectTypeOf<CanvasSectionApi['setReadOnly']>().toEqualTypeOf<
      (readOnly: boolean) => Result<void>
    >();
    expectTypeOf<CanvasSectionApi['replaceDocument']>().toEqualTypeOf<
      (input: unknown, options?: ReplaceDocumentOptions) => Result<void>
    >();
    expectTypeOf<CanvasSectionApi['destroy']>().toEqualTypeOf<() => void>();
    expectTypeOf<CanvasSectionApi['getPreview']>().toEqualTypeOf<() => CanvasPreview | null>();
    expectTypeOf<CanvasSectionApi['setPreview']>().toEqualTypeOf<
      (preview: PreviewInput | null) => Result<void>
    >();
    expectTypeOf<CanvasSectionApi['getPeers']>().toEqualTypeOf<() => readonly CanvasPeer[]>();
    expectTypeOf<CanvasSectionApi['setPeers']>().toEqualTypeOf<
      (peers: readonly CanvasPeer[]) => Result<void>
    >();
    expectTypeOf<CanvasSectionApi['getPeerLock']>().toEqualTypeOf<
      (id: string) => PeerLock | undefined
    >();
    expectTypeOf<CanvasSectionApi['getNodeInfo']>().toEqualTypeOf<
      (id: string) => NodeInfo | undefined
    >();
    expectTypeOf<CanvasSectionApi['hitTest']>().toEqualTypeOf<
      (point: Point, options: HitTestOptions) => string | undefined
    >();
    expectTypeOf<CanvasSectionApi['hitTestAll']>().toEqualTypeOf<
      (point: Point, options: HitTestOptions) => readonly string[]
    >();
    expectTypeOf<CanvasSectionApi['queryBounds']>().toEqualTypeOf<
      (bounds: Bounds, options: QueryBoundsOptions) => readonly string[]
    >();
    expectTypeOf<CanvasSectionApi['queryMarquee']>().toEqualTypeOf<
      (rect: Bounds, options: MarqueeOptions) => readonly string[]
    >();
    expectTypeOf<CanvasSectionApi['getBounds']>().toEqualTypeOf<
      (ids: readonly string[], options: BoundsOptions) => Bounds | undefined
    >();
  });

  it('o CanvasSectionApi não tem método além dos documentados', () => {
    expectTypeOf<keyof CanvasSectionApi>().toEqualTypeOf<
      | 'getSnapshot'
      | 'getNodeInfo'
      | 'hitTest'
      | 'hitTestAll'
      | 'queryBounds'
      | 'queryMarquee'
      | 'getBounds'
      | 'subscribe'
      | 'dispatch'
      | 'transact'
      | 'undo'
      | 'redo'
      | 'setSelection'
      | 'setViewport'
      | 'setTool'
      | 'setReadOnly'
      | 'getPreview'
      | 'setPreview'
      | 'getPeers'
      | 'setPeers'
      | 'getPeerLock'
      | 'replaceDocument'
      | 'destroy'
    >();
  });

  it('as consultas exigem dizer se consideram o preview', () => {
    const check = (section: CanvasSectionApi): void => {
      // @ts-expect-error -- falta `includePreview`
      section.hitTest({ x: 0, y: 0 }, {});
      // @ts-expect-error -- as opções são obrigatórias
      section.queryBounds({ x: 0, y: 0, width: 1, height: 1 });
      // @ts-expect-error -- falta `includePreview`
      section.queryMarquee({ x: 0, y: 0, width: 1, height: 1 }, { mode: 'contain' });
      // @ts-expect-error -- falta `includePreview`
      section.getBounds(['a'], { stroke: false });
    };

    expectTypeOf(check).toBeFunction();
  });

  it('os comandos recusam no tipo o que a execução recusa', () => {
    const check = (section: CanvasSectionApi): void => {
      // @ts-expect-error -- tipo de comando desconhecido
      section.dispatch({ type: 'shape.explode', id: 'a' });
      // @ts-expect-error -- falta a geometria obrigatória
      section.dispatch({ type: 'shape.create', shape: { type: 'rectangle', x: 0, y: 0 } });
      section.dispatch({
        type: 'shape.create',
        shape: {
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          rotation: 0,
          // @ts-expect-error -- retângulo não tem extremos
          start: { x: 0, y: 0 },
        },
      });
      // @ts-expect-error -- o patch não troca o tipo do shape
      section.dispatch({ type: 'shape.update', id: 'a', patch: { type: 'line' } });
      // @ts-expect-error -- o ID é obrigatório
      section.dispatch({ type: 'shape.remove' });
    };

    expectTypeOf(check).toBeFunction();
  });

  it('os opcionais de entrada aceitam undefined explícito', () => {
    const layerId: string | undefined = undefined;
    const metadata: JsonObject | undefined = undefined;
    const command: CanvasCommand = {
      type: 'shape.create',
      layerId,
      shape: {
        type: 'line',
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
        id: undefined,
        metadata,
        style: { stroke: undefined },
      },
    };
    const options: CreateCanvasSectionOptions = {
      generateId: undefined,
      now: undefined,
      onError: undefined,
      historyLimit: undefined,
      limits: { maxNodes: undefined },
    };

    expectTypeOf(command).toExtend<CanvasCommand>();
    expectTypeOf(options).toExtend<CreateCanvasSectionOptions>();
  });
});
