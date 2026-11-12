export function validateProfile(name: string, campus: string): string | null {
  if (name.trim().length < 2 || name.trim().length > 80) return 'Use a display name between 2 and 80 characters.';
  if (campus.trim().length < 2 || campus.trim().length > 160) return 'Use a campus name between 2 and 160 characters.';
  if (/[\u0000-\u001f\u007f]/.test(name + campus)) return 'Names cannot contain control characters.';
  return null;
}

export function validateEmail(email: string): string | null {
  return email.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : 'Enter a valid email address.';
}
