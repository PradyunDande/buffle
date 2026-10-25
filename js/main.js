/* Buffle: a single-page, client-side fairy-tale exercise brawler. Wires up the page. */

import { positionLabels, prepareCamera, stopMedia, updateDebug } from "./camera.js";
import { beginCountdown, recordRep, setPlayers, showDuelSetup, showSetup, startFight, startGame, stopRound } from "./game.js";
import { cleanCode } from "./network.js";
import { cancelMatch, copyInvite, enterLobby, findMatch, hostStart, leaveParty, openParty } from "./party.js";
import { isGuest, online, saveSettings, settings, solo, state } from "./state.js";
import { $, show, toast } from "./ui.js";
import { toggleMic } from "./voice.js";

// Each mode first asks whether to play locally or online.
let chosenMode = "boss";
function showWhere(mode) {
  chosenMode = mode;
  $("where-title").textContent = mode === "boss" ? "Boss Scuffle" : "1v1 Scuffle";
  show("where");
}
$("fight-button").addEventListener("click", () => showWhere("boss"));
$("duel-button").addEventListener("click", () => showWhere("duel"));
$("play-local").addEventListener("click", () => { if (chosenMode === "boss") showSetup(); else showDuelSetup(); });
$("play-online").addEventListener("click", () => {
  $("player-name").value = $("match-name").value = settings.name;
  show(chosenMode === "boss" ? "remote" : "duel-online");
});
document.querySelectorAll("[data-players]").forEach((button) => button.addEventListener("click", () => setPlayers(Number(button.dataset.players))));
// Player 1's name is also their remote party name.
for (const [id, key] of [["p1-name", "name"], ["p2-name", "name2"]]) {
  $(id).addEventListener("input", (event) => {
    settings[key] = event.target.value.trim().slice(0, 16);
    if (key === "name") $("player-name").value = settings.name;
    saveSettings();
  });
}
$("start-fight").addEventListener("click", () => { state.mode = settings.players === 2 ? "coop" : "solo"; startFight(); });
$("how-button").addEventListener("click", () => show("how"));
$("settings-button").addEventListener("click", () => show("settings"));
function goToMenu() {
  if (state.party) { leaveParty(); return; }
  if (state.screen === "game") stopRound();
  show("menu");
}
document.querySelectorAll("[data-screen]").forEach((button) => button.addEventListener("click", () => show(button.dataset.screen)));
$("start-duel").addEventListener("click", () => { state.mode = "duel"; startGame(); });
$("find-match").addEventListener("click", findMatch);
// Leaving the 1v1 screen stops a search; the shared Back handler then shows the menu.
document.querySelector("#duel-online .back").addEventListener("click", cancelMatch);
$("leave-button").addEventListener("click", goToMenu);
$("mic-button").addEventListener("click", toggleMic);
$("menu-button").addEventListener("click", goToMenu);
$("map-button").addEventListener("click", () => { if (state.party) enterLobby(); else showSetup(); });
$("again-button").addEventListener("click", () => {
  if (isGuest()) { state.party.send({ t: "rematch" }); toast("Rematch requested"); }
  else if (state.party) hostStart();
  else if (state.mode === "duel") startGame();
  else startFight();
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
  if (!online()) state.status = "loading";
  $("game-error").hidden = true;
  $("camera-placeholder").hidden = false;
  $("camera-placeholder").textContent = "Preparing the camera…";
  prepareCamera();
});
function useHotkeys() {
  if (online()) {
    // Online hotkeys always work; without a camera this just clears the error.
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
window.addEventListener("keydown", (event) => {
  if (state.screen !== "game" || state.status !== "playing" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  const match = { "1": [0,"clean",1], "2": [1,"clean",1], q: [0,"ok",.5], w: [1,"ok",.5] }[key];
  if (!match || (solo() && match[0] === 1)) return;
  event.preventDefault();
  recordRep(...match, false);
});
