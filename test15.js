// Old Bugs (AI City Development Controller) + Small Humanity Update battery.
// Covers: live refresh of the AI's building options after research, empirical
// needs-based selection, the saved plan with resource reservation, safe
// delete-and-replace of obsolete works (validated successor, funded, queued in
// the same pass), shortage guards (no famine demolitions), unique-structure
// limits (one Space Program per civilization), save/load mid-plan, a long
// high-speed modernization sim ending in visibly advanced cities, and the
// Human 11/10 Intelligence + 30% research species bonus (map, colonies, halo,
// researcher stations, controller-independent, applied exactly once, glowing
// selection-screen display).
// Loaded by test15.html; run with headless Chrome (--dump-dom), results land
// in <pre id="test-out"> prefixed TEST15:
(function () {
  const out = [];
  function flush() {
    let el = document.getElementById("test-out");
    if (!el && document.body) { el = document.createElement("pre"); el.id = "test-out"; document.body.appendChild(el); }
    if (el) el.textContent = out.join("\n");
  }
  const log15 = (...a) => { const s = "TEST15: " + a.join(" "); out.push(s); console.log(s); flush(); };
  window.addEventListener("error", e => { out.push("TEST15 PAGE ERROR: " + e.message + " " + (e.filename || "") + ":" + e.lineno); flush(); });
  const boot = setInterval(() => {
    if (typeof ID_ARR === "undefined" || !ID_ARR) return;
    clearInterval(boot);
    try { run(); } catch (e) { out.push("TEST15 ERROR: " + e.message + "\n" + e.stack); flush(); }
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

    // ---- t1: the AI's building options refresh the moment a tech lands ----
    const idR = aiIds[0], cR = G.countries[idR];
    const hadUni = Object.keys(BLDGS).filter(b => bldgAvailable(cR, b)).includes("university");
    cR.researched.university = true; bumpMods();
    const hasUni = Object.keys(BLDGS).filter(b => bldgAvailable(cR, b)).includes("university");
    cR.res.money = 99999; cR.res.mat = 99999;
    const fakeR = { food: 99999, energy: 50, money: 5000, mat: 5000, research: 0.01, upkeep: 0, bmaint: 0, trade: 0 };
    let uniPicked = false;
    for (let i = 0; i < 12 && !uniPicked; i++) {
      const s = aiSelectProject(idR, cR, fakeR, provsOwned(idR));
      if (s && s.b === "university") uniPicked = true;
    }
    log15("t1-refresh-after-research=" + (!hadUni && hasUni && uniPicked));

    // ---- t2: expensive projects — reserve, save, build, and NEVER twice ----
    const idS = aiIds[1], cS = G.countries[idS];
    sandboxUnlockAll(idS);
    if (typeof closeModal === "function") closeModal();
    const provsS = provsOwned(idS);
    cS.res.money = 200; cS.res.mat = 200; cS.aiPlan = null;
    const fakeS = { food: 99999, energy: 60, money: 300, mat: 300, research: 99999, upkeep: 0, bmaint: 0, trade: 0 };
    aiDevelop(idS, cS, fakeS, provsS, false);
    const planMade = !!(cS.aiPlan && cS.aiPlan.b === "spaceprogram" && cS.aiPlan.need && cS.aiPlan.need.money > 1000);
    const reservedBlocks = aiSpendableMoney(cS) < 0; // recruiting/upgrades see nothing to spend
    const savedNotBuilt = countBldgQ(cS, "spaceprogram") === 0;
    cS.res.money = 99999; cS.res.mat = 99999;
    aiDevelop(idS, cS, fakeS, provsS, false);
    const builtOnce = countBldgQ(cS, "spaceprogram") === 1 && !cS.aiPlan;
    for (let i = 0; i < 25; i++) aiDevelop(idS, cS, fakeS, provsS, false);
    const stillOne = countBldgQ(cS, "spaceprogram") === 1;
    // ports stay one per city, even with money to burn
    const portsOk = provsOwned(idS).every(p => cityBldgQ(p, "port") <= 1);
    log15("t2-reserve-and-unique=" + (planMade && reservedBlocks && savedNotBuilt && builtOnce && stillOne && portsOk) +
      " plan=" + planMade + " reserved=" + reservedBlocks + " once=" + builtOnce + " after25=" + stillOne + " ports=" + portsOk);

    // ---- t3: replacement plan survives save/load and finishes safely ----
    const idT = aiIds[2], cT = G.countries[idT];
    sandboxUnlockAll(idT);
    if (typeof closeModal === "function") closeModal();
    const provsT = provsOwned(idT);
    const pT = provsT[0];
    pT.b = { market: pT.slots }; pT.bq = [];
    cT.res.money = 10; cT.res.mat = 10; cT.aiPlan = null;
    cT.aiModCity = provsT.length - 1; // the review lands on pT next
    const reviewed = aiReviewCity(idT, cT, production(cT), provsT);
    const planWaits = !!(cT.aiPlan && cT.aiPlan.replace === "market") && pT.b.market === pT.slots && pT.bq.length === 0;
    autosave();
    const loaded = loadSave();
    const cT2 = G.countries[idT];
    const planSurvived = !!(cT2.aiPlan && cT2.aiPlan.b === cT.aiPlan.b && cT2.aiPlan.replace === "market");
    const planB = cT2.aiPlan ? cT2.aiPlan.b : null; // whatever the empirical model chose
    cT2.res.money = 99999; cT2.res.mat = 99999;
    const stepped = aiPlanStep(idT, cT2);
    const pT2 = provsOwned(idT).find(p => p.city === pT.city);
    const executed = !!pT2 && (pT2.b.market || 0) === pT.slots - 1 && (pT2.bq || []).length === 1 &&
      pT2.bq[0].b === planB && planB !== "market" && !cT2.aiPlan;
    // and the replacement actually finishes construction
    let finished = false;
    if (executed) {
      const wanted = pT2.bq[0].b;
      for (let i = 0; i < 40 && (pT2.bq || []).length; i++) tickBuildQueue(cT2, pT2);
      finished = (pT2.b[wanted] || 0) >= 1;
    }
    log15("t3-plan-save-load=" + (reviewed === true && planWaits && loaded === true && planSurvived && stepped === true && executed && finished) +
      " waits=" + planWaits + " survived=" + planSurvived + " executed=" + executed + " finished=" + finished);

    // ---- t4: essential production is never demolished into a famine ----
    const idF = aiIds[3], cF = G.countries[idF];
    sandboxUnlockAll(idF);
    if (typeof closeModal === "function") closeModal();
    const provsF = provsOwned(idF);
    const pF = provsF[0];
    pF.b = { farm: pF.slots }; pF.bq = [];
    cF.res.money = 99999; cF.res.mat = 99999; cF.aiPlan = null;
    cF.pop = Math.max(1, (production(cF).food / 1.05) * 0.98); // food barely covers the nation
    cF.aiModCity = provsF.length - 1;
    const reviewed4 = aiReviewCity(idF, cF, production(cF), provsF);
    log15("t4-no-famine-demolition=" + (reviewed4 === false && pF.b.farm === pF.slots && !cF.aiPlan) +
      " farms=" + pF.b.farm + "/" + pF.slots);

    // ---- t5: covered needs stop the cheap-filler spam ----
    const idQ = aiIds.find(id => !["aggressive", "defensive"].includes(NATIONS[id].per) &&
      ![aiIds[0], aiIds[1], aiIds[2], aiIds[3]].includes(id));
    const cQ = G.countries[idQ];
    cQ.res.money = 99999; cQ.res.mat = 99999;
    const fakeQ = { food: 99999, energy: 99, money: 99999, mat: 99999, research: 99999, upkeep: 0, bmaint: 0, trade: 0 };
    const before5 = provsOwned(idQ).reduce((n, p) => n + usedSlots(p), 0);
    for (let i = 0; i < 5; i++) aiDevelop(idQ, cQ, fakeQ, provsOwned(idQ), false);
    const after5 = provsOwned(idQ).reduce((n, p) => n + usedSlots(p), 0);
    log15("t5-no-cheap-spam=" + (before5 === after5 && !cQ.aiPlan) + " built=" + (after5 - before5));

    // ---- t6: the long march — a final-era AI visibly modernizes its cities ----
    const idL = aiIds.find(id => ![idR, idS, idT, idF, idQ].includes(id));
    const cL = G.countries[idL];
    sandboxUnlockAll(idL);
    if (typeof closeModal === "function") closeModal();
    for (let pass = 0; pass < 140; pass++) {
      cL.res.money = 99999; cL.res.mat = 99999;
      aiDevelop(idL, cL, production(cL), provsOwned(idL), false);
      for (const p of provsOwned(idL)) for (let k = 0; k < 3; k++) tickBuildQueue(cL, p);
    }
    let total6 = 0, baseline6 = 0, adv6 = 0, lvlUp = false;
    const advSet = {};
    for (const p of provsOwned(idL)) {
      if ((p.lvl || 1) > 1) lvlUp = true;
      for (const b of Object.keys(p.b)) {
        total6 += p.b[b];
        if (b === "farm" || b === "house" || b === "mine") baseline6 += p.b[b];
        const t = BLDGS[b].tech && TECH_BY_ID[BLDGS[b].tech];
        if (t && t.e >= 5) { adv6 += p.b[b]; advSet[b] = 1; }
      }
    }
    const advShare = total6 ? adv6 / total6 : 0, baseShare = total6 ? baseline6 / total6 : 1;
    log15("t6-long-run-modernized=" + (adv6 >= 5 && advShare >= 0.25 && baseShare <= 0.65 && lvlUp) +
      " advanced=" + adv6 + "/" + total6 + " advShare=" + advShare.toFixed(2) + " baselineShare=" + baseShare.toFixed(2) +
      " lvlUp=" + lvlUp + " kinds=" + Object.keys(advSet).join("+"));

    // ---- t7: the whole aiTurn wiring runs clean and still builds ----
    const idM = aiIds.find(id => ![idR, idS, idT, idF, idQ, idL].includes(id));
    const cM = G.countries[idM];
    cM.res.money = 8000; cM.res.mat = 5000;
    const before7 = provsOwned(idM).reduce((n, p) => n + usedSlots(p), 0);
    let turnErr = null;
    try { for (let i = 0; i < 12; i++) { cM.aiRest = 0; aiTurn(idM); } } catch (e) { turnErr = e.message; }
    const after7 = provsOwned(idM).reduce((n, p) => n + usedSlots(p), 0);
    log15("t7-aiturn-smoke=" + (turnErr === null && after7 > before7) + " built=" + (after7 - before7) +
      (turnErr ? " ERR=" + turnErr : ""));

    // ---- t8: Humans 11/10 — the only species past the cap, +30% research ----
    const others10 = MAP_META.countries.every(m => m.id === 2 || NATIONS[m.id].st.every(v => v <= 10));
    log15("t8-human-11of10=" + (NATIONS[2].st[0] === 11 && stat(H, "int") === 11 && others10 &&
      NATIONS[2].ab.research === 0.30 && NATIONS[2].ab.d.includes("+30%")));

    // ---- t9: the +30% reaches every source, exactly once ----
    // a colony, a Halo Ring and a Researcher station for the ratio probes
    const freeP = SPACE_PLANETS.find(d => d.type !== "main" && G.space.planets[d.id] &&
      !G.space.planets[d.id].destroyed && !G.space.planets[d.id].colony && !sunDead(planetSysId(d)));
    const stP = freeP ? G.space.planets[freeP.id] : null;
    if (stP) { stP.colony = { owner: 2, lvl: 2, garrison: [], b: {} }; stP.halo = { done: true, owner: 2 }; }
    G.space.researchers = G.space.researchers || [];
    G.space.researchers.push({ id: 4999, owner: 2, lvl: 2, hp: 3000, maxHp: 3000, x: 400, y: 0, z: 400 });
    const md1 = mods(H).research, r1 = production(H).research;
    const cp1 = stP ? colonyProduction(freeP, stP, H).research : 0;
    const si1 = spaceIncomeOf(H);
    NATIONS[2].ab.research = 0; bumpMods();
    const md0 = mods(H).research, r0 = production(H).research;
    const cp0 = stP ? colonyProduction(freeP, stP, H).research : 0;
    const si0 = spaceIncomeOf(H);
    NATIONS[2].ab.research = 0.30; bumpMods();
    const mapOnce = near(md1 - md0, 0.30, 1e-9) && near(r1 / r0, (1 + md1) / (1 + md0));
    const colonyOk = stP ? near(cp1 / cp0, 1.3) : true;
    const haloOk = stP ? near(si1.haloResearch / si0.haloResearch, 1.3) : true;
    const researcherOk = near(si1.researcherRp / si0.researcherRp, 1.3);
    if (stP) { stP.colony = null; stP.halo = null; }
    G.space.researchers = G.space.researchers.filter(r => r.id !== 4999);
    log15("t9-research-bonus-everywhere=" + (mapOnce && colonyOk && haloOk && researcherOk) +
      " map=" + mapOnce + " colony=" + colonyOk + " halo=" + haloOk + " researcher=" + researcherOk);

    // ---- t10: the bonus is the SPECIES', not the local player's ----
    const rA = production(G.countries[2]).research;
    const oldPid = G.playerId; G.playerId = aiIds[0];
    const rB = production(G.countries[2]).research;
    G.playerId = oldPid;
    log15("t10-species-bound=" + (Math.abs(rA - rB) < 1e-9));

    // ---- t11: the selection screen glows Beyond Maximum for humans only ----
    pickedId = 2; renderPickPanel();
    const html2 = document.getElementById("pick-panel").innerHTML;
    pickedId = 1; renderPickPanel();
    const html1 = document.getElementById("pick-panel").innerHTML;
    pickedId = 2; renderPickPanel();
    log15("t11-beyond-maximum-display=" + (html2.includes("11/10") && html2.includes("Beyond Maximum") &&
      html2.includes("overfill") && html2.includes("overnotch") && html2.includes("+30% research points") &&
      !html1.includes("Beyond Maximum") && !html1.includes("overfill")));

    log15("DONE15");
    flush();
  }
})();
