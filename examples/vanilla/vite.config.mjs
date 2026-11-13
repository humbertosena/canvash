import fs from 'node:fs';
import path from 'node:path';

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
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
};
