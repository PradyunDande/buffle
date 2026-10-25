# Baffle

**Buff + Scuffle.** A client-side fairy-tale fitness brawler for one or two people sharing a webcam, or a party of up to six playing online. Your squats, jumping jacks, punches, push-ups, and planks are your attacks.

## Modes

The menu has two modes, **Boss Scuffle** and **1v1 Scuffle**. Each first asks whether you're playing **Local** (sharing one camera) or **Online** (each on your own device).

- **Local Boss Scuffle** (1–2 players, 1 camera): choose how many people are playing and a difficulty, and a random monster appears: the Big Bad Wolf, the Bridge Troll, the Wicked Witch, or the Tower Dragon (never the same one twice in a row). With two players, reps finished within 700ms of each other deal SYNC bonus damage and build a combo; every five syncs triggers FRENZY.
- **Online Boss Scuffle** (up to 6 players, one device each): one player creates a private party and shares its 5-letter code or invite link, or a public party that others find by name under Browse Public Parties; everyone plays from their own device. Everyone's camera appears in a grid, the host picks the difficulty, a random monster appears, and boss HP grows with the number of players.
- **1v1 Scuffle** (2 players, 1 camera): a 45-second tug-of-war. Pick a difficulty and the game calls random moves from that difficulty's list, always the same move for both players at the same moment; both pause together while switching. Clean-rep streaks multiply your points. A 25-point lead wins by knockout. **Find Online Match** pairs you with another player online, each on their own device and camera; online matches are always Hard.

## Boss fights

Difficulty sets the fight; the monster only changes the look and lines.

| Difficulty | Boss HP (solo) | Time | Boss attacks every | Move switches every | Moves |
| --- | --- | --- | --- | --- | --- |
| Easy | 30 | 90 s | 40 s | 14–20 s | squats, punches, jumping jacks |
| Normal | 45 | 90 s | 28 s | 10–15 s | + push-ups |
| Hard | 60 | 100 s | 18 s | 8–12 s | + straight-arm planks |

- Boss HP grows faster than the team, since teams also deal SYNC bonuses, combo multipliers, and FRENZY: each player adds the solo HP, and each player past the first adds another 30% on top (`TEAM_HP` in `js/config.js`). Two players face 2.6× the solo HP, three 4.8×, four 7.6×, six 15×.
- Every rep deals damage: clean reps 2, half reps 1, sloppy form 0.5. Push-ups are worth 1.5×, punches 0.25× (they come fast, and their co-op SYNC bonus is cut to match). A held straight-arm plank deals damage every 1.2 seconds.
- The boss calls a random move from the difficulty's list for each player, on that player's own timer, so teammates can be on different moves at once. Each call comes as a line of dialog in the monster's speech bubble, using the player's name ("Hosty, drop and give me push-ups!"). Local players set names on the Boss Fight setup screen; remote players use their party name. Lines live in each boss's `lines` in `js/config.js`.
- A new move counts from the player's next rep; a full-screen "SWITCH TO" callout shows it for two seconds.
- The boss attacks on a timer set by the difficulty, and every attack costs the team one of its five hearts. At a typical pace a team loses about one heart on Easy, two on Normal, and three or four on Hard; only on Hard can a slow team run out of hearts (at 90 s) before the clock.
- **Strike a Pose:** each player is frozen now and then on their own timer (every 35–50 s on Easy, 25–40 s on Normal, 18–30 s on Hard). The monster calls a pose (T-Pose, Flex, Hands on Head, or 6-7, where the hands bounce up and down in turn) and that player deals no damage until they hold it for 0.6 s; the clock and the boss's attacks keep going. Poses only need the upper body, are never called mid-switch or during push-ups or a plank, and the freeze wears off after 12 s if the camera can't see the pose. Not used in 1v1 Scuffle. Poses are judged from the shoulders and elbows, with the wrists checked only when visible, so they register even when a floor camera cuts off the head and raised hands.
- You lose if your hearts or the clock run out. Winning ranks you by hearts left: S for all five, A for three or four, B otherwise.

## Run

From this folder, run:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000> in a modern browser, choose a mode, and allow camera access. On Windows, `python -m http.server 8000` may be the available command.

The first fight loads MediaPipe Tasks Vision and its full pose model from the specified CDNs. Internet access is needed for those files and the Google font. The game itself has no backend and sends no webcam video to a server. In a remote party, camera video goes only to the other players.

## Remote parties

Remote play uses [PeerJS](https://peerjs.com/) (loaded from a CDN) to connect browsers directly over WebRTC. PeerJS's free public server only introduces players to each other; video and game events go player to player.

- **Host-authoritative:** the host's browser runs the fight (boss HP, each player's move, attacks, timer) and sends the state to guests 10 times a second. Each guest runs pose detection on their own camera and sends only their reps.
- **Video and voice:** every player sends their camera (640×480) and microphone to every other player. The mic is requested separately from the camera, so a player can be heard without a camera or seen without a mic. **Mute** in the game header silences your own mic; each other player's camera tile has a Mute button and a volume slider that only affect what you hear. Echo cancellation and noise suppression are on. That's fine for a few players; at 6 players each device uploads 5 streams.
- **Hosting:** each player must load the game over HTTPS (or `localhost`) for camera access, so a party across devices needs the folder hosted somewhere public, such as GitHub Pages, Netlify, or an HTTPS tunnel like ngrok to your local server.
- **Networks:** without a TURN server, some strict corporate or school networks block the direct connection. Phone hotspots and home Wi-Fi usually work.
- Players who join mid-fight wait in the lobby until the next fight. If the host leaves, the party ends.
- **Connection health:** a WebRTC link that stalls instead of failing stays "open" in PeerJS, so messages to it vanish silently. The host pings every guest every 2 s; a guest silent for 12 s is dropped from the party, and a guest that hears nothing from the host for 12 s returns to the menu with "Lost connection to the host." Fight updates carry the boss and difficulty, so a guest that missed the start message joins the fight on the next update. A camera call that hasn't connected within 10 s is hung up and placed again. Besides PeerJS's default STUN and TURN servers, extra Google and Cloudflare STUN servers help more players connect directly.
- **Public parties:** the host chooses Private (join by code) or Public (listed by a name the host sets). A public party takes one of twelve well-known PeerJS ids (`buffle-public-0` to `-11`). **Browse Public Parties** asks all twelve at once for their name, player count, difficulty, and whether a fight is on, and lists whoever answers. At most twelve public parties can exist at once.
- **Matchmaking** has no server of its own. Six well-known PeerJS ids (`buffle-match-hard-0` to `-5`) act as waiting rooms: a searcher first tries to join whoever is waiting in one, and if nobody is, takes the first free room and waits. If two people search at the same instant and both end up waiting, the one in the later room keeps checking earlier rooms and moves when it finds someone. Whoever waited becomes the host. Six rooms means at most six players can be waiting at once; anyone beyond that is told to try again.

## Boss art

Boss fights play out on a monster-battle screen: the boss stands between its status panel and the team's and talks in a speech bubble. In landscape the battle takes a narrow column on the left and the cameras the rest, with online camera tiles arranged to fill that space; in portrait the battle sits above the cameras. The boss blinks when reps land, lunges and throws its attack (`attackFx`) when it strikes, pants at low HP, and faints when beaten.

Each boss in `BOSSES` ([js/config.js](js/config.js)) has a full-body pixel map (any size; "." is empty) drawn on a canvas with a dark outline added around it, plus a `ground` color for the patch it stands on. To use generated pixel art instead, add the image (e.g. `assets/bosses/wolf.png`) and set that boss's `image` field to its path. Square images with transparent backgrounds look best.

## Code layout

The game is plain ES modules with no build step; `index.html` loads `js/main.js`, which imports the rest.

`style.css` is themed entirely through role-based variables in `:root` (`--bg-base`, `--bg-surface`, `--ui-accent`, `--ui-danger`, `--text-main`, and so on). No rule outside `:root` names a color, and the skeleton overlay and confetti read the same variables, so changing those values re-themes the whole game.

| File | What it holds |
| --- | --- |
| `js/main.js` | Entry point: button, keyboard, and settings wiring |
| `js/config.js` | Exercise names, scoring constants, and the boss roster |
| `js/state.js` | Shared game state, saved settings, scoring helpers |
| `js/ui.js` | DOM helpers, sounds and effects, sprites, the in-fight HUD |
| `js/music.js` | Lobby and fight music (`audio/`), half volume online, volumes from Settings |
| `js/game.js` | The fight loop: reps, the boss's move calls and attacks, clock, results |
| `js/exercises.js` | Rep detection for squats, jumping jacks, push-ups, and planks |
| `js/camera.js` | Camera, pose model, and the per-frame tracking loop |
| `js/filter.js` | One Euro filter that smooths each player's landmarks before rep detection |
| `js/party.js` | Remote party gameplay: lobby, roster, host-to-guest sync, camera grid |
| `js/network.js` | PeerJS connections, parties, and matchmaking |
| `js/voice.js` | Voice chat: microphone, self mute, and per-player volume |

## Known limitations

- Two-player tracking works best when both people remain fully visible and do not cross paths. Assignments follow the nearest prior hip positions; the **Swap P1 / P2** setting corrects an unwanted assignment. Solo, tracking stays on the person nearest where the player was last seen, so someone walking behind doesn't take over; with nobody tracked recently it picks the largest body in view.
- Landmarks pass through a One Euro filter before rep detection: it smooths hard while a point is still and barely at all while it moves fast, so standing jitter drops without lagging quick moves like punches. The filter restarts after a player is out of view for half a second.
- **Camera setup:** the camera goes on the floor, leaning against something and tilted up at the players, far enough back that everyone is in frame from head to knees (the feet can be out of frame). Before a local match, a card above the camera explains this and the countdown waits until every player's head and both knees have been visible for a second (or someone presses **Start anyway**). Online, the same card guides each player in the lobby.
- Facing the camera from that low, tilted view, flat 2D angles are distorted, so punches measure joint angles from MediaPipe's 3D world landmarks, and squats and jumping jacks are judged from the hips, knees, and shoulders, which stay in frame when the head, raised hands, and feet don't. The floor moves (push-ups and planks) work side-on, where the flat image shows the true angles and is steadier than MediaPipe's 3D estimate, or facing the camera, where only the 3D estimate shows how the body lies.
  - Squats are read from the thighs. Standing, the knees sit well below the hips in the image; at parallel the thighs point at the low camera, so the knees rise to the hips' height or above. A rep goes below 55% of the standing thigh height and back above 85%, and is clean below 20%. Depth alone sets the quality; forward lean isn't judged, because a tilted camera can't measure it reliably. With no hips or knees in view, squats fall back to how far the shoulders drop below standing height.
  - Jumping jacks face the camera: arms up overhead, feet apart, then arms back below the shoulders. Arms are judged from the shoulders, since the head and raised hands often leave the frame: an arm is up when its wrist is high above the shoulder, its elbow is above it, or its hand has gone off the top of the frame. With the feet out of frame, only the arms are checked.
  - Punches face the camera and count each arm going out and back to the guard at chest height. A punch thrown straight at the camera barely changes the flat image and the 3D depth estimate often misses it, so an arm also counts as out when its elbow comes up near shoulder height (in a guard it's tucked well below). An arm whose elbow is briefly hidden behind its own fist keeps its state. Tune with the debug overlay and sensitivity slider.
  - Push-ups and planks work side-on or facing the camera; the shoulders decide which (a full shoulder width apart means facing it), and each push-up keeps the view it started in. Side-on, they use the flat image angles: the elbow bend, and body straightness against the ankle, or the knee if the feet are out of frame. A push-up only counts with the body roughly level.
  - Facing the camera, a push-up is read from the elbows rising from below the shoulders to level with them, as a percentage of the top position. It only counts with the torso lying away from the camera in the 3D world landmarks and the shoulders visibly dropping, so raising your arms while standing never scores. A front-facing plank needs the torso lying away from the camera, elbows under the shoulders, and a 3D shoulder–hip–knee angle of at least 135° (on all fours it's near 90°), which also sets each tick's quality. If the bottom of a push-up dips below the frame, the player is treated as at the bottom of the rep for up to three seconds, and rising back into view with straight arms finishes it.
- Lighting, camera angle, loose clothing, and partial bodies can affect pose detection and form scores. The sensitivity slider can help, but full movements are more reliable.
- Remote parties support boss fights only; remote duels and random matchmaking are not built yet.
