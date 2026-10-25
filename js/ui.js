/* DOM helpers, sound and visual effects, sprites, and the in-fight HUD. */

import { HEARTS, NAMES, TIPS } from "./config.js";
import { tileFor, updateTileNames } from "./party.js";
import { comboMultiplier, isFrenzy, isHost, localTrackers, number, rope, scoreText, settings, state } from "./state.js";

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
export function showAlert(text, kind, ms = 0) {
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
    bit.style.background = `var(${["--ui-accent", "--ui-danger", "--text-main", "--ui-alt"][i % 4]})`;
    bit.style.setProperty("--dx", `${(Math.random() - .5) * 450}px`);
    bit.style.setProperty("--dy", `${100 + Math.random() * 280}px`);
    layer.append(bit);
    setTimeout(() => bit.remove(), 1300);
  }
  const bat = document.createElement("span");
  bat.className = "bat";
  bat.append(pixelArt(BAT));
  layer.append(bat);
  setTimeout(() => bat.remove(), 1400);
}
// Pixel-art icons drawn as crisp SVG in the current text color: "X" cells are filled.
const HEART = [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."];
const BAT = ["X.........X", "XX..X.X..XX", "XXX.XXX.XXX", "XXXXXXXXXXX", ".XXXXXXXXX.", "..XX...XX..", "...X...X..."];
function pixelArt(rows, className = "") {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${rows[0].length} ${rows.length}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  rows.forEach((row, y) => [...row].forEach((cell, x) => {
    if (cell !== "X") return;
    const rect = document.createElementNS(ns, "rect");
    for (const [key, value] of [["x", x], ["y", y], ["width", 1], ["height", 1], ["fill", "currentColor"]]) rect.setAttribute(key, value);
    svg.append(rect);
  }));
  return svg;
}
function renderHearts(count) {
  const box = $("hearts");
  if (box.dataset.count === String(count)) return;
  box.dataset.count = String(count);
  box.setAttribute("aria-label", `${count} heart${count === 1 ? "" : "s"}`);
  box.replaceChildren(...Array.from({ length: HEARTS }, (_, i) => pixelArt(HEART, i < count ? "" : "empty")));
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
export const EFFECTS = { floatText, showAlert, clearAlert, confetti, flashAndShake, sound, bossSay };
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
    $("boss-hp-fill").style.width = `${state.bossHp / state.bossMax * 100}%`;
    $("boss-hp-label").textContent = `${Math.ceil(state.bossHp)} / ${state.bossMax} HP`;
    $("move-label").textContent = moveLabel();
    renderHearts(state.hearts);
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

// The HUD names each local player's move, and "GET READY" while they switch.
function moveLabel() {
  const now = performance.now();
  const moves = localTrackers().map((t) => `${t.exercise ? NAMES[t.exercise].toUpperCase() : "—"}${now < t.readyAt ? " · GET READY" : ""}`);
  return moves.length === 1 ? `${state.mode === "party" ? "YOUR MOVE" : "MOVE"}: ${moves[0]}` : moves.map((move, i) => `P${i + 1}: ${move}`).join("  ·  ");
}
export function updateTip() {
  const moves = [...new Set(localTrackers().map((t) => t.exercise).filter(Boolean))];
  $("pose-tip").textContent = moves.length === 1 ? TIPS[moves[0]]
    : moves.length ? "Each player does the move the boss called for them." : "Keep your upper body in frame.";
}

// The monster's speech bubble shows one line at a time, then returns to its taunt.
// Only the latest few lines wait their turn, so a burst of switches never lags far behind.
const speech = { queue: [], timer: 0 };
export function bossSay(text) {
  speech.queue.push(String(text));
  if (speech.queue.length > 3) speech.queue.shift();
  if (!speech.timer) nextLine();
}
function nextLine() {
  const box = $("boss-taunt");
  const line = speech.queue.shift();
  box.classList.remove("speaking");
  if (line === undefined) { speech.timer = 0; box.textContent = box.dataset.taunt || ""; return; }
  void box.offsetWidth;
  box.textContent = line;
  box.classList.add("speaking");
  speech.timer = setTimeout(nextLine, 3500);
}
export function resetSpeech(taunt) {
  clearTimeout(speech.timer);
  speech.queue = [];
  speech.timer = 0;
  $("boss-taunt").dataset.taunt = `“${taunt}”`;
  nextLine();
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
