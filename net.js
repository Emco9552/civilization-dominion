// ============================================================
// CIVILIZATION: DOMINION — multiplayer (Part 3 §8 & §9)
// Host-and-join over WebRTC data channels (PeerJS + its free
// public broker). The HOST runs the only real simulation; every
// 3-second Realistic tick it broadcasts the official game state,
// and 5×/second it streams army positions & combat effects.
// Clients render that state and send their orders as commands,
// which the host validates and executes. One country per player;
// everything unclaimed stays AI.
// ============================================================
"use strict";

const NET = {
  active: false,      // a multiplayer session is running (lobby or game)
  isHost: false,
  peer: null,         // PeerJS peer
  conns: [],          // host: all client connections
  hostConn: null,     // client: the connection to the host
  code: "",
  lobby: null,        // {players:[{name,cid,peer,me}], started}
  myCountry: 0,
  humans: [],         // country ids controlled by humans (host included)
  roster: [],         // client: [{name,cid}] player-to-country assignments
  started: false,
  awaitBoot: false,   // client: waiting for the first snapshot
  bootTimer: null,    // client: "start data never arrived" watchdog
  brokerUp: null,     // broker (signaling server) reachable? null = no session yet
  linkType: null,     // probed peer link: LAN / direct internet / relayed
  mapDirty: false,    // host: ownership changed since last snapshot
  fxQueue: [],        // host: combat effects captured for the next delta
  hostNow: 0,         // client: host's battlefield clock (drives day/night)
  reqSeq: 1,
  pending: {},        // client: cmd id -> result callback
  chunkBuf: {},       // reassembly buffers for big messages
  citySig: "",
  eraSig: "",
  lastEra: 0,
  tintedOnce: false,
  deadShown: false,
  victoryShown: false,
  peaceNotified: false,
  pendingConquest: null, // host: {att, def, age} while a client decides a conquest
  // ---- Diagnostic Update ----
  connState: "idle",  // human-readable connection state for logs & diagnostics
  log: [],            // ring buffer of connection events (Export Debug Report)
  lastRetry: null,    // the connect attempt the ⟳ Retry button repeats
  peerLoadTimer: null, // watchdog: PeerJS CDN request stalled without onerror
  failTimer: null,    // client: room link never opened
  lobbyTimer: null,   // client: connected but the host never answered hello
  pingIv: null,       // client: 5s keep-alive / stall-detector interval
  lastHostMsg: 0,     // client: last time ANY message arrived from the host
  lastSnap: 0,        // client: last time a snapshot/delta arrived (the sim pulse)
  lastPong: 0,        // client: last time the host answered a ping
  stallState: null,   // null | "paused" (host tab hidden) | "dead" (no data at all)
  reconnectTries: 0,  // broker reconnect attempts since the last success
  connEpoch: 0,       // bumped on every new/aborted attempt — stale async callbacks no-op
};

const NET_CHUNK = 8000;     // characters per chunk BEFORE wire escaping (see netSendRaw)
const NET_WIRE_MAX = 15000; // bytes; PeerJS's json channel silently drops messages >= 16300
const NET_MAX_PLAYERS = 8;

// ---------------- version & connection diagnostics (Diagnostic Update) ----------------
// The build id lives in data.js (GAME_VERSION); every handshake message
// carries it and mixed builds are refused with a clear message (§4).
function netVer() { return typeof GAME_VERSION !== "undefined" ? GAME_VERSION : "unknown"; }

// Connection debug log — a capped ring buffer feeding the Export Debug Report.
// Never put credentials in here; server hostnames and room codes are fine.
function netLog(msg) {
  const t = new Date(), p2 = n => (n < 10 ? "0" : "") + n;
  NET.log.push(`[${p2(t.getHours())}:${p2(t.getMinutes())}:${p2(t.getSeconds())}] ${msg}`);
  if (NET.log.length > 250) NET.log.splice(0, NET.log.length - 250);
}
// One place records every state change: the log gets the state name, the
// player gets the (usually longer) explanation via netStatus.
function netSetState(state, msg, bad) {
  NET.connState = state;
  netLog("state: " + state);
  if (msg !== undefined) netStatus(msg, bad);
}

// ⟳ Retry (§3): whenever a connect attempt dies, the button reappears and
// repeats the last attempt (host, or join with the same code) after a clean
// abort — never a second peer beside the dying one.
function netShowRetry(fn) {
  if (fn) NET.lastRetry = fn;
  const el = document.getElementById("mp-actions");
  if (el) el.style.display = NET.lastRetry ? "" : "none";
}
function netHideRetry() {
  const el = document.getElementById("mp-actions");
  if (el) el.style.display = "none";
}
// Tear down a PENDING connect attempt (never a live session): all connect
// timers die here so a stale timer can never destroy a fresh session, and the
// epoch bump makes any still-queued PeerJS-load callback a no-op (a CDN script
// that finishes loading AFTER the player pressed Retry/Back must not resume
// the abandoned attempt with a second Peer object).
function netAbortConnect() {
  NET.connEpoch++;
  if (NET.peerLoadTimer) { clearTimeout(NET.peerLoadTimer); NET.peerLoadTimer = null; }
  if (NET.failTimer) { clearTimeout(NET.failTimer); NET.failTimer = null; }
  if (NET.lobbyTimer) { clearTimeout(NET.lobbyTimer); NET.lobbyTimer = null; }
  if (!NET.active && NET.peer) {
    netLog("aborting the previous connect attempt");
    try { NET.peer.destroy(); } catch (e) {}
    NET.peer = null;
  }
}
// Status routing for problems: the MP screen's #mp-status is invisible once a
// game runs, so in-game connection problems ALSO surface as a toast (§3).
function netProblem(msg, bad) {
  netStatus(msg, bad);
  if (NET.started && typeof toast === "function") toast("🌐 " + msg);
}

// WebRTC ICE configuration. PeerJS's default is one STUN server plus its own
// free TURN relays on UDP 3478 only — that combination regularly fails across
// different home networks / mobile data (symmetric NAT, blocked UDP), which
// made multiplayer look "same Wi-Fi only". Passing a config REPLACES the
// default, so the PeerJS relays are kept and extra STUN + TURN servers on
// firewall-friendly ports (80/443, incl. TCP) are added as fallbacks.
const NET_RTC_CONFIG = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"], username: "peerjs", credential: "peerjsp" },
    { urls: "stun:openrelay.metered.ca:80" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
  ],
  sdpSemantics: "unified-plan",
};

// ---------------- PeerJS loading ----------------
const PEERJS_URLS = [
  "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js",
  "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js",
];
let peerJsLoading = null;
function netLoadPeerJS(ok, fail) {
  if (typeof Peer !== "undefined") { ok(); return; }
  if (peerJsLoading) { peerJsLoading.push([ok, fail]); return; }
  peerJsLoading = [[ok, fail]];
  const tryUrl = i => {
    if (i >= PEERJS_URLS.length) {
      const cbs = peerJsLoading; peerJsLoading = null;
      for (const [, f] of cbs) f && f();
      return;
    }
    const s = document.createElement("script");
    s.src = PEERJS_URLS[i];
    s.onload = () => {
      const cbs = peerJsLoading; peerJsLoading = null;
      for (const [o] of cbs) o && o();
    };
    s.onerror = () => { s.remove(); tryUrl(i + 1); };
    document.head.appendChild(s);
  };
  tryUrl(0);
}

// ---------------- transport (chunked JSON) ----------------
// The PeerJS "json" channel refuses any single message whose encoded wire
// size reaches 16300 bytes: it emits a "message-too-big" error and DROPS the
// data without throwing. The world snapshot sent at game start is hundreds of
// kilobytes, so it must be split into chunks that stay under that limit even
// after PeerJS JSON-escapes the payload once more on the wire (every quote
// and backslash inside a chunk doubles). Getting this wrong is exactly the
// "host starts alone, everyone else stays in the lobby" bug: every snapshot
// chunk was dropped, and the error event made the host kick its clients.
let netMsgSeq = 1;
const netEncoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
function netWireBytes(str) { return netEncoder ? netEncoder.encode(str).length : str.length * 2; }

function netSendRaw(conn, obj) {
  if (!conn || !conn.open) return;
  let s;
  try { s = JSON.stringify(obj); } catch (e) { return; }
  try {
    if (netWireBytes(s) < NET_WIRE_MAX) { conn.send(obj); return; } // fits in one message
    const id = netMsgSeq++;
    const parts = [];
    for (let pos = 0; pos < s.length; ) {
      let take = Math.min(NET_CHUNK, s.length - pos);
      let part = s.slice(pos, pos + take);
      // measure the chunk as PeerJS will actually send it (escaped, quoted)
      // and shrink until it fits with room for the {t,id,i,n} envelope
      while (take > 512 && netWireBytes(JSON.stringify(part)) > NET_WIRE_MAX - 100) {
        take = take >> 1;
        part = s.slice(pos, pos + take);
      }
      parts.push(part);
      pos += take;
    }
    for (let i = 0; i < parts.length; i++) {
      conn.send({ t: "chk", id, i, n: parts.length, d: parts[i] });
    }
  } catch (e) {}
}
function netBroadcast(obj) {
  for (const c of NET.conns) netSendRaw(c, obj);
}
function netSendToHost(obj) { netSendRaw(NET.hostConn, obj); }

function netOnData(conn, data) {
  let msg = null;
  try { msg = typeof data === "string" ? JSON.parse(data) : data; } catch (e) { return; }
  if (!msg || typeof msg !== "object") return;
  if (!NET.isHost) NET.lastHostMsg = Date.now(); // stall detector heartbeat (§3)
  if (msg.t === "chk") {
    const now = Date.now();
    const key = (conn ? conn.peer : "?") + "_" + msg.id;
    // a lost chunk must not leak its reassembly buffer forever. Expiry is by
    // IDLE time (ts refreshes on every received chunk), so a big snapshot
    // crawling over a slow relay is never purged mid-transfer — only a
    // message that stopped making progress for 30s is dead.
    for (const k of Object.keys(NET.chunkBuf)) {
      if (k !== key && now - (NET.chunkBuf[k].ts || now) > 30000) {
        delete NET.chunkBuf[k];
        netLog("dropped an incomplete chunked message (no progress for 30s)");
      }
    }
    const buf = NET.chunkBuf[key] = NET.chunkBuf[key] || { parts: [], got: 0, n: msg.n, ts: now };
    buf.ts = now;
    if (buf.parts[msg.i] === undefined) { buf.parts[msg.i] = msg.d; buf.got++; }
    if (buf.got >= buf.n) {
      delete NET.chunkBuf[key];
      try { netHandle(conn, JSON.parse(buf.parts.join(""))); } catch (e) {}
    }
    return;
  }
  netHandle(conn, msg);
}

// ---------------- multiplayer screen & lobby ----------------
function netMpName() {
  const inp = document.getElementById("mp-name");
  const v = (inp && inp.value.trim()) || "Commander";
  try { localStorage.setItem("civdom_mpname", v); } catch (e) {}
  return v.slice(0, 16);
}
function netStatus(msg, bad) {
  if (msg) netLog((bad ? "✗ " : "· ") + msg); // every status line lands in the debug log
  const el = document.getElementById("mp-status");
  if (el) el.innerHTML = `<span class="${bad ? "bad" : "good"}">${esc(msg)}</span>`;
}

// persistent connection indicator (multiplayer screen + lobby panel):
// 🟢 online server connected · 🔴 server disconnected · probed link type
function netConnLine() {
  if (NET.brokerUp === false) return `<span class="bad">🔴 Server disconnected — reconnecting…</span>`;
  if (NET.brokerUp) return `<span class="good">🟢 Online server connected</span>${NET.linkType ? ` <span class="dim">· ${esc(NET.linkType)}</span>` : ""}`;
  return `<span class="dim">Runs over the internet — players do NOT need to share a Wi-Fi network.</span>`;
}
function netConnStatus() {
  const el = document.getElementById("mp-conn");
  if (el) el.innerHTML = netConnLine();
  netRenderLobby();
}

// inspect the WebRTC candidate pair actually carrying the game data so the
// menu can honestly say whether this is a LAN, direct-internet or relayed link
function netProbeLink(conn) {
  try {
    const pc = conn && conn.peerConnection;
    if (!pc || typeof pc.getStats !== "function") return;
    pc.getStats(null).then(stats => {
      const pairs = {}, cands = {};
      let selId = null;
      stats.forEach(r => {
        if (r.type === "transport" && r.selectedCandidatePairId) selId = r.selectedCandidatePairId;
        else if (r.type === "candidate-pair") pairs[r.id] = r;
        else if (r.type === "local-candidate" || r.type === "remote-candidate") cands[r.id] = r;
      });
      let pair = (selId && pairs[selId]) || null;
      if (!pair) {
        for (const id of Object.keys(pairs)) {
          const p = pairs[id];
          if (p.state === "succeeded" && (p.nominated || p.selected)) { pair = p; break; }
        }
      }
      if (!pair) return;
      const lc = cands[pair.localCandidateId] || {}, rc = cands[pair.remoteCandidateId] || {};
      NET.linkType = (lc.candidateType === "relay" || rc.candidateType === "relay") ? "Online (relayed)"
        : (lc.candidateType === "host" && rc.candidateType === "host") ? "Local/LAN connection"
        : "Online (direct)";
      netLog("link probed: " + NET.linkType);
      netConnStatus();
    }).catch(() => {});
  } catch (e) {}
}

// full-screen "the world is on its way" overlay for non-host players
function netShowBoot(html) {
  let el = document.getElementById("mp-boot");
  if (!el) {
    el = document.createElement("div");
    el.id = "mp-boot";
    el.style.cssText = "position:fixed;inset:0;z-index:120;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:rgba(4,8,16,.93);color:#dcebff;font-size:16px;text-align:center;padding:20px;";
    el.innerHTML = `<div class="spinner"></div><div id="mp-boot-msg"></div>`;
    document.body.appendChild(el);
  }
  const m = document.getElementById("mp-boot-msg");
  if (m) m.innerHTML = html;
}
function netHideBoot() {
  const el = document.getElementById("mp-boot");
  if (el) el.remove();
}
function netInitMpScreen() {
  const nameInp = document.getElementById("mp-name");
  if (nameInp && !nameInp.value) {
    try { nameInp.value = localStorage.getItem("civdom_mpname") || ""; } catch (e) {}
  }
  document.getElementById("mp-host").onclick = netHostGame;
  document.getElementById("mp-join").onclick = () => {
    const code = document.getElementById("mp-code").value.trim().toUpperCase();
    if (code.length !== 5) { netStatus("Enter the 5-letter room code.", true); return; }
    netJoinGame(code);
  };
  document.getElementById("mp-back").onclick = () => {
    if (NET.active) netLeave(false);
    else netAbortConnect(); // a half-finished connect attempt dies with the screen
    netHideRetry();
    show("menu");
  };
  const rb = document.getElementById("mp-retry");
  if (rb) rb.onclick = () => { netHideRetry(); if (NET.lastRetry) NET.lastRetry(); };
  const db = document.getElementById("mp-debug");
  if (db) db.onclick = netExportDebugReport;
  const vs = document.getElementById("mp-ver");
  if (vs) vs.textContent = "v" + netVer();
  netStatus("");
  netConnStatus();
}

function netMakeCode() {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ"; // no confusable I/L/O
  let c = "";
  for (let i = 0; i < 5; i++) c += abc[Math.floor(Math.random() * abc.length)];
  return c;
}

function netHostGame() {
  if (NET.active) return;
  netAbortConnect(); // replace, never stack, a dying attempt
  const epoch = NET.connEpoch; // this attempt's identity
  NET.lastRetry = netHostGame;
  netHideRetry();
  netLog("hosting — game " + netVer() + " · signalling: 0.peerjs.com (PeerJS public cloud) · role: host");
  netSetState("Creating online room", "Creating online room…");
  // a stalled CDN request fires no onerror — without this timer the screen
  // would say "Creating online room…" forever (§3)
  NET.peerLoadTimer = setTimeout(() => {
    NET.peerLoadTimer = null;
    if (typeof Peer !== "undefined") return;
    netSetState("Signalling server unavailable", "Signalling server unavailable — the network library did not load. Check your internet connection and press Retry.", true);
    netShowRetry();
  }, 12000);
  netLoadPeerJS(() => {
    if (epoch !== NET.connEpoch) return; // the player moved on while the CDN crawled
    if (NET.peerLoadTimer) { clearTimeout(NET.peerLoadTimer); NET.peerLoadTimer = null; }
    NET.code = netMakeCode();
    const peer = new Peer("civdom-" + NET.code.toLowerCase(), { config: NET_RTC_CONFIG });
    NET.peer = peer;
    // Bug 1: never hang on "Connecting…" forever. If the signaling server
    // cannot be reached, say SERVER UNAVAILABLE and stand down. The room code
    // is only announced AFTER the room is actually registered online.
    const brokerTimer = setTimeout(() => {
      if (NET.active || NET.peer !== peer) return;
      netSetState("Signalling server unavailable", "Signalling server unavailable — could not reach the online service. Check your internet connection and press Retry.", true);
      try { peer.destroy(); } catch (e) {}
      NET.peer = null;
      netShowRetry();
    }, 15000);
    peer.on("open", () => {
      clearTimeout(brokerTimer);
      NET.brokerUp = true;
      NET.reconnectTries = 0;
      if (NET.active && NET.isHost) { netLog("signalling server reconnected"); netConnStatus(); return; } // broker came back mid-session — keep the room as it is
      NET.active = true; NET.isHost = true; NET.started = false;
      NET.conns = [];
      NET.lobby = { players: [{ name: netMpName(), cid: 0, peer: "host", me: true }], started: false };
      netHideRetry();
      netSetState("Connected to server", "Connected to server — room " + NET.code + " is live online.");
      netConnStatus();
      netEnterSelect();
      toast(`🌐 Room ${NET.code} created — share the code, then claim your nation on the map.`);
    });
    peer.on("connection", conn => {
      conn.on("open", () => {
        // connections stay open after game start so dropped players can
        // reconnect (QoL §18) — the "hello" handler decides their fate
        if (NET.conns.length + 1 >= NET_MAX_PLAYERS) {
          // tell them WHY before closing — a silent close reads as "Host disconnected"
          netLog("refused a connection: room is full");
          netSendRaw(conn, { t: "reject", why: "full", host: netVer() });
          setTimeout(() => { try { conn.close(); } catch (e) {} }, 400);
          return;
        }
        netLog("player channel open (" + String(conn.peer).slice(0, 12) + "…)");
        NET.conns.push(conn);
        conn.on("data", d => netOnData(conn, d));
        conn.on("close", () => netHostDropConn(conn));
        // non-fatal errors (e.g. an oversized message) leave the channel
        // open — only treat the player as gone when it actually is closed
        conn.on("error", () => { if (!conn.open) netHostDropConn(conn); });
        setTimeout(() => netProbeLink(conn), 1500);
      });
    });
    peer.on("error", err => {
      const type = err && err.type || "unknown";
      netLog("host peer error: " + type);
      if (type === "unavailable-id") {
        // during room CREATION: the random code collided — roll a new one.
        // MID-SESSION (broker reconnect raced its own dead socket): destroying
        // the peer here would cut every live player off — never do that.
        if (NET.active || NET.started) {
          netProblem("Signalling hiccup — the room name could not be re-registered. Current players stay connected, but NEW joins may fail until the room is restarted.", true);
          return;
        }
        try { peer.destroy(); } catch (e) {} NET.peer = null; netHostGame(); return;
      }
      if (type === "network" || type === "server-error" || type === "socket-error" || type === "socket-closed")
        netProblem("Signalling server unavailable — the online service cannot be reached right now.", true);
      else netProblem("Connection error: " + type, true);
      netResetToMenuIfLobby();
      if (!NET.started) netShowRetry();
    });
    peer.on("disconnected", () => {
      NET.brokerUp = false; netConnStatus();
      NET.reconnectTries++;
      netLog("signalling server lost — reconnect attempt " + NET.reconnectTries + " (the game link itself stays up)");
      try { peer.reconnect(); } catch (e) {}
    });
  }, () => {
    if (epoch !== NET.connEpoch) return;
    if (NET.peerLoadTimer) { clearTimeout(NET.peerLoadTimer); NET.peerLoadTimer = null; }
    netSetState("Signalling server unavailable", "Could not load the network library — multiplayer needs an internet connection. Press Retry once you are online.", true);
    netShowRetry();
  });
}

function netJoinGame(code) {
  if (NET.active) return;
  netAbortConnect(); // replace, never stack, a dying attempt (e.g. after "Room not found")
  const epoch = NET.connEpoch; // this attempt's identity
  NET.lastRetry = () => netJoinGame(code);
  netHideRetry();
  netLog("joining room " + code + " — game " + netVer() + " · signalling: 0.peerjs.com (PeerJS public cloud) · role: client");
  netSetState("Connecting to room", "Connecting to room " + code + "…");
  // a stalled CDN request fires no onerror — cap it (§3)
  NET.peerLoadTimer = setTimeout(() => {
    NET.peerLoadTimer = null;
    if (typeof Peer !== "undefined") return;
    netSetState("Signalling server unavailable", "Signalling server unavailable — the network library did not load. Check your internet connection and press Retry.", true);
    netShowRetry();
  }, 12000);
  netLoadPeerJS(() => {
    if (epoch !== NET.connEpoch) return; // the player moved on while the CDN crawled
    if (NET.peerLoadTimer) { clearTimeout(NET.peerLoadTimer); NET.peerLoadTimer = null; }
    const peer = new Peer({ config: NET_RTC_CONFIG });
    NET.peer = peer;
    let joined = false;
    // Bug 1: the signaling server itself may be unreachable — cap the wait
    // instead of spinning on "Connecting…" forever
    const brokerTimer = setTimeout(() => {
      if (joined || NET.peer !== peer) return;
      netSetState("Signalling server unavailable", "Signalling server unavailable — could not reach the online service. Check your internet connection and press Retry.", true);
      try { peer.destroy(); } catch (e) {}
      NET.peer = null;
      netShowRetry();
    }, 15000);
    peer.on("open", () => {
      clearTimeout(brokerTimer);
      NET.brokerUp = true; NET.reconnectTries = 0; netConnStatus();
      if (joined) return; // broker came back mid-session — the game link is separate
      joined = true;
      netSetState("Connecting to room", "Connected to server — connecting to room " + code + "…");
      const conn = peer.connect("civdom-" + code.toLowerCase(), { reliable: true, serialization: "json" });
      let opened = false;
      // relayed (TURN) connections across strict networks can take a while
      NET.failTimer = setTimeout(() => {
        NET.failTimer = null;
        if (opened || NET.peer !== peer) return;
        // the broker knows the room (no peer-unavailable came back) but no
        // direct OR relayed WebRTC path could be established
        if (NET.brokerUp)
          netSetState("Relay connection failed", "Relay connection failed — room " + code + " exists, but no direct or relay link to the host could be established. A strict firewall/VPN may be blocking WebRTC on one side; try another network or a phone hotspot.", true);
        else
          netSetState("Connection timed out", "Connection timed out — no answer from room " + code + ". Check the code and that the host is still waiting.", true);
        try { peer.destroy(); } catch (e) {}
        NET.peer = null;
        netShowRetry();
      }, 20000);
      conn.on("open", () => {
        opened = true;
        if (NET.failTimer) { clearTimeout(NET.failTimer); NET.failTimer = null; }
        NET.active = true; NET.isHost = false; NET.started = false;
        NET.code = code;
        NET.hostConn = conn;
        netSendToHost({ t: "hello", name: netMpName(), v: netVer() });
        netSetState("Waiting for host", "Connected — waiting for the host's lobby…");
        netConnStatus();
        setTimeout(() => netProbeLink(conn), 1500);
        // §3: "Connected! Waiting…" must not be a place to hang forever — if
        // the host never answers hello (crashed tab, incompatible build that
        // predates the version handshake), say so and offer Retry
        if (NET.lobbyTimer) clearTimeout(NET.lobbyTimer);
        NET.lobbyTimer = setTimeout(() => {
          NET.lobbyTimer = null;
          if (!NET.active || NET.isHost || NET.lobby || NET.started) return;
          netSetState("Connection timed out", "Connection timed out — reached the host but received no reply. The host may be frozen or running a different game version. (Both players need game " + netVer() + ".)", true);
          NET.active = false;
          try { conn.close(); } catch (e) {}
          try { peer.destroy(); } catch (e) {}
          NET.peer = null; NET.hostConn = null;
          netShowRetry();
        }, 12000);
      });
      conn.on("data", d => netOnData(conn, d));
      conn.on("close", () => netClientLostHost());
      // non-fatal channel errors must not end the session while it is open
      conn.on("error", () => { if (!conn.open) netClientLostHost(); });
    });
    peer.on("error", err => {
      const type = err && err.type || "unknown";
      netLog("client peer error: " + type);
      if (type === "peer-unavailable") {
        // this attempt is over — kill the 20s timer so it cannot clobber this
        // message with a bogus "Connection timed out" later (§3)
        if (NET.failTimer) { clearTimeout(NET.failTimer); NET.failTimer = null; }
        if (!NET.active) { try { peer.destroy(); } catch (e) {} if (NET.peer === peer) NET.peer = null; }
        netSetState("Room not found", "Room not found — no room " + code + " is open right now. Check the code with the host (the host must keep their game open).", true);
        netShowRetry();
      }
      else if (type === "network" || type === "server-error" || type === "socket-error" || type === "socket-closed") {
        netProblem("Signalling server unavailable — the online service cannot be reached right now.", true);
        if (!NET.active) netShowRetry();
      }
      else netProblem("Connection error: " + type, true);
    });
    peer.on("disconnected", () => {
      NET.brokerUp = false; netConnStatus();
      NET.reconnectTries++;
      netLog("signalling server lost — reconnect attempt " + NET.reconnectTries + " (the game link itself stays up)");
      try { peer.reconnect(); } catch (e) {}
    });
  }, () => {
    if (epoch !== NET.connEpoch) return;
    if (NET.peerLoadTimer) { clearTimeout(NET.peerLoadTimer); NET.peerLoadTimer = null; }
    netSetState("Signalling server unavailable", "Could not load the network library — multiplayer needs an internet connection. Press Retry once you are online.", true);
    netShowRetry();
  });
}

// jump to the country-selection map in multiplayer lobby mode
function netEnterSelect() {
  chosenMode = "realistic"; // §9: multiplayer runs on the real-time mode
  show("select");
  pickedId = 2;
  repaintTint(); repaintHover(); fitView();
  renderPickPanel();
  netRenderLobby();
}

function netLobbyBroadcast() {
  if (!NET.isHost || !NET.lobby) return;
  NET.lobby.hmShow = NET.lobby.humanityMode || NET.lobby.aiHumanityMode || null;
  netBroadcast({ t: "lobby", v: netVer(), players: NET.lobby.players.map(p => ({ name: p.name, cid: p.cid, peer: p.peer })),
    hm: NET.lobby.hmShow, hmAi: !NET.lobby.players.some(p => p.cid === HUMAN_NATION_ID) });
  netRenderLobby();
  if (screen === "select") renderPickPanel();
}

function netRenderLobby() {
  let el = document.getElementById("mp-lobby");
  if (!NET.active || NET.started || !NET.lobby || (screen !== "select" && screen !== "mp")) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = "mp-lobby";
    document.body.appendChild(el);
  }
  const ps = NET.lobby.players;
  const allPicked = ps.length >= 2 && ps.every(p => p.cid);
  el.innerHTML = `<b>🌐 Multiplayer lobby</b>
    <div class="mp-code" title="Share this code with the other players.">${esc(NET.code)}</div>
    <div class="small" style="margin:2px 0 6px">${netConnLine()}</div>
    <div class="dim small">Click the map, inspect a nation, press <b>Claim</b>. One nation per player; the rest stay AI.</div>
    ${ps.map(p => `<div class="mp-player"><span class="dot ${p.cid ? "ready" : ""}"></span>
      <b>${esc(p.name)}</b>${p.me ? ' <span class="dim">(you)</span>' : ""}
      <span class="dim" style="margin-left:auto">${p.cid ? esc(G ? G.countries[p.cid].name : NATIONS[p.cid].n) : "choosing…"}</span></div>`).join("")}
    ${NET.lobby.hmShow ? `<div class="small" style="margin-top:4px">🧬 Humanity${NET.lobby.hmAi ? " (AI)" : ""}: <b>${NET.lobby.hmShow === "super" ? "Super-Buffed — 11/10 · +30% RP ✦" : "Normal — 10/10 · +20% RP"}</b></div>` : ""}
    ${NET.isHost
      ? `<button class="btn primary ${allPicked ? "" : "off"}" id="mp-start" style="width:100%;margin-top:8px">▶ Start game</button>
         <div class="dim small">${allPicked ? "Everyone is ready." : ps.length < 2 ? "Waiting for players to join…" : "Waiting for everyone to claim a nation…"}</div>`
      : `<div class="dim small" style="margin-top:6px">The host starts the game when everyone has picked.</div>`}
    <button class="btn small danger" id="mp-leave" style="width:100%;margin-top:6px">Leave</button>`;
  const st = document.getElementById("mp-start");
  if (st) st.onclick = () => { if (allPicked) netStartGame(); else toast("Wait until every player has claimed a nation (and at least one player has joined)."); };
  document.getElementById("mp-leave").onclick = () => netLeave(true);
}

function netClaimCountry(cid) {
  cid = Number(cid);
  if (!NET.active || NET.started || !metaOf(cid)) return;
  // Humanity Balance Update: a Humanity claim carries the picked balance mode
  const hm = cid === HUMAN_NATION_ID ? (typeof humanityPick === "string" ? humanityPick : "super") : null;
  if (NET.isHost) {
    if (NET.lobby.players.some(p => p.peer !== "host" && p.cid === cid)) { toast("That nation is already taken."); return; }
    const me = NET.lobby.players.find(p => p.peer === "host");
    me.cid = cid;
    sfx("click");
    netHumanityClaimed(me, hm);
    netLobbyBroadcast();
    renderPickPanel();
  } else {
    netSendToHost({ t: "claim", cid, hm });
  }
}

// ---------------- Humanity balance votes (Update Parts 2-4) ----------------
// Host-authoritative, one poll at a time. Every connected player gets one
// vote, the majority wins, a tie (or no votes) means Normal, non-voters are
// ignored when the timer runs out, and the match cannot begin while a vote is
// open. Results: NET.lobby.humanityMode (player-owned Humanity) or
// NET.lobby.aiHumanityMode (AI-controlled, always voted on before start).
const NET_POLL_SECS = 25;
function netHumanityClaimed(p, hm) {
  if (!NET.isHost || !NET.lobby) return;
  const owner = NET.lobby.players.find(q => q.cid === HUMAN_NATION_ID);
  if (!owner) { // Humanity released back to the AI — old approvals die with it
    NET.lobby.humanityMode = null;
    if (NET.lobby.poll && NET.lobby.poll.kind === "playerSuper") netPollFinish(true);
  }
  if (!p || p.cid !== HUMAN_NATION_ID) return;
  NET.lobby.aiHumanityMode = null; // a human owner outranks any old AI vote
  if (hm !== "super") { NET.lobby.humanityMode = "normal"; return; } // §9: Normal needs no vote
  NET.lobby.humanityMode = null;   // decided by the players
  netPollStart("playerSuper",
    `Allow ${p.name} to use Super-Buffed Humanity with 11/10 Intelligence and +30% Research Points?`,
    ["Allow", "Use Normal Humanity"], 0);
}
function netPollStart(kind, q, opts, superIdx) {
  if (!NET.isHost || !NET.lobby) return;
  if (NET.pollTimer) { clearInterval(NET.pollTimer); NET.pollTimer = null; }
  NET.lobby.poll = { kind, q, opts, superIdx, votes: {}, secs: NET_POLL_SECS, done: false };
  netBroadcast({ t: "poll", kind, q, opts, secs: NET_POLL_SECS });
  sfx("toast");
  netPollRender();
  netRenderLobby();
  NET.pollTimer = setInterval(() => {
    const poll = NET.lobby && NET.lobby.poll;
    if (!poll || poll.done) { clearInterval(NET.pollTimer); NET.pollTimer = null; return; }
    poll.secs--;
    // §11: the poll completes when the timer expires — or early, once every
    // connected player has spoken
    if (poll.secs <= 0 || Object.keys(poll.votes).length >= NET.lobby.players.length) netPollFinish(false);
    else netPollRender();
  }, 1000);
}
function netPollVote(peerKey, v) { // one vote per player; the last click counts
  const poll = NET.lobby && NET.lobby.poll;
  if (!poll || poll.done) return;
  poll.votes[peerKey] = Number(v) || 0;
}
function netPollFinish(cancelled) {
  const poll = NET.lobby && NET.lobby.poll;
  if (!poll || poll.done) return;
  poll.done = true;
  if (NET.pollTimer) { clearInterval(NET.pollTimer); NET.pollTimer = null; }
  let text;
  if (cancelled) {
    text = "🗳 The Humanity vote was cancelled.";
    NET.pendingStart = false;
  } else {
    const vs = Object.values(poll.votes);
    const forSuper = vs.filter(v => v === poll.superIdx).length;
    const forNormal = vs.length - forSuper;
    const superWins = forSuper > forNormal; // a tie defaults to Normal (§11)
    const result = superWins ? "super" : "normal";
    if (poll.kind === "playerSuper") {
      NET.lobby.humanityMode = result;
      text = superWins ? "🗳 Super-Buffed Humanity approved." : "🗳 Poll rejected — Humanity will use Normal balance.";
    } else {
      NET.lobby.aiHumanityMode = result;
      text = superWins ? "🗳 AI-controlled Humanity will be Super-Buffed." : "🗳 AI-controlled Humanity will use Normal balance.";
    }
  }
  NET.lobby.poll = null;
  netBroadcast({ t: "pollEnd", text });
  toast(text);
  netPollRender();
  netLobbyBroadcast();
  // the Start button was waiting on this vote (§11) — resume automatically
  if (!cancelled && NET.pendingStart) { NET.pendingStart = false; netStartGame(); }
}
// the floating vote panel — host and clients render from their own view
function netPollRender() {
  let el = document.getElementById("mp-poll");
  const poll = NET.isHost ? (NET.lobby && NET.lobby.poll) : NET.clientPoll;
  if (!NET.active || NET.started || !poll || poll.done) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "mp-poll";
    el.style.cssText = "position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:60;" +
      "background:rgba(10,16,28,0.96);border:1px solid #2b4a6b;border-radius:10px;padding:14px 16px;" +
      "max-width:420px;box-shadow:0 8px 30px rgba(0,0,0,0.55);color:#dfe9f5;font-size:14px";
    document.body.appendChild(el);
  }
  const votedN = NET.isHost ? Object.keys(poll.votes).length : null;
  el.innerHTML = `<b>🗳 Humanity vote</b>
    <div style="margin:8px 0">${esc(poll.q)}</div>
    ${poll.opts.map((o, i) => `<button class="btn small${poll.my === i ? " primary" : ""}" data-v="${i}" style="width:100%;margin-top:4px">${esc(o)}</button>`).join("")}
    <div class="dim small" style="margin-top:8px">${Math.max(0, poll.secs)}s left · majority wins · a tie means Normal${votedN !== null ? ` · ${votedN}/${NET.lobby.players.length} voted` : (poll.my !== undefined ? " · vote cast" : "")}</div>`;
  el.querySelectorAll("button[data-v]").forEach(b => b.onclick = () => {
    const v = Number(b.dataset.v);
    poll.my = v;
    sfx("click");
    if (NET.isHost) netPollVote("host", v);
    else netSendToHost({ t: "pollVote", v });
    netPollRender();
  });
}

function netStartGame() {
  if (!NET.isHost || NET.started) return;
  const ps = NET.lobby.players;
  const hostCid = ps.find(p => p.peer === "host").cid;
  if (!hostCid) { toast("Claim a nation first."); return; }
  if (ps.length < 2) { toast("Wait until at least one player has joined the room."); return; }
  const missing = ps.filter(p => !p.cid);
  if (missing.length) {
    toast(`Cannot start yet — ${missing.map(p => p.name).join(", ")} ${missing.length > 1 ? "have" : "has"} not claimed a nation.`);
    return;
  }
  // Humanity Balance Update §11: the match may not begin while a vote is open
  if (NET.lobby.poll && !NET.lobby.poll.done) {
    NET.pendingStart = true;
    toast("🗳 Waiting for the Humanity vote to finish — the match starts right after.");
    return;
  }
  const humOwner = ps.find(p => p.cid === HUMAN_NATION_ID);
  if (!humOwner && !NET.lobby.aiHumanityMode) {
    // Part 3: AI-controlled Humanity ALWAYS goes to a vote before the match
    NET.pendingStart = true;
    netPollStart("aiHumanity", "Which balance mode should AI-controlled Humanity use?",
      ["Normal Humanity", "Super-Buffed Humanity"], 1);
    toast("🗳 Humanity is AI-controlled — vote on its balance before the match begins.");
    return;
  }
  // the official mode: the owner's approved pick, or the AI vote's result
  PENDING_HUMANITY_MODE = humOwner ? (NET.lobby.humanityMode || "normal") : (NET.lobby.aiHumanityMode || "normal");
  NET.started = true;
  NET.lobby.started = true;
  NET.humans = ps.map(p => p.cid);
  for (const p of ps) p.online = true;
  const roster = ps.map(p => ({ name: p.name, cid: p.cid }));
  NET.roster = roster;
  // tell every player the match is starting BEFORE the (slow) world build,
  // so their loading screens appear immediately
  for (const conn of NET.conns) {
    const p = ps.find(q => q.peer === conn.peer);
    if (!p) { try { conn.close(); } catch (e) {} continue; } // connected but never entered the lobby
    netSendRaw(conn, { t: "start", v: netVer(), you: p.cid, humans: NET.humans, players: roster, code: NET.code });
  }
  initGame("realistic", hostCid);
  // roster inside the game state: powers the 🎮/🤖 indicators and disconnect
  // handling on every screen (QoL §17-18)
  G.mpPlayers = ps.map(p => ({ cid: p.cid, name: p.name, online: true }));
  log(`🌐 Multiplayer: ${ps.map(p => `${p.name} leads ${G.countries[p.cid].name}`).join(", ")}.`, "sys");
  // Part 4 §12: the official Humanity mode lives in the shared game state —
  // the snapshot below hands every client the same value
  log(`🧬 Humanity${humOwner ? "" : " (AI-controlled)"} plays the ${G.humanityMode === "super" ? "Super-Buffed balance — 11/10 Intelligence, +30% research points" : "Normal balance — 10/10 Intelligence, +20% research points"}.`, "sys");
  startGameUI();
  netSendSnapshot(); // the one official world — clients never generate their own
  netRenderLobby();
}

// ---------------- message handling ----------------
function netHandle(conn, msg) {
  if (NET.isHost) netHandleAsHost(conn, msg);
  else netHandleAsClient(msg);
}

function netHandleAsHost(conn, msg) {
  // stall detection bookkeeping: any traffic proves the player's link lives
  const hp = NET.lobby && NET.lobby.players.find(q => q.peer === conn.peer);
  if (hp) hp.lastSeen = Date.now();
  switch (msg.t) {
    case "ping":
      // answered from the data channel, NOT the rAF loop — so clients can tell
      // "host minimised the tab (sim paused)" from "connection dead" (§3)
      netSendRaw(conn, { t: "pong" });
      break;
    case "hello": {
      const name = String(msg.name || "Commander").slice(0, 16);
      // §4 version check: refuse mixed builds with a clear reason. Clients
      // older than the handshake send no v at all — same verdict.
      const theirVer = String(msg.v || "");
      if (theirVer !== netVer()) {
        netLog("refused " + name + " — version mismatch (host " + netVer() + " vs " + (theirVer || "an older build") + ")");
        toast(`🌐 ${name} tried to join with a different game version (${theirVer || "older build"}) — send them your game folder.`);
        netSendRaw(conn, { t: "reject", why: "version", host: netVer(), yours: theirVer });
        setTimeout(() => { try { conn.close(); } catch (e) {} }, 400); // let the reject flush first
        break;
      }
      if (NET.started) {
        // reconnection (QoL §18): a dropped player rejoins with the same name
        const seat = NET.lobby && NET.lobby.players.find(q =>
          q.cid && q.online === false && q.name.toLowerCase() === name.toLowerCase());
        if (!seat || !G || !G.countries[seat.cid] || !G.countries[seat.cid].alive) {
          // a silent close showed the joiner a wrong "Host disconnected" —
          // name the real reason instead (§3)
          netLog("refused " + name + " — game already running, no matching disconnected seat");
          netSendRaw(conn, { t: "reject", why: "noseat", host: netVer() });
          setTimeout(() => { try { conn.close(); } catch (e) {} }, 400);
          break;
        }
        seat.peer = conn.peer;
        seat.online = true;
        if (!NET.humans.includes(seat.cid)) NET.humans.push(seat.cid);
        const mp = G.mpPlayers && G.mpPlayers.find(q => q.cid === seat.cid);
        if (mp) mp.online = true;
        netSendRaw(conn, { t: "start", v: netVer(), you: seat.cid, humans: NET.humans, players: NET.roster || [], code: NET.code });
        netSendSnapshot();
        log(`🌐 ${seat.name} reconnected — ${G.countries[seat.cid].name} returns to human control.`, "sys");
        toast(`🌐 ${seat.name} reconnected.`);
        break;
      }
      if (!NET.lobby.players.some(p => p.peer === conn.peer)) {
        NET.lobby.players.push({ name, cid: 0, peer: conn.peer, me: false });
      }
      toast(`🌐 ${name} joined the room.`);
      sfx("toast");
      // §11: an OPEN Humanity vote reaches late joiners too; a completed one
      // is settled and never reopens
      if (NET.lobby.poll && !NET.lobby.poll.done) {
        const pl = NET.lobby.poll;
        netSendRaw(conn, { t: "poll", kind: pl.kind, q: pl.q, opts: pl.opts, secs: pl.secs });
      }
      netLobbyBroadcast();
      break;
    }
    case "claim": {
      if (NET.started) break;
      const p = NET.lobby.players.find(q => q.peer === conn.peer);
      const cid = Number(msg.cid);
      if (!p || !metaOf(cid)) break;
      if (NET.lobby.players.some(q => q.peer !== conn.peer && q.cid === cid)) {
        netSendRaw(conn, { t: "claimResult", ok: false, msg: "That nation is already taken." });
        break;
      }
      p.cid = cid;
      netSendRaw(conn, { t: "claimResult", ok: true, cid });
      netHumanityClaimed(p, msg.hm === "normal" ? "normal" : msg.hm === "super" ? "super" : null);
      netLobbyBroadcast();
      break;
    }
    case "pollVote": {
      if (NET.started) break;
      netPollVote(conn.peer, msg.v);
      netPollRender();
      break;
    }
    case "cmd": {
      const p = NET.lobby && NET.lobby.players.find(q => q.peer === conn.peer);
      const cid = p ? p.cid : 0;
      if (!NET.started || !cid || !G) break;
      let r = null;
      const fn = NET_HOST_CMDS[msg.fn];
      if (fn) { try { r = fn(cid, msg.args || {}) || null; } catch (e) { r = { ok: false, msg: "Command failed." }; } }
      netSendRaw(conn, { t: "res", id: msg.id, r });
      break;
    }
    case "bye": netHostDropConn(conn); break;
  }
}

function netHostDropConn(conn) {
  const i = NET.conns.indexOf(conn);
  if (i >= 0) NET.conns.splice(i, 1);
  const p = NET.lobby && NET.lobby.players.find(q => q.peer === conn.peer);
  if (!p) return;
  if (NET.started && p.cid) {
    // keep the seat so the player can reconnect with the same name (QoL §18);
    // meanwhile a caretaker AI protects the nation without making big calls
    p.online = false;
    NET.humans = NET.humans.filter(c => c !== p.cid);
    if (G && G.mpPlayers) {
      const mp = G.mpPlayers.find(q => q.cid === p.cid);
      if (mp) mp.online = false;
    }
    if (NET.pendingConquest && NET.pendingConquest.att === p.cid) {
      // they left mid-decision — default to annexation so the war resolves
      const pc = NET.pendingConquest; NET.pendingConquest = null;
      G.brokenPending = null;
      if (G.countries[pc.def] && G.countries[pc.def].alive) resolveConquest(pc.att, pc.def, "annex");
    }
    if (G && G.countries[p.cid]) {
      log(`🌐 ${p.name} disconnected — a caretaker AI protects ${G.countries[p.cid].name} until they rejoin.`, "sys");
      toast(`🌐 ${p.name} disconnected. Their nation is protected by AI; they can rejoin with the same name.`);
    }
  } else if (!NET.started) {
    NET.lobby.players = NET.lobby.players.filter(q => q !== p);
    toast(`🌐 ${p.name} left the room.`);
    if (p.cid === HUMAN_NATION_ID) netHumanityClaimed(null, null); // Humanity released — approvals reset
    netLobbyBroadcast();
  }
}

// §4: the client-side dead end for any version disagreement — one message,
// full cleanup, Retry stays available (pointless until someone updates, but
// the player may retype another room's code).
function netVersionBail(hostVer) {
  if (NET.lobbyTimer) { clearTimeout(NET.lobbyTimer); NET.lobbyTimer = null; }
  if (NET.bootTimer) { clearTimeout(NET.bootTimer); NET.bootTimer = null; }
  netLog("version mismatch — host " + (hostVer || "older build") + " vs mine " + netVer());
  NET.active = false; NET.started = false; NET.awaitBoot = false;
  netHideBoot();
  try { if (NET.hostConn) NET.hostConn.close(); } catch (e) {}
  try { if (NET.peer) NET.peer.destroy(); } catch (e) {}
  NET.peer = null; NET.hostConn = null; NET.lobby = null;
  netRenderLobby(); netConnStatus();
  if (typeof screen === "string" && screen === "select") show("mp");
  netSetState("Version mismatch", "Version mismatch — unable to join: host and client are using different game versions (host: " + (hostVer || "an older build") + ", you: " + netVer() + "). Everyone must use the exact same version — ask the host to send their current game folder.", true);
  netShowRetry();
}

function netHandleAsClient(msg) {
  switch (msg.t) {
    case "lobby": {
      if (NET.lobbyTimer) { clearTimeout(NET.lobbyTimer); NET.lobbyTimer = null; }
      if (String(msg.v || "") !== netVer()) { netVersionBail(msg.v); break; } // hosts older than the handshake send no v
      NET.lobby = { players: msg.players.map(p => Object.assign({}, p, { me: NET.peer && p.peer === NET.peer.id })),
        hmShow: msg.hm || null, hmAi: !!msg.hmAi };
      netSetState("In lobby");
      if (screen === "mp") netEnterSelect();
      else { netRenderLobby(); if (screen === "select") renderPickPanel(); }
      break;
    }
    case "pong":
      NET.lastPong = Date.now();
      break;
    case "reject": {
      // the host named the reason instead of silently closing (§3)
      if (msg.why === "version") { netVersionBail(msg.host); break; }
      if (NET.lobbyTimer) { clearTimeout(NET.lobbyTimer); NET.lobbyTimer = null; }
      NET.active = false;
      try { if (NET.hostConn) NET.hostConn.close(); } catch (e) {}
      try { if (NET.peer) NET.peer.destroy(); } catch (e) {}
      NET.peer = null; NET.hostConn = null;
      if (msg.why === "full")
        netSetState("Room full", "Room is full — this room already holds the maximum of " + NET_MAX_PLAYERS + " players.", true);
      else if (msg.why === "noseat")
        netSetState("Rejoin refused", "Unable to rejoin — the game is already running and no disconnected seat matches your name. Use the EXACT name you played with (or ask the host if your nation is still alive).", true);
      else netSetState("Rejected", "The host declined the connection.", true);
      netShowRetry();
      break;
    }
    case "claimResult":
      if (msg.ok) sfx("click");
      else toast(msg.msg || "Claim rejected.");
      break;
    case "poll": // Humanity Balance Update: a vote is open — show the panel
      NET.clientPoll = { kind: msg.kind, q: String(msg.q || ""), opts: (msg.opts || []).map(String), secs: Number(msg.secs) || NET_POLL_SECS };
      if (NET.clientPollTimer) clearInterval(NET.clientPollTimer);
      NET.clientPollTimer = setInterval(() => {
        if (!NET.clientPoll || !NET.active) { clearInterval(NET.clientPollTimer); NET.clientPollTimer = null; return; }
        NET.clientPoll.secs--;
        netPollRender();
      }, 1000);
      sfx("toast");
      netPollRender();
      break;
    case "pollEnd":
      NET.clientPoll = null;
      if (NET.clientPollTimer) { clearInterval(NET.clientPollTimer); NET.clientPollTimer = null; }
      toast(msg.text || "🗳 The vote has ended.");
      netPollRender();
      break;
    case "start":
      if (NET.lobbyTimer) { clearTimeout(NET.lobbyTimer); NET.lobbyTimer = null; }
      if (String(msg.v || "") !== netVer()) { netVersionBail(msg.v); break; } // rejoin into a mismatched host
      NET.started = true;
      netSetState("Starting game");
      netStartPingLoop(); // keep-alive + host-stall detector (§3)
      netPollCleanup(); // any vote panel makes way for the loading screen
      NET.myCountry = Number(msg.you) || 0;
      NET.humans = msg.humans || [];
      NET.roster = msg.players || [];
      NET.awaitBoot = true;
      netStatus("");
      netShowBoot(`<b>🌐 The host is starting the game…</b>
        <div class="dim" style="margin-top:8px">Loading multiplayer world…</div>
        ${NET.roster.length ? `<div class="dim small" style="margin-top:10px">${NET.roster.map(p => esc(p.name)).join(" · ")}</div>` : ""}`);
      if (NET.bootTimer) clearTimeout(NET.bootTimer);
      NET.bootTimer = setTimeout(() => {
        NET.bootTimer = null;
        if (!NET.active || !NET.awaitBoot) return;
        NET.active = false;
        netHideBoot();
        try { if (NET.peer) NET.peer.destroy(); } catch (e) {}
        openModal(`<h2>🌐 Start failed</h2>
          <p>Failed to receive the game start event. Please reconnect.</p>
          <button class="btn primary" id="mp-boot-fail">Back to the main menu</button>`);
        const b = document.getElementById("mp-boot-fail");
        if (b) b.onclick = () => location.reload();
      }, 30000);
      netRenderLobby(); // the lobby panel makes way for the loading screen
      break;
    case "snap":
      if (!NET.started) break;
      NET.lastSnap = Date.now(); // the sim pulse — feeds the stall detector
      netApplySnapshot(msg);
      break;
    case "delta":
      NET.lastSnap = Date.now();
      if (NET.started && G && !NET.awaitBoot) netApplyDelta(msg);
      break;
    case "res": {
      const cb = NET.pending[msg.id];
      delete NET.pending[msg.id];
      if (cb) cb(msg.r);
      else if (msg.r && msg.r.msg) toast(msg.r.msg);
      if (msg.r && msg.r.sfx) sfx(msg.r.sfx);
      break;
    }
    case "conquest":
      if (typeof showConquest === "function" && G && G.countries[msg.def]) showConquest(msg.def);
      break;
    case "warNote": // a player (or the AI) declared war on YOU (QoL §4)
      if (G && G.countries[msg.from]) {
        toast(`⚔ ${G.countries[msg.from].name} has DECLARED WAR on you!`);
        sfx("warhorn");
      }
      break;
    case "inboxNote": // a diplomatic request awaits an answer (QoL §6)
      toast("📨 A diplomatic offer awaits your answer — see Diplomacy.");
      sfx("toast");
      if (typeof uiTab !== "undefined" && uiTab === "diplo" && typeof renderSidebar === "function") renderSidebar();
      break;
    case "pchat": // player-to-player chat (QoL §5)
      if (typeof pchatDeliver === "function") pchatDeliver(Number(msg.from), String(msg.name || "Player"), String(msg.text || ""));
      break;
  }
}

// ---------------- keep-alive & stall detection (§3) ----------------
// Before this, a half-dead WebRTC path meant a client silently rendering the
// last snapshot forever. Pings run on the data channel (host answers outside
// its rAF loop), snapshots are the sim pulse — comparing the two separates
// "host minimised the tab" from "the connection is dead".
function netStartPingLoop() {
  if (NET.pingIv) clearInterval(NET.pingIv);
  NET.lastSnap = NET.lastPong = NET.lastHostMsg = Date.now();
  NET.stallState = null;
  NET.pingIv = setInterval(netStallTick, 5000);
}
function netStallTick() {
  if (!NET.active || NET.isHost || !NET.started) {
    if (NET.pingIv) { clearInterval(NET.pingIv); NET.pingIv = null; }
    return;
  }
  if (NET.hostConn && NET.hostConn.open) netSendToHost({ t: "ping" });
  if (NET.awaitBoot) return; // the 30s boot watchdog owns this phase
  const now = Date.now();
  const snapAge = now - (NET.lastSnap || now);
  const anyAge = now - (NET.lastHostMsg || now);
  let state = null;
  if (anyAge > 20000) state = "dead";        // not even pong answers
  else if (snapAge > 15000) state = "paused"; // pongs yes, world updates no
  if (state !== NET.stallState) {
    NET.stallState = state;
    if (state === "dead") {
      netLog("stall: no data from the host for " + Math.round(anyAge / 1000) + "s");
      toast("🌐 Connection problem — nothing from the host for " + Math.round(anyAge / 1000) + "s. If this keeps up the session is dead: reload and rejoin with the same name once the host is back.");
    } else if (state === "paused") {
      netLog("stall: host answers pings but sends no world updates (their tab is probably in the background)");
      toast("⏸ The host's game is paused — they likely minimised the game or switched tabs. The world resumes when they return.");
    } else {
      netLog("stall over — world updates flowing again");
      toast("🌐 Connection to the host restored.");
    }
  }
}

function netClientLostHost() {
  if (!NET.active || NET.isHost) return;
  netLog("host link closed");
  netSetState("Host disconnected");
  const wasStarted = NET.started, wasBooting = NET.awaitBoot;
  NET.active = false;
  if (NET.bootTimer) { clearTimeout(NET.bootTimer); NET.bootTimer = null; }
  if (NET.lobbyTimer) { clearTimeout(NET.lobbyTimer); NET.lobbyTimer = null; }
  if (NET.pingIv) { clearInterval(NET.pingIv); NET.pingIv = null; }
  netHideBoot();
  if (wasStarted) {
    openModal(`<h2>🌐 Host disconnected</h2>
      <p>${wasBooting
        ? "Failed to receive the game start event. Please reconnect."
        : "The connection to the host was lost. The multiplayer session has ended — you can rejoin with the same name and room code if the host returns."}</p>
      <button class="btn primary" id="mp-lost-ok">Back to the main menu</button>`);
    const b = document.getElementById("mp-lost-ok");
    if (b) b.onclick = () => location.reload();
  } else {
    netStatus("Host disconnected — the room is gone.", true);
    netResetToMenuIfLobby();
    netShowRetry();
  }
}

function netResetToMenuIfLobby() {
  if (NET.started) return;
  try { if (NET.peer) NET.peer.destroy(); } catch (e) {}
  NET.peer = null; NET.active = false; NET.isHost = false;
  NET.conns = []; NET.hostConn = null; NET.lobby = null;
  NET.brokerUp = null; NET.linkType = null;
  if (NET.peerLoadTimer) { clearTimeout(NET.peerLoadTimer); NET.peerLoadTimer = null; }
  if (NET.failTimer) { clearTimeout(NET.failTimer); NET.failTimer = null; }
  if (NET.lobbyTimer) { clearTimeout(NET.lobbyTimer); NET.lobbyTimer = null; }
  if (NET.pingIv) { clearInterval(NET.pingIv); NET.pingIv = null; }
  netPollCleanup();
  netHideBoot();
  netRenderLobby();
  netConnStatus();
}
// Humanity votes die with the lobby — timers, panel and pending-start flag
function netPollCleanup() {
  if (NET.pollTimer) { clearInterval(NET.pollTimer); NET.pollTimer = null; }
  if (NET.clientPollTimer) { clearInterval(NET.clientPollTimer); NET.clientPollTimer = null; }
  NET.clientPoll = null; NET.pendingStart = false;
  const el = document.getElementById("mp-poll");
  if (el) el.remove();
}

function netLeave(confirmToast) {
  netLog("leaving the session");
  try { if (!NET.isHost) netSendToHost({ t: "bye" }); } catch (e) {}
  try { if (NET.peer) NET.peer.destroy(); } catch (e) {}
  if (NET.started) { location.reload(); return; }
  NET.peer = null; NET.active = false; NET.isHost = false; NET.started = false;
  NET.conns = []; NET.hostConn = null; NET.lobby = null;
  NET.brokerUp = null; NET.linkType = null;
  if (NET.bootTimer) { clearTimeout(NET.bootTimer); NET.bootTimer = null; }
  if (NET.peerLoadTimer) { clearTimeout(NET.peerLoadTimer); NET.peerLoadTimer = null; }
  if (NET.failTimer) { clearTimeout(NET.failTimer); NET.failTimer = null; }
  if (NET.lobbyTimer) { clearTimeout(NET.lobbyTimer); NET.lobbyTimer = null; }
  if (NET.pingIv) { clearInterval(NET.pingIv); NET.pingIv = null; }
  netPollCleanup();
  netHideBoot();
  netRenderLobby();
  show("mp");
  netConnStatus();
  if (confirmToast) toast("Left the room.");
}

// small in-game indicator
function netShowHud() {
  let el = document.getElementById("mp-net");
  if (!NET.active || !NET.started) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement("div"); el.id = "mp-net"; document.body.appendChild(el); }
  el.textContent = `🌐 ${NET.code} · ${NET.isHost ? "hosting" : "client"} · ${NET.humans.length} player${NET.humans.length > 1 ? "s" : ""}`;
  netRenderLobby(); // removes the lobby panel now that the game runs
}

// ---------------- Export Debug Report (§10) ----------------
// A plain-text report a friend can send back when joining fails. Contains no
// passwords, credentials, chat or private data — connection events only.
function netBuildDebugReport() {
  const B = typeof window !== "undefined" && window.BOOT ? window.BOOT : null;
  const mob = typeof isMobileDevice === "function" ? (isMobileDevice() ? "mobile / touch device" : "desktop") : "?";
  const gfx = (typeof ID_ARR !== "undefined" && ID_ARR) ? "OK — world map built (" + MW + "×" + MH + ")" : "NOT INITIALISED — the map never finished building";
  const loadingEl = document.getElementById("loading");
  const bootState = B && B.booted ? "complete" : (loadingEl && loadingEl.style.display !== "none" ? "STUCK at: " + (B ? B.stage : "?") : "complete");
  const L = [];
  L.push("CIVILIZATION: DOMINION — DEBUG REPORT");
  L.push("Generated: " + new Date().toString());
  L.push("");
  L.push("Game version:  " + netVer());
  L.push("Device:        " + mob + (window.screen ? " · screen " + window.screen.width + "×" + window.screen.height : ""));
  L.push("Browser:       " + (navigator.userAgent || "?"));
  L.push("Opened via:    " + location.protocol.replace(":", "") + " (" + (location.protocol === "file:" ? "local file — normal for this game" : location.hostname || "?") + ")");
  L.push("");
  L.push("Loading:       " + bootState);
  if (B && B.okFiles && B.okFiles.length) L.push("Files loaded:  " + B.okFiles.join(" → "));
  L.push("Graphics:      " + gfx);
  L.push("Audio:         " + (typeof S !== "undefined" && S ? "sound module present (plays after the first tap/click)" : "sound module missing"));
  L.push("");
  L.push("Multiplayer:");
  L.push("  Method:      WebRTC peer-to-peer (PeerJS 1.5.4) · signalling server: 0.peerjs.com (PeerJS public cloud) · STUN/TURN: stun.l.google.com, stun.cloudflare.com, turn.peerjs.com, openrelay.metered.ca");
  L.push("  State:       " + NET.connState + (NET.active ? " · in a session" : " · no session"));
  L.push("  Role:        " + (NET.active ? (NET.isHost ? "host" : "client") : "—"));
  L.push("  Room code:   " + (NET.code || "—"));
  L.push("  Server link: " + (NET.brokerUp === null ? "not attempted yet" : NET.brokerUp ? "connected" : "DISCONNECTED"));
  L.push("  Game link:   " + (NET.linkType || "not established"));
  L.push("  Game state:  " + (NET.started ? "running · " + (NET.humans ? NET.humans.length : 0) + " human player(s)" : "not started"));
  L.push("");
  L.push("Recent errors (" + (B && B.errors ? B.errors.length : 0) + "):");
  if (B && B.errors && B.errors.length) for (const e of B.errors) L.push("  ! " + e);
  else L.push("  (none recorded)");
  L.push("");
  L.push("Connection log (most recent last):");
  const tail = NET.log.slice(-40);
  if (tail.length) for (const l of tail) L.push("  " + l);
  else L.push("  (no connection attempts this session)");
  L.push("");
  L.push("This report contains no passwords, tokens or private messages.");
  return L.join("\n");
}
function netExportDebugReport() {
  const txt = netBuildDebugReport();
  netLog("debug report exported");
  if (typeof openModal === "function") {
    openModal(`<h2>📋 Debug report</h2>
      <p class="dim small">If joining fails, send this to whoever hosts the game — it shows exactly where the connection stops. No passwords or private data inside.</p>
      <textarea id="dbg-txt" readonly style="width:100%;height:220px;background:rgba(6,12,22,.8);color:#cfe2ff;border:1px solid #2c4260;border-radius:6px;padding:8px;font:11px/1.45 Consolas,monospace;white-space:pre;">${esc(txt)}</textarea>
      <button class="btn primary" id="dbg-dl">💾 Download civdom-debug.txt</button>
      <button class="btn" id="dbg-close">Close</button>`);
    const ta = document.getElementById("dbg-txt");
    if (ta) { ta.onclick = () => ta.select(); }
    const dl = document.getElementById("dbg-dl");
    if (dl) dl.onclick = () => {
      try {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain" }));
        a.download = "civdom-debug.txt";
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e) { toast("Download failed — select the text and copy it instead."); }
    };
    const cl = document.getElementById("dbg-close");
    if (cl) cl.onclick = () => closeModal();
  }
}

// ---------------- host → clients: snapshots & deltas ----------------
function netAfterHostTick() {
  netSendSnapshot();
  // silent-seat watch (§3): a zombie WebRTC channel may never fire "close" —
  // tell the host when a seated player has sent nothing (not even pings) for
  // 2 minutes. Never auto-drop: their seat frees normally when the channel
  // actually closes, and background-tab timer throttling must not kick anyone.
  if (NET.lobby) for (const p of NET.lobby.players) {
    if (!p.cid || p.peer === "host" || p.online === false || !p.lastSeen) continue;
    const age = Date.now() - p.lastSeen;
    if (age > 120000 && !p.stallWarned) {
      p.stallWarned = true;
      netLog("no data from " + p.name + " for " + Math.round(age / 1000) + "s");
      toast(`🌐 Nothing from ${p.name} for 2 minutes — their connection may be dead. Their nation goes to the caretaker AI if the link closes.`);
    } else if (age < 30000 && p.stallWarned) {
      p.stallWarned = false;
      netLog(p.name + " is sending data again");
    }
  }
  // conquest decisions cannot block the world forever
  if (NET.pendingConquest && ++NET.pendingConquest.age > 30) {
    const pc = NET.pendingConquest; NET.pendingConquest = null;
    G.brokenPending = null;
    if (G.countries[pc.def] && G.countries[pc.def].alive) resolveConquest(pc.att, pc.def, "annex");
  }
}

function netSendSnapshot() {
  if (!NET.isHost || !NET.conns.length) { NET.mapDirty = false; return; }
  const fullLog = G.log;
  G.log = fullLog.slice(-60);
  let s = null;
  try { s = JSON.stringify(G); } catch (e) {}
  G.log = fullLog;
  if (!s) return;
  netBroadcast({ t: "snap", md: NET.mapDirty ? 1 : 0, g: s });
  NET.mapDirty = false;
}

function netSendDelta() {
  if (!NET.isHost || !NET.conns.length || !G) return;
  const ar = [];
  for (const a of G.armies) {
    ar.push([a.id, a.owner, a.unit, Math.round(a.x * 10) / 10, Math.round(a.y * 10) / 10,
      Math.round(a.hp), Math.round(a.maxHp), a.stack || 1, a.cargo ? a.cargo.length : -1,
      Math.round(a.tx), Math.round(a.ty)]);
  }
  const sh = [];
  if (G.space && G.space.ships) {
    for (const s2 of G.space.ships) {
      sh.push([s2.id, Math.round(s2.x), Math.round(s2.y), Math.round(s2.z), Math.round(s2.hp)]);
    }
  }
  const mf = missilesFly.map(m => [m.type, Math.round(m.x0), Math.round(m.y0), Math.round(m.tx), Math.round(m.ty),
    Math.round(m.gx), Math.round(m.gy), Math.round(m.alt), Math.round(m.f * 1000) / 1000, Math.round(m.dist)]);
  const d = { t: "delta", now: Math.round(warNow * 10) / 10, ar, mf };
  if (sh.length) d.sh = sh;
  if (G.space && G.space.planets) d.pa = SPACE_PLANETS.map(p => Math.round((G.space.planets[p.id].ang || 0) * 1000) / 1000);
  // Final Alien Update Part 8: stream the ground battles so clients watch them
  // live (snapshots alone would update the window only every economic tick)
  if (G.space && G.space.battles) {
    d.pb = G.space.battles.map(b => [b.planet, b.att, b.def, Math.round(b.t * 10) / 10,
      b.done ? 1 : 0, b.winner === null || b.winner === undefined ? -1 : b.winner, b.ret ? 1 : 0, b.id,
      b.units.map(u => [u.id, u.side, u.unit, Math.round(u.x * 10) / 10, Math.round(u.y * 10) / 10,
        Math.round(u.hp * 10) / 10, u.maxHp, u.turret ? 1 : 0, u.drop > 0 ? Math.round(u.drop * 100) / 100 : 0, u.gone ? 1 : 0]),
      b.fires.slice(0, 40).map(f => [Math.round(f.x), Math.round(f.y), Math.round(f.r * 10) / 10, Math.round((f.s || 0) * 100) / 100]),
      b.sup ? [Math.round(b.sup.x), Math.round(b.sup.y)] : 0,
      Math.round(b.endT * 10) / 10]);
  }
  if (NET.fxQueue.length) { d.fx = NET.fxQueue; NET.fxQueue = []; }
  netBroadcast(d);
}

function netHostFx(arr) {
  if (!NET.active || !NET.isHost || !NET.started) return;
  if (NET.fxQueue.length < 160) NET.fxQueue.push(arr);
}

// ---------------- client: applying host state ----------------
function netCitySig() {
  let s = "";
  for (const cid of Object.keys(G.countries)) {
    const c = G.countries[cid];
    s += cid + ":" + c.provinces.map(p => (p.px | 0) + "," + (p.py | 0) + (p.drawn ? "d" + p.drawn.length : "")).join(";") + "|";
  }
  return s;
}
function netEraSig() {
  let s = "";
  for (const cid of Object.keys(G.countries)) s += G.countries[cid].era;
  return s;
}
// rebuild the CITIES list against fresh province objects without redoing the
// expensive per-pixel CITY_ARR when the map structure has not changed
function netRefreshCityRefs() {
  CITIES = [];
  for (const cid of Object.keys(G.countries)) {
    const c = G.countries[cid];
    c.provinces.forEach((p, pi) => CITIES.push({ cid: Number(cid), pi, prov: p }));
  }
}

function netApplySnapshot(msg) {
  let g = null;
  try { g = JSON.parse(msg.g); } catch (e) { return; }
  const booting = NET.awaitBoot;
  const prevInbox = !booting && G && G.diploInbox ? G.diploInbox.filter(o => o.to === NET.myCountry).length : 0;
  G = g;
  G.playerId = NET.myCountry;
  G.rtPaused = false; // pause is a host-side concept; clients always render
  // the roster inside the snapshot is authoritative (QoL §17-18)
  if (G.mpPlayers) NET.humans = G.mpPlayers.filter(p => p.online).map(p => p.cid);
  // synthetic countries (rebels/aliens) need their NATIONS rows on this client
  for (const cid of Object.keys(G.countries)) {
    const c = G.countries[cid];
    if (c.rebel && !NATIONS[c.id]) NATIONS[c.id] = NATIONS[c.rebelOf] || NATIONS[2];
    if (c.alien && !NATIONS[c.id] && typeof registerAlienNation === "function") registerAlienNation(c);
  }
  // the host's generated galaxy (SU2 §6) travels inside the snapshot — rebuild
  // the runtime SPACE_SYSTEMS / SPACE_PLANETS arrays from it before rendering
  if (typeof ensureSpaceState === "function") ensureSpaceState();
  if (!booting) {
    const nowInbox = (G.diploInbox || []).filter(o => o.to === NET.myCountry).length;
    if (nowInbox > prevInbox) { toast("📨 A diplomatic offer awaits your answer — see Diplomacy."); sfx("toast"); }
  }
  if (booting) {
    NET.awaitBoot = false;
    if (NET.bootTimer) { clearTimeout(NET.bootTimer); NET.bootTimer = null; }
    netHideBoot();
    NET.lastEra = G.countries[NET.myCountry] ? G.countries[NET.myCountry].era : 1;
    startGameUI(); // warSessionStart builds CITY_ARR from the snapshot
    NET.citySig = netCitySig();
    NET.eraSig = netEraSig();
    NET.tintedOnce = true;
    toast("🌐 Connected — the host's world is live. Good luck, Commander.");
    return;
  }
  // indexes & repaints
  const sig = netCitySig();
  if (sig !== NET.citySig || !CITY_ARR) {
    NET.citySig = sig;
    rebuildCityIndex();
    Object.keys(maskCache).forEach(k => delete maskCache[k]);
    repaintTint();
  } else {
    netRefreshCityRefs();
    if (msg.md) { Object.keys(maskCache).forEach(k => delete maskCache[k]); repaintTint(); }
  }
  const era = netEraSig();
  if (era !== NET.eraSig || msg.md) { NET.eraSig = era; roadsMarkDirty(); }
  cityLayerDirty = true;
  spacePanelDirty = true;
  selArmies = selArmies.filter(id => armyById(id));
  // per-player consequences
  const mine = G.countries[NET.myCountry];
  if (mine) {
    if (mine.era > NET.lastEra) { NET.lastEra = mine.era; queueEraCelebration(mine.era); }
    applyEraTheme(mine.era);
    if (!mine.alive && !NET.deadShown) {
      NET.deadShown = true;
      G.defeated = true;
      showEnd(false, `Your nation has fallen. You may watch the world burn on, or return to the menu.`);
    }
  }
  if (G.victory && !NET.victoryShown) {
    NET.victoryShown = true;
    showEnd(G.victory.by === NET.myCountry);
  }
  const myOffers = (G.peaceOffers || []).filter(o => o.to === NET.myCountry);
  if (myOffers.length && !NET.peaceNotified) {
    NET.peaceNotified = true;
    toast(`${myOffers.map(o => G.countries[o.from].name).join(", ")} seek${myOffers.length > 1 ? "" : "s"} peace — see Diplomacy.`);
  }
  if (!myOffers.length) NET.peaceNotified = false;
  // refresh the interface exactly like a local tick would
  renderTopbar(); renderLog();
  if (typeof S !== "undefined" && S.music) S.music.check();
  const ae = document.activeElement;
  const sb = document.getElementById("sidebar");
  const typing = ae && sb && sb.contains(ae) && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT");
  if (!typing) renderSidebar();
  maybeShowEraTransition();
}

function netApplyDelta(d) {
  NET.hostNow = d.now || 0;
  const seen = new Set();
  const byId = new Map();
  for (const a of G.armies) byId.set(a.id, a);
  for (const row of d.ar || []) {
    const [id, owner, unit, x, y, hp, maxHp, stack, cargoN, tx, ty] = row;
    seen.add(id);
    let a = byId.get(id);
    if (!a) {
      a = { id, owner, unit, x, y, tx, ty, hp, maxHp, cd: 0, order: null };
      if (cargoN >= 0) a.cargo = [];
      G.armies.push(a);
    }
    a.owner = owner; a.unit = unit;
    a.nx = x; a.ny = y; a.tx = tx; a.ty = ty;
    a.hp = hp; a.maxHp = maxHp;
    if (stack > 1) a.stack = stack; else delete a.stack;
    if (cargoN >= 0) {
      a.cargo = a.cargo || [];
      while (a.cargo.length < cargoN) a.cargo.push({ unit: "club", hp: 1, maxHp: 1 });
      if (a.cargo.length > cargoN) a.cargo.length = cargoN;
    }
    if (Math.abs(a.x - x) > 60 || Math.abs(a.y - y) > 60) { a.x = x; a.y = y; } // teleports snap
  }
  if (d.ar) {
    G.armies = G.armies.filter(a => seen.has(a.id));
    if (selArmies.length) { selArmies = selArmies.filter(id => seen.has(id)); }
  }
  if (d.sh && G.space && G.space.ships) {
    const shipsById = new Map();
    for (const s of G.space.ships) shipsById.set(s.id, s);
    for (const [id, x, y, z, hp] of d.sh) {
      const s = shipsById.get(id);
      if (s) { s.x = x; s.y = y; s.z = z; s.hp = hp; }
    }
  }
  if (d.pa && G.space && G.space.planets) {
    SPACE_PLANETS.forEach((p, i) => { if (G.space.planets[p.id] && d.pa[i] !== undefined) G.space.planets[p.id].ang = d.pa[i]; });
  }
  // Final Alien Update Part 8: rebuild the ground battles from the host's stream
  if (d.pb !== undefined && G.space) {
    G.space.battles = (d.pb || []).map(r => ({
      planet: r[0], att: r[1], def: r[2], t: r[3], done: r[4], winner: r[5] < 0 ? null : r[5], ret: r[6], id: r[7],
      units: r[8].map(u => ({ id: u[0], side: u[1], unit: u[2], x: u[3], y: u[4], hp: u[5], maxHp: u[6], turret: u[7], drop: u[8], gone: u[9] })),
      fires: r[9].map(f => ({ x: f[0], y: f[1], r: f[2], s: f[3] })),
      sup: r[10] ? { x: r[10][0], y: r[10][1], t: 0.5 } : null,
      endT: r[11] || 0, uSeq: 1, supCd: 0, rfCd: 0,
    }));
  }
  missilesFly = (d.mf || []).map(r => ({
    type: r[0], x0: r[1], y0: r[2], tx: r[3], ty: r[4], gx: r[5], gy: r[6], alt: r[7], f: r[8], dist: r[9],
    owner: 0, t: 0, dur: 1,
  }));
  for (const fx of d.fx || []) {
    if (fx[0] === "s") {
      if (shotsFx.length < 320) shotsFx.push({
        x1: fx[2], y1: fx[3], x2: fx[4], y2: fx[5],
        ttl: fx[1] === "shell" ? 0.55 : 0.22, max: fx[1] === "shell" ? 0.55 : 0.22, kind: fx[1],
      });
    } else if (fx[0] === "b") {
      boomFx.push({ x: fx[1], y: fx[2], ttl: 0.45, max: 0.45 });
      spawnDebris(fx[1], fx[2], 8, fx[3] ? "#9ec8e8" : null);
      if (sndTimer <= 0) { sfx("boom"); sndTimer = 0.15; }
    } else if (fx[0] === "m") {
      boomFx.push({ x: fx[1], y: fx[2], ttl: fx[3] ? 2.4 : 0.9, max: fx[3] ? 2.4 : 0.9, kind: fx[3] ? "nuke" : "missile", r: fx[4] });
      spawnDebris(fx[1], fx[2], fx[3] ? 26 : 12);
      sfx(fx[3] ? "nukeBoom" : "mBoom");
    } else if (fx[0] === "i") {
      boomFx.push({ x: fx[1], y: fx[2], ttl: 0.55, max: 0.55, kind: "intercept", r: 26 });
    } else if (fx[0] === "h") { // hyper lazer strike (AI Improvements Part 12)
      boomFx.push({ x: fx[1], y: fx[2], ttl: 1.8, max: 1.8, kind: "hyper", r: fx[3] || 110 });
      spawnDebris(fx[1], fx[2], 24);
      sfx("nukeBoom");
    }
  }
}

// client-side smoothing between deltas
function netClientFrame(dt) {
  const k = Math.min(1, dt * 10);
  for (const a of G.armies) {
    if (a.nx === undefined) continue;
    a.x += (a.nx - a.x) * k;
    a.y += (a.ny - a.y) * k;
  }
}

// ---------------- client → host: commands ----------------
// Returns true when running as a multiplayer client — the action is sent to
// the host instead of running locally. Call sites bail out on true.
function netIntercept(fn, args, cb) {
  if (!NET.active || NET.isHost || !NET.started) return false;
  const id = NET.reqSeq++;
  if (cb) NET.pending[id] = cb;
  netSendToHost({ t: "cmd", id, fn, args });
  return true;
}

// host asks the winning client what to do with a broken nation
function netAskConquest(attId, defId) {
  if (!NET.isHost) return;
  const p = NET.lobby && NET.lobby.players.find(q => q.cid === attId);
  const conn = p && NET.conns.find(c => c.peer === p.peer);
  if (!conn) { // not connected after all — resolve instantly
    G.brokenPending = null;
    resolveConquest(attId, defId, "annex");
    return;
  }
  NET.pendingConquest = { att: attId, def: defId, age: 0 };
  netSendRaw(conn, { t: "conquest", def: defId });
}

// every command the host accepts from clients; cid is the sender's country.
// Each one re-validates ownership and cost — the client UI is advisory only.
const NET_HOST_CMDS = {
  move(cid, a) {
    const list = (a.ids || []).map(armyById).filter(x => x && x.owner === cid);
    if (!list.length) return null;
    const cols = Math.ceil(Math.sqrt(list.length));
    list.forEach((m, i) => {
      const ox = (i % cols - (cols - 1) / 2) * 18;
      const oy = (Math.floor(i / cols) - (Math.ceil(list.length / cols) - 1) / 2) * 18;
      m.tx = clamp(Number(a.x) + ox, 2, MW - 2); m.ty = clamp(Number(a.y) + oy, 2, MH - 2);
      m.order = { type: "move" };
    });
    return null;
  },
  attack(cid, a) {
    const t = armyById(a.target);
    if (!t || !atWar(cid, t.owner)) return null;
    for (const id of a.ids || []) {
      const s = armyById(id);
      if (s && s.owner === cid) s.order = { type: "attack", id: t.id };
    }
    return null;
  },
  board(cid, a) {
    const t = armyById(a.ship);
    if (!t || t.owner !== cid || !UNITS[t.unit].cap) return null;
    for (const id of a.ids || []) {
      const s = armyById(id);
      // canBoardTransport now also admits Orbital Marines onto space cargo (SU2 §1)
      if (s && s.owner === cid && canBoardTransport(t, s.unit)) s.order = { type: "board", id: t.id };
    }
    return null;
  },
  etoggle(cid, a) {
    let acted = 0;
    for (const id of a.ids || []) {
      const s = armyById(id);
      if (!s || s.owner !== cid || !UNITS[s.unit].cap) continue;
      s.cargo = s.cargo || [];
      if (s.cargo.length && findLandNear(s.x, s.y, TRANSPORT_DEPLOY_R)) {
        let n = 0;
        while (s.cargo.length) {
          const spot = findLandNear(s.x + rnd(-10, 10), s.y + rnd(-10, 10), TRANSPORT_DEPLOY_R);
          if (!spot) break;
          const cu = s.cargo.pop();
          const na = spawnArmy(s.owner, cu.unit, spot.x, spot.y);
          na.hp = Math.min(cu.hp, na.maxHp);
          n++;
        }
        acted += n;
      } else {
        const cap = UNITS[s.unit].cap;
        const near = G.armies.filter(m => m.owner === cid && m !== s &&
          canBoardTransport(s, m.unit) &&
          (m.x - s.x) ** 2 + (m.y - s.y) ** 2 <= TRANSPORT_LOAD_R ** 2);
        while (s.cargo.length < cap && near.length) {
          const m = near.shift();
          s.cargo.push({ unit: m.unit, hp: m.hp, maxHp: m.maxHp });
          removeArmyQuiet(m);
          acted++;
        }
      }
    }
    return acted ? { msg: `⛴ Transport order carried out (${acted} unit${acted > 1 ? "s" : ""}).`, sfx: "move" } : { msg: "Nothing to load or deploy there." };
  },
  merge(cid, a) {
    const list = (a.ids || []).map(armyById).filter(x => x && x.owner === cid);
    const chk = mergeCheck(list);
    if (!chk.ok) return { msg: chk.why };
    const C = G.countries[cid];
    if (C.res.money < chk.cost) return { msg: `Merging these units costs ${chk.cost}💰.` };
    C.res.money -= chk.cost;
    const lead = mergeArmies(list);
    boomFx.push({ x: lead.x, y: lead.y, ttl: 0.4, max: 0.4, kind: "intercept", r: 18 });
    return { msg: `⚔ Merged into a ×${lead.stack} ${UNITS[lead.unit].n} stack.`, sfx: "recruit" };
  },
  disband(cid, a) {
    const list = (a.ids || []).map(armyById).filter(x => x && x.owner === cid);
    if (!list.length) return null;
    const C = G.countries[cid];
    let pop = 0, units = 0;
    for (const m of list) {
      units += (m.stack || 1) + ((m.cargo && m.cargo.length) || 0);
      pop += Math.min(0.3, 0.02 + UNITS[m.unit].up * 0.002) * (m.stack || 1);
      for (const cu of m.cargo || []) pop += Math.min(0.3, 0.02 + UNITS[cu.unit].up * 0.002);
      removeArmyQuiet(m);
    }
    C.pop += Math.round(pop * 100) / 100;
    return { msg: `🏳 ${units} unit${units > 1 ? "s" : ""} disbanded.` };
  },
  recruit(cid, a) {
    const home = G.countries[a.ph];
    const prov = home && home.provinces[a.pi];
    const u = UNITS[a.u];
    const C = G.countries[cid];
    if (!prov || !u || provCtrl(prov) !== cid) return { msg: "That city is not yours." };
    if (!unitAvailable(C, a.u)) return { msg: "Technology required." };
    if (u.naval && !canBuildUnitAt(prov, a.u)) return { msg: u.raft ? "Rafts need a coastal city." : "Ships need a coastal city with a completed ⚓ Port." };
    if (u.space && !((prov.b.spaceprogram || 0) > 0)) return { msg: "Spacecraft need a 🚀 Space Program city." };
    if (armyCount(cid) >= armyCap(C)) return { msg: `Army cap reached (${armyCap(C)}).` };
    const cost = recruitCost(C, a.u);
    if (C.res.money < cost.money || C.res.mat < cost.mat) return { msg: "Not enough resources." };
    C.res.money -= cost.money; C.res.mat -= cost.mat;
    queueRecruit(cid, a.u, prov);
    return { msg: `${u.n} mustering at ${prov.city}.`, sfx: "recruit" };
  },
  build(cid, a) {
    const home = G.countries[a.ph];
    const prov = home && home.provinces[a.pi];
    const C = G.countries[cid];
    if (!prov || provCtrl(prov) !== cid || prov.own !== cid) return { msg: "That city is not yours." };
    if (!BLDGS[a.b] || !bldgAvailable(C, a.b)) return { msg: "Building unavailable." };
    if (BLDGS[a.b].coastal && !cityIsCoastal(prov)) return { msg: "Ports need a coastal city." };
    const r = enqueueBuilding(C, prov, a.b);
    return { msg: r.msg, sfx: r.ok ? "coin" : undefined };
  },
  cancelB(cid, a) {
    const home = G.countries[a.ph];
    const prov = home && home.provinces[a.pi];
    if (!prov || provCtrl(prov) !== cid) return null;
    cancelBuilding(G.countries[cid], prov, a.i);
    return { msg: "Construction cancelled — costs refunded." };
  },
  cancelR(cid, a) {
    const home = G.countries[a.ph];
    const prov = home && home.provinces[a.pi];
    if (!prov || provCtrl(prov) !== cid) return null;
    cancelRecruit(G.countries[cid], prov, a.i);
    return { msg: "Mustering cancelled — costs refunded." };
  },
  upgrade(cid, a) {
    const home = G.countries[a.ph];
    const prov = home && home.provinces[a.pi];
    if (!prov || provCtrl(prov) !== cid) return { msg: "That city is not yours." };
    const r = upgradeCity(G.countries[cid], prov);
    return { msg: r.ok ? `${prov.city} is now level ${prov.lvl}.` : r.msg, sfx: r.ok ? "coin" : undefined };
  },
  demolish(cid, a) {
    const home = G.countries[a.ph];
    const prov = home && home.provinces[a.pi];
    if (!prov || provCtrl(prov) !== cid || prov.occ) return { msg: "That city cannot be managed." };
    const r = demolishBuilding(G.countries[cid], prov, a.b);
    return { msg: r.msg };
  },
  rename(cid, a) {
    const home = G.countries[a.ph];
    const prov = home && home.provinces[a.pi];
    if (!prov || provCtrl(prov) !== cid) return { msg: "That city is not yours." };
    const r = renameCity(G.countries[cid], prov, String(a.name || ""));
    if (r.ok) cityLayerDirty = true;
    return { msg: r.ok ? `City renamed to ${prov.city}.` : r.msg };
  },
  found(cid, a) {
    if (!Array.isArray(a.rle) || a.rle.length > 120000) return { msg: "Invalid province shape." };
    let area = 0;
    for (let k = 0; k + 2 < a.rle.length; k += 3) area += a.rle[k + 2];
    if (area < PROV_MIN_AREA || area > PROV_MAX_AREA) return { msg: "The province size is out of bounds." };
    // spot-check that the drawn land actually belongs to the founder
    for (let k = 0; k + 2 < a.rle.length; k += Math.max(3, Math.floor(a.rle.length / 60) * 3)) {
      const i = a.rle[k] * MW + a.rle[k + 1];
      if (i < 0 || i >= MW * MH || !CITY_ARR[i]) return { msg: "The province must lie inside your borders." };
      const p = CITIES[CITY_ARR[i] - 1].prov;
      if (p.own !== cid || p.occ) return { msg: "The province must lie inside your unoccupied borders." };
    }
    const r = foundCity(cid, String(a.name || "New City"), Number(a.x) | 0, Number(a.y) | 0, a.rle);
    return { msg: r.ok ? "🏙 City founded!" : r.msg, sfx: r.ok ? "capture" : undefined };
  },
  research(cid, a) {
    const C = G.countries[cid];
    const t = techById(a.tid);
    if (!t || C.researched[a.tid] || !techUnlocked(C, t)) return null;
    C.rpStored = C.rpStored || {};
    if (C.researching) C.rpStored[C.researching] = C.rp;
    C.researching = a.tid;
    C.rp = C.rpStored[a.tid] || 0;
    return null;
  },
  policy(cid, a) {
    const C = G.countries[cid];
    if (!(a.k in C.policies)) return null;
    const max = (a.k === "trade" || a.k === "consc") ? 1 : 2;
    C.policies[a.k] = clamp(Number(a.v) | 0, 0, max);
    return null;
  },
  customize(cid, a) {
    const kinds = ["name", "flag", "title", "lang", "gov", "capital"];
    if (!kinds.includes(a.kind)) return null;
    const r = netWithPlayer(cid, () => customize(a.kind, a.value));
    if (a.kind === "name" || a.kind === "capital") mapOwnershipChanged();
    return { msg: r.ok ? "Done." : r.msg };
  },
  diplo(cid, a) { return netDiploHost(cid, a.act, Number(a.target)); },
  acceptPeace(cid, a) {
    const from = Number(a.from);
    if (!(G.peaceOffers || []).some(o => o.from === from && o.to === cid)) return null;
    makePeace(cid, from, false);
    G.peaceOffers = G.peaceOffers.filter(o => !(o.from === from && o.to === cid));
    return { msg: `Peace with ${G.countries[from].name}.` };
  },
  spy(cid, a) {
    const t = Number(a.target);
    if (!G.countries[t] || !G.countries[t].alive || t === cid) return null;
    if (!["steal", "reveal", "sabotage", "unrest"].includes(a.action)) return null;
    return spy(cid, t, a.action);
  },
  talk(cid, a) {
    if (!["citizen", "mayor", "leader"].includes(a.kind)) return null;
    const target = a.kind === "leader" ? Number(a.target) : null;
    if (a.kind === "leader" && (!G.countries[target] || !G.countries[target].alive)) return null;
    return netWithPlayer(cid, () => converse(a.kind, target, String(a.text || "").slice(0, 140)));
  },
  mbuild(cid, a) {
    const r = buildMissile(G.countries[cid], a.m);
    return { msg: r.ok ? `${MISSILE_TYPES[a.m].n} constructed.` : r.msg, sfx: r.ok ? "recruit" : undefined };
  },
  mlaunch(cid, a) {
    const C = G.countries[cid];
    const home = G.countries[a.ph];
    const prov = home && home.provinces[a.pi];
    if (!prov || provCtrl(prov) !== cid || !(prov.b.silo > 0)) return { msg: "No available silo." };
    if (!MISSILE_TYPES[a.type] || !missileAvailable(C, a.type)) return { msg: "Missile unavailable." };
    const stock = missileStock(C);
    if ((stock[a.type] || 0) <= 0) return { msg: "No missile of that type in stock." };
    const tx = clamp(Number(a.tx) | 0, 2, MW - 2), ty = clamp(Number(a.ty) | 0, 2, MH - 2);
    const targetArmy = a.targetArmy ? armyById(a.targetArmy) : null;
    // who gets hit? undeclared strikes mean war, exactly like the host's own
    let victim = null;
    if (targetArmy) victim = targetArmy.owner;
    else {
      const cAt = cityAt(tx, ty, MISSILE_TYPES[a.type].radius);
      if (cAt) victim = provCtrl(cAt.prov);
      else { const i = ty * MW + tx; if (ID_ARR[i]) victim = controllerOf(ID_ARR[i]); }
    }
    if (victim === cid && !targetArmy) return { msg: "That would strike your own territory." };
    if (victim !== null && victim !== cid && !atWar(cid, victim)) declareWar(cid, victim);
    stock[a.type]--;
    launchMissile(cid, prov, a.type, tx, ty, targetArmy ? targetArmy.id : null);
    return { msg: `${MISSILE_TYPES[a.type].icon} ${MISSILE_TYPES[a.type].n} away.` };
  },
  conquest(cid, a) {
    if (!NET.pendingConquest || NET.pendingConquest.att !== cid || NET.pendingConquest.def !== Number(a.def)) return null;
    NET.pendingConquest = null;
    G.brokenPending = null;
    const how = ["annex", "vassal", "demand", "peace"].includes(a.how) ? a.how : "peace";
    const defId = Number(a.def);
    if (!G.countries[defId]) return null;
    resolveConquest(cid, defId, how);
    if (how === "peace") {
      G.rel[defId][cid] = clamp(G.rel[defId][cid] + 30, -100, 100);
      G.trust[defId][cid] = clamp(G.trust[defId][cid] + 20, 0, 100);
    }
    checkVictory();
    return { msg: `The fate of ${G.countries[defId].name} is sealed.` };
  },
  // ---- space ----
  launch(cid, a) {
    const C = G.countries[cid];
    const list = (a.ids || []).map(armyById).filter(x => x && x.owner === cid && UNITS[x.unit].space);
    if (!list.length) return null;
    if (!spaceProgramCity(cid)) return { msg: "You need a city with a completed 🚀 Space Program to launch." };
    const money = SPACE_COSTS.launch.money * list.length;
    const energy = SPACE_COSTS.launch.energy * list.length;
    if (C.res.money < money) return { msg: `Launching needs ${money}💰.` };
    if (C.res.energy < energy) return { msg: `Launching needs ${energy}⚡ spare energy.` };
    C.res.money -= money; C.res.energy -= energy;
    for (const m of list) launchArmyToSpace(m);
    log(`🚀 ${list.length} of ${C.name}'s spacecraft lift into orbit.`, "sys");
    return { msg: `🚀 ${list.length} craft launched — open the 🌌 Space view to command them.`, sfx: "launch" };
  },
  shipMove(cid, a) {
    const s = shipById(a.id);
    if (!s || s.owner !== cid || !planetDef(a.planet)) return null;
    s.target = a.planet; s.orbit = null; s.chase = null;
    return null;
  },
  shipChase(cid, a) {
    const s = shipById(a.id), t = shipById(a.target);
    if (!s || s.owner !== cid || !t || t.owner === cid || !atWar(cid, t.owner)) return null;
    s.chase = t.id; s.target = null; s.orbit = null;
    return null;
  },
  spaceE(cid, a) {
    const s = shipById(a.id);
    if (!s || s.owner !== cid) return null;
    const near = shipNearestPlanet(s); // NEAREST world, not first-in-array (SU2 §10/§12)
    if (!near) return { msg: "Fly next to a planet first." };
    if (near.type === "main") { landShip(s); return { msg: `🌍 ${UNITS[s.unit].n} lands on the Homeworld.` }; }
    const st = planetState(near.id);
    if (st.colony && st.colony.owner === cid) {
      if (s.cargo && s.cargo.length) { deployCargoToColony(s, near.id); return { msg: `👾 Troops deployed to ${near.n}.` }; }
      loadGarrison(s, near.id); return { msg: `⛴ Garrison loaded at ${near.n}.` };
    }
    if (st.colony && atWar(cid, st.colony.owner)) {
      const ok = resolveInvasion(s, near.id);
      return { msg: ok ? `⚔ Assault on ${near.n} under way.` : `The landing on ${near.n} could not begin.` };
    }
    return { msg: "Nothing to do here — colonize the planet first." };
  },
  colonize(cid, a) {
    const near = shipsOfNation(cid).some(s => shipNearPlanet(s, a.planet));
    if (!near) return { msg: "A ship of yours must reach the planet first." };
    const ok = colonizePlanet(cid, a.planet, true);
    return { msg: ok ? `🪐 Colony founded on ${planetDef(a.planet).n}!` : "Colonization failed — check technology and resources.", sfx: ok ? "capture" : undefined };
  },
  colonyUp(cid, a) {
    const ok = upgradeColony(cid, a.planet, true);
    const st = planetState(a.planet);
    return { msg: ok ? `🪐 Colony on ${planetDef(a.planet).n} grows to level ${st.colony.lvl}.` : "Upgrade failed — check resources.", sfx: ok ? "coin" : undefined };
  },
  halo(cid, a) {
    const ok = startHalo(cid, a.planet);
    return { msg: ok ? "⭕ Halo Ring construction begins." : "Halo Ring could not be started.", sfx: ok ? "coin" : undefined };
  },
  dyson(cid, a) {
    // Final Space Fixes §2+§5: clients build around any secured star — the
    // host runs the same canBuildDyson rulebook as everyone else
    const ok = payDysonStage(cid, (a && a.sys) || "home");
    return { msg: ok ? "☀ Dyson Sphere stage funded." : "Dyson stage could not be started.", sfx: ok ? "coin" : undefined };
  },
  spaceDeploy(cid, a) {
    const s = shipById(a.id);
    if (!s || s.owner !== cid) return null;
    deployCargoToColony(s, a.planet);
    return null;
  },
  spaceLoad(cid, a) {
    const s = shipById(a.id);
    if (!s || s.owner !== cid) return null;
    loadGarrison(s, a.planet);
    return null;
  },
  invade(cid, a) {
    const s = shipById(a.id);
    if (!s || s.owner !== cid) return null;
    const st = planetState(a.planet);
    if (!st.colony || !atWar(cid, st.colony.owner)) return null;
    const ok = resolveInvasion(s, a.planet);
    return { msg: ok ? `⚔ Assault on ${planetDef(a.planet).n} under way.` : `The landing on ${planetDef(a.planet).n} could not begin.` };
  },
  // Final Alien Update Part 8: a client orders its landing force to fall back
  pbRetreat(cid, a) {
    const b = (G.space && G.space.battles || []).find(x => x.planet === a.planet && !x.done);
    if (!b || b.att !== cid || b.ret) return null;
    b.ret = 1;
    return { msg: "🏳 Retreat ordered — the landing force falls back to the drop zone." };
  },
  nova(cid, a) {
    const s = shipById(a.id);
    if (!s || s.owner !== cid) return null;
    const chk = canDestroyPlanet(s, a.planet);
    if (!chk.ok) return { msg: chk.why || "Unavailable." };
    const fired = destroyPlanet(s, a.planet);
    if (!fired) return { msg: "The core cannon did not fire." };
    const st = planetState(a.planet);
    return { msg: st.destroyed ? `🌠 ${planetDef(a.planet).n} is no more.` : `🛡 A Giant Shield absorbed the beam.` };
  },
  // Update: the galactic core (Black Hole Energy Harvester) & Phantom Step
  bhStage(cid) {
    const ok = startBHStage(cid);
    return { msg: ok ? "🕳 Harvester construction stage funded." : "The Harvester stage could not be started.", sfx: ok ? "coin" : undefined };
  },
  bhResume(cid) {
    const ok = resumeBH(cid);
    return { msg: ok ? "🚧 Harvester construction resumes." : "Nothing to resume." };
  },
  bhShare(cid) {
    const ok = bhToggleShare(cid);
    const bhH = G.space.bhH;
    return { msg: ok ? (bhH.share ? "🤝 Allied Star Destroyers may now use your Harvester." : "🤝 Ally charging disabled.") : "Only the Harvester's owner can change that." };
  },
  bhCharge(cid, a) {
    const s = shipById(a.id);
    if (!s || s.owner !== cid) return null;
    const chk = canBHCharge(s);
    if (!chk.ok) return { msg: chk.why || "Unavailable." };
    const ok = startBHCharge(s);
    return { msg: ok ? "🕳 Charging from the black hole…" : "The charge could not begin." };
  },
  bhStrike(cid, a) {
    const s = shipById(a.id);
    if (!s || s.owner !== cid) return null;
    const ok = sdStrikeHarvester(s);
    return { msg: ok ? "🌠 The core cannon hammers the Harvester." : "The cannon did not fire." };
  },
  phantom(cid, a) {
    const ok = activatePhantom(cid, a.sys);
    return { msg: ok ? `🌫 Phantom Step active — the ${systemDef(a.sys).n} system is cloaked.` : "Phantom Step could not be activated." };
  },
  resDeep(cid, a) {
    const ok = upgradeResearcherDeep(cid, a.id);
    return { msg: ok ? "🔭 Deep Space Research Station complete." : "The upgrade could not be made.", sfx: ok ? "coin" : undefined };
  },
  deepScan(cid, a) {
    const ok = deepScanPhantom(cid, a.id);
    return { msg: ok ? "🔭 Deep scan complete." : "The deep scan could not run." };
  },
  // Small Update: stellar harvesting and the Omni-Hypercharged Orbital Laser
  harvest(cid, a) {
    const s = shipById(a.id);
    if (!s || s.owner !== cid) return null;
    const chk = canHarvestStar(s, a.sys);
    if (!chk.ok) return { msg: chk.why || "The harvest could not begin." };
    const ok = startStellarHarvest(s, a.sys);
    return { msg: ok ? `🌞 Harvesting stellar energy from ${systemDef(a.sys).n}.` : "The harvest could not begin." };
  },
  omni(cid, a) {
    const s = shipById(a.id);
    if (!s || s.owner !== cid) return null;
    const chk = canOmniStrike(s, a.sys);
    if (!chk.ok) return { msg: chk.why || "Unavailable." };
    const fired = omniStrike(s, a.sys);
    return { msg: fired ? `💥 The ${systemDef(a.sys).n} system has been annihilated.` : "The Omni Laser did not fire." };
  },
  // ---- Space Update commands ----
  shipFree(cid, a) {
    const s = shipById(a.id);
    if (!s || s.owner !== cid) return null;
    const x = Number(a.x) || 0, y = clamp(Number(a.y) || 0, -80, 80), z = Number(a.z) || 0;
    const trav = canTravelTo(cid, x, z);
    if (!trav.ok) return { msg: trav.why };
    s.free = { x, y, z }; s.target = null; s.orbit = null; s.chase = null;
    return null;
  },
  sdBombard(cid, a) {
    const s = shipById(a.id);
    if (!s || s.owner !== cid || !isSD(s)) return null;
    return bombardHomeworld(s) ? { msg: "🔥 The core cannon rakes the Homeworld." } : { msg: "The cannon did not fire." };
  },
  // AI Improvements Part 12: a client fires its Star Destroyer's hyper lazer
  hyper(cid, a) {
    const s = shipById(a.id);
    if (!s || s.owner !== cid || !isSD(s)) return null;
    const st = hyperLazerStatus(s);
    if (!st.ready) return { msg: st.cd > 0 ? `🔦 Recharging — ${st.cd} tick${st.cd > 1 ? "s" : ""} left.` : !st.nearHome ? "🔦 The ship must hold orbit of the Homeworld." : `🔦 Firing needs ${HYPER_LAZER.money}💰 ${HYPER_LAZER.energy}⚡.` };
    const C = G.countries[cid];
    C.res.money -= HYPER_LAZER.money;
    C.res.energy = Math.max(0, C.res.energy - HYPER_LAZER.energy);
    s.hlCd = HYPER_LAZER.cd;
    hyperStrikes.push({ x: clamp(Number(a.x) || 0, 2, MW - 2), y: clamp(Number(a.y) || 0, 2, MH - 2), t: 0, dur: HYPER_LAZER.delay, owner: cid, shipId: s.id });
    log(`🔦 ${C.name}'s Star Destroyer paints a target from orbit!`, "war");
    return { msg: "🔦 Hyper lazer charging — impact imminent.", sfx: "launch" };
  },
  // AI Improvements Part 14.3: colony industry construction
  colonyBld(cid, a) {
    if (!COLONY_BLDGS[a.b]) return null;
    return buildColonyBldg(cid, a.planet, String(a.b), true)
      ? { msg: `${COLONY_BLDGS[a.b].icon} ${COLONY_BLDGS[a.b].n} built.`, sfx: "build" }
      : { msg: "Construction failed — check slots, technology and resources." };
  },
  sdDyson(cid, a) {
    const s = shipById(a.id);
    if (!s || s.owner !== cid || !isSD(s)) return null;
    if (!SPACE_SYSTEMS.some(sy => sy.id === a.sys)) return null;
    return attackDyson(s, a.sys) ? { msg: "☀ The core cannon fires on the Dyson Sphere." } : { msg: "The cannon did not fire." };
  },
  shieldBuild(cid, a) {
    if (!["planet", "dyson", "researcher"].includes(a.kind)) return null;
    return buildShield(cid, a.kind, a.id, true) ? { msg: "🛡 Giant Shield raised.", sfx: "era" } : { msg: "The shield could not be raised." };
  },
  // AI Update §13: Void Shields — build, repair, and Star Destroyer strikes
  vshield(cid, a) {
    if (!SPACE_SYSTEMS.some(sy => sy.id === a.sys)) return null;
    return payVoidShield(cid, a.sys)
      ? { msg: `🌐 Void Shield construction begins around ${systemDef(a.sys).n}.`, sfx: "build" }
      : { msg: "The Void Shield could not be raised." };
  },
  vshieldFix(cid, a) {
    if (!SPACE_SYSTEMS.some(sy => sy.id === a.sys)) return null;
    return repairVoidShield(cid, a.sys) ? { msg: "🌐 Void Shield restored to full strength." } : { msg: "Repair failed." };
  },
  sdVShield(cid, a) {
    const s = shipById(a.id);
    if (!s || s.owner !== cid || !isSD(s)) return null;
    if (!SPACE_SYSTEMS.some(sy => sy.id === a.sys)) return null;
    return sdStrikeVoidShield(s, a.sys) ? { msg: "🌠 The core cannon hammers the Void Shield." } : { msg: "The cannon did not fire." };
  },
  shieldRepair(cid, a) {
    if (!["planet", "dyson", "researcher"].includes(a.kind)) return null;
    return repairShield(cid, a.kind, a.id, true) ? { msg: "🛡 Shield restored to full charge." } : { msg: "Repair failed." };
  },
  rehab(cid, a) {
    return startRehab(cid, a.planet, true) ? { msg: "♻ Rehabilitator deployed." } : { msg: "Rehabilitation could not begin." };
  },
  researcherBuild(cid, a) {
    const x = Number(a.x) || 0, y = clamp(Number(a.y) || 0, -80, 80), z = Number(a.z) || 0;
    const r = buildResearcher(cid, x, y, z, true);
    if (r) return { msg: "🌆 Researcher completed.", sfx: "era" };
    // BUG REPORT (Researcher Restrictions §9): the exact blocking reason
    // travels back to the building player — never a silent refusal
    const chk = typeof researcherSiteCheck === "function" ? researcherSiteCheck(cid, x, y, z) : null;
    return { msg: chk && !chk.ok ? chk.why : "Construction failed — check technology and resources." };
  },
  researcherUp(cid, a) { return upgradeResearcher(cid, a.id, true) ? { msg: "🌆 Researcher expanded." } : { msg: "Expansion failed." }; },
  researcherLocate(cid, a) { return locateInterstellarLife(cid, a.id, true) ? { msg: "📡 Deep scan complete — see the log." } : { msg: "The scan could not run." }; },
  researcherRepair(cid, a) { return repairResearcher(cid, a.id, true) ? { msg: "🌆 Researcher repaired." } : { msg: "Repair failed." }; },
  researcherRevive(cid, a) { return reviveResearcher(cid, a.id, true) ? { msg: "🌆 Researcher restored — its upgrades survive." } : { msg: "Restoration failed." }; },
  capital(cid, a) { return setCapitalPlanet(cid, a.planet, true) ? { msg: "★ Capital planet proclaimed." } : { msg: "The capital could not be moved." }; },
  alienTalk(cid, a) { return alienTalk(cid, Number(a.aid), String(a.act || "")); },
  // ---- Space Update 2 commands ----
  milup(cid, a) {
    const r = startMilUpgrade(cid, String(a.k || ""), true);
    return { msg: r.msg, sfx: r.ok ? "coin" : undefined };
  },
  milupCancel(cid) {
    const c = G.countries[cid];
    if (!c || !c.milResearching) return null;
    c.milResearching = null;
    return { msg: "Upgrade research abandoned." };
  },
  // ---- QoL update commands ----
  pchat(cid, a) { return netPchatHost(cid, Number(a.to), String(a.text || "").slice(0, 200)); },
  inbox(cid, a) { return netInboxAnswer(cid, Number(a.id), !!a.accept); },
};

// run an engine function that was written in terms of "the player"
function netWithPlayer(cid, fn) {
  const orig = G.playerId;
  G.playerId = cid;
  try { return fn(); } finally { G.playerId = orig; }
}

// host-side diplomacy on behalf of a client — mirrors doDiplo() in ui.js
function netDiploHost(cid, act, t) {
  const C = G.countries[cid], T = G.countries[t];
  if (!T || !T.alive || t === cid) return null;
  if (T.rebel || T.alien) return { msg: "They answer no envoys." };
  // player-to-player diplomacy (QoL §3): requests aimed at a country led by a
  // human are delivered to that player's inbox — the AI never answers for them
  if (isHumanControlled(t)) {
    const routed = netDiploToHuman(cid, act, t);
    if (routed !== undefined) return routed;
  }
  switch (act) {
    case "improve": return actImprove(cid, t);
    case "gift": {
      if (C.res.money < 200) return { msg: "Not enough money." };
      C.res.money -= 200; T.res.money += 200;
      G.rel[t][cid] = clamp(G.rel[t][cid] + 10, -100, 100);
      for (const pr of G.promises) if (pr.type === "aid" && pr.from === cid && pr.to === t && !pr.done && !pr.broken) pr.data.paid = true;
      return { msg: `Aid sent to ${T.name} (+10 relations).`, sfx: "coin" };
    }
    case "trade":
      if (hasTrade(cid, t)) return { msg: "Trade already flows." };
      if (aiAccepts(t, cid, "trade")) { G.trades.push([cid, t]); return { msg: "Trade agreement signed." }; }
      return { msg: `${T.name} declines.` };
    case "alliance":
      if (allied(cid, t)) return { msg: "Already allied." };
      if (aiAccepts(t, cid, "alliance")) { G.alliances.push([cid, t]); return { msg: "Alliance formed!" }; }
      return { msg: `${T.name} declines — build relations (55+) and trust (40+).` };
    case "access":
      if (hasAccess(cid, t)) return { msg: "Access already granted." };
      if (aiAccepts(t, cid, "access")) { G.accessPacts.push([cid, t]); return { msg: "Military access granted." }; }
      return { msg: `${T.name} declines.` };
    case "research":
      if (hasRP(cid, t)) return { msg: "Pact already signed." };
      if (aiAccepts(t, cid, "research")) { G.researchPacts.push([cid, t]); bumpMods(); return { msg: "Research agreement signed (+8% research both)." }; }
      return { msg: `${T.name} declines.` };
    case "demand":
      if (aiAccepts(t, cid, "demand")) {
        const entries = provsOfNation(t).filter(e => !(e.home.id === t && e.idx === T.capital));
        if (entries.length) {
          const e2 = entries[0];
          e2.p.own = cid; e2.p.occ = null; e2.p.unrest = 6;
          G.rel[t][cid] = clamp(G.rel[t][cid] - 40, -100, 100);
          mapOwnershipChanged();
          return { msg: `${T.name} cedes ${e2.p.name}!` };
        }
        return null;
      }
      G.rel[t][cid] = clamp(G.rel[t][cid] - 20, -100, 100);
      return { msg: `${T.name} refuses. Relations suffer.` };
    case "vassal":
      if (aiAccepts(t, cid, "vassal")) { G.vassals[t] = cid; mapOwnershipChanged(); return { msg: `${T.name} submits as your subject!` }; }
      G.rel[t][cid] = clamp(G.rel[t][cid] - 30, -100, 100);
      return { msg: `${T.name} defies you.` };
    case "war":
      if (atWar(cid, t)) return null;
      declareWar(cid, t);
      return { msg: `⚔ War declared on ${T.name}!` };
    case "peace":
      if (!atWar(cid, t)) return null;
      if (aiAccepts(t, cid, "peace")) { makePeace(cid, t, false); return { msg: "Peace agreed." }; }
      return { msg: `${T.name} fights on.` };
    case "demandocc":
      if (!atWar(cid, t)) return null;
      if (aiAccepts(t, cid, "surrender_demand")) { makePeace(cid, t, true); return { msg: "Territory ceded. Peace." }; }
      return { msg: `${T.name} refuses your terms.` };
  }
  return null;
}

// ---------------- player-to-player diplomacy (QoL §3-§6) ----------------
const DIPLO_ACT_LABEL = {
  trade: "Trade offer", alliance: "Alliance request", access: "Military access request",
  research: "Research agreement", demand: "Territorial demand", vassal: "Subjugation demand",
  demandocc: "Peace-for-territory demand",
};
function netPlayerLabel(cid) {
  const p = G && G.mpPlayers ? G.mpPlayers.find(q => q.cid === Number(cid)) : null;
  return p ? `${p.name} (${G.countries[cid].name})` : G.countries[cid].name;
}
function netNotifyInbox(t) {
  if (!G) return;
  if (Number(t) === G.playerId) {
    if (typeof toast === "function") toast("📨 A diplomatic offer awaits your answer — see Diplomacy.");
    sfx("toast");
    if (typeof uiTab !== "undefined" && uiTab === "diplo" && typeof renderSidebar === "function") renderSidebar();
    return;
  }
  if (typeof NET === "undefined" || !NET.active || !NET.isHost) return;
  const p = NET.lobby && NET.lobby.players.find(q => q.cid === Number(t));
  const conn = p && NET.conns.find(c2 => c2.peer === p.peer);
  if (conn) netSendRaw(conn, { t: "inboxNote" });
}
// a diplomatic act aimed at a human player: consent-free acts run directly,
// everything needing an answer lands in G.diploInbox. Returns undefined to
// fall through to the plain AI handling (never happens for listed acts).
function netDiploToHuman(cid, act, t) {
  const C = G.countries[cid], T = G.countries[t];
  switch (act) {
    case "improve": return actImprove(cid, t);
    case "gift": {
      if (C.res.money < 200) return { msg: "Not enough money." };
      C.res.money -= 200; T.res.money += 200;
      G.rel[t][cid] = clamp(G.rel[t][cid] + 10, -100, 100);
      for (const pr of G.promises) if (pr.type === "aid" && pr.from === cid && pr.to === t && !pr.done && !pr.broken) pr.data.paid = true;
      return { msg: `Aid sent to ${T.name} (+10 relations).`, sfx: "coin" };
    }
    case "war":
      if (atWar(cid, t)) return null;
      declareWar(cid, t); // netNotifyWar inside declareWar informs the target
      return { msg: `⚔ War declared on ${T.name}!` };
    case "peace": {
      if (!atWar(cid, t)) return null;
      G.peaceOffers = G.peaceOffers || [];
      if (G.peaceOffers.some(o => o.from === cid && o.to === t)) return { msg: "Your peace offer is already on their table." };
      G.peaceOffers.push({ from: cid, to: t });
      log(`${C.name} seeks peace with ${T.name}.`, "sys");
      netNotifyInbox(t);
      return { msg: `🕊 Peace offer sent to ${netPlayerLabel(t)}.` };
    }
    case "trade": case "alliance": case "access": case "research": case "demand": case "vassal": case "demandocc": {
      if (act === "trade" && hasTrade(cid, t)) return { msg: "Trade already flows." };
      if (act === "alliance" && allied(cid, t)) return { msg: "Already allied." };
      if (act === "access" && hasAccess(cid, t)) return { msg: "Access already granted." };
      if (act === "research" && hasRP(cid, t)) return { msg: "Pact already signed." };
      if (act === "demandocc" && !atWar(cid, t)) return null;
      if ((act === "trade" || act === "alliance" || act === "access" || act === "research") && atWar(cid, t)) {
        return { msg: "Make peace first." };
      }
      G.diploInbox = G.diploInbox || [];
      if (G.diploInbox.some(o => o.from === cid && o.to === t && o.kind === act && o.status === "pending")) {
        return { msg: "That offer is already awaiting their answer." };
      }
      G.inboxSeq = (G.inboxSeq || 0) + 1;
      G.diploInbox.push({ id: G.inboxSeq, from: cid, to: t, kind: act, turn: G.turn, status: "pending" });
      log(`📨 ${C.name} sends ${T.name} a ${DIPLO_ACT_LABEL[act].toLowerCase()}.`, "sys");
      netNotifyInbox(t);
      return { msg: `📨 ${DIPLO_ACT_LABEL[act]} sent to ${netPlayerLabel(t)} — awaiting their answer.` };
    }
  }
  return undefined;
}
// AI-initiated offers to human players also land in the inbox instead of
// being silently signed (QoL §3): "the AI never decides for a human"
function netOfferToHuman(from, kind, to) {
  if (!G) return false;
  G.diploInbox = G.diploInbox || [];
  if (G.diploInbox.some(o => o.from === from && o.to === to && o.kind === kind && o.status === "pending")) return true;
  G.inboxSeq = (G.inboxSeq || 0) + 1;
  G.diploInbox.push({ id: G.inboxSeq, from, to, kind, turn: G.turn, status: "pending" });
  netNotifyInbox(to);
  return true;
}
// answering an inbox offer — host-authoritative, also used by the host player
function netInboxAnswer(cid, offerId, accept) {
  G.diploInbox = G.diploInbox || [];
  const o = G.diploInbox.find(x => x.id === offerId && x.to === Number(cid) && x.status === "pending");
  if (!o) return { msg: "The offer is no longer on the table." };
  const from = o.from, to = o.to;
  const F = G.countries[from], T = G.countries[to];
  G.diploInbox = G.diploInbox.filter(x => x !== o);
  if (!F || !F.alive) return { msg: "The offering nation no longer exists." };
  if (!accept) {
    G.rel[from][to] = clamp(G.rel[from][to] - 3, -100, 100);
    log(`📨 ${T.name} declines the ${DIPLO_ACT_LABEL[o.kind] || o.kind} from ${F.name}.`, "sys");
    return { msg: `You declined the ${(DIPLO_ACT_LABEL[o.kind] || o.kind).toLowerCase()} from ${F.name}.` };
  }
  let msg = "Agreed.";
  switch (o.kind) {
    case "trade": if (!hasTrade(from, to)) G.trades.push([from, to]); msg = `Trade agreement with ${F.name} signed.`; break;
    case "alliance": if (!allied(from, to)) G.alliances.push([from, to]); msg = `Alliance with ${F.name} formed!`; break;
    case "access": if (!hasAccess(from, to)) G.accessPacts.push([from, to]); msg = `Military access granted to ${F.name}.`; break;
    case "research": if (!hasRP(from, to)) { G.researchPacts.push([from, to]); bumpMods(); } msg = `Research agreement with ${F.name} signed.`; break;
    case "demand": {
      const entries = provsOfNation(to).filter(e => !(e.home.id === to && e.idx === T.capital));
      if (entries.length) {
        const e2 = entries[0];
        e2.p.own = from; e2.p.occ = null; e2.p.unrest = 6;
        if (typeof mapOwnershipChanged === "function") mapOwnershipChanged();
        msg = `You cede ${e2.p.name} to ${F.name}.`;
      } else msg = "You have no province left to cede.";
      break;
    }
    case "vassal":
      G.vassals[to] = from;
      if (typeof mapOwnershipChanged === "function") mapOwnershipChanged();
      msg = `You submit as a subject of ${F.name}.`;
      break;
    case "demandocc":
      if (atWar(from, to)) { makePeace(from, to, true); msg = `Peace — the occupied lands pass to ${F.name}.`; }
      else msg = "The war is already over.";
      break;
  }
  G.rel[from][to] = clamp(G.rel[from][to] + 5, -100, 100);
  G.rel[to][from] = clamp(G.rel[to][from] + 5, -100, 100);
  log(`🤝 ${T.name} accepts the ${DIPLO_ACT_LABEL[o.kind] || o.kind} from ${F.name}.`, "good");
  return { msg };
}

// ---------------- player-to-player chat (QoL §5) ----------------
function netPchatHost(fromCid, toCid, text) {
  if (!text || !text.trim()) return null;
  if (!isHumanControlled(toCid)) return { msg: "That nation is not led by a human player." };
  const fromP = (G.mpPlayers || []).find(p => p.cid === Number(fromCid));
  const name = fromP ? fromP.name : (G.countries[fromCid] ? G.countries[fromCid].leaderName : "Player");
  if (Number(toCid) === G.playerId) {
    if (typeof pchatDeliver === "function") pchatDeliver(Number(fromCid), name, text);
    return null;
  }
  const p = NET.lobby && NET.lobby.players.find(q => q.cid === Number(toCid));
  const conn = p && p.online !== false && NET.conns.find(c2 => c2.peer === p.peer);
  if (!conn) return { msg: "That player is currently disconnected." };
  netSendRaw(conn, { t: "pchat", from: Number(fromCid), name, text });
  return null;
}
// unified send entry for the UI: client → host command, host → local relay
function netPchatSend(toCid, text) {
  if (typeof netIntercept === "function" && netIntercept("pchat", { to: toCid, text })) return true;
  if (NET.active && NET.isHost) {
    const r = netPchatHost(G.playerId, toCid, text);
    if (r && r.msg) toast(r.msg);
    return true;
  }
  return false;
}

// ---------------- war notices (QoL §4) ----------------
// called from declareWar(): the targeted human player is told directly
function netNotifyWar(a, b) {
  if (typeof NET === "undefined" || !NET.active || !NET.isHost || !NET.started) return;
  if (!isHumanControlled(b) || b === G.playerId) return;
  const p = NET.lobby && NET.lobby.players.find(q => q.cid === b);
  const conn = p && NET.conns.find(c2 => c2.peer === p.peer);
  if (conn) netSendRaw(conn, { t: "warNote", from: a, to: b });
}
