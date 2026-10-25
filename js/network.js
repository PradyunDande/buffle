/* Networking for remote parties: PeerJS links each guest's browser to the host's.
   Game messages travel host ↔ guest over data channels. Cameras use one
   video call per direction between every pair of players, so everyone sees
   everyone. PeerJS's public server is used only to find peers.

   Matchmaking has no server of its own: a few well-known waiting-room ids act as
   a queue. A searcher joins whoever is waiting in one, or takes a free one and
   waits there itself.

   Public parties work the same way: each takes one of a few well-known ids, and
   browsing asks every one of those ids what party, if any, is behind it.

   A WebRTC link that stalls rather than fails stays "open" in PeerJS, so messages
   vanish without an error. The host pings every guest; a guest silent too long is
   dropped, and a guest that stops hearing from the host leaves. Camera calls that
   don't connect are placed again. */
const PEERJS_URL = "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js";
const PREFIX = "buffle-party-";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const MAX_PLAYERS = 6;
const MATCH_PREFIX = "buffle-match-hard-";
const MATCH_SLOTS = 6;
const PUBLIC_PREFIX = "buffle-public-";
const PUBLIC_SLOTS = 12;
// STUN servers let most players connect directly; PeerJS's own TURN relays (its
// defaults, kept here) carry the rest. Passing a config replaces the defaults.
const PEER_OPTIONS = { config: { iceServers: [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"] },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"], username: "peerjs", credential: "peerjsp" }
] } };
const PING_EVERY = 2000;
// How long a link may stay silent before it counts as lost.
const SILENCE_LIMIT = 12000;
// How long a camera call may take to connect before it's placed again.
const CALL_RETRY = 10000;
const RECONNECT_DELAY = 3000;
const JOIN_ERRORS = {
  missing: "No party found with that code.",
  full: "That party is full.",
  timeout: "The party did not answer. Check the code and try again."
};
let loading = null;

function loadPeerJs() {
  if (window.Peer) return Promise.resolve();
  loading ||= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PEERJS_URL;
    script.onload = resolve;
    script.onerror = () => { loading = null; reject(new Error("Could not load the party service. Check your connection.")); };
    document.head.append(script);
  });
  return loading;
}
function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return [...bytes].map((n) => ALPHABET[n % ALPHABET.length]).join("");
}
export function cleanPartyName(name) {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 24) || "Public Party";
}
// Asks every public room what party it holds. Resolves to the parties that answered.
export async function listPublicParties() {
  await loadPeerJs();
  const probe = await new Promise((resolve, reject) => {
    const candidate = new Peer(PEER_OPTIONS);
    candidate.on("open", () => resolve(candidate));
    candidate.on("error", (error) => { if (!candidate.open) reject(error); });
  });
  // An id nobody holds fails on the peer, not the link; the message names the id.
  const missing = new Map();
  probe.on("error", (error) => {
    if (error.type !== "peer-unavailable") return;
    const id = /peer (\S+)/.exec(error.message || "")?.[1];
    missing.get(id)?.();
  });
  const ask = (slot) => new Promise((resolve) => {
    const id = PUBLIC_PREFIX + slot;
    let settled = false;
    const done = (info) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      missing.delete(id);
      link.close();
      resolve(info);
    };
    const timer = setTimeout(() => done(null), 5000);
    missing.set(id, () => done(null));
    const link = probe.connect(id, { reliable: true });
    link.on("open", () => link.send({ t: "info" }));
    link.on("data", (message) => {
      if (message?.t !== "info") return;
      const count = (n, max) => Math.max(0, Math.min(max, Math.floor(Number(n) || 0)));
      done({ slot, name: cleanPartyName(message.name), players: count(message.players, MAX_PLAYERS),
        max: count(message.max, MAX_PLAYERS) || MAX_PLAYERS, difficulty: String(message.difficulty ?? ""), fighting: Boolean(message.fighting) });
    });
    link.on("error", () => done(null));
  });
  try {
    return (await Promise.all(Array.from({ length: PUBLIC_SLOTS }, (_, slot) => ask(slot)))).filter(Boolean);
  } finally {
    probe.destroy();
  }
}
class JoinError extends Error {
  constructor(reason) { super(JOIN_ERRORS[reason]); this.reason = reason; }
}
function cleanMembers(members) {
  return Array.isArray(members) ? members.filter((m) => typeof m?.id === "string").map((m) => ({ id: m.id, name: cleanName(m.name) })) : [];
}
function cleanName(name) {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 16) || "Adventurer";
}
export function cleanCode(code) {
  return String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

// handlers: onRoster(members), onMessage(fromId, message), onStream(id, stream),
// onStreamEnd(id), onClose(reason), onError(error)
export function createParty(handlers) {
  const party = { isHost: false, code: "", id: "", members: [], maxPlayers: MAX_PLAYERS };
  const links = new Map();     // Host: guest id → data connection. Guest: host id → data connection.
  const outgoing = new Map();  // Video calls carrying this player's camera, by peer id.
  const incoming = new Map();  // Video calls carrying another player's camera, by peer id.
  const heard = new Map();     // When each linked player was last heard from.
  let peer = null, stream = null, closed = false, pendingJoin = null;
  let matchWaiter = null, recheckTimer = 0, probing = false;

  // Opens a peer. Unless `adopt` is false it becomes this player's peer; matchmaking
  // opens throwaway peers to look around without giving up its waiting room.
  function open(id, adopt = true) {
    return new Promise((resolve, reject) => {
      const candidate = new Peer(id, PEER_OPTIONS);
      let opened = false;
      candidate.on("open", (assigned) => {
        opened = true;
        // Left (a cancelled search, say) while this peer was opening: don't keep a
        // room or link alive that nobody is behind.
        if (closed) { candidate.destroy(); reject(new Error("Cancelled.")); return; }
        if (adopt) { peer = candidate; party.id = assigned; }
        resolve(candidate);
      });
      candidate.on("call", answer);
      // Lost the PeerJS server (calls and links already open keep working). Retry
      // after a pause: offline, an immediate retry fails at once and loops.
      candidate.on("disconnected", () => {
        setTimeout(() => { if (!closed && !candidate.destroyed && candidate.disconnected) candidate.reconnect(); }, RECONNECT_DELAY);
      });
      candidate.on("error", (error) => {
        if (!opened) { candidate.destroy(); reject(error); return; }
        if (error.type === "peer-unavailable") {
          // Calls to a player who just left fail this way; only a failed join matters.
          pendingJoin?.();
          return;
        }
        if (candidate === peer) handlers.onError(error);
      });
    });
  }

  // Joins a host through `via`, which becomes this player's peer once the host
  // accepts. Rejects with a JoinError: "missing", "full", or "timeout".
  function joinHost(via, hostId, name, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false, accepted = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        pendingJoin = null;
        clearTimeout(timer);
        if (error) { link.close(); reject(error); } else resolve();
      };
      const timer = setTimeout(() => finish(new JoinError("timeout")), timeoutMs);
      pendingJoin = () => finish(new JoinError("missing"));
      const link = via.connect(hostId, { reliable: true });
      link.on("open", () => link.send({ t: "hello", name: cleanName(name) }));
      link.on("data", (message) => {
        // Left mid-join (a cancelled search): hang up rather than join as nobody.
        if (closed) { link.close(); return; }
        heard.set(hostId, Date.now());
        if (message?.t === "ping") { link.send({ t: "pong" }); return; }
        if (message?.t === "full") { finish(new JoinError("full")); return; }
        if (message?.t === "roster") {
          if (!accepted) {
            accepted = true;
            peer = via;
            party.id = via.id;
            party.isHost = false;
            links.set(hostId, link);
            finish();
          }
          setMembers(cleanMembers(message.members));
          return;
        }
        if (accepted) handlers.onMessage(hostId, message);
      });
      const lost = () => {
        if (!accepted) { finish(new JoinError("missing")); return; }
        if (!closed) handlers.onClose("The host ended the party.");
      };
      link.on("close", lost);
      link.on("error", lost);
    });
  }

  function setMembers(members) {
    const ids = new Set(members.map((m) => m.id));
    for (const [id, call] of [...outgoing, ...incoming]) if (!ids.has(id)) { call.close(); dropStream(id); }
    party.members = members;
    handlers.onRoster(members);
    callMembers();
  }
  function dropStream(id) {
    outgoing.delete(id);
    if (incoming.delete(id)) handlers.onStreamEnd(id);
  }
  function callMembers() {
    if (!stream || !peer || closed) return;
    for (const member of party.members) {
      if (member.id === party.id || outgoing.has(member.id)) continue;
      const call = peer.call(member.id, stream);
      if (!call) continue;
      call.connectedAt = Date.now();
      outgoing.set(member.id, call);
      const forget = () => { if (outgoing.get(member.id) === call) outgoing.delete(member.id); };
      call.on("close", forget);
      call.on("error", forget);
    }
  }
  function answer(call) {
    // Answer without a stream: this call only carries the caller's camera.
    incoming.get(call.peer)?.close();
    incoming.set(call.peer, call);
    call.answer();
    call.on("stream", (remote) => { if (incoming.get(call.peer) === call) handlers.onStream(call.peer, remote); });
    const end = () => { if (incoming.get(call.peer) === call) { incoming.delete(call.peer); handlers.onStreamEnd(call.peer); } };
    call.on("close", end);
    call.on("error", end);
  }

  function broadcast(message) {
    for (const link of links.values()) if (link.open) link.send(message);
  }
  function sendRoster() { broadcast({ t: "roster", members: party.members }); }

  function acceptGuest(link) {
    link.on("data", (message) => {
      // Someone browsing public parties: say what this party is, then hang up.
      if (message?.t === "info" && party.isPublic && !links.has(link.peer)) {
        link.send({ t: "info", name: party.publicName, players: party.members.length, max: party.maxPlayers, ...handlers.describe?.() });
        setTimeout(() => link.close(), 1000);
        return;
      }
      if (message?.t === "hello" && !links.has(link.peer)) {
        // While a waiting player checks other rooms, it turns newcomers away.
        if (party.members.length >= party.maxPlayers || probing) {
          link.send({ t: "full" });
          setTimeout(() => link.close(), 500);
          return;
        }
        links.set(link.peer, link);
        heard.set(link.peer, Date.now());
        setMembers([...party.members, { id: link.peer, name: cleanName(message.name) }]);
        sendRoster();
        if (party.members.length >= party.maxPlayers) matchWaiter?.resolve();
        return;
      }
      if (links.get(link.peer) !== link) return;
      heard.set(link.peer, Date.now());
      if (message?.t !== "pong") handlers.onMessage(link.peer, message);
    });
    const leave = () => { if (links.get(link.peer) === link) dropGuest(link.peer); };
    link.on("close", leave);
    link.on("error", leave);
  }
  function dropGuest(id) {
    const link = links.get(id);
    links.delete(id);
    heard.delete(id);
    link?.close();
    setMembers(party.members.filter((m) => m.id !== id));
    sendRoster();
  }

  // Every PING_EVERY: the host pings its guests and drops any that went silent; a
  // guest leaves if the host went silent. Camera calls still not connected after
  // CALL_RETRY are hung up and placed again.
  function heartbeat() {
    if (closed) return;
    const now = Date.now();
    for (const [id, link] of [...links]) {
      if (now - (heard.get(id) ?? now) > SILENCE_LIMIT) {
        if (party.isHost) dropGuest(id);
        else handlers.onClose("Lost connection to the host.");
        if (closed) return;
      } else if (party.isHost && link.open) link.send({ t: "ping" });
    }
    for (const [id, call] of [...outgoing]) {
      const ice = call.peerConnection?.iceConnectionState;
      if (ice === "connected" || ice === "completed") { call.connectedAt = now; continue; }
      if (now - call.connectedAt > CALL_RETRY) { outgoing.delete(id); call.close(); }
    }
    callMembers();
  }
  const heartbeatTimer = setInterval(heartbeat, PING_EVERY);

  party.create = async (name) => {
    await loadPeerJs();
    for (let attempt = 0; ; attempt++) {
      const code = randomCode();
      try { await open(PREFIX + code); party.code = code; break; }
      catch (error) { if (error.type !== "unavailable-id" || attempt >= 3) throw error; }
    }
    party.isHost = true;
    peer.on("connection", acceptGuest);
    setMembers([{ id: party.id, name: cleanName(name) }]);
  };

  // A public party takes the first free public room instead of a random code.
  party.createPublic = async (name, partyName) => {
    await loadPeerJs();
    for (let slot = 0; ; slot++) {
      if (slot >= PUBLIC_SLOTS) throw new Error("Too many public parties right now. Try a private one.");
      try { await open(PUBLIC_PREFIX + slot); break; }
      catch (error) { if (error.type !== "unavailable-id") throw error; }
    }
    Object.assign(party, { isHost: true, isPublic: true, publicName: cleanPartyName(partyName) });
    peer.on("connection", acceptGuest);
    setMembers([{ id: party.id, name: cleanName(name) }]);
  };
  party.joinPublic = async (listing, name) => {
    await loadPeerJs();
    Object.assign(party, { isPublic: true, publicName: cleanPartyName(listing.name) });
    try { await joinHost(await open(), PUBLIC_PREFIX + listing.slot, name, 12000); }
    catch (error) { throw error.reason === "full" ? error : new Error("That party has closed."); }
  };

  party.join = async (rawCode, name) => {
    const code = cleanCode(rawCode);
    if (code.length !== 5) throw new Error("Party codes are 5 characters.");
    await loadPeerJs();
    party.code = code;
    await joinHost(await open(), PREFIX + code, name, 12000);
  };

  // Finds one opponent. Resolves once two players are linked, as host or guest.
  party.matchmake = async (name, onWaiting) => {
    await loadPeerJs();
    party.maxPlayers = 2;
    // First, join anyone already waiting.
    const seeker = await open(undefined, false);
    if (await seekMatch(seeker, name, MATCH_SLOTS)) return;
    seeker.destroy();
    if (closed) throw new Error("Search cancelled.");
    // Nobody is waiting: take the first free room and wait in it.
    let slot = 0;
    for (; ; slot++) {
      if (slot >= MATCH_SLOTS) throw new Error("Matchmaking is busy. Try again in a moment.");
      try { await open(MATCH_PREFIX + slot); break; }
      catch (error) { if (error.type !== "unavailable-id") throw error; }
    }
    party.isHost = true;
    peer.on("connection", acceptGuest);
    setMembers([{ id: party.id, name: cleanName(name) }]);
    onWaiting?.();
    await new Promise((resolve, reject) => {
      matchWaiter = { resolve, reject };
      // Two players who search at the same moment can both end up waiting. The one
      // in the later room keeps checking earlier rooms and moves when it finds one.
      const recheck = async () => {
        if (closed || party.members.length > 1) return;
        if (slot > 0) {
          probing = true;
          const room = peer;
          const probe = await open(undefined, false).catch(() => null);
          if (probe && !closed && party.members.length < 2 && await seekMatch(probe, name, slot)) {
            probing = false;
            room.destroy();
            resolve();
            return;
          }
          probe?.destroy();
          probing = false;
        }
        recheckTimer = setTimeout(recheck, 8000);
      };
      recheckTimer = setTimeout(recheck, 3000 + Math.random() * 3000);
    });
    clearTimeout(recheckTimer);
    matchWaiter = null;
  };
  async function seekMatch(via, name, slots) {
    for (let slot = 0; slot < slots && !closed; slot++) {
      try { await joinHost(via, MATCH_PREFIX + slot, name, 4000); return true; }
      catch { /* That room is empty, busy, or gone: try the next. */ }
    }
    return false;
  }

  // Guests send to the host; the host sends to every guest.
  party.send = (message) => { for (const link of links.values()) if (link.open) link.send(message); };
  party.broadcast = broadcast;
  party.setStream = (localStream) => {
    if (stream === localStream) return;
    for (const call of outgoing.values()) call.close();
    outgoing.clear();
    stream = localStream;
    callMembers();
  };
  party.leave = () => {
    if (closed) return;
    closed = true;
    pendingJoin = null;
    clearTimeout(recheckTimer);
    clearInterval(heartbeatTimer);
    matchWaiter?.reject(new Error("Search cancelled."));
    for (const call of [...outgoing.values(), ...incoming.values()]) call.close();
    for (const link of links.values()) link.close();
    peer?.destroy();
  };
  return party;
}
