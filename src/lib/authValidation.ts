import { validateEmail } from './profileValidation';
export type AuthField = 'name' | 'firstName' | 'middleName' | 'lastName' | 'email' | 'password' | 'campus';
export type AuthErrors = Partial<Record<AuthField,string>>;
export interface NameParts { first: string; middle?: string; last: string }

// Letters from any language, with the spaces, hyphens, apostrophes and periods real names use (Ma. Clara, O'Neil, Dela Cruz-Santos).
const NAME_PART = /^\p{L}[\p{L}\p{M} .'’-]*$/u;
export const tidyName = (value = '') => value.trim().replace(/\s+/g, ' ');
export function namePartError(value: string | undefined, label: string, optional = false): string | undefined {
  const text = tidyName(value);
  if (!text) return optional ? undefined : `Enter your ${label}.`;
  if (text.length > 40) return 'Use 40 characters or fewer.';
  if (!NAME_PART.test(text)) return 'Use letters, spaces, hyphens or apostrophes.';
  return undefined;
}
/** "Juan Santos Dela Cruz": the display name built from the separate fields. */
export function composeName(parts: NameParts): string {
  return [parts.first, parts.middle, parts.last].map(tidyName).filter(Boolean).join(' ');
}
/** Initials from first and last name only, so a middle name never replaces the surname. */
export function nameInitials(parts: NameParts): string {
  return (tidyName(parts.first).charAt(0) + tidyName(parts.last).charAt(0)).toUpperCase();
}
export function validateNameParts(parts: NameParts): AuthErrors {
  const errors: AuthErrors = {};
  const first = namePartError(parts.first, 'first name'), middle = namePartError(parts.middle, 'middle name', true), last = namePartError(parts.last, 'last name');
  if (first) errors.firstName = first;
  if (middle) errors.middleName = middle;
  if (last) errors.lastName = last;
  return errors;
}
export function validateAuthFields(input: { name?: string; nameParts?: NameParts; email: string; password: string; campus?: string }, signup: boolean): AuthErrors {
  const errors: AuthErrors = signup && input.nameParts ? validateNameParts(input.nameParts) : {};
  if (signup && !input.nameParts && (!input.name?.trim() || input.name.trim().length < 2 || input.name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(input.name))) errors.name = 'Use 2–80 characters.';
  if (!input.email.trim()) errors.email = 'Enter your email.';
  else if (validateEmail(input.email)) errors.email = 'Invalid email.';
  if (!input.password) errors.password = 'Enter your password.';
  else if (signup && input.password.length < 6) errors.password = 'Use 6+ characters.';
  if (signup && (!input.campus?.trim() || input.campus.trim().length < 2 || input.campus.trim().length > 160)) errors.campus = 'Enter your campus.';
  return errors;
}
/** 0–4 for the sign-up strength meter. Firebase only enforces 6 characters; this is guidance, not a rule. */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d|[^A-Za-z0-9]/.test(password)) score++;
  return Math.max(1, Math.min(4, score)) as 1 | 2 | 3 | 4;
}
export function shortAuthError(message: string): string {
  const text = message.toLowerCase();
  if (/email.*already|already.*email/.test(text)) return 'Email already registered.';
  if (/incorrect|wrong-password|invalid-credential|credentials/.test(text)) return 'Email or password is incorrect.';
  if (/weak-password|at least 6|6 characters/.test(text)) return 'Use 6+ characters.';
  if (/invalid.*email|valid email|email.*format/.test(text)) return 'Invalid email.';
  if (/too.many|too many attempts/.test(text)) return 'Too many attempts. Try later.';
  if (/network|connection|unavailable/.test(text)) return 'Connection failed. Try again.';
  if (/not configured/.test(text)) return 'Sign-in isn’t available yet.';
  if (/affiliation|campus/.test(text)) return 'Couldn’t save your campus.';
  if (/popup|google/.test(text)) return 'Google sign-in failed. Try again.';
  return 'Couldn’t continue. Try again.';
}
