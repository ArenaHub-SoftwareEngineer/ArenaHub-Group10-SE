// Live player screens through a LiveKit media server (an SFU).
// Each player's phone or PC uploads ONE screen stream to LiveKit. LiveKit forwards it to every facilitator
// watching, so adding watchers never adds work on the player's device. The ArenaHub server only signs
// short-lived access tokens and never touches the video.
//
// Works with LiveKit Cloud (free Build plan) or a self-hosted open-source livekit-server:
//   LIVEKIT_URL         wss://<project>.livekit.cloud, or ws://<laptop-ip>:7880 for `livekit-server --dev`
//   LIVEKIT_API_KEY     from the LiveKit project (devkey for --dev)
//   LIVEKIT_API_SECRET  from the LiveKit project (secret for --dev)
//   LIVEKIT_API_URL     optional: where THIS server reaches LiveKit, when it differs from LIVEKIT_URL
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import type { PublishedData } from './data.ts';
import { FAIR_PLAY_GAMES, belongsToFairPlayGame } from '../src/lib/fairPlayGames.ts';
import { scheduleMatches } from '../src/lib/formats/placement.ts';
import { matchName } from '../src/lib/matchName.ts';
import type { MonitorGame, MonitorPlatform } from '../src/lib/integrityRisk.ts';
import type { Match } from '../src/lib/types.ts';

type Env = Record<string, string | undefined>;

/** A screen room is one scheduled match (m-<matchId>) or one scrim/test check-in room (r-<roomId>). */
export const SCREEN_KEY = /^[mr]-[A-Za-z0-9_-]{1,80}$/;
export const matchScreenKey = (matchId: string) => 'm-' + matchId;
export const roomScreenKey = (roomId: string) => 'r-' + roomId;
const liveKitRoomName = (key: string) => 'arenahub-' + key;

/** What a paused match looks like to players and other staff. Kept in the LiveKit room metadata. */
export interface ScreenRoomState { paused: boolean; by?: string; at?: number; note?: string }
export interface ScreenRoomLive { publishers: number; state: ScreenRoomState }

export interface LiveScreens {
  /** Where players and staff connect (the browser and app open this address). */
  url: string;
  publisherToken(key: string, player: { sessionId: string; name: string; team: string; platform: MonitorPlatform; game: MonitorGame }): Promise<string>;
  viewerToken(key: string, staff: { uid: string; name: string }): Promise<string>;
  /** Live rooms by screen key, read once for the whole list. */
  live(): Promise<Record<string, ScreenRoomLive>>;
  setState(key: string, state: ScreenRoomState): Promise<ScreenRoomState>;
}

export function liveScreensFromEnv(env: Env): LiveScreens | null {
  const url = (env.LIVEKIT_URL || '').trim(), apiKey = (env.LIVEKIT_API_KEY || '').trim(), secret = (env.LIVEKIT_API_SECRET || '').trim();
  if (!url || !apiKey || !secret) return null;
  if (!/^wss?:\/\//.test(url)) throw new Error('LIVEKIT_URL must start with wss:// (or ws:// for a local test server).');
  // The room API speaks HTTP on the same host as the WebSocket address.
  const apiUrl = (env.LIVEKIT_API_URL || url).trim().replace(/^ws/, 'http');
  const rooms = new RoomServiceClient(apiUrl, apiKey, secret);
  let cached: { at: number; data: Promise<Record<string, ScreenRoomLive>> } | null = null;

  const token = async (identity: string, name: string, ttl: string, grant: ConstructorParameters<typeof AccessToken>[2] & object, video: Record<string, unknown>) => {
    const at = new AccessToken(apiKey, secret, { identity, name, ttl, ...grant });
    at.addGrant(video);
    return at.toJwt();
  };
  return {
    url,
    publisherToken: (key, player) => token('p-' + player.sessionId, player.name, '4h',
      { attributes: { team: player.team, platform: player.platform, game: player.game } },
      // Players may publish one thing only, their screen, and may not watch anyone, including opponents.
      { room: liveKitRoomName(key), roomJoin: true, canPublish: true, canPublishSources: [TrackSource.SCREEN_SHARE], canSubscribe: false, canPublishData: false, canUpdateOwnMetadata: false }),
    viewerToken: (key, staff) => token('s-' + staff.uid.slice(0, 24) + '-' + Math.random().toString(36).slice(2, 6), staff.name, '4h', {},
      // Staff watch only. Hidden, so players never see who is watching and the wall lists only players.
      { room: liveKitRoomName(key), roomJoin: true, canPublish: false, canPublishData: false, canSubscribe: true, canUpdateOwnMetadata: false, hidden: true }),
    live() {
      if (cached && Date.now() - cached.at < 3000) return cached.data;
      const data = rooms.listRooms().then(list => Object.fromEntries(list
        .filter(room => room.name.startsWith('arenahub-'))
        .map(room => [room.name.slice('arenahub-'.length), { publishers: room.numPublishers, state: parseState(room.metadata) }])));
      cached = { at: Date.now(), data };
      data.catch(() => { if (cached?.data === data) cached = null; });
      return data;
    },
    async setState(key, state) {
      const name = liveKitRoomName(key), metadata = JSON.stringify(state);
      cached = null;
      // A room exists only while someone is connected. Pausing an empty match creates it, so players who join later see the pause.
      try { await rooms.updateRoomMetadata(name, metadata); }
      catch { await rooms.createRoom({ name, metadata, emptyTimeout: 15 * 60 }); }
      return state;
    },
  };
}

export function parseState(metadata: string | undefined): ScreenRoomState {
  try {
    const value = JSON.parse(metadata || '{}');
    return value && value.paused === true
      ? { paused: true, by: String(value.by || '').slice(0, 80), at: Number(value.at) || undefined, note: String(value.note || '').slice(0, 200) }
      : { paused: false };
  } catch { return { paused: false }; }
}

const gameOf = (match: Match) => FAIR_PLAY_GAMES.find(game => belongsToFairPlayGame(match, game))?.id as MonitorGame | undefined;
export const screenMatchLabel = (match: Match) => {
  const teams = match.lobby ? `${match.lobby.squads} squads` : `${match.team1?.name || 'TBD'} vs ${match.team2?.name || 'TBD'}`;
  return [matchName(match) || match.roundName, teams].filter(Boolean).join(' · ');
};
/** Published matches a player can share into: this game, not finished, with a time if one is set. */
export function screenMatches(data: PublishedData, game: MonitorGame) {
  return data.brackets.flatMap(bracket => scheduleMatches(bracket))
    .filter(match => SCREEN_KEY.test(matchScreenKey(match.id)) && match.status !== 'completed' && !match.inactive && gameOf(match) === game
      // CODM matches without a mode belong to both CODM games; that is fine for choosing where to share.
      && (match.lobby || (match.team1 && match.team2 && !match.team1.isBye && !match.team2.isBye)))
    .sort((a, b) => Number(b.status === 'live') - Number(a.status === 'live') || `${a.scheduledDate || '9'}${a.scheduledTime || ''}`.localeCompare(`${b.scheduledDate || '9'}${b.scheduledTime || ''}`))
    .slice(0, 40)
    .map(match => ({ id: match.id, label: screenMatchLabel(match), date: match.scheduledDate || '', time: match.scheduledTime || '', live: match.status === 'live' }));
}
