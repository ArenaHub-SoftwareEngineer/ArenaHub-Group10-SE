import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { captureSpectatorInvite } from './lib/campusAccess';
import './index.css';
import './dashboard.css';
import './operations.css';
import './auth.css';
import './interactions.css';
// Design system last: it is the single source of truth for tokens, type and motion (see the file header).
import './design.css';

try { document.documentElement.dataset.motion = localStorage.getItem('arenahub_reduced_motion') === 'true' ? 'reduced' : 'full'; document.documentElement.dataset.density = localStorage.getItem('arenahub_compact_layout') === 'true' ? 'compact' : 'comfortable'; } catch {}

captureSpectatorInvite();
createRoot(document.getElementById('root')!).render(<App />);
