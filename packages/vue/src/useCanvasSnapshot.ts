import { isRef, onScopeDispose, shallowReadonly, shallowRef, watch, type Ref } from 'vue';
import type { CanvasSectionApi, CanvasSnapshot } from '@canvash/core';

/**
 * Composable Vue 3 que assina eventos de um canvas e expõe um snapshot imutável.
 *
 * Utiliza `shallowRef` para garantir que as estruturas profundas do documento
 * não sejam convertidas em proxies reativos mutáveis (ADAPTER-03).
 */
export function useCanvasSnapshot(
  sectionSource: CanvasSectionApi | Ref<CanvasSectionApi | null | undefined> | null | undefined,
): Readonly<Ref<CanvasSnapshot | null>> {
  const snapshotRef = shallowRef<CanvasSnapshot | null>(null);
  let unsubscribe: (() => void) | undefined;

  const updateSubscription = (b: CanvasSectionApi | null | undefined) => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = undefined;
    }
    if (b) {
      snapshotRef.value = b.getSnapshot();
      unsubscribe = b.subscribe(() => {
        snapshotRef.value = b.getSnapshot();
      });
    } else {
      snapshotRef.value = null;
    }
  };

  if (isRef(sectionSource)) {
    watch(
      sectionSource,
      (newSection) => {
        updateSubscription(newSection);
      },
      { immediate: true },
    );
  } else {
    updateSubscription(sectionSource);
  }

  onScopeDispose(() => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = undefined;
    }
  });

  return shallowReadonly(snapshotRef);
}
