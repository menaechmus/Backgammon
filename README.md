# Backgammon

Backgammon for the browser. Play against the computer (easy, medium or hard), or pass one device between two people. Matches to 1, 3, 5 or 7 points, with the doubling cube. Works with touch, mouse and keyboard, on phones and desktops.

It is a static page: plain HTML, CSS and JavaScript modules, with no build step and no libraries.

## Play

- **Computer** on the menu plays against the computer; **People** is for two people sharing one device, each of whom can type a name. Backgammon hides nothing, so there is no need to pass the device face down: the prompt says whose turn it is.
- **Match to** sets the match length. A single game scores 1 point, a gammon 2 and a backgammon 3, times the doubling cube. **Doubling cube** switches the cube on or off; a 1-point match never uses it. The Crawford rule applies: nobody may double in the game after a side first comes within one point of winning.
- Every game starts with an opening roll, one die each, and the higher plays both. Press **Roll**, or tap the dice, to roll.
- Tap a checker, and the places it may go light up: tap one to move there, or drag the checker there. A checker on the bar is picked up for you, as it must come in first. A move that uses both dice is offered in one tap when every way of making it ends the same.
- **Undo** takes back the moves of the turn until you press **Done**. When no move is possible, the prompt says so and Done ends the turn.
- **Double** offers the cube before you roll. When doubled, **Take** plays on at twice the stakes and **Pass** gives up the game at the stakes before.
- **Hint** shows the strongest move as arrows on the board and says what it does, or the right cube decision. It can be switched off on the menu.
- The small number under each name is that side's pip count: how far its checkers still have to go.
- Each new game sets out the checkers with a short animation, the dice tumble, and the computer's checkers slide into place one at a time. Tap anywhere to skip any of these.
- Winning a match is celebrated with fireworks, confetti and a brass fanfare (the same as Cribbage's) before the results appear. Tap to skip it.
- Sound effects can be muted with the speaker button, the Sound setting on the menu, or `M`.
- Keyboard: the arrow keys move between your checkers and then the places a picked-up checker may go, `Space` picks up and puts down, `Enter` presses the main button (Roll, Done, Take, Next game), `U` or `Backspace` undoes, `D` doubles, `H` asks for a hint and `M` mutes.
- **Statistics** keeps your record against each computer level, with your games, gammons and backgammons, and matches between people by name.
- The **i** button on the menu shows which version is running.

Settings, the match in progress and your statistics are kept in the browser's `localStorage`, so they stay on that device and browser and disappear if its site data is cleared.

## The computer

The computer judges positions with a small neural network that taught itself backgammon by playing hundreds of thousands of games against itself, the method of Gerald Tesauro's TD-Gammon. The network and its weights (`js/weights.js`) were made for this game, by training tools that stay on the developer's computer.

- **Hard** plays the move the network rates best, looking one roll ahead at its closest choices, and weighs gammons by what they are worth at the match score.
- **Medium** and **Easy** use the same network but misjudge every move by a random amount, Easy by more, and Easy sometimes plays any move at all.
- Cube decisions use the network's chances of winning, and of winning or losing a gammon, turned into chances of winning the match with a match equity table worked out in `js/ai.js`.

## Run locally

Browsers will not load JavaScript modules from `file://`, so serve the folder:

```
python -m http.server 8000
```

Then open <http://localhost:8000/>. The tests run in the browser at <http://localhost:8000/tests.html>.

## Deploy to GitHub Pages

In the repository go to **Settings → Pages**, choose **Deploy from a branch**, and select `main` and `/ (root)`. The game is served at <https://menaechmus.github.io/Backgammon/>.

## Releasing

Before pushing a change, raise `VERSION` and `RELEASED` at the top of `js/ui.js`. The About box shows them, which makes it easy to tell when a browser is still running a cached copy of an earlier release.

## Layout

| File | What it holds |
|---|---|
| `index.html`, `css/style.css` | The page and its styles |
| `js/game.js` | The rules: the board, legal turns, the cube and the match, as a plain match object and the actions that change it |
| `js/board.js` | Board geometry: where each point, checker, die and the cube sit, and what a tap lands on |
| `js/neural.js` | The network that judges positions: its inputs and outputs, and how its weights are stored |
| `js/weights.js` | The trained weights |
| `js/ai.js` | The computer's three levels, the match equity table, cube decisions and hints |
| `js/input.js` | Tapping and dragging checkers, for mouse, touch and pen |
| `js/stats.js` | Lifetime statistics |
| `js/sound.js` | Sound effects, generated with the Web Audio API (no audio files) |
| `js/fanfare.js` | The win fanfare: a generated brass ensemble with timpani, as in Cribbage |
| `js/celebrate.js` | Fireworks and confetti for a win, as in Cribbage |
| `js/ui.js` | Drawing, input, animation and storage |
| `tests.html` | Tests for the rules, the board, the network, the computer, statistics, the celebration and sound |
