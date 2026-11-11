import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  // The shared package is TypeScript source, not a pre-built artifact,
  // so it must not be pre-bundled as a dependency.
  optimizeDeps: {
    exclude: ['@eurasia/shared'],
  },
});
