// Referee review categories: reported cheat families and policy indicators, not detection guarantees.
// Related evidence sources provide context; the category does not establish a current working exploit.
import type { MonitorGame } from './integrityRisk';

export type DetectionLayer = 'device' | 'recording' | 'stats' | 'referee';
export const LAYER_LABEL: Record<DetectionLayer, string> = {
  device: 'Device check',
  recording: 'Screen recording',
  stats: 'Match stats',
  referee: 'Referee on site',
};
export interface CheatType {
  id: string;
  name: string;
  what: string;
  /** Related evidence sources; none independently establishes cheating. */
  layers: DetectionLayer[];
  /** What a referee should look for. */
  tells: string[];
}

const moddedClient = (game: string): CheatType => ({
  id: 'modded-client', name: 'Modified game app', what: `A repackaged ${game} app with cheats or unlocked content built in.`,
  layers: ['device'],
  tells: ['The reported signer differs from the independently verified regional trust list; check legitimate key rotation.', 'A version difference requires an official release/update check before considering modification.'],
});
const accountSharing: CheatType = {
  id: 'account-sharing', name: 'Account sharing or piloting', what: 'Someone other than the registered player plays on the account.',
  layers: ['referee', 'stats', 'device'],
  tells: ['The person at the device is not the registered player (check the school ID at the venue).', 'Rank, hero pool or play style differs sharply from the player\'s history.', 'The device changes between matches without a reason.'],
};
const emulator: CheatType = {
  id: 'emulator', name: 'Emulator or key-mapper', what: 'Playing a mobile game on a PC emulator, or with mouse and keyboard mapped to touch.',
  layers: ['device', 'recording', 'referee'],
  tells: ['The companion reports emulator traces or a key-mapper app with screen control.', 'The recording is landscape at a PC resolution, or shows a mouse pointer.', 'Aim movements are perfectly straight and instant, without thumb drift.'],
};

export const CHEAT_CATALOG: Record<MonitorGame, CheatType[]> = {
  mlbb: [
    { id: 'map-hack', name: 'Map hack (radar)', what: 'Shows enemy heroes on the minimap or through fog when the team has no vision.', layers: ['recording', 'device'],
      tells: ['Enemy icons are visible on the player\'s minimap with no ally, minion or vision skill nearby.', 'The player repeatedly rotates to or away from ganks before any enemy becomes visible.', 'The player checks empty bushes only when someone is in them.'] },
    { id: 'drone-view', name: 'Drone view (zoom-out)', what: 'Pulls the camera much higher than the game allows, showing more of the map.', layers: ['recording', 'device'],
      tells: ['The recording shows the hero much smaller than normal, with more of the lane on screen.', 'The player\'s field of view differs from other players on the same phone model.'] },
    { id: 'auto-aim-combo', name: 'Auto-aim or auto-combo script', what: 'A tool that aims skill shots or chains a hero\'s combo faster than a person can.', layers: ['recording', 'device'],
      tells: ['Skill shots are released instantly at the edge of range, every time, including on targets entering from fog.', 'Full combos complete with identical timing in every fight.', 'An app with screen control (accessibility) is active during the match.'] },
    moddedClient('Mobile Legends'), emulator, accountSharing,
  ],
  'codm-br': [
    { id: 'wall-hack', name: 'Wall hack (ESP)', what: 'Draws enemy outlines, boxes or distance labels through walls and terrain.', layers: ['recording', 'device'],
      tells: ['Boxes, skeletons, lines or distance numbers that are not part of the game HUD appear in the recording.', 'The crosshair follows an enemy behind cover with no sound cue, ping or teammate call.', 'The player pre-aims the exact spot an unseen enemy will appear from, repeatedly.'] },
    { id: 'aimbot', name: 'Aimbot', what: 'Snaps or locks the crosshair onto enemies automatically.', layers: ['recording', 'stats'],
      tells: ['The crosshair snaps to targets in one frame, then stays locked through smoke or movement.', 'The headshot rate or accuracy is far above the player\'s own history and the lobby.', 'The aim flicks to enemies the player was not facing and had no cue for.'] },
    { id: 'no-recoil', name: 'No recoil or rapid-fire macro', what: 'Removes weapon recoil or fires semi-automatic weapons at an impossible rate.', layers: ['recording', 'device'],
      tells: ['Long sprays stay on one point with no visible recoil, on weapons that normally climb.', 'Single-shot weapons fire at a steady rate faster than a thumb can tap.'] },
    { id: 'speed-movement', name: 'Speed, jump or fly hack', what: 'Moves faster, jumps higher or passes through terrain.', layers: ['recording', 'referee'],
      tells: ['The player crosses distances faster than a vehicle-less sprint allows.', 'The player jumps onto roofs without a ladder or skill, or drops with no fall damage.'] },
    moddedClient('CODM'), emulator, accountSharing,
  ],
  'codm-mp': [
    { id: 'wall-hack', name: 'Wall hack (ESP)', what: 'Draws enemy outlines or boxes through walls.', layers: ['recording', 'device'],
      tells: ['Boxes, skeletons or lines that are not part of the game HUD appear in the recording.', 'The crosshair follows an enemy behind a wall with no UAV, sound or teammate call active.', 'The player pre-fires corners only when someone is behind them.'] },
    { id: 'aimbot', name: 'Aimbot', what: 'Snaps or locks the crosshair onto enemies automatically.', layers: ['recording', 'stats'],
      tells: ['The crosshair snaps to heads in one frame, beyond what aim assist does.', 'Accuracy or headshot rate is far above the player\'s own history and the lobby.'] },
    { id: 'no-recoil', name: 'No recoil or rapid-fire macro', what: 'Removes weapon recoil or automates tapping.', layers: ['recording', 'device'],
      tells: ['Sprays stay on one point on weapons that normally climb.', 'Single-shot weapons fire at a steady, impossible rate.'] },
    { id: 'radar-hack', name: 'Radar hack', what: 'Shows all enemies on the minimap without a UAV.', layers: ['recording'],
      tells: ['Red dots stay on the player\'s minimap when no UAV or shot was fired.', 'The player turns to face flanks before any cue exists.'] },
    moddedClient('CODM'), emulator, accountSharing,
  ],
  dota2: [
    { id: 'map-hack', name: 'Map hack or vision script', what: 'Reveals enemy positions, teleports or spell particles in the fog of war.', layers: ['recording', 'device'],
      tells: ['The player clicks or moves the camera onto enemies in fog with no ward, scan or sound.', 'The player dodges ganks or Roshan attempts they had no vision of, repeatedly.', 'Extra markers that are not part of the Dota 2 HUD appear on the minimap in screenshots.'] },
    { id: 'auto-cast', name: 'Auto-cast or auto-dodge script', what: 'Casts spells or items automatically: instant hex or silence, perfect dodges, automatic last hits.', layers: ['recording', 'stats', 'device'],
      tells: ['Disables land the instant an enemy blinks in, every time, including off-screen.', 'Projectiles are dodged with frame-perfect item use across a whole game.', 'Last-hit counts are far above the player\'s own history (the OpenDota check flags this).'] },
    { id: 'camera-zoom', name: 'Camera zoom hack', what: 'Raises the camera beyond the game limit to see more of the map.', layers: ['recording', 'device'],
      tells: ['Screenshots show heroes much smaller than normal, with more terrain visible.', 'A memory tool on the blocklist was running (the PC agent reports this as critical).'] },
    { id: 'macro', name: 'Macros and input automation', what: 'One key press plays a whole sequence, such as a full combo or rapid toggling.', layers: ['device', 'recording'],
      tells: ['The PC agent reports a macro tool from the blocklist.', 'Complex combos execute with identical timing every time.'] },
    { id: 'memory-tools', name: 'Memory editors and injectors', what: 'Tools that may read or change another program. Legitimate debugging tools can match these policies too.', layers: ['device'],
      tells: ['Review the matched process or configured executable fingerprint and its legitimate uses.', 'The agent reports an unsigned library loaded into Dota 2 from a user folder, or an extra DLL beside dota2.exe (proxy loader).', 'An agent that stops reporting has a coverage gap; investigate connectivity and device state.'] },
    { id: 'content-mod', name: 'Vision or particle mod (content pack)', what: 'A custom content pack loaded through -language, gameinfo.gi or a replaced game file that removes weather and effects or makes spells, wards and heroes easier to see.', layers: ['device', 'recording'],
      tells: ['The PC agent reports a custom content folder, an added gameinfo.gi search path, a -language launch option or a file that differs from Valve\'s list.', 'Screenshots show particles, hero models or terrain in colours or sizes that differ from other players on the same patch.'] },
    { id: 'vac-off', name: 'VAC turned off (-insecure)', what: 'Launching Dota 2 with -insecure disables Valve Anti-Cheat for the session, which some cheat loaders require.', layers: ['device'],
      tells: ['The PC agent reports -insecure in the saved launch options or the running game\'s command line.'] },
    { ...accountSharing, tells: ['Dota 2 reports a different Steam account from the one registered (the agent flags this).', ...accountSharing.tells.slice(0, 2)] },
  ],
};

export const cheatById = (game: MonitorGame, id: string) => CHEAT_CATALOG[game].find(c => c.id === id);
