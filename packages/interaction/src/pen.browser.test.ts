import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCanvasSection, type CanvasSectionApi, type InkNode } from '@canvash/core';
import { attachInteractions, type InteractionHandle } from './index.js';

type PointerKind = 'mouse' | 'touch' | 'pen';

describe('Caneta no navegador real: mouse, toque e stylus', () => {
  let container: HTMLElement;
  let section: CanvasSectionApi;
  let handle: InteractionHandle;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '600px';
    container.style.height = '400px';
    container.style.position = 'relative';
    document.body.appendChild(container);
    section = createCanvasSection();
    section.setViewport({ x: 0, y: 0, zoom: 1 });
    section.setTool('pen');
    handle = attachInteractions({ section, element: container });
  });

  afterEach(() => {
    handle.destroy();
    container.remove();
  });

  const inks = (): InkNode[] =>
    Object.values(section.getSnapshot().document.nodes).filter(
      (node): node is InkNode => node.type === 'ink',
    );

  function fire(
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
    kind: PointerKind,
    x: number,
    y: number,
    extra: { pointerId?: number; coalesced?: Array<{ x: number; y: number }> } = {},
  ): void {
    const rect = container.getBoundingClientRect();
    const event = new PointerEvent(type, {
      pointerId: extra.pointerId ?? 1,
      pointerType: kind,
      button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      clientX: rect.left + x,
      clientY: rect.top + y,
      bubbles: true,
    });
    if (extra.coalesced) {
      const samples = extra.coalesced.map(
        (p) =>
          new PointerEvent('pointermove', { clientX: rect.left + p.x, clientY: rect.top + p.y }),
      );
      Object.defineProperty(event, 'getCoalescedEvents', { value: () => samples });
    }
    container.dispatchEvent(event);
  }

  const PATH = [
    { x: 40, y: 40 },
    { x: 90, y: 90 },
    { x: 140, y: 40 },
    { x: 190, y: 90 },
  ];

  function draw(kind: PointerKind): void {
    fire('pointerdown', kind, PATH[0]!.x, PATH[0]!.y);
    for (const p of PATH.slice(1)) fire('pointermove', kind, p.x, p.y);
    const last = PATH[PATH.length - 1]!;
    fire('pointerup', kind, last.x, last.y);
  }

  it('desenhar mostra o preview, e soltar cria o elemento e limpa o estado', () => {
    fire('pointerdown', 'mouse', 40, 40);
    expect(handle.getState()).toBe('drawing');
    fire('pointermove', 'mouse', 90, 90);
    expect(section.getPreview()?.additions).toHaveLength(1);
    fire('pointerup', 'mouse', 90, 90);
    expect(handle.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
    expect(inks()).toHaveLength(1);
  });

  it('mouse, toque e stylus produzem o mesmo documento para o mesmo caminho', () => {
    const documents: unknown[] = [];
    for (const kind of ['mouse', 'touch', 'pen'] as const) {
      section.replaceDocument({
        schemaVersion: 1,
        id: 'doc',
        layers: [{ id: 'l', name: 'L', visible: true, locked: false, childIds: [] }],
        nodes: {},
      });
      section.setTool('select');
      section.setTool('pen');
      draw(kind);
      const [ink] = inks();
      documents.push({ ...ink, id: 'x' });
    }
    expect(documents[1]).toEqual(documents[0]);
    expect(documents[2]).toEqual(documents[0]);
  });

  it('o segundo dedo cancela o traço sem histórico e passa a ser pinch', () => {
    const before = section.getSnapshot().revision;
    fire('pointerdown', 'touch', 40, 40, { pointerId: 1 });
    fire('pointermove', 'touch', 90, 90, { pointerId: 1 });
    expect(handle.getState()).toBe('drawing');
    fire('pointerdown', 'touch', 300, 300, { pointerId: 2 });
    expect(handle.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
    fire('pointerup', 'touch', 300, 300, { pointerId: 2 });
    fire('pointerup', 'touch', 90, 90, { pointerId: 1 });
    expect(inks()).toHaveLength(0);
    expect(section.getSnapshot().revision).toBe(before);
  });

  it('usa as amostras coalescidas quando o navegador as entrega', () => {
    fire('pointerdown', 'pen', 10, 10);
    fire('pointermove', 'pen', 50, 50, {
      coalesced: [
        { x: 20, y: 20 },
        { x: 30, y: 30 },
        { x: 40, y: 40 },
        { x: 50, y: 50 },
      ],
    });
    const preview = section.getPreview()!.additions[0] as unknown as {
      strokes: Array<{ points: unknown[] }>;
    };
    // O ponto de partida mais as quatro amostras.
    expect(preview.strokes[0]!.points).toHaveLength(5);
  });

  it('sem getCoalescedEvents, ou com uma amostra só, usa o evento principal', () => {
    fire('pointerdown', 'mouse', 10, 10);
    fire('pointermove', 'mouse', 50, 50);
    fire('pointermove', 'mouse', 80, 80, { coalesced: [{ x: 80, y: 80 }] });
    const preview = section.getPreview()!.additions[0] as unknown as {
      strokes: Array<{ points: unknown[] }>;
    };
    expect(preview.strokes[0]!.points).toHaveLength(3);
  });

  it('pointercancel descarta o traço, sem histórico e sem preview', () => {
    const before = section.getSnapshot().revision;
    fire('pointerdown', 'pen', 10, 10);
    fire('pointermove', 'pen', 60, 60);
    fire('pointercancel', 'pen', 60, 60);
    expect(handle.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
    expect(section.getSnapshot().revision).toBe(before);
  });

  it('perder a captura do ponteiro descarta o traço', () => {
    fire('pointerdown', 'mouse', 10, 10);
    fire('pointermove', 'mouse', 60, 60);
    container.dispatchEvent(
      new PointerEvent('lostpointercapture', { pointerId: 1, bubbles: true }),
    );
    expect(handle.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
    expect(inks()).toHaveLength(0);
  });

  it('o blur da janela descarta o traço', () => {
    fire('pointerdown', 'mouse', 10, 10);
    fire('pointermove', 'mouse', 60, 60);
    window.dispatchEvent(new Event('blur'));
    expect(handle.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
    expect(inks()).toHaveLength(0);
  });

  it('Esc pelo teclado descarta o traço', () => {
    fire('pointerdown', 'mouse', 10, 10);
    fire('pointermove', 'mouse', 60, 60);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    expect(handle.getState()).toBe('idle');
    expect(inks()).toHaveLength(0);
  });

  it('destruir o handle no meio do gesto limpa o preview', () => {
    fire('pointerdown', 'mouse', 10, 10);
    fire('pointermove', 'mouse', 60, 60);
    handle.destroy();
    expect(section.getPreview()).toBeNull();
    expect(inks()).toHaveLength(0);
  });

  it('o cursor é a cruz durante o desenho e depois dele', () => {
    fire('pointerdown', 'mouse', 10, 10);
    expect(container.style.cursor).toBe('crosshair');
    fire('pointerup', 'mouse', 10, 10);
    expect(container.style.cursor).toBe('crosshair');
  });

  it('setPenSettings pelo handle vale para o próximo traço', () => {
    expect(handle.getPenSettings()).toEqual({ color: '#1f2937', kind: 'pen', width: 'medium' });
    handle.setPenSettings({ color: '#ef4444', kind: 'highlighter', width: 'thick' });
    draw('mouse');
    expect(inks()[0]!.strokes[0]).toMatchObject({
      color: '#ef4444',
      kind: 'highlighter',
      width: 'thick',
    });
  });
});
