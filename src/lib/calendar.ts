export function manilaToday(now=new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
export function scheduleDate(raw:string,today=manilaToday()):string|null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^today$/i.test(raw)) return today;
  const match=raw.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i);
  if(!match)return null;
  const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[1].toLowerCase())+1;
  return `${match[3]||today.slice(0,4)}-${String(month).padStart(2,'0')}-${match[2].padStart(2,'0')}`;
}
export function timeOrder(raw:string) {const m=raw.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);if(!m)return 9999;return ((Number(m[1])%12)+(m[3]?.toUpperCase()==='PM'?12:!m[3]&&Number(m[1])>=12?12:0))*60+Number(m[2]);}

export function bracketScheduleLabel(match: { scheduledDate?: string; scheduledTime?: string }) {
  const date = match.scheduledDate?.trim() || '';
  const time = match.scheduledTime?.trim() || '';
  if (timeOrder(time) === 9999) return scheduleDate(date) ? `${date} · Time pending` : 'Schedule pending';
  return date && !time.toLowerCase().startsWith(date.toLowerCase()) ? `${date} · ${time}` : time;
}
