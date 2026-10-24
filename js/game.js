/* The fight loop: scoring reps, boss phases and attacks, the clock, and results. */

import { positionLabels, prepareCamera, stopMedia } from "./camera.js";
import { BOSSES, DUEL_TIME, feedback, HEARTS, NAMES, PARRY_WINDOW, points, ROMAN, TIPS } from "./config.js";
import { broadcastState } from "./party.js";
import { boss, comboMultiplier, isFrenzy, isGuest, isHost, newTracker, number, playerCount, progress, resetMotion, rope, saveProgress, scoreText, solo, state, streakMultiplier, teamMode } from "./state.js";
import { $, clearAlert, confetti, flashAndShake, floatText, fx, renderSprite, setResults, show, sound, updateHud } from "./ui.js";

export function recordRep(index, quality, amount = 1, fromCamera = true) {
  if (state.status !== "playing") return;
  const now = performance.now();
  const player = state.trackers[index];
  if (!player || (fromCamera && now - player.lastRepAt < 400)) return;
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
    const earned = points[quality] * streakMultiplier(player.streak);
    state.scores[index] = scoreText(state.scores[index] + earned);
    floatText(index, `${feedback[quality]} +${number(scoreText(earned))}`, quality === "bad" ? "bad" : "");
    updateHud();
    if (Math.abs(rope()) >= 1) finishRound();
    return;
  }

  // Rep damage uses the combo that was active as this rep began.
  const earned = points[quality] * comboMultiplier() * (isFrenzy(now) ? 2 : 1);
  let damage = earned;
  fx("sound", "hit");
  fx("floatText", index, `${feedback[quality]} +${number(scoreText(earned))}`, quality === "bad" ? "bad" : "");
  if (state.attack) {
    state.attack = null;
    state.parries++;
    state.nextAttackAt = now + boss().attackEvery;
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
  if (state.bossHp <= 0) { finishRound(true); return; }
  const count = boss().phases.length;
  const phase = Math.min(count - 1, Math.floor((1 - state.bossHp / state.bossMax) * count));
  if (phase > state.phase) beginPhase(phase);
}

// A new phase pauses scoring and the clock so players can change position.
function beginPhase(index) {
  const session = state.session;
  state.phase = index;
  state.exercise = boss().phases[index];
  state.status = "transition";
  state.attack = null;
  state.lastEvents = state.lastEvents.map(() => null);
  state.trackers.forEach(resetMotion);
  $("pose-tip").textContent = TIPS[state.exercise];
  fx("showAlert", `PHASE ${index + 1} · ${NAMES[state.exercise].toUpperCase()}!`, "phase");
  fx("sound", "warn");
  updateHud();
  clearTimeout(state.transitionTimer);
  state.transitionTimer = setTimeout(() => {
    if (session !== state.session || state.status !== "transition") return;
    const now = performance.now();
    state.status = "playing";
    state.nextAttackAt = now + boss().attackEvery;
    state.trackers.forEach((t) => { t.lastEventAt = now; });
    fx("clearAlert");
  }, ["plank", "pushups"].includes(state.exercise) ? 5000 : 3000);
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
  state.nextAttackAt = now + boss().attackEvery;
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
  state.scores = [0, 0]; state.phase = 0; state.hearts = HEARTS;
  state.attack = null; state.parries = 0; state.partyReps = [];
  if (duel) state.duration = DUEL_TIME;
  else {
    const b = boss();
    state.exercise = b.phases[0];
    state.bossMax = b.hp * playerCount();
    state.bossHp = state.bossMax;
    state.duration = b.time * 1000;
    renderSprite($("boss-sprite"), b);
    $("boss-taunt").textContent = `“${b.taunt}”`;
    $("phase-pips").replaceChildren(...b.phases.map((exercise) => {
      const pip = document.createElement("span");
      pip.title = NAMES[exercise];
      return pip;
    }));
  }
  state.lastVideoTime = -1;
  state.lastFrameAt = 0;
  $("time-value").textContent = String(state.duration / 1000);
  $("mode-label").textContent = state.mode === "story" ? `STORY · CHAPTER ${ROMAN[state.bossIndex]}`
    : party ? `REMOTE PARTY · ${playerCount()} PLAYER${playerCount() === 1 ? "" : "S"}` : state.mode === "coop" ? "CO-OP BOSS" : "1V1 DUEL";
  $("game-title").textContent = duel ? NAMES[state.exercise] : boss().name;
  $("lobby").hidden = true;
  $("timer").hidden = false;
  $("arena").hidden = duel;
  $("duel-hud").hidden = !duel;
  $("combo-box").hidden = !teamMode();
  $("players-bar").hidden = party;
  $("shared-mark").textContent = duel ? "✦ VERSUS ✦" : "✦ TEAM UP ✦";
  $("p2-score").hidden = solo();
  $("p2-label").hidden = solo();
  $("pose-tip").textContent = TIPS[state.exercise];
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
  clearTimeout(state.transitionTimer);
  state.tick = state.countdownTimer = state.transitionTimer = 0;
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
  if (state.mode !== "duel") state.nextAttackAt = start + boss().attackEvery;
  state.tick = setInterval(() => {
    if (session !== state.session) return;
    const now = performance.now();
    if (state.status === "transition") state.endAt += now - state.lastTickAt;
    state.lastTickAt = now;
    if (state.status === "playing") {
      $("time-value").textContent = String(Math.max(0, Math.ceil((state.endAt - now) / 1000)));
      if (state.combo && teamMode() && state.trackers.some((p) => now - p.lastEventAt > 4000)) {
        state.combo = 0;
        state.lastEvents = state.lastEvents.map(() => null);
      }
      if (state.mode !== "duel") bossAttack(now);
      updateHud();
      if (now >= state.endAt) finishRound(false);
    }
    if (isHost() && (state.status === "playing" || state.status === "transition")) broadcastState(now);
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
  state.advance = false;
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
    const story = state.mode === "story";
    const mvp = state.mode === "party" && state.roster.length > 1 ? partyMvp() : "";
    const finale = story && won && state.bossIndex === BOSSES.length - 1;
    if (story && won) { progress.cleared = Math.max(progress.cleared, state.bossIndex + 1); saveProgress(); }
    state.advance = story && won && !finale;
    const stars = Math.max(1, state.hearts);
    $("results-eyebrow").textContent = "THE BATTLE IS OVER";
    const result = [finale ? "The kingdom is saved!" : won ? `${b.name} is defeated!` : `${b.name} wins this time`,
      (finale ? "The storybook is complete. The End." : won ? b.victory : state.hearts ? "Time ran out. Catch your breath and try again." : "You ran out of hearts. Catch your breath and try again.") + mvp,
      won ? "★".repeat(stars) + "☆".repeat(HEARTS - stars) : "DEFEATED", won ? (state.hearts === HEARTS ? "gold" : "silver") : "bronze",
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
  $("again-button").textContent = state.mode === "duel" ? "Rematch" : state.advance ? "Next Chapter" : won ? "Fight Again" : "Try Again";
  $("map-button").hidden = state.mode === "duel";
  $("map-button").textContent = state.mode === "story" ? "Storybook" : party ? "Party Lobby" : "Choose Boss";
  $("menu-button").textContent = party ? "Leave Party" : "Main Menu";
}
function partyMvp() {
  let best = 0;
  state.trackers.forEach((t, i) => { if (t.reps > state.trackers[best].reps) best = i; });
  const name = state.roster[best]?.name;
  return name ? ` MVP: ${name} with ${number(state.trackers[best].reps)} reps.` : "";
}

export function showBosses() {
  const story = state.mode === "story";
  $("bosses-eyebrow").textContent = story ? "THE STORYBOOK" : "CO-OP BOSS";
  $("bosses-title").textContent = story ? "Choose your chapter" : "Pick a boss to battle";
  $("bosses-note").textContent = story
    ? `${progress.cleared} of ${BOSSES.length} chapters cleared. Defeat each boss to turn the page.`
    : "Two players, one camera. Bosses have double health, so sync your reps to hit harder.";
  $("boss-grid").replaceChildren(...BOSSES.map((b, i) => {
    const locked = story && i > progress.cleared;
    const cleared = story && i < progress.cleared;
    const card = document.createElement("button");
    card.type = "button";
    card.className = `boss-card${cleared ? " cleared" : ""}`;
    card.disabled = locked;
    card.innerHTML = `<span class="sprite"></span><span class="boss-chapter">${locked ? "🔒 LOCKED" : `CHAPTER ${ROMAN[i]}${cleared ? " · CLEARED" : ""}`}</span>`
      + `<strong>${b.name}</strong><span class="boss-story">${b.story}</span>`
      + `<span class="chips">${b.phases.map((exercise) => `<em>${NAMES[exercise]}</em>`).join("")}</span>`;
    renderSprite(card.querySelector(".sprite"), b);
    card.addEventListener("click", () => { state.bossIndex = i; startGame(); });
    return card;
  }));
  show("bosses");
}
