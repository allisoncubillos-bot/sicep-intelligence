import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// El frontend llama a /api/* y Vite lo proxea al backend Express (server/index.js),
// que es quien guarda la API key de Anthropic. La key NUNCA llega al cliente.
// El puerto del backend se toma de PORT (default 3001) para mantenerlo en sync.
const BACKEND_PORT = process.env.PORT || '3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
