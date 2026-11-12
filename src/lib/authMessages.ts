export function authErrorMessage(error: unknown): string {
  const code = String((error as { code?: string })?.code || '');
  const messages: Record<string, string> = {
    'auth/popup-closed-by-user': 'Google sign-in was canceled. You can try again.',
    'auth/cancelled-popup-request': 'Another Google sign-in is already open. Finish that window or continue in this tab.',
    'auth/popup-blocked': 'Your browser blocked the Google window. Continue in this tab instead.',
    'auth/unauthorized-domain': 'Google sign-in is not enabled for this website address yet. Use email sign-in or contact your organizer.',
    'auth/operation-not-allowed': 'This sign-in method is not enabled yet. Try another method or contact your organizer.',
    'auth/account-exists-with-different-credential': 'This email already uses another sign-in method. Sign in with your existing method.',
    'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/user-not-found': 'Email or password is incorrect.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/password-does-not-meet-requirements': 'This password does not meet the account requirements. Try a longer password with letters, numbers and a symbol.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Please wait before trying again.',
    'auth/network-request-failed': 'Could not connect. Check your connection and try again.',
    'auth/user-disabled': 'This account has been disabled. Contact your organizer.',
  };
  return messages[code] || 'Sign-in could not be completed. Please try again.';
}
