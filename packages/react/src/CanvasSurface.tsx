import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ForwardRefRenderFunction,
} from 'react';
import { createCanvasSection, type CanvasSectionApi, type CanvasDocument } from '@canvash/core';
import {
  defineCanvasElements,
  type CanvasSurfaceElement,
  type CanvasErrorEventDetail,
  type TextEditSupersededEventDetail,
  type CanvasReadyEventDetail,
  type DocumentChangeEventDetail,
  type FitToContentOptions,
  type GridStyle,
  type SelectionChangeEventDetail,
  type ToolChangeEventDetail,
  type ViewportChangeEventDetail,
} from '@canvash/web-components';

export interface CanvasSurfaceProps {
  /**
   * Instância externa de canvas gerenciada pelo host.
   * Não pode ser combinada com `initialDocument`.
   */
  section?: CanvasSectionApi | undefined;

  /**
   * Documento inicial para o modo interno (quando `section` não é fornecido).
   * Lança erro se informado em conjunto com `section` externo.
   */
  initialDocument?: CanvasDocument | undefined;

  /** Modo somente leitura. */
  readOnly?: boolean | undefined;

  /** Exibição de grade no fundo. */
  grid?: boolean | undefined;

  /** Tamanho da grade em CSS pixels (padrão: 20). */
  gridSize?: number | undefined;

  /** Aparência da grade: pontos (padrão) ou linhas. */
  gridStyle?: GridStyle | undefined;

  /** Realce da grade sob o mouse: ligado (`'on'`, padrão) ou desligado (`'off'`). */
  gridHighlight?: 'on' | 'off' | undefined;

  /** Rótulo acessível da região do canvas (padrão: 'Canvash Canvas'). */
  ariaLabel?: string | undefined;

  /** Classe CSS customizada. */
  className?: string | undefined;

  /** Estilos inline. */
  style?: CSSProperties | undefined;

  /** Callback disparado quando o canvas está pronto e montado. */
  onCanvasReady?: ((detail: CanvasReadyEventDetail) => void) | undefined;

  /** Callback disparado após cada commit de alteração no documento. */
  onDocumentChange?: ((detail: DocumentChangeEventDetail) => void) | undefined;

  /** Callback disparado quando a seleção de nós é alterada. */
  onSelectionChange?: ((detail: SelectionChangeEventDetail) => void) | undefined;

  /** Callback disparado quando o viewport (pan/zoom) é alterado. */
  onViewportChange?: ((detail: ViewportChangeEventDetail) => void) | undefined;

  /** Callback disparado quando a ferramenta ativa é alterada. */
  onToolChange?: ((detail: ToolChangeEventDetail) => void) | undefined;

  /** Callback disparado em caso de erro no canvas ou renderer. */
  onError?: ((detail: CanvasErrorEventDetail) => void) | undefined;

  /**
   * Outra pessoa passou a deter o nó que estava sendo editado: o editor fechou sem gravar, e o
   * texto digitado vem aqui para o host oferecer a cópia.
   */
  onTextEditSuperseded?: ((detail: TextEditSupersededEventDetail) => void) | undefined;
}

export interface CanvasSurfaceHandle {
  /** Instância ativa do canvas (seja interna ou externa). */
  readonly section: CanvasSectionApi | null;

  /** Foca a superfície interativa do canvas para navegação imediata por teclado. */
  focus(options?: FocusOptions): void;

  /** Enquadra o viewport aos limites dos nós visíveis com espaçamento opcional. */
  fitToContent(options?: FitToContentOptions): void;

  /** Enquadra o viewport aos limites dos nós selecionados; sem seleção, não faz nada. */
  fitToSelection(options?: FitToContentOptions): void;

  /** Multiplica o zoom por `factor`, mantendo no lugar o ponto central do canvas. */
  zoomBy(factor: number): void;

  /** Leva o zoom a `zoom` (dentro dos limites), mantendo no lugar o ponto central do canvas. */
  zoomTo(zoom: number): void;

  /** Elemento customizado <canvas-surface> no DOM. */
  readonly element: CanvasSurfaceElement | null;
}

// Garante o registro idempotente dos Web Components no ambiente cliente
if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
  defineCanvasElements();
}

// No servidor nenhum efeito roda, mas o React 18 (aceito no peerDependencies) avisa a cada
// useLayoutEffect renderizado lá; useEffect evita o aviso sem mudar nada.
const useClientLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const CanvasSurfaceComponent: ForwardRefRenderFunction<CanvasSurfaceHandle, CanvasSurfaceProps> = (
  props,
  ref,
) => {
  const {
    section: externalSection,
    initialDocument,
    readOnly = false,
    grid = false,
    gridSize = 20,
    gridStyle = 'dots',
    gridHighlight = 'on',
    ariaLabel = 'Canvash Canvas',
    className,
    style,
    onCanvasReady,
    onDocumentChange,
    onSelectionChange,
    onViewportChange,
    onToolChange,
    onError,
    onTextEditSuperseded,
  } = props;

  if (externalSection && initialDocument) {
    throw new TypeError(
      'Cannot combine initialDocument with external section prop: initialDocument is only supported in internal mode.',
    );
  }

  const customElementRef = useRef<CanvasSurfaceElement | null>(null);
  const internalSectionRef = useRef<CanvasSectionApi | null>(null);
  const isMountedRef = useRef<boolean>(false);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!externalSection && !internalSectionRef.current) {
    const b = createCanvasSection();
    if (initialDocument) {
      b.replaceDocument(initialDocument);
    }
    internalSectionRef.current = b;
  }

  const activeSection = externalSection ?? internalSectionRef.current;

  // Manter callbacks sempre atualizados sem recriar listeners
  const callbacksRef = useRef({
    onCanvasReady,
    onDocumentChange,
    onSelectionChange,
    onViewportChange,
    onToolChange,
    onError,
    onTextEditSuperseded,
  });
  callbacksRef.current = {
    onCanvasReady,
    onDocumentChange,
    onSelectionChange,
    onViewportChange,
    onToolChange,
    onError,
    onTextEditSuperseded,
  };

  useImperativeHandle(
    ref,
    () => ({
      get section() {
        return activeSection;
      },
      focus(options?: FocusOptions) {
        customElementRef.current?.focus(options);
      },
      fitToContent(options?: FitToContentOptions) {
        customElementRef.current?.fitToContent(options);
      },
      fitToSelection(options?: FitToContentOptions) {
        customElementRef.current?.fitToSelection(options);
      },
      zoomBy(factor: number) {
        customElementRef.current?.zoomBy(factor);
      },
      zoomTo(zoom: number) {
        customElementRef.current?.zoomTo(zoom);
      },
      get element() {
        return customElementRef.current;
      },
    }),
    [activeSection],
  );

  // Efeitos de layout rodam no commit, antes do microtask em que o Lit faz firstUpdated → _mount();
  // com useEffect, o elemento montava uma section interna transitória e emitia canvas-ready sem
  // ouvinte. Os ouvintes vêm antes da sincronização de props porque o setter de `section` remonta
  // de forma síncrona e emite canvas-ready/canvas-error na hora.
  useClientLayoutEffect(() => {
    const el = customElementRef.current;
    if (!el) return;

    const handleCanvasReady = (e: Event) => {
      callbacksRef.current.onCanvasReady?.((e as CustomEvent<CanvasReadyEventDetail>).detail);
    };
    const handleDocumentChange = (e: Event) => {
      callbacksRef.current.onDocumentChange?.((e as CustomEvent<DocumentChangeEventDetail>).detail);
    };
    const handleSelectionChange = (e: Event) => {
      callbacksRef.current.onSelectionChange?.(
        (e as CustomEvent<SelectionChangeEventDetail>).detail,
      );
    };
    const handleViewportChange = (e: Event) => {
      callbacksRef.current.onViewportChange?.((e as CustomEvent<ViewportChangeEventDetail>).detail);
    };
    const handleToolChange = (e: Event) => {
      callbacksRef.current.onToolChange?.((e as CustomEvent<ToolChangeEventDetail>).detail);
    };
    const handleCanvasError = (e: Event) => {
      callbacksRef.current.onError?.((e as CustomEvent<CanvasErrorEventDetail>).detail);
    };

    el.addEventListener('canvas-ready', handleCanvasReady);
    el.addEventListener('document-change', handleDocumentChange);
    el.addEventListener('selection-change', handleSelectionChange);
    el.addEventListener('viewport-change', handleViewportChange);
    el.addEventListener('tool-change', handleToolChange);
    const handleTextEditSuperseded = (e: Event) => {
      callbacksRef.current.onTextEditSuperseded?.(
        (e as CustomEvent<TextEditSupersededEventDetail>).detail,
      );
    };
    el.addEventListener('canvas-error', handleCanvasError);
    el.addEventListener('text-edit-superseded', handleTextEditSuperseded);

    return () => {
      el.removeEventListener('canvas-ready', handleCanvasReady);
      el.removeEventListener('document-change', handleDocumentChange);
      el.removeEventListener('selection-change', handleSelectionChange);
      el.removeEventListener('viewport-change', handleViewportChange);
      el.removeEventListener('tool-change', handleToolChange);
      el.removeEventListener('canvas-error', handleCanvasError);
      el.removeEventListener('text-edit-superseded', handleTextEditSuperseded);
    };
  }, []);

  useClientLayoutEffect(() => {
    isMountedRef.current = true;
    if (cleanupTimerRef.current !== null) {
      clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }

    const el = customElementRef.current;
    if (el) {
      el.section = activeSection ?? undefined;
      el.readOnly = readOnly;
      el.grid = grid;
      el.gridSize = gridSize;
      el.gridStyle = gridStyle;
      el.gridHighlight = gridHighlight;
      el.ariaLabel = ariaLabel;
    }

    return () => {
      isMountedRef.current = false;

      // Tratamento estrito de unmount / Strict Mode:
      // No unmount definitivo do modo interno, destrói o canvas criado internamente.
      // Em simulação de Strict Mode (unmount transitório seguido de mount síncrono),
      // o timer é cancelado no próximo mount sem destruir a instância.
      if (!externalSection && internalSectionRef.current) {
        cleanupTimerRef.current = setTimeout(() => {
          if (!isMountedRef.current && internalSectionRef.current) {
            internalSectionRef.current.destroy();
            internalSectionRef.current = null;
          }
        }, 0);
      }
    };
  }, [
    activeSection,
    readOnly,
    grid,
    gridSize,
    gridStyle,
    gridHighlight,
    ariaLabel,
    externalSection,
  ]);

  return React.createElement('canvas-surface', {
    ref: customElementRef,
    class: className,
    style: {
      display: 'block',
      width: '100%',
      height: '100%',
      ...style,
    },
    'aria-label': ariaLabel,
  });
};

export const CanvasSurface = forwardRef(CanvasSurfaceComponent);
