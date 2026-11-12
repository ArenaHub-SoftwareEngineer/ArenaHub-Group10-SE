import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { createAiRouter } from './server/ai.ts';
import { createFairPlayRouter } from './server/fairPlay.ts';
import express from 'express';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss(), { name: 'arena-ai-api', configureServer(server) { const api = express(); api.disable('x-powered-by'); api.use('/api/ai', createAiRouter(env)); api.use('/api/fair-play', createFairPlayRouter(env)); server.middlewares.use((req, res, next) => api(req as express.Request, res as express.Response, next)); } }],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
