import React, { useState } from 'react';
import { Tournament } from '../../lib/types';
import { firestoreService } from '../../lib/firestore';
import { useToast } from '../ui/Toast';
import { Link as LinkIcon, Plus, Star, Trash2 as Trash } from '../ui/Icons';
import { Req } from '../ui/Req';
import { errorMessage } from '../../lib/errors';

interface FeaturedViewProps {
  tournaments: Tournament[];
}

type Kind = 'highlight' | 'post';
const card = 'rounded-[4px] bg-(--surface) border p-4 space-y-3 transition-colors';
const toggleClass = (on: boolean) => `flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] text-xs font-semibold transition-colors cursor-pointer ${on ? 'bg-(--brand) text-black shadow-sm' : 'bg-(--surface-soft) hover:bg-(--surface-elevated) text-white border border-(--border-strong)'}`;

export const FeaturedView: React.FC<FeaturedViewProps> = ({ tournaments }) => {
  const { showToast } = useToast();
  const items = [
    ...firestoreService.getFeaturedHighlights().map(item => ({ ...item, kind: 'highlight' as Kind })),
    ...firestoreService.getFeaturedPosts().map(item => ({ ...item, kind: 'post' as Kind })),
  ];
  const [form, setForm] = useState({ kind: 'highlight' as Kind, title: '', link: '', author: '' });
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const run = async (work: () => Promise<void>, success: string) => {
    try { await work(); showToast(success, 'success'); }
    catch (error) { showToast(errorMessage(error, 'The spotlight change could not be saved.'), 'error'); }
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    await run(async () => {
      await firestoreService.addFeaturedItem(form.kind, form);
      setForm(current => ({ ...current, title: '', link: '' }));
    }, 'Spotlight item added. Turn on Feature to show it on Home.');
    setBusy(false);
  };

  return (
    <div className="space-y-8 max-w-6xl">
      <section className="rounded-[4px] bg-(--surface-soft) border border-(--border) p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-heading font-bold text-(--text-primary) tracking-tight">Tournaments</h3>
          <span className="text-xs text-(--text-muted)">{tournaments.filter(t => t.isFeatured).length} featured on Home</span>
        </div>
        {!tournaments.length ? <p className="text-sm text-(--text-secondary)">No published tournaments yet. Publish a bracket in Bracket Studio, then feature it here.</p> :
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {tournaments.map(t => (
              <div key={t.id} className={`${card} ${t.isFeatured ? 'border-(--brand)/60' : 'border-(--border)'}`}>
                {t.bannerImage && <div className="h-36 rounded-[4px] overflow-hidden relative"><img src={t.bannerImage} alt="" className="w-full h-full object-cover" /></div>}
                <div>
                  <span className="text-sm font-semibold text-(--text-primary) block">{t.title} · {t.gameName}</span>
                  <span className="text-xs text-(--text-muted)">{t.collegesCount} colleges · {t.format.replace('-', ' ')}</span>
                </div>
                <button onClick={() => run(() => firestoreService.toggleFeatureTournament(t.id), `${t.isFeatured ? 'Removed' : 'Featured'} "${t.title}" on Home.`)} className={toggleClass(t.isFeatured)}>
                  <Star className={`w-3.5 h-3.5 ${t.isFeatured ? 'fill-black' : ''}`} /><span>{t.isFeatured ? 'Featured' : 'Feature'}</span>
                </button>
              </div>
            ))}
          </div>}
      </section>

      <section className="rounded-[4px] bg-(--surface-soft) border border-(--border) p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-heading font-bold text-(--text-primary) tracking-tight">Highlights and posts</h3>
          <span className="text-xs text-(--text-muted)">{items.filter(i => i.isFeatured).length} featured on Home</span>
        </div>
        <form onSubmit={add} className="grid grid-cols-1 md:grid-cols-[140px_1fr_1fr_1fr_auto] gap-3 mb-6 items-end">
          <label className="text-xs text-(--text-secondary) flex flex-col gap-1">Type
            <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as Kind })} className="bg-(--surface) border border-(--border-strong) rounded-[4px] px-2 py-2 text-(--text-primary) text-sm">
              <option value="highlight">Clip</option><option value="post">Post</option>
            </select>
          </label>
          <label className="text-xs text-(--text-secondary) flex flex-col gap-1"><Req>Title</Req>
            <input required minLength={3} maxLength={120} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="bg-(--surface) border border-(--border-strong) rounded-[4px] px-2 py-2 text-(--text-primary) text-sm" />
          </label>
          <label className="text-xs text-(--text-secondary) flex flex-col gap-1"><Req>Link (https)</Req>
            <input required type="url" value={form.link} onChange={e => setForm({ ...form, link: e.target.value })} placeholder="https://" className="bg-(--surface) border border-(--border-strong) rounded-[4px] px-2 py-2 text-(--text-primary) text-sm" />
          </label>
          <label className="text-xs text-(--text-secondary) flex flex-col gap-1"><Req>Made or posted by</Req>
            <input required minLength={2} maxLength={80} value={form.author} onChange={e => setForm({ ...form, author: e.target.value })} className="bg-(--surface) border border-(--border-strong) rounded-[4px] px-2 py-2 text-(--text-primary) text-sm" />
          </label>
          <button type="submit" disabled={busy} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-[4px] text-xs font-semibold bg-(--text-primary) text-(--surface) disabled:opacity-60">
            <Plus className="w-3.5 h-3.5" />Add
          </button>
        </form>
        {!items.length ? <p className="text-sm text-(--text-secondary)">No clips or posts yet. Add one above with its real link and author.</p> :
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {items.map(item => (
              <div key={item.id} className={`${card} ${item.isFeatured ? 'border-(--brand)/60' : 'border-(--border)'}`}>
                <div>
                  <span className="text-xs text-(--text-muted)">{item.kind === 'post' ? 'Post' : 'Clip'}</span>
                  <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-(--text-primary) flex items-center gap-1.5 hover:underline"><LinkIcon className="w-3.5 h-3.5" />{item.title}</a>
                  <span className="text-xs text-(--text-muted)">{item.meta}</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => run(() => firestoreService.toggleFeatureHighlight(item.id), item.isFeatured ? 'Removed from Home.' : 'Featured on Home.')} className={toggleClass(item.isFeatured)}>
                    <Star className={`w-3.5 h-3.5 ${item.isFeatured ? 'fill-black' : ''}`} /><span>{item.isFeatured ? 'Featured' : 'Feature'}</span>
                  </button>
                  {confirmRemove === item.id
                    ? <><button onClick={() => { setConfirmRemove(null); void run(() => firestoreService.removeFeaturedItem(item.id), 'Spotlight item removed.'); }} className="px-3 py-1.5 rounded-[4px] text-xs font-semibold bg-(--danger) text-white">Confirm remove</button>
                      <button onClick={() => setConfirmRemove(null)} className="px-3 py-1.5 rounded-[4px] text-xs text-(--text-secondary) border border-(--border-strong)">Cancel</button></>
                    : <button onClick={() => setConfirmRemove(item.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] text-xs text-(--text-secondary) border border-(--border-strong)"><Trash className="w-3.5 h-3.5" />Remove</button>}
                </div>
              </div>
            ))}
          </div>}
      </section>
    </div>
  );
};
