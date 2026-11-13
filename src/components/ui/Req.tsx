import React from 'react';

/**
 * Marks a field that must be filled in with a red asterisk after its label text.
 * `<Req>Email address</Req>` keeps the text and the mark together, which matters in labels laid out as a
 * column. The mark is hidden from screen readers; the field carries `required` or `aria-required` instead.
 */
export function Req({ children }: { children?: React.ReactNode }) {
  const mark = <span className="required-mark" aria-hidden="true">*</span>;
  return children === undefined ? mark : <span className="field-label">{children}{mark}</span>;
}
