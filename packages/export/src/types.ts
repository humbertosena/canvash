import type { CanvasSectionApi, CanvasDocument, Bounds } from '@canvash/core';

export type ExportSource = CanvasSectionApi | CanvasDocument;

/** Exporta só um board: o retângulo dele, com fundo, borda e filhos, sem o título. */
export interface BoardExportScope {
  readonly board: string;
}

export type ExportScope = 'document' | 'selection' | Bounds | BoardExportScope;

export interface CommonExportOptions {
  /**
   * Escopo da exportação:
   * - 'document': todo o conteúdo visível do documento (padrão)
   * - 'selection': apenas nós atualmente selecionados (requer canvas ou lista de selecionados)
   * - Bounds: retângulo explícito { x, y, width, height }
   * - { board: id }: só aquele board, recortado no retângulo dele e sem o título
   */
  readonly scope?: ExportScope;
  /** Margem externa adicionada em torno dos bounds exportados (padrão: 0). */
  readonly padding?: number;
  /** Cor de fundo ('transparent' ou código CSS como '#ffffff', padrão: 'transparent'). */
  readonly background?: string | 'transparent';
}

export type ExportSvgOptions = CommonExportOptions;

export interface ExportPngOptions extends CommonExportOptions {
  /** Fator multiplicador de escala e resolução (padrão: 1). */
  readonly scale?: number;
  /** Limite máximo de pixels permitidos (padrão: 16.000.000) (IO-07). */
  readonly maxPixels?: number;
  /** Tempo máximo de espera por fontes declaradas em milissegundos (padrão: 2000). */
  readonly fontTimeoutMs?: number;
}

/** As opções de `prepareExportContext`: tudo menos o escopo de board (ver `prepareBoardExportContext`). */
export type PrepareExportOptions = Omit<CommonExportOptions, 'scope'> & {
  readonly scope?: Exclude<ExportScope, BoardExportScope>;
};
