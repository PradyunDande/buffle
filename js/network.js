/* Networking for remote parties: PeerJS links each guest's browser to the host's.
   Game messages travel host ↔ guest over data channels. Cameras use one
   video call per direction between every pair of players, so everyone sees
   everyone. PeerJS's public server is used only to find peers. */
const PEERJS_URL = "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js";
const PREFIX = "baffle-party-";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const MAX_PLAYERS = 6;
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
function cleanName(name) {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 16) || "Adventurer";
}
export function cleanCode(code) {
  return String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

// handlers: onRoster(members), onMessage(fromId, message), onStream(id, stream),
// onStreamEnd(id), onClose(reason), onError(error)
export function createParty(handlers) {
  const party = { isHost: false, code: "", id: "", members: [] };
  const links = new Map();     // Host: guest id → data connection. Guest: host id → data connection.
  const outgoing = new Map();  // Video calls carrying this player's camera, by peer id.
  const incoming = new Map();  // Video calls carrying another player's camera, by peer id.
  let peer = null, stream = null, closed = false, pendingJoin = null;

  function open(id) {
    return new Promise((resolve, reject) => {
      const candidate = new Peer(id);
      candidate.on("open", (assigned) => { peer = candidate; party.id = assigned; resolve(); });
      candidate.on("call", answer);
      candidate.on("disconnected", () => { if (!closed && !candidate.destroyed) candidate.reconnect(); });
      candidate.on("error", (error) => {
        if (!peer) { candidate.destroy(); reject(error); return; }
        if (error.type === "peer-unavailable") {
          // Calls to a player who just left fail this way; only a failed join matters.
          if (pendingJoin) pendingJoin(new Error("No party found with that code."));
          return;
        }
        handlers.onError(error);
      });
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
        if (party.members.length >= MAX_PLAYERS) {
          link.send({ t: "full" });
          setTimeout(() => link.close(), 500);
          return;
        }
        links.set(link.peer, link);
        setMembers([...party.members, { id: link.peer, name: cleanName(message.name) }]);
        sendRoster();
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
    await open();
    const hostId = PREFIX + code;
    await new Promise((resolve, reject) => {
      let joined = false;
      const fail = (error) => { if (joined) return; pendingJoin = null; clearTimeout(timer); reject(error); };
      const timer = setTimeout(() => fail(new Error("The party did not answer. Check the code and try again.")), 12000);
      pendingJoin = fail;
      const link = peer.connect(hostId, { reliable: true });
      link.on("open", () => link.send({ t: "hello", name: cleanName(name) }));
      link.on("data", (message) => {
        if (message?.t === "full") { fail(new Error("That party is full.")); return; }
        if (message?.t === "roster") {
          const members = Array.isArray(message.members) ? message.members
            .filter((m) => typeof m?.id === "string")
            .map((m) => ({ id: m.id, name: cleanName(m.name) })) : [];
          if (!joined) {
            joined = true;
            pendingJoin = null;
            clearTimeout(timer);
            links.set(hostId, link);
            party.code = code;
            resolve();
          }
          setMembers(members);
          return;
        }
        if (joined) handlers.onMessage(hostId, message);
      });
      const lost = () => {
        if (!joined) { fail(new Error("Could not reach that party.")); return; }
        if (!closed) handlers.onClose("The host ended the party.");
      };
      link.on("close", lost);
      link.on("error", lost);
    });
  };

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
    for (const call of [...outgoing.values(), ...incoming.values()]) call.close();
    for (const link of links.values()) link.close();
    peer?.destroy();
  };
  return party;
}
