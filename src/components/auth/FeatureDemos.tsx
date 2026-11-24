import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, RotateCcw, Send, Sparkles } from 'lucide-react';
import { CollegeLogo } from '../common/CollegeLogo';
import { FAIR_PLAY_GAMES } from '../../lib/fairPlayGames';
import { formatViewers } from '../../lib/presence';
import './showcase.css';

/**
 * Interactive previews for the welcome page's feature pop-ups. Everything here is sample data that shows how
 * ArenaHub behaves (no real matches, players or results), and the pop-up says so.
 * Reduced motion: every demo shows its finished state at once and nothing loops.
 */

const isReduced = () => document.documentElement.dataset.motion === 'reduced';
function useCalm() { const device = useReducedMotion(); return Boolean(device) || isReduced(); }

/** Types `text` out one character at a time once `start` is true. */
function useTyped(text: string, start: boolean, msPerChar = 38) {
  const calm = useCalm();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!start) { setCount(0); return; }
    if (calm) { setCount(text.length); return; }
    setCount(0);
    let i = 0;
    const timer = window.setInterval(() => { i++; setCount(i); if (i >= text.length) window.clearInterval(timer); }, msPerChar);
    return () => window.clearInterval(timer);
  }, [text, start, msPerChar, calm]);
  return text.slice(0, count);
}

/** Steps 0..length through a script on a fixed beat, then waits and loops. */
function useScript(length: number, beatMs: number, run = true, loopPauseMs = 2600) {
  const calm = useCalm();
  const [step, setStep] = useState(calm ? length : 0);
  useEffect(() => {
    if (calm) { setStep(length); return; }
    if (!run) return;
    const delay = step >= length ? loopPauseMs : beatMs;
    const timer = window.setTimeout(() => setStep(s => s >= length ? 0 : s + 1), delay);
    return () => window.clearTimeout(timer);
  }, [step, length, beatMs, run, loopPauseMs, calm]);
  return step;
}

const spring = { type: 'spring' as const, stiffness: 420, damping: 34 };
const rise = { initial: { opacity: 0, y: 10, scale: .98 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0 }, transition: spring };

function TypingDots() {
  return <span className="fd-typing" aria-hidden="true"><i /><i /><i /></span>;
}

/* ---------------------------------------------------------------- Watch live */

const CHAT = [
  { who: 'ccs_mika', text: 'that lord steal was insane' },
  { who: 'coe_jhay', text: 'COE comeback loading' },
  { who: 'nursing.ria', text: 'who is CCS gold lane?? clean' },
  { who: 'ccs_mika', text: '@Arena when is the next MLBB match?', mention: true },
  { who: 'Arena AI', text: 'COE vs CA, 3:00 PM on the gym stage. Semifinal, Bo3.', ai: true },
  { who: 'arch.paolo', text: 'GG both teams' },
];
const MY_MESSAGE = 'GG CCS, that draft was clean';

export function WatchDemo() {
  const step = useScript(CHAT.length + 2, 1500);
  const shown = CHAT.slice(0, Math.min(step, CHAT.length));
  const typingNext = step < CHAT.length;
  const myTurn = step >= CHAT.length;
  const typed = useTyped(MY_MESSAGE, myTurn);
  // Typing takes about a second, inside one beat; the next beat sends it.
  const sent = step >= CHAT.length + 1;
  const viewers = 212 + step * 7 + (step % 3) * 2;
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: isReduced() ? 'auto' : 'smooth' }); }, [step, sent]);

  return <div className="fd-watch">
    <div className="fd-player">
      <img src={FAIR_PLAY_GAMES[0].image} alt="" />
      <span className="fd-player-shade" />
      <span className="watch-badge watch-badge-live">Live</span>
      <motion.span key={viewers} className="watch-viewers" initial={{ opacity: .5, y: -3 }} animate={{ opacity: 1, y: 0 }}>{formatViewers(viewers)}</motion.span>
      <div className="fd-scorebug">
        <span><CollegeLogo code="CCS" size="sm" />CCS</span><b>1</b><i>–</i><b>0</b><span>COE<CollegeLogo code="COE" size="sm" /></span>
      </div>
    </div>
    <div className="fd-chat">
      <header><strong>Live chat</strong><small>Sample</small></header>
      <ol ref={list} aria-live="off">
        <AnimatePresence initial={false}>
          {shown.map((message, index) => <motion.li key={`${index}-${message.who}`} {...rise} className={message.ai ? 'is-ai' : message.mention ? 'is-mention' : undefined}>
            <b>{message.ai && <Sparkles size={12} aria-hidden="true" />}{message.who}</b><span>{message.text}</span>
          </motion.li>)}
          {sent && <motion.li key="me" {...rise} className="is-me"><b>You</b><span>{MY_MESSAGE}</span></motion.li>}
        </AnimatePresence>
        {typingNext && <li className="fd-chat-typing"><TypingDots /></li>}
      </ol>
      <div className="fd-composer">
        <span className={typed && !sent ? 'is-typing' : undefined}>{sent || !myTurn ? <em>Send a message</em> : <>{typed}<i className="fd-caret" /></>}</span>
        <motion.span className="fd-send" animate={{ scale: myTurn && !sent && typed.length === MY_MESSAGE.length ? 1.12 : 1 }} transition={spring}><Send size={14} /></motion.span>
      </div>
    </div>
  </div>;
}

/* ---------------------------------------------------------------- Bracket */

type Pick = { semi1?: 0 | 1; semi2?: 0 | 1; final?: 0 | 1 };
const SEMIS = [['CCS', 'CN'], ['COE', 'CA']] as const;
const AUTO: Array<keyof Pick> = ['semi1', 'semi2', 'final'];
const AUTO_PICKS: Pick = { semi1: 0, semi2: 0, final: 0 };

export function BracketDemo() {
  const calm = useCalm();
  const [pick, setPick] = useState<Pick>(calm ? AUTO_PICKS : {});
  const [touched, setTouched] = useState(false);
  // Plays itself until the viewer taps a team, then hands over.
  useEffect(() => {
    if (touched || calm) return;
    const next = AUTO.find(key => pick[key] === undefined);
    const timer = window.setTimeout(() => setPick(next ? { ...pick, [next]: AUTO_PICKS[next] } : {}), next ? 1300 : 2600);
    return () => window.clearTimeout(timer);
  }, [pick, touched, calm]);
  const finalists: [string | undefined, string | undefined] = [
    pick.semi1 === undefined ? undefined : SEMIS[0][pick.semi1],
    pick.semi2 === undefined ? undefined : SEMIS[1][pick.semi2],
  ];
  const champion = pick.final === undefined ? undefined : finalists[pick.final];
  const choose = (key: keyof Pick, side: 0 | 1) => {
    setTouched(true);
    setPick(current => key === 'final' ? { ...current, final: side } : { ...current, [key]: side, final: undefined });
  };
  const slot = (key: keyof Pick, side: 0 | 1, code: string | undefined, label: string) => {
    const won = pick[key] === side, lost = pick[key] !== undefined && !won;
    return <button type="button" className={`fd-slot${won ? ' is-win' : ''}${lost ? ' is-out' : ''}`} disabled={!code}
      onClick={() => code && choose(key, side)} aria-pressed={won} aria-label={code ? `${code} wins ${label}` : `${label}: waiting`}>
      {code ? <motion.span key={code} initial={{ opacity: 0, x: -10, scale: .96 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={spring} className="fd-slot-team"><CollegeLogo code={code} size="sm" />{code}</motion.span> : <span className="fd-slot-tbd">Waiting</span>}
      {won && <motion.b initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring}>W</motion.b>}
    </button>;
  };
  return <div className="fd-bracket">
      <div className="fd-bracket-grid">
        <div className="fd-round"><small>Semifinal 1</small>{slot('semi1', 0, 'CCS', 'semifinal 1')}{slot('semi1', 1, 'CN', 'semifinal 1')}</div>
        <div className="fd-round fd-round-2"><small>Semifinal 2</small>{slot('semi2', 0, 'COE', 'semifinal 2')}{slot('semi2', 1, 'CA', 'semifinal 2')}</div>
        <div className="fd-round fd-round-final"><small>Final</small>{slot('final', 0, finalists[0], 'the final')}{slot('final', 1, finalists[1], 'the final')}</div>
        <div className="fd-round fd-round-champ"><small>Champion</small>
          <div className={`fd-champ${champion ? ' is-set' : ''}`} aria-live="polite">
            {champion ? <motion.span key={champion} initial={{ opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 16 }} className="fd-slot-team"><CollegeLogo code={champion} size="md" />{champion}</motion.span> : <span className="fd-slot-tbd">To be decided</span>}
          </div>
        </div>
      </div>
    <footer className="fd-bracket-foot">
      <span>{touched ? 'Tap a team to change the result. Spectators see each change at once.' : 'Tap any team to take over.'}</span>
      <button type="button" className="arena-outline arena-sm" onClick={() => { setTouched(true); setPick({}); }}><RotateCcw size={14} aria-hidden="true" />Reset</button>
    </footer>
  </div>;
}

/* ---------------------------------------------------------------- Fair play */

const SCANS = {
  android: { label: 'Android', rows: [
    ['Restricted apps', 'Device', 'Passed', 'ok'], ['Overlay permission', 'Device', 'Passed', 'ok'], ['Screen recording', 'Session', 'Recording', 'info'],
    ['Game files', 'MLBB', 'Unchanged', 'ok'], ['Companion heartbeat', 'Session', 'Online', 'ok'],
  ] },
  windows: { label: 'Windows', rows: [
    ['Blocked programs', 'PC', 'Passed', 'ok'], ['Injected modules', 'Dota 2', 'None found', 'ok'], ['Game file hashes', 'Dota 2', 'Unchanged', 'ok'],
    ['Macro software', 'PC', 'Needs review', 'warn'], ['Agent heartbeat', 'Session', 'Online', 'ok'],
  ] },
  iphone: { label: 'iPhone', rows: [
    ['Official game listing', 'Referee', 'Confirmed', 'ok'], ['Account matches roster', 'Referee', 'Confirmed', 'ok'], ['Device settings', 'Referee', 'Checked', 'ok'],
    ['Supervised recording', 'Session', 'Recording', 'info'], ['Clearance window', 'Session', '15 min', 'info'],
  ] },
} as const;
type Platform = keyof typeof SCANS;

export function FairPlayDemo() {
  const [platform, setPlatform] = useState<Platform>('android');
  const rows = SCANS[platform].rows;
  const step = useScript(rows.length * 2 + 1, 520, true, 3200);
  const flagged = rows.some(row => row[3] === 'warn');
  const done = step >= rows.length * 2 + 1;
  return <div className="fd-fair">
    <div className="fd-segment" role="tablist" aria-label="Device">
      {(Object.keys(SCANS) as Platform[]).map(id => <button key={id} type="button" role="tab" aria-selected={platform === id} onClick={() => setPlatform(id)}>
        {platform === id && <motion.span layoutId="fd-segment-pill" className="fd-segment-pill" transition={spring} />}<span>{SCANS[id].label}</span>
      </button>)}
    </div>
    <div className="fd-table" key={platform}>
      <header><strong>Live scan evaluation</strong><small>Scan results are stored privately for staff review.</small></header>
      <div className="fd-table-head" aria-hidden="true"><span>Check</span><span>Scope</span><span>Result</span></div>
      <ol>
        {rows.map((row, index) => {
          const visible = step > index * 2, resolved = step > index * 2 + 1;
          return <li key={row[0]} className={visible ? 'is-visible' : undefined}>
            <span>{visible ? row[0] : <i className="fd-skeleton" style={{ width: `${60 + (index * 17) % 30}%` }} />}</span>
            <span>{visible ? row[1] : <i className="fd-skeleton" style={{ width: '50%' }} />}</span>
            <span className={`fd-result is-${resolved ? row[3] : 'wait'}`}>{resolved ? row[2] : visible ? 'Checking' : ''}</span>
          </li>;
        })}
      </ol>
      <AnimatePresence>{done && <motion.footer key="verdict" {...rise} className={`fd-verdict${flagged ? ' is-warn' : ''}`}>
        {flagged ? 'One item needs a referee. The match waits until staff clear it.' : <><Check size={16} aria-hidden="true" />Cleared for the match</>}
      </motion.footer>}</AnimatePresence>
    </div>
  </div>;
}

/* ---------------------------------------------------------------- Ask Arena AI */

const QUESTIONS = [
  { id: 'next', tab: 'Next match', ask: 'Who plays next in MLBB?', answer: 'Next up is COE vs CA at 3:00 PM on the gym stage. It is the second semifinal, best of three. The winner meets CCS in the final.', card: { a: 'COE', b: 'CA', meta: 'Semifinal 2 · 3:00 PM' } },
  { id: 'table', tab: 'Standings', ask: 'How is CCS doing in Dota 2?', answer: 'CCS is 3 wins and 0 losses in the Dota 2 cup, with a 6 to 1 game record. They play the upper final next.', card: { a: 'CCS', b: 'CN', meta: 'Upper final · Bo3' } },
  { id: 'fil', tab: 'Filipino', ask: 'Sino nanalo sa MLBB kanina?', answer: 'Nanalo ang CCS laban sa CN, 2 to 1, sa unang semifinal. Sila na ang nasa final ng MLBB cup.', card: { a: 'CCS', b: 'CN', meta: 'Semifinal 1 · Final 2–1' } },
];

export function AiDemo() {
  const [index, setIndex] = useState(0);
  const q = QUESTIONS[index];
  const calm = useCalm();
  const [phase, setPhase] = useState<'ask' | 'think' | 'answer'>(calm ? 'answer' : 'ask');
  const asked = useTyped(q.ask, true, 45);
  const words = useMemo(() => q.answer.split(' '), [q.answer]);
  const [wordCount, setWordCount] = useState(calm ? words.length : 0);
  useEffect(() => { setPhase(calm ? 'answer' : 'ask'); setWordCount(calm ? words.length : 0); }, [index, calm, words.length]);
  useEffect(() => {
    if (calm) return;
    if (phase === 'ask' && asked.length === q.ask.length) { const t = window.setTimeout(() => setPhase('think'), 450); return () => window.clearTimeout(t); }
    if (phase === 'think') { const t = window.setTimeout(() => setPhase('answer'), 1300); return () => window.clearTimeout(t); }
    if (phase === 'answer' && wordCount < words.length) { const t = window.setTimeout(() => setWordCount(c => c + 1), 55); return () => window.clearTimeout(t); }
    if (phase === 'answer' && wordCount >= words.length) { const t = window.setTimeout(() => setIndex(i => (i + 1) % QUESTIONS.length), 4200); return () => window.clearTimeout(t); }
  }, [phase, asked, q.ask.length, wordCount, words.length, calm]);
  const finished = phase === 'answer' && wordCount >= words.length;

  return <div className="fd-ai">
    <div className="fd-ai-thread">
      <motion.div key={`ask-${q.id}`} {...rise} className="fd-bubble is-user">{asked}{asked.length < q.ask.length && <i className="fd-caret" />}</motion.div>
      <AnimatePresence mode="wait">
        {phase === 'think' && <motion.div key="think" {...rise} className="fd-thinking"><Sparkles size={14} aria-hidden="true" /><span>Checking the published records</span><TypingDots /></motion.div>}
        {phase === 'answer' && <motion.div key={`answer-${q.id}`} {...rise} className="fd-bubble is-ai">
          <span className="fd-ai-name"><img src="/arenahub-logo.svg" alt="" width="14" height="17" />Arena AI</span>
          <p>{words.slice(0, wordCount).join(' ')}{!finished && <i className="fd-caret" />}</p>
          <AnimatePresence>{finished && <motion.div key="card" {...rise} className="fd-ai-card">
            <span><CollegeLogo code={q.card.a} size="sm" />{q.card.a}</span><small>vs</small><span><CollegeLogo code={q.card.b} size="sm" />{q.card.b}</span><em>{q.card.meta}</em>
          </motion.div>}</AnimatePresence>
        </motion.div>}
      </AnimatePresence>
    </div>
    <div className="fd-segment" role="tablist" aria-label="Sample question">
      {QUESTIONS.map((item, i) => <button key={item.id} type="button" role="tab" aria-selected={index === i} onClick={() => setIndex(i)}>
        {index === i && <motion.span layoutId="fd-ai-pill" className="fd-segment-pill" transition={spring} />}<span>{item.tab}</span>
      </button>)}
    </div>
  </div>;
}
