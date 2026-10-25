/* Remote party gameplay: lobby, roster, host-to-guest sync, and the camera grid. */

import { ensurePoseLoop, positionLabels, prepareCamera, stopMedia } from "./camera.js";
import { BOSSES, DIFFICULTIES, HEARTS, NAMES, points } from "./config.js";
import { beginCountdown, difficultyPips, moveList, randomBoss, recordRep, resetRound, setResultActions, stopRound } from "./game.js";
import { cleanCode, createParty, MAX_PLAYERS } from "./network.js";
import { difficulty, isGuest, isHost, newTracker, number, online, playerCount, resetMotion, saveSettings, settings, state } from "./state.js";
import { addAudioControls, applyAudio, playWithSound, startVoice, stopVoice, updateMicButton } from "./voice.js";
import { $, confetti, EFFECTS, setResults, show, showAlert, sound, toast, updateHud, updateTip } from "./ui.js";

// Remote party: the host runs the fight and streams state to guests. Each guest
// tracks its own camera, reports reps, and mirrors the host's HUD and effects.
const validBoss = (index) => Number.isInteger(index) && index >= 0 && index < BOSSES.length;
const validDifficulty = (key) => typeof key === "string" && Object.hasOwn(DIFFICULTIES, key);
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
  Object.assign(state, { mode: "party", party, roster: [], difficulty: validDifficulty(settings.difficulty) ? settings.difficulty : "normal" });
  setRemoteBusy(true);
  try {
    if (join) await party.join(code, settings.name);
    else await party.create(settings.name);
  } catch (error) {
    party.leave();
    if (state.party === party) { state.party = null; state.mode = "solo"; }
    toast(error?.message || "Could not connect to the party.");
    return;
  } finally { setRemoteBusy(false); }
  if (state.party === party) enterLobby();
}
// Online 1v1 matchmaking is always on Hard. The search runs from the 1v1 screen;
// once two players are linked they go straight to the match screen.
function setMatchStatus(text) {
  $("match-status").textContent = text || "";
  $("match-status").hidden = !text;
  $("find-match").textContent = text ? "Cancel Search" : "Find Online Match";
  $("match-name").disabled = Boolean(text);
}
export async function findMatch() {
  if (state.searching) { cancelMatch(); return; }
  if (state.party) return;
  settings.name = $("match-name").value.trim().slice(0, 16);
  saveSettings();
  stopRound();
  const party = newParty();
  Object.assign(state, { mode: "duel", party, roster: [], difficulty: "hard", searching: true });
  setMatchStatus("Searching for an opponent…");
  try {
    await party.matchmake(settings.name, () => { if (state.party === party) setMatchStatus("Waiting for an opponent…"); });
  } catch (error) {
    if (state.party !== party) return;
    state.searching = false;
    party.leave();
    resetOnline("duel");
    setMatchStatus("");
    toast(error?.message || "Could not find a match.");
    return;
  }
  if (state.party !== party) return;
  state.searching = false;
  setMatchStatus("");
  toast(`Matched with ${state.roster.find((m) => m.id !== party.id)?.name || "an opponent"}`);
  enterLobby();
}
export function cancelMatch() {
  if (!state.searching) return;
  state.searching = false;
  const party = state.party;
  resetOnline("duel");
  party.leave();
  setMatchStatus("");
}
// Back to local play: this player's own difficulty, no roster or remote cameras.
function resetOnline(mode) {
  Object.assign(state, { mode, party: null, roster: [], partyReps: [],
    difficulty: validDifficulty(settings.difficulty) ? settings.difficulty : "normal" });
  state.remoteStreams.clear();
  // After `party` is cleared, so the mic button sees play is no longer online.
  stopVoice();
  renderTiles();
}
export function leaveParty(message) {
  const party = state.party;
  state.party = null;
  party?.leave();
  stopRound();
  stopMedia();
  // The lobby's difficulty belonged to the party; go back to this player's own choice.
  resetOnline("solo");
  $("players-bar").hidden = false;
  show("menu");
  if (message) toast(message);
}

function onRoster(members) {
  if (state.mode === "duel" && state.roster.length > 1 && members.length < 2) {
    leaveParty("Your opponent left the match.");
    return;
  }
  const before = state.roster;
  state.roster = members;
  state.myIndex = Math.max(0, members.findIndex((m) => m.id === state.party.id));
  if (state.party.isHost) {
    // Trackers follow players by id as people join and leave mid-fight.
    const old = new Map(before.map((m, i) => [m.id, i]));
    state.lastEvents = members.map((m) => (old.has(m.id) && state.lastEvents[old.get(m.id)]) || null);
    state.trackers = members.map((m) => (old.has(m.id) && state.trackers[old.get(m.id)]) || newTracker());
    state.party.broadcast({ t: "difficulty", difficulty: state.difficulty });
  }
  // A 1v1 announces the match itself, so only parties toast arrivals and departures.
  if (before.length && state.mode !== "duel") {
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
    } else if (message.t === "rematch" && state.mode === "duel" && state.screen === "results") {
      hostStart();
    }
    return;
  }
  const inFight = state.screen === "game" && state.status !== "lobby";
  if (message.t === "difficulty" && validDifficulty(message.difficulty)) { state.difficulty = message.difficulty; renderLobby(); }
  else if (message.t === "start" && validBoss(message.bossIndex) && validDifficulty(message.difficulty)) {
    state.difficulty = message.difficulty;
    startPartyFight(message.bossIndex, message.moves);
  }
  else if (message.t === "state" && inFight) applySnapshot(message);
  else if (message.t === "fx" && inFight && Object.hasOwn(EFFECTS, message.name) && Array.isArray(message.args)) EFFECTS[message.name](...message.args);
  else if (message.t === "results" && inFight) showPartyResults(message);
  else if (message.t === "lobby") enterLobby();
}
// Each player's move and how long until they're ready travel with every update.
export function broadcastState(now) {
  state.party.broadcast({ t: "state", status: state.status, hp: state.bossHp, max: state.bossMax,
    hearts: state.hearts, attack: Boolean(state.attack), combo: state.combo,
    frenzy: Math.max(0, state.frenzyUntil - now), time: Math.max(0, Math.ceil((state.endAt - now) / 1000)),
    reps: state.trackers.map((t) => t.reps), moves: state.trackers.map((t) => t.exercise), scores: state.scores,
    ready: state.trackers.map((t) => Math.max(0, Math.round(t.readyAt - now))) });
}
function applyMoves(moves) {
  state.partyMoves = Array.isArray(moves) ? moves.map((move) => Object.hasOwn(NAMES, move) ? move : null) : [];
  const t = state.trackers[0], mine = state.partyMoves[state.myIndex];
  if (!mine || mine === t.exercise) return false;
  t.exercise = mine;
  resetMotion(t);
  updateTip();
  return true;
}
function applySnapshot(snapshot) {
  if (snapshot.status !== "playing") return;
  const t = state.trackers[0];
  const ready = Math.max(0, Number(snapshot.ready?.[state.myIndex]) || 0);
  const hadMove = Boolean(t.exercise);
  if (applyMoves(snapshot.moves) && hadMove) showAlert(`SWITCH TO ${NAMES[t.exercise].toUpperCase()}!`, "phase", Math.max(1500, ready));
  t.readyAt = performance.now() + ready;
  state.status = "playing";
  state.bossHp = Number(snapshot.hp) || 0;
  state.bossMax = Number(snapshot.max) || 1;
  state.hearts = Math.max(0, Math.min(HEARTS, Number(snapshot.hearts) || 0));
  state.attack = snapshot.attack ? {} : null;
  state.combo = Number(snapshot.combo) || 0;
  state.frenzyUntil = performance.now() + (Number(snapshot.frenzy) || 0);
  state.partyReps = Array.isArray(snapshot.reps) ? snapshot.reps.map((n) => Number(n) || 0) : [];
  if (Array.isArray(snapshot.scores)) state.scores = [0, 1].map((i) => Number(snapshot.scores[i]) || 0);
  $("time-value").textContent = String(Number(snapshot.time) || 0);
  updateHud();
}
function showPartyResults(message) {
  if (!Array.isArray(message.result) || !Array.isArray(message.result[4])) return;
  const [title, text, rating, ratingClass, stats] = message.result;
  stopRound();
  state.advance = false;
  setResults(String(title), String(text), String(rating), ["gold", "silver", "bronze"].includes(ratingClass) ? ratingClass : "",
    stats.slice(0, 4).map((stat) => Array.isArray(stat) ? stat.map(String) : ["", ""]));
  setResultActions(Boolean(message.won));
  show("results");
  if (message.won) { sound("victory"); confetti(); }
}

export function enterLobby() {
  stopRound();
  state.status = "lobby";
  const duel = state.mode === "duel";
  $("lobby").hidden = duel;
  for (const id of ["timer", "arena", "duel-hud", "players-bar", "frenzy-banner", "countdown", "waiting"]) $(id).hidden = true;
  $("mode-label").textContent = duel ? "ONLINE 1V1 SCUFFLE · HARD" : "ONLINE BOSS SCUFFLE";
  $("game-title").textContent = duel ? `VS ${state.roster.find((m) => m.id !== state.party.id)?.name || "Opponent"}` : "Party Lobby";
  // A matched 1v1 has nothing to set up: the host starts it once cameras have had a moment.
  if (duel && isHost()) state.lobbyTimer = setTimeout(hostStart, 5000);
  $("pose-tip").textContent = "Each player needs their own camera with their full body in view.";
  show("game");
  renderTiles();
  renderLobby();
  positionLabels();
  startVoice();
  updateMicButton();
  if (state.stream) ensurePoseLoop();
  else if (!state.cameraBusy && $("game-error").hidden) {
    $("camera-placeholder").hidden = false;
    $("camera-placeholder").textContent = "Preparing the camera…";
    prepareCamera();
  }
  if (isHost()) state.party.broadcast({ t: "lobby" });
}
function renderLobby() {
  if (state.mode !== "party" || !state.party) return;
  const host = state.party.isHost, count = playerCount(), level = difficulty();
  $("party-code").textContent = state.party.code;
  $("lobby-status").textContent = `${count} of ${MAX_PLAYERS} players`;
  $("lobby-hp").textContent = `${level.hp * count} HP`;
  $("boss-picker").replaceChildren(...Object.entries(DIFFICULTIES).map(([key, item], i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pick${key === state.difficulty ? " selected" : ""}`;
    button.disabled = !host;
    button.innerHTML = `<span class="pick-head"><span>${item.name}</span>${difficultyPips(i + 1)}</span>${moveList(item)}`;
    button.addEventListener("click", () => {
      state.difficulty = key;
      state.party.broadcast({ t: "difficulty", difficulty: key });
      renderLobby();
    });
    return button;
  }));
  $("start-party").hidden = !host;
  $("lobby-wait").hidden = host;
}
function startPartyFight(bossIndex, moves) {
  stopRound();
  state.bossIndex = bossIndex;
  resetRound();
  if (isGuest()) { applyMoves(moves); updateHud(); }
  show("game");
  state.status = "loading";
  ensurePoseLoop();
  beginCountdown(state.session);
}
export function hostStart() {
  if (!isHost() || state.status === "playing" || state.status === "countdown") return;
  startPartyFight(randomBoss());
  state.party.broadcast({ t: "start", bossIndex: state.bossIndex, difficulty: state.difficulty, moves: state.trackers.map((t) => t.exercise) });
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
  const others = online() ? state.roster.filter((m) => m.id !== state.party?.id) : [];
  grid.classList.toggle("multi", others.length > 0);
  grid.classList.toggle("many", others.length >= 3);
  const keep = new Set(others.map((m) => m.id));
  grid.querySelectorAll(".remote").forEach((tile) => { if (!keep.has(tile.dataset.peer)) tile.closest(".tile-wrap").remove(); });
  for (const member of others) {
    let tile = [...grid.querySelectorAll(".remote")].find((item) => item.dataset.peer === member.id);
    if (!tile) {
      const wrap = document.createElement("div");
      wrap.className = "tile-wrap";
      wrap.innerHTML = `<div class="stage remote"><video autoplay playsinline></video><div class="camera-placeholder">Connecting camera…</div></div>`
        + `<div class="tile-bar"><div class="tile-name"></div></div>`;
      tile = wrap.querySelector(".remote");
      tile.dataset.peer = member.id;
      addAudioControls(wrap, member.id);
      grid.append(wrap);
    }
    const wrap = tile.closest(".tile-wrap");
    const stream = state.remoteStreams.get(member.id) || null;
    const video = tile.querySelector("video");
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      if (stream) playWithSound(video, wrap, member.id);
    }
    // A player without a camera can still be heard.
    const placeholder = tile.querySelector(".camera-placeholder");
    placeholder.hidden = Boolean(stream?.getVideoTracks().length);
    placeholder.textContent = stream ? "Camera off" : "Connecting camera…";
    applyAudio(wrap, member.id);
  }
  updateTileNames();
}
export function updateTileNames() {
  const party = online();
  $("local-name").hidden = !party;
  if (!party) return;
  const fighting = state.status !== "lobby";
  state.roster.forEach((member, i) => {
    const label = (i === state.myIndex ? $("stage") : tileFor(i))?.closest(".tile-wrap").querySelector(".tile-name");
    if (!label) return;
    const reps = isHost() ? state.trackers[i]?.reps ?? 0 : state.partyReps[i] ?? 0;
    const move = isHost() ? state.trackers[i]?.exercise : i === state.myIndex ? state.trackers[0].exercise : state.partyMoves[i];
    label.textContent = `${member.name}${i === state.myIndex ? " (you)" : i === 0 ? " (host)" : ""}`
      + (fighting ? `${move ? ` · ${NAMES[move]}` : ""} · ${number(reps)} reps` : "");
  });
}
