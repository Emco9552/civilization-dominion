// BUG REPORT (Alien Discovery & Researcher Restrictions) test battery.
// §1-4: revealing any alien-owned object registers its civilization in the
// 👁 Known Civilizations list — centralized in revealSystem()/alienDiscoveryScan(),
// regardless of technology tier, with no duplicates and a first-contact
// notification. §5-9: a Researcher may only rise inside the homeland system or
// a system holding one of the builder's colonies, never in deep space, never
// under active alien control — same rules for the player, the AI and aliens,
// every refusal carrying its exact reason.
// Loaded by test12.html; run with headless Chrome (--dump-dom), results land in
// <pre id="test-out"> prefixed TEST12:
(function () {
  const out = [];
  function flush() {
    let el = document.getElementById("test-out");
    if (!el && document.body) { el = document.createElement("pre"); el.id = "test-out"; document.body.appendChild(el); }
    if (el) el.textContent = out.join("\n");
  }
  const log12 = (...a) => { const s = "TEST12: " + a.join(" "); out.push(s); console.log(s); flush(); };
  window.addEventListener("error", e => { out.push("TEST12 PAGE ERROR: " + e.message + " " + (e.filename || "") + ":" + e.lineno); flush(); });
  const boot = setInterval(() => {
    if (typeof ID_ARR === "undefined" || !ID_ARR) return;
    clearInterval(boot);
    try { run(); } catch (e) { out.push("TEST12 ERROR: " + e.message + "\n" + e.stack); flush(); }
  }, 200);
  const inLog = txt => G.log.some(l => (l.x || "").includes(txt));
  function run() {
    initGame("standard", 2);
    startGameUI();
    G.rtPaused = true; // deterministic: only OUR calls advance the simulation
    ensureSpaceState();
    markSpaceReached(); // Alien War AI Fix §0: the battery simulates the first launch
    const aliens = (G.space.aliens || []).filter(a => !a.defeated);
    if (aliens.length < 2) { log12("SKIP — this galaxy rolled fewer than 2 alien civilizations"); log12("DONE12"); flush(); return; }
    const freePlanetIn = sysId => SPACE_PLANETS.find(d => planetSysId(d) === sysId &&
      !G.space.planets[d.id].colony && !G.space.planets[d.id].destroyed);
    // a build spot near a planet, pushed AWAY from its star (never into it)
    const outward = (p, sy, dist) => {
      const dx = p.x - sy.x, dz = p.z - sy.z, dl = Math.hypot(dx, dz) || 1;
      return { x: p.x + dx / dl * dist, z: p.z + dz / dl * dist };
    };

    // ---- report §10.1 baseline — nothing is known before anything is revealed ----
    log12("a1-start-unknown=" + aliens.every(a => !a.contacted.includes(2)));

    // ---- §10.5 — several civilizations in ONE system all register on reveal ----
    const recA = aliens[0], recB = aliens[1];
    const guest = freePlanetIn(recA.sys);
    if (guest) {
      G.space.planets[guest.id].colony = { owner: recB.aid, lvl: 1, garrison: [] };
      revealSystem(recA.sys);
      log12("a2-multi-owner-registers=" + (recA.contacted.includes(2) && recB.contacted.includes(2)) +
        " A=" + recA.contacted.includes(2) + " B=" + recB.contacted.includes(2));
    } else {
      revealSystem(recA.sys);
      log12("a2-multi-owner-registers=SKIP (no free planet in the host system) A-alone=" + recA.contacted.includes(2));
    }
    // §3 — diplomacy opens right after a reveal-based discovery
    const hail = alienTalk(2, recA.aid, "hail");
    log12("a3-diplomacy-open=" + (hail.ok === true));
    // §3 — the required first-contact notification exists
    log12("a4-notification=" + inLog("New civilization discovered"));

    // ---- §10.4 — a pure warp pass-through still discovers (no stopping) ----
    const recC = aliens.find(a => !a.contacted.includes(2) && !phantomActive(a.sys));
    if (recC) {
      const syC = systemDef(recC.sys);
      const home0 = systemDef("home");
      // aim from the homeland straight THROUGH the alien system to a point far
      // beyond it — the flight path crosses the system without ever stopping
      const dxC = syC.x - home0.x, dzC = syC.z - home0.z, dlC = Math.hypot(dxC, dzC) || 1;
      const probe = { id: 9301, owner: 2, unit: "starfleet", hp: 600, maxHp: 600, stack: 1, cargo: [],
        x: home0.x, y: 0, z: home0.z, target: null, chase: null, orbit: null, orbitAng: 0, cd: 99,
        free: { x: syC.x + dxC / dlC * 2000, y: 0, z: syC.z + dzC / dlC * 2000 } };
      G.space.ships.push(probe);
      let guard = 0;
      while (probe.free && guard++ < 2000) spaceTick(0.5);
      log12("a5-passthrough-discovers=" + (recC.contacted.includes(2) === true && systemRevealed(recC.sys) === true) +
        " contacted=" + recC.contacted.includes(2) + " charted=" + systemRevealed(recC.sys) + " ticks=" + guard);
      G.space.ships = G.space.ships.filter(s => s !== probe);
    } else log12("a5-passthrough-discovers=SKIP (no unrevealed civilization left)");

    // ---- §10.1-3 — every tier registers on reveal: tribal to hyper-advanced ----
    if (!aliens.some(a => a.tier === 1 && !a.contacted.includes(2))) {
      const forced = aliens.find(a => !a.contacted.includes(2));
      if (forced) forced.tier = 1; // guarantee a tribal-tier subject for the rule
    }
    const tierSeen = {}, tierOk = {};
    for (const a of aliens) {
      if (!systemRevealed(a.sys)) revealSystem(a.sys);
      else alienDiscoveryScan(a.sys);
      tierSeen[a.tier] = 1;
      tierOk[a.tier] = (tierOk[a.tier] === undefined ? true : tierOk[a.tier]) && a.contacted.includes(2);
    }
    const tiers = Object.keys(tierSeen).sort();
    log12("a6-all-tiers-register=" + tiers.every(t => tierOk[t]) +
      " tiers-covered=" + tiers.map(t => t + ":" + ALIEN_TIERS[t].n + "=" + tierOk[t]).join(","));

    // ---- §10.6 — repeated scans never create duplicate entries ----
    alienDiscoveryScan(); alienDiscoveryScan();
    for (const a of aliens) if (systemRevealed(a.sys)) revealSystem(a.sys);
    log12("a7-no-duplicates=" + aliens.every(a => a.contacted.filter(x => x === 2).length <= 1));

    // ---- save-load: visible alien territory registers immediately on load ----
    recA.contacted = recA.contacted.filter(x => x !== 2); // pretend an old save
    spaceStateReadyFor = null;                            // force the load-path init
    ensureSpaceState();
    log12("a8-load-rescan-registers=" + recA.contacted.includes(2));

    // ================= Researcher construction restrictions =================
    const P = G.countries[2];
    P.researched.researcher_t = true;
    P.res.money = 999999; P.res.mat = 999999;
    const hp0 = planetPos("home");
    const homeStar = systemDef("home");
    const resCount = () => (G.space.researchers || []).length;

    // ---- §10.7 — random deep space is blocked ----
    let deep = null;
    for (let x = -9000; x <= 9000 && !deep; x += 137) {
      for (let z = -9000; z <= 9000; z += 137) {
        if (!SPACE_SYSTEMS.some(sy => (sy.x - x) ** 2 + (sy.z - z) ** 2 < 900 * 900)) { deep = { x, z }; break; }
      }
    }
    if (deep) {
      const chk = researcherSiteCheck(2, deep.x, 0, deep.z);
      const n0 = resCount();
      const built = buildResearcher(2, deep.x, 0, deep.z, true);
      log12("b1-deep-space-blocked=" + (!chk.ok && !built && resCount() === n0 && chk.why.includes("outside a valid solar system")) +
        " why=[" + chk.why + "]");
    } else log12("b1-deep-space-blocked=SKIP (no deep-space point found)");

    // ---- §10.8 — the homeland system accepts the build ----
    const n1 = resCount();
    const rHome = buildResearcher(2, hp0.x + 220, 0, hp0.z + 220, true);
    log12("b2-homeland-build-ok=" + (!!rHome && resCount() === n1 + 1));
    // inside the star itself stays blocked, with its reason
    const chkStar = researcherSiteCheck(2, homeStar.x, 0, homeStar.z);
    log12("b3-star-overlap-blocked=" + (!chkStar.ok && chkStar.why.includes("overlaps the star")));
    // in-system but far from every anchor: the "move closer" reason. 560 from
    // the star keeps the home star the NEAREST system (others are 1150+ away),
    // and probing opposite the Homeworld keeps that anchor out of range too.
    const hpNow = planetPos("home");
    const da = Math.atan2(hpNow.z - homeStar.z, hpNow.x - homeStar.x);
    const chkFar = researcherSiteCheck(2, homeStar.x - Math.cos(da) * 560, 0, homeStar.z - Math.sin(da) * 560);
    log12("b4-move-closer-reason=" + (!chkFar.ok && chkFar.why.includes("move the structure closer")) + " why=[" + chkFar.why + "]");

    // ---- §10.9-10 — foreign system: blocked without a colony, open with one ----
    const alienSys = new Set();
    for (const a of G.space.aliens || []) for (const s of alienAssetSystems(a)) alienSys.add(s);
    const fresh = SPACE_SYSTEMS.find(sy => sy.id !== "home" && !alienSys.has(sy.id) &&
      !alienControlsSystem(sy.id, 2) && freePlanetIn(sy.id));
    if (fresh) {
      const chkNo = researcherSiteCheck(2, fresh.x + fresh.r + 80, 0, fresh.z);
      log12("b5-no-colony-blocked=" + (!chkNo.ok && chkNo.why.includes("no owned colony")) + " why=[" + chkNo.why + "]");
      const pl = freePlanetIn(fresh.id);
      G.space.planets[pl.id].colony = { owner: 2, lvl: 1, garrison: [] };
      const pp = planetPos(pl.id);
      // offset AWAY from the star so a minimum-orbit world never lands the
      // spot inside the star's no-build core
      const ov = outward(pp, fresh, 90);
      const chkYes = researcherSiteCheck(2, ov.x, 0, ov.z);
      const n2 = resCount();
      const rCol = buildResearcher(2, ov.x, 0, ov.z, true);
      log12("b6-colony-unlocks=" + (chkYes.ok === true && !!rCol && resCount() === n2 + 1) + " sys=" + fresh.id);
    } else { log12("b5-no-colony-blocked=SKIP (no empty system with planets)"); log12("b6-colony-unlocks=SKIP"); }

    // ---- §10.11-12 — alien control blocks; defeat + kept colony unblocks ----
    // (skip recA: its system also hosts recB's guest colony, which would keep
    // the system correctly blocked even after recA's defeat)
    const recD = (G.space.aliens || []).find(a => !a.defeated && a !== recA && freePlanetIn(a.sys) &&
      alienControlsSystem(a.sys, 2));
    if (recD) {
      const mine = freePlanetIn(recD.sys);
      G.space.planets[mine.id].colony = { owner: 2, lvl: 1, garrison: [] };
      const mp = outward(planetPos(mine.id), systemDef(recD.sys), 90);
      const chkAl = researcherSiteCheck(2, mp.x, 0, mp.z);
      const blocked = !chkAl.ok && chkAl.why.includes("still controls this solar system");
      log12("b7-alien-control-blocks=" + blocked + " why=[" + chkAl.why + "]");
      alienDefeated(recD, 2, "conquered"); // their colonies surrender to us
      const chkFree2 = researcherSiteCheck(2, mp.x, 0, mp.z);
      const n3 = resCount();
      const rAfter = buildResearcher(2, mp.x, 0, mp.z, true);
      log12("b8-defeat-unblocks=" + (chkFree2.ok === true && !!rAfter && resCount() === n3 + 1));
    } else { log12("b7-alien-control-blocks=SKIP (no suitable alien system)"); log12("b8-defeat-unblocks=SKIP"); }

    // ---- §10.13 — the AI and the aliens obey the same restrictions ----
    const aiId = ID_ARR.find(id => id !== 2 && G.countries[id] && G.countries[id].alive && !isSynthetic(G.countries[id]));
    if (aiId !== undefined) {
      const AI = G.countries[aiId];
      AI.researched.researcher_t = true;
      AI.res.money = 999999; AI.res.mat = 999999;
      const aiDeep = deep ? !buildResearcher(aiId, deep.x, 0, deep.z, true) : "SKIP";
      const n4 = resCount();
      const aiHome = !!buildResearcher(aiId, hp0.x - 240, 0, hp0.z - 240, true) && resCount() === n4 + 1;
      log12("b9-ai-same-rules=" + (aiDeep === true && aiHome === true) + " deep-blocked=" + aiDeep + " homeland-ok=" + aiHome);
    } else log12("b9-ai-same-rules=SKIP (no AI country found)");
    const recE = (G.space.aliens || []).find(a => !a.defeated && a.capital &&
      !SPACE_PLANETS.some(d => planetSysId(d) === a.sys && G.space.planets[d.id].colony &&
        G.space.planets[d.id].colony.owner !== a.aid));
    if (recE) {
      const noTech = !buildResearcher(recE.aid, hp0.x + 400, 0, hp0.z + 400, true); // no tech, foreign space
      const techWhy = researcherSiteCheck(recE.aid, hp0.x + 400, 0, hp0.z + 400).why;
      G.countries[recE.aid].researched.researcher_t = true;
      G.countries[recE.aid].res.money = 999999; G.countries[recE.aid].res.mat = 999999;
      const stillForeign = !buildResearcher(recE.aid, hp0.x + 400, 0, hp0.z + 400, true); // our homeland is not theirs
      const cp = outward(planetPos(recE.capital), systemDef(recE.sys), 90);
      const own = !!buildResearcher(recE.aid, cp.x, 0, cp.z, true); // their own system is fine
      log12("b10-alien-same-rules=" + (noTech && stillForeign && own) +
        " pre-tech-blocked=" + noTech + " [" + techWhy + "] foreign-blocked=" + stillForeign + " own-system-ok=" + own);
    } else log12("b10-alien-same-rules=SKIP (no undisturbed alien left)");

    log12("DONE12");
    flush();
  }
})();
