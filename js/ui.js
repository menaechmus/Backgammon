// Everything the player sees and touches. The rules live in game.js; this
// file draws the current match and turns taps, drags and keys into moves.

import {
  BAR, OFF, other, pipCount, legalTurns, turnState, applyMoves, moveText, keyOf, startBoard,
  newMatch, nextGame, roll, play, double, take, pass, canDouble,
} from './game.js';
import { BOARD, STACK, BAR_STACK, trianglePath, checkerXY, barXY, trayXY, diceXY, cubeXY, labelXY } from './board.js';
import { pickTurn, shouldDouble, shouldTake, hint } from './ai.js';
import { emptyStats, loadStats, recordMatch } from './stats.js';
import { playSound, setMuted, unlockSound } from './sound.js';
import { startParty } from './celebrate.js';
import { setupInput, destKey } from './input.js';

// Shown in the About box. Bump both with every release: a browser still
// running a cached copy of this file then shows the old number.
const VERSION = '1.0.0';
const RELEASED = '29 October 2026';

const AI_DELAY = 800; // the computer's pause before it rolls, doubles or answers a double
const AI_MOVE_DELAY = 450; // and after its dice land, before its first checker moves
const ROLL_MS = 560; // the dice tumbling before they land
const FACE_MS = 70; // how often a tumbling die shows a new face
const OPENING_HOLD_MS = 650; // the opening dice stay up this long once they land
const MOVE_MS = 280; // a checker sliding to its next place
const MOVE_GAP_MS = 140; // between one of the computer's checkers and the next
const OWN_MS = 170; // a checker you send, after you tap where it goes
const SETUP_MS = 700; // from the first checker set out at a new game to the last
const FLIGHT_MS = 300; // each one's flight from the tray
const CUBE_MS = 420; // the cube moving
const CHEER_MS = 3500; // fireworks and confetti before the box appears
const NAME_LENGTH = 12;
const SETTINGS_KEY = 'backgammon.settings';
const GAME_KEY = 'backgammon.game';
const STATS_KEY = 'backgammon.stats';

const $ = id => document.getElementById(id);

// ?store=NAME keeps this page's storage under keys of its own, so that the
// test driver's frames can each be a device of their own.
const STORE = new URLSearchParams(location.search).get('store');
const keyed = key => (STORE ? `${key}:${STORE}` : key);

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(keyed(key)));
  } catch {
    return null;
  }
}

function store(key, value) {
  try {
    if (value === null) localStorage.removeItem(keyed(key));
    else localStorage.setItem(keyed(key), JSON.stringify(value));
  } catch {
    // Storage can be switched off (private browsing); the game still plays.
  }
}

// Menu buttons carry their value as text: "true", "5", "hard".
function parseValue(text) {
  if (text === 'true' || text === 'false') return text === 'true';
  return /^\d+$/.test(text) ? Number(text) : text;
}

// Saved settings are only accepted if the menu offers that value.
function loadSettings() {
  const settings = { mode: 'ai', difficulty: 'medium', names: ['', ''], target: 5, cube: true, hints: true, sound: true };
  const saved = load(SETTINGS_KEY);
  for (const group of document.querySelectorAll('.choice[data-setting]')) {
    const key = group.dataset.setting;
    const offered = [...group.children].map(button => parseValue(button.dataset.value));
    if (offered.includes(saved?.[key])) settings[key] = saved[key];
  }
  if (Array.isArray(saved?.names)) {
    settings.names = settings.names.map((name, i) => (typeof saved.names[i] === 'string' ? saved.names[i].slice(0, NAME_LENGTH) : name));
  }
  return settings;
}

// Names are typed in, so they are escaped before going into the page.
const escapeHtml = text => String(text).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

const settings = loadSettings();
const stats = loadStats(load(STATS_KEY));
let match = null;
let made = []; // the moves of the turn being made here: { from, to, die, step }, a step for each tap
let picked = null; // the point, in the mover's numbering, whose checker is picked up
let cursor = null; // the keyboard's place: a point in the mover's numbering, or OFF
let tip = null; // the last hint: { moves, text } or { cube, text }
let messages = []; // what the last action did, in words
let turns = null; // the legal turns for the roll being played here, worked out once
let show = null; // an animation in progress (see Animation below)
let celebrating = 0; // timer while a win is celebrated and the box waits
let party = null; // the fireworks and confetti, which outlast the celebration a little
let skipClick = false; // the tap that skipped an animation should do nothing else
let resetArmed = false;
let confirmed = null; // what the confirm box's button does
let aiTimer = 0;
let input = null;

setMuted(!settings.sound);

// ---- Who is who ---------------------------------------------------------

const isAi = side => match.players[side].ai;
const nameOf = side => match.players[side].name;
const isYou = side => nameOf(side) === 'You';
const does = (side, verb) => `${nameOf(side)} ${verb}${isYou(side) ? '' : verb.endsWith('s') ? 'es' : 's'}`;
const whose = side => (isYou(side) ? 'Your' : `${nameOf(side)}'s`);
const capital = text => text[0].toUpperCase() + text.slice(1);
// The side drawn at the bottom of the board.
const bottom = () => 0;
const personWon = () => !isAi(match.winner);
const cubeInUse = () => match.cubeOn && match.target > 1;

// The side that must act now: to roll or move, or to answer a double.
function actor() {
  if (!match) return null;
  if (match.phase === 'roll' || match.phase === 'move') return match.turn;
  if (match.phase === 'doubled') return other(match.turn);
  return null;
}

const canAct = () => actor() !== null && !isAi(actor()) && !show;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- The turn being made ------------------------------------------------

// The legal turns for the roll being played, worked out once per roll.
function turnsNow() {
  const key = `${match.id}:${match.gameNo}:${match.turn}:${match.dice}:${keyOf(match.board)}`;
  if (turns?.key !== key) turns = { key, list: legalTurns(match.board, match.turn, match.dice) };
  return turns.list;
}

const stateAfter = moves => turnState(match.board, match.turn, match.dice, moves, turnsNow());
const turnNow = () => stateAfter(made);

// Where the checker on `from` can go, in one die or more: [{ to, steps }].
// A place reached with more than one die is offered only when every way
// there ends the same, so a tap cannot hit, or miss, by surprise.
function reachable(from) {
  const found = new Map(); // to -> { steps, key, mixed }
  const walk = (at, steps) => {
    for (const move of stateAfter([...made, ...steps]).moves) {
      if (move.from !== at) continue;
      const path = [...steps, move];
      const key = keyOf(stateAfter([...made, ...path]).board);
      const known = found.get(move.to);
      if (!known || path.length < known.steps.length) found.set(move.to, { steps: path, key, mixed: false });
      else if (path.length === known.steps.length && known.key !== key) known.mixed = true;
      if (move.to !== OFF) walk(move.to, path);
    }
  };
  walk(from, []);
  return [...found]
    .filter(([, route]) => !route.mixed || route.steps.length === 1)
    .map(([to, route]) => ({ to, steps: route.steps }));
}

// The points, in the mover's numbering, with a checker that may move now.
function movable() {
  if (!canAct() || match.phase !== 'move') return [];
  return [...new Set(turnNow().moves.map(move => move.from))];
}

// ---- Drawing --------------------------------------------------------------

// The side's point p as drawn: the bottom side's own numbering.
const view = (side, p) => (side === bottom() ? p : 25 - p);
const fromView = (side, n) => (side === bottom() ? n : 25 - n);

const DIE_PIPS = {
  1: [[0, 0]],
  2: [[-5.5, -5.5], [5.5, 5.5]],
  3: [[-5.5, -5.5], [0, 0], [5.5, 5.5]],
  4: [[-5.5, -5.5], [5.5, -5.5], [-5.5, 5.5], [5.5, 5.5]],
  5: [[-5.5, -5.5], [5.5, -5.5], [0, 0], [-5.5, 5.5], [5.5, 5.5]],
  6: [[-5.5, -5.5], [5.5, -5.5], [-5.5, 0], [5.5, 0], [-5.5, 5.5], [5.5, 5.5]],
};

const at = (x, y) => `transform: translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;

function dieHtml(side, value, x, y, classes = '') {
  const pips = DIE_PIPS[value].map(([px, py]) => `<circle cx="${px}" cy="${py}" r="2.3"/>`).join('');
  const half = BOARD.die / 2;
  return `<g class="die side${side} ${classes}" style="${at(x, y)}"><g class="face"><rect x="${-half}" y="${-half}" width="${BOARD.die}" height="${BOARD.die}" rx="4.5"/>${pips}</g></g>`;
}

function checkerHtml(side, where, k, [x, y], count, classes) {
  const label = count ? `<text dy="0.36em">${count}</text>` : '';
  return `<g class="checker side${side}${classes}" data-key="${side}:${where}:${k}" style="${at(x, y)}"><circle r="${BOARD.radius}"/><circle class="inner" r="${BOARD.radius - 4}"/>${label}</g>`;
}

// The board as it should look now: during an animation, as the animation has
// got; during a turn being made here, with its moves so far.
function shownBoard() {
  if (show) return show.board;
  if (made.length) return turnNow().board;
  return match.board;
}

// The static board: frame, playing surfaces, points, bar, trays and the point
// numbers. The checkers, dice and cube go in the layers above.
function drawBoard() {
  const { width, height, quarters, bar, trays } = BOARD;
  const rect = ({ x, y, width: w, height: h }, cls) => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
  let points = '';
  let labels = '';
  for (let n = 1; n <= 24; n++) {
    points += `<path class="point ${n % 2 ? 'odd' : 'even'}" d="${trianglePath(n)}"/>`;
    const [x, y] = labelXY(n);
    labels += `<text x="${x}" y="${y}" data-n="${n}">${n}</text>`;
  }
  $('board').innerHTML =
    `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Backgammon board">` +
    `<rect class="frame" width="${width}" height="${height}" rx="10"/>` +
    quarters.map(q => rect(q, 'surface')).join('') +
    rect(bar, 'bar') +
    rect(trays.top, 'tray') +
    rect(trays.bottom, 'tray') +
    `<g class="points">${points}</g><g class="labels">${labels}</g>` +
    '<g class="marks"></g><g class="pieces"></g><g class="hints"></g><g class="drag-layer"></g></svg>';
  $('scores').innerHTML = [0, 1]
    .map(side => `<div class="score" data-side="${side}"><i></i><span class="who"><span class="name"></span><small class="pips"></small></span><b class="points"></b></div>`)
    .join('');
}

// Which dice to draw: those of the animation, or of the roll being played,
// each { side, value, used, rolling }.
function diceNow() {
  if (show?.dice) return show.dice;
  if (match.phase !== 'move' || !match.dice.length) return [];
  const [a, b] = match.dice;
  const values = a === b ? [a, a, a, a] : [a, b];
  // During a turn made here, the dice it has used are dimmed.
  const used = [];
  for (const move of made) {
    const i = values.findIndex((value, j) => value === move.die && !used[j]);
    if (i >= 0) used[i] = true;
  }
  return values.map((value, i) => ({ side: match.turn, value, used: Boolean(used[i]) }));
}

// Where the cube is, and what it shows.
function cubeNow() {
  if (show?.cube) return show.cube;
  const { cube } = match;
  if (match.phase === 'doubled') return { place: other(match.turn) === bottom() ? 'offer-bottom' : 'offer-top', value: cube.value * 2 };
  if (cube.owner === null) return { place: 'centre', value: cube.value };
  return { place: cube.owner === bottom() ? 'bottom' : 'top', value: cube.value };
}

function cubeHtml() {
  if (!cubeInUse()) return '';
  const { place, value } = cubeNow();
  const [x, y] = cubeXY(place);
  const half = BOARD.cube / 2;
  const classes = [place.startsWith('offer') && 'offered', match.crawford === 'now' && 'crawford'].filter(Boolean).join(' ');
  return (
    `<g class="cube ${classes}" style="${at(x, y)}"><rect x="${-half}" y="${-half}" width="${BOARD.cube}" height="${BOARD.cube}" rx="4"/>` +
    `<text dy="0.36em">${value === 1 ? 64 : value}</text></g>`
  );
}

function piecesHtml(board) {
  const sources = new Set(movable());
  const hinted = new Set((tip?.moves ?? []).map(([from]) => from));
  const mover = match.turn;
  let html = '';
  for (const side of [0, 1]) {
    const mine = board[side];
    const isBottom = side === bottom();
    // The checker that moves next from a point is the one on top of it.
    const marks = (p, k, shown) => {
      if (side !== mover || k !== shown - 1) return '';
      return [sources.has(p) && ' movable', picked === p && ' picked', hinted.has(p) && ' tip', cursor === p && ' cursor'].filter(Boolean).join('');
    };
    for (let p = 1; p <= 24; p++) {
      const count = mine[p];
      const shown = Math.min(count, STACK);
      for (let k = 0; k < shown; k++) {
        html += checkerHtml(side, `p${view(side, p)}`, k, checkerXY(view(side, p), k), k === shown - 1 && count > STACK ? count : 0, marks(p, k, shown));
      }
    }
    const waiting = Math.min(mine[BAR], BAR_STACK);
    for (let k = 0; k < waiting; k++) {
      html += checkerHtml(side, 'bar', k, barXY(isBottom, k), k === waiting - 1 && mine[BAR] > BAR_STACK ? mine[BAR] : 0, marks(BAR, k, waiting));
    }
    for (let k = 0; k < mine[OFF]; k++) {
      const [x, y] = trayXY(isBottom, k);
      html += `<rect class="borne side${side}" data-key="${side}:off:${k}" x="-12" y="-3.25" width="24" height="6.5" rx="2" style="${at(x, y)}"/>`;
    }
  }
  const dice = diceNow();
  const bySide = [0, 1].map(side => dice.filter(die => die.side === side));
  for (const group of bySide) {
    group.forEach((die, i) => {
      const [x, y] = diceXY(die.side === bottom(), group.length, i);
      html += dieHtml(die.side, die.value, x, y, [die.used && 'used', die.rolling && 'rolling'].filter(Boolean).join(' '));
    });
  }
  return html + cubeHtml();
}

// The places the picked checker may go, lit up.
function marksHtml() {
  if (picked === null || !canAct() || match.phase !== 'move') return '';
  const mover = match.turn;
  return reachable(picked)
    .map(({ to }) => {
      if (to === OFF) {
        const tray = BOARD.trays[mover === bottom() ? 'bottom' : 'top'];
        const keyed = cursor === OFF ? ' cursor' : '';
        return `<rect class="dest${keyed}" data-dest="off" x="${tray.x}" y="${tray.y}" width="${tray.width}" height="${tray.height}" rx="4"/>`;
      }
      const n = view(mover, to);
      return `<path class="dest${cursor === to ? ' cursor' : ''}" data-dest="p${n}" d="${trianglePath(n)}"/>`;
    })
    .join('');
}

// A hint's moves as arrows from each checker to where it goes.
function hintsHtml(board) {
  if (!tip?.moves?.length || match.phase !== 'move') return '';
  const mover = match.turn;
  const counts = board.map(half => [...half]);
  let html = '';
  for (const [from, to] of tip.moves) {
    const start = placeOf(mover, from, counts[mover][from] - 1);
    counts[mover][from]--;
    const end = placeOf(mover, to, counts[mover][to]);
    counts[mover][to]++;
    html += `<line x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}" marker-end="url(#arrow)"/>`;
  }
  return `<defs><marker id="arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10z"/></marker></defs>${html}`;
}

// Where the kth checker of `side` on its point p (or the bar, or off) sits.
function placeOf(side, p, k) {
  if (p === BAR) return barXY(side === bottom(), Math.max(0, k));
  if (p === OFF) return trayXY(side === bottom(), Math.max(0, k));
  return checkerXY(view(side, p), Math.max(0, k));
}

function render() {
  const table = $('table');
  table.dataset.phase = match.phase;
  table.dataset.showing = show ? 'yes' : 'no'; // for the test driver
  const now = actor();
  if (canAct() && match.phase === 'move' && picked === null) {
    // A checker on the bar must come in first, so it is picked up already.
    if (turnNow().moves.some(move => move.from === BAR)) picked = BAR;
  }

  const board = shownBoard();
  [0, 1].forEach(side => {
    const box = document.querySelector(`.score[data-side="${side}"]`);
    box.querySelector('.name').textContent = nameOf(side);
    box.querySelector('.points').textContent = match.score[side];
    box.querySelector('.pips').textContent = `${pipCount(board, side)} pips`;
    box.classList.toggle('active', now === side);
  });

  // The points are numbered for the side to act, as moves are written.
  for (const label of $('board').querySelectorAll('.labels text')) {
    label.textContent = fromView(now ?? match.turn, Number(label.dataset.n));
  }
  const svg = $('board').querySelector('svg');
  svg.querySelector('.pieces').innerHTML = piecesHtml(board);
  svg.querySelector('.marks').innerHTML = marksHtml();
  svg.querySelector('.hints').innerHTML = hintsHtml(board);

  $('events').textContent = messages.join(' ');
  const [prompt, warn] = tip ? [tip.text, false] : promptText();
  $('prompt').textContent = prompt;
  $('prompt').classList.toggle('tip', Boolean(tip));
  $('prompt').classList.toggle('warn', warn);

  const acting = canAct();
  const [text, enabled] = mainButton(acting);
  $('btn-main').textContent = text;
  $('btn-main').disabled = !enabled;
  const [second, secondOn] = secondButton(acting);
  $('btn-second').textContent = second;
  $('btn-second').disabled = !secondOn;
  for (const [id, cube] of [['btn-main', ['roll', 'take']], ['btn-second', ['double', 'pass']]]) {
    $(id).classList.toggle('tip', Boolean(tip?.cube) && cube.includes(tip.cube));
  }
  $('btn-hint').hidden = !settings.hints;
  $('btn-hint').disabled = !acting;
  $('btn-sound').setAttribute('aria-pressed', settings.sound);

  // A game's end is shown once its last move has been, and a won match once
  // it has been celebrated.
  $('gameover').hidden = !['between', 'over'].includes(match.phase) || Boolean(show);
  $('gameover').classList.toggle('party', Boolean(celebrating));
  if (!$('gameover').hidden) $('gameover-body').innerHTML = resultHtml();
}

const diceText = dice => (dice[0] === dice[1] ? `double ${dice[0]}s` : `${dice[0]} and ${dice[1]}`);

// What the prompt says, and whether as a warning.
function promptText() {
  if (show) return [show.prompt ?? '', false];
  const side = actor();
  if (side === null) return ['', false];
  const people = match.mode !== 'ai';
  const lead = people ? `${nameOf(side)}: ` : '';
  if (isAi(side)) return [match.phase === 'doubled' ? `${nameOf(side)} is thinking about the double…` : `${nameOf(side)} is thinking…`, false];
  if (match.phase === 'doubled') {
    const value = match.cube.value;
    return [`${lead}Take, and play on for ${value * 2} points? Or pass, and give up ${value} point${value > 1 ? 's' : ''}?`, false];
  }
  if (match.phase === 'roll') {
    if (canDouble(match, side)) return [`${whose(side)} turn. Roll, or double the stakes first.`, false];
    return [`${whose(side)} turn. Roll the dice.`, false];
  }
  const state = turnNow();
  const say = text => [people ? `${lead}${text}` : capital(text), false];
  if (state.done && !state.moves.length) {
    if (!made.length) return say(`no move is possible with ${diceText(match.dice)}. Press Done.`);
    return say('press Done to end the turn, or Undo to change it.');
  }
  if (picked !== null) return say('tap a lit place to move there.');
  return say(`play ${made.length ? 'the rest of ' : ''}your ${diceText(match.dice)}. Tap a checker, then where it goes.`);
}

function mainButton(acting) {
  if (match.phase === 'roll') return ['Roll', acting];
  if (match.phase === 'move') return ['Done', acting && turnNow().done];
  if (match.phase === 'doubled') return ['Take', acting];
  if (match.phase === 'between') return ['Next game', true];
  return ['Match over', false];
}

function secondButton(acting) {
  if (match.phase === 'roll' && cubeInUse()) return ['Double', acting && canDouble(match, actor())];
  if (match.phase === 'doubled') return ['Pass', acting];
  return ['Undo', acting && match.phase === 'move' && made.length > 0];
}

const KIND = { single: 'a single game', gammon: 'a gammon', backgammon: 'a backgammon' };

// The box at the end of a game, and at the end of the match.
function resultHtml() {
  const { result, score, target } = match;
  const winner = result.winner;
  const over = match.phase === 'over';
  const people = match.mode !== 'ai';
  const title = over
    ? isYou(winner) ? 'You win the match!' : `${nameOf(winner)} wins the match`
    : isYou(winner) ? 'You win the game' : `${nameOf(winner)} wins the game`;
  const kind = result.kind === 'single' ? '' : result.kind === 'gammon' ? 'Gammon!' : 'Backgammon!';
  const points = `${result.points} point${result.points > 1 ? 's' : ''}`;
  const cube = result.cube > 1 ? `the cube at ${result.cube}` : '';
  let how;
  if (result.by === 'pass') how = `${does(other(winner), 'pass')} the double: ${points}.`;
  else if (kind) how = cube ? `With ${cube}: ${points}.` : `${capital(points)}.`;
  else how = `A single game${cube ? `, with ${cube}` : ''}: ${points}.`;
  const rows = [0, 1]
    .map(side => `<tr><th>${escapeHtml(nameOf(side))}</th><td>${score[side]}</td><td>${match.tally[side].games}</td><td>${match.tally[side].gammons + match.tally[side].backgammons}</td></tr>`)
    .join('');
  const crawfordNext = !over && match.crawford === null && cubeInUse() && score.some(points => points === target - 1);
  const row = !people ? stats.ai[match.difficulty] : null;
  const actions = over
    ? `<button class="btn primary" data-do="again">Play again</button><div class="row"><button class="btn" data-do="stats">Statistics</button><button class="btn" data-do="menu">Menu</button></div>`
    : `<button class="btn primary" data-do="next">Next game</button><div class="row"><button class="btn" data-do="menu">Menu</button></div>`;
  return `
    <h2>${escapeHtml(title)}</h2>
    ${kind ? `<p class="kind">${kind}</p>` : ''}
    <p>${escapeHtml(how)}</p>
    <table class="grid">
      <thead><tr><th></th><th>Points</th><th>Games</th><th>Gammons</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="muted">Match to ${target}.${crawfordNext ? ' The next game is the Crawford game: no doubling in it.' : ''}</p>
    ${over && row ? `<p class="muted">${capital(match.difficulty)} computer: ${row.wins} won of ${row.matches} played.</p>` : ''}
    ${actions}`;
}

function statsHtml() {
  const percent = (part, whole) => (whole ? `${Math.round((100 * part) / whole)}%` : '–');
  const rows = Object.entries(stats.ai)
    .map(([level, row]) =>
      `<tr><th>${capital(level)}</th><td>${row.matches}</td><td>${row.wins}</td>` +
      `<td>${percent(row.wins, row.matches)}</td><td>${row.streak}</td><td>${row.bestStreak}</td></tr>`)
    .join('');
  const people = Object.values(stats.people)
    .filter(person => person.matches)
    .sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name))
    .map(person => `<tr><th>${escapeHtml(person.name)}</th><td>${person.matches}</td><td>${person.wins}</td><td>${percent(person.wins, person.matches)}</td></tr>`)
    .join('');
  const { games, records } = stats;
  return `
    <h3>Against the computer</h3>
    <table class="grid">
      <thead><tr><th></th><th>Matches</th><th>Won</th><th>Win&nbsp;%</th><th>Streak</th><th>Best</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <dl class="facts">
      <dt>Games won / lost</dt><dd>${games.won} / ${games.lost}</dd>
      <dt>Gammons won / lost</dt><dd>${games.gammonsWon} / ${games.gammonsLost}</dd>
      <dt>Backgammons won / lost</dt><dd>${games.backgammonsWon} / ${games.backgammonsLost}</dd>
      <dt>Highest cube</dt><dd>${records.cube > 1 ? records.cube : '–'}</dd>
      <dt>Biggest match win</dt><dd>${records.margin ? `by ${records.margin}` : '–'}</dd>
    </dl>
    <h3>Between people</h3>
    ${
      people
        ? `<table class="grid"><thead><tr><th></th><th>Matches</th><th>Won</th><th>Win&nbsp;%</th></tr></thead><tbody>${people}</tbody></table>`
        : '<p>No matches finished yet.</p>'
    }
    <p class="muted">Finished matches are saved in this browser, on this device.</p>`;
}

// ---- Animation ----------------------------------------------------------
//
// While something is shown (the checkers set out, the dice rolling, the
// computer's checkers moving, the cube turned), the board draws `show`
// instead of the match: the position, dice and cube as they stood, moved on
// one step at a time. Each step changes `show`, the board is drawn, and the
// step then sets its pieces moving. Input waits, and a tap or key skips to
// the end, where the match already is.

function runShow(steps, before) {
  show = { board: before.board, dice: null, cube: null, prompt: '', steps, timer: 0, ticker: 0 };
  nextStep();
}

function nextStep() {
  if (!show) return;
  clearInterval(show.ticker);
  const step = show.steps.shift();
  if (!step) {
    endShow();
    return;
  }
  step.change?.();
  render();
  step.animate?.();
  show.timer = setTimeout(nextStep, step.wait ?? 0);
}

// Also called early, when a tap or key skips the animation.
function endShow() {
  if (!show) return;
  clearTimeout(show.timer);
  clearInterval(show.ticker);
  show = null;
  finish();
}

// Moves an element of the board through `places` ([x, y] in board units),
// arriving where it is drawn.
function fly(element, places, duration, delay = 0) {
  if (!element || places.length < 2) return;
  element.parentNode.append(element); // over the others while it moves
  element.animate(
    places.map(([x, y]) => ({ transform: `translate(${x}px, ${y}px)` })),
    { duration, delay, easing: 'ease-in-out', fill: 'backwards' },
  );
}

const pieceAt = key => $('board').querySelector(`[data-key="${key}"]`);

// The element of `side`'s checker on top of its point p (or bar, or off).
function topPiece(board, side, p) {
  const count = board[side][p];
  if (p === OFF) return pieceAt(`${side}:off:${count - 1}`);
  if (p === BAR) return pieceAt(`${side}:bar:${Math.min(count, BAR_STACK) - 1}`);
  return pieceAt(`${side}:p${view(side, p)}:${Math.min(count, STACK) - 1}`);
}

// Where the top checker of a place stands.
const topPlace = (board, side, p) => placeOf(side, p, Math.min(board[side][p] - 1, p === BAR ? BAR_STACK - 1 : p === OFF ? 99 : STACK - 1));

// One checker's move as an animation step: it slides from where it stood,
// and a checker it hits flies to the bar.
function moveStep(side, from, to) {
  let start;
  let hitFrom = null;
  return {
    change() {
      const board = show.board;
      start = topPlace(board, side, from);
      const theirs = other(side);
      const next = board.map(half => [...half]);
      next[side][from]--;
      next[side][to]++;
      if (to !== OFF && next[theirs][25 - to] === 1) {
        hitFrom = placeOf(theirs, 25 - to, 0);
        next[theirs][25 - to] = 0;
        next[theirs][BAR]++;
      }
      show.board = next;
    },
    animate() {
      const board = show.board;
      fly(topPiece(board, side, to), [start, topPlace(board, side, to)], MOVE_MS);
      if (hitFrom) fly(topPiece(board, other(side), BAR), [hitFrom, topPlace(board, other(side), BAR)], MOVE_MS, MOVE_MS * 0.6);
      playSound(to === OFF ? 'off' : hitFrom ? 'hit' : 'place', MOVE_MS / 1000);
    },
    wait: MOVE_MS + MOVE_GAP_MS,
  };
}

// Dice tumbling, then landing: `dice` are [{ side, value }].
function rollStep(dice, hold) {
  return {
    change() {
      show.dice = dice.map(die => ({ ...die, rolling: true, real: die.value }));
      show.prompt = '';
    },
    animate() {
      playSound('shake');
      const tumble = () => {
        show.dice = show.dice.map(die => ({ ...die, value: 1 + Math.floor(Math.random() * 6) }));
        render();
      };
      tumble();
      show.ticker = setInterval(tumble, FACE_MS);
      const rolling = show;
      setTimeout(() => {
        if (show !== rolling) return;
        clearInterval(show.ticker);
        show.dice = show.dice.map(die => ({ side: die.side, value: die.real }));
        render();
        playSound('roll');
      }, ROLL_MS);
    },
    wait: ROLL_MS + hold,
  };
}

// The checkers set out for a new game, flying from their trays one after another.
function setupStep() {
  return {
    change() {
      show.board = startBoard();
      show.dice = [];
      show.cube = { place: 'centre', value: 1 };
      show.prompt = 'Setting out the checkers…';
    },
    animate() {
      playSound('setup');
      const pieces = [...$('board').querySelectorAll('.pieces .checker')];
      pieces.forEach((piece, i) => {
        const side = Number(piece.dataset.key[0]);
        const [x, y] = trayXY(side === bottom(), 7);
        const style = piece.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
        if (!style) return;
        fly(piece, [[x, y], [Number(style[1]), Number(style[2])]], FLIGHT_MS, (i * SETUP_MS) / pieces.length);
      });
    },
    wait: SETUP_MS + FLIGHT_MS,
  };
}

function cubeStep(place, value) {
  let from;
  return {
    change() {
      const [x, y] = cubeXY(cubeShownPlace());
      from = [x, y];
      show.cube = { place, value };
    },
    animate() {
      const element = $('board').querySelector('.pieces .cube');
      fly(element, [from, cubeXY(place)], CUBE_MS);
      playSound('cube', CUBE_MS / 1000);
    },
    wait: CUBE_MS + 200,
  };
}

const cubeShownPlace = () => (show?.cube ?? cubeNow()).place;

// The steps that show what a change to the match did. Moves made here are
// on the board already.
function stepsFor(events, own) {
  const steps = [];
  for (const event of events) {
    if (event.type === 'opening') {
      if (!steps.length) steps.push(setupStep());
      const [a, b] = event.dice;
      steps.push(rollStep([{ side: 0, value: a }, { side: 1, value: b }], OPENING_HOLD_MS));
    } else if (event.type === 'start') {
      const [a, b] = event.dice;
      steps.push({ change: () => (show.dice = [{ side: event.side, value: a }, { side: event.side, value: b }]), wait: 200 });
    } else if (event.type === 'roll') {
      const [a, b] = event.dice;
      const values = a === b ? [a, a, a, a] : [a, b];
      steps.push(rollStep(values.map(value => ({ side: event.side, value })), 0));
    } else if (event.type === 'move' && !own) {
      steps.push(moveStep(event.side, event.from, event.to));
    } else if (event.type === 'double') {
      const place = other(event.side) === bottom() ? 'offer-bottom' : 'offer-top';
      steps.push(cubeStep(place, event.value));
    } else if (event.type === 'take') {
      steps.push(cubeStep(event.side === bottom() ? 'bottom' : 'top', event.value));
    }
  }
  return steps;
}

// ---- Actions ------------------------------------------------------------

function describe(events, before) {
  const said = [];
  const moves = events.filter(event => event.type === 'move');
  for (const event of events) {
    const { side } = event;
    if (event.type === 'opening') {
      const [a, b] = event.dice;
      said.push(a === b ? `Both roll ${a}.` : `${does(0, 'roll')} ${a} and ${isYou(0) ? 'the computer' : nameOf(1)} ${b}.`);
    } else if (event.type === 'start') {
      said.push(`${nameOf(side)} ${isYou(side) ? 'go' : 'goes'} first with ${event.dice[0]}-${event.dice[1]}.`);
    } else if (event.type === 'roll') {
      said.push(`${does(side, 'roll')} ${event.dice[0]}-${event.dice[1]}.`);
    } else if (event.type === 'move' && event === moves[0]) {
      said.push(`${does(side, 'play')} ${moveText(before.board, side, moves.map(move => [move.from, move.to]))}.`);
    } else if (event.type === 'blocked') {
      said.push(`${nameOf(side)} cannot move.`);
    } else if (event.type === 'double') {
      said.push(`${does(side, 'double')} to ${event.value}.`);
    } else if (event.type === 'take') {
      said.push(`${does(side, 'take')}.`);
    } else if (event.type === 'pass') {
      said.push(`${does(side, 'pass')}.`);
    } else if (event.type === 'win') {
      said.push(`${does(side, 'win')} ${event.by === 'pass' ? 'the game' : KIND[event.kind]}: ${event.points} point${event.points > 1 ? 's' : ''}.`);
    }
  }
  return said;
}

// One sound for each thing that just happened, when nothing was shown.
function soundEvents(events) {
  let delay = 0;
  for (const event of events) {
    if (event.type === 'roll' || event.type === 'start') playSound('roll', delay);
    else if (event.type === 'move') playSound(event.to === OFF ? 'off' : event.hit ? 'hit' : 'place', (delay += 0.12));
    else if (event.type === 'double' || event.type === 'take') playSound('cube', delay);
  }
}

// What the match looked like before a change.
const snapshot = () => ({ board: match.board.map(half => [...half]), phase: match.phase, turn: match.turn, gameNo: match.gameNo });

// Runs one action on the match, then shows what it did. `own` is a turn
// whose checkers were moved here, which need not be shown again.
function commit(action, own = false) {
  const before = snapshot();
  action();
  settle(before, own);
}

// Everything that follows a change to the match: what it says, saving,
// statistics, then the animation, and after it the sounds, the celebration
// and the computer's next move.
function settle(before, own = false) {
  input?.cancel();
  made = [];
  picked = null;
  cursor = null;
  tip = null;
  messages = describe(match.events, before);
  store(GAME_KEY, match.phase === 'over' ? null : match);
  if (match.phase === 'over') record();
  const steps = $('table').hidden || reducedMotion() ? [] : stepsFor(match.events, own);
  if (steps.length) {
    runShow(steps, before);
    return;
  }
  if (!$('table').hidden) soundEvents(match.events);
  finish();
}

// After a change has been shown: the end of the match, the board as it now
// is, and the computer's next move.
function finish() {
  if (match.phase === 'over' && !$('table').hidden) playSound(personWon() ? 'win' : 'lose', 0.2);
  celebrate();
  render();
  scheduleAi();
}

function record() {
  recordMatch(stats, match);
  store(STATS_KEY, stats);
}

// A win by a person is celebrated before the box appears: fireworks and
// confetti. A win for the computer goes straight to the box.
function celebrate() {
  if (match.phase !== 'over' || !personWon() || reducedMotion() || $('table').hidden || celebrating) return;
  party = startParty($('party'), () => playSound('firework'));
  celebrating = setTimeout(() => endCelebration(), CHEER_MS);
}

// Shows the box. Also called early, when a tap or key skips the celebration;
// then the fireworks stop too, instead of fading out behind it.
function endCelebration(skipped = false) {
  if (!celebrating) return;
  clearTimeout(celebrating);
  celebrating = 0;
  if (skipped) stopParty();
  render();
}

function stopParty() {
  clearTimeout(celebrating);
  celebrating = 0;
  party?.stop();
  party = null;
}

// The computer's move, after a pause: answering a double, doubling or
// rolling, then playing its roll.
function scheduleAi() {
  clearTimeout(aiTimer);
  if (!match || show || $('table').hidden) return;
  const side = actor();
  if (side === null || !isAi(side)) return;
  const phase = match.phase;
  aiTimer = setTimeout(() => {
    if (show || actor() !== side || match.phase !== phase) return;
    if (phase === 'doubled') commit(() => (shouldTake(match, side) ? take : pass)(match, side));
    else if (phase === 'roll') commit(() => (shouldDouble(match, side) ? double(match, side) : roll(match, side)));
    else commit(() => play(match, side, pickTurn(match, side).moves));
  }, phase === 'move' ? AI_MOVE_DELAY : AI_DELAY);
}

// A move by the person who must act here.
function act(move) {
  const side = actor();
  commit(() => apply(side, move), move.t === 'play');
}

function apply(side, move) {
  if (move.t === 'roll') roll(match, side);
  else if (move.t === 'double') double(match, side);
  else if (move.t === 'take') take(match, side);
  else if (move.t === 'pass') pass(match, side);
  else if (move.t === 'play') play(match, side, move.moves);
  else if (move.t === 'next' && match.phase === 'between' && move.game === match.gameNo) nextGame(match);
}

// Moves the checker on `from` to `to`, by as many dice as it takes, during
// a turn made here. A dropped checker is where it lands already; a tapped
// one slides there.
function makeMove(from, to, slide = true) {
  const route = reachable(from).find(option => option.to === to);
  if (!route) return;
  const before = shownBoard();
  const step = (made.at(-1)?.step ?? 0) + 1;
  made.push(...route.steps.map(move => ({ ...move, step })));
  picked = null;
  tip = null;
  const after = shownBoard();
  const side = match.turn;
  const them = other(side);
  // The way the checker goes, place by place, and where it hits on the way.
  const places = [topPlace(before, side, from)];
  let hitAt = null;
  let board = before;
  for (const move of route.steps) {
    if (move.to !== OFF && board[them][25 - move.to] === 1) hitAt = placeOf(them, 25 - move.to, 0);
    board = applyMoves(board, side, [[move.from, move.to]]);
    places.push(topPlace(board, side, move.to));
  }
  render();
  if (slide && !reducedMotion()) {
    fly(topPiece(after, side, to), places, OWN_MS * route.steps.length);
    if (hitAt) fly(topPiece(after, them, BAR), [hitAt, topPlace(after, them, BAR)], OWN_MS, OWN_MS * route.steps.length);
  }
  const hit = Boolean(hitAt);
  playSound(to === OFF ? 'off' : hit ? 'hit' : 'place', slide ? (OWN_MS * route.steps.length) / 1000 : 0);
}

function undo() {
  if (!canAct() || match.phase !== 'move' || !made.length) return;
  const step = made.at(-1).step;
  made = made.filter(move => move.step !== step);
  picked = null;
  tip = null;
  render();
}

function onMain() {
  if (show) return;
  if (match.phase === 'between') {
    act({ t: 'next', game: match.gameNo });
    return;
  }
  if (!canAct()) return;
  if (match.phase === 'roll') act({ t: 'roll' });
  else if (match.phase === 'doubled') act({ t: 'take' });
  else if (match.phase === 'move' && turnNow().done) act({ t: 'play', moves: made.map(move => [move.from, move.to]) });
}

function onSecond() {
  if (!canAct()) return;
  if (match.phase === 'roll' && canDouble(match, actor())) act({ t: 'double' });
  else if (match.phase === 'doubled') act({ t: 'pass' });
  else undo();
}

// A hint during a turn shows the best play for the whole roll, so any
// checkers already moved go back first.
function onHint() {
  if (!settings.hints || !canAct()) return;
  made = [];
  picked = null;
  tip = hint(match, actor());
  render();
}

// A tap on the board: on a checker to pick it up (again to put it back), on
// a lit place to move there, or on the dice to roll.
function onTap(place) {
  if (!canAct() || !place) return;
  if (match.phase === 'roll') {
    if (place.kind === 'dice') act({ t: 'roll' });
    return;
  }
  if (match.phase !== 'move') return;
  const side = match.turn;
  const p = pointOf(side, place);
  if (p === null) return;
  if (picked !== null && reachable(picked).some(option => option.to === p)) {
    makeMove(picked, p);
    return;
  }
  picked = movable().includes(p) && picked !== p ? p : null;
  cursor = null;
  render();
}

// A place on the board as a point of `side`'s: BAR, OFF or 1–24, or null.
function pointOf(side, place) {
  if (place.kind === 'bar') return BAR;
  if (place.kind === 'tray') return place.bottom === (side === bottom()) ? OFF : null;
  if (place.kind === 'point') return fromView(side, place.n);
  return null;
}

function toggleSound() {
  settings.sound = !settings.sound;
  store(SETTINGS_KEY, settings);
  setMuted(!settings.sound);
  unlockSound();
  playSound('place'); // heard only when sound has just come back on
  $('btn-sound').setAttribute('aria-pressed', settings.sound);
}

function confirmFirst(title, text, button, action) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('btn-confirm').textContent = button;
  confirmed = action;
  $('confirm').hidden = false;
}

// ---- The keyboard's cursor ------------------------------------------------

// The arrow keys move between the checkers that may move, farthest back
// first, or once one is picked up, between the places it may go; Space picks
// up and puts down.
function cursorStops() {
  if (!canAct() || match.phase !== 'move') return [];
  const stops = picked === null ? movable() : [picked, ...reachable(picked).map(option => option.to)];
  return [...new Set(stops)].sort((a, b) => b - a);
}

// With nothing under the cursor yet it starts from the picked checker, so the
// first press goes to the first place that checker may go.
function moveCursor(step) {
  const stops = cursorStops();
  if (!stops.length) return;
  const i = stops.indexOf(cursor ?? picked);
  cursor = stops[i < 0 ? (step > 0 ? 0 : stops.length - 1) : (i + step + stops.length) % stops.length];
  render();
}

function pressCursor() {
  if (cursor === null) {
    moveCursor(1);
    return;
  }
  if (picked !== null && cursor !== picked) {
    const to = cursor;
    cursor = null;
    makeMove(picked, to);
    return;
  }
  if (picked === cursor) {
    picked = null; // put it back
    render();
    return;
  }
  picked = cursor;
  moveCursor(1);
}

// ---- Screens ------------------------------------------------------------

// The players for a new match from the menu. Two people typing the same name
// become "Ann" and "Ann 2", so that every message names one person.
function playersFor() {
  if (settings.mode === 'ai') return [{ name: 'You' }, { name: 'Computer', ai: true, level: settings.difficulty }];
  const players = [];
  settings.names.forEach((typed, i) => {
    const wanted = typed.replace(/\s+/g, ' ').trim() || `Player ${i + 1}`;
    let name = wanted;
    for (let n = 2; players.some(other => other.name.toLowerCase() === name.toLowerCase()); n++) {
      name = `${wanted.slice(0, NAME_LENGTH - String(n).length - 1)} ${n}`;
    }
    players.push({ name });
  });
  return players;
}

function showMenu() {
  clearTimeout(aiTimer);
  if (show) {
    clearTimeout(show.timer);
    clearInterval(show.ticker);
    show = null;
  }
  input?.cancel();
  stopParty();
  for (const group of document.querySelectorAll('.choice[data-setting]')) {
    for (const button of group.children) {
      button.setAttribute('aria-pressed', parseValue(button.dataset.value) === settings[group.dataset.setting]);
    }
  }
  const { mode } = settings;
  $('menu').dataset.mode = mode;
  $('row-difficulty').hidden = mode !== 'ai';
  $('row-names').hidden = mode !== 'local';
  $('row-cube').hidden = settings.target === 1;
  for (const field of document.querySelectorAll('[data-name]')) field.value = settings.names[Number(field.dataset.name)];

  const saved = load(GAME_KEY);
  const canResume = saved?.v === 1 && !['over'].includes(saved.phase) && Array.isArray(saved.board);
  $('btn-resume').hidden = !canResume;
  if (canResume) $('btn-resume').textContent = `Resume match (${saved.score.join('–')}, to ${saved.target})`;
  $('btn-new').classList.toggle('primary', !canResume);

  for (const id of ['table', 'gameover', 'confirm']) $(id).hidden = true;
  $('menu').hidden = false;
}

// `fresh` is a match just begun, whose checkers are set out and opening roll shown.
function start(saved = null, fresh = !saved) {
  stopParty();
  clearTimeout(aiTimer);
  match = saved ?? newMatch({ mode: settings.mode, difficulty: settings.difficulty, target: settings.target, cube: settings.cube, players: playersFor() });
  made = [];
  picked = null;
  cursor = null;
  tip = null;
  messages = [];
  turns = null;
  show = null;
  drawBoard();
  $('menu').hidden = true;
  $('table').hidden = false;
  if (fresh) {
    settle(snapshot());
    return;
  }
  store(GAME_KEY, match);
  render();
  scheduleAi();
}

// Play again: the same players, length and level, whatever the menu now says.
function playAgain() {
  const { mode, difficulty, target, cubeOn, players } = match;
  start(newMatch({ mode, difficulty, target, cube: cubeOn, players: players.map(({ name, ai, level }) => ({ name, ai, level })) }), true);
}

function showStats() {
  resetArmed = false;
  $('btn-reset').textContent = 'Reset statistics';
  $('stats-body').innerHTML = statsHtml();
  $('stats').hidden = false;
}

// ---- Wiring -------------------------------------------------------------

$('menu').addEventListener('click', event => {
  const button = event.target.closest('.choice button');
  if (!button) return;
  settings[button.parentElement.dataset.setting] = parseValue(button.dataset.value);
  store(SETTINGS_KEY, settings);
  setMuted(!settings.sound);
  showMenu();
});

for (const field of document.querySelectorAll('[data-name]')) {
  field.addEventListener('input', () => {
    settings.names[Number(field.dataset.name)] = field.value.slice(0, NAME_LENGTH);
    store(SETTINGS_KEY, settings);
  });
}

$('btn-new').addEventListener('click', () => start());
$('btn-resume').addEventListener('click', () => {
  const saved = load(GAME_KEY);
  if (saved?.v === 1) start(saved);
});
$('btn-confirm').addEventListener('click', () => {
  $('confirm').hidden = true;
  const action = confirmed;
  confirmed = null;
  action?.();
});

$('btn-stats').addEventListener('click', showStats);
$('btn-rules').addEventListener('click', () => {
  $('rules').hidden = false;
});
$('about-version').textContent = `Version ${VERSION} · ${RELEASED}`;
$('btn-about').addEventListener('click', () => {
  $('about').hidden = false;
});
$('btn-menu').addEventListener('click', showMenu);
$('btn-main').addEventListener('click', onMain);
$('btn-second').addEventListener('click', onSecond);
$('btn-hint').addEventListener('click', onHint);
$('btn-sound').addEventListener('click', toggleSound);

input = setupInput({
  host: $('board'),
  handlers: {
    canDrag: place => canAct() && match.phase === 'move' && movable().includes(pointOf(match.turn, place)),
    lift(place) {
      picked = pointOf(match.turn, place);
      cursor = null;
      tip = null;
      render();
      return topPiece(shownBoard(), match.turn, picked);
    },
    canDrop: (place, target) => {
      const from = pointOf(match.turn, place);
      const to = pointOf(match.turn, target);
      return to !== null && reachable(from).some(option => option.to === to);
    },
    drop(place, target) {
      const from = pointOf(match.turn, place);
      const to = target && pointOf(match.turn, target);
      if (to !== null && to !== undefined && reachable(from).some(option => option.to === to)) makeMove(from, to, false);
      else render();
    },
    tap: onTap,
  },
});

$('gameover').addEventListener('click', event => {
  const action = event.target.dataset.do;
  if (action === 'again') playAgain();
  else if (action === 'next') onMain();
  else if (action === 'stats') showStats();
  else if (action === 'menu') showMenu();
});

// The first press arms the button, the second erases.
$('btn-reset').addEventListener('click', () => {
  if (!resetArmed) {
    resetArmed = true;
    $('btn-reset').textContent = 'Tap again to erase';
    return;
  }
  Object.assign(stats, emptyStats());
  store(STATS_KEY, stats);
  showStats();
});

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => {
    button.closest('.overlay').hidden = true;
  });
}

// Browsers only allow sound once the page has been tapped or typed at, so every
// tap and key wakes the audio. Either one also skips an animation in progress,
// and then does nothing else: it must not also move a checker or press a button.
for (const type of ['pointerdown', 'keydown']) {
  document.addEventListener(
    type,
    event => {
      unlockSound();
      skipClick = Boolean(show) || Boolean(celebrating);
      if (!skipClick) return;
      endCelebration(true); // first, as the end of an animation can start one
      endShow();
      if (type === 'keydown') {
        event.stopPropagation();
        // Stop Enter or Space pressing the focused button, but leave browser
        // shortcuts such as reload alone.
        if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
      }
    },
    true,
  );
}

// The click that follows a skipping tap is dropped before anything sees it.
document.addEventListener(
  'click',
  event => {
    if (!skipClick) return;
    skipClick = false;
    event.stopPropagation();
    event.preventDefault();
  },
  true,
);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    const open = ['rules', 'stats', 'about', 'confirm'].filter(id => !$(id).hidden);
    for (const id of open) $(id).hidden = true;
    if (!open.length && match && !$('table').hidden && (picked !== null || cursor !== null)) {
      picked = null;
      cursor = null;
      render();
    }
    return;
  }
  if (event.target.matches?.('input')) return;
  const busy = !match || $('table').hidden || !$('rules').hidden || !$('stats').hidden || !$('confirm').hidden || !$('about').hidden;
  if (busy || event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (event.key === 'Enter' && event.target !== $('btn-menu')) {
    event.preventDefault(); // Enter always presses the main button, whichever has focus
    onMain();
  } else if (key === 'h') onHint();
  else if (key === 'm') toggleSound();
  else if (key === 'd') {
    if (match.phase === 'roll') onSecond();
  } else if (key === 'u' || event.key === 'Backspace') {
    event.preventDefault();
    undo();
  } else if (event.key === ' ') {
    if (canAct() && match.phase === 'move') {
      event.preventDefault();
      pressCursor();
    }
  } else if (event.key.startsWith('Arrow') && canAct() && match.phase === 'move') {
    event.preventDefault();
    moveCursor(event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1);
  }
});

showMenu();
