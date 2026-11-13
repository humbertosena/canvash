import React, { useCallback, useRef, useState, useEffect } from 'react';
import { createCanvasSection, POLYGON_PRESETS, type CanvasSectionApi } from '@canvash/core';
import type { ShellParticipantLike } from '@canvash/collaboration';
import {
  CanvasSurface,
  CanvasControls,
  CanvasSelectionMenu,
  CanvasSection,
  CanvasToolbar,
  CanvasLayers,
  CanvasProperties,
  useCanvasSnapshot,
  type CanvasSurfaceHandle,
  type DocumentChangeEventDetail,
  type SelectionChangeEventDetail,
  type ShellMenuItem,
  type ShellUser,
} from '@canvash/react';
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

export function App() {
  const [activeSection, setActiveSection] = useState<CanvasSectionApi>(() => createCanvasSection());
  const canvasRef = useRef<CanvasSurfaceHandle>(null);
  // O elemento só existe depois da montagem: o estado leva os controles a recebê-lo.
  const [canvasElement, setCanvasElement] = useState<CanvasSurfaceHandle['element']>(null);
  const containerRef = useRef<HTMLElement>(null);
  const snapshot = useCanvasSnapshot(activeSection);

  const [events, setEvents] = useState<Array<{ type: string; detail: unknown }>>([]);
  const [isReadOnly, setIsReadOnly] = useState<boolean>(false);
  const [projectTitle, setProjectTitle] = useState<string>('Canvash — React');
  // Camadas e propriedades dividem o cartão da esquerda, que começa escondido.
  const [showPanels, setShowPanels] = useState<boolean>(false);
  const [autosaveText, setAutosaveText] = useState<string>('💾 Autosave: Pronto');
  const [collabText, setCollabText] = useState<string>('👥 Colab: Desconectado');
  const [sharing, setSharing] = useState<SharingState>('off');
  const [participants, setParticipants] = useState<ShellParticipantLike[]>([]);
  const [following, setFollowing] = useState<string | null>(null);
  const collabManagerRef = useRef<CollabPersistenceHandle | null>(null);
  // Aviso passageiro (`role="status"`) para o menu, o compartilhar e o avatar.
  const [status, setStatus] = useState<string>('');
  const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // O botão do playground acompanha o estado real do popover (`toggle`).
  const [playgroundOpen, setPlaygroundOpen] = useState<boolean>(false);

  const notify = useCallback((message: string) => {
    setStatus(message);
    clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(''), 3000);
  }, []);
  useEffect(() => () => clearTimeout(statusTimer.current), []);

  const shareLink = useCallback(
    async (sharingNow: SharingState) => {
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
      if (sharingNow === 'off' && collabManagerRef.current) {
        const started = await collabManagerRef.current.startSharing();
        if (!started.ok) notify('Não foi possível compartilhar');
      }
    },
    [notify],
  );

  const toggleCollab = useCallback(async () => {
    const manager = collabManagerRef.current;
    if (!manager) return;
    const wasOn = manager.getSharing() === 'on';
    const stillOn = await manager.toggleCollab();
    // O texto do botão acompanha `sharing`; aqui só o aviso de parada pendente.
    if (wasOn && stillOn) notify('Há alterações pendentes; o compartilhamento continua ativo');
  }, [notify]);

  // Depois da montagem o ref já aponta para o <canvas-surface>; os controles precisam dele.
  useEffect(() => {
    setCanvasElement(canvasRef.current?.element ?? null);
  }, [activeSection]);

  useEffect(() => {
    const mainEl = containerRef.current;
    const manager = createCollabPersistenceManager({
      section: activeSection,
      canvasContainer: mainEl,
      appName: 'React',
      onAutosaveStatusChange: (status) => setAutosaveText(status),
      onCollabInfoChange: (info) => setCollabText(info),
      onSharingChange: setSharing,
      onParticipantsChange: setParticipants,
      onFollowChange: (sessionId, reason, name) => {
        setFollowing(sessionId);
        if (reason === 'left' && name) notify(`${name} saiu; você parou de seguir`);
      },
      onLockLost: (_nodeId, holder) => notify(`${holder.name} já está editando este elemento`),
    });
    collabManagerRef.current = manager;
    // O link com `?collab=true` abre a sessão já compartilhando.
    if (manager.autoShare) {
      void manager.startSharing().then((started) => {
        if (!started.ok && collabManagerRef.current === manager) {
          notify('Não foi possível compartilhar');
        }
      });
    }

    return () => {
      manager.destroy();
      collabManagerRef.current = null;
      setSharing('off');
    };
  }, [activeSection, notify]);

  useEffect(() => {
    (window as unknown as { __CANVASH_REACT__?: unknown }).__CANVASH_REACT__ = {
      section: activeSection,
      canvasRef,
      getSnapshot: () => activeSection.getSnapshot(),
      createCanvasSection,
      events,
      addRectangle: () => {
        return activeSection.dispatch({
          type: 'shape.create',
          shape: { type: 'rectangle', x: 60, y: 60, width: 150, height: 100, rotation: 0 },
        });
      },
      addSquare: () => {
        return activeSection.dispatch({
          type: 'shape.create',
          shape: { type: 'square', x: 80, y: 80, width: 120, height: 120, rotation: 0 },
        });
      },
      addCircle: () => {
        return activeSection.dispatch({
          type: 'shape.create',
          shape: { type: 'circle', x: 100, y: 100, width: 120, height: 120, rotation: 0 },
        });
      },
      addDiamond: () => {
        return activeSection.dispatch({
          type: 'shape.create',
          shape: { type: 'diamond', x: 110, y: 110, width: 140, height: 100, rotation: 0 },
        });
      },
      addTriangle: () => {
        return activeSection.dispatch({
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
        return activeSection.dispatch({
          type: 'shape.create',
          shape: { type: 'bezier', start: { x: 140, y: 260 }, end: { x: 300, y: 260 } },
        });
      },
      addPolygon: () => {
        return activeSection.dispatch({
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
        setIsReadOnly((prev) => !prev);
      },
      setNewSection: (newSection: CanvasSectionApi) => {
        setActiveSection(newSection);
      },
      collab: collabManagerRef.current,
    };
  }, [activeSection, events, isReadOnly]);

  return (
    <main ref={containerRef} style={{ position: 'fixed', inset: 0 }}>
      <CanvasSection
        section={activeSection}
        projectTitle={projectTitle}
        onTitleChange={setProjectTitle}
        menuItems={MENU_ITEMS}
        onMenuSelect={(id) => {
          const item = MENU_ITEMS.find((candidate) => candidate.id === id);
          if (item) notify(`Selecionado: ${item.label}`);
        }}
        user={USER}
        onAvatarClick={() => notify(`Conta: ${USER.name}`)}
        onExportRequest={(format) => {
          if (format === 'svg') collabManagerRef.current?.exportSvgDoc();
          else collabManagerRef.current?.exportPngDoc();
        }}
        sharing={sharing}
        participants={participants}
        following={following}
        onFollowChange={(sessionId) => {
          const followed = collabManagerRef.current?.follow(sessionId);
          if (followed && !followed.ok) notify('Não foi possível seguir esta pessoa');
        }}
        onShareStop={() => void toggleCollab()}
        onShareRequest={({ sharing: sharingNow }) => void shareLink(sharingNow)}
        style={{ display: 'block', width: '100%', height: '100%' }}
      >
        <CanvasSurface
          ref={canvasRef}
          section={activeSection}
          readOnly={isReadOnly}
          grid={true}
          gridSize={20}
          ariaLabel="Área de Desenho Canvash React"
          onTextEditSuperseded={({ nodeId, text }) =>
            showSupersededNotice(activeSection.getPeerLock(nodeId)?.name ?? 'Outra pessoa', text)
          }
          onCanvasReady={(detail) => {
            setEvents((prev) => [...prev, { type: 'canvas-ready', detail }]);
          }}
          onDocumentChange={(detail: DocumentChangeEventDetail) => {
            setEvents((prev) => [...prev, { type: 'document-change', detail }]);
          }}
          onSelectionChange={(detail: SelectionChangeEventDetail) => {
            setEvents((prev) => [...prev, { type: 'selection-change', detail }]);
          }}
        />

        <div slot="left" className="left-stack" id="react-left" hidden={!showPanels}>
          <CanvasLayers section={activeSection} />
        </div>

        {/* Mini-menu da seleção sobre o canvas; as propriedades abrem na ilha da toolbar. */}
        <CanvasSelectionMenu
          slot="overlay"
          section={activeSection}
          canvas={canvasElement}
          exportBoard
          onExportBoardRequest={({ boardId, format }) =>
            void collabManagerRef.current?.exportBoard(boardId, format)
          }
        />

        <CanvasToolbar
          slot="toolbar"
          section={activeSection}
          orientation="vertical"
          hideHistory
          hideZoom
          compactReadonly
        >
          <CanvasProperties slot="properties" section={activeSection} />
          <button
            slot="end"
            type="button"
            id="btn-playground"
            className="playground-button"
            aria-label="Playground"
            aria-controls="playground-panel"
            aria-expanded={playgroundOpen}
            popoverTarget="playground-panel"
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
              <circle cx="16" cy="7" r="2" />
              <circle cx="8" cy="17" r="2" />
            </svg>
          </button>
          {/* Playground, persistência e colaboração: o que antes morava no menu hambúrguer. */}
          <div
            slot="end"
            id="playground-panel"
            className="menu-content playground-panel"
            popover="auto"
            role="group"
            aria-label="Playground"
            onBeforeToggle={(event) => {
              if (event.newState !== 'open') return;
              // Abre colado à esquerda da toolbar, qualquer que seja a largura dela (edição ou leitura).
              const gap = 12;
              const margin = 16;
              const panel = event.currentTarget;
              const left = panel.closest('canvas-toolbar')?.getBoundingClientRect().left ?? 0;
              panel.style.right = `${document.documentElement.clientWidth - left + gap}px`;
              panel.style.maxWidth = `min(360px, ${left - gap - margin}px)`;
            }}
            onToggle={(event) => setPlaygroundOpen(event.newState === 'open')}
          >
            <div className="menu-section">
              <span className="menu-title">Playground</span>
              <div className="menu-row">
                <button
                  id="btn-add-rect"
                  onClick={() => {
                    activeSection.dispatch({
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
                  }}
                >
                  + Retângulo
                </button>
                <button
                  id="btn-add-square"
                  onClick={() => {
                    activeSection.dispatch({
                      type: 'shape.create',
                      shape: { type: 'square', x: 80, y: 80, width: 120, height: 120, rotation: 0 },
                    });
                  }}
                >
                  + Quadrado
                </button>
                <button
                  id="btn-add-circle"
                  onClick={() => {
                    activeSection.dispatch({
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
                  }}
                >
                  + Círculo
                </button>
                <button
                  id="btn-add-diamond"
                  onClick={() => {
                    activeSection.dispatch({
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
                  }}
                >
                  + Losango
                </button>
                <button
                  id="btn-add-triangle"
                  onClick={() => {
                    activeSection.dispatch({
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
                  }}
                >
                  + Triângulo
                </button>
                <button
                  id="btn-add-polygon"
                  onClick={() => {
                    activeSection.dispatch({
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
                  }}
                >
                  + Polígono
                </button>
                <button
                  id="btn-add-pentagon"
                  onClick={() => {
                    activeSection.dispatch({
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
                  }}
                >
                  + Pentágono
                </button>
                <button
                  id="btn-add-hexagon"
                  onClick={() => {
                    activeSection.dispatch({
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
                  }}
                >
                  + Hexágono
                </button>
                <button
                  id="btn-add-octagon"
                  onClick={() => {
                    activeSection.dispatch({
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
                  }}
                >
                  + Octógono
                </button>
                <button
                  id="btn-add-cross"
                  onClick={() => {
                    activeSection.dispatch({
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
                  }}
                >
                  + Cruz
                </button>
                <button
                  id="btn-add-chevron"
                  onClick={() => {
                    activeSection.dispatch({
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
                  }}
                >
                  + Chevron
                </button>
                <button
                  id="btn-add-brace"
                  onClick={() => {
                    activeSection.dispatch({
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
                  }}
                >
                  + Chaves
                </button>
                <button
                  id="btn-add-sticky"
                  onClick={() => {
                    activeSection.dispatch({
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
                  }}
                >
                  + Nota adesiva
                </button>
                <button
                  id="btn-add-bezier"
                  onClick={() => {
                    activeSection.dispatch({
                      type: 'shape.create',
                      shape: { type: 'bezier', start: { x: 140, y: 260 }, end: { x: 300, y: 260 } },
                    });
                  }}
                >
                  + Bézier
                </button>
                <button
                  id="btn-toggle-readonly"
                  onClick={() => {
                    setIsReadOnly((prev) => !prev);
                  }}
                >
                  {isReadOnly ? 'Desativar ReadOnly' : 'Ativar ReadOnly'}
                </button>

                <button
                  id="btn-toggle-panels"
                  data-testid="btn-toggle-panels"
                  aria-pressed={showPanels}
                  onClick={() => setShowPanels((prev) => !prev)}
                >
                  {showPanels ? 'Painéis: visíveis' : 'Painéis: ocultos'}
                </button>
              </div>
              <span
                id="label-status"
                style={{ marginLeft: 'auto', fontSize: '13px', color: '#64748b' }}
              >
                Revisão: {snapshot?.revision ?? 0} | Nós:{' '}
                {Object.keys(snapshot?.document.nodes ?? {}).length}
              </span>
            </div>
            <div className="menu-section">
              <div className="extra-panel-row">
                <span className="menu-title">💾 Persistência & I/O:</span>
                <div className="btn-group">
                  <button
                    id="btn-save-now"
                    data-testid="btn-save-now"
                    title="Salvar agora no IndexedDB"
                    onClick={() => collabManagerRef.current?.saveNow()}
                  >
                    Salvar Agora
                  </button>
                  <button
                    id="btn-load-saved"
                    data-testid="btn-load-saved"
                    title="Carregar documento do IndexedDB"
                    onClick={() => collabManagerRef.current?.loadSaved()}
                  >
                    Carregar Salvo
                  </button>
                  <button
                    id="btn-reset-doc"
                    data-testid="btn-reset-doc"
                    title="Resetar documento para fixture padrão"
                    onClick={() => collabManagerRef.current?.resetDoc()}
                  >
                    Resetar Padrão
                  </button>
                </div>
                <div id="autosave-info" data-testid="autosave-info" className="status-pill">
                  {autosaveText}
                </div>
              </div>
              <div className="extra-panel-row">
                <span className="menu-title">👥 Colaboração Real:</span>
                <div className="btn-group">
                  <button
                    id="btn-toggle-collab"
                    data-testid="btn-toggle-collab"
                    title="Alternar colaboração online/offline"
                    onClick={() => void toggleCollab()}
                  >
                    {sharing === 'off' ? 'Colaboração: Pausada' : 'Colaboração: Ativa'}
                  </button>
                  <button
                    id="btn-open-tab"
                    data-testid="btn-open-tab"
                    title="Abrir nova aba para testar colaboração em tempo real"
                    onClick={() => collabManagerRef.current?.openNewTab()}
                  >
                    ➕ Abrir Nova Aba
                  </button>
                </div>
                <div id="collab-info" data-testid="collab-info" className="status-pill">
                  {collabText}
                </div>
              </div>
            </div>
          </div>
        </CanvasToolbar>

        <CanvasControls slot="controls" section={activeSection} canvas={canvasElement} />
      </CanvasSection>
      <div id="app-status" data-testid="app-status" role="status" hidden={status === ''}>
        {status}
      </div>
    </main>
  );
}
