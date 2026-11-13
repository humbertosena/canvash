import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  createBoardNode,
  createShape,
  EXAMPLE_URLS,
  openVariant,
  snapshot,
  VARIANTS,
  type Variant,
} from '../helpers/canvas.js';

/**
 * Figuras com parâmetros próprios atravessam o IndexedDB real do navegador sem perder nada.
 * Cada entrada é um `shape.create`; novas figuras entram aqui quando o módulo delas termina.
 */
const SHAPES: ReadonlyArray<Record<string, unknown>> = [
  {
    id: 'cross-io',
    type: 'cross',
    x: 20,
    y: 30,
    width: 120,
    height: 90,
    rotation: 0.25,
    armRatio: 0.4,
  },
  {
    id: 'chevron-io',
    type: 'chevron',
    x: 200,
    y: 30,
    width: 140,
    height: 80,
    rotation: 0,
    direction: 'down',
    notchDepth: 0.35,
  },
  {
    id: 'note-io',
    type: 'sticky',
    x: 40,
    y: 260,
    width: 220,
    height: 140,
    rotation: 0.1,
    text: 'Anotação da reunião',
    style: { fill: '#c8e6c9' },
  },
  {
    id: 'brace-io',
    type: 'brace',
    x: 400,
    y: 20,
    width: 50,
    height: 180,
    rotation: -0.5,
    orientation: 'right',
    tipPosition: 0.3,
    curvature: 0.9,
    style: { stroke: '#7c3aed', strokeWidth: 3 },
  },
];

interface Win {
  __CANVASH_CORE__: {
    createCanvasSection: () => {
      dispatch: (command: unknown) => { ok: boolean };
      getSnapshot: () => { document: { nodes: Record<string, unknown> } };
      replaceDocument: (doc: unknown) => { ok: boolean };
    };
  };
  __CANVASH_PERSISTENCE__: {
    IndexedDbStorageAdapter: new () => {
      save: (key: string, doc: unknown) => Promise<{ ok: boolean }>;
      load: (key: string) => Promise<{
        ok: boolean;
        value: { document: { nodes: Record<string, unknown> } };
      }>;
    };
    serializeDocument: (doc: unknown) => { ok: boolean; value: string };
    parseDocument: (input: unknown) => { ok: boolean; value: unknown };
  };
}

test.describe('Figuras com parâmetros no IndexedDB e no JSON canônico', () => {
  test('salvam, recarregam e serializam de forma idempotente', async ({ page }) => {
    await page.goto('/?layout=classic');
    await page.waitForFunction(() => {
      const win = window as unknown as Partial<Win>;
      return win.__CANVASH_CORE__ !== undefined && win.__CANVASH_PERSISTENCE__ !== undefined;
    });

    const result = await page.evaluate(async (shapes) => {
      const win = window as unknown as Win;
      const section = win.__CANVASH_CORE__.createCanvasSection();
      for (const shape of shapes) {
        const created = section.dispatch({ type: 'shape.create', shape });
        if (!created.ok) throw new Error(`falha ao criar ${String(shape['id'])}`);
      }
      const document = section.getSnapshot().document;

      const adapter = new win.__CANVASH_PERSISTENCE__.IndexedDbStorageAdapter();
      const key = `shapes-io-${Date.now()}`;
      const saved = await adapter.save(key, document);
      const loaded = await adapter.load(key);

      const first = win.__CANVASH_PERSISTENCE__.serializeDocument(document);
      const parsed = win.__CANVASH_PERSISTENCE__.parseDocument(first.value);
      const second = win.__CANVASH_PERSISTENCE__.serializeDocument(parsed.value);

      return {
        saved: saved.ok,
        loaded: loaded.ok ? loaded.value.document.nodes : null,
        original: document.nodes,
        idempotent: first.ok && second.ok && first.value === second.value,
      };
    }, SHAPES);

    expect(result.saved).toBe(true);
    expect(result.idempotent).toBe(true);
    expect(result.loaded).toEqual(result.original);
    expect(Object.keys(result.original).sort()).toEqual([
      'brace-io',
      'chevron-io',
      'cross-io',
      'note-io',
    ]);
  });
});

/**
 * O board do documento gravado pelo autosave no IndexedDB real, lido sem passar pelo app. Só abre
 * o banco depois que o app o criou: um `open` antes disso criaria um banco vazio na versão 1, sem a
 * loja, e o app não conseguiria mais gravar.
 */
async function storedBoard(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(async () => {
    const name = 'canvash-playground-db';
    const known = await indexedDB.databases();
    if (!known.some((database) => database.name === name)) return null;
    return new Promise<Record<string, unknown> | null>((resolve) => {
      const open = indexedDB.open(name);
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('documents')) {
          db.close();
          resolve(null);
          return;
        }
        const request = db
          .transaction('documents', 'readonly')
          .objectStore('documents')
          .get('playground-document');
        request.onerror = () => {
          db.close();
          resolve(null);
        };
        request.onsuccess = () => {
          const record = request.result as
            { document?: { nodes?: Record<string, Record<string, unknown>> } } | undefined;
          db.close();
          resolve(
            Object.values(record?.document?.nodes ?? {}).find((node) => node['type'] === 'board') ??
              null,
          );
        };
      };
    });
  });
}

/**
 * Recarrega o exemplo como uma pessoa o abriria: o exemplo só restaura o documento do IndexedDB
 * quando não está sob automação (`navigator.webdriver`), e `openVariant` esvaziaria o canvas.
 */
async function reloadAsPerson(page: Page, variant: Variant): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  await page.goto(variant.isVanilla ? EXAMPLE_URLS.vanillaClassic : variant.url);
  await page.waitForFunction(() => {
    const w = globalThis as unknown as Record<
      string,
      { section?: unknown; canvas?: { section?: unknown } }
    >;
    return (
      (w['__CANVASH_PLAYGROUND__']?.section ??
        w['__CANVASH_REACT__']?.section ??
        w['__CANVASH_VUE__']?.section ??
        w['__CANVASH_WC__']?.canvas?.section) !== undefined
    );
  });
}

for (const variant of VARIANTS) {
  test.describe(`Board no autosave e na recarga: ${variant.name}`, () => {
    test('US-BD.12: childIds, title e style sobrevivem ao autosave e à recarga do IndexedDB', async ({
      page,
    }) => {
      const style = { fill: '#eff6ff', fillOpacity: 0.6, stroke: '#d4d4d8' };
      await openVariant(page, variant);
      await createShape(page, {
        id: 'card',
        type: 'rectangle',
        x: 150,
        y: 180,
        width: 60,
        height: 40,
        rotation: 0,
        style: { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 },
      });
      await createBoardNode(
        page,
        { id: 'plan', x: 100, y: 140, width: 320, height: 220, title: 'Planejamento', style },
        ['card'],
      );

      await expect
        .poll(async () => storedBoard(page), { timeout: 10_000 })
        .toMatchObject({ id: 'plan', title: 'Planejamento', style, childIds: ['card'] });

      await reloadAsPerson(page, variant);

      await expect
        .poll(async () => (await snapshot(page)).document.nodes['plan'])
        .toMatchObject({ type: 'board', title: 'Planejamento', style, childIds: ['card'] });
      const { document } = await snapshot(page);
      expect(document.nodes['card']).toMatchObject({ type: 'rectangle' });
      expect(document.layers[0]!.childIds).not.toContain('card');
    });
  });
}
