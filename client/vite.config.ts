import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/health': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      '/mcp': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
});
