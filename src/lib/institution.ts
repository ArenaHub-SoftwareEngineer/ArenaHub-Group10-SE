import institution from '../../institution.config.json' with { type: 'json' };

export const CAMPUS_DOMAIN = institution.emailDomain;
export const CAMPUS_NAME = institution.name;
export const CAMPUS_SHORT_NAME = institution.shortName;
/** The school's logo in public/, or '' to show the short name only. Checked by scripts/sync-institution.mjs. */
export const CAMPUS_LOGO: string = (institution as { theme?: { logo?: string } }).theme?.logo || '';

export function hasCampusEmail(email?: string | null): boolean {
  const [local, domain, extra] = (email || '').trim().toLowerCase().split('@');
  return Boolean(local) && !/\s/.test(local) && domain === CAMPUS_DOMAIN && extra === undefined;
}

export const GOOGLE_DOMAIN_ERROR = `Continue with Google requires a verified @${CAMPUS_DOMAIN} account. Choose your institutional Google account.`;

export function acceptsGoogleAccount(account: { email?: string | null; emailVerified: boolean }): boolean {
  return account.emailVerified && hasCampusEmail(account.email);
}
