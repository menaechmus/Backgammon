// Dice thrown onto the board. planThrow() works out where each die goes and
// how, and never touches the page, so it can be tested; throwDice() puts a
// throw on screen as real 3D cubes, in a layer over the board.
//
// Distances are in board units. Dice come in over the rail on their own side,
// the bottom side's from the right and the top side's from the left, and keep
// to the strip across the middle that checkers never reach.

import { BOARD, STRIP, diceXY } from './board.js';

export const THROW_MS = 720; // a die's time from leaving the rail to coming to rest
export const STAGGER_MS = 60; // the second die leaves this long after the first
export const THROW_TOTAL_MS = THROW_MS + STAGGER_MS;

const TILT = 16; // how crooked a die may lie, in degrees, at most
const TILT_DOUBLES = 7; // four in a row need to lie straighter
const WANDER = 3; // how far a die may lie to either side of the strip's centre
const LIFT = 0.28; // how much bigger a die looks at the top of its flight
const SHADOW = 6; // how far its shadow falls from it up there

const MIDDLE = (STRIP.top + STRIP.bottom) / 2;

// A die's flight: at each share of its time, how much of the way it has come
// and how high it is. It arrives in the air, bounces twice and rolls to a stop.
const FLIGHT = [
  { at: 0, along: 0, high: 1 },
  { at: 0.3, along: 0.52, high: 0 },
  { at: 0.46, along: 0.72, high: 0.4 },
  { at: 0.6, along: 0.85, high: 0 },
  { at: 0.7, along: 0.91, high: 0.14 },
  { at: 0.8, along: 0.96, high: 0 },
  { at: 1, along: 1, high: 0 },
];

export const FIRST_BOUNCE_MS = FLIGHT[1].at * THROW_MS;

const between = (random, low, high) => low + (high - low) * random();

// Where the dice of one throw come to rest, and how the thrown ones get there:
// [{ x, y, tilt, from, delay, spin, wobble }], `from` being null for a die that
// is not thrown. `count` is 1 (a side's die in the opening roll), 2, or 4 for
// a double: only two dice are thrown then, into the middle two of four
// places, and the other two appear beside them to count off the moves.
export function planThrow(bottom, count, random = Math.random) {
  const quarter = BOARD.quarters[bottom ? 1 : 0];
  const middle = quarter.x + quarter.width / 2;
  const way = bottom ? -1 : 1; // the way the dice travel
  const rail = bottom ? quarter.x + quarter.width + 4 : quarter.x - 4;
  const rest = (x, wander, tilt) => ({ x, y: MIDDLE + between(random, -wander, wander), tilt: between(random, -tilt, tilt) });

  let dice;
  if (count === 1) dice = [rest(middle + between(random, -8, 8), WANDER, TILT)];
  else if (count === 2) {
    const far = middle + way * between(random, 8, 26);
    dice = [rest(far, WANDER, TILT), rest(far - way * between(random, 32, 46), WANDER, TILT)];
  } else dice = [0, 1, 2, 3].map(i => rest(diceXY(bottom, 4, i)[0], 1, TILT_DOUBLES));

  const thrown = count === 4 ? [dice[bottom ? 1 : 2], dice[bottom ? 2 : 1]] : dice;
  return dice.map(die => {
    const order = thrown.indexOf(die);
    if (order < 0) return { ...die, from: null };
    return {
      ...die,
      from: [rail, MIDDLE + between(random, -WANDER, WANDER)],
      delay: order * STAGGER_MS,
      // Rolling along, the top of a die moves the way it travels, and as the
      // turns run out it comes to rest with its number up.
      spin: -way * 360 * between(random, 1.25, 2),
      wobble: (random() < 0.5 ? -1 : 1) * between(random, 90, 180),
    };
  });
}

// A thrown die's flight, frame by frame: where it is, how high, and how far it
// still has to turn.
export const flightOf = die =>
  FLIGHT.map(({ at, along, high }) => ({
    at,
    high,
    x: die.from[0] + (die.x - die.from[0]) * along,
    y: die.from[1] + (die.y - die.from[1]) * along,
    spin: die.spin * (1 - along),
    wobble: die.wobble * (1 - along),
  }));

const PIPS = {
  1: [[0, 0]],
  2: [[-5.5, -5.5], [5.5, 5.5]],
  3: [[-5.5, -5.5], [0, 0], [5.5, 5.5]],
  4: [[-5.5, -5.5], [5.5, -5.5], [-5.5, 5.5], [5.5, 5.5]],
  5: [[-5.5, -5.5], [5.5, -5.5], [0, 0], [-5.5, 5.5], [5.5, 5.5]],
  6: [[-5.5, -5.5], [5.5, -5.5], [-5.5, 0], [5.5, 0], [-5.5, 5.5], [5.5, 5.5]],
};

// One face of a die, as SVG drawn round (0, 0), the same on the board and on a
// flying cube.
export function dieFace(value) {
  const half = BOARD.die / 2;
  const pips = PIPS[value].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.3"/>`).join('');
  return `<rect x="${-half}" y="${-half}" width="${BOARD.die}" height="${BOARD.die}" rx="4.5"/>${pips}`;
}

// The six faces of a cube, opposite faces adding up to seven as on a real die,
// and how to turn the cube so that each number lies face up.
export const FACES = {
  1: 'rotateY(0deg)',
  6: 'rotateY(180deg)',
  2: 'rotateY(90deg)',
  5: 'rotateY(-90deg)',
  3: 'rotateX(90deg)',
  4: 'rotateX(-90deg)',
};

export const FACE_UP = {
  1: 'rotateY(0deg)',
  6: 'rotateY(-180deg)',
  2: 'rotateY(-90deg)',
  5: 'rotateY(90deg)',
  3: 'rotateX(-90deg)',
  4: 'rotateX(90deg)',
};

function cubeElement(side, value, size) {
  const die = document.createElement('div');
  die.className = `thrown die side${side}`;
  die.style.setProperty('--size', `${size}px`);
  const half = BOARD.die / 2;
  const faces = Object.entries(FACES)
    .map(([number, turn]) =>
      `<svg class="pane" viewBox="${-half} ${-half} ${BOARD.die} ${BOARD.die}" style="transform: ${turn} translateZ(${size / 2}px)">${dieFace(number)}</svg>`)
    .join('');
  die.innerHTML = `<div class="shadow"></div><div class="lift"><div class="cube">${faces}</div></div>`;
  die.querySelector('.cube').style.transform = FACE_UP[value];
  return die;
}

// Puts a throw on screen in `layer`, a page element laid over the board:
// `dice` are planThrow's thrown dice, each with its `side` and `value`. Each
// part of a die is animated by itself, and the last frame holds until the
// layer is emptied.
export function throwDice(layer, dice) {
  const unit = layer.clientWidth / BOARD.width;
  const size = BOARD.die * unit;
  for (const die of dice) {
    const element = cubeElement(die.side, die.value, size);
    layer.append(element);
    const frames = flightOf(die);
    const timing = { duration: THROW_MS, delay: die.delay, fill: 'both' };
    const place = ({ x, y }) => `translate(${x * unit - size / 2}px, ${y * unit - size / 2}px)`;
    // Rising it slows and falling it speeds up, each hop easing the same way.
    const hop = (frame, i) => (frames[i + 1]?.high > frame.high ? 'ease-out' : 'ease-in');
    element.animate(frames.map(frame => ({ offset: frame.at, transform: place(frame) })), timing);
    element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 70, delay: die.delay, fill: 'both' });
    element.querySelector('.lift').animate(
      frames.map((frame, i) => ({ offset: frame.at, easing: hop(frame, i), transform: `scale(${1 + LIFT * frame.high})` })),
      timing,
    );
    element.querySelector('.shadow').animate(
      frames.map((frame, i) => {
        const fall = SHADOW * frame.high * unit;
        return { offset: frame.at, easing: hop(frame, i), opacity: 1 - 0.55 * frame.high, transform: `translate(${fall}px, ${fall}px)` };
      }),
      timing,
    );
    element.querySelector('.cube').animate(
      frames.map(frame => ({
        offset: frame.at,
        transform: `rotateZ(${die.tilt}deg) rotateY(${frame.spin}deg) rotateX(${frame.wobble}deg) ${FACE_UP[die.value]}`,
      })),
      timing,
    );
  }
}
