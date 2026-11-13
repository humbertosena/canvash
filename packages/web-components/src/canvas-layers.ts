import type { CanvasSectionApi, CanvasNode, Layer } from '@canvash/core';
import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { getGlobalI18n, type LayersI18nMessages } from './i18n.js';

export class CanvasLayersElement extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      background: var(--canvash-layers-bg, var(--canvash-surface-float, #ebecef));
      border: 1px solid
        var(--canvash-layers-border, var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06)));
      border-radius: var(--canvash-layers-radius, var(--canvash-radius-card, 16px));
      overflow: hidden;
      font-family: inherit;
      font-size: 13px;
      user-select: none;
      -webkit-user-select: none;
    }

    .layers-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: var(--canvash-layers-header-bg, rgba(0, 0, 0, 0.04));
      border-bottom: 1px solid
        var(--canvash-layers-border, var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06)));
      font-weight: 600;
      color: var(--canvash-layers-title-color, var(--canvash-text-float, #1f1f1f));
    }

    .layers-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px;
      margin: 0;
      list-style: none;
    }

    .layer-group {
      margin-bottom: 8px;
      border: 1px solid
        var(--canvash-layer-border, var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06)));
      border-radius: 6px;
      overflow: hidden;
    }

    .layer-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      background: var(--canvash-layer-header-bg, rgba(0, 0, 0, 0.05));
      font-weight: 500;
      color: var(--canvash-layer-header-color, var(--canvash-text-float, #1f1f1f));
    }

    .layer-title {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .node-list {
      padding: 2px 0 2px 16px;
      margin: 0;
      list-style: none;
    }

    .node-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      color: var(--canvash-node-color, #3f434a);
      outline: none;
      transition: background-color 0.1s ease;
    }

    .node-item:hover {
      background: var(--canvash-node-hover-bg, rgba(0, 0, 0, 0.06));
    }

    .node-item[aria-current='true'],
    .node-item[data-selected='true'] {
      background: var(--canvash-node-selected-bg, rgba(0, 0, 0, 0.12));
      color: var(--canvash-node-selected-color, var(--canvash-text-float, #1f1f1f));
      font-weight: 500;
    }

    .node-item:focus-visible {
      outline: 2px solid var(--canvash-focus-ring, var(--canvash-text-float, #1f1f1f));
      outline-offset: -1px;
    }

    .node-label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      padding: 0;
      background: transparent;
      border: none;
      border-radius: 4px;
      color: inherit;
      cursor: pointer;
      font-size: 12px;
      opacity: 0.7;
    }

    .icon-btn:hover {
      opacity: 1;
      background: rgba(0, 0, 0, 0.05);
    }

    .icon-btn:disabled {
      opacity: 0.25;
      cursor: not-allowed;
    }

    .peer-lock {
      flex: none;
      margin-inline: 4px;
      font-size: 12px;
      line-height: 1;
    }

    .empty-message {
      padding: 16px;
      text-align: center;
      color: var(--canvash-layers-empty-color, #4b5563);
      font-size: 12px;
    }
  `;

  private _section: CanvasSectionApi | undefined;
  private _unsubscribeSection: (() => void) | undefined;

  get section(): CanvasSectionApi | undefined {
    return this._section;
  }

  set section(nextSection: CanvasSectionApi | undefined) {
    if (this._section === nextSection) return;
    this._detach();
    this._section = nextSection;
    this._attach();
    this.requestUpdate();
  }

  private _messages?: Partial<LayersI18nMessages>;

  get messages(): LayersI18nMessages {
    return { ...getGlobalI18n().layers, ...this._messages };
  }

  set messages(val: Partial<LayersI18nMessages> | undefined) {
    this._messages = val;
    this.requestUpdate();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._attach();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._detach();
  }

  protected override performUpdate(): void | Promise<unknown> {
    if (typeof document === 'undefined' || typeof document.createComment !== 'function') {
      return;
    }
    return super.performUpdate();
  }

  private _attach(): void {
    if (this._section && !this._unsubscribeSection) {
      this._unsubscribeSection = this._section.subscribe(() => {
        this.requestUpdate();
      });
    }
  }

  private _detach(): void {
    if (this._unsubscribeSection) {
      this._unsubscribeSection();
      this._unsubscribeSection = undefined;
    }
  }

  private _toggleLayerVisibility(layer: Layer, e?: Event): void {
    e?.stopPropagation?.();
    if (!this._section) return;
    this._section.dispatch({
      type: 'layer.update',
      id: layer.id,
      patch: { visible: !layer.visible },
    });
  }

  private _toggleLayerLock(layer: Layer, e?: Event): void {
    e?.stopPropagation?.();
    if (!this._section) return;
    this._section.dispatch({
      type: 'layer.update',
      id: layer.id,
      patch: { locked: !layer.locked },
    });
  }

  private _reorderLayer(layer: Layer, direction: 'up' | 'down', e?: Event): void {
    e?.stopPropagation?.();
    if (!this._section) return;
    const snap = this._section.getSnapshot();
    const currentIndex = snap.document.layers.findIndex((l) => l.id === layer.id);
    if (currentIndex === -1) return;
    const targetIndex = direction === 'up' ? currentIndex + 1 : currentIndex - 1;
    if (targetIndex < 0 || targetIndex >= snap.document.layers.length) return;
    this._section.dispatch({
      type: 'layer.reorder',
      id: layer.id,
      index: targetIndex,
    });
  }

  private _selectNode(nodeId: string, event: MouseEvent | KeyboardEvent): void {
    if (!this._section) return;
    // Nó que outro participante está editando não se seleciona por aqui.
    if (this._section.getPeerLock(nodeId)) return;
    const snap = this._section.getSnapshot();
    const current = snap.session.selectedIds;

    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      const next = current.includes(nodeId)
        ? current.filter((id) => id !== nodeId)
        : [...current, nodeId];
      this._section.setSelection(next);
    } else {
      this._section.setSelection([nodeId]);
    }
  }

  private _onNodeKeyDown(nodeId: string, e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault?.();
      this._selectNode(nodeId, e);
    }
  }

  private _toggleNodeVisibility(node: CanvasNode, e?: Event): void {
    e?.stopPropagation?.();
    if (!this._section) return;
    this._section.dispatch({
      type: 'shape.update',
      id: node.id,
      patch: { visible: !node.visible },
    });
  }

  private _toggleNodeLock(node: CanvasNode, e?: Event): void {
    e?.stopPropagation?.();
    if (!this._section) return;
    this._section.dispatch({
      type: 'shape.update',
      id: node.id,
      patch: { locked: !node.locked },
    });
  }

  /**
   * Os irmãos de um nó, do fundo para a frente: os filhos do board ou do grupo que o contém, ou
   * os da camada. É entre eles que subir e descer valem.
   */
  private _siblingsOf(layer: Layer, nodeId: string): readonly string[] {
    const nodes = this._section?.getSnapshot().document.nodes ?? {};
    for (const candidate of Object.values(nodes)) {
      if (
        (candidate.type === 'board' || candidate.type === 'group') &&
        candidate.childIds.includes(nodeId)
      ) {
        return candidate.childIds;
      }
    }
    return layer.childIds;
  }

  private _reorderNode(layer: Layer, node: CanvasNode, direction: 'up' | 'down', e?: Event): void {
    e?.stopPropagation?.();
    if (!this._section) return;
    const siblings = this._siblingsOf(layer, node.id);
    const currentIndex = siblings.indexOf(node.id);
    if (currentIndex === -1) return;
    const targetIndex = direction === 'up' ? currentIndex + 1 : currentIndex - 1;
    if (targetIndex < 0 || targetIndex >= siblings.length) return;
    this._section.dispatch({
      type: 'node.reorder',
      id: node.id,
      index: targetIndex,
    });
  }

  /** Os filhos que a lista mostra por baixo de um nó, da frente para o fundo. */
  private _childrenOf(node: CanvasNode, nested: boolean): CanvasNode[] {
    // Os membros de um grupo só aparecem quando o grupo está dentro de um board.
    if (node.type !== 'board' && !(node.type === 'group' && nested)) return [];
    const nodes = this._section?.getSnapshot().document.nodes ?? {};
    return node.childIds
      .map((id) => nodes[id])
      .filter((child): child is CanvasNode => child !== undefined)
      .reverse();
  }

  /**
   * A linha de um nó. Um board (e, dentro dele, um grupo) com filhos vira `li.node-branch` com
   * a linha e uma lista aninhada; os demais são um `li.node-item`.
   * @param parentLocked o board ou grupo que contém o nó está bloqueado
   */
  private _renderNode(
    layer: Layer,
    node: CanvasNode,
    nested: boolean,
    parentLocked: boolean,
    parentId?: string,
  ): TemplateResult {
    const msg = this.messages;
    const snap = this._section?.getSnapshot();
    const selectedIds = snap?.session.selectedIds ?? [];
    const isReadOnly = snap?.session.readOnly ?? false;
    const siblings = this._siblingsOf(layer, node.id);
    const index = siblings.indexOf(node.id);
    const isSelected = selectedIds.includes(node.id);
    const peerLock = this._section?.getPeerLock(node.id);
    const frozen =
      isReadOnly || peerLock !== undefined || layer.locked || parentLocked || node.locked;
    const children = this._childrenOf(node, nested);

    const row = html`
      <span class="node-label">
        ${node.type === 'board' ? node.title : node.type}
        <small style="color: #475569; font-size: 10px; margin-left: 4px;">${node.id}</small>
      </span>

      ${
        peerLock
          ? html`<span
              class="peer-lock"
              part="node-peer-lock"
              role="img"
              aria-label=${msg.lockedBy(peerLock.name)}
              title=${msg.lockedBy(peerLock.name)}
              style="color: ${peerLock.color};"
              >🔒</span
            >`
          : nothing
      }

      <button
        type="button"
        class="icon-btn"
        part="btn-node-reorder-up"
        data-action="node-up"
        aria-label=${msg.nodeUp}
        ?disabled=${frozen || index === siblings.length - 1}
        @click=${(e: Event) => this._reorderNode(layer, node, 'up', e)}
      >
        ↑
      </button>
      <button
        type="button"
        class="icon-btn"
        part="btn-node-reorder-down"
        data-action="node-down"
        aria-label=${msg.nodeDown}
        ?disabled=${frozen || index === 0}
        @click=${(e: Event) => this._reorderNode(layer, node, 'down', e)}
      >
        ↓
      </button>

      <button
        type="button"
        class="icon-btn"
        part="btn-node-visible"
        data-action="node-visible"
        aria-label=${node.visible ? msg.nodeHidden : msg.nodeVisible}
        ?disabled=${isReadOnly || peerLock !== undefined}
        @click=${(e: Event) => this._toggleNodeVisibility(node, e)}
      >
        ${node.visible ? '👁' : '∅'}
      </button>

      <button
        type="button"
        class="icon-btn"
        part="btn-node-lock"
        data-action="node-lock"
        aria-label=${node.locked ? msg.nodeUnlock : msg.nodeLock}
        ?disabled=${isReadOnly || peerLock !== undefined}
        @click=${(e: Event) => this._toggleNodeLock(node, e)}
      >
        ${node.locked ? '🔒' : '🔓'}
      </button>
    `;

    if (children.length === 0) {
      return html`
        <li
          class="node-item"
          part="node-item ${isSelected ? 'node-selected' : ''}"
          data-node-id=${node.id}
          data-parent-id=${parentId ?? nothing}
          data-selected=${isSelected ? 'true' : 'false'}
          data-peer-locked=${peerLock ? 'true' : nothing}
          aria-disabled=${peerLock ? 'true' : nothing}
          tabindex="0"
          aria-current=${isSelected ? 'true' : nothing}
          @click=${(e: MouseEvent) => this._selectNode(node.id, e)}
          @keydown=${(e: KeyboardEvent) => this._onNodeKeyDown(node.id, e)}
        >
          ${row}
        </li>
      `;
    }

    return html`
      <li class="node-branch" part="node-branch">
        <div
          class="node-item"
          part="node-item ${isSelected ? 'node-selected' : ''}"
          data-node-id=${node.id}
          data-parent-id=${parentId ?? nothing}
          data-selected=${isSelected ? 'true' : 'false'}
          data-peer-locked=${peerLock ? 'true' : nothing}
          aria-disabled=${peerLock ? 'true' : nothing}
          tabindex="0"
          aria-current=${isSelected ? 'true' : nothing}
          @click=${(e: MouseEvent) => this._selectNode(node.id, e)}
          @keydown=${(e: KeyboardEvent) => this._onNodeKeyDown(node.id, e)}
        >
          ${row}
        </div>
        <ul
          class="node-list"
          part="node-list"
          role="list"
          aria-label=${node.type === 'board' ? node.title : msg.objectsLabel}
        >
          ${children.map((child) =>
            this._renderNode(layer, child, true, parentLocked || node.locked, node.id),
          )}
        </ul>
      </li>
    `;
  }

  override render() {
    const snap = this._section?.getSnapshot();
    const layers = snap?.document.layers ?? [];
    const nodes = snap?.document.nodes ?? {};
    const isReadOnly = snap?.session.readOnly ?? false;
    const msg = this.messages;

    return html`
      <div class="layers-header" part="layers-header">
        <slot name="header">
          <span>${msg.title}</span>
          <span style="font-weight: normal; font-size: 11px; opacity: 0.7;">
            ${layers.length}
          </span>
        </slot>
      </div>

      <div class="layers-list" part="layers-list" role="region" aria-label=${msg.title}>
        ${
          layers.length === 0
            ? html`<div class="empty-message">${msg.empty}</div>`
            : layers
                .slice()
                .reverse()
                .map((layer, reverseIndex) => {
                  const actualIndex = layers.length - 1 - reverseIndex;
                  const layerChildNodes: CanvasNode[] = layer.childIds
                    .map((id) => nodes[id])
                    .filter((n): n is CanvasNode => n !== undefined)
                    .reverse();

                  return html`
                    <div
                      class="layer-group"
                      part="layer-group"
                      data-layer-id=${layer.id}
                      role="group"
                      aria-label=${layer.name}
                    >
                      <div class="layer-header" part="layer-header">
                        <span class="layer-title" title=${layer.name}>${layer.name}</span>

                        <button
                          type="button"
                          class="icon-btn"
                          part="btn-layer-reorder-up"
                          data-action="layer-up"
                          aria-label=${msg.layerUp}
                          ?disabled=${
                            isReadOnly || layer.locked || actualIndex === layers.length - 1
                          }
                          @click=${(e: Event) => this._reorderLayer(layer, 'up', e)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          class="icon-btn"
                          part="btn-layer-reorder-down"
                          data-action="layer-down"
                          aria-label=${msg.layerDown}
                          ?disabled=${isReadOnly || layer.locked || actualIndex === 0}
                          @click=${(e: Event) => this._reorderLayer(layer, 'down', e)}
                        >
                          ↓
                        </button>

                        <button
                          type="button"
                          class="icon-btn"
                          part="btn-layer-visible"
                          data-action="layer-visible"
                          aria-label=${layer.visible ? msg.layerHidden : msg.layerVisible}
                          ?disabled=${isReadOnly}
                          @click=${(e: Event) => this._toggleLayerVisibility(layer, e)}
                        >
                          ${layer.visible ? '👁' : '∅'}
                        </button>

                        <button
                          type="button"
                          class="icon-btn"
                          part="btn-layer-lock"
                          data-action="layer-lock"
                          aria-label=${layer.locked ? msg.layerUnlock : msg.layerLock}
                          ?disabled=${isReadOnly}
                          @click=${(e: Event) => this._toggleLayerLock(layer, e)}
                        >
                          ${layer.locked ? '🔒' : '🔓'}
                        </button>
                      </div>

                      ${
                        layerChildNodes.length === 0
                          ? html`<div class="empty-message" style="padding: 6px;">
                              ${msg.empty}
                            </div>`
                          : html`
                              <ul
                                class="node-list"
                                part="node-list"
                                role="list"
                                aria-label=${msg.objectsLabel}
                              >
                                ${layerChildNodes.map((node) =>
                                  this._renderNode(layer, node, false, false),
                                )}
                              </ul>
                            `
                      }
                    </div>
                  `;
                })
        }
      </div>

      <slot></slot>
      <slot name="footer"></slot>
    `;
  }
}
