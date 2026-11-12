import React, { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { useAuth } from '../../lib/authContext';
import { hasCampusEmail, pendingSpectatorInvite } from '../../lib/campusAccess';
import { CAMPUS_DOMAIN, CAMPUS_NAME } from '../../lib/institution';
import { validateAuthFields } from '../../lib/authValidation';
import { authErrorMessage } from '../../lib/authMessages';
import { SpectatorQRReader } from './SpectatorQRReader';
import { Eye, EyeOff, QrCode, CheckCircle2 } from '../ui/Icons';
import { useToast } from '../ui/Toast';

export interface AuthScreenProps { initialTab?: 'signin' | 'signup' | 'qr'; onSuccess?: () => void }
const COLLEGES = ['College of Computing Studies', 'College of Engineering', 'College of Nursing', 'College of Criminal Justice Education', 'College of Law', 'College of Architecture', 'College of Liberal Arts', 'College of Education'];
const TABS = [{ id: 'signin', label: 'Sign in' }, { id: 'signup', label: 'Sign up' }, { id: 'qr', label: 'Scan QR' }] as const;
function GoogleMark() {
  return <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.94-6.16-4.54H2.15v2.85A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.06H2.15a11 11 0 0 0 0 9.88z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.54 10.54 0 0 0 12 1a11 11 0 0 0-9.85 6.06l3.69 2.85C6.71 7.31 9.14 5.38 12 5.38z"/></svg>;
}
export function AuthScreen({ initialTab = 'signin', onSuccess }: AuthScreenProps) {
  const { signInWithGoogle, signInWithGoogleRedirect, signInWithEmail, signUpWithEmail, authError, isConfigured } = useAuth();
  const { showToast } = useToast(), id = useId(), tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const flow = useRef<HTMLDivElement>(null), form = useRef<HTMLFormElement>(null);
  const [tab, setTab] = useState<'signin' | 'signup' | 'qr' | 'reset'>(initialTab);
  const [name, setName] = useState(''), [college, setCollege] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false), [busy, setBusy] = useState(false), [googlePending, setGooglePending] = useState(false), [redirectAvailable, setRedirectAvailable] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({}), [error, setError] = useState(''), [notice, setNotice] = useState(''), [invited, setInvited] = useState(() => !!pendingSpectatorInvite());
  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => { if (flow.current) flow.current.scrollTop = 0; }, [tab]);
  useEffect(() => { if (Object.keys(errors).length) form.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus(); }, [errors]);
  const changeTab = (next: typeof tab) => { setTab(next); setError(''); setNotice(''); setErrors({}); setShowPassword(false); if (next !== 'qr') { setPassword(''); setConfirmation(''); } setInvited(!!pendingSpectatorInvite()); };
  const google = async (redirect = false) => {
    setGooglePending(true); setError(''); setNotice(''); setErrors({});
    try {
      const result = redirect ? await signInWithGoogleRedirect() : await signInWithGoogle();
      if (result.error) { setError(result.error); setRedirectAvailable(!redirect && 'canRedirect' in result && !!result.canRedirect); }
      else if (auth.currentUser) onSuccess?.();
    } catch (e) { setError(authErrorMessage(e)); }
    finally { setGooglePending(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setNotice('');
    const fields: Record<string, string> = tab === 'reset' ? (validateAuthFields({ email, password: 'unused' }, false) as Record<string, string>) : validateAuthFields({ name, email, password, campus: hasCampusEmail(email) ? college || CAMPUS_NAME : 'Spectator' }, tab === 'signup');
    if (tab === 'signup' && confirmation !== password) fields.confirmation = 'Passwords do not match.';
    setErrors(fields); if (Object.keys(fields).length) return;
    setBusy(true);
    try {
      if (tab === 'reset') {
        try { await sendPasswordResetEmail(auth, email.trim().toLowerCase()); }
        catch (e) { if ((e as any).code !== 'auth/user-not-found') throw e; }
        setNotice('If an account uses this email, you’ll receive a password reset link. Check your inbox and spam folder.'); return;
      }
      if (tab === 'signup') {
        const result = await signUpWithEmail(email, password, name, college);
        if (result.error) setError(result.error);
        else { showToast(result.verificationSent ? 'Account created. Check your email to verify it.' : 'Account created. Resend verification from the next screen.', 'info'); onSuccess?.(); }
      } else {
        const result = await signInWithEmail(email, password);
        if (result.error) setError(result.error); else onSuccess?.();
      }
    } catch (e) { setError(authErrorMessage(e)); }
    finally { setBusy(false); }
  };
  const disabled = busy || googlePending;
  const fieldError = (key: string) => errors[key] ? <small id={`${id}-${key}-error`} className="auth-field-error">{errors[key]}</small> : null;
  return <div ref={flow} className="auth-flow">
    <div className="auth-flow-tabs" role="tablist" aria-label="Account access">{TABS.map((item, index) => <button key={item.id} ref={node => { tabs.current[index] = node; }} type="button" id={`${id}-${item.id}-tab`} role="tab" aria-selected={tab === item.id || tab === 'reset' && item.id === 'signin'} aria-controls={`${id}-panel`} tabIndex={tab === item.id || tab === 'reset' && item.id === 'signin' ? 0 : -1} disabled={disabled} onClick={() => changeTab(item.id)} onKeyDown={e => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (index + (e.key === 'ArrowRight' ? 1 : -1) + 3) % 3; changeTab(TABS[next].id); tabs.current[next]?.focus(); }}>{item.label}</button>)}</div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab === 'reset' ? 'signin' : tab}-tab`}>
      {(error || authError) && <p className="auth-flow-error" role="alert">{error || authError}</p>}
      {notice && <p className="auth-flow-success" role="status"><CheckCircle2 size={17} />{notice}</p>}
      {!isConfigured && <p className="auth-flow-error" role="alert">Account sign-in is not configured for this website yet. Contact your organizer.</p>}
      {tab === 'qr' && <><SpectatorQRReader onVerified={() => setInvited(true)} /><div className="auth-qr-next"><button type="button" className="arena-primary" onClick={() => changeTab('signin')}>Continue to sign in</button><button type="button" className="auth-flow-text" onClick={() => changeTab('signup')}>Create an account</button></div></>}
      {tab !== 'qr' && <>
        <p className="auth-flow-intro">{tab === 'reset' ? 'We’ll email you a link to reset your password.' : tab === 'signup' ? 'Create your own ArenaHub account.' : 'Welcome back. Sign in to your account.'}</p>

        <form ref={form} noValidate onSubmit={submit} className="auth-flow-form" aria-busy={busy}>
          {tab === 'signup' && <label>Full name<input autoComplete="name" maxLength={80} value={name} onChange={e => setName(e.target.value)} disabled={disabled} aria-invalid={!!errors.name} aria-describedby={errors.name ? `${id}-name-error` : undefined} />{fieldError('name')}</label>}
          <label>Email address<input type="email" autoComplete="email" inputMode="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={disabled} placeholder={`you@${CAMPUS_DOMAIN}`} aria-invalid={!!errors.email} aria-describedby={errors.email ? `${id}-email-error` : undefined} />{fieldError('email')}</label>
          {tab === 'signup' && hasCampusEmail(email) && <label>College (optional)<select value={college} onChange={e => setCollege(e.target.value)} disabled={disabled}><option value="">Choose your college</option>{COLLEGES.map(value => <option key={value}>{value}</option>)}</select></label>}
          {tab !== 'reset' && <><div className="auth-password-label"><label htmlFor={`${id}-password`}>Password</label>{tab === 'signin' && <button type="button" className="auth-flow-text" disabled={disabled} onClick={() => changeTab('reset')}>Forgot password?</button>}</div><div className="auth-password-input"><input id={`${id}-password`} type={showPassword ? 'text' : 'password'} autoComplete={tab === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} disabled={disabled} aria-invalid={!!errors.password} aria-describedby={errors.password ? `${id}-password-error` : tab === 'signup' ? `${id}-password-help` : undefined} /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>{fieldError('password')}{tab === 'signup' && <><small id={`${id}-password-help`} className="auth-flow-hint">Use at least 6 characters.</small><label>Confirm password<input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={disabled} aria-invalid={!!errors.confirmation} aria-describedby={errors.confirmation ? `${id}-confirmation-error` : undefined} />{fieldError('confirmation')}</label></>}</>}
          {tab === 'signup' && !hasCampusEmail(email) && <p className="auth-flow-hint">{invited ? 'Your student invitation will be checked again after email verification.' : <>Using a personal email? <button type="button" className="auth-flow-text" onClick={() => changeTab('qr')}>Add a student invitation</button> before creating your spectator account.</>}</p>}
          <button type="submit" className="arena-primary auth-submit" disabled={!isConfigured || disabled}>{busy ? 'Please wait…' : tab === 'reset' ? 'Send reset link' : tab === 'signup' ? 'Create account' : 'Sign in with email'}</button>
          {tab === 'reset' && <button type="button" className="auth-flow-text" disabled={disabled} onClick={() => changeTab('signin')}>Back to sign in</button>}
        </form>
        {tab !== 'reset' && <><div className="auth-flow-divider"><span>or continue with Google</span></div><button type="button" disabled={!isConfigured || disabled} className="auth-google-button" onClick={() => void google()}><GoogleMark />{googlePending ? 'Waiting for Google…' : 'Continue with Google'}</button>{(googlePending || redirectAvailable) && <div className="auth-google-fallback"><p>Google window didn’t open?</p><button type="button" className="auth-flow-text" onClick={() => void google(true)}>Continue in this tab</button></div>}<p className="auth-flow-hint auth-google-domain">Google sign-in accepts @{CAMPUS_DOMAIN} only.</p></>}
        <p className="auth-flow-footnote">{tab === 'reset' ? 'Use the email you registered with ArenaHub.' : `Members use their verified @${CAMPUS_DOMAIN} email. Spectators can use email sign-in with a current student invitation.`}</p>
      </>}
    </div>
  </div>;
}
