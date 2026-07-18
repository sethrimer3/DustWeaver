import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  publicDir: 'ASSETS',
  build: {
    outDir: 'dist',
    target: 'es2020',
    // DustWeaver currently ships as one tightly coupled game entry chunk.
    // Keep Vite's warning useful by setting the limit just above its measured size.
    chunkSizeWarningLimit: 1800,
  },
});
