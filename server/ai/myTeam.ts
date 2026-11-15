// "When is our next match?": the asker's own team, answered from the records without a model.
// A student is linked to a team when they are the registration's captain (ownerId) or when their
// verified school email is on the team's staff-only roster. Only the team's name and id leave this
// module; no roster field of anyone else is read out or returned.
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { BracketDraft, Match } from '../../src/lib/types.ts';
import type { KnowledgeReference } from '../../src/lib/tournamentKnowledge.ts';
import { scheduleMatches } from '../../src/lib/formats/placement.ts';
import { manilaToday, scheduleDate, timeOrder } from '../../src/lib/calendar.ts';
import type { Caller } from '../auth.ts';

export interface MyTeam { tournamentId: string; teamId: string; teamName: string }
export type MyTeamsReader = (caller: Caller, tournamentIds: string[]) => Promise<MyTeam[]>;

/** "my team", "our next match", "kelan laban namin", "sino kalaban namin". */
const PERSONAL = /\b(my|our|ours|namin|natin|amin)\b[\w\s']{0,40}\b(teams?|match(?:es)?|games?|laban|schedule|next|kalaban|opponents?|roster|squad)\b|\b(teams?|match(?:es)?|laban|kalaban|schedule|squad)\b[\w\s]{0,20}\b(namin|natin|amin|ko|ours)\b|\b(when do we|who do we (?:play|face)|are we (?:playing|next)|kelan kami|kailan kami|sino kalaban namin)\b/i;
export const personalQuestion = (query: string) => PERSONAL.test(query);

export function firestoreMyTeams(app: App): MyTeamsReader {
  const db = getFirestore(app);
  return async (caller, tournamentIds) => {
    const found = new Map<string, MyTeam>();
    const owned = await db.collection('tournamentRegistrations').where('ownerId', '==', caller.uid).limit(20).get();
    for (const doc of owned.docs) {
      const r = doc.data();
      if (typeof r.tournamentId === 'string' && typeof r.teamId === 'string' && ['approved', 'locked', 'submitted'].includes(r.status)) {
        found.set(`${r.tournamentId}|${r.teamId}`, { tournamentId: r.tournamentId, teamId: r.teamId, teamName: String(r.teamName || '') });
      }
    }
    const email = caller.campus ? caller.email.toLowerCase() : '';
    if (email && tournamentIds.length) {
      const rosters = await db.getAll(...tournamentIds.slice(0, 50).map(id => db.doc(`tournaments/${id}/private/roster`)));
      rosters.forEach((snap, i) => {
        const teams = snap.exists ? (snap.get('teams') || {}) as Record<string, { teamName?: string; players?: Array<{ schoolEmail?: string }> }> : {};
        for (const [teamId, team] of Object.entries(teams)) {
          if ((team.players || []).some(p => typeof p.schoolEmail === 'string' && p.schoolEmail.trim().toLowerCase() === email)) {
            found.set(`${tournamentIds[i]}|${teamId}`, { tournamentId: tournamentIds[i], teamId, teamName: String(team.teamName || '') });
          }
        }
      });
    }
    return [...found.values()];
  };
}

const inMatch = (m: Match, team: MyTeam) => m.team1?.id === team.teamId || m.team2?.id === team.teamId
  || (!!team.teamName && (m.team1?.name === team.teamName || m.team2?.name === team.teamName));
const opponent = (m: Match, team: MyTeam) => (m.team1?.id === team.teamId || m.team1?.name === team.teamName ? m.team2?.name : m.team1?.name) || 'an opponent still to be decided';
const usFirst = (m: Match, team: MyTeam) => m.team1?.id === team.teamId || m.team1?.name === team.teamName;

/** One short answer per team the asker belongs to. */
export function myTeamAnswer(teams: MyTeam[], brackets: BracketDraft[], checkedAt: string) {
  const references: KnowledgeReference[] = [];
  if (!teams.length) {
    return { text: "I couldn't find a team linked to your account. ArenaHub links you to a team when you are its registered captain, or when your school email is on its roster. Ask your facilitator if that should be you.", references };
  }
  const today = manilaToday(new Date(checkedAt));
  const blocks = teams.slice(0, 4).map(team => {
    const b = brackets.find(x => x.id === team.tournamentId);
    const name = team.teamName || 'Your team';
    if (!b) return `${name}: the tournament is not published right now.`;
    references.push({ label: b.title, bracketId: b.id });
    const matches = scheduleMatches(b).filter(m => !m.inactive && !m.lobby && inMatch(m, team));
    if (b.placement) {
      const squad = b.placement.teams.find(t => t.id === team.teamId || t.name === team.teamName);
      const next = b.placement.games.find(g => g.status !== 'completed');
      return `${name} plays in ${b.title}, a Battle Royale lobby${squad ? '' : ' (your squad is not listed in the lobby yet)'}. ${next ? `Next: ${next.label}${next.scheduledDate ? ` on ${scheduleDate(next.scheduledDate, today) || next.scheduledDate}${next.scheduledTime ? ` at ${next.scheduledTime} Manila time` : ''}` : ', time not set yet'}.` : 'Every lobby game is finished.'}`;
    }
    const live = matches.find(m => m.status === 'live');
    const upcoming = matches.filter(m => m.status === 'upcoming' || m.status === 'pre-match')
      .sort((x, y) => (scheduleDate(x.scheduledDate, today) || '9999').localeCompare(scheduleDate(y.scheduledDate, today) || '9999') || timeOrder(x.scheduledTime) - timeOrder(y.scheduledTime));
    const last = matches.filter(m => m.status === 'completed').at(-1);
    const parts: string[] = [];
    if (live) {
      references.push({ label: `${b.title} · ${live.matchNumber || live.roundName}`, bracketId: b.id, matchId: live.id });
      const [us, them] = usFirst(live, team) ? [live.score.team1Score, live.score.team2Score] : [live.score.team2Score, live.score.team1Score];
      parts.push(`You are playing ${opponent(live, team)} right now (${live.roundName}), ${us}-${them}, live and not final.`);
    }
    const next = upcoming[0];
    if (next) {
      references.push({ label: `${b.title} · ${next.matchNumber || next.roundName}`, bracketId: b.id, matchId: next.id });
      const day = scheduleDate(next.scheduledDate, today);
      parts.push(`Next: ${opponent(next, team)} in the ${next.roundName}, ${day ? `${day}${next.scheduledTime && timeOrder(next.scheduledTime) !== 9999 ? ` at ${next.scheduledTime} Manila time` : ', time not set'}` : 'date not set yet'} (${next.matchFormat}).`);
    } else if (!live) parts.push(last ? 'No further match is scheduled for your team.' : 'No match is scheduled for your team yet.');
    if (last && !live) {
      const won = last.winnerId ? last.winnerId === team.teamId || (last.winnerId === last.team1?.id ? last.team1?.name : last.team2?.name) === team.teamName : null;
      const [us, them] = usFirst(last, team) ? [last.score.team1Score, last.score.team2Score] : [last.score.team2Score, last.score.team1Score];
      parts.push(`Last result: ${won === null ? 'played' : won ? 'won' : 'lost'} against ${opponent(last, team)}, ${us}-${them}.`);
    }
    return `${name} (${b.title}): ${parts.join(' ')}`;
  });
  return { text: blocks.join('\n\n'), references };
}
