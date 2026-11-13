import { defineConfig } from 'vitest/config';

// Contratos dos pacotes distribuídos: o globalSetup constrói todos os pacotes e empacota cada um
// uma única vez por execução; cada teste instala os tarballs fora do workspace e executa
// processos filhos. Por isso fica fora da suíte unitária e sem cobertura.
export default defineConfig({
  test: {
    include: ['tests/packaging/**/*.test.ts'],
    globalSetup: ['tests/packaging/global-setup.ts'],
    // Um `.only` esquecido desligaria o resto da suíte com tudo verde.
    allowOnly: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
