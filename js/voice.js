/* Voice chat for online play: this player's microphone rides in the same call as
   their camera, and each other player's audio plays from their camera tile with
   its own mute and volume. */

import { online, state } from "./state.js";
import { $, toast } from "./ui.js";

// What this player sends: camera video plus microphone audio, whichever exist.
// A new combination replaces the outgoing calls, so others hear the change.
export function publishStream() {
  if (!state.party) return;
  const tracks = [...(state.stream?.getVideoTracks() ?? []), ...(state.mic?.getAudioTracks() ?? [])];
  state.party.setStream(tracks.length ? new MediaStream(tracks) : null);
}

// The microphone is asked for separately from the camera, so either can be
// refused without losing the other.
export async function startVoice() {
  if (!online() || state.mic || state.micBusy) return;
  state.micBusy = true;
  updateMicButton();
  try {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false
    });
    if (!online()) { mic.getTracks().forEach((track) => track.stop()); return; }
    state.mic = mic;
    mic.getAudioTracks().forEach((track) => { track.enabled = !state.micMuted; });
    state.micError = false;
    publishStream();
  } catch {
    state.micError = true;
    toast("Microphone unavailable. Others won't hear you.");
  } finally {
    state.micBusy = false;
    updateMicButton();
  }
}
export function stopVoice() {
  state.mic?.getTracks().forEach((track) => track.stop());
  Object.assign(state, { mic: null, micMuted: false, micError: false });
  state.remoteAudio.clear();
  updateMicButton();
}

export function toggleMic() {
  if (!state.mic) return;
  state.micMuted = !state.micMuted;
  state.mic.getAudioTracks().forEach((track) => { track.enabled = !state.micMuted; });
  updateMicButton();
}
export function updateMicButton() {
  const button = $("mic-button");
  button.hidden = !online();
  button.disabled = !state.mic;
  button.textContent = state.mic ? (state.micMuted ? "Unmute" : "Mute") : state.micBusy ? "Mic…" : "No Mic";
  button.classList.toggle("muted", state.micMuted || !state.mic);
  button.setAttribute("aria-pressed", String(state.micMuted));
}

// Each remote tile carries its player's audio; its controls sit in the strip under
// the camera. Mute and volume are kept per player for as long as they stay.
// `tile` is the whole tile: the camera screen and the strip beneath it.
function audioFor(id) {
  if (!state.remoteAudio.has(id)) state.remoteAudio.set(id, { muted: false, volume: 100, lastVolume: 100 });
  return state.remoteAudio.get(id);
}
export function addAudioControls(tile, id) {
  const controls = document.createElement("div");
  controls.className = "tile-audio";
  controls.innerHTML = `<button class="tile-mute" type="button"></button>`
    + `<input class="tile-volume" type="range" min="0" max="100" step="5" aria-label="Volume">`;
  controls.querySelector(".tile-mute").addEventListener("click", () => {
    const audio = audioFor(id);
    audio.muted = !audio.muted;
    // Unmuting after sliding the volume to zero brings back the last audible level.
    if (!audio.muted && audio.volume === 0) audio.volume = audio.lastVolume;
    applyAudio(tile, id);
  });
  controls.querySelector(".tile-volume").addEventListener("input", (event) => {
    const audio = audioFor(id);
    audio.volume = Number(event.target.value);
    if (audio.volume > 0) audio.lastVolume = audio.volume;
    audio.muted = audio.volume === 0;
    applyAudio(tile, id);
  });
  tile.querySelector(".tile-bar").append(controls);
  applyAudio(tile, id);
}
export function applyAudio(tile, id) {
  const audio = audioFor(id), video = tile.querySelector("video");
  const name = state.roster.find((m) => m.id === id)?.name || "player";
  video.muted = audio.muted;
  video.volume = audio.volume / 100;
  const mute = tile.querySelector(".tile-mute");
  mute.textContent = audio.muted ? "Unmute" : "Mute";
  mute.setAttribute("aria-pressed", String(audio.muted));
  mute.setAttribute("aria-label", `${audio.muted ? "Unmute" : "Mute"} ${name}`);
  const slider = tile.querySelector(".tile-volume");
  slider.value = String(audio.muted ? 0 : audio.volume);
  slider.setAttribute("aria-label", `${name} volume`);
  tile.classList.toggle("silenced", audio.muted);
}

// Browsers can refuse to autoplay sound. If so, play muted and turn the sound on
// with the next click or key press.
export function playWithSound(video, tile, id) {
  video.play().catch(() => {
    video.muted = true;
    video.play().catch(() => { /* The stream may have ended. */ });
    toast("Click anywhere to hear other players");
    const resume = () => { applyAudio(tile, id); video.play().catch(() => {}); };
    window.addEventListener("pointerdown", resume, { once: true });
    window.addEventListener("keydown", resume, { once: true });
  });
}
