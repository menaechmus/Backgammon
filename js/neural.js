// The computer's judgement of a position: a small neural network that
// estimates how the game will end, seen from the side about to roll. It
// taught itself by playing against itself (in the dev tools), and its
// weights are in weights.js. No DOM here.
//
// The inputs follow Tesauro's TD-Gammon. For every point and each side, four
// numbers say how many checkers stand there: one or more, two or more, three
// or more, and half of any beyond three. Then come each side's checkers on
// the bar and borne off, and both pip counts. The five outputs are the
// chances that the side to roll wins, wins a gammon, wins a backgammon,
// loses a gammon and loses a backgammon.

export const INPUTS = 198;
export const OUTPUTS = 5;
export const WIN = 0;
export const WIN_GAMMON = 1;
export const WIN_BACKGAMMON = 2;
export const LOSE_GAMMON = 3;
export const LOSE_BACKGAMMON = 4;

function count(x, at, n) {
  x[at] = n > 0 ? 1 : 0;
  x[at + 1] = n > 1 ? 1 : 0;
  x[at + 2] = n > 2 ? 1 : 0;
  x[at + 3] = n > 3 ? (n - 3) / 2 : 0;
}

// The network's inputs for `board`, with `side` to roll.
export function encode(board, side, x = new Float32Array(INPUTS)) {
  const mine = board[side];
  const theirs = board[1 - side];
  let myPips = 25 * mine[25];
  let theirPips = 25 * theirs[25];
  for (let p = 1; p <= 24; p++) {
    count(x, (p - 1) * 8, mine[p]);
    count(x, (p - 1) * 8 + 4, theirs[25 - p]);
    myPips += p * mine[p];
    theirPips += p * theirs[p];
  }
  x[192] = mine[25] / 2;
  x[193] = theirs[25] / 2;
  x[194] = mine[0] / 15;
  x[195] = theirs[0] / 15;
  x[196] = myPips / 200;
  x[197] = theirPips / 200;
  return x;
}

export const sigmoid = z => 1 / (1 + Math.exp(-z));

// A network is { hidden, w1, b1, w2, b2 }: w1 holds the weights from each
// input to every hidden unit, input by input, and w2 those from each hidden
// unit to the five outputs. Inputs are mostly zero, so only the others are
// added up.
const scratch = new Float32Array(INPUTS);
let units = new Float64Array(0);

export function evaluate(net, board, side, out = new Float64Array(OUTPUTS)) {
  const { hidden, w1, b1, w2, b2 } = net;
  if (units.length !== hidden) units = new Float64Array(hidden);
  const x = encode(board, side, scratch);
  units.set(b1);
  for (let i = 0; i < INPUTS; i++) {
    const v = x[i];
    if (v === 0) continue;
    const row = i * hidden;
    for (let j = 0; j < hidden; j++) units[j] += v * w1[row + j];
  }
  for (let j = 0; j < hidden; j++) units[j] = sigmoid(units[j]);
  for (let k = 0; k < OUTPUTS; k++) {
    let sum = b2[k];
    for (let j = 0; j < hidden; j++) sum += units[j] * w2[j * OUTPUTS + k];
    out[k] = sigmoid(sum);
  }
  return tidy(out);
}

// The chances made to agree with each other: a gammon is also a win, and a
// backgammon also a gammon.
export function tidy(p) {
  p[WIN_GAMMON] = Math.min(p[WIN_GAMMON], p[WIN]);
  p[WIN_BACKGAMMON] = Math.min(p[WIN_BACKGAMMON], p[WIN_GAMMON]);
  p[LOSE_GAMMON] = Math.min(p[LOSE_GAMMON], 1 - p[WIN]);
  p[LOSE_BACKGAMMON] = Math.min(p[LOSE_BACKGAMMON], p[LOSE_GAMMON]);
  return p;
}

// The same chances seen by the other side.
export const flip = p => Float64Array.of(1 - p[WIN], p[LOSE_GAMMON], p[LOSE_BACKGAMMON], p[WIN_GAMMON], p[WIN_BACKGAMMON]);

// What a position is worth in points for one game at stakes of one, ignoring
// the cube: +1 for each win, gammon and backgammon, -1 for each loss.
export const equity = p => 2 * p[WIN] - 1 + p[WIN_GAMMON] + p[WIN_BACKGAMMON] - p[LOSE_GAMMON] - p[LOSE_BACKGAMMON];

// The chances once a game is over, for the side that has just won it.
export const won = kind => Float64Array.of(1, kind === 'single' ? 0 : 1, kind === 'backgammon' ? 1 : 0, 0, 0);

// ---- Weights ------------------------------------------------------------

// weights.js stores a network as 16-bit numbers, each part with its own
// scale, in base64: { hidden, scales: [w1, b1, w2, b2], data }.
const sizes = hidden => [INPUTS * hidden, hidden, hidden * OUTPUTS, OUTPUTS];

export function unpackNet({ hidden, scales, data }) {
  const bytes = Uint8Array.from(atob(data), ch => ch.charCodeAt(0));
  const values = new Int16Array(bytes.buffer);
  let at = 0;
  const [w1, b1, w2, b2] = sizes(hidden).map((size, part) => {
    const array = new Float32Array(size);
    for (let i = 0; i < size; i++) array[i] = values[at + i] * scales[part];
    at += size;
    return array;
  });
  return { hidden, w1, b1, w2, b2 };
}

export function packNet(net, about = {}) {
  const parts = [net.w1, net.b1, net.w2, net.b2];
  const scales = parts.map(part => part.reduce((most, weight) => Math.max(most, Math.abs(weight)), 1e-9) / 32767);
  const values = new Int16Array(sizes(net.hidden).reduce((sum, size) => sum + size, 0));
  let at = 0;
  parts.forEach((part, i) => {
    for (const weight of part) values[at++] = Math.round(weight / scales[i]);
  });
  const bytes = new Uint8Array(values.buffer);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { ...about, hidden: net.hidden, scales, data: btoa(text) };
}
