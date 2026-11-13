import { boundsIntersect, type Bounds } from './geometry/bounds.js';

/**
 * Índice espacial de caixas por ID. É estrutura derivada e interna: quem consulta recebe IDs
 * candidatos, sem ordem, e nada daqui aparece na API pública. A implementação pode ser trocada
 * sem que as consultas mudem.
 */
export interface SpatialIndex {
  /** Insere o item ou troca a caixa dele. */
  set(id: string, bounds: Bounds): void;
  delete(id: string): void;
  /** IDs dos itens cuja caixa toca `bounds`, sem repetição e sem ordem definida. */
  query(bounds: Bounds): string[];
  clear(): void;
}

// Lado de uma célula, em unidades do documento.
const CELL_SIZE = 256;
// Item que ocuparia mais células que isto fica em uma lista à parte, conferida em toda consulta.
const MAX_CELLS_PER_ITEM = 64;
// Consulta que cobriria mais células que isto varre todos os itens em vez das células.
const MAX_CELLS_PER_QUERY = 4096;
// As coordenadas de célula ficam em [-CELL_RANGE, CELL_RANGE): o que passa disso cai na célula
// da borda. A caixa exata é conferida depois, então o resultado continua correto.
const CELL_RANGE = 2 ** 20;

interface Entry {
  readonly bounds: Bounds;
  /** Chaves das células ocupadas; `undefined` para o item que está na lista à parte. */
  readonly cells: readonly number[] | undefined;
}

function cellOf(coordinate: number): number {
  return Math.min(CELL_RANGE - 1, Math.max(-CELL_RANGE, Math.floor(coordinate / CELL_SIZE)));
}

/** Células cobertas por uma caixa, ou `undefined` quando passam de `limit`. */
function cellsOf(bounds: Bounds, limit: number): number[] | undefined {
  const minX = cellOf(bounds.x);
  const maxX = cellOf(bounds.x + bounds.width);
  const minY = cellOf(bounds.y);
  const maxY = cellOf(bounds.y + bounds.height);
  if ((maxX - minX + 1) * (maxY - minY + 1) > limit) return undefined;
  const keys: number[] = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      // Duas coordenadas de 21 bits em um número: cabe com folga nos 53 bits inteiros.
      keys.push((x + CELL_RANGE) * 2 * CELL_RANGE + (y + CELL_RANGE));
    }
  }
  return keys;
}

/** Cria um índice em grade uniforme, com tabela de hash por célula. */
export function createGridIndex(): SpatialIndex {
  const entries = new Map<string, Entry>();
  const grid = new Map<number, Set<string>>();
  const oversized = new Set<string>();

  const remove = (id: string): void => {
    const entry = entries.get(id);
    if (entry === undefined) return;
    entries.delete(id);
    oversized.delete(id);
    for (const key of entry.cells ?? []) {
      const cell = grid.get(key);
      cell?.delete(id);
      if (cell?.size === 0) grid.delete(key);
    }
  };

  return {
    set(id, bounds) {
      remove(id);
      const cells = cellsOf(bounds, MAX_CELLS_PER_ITEM);
      entries.set(id, { bounds, cells });
      if (cells === undefined) {
        oversized.add(id);
        return;
      }
      for (const key of cells) {
        const cell = grid.get(key);
        if (cell === undefined) grid.set(key, new Set([id]));
        else cell.add(id);
      }
    },
    delete: remove,
    query(bounds) {
      const cells = cellsOf(bounds, MAX_CELLS_PER_QUERY);
      const candidates =
        cells === undefined
          ? entries.keys()
          : new Set([...oversized, ...cells.flatMap((key) => [...(grid.get(key) ?? [])])]);
      const found: string[] = [];
      for (const id of candidates) {
        const entry = entries.get(id);
        if (entry !== undefined && boundsIntersect(entry.bounds, bounds)) found.push(id);
      }
      return found;
    },
    clear() {
      entries.clear();
      grid.clear();
      oversized.clear();
    },
  };
}
