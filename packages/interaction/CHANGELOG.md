# Changelog

## 0.1.0-alpha.1 — 2026-11-15

- O Espaço digitado num campo de texto dentro de um Shadow DOM, como o campo de título da casca `<canvas-section>`, volta a chegar ao campo. O `PointerAdapter` reconhecia o campo editável por `event.target`, que na janela é o host do Shadow DOM: o Espaço levava `preventDefault()` e virava pan, e o título perdia os espaços. Agora a origem do evento vem de `composedPath()[0]`.
- Soltar o Espaço com o foco num campo de texto ou num botão encerra o pan. Antes, se o foco mudava com o Espaço apertado (um Tab, um clique no título), o pan ficava preso e todo arraste com o botão esquerdo virava pan.

## 0.1.0-alpha — 2026-11-13

Primeira versão alpha de @canvash/interaction.

- `attachInteractions`: ponteiro, toque, roda do mouse e teclado sobre um elemento do DOM, traduzidos em comandos do core.
- Seleção, mover, redimensionar, desenhar formas, caneta, borracha, texto e pan/zoom por gesto.
- Alinhamento com guias e com a grade.
