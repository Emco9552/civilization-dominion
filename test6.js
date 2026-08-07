// Small Update + BUG REPORT (Final Fixes) test battery.
// Covers: no top-era victory, slower research, stellar harvesting (3/sun,
// dimming, collapse), the Omni-Hypercharged Orbital Laser Strike (system kill,
// area damage, nebula, meteor shower, homeland protection), the Rehabilitator
// ban, the minimal battle-view layout fix, and the colony-battle ownership /
// transport rules for alien attackers.
// Loaded by test6.html; run with headless Chrome (--dump-dom), results land in
// <pre id="test-out"> prefixed TEST6:
(function () {
  const out = [];
  function flush() {
    let el = document.getElementById("test-out");
    if (!el && document.body) { el = document.createElement("pre"); el.id = "test-out"; document.body.appendChild(el); }
    if (el) el.textContent = out.join("\n");
  }
  const log6 = (...a) => { const s = "TEST6: " + a.join(" "); out.push(s); console.log(s); flush(); };
  window.addEventListener("error", e => { out.push("TEST6 PAGE ERROR: " + e.message + " " + (e.filename || "") + ":" + e.lineno); flush(); });
  const boot = setInterval(() => {
    if (typeof ID_ARR === "undefined" || !ID_ARR) return;
    clearInterval(boot);
    try { run(); } catch (e) { out.push("TEST6 ERROR: " + e.message + "\n" + e.stack); flush(); }
  }, 200);
  const inLog = txt => G.log.some(l => (l.x || "").includes(txt));
  function run() {
    initGame("standard", 2);
    startGameUI();
    G.rtPaused = true; // deterministic: only OUR calls advance the simulation
    const P = G.countries[2];

    // ============ Small Update §10 + BUG REPORT — costs rise in EVERY era ============
    const mEng = TECH_BY_ID.megaeng, stoneT = TECH_BY_ID.stone_tools;
    const multsRise = TECH_ERA_COST_MULT.slice(2).every((m, i) => m > TECH_ERA_COST_MULT[i + 1]);
    log6("t2-tech-costs-raised=" + (typeof TECH_ERA_COST_MULT !== "undefined" &&
      stoneT.c >= 130 && mEng.c >= 200000 && TECH_ERA_COST_MULT[1] >= 4 && multsRise) +
      " stone=" + stoneT.c + " megaeng=" + mEng.c);

    // ============ Small Update §1+§12 — era ups are milestones, never endings ============
    for (const t of TECHS) if (t.e <= 6) P.researched[t.id] = true;
    const e7 = TECHS.filter(t => t.e === 7), e8 = TECHS.filter(t => t.e === 8);
    for (const t of e7) P.researched[t.id] = true;
    delete P.researched[e7[0].id];
    for (const t of e8) P.researched[t.id] = true;
    delete P.researched[e8[0].id];
    P.era = 7; bumpMods();
    finishResearch(P, e7[0].id); // 100% of era 7 → era 8 (75% rule)
    const era8ok = P.era === 8 && !G.victory && G.techMilestone === 2;
    finishResearch(P, e8[0].id); // → era 9
    const era9ok = P.era === 9 && !G.victory;
    log6("t1-no-tech-victory=" + (era8ok && era9ok) + " era=" + P.era +
      " victory=" + JSON.stringify(G.victory) + " milestone-logged=" + inLog("Technological Milestone"));
    for (const t of TECHS) P.researched[t.id] = true; // full tree for the space tests
    P.era = 9; bumpMods();

    // ============ Small Update §10 — the era research bonus is tamed ============
    const eraSave = P.era;
    P.era = 1; const r1 = production(P).research;
    P.era = 9; const r9 = production(P).research;
    P.era = eraSave;
    log6("t3-era-bonus-tamed=" + (r9 / r1 < 2.3 && r9 > r1) + " ratio=" + (r9 / r1).toFixed(2) + " (was 3.8x)");

    // ============ Small Update §3-4 — stellar harvesting ============
    P.res.money = 900000; P.res.mat = 900000; P.res.energy = 900000;
    ensureSpaceState();
    markSpaceReached(); // Alien War AI Fix §0: the battery simulates the first launch
    const aliens = G.space.aliens || [];
    const vex = systemDef("vex");
    const sd = { id: 9101, owner: 2, unit: "stardestroyer", hp: 2500, maxHp: 2500, stack: 1, cargo: [],
      x: vex.x + 40, y: 0, z: vex.z + 40, target: null, chase: null, orbit: null, orbitAng: 0, cd: 0, novaCd: 0 };
    G.space.ships.push(sd);

    // ============ the ☠ DOOM Device — era 9's hardest research gates the weapon ============
    const dd = TECH_BY_ID.doomdevice;
    const hardest = !!dd && TECHS.filter(t => t.e === 9 && t.id !== "doomdevice").every(t => t.c < dd.c);
    delete P.researched.doomdevice; bumpMods();
    const gated = canHarvestStar(sd, "vex").ok === false && canOmniStrike(sd, "vex").ok === false;
    P.researched.doomdevice = true; bumpMods();
    log6("t20-doom-device=" + (!!dd && dd.e === 9 && hardest && gated) +
      " cost=" + (dd ? dd.c : "?") + " hardest-in-era=" + hardest + " gates-weapon=" + gated);

    const h1 = startStellarHarvest(sd, "vex");
    const hMid = sd.harvest && sd.harvest.need === STELLAR_HARVEST.time;
    tickStellarHarvests(STELLAR_HARVEST.time / 2);
    const hHalf = sd.harvest && sd.harvest.prog > 0 && !sd.omniCharges; // takes time, clearly visible
    tickStellarHarvests(STELLAR_HARVEST.time);
    const sysVex = G.space.systems.vex;
    log6("t4-harvest-works=" + (h1 === true && hMid && hHalf && sd.omniCharges === 1 && sysVex.harvests === 1) +
      " charges=" + sd.omniCharges + " sun-dimmed=" + (sysVex.harvests === 1) +
      " remaining=" + sysHarvestsLeft("vex") + "/" + STELLAR_HARVEST.max);
    sd.harvestCd = 0; // Update §11 added a per-ship harvest cooldown — reset between test harvests
    startStellarHarvest(sd, "vex"); tickStellarHarvests(STELLAR_HARVEST.time + 1);
    const dim2 = sysVex.harvests === 2;
    sd.harvestCd = 0;
    startStellarHarvest(sd, "vex"); tickStellarHarvests(STELLAR_HARVEST.time + 1);
    log6("t5-three-harvests-collapse=" + (dim2 && sysVex.harvests === 3 && sysVex.dead === true &&
      sunDead("vex") && sd.omniCharges === 3 && sysHarvestsLeft("vex") === 0));
    const h4 = startStellarHarvest(sd, "vex");
    log6("t6-spent-sun-never-recovers=" + (h4 === false && canHarvestStar(sd, "vex").ok === false));

    // ============ Small Update §2+§5+§6+§9 — the Omni Laser ============
    // dress the zer system: an AI colony, a doomed fleet inside, ours outside
    const zer = systemDef("zer");
    G.space.systems.zer.revealed = true;
    G.space.planets.zer1.colony = { owner: 5, lvl: 2, garrison: [] };
    const victimIn = { id: 9102, owner: 5, unit: "starfleet", hp: 600, maxHp: 600, stack: 1, cargo: [],
      x: zer.x + 60, y: 0, z: zer.z + 60, target: null, chase: null, orbit: null, orbitAng: 0, cd: 0 };
    G.space.ships.push(victimIn);
    const wasWar = atWar(2, 5);
    sd.omniCd = 0;
    const noChargeBlock = (() => { const save = sd.omniCharges; sd.omniCharges = 0; const r = canOmniStrike(sd, "zer").ok; sd.omniCharges = save; return r === false; })();
    const fired = omniStrike(sd, "zer");
    const zSt = G.space.systems.zer;
    const allZerDead = SPACE_PLANETS.filter(d => planetSysId(d) === "zer").every(d => G.space.planets[d.id].destroyed);
    log6("t7-omni-destroys-system=" + (fired === true && allZerDead && zSt.nova === true && zSt.dead === true &&
      !!zSt.nebula && G.space.planets.zer1.colony === null) +
      " planets-gone=" + allZerDead + " nebula=" + !!zSt.nebula);
    log6("t8-omni-costs-and-balance=" + (noChargeBlock && sd.omniCharges === 2 && sd.omniCd === OMNI_LASER.cd &&
      !wasWar && atWar(2, 5)) + " charges-left=" + sd.omniCharges + " cd=" + sd.omniCd + " war-declared=" + atWar(2, 5));
    log6("t9-area-damage=" + (G.space.ships.indexOf(victimIn) === -1) + " (fleet inside the system vaporised)");
    const rehabBlocked = startRehab(2, "zer1", true);
    log6("t10-nebula-blocks-rebuild=" + (rehabBlocked === false && canOmniStrike(sd, "zer").ok === false) +
      " (Rehabilitator refused, cannot re-target a destroyed system)");

    // ============ Small Update §8 — the meteor shower ============
    const meteorStarted = !!G.space.meteor && inLog("released massive debris fields");
    G.space.planets.kae1.colony = { owner: 5, lvl: 1, garrison: [{ unit: "spearman", hp: 18, maxHp: 18 }], b: { mine: 1 } };
    G.countries[1].provinces[0].b = { farm: 2 }; // the homeland strike needs something to flatten
    const realRandom = Math.random;
    Math.random = () => 0.001; // every roll strikes → damage paths all fire
    tickMeteorShower(); tickMeteorShower();
    Math.random = () => 0.99;  // no more strikes → drain the event quietly
    let guard = 0;
    while (G.space.meteor && guard++ < 60) tickMeteorShower();
    Math.random = realRandom;
    log6("t11-meteor-shower=" + (meteorStarted && inLog("A meteor slams into") &&
      inLog("Meteorites batter the colony") && !G.space.meteor && inLog("meteor shower has ended")) +
      " started=" + meteorStarted + " ended=" + !G.space.meteor);

    // ============ BUG REPORT §4-§6 — aliens invade colonies via real transports ============
    const rec = aliens.find(a => !a.defeated);
    if (rec) {
      declareWar(rec.aid, 2, true);
      const rubPos = planetPos("rubra"); // planets orbit — position ships NOW
      G.space.planets.rubra.colony = { owner: 2, lvl: 2,
        garrison: [{ unit: "spearman", hp: 18, maxHp: 18 }, { unit: "spearman", hp: 18, maxHp: 18 }] };
      const gu = alienUnitOf(rec.tier);
      const inv = { id: 9103, owner: rec.aid, unit: "cargoship", hp: 320, maxHp: 320, stack: 1,
        cargo: [1, 2, 3].map(() => ({ unit: gu, hp: unitMaxHp(gu), maxHp: unitMaxHp(gu) })),
        x: rubPos.x + 5, y: 0, z: rubPos.z + 5, target: null, chase: null, orbit: null, orbitAng: 0, cd: 0 };
      G.space.ships.push(inv);
      const went = resolveInvasion(inv, "rubra");
      const b = battleOn("rubra");
      const turretsOk = b && b.units.filter(u => u.turret).length === 2 && b.units.filter(u => u.turret).every(u => u.side === 1);
      const defOk = b && b.units.filter(u => u.side === 1 && !u.turret).length === 2;
      const attOk = b && b.units.filter(u => u.side === 0).length === 3 && inv.cargo.length === 0;
      log6("t12-alien-invasion-roles=" + (went === true && !!b && b.att === rec.aid && b.def === 2 &&
        turretsOk && defOk && attOk) +
        " attacker=" + (b ? b.att : "?") + " defender=" + (b ? b.def : "?") +
        " player-turrets-on-player-side=" + turretsOk + " cargo-emptied=" + (inv.cargo.length === 0));

      // §1 — the minimal battle view has ONE deterministic size
      pbRender();
      const el = document.getElementById("pbattle");
      const cvEl = document.getElementById("pb-cv");
      const h1v = el.offsetHeight, w1v = el.offsetWidth;
      pbRender(); pbRender(); pbRender(); pbRender();
      const h2v = el.offsetHeight;
      const ar = cvEl.width / Math.max(1, cvEl.height);
      pbUI.mode = "full"; pbRender();
      const hFull = el.offsetHeight;
      pbUI.mode = "min"; pbRender();
      const h3v = el.offsetHeight;
      pbUI.open = null; pbRender();
      const closed = el.style.display === "none";
      pbUI.open = b.id; pbRender();
      const h4v = el.offsetHeight;
      log6("t13-minimal-view-fixed=" + (h1v > 80 && h1v === h2v && h3v === h1v && h4v === h1v &&
        h1v <= Math.min(window.innerHeight * 0.72, 460) + 2 && hFull > h1v && closed &&
        Math.abs(ar - 320 / 180) < 0.15) +
        " h=" + h1v + "x" + w1v + " after5renders=" + h2v + " toggled=" + h3v + " reopened=" + h4v +
        " full=" + hFull + " canvas-aspect=" + ar.toFixed(2));

      // §7 — defender reinforcements arrive from a real transport
      const rubNow = planetPos("rubra");
      const boat = { id: 9104, owner: 2, unit: "cargoship", hp: 320, maxHp: 320, stack: 1,
        cargo: [{ unit: "spearman", hp: 18, maxHp: 18 }],
        x: rubNow.x + 8, y: 0, z: rubNow.z + 8, target: null, chase: null, orbit: null, orbitAng: 0, cd: 0 };
      G.space.ships.push(boat);
      for (let i = 0; i < 4 && boat.cargo.length; i++) tickPlanetBattles(0.25);
      const reinforced = boat.cargo.length === 0 && b.units.filter(u => u.side === 1 && !u.turret).length === 3;
      log6("t14-transport-reinforcements=" + reinforced + " boat-emptied=" + (boat.cargo.length === 0));

      // §8 — the battle ends, and ownership + production follow the winner
      let ticks = 0;
      while (!b.done && ticks++ < 6000) tickPlanetBattles(0.25);
      const owner = G.space.planets.rubra.colony ? G.space.planets.rubra.colony.owner : null;
      const ownRight = b.winner === b.att ? owner === rec.aid : owner === 2;
      const prodRight = b.winner === b.att
        ? coloniesOfNation(rec.aid).some(c2 => c2.def.id === "rubra") && !coloniesOfNation(2).some(c2 => c2.def.id === "rubra")
        : coloniesOfNation(2).some(c2 => c2.def.id === "rubra");
      log6("t15-battle-resolves=" + (b.done === 1 && ownRight && prodRight) +
        " winner=" + (b.winner === b.att ? "attacker" : "defender") + " in-ticks=" + ticks +
        " owner=" + owner + " production-follows-owner=" + prodRight);

      // Final Fixes — orbital raids can no longer flip a colony (no landing = no capture)
      G.space.planets.glaci.colony = { owner: 2, lvl: 1, garrison: [] };
      for (const s2 of G.space.ships) if (s2.owner === rec.aid && s2.id !== 9103) { s2.landing = null; s2.colInv = null; }
      for (let i = 0; i < 10; i++) alienTick();
      log6("t16-raids-cannot-capture=" + (G.space.planets.glaci.colony.owner === 2) +
        " owner-still=" + G.space.planets.glaci.colony.owner);

      // Final Fixes — a stalled battle breaks off instead of raging forever
      const glaPos = planetPos("glaci");
      const inv2 = { id: 9105, owner: rec.aid, unit: "cargoship", hp: 320, maxHp: 320, stack: 1,
        cargo: [{ unit: gu, hp: unitMaxHp(gu), maxHp: unitMaxHp(gu) }],
        x: glaPos.x + 5, y: 0, z: glaPos.z + 5, target: null, chase: null, orbit: null, orbitAng: 0, cd: 0 };
      G.space.ships.push(inv2);
      resolveInvasion(inv2, "glaci");
      const b2 = battleOn("glaci");
      if (b2) {
        b2.t = 601;
        tickPlanetBattles(0.25);
        const retreatCalled = b2.ret === 1;
        let t2 = 0;
        while (!b2.done && t2++ < 4000) tickPlanetBattles(0.25);
        log6("t17-no-forever-battles=" + (retreatCalled && b2.done === 1 && G.space.planets.glaci.colony.owner === 2) +
          " auto-retreat=" + retreatCalled + " ended=" + (b2.done === 1));
      } else log6("t17-no-forever-battles=SKIP (battle did not start)");
    } else log6("t12-t17=SKIP (no aliens this galaxy)");

    // ============ Small Update §5 — the Homeworld keeps its protection ============
    sd.omniCd = 0;
    P.res.money = 900000; P.res.mat = 900000; P.res.energy = 900000;
    const firedHome = omniStrike(sd, "home");
    const homeSt = G.space.planets.home;
    const others = SPACE_PLANETS.filter(d => planetSysId(d) === "home" && d.type !== "main");
    log6("t18-homeland-protected=" + (firedHome === true && homeSt.scorched === true && !homeSt.destroyed &&
      others.every(d => G.space.planets[d.id].destroyed) && G.space.systems.home.nova === true) +
      " scorched-not-destroyed=" + (homeSt.scorched && !homeSt.destroyed));
    log6("t19-game-continues=" + (!G.victory && !G.defeated) + " victory=" + JSON.stringify(G.victory));

    log6("DONE6");
    flush();
  }
})();
