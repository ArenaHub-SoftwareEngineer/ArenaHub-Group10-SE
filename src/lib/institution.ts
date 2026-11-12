import institution from '../../institution.config.json' with { type: 'json' };

export const CAMPUS_DOMAIN = institution.emailDomain;
export const CAMPUS_NAME = institution.name;
export const CAMPUS_SHORT_NAME = institution.shortName;

export function hasCampusEmail(email?: string | null): boolean {
  const [local, domain, extra] = (email || '').trim().toLowerCase().split('@');
  return Boolean(local) && !/\s/.test(local) && domain === CAMPUS_DOMAIN && extra === undefined;
}

export const GOOGLE_DOMAIN_ERROR = `Continue with Google requires a verified @${CAMPUS_DOMAIN} account. Choose your institutional Google account.`;

export function acceptsGoogleAccount(account: { email?: string | null; emailVerified: boolean }): boolean {
  return account.emailVerified && hasCampusEmail(account.email);
}
