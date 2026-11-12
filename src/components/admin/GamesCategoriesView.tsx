import React, { useState, useRef } from 'react';
import { GameTitle } from '../../lib/types';
import { firestoreService } from '../../lib/firestore';
import { useToast } from '../ui/Toast';
import { Modal } from '../ui/Modal';
import { ConfirmModal } from '../ui/ConfirmModal';
import { mlbbBanner } from '../../lib/mockData';
import { RANK_GAMES } from '../../lib/gameRanks';
import {
  Plus,
  Image as ImageIcon,
  Edit2,
  Trash2,
  X,
  Upload,
  Link as LinkIcon,
  Gamepad2,
  AlertTriangle,
  Eye,
  Check,
} from '../ui/Icons';

interface GamesCategoriesViewProps {
  games: GameTitle[];
  categories?: string[];
}

const PRESET_BANNERS = RANK_GAMES.map(game=>({name:game.name,url:game.image}));

export const GamesCategoriesView: React.FC<GamesCategoriesViewProps> = ({ games }) => {
  const { showToast } = useToast();

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGameId, setEditingGameId] = useState<string | null>(null);

  // Form State
  const [gameName, setGameName] = useState('');
  const [formError, setFormError] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [visibility, setVisibility] = useState<'Show everywhere' | 'Tournaments only' | 'Hidden'>(
    'Show everywhere'
  );

  // Delete Confirmation State
  const [gameToDelete, setGameToDelete] = useState<GameTitle | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const openAddModal = () => {
    setFormError('');
    setEditingGameId(null);
    setGameName('');
    setBannerUrl(mlbbBanner);
    setVisibility('Show everywhere');
    setIsModalOpen(true);
  };

  const openEditModal = (game: GameTitle) => {
    setFormError('');
    setEditingGameId(game.id);
    setGameName(game.name);
    setBannerUrl(game.bannerImage);
    setVisibility((game.visibility as any) || 'Show everywhere');
    setIsModalOpen(true);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { setFormError('Choose a PNG, JPEG, WebP, or GIF image.'); return; }
    if (file.size > 2 * 1024 * 1024) {
      setFormError('Choose an image smaller than 2MB for browser storage.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        setBannerUrl(result);
        showToast('Game banner uploaded successfully', 'success');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveGame = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (gameName.trim().length < 2 || gameName.trim().length > 80) {
      setFormError('Use a game name between 2 and 80 characters.');
      return;
    }

    if (games.some(g => g.id !== editingGameId && g.name.toLowerCase() === gameName.trim().toLowerCase())) {
      setFormError('A game with this name already exists.'); return;
    }
    const finalBanner = bannerUrl.trim() || mlbbBanner;
    if (!/^https:\/\/[^\s]+$/i.test(finalBanner) && !/^\/(src\/assets\/images|assets)\//.test(finalBanner) && !/^data:image\/(png|jpeg|webp|gif);base64,/.test(finalBanner)) {
      setFormError('Choose a preset, upload an image, or enter an HTTPS image link.'); return;
    }

    try {
    if (editingGameId) {
      // Update existing game
      const existing = games.find((g) => g.id === editingGameId);
      if (existing) {
        const updated: GameTitle = {
          ...existing,
          name: gameName.trim(),
          bannerImage: finalBanner,
          visibility,
        };
        await firestoreService.updateGame(updated);
        showToast(`Updated "${gameName}" successfully`, 'success');
      }
    } else {
      // Add new game
      const newGame: GameTitle = {
        id: `game-${Date.now()}`,
        name: gameName.trim(),
        registeredTeams: 0,
        visibility,
        bannerImage: finalBanner,
        category: 'Esports',
      };
      await firestoreService.addGame(newGame);
      showToast(`Added "${newGame.name}" to the shared games list`, 'success');
    }

    setIsModalOpen(false);
    } catch (error) { setFormError(error instanceof Error ? error.message : 'The shared game settings could not be saved.'); }
  };

  const confirmDeleteGame = async () => {
    if (!gameToDelete) return;
    try {
    await firestoreService.removeGame(gameToDelete.id);
    showToast(`Removed "${gameToDelete.name}" from games list`, 'info');
    setGameToDelete(null);
    } catch (error) { showToast(error instanceof Error ? error.message : 'The game could not be removed.', 'error'); }
  };

  return (
    <div className="space-y-6">
      {/* Top Section Header with Prominent + Add Game Button */}
      <div className="bg-[#222222] border border-[#333333] rounded-[6px] p-6 shadow-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-heading font-black text-white tracking-tight">
              Games Management
            </h2>
            <span className="px-2 py-0.5 rounded-[4px] bg-[#ff6600]/15 border border-[#ff6600]/30 text-xs font-mono font-bold text-[#ff6600]">
              {games.length} Titles
            </span>
          </div>
          <p className="text-xs text-[#888888] mt-1">
            Titles available when creating tournaments, brackets, and team registrations.
          </p>
        </div>

        {/* Primary + Add Game Button */}
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 px-4 py-2.5 rounded-[4px] bg-[#ff6600] hover:bg-[#ff8533] text-black font-semibold text-xs transition-all shadow-md shadow-[#ff6600]/10 cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>Add Game</span>
        </button>
      </div>

      {/* Games Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {games.map((g) => (
          <div
            key={g.id}
            className="p-4 rounded-[6px] bg-[#222222] border border-[#333333] hover:border-[#444444] transition-all flex items-center justify-between gap-4 shadow-md group"
          >
            {/* Game Thumbnail & Details */}
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-16 h-16 rounded-[4px] overflow-hidden bg-[#161616] border border-[#363636] shrink-0 relative flex items-center justify-center">
                <img
                  src={g.bannerImage}
                  alt={g.name}
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    // Fallback to stylized gamepad placeholder if image fails to load
                    e.currentTarget.style.display = 'none';
                    e.currentTarget.parentElement?.classList.add('bg-gradient-to-br', 'from-[#2A2A2A]', 'to-[#1E1E1E]');
                  }}
                  className="w-full h-full object-cover"
                />
                <Gamepad2 className="w-6 h-6 text-[#555555] absolute" />
              </div>

              <div className="min-w-0">
                <h3 className="text-sm font-heading font-bold text-white truncate group-hover:text-[#ff6600] transition-colors">
                  {g.name}
                </h3>
                <span className="text-xs text-[#888888] block mt-0.5">
                  {g.registeredTeams} registered teams
                </span>
                <span className="inline-block mt-1 px-2 py-0.5 rounded-[3px] bg-[#1A1A1A] border border-[#2E2E2E] text-[10px] text-[#AAAAAA] font-mono">
                  {g.visibility}
                </span>
              </div>
            </div>

            {/* Actions: Edit & Remove */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => openEditModal(g)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-[4px] bg-[#1E1E1E] hover:bg-[#2A2A2A] border border-[#333333] text-xs font-medium text-[#CCCCCC] hover:text-white transition-colors cursor-pointer"
                title={`Edit ${g.name}`}
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Edit</span>
              </button>

              <button
                onClick={() => setGameToDelete(g)}
                className="p-1.5 rounded-[4px] bg-[#1E1E1E] hover:bg-[#E8544B]/15 border border-[#333333] hover:border-[#E8544B]/40 text-[#888888] hover:text-[#E8544B] transition-colors cursor-pointer"
                title={`Remove ${g.name}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}

        {games.length === 0 && (
          <div className="col-span-full p-12 bg-[#222222] border border-[#333333] rounded-[6px] text-center space-y-3">
            <Gamepad2 className="w-10 h-10 text-[#555555] mx-auto" />
            <h3 className="text-sm font-bold text-white">No game titles configured</h3>
            <p className="text-xs text-[#888888]">
              Click the "+ Add Game" button above to register an esports title.
            </p>
          </div>
        )}
      </div>

      {/* POP-UP MODAL: Add / Edit Game */}
      <Modal open={isModalOpen} title={editingGameId ? 'Edit Game Title' : 'Add New Game Title'} description="Configure a game in this browser’s sample workspace." onClose={() => setIsModalOpen(false)}>
            <form onSubmit={handleSaveGame} className="space-y-5">
              {formError && <p role="alert" className="module-error">{formError}</p>}
              {/* Game Name */}
              <div>
                <label htmlFor="game-name" className="block text-xs font-semibold text-[#CCCCCC] uppercase tracking-wider mb-2">
                  Game Name <span className="text-[#ff6600]">*</span>
                </label>
                <input
                  id="game-name" type="text" minLength={2} maxLength={80}
                  required
                  value={gameName}
                  onChange={(e) => setGameName(e.target.value)}
                  placeholder="e.g., Tekken 8, Mobile Legends, Valorant"
                  className="w-full bg-[#161616] border border-[#333333] focus:border-[#ff6600] rounded-[4px] px-3.5 py-2.5 text-sm text-white placeholder-[#555555] outline-hidden transition-colors"
                />
              </div>

              {/* Game Picture / Banner Selection */}
              <div>
                <label className="block text-xs font-semibold text-[#CCCCCC] uppercase tracking-wider mb-2">
                  Game Banner Picture
                </label>

                {/* Banner Live Preview Box */}
                <div className="relative w-full h-32 rounded-[6px] overflow-hidden bg-[#161616] border border-[#383838] mb-3 flex items-center justify-center">
                  {bannerUrl ? (
                    <img
                      src={bannerUrl}
                      alt="Banner Preview"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 text-[#666666]">
                      <ImageIcon className="w-8 h-8" />
                      <span className="text-xs">No picture selected</span>
                    </div>
                  )}

                  {bannerUrl && (
                    <div className="absolute top-2 right-2 px-2 py-0.5 rounded-[3px] bg-black/60 text-[10px] text-white font-mono flex items-center gap-1 backdrop-blur-xs">
                      <Check className="w-3 h-3 text-[#3DD68C]" />
                      Preview
                    </div>
                  )}
                </div>

                {/* Image Upload & URL input controls */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {/* Hidden file input */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={handleFileUpload}
                      className="hidden"
                    />

                    {/* Choose Local File Button */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-[4px] bg-[#2A2A2A] hover:bg-[#333333] border border-[#3D3D3D] text-xs font-semibold text-white transition-colors cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-[#ff6600]" />
                      <span>Upload Picture from Computer</span>
                    </button>
                  </div>

                  {/* Or Image Link input */}
                  <div className="relative">
                    <input
                      type="text" aria-label="Game banner image link"
                      value={bannerUrl}
                      onChange={(e) => setBannerUrl(e.target.value)}
                      placeholder="Or paste an image web link (URL)"
                      className="w-full bg-[#161616] border border-[#333333] focus:border-[#ff6600] rounded-[4px] pl-8 pr-3 py-2 text-xs text-white placeholder-[#555555] outline-hidden transition-colors"
                    />
                    <LinkIcon className="w-3.5 h-3.5 text-[#666666] absolute left-2.5 top-2.5" />
                  </div>
                </div>

                {/* Quick Preset Banners */}
                <div className="mt-3">
                  <span className="text-[11px] text-[#777777] block mb-1.5">
                    Or select an esports preset:
                  </span>
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {PRESET_BANNERS.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => {
                          setBannerUrl(preset.url);
                          showToast(`Selected preset for ${preset.name}`, 'info');
                        }}
                        className={`group relative rounded-[4px] overflow-hidden border shrink-0 transition-all cursor-pointer ${
                          bannerUrl === preset.url
                            ? 'border-[#ff6600] ring-1 ring-[#ff6600]'
                            : 'border-[#333333] hover:border-[#555555]'
                        }`}
                        title={preset.name}
                      >
                        <img
                          src={preset.url}
                          alt={preset.name}
                          className="w-14 h-9 object-cover"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Visibility Options */}
              <div>
                <label className="block text-xs font-semibold text-[#CCCCCC] uppercase tracking-wider mb-2">
                  Tournament Visibility
                </label>
                <select aria-label="Tournament visibility"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as any)}
                  className="w-full bg-[#161616] border border-[#333333] focus:border-[#ff6600] rounded-[4px] px-3.5 py-2 text-xs text-white outline-hidden cursor-pointer"
                >
                  <option value="Show everywhere">Show everywhere (All Brackets & Teams)</option>
                  <option value="Tournaments only">Tournaments only</option>
                  <option value="Hidden">Hidden (Draft / Off-season)</option>
                </select>
              </div>

              {/* Modal Action Buttons */}
              <div className="pt-4 border-t border-[#2C2C2C] flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-[4px] bg-[#2A2A2A] hover:bg-[#333333] text-xs font-semibold text-[#CCCCCC] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-[4px] bg-[#ff6600] hover:bg-[#ff8533] text-xs font-bold text-black transition-colors cursor-pointer shadow-md shadow-[#ff6600]/10"
                >
                  {editingGameId ? 'Save Changes' : 'Add Game'}
                </button>
              </div>
            </form>
      </Modal>

      {/* POP-UP MODAL: Confirm Game Removal */}
      <ConfirmModal isOpen={Boolean(gameToDelete)} title="Remove Game Title?" description={`Remove ${gameToDelete?.name || 'this game'} from this browser’s sample games list?`} confirmLabel="Yes, Remove" isDestructive onConfirm={confirmDeleteGame} onCancel={() => setGameToDelete(null)} />
    </div>
  );
};
