// Turns each part of a PC scan into one line the player can read in the agent window.
import type { WindowStep } from './agentWindow';
import type { DotaAudit } from './dotaAudit';

type CheckStatus = string;
interface ProgramObservation {
  processes: unknown[]; installedApplications: unknown[]; loadedModules: unknown[]; untrustedModules: unknown[]; suspiciousPrograms: unknown[];
  checks: { processes?: CheckStatus; installedApplications?: CheckStatus };
}
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function scanSteps({ official, folders }: { official: boolean; folders: boolean }): WindowStep[] {
  return [
    { key: 'programs', label: 'Programs on this PC', status: 'waiting' },
    { key: 'dota', label: 'Dota 2 game files', status: 'waiting' },
    folders
      ? { key: 'folders', label: 'Folder check', status: 'waiting' }
      : { key: 'folders', label: 'Folder check', status: 'skipped', detail: 'Not required by this tournament' },
    official
      ? { key: 'report', label: 'Tournament check', status: 'waiting' }
      : { key: 'judge', label: 'Result', status: 'waiting', detail: 'Judged on this PC. Nothing is sent.' },
  ];
}

export function programsStep(observation: ProgramObservation): Partial<WindowStep> {
  if (observation.checks.processes === 'failed' && observation.checks.installedApplications === 'failed') return { status: 'failed', detail: 'The program list could not be read. Run the scan again.' };
  const flagged = observation.processes.length + observation.installedApplications.length + observation.suspiciousPrograms.length + observation.loadedModules.length + observation.untrustedModules.length;
  if (flagged) return { status: 'warn', detail: `${plural(flagged, 'program')} flagged. See the list above.` };
  return { status: 'done', detail: 'Nothing restricted is running or installed.' };
}

export function dotaStep(audit: DotaAudit, status: 'complete' | 'partial' | 'failed', practice = false): Partial<WindowStep> {
  if (practice && !audit.found) return { status: 'skipped', detail: 'Dota 2 was not found. The PC checks can still run.' };
  if (!audit.found) return { status: 'failed', detail: 'Dota 2 was not found on this PC. Install it from Steam, or open Dota 2 once so the scan can find it.' };
  const problems = audit.modifiedFiles.length + audit.missingFiles.length + audit.unlistedBinaries.length + audit.contentOverrides.length + audit.launchFlags.length;
  if (problems) return { status: 'warn', detail: `${plural(problems, 'problem')} with the game files or launch options. See the list above.` };
  if (status !== 'complete') return { status: 'warn', detail: 'Only partly checked. Verify the game files in Steam, then scan again.' };
  return { status: 'done', detail: `Build ${audit.buildId || 'unknown'} matches the file list Valve ships.` };
}

export function sweepStep(status: string, flagged: number, entries?: number): Partial<WindowStep> {
  switch (status) {
    case 'not-configured': return { status: 'skipped', detail: 'Not required by this tournament' };
    case 'not-allowed': return { status: 'failed', detail: 'You did not allow the folder check, so the referee will see it did not run.' };
    case 'failed': return { status: 'failed', detail: 'The folder check could not read your folders.' };
    case 'not-running': return { status: 'running', detail: entries ? `${entries.toLocaleString('en-US')} files read so far` : 'Reading your folders. This can take a minute or two.' };
    default: {
      const counted = entries ? `${entries.toLocaleString('en-US')} files read` : 'Folders read';
      if (flagged) return { status: 'warn', detail: `${counted}, ${plural(flagged, 'file')} listed for review. See the findings above.` };
      if (status === 'partial') return { status: 'warn', detail: `${counted}. The scan reached its time or size limit.` };
      return { status: 'done', detail: `${counted}. No findings in those files.` };
    }
  }
}
