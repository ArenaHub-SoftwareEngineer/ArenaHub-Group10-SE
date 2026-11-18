import { z } from 'zod';

export const IOS_CLEARANCE_MS = 15 * 60_000;
export const IOS_INSPECTION_CHECKS = {
  deviceAndAccount: 'I matched this physical iPhone and in-game account to the published player roster.',
  officialGame: 'I checked the game against its official regional App Store listing on this iPhone.',
  deviceSettings: 'I reviewed VPN & Device Management and visible jailbreak or modification indicators with the player.',
  supervision: 'I arranged continuous referee observation of this player and device during play.',
  recording: 'I verified that player-view or observer recording is running and recorded its source in the note.',
} as const;

/**
 * What a referee looks for on the player's iPhone. Apple's sandbox stops any website or App Store app
 * from listing other apps, so these are checked by hand with the player. Each one is how modified game
 * builds or jailbreak tools reach an iPhone; none of them is visible to the game publisher's servers.
 */
export const IOS_SIDELOAD_INDICATORS = {
  developerMode: { where: 'Settings > Privacy & Security > Developer Mode', found: 'Developer Mode is on', why: 'iOS 16 and later require it to run apps signed with a developer certificate, which is how many modified game builds are installed.' },
  deviceManagement: { where: 'Settings > General > VPN & Device Management', found: 'An Enterprise App or Developer App is trusted', why: 'Modified games and injector apps are spread with enterprise or developer certificates that must be trusted here.' },
  sideloadApps: { where: 'Home Screen and App Library search', found: 'A sideloading or jailbreak app (TrollStore, AltStore, SideStore, Scarlet, ESign, Feather, GBox, Sileo, Zebra, Cydia, Filza, Dopamine, palera1n)', why: 'These install apps outside the App Store, or show a jailbroken phone where game memory can be changed.' },
  appStoreCopy: { where: 'The game\'s page in the App Store app', found: 'The page shows Get or a download icon, not Open, although the game is installed', why: 'The installed copy is not the App Store build.' },
  duplicateGame: { where: 'Home Screen and App Library', found: 'Two copies of the game, or an icon or name that differs from the official app', why: 'Modified builds are often installed beside the official app under a changed name.' },
  vpnOrProfile: { where: 'Settings > VPN, and configuration profiles under VPN & Device Management', found: 'A VPN, DNS or configuration profile the venue did not provide is active', why: 'Network profiles can route the game through lag-switch or modified-content services. Ask the player to turn it off for the match.' },
} as const;
export type IosIndicator = keyof typeof IOS_SIDELOAD_INDICATORS;
export const IOS_INDICATOR_KEYS = Object.keys(IOS_SIDELOAD_INDICATORS) as IosIndicator[];

export const iosInspectionSchema = z.object({
  deviceAndAccount: z.literal(true),
  officialGame: z.literal(true),
  deviceSettings: z.literal(true),
  supervision: z.literal(true),
  recording: z.literal(true),
});
const indicatorResult = z.enum(['clear', 'found']);
const clear = z.literal('clear', { error: 'Approval is not possible while a sideload or jailbreak indicator is marked found.' });
export const iosIndicatorsSchema = z.object({ developerMode: indicatorResult, deviceManagement: indicatorResult, sideloadApps: indicatorResult, appStoreCopy: indicatorResult, duplicateGame: indicatorResult, vpnOrProfile: indicatorResult });
const iosClearIndicatorsSchema = z.object({ developerMode: clear, deviceManagement: clear, sideloadApps: clear, appStoreCopy: clear, duplicateGame: clear, vpnOrProfile: clear });
export const iosReviewSchema = z.discriminatedUnion('approved', [
  z.object({ approved: z.literal(true), checks: iosInspectionSchema, indicators: iosClearIndicatorsSchema, note: z.string().trim().min(10).max(2000) }),
  z.object({ approved: z.literal(false), indicators: iosIndicatorsSchema.partial().optional(), note: z.string().trim().min(10).max(2000) }),
]);
/** Labels of the indicators a revoke recorded as found. */
export const foundIndicators = (input: IosReviewInput) => input.approved ? [] : IOS_INDICATOR_KEYS.filter(key => input.indicators?.[key] === 'found').map(key => IOS_SIDELOAD_INDICATORS[key].found);
export type IosReviewInput = z.infer<typeof iosReviewSchema>;
export interface IosClearance {
  approved: boolean;
  reviewedAt: number;
  validUntil: number;
  actor: string;
  note: string;
  challenge: string;
  policyVersion: string;
  rosterVersion: string;
  /** Indicators the referee marked found when revoking. */
  indicatorsFound?: string[];
}
