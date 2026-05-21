import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  publicDir: 'ASSETS',
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
});