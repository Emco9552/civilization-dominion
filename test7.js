// Update (Solar Death, Central Black Hole Harvester, Phantom Step) battery.
// Covers the 20 tests of Update.txt §22: Dead Sun states & permanent darkness,
// the unique central black hole (10%/90% alien roll), the Harvester tech chain,
// staged/pausable construction, infinite charging under cooldowns, attack &
// ruin & rebuild rules, the untouchable black hole, and the full Phantom Step
// cloak with its strict 50/25 cycle and Deep Space Research Station detection.
// Loaded by test7.html; run with headless Chrome (--dump-dom), results land in
// <pre id="test-out"> prefixed TEST7:
(function () {
  const out = [];
  function flush() {
    let el = document.getElementById("test-out");
    if (!el && document.body) { el = document.createElement("pre"); el.id = "test-out"; document.body.appendChild(el); }
    if (el) el.textContent = out.join("\n");
  }
  const log7 = (...a) => { const s = "TEST7: " + a.join(" "); out.push(s); console.log(s); flush(); };
  window.addEventListener("error", e => { out.push("TEST7 PAGE ERROR: " + e.message + " " + (e.filename || "") + ":" + e.lineno); flush(); });
  const boot = setInterval(() => {
    if (typeof ID_ARR === "undefined" || !ID_ARR) return;
    clearInterval(boot);
    try { run(); } catch (e) { out.push("TEST7 ERROR: " + e.message + "\n" + e.stack); flush(); }
  }, 200);
  function run() {
    initGame("standard", 2);
    startGameUI();
    G.rtPaused = true; // deterministic: only OUR calls advance the simulation
    const P = G.countries[2];
    for (const t of TECHS) P.researched[t.id] = true;
    P.era = 9; bumpMods();
    P.res.money = 9000000; P.res.mat = 9000000; P.res.energy = 9000000;
    ensureSpaceState();
    markSpaceReached(); // Alien War AI Fix §0: the battery simulates the first launch
    const aliens = G.space.aliens || [];
    const realRnd = Math.random;

    // ============ §5/Test 4 — exactly one central black hole ============
    const bh = galaxyBH();
    log7("t4-one-black-hole=" + (!!bh && typeof bh.x === "number" && typeof bh.z === "number" &&
      !Array.isArray(bh) && bh.r === BLACK_HOLE.r));

    // ============ §6/Test 5 — the 10% / 90% occupancy roll ============
    Math.random = () => 0.05;
    const genA = genGalaxy();
    Math.random = () => 0.5;
    const genB = genGalaxy();
    Math.random = realRnd;
    log7("t5-bh-alien-roll=" + (genA.bh.aliens === true && genB.bh.aliens === false) +
      " this-galaxy-occupied=" + bh.aliens + " guard=" + (aliens.some(a => a.bhGuard) ? "yes" : "no"));

    // ============ §8/Test 6 — tech chain Dyson → Halo → Harvester ============
    const bt = TECH_BY_ID.bhharvest_t;
    const tmp = { era: 9, researched: {} };
    const lockedA = techUnlocked(tmp, bt);
    tmp.researched.dysonsphere = true;
    const lockedB = techUnlocked(tmp, bt);
    tmp.researched.haloring = true;
    const open = techUnlocked(tmp, bt);
    log7("t6-tech-chain=" + (lockedA === false && lockedB === false && open === true) + " req=" + JSON.stringify(bt.req));

    // ============ §9/Tests 7-8 — construction: free of territory, pausable ============
    const rec = aliens.find(a => !a.defeated);
    if (rec) { // an enemy ship parked at the core — control of space is NOT required
      G.space.ships.push({ id: 9301, owner: rec.aid, unit: "starfleet", hp: 600, maxHp: 600, stack: 1, cargo: [],
        x: bh.x + 30, y: 0, z: bh.z + 30, target: null, chase: null, orbit: null, orbitAng: 0, cd: 0 });
    }
    // Critical Bug-Fix §1: construction is REFUSED while no owned ship holds at
    // the black hole — the enemy ship above does not count for us
    const denyFarBH = startBHStage(2) === false && !G.space.bhH;
    G.space.ships.push({ id: 9300, owner: 2, unit: "starfleet", hp: 600, maxHp: 600, stack: 1, cargo: [],
      x: bh.x + 50, y: 0, z: bh.z - 30, target: null, chase: null, orbit: null, orbitAng: 0, cd: 0 });
    const s1 = startBHStage(2);
    let bhH = G.space.bhH;
    log7("t8-no-territorial-control=" + (denyFarBH && s1 === true && !!bhH && bhH.building === true && bhH.owner === 2) +
      " ship-presence-required=" + denyFarBH);
    let pauseOK = false;
    for (let stage = 0; stage < BH_HARVESTER.stages; stage++) {
      if (!bhH.building && bhH.stage < BH_HARVESTER.stages) startBHStage(2);
      if (stage === 1) { // §9/Test 7: interrupt mid-stage, progress holds, resume
        spaceTurnTick(); spaceTurnTick();
        const pKept = bhH.prog;
        bhHarvesterHit(500, rec ? rec.aid : 3);
        const paused = bhH.paused === true && bhH.building === true && bhH.prog === pKept;
        spaceTurnTick(); spaceTurnTick();
        const held = bhH.prog === pKept; // paused = no progress, none lost
        resumeBH(2);
        pauseOK = paused && held && bhH.paused === false;
      }
      let guard = 0;
      while (bhH.building && guard++ < 40) spaceTurnTick();
    }
    log7("t7-pause-and-resume=" + pauseOK);
    log7("t7b-staged-completion=" + (bhH.stage === BH_HARVESTER.stages && !!bhH.shield && bhH.shield.hp === BH_HARVESTER.shield));

    // ============ §10-11/Tests 9-10 — infinite charging under cooldowns ============
    const mkSD = (id, dx) => ({ id, owner: 2, unit: "stardestroyer", hp: 2500, maxHp: 2500, stack: 1, cargo: [],
      x: bh.x + dx, y: 0, z: bh.z + 40, target: null, chase: null, orbit: null, orbitAng: 0, cd: 0, novaCd: 0 });
    const sd = mkSD(9302, 40), sdB = mkSD(9303, -50);
    G.space.ships.push(sd, sdB);
    const c1 = startBHCharge(sd);
    tickStellarHarvests(BH_HARVESTER.chargeTime + 1);
    const gotOne = sd.omniCharges === 1;
    const denySame = canBHCharge(sd).ok === false;   // the ship's own harvest cooldown
    const denyOther = canBHCharge(sdB).ok === false; // the Harvester's shared cooldown
    G.space.bhH.cd = 0; sd.harvestCd = 0;
    startBHCharge(sd); tickStellarHarvests(BH_HARVESTER.chargeTime + 1);
    log7("t9-infinite-charging=" + (c1 === true && gotOne && sd.omniCharges === 2 &&
      !galaxyBH().dead && !galaxyBH().harvests) + " charges=" + sd.omniCharges + " (black hole unweakened)");
    log7("t10-cooldowns-block-spam=" + (denySame && denyOther));

    // ============ §12-14/Tests 11-13 — attacked, ruined, rebuilt; core untouched ============
    bhH = G.space.bhH;
    const hpFull = bhH.hp, shFull = bhH.shield.hp;
    const atkId = rec ? rec.aid : 3;
    G.countries[atkId].res.money = 900000; G.countries[atkId].res.mat = 900000; G.countries[atkId].res.energy = 900000;
    const esd = { id: 9304, owner: atkId, unit: "stardestroyer", hp: 2500, maxHp: 2500, stack: 1, cargo: [],
      x: bh.x + 60, y: 0, z: bh.z - 40, target: null, chase: null, orbit: null, orbitAng: 0, cd: 0, novaCd: 0 };
    G.space.ships.push(esd);
    const hit1 = sdStrikeHarvester(esd);
    const shieldSoaked = bhH.shield.hp < shFull && bhH.hp === hpFull && !bhH.ruins;
    log7("t11-massive-but-no-oneshot=" + (hit1 === true && shieldSoaked));
    bhH.shield.hp = 0;
    let hits = 0;
    while (!bhH.ruins && hits++ < 60) bhHarvesterHit(SD_LASER.dmg * 1.5, atkId);
    const several = hits >= Math.floor(BH_HARVESTER.hp / (SD_LASER.dmg * 1.5));
    log7("t13a-ruined-after-many-hits=" + (bhH.ruins === true && several) + " hits=" + hits);
    log7("t12-black-hole-never-harmed=" + (!!galaxyBH() && galaxyBH().r === BLACK_HOLE.r && !galaxyBH().destroyed));
    const rb = startBHStage(2);
    log7("t13b-rebuild-on-the-ruins=" + (rb === true && G.space.bhH.ruins === false && G.space.bhH.stage === 0 && G.space.bhH.building === true));

    // ============ §17-18/Tests 14+16-18 — Phantom Step ============
    G.space.planets.kae1.colony = { owner: 2, lvl: 2, garrison: [] };
    const denyNoDeep = activatePhantom(2, "kae") === false; // gate: needs the Deep Space station
    const hp0 = planetPos("home");
    const rOK = !!buildResearcher(2, hp0.x + 220, 0, hp0.z + 220, true); // returns the researcher record
    const rr = (G.space.researchers || []).find(r2 => r2.owner === 2);
    rr.lvl = PHANTOM.deepLvl;
    const deepOK = upgradeResearcherDeep(2, rr.id, true);
    // Critical Bug-Fix §4: station + tech are still not enough — a FULLY BUILT
    // Dyson Sphere is the third gate
    const denyNoDyson = activatePhantom(2, "kae") === false;
    G.space.dyson = { owner: 2, stage: MEGA_DEFS.dyson.stages, prog: 0, building: false, hp: DYSON_HP };
    log7("t-gate-deep-station=" + (denyNoDeep && rOK && deepOK === true && rr.deep === true && hasDeepResearcher(2) &&
      denyNoDyson && phantomFullDyson(2)) + " dyson-gate=" + denyNoDyson);
    const prodBefore = JSON.stringify(colonyProduction(planetDef("kae1"), G.space.planets.kae1, P));
    const actTurn = G.turn;
    const act = activatePhantom(2, "kae");
    const foe = rec ? rec.aid : 5;
    log7("t14-phantom-hides-system=" + (act === true && phantomActive("kae") &&
      phantomHiddenFrom("kae", foe) && !phantomHiddenFrom("kae", 2)));
    const prodAfter = JSON.stringify(colonyProduction(planetDef("kae1"), G.space.planets.kae1, P));
    log7("t18-visual-only-no-penalty=" + (prodBefore === prodAfter));
    // §18.1-18.2: a ship INSIDE the cloak hides from neutrals, war exposes it
    const kp = planetPos("kae1");
    const pShip = { id: 9305, owner: 2, unit: "starfleet", hp: 600, maxHp: 600, stack: 1, cargo: [],
      x: kp.x + 8, y: 0, z: kp.z + 8, target: null, chase: null, orbit: null, orbitAng: 0, cd: 0 };
    G.space.ships.push(pShip);
    const neutralId = Object.keys(G.countries).map(Number).find(k => k !== 2 && G.countries[k].alive && !isSynthetic(G.countries[k]) && !atWar(k, 2));
    const hidFromNeutral = neutralId ? phantomShipHiddenFrom(pShip, neutralId) === true : true;
    const visToEnemy = rec && atWar(rec.aid, 2) ? phantomShipHiddenFrom(pShip, rec.aid) === false : true;
    const sysStillFogged = rec ? phantomHiddenFrom("kae", rec.aid) === true : true;
    const outShip = { id: 9306, owner: 2, unit: "starfleet", hp: 600, maxHp: 600, stack: 1, cargo: [],
      x: 40, y: 0, z: 40, target: null, chase: null, orbit: null, orbitAng: 0, cd: 0 }; // OUTSIDE the cloak
    G.space.ships.push(outShip);
    const exposedOutside = neutralId ? phantomShipHiddenFrom(outShip, neutralId) === false : true;
    log7("t16-war-and-exit-exposure=" + (hidFromNeutral && visToEnemy && sysStillFogged && exposedOutside) +
      " at-war-with-alien=" + (rec ? atWar(rec.aid, 2) : "n/a"));

    // ============ §21/Test 15 — entry & exit distortion effects ============
    const kaeSys = systemDef("kae");
    spaceCam.x = kaeSys.x; spaceCam.z = kaeSys.z;
    phantomCamSys = null;
    spaceFx.length = 0;
    phantomCamFx();
    const gotRipple = spaceFx.some(f => f.kind === "ripple");
    spaceCam.x = 0; spaceCam.z = 0;
    phantomCamFx();
    const gotStreak = spaceFx.some(f => f.kind === "streak");
    log7("t15-entry-exit-fx=" + (gotRipple && gotStreak));

    // ============ §18.3/Test 17 — blind Locate Life, Deep Scan disruption ============
    const recP = aliens.find(a => !a.defeated && a !== rec) || rec;
    if (recP) {
      G.space.systems[recP.sys].revealed = false;
      G.space.systems[recP.sys].phantom = { owner: recP.aid, until: G.turn + PHANTOM.active };
      G.countries[recP.aid].phantomSys = recP.sys;
      rr.cd = 0;
      Math.random = () => 0.01; // Locate Life would always "succeed"…
      locateInterstellarLife(2, rr.id, true);
      Math.random = realRnd;
      const blind = G.space.systems[recP.sys].revealed === false; // …but never on a cloaked system
      rr.cd = 0;
      Math.random = () => 0.9; // above the 25% — disruption fails
      deepScanPhantom(2, rr.id, true);
      const survived = phantomActive(recP.sys);
      rr.cd = 0;
      Math.random = () => 0.1; // under the 25% — the field breaks
      deepScanPhantom(2, rr.id, true);
      Math.random = realRnd;
      const broken = !phantomActive(recP.sys) && (G.countries[recP.aid].phantomCdUntil || 0) > G.turn;
      log7("t17-detection-rules=" + (blind && survived && broken) +
        " locate-blind=" + blind + " scan-fail-keeps=" + survived + " scan-break=" + broken);
    } else log7("t17-detection-rules=SKIP (no second alien)");

    // ============ §19/Tests 19-20 — the strict 50/25 cycle, full shutdown ============
    const stK = G.space.systems.kae;
    const untilOK = stK.phantom && stK.phantom.until === actTurn + PHANTOM.active;
    G.turn = actTurn + PHANTOM.active; // 50 turns pass
    tickPhantom();
    const off = !phantomActive("kae") && !stK.phantom;
    const fullShutdown = off && P.phantomSys === null && !phantomHiddenFrom("kae", foe) &&
      (neutralId ? phantomShipHiddenFrom(pShip, neutralId) === false : true);
    const cdSet = P.phantomCdUntil === actTurn + PHANTOM.active + PHANTOM.cooldown;
    const denyDuringCd = activatePhantom(2, "kae") === false;
    G.turn = P.phantomCdUntil; // the 25-turn cooldown ends
    const reAct = activatePhantom(2, "kae");
    log7("t19-strict-50-25-cycle=" + (untilOK && off && cdSet && denyDuringCd && reAct === true) +
      " active=" + PHANTOM.active + " cooldown=" + PHANTOM.cooldown);
    log7("t20-full-shutdown-no-residue=" + fullShutdown);
    delete G.space.systems.kae.phantom; P.phantomSys = null; // stand down for the visual tests

    // ============ §1-4/Tests 1-3 — Dead Sun ≠ Destroyed, permanent darkness ============
    const vex = systemDef("vex");
    const sdv = mkSD(9307, 0);
    sdv.x = vex.x + 40; sdv.z = vex.z + 40; sdv.harvestCd = 0; sdv.omniCharges = 0;
    G.space.ships.push(sdv);
    const states = [sysLightState("vex")];
    for (let i = 0; i < 3; i++) {
      sdv.harvestCd = 0;
      startStellarHarvest(sdv, "vex");
      tickStellarHarvests(STELLAR_HARVEST.time + 1);
      states.push(sysLightState("vex"));
    }
    const stVex = G.space.systems.vex;
    log7("t1-dead-sun-transform=" + (states[0] === "active" && states[1] === "dimmed" && states[2] === "dimmed" &&
      states[3] === "dead" && stVex.dead === true && !stVex.nova && canHarvestStar(sdv, "vex").ok === false) +
      " states=" + states.join("→"));
    G.space.systems.zer.revealed = true;
    sdv.omniCd = 0;
    const firedZ = omniStrike(sdv, "zer"); // 3 charges aboard from the harvests
    log7("t2-dead-vs-destroyed=" + (firedZ === true && sysLightState("zer") === "nova" && sysLightState("vex") === "dead" &&
      G.space.planets.vex1.destroyed !== true && G.space.planets.zer1.destroyed === true) +
      " (a Dead Sun keeps its planets — a destroyed system does not)");
    // kill the HOME sun: the homeland falls into permanent night
    // (Critical Bug-Fix §2 moved the homeland off the galaxy origin — park the
    // ship beside the star wherever this galaxy rolled it)
    const hs7 = systemDef("home");
    const sdh = mkSD(9308, 0);
    sdh.x = hs7.x + 30; sdh.z = hs7.z + 30; sdh.harvestCd = 0; sdh.omniCharges = 0;
    G.space.ships.push(sdh);
    for (let i = 0; i < 3; i++) {
      sdh.harvestCd = 0;
      startStellarHarvest(sdh, "home");
      tickStellarHarvests(STELLAR_HARVEST.time + 1);
    }
    viewOpts.dayNight = false; // even with the day/night toggle OFF…
    const nightForced = nightness() === 1;
    viewOpts.dayNight = true;
    const nightStill = nightness() === 1;
    log7("t3-permanent-darkness=" + (sunDead("home") && nightForced && nightStill && !G.space.planets.home.destroyed &&
      sysLightState("home") === "dead"));

    // ============ render smoke test — dead system, black hole, fog, galaxy view ============
    let renderOK = true;
    try {
      spaceOpen = true;
      const vpEl = document.getElementById("space-vp");
      if (vpEl) vpEl.style.display = "block";
      spaceCam.zoom = 0.5; spaceCam.x = vex.x; spaceCam.z = vex.z;
      spaceRender();
      spaceCam.x = bh.x; spaceCam.z = bh.z;
      spaceRender();
      spaceCam.zoom = 0.05; spaceCam.x = 0; spaceCam.z = 0; // the galaxy view
      spaceRender();
      spaceOpen = false;
    } catch (e) { renderOK = false; out.push("render error: " + e.message + "\n" + e.stack); }
    log7("t-render-smoke=" + renderOK + " (dead-sun haze, black hole + harvester ruins, galaxy view)");

    log7("DONE7");
    flush();
  }
})();
