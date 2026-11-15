// Staff review of Arena AI ratings: what students marked not helpful, with the question and the answer,
// so wrong answers can be traced to missing records, a routing gap or the model. Reviewed items are removed.
import React, { useEffect, useMemo, useState } from 'react';
import { dismissFeedback, watchAiFeedback, type AiFeedback } from '../../lib/aiFeedback';
import { Modal } from '../ui/Modal';
import { ThumbsDown, ThumbsUp } from '../ui/Icons';
import { useToast } from '../ui/Toast';

export function AIFeedbackReview() {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AiFeedback[]>([]);
  const [error, setError] = useState('');
  const [show, setShow] = useState<'down' | 'all'>('down');
  useEffect(() => watchAiFeedback(list => { setItems(list); setError(''); }, setError), []);
  const down = items.filter(i => i.rating === 'down').length;
  const shown = useMemo(() => show === 'down' ? items.filter(i => i.rating === 'down') : items, [items, show]);
  const helpful = items.length ? Math.round(((items.length - down) / items.length) * 100) : null;

  return <>
    <button type="button" className="arena-outline ai-feedback-open" onClick={() => setOpen(true)}>
      <ThumbsDown size={15} /> Answer feedback{down ? ` (${down})` : ''}
    </button>
    <Modal open={open} title="Arena AI answer feedback" description={helpful === null ? 'No ratings yet.' : `${helpful}% of the latest ${items.length} rated answers were marked helpful.`} onClose={() => setOpen(false)} className="ai-feedback-dialog">
      {error && <p className="module-error" role="alert">{error}</p>}
      <div className="ai-feedback-filter" role="group" aria-label="Which ratings to show">
        <button type="button" aria-pressed={show === 'down'} onClick={() => setShow('down')}>Not helpful ({down})</button>
        <button type="button" aria-pressed={show === 'all'} onClick={() => setShow('all')}>All ({items.length})</button>
      </div>
      {!shown.length && !error && <p className="studio-muted">{show === 'down' ? 'Nothing marked not helpful.' : 'No ratings yet.'}</p>}
      <ul className="ai-feedback-list">
        {shown.map(item => <li key={item.id}>
          <p className="ai-feedback-meta">{item.rating === 'up' ? <ThumbsUp size={13} /> : <ThumbsDown size={13} />}<span>{item.source || 'Unknown source'}</span>{item.createdAt && <time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })}</time>}</p>
          <p className="ai-feedback-question">{item.question || '(question not saved)'}</p>
          <p className="ai-feedback-answer">{item.answer}</p>
          {item.references.length > 0 && <p className="studio-muted">Checked: {item.references.join(' · ')}</p>}
          {item.note && <p className="ai-feedback-note">{item.note}</p>}
          <button type="button" className="chat-text-link" onClick={() => { void dismissFeedback(item.id).then(() => showToast('Marked as reviewed.', 'success')).catch(() => showToast('Could not update this rating.', 'error')); }}>Reviewed</button>
        </li>)}
      </ul>
    </Modal>
  </>;
}
