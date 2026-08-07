// BUG REPORT (Phantom Step console, era-wide research costs, star-death
// economy) test battery. Covers: the phantom_t research gate and the Deep
// Space Research Station activation console (status lines, system selector,
// "required" notice on ordinary stations), the same activation rules for AI
// countries and aliens, the heavily raised RP costs of EVERY era (with strict
// progressive separation and engine/display agreement), and the total economic
// shutdown of a system whose star dies (production, mining, halos, growth,
// founding — all stop).
// Loaded by test8.html; run with headless Chrome (--dump-dom), results land in
// <pre id="test-out"> prefixed TEST8:
(function () {
  const out = [];
  function flush() {
    let el = document.getElementById("test-out");
    if (!el && document.body) { el = document.createElement("pre"); el.id = "test-out"; document.body.appendChild(el); }
    if (el) el.textContent = out.join("\n");
  }
  const log8 = (...a) => { const s = "TEST8: " + a.join(" "); out.push(s); console.log(s); flush(); };
  window.addEventListener("error", e => { out.push("TEST8 PAGE ERROR: " + e.message + " " + (e.filename || "") + ":" + e.lineno); flush(); });
  const boot = setInterval(() => {
    if (typeof ID_ARR === "undefined" || !ID_ARR) return;
    clearInterval(boot);
    try { run(); } catch (e) { out.push("TEST8 ERROR: " + e.message + "\n" + e.stack); flush(); }
  }, 200);
  const inLog = txt => G.log.some(l => (l.x || "").includes(txt));
  function run() {
    initGame("standard", 2);
    startGameUI();
    G.rtPaused = true; // deterministic: only OUR calls advance the simulation
    const P = G.countries[2];
    ensureSpaceState();
    markSpaceReached(); // Alien War AI Fix §0: the battery simulates the first launch
    const aliens = G.space.aliens || [];

    // ============ BUG REPORT §3-5 — every era's REAL costs are raised ============
    const mins = [null, 100, 300, 800, 2000, 5000, 12000, 30000, 75000, 200000];
    let rangesOK = true, progressive = true, prevMax = 0;
    for (let e = 1; e <= 9; e++) {
      const costs = TECHS.filter(t => t.e === e).map(t => t.c);
      const lo = Math.min(...costs), hi = Math.max(...costs);
      if (lo < mins[e]) { rangesOK = false; log8("  era " + e + " min " + lo + " under floor " + mins[e]); }
      if (lo <= prevMax) progressive = false; // each era starts above the last era's top
      prevMax = hi;
    }
    const stone = TECH_BY_ID.stone_tools;
    log8("t1-costs-every-era-raised=" + (rangesOK && stone.c >= 130) + " stone=" + stone.c +
      " (was ~30, report demands ~130+)");
    log8("t2-costs-progressive=" + progressive + " (every era starts above the previous era's most expensive tech)");
    const pht = TECH_BY_ID.phantom_t;
    log8("t3-phantom-tech-exists=" + (!!pht && pht.e === 9 && pht.req.includes("researcher_t") &&
      pht.c >= 200000 && pht.c < TECH_BY_ID.doomdevice.c) + " cost=" + (pht ? pht.c : "?") +
      " (megastructure-priced, DOOM Device stays the hardest)");

    // the engine finishes research against the SAME t.c the tree displays
    const c3 = G.countries[3];
    c3.era = 1; c3.researched = {}; c3.researching = null; c3.rp = 0; bumpMods();
    c3.res.money = 5000; c3.res.food = 500; c3.res.mat = 500;
    const sr = startResearch(c3, "stone_tools");
    const lockedEra2 = startResearch(c3, "bronze") === false; // era gating intact
    c3.rp = stone.c - 1;
    const notEarly = !c3.researched.stone_tools;
    collectIncome(c3); // adds this tick's research and crosses the t.c threshold
    log8("t4-engine-uses-displayed-cost=" + (sr === true && lockedEra2 && notEarly &&
      c3.researched.stone_tools === true) + " finished-at=" + stone.c);

    // ============ BUG REPORT §1-2 + Critical Bug-Fix §4 — the station console ============
    // The phantomStatus() controller drives the console: requirement checklist
    // (tech / full Dyson / Deep Space station), cycle state and the ONE
    // Activate Phantom Step button. No star-panel duplicate remains.
    P.era = 9;
    P.researched.researcher_t = true; bumpMods();
    P.res.money = 9000000; P.res.mat = 9000000; P.res.energy = 9000000;
    G.space.planets.kae1.colony = { owner: 2, lvl: 2, garrison: [] };
    const hp0 = planetPos("home");
    buildResearcher(2, hp0.x + 220, 0, hp0.z + 220, true);
    const rr = (G.space.researchers || []).find(r => r.owner === 2);
    const panel = () => { renderSpacePanel(); return document.getElementById("space-panel").innerHTML; };
    spaceSel = { kind: "researcher", id: rr.id };
    const htmlPlain = panel();
    const plainSaysRequired = htmlPlain.includes("requirements missing") && !htmlPlain.includes("sp-phantom-st");
    rr.lvl = PHANTOM.deepLvl;
    upgradeResearcherDeep(2, rr.id, true);
    const denyNoTech = activatePhantom(2, "kae") === false; // station stands, research missing
    const htmlNoTech = panel();
    const deepSaysUnresearched = htmlNoTech.includes("Phantom Step technology researched") &&
      htmlNoTech.includes("missing") && !htmlNoTech.includes("sp-phantom-st");
    P.researched.phantom_t = true; bumpMods();
    // tech + station alone are STILL not enough — the full Dyson Sphere gates it
    const denyNoDyson = activatePhantom(2, "kae") === false;
    const htmlNoDyson = panel();
    const saysDysonMissing = htmlNoDyson.includes("Dyson Sphere fully built") && !htmlNoDyson.includes("sp-phantom-st");
    G.space.dyson = { owner: 2, stage: MEGA_DEFS.dyson.stages, prog: 0, building: false, hp: DYSON_HP };
    const htmlReady = panel();
    const readyConsole = htmlReady.includes("READY") &&
      htmlReady.includes("sp-ph-sys") && htmlReady.includes("sp-phantom-st") &&
      htmlReady.includes("Activate Phantom Step");
    log8("t5-station-console-gates=" + (plainSaysRequired && denyNoTech && deepSaysUnresearched &&
      denyNoDyson && saysDysonMissing && readyConsole) +
      " plain-station-notice=" + plainSaysRequired + " tech-gate=" + denyNoTech +
      " unresearched-notice=" + deepSaysUnresearched + " dyson-gate=" + (denyNoDyson && saysDysonMissing) +
      " ready-console=" + readyConsole);

    const actTurn = G.turn;
    const act = activatePhantom(2, "kae");
    const htmlActive = panel();
    const showsActive = htmlActive.includes("ACTIVE") && htmlActive.includes("Hidden system") &&
      htmlActive.includes(esc(systemDef("kae").n));
    G.turn = actTurn + PHANTOM.active; // the strict 50 turns pass
    tickPhantom();
    const htmlCd = panel();
    const showsCooldown = !phantomActive("kae") && htmlCd.includes("cooldown") &&
      P.phantomCdUntil === actTurn + PHANTOM.active + PHANTOM.cooldown;
    G.turn = P.phantomCdUntil; // the strict 25-turn cooldown ends
    const reAct = activatePhantom(2, "kae");
    log8("t6-console-status-and-cycle=" + (act === true && showsActive && showsCooldown && reAct === true) +
      " active-view=" + showsActive + " cooldown-view=" + showsCooldown +
      " cycle=" + PHANTOM.active + "/" + PHANTOM.cooldown);
    delete G.space.systems.kae.phantom; P.phantomSys = null; P.phantomCdUntil = 0; // stand down

    // ============ BUG REPORT §2+§6 — AI countries and aliens, same rules ============
    const sysBdef = SPACE_PLANETS.find(d => {
      const sid = planetSysId(d);
      return sid !== "home" && sid !== "kae" && sid !== "vex" && !G.space.planets[d.id].destroyed &&
        !G.space.planets[d.id].colony && !(aliens || []).some(a => a.sys === sid);
    });
    let aiOK = "SKIP";
    if (sysBdef) {
      const sysB = planetSysId(sysBdef);
      c3.era = 9; c3.researched.researcher_t = true; c3.researched.phantom_t = true; bumpMods();
      c3.res.money = 900000; c3.res.mat = 900000; c3.res.energy = 900000;
      G.space.planets[sysBdef.id].colony = { owner: 3, lvl: 1, garrison: [] };
      const denyNoStation = activatePhantom(3, sysB, true) === false; // tech alone is NOT enough
      buildResearcher(3, hp0.x - 260, 0, hp0.z - 260, true);
      const r3 = (G.space.researchers || []).find(r => r.owner === 3);
      r3.lvl = PHANTOM.deepLvl;
      upgradeResearcherDeep(3, r3.id, true);
      // Critical Bug-Fix §4: the AI also needs a FULLY BUILT Dyson Sphere —
      // here a conquered system sphere (the home sphere belongs to player 2)
      const denyAiNoDyson = activatePhantom(3, sysB, true) === false;
      G.space.systems[sysB].dyson = { owner: 3, stage: MEGA_DEFS.dyson.stages, hp: DYSON_HP };
      const aiAct = activatePhantom(3, sysB, true);
      aiOK = denyNoStation && denyAiNoDyson && aiAct === true && phantomActive(sysB);
      delete G.space.systems[sysB].phantom; c3.phantomSys = null; c3.phantomCdUntil = 0;
      delete G.space.systems[sysB].dyson;
    }
    log8("t7-ai-same-station-rules=" + aiOK + " (tech without a Deep Space station is refused)");
    const hyper = aliens.find(a => a.tier >= 4 && !a.defeated);
    const lesser = aliens.find(a => a.tier < 4 && !a.defeated && ALIEN_TIERS[a.tier].era < 9);
    let alienOK = "SKIP";
    if (hyper || lesser) {
      const hyperAct = hyper ? activatePhantom(hyper.aid, hyper.sys, true) : true; // innate at era 9
      const lesserAct = lesser ? activatePhantom(lesser.aid, lesser.sys, true) : false;
      alienOK = hyperAct === true && lesserAct === false;
      if (hyper && G.space.systems[hyper.sys]) {
        delete G.space.systems[hyper.sys].phantom;
        G.countries[hyper.aid].phantomSys = null; G.countries[hyper.aid].phantomCdUntil = 0;
      }
    }
    log8("t8-alien-rules=" + alienOK + " hyper=" + (hyper ? "yes" : "none") + " lesser=" + (lesser ? "yes" : "none") +
      " (hyper-advanced carry the tech innately, lesser tiers never cloak)");

    // ==== BUG REPORT §9 + Critical Bug-Fix §5 — a Dead Sun cuts output to 20% ====
    for (const t of TECHS) P.researched[t.id] = true;
    bumpMods();
    const vex = systemDef("vex");
    G.space.planets.vex1.colony = { owner: 2, lvl: 3, garrison: [], b: { mine: 2 } };
    G.space.planets.vex1.halo = { owner: 2, done: true };
    const vexDef = planetDef("vex1"), vexSt = G.space.planets.vex1;
    const prodBefore = colonyProduction(vexDef, vexSt, P);
    const incBefore = spaceIncomeOf(P);
    const capBefore = colonyPopCap(P);
    const sdv = { id: 9401, owner: 2, unit: "stardestroyer", hp: 2500, maxHp: 2500, stack: 1, cargo: [],
      x: vex.x + 40, y: 0, z: vex.z + 40, target: null, chase: null, orbit: null, orbitAng: 0, cd: 0, novaCd: 0, harvestCd: 0 };
    G.space.ships.push(sdv);
    for (let i = 0; i < 3; i++) {
      sdv.harvestCd = 0;
      startStellarHarvest(sdv, "vex");
      tickStellarHarvests(STELLAR_HARVEST.time + 1);
    }
    const dead = sysLightState("vex") === "dead" && sunDead("vex");
    const prodAfter = colonyProduction(vexDef, vexSt, P);
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    const DM = DEAD_SUN.prodMult; // the required multiplier: 20% remains
    const at20 = near(prodAfter.money, prodBefore.money * DM) && near(prodAfter.mat, prodBefore.mat * DM) &&
      near(prodAfter.energy, prodBefore.energy * DM) && near(prodAfter.research, prodBefore.research * DM) &&
      near(prodAfter.food, prodBefore.food * DM);
    const hadOutput = prodBefore.money > 0 && prodBefore.mat > 0;
    log8("t9-dead-sun-cuts-production-to-20pct=" + (dead && hadOutput && at20 && DM === 0.20) +
      " before=" + Math.round(prodBefore.money) + "/" + Math.round(prodBefore.mat) +
      " after=" + prodAfter.money.toFixed(1) + "/" + prodAfter.mat.toFixed(1) + " mult=" + DM + " (mines included)");
    const incAfter = spaceIncomeOf(P);
    const econDrop = near(incAfter.colonies.money, incBefore.colonies.money - prodBefore.money * (1 - DM)) &&
      near(incAfter.colonies.mat, incBefore.colonies.mat - prodBefore.mat * (1 - DM)) &&
      near(incAfter.haloMoney, incBefore.haloMoney - 80 * (1 - DM));
    log8("t10-global-economy-reflects-loss=" + econDrop +
      " halo-at-20pct=" + near(incAfter.haloMoney, incBefore.haloMoney - 80 * (1 - DM)) +
      " (the very next income tick credits exactly 20% from the system)");
    const upDenied = upgradeColony(2, "vex1", true) === false;
    const bldDenied = buildColonyBldg(2, "vex1", "mine", true) === false;
    const vex2 = SPACE_PLANETS.find(d => planetSysId(d) === "vex" && !G.space.planets[d.id].colony && !G.space.planets[d.id].destroyed);
    const settleDenied = vex2 ? colonizePlanet(2, vex2.id, true) === false : true;
    const capAfter = colonyPopCap(P);
    const capAt20 = capAfter < capBefore && capAfter > 0; // 20% remains, not zero
    log8("t11-frozen-infrastructure=" + (upDenied && bldDenied && settleDenied && capAt20 &&
      !vexSt.destroyed && !!vexSt.colony) +
      " upgrade-blocked=" + upDenied + " industry-blocked=" + bldDenied + " settle-blocked=" + settleDenied +
      " pop-cap-drop=" + (capBefore - capAfter).toFixed(1) + " colony-survives=" + (!!vexSt.colony));
    log8("t12-shutdown-announced=" + inLog("freeze in the dark"));
    // §5 homeland rule: kill the HOME sun and the whole map economy drops to 20%
    const hs8 = systemDef("home");
    const homeProdBefore = production(P);
    const sdh8 = { id: 9402, owner: 2, unit: "stardestroyer", hp: 2500, maxHp: 2500, stack: 1, cargo: [],
      x: hs8.x + 30, y: 0, z: hs8.z + 30, target: null, chase: null, orbit: null, orbitAng: 0, cd: 0, novaCd: 0, harvestCd: 0 };
    G.space.ships.push(sdh8);
    for (let i = 0; i < 3; i++) {
      sdh8.harvestCd = 0;
      startStellarHarvest(sdh8, "home");
      tickStellarHarvests(STELLAR_HARVEST.time + 1);
    }
    const homeProdAfter = production(P);
    const homeCut = sunDead("home") &&
      near(homeProdAfter.food, homeProdBefore.food * DM) &&
      near(homeProdAfter.mat, homeProdBefore.mat * DM) &&
      near(homeProdAfter.research, homeProdBefore.research * DM);
    log8("t13-homeland-economy-at-20pct=" + homeCut +
      " mat " + Math.round(homeProdBefore.mat) + "→" + Math.round(homeProdAfter.mat) +
      " research " + Math.round(homeProdBefore.research) + "→" + Math.round(homeProdAfter.research));
    // save/load: the dead suns and the 20% rule survive a full JSON round-trip
    G = JSON.parse(JSON.stringify(G));
    ensureSpaceState();
    const prodLoaded = colonyProduction(planetDef("vex1"), G.space.planets.vex1, G.countries[2]);
    log8("t14-dead-sun-survives-save-load=" + (sunDead("vex") && sunDead("home") &&
      near(prodLoaded.money, prodBefore.money * DM) &&
      near(production(G.countries[2]).mat, homeProdAfter.mat)));

    log8("DONE8");
    flush();
  }
})();
