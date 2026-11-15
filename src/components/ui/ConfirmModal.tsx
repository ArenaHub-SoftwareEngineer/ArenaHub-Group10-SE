import React from 'react';
import { Modal } from './Modal';
import { errorMessage } from '../../lib/errors';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  onConfirm: () => unknown;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDestructive = false,
  onConfirm,
  onCancel,
}) => {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => { if (isOpen) setError(''); }, [isOpen, title]);
  const confirm = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await onConfirm(); }
    catch (error) { setError(errorMessage(error, 'The action could not be completed. Please try again.')); }
    finally { setBusy(false); }
  };
  return <Modal open={isOpen} title={title} description={description} onClose={onCancel} busy={busy}>
    {error && <p className="module-error" role="alert">{error}</p>}
    <div className="dialog-actions">
      <button type="button" className="arena-outline" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
      <button type="button" className={isDestructive ? 'arena-primary confirm-destructive' : 'arena-primary'} disabled={busy} onClick={confirm}>{busy ? 'Working…' : confirmLabel}</button>
    </div>
  </Modal>;
};
