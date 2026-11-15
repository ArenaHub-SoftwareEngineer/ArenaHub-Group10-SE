import { AuthError, callerVerifier, requireStaff, STAFF_ROLES } from './auth.ts';

export { AuthError, STAFF_ROLES };

/** The match monitor's staff check. Same verification as the rest of the API (server/auth.ts); returns the uid. */
export async function verifyStaffToken(env: Record<string, string | undefined>, token: string | undefined, fetcher: typeof fetch = fetch): Promise<string> {
  try {
    return (await requireStaff(callerVerifier(env, fetcher), token, 'Only tournament staff can use the match monitor.')).uid;
  } catch (error) {
    if (error instanceof AuthError && error.status === 401) throw new AuthError(401, 'Your staff access could not be verified. Sign in again.');
    throw error;
  }
}
