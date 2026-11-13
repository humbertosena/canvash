import { useCallback, useSyncExternalStore } from 'react';
import type { CanvasSectionApi, CanvasSnapshot } from '@canvash/core';

/**
 * Hook React que assina eventos de um canvas e devolve um snapshot imutável e estável.
 *
 * Utiliza `useSyncExternalStore` garantindo sincronização sem tearing, compatibilidade
 * com SSR e prevenção de renderizações desnecessárias quando o documento não é alterado.
 */
export function useCanvasSnapshot(
  section: CanvasSectionApi | null | undefined,
): CanvasSnapshot | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!section) return () => {};
      return section.subscribe(() => {
        onStoreChange();
      });
    },
    [section],
  );

  const getSnapshot = useCallback(() => {
    return section ? section.getSnapshot() : null;
  }, [section]);

  const getServerSnapshot = useCallback(() => {
    return section ? section.getSnapshot() : null;
  }, [section]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
