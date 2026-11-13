import {
  FONT_SIZE_PRESETS,
  isLabelable,
  shapeLabelColor,
  type CanvasSectionApi,
  type LabelableNode,
  type ShapeLabel,
} from '@canvash/core';

/**
 * Seção "Texto na forma" do painel de Propriedades do Vanilla (spec shape-label, US-SL.10 e
 * US-SL.15). É a exceção da decisão L8: o resto do painel só olha para uma forma, mas esta seção
 * aparece para toda seleção com forma elegível, mostra o estado misto como a `<canvas-properties>`
 * e aplica a todas numa só entrada de histórico (`transact`). Os `data-*` são os mesmos do
 * componente, para os specs servirem aos quatro exemplos.
 */

export interface LabelSectionHandle {
  destroy(): void;
}

const VERTICAL_ALIGNS = ['top', 'middle', 'bottom'] as const;
const TEXT_ALIGNS = ['left', 'center', 'right'] as const;

type RadioField = 'verticalAlign' | 'textAlign';
const RADIO_VALUES: Record<RadioField, readonly string[]> = {
  verticalAlign: VERTICAL_ALIGNS,
  textAlign: TEXT_ALIGNS,
};
const RADIO_GROUP: Record<RadioField, string> = {
  verticalAlign: 'label-vertical-align',
  textAlign: 'label-align',
};

const MIXED_COLOR = '#cbd5e1';

interface Common<T> {
  readonly mixed: boolean;
  readonly value: T | undefined;
}

function common<S, T>(items: readonly S[], read: (item: S) => T): Common<T> {
  const first = read(items[0]!);
  for (let i = 1; i < items.length; i++) {
    if (read(items[i]!) !== first) return { mixed: true, value: undefined };
  }
  return { mixed: false, value: first };
}

/** `bold` ou um peso numérico a partir de 600 conta como negrito. */
function isBold(weight: ShapeLabel['fontWeight'] | undefined): boolean {
  return weight === 'bold' || (typeof weight === 'number' && weight >= 600);
}

export function mountLabelSection(section: CanvasSectionApi): LabelSectionHandle | null {
  const root = document.getElementById('label-section');
  if (!root) return null;
  const field = <T extends HTMLElement>(name: string): T =>
    root.querySelector<T>(`[data-field="${name}"]`)!;
  const groups: Record<RadioField, HTMLElement> = {
    verticalAlign: field(RADIO_GROUP.verticalAlign),
    textAlign: field(RADIO_GROUP.textAlign),
  };
  const sizeSelect = field<HTMLSelectElement>('labelFontSize');
  const boldButton = field<HTMLButtonElement>('label-bold');
  const colorInput = field<HTMLInputElement>('label-color');
  const colorValue = field<HTMLElement>('label-color-value');
  const autoButton = field<HTMLButtonElement>('label-color-auto');

  const selectedShapes = (): LabelableNode[] => {
    const { document: doc, session } = section.getSnapshot();
    return session.selectedIds
      .map((id) => doc.nodes[id])
      .filter((node): node is LabelableNode => node !== undefined && isLabelable(node));
  };

  /** Aplica campos do `label` às formas elegíveis, numa só entrada de histórico. */
  const apply = (label: Partial<ShapeLabel>): void => {
    const shapes = selectedShapes();
    if (shapes.length === 0) return;
    const commands = shapes.map((shape) => ({
      type: 'shape.update' as const,
      id: shape.id,
      patch: { label },
    }));
    if (commands.length === 1) section.dispatch(commands[0]!);
    else section.transact(commands);
  };

  const applyRadio = (field: RadioField, value: string): void => {
    if (RADIO_VALUES[field].includes(value)) apply({ [field]: value });
  };

  const disposers: Array<() => void> = [];
  const listen = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void => {
    target.addEventListener(type, handler);
    disposers.push(() => target.removeEventListener(type, handler));
  };

  for (const radioField of Object.keys(groups) as RadioField[]) {
    const group = groups[radioField];
    const values = RADIO_VALUES[radioField];
    listen(group, 'click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[role="radio"]');
      if (button?.dataset['value']) applyRadio(radioField, button.dataset['value']);
    });
    // Teclado WAI-ARIA: as setas movem e marcam (dando a volta), Home e End vão às pontas.
    listen(group, 'keydown', (event) => {
      const current = values.indexOf((event.target as HTMLElement).dataset['value'] ?? '');
      let next: number;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          next = current >= values.length - 1 ? 0 : current + 1;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          next = current <= 0 ? values.length - 1 : current - 1;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = values.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      applyRadio(radioField, values[next]!);
      group.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
    });
  }
  listen(sizeSelect, 'change', () => {
    const size = parseFloat(sizeSelect.value);
    if (Number.isFinite(size) && size > 0) apply({ fontSize: size });
  });
  listen(boldButton, 'click', () => {
    const shapes = selectedShapes();
    if (shapes.length === 0) return;
    const allBold = shapes.every((shape) => isBold(shape.label?.fontWeight));
    apply({ fontWeight: allBold ? 'normal' : 'bold' });
  });
  listen(colorInput, 'input', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(colorInput.value))
      apply({ color: colorInput.value.toLowerCase() });
  });
  listen(autoButton, 'click', () => apply({ color: null }));

  const optionOf = (value: string, text: string, flags: Partial<HTMLOptionElement> = {}) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    return Object.assign(option, flags);
  };

  const render = (): void => {
    const shapes = selectedShapes();
    root.hidden = shapes.length === 0;
    if (shapes.length === 0) return;

    const { readOnly } = section.getSnapshot().session;
    const disabled =
      readOnly ||
      shapes.some((shape) => shape.locked) ||
      shapes.some((shape) => section.getPeerLock(shape.id) !== undefined);

    const state: Record<RadioField, Common<string>> = {
      verticalAlign: common(shapes, (shape) => shape.label?.verticalAlign ?? 'middle'),
      textAlign: common(shapes, (shape) => shape.label?.textAlign ?? 'center'),
    };
    for (const radioField of Object.keys(groups) as RadioField[]) {
      const checked = state[radioField].mixed ? undefined : state[radioField].value;
      groups[radioField]
        .querySelectorAll<HTMLButtonElement>('[role="radio"]')
        .forEach((button, index) => {
          const isChecked = button.dataset['value'] === checked;
          button.setAttribute('aria-checked', String(isChecked));
          button.tabIndex = (checked === undefined ? index === 0 : isChecked) ? 0 : -1;
          button.disabled = disabled;
        });
    }

    const size = common(shapes, (shape) => shape.label?.fontSize ?? 16);
    const sizeKey = size.mixed ? 'mixed' : String(size.value);
    const inList = (FONT_SIZE_PRESETS as readonly number[]).includes(size.value ?? 0);
    const signature = `${sizeKey}|${size.mixed}|${inList}`;
    if (sizeSelect.dataset['signature'] !== signature) {
      sizeSelect.replaceChildren(
        ...(size.mixed ? [optionOf('mixed', 'Misto', { disabled: true })] : []),
        ...(!size.mixed && !inList ? [optionOf(sizeKey, sizeKey)] : []),
        ...FONT_SIZE_PRESETS.map((preset) => optionOf(String(preset), String(preset))),
      );
      sizeSelect.dataset['signature'] = signature;
    }
    sizeSelect.value = sizeKey;
    sizeSelect.disabled = disabled;

    const bold = shapes.map((shape) => isBold(shape.label?.fontWeight));
    boldButton.setAttribute(
      'aria-pressed',
      bold.every(Boolean) ? 'true' : bold.some(Boolean) ? 'mixed' : 'false',
    );
    boldButton.disabled = disabled;

    const color = common(shapes, (shape) => shapeLabelColor(shape));
    colorInput.value = color.mixed ? '#000000' : (color.value ?? '#000000').slice(0, 7);
    colorInput.disabled = disabled;
    colorValue.textContent = color.mixed ? 'Misto' : (color.value ?? '');
    colorValue.style.background = color.mixed ? MIXED_COLOR : '';
    autoButton.setAttribute(
      'aria-pressed',
      String(shapes.every((shape) => (shape.label?.color ?? null) === null)),
    );
    autoButton.disabled = disabled;
  };

  const unsubscribe = section.subscribe((event) => {
    if (event.areas.some((area) => ['selection', 'document', 'readOnly', 'peers'].includes(area))) {
      render();
    }
  });
  render();

  return {
    destroy(): void {
      unsubscribe();
      for (const dispose of disposers) dispose();
    },
  };
}
