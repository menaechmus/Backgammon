# Backgammon

Backgammon for the browser. Play against the computer (easy, medium or hard), pass one device between two people, or play on your own phones over Wi-Fi. Matches to 1, 3, 5 or 7 points, with the doubling cube. Works with touch, mouse and keyboard, on phones and desktops.

It is a static page: plain HTML, CSS and JavaScript modules, with no build step. Its one library, PeerJS, is kept in `js/vendor/` and loaded only for Wi-Fi games.

## Play

- **Computer** on the menu plays against the computer; **People** is for two people sharing one device, each of whom can type a name. Backgammon hides nothing, so there is no need to pass the device face down: the prompt says whose turn it is.
- **Wi-Fi** on the menu lets two people play on their own phones (see [Wi-Fi games](#wi-fi-games)). Each types their name. One taps **Host a game**, and a four-letter code appears. The other taps **Join a game** and types it, or opens the link that **Share link** sends. The host taps **Start** once both are in.
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
- **Statistics** keeps your record against each computer level, with your games, gammons and backgammons, and matches between people (on one device or over Wi-Fi) by name.
- The **i** button on the menu shows which version is running.

Settings, the match in progress and your statistics are kept in the browser's `localStorage`, so they stay on that device and browser and disappear if its site data is cleared.

## Wi-Fi games

Each person plays on their own phone, and one phone, the host's, keeps the match. It rolls every die, checks every move and keeps the score. The other phone sends it its moves, a whole turn at a time when Done is pressed, and it sends the match back after every move. Backgammon hides nothing, so both phones see all of it, each with its own side at the bottom of the board.

- A browser cannot run a server or find other devices on a network by itself. So, for a few seconds at the start, a free public service, the [PeerJS](https://peerjs.com) cloud server, passes the connection details between the phones. After that the phones are linked directly (WebRTC), and moves go straight across the Wi-Fi. This needs the internet at the start. Everyone has it anyway, because the game itself loads from the web.
- On a Wi-Fi network that keeps devices apart (guest and hotel networks often do), PeerJS's free relay carries the moves instead. If the PeerJS service is down, Wi-Fi games cannot start, but the other modes are not affected.
- The host's match length, doubling cube and hints settings apply to both. Sound is set on each phone.
- Screens stay on during a Wi-Fi game, because a phone that goes to sleep drops out.
- A phone that drops out (it slept, switched apps, reloaded, or lost the Wi-Fi) reconnects by itself and takes back its seat. While it is gone, its score is dimmed on the other phone. When it is that player's turn, the host's main button can let the computer roll, play or answer a double for them, after asking, so the match need not wait.
- If the host's page reloads, it reopens the same match under the same code, and the other phone comes back by itself.
- When it becomes your turn, your phone chimes, and buzzes if it can.
- At the end each phone records the match in its own **Statistics**, under "Between people". Only the host can start another match.
- A phone running an older copy of the game is asked to reload.
- PeerJS 1.5.5 (MIT licence, see `js/vendor/LICENSE-peerjs.txt`) is the unchanged `peerjs.min.js` from <https://github.com/peers/peerjs>.

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
| `js/net.js` | Connections between phones for a Wi-Fi game: a room under a four-letter code, and links that carry messages (through PeerJS, or between the tabs of one browser for testing), as in Cribbage |
| `js/wifi.js` | A Wi-Fi game between two phones: seats, what each phone is sent, and the messages between the host and the other |
| `js/vendor/` | PeerJS, and its licence |
| `js/ui.js` | Drawing, input, animation, Wi-Fi games and storage |
| `tests.html` | Tests for the rules, the board, the network, the computer, Wi-Fi games, statistics, the celebration and sound |
