import React, { useId, useState } from 'react';
import type { Team } from '../../lib/types';
import { publicPlayerProfile, type DisplayRank, type PublicPlayerProfile } from '../../lib/playerProfiles';
import { Modal } from '../ui/Modal';
import { Check, ChevronLeft, ChevronRight, BookOpen, Building2, Swords, Users, Star } from '../ui/Icons';
import { CollegeLogo } from '../common/CollegeLogo';
import { rankGame } from '../../lib/gameRanks';
import { RankGuide } from './RankGuide';

function PlayerPhoto({ profile, className = '' }: { profile: PublicPlayerProfile; className?: string }) {
  const [failed, setFailed] = useState(false);
  const sprite = profile.isSample && profile.samplePortrait !== undefined && profile.samplePortrait >= 0 && profile.samplePortrait < 6 ? profile.samplePortrait : undefined;
  return <span className={`player-photo ${className}`} aria-hidden="true"><span className="player-photo-image">
    {!failed && (profile.avatarUrl || sprite !== undefined) ? <img src={profile.avatarUrl || '/sample-player-portraits.png'} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)}
      style={!profile.avatarUrl && sprite !== undefined ? {maxWidth:'none',width:'300%',height:'200%',left:`-${(sprite%3)*100}%`,top:`-${Math.floor(sprite/3)*100}%`} : undefined} /> : <span className="player-photo-fallback">{profile.ign.slice(0,2).toUpperCase()}</span>}
    </span>{profile.verified && <span className="player-verified" title="Roster verified"><Check size={10} /></span>}
  </span>;
}
export function RankBadge({ rank }: { rank: DisplayRank | null }) {
  const [failed, setFailed] = useState(false);
  if (!rank) return <span className="player-rank-missing">Rank not added</span>;
  return <span className="player-rank" aria-label={rank.accessibleLabel} title={rank.accessibleLabel}>
    {rank.image && !failed ? <img src={rank.image} alt="" loading="lazy" onError={() => setFailed(true)} /> : <span className="player-rank-fallback">{rank.tier}{rank.division ? ` ${rank.division}` : ''}</span>}
    {rank.value !== undefined ? <span className="player-rank-value">{rank.unit === 'stars' && <Star size={12} />}<b>{rank.value.toLocaleString('en-US')}</b>{rank.unit !== 'stars' && <small>{rank.unit}</small>}</span> : rank.image && rank.division ? <span className="player-rank-value">{rank.division}</span> : null}
  </span>;
}
export function PlayerRoster({ team }: { team: Team }) {
  const profiles = team.players.map(player => publicPlayerProfile(player,team));
  const [selected, setSelected] = useState<number | null>(null);
  const [guide,setGuide] = useState(false);
  const game=rankGame(team.gameId,team.gameMode);
  const [lastSelected, setLastSelected] = useState(0);
  const heading = useId();
  const profile = profiles[selected ?? lastSelected];
  const open = (index: number) => { if (index < 0 || index >= profiles.length) return; setLastSelected(index); setSelected(index); };
  return <section className="player-roster" aria-labelledby={heading}>
    <header className="player-roster-header">
      <CollegeLogo code={team.collegeCode || team.name.slice(0, 3)} size="md" className="mr-1" />
      <div><h3 id={heading}>{team.name}</h3><p>{team.seed > 0 ? `Seed #${team.seed} · ` : ''}{profiles.length} player{profiles.length === 1 ? '' : 's'}</p></div><span className="roster-peak-label">{profiles.length && profiles.every(p=>p.rank?.isPeak) ? 'Career highs' : 'Player ranks'}</span></header>
    {profiles.length ? <div className="roster-players">{profiles.map((player,index) => <button type="button" className="roster-player" key={player.id} aria-haspopup="dialog" aria-expanded={selected === index}
      aria-label={`View ${player.ign}'s player profile. ${player.role}. ${player.rank?.accessibleLabel || 'Rank not added'}`} onClick={() => open(index)}>
      <PlayerPhoto key={`${player.id}:${player.avatarUrl}`} profile={player} /><span className="roster-player-name"><strong>{player.ign}</strong><small>{player.role || 'Player'}</small></span>
      <RankBadge key={`${player.id}:${player.rank?.accessibleLabel}`} rank={player.rank} /><ChevronRight className="roster-player-arrow" size={17} />
    </button>)}</div> : <p className="roster-empty">The lineup hasn’t been added yet.</p>}
    {profile && <Modal open={selected !== null} title={profile.ign} description="Player profile" className="player-profile-dialog" onClose={() => setSelected(null)}>
      <div className="player-profile-identity"><PlayerPhoto key={`${profile.id}:${profile.avatarUrl}`} profile={profile} className="player-profile-photo" /><div><p className="player-full-name">{profile.fullName || 'Name not provided'}</p><span className="profile-team-label">{profile.teamName}</span>{profile.verified && <small className="profile-verified-label"><Check size={12} /> Roster verified</small>}</div></div>
      <dl className="player-profile-details"><div><dt><BookOpen size={15} /> Year level</dt><dd>{profile.yearLevel || 'Not provided'}</dd></div><div><dt><Building2 size={15} /> Department</dt><dd>{profile.department || 'Not provided'}</dd>{profile.program && <small>{profile.program}</small>}</div><div><dt><Swords size={15} /> Role</dt><dd>{profile.role || 'Not provided'}</dd></div><div><dt>{profile.rank?.isPeak ? 'Peak rank' : 'Recorded rank'}</dt><dd><RankBadge key={`${profile.id}:${profile.rank?.accessibleLabel}`} rank={profile.rank} /></dd></div></dl>
      {profile.rank?.isPeak && profile.recordedRank && <div className="player-recorded-rank"><span>Recorded rank</span><RankBadge rank={profile.recordedRank}/></div>}
      {game && <button type="button" className="profile-rank-guide-button" aria-haspopup="dialog" onClick={()=>setGuide(true)}>Explore {profile.rank?.tier || 'game'} rank <ChevronRight size={15}/></button>}
      <p className="profile-footnote">Rank supplied with the roster · not synced to the game publisher.</p>
      {profile.bio && <div className="player-profile-bio"><h3>About {profile.ign}</h3><p>{profile.bio}</p></div>}
      <div className="player-profile-team"><CollegeLogo code={profile.teamCode || team.collegeCode} size="sm" /><div><small>Team</small><strong>{profile.teamName}</strong></div><span>{profile.teamCode}</span></div>
      {profile.rank && !profile.rank.isPeak && <p className="profile-footnote">A career high hasn’t been added yet. This is the recorded rank.</p>}
      {profile.isSample && <p className="profile-footnote">Sample profile · fictional details and photo.</p>}
      <footer className="profile-navigation"><button type="button" disabled={selected === null || selected === 0} onClick={() => open((selected ?? 0)-1)}><ChevronLeft size={16} /> Previous</button><span aria-live="polite">{(selected ?? lastSelected)+1} of {profiles.length}</span><button type="button" disabled={selected === null || selected === profiles.length-1} onClick={() => open((selected ?? 0)+1)}>Next <ChevronRight size={16} /></button></footer>
    </Modal>}
    {game && <RankGuide key={profile?.id} open={guide} initialGame={game} recorded={profile?.rank} onClose={()=>setGuide(false)}/>}
  </section>;
}
