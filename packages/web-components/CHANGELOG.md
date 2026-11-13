# Changelog

## 0.1.0-alpha — 2026-11-13

Primeira versão alpha de @canvash/web-components.

- Elementos `canvas-section`, `canvas-surface`, `canvas-toolbar`, `canvas-layers`, `canvas-properties`, `canvas-selection-menu` e `canvas-controls` (Lit).
- `defineCanvasElements` para registrar as tags, com prefixo opcional.
- Temas por variáveis CSS `--canvash-*` e `::part()`, e textos em pt-BR e en-US.
- O `dist` não emite campos de classe nativos ao lado de `static properties`, para os acessores reativos do Lit funcionarem também com o Lit de desenvolvimento.
