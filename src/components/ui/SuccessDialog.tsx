import React from 'react';
import { Check } from './Icons';
import { Modal } from './Modal';

export function SuccessDialog({ open, title, description, onClose }: {
  open: boolean; title: string; description?: string; onClose: () => void;
}) {
  return <Modal open={open} title={title} description={description} className="success-dialog" onClose={onClose}>
    <span className="success-dialog-mark" aria-hidden="true"><Check size={28} strokeWidth={2.5} /></span>
    <button type="button" className="arena-primary" onClick={onClose}>Done</button>
  </Modal>;
}
