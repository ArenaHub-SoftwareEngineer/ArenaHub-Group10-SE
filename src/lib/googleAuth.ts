import { GoogleAuthProvider, getIdTokenResult, type User } from 'firebase/auth';
import { CAMPUS_DOMAIN, acceptsGoogleAccount, GOOGLE_DOMAIN_ERROR } from './institution';

export function institutionalGoogleProvider() {
  const provider = new GoogleAuthProvider();
  // hd guides Google's picker; the returned identity is checked independently.
  provider.setCustomParameters({ prompt: 'select_account', hd: CAMPUS_DOMAIN });
  return provider;
}

export async function enforceGoogleInstitution(user: User) {
  const token = await getIdTokenResult(user);
  if (token.signInProvider === 'google.com' && !acceptsGoogleAccount(user)) {
    throw new Error(GOOGLE_DOMAIN_ERROR);
  }
}
