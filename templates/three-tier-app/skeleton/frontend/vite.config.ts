import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: ${{ values.frontendPort }},
    proxy: {
      '/api': {
        target: 'http://localhost:${{ values.backendPort }}',
        changeOrigin: true,
      },
    },
  },
});
