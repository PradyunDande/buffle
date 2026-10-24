/* DOM helpers, sound and visual effects, sprites, and the in-fight HUD. */

import { HEARTS, NAMES } from "./config.js";
import { tileFor, updateTileNames } from "./party.js";
import { boss, comboMultiplier, isFrenzy, isHost, number, rope, scoreText, settings, state } from "./state.js";

export const $ = (id) => document.getElementById(id);

export function show(id) {
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === id));
  state.screen = id;
  window.scrollTo(0, 0);
}
export function toast(message) {
  const box = $("toast");
  box.textContent = message;
  box.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { box.hidden = true; }, 2800);
}
// An alert with no duration stays up until replaced or cleared.
function showAlert(text, kind, ms = 0) {
  const box = $("alert-banner");
  box.textContent = text;
  box.className = `alert-banner ${kind}`;
  box.hidden = false;
  clearTimeout(state.alertTimer);
  if (ms) state.alertTimer = setTimeout(clearAlert, ms);
}
export function clearAlert() { clearTimeout(state.alertTimer); $("alert-banner").hidden = true; }

// Audio is created only after a user gesture; every sound is synthesized locally.
export function sound(kind) {
  if (!settings.sound) return;
  try {
    state.audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (state.audio.state === "suspended") state.audio.resume();
    const notes = kind === "victory" ? [[523,0],[659,.13],[784,.26],[1047,.4]]
      : kind === "sync" ? [[520,0],[780,.08],[1040,.16]]
      : kind === "warn" ? [[440,0],[440,.22]]
      : kind === "hurt" ? [[180,0],[120,.1]] : [[330,0]];
    for (const [frequency, delay] of notes) {
      const oscillator = state.audio.createOscillator();
      const gain = state.audio.createGain();
      oscillator.type = kind === "hit" ? "triangle" : kind === "hurt" ? "sawtooth" : "square";
      oscillator.frequency.setValueAtTime(frequency, state.audio.currentTime + delay);
      gain.gain.setValueAtTime(0.0001, state.audio.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.06, state.audio.currentTime + delay + .01);
      gain.gain.exponentialRampToValueAtTime(0.0001, state.audio.currentTime + delay + .18);
      oscillator.connect(gain).connect(state.audio.destination);
      oscillator.start(state.audio.currentTime + delay);
      oscillator.stop(state.audio.currentTime + delay + .2);
    }
  } catch { /* Sound must never interrupt play. */ }
}

export function confetti() {
  if (!settings.effects) return;
  const layer = $("effects");
  for (let i = 0; i < 22; i++) {
    const bit = document.createElement("span");
    bit.className = "confetti";
    bit.style.left = `${40 + Math.random() * 20}vw`;
    bit.style.top = `${18 + Math.random() * 12}vh`;
    bit.style.background = ["#f3c351", "#d4563b", "#fff1c4", "#9462a6"][i % 4];
    bit.style.setProperty("--dx", `${(Math.random() - .5) * 450}px`);
    bit.style.setProperty("--dy", `${100 + Math.random() * 280}px`);
    layer.append(bit);
    setTimeout(() => bit.remove(), 1300);
  }
  const bat = document.createElement("span");
  bat.className = "bat";
  bat.textContent = "🦇";
  layer.append(bat);
  setTimeout(() => bat.remove(), 1400);
}
export function flashAndShake(kind, id = "stage") {
  const element = $(id);
  if (!settings.effects || !element) return;
  element.classList.remove(kind);
  void element.offsetWidth;
  element.classList.add(kind);
  setTimeout(() => element.classList.remove(kind), 600);
}
export function floatText(index, text, className = "") {
  const party = state.mode === "party";
  const own = !party || index === state.myIndex;
  const stage = own ? $("stage") : tileFor(index) || $("stage");
  const item = document.createElement("span");
  // On this device's camera the text follows the person; on other tiles it is centred.
  const player = own ? state.trackers[party ? 0 : index] : null;
  item.className = `floating ${className}`;
  item.textContent = text;
  item.style.left = `${((player?.x ?? (party ? .5 : index ? .7 : .25)) * 100).toFixed(1)}%`;
  item.style.top = `${Math.max(10, ((player?.y ?? .5) * 100) - 20).toFixed(1)}%`;
  stage.append(item);
  setTimeout(() => item.remove(), 1250);
}
// Game effects run here and, on a party host, on every guest's screen too.
export const EFFECTS = { floatText, showAlert, clearAlert, confetti, flashAndShake, sound };
export function fx(name, ...args) {
  EFFECTS[name](...args);
  if (isHost()) state.party.broadcast({ t: "fx", name, args });
}

export function renderSprite(container, b) {
  if (b.image) {
    const image = new Image();
    image.src = b.image;
    image.alt = "";
    container.replaceChildren(image);
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const ctx = canvas.getContext("2d");
  b.sprite.forEach((row, y) => [...row].forEach((key, x) => {
    if (!b.palette[key]) return;
    ctx.fillStyle = b.palette[key];
    ctx.fillRect(x, y, 1, 1);
  }));
  container.replaceChildren(canvas);
}

export function updateHud() {
  const duel = state.mode === "duel";
  if (duel) {
    $("p1-points").textContent = number(scoreText(state.scores[0]));
    $("p2-points").textContent = number(scoreText(state.scores[1]));
    $("rope-marker").style.left = `${50 - rope() * 50}%`;
  } else {
    const phases = boss().phases;
    $("boss-hp-fill").style.width = `${state.bossHp / state.bossMax * 100}%`;
    $("boss-hp-label").textContent = `${Math.ceil(state.bossHp)} / ${state.bossMax} HP`;
    $("phase-label").textContent = `PHASE ${state.phase + 1} / ${phases.length} · ${NAMES[state.exercise].toUpperCase()}`;
    $("phase-pips").querySelectorAll("span").forEach((pip, i) => { pip.className = i < state.phase ? "done" : i === state.phase ? "current" : ""; });
    $("hearts").textContent = "♥".repeat(state.hearts) + "♡".repeat(HEARTS - state.hearts);
    $("combo-value").innerHTML = `${state.combo} <small>×${comboMultiplier().toFixed(1)}</small>`;
    $("boss-sprite").classList.toggle("winding", Boolean(state.attack));
  }
  if (state.mode === "party") updateTileNames();
  else {
    $("p1-reps").textContent = number(state.trackers[0].reps);
    $("p2-reps").textContent = number(state.trackers[1].reps);
  }
  $("frenzy-banner").hidden = duel || !isFrenzy();
}

export function setResults(title, message, rating, ratingClass, stats) {
  $("results-title").textContent = title;
  $("result-message").textContent = message;
  $("rating").textContent = rating;
  $("rating").className = `rating ${ratingClass}`;
  stats.forEach(([label, value], i) => {
    $(`stat-label-${i + 1}`).textContent = label;
    $(`stat-${i + 1}`).textContent = value;
  });
}
