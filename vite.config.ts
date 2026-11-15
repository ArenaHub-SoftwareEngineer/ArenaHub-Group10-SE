import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import express from 'express';
import { createAiRouter } from './server/ai.ts';
import { createFairPlayRouter } from './server/fairPlay.ts';
import { createIntegrityRouter } from './server/integrity.ts';

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
          // Test mode (emulators, Playwright) never touches the event laptop's real match monitor database in data/,
          // even when Playwright reuses a dev server that was started without INTEGRITY_DATA_DIR.
          api.use('/api/integrity', createIntegrityRouter(mode === 'test' && !env.INTEGRITY_DATA_DIR ? { ...env, INTEGRITY_DATA_DIR: '.test-data/integrity' } : env));
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
