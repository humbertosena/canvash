import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { mount } from './index.js';

describe('mount em navegador real (Vitest Browser Mode / Chromium)', () => {
  it('cria o elemento canvas no container e devolve handle com métricas e DPR corretos', () => {
    const container = document.createElement('div');
    container.style.width = '300px';
    container.style.height = '200px';
    document.body.appendChild(container);

    const section = createCanvasSection();
    const result = mount({ section, container });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const handle = result.value;
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    if (!canvas) return;

    const metrics = handle.getMetrics();
    const expectedDpr = window.devicePixelRatio || 1;
    expect(metrics.dpr).toBe(expectedDpr);
    expect(metrics.width).toBe(300);
    expect(metrics.height).toBe(200);

    // Backing store considera DPR e arredondamento (Math.round)
    expect(canvas.width).toBe(Math.round(300 * expectedDpr));
    expect(canvas.height).toBe(Math.round(200 * expectedDpr));

    // Coordenadas públicas em CSS px
    expect(canvas.style.width).toBe('300px');
    expect(canvas.style.height).toBe('200px');

    handle.destroy();
    expect(container.querySelector('canvas')).toBeNull();
    container.remove();
  });

  it('handle.resize atualiza dimensões após alteração do container', () => {
    const container = document.createElement('div');
    container.style.width = '150px';
    container.style.height = '100px';
    document.body.appendChild(container);

    const section = createCanvasSection();
    const result = mount({ section, container });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const handle = result.value;
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();

    container.style.width = '400px';
    container.style.height = '250px';
    handle.resize();

    const metrics = handle.getMetrics();
    expect(metrics.width).toBe(400);
    expect(metrics.height).toBe(250);

    handle.destroy();
    container.remove();
  });

  it('destroy remove o canvas e é idempotente', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const section = createCanvasSection();
    const result = mount({ section, container });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const handle = result.value;
    expect(container.querySelector('canvas')).not.toBeNull();

    handle.destroy();
    expect(container.querySelector('canvas')).toBeNull();

    // Idempotência: chamadas repetidas não lançam erro
    expect(() => handle.destroy()).not.toThrow();
    expect(() => handle.resize()).not.toThrow();

    container.remove();
  });

  it('container com dimensões zeradas é aceito sem lançar erro', () => {
    const container = document.createElement('div');
    container.style.width = '0px';
    container.style.height = '0px';
    document.body.appendChild(container);

    const section = createCanvasSection();
    const result = mount({ section, container });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const handle = result.value;
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    if (!canvas) return;

    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);

    handle.destroy();
    container.remove();
  });

  it('subscreve a alterações do canvas e atualiza renderedItemsCount', async () => {
    const container = document.createElement('div');
    container.style.width = '500px';
    container.style.height = '400px';
    document.body.appendChild(container);

    const section = createCanvasSection();
    const result = mount({ section, container });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const handle = result.value;
    expect(handle.getMetrics().renderedItemsCount).toBe(0);

    section.dispatch({
      type: 'shape.create',
      shape: {
        type: 'rectangle',
        x: 10,
        y: 10,
        width: 100,
        height: 80,
        rotation: 0,
      },
    });

    // Aguarda o frame agendado por requestAnimationFrame
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(handle.getMetrics().renderedItemsCount).toBe(1);

    handle.destroy();
    container.remove();
  });

  it('coalesce múltiplas invalidações no mesmo frame', async () => {
    const container = document.createElement('div');
    container.style.width = '500px';
    container.style.height = '400px';
    document.body.appendChild(container);

    const section = createCanvasSection();
    const result = mount({ section, container });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const handle = result.value;
    expect(handle.getMetrics().paintCount).toBe(1); // Pintura inicial

    let rafCalls = 0;
    const originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      rafCalls += 1;
      return originalRaf(callback);
    };

    handle.invalidate();
    handle.invalidate();
    handle.invalidate();

    // Apenas 1 callback deve ter sido agendado para o frame (coalescência RENDER-04)
    expect(rafCalls).toBe(1);

    await new Promise((resolve) => originalRaf(resolve));
    window.requestAnimationFrame = originalRaf;

    // Pintura ocorreu exatamente uma vez a mais (paintCount = 2)
    expect(handle.getMetrics().paintCount).toBe(2);

    // Em repouso não há loop ativo: zero repinturas após estabilizar
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(handle.getMetrics().paintCount).toBe(2);

    handle.destroy();
    container.remove();
  });

  it('destroy desfaz subscrição do canvas e cancela frames pendentes', async () => {
    const container = document.createElement('div');
    container.style.width = '300px';
    container.style.height = '300px';
    document.body.appendChild(container);

    const section = createCanvasSection();
    const result = mount({ section, container });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const handle = result.value;
    handle.destroy();

    // Disparar comando após destroy não deve causar repintura nem manter listener ativo
    section.dispatch({
      type: 'shape.create',
      shape: {
        type: 'ellipse',
        x: 10,
        y: 10,
        width: 50,
        height: 50,
        rotation: 0,
      },
    });

    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(handle.getMetrics().renderedItemsCount).toBe(0);

    container.remove();
  });

  it('aplica transformações de viewport (pan e zoom) e repinta ao alterar viewport no canvas', async () => {
    const container = document.createElement('div');
    container.style.width = '400px';
    container.style.height = '300px';
    document.body.appendChild(container);

    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        style: {
          fill: '#ff0000',
          stroke: null,
          strokeWidth: 0,
          opacity: 1,
        },
      },
    });

    const result = mount({ section, container });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    // Em viewport inicial (pan 0,0, zoom 1): ponto (50, 50) deve ser vermelho
    let pixel = ctx.getImageData(Math.round(50 * dpr), Math.round(50 * dpr), 1, 1).data;
    expect(pixel[0]).toBe(255); // R
    expect(pixel[3]).toBe(255); // Alpha

    // Ponto (150, 150) fora da shape inicial é transparente
    pixel = ctx.getImageData(Math.round(150 * dpr), Math.round(150 * dpr), 1, 1).data;
    expect(pixel[3]).toBe(0);

    // Altera viewport via canvas: pan x=100, y=100, zoom=1
    section.setViewport({ x: 100, y: 100, zoom: 1 });

    // Aguarda o frame agendado
    await new Promise((resolve) => requestAnimationFrame(resolve));

    // Agora o retângulo de (0,0) a (100,100) está em tela de (100,100) a (200,200)
    // O antigo ponto (50, 50) agora deve ser transparente (limpo)
    pixel = ctx.getImageData(Math.round(50 * dpr), Math.round(50 * dpr), 1, 1).data;
    expect(pixel[3]).toBe(0);

    // O novo ponto (150, 150) agora deve ser vermelho!
    pixel = ctx.getImageData(Math.round(150 * dpr), Math.round(150 * dpr), 1, 1).data;
    expect(pixel[0]).toBe(255);
    expect(pixel[3]).toBe(255);

    // Altera zoom para 2x com pan (0,0)
    section.setViewport({ x: 0, y: 0, zoom: 2 });
    await new Promise((resolve) => requestAnimationFrame(resolve));

    // Agora o retângulo ocupa (0,0) a (200,200) na tela
    // Ponto (150, 150) agora é coberto pelo retângulo vermelho!
    pixel = ctx.getImageData(Math.round(150 * dpr), Math.round(150 * dpr), 1, 1).data;
    expect(pixel[0]).toBe(255);
    expect(pixel[3]).toBe(255);

    result.value.destroy();
    container.remove();
  });

  it('renderiza o grid na camada visual de fundo sob as shapes', async () => {
    const container = document.createElement('div');
    container.style.width = '200px';
    container.style.height = '200px';
    document.body.appendChild(container);

    const section = createCanvasSection();
    // Shape azul em (50, 50, 50, 50)
    section.dispatch({
      type: 'shape.create',
      shape: {
        type: 'rectangle',
        x: 50,
        y: 50,
        width: 50,
        height: 50,
        rotation: 0,
        style: {
          fill: '#0000ff',
          stroke: null,
          strokeWidth: 0,
          opacity: 1,
        },
      },
    });

    const result = mount({
      section,
      container,
      grid: {
        enabled: true,
        style: 'lines',
        size: 50,
        color: '#ff0000',
        lineWidth: 2,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const canvas = container.querySelector('canvas')!;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;

    // A linha do grid em x=0 (mundo 0) é desenhada em vermelho
    const gridPixel = ctx.getImageData(0, Math.round(25 * dpr), 1, 1).data;
    expect(gridPixel[0]).toBe(255); // R (vermelho do grid)
    expect(gridPixel[2]).toBe(0); // B

    // O retângulo azul em (50, 50) fica SOBRE o grid (a camada de conteúdo cobre o fundo)
    // No centro do retângulo (75, 75), onde haveria o cruzamento de linhas se não houvesse shape,
    // o pixel é estritamente azul:
    const shapePixel = ctx.getImageData(Math.round(75 * dpr), Math.round(75 * dpr), 1, 1).data;
    expect(shapePixel[2]).toBe(255); // B (azul da shape)
    expect(shapePixel[0]).toBe(0); // R

    result.value.destroy();
    container.remove();
  });

  it('renderiza o grid de pontos por padrão, deixando transparente o espaço entre os pontos', async () => {
    const container = document.createElement('div');
    container.style.width = '200px';
    container.style.height = '200px';
    document.body.appendChild(container);

    const section = createCanvasSection();
    const result = mount({
      section,
      container,
      grid: { enabled: true, size: 50, color: '#ff0000' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const canvas = container.querySelector('canvas')!;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;

    // O ponto da interseção (50, 50) é um quadrado de 2 CSS px centrado na interseção.
    const dotPixel = ctx.getImageData(Math.round(50 * dpr), Math.round(50 * dpr), 1, 1).data;
    expect(dotPixel[0]).toBe(255);
    expect(dotPixel[1]).toBe(0);
    expect(dotPixel[3]).toBe(255);

    // Sobre a linha que existiria no estilo 'lines' (x = 50, y = 75), entre dois pontos, é vazio.
    const betweenDots = ctx.getImageData(Math.round(50 * dpr), Math.round(75 * dpr), 1, 1).data;
    expect(betweenDots[3]).toBe(0);

    // No meio da célula (75, 75) também é vazio.
    const cellCenter = ctx.getImageData(Math.round(75 * dpr), Math.round(75 * dpr), 1, 1).data;
    expect(cellCenter[3]).toBe(0);

    result.value.destroy();
    container.remove();
  });

  it('aplica culling espacial com queryBounds e atualiza renderedItemsCount dinamicamente', async () => {
    const container = document.createElement('div');
    container.style.width = '200px';
    container.style.height = '200px';
    document.body.appendChild(container);

    const section = createCanvasSection();
    // Shape 1 em (50, 50, 50, 50) - dentro do viewport inicial (0..200, 0..200)
    section.dispatch({
      type: 'shape.create',
      shape: {
        type: 'rectangle',
        x: 50,
        y: 50,
        width: 50,
        height: 50,
        rotation: 0,
        style: { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 },
      },
    });

    // Shape 2 em (600, 600, 50, 50) - bem fora do viewport inicial
    section.dispatch({
      type: 'shape.create',
      shape: {
        type: 'rectangle',
        x: 600,
        y: 600,
        width: 50,
        height: 50,
        rotation: 0,
        style: { fill: '#00ff00', stroke: null, strokeWidth: 0, opacity: 1 },
      },
    });

    const result = mount({ section, container });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const handle = result.value;

    // Inicialmente, apenas Shape 1 está no viewport
    expect(handle.getMetrics().renderedItemsCount).toBe(1);

    // Pan para trazer Shape 2 e tirar Shape 1 do viewport
    section.setViewport({ x: -550, y: -550, zoom: 1 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(handle.getMetrics().renderedItemsCount).toBe(1);

    // Zoom out (0.2x) com Pan (0, 0): viewport cobre 1000x1000, incluindo ambas as shapes
    section.setViewport({ x: 0, y: 0, zoom: 0.2 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(handle.getMetrics().renderedItemsCount).toBe(2);

    // Pan para região vazia (2000, 2000)
    section.setViewport({ x: -2000, y: -2000, zoom: 1 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(handle.getMetrics().renderedItemsCount).toBe(0);

    handle.destroy();
    container.remove();
  });

  it('renderiza contorno e handles de seleção e retângulo de marquee sobre as shapes', async () => {
    const container = document.createElement('div');
    container.style.width = '200px';
    container.style.height = '200px';
    document.body.appendChild(container);

    const section = createCanvasSection();
    // Retângulo vermelho em (50, 50, 100, 100)
    const createResult = section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'box-sel',
        type: 'rectangle',
        x: 50,
        y: 50,
        width: 100,
        height: 100,
        rotation: 0,
        style: { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 },
      },
    });
    expect(createResult.ok).toBe(true);

    const mountResult = mount({
      section,
      container,
      grid: { enabled: false },
    });
    expect(mountResult.ok).toBe(true);
    if (!mountResult.ok) return;

    const canvas = container.querySelector('canvas')!;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;

    // 1. Sem seleção: o canto (50, 50) tem a cor vermelha da shape
    await new Promise((resolve) => requestAnimationFrame(resolve));
    let pixel = ctx.getImageData(Math.round(50 * dpr), Math.round(50 * dpr), 1, 1).data;
    expect(pixel[0]).toBe(255); // R = 255 (vermelho)

    // 2. Seleciona a shape: o handle superior esquerdo (tl) fica centrado em (50, 50)
    // O handle é um quadrado 8x8 preenchido com branco (#ffffff) e borda azul (#2563eb)
    section.setSelection(['box-sel']);
    await new Promise((resolve) => requestAnimationFrame(resolve));

    pixel = ctx.getImageData(Math.round(50 * dpr), Math.round(50 * dpr), 1, 1).data;
    // O centro do handle é branco (R=255, G=255, B=255)
    expect(pixel[0]).toBe(255);
    expect(pixel[1]).toBe(255);
    expect(pixel[2]).toBe(255);

    // 3. Desfaz a seleção: volta a ser a cor da shape
    section.setSelection([]);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    pixel = ctx.getImageData(Math.round(50 * dpr), Math.round(50 * dpr), 1, 1).data;
    expect(pixel[0]).toBe(255);
    expect(pixel[1]).toBe(0); // Verde apagado, volta a ser estritamente vermelho

    // 4. Aplica marquee provisório em (10, 10, 30, 30) - fora da shape
    section.setPreview({
      marquee: { x: 10, y: 10, width: 30, height: 30 },
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));

    // Dentro do marquee (20, 20): preenchimento translúcido azul (alpha > 0)
    pixel = ctx.getImageData(Math.round(20 * dpr), Math.round(20 * dpr), 1, 1).data;
    expect(pixel[3]).toBeGreaterThan(0); // Alpha ativo
    expect(pixel[2]).toBeGreaterThan(200); // Azul preponderante

    // 5. Limpa marquee
    section.setPreview(null);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    pixel = ctx.getImageData(Math.round(20 * dpr), Math.round(20 * dpr), 1, 1).data;
    expect(pixel[3]).toBe(0); // Transparente novamente

    mountResult.value.destroy();
    container.remove();
  });

  it('ResizeObserver ajusta backing store e métricas quando dimensões do container mudam', async () => {
    const container = document.createElement('div');
    container.style.width = '300px';
    container.style.height = '200px';
    document.body.appendChild(container);

    const section = createCanvasSection();
    const mountResult = mount({ section, container });
    expect(mountResult.ok).toBe(true);
    if (!mountResult.ok) return;

    const handle = mountResult.value;
    const canvas = container.querySelector('canvas')!;
    const dpr = window.devicePixelRatio || 1;

    expect(handle.getMetrics().width).toBe(300);
    expect(handle.getMetrics().height).toBe(200);
    expect(canvas.width).toBe(Math.round(300 * dpr));
    expect(canvas.height).toBe(Math.round(200 * dpr));

    // Altera dimensões do container
    container.style.width = '450px';
    container.style.height = '350px';

    // Aguarda o ResizeObserver disparar
    await new Promise((resolve) => setTimeout(resolve, 50));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(handle.getMetrics().width).toBe(450);
    expect(handle.getMetrics().height).toBe(350);
    expect(canvas.width).toBe(Math.round(450 * dpr));
    expect(canvas.height).toBe(Math.round(350 * dpr));

    handle.destroy();
    container.remove();
  });

  it('suspende pintura em tamanho zero no browser real e retoma após redimensionamento', async () => {
    const container = document.createElement('div');
    container.style.width = '0px';
    container.style.height = '0px';
    document.body.appendChild(container);

    const section = createCanvasSection();
    const mountResult = mount({ section, container });
    expect(mountResult.ok).toBe(true);
    if (!mountResult.ok) return;

    const handle = mountResult.value;
    // Tamanho zero inicial: pintura suspensa
    expect(handle.getMetrics().paintCount).toBe(0);

    // Mutações de viewport enquanto suspenso
    section.setViewport({ x: 50, y: 50, zoom: 1 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(handle.getMetrics().paintCount).toBe(0);

    // Retoma tamanho positivo
    container.style.width = '320px';
    container.style.height = '240px';
    handle.resize();

    expect(handle.getMetrics().paintCount).toBe(1);
    expect(handle.getMetrics().width).toBe(320);
    expect(handle.getMetrics().height).toBe(240);

    handle.destroy();
    container.remove();
  });

  it('destroy remove canvas do container e desativa listeners sem erros', async () => {
    const container = document.createElement('div');
    container.style.width = '200px';
    container.style.height = '150px';
    document.body.appendChild(container);

    const section = createCanvasSection();
    const mountResult = mount({ section, container });
    expect(mountResult.ok).toBe(true);
    if (!mountResult.ok) return;

    const handle = mountResult.value;
    expect(container.querySelector('canvas')).not.toBeNull();

    const paintCountBeforeDestroy = handle.getMetrics().paintCount;

    handle.destroy();

    // Canvas foi removido do DOM
    expect(container.querySelector('canvas')).toBeNull();

    // Mutações subsequentes não alteram mais o renderer
    section.setViewport({ x: 100, y: 100, zoom: 2 });
    handle.invalidate();
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(handle.getMetrics().paintCount).toBe(paintCountBeforeDestroy);

    // Múltiplos destroys não quebram
    expect(() => handle.destroy()).not.toThrow();

    container.remove();
  });
});
