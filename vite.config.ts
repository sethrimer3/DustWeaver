import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: '/DustWeaver/',
  publicDir: 'ASSETS',
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
});
