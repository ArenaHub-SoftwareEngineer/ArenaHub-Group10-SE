import { AuthError, callerVerifier, requireMonitorAccess, STAFF_ROLES } from './auth.ts';

export { AuthError, STAFF_ROLES };

/** Who opened the match monitor. Facilitators are limited to their assigned matches (server/integrity.ts). */
export interface MonitorStaff { uid: string; role: string; email: string; facilitator: boolean }

/** The match monitor's staff check. Same verification as the rest of the API (server/auth.ts). */
export async function verifyStaffToken(env: Record<string, string | undefined>, token: string | undefined, fetcher: typeof fetch = fetch): Promise<MonitorStaff> {
  try {
    const caller = await requireMonitorAccess(callerVerifier(env, fetcher), token, 'Only tournament staff can use the match monitor.');
    return { uid: caller.uid, role: caller.role, email: caller.email.toLowerCase(), facilitator: caller.facilitator === true };
  } catch (error) {
    if (error instanceof AuthError && error.status === 401) throw new AuthError(401, 'Your staff access could not be verified. Sign in again.');
    throw error;
  }
}
