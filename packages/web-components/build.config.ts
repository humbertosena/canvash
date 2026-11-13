import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  // Um bundle por entrada pública. Só entra no dist o que o index alcança.
  entries: ['src/index'],
  declaration: 'node16',
  sourcemap: true,
  clean: true,
  failOnWarn: true,
  rollup: {
    emitCJS: true,
    // O unbuild não lê o tsconfig do pacote. Sem isto, os campos de classe saem nativos ao lado de
    // `static properties` e escondem os acessores reativos do Lit.
    esbuild: {
      target: 'es2022',
      tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } },
    },
  },
  hooks: {
    'rollup:options'(ctx, options) {
      options.onwarn = (warning) => {
        if (warning.code !== 'CIRCULAR_DEPENDENCY') {
          ctx.warnings.add(`Rollup: ${warning.message}`);
        }
      };
    },
  },
});
