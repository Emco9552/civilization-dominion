// BUG REPORT (Alien Detection on First Contact) test battery.
// Passive discovery: flying through or near alien-held space must register the
// civilization as a full diplomatic entity — no Researcher scan or Dyson
// signature needed. Covers the report's validation list: flyby registration,
// immediate diplomacy, immediate war, per-civilization registration, the
// open-void sensor pass near an alien fleet, and no false positives for
// civilizations never encountered.
// Loaded by test11.html; run with headless Chrome (--dump-dom), results land in
// <pre id="test-out"> prefixed TEST11:
(function () {
  const out = [];
  function flush() {
    let el = document.getElementById("test-out");
    if (!el && document.body) { el = document.createElement("pre"); el.id = "test-out"; document.body.appendChild(el); }
    if (el) el.textContent = out.join("\n");
  }
  const log11 = (...a) => { const s = "TEST11: " + a.join(" "); out.push(s); console.log(s); flush(); };
  window.addEventListener("error", e => { out.push("TEST11 PAGE ERROR: " + e.message + " " + (e.filename || "") + ":" + e.lineno); flush(); });
  const boot = setInterval(() => {
    if (typeof ID_ARR === "undefined" || !ID_ARR) return;
    clearInterval(boot);
    try { run(); } catch (e) { out.push("TEST11 ERROR: " + e.message + "\n" + e.stack); flush(); }
  }, 200);
  const inLog = txt => G.log.some(l => (l.x || "").includes(txt));
  function run() {
    initGame("standard", 2);
    startGameUI();
    G.rtPaused = true; // deterministic: only OUR calls advance the simulation
    ensureSpaceState();
    markSpaceReached(); // Alien War AI Fix §0: the battery simulates the first launch
    const aliens = (G.space.aliens || []).filter(a => !a.defeated);
    if (aliens.length < 2) { log11("SKIP — this galaxy rolled fewer than 2 alien civilizations"); log11("DONE11"); flush(); return; }
    const recA = aliens[0], recB = aliens[1];

    // ---- validation 6 — no contact before any encounter, no false positives ----
    alienTick();
    log11("t1-no-contact-before-encounter=" + (!recA.contacted.includes(2) && !recB.contacted.includes(2)));

    // ---- validations 1-2 — a flyby through a held system registers the civ ----
    const sysA = systemDef(recA.sys);
    const probe = { id: 9201, owner: 2, unit: "starfleet", hp: 600, maxHp: 600, stack: 1, cargo: [],
      x: sysA.x + 60, y: 0, z: sysA.z + 60, target: null, chase: null, orbit: null, orbitAng: 0, cd: 0 };
    G.space.ships.push(probe);
    alienTick();
    log11("t2-flyby-registers=" + (recA.contacted.includes(2) === true && recA.knows[2] === true &&
      systemRevealed(recA.sys) === true && inLog("has been encountered by")) +
      " contacted=" + recA.contacted.includes(2) + " they-know-us=" + (recA.knows[2] === true) +
      " system-charted=" + systemRevealed(recA.sys));

    // ---- validation 3 — diplomacy opens immediately after the flyby ----
    const hail = alienTalk(2, recA.aid, "hail");
    log11("t3-diplomacy-open=" + (hail.ok === true));

    // ---- validation 4 — war can be declared immediately after the flyby ----
    const war = alienTalk(2, recA.aid, "war");
    log11("t4-war-available=" + (war.ok === true && atWar(2, recA.aid) === true));

    // ---- validation 5 — every civilization registers individually ----
    const sysB = systemDef(recB.sys);
    probe.x = sysB.x + 60; probe.z = sysB.z + 60;
    alienTick();
    log11("t5-each-civ-registers=" + (recB.contacted.includes(2) === true));

    // ---- open-void sensor pass: near their fleet, far from every system ----
    const recC = aliens.length > 3 ? aliens[2] : null;
    if (recC) {
      let deep = null;
      for (let x = -9000; x <= 9000 && !deep; x += 137) {
        for (let z = -9000; z <= 9000; z += 137) {
          if (!SPACE_SYSTEMS.some(sy => (sy.x - x) ** 2 + (sy.z - z) ** 2 < 900 * 900)) { deep = { x, z }; break; }
        }
      }
      if (deep) {
        const wanderer = { id: 9202, owner: recC.aid, unit: "starfleet", hp: 600, maxHp: 600, stack: 1, cargo: [],
          x: deep.x, y: 0, z: deep.z, target: null, chase: null, orbit: null, orbitAng: 0, cd: 0 };
        G.space.ships.push(wanderer);
        probe.x = deep.x + 120; probe.z = deep.z + 120; // inside the 260 sensor bubble
        alienTick();
        log11("t6-void-sensor-pass=" + (recC.contacted.includes(2) === true) + " at=" + deep.x + "," + deep.z);
      } else log11("t6-void-sensor-pass=SKIP (no deep-space point found)");
    } else log11("t6-void-sensor-pass=SKIP (galaxy too small)");

    // ---- validation 6 again — an unvisited civilization stays unknown ----
    // (unless one of its assets legitimately drifted into charted space: the
    // centralized §1-4 discovery scan is REQUIRED to register that case)
    const untouched = aliens[aliens.length - 1];
    const distinct = untouched !== recA && untouched !== recB && untouched !== recC;
    const exposed = typeof alienAssetSystems === "function" &&
      Array.from(alienAssetSystems(untouched)).some(sid => systemRevealed(sid) && !phantomActive(sid));
    log11("t7-no-false-positives=" + (!distinct ? "SKIP (galaxy too small)"
      : exposed ? "SKIP (an asset drifted into charted space — registration is correct there)"
      : !untouched.contacted.includes(2)));

    log11("DONE11");
    flush();
  }
})();
