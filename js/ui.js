/* DOM helpers, sound and visual effects, sprites, and the in-fight HUD. */

import { HEARTS, NAMES, POSE_HOLD, POSES, TIPS } from "./config.js";
import { tileFor, updateTileNames } from "./party.js";
import { boss, comboMultiplier, difficulty, isFrenzy, isHost, localTrackers, online, number, playerCount, playerName, rope, scoreText, settings, state } from "./state.js";

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
export const QUESTION = [".XXXXX.", "XX...XX", ".....XX", "....XX.", "...XX..", "...XX..", ".......", "...XX..", "...XX.."];
export const GEAR = ["....XXX....", ".XX.XXX.XX.", ".XXXXXXXXX.", "..XXXXXXX..", "XXXX...XXXX", "XXXX...XXXX", "XXXX...XXXX",
  "..XXXXXXX..", ".XXXXXXXXX.", ".XX.XXX.XX.", "....XXX...."];
// Local play: two players on one shared screen. Online: the whole world.
export const SHARED_SCREEN = ["..X.......X..", "...X.....X...", "....X...X....", ".....X.X.....", "XXXXXXXXXXXXX", "X...........X",
  "X..XX...XX..X", "X..XX...XX..X", "X.XXXX.XXXX.X", "X.XXXX.XXXX.X", "X...........X", "XXXXXXXXXXXXX", ".XX.......XX."];
export const GLOBE = ["....XXXXX....", "..XX..X..XX..", ".X...X.X...X.", ".X..X...X..X.", "XXXXXXXXXXXXX", "X...X...X...X",
  "X...X...X...X", "X...X...X...X", "XXXXXXXXXXXXX", ".X..X...X..X.", ".X...X.X...X.", "..XX..X..XX..", "....XXXXX...."];
export function pixelArt(rows, className = "") {
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
  const party = online();
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
export const EFFECTS = { floatText, showAlert, clearAlert, confetti, flashAndShake, sound, bossSay, battle };
export function fx(name, ...args) {
  EFFECTS[name](...args);
  if (isHost()) state.party.broadcast({ t: "fx", name, args });
}

// Draws a pixel map one pixel bigger all round, outlined in near-black wherever an
// empty pixel touches a filled one.
export function drawSprite(rows, palette) {
  const width = rows[0].length, height = rows.length;
  const canvas = document.createElement("canvas");
  canvas.width = width + 2;
  canvas.height = height + 2;
  const ctx = canvas.getContext("2d");
  const filled = (x, y) => Boolean(palette[rows[y]?.[x]]);
  for (let y = -1; y <= height; y++) for (let x = -1; x <= width; x++) {
    const color = filled(x, y) ? palette[rows[y][x]]
      : filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1) ? "#120d0a" : null;
    if (!color) continue;
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, 1, 1);
  }
  return canvas;
}
// Sized in sprite pixels (--px), so everything in the battle shares one pixel scale.
function sizeSprite(element, width, height) {
  element.style.width = `calc(var(--px) * ${width})`;
  element.style.height = `calc(var(--px) * ${height})`;
}
function renderSprite(container, b) {
  if (b.image) {
    const image = new Image();
    image.src = b.image;
    image.alt = "";
    container.replaceChildren(image);
    sizeSprite(container, 34, 34);
    return;
  }
  container.replaceChildren(drawSprite(b.sprite, b.palette));
  sizeSprite(container, b.sprite[0].length + 2, b.sprite.length + 2);
}

// Sets the battle up for this fight's boss: its ground, panel, and sprite.
export function renderBattle() {
  const b = boss(), count = playerCount();
  $("arena").style.setProperty("--ground", b.ground);
  $("boss-name").textContent = b.name.replace(/^The /, "");
  $("boss-level").textContent = `Lv${difficulty().level}`;
  renderSprite($("boss-sprite"), b);
  $("team-name").textContent = online() && count > 1 ? "The Party" : count === 2 ? `${playerName(0)} & ${playerName(1)}` : playerName(0);
  $("boss-sprite").classList.remove("fainted", "hurt", "lunge");
  flashAndShake("entering", "arena");
}

// Effect icons for the battle, drawn in their own color: hits on the boss, and
// what each boss's attack throws (its `attackFx`).
const STAR = ["...X...", ".X.X.X.", "..XXX..", "XXX.XXX", "..XXX..", ".X.X.X.", "...X..."];
const ATTACK_FX = {
  wind: { color: "#e8f6ff", rows: ["..XXXX.", ".X....X", "X..XX.X", "X.X..X.", "X..X...", ".X..XXX", "..XX..."] },
  rock: { color: "#8a6a48", rows: ["..XXX..", ".XXXXX.", "XXX.XXX", "XXXXXXX", "XX.XXXX", ".XXXXX.", "..XXX.."] },
  curse: { color: "#b07ee0", rows: [".XXXXX.", "XXXXXXX", "X..X..X", "XXXXXXX", ".XX.XX.", ".XXXXX.", "..X.X.."] },
  fire: { color: "#f39b2f", rows: ["...X...", "..XX...", "..XXX.X", ".XXXXXX", "XXX.XXX", "XX...XX", ".XX.XX."] }
};
// Effects land around the boss, except attacks, which cross the whole field.
function spawn(element, color, style, ms, layer = document.querySelector(".foe-spot")) {
  element.classList.add("fx");
  element.style.color = color;
  Object.assign(element.style, style);
  layer.append(element);
  setTimeout(() => element.remove(), ms);
}
// Monster-battle reactions: `hit` and `sync` when reps land (with the damage dealt),
// `attack` when the boss strikes, and `faint` or `lose` when the fight is decided.
export function battle(kind, amount = 0) {
  if ($("arena").hidden) return;
  if (kind === "faint") { $("boss-sprite").classList.add("fainted"); return; }
  // Beating the players, the boss gloats with one last lunge.
  if (kind === "lose") { flashAndShake("lunge", "boss-sprite"); return; }
  if (!settings.effects) return;
  if (kind === "attack") {
    const { rows, color } = ATTACK_FX[boss().attackFx] ?? ATTACK_FX.rock;
    flashAndShake("lunge", "boss-sprite");
    for (let i = 0; i < 3; i++) spawn(pixelArt(rows, "bolt"), color, { animationDelay: `${i * 90}ms` }, 800, $("battle-fx"));
    setTimeout(() => { flashAndShake("shake", "team-panel"); flashAndShake("shake", "battle-field"); }, 480);
    return;
  }
  const sync = kind === "sync";
  flashAndShake("hurt", "boss-sprite");
  if (sync) flashAndShake("shake", "battle-field");
  for (let i = 0; i < (sync ? 3 : 1); i++) {
    spawn(pixelArt(STAR, "burst"), sync ? "#f8c030" : "#fff",
      { left: `${10 + Math.random() * 60}%`, top: `${10 + Math.random() * 50}%`, animationDelay: `${i * 80}ms` }, 700);
  }
  if (!amount) return;
  const damage = document.createElement("span");
  damage.className = "damage";
  damage.textContent = `-${number(scoreText(amount))}`;
  spawn(damage, "", { left: `${30 + Math.random() * 30}%`, top: "0" }, 800);
}

export function updateHud() {
  const duel = state.mode === "duel";
  if (duel) {
    // Both duelists share a move, so the header names it.
    $("game-title").textContent = NAMES[state.trackers[0].exercise] ?? "";
    $("p1-points").textContent = number(scoreText(state.scores[0]));
    $("p2-points").textContent = number(scoreText(state.scores[1]));
    $("rope-marker").style.left = `${50 - rope() * 50}%`;
  } else {
    // The boss's HP bar goes yellow at half and red at a fifth; near the end it pants.
    const left = state.bossMax ? state.bossHp / state.bossMax : 1;
    $("boss-hp-fill").style.width = `${left * 100}%`;
    $("boss-hp-fill").parentElement.className = `hp-bar${left <= .2 ? " low" : left <= .5 ? " mid" : ""}`;
    $("boss-hp-label").textContent = `${Math.ceil(state.bossHp)} / ${state.bossMax}`;
    $("boss-sprite").classList.toggle("weak", left > 0 && left <= .25);
    renderMoves();
    renderHearts(state.hearts);
    $("combo-value").innerHTML = `${state.combo} <small>×${comboMultiplier().toFixed(1)}</small>`;
  }
  if (online()) updateTileNames();
  else {
    $("p1-reps").textContent = number(state.trackers[0].reps);
    $("p2-reps").textContent = number(state.trackers[1].reps);
  }
  $("frenzy-banner").hidden = duel || !isFrenzy();
  renderCallout();
}

// The move box names each local player's move in big letters, with "FROZEN" during
// Strike a Pose. It only rebuilds when something changes, so a new move pops in.
function renderMoves() {
  const box = $("move-box"), trackers = localTrackers(), many = trackers.length > 1;
  const key = trackers.map((t) => `${t.exercise}:${Boolean(t.pose)}`).join();
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren(...trackers.map((t, i) => {
    const row = document.createElement("div");
    row.className = "move-row";
    row.innerHTML = `<span class="${many ? `p${i + 1}` : ""}">${many ? `P${i + 1}` : online() ? "Your move" : "Move"}</span>`
      + `<strong>${t.exercise ? NAMES[t.exercise] : "—"}</strong>${t.pose ? "<em>Frozen</em>" : ""}`;
    return row;
  }));
}
// Full-screen callouts for the player who has to act, big enough to read from across
// the room: a move switch shows for a moment, and Strike a Pose
// stays up with a hold bar until the pose is struck or the spell wears off.
// Only this device's players get them; a pose outranks a switch.
const callout = { who: "", move: "", until: 0, timer: 0 };
export function showSwitchCallout(who, move, until) {
  Object.assign(callout, { who, move, until });
  clearTimeout(callout.timer);
  callout.timer = setTimeout(renderCallout, Math.max(0, until - performance.now()) + 50);
  renderCallout();
}
export function hideCallout() {
  clearTimeout(callout.timer);
  callout.until = 0;
  $("callout").hidden = true;
}
function renderCallout() {
  const box = $("callout"), now = performance.now();
  const playing = state.status === "playing";
  const many = localTrackers().length > 1;
  const posing = playing ? localTrackers().map((t, i) => ({ t, i })).filter(({ t }) => t.pose) : [];
  if (posing.length) {
    box.className = `callout pose${posing.length > 1 ? " multi" : ""}`;
    $("callout-label").textContent = "Strike a pose";
    $("callout-title").textContent = posing.map(({ t, i }) => `${many ? `P${i + 1}: ` : ""}${POSES[t.pose].name}`).join("  ·  ");
    $("callout-hint").textContent = posing.length === 1 ? POSES[posing[0].t.pose].hint : "";
    const held = Math.max(...posing.map(({ t }) => t.poseHeld ? (now - t.poseHeld) / POSE_HOLD : 0));
    $("callout-hold").hidden = false;
    $("callout-hold-fill").style.width = `${Math.min(100, held * 100)}%`;
  } else if (playing && now < callout.until) {
    box.className = "callout switch";
    $("callout-label").textContent = `${callout.who}Switch to`;
    $("callout-title").textContent = callout.move;
    $("callout-hint").textContent = "";
    $("callout-hold").hidden = true;
  } else {
    box.hidden = true;
    return;
  }
  box.hidden = false;
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
