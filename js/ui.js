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
import { setupInput } from './input.js';
import { planThrow, throwDice, dieFace, THROW_TOTAL_MS, FIRST_BOUNCE_MS } from './dice.js';
import { OPENING_GROUPS, parsePlay } from './openings.js';
import { openRoom, joinRoom, cleanCode, CODE_LENGTH } from './net.js';
import { createHost, createGuest, cleanName, sameState, deniedText, MAX_PLAYERS, NAME_LENGTH } from './wifi.js';

// Shown in the About box. Bump both with every release: a browser still
// running a cached copy of this file then shows the old number.
const VERSION = '1.2.0';
const RELEASED = '30 October 2026';

const AI_DELAY = 800; // the computer's pause before it rolls, doubles or answers a double
const AI_MOVE_DELAY = 450; // and after its dice land, before its first checker moves
const OPENING_HOLD_MS = 650; // the opening dice stay up this long once they land
const EXTRA_DICE_MS = 220; // the other two dice of a double appearing, once two have landed
const MOVE_MS = 280; // a checker sliding to its next place
const MOVE_GAP_MS = 140; // between one of the computer's checkers and the next
const OWN_MS = 170; // a checker you send, after you tap where it goes
const SETUP_MS = 700; // from the first checker set out at a new game to the last
const FLIGHT_MS = 300; // each one's flight from the tray
const CUBE_MS = 420; // the cube moving
const CHEER_MS = 3500; // fireworks and confetti before the box appears
const SETTINGS_KEY = 'backgammon.settings';
const GAME_KEY = 'backgammon.game';
const STATS_KEY = 'backgammon.stats';
const RECORDED_KEY = 'backgammon.recorded'; // the last Wi-Fi match in this phone's statistics
const WIFI_KEY = 'backgammon.wifi'; // per tab: this tab's part in a Wi-Fi game, for a reload
const TOKEN_KEY = 'backgammon.token'; // per tab: how the host knows this tab again

const $ = id => document.getElementById(id);

// ?store=NAME keeps this page's storage under keys of its own, so that the
// test driver's two frames can be two phones. `tab` storage (sessionStorage)
// lasts as long as the tab, through reloads.
const STORE = new URLSearchParams(location.search).get('store');
const keyed = key => (STORE ? `${key}:${STORE}` : key);

function load(key, tab = false) {
  try {
    return JSON.parse((tab ? sessionStorage : localStorage).getItem(keyed(key)));
  } catch {
    return null;
  }
}

function store(key, value, tab = false) {
  try {
    const place = tab ? sessionStorage : localStorage;
    if (value === null) place.removeItem(keyed(key));
    else place.setItem(keyed(key), JSON.stringify(value));
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
  const settings = { mode: 'ai', difficulty: 'medium', names: ['', ''], wifiName: '', target: 5, cube: true, hints: true, sound: true };
  const saved = load(SETTINGS_KEY);
  for (const group of document.querySelectorAll('.choice[data-setting]')) {
    const key = group.dataset.setting;
    const offered = [...group.children].map(button => parseValue(button.dataset.value));
    if (offered.includes(saved?.[key])) settings[key] = saved[key];
  }
  if (Array.isArray(saved?.names)) {
    settings.names = settings.names.map((name, i) => (typeof saved.names[i] === 'string' ? saved.names[i].slice(0, NAME_LENGTH) : name));
  }
  if (typeof saved?.wifiName === 'string') settings.wifiName = saved.wifiName.slice(0, NAME_LENGTH);
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
let lying = null; // where the dice of the roll being played came to rest: { key, dice }
let celebrating = 0; // timer while a win is celebrated and the box waits
let party = null; // the fireworks and confetti, which outlast the celebration a little
let skipClick = false; // the tap that skipped an animation should do nothing else
let resetArmed = false;
let confirmed = null; // what the confirm box's button does
let aiTimer = 0;
let input = null;
// A Wi-Fi game (see the section of that name below).
let session = null; // this phone's part: { role: 'host', host, room, code, trouble } or { role: 'guest', guest, code, players }
let me = 0; // this phone's side in it
let away = []; // sides whose phones are out of touch
let sent = false; // a guest's move is with the host, and not yet answered
let inbox = []; // moves and states that came during an animation
let notice = ''; // why the host refused this phone's last move
let wifiBox = null; // what the Wi-Fi box shows: 'host', 'join' or 'ended'
let wifiNote = { text: '', warn: false }; // its status line
let waitingCode = ''; // a shared link's code, while the name is still to type

setMuted(!settings.sound);

// ---- Who is who ---------------------------------------------------------

const wifiGame = () => match?.mode === 'net';
const isHost = () => wifiGame() && session?.role === 'host';
const isGuest = () => wifiGame() && session?.role === 'guest';
const liveWifi = () => Boolean(session) && wifiGame();
// A guest whose link to the host has gone can only wait for it to come back.
const linkDown = () => isGuest() && !session.guest.connected;

const isAi = side => Boolean(match.players[side].ai);
// In a Wi-Fi game each phone calls its own player "You".
const nameOf = side => (wifiGame() && side === me ? 'You' : match.players[side].name);
const isYou = side => nameOf(side) === 'You';
const does = (side, verb) => `${nameOf(side)} ${verb}${isYou(side) ? '' : verb.endsWith('s') ? 'es' : 's'}`;
const whose = side => (isYou(side) ? 'Your' : `${nameOf(side)}'s`);
const capital = text => text[0].toUpperCase() + text.slice(1);
// The side drawn at the bottom of the board: on Wi-Fi, this phone's.
const bottom = () => (wifiGame() ? me : 0);
// Whether a person won: in a Wi-Fi game, this phone's person.
const personWon = () => (wifiGame() ? match.winner === me : !isAi(match.winner));
const cubeInUse = () => match.cubeOn && match.target > 1;
// Hints: in a Wi-Fi game the host's choice, for both; otherwise the menu's.
const hintsOn = () => (wifiGame() && match.rules ? match.rules.hints : settings.hints);

// The side that must act now: to roll or move, or to answer a double.
function actor() {
  if (!match) return null;
  if (match.phase === 'roll' || match.phase === 'move') return match.turn;
  if (match.phase === 'doubled') return other(match.turn);
  return null;
}

const canAct = () => actor() !== null && !isAi(actor()) && !show && (!wifiGame() || (actor() === me && !sent && !linkDown()));

// The side the host may act for: the other phone's, when it is out of touch
// and must act.
function standIn() {
  if (!isHost() || show) return null;
  const side = actor();
  return side !== null && side !== me && away[side] ? side : null;
}

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

const at = (x, y) => `transform: translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;

function dieHtml(side, value, x, y, tilt, classes = '') {
  return `<g class="die side${side} ${classes}" style="${at(x, y)} rotate(${tilt.toFixed(1)}deg)"><g class="face">${dieFace(value)}</g></g>`;
}

// A bright ring with a dark edge, which shows against every colour on the
// board. `classes` are a checker's marks: one that may move has a ring.
const ringHtml = (radius, x = 0, y = 0) =>
  `<circle class="ring-edge" cx="${x}" cy="${y}" r="${radius}"/><circle class="ring-line" cx="${x}" cy="${y}" r="${radius}"/>`;

function checkerHtml(side, where, k, [x, y], count, classes) {
  const label = count ? `<text dy="0.36em">${count}</text>` : '';
  const ring = classes ? ringHtml(BOARD.radius - 0.6) : '';
  return `<g class="checker side${side}${classes}" data-key="${side}:${where}:${k}" style="${at(x, y)}"><circle r="${BOARD.radius}"/><circle class="inner" r="${BOARD.radius - 4}"/>${ring}${label}</g>`;
}

// The board as it should look now: during an animation, as the animation has
// got; during a turn being made here, with its moves so far.
function shownBoard() {
  if (show) return show.board;
  if (made.length) return turnNow().board;
  return match.board;
}

// The static board: frame, playing surfaces, points, bar, trays and the point
// numbers, with `layers` of whatever goes on top.
function boardHtml(layers) {
  const { width, height, quarters, bar, trays } = BOARD;
  const rect = ({ x, y, width: w, height: h }, cls) => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
  let points = '';
  let labels = '';
  for (let n = 1; n <= 24; n++) {
    points += `<path class="point ${n % 2 ? 'odd' : 'even'}" d="${trianglePath(n)}"/>`;
    const [x, y] = labelXY(n);
    labels += `<text x="${x}" y="${y}" data-n="${n}">${n}</text>`;
  }
  return (
    `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Backgammon board">` +
    `<rect class="frame" width="${width}" height="${height}" rx="10"/>` +
    quarters.map(q => rect(q, 'surface')).join('') +
    rect(bar, 'bar') +
    rect(trays.top, 'tray') +
    rect(trays.bottom, 'tray') +
    `<g class="points">${points}</g><g class="labels">${labels}</g>${layers}</svg>`
  );
}

// The table's board. The checkers, dice and cube go in the layers above the
// static board, and dice in the air in a page layer over all of it.
function drawBoard() {
  $('board').innerHTML =
    boardHtml('<g class="marks"></g><g class="pieces"></g><g class="landings"></g><g class="hints"></g><g class="drag-layer"></g>') +
    '<div class="dice-air" aria-hidden="true"></div>';
  $('scores').innerHTML = [0, 1]
    .map(side => `<div class="score" data-side="${side}"><i></i><span class="who"><span class="name"></span><small class="pips"></small></span><b class="points"></b></div>`)
    .join('');
}

// Tells the dice of one roll from the next.
const rollKey = () => `${match.id}:${match.gameNo}:${match.turn}:${match.dice}`;

// Which dice to draw: those of the animation, or of the roll being played,
// each { side, value, used, extra, rest }. `rest` is where a thrown die came to
// rest, { x, y, tilt }; without it, as after a reload, the dice lie in line.
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
  const rests = lying?.key === rollKey() ? lying.dice : [];
  return values.map((value, i) => ({ side: match.turn, value, used: Boolean(used[i]), rest: rests[i] }));
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
      const [x, y] = die.rest ? [die.rest.x, die.rest.y] : diceXY(die.side === bottom(), group.length, i);
      html += dieHtml(die.side, die.value, x, y, die.rest?.tilt ?? 0, [die.used && 'used', die.extra && 'extra'].filter(Boolean).join(' '));
    });
  }
  return html + cubeHtml();
}

// The places the picked checker may go, lit up under the checkers. The dark
// edge keeps the bright outline clear on pale points and dark ones alike.
function marksHtml() {
  if (picked === null || !canAct() || match.phase !== 'move') return '';
  const mover = match.turn;
  return reachable(picked)
    .map(({ to }) => {
      if (to === OFF) {
        const tray = BOARD.trays[mover === bottom() ? 'bottom' : 'top'];
        const box = `x="${tray.x}" y="${tray.y}" width="${tray.width}" height="${tray.height}" rx="4"`;
        return `<rect class="dest-edge" ${box}/><rect class="dest${cursor === OFF ? ' cursor' : ''}" data-dest="off" ${box}/>`;
      }
      const n = view(mover, to);
      const shape = `d="${trianglePath(n)}"`;
      return `<path class="dest-edge" ${shape}/><path class="dest${cursor === to ? ' cursor' : ''}" data-dest="p${n}" ${shape}/>`;
    })
    .join('');
}

// A ring where the picked checker would land, over the checkers: a point that
// holds some hides its lit triangle, and on a lone checker of the other side
// the ring shows the hit.
function landingsHtml(board) {
  if (picked === null || !canAct() || match.phase !== 'move') return '';
  const mover = match.turn;
  return reachable(picked)
    .filter(({ to }) => to !== OFF)
    .map(({ to }) => {
      const [x, y] = placeOf(mover, to, board[mover][to]);
      return `<g class="landing${cursor === to ? ' cursor' : ''}">${ringHtml(BOARD.radius - 1.2, x, y)}</g>`;
    })
    .join('');
}

// Moves as arrows from each checker to where it goes, on a board of `side`'s.
function arrowsHtml(board, side, moves, id) {
  const counts = board.map(half => [...half]);
  let html = '';
  for (const [from, to] of moves) {
    const start = placeOf(side, from, counts[side][from] - 1);
    counts[side][from]--;
    const end = placeOf(side, to, counts[side][to]);
    counts[side][to]++;
    html += `<line x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}" marker-end="url(#${id})"/>`;
  }
  return `<defs><marker id="${id}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10z"/></marker></defs>${html}`;
}

// A hint's moves.
function hintsHtml(board) {
  if (!tip?.moves?.length || match.phase !== 'move') return '';
  return arrowsHtml(board, match.turn, tip.moves, 'arrow');
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
    // A Wi-Fi player whose phone is out of touch is dimmed; on a guest's
    // phone, the host when the link to it has gone.
    box.classList.toggle('away', wifiGame() && (Boolean(away[side]) || (side === 0 && linkDown())));
  });

  // The points are numbered for the side to act, as moves are written.
  for (const label of $('board').querySelectorAll('.labels text')) {
    label.textContent = fromView(now ?? match.turn, Number(label.dataset.n));
  }
  const svg = $('board').querySelector('svg');
  svg.querySelector('.pieces').innerHTML = piecesHtml(board);
  svg.querySelector('.marks').innerHTML = marksHtml();
  svg.querySelector('.landings').innerHTML = landingsHtml(board);
  svg.querySelector('.hints').innerHTML = hintsHtml(board);

  $('events').textContent = show?.hush ? '' : messages.join(' ');
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
  $('btn-hint').hidden = !hintsOn();
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
  if (wifiGame() && match.phase !== 'over') {
    const host = match.players[0].name;
    if (linkDown()) return [`Lost touch with ${host}'s phone. Trying again…`, true];
    if (sent) return ['Sent. Waiting for the host…', false];
    if (isHost() && !session.room) return session.trouble ? [`${session.trouble} Trying again…`, true] : ['Opening the game to the other phone…', false];
    if (notice) return [notice, true];
    const standing = standIn();
    if (standing !== null) return [`${nameOf(standing)}'s phone is out of touch. Wait for it, or press the button to let the computer choose for ${nameOf(standing)}.`, true];
    const waiting = actor();
    if (waiting !== null && waiting !== me) {
      if (away[waiting]) return [`${whose(waiting)} turn, but ${nameOf(waiting)}'s phone is out of touch.`, false];
      return [match.phase === 'doubled' ? `${nameOf(waiting)} is thinking about your double…` : `${whose(waiting)} turn.`, false];
    }
  }
  const side = actor();
  if (side === null) return ['', false];
  const people = match.mode === 'local';
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

// On the host's phone the main button also acts for the other phone while
// it is out of touch: the computer's choice, after asking.
function mainButton(acting) {
  const standing = acting ? null : standIn();
  const forWhom = standing !== null ? ` for ${nameOf(standing)}` : '';
  if (match.phase === 'roll') return forWhom ? [`Roll${forWhom}`, true] : ['Roll', acting];
  if (match.phase === 'move') return forWhom ? [`Play${forWhom}`, true] : ['Done', acting && turnNow().done];
  if (match.phase === 'doubled') return forWhom ? [`Answer${forWhom}`, true] : ['Take', acting];
  if (match.phase === 'between') return ['Next game', !sent && !linkDown()];
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
  // Only the host of a Wi-Fi game can start the next match.
  const again = isGuest()
    ? `<p class="muted">Waiting for ${escapeHtml(match.players[0].name)} to start another match.</p>`
    : '<button class="btn primary" data-do="again">Play again</button>';
  const actions = over
    ? `${again}<div class="row"><button class="btn" data-do="stats">Statistics</button><button class="btn" data-do="menu">Menu</button></div>`
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
  show = { board: before.board, dice: before.dice, cube: null, prompt: '', steps, timer: 0 };
  nextStep();
}

function nextStep() {
  if (!show) return;
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

// Takes any dice in the air off the board.
const clearThrow = () => $('board').querySelector('.dice-air')?.replaceChildren();

// Also called early, when a tap or key skips the animation.
function endShow() {
  if (!show) return;
  clearTimeout(show.timer);
  clearThrow();
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

// Dice thrown onto the board, then lying where they came to rest: `rolled` are
// [{ side, value }], four of one value for a double, of which two are thrown
// and two appear once those have landed. `keep` marks the dice of the roll to
// be played, which stay as they lie for the turn.
function rollSteps(rolled, hold, keep = false) {
  let dice = [];
  return [
    {
      change() {
        dice = [0, 1].flatMap(side => {
          const mine = rolled.filter(die => die.side === side);
          return mine.length ? planThrow(side === bottom(), mine.length).map((plan, i) => ({ ...plan, ...mine[i] })) : [];
        });
        if (keep) lying = { key: rollKey(), dice };
        show.dice = [];
        show.prompt = '';
        show.hush = true; // the words wait for the dice
      },
      animate() {
        playSound('shake');
        playSound('roll', FIRST_BOUNCE_MS / 1000);
        throwDice($('board').querySelector('.dice-air'), dice.filter(die => die.from));
      },
      wait: THROW_TOTAL_MS,
    },
    {
      change() {
        clearThrow();
        show.dice = dice.map(die => ({ side: die.side, value: die.value, rest: die, extra: !die.from }));
        show.hush = false;
      },
      wait: hold,
    },
  ];
}

// The checkers set out for a new game, flying from their trays one after another.
function setupStep() {
  return {
    change() {
      show.board = startBoard();
      show.dice = [];
      show.cube = { place: 'centre', value: 1 };
      show.prompt = 'Setting out the checkers…';
      show.hush = true;
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
      steps.push(...rollSteps([{ side: 0, value: a }, { side: 1, value: b }], OPENING_HOLD_MS));
    } else if (event.type === 'start') {
      const [a, b] = event.dice;
      steps.push({ change: () => (show.dice = [{ side: event.side, value: a }, { side: event.side, value: b }]), wait: 200 });
    } else if (event.type === 'roll') {
      const [a, b] = event.dice;
      const values = a === b ? [a, a, a, a] : [a, b];
      steps.push(...rollSteps(values.map(value => ({ side: event.side, value })), a === b ? EXTRA_DICE_MS : 0, true));
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
      const second = isYou(1) ? 'you' : isAi(1) ? 'the computer' : nameOf(1);
      said.push(a === b ? `Both roll ${a}.` : `${does(0, 'roll')} ${a} and ${second} ${b}.`);
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

// What the match looked like before a change. The dice stay on the board
// while the checkers they moved are shown moving.
const snapshot = () => ({ board: match.board.map(half => [...half]), dice: diceNow(), phase: match.phase, turn: match.turn, gameNo: match.gameNo, actor: actor() });

// Runs one action on the match, then shows what it did. `own` is a turn
// whose checkers were moved here, which need not be shown again.
function commit(action, own = false) {
  const before = snapshot();
  action();
  settle(before, own);
}

// Everything that follows a change to the match, made here or, on a guest's
// phone in a Wi-Fi game, by the host: what it says, saving, statistics,
// sending it to the other phone, then the animation, and after it the
// sounds, the celebration and the computer's next move. While the host looks
// at the menu its game goes on unseen.
function settle(before, own = false) {
  input?.cancel();
  made = [];
  picked = null;
  cursor = null;
  tip = null;
  notice = '';
  messages = describe(match.events, before);
  if (!isGuest()) store(GAME_KEY, match.phase === 'over' ? null : match);
  if (match.phase === 'over') record();
  if (isHost()) session.host.share(match);
  if (wifiGame() && !$('table').hidden) alertTurn(before);
  const steps = $('table').hidden || reducedMotion() ? [] : stepsFor(match.events, own);
  if (steps.length) {
    runShow(steps, before);
    return;
  }
  if (!$('table').hidden) soundEvents(match.events);
  finish();
}

// After a change has been shown: the end of the match, the board as it now
// is, anything that arrived meanwhile, and the computer's next move.
function finish() {
  if (match.phase === 'over' && !$('table').hidden) playSound(personWon() ? 'win' : 'lose', 0.2);
  celebrate();
  render();
  drainInbox();
  scheduleAi();
}

// A finished match counts once in this phone's statistics, though the last
// state of a Wi-Fi match can reach a phone more than once.
function record() {
  if (wifiGame()) {
    if (load(RECORDED_KEY) === match.id) return;
    store(RECORDED_KEY, match.id);
  }
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
  if (!match || show || isGuest() || $('table').hidden) return;
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

// A move by the person who must act here: run here, or on a guest's phone in
// a Wi-Fi game sent to the host, whose answer comes back as the next state or
// as a refusal. The checkers a guest moved stay where they are meanwhile.
function act(move) {
  if (isGuest()) {
    notice = '';
    sent = session.guest.send(move);
    render();
    return;
  }
  const side = actor();
  commit(() => apply(side, move), move.t === 'play');
}

// A move made by `side`, from this phone or (on the host's) the other. `next`
// starts the next game only from the game the phone was looking at.
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
    if (!sent && !linkDown()) act({ t: 'next', game: match.gameNo });
    return;
  }
  if (!canAct()) {
    const side = standIn();
    if (side !== null) playFor(side);
    return;
  }
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
  if (!hintsOn() || !canAct()) return;
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

// On the host's phone, the main button also acts for the other phone while
// it is out of touch: it rolls, or plays or answers a double as Hard would,
// after asking. It never doubles for them.
function playFor(side) {
  const name = nameOf(side);
  const verb = match.phase === 'roll' ? 'Roll' : match.phase === 'move' ? 'Play' : 'Answer';
  confirmFirst(`${verb} for ${name}?`, `${name}'s phone is out of touch. The computer makes its best choice for ${name}.`, verb, () => {
    if (standIn() !== side) return;
    commit(() => {
      if (match.phase === 'roll') roll(match, side);
      else if (match.phase === 'move') play(match, side, pickTurn(match, side, 'hard').moves);
      else (shouldTake(match, side, 'hard') ? take : pass)(match, side);
    });
  });
}

// ---- Wi-Fi games ------------------------------------------------------------

// Each person plays on their own phone. The host's phone keeps the real
// match and runs every move; the other sends its moves and gets the match back
// after each one (wifi.js), over a direct link between the phones (net.js).

// Moves and states that arrive during an animation wait until it is over.
function whenIdle(task) {
  if (show) inbox.push(task);
  else task();
}

function drainInbox() {
  while (inbox.length && !show) inbox.shift()();
}

// This phone's turn: a chime, and a buzz where the phone can.
function alertTurn(before) {
  if (actor() !== me || before.actor === me) return;
  playSound('turn', 0.2);
  try {
    navigator.vibrate?.(120);
  } catch {
    // no buzz, then
  }
}

// The screen stays on while this phone is in a Wi-Fi game, as a phone that
// sleeps drops out. The browser lets the lock go whenever the page is
// hidden, so it is asked for again each time the page comes back.
let wakeLock = null;
let askingLock = false;
async function keepAwake(on) {
  if (!on) {
    const lock = wakeLock;
    wakeLock = null;
    lock?.release().catch(() => {});
    return;
  }
  if (wakeLock || askingLock || document.visibilityState !== 'visible' || !navigator.wakeLock) return;
  askingLock = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (session) {
      wakeLock = lock;
      lock.addEventListener('release', () => {
        if (wakeLock === lock) wakeLock = null;
      });
    } else lock.release().catch(() => {});
  } catch {
    // Refused (on low battery, say): the game goes on without it.
  }
  askingLock = false;
}

document.addEventListener('visibilitychange', () => keepAwake(Boolean(session)));

// Hosting and joining need a name, which the other phone sees.
function needName() {
  $('wifi-name').classList.add('want');
  $('wifi-name').focus();
}

// The host knows this tab again by its token, which lasts as long as the tab.
function wifiToken() {
  let token = load(TOKEN_KEY, true);
  if (typeof token !== 'string' || !token) {
    token = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    store(TOKEN_KEY, token, true);
  }
  return token;
}

// What this tab is doing in a Wi-Fi game, so that a reload goes back to it.
function storeWifi() {
  store(WIFI_KEY, session ? { role: session.role, code: session.code } : null, true);
}

// Ends this phone's part in the Wi-Fi game. The host's ends it for both; a
// guest gives up its seat, which the host keeps in case it comes back.
function endWifi() {
  if (!session) return;
  const ending = session;
  session = null;
  storeWifi();
  if (ending.role === 'host') {
    // The room outlasts the goodbye a moment: closing it hangs up at once.
    ending.host.close('ended');
    setTimeout(() => ending.room?.close(), 1000);
  } else {
    ending.guest.leave();
    if (wifiGame()) match = null;
  }
  away = [];
  sent = false;
  inbox = [];
  keepAwake(false);
}

// Runs `action` once this phone has left its Wi-Fi game, asking first while
// that game is being played.
function leaving(action) {
  const playing = liveWifi() && match.phase !== 'over';
  if (!playing) {
    endWifi();
    action();
    return;
  }
  const hosting = session.role === 'host';
  confirmFirst(
    hosting ? 'End the Wi-Fi game?' : 'Leave the Wi-Fi game?',
    hosting ? 'The other phone will be told that it has ended.' : 'Your seat is kept: join again with the same name to take it back.',
    hosting ? 'End it' : 'Leave',
    () => {
      endWifi();
      action();
    },
  );
}

// Host a game: a room under a new code, and the box that shows the code and
// who has joined, where Start begins the match.
function hostGame() {
  const name = cleanName(settings.wifiName);
  if (!name) {
    needName();
    return;
  }
  leaving(() => {
    const host = createHost({ name, version: VERSION, onmove: hostMove, onchange: hostChanged });
    session = { role: 'host', host, room: null, code: '', trouble: '' };
    keepAwake(true);
    showWifi('host');
    reopen(session);
  });
}

// Opens the room for `attempt`, a host's session: under its code when it has
// one (a saved match), otherwise a new one. During a match a failure is tried
// again; in the box, Try again does that.
async function reopen(attempt) {
  try {
    const room = await openRoom({ code: attempt.code || null, onlink: link => attempt.host.attach(link) });
    if (session !== attempt) {
      room.close();
      return;
    }
    Object.assign(attempt, { room, code: room.code, trouble: '' });
    if (wifiGame() && match.net) match.net.code = room.code;
    storeWifi();
  } catch (error) {
    if (session !== attempt) return;
    attempt.trouble = error.message;
    if (wifiGame() && attempt.host.started) setTimeout(() => session === attempt && reopen(attempt), 5000);
  }
  drawWifi();
  if (match && !$('table').hidden) render();
}

// A Wi-Fi match saved on the host's phone: its code is opened again, and the
// other phone, which keeps trying, comes back by itself.
function resumeHosting(saved) {
  const seats = saved.net?.seats ?? saved.players.map(player => ({ name: player.name, token: null }));
  const host = createHost({ name: saved.players[0].name, version: VERSION, seats, onmove: hostMove, onchange: hostChanged });
  session = { role: 'host', host, room: null, code: saved.net?.code ?? '', trouble: '' };
  me = 0;
  away = host.away();
  start(saved);
  storeWifi();
  reopen(session);
}

// The other phone joined, came back or dropped out. The lobby shows it; in a
// match, it is sent the match again, and its score dims or lights up.
function hostChanged() {
  if (session?.role !== 'host') return;
  if (wifiGame() && session.host.started) {
    away = session.host.away();
    match.net = { code: session.code, seats: session.host.saved() };
    if (match.phase !== 'over') store(GAME_KEY, match);
    session.host.share(match);
    if (!$('table').hidden) render();
  }
  drawWifi();
}

// A guest's move, run here as the host's own are, after any animation that
// is under way. A press of Next game from a phone a game behind is let go.
function hostMove(seat, move) {
  if (!isHost() || !session.host.started) return;
  const attempt = session;
  whenIdle(() => {
    if (session !== attempt || !wifiGame()) return;
    if (move.t === 'next' && (match.phase !== 'between' || move.game !== match.gameNo)) return;
    const before = snapshot();
    try {
      apply(seat, move);
    } catch (error) {
      session.host.refuse(seat, error.message);
      return;
    }
    settle(before);
  });
}

// Start, in the host's box: a match with the host's length, cube and hints.
function startWifiGame() {
  if (session?.role !== 'host' || !session.room || session.host.players().length < 2) return;
  const players = session.host.begin();
  const next = newMatch({ mode: 'net', target: settings.target, cube: settings.cube, players });
  next.rules = { hints: settings.hints };
  next.net = { code: session.code, seats: session.host.saved() };
  me = 0;
  away = session.host.away();
  hideWifi();
  start(next, true);
}

// Play again, on the host's phone: back to the lobby, which someone else may
// join if the other phone has gone.
function hostAgain() {
  session.host.reopen();
  showWifi('host');
}

// Join a game: the box asks for the code. A shared link brings its code,
// and then joins straight away.
function openJoin(code = '') {
  if (!cleanName(settings.wifiName)) {
    waitingCode = code;
    needName();
    return;
  }
  waitingCode = '';
  leaving(() => {
    showWifi('join');
    $('join-code').value = cleanCode(code);
    if (code) joinGame();
  });
}

async function joinGame() {
  if (session) return;
  const code = cleanCode($('join-code').value);
  if (code.length !== CODE_LENGTH) {
    wifiStatus(`A code has ${CODE_LENGTH} letters.`, true);
    return;
  }
  const guest = createGuest({
    name: cleanName(settings.wifiName),
    token: wifiToken(),
    version: VERSION,
    connect: () => joinRoom(code),
    onmessage: guestHeard,
    onlink: guestLink,
  });
  const attempt = { role: 'guest', guest, code, players: null };
  session = attempt;
  keepAwake(true);
  wifiStatus('');
  try {
    await guest.join();
  } catch (error) {
    if (session !== attempt) return;
    session = null;
    storeWifi(); // a reload no longer tries this game
    keepAwake(false);
    wifiStatus(error.message, true);
    return;
  }
  if (session === attempt) storeWifi();
}

// What the host sends a guest.
function guestHeard(message) {
  if (session?.role !== 'guest') return;
  if (message.t === 'lobby') {
    session.players = message.players;
    // After a match, its results stay on screen until the host starts the next.
    if (wifiGame()) return;
    me = message.seat;
    if (!wifiBox) showWifi('join');
    drawWifi();
  } else if (message.t === 'state') {
    const attempt = session;
    session.players = message.game.players.map((player, seat) => ({ name: player.name, here: !message.away[seat] }));
    whenIdle(() => session === attempt && guestState(message));
  } else if (message.t === 'refused') {
    sent = false;
    notice = message.message;
    if (match && !$('table').hidden) render();
  } else {
    // The host ended the game, or would not take this phone back.
    const host = session.players?.[0]?.name ?? 'The host';
    endWifi();
    showMenu();
    showWifi('ended', message.t === 'closed' ? `${host} ended the game.` : deniedText(message, VERSION));
  }
}

// The match as the host sends it. A new one starts here, with its checkers
// set out; the one already here moves on as if the move were made on this
// phone, without showing again checkers this phone moved itself; one this
// phone has already only says who is there.
function guestState({ seat, game: next, away: gone }) {
  me = seat;
  away = gone;
  if (!wifiGame() || match.id !== next.id) {
    hideWifi();
    start(next, next.events.some(event => event.type === 'start'));
    return;
  }
  if (sameState(match, next)) {
    if (!$('table').hidden) render();
    return;
  }
  const before = snapshot();
  const own = next.events.some(event => event.type === 'move' && event.side === me);
  match = next;
  sent = false;
  settle(before, own);
}

// The link to the host went, or came back. A move sent just before it went
// may never be answered: the next state will tell.
function guestLink(up) {
  if (!up) sent = false;
  if (match && !$('table').hidden) render();
  drawWifi();
}

// Resume on the menu: back to the Wi-Fi game this phone is in, or else the
// saved match, which for a Wi-Fi game's host opens its code again.
function resume() {
  if (liveWifi()) {
    $('menu').hidden = true;
    $('table').hidden = false;
    render();
    keepAwake(true);
    return;
  }
  const saved = load(GAME_KEY);
  if (saved?.v !== 1) return;
  if (saved.mode === 'net') resumeHosting(saved);
  else start(saved);
}

// The address that opens this game's Join box, sent with the phone's own
// Share sheet, or else copied.
async function shareLink() {
  if (session?.role !== 'host' || !session.code) return;
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('join', session.code);
  const net = new URLSearchParams(location.search).get('net');
  if (net) url.searchParams.set('net', net);
  try {
    if (navigator.share) await navigator.share({ title: 'Backgammon', text: `Join my backgammon game: the code is ${session.code}.`, url: url.href });
    else {
      await navigator.clipboard.writeText(url.href);
      wifiStatus('Link copied. Paste it into a message to the other player.');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') wifiStatus(url.href);
  }
}

// The Wi-Fi box: the host's code and lobby, a guest's join and wait, or why
// a Wi-Fi game ended.
function showWifi(kind, text = '') {
  wifiBox = kind;
  wifiNote = { text, warn: kind === 'ended' };
  $('wifi').hidden = false;
  drawWifi();
  if (kind === 'join' && !session && matchMedia('(pointer: fine)').matches) $('join-code').focus();
}

function hideWifi() {
  wifiBox = null;
  $('wifi').hidden = true;
}

function wifiStatus(text, warn = false) {
  wifiNote = { text, warn };
  drawWifi();
}

// Cancel (or Leave) gives up the lobby and goes to the menu; after a Wi-Fi
// game has ended, OK goes there too.
function cancelWifi() {
  const ended = wifiBox === 'ended';
  hideWifi();
  if (!ended) endWifi();
  showMenu();
}

function drawWifi() {
  if (!wifiBox) return;
  const hosting = wifiBox === 'host' && session?.role === 'host';
  const guest = wifiBox === 'join' && session?.role === 'guest' ? session.guest : null;
  const players = hosting ? session.host.players() : guest ? session.players : null;
  const owner = players?.[0]?.name ?? 'the host';
  let title = 'Wi-Fi game';
  let text = '';
  let { text: status, warn } = wifiNote;
  let goLabel = null;
  let cancel = 'Cancel';
  let listed = false;
  if (wifiBox === 'ended') {
    goLabel = 'OK';
    cancel = null;
  } else if (wifiBox === 'host') {
    title = 'Host a game';
    if (hosting && session.room) {
      text = 'On the other phone, choose Wi-Fi, tap Join a game and enter:';
      listed = true;
      goLabel = 'Start';
      if (!status) status = players.length < MAX_PLAYERS ? 'Waiting for the other player to join…' : 'Both here: start when you are ready.';
    } else if (hosting && session.trouble) {
      [status, warn] = [session.trouble, true];
      goLabel = 'Try again';
    } else if (hosting) text = 'Opening a game…';
  } else {
    title = 'Join a game';
    if (!guest) {
      text = "Enter the code on the host's screen.";
      goLabel = 'Join';
    } else if (guest.connected && players) {
      text = `You are in ${owner}'s game.`;
      listed = true;
      cancel = 'Leave';
      if (!status) status = `Waiting for ${owner} to start…`;
    } else if (players) {
      text = `Lost touch with ${owner}'s phone. Trying again…`;
      listed = true;
      cancel = 'Leave';
    } else text = `Connecting to game ${session.code}…`;
  }
  $('wifi-title').textContent = title;
  $('wifi-text').textContent = text;
  $('wifi-text').hidden = !text;
  const code = hosting && session.room ? session.code : '';
  $('wifi-code').hidden = !code;
  $('wifi-code').innerHTML = [...code].map(letter => `<span>${letter}</span>`).join('');
  $('wifi-code').setAttribute('aria-label', `Code ${[...code].join(' ')}`);
  $('btn-share').hidden = !code;
  $('join-code').hidden = !(wifiBox === 'join' && !guest);
  $('wifi-players').hidden = !listed;
  const mine = hosting ? 0 : me;
  const entry = (player, seat) =>
    `<li${player.here ? '' : ' class="away"'}><i class="side${seat}"></i><span>${escapeHtml(player.name)}${seat === mine ? ' <span class="muted">(you)</span>' : ''}</span></li>`;
  $('wifi-players').innerHTML = listed ? players.map(entry).join('') : '';
  $('wifi-status').textContent = status;
  $('wifi-status').classList.toggle('warn', warn);
  $('btn-wifi-go').hidden = !goLabel;
  $('btn-wifi-go').textContent = goLabel ?? '';
  $('btn-wifi-go').disabled = goLabel === 'Start' && (players?.length ?? 0) < MAX_PLAYERS;
  $('btn-wifi-cancel').hidden = !cancel;
  $('btn-wifi-cancel').textContent = cancel ?? '';
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

// A Wi-Fi game goes on while its host looks at the menu: the other phone's
// moves keep coming. Anything being shown is cut short.
function showMenu() {
  clearTimeout(aiTimer);
  if (show) {
    clearTimeout(show.timer);
    clearThrow();
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
  $('row-wifi-name').hidden = mode !== 'net';
  $('row-wifi').hidden = mode !== 'net';
  $('btn-new').hidden = mode === 'net';
  $('row-cube').hidden = settings.target === 1;
  for (const field of document.querySelectorAll('[data-name]')) field.value = settings.names[Number(field.dataset.name)];
  $('wifi-name').value = settings.wifiName;

  // Resume goes back to a Wi-Fi game this phone is in, or else to the saved match.
  const saved = liveWifi() ? null : load(GAME_KEY);
  const canResume = liveWifi() ? match.phase !== 'over' : saved?.v === 1 && saved.phase !== 'over' && Array.isArray(saved.board);
  $('btn-resume').hidden = !canResume;
  if (liveWifi()) $('btn-resume').textContent = `Back to the Wi-Fi game (${match.score.join('–')})`;
  else if (canResume) $('btn-resume').textContent = `Resume ${saved.mode === 'net' ? 'Wi-Fi game' : 'match'} (${saved.score.join('–')}, to ${saved.target})`;
  for (const id of ['btn-new', 'btn-host', 'btn-join']) $(id).classList.toggle('primary', !canResume);

  for (const id of ['table', 'gameover', 'confirm']) $(id).hidden = true;
  $('menu').hidden = false;
  drainInbox();
}

// `fresh` is a match just begun, whose checkers are set out and opening roll shown.
function start(saved = null, fresh = !saved) {
  stopParty();
  clearTimeout(aiTimer);
  match = saved ?? newMatch({ mode: settings.mode, difficulty: settings.difficulty, target: settings.target, cube: settings.cube, players: playersFor() });
  if (!wifiGame()) {
    me = 0;
    away = [];
  }
  made = [];
  picked = null;
  cursor = null;
  tip = null;
  messages = [];
  notice = '';
  sent = false;
  inbox = [];
  turns = null;
  show = null;
  drawBoard();
  $('menu').hidden = true;
  $('table').hidden = false;
  keepAwake(Boolean(session));
  if (fresh) {
    settle({ ...snapshot(), actor: null }); // a new match: whoever starts is told it is their turn
    return;
  }
  if (!isGuest()) store(GAME_KEY, match);
  if (isHost()) session.host.share(match);
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

// ---- Opening moves, in How to play ----------------------------------------

const OPENING_ROLLS = OPENING_GROUPS.flatMap(group => group.rolls.map(roll => ({ ...roll, group })));
let studied = OPENING_ROLLS[0]; // the roll on show
let studiedPlay = studied.best; // and which of its plays

const rollName = ({ dice }) => dice.join('-');

function drawRollGroups() {
  const icon = value => `<svg viewBox="-12 -12 24 24" aria-hidden="true">${dieFace(value)}</svg>`;
  const chip = roll => `<button class="roll-chip" data-roll="${rollName(roll)}" aria-label="${rollName(roll)}">${roll.dice.map(icon).join('')}</button>`;
  $('roll-groups').innerHTML = OPENING_GROUPS.map(group => `<section><h3>${group.title}</h3><div class="roll-chips">${group.rolls.map(chip).join('')}</div></section>`).join('');
}

function studyRoll(roll) {
  studied = roll;
  studiedPlay = roll.best;
  drawStudy();
}

// The start of a game with the chosen play as arrows, and what it does. Your
// side is at the bottom, as at the table.
function drawStudy() {
  const side = bottom();
  const board = startBoard();
  let checkers = '';
  for (const owner of [0, 1]) {
    for (let p = 1; p <= 24; p++) {
      for (let k = 0; k < board[owner][p]; k++) checkers += checkerHtml(owner, 'study', k, checkerXY(view(owner, p), k), 0, '');
    }
  }
  const arrows = arrowsHtml(board, side, parsePlay(studiedPlay), 'study-arrow');
  const stepper = (step, label, mark) => `<button class="icon-btn" data-step="${step}" aria-label="${label}">${mark}</button>`;
  $('study-board').innerHTML =
    `<div class="study-nav">${stepper(-1, 'Previous roll', '‹')}<p><b>${rollName(studied)}</b><small>${studied.group.title}</small></p>${stepper(1, 'Next roll', '›')}</div>` +
    `<div class="study-board">${boardHtml(`<g>${checkers}</g><g class="hints">${arrows}</g>`)}</div>`;
  const playChip = play => `<button class="play-chip" data-play="${play}" aria-pressed="${play === studiedPlay}">${play}</button>`;
  $('study').innerHTML =
    `<p class="study-plays">${playChip(studied.best)}${studied.also.length ? ` <span class="muted">Also good:</span> ${studied.also.map(playChip).join(' ')}` : ''}</p>` +
    `<p>${studied.why}</p><p class="muted">${studied.group.idea}</p>`;
  for (const chip of $('roll-groups').querySelectorAll('[data-roll]')) chip.setAttribute('aria-pressed', chip.dataset.roll === rollName(studied));
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

$('wifi-name').addEventListener('input', event => {
  event.target.classList.remove('want');
  settings.wifiName = event.target.value.slice(0, NAME_LENGTH);
  store(SETTINGS_KEY, settings);
});

$('btn-new').addEventListener('click', () => leaving(() => start()));
$('btn-resume').addEventListener('click', resume);
$('btn-host').addEventListener('click', hostGame);
$('btn-join').addEventListener('click', () => openJoin(waitingCode));
$('btn-share').addEventListener('click', shareLink);
$('btn-wifi-cancel').addEventListener('click', cancelWifi);
$('btn-wifi-go').addEventListener('click', () => {
  if (wifiBox === 'ended') cancelWifi();
  else if (wifiBox === 'join') joinGame();
  else if (session?.role === 'host' && !session.room) {
    session.trouble = '';
    drawWifi();
    reopen(session);
  } else startWifiGame();
});
$('join-code').addEventListener('input', event => {
  event.target.value = cleanCode(event.target.value);
  if (wifiNote.warn) wifiStatus('');
});
$('join-code').addEventListener('keydown', event => {
  if (event.key === 'Enter') joinGame();
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
drawRollGroups();
$('guide-tabs').addEventListener('click', event => {
  const tab = event.target.closest('[data-tab]');
  if (!tab) return;
  for (const button of $('guide-tabs').children) {
    button.setAttribute('aria-pressed', button === tab);
    $(button.dataset.tab).hidden = button !== tab;
  }
  const openings = tab.dataset.tab === 'guide-openings';
  $('guide-tabs').parentElement.classList.toggle('studying', openings);
  $('rules').scrollTop = 0;
  if (openings) drawStudy();
});
$('study-board').addEventListener('click', event => {
  const step = event.target.closest('[data-step]');
  if (!step) return;
  const count = OPENING_ROLLS.length;
  studyRoll(OPENING_ROLLS[(OPENING_ROLLS.indexOf(studied) + Number(step.dataset.step) + count) % count]);
});
// The list of rolls lies below what it shows, so a roll chosen there comes up
// into view.
$('roll-groups').addEventListener('click', event => {
  const chip = event.target.closest('[data-roll]');
  if (!chip) return;
  studyRoll(OPENING_ROLLS.find(roll => rollName(roll) === chip.dataset.roll));
  $('rules').scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
});
$('study').addEventListener('click', event => {
  const chip = event.target.closest('[data-play]');
  if (!chip) return;
  studiedPlay = chip.dataset.play;
  drawStudy();
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
  if (action === 'again') {
    if (isHost()) hostAgain();
    else playAgain();
  } else if (action === 'next') onMain();
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
    if (!$('wifi').hidden) {
      cancelWifi();
      return;
    }
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

// A tab that was in a Wi-Fi game (reloaded, or brought back by the browser)
// goes straight back to it. A shared link opens the Join box with its code.
{
  const was = load(WIFI_KEY, true);
  const saved = load(GAME_KEY);
  const address = new URL(location.href);
  const code = cleanCode(address.searchParams.get('join') ?? '');
  if (address.searchParams.has('join')) {
    address.searchParams.delete('join');
    history.replaceState(null, '', address.href);
  }
  if (was?.role === 'host' && saved?.v === 1 && saved.mode === 'net' && saved.phase !== 'over') resumeHosting(saved);
  else if (was?.role === 'guest' && was.code) openJoin(was.code);
  else if (code) {
    settings.mode = 'net';
    store(SETTINGS_KEY, settings);
    showMenu();
    openJoin(code);
  }
}
