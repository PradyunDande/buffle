/* The fight loop: scoring reps, boss move calls and attacks, the clock, and results. */

import { positionLabels, prepareCamera, stopMedia } from "./camera.js";
import { BOSSES, COMMANDS, DIFFICULTIES, DUEL_TIME, feedback, HEARTS, NAMES, points, POSE_HOLD, POSE_LINES, POSE_TIMEOUT, POSES, REP_GAP, REP_VALUE, SWITCH_CALLOUT } from "./config.js";
import { broadcastState } from "./party.js";
import { activeTrackers, localTrackers, boss, comboMultiplier, difficulty, isFrenzy, isGuest, isHost, newTracker, number, online, playerCount, playerName, resetMotion, rope, saveSettings, scoreText, settings, solo, state, streakMultiplier, teamMode } from "./state.js";
import { $, clearAlert, confetti, flashAndShake, fx, hideCallout, renderSprite, resetSpeech, setResults, show, showAlert, showSwitchCallout, sound, updateHud, updateTip } from "./ui.js";

export function recordRep(index, quality, amount = 1, fromCamera = true) {
  if (state.status !== "playing") return;
  const now = performance.now();
  const player = state.trackers[index];
  // A player frozen by Strike a Pose can't attack until they strike it.
  if (!player || player.pose || (fromCamera && now - player.lastRepAt < (REP_GAP[player.exercise] ?? 400))) return;
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
  if (quality === "bad" && (!online() || index === state.myIndex)) flashAndShake("shake");

  if (state.mode === "duel") {
    fx("sound", "hit");
    // A run of clean reps raises that player's multiplier; any other rep resets it.
    player.streak = quality === "clean" ? player.streak + 1 : 0;
    const earned = points[quality] * (REP_VALUE[player.exercise] ?? 1) * streakMultiplier(player.streak);
    state.scores[index] = scoreText(state.scores[index] + earned);
    fx("floatText", index, `${feedback[quality]} +${number(scoreText(earned))}`, quality === "bad" ? "bad" : "");
    updateHud();
    if (Math.abs(rope()) >= 1) finishRound();
    return;
  }

  // Rep damage uses the combo that was active as this rep began.
  const earned = points[quality] * (REP_VALUE[player.exercise] ?? 1) * comboMultiplier() * (isFrenzy(now) ? 2 : 1);
  let damage = earned;
  fx("sound", "hit");
  fx("floatText", index, `${feedback[quality]} +${number(scoreText(earned))}`, quality === "bad" ? "bad" : "");

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
// The boss calls a new move for one player; it counts from the next rep. In 1v1
// both players get the same move, so `move` is picked once for both.
function switchMove(index, now, move = pickMove(state.trackers[index].exercise)) {
  const t = state.trackers[index];
  t.exercise = move;
  resetMotion(t);
  t.switchAt = now + randomBetween(difficulty().switchEvery);
  state.lastEvents[index] = null;
  const name = NAMES[t.exercise].toUpperCase();
  const duel = state.mode === "duel";
  if (!duel) {
    const line = boss().lines[Math.floor(Math.random() * boss().lines.length)];
    fx("bossSay", line.replace("{name}", () => playerName(index)).replace("{command}", () => COMMANDS[t.exercise]));
  }
  fx("floatText", index, `${name}!`, "sync");
  // Guests announce their own switches when the next state update arrives.
  if (duel ? index === 0 : !online() || index === state.myIndex) {
    fx("sound", "warn");
    showSwitchCallout(solo() || duel ? "" : `P${index + 1} · `, NAMES[t.exercise], now + SWITCH_CALLOUT);
  }
  updateTip();
}
function scheduleMoves(now) {
  if (state.mode === "duel") {
    // Duelists share one timer and always switch together.
    const [first, second] = state.trackers;
    if (now < first.switchAt) return;
    const move = pickMove(first.exercise);
    switchMove(0, now, move);
    switchMove(1, now, move);
    second.switchAt = first.switchAt;
    return;
  }
  activeTrackers().forEach((t, i) => { if (now >= t.switchAt && !t.pose) switchMove(i, now); });
}

// Strike a Pose. Each player gets frozen on their own random timer, never while
// down on the floor for push-ups or a plank.
function schedulePoses(now) {
  const every = difficulty().poseEvery;
  activeTrackers().forEach((t, i) => {
    if (t.pose) {
      if (now >= t.poseUntil) endPose(i, now, false);
      return;
    }
    if (t.poseAt === Infinity) t.poseAt = now + randomBetween(every);
    if (now < t.poseAt) return;
    if (t.exercise === "plank" || t.exercise === "pushups") { t.poseAt = now + 4000; return; }
    startPose(i, now);
  });
}
function startPose(index, now) {
  const t = state.trackers[index];
  const keys = Object.keys(POSES);
  t.pose = keys[Math.floor(Math.random() * keys.length)];
  t.poseUntil = now + POSE_TIMEOUT;
  t.poseHeld = 0;
  resetMotion(t);
  const pose = POSES[t.pose].name;
  const line = POSE_LINES[Math.floor(Math.random() * POSE_LINES.length)];
  fx("bossSay", line.replace("{name}", () => playerName(index)).replace("{pose}", () => pose));
  fx("floatText", index, "FROZEN!", "bad");
  fx("sound", "warn");
  // The full-screen pose callout follows the frozen state on the player's own device.
  updateHud();
}
// `struck` is false when the spell simply wore off.
function endPose(index, now, struck) {
  const t = state.trackers[index];
  t.pose = null;
  t.poseHeld = 0;
  t.poseAt = now + randomBetween(difficulty().poseEvery);
  fx("floatText", index, struck ? "NICE POSE!" : "SPELL WORE OFF", struck ? "sync" : "");
  if (struck) fx("sound", "sync");
  if (!online() || index === state.myIndex) showAlert(struck ? "NICE POSE!" : "THE SPELL WORE OFF", struck ? "good" : "phase", 1200);
  updateHud();
}
// Called every camera frame for a frozen player: holding the pose for POSE_HOLD
// strikes it. A guest tells the host, which keeps everyone's state.
export function trackPose(index, matched, now) {
  const t = state.trackers[index];
  if (!t?.pose || state.status !== "playing") return;
  if (!matched) { t.poseHeld = 0; return; }
  t.poseHeld ||= now;
  if (now - t.poseHeld < POSE_HOLD) return;
  if (isGuest()) {
    if (!t.poseSent) { t.poseSent = true; state.party.send({ t: "posed" }); }
    return;
  }
  endPose(index, now, true);
}
export function strikePoseFor(index) {
  if (state.trackers[index]?.pose && state.status === "playing") endPose(index, performance.now(), true);
}

// Boss attacks always land: each one costs the team a heart.
function bossAttack(now) {
  if (now < state.nextAttackAt) return;
  state.hearts--;
  state.nextAttackAt = now + difficulty().attackEvery;
  const left = state.hearts ? ` ${state.hearts} heart${state.hearts === 1 ? "" : "s"} left` : "";
  fx("showAlert", `${boss().attack}!${left}`, "danger", 2000);
  fx("flashAndShake", "lunge", "boss-sprite");
  fx("flashAndShake", "shake");
  fx("sound", "hurt");
  if (state.hearts <= 0) finishRound(false);
}

export function resetRound() {
  const duel = state.mode === "duel", party = online();
  // A party host keeps one tracker per player, in roster order; it is player 0.
  state.trackers = Array.from({ length: party ? playerCount() : 2 }, newTracker);
  state.combo = 0; state.bestCombo = 0;
  state.frenzyUntil = 0; state.cleanEvents = 0; state.repEvents = 0;
  state.lastEvents = state.trackers.map(() => null); state.endAt = 0;
  state.scores = [0, 0]; state.hearts = HEARTS;
  state.partyReps = []; state.partyMoves = [];
  if (duel) {
    state.duration = DUEL_TIME;
    const move = pickMove(null);
    state.trackers.forEach((t) => { t.exercise = move; t.switchAt = Infinity; });
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
  $("mode-label").textContent = duel ? `${party ? "ONLINE " : ""}1V1 SCUFFLE · ${difficulty().name.toUpperCase()}`
    : `${party ? "ONLINE · " : ""}${difficulty().name.toUpperCase()} · ${state.mode === "solo" ? "SOLO" : players}`;
  $("game-title").textContent = duel ? NAMES[state.trackers[0].exercise] : boss().name;
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
    $("camera-placeholder").textContent = "Preparing the camera…";
  }
  $("game-error").hidden = true;
  $("countdown").hidden = true;
  $("framing").hidden = true;
  clearAlert();
  updateHud();
  positionLabels();
}

// A party keeps its cameras running between rounds; leaving the party stops them.
export function stopRound() {
  state.session++;
  clearInterval(state.tick);
  clearInterval(state.countdownTimer);
  clearTimeout(state.lobbyTimer);
  state.tick = state.countdownTimer = state.lobbyTimer = 0;
  if (!online()) stopMedia();
  clearAlert();
  hideCallout();
  state.status = "idle";
}

export function beginCountdown(session) {
  if (session !== state.session || state.status !== "loading") return;
  state.status = "countdown";
  $("game-error").hidden = true;
  const box = $("countdown"), value = $("countdown-value");
  // The countdown fills the screen with each local player's first move.
  const moves = localTrackers().map((t) => t.exercise);
  const many = new Set(moves).size > 1;
  $("countdown-move").textContent = many ? moves.map((move, i) => `P${i + 1}: ${NAMES[move] ?? "—"}`).join("  ·  ") : NAMES[moves[0]] ?? "";
  box.classList.toggle("multi", many);
  box.hidden = false;
  let count = 3;
  value.textContent = String(count);
  state.countdownTimer = setInterval(() => {
    if (session !== state.session) { clearInterval(state.countdownTimer); return; }
    count--;
    if (count > 0) { value.textContent = String(count); sound("hit"); return; }
    if (count === 0) { value.textContent = state.mode === "duel" ? "GO!" : "FIGHT!"; sound("sync"); if (!isGuest()) startClock(session); return; }
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
  if (state.mode === "duel") {
    const switchAt = start + randomBetween(difficulty().switchEvery);
    state.trackers.forEach((t) => { t.switchAt = switchAt; });
  } else {
    state.nextAttackAt = start + difficulty().attackEvery;
    activeTrackers().forEach((t) => { t.switchAt = start + randomBetween(difficulty().switchEvery); });
  }
  state.tick = setInterval(() => {
    if (session !== state.session || state.status !== "playing") return;
    const now = performance.now();
    const bossFight = state.mode !== "duel";
    state.lastTickAt = now;
    $("time-value").textContent = String(Math.max(0, Math.ceil((state.endAt - now) / 1000)));
    if (state.combo && teamMode() && activeTrackers().some((p) => now - p.lastEventAt > 4000)) {
      state.combo = 0;
      state.lastEvents = state.lastEvents.map(() => null);
    }
    scheduleMoves(now);
    if (bossFight) {
      schedulePoses(now);
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
  prepareCamera();
}

function finishRound(won = false) {
  if (state.status !== "playing") return;
  const reps = number(state.trackers.reduce((sum, p) => sum + p.reps, 0));
  const clean = `${state.repEvents ? Math.round(state.cleanEvents / state.repEvents * 100) : 0}%`;
  stopRound();
  let result;
  if (state.mode === "duel") {
    const [a, b] = state.scores;
    const knockout = Math.abs(rope()) >= 1;
    const [first, second] = [playerName(0), playerName(1)];
    result = [a === b ? "It's a draw!" : `${a > b ? first : second} wins!`,
      knockout ? "Pulled clean across the line!" : "Time! The higher score takes the crown.",
      a === b ? "DRAW" : knockout ? "KNOCKOUT" : "DECISION", a === b ? "silver" : "gold",
      [[first.toUpperCase(), number(scoreText(a))], [second.toUpperCase(), number(scoreText(b))], ["TOTAL REPS", reps], ["CLEAN REPS", clean]]];
    won = a !== b;
  } else {
    const b = boss();
    const mvp = state.mode === "party" && state.roster.length > 1 ? partyMvp() : "";
    result = [won ? `${b.name} is defeated!` : `${b.name} wins this time`,
      (won ? b.victory : state.hearts ? "Time ran out. Catch your breath and try again." : "You ran out of hearts. Catch your breath and try again.") + mvp,
      // Rank by hearts left: all five is S, three or four A, otherwise B.
      won ? `${state.hearts === HEARTS ? "S" : state.hearts >= 3 ? "A" : "B"} RANK` : "DEFEATED", won ? (state.hearts === HEARTS ? "gold" : "silver") : "bronze",
      [["DAMAGE", `${number(scoreText(state.bossMax - state.bossHp))} / ${state.bossMax}`], ["TOTAL REPS", reps], ["CLEAN REPS", clean],
        teamMode() ? ["BEST COMBO", String(state.bestCombo)] : ["HEARTS LEFT", `${state.hearts} / ${HEARTS}`]]];
  }
  setResults(...result);
  if (isHost()) state.party.broadcast({ t: "results", result, won });
  setResultActions(won);
  show("results");
  if (won) { sound("victory"); confetti(); }
}
export function setResultActions(won) {
  const party = online(), duel = state.mode === "duel";
  // In an online 1v1 either player can ask for a rematch; in a party only the host starts.
  $("again-button").hidden = isGuest() && !duel;
  $("again-button").textContent = duel ? "Rematch" : won ? "Scuffle Again" : "Try Again";
  $("map-button").hidden = duel;
  $("map-button").textContent = party ? "Party Lobby" : "Change Setup";
  $("menu-button").textContent = !party ? "Main Menu" : duel ? "Leave Match" : "Leave Party";
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
  renderDifficulties("difficulty-choice", showSetup);
  if (state.screen !== "setup") show("setup");
}
// 1v1 Scuffle only asks for a difficulty: it sets which moves come up and how often.
export function showDuelSetup() {
  renderDifficulties("duel-difficulty", showDuelSetup);
  if (state.screen !== "exercise") show("exercise");
}
function renderDifficulties(id, refresh) {
  $(id).replaceChildren(...Object.entries(DIFFICULTIES).map(([key, level], i) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `choice difficulty${key === state.difficulty ? " selected" : ""}`;
    card.innerHTML = `<strong>${level.name}</strong>${difficultyPips(i + 1)}${moveList(level)}`;
    card.addEventListener("click", () => { state.difficulty = settings.difficulty = key; saveSettings(); refresh(); });
    return card;
  }));
}
// The moves a difficulty can call, in the order they're listed in its config.
export function moveList(level) {
  return `<ul class="move-list">${level.moves.map((move) => `<li>${NAMES[move]}</li>`).join("")}</ul>`;
}
export function difficultyPips(level) {
  return `<span class="pips" data-level="${level}" aria-hidden="true"><i></i><i></i><i></i></span>`;
}
export function setPlayers(count) {
  settings.players = count;
  saveSettings();
  showSetup();
}
