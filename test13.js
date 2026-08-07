// AI Update + Sandbox Improvement test battery.
// Covers: sandbox real-time ticking & speeds, Unlock All Eras and Technologies,
// Skip/Disable Cooldowns, event control (off / auto-resolve), galaxy reveal
// (whole + single system), Add Alien Civilization, instant destruction,
// civilization inspection, Force War (nation & alien pairs, intensity,
// no-peace), Attack Mainland, Void Shields (build, alien block, movement,
// siege), alien standing war orders, alien-vs-alien contact, needs-based AI
// city development, obsolete-building replacement, AI missiles, innate alien
// superweapon access and fleet multi-select.
// Loaded by test13.html; run with headless Chrome (--dump-dom), results land in
// <pre id="test-out"> prefixed TEST13:
(function () {
  const out = [];
  function flush() {
    let el = document.getElementById("test-out");
    if (!el && document.body) { el = document.createElement("pre"); el.id = "test-out"; document.body.appendChild(el); }
    if (el) el.textContent = out.join("\n");
  }
  const log13 = (...a) => { const s = "TEST13: " + a.join(" "); out.push(s); console.log(s); flush(); };
  window.addEventListener("error", e => { out.push("TEST13 PAGE ERROR: " + e.message + " " + (e.filename || "") + ":" + e.lineno); flush(); });
  const boot = setInterval(() => {
    if (typeof ID_ARR === "undefined" || !ID_ARR) return;
    clearInterval(boot);
    try { run(); } catch (e) { out.push("TEST13 ERROR: " + e.message + "\n" + e.stack); flush(); }
  }, 200);
  const inLog = txt => G.log.some(l => (l.x || "").includes(txt));
  function run() {
    initGame("sandbox", 2);
    startGameUI();
    G.rtPaused = true; // deterministic: only OUR calls advance the simulation
    G.sandbox.noEvents = 1; // no random event modals mid-battery (re-enabled for t6)
    ensureSpaceState();
    markSpaceReached(); // Alien War AI Fix §0: the battery simulates the first launch
    const P = G.countries[2];

    // ---- t1: Sandbox is real-time — no manual turns, 3s default tick ----
    log13("t1-sandbox-realtime=" + (isRealtime() === true && realtimeTickSeconds() === 3 && G.sandbox.tickS === 3));

    // ---- t2: every speed from 3s down to 0.25s works ----
    const speedOk = [3, 1, 0.5, 0.25].every(s => { G.sandbox.tickS = s; return realtimeTickSeconds() === s; });
    G.sandbox.tickS = 3;
    log13("t2-speed-control=" + (speedOk && SANDBOX_SPEEDS.length === 4));

    // ---- t3: Unlock All Eras AND Technologies ----
    sandboxUnlockAll(2);
    if (typeof closeModal === "function") closeModal(); // dismiss the era celebration
    const allTechs = TECHS.every(t => P.researched[t.id]);
    log13("t3-unlock-all=" + (allTechs && P.era === ERAS.length - 1 &&
      unitAvailable(P, "stardestroyer") && missileAvailable(P, "nuke") && bldgAvailable(P, "spaceprogram") &&
      P.researched.warp === true && P.researched.dysonsphere === true) +
      " techs=" + Object.keys(P.researched).length + "/" + TECHS.length + " era=" + P.era);

    // ---- t4: Skip Cooldowns resets every player cooldown ----
    const hp0 = planetPos("home");
    const mkShip = (owner, unit, x, z, extra) => {
      const sh = Object.assign({ id: G.space.shipSeq++, owner, unit: unit || "starfleet",
        hp: unitMaxHp(unit || "starfleet"), maxHp: unitMaxHp(unit || "starfleet"), stack: 1, cargo: [],
        x, y: 0, z, target: null, chase: null, orbit: null, orbitAng: 0, cd: 99 }, extra || {});
      G.space.ships.push(sh);
      return sh;
    };
    const cdShip = mkShip(2, "stardestroyer", hp0.x + 60, hp0.z + 60, { novaCd: 9, hlCd: 7, omniCd: 5, harvestCd: 4 });
    P.capitalCd = 11; P.phantomCdUntil = G.turn + 20;
    const nCd = sandboxSkipCooldowns(2);
    log13("t4-skip-cooldowns=" + (nCd >= 5 && cdShip.novaCd === 0 && cdShip.hlCd === 0 && cdShip.omniCd === 0 &&
      cdShip.harvestCd === 0 && P.capitalCd === 0 && (P.phantomCdUntil || 0) <= G.turn) + " reset=" + nCd);

    // ---- t5: Disable Cooldowns keeps abilities ready (swept every frame) ----
    G.sandbox.noCd = 1;
    cdShip.novaCd = 6; cdShip.omniCd = 6;
    spaceTick(0.05);
    log13("t5-disable-cooldowns=" + (cdShip.novaCd === 0 && cdShip.omniCd === 0));
    G.sandbox.noCd = 0;

    // ---- t6: event control — Events off = silence; Auto-Resolve = no pop-up ----
    G.sandbox.noEvents = 1;
    let evNone = true;
    for (let i = 0; i < 300; i++) if (rollEvent() !== null) { evNone = false; break; }
    G.sandbox.noEvents = 0;
    let evSome = false;
    for (let i = 0; i < 800; i++) if (rollEvent() !== null) { evSome = true; break; }
    G.sandbox.noEvents = 1;
    G.sandbox.autoEvents = 1;
    G.eventPending = { ev: EVENTS[0], provName: "Testville", otherId: 4, text: "test event" };
    showEvent();
    const modalShown = document.getElementById("modal").style.display === "flex";
    log13("t6-event-control=" + (evNone && evSome && G.eventPending === null && !modalShown && inLog("Event: Rich Ore Vein")) +
      " off-silent=" + evNone + " on-fires=" + evSome + " auto-no-popup=" + !modalShown);
    G.sandbox.autoEvents = 0;

    // ---- t8: reveal ONE selected solar system ----
    const hidden = SPACE_SYSTEMS.filter(sy => sy.id !== "home" && !systemRevealed(sy.id));
    if (hidden.length >= 2) {
      revealSystem(hidden[0].id);
      log13("t8-reveal-one=" + (systemRevealed(hidden[0].id) === true && systemRevealed(hidden[1].id) === false));
    } else log13("t8-reveal-one=SKIP (galaxy rolled too few hidden systems)");

    // ---- t7: Reveal All Solar Systems + Known Civilizations registration ----
    sandboxRevealAll();
    const allRevealed = SPACE_SYSTEMS.every(sy => systemRevealed(sy.id));
    const startAliens = (G.space.aliens || []).filter(a => !a.defeated && G.countries[a.aid] && G.countries[a.aid].alive);
    const allKnown = startAliens.every(a => a.contacted.includes(2));
    log13("t7-reveal-all=" + (allRevealed && allKnown) + " systems=" + SPACE_SYSTEMS.length +
      " known=" + startAliens.filter(a => a.contacted.includes(2)).length + "/" + startAliens.length);

    // ---- t9: Add Alien Civilization on a chosen planet ----
    const freeAway = SPACE_PLANETS.filter(d => d.type !== "main" && planetSysId(d) !== "home" &&
      G.space.planets[d.id] && !G.space.planets[d.id].destroyed && !G.space.planets[d.id].colony &&
      !sunDead(planetSysId(d)));
    let rec9 = null, rec24 = null;
    if (freeAway.length >= 2) {
      const r1 = sandboxAddAlien(freeAway[0].id, 3);
      rec9 = r1.ok ? alienById(r1.aid) : null;
      const c9 = rec9 ? G.countries[rec9.aid] : null;
      log13("t9-add-alien=" + (!!rec9 && !!c9 && c9.alien === true && rec9.tier === 3 &&
        rec9.capital === freeAway[0].id && G.space.planets[freeAway[0].id].colony.owner === rec9.aid &&
        G.space.ships.filter(s => s.owner === rec9.aid).length >= ALIEN_TIERS[3].ships &&
        rec9.contacted.includes(2)) + " name=" + (c9 ? c9.name : "?"));
      // invalid spots are refused
      const bad1 = sandboxAddAlien(freeAway[0].id, 2);           // already colonized now
      const dead = SPACE_PLANETS.find(d => G.space.planets[d.id] && G.space.planets[d.id].destroyed);
      log13("t9b-add-alien-guards=" + (bad1.ok === false && sandboxAddAlien("home", 2).ok === false));
      // ---- t24: a hyper-advanced (era-9) alien uses superweapons innately ----
      const far9 = freeAway.find(d => !G.space.planets[d.id].colony && planetSysId(d) !== planetSysId(freeAway[0]));
      if (far9) {
        const r2 = sandboxAddAlien(far9.id, 4);
        rec24 = r2.ok ? alienById(r2.aid) : null;
        const sd24 = rec24 ? G.space.ships.find(s => s.owner === rec24.aid && s.unit === "stardestroyer") : null;
        if (sd24) {
          const chk = canHarvestStar(sd24, "home");
          log13("t24-alien-innate-doom=" + (!(chk.why || "").includes("DOOM") ? "true" : "false") + " why=[" + (chk.why || "ok") + "]");
        } else log13("t24-alien-innate-doom=SKIP (no SD spawned)");
      } else log13("t24-alien-innate-doom=SKIP (no second free system)");
    } else { log13("t9-add-alien=SKIP (no free planets)"); log13("t9b-add-alien-guards=SKIP"); log13("t24-alien-innate-doom=SKIP"); }

    // ---- t11: civilization inspection — full military/economy/tech/city data ----
    P.provinces[0].b.spaceprogram = 1; // also needed by t22's landings
    const insP = inspectData(2);
    const insOk = insP && insP.military && typeof insP.military.power === "number" && insP.economy &&
      typeof insP.economy.money === "number" && insP.tech.researched === TECHS.length &&
      insP.cities.length === provsOfNation(2).length && insP.cities[0].buildings !== undefined &&
      insP.cities.some(ct => ct.buildings.some(b => b.b === "spaceprogram"));
    let insA = true;
    if (rec9) {
      const ia = inspectData(rec9.aid);
      insA = ia && ia.alien === true && ia.alienTier === 3 && ia.colonies.length >= 1 && ia.military.fleet >= 1;
    }
    log13("t11-inspection=" + (insOk && insA));

    // ---- t12: Force War between two AI nations + no early peace ----
    const aiIds = MAP_META.countries.map(m => m.id).filter(id => id !== 2 && G.countries[id] && G.countries[id].alive);
    const aiA = aiIds[0], aiB = aiIds[1];
    const fw = sandboxForceWar(aiA, aiB, "normal", false);
    const wAB = warOf(aiA, aiB);
    log13("t12-force-war-ai=" + (fw.ok === true && atWar(aiA, aiB) && !!wAB && wAB.forced === true &&
      wAB.noPeace > G.turn && aiAccepts(aiB, aiA, "peace") === false));

    // ---- t13: Force War between two ALIEN civilizations (total war) ----
    if (rec9 && rec24) {
      const fw2 = sandboxForceWar(rec24.aid, rec9.aid, "total", false);
      const wAl = warOf(rec24.aid, rec9.aid);
      log13("t13-force-war-aliens=" + (fw2.ok === true && atWar(rec24.aid, rec9.aid) && wAl.intensity === "total" &&
        rec24.assault && rec24.assault.target === rec9.aid));
      // ---- t18: the forced alien-vs-alien war is actually FOUGHT ----
      alienTick();
      const fleet24 = G.space.ships.filter(s => s.owner === rec24.aid);
      const busy = rec24.wantCarrier || fleet24.some(s => s.target || s.chase || s.colInv || s.vsTarget || s.free);
      log13("t18-alien-war-conduct=" + (busy === true) + " wantCarrier=" + !!rec24.wantCarrier +
        " ordered=" + fleet24.filter(s => s.target || s.chase || s.free).length + "/" + fleet24.length);
      // ---- t17: dominions know each other and hold relations ----
      log13("t17-alien-contact=" + ((rec24.knowsAlien && rec24.knowsAlien[rec9.aid] === true) &&
        typeof (G.rel[rec24.aid] || {})[rec9.aid] === "number"));
    } else { log13("t13-force-war-aliens=SKIP"); log13("t18-alien-war-conduct=SKIP"); log13("t17-alien-contact=SKIP"); }

    // ---- t14: Attack Mainland — the alien assault machine spools up ----
    if (rec9) {
      const fw3 = sandboxForceWar(rec9.aid, 2, "total", true);
      alienTick();
      const ordered = G.space.ships.filter(s => s.owner === rec9.aid && (s.target || s.chase || s.free || s.vsTarget)).length;
      log13("t14-attack-mainland=" + (fw3.ok === true && rec9.assault && rec9.assault.target === 2 &&
        rec9.assault.mainland === true && (rec9.wantCarrier === true || G.space.ships.some(s => s.owner === rec9.aid && s.landing !== undefined && s.landing !== null)) &&
        rec9.invadeCd > 0 && ordered > 0) +
        " wantCarrier=" + !!rec9.wantCarrier + " ordered=" + ordered);
    } else log13("t14-attack-mainland=SKIP");

    // ---- t15: Void Shields — build, then aliens are locked out ----
    G.sandbox.aiOff = 1; // deterministic construction ticks
    const paid = payVoidShield(2, "home");
    let vsHome = voidShieldAt("home");
    for (let i = 0; i < VOID_SHIELD.ticks + 2 && vsHome && vsHome.building; i++) spaceTurnTick();
    vsHome = voidShieldAt("home");
    const active = voidShieldActive("home");
    const blocksAlien = rec9 ? voidShieldBlocks("home", rec9.aid) === true : true;
    const freeHome = SPACE_PLANETS.find(d => planetSysId(d) === "home" && d.type !== "main" &&
      !G.space.planets[d.id].colony && !G.space.planets[d.id].destroyed);
    const foundBlocked = rec9 && freeHome ? alienFound(rec9, freeHome.id) === false : true;
    log13("t15-void-shield=" + (paid === true && active === true && blocksAlien && foundBlocked &&
      voidShieldBlocks("home", aiA) === false && voidShieldBlocks("home", 2) === false) +
      " active=" + active + " blocksAlien=" + blocksAlien + " colonizeBlocked=" + foundBlocked);
    G.sandbox.aiOff = 0;

    // ---- t16: an alien fleet is turned away at the barrier and besieges it ----
    if (rec9 && freeHome) {
      const homeSys = systemDef("home");
      const R = voidShieldRadius("home");
      const intruder = mkShip(rec9.aid, "starfleet", homeSys.x + R + 1200, homeSys.z);
      intruder.target = freeHome.id;
      for (let i = 0; i < 40 && intruder.hp > 0; i++) spaceTick(0.5);
      const distNow = Math.hypot(intruder.x - homeSys.x, intruder.z - homeSys.z);
      log13("t16-shield-turns-away=" + (intruder.target === null && intruder.vsTarget === "home" && distNow > R * 0.9) +
        " dist=" + Math.round(distNow) + "/R=" + Math.round(R) + " vsTarget=" + intruder.vsTarget);
      G.space.ships = G.space.ships.filter(s => s !== intruder);
    } else log13("t16-shield-turns-away=SKIP");

    // ---- t10: instant destruction — ship, colony, planet, alien capital ----
    const dummy = mkShip(2, "starfleet", hp0.x + 90, hp0.z + 90);
    const shipGone = sandboxDestroyShip(dummy) && !G.space.ships.includes(dummy);
    let colonyGone = "SKIP", planetGone = "SKIP", capitalFalls = "SKIP";
    const freeCol = SPACE_PLANETS.find(d => d.type !== "main" && !G.space.planets[d.id].colony &&
      !G.space.planets[d.id].destroyed && !sunDead(planetSysId(d)));
    if (freeCol) {
      G.space.planets[freeCol.id].colony = { owner: 2, lvl: 1, garrison: [] };
      colonyGone = sandboxDestroyColony(freeCol.id) === true && G.space.planets[freeCol.id].colony === null;
      planetGone = sandboxDestroyPlanet(freeCol.id) === true && G.space.planets[freeCol.id].destroyed === true;
    }
    if (rec24 && !rec24.defeated) {
      sandboxDestroyPlanet(rec24.capital);
      capitalFalls = rec24.defeated === true;
    }
    log13("t10-instant-destroy=" + (shipGone === true && colonyGone === true && planetGone === true &&
      (capitalFalls === true || capitalFalls === "SKIP")) +
      " ship=" + shipGone + " colony=" + colonyGone + " planet=" + planetGone + " capitalFalls=" + capitalFalls);

    // ---- t19: needs-based AI city development picks what is SHORT ----
    // (Old Bugs rewrite: aiSelectProject prices candidates through the real
    // production() — a −5 energy grid makes the Power Plant dominate)
    const cA = G.countries[aiA];
    sandboxUnlockAll(aiA);
    cA.res.money = 99999; cA.res.mat = 99999;
    const provsA = provsOwned(aiA);
    provsA[0].b.spaceprogram = 1; // the space priority is already satisfied
    const fakeProd = { food: 99999, energy: -5, money: 500, mat: 500, research: 99999, upkeep: 0, bmaint: 0, trade: 0 };
    const picks = {};
    for (let i = 0; i < 24; i++) { const sel = aiSelectProject(aiA, cA, fakeProd, provsA); const b = sel && sel.b; picks[b] = (picks[b] || 0) + 1; }
    log13("t19-ai-needs-building=" + ((picks.power || 0) >= 20) + " picks=" + JSON.stringify(picks));

    // ---- t20: obsolete works are replaced by their successors ----
    // (Old Bugs rewrite: the round-robin review demolishes the weakest work
    // only with a validated, funded successor queued in the same pass)
    const cB = G.countries[aiB];
    sandboxUnlockAll(aiB);
    cB.res.money = 99999; cB.res.mat = 99999;
    const provsB = provsOwned(aiB);
    const pB = provsB[0];
    pB.b = { school: pB.slots }; pB.bq = [];
    const beforeSchools = pB.b.school;
    cB.aiPlan = null;
    cB.aiModCity = provsB.length - 1; // round-robin lands on pB next
    const replaced = aiReviewCity(aiB, cB, production(cB), provsB);
    log13("t20-obsolete-replaced=" + (replaced === true && pB.b.school === beforeSchools - 1 &&
      pB.bq.length === 1 && (pB.bq[0].b === "lab" || pB.bq[0].b === "university")) +
      " queued=" + (pB.bq[0] ? pB.bq[0].b : "none"));

    // ---- t21: colony wars respect the AI-wars toggle ----
    const warsBefore = G.wars.length;
    for (let i = 0; i < 30; i++) aiConsiderColonyWar(aiB, cB, [], [], [], "aggressive");
    log13("t21-colony-war-gate=" + (G.wars.length === warsBefore && G.sandbox.noAIWars === 1));

    // ---- t22: fleet multi-select — E lands the WHOLE fleet at once ----
    const hpNow = planetPos("home");
    const f1 = mkShip(2, "starfleet", hpNow.x + 20, hpNow.z + 20);
    const f2 = mkShip(2, "starfleet", hpNow.x - 20, hpNow.z - 20);
    spaceSel = { kind: "ship", id: f1.id };
    spaceSelFleet = [f1.id, f2.id];
    const grp = spaceOrderGroup(f1);
    const armiesBefore = G.armies.filter(a => a.owner === 2).length;
    spaceEKey();
    const landedBoth = !G.space.ships.includes(f1) && !G.space.ships.includes(f2) &&
      G.armies.filter(a => a.owner === 2).length === armiesBefore + 2;
    log13("t22-fleet-multiselect=" + (grp.length === 2 && landedBoth) + " grp=" + grp.length + " landed=" + landedBoth);

    // ---- t23: the AI builds and fires missiles at war ----
    const provB2 = provsOwned(aiB)[1] || provsOwned(aiB)[0];
    provB2.b.silo = 1;
    cB.res.money = 99999; cB.res.mat = 99999;
    const myWarsB = G.wars.filter(w => w.a === aiB || w.b === aiB);
    let armed = false, fired = false;
    for (let i = 0; i < 80 && !(armed && fired); i++) {
      aiMissilesTurn(aiB, cB, myWarsB, powerEstimate(cB));
      if (missileTotal(cB) > 0) armed = true;
      if (missilesFly.length > 0) fired = true;
    }
    log13("t23-ai-missiles=" + (armed === true && fired === true) + " stock=" + missileTotal(cB) + " inFlight=" + missilesFly.length);

    log13("DONE13");
    flush();
  }
})();
