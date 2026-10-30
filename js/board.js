// The board as geometry, in SVG units: where each point, checker, die and
// the cube sit, and which part of the board a tap lands on. Nothing is drawn
// here, so it can be tested.
//
// Points are numbered as the side at the bottom of the screen counts them:
// its home board, 1 to 6, is the bottom right quarter, 1 next to the trays;
// 7 to 12 run along the bottom left; 13 to 18 along the top left; and 19 to
// 24, the top side's home board, along the top right. The bar runs down the
// middle, and the checkers borne off stack in trays down the right edge, the
// bottom side's in the lower one.

const FRAME_X = 8; // the frame at the sides
const FRAME_Y = 12; // and at top and bottom, where the point numbers go
const POINT = 26; // the width of a point
const BAR_WIDTH = 30;
const TRAY_WIDTH = 30;
const LENGTH = 124; // of a point, from its base to its tip
const SLICE = 8; // the height a borne-off checker takes in the tray

const LEFT = FRAME_X;
const BAR_LEFT = LEFT + 6 * POINT;
const RIGHT = BAR_LEFT + BAR_WIDTH;
const TRAY_LEFT = RIGHT + 6 * POINT + FRAME_X;
const WIDTH = TRAY_LEFT + TRAY_WIDTH + FRAME_X;
const HEIGHT = 320;
const TOP = FRAME_Y;
const BOTTOM = HEIGHT - FRAME_Y;
const MIDDLE = HEIGHT / 2;

export const BOARD = {
  width: WIDTH,
  height: HEIGHT,
  radius: 12.5, // of a checker
  die: 24, // the side of a die
  cube: 26,
  // The playing surfaces, the bar and the two trays, as rectangles.
  quarters: [
    { x: LEFT, y: TOP, width: 6 * POINT, height: BOTTOM - TOP },
    { x: RIGHT, y: TOP, width: 6 * POINT, height: BOTTOM - TOP },
  ],
  bar: { x: BAR_LEFT, y: TOP, width: BAR_WIDTH, height: BOTTOM - TOP },
  trays: {
    top: { x: TRAY_LEFT, y: TOP, width: TRAY_WIDTH, height: MIDDLE - 24 - TOP },
    bottom: { x: TRAY_LEFT, y: MIDDLE + 24, width: TRAY_WIDTH, height: BOTTOM - MIDDLE - 24 },
  },
};

export const STACK = 5; // checkers shown on a point; more are counted on the fifth
export const BAR_STACK = 4;

export const isTopRow = n => n >= 13;

// Which column, counted from the left of the whole board, holds point n.
function column(n) {
  if (n <= 6) return 12 - n; // bottom right, 1 at the far right
  if (n <= 12) return 12 - n; // bottom left, 12 at the far left
  if (n <= 18) return n - 13; // top left
  return n - 13; // top right
}

// The centre of point n's column.
export function pointX(n) {
  const c = column(n);
  return (c < 6 ? LEFT : RIGHT - 6 * POINT) + c * POINT + POINT / 2;
}

// The triangle of point n, as an SVG path.
export function trianglePath(n) {
  const x = pointX(n);
  const [base, tip] = isTopRow(n) ? [TOP, TOP + LENGTH] : [BOTTOM, BOTTOM - LENGTH];
  return `M${x - POINT / 2} ${base}L${x + POINT / 2} ${base}L${x} ${tip}Z`;
}

// The kth checker on point n, counted from the edge of the board. Past the
// fifth they all sit on the fifth.
export function checkerXY(n, k) {
  const step = Math.min(k, STACK - 1) * POINT + POINT / 2;
  return [pointX(n), isTopRow(n) ? TOP + step : BOTTOM - step];
}

// The kth checker on the bar. The bottom side's wait in the upper half, near
// the top side's home board where they must come in, and the top side's in
// the lower half; the cube sits between them.
export function barXY(bottom, k) {
  const step = (Math.min(k, BAR_STACK - 1) + 1) * POINT;
  return [BAR_LEFT + BAR_WIDTH / 2, bottom ? MIDDLE - step : MIDDLE + step];
}

// The kth checker borne off, stacked edge-on from the outer end of a tray.
export function trayXY(bottom, k) {
  const step = 6 + k * SLICE;
  return [TRAY_LEFT + TRAY_WIDTH / 2, bottom ? BOTTOM - step : TOP + step];
}

// Die i of `count` (1, 2 or 4) for a side: the bottom side rolls into the
// right half of the board, the top side into the left.
export function diceXY(bottom, count, i) {
  const quarter = bottom ? RIGHT : LEFT;
  const middle = quarter + 3 * POINT;
  const gap = BOARD.die + 8;
  return [middle + (i - (count - 1) / 2) * gap, MIDDLE];
}

// Where the cube sits: in the middle of the bar while nobody owns it, at the
// owner's end of the bar, or held out in the middle of the other side's half
// while a double is offered to it.
export function cubeXY(place) {
  if (place === 'bottom') return [BAR_LEFT + BAR_WIDTH / 2, BOTTOM - BOARD.cube / 2];
  if (place === 'top') return [BAR_LEFT + BAR_WIDTH / 2, TOP + BOARD.cube / 2];
  if (place === 'offer-bottom') return [RIGHT + 3 * POINT, MIDDLE];
  if (place === 'offer-top') return [LEFT + 3 * POINT, MIDDLE];
  return [BAR_LEFT + BAR_WIDTH / 2, MIDDLE];
}

// Where point n's number is written, in the frame beyond its base.
export const labelXY = n => [pointX(n), isTopRow(n) ? TOP - 3.5 : BOTTOM + 9];

// What a tap at (x, y) lands on: { kind: 'point', n }, { kind: 'bar' },
// { kind: 'tray', bottom }, { kind: 'dice' }, or null. Each point owns its
// whole column down to near the middle, where the dice are.
export function locate(x, y) {
  if (x >= TRAY_LEFT - FRAME_X && x <= WIDTH) {
    if (y >= BOARD.trays.bottom.y - 6) return { kind: 'tray', bottom: true };
    if (y <= BOARD.trays.top.y + BOARD.trays.top.height + 6) return { kind: 'tray', bottom: false };
    return null;
  }
  if (x >= BAR_LEFT && x < RIGHT) return { kind: 'bar' };
  const inLeft = x >= LEFT && x < BAR_LEFT;
  const inRight = x >= RIGHT && x < RIGHT + 6 * POINT;
  if (!inLeft && !inRight) return null;
  if (Math.abs(y - MIDDLE) < 12) return { kind: 'dice' };
  const c = inLeft ? Math.floor((x - LEFT) / POINT) : 6 + Math.floor((x - RIGHT) / POINT);
  if (y < MIDDLE) return { kind: 'point', n: 13 + c };
  return { kind: 'point', n: 12 - c };
}
