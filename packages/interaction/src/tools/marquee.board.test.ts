import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { executeMarqueeSelection, resolveMarqueeGroupIds } from './marquee.js';
import { resolveSelectableId } from './select.js';

// A marquee e o clique com boards (spec boards, §5.3 e US-BD.7): o board só entra quando a marquee
// o contém inteiro, e o descendente de um board selecionado não entra à parte.

describe('marquee e seleção com boards', () => {
  let section: CanvasSectionApi;

  const rect = (id: string, x: number, y: number) => ({
    type: 'shape.create' as const,
    shape: { id, type: 'rectangle' as const, x, y, width: 20, height: 20, rotation: 0 },
  });

  beforeEach(() => {
    section = createCanvasSection();
    section.transact([
      {
        type: 'shape.create',
        shape: { id: 'b', type: 'board', x: 100, y: 100, width: 300, height: 200 },
      },
      rect('c1', 120, 130),
      rect('m1', 200, 130),
      rect('m2', 240, 130),
      rect('out', 600, 130),
      { type: 'group.create', id: 'g', childIds: ['m1', 'm2'] },
      { type: 'board.attach', boardId: 'b', ids: ['c1', 'g'] },
    ] as never);
  });

  const document = () => section.getSnapshot().document;
  const sorted = (ids: readonly string[]) => [...ids].sort();

  describe('resolveMarqueeGroupIds', () => {
    it('o board pego inteiro entra, nos dois modos, sem os descendentes separados', () => {
      const around = { x: 90, y: 60, width: 330, height: 260 };
      const contained = section.queryMarquee(around, { mode: 'contain', includePreview: false });
      const touched = section.queryMarquee(around, { mode: 'intersect', includePreview: false });

      expect(sorted(resolveMarqueeGroupIds(document(), contained, 'contain', around))).toEqual([
        'b',
      ]);
      expect(sorted(resolveMarqueeGroupIds(document(), touched, 'intersect', around))).toEqual([
        'b',
      ]);
    });

    it('o board só tocado pela marquee não entra: a marquee que começa dentro dele pega os filhos', () => {
      const inside = { x: 110, y: 120, width: 160, height: 60 };
      const touched = section.queryMarquee(inside, { mode: 'intersect', includePreview: false });

      expect(touched).toContain('b');
      expect(sorted(resolveMarqueeGroupIds(document(), touched, 'intersect', inside))).toEqual([
        'c1',
        'g',
      ]);
    });

    it('contida inteira dentro do board, a marquee pega só os filhos pegos', () => {
      const inside = { x: 110, y: 120, width: 100, height: 60 };
      const contained = section.queryMarquee(inside, { mode: 'contain', includePreview: false });

      expect(sorted(resolveMarqueeGroupIds(document(), contained, 'contain', inside))).toEqual([
        'c1',
      ]);
    });

    it('sem o retângulo, o board tocado no modo intersect não entra (nada a conferir)', () => {
      expect(resolveMarqueeGroupIds(document(), ['b', 'out'], 'intersect')).toEqual(['out']);
    });

    it('o descendente de um board que já entrou não entra à parte', () => {
      expect(
        sorted(
          resolveMarqueeGroupIds(document(), ['b', 'c1', 'm1', 'm2', 'out'], 'contain', {
            x: 0,
            y: 0,
            width: 1000,
            height: 1000,
          }),
        ),
      ).toEqual(['b', 'out']);
    });
  });

  describe('executeMarqueeSelection', () => {
    it('US-BD.7: a marquee que contém o board inteiro seleciona o board e mais nada dele', () => {
      const around = { x: 90, y: 60, width: 330, height: 260 };

      executeMarqueeSelection(section, around, 'contain', false, []);
      expect(section.getSnapshot().session.selectedIds).toEqual(['b']);

      executeMarqueeSelection(section, around, 'intersect', false, []);
      expect(section.getSnapshot().session.selectedIds).toEqual(['b']);
    });

    it('a marquee que começa dentro do board seleciona os filhos e nunca o board', () => {
      executeMarqueeSelection(
        section,
        { x: 110, y: 120, width: 200, height: 60 },
        'intersect',
        false,
        [],
      );

      expect(sorted(section.getSnapshot().session.selectedIds)).toEqual(['c1', 'g']);
    });
  });

  describe('resolveSelectableId', () => {
    it('um filho de board é selecionável direto, e o membro de grupo dentro do board vira o grupo', () => {
      expect(resolveSelectableId(document(), 'c1')).toBe('c1');
      expect(resolveSelectableId(document(), 'b')).toBe('b');
      expect(resolveSelectableId(document(), 'm1')).toBe('g');
    });
  });
});
