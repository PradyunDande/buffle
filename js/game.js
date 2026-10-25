/* The fight loop: scoring reps, boss move calls and attacks, the clock, and results. */

import { positionLabels, prepareCamera, stopMedia } from "./camera.js";
import { BOSSES, COMMANDS, DIFFICULTIES, DUEL_TIME, feedback, HEARTS, NAMES, PARRY_WINDOW, points, REP_GAP, REP_VALUE, SWITCH_PAUSE } from "./config.js";
import { broadcastState } from "./party.js";
import { activeTrackers, boss, comboMultiplier, difficulty, isFrenzy, isGuest, isHost, newTracker, number, playerCount, playerName, resetMotion, rope, saveSettings, scoreText, settings, solo, state, streakMultiplier, teamMode } from "./state.js";
import { $, clearAlert, confetti, flashAndShake, floatText, fx, renderSprite, resetSpeech, setResults, show, showAlert, sound, updateHud, updateTip } from "./ui.js";

export function recordRep(index, quality, amount = 1, fromCamera = true) {
  if (state.status !== "playing") return;
  const now = performance.now();
  const player = state.trackers[index];
  if (!player || now < player.readyAt || (fromCamera && now - player.lastRepAt < (REP_GAP[player.exercise] ?? 400))) return;
  player.lastRepAt = now;
  if (isGuest()) {
    // The host keeps score; a guest only reports its own reps.
    if (quality === "bad") flashAndShake("shake");
    state.party.send({ t: "rep", quality, amount });
    return;
  }
  player.lastEventAt = now;
  player.reps += amount;
  player.form = quality.toUpperCase();
  state.repEvents++;
  if (quality === "clean") state.cleanEvents++;
  if (quality === "bad" && (state.mode !== "party" || index === state.myIndex)) flashAndShake("shake");

  if (state.mode === "duel") {
    sound("hit");
    // A run of clean reps raises that player's multiplier; any other rep resets it.
    player.streak = quality === "clean" ? player.streak + 1 : 0;
    const earned = points[quality] * (REP_VALUE[player.exercise] ?? 1) * streakMultiplier(player.streak);
    state.scores[index] = scoreText(state.scores[index] + earned);
    floatText(index, `${feedback[quality]} +${number(scoreText(earned))}`, quality === "bad" ? "bad" : "");
    updateHud();
    if (Math.abs(rope()) >= 1) finishRound();
    return;
  }

  // Rep damage uses the combo that was active as this rep began.
  const earned = points[quality] * (REP_VALUE[player.exercise] ?? 1) * comboMultiplier() * (isFrenzy(now) ? 2 : 1);
  let damage = earned;
  fx("sound", "hit");
  fx("floatText", index, `${feedback[quality]} +${number(scoreText(earned))}`, quality === "bad" ? "bad" : "");
  if (state.attack) {
    state.attack = null;
    state.parries++;
    state.nextAttackAt = now + difficulty().attackEvery;
    damage += 2;
    fx("floatText", index, "PARRY! +2", "sync");
    fx("showAlert", "PARRIED!", "good", 1200);
  }

  // A rep syncs with any other player's unpaired rep from the last 700ms.
  const partner = state.lastEvents.find((e, i) => i !== index && e && !e.paired && now - e.at <= 700);
  const event = { at: now, paired: false };
  state.lastEvents[index] = event;
  if (teamMode() && partner) {
    event.paired = partner.paired = true;
    state.combo++;
    state.bestCombo = Math.max(state.bestCombo, state.combo);
    if (state.combo % 5 === 0) state.frenzyUntil = now + 5000;
    const bonus = 3 * (isFrenzy(now) ? 2 : 1);
    damage += bonus;
    fx("floatText", index, `SYNC! +${bonus}`, "sync");
    fx("confetti");
    fx("flashAndShake", "flash");
    fx("sound", "sync");
  }
  hitBoss(damage);
}

function hitBoss(amount) {
  state.bossHp = Math.max(0, scoreText(state.bossHp - amount));
  fx("flashAndShake", "hit", "boss-sprite");
  updateHud();
  if (state.bossHp <= 0) finishRound(true);
}

const randomBetween = ([min, max]) => min + Math.random() * (max - min);
function pickMove(current) {
  const options = difficulty().moves.filter((move) => move !== current);
  return options.length ? options[Math.floor(Math.random() * options.length)] : current;
}
// The boss calls a new move for one player. Only that player's reps pause while
// they change position; everyone else keeps fighting.
function switchMove(index, now) {
  const t = state.trackers[index];
  t.exercise = pickMove(t.exercise);
  resetMotion(t);
  t.readyAt = now + (SWITCH_PAUSE[t.exercise] ?? 3000);
  t.switchAt = t.readyAt + randomBetween(difficulty().switchEvery);
  state.lastEvents[index] = null;
  const name = NAMES[t.exercise].toUpperCase();
  const line = boss().lines[Math.floor(Math.random() * boss().lines.length)];
  fx("bossSay", line.replace("{name}", () => playerName(index)).replace("{command}", () => COMMANDS[t.exercise]));
  fx("floatText", index, `${name}!`, "sync");
  fx("sound", "warn");
  // Guests announce their own switches when the next state update arrives.
  if (state.mode !== "party" || index === state.myIndex) {
    showAlert(solo() ? `SWITCH TO ${name}!` : `P${index + 1}: SWITCH TO ${name}!`, "phase", t.readyAt - now);
  }
  updateTip();
}
function scheduleMoves(now) {
  if (state.attack) return;
  activeTrackers().forEach((t, i) => { if (now >= t.switchAt) switchMove(i, now); });
}

function bossAttack(now) {
  if (!state.attack) {
    if (now < state.nextAttackAt) return;
    state.attack = { until: now + PARRY_WINDOW };
    fx("showAlert", `${boss().attack}! Keep moving to parry!`, "danger");
    fx("sound", "warn");
    return;
  }
  if (now < state.attack.until) return;
  state.attack = null;
  state.hearts--;
  state.nextAttackAt = now + difficulty().attackEvery;
  fx("showAlert", state.hearts ? `OUCH! ${state.hearts} heart${state.hearts === 1 ? "" : "s"} left` : "OUCH!", "danger", 1400);
  fx("flashAndShake", "shake");
  fx("sound", "hurt");
  if (state.hearts <= 0) finishRound(false);
}

export function resetRound() {
  const duel = state.mode === "duel", party = state.mode === "party";
  // A party host keeps one tracker per player, in roster order; it is player 0.
  state.trackers = Array.from({ length: party ? playerCount() : 2 }, newTracker);
  state.combo = 0; state.bestCombo = 0;
  state.frenzyUntil = 0; state.cleanEvents = 0; state.repEvents = 0;
  state.lastEvents = state.trackers.map(() => null); state.endAt = 0;
  state.scores = [0, 0]; state.hearts = HEARTS;
  state.attack = null; state.parries = 0; state.partyReps = []; state.partyMoves = [];
  if (duel) {
    state.duration = DUEL_TIME;
    state.trackers.forEach((t) => { t.exercise = state.exercise; t.switchAt = Infinity; });
  } else {
    const b = boss(), level = difficulty();
    // Everyone starts on a random move; the host assigns guests theirs.
    if (!isGuest()) activeTrackers().forEach((t) => { t.exercise = pickMove(null); t.switchAt = Infinity; });
    state.bossMax = level.hp * playerCount();
    state.bossHp = state.bossMax;
    state.duration = level.time * 1000;
    renderSprite($("boss-sprite"), b);
    resetSpeech(b.taunt);
  }
  state.lastVideoTime = -1;
  state.lastFrameAt = 0;
  $("time-value").textContent = String(state.duration / 1000);
  const players = `${playerCount()} PLAYER${playerCount() === 1 ? "" : "S"}`;
  $("mode-label").textContent = duel ? "1V1 DUEL"
    : `${party ? "REMOTE PARTY · " : ""}${difficulty().name.toUpperCase()} · ${state.mode === "solo" ? "SOLO" : players}`;
  $("game-title").textContent = duel ? NAMES[state.exercise] : boss().name;
  $("lobby").hidden = true;
  $("timer").hidden = false;
  $("arena").hidden = duel;
  $("duel-hud").hidden = !duel;
  $("combo-box").hidden = !teamMode();
  $("players-bar").hidden = party;
  $("shared-mark").textContent = duel ? "Versus" : "Team";
  $("p2-score").hidden = solo();
  $("p2-label").hidden = solo();
  updateTip();
  $("waiting").hidden = true;
  if (!state.stream) {
    $("camera-placeholder").hidden = false;
    $("camera-placeholder").textContent = state.keyboardOnly ? "Hotkey mode — press 1 or Q" : "Preparing the camera…";
  }
  $("game-error").hidden = true;
  $("countdown").hidden = true;
  clearAlert();
  updateHud();
  positionLabels();
}

// A party keeps its cameras running between rounds; leaving the party stops them.
export function stopRound() {
  state.session++;
  clearInterval(state.tick);
  clearInterval(state.countdownTimer);
  state.tick = state.countdownTimer = 0;
  if (state.mode !== "party") stopMedia();
  clearAlert();
  state.status = "idle";
}

export function beginCountdown(session) {
  if (session !== state.session || state.status !== "loading") return;
  state.status = "countdown";
  $("game-error").hidden = true;
  const box = $("countdown");
  box.hidden = false;
  let count = 3;
  box.textContent = String(count);
  state.countdownTimer = setInterval(() => {
    if (session !== state.session) { clearInterval(state.countdownTimer); return; }
    count--;
    if (count > 0) { box.textContent = String(count); sound("hit"); return; }
    if (count === 0) { box.textContent = state.mode === "duel" ? "GO!" : "FIGHT!"; sound("sync"); if (!isGuest()) startClock(session); return; }
    box.hidden = true;
    clearInterval(state.countdownTimer);
    state.countdownTimer = 0;
  }, 1000);
}
function startClock(session) {
  if (session !== state.session || state.status !== "countdown") return;
  const start = performance.now();
  state.status = "playing";
  state.endAt = start + state.duration;
  state.lastTickAt = start;
  if (state.mode !== "duel") {
    state.nextAttackAt = start + difficulty().attackEvery;
    activeTrackers().forEach((t) => { t.switchAt = start + randomBetween(difficulty().switchEvery); });
  }
  state.tick = setInterval(() => {
    if (session !== state.session || state.status !== "playing") return;
    const now = performance.now();
    const bossFight = state.mode !== "duel";
    // While every player is changing position, the clock and the boss wait.
    if (bossFight && activeTrackers().every((t) => now < t.readyAt)) {
      state.endAt += now - state.lastTickAt;
      state.nextAttackAt += now - state.lastTickAt;
    }
    state.lastTickAt = now;
    $("time-value").textContent = String(Math.max(0, Math.ceil((state.endAt - now) / 1000)));
    if (state.combo && teamMode() && activeTrackers().some((p) => now - p.lastEventAt > 4000)) {
      state.combo = 0;
      state.lastEvents = state.lastEvents.map(() => null);
    }
    if (bossFight) {
      scheduleMoves(now);
      bossAttack(now);
      if (state.status !== "playing") return;
    }
    updateHud();
    if (isHost()) broadcastState(now);
    if (now >= state.endAt) finishRound(false);
  }, 100);
}

export function startGame() {
  stopRound();
  resetRound();
  show("game");
  state.status = "loading";
  state.keyboardOnly = false;
  prepareCamera();
}

function finishRound(won = false) {
  if (state.status !== "playing") return;
  const reps = number(state.trackers.reduce((sum, p) => sum + p.reps, 0));
  const clean = `${state.repEvents ? Math.round(state.cleanEvents / state.repEvents * 100) : 0}%`;
  stopRound();
  if (state.mode === "duel") {
    const [a, b] = state.scores;
    const knockout = Math.abs(rope()) >= 1;
    $("results-eyebrow").textContent = "THE DUEL IS OVER";
    setResults(a === b ? "It's a draw!" : `Player ${a > b ? 1 : 2} wins!`,
      knockout ? "Pulled clean across the line!" : "Time! The higher score takes the crown.",
      a === b ? "DRAW" : `P${a > b ? 1 : 2} WINS`, a === b ? "silver" : "gold",
      [["P1 SCORE", number(scoreText(a))], ["P2 SCORE", number(scoreText(b))], ["TOTAL REPS", reps], ["CLEAN REPS", clean]]);
    won = a !== b;
  } else {
    const b = boss();
    const mvp = state.mode === "party" && state.roster.length > 1 ? partyMvp() : "";
    $("results-eyebrow").textContent = "THE BATTLE IS OVER";
    const result = [won ? `${b.name} is defeated!` : `${b.name} wins this time`,
      (won ? b.victory : state.hearts ? "Time ran out. Catch your breath and try again." : "You ran out of hearts. Catch your breath and try again.") + mvp,
      // Rank by hearts left: all three is S, then A, then B.
      won ? `${["B", "B", "A", "S"][state.hearts]} RANK` : "DEFEATED", won ? (state.hearts === HEARTS ? "gold" : "silver") : "bronze",
      [["DAMAGE", `${number(scoreText(state.bossMax - state.bossHp))} / ${state.bossMax}`], ["TOTAL REPS", reps], ["CLEAN REPS", clean],
        teamMode() ? ["BEST COMBO", String(state.bestCombo)] : ["PARRIES", String(state.parries)]]];
    setResults(...result);
    if (isHost()) state.party.broadcast({ t: "results", result, won });
  }
  setResultActions(won);
  show("results");
  if (won) { sound("victory"); confetti(); }
}
export function setResultActions(won) {
  const party = state.mode === "party";
  $("again-button").hidden = isGuest();
  $("again-button").textContent = state.mode === "duel" ? "Rematch" : won ? "Scuffle Again" : "Try Again";
  $("map-button").hidden = state.mode === "duel";
  $("map-button").textContent = party ? "Party Lobby" : "Change Setup";
  $("menu-button").textContent = party ? "Leave Party" : "Main Menu";
}
function partyMvp() {
  let best = 0;
  state.trackers.forEach((t, i) => { if (t.reps > state.trackers[best].reps) best = i; });
  const name = state.roster[best]?.name;
  return name ? ` MVP: ${name} with ${number(state.trackers[best].reps)} reps.` : "";
}

// A fight draws a random monster, never the same one twice in a row.
export function randomBoss() {
  const options = BOSSES.map((_, i) => i).filter((i) => i !== state.bossIndex);
  return options[Math.floor(Math.random() * options.length)];
}
export function startFight() {
  state.bossIndex = randomBoss();
  startGame();
}

// The Boss Fight setup asks how many people share the camera and how hard to go.
export function showSetup() {
  const players = settings.players === 2 ? 2 : 1;
  document.querySelectorAll("[data-players]").forEach((button) => {
    button.classList.toggle("selected", Number(button.dataset.players) === players);
  });
  $("p1-name").value = settings.name;
  $("p2-name").value = settings.name2;
  $("p2-name-field").hidden = players === 1;
  $("difficulty-choice").replaceChildren(...Object.entries(DIFFICULTIES).map(([key, level], i) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `choice difficulty${key === state.difficulty ? " selected" : ""}`;
    card.innerHTML = `<strong>${level.name}</strong>${difficultyPips(i + 1)}`;
    card.addEventListener("click", () => { state.difficulty = settings.difficulty = key; saveSettings(); showSetup(); });
    return card;
  }));
  if (state.screen !== "setup") show("setup");
}
export function difficultyPips(level) {
  return `<span class="pips" data-level="${level}" aria-hidden="true"><i></i><i></i><i></i></span>`;
}
export function setPlayers(count) {
  settings.players = count;
  saveSettings();
  showSetup();
}
