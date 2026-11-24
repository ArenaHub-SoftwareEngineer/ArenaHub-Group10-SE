// The PC agent's window: a small page the agent serves to this PC's own browser, so players see a real
// screen (consent, live scan steps, a clear result) instead of a console that asks them to type YES.
//
// Safety: it listens on 127.0.0.1 only, behind a random secret path that only the tab the agent opened
// knows. Requests must carry this server's exact Host (no DNS rebinding) and actions need a custom header,
// which a different website cannot send without a CORS preflight this server never approves.
// The console keeps working as a fallback, so typing YES/NO still answers every question.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { agentPage } from './agentWindowPage';

export type StepStatus = 'waiting' | 'running' | 'done' | 'warn' | 'failed' | 'skipped';
export interface WindowStep { key: string; label: string; status: StepStatus; detail?: string }
export interface WindowVerdict { status: string; label: string; detail: string; blockers: string[]; warnings: string[]; validUntil: number | null }
export interface WindowState {
  mode: 'official' | 'practice' | null;
  phase: 'choose' | 'connecting' | 'consent' | 'scanning' | 'result' | 'declined' | 'ended' | 'error';
  server?: string;
  code?: string;
  player?: { name: string; match: string; game: string };
  folderCheck?: boolean;
  record?: boolean;
  dota?: boolean;
  notice?: string;
  steps: WindowStep[];
  verdict?: WindowVerdict;
  lastCheck?: number;
  expiresAt?: number;
  listsFrom?: string;
  message?: string;
  note?: string;
}
export type WindowAction =
  | { type: 'choose'; mode: 'practice' }
  | { type: 'choose'; mode: 'official'; code: string; server: string }
  | { type: 'consent'; answer: 'yes' | 'no' }
  | { type: 'stop' }
  | { type: 'rescan' }
  | { type: 'close' };

export interface AgentWindow {
  readonly url: string;
  readonly state: WindowState;
  set(patch: Partial<WindowState>): void;
  step(key: string, patch: Partial<WindowStep>): void;
  /** Resolves with the next action of this type sent from the page. */
  next<T extends WindowAction['type']>(type: T): Promise<Extract<WindowAction, { type: T }>>;
  close(): void;
}

const ACTIONS = new Set(['choose', 'consent', 'stop', 'rescan', 'close']);
const CODE = /^[A-Z2-9]{8}$/;

/** Checks an action body from the page; anything unexpected is ignored rather than trusted. */
export function readAction(body: unknown): WindowAction | null {
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  if (typeof value.type !== 'string' || !ACTIONS.has(value.type)) return null;
  if (value.type === 'choose') {
    if (value.mode === 'practice') return { type: 'choose', mode: 'practice' };
    const code = String(value.code || '').trim().toUpperCase(), server = String(value.server || '').trim();
    return value.mode === 'official' && CODE.test(code) && server.length <= 300 ? { type: 'choose', mode: 'official', code, server } : null;
  }
  if (value.type === 'consent') return value.answer === 'yes' || value.answer === 'no' ? { type: 'consent', answer: value.answer } : null;
  return { type: value.type } as WindowAction;
}

/** Only this exact local origin may talk to the window server. */
export function allowedRequest(headers: IncomingMessage['headers'], method: string, port: number) {
  if (headers.host !== `127.0.0.1:${port}`) return false;
  if (method === 'GET') return true;
  const origin = headers.origin;
  return headers['x-arenahub'] === '1' && (!origin || origin === `http://127.0.0.1:${port}`);
}

export async function startAgentWindow(initial: WindowState, options: { open?: boolean } = {}): Promise<AgentWindow> {
  const secret = randomBytes(24).toString('base64url');
  let state: WindowState = initial;
  const waiting = new Map<string, Array<(action: WindowAction) => void>>();
  const send = (res: ServerResponse, status: number, type: string, body: string) => {
    res.writeHead(status, {
      'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    res.end(body);
  };
  const server = createServer((req, res) => {
    const port = (server.address() as AddressInfo).port;
    const method = req.method || 'GET';
    const path = (req.url || '').split('?')[0];
    if (!allowedRequest(req.headers, method, port) || !path.startsWith(`/${secret}/`)) return send(res, 404, 'text/plain', 'Not found');
    const route = path.slice(secret.length + 2);
    if (method === 'GET' && route === '') return send(res, 200, 'text/html; charset=utf-8', agentPage());
    if (method === 'GET' && route === 'state') return send(res, 200, 'application/json', JSON.stringify({ ...state, now: Date.now() }));
    if (method === 'POST' && route === 'action') {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', chunk => { raw += chunk; if (raw.length > 4096) req.destroy(); });
      req.on('end', () => {
        let action: WindowAction | null = null;
        try { action = readAction(JSON.parse(raw)); } catch { /* Ignored below. */ }
        const listeners = action ? waiting.get(action.type) : undefined;
        if (!action || !listeners?.length) return send(res, 409, 'application/json', JSON.stringify({ error: 'That is not available right now.' }));
        waiting.delete(action.type);
        for (const listener of listeners) listener(action);
        send(res, 200, 'application/json', '{"ok":true}');
      });
      return;
    }
    send(res, 404, 'text/plain', 'Not found');
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  server.unref();
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/${secret}/`;
  // url.dll opens the default browser without passing the address through a command shell.
  if (options.open !== false) execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true }, () => { /* The console still works. */ });
  return {
    url,
    get state() { return state; },
    set(patch) { state = { ...state, ...patch }; },
    step(key, patch) { state = { ...state, steps: state.steps.map(step => step.key === key ? { ...step, ...patch } : step) }; },
    next(type) {
      return new Promise(resolve => { const list = waiting.get(type) || []; list.push(resolve as (action: WindowAction) => void); waiting.set(type, list); });
    },
    close() { server.closeAllConnections(); server.close(); },
  };
}
