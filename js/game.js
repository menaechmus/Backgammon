// Rules of backgammon, played as a match to 1, 3, 5 or 7 points with the
// doubling cube. No DOM here: the match is one plain object that survives
// JSON.stringify, changed only through the exported actions. Each action
// leaves a list of what happened in match.events.
//
// Each side counts the points from its own end of the board: its point 1 is
// the last of its home board (points 1 to 6), and its point 24 is the farthest
// away, in the other side's home board. So board[side][p] is how many of that
// side's checkers stand on its point p, with 25 for the bar and 0 for those
// borne off. The other side calls the same place 25 - p. Moves are [from, to]
// in the mover's own numbering, so the same code serves both sides.

export const CHECKERS = 15;
export const BAR = 25;
export const OFF = 0;
export const MAX_CUBE = 64;
export const TARGETS = [1, 3, 5, 7];

const START = { 24: 2, 13: 5, 8: 3, 6: 5 };
const VALUES = { single: 1, gammon: 2, backgammon: 3 };

function check(ok, message) {
  if (!ok) throw new Error(message);
}

export const other = side => 1 - side;

export function startBoard() {
  const half = () => {
    const points = new Array(26).fill(0);
    for (const [point, count] of Object.entries(START)) points[point] = count;
    return points;
  };
  return [half(), half()];
}

export const copyBoard = board => [board[0].slice(), board[1].slice()];

// A short string that tells one position from another, for sets and maps.
export const keyOf = board => String.fromCharCode(...board[0], ...board[1]);

// One die, from the browser's secure random numbers, which are as good in one
// browser as in another. A byte of 252 or more is drawn again: 252 is the
// largest multiple of six a byte can hold, so all six numbers get exactly the
// same share. Tests and the dev tools pass a `random` of their own, to choose
// the numbers or to repeat a run.
const secureByte = new Uint8Array(1);

export function rollDie(random = null) {
  if (random) return 1 + Math.floor(random() * 6);
  do crypto.getRandomValues(secureByte);
  while (secureByte[0] >= 252);
  return 1 + (secureByte[0] % 6);
}

// The dice to be played: two, or four of a double.
export const diceList = ([a, b]) => (a === b ? [a, a, a, a] : [a, b]);

// How far a side still has to go: the sum of every checker's distance from
// being borne off, a checker on the bar counting 25.
export function pipCount(board, side) {
  let pips = 0;
  for (let p = 1; p <= BAR; p++) pips += p * board[side][p];
  return pips;
}

// Once no checker of either side has another still to pass, the game is a
// race and nobody can hit again.
export function isRace(board) {
  let back0 = 0;
  let back1 = 0;
  for (let p = BAR; p >= 1 && !back0; p--) if (board[0][p]) back0 = p;
  for (let p = BAR; p >= 1 && !back1; p--) if (board[1][p]) back1 = p;
  return back0 + back1 < BAR;
}

// Where a checker of `side` moved from `from` with `die` would land: a point,
// or OFF, or -1 when that move is not allowed. A checker on the bar must come
// in first; a point held by two or more of the other side's checkers is
// closed; and checkers are borne off only once all fifteen are home, with a
// die larger than needed only from the highest point still occupied.
export function landing(board, side, from, die) {
  const mine = board[side];
  if (!mine[from] || (mine[BAR] && from !== BAR)) return -1;
  const to = from - die;
  if (to >= 1) return board[other(side)][BAR - to] >= 2 ? -1 : to;
  for (let p = 7; p <= BAR; p++) if (mine[p]) return -1;
  if (to === 0) return OFF;
  for (let p = from + 1; p <= 6; p++) if (mine[p]) return -1;
  return OFF;
}

// Moves one checker, hitting a lone checker of the other side where it lands.
// Returns whether it hit.
function shift(board, side, from, to) {
  board[side][from]--;
  board[side][to]++;
  if (to === OFF) return false;
  const theirs = board[other(side)];
  if (theirs[BAR - to] !== 1) return false;
  theirs[BAR - to] = 0;
  theirs[BAR]++;
  return true;
}

// The board after `moves`, which are taken to be allowed.
export function applyMoves(board, side, moves) {
  const next = copyBoard(board);
  for (const [from, to] of moves) shift(next, side, from, to);
  return next;
}

// A turn in the usual notation, counting from the mover's side: "13/7 8/7",
// with "bar" and "off", a star for each hit, and a move made twice written
// once, as "8/5(2)".
export function moveText(board, side, moves) {
  const current = copyBoard(board);
  const counted = new Map();
  for (const [from, to] of moves) {
    const hit = shift(current, side, from, to);
    const text = `${from === BAR ? 'bar' : from}/${to === OFF ? 'off' : to}${hit ? '*' : ''}`;
    counted.set(text, (counted.get(text) ?? 0) + 1);
  }
  return [...counted].map(([text, times]) => (times > 1 ? `${text}(${times})` : text)).join(' ');
}

// Every way to play a roll, one for each different position it can leave:
// [{ moves: [[from, to], ...], board }]. A turn must use as many of the dice
// as can be used, and when only one of two different dice can be, the larger
// if that one can. A side that cannot move at all gets one turn with no moves.
// Doubles are searched from the farthest point inwards, which reaches every
// position without trying the same moves in every order.
export function legalTurns(board, side, dice) {
  const doubles = dice[0] === dice[1];
  const orders = doubles ? [diceList(dice)] : [dice, [dice[1], dice[0]]];
  const ends = [];
  for (const order of orders) {
    const walk = (current, used, moves, highest) => {
      let moved = false;
      if (used < order.length) {
        const die = order[used];
        for (let from = doubles ? highest : BAR; from >= 1; from--) {
          const to = landing(current, side, from, die);
          if (to < 0) continue;
          moved = true;
          const next = copyBoard(current);
          shift(next, side, from, to);
          walk(next, used + 1, [...moves, [from, to]], from);
        }
      }
      if (!moved) ends.push({ moves, board: current, first: order[0] });
    };
    walk(board, 0, [], BAR);
  }

  const most = Math.max(...ends.map(end => end.moves.length));
  let kept = ends.filter(end => end.moves.length === most);
  if (!doubles && most === 1) {
    const larger = Math.max(...dice);
    if (kept.some(end => end.first === larger)) kept = kept.filter(end => end.first === larger);
  }
  const turns = new Map();
  for (const { moves, board: result } of kept) {
    const key = keyOf(result);
    if (!turns.has(key)) turns.set(key, { moves, board: result });
  }
  return [...turns.values()];
}

const without = (list, item) => {
  const rest = [...list];
  rest.splice(rest.indexOf(item), 1);
  return rest;
};

// Whether the turn can be finished from `board`, with `left` dice still to
// play, in a position that `results` (the keys of legalTurns' boards) allows.
function finishes(board, side, left, results) {
  let moved = false;
  for (const die of new Set(left)) {
    for (let from = BAR; from >= 1; from--) {
      const to = landing(board, side, from, die);
      if (to < 0) continue;
      moved = true;
      const next = copyBoard(board);
      shift(next, side, from, to);
      if (finishes(next, side, without(left, die), results)) return true;
    }
  }
  return !moved && results.has(keyOf(board));
}

// Where a turn being made one checker at a time has got to: the board after
// `made` (moves of this turn so far, each { from, to, die }), the dice still
// to play, the single moves allowed next ([{ from, to, die }]) and whether
// the turn may end here. A move is allowed when the turn can still be
// finished from it as legalTurns() allows, so the checkers can be moved in
// any order. Bearing off takes the smallest die that will do.
export function turnState(board, side, dice, made = [], turns = legalTurns(board, side, dice)) {
  const results = new Set(turns.map(turn => keyOf(turn.board)));
  const current = copyBoard(board);
  let left = diceList(dice);
  for (const { from, to, die } of made) {
    shift(current, side, from, to);
    left = without(left, die);
  }
  const moves = [];
  for (const die of [...new Set(left)].sort((a, b) => a - b)) {
    for (let from = BAR; from >= 1; from--) {
      const to = landing(current, side, from, die);
      if (to < 0 || moves.some(move => move.from === from && move.to === to)) continue;
      const next = copyBoard(current);
      shift(next, side, from, to);
      if (finishes(next, side, without(left, die), results)) moves.push({ from, to, die });
    }
  }
  return { board: current, left, moves, done: results.has(keyOf(current)) };
}

// The die a move [from, to] uses, from `left`, or 0 when none will do.
function dieFor(board, side, from, to, left) {
  if (to !== OFF) return left.includes(from - to) && landing(board, side, from, from - to) === to ? from - to : 0;
  return [...left].sort((a, b) => a - b).find(die => landing(board, side, from, die) === OFF) ?? 0;
}

// ---- The match ----------------------------------------------------------

// Tells one match from the next, for the phones of a Wi-Fi game. Not drawn
// from Math.random, so a seeded test rolls as it always has.
let made = 0;
const newId = () => `${Date.now().toString(36)}${(made++).toString(36)}`;

const newTally = () => ({ games: 0, gammons: 0, backgammons: 0 });

const defaultPlayers = (mode, difficulty) =>
  mode === 'ai' ? [{ name: 'You' }, { name: 'Computer', ai: true, level: difficulty }] : [{ name: 'Player 1' }, { name: 'Player 2' }];

const seated = ({ name, ai = false, level }, difficulty) => ({ name, ai, ...(ai ? { level: level ?? difficulty } : {}) });

// `players` is two of { name, ai, level }; a computer plays at its own
// `level`, which against the computer is `difficulty`. `cube` says whether
// the doubling cube is used; a 1-point match never uses it.
export function newMatch({ mode = 'ai', difficulty = 'medium', target = 5, cube = true, players = defaultPlayers(mode, difficulty) } = {}, random = null) {
  check(TARGETS.includes(target), 'A match is to 1, 3, 5 or 7 points');
  check(players.length === 2, 'Backgammon is a game for two');
  const match = {
    v: 1,
    id: newId(),
    mode,
    difficulty,
    target,
    cubeOn: Boolean(cube),
    players: players.map(player => seated(player, difficulty)),
    score: [0, 0],
    winner: null, // the side that wins the match
    crawford: null, // 'now' during the Crawford game, 'done' after it
    gameNo: 0,
    tally: [newTally(), newTally()], // games won, and how
    highCube: 1, // the highest the cube stood at the end of a game
    events: [],
  };
  startGame(match, random);
  return match;
}

// Sets up the checkers and makes the opening roll: each side rolls one die,
// again after a tie, and the higher plays both. The events list every roll.
function startGame(match, random) {
  match.gameNo++;
  if (match.crawford === 'now') match.crawford = 'done';
  else if (match.crawford === null && match.target > 1 && match.score.some(score => score === match.target - 1)) match.crawford = 'now';
  Object.assign(match, { board: startBoard(), cube: { value: 1, owner: null }, result: null, phase: 'move' });
  let dice;
  do {
    dice = [rollDie(random), rollDie(random)];
    match.events.push({ type: 'opening', dice });
  } while (dice[0] === dice[1]);
  match.turn = dice[0] > dice[1] ? 0 : 1;
  match.dice = match.turn === 0 ? dice : [dice[1], dice[0]];
  match.events.push({ type: 'start', side: match.turn, dice: match.dice });
}

export function nextGame(match, random = null) {
  check(match.phase === 'between', 'The game is not over yet');
  match.events = [];
  startGame(match, random);
}

export function roll(match, side, random = null) {
  check(match.phase === 'roll' && match.turn === side, "Not this side's turn to roll");
  match.events = [];
  match.dice = [rollDie(random), rollDie(random)];
  match.phase = 'move';
  match.events.push({ type: 'roll', side, dice: match.dice });
}

// Plays a whole turn. `moves` are [from, to] in the order made; they are
// replayed one by one, each with a die of the roll, and must leave one of
// the positions that legalTurns() allows. An empty turn is for a side that
// cannot move.
export function play(match, side, moves) {
  check(match.phase === 'move' && match.turn === side, "Not this side's turn to move");
  check(Array.isArray(moves) && moves.length <= 4, 'A turn is a list of up to four moves');
  const turns = legalTurns(match.board, side, match.dice);
  const board = copyBoard(match.board);
  let left = diceList(match.dice);
  const hits = [];
  for (const move of moves) {
    check(Array.isArray(move) && move.length === 2 && move.every(Number.isInteger), 'A move is [from, to]');
    const [from, to] = move;
    const die = from >= 1 && from <= BAR && to >= OFF && to < from ? dieFor(board, side, from, to, left) : 0;
    check(die > 0, 'That checker cannot move there');
    left = without(left, die);
    hits.push(shift(board, side, from, to));
  }
  check(turns.some(turn => keyOf(turn.board) === keyOf(board)), 'That turn does not use the dice as it must');

  match.events = [];
  match.board = board;
  moves.forEach(([from, to], i) => match.events.push({ type: 'move', side, from, to, hit: hits[i] }));
  if (!moves.length) match.events.push({ type: 'blocked', side, dice: match.dice });
  if (board[side][OFF] === CHECKERS) {
    endGame(match, side, winKind(board, side), 'play');
    return;
  }
  match.turn = other(side);
  match.dice = [];
  match.phase = 'roll';
}

// A win is a gammon when the loser has borne off no checker, and a
// backgammon when the loser also still has one on the bar or in the
// winner's home board.
export function winKind(board, winner) {
  const loser = board[other(winner)];
  if (loser[OFF]) return 'single';
  for (let p = 19; p <= BAR; p++) if (loser[p]) return 'backgammon';
  return 'gammon';
}

// The cube is centred at the start of each game. Whoever it is centred for,
// or who owns it, may turn it before rolling, except in the Crawford game,
// in a 1-point match, or with the cube switched off.
export function canDouble(match, side) {
  const { cube } = match;
  return (
    match.cubeOn && match.target > 1 && match.crawford !== 'now' && match.phase === 'roll' && match.turn === side &&
    cube.value < MAX_CUBE && (cube.owner === null || cube.owner === side)
  );
}

export function double(match, side) {
  check(canDouble(match, side), 'Doubling is not allowed now');
  match.events = [];
  match.phase = 'doubled';
  match.events.push({ type: 'double', side, value: match.cube.value * 2 });
}

// Taking doubles the stakes and gives the taker the cube; the doubler then rolls.
export function take(match, side) {
  check(match.phase === 'doubled' && side === other(match.turn), 'There is no double to take');
  match.events = [];
  match.cube = { value: match.cube.value * 2, owner: side };
  match.phase = 'roll';
  match.events.push({ type: 'take', side, value: match.cube.value });
}

// Passing gives up the game at the stakes before the double.
export function pass(match, side) {
  check(match.phase === 'doubled' && side === other(match.turn), 'There is no double to pass');
  match.events = [];
  match.events.push({ type: 'pass', side });
  endGame(match, match.turn, 'single', 'pass');
}

function endGame(match, winner, kind, by) {
  const points = match.cube.value * VALUES[kind];
  match.score[winner] += points;
  const tally = match.tally[winner];
  tally.games++;
  if (kind === 'gammon') tally.gammons++;
  if (kind === 'backgammon') tally.backgammons++;
  match.highCube = Math.max(match.highCube, match.cube.value);
  match.result = { winner, kind, cube: match.cube.value, points, by };
  match.dice = [];
  match.events.push({ type: 'win', side: winner, kind, points, by });
  if (match.score[winner] >= match.target) {
    match.phase = 'over';
    match.winner = winner;
    match.events.push({ type: 'match', side: winner });
  } else {
    match.phase = 'between';
  }
}
