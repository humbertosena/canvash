import type { CanvasSectionApi } from '@canvash/core';
import { css, html, LitElement, nothing, svg, type PropertyValues } from 'lit';
import type {
  AvatarClickEventDetail,
  ExportFormat,
  ExportRequestEventDetail,
  MenuSelectEventDetail,
  MenuToggleEventDetail,
  FollowChangeEventDetail,
  ShareRequestEventDetail,
  ShareStopEventDetail,
  ShellSharingState,
  TitleChangeEventDetail,
} from './events.js';
import { getGlobalI18n, type ShellI18nMessages } from './i18n.js';
import { HOVER_CLOSE_MS, HOVER_OPEN_MS } from './tool-menu.js';
import { initialsOf, initialsTextColor, stackOf, type ShellParticipant } from './participants.js';

/** Tamanho máximo do título do projeto, em caracteres. */
const MAX_TITLE_LENGTH = 120;

/** Item do menu hambúrguer, dado pelo host. O rótulo é sempre texto, nunca HTML. */
export interface ShellMenuItem {
  /** Identificador devolvido em `menu-select`. */
  readonly id: string;
  readonly label: string;
  /** URL de uma imagem (pode ser `data:`), mostrada com 20 px antes do rótulo. */
  readonly icon?: string;
  /** Item visível mas inativo: não emite `menu-select` nem fecha o menu. */
  readonly disabled?: boolean;
}

/** Pessoa logada, mostrada como avatar no topo à direita. O nome é sempre texto, nunca HTML. */
export interface ShellUser {
  readonly name: string;
  /** URL da foto. Sem ela, ou se ela falhar, o avatar mostra as iniciais do nome. */
  readonly avatarUrl?: string;
}

/**
 * Layout de "canvas infinito + ilhas flutuantes". O canvas (slot padrão) ocupa o shell inteiro e
 * as ilhas (menu, ações, camadas, toolbar, controles) flutuam sobre ele, ancoradas nas bordas,
 * sem nunca empurrar o conteúdo. É só layout: não cria nem distribui o `canvas`, que cada filho
 * recebe do host.
 *
 * Regiões (slots): padrão (canvas), `menu` (cartão do menu hambúrguer), `actions` (topo à
 * direita), `left` (cartão à esquerda), `toolbar` (direita, centralizada na vertical),
 * `controls` (base à direita) e `overlay` (camada sobre o canvas). O shell mede a toolbar e expõe
 * a largura em `--canvash-shell-toolbar-inline-size`, para quem precisa evitar a faixa dela.
 */
export class CanvasSectionElement extends LitElement {
  static override properties = {
    menuOpen: { type: Boolean, attribute: 'menu-open', reflect: true },
    projectTitle: { type: String, attribute: 'project-title', reflect: true },
    menuItems: { attribute: false },
    hideExport: { type: Boolean, attribute: 'hide-export', reflect: true },
    hideShare: { type: Boolean, attribute: 'hide-share', reflect: true },
    sharing: { type: String, attribute: 'sharing', reflect: true },
    participants: { attribute: false },
    following: { attribute: false },
    hideParticipants: { type: Boolean, attribute: 'hide-participants', reflect: true },
    user: { attribute: false },
    _avatarFailed: { state: true },
    _exportOpen: { state: true },
    _participantsOpen: { state: true },
    _editing: { state: true },
  };

  static override styles = css`
    :host {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
      font-family: var(--canvash-font-float, Inter, 'Google Sans', system-ui, sans-serif);
      font-size: 14px;
      color: var(--canvash-text-float, #1f1f1f);
    }

    .shell {
      position: absolute;
      inset: 0;
    }

    .canvas-layer {
      position: absolute;
      inset: 0;
    }

    /* As regiões não capturam o ponteiro: pan, seleção e desenho funcionam entre as ilhas. */
    .top,
    .left,
    .right,
    .bottom-end,
    .overlay {
      position: absolute;
      pointer-events: none;
    }

    ::slotted([slot]) {
      pointer-events: auto;
    }

    .top {
      top: var(--canvash-island-margin, 16px);
      left: var(--canvash-island-margin, 16px);
      right: var(--canvash-island-margin, 16px);
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .top-start {
      position: relative;
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .top-end {
      display: flex;
      align-items: center;
      gap: 8px;
      pointer-events: none;
    }

    .menu-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 48px;
      height: 32px;
      padding: 0;
      color: var(--canvash-text-float, #1f1f1f);
      background: var(--canvash-surface-float, #ebecef);
      border: 1px solid var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06));
      border-radius: var(--canvash-radius-pill, 9999px);
      box-shadow: var(
        --canvash-shadow-float,
        0 4px 16px rgba(0, 0, 0, 0.08),
        0 1px 2px rgba(0, 0, 0, 0.04)
      );
      cursor: pointer;
      pointer-events: auto;
    }

    /* Hover e ilha temporária aberta: o mesmo fundo, mais forte e opaco que o de repouso. */
    .menu-button:hover,
    .menu-button[aria-expanded='true'] {
      background: var(--canvash-surface-float-hover, #d9dbe0);
    }

    .menu-button:focus-visible {
      outline: 2px solid var(--canvash-focus-ring, var(--canvash-text-float, #1f1f1f));
      outline-offset: 2px;
    }

    .title {
      min-width: 0;
      max-width: min(40vw, 480px);
      padding: 4px 6px;
      overflow: hidden;
      color: inherit;
      font: inherit;
      font-weight: 700;
      line-height: 17px;
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
      background: none;
      border: 0;
      border-radius: 8px;
      pointer-events: auto;
    }

    button.title {
      cursor: text;
    }

    .title:focus-visible {
      outline: 2px solid var(--canvash-focus-ring, var(--canvash-text-float, #1f1f1f));
      outline-offset: 2px;
    }

    /*
     * Em edição: itálico (sem negrito), fundo transparente e só uma linha embaixo, em degradê da
     * esquerda para a direita, do tom de seleção dos itens das ilhas à cor do canvas. O padding de
     * baixo perde 1 px para a borda de 2 px não aumentar o campo. A linha tem altura fixa (17 px) para
     * os 27 px do campo não dependerem da métrica da fonte do sistema.
     */
    .title-input {
      box-sizing: border-box;
      width: min(40vw, 320px);
      padding: 4px 8px 3px;
      color: inherit;
      font: inherit;
      font-weight: 400;
      font-style: italic;
      line-height: 17px;
      background: var(--canvash-title-edit-bg, transparent);
      border: 1px solid transparent;
      border-bottom-width: 2px;
      border-image: var(
          --canvash-title-edit-line,
          linear-gradient(
            90deg,
            var(--canvash-surface-float-item-hover, #ccced3),
            var(--canvash-canvas-bg, #f2f3f5)
          )
        )
        0 0 1 0;
      border-radius: 8px;
      pointer-events: auto;
    }

    /* O campo só existe com foco: o itálico e a linha em degradê marcam a edição, sem contorno. */
    .title-input:focus {
      outline: none;
    }

    .menu {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      z-index: 20;
      box-sizing: border-box;
      min-width: 240px;
      max-width: min(360px, calc(100vw - 2 * var(--canvash-island-margin, 16px)));
      max-height: calc(100vh - 96px);
      padding: 12px;
      overflow: auto;
      background: var(--canvash-surface-float-hover, #d9dbe0);
      border: 1px solid var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06));
      border-radius: var(--canvash-radius-card, 16px);
      box-shadow: var(
        --canvash-shadow-float,
        0 4px 16px rgba(0, 0, 0, 0.08),
        0 1px 2px rgba(0, 0, 0, 0.04)
      );
      pointer-events: auto;
    }

    .menu-items {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      box-sizing: border-box;
      width: 100%;
      min-height: 36px;
      padding: 6px 10px;
      color: inherit;
      font: inherit;
      text-align: left;
      background: none;
      border: 0;
      border-radius: 8px;
      cursor: pointer;
    }

    .menu-item img {
      flex: none;
    }

    /* Tom de seleção de um item dentro de uma ilha temporária (o mesmo da linha do título). */
    .menu-item:hover:not(:disabled) {
      background: var(--canvash-surface-float-item-hover, #ccced3);
    }

    .menu-item:focus-visible {
      outline: 2px solid var(--canvash-focus-ring, var(--canvash-text-float, #1f1f1f));
      outline-offset: -2px;
    }

    .menu-item:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: none;
      box-sizing: border-box;
      height: 32px;
      padding: 0 12px;
      color: var(--canvash-text-float, #1f1f1f);
      font: inherit;
      font-weight: 700;
      white-space: nowrap;
      background: var(--canvash-surface-float, #ebecef);
      border: 1px solid var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06));
      border-radius: var(--canvash-radius-pill, 9999px);
      box-shadow: var(
        --canvash-shadow-float,
        0 4px 16px rgba(0, 0, 0, 0.08),
        0 1px 2px rgba(0, 0, 0, 0.04)
      );
      cursor: pointer;
      pointer-events: auto;
    }

    .pill:hover,
    .pill[aria-expanded='true'] {
      background: var(--canvash-surface-float-hover, #d9dbe0);
    }

    .pill:focus-visible {
      outline: 2px solid var(--canvash-focus-ring, var(--canvash-text-float, #1f1f1f));
      outline-offset: 2px;
    }

    .pill svg {
      flex: none;
    }

    .participants {
      position: relative;
      flex: none;
    }

    .participants-stack {
      display: inline-flex;
      align-items: center;
      box-sizing: border-box;
      height: 32px;
      padding: 0 12px 0 20px;
      font: inherit;
      color: var(--canvash-text-float, #1f1f1f);
      background: var(--canvash-surface-float, #ebecef);
      border: 1px solid var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06));
      border-radius: var(--canvash-radius-pill, 9999px);
      box-shadow: var(
        --canvash-shadow-float,
        0 4px 16px rgba(0, 0, 0, 0.08),
        0 1px 2px rgba(0, 0, 0, 0.04)
      );
      cursor: pointer;
      pointer-events: auto;
    }

    .participants-stack:hover,
    .participants-stack[aria-expanded='true'] {
      background: var(--canvash-surface-float-hover, #d9dbe0);
    }

    .participants-stack:focus-visible {
      outline: 2px solid var(--canvash-focus-ring, var(--canvash-text-float, #1f1f1f));
      outline-offset: 2px;
    }

    .participants-island {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      z-index: 20;
      box-sizing: border-box;
      min-width: 260px;
      max-width: min(360px, calc(100vw - 32px));
      padding: 4px 0;
      color: var(--canvash-text-float, #1f1f1f);
      background: var(--canvash-surface-float, #ebecef);
      border: 1px solid var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06));
      border-radius: var(--canvash-radius-card, 16px);
      box-shadow: var(
        --canvash-shadow-float,
        0 4px 16px rgba(0, 0, 0, 0.08),
        0 1px 2px rgba(0, 0, 0, 0.04)
      );
      pointer-events: auto;
    }

    .participants-title {
      padding: 8px 12px;
      font-weight: 700;
    }

    .participants-list {
      /* Oito linhas de 40 px: acima disso a lista rola, e o título e o Parar ficam fixos. */
      max-height: 320px;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }

    .participant-row {
      display: flex;
      align-items: center;
      gap: 8px;
      box-sizing: border-box;
      height: 40px;
      padding: 0 12px;
    }

    .participant-row .participant-avatar {
      margin-left: 0;
    }

    .participant-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .participant-you {
      opacity: 0.7;
    }

    .follow-button,
    .share-stop-item {
      font: inherit;
      color: inherit;
      cursor: pointer;
      background: transparent;
      border: 0;
    }

    .follow-button {
      padding: 4px 10px;
      font-weight: 700;
      border-radius: var(--canvash-radius-pill, 9999px);
    }

    .share-stop-item {
      display: block;
      width: 100%;
      padding: 10px 12px;
      text-align: left;
    }

    .follow-button:hover,
    .share-stop-item:hover {
      background: var(--canvash-surface-float-item-hover, #ccced3);
    }

    .follow-button:focus-visible,
    .share-stop-item:focus-visible {
      outline: 2px solid var(--canvash-focus-ring, var(--canvash-text-float, #1f1f1f));
      outline-offset: -2px;
    }

    .follow-frame {
      position: absolute;
      inset: 0;
      z-index: 5;
      pointer-events: none;
      box-shadow: inset 0 0 0 var(--canvash-follow-frame-width, 2px) var(--follow-color);
    }

    .following-banner {
      position: absolute;
      top: calc(var(--canvash-island-margin, 16px) + 40px);
      left: 50%;
      z-index: 20;
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: calc(100% - 32px);
      box-sizing: border-box;
      padding: 6px 8px 6px 14px;
      transform: translateX(-50%);
      color: var(--canvash-text-float, #1f1f1f);
      background: var(--canvash-surface-float, #ebecef);
      border: 1px solid var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06));
      border-radius: var(--canvash-radius-pill, 9999px);
      box-shadow: var(
        --canvash-shadow-float,
        0 4px 16px rgba(0, 0, 0, 0.08),
        0 1px 2px rgba(0, 0, 0, 0.04)
      );
      pointer-events: auto;
    }

    .following-banner [role='status'] {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 700;
    }

    .following-stop {
      flex: none;
      padding: 4px 12px;
      font: inherit;
      font-weight: 700;
      color: inherit;
      cursor: pointer;
      background: transparent;
      border: 1px solid currentColor;
      border-radius: var(--canvash-radius-pill, 9999px);
    }

    .following-stop:hover {
      background: var(--canvash-surface-float-item-hover, #ccced3);
    }

    .following-stop:focus-visible {
      outline: 2px solid var(--canvash-focus-ring, var(--canvash-text-float, #1f1f1f));
      outline-offset: 2px;
    }

    .follow-button:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    .participants-divider {
      height: 1px;
      margin: 4px 0;
      background: var(--canvash-surface-float-border, rgba(0, 0, 0, 0.12));
    }

    .participant-avatar,
    .participants-more {
      display: inline-grid;
      place-items: center;
      flex: none;
      box-sizing: border-box;
      width: var(--canvash-avatar-stack-size, 24px);
      height: var(--canvash-avatar-stack-size, 24px);
      margin-left: -8px;
      overflow: hidden;
      font-size: 10px;
      font-weight: 700;
      line-height: 1;
      border-radius: 50%;
      box-shadow: 0 0 0 2px var(--canvash-surface-float, #ebecef);
    }

    .participant-avatar {
      background: var(--ring);
      border: var(--canvash-avatar-ring-width, 2px) solid var(--ring);
    }

    .participant-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
    }

    .participants-more {
      color: #ffffff;
      background: #4b5563;
    }

    .share-status {
      flex: none;
      box-sizing: border-box;
      width: 8px;
      height: 8px;
      background: var(--canvash-share-active-color, #15803d);
      border-radius: 50%;
    }

    .share-status[data-state='connecting'] {
      animation: canvash-share-pulse 1.2s ease-in-out infinite;
    }

    @keyframes canvash-share-pulse {
      0%,
      100% {
        opacity: 1;
      }

      50% {
        opacity: 0.35;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .share-status[data-state='connecting'] {
        animation: none;
        opacity: 0.5;
      }
    }

    .export {
      position: relative;
    }

    .avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      box-sizing: border-box;
      width: 32px;
      height: 32px;
      padding: 0;
      overflow: hidden;
      color: #ffffff;
      font: inherit;
      font-size: 12px;
      font-weight: 700;
      background: #1f1f1f;
      border: 0;
      border-radius: 50%;
      box-shadow: none;
      cursor: pointer;
      pointer-events: auto;
    }

    .avatar:focus-visible {
      outline: 2px solid var(--canvash-focus-ring, var(--canvash-text-float, #1f1f1f));
      outline-offset: 2px;
    }

    .avatar img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .export-menu {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      z-index: 20;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 180px;
      padding: 6px;
      background: var(--canvash-surface-float-hover, #d9dbe0);
      border: 1px solid var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06));
      border-radius: var(--canvash-radius-card, 16px);
      box-shadow: var(
        --canvash-shadow-float,
        0 4px 16px rgba(0, 0, 0, 0.08),
        0 1px 2px rgba(0, 0, 0, 0.04)
      );
      pointer-events: auto;
    }

    .left {
      top: calc(var(--canvash-island-margin, 16px) + 48px);
      bottom: calc(var(--canvash-island-margin, 16px) + 56px);
      left: var(--canvash-island-margin, 16px);
      width: var(--canvash-shell-left-width, 260px);
      max-width: calc(100% - 2 * var(--canvash-island-margin, 16px));
      overflow: auto;
    }

    .right,
    .bottom-end {
      display: flex;
      justify-content: flex-end;
    }

    /* A região da toolbar, na borda direita e centralizada na vertical. Sem overflow: os menus da
       toolbar abrem para fora dela e seriam cortados. */
    .right {
      top: 50%;
      right: var(--canvash-island-margin, 16px);
      transform: translateY(-50%);
    }

    .bottom-end {
      right: var(--canvash-island-margin, 16px);
      bottom: var(--canvash-island-margin, 16px);
    }

    .overlay {
      inset: 0;
    }

    /* Tela estreita: as pills ficam só com o ícone; o nome acessível vem do aria-label. */
    @media (max-width: 599px) {
      .pill {
        padding: 0 5px;
      }

      .pill-label {
        display: none;
      }
    }
  `;

  /** Menu hambúrguer aberto. Emite `menu-toggle` a cada mudança. */
  menuOpen = false;

  /**
   * Título do projeto, mostrado ao lado do menu. Editá-lo emite `title-change`; quem decide se
   * aceita a mudança (e a guarda) é o host, que então atribui a propriedade.
   */
  projectTitle = '';

  /**
   * Itens do menu hambúrguer, desenhados no cartão antes do slot `menu`. Só por propriedade.
   * Escolher um emite `menu-select` com o `id` e fecha o menu.
   */
  menuItems: readonly ShellMenuItem[] = [];

  /** Esconde a pill Exportar (`hide-export`). */
  hideExport = false;

  /** Esconde a pill Compartilhar (`hide-share`). */
  hideShare = false;

  /**
   * Estado do compartilhamento ao vivo, refletido no atributo `sharing`. Só o host muda: o shell
   * mostra o ponto de status e o nome acessível, mas nunca liga a colaboração sozinho.
   */
  sharing: ShellSharingState = 'off';

  /**
   * Participantes da sessão, a pessoa local (`self`) incluída. Só por propriedade. A pilha de
   * avatares aparece com `sharing = 'on'` e pelo menos uma outra pessoa.
   */
  participants: readonly ShellParticipant[] = [];

  /** Esconde a pilha de avatares mesmo com participantes (`hide-participants`). */
  hideParticipants = false;

  /**
   * `id` da pessoa que a sessão local segue, ou `null`. Só o host muda: o botão dela vira
   * Seguindo, a pilha a põe primeiro e aparecem a faixa e a moldura na cor dela.
   */
  following: string | null = null;

  /** Participantes cuja foto não carregou: mostram as iniciais no lugar. */
  private _failedPhotos = new Set<string>();

  /** A ilha de participantes está aberta (por hover, clique ou teclado). */
  private _participantsOpen = false;
  /** Aberta por clique ou teclado: sair com o ponteiro não fecha. */
  private _participantsPinned = false;
  private _participantsTimer: ReturnType<typeof setTimeout> | undefined;
  private _participantsOutsideClick: ((event: Event) => void) | undefined;
  private _participantsEscapeKey: ((event: KeyboardEvent) => void) | undefined;
  /** Índice do controle que recebe o foco quando a linha focada saiu da lista. */
  private _participantsRefocus: number | undefined;

  /**
   * Pessoa logada, mostrada como avatar depois da pill Exportar. Só por propriedade; sem ela não
   * há avatar. O clique emite `avatar-click`.
   */
  user: ShellUser | undefined;

  /** A foto do avatar não carregou: mostra as iniciais no lugar. */
  private _avatarFailed = false;

  /** Ilha temporária de exportação aberta. Estado interno: o host não a controla. */
  private _exportOpen = false;

  /** Editando o título no lugar. */
  private _editing = false;
  /** O campo acabou de abrir (ou fechou): o foco precisa ir para ele (ou voltar ao título). */
  private _pendingFocus: 'input' | 'title' | 'export-item' | 'participant-control' | undefined;

  private _section: CanvasSectionApi | undefined;
  private _unsubscribeSection: (() => void) | undefined;

  /** Canvas opcional, só para saber do modo leitura: em leitura o título não se edita. */
  get section(): CanvasSectionApi | undefined {
    return this._section;
  }

  set section(next: CanvasSectionApi | undefined) {
    if (this._section === next) return;
    this._detach();
    this._section = next;
    this._attach();
    this.requestUpdate();
  }

  private _messages?: Partial<ShellI18nMessages>;
  private _outsideClick: ((event: Event) => void) | undefined;
  private _escapeKey: ((event: KeyboardEvent) => void) | undefined;
  private _exportOutsideClick: ((event: Event) => void) | undefined;
  private _exportEscapeKey: ((event: KeyboardEvent) => void) | undefined;

  get messages(): ShellI18nMessages {
    return { ...getGlobalI18n().shell, ...this._messages };
  }

  set messages(val: Partial<ShellI18nMessages> | undefined) {
    this._messages = val;
    this.requestUpdate();
  }

  private _toolbarObserver: ResizeObserver | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this._attach();
    // Reconectado depois do primeiro desenho: `firstUpdated` não roda de novo.
    if (this.hasUpdated) this._observeToolbar();
  }

  protected override firstUpdated(changed: PropertyValues): void {
    super.firstUpdated(changed);
    this._observeToolbar();
  }

  /** Publica a largura da toolbar, para o mini-menu da seleção e o host evitarem a faixa dela. */
  private _observeToolbar(): void {
    const region = this.renderRoot?.querySelector('.right');
    if (!region || typeof ResizeObserver === 'undefined') return;
    this._toolbarObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      this.style.setProperty('--canvash-shell-toolbar-inline-size', `${width}px`);
    });
    this._toolbarObserver.observe(region);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._toolbarObserver?.disconnect();
    this._toolbarObserver = undefined;
    this._detach();
    this._stopWatchingDismiss();
    this._closeExport();
    this._closeParticipants();
  }

  private _attach(): void {
    if (this._section && !this._unsubscribeSection) {
      this._unsubscribeSection = this._section.subscribe(() => this.requestUpdate());
    }
  }

  private _detach(): void {
    this._unsubscribeSection?.();
    this._unsubscribeSection = undefined;
  }

  private _readOnly(): boolean {
    return this._section?.getSnapshot().session.readOnly ?? false;
  }

  protected override performUpdate(): void | Promise<unknown> {
    if (typeof document === 'undefined' || typeof document.createComment !== 'function') {
      return;
    }
    return super.performUpdate();
  }

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    // Um novo `user` tenta a foto de novo.
    if (changed.has('user')) this._avatarFailed = false;
    if (this._participantsOpen) {
      if (!this._participantsVisible()) this._closeParticipants();
      else if (changed.has('participants')) this._rememberParticipantFocus();
    }
  }

  protected override updated(changed: Map<string, unknown>): void {
    super.updated(changed);
    this._applyPendingFocus();
    this._restoreParticipantFocus();
    if (!changed.has('menuOpen')) return;
    const previous = changed.get('menuOpen');
    // Na primeira renderização o valor anterior é `undefined`: não há mudança a avisar.
    if (previous === undefined || previous === this.menuOpen) return;

    if (this.menuOpen) this._watchDismiss();
    else this._stopWatchingDismiss();
    this.dispatchEvent(
      new CustomEvent<MenuToggleEventDetail>('menu-toggle', {
        detail: { open: this.menuOpen },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _applyPendingFocus(): void {
    const target = this._pendingFocus;
    this._pendingFocus = undefined;
    if (target === 'input') {
      const input = this.renderRoot?.querySelector<HTMLInputElement>('[part~="title-input"]');
      input?.focus();
      input?.select();
    } else if (target === 'title') {
      this.renderRoot?.querySelector<HTMLElement>('[part~="title"]')?.focus();
    } else if (target === 'export-item') {
      this.renderRoot?.querySelector<HTMLElement>('[part~="export-item"]')?.focus();
    } else if (target === 'participant-control') {
      this._participantControls()[0]?.focus();
    }
  }

  // Título ------------------------------------------------------------------------------------

  private _startEdit(): void {
    if (this._editing || this._readOnly()) return;
    this._editing = true;
    this._pendingFocus = 'input';
  }

  private _finishEdit(): void {
    this._editing = false;
    this._pendingFocus = 'title';
  }

  /** Confirma: título vazio volta ao anterior e título igual ao atual não é mudança. */
  private _commitEdit(value: string): void {
    if (!this._editing) return;
    this._finishEdit();
    const title = value.trim().slice(0, MAX_TITLE_LENGTH);
    if (title === '' || title === this.projectTitle) return;
    this.dispatchEvent(
      new CustomEvent<TitleChangeEventDetail>('title-change', {
        detail: { title },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _cancelEdit(): void {
    if (this._editing) this._finishEdit();
  }

  private _onTitleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'F2') return;
    event.preventDefault();
    this._startEdit();
  }

  private _onInputKeydown(event: KeyboardEvent): void {
    const value = (event.target as HTMLInputElement | null)?.value ?? '';
    if (event.key === 'Enter') {
      event.preventDefault();
      this._commitEdit(value);
    } else if (event.key === 'Escape') {
      // O Esc cancela só a edição: não deve chegar ao fechamento do menu.
      event.preventDefault();
      event.stopPropagation();
      this._cancelEdit();
    }
  }

  private _onInputBlur(event: FocusEvent): void {
    this._commitEdit((event.target as HTMLInputElement | null)?.value ?? '');
  }

  private _renderTitle(msg: ShellI18nMessages) {
    const shown = this.projectTitle === '' ? msg.untitled : this.projectTitle;
    if (this._readOnly()) {
      return html`<span class="title" part="title">${shown}</span>`;
    }
    if (this._editing) {
      return html`<input
        class="title-input"
        part="title-input"
        type="text"
        maxlength=${MAX_TITLE_LENGTH}
        aria-label=${msg.titleInput}
        .value=${this.projectTitle}
        @keydown=${(event: KeyboardEvent) => this._onInputKeydown(event)}
        @blur=${(event: FocusEvent) => this._onInputBlur(event)}
      />`;
    }
    return html`<button
      type="button"
      class="title"
      part="title"
      aria-label=${msg.editTitle(shown)}
      @click=${() => this._startEdit()}
      @keydown=${(event: KeyboardEvent) => this._onTitleKeydown(event)}
    >
      ${shown}
    </button>`;
  }

  private _menuWrapper(): Element | null {
    return this.renderRoot?.querySelector('.top-start') ?? null;
  }

  private _menuButton(): HTMLElement | null {
    return this.renderRoot?.querySelector<HTMLElement>('[part~="menu-button"]') ?? null;
  }

  private _onMenuButtonClick(): void {
    this.menuOpen = !this.menuOpen;
    if (this.menuOpen) this._closeExport();
  }

  /** O host recebe o `id`; o menu fecha e o foco volta ao botão, como no Esc. */
  private _selectMenuItem(item: ShellMenuItem): void {
    if (item.disabled) return;
    this.menuOpen = false;
    this._menuButton()?.focus();
    this.dispatchEvent(
      new CustomEvent<MenuSelectEventDetail>('menu-select', {
        detail: { id: item.id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _renderMenuItems(items: readonly ShellMenuItem[]) {
    if (items.length === 0) return '';
    return html`<ul class="menu-items" part="menu-items">
      ${items.map(
        (item) =>
          html`<li>
            <button
              type="button"
              class="menu-item"
              part="menu-item"
              ?disabled=${item.disabled ?? false}
              @click=${() => this._selectMenuItem(item)}
            >
              ${item.icon ? html`<img src=${item.icon} alt="" width="20" height="20" />` : ''}
              ${item.label}
            </button>
          </li>`,
      )}
    </ul>`;
  }

  // Compartilhar e avatar ---------------------------------------------------------------------

  private _requestShare(): void {
    this.dispatchEvent(
      new CustomEvent<ShareRequestEventDetail>('share-request', {
        detail: { sharing: this.sharing },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _clickAvatar(): void {
    this.dispatchEvent(
      new CustomEvent<AvatarClickEventDetail>('avatar-click', {
        detail: {},
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _renderShare(msg: ShellI18nMessages) {
    if (this.hideShare) return '';
    const label =
      this.sharing === 'connecting'
        ? msg.shareConnecting
        : this.sharing === 'on'
          ? msg.shareActive
          : msg.share;
    return html`<button
      type="button"
      class="pill"
      part="share-button"
      aria-label=${label}
      data-sharing=${this.sharing}
      @click=${() => this._requestShare()}
    >
      <svg
        viewBox="0 0 256 256"
        width="16"
        height="16"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        ${svg`<path d="M176,160a39.89,39.89,0,0,0-28.62,12.09l-46.1-29.63a39.8,39.8,0,0,0,0-28.92l46.1-29.63a40,40,0,1,0-8.66-13.45l-46.1,29.63a40,40,0,1,0,0,55.82l46.1,29.63A40,40,0,1,0,176,160Zm0-128a24,24,0,1,1-24,24A24,24,0,0,1,176,32ZM64,152a24,24,0,1,1,24-24A24,24,0,0,1,64,152Zm112,72a24,24,0,1,1,24-24A24,24,0,0,1,176,224Z" />`}
      </svg>
      <span class="pill-label">${msg.share}</span>
      ${
        this.sharing === 'off'
          ? ''
          : html`<span
              class="share-status"
              part="share-status"
              data-state=${this.sharing}
              aria-hidden="true"
            ></span>`
      }
    </button>`;
  }

  // Ilha de participantes ---------------------------------------------------------------------

  /** A pilha (e, com ela, a ilha) só existe com a sessão ligada e pelo menos uma outra pessoa. */
  private _participantsVisible(): boolean {
    return (
      !this.hideParticipants &&
      this.sharing === 'on' &&
      stackOf(this.participants).remotes.length > 0
    );
  }

  private _participantsButton(): HTMLElement | null {
    return this.renderRoot?.querySelector<HTMLElement>('[part~="participants"]') ?? null;
  }

  /** Os controles da ilha, na ordem: o Seguir de cada pessoa e, por último, Parar. */
  private _participantControls(): HTMLElement[] {
    return [
      ...(this.renderRoot?.querySelectorAll<HTMLElement>(
        '[part~="follow-button"], [part~="share-stop-item"]',
      ) ?? []),
    ];
  }

  private _clearParticipantsTimer(): void {
    if (this._participantsTimer !== undefined) clearTimeout(this._participantsTimer);
    this._participantsTimer = undefined;
  }

  /** Mouse e caneta abrem a ilha por hover, depois de 80 ms; o toque só abre pelo clique. */
  private _participantsPointerEnter(event: { pointerType: string }): void {
    if (event.pointerType === 'touch') return;
    this._clearParticipantsTimer();
    if (this._participantsOpen) return;
    this._participantsTimer = setTimeout(() => {
      this._participantsTimer = undefined;
      if (this._participantsVisible()) this._openParticipants(false);
    }, HOVER_OPEN_MS);
  }

  /** Sair do conjunto pilha + ilha fecha em 250 ms, a menos que a ilha esteja fixada. */
  private _participantsPointerLeave(event: { pointerType: string }): void {
    if (event.pointerType === 'touch') return;
    this._clearParticipantsTimer();
    if (!this._participantsOpen || this._participantsPinned) return;
    this._participantsTimer = setTimeout(() => {
      this._participantsTimer = undefined;
      this._closeParticipants();
    }, HOVER_CLOSE_MS);
  }

  private _openParticipants(pinned: boolean, focusFirst = false): void {
    if (this._participantsOpen) {
      this._participantsPinned = this._participantsPinned || pinned;
      return;
    }
    this.menuOpen = false;
    this._closeExport();
    this._participantsOpen = true;
    this._participantsPinned = pinned;
    if (focusFirst) this._pendingFocus = 'participant-control';
    this._watchParticipantsDismiss();
  }

  /** Clique na pilha: abre fixada, fixa a que o hover abriu ou fecha a que já estava fixada. */
  private _toggleParticipants(): void {
    this._clearParticipantsTimer();
    if (!this._participantsOpen) this._openParticipants(true);
    else if (!this._participantsPinned) this._participantsPinned = true;
    else this._closeParticipants();
  }

  private _closeParticipants(restoreFocus = false): void {
    this._clearParticipantsTimer();
    if (!this._participantsOpen) return;
    this._participantsOpen = false;
    this._participantsPinned = false;
    this._stopWatchingParticipantsDismiss();
    if (restoreFocus) this._participantsButton()?.focus();
  }

  /** Seta para baixo abre pelo teclado; aberta, as setas andam pelos controles e Tab fecha. */
  private _onParticipantsKeydown(event: KeyboardEvent): void {
    if (!this._participantsOpen) {
      if (event.key === 'ArrowDown' && event.target === this._participantsButton()) {
        event.preventDefault();
        this._openParticipants(true, true);
      }
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      this._closeParticipants(true);
      return;
    }
    const controls = this._participantControls();
    const last = controls.length - 1;
    const current = controls.indexOf(event.composedPath()[0] as HTMLElement);
    const next: number | undefined = {
      ArrowDown: current >= last ? 0 : current + 1,
      ArrowUp: current <= 0 ? last : current - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    controls[next]?.focus();
  }

  /** O foco está numa linha que vai sair da lista: guarda o lugar para devolvê-lo à seguinte. */
  private _rememberParticipantFocus(): void {
    const active = (this.renderRoot as ShadowRoot | undefined)?.activeElement ?? null;
    const row = active?.closest<HTMLElement>('[data-session-id]');
    if (!active || !row) return;
    const stillThere = this.participants.some(
      (participant) => participant.id === row.dataset['sessionId'],
    );
    if (!stillThere)
      this._participantsRefocus = this._participantControls().indexOf(active as HTMLElement);
  }

  private _restoreParticipantFocus(): void {
    const index = this._participantsRefocus;
    this._participantsRefocus = undefined;
    if (index === undefined || index < 0) return;
    const controls = this._participantControls();
    controls[Math.min(index, controls.length - 1)]?.focus();
  }

  private _stopSharing(): void {
    this._closeParticipants(true);
    this.dispatchEvent(
      new CustomEvent<ShareStopEventDetail>('share-stop', {
        detail: {},
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Pede ao host para seguir a pessoa (ou, se já é a seguida, para parar). */
  private _followParticipant(sessionId: string): void {
    this._emitFollow(sessionId === this.following ? null : sessionId);
  }

  private _stopFollowing(): void {
    this._emitFollow(null);
  }

  private _emitFollow(sessionId: string | null): void {
    this.dispatchEvent(
      new CustomEvent<FollowChangeEventDetail>('follow-change', {
        detail: { sessionId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** A pessoa seguida, se ela está na lista e a sessão está ligada. */
  private _followedParticipant(): ShellParticipant | undefined {
    if (this.following === null || this.sharing !== 'on') return undefined;
    return this.participants.find(
      (participant) => participant.id === this.following && participant.self !== true,
    );
  }

  private _renderFollowing(msg: ShellI18nMessages) {
    const followed = this._followedParticipant();
    if (!followed) return '';
    return html`
      <div
        class="follow-frame"
        part="follow-frame"
        aria-hidden="true"
        style="--follow-color: ${followed.color};"
      ></div>
      <div class="following-banner" part="following-banner">
        <span role="status">${msg.followingBanner(followed.name)}</span>
        <button
          type="button"
          class="following-stop"
          part="following-stop"
          @click=${() => this._stopFollowing()}
        >
          ${msg.stopFollowing}
        </button>
      </div>
    `;
  }

  private _watchParticipantsDismiss(): void {
    if (this._participantsOutsideClick || typeof document === 'undefined') return;
    this._participantsOutsideClick = (event: Event) => {
      const island = this.renderRoot?.querySelector('.participants');
      if (island && !event.composedPath().includes(island)) this._closeParticipants();
    };
    this._participantsEscapeKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      this._closeParticipants(true);
    };
    document.addEventListener('pointerdown', this._participantsOutsideClick, true);
    document.addEventListener('keydown', this._participantsEscapeKey);
  }

  private _stopWatchingParticipantsDismiss(): void {
    if (!this._participantsOutsideClick) return;
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointerdown', this._participantsOutsideClick, true);
      if (this._participantsEscapeKey) {
        document.removeEventListener('keydown', this._participantsEscapeKey);
      }
    }
    this._participantsOutsideClick = undefined;
    this._participantsEscapeKey = undefined;
  }

  /** Um avatar de participante: foto, ou as iniciais sobre a cor dele quando não há foto. */
  private _renderParticipantAvatar(participant: ShellParticipant) {
    const photo =
      participant.avatarUrl && !this._failedPhotos.has(participant.id)
        ? participant.avatarUrl
        : undefined;
    return html`<span
      class="participant-avatar"
      part="participant-avatar"
      title=${participant.name}
      data-session-id=${participant.id}
      style="--ring: ${participant.color}; color: ${initialsTextColor(participant.color)};"
    >
      ${
        photo
          ? html`<img
              part="participant-image"
              src=${photo}
              alt=""
              width="24"
              height="24"
              @error=${() => {
                this._failedPhotos = new Set(this._failedPhotos).add(participant.id);
                this.requestUpdate();
              }}
            />`
          : initialsOf(participant.name)
      }
    </span>`;
  }

  private _renderParticipants(msg: ShellI18nMessages) {
    if (this.hideParticipants || this.sharing !== 'on') return '';
    const stack = stackOf(this.participants, this.following);
    if (stack.remotes.length === 0) return '';
    return html`<div
      class="participants"
      @pointerenter=${(event: PointerEvent) => this._participantsPointerEnter(event)}
      @pointerleave=${(event: PointerEvent) => this._participantsPointerLeave(event)}
      @keydown=${(event: KeyboardEvent) => this._onParticipantsKeydown(event)}
    >
      <button
        type="button"
        class="participants-stack"
        part="participants"
        aria-label=${msg.participants(stack.remotes.length)}
        aria-haspopup="dialog"
        aria-expanded=${this._participantsOpen ? 'true' : 'false'}
        aria-controls="participants-island"
        @click=${() => this._toggleParticipants()}
      >
        ${stack.shown.map((participant) => this._renderParticipantAvatar(participant))}
        ${
          stack.extra > 0
            ? html`<span class="participants-more" part="participants-more" aria-hidden="true"
                >+${stack.extra}</span
              >`
            : ''
        }
      </button>
      ${this._participantsOpen ? this._renderParticipantsIsland(msg) : ''}
    </div>`;
  }

  private _renderParticipantsIsland(msg: ShellI18nMessages) {
    // A pessoa local primeiro, depois os outros na ordem de chegada.
    const rows = [
      ...this.participants.filter((participant) => participant.self === true),
      ...this.participants.filter((participant) => participant.self !== true),
    ];
    return html`<div
      id="participants-island"
      class="participants-island"
      part="participants-island"
      role="dialog"
      aria-label=${msg.participantsDialog}
    >
      <div class="participants-title" part="participants-title">
        ${msg.inSession(this.participants.length)}
      </div>
      <ul class="participants-list" part="participants-list" role="list">
        ${rows.map(
          (participant) =>
            html`<li
              class="participant-row"
              part="participant-row"
              data-session-id=${participant.id}
            >
              ${this._renderParticipantAvatar(participant)}
              <span class="participant-name" part="participant-name"
                >${participant.name}${
                  participant.self ? html` <span class="participant-you">${msg.you}</span>` : ''
                }</span
              >
              ${
                participant.self
                  ? ''
                  : html`<button
                      type="button"
                      class="follow-button"
                      part="follow-button"
                      aria-pressed=${participant.id === this.following ? 'true' : 'false'}
                      ?disabled=${participant.canFollow === false}
                      title=${participant.canFollow === false ? msg.followUnsupported : nothing}
                      @click=${() => this._followParticipant(participant.id)}
                    >
                      ${participant.id === this.following ? msg.following : msg.follow}
                    </button>`
              }
            </li>`,
        )}
      </ul>
      <div class="participants-divider" role="separator"></div>
      <button
        type="button"
        class="share-stop-item"
        part="share-stop-item"
        @click=${() => this._stopSharing()}
      >
        ${msg.shareStop}
      </button>
    </div>`;
  }

  private _renderAvatar(msg: ShellI18nMessages) {
    const user = this.user;
    if (!user) return '';
    const photo = user.avatarUrl && !this._avatarFailed ? user.avatarUrl : undefined;
    return html`<button
      type="button"
      class="avatar"
      part="avatar"
      aria-label=${msg.account(user.name)}
      @click=${() => this._clickAvatar()}
    >
      ${
        photo
          ? html`<img
              part="avatar-image"
              src=${photo}
              alt=""
              width="32"
              height="32"
              @error=${() => {
                this._avatarFailed = true;
              }}
            />`
          : html`<span part="avatar-initials" aria-hidden="true">${initialsOf(user.name)}</span>`
      }
    </button>`;
  }

  // Ilha de exportação -------------------------------------------------------------------------

  private _exportButton(): HTMLElement | null {
    return this.renderRoot?.querySelector<HTMLElement>('[part~="export-button"]') ?? null;
  }

  private _exportItems(): HTMLElement[] {
    return [...(this.renderRoot?.querySelectorAll<HTMLElement>('[part~="export-item"]') ?? [])];
  }

  private _toggleExport(): void {
    if (this._exportOpen) this._closeExport();
    else this._openExport();
  }

  /** Abre a ilha com o foco no primeiro item. Abrir uma ilha fecha a outra. */
  private _openExport(): void {
    if (this._exportOpen) return;
    this.menuOpen = false;
    this._closeParticipants();
    this._exportOpen = true;
    this._pendingFocus = 'export-item';
    this._watchExportDismiss();
  }

  private _closeExport(restoreFocus = false): void {
    if (!this._exportOpen) return;
    this._exportOpen = false;
    this._stopWatchingExportDismiss();
    if (restoreFocus) this._exportButton()?.focus();
  }

  /** O host recebe o formato; quem exporta (e baixa o arquivo) é ele, não o shell. */
  private _chooseExport(format: ExportFormat): void {
    this._closeExport(true);
    this.dispatchEvent(
      new CustomEvent<ExportRequestEventDetail>('export-request', {
        detail: { format },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Seta para baixo abre a ilha; aberta, as setas andam pelos itens e Tab a fecha. */
  private _onExportKeydown(event: KeyboardEvent): void {
    if (!this._exportOpen) {
      if (event.key === 'ArrowDown' && event.target === this._exportButton()) {
        event.preventDefault();
        this._openExport();
      }
      return;
    }
    if (event.key === 'Tab') {
      // A ilha sai do DOM ao fechar: o foco vai à pill, de onde o Tab seguinte continua.
      event.preventDefault();
      this._closeExport(true);
      return;
    }
    const items = this._exportItems();
    const last = items.length - 1;
    const current = items.indexOf(event.target as HTMLElement);
    const next: number | undefined = {
      ArrowDown: current >= last ? 0 : current + 1,
      ArrowUp: current <= 0 ? last : current - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
  }

  /**
   * Fechar por clique fora ou por Esc. Os listeners ficam no `document` e só existem com a ilha
   * aberta (WC-04), como os do menu hambúrguer.
   */
  private _watchExportDismiss(): void {
    if (this._exportOutsideClick || typeof document === 'undefined') return;
    this._exportOutsideClick = (event: Event) => {
      const island = this.renderRoot?.querySelector('[part~="export"]');
      if (island && !event.composedPath().includes(island)) this._closeExport();
    };
    this._exportEscapeKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      this._closeExport(true);
    };
    document.addEventListener('pointerdown', this._exportOutsideClick, true);
    document.addEventListener('keydown', this._exportEscapeKey);
  }

  private _stopWatchingExportDismiss(): void {
    if (!this._exportOutsideClick) return;
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointerdown', this._exportOutsideClick, true);
      if (this._exportEscapeKey) document.removeEventListener('keydown', this._exportEscapeKey);
    }
    this._exportOutsideClick = undefined;
    this._exportEscapeKey = undefined;
  }

  private _renderExport(msg: ShellI18nMessages) {
    if (this.hideExport) return '';
    return html`<div
      class="export"
      part="export"
      @keydown=${(event: KeyboardEvent) => this._onExportKeydown(event)}
    >
      <button
        type="button"
        class="pill"
        part="export-button"
        aria-label=${msg.export}
        aria-haspopup="menu"
        aria-expanded=${this._exportOpen ? 'true' : 'false'}
        aria-controls="export-menu"
        @click=${() => this._toggleExport()}
      >
        <svg
          viewBox="0 0 18 18"
          width="20"
          height="20"
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          ${svg`<path d="M4.05 15.3C3.675 15.3 3.35625 15.1687 3.09375 14.9062C2.83125 14.6437 2.7 14.325 2.7 13.95V10.8H4.05V13.95H13.95V4.05H4.05V7.2H2.7V4.05C2.7 3.675 2.83125 3.35625 3.09375 3.09375C3.35625 2.83125 3.675 2.7 4.05 2.7H13.95C14.325 2.7 14.6438 2.83125 14.9063 3.09375C15.1688 3.35625 15.3 3.675 15.3 4.05V13.95C15.3 14.325 15.1688 14.6437 14.9063 14.9062C14.6438 15.1687 14.325 15.3 13.95 15.3H4.05ZM8.1 12.6L7.14375 11.6437L9.1125 9.675H2.7V8.325H9.1125L7.14375 6.35625L8.1 5.4L11.7 9L8.1 12.6Z" fill="currentColor" />`}
        </svg>
        <span class="pill-label">${msg.export}</span>
      </button>
      ${
        this._exportOpen
          ? html`<div
              id="export-menu"
              class="export-menu"
              part="export-menu"
              role="menu"
              aria-label=${msg.exportMenu}
            >
              <button
                type="button"
                role="menuitem"
                class="menu-item"
                part="export-item"
                data-format="svg"
                @click=${() => this._chooseExport('svg')}
              >
                ${msg.exportSvg}
              </button>
              <button
                type="button"
                role="menuitem"
                class="menu-item"
                part="export-item"
                data-format="png"
                @click=${() => this._chooseExport('png')}
              >
                ${msg.exportPng}
              </button>
            </div>`
          : ''
      }
    </div>`;
  }

  /** Esc fecha o menu e devolve o foco ao botão. */
  private _onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.menuOpen) return;
    event.preventDefault();
    this.menuOpen = false;
    this._menuButton()?.focus();
  }

  /**
   * Fechar por clique fora ou por Esc. Os listeners ficam no `document` e só existem com o menu
   * aberto (WC-04); Esc não pode depender do foco, porque o Safari não foca o botão ao clicar.
   */
  private _watchDismiss(): void {
    if (this._outsideClick || typeof document === 'undefined') return;
    this._outsideClick = (event: Event) => {
      const wrapper = this._menuWrapper();
      if (wrapper && !event.composedPath().includes(wrapper)) this.menuOpen = false;
    };
    this._escapeKey = (event: KeyboardEvent) => this._onKeydown(event);
    document.addEventListener('pointerdown', this._outsideClick, true);
    document.addEventListener('keydown', this._escapeKey);
  }

  private _stopWatchingDismiss(): void {
    if (!this._outsideClick) return;
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointerdown', this._outsideClick, true);
      if (this._escapeKey) document.removeEventListener('keydown', this._escapeKey);
    }
    this._outsideClick = undefined;
    this._escapeKey = undefined;
  }

  override render() {
    const msg = this.messages;
    return html`
      <div class="shell" part="shell">
        <div class="canvas-layer" part="canvas-layer"><slot></slot></div>
        <!-- Logo depois do canvas no DOM: o mini-menu da seleção entra na tabulação depois dele. -->
        <div class="overlay" part="overlay"><slot name="overlay"></slot></div>
        ${this._renderFollowing(msg)}

        <div class="top" part="top">
          <div
            class="top-start"
            part="top-start"
            @keydown=${(event: KeyboardEvent) => this._onKeydown(event)}
          >
            <button
              type="button"
              class="menu-button"
              part="menu-button"
              aria-label=${msg.menu}
              aria-expanded=${this.menuOpen ? 'true' : 'false'}
              aria-controls="menu"
              @click=${() => this._onMenuButtonClick()}
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                aria-hidden="true"
                focusable="false"
              >
                ${svg`<path d="M4 7h16M4 12h16M4 17h16" />`}
              </svg>
            </button>
            ${this._renderTitle(msg)}
            ${
              this.menuOpen
                ? html`<div id="menu" class="menu" part="menu">
                    ${this._renderMenuItems(this.menuItems)}<slot name="menu"></slot>
                  </div>`
                : ''
            }
          </div>
          <div class="top-end" part="top-end">
            <slot name="actions"></slot>
            ${this._renderParticipants(msg)} ${this._renderShare(msg)} ${this._renderExport(msg)}
            ${this._renderAvatar(msg)}
          </div>
        </div>

        <div class="left" part="left"><slot name="left"></slot></div>
        <div class="right" part="right toolbar"><slot name="toolbar"></slot></div>
        <div class="bottom-end" part="bottom-end"><slot name="controls"></slot></div>
      </div>
    `;
  }
}
