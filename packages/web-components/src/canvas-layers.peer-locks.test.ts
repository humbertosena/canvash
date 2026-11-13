import { createCanvasSection, type CanvasPeer } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { CanvasLayersElement } from './canvas-layers.js';
import { defaultI18nEnUS, defaultI18nPtBR } from './i18n.js';

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
  if (typeof result === 'symbol') return '';
  return String(result);
}

const holder = (locks: string[], name = 'Ana'): CanvasPeer => ({
  sessionId: 'outra',
  name,
  color: '#dc2626',
  cursor: null,
  selection: locks,
  selectedAt: 1,
  drag: null,
  view: null,
  locks,
  followed: false,
});

interface Testable {
  _selectNode(nodeId: string, event: MouseEvent | KeyboardEvent): void;
}

function layersWith(...ids: string[]) {
  const section = createCanvasSection();
  for (const id of ids) {
    section.dispatch({
      type: 'shape.create',
      shape: {
        id,
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        style: { fill: '#ffffff', stroke: null, strokeWidth: 1, opacity: 1 },
      },
    });
  }
  const el = new CanvasLayersElement();
  el.section = section;
  return { section, el };
}

const click = { shiftKey: false, metaKey: false, ctrlKey: false } as MouseEvent;

describe('<canvas-layers>: nó bloqueado por outro participante (US-RL.2)', () => {
  it('mostra o cadeado só no nó bloqueado, com a dica em pt-BR', () => {
    const { section, el } = layersWith('a', 'b');
    section.setPeers([holder(['a'])]);

    const html = templateText(el.render());

    expect(html.match(/part="node-peer-lock"/g)).toHaveLength(1);
    expect(html).toContain('aria-label=Em edição por Ana');
    expect(html).toContain('data-peer-locked=true');
    expect(html).toContain('color: #dc2626');
  });

  it('sem bloqueios não mostra cadeado', () => {
    const { el } = layersWith('a');

    expect(templateText(el.render())).not.toContain('node-peer-lock');
  });

  it('clicar no nó bloqueado não o seleciona, e o livre continua selecionando', () => {
    const { section, el } = layersWith('a', 'b');
    section.setPeers([holder(['a'])]);

    (el as unknown as Testable)._selectNode('a', click);
    expect(section.getSnapshot().session.selectedIds).toEqual([]);

    (el as unknown as Testable)._selectNode('b', click);
    expect(section.getSnapshot().session.selectedIds).toEqual(['b']);
  });

  it('quem trava um membro de grupo mostra o cadeado na linha do grupo', () => {
    const { section, el } = layersWith('a', 'b', 'c');
    section.dispatch({ type: 'group.create', id: 'g', childIds: ['a', 'b'] });
    section.setPeers([holder(['a'])]);

    const html = templateText(el.render());

    // A camada lista o grupo, não os membros: o cadeado aparece uma vez, na linha dele.
    expect(html.match(/part="node-peer-lock"/g)).toHaveLength(1);
    expect(html).toContain('data-node-id=g');
  });

  it('a mensagem existe em pt-BR e em en', () => {
    expect(defaultI18nPtBR.layers.lockedBy('Ana')).toBe('Em edição por Ana');
    expect(defaultI18nEnUS.layers.lockedBy('Ana')).toBe('Being edited by Ana');
  });
});
