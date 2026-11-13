import { expect, test, type Locator, type Page } from '@playwright/test';
import { openVariant, VARIANTS, type Variant } from '../helpers/canvas.js';

// Agrupar e Desagrupar no mini-menu da seleção (spec group-actions, US-GA.1 a US-GA.7) nos quatro
// exemplos: <canvas-selection-menu> no Web Components, React e Vue, e o HTML próprio do Vanilla.

const VIEWPORT = { width: 1280, height: 720 };

interface Ui {
  readonly menu: Locator;
  readonly buttons: Locator;
  readonly group: Locator;
  readonly ungroup: Locator;
}

function ui(page: Page, variant: Variant): Ui {
  if (variant.isVanilla) {
    const menu = page.locator('#selection-menu');
    return {
      menu,
      buttons: menu.locator('button'),
      group: page.locator('#btn-selection-group'),
      ungroup: page.locator('#btn-selection-ungroup'),
    };
  }
  const host = page.locator('canvas-selection-menu');
  return {
    menu: host.locator('[part~="selection-menu"]'),
    buttons: host.locator('button'),
    group: host.locator('[part~="selection-action-group"]'),
    ungroup: host.locator('[part~="selection-action-ungroup"]'),
  };
}

interface State {
  readonly revision: number;
  readonly selected: readonly string[];
  readonly viewport: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly nodes: Record<string, { readonly type: string; readonly childIds?: readonly string[] }>;
}

type Step =
  | { readonly do: 'state' }
  | { readonly do: 'undo' }
  | { readonly do: 'select'; readonly ids: readonly string[] }
  | { readonly do: 'dispatch'; readonly commands: readonly unknown[] }
  | { readonly do: 'listen' }
  | { readonly do: 'events' };

/** Fala com o canvas do exemplo, seja qual for, e devolve o estado que os testes leem. */
async function call(page: Page, step: Step): Promise<State> {
  return page.evaluate((input) => {
    interface Api {
      getSnapshot(): {
        revision: number;
        document: { nodes: State['nodes'] };
        session: { selectedIds: readonly string[]; viewport: State['viewport'] };
      };
      dispatch(command: unknown): { ok: boolean };
      transact(commands: readonly unknown[]): { ok: boolean };
      undo(): void;
      setSelection(ids: readonly string[]): void;
    }
    const w = globalThis as unknown as {
      __CANVASH_PLAYGROUND__?: { section: Api };
      __CANVASH_REACT__?: { section: Api };
      __CANVASH_VUE__?: { section: Api };
      __CANVASH_WC__?: { canvas: { section?: Api } };
      __events?: Record<string, number>;
    };
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    if (!section) throw new Error('Canvas não encontrado');

    if (input.do === 'undo') section.undo();
    else if (input.do === 'select') section.setSelection(input.ids);
    else if (input.do === 'dispatch') {
      // Sem camada dita, a forma vai para a primeira: no Vanilla a da frente não é selecionável.
      const first = (section.getSnapshot() as unknown as { document: { layers: { id: string }[] } })
        .document.layers[0]?.id;
      const commands = input.commands.map((command) => {
        const c = command as { type?: string; layerId?: string };
        return c.type === 'shape.create' && c.layerId === undefined
          ? { ...c, layerId: first }
          : command;
      });
      const res = section.transact(commands);
      if (!res.ok) throw new Error('comando recusado');
    } else if (input.do === 'listen') {
      const counts: Record<string, number> = { 'document-change': 0, 'selection-change': 0 };
      w.__events = counts;
      const surface = document.querySelector('canvas-surface');
      for (const type of Object.keys(counts)) {
        surface?.addEventListener(type, () => {
          counts[type] = (counts[type] ?? 0) + 1;
        });
      }
    }

    const snap = section.getSnapshot();
    return {
      revision: snap.revision,
      selected: snap.session.selectedIds,
      viewport: snap.session.viewport,
      nodes: snap.document.nodes,
    };
  }, step);
}

async function eventCounts(page: Page): Promise<Record<string, number>> {
  return page.evaluate(
    () => (globalThis as unknown as { __events?: Record<string, number> }).__events ?? {},
  );
}

const rect = (id: string, x: number, extra: Record<string, unknown> = {}) => ({
  type: 'shape.create',
  shape: {
    id,
    type: 'rectangle',
    x,
    y: 200,
    width: 80,
    height: 60,
    rotation: 0,
    style: { fill: '#3b82f6', stroke: null, strokeWidth: 0, opacity: 1 },
    ...extra,
  },
});

/** Cria `ids` lado a lado e seleciona os que `selected` diz. */
async function setup(page: Page, ids: readonly string[], selected: readonly string[]) {
  await call(page, {
    do: 'dispatch',
    commands: ids.map((id, index) => rect(id, 100 + index * 140)),
  });
  await call(page, { do: 'select', ids: selected });
}

/** Os `data-action` dos botões do menu, na ordem em que aparecem. */
async function actionsOf(buttons: Locator): Promise<(string | null)[]> {
  return buttons.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-action')));
}

/** O foco no canvas, para os atalhos valerem. */
const focusCanvas = (page: Page) =>
  page.evaluate(() =>
    (
      (document.querySelector('canvas-surface') ??
        document.querySelector('#canvas-container')) as HTMLElement
    ).focus(),
  );

for (const variant of VARIANTS) {
  test.describe(`Agrupar e Desagrupar no mini-menu: ${variant.name}`, () => {
    test.use({ viewport: VIEWPORT });

    test.beforeEach(async ({ page }) => {
      await openVariant(page, variant, { classic: false });
    });

    test('US-GA.1: dois nós soltos mostram Agrupar habilitado entre Enviar para trás e Excluir', async ({
      page,
    }) => {
      const { menu, buttons, group, ungroup } = ui(page, variant);
      await setup(page, ['r1', 'r2'], ['r1', 'r2']);

      await expect(menu).toBeVisible();
      expect(await actionsOf(buttons)).toEqual([
        'bring-to-front',
        'send-to-back',
        'group',
        'delete',
      ]);
      await expect(group).toHaveAttribute('aria-label', 'Agrupar');
      await expect(group).not.toHaveAttribute('aria-disabled', 'true');
      await expect(ungroup).toHaveCount(0);

      await call(page, { do: 'select', ids: ['r1'] });
      await expect(buttons).toHaveCount(3);
      await expect(group).toHaveCount(0);
    });

    test('US-GA.2: Agrupar cria o grupo numa entrada de histórico, seleciona o grupo e o menu passa a oferecer Desagrupar', async ({
      page,
    }) => {
      const { menu, group, ungroup } = ui(page, variant);
      await setup(page, ['r1', 'r2'], ['r1', 'r2']);
      await expect(menu).toBeVisible();
      const before = await call(page, { do: 'listen' });

      await group.click();

      const after = await call(page, { do: 'state' });
      const [created] = after.selected;
      expect(after.selected).toHaveLength(1);
      expect(after.nodes[created!]?.type).toBe('group');
      expect([...(after.nodes[created!]?.childIds ?? [])].sort()).toEqual(['r1', 'r2']);
      expect(after.revision).toBe(before.revision + 1);
      expect(after.viewport).toEqual(before.viewport);
      await expect(ungroup).toBeVisible();
      await expect(group).toHaveCount(0);
      // Sem <canvas-surface> (Vanilla), a mudança se confere pela revisão e pela seleção, acima.
      if (!variant.isVanilla) {
        expect(await eventCounts(page)).toEqual({ 'document-change': 1, 'selection-change': 1 });
      }

      // Um único Ctrl/⌘+Z desfaz o grupo.
      await focusCanvas(page);
      await page.keyboard.press('ControlOrMeta+z');
      await expect
        .poll(async () => (await call(page, { do: 'state' })).nodes[created!])
        .toBeUndefined();
    });

    test('US-GA.3: com um grupo aparece só Desagrupar; dois grupos se desfazem num clique e num undo', async ({
      page,
    }) => {
      const { menu, buttons, group, ungroup } = ui(page, variant);
      await setup(page, ['a1', 'a2', 'b1', 'b2'], []);
      await call(page, {
        do: 'dispatch',
        commands: [
          { type: 'group.create', id: 'ga', childIds: ['a1', 'a2'] },
          { type: 'group.create', id: 'gb', childIds: ['b1', 'b2'] },
        ],
      });
      await call(page, { do: 'select', ids: ['ga'] });
      await expect(menu).toBeVisible();
      expect(await actionsOf(buttons)).toEqual([
        'bring-to-front',
        'send-to-back',
        'ungroup',
        'delete',
      ]);
      await expect(ungroup).not.toHaveAttribute('aria-disabled', 'true');

      await ungroup.click();
      let state = await call(page, { do: 'state' });
      expect(state.nodes['ga']).toBeUndefined();
      expect([...state.selected].sort()).toEqual(['a1', 'a2']);
      await call(page, { do: 'undo' });

      await call(page, { do: 'select', ids: ['ga', 'gb'] });
      await expect(ungroup).toBeVisible();
      await expect(group).toHaveAttribute('aria-disabled', 'true');
      const before = await call(page, { do: 'state' });
      await ungroup.click();
      state = await call(page, { do: 'state' });
      expect(state.nodes['ga']).toBeUndefined();
      expect(state.nodes['gb']).toBeUndefined();
      expect(state.revision).toBe(before.revision + 1);
      expect([...state.selected].sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
      await call(page, { do: 'undo' });
      state = await call(page, { do: 'state' });
      expect(state.nodes['ga']?.type).toBe('group');
      expect(state.nodes['gb']?.type).toBe('group');
    });

    test('US-GA.4: Agrupar aparece desabilitado com nó bloqueado, camada bloqueada, camadas diferentes e grupo misturado, e o clique não faz nada', async ({
      page,
    }) => {
      const { menu, buttons, group, ungroup } = ui(page, variant);
      await setup(page, ['r1', 'r2', 'r3'], []);
      await call(page, {
        do: 'dispatch',
        commands: [
          rect('lk', 520, { locked: true }),
          { type: 'layer.create', layer: { id: 'L2' } },
          { ...rect('o1', 660), layerId: 'L2' },
          { ...rect('o2', 800), layerId: 'L2' },
          { type: 'layer.update', id: 'L2', patch: { locked: true } },
          { type: 'group.create', id: 'g', childIds: ['r1', 'r2'] },
        ],
      });

      const disabledFor = [
        ['r3', 'lk'],
        ['o1', 'o2'],
        ['r3', 'o1'],
        ['g', 'r3'],
      ];
      for (const ids of disabledFor) {
        await call(page, { do: 'select', ids });
        await expect(menu).toBeVisible();
        await expect(group).toHaveAttribute('aria-disabled', 'true');
        const before = await call(page, { do: 'state' });
        // O Playwright trata aria-disabled como desabilitado: o clique tem de ser forçado.
        await group.click({ force: true });
        expect((await call(page, { do: 'state' })).revision).toBe(before.revision);
      }
      // Com um grupo e um nó solto, Desagrupar está habilitado, e os dois ficam antes de Excluir.
      await expect(ungroup).toBeVisible();
      await expect(ungroup).not.toHaveAttribute('aria-disabled', 'true');
      expect(await actionsOf(buttons)).toEqual([
        'bring-to-front',
        'send-to-back',
        'group',
        'ungroup',
        'delete',
      ]);
    });

    /** O grupo da seleção, ou os filhos soltos: o que o botão e o atalho têm de deixar igual. */
    const outcome = (state: State) => {
      const nodes = Object.entries(state.nodes).map(([id, node]) => [
        node.type === 'group' ? 'group' : id,
        node.type,
        [...(node.childIds ?? [])].sort(),
      ]);
      const selected = state.selected.map((id) =>
        state.nodes[id]?.type === 'group' ? 'group' : id,
      );
      return { nodes: nodes.sort(), selected: [...selected].sort() };
    };

    test('US-GA.5: Ctrl/⌘+G e Ctrl/⌘+Shift+G deixam o documento e a seleção como o botão deixa', async ({
      page,
    }) => {
      const { group, ungroup } = ui(page, variant);
      await setup(page, ['a1', 'a2', 'b1', 'b2', 'r1', 'r2'], []);
      await call(page, {
        do: 'dispatch',
        commands: [
          { type: 'group.create', id: 'ga', childIds: ['a1', 'a2'] },
          { type: 'group.create', id: 'gb', childIds: ['b1', 'b2'] },
        ],
      });

      // Agrupar: pelo botão e pelo atalho.
      await call(page, { do: 'select', ids: ['r1', 'r2'] });
      await group.click();
      const byButton = outcome(await call(page, { do: 'state' }));
      await call(page, { do: 'undo' });
      await call(page, { do: 'select', ids: ['r1', 'r2'] });
      await focusCanvas(page);
      await page.keyboard.press('ControlOrMeta+g');
      expect(outcome(await call(page, { do: 'state' }))).toEqual(byButton);
      await call(page, { do: 'undo' });

      // Desagrupar dois grupos: pelo botão e pelo atalho.
      await call(page, { do: 'select', ids: ['ga', 'gb'] });
      await ungroup.click();
      const ungroupedByButton = outcome(await call(page, { do: 'state' }));
      await call(page, { do: 'undo' });
      await call(page, { do: 'select', ids: ['ga', 'gb'] });
      await focusCanvas(page);
      await page.keyboard.press('ControlOrMeta+Shift+g');
      expect(outcome(await call(page, { do: 'state' }))).toEqual(ungroupedByButton);
      await call(page, { do: 'undo' });

      // Com Agrupar desabilitado, o atalho não muda a revisão.
      await call(page, { do: 'select', ids: ['ga', 'r1'] });
      await focusCanvas(page);
      const before = await call(page, { do: 'state' });
      await page.keyboard.press('ControlOrMeta+g');
      expect((await call(page, { do: 'state' })).revision).toBe(before.revision);
    });

    test('US-GA.6: a dica e o aria-keyshortcuts seguem a plataforma da página', async ({
      page,
    }) => {
      const { buttons, group, ungroup } = ui(page, variant);
      await setup(page, ['a1', 'a2', 'r1'], []);
      await call(page, {
        do: 'dispatch',
        commands: [{ type: 'group.create', id: 'ga', childIds: ['a1', 'a2'] }],
      });
      await call(page, { do: 'select', ids: ['ga', 'r1'] });
      const mac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform));

      await expect(group).toHaveAttribute('title', mac ? 'Agrupar (⌘G)' : 'Agrupar (Ctrl+G)');
      await expect(group).toHaveAttribute(
        'aria-keyshortcuts',
        mac ? 'Meta+G Control+G' : 'Control+G Meta+G',
      );
      await expect(ungroup).toHaveAttribute(
        'title',
        mac ? 'Desagrupar (⌘⇧G)' : 'Desagrupar (Ctrl+Shift+G)',
      );
      await expect(ungroup).toHaveAttribute(
        'aria-keyshortcuts',
        mac ? 'Meta+Shift+G Control+Shift+G' : 'Control+Shift+G Meta+Shift+G',
      );
      // O nome acessível é só o rótulo, e os três botões antigos não ganham dica nem atalho.
      await expect(group).toHaveAttribute('aria-label', 'Agrupar');
      const flags = await buttons.evaluateAll((nodes) =>
        nodes.map((node) => ({
          action: node.getAttribute('data-action'),
          title: node.hasAttribute('title'),
          keys: node.hasAttribute('aria-keyshortcuts'),
        })),
      );
      for (const flag of flags) {
        const isGroupAction = flag.action === 'group' || flag.action === 'ungroup';
        expect([flag.action, flag.title, flag.keys]).toEqual([
          flag.action,
          isGroupAction,
          isGroupAction,
        ]);
      }
    });

    test('US-GA.7: pelo teclado, agrupar leva o foco a Desagrupar e desagrupar leva a Agrupar; as setas passam pelos cinco botões', async ({
      page,
    }) => {
      const { menu, buttons, group, ungroup } = ui(page, variant);
      await setup(page, ['r1', 'r2'], ['r1', 'r2']);
      await expect(menu).toBeVisible();
      await focusCanvas(page);

      await page.keyboard.press('Shift+F10');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await expect(group).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(ungroup).toBeFocused();
      expect(
        await buttons.evaluateAll((nodes) => nodes.filter((n) => n.tabIndex === 0).length),
      ).toBe(1);

      await page.keyboard.press('Enter');
      await expect(group).toBeFocused();
      await expect(ungroup).toHaveCount(0);

      // Com um grupo e um nó solto, as setas passam pelos cinco botões, o desabilitado incluído.
      await call(page, {
        do: 'dispatch',
        commands: [{ type: 'group.create', id: 'gg', childIds: ['r1', 'r2'] }],
      });
      await call(page, {
        do: 'dispatch',
        commands: [rect('r3', 700)],
      });
      await call(page, { do: 'select', ids: ['gg', 'r3'] });
      await expect(buttons).toHaveCount(5);
      await focusCanvas(page);
      await page.keyboard.press('Shift+F10');
      await page.keyboard.press('Home');
      const seen: (string | null)[] = [];
      for (let step = 0; step < 6; step += 1) {
        seen.push(
          await page.evaluate(() => {
            let active: Element | null = document.activeElement;
            while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
            return active?.getAttribute('data-action') ?? null;
          }),
        );
        await page.keyboard.press('ArrowRight');
      }
      expect(seen).toEqual([
        'bring-to-front',
        'send-to-back',
        'group',
        'ungroup',
        'delete',
        'bring-to-front',
      ]);
      await page.keyboard.press('End');
      await expect(buttons.last()).toBeFocused();
      await page.keyboard.press('Home');
      await expect(buttons.first()).toBeFocused();
    });
  });
}
