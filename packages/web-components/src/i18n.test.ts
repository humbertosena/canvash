import { describe, it, expect, beforeEach } from 'vitest';
import {
  defaultI18nPtBR,
  defaultI18nEnUS,
  getGlobalI18n,
  setGlobalI18n,
  resetGlobalI18n,
  mergeI18n,
} from './i18n.js';

describe('i18n module', () => {
  beforeEach(() => {
    resetGlobalI18n();
  });

  it('possui traduções completas para pt-BR e en-US', () => {
    expect(defaultI18nPtBR.toolbar.select).toBe('Selecionar (V)');
    expect(defaultI18nEnUS.toolbar.select).toBe('Select (V)');

    expect(defaultI18nPtBR.layers.title).toBe('Camadas');
    expect(defaultI18nEnUS.layers.title).toBe('Layers');

    expect(defaultI18nPtBR.properties.title).toBe('Propriedades');
    expect(defaultI18nEnUS.properties.title).toBe('Properties');

    expect(defaultI18nPtBR.canvas.announceTool('rect')).toBe('Ferramenta rect ativada');
    expect(defaultI18nEnUS.canvas.announceTool('rect')).toBe('Tool rect activated');
  });

  it('tem o nome do botão Board e o título numerado do board em pt-BR e en-US', () => {
    expect(defaultI18nPtBR.toolbar.board).toBe('Board');
    expect(defaultI18nEnUS.toolbar.board).toBe('Board');
    expect(defaultI18nPtBR.canvas.boardDefaultTitle(1)).toBe('Board 1');
    expect(defaultI18nPtBR.canvas.boardDefaultTitle(12)).toBe('Board 12');
    expect(defaultI18nEnUS.canvas.boardDefaultTitle(3)).toBe('Board 3');
  });

  it('tem o rótulo do editor de título e o anúncio da seleção do board em pt-BR e en-US', () => {
    expect(defaultI18nPtBR.canvas.boardTitleLabel).toBe('Título do board');
    expect(defaultI18nEnUS.canvas.boardTitleLabel).toBe('Board title');
    expect(defaultI18nPtBR.canvas.announceBoardSelection('Fluxo')).toBe('Board Fluxo selecionado');
    expect(defaultI18nEnUS.canvas.announceBoardSelection('Fluxo')).toBe('Board Fluxo selected');
  });

  it('permite sobrescrever mensagens globais e restaurar para padrão', () => {
    expect(getGlobalI18n().toolbar.select).toBe('Selecionar (V)');

    setGlobalI18n({
      toolbar: { select: 'Ponteiro' },
    });

    expect(getGlobalI18n().toolbar.select).toBe('Ponteiro');
    expect(getGlobalI18n().toolbar.rect).toBe('Retângulo (R)');

    resetGlobalI18n();
    expect(getGlobalI18n().toolbar.select).toBe('Selecionar (V)');
  });

  it('mergeI18n combina mensagens personalizadas preservando valores base', () => {
    const merged = mergeI18n(defaultI18nPtBR, {
      layers: { title: 'Árvore de Camadas' },
      properties: { delete: 'Remover' },
    });

    expect(merged.layers.title).toBe('Árvore de Camadas');
    expect(merged.layers.empty).toBe('Vazia');
    expect(merged.properties.delete).toBe('Remover');
    expect(merged.properties.mixed).toBe('Misto');
    expect(merged.toolbar.select).toBe('Selecionar (V)');
  });

  it('retorna cópia do base quando override é indefinido', () => {
    const merged = mergeI18n(defaultI18nPtBR, undefined);
    expect(merged).toEqual(defaultI18nPtBR);
  });
  it('os anúncios do canvas existem nos dois idiomas', () => {
    expect(defaultI18nPtBR.canvas.announceNoSelection).toBe('Nenhum objeto selecionado');
    expect(defaultI18nPtBR.canvas.announceSingleSelection('rect', 'a1')).toBe(
      'Objeto rect selecionado (a1)',
    );
    expect(defaultI18nPtBR.canvas.announceMultiSelection(3)).toBe('3 objetos selecionados');
    expect(defaultI18nPtBR.canvas.announceZoom(150)).toBe('Zoom alterado para 150%');

    expect(defaultI18nEnUS.canvas.announceNoSelection).toBe('No object selected');
    expect(defaultI18nEnUS.canvas.announceSingleSelection('rect', 'a1')).toBe(
      'Object rect selected (a1)',
    );
    expect(defaultI18nEnUS.canvas.announceMultiSelection(3)).toBe('3 objects selected');
    expect(defaultI18nEnUS.canvas.announceZoom(150)).toBe('Zoom changed to 150%');
  });

  it('as predefinições de polígono têm rótulo nos dois idiomas', () => {
    expect(defaultI18nPtBR.toolbar).toMatchObject({
      pentagon: 'Pentágono',
      hexagon: 'Hexágono',
      octagon: 'Octógono',
    });
    expect(defaultI18nEnUS.toolbar).toMatchObject({
      pentagon: 'Pentagon',
      hexagon: 'Hexagon',
      octagon: 'Octagon',
    });
  });

  it('o mini-menu da seleção tem Agrupar e Desagrupar em pt-BR e en-US', () => {
    expect(defaultI18nPtBR.selectionMenu.group).toBe('Agrupar');
    expect(defaultI18nPtBR.selectionMenu.ungroup).toBe('Desagrupar');
    expect(defaultI18nEnUS.selectionMenu.group).toBe('Group');
    expect(defaultI18nEnUS.selectionMenu.ungroup).toBe('Ungroup');
    expect(
      mergeI18n(defaultI18nPtBR, { selectionMenu: { group: 'Juntar' } }).selectionMenu,
    ).toMatchObject({
      group: 'Juntar',
      ungroup: 'Desagrupar',
    });
  });

  it('o diálogo de atalhos tem "Editar o texto da forma" em pt-BR e en-US', () => {
    expect(defaultI18nPtBR.controls.helpEditText).toBe('Editar o texto da forma');
    expect(defaultI18nEnUS.controls.helpEditText).toBe('Edit shape text');
  });
});
