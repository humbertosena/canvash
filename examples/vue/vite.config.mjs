import fs from 'node:fs';
import path from 'node:path';

const PORT = 5175;

/** Resolve imports `./x.js` para `./x.ts` ou `./x.tsx`, como o código-fonte dos pacotes escreve. */
function resolveTsFromJsPlugin() {
  return {
    name: 'resolve-ts-from-js',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source.endsWith('.js') && importer) {
        const dir = path.dirname(importer);
        const fullPath = path.resolve(dir, source);
        if (!fs.existsSync(fullPath)) {
          const tsPath = fullPath.slice(0, -3) + '.ts';
          if (fs.existsSync(tsPath)) return tsPath;
          const tsxPath = fullPath.slice(0, -3) + '.tsx';
          if (fs.existsSync(tsxPath)) return tsxPath;
        }
      }
      return null;
    },
  };
}

export default {
  plugins: [resolveTsFromJsPlugin()],
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
  preview: { host: '127.0.0.1', port: PORT, strictPort: true },
};
