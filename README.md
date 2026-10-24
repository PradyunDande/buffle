# Baffle

**Buff + Scuffle.** A client-side fairy-tale fitness brawler for one or two people sharing a webcam. Your squats, jumping jacks, and planks are your attacks.

## Modes

- **Story Mode** (solo): a four-chapter campaign. Defeat the Big Bad Wolf, the Bridge Troll, the Wicked Witch, and the Tower Dragon to save the kingdom. Each cleared chapter unlocks the next; progress is saved in the browser.
- **Co-op Boss** (2 players, 1 camera): team up against any boss. Bosses have double health. Reps finished within 700ms of each other deal SYNC bonus damage and build a combo; every five syncs triggers FRENZY.
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

The first fight loads MediaPipe Tasks Vision and its lite pose model from the specified CDNs. Internet access is needed for those files and the Google font. The game itself has no backend and sends no webcam video to a server.

## Test controls

During a fight, press **1** for a clean P1 rep, **2** for a clean P2 rep, **Q** for a P1 half rep, and **W** for a P2 half rep. Press 1 and 2 within 700ms to trigger a SYNC bonus. If the camera or model cannot start, choose **Use Hotkeys** to play a full fight.

## Boss art

Each boss in `BOSSES` (top of `app.js`) has a 16×16 pixel map drawn on a canvas. To use generated pixel art instead, add the image (e.g. `assets/bosses/wolf.png`) and set that boss's `image` field to its path. Square images with transparent backgrounds look best.

## Known limitations

- Two-player tracking works best when both people remain fully visible and do not cross paths. Assignments follow the nearest prior hip positions; the **Swap P1 / P2** setting corrects an unwanted assignment.
- Planks and push-ups need a side view with the shoulder, hip, and ankle visible. Push-ups are experimental.
- Lighting, camera angle, loose clothing, and partial bodies can affect pose detection and form scores. The sensitivity slider can help, but full movements are more reliable.
- Remote Play and random matchmaking are not built yet.
