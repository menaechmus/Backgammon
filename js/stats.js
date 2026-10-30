// Lifetime statistics. The UI keeps this object in localStorage; nothing here
// touches storage, so it can be tested directly. Only finished matches count.
// Against the computer the person is side 0, and the games of each match are
// added up too; matches between people count each person's matches and
// wins, by name.

const levelRow = () => ({ matches: 0, wins: 0, streak: 0, bestStreak: 0 });
const personRow = () => ({ name: '', matches: 0, wins: 0 });

export function emptyStats() {
  return {
    ai: { easy: levelRow(), medium: levelRow(), hard: levelRow() },
    people: {}, // by name, lower case: { name, matches, wins }
    games: { won: 0, lost: 0, gammonsWon: 0, gammonsLost: 0, backgammonsWon: 0, backgammonsLost: 0 },
    records: { cube: 0, margin: 0 },
  };
}

// Pours saved data into the current shape, so a missing or damaged entry
// falls back to zero instead of breaking the page.
function fill(shape, saved) {
  if (typeof shape === 'string') return typeof saved === 'string' ? saved.slice(0, 40) : shape;
  if (Array.isArray(shape)) return shape.map((item, i) => fill(item, saved?.[i]));
  if (typeof shape === 'object') {
    return Object.fromEntries(Object.entries(shape).map(([key, item]) => [key, fill(item, saved?.[key])]));
  }
  return Number.isFinite(saved) ? saved : shape;
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keyOf = name => name.toLowerCase().slice(0, 40);

export function loadStats(saved) {
  const stats = fill(emptyStats(), saved);
  if (isObject(saved?.people)) {
    for (const [key, person] of Object.entries(saved.people).slice(0, 200)) {
      if (isObject(person)) stats.people[key.slice(0, 40)] = fill(personRow(), person);
    }
  }
  return stats;
}

export function recordMatch(stats, match) {
  if (match.mode !== 'ai') {
    match.players.forEach(({ name, ai }, side) => {
      if (ai) return;
      const person = (stats.people[keyOf(name)] ??= { ...personRow(), name });
      person.name = name;
      person.matches++;
      if (side === match.winner) person.wins++;
    });
    return;
  }

  const row = stats.ai[match.difficulty];
  const won = match.winner === 0;
  row.matches++;
  if (won) {
    row.wins++;
    row.streak++;
    row.bestStreak = Math.max(row.bestStreak, row.streak);
  } else {
    row.streak = 0;
  }

  const [mine, theirs] = match.tally;
  const { games, records } = stats;
  games.won += mine.games;
  games.lost += theirs.games;
  games.gammonsWon += mine.gammons;
  games.gammonsLost += theirs.gammons;
  games.backgammonsWon += mine.backgammons;
  games.backgammonsLost += theirs.backgammons;
  records.cube = Math.max(records.cube, match.highCube);
  if (won) records.margin = Math.max(records.margin, match.score[0] - match.score[1]);
}
