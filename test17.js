// Diagnostic Update battery — multiplayer connection states, version
// handshake, named rejections, timeout/retry plumbing, stall detection,
// chunk-buffer expiry, the early boot guard, the debug report (incl. a
// no-credentials check), the mobile-detection fix, space touch controls,
// and the Tiny Visual Update (10/10 static gradient vs 11/10 aura).
// Loaded by test17.html; run with headless Chrome (--dump-dom), results land
// in <pre id="test-out"> prefixed TEST17:
(function () {
  const out = [];
  function flush() {
    let el = document.getElementById("test-out");
    if (!el && document.body) { el = document.createElement("pre"); el.id = "test-out"; document.body.appendChild(el); }
    if (el) el.textContent = out.join("\n");
  }
  const log17 = (...a) => { const s = "TEST17: " + a.join(" "); out.push(s); console.log(s); flush(); };
  window.addEventListener("error", e => { out.push("TEST17 PAGE ERROR: " + e.message + " " + (e.filename || "") + ":" + e.lineno); flush(); });
  const boot = setInterval(() => {
    if (typeof ID_ARR === "undefined" || !ID_ARR) return;
    clearInterval(boot);
    try { run(); } catch (e) { out.push("TEST17 ERROR: " + e.message + "\n" + e.stack); flush(); }
  }, 200);

  function fakeConn(name) {
    return { open: true, peer: name, sent: [], closed: false,
      send(m) { this.sent.push(m); }, close() { this.closed = true; } };
  }
  function netInert() { // put NET back to a harmless idle state between checks
    NET.active = false; NET.isHost = false; NET.started = false; NET.awaitBoot = false;
    NET.peer = null; NET.hostConn = null; NET.conns = []; NET.lobby = null;
    NET.stallState = null; NET.lastRetry = null;
    if (NET.pingIv) { clearInterval(NET.pingIv); NET.pingIv = null; }
    if (NET.lobbyTimer) { clearTimeout(NET.lobbyTimer); NET.lobbyTimer = null; }
    if (NET.failTimer) { clearTimeout(NET.failTimer); NET.failTimer = null; }
    if (NET.peerLoadTimer) { clearTimeout(NET.peerLoadTimer); NET.peerLoadTimer = null; }
  }

  function run() {
    // ---- t1: the build identifier exists and is visible to players ----
    log17("t1-version-const=" + (typeof GAME_VERSION === "string" && GAME_VERSION.length > 3 &&
      netVer() === GAME_VERSION &&
      document.querySelector("#screen-menu .subtitle").textContent.includes(GAME_VERSION)));
    netInitMpScreen();
    log17("t2-mp-screen-ver=" + (document.getElementById("mp-ver").textContent === "v" + GAME_VERSION &&
      !!document.getElementById("mp-retry") && !!document.getElementById("mp-debug") &&
      !!document.getElementById("mp-actions")));

    // ---- t3: the early boot guard ran, per-file stages recorded ----
    const B = window.BOOT;
    log17("t3-boot-guard=" + (!!B && B.booted === true && Array.isArray(B.errors) &&
      B.okFiles.includes("multiplayer") && B.okFiles.includes("space systems") &&
      typeof B.fail === "function" && B.watchdog === null));

    // ---- t4: host refuses a version mismatch with an exact reject ----
    netInert();
    NET.isHost = true; NET.active = true;
    NET.lobby = { players: [{ name: "Host", cid: 2, peer: "host", me: true }], started: false };
    const c1 = fakeConn("fake1");
    netHandleAsHost(c1, { t: "hello", name: "Imp", v: "WRONG-BUILD" });
    const rj = c1.sent.find(m => m.t === "reject");
    log17("t4-version-reject=" + (!!rj && rj.why === "version" && rj.host === GAME_VERSION &&
      rj.yours === "WRONG-BUILD" && NET.lobby.players.length === 1));

    // ---- t5: a matching version still joins the lobby ----
    const c2 = fakeConn("fake2");
    netHandleAsHost(c2, { t: "hello", name: "Ally", v: GAME_VERSION });
    log17("t5-version-ok-joins=" + (NET.lobby.players.length === 2 &&
      !c2.sent.some(m => m.t === "reject")));

    // ---- t6: rejoin with no matching seat is refused BY NAME (not a silent close) ----
    NET.started = true;
    const c3 = fakeConn("fake3");
    netHandleAsHost(c3, { t: "hello", name: "Ghost", v: GAME_VERSION });
    const rj3 = c3.sent.find(m => m.t === "reject");
    log17("t6-noseat-reject=" + (!!rj3 && rj3.why === "noseat"));

    // ---- t7: host answers pings outside the sim loop ----
    const c4 = fakeConn("fake2"); // same peer as the seated Ally
    netHandleAsHost(c4, { t: "ping" });
    log17("t7-pong=" + (c4.sent.some(m => m.t === "pong") &&
      typeof NET.lobby.players.find(p => p.peer === "fake2").lastSeen === "number"));

    // ---- t8: client shows the named rejection and frees the session ----
    netInert();
    NET.active = true; NET.hostConn = fakeConn("host"); NET.peer = { destroy() {}, id: "me" };
    NET.lastRetry = () => {};
    netHandleAsClient({ t: "reject", why: "full", host: GAME_VERSION });
    const st1 = document.getElementById("mp-status").textContent;
    log17("t8-full-message=" + (st1.includes("Room is full") && NET.active === false &&
      document.getElementById("mp-actions").style.display !== "none"));

    // ---- t9: version bail on a mismatched lobby broadcast (older host case) ----
    netInert();
    NET.active = true; NET.hostConn = fakeConn("host"); NET.peer = { destroy() {}, id: "me" };
    NET.lastRetry = () => {};
    netHandleAsClient({ t: "lobby", players: [] }); // an old host sends no v at all
    const st2 = document.getElementById("mp-status").textContent;
    log17("t9-version-bail=" + (st2.includes("Version mismatch") && st2.includes(GAME_VERSION) &&
      NET.active === false && NET.connState === "Version mismatch"));

    // ---- t10: a matching lobby clears the waiting-for-host watchdog ----
    netInert();
    NET.active = true; NET.peer = { id: "me" };
    NET.lobbyTimer = setTimeout(() => {}, 60000);
    netHandleAsClient({ t: "lobby", v: GAME_VERSION, players: [] });
    log17("t10-lobby-clears-watchdog=" + (NET.lobbyTimer === null && !!NET.lobby));

    // ---- t11: stall detector — paused vs dead vs recovered ----
    netInert();
    NET.active = true; NET.started = true; NET.hostConn = { open: false };
    const now = Date.now();
    NET.lastSnap = now - 16000; NET.lastHostMsg = now - 2000; NET.stallState = null;
    netStallTick();
    const paused = NET.stallState === "paused";
    NET.lastHostMsg = now - 25000;
    netStallTick();
    const dead = NET.stallState === "dead";
    NET.lastSnap = NET.lastHostMsg = Date.now();
    netStallTick();
    log17("t11-stall-detector=" + (paused && dead && NET.stallState === null));

    // ---- t12: half-received chunked messages expire instead of leaking ----
    netInert();
    NET.chunkBuf = {};
    const src = { peer: "pX" };
    netOnData(src, { t: "chk", id: 1, i: 0, n: 2, d: "aa" });
    const had = !!NET.chunkBuf["pX_1"];
    NET.chunkBuf["pX_1"].ts = Date.now() - 31000;
    netOnData(src, { t: "chk", id: 2, i: 0, n: 2, d: "bb" });
    log17("t12-chunk-expiry=" + (had && !NET.chunkBuf["pX_1"] && !!NET.chunkBuf["pX_2"]));
    NET.chunkBuf = {};

    // ---- t13: connect-attempt hygiene — abort clears every timer and the peer ----
    netInert();
    NET.peerLoadTimer = setTimeout(() => {}, 60000);
    NET.failTimer = setTimeout(() => {}, 60000);
    NET.lobbyTimer = setTimeout(() => {}, 60000);
    let destroyed = false;
    NET.peer = { destroy() { destroyed = true; } };
    netAbortConnect();
    log17("t13-abort-connect=" + (NET.peerLoadTimer === null && NET.failTimer === null &&
      NET.lobbyTimer === null && NET.peer === null && destroyed));
    NET.lastRetry = () => {};
    netShowRetry();
    const shown = document.getElementById("mp-actions").style.display !== "none";
    netHideRetry();
    log17("t14-retry-toggle=" + (shown && document.getElementById("mp-actions").style.display === "none"));

    // ---- t15: debug report — honest content, zero credentials ----
    const rep = netBuildDebugReport();
    log17("t15-debug-report=" + (rep.includes(GAME_VERSION) && rep.includes("Room code") &&
      rep.includes("PeerJS") && !rep.includes("peerjsp") && !rep.includes("openrelayproject") &&
      !/password|credential|token/i.test(rep.replace("no passwords, tokens or private messages", ""))));

    // ---- t16: the 10/10 static gradient vs the 11/10 animated aura ----
    netInert();
    pickedId = HUMAN_NATION_ID;
    humanityPick = "normal";
    renderPickPanel();
    const hN = document.getElementById("pick-panel").innerHTML;
    humanityPick = "super";
    renderPickPanel();
    const hS = document.getElementById("pick-panel").innerHTML;
    log17("t16-stat-markup=" + (hN.includes("maxbar") && hN.includes("maxval") && hN.includes("10/10") &&
      !hN.includes("overfill") && hS.includes("overfill") && hS.includes("11/10")));
    // computed styles: still gradient on 10/10, aura ONLY outside the 11/10 bar
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="statbar maxbar"><i class="maxfill" style="width:100%"></i></div>
      <div class="statbar overbar"><i class="overfill" style="width:100%"></i></div>`;
    document.body.appendChild(wrap);
    const mb = wrap.querySelector(".maxbar"), mf = wrap.querySelector(".maxfill"), ob = wrap.querySelector(".overbar");
    const mfCS = getComputedStyle(mf), mbCS = getComputedStyle(mb);
    const auraOver = getComputedStyle(ob, "::before").content !== "none";
    const auraMax = getComputedStyle(mb, "::before").content !== "none";
    log17("t17-stat-css=" + (mfCS.backgroundImage.includes("linear-gradient") &&
      mfCS.animationName === "none" && mbCS.animationName === "none" &&
      getComputedStyle(wrap.querySelector(".overfill")).animationName !== "none" &&
      auraOver && !auraMax));
    wrap.remove();

    // ---- t18: the mobile-detection shadowing fix + space touch controls ----
    log17("t18-mobile-fix=" + (isMobileDevice.toString().includes("window.screen") &&
      initSpaceInput.toString().includes("touchstart") &&
      initSpaceInput.toString().includes("touchmove")));

    // ---- t19: multiplayer wreckage cannot block single-player ----
    netInert();
    initGame("standard", 3);
    log17("t19-sp-still-works=" + (!!G && !!G.countries[3] && G.playerId === 3));

    log17("DONE17");
    flush();
  }
})();
