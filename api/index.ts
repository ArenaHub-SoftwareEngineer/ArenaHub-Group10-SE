// Serverless entry for an API-only deployment (see docs/DEPLOY.md). The website stays on Firebase Hosting;
// this serves /api/health, /api/ai and /api/fair-play only. The match monitor stays on the event laptop.
// Configuration comes from the host's environment variables; nothing is read from .env files here.
import { createApp } from '../server/app';

export default createApp(process.env, { site: null, integrity: false });
