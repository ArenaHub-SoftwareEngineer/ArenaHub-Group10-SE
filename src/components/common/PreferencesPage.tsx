import React, { useState } from 'react';
import { Pencil, ArrowUpRight, UserRound, ShieldCheck, Palette, Loader2, QrCode, Bell } from '../ui/Icons';
import { alertState, setSystemAlerts, type AlertState } from '../../lib/systemAlerts';

/** On/off for system notifications in this browser, with the reason when the browser will not show them. */
function SystemAlertsRow() {
  const [state, setState] = useState<AlertState>(alertState), [busy, setBusy] = useState(false);
  const detail = {
    unsupported: 'This browser cannot show system notifications. Updates still arrive in the bell.',
    denied: 'Notifications are blocked for ArenaHub in this browser. Allow them in the browser’s site settings (the icon left of the address), then turn this on.',
    off: 'Get a system notification for new updates while ArenaHub is open in another tab. Only on this browser; nothing is sent when ArenaHub is closed.',
    on: 'On for this browser. New updates pop up while ArenaHub is open in a tab you are not looking at.',
  }[state];
  return <div className="preference-row"><div><strong>System notifications</strong><p role="status">{detail}</p></div>
    {(state === 'on' || state === 'off') && <button type="button" className={`${state === 'on' ? 'arena-outline' : 'arena-primary'} arena-sm`} disabled={busy}
      onClick={async () => { setBusy(true); try { setState(await setSystemAlerts(state !== 'on')); } finally { setBusy(false); } }}>
      {busy ? 'Asking the browser…' : state === 'on' ? 'Turn off' : 'Turn on'}
    </button>}
  </div>;
}
import { doc, updateDoc } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential, sendPasswordResetEmail, verifyBeforeUpdateEmail } from 'firebase/auth';
import { User } from '../../lib/types';
import { useAuth, makeInitials } from '../../lib/authContext';
import { auth, db } from '../../lib/firebase';
import { validateEmail, validateProfile } from '../../lib/profileValidation';
import { hasCampusEmail } from '../../lib/campusAccess';
import { StudentInviteCard } from './StudentInviteCard';
import { Modal } from '../ui/Modal';
import { Req } from '../ui/Req';
import { sendWithReturn } from '../../lib/emailLinks';

type Editor = 'profile' | 'email' | 'password' | 'appearance' | null;
function read(key: string) { try { return localStorage.getItem(key) === 'true'; } catch { return false; } }

export function PreferencesPage({ user, onSignIn, inDialog = false }: { user: User; onSignIn?: () => void; inDialog?: boolean }) {
  const { firebaseUser, ahUser } = useAuth();
  const [section, setSection] = useState('profile');
  const [editor, setEditor] = useState<Editor>(null);
  const [name, setName] = useState(user.name);
  const [campus, setCampus] = useState(user.collegeName || '');
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState('');
  const [reduced, setReduced] = useState(() => read('arenahub_reduced_motion'));
  const [compact, setCompact] = useState(() => read('arenahub_compact_layout'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const guest = !firebaseUser || firebaseUser.isAnonymous;
  const passwordAccount = firebaseUser?.providerData.some(p => p.providerId === 'password');
  const close = () => { if (!busy) { setEditor(null); setPassword(''); setError(''); } };
  const open = (next: Editor) => {
    setName(user.name); setCampus(user.collegeName || ''); setEmail(user.email);
    setReduced(read('arenahub_reduced_motion')); setCompact(read('arenahub_compact_layout'));
    setPassword(''); setError(''); setNotice(''); setEditor(next);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (editor === 'appearance') {
      try {
        localStorage.setItem('arenahub_reduced_motion', String(reduced));
        localStorage.setItem('arenahub_compact_layout', String(compact));
        setNotice('Appearance saved for this browser.');
      } catch { setNotice('Appearance applied for this visit. Browser storage is unavailable.'); }
      document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
      document.documentElement.dataset.density = compact ? 'compact' : 'comfortable';
      setEditor(null); return;
    }
    if (!firebaseUser || guest) { setError('Sign in with a registered account to edit your profile.'); return; }
    const validation = editor === 'profile' ? validateProfile(name, campus) : editor === 'email' ? validateEmail(email) : null;
    if (validation) { setError(validation); return; }
    if (editor === 'email' && email.trim().toLowerCase() === firebaseUser.email?.toLowerCase()) { setError('Enter a different email address.'); return; }
    setBusy(true);
    try {
      if (editor === 'profile') {
        await updateDoc(doc(db, 'users', firebaseUser.uid), { name: name.trim(), collegeName: campus.trim(), avatarInitials: makeInitials(name.trim()) });
        setNotice('Profile saved to your account.');
      } else if (editor === 'email') {
        if (passwordAccount) {
          if (!password) { setError('Enter your current password to confirm this change.'); return; }
          await reauthenticateWithCredential(firebaseUser, EmailAuthProvider.credential(firebaseUser.email!, password));
        }
        const address = email.trim().toLowerCase(); await sendWithReturn(settings => verifyBeforeUpdateEmail(firebaseUser, address, settings), 'email-changed');
        setNotice('Verification sent to your new address. Follow the link, then sign in again to complete the change.');
      } else if (editor === 'password') {
        if (!firebaseUser.email) throw new Error('missing-email');
        const address = firebaseUser.email; await sendWithReturn(settings => sendPasswordResetEmail(auth, address, settings), 'password-reset');
        setNotice('Password reset email sent. Use the secure link in your inbox to choose your new password.');
      }
      setEditor(null); setPassword('');
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(code === 'auth/requires-recent-login' ? 'Sign out and sign in again, then retry this change.' :
        code === 'auth/invalid-credential' || code === 'auth/wrong-password' ? 'Your current password is incorrect.' :
        code === 'auth/email-already-in-use' ? 'That email address is already in use.' :
        code === 'auth/too-many-requests' ? 'Too many attempts. Please wait before trying again.' :
        code === 'permission-denied' ? 'Your profile could not be saved. Check your account access and try again.' :
        'The change could not be completed. Check your connection and try again.');
    } finally { setBusy(false); }
  };
  const row = (title: string, detail: string, next: Editor, label = 'Edit') => <div className="preference-row"><div><strong>{title}</strong><p>{detail}</p></div><button className="settings-edit" onClick={() => open(next)}>{label}<Pencil size={13} /></button></div>;
  const canInvite = firebaseUser?.emailVerified && ahUser?.status === 'active' && ahUser.spectatorInviteApproved && hasCampusEmail(firebaseUser.email);
  const sections = [
    { id: 'profile', label: 'Profile', icon: UserRound },
    ...(!guest ? [{ id: 'security', label: 'Sign-in & security', icon: ShieldCheck }] : []),
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'alerts', label: 'Notifications', icon: Bell },
    ...(canInvite ? [{ id: 'invite', label: 'Spectator invite', icon: QrCode }] : []),
  ];
  return <div className={inDialog ? 'settings-workspace' : 'module-page settings-page'}>
    {inDialog && <nav className="settings-workspace-nav" aria-label="Settings sections">
      {sections.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={section === id} onClick={() => setSection(id)}>
        <Icon size={16} aria-hidden="true" /> {label}
      </button>)}
    </nav>}
    <div key={inDialog ? section : undefined} className="module-page settings-page settings-content">
    {!inDialog && <header className="dashboard-page-heading"><h1>Settings</h1><p>Manage your profile, sign-in details, and display preferences.</p></header>}
    {notice && <p className="settings-notice" role="status">{notice}</p>}
    {(!inDialog || section === 'profile') && <section className="arena-panel"><h2 className="settings-section-title"><UserRound size={16} /> Profile</h2>
      {guest ? <div className="preference-row"><div><strong>You’re exploring as a visitor</strong><p>Sign in to save a name, campus, and account details.</p></div><button className="settings-edit" onClick={onSignIn}>Sign in <ArrowUpRight size={14} /></button></div> : <>
        {row('Display name', user.name, 'profile')}{row('Campus affiliation', user.collegeName || 'Add your campus', 'profile')}
        <div className="preference-row"><div><strong>Account role</strong><p>Assigned by your tournament administrator.</p></div><span className="settings-badge">{user.role.replace('-', ' ')}</span></div>
      </>}
    </section>}
    {(!inDialog || section === 'invite') && canInvite && firebaseUser && <StudentInviteCard user={firebaseUser} />}
    {!guest && (!inDialog || section === 'security') && <section className="arena-panel"><h2 className="settings-section-title"><ShieldCheck size={16} /> Sign-in & security</h2>
      {row('Email address', user.email, 'email')}
      {passwordAccount ? row('Password', 'Send a secure reset link to your current email address.', 'password', 'Reset') : <div className="preference-row"><div><strong>Connected sign-in</strong><p>Your sign-in provider manages your password.</p></div><span className="settings-badge">Connected</span></div>}
    </section>}
    {(!inDialog || section === 'appearance') && <section className="arena-panel"><h2 className="settings-section-title"><Palette size={16} /> Appearance</h2>
      {/* One row per setting: the current values are the description, the button opens the editor. */}
      {row('Motion & spacing', `${read('arenahub_reduced_motion') ? 'Reduced motion' : 'Standard motion'} · ${read('arenahub_compact_layout') ? 'Compact' : 'Comfortable'} spacing · saved in this browser`, 'appearance', 'Customize')}
      <div className="preference-row"><div><strong>Stream quality</strong><p>Change quality and captions from the settings button inside the stream player while you watch.</p></div></div>
    </section>}
    {(!inDialog || section === 'alerts') && <section className="arena-panel"><h2 className="settings-section-title"><Bell size={16} /> Notifications</h2>
      <SystemAlertsRow />
      <div className="preference-row"><div><strong>Inbox</strong><p>Match updates, roster decisions and Fair play reviews always arrive in the bell at the top of the page.</p></div></div>
    </section>}
    </div>
    <Modal open={editor !== null} busy={busy} onClose={close}
      title={editor === 'profile' ? 'Edit your profile' : editor === 'email' ? 'Change email address' : editor === 'password' ? 'Reset your password' : 'Make it comfortable'}
      description={editor === 'profile' ? 'Your name and campus appear across your arena workspace.' : editor === 'email' ? 'Verify your new address before it replaces your current sign-in email.' : editor === 'password' ? 'We’ll send a secure reset link to your account email.' : 'These preferences stay in this browser.'}>
      <form className="module-form" onSubmit={save}>
        {editor === 'profile' && <><label><Req>Display name</Req><input autoFocus required minLength={2} maxLength={80} autoComplete="name" value={name} onChange={e => setName(e.target.value)} /></label><label><Req>Campus affiliation</Req><input required minLength={2} maxLength={160} value={campus} onChange={e => setCampus(e.target.value)} /></label></>}
        {editor === 'email' && <><label><Req>New email address</Req><input autoFocus required type="email" maxLength={254} autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>{passwordAccount && <label><Req>Current password</Req><input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>}</>}
        {editor === 'password' && <div className="module-notice">Send the reset link to <strong>{user.email}</strong>.</div>}
        {editor === 'appearance' && <><label className="settings-toggle"><span><strong>Reduce motion</strong><small>Pause decorative effects and simplify transitions. Your device preference is always respected.</small></span><input type="checkbox" checked={reduced} onChange={e => setReduced(e.target.checked)} /></label><label className="settings-toggle"><span><strong>Compact layout</strong><small>Fit more navigation and workspace content on screen.</small></span><input type="checkbox" checked={compact} onChange={e => setCompact(e.target.checked)} /></label><div className="palette-preview"><i /><i /><i /><i /><span>ArenaHub orange · #FF6600</span></div></>}
        {error && <p className="module-error" role="alert">{error}</p>}
        <footer className="dialog-actions"><button type="button" disabled={busy} className="arena-outline" onClick={close}>Cancel</button><button type="submit" disabled={busy} className="arena-primary">{busy && <Loader2 size={14} className="animate-spin" />}{busy ? 'Saving…' : editor === 'password' ? 'Send reset link' : editor === 'email' ? 'Send verification' : 'Save changes'}</button></footer>
      </form>
    </Modal>
  </div>;
}
