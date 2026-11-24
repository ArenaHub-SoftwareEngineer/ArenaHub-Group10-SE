import type { BracketDraft, Match, Team } from './types';
import { matchName } from './matchName';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { bracketMotif } from '../components/common/BracketTeamBadge';
import { teamBadgeColor, teamBadgeImage, teamInitials, type TeamBadgeStyle } from './bracketAppearance';

const CARD_WIDTH = 248;
const CARD_HEIGHT = 72;
const ROUND_GAP = 54;
const ROW_GAP = 32;
const HEADER_HEIGHT = 132;
const EDGE = 44;
const CHAMPION_WIDTH = 176;

type ExportBadge = { badge: TeamBadgeStyle; image?: HTMLImageElement };
type ExportBadges = ReadonlyMap<string, ExportBadge>;

async function loadBadges(styles: Record<string, TeamBadgeStyle> = {}): Promise<ExportBadges> {
  const entries = Object.entries(styles);
  const icons = entries.flatMap(([id, badge]) => {
    const Icon = badge.image ? undefined : bracketMotif(badge.motif);
    return Icon ? [createElement(Icon, { key: id, id, size: 32, color: teamBadgeColor(badge.color) ?? '#e0ddef' })] : [];
  });
  const iconSources = new Map<string, string>();
  if (icons.length) {
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      flushSync(() => root.render(icons));
      for (const svg of container.querySelectorAll('svg')) {
        const id = svg.id;
        svg.removeAttribute('id');
        iconSources.set(id, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.outerHTML)}`);
      }
    } finally {
      root.unmount();
    }
  }
  const loaded = await Promise.all(entries.map(async ([id, badge]) => {
    const src = teamBadgeImage(badge.image) ?? iconSources.get(id);
    if (!src) return [id, { badge }] as const;
    const image = new Image();
    image.src = src;
    await image.decode().catch(() => undefined);
    return [id, { badge, image: image.naturalWidth ? image : undefined }] as const;
  }));
  return new Map(loaded);
}

function drawBadge(context: CanvasRenderingContext2D, badges: ExportBadges, team: Team, x: number, y: number) {
  const entry = badges.get(team.id);
  const accent = teamBadgeColor(entry?.badge.color) ?? '#b8bbca';
  const radius = 11;
  context.save();
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = '#2a2b40';
  context.fill();
  context.strokeStyle = accent;
  context.lineWidth = 1;
  context.stroke();
  if (entry?.image) {
    const padding = entry.badge.image ? 1 : 4;
    context.clip();
    const edge = (radius - padding) * 2;
    context.drawImage(entry.image, x - edge / 2, y - edge / 2, edge, edge);
  } else {
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = accent;
    context.font = '700 9px Arial, sans-serif';
    context.fillText(teamInitials(team.name), x, y);
  }
  context.restore();
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function fitText(context: CanvasRenderingContext2D, value: string, maxWidth: number) {
  if (context.measureText(value).width <= maxWidth) return value;
  let text = value;
  while (text.length > 1 && context.measureText(`${text}…`).width > maxWidth) {
    text = text.slice(0, -1);
  }
  return `${text}…`;
}

function safeFileName(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'tournament-bracket';
}

function teamName(team: Team | undefined, fallback: string) {
  return team?.name || fallback;
}

function matchCenter(roundIndex: number, matchIndex: number) {
  const slot = CARD_HEIGHT + ROW_GAP;
  const factor = 2 ** roundIndex;
  return ((factor - 1) * slot) / 2 + matchIndex * factor * slot + CARD_HEIGHT / 2;
}

function drawTeamRow(
  context: CanvasRenderingContext2D,
  match: Match,
  team: Team | undefined,
  row: 1 | 2,
  x: number,
  y: number,
  badges: ExportBadges,
) {
  const isBye = Boolean(team?.isBye || team?.name === 'BYE');
  const winner = Boolean(team && match.winnerId === team.id);
  const score = row === 1 ? match.score.team1Score : match.score.team2Score;

  context.fillStyle = winner ? '#ff7a45' : '#7f8491';
  context.font = '600 11px Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  roundedRect(context, x + 10, y + 9, 22, 20, 4);
  context.fillStyle = '#292b31';
  context.fill();
  context.fillStyle = winner ? '#ff8a5b' : '#9297a4';
  context.fillText(String(team?.seed ?? '–'), x + 21, y + 19);
  if (team && !isBye) drawBadge(context, badges, team, x + 47, y + 19);

  context.textAlign = 'left';
  context.fillStyle = isBye ? '#858a97' : winner ? '#ff8a5b' : '#f4f4f5';
  context.font = `${winner ? '700' : '600'} 14px Arial, sans-serif`;
  context.fillText(
    fitText(context, isBye ? 'BYE (AUTOMATIC ADVANCE)' : teamName(team, 'TBD'), CARD_WIDTH - 104),
    x + 65,
    y + 19,
  );

  roundedRect(context, x + CARD_WIDTH - 36, y + 8, 25, 22, 5);
  context.fillStyle = '#2a2b40';
  context.fill();
  context.textAlign = 'center';
  context.fillStyle = '#f4f4f5';
  context.font = '700 14px Arial, sans-serif';
  context.fillText(isBye ? '–' : String(score), x + CARD_WIDTH - 23.5, y + 19);
}

function drawMatchCard(
  context: CanvasRenderingContext2D,
  match: Match,
  x: number,
  y: number,
  isFinal: boolean,
  badges: ExportBadges,
  goldTheme: boolean,
) {
  roundedRect(context, x, y, CARD_WIDTH, CARD_HEIGHT, 9);
  context.fillStyle = goldTheme ? '#20213a' : isFinal ? '#211d16' : '#202126';
  context.fill();
  context.strokeStyle = isFinal ? '#9a7521' : '#393c45';
  context.lineWidth = 1;
  context.stroke();

  context.beginPath();
  context.moveTo(x, y + CARD_HEIGHT / 2);
  context.lineTo(x + CARD_WIDTH, y + CARD_HEIGHT / 2);
  context.strokeStyle = '#30323a';
  context.stroke();

  drawTeamRow(context, match, match.team1, 1, x, y, badges);
  drawTeamRow(context, match, match.team2, 2, x, y + CARD_HEIGHT / 2, badges);
}

export async function downloadBracketPng(draft: BracketDraft) {
  if (!draft.matches.length) throw new Error('Create a bracket before downloading it.');
  const staged = draft.format.toLowerCase().replaceAll('-', ' ') !== 'single elimination';
  const goldTheme = draft.appearance?.theme === 'navy-gold';
  const badges = await loadBadges(draft.appearance?.teams);
  const maxRound = Math.max(...draft.matches.map(match => match.round), 1);
  const rounds = Array.from({ length: maxRound }, (_, index) =>
    draft.matches.filter(match => match.round === index + 1),
  );
  const firstRoundCount = Math.max(staged ? Math.max(...rounds.map(round => round.length)) : rounds[0]?.length || 1, 1);
  const treeHeight = Math.max(firstRoundCount * (CARD_HEIGHT + ROW_GAP), 390);
  const contentWidth = EDGE * 2 + rounds.length * (CARD_WIDTH + ROUND_GAP) + (staged ? 0 : CHAMPION_WIDTH);
  const contentHeight = HEADER_HEIGHT + treeHeight + (draft.appearance?.exportFooter ? 112 : 52);
  const wideUnit = draft.appearance?.wideImage ? Math.ceil(Math.max(contentWidth / 16, contentHeight / 9)) : 0;
  const width = wideUnit ? wideUnit * 16 : contentWidth;
  const height = wideUnit ? wideUnit * 9 : contentHeight;
  const maxPixels = 28_000_000;
  const scale = Math.min(2, 16_000 / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));

  const canvas = document.createElement('canvas');
  const scaledWideUnit = wideUnit ? Math.max(1, Math.floor(wideUnit * scale)) : 0;
  canvas.width = scaledWideUnit ? scaledWideUnit * 16 : Math.max(1, Math.floor(width * scale));
  canvas.height = scaledWideUnit ? scaledWideUnit * 9 : Math.max(1, Math.floor(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not create the bracket image.');
  context.scale(canvas.width / width, canvas.height / height);

  context.fillStyle = '#111216';
  if (goldTheme) {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#111931');
    gradient.addColorStop(.65, '#231e3a');
    gradient.addColorStop(1, '#131426');
    context.fillStyle = gradient;
  }
  context.fillRect(0, 0, width, height);

  context.fillStyle = goldTheme ? '#f4cb84' : '#ff6b3d';
  context.font = '700 13px Arial, sans-serif';
  context.textAlign = 'left';
  context.fillText('ARENAHUB TOURNAMENT', EDGE, 34);
  context.fillStyle = '#ffffff';
  context.font = '700 26px Arial, sans-serif';
  context.fillText(fitText(context, draft.title, width - EDGE * 2 - 220), EDGE, 68);
  context.fillStyle = '#9297a4';
  context.font = '500 13px Arial, sans-serif';
  context.fillText(`${draft.teamsCount} teams  ·  ${draft.format}  ·  ${draft.matchFormat}`, EDGE, 94);

  context.textAlign = 'right';
  context.fillStyle = '#6f7480';
  if (!draft.appearance?.exportFooter) context.fillText(new Date().toLocaleDateString(), width - EDGE, 34);
  context.textAlign = 'left';

  rounds.forEach((round, roundIndex) => {
    const x = EDGE + (width - contentWidth) / 2 + roundIndex * (CARD_WIDTH + ROUND_GAP);
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    const isFinal = !staged && roundIndex === rounds.length - 1;
    context.fillStyle = isFinal ? '#ffb020' : '#9da2ae';
    context.font = '700 12px Arial, sans-serif';
    context.fillText((round[0]?.roundName || `Round ${roundIndex + 1}`).toUpperCase(), x, HEADER_HEIGHT - 22);

    round.forEach((match, matchIndex) => {
      const y = HEADER_HEIGHT + (staged ? matchIndex * (CARD_HEIGHT + ROW_GAP) : matchCenter(roundIndex, matchIndex) - CARD_HEIGHT / 2);
      context.textAlign = 'left';
      context.textBaseline = 'alphabetic';
      context.font = '650 11px Arial, sans-serif';
      context.fillStyle = goldTheme ? '#e5c88f' : '#9297a4';
      const paths = staged ? match.sources?.filter(source => source !== null).map(source =>
          `${source.result === 'winner' ? 'W' : 'L'} ${matchName(draft.matches.find(item => item.id === source.matchId)) || source.matchId}`
        ).join(' / ') : '';
      context.fillText(fitText(context, `${matchName(match)} · ${(match.matchFormat || draft.matchFormat).toUpperCase()}${match.inactive ? ' · If needed' : ''}${paths ? ` · ${paths}` : ''}`, CARD_WIDTH), x, y - 8);
      drawMatchCard(context, match, x, y, isFinal, badges, goldTheme);
    });

    if (!staged && roundIndex < rounds.length - 1) {
      const connectorX = x + CARD_WIDTH;
      const midX = connectorX + ROUND_GAP / 2;
      context.strokeStyle = '#656b78';
      context.lineWidth = 2;
      rounds[roundIndex + 1].forEach((_, nextIndex) => {
        const topY = HEADER_HEIGHT + matchCenter(roundIndex, nextIndex * 2);
        const bottomY = HEADER_HEIGHT + matchCenter(roundIndex, nextIndex * 2 + 1);
        const nextY = HEADER_HEIGHT + matchCenter(roundIndex + 1, nextIndex);
        context.beginPath();
        context.moveTo(connectorX, topY);
        context.lineTo(midX, topY);
        context.lineTo(midX, bottomY);
        context.lineTo(connectorX, bottomY);
        context.moveTo(midX, nextY);
        context.lineTo(connectorX + ROUND_GAP, nextY);
        context.stroke();
      });
    }
  });

  if (!staged) {
  const final = rounds[rounds.length - 1]?.[0];
  const champion = final?.status === 'completed' && final?.winnerId && final.winnerId === final.team1?.id
    ? final.team1
    : final?.status === 'completed' && final?.winnerId && final.winnerId === final.team2?.id
    ? final.team2
    : undefined;
  const finalX = EDGE + (width - contentWidth) / 2 + (rounds.length - 1) * (CARD_WIDTH + ROUND_GAP) + CARD_WIDTH;
  const finalY = HEADER_HEIGHT + matchCenter(rounds.length - 1, 0);
  context.strokeStyle = '#656b78';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(finalX, finalY);
  context.lineTo(finalX + ROUND_GAP, finalY);
  context.stroke();

  const championX = finalX + ROUND_GAP;
  roundedRect(context, championX, finalY - 39, CHAMPION_WIDTH, 78, 10);
  context.fillStyle = '#201b10';
  context.fill();
  context.strokeStyle = '#9a7521';
  context.stroke();
  context.textAlign = 'center';
  context.fillStyle = '#ffb020';
  context.font = '700 11px Arial, sans-serif';
  context.fillText('CHAMPION', championX + CHAMPION_WIDTH / 2, finalY - 11);
  context.fillStyle = '#ffffff';
  context.font = '700 16px Arial, sans-serif';
  if (champion) drawBadge(context, badges, champion, championX + 22, finalY + 9);
  context.fillText(
    fitText(context, champion?.name || 'TBD', CHAMPION_WIDTH - (champion ? 52 : 24)),
    championX + CHAMPION_WIDTH / 2 + (champion ? 12 : 0),
    finalY + 14,
  );
  }

  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  if (draft.appearance?.exportFooter) {
    const section = (width - EDGE * 2) / 3;
    ['Event date', 'Prize pool', 'Sponsors'].forEach((label, index) => {
      const x = EDGE + section * index;
      context.strokeStyle = '#77728d';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, height - 74);
      context.lineTo(x + section - 22, height - 74);
      context.stroke();
      context.fillStyle = '#c4bfd4';
      context.font = '650 13px Arial, sans-serif';
      context.fillText(label, x, height - 50);
    });
  } else {
    context.fillStyle = '#8c909d';
    context.font = '500 11px Arial, sans-serif';
    context.fillText('Generated from ArenaHub Bracket Studio', EDGE, height - 22);
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new Error('Bracket image export failed.')), 'image/png');
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeFileName(draft.title)}-bracket.png`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
