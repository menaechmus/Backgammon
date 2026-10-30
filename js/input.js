// Picking checkers up and putting them down, the same way for mouse, touch
// and pen. A press on a checker that moves becomes a drag: a copy of the
// checker follows the pointer, and the place it would land lights up. A press
// that does not move is a tap, and arrives as an ordinary click. What each
// gesture means is up to the page, through the handlers it passes. Places on
// the board are as board.js's locate() gives them.
//
// handlers.canDrag(place)       may the checker there be picked up?
// handlers.lift(place)          it is being dragged: returns its element, to copy
// handlers.canDrop(from, place) may it land there?
// handlers.drop(from, place)    it was let go there (null: nowhere it may go)
// handlers.tap(place)           a tap on the board (place may be null)

import { locate } from './board.js';

const DRAG_START = 6; // pixels a pointer travels before a press counts as a drag

export function setupInput({ host, handlers }) {
  let press = null; // { pointer, x, y, place, touch }
  let drag = null; // { ghost, original, over }
  let swallowClick = false;

  // From the screen to the board's own units.
  function toBoard(clientX, clientY) {
    const svg = host.querySelector('svg');
    const matrix = svg?.getScreenCTM();
    if (!matrix) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(matrix.inverse());
    return [local.x, local.y];
  }

  const placeAt = (clientX, clientY) => {
    const at = toBoard(clientX, clientY);
    return at && locate(...at);
  };

  host.addEventListener('pointerdown', event => {
    if (press || event.button > 0) return;
    const place = placeAt(event.clientX, event.clientY);
    if (!place || !handlers.canDrag(place)) return;
    press = { pointer: event.pointerId, x: event.clientX, y: event.clientY, place, touch: event.pointerType === 'touch' };
  });

  function startDrag() {
    const original = handlers.lift(press.place);
    const layer = host.querySelector('.drag-layer');
    if (!original || !layer) return false;
    const ghost = original.cloneNode(true);
    ghost.classList.add('ghost');
    ghost.removeAttribute('data-key');
    layer.append(ghost);
    original.classList.add('lifted');
    drag = { ghost, original, over: null };
    return true;
  }

  function mark(over) {
    if (drag.over === over) return;
    drag.over?.classList.remove('over');
    drag.over = over;
    over?.classList.add('over');
  }

  function moveDrag(clientX, clientY) {
    const at = toBoard(clientX, clientY);
    if (!at) return;
    // On a touch screen the checker rides above the finger, where it can be seen.
    const [x, y] = press.touch ? [at[0], at[1] - 30] : at;
    drag.ghost.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    const place = locate(x, y);
    const allowed = place && handlers.canDrop(press.place, place) ? place : null;
    drag.place = allowed;
    mark(allowed ? host.querySelector(`[data-dest="${destKey(allowed)}"]`) : null);
  }

  function endDrag() {
    if (!drag) return;
    mark(null);
    drag.ghost.remove();
    drag.original.classList.remove('lifted');
    drag = null;
  }

  addEventListener('pointermove', event => {
    if (!press || event.pointerId !== press.pointer) return;
    if (!drag) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_START) return;
      if (!startDrag()) {
        press = null;
        return;
      }
    }
    event.preventDefault();
    moveDrag(event.clientX, event.clientY);
  });

  addEventListener('pointerup', event => {
    if (!press || event.pointerId !== press.pointer) return;
    const done = press;
    press = null;
    if (!drag) return;
    const place = drag.place ?? null;
    endDrag();
    // The click that follows the end of a drag is not a tap.
    swallowClick = true;
    setTimeout(() => {
      swallowClick = false;
    }, 0);
    handlers.drop(done.place, place);
  });

  addEventListener('pointercancel', event => {
    if (!press || event.pointerId !== press.pointer) return;
    endDrag();
    press = null;
  });

  addEventListener(
    'click',
    event => {
      if (!swallowClick) return;
      swallowClick = false;
      event.stopPropagation();
      event.preventDefault();
    },
    true,
  );

  host.addEventListener('click', event => handlers.tap(placeAt(event.clientX, event.clientY)));

  // A long press would otherwise open the browser's own menu.
  host.addEventListener('contextmenu', event => event.preventDefault());

  return {
    // Drops whatever is being dragged, as when the board is drawn afresh under it.
    cancel() {
      endDrag();
      press = null;
    },
    get busy() {
      return Boolean(drag);
    },
  };
}

// How the page marks a destination it draws, so a drag can light it up.
export const destKey = place => (place.kind === 'point' ? `p${place.n}` : place.kind === 'tray' ? 'off' : place.kind);
