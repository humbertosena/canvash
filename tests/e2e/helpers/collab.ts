import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createShape, snapshot, EXAMPLE_URLS, type Variant } from './canvas.js';
import { clickInPlayground } from './shell.js';

/**
 * Helpers das jornadas com mais de uma sessão. As páginas de um cenário ficam no mesmo
 * `BrowserContext`, porque o BroadcastChannel é escopado pelo contexto, e cada cenário usa uma
 * sala própria (`?room=`) para não cruzar com outro teste do mesmo worker.
 */

export type SharingState = 'off' | 'connecting' | 'on';

interface ProbeWindow {
  __copied: string[];
  __clipboardFails: boolean;
  __bcSpy: { opened: number; closed: number; posted: number };
}

interface CollabHandle {
  transport?: {
    getClientCount(): number;
    setNetworkOptions(options: { dropMessages?: boolean }): void;
  };
  startSharing?: () => Promise<{ ok: boolean }>;
  stopSharing?: () => Promise<{ ok: boolean }>;
  getSession?: () => { sessionId: string } | null;
}

interface CollabWindow {
  __CANVASH_PLAYGROUND__?: CollabHandle;
  /** Os outros exemplos guardam o vínculo em `collab`. */
  __CANVASH_REACT__?: { collab?: CollabHandle | null };
  __CANVASH_VUE__?: { collab?: CollabHandle | null };
  __CANVASH_WC__?: { collab?: CollabHandle | null };
}

/** Nome de sala único: o canal e o snapshot de cada cenário ficam separados. */
export function uniqueRoom(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Prepara a página antes da carga: guarda o texto copiado (a permissão de leitura da área de
 * transferência varia entre as engines) e conta os canais do playground abertos, fechados e as
 * mensagens postadas.
 */
async function installProbes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as ProbeWindow;
    w.__copied = [];
    w.__clipboardFails = false;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (w.__clipboardFails) throw new DOMException('negado', 'NotAllowedError');
          w.__copied.push(text);
        },
      },
    });

    w.__bcSpy = { opened: 0, closed: 0, posted: 0 };
    const Native = window.BroadcastChannel;
    const isPlayground = (name: string): boolean => name.startsWith('canvash-playground-collab');
    window.BroadcastChannel = class extends Native {
      private readonly counted: boolean;
      constructor(name: string) {
        super(name);
        this.counted = isPlayground(name);
        if (this.counted) w.__bcSpy.opened++;
      }
      override postMessage(message: unknown): void {
        if (this.counted) w.__bcSpy.posted++;
        super.postMessage(message);
      }
      override close(): void {
        if (this.counted) w.__bcSpy.closed++;
        super.close();
      }
    };
  });
}

function urlOf(variant: Variant, query: string): string {
  const base = variant.isVanilla ? EXAMPLE_URLS.vanilla : variant.url;
  return `${base}${base.includes('?') ? '&' : '?'}${query}`;
}

/** Espera o canvas da variante, sem esvaziar o documento: as sessões partem do mesmo conteúdo. */
async function waitForSection(page: Page, variant: Variant): Promise<void> {
  if (variant.isVanilla) {
    await page.waitForSelector('#canvas-container canvas');
    await page.waitForFunction(
      () =>
        (globalThis as unknown as { __CANVASH_PLAYGROUND__?: { section?: unknown } })
          .__CANVASH_PLAYGROUND__?.section !== undefined,
    );
    return;
  }
  await page.waitForSelector('canvas-surface');
  await page.waitForFunction(() => {
    const el = document.querySelector('canvas-surface') as
      (HTMLElement & { section?: unknown; shadowRoot: ShadowRoot | null }) | null;
    return !!el && el.section !== undefined && el.shadowRoot?.querySelector('canvas') != null;
  });
}

/** Abre uma sessão da variante na sala, local (`off`) ou já entrando pelo link (`join`). */
export async function openCollabPage(
  context: BrowserContext,
  variant: Variant,
  options: { readonly room: string; readonly join?: boolean },
): Promise<Page> {
  const page = await context.newPage();
  await installProbes(page);
  const query = `room=${options.room}${options.join ? '&collab=true' : ''}`;
  await page.goto(urlOf(variant, query));
  await waitForSection(page, variant);
  if (options.join) await waitForSharing(page, 'on');
  return page;
}

/** Abre uma sessão pelo link que outra sessão copiou. */
export async function openFromLink(
  context: BrowserContext,
  variant: Variant,
  link: string,
): Promise<Page> {
  const page = await context.newPage();
  await installProbes(page);
  await page.goto(link);
  await waitForSection(page, variant);
  await waitForSharing(page, 'on');
  return page;
}

/** A pill Compartilhar: a do `<canvas-section>` ou, no Vanilla, a do `#shell-share-button`. */
export function shareButton(page: Page): Locator {
  return page.locator('#shell-share-button, canvas-section [part~="share-button"]').first();
}

export async function sharingOf(page: Page): Promise<SharingState> {
  return (await shareButton(page).getAttribute('data-sharing')) as SharingState;
}

export async function waitForSharing(page: Page, state: SharingState): Promise<void> {
  await expect(shareButton(page)).toHaveAttribute('data-sharing', state);
}

/** Clica na pill Compartilhar. */
export async function clickShare(page: Page): Promise<void> {
  await shareButton(page).click();
}

/** Os links que a pill copiou, na ordem. */
export async function copiedLinks(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window as unknown as ProbeWindow).__copied]);
}

/** Liga ou desliga pelo botão do playground (`btn-toggle-collab`). */
export async function clickToggleCollab(page: Page): Promise<void> {
  await clickInPlayground(page, '#btn-toggle-collab');
}

/** O texto do botão do playground (`Colaboração: Ativa` ou `Colaboração: Pausada`). */
export async function toggleCollabText(page: Page): Promise<string> {
  return (await page.locator('#btn-toggle-collab').textContent())?.trim() ?? '';
}

/** O último aviso passageiro do shell. */
export function notice(page: Page): Locator {
  return page.locator('#app-status');
}

/** Cria um retângulo na página; fora da região do cursor e dos outros nós. */
export async function addRect(page: Page, id: string, x = 120, y = 120): Promise<void> {
  await createShape(page, {
    id,
    type: 'rectangle',
    x,
    y,
    width: 80,
    height: 60,
    rotation: 0,
    style: { fill: '#2563eb', stroke: '#1d4ed8', strokeWidth: 2, opacity: 1 },
  });
}

export async function nodeIds(page: Page): Promise<string[]> {
  return Object.keys((await snapshot(page)).document.nodes);
}

/** Espera o nó existir (ou deixar de existir) no documento da página. */
export async function expectNode(page: Page, id: string, present = true): Promise<void> {
  await expect.poll(async () => (await nodeIds(page)).includes(id)).toBe(present);
}

/** Recursos que o compartilhamento mantém: clientes no transporte e canais abertos. */
export async function collabResources(
  page: Page,
): Promise<{ clients: number; channels: number; posted: number }> {
  return page.evaluate(() => {
    const w = window as unknown as CollabWindow & ProbeWindow;
    const handle =
      w.__CANVASH_PLAYGROUND__ ??
      w.__CANVASH_REACT__?.collab ??
      w.__CANVASH_VUE__?.collab ??
      w.__CANVASH_WC__?.collab;
    return {
      clients: handle?.transport?.getClientCount() ?? 0,
      channels: w.__bcSpy.opened - w.__bcSpy.closed,
      posted: w.__bcSpy.posted,
    };
  });
}

/** O `sessionId` da sessão Yjs ligada, ou `null` com o compartilhamento desligado. */
export async function liveSessionId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const w = window as unknown as CollabWindow;
    const handle =
      w.__CANVASH_PLAYGROUND__ ??
      w.__CANVASH_REACT__?.collab ??
      w.__CANVASH_VUE__?.collab ??
      w.__CANVASH_WC__?.collab;
    return handle?.getSession?.()?.sessionId ?? null;
  });
}

/** Faz o próximo `startSharing` falhar, como um transporte que recusa o registro do cliente. */
export async function failNextConnection(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as CollabWindow;
    const handle =
      w.__CANVASH_PLAYGROUND__ ??
      w.__CANVASH_REACT__?.collab ??
      w.__CANVASH_VUE__?.collab ??
      w.__CANVASH_WC__?.collab;
    const transport = handle?.transport as { registerClient: () => void } | undefined;
    if (!transport) throw new Error('Transporte do exemplo não encontrado');
    transport.registerClient = () => {
      throw new Error('falha injetada');
    };
  });
}

/** Com `true`, o transporte descarta os commits: o que se edita depois fica pendente. */
export async function dropNetwork(page: Page, drop: boolean): Promise<void> {
  await page.evaluate((value) => {
    const w = window as unknown as CollabWindow;
    const handle =
      w.__CANVASH_PLAYGROUND__ ??
      w.__CANVASH_REACT__?.collab ??
      w.__CANVASH_VUE__?.collab ??
      w.__CANVASH_WC__?.collab;
    if (!handle?.transport) throw new Error('Vínculo de colaboração não encontrado');
    handle.transport.setNetworkOptions({ dropMessages: value });
  }, drop);
}

/** Liga e desliga o compartilhamento `times` vezes pelo vínculo do exemplo. */
export async function cycleSharing(page: Page, times: number): Promise<void> {
  await page.evaluate(async (count) => {
    const w = window as unknown as CollabWindow;
    const handle =
      w.__CANVASH_PLAYGROUND__ ??
      w.__CANVASH_REACT__?.collab ??
      w.__CANVASH_VUE__?.collab ??
      w.__CANVASH_WC__?.collab;
    if (!handle?.startSharing || !handle.stopSharing) throw new Error('Vínculo não encontrado');
    for (let i = 0; i < count; i++) {
      const started = await handle.startSharing();
      if (!started.ok) throw new Error('startSharing falhou');
      const stopped = await handle.stopSharing();
      if (!stopped.ok) throw new Error('stopSharing falhou');
    }
  }, times);
}

interface CanvasSectionLike {
  getPeers(): ReadonlyArray<{
    sessionId: string;
    name: string;
    color: string;
    selection: readonly string[];
    selectedAt: number | null;
    drag: { ids: readonly string[]; dx: number; dy: number } | null;
    view: { center: { x: number; y: number }; zoom: number } | null;
  }>;
  getSnapshot(): { document: { nodes: Record<string, Record<string, unknown>> } };
  setPreview(preview: unknown): unknown;
  setSelection(ids: readonly string[]): unknown;
  setViewport(viewport: { x: number; y: number; zoom: number }): unknown;
}

interface CanvasSectionHolder {
  __CANVASH_PLAYGROUND__?: { section: CanvasSectionLike };
  __CANVASH_REACT__?: { section: CanvasSectionLike };
  __CANVASH_VUE__?: { section: CanvasSectionLike };
  __CANVASH_WC__?: { canvas: { section?: CanvasSectionLike } };
}

export interface PeerInfo {
  sessionId: string;
  name: string;
  color: string;
  selection: readonly string[];
  selectedAt: number | null;
  drag: { ids: readonly string[]; dx: number; dy: number } | null;
  view: { center: { x: number; y: number }; zoom: number } | null;
}

/** Os participantes remotos que o canvas da página enxerga agora. */
export async function peersOf(page: Page): Promise<PeerInfo[]> {
  return page.evaluate(() => {
    const w = window as unknown as CanvasSectionHolder;
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    return section ? section.getPeers().map((peer) => ({ ...peer })) : [];
  });
}

/** O `sessionId` local, lido da sessão ligada. */
export async function mySessionId(page: Page): Promise<string> {
  const id = await liveSessionId(page);
  if (id === null) throw new Error('A sessão não está ligada');
  return id;
}

/** Mostra o preview de mover o nó `dx, dy` (ou limpa, com `null`), como um arrasto em andamento. */
export async function previewMove(
  page: Page,
  move: { id: string; dx: number; dy: number } | null,
): Promise<void> {
  await page.evaluate((input) => {
    const w = window as unknown as CanvasSectionHolder;
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    if (!section) throw new Error('Canvas não encontrado');
    if (input === null) {
      section.setPreview(null);
      return;
    }
    const node = section.getSnapshot().document.nodes[input.id] as
      { x: number; y: number } | undefined;
    if (!node) throw new Error(`Nó ${input.id} não existe`);
    section.setPreview({
      updates: [{ ...node, x: node.x + input.dx, y: node.y + input.dy }],
    });
  }, move);
}

/** Leva o viewport da página ao enquadramento padrão, para as coordenadas de tela serem previsíveis. */
export async function resetViewport(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as CanvasSectionHolder;
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    section?.setViewport({ x: 0, y: 0, zoom: 1 });
  });
}

/** Seleciona nós pela API do canvas, como o host (a interação não é usada). */
export async function selectIds(page: Page, ids: readonly string[]): Promise<void> {
  await page.evaluate((list) => {
    const w = window as unknown as CanvasSectionHolder;
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    section?.setSelection(list);
  }, ids);
}

/** Faz esta página parecer ter selecionado `ms` milissegundos antes (ou depois, se negativo). */
export async function shiftSelectedAt(page: Page, ms: number): Promise<void> {
  await page.evaluate((offset) => {
    (
      window as unknown as { __CANVASH_TEST_SELECTED_AT_OFFSET__: number }
    ).__CANVASH_TEST_SELECTED_AT_OFFSET__ = offset;
  }, ms);
}

/** Quem o canvas da página diz deter o nó, ou `null` se está livre. */
export async function lockHolder(page: Page, id: string): Promise<string | null> {
  return page.evaluate((nodeId) => {
    const w = window as unknown as CanvasSectionHolder & {
      __CANVASH_PLAYGROUND__?: {
        section: { getPeerLock(id: string): { name: string } | undefined };
      };
    };
    const anySection =
      (w.__CANVASH_PLAYGROUND__ ?? w.__CANVASH_REACT__ ?? w.__CANVASH_VUE__)?.section ??
      w.__CANVASH_WC__?.canvas.section;
    const lock = (
      anySection as unknown as { getPeerLock(id: string): { name: string } | undefined }
    ).getPeerLock(nodeId);
    return lock ? lock.name : null;
  }, id);
}

/** A seleção atual da página. */
export async function selectedOf(page: Page): Promise<string[]> {
  return [...(await snapshot(page)).session.selectedIds];
}

/** Mostra o preview de mover vários nós pelo mesmo `dx, dy`, ou limpa com `null`. */
export async function previewMoveMany(
  page: Page,
  move: { ids: readonly string[]; dx: number; dy: number } | null,
): Promise<void> {
  await page.evaluate((input) => {
    const w = window as unknown as CanvasSectionHolder;
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    if (!section) throw new Error('Canvas não encontrado');
    if (input === null) {
      section.setPreview(null);
      return;
    }
    const updates = input.ids.map((id) => {
      const node = section.getSnapshot().document.nodes[id] as Record<string, unknown> & {
        x?: number;
        y?: number;
        strokes?: unknown;
      };
      return { ...node, x: (node.x ?? 0) + input.dx, y: (node.y ?? 0) + input.dy };
    });
    section.setPreview({ updates });
  }, move);
}

/** Confirma o movimento: atualiza a posição dos nós no documento, como o fim de um arrasto. */
export async function commitMove(
  page: Page,
  ids: readonly string[],
  dx: number,
  dy: number,
): Promise<void> {
  await page.evaluate(
    (input) => {
      const w = window as unknown as CanvasSectionHolder & {
        __CANVASH_PLAYGROUND__?: { section: { dispatch(c: unknown): unknown } };
      };
      const section = (
        w.__CANVASH_PLAYGROUND__ ??
        w.__CANVASH_REACT__ ??
        w.__CANVASH_VUE__ ??
        (w.__CANVASH_WC__ ? { section: w.__CANVASH_WC__.canvas.section } : undefined)
      )?.section as
        | {
            getSnapshot(): { document: { nodes: Record<string, { x: number; y: number }> } };
            dispatch(c: unknown): unknown;
          }
        | undefined;
      if (!section) throw new Error('Canvas não encontrado');
      for (const id of input.ids) {
        const node = section.getSnapshot().document.nodes[id]!;
        section.dispatch({
          type: 'shape.update',
          id,
          patch: { x: node.x + input.dx, y: node.y + input.dy },
        });
      }
    },
    { ids, dx, dy },
  );
}

/** O pixel RGBA do canvas, em CSS px a partir do canto dele. */
export async function canvasPixel(
  page: Page,
  x: number,
  y: number,
): Promise<[number, number, number, number]> {
  return page.evaluate(
    ({ px, py }) => {
      const direct = document.querySelector<HTMLCanvasElement>('#canvas-container canvas');
      const inShadow = document
        .querySelector('canvas-surface')
        ?.shadowRoot?.querySelector<HTMLCanvasElement>('canvas');
      const canvas = direct ?? inShadow;
      if (!canvas) throw new Error('Canvas não encontrado');
      const ratio = canvas.width / canvas.clientWidth;
      const data = canvas
        .getContext('2d')!
        .getImageData(Math.round(px * ratio), Math.round(py * ratio), 1, 1).data;
      return [data[0]!, data[1]!, data[2]!, data[3]!];
    },
    { px: x, py: y },
  );
}

/** Algum pixel da cor `hex` (com tolerância) no quadrado de lado `2 * radius + 1` em torno do ponto? */
export async function colorNear(
  page: Page,
  x: number,
  y: number,
  hex: string,
  radius = 3,
): Promise<boolean> {
  return page.evaluate(
    ({ px, py, color, r }) => {
      const direct = document.querySelector<HTMLCanvasElement>('#canvas-container canvas');
      const inShadow = document
        .querySelector('canvas-surface')
        ?.shadowRoot?.querySelector<HTMLCanvasElement>('canvas');
      const canvas = direct ?? inShadow;
      if (!canvas) throw new Error('Canvas não encontrado');
      const ratio = canvas.width / canvas.clientWidth;
      const size = Math.ceil((2 * r + 1) * ratio);
      const left = Math.round((px - r) * ratio);
      const top = Math.round((py - r) * ratio);
      const data = canvas.getContext('2d')!.getImageData(left, top, size, size).data;
      const target = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
      for (let i = 0; i < data.length; i += 4) {
        const distance =
          Math.abs(data[i]! - target[0]!) +
          Math.abs(data[i + 1]! - target[1]!) +
          Math.abs(data[i + 2]! - target[2]!);
        if (data[i + 3]! > 90 && distance < 90) return true;
      }
      return false;
    },
    { px: x, py: y, color: hex, r: radius },
  );
}

/** A cor (`#rrggbb`) de quem detém o nó, vista pela página, ou `null` se está livre. */
export async function holderColor(page: Page, id: string): Promise<string | null> {
  return page.evaluate((nodeId) => {
    const w = window as unknown as CanvasSectionHolder;
    const section = (w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section) as unknown as
      { getPeerLock(id: string): { color: string } | undefined } | undefined;
    return section?.getPeerLock(nodeId)?.color ?? null;
  }, id);
}

/**
 * Espera o nó ter dono e devolve a cor que a própria espera viu. Reler `holderColor` depois da espera
 * pode pegar o lock já solto (null) e quebrar o `colorNear` adiante.
 */
export async function waitHolderColor(page: Page, id: string): Promise<string> {
  let color: string | null = null;
  await expect.poll(async () => (color = await holderColor(page, id))).not.toBeNull();
  return color!;
}

/** O viewport do canvas e o tamanho do canvas, em CSS px, como a página os tem agora. */
export async function viewState(page: Page): Promise<{
  viewport: { x: number; y: number; zoom: number };
  width: number;
  height: number;
  center: { x: number; y: number };
}> {
  return page.evaluate(() => {
    const w = window as unknown as CanvasSectionHolder;
    const section = (w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section) as unknown as {
      getSnapshot(): { session: { viewport: { x: number; y: number; zoom: number } } };
    };
    const direct = document.querySelector<HTMLElement>('#canvas-container');
    const canvasEl = direct ?? document.querySelector<HTMLElement>('canvas-surface');
    const viewport = section.getSnapshot().session.viewport;
    const width = canvasEl!.clientWidth;
    const height = canvasEl!.clientHeight;
    return {
      viewport,
      width,
      height,
      center: {
        x: (width / 2 - viewport.x) / viewport.zoom,
        y: (height / 2 - viewport.y) / viewport.zoom,
      },
    };
  });
}

/** Define o viewport do canvas da página, como o host (a interação não é usada). */
export async function setViewportOf(
  page: Page,
  viewport: { x: number; y: number; zoom: number },
): Promise<void> {
  await page.evaluate((next) => {
    const w = window as unknown as CanvasSectionHolder;
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    section?.setViewport(next);
  }, viewport);
}
