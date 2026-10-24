# OMuscle

A client-side co-op exercise arcade for one or two people sharing a webcam.

## Run

From this folder, run:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000> in a modern browser, choose **Local Party** or **Solo Practice**, select an exercise, and allow camera access. On Windows, `python -m http.server 8000` may be the available command.

The first round loads MediaPipe Tasks Vision and its lite pose model from the specified CDNs. Internet access is needed for those files and the Google font. The game itself has no backend and sends no webcam video to a server.

## Test controls

During a round, press **1** for a clean P1 rep, **2** for a clean P2 rep, **Q** for a P1 half rep, and **W** for a P2 half rep. Press 1 and 2 within 700ms to trigger a SYNC bonus. If the camera or model cannot start, choose **Use Hotkeys** to play a full round.

## Known limitations

- Two-player tracking works best when both people remain fully visible and do not cross paths. Assignments follow the nearest prior hip positions; the **Swap P1 / P2** setting corrects an unwanted assignment.
- Push-ups are experimental and work best from the side with the shoulder, elbow, wrist, hip, and ankle visible.
- Lighting, camera angle, loose clothing, and partial bodies can affect pose detection and form scores. The sensitivity slider can help, but full movements are more reliable.
- Remote Co-Op and Random Match are intentionally disabled in this local MVP.
