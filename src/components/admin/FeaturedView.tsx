import React from 'react';
import { Tournament } from '../../lib/types';
import { firestoreService } from '../../lib/firestore';
import { useToast } from '../ui/Toast';
import { mlbbBanner, valorantBanner, lolBanner } from '../../lib/mockData';
import { Star } from '../ui/Icons';

interface FeaturedViewProps {
  tournaments: Tournament[];
}

export const FeaturedView: React.FC<FeaturedViewProps> = ({ tournaments }) => {
  const { showToast } = useToast();
  const highlights = firestoreService.getFeaturedHighlights();
  const posts = firestoreService.getFeaturedPosts();

  const handleToggleTournament = async (id: string, title: string) => {
    try { await firestoreService.toggleFeatureTournament(id);
    showToast(`Toggled feature status for "${title}"`, 'info');
    } catch (error) { showToast(error instanceof Error ? error.message : 'The shared spotlight could not be saved.', 'error'); }
  };

  const handleToggleHighlight = async (id: string, title: string) => {
    try { await firestoreService.toggleFeatureHighlight(id);
    showToast(`Toggled highlight feature for "${title}"`, 'info');
    } catch (error) { showToast(error instanceof Error ? error.message : 'The shared spotlight could not be saved.', 'error'); }
  };

  const handleTogglePost = async (id: string, title: string) => {
    try { await firestoreService.toggleFeaturePost(id);
    showToast(`Toggled post feature for "${title}"`, 'info');
    } catch (error) { showToast(error instanceof Error ? error.message : 'The shared spotlight could not be saved.', 'error'); }
  };

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Tournaments Section */}
      <section className="rounded-[4px] bg-[#222222] border border-[#333333] p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-heading font-bold text-white tracking-tight">
            Tournaments
          </h3>
          <span className="text-xs text-[#888888]">
            {tournaments.filter((t) => t.isFeatured).length} featured on Home
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {tournaments.slice(0, 2).map((t) => (
            <div
              key={t.id}
              className={`rounded-[4px] bg-[#1A1A1A] border p-4 space-y-3 transition-colors ${
                t.isFeatured ? 'border-[#ff6600]/60' : 'border-[#2D2D2D]'
              }`}
            >
              <div className="h-36 rounded-[4px] overflow-hidden relative">
                <img
                  src={t.bannerImage}
                  alt={t.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>

              <div>
                <span className="text-sm font-semibold text-white block">
                  {t.title} — {t.gameName}
                </span>
                <span className="text-[11px] text-[#888888]">
                  {t.collegesCount} colleges · {t.format.replace('-', ' ')}
                </span>
              </div>

              <button
                onClick={() => handleToggleTournament(t.id, t.title)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] text-xs font-semibold transition-colors cursor-pointer ${
                  t.isFeatured
                    ? 'bg-[#ff6600] text-black shadow-sm'
                    : 'bg-[#222222] hover:bg-[#282828] text-white border border-[#3A3A3A]'
                }`}
              >
                <Star className={`w-3.5 h-3.5 ${t.isFeatured ? 'fill-black' : ''}`} />
                <span>{t.isFeatured ? 'Featured' : 'Feature'}</span>
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Highlights Section */}
      <section className="rounded-[4px] bg-[#222222] border border-[#333333] p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-heading font-bold text-white tracking-tight">
            Highlights
          </h3>
          <span className="text-xs text-[#888888]">
            {highlights.filter((h) => h.isFeatured).length} featured on Home
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {highlights.map((h, i) => (
            <div
              key={h.id}
              className={`rounded-[4px] bg-[#1A1A1A] border p-4 space-y-3 transition-colors ${
                h.isFeatured ? 'border-[#ff6600]/60' : 'border-[#2D2D2D]'
              }`}
            >
              <div className="h-36 rounded-[4px] overflow-hidden relative">
                <img
                  src={i === 0 ? mlbbBanner : valorantBanner}
                  alt={h.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>

              <div>
                <span className="text-sm font-semibold text-white block">
                  {h.title}
                </span>
                <span className="text-[11px] text-[#888888]">{h.meta}</span>
              </div>

              <button
                onClick={() => handleToggleHighlight(h.id, h.title)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] text-xs font-semibold transition-colors cursor-pointer ${
                  h.isFeatured
                    ? 'bg-[#ff6600] text-black shadow-sm'
                    : 'bg-[#222222] hover:bg-[#282828] text-white border border-[#3A3A3A]'
                }`}
              >
                <Star className={`w-3.5 h-3.5 ${h.isFeatured ? 'fill-black' : ''}`} />
                <span>{h.isFeatured ? 'Featured' : 'Feature'}</span>
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Posts Section */}
      <section className="rounded-[4px] bg-[#222222] border border-[#333333] p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-heading font-bold text-white tracking-tight">
            Posts
          </h3>
          <span className="text-xs text-[#888888]">
            {posts.filter((p) => p.isFeatured).length} featured on Home
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {posts.map((p) => (
            <div
              key={p.id}
              className={`rounded-[4px] bg-[#1A1A1A] border p-4 space-y-3 transition-colors ${
                p.isFeatured ? 'border-[#ff6600]/60' : 'border-[#2D2D2D]'
              }`}
            >
              <div className="h-36 rounded-[4px] overflow-hidden relative">
                <img
                  src={lolBanner}
                  alt={p.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>

              <div>
                <span className="text-sm font-semibold text-white block">
                  {p.title}
                </span>
                <span className="text-[11px] text-[#888888]">{p.meta}</span>
              </div>

              <button
                onClick={() => handleTogglePost(p.id, p.title)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] text-xs font-semibold transition-colors cursor-pointer ${
                  p.isFeatured
                    ? 'bg-[#ff6600] text-black shadow-sm'
                    : 'bg-[#222222] hover:bg-[#282828] text-white border border-[#3A3A3A]'
                }`}
              >
                <Star className={`w-3.5 h-3.5 ${p.isFeatured ? 'fill-black' : ''}`} />
                <span>{p.isFeatured ? 'Featured' : 'Feature'}</span>
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
