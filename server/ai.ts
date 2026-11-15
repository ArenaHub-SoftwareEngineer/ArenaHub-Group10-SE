import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { originAllowed } from './cors.ts';

/** Provider credentials stay in the Node process. The browser receives text only. */
export function createAiRouter(env: Record<string, string | undefined>) {
  const router = express.Router();
  router.use(express.json({ limit: '128kb' }));
  const requests = new Map<string, { count: number; reset: number }>();

  router.post('/', async (req, res) => {
    const key = env.GEMINI_API_KEY;
    if (!key) {
      res.status(503).json({ error: 'The online assistant is not configured.' });
      return;
    }

    const token = req.get('authorization')?.replace(/^Bearer /, '') || '';
    // Same host, or a site listed in CORS_ORIGINS (server/cors.ts).
    if (!originAllowed(req, env)) { res.status(403).json({ error: 'Open the assistant from ArenaHub.' }); return; }
    if (!token || ['local-dev-token', 'demo-token'].includes(token)) { res.status(401).json({ error: 'Sign in to use the online assistant.' }); return; }
    const { query, context, history = [] } = req.body || {};

    if (
      typeof query !== 'string' ||
      query.length < 1 ||
      query.length > 4000 ||
      typeof context !== 'string' ||
      context.length > 60000
    ) {
      res.status(400).json({ error: 'Invalid assistant request.' });
      return;
    }

    if (
      !Array.isArray(history) ||
      history.length > 24 ||
      history.some(
        message =>
          !message ||
          !['user', 'assistant'].includes(message.role) ||
          typeof message.text !== 'string' ||
          message.text.length < 1 ||
          message.text.length > 4000
      ) ||
      history.reduce((sum, message) => sum + message.text.length, 0) > 20000
    ) {
      res.status(400).json({ error: 'Invalid conversation history.' });
      return;
    }

    let userId = 'local-user';

    // Verify token if provided and non-local
    if (token && token !== 'local-dev-token' && token !== 'demo-token') {
      try {
        const lookup = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
            env.VITE_FIREBASE_API_KEY || ''
          )}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken: token }),
            signal: AbortSignal.timeout(8000),
          }
        );
        const account = (
          (await lookup.json()) as {
            users?: Array<{ localId: string; emailVerified?: boolean; disabled?: boolean }>;
          }
        ).users?.[0];

        if (!lookup.ok || !account?.localId || !account.emailVerified || account.disabled) { res.status(401).json({ error: 'A verified account is required.' }); return; }
        const profileResponse = await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.VITE_FIREBASE_PROJECT_ID || '')}/databases/(default)/documents/users/${encodeURIComponent(account.localId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
        const profile = await profileResponse.json() as any;
        if (!profileResponse.ok || profile.fields?.status?.stringValue !== 'active') { res.status(403).json({ error: 'This account is not active.' }); return; }
        userId = account.localId;
      } catch {
        res.status(401).json({ error: 'Your account could not be verified.' }); return;
      }
    }

    const now = Date.now();
    for (const [id, item] of requests) if (item.reset < now) requests.delete(id);
    const limit = requests.get(userId) || { count: 0, reset: now + 60000 };
    if (limit.count >= 20) {
      res.status(429).json({ error: 'Please wait before asking again.' });
      return;
    }
    limit.count++;
    requests.set(userId, limit);

    try {
      const client = new GoogleGenAI({ apiKey: key });
      const modelName = env.GEMINI_MODEL || 'gemini-3.8-flash';
      const result = await client.models.generateContent({
        model: modelName,
        contents: [
          ...history.map(message => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.text }],
          })),
          {
            role: 'user',
            parts: [
              {
                text: JSON.stringify({
                  referenceContext: context,
                  userQuestion: query,
                }),
              },
            ],
          },
        ],
        config: {
          systemInstruction:
            'You are Arena AI, the official tournament assistant for ArenaHub and WMSU Campus Esports. ' +
            'You have real-time access to live published tournament brackets, current match schedules, real scores, and college team rosters. ' +
            'When users ask about brackets (such as MLBB, Mobile Legends, Valorant, Dota 2, CODM), inspect the published brackets in referenceContext ' +
            'and give detailed, comprehensive answers including: tournament name, format, participating teams, and current round matchups with scores and status. ' +
            'When asked "who plays next" or about schedules, list the live matches first, followed by the upcoming scheduled matches. ' +
            'When asked about teams, provide their college, players, and match records. ' +
            'Keep your responses clear, well-structured, energetic, and helpful.',
          temperature: 0.2,
          maxOutputTokens: 1200,
          httpOptions: { timeout: 20000 },
        },
      });

      res.json({ text: result.text || 'There is not enough information to answer that yet.' });
    } catch (err) {
      console.error('[Arena AI Server Error]:', err);
      res.status(503).json({ error: 'The online assistant is unavailable. Please try again later.' });
    }
  });

  return router;
}
