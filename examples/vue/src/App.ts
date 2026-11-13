import { computed, defineComponent, h, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { createCanvasSection, POLYGON_PRESETS, type CanvasSectionApi } from '@canvash/core';
import type { ShellParticipantLike } from '@canvash/collaboration';
import {
  CanvasSurface,
  CanvasControls,
  CanvasSelectionMenu,
  CanvasSection,
  CanvasLayers,
  CanvasProperties,
  CanvasToolbar,
  useCanvasSnapshot,
  type CanvasSurfaceInstance,
  type DocumentChangeEventDetail,
  type SelectionChangeEventDetail,
  type ShellMenuItem,
  type ShellUser,
} from '@canvash/vue';
import {
  createCollabPersistenceManager,
  showSupersededNotice,
  type CollabPersistenceHandle,
  type SharingState,
} from './collabPersistence.js';

// As ilhas do topo são do host: o shell desenha e avisa, e o exemplo decide o que cada uma faz.
// As referências são estáveis, para o shell não redesenhar o menu e o avatar a cada render.
const MENU_ITEMS: readonly ShellMenuItem[] = [
  { id: 'new', label: 'Novo projeto' },
  { id: 'open', label: 'Abrir projeto…' },
  { id: 'about', label: 'Sobre o Canvash' },
];
const USER: ShellUser = { name: 'Pessoa Exemplo', avatarUrl: '/avatar.svg' };

export const App = defineComponent({
  name: 'App',
  setup() {
    const activeSection = shallowRef<CanvasSectionApi>(createCanvasSection());
    const canvasRef = ref<CanvasSurfaceInstance | null>(null);
    const containerRef = ref<HTMLElement | null>(null);
    const snapshot = useCanvasSnapshot(activeSection);

    const events = ref<Array<{ type: string; detail: unknown }>>([]);
    const isReadOnly = ref<boolean>(false);
    const projectTitle = ref<string>('Canvash — Vue');
    // Camadas e propriedades dividem o cartão da esquerda, que começa escondido.
    const showPanels = ref<boolean>(false);
    const autosaveText = ref<string>('💾 Autosave: Pronto');
    const collabText = ref<string>('👥 Colab: Desconectado');
    const sharing = ref<SharingState>('off');
    const participants = shallowRef<ShellParticipantLike[]>([]);
    const following = ref<string | null>(null);
    let collabManager: CollabPersistenceHandle | null = null;
    // Aviso passageiro (`role="status"`) para o menu, o compartilhar e o avatar.
    const status = ref<string>('');
    let statusTimer: ReturnType<typeof setTimeout> | undefined;
    // O botão do playground acompanha o estado real do popover (`toggle`).
    const playgroundOpen = ref<boolean>(false);

    const notify = (message: string): void => {
      status.value = message;
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => {
        status.value = '';
      }, 3000);
    };
    onUnmounted(() => clearTimeout(statusTimer));

    const shareLink = async (sharingNow: SharingState): Promise<void> => {
      // O mesmo endereço de "Abrir Nova Aba": quem abrir entra na colaboração desta sala.
      const link = new URL(window.location.href);
      link.searchParams.set('collab', 'true');
      let copied = true;
      try {
        await navigator.clipboard.writeText(link.toString());
      } catch {
        copied = false;
      }
      notify(copied ? 'Link copiado' : 'Não foi possível copiar o link');
      // Em `off` o mesmo clique liga a colaboração; nos outros estados só copia o link.
      if (sharingNow === 'off' && collabManager) {
        const started = await collabManager.startSharing();
        if (!started.ok) notify('Não foi possível compartilhar');
      }
    };

    const toggleCollab = async (): Promise<void> => {
      if (!collabManager) return;
      const wasOn = collabManager.getSharing() === 'on';
      const stillOn = await collabManager.toggleCollab();
      // O texto do botão acompanha `sharing`; aqui só o aviso de parada pendente.
      if (wasOn && stillOn) notify('Há alterações pendentes; o compartilhamento continua ativo');
    };

    const revision = computed(() => snapshot.value?.revision ?? 0);
    const nodeCount = computed(() => Object.keys(snapshot.value?.document.nodes ?? {}).length);

    const setupCollab = () => {
      if (collabManager) {
        collabManager.destroy();
        collabManager = null;
      }
      const container = containerRef.value;
      collabManager = createCollabPersistenceManager({
        section: activeSection.value,
        canvasContainer: container,
        appName: 'Vue',
        onAutosaveStatusChange: (status) => {
          autosaveText.value = status;
        },
        onCollabInfoChange: (info) => {
          collabText.value = info;
        },
        onFollowChange: (sessionId, reason, name) => {
          following.value = sessionId;
          if (reason === 'left' && name) notify(`${name} saiu; você parou de seguir`);
        },
        onParticipantsChange: (list) => {
          participants.value = list;
        },
        onSharingChange: (state) => {
          sharing.value = state;
        },
        onLockLost: (_nodeId, holder) => notify(`${holder.name} já está editando este elemento`),
      });
      sharing.value = 'off';
      // O link com `?collab=true` abre a sessão já compartilhando.
      if (collabManager.autoShare) {
        const manager = collabManager;
        void manager.startSharing().then((started) => {
          if (!started.ok && collabManager === manager) notify('Não foi possível compartilhar');
        });
      }
    };

    const updateGlobal = () => {
      (window as unknown as { __CANVASH_VUE__?: unknown }).__CANVASH_VUE__ = {
        get section() {
          return activeSection.value;
        },
        canvasRef,
        getSnapshot: () => activeSection.value.getSnapshot(),
        createCanvasSection,
        events: events.value,
        addRectangle: () => {
          return activeSection.value.dispatch({
            type: 'shape.create',
            shape: { type: 'rectangle', x: 60, y: 60, width: 150, height: 100, rotation: 0 },
          });
        },
        addSquare: () => {
          return activeSection.value.dispatch({
            type: 'shape.create',
            shape: { type: 'square', x: 80, y: 80, width: 120, height: 120, rotation: 0 },
          });
        },
        addCircle: () => {
          return activeSection.value.dispatch({
            type: 'shape.create',
            shape: { type: 'circle', x: 100, y: 100, width: 120, height: 120, rotation: 0 },
          });
        },
        addDiamond: () => {
          return activeSection.value.dispatch({
            type: 'shape.create',
            shape: { type: 'diamond', x: 110, y: 110, width: 140, height: 100, rotation: 0 },
          });
        },
        addTriangle: () => {
          return activeSection.value.dispatch({
            type: 'shape.create',
            shape: {
              type: 'triangle',
              x: 120,
              y: 120,
              width: 140,
              height: 100,
              rotation: 0,
              variant: 'isosceles',
            },
          });
        },
        addBezier: () => {
          return activeSection.value.dispatch({
            type: 'shape.create',
            shape: { type: 'bezier', start: { x: 140, y: 260 }, end: { x: 300, y: 260 } },
          });
        },
        addPolygon: () => {
          return activeSection.value.dispatch({
            type: 'shape.create',
            shape: {
              type: 'polygon',
              x: 130,
              y: 130,
              width: 120,
              height: 120,
              rotation: 0,
              sides: 5,
            },
          });
        },
        toggleReadOnly: () => {
          isReadOnly.value = !isReadOnly.value;
        },
        setNewSection: (newSection: CanvasSectionApi) => {
          activeSection.value = newSection;
          setupCollab();
        },
        get collab() {
          return collabManager;
        },
      };
    };

    onMounted(() => {
      setupCollab();
      updateGlobal();
    });

    onUnmounted(() => {
      if (collabManager) {
        collabManager.destroy();
        collabManager = null;
      }
      delete (window as unknown as { __CANVASH_VUE__?: unknown }).__CANVASH_VUE__;
    });

    return () =>
      h('main', { ref: containerRef, style: { position: 'fixed', inset: 0 } }, [
        h(
          CanvasSection,
          {
            section: activeSection.value,
            projectTitle: projectTitle.value,
            onTitleChange: (title: string) => {
              projectTitle.value = title;
            },
            menuItems: MENU_ITEMS,
            onMenuSelect: (id: string) => {
              const item = MENU_ITEMS.find((candidate) => candidate.id === id);
              if (item) notify(`Selecionado: ${item.label}`);
            },
            user: USER,
            onAvatarClick: () => notify(`Conta: ${USER.name}`),
            onExportRequest: (format: 'svg' | 'png') => {
              if (format === 'svg') collabManager?.exportSvgDoc();
              else collabManager?.exportPngDoc();
            },
            sharing: sharing.value,
            participants: participants.value,
            following: following.value,
            onFollowChange: (sessionId: string | null) => {
              const followed = collabManager?.follow(sessionId);
              if (followed && !followed.ok) notify('Não foi possível seguir esta pessoa');
            },
            onShareStop: () => void toggleCollab(),
            onShareRequest: ({ sharing: sharingNow }: { sharing: SharingState }) =>
              void shareLink(sharingNow),
            style: { display: 'block', width: '100%', height: '100%' },
          },
          () => [
            h(CanvasSurface, {
              ref: canvasRef,
              section: activeSection.value,
              readOnly: isReadOnly.value,
              grid: true,
              gridSize: 20,
              ariaLabel: 'Área de Desenho Canvash Vue',
              onTextEditSuperseded: (detail: { nodeId: string; text: string }) =>
                showSupersededNotice(
                  activeSection.value.getPeerLock(detail.nodeId)?.name ?? 'Outra pessoa',
                  detail.text,
                ),
              onCanvasReady: (detail: unknown) => {
                events.value.push({ type: 'canvas-ready', detail });
              },
              onDocumentChange: (detail: DocumentChangeEventDetail) => {
                events.value.push({ type: 'document-change', detail });
              },
              onSelectionChange: (detail: SelectionChangeEventDetail) => {
                events.value.push({ type: 'selection-change', detail });
              },
            }),

            h(
              'div',
              { slot: 'left', class: 'left-stack', id: 'vue-left', hidden: !showPanels.value },
              [h(CanvasLayers, { section: activeSection.value })],
            ),

            // Mini-menu da seleção sobre o canvas; as propriedades abrem na ilha da toolbar.
            h(CanvasSelectionMenu, {
              slot: 'overlay',
              section: activeSection.value,
              canvas: canvasRef.value?.element ?? undefined,
              exportBoard: true,
              onExportBoardRequest: ({
                boardId,
                format,
              }: {
                boardId: string;
                format: 'png' | 'svg';
              }) => {
                void collabManager?.exportBoard(boardId, format);
              },
            }),

            h(
              CanvasToolbar,
              {
                slot: 'toolbar',
                section: activeSection.value,
                orientation: 'vertical',
                hideHistory: true,
                hideZoom: true,
                compactReadonly: true,
              },
              () => [
                h(CanvasProperties, { slot: 'properties', section: activeSection.value }),
                h(
                  'button',
                  {
                    slot: 'end',
                    type: 'button',
                    id: 'btn-playground',
                    class: 'playground-button',
                    'aria-label': 'Playground',
                    'aria-controls': 'playground-panel',
                    'aria-expanded': String(playgroundOpen.value),
                    popovertarget: 'playground-panel',
                  },
                  [
                    h(
                      'svg',
                      {
                        viewBox: '0 0 24 24',
                        width: 20,
                        height: 20,
                        fill: 'none',
                        stroke: 'currentColor',
                        'stroke-width': 1.75,
                        'stroke-linecap': 'round',
                        'aria-hidden': 'true',
                        focusable: 'false',
                      },
                      [
                        h('path', { d: 'M4 7h10M18 7h2M4 17h2M10 17h10' }),
                        h('circle', { cx: 16, cy: 7, r: 2 }),
                        h('circle', { cx: 8, cy: 17, r: 2 }),
                      ],
                    ),
                  ],
                ),
                // Playground, persistência e colaboração: o que antes morava no menu hambúrguer.
                h(
                  'div',
                  {
                    slot: 'end',
                    id: 'playground-panel',
                    class: 'menu-content playground-panel',
                    popover: 'auto',
                    role: 'group',
                    'aria-label': 'Playground',
                    onBeforetoggle: (event: Event) => {
                      if ((event as ToggleEvent).newState !== 'open') return;
                      // Abre colado à esquerda da toolbar, qualquer que seja a largura dela (edição ou leitura).
                      const gap = 12;
                      const margin = 16;
                      const panel = event.currentTarget as HTMLElement;
                      const left =
                        panel.closest('canvas-toolbar')?.getBoundingClientRect().left ?? 0;
                      panel.style.right = `${document.documentElement.clientWidth - left + gap}px`;
                      panel.style.maxWidth = `min(360px, ${left - gap - margin}px)`;
                    },
                    onToggle: (event: Event) => {
                      playgroundOpen.value = (event as ToggleEvent).newState === 'open';
                    },
                  },
                  [
                    h('div', { class: 'menu-section' }, [
                      h('span', { class: 'menu-title' }, 'Playground'),
                      h('div', { class: 'menu-row' }, [
                        h(
                          'button',
                          {
                            id: 'btn-add-rect',
                            onClick: () => {
                              activeSection.value.dispatch({
                                type: 'shape.create',
                                shape: {
                                  type: 'rectangle',
                                  x: 60,
                                  y: 60,
                                  width: 150,
                                  height: 100,
                                  rotation: 0,
                                },
                              });
                            },
                          },
                          '+ Retângulo',
                        ),
                        h(
                          'button',
                          {
                            id: 'btn-add-square',
                            onClick: () => {
                              activeSection.value.dispatch({
                                type: 'shape.create',
                                shape: {
                                  type: 'square',
                                  x: 80,
                                  y: 80,
                                  width: 120,
                                  height: 120,
                                  rotation: 0,
                                },
                              });
                            },
                          },
                          '+ Quadrado',
                        ),
                        h(
                          'button',
                          {
                            id: 'btn-add-circle',
                            onClick: () => {
                              activeSection.value.dispatch({
                                type: 'shape.create',
                                shape: {
                                  type: 'circle',
                                  x: 100,
                                  y: 100,
                                  width: 120,
                                  height: 120,
                                  rotation: 0,
                                },
                              });
                            },
                          },
                          '+ Círculo',
                        ),
                        h(
                          'button',
                          {
                            id: 'btn-add-diamond',
                            onClick: () => {
                              activeSection.value.dispatch({
                                type: 'shape.create',
                                shape: {
                                  type: 'diamond',
                                  x: 110,
                                  y: 110,
                                  width: 140,
                                  height: 100,
                                  rotation: 0,
                                },
                              });
                            },
                          },
                          '+ Losango',
                        ),
                        h(
                          'button',
                          {
                            id: 'btn-add-triangle',
                            onClick: () => {
                              activeSection.value.dispatch({
                                type: 'shape.create',
                                shape: {
                                  type: 'triangle',
                                  x: 120,
                                  y: 120,
                                  width: 140,
                                  height: 100,
                                  rotation: 0,
                                  variant: 'isosceles',
                                },
                              });
                            },
                          },
                          '+ Triângulo',
                        ),
                        h(
                          'button',
                          {
                            id: 'btn-add-polygon',
                            onClick: () => {
                              activeSection.value.dispatch({
                                type: 'shape.create',
                                shape: {
                                  type: 'polygon',
                                  x: 130,
                                  y: 130,
                                  width: 120,
                                  height: 120,
                                  rotation: 0,
                                  sides: 5,
                                },
                              });
                            },
                          },
                          '+ Polígono',
                        ),
                        h(
                          'button',
                          {
                            id: 'btn-add-pentagon',
                            onClick: () => {
                              activeSection.value.dispatch({
                                type: 'shape.create',
                                shape: {
                                  type: 'polygon',
                                  x: 130,
                                  y: 130,
                                  width: 120,
                                  height: 120,
                                  rotation: 0,
                                  sides: POLYGON_PRESETS.pentagon,
                                },
                              });
                            },
                          },
                          '+ Pentágono',
                        ),
                        h(
                          'button',
                          {
                            id: 'btn-add-hexagon',
                            onClick: () => {
                              activeSection.value.dispatch({
                                type: 'shape.create',
                                shape: {
                                  type: 'polygon',
                                  x: 130,
                                  y: 130,
                                  width: 120,
                                  height: 120,
                                  rotation: 0,
                                  sides: POLYGON_PRESETS.hexagon,
                                },
                              });
                            },
                          },
                          '+ Hexágono',
                        ),
                        h(
                          'button',
                          {
                            id: 'btn-add-octagon',
                            onClick: () => {
                              activeSection.value.dispatch({
                                type: 'shape.create',
                                shape: {
                                  type: 'polygon',
                                  x: 130,
                                  y: 130,
                                  width: 120,
                                  height: 120,
                                  rotation: 0,
                                  sides: POLYGON_PRESETS.octagon,
                                },
                              });
                            },
                          },
                          '+ Octógono',
                        ),
                        h(
                          'button',
                          {
                            id: 'btn-add-cross',
                            onClick: () => {
                              activeSection.value.dispatch({
                                type: 'shape.create',
                                shape: {
                                  type: 'cross',
                                  x: 130,
                                  y: 130,
                                  width: 120,
                                  height: 120,
                                  rotation: 0,
                                },
                              });
                            },
                          },
                          '+ Cruz',
                        ),
                        h(
                          'button',
                          {
                            id: 'btn-add-chevron',
                            onClick: () => {
                              activeSection.value.dispatch({
                                type: 'shape.create',
                                shape: {
                                  type: 'chevron',
                                  x: 140,
                                  y: 140,
                                  width: 140,
                                  height: 90,
                                  rotation: 0,
                                },
                              });
                            },
                          },
                          '+ Chevron',
                        ),
                        h(
                          'button',
                          {
                            id: 'btn-add-brace',
                            onClick: () => {
                              activeSection.value.dispatch({
                                type: 'shape.create',
                                shape: {
                                  type: 'brace',
                                  x: 150,
                                  y: 100,
                                  width: 50,
                                  height: 180,
                                  rotation: 0,
                                },
                              });
                            },
                          },
                          '+ Chaves',
                        ),
                        h(
                          'button',
                          {
                            id: 'btn-add-sticky',
                            onClick: () => {
                              activeSection.value.dispatch({
                                type: 'shape.create',
                                shape: {
                                  type: 'sticky',
                                  x: 180,
                                  y: 120,
                                  width: 200,
                                  height: 200,
                                  rotation: 0,
                                  text: 'Ideia',
                                },
                              });
                            },
                          },
                          '+ Nota adesiva',
                        ),
                        h(
                          'button',
                          {
                            id: 'btn-add-bezier',
                            onClick: () => {
                              activeSection.value.dispatch({
                                type: 'shape.create',
                                shape: {
                                  type: 'bezier',
                                  start: { x: 140, y: 260 },
                                  end: { x: 300, y: 260 },
                                },
                              });
                            },
                          },
                          '+ Bézier',
                        ),
                        h(
                          'button',
                          {
                            id: 'btn-toggle-readonly',
                            onClick: () => {
                              isReadOnly.value = !isReadOnly.value;
                            },
                          },
                          isReadOnly.value ? 'Desativar ReadOnly' : 'Ativar ReadOnly',
                        ),
                        h(
                          'button',
                          {
                            id: 'btn-toggle-panels',
                            'data-testid': 'btn-toggle-panels',
                            'aria-pressed': showPanels.value,
                            onClick: () => {
                              showPanels.value = !showPanels.value;
                            },
                          },
                          showPanels.value ? 'Painéis: visíveis' : 'Painéis: ocultos',
                        ),
                      ]),
                      h(
                        'span',
                        {
                          id: 'label-status',
                          style: { fontSize: '13px', color: '#4b5563' },
                        },
                        `Revisão: ${revision.value} | Nós: ${nodeCount.value}`,
                      ),
                    ]),
                    h('div', { class: 'menu-section' }, [
                      h('span', { class: 'menu-title' }, '💾 Persistência & I/O:'),
                      h('div', { class: 'btn-group' }, [
                        h(
                          'button',
                          {
                            id: 'btn-save-now',
                            'data-testid': 'btn-save-now',
                            title: 'Salvar agora no IndexedDB',
                            onClick: () => collabManager?.saveNow(),
                          },
                          'Salvar Agora',
                        ),
                        h(
                          'button',
                          {
                            id: 'btn-load-saved',
                            'data-testid': 'btn-load-saved',
                            title: 'Carregar documento do IndexedDB',
                            onClick: () => collabManager?.loadSaved(),
                          },
                          'Carregar Salvo',
                        ),
                        h(
                          'button',
                          {
                            id: 'btn-reset-doc',
                            'data-testid': 'btn-reset-doc',
                            title: 'Resetar documento para fixture padrão',
                            onClick: () => collabManager?.resetDoc(),
                          },
                          'Resetar Padrão',
                        ),
                      ]),
                      h(
                        'div',
                        {
                          id: 'autosave-info',
                          'data-testid': 'autosave-info',
                          class: 'status-pill',
                        },
                        autosaveText.value,
                      ),
                    ]),
                    h('div', { class: 'menu-section' }, [
                      h('span', { class: 'menu-title' }, '👥 Colaboração Real:'),
                      h('div', { class: 'btn-group' }, [
                        h(
                          'button',
                          {
                            id: 'btn-toggle-collab',
                            'data-testid': 'btn-toggle-collab',
                            title: 'Alternar colaboração online/offline',
                            onClick: () => void toggleCollab(),
                          },
                          sharing.value === 'off' ? 'Colaboração: Pausada' : 'Colaboração: Ativa',
                        ),
                        h(
                          'button',
                          {
                            id: 'btn-open-tab',
                            'data-testid': 'btn-open-tab',
                            title: 'Abrir nova aba para testar colaboração em tempo real',
                            onClick: () => collabManager?.openNewTab(),
                          },
                          '➕ Abrir Nova Aba',
                        ),
                      ]),
                      h(
                        'div',
                        {
                          id: 'collab-info',
                          'data-testid': 'collab-info',
                          class: 'status-pill',
                        },
                        collabText.value,
                      ),
                    ]),
                  ],
                ),
              ],
            ),

            h(CanvasControls, {
              slot: 'controls',
              section: activeSection.value,
              canvas: canvasRef.value?.element ?? undefined,
            }),
          ],
        ),
        h(
          'div',
          {
            id: 'app-status',
            'data-testid': 'app-status',
            role: 'status',
            hidden: status.value === '',
          },
          status.value,
        ),
      ]);
  },
});
