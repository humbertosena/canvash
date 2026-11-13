import { at, isRecord, rejectUnknownKeys, report } from './checks.js';
import type { CanvasCommand, CommandReceipt, HistoryReceipt } from './commands.js';
import { createDefaultDocument, type CanvasDocument } from './document.js';
import {
  affectedIds,
  applyPatch,
  invertPatch,
  type DocumentPatch,
  type DraftOutcome,
} from './draft.js';
import {
  createListeners,
  type CanvasListener,
  type ChangeArea,
  type ChangeOrigin,
  type ErrorHandler,
} from './events.js';
import { deepFreeze } from './freeze.js';
import { jsonEqual } from './equal.js';
import { EMPTY_HISTORY, History } from './history.js';
import { createIdGenerator, type Clock, type IdGenerator } from './ids.js';
import { shapeBounds, type Bounds } from './geometry/bounds.js';
import type { Viewport } from './geometry/transform.js';
import { nodeInfo, type NodeInfo } from './layers.js';
import { resolveLimits, type CanvasLimits } from './limits.js';
import { createPlacements } from './placement.js';
import { NO_PEERS, readPeers, type CanvasPeer, type PeerLock } from './peers.js';
import { prunePreview, readPreview, type CanvasPreview, type PreviewInput } from './preview.js';
import {
  boundsOf,
  createPreviewIndex,
  hitTestAll,
  indexPreview,
  queryBounds,
  queryMarquee,
  updateIndex,
  type BoundsOptions,
  type HitTestOptions,
  type MarqueeOptions,
  type QueryBoundsOptions,
  type Scene,
} from './queries.js';
import {
  disposedError,
  fail,
  ok,
  readOnlyError,
  reentrantError,
  validationError,
  type CanvasError,
  type Result,
  type ValidationIssue,
} from './result.js';
import {
  INITIAL_SESSION,
  pruneSelection,
  readReadOnly,
  readSelection,
  readTool,
  readViewport,
  type SessionState,
  type ToolId,
} from './session.js';
import type { Point } from './shapes.js';
import type { CanvasSnapshot } from './snapshot.js';
import { createGridIndex } from './spatial-index.js';
import { runCommands } from './transaction.js';
import { validateDocument } from './validate.js';

export type { CanvasSnapshot } from './snapshot.js';

/**
 * Motor de edição de um documento. Cada instância tem estado próprio.
 *
 * Erros operacionais voltam em `Result`. O que o próprio valor recebido lança ao ser lido (um
 * getter com defeito, um Proxy) não é erro do canvas: chega a quem chamou, e o canvas fica como
 * estava, pronto para a próxima chamada.
 */
export interface CanvasSectionApi {
  /** Devolve o snapshot atual. Não depende de `this`: pode ser passado adiante solto. */
  getSnapshot(): CanvasSnapshot;
  /**
   * Diz em que camada e posição um nó está, e se ele está visível e bloqueado de fato, somadas
   * as regras da camada. Devolve `undefined` se o ID não é de um nó. Não depende de `this`.
   */
  getNodeInfo(id: string): NodeInfo | undefined;
  /**
   * O nó visível mais à frente sob o ponto, em coordenadas de mundo, ou `undefined`. Considera
   * rotação, contorno e uma tolerância em px de tela convertida pelo zoom atual; forma sem
   * preenchimento só é atingida no contorno. Nó bloqueado só entra com `includeLocked`. Ponto
   * que não tem coordenadas finitas não atinge nada. Como toda consulta espacial, diz em
   * `includePreview` se enxerga o preview ou só o documento. Não depende de `this`.
   */
  hitTest(point: Point, options: HitTestOptions): string | undefined;
  /** Como {@link CanvasSectionApi.hitTest}, mas devolve todos os nós sob o ponto, da frente para o fundo. */
  hitTestAll(point: Point, options: HitTestOptions): readonly string[];
  /**
   * Os nós visíveis cuja caixa, com rotação e contorno, toca `bounds` (coordenadas de mundo),
   * em ordem visual do fundo para a frente. Serve ao culling: o critério é a caixa, não a
   * forma. Caixa inválida devolve lista vazia. Não depende de `this`.
   */
  queryBounds(bounds: Bounds, options: QueryBoundsOptions): readonly string[];
  /**
   * Os nós visíveis que o retângulo de seleção (coordenadas de mundo) contém, no modo
   * `contain`, ou toca, no modo `intersect`, em ordem visual do fundo para a frente. Decide
   * pela forma de cada nó, com rotação e contorno: uma forma girada cuja caixa toca o
   * retângulo sem que ela toque não entra. Nó bloqueado só entra com `includeLocked`.
   * Retângulo ou modo inválido devolve lista vazia. Não depende de `this`.
   */
  queryMarquee(rect: Bounds, options: MarqueeOptions): readonly string[];
  /**
   * A caixa que cobre os nós dados, com o contorno (padrão) ou só a geometria. IDs que não
   * são de nós são ignorados; sem nenhum nó, devolve `undefined`. Não depende de `this`.
   */
  getBounds(ids: readonly string[], options: BoundsOptions): Bounds | undefined;
  /**
   * Inscreve um listener, chamado de forma síncrona depois de cada alteração publicada, uma
   * vez por commit. Devolve a função que cancela a inscrição. Não depende de `this`.
   *
   * Dentro de um listener o canvas pode ser lido, mas não alterado: `dispatch` devolve
   * `REENTRANT_DISPATCH`. O que um listener lança não afeta o commit nem os outros listeners
   * e vai para `onError`.
   *
   * @throws {TypeError} Se `listener` não for uma função.
   */
  subscribe(listener: CanvasListener): () => void;
  /**
   * Executa um comando. Se ele for aceito, publica um snapshot novo com a revisão seguinte e
   * notifica os listeners; se for recusado, devolve o erro e nada muda. É o mesmo que
   * `transact` com um comando só. Não depende de `this`.
   *
   * @throws {TypeError} Se o gerador de IDs injetado devolver um ID inválido ou já usado.
   */
  dispatch(command: CanvasCommand): Result<CommandReceipt>;
  /**
   * Executa os comandos em ordem, como uma alteração só: uma revisão e um evento. Cada comando
   * enxerga o que os anteriores fizeram. Se algum for recusado, nenhum vale: o erro traz a
   * posição do comando em `details.commandIndex`, e documento e revisão ficam como estavam.
   * Não depende de `this`.
   *
   * @throws {TypeError} Se o gerador de IDs injetado devolver um ID inválido ou já usado.
   */
  transact(commands: readonly CanvasCommand[]): Result<CommandReceipt>;
  /**
   * Desfaz a última transação, restaurando exatamente o documento anterior, inclusive IDs e
   * ordem. Publica um snapshot novo com a revisão seguinte e um evento de origem `history`.
   * Sem nada para desfazer, devolve sucesso com `changed: false`. Não depende de `this`.
   */
  undo(): Result<HistoryReceipt>;
  /**
   * Refaz a última transação desfeita. Uma alteração nova depois de um undo elimina o que
   * havia para refazer. Sem nada para refazer, devolve sucesso com `changed: false`. Não
   * depende de `this`.
   */
  redo(): Result<HistoryReceipt>;
  /**
   * Define os nós selecionados. Todos precisam existir e estar visíveis; repetições são
   * ignoradas. Não altera o documento, o histórico nem a revisão. Não depende de `this`.
   */
  setSelection(ids: readonly string[]): Result<void>;
  /**
   * Define o enquadramento. O zoom é levado para dentro de `[0.05, 16]`. Não altera o
   * documento, o histórico nem a revisão. Não depende de `this`.
   */
  setViewport(viewport: Viewport): Result<void>;
  /** Define a ferramenta ativa. Não depende de `this`. */
  setTool(tool: ToolId): Result<void>;
  /**
   * Liga ou desliga o modo somente leitura. Ligado, `dispatch`, `transact`, `undo` e `redo`
   * devolvem `READ_ONLY`; seleção, viewport e ferramenta continuam. Não depende de `this`.
   */
  setReadOnly(readOnly: boolean): Result<void>;
  /**
   * Devolve o preview do gesto em andamento, ou `null`. A referência só muda quando o preview
   * muda. O preview não faz parte do snapshot. Não depende de `this`.
   */
  getPreview(): CanvasPreview | null;
  /**
   * Devolve os participantes remotos da sessão, congelados. A referência só muda quando a lista
   * muda. São estado efêmero: não fazem parte do snapshot, do histórico nem da exportação. Não
   * depende de `this`.
   */
  getPeers(): readonly CanvasPeer[];
  /**
   * Define os participantes remotos, substituindo a lista por inteiro. Cada um é conferido
   * pelos limites do canvas e a lista é copiada; basta um inválido para recusar tudo com
   * `VALIDATION_ERROR`, e a lista anterior continua. Notifica os listeners com a área `peers`
   * e origem `remote`, sem gerar revisão nem histórico. Vale em modo somente leitura.
   * `replaceDocument` não a limpa; `destroy` sim. Não depende de `this`.
   */
  setPeers(peers: readonly CanvasPeer[]): Result<void>;
  /**
   * Quem detém o bloqueio do nó, ou `undefined` se ele está livre. É função só de `locks` e
   * `released` dos participantes e do documento, e não guarda estado. Um nó de grupo travado trava
   * o grupo, e um grupo travado trava os membros. Vale em dois passos:
   *
   * 1. quem detém o próprio nó (ou o grupo dele) ganha;
   * 2. se ninguém o detém, ganha quem detém o board do nó, salvo se o nó (ou o grupo dele) estiver
   *    em `released` desse participante, que é o descendente que outro participante venceu.
   *
   * Um board travado trava os filhos e os membros dos grupos filhos. O primeiro passo vem antes,
   * então quem venceu um filho o detém mesmo com o board travado por outro.
   *
   * O bloqueio é cooperativo, de interface: `dispatch`, `transact`, `setSelection` e o resto da
   * API do host **não** o respeitam. Quem o respeita é a interação (seleção, gestos, atalhos e
   * edição) e os painéis. Não depende de `this`.
   */
  getPeerLock(id: string): PeerLock | undefined;
  /**
   * Define o preview, substituindo o anterior por inteiro; `null` o limpa. Notifica os
   * listeners com a área `preview` e o mesmo snapshot: não gera revisão nem histórico e não
   * elimina o redo. Vale em modo somente leitura.
   *
   * O preview respeita os limites do canvas, como o documento: shape com coordenada, dimensão
   * ou traço acima do limite, ou nós novos que não caberiam no máximo de nós, devolvem
   * `LIMIT_EXCEEDED`.
   *
   * Dentro de um listener, definir um preview devolve `REENTRANT_DISPATCH`, mas limpar é
   * aceito: vale na hora, e o evento sai depois da notificação em curso. Não depende de `this`.
   */
  setPreview(preview: PreviewInput | null): Result<void>;
  /**
   * Substitui o documento por um vindo de fora, depois de conferi-lo com
   * {@link validateDocument}. Se ele for recusado, devolve o erro e nada muda. Se for aceito,
   * o histórico, a seleção e o preview são limpos, o viewport fica como está (ou passa a ser o
   * de `options.viewport`), a revisão avança e os listeners recebem um evento de origem
   * `load`, com `affectedIds` vazio: o documento inteiro mudou. Vale em modo somente leitura.
   * Não depende de `this`.
   */
  replaceDocument(input: unknown, options?: ReplaceDocumentOptions): Result<void>;
  /**
   * Encerra o canvas: solta os listeners e o preview. Depois disso as leituras continuam
   * respondendo com o último estado, todo método que altera o canvas devolve `DISPOSED`, e
   * `subscribe` devolve um cancelamento que não faz nada. Pode ser chamado mais de uma vez e
   * de dentro de um listener. Não depende de `this`.
   */
  destroy(): void;
}

/** Opções de {@link CanvasSectionApi.replaceDocument}. */
export interface ReplaceDocumentOptions {
  /** Viewport a restaurar junto com o documento. Sem ele, o viewport atual é mantido. */
  readonly viewport?: Viewport | undefined;
}

/** Opções de {@link createCanvasSection}. Todas têm padrão; servem sobretudo a testes. */
export interface CreateCanvasSectionOptions {
  /**
   * Gera cada ID novo do canvas, a começar pelo do documento e pelo da camada padrão. Precisa
   * devolver uma string não vazia e diferente a cada chamada. Com o mesmo gerador, os mesmos
   * comandos produzem o mesmo documento.
   */
  readonly generateId?: IdGenerator | undefined;
  /**
   * Relógio em milissegundos, usado só pelo gerador de IDs padrão. O padrão é `Date.now`.
   * Não é lido quando `generateId` é fornecido. O instante faz parte de cada ID padrão; o
   * documento não tem nenhum campo de data.
   */
  readonly now?: Clock | undefined;
  /**
   * Recebe o que um listener lançou. Sem ele, o erro vira uma rejeição de promise não
   * tratada, que o ambiente registra.
   */
  readonly onError?: ErrorHandler | undefined;
  /**
   * Quantas transações o histórico de undo guarda; as mais antigas são descartadas. O padrão
   * é 100. Zero desliga o histórico.
   */
  readonly historyLimit?: number | undefined;
  /**
   * Limites de tamanho do documento, só para menos que os padrões (100.000 nós e 10 milhões
   * por coordenada, dimensão ou largura de traço). Valem para os comandos, para
   * `replaceDocument` e para o preview.
   */
  readonly limits?: CanvasLimits | undefined;
}

/**
 * Cria um canvas com o documento padrão: nenhum nó e uma camada vazia.
 *
 * @throws {TypeError} Se as opções ou `limits` não forem um objeto; se `generateId`, `now` ou
 * `onError` não forem funções; ou se `generateId` devolver algo que não seja uma string não
 * vazia, ou repetir um ID.
 * @throws {RangeError} Se `historyLimit` não for um inteiro maior ou igual a zero, ou se
 * `limits` trouxer um limite inválido ou acima do padrão.
 */
export function createCanvasSection(options: CreateCanvasSectionOptions = {}): CanvasSectionApi {
  return createCanvasSectionWith(options, admitAll);
}

/** Alteração do documento já calculada, à espera de admissão para ser publicada. */
export interface CommitCandidate {
  readonly origin: ChangeOrigin;
  readonly before: CanvasDocument;
  readonly after: CanvasDocument;
  /** O que mudou, item a item. `undefined` na carga, em que o documento inteiro é trocado. */
  readonly patch: DocumentPatch | undefined;
}

const VIEWPORT = at(undefined, 'viewport');

/** Confere as opções de `replaceDocument` e devolve o viewport a restaurar, se houver. */
function readReplaceOptions(options: unknown): Result<Viewport | undefined> {
  if (options === undefined) return ok(undefined);
  const issues: ValidationIssue[] = [];
  if (!isRecord(options)) {
    report(issues, undefined, 'type', 'options must be an object');
    return fail(validationError(issues));
  }
  rejectUnknownKeys(options, ['viewport'], undefined, issues);
  if (issues.length > 0) return fail(validationError(issues));
  const viewport = options['viewport'];
  return viewport === undefined ? ok(undefined) : readViewport(viewport, VIEWPORT);
}

/**
 * Segunda etapa da admissão: decide, com a alteração já calculada, se ela pode ser publicada.
 * Devolver um erro recusa o commit inteiro, como um comando inválido.
 */
export type Admit = (candidate: CommitCandidate) => CanvasError | undefined;

const admitAll: Admit = () => undefined;

/**
 * Cria um canvas com a etapa de admissão dada. É a costura interna por onde a porta
 * colaborativa participa dos commits; não faz parte da API pública do pacote.
 */
export function createCanvasSectionWith(
  options: CreateCanvasSectionOptions,
  admit: Admit,
): CanvasSectionApi {
  // Conferido sem estreitar o tipo: as opções continuam sendo lidas pelos nomes declarados.
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
  for (const name of ['generateId', 'now', 'onError'] as const) {
    if (options[name] !== undefined && typeof options[name] !== 'function') {
      throw new TypeError(`${name} must be a function`);
    }
  }
  const generateId = options.generateId ?? createIdGenerator(options.now ?? Date.now, Math.random);
  const listeners = createListeners(options.onError);
  const history = new History(options.historyLimit);
  const limits = resolveLimits(options.limits);
  let snapshot: CanvasSnapshot = deepFreeze({
    document: createDefaultDocument(generateId),
    session: INITIAL_SESSION,
    history: EMPTY_HISTORY,
    revision: 0,
  });

  // Estruturas derivadas do documento, nunca expostas: a posição de cada nó (camada, índice e
  // ordem visual) e o índice espacial das caixas.
  const placementsOf = createPlacements();
  const index = createGridIndex();
  const previewIndex = createPreviewIndex();
  // O preview do gesto em andamento fica fora do snapshot.
  let preview: CanvasPreview | null = null;
  let peers: readonly CanvasPeer[] = NO_PEERS;
  let disposed = false;
  // `true` enquanto uma operação que altera o canvas está em execução, do começo ao fim da
  // notificação dos listeners.
  let running = false;
  const placements = (): ReturnType<typeof placementsOf> => placementsOf(snapshot.document);
  const parents = {
    get: (nodeId: string) => placements().get(nodeId)?.layer.id,
    parentOf: (nodeId: string) => {
      const placement = placements().get(nodeId);
      return placement?.groupId ?? placement?.boardId;
    },
    get size() {
      return placements().size;
    },
  };
  const scene = (): Scene => ({
    document: snapshot.document,
    placements: placements(),
    index,
    preview,
    previewIndex,
    zoom: snapshot.session.viewport.zoom,
  });

  // Primeira etapa da admissão: decide se uma alteração pode começar. O modo somente leitura
  // barra o que o usuário inicia no documento (comandos, undo e redo), não a sessão.
  const refusal = (kind: ChangeOrigin | 'session'): CanvasError | undefined => {
    if (disposed) return disposedError();
    if (running) return reentrantError();
    const edits = kind === 'local' || kind === 'history';
    return edits && snapshot.session.readOnly ? readOnlyError() : undefined;
  };

  // Executa uma operação que altera o canvas, uma de cada vez. Enquanto ela corre, o código do
  // host que o canvas chama (listeners, gerador de IDs, getters da entrada) não consegue
  // iniciar outra: a chamada aninhada é recusada, em vez de trabalhar sobre um estado que a
  // operação de fora ainda vai substituir.
  const exclusive = <T>(kind: ChangeOrigin | 'session', run: () => Result<T>): Result<T> => {
    const refused = refusal(kind);
    if (refused) return fail(refused);
    running = true;
    try {
      return run();
    } finally {
      running = false;
    }
  };

  // O único lugar em que um documento novo, vindo de comandos ou do histórico, entra em
  // vigor. Tudo o que pode falhar ou ser recusado vem primeiro, sem tocar em nada: congelar o
  // documento, a segunda etapa da admissão e as podas. Só depois o estado muda, de uma vez.
  // `updateHistory` ajusta as pilhas do histórico para esta alteração. Devolve os IDs afetados.
  const commit = (
    outcome: Pick<DraftOutcome, 'document' | 'patch'>,
    origin: ChangeOrigin,
    updateHistory: () => void,
  ): Result<readonly string[]> => {
    // `destroy` pode ter sido chamado pelo host enquanto a alteração era calculada.
    if (disposed) return fail(disposedError());
    const { patch } = outcome;
    const document = deepFreeze(outcome.document);
    const refused = admit({ origin, before: snapshot.document, after: document, patch });
    if (refused) return fail(refused);

    const affected = Object.freeze(affectedIds(patch));
    const areas: ChangeArea[] = ['document'];
    // Nó removido ou ocultado sai da seleção, e o preview perde o que o documento novo
    // invalidou, no mesmo snapshot e no mesmo evento.
    let { session } = snapshot;
    const selectedIds = pruneSelection(session.selectedIds, document, placementsOf(document));
    if (selectedIds !== session.selectedIds) {
      session = { ...session, selectedIds };
      areas.push('selection');
    }
    const pruned = prunePreview(preview, document);

    updateIndex(index, patch);
    updateHistory();
    if (history.state !== snapshot.history) areas.push('history');
    if (pruned !== preview) {
      preview = pruned;
      indexPreview(previewIndex, preview);
      areas.push('preview');
    }
    snapshot = deepFreeze({
      document,
      session,
      history: history.state,
      revision: snapshot.revision + 1,
    });
    listeners.emit(deepFreeze({ snapshot, origin, areas, affectedIds: affected }));
    return ok(affected);
  };

  // Mudança só de sessão: snapshot novo com a mesma revisão e um evento da área tocada. Valor
  // igual ao atual não publica nada.
  const setSession = <Key extends keyof SessionState>(
    area: Exclude<ChangeArea, 'document' | 'history' | 'preview' | 'peers'>,
    key: Key,
    read: () => Result<SessionState[Key]>,
  ): Result<void> =>
    exclusive('session', () => {
      const result = read();
      if (!result.ok) return result;
      if (disposed) return fail(disposedError());
      if (!jsonEqual(result.value, snapshot.session[key])) {
        snapshot = deepFreeze({
          ...snapshot,
          session: { ...snapshot.session, [key]: result.value },
        });
        listeners.emit(deepFreeze({ snapshot, origin: 'local', areas: [area], affectedIds: [] }));
      }
      return ok(undefined);
    });

  const applyPreview = (next: CanvasPreview | null): Result<void> => {
    if (!jsonEqual(next, preview)) {
      preview = next;
      indexPreview(previewIndex, preview);
      listeners.emit(
        deepFreeze({ snapshot, origin: 'local', areas: ['preview'], affectedIds: [] }),
      );
    }
    return ok(undefined);
  };

  const setPreview = (input: PreviewInput | null): Result<void> => {
    // Limpar é a única mudança aceita durante a notificação: é como um gesto se cancela ao
    // reagir a um evento. O evento do preview espera a notificação em curso terminar.
    if (input === null && !disposed && listeners.notifying) return applyPreview(null);
    return exclusive('session', () => {
      const result = readPreview(input, snapshot.document, parents.size, limits);
      if (!result.ok) return result;
      if (disposed) return fail(disposedError());
      return applyPreview(result.value);
    });
  };

  const setPeers = (input: readonly CanvasPeer[]): Result<void> =>
    exclusive('remote', () => {
      const result = readPeers(input, limits);
      if (!result.ok) return result;
      if (disposed) return fail(disposedError());
      if (!jsonEqual(result.value, peers)) {
        peers = result.value;
        listeners.emit(
          deepFreeze({ snapshot, origin: 'remote', areas: ['peers'], affectedIds: [] }),
        );
      }
      return ok(undefined);
    });

  const getPeerLock = (id: string): PeerLock | undefined => {
    if (peers.length === 0) return undefined;
    const related = [id];
    const node = snapshot.document.nodes[id];
    // Consulta indexada: o renderer pergunta isto por nó a cada quadro.
    const placement = placements().get(id);
    const groupId = node?.type === 'group' ? undefined : placement?.groupId;
    if (node?.type === 'group') related.push(...node.childIds);
    else if (groupId !== undefined) related.push(groupId);
    const boardId = placement?.boardId;

    // 1º passo: quem detém o próprio nó, o grupo dele ou, num grupo, um membro.
    for (const peer of peers) {
      if (related.some((candidate) => peer.locks.includes(candidate))) {
        return { sessionId: peer.sessionId, name: peer.name, color: peer.color };
      }
    }
    if (boardId === undefined) return undefined;

    // 2º passo: quem detém o board do nó, salvo se esse participante liberou o nó (ou o grupo
    // dele), porque outro participante venceu a disputa por ele.
    for (const peer of peers) {
      if (!peer.locks.includes(boardId)) continue;
      const released = peer.released;
      if (released !== undefined && (released.includes(id) || released.includes(groupId ?? '\0'))) {
        continue;
      }
      return { sessionId: peer.sessionId, name: peer.name, color: peer.color };
    }
    return undefined;
  };

  const transact = (commands: readonly CanvasCommand[]): Result<CommandReceipt> =>
    exclusive('local', (): Result<CommandReceipt> => {
      const result = runCommands(snapshot.document, parents, commands, { generateId, limits });
      if (!result.ok) return result;
      const outcome = result.value;
      if (outcome === undefined) {
        return ok({ revision: snapshot.revision, changed: false, affectedIds: [], createdIds: [] });
      }
      const committed = commit(outcome, 'local', () => history.record(outcome.patch));
      if (!committed.ok) return committed;
      return ok({
        revision: snapshot.revision,
        changed: true,
        affectedIds: committed.value,
        createdIds: outcome.createdIds,
      });
    });

  const replaceDocument = (input: unknown, options?: ReplaceDocumentOptions): Result<void> =>
    exclusive('load', () => {
      const restored = readReplaceOptions(options);
      if (!restored.ok) return restored;
      const validated = validateDocument(input, { limits });
      if (!validated.ok) return validated;
      if (disposed) return fail(disposedError());
      const document = validated.value;
      const rejected = admit({
        origin: 'load',
        before: snapshot.document,
        after: document,
        patch: undefined,
      });
      if (rejected) return fail(rejected);

      // Tudo o que era relativo ao documento anterior é descartado junto com ele.
      const areas: ChangeArea[] = ['document'];
      let { session } = snapshot;
      if (session.selectedIds.length > 0) {
        session = { ...session, selectedIds: [] };
        areas.push('selection');
      }
      if (restored.value !== undefined && !jsonEqual(restored.value, session.viewport)) {
        session = { ...session, viewport: restored.value };
        areas.push('viewport');
      }
      history.clear();
      if (history.state !== snapshot.history) areas.push('history');
      if (preview !== null) {
        preview = null;
        indexPreview(previewIndex, preview);
        areas.push('preview');
      }
      index.clear();
      for (const node of Object.values(document.nodes)) {
        if (node.type !== 'group') index.set(node.id, shapeBounds(node));
      }

      snapshot = deepFreeze({
        document,
        session,
        history: history.state,
        revision: snapshot.revision + 1,
      });
      listeners.emit(deepFreeze({ snapshot, origin: 'load', areas, affectedIds: [] }));
      return ok(undefined);
    });

  // Undo e redo aplicam um patch guardado, pelo mesmo caminho de publicação dos comandos.
  const travel = (
    last: () => DocumentPatch | undefined,
    toApply: (patch: DocumentPatch) => DocumentPatch,
    updateHistory: () => void,
  ): Result<HistoryReceipt> =>
    exclusive('history', (): Result<HistoryReceipt> => {
      const stored = last();
      if (stored === undefined) {
        return ok({ revision: snapshot.revision, changed: false, affectedIds: [] });
      }
      const patch = toApply(stored);
      const outcome = { patch, document: applyPatch(snapshot.document, patch) };
      const committed = commit(outcome, 'history', updateHistory);
      if (!committed.ok) return committed;
      return ok({ revision: snapshot.revision, changed: true, affectedIds: committed.value });
    });

  return {
    getSnapshot: () => snapshot,
    getNodeInfo: (id) => nodeInfo(snapshot.document, placements(), id),
    hitTest: (point, options) => hitTestAll(scene(), point, options)[0],
    hitTestAll: (point, options) => hitTestAll(scene(), point, options),
    queryBounds: (bounds, options) => queryBounds(scene(), bounds, options),
    queryMarquee: (rect, options) => queryMarquee(scene(), rect, options),
    getBounds: (ids, options) =>
      boundsOf({ document: snapshot.document, preview, previewIndex }, ids, options),
    subscribe: listeners.subscribe,
    dispatch: (command) => transact([command]),
    transact,
    undo: () =>
      travel(
        () => history.lastDone,
        invertPatch,
        () => history.markUndone(),
      ),
    redo: () =>
      travel(
        () => history.lastUndone,
        (patch) => patch,
        () => history.markRedone(),
      ),
    setSelection: (ids) =>
      setSession('selection', 'selectedIds', () =>
        readSelection(ids, snapshot.document, placements()),
      ),
    setViewport: (viewport) => setSession('viewport', 'viewport', () => readViewport(viewport)),
    setTool: (tool) => setSession('tool', 'activeTool', () => readTool(tool)),
    setReadOnly: (readOnly) => setSession('readOnly', 'readOnly', () => readReadOnly(readOnly)),
    getPreview: () => preview,
    setPreview,
    getPeers: () => peers,
    setPeers,
    getPeerLock,
    replaceDocument,
    destroy: () => {
      disposed = true;
      listeners.dispose();
      preview = null;
      indexPreview(previewIndex, preview);
      peers = NO_PEERS;
    },
  };
}
