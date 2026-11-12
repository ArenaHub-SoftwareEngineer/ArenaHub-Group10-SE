import React from 'react';

/** Original pen-and-paper artwork; designed for the graphite/orange interface. */
export function EditorialIllustration({ className = '' }: { className?: string }) {
  return <svg viewBox="0 0 180 132" className={`editorial-illustration ${className}`} fill="none" aria-hidden="true">
    <path d="m38 20 87-6 12 86-86 7z" fill="var(--surface-elevated)" stroke="currentColor" strokeWidth="1.5" />
    <path d="m49 12 87 5-5 89-88-5z" fill="var(--surface)" stroke="currentColor" strokeWidth="1.8" />
    <path d="m58 36 61 3m-62 9 45 3m-46 10 60 2m-61 10 27 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="m100 84 14 1 2 18-9-6-8 4z" fill="var(--brand)" />
    <path d="m127 48 31-29 6 7-31 29-11 5z" fill="var(--bg-base)" stroke="currentColor" strokeWidth="1.5" />
    <path d="m150 27 6 7m-29 14 6 7M25 116c32-5 106-3 133-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="m28 51-9-3m14-10-4-8m112 64 10 3" stroke="var(--brand)" strokeWidth="1.7" strokeLinecap="round" />
  </svg>;
}
