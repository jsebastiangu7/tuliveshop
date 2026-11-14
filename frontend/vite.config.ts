
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const apiTarget =
    env.API_PROXY_TARGET || 'https://tuliveshop.onrender.com';

  return {
    plugins: [react()],

    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,

      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: true
        }
      }
    },

    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false
    }
  };
});
