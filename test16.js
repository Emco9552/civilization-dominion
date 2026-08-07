// AI Building Bug fix + Update (Humanity balance & AI space launch) battery.
// Covers: the screenshot state (13-University Megastructure cities) diversifying
// into power/labs/material-chain cities with distinct roles, duplicate-value
// decay, research-surplus decay, the energy-trap escape (Power Plant first),
// the single Space Program rule, §14 cargo loading through the shared rulebook
// (march → board → launch loaded, never empty while troops march), the 25⚡
// launch gate, real missions after launch, the wartime reload run, Humanity
// Normal/Super-Buffed modes (engine + display + initGame flow + save/load) and
// the multiplayer poll rules (majority, tie→Normal, both poll kinds).
// Loaded by test16.html; run with headless Chrome (--dump-dom), results land
// in <pre id="test-out"> prefixed TEST16:
(function () {
  const out = [];
  function flush() {
    let el = document.getElementById("test-out");
    if (!el && document.body) { el = document.createElement("pre"); el.id = "test-out"; document.body.appendChild(el); }
    if (el) el.textContent = out.join("\n");
  }
  const log16 = (...a) => { const s = "TEST16: " + a.join(" "); out.push(s); console.log(s); flush(); };
  window.addEventListener("error", e => { out.push("TEST16 PAGE ERROR: " + e.message + " " + (e.filename || "") + ":" + e.lineno); flush(); });
  const boot = setInterval(() => {
    if (typeof ID_ARR === "undefined" || !ID_ARR) return;
    clearInterval(boot);
    try { run(); } catch (e) { out.push("TEST16 ERROR: " + e.message + "\n" + e.stack); flush(); }
  }, 200);
  const near = (a, b, tol) => Math.abs(a - b) <= (tol || 1e-6) * Math.max(1, Math.abs(b));
  function run() {
    initGame("sandbox", 2);
    startGameUI();
    G.rtPaused = true;      // deterministic: only OUR calls advance the sim
    G.sandbox.noEvents = 1;
    G.sandbox.aiOff = 1;    // aiTurn never auto-runs; we drive it by hand
    ensureSpaceState();
    const H = G.countries[2];
    const aiIds = MAP_META.countries.map(m => m.id).filter(id => id !== 2 && G.countries[id] && G.countries[id].alive);

    // ---- t1: THE screenshot state — 13-University L5 cities modernize ----
    const idA = aiIds.slice().sort((x, y) => provsOwned(y).length - provsOwned(x).length)[0];
    const cA = G.countries[idA];
    sandboxUnlockAll(idA);
    if (typeof closeModal === "function") closeModal();
    for (const p of provsOwned(idA)) { p.lvl = 5; p.slots = 14; p.bq = []; p.b = { university: 13, commerce: 1 }; }
    cA.aiPlan = null; cA.pop = 8;
    const startUni = provsOwned(idA).length * 13;
    let devErr = null;
    try {
      for (let pass = 0; pass < 420; pass++) {
        cA.res.money = 999999; cA.res.mat = 999999;
        aiDevelop(idA, cA, production(cA), provsOwned(idA), false);
        for (const p of provsOwned(idA)) for (let k = 0; k < 5; k++) tickBuildQueue(cA, p);
      }
    } catch (e) { devErr = e.message + " @ " + (e.stack || "").split("\n")[1]; }
    const tally = {};
    let slotsN = 0, cityMaxShareOk = true;
    for (const p of provsOwned(idA)) {
      slotsN += p.slots;
      let mx = 0;
      for (const b of Object.keys(p.b)) { tally[b] = (tally[b] || 0) + p.b[b]; mx = Math.max(mx, p.b[b]); }
      if (mx > p.slots * 0.8) cityMaxShareOk = false;
    }
    const uniN = tally.university || 0, powerN = tally.power || 0, labN = tally.lab || 0;
    const chainN = (tally.factory || 0) + (tally.refinery || 0) + (tally.industrial || 0) + (tally.megafactory || 0);
    const doms = {};
    for (const p of provsOwned(idA)) {
      const ks = Object.keys(p.b);
      if (ks.length) doms[ks.sort((a, b) => p.b[b] - p.b[a])[0]] = 1;
    }
    const kinds = Object.keys(tally).length;
    log16("t1-screenshot-city-fixed=" + (devErr === null && powerN >= 1 && labN >= 1 && chainN >= 2 &&
      uniN <= startUni * 0.65 && cityMaxShareOk && Object.keys(doms).length >= 2 && kinds >= 5) +
      " uni=" + uniN + "/" + startUni + " power=" + powerN + " lab=" + labN + " chain=" + chainN +
      " kinds=" + kinds + " dominants=" + Object.keys(doms).join("+") + (devErr ? " ERR=" + devErr : ""));

    // ---- t2: the Nth copy of one structure is worth less than the first ----
    const fakeCity = { b: { university: 13 }, bq: [], slots: 14 };
    log16("t2-duplicate-decay=" + (aiDupPenalty(fakeCity, "university") < 0.2 &&
      aiDupPenalty({ b: {}, bq: [], slots: 14 }, "university") === 1 &&
      aiDupPenalty({ b: { university: 1 }, bq: [], slots: 14 }, "university") === 1));

    // ---- t3: research surplus decays; the energy target scales with the era ----
    const idW = aiIds.find(id => !["scientific", "mercantile"].includes(NATIONS[id].per) && id !== idA);
    const cW = G.countries[idW];
    const eraW = cW.era, shipW = cW.researched.shipyards;
    cW.era = 9; cW.researched.shipyards = true;
    const wLow = aiNeedWeights(cW, { food: 99999, energy: 7, money: 99999, mat: 99999, research: 100 });
    const wHigh = aiNeedWeights(cW, { food: 99999, energy: 7, money: 99999, mat: 99999, research: 10000000 });
    const wPowered = aiNeedWeights(cW, { food: 99999, energy: 500, money: 99999, mat: 99999, research: 100 });
    cW.era = eraW; cW.researched.shipyards = shipW;
    log16("t3-weights-decay-and-energy=" + (wHigh.research < 0.2 && wLow.research >= 2 &&
      wLow.energy > 2 && wPowered.energy <= 0.3) +
      " rLow=" + wLow.research.toFixed(2) + " rHigh=" + wHigh.research.toFixed(3) +
      " eStarved=" + wLow.energy.toFixed(2) + " ePowered=" + wPowered.energy.toFixed(2));

    // ---- t4: a grid-blocked Laboratory argues a Power Plant first ----
    const idB = aiIds.find(id => id !== idA && id !== idW);
    const cB = G.countries[idB];
    sandboxUnlockAll(idB);
    if (typeof closeModal === "function") closeModal();
    const provsB = provsOwned(idB);
    for (const p of provsB) { delete p.b.power; p.bq = []; }
    provsB[0].b.university = Math.min(3, provsB[0].slots - usedSlots(provsB[0]) + (provsB[0].b.university || 0));
    cB.res.money = 99999; cB.res.mat = 99999;
    const prodB = production(cB);
    const WB = aiNeedWeights(cB, prodB);
    const ctxB = { myp: provsB, war: false, threat: false };
    const pf = aiPowerFirst(idB, cB, provsB[0], "lab", prodB, WB, provsB, ctxB, "research", null);
    provsB[0].b.power = 5; // a strong grid → no plant needed for the same lab
    const pf2 = aiPowerFirst(idB, cB, provsB[0], "lab", production(cB), WB, provsB, ctxB, "research", null);
    delete provsB[0].b.power;
    log16("t4-power-first-unblocks=" + (!!pf && pf.b === "power" && pf.forB === "lab" && pf.s > 0 && pf2 === null) +
      (pf ? " score=" + pf.s.toFixed(1) : " pf=null") + " powered=" + (pf2 === null ? "no-plant-needed" : "BAD"));

    // ---- t5: ONE Space Program per civilization, no slot ever reserved ----
    const spN = countBldgQ(cA, "spaceprogram");
    const fullCities = provsOwned(idA).every(p => usedSlots(p) >= p.slots * 0.85);
    log16("t5-one-space-program=" + (spN === 1 && fullCities) + " count=" + spN + " citiesFull=" + fullCities);

    // ---- t6: §14 cargo loading — march to the pad, board, launch LOADED ----
    const site6 = spaceProgramCity(idA);
    const groundU = Object.keys(UNITS).find(u => !UNITS[u].naval && !UNITS[u].space && !UNITS[u].air && unitAvailable(cA, u));
    G.armies = G.armies.filter(m => m.owner !== idA); // starting armies off the pad — the test controls its troops
    const rocket = spawnArmy(idA, "rocket", site6.px + 30, site6.py + 30);
    const tA = spawnArmy(idA, groundU, site6.px + 330, site6.py + 30);
    const tB = spawnArmy(idA, groundU, site6.px + 30, site6.py + 330);
    cA.res.energy = 100; cA.res.money = 99999;
    const shipsBefore = shipsOfNation(idA).length;
    aiSpaceTurn(idA, cA); // pass 1: troops are far — march them, hold the launch
    const held = G.armies.includes(rocket) && shipsOfNation(idA).length === shipsBefore;
    const marched = typeof tA.tx === "number" && Math.abs(tA.tx - rocket.x) < 30;
    tA.x = rocket.x + 6; tA.y = rocket.y + 6;   // the march arrives
    tB.x = rocket.x - 6; tB.y = rocket.y - 6;
    aiSpaceTurn(idA, cA); // pass 2: board through the shared rulebook & lift off
    const ship6 = shipsOfNation(idA).find(s => s.unit === "rocket");
    const loadedLaunch = !!ship6 && (ship6.cargo || []).length === 2 && !G.armies.includes(rocket) &&
      !G.armies.includes(tA) && !G.armies.includes(tB) && (ship6.cargo || []).length <= UNITS.rocket.cap;
    log16("t6-cargo-shared-loading=" + (held && marched && loadedLaunch) +
      " heldWhileMarching=" + held + " marched=" + marched + " loaded=" + (ship6 ? (ship6.cargo || []).length : "none") + "/" + UNITS.rocket.cap);

    // ---- t7: the 25⚡ launch gate — dark pad holds, powered pad launches ----
    G.armies = G.armies.filter(m => m.owner !== idA); // no marchers left — an empty lawful run
    const rocket7 = spawnArmy(idA, "rocket", site6.px + 26, site6.py - 30);
    cA.res.energy = 5;
    aiSpaceTurn(idA, cA);
    const blocked = G.armies.includes(rocket7);
    cA.res.energy = 100;
    aiSpaceTurn(idA, cA); // no troops left at home → an empty run is lawful now
    const launched7 = !G.armies.includes(rocket7) && shipsOfNation(idA).some(s => s.unit === "rocket" && s !== ship6);
    log16("t7-launch-energy-gate=" + (blocked && launched7) + " blockedAt5=" + blocked + " launchedAt100=" + launched7);

    // ---- t8: a launched craft flies a real mission — colonization ----
    cA.researched.colonyships = true;
    const free8 = SPACE_PLANETS.find(d => d.type !== "main" && planetSysId(d) === "home" &&
      G.space.planets[d.id] && !G.space.planets[d.id].destroyed && !G.space.planets[d.id].colony && !sunDead(planetSysId(d)));
    let colonized = false;
    if (free8 && ship6) {
      const pp = planetPos(free8.id);
      ship6.x = pp.x; ship6.y = pp.y; ship6.z = pp.z; ship6.target = null; ship6.orbit = null; ship6.chase = null;
      cA.res.money = 99999;
      for (let i = 0; i < 6 && !colonized; i++) { aiSpaceTurn(idA, cA); colonized = !!G.space.planets[free8.id].colony; }
    }
    log16("t8-mission-colonize=" + colonized + (free8 ? "" : " (no free world!)"));

    // ---- t9: wartime reload — an empty transport heads home for troops ----
    const idF = aiIds.find(id => id !== idA && id !== idB && id !== idW);
    const free9 = SPACE_PLANETS.find(d => d.type !== "main" && d !== free8 &&
      G.space.planets[d.id] && !G.space.planets[d.id].destroyed && !G.space.planets[d.id].colony);
    let reload = false, wentHome = false;
    if (free9) {
      G.space.planets[free9.id].colony = { owner: idF, lvl: 1, garrison: [], b: {} };
      G.wars.push({ a: idA, b: idF, start: G.turn });
      const empty9 = shipsOfNation(idA).find(s => s.unit === "rocket" && !(s.cargo || []).length);
      const troop9 = spawnArmy(idA, groundU, site6.px + 40, site6.py + 40);
      if (empty9 && troop9) {
        empty9.x = 4000; empty9.z = 4000; empty9.target = null; empty9.orbit = null; empty9.free = null;
        aiSpaceTurn(idA, cA);
        wentHome = empty9.target === "home";
        const hp9 = planetPos("home");
        empty9.x = hp9.x + 10; empty9.y = hp9.y; empty9.z = hp9.z + 10;
        const before9 = G.armies.length;
        aiSpaceTurn(idA, cA);
        reload = !shipsOfNation(idA).includes(empty9) && G.armies.length > before9; // landed to board
      }
      G.wars = G.wars.filter(w => !(w.a === idA && w.b === idF));
      G.space.planets[free9.id].colony = null;
    }
    log16("t9-war-reload-run=" + (wentHome && reload) + " orderedHome=" + wentHome + " landedToBoard=" + reload);

    // ---- t10: Humanity modes — engine numbers, applied once, species-bound ----
    const int1 = stat(H, "int"), mult1 = speciesResearchMult(H), md1 = mods(H).research, r1 = production(H).research;
    G.humanityMode = "normal"; bumpMods();
    const int0 = stat(H, "int"), mult0 = speciesResearchMult(H), md0 = mods(H).research, r0 = production(H).research;
    const othersSame = stat(G.countries[1], "str") === NATIONS[1].st[1];
    const ratioOk = near(r1 / r0, ((1 + md1) * (int1 / 5)) / ((1 + md0) * (int0 / 5)), 1e-6);
    G.humanityMode = "super"; bumpMods();
    log16("t10-humanity-modes-engine=" + (G.humanityMode === "super" && int1 === 11 && int0 === 10 &&
      near(mult1, 1.30) && near(mult0, 1.20) && near(md1 - md0, 0.10, 1e-9) && ratioOk && othersSame &&
      stat(H, "int") === 11) +
      " int=" + int1 + "/" + int0 + " mult=" + mult1.toFixed(2) + "/" + mult0.toFixed(2) + " ratioOk=" + ratioOk);

    // ---- t11: only Super-Buffed glows Beyond Maximum on the pick screen ----
    pickedId = 2; humanityPick = "super"; renderPickPanel();
    const htmlS = document.getElementById("pick-panel").innerHTML;
    humanityPick = "normal"; renderPickPanel();
    const htmlN = document.getElementById("pick-panel").innerHTML;
    humanityPick = "super"; renderPickPanel();
    log16("t11-mode-display=" + (htmlS.includes("11/10") && htmlS.includes("Beyond Maximum") && htmlS.includes("overfill") &&
      htmlS.includes("+30% research points") && !htmlN.includes("Beyond Maximum") && !htmlN.includes("overfill") &&
      htmlN.includes("+20% research points") && htmlN.includes("hum-mode-normal")));

    // ---- t14: poll rules — majority, tie→Normal, both kinds, no reopen ----
    NET.active = true; NET.isHost = true; NET.started = false;
    NET.lobby = { players: [{ name: "Host", peer: "host", me: true, cid: 2 },
      { name: "P2", peer: "pA", cid: 3 }, { name: "P3", peer: "pB", cid: 4 }] };
    netHumanityClaimed(NET.lobby.players[0], "super");
    const pollUp = !!(NET.lobby.poll && NET.lobby.poll.kind === "playerSuper") && NET.lobby.humanityMode === null;
    netPollVote("host", 0); netPollVote("pA", 0); netPollVote("pB", 1); netPollFinish(false);
    const approved = NET.lobby.humanityMode === "super";
    netHumanityClaimed(NET.lobby.players[0], "super");
    netPollVote("host", 0); netPollVote("pA", 1); netPollVote("pB", 1); netPollFinish(false);
    const rejected = NET.lobby.humanityMode === "normal";
    netHumanityClaimed(NET.lobby.players[0], "super");
    netPollVote("host", 0); netPollVote("pA", 1); netPollFinish(false);
    const tieNormal = NET.lobby.humanityMode === "normal";
    netHumanityClaimed(NET.lobby.players[0], "normal");
    const normalNoPoll = !NET.lobby.poll && NET.lobby.humanityMode === "normal";
    NET.lobby.players[0].cid = 5;
    netHumanityClaimed(NET.lobby.players[0], null); // Humanity released to the AI
    netPollStart("aiHumanity", "Which balance mode should AI-controlled Humanity use?", ["Normal Humanity", "Super-Buffed Humanity"], 1);
    netPollVote("host", 1); netPollVote("pA", 1); netPollVote("pB", 0); netPollFinish(false);
    const aiSuper = NET.lobby.aiHumanityMode === "super";
    netPollStart("aiHumanity", "q", ["Normal Humanity", "Super-Buffed Humanity"], 1);
    netPollFinish(false); // nobody voted → Normal
    const aiSilent = NET.lobby.aiHumanityMode === "normal";
    netPollCleanup();
    NET.active = false; NET.isHost = false; NET.lobby = null;
    log16("t14-poll-rules=" + (pollUp && approved && rejected && tieNormal && normalNoPoll && aiSuper && aiSilent) +
      " up=" + pollUp + " approve=" + approved + " reject=" + rejected + " tie=" + tieNormal +
      " normalSkips=" + normalNoPoll + " aiVote=" + aiSuper + " aiSilent=" + aiSilent);

    // ---- t12: the chosen mode flows into initGame, then resets to default ----
    PENDING_HUMANITY_MODE = "normal";
    initGame("standard", 3);
    const flowNormal = G.humanityMode === "normal";
    initGame("standard", 3);
    const flowDefault = G.humanityMode === "super"; // consumed — not sticky
    log16("t12-mode-into-initgame=" + (flowNormal && flowDefault) + " normal=" + flowNormal + " defaultSuper=" + flowDefault);

    // ---- t13: save/load keeps the mode; old saves default to Super-Buffed ----
    G.humanityMode = "normal";
    autosave();
    G.humanityMode = "super";
    const l1 = loadSave();
    const keptNormal = l1 && G.humanityMode === "normal";
    delete G.humanityMode; // an old, pre-mode save
    autosave();
    const l2 = loadSave();
    const oldSaveSuper = l2 && G.humanityMode === "super";
    log16("t13-save-load-mode=" + (keptNormal && oldSaveSuper) + " kept=" + keptNormal + " oldDefault=" + oldSaveSuper);

    // ---- t15: §15 diagnostic logging speaks when enabled ----
    let devLines = 0;
    const oldLog = console.log;
    console.log = (...a) => { if (String(a[0]).indexOf("[AI-DEV") === 0) devLines++; oldLog.apply(console, a); };
    AI_DEV_LOG.on = true;
    aiDevLog(3, "probe line");
    AI_DEV_LOG.on = false;
    console.log = oldLog;
    log16("t15-diagnostic-logging=" + (devLines >= 1));

    log16("DONE16");
    flush();
  }
})();
