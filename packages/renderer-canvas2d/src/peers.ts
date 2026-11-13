import { worldToScreen, type CanvasPeer, type Viewport } from '@canvash/core';
import { readableTextColor } from './peer-locks-paint.js';

/** Camada DOM dos cursores dos participantes remotos, sobre o canvas e fora da exportação. */
export interface PeersLayer {
  /** Redesenha os cursores para os peers e o viewport dados. */
  update(peers: readonly CanvasPeer[], viewport: Viewport): void;
  /** Tira a camada do container. Idempotente. */
  destroy(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ARROW_PATH =
  'M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829L0.500002 1.19841L11.7841 12.3673H5.65376Z';

function createCursorElement(doc: Document, peer: CanvasPeer): HTMLElement {
  const wrap = doc.createElement('div');
  wrap.className = 'remote-cursor';
  wrap.setAttribute('data-testid', 'remote-cursor');
  wrap.setAttribute('data-session-id', peer.sessionId);
  wrap.style.cssText =
    'position:absolute;left:0;top:0;pointer-events:none;z-index:50;' +
    'transition:translate 0.04s linear;';

  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('stroke', '#ffffff');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('style', 'filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));');
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ARROW_PATH);
  svg.appendChild(path);

  const label = doc.createElement('div');
  label.className = 'remote-cursor-label';
  label.style.cssText =
    'color:#ffffff;font-size:11px;font-weight:600;padding:2px 6px;border-radius:4px;' +
    'white-space:nowrap;margin-top:-6px;margin-left:14px;' +
    'box-shadow:0 1px 3px rgba(0,0,0,0.25);';

  wrap.append(svg, label);
  return wrap;
}

/** O cursor da pessoa seguida é desenhado maior, em torno da ponta da seta. */
const FOLLOWED_SCALE = 1.25;

function paintCursor(el: HTMLElement, peer: CanvasPeer, x: number, y: number): void {
  // A posição desliza (propriedade `translate`, com transição); o aumento é instantâneo
  // (`transform`), para não ficar parado numa transição que uma aba em segundo plano não anda.
  el.style.translate = `${x - 2}px ${y - 2}px`;
  el.style.transformOrigin = '2px 2px';
  el.style.transform = peer.followed ? `scale(${FOLLOWED_SCALE})` : '';
  if (peer.followed) el.setAttribute('data-followed', 'true');
  else el.removeAttribute('data-followed');
  el.querySelector('svg')?.setAttribute('fill', peer.color);
  const label = el.querySelector<HTMLElement>('.remote-cursor-label');
  if (label) {
    label.style.background = peer.color;
    label.style.color = readableTextColor(peer.color);
    // Sempre texto: o nome vem de outra pessoa.
    if (label.textContent !== peer.name) label.textContent = peer.name;
  }
}

/** Etiqueta do seguido quando o cursor dele está fora do canvas: fixa no canto superior esquerdo. */
function createPinnedLabel(doc: Document): HTMLElement {
  const label = doc.createElement('div');
  label.setAttribute('data-testid', 'followed-label');
  label.style.cssText =
    'position:absolute;left:12px;top:12px;pointer-events:none;z-index:50;color:#ffffff;' +
    'font-size:12px;font-weight:600;padding:3px 8px;border-radius:4px;white-space:nowrap;' +
    'box-shadow:0 1px 3px rgba(0,0,0,0.25);';
  return label;
}

/**
 * Cria a camada de cursores dentro de `container`, que precisa ser posicionado. A camada só entra
 * no DOM quando o primeiro cursor aparece.
 */
export function createPeersLayer(container: HTMLElement): PeersLayer {
  const doc = container.ownerDocument;
  const cursors = new Map<string, HTMLElement>();
  const pinned = new Map<string, HTMLElement>();
  let layer: HTMLElement | null = null;

  const ensureLayer = (): HTMLElement => {
    if (layer === null) {
      layer = doc.createElement('div');
      layer.setAttribute('data-testid', 'remote-cursors-layer');
      layer.style.cssText =
        'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:10;';
      container.appendChild(layer);
    }
    return layer;
  };

  return {
    update(peers, viewport) {
      const wanted = peers.filter((peer) => peer.cursor !== null);
      const alive = new Set(wanted.map((peer) => peer.sessionId));
      for (const [id, el] of cursors) {
        if (!alive.has(id)) {
          el.remove();
          cursors.delete(id);
        }
      }
      for (const peer of wanted) {
        const point = worldToScreen(viewport, peer.cursor!);
        let el = cursors.get(peer.sessionId);
        if (el === undefined) {
          el = createCursorElement(doc, peer);
          cursors.set(peer.sessionId, el);
          ensureLayer().appendChild(el);
        }
        paintCursor(el, peer, point.x, point.y);
      }

      // O seguido sem cursor no canvas: a etiqueta com o nome fica fixa no canto.
      const waiting = peers.filter((peer) => peer.followed && peer.cursor === null);
      const waitingIds = new Set(waiting.map((peer) => peer.sessionId));
      for (const [id, el] of pinned) {
        if (!waitingIds.has(id)) {
          el.remove();
          pinned.delete(id);
        }
      }
      for (const peer of waiting) {
        let el = pinned.get(peer.sessionId);
        if (el === undefined) {
          el = createPinnedLabel(doc);
          pinned.set(peer.sessionId, el);
          ensureLayer().appendChild(el);
        }
        el.style.background = peer.color;
        el.style.color = readableTextColor(peer.color);
        if (el.textContent !== peer.name) el.textContent = peer.name;
      }
    },
    destroy() {
      cursors.clear();
      pinned.clear();
      layer?.remove();
      layer = null;
    },
  };
}
