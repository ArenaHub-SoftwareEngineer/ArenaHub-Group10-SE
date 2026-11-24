import React from 'react';
import type { Match, User } from '../../../lib/types';
import { isWatchableLiveMatch } from '../../../lib/streamUtils';
import { BroadcastPlayer } from '../../common/BroadcastPlayer';
import { LiveChatPanel } from '../../spectator/LiveChatPanel';
import { matchTitle } from '../../common/MatchPicker';

/**
 * Admin broadcast monitor: shown when a match is on-air.
 * Displays the live broadcast player alongside the live chat so the admin
 * can watch the stream and moderate (mute, kick) users without switching pages.
 */
export function AdminBroadcastMonitor({ match, currentUser }: {
  match: Match;
  currentUser: User;
}) {
  if (!isWatchableLiveMatch(match)) return null;

  return (
    <section className="bw-monitor" aria-label="Live broadcast monitor">
      <h3 className="bw-monitor-title">Live monitor — {matchTitle(match)}</h3>
      <div className="bw-monitor-grid">
        <div className="bw-monitor-player">
          <BroadcastPlayer match={match} />
        </div>
        <div className="bw-monitor-chat">
          <LiveChatPanel
            matchId={match.id}
            currentUser={currentUser}
            readOnly={false}
            canPost={true}
            isAdmin={true}
          />
        </div>
      </div>
    </section>
  );
}
