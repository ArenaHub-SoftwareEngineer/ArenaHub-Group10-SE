import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { captureSpectatorInvite } from './lib/campusAccess';
import './index.css';
import './dashboard.css';
import './operations.css';
import './auth.css';
import './authSignup.css';
import './interactions.css';
// Design system last: it is the single source of truth for tokens, type and motion (see the file header).
import './design.css';
// The school's brand colours, generated from institution.config.json (npm run configure:institution).
import './generated/institution.css';
import './shell.css';
import './illustrations.css';
import './watch.css';
import './desk.css';
// Home, landing and the 3D arena stage.
import './arena.css';
// Consistency layer: one look per control (buttons, tabs, chips, stat tiles) and the arrival motion. Keep it last.
import './polish.css';
// Page system (headers, tabs, panels, stats, forms, tables) for every inner and admin page. Truly last.
import './pages.css';

try { document.documentElement.dataset.motion = localStorage.getItem('arenahub_reduced_motion') === 'true' ? 'reduced' : 'full'; document.documentElement.dataset.density = localStorage.getItem('arenahub_compact_layout') === 'true' ? 'compact' : 'comfortable'; } catch {}

captureSpectatorInvite();
createRoot(document.getElementById('root')!).render(<App />);
