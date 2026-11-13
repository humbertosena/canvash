import { createCanvasSection, type CanvasDocument } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { projectScene, type RenderableBoard } from './scene.js';

// A opção `boardTitles` de projectScene (spec board-export, US-BE.3): sem título, só no board.

function documentWithBoard(): CanvasDocument {
  const section = createCanvasSection();
  const result = section.transact([
    {
      type: 'shape.create',
      shape: { id: 'b', type: 'board', x: 100, y: 50, width: 300, height: 200, title: 'Fluxo' },
    },
    {
      type: 'shape.create',
      shape: {
        id: 'c',
        type: 'rectangle',
        x: 120,
        y: 80,
        width: 40,
        height: 30,
        rotation: 0,
        style: { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 },
      },
    },
    { type: 'board.attach', boardId: 'b', ids: ['c'] },
  ] as never);
  expect(result.ok).toBe(true);
  return section.getSnapshot().document;
}

describe('projectScene com boardTitles', () => {
  it('com false o board sai sem title e os outros itens ficam iguais', () => {
    const document = documentWithBoard();

    const withTitles = projectScene(document);
    const withoutTitles = projectScene(document, { boardTitles: false });

    const board = withoutTitles.items.find((item) => item.type === 'board') as RenderableBoard;
    expect(board).not.toHaveProperty('title');
    expect(board).toMatchObject({ id: 'b', fill: '#ffffff', stroke: '#d4d4d8' });
    expect(withoutTitles.items.filter((item) => item.type !== 'board')).toEqual(
      withTitles.items.filter((item) => item.type !== 'board'),
    );
    expect(withoutTitles.items.map((item) => item.id)).toEqual(
      withTitles.items.map((item) => item.id),
    );
  });

  it('sem a opção e com true a cena é a de hoje, com o título', () => {
    const document = documentWithBoard();

    const byDefault = projectScene(document);

    expect(projectScene(document, { boardTitles: true })).toEqual(byDefault);
    const board = byDefault.items.find((item) => item.type === 'board') as RenderableBoard;
    expect(board.title).toBe('Fluxo');
  });

  it('o título some também do board que vem de um preview', () => {
    const document = documentWithBoard();

    const scene = projectScene(document, {
      boardTitles: false,
      preview: {
        updates: {
          b: {
            id: 'b',
            type: 'board',
            x: 150,
            y: 50,
            width: 300,
            height: 200,
            title: 'Fluxo',
            style: { fill: '#ffffff', fillOpacity: 1, stroke: '#d4d4d8' },
            childIds: ['c'],
            visible: true,
            locked: false,
          },
        },
        additions: [],
        marquee: null,
      } as never,
    });

    const board = scene.items.find((item) => item.type === 'board') as RenderableBoard;
    expect(board.x).toBe(150);
    expect(board).not.toHaveProperty('title');
  });
});
