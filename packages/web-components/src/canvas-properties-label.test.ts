import { FONT_SIZE_PRESETS, createCanvasSection, type CanvasPeer } from '@canvash/core';
import { describe, expect, it, vi } from 'vitest';
import { CanvasPropertiesElement } from './canvas-properties.js';
import { defaultI18nEnUS, defaultI18nPtBR } from './i18n.js';

// Seção "Texto na forma" do painel de propriedades (spec shape-label, US-SL.9 e US-SL.10).

/** Texto do template: as partes fixas intercaladas com os valores, funções ignoradas. */
function templateText(result: unknown): string {
  if (Array.isArray(result)) return result.map(templateText).join('');
  if (result && typeof result === 'object' && 'strings' in result && 'values' in result) {
    const { strings, values } = result as { strings: readonly string[]; values: unknown[] };
    return strings.reduce(
      (text, part, i) => text + part + (i < values.length ? templateText(values[i]) : ''),
      '',
    );
  }
  if (typeof result === 'function' || result === undefined || result === null) return '';
  return String(result);
}

interface Testable {
  _onLabelRadio(field: 'verticalAlign' | 'textAlign', value: string): void;
  _onLabelRadioKeydown(field: 'verticalAlign' | 'textAlign', event: unknown): void;
  _onLabelFontSize(event: unknown): void;
  _onLabelBold(): void;
  _onLabelColor(color: string): void;
  _onLabelColorAuto(): void;
}

const PEER = (locks: string[]): CanvasPeer => ({
  sessionId: 'outra',
  name: 'Bia',
  color: '#dc2626',
  cursor: null,
  selection: locks,
  selectedAt: 1,
  drag: null,
  view: null,
  locks,
  followed: false,
});

function setup(types: string[] = ['rectangle'], extra: Record<string, unknown> = {}) {
  const el = new CanvasPropertiesElement();
  const section = createCanvasSection();
  el.section = section;
  const ids = types.map((type, index) => `s${index}`);
  types.forEach((type, index) => {
    section.dispatch({
      type: 'shape.create',
      shape:
        type === 'text'
          ? { id: ids[index], type, x: index * 300, y: 0, width: 200, text: 'Livre' }
          : {
              id: ids[index],
              type,
              x: index * 300,
              y: 0,
              width: 100,
              height: 100,
              rotation: 0,
              ...extra,
            },
    } as never);
  });
  section.setSelection(ids);
  return {
    el,
    section,
    ids,
    internals: el as unknown as Testable,
    html: (): string => templateText(el.render()),
  };
}

const labelOf = (section: ReturnType<typeof createCanvasSection>, id: string) =>
  (section.getSnapshot().document.nodes[id] as { label?: Record<string, unknown> }).label;

/** Os botões de um radiogroup no HTML: [valor, aria-checked, tabindex]. */
function radios(html: string, field: string): [string, string, string][] {
  const group = html.split(`data-field=${field}`)[1] ?? '';
  const end = group.indexOf('</div>');
  return [...group.slice(0, end).matchAll(/data-value=(\w+)[^>]*?/g)].map((match) => {
    const chunk = group.slice(match.index!, group.indexOf('</button>', match.index!));
    return [
      match[1]!,
      /aria-checked=(\w+)/.exec(chunk)?.[1] ?? '',
      /tabindex=(-?\d)/.exec(chunk)?.[1] ?? '',
    ];
  });
}

describe('painel: a seção "Texto na forma" (US-SL.10)', () => {
  it('aparece para toda seleção com forma elegível, mesmo sem label', () => {
    for (const type of ['rectangle', 'square', 'ellipse', 'circle', 'diamond']) {
      expect(setup([type]).html(), type).toContain('part="section-label"');
    }
    expect(setup(['rectangle', 'text']).html()).toContain('part="section-label"');
  });

  it('não aparece sem forma elegível (chave, texto livre, nota)', () => {
    expect(setup(['text']).html()).not.toContain('section-label');
    expect(setup(['sticky']).html()).not.toContain('section-label');
    expect(setup(['brace']).html()).not.toContain('section-label');
  });

  it('traz os dois radiogroups com os rótulos em pt-BR', () => {
    const html = setup().html();

    expect(html).toContain('Texto na forma');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('data-field=label-vertical-align');
    expect(html).toContain('data-field=label-align');
    for (const text of [
      'Posição',
      'Topo',
      'Centro',
      'Base',
      'Alinhamento',
      'Esquerda',
      'Direita',
    ]) {
      expect(html).toContain(text);
    }
    expect(radios(html, 'label-vertical-align').map((r) => r[0])).toEqual([
      'top',
      'middle',
      'bottom',
    ]);
    expect(radios(html, 'label-align').map((r) => r[0])).toEqual(['left', 'center', 'right']);
  });

  it('numa forma sem label, marca os padrões (meio e centro) e só o marcado tem tabindex 0', () => {
    const html = setup().html();

    expect(radios(html, 'label-vertical-align')).toEqual([
      ['top', 'false', '-1'],
      ['middle', 'true', '0'],
      ['bottom', 'false', '-1'],
    ]);
    expect(radios(html, 'label-align')).toEqual([
      ['left', 'false', '-1'],
      ['center', 'true', '0'],
      ['right', 'false', '-1'],
    ]);
  });

  it('com valores mistos, nenhum rádio fica marcado e o primeiro do grupo tem tabindex 0', () => {
    const { section, ids, internals, html } = setup(['rectangle', 'ellipse']);
    section.setSelection([ids[0]!]);
    internals._onLabelRadio('verticalAlign', 'top');
    section.setSelection(ids);

    expect(radios(html(), 'label-vertical-align')).toEqual([
      ['top', 'false', '0'],
      ['middle', 'false', '-1'],
      ['bottom', 'false', '-1'],
    ]);
    // O alinhamento horizontal segue igual nas duas.
    expect(radios(html(), 'label-align')[1]).toEqual(['center', 'true', '0']);
  });
});

describe('painel: mudar posição e alinhamento (US-SL.9 e US-SL.10)', () => {
  it('numa forma sem label, a mudança cria o label com texto vazio e os padrões', () => {
    const { section, internals } = setup();

    internals._onLabelRadio('verticalAlign', 'bottom');

    expect(labelOf(section, 's0')).toEqual({
      text: '',
      fontSize: 16,
      fontFamily: 'sans-serif',
      fontWeight: 'normal',
      color: null,
      textAlign: 'center',
      verticalAlign: 'bottom',
    });
  });

  it('mantém o texto e os demais campos de um label que já existe', () => {
    const { section, internals } = setup(['rectangle'], { label: { text: 'Olá', fontSize: 24 } });

    internals._onLabelRadio('textAlign', 'right');

    expect(labelOf(section, 's0')).toMatchObject({ text: 'Olá', fontSize: 24, textAlign: 'right' });
  });

  it('várias formas: uma entrada só de histórico, e só as elegíveis mudam', () => {
    const { section, ids, internals } = setup(['rectangle', 'ellipse', 'text']);
    const textBefore = section.getSnapshot().document.nodes['s2'];
    const revision = section.getSnapshot().revision;

    internals._onLabelRadio('verticalAlign', 'top');

    expect(section.getSnapshot().revision).toBe(revision + 1);
    expect(labelOf(section, 's0')).toMatchObject({ verticalAlign: 'top' });
    expect(labelOf(section, 's1')).toMatchObject({ verticalAlign: 'top' });
    expect(section.getSnapshot().document.nodes['s2']).toBe(textBefore);
    section.undo();
    expect(labelOf(section, ids[0]!)).toBeUndefined();
    expect(labelOf(section, ids[1]!)).toBeUndefined();
  });

  it('valores fora da lista são ignorados', () => {
    const { section, internals } = setup();
    const before = section.getSnapshot();

    internals._onLabelRadio('verticalAlign', 'baseline');
    internals._onLabelRadio('textAlign', 'justify');

    expect(section.getSnapshot()).toBe(before);
  });

  it('o rádio escolhido passa a vir marcado', () => {
    const { internals, html } = setup();

    internals._onLabelRadio('textAlign', 'left');

    expect(radios(html(), 'label-align')).toEqual([
      ['left', 'true', '0'],
      ['center', 'false', '-1'],
      ['right', 'false', '-1'],
    ]);
  });
});

describe('painel: teclado do radiogroup (WAI-ARIA)', () => {
  /** Evento de teclado no botão `value` de um grupo de três botões de mentira. */
  function press(key: string, value: string, order: readonly string[]) {
    const buttons = order.map((v) => ({ dataset: { value: v }, focus: vi.fn() }));
    const preventDefault = vi.fn();
    const event = {
      key,
      target: buttons[order.indexOf(value)],
      currentTarget: { querySelectorAll: () => buttons },
      preventDefault,
    };
    return { event, buttons, preventDefault };
  }

  it('as setas movem e marcam, dando a volta', () => {
    const order = ['left', 'center', 'right'];
    const { section, internals } = setup(['rectangle'], {
      label: { text: 'x', textAlign: 'left' },
    });

    const right = press('ArrowRight', 'left', order);
    internals._onLabelRadioKeydown('textAlign', right.event);
    expect(labelOf(section, 's0')).toMatchObject({ textAlign: 'center' });
    expect(right.buttons[1]!.focus).toHaveBeenCalledTimes(1);
    expect(right.preventDefault).toHaveBeenCalled();

    internals._onLabelRadioKeydown('textAlign', press('ArrowDown', 'center', order).event);
    expect(labelOf(section, 's0')).toMatchObject({ textAlign: 'right' });

    internals._onLabelRadioKeydown('textAlign', press('ArrowRight', 'right', order).event);
    expect(labelOf(section, 's0')).toMatchObject({ textAlign: 'left' });

    internals._onLabelRadioKeydown('textAlign', press('ArrowLeft', 'left', order).event);
    expect(labelOf(section, 's0')).toMatchObject({ textAlign: 'right' });
    internals._onLabelRadioKeydown('textAlign', press('ArrowUp', 'right', order).event);
    expect(labelOf(section, 's0')).toMatchObject({ textAlign: 'center' });
  });

  it('Home e End vão às pontas; outras teclas seguem o caminho normal', () => {
    const order = ['top', 'middle', 'bottom'];
    const { section, internals } = setup();

    internals._onLabelRadioKeydown('verticalAlign', press('End', 'middle', order).event);
    expect(labelOf(section, 's0')).toMatchObject({ verticalAlign: 'bottom' });
    internals._onLabelRadioKeydown('verticalAlign', press('Home', 'bottom', order).event);
    expect(labelOf(section, 's0')).toMatchObject({ verticalAlign: 'top' });

    const tab = press('Tab', 'top', order);
    const before = section.getSnapshot();
    internals._onLabelRadioKeydown('verticalAlign', tab.event);
    expect(tab.preventDefault).not.toHaveBeenCalled();
    expect(section.getSnapshot()).toBe(before);
  });
});

describe('painel: campos desabilitados (US-SL.10)', () => {
  const radioChunks = (html: string) =>
    html.split('<button').filter((chunk) => chunk.includes('class="label-radio"'));
  const isDisabled = (chunk: string) => /\?disabled=true/.test(chunk);

  it('em readOnly, em nó bloqueado e em bloqueio de outra sessão, os rádios ficam desabilitados', () => {
    const readOnly = setup();
    readOnly.section.setReadOnly(true);
    const locked = setup(['rectangle'], { locked: true });
    const peer = setup();
    peer.section.setPeers([PEER(['s0'])]);

    for (const { html } of [readOnly, locked, peer]) {
      const chunks = radioChunks(html());
      expect(chunks).toHaveLength(6);
      for (const chunk of chunks) expect(isDisabled(chunk)).toBe(true);
    }
  });

  it('livres, os seis rádios ficam habilitados', () => {
    const chunks = radioChunks(setup().html());

    expect(chunks).toHaveLength(6);
    for (const chunk of chunks) expect(isDisabled(chunk)).toBe(false);
  });
});

describe('painel: textos (i18n)', () => {
  it('os rótulos da seção existem em pt-BR e en', () => {
    const pt = defaultI18nPtBR.properties;
    const en = defaultI18nEnUS.properties;

    expect([
      pt.sectionLabel,
      pt.labelVerticalAlign,
      pt.labelTop,
      pt.labelMiddle,
      pt.labelBottom,
    ]).toEqual(['Texto na forma', 'Posição', 'Topo', 'Centro', 'Base']);
    expect([pt.labelAlign, pt.labelAlignLeft, pt.labelAlignCenter, pt.labelAlignRight]).toEqual([
      'Alinhamento',
      'Esquerda',
      'Centro',
      'Direita',
    ]);
    expect(en.sectionLabel).toBe('Text in shape');
    expect([en.labelTop, en.labelMiddle, en.labelBottom]).toEqual(['Top', 'Middle', 'Bottom']);
    expect([en.labelAlignLeft, en.labelAlignCenter, en.labelAlignRight]).toEqual([
      'Left',
      'Center',
      'Right',
    ]);
  });
});

/** Cria `ids` retângulos com `label` e seleciona todos. */
function labelled(labels: Record<string, unknown>[]) {
  const ctx = setup(labels.map(() => 'rectangle'));
  labels.forEach((label, index) => {
    ctx.section.dispatch({
      type: 'shape.update',
      id: `s${index}`,
      patch: { label },
    } as never);
  });
  return ctx;
}

describe('painel: tamanho da fonte do texto da forma (US-SL.10)', () => {
  const selectChunk = (html: string) => {
    const start = html.indexOf('id="prop-label-font-size"');
    return html.slice(start, html.indexOf('</select>', start));
  };

  it('lista os presets, com id próprio e o label apontando para ele', () => {
    const html = setup().html();

    expect(html).toContain('for="prop-label-font-size"');
    expect(html).toContain('data-property="labelFontSize"');
    const chunk = selectChunk(html);
    for (const size of FONT_SIZE_PRESETS) expect(chunk).toContain(`value=${size}`);
    expect(chunk).not.toContain('value=auto');
    expect(chunk).not.toMatch(/\?disabled=true/);
  });

  it('um tamanho fora da lista aparece como opção extra selecionada', () => {
    const chunk = selectChunk(labelled([{ text: 'x', fontSize: 17 }]).html());

    expect(chunk).toContain('value=17 selected');
  });

  it('com tamanhos diferentes, aparece a opção "misto" desabilitada', () => {
    const chunk = selectChunk(
      labelled([
        { text: 'x', fontSize: 16 },
        { text: 'y', fontSize: 24 },
      ]).html(),
    );

    expect(chunk).toContain('value="mixed" selected disabled');
    expect(chunk).toContain('Misto');
  });

  it('mudar o seletor aplica fontSize a todas as formas, numa entrada de histórico', () => {
    const { section, internals } = labelled([{ text: 'x' }, { text: 'y' }]);
    const revision = section.getSnapshot().revision;

    internals._onLabelFontSize({ target: { value: '32' } });

    expect(section.getSnapshot().revision).toBe(revision + 1);
    expect(labelOf(section, 's0')).toMatchObject({ fontSize: 32, text: 'x' });
    expect(labelOf(section, 's1')).toMatchObject({ fontSize: 32, text: 'y' });
  });

  it('valores inválidos são ignorados', () => {
    const { section, internals } = setup();
    const before = section.getSnapshot();

    internals._onLabelFontSize({ target: { value: 'mixed' } });
    internals._onLabelFontSize({ target: { value: '-4' } });
    internals._onLabelFontSize({ target: { value: '' } });

    expect(section.getSnapshot()).toBe(before);
  });

  it('com texto livre e forma selecionados juntos, nenhum id se repete', () => {
    const { html } = setup(['rectangle', 'text']);

    const ids = [...html().matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toContain('prop-font-size');
    expect(ids).toContain('prop-label-font-size');
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('painel: negrito do texto da forma (US-SL.10)', () => {
  const pressed = (html: string) =>
    /data-field=label-bold[^>]*aria-pressed=(\w+)|aria-pressed=(\w+)[^>]*data-field=label-bold/.exec(
      html,
    );
  const stateOf = (html: string): string | undefined => {
    const chunk = html.slice(
      html.indexOf('data-field="label-bold"') - 200,
      html.indexOf('data-field="label-bold"') + 300,
    );
    return /aria-pressed=(\w+)/.exec(chunk)?.[1];
  };

  it('aria-pressed true com bold ou peso ≥ 600, false com normal ou < 600', () => {
    expect(stateOf(labelled([{ text: 'x', fontWeight: 'bold' }]).html())).toBe('true');
    expect(stateOf(labelled([{ text: 'x', fontWeight: 600 }]).html())).toBe('true');
    expect(stateOf(labelled([{ text: 'x', fontWeight: 900 }]).html())).toBe('true');
    expect(stateOf(labelled([{ text: 'x', fontWeight: 'normal' }]).html())).toBe('false');
    expect(stateOf(labelled([{ text: 'x', fontWeight: 500 }]).html())).toBe('false');
    expect(stateOf(setup().html())).toBe('false');
    expect(pressed).toBeDefined();
  });

  it('com formas divergentes, aria-pressed é "mixed"', () => {
    const html = labelled([
      { text: 'x', fontWeight: 'bold' },
      { text: 'y', fontWeight: 'normal' },
    ]).html();

    expect(stateOf(html)).toBe('mixed');
  });

  it('ativar a partir de "mixed" aplica bold a todas; ativar de pressionado volta a normal', () => {
    const { section, internals } = labelled([
      { text: 'x', fontWeight: 'bold' },
      { text: 'y', fontWeight: 'normal' },
    ]);

    internals._onLabelBold();
    expect(labelOf(section, 's0')).toMatchObject({ fontWeight: 'bold' });
    expect(labelOf(section, 's1')).toMatchObject({ fontWeight: 'bold' });

    internals._onLabelBold();
    expect(labelOf(section, 's0')).toMatchObject({ fontWeight: 'normal' });
    expect(labelOf(section, 's1')).toMatchObject({ fontWeight: 'normal' });
  });

  it('um peso numérico ≥ 600 desliga para normal', () => {
    const { section, internals } = labelled([{ text: 'x', fontWeight: 700 }]);

    internals._onLabelBold();

    expect(labelOf(section, 's0')).toMatchObject({ fontWeight: 'normal' });
  });
});

describe('painel: cor do texto da forma (US-SL.10)', () => {
  const colorChunk = (html: string) => {
    const start = html.indexOf('data-field="label-color"');
    return html.slice(start - 300, start + 400);
  };
  const autoPressed = (html: string) => {
    const start = html.indexOf('data-field="label-color-auto"');
    return /aria-pressed=(\w+)/.exec(html.slice(start - 200, start + 300))?.[1];
  };

  it('com todas em automático (null), "Automática" fica pressionada; escolher uma cor tira', () => {
    const { section, internals, html } = labelled([{ text: 'x' }, { text: 'y' }]);
    expect(autoPressed(html())).toBe('true');

    internals._onLabelColor('#FF0000');

    expect(labelOf(section, 's0')).toMatchObject({ color: '#ff0000' });
    expect(labelOf(section, 's1')).toMatchObject({ color: '#ff0000' });
    expect(autoPressed(html())).toBe('false');
  });

  it('o botão Automática volta a null em todas, numa entrada de histórico', () => {
    const { section, internals } = labelled([
      { text: 'x', color: '#ff0000' },
      { text: 'y', color: '#00ff00' },
    ]);
    const revision = section.getSnapshot().revision;

    internals._onLabelColorAuto();

    expect(section.getSnapshot().revision).toBe(revision + 1);
    expect(labelOf(section, 's0')).toMatchObject({ color: null });
    expect(labelOf(section, 's1')).toMatchObject({ color: null });
  });

  it('com cores efetivas diferentes, o rótulo indica "misto" e nenhum valor comum aparece', () => {
    const chunk = colorChunk(
      labelled([
        { text: 'x', color: '#ff0000' },
        { text: 'y', color: '#0000ff' },
      ]).html(),
    );

    expect(chunk).toContain('Misto');
    expect(chunk).not.toContain('#ff0000');
    expect(chunk).not.toContain('#0000ff');
  });

  it('a cor efetiva (automática sobre o fill) é a mostrada quando todas coincidem', () => {
    const { html } = setup(['rectangle'], {
      style: { fill: '#000000', stroke: null, strokeWidth: 0, opacity: 1 },
    });

    // Fundo preto: o texto automático é branco.
    expect(colorChunk(html())).toContain('#ffffff');
  });

  it('cores inválidas são ignoradas', () => {
    const { section, internals } = setup();
    const before = section.getSnapshot();

    for (const value of ['', 'azul', '#fff', '#12345g']) internals._onLabelColor(value);

    expect(section.getSnapshot()).toBe(before);
  });
});

describe('painel: os três controles desabilitam como os rádios', () => {
  it('em readOnly, bloqueado e bloqueio remoto', () => {
    const readOnly = setup();
    readOnly.section.setReadOnly(true);
    const locked = setup(['rectangle'], { locked: true });
    const peer = setup();
    peer.section.setPeers([PEER(['s0'])]);

    for (const { html } of [readOnly, locked, peer]) {
      const text = html();
      const select = text.slice(
        text.indexOf('id="prop-label-font-size"'),
        text.indexOf('</select>', text.indexOf('id="prop-label-font-size"')),
      );
      expect(select).toMatch(/\?disabled=true/);
      for (const field of ['label-bold', 'label-color', 'label-color-auto']) {
        const at = text.indexOf(`data-field="${field}"`);
        expect(text.slice(at - 300, at + 300), field).toMatch(/\?disabled=true/);
      }
    }
  });
});

describe('painel: textos de tamanho, negrito e cor (i18n)', () => {
  it('existem em pt-BR e en', () => {
    expect([
      defaultI18nPtBR.properties.labelBold,
      defaultI18nPtBR.properties.labelColor,
      defaultI18nPtBR.properties.labelColorAuto,
    ]).toEqual(['Negrito', 'Cor do texto', 'Automática']);
    expect([
      defaultI18nEnUS.properties.labelBold,
      defaultI18nEnUS.properties.labelColor,
      defaultI18nEnUS.properties.labelColorAuto,
    ]).toEqual(['Bold', 'Text color', 'Automatic']);
  });
});
