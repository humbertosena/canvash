import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = resolve(import.meta.dirname, '..', '..');

describe('SSR Seguro (ADAPTER-04)', () => {
  describe('React SSR (@canvash/react/ssr)', () => {
    it('renderiza CanvasSurface e painéis via renderToString em Node puro (ESM)', () => {
      const script = `
        import React from 'react';
        import { renderToString } from 'react-dom/server';
        import {
          CanvasSurface,
          CanvasToolbar,
          CanvasLayers,
          CanvasProperties,
          useCanvasSnapshot,
        } from './packages/react/dist/ssr.mjs';

        // Garante que o ambiente não possui DOM global
        if (typeof window !== 'undefined' || typeof customElements !== 'undefined') {
          throw new Error('Ambiente não deve conter globais de DOM');
        }

        const html = renderToString(
          React.createElement('div', null,
            React.createElement(CanvasToolbar),
            React.createElement(CanvasSurface, { ariaLabel: 'Test Canvas SSR' }),
            React.createElement(CanvasLayers),
            React.createElement(CanvasProperties),
          )
        );

        if (!html.includes('data-canvash-ssr="true"')) {
          throw new Error('HTML não contém atributo data-canvash-ssr');
        }
        if (!html.includes('aria-label="Test Canvas SSR"')) {
          throw new Error('HTML não contém aria-label');
        }
        if (!html.includes('canvash-placeholder')) {
          throw new Error('HTML não contém classe canvash-placeholder');
        }

        const snap = useCanvasSnapshot();
        if (snap !== null) {
          throw new Error('useCanvasSnapshot SSR sem section deve ser null');
        }

        console.log('REACT_SSR_ESM_OK');
      `;

      const output = execFileSync('node', ['--input-type=module', '-e', script], {
        cwd: rootDir,
        encoding: 'utf8',
      });

      expect(output).toContain('REACT_SSR_ESM_OK');
    });

    it('renderiza CanvasSurface via renderToString em Node puro (CJS)', () => {
      const script = `
        const React = require('react');
        const { renderToString } = require('react-dom/server');
        const {
          CanvasSurface,
          CanvasToolbar,
          CanvasLayers,
          CanvasProperties,
        } = require('./packages/react/dist/ssr.cjs');

        if (typeof window !== 'undefined' || typeof customElements !== 'undefined') {
          throw new Error('Ambiente não deve conter globais de DOM');
        }

        const html = renderToString(
          React.createElement('div', null,
            React.createElement(CanvasToolbar),
            React.createElement(CanvasSurface, { ariaLabel: 'Test CJS Canvas' }),
            React.createElement(CanvasLayers),
            React.createElement(CanvasProperties),
          )
        );

        if (!html.includes('data-canvash-ssr="true"')) {
          throw new Error('HTML CJS não contém atributo data-canvash-ssr');
        }

        console.log('REACT_SSR_CJS_OK');
      `;

      const output = execFileSync('node', ['-e', script], {
        cwd: rootDir,
        encoding: 'utf8',
      });

      expect(output).toContain('REACT_SSR_CJS_OK');
    });
  });

  describe('Vue SSR (@canvash/vue/ssr)', () => {
    it('renderiza CanvasSurface e painéis via renderToString em Node puro (ESM)', () => {
      const script = `
        import { h, createSSRApp } from 'vue';
        import { renderToString } from 'vue/server-renderer';
        import {
          CanvasSurface,
          CanvasToolbar,
          CanvasLayers,
          CanvasProperties,
          useCanvasSnapshot,
        } from './packages/vue/dist/ssr.mjs';

        if (typeof window !== 'undefined' || typeof customElements !== 'undefined') {
          throw new Error('Ambiente não deve conter globais de DOM');
        }

        const app = createSSRApp({
          render: () =>
            h('div', [
              h(CanvasToolbar),
              h(CanvasSurface, { ariaLabel: 'Vue SSR Canvas' }),
              h(CanvasLayers),
              h(CanvasProperties),
            ]),
        });

        const html = await renderToString(app);

        if (!html.includes('data-canvash-ssr="true"')) {
          throw new Error('HTML Vue não contém atributo data-canvash-ssr');
        }
        if (!html.includes('aria-label="Vue SSR Canvas"')) {
          throw new Error('HTML Vue não contém aria-label');
        }
        if (!html.includes('canvash-placeholder')) {
          throw new Error('HTML Vue não contém classe canvash-placeholder');
        }

        const snap = useCanvasSnapshot();
        if (snap.value !== null) {
          throw new Error('useCanvasSnapshot SSR sem section deve ser null');
        }

        console.log('VUE_SSR_ESM_OK');
      `;

      const output = execFileSync('node', ['--input-type=module', '-e', script], {
        cwd: rootDir,
        encoding: 'utf8',
      });

      expect(output).toContain('VUE_SSR_ESM_OK');
    });

    it('renderiza CanvasSurface via renderToString em Node puro (CJS)', () => {
      const script = `
        const { h, createSSRApp } = require('vue');
        const { renderToString } = require('vue/server-renderer');
        const {
          CanvasSurface,
          CanvasToolbar,
          CanvasLayers,
          CanvasProperties,
        } = require('./packages/vue/dist/ssr.cjs');

        if (typeof window !== 'undefined' || typeof customElements !== 'undefined') {
          throw new Error('Ambiente não deve conter globais de DOM');
        }

        const app = createSSRApp({
          render: () =>
            h('div', [
              h(CanvasToolbar),
              h(CanvasSurface, { ariaLabel: 'Vue CJS SSR Canvas' }),
              h(CanvasLayers),
              h(CanvasProperties),
            ]),
        });

        renderToString(app).then((html) => {
          if (!html.includes('data-canvash-ssr="true"')) {
            throw new Error('HTML Vue CJS não contém atributo data-canvash-ssr');
          }
          console.log('VUE_SSR_CJS_OK');
        }).catch((err) => {
          console.error(err);
          process.exit(1);
        });
      `;

      const output = execFileSync('node', ['-e', script], {
        cwd: rootDir,
        encoding: 'utf8',
      });

      expect(output).toContain('VUE_SSR_CJS_OK');
    });
  });
});
