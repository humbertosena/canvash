# @canvash/persistence

Salvar e reabrir documentos do Canvash, sem backend.

## Recursos

- Serialização determinística e canônica (chaves em ordem alfabética, recursivamente).
- Leitura segura: limite de 20 MiB, validação profunda e proteção contra prototype pollution.
- Salvamento automático com debounce, escritas serializadas e controle otimista de concorrência.
- Adaptadores de armazenamento: IndexedDB e memória.

Seleção, viewport, histórico e presença nunca entram no documento serializado.

## Instalação

Os pacotes `@canvash/*` ainda não estão no npmjs. Aponte o escopo para o seu registro (por exemplo, um Verdaccio local) no `.npmrc` do projeto:

```
@canvash:registry=http://localhost:4873/
```

```
pnpm add @canvash/core @canvash/persistence
```

Sem peer dependencies.

## Exemplo

```ts
import { createCanvasSection } from '@canvash/core';
import {
  MemoryStorageAdapter,
  createAutosaveManager,
  parseDocument,
  serializeDocument,
} from '@canvash/persistence';

const section = createCanvasSection();

const json = serializeDocument(section.getSnapshot().document);
if (!json.ok) throw new Error(json.error.message);

const parsed = parseDocument(JSON.parse(json.value));
if (!parsed.ok) throw new Error(parsed.error.message);
section.replaceDocument(parsed.value);

const autosave = createAutosaveManager(section, new MemoryStorageAdapter(), { key: 'meu-desenho' });
// ... edições são salvas depois de 500 ms sem novas mudanças ...
await autosave.flush();
autosave.destroy();
```

Para guardar no navegador, troque `MemoryStorageAdapter` por `IndexedDbStorageAdapter`.

## Depende de

- `@canvash/core`

## Licença

MIT.
