// Final Space Fixes test battery — the report's 12 tests.
// §1: Phantom Step now covers the HOMELAND system (players, map AI, aliens),
// same 50/25 cycle, homeland appears in the station console's target list.
// §2-5: Dyson Spheres around ANY secured star — colony proves access (home =
// provinces), hostile alien control blocks with the exact message, one sphere
// per star, spheres survive colony loss and never auto-transfer, AI and
// hyper-advanced aliens follow the same canBuildDyson rulebook.
// Loaded by test10.html; run with headless Chrome (--dump-dom), results land
// in <pre id="test-out"> prefixed TEST10:
(function () {
  const out = [];
  function flush() {
    let el = document.getElementById("test-out");
    if (!el && document.body) { el = document.createElement("pre"); el.id = "test-out"; document.body.appendChild(el); }
    if (el) el.textContent = out.join("\n");
  }
  const log10 = (...a) => { const s = "TEST10: " + a.join(" "); out.push(s); console.log(s); flush(); };
  window.addEventListener("error", e => { out.push("TEST10 PAGE ERROR: " + e.message + " " + (e.filename || "") + ":" + e.lineno); flush(); });
  const boot = setInterval(() => {
    if (typeof ID_ARR === "undefined" || !ID_ARR) return;
    clearInterval(boot);
    try { run(); } catch (e) { out.push("TEST10 ERROR: " + e.message + "\n" + e.stack); flush(); }
  }, 200);
  function run() {
    initGame("standard", 2);
    startGameUI();
    G.rtPaused = true; // deterministic: only OUR calls advance the simulation
    let P = G.countries[2];
    for (const t of TECHS) P.researched[t.id] = true;
    P.era = 9; bumpMods();
    P.res.money = 90000000; P.res.mat = 90000000; P.res.energy = 90000000;
    ensureSpaceState();
    markSpaceReached(); // Alien War AI Fix §0: the battery simulates the first launch
    const aliens = (G.space.aliens || []).filter(a => !a.defeated);
    const realRnd = Math.random;
    const panel = () => { renderSpacePanel(); return document.getElementById("space-panel").innerHTML; };
    const standDown = cid => {
      for (const sid of Object.keys(G.space.systems)) {
        const ph = G.space.systems[sid].phantom;
        if (ph && ph.owner === cid) delete G.space.systems[sid].phantom;
      }
      const c = G.countries[cid];
      if (c) { c.phantomSys = null; c.phantomCdUntil = 0; }
    };

    // ---- shared setup: station + full home Dyson Sphere for the player ----
    G.space.planets.kae1.colony = { owner: 2, lvl: 2, garrison: [] };
    const hp0 = planetPos("home");
    buildResearcher(2, hp0.x + 220, 0, hp0.z + 220, true);
    const rr = (G.space.researchers || []).find(r => r.owner === 2);
    rr.lvl = PHANTOM.deepLvl;
    upgradeResearcherDeep(2, rr.id, true);
    G.space.dyson = { owner: 2, stage: MEGA_DEFS.dyson.stages, prog: 0, building: false, hp: DYSON_HP };

    // ============ §1/Test 1 — a normal solar system still cloaks ============
    const actNormal = activatePhantom(2, "kae");
    log10("t1-normal-system-cloaks=" + (actNormal === true && phantomActive("kae")));
    standDown(2);

    // ============ §1/Test 2 — the HOMELAND system is a valid target ============
    const eligible = phantomEligibleSystems(2);
    spaceSel = { kind: "researcher", id: rr.id };
    const consoleHtml = panel();
    const homeListed = eligible.includes("home") && consoleHtml.includes("(homeland)");
    const actHome = activatePhantom(2, "home");
    const foe10 = aliens.length ? aliens[0].aid : 3;
    const homeHidden = phantomActive("home") && phantomHiddenFrom("home", foe10) && !phantomHiddenFrom("home", 2);
    const homeIntact = !G.space.planets.home.destroyed && !G.space.systems.home.nova;
    log10("t2-homeland-cloaks=" + (homeListed && actHome === true && homeHidden && homeIntact) +
      " listed-in-console=" + homeListed + " activated=" + actHome + " hidden-from-others=" + homeHidden +
      " homeland-unharmed=" + homeIntact);

    // ============ §1/Test 3 — the homeland follows the strict 50/25 cycle ============
    const actT = G.turn;
    const until50 = G.space.systems.home.phantom && G.space.systems.home.phantom.until === actT + PHANTOM.active;
    G.turn = actT + PHANTOM.active;
    tickPhantom();
    const off50 = !phantomActive("home") && P.phantomCdUntil === actT + PHANTOM.active + PHANTOM.cooldown;
    const denyCd = activatePhantom(2, "home") === false;
    G.turn = P.phantomCdUntil;
    const reHome = activatePhantom(2, "home");
    log10("t3-homeland-50-25-cycle=" + (until50 && off50 && denyCd && reHome === true) +
      " 50-turns=" + until50 + " 25-cooldown=" + off50 + " reactivates=" + reHome);
    standDown(2);

    // ============ §1/Test 4 — AI countries and aliens can cloak their homeland ============
    const c3 = G.countries[3];
    c3.era = 9; for (const t of TECHS) c3.researched[t.id] = true; bumpMods();
    c3.res.money = 900000; c3.res.mat = 900000; c3.res.energy = 900000;
    buildResearcher(3, hp0.x - 260, 0, hp0.z - 260, true);
    const r3 = (G.space.researchers || []).find(r => r.owner === 3);
    r3.lvl = PHANTOM.deepLvl;
    upgradeResearcherDeep(3, r3.id, true);
    G.space.systems.vex.dyson = { owner: 3, stage: MEGA_DEFS.dyson.stages, hp: DYSON_HP }; // their full sphere
    const aiHomeEligible = phantomEligibleSystems(3).includes("home");
    const aiAct = activatePhantom(3, "home", true);
    const aiCloaked = phantomActive("home") && G.space.systems.home.phantom.owner === 3;
    standDown(3);
    delete G.space.systems.vex.dyson;
    const hyper = aliens.find(a => a.tier >= 4);
    let alienCap = "SKIP";
    if (hyper) {
      const hAct = activatePhantom(hyper.aid, hyper.sys, true); // their own capital system
      alienCap = hAct === true && phantomActive(hyper.sys);
      standDown(hyper.aid);
    }
    log10("t4-ai-and-alien-homeland=" + (aiHomeEligible && aiAct === true && aiCloaked && (alienCap === true || alienCap === "SKIP")) +
      " ai-eligible=" + aiHomeEligible + " ai-cloaked-home=" + aiCloaked + " alien-own-capital=" + alienCap);

    // ============ §2/Tests 5-6 — a colony proves Dyson construction access ============
    const alienSysIds = new Set(aliens.map(a => a.sys));
    for (const a of aliens) for (const d of SPACE_PLANETS) {
      const pst = G.space.planets[d.id];
      if (pst && pst.colony && pst.colony.owner === a.aid) alienSysIds.add(planetSysId(d));
    }
    const freeSysOf = () => SPACE_SYSTEMS.find(sy => sy.id !== "home" && !alienSysIds.has(sy.id) &&
      !G.space.systems[sy.id].nova && !sunDead(sy.id) && !dysonAt(sy.id) &&
      !SPACE_PLANETS.some(d => planetSysId(d) === sy.id && G.space.planets[d.id].colony) &&
      SPACE_PLANETS.some(d => planetSysId(d) === sy.id && !G.space.planets[d.id].destroyed && !G.space.planets[d.id].colony));
    const sysN = freeSysOf();
    let t5 = "SKIP", t6 = "SKIP";
    if (sysN) {
      const chkFar = canBuildDyson(2, sysN.id);
      t5 = chkFar.ok === false && /colony/.test(chkFar.why) && payDysonStage(2, sysN.id) === false;
      const spot = SPACE_PLANETS.find(d => planetSysId(d) === sysN.id && !G.space.planets[d.id].destroyed && !G.space.planets[d.id].colony);
      colonizePlanet(2, spot.id, true);
      t6 = canBuildDyson(2, sysN.id).ok === true;
    }
    log10("t5-no-colony-no-dyson=" + t5 + " (blocked with a colony-required reason)");
    log10("t6-colony-unlocks-dyson=" + t6);

    // ============ §3/Tests 7-8 — hostile alien control blocks construction ============
    let t7 = "SKIP", t8 = "SKIP";
    const recA = aliens.find(a => SPACE_PLANETS.some(d => planetSysId(d) === a.sys &&
      !G.space.planets[d.id].destroyed && !G.space.planets[d.id].colony) && !sunDead(a.sys) && !dysonAt(a.sys));
    if (recA) {
      const spotA = SPACE_PLANETS.find(d => planetSysId(d) === recA.sys && !G.space.planets[d.id].destroyed && !G.space.planets[d.id].colony);
      colonizePlanet(2, spotA.id, true);
      const chkA = canBuildDyson(2, recA.sys);
      t7 = chkA.ok === false && chkA.why === "Dyson Sphere unavailable: hostile alien forces still control this solar system.";
      // "defeat or remove" the aliens: their colonies here fall to the player
      for (const d of SPACE_PLANETS) {
        if (planetSysId(d) !== recA.sys) continue;
        const pst = G.space.planets[d.id];
        if (pst && pst.colony && G.countries[pst.colony.owner] && G.countries[pst.colony.owner].alien) pst.colony.owner = 2;
      }
      t8 = canBuildDyson(2, recA.sys).ok === true;
    }
    log10("t7-alien-control-blocks=" + t7 + " (exact blocked message shown)");
    log10("t8-cleared-system-unlocks=" + t8);

    // ============ §2/Tests 9-10 — spheres over multiple stars, one per star ============
    let t9 = "SKIP", t10 = "SKIP";
    if (sysN) {
      Math.random = () => 0.99; // keep aliens quiet while construction ticks run
      let funded = payDysonStage(2, sysN.id) === true;
      let guard = 0;
      while (funded && dysonAt(sysN.id).stage < MEGA_DEFS.dyson.stages && guard++ < 200) {
        spaceTurnTick();
        const dyN = dysonAt(sysN.id);
        if (!dyN.building && dyN.stage < MEGA_DEFS.dyson.stages) { if (!payDysonStage(2, sysN.id)) break; }
      }
      Math.random = realRnd;
      const dyN = dysonAt(sysN.id);
      const built = !!dyN && dyN.stage === MEGA_DEFS.dyson.stages && dyN.owner === 2;
      const energy = spaceIncomeOf(P).dysonEnergy;
      const both = energy >= MEGA_DEFS.dyson.energyPerStage * MEGA_DEFS.dyson.stages * 2; // home + sysN at least
      t9 = built && both;
      log10("t9-multiple-spheres=" + t9 + " " + systemDef(sysN.id).n + "-stage=" + (dyN ? dyN.stage : "?") +
        " total-dyson-energy=" + energy);
      const again = canBuildDyson(2, sysN.id);
      const foreign = canBuildDyson(3, sysN.id);
      t10 = again.ok === false && foreign.ok === false;
      log10("t10-one-sphere-per-star=" + t10 + " own-again=" + again.ok + " foreign=" + foreign.ok);
    } else { log10("t9-multiple-spheres=SKIP"); log10("t10-one-sphere-per-star=SKIP"); }

    // ============ §5/Test 11 — AI and aliens obey the same rules ============
    const sysNoCol3 = SPACE_SYSTEMS.find(sy => sy.id !== "home" && !dysonAt(sy.id) && !sunDead(sy.id) &&
      !G.space.systems[sy.id].nova && !SPACE_PLANETS.some(d => planetSysId(d) === sy.id &&
        G.space.planets[d.id].colony && G.space.planets[d.id].colony.owner === 3));
    const aiRemoteDenied = sysNoCol3 ? payDysonStage(3, sysNoCol3.id) === false : true;
    let alienRules = "SKIP";
    if (hyper) {
      const own = canBuildDyson(hyper.aid, hyper.sys); // their capital star already wears one
      const sysC = freeSysOf();
      let alienBuilds = true, alienRemote = true;
      if (sysC) {
        alienRemote = canBuildDyson(hyper.aid, sysC.id).ok === false; // no colony there yet
        const spotC = SPACE_PLANETS.find(d => planetSysId(d) === sysC.id && !G.space.planets[d.id].destroyed && !G.space.planets[d.id].colony);
        if (spotC) {
          G.space.planets[spotC.id].colony = { owner: hyper.aid, lvl: 1, garrison: [] };
          G.countries[hyper.aid].res.money = 9000000; G.countries[hyper.aid].res.mat = 9000000;
          alienBuilds = payDysonStage(hyper.aid, sysC.id) === true; // era-9 tech is innate
        }
      }
      const lesser = aliens.find(a => ALIEN_TIERS[a.tier].era < 9);
      const lesserDenied = lesser ? canBuildDyson(lesser.aid, lesser.sys).ok === false : true;
      alienRules = own.ok === false && alienRemote && alienBuilds && lesserDenied;
    }
    log10("t11-ai-alien-same-rules=" + ((aiRemoteDenied && (alienRules === true || alienRules === "SKIP"))) +
      " ai-remote-denied=" + aiRemoteDenied + " alien-rules=" + alienRules);

    // ============ §4/Test 12 — losing the colony never deletes the sphere ============
    let t12 = "SKIP";
    if (sysN) {
      // fund a PARTIAL sphere in the cleared alien system to test the control
      // gate on further stages (the sysN sphere is complete — stages are done)
      let ctrlGate = true;
      if (recA && canBuildDyson(2, recA.sys).ok) {
        payDysonStage(2, recA.sys);
        Math.random = () => 0.99; // finish the stage so "building" cannot mask the control gate
        let g12 = 0;
        while (dysonAt(recA.sys).building && g12++ < 40) spaceTurnTick();
        Math.random = realRnd;
        for (const d of SPACE_PLANETS) { // the conquered colonies fall to nation 3
          if (planetSysId(d) !== recA.sys) continue;
          const pst = G.space.planets[d.id];
          if (pst && pst.colony && pst.colony.owner === 2) pst.colony.owner = 3;
        }
        const dyA = dysonAt(recA.sys);
        const chkCtrl = canBuildDyson(2, recA.sys);
        ctrlGate = !!dyA && dyA.owner === 2 && chkCtrl.ok === false && /colony/.test(chkCtrl.why || "");
      }
      for (const d of SPACE_PLANETS) {
        if (planetSysId(d) !== sysN.id) continue;
        const pst = G.space.planets[d.id];
        if (pst && pst.colony && pst.colony.owner === 2) pst.colony.owner = 3; // system conquered
      }
      const dyN2 = dysonAt(sysN.id);
      const survives = !!dyN2 && dyN2.owner === 2;              // still standing, still mine
      const noAutoTransfer = dyN2 && dyN2.owner !== 3;           // conquest is not capture
      // full ANNEXATION of the owner still absorbs it (existing nation-level rule)
      spaceAbsorb(2, 3);
      const absorbed = dysonAt(sysN.id).owner === 3 && G.space.dyson.owner === 3;
      spaceAbsorb(3, 2); // hand everything back
      t12 = ctrlGate && survives && noAutoTransfer && absorbed;
      log10("t12-sphere-survives-colony-loss=" + t12 + " survives=" + survives +
        " upgrade-needs-control=" + ctrlGate + " no-auto-transfer=" + noAutoTransfer + " annexation-absorbs=" + absorbed);
    } else log10("t12-sphere-survives-colony-loss=SKIP");

    // ============ regression — phantomFullDyson counts system spheres ============
    G.space.dyson = null;
    const viaSystem = sysN ? phantomFullDyson(2) : "SKIP"; // the sysN sphere alone qualifies
    G.space.dyson = { owner: 2, stage: MEGA_DEFS.dyson.stages, prog: 0, building: false, hp: DYSON_HP };
    log10("t13-system-sphere-feeds-phantom=" + viaSystem);

    // ============ render smoke — cloaked homeland + foreign spheres ============
    let renderOK = true;
    try {
      activatePhantom(2, "home");
      spaceOpen = true;
      const vpEl = document.getElementById("space-vp");
      if (vpEl) vpEl.style.display = "block";
      const h2 = systemDef("home");
      spaceCam.zoom = 0.5; spaceCam.x = h2.x; spaceCam.z = h2.z;
      spaceRender();
      if (sysN) { const sN = systemDef(sysN.id); spaceCam.x = sN.x; spaceCam.z = sN.z; spaceRender(); }
      spaceCam.zoom = 0.05; spaceCam.x = 0; spaceCam.z = 0;
      spaceRender();
      spaceOpen = false;
      standDown(2);
    } catch (e) { renderOK = false; out.push("render error: " + e.message + "\n" + e.stack); }
    log10("t14-render-smoke=" + renderOK + " (cloaked homeland, multi-system spheres, galaxy view)");

    log10("DONE10");
    flush();
  }
})();
