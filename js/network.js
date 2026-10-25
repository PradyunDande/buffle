/* Networking for remote parties: PeerJS links each guest's browser to the host's.
   Game messages travel host ↔ guest over data channels. Cameras use one
   video call per direction between every pair of players, so everyone sees
   everyone. PeerJS's public server is used only to find peers.

   Matchmaking has no server of its own: a few well-known waiting-room ids act as
   a queue. A searcher joins whoever is waiting in one, or takes a free one and
   waits there itself. */
const PEERJS_URL = "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js";
const PREFIX = "buffle-party-";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const MAX_PLAYERS = 6;
const MATCH_PREFIX = "buffle-match-hard-";
const MATCH_SLOTS = 6;
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
  let peer = null, stream = null, closed = false, pendingJoin = null;
  let matchWaiter = null, recheckTimer = 0, probing = false;

  // Opens a peer. Unless `adopt` is false it becomes this player's peer; matchmaking
  // opens throwaway peers to look around without giving up its waiting room.
  function open(id, adopt = true) {
    return new Promise((resolve, reject) => {
      const candidate = new Peer(id);
      let opened = false;
      candidate.on("open", (assigned) => {
        opened = true;
        if (adopt) { peer = candidate; party.id = assigned; }
        resolve(candidate);
      });
      candidate.on("call", answer);
      candidate.on("disconnected", () => { if (!closed && !candidate.destroyed) candidate.reconnect(); });
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
      if (message?.t === "hello" && !links.has(link.peer)) {
        // While a waiting player checks other rooms, it turns newcomers away.
        if (party.members.length >= party.maxPlayers || probing) {
          link.send({ t: "full" });
          setTimeout(() => link.close(), 500);
          return;
        }
        links.set(link.peer, link);
        setMembers([...party.members, { id: link.peer, name: cleanName(message.name) }]);
        sendRoster();
        if (party.members.length >= party.maxPlayers) matchWaiter?.resolve();
        return;
      }
      if (links.get(link.peer) === link) handlers.onMessage(link.peer, message);
    });
    const leave = () => {
      if (links.get(link.peer) !== link) return;
      links.delete(link.peer);
      setMembers(party.members.filter((m) => m.id !== link.peer));
      sendRoster();
    };
    link.on("close", leave);
    link.on("error", leave);
  }

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
    matchWaiter?.reject(new Error("Search cancelled."));
    for (const call of [...outgoing.values(), ...incoming.values()]) call.close();
    for (const link of links.values()) link.close();
    peer?.destroy();
  };
  return party;
}
