/* Remote party gameplay: lobby, roster, host-to-guest sync, and the camera grid. */

import { ensurePoseLoop, positionLabels, prepareCamera, showFraming, stopMedia } from "./camera.js";
import { BOSSES, DIFFICULTIES, HEARTS, NAMES, points, POSES, SWITCH_CALLOUT } from "./config.js";
import { beginCountdown, difficultyPips, moveList, randomBoss, recordRep, resetRound, setResultActions, stopRound, strikePoseFor } from "./game.js";
import { cleanCode, createParty, listPublicParties, MAX_PLAYERS } from "./network.js";
import { difficulty, isGuest, isHost, newTracker, number, online, playerCount, resetMotion, saveSettings, settings, state } from "./state.js";
import { addAudioControls, applyAudio, playWithSound, startVoice, stopVoice, updateMicButton } from "./voice.js";
import { $, confetti, EFFECTS, setResults, show, showSwitchCallout, sound, toast, updateHud, updateTip } from "./ui.js";

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
    onError: (error) => { if (state.party === party) toast(error?.message || "Connection problem"); },
    // What a public party tells people browsing for one.
    describe: () => ({ difficulty: difficulty().name, fighting: state.status !== "lobby" })
  });
  return party;
}
function setRemoteBusy(busy) {
  $("create-party").disabled = $("join-party").disabled = busy;
  $("create-party").textContent = busy ? "Connecting…" : "Create Party";
  $("join-party").textContent = busy ? "Connecting…" : "Join Party";
}
// Hosting is private (join by code) or public (listed by name for anyone browsing).
let visibility = "private";
const defaultPartyName = () => `${$("player-name").value.trim() || settings.name || "Adventurer"}'s Party`;
export function setVisibility(choice) {
  visibility = choice === "public" ? "public" : "private";
  document.querySelectorAll("[data-visibility]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.visibility === visibility);
  });
  $("party-name-field").hidden = visibility !== "public";
  $("party-name").placeholder = defaultPartyName();
}
// `kind` is "create", "join" (by code), or "public" (a listing from the browser).
// Resolves to whether the player made it into the party.
export async function openParty(kind, listing) {
  settings.name = $("player-name").value.trim().slice(0, 16);
  saveSettings();
  const code = cleanCode($("join-code").value);
  if (kind === "join" && code.length !== 5) { toast("Enter the 5-character party code."); return false; }
  stopRound();
  const party = newParty();
  Object.assign(state, { mode: "party", party, roster: [], difficulty: validDifficulty(settings.difficulty) ? settings.difficulty : "normal" });
  setRemoteBusy(true);
  try {
    if (kind === "join") await party.join(code, settings.name);
    else if (kind === "public") await party.joinPublic(listing, settings.name);
    else if (visibility === "public") await party.createPublic(settings.name, $("party-name").value.trim() || defaultPartyName());
    else await party.create(settings.name);
  } catch (error) {
    party.leave();
    if (state.party === party) { state.party = null; state.mode = "solo"; }
    toast(error?.message || "Could not connect to the party.");
    return false;
  } finally { setRemoteBusy(false); }
  if (state.party !== party) return false;
  enterLobby();
  return true;
}

// The public party browser asks every public room what it holds.
export async function browseParties() {
  show("browse");
  const status = $("browse-status"), list = $("public-list");
  status.textContent = "Looking for public parties…";
  list.replaceChildren();
  $("refresh-parties").disabled = true;
  let parties;
  try { parties = await listPublicParties(); }
  catch (error) { status.textContent = error?.message || "Could not reach the party service."; return; }
  finally { $("refresh-parties").disabled = false; }
  if (state.screen !== "browse") return;
  status.textContent = parties.length ? "" : "No public parties right now.";
  list.replaceChildren(...parties.map((listing) => {
    const row = document.createElement("div");
    row.className = "public-row";
    const info = document.createElement("div");
    info.className = "public-info";
    const name = document.createElement("strong");
    name.textContent = listing.name;
    const detail = document.createElement("span");
    detail.textContent = [`${listing.players} / ${listing.max}`, listing.difficulty.slice(0, 12), listing.fighting ? "In a scuffle" : "In the lobby"]
      .filter(Boolean).join(" · ");
    info.append(name, detail);
    const join = document.createElement("button");
    join.type = "button";
    join.className = "button primary small";
    const full = listing.players >= listing.max;
    join.textContent = full ? "Full" : "Join";
    join.disabled = full;
    join.addEventListener("click", async () => {
      list.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      join.textContent = "Joining…";
      // If the party filled up or closed meanwhile, show the list as it is now.
      if (!(await openParty("public", listing))) browseParties();
    });
    row.append(info, join);
    return row;
  }));
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
    } else if (message.t === "posed" && index > 0) {
      strikePoseFor(index);
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
  // A guest that missed "start" (a stalled link, or joining mid-fight) jumps in on
  // the next update instead of waiting in the lobby.
  else if (message.t === "state" && message.status === "playing" && validBoss(message.bossIndex) && validDifficulty(message.difficulty)) {
    state.difficulty = message.difficulty;
    startPartyFight(message.bossIndex, message.moves);
  }
  else if (message.t === "fx" && inFight && Object.hasOwn(EFFECTS, message.name) && Array.isArray(message.args)) EFFECTS[message.name](...message.args);
  else if (message.t === "results" && inFight) showPartyResults(message);
  else if (message.t === "lobby") enterLobby();
}
// Each player's move and how long until they're ready travel with every update.
export function broadcastState(now) {
  state.party.broadcast({ t: "state", status: state.status, bossIndex: state.bossIndex, difficulty: state.difficulty,
    hp: state.bossHp, max: state.bossMax,
    hearts: state.hearts, combo: state.combo,
    frenzy: Math.max(0, state.frenzyUntil - now), time: Math.max(0, Math.ceil((state.endAt - now) / 1000)),
    reps: state.trackers.map((t) => t.reps), moves: state.trackers.map((t) => t.exercise), scores: state.scores,
    poses: state.trackers.map((t) => t.pose) });
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
  const hadMove = Boolean(t.exercise);
  if (applyMoves(snapshot.moves) && hadMove) showSwitchCallout("", NAMES[t.exercise], performance.now() + SWITCH_CALLOUT);
  // Strike a Pose: the host decides who is frozen; this guest watches for its own pose.
  const pose = snapshot.poses?.[state.myIndex];
  const frozen = typeof pose === "string" && Object.hasOwn(POSES, pose) ? pose : null;
  if (frozen !== t.pose) { t.pose = frozen; t.poseHeld = 0; t.poseSent = false; if (frozen) resetMotion(t); }
  state.status = "playing";
  state.bossHp = Number(snapshot.hp) || 0;
  state.bossMax = Number(snapshot.max) || 1;
  state.hearts = Math.max(0, Math.min(HEARTS, Number(snapshot.hearts) || 0));
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
  $("pose-tip").textContent = "Put your camera on the floor, tilted up at you, with your whole body in frame.";
  showFraming(false);
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
  // A public party is known by its name; a private one by the code to share.
  const isPublic = Boolean(state.party.isPublic);
  $("lobby-code-label").textContent = isPublic ? "PUBLIC PARTY" : "PARTY CODE";
  $("party-code").textContent = isPublic ? state.party.publicName : state.party.code;
  $("party-code").classList.toggle("party-name", isPublic);
  $("copy-invite").hidden = isPublic;
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
  fitTiles();
  updateTileNames();
}
// The camera tiles take however many columns gives each the biggest picture in the
// grid's space: beside the boss, two players stack top and bottom; with the whole
// width, they sit side by side.
function fitTiles() {
  const grid = $("stage-grid");
  if (!grid.classList.contains("multi")) { grid.style.gridTemplateColumns = ""; return; }
  const count = grid.children.length, gap = 14;
  const bar = (grid.querySelector(".tile-bar")?.offsetHeight ?? 0) + 8;
  const limit = getComputedStyle(grid).maxHeight;
  const width = grid.clientWidth, height = limit === "none" ? grid.clientHeight : parseFloat(limit);
  let best = 0, columns = 1;
  for (let c = 1; c <= count; c++) {
    const rows = Math.ceil(count / c);
    const size = Math.min((width - gap * (c - 1)) / c, ((height - gap * (rows - 1)) / rows - bar) * 16 / 9);
    if (size > best) { best = size; columns = c; }
  }
  grid.style.gridTemplateColumns = `repeat(${columns}, ${Math.max(120, Math.floor(best))}px)`;
}
// Not $(): ui.js and this module import each other, so it may not be ready yet.
new ResizeObserver(fitTiles).observe(document.getElementById("stage-grid"));
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
