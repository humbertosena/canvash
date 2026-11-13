import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  // Um bundle por entrada pública. Só entra no dist o que o index alcança, então os
  // *.test.ts vizinhos ficam de fora.
  entries: ['src/index'],
  // 'node16' emite index.d.mts e index.d.cts, sem um index.d.ts ambíguo.
  declaration: 'node16',
  sourcemap: true,
  clean: true,
  // Dependência importada sem estar declarada falha o build em vez de ser embutida.
  failOnWarn: true,
  rollup: {
    emitCJS: true,
    // O padrão do unbuild é 'esnext' e ele não lê o target do tsconfig.
    esbuild: { target: 'es2022' },
  },
  hooks: {
    // O unbuild só imprime os avisos do Rollup. Aqui eles passam a contar para o failOnWarn;
    // ciclos ficam com o dependency-cruiser.
    'rollup:options'(ctx, options) {
      options.onwarn = (warning) => {
        if (warning.code !== 'CIRCULAR_DEPENDENCY') {
          ctx.warnings.add(`Rollup: ${warning.message}`);
        }
      };
    },
  },
});
