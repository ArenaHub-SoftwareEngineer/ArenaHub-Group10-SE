import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import express from 'express';
import { createAiRouter } from './server/ai.ts';
import { createFairPlayRouter } from './server/fairPlay.ts';
import { createIntegrityRouter } from './server/integrity.ts';
import { securityHeaders, publicErrorHandler } from './server/securityHeaders';

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
          api.use(securityHeaders({ development: true }));
          // Test mode never calls a real model: browser tests use the scripted provider (emulators only).
          api.use('/api/ai', createAiRouter(mode === 'test' ? { ...env, ARENA_AI_PROVIDER: 'fake', GEMINI_API_KEY: '', GROQ_API_KEY: '' } : env));
          api.use('/api/fair-play', createFairPlayRouter(env));
          // Test mode (emulators, Playwright) never touches the event laptop's real match monitor database in data/,
          // even when Playwright reuses a dev server that was started without INTEGRITY_DATA_DIR.
          api.use('/api/integrity', createIntegrityRouter(mode === 'test' && !env.INTEGRITY_DATA_DIR ? { ...env, INTEGRITY_DATA_DIR: '.test-data/integrity' } : env));
          api.use(publicErrorHandler);
          server.middlewares.use((req, res, next) => api(req as express.Request, res as express.Response, next));
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // Browser workflows must keep their form state while test reports and emulator files change.
      hmr: mode === 'test' ? false : undefined,
      watch: { ignored: ['**/test-results/**', '**/output/**', '**/.test-data/**', '**/dist-demo/**', '**/dist-agent/**'] },
    },
    build: {
      // Always start from an empty dist/ so stale hashed chunks are never deployed.
      emptyOutDir: true,
      rollupOptions: {
        output: {
          // Vendor code in its own chunks: each stays under 500 kB, caches across releases, and Storage
          // (evidence uploads only) is no longer downloaded by every viewer.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/[\\/]@firebase[\\/](firestore|firestore-compat)[\\/]/.test(id) || /[\\/]firebase[\\/]firestore[\\/]/.test(id)) return 'firebase-firestore';
            if (/[\\/]@firebase[\\/]auth[\\/]/.test(id) || /[\\/]firebase[\\/]auth[\\/]/.test(id)) return 'firebase-auth';
            if (/[\\/]@firebase[\\/]storage[\\/]/.test(id) || /[\\/]firebase[\\/]storage[\\/]/.test(id)) return 'firebase-storage';
            if (/[\\/](@firebase|firebase|idb)[\\/]/.test(id)) return 'firebase-core';
            // Anchored to the package folder: motion ships a motion/react/ folder that is not React.
            if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
            if (/node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'motion';
            if (/[\\/](react-markdown|remark-[^\\/]+|micromark[^\\/]*|mdast-[^\\/]+|hast-[^\\/]+|unified|unist-[^\\/]+|vfile[^\\/]*|property-information|space-separated-tokens|comma-separated-tokens|decode-named-character-reference|character-entities[^\\/]*|devlop|bail|trough|is-plain-obj|ccount|markdown-table|longest-streak|zwitch|trim-lines|html-url-attributes|estree-util-is-identifier-name)[\\/]/.test(id)) return 'markdown';
            return undefined;
          },
        },
      },
    },
  };
});
