import type { BracketDraft, Match, Team } from './types';

const CARD_WIDTH = 248;
const CARD_HEIGHT = 72;
const ROUND_GAP = 54;
const ROW_GAP = 32;
const HEADER_HEIGHT = 132;
const EDGE = 44;
const CHAMPION_WIDTH = 176;

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

  context.textAlign = 'left';
  context.fillStyle = isBye ? '#858a97' : winner ? '#ff8a5b' : '#f4f4f5';
  context.font = `${winner ? '700' : '600'} 14px Arial, sans-serif`;
  context.fillText(
    fitText(context, isBye ? 'BYE (AUTOMATIC ADVANCE)' : teamName(team, 'TBD'), CARD_WIDTH - 92),
    x + 42,
    y + 19,
  );

  context.textAlign = 'right';
  context.fillStyle = '#f4f4f5';
  context.font = '700 14px Arial, sans-serif';
  context.fillText(String(score), x + CARD_WIDTH - 14, y + 19);
}

function drawMatchCard(
  context: CanvasRenderingContext2D,
  match: Match,
  x: number,
  y: number,
  isFinal: boolean,
) {
  roundedRect(context, x, y, CARD_WIDTH, CARD_HEIGHT, 9);
  context.fillStyle = isFinal ? '#211d16' : '#202126';
  context.fill();
  context.strokeStyle = isFinal ? '#9a7521' : '#393c45';
  context.lineWidth = 1;
  context.stroke();

  context.beginPath();
  context.moveTo(x, y + CARD_HEIGHT / 2);
  context.lineTo(x + CARD_WIDTH, y + CARD_HEIGHT / 2);
  context.strokeStyle = '#30323a';
  context.stroke();

  drawTeamRow(context, match, match.team1, 1, x, y);
  drawTeamRow(context, match, match.team2, 2, x, y + CARD_HEIGHT / 2);
}

export async function downloadBracketPng(draft: BracketDraft) {
  if (!draft.matches.length) throw new Error('Create a bracket before downloading it.');
  const staged = draft.format !== 'Single Elimination';
  const maxRound = Math.max(...draft.matches.map(match => match.round), 1);
  const rounds = Array.from({ length: maxRound }, (_, index) =>
    draft.matches.filter(match => match.round === index + 1),
  );
  const firstRoundCount = Math.max(staged ? Math.max(...rounds.map(round => round.length)) : rounds[0]?.length || 1, 1);
  const treeHeight = Math.max(firstRoundCount * (CARD_HEIGHT + ROW_GAP), 390);
  const width = EDGE * 2 + rounds.length * (CARD_WIDTH + ROUND_GAP) + (staged ? 0 : CHAMPION_WIDTH);
  const height = HEADER_HEIGHT + treeHeight + 52;
  const maxPixels = 28_000_000;
  const scale = Math.min(2, 16_000 / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not create the bracket image.');
  context.scale(scale, scale);

  context.fillStyle = '#111216';
  context.fillRect(0, 0, width, height);

  context.fillStyle = '#ff6b3d';
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
  context.fillText(new Date().toLocaleDateString(), width - EDGE, 34);
  context.textAlign = 'left';

  rounds.forEach((round, roundIndex) => {
    const x = EDGE + roundIndex * (CARD_WIDTH + ROUND_GAP);
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    const isFinal = !staged && roundIndex === rounds.length - 1;
    context.fillStyle = isFinal ? '#ffb020' : '#9da2ae';
    context.font = '700 12px Arial, sans-serif';
    context.fillText((round[0]?.roundName || `Round ${roundIndex + 1}`).toUpperCase(), x, HEADER_HEIGHT - 22);

    round.forEach((match, matchIndex) => {
      const y = HEADER_HEIGHT + (staged ? matchIndex * (CARD_HEIGHT + ROW_GAP) : matchCenter(roundIndex, matchIndex) - CARD_HEIGHT / 2);
      if (staged) {
        context.textAlign = 'left';
        context.font = '500 10px Arial, sans-serif';
        context.fillStyle = '#9297a4';
        const paths = match.sources?.filter(source => source !== null).map(source =>
          `${source.result === 'winner' ? 'W' : 'L'} ${draft.matches.find(item => item.id === source.matchId)?.matchNumber || source.matchId}`
        ).join(' / ');
        context.fillText(fitText(context, `${match.matchNumber} · ${match.inactive ? 'If needed' : match.matchFormat}${paths ? ` · ${paths}` : ''}`, CARD_WIDTH), x, y - 8);
      }
      drawMatchCard(context, match, x, y, isFinal);
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
  const finalX = EDGE + (rounds.length - 1) * (CARD_WIDTH + ROUND_GAP) + CARD_WIDTH;
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
  context.fillText(
    fitText(context, champion?.name || 'TBD', CHAMPION_WIDTH - 24),
    championX + CHAMPION_WIDTH / 2,
    finalY + 14,
  );
  }

  context.textAlign = 'left';
  context.fillStyle = '#5f6470';
  context.font = '500 11px Arial, sans-serif';
  context.fillText('Generated from ArenaHub Bracket Studio', EDGE, height - 22);

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
