import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import express from 'express';
import { createAiRouter } from './server/ai.ts';
import { createFairPlayRouter } from './server/fairPlay.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        // Mounts the same API routers the production server uses, so local development matches deployment.
        name: 'arena-api',
        configureServer(server) {
          const api = express();
          api.disable('x-powered-by');
          api.use('/api/ai', createAiRouter(env));
          api.use('/api/fair-play', createFairPlayRouter(env));
          server.middlewares.use((req, res, next) => api(req as express.Request, res as express.Response, next));
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      // Always start from an empty dist/ so stale hashed chunks are never deployed.
      emptyOutDir: true,
    },
  };
});
