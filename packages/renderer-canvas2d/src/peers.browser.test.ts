import { createCanvasSection, type CanvasSectionApi, type CanvasPeer } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount, type RendererHandle } from './index.js';

const peer = (overrides: Partial<CanvasPeer> = {}): CanvasPeer => ({
  sessionId: 'p1',
  name: 'Ana',
  color: '#dc2626',
  cursor: { x: 10, y: 5 },
  selection: [],
  selectedAt: null,
  drag: null,
  view: null,
  locks: [],
  followed: false,
  ...overrides,
});

describe('cursores dos peers no renderer (navegador real)', () => {
  let container: HTMLDivElement;
  let section: CanvasSectionApi;
  let handle: RendererHandle;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.cssText = 'position:relative;width:400px;height:300px';
    document.body.appendChild(container);
    section = createCanvasSection();
    const result = mount({ section, container });
    if (!result.ok) throw new Error('mount falhou');
    handle = result.value;
  });

  afterEach(() => {
    handle.destroy();
    container.remove();
  });

  const cursors = () => [
    ...container.querySelectorAll<HTMLElement>('[data-testid="remote-cursor"]'),
  ];
  const screenOf = (el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    const origin = container.getBoundingClientRect();
    return { x: box.left - origin.left, y: box.top - origin.top };
  };

  it('desenha um cursor por peer com ponteiro, na posição de tela do ponto de mundo', async () => {
    section.setViewport({ x: 50, y: 20, zoom: 2 });
    section.setPeers([peer(), peer({ sessionId: 'p2', cursor: null })]);

    const layer = container.querySelector('[data-testid="remote-cursors-layer"]');
    expect(layer).not.toBeNull();
    expect(cursors()).toHaveLength(1);
    expect(cursors()[0]?.dataset['sessionId']).toBe('p1');
    // (10, 5) em mundo, zoom 2 e pan (50, 20): (70, 30) na tela, menos o deslocamento do desenho.
    await expect.poll(() => screenOf(cursors()[0]!).x).toBeCloseTo(68, 0);
    await expect.poll(() => screenOf(cursors()[0]!).y).toBeCloseTo(28, 0);
  });

  it('acompanha pan e zoom pela área viewport', async () => {
    section.setPeers([peer()]);

    section.setViewport({ x: 100, y: 0, zoom: 1 });
    await expect.poll(() => screenOf(cursors()[0]!).x).toBeCloseTo(108, 0);

    section.setViewport({ x: 0, y: 0, zoom: 4 });
    await expect.poll(() => screenOf(cursors()[0]!).x).toBeCloseTo(38, 0);
    await expect.poll(() => screenOf(cursors()[0]!).y).toBeCloseTo(18, 0);
  });

  it('mostra o nome como texto, nunca como HTML, e não captura o ponteiro', () => {
    section.setPeers([peer({ name: '<img src=x onerror=alert(1)>' })]);

    const el = cursors()[0]!;
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(el.querySelector('img')).toBeNull();
    expect(getComputedStyle(el).pointerEvents).toBe('none');
    expect(
      getComputedStyle(container.querySelector('[data-testid="remote-cursors-layer"]')!)
        .pointerEvents,
    ).toBe('none');
  });

  it('usa a cor do participante no cursor', () => {
    section.setPeers([peer({ color: '#2563eb' })]);

    const svg = cursors()[0]!.querySelector('svg')!;
    expect(svg.getAttribute('fill')).toBe('#2563eb');
  });

  it('tira o cursor quando o peer sai ou perde o ponteiro', () => {
    section.setPeers([peer(), peer({ sessionId: 'p2' })]);
    expect(cursors()).toHaveLength(2);

    section.setPeers([peer({ cursor: null })]);
    expect(cursors()).toHaveLength(0);

    section.setPeers([]);
    expect(cursors()).toHaveLength(0);
  });

  it('reaproveita o elemento do mesmo peer entre atualizações', () => {
    section.setPeers([peer()]);
    const first = cursors()[0];

    section.setPeers([peer({ cursor: { x: 50, y: 50 } })]);

    expect(cursors()[0]).toBe(first);
  });

  it('não escreve nada na superfície do canvas nem muda o documento', () => {
    const revision = section.getSnapshot().revision;
    section.setPeers([peer()]);

    expect(section.getSnapshot().revision).toBe(revision);
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('depois do destroy a camada sai do container e o canvas deixa de ser ouvido', () => {
    section.setPeers([peer()]);
    handle.destroy();

    expect(container.querySelector('[data-testid="remote-cursors-layer"]')).toBeNull();
    section.setPeers([peer({ sessionId: 'p9' })]);
    expect(container.querySelector('[data-testid="remote-cursors-layer"]')).toBeNull();
  });

  it('mostra os peers que já estavam no canvas ao montar', () => {
    handle.destroy();
    section.setPeers([peer()]);
    const result = mount({ section, container });
    if (!result.ok) throw new Error('mount falhou');
    handle = result.value;

    expect(cursors()).toHaveLength(1);
  });
});

describe('contorno de bloqueio dos peers no canvas (navegador real)', () => {
  let container: HTMLDivElement;
  let section: CanvasSectionApi;
  let handle: RendererHandle;

  const pixel = (cssX: number, cssY: number): [number, number, number] => {
    const canvas = container.querySelector('canvas')!;
    const ratio = canvas.width / container.clientWidth;
    const data = canvas
      .getContext('2d')!
      .getImageData(Math.round(cssX * ratio), Math.round(cssY * ratio), 1, 1).data;
    return [data[0]!, data[1]!, data[2]!];
  };
  const isRed = ([r, g, b]: [number, number, number]) => r > 190 && g < 80 && b < 80;

  const addBox = (id: string) =>
    section.dispatch({
      type: 'shape.create',
      shape: {
        id,
        type: 'rectangle',
        x: 10,
        y: 10,
        width: 50,
        height: 40,
        rotation: 0,
        style: { fill: '#ffffff', stroke: null, strokeWidth: 0, opacity: 1 },
      },
    });

  beforeEach(() => {
    container = document.createElement('div');
    container.style.cssText = 'position:relative;width:400px;height:300px';
    document.body.appendChild(container);
    section = createCanvasSection();
    const result = mount({ section, container });
    if (!result.ok) throw new Error('mount falhou');
    handle = result.value;
  });

  afterEach(() => {
    handle.destroy();
    container.remove();
  });

  const settle = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

  it('pinta a borda da caixa do nó bloqueado na cor do participante, depois de pan e zoom', async () => {
    addBox('a');
    section.setViewport({ x: 20, y: 10, zoom: 2 });
    section.setPeers([peer({ locks: ['a'] })]);
    await settle();

    // Caixa em tela: x de 40 a 140, y de 30 a 110. A borda esquerda fica em x = 40.
    expect(isRed(pixel(40, 70))).toBe(true);
    expect(isRed(pixel(90, 110))).toBe(true);
    // Dentro da caixa continua o preenchimento do nó, sem alças nem tinta do participante.
    expect(isRed(pixel(90, 70))).toBe(false);
  });

  it('desenha a etiqueta com o nome no canto superior esquerdo', async () => {
    addBox('a');
    section.setViewport({ x: 20, y: 40, zoom: 2 });
    section.setPeers([peer({ locks: ['a'], name: 'Ana' })]);
    await settle();

    // Caixa começa em (40, 60): a etiqueta fica logo acima, alinhada à esquerda.
    expect(isRed(pixel(43, 52))).toBe(true);
  });

  it('não desenha nada para um bloqueio de nó que não existe', async () => {
    section.setViewport({ x: 20, y: 10, zoom: 2 });
    section.setPeers([peer({ locks: ['fantasma'] })]);
    await settle();

    for (const [x, y] of [
      [40, 30],
      [40, 70],
      [100, 30],
    ] as const) {
      expect(isRed(pixel(x, y))).toBe(false);
    }
  });

  it('tira o contorno quando o bloqueio é liberado', async () => {
    addBox('a');
    section.setViewport({ x: 20, y: 10, zoom: 2 });
    section.setPeers([peer({ locks: ['a'] })]);
    await settle();
    expect(isRed(pixel(40, 70))).toBe(true);

    section.setPeers([]);
    await settle();

    expect(isRed(pixel(40, 70))).toBe(false);
  });

  it('o bloqueio não muda o documento nem a revisão', async () => {
    addBox('a');
    const revision = section.getSnapshot().revision;
    section.setPeers([peer({ locks: ['a'] })]);
    await settle();

    expect(section.getSnapshot().revision).toBe(revision);
  });
});

describe('prévia do arrasto remoto no canvas (navegador real)', () => {
  let container: HTMLDivElement;
  let section: CanvasSectionApi;
  let handle: RendererHandle;

  const mountWith = (peersOption?: { dragPreview?: boolean }) => {
    handle?.destroy();
    const result = mount({ section, container, ...(peersOption ? { peers: peersOption } : {}) });
    if (!result.ok) throw new Error('mount falhou');
    handle = result.value;
  };

  const rgba = (cssX: number, cssY: number): [number, number, number, number] => {
    const canvas = container.querySelector('canvas')!;
    const ratio = canvas.width / container.clientWidth;
    const data = canvas
      .getContext('2d')!
      .getImageData(Math.round(cssX * ratio), Math.round(cssY * ratio), 1, 1).data;
    return [data[0]!, data[1]!, data[2]!, data[3]!];
  };
  const isRed = ([r, g, b, a]: [number, number, number, number]) =>
    a > 100 && r > 190 && g < 90 && b < 90;
  const settle = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

  const dragger = (overrides: Partial<CanvasPeer> = {}): CanvasPeer =>
    peer({
      locks: ['a'],
      selection: ['a'],
      drag: { ids: ['a'], dx: 100, dy: 0 },
      ...overrides,
    });

  beforeEach(() => {
    container = document.createElement('div');
    container.style.cssText = 'position:relative;width:400px;height:300px';
    document.body.appendChild(container);
    section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'a',
        type: 'rectangle',
        x: 20,
        y: 50,
        width: 60,
        height: 40,
        rotation: 0,
        style: { fill: '#2563eb', stroke: null, strokeWidth: 0, opacity: 1 },
      },
    });
    mountWith();
  });

  afterEach(() => {
    handle.destroy();
    container.remove();
  });

  it('desenha só o contorno do nó deslocado, na cor do participante, sem preenchimento', async () => {
    section.setPeers([dragger()]);
    await settle();

    // Borda esquerda do nó deslocado: x = 20 + 100.
    expect(isRed(rgba(120, 70))).toBe(true);
    // Dentro do contorno: sem preenchimento, o canvas segue transparente.
    expect(rgba(150, 70)[3]).toBe(0);
    // A forma real fica onde estava, azul.
    const real = rgba(50, 70);
    expect(real[2]).toBeGreaterThan(150);
    expect(real[0]).toBeLessThan(80);
  });

  it('o traço tem opacidade 0,8 e acompanha o zoom em px de tela', async () => {
    section.setViewport({ x: 0, y: 0, zoom: 2 });
    section.setPeers([dragger({ drag: { ids: ['a'], dx: 100, dy: 0 } })]);
    await settle();

    // Nó em (20,50) com dx 100 e zoom 2: borda esquerda em x = 240, de y = 100 a y = 180.
    const edge = rgba(239, 140);
    expect(isRed(edge)).toBe(true);
    expect(edge[3]).toBeGreaterThan(110);
    expect(edge[3]).toBeLessThan(240);
    // Traço de 1,5 px em tela: o pixel a 4 px da borda já está fora.
    expect(rgba(244, 140)[3]).toBe(0);
  });

  it('cada amostra move a prévia sem interpolar', async () => {
    section.setPeers([dragger({ drag: { ids: ['a'], dx: 100, dy: 0 } })]);
    await settle();
    expect(isRed(rgba(120, 70))).toBe(true);

    section.setPeers([dragger({ drag: { ids: ['a'], dx: 200, dy: 0 } })]);
    await settle();

    expect(isRed(rgba(120, 70))).toBe(false);
    expect(isRed(rgba(220, 70))).toBe(true);
  });

  it('drag nulo, ou nó que o participante não detém, não desenha nada', async () => {
    section.setPeers([dragger({ drag: null })]);
    await settle();
    expect(isRed(rgba(120, 70))).toBe(false);

    section.setPeers([dragger({ locks: [] })]);
    await settle();
    expect(isRed(rgba(120, 70))).toBe(false);
  });

  it('quando o commit chega antes do drag nulo, a prévia some e a forma fica na posição final', async () => {
    section.setPeers([dragger()]);
    await settle();
    expect(isRed(rgba(120, 70))).toBe(true);

    section.dispatch({ type: 'shape.update', id: 'a', patch: { x: 120 } });
    await settle();
    // A prévia (que ficaria em x = 220) já caiu. O contorno de bloqueio, em x = 120, é outra coisa.
    expect(isRed(rgba(220, 70))).toBe(false);
    expect(rgba(300, 70)[3]).toBe(0);

    section.setPeers([dragger({ drag: null })]);
    await settle();
    expect(rgba(150, 70)[2]).toBeGreaterThan(150);
    expect(isRed(rgba(220, 70))).toBe(false);
  });

  it('quando o drag nulo chega antes do commit, também não deixa contorno', async () => {
    section.setPeers([dragger()]);
    await settle();

    section.setPeers([dragger({ drag: null })]);
    await settle();
    expect(isRed(rgba(120, 70))).toBe(false);

    section.dispatch({ type: 'shape.update', id: 'a', patch: { x: 120 } });
    await settle();
    expect(isRed(rgba(220, 70))).toBe(false);
    expect(rgba(300, 70)[3]).toBe(0);
  });

  it('com peers.dragPreview desligado nada é desenhado', async () => {
    mountWith({ dragPreview: false });
    section.setPeers([dragger()]);
    await settle();

    expect(isRed(rgba(120, 70))).toBe(false);
  });

  it('a prévia não muda o documento nem a revisão', async () => {
    const revision = section.getSnapshot().revision;
    section.setPeers([dragger()]);
    await settle();

    expect(section.getSnapshot().revision).toBe(revision);
  });
});

describe('cursor da pessoa seguida em destaque (US-FP.3)', () => {
  let container: HTMLDivElement;
  let section: CanvasSectionApi;
  let handle: RendererHandle;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.cssText = 'position:relative;width:400px;height:300px';
    document.body.appendChild(container);
    section = createCanvasSection();
    const result = mount({ section, container });
    if (!result.ok) throw new Error('mount falhou');
    handle = result.value;
  });

  afterEach(() => {
    handle.destroy();
    container.remove();
  });

  const cursorOf = (id: string) =>
    container.querySelector<HTMLElement>(`[data-testid="remote-cursor"][data-session-id="${id}"]`)!;

  it('o cursor seguido mede 1,25× o normal e tem data-followed; os outros ficam iguais', () => {
    section.setPeers([
      peer({ sessionId: 'normal', name: 'Bia', cursor: { x: 50, y: 50 } }),
      peer({ sessionId: 'seguido', name: 'Bia', cursor: { x: 150, y: 50 }, followed: true }),
    ]);

    const normal = cursorOf('normal');
    const followed = cursorOf('seguido');
    expect(followed.getAttribute('data-followed')).toBe('true');
    expect(normal.hasAttribute('data-followed')).toBe(false);
    const ratio = followed.getBoundingClientRect().width / normal.getBoundingClientRect().width;
    expect(ratio).toBeCloseTo(1.25, 1);
    expect(followed.querySelector('.remote-cursor-label')!.textContent).toBe('Bia');
  });

  it('o destaque acompanha o aumento sem deslocar a ponta da seta', async () => {
    section.setPeers([peer({ cursor: { x: 100, y: 100 }, followed: false })]);
    const before = cursorOf('p1').getBoundingClientRect();

    section.setPeers([peer({ cursor: { x: 100, y: 100 }, followed: true })]);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const after = cursorOf('p1').getBoundingClientRect();

    expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
    expect(after.width).toBeGreaterThan(before.width);
  });

  it('sem cursor, a etiqueta do seguido fica fixa e visível no canto superior esquerdo', () => {
    section.setPeers([peer({ name: 'Ana', cursor: null, followed: true })]);

    const pinned = container.querySelector<HTMLElement>('[data-testid="followed-label"]')!;
    expect(pinned).not.toBeNull();
    expect(pinned.textContent).toBe('Ana');
    const box = pinned.getBoundingClientRect();
    const area = container.getBoundingClientRect();
    expect(box.left - area.left).toBeLessThanOrEqual(16);
    expect(box.top - area.top).toBeLessThanOrEqual(16);
    expect(getComputedStyle(pinned).pointerEvents).toBe('none');
    expect(container.querySelectorAll('[data-testid="remote-cursor"]')).toHaveLength(0);
  });

  it('a etiqueta fixa some quando o cursor volta, quando deixa de ser seguido ou quando sai', () => {
    section.setPeers([peer({ cursor: null, followed: true })]);
    expect(container.querySelector('[data-testid="followed-label"]')).not.toBeNull();

    section.setPeers([peer({ cursor: { x: 10, y: 10 }, followed: true })]);
    expect(container.querySelector('[data-testid="followed-label"]')).toBeNull();

    section.setPeers([peer({ cursor: null, followed: false })]);
    expect(container.querySelector('[data-testid="followed-label"]')).toBeNull();

    section.setPeers([peer({ cursor: null, followed: true })]);
    section.setPeers([]);
    expect(container.querySelector('[data-testid="followed-label"]')).toBeNull();
  });

  it('o nome da etiqueta fixa entra como texto', () => {
    section.setPeers([peer({ name: '<b>x</b>', cursor: null, followed: true })]);

    const pinned = container.querySelector<HTMLElement>('[data-testid="followed-label"]')!;
    expect(pinned.textContent).toBe('<b>x</b>');
    expect(pinned.querySelector('b')).toBeNull();
  });
});
