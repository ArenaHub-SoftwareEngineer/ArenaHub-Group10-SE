import { validateEmail } from './profileValidation';
export type AuthField = 'name' | 'email' | 'password' | 'campus';
export type AuthErrors = Partial<Record<AuthField,string>>;
export function validateAuthFields(input: { name?: string; email: string; password: string; campus?: string }, signup: boolean): AuthErrors {
  const errors: AuthErrors = {};
  if (signup && (!input.name?.trim() || input.name.trim().length < 2 || input.name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(input.name))) errors.name = 'Use 2–80 characters.';
  if (!input.email.trim()) errors.email = 'Enter your email.';
  else if (validateEmail(input.email)) errors.email = 'Invalid email.';
  if (!input.password) errors.password = 'Enter your password.';
  else if (signup && input.password.length < 6) errors.password = 'Use 6+ characters.';
  if (signup && (!input.campus?.trim() || input.campus.trim().length < 2 || input.campus.trim().length > 160)) errors.campus = 'Enter your campus.';
  return errors;
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
