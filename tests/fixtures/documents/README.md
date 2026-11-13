# Fixtures de documentos

Documentos do schema 1 usados pelos testes de carga do core (`packages/core/src/validate.test.ts`).

- `valid/`: documentos que `validateDocument` aceita. Cada arquivo tem `description` e `document`. `composite-shapes.json` cobre cruz, chevron e chaves; `ink-strokes.json`, os elementos de traço à mão livre; `shape-labels.json`, o texto dentro das nove formas fechadas (`label`); `boards.json`, boards com filhos, grupo dentro de board e seta entre filhos.
- `invalid/`: documentos que ele recusa. Cada arquivo tem `description`, `document` e `expected`, com o `code` do erro e, conforme o código, os `issues` (caminho e regra) ou os `details` esperados; `shape-label-invalid.json` recusa um `verticalAlign` fora da lista no `label` de uma forma; `nested-board.json` recusa um board dentro de outro, e `board-in-group.json`, um board entre os membros de um grupo.

Casos que o JSON não expressa (número não finito, objeto que contém a si mesmo, limite de nós) ficam montados no próprio teste.
