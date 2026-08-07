// Alien War AI Fix test battery (New Bugs.txt §0-§13).
// Covers: alien-free universe before the space milestone, quiet generation on
// the first launch, war declaration, real validated fleet objectives,
// retargeting when a target dies, the home defence reserve, loaded-cargo
// invasions (no conjured troops), cargo-loss = no landing, colony (not only
// homeland) invasions, capture + captured production, normal fleets over
// Star Destroyer abilities, SD reserved for justified targets, capturable
// colonies never erased, the Omni strike as a last resort, and §11 retreat.
// Loaded by test14.html; run with headless Chrome (--dump-dom), results land
// in <pre id="test-out"> prefixed TEST14:
(function () {
  const out = [];
  function flush() {
    let el = document.getElementById("test-out");
    if (!el && document.body) { el = document.createElement("pre"); el.id = "test-out"; document.body.appendChild(el); }
    if (el) el.textContent = out.join("\n");
  }
  const log14 = (...a) => { const s = "TEST14: " + a.join(" "); out.push(s); console.log(s); flush(); };
  window.addEventListener("error", e => { out.push("TEST14 PAGE ERROR: " + e.message + " " + (e.filename || "") + ":" + e.lineno); flush(); });
  const boot = setInterval(() => {
    if (typeof ID_ARR === "undefined" || !ID_ARR) return;
    clearInterval(boot);
    try { run(); } catch (e) { out.push("TEST14 ERROR: " + e.message + "\n" + e.stack); flush(); }
  }, 200);
  function run() {
    initGame("standard", 2);
    startGameUI();
    G.rtPaused = true; // deterministic: only OUR calls advance the simulation
    ensureSpaceState(); // deliberately NO markSpaceReached — §0 is under test
    const realRnd = Math.random;
    const mkGar = (u, n) => Array.from({ length: n }, () => ({ unit: u, hp: unitMaxHp(u), maxHp: unitMaxHp(u) }));
    const mkShip = (owner, unit, x, z, extra) => {
      const sh = Object.assign({ id: G.space.shipSeq++, owner, unit: unit || "starfleet",
        hp: unitMaxHp(unit || "starfleet"), maxHp: unitMaxHp(unit || "starfleet"), stack: 1, cargo: [],
        x, y: 0, z, target: null, chase: null, orbit: null, orbitAng: 0, cd: 99 }, extra || {});
      G.space.ships.push(sh);
      return sh;
    };
    const tpTo = (s, pid) => { const p = planetPos(pid); s.x = p.x + 8; s.y = p.y; s.z = p.z; s.orbit = null; s.free = null; };
    const alienSysAll = () => { const set = new Set(); for (const a of (G.space.aliens || [])) for (const sy of alienAssetSystems(a)) set.add(sy); return set; };
    const freeP = () => { const held = alienSysAll(); return SPACE_PLANETS.filter(d => d.type !== "main" &&
      G.space.planets[d.id] && !G.space.planets[d.id].destroyed && !G.space.planets[d.id].colony &&
      !sunDead(planetSysId(d)) && !held.has(planetSysId(d))); };

    // ---- t1 (§0.2): the universe is completely alien-free before space ----
    for (let i = 0; i < 3; i++) spaceTurnTick();
    const noAliens = G.space.aliens === undefined && !spaceReached() &&
      !Object.keys(G.countries).some(k => G.countries[k].alien) &&
      !G.space.ships.length && !G.wars.length;
    log14("t1-no-aliens-before-space=" + noAliens + " reached=" + spaceReached());

    // ---- t2 (§0.1/§0.3): the FIRST craft aloft births the aliens, quietly ----
    const prov0 = provsOfNation(2)[0].p;
    const spot0 = (typeof findLandNear === "function" && findLandNear(prov0.px + 12, prov0.py + 12, 90)) || { x: prov0.px, y: prov0.py };
    const army0 = spawnArmy(2, "cargoship", spot0.x, spot0.y);
    const ship0 = army0 ? launchArmyToSpace(army0) : null;
    const aliens = (G.space.aliens || []).filter(a => !a.defeated);
    const quiet = aliens.every(a => a.contacted.length === 0) &&
      SPACE_SYSTEMS.every(sy => sy.id === "home" || !systemRevealed(sy.id));
    log14("t2-aliens-spawn-on-first-launch=" + (!!ship0 && spaceReached() && aliens.length >= 6 &&
      aliens.every(a => !!NATIONS[a.aid] && G.countries[a.aid] && G.countries[a.aid].alive) && quiet) +
      " civs=" + aliens.length + " unrevealed=" + quiet);
    if (!aliens.length) { log14("DONE14"); flush(); return; }

    // ---- t3 (§13.3): declare war on an alien civilization ----
    const recA = aliens.find(a => a.tier >= 2 && a.tier <= 3 && ALIEN_TIERS[a.tier].ships >= 3) ||
      aliens.find(a => ALIEN_TIERS[a.tier].ships >= 3) || aliens[0];
    recA.invadeCd = 999; // keep homeland landings out of the colony-op tests
    declareWar(2, recA.aid, true);
    log14("t3-declare-war-on-alien=" + atWar(2, recA.aid) + " tier=" + recA.tier + " per=" + recA.per);
    const fleetA = () => G.space.ships.filter(s => s.owner === recA.aid);

    // ---- t4 (§1): every ship holds a REAL, validated objective ----
    const pid1 = freeP()[0].id;
    G.space.planets[pid1].colony = { owner: 2, lvl: 2, garrison: mkGar("cyberops", 2) };
    for (let i = 0; i < 6; i++) alienTick();
    const foesOfA = [2];
    const validSpot = s => {
      const spot = s.orbit || s.target;
      if (!spot) return true; // chasing / escorting / free-moving / idle
      if (spot === "home") return (G.armies || []).some(a => a.owner === recA.aid) ||
        fleetA().some(t => t.landing !== undefined && t.landing !== null) ||
        G.space.ships.some(t => foesOfA.includes(t.owner) && shipNearPlanet(t, "home"));
      const st = G.space.planets[spot];
      return !!(st && !st.destroyed && st.colony && (st.colony.owner === recA.aid || foesOfA.includes(st.colony.owner)));
    };
    log14("t4-real-targets-only=" + fleetA().every(validSpot) + " fleet=" + fleetA().length);

    // ---- t5 (§13.5): the target dies -> the fleet re-tasks the same turn ----
    G.space.planets[pid1].colony = null; // the colony is gone
    alienTick();
    const noStale = fleetA().every(s => s.orbit !== pid1 && s.target !== pid1 && s.colInv !== pid1) &&
      fleetA().every(validSpot);
    log14("t5-retarget-when-target-gone=" + noStale);

    // ---- t6 (§2): a defence reserve guards the dominion's own worlds ----
    const guardsA = fleetA().filter(s => s.guard);
    const guardsValid = guardsA.length >= 1 && guardsA.every(s => {
      const st = G.space.planets[s.guard];
      return st && st.colony && st.colony.owner === recA.aid;
    });
    log14("t6-home-defence-reserve=" + guardsValid + " guards=" + guardsA.length);

    // ---- t7 (§3/§4/§9): a real invasion = loaded cargo craft + escort ----
    for (const s of fleetA()) { s.landing = null; s.loadFrom = null; s.colInv = null; s.cargo = []; s.invWait = 0; }
    const srcCol = SPACE_PLANETS.find(d => { const st = G.space.planets[d.id]; return st && st.colony && st.colony.owner === recA.aid; });
    const guA = alienUnitOf(recA.tier);
    G.space.planets[srcCol.id].colony.garrison = mkGar(guA, 4);
    const pid2 = freeP()[0].id;
    G.space.planets[pid2].colony = { owner: 2, lvl: 3, garrison: mkGar("cyberops", 1) };
    recA.colCd = 0; recA.posture = null;
    alienTick();
    const carrier = fleetA().find(s => s.colInv === pid2);
    const carrierIsCargo = !!carrier && (UNITS[carrier.unit].cap || 0) > 0;
    const escorts0 = carrier ? fleetA().filter(s => s.escortOf === carrier.id).length : 0;
    if (carrier && carrier.loadFrom) { tpTo(carrier, carrier.loadFrom); alienTick(); }
    const loaded = carrier ? (carrier.cargo || []).length : 0;
    if (carrier) { tpTo(carrier, pid2); alienTick(); }
    const b7 = battleOn(pid2);
    const attUnits = b7 ? b7.units.filter(u => u.side === 0).length : 0;
    log14("t7-loaded-cargo-invasion=" + (carrierIsCargo && loaded >= 1 && !!b7 && b7.att === recA.aid &&
      attUnits === loaded && (carrier.cargo || []).length === 0 && escorts0 >= 1) +
      " loaded=" + loaded + " battle-att-units=" + attUnits + " escorts=" + escorts0);

    // ---- t9 (§5): the colonies get invaded, not only the homeland ----
    log14("t9-colonies-invaded-not-only-homeland=" + (!!b7 && (G.armies || []).every(a => a.owner !== recA.aid)));

    // ---- t8 (§13.8): cargo destroyed -> no troops ever appear ----
    G.space.battles = [];
    G.space.planets[pid2].colony = { owner: 2, lvl: 3, garrison: mkGar("cyberops", 1) };
    G.space.planets[srcCol.id].colony.garrison = mkGar(guA, 4);
    for (const s of fleetA()) { s.landing = null; s.loadFrom = null; s.colInv = null; s.cargo = []; s.invWait = 0; }
    recA.colCd = 0;
    alienTick();
    const carrier2 = fleetA().find(s => s.colInv === pid2);
    if (carrier2 && carrier2.loadFrom) { tpTo(carrier2, carrier2.loadFrom); alienTick(); }
    const hadTroops = carrier2 ? (carrier2.cargo || []).length : 0;
    if (carrier2) removeShip(carrier2); // shot down mid-crossing
    alienTick(); alienTick();
    const st2b = G.space.planets[pid2];
    log14("t8-no-cargo-no-troops=" + (hadTroops >= 1 && !battleOn(pid2) && st2b.colony && st2b.colony.owner === 2 &&
      st2b.colony.garrison.length === 1) + " troops-lost-with-ship=" + hadTroops);

    // ---- t10 (§6): valuable colonies are CAPTURED and kept ----
    const aiFoe = Number(Object.keys(G.countries).find(k => Number(k) !== 2 && !isSynthetic(G.countries[k]) && G.countries[k].alive));
    declareWar(recA.aid, aiFoe, true);
    const pid3 = freeP()[0].id;
    G.space.planets[pid3].colony = { owner: aiFoe, lvl: 3, garrison: mkGar("spearman", 1) };
    const carrier3 = fleetA().find(s => (UNITS[s.unit].cap || 0) > 0) || mkShip(recA.aid, "cargoship", 0, 0);
    carrier3.cargo = mkGar(guA, 3); carrier3.colInv = pid3; carrier3.loadFrom = null; carrier3.landing = null;
    tpTo(carrier3, pid3);
    alienTick();
    const st3 = G.space.planets[pid3];
    const captured = st3.colony && st3.colony.owner === recA.aid && st3.colony.garrison.length > 0;
    log14("t10-capture-not-destroy=" + (captured && !st3.destroyed) +
      " garrison-kept=" + (st3.colony ? st3.colony.garrison.length : 0));

    // ---- t11: a captured colony produces for its new masters ----
    const cA = G.countries[recA.aid];
    const moneyBefore = cA.res.money;
    alienEconTick(cA);
    log14("t11-captured-colony-produces=" + (captured && cA.res.money > moneyBefore &&
      alienAssetSystems(recA).has(planetSysId(planetDef(pid3)))));

    // ---- t12 (§7): fresh war, weak colony -> fleets fight, the SD holds fire ----
    const recSD = aliens.find(a => a.tier >= 4 && G.space.ships.some(s => s.owner === a.aid && s.unit === "stardestroyer"));
    if (!recSD) {
      log14("t12-normal-fleets-first=SKIP (no hyper-advanced civilization rolled)");
      log14("t13-sd-justified-targets=SKIP"); log14("t14-capturable-never-erased=SKIP"); log14("t15-omni-exceptional=SKIP");
    } else {
      recSD.invadeCd = 999; recSD.grudge = {};
      declareWar(2, recSD.aid, true);
      const pid4 = freeP()[0].id;
      G.space.planets[pid4].colony = { owner: 2, lvl: 2, garrison: mkGar("cyberops", 1) };
      const fleetSD = () => G.space.ships.filter(s => s.owner === recSD.aid);
      let sawFleetAction = false;
      for (let i = 0; i < 25; i++) {
        alienTick();
        if (fleetSD().some(s => s.colInv || s.target === pid4 || s.orbit === pid4)) sawFleetAction = true;
      }
      const st4 = G.space.planets[pid4];
      log14("t12-normal-fleets-first=" + (!st4.destroyed && sawFleetAction) +
        " colony-alive=" + !st4.destroyed + " fleet-action=" + sawFleetAction);

      // ---- t13 (§8): with real cause, the SD erases a hardened target ----
      const sd = fleetSD().find(s => s.unit === "stardestroyer");
      const cSD = G.countries[recSD.aid];
      cSD.res.money = 9000000; cSD.res.mat = 9000000; cSD.res.energy = 9000000;
      const pid5 = freeP()[0].id;
      G.space.planets[pid5].colony = { owner: 2, lvl: 3, garrison: mkGar("orbmarines", 7) };
      recSD.grudge[2] = 4; recSD.sdCd = 0; recSD.invFail = {}; recSD.invFail[pid5] = 3;
      sd.novaCd = 0; sd.harvestCd = 99; sd.omniCharges = 0;
      for (const s of fleetSD()) { s.colInv = null; s.landing = null; s.loadFrom = null; }
      tpTo(sd, pid5);
      const targetsFor = aid => SPACE_PLANETS.filter(d => {
        const st = G.space.planets[d.id];
        return st && st.colony && atWar(aid, st.colony.owner) && !st.destroyed &&
          !phantomHiddenFrom(planetSysId(d), aid) && !voidShieldBlocks(planetSysId(d), aid);
      });
      Math.random = () => 0.001; // force every roll — the FILTERS are under test
      alienSDWar(recSD, cSD, sd, fleetSD(), [2], targetsFor(recSD.aid), []);
      Math.random = realRnd;
      log14("t13-sd-justified-targets=" + (G.space.planets[pid5].destroyed === true) +
        " invFail-cause-fired=" + G.space.planets[pid5].destroyed);

      // ---- t14 (§8): a weak, capturable colony is NEVER erased ----
      const pid6 = freeP()[0].id;
      G.space.planets[pid6].colony = { owner: 2, lvl: 1, garrison: mkGar("spearman", 1) };
      recSD.sdCd = 0; recSD.invFail = {}; sd.novaCd = 0;
      Math.random = () => 0.001;
      for (let i = 0; i < 40; i++) alienSDWar(recSD, cSD, sd, fleetSD(), [2], targetsFor(recSD.aid), []);
      Math.random = realRnd;
      log14("t14-capturable-never-erased=" + (G.space.planets[pid6].destroyed !== true));

      // ---- t15 (§8): the Omni strike fires only in exceptional situations ----
      const bySysFree = {};
      for (const d of freeP()) (bySysFree[planetSysId(d)] = bySysFree[planetSysId(d)] || []).push(d);
      const sdHomeSys = systemDef(recSD.sys);
      const sysX = Object.keys(bySysFree).find(k => k !== "home" && bySysFree[k].length >= 2 &&
        Math.hypot(systemDef(k).x - sdHomeSys.x, systemDef(k).z - sdHomeSys.z) > 3000);
      if (!sysX) log14("t15-omni-exceptional=SKIP (no far twin-planet system free)");
      else {
        const [p7, p8] = bySysFree[sysX];
        G.space.planets[p7.id].colony = { owner: 2, lvl: 1, garrison: [] };
        G.space.planets[p8.id].colony = { owner: 2, lvl: 1, garrison: [] };
        sd.omniCharges = 1; sd.omniCd = 0; sd.harvestCd = 99;
        recSD.grudge[2] = 3; // major war, but NOT "wronged" — the gate must hold
        Math.random = () => 0.001;
        for (let i = 0; i < 30; i++) alienSDWar(recSD, cSD, sd, fleetSD(), [2], targetsFor(recSD.aid), []);
        const held = sd.omniCharges === 1 && !sysState(sysX).nova;
        recSD.grudge[2] = 5; // now deeply wronged — the strike is justified
        for (let i = 0; i < 30 && (sd.omniCharges || 0) > 0; i++) alienSDWar(recSD, cSD, sd, fleetSD(), [2], targetsFor(recSD.aid), []);
        Math.random = realRnd;
        const fired = sd.omniCharges === 0 && !!sysState(sysX).nova;
        log14("t15-omni-exceptional=" + (held && fired) + " held-until-wronged=" + held + " fired-when-wronged=" + fired);
      }
    }

    // ---- t16 (§11): an invasion that cannot land turns back with its troops ----
    let carrier4 = fleetA().find(s => (UNITS[s.unit].cap || 0) > 0);
    if (!carrier4) carrier4 = mkShip(recA.aid, "cargoship", 0, 0);
    const pid9 = freeP()[0].id;
    G.space.planets[pid9].colony = { owner: 2, lvl: 2, garrison: mkGar("cyberops", 2) };
    const guardUnit = (UNITS.starfleet.atk || 0) >= 60 ? "starfleet" : "stardestroyer";
    const p9 = planetPos(pid9);
    mkShip(2, guardUnit, p9.x + 15, p9.z + 15); // the orbit is HELD against them
    carrier4.cargo = mkGar(guA, 2); carrier4.colInv = pid9; carrier4.loadFrom = null; carrier4.landing = null; carrier4.invWait = 0;
    recA.colCd = 999;
    tpTo(carrier4, pid9);
    for (let i = 0; i < 7; i++) alienTick();
    const retreated = carrier4.colInv === null && (carrier4.cargo || []).length === 2 && !!carrier4.target &&
      (() => { const st = G.space.planets[carrier4.target]; return st && st.colony && st.colony.owner === recA.aid; })() &&
      !battleOn(pid9) && G.space.planets[pid9].colony.owner === 2;
    log14("t16-retreat-when-blocked=" + retreated + " kept-troops=" + (carrier4.cargo || []).length);

    log14("DONE14");
    flush();
  }
})();
