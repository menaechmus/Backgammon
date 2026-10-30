// Sound effects, made on the spot with the Web Audio API so the game ships no
// audio files. Every effect is built from two ingredients, as in Cribbage: a
// burst of filtered noise (dice rattling, a checker sliding) and a short tone
// (the knock of wood on wood, a chime). The fanfare for a win is a brass
// ensemble of its own, in fanfare.js.

import { playFanfare } from './fanfare.js';

const noiseByContext = new WeakMap();

function noiseFor(context) {
  let buffer = noiseByContext.get(context);
  if (!buffer) {
    buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    noiseByContext.set(context, buffer);
  }
  return buffer;
}

// Fades a gain node in fast and out by `at + length`.
function shape(level, at, length, gain) {
  level.gain.setValueAtTime(0.0001, at);
  level.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.004, length / 3));
  level.gain.exponentialRampToValueAtTime(0.0001, at + length);
}

// `sweep` slides the pitch over the burst: above 1 rises, like a checker
// pushed across the board; below 1 falls, like one landing.
function burst(context, at, { length, pitch, sweep = 1, gain }) {
  const source = context.createBufferSource();
  source.buffer = noiseFor(context);
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(pitch, at);
  filter.frequency.exponentialRampToValueAtTime(pitch * sweep, at + length);
  const level = context.createGain();
  shape(level, at, length, gain);
  source.connect(filter).connect(level).connect(context.destination);
  source.start(at, Math.random() * 0.5, length + 0.01);
}

function tone(context, at, { length, pitch, glide = 1, gain, wave = 'sine' }) {
  const oscillator = context.createOscillator();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(pitch, at);
  oscillator.frequency.exponentialRampToValueAtTime(pitch * glide, at + length);
  const level = context.createGain();
  shape(level, at, length, gain);
  oscillator.connect(level).connect(context.destination);
  oscillator.start(at);
  oscillator.stop(at + length + 0.01);
}

const EFFECTS = {
  // The dice shaken in the cup: quick, uneven clicks.
  shake(context, at) {
    for (let t = 0; t < 0.34; t += 0.022 + Math.random() * 0.02) {
      burst(context, at + t, { length: 0.014, pitch: 2600 + Math.random() * 2200, gain: 0.35 + Math.random() * 0.35 });
    }
  },

  // The dice landing: a clack each, then a smaller bounce.
  roll(context, at) {
    for (const [start, gain] of [[0, 0.85], [0.055, 0.75], [0.13, 0.4], [0.19, 0.25]]) {
      burst(context, at + start, { length: 0.03, pitch: 3600, sweep: 0.7, gain });
    }
    tone(context, at, { length: 0.06, pitch: 520, glide: 0.6, gain: 0.14, wave: 'triangle' });
  },

  // A checker set down: a click with the weight of wood under it.
  place(context, at) {
    burst(context, at, { length: 0.04, pitch: 1700, sweep: 0.5, gain: 0.85 });
    tone(context, at, { length: 0.08, pitch: 240, glide: 0.6, gain: 0.26, wave: 'triangle' });
  },

  // A checker hit: a heavier knock, then it slides away to the bar.
  hit(context, at) {
    burst(context, at, { length: 0.06, pitch: 1100, sweep: 0.5, gain: 0.9 });
    tone(context, at, { length: 0.12, pitch: 150, glide: 0.5, gain: 0.32 });
    burst(context, at + 0.08, { length: 0.14, pitch: 1500, sweep: 1.8, gain: 0.45 });
  },

  // A checker borne off: slid into the tray, where it clicks on the others.
  off(context, at) {
    burst(context, at, { length: 0.1, pitch: 1500, sweep: 2, gain: 0.7 });
    burst(context, at + 0.1, { length: 0.02, pitch: 3200, sweep: 0.7, gain: 0.6 });
  },

  // The cube turned and set down: a hollow thunk.
  cube(context, at) {
    burst(context, at, { length: 0.05, pitch: 900, sweep: 0.6, gain: 0.6 });
    tone(context, at, { length: 0.16, pitch: 180, glide: 0.7, gain: 0.3, wave: 'triangle' });
  },

  // The checkers set out for a new game: a ripple of soft clicks.
  setup(context, at) {
    for (let i = 0; i < 14; i++) {
      burst(context, at + i * 0.055 + Math.random() * 0.02, { length: 0.02, pitch: 1900 + Math.random() * 900, sweep: 0.6, gain: 0.3 + Math.random() * 0.25 });
    }
  },

  // About three seconds of brass and timpani, then the hall's ring.
  win(context, at) {
    playFanfare(context, at, noiseFor(context));
  },

  // A firework bursting: a soft thump and bang, then a scatter of crackles.
  firework(context, at) {
    tone(context, at, { length: 0.2, pitch: 110, glide: 0.45, gain: 0.25 });
    burst(context, at, { length: 0.16, pitch: 900, sweep: 0.4, gain: 0.4 });
    for (let i = 0; i < 7; i++) {
      burst(context, at + 0.12 + Math.random() * 0.4, { length: 0.012, pitch: 4000 + Math.random() * 2500, gain: 0.15 + Math.random() * 0.15 });
    }
  },

  // Your turn, in a Wi-Fi game: two soft notes, up a fourth.
  turn(context, at) {
    tone(context, at, { length: 0.16, pitch: 784, gain: 0.16, wave: 'triangle' });
    tone(context, at + 0.13, { length: 0.34, pitch: 1046, gain: 0.16, wave: 'triangle' });
  },

  lose(context, at) {
    [392, 330, 262].forEach((pitch, i) => tone(context, at + i * 0.14, { length: 0.32, pitch, gain: 0.2, wave: 'triangle' }));
  },
};

export const SOUNDS = Object.keys(EFFECTS);

// Schedules one effect on any audio context; the tests use an offline one.
export function renderSound(name, context, at = context.currentTime) {
  EFFECTS[name](context, at);
}

let context = null;
let muted = false;
let waking = false;

export function setMuted(value) {
  muted = value;
}

// Browsers only let a page make sound after a tap or key press, so this is
// called from every one of those.
export function unlockSound() {
  if (muted || !window.AudioContext) return;
  context ??= new AudioContext();
  if (context.state === 'running' || waking) return;
  waking = true;
  context
    .resume()
    .catch(() => {})
    .then(() => {
      waking = false;
    });
}

export function playSound(name, delay = 0) {
  // A suspended context would hoard sounds and play them all at once on waking.
  if (muted || !context || (context.state !== 'running' && !waking)) return;
  try {
    renderSound(name, context, context.currentTime + delay);
  } catch {
    // Sound is decoration: a browser that cannot make it must not stop the game.
  }
}
