import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // Override with VITE_API_PROXY when the backend runs on a non-default port
      // (e.g. VITE_API_PROXY=http://localhost:8001 for a docker-compose backend).
      '/api': process.env.VITE_API_PROXY || 'http://localhost:8000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: 'hidden',
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
  },
});
