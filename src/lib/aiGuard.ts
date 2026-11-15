// Which questions Arena AI refuses before reading any data. Shared by the server pipeline and the
// on-device fallback, so both refuse the same things. Pure: no Firebase or Node imports.

export type Screen =
  | { kind: 'ok' }
  | { kind: 'refuse'; reason: 'off-topic' | 'injection' | 'private'; text: string };

export const SCOPE = 'I can help with ArenaHub tournaments: brackets, schedules, live scores, standings, team rosters by in-game name, formats, and how to use the platform.';
const OFF_TOPIC = /\b(weather|recipe|bitcoin|crypto|stock price|politic|election|write (?:me )?(?:an? )?(?:essay|poem|story|song)|homework|capital of|translate|python script|javascript code|sql query|horoscope|lottery)\b/i;
// Attempts to change the assistant's role or read its instructions. The tools and the system prompt
// already keep the model in scope; refusing early also saves the model call.
const INJECTION = /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|earlier|all|your|system)\b.{0,30}\b(instructions?|rules?|prompts?|messages?)\b|\b(system prompt|developer message|jailbreak|DAN mode|you are now|act as (?:an? )?(?!arena)|pretend (?:to be|you are)|reveal (?:your|the) (?:instructions|prompt|rules))\b/i;
// Real names, student IDs, school emails and sections stay in the staff-only roster (RA 10173).
const PRIVATE = /\b(student (?:id|number)s?|id numbers?|school e-?mails?|e-?mail (?:address(?:es)? )?(?:of|for)|(?:real|legal) names?|full names? of (?:the )?(?:players?|members?|students?|team|roster)|(?:players?|students?)'?s? (?:full |real )?names?|sections? of|home address|phone numbers?|contact numbers?|birthda(?:y|te)s?)\b/i;

export function screenQuestion(query: string): Screen {
  if (PRIVATE.test(query)) return { kind: 'refuse', reason: 'private', text: 'Player privacy comes first. ArenaHub only shares in-game names, roles and colleges. For anything else, contact the tournament organizers.' };
  if (INJECTION.test(query)) return { kind: 'refuse', reason: 'injection', text: `I can't change how I work. ${SCOPE}` };
  if (OFF_TOPIC.test(query)) return { kind: 'refuse', reason: 'off-topic', text: `That's outside what I cover. ${SCOPE}` };
  return { kind: 'ok' };
}
