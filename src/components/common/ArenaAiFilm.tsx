import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  motion, useAnimationFrame, useMotionTemplate, useMotionValue, useMotionValueEvent, useTransform,
  type MotionValue,
} from 'motion/react';
import { Brain } from 'lucide-react';
import { ArrowUp, CalendarDays, Check, ChevronDown, Pause, Play, Sparkles, Trophy, Users, GitBranch } from '../ui/Icons';
import { CollegeLogo } from './CollegeLogo';
import { useCalm } from '../../lib/useCalm';
import './arenaAiFilm.css';

/**
 * "Arena AI, the film": a short motion piece in the spirit of a product launch reel.
 *   1. A single orange stroke draws the ArenaHub shield, it fills, glows and turns once.
 *   2. The mark steps aside for the "Arena AI" wordmark; the composer and its chips blur into focus.
 *   3. The question types itself while the camera pushes in; a cursor presses Send.
 *   4. The camera flies through into the answer: working steps tick, the answer streams in, the match card lands.
 *   5. The shield returns and "ArenaHub" types out beside it. Then the next question.
 * One clock (`t`, seconds) drives every element, so the whole film can pause, skip and hold still.
 */

export interface FilmQuestion {
  ask: string;
  steps: [string, string, string];
  answer: string;
  card: { a: string; b: string; meta: string };
}

export const FILM_QUESTIONS: FilmQuestion[] = [
  {
    ask: 'Who plays next in MLBB?',
    steps: ['Reading the published schedule', 'Finding the next MLBB match', 'Writing the answer'],
    answer: 'COE vs CA at 3:00 PM on the gym stage. Semifinal 2, best of three. The winner meets CCS in the final.',
    card: { a: 'COE', b: 'CA', meta: 'Semifinal 2 · 3:00 PM' },
  },
  {
    ask: 'Sino nanalo sa MLBB kanina?',
    steps: ['Binabasa ang mga resulta', 'Hinahanap ang laban kanina', 'Isinusulat ang sagot'],
    answer: 'Nanalo ang CCS laban sa CN, 2 to 1, sa unang semifinal. Sila na ang nasa final.',
    card: { a: 'CCS', b: 'CN', meta: 'Semifinal 1 · Final 2–1' },
  },
  {
    ask: 'How is CCS doing in Dota 2?',
    steps: ['Reading the standings', 'Adding up CCS games', 'Writing the answer'],
    answer: 'CCS is 3 and 0 in the Dota 2 cup with a 6 to 1 game record. The upper final is next.',
    card: { a: 'CCS', b: 'CN', meta: 'Upper final · Bo3' },
  },
];

const LENGTH = 12.8;          // seconds per question
const STILL_AT = 9.4;         // the frame shown with reduced motion: answer and card on screen
const TYPE = [3.55, 4.85];    // the question types itself
const STEP_AT = [6.45, 6.85, 7.25];
const WORDS = [7.55, 9.0];    // the answer streams in
const CARD_AT = 9.05;
const BRAND_TYPE = [10.75, 11.85];

// The ArenaHub shield, split so each piece can be drawn as one stroke (public/arenahub-logo.svg).
const SHIELD = 'M212 0 288 18V134L340 179V30L424 51V315C424 372 366 425 212 508C58 425 0 372 0 315V51L84 30V179L136 134V18Z';
const STRIPS = ['M20 67 40 61V368Q20 343 20 315Z', 'M384 61 404 67V315Q404 343 384 368Z'];
const LETTER = 'M195 144H229Q239 144 244 156L276 234Q282 251 296 251H314Q329 251 332 267L346 338Q350 356 334 356H295Q282 356 278 343L262 305Q256 289 243 289H181Q168 289 162 305L146 343Q142 356 129 356H90Q74 356 78 338L92 267Q95 251 110 251H128Q142 251 148 234L180 156Q185 144 195 144Z';
const NOTCH = 'M212 190 188 251H236Z';
const FULL = `${SHIELD}${STRIPS.join('')}${LETTER}${NOTCH}`;

const ease = (x: number) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

/** Interpolates `t` across keyframes, clamped, eased per segment. */
function useAt(t: MotionValue<number>, input: number[], output: number[], curve: (x: number) => number = ease) {
  return useTransform(t, input, output, { clamp: true, ease: curve });
}

/** Integer derived from the clock; re-renders only when it changes. */
function useCount(t: MotionValue<number>, read: (time: number) => number) {
  const [value, setValue] = useState(() => read(t.get()));
  const reader = useRef(read);
  reader.current = read;
  useMotionValueEvent(t, 'change', time => {
    const next = reader.current(time);
    setValue(previous => previous === next ? previous : next);
  });
  useEffect(() => { setValue(reader.current(t.get())); });
  return value;
}

const CAMERA = [3.3, 4.9, 5.7, 6.15, 6.16];
/**
 * The camera: push in on the composer while the question types, then fly through it into the answer.
 * `zoom` softens the move on narrow films so the question stays readable. Back at rest from 6.16 s.
 */
function useCamera(t: MotionValue<number>, zoom: MotionValue<number>) {
  const rawScale = useAt(t, CAMERA, [1, 1.34, 1.34, 2.3, 1]);
  const rawX = useAt(t, CAMERA, [0, -2.5, -2.5, -9, 0]);
  const rawY = useAt(t, CAMERA, [0, -3, -3, -5, 0]);
  const scale = useTransform(() => 1 + (rawScale.get() - 1) * zoom.get());
  const x = useMotionTemplate`${useTransform(() => rawX.get() * zoom.get())}cqw`;
  const y = useMotionTemplate`${useTransform(() => rawY.get() * zoom.get())}cqw`;
  return { scale, x, y };
}

const progress = (time: number, [from, to]: number[], total: number) => Math.max(0, Math.min(total, Math.floor(((time - from) / (to - from)) * total + (time >= to ? 1 : 0))));

export function ArenaAiFilm({ className = '', questions = FILM_QUESTIONS, onThinking }: {
  className?: string;
  questions?: FilmQuestion[];
  /** Raised while Arena AI is "thinking" (for scenes that react, such as the welcome page's particle orb). */
  onThinking?: (thinking: boolean) => void;
}) {
  const calm = useCalm();
  const host = useRef<HTMLDivElement>(null);
  const t = useMotionValue(calm ? STILL_AT : 0);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const item = questions[index % questions.length];

  useEffect(() => {
    const io = new IntersectionObserver(entries => setInView(entries[0]?.isIntersecting ?? false), { threshold: 0.25 });
    if (host.current) io.observe(host.current);
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);
  // Narrow films (the 4:5 phone frame) get a gentler camera.
  const zoom = useMotionValue(1);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const ro = new ResizeObserver(([entry]) => zoom.set(entry.contentRect.width <= 560 ? 0.35 : 1));
    ro.observe(node);
    return () => ro.disconnect();
  }, [zoom]);
  useEffect(() => { if (calm) t.set(STILL_AT); }, [calm, t]);

  useAnimationFrame((_, delta) => {
    if (calm || paused || !inView || !visible) return;
    const next = t.get() + Math.min(delta, 64) / 1000;
    if (next >= LENGTH) { t.set(0); setIndex(i => (i + 1) % questions.length); }
    else t.set(next);
  });

  const thinking = useCount(t, time => time >= 6.2 && time < WORDS[0] ? 1 : 0) === 1;
  useEffect(() => { onThinking?.(thinking && !calm); }, [thinking, calm, onThinking]);
  useEffect(() => () => onThinking?.(false), [onThinking]);

  const jump = (next: number) => { setIndex(next); t.set(calm ? STILL_AT : 0); };

  return <div ref={host} className={`aif${calm ? ' is-calm' : ''} ${className}`} role="group" aria-roledescription="animation"
    aria-label="Arena AI answering a sample question">
    <p className="aif-sr" aria-live="off">{`Question: ${item.ask} Arena AI: ${item.answer}`}</p>
    <div className="aif-screen" aria-hidden="true">
      <Backdrop t={t} />
      <Camera t={t} zoom={zoom} item={item} />
      <Answer t={t} item={item} index={index} />
      <Lockup t={t} zoom={zoom} />
      <span className="aif-vignette" />
    </div>
    <div className="aif-controls">
      {!calm && <button type="button" className="aif-play" aria-label={paused ? 'Play the Arena AI animation' : 'Pause the Arena AI animation'} onClick={() => setPaused(p => !p)}>
        {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
      </button>}
      <div className="aif-dots" role="tablist" aria-label="Sample question">
        {questions.map((entry, i) => <button key={entry.ask} type="button" role="tab" aria-selected={i === index} aria-label={entry.ask} onClick={() => jump(i)} />)}
      </div>
    </div>
  </div>;
}

/* ---------------------------------------------------------------- Scenes */

function Backdrop({ t }: { t: MotionValue<number> }) {
  const glow = useAt(t, [0.9, 1.8, 2.6, 4.8, 6.0, 6.6, 9.6, 10.6, 12.2, 12.8], [0, .55, .8, 1, .7, .85, .85, .6, .6, 0]);
  const scale = useAt(t, [0, 2.6, 5.4, 6.2, 12.8], [.7, 1, 1.25, 1, 1.1]);
  return <motion.span className="aif-glow" style={{ opacity: glow, scale }} />;
}

/** The mark and the wordmark beside it: "Arena AI" in the opening, "ArenaHub" in the closing. */
function Lockup({ t, zoom }: { t: MotionValue<number>; zoom: MotionValue<number> }) {
  const closing = useCount(t, time => time >= 9.9 ? 1 : 0) === 1;
  const word = closing ? 'ArenaHub' : 'Arena AI';
  const shown = useCount(t, time => closing ? progress(time, BRAND_TYPE, 8) : progress(time, [2.25, 2.85], 8));

  // Opening: big centre mark -> small mark up top. Closing: big centre mark with the wordmark typing.
  const top = useAt(t, [0, 2.15, 2.85, 9.89, 9.9], [47, 47, 22, 22, 48]);
  const markW = useAt(t, [0, 2.15, 2.85, 9.89, 9.9, 10.55, 11.0], [19, 19, 6.4, 6.4, 17, 17, 10.5]);
  const font = useAt(t, [0, 9.89, 9.9], [5.4, 5.4, 8.6]);
  const gap = useAt(t, [0, 2.2, 2.6, 9.89, 9.9, 10.6, 10.9], [0, 0, 1.6, 1.6, 0, 0, 2]);
  const opacity = useAt(t, [0, 0.15, 5.75, 6.15, 9.9, 10.05, 12.25, 12.75], [0, 1, 1, 0, 0, 1, 1, 0]);
  const blur = useAt(t, [3.3, 4.6, 5.75, 6.15, 9.89, 9.9, 10.45], [0, 2.5, 2.5, 10, 10, 7, 0]);
  const wordFrac = useAt(t, [0, 2.2, 2.9, 9.89, 9.9, BRAND_TYPE[0], BRAND_TYPE[1]], [0, 0, 1, 1, 0, 0, 1], x => x);

  // The camera's push-in also moves the opening lockup (it sits in the same "world" as the composer).
  const { scale, x, y } = useCamera(t, zoom);

  const measure = useRef<HTMLSpanElement>(null);
  const [wordW, setWordW] = useState(0);
  useLayoutEffect(() => {
    const node = measure.current;
    if (!node) return;
    const sync = () => setWordW(node.scrollWidth);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(node);
    return () => ro.disconnect();
  }, [word]);
  const boxW = useTransform(wordFrac, v => v * wordW);

  return <motion.div className="aif-world" style={{ scale, x, y }}>
    <motion.div className="aif-lockup" style={{
      top: useMotionTemplate`${top}%`, gap: useMotionTemplate`calc(${gap}cqw * var(--aif-k))`, opacity, filter: useMotionTemplate`blur(${blur}px)`,
    }}>
      <Mark t={t} width={markW} />
      <motion.span className={`aif-word${closing ? ' is-brand' : ''}`} style={{ width: boxW, fontSize: useMotionTemplate`calc(${font}cqw * var(--aif-k))` }}>
        <span ref={measure} className="aif-word-inner">
          {Array.from(word).map((ch, i) => <span key={`${word}-${i}`} className={i < shown ? 'is-on' : ''}>{ch === ' ' ? ' ' : ch}</span>)}
        </span>
      </motion.span>
    </motion.div>
  </motion.div>;
}

function Mark({ t, width }: { t: MotionValue<number>; width: MotionValue<number> }) {
  // Draw: the shield outline first, then the inner strips, the A and its notch. Repeat for the closing turn.
  const shield = useAt(t, [0.25, 1.35], [0, 1], easeOut);
  const strips = useAt(t, [0.6, 1.25], [0, 1], easeOut);
  const letter = useAt(t, [0.75, 1.45], [0, 1], easeOut);
  const notch = useAt(t, [1.05, 1.45], [0, 1], easeOut);
  const stroke = useAt(t, [0.2, 0.3, 1.5, 1.95], [0, 1, 1, 0]);
  const fill = useAt(t, [1.3, 1.85], [0, 1]);
  const turn = useAt(t, [1.55, 2.4, 9.9, 10.2, 10.95], [0, 360, 360, 360, 720]);
  const pop = useAt(t, [1.4, 1.7, 2.0, 9.95, 10.25, 10.6], [1, 1.07, 1, 1, 1.06, 1]);
  const halo = useAt(t, [1.3, 1.75, 2.6, 9.95, 10.4, 11.4], [0, 1, .45, 0, .9, .5]);
  return <motion.span className="aif-mark" style={{ width: useMotionTemplate`calc(${width}cqw * var(--aif-k))`, rotateY: turn, scale: pop }}>
    <motion.span className="aif-halo" style={{ opacity: halo }} />
    <svg viewBox="-8 -8 440 524">
      <motion.path d={FULL} className="aif-fill" style={{ opacity: fill }} />
      <motion.g className="aif-stroke" style={{ opacity: stroke }}>
        <motion.path d={SHIELD} style={{ pathLength: shield }} />
        {STRIPS.map(d => <motion.path key={d} d={d} style={{ pathLength: strips }} />)}
        <motion.path d={LETTER} style={{ pathLength: letter }} />
        <motion.path d={NOTCH} style={{ pathLength: notch }} />
      </motion.g>
    </svg>
  </motion.span>;
}

const CHIPS = [
  { label: 'Schedule', Icon: CalendarDays },
  { label: 'Standings', Icon: Trophy },
  { label: 'Brackets', Icon: GitBranch },
  { label: 'Rosters', Icon: Users },
];

/** The composer, its chips and the cursor: everything the camera pushes into. */
function Camera({ t, zoom, item }: { t: MotionValue<number>; zoom: MotionValue<number>; item: FilmQuestion }) {
  const { scale, x, y } = useCamera(t, zoom);
  const opacity = useAt(t, [2.65, 3.25, 5.75, 6.1], [0, 1, 1, 0]);
  const blur = useAt(t, [2.65, 3.3, 5.75, 6.1], [12, 0, 0, 16]);
  const lift = useAt(t, [2.65, 3.3], [3, 0], easeOut);
  const typed = useCount(t, time => progress(time, TYPE, item.ask.length));
  const armed = typed >= item.ask.length;
  const pressed = useCount(t, time => time >= 5.42 && time < 5.6 ? 1 : 0) === 1;
  const sent = useCount(t, time => time >= 5.5 ? 1 : 0) === 1;

  return <motion.div className="aif-world" style={{ scale, x, y }}>
    <motion.div className="aif-composer-wrap" style={{ opacity, filter: useMotionTemplate`blur(${blur}px)`, y: useMotionTemplate`${lift}cqw` }}>
      <div className="aif-composer">
        <p className="aif-ask">
          {typed ? item.ask.slice(0, typed) : <span className="aif-placeholder">Ask Arena anything…</span>}
          {!sent && <i className="aif-caret" />}
        </p>
        <div className="aif-composer-foot">
          <span className="aif-mode"><Brain size={13} aria-hidden="true" />Think<ChevronDown size={12} aria-hidden="true" /></span>
          <span className={`aif-send${armed ? ' is-armed' : ''}${pressed ? ' is-pressed' : ''}${sent ? ' is-sent' : ''}`}>
            <ArrowUp size={16} aria-hidden="true" />
            <Cursor t={t} />
          </span>
        </div>
      </div>
      <div className="aif-chips">
        {CHIPS.map(({ label, Icon }, i) => <Chip key={label} t={t} i={i}><Icon size={12} aria-hidden="true" />{label}</Chip>)}
      </div>
    </motion.div>
  </motion.div>;
}

function Chip({ t, i, children }: { t: MotionValue<number>; i: number; children: React.ReactNode }) {
  const start = 2.95 + i * 0.09;
  const opacity = useAt(t, [start, start + 0.35], [0, 1]);
  const y = useAt(t, [start, start + 0.4], [1.6, 0], easeOut);
  return <motion.span className="aif-chip" style={{ opacity, y: useMotionTemplate`${y}cqw` }}>{children}</motion.span>;
}

function Cursor({ t }: { t: MotionValue<number> }) {
  const opacity = useAt(t, [4.85, 5.05, 5.7, 5.85], [0, 1, 1, 0]);
  const x = useAt(t, [4.85, 5.4], [7, 0], easeOut);
  const y = useAt(t, [4.85, 5.4], [6, 0], easeOut);
  const press = useAt(t, [5.42, 5.5, 5.6], [1, .82, 1]);
  return <motion.svg className="aif-cursor" viewBox="0 0 24 24" style={{ opacity, scale: press, x: useMotionTemplate`${x}cqw`, y: useMotionTemplate`${y}cqw` }}>
    <path d="M4 2.5 20 12l-7.2 1.6L9.4 21z" />
  </motion.svg>;
}

/** The answer, arriving through the fly-through and leaving before the shield returns. */
function Answer({ t, item, index }: { t: MotionValue<number>; item: FilmQuestion; index: number }) {
  const opacity = useAt(t, [6.05, 6.5, 9.75, 10.1], [0, 1, 1, 0]);
  const blur = useAt(t, [6.05, 6.6, 9.75, 10.1], [14, 0, 0, 12]);
  const scale = useAt(t, [6.05, 6.7, 9.75, 10.1], [1.12, 1, 1, .95]);
  const words = item.answer.split(' ');
  const steps = useCount(t, time => STEP_AT.filter(at => time >= at + 0.38).length);
  const running = useCount(t, time => STEP_AT.findIndex(at => time >= at && time < at + 0.38));
  const shown = useCount(t, time => progress(time, WORDS, words.length));
  const card = useCount(t, time => time >= CARD_AT ? 1 : 0) === 1;

  return <motion.div className="aif-answer" style={{ opacity, scale, filter: useMotionTemplate`blur(${blur}px)` }}>
    <p className="aif-question">{item.ask}</p>
    <ol className="aif-steps">
      {item.steps.map((label, i) => <li key={`${index}-${label}`} className={i < steps ? 'is-done' : i === running ? 'is-run' : ''}>
        <span className="aif-step-mark">{i < steps ? <Check size={11} aria-hidden="true" /> : null}</span>{label}
      </li>)}
    </ol>
    <div className="aif-reply">
      <span className="aif-name"><Sparkles size={13} aria-hidden="true" />Arena AI</span>
      <p>{words.slice(0, shown).map((word, i) => <span key={`${index}-${i}`} className="aif-w">{word} </span>)}</p>
      <div className={`aif-card${card ? ' is-in' : ''}`}>
        <span><CollegeLogo code={item.card.a} size="sm" />{item.card.a}</span><small>vs</small>
        <span><CollegeLogo code={item.card.b} size="sm" />{item.card.b}</span><em>{item.card.meta}</em>
      </div>
    </div>
  </motion.div>;
}
