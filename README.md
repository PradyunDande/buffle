# Baffle

**Buff + Scuffle.** A client-side fairy-tale fitness brawler for one or two people sharing a webcam, or a party of up to six playing online. Your squats, jumping jacks, and planks are your attacks.

## Modes

- **Story Mode** (solo): a four-chapter campaign. Defeat the Big Bad Wolf, the Bridge Troll, the Wicked Witch, and the Tower Dragon to save the kingdom. Each cleared chapter unlocks the next; progress is saved in the browser.
- **Co-op Boss** (2 players, 1 camera): team up against any boss. Bosses have double health. Reps finished within 700ms of each other deal SYNC bonus damage and build a combo; every five syncs triggers FRENZY.
- **Remote Party** (up to 6 players, one device each): one player creates a party and shares its 5-letter code or invite link; the others join from their own devices. Everyone's camera appears in a grid, the host picks the boss, and boss HP is multiplied by the number of players.
- **1v1 Duel** (2 players, 1 camera): a 45-second tug-of-war on one exercise. Clean-rep streaks multiply your points. A 25-point lead wins by knockout.

## Boss fights

- Every rep deals damage: clean reps 2, half reps 1, sloppy form 0.5. A held plank deals damage every 1.2 seconds.
- Bosses rotate exercises as their health drops (e.g. squats → jumping jacks → plank). The game pauses for 3 seconds between phases (5 seconds before a plank) so players can change position.
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

- **Host-authoritative:** the host's browser runs the fight (boss HP, phases, attacks, timer) and sends the state to guests 10 times a second. Each guest runs pose detection on their own camera and sends only their reps.
- **Video:** every player sends their camera to every other player at 640×480, with no audio. That's fine for a few players; at 6 players each device uploads 5 streams.
- **Hosting:** each player must load the game over HTTPS (or `localhost`) for camera access, so a party across devices needs the folder hosted somewhere public, such as GitHub Pages, Netlify, or an HTTPS tunnel like ngrok to your local server.
- **Networks:** without a TURN server, some strict corporate or school networks block the direct connection. Phone hotspots and home Wi-Fi usually work.
- Players who join mid-fight wait in the lobby until the next fight. If the host leaves, the party ends.

## Test controls

During a fight, press **1** for a clean P1 rep, **2** for a clean P2 rep, **Q** for a P1 half rep, and **W** for a P2 half rep. Press 1 and 2 within 700ms to trigger a SYNC bonus. If the camera or model cannot start, choose **Use Hotkeys** to play a full fight.

## Boss art

Each boss in `BOSSES` ([js/config.js](js/config.js)) has a 16×16 pixel map drawn on a canvas. To use generated pixel art instead, add the image (e.g. `assets/bosses/wolf.png`) and set that boss's `image` field to its path. Square images with transparent backgrounds look best.

## Code layout

The game is plain ES modules with no build step; `index.html` loads `js/main.js`, which imports the rest.

| File | What it holds |
| --- | --- |
| `js/main.js` | Entry point: button, keyboard, and settings wiring |
| `js/config.js` | Exercise names, scoring constants, and the boss roster |
| `js/state.js` | Shared game state, saved settings and story progress, scoring helpers |
| `js/ui.js` | DOM helpers, sounds and effects, sprites, the in-fight HUD |
| `js/game.js` | The fight loop: reps, boss phases and attacks, clock, results |
| `js/exercises.js` | Rep detection for squats, jumping jacks, push-ups, and planks |
| `js/camera.js` | Camera, pose model, and the per-frame tracking loop |
| `js/party.js` | Remote party gameplay: lobby, roster, host-to-guest sync, camera grid |
| `js/network.js` | PeerJS connections for remote parties |

## Known limitations

- Two-player tracking works best when both people remain fully visible and do not cross paths. Assignments follow the nearest prior hip positions; the **Swap P1 / P2** setting corrects an unwanted assignment.
- Planks and push-ups need a side view with the shoulder, hip, and ankle visible. Push-ups are experimental.
- Lighting, camera angle, loose clothing, and partial bodies can affect pose detection and form scores. The sensitivity slider can help, but full movements are more reliable.
- Remote parties support boss fights only; remote duels and random matchmaking are not built yet.
