import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { afterEach, vi } from 'vitest';
import { attachInteractions, type InteractionHandle } from './index.js';

describe('PointerAdapter e attachInteractions no navegador real (Chromium)', () => {
  let container: HTMLElement;
  let section: CanvasSectionApi;
  let handle: InteractionHandle;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '400px';
    container.style.height = '300px';
    container.style.position = 'relative';
    container.style.cursor = 'auto';
    container.style.touchAction = 'pan-x';
    document.body.appendChild(container);

    section = createCanvasSection();
    section.setViewport({ x: 50, y: 50, zoom: 1 });
    handle = attachInteractions({ section, element: container });
  });

  // Cada teste liga um adaptador à janela: sem desligar, os dos testes anteriores respondem junto.
  afterEach(() => {
    handle.destroy();
    container.remove();
  });

  it('aplica touch-action: none na superfície e devolve handle com getState', () => {
    expect(container.style.touchAction).toBe('none');
    expect(handle.getState()).toBe('idle');
  });

  it('restaura touch-action e cursor originais no destroy', () => {
    handle.destroy();
    expect(container.style.touchAction).toBe('pan-x');
    expect(container.style.cursor).toBe('auto');
  });

  it('chamar destroy mais de uma vez é idempotente', () => {
    handle.destroy();
    expect(() => handle.destroy()).not.toThrow();
  });

  it('pan com ferramenta hand move o viewport e altera cursores', () => {
    section.setTool('hand');

    const downEvent = new PointerEvent('pointerdown', {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
      bubbles: true,
    });
    container.dispatchEvent(downEvent);

    expect(handle.getState()).toBe('panning');
    expect(container.style.cursor).toBe('grabbing');

    const moveEvent = new PointerEvent('pointermove', {
      pointerId: 1,
      pointerType: 'mouse',
      buttons: 1,
      clientX: 140,
      clientY: 130,
      bubbles: true,
    });
    container.dispatchEvent(moveEvent);

    expect(section.getSnapshot().session.viewport).toEqual({ x: 90, y: 80, zoom: 1 });

    const upEvent = new PointerEvent('pointerup', {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 140,
      clientY: 130,
      bubbles: true,
    });
    container.dispatchEvent(upEvent);

    expect(handle.getState()).toBe('idle');
    expect(container.style.cursor).toBe('grab');
    expect(section.getSnapshot().session.viewport).toEqual({ x: 90, y: 80, zoom: 1 });
  });

  it('botão do meio (button=1) previne contexto e realiza pan com ferramenta select', () => {
    section.setTool('select');

    const downEvent = new PointerEvent('pointerdown', {
      pointerId: 2,
      pointerType: 'mouse',
      button: 1,
      buttons: 4,
      clientX: 100,
      clientY: 100,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(downEvent);

    expect(downEvent.defaultPrevented).toBe(true);
    expect(handle.getState()).toBe('panning');

    const contextEvent = new MouseEvent('contextmenu', {
      button: 1,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(contextEvent);
    expect(contextEvent.defaultPrevented).toBe(true);

    const moveEvent = new PointerEvent('pointermove', {
      pointerId: 2,
      buttons: 4,
      clientX: 80,
      clientY: 60,
      bubbles: true,
    });
    container.dispatchEvent(moveEvent);

    expect(section.getSnapshot().session.viewport).toEqual({ x: 30, y: 10, zoom: 1 });

    const upEvent = new PointerEvent('pointerup', {
      pointerId: 2,
      button: 1,
      clientX: 80,
      clientY: 60,
      bubbles: true,
    });
    container.dispatchEvent(upEvent);

    expect(handle.getState()).toBe('idle');
  });

  it('Space altera cursor para grab e permite arrastar para pan', () => {
    section.setTool('select');

    const keyDownSpace = new KeyboardEvent('keydown', {
      code: 'Space',
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(keyDownSpace);

    expect(keyDownSpace.defaultPrevented).toBe(true);
    expect(container.style.cursor).toBe('grab');

    const downEvent = new PointerEvent('pointerdown', {
      pointerId: 3,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 50,
      clientY: 50,
      bubbles: true,
    });
    container.dispatchEvent(downEvent);

    expect(handle.getState()).toBe('panning');
    expect(container.style.cursor).toBe('grabbing');

    const moveEvent = new PointerEvent('pointermove', {
      pointerId: 3,
      buttons: 1,
      clientX: 100,
      clientY: 70,
      bubbles: true,
    });
    container.dispatchEvent(moveEvent);

    expect(section.getSnapshot().session.viewport).toEqual({ x: 100, y: 70, zoom: 1 });

    const upEvent = new PointerEvent('pointerup', {
      pointerId: 3,
      button: 0,
      clientX: 100,
      clientY: 70,
      bubbles: true,
    });
    container.dispatchEvent(upEvent);

    expect(handle.getState()).toBe('idle');
    expect(container.style.cursor).toBe('grab');

    const keyUpSpace = new KeyboardEvent('keyup', {
      code: 'Space',
      key: ' ',
      bubbles: true,
    });
    window.dispatchEvent(keyUpSpace);

    expect(container.style.cursor).toBe('default');
  });

  it('tecla Space em campo editável não afeta o cursor nem as interações', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);

    const keyEvent = new KeyboardEvent('keydown', {
      code: 'Space',
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(keyEvent);

    expect(keyEvent.defaultPrevented).toBe(false);
    expect(container.style.cursor).toBe('auto');

    const keyUpEvent = new KeyboardEvent('keyup', {
      code: 'Space',
      key: ' ',
      bubbles: true,
    });
    input.dispatchEvent(keyUpEvent);

    input.remove();
  });

  /** Um clique em qualquer lugar da página, como o de quem acabou de usar o mouse. */
  function clickSomewhere(): void {
    window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, bubbles: true }));
  }

  function pressSpace(target: EventTarget): KeyboardEvent {
    const keyEvent = new KeyboardEvent('keydown', {
      code: 'Space',
      key: ' ',
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    target.dispatchEvent(keyEvent);
    return keyEvent;
  }

  function releaseSpace(target: EventTarget): void {
    target.dispatchEvent(
      new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true, composed: true }),
    );
  }

  it('tecla Space em botão ou item de menu focado pelo teclado ativa o controle e não prende o pan', () => {
    const button = document.createElement('button');
    const item = document.createElement('div');
    item.setAttribute('role', 'menuitemradio');
    document.body.append(button, item);

    for (const control of [button, item]) {
      const keyEvent = pressSpace(control);
      expect(keyEvent.defaultPrevented).toBe(false);
      expect(container.style.cursor).toBe('auto');
      releaseSpace(control);
    }

    // Outras teclas no botão seguem o fluxo normal.
    const letter = new KeyboardEvent('keydown', { code: 'KeyA', key: 'a', bubbles: true });
    button.dispatchEvent(letter);
    expect(letter.defaultPrevented).toBe(false);

    button.remove();
    item.remove();
  });

  it('botão focado pelo mouse deixa o Space para o pan, até uma tecla devolver o teclado', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);

    clickSomewhere();
    const panning = pressSpace(button);
    expect(panning.defaultPrevented).toBe(true);
    expect(container.style.cursor).toBe('grab');
    releaseSpace(button);
    expect(container.style.cursor).toBe('default');

    // Um Tab devolve o foco ao teclado: o Space volta a ser do botão.
    button.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', bubbles: true }));
    expect(pressSpace(button).defaultPrevented).toBe(false);
    releaseSpace(button);

    button.remove();
  });

  it('tecla Space num botão dentro de um Shadow DOM focado pelo teclado fica com o botão', () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    root.appendChild(button);
    document.body.appendChild(host);

    expect(pressSpace(button).defaultPrevented).toBe(false);
    releaseSpace(button);

    // Fora de um controle, o Space continua preso ao pan.
    expect(pressSpace(host).defaultPrevented).toBe(true);
    releaseSpace(host);

    host.remove();
  });

  it('depois do destroy, o clique na página não é mais observado', () => {
    handle.destroy();
    const removed = vi.spyOn(window, 'removeEventListener');
    clickSomewhere();
    expect(removed).not.toHaveBeenCalled();
    removed.mockRestore();
  });

  it('lostpointercapture e pointercancel cancelam o gesto e restauram o viewport', () => {
    section.setTool('hand');

    container.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 4,
        button: 0,
        buttons: 1,
        clientX: 10,
        clientY: 10,
        bubbles: true,
      }),
    );

    container.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 4,
        buttons: 1,
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );

    expect(section.getSnapshot().session.viewport).toEqual({ x: 90, y: 90, zoom: 1 });

    container.dispatchEvent(
      new PointerEvent('lostpointercapture', {
        pointerId: 4,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('idle');
    expect(section.getSnapshot().session.viewport).toEqual({ x: 50, y: 50, zoom: 1 });
  });

  it('window blur cancela gesto em andamento', () => {
    section.setTool('hand');

    container.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 5,
        button: 0,
        buttons: 1,
        clientX: 20,
        clientY: 20,
        bubbles: true,
      }),
    );

    container.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 5,
        buttons: 1,
        clientX: 80,
        clientY: 80,
        bubbles: true,
      }),
    );

    expect(section.getSnapshot().session.viewport).toEqual({ x: 110, y: 110, zoom: 1 });

    window.dispatchEvent(new Event('blur'));

    expect(handle.getState()).toBe('idle');
    expect(section.getSnapshot().session.viewport).toEqual({ x: 50, y: 50, zoom: 1 });
  });

  it('handle.cancel() cancela gesto explicitamente', () => {
    section.setTool('hand');

    container.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 6,
        button: 0,
        buttons: 1,
        clientX: 20,
        clientY: 20,
        bubbles: true,
      }),
    );

    container.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 6,
        buttons: 1,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );

    handle.cancel();

    expect(handle.getState()).toBe('idle');
    expect(section.getSnapshot().session.viewport).toEqual({ x: 50, y: 50, zoom: 1 });
  });

  it('pointercancel cancela gesto em andamento', () => {
    section.setTool('hand');

    container.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 7,
        button: 0,
        buttons: 1,
        clientX: 20,
        clientY: 20,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('panning');

    container.dispatchEvent(
      new PointerEvent('pointercancel', {
        pointerId: 7,
        bubbles: true,
      }),
    );

    expect(handle.getState()).toBe('idle');
  });

  it('contextmenu é prevenido durante panning mesmo com botão primário', () => {
    section.setTool('hand');

    container.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 8,
        button: 0,
        buttons: 1,
        clientX: 20,
        clientY: 20,
        bubbles: true,
      }),
    );

    const contextEvent = new MouseEvent('contextmenu', {
      button: 0,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(contextEvent);

    expect(contextEvent.defaultPrevented).toBe(true);
  });

  it('campos textarea, select e contenteditable ignoram atalhos', () => {
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    const editableDiv = document.createElement('div');
    editableDiv.contentEditable = 'true';

    document.body.appendChild(textarea);
    document.body.appendChild(select);
    document.body.appendChild(editableDiv);

    for (const el of [textarea, select, editableDiv]) {
      const down = new KeyboardEvent('keydown', {
        code: 'Space',
        key: ' ',
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(false);

      const up = new KeyboardEvent('keyup', {
        code: 'Space',
        key: ' ',
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(up);
    }

    textarea.remove();
    select.remove();
    editableDiv.remove();
  });

  it('mousedown e auxclick com botão do meio (wheel) previnem default', () => {
    const md = new MouseEvent('mousedown', {
      button: 1,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(md);
    expect(md.defaultPrevented).toBe(true);

    const aux = new MouseEvent('auxclick', {
      button: 1,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(aux);
    expect(aux.defaultPrevented).toBe(true);
  });

  it('window blur cancela gesto em andamento', () => {
    section.setTool('hand');
    container.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 99,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );
    expect(handle.getState()).toBe('panning');

    window.dispatchEvent(new Event('blur'));
    expect(handle.getState()).toBe('idle');
  });
});
