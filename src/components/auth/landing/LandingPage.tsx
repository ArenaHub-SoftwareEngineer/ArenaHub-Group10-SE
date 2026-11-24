import React, { useEffect, useRef, useState } from 'react';
import {
  motion, useMotionTemplate, useMotionValue, useMotionValueEvent, useScroll, useSpring, useTransform,
  type MotionValue,
} from 'motion/react';
import { ArrowRight, Check, Eye, Play, QrCode, ShieldCheck } from '../../ui/Icons';
import { CollegeLogo } from '../../common/CollegeLogo';
import { GAME_ART_CREDIT } from '../../common/GameCover';
import { CAMPUS_SHORT_NAME } from '../../../lib/institution';
import { FeaturePreview, type FeaturePreviewKey } from '../FeatureShowcase';
import { LandingBackdrop } from './LandingBackdrop';
import { ArenaAiFilm } from '../../common/ArenaAiFilm';
import { useCalm } from '../../../lib/useCalm';
import { landingSignal } from './landingSignal';

const signalThinking = (thinking: boolean) => { landingSignal.aiPulse = thinking ? 1 : 0; };

type OpenAuth = (tab: 'signin' | 'signup' | 'qr') => void;

const PHOTO_CREDIT = 'Photos: Alexandros Giannakakis, Raman Shaunia, Alef Morais, Daniel Romero and Florian Olivo on Unsplash.';

/**
 * Scroll progress through a pinned chapter: 0 as its top enters, about .3 when it pins, about .7 when it
 * starts to leave, 1 when it is gone. With reduced motion it stays at .5 (everything fully shown, still).
 */
function useChapterProgress(ref: React.RefObject<HTMLElement | null>, calm: boolean) {
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const still = useMotionValue(0.5);
  const smooth = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.4 });
  return calm ? still : smooth;
}

/* ------------------------------------------------------------------ Hero */

function Hero({ onOpenAuth, calm }: { onOpenAuth: OpenAuth; calm: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const lift = useTransform(scrollYProgress, [0, 1], calm ? [0, 0] : [0, -160]);
  const fade = useTransform(scrollYProgress, [0, 0.75], calm ? [1, 1] : [1, 0]);
  const grow = useTransform(scrollYProgress, [0, 1], calm ? [1, 1] : [1, 1.18]);
  const rise = (i: number) => calm ? {} : {
    initial: { y: '105%', rotateX: -70, opacity: 0 },
    animate: { y: '0%', rotateX: 0, opacity: 1 },
    transition: { type: 'spring' as const, stiffness: 90, damping: 18, delay: 0.15 + i * 0.12 },
  };

  return <section ref={ref} className="lp-hero" data-chapter="0" aria-labelledby="landing-title">
    <motion.div className="lp-hero-copy" style={{ y: lift, opacity: fade }}>
      <p className="lp-hero-kicker"><span className="lp-live-dot" aria-hidden="true" />{CAMPUS_SHORT_NAME} esports, on every screen</p>
      <h1 id="landing-title" className="lp-hero-title">
        <span className="lp-mask"><motion.span className="lp-line is-thin" {...rise(0)}>Every campus</motion.span></span>
        <span className="lp-mask"><motion.span className="lp-line is-black" style={{ scale: grow, transformOrigin: 'left center' }} {...rise(1)}>match,</motion.span></span>
        <span className="lp-mask"><motion.span className="lp-line is-black is-brand" {...rise(2)}>live.</motion.span></span>
      </h1>
      <motion.p className="lp-hero-sub" initial={calm ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7, duration: 0.6 }}>
        Broadcasts, brackets, standings and fair play for every {CAMPUS_SHORT_NAME} tournament. On your phone or on a big screen.
      </motion.p>
      <motion.div className="lp-hero-actions" initial={calm ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.85, duration: 0.6 }}>
        <button type="button" className="lp-btn is-primary" onClick={() => onOpenAuth('signin')}>Sign in to ArenaHub <ArrowRight size={18} aria-hidden="true" /></button>
        <button type="button" className="lp-btn" onClick={() => onOpenAuth('qr')}><QrCode size={18} aria-hidden="true" />Scan spectator QR</button>
      </motion.div>
      <p className="lp-hero-note">Not a student? Scan a current student invitation QR, then sign in or create your own account.</p>
    </motion.div>
    <div className="lp-ticker" aria-hidden="true">
      <div className="lp-ticker-track">
        {Array.from({ length: 2 }, (_, k) => <span key={k}>
          <b>Live</b> MLBB · CCS 2–1 CN <i /> Dota 2 · Upper final 7:00 PM <i /> CODM · Lobby 3 drops at 5:30 PM <i /> Arena AI answers in English or Filipino <i />
        </span>)}
      </div>
    </div>
    <span className="lp-scroll-cue" aria-hidden="true"><i />Scroll</span>
  </section>;
}

/* ------------------------------------------------------------------ Chapter frame */

interface ChapterProps {
  index: number;
  id: string;
  label: string;
  giant: string;
  title: Array<{ text: string; tone?: 'thin' | 'brand' }>;
  body: string;
  side: 'left' | 'right';
  preview: FeaturePreviewKey;
  onPreview: (key: FeaturePreviewKey) => void;
  calm: boolean;
  visual: (p: MotionValue<number>) => React.ReactNode;
}

function Chapter({ index, id, label, giant, title, body, side, preview, onPreview, calm, visual }: ChapterProps) {
  const ref = useRef<HTMLElement>(null);
  const p = useChapterProgress(ref, calm);
  const dir = side === 'left' ? 1 : -1;
  const giantScale = useTransform(p, [0.05, 0.5, 0.95], [1.35, 1, 0.8]);
  const giantX = useTransform(p, [0, 1], [`${8 * dir}%`, `${-8 * dir}%`]);
  const giantOpacity = useTransform(p, [0.08, 0.3, 0.72, 0.92], [0, 1, 1, 0]);
  const copyOpacity = useTransform(p, [0.18, 0.32, 0.74, 0.88], [0, 1, 1, 0]);
  const copyY = useTransform(p, [0.18, 0.34, 0.74, 0.9], [80, 0, 0, -80]);

  return <section ref={ref} id={id} className={`lp-chapter is-${side}${calm ? ' is-calm' : ''}`} data-chapter={index} aria-labelledby={`${id}-title`}>
    <div className="lp-stage">
      <motion.span className="lp-giant" aria-hidden="true" style={{ scale: giantScale, x: giantX, opacity: giantOpacity }}>{giant}</motion.span>
      <div className="lp-visual">{visual(p)}</div>
      <motion.div className="lp-copy" style={{ opacity: copyOpacity, y: copyY }}>
        <p className="lp-chapter-label"><span>{String(index).padStart(2, '0')}</span>{label}</p>
        <h2 id={`${id}-title`} className="lp-chapter-title">
          {title.map((line, i) => <TitleLine key={line.text} p={p} i={i} tone={line.tone}>{line.text}</TitleLine>)}
        </h2>
        <p className="lp-chapter-body">{body}</p>
        <button type="button" className="lp-btn is-ghost" aria-haspopup="dialog" onClick={() => onPreview(preview)}>
          <Play size={16} aria-hidden="true" />Try the preview
        </button>
      </motion.div>
    </div>
  </section>;
}

function TitleLine({ p, i, tone, children }: { p: MotionValue<number>; i: number; tone?: 'thin' | 'brand'; children: React.ReactNode }) {
  const start = 0.2 + i * 0.035;
  const y = useTransform(p, [start, start + 0.12], ['110%', '0%']);
  const rotate = useTransform(p, [start, start + 0.12], [8, 0]);
  return <span className="lp-mask"><motion.span className={`lp-line${tone ? ` is-${tone}` : ''}`} style={{ y, rotate }}>{children}</motion.span></span>;
}

/** A photo card that swings in out of 3D space, its picture drifting slower than the card (parallax). */
function PosterPhoto({ p, src, alt, side, className = '', children }: { p: MotionValue<number>; src: string; alt: string; side: 'left' | 'right'; className?: string; children?: React.ReactNode }) {
  const dir = side === 'left' ? 1 : -1;
  const rotateY = useTransform(p, [0.08, 0.34, 0.7, 0.95], [-38 * dir, -8 * dir, -6 * dir, 24 * dir]);
  const rotateX = useTransform(p, [0.08, 0.34, 0.7, 0.95], [24, 4, 2, -18]);
  const z = useTransform(p, [0.08, 0.34, 0.7, 0.95], [-420, 0, 0, -260]);
  const opacity = useTransform(p, [0.08, 0.26, 0.78, 0.94], [0, 1, 1, 0]);
  const reveal = useTransform(p, [0.1, 0.36], [42, 0]);
  const clipPath = useMotionTemplate`inset(${reveal}% 0% ${reveal}% 0% round 28px)`;
  const imgY = useTransform(p, [0, 1], ['-9%', '9%']);
  return <motion.figure className={`lp-photo ${className}`} style={{ rotateY, rotateX, z, opacity }}>
    <motion.div className="lp-photo-clip" style={{ clipPath }}>
      <motion.img src={src} alt={alt} loading="lazy" decoding="async" style={{ y: imgY }} />
      <span className="lp-photo-shade" />
    </motion.div>
    {children}
  </motion.figure>;
}

/* ------------------------------------------------------------------ Chapter visuals */

function LiveVisual({ p }: { p: MotionValue<number> }) {
  const viewers = useTransform(p, [0.2, 0.7], [312, 1248]);
  const [count, setCount] = useState(312);
  useMotionValueEvent(viewers, 'change', v => setCount(Math.round(v)));
  const insetY = useTransform(p, [0, 1], [140, -140]);
  const stickerRotate = useTransform(p, [0.2, 0.5], [-28, -8]);
  const stickerScale = useTransform(p, [0.22, 0.36], [0, 1]);
  return <>
    <PosterPhoto p={p} src="/media/landing/cheer.webp" alt="A crowd cheering under stage lights" side="left">
      <div className="lp-badges">
        <span className="lp-badge-live"><i />Live</span>
        <span className="lp-badge-viewers"><Eye size={14} aria-hidden="true" />{count.toLocaleString()} watching</span>
      </div>
      <div className="lp-scorebug">
        <span><CollegeLogo code="CCS" size="sm" />CCS</span><b>2</b><i>–</i><b>1</b><span>CN<CollegeLogo code="CN" size="sm" /></span>
      </div>
    </PosterPhoto>
    <motion.img className="lp-inset" src="/media/landing/dim.webp" alt="" aria-hidden="true" loading="lazy" style={{ y: insetY }} />
    <motion.span className="lp-sticker" aria-hidden="true" style={{ rotate: stickerRotate, scale: stickerScale }}>Game 3<br /><b>Now</b></motion.span>
  </>;
}

function BracketVisual({ p }: { p: MotionValue<number> }) {
  const draw = useTransform(p, [0.26, 0.62], [0, 1]);
  const win = useTransform(p, [0.58, 0.68], [0, 1]);
  const champScale = useTransform(p, [0.6, 0.7], [0.4, 1]);
  return <PosterPhoto p={p} src="/media/landing/table4.webp" alt="Four students playing a mobile game at a tournament table" side="right" className="is-wide">
    <svg className="lp-bracket" viewBox="0 0 400 220" aria-hidden="true">
      <g className="lp-bracket-lines">
        {[[20, 30, 'CCS'], [20, 80, 'CN'], [20, 140, 'COE'], [20, 190, 'CA']].map(([x, y, name]) => <g key={String(name)}>
          <rect x={Number(x)} y={Number(y) - 15} width="92" height="30" rx="7" />
          <text x={Number(x) + 12} y={Number(y) + 5}>{name}</text>
        </g>)}
        <motion.path d="M112 30 H150 V55 H190 M112 80 H150 V55" style={{ pathLength: draw }} />
        <motion.path d="M112 140 H150 V165 H190 M112 190 H150 V165" style={{ pathLength: draw }} />
        <motion.path d="M282 55 H310 V110 H330 M282 165 H310 V110" style={{ pathLength: draw }} />
        <rect x="190" y="40" width="92" height="30" rx="7" /><text x="202" y="60">CCS</text>
        <rect x="190" y="150" width="92" height="30" rx="7" /><text x="202" y="170">COE</text>
      </g>
      <motion.g style={{ opacity: win, scale: champScale, transformOrigin: '360px 110px' }}>
        <circle cx="360" cy="110" r="30" className="lp-bracket-champ" />
        <text x="360" y="106" textAnchor="middle" className="lp-bracket-champ-label">Champion</text>
        <text x="360" y="122" textAnchor="middle" className="lp-bracket-champ-name">CCS</text>
      </motion.g>
    </svg>
  </PosterPhoto>;
}

const SCAN_STEPS = ['Phone checked for cheat apps', 'Screen recorder running', 'Referee confirms the room code'];

function FairVisual({ p }: { p: MotionValue<number> }) {
  const [done, setDone] = useState(0);
  const steps = useTransform(p, [0.3, 0.62], [0, SCAN_STEPS.length]);
  useMotionValueEvent(steps, 'change', v => setDone(Math.floor(v)));
  useEffect(() => { setDone(Math.floor(steps.get())); }, [steps]);
  const scanY = useTransform(p, [0.25, 0.65], ['0%', '100%']);
  const stamp = useTransform(p, [0.6, 0.68], [2.4, 1]);
  const stampOpacity = useTransform(p, [0.6, 0.66], [0, 1]);
  return <>
    <PosterPhoto p={p} src="/media/landing/intent.webp" alt="Two players focused on their match" side="left" className="is-tall">
      <motion.span className="lp-scanline" aria-hidden="true" style={{ top: scanY }} />
      <motion.span className="lp-stamp" style={{ scale: stamp, opacity: stampOpacity }}><ShieldCheck size={22} aria-hidden="true" />Cleared to play</motion.span>
    </PosterPhoto>
    <ol className="lp-checks" aria-label="Pre-match checks">
      {SCAN_STEPS.map((step, i) => <li key={step} className={i < done ? 'is-done' : i === done ? 'is-run' : ''}>
        <span aria-hidden="true">{i < done ? <Check size={14} /> : i + 1}</span>{step}
      </li>)}
    </ol>
  </>;
}

function AiVisual({ p }: { p: MotionValue<number> }) {
  const rotateX = useTransform(p, [0.08, 0.34, 0.7, 0.95], [30, 0, 0, -20]);
  const z = useTransform(p, [0.08, 0.34, 0.7, 0.95], [-380, 0, 0, -220]);
  const opacity = useTransform(p, [0.08, 0.26, 0.78, 0.94], [0, 1, 1, 0]);
  const photoY = useTransform(p, [0, 1], [180, -180]);
  return <>
    <motion.img className="lp-inset is-ai" src="/media/landing/controller.webp" alt="" aria-hidden="true" loading="lazy" style={{ y: photoY }} />
    <motion.div className="lp-reel-frame" style={{ rotateX, z, opacity }}><ArenaAiFilm onThinking={signalThinking} /></motion.div>
  </>;
}

/* ------------------------------------------------------------------ Games marquee */

const GAMES = [
  { name: 'Mobile Legends', short: 'MLBB', art: '/fairplay-mlbb.webp', note: '5v5 · Bo3 brackets' },
  { name: 'Dota 2', short: 'Dota 2', art: '/fairplay-dota2.jpg', note: 'Double elimination' },
  { name: 'Call of Duty: Mobile', short: 'CODM', art: '/fairplay-codm.webp', note: 'Multiplayer and Battle Royale' },
];

function Games({ calm }: { calm: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const a = useTransform(scrollYProgress, [0, 1], calm ? ['0%', '0%'] : ['5%', '-35%']);
  const b = useTransform(scrollYProgress, [0, 1], calm ? ['-20%', '-20%'] : ['-40%', '0%']);
  return <section ref={ref} className="lp-games" data-chapter="5" aria-labelledby="lp-games-title">
    <h2 id="lp-games-title" className="lp-sr">Games on ArenaHub</h2>
    <motion.p className="lp-marquee" aria-hidden="true" style={{ x: a }}>Mobile Legends <i /> Dota 2 <i /> Call of Duty Mobile <i /> Mobile Legends <i /> Dota 2</motion.p>
    <div className="lp-game-row">
      {GAMES.map((game, i) => <GameCard key={game.name} game={game} i={i} calm={calm} />)}
    </div>
    <motion.p className="lp-marquee is-outline" aria-hidden="true" style={{ x: b }}>Brackets <i /> Broadcasts <i /> Standings <i /> Fair play <i /> Brackets <i /> Broadcasts</motion.p>
  </section>;
}

function GameCard({ game, i, calm }: { game: typeof GAMES[number]; i: number; calm: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const rx = useSpring(0, { stiffness: 180, damping: 18 });
  const ry = useSpring(0, { stiffness: 180, damping: 18 });
  const glareX = useTransform(ry, [-14, 14], ['0%', '100%']);
  const glare = useMotionTemplate`radial-gradient(circle at ${glareX} 30%, rgb(255 255 255 / .22), transparent 55%)`;
  return <motion.article ref={ref} className="lp-game" style={{ rotateX: rx, rotateY: ry }}
    initial={calm ? false : { opacity: 0, y: 120, rotateZ: (i - 1) * 6 }} whileInView={{ opacity: 1, y: 0, rotateZ: (i - 1) * 2.5 }}
    viewport={{ once: true, amount: 0.35 }} transition={{ type: 'spring', stiffness: 80, damping: 16, delay: i * 0.12 }}
    onPointerMove={event => {
      if (calm || event.pointerType !== 'mouse') return;
      const box = event.currentTarget.getBoundingClientRect();
      ry.set(((event.clientX - box.left) / box.width - 0.5) * 28);
      rx.set(-((event.clientY - box.top) / box.height - 0.5) * 22);
    }}
    onPointerLeave={() => { rx.set(0); ry.set(0); }}>
    <img src={game.art} alt="" loading="lazy" decoding="async" />
    <motion.span className="lp-game-glare" style={{ background: glare }} aria-hidden="true" />
    <div className="lp-game-copy"><strong>{game.short}</strong><span>{game.name}</span><small>{game.note}</small></div>
  </motion.article>;
}

/* ------------------------------------------------------------------ Finale */

function Finale({ onOpenAuth, calm }: { onOpenAuth: OpenAuth; calm: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end end'] });
  const leftY = useTransform(scrollYProgress, [0, 1], calm ? [0, 0] : [220, -10]);
  const rightY = useTransform(scrollYProgress, [0, 1], calm ? [0, 0] : [320, 30]);
  const scale = useTransform(scrollYProgress, [0, 0.8], calm ? [1, 1] : [0.7, 1]);
  return <section ref={ref} className="lp-finale" data-chapter="6" aria-labelledby="lp-finale-title">
    <motion.img className="lp-finale-photo is-left" src="/media/landing/smile.webp" alt="" aria-hidden="true" loading="lazy" style={{ y: leftY }} />
    <motion.img className="lp-finale-photo is-right" src="/media/landing/chair.webp" alt="" aria-hidden="true" loading="lazy" style={{ y: rightY }} />
    <motion.div className="lp-finale-copy" style={{ scale }}>
      <h2 id="lp-finale-title" className="lp-finale-title">
        <span className="is-thin">Your campus.</span>
        <span>Your <em>arena.</em></span>
      </h2>
      <p>Sign in with your school account to watch, follow your college and ask Arena AI.</p>
      <div className="lp-hero-actions is-center">
        <button type="button" className="lp-btn is-primary" onClick={() => onOpenAuth('signin')}>Sign in <ArrowRight size={18} aria-hidden="true" /></button>
        <button type="button" className="lp-btn" onClick={() => onOpenAuth('signup')}>Create an account</button>
      </div>
    </motion.div>
  </section>;
}

/* ------------------------------------------------------------------ Page */

export function LandingPage({ onOpenAuth }: { onOpenAuth: OpenAuth }) {
  const calm = useCalm();
  const [preview, setPreview] = useState<FeaturePreviewKey | null>(null);

  return <div className={`lp${calm ? ' is-calm' : ''}`}>
    <LandingBackdrop />
    <Hero onOpenAuth={onOpenAuth} calm={calm} />
    <Chapter index={1} id="lp-live" label="Watch live" giant="Live" side="left" preview="watch" onPreview={setPreview} calm={calm}
      title={[{ text: 'Every play,', tone: 'thin' }, { text: 'every' }, { text: 'screen.', tone: 'brand' }]}
      body="Broadcasts with live scores, viewer counts and match chat, on your phone between classes or on the big screen in the gym."
      visual={p => <LiveVisual p={p} />} />
    <Chapter index={2} id="lp-bracket" label="Follow the tournament" giant="Final" side="right" preview="bracket" onPreview={setPreview} calm={calm}
      title={[{ text: 'The road', tone: 'thin' }, { text: 'to the' }, { text: 'final.', tone: 'brand' }]}
      body="Brackets, match times and standings update the moment organizers publish a result. Follow your college all the way up."
      visual={p => <BracketVisual p={p} />} />
    <Chapter index={3} id="lp-fair" label="Play fair" giant="Fair" side="left" preview="fair" onPreview={setPreview} calm={calm}
      title={[{ text: 'Scan in.', tone: 'thin' }, { text: 'Play' }, { text: 'clean.', tone: 'brand' }]}
      body="Players finish the required device scans before the match starts, so every win on the board is a fair one."
      visual={p => <FairVisual p={p} />} />
    <Chapter index={4} id="lp-ai" label="Ask Arena AI" giant="Ask" side="right" preview="ai" onPreview={setPreview} calm={calm}
      title={[{ text: 'Just', tone: 'thin' }, { text: 'ask.', tone: 'brand' }]}
      body="Who plays next, who won, how your college is doing. Arena AI answers from the published records, in English or Filipino."
      visual={p => <AiVisual p={p} />} />
    <Games calm={calm} />
    <Finale onOpenAuth={onOpenAuth} calm={calm} />
    <footer className="lp-footer">
      <span>ArenaHub · {CAMPUS_SHORT_NAME} · 2026</span>
      <span className="ah-footer-credit">{GAME_ART_CREDIT} {PHOTO_CREDIT}</span>
    </footer>
    <FeaturePreview feature={preview} onClose={() => setPreview(null)} />
  </div>;
}
