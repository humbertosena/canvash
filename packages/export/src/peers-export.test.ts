import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { exportSvg } from './svg.js';

describe('exportação ignora os participantes remotos (US-PC.3)', () => {
  it('o SVG é idêntico com e sem peers, e não cita nome nem cor deles', async () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'r1',
        type: 'rectangle',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        rotation: 0,
        style: { fill: '#ffffff', stroke: null, strokeWidth: 1, opacity: 1 },
      },
    });
    const before = await exportSvg(section);

    section.setPeers([
      {
        sessionId: 'p1',
        name: 'Participante Secreto',
        color: '#ab12cd',
        cursor: { x: 15, y: 25 },
        selection: ['r1'],
        selectedAt: 1,
        drag: { ids: ['r1'], dx: 30, dy: 30 },
        view: null,
        locks: ['r1'],
        followed: true,
      },
    ]);
    const after = await exportSvg(section);

    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(after.value).toBe(before.value);
    expect(after.value).not.toContain('Secreto');
    expect(after.value.toLowerCase()).not.toContain('ab12cd');
  });
});

describe('exportação ignora o contorno e a prévia remotos de um board (US-BD.16)', () => {
  it('o SVG com board é idêntico com e sem peers, e não cita nome nem cor deles', async () => {
    const section = createCanvasSection();
    section.transact([
      {
        type: 'shape.create',
        shape: { id: 'b', type: 'board', x: 10, y: 40, width: 200, height: 100, title: 'Fluxo' },
      },
      {
        type: 'shape.create',
        shape: {
          id: 'c',
          type: 'rectangle',
          x: 30,
          y: 60,
          width: 40,
          height: 30,
          rotation: 0,
          style: { fill: '#ffffff', stroke: null, strokeWidth: 1, opacity: 1 },
        },
      },
      { type: 'board.attach', boardId: 'b', ids: ['c'] },
    ] as never);
    const before = await exportSvg(section);

    section.setPeers([
      {
        sessionId: 'p1',
        name: 'Participante Secreto',
        color: '#ab12cd',
        cursor: { x: 15, y: 25 },
        selection: ['b'],
        selectedAt: 1,
        drag: { ids: ['b', 'c'], dx: 30, dy: 30 },
        view: null,
        locks: ['b'],
        released: ['c'],
        followed: true,
      },
    ]);
    const after = await exportSvg(section);

    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(after.value).toBe(before.value);
    expect(after.value).toContain('Fluxo');
    expect(after.value).not.toContain('Secreto');
    expect(after.value.toLowerCase()).not.toContain('ab12cd');
  });
});
