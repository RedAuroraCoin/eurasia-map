import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/, so the base is injected
  // there. Everything else (dev server, the Worker) uses the root.
  base: process.env.VITE_BASE ?? '/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    // three.js is the bulk of the bundle and is cacheable on its own
    chunkSizeWarningLimit: 900,
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
