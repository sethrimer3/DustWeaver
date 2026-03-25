import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: '/DustWeaver/',
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
});
