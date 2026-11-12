import React, { useEffect, useId, useRef, useState } from 'react';
import { Bell, CalendarDays, Check, ClipboardList, ShieldCheck, X } from '../ui/Icons';
import { setNotificationsRead, subscribeNotifications, subscribeNotificationSources, type ArenaNotification } from '../../lib/notificationService';
import { useAuth } from '../../lib/authContext';
import { Modal } from '../ui/Modal';
import './FeatureDialogs.css';

function relativeTime(value: any) {
  const seconds = value?.seconds;
  if (!seconds) return 'Just now';
  const minutes = Math.max(0, Math.floor((Date.now() - seconds * 1000) / 60000));
  return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : new Date(seconds * 1000).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
}
export function NotificationBell({ staff = false, onNavigate }: { staff?: boolean; onNavigate: (tab: string, entityId?: string) => void }) {
  const { firebaseUser } = useAuth(), uid = firebaseUser?.uid;
  const id = useId(), panel = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<{ uid: string; item: ArenaNotification } | null>(null);
  const [items, setItems] = useState<ArenaNotification[]>([]), [filter, setFilter] = useState('all'), [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  useEffect(() => {
    setItems([]); setSelected(null); setError(''); setLoading(true);
    if (!uid) { setLoading(false); return; }
    let active = true;
    const stop = subscribeNotifications(uid, values => { if (active) { setItems(values); setLoading(false); } }, message => { if (active) { setError(message); setLoading(false); } });
    const sources = subscribeNotificationSources(uid, staff, message => { if (active) setError(message); });
    return () => { active = false; stop(); sources(); };
  }, [uid, staff]);
  const unread = items.filter(item => !item.readAt), visible = filter === 'unread' ? unread : items;
  const mark = async (ids: string[], read = true) => {
    if (!uid || !ids.length) return;
    setBusy(true); setError('');
    try { await setNotificationsRead(uid, ids, read); } catch { setError('Your read status could not be saved. Please retry.'); } finally { setBusy(false); }
  };
  const openItem = async (item: ArenaNotification) => {
    if (!item.readAt) await mark([item.id]);
    panel.current?.hidePopover(); trigger.current?.focus(); if (uid) setSelected({ uid, item });
  };
  const detail = selected && selected.uid === uid ? items.find(item => item.id === selected.item.id) || selected.item : null;
  return <div className="notification-root">
    <button ref={trigger} type="button" className={`notification-trigger ${unread.length ? 'has-unread' : ''}`} aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ''}`} popoverTarget={id} onClick={event => {
      const bounds = event.currentTarget.getBoundingClientRect(), width = Math.min(390, window.innerWidth - 24);
      if (panel.current) Object.assign(panel.current.style, { width: `${width}px`, left: `${Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12))}px`, top: `${bounds.bottom + 12}px`, maxHeight: `${window.innerHeight - bounds.bottom - 30}px` });
    }}><Bell size={21} />{unread.length > 0 && <span className="notification-count">{unread.length > 99 ? '99+' : unread.length}</span>}</button>
    <div key={uid} ref={panel} id={id} popover="auto" className="notification-popover" aria-label="Your notifications">
      <header><div><span className="section-overline">YOUR ARENA</span><h2>Notifications</h2></div><button className="quiet-icon-button" aria-label="Close notifications" onClick={() => { panel.current?.hidePopover(); trigger.current?.focus(); }}><X size={18} /></button></header>
      <div className="notification-filters"><div>{['all', 'unread'].map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All' : 'Unread'}{value === 'unread' && unread.length > 0 ? ` (${unread.length})` : ''}</button>)}</div><button className="notification-mark" disabled={busy || !unread.length} onClick={() => void mark(unread.map(item => item.id))}><Check size={14} /> Mark all read</button></div>
      {error && <p className="notification-error" role="alert">{error}</p>}
      <div className="notification-list" aria-busy={loading}>
        {loading ? <p className="notification-empty">Checking your inbox…</p> : !visible.length ? <div className="notification-empty"><Bell size={28} /><h3>{filter === 'unread' ? 'You’re all caught up.' : 'Your arena updates live here.'}</h3><p>Match updates, roster decisions, and Fair Play reviews will appear in your personal inbox.</p></div> : <><p className="notification-section-label">{filter === 'unread' ? 'Needs your attention' : 'Latest updates'}</p>{visible.map(item => {
          const Icon = item.kind === 'fair-play' ? ShieldCheck : item.kind === 'registration' || item.kind === 'check-in' ? ClipboardList : CalendarDays;
          return <article key={item.id} className={`notification-item ${item.readAt ? '' : 'is-unread'}`}>
            <button className="notification-content" onClick={() => void openItem(item)}><span className="notification-avatar"><Icon size={22} /></span><span><strong>{item.title}</strong><span className="notification-body">{item.body}</span><time dateTime={item.createdAt?.toDate?.().toISOString()}>{relativeTime(item.createdAt)}</time></span>{!item.readAt && <span className="notification-dot" aria-label="Unread" />}</button>
            <button disabled={busy} className="notification-read-toggle" aria-label={`${item.readAt ? 'Mark unread' : 'Mark read'}: ${item.title}`} title={item.readAt ? 'Mark unread' : 'Mark read'} onClick={() => void mark([item.id], !item.readAt)}>{item.readAt ? <Bell size={13} /> : <Check size={13} />}</button>
          </article>;
        })}</>}
      </div><footer>Only you can view your inbox · Latest 100 updates</footer>
    </div>
    <Modal open={!!detail} title="Your notification" onClose={() => { if (!busy) setSelected(null); }} busy={busy} className="feature-dialog">
      {detail && <div className="feature-dialog-body notification-detail"><time>{detail.createdAt?.toDate?.().toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) || 'Just now'} · Philippine time</time><h3>{detail.title}</h3><p>{detail.body}</p>{error && <p role="alert" className="field-error">{error}</p>}<div className="feature-dialog-actions"><button disabled={busy} className="arena-outline" onClick={() => void mark([detail.id], !detail.readAt)}>{detail.readAt ? 'Mark unread' : 'Mark read'}</button><button disabled={busy} className="arena-primary" onClick={() => { setSelected(null); onNavigate(detail.tab, detail.entityId); }}>Open related feature</button></div><p className="feature-privacy"><ShieldCheck size={15} /> This update belongs to your private inbox.</p></div>}
    </Modal>
  </div>;
}
