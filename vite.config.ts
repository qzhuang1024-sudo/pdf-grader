import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Two build targets:
//   npm run build           -> dist/            (served over http, e.g. `npm run preview` or any static server)
//   npm run build:portable  -> dist-portable/   (ONE self-contained index.html you can double-click; works from file://)
export default defineConfig(({ mode }) => {
  const portable = mode === 'portable';
  return {
    base: './',
    plugins: [react(), ...(portable ? [viteSingleFile()] : [])],
    build: {
      outDir: portable ? 'dist-portable' : 'dist',
      target: 'es2022',
      chunkSizeWarningLimit: 8000,
      sourcemap: false,
    },
    server: { port: 5173 },
  };
});
