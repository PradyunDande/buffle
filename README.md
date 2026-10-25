# Baffle

**Buff + Scuffle.** A client-side fairy-tale fitness brawler for one or two people sharing a webcam, or a party of up to six playing online. Your squats, jumping jacks, punches, push-ups, and planks are your attacks.

## Modes

- **Boss Fight** (1–2 players, 1 camera): choose how many people are playing and a difficulty, and a random monster appears: the Big Bad Wolf, the Bridge Troll, the Wicked Witch, or the Tower Dragon (never the same one twice in a row). With two players, reps finished within 700ms of each other deal SYNC bonus damage and build a combo; every five syncs triggers FRENZY.
- **Remote Party** (up to 6 players, one device each): one player creates a party and shares its 5-letter code or invite link; the others join from their own devices. Everyone's camera appears in a grid, the host picks the difficulty, a random monster appears, and boss HP is multiplied by the number of players.
- **1v1 Scuffle** (2 players, 1 camera): a 45-second tug-of-war. Pick a difficulty and the game calls random moves from that difficulty's list, always the same move for both players at the same moment; both pause together while switching. Clean-rep streaks multiply your points. A 25-point lead wins by knockout. **Find Online Match** pairs you with another player online, each on their own device and camera; online matches are always Hard.

## Boss fights

Difficulty sets the fight; the monster only changes the look and lines.

| Difficulty | Boss HP per player | Time | Boss attacks every | Move switches every | Moves |
| --- | --- | --- | --- | --- | --- |
| Easy | 24 | 90 s | 12 s | 14–20 s | squats, punches, jumping jacks |
| Normal | 36 | 90 s | 10 s | 10–15 s | + push-ups |
| Hard | 50 | 100 s | 8 s | 8–12 s | + planks |

- Every rep deals damage: clean reps 2, half reps 1, sloppy form 0.5. Push-ups are worth 1.5×, punches 0.5× (they come fast). A held plank deals damage every 1.2 seconds.
- The boss calls a random move from the difficulty's list for each player, on that player's own timer, so teammates can be on different moves at once. Each call comes as a line of dialog in the monster's speech bubble, using the player's name ("Hosty, drop and give me push-ups!"). Local players set names on the Boss Fight setup screen; remote players use their party name. Lines live in each boss's `lines` in `js/config.js`.
- A player's reps pause for 3 seconds after a switch (5 before push-ups or a plank) so they can change position; everyone else keeps fighting. If every player is switching at once, the clock and the boss's attacks wait. The boss never calls a switch mid-attack.
- Every 8–11 seconds the boss attacks. Land a rep within 2.5 seconds to parry for +2 damage, or lose one of your three hearts.
- You lose if your hearts or the clock run out.

## Run

From this folder, run:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000> in a modern browser, choose a mode, and allow camera access. On Windows, `python -m http.server 8000` may be the available command.

The first fight loads MediaPipe Tasks Vision and its lite pose model from the specified CDNs. Internet access is needed for those files and the Google font. The game itself has no backend and sends no webcam video to a server. In a remote party, camera video goes only to the other players.

## Remote parties

Remote play uses [PeerJS](https://peerjs.com/) (loaded from a CDN) to connect browsers directly over WebRTC. PeerJS's free public server only introduces players to each other; video and game events go player to player.

- **Host-authoritative:** the host's browser runs the fight (boss HP, each player's move, attacks, timer) and sends the state to guests 10 times a second. Each guest runs pose detection on their own camera and sends only their reps.
- **Video:** every player sends their camera to every other player at 640×480, with no audio. That's fine for a few players; at 6 players each device uploads 5 streams.
- **Hosting:** each player must load the game over HTTPS (or `localhost`) for camera access, so a party across devices needs the folder hosted somewhere public, such as GitHub Pages, Netlify, or an HTTPS tunnel like ngrok to your local server.
- **Networks:** without a TURN server, some strict corporate or school networks block the direct connection. Phone hotspots and home Wi-Fi usually work.
- Players who join mid-fight wait in the lobby until the next fight. If the host leaves, the party ends.
- **Matchmaking** has no server of its own. Six well-known PeerJS ids (`buffle-match-hard-0` to `-5`) act as waiting rooms: a searcher first tries to join whoever is waiting in one, and if nobody is, takes the first free room and waits. If two people search at the same instant and both end up waiting, the one in the later room keeps checking earlier rooms and moves when it finds someone. Whoever waited becomes the host. Six rooms means at most six players can be waiting at once; anyone beyond that is told to try again.

## Test controls

During a fight, press **1** for a clean P1 rep, **2** for a clean P2 rep, **Q** for a P1 half rep, and **W** for a P2 half rep. Press 1 and 2 within 700ms to trigger a SYNC bonus. If the camera or model cannot start, choose **Use Hotkeys** to play a full fight.

## Boss art

Each boss in `BOSSES` ([js/config.js](js/config.js)) has a 16×16 pixel map drawn on a canvas. To use generated pixel art instead, add the image (e.g. `assets/bosses/wolf.png`) and set that boss's `image` field to its path. Square images with transparent backgrounds look best.

## Code layout

The game is plain ES modules with no build step; `index.html` loads `js/main.js`, which imports the rest.

`style.css` is themed entirely through role-based variables in `:root` (`--bg-base`, `--bg-surface`, `--ui-accent`, `--ui-danger`, `--text-main`, and so on). No rule outside `:root` names a color, and the skeleton overlay and confetti read the same variables, so changing those values re-themes the whole game.

| File | What it holds |
| --- | --- |
| `js/main.js` | Entry point: button, keyboard, and settings wiring |
| `js/config.js` | Exercise names, scoring constants, and the boss roster |
| `js/state.js` | Shared game state, saved settings, scoring helpers |
| `js/ui.js` | DOM helpers, sounds and effects, sprites, the in-fight HUD |
| `js/game.js` | The fight loop: reps, the boss's move calls and attacks, clock, results |
| `js/exercises.js` | Rep detection for squats, jumping jacks, push-ups, and planks |
| `js/camera.js` | Camera, pose model, and the per-frame tracking loop |
| `js/party.js` | Remote party gameplay: lobby, roster, host-to-guest sync, camera grid |
| `js/network.js` | PeerJS connections for remote parties |

## Known limitations

- Two-player tracking works best when both people remain fully visible and do not cross paths. Assignments follow the nearest prior hip positions; the **Swap P1 / P2** setting corrects an unwanted assignment.
- Squats, jumping jacks, and punches only need the upper body in frame:
  - Squats use the knee angle when a leg is visible. Otherwise they measure how far the shoulders drop below standing height, in shoulder widths. Bowing forward can also register as a squat in that mode.
  - Jumping jacks check the arms only when the feet are out of frame.
  - Punches count each arm going from bent to straight at shoulder height. They use MediaPipe's 3D world landmarks so punches toward the camera register; that depth estimate is the least reliable signal, so tune it with the debug overlay and sensitivity slider.
- Planks need a side view with the shoulder, hip, and ankle visible. Push-ups need a side view of the arm; body straightness is checked against the ankle, or the knee if the feet are out of frame.
- Lighting, camera angle, loose clothing, and partial bodies can affect pose detection and form scores. The sensitivity slider can help, but full movements are more reliable.
- Remote parties support boss fights only; remote duels and random matchmaking are not built yet.
