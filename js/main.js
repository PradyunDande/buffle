/* Buffle: a single-page, client-side fairy-tale exercise brawler. Wires up the page. */

import { positionLabels, prepareCamera, stopMedia, updateDebug } from "./camera.js";
import { beginCountdown, recordRep, showBosses, startGame, stopRound } from "./game.js";
import { cleanCode } from "./network.js";
import { copyInvite, enterLobby, hostStart, leaveParty, openParty } from "./party.js";
import { progress, saveProgress, saveSettings, settings, solo, state } from "./state.js";
import { $, show, toast } from "./ui.js";

$("story-button").addEventListener("click", () => { state.mode = "story"; showBosses(); });
$("coop-button").addEventListener("click", () => { state.mode = "coop"; showBosses(); });
$("duel-button").addEventListener("click", () => { state.mode = "duel"; show("exercise"); });
$("how-button").addEventListener("click", () => show("how"));
$("settings-button").addEventListener("click", () => show("settings"));
$("remote-button").addEventListener("click", () => show("remote"));
function goToMenu() {
  if (state.party) { leaveParty(); return; }
  if (state.screen === "game") stopRound();
  show("menu");
}
$("brand").addEventListener("click", goToMenu);
document.querySelectorAll("[data-screen]").forEach((button) => button.addEventListener("click", () => show(button.dataset.screen)));
document.querySelectorAll("[data-exercise]").forEach((button) => button.addEventListener("click", () => { state.exercise = button.dataset.exercise; startGame(); }));
$("leave-button").addEventListener("click", goToMenu);
$("menu-button").addEventListener("click", goToMenu);
$("map-button").addEventListener("click", () => { if (state.party) enterLobby(); else showBosses(); });
$("again-button").addEventListener("click", () => {
  if (state.party) { hostStart(); return; }
  if (state.advance) state.bossIndex++;
  startGame();
});
$("create-party").addEventListener("click", () => openParty(false));
$("join-party").addEventListener("click", () => openParty(true));
$("join-code").addEventListener("keydown", (event) => { if (event.key === "Enter") openParty(true); });
$("start-party").addEventListener("click", hostStart);
$("copy-invite").addEventListener("click", copyInvite);
$("player-name").value = settings.name;
window.addEventListener("pagehide", () => state.party?.leave());
const invite = cleanCode(new URLSearchParams(location.search).get("party"));
if (invite.length === 5) { $("join-code").value = invite; show("remote"); }
$("retry-button").addEventListener("click", () => {
  stopMedia();
  if (state.mode !== "party") state.status = "loading";
  $("game-error").hidden = true;
  $("camera-placeholder").hidden = false;
  $("camera-placeholder").textContent = "Preparing the camera…";
  prepareCamera();
});
function useHotkeys() {
  if (state.mode === "party") {
    // Party hotkeys always work; without a camera this just clears the error.
    if (!state.stream) {
      stopMedia(); state.keyboardOnly = true;
      $("camera-placeholder").hidden = false;
      $("camera-placeholder").textContent = "Hotkey mode — press 1 or Q";
    }
    $("game-error").hidden = true;
    return;
  }
  if (state.status !== "loading") return;
  stopMedia(); state.keyboardOnly = true;
  $("game-error").hidden = true;
  $("camera-placeholder").textContent = "Hotkey mode — press 1 / 2 or Q / W";
  $("waiting").hidden = true;
  beginCountdown(state.session);
}
$("keyboard-button").addEventListener("click", useHotkeys);
$("keyboard-shortcut").addEventListener("click", useHotkeys);

for (const [id, key] of [["sound-toggle","sound"],["effects-toggle","effects"],["debug-toggle","debug"]]) {
  $(id).checked = settings[key];
  $(id).addEventListener("change", (event) => { settings[key] = event.target.checked; saveSettings(); updateDebug(); });
}
$("sensitivity").value = settings.sensitivity;
function sensitivityName() { $("sensitivity-name").textContent = settings.sensitivity < -5 ? "Strict" : settings.sensitivity > 5 ? "Forgiving" : "Normal"; }
sensitivityName();
$("sensitivity").addEventListener("input", (event) => { settings.sensitivity = Number(event.target.value); sensitivityName(); saveSettings(); });
$("swap-button").addEventListener("click", () => {
  settings.swapped = !settings.swapped;
  state.trackers.reverse();
  state.lastEvents.reverse();
  state.scores.reverse();
  saveSettings(); positionLabels();
  toast(`P1 / P2 ${settings.swapped ? "swapped" : "restored"}`);
});
$("reset-progress").addEventListener("click", () => {
  progress.cleared = 0;
  saveProgress();
  toast("Story progress reset");
});
window.addEventListener("keydown", (event) => {
  if (state.screen !== "game" || state.status !== "playing" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  const match = { "1": [0,"clean",1], "2": [1,"clean",1], q: [0,"ok",.5], w: [1,"ok",.5] }[key];
  if (!match || (solo() && match[0] === 1)) return;
  event.preventDefault();
  recordRep(...match, false);
});
