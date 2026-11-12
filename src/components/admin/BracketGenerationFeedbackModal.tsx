import React from 'react';
import { GitBranch, Layers, Trophy, Users, Zap } from '../ui/Icons';
import valorantArt from '../../assets/images/valorant_official.jpg';
import leagueArt from '../../assets/images/lol_real_banner.jpg';
import venueArt from '../../assets/images/wmsu_gym_bg_1791620796788.jpg';
import { Modal } from '../ui/Modal';
import { BracketDraft, ExtractedTeam } from '../../lib/types';

export interface GenerationFeedbackData {
  source: 'ai' | 'csv';
  draft: BracketDraft;
  teams: ExtractedTeam[];
  teamCount: number;
  treeSize: number;
  byesCount: number;
  format: string;
  matchFormat: string;
  explanation: string;
  fileName?: string;
}

const bracketArtwork = [
  { match: /mobile legends|\bmlbb\b/i, src: '/fairplay-mlbb.webp' },
  { match: /dota[ -]?2/i, src: '/fairplay-dota2.jpg' },
  { match: /call of duty|\bcodm\b/i, src: '/fairplay-codm.webp' },
  { match: /\bvalorant\b/i, src: valorantArt },
  { match: /league of legends|\blol\b/i, src: leagueArt },
];

interface BracketGenerationFeedbackModalProps {
  isOpen: boolean;
  data: GenerationFeedbackData | null;
  onClose: () => void;
  onConfirmAndLoad: (draft: BracketDraft) => void;
  onSaveAndPublishLive: (draft: BracketDraft) => void;
}

export const BracketGenerationFeedbackModal: React.FC<BracketGenerationFeedbackModalProps> = ({
  isOpen,
  data,
  onClose,
  onConfirmAndLoad,
  onSaveAndPublishLive,
}) => {
  const byeTeams = new Set(
    data?.draft.matches.filter(match => match.round === 1 && (
      match.team1?.isBye || match.team1?.name === 'BYE' ||
      match.team2?.isBye || match.team2?.name === 'BYE'
    )).flatMap(match => [match.team1, match.team2]
      .filter(team => team && !team.isBye && team.name !== 'BYE')
      .map(team => team?.name)) ?? []
  );
  const seriesFormats = [...new Set(data?.draft.matches.map(match => match.matchFormat))].join(', ');

  const artwork = bracketArtwork.find(art => art.match.test(data?.draft.gameName ?? ''))
    ?? bracketArtwork.find(art => art.match.test(data?.draft.title ?? ''));

  return (
    <Modal
      open={isOpen && Boolean(data)}
      title="Bracket details"
      description={data?.draft.title || 'Tournament bracket'}
      className="studio-details"
      onClose={onClose}
    >
      {data && <>
        <div className="studio-details-body">
          <section className="studio-details-hero">
            <img src={artwork?.src ?? venueArt} alt="" />
            <div>
              <span><Trophy size={16} aria-hidden="true" /> Bracket summary</span>
              <h3>{data.format}</h3>
              {data.fileName && <p>Imported from {data.fileName}</p>}
            </div>
          </section>

          <dl className="studio-details-metrics">
            <div data-tone="orange"><dt><Users size={17} aria-hidden="true" /> Teams</dt><dd>{data.teamCount}</dd></div>
            <div data-tone="blue"><dt><GitBranch size={17} aria-hidden="true" /> Bracket slots</dt><dd>{data.treeSize}</dd></div>
            <div data-tone="green"><dt><Zap size={17} aria-hidden="true" /> Opening-round BYEs</dt><dd>{byeTeams.size}</dd></div>
            <div data-tone="orange"><dt><Layers size={17} aria-hidden="true" /> Series formats</dt><dd>{seriesFormats || data.matchFormat}</dd></div>
          </dl>

          {data.explanation && <p className="studio-muted">{data.explanation}</p>}

          <section>
            <h3 className="studio-label studio-details-heading"><Users size={17} aria-hidden="true" /> Team seeding</h3>
            <p className="studio-muted">
              {byeTeams.size ? 'Teams marked BYE advance automatically. You can change a BYE in Match details.' : 'No opening-round BYEs.'}
            </p>
            <ol className="studio-details-roster">
              {data.teams.map((team, index) => (
                <li key={index}>
                  <span className="studio-details-seed">#{team.seed || index + 1}</span>
                  <div className="min-w-0">
                    <strong>{team.name}</strong>
                    {team.college && <small>{team.college}</small>}
                  </div>
                  {byeTeams.has(team.name) && <span className="studio-details-bye"><Zap size={12} aria-hidden="true" /> BYE</span>}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="studio-publish-actions">
          <button type="button" className="arena-outline" onClick={onClose}>Cancel</button>
          <button type="button" className="arena-outline" onClick={() => onConfirmAndLoad(data.draft)}>Load bracket</button>
          <button type="button" className="arena-primary" onClick={() => onSaveAndPublishLive(data.draft)}>Review and publish</button>
        </div>
      </>}
    </Modal>
  );
};
