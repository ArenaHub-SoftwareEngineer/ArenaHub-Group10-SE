export const REVIEW_GAMES = ['mlbb', 'dota2', 'codm-br', 'codm-mp'] as const;
export type ReviewGame = typeof REVIEW_GAMES[number];
export interface ReviewFrame { timestamp: number; image: string }
export interface FrameFinding { timestamp: number; classification: 'review' | 'context-needed' | 'no-visible-concern'; observation: string; possibleExplanation: string; missingContext: string; category: string }
export const frameTime = (seconds: number) => {
  const tenths = Math.max(0, Math.round(seconds * 10));
  return `${Math.floor(tenths / 600).toString().padStart(2, '0')}:${Math.floor(tenths / 10 % 60).toString().padStart(2, '0')}.${tenths % 10}`;
};
export function reviewSampleTimes(duration: number, start = 0): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(start) || start < 0 || start >= duration) throw new Error('Choose a position inside a readable video.');
  const end = Math.min(duration, start + 30);
  return Array.from({ length: Math.min(60, Math.ceil((end - start) * 2)) }, (_, i) => Math.round(Math.min(duration - .001, start + i / 2) * 1000) / 1000);
}
export function validateFrameFindings(value: unknown, frames: Pick<ReviewFrame, 'timestamp'>[]): FrameFinding[] {
  const rows = (value as { frames?: unknown })?.frames;
  if (!Array.isArray(rows) || rows.length !== frames.length) throw new Error('The model returned an incomplete frame review.');
  return frames.map(frame => {
    const row = rows.find((r: any) => r && r.timestamp === frame.timestamp);
    if (!row || !['review', 'context-needed', 'no-visible-concern'].includes(row.classification) || ['observation', 'possibleExplanation', 'missingContext', 'category'].some(key => typeof row[key] !== 'string' || row[key].length > 1600)) throw new Error('The model returned an invalid frame review.');
    return { timestamp: frame.timestamp, classification: row.classification, observation: row.observation, possibleExplanation: row.possibleExplanation, missingContext: row.missingContext, category: row.category };
  });
}
