// Computer players and hints. The network (neural.js) judges positions; this
// file turns its judgement into moves and cube decisions at three levels, and
// into hints, which use Hard's judgement so the two never disagree.
//
// Every choice is weighed in chances of winning the match. The network's
// chances of a win, a gammon and so on in this game are each worth what that
// result would do to the score, by a match equity table worked out below. So
// a gammon counts for nothing when a single game wins the match, and for a
// great deal when it would win the match from behind.

import { legalTurns, canDouble, other, moveText, OFF, BAR, CHECKERS, winKind } from './game.js';
import { evaluate, flip, equity, won, unpackNet, WIN, WIN_GAMMON, WIN_BACKGAMMON, LOSE_GAMMON, LOSE_BACKGAMMON } from './neural.js';
import { WEIGHTS } from './weights.js';

let net = unpackNet(WEIGHTS);

// The tests and the dev tools can put another network in its place.
export function useNet(next) {
  net = next;
}

// ---- The match equity table -----------------------------------------------

// Chances of winning a match needing `a` points against an opponent needing
// `b`, from a simple model of one game: each side wins half, and a quarter of
// the wins are gammons. The game after a side first comes within one point
// is played without the cube (the Crawford game); after it, the side behind
// doubles at once, so each game counts twice.
const GAMMONS = 0.25;
const SINGLE = 0.5 * (1 - GAMMONS);
const GAMMON = 0.5 * GAMMONS;
const LONGEST = 15;

const post = [0, 0.5]; // the leader's chances after the Crawford game, needing 1 against b
for (let b = 2; b <= LONGEST; b++) post[b] = SINGLE + GAMMON + SINGLE * (post[b - 2] ?? 0) + GAMMON * (post[Math.max(0, b - 4)] ?? 0);
post[0] = 0;
const crawford = []; // the leader's chances in the Crawford game itself
for (let b = 2; b <= LONGEST; b++) crawford[b] = SINGLE + GAMMON + SINGLE * post[b - 1] + GAMMON * post[Math.max(0, b - 2)];

// Without the cube there is no Crawford game, and every game counts once.
const plain = [];
const before = [];
const at = (table, a, b, ones) => {
  if (a <= 0) return 1;
  if (b <= 0) return 0;
  if (a === 1 && b === 1) return 0.5;
  if (ones && a === 1) return ones(b);
  if (ones && b === 1) return 1 - ones(a);
  return table[a][b];
};
for (let a = 1; a <= LONGEST; a++) {
  plain[a] = [];
  before[a] = [];
}
for (let total = 2; total <= 2 * LONGEST; total++) {
  for (let a = 1; a <= LONGEST; a++) {
    const b = total - a;
    if (b < 1 || b > LONGEST) continue;
    plain[a][b] =
      a === 1 && b === 1
        ? 0.5
        : SINGLE * at(plain, a - 1, b) + GAMMON * at(plain, a - 2, b) + SINGLE * at(plain, a, b - 1) + GAMMON * at(plain, a, b - 2);
    const next = (x, y) => at(before, x, y, n => crawford[n]);
    before[a][b] = SINGLE * next(a - 1, b) + GAMMON * next(a - 2, b) + SINGLE * next(a, b - 1) + GAMMON * next(a, b - 2);
  }
}

// The chances of winning the match for the side needing `a` against `b` at
// the start of a game: `stage` is 'plain' with the cube off, 'post' after the
// Crawford game, and otherwise 'before'.
export function matchEquity(a, b, stage = 'before') {
  if (stage === 'plain') return at(plain, a, b);
  if (stage === 'post') return at(before, a, b, n => post[n]);
  return at(before, a, b, n => crawford[n]);
}

const needOf = (match, side) => match.target - match.score[side];

// The chances of winning the match for `side` once this game ends with it
// winning `points` (losing, when negative).
function after(match, side, points) {
  const stage = !match.cubeOn ? 'plain' : match.crawford ? 'post' : 'before';
  return matchEquity(needOf(match, side) - Math.max(points, 0), needOf(match, other(side)) - Math.max(-points, 0), stage);
}

// The chances of winning the match for `side`, given `p`, its chances in
// this game, played for `value`.
function matchChance(match, side, p, value) {
  return (
    (p[WIN] - p[WIN_GAMMON]) * after(match, side, value) +
    (p[WIN_GAMMON] - p[WIN_BACKGAMMON]) * after(match, side, 2 * value) +
    p[WIN_BACKGAMMON] * after(match, side, 3 * value) +
    (1 - p[WIN] - p[LOSE_GAMMON]) * after(match, side, -value) +
    (p[LOSE_GAMMON] - p[LOSE_BACKGAMMON]) * after(match, side, -2 * value) +
    p[LOSE_BACKGAMMON] * after(match, side, -3 * value)
  );
}

// What one point of the game is worth in the match, for scaling mistakes.
const pointWorth = (match, side) => (after(match, side, match.cube.value) - after(match, side, -match.cube.value)) / 2;

// ---- Moves --------------------------------------------------------------

// The chances for `side` once it has played `turn`.
const outlook = (turn, side) =>
  turn.board[side][OFF] === CHECKERS ? won(winKind(turn.board, side)) : flip(evaluate(net, turn.board, other(side)));

// Every way to play the roll, best first by the network's judgement:
// [{ moves, board, chances, value }], chances being `side`'s once it is
// played and value its chances of winning the match.
export function rateTurns(match, side, board = match.board, dice = match.dice) {
  return legalTurns(board, side, dice)
    .map(turn => {
      const chances = outlook(turn, side);
      return { ...turn, chances, value: matchChance(match, side, chances, match.cube.value) };
    })
    .sort((a, b) => b.value - a.value || equity(b.chances) - equity(a.chances));
}

// The 21 different rolls, and how many of the 36 ways to throw two dice each is.
const ROLLS = [];
for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) ROLLS.push([a, b, a === b ? 1 : 2]);

// Looks one roll further at the closest candidates: for each roll the other
// side could throw, its best answer by the network, and how the match then
// stands for `side`.
function lookAhead(match, side, candidates) {
  const them = other(side);
  return candidates
    .map(candidate => {
      if (candidate.board[side][OFF] === CHECKERS) return candidate;
      let total = 0;
      for (const [a, b, ways] of ROLLS) {
        let best = -Infinity;
        for (const reply of legalTurns(candidate.board, them, [a, b])) {
          best = Math.max(best, matchChance(match, them, outlook(reply, them), match.cube.value));
        }
        total += ways * (1 - best);
      }
      return { ...candidate, value: total / 36 };
    })
    .sort((a, b) => b.value - a.value);
}

const AHEAD = 4; // candidates Hard looks further at
const CLOSE = 0.05; // in points of the game: those this close to the best

// The turn Hard plays, or that a hint suggests.
export function bestTurn(match, side) {
  const rated = rateTurns(match, side);
  if (rated.length < 2) return rated[0];
  const margin = CLOSE * pointWorth(match, side);
  const close = rated.slice(0, AHEAD).filter(turn => turn.value >= rated[0].value - margin);
  return close.length < 2 ? rated[0] : lookAhead(match, side, close)[0];
}

// How the weaker levels fall short. Each misjudges every move by random
// amounts of about `noise` points of the game, and its cube decisions by
// about `cubeNoise` of the game's swing; Easy also plays any move at all
// `randomTurn` of the time, and is too ready to take a double.
const LEVELS = {
  easy: { noise: 0.12, randomTurn: 0.04, cubeNoise: 0.12, takeBias: 0.08 },
  medium: { noise: 0.05, randomTurn: 0, cubeNoise: 0.05, takeBias: 0.02 },
};

const levelOf = (match, side) => match.players[side]?.level ?? match.difficulty;

// A normally distributed number, mean 0 and spread 1.
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

export function pickTurn(match, side, level = levelOf(match, side)) {
  if (level === 'hard') return bestTurn(match, side);
  const rated = rateTurns(match, side);
  const { noise, randomTurn } = LEVELS[level] ?? LEVELS.medium;
  if (Math.random() < randomTurn) return rated[Math.floor(Math.random() * rated.length)];
  const spread = noise * pointWorth(match, side);
  let best = rated[0];
  let most = -Infinity;
  for (const turn of rated) {
    const judged = turn.value + spread * gauss();
    if (judged > most) {
      most = judged;
      best = turn;
    }
  }
  return best;
}

// ---- The cube -------------------------------------------------------------

const VIG = 0.035; // what owning the cube is worth to the taker, as a share of the game's swing
const WINDOW = 0.105; // how near its take point the other side must be before the cube is turned

// How a double by `doubler`, about to roll, would stand: its chances in the
// game (p), its chances of winning the match with no double (nd), doubled
// and taken (dt) or passed (dp), the swing between winning and losing a
// single game at the doubled stakes, and how much better taking is than
// passing for the other side (margin; below 0 it should pass).
function cubeFigures(match, doubler) {
  const value = match.cube.value;
  const p = evaluate(net, match.board, doubler);
  const nd = matchChance(match, doubler, p, value);
  const dt = matchChance(match, doubler, p, 2 * value);
  const dp = after(match, doubler, value);
  const swing = after(match, doubler, 2 * value) - after(match, doubler, -2 * value);
  return { p, nd, dt, dp, swing, margin: dp - dt + VIG * swing };
}

export function shouldDouble(match, side, level = levelOf(match, side)) {
  // Nobody doubles who wins the match by winning this game as it stands.
  if (!canDouble(match, side) || needOf(match, side) <= match.cube.value) return false;
  const { nd, dt, dp, swing, margin } = cubeFigures(match, side);
  // After the Crawford game the side behind doubles at once: losing at twice
  // the stakes costs it nothing.
  if (match.crawford === 'done' && needOf(match, other(side)) === 1 && needOf(match, side) > 1) return dt >= nd;
  const { cubeNoise } = LEVELS[level] ?? { cubeNoise: 0 };
  const judged = margin + cubeNoise * swing * gauss();
  // If the other side should pass, double to cash the game, unless playing
  // on for a gammon is worth more ("too good to double").
  if (judged < 0) return dp >= nd;
  return judged < WINDOW * swing && dt > nd;
}

export function shouldTake(match, side, level = levelOf(match, side)) {
  const { swing, margin } = cubeFigures(match, other(side));
  const { cubeNoise, takeBias } = LEVELS[level] ?? { cubeNoise: 0, takeBias: 0 };
  return margin + (takeBias + cubeNoise * gauss()) * swing >= 0;
}

// ---- Hints --------------------------------------------------------------

const percent = chance => `${Math.round(100 * chance)}%`;

// What a turn does, in words: the points it makes, its hits, and so on.
function whatItDoes(board, side, turn) {
  const mine = [board[side], turn.board[side]];
  const theirs = [board[other(side)], turn.board[other(side)]];
  const said = [];
  const made = [];
  for (let p = 1; p <= 24; p++) if (mine[0][p] < 2 && mine[1][p] >= 2) made.push(p);
  if (made.length) {
    const p = made.sort((x, y) => Math.abs(x - 5.5) - Math.abs(y - 5.5))[0];
    said.push(p === 7 ? 'makes your bar point' : p >= 19 ? `makes an anchor on their ${25 - p} point` : `makes your ${p} point`);
  }
  const hits = theirs[1][BAR] - theirs[0][BAR];
  if (hits) said.push(hits === 1 ? 'hits' : `hits ${['', '', 'two', 'three', 'four'][hits]}`);
  const off = mine[1][OFF] - mine[0][OFF];
  if (off) said.push(`bears off ${['', 'one', 'two', 'three', 'four'][off]}`);
  if (mine[0][BAR] && !mine[1][BAR] && said.length < 2) said.push('comes in from the bar');
  return said.slice(0, 2).join(' and ');
}

// The strongest choice for `side` now, with a short explanation: { moves,
// text } during a turn, or { cube: 'double' | 'roll' | 'take' | 'pass', text }.
export function hint(match, side) {
  if (match.phase === 'doubled') {
    const doubler = other(side);
    const { p, dp, swing, margin } = cubeFigures(match, doubler);
    // The least a taker needs, counting single games only: what passing
    // saves, against the swing between winning and losing at the new stakes.
    const need = Math.max(0, (after(match, doubler, 2 * match.cube.value) - dp) / swing - VIG);
    const take = margin >= 0;
    return {
      cube: take ? 'take' : 'pass',
      text: `${take ? 'Take' : 'Pass'}: you win this game about ${percent(1 - p[WIN])} of the time, and need about ${percent(need)} to take at this score.`,
    };
  }
  if (match.phase === 'roll') {
    const { p, margin } = cubeFigures(match, side);
    if (!canDouble(match, side)) return { cube: 'roll', text: `Roll. You win this game about ${percent(p[WIN])} of the time.` };
    if (shouldDouble(match, side, 'hard')) {
      return { cube: 'double', text: `Double: you win about ${percent(p[WIN])}, and they should ${margin >= 0 ? 'take' : 'pass'}.` };
    }
    if (margin < 0) return { cube: 'roll', text: `Too good to double: play on for a gammon, which you win about ${percent(p[WIN_GAMMON])} of the time.` };
    return { cube: 'roll', text: `Roll, without doubling yet: you win about ${percent(p[WIN])}.` };
  }
  const best = bestTurn(match, side);
  if (!best.moves.length) return { moves: [], text: 'No move is possible with this roll. Press Done.' };
  const written = moveText(match.board, side, best.moves);
  if (legalTurns(match.board, side, match.dice).length === 1) return { moves: best.moves, text: `${written} is the only play.` };
  const does = whatItDoes(match.board, side, best);
  return { moves: best.moves, text: `Play ${written}${does ? `: ${does}` : ''}. You win about ${percent(best.chances[WIN])}.` };
}
