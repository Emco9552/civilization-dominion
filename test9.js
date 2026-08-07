// BUG REPORT (Critical Bug-Fix Update) test battery — the §10 Critical Tests.
// Covers: the Black Hole Harvester spaceship-presence rule (player, AI and
// multiplayer share one gate), the randomized homeland spawn (black hole stays
// central, homeland never beside it, position varies per galaxy), the restored
// alien `Invade` button and full battle entry (war + loaded transport → button;
// battle → ownership transfer; button hidden without war/transport/battle),
// the rebuilt Phantom Step controller (tech + FULL Dyson + Deep Space station;
// 50-turn field; 25-turn cooldown; save/load in both states; no star-panel
// duplicate), and the Dead Sun ×0.20 production multiplier in Sandbox Mode
// plus alien economies.
// Loaded by test9.html; run with headless Chrome (--dump-dom), results land in
// <pre id="test-out"> prefixed TEST9:
(function () {
  const out = [];
  function flush() {
    let el = document.getElementById("test-out");
    if (!el && document.body) { el = document.createElement("pre"); el.id = "test-out"; document.body.appendChild(el); }
    if (el) el.textContent = out.join("\n");
  }
  const log9 = (...a) => { const s = "TEST9: " + a.join(" "); out.push(s); console.log(s); flush(); };
  window.addEventListener("error", e => { out.push("TEST9 PAGE ERROR: " + e.message + " " + (e.filename || "") + ":" + e.lineno); flush(); });
  const boot = setInterval(() => {
    if (typeof ID_ARR === "undefined" || !ID_ARR) return;
    clearInterval(boot);
    try { run(); } catch (e) { out.push("TEST9 ERROR: " + e.message + "\n" + e.stack); flush(); }
  }, 200);
  function run() {
    window.SPACE_DBG = true; // §9: exercise the availability diagnostics
    initGame("standard", 2);
    startGameUI();
    G.rtPaused = true; // deterministic: only OUR calls advance the simulation
    let P = G.countries[2];
    for (const t of TECHS) P.researched[t.id] = true;
    P.era = 9; bumpMods();
    P.res.money = 9000000; P.res.mat = 9000000; P.res.energy = 9000000;
    ensureSpaceState();
    markSpaceReached(); // Alien War AI Fix §0: the battery simulates the first launch
    const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);
    const panel = () => { renderSpacePanel(); return document.getElementById("space-panel").innerHTML; };

    // ============ §2/Tests 6-9 — galaxy generation ============
    const bh = galaxyBH();
    const home = systemDef("home");
    const bhCentral = Math.hypot(bh.x, bh.z) <= 1600;
    const homeOff = Math.hypot(home.x, home.z) >= 3000;
    const apart = Math.hypot(home.x - bh.x, home.z - bh.z) >= 2000;
    const stamped = G.space.gen.homePos && home.x === G.space.gen.homePos.x && home.z === G.space.gen.homePos.z;
    log9("t1-this-galaxy-layout=" + (bhCentral && homeOff && apart && !!stamped) +
      " bh@" + Math.round(Math.hypot(bh.x, bh.z)) + " home@" + Math.round(Math.hypot(home.x, home.z)) +
      " separation=" + Math.round(Math.hypot(home.x - bh.x, home.z - bh.z)));
    const spots = [], seps = [];
    let rollsOK = true;
    for (let i = 0; i < 6; i++) {
      const g2 = genGalaxy();
      spots.push(g2.homePos.x + "," + g2.homePos.z);
      seps.push(Math.round(Math.hypot(g2.homePos.x - g2.bh.x, g2.homePos.z - g2.bh.z)));
      if (Math.hypot(g2.bh.x, g2.bh.z) > 1600) rollsOK = false;                     // hole stays central
      if (Math.hypot(g2.homePos.x, g2.homePos.z) < 3000) rollsOK = false;           // homeland never central
      if (Math.hypot(g2.homePos.x - g2.bh.x, g2.homePos.z - g2.bh.z) < 2000) rollsOK = false; // never beside it
    }
    const varied = new Set(spots).size >= 4; // not always the same coordinates
    log9("t2-homeland-randomized=" + (rollsOK && varied) + " distinct=" + new Set(spots).size + "/6 min-sep=" + Math.min(...seps));
    // the camera opens on the homeland, wherever it rolled
    spaceSessionStart();
    const camOK = spaceCam.x === home.x && spaceCam.z === home.z;
    // old saves (no homePos) keep the classic centre — nothing strands
    const hpKeep = G.space.gen.homePos;
    G.space.gen.homePos = null; rebuildGalaxy();
    const legacyOK = systemDef("home").x === 0 && systemDef("home").z === 0;
    G.space.gen.homePos = hpKeep; rebuildGalaxy();
    const restored = systemDef("home").x === hpKeep.x;
    log9("t3-camera-and-legacy-saves=" + (camOK && legacyOK && restored) + " camera-on-home=" + camOK + " legacy-centre=" + legacyOK);

    // ============ §1/Tests 1-5 — Harvester needs a ship at the black hole ============
    // Test 1-2: attempt construction from the homeland with NO ship near the hole
    const denyP = startBHStage(2) === false && !G.space.bhH;
    spaceSel = { kind: "bh" };
    const htmlFar = panel();
    const farNotice = htmlFar.includes("A spaceship must reach the black hole") && !htmlFar.includes("sp-bh-stage");
    // the AI walks through the SAME function — same refusal without a ship
    const c3 = G.countries[3];
    c3.era = 9; for (const t of TECHS) c3.researched[t.id] = true; bumpMods();
    c3.res.money = 900000; c3.res.mat = 900000; c3.res.energy = 90000;
    const denyAI = startBHStage(3, true) === false;
    log9("t4-remote-construction-blocked=" + (denyP && farNotice && denyAI) +
      " player-blocked=" + denyP + " panel-explains=" + farNotice + " ai-blocked-too=" + denyAI);
    // Test 3-4: move a ship to the hole — the construction option appears
    G.space.ships.push({ id: 9901, owner: 2, unit: "starfleet", hp: 600, maxHp: 600, stack: 1, cargo: [],
      x: bh.x + 40, y: 0, z: bh.z + 40, target: null, chase: null, orbit: null, orbitAng: 0, cd: 0 });
    const htmlNear = panel();
    const nearBtn = htmlNear.includes("sp-bh-stage") && htmlNear.includes("Construct Black Hole Energy Harvester");
    const builds = startBHStage(2) === true && G.space.bhH && G.space.bhH.owner === 2 && G.space.bhH.building === true;
    log9("t5-presence-unlocks-construction=" + (nearBtn && builds) + " button=" + nearBtn + " stage-funded=" + builds);

    // ============ §3/Tests 10-16 — the alien Invade button & battle entry ============
    const aliens = (G.space.aliens || []).filter(a => !a.defeated);
    if (aliens.length) {
      // prefer a target that is NOT a capital so the civilization survives conquest
      let rec = null, targetId = null;
      for (const a of aliens) {
        for (const d of SPACE_PLANETS) {
          const stq = G.space.planets[d.id];
          if (stq && !stq.destroyed && stq.colony && stq.colony.owner === a.aid && d.id !== a.capital) { rec = a; targetId = d.id; break; }
        }
        if (rec) break;
      }
      if (!rec) { rec = aliens[0]; targetId = rec.capital; }
      const tDef = planetDef(targetId), tSt = G.space.planets[targetId];
      if (!tSt.colony.garrison.length) tSt.colony.garrison.push({ unit: "spearman", hp: 18, maxHp: 18 });
      const garrisonN = tSt.colony.garrison.length;
      spaceSel = { kind: "planet", id: targetId };
      const htmlPeace = panel();
      const hiddenAtPeace = !htmlPeace.includes("sp-invade-p"); // Test 16: no war → no button
      declareWar(2, rec.aid, true);
      const htmlNoShip = panel();
      const explainsNoShip = !htmlNoShip.includes("sp-invade-p") && htmlNoShip.includes("invasion blocked");
      // an EMPTY transport parks in orbit — still no button, reason changes
      const tPos = planetPos(targetId);
      const boat = { id: 9902, owner: 2, unit: "cargoship", hp: 320, maxHp: 320, stack: 1, cargo: [],
        x: tPos.x + 5, y: 0, z: tPos.z + 5, target: null, chase: null, orbit: null, orbitAng: 0, cd: 0 };
      G.space.ships.push(boat);
      const htmlEmpty = panel();
      const explainsNoTroops = !htmlEmpty.includes("sp-invade-p") && htmlEmpty.includes("no troops");
      log9("t6-invade-button-gating=" + (hiddenAtPeace && explainsNoShip && explainsNoTroops) +
        " peace-hidden=" + hiddenAtPeace + " no-transport-reason=" + explainsNoShip + " empty-transport-reason=" + explainsNoTroops);
      // Test 11-12: load troops → the button appears
      for (let i = 0; i < 3; i++) boat.cargo.push({ unit: "orbmarines", hp: unitMaxHp("orbmarines"), maxHp: unitMaxHp("orbmarines") });
      // the report's flow assumes the defending fleet was already cleared
      const R2 = (planetNearR(tDef) * 1.6) ** 2;
      for (const s2 of G.space.ships.slice()) {
        if (s2.owner === rec.aid && (s2.x - tPos.x) ** 2 + (s2.y - tPos.y) ** 2 + (s2.z - tPos.z) ** 2 < R2) {
          G.space.ships.splice(G.space.ships.indexOf(s2), 1);
        }
      }
      const htmlReady = panel();
      const btnShown = htmlReady.includes("sp-invade-p") && htmlReady.includes("Invade");
      const chk = invasionCheck(2, targetId);
      log9("t7-invade-button-appears=" + (btnShown && chk.ok === true && chk.ship === boat) +
        " button=" + btnShown + " module-ok=" + chk.ok);
      // Test 13-15: begin the battle through the same entry the button uses
      const went = chk.ok && resolveInvasion(chk.ship, targetId);
      const b = battleOn(targetId);
      const roles = b && b.att === 2 && b.def === rec.aid;
      const attackers = b ? b.units.filter(u => u.side === 0).length : 0;
      const defTroops = b ? b.units.filter(u => u.side === 1 && !u.turret).length : 0;
      const defTurrets = b ? b.units.filter(u => u.side === 1 && u.turret).length : 0;
      const turretsExpected = tSt.colony.lvl + (tSt.halo && tSt.halo.done ? 2 : 0);
      const cargoGone = boat.cargo.length === 0;
      const htmlBattle = panel();
      const hiddenDuring = !htmlBattle.includes("sp-invade-p") && htmlBattle.includes("ground battle");
      log9("t8-battle-entry=" + (went === true && roles && attackers === 3 && defTroops === garrisonN &&
        defTurrets === turretsExpected && cargoGone && hiddenDuring) +
        " att=" + (b ? b.att : "?") + " def=" + (b ? b.def : "?") + " attackers=" + attackers +
        " defenders=" + defTroops + "+" + defTurrets + "turrets cargo-emptied=" + cargoGone + " button-hidden-during=" + hiddenDuring);
      // attacker victory → ownership transfers (Test 15)
      for (const u of b.units) if (u.side === 1) u.hp = 0;
      tickPlanetBattles(0.1);
      const owned = b.done === 1 && b.winner === 2 && tSt.colony && tSt.colony.owner === 2;
      log9("t9-conquest-transfers-ownership=" + owned + " winner=" + (b.winner === 2 ? "player" : b.winner) +
        " new-owner=" + (tSt.colony ? tSt.colony.owner : "none"));
    } else log9("t6-t9=SKIP (no aliens this galaxy)");

    // ============ §4/Tests 17-22 — Phantom Step controller ============
    G.space.planets.kae1.colony = { owner: 2, lvl: 2, garrison: [] };
    const hp0 = planetPos("home");
    buildResearcher(2, hp0.x + 220, 0, hp0.z + 220, true);
    let rr = (G.space.researchers || []).find(r => r.owner === 2);
    rr.lvl = PHANTOM.deepLvl;
    upgradeResearcherDeep(2, rr.id, true);
    spaceSel = { kind: "researcher", id: rr.id };
    const noDyson = panel();
    const gatedNoDyson = activatePhantom(2, "kae") === false && noDyson.includes("Dyson Sphere fully built") &&
      !noDyson.includes("sp-phantom-st");
    G.space.dyson = { owner: 2, stage: MEGA_DEFS.dyson.stages, prog: 0, building: false, hp: DYSON_HP };
    const withDyson = panel();
    const showsActivate = withDyson.includes("sp-phantom-st") && withDyson.includes("Activate Phantom Step");
    // the star panel carries NO duplicate activation button any more
    G.space.systems.kae.revealed = true;
    spaceSel = { kind: "star", sys: "kae" };
    const starHtml = panel();
    const noDup = !starHtml.includes('id="sp-phantom"');
    log9("t10-station-console=" + (gatedNoDyson && showsActivate && noDup) +
      " dyson-gate=" + gatedNoDyson + " activate-appears=" + showsActivate + " star-duplicate-removed=" + noDup);
    const actTurn = G.turn;
    const act = activatePhantom(2, "kae");
    const st9 = phantomStatus(2);
    const fifty = G.space.systems.kae.phantom && G.space.systems.kae.phantom.until === actTurn + PHANTOM.active &&
      st9.activeSys === "kae" && st9.activeLeft === PHANTOM.active;
    // Test 22a: save & reload WHILE ACTIVE
    G = JSON.parse(JSON.stringify(G));
    ensureSpaceState();
    P = G.countries[2];
    const activeAfterLoad = phantomActive("kae") && G.space.systems.kae.phantom.until === actTurn + PHANTOM.active &&
      phantomStatus(2).activeSys === "kae";
    log9("t11-activation-and-duration=" + (act === true && fifty && activeAfterLoad) +
      " 50-turn-field=" + fifty + " survives-save-load=" + activeAfterLoad);
    // Test 21: the strict 25-turn cooldown
    G.turn = actTurn + PHANTOM.active;
    tickPhantom();
    const offNow = !phantomActive("kae") && P.phantomCdUntil === actTurn + PHANTOM.active + PHANTOM.cooldown;
    // Test 22b: save & reload DURING COOLDOWN
    G = JSON.parse(JSON.stringify(G));
    ensureSpaceState();
    P = G.countries[2];
    const cdAfterLoad = phantomStatus(2).cdLeft === PHANTOM.cooldown && activatePhantom(2, "kae") === false;
    G.turn = P.phantomCdUntil;
    const reAct = activatePhantom(2, "kae");
    log9("t12-cooldown-cycle=" + (offNow && cdAfterLoad && reAct === true) +
      " shutdown+25cd=" + offNow + " cd-survives-save-load=" + cdAfterLoad + " reactivates-after=" + reAct);
    delete G.space.systems.kae.phantom; P.phantomSys = null; P.phantomCdUntil = 0;

    // ============ §5/Tests 23-28 — Dead Sun ×0.20 in SANDBOX MODE ============
    G.sandbox = { freeCost: true, research: true }; // Sandbox must also support this
    const vex = systemDef("vex");
    G.space.planets.vex1.colony = { owner: 2, lvl: 3, garrison: [], b: { mine: 1 } };
    const vDef = planetDef("vex1"), vSt = G.space.planets.vex1;
    const pb = colonyProduction(vDef, vSt, P);
    const sdv = { id: 9903, owner: 2, unit: "stardestroyer", hp: 2500, maxHp: 2500, stack: 1, cargo: [],
      x: vex.x + 40, y: 0, z: vex.z + 40, target: null, chase: null, orbit: null, orbitAng: 0, cd: 0, novaCd: 0, harvestCd: 0 };
    G.space.ships.push(sdv);
    for (let i = 0; i < 3; i++) {
      sdv.harvestCd = 0;
      startStellarHarvest(sdv, "vex");
      tickStellarHarvests(STELLAR_HARVEST.time + 1);
    }
    const pa = colonyProduction(vDef, vSt, P);
    const sandbox20 = sunDead("vex") && sysLightState("vex") === "dead" &&
      near(pa.money, pb.money * DEAD_SUN.prodMult) && near(pa.mat, pb.mat * DEAD_SUN.prodMult) &&
      near(pa.energy, pb.energy * DEAD_SUN.prodMult) && near(pa.food, pb.food * DEAD_SUN.prodMult) &&
      pa.money > 0;
    log9("t13-sandbox-dead-sun-20pct=" + sandbox20 + " money " + Math.round(pb.money) + "→" + pa.money.toFixed(1) +
      " mat " + Math.round(pb.mat) + "→" + pa.mat.toFixed(1) + " (sandbox freeCost ON)");
    // alien colonies obey the same multiplier — their economy runs at 20%
    const rec2 = (G.space.aliens || []).find(a => !a.defeated && alienProductionWorld(a) &&
      !sunDead(planetSysId(planetDef(alienProductionWorld(a)))));
    if (rec2) {
      const A2 = G.countries[rec2.aid];
      const world = alienProductionWorld(rec2);
      const wSys = planetSysId(planetDef(world));
      const sysD = systemDef(wSys);
      const before1 = A2.res.money;
      alienEconTick(A2);
      const fullGain = A2.res.money - before1;
      const sdA = { id: 9904, owner: 2, unit: "stardestroyer", hp: 2500, maxHp: 2500, stack: 1, cargo: [],
        x: sysD.x + 40, y: 0, z: sysD.z + 40, target: null, chase: null, orbit: null, orbitAng: 0, cd: 0, novaCd: 0, harvestCd: 0 };
      G.space.ships.push(sdA);
      for (let i = 0; i < 3; i++) {
        sdA.harvestCd = 0;
        startStellarHarvest(sdA, wSys);
        tickStellarHarvests(STELLAR_HARVEST.time + 1);
      }
      const before2 = A2.res.money;
      alienEconTick(A2);
      const darkGain = A2.res.money - before2;
      const alien20 = sunDead(wSys) && near(darkGain, fullGain * DEAD_SUN.prodMult);
      log9("t14-alien-economy-at-20pct=" + alien20 + " gain " + fullGain + "→" + darkGain +
        " (system " + wSys + " dead=" + sunDead(wSys) + ")");
    } else log9("t14-alien-economy-at-20pct=SKIP (no living alien with a production world)");

    // ============ user-reported fix — atrocities never RAISE morale ============
    // Real combat kills still rally the killer's war morale; nukes, orbital
    // lasers and bombardments no longer credit "battle wins", and the nuclear
    // fallout now hits the ATTACKER'S own morale too.
    const foe9 = Object.keys(G.countries).map(Number).find(k => k !== 2 && G.countries[k].alive &&
      !G.countries[k].alien && !G.countries[k].rebel && !isSynthetic(G.countries[k]) && G.countries[k].provinces.length > 1);
    if (foe9) {
      const P2 = G.countries[2], F9 = G.countries[foe9];
      P2.warMorale = 50; P2.morale = 70;
      const a1 = spawnArmy(foe9, "spearman", 200, 200);
      const a2 = spawnArmy(foe9, "spearman", 210, 210);
      const combatCredit = (() => { if (!a1) return false; killArmy(a1, 2); return near(warMoraleOf(P2), 50 + WAR_MORALE.battleWin); })();
      const noGloryFlat = (() => { if (!a2) return false; const w = warMoraleOf(P2); killArmy(a2, 2, true); return warMoraleOf(P2) === w; })();
      const mBefore1 = P2.morale;
      nukeDiplomaticFallout(2, foe9);
      const falloutHurts = P2.morale === clamp(mBefore1 - 6, 0, 100);
      // end-to-end: a nuclear impact on the foe's soil — attacker war morale
      // stays flat (no per-kill rally) and attacker morale strictly FALLS
      const tp = F9.provinces.find(p2 => F9.provinces[F9.capital] !== p2) || F9.provinces[0];
      spawnArmy(foe9, "spearman", tp.px, tp.py);
      spawnArmy(foe9, "spearman", tp.px + 4, tp.py + 4);
      const wm2 = warMoraleOf(P2), m2 = P2.morale;
      missileImpact({ tx: tp.px, ty: tp.py, type: "nuke", owner: 2, done: false });
      const nukeNet = warMoraleOf(P2) === wm2 && P2.morale <= m2 - 6;
      log9("t16-atrocity-morale-fixed=" + (combatCredit && noGloryFlat && falloutHurts && nukeNet) +
        " combat-kill-still-rallies=" + combatCredit + " wmd-kill-no-rally=" + noGloryFlat +
        " nuke-lowers-own-morale=" + falloutHurts + " end-to-end-net-negative=" + nukeNet);
    } else log9("t16-atrocity-morale-fixed=SKIP (no suitable foe)");

    // ============ render smoke — moved homeland, dead systems, black hole ============
    let renderOK = true;
    try {
      spaceOpen = true;
      const vpEl = document.getElementById("space-vp");
      if (vpEl) vpEl.style.display = "block";
      const h2 = systemDef("home");
      spaceCam.zoom = 0.5; spaceCam.x = h2.x; spaceCam.z = h2.z;
      spaceRender();
      spaceCam.x = bh.x; spaceCam.z = bh.z;
      spaceRender();
      spaceCam.zoom = 0.05; spaceCam.x = 0; spaceCam.z = 0; // the galaxy view
      spaceRender();
      spaceOpen = false;
    } catch (e) { renderOK = false; out.push("render error: " + e.message + "\n" + e.stack); }
    log9("t15-render-smoke=" + renderOK + " (homeland off-centre, dead suns, black hole)");

    log9("DONE9");
    flush();
  }
})();
