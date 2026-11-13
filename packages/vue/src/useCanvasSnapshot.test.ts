// @vitest-environment jsdom
import { effectScope, nextTick, ref } from 'vue';
import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { useCanvasSnapshot } from './useCanvasSnapshot.js';

describe('useCanvasSnapshot (Vue Composable)', () => {
  it('retorna null se nenhum canvas for fornecido', () => {
    const scope = effectScope();
    let snapshot: ReturnType<typeof useCanvasSnapshot> | undefined;

    scope.run(() => {
      snapshot = useCanvasSnapshot(null);
    });

    expect(snapshot?.value).toBeNull();
    scope.stop();
  });

  it('retorna snapshot do canvas e atualiza reativamente com comandos', () => {
    const section = createCanvasSection();
    const scope = effectScope();
    let snapshot: ReturnType<typeof useCanvasSnapshot> | undefined;

    scope.run(() => {
      snapshot = useCanvasSnapshot(section);
    });

    expect(snapshot?.value).not.toBeNull();
    expect(snapshot?.value?.revision).toBe(0);

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-vue-1',
        type: 'rectangle',
        x: 10,
        y: 10,
        width: 100,
        height: 100,
        rotation: 0,
      },
    });

    expect(snapshot?.value?.revision).toBe(1);
    expect(snapshot?.value?.document.nodes['rect-vue-1']).toBeDefined();

    scope.stop();

    // Após descarte do escopo, novas mutações não devem atualizar o ref
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-vue-2',
        type: 'rectangle',
        x: 20,
        y: 20,
        width: 50,
        height: 50,
        rotation: 0,
      },
    });

    expect(snapshot?.value?.revision).toBe(1);
    expect(snapshot?.value?.document.nodes['rect-vue-2']).toBeUndefined();
  });

  it('suporta Ref reativo de canvas alternando instâncias dinamicamente', async () => {
    const section1 = createCanvasSection();
    const section2 = createCanvasSection();
    const sectionRef = ref(section1);

    const scope = effectScope();
    let snapshot: ReturnType<typeof useCanvasSnapshot> | undefined;

    scope.run(() => {
      snapshot = useCanvasSnapshot(sectionRef);
    });

    expect(snapshot?.value).not.toBeNull();
    expect(snapshot?.value?.revision).toBe(0);

    section1.dispatch({
      type: 'shape.create',
      shape: {
        id: 's1',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
      },
    });
    expect(snapshot?.value?.revision).toBe(1);

    // Alterna para section2
    sectionRef.value = section2;
    await nextTick();

    expect(snapshot?.value?.revision).toBe(0);
    expect(snapshot?.value?.document.nodes['s1']).toBeUndefined();

    // section1 não deve mais atualizar o snapshot
    section1.dispatch({
      type: 'shape.create',
      shape: {
        id: 's1-b',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
      },
    });
    expect(snapshot?.value?.revision).toBe(0);

    // section2 deve atualizar o snapshot
    section2.dispatch({
      type: 'shape.create',
      shape: {
        id: 's2',
        type: 'rectangle',
        x: 5,
        y: 5,
        width: 20,
        height: 20,
        rotation: 0,
      },
    });
    expect(snapshot?.value?.revision).toBe(1);

    // Alterna para null
    // @ts-expect-error teste com valor null
    sectionRef.value = null;
    await nextTick();
    expect(snapshot?.value).toBeNull();

    scope.stop();
  });
});
