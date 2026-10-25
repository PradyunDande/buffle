/* Background music: the lobby track plays everywhere outside a fight, and the fight
   track from the moment a fight starts until its results. Online, both play at half
   volume so voice chat stays clear. Each track's volume is a setting (0–100). */

import { online, settings, state } from "./state.js";

const tracks = { lobby: new Audio("audio/lobby.mp3"), fight: new Audio("audio/fight.mp3") };
for (const audio of Object.values(tracks)) { audio.loop = true; audio.preload = "auto"; }

// Browsers only play sound once the player has interacted with the page.
let unlocked = false;
for (const kind of ["pointerdown", "keydown"]) addEventListener(kind, () => { unlocked = true; updateMusic(); }, { once: true });

export function updateMusic() {
  const fighting = state.screen === "game" && state.status !== "lobby";
  for (const [name, audio] of Object.entries(tracks)) {
    const current = (name === "fight") === fighting;
    audio.volume = Math.min(1, (settings[`${name}Volume`] / 100) * (online() ? .5 : 1));
    if (current && unlocked && audio.volume > 0) {
      if (audio.paused) audio.play().catch(() => { /* Music must never interrupt play. */ });
    } else if (!audio.paused) audio.pause();
    // Each fight starts its track from the top.
    if (!current) audio.currentTime = 0;
  }
}
// ponytail: polled, since screens and fight status change in many places; a few
// property reads every quarter second cost nothing.
setInterval(updateMusic, 250);
