import React, { useEffect, useState } from 'react';
import type { Match, User } from '../../../lib/types';
import { broadcastPlatformLabel, canBroadcastMatch, embeddedBroadcastSource, isWatchableLiveMatch, preferredMatchBroadcast, safeThumbnailUrl } from '../../../lib/streamUtils';
import { uploadBroadcastThumbnail } from '../../../lib/thumbnailUpload';
import { bracketScheduleLabel } from '../../../lib/calendar';
import { errorMessage } from '../../../lib/errors';
import { matchName } from '../../../lib/matchName';
import { workspaceHref } from '../../../lib/navigation';
import { BroadcastPlayer } from '../../common/BroadcastPlayer';
import { matchTitle } from '../../common/MatchPicker';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { Req } from '../../ui/Req';
import { ArrowRight, Eye, Link2, LoaderCircle, Radio, Upload } from '../../ui/Icons';
import { Modal } from '../../ui/Modal';
import { LiveChatPanel } from '../../spectator/LiveChatPanel';
import { useBroadcastDraft } from './broadcastDraft';
import './broadcastWizard.css';

export function BroadcastWizard({ userId, currentUser, selected, artwork, bracketTitle, open, onClose, onConnect, children }: {
  userId: string;
  currentUser?: User;
  selected: Match;
  artwork?: string;
  bracketTitle: string;
  open: boolean;
  onClose: () => void;
  onConnect: (input: { url: string; title: string; thumbnailUrl: string }) => Promise<void>;
  children?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const { draft, hasDraft, edit, discard } = useBroadcastDraft(userId, selected.id);
  const url = draft.url ?? preferredMatchBroadcast(selected)?.url ?? '';
  const title = draft.title ?? selected.streamTitle ?? matchTitle(selected);
  const source = embeddedBroadcastSource(url);
  const sourceUrl = source?.url;
  const invalidLink = Boolean(url.trim() && !source);
  const savedThumbnail = selected.thumbnail?.source === 'custom' ? selected.thumbnail.url : undefined;
  const thumbnail = safeThumbnailUrl(draft.customThumb ?? savedThumbnail) ?? '';
  const onAir = isWatchableLiveMatch(selected);
  const disabled = busy || uploading || !canBroadcastMatch(selected);
  const previewing = open && source && previewUrl === source.url;

  useEffect(() => {
    if (!open || !sourceUrl) {
      setPreviewUrl('');
      return;
    }
    // Equivalent watch links share one iframe. Wait briefly before loading a different stream as the URL is typed.
    const timer = window.setTimeout(() => setPreviewUrl(sourceUrl), 350);
    return () => window.clearTimeout(timer);
  }, [open, sourceUrl]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!source || !thumbnail || disabled) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await onConnect({ url: source.url, title: title.trim() || matchTitle(selected), thumbnailUrl: thumbnail });
      discard(true);
      setNotice(onAir ? 'Broadcast changes saved.' : 'Match is on air in ArenaHub.');
    } catch (problem) {
      setError(errorMessage(problem, 'The broadcast could not be published.'));
    } finally {
      setBusy(false);
    }
  }

  async function chooseFile(file?: File) {
    if (!file || disabled) return;
    setUploading(true);
    setError('');
    setNotice('');
    try { edit({ customThumb: await uploadBroadcastThumbnail(selected.id, file) }); }
    catch (problem) { setError(errorMessage(problem, 'The thumbnail could not be uploaded.')); }
    finally { setUploading(false); }
  }

  return <>
    <Modal open={open} title="Set up a broadcast" description={bracketTitle} className="broadcast-setup-dialog"
      busy={busy || uploading} onClose={() => { setPreviewUrl(''); setError(''); setNotice(''); onClose(); }}>
      <form className="bw bw-modal" onSubmit={event => void submit(event)} noValidate>
        <div className="bw-summary">
          <span className={`bw-summary-dot${onAir ? ' is-live' : ''}`} aria-hidden="true" />
          <span className="bw-summary-text"><strong>{matchTitle(selected)}</strong><small>{[matchName(selected), selected.roundName, bracketScheduleLabel(selected)].filter(Boolean).join(' · ')}</small></span>
          <span className={`desk-pill ${onAir ? 'is-live' : 'is-off'}`}>{onAir ? 'On air' : selected.status === 'completed' ? 'Ended' : selected.status === 'live' ? 'Link needed' : selected.status === 'pre-match' ? 'Paused' : 'Off air'}</span>
        </div>

        <div className="bw-setup-grid">
          <div className="bw-link-fields">
            <label className="bw-field"><Req>Live link</Req>
              <span className={`bw-url is-${source ? 'ok' : invalidLink ? 'bad' : 'empty'}`}>
                <Link2 size={18} aria-hidden="true" />
                <input id="broadcast-live-link" type="url" value={url} maxLength={2000} autoComplete="off" disabled={disabled} required
                  onChange={event => { edit({ url: event.target.value }); setError(''); setNotice(''); }}
                  placeholder="https://…" aria-invalid={invalidLink} aria-describedby="bw-url-state" />
              </span>
            </label>
            <p id="bw-url-state" className={invalidLink ? 'field-error' : 'field-hint'} role={invalidLink ? 'status' : undefined}>
              {invalidLink ? 'Use a public YouTube or Facebook video link that can play in ArenaHub.'
                : source ? `${broadcastPlatformLabel(source)} · Plays in ArenaHub`
                : 'Paste a public YouTube or Facebook live video link.'}
            </p>
          </div>
          <section className="bw-preview" aria-label="Broadcast preview">
            {previewing ? <BroadcastPlayer match={{ ...selected, streamUrl: source.embedUrl, broadcastLinks: undefined }} preview />
              : <div className="bw-preview-placeholder">
                {artwork && <img src={artwork} alt="" />}
                <span><Eye size={22} aria-hidden="true" /><strong>{source ? 'Opening preview…' : 'Preview appears when you paste a link'}</strong></span>
              </div>}
          </section>

          <div className="bw-details-fields">
            <div className="bw-field">
              <Req>Thumbnail</Req>
              <label className="bw-thumbnail-upload">
                {thumbnail && <img src={thumbnail} alt="" />}
                <span><Upload size={16} aria-hidden="true" />{uploading ? 'Uploading…' : thumbnail ? 'Replace thumbnail' : 'Upload thumbnail'}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={disabled}
                  aria-label={thumbnail ? 'Replace thumbnail' : 'Upload thumbnail'} aria-required={!thumbnail} aria-describedby="bw-thumbnail-hint"
                  onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void chooseFile(file); }} />
              </label>
              <p id="bw-thumbnail-hint" className="field-hint">{thumbnail ? 'Thumbnail added.' : 'PNG, JPEG or WebP. A wide image works best.'}</p>
            </div>

            <label className="bw-field"><Req>Broadcast title</Req><input type="text" value={title} maxLength={160} disabled={disabled} onChange={event => { edit({ title: event.target.value }); setNotice(''); }} /></label>
          </div>
        </div>

        {children}
        {notice && <p className="settings-notice" role="status">{notice}</p>}
        {error && <p className="module-error" role="alert">{error}</p>}
        <div className="bw-publish-actions">
          {hasDraft && <button type="button" className="arena-text-button bw-discard" disabled={disabled} onClick={() => setDiscardOpen(true)}>Discard draft</button>}
          {onAir && <a className="arena-outline" href={workspaceHref('arena', 'live', { match: selected.id })}>Viewer page <ArrowRight size={15} aria-hidden="true" /></a>}
          <button type="submit" className="arena-primary" disabled={disabled || !source || !thumbnail}>
            {busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Radio size={16} aria-hidden="true" />}
            {busy ? (onAir ? 'Saving…' : 'Going live…') : onAir ? 'Save broadcast' : 'Go live'}
          </button>
        </div>
      </form>
    </Modal>
    <ConfirmModal isOpen={discardOpen} title="Discard broadcast draft?"
      description="This clears your unsaved broadcast edits for this match." confirmLabel="Discard draft" isDestructive
      onConfirm={() => { discard(); setDiscardOpen(false); setError(''); setNotice(''); }} onCancel={() => setDiscardOpen(false)} />
  </>;
}
