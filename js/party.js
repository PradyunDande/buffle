/* Remote party gameplay: lobby, roster, host-to-guest sync, and the camera grid. */

import { ensurePoseLoop, positionLabels, prepareCamera, stopMedia } from "./camera.js";
import { BOSSES, HEARTS, NAMES, points, TIPS } from "./config.js";
import { beginCountdown, recordRep, resetRound, setResultActions, stopRound } from "./game.js";
import { cleanCode, createParty, MAX_PLAYERS } from "./network.js";
import { boss, isHost, newTracker, number, playerCount, resetMotion, saveSettings, settings, state } from "./state.js";
import { $, confetti, EFFECTS, renderSprite, setResults, show, sound, toast, updateHud } from "./ui.js";

// Remote party: the host runs the fight and streams state to guests. Each guest
// tracks its own camera, reports reps, and mirrors the host's HUD and effects.
const validBoss = (index) => Number.isInteger(index) && index >= 0 && index < BOSSES.length;
function newParty() {
  const party = createParty({
    onRoster: (members) => { if (state.party === party) onRoster(members); },
    onMessage: (from, message) => { if (state.party === party) onPartyMessage(from, message); },
    onStream: (id, stream) => { if (state.party === party) { state.remoteStreams.set(id, stream); renderTiles(); } },
    onStreamEnd: (id) => { if (state.party === party) { state.remoteStreams.delete(id); renderTiles(); } },
    onClose: (reason) => { if (state.party === party) leaveParty(reason); },
    onError: (error) => { if (state.party === party) toast(error?.message || "Connection problem"); }
  });
  return party;
}
function setRemoteBusy(busy) {
  $("create-party").disabled = $("join-party").disabled = busy;
  $("create-party").textContent = busy ? "Connecting…" : "Create Party";
  $("join-party").textContent = busy ? "Connecting…" : "Join Party";
}
export async function openParty(join) {
  settings.name = $("player-name").value.trim().slice(0, 16);
  saveSettings();
  const code = cleanCode($("join-code").value);
  if (join && code.length !== 5) { toast("Enter the 5-character party code."); return; }
  stopRound();
  const party = newParty();
  Object.assign(state, { mode: "party", party, roster: [], bossIndex: 0, keyboardOnly: false });
  setRemoteBusy(true);
  try {
    if (join) await party.join(code, settings.name);
    else await party.create(settings.name);
  } catch (error) {
    party.leave();
    if (state.party === party) { state.party = null; state.mode = "story"; }
    toast(error?.message || "Could not connect to the party.");
    return;
  } finally { setRemoteBusy(false); }
  if (state.party === party) enterLobby();
}
export function leaveParty(message) {
  const party = state.party;
  state.party = null;
  party?.leave();
  stopRound();
  stopMedia();
  Object.assign(state, { mode: "story", roster: [], partyReps: [], keyboardOnly: false });
  state.remoteStreams.clear();
  renderTiles();
  $("players-bar").hidden = false;
  show("menu");
  if (message) toast(message);
}

function onRoster(members) {
  const before = state.roster;
  state.roster = members;
  state.myIndex = Math.max(0, members.findIndex((m) => m.id === state.party.id));
  if (state.party.isHost) {
    // Trackers follow players by id as people join and leave mid-fight.
    const old = new Map(before.map((m, i) => [m.id, i]));
    state.lastEvents = members.map((m) => (old.has(m.id) && state.lastEvents[old.get(m.id)]) || null);
    state.trackers = members.map((m) => (old.has(m.id) && state.trackers[old.get(m.id)]) || newTracker());
    state.party.broadcast({ t: "boss", bossIndex: state.bossIndex });
  }
  if (before.length) {
    const had = new Set(before.map((m) => m.id)), has = new Set(members.map((m) => m.id));
    members.filter((m) => !had.has(m.id)).forEach((m) => toast(`${m.name} joined the party`));
    before.filter((m) => !has.has(m.id)).forEach((m) => toast(`${m.name} left the party`));
  }
  renderTiles();
  renderLobby();
}
function onPartyMessage(from, message) {
  if (!message || typeof message !== "object") return;
  if (state.party.isHost) {
    // Guests can only report their own reps.
    const index = state.roster.findIndex((m) => m.id === from);
    if (message.t === "rep" && index > 0 && Object.hasOwn(points, message.quality) && (message.amount === 1 || message.amount === .5)) {
      recordRep(index, message.quality, message.amount, false);
    }
    return;
  }
  const inFight = state.screen === "game" && state.status !== "lobby";
  if (message.t === "boss" && validBoss(message.bossIndex)) { state.bossIndex = message.bossIndex; renderLobby(); }
  else if (message.t === "start" && validBoss(message.bossIndex)) startPartyFight(message.bossIndex);
  else if (message.t === "state" && inFight) applySnapshot(message);
  else if (message.t === "fx" && inFight && Object.hasOwn(EFFECTS, message.name) && Array.isArray(message.args)) EFFECTS[message.name](...message.args);
  else if (message.t === "results" && inFight) showPartyResults(message);
  else if (message.t === "lobby") enterLobby();
}
export function broadcastState(now) {
  state.party.broadcast({ t: "state", status: state.status, hp: state.bossHp, max: state.bossMax, phase: state.phase,
    exercise: state.exercise, hearts: state.hearts, attack: Boolean(state.attack), combo: state.combo,
    frenzy: Math.max(0, state.frenzyUntil - now), time: Math.max(0, Math.ceil((state.endAt - now) / 1000)),
    reps: state.trackers.map((t) => t.reps) });
}
function applySnapshot(snapshot) {
  if (snapshot.status !== "playing" && snapshot.status !== "transition") return;
  if (Object.hasOwn(NAMES, snapshot.exercise) && snapshot.exercise !== state.exercise) {
    state.exercise = snapshot.exercise;
    state.trackers.forEach(resetMotion);
    $("pose-tip").textContent = TIPS[state.exercise];
  }
  state.status = snapshot.status;
  state.bossHp = Number(snapshot.hp) || 0;
  state.bossMax = Number(snapshot.max) || 1;
  state.phase = Number(snapshot.phase) || 0;
  state.hearts = Math.max(0, Math.min(HEARTS, Number(snapshot.hearts) || 0));
  state.attack = snapshot.attack ? {} : null;
  state.combo = Number(snapshot.combo) || 0;
  state.frenzyUntil = performance.now() + (Number(snapshot.frenzy) || 0);
  state.partyReps = Array.isArray(snapshot.reps) ? snapshot.reps.map((n) => Number(n) || 0) : [];
  $("time-value").textContent = String(Number(snapshot.time) || 0);
  updateHud();
}
function showPartyResults(message) {
  if (!Array.isArray(message.result) || !Array.isArray(message.result[4])) return;
  const [title, text, rating, ratingClass, stats] = message.result;
  stopRound();
  state.advance = false;
  $("results-eyebrow").textContent = "THE BATTLE IS OVER";
  setResults(String(title), String(text), String(rating), ["gold", "silver", "bronze"].includes(ratingClass) ? ratingClass : "",
    stats.slice(0, 4).map((stat) => Array.isArray(stat) ? stat.map(String) : ["", ""]));
  setResultActions(Boolean(message.won));
  show("results");
  if (message.won) { sound("victory"); confetti(); }
}

export function enterLobby() {
  stopRound();
  state.status = "lobby";
  $("lobby").hidden = false;
  for (const id of ["timer", "arena", "duel-hud", "players-bar", "frenzy-banner", "countdown", "waiting"]) $(id).hidden = true;
  $("mode-label").textContent = "REMOTE PARTY";
  $("game-title").textContent = "Party Lobby";
  $("pose-tip").textContent = "Each player needs their own camera with their full body in view.";
  show("game");
  renderTiles();
  renderLobby();
  positionLabels();
  if (state.stream) ensurePoseLoop();
  else if (!state.keyboardOnly && !state.cameraBusy && $("game-error").hidden) {
    $("camera-placeholder").hidden = false;
    $("camera-placeholder").textContent = "Preparing the camera…";
    prepareCamera();
  }
  if (isHost()) state.party.broadcast({ t: "lobby" });
}
function renderLobby() {
  if (state.mode !== "party" || !state.party) return;
  const host = state.party.isHost, count = playerCount(), b = boss();
  $("party-code").textContent = state.party.code;
  $("lobby-status").textContent = `${count} of ${MAX_PLAYERS} players`;
  $("lobby-hp").textContent = `${b.name}: ${b.hp} × ${count} = ${b.hp * count} HP`;
  $("boss-picker").replaceChildren(...BOSSES.map((item, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pick${i === state.bossIndex ? " selected" : ""}`;
    button.disabled = !host;
    button.innerHTML = `<span class="sprite"></span><span>${item.name}</span>`;
    renderSprite(button.querySelector(".sprite"), item);
    button.addEventListener("click", () => {
      state.bossIndex = i;
      state.party.broadcast({ t: "boss", bossIndex: i });
      renderLobby();
    });
    return button;
  }));
  $("start-party").hidden = !host;
  $("lobby-wait").hidden = host;
}
function startPartyFight(bossIndex) {
  stopRound();
  state.bossIndex = bossIndex;
  resetRound();
  show("game");
  state.status = "loading";
  ensurePoseLoop();
  beginCountdown(state.session);
}
export function hostStart() {
  if (!isHost()) return;
  state.party.broadcast({ t: "start", bossIndex: state.bossIndex });
  startPartyFight(state.bossIndex);
}
export async function copyInvite() {
  const link = `${location.origin}${location.pathname}?party=${state.party.code}`;
  try { await navigator.clipboard.writeText(link); toast("Invite link copied"); }
  catch { toast(link); }
}

// This device's camera is always the first tile; other players follow in roster order.
export function tileFor(index) {
  const id = state.roster[index]?.id;
  return [...$("stage-grid").querySelectorAll(".remote")].find((tile) => tile.dataset.peer === id) || null;
}
function renderTiles() {
  const grid = $("stage-grid");
  const others = state.mode === "party" ? state.roster.filter((m) => m.id !== state.party?.id) : [];
  grid.classList.toggle("multi", others.length > 0);
  grid.classList.toggle("many", others.length >= 3);
  const keep = new Set(others.map((m) => m.id));
  grid.querySelectorAll(".remote").forEach((tile) => { if (!keep.has(tile.dataset.peer)) tile.remove(); });
  for (const member of others) {
    let tile = [...grid.querySelectorAll(".remote")].find((item) => item.dataset.peer === member.id);
    if (!tile) {
      tile = document.createElement("div");
      tile.className = "stage remote";
      tile.dataset.peer = member.id;
      tile.innerHTML = `<video autoplay muted playsinline></video><div class="camera-placeholder">Connecting camera…</div><div class="tile-name"></div>`;
      grid.append(tile);
    }
    const stream = state.remoteStreams.get(member.id) || null;
    const video = tile.querySelector("video");
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      if (stream) video.play().catch(() => { /* Autoplay resumes on the next user gesture. */ });
    }
    tile.querySelector(".camera-placeholder").hidden = Boolean(stream);
  }
  updateTileNames();
}
export function updateTileNames() {
  const party = state.mode === "party";
  $("local-name").hidden = !party;
  if (!party) return;
  const fighting = state.status !== "lobby";
  state.roster.forEach((member, i) => {
    const label = (i === state.myIndex ? $("stage") : tileFor(i))?.querySelector(".tile-name");
    if (!label) return;
    const reps = isHost() ? state.trackers[i]?.reps ?? 0 : state.partyReps[i] ?? 0;
    label.textContent = `${i === 0 ? "♛ " : ""}${member.name}${i === state.myIndex ? " (you)" : ""}${fighting ? ` · ${number(reps)} reps` : ""}`;
  });
}
