import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendUrl = process.env.BACKEND_PROXY_TARGET || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: false,
    proxy: {
      '/auth': {
        target: backendUrl,
        changeOrigin: true,
        secure: false,
      },
      '/library': {
        target: backendUrl,
        changeOrigin: true,
        secure: false,
      },
      '/me': {
        target: backendUrl,
        changeOrigin: true,
        secure: false,
      },
      '/health': {
        target: backendUrl,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
