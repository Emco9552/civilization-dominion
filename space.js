// ============================================================
// CIVILIZATION: DOMINION — the Space Expansion (Huge Update Part 2)
// A lightweight custom 3D view: the star, the Homeworld (which carries
// the whole 2D map), colonizable planets, spacecraft, colonies and the
// late-game megastructures. No libraries — everything is projected and
// drawn by hand onto one canvas.
//
// The battlefield stays in war.js; the economy stays in engine.js.
// This file owns everything that happens above the atmosphere.
// ============================================================
"use strict";

let spaceOpen = false;      // is the space view currently shown?
let spaceSel = null;        // {kind:"star"|"planet"|"ship"|"researcher", id, sys}
let spaceSelFleet = [];     // AI Update §21: multi-selected own ship ids (fleet control)
let spacePlacing = null;    // "researcher" while choosing a build spot in open space
let phantomSelSys = null;   // BUG REPORT: system chosen in the station's Phantom Step console
let spaceFx = [];           // transient effects (lasers, explosions, shatters)
// SU2 Part 5 — a fully free camera: x/y/z is the point the camera looks at,
// follow (optionally) tracks a selected object until the player pans away.
let spaceCam = { yaw: 0.6, pitch: 0.42, zoom: 0.85, x: 0, y: 0, z: 0, follow: null };
let spaceDrag = null;
let spaceKeys = {};         // WASD / arrow panning state
let spaceStars = null;      // background starfield (generated once)
let spacePanelDirty = true;
let spaceMsgTimer = 0;

const SHIP_RNG = 110;       // weapon range in space units
const SHIP_ARRIVE = 10;     // how close counts as "arrived"
const PLANET_NEAR = 46;     // base "near a planet" range — planetNearR adds the planet's own radius
const STAR_NEAR = 150;      // "near a star" for attacking a Dyson Sphere
const WARP_SPEED = 16;      // speed multiplier while crossing between systems (the galaxy is big now)
const GALAXY_TARGET = 50;   // total solar systems per game (SU2 Part 6)

// BUG REPORT (Critical Bug-Fix Update §9) — availability diagnostics. Flip
// SPACE_DBG on (or set window.SPACE_DBG = true in the console) and every
// blocked/allowed gate below explains itself in the browser console.
let SPACE_DBG = false;
function spDbg(msg) {
  if ((SPACE_DBG || (typeof window !== "undefined" && window.SPACE_DBG)) && typeof console !== "undefined") console.log("[SPACE] " + msg);
}

// ---------------- the generated galaxy (SU2 Part 6) ----------------
// Each new game rolls ~50 solar systems. The generated defs are plain data in
// G.space.gen, so they persist in saves and travel inside multiplayer
// snapshots; rebuildGalaxy() merges them into the runtime arrays.
const SYS_SYL_A = ["Al", "Be", "Cra", "Dra", "Er", "Fel", "Gor", "Hy", "Ilo", "Ka", "Lu", "Mor", "Ny", "Or", "Pra", "Qua", "Rig", "Sol", "Tau", "Ul", "Vor", "Wex", "Xan", "Yel", "Zor"];
const SYS_SYL_B = ["adris", "antor", "elia", "enix", "eron", "ethis", "ion", "ios", "ola", "one", "ora", "orin", "ula", "una", "ux", "yra"];
function genSystemName(i) { return SYS_SYL_A[(i * 7 + 3) % SYS_SYL_A.length] + SYS_SYL_B[(i * 11 + 5) % SYS_SYL_B.length]; }
const PLANET_TYPE_STYLE = {
  lava: { col: [235, 112, 62],  col2: [122, 42, 22]  },
  rock: { col: [204, 141, 100], col2: [134, 84, 56]  },
  ice:  { col: [194, 221, 247], col2: [126, 161, 202] },
  gas:  { col: [216, 194, 146], col2: [162, 131, 92]  },
  dark: { col: [131, 116, 158], col2: [76, 66, 100]   },
};
// Update §5-6: ONE supermassive black hole per galaxy, near the core. The
// alien-occupancy roll is the FIRST random draw so the 10%/90% rule is exact.
// Critical Bug-Fix §2: an optional homePos keeps the hole a real journey away
// from the homeland (old saves pass nothing and keep their classic behavior).
function genBlackHoleFor(systems, homePos) {
  const occupied = Math.random() < BLACK_HOLE.guardChance;
  let best = { x: 900, z: -700 };
  for (let t = 0; t < 400; t++) {
    const ang = rnd(0, Math.PI * 2), dist = rnd(700, 1500);
    const x = Math.round(Math.cos(ang) * dist), z = Math.round(Math.sin(ang) * dist);
    best = { x, z };
    if (homePos && (homePos.x - x) ** 2 + (homePos.z - z) ** 2 < 2000 * 2000) continue;
    if (!(systems || []).some(s => (s.x - x) ** 2 + (s.z - z) ** 2 < 600 * 600)) break;
  }
  return { x: best.x, z: best.z, r: BLACK_HOLE.r, aliens: occupied };
}
function genGalaxy() {
  const bhOccupied = Math.random() < BLACK_HOLE.guardChance; // §6: rolled first — 10% / 90%
  // BUG REPORT (Critical Bug-Fix Update §2): the HOMELAND no longer sits in the
  // galactic centre beside the black hole. Each new galaxy rolls it a random
  // position on a wide mid-galaxy ring — always connected (generated systems
  // pack around every used position), never near the core. The rolled spot is
  // stored in gen.homePos; rebuildGalaxy() stamps it onto the runtime def, so
  // saves and multiplayer snapshots reproduce the exact same galaxy.
  const fixed = SPACE_SYSTEMS_BASE.filter(s => s.id !== "home").map(s => ({ x: s.x, z: s.z }));
  let homePos = { x: 4200, z: 2600 };
  for (let t = 0; t < 400; t++) {
    const hAng = rnd(0, Math.PI * 2), hDist = rnd(4200, 7600);
    const cand = { x: Math.round(Math.cos(hAng) * hDist), z: Math.round(Math.sin(hAng) * hDist * 0.82) };
    homePos = cand;
    if (!fixed.some(u => (u.x - cand.x) ** 2 + (u.z - cand.z) ** 2 < 1600 * 1600)) break;
  }
  const systems = [], planets = [];
  const want = Math.max(0, GALAXY_TARGET - SPACE_SYSTEMS_BASE.length);
  const used = fixed.concat([{ x: homePos.x, z: homePos.z }]);
  const starCols = [[255,220,120],[255,150,110],[150,190,255],[255,235,190],[255,130,130],[205,165,255],[165,255,220],[255,205,150],[235,235,255]];
  let made = 0, tries = 0;
  while (made < want && tries < 6000) {
    tries++;
    const ang = rnd(0, Math.PI * 2);
    const dist = 1500 + Math.pow(rnd(0, 1), 0.7) * 7800;    // denser core, sparse rim
    const x = Math.round(Math.cos(ang) * dist), z = Math.round(Math.sin(ang) * dist * 0.82);
    if (used.some(u => (u.x - x) ** 2 + (u.z - z) ** 2 < 1150 * 1150)) continue;
    used.push({ x, z });
    made++;
    const id = "g" + made;
    systems.push({ id, n: genSystemName(made + (G.turn || 0)), x, z, r: irnd(24, 62), col: pick(starCols) });
    // not every system is equally populated: many are sparse, some are empty
    const nP = pick([0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5]);
    let orbit = irnd(100, 150);
    for (let k = 0; k < nP; k++) {
      const type = pick(["lava", "rock", "rock", "ice", "ice", "gas", "dark"]);
      const st = PLANET_TYPE_STYLE[type];
      const jit = c => c.map(v => clamp(Math.round(v + rnd(-18, 18)), 20, 255));
      planets.push({
        id: id + "p" + (k + 1), n: genSystemName(made * 3 + k + 7) + " " + ["I", "II", "III", "IV", "V"][k],
        sys: id, type, r: irnd(10, type === "gas" ? 24 : 18),
        dist: orbit, ang: rnd(0, Math.PI * 2), speed: rnd(0.004, 0.016) * (orbit > 300 ? 0.5 : 1),
        col: jit(st.col), col2: jit(st.col2),
        bias: pick([null, null, null, "mat", "money", "energy", "research"]),
        ring: type === "gas" && Math.random() < 0.4 ? 1 : 0,
      });
      orbit += irnd(85, 150);
    }
  }
  const bh = genBlackHoleFor(SPACE_SYSTEMS_BASE.filter(s => s.id !== "home").concat(systems), homePos);
  bh.aliens = bhOccupied; // the pre-rolled §6 occupancy stands
  return { systems, planets, bh, homePos };
}
function rebuildGalaxy() {
  const gen = G && G.space && G.space.gen;
  SPACE_SYSTEMS = SPACE_SYSTEMS_BASE.concat(gen && gen.systems ? gen.systems : []);
  SPACE_PLANETS = SPACE_PLANETS_BASE.concat(gen && gen.planets ? gen.planets : []);
  // Critical Bug-Fix §2: stamp this game's rolled homeland position onto the
  // shared base def. Old saves carry no homePos and keep the classic centre —
  // their ships, colonies and camera stay exactly where they were.
  const home = SPACE_SYSTEMS.find(s => s.id === "home");
  if (home) {
    home.x = gen && gen.homePos ? gen.homePos.x : 0;
    home.z = gen && gen.homePos ? gen.homePos.z : 0;
  }
}

// ---------------- state ----------------
// ensureSpaceState is called from hot render paths (systemRevealed/planetState
// run per planet per frame) — the reference guard makes repeat calls free and
// only a brand-new G.space (new game, load, snapshot) pays the full init.
let spaceStateReadyFor = null;
function ensureSpaceState() {
  if (!G) return;
  if (G.space && spaceStateReadyFor === G.space) return;
  if (!G.space) G.space = { planets: {}, ships: [], shipSeq: 1, dyson: null, seenIntro: false };
  if (!G.space.planets) G.space.planets = {};
  if (!G.space.ships) G.space.ships = [];
  if (!G.space.shipSeq) G.space.shipSeq = 1;
  if (!G.space.researchers) G.space.researchers = [];   // Researcher megastructures (Part 9)
  if (!G.space.battles) G.space.battles = [];           // ground battles on colonies (Final Alien Update Part 8)
  if (!G.space.battleSeq) G.space.battleSeq = 1;
  if (!G.space.systems) G.space.systems = {};           // per-system extras (alien dyson etc.)
  if (!G.space.gen) G.space.gen = genGalaxy();          // this game's rolled galaxy (SU2 Part 6)
  // Update §5: older galaxies gain their central black hole (never with aliens —
  // no new civilization appears in the middle of a running game)
  if (!G.space.gen.bh) { G.space.gen.bh = genBlackHoleFor(SPACE_SYSTEMS_BASE.concat(G.space.gen.systems || [])); G.space.gen.bh.aliens = false; }
  rebuildGalaxy();
  for (const sys of SPACE_SYSTEMS) {
    if (!G.space.systems[sys.id]) G.space.systems[sys.id] = { revealed: sys.id === "home" };
  }
  for (const def of SPACE_PLANETS) {
    if (!G.space.planets[def.id]) {
      G.space.planets[def.id] = { ang: def.ang, colony: null, destroyed: false, halo: null };
    }
  }
  if (typeof ensureAliens === "function") ensureAliens(); // alien civilizations (Part 7)
  spaceStateReadyFor = G.space; // hot-path guard armed — see above (and BEFORE
  // the scan below, so its systemRevealed() calls can't re-enter this init)
  // BUG REPORT §2: a save loaded with alien territory already in view
  // registers those civilizations immediately — no ship has to move first
  if (typeof alienDiscoveryScan === "function") alienDiscoveryScan();
}
function planetDef(id) { return SPACE_PLANETS.find(p => p.id === id); }
function planetState(id) { ensureSpaceState(); return G.space.planets[id]; }
function systemDef(id) { return SPACE_SYSTEMS.find(s => s.id === id) || SPACE_SYSTEMS[0]; }
function planetSysId(def) { return (def && def.sys) || "home"; }
function systemRevealed(sysId) {
  ensureSpaceState();
  const s = G.space.systems[sysId];
  return !s || s.revealed;
}
// SU2 Part 4: spacecraft obey the same troop-visibility setting as armies
// (🪖 All / Only mine / Hidden). Fleets of nations at war with you always stay
// visible, and fleets hiding in uncharted systems stay invisible regardless.
function shipVisibleToPlayer(s) {
  // Update §17-18: a cloaked civilization's fleets are unseen INSIDE their own
  // Phantom Step system — until they leave it, or war exposes them
  if (typeof phantomShipHiddenFrom === "function" && phantomShipHiddenFrom(s, G.playerId)) return false;
  if (!systemRevealed(systemAt(s.x, s.z).id) && !isHumanControlled(s.owner)) return false;
  const mode = typeof viewOpts !== "undefined" && viewOpts ? viewOpts.armyMode : "all";
  if (mode === "all") return true;
  if (atWar(G.playerId, s.owner)) return true;
  return s.owner === G.playerId ? mode === "mine" : false;
}
function planetPos(id) {
  const def = planetDef(id), st = planetState(id);
  const sys = systemDef(planetSysId(def));
  return {
    x: sys.x + Math.cos(st.ang) * def.dist,
    y: Math.sin(st.ang * 1.7 + def.dist) * def.dist * 0.05,
    z: sys.z + Math.sin(st.ang) * def.dist,
  };
}
function systemAt(x, z) { // which system's space is this position in?
  let best = SPACE_SYSTEMS[0], bd = Infinity;
  for (const s of SPACE_SYSTEMS) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
// the burning Homeworld (Space Update Part 2) — checked all over the engine
function homeworldScorched() {
  return !!(G && G.space && G.space.planets && G.space.planets.home && G.space.planets.home.scorched);
}
function researcherById(id) { return (G.space.researchers || []).find(r => r.id === id); }
function shipById(id) { return G.space.ships.find(s => s.id === id); }
function shipsOfNation(cid) { ensureSpaceState(); return G.space.ships.filter(s => s.owner === Number(cid)); }
function coloniesOfNation(cid) {
  ensureSpaceState();
  const out = [];
  for (const def of SPACE_PLANETS) {
    const st = G.space.planets[def.id];
    if (st.colony && st.colony.owner === Number(cid) && !st.destroyed) out.push({ def, st });
  }
  return out;
}
function spaceProgramCity(cid) {
  return provsOwned(cid).find(p => (p.b.spaceprogram || 0) > 0 && !p.occ) || null;
}
function garrisonPower(col) {
  let p = 0;
  for (const g of col.garrison || []) p += (UNITS[g.unit].def + UNITS[g.unit].atk * 0.4) * (g.hp / g.maxHp) * 0.5;
  return p;
}
function colonyDefence(planetId) {
  const st = planetState(planetId);
  if (!st.colony) return 0;
  let d = garrisonPower(st.colony) + st.colony.lvl * 30;
  if (st.halo && st.halo.done) d += 400; // the ring is a fortress
  return d;
}

// ---------------- launching from the map ----------------
// war.js asks this to decide whether the "Go to Space" button appears
function canLaunchSelected(list) {
  if (!G || !list || !list.length) return { ok: false };
  if (!list.every(a => a.owner === G.playerId && UNITS[a.unit].space)) return { ok: false };
  const cost = SPACE_COSTS.launch;
  return { ok: true, why: `Send the selected spacecraft into orbit — ${cost.money}💰 and ${cost.energy}⚡ each (needs a city with a 🚀 Space Program).` };
}
function launchSelectedToSpace() {
  const list = selArmies.map(armyById).filter(a => a && a.owner === G.playerId && UNITS[a.unit].space);
  if (!list.length) return;
  if (typeof netIntercept === "function" && netIntercept("launch", { ids: list.map(a => a.id) })) return;
  const P = G.countries[G.playerId];
  const site = spaceProgramCity(G.playerId);
  if (!site) { toast("You need a city with a completed 🚀 Space Program to launch."); return; }
  const free = sbFree(G.playerId);
  const money = free ? 0 : SPACE_COSTS.launch.money * list.length;
  const energy = free ? 0 : SPACE_COSTS.launch.energy * list.length;
  if (P.res.money < money) { toast(`Launching needs ${money}💰.`); return; }
  if (P.res.energy < energy) { toast(`Launching needs ${energy}⚡ spare energy — build power plants.`); return; }
  P.res.money -= money; P.res.energy -= energy;
  for (const a of list) launchArmyToSpace(a);
  sfx("launch");
  log(`🚀 ${list.length} spacecraft lift off from ${site.city} into orbit.`, "good");
  toast(`🚀 ${list.length} craft launched — open the 🌌 Space view to command them.`);
  if (typeof renderTopbar === "function") renderTopbar();
  if (!G.space.seenIntro) { G.space.seenIntro = true; enterSpace(); }
}
// convert a map army into a space ship near the Homeworld (shared with the AI)
function launchArmyToSpace(a) {
  ensureSpaceState();
  const hp = planetPos("home");
  const ang = rnd(0, Math.PI * 2);
  const s = {
    id: G.space.shipSeq++, owner: a.owner, unit: a.unit,
    hp: a.hp, maxHp: a.maxHp, stack: a.stack || 1,
    cargo: (a.cargo || []).slice(),
    x: hp.x + Math.cos(ang) * 40, y: hp.y + rnd(-12, 12), z: hp.z + Math.sin(ang) * 40,
    target: null, chase: null, orbit: "home", orbitAng: rnd(0, Math.PI * 2), cd: rnd(0, 1),
    novaCd: a.novaCd || 0, // the core cannon's charge state survives relaunching (SU2 §10/§12)
    hlCd: a.hlCd || 0,     // hyper lazer cooldown too (AI Improvements Part 12)
    omniCd: a.omniCd || 0, omniCharges: a.omniCharges || 0, // Small Update: stellar charges ride along
    harvestCd: a.harvestCd || 0, // Update §11: harvest-system cooldown too
  };
  G.space.ships.push(s);
  markSpaceReached(); // Alien War AI Fix §0.1: the first craft aloft IS the space milestone
  removeArmyQuiet(a);
  updateWarHint();
  return s;
}
// land a ship back on the Homeworld at a Space Program city (SU2 Part 12:
// works for every land-capable craft — Star Destroyers included — and keeps
// health, cargo, stack and the core-cannon cooldown; the touchdown spot is
// solid ground outside the city core, never water or a building)
function landShip(s) {
  const cid = s.owner;
  if (homeworldScorched()) {
    if (cid === G.playerId) toast("🔥 The surface burns — landing there means death. Rehabilitate the planet first.");
    return false;
  }
  const site = spaceProgramCity(cid);
  if (!site) { if (cid === G.playerId) toast("No free Space Program city to land at — every launch site is lost or occupied."); return false; }
  let spot = null;
  for (let t = 0; t < 10 && !spot; t++) {
    const ang = rnd(0, Math.PI * 2), d = rnd(16, 26 + t * 5);
    const x = site.px + Math.cos(ang) * d, y = site.py + Math.sin(ang) * d;
    spot = typeof findLandNear === "function" ? findLandNear(x, y, 22) : { x, y };
    // keep clear of the city sprite itself and of parked armies
    if (spot && typeof cityAt === "function" && cityAt(spot.x, spot.y, 9)) spot = null;
    if (spot && G.armies.some(m => (m.x - spot.x) ** 2 + (m.y - spot.y) ** 2 < 6 * 6)) spot = null;
  }
  if (!spot) spot = { x: site.px + 20, y: site.py + 20 };
  const a = spawnArmy(cid, s.unit, spot.x, spot.y);
  if (!a) return false;
  a.hp = Math.min(s.hp, a.maxHp * (s.stack || 1));
  if (s.stack > 1) { a.stack = s.stack; a.maxHp = unitMaxHp(s.unit) * s.stack; a.hp = Math.min(s.hp, a.maxHp); }
  if (s.cargo && s.cargo.length) a.cargo = s.cargo.slice();
  if (s.novaCd > 0) a.novaCd = s.novaCd; // no cooldown laundering via landing (SU2 §10)
  if (s.hlCd > 0) a.hlCd = s.hlCd;
  if (s.omniCd > 0) a.omniCd = s.omniCd;           // Small Update: no cooldown laundering…
  if (s.omniCharges > 0) a.omniCharges = s.omniCharges; // …and stored stellar charges survive landing
  if (s.harvestCd > 0) a.harvestCd = s.harvestCd;  // Update §11: the harvest cooldown too
  removeShip(s);
  if (cid === G.playerId) { toast(`🌍 ${UNITS[s.unit].n} lands at ${site.city}.`); sfx("move"); }
  // troops aboard step off onto the homeland surface (SU2 Part 1)
  if (a.cargo && a.cargo.length && typeof deployCargo === "function") deployCargo(a);
  return true;
}
function removeShip(s) {
  const i = G.space.ships.indexOf(s);
  if (i >= 0) G.space.ships.splice(i, 1);
  if (spaceSel && spaceSel.kind === "ship" && spaceSel.id === s.id) { spaceSel = null; spacePanelDirty = true; }
  const fi = spaceSelFleet.indexOf(s.id);
  if (fi >= 0) { spaceSelFleet.splice(fi, 1); spacePanelDirty = true; }
}

// ---------------- colonies ----------------
function colonizePlanet(cid, planetId, silent) {
  const def = planetDef(planetId), st = planetState(planetId);
  const c = G.countries[cid];
  if (!def || def.type === "main" || st.destroyed || st.colony) return false;
  if (!c.researched.colonyships) { if (cid === G.playerId && !silent) toast("Colonization requires the Colony Ships technology."); return false; }
  // BUG REPORT (star death): nothing new is founded around a dead star
  if (sunDead(planetSysId(def))) { if (cid === G.playerId && !silent) toast("The system's star is dead — no colony can live in its frozen dark."); return false; }
  const free = cid === G.playerId && sbFree(cid);
  const cost = free ? { money: 0, mat: 0 } : SPACE_COSTS.colonize;
  if (c.res.money < cost.money || c.res.mat < cost.mat) {
    if (cid === G.playerId && !silent) toast(`Founding a colony needs ${cost.money}💰 and ${cost.mat}⛏.`);
    return false;
  }
  c.res.money -= cost.money; c.res.mat -= cost.mat;
  st.colony = { owner: Number(cid), lvl: 1, garrison: [] };
  log(`🪐 ${c.name} founds a colony on ${def.n}!`, Number(cid) === G.playerId ? "good" : "sys");
  if (Number(cid) === G.playerId) sfx("capture");
  spacePanelDirty = true;
  return true;
}
function upgradeColony(cid, planetId, silent) {
  const st = planetState(planetId), def = planetDef(planetId);
  const c = G.countries[cid];
  if (!st.colony || st.colony.owner !== Number(cid) || st.destroyed) return false;
  // BUG REPORT (star death): a frozen colony cannot grow
  if (sunDead(planetSysId(def))) { if (!silent && cid === G.playerId) toast("The system's star is dead — the frozen colony cannot be expanded."); return false; }
  if (st.colony.lvl >= COLONY_MAX_LVL) { if (!silent && cid === G.playerId) toast("The colony is already fully developed."); return false; }
  const free = cid === G.playerId && sbFree(cid);
  const cost = free ? { money: 0, mat: 0 } : SPACE_COSTS.colonyUp(st.colony.lvl);
  if (c.res.money < cost.money || c.res.mat < cost.mat) {
    if (!silent && cid === G.playerId) toast(`The next stage needs ${cost.money}💰 and ${cost.mat}⛏.`);
    return false;
  }
  c.res.money -= cost.money; c.res.mat -= cost.mat;
  st.colony.lvl++;
  if (Number(cid) === G.playerId) { log(`🪐 The colony on ${def.n} grows to level ${st.colony.lvl}.`, "good"); sfx("coin"); }
  spacePanelDirty = true;
  return true;
}
// ---------------- colony buildings (AI Improvements Part 14.3) ----------------
// Colonies are no longer limited to their level: they raise real production
// buildings — Mines, Refineries, Industrial Plants and Orbital Fabricators.
function colonyBldgCount(col) {
  let n = 0;
  for (const k of Object.keys(col.b || {})) n += col.b[k];
  return n;
}
function buildColonyBldg(cid, planetId, bId, silent) {
  const st = planetState(planetId), def = planetDef(planetId);
  const B = COLONY_BLDGS[bId];
  const c = G.countries[cid];
  if (!B || !st.colony || st.colony.owner !== Number(cid) || st.destroyed) return false;
  // BUG REPORT (star death): no new mines or plants rise around a dead star
  if (sunDead(planetSysId(def))) { if (!silent && cid === G.playerId) toast("The system's star is dead — its industry is frozen; nothing new can be built."); return false; }
  if (B.tech && !c.researched[B.tech]) {
    if (!silent && cid === G.playerId) toast(`${B.n} requires the ${techById(B.tech) ? techById(B.tech).n : B.tech} technology.`);
    return false;
  }
  st.colony.b = st.colony.b || {};
  if (colonyBldgCount(st.colony) >= COLONY_BLDG_SLOTS(st.colony.lvl)) {
    if (!silent && cid === G.playerId) toast(`No free building slots — a level ${st.colony.lvl} colony holds ${COLONY_BLDG_SLOTS(st.colony.lvl)}. Upgrade the colony.`);
    return false;
  }
  const free = cid === G.playerId && sbFree(cid);
  const cost = free ? { money: 0, mat: 0 } : B.cost;
  if (c.res.money < cost.money || c.res.mat < cost.mat) {
    if (!silent && cid === G.playerId) toast(`${B.n} needs ${cost.money}💰 and ${cost.mat}⛏.`);
    return false;
  }
  c.res.money -= cost.money; c.res.mat -= cost.mat;
  st.colony.b[bId] = (st.colony.b[bId] || 0) + 1;
  if (Number(cid) === G.playerId) { log(`${B.icon} ${B.n} built on ${def.n}.`, "good"); sfx("build"); }
  spacePanelDirty = true;
  return true;
}
// one colony's production per tick BEFORE mode scaling — the income tick and
// the colony UI both read this, so what is displayed is what is received
function colonyProduction(def, st, c) {
  const col = st.colony;
  const L = col.lvl;
  let m = 25 * L, mt = 12 * L, en = 6 * L, rs = 8 * L, fd = 4 * L;
  if (def.bias === "money") m *= 1.6;
  if (def.bias === "mat") mt *= 1.6;
  if (def.bias === "energy") en *= 1.6;
  if (def.bias === "research") rs *= 1.6;
  // Small Humanity Update §3: the species research bonus reaches colony labs
  // too — applied here at the source, so panels, ledgers and the treasury all
  // see the same number and nothing applies it twice.
  if (c && typeof speciesResearchMult === "function") rs *= speciesResearchMult(c);
  // Part 14.3: colony buildings add their output (refineries want a mine)
  const b = col.b || {};
  mt += (b.mine || 0) * COLONY_BLDGS.mine.mat;
  mt += (b.refinery || 0) * COLONY_BLDGS.refinery.mat * ((b.mine || 0) > 0 ? 1 : 0.5);
  mt += (b.industrial || 0) * COLONY_BLDGS.industrial.mat;
  m  += (b.industrial || 0) * (COLONY_BLDGS.industrial.money || 0);
  mt += (b.orbfab || 0) * COLONY_BLDGS.orbfab.mat;
  // the designated capital planet is the new economic centre (Part 12):
  // +200% money, materials and energy from that world
  if (c && c.spaceCapital === def.id) { m *= 1 + CAPITAL_PLANET.bonus; mt *= 1 + CAPITAL_PLANET.bonus; en *= 1 + CAPITAL_PLANET.bonus; }
  // BUG REPORT (Critical Bug-Fix Update §5): a Dead Sun no longer zeroes the
  // system economy — EVERY output of every planet here (base, bias, industry,
  // capital bonus alike) is cut to 20% of normal, applied HERE in the real
  // calculation so the panels, the ledgers and the treasury all agree. The
  // colony still cannot grow or build (see upgrade/colonize/industry gates).
  if (typeof sunDead === "function" && sunDead(planetSysId(def))) {
    const dm = DEAD_SUN.prodMult;
    m *= dm; mt *= dm; en *= dm; rs *= dm; fd *= dm;
  }
  return { money: m, mat: mt, energy: en, research: rs, food: fd };
}
// Dyson output with the Part 3 damage rule: a harmed sphere produces less,
// a destroyed one nothing at all (destroyDyson removes the record entirely)
function dysonOutput(dy) {
  if (!dy || dy.stage < 1) return 0;
  let e = MEGA_DEFS.dyson.energyPerStage * dy.stage;
  if (dy.hp !== undefined && dy.hp < DYSON_HP) e *= 0.4 + 0.6 * Math.max(0, dy.hp) / DYSON_HP;
  return Math.round(e);
}
// per-source space income of a nation — the Part 4 breakdown and the topbar
// read the same numbers that colonyIncome() actually credits
function spaceIncomeOf(c) {
  const out = { colonies: { money: 0, mat: 0, energy: 0, research: 0, food: 0 },
    dysonEnergy: 0, haloMoney: 0, haloResearch: 0, researcherRp: 0 };
  if (!G.space) return out;
  // Small Humanity Update §3: Halo Rings and Researcher stations honour the
  // species research bonus too (colony research already carries it at source)
  const spMult = typeof speciesResearchMult === "function" ? speciesResearchMult(c) : 1;
  for (const def of SPACE_PLANETS) {
    const st = G.space.planets[def.id];
    if (!st || st.destroyed || !st.colony || st.colony.owner !== c.id) continue;
    const p = colonyProduction(def, st, c);
    out.colonies.money += p.money; out.colonies.mat += p.mat; out.colonies.energy += p.energy;
    out.colonies.research += p.research; out.colonies.food += p.food;
    // Critical Bug-Fix §5: a Halo Ring around a Dead Sun runs on 20% power —
    // the same multiplier as every other planetary output in the system
    if (st.halo && st.halo.done && st.halo.owner === c.id) {
      const hm = sunDead(planetSysId(def)) ? DEAD_SUN.prodMult : 1;
      out.haloMoney += 80 * hm; out.haloResearch += 50 * hm * spMult;
    }
  }
  // Small Update §4: a Dyson Sphere around a dead (fully harvested) sun wraps a
  // cold cinder — its colossal output is gone with the star.
  // Final Space Fixes §2: EVERY sphere the nation owns pays out, wherever its
  // star burns — the home sphere and any system spheres alike.
  if (G.space.dyson && G.space.dyson.owner === c.id && !sunDead("home")) out.dysonEnergy += dysonOutput(G.space.dyson);
  for (const sysId of Object.keys(G.space.systems || {})) {
    const sdy = G.space.systems[sysId].dyson;
    if (sdy && sdy.owner === c.id && !sunDead(sysId)) out.dysonEnergy += dysonOutput(sdy);
  }
  // Researcher megastructures pour out science (Part 9)
  for (const r of G.space.researchers || []) {
    if (r.owner !== c.id || r.destroyed) continue;
    out.researcherRp += RESEARCHER_RP(r.lvl) * spMult;
  }
  return out;
}
// colony & megastructure production — added to a nation's income each tick
// (BUG FIX Parts 2-3: this is the ONE income path; the topbar and panels now
// display these same numbers, and each colony keeps a ledger of its output)
function colonyIncome(c) {
  if (!G.space) return;
  const M = MODES[G.mode].res;
  const inc = spaceIncomeOf(c);
  const money = inc.colonies.money + inc.haloMoney;
  const mat = inc.colonies.mat;
  const energy = inc.colonies.energy + inc.dysonEnergy;
  const research = inc.colonies.research + inc.haloResearch + inc.researcherRp;
  const food = inc.colonies.food;
  if (!money && !mat && !energy && !research && !food) return;
  c.res.money += money * M;
  c.res.mat += mat * M;
  c.res.food = Math.min(2000 + c.pop * 50, c.res.food + food * M);
  c.res.energy += energy; // energy is a flow — megastructure output is immune to mode scaling
  if (research > 0) {
    if (c.researching) c.rp += research * M;
    else if (c.milResearching && typeof feedMilUpgrade === "function") feedMilUpgrade(c, research * M); // SU2 §13
    else c.res.money += research * 0.5 * M;
  }
  // Part 2: per-colony ledger — the colony UI shows total resources produced
  for (const def of SPACE_PLANETS) {
    const st = G.space.planets[def.id];
    if (!st || st.destroyed || !st.colony || st.colony.owner !== c.id) continue;
    const p = colonyProduction(def, st, c);
    const tot = st.colony.total = st.colony.total || { money: 0, mat: 0, energy: 0, research: 0, food: 0 };
    tot.money += p.money * M; tot.mat += p.mat * M; tot.energy += p.energy;
    tot.research += p.research * M; tot.food += p.food * M;
  }
  // Part 3: total energy each Dyson Sphere has actually delivered — per sphere
  if (G.space.dyson && G.space.dyson.owner === c.id && !sunDead("home")) {
    const e0 = dysonOutput(G.space.dyson);
    if (e0 > 0) G.space.dyson.total = (G.space.dyson.total || 0) + e0;
  }
  for (const sysId of Object.keys(G.space.systems || {})) {
    const sdy = G.space.systems[sysId].dyson;
    if (sdy && sdy.owner === c.id && !sunDead(sysId)) {
      const eS = dysonOutput(sdy);
      if (eS > 0) sdy.total = (sdy.total || 0) + eS;
    }
  }
}
function colonyPopCap(c) {
  if (!G.space) return 0;
  let cap = 0;
  for (const def of SPACE_PLANETS) {
    const st = G.space.planets[def.id];
    if (!st || st.destroyed || !st.colony || st.colony.owner !== c.id) continue;
    // Critical Bug-Fix §5: colonies under a Dead Sun support only 20% of their
    // normal population (the growth side of the −80% production rule)
    const dm = sunDead(planetSysId(def)) ? DEAD_SUN.prodMult : 1;
    cap += 1.2 * st.colony.lvl * dm;
    if (st.halo && st.halo.done && st.halo.owner === c.id) cap += 8 * dm;
  }
  return cap;
}
// annexation: the conqueror inherits colonies, ships and megastructures
function spaceAbsorb(loserId, winnerId) {
  if (!G.space) return;
  for (const def of SPACE_PLANETS) {
    const st = G.space.planets[def.id];
    if (st.colony && st.colony.owner === loserId) st.colony.owner = winnerId;
    if (st.halo && st.halo.owner === loserId) st.halo.owner = winnerId;
    if (st.shield && st.shield.owner === loserId) st.shield.owner = winnerId;
    if (st.rehab && st.rehab.owner === loserId) st.rehab.owner = winnerId;
  }
  for (const s of G.space.ships) if (s.owner === loserId) s.owner = winnerId;
  if (G.space.dyson && G.space.dyson.owner === loserId) G.space.dyson.owner = winnerId;
  if (G.space.dyson && G.space.dyson.shield && G.space.dyson.shield.owner === loserId) G.space.dyson.shield.owner = winnerId;
  // Final Space Fixes §4: full ANNEXATION of a nation absorbs its system
  // spheres too (conquering just a system never transfers one — the sphere
  // must be destroyed or its whole owner absorbed)
  for (const sysId of Object.keys(G.space.systems || {})) {
    const sdy = G.space.systems[sysId].dyson;
    if (sdy && sdy.owner === loserId) sdy.owner = winnerId;
    if (sdy && sdy.shield && sdy.shield.owner === loserId) sdy.shield.owner = winnerId;
  }
  for (const r of G.space.researchers || []) {
    if (r.owner === loserId) r.owner = winnerId;
    if (r.shield && r.shield.owner === loserId) r.shield.owner = winnerId;
  }
  const L = G.countries[loserId];
  if (L && L.spaceCapital) {
    const W = G.countries[winnerId];
    if (W && !W.spaceCapital) W.spaceCapital = L.spaceCapital;
    L.spaceCapital = null;
  }
  spacePanelDirty = true;
}

// ---------------- troop transport (space side) ----------------
// deploy a ship's cargo into the colony garrison below
function deployCargoToColony(s, planetId) {
  const st = planetState(planetId), def = planetDef(planetId);
  if (!s.cargo || !s.cargo.length) { if (s.owner === G.playerId) toast("No troops aboard."); return; }
  // Final Alien Update Part 8: while a battle rages below, troops drop straight
  // into the fight instead of a garrison that no longer exists
  const b = battleOn(planetId);
  if (b) {
    if (s.owner === b.att || s.owner === b.def) {
      const n = pbBoard(b, s, s.owner === b.att ? 0 : 1);
      if (s.owner === G.playerId) { toast(`👾 ${n} unit${n > 1 ? "s" : ""} drop into the battle for ${def.n}!`); sfx("move"); }
    } else if (s.owner === G.playerId) toast("A battle rages below — you are not part of it.");
    spacePanelDirty = true;
    return;
  }
  if (!st.colony || st.colony.owner !== s.owner) { if (s.owner === G.playerId) toast("Troops can only be deployed onto your own colony."); return; }
  let n = 0;
  while (s.cargo.length) { st.colony.garrison.push(s.cargo.pop()); n++; }
  if (s.owner === G.playerId) { toast(`👾 ${n} unit${n > 1 ? "s" : ""} deployed to garrison ${def.n}.`); sfx("move"); }
  spacePanelDirty = true;
}
// pull garrison troops back aboard (up to capacity)
function loadGarrison(s, planetId) {
  const st = planetState(planetId), def = planetDef(planetId);
  const cap = UNITS[s.unit].cap || 0;
  if (!cap) { if (s.owner === G.playerId) toast("This craft has no troop bays."); return; }
  if (battleOn(planetId)) { if (s.owner === G.playerId) toast("The garrison is fighting for its life below — nothing can lift off."); return; }
  if (!st.colony || st.colony.owner !== s.owner || !st.colony.garrison.length) {
    if (s.owner === G.playerId) toast("No garrison of yours to load here.");
    return;
  }
  s.cargo = s.cargo || [];
  let n = 0;
  while (s.cargo.length < cap && st.colony.garrison.length) { s.cargo.push(st.colony.garrison.pop()); n++; }
  if (s.owner === G.playerId) { toast(`⛴ ${n} unit${n > 1 ? "s" : ""} loaded aboard (${s.cargo.length}/${cap}).`); sfx("recruit"); }
  spacePanelDirty = true;
}

// ---------------- invasions ----------------
// BUG REPORT (Critical Bug-Fix Update §3) — the invasion-entry module. ONE
// check decides whether an invasion can begin; the planet panel, the ship
// panel, the E key and the multiplayer handler all ask it. It returns the
// transport that would carry the landing so the caller can start the battle.
function invasionTransport(cid, planetId) {
  ensureSpaceState();
  const p = planetPos(planetId);
  let best = null, bd = Infinity;
  for (const s of G.space.ships) {
    if (s.owner !== Number(cid) || s.hp <= 0) continue;
    if (!(s.cargo && s.cargo.length)) continue;
    if (!shipNearPlanet(s, planetId)) continue;
    const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2 + (s.z - p.z) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
function invasionCheck(cid, planetId) {
  cid = Number(cid);
  const st = planetState(planetId), def = planetDef(planetId);
  const deny = why => { spDbg(`Invasion blocked (${def ? def.n : planetId}): ${why}`); return { ok: false, why }; };
  if (!def || !st) return deny("no such world");
  if (st.destroyed) return deny("only debris remains of that world");
  if (!st.colony) return deny("there is no colony to invade");
  if (st.colony.owner === cid) return deny("the colony is already yours");
  if (!atWar(cid, st.colony.owner)) {
    const N = G.countries[st.colony.owner];
    return deny(`you are not at war with ${N ? N.name : "its owner"}`);
  }
  if (battleOn(planetId)) return deny("a ground battle is already being fought there");
  const s = invasionTransport(cid, planetId);
  if (!s) {
    const nearEmpty = G.space.ships.some(t => t.owner === cid && t.hp > 0 &&
      (UNITS[t.unit].cap || 0) > 0 && shipNearPlanet(t, planetId));
    return deny(nearEmpty ? "transport contains no troops"
      : "no loaded troop transport near the planet — fly one close first");
  }
  spDbg(`Invasion available: at war with the colony owner of ${def.n}, transport #${s.id} carries ${s.cargo.length} unit(s)`);
  return { ok: true, ship: s };
}
// the confirmation step (§3.1): name the troops that will land, then begin.
// Runs the multiplayer intercept only AFTER the player confirms.
function confirmInvasion(planetId) {
  const chk = invasionCheck(G.playerId, planetId);
  if (!chk.ok) { toast("Invasion blocked: " + chk.why + "."); spacePanelDirty = true; return; }
  const s = chk.ship, def = planetDef(planetId);
  const D = G.countries[planetState(planetId).colony.owner];
  const troops = s.cargo.map(cu => `${UNITS[cu.unit].icon} ${esc(UNITS[cu.unit].n)} (${Math.round(cu.hp)}/${Math.round(cu.maxHp)})`).join("<br>");
  openModal(`<h2>⚔ Invade ${esc(def.n)}?</h2>
    <p>These troops will leave the ${esc(UNITS[s.unit].n)}'s bays and drop onto the surface of ${esc(D ? D.name : "?")}'s colony:</p>
    <p class="small">${troops}</p>
    <p class="dim small">The defending fleet must already be cleared from orbit. Your warships overhead add fire support; loaded transports in orbit drop reinforcements. The colony changes hands if the attackers win.</p>
    <button class="btn danger" id="inv-yes">⚔ Begin the landing</button>
    <button class="btn" data-close>Stand down</button>`);
  const btn = document.getElementById("inv-yes");
  if (btn) btn.onclick = () => {
    closeModal();
    if (typeof netIntercept === "function" && netIntercept("invade", { id: s.id, planet: planetId })) return;
    resolveInvasion(s, planetId);
    spacePanelDirty = true;
  };
}
function resolveInvasion(s, planetId) {
  const st = planetState(planetId), def = planetDef(planetId);
  if (!st.colony || st.destroyed) return false;
  const defender = st.colony.owner, attacker = s.owner;
  if (defender === attacker) return false;
  if (!atWar(attacker, defender)) return false;
  if (!s.cargo || !s.cargo.length) return false;
  // Final Alien Update Part 8: invasions involving a human player are fought as
  // REAL-TIME ground battles on the surface — no more single dice roll. Pure
  // AI-vs-AI landings keep the fast mathematical resolution below.
  if (isHumanControlled(attacker) || isHumanControlled(defender)) return startPlanetBattle(s, planetId);
  let att = 0;
  for (const cu of s.cargo) att += (UNITS[cu.unit].atk + UNITS[cu.unit].def * 0.3) * (cu.hp / cu.maxHp) * 0.5;
  // warships overhead support the landing
  for (const w of G.space.ships) {
    if (w.owner !== attacker || w === s) continue;
    const p = planetPos(planetId);
    if ((w.x - p.x) ** 2 + (w.y - p.y) ** 2 + (w.z - p.z) ** 2 < (PLANET_NEAR * 2) ** 2) att += UNITS[w.unit].atk * 0.25;
  }
  att *= typeof milDmgMult === "function" ? milDmgMult(G.countries[attacker]) : 1;   // SU2 §13
  const defv = Math.max(25, colonyDefence(planetId)) * (typeof milArmMult === "function" ? milArmMult(G.countries[defender]) : 1);
  const ratio = att / defv;
  const A = G.countries[attacker], D = G.countries[defender];
  spaceBoom(planetPos(planetId), planetDef(planetId).r + 8, "invade");
  if (ratio > 1) {
    const survive = clamp(1 - 0.6 / ratio, 0.2, 0.92);
    st.colony.owner = attacker;
    st.colony.garrison = s.cargo.map(cu => ({ unit: cu.unit, hp: Math.max(1, cu.hp * survive), maxHp: cu.maxHp }));
    s.cargo = [];
    if (st.halo && st.halo.done) st.halo.owner = attacker; // the ring falls with the colony
    D.morale = clamp(D.morale - 6, 0, 100);
    A.morale = clamp(A.morale + 3, 0, 100);
    log(`🪐 ${A.name} storms the colony on ${def.n} and takes it from ${D.name}!`, attacker === G.playerId ? "good" : "war");
    if (defender === G.playerId) toast(`🪐 Your colony on ${def.n} has fallen to ${A.name}!`);
    sfx(attacker === G.playerId ? "capture" : "captureFar");
    // Final Alien Update Parts 4+7: taking an alien CAPITAL fells the civilization
    const recD = alienById(defender);
    if (recD) {
      alienNoteLoss(defender, attacker);
      if (!recD.defeated && recD.capital === planetId) {
        alienCapitalSpoils(recD, attacker);
        alienDefeated(recD, attacker, "conquered");
      }
    }
    // Alien War AI Fix §7: a conquest wipes the slate of failed attempts here
    const recW = alienById(attacker);
    if (recW && recW.invFail) delete recW.invFail[planetId];
  } else {
    const hurt = clamp(ratio * 0.6, 0.1, 0.85);
    for (const g of st.colony.garrison) g.hp = Math.max(1, g.hp * (1 - hurt));
    s.cargo = [];
    A.morale = clamp(A.morale - 4, 0, 100);
    // Alien War AI Fix §7: a repulsed landing is REMEMBERED — repeated
    // failures against the same world are what later justify the superweapon
    const recA = alienById(attacker);
    if (recA) { recA.invFail = recA.invFail || {}; recA.invFail[planetId] = (recA.invFail[planetId] || 0) + 1; }
    log(`🛡 The landing on ${def.n} is thrown back — ${D.name}'s garrison holds.`, defender === G.playerId ? "good" : "sys");
    if (attacker === G.playerId) toast(`🛡 Invasion of ${def.n} repelled — the landing force was lost.`);
  }
  spacePanelDirty = true;
  return true;
}

// ============ Final Alien Update Part 8 — real-time colony ground battles ============
// The battle lives in G.space.battles (so it saves, loads and rides multiplayer
// snapshots), is simulated by tickPlanetBattles (host-side in multiplayer) and
// merely WATCHED through the #pbattle window (pbRender below). Outcome comes
// from troops, unit strength, static defences, reinforcements and terrain.
function battleOn(planetId) {
  return G && G.space && G.space.battles ? (G.space.battles.find(b => b.planet === planetId && !b.done) || null) : null;
}
// stats for battle combatants — real units plus the colony's static defences
function pbStat(u) {
  if (u.turret) return { atk: u.tAtk || 12, def: 20, rng: 68, cd: 1.7, spd: 0, melee: 0 };
  const d = UNITS[u.unit] || UNITS.spearman;
  return { atk: d.atk, def: d.def, rng: d.melee ? 12 : Math.max(24, Math.min(80, (d.rng || 20) * 0.55)), cd: d.cd || 1.3, spd: (d.spd || 26) * 0.14, melee: d.melee };
}
// terrain shapes the fight: garrisons dig into hostile ground more easily
function pbTerrainDef(type) {
  return { lava: 1.15, ice: 1.1, dark: 1.08, gas: 0.95, rock: 1.0 }[type] || 1.0;
}
function startPlanetBattle(s, planetId) {
  const st = planetState(planetId), def = planetDef(planetId);
  const defender = st.colony.owner, attacker = s.owner;
  const running = battleOn(planetId);
  if (running) {
    // a second wave joins an existing assault on the same side
    if (running.att === attacker) {
      const n = pbBoard(running, s, 0);
      if (attacker === G.playerId && n) toast(`👾 ${n} unit${n > 1 ? "s" : ""} drop into the battle for ${def.n}!`);
      return n > 0;
    }
    if (attacker === G.playerId) toast("A battle already rages on that world.");
    return false;
  }
  // Part 7 step 2: the defending fleet must be cleared from orbit first
  const p = planetPos(planetId);
  const R = planetNearR(def) * 1.5;
  const guard = G.space.ships.find(t => t.owner === defender && (UNITS[t.unit].atk || 0) >= 60 &&
    (t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2 < R * R);
  if (guard) {
    if (attacker === G.playerId) toast(`🛡 ${G.countries[defender].name}'s fleet still holds orbit over ${def.n} — defeat it before landing troops.`);
    return false;
  }
  const b = {
    id: G.space.battleSeq++, planet: planetId, att: attacker, def: defender,
    units: [], fires: [], t: 0, ret: 0, done: 0, winner: null, endT: 0,
    uSeq: 1, supCd: PBATTLE.supportCd, rfCd: 0,
  };
  pbBoard(b, s, 0);
  // the defenders: the whole garrison mans the line…
  for (const g of st.colony.garrison) {
    b.units.push({ id: b.uSeq++, side: 1, unit: g.unit, hp: g.hp, maxHp: g.maxHp,
      x: rnd(PBATTLE.W * 0.58, PBATTLE.W * 0.8), y: rnd(18, PBATTLE.H - 14), cd: rnd(0, 1) });
  }
  st.colony.garrison = []; // …and is won or lost with the battle
  // …plus the colony's static defences (level + a completed Halo Ring)
  const turrets = st.colony.lvl + (st.halo && st.halo.done ? 2 : 0);
  for (let i = 0; i < turrets; i++) {
    b.units.push({ id: b.uSeq++, side: 1, unit: "turret", turret: 1, tAtk: 9 + 4 * st.colony.lvl,
      hp: 60 + 26 * st.colony.lvl, maxHp: 60 + 26 * st.colony.lvl,
      x: rnd(PBATTLE.W * 0.84, PBATTLE.W * 0.95),
      y: 22 + (i * (PBATTLE.H - 44)) / Math.max(1, turrets - 1), cd: rnd(0, 1.5) });
  }
  G.space.battles.push(b);
  const A = G.countries[attacker], D = G.countries[defender];
  const recD = alienById(defender);
  const isCap = recD && !recD.defeated && recD.capital === planetId;
  log(`⚔ ${A.name} lands assault troops on ${def.n}${isCap ? " — THE ALIEN CAPITAL" : ""} — the battle for the surface begins!`, attacker === G.playerId || defender === G.playerId ? "war" : "sys");
  if (attacker === G.playerId) { toast(`⚔ Landing on ${def.n} — the ground battle has begun.`); sfx("warhorn"); }
  if (defender === G.playerId) { toast(`⚔ ${A.name} is landing troops on your colony ${def.n}!`); sfx("warhorn"); }
  spacePanelDirty = true;
  return true;
}
// move troops from a ship's bays into the battle line (side 0 = attacker, 1 = defender)
function pbBoard(b, s, side) {
  let n = 0;
  while ((s.cargo || []).length) {
    const cu = s.cargo.pop();
    b.units.push({ id: b.uSeq++, side, unit: cu.unit, hp: cu.hp, maxHp: cu.maxHp,
      x: side === 0 ? rnd(8, 34) : rnd(PBATTLE.W * 0.58, PBATTLE.W * 0.8),
      y: rnd(16, PBATTLE.H - 14), cd: rnd(0.5, 1.5), drop: 1.2 });
    n++;
  }
  return n;
}
function pbKill(b, u, st) {
  u.hp = 0;
  if (u.gone) return; // evacuated, not killed
  // the surface burns where the fighting is fiercest (fires spread over time)
  if (b.fires.length < 40 && Math.random() < 0.8) {
    b.fires.push({ x: u.x + rnd(-5, 5), y: Math.min(PBATTLE.H - 6, u.y + rnd(-2, 6)), r: rnd(3, 6) + Math.min(4, b.t * 0.04), s: rnd(0, 1) });
  }
  // seen from space, the planet visibly darkens under war smoke
  if (st) st.warSmoke = clamp((st.warSmoke || 0) + 0.12, 0, 1);
}
function tickPlanetBattles(dt) {
  if (!G.space || !G.space.battles || !G.space.battles.length) return;
  for (const b of G.space.battles.slice()) {
    if (b.done) {
      b.endT += dt;
      if (b.endT > 8) G.space.battles.splice(G.space.battles.indexOf(b), 1);
      continue;
    }
    const st = G.space.planets[b.planet];
    const def = planetDef(b.planet);
    // the world itself may have died under the fighting (Star Destroyer fire)
    if (!st || st.destroyed || !st.colony || !def) {
      b.done = 1; b.winner = null; b.endT = 5;
      log(`⚔ The battle on ${def ? def.n : "a lost world"} ends — the battlefield itself is gone.`, "sys");
      continue;
    }
    b.t += dt;
    // BUG REPORT Final Fixes: no battle continues forever — an assault that has
    // achieved nothing after ten minutes breaks off and streams back to the
    // drop zone (the retreat path then ends the battle cleanly)
    if (!b.ret && b.t > 600) b.ret = 1;
    const terr = pbTerrainDef(def.type);
    const A = G.countries[b.att], D = G.countries[b.def];
    const milA = typeof milDmgMult === "function" && A ? milDmgMult(A) : 1;
    const milD = typeof milDmgMult === "function" && D ? milDmgMult(D) : 1;
    const armA = typeof milArmMult === "function" && A ? milArmMult(A) : 1;
    const armD = typeof milArmMult === "function" && D ? milArmMult(D) : 1;
    // -------- reinforcements drop from orbit (either side's transports) --------
    b.rfCd -= dt;
    if (b.rfCd <= 0) {
      b.rfCd = PBATTLE.reinforceCd;
      const p = planetPos(b.planet);
      const R2 = planetNearR(def) ** 2;
      const boat = G.space.ships.find(t => (t.cargo || []).length &&
        (t.owner === b.att ? !b.ret : t.owner === b.def) &&
        (t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2 <= R2);
      if (boat) {
        const side = boat.owner === b.att ? 0 : 1;
        const cu = boat.cargo.pop();
        b.units.push({ id: b.uSeq++, side, unit: cu.unit, hp: cu.hp, maxHp: cu.maxHp,
          x: side === 0 ? rnd(8, 34) : rnd(PBATTLE.W * 0.55, PBATTLE.W * 0.8),
          y: rnd(16, PBATTLE.H - 14), cd: 1, drop: 1.2 });
      }
    }
    // -------- orbital fire support for the attacker (a Giant Shield blocks it) --------
    b.supCd -= dt;
    if (b.supCd <= 0) {
      b.supCd = PBATTLE.supportCd;
      b.sup = null;
      if (!(st.shield && st.shield.hp > 0)) {
        const p = planetPos(b.planet);
        const R2 = (planetNearR(def) * 1.4) ** 2;
        const gun = G.space.ships.find(t => t.owner === b.att && (UNITS[t.unit].atk || 0) >= 60 &&
          (t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2 <= R2);
        const targets = b.units.filter(u => u.side === 1 && u.hp > 0);
        if (gun && targets.length) {
          const v = pick(targets);
          v.hp -= PBATTLE.supportDmg;
          b.sup = { x: v.x, y: v.y, t: 0.7 };
          if (v.hp <= 0) pbKill(b, v, st);
        }
      }
    }
    if (b.sup && (b.sup.t -= dt) <= 0) b.sup = null;
    // -------- the line itself --------
    const alive0 = [], alive1 = [];
    for (const u of b.units) if (u.hp > 0) (u.side === 0 ? alive0 : alive1).push(u);
    if (!alive1.length || !alive0.length) {
      if (!alive1.length && alive0.length) pbConquer(b, st);
      else pbRepelled(b, st, alive1);
      continue;
    }
    // an AI attacker breaks off when mauled (Part 1: retreat when losses are high)
    if (!b.ret && !isHumanControlled(b.att)) {
      const hp0 = alive0.reduce((s2, u) => s2 + u.hp, 0);
      const max0 = b.units.filter(u => u.side === 0).reduce((s2, u) => s2 + u.maxHp, 0);
      if (max0 > 0 && hp0 / max0 < PBATTLE.retreatAt) b.ret = 1;
    }
    for (const u of b.units) {
      if (u.hp <= 0) continue;
      if (u.drop > 0) { u.drop -= dt; continue; } // still descending in the pod
      const S2 = pbStat(u);
      const foes2 = u.side === 0 ? alive1 : alive0;
      // ordered retreat: attackers stream back to the drop zone and lift off
      if (b.ret && u.side === 0) {
        u.x -= Math.max(2.5, S2.spd) * dt * 9;
        if (u.x <= 5) {
          b.evacUnits = b.evacUnits || [];
          b.evacUnits.push({ unit: u.unit, hp: Math.max(1, u.hp), maxHp: u.maxHp });
          u.gone = 1; u.hp = 0;
        }
        continue;
      }
      let tgt = null, bd = Infinity;
      for (const f of foes2) { const d2 = (f.x - u.x) ** 2 + (f.y - u.y) ** 2; if (d2 < bd) { bd = d2; tgt = f; } }
      if (!tgt) continue;
      const dist = Math.sqrt(bd) || 1;
      if (dist > S2.rng && !u.turret) {
        // advance in a loose, weaving line — dashes between cover
        u.wob = (u.wob === undefined ? u.id * 1.7 : u.wob) + dt * 3;
        u.x += ((tgt.x - u.x) / dist + Math.sin(u.wob) * 0.35) * S2.spd * dt * 9;
        u.y += ((tgt.y - u.y) / dist + Math.cos(u.wob * 0.8) * 0.35) * S2.spd * dt * 9;
        u.x = clamp(u.x, 4, PBATTLE.W - 4);
        u.y = clamp(u.y, 8, PBATTLE.H - 6);
      }
      u.cd = (u.cd || 0) - dt;
      if (u.cd <= 0 && dist <= S2.rng * 1.06) {
        u.cd = S2.cd * rnd(0.85, 1.25);
        const TS = pbStat(tgt);
        let dmg = S2.atk * PBATTLE.dmg * rnd(0.8, 1.2) * (u.side === 0 ? milA : milD);
        const armorMult = tgt.side === 0 ? armA : armD * terr; // dug-in defenders
        dmg *= 100 / (100 + TS.def * armorMult * 1.1);
        tgt.hp -= dmg;
        if (tgt.hp <= 0) pbKill(b, tgt, st);
      }
    }
    // fires creep outward while the battle rages
    for (const f of b.fires) f.r = Math.min(14, f.r + dt * 0.12);
  }
}
// attacker victory: the colony changes hands; a capital brings down its civilization
function pbConquer(b, st) {
  const def = planetDef(b.planet);
  const A = G.countries[b.att], D = G.countries[b.def];
  const recD = alienById(b.def);
  const wasCapital = recD && !recD.defeated && recD.capital === b.planet;
  st.colony.owner = b.att;
  st.colony.garrison = b.units.filter(u => u.side === 0 && u.hp > 0 && !u.turret)
    .map(u => ({ unit: u.unit, hp: Math.max(1, u.hp), maxHp: u.maxHp }));
  if (st.halo && st.halo.done) st.halo.owner = b.att; // the ring falls with the colony
  if (st.shield) st.shield.owner = b.att;
  if (D) D.morale = clamp(D.morale - 6, 0, 100);
  if (A) A.morale = clamp(A.morale + 3, 0, 100);
  b.done = 1; b.winner = b.att;
  if (recD) alienNoteLoss(b.def, b.att);
  // Alien War AI Fix §7: a conquest wipes the attacker's failed-invasion slate
  const recAtt = alienById(b.att);
  if (recAtt && recAtt.invFail) delete recAtt.invFail[b.planet];
  if (wasCapital) {
    // Part 7: the exact promised words, then the spoils, then the collapse
    alienCapitalSpoils(recD, b.att);
    alienDefeated(recD, b.att, "conquered");
  } else {
    log(`🪐 ${A.name} storms the colony on ${def.n} and takes it from ${D ? D.name : "?"}!`, b.att === G.playerId ? "good" : "war");
  }
  if (b.def === G.playerId) toast(`🪐 Your colony on ${def.n} has fallen to ${A.name}!`);
  sfx(b.att === G.playerId ? "capture" : "captureFar");
  spacePanelDirty = true;
}
// defender victory: the garrison stands down; evacuated attackers reach orbit
function pbRepelled(b, st, defAlive) {
  const def = planetDef(b.planet);
  const A = G.countries[b.att], D = G.countries[b.def];
  st.colony.garrison = (defAlive || []).filter(u => !u.turret).map(u => ({ unit: u.unit, hp: Math.max(1, u.hp), maxHp: u.maxHp }));
  let back = 0;
  if (b.evacUnits && b.evacUnits.length) {
    const p = planetPos(b.planet);
    const R2 = (planetNearR(def) * 1.5) ** 2;
    const boat = G.space.ships.find(t => t.owner === b.att && UNITS[t.unit].cap &&
      (t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2 <= R2);
    if (boat) {
      boat.cargo = boat.cargo || [];
      const cap = UNITS[boat.unit].cap;
      while (b.evacUnits.length && boat.cargo.length < cap) { boat.cargo.push(b.evacUnits.shift()); back++; }
    }
  }
  if (A) A.morale = clamp(A.morale - 4, 0, 100);
  // Alien War AI Fix §7: an alien attacker remembers being thrown back here
  const recA = alienById(b.att);
  if (recA) { recA.invFail = recA.invFail || {}; recA.invFail[b.planet] = (recA.invFail[b.planet] || 0) + 1; }
  b.done = 1; b.winner = b.def;
  log(`🛡 The landing on ${def.n} is thrown back — ${D ? D.name : "?"}'s garrison holds.${back ? ` ${back} attacker${back > 1 ? "s" : ""} evacuated to orbit.` : ""}`, b.def === G.playerId ? "good" : "sys");
  if (b.att === G.playerId) toast(`🛡 The invasion of ${def.n} has failed${back ? ` — ${back} unit${back > 1 ? "s" : ""} made it back to orbit` : " — the landing force was lost"}.`);
  spacePanelDirty = true;
}

// ---------------- megastructures ----------------
function dysonStageCost() { return MEGA_DEFS.dyson.cost; }
// ============ Final Space Fixes §2-5 — Dyson Spheres around ANY secured star ============
// The home sphere keeps living in G.space.dyson (saves, snapshots and a decade
// of references); every other star's sphere lives in G.space.systems[sys].dyson
// (the slot alien spheres always used). dysonAt() is the one accessor that sees
// both — including a stage-0 sphere still under construction.
function dysonAt(sysId) {
  if (!G || !G.space) return null;
  if (sysId === "home") return G.space.dyson || null;
  const st = G.space.systems && G.space.systems[sysId];
  return st && st.dyson ? st.dyson : null;
}
// §3: aliens actively CONTROL the system while a living alien civilization
// holds a colony (or its own sphere) there. Passing fleets never block.
function hostileAlienControl(sysId, cid) {
  cid = Number(cid);
  for (const d of SPACE_PLANETS) {
    if (planetSysId(d) !== sysId) continue;
    const pst = G.space.planets[d.id];
    if (!pst || pst.destroyed || !pst.colony) continue;
    const o = Number(pst.colony.owner);
    if (o !== cid && G.countries[o] && G.countries[o].alien && G.countries[o].alive) return true;
  }
  const dy = dysonAt(sysId);
  if (dy && Number(dy.owner) !== cid && G.countries[dy.owner] && G.countries[dy.owner].alien && G.countries[dy.owner].alive) return true;
  return false;
}
// §2: a colony in the system proves construction access. The homeland is the
// standing exception for map nations — their provinces on the Homeworld ARE
// their presence there (aliens and rebels still need a real colony).
function dysonControl(cid, sysId) {
  cid = Number(cid);
  const c = G.countries[cid];
  if (sysId === "home" && c && !c.alien && !c.rebel) return true;
  return SPACE_PLANETS.some(d => planetSysId(d) === sysId && G.space.planets[d.id] &&
    !G.space.planets[d.id].destroyed && G.space.planets[d.id].colony &&
    Number(G.space.planets[d.id].colony.owner) === cid);
}
// THE construction rulebook — the star panel, payDysonStage, the AI and the
// aliens all ask this one function. Resources are checked at pay time.
function canBuildDyson(cid, sysId) {
  cid = Number(cid);
  const c = G.countries[cid];
  const d = MEGA_DEFS.dyson;
  const deny = why => { spDbg(`Dyson blocked (${c ? c.name : cid} → ${sysId}): ${why}`); return { ok: false, why }; };
  if (!c || !c.alive) return deny("no such civilization");
  // era-9 aliens carry the technology innately, like their starting spheres
  const innate = c.alien && (c.era || 0) >= 9;
  if (!innate && !c.researched[d.tech]) return deny("Requires the ☀ Dyson Sphere technology.");
  const stS = sysState(sysId);
  if (stS.nova) return deny("Nothing remains of that star.");
  if (sunDead(sysId)) return deny("That star is a dead cinder — a sphere would wrap nothing.");
  const dy = dysonAt(sysId);
  if (dy && Number(dy.owner) !== cid) return deny(`${G.countries[dy.owner] ? G.countries[dy.owner].name : "Another power"} already builds around this star.`);
  if (dy && dy.building) return deny("A construction stage is already underway.");
  if (dy && dy.stage >= d.stages) return deny("The Dyson Sphere around this star is complete.");
  if (!dysonControl(cid, sysId)) return deny("Dyson Sphere unavailable: found a colony in this system first — it proves construction access.");
  if (hostileAlienControl(sysId, cid)) return deny("Dyson Sphere unavailable: hostile alien forces still control this solar system.");
  return { ok: true };
}
function payDysonStage(cid, sysId) {
  ensureSpaceState();
  sysId = sysId || "home"; // older callers (and old multiplayer clients) mean the home star
  const c = G.countries[cid];
  const d = MEGA_DEFS.dyson;
  if (!c) return false;
  const chk = canBuildDyson(cid, sysId);
  if (!chk.ok) { if (cid === G.playerId && chk.why) toast(chk.why); return false; }
  const free = cid === G.playerId && sbFree(cid);
  const cost = free ? { money: 0, mat: 0 } : d.cost;
  if (c.res.money < cost.money || c.res.mat < cost.mat) {
    if (cid === G.playerId) toast(`Stage cost: ${cost.money}💰 and ${cost.mat}⛏.`);
    return false;
  }
  c.res.money -= cost.money; c.res.mat -= cost.mat;
  let dy = dysonAt(sysId);
  if (!dy) {
    dy = { owner: Number(cid), stage: 0, prog: 0, building: true };
    if (sysId === "home") G.space.dyson = dy;
    else sysState(sysId).dyson = dy;
  } else { dy.building = true; dy.prog = 0; }
  log(`☀ ${c.name} begins stage ${dy.stage + 1} of a Dyson Sphere around ${systemDef(sysId).n}.`, Number(cid) === G.playerId ? "good" : "sys");
  spacePanelDirty = true;
  return true;
}
function startHalo(cid, planetId) {
  const st = planetState(planetId), def = planetDef(planetId);
  const c = G.countries[cid];
  const h = MEGA_DEFS.halo;
  if (!c.researched[h.tech]) { if (cid === G.playerId) toast("Requires the Halo Rings technology."); return false; }
  if (!st.colony || st.colony.owner !== Number(cid) || st.destroyed) { if (cid === G.playerId) toast("Halo Rings are raised above your own colonies."); return false; }
  if (st.halo) { if (cid === G.playerId) toast("A ring already circles this world."); return false; }
  const free = cid === G.playerId && sbFree(cid);
  const cost = free ? { money: 0, mat: 0 } : h.cost;
  if (c.res.money < cost.money || c.res.mat < cost.mat) {
    if (cid === G.playerId) toast(`A Halo Ring needs ${cost.money}💰 and ${cost.mat}⛏.`);
    return false;
  }
  c.res.money -= cost.money; c.res.mat -= cost.mat;
  st.halo = { owner: Number(cid), prog: 0, need: h.ticks, done: false };
  log(`⭕ ${c.name} begins a Halo Ring over ${def.n}.`, Number(cid) === G.playerId ? "good" : "sys");
  spacePanelDirty = true;
  return true;
}

// ============ AI Update §13 — VOID SHIELDS ============
// A per-system barrier megastructure (G.space.systems[sys].voidShield). While
// the generator stands: alien fleets cannot enter the system, alien
// colonization there is impossible and alien invasions cannot land (§13.1/13.3).
// Homeland (map) nations pass freely — §13.2. Aliens break in by destroying
// the generator, which is a legitimate war target for fleets and Star
// Destroyer fire alike. One rulebook (canBuildVoidShield) serves the player,
// the AI and multiplayer.
function voidShieldAt(sysId) {
  const st = G.space && G.space.systems && G.space.systems[sysId];
  return st && st.voidShield ? st.voidShield : null;
}
function voidShieldActive(sysId) {
  const vs = voidShieldAt(sysId);
  return !!(vs && !vs.building && vs.hp > 0);
}
// how far out the barrier reaches: past the outermost orbit of the system
function voidShieldRadius(sysId) {
  const sys = systemDef(sysId);
  let r = (sys.r || 40) + 220;
  for (const d of SPACE_PLANETS) if (planetSysId(d) === sysId) r = Math.max(r, d.dist + 90);
  return r;
}
// does the barrier stop THIS civilization? (aliens only, never the owner)
function voidShieldBlocks(sysId, cid) {
  const vs = voidShieldAt(sysId);
  if (!vs || vs.building || vs.hp <= 0) return false;
  const c = G.countries[cid];
  if (!c || !c.alien) return false;               // §13.2: homeland civs are never blocked
  return Number(vs.owner) !== Number(cid);
}
function canBuildVoidShield(cid, sysId) {
  cid = Number(cid);
  const c = G.countries[cid];
  const deny = why => { spDbg(`Void Shield blocked (${c ? c.name : cid} → ${sysId}): ${why}`); return { ok: false, why }; };
  if (!c || !c.alive) return deny("no such civilization");
  if (c.alien || c.rebel) return deny("Only planetary nations raise Void Shields.");
  if (!c.researched[VOID_SHIELD.tech]) return deny("Requires the 🌐 Void Shields technology.");
  const stS = sysState(sysId);
  if (stS.nova) return deny("Nothing remains to protect in that system.");
  if (voidShieldAt(sysId)) return deny("A Void Shield already guards this system.");
  if (!dysonControl(cid, sysId)) return deny("Void Shield unavailable: found a colony in this system first — it proves construction access.");
  if (hostileAlienControl(sysId, cid)) return deny("Void Shield unavailable: hostile alien forces still control this solar system.");
  return { ok: true };
}
function payVoidShield(cid, sysId) {
  ensureSpaceState();
  const c = G.countries[cid];
  const chk = canBuildVoidShield(cid, sysId);
  if (!chk.ok) { if (Number(cid) === G.playerId && chk.why) toast(chk.why); return false; }
  const free = Number(cid) === G.playerId && sbFree(cid);
  const cost = free ? { money: 0, mat: 0, energy: 0 } : VOID_SHIELD.cost;
  if (c.res.money < cost.money || c.res.mat < cost.mat || c.res.energy < (cost.energy || 0)) {
    if (Number(cid) === G.playerId) toast(`A Void Shield needs ${VOID_SHIELD.cost.money}💰 ${VOID_SHIELD.cost.mat}⛏ ${VOID_SHIELD.cost.energy}⚡.`);
    return false;
  }
  c.res.money -= cost.money; c.res.mat -= cost.mat; c.res.energy = Math.max(0, c.res.energy - (cost.energy || 0));
  sysState(sysId).voidShield = { owner: Number(cid), hp: VOID_SHIELD.hp, maxHp: VOID_SHIELD.hp, building: true, prog: 0, need: VOID_SHIELD.ticks };
  log(`🌐 ${c.name} begins raising a VOID SHIELD around the ${systemDef(sysId).n} system.`, Number(cid) === G.playerId ? "good" : "sys");
  spacePanelDirty = true;
  return true;
}
function repairVoidShield(cid, sysId) {
  const vs = voidShieldAt(sysId);
  const c = G.countries[cid];
  if (!vs || Number(vs.owner) !== Number(cid) || vs.building) return false;
  if (vs.hp >= vs.maxHp) { if (Number(cid) === G.playerId) toast("The Void Shield is at full strength."); return false; }
  const free = Number(cid) === G.playerId && sbFree(cid);
  const cost = free ? { money: 0, mat: 0 } : { money: Math.round(VOID_SHIELD.cost.money * VOID_SHIELD.repairFrac), mat: Math.round(VOID_SHIELD.cost.mat * VOID_SHIELD.repairFrac) };
  if (c.res.money < cost.money || c.res.mat < cost.mat) {
    if (Number(cid) === G.playerId) toast(`Repairs need ${cost.money}💰 ${cost.mat}⛏.`);
    return false;
  }
  c.res.money -= cost.money; c.res.mat -= cost.mat;
  vs.hp = vs.maxHp;
  if (Number(cid) === G.playerId) { toast("🌐 Void Shield restored to full strength."); sfx("coin"); }
  spacePanelDirty = true;
  return true;
}
function damageVoidShield(sysId, dmg, byId) {
  const vs = voidShieldAt(sysId);
  if (!vs) return false;
  vs.hp -= dmg;
  if (vs.hp <= 0) { destroyVoidShield(sysId, byId); return true; }
  spacePanelDirty = true;
  return false;
}
function destroyVoidShield(sysId, byId) {
  const vs = voidShieldAt(sysId);
  if (!vs) return;
  const sys = systemDef(sysId);
  sysState(sysId).voidShield = null;
  spaceBoom({ x: sys.x, y: 0, z: sys.z }, (sys.r || 40) * 1.8, "invade");
  sfx("nukeBoom");
  log(`🌐 The VOID SHIELD around ${sys.n} COLLAPSES${G.countries[byId] ? ` under ${G.countries[byId].name}'s fire` : ""} — the system lies open.`, "war");
  if (vs.owner === G.playerId) toast(`🌐 Your Void Shield around ${sys.n} has been destroyed!`);
  spacePanelDirty = true;
}
// a warship ordered against the generator: close on the barrier's edge, then
// batter it down (the alien path into a shielded system — §13.3)
function shipAttackVoidShield(s, dt) {
  const vs = voidShieldAt(s.vsTarget);
  if (!vs || vs.hp <= 0 || vs.building || !atWar(s.owner, vs.owner)) { s.vsTarget = null; return; }
  const sys = systemDef(s.vsTarget);
  const R = voidShieldRadius(s.vsTarget);
  const dx = s.x - sys.x, dz = s.z - sys.z;
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  if (d > R + 150) { // close on a stand-off point just outside the barrier
    if (!s.free) s.free = { x: sys.x + dx / d * (R + 60), y: 0, z: sys.z + dz / d * (R + 60) };
    return;
  }
  s.cd = (s.cd || 0) - dt;
  if (s.cd > 0) return;
  const u = UNITS[s.unit];
  s.cd = u.atk >= 1000 ? 3.0 : 1.6;
  const dmg = u.atk * 0.5 * (s.stack || 1) * (typeof milDmgMult === "function" ? milDmgMult(G.countries[s.owner]) : 1);
  if (spaceFx.length < 200) spaceFx.push({ kind: "laser", x1: s.x, y1: s.y, z1: s.z, x2: sys.x, y2: 0, z2: sys.z, ttl: 0.18, max: 0.18, big: u.atk >= 1000 });
  if (spaceOpen && (s.owner === G.playerId || vs.owner === G.playerId)) sfx("beam");
  if (damageVoidShield(s.vsTarget, dmg, s.owner)) s.vsTarget = null;
}
// the Star Destroyer's core cannon against the generator — massive damage
function sdStrikeVoidShield(s, sysId) {
  const vs = voidShieldAt(sysId);
  if (!vs || !isSD(s)) return false;
  if (Number(vs.owner) === s.owner) { if (s.owner === G.playerId) toast("That is your own Void Shield."); return false; }
  const sys = systemDef(sysId);
  if ((s.x - sys.x) ** 2 + (s.z - sys.z) ** 2 > (voidShieldRadius(sysId) + 200) ** 2) {
    if (s.owner === G.playerId) toast("Close on the barrier first.");
    return false;
  }
  if (!paySDLaser(s)) return false;
  sdDeclareWarIfNeeded(s.owner, vs.owner);
  spaceLaserFx(s, { x: sys.x, y: 0, z: sys.z }, true);
  sfx("rail");
  log(`🌠 ${G.countries[s.owner].name}'s core cannon hammers the Void Shield around ${sys.n}!`, "war");
  damageVoidShield(sysId, SD_LASER.dmg * 2, s.owner);
  return true;
}

// ---------------- the planet killer (Space Update Parts 1-2) ----------------
// The Star Destroyer's core cannon now costs a fortune to fire (money,
// materials, energy), runs a very long cooldown, can target ANY secondary
// planet (colonized or empty), can crack enemy Dyson Spheres, and can scorch
// — but never destroy — the Homeworld. Giant Shields absorb the beam first.
function isSD(s) { return !!(s && UNITS[s.unit] && UNITS[s.unit].atk >= 1000); }
function sdLaserStatus(s) {
  const C = G.countries[s.owner];
  const free = s.owner === G.playerId && sbFree(s.owner);
  const cd = s.novaCd || 0;
  const cost = free ? { money: 0, mat: 0, energy: 0 } : SD_LASER;
  const afford = C.res.money >= cost.money && C.res.mat >= cost.mat && C.res.energy >= cost.energy;
  return { cd, cost, afford, ready: cd <= 0 && afford };
}
function paySDLaser(s) {
  const st = sdLaserStatus(s);
  if (st.cd > 0) { if (s.owner === G.playerId) toast(`⌛ Core cannon recharging — ready in ${st.cd} tick${st.cd > 1 ? "s" : ""}.`); return false; }
  if (!st.afford) { if (s.owner === G.playerId) toast(`Firing needs ${st.cost.money}💰 ${st.cost.mat}⛏ ${st.cost.energy}⚡.`); return false; }
  const C = G.countries[s.owner];
  C.res.money -= st.cost.money; C.res.mat -= st.cost.mat; C.res.energy = Math.max(0, C.res.energy - st.cost.energy);
  s.novaCd = SD_LASER.cd;
  return true;
}
// a Giant Shield eats the shot; returns true when the beam was absorbed
function shieldAbsorbs(shield, pos, r) {
  if (!shield || shield.hp <= 0) return false;
  shield.hp -= SD_LASER.dmg;
  spaceBoom(pos, (r || 20) + 14, "shield");
  if (shield.hp <= 0) {
    shield.hp = 0;
    log(`🛡 A Giant Shield COLLAPSES under Star Destroyer fire!`, "war");
  } else {
    log(`🛡 A Giant Shield absorbs the planet-killing beam (${fmtShield(shield)} charge left).`, "sys");
  }
  spacePanelDirty = true;
  return true;
}
function fmtShield(sh) { return Math.max(0, Math.round(100 * sh.hp / sh.maxHp)) + "%"; }
function sdDeclareWarIfNeeded(attId, victimId) {
  if (victimId === null || victimId === undefined || victimId === attId) return;
  if (!G.countries[victimId] || !G.countries[victimId].alive) return;
  if (!atWar(attId, victimId)) declareWar(attId, victimId);
}
// Part 11 — when a planet is blown apart, EVERY spacecraft close to it dies in
// the shockwave, whoever owns it. Only the firing Star Destroyer, holding at
// the beam's safe stand-off, survives. Ships far enough away are untouched.
function planetBlastVictims(s, planetId) {
  const def = planetDef(planetId);
  const p = planetPos(planetId);
  const R = PLANET_BLAST_R + (def ? def.r : 0);
  const ships = (G.space && G.space.ships ? G.space.ships : []).filter(t => t !== s &&
    (t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2 <= R * R);
  return { R, ships, friendly: ships.filter(t => t.owner === s.owner).length };
}

function canDestroyPlanet(s, planetId) {
  const def = planetDef(planetId), st = planetState(planetId);
  if (!isSD(s)) return { ok: false };
  if (!def) return { ok: false };
  if (def.type === "main") return { ok: false, why: "The Homeworld cannot be completely destroyed — but it can be bombarded." };
  if (st.destroyed) return { ok: false, why: "Only debris remains of that world." };
  const ls = sdLaserStatus(s);
  if (ls.cd > 0) return { ok: false, why: `Core cannon recharging — ${ls.cd} tick${ls.cd > 1 ? "s" : ""} left.` };
  if (!ls.afford) return { ok: false, why: `Firing needs ${ls.cost.money}💰 ${ls.cost.mat}⛏ ${ls.cost.energy}⚡.` };
  return { ok: true };
}
function destroyPlanet(s, planetId) {
  const def = planetDef(planetId), st = planetState(planetId);
  const chk = canDestroyPlanet(s, planetId);
  if (!chk.ok) { if (s.owner === G.playerId && chk.why) toast(chk.why); return false; }
  const victim = st.colony ? st.colony.owner : null;
  if (!paySDLaser(s)) return false;
  const A = G.countries[s.owner];
  sdDeclareWarIfNeeded(s.owner, victim); // firing on a foreign colony means war
  const p = planetPos(planetId);
  // a Giant Shield takes the hit instead of the planet
  if (st.shield && shieldAbsorbs(st.shield, p, def.r)) {
    spaceLaserFx(s, p, true);
    sfx("rail");
    return true;
  }
  st.destroyed = true;
  st.colony = null;
  st.halo = null;
  st.shield = null;
  st.rehab = null;
  for (const c2 of Object.keys(G.countries)) {
    if (G.countries[c2].spaceCapital === planetId) G.countries[c2].spaceCapital = null;
  }
  spaceLaserFx(s, p, true);
  spaceShatter(p, def);
  sfx("nukeBoom");
  log(`🌠 ${A.name}'s Star Destroyer ANNIHILATES ${def.n}. The world watches in horror.`, "war");
  if (victim === G.playerId) toast(`🌠 ${def.n} — and your colony — has been destroyed by ${A.name}!`);
  // Final Alien Update Parts 4+9: destroying an alien CAPITAL fells the civilization
  if (victim !== null) alienNoteLoss(victim, s.owner);
  alienCapitalFalls(planetId, s.owner, "destroyed");
  // Part 11: the shockwave — every ship in the blast radius dies, any flag
  const blast = planetBlastVictims(s, planetId);
  if (blast.ships.length) {
    const byOwner = {};
    let mineLost = 0;
    for (const t of blast.ships.slice()) {
      byOwner[t.owner] = (byOwner[t.owner] || 0) + 1;
      if (t.owner === G.playerId) mineLost++;
      spaceBoom(t, 16, "ship");
      if (t.cargo && t.cargo.length) log(`💥 A ${UNITS[t.unit].n} dies in the shockwave with ${t.cargo.length} unit${t.cargo.length > 1 ? "s" : ""} aboard.`, t.owner === G.playerId ? "bad" : "sys");
      const O = G.countries[t.owner];
      if (O) O.morale = clamp(O.morale - 1.5, 0, 100);
      removeShip(t);
    }
    const names = Object.keys(byOwner).map(o => `${G.countries[o] ? G.countries[o].name : "?"} ×${byOwner[o]}`).join(", ");
    log(`💥 The death of ${def.n} vaporises ${blast.ships.length} spacecraft caught in the shockwave (${names}).`, "war");
    if (mineLost) toast(`💥 ${mineLost} of your spacecraft ${mineLost > 1 ? "were" : "was"} destroyed by the planetary shockwave!`);
  }
  // extreme diplomatic penalties, worse than a nuclear strike
  for (const oid of Object.keys(G.countries)) {
    const o = Number(oid);
    if (o === s.owner || !G.countries[o].alive) continue;
    G.rel[o][s.owner] = clamp(G.rel[o][s.owner] - (o === victim ? 60 : 35), -100, 100);
    G.trust[o][s.owner] = clamp(G.trust[o][s.owner] - (o === victim ? 40 : 25), 0, 100);
  }
  A.stability = clamp(A.stability - 10, 0, 100);
  // BUG REPORT morale fix: murdering an inhabited world horrifies the
  // destroyer's own people as well — morale falls, never rises
  if (victim !== null) A.morale = clamp(A.morale - 8, 0, 100);
  if (victim !== null && victim !== s.owner && G.countries[victim]) {
    const D = G.countries[victim];
    D.morale = clamp(D.morale - 15, 0, 100);
  }
  spacePanelDirty = true;
  return true;
}
// Part 2 — bombard the Homeworld: it survives, but its surface burns.
function bombardHomeworld(s) {
  if (!isSD(s)) return false;
  const st = planetState("home");
  if (st.scorched) { if (s.owner === G.playerId) toast("The Homeworld is already in flames."); return false; }
  if (!paySDLaser(s)) return false;
  const A = G.countries[s.owner];
  const p = planetPos("home");
  if (st.shield && shieldAbsorbs(st.shield, p, planetDef("home").r)) {
    spaceLaserFx(s, p, true);
    sfx("rail");
    return true;
  }
  st.scorched = true;
  spaceLaserFx(s, p, true);
  spaceBoom(p, planetDef("home").r + 16, "invade");
  sfx("nukeBoom");
  // every military unit on the surface dies — the attacker's own included
  // (BUG REPORT morale fix: noGlory — this massacre must not rally anyone)
  const killed = G.armies.length;
  for (const a of G.armies.slice()) {
    if (typeof killArmy === "function") killArmy(a, s.owner, true);
  }
  // every city building burns; construction sites collapse
  for (const cid of Object.keys(G.countries)) {
    const c = G.countries[cid];
    if (isSynthetic(c)) continue;
    for (const p2 of c.provinces) { p2.b = {}; p2.bq = []; p2.rq = []; }
    c.morale = clamp(c.morale - 25, 0, 100);
    c.stability = clamp(c.stability - 15, 0, 100);
    c.pop = Math.max(0.3, c.pop * 0.7);
    // the whole world turns on the perpetrator
    const o = Number(cid);
    if (o !== s.owner && c.alive) {
      G.rel[o][s.owner] = clamp(G.rel[o][s.owner] - 80, -100, 100);
      G.trust[o][s.owner] = 0;
    }
  }
  A.stability = clamp(A.stability - 20, 0, 100);
  log(`🔥 ${A.name}'s Star Destroyer SCORCHES THE HOMEWORLD — ${killed} armies burn, every city lies in ruins. The surface is fire.`, "war");
  toast(`🔥 THE HOMEWORLD BURNS. Nothing can live or build on the surface until a ♻ Rehabilitator restores it.`);
  if (typeof cityLayerDirty !== "undefined") cityLayerDirty = true;
  if (typeof mapOwnershipChanged === "function") mapOwnershipChanged();
  spacePanelDirty = true;
  return true;
}
// Part 1 — Dyson Spheres can be attacked and destroyed
function attackDyson(s, sysId) {
  const dy = dysonOfSystem(sysId);
  if (!dy || !isSD(s)) return false;
  if (dy.owner === s.owner) { if (s.owner === G.playerId) toast("That is your own Dyson Sphere."); return false; }
  if (!paySDLaser(s)) return false;
  sdDeclareWarIfNeeded(s.owner, dy.owner);
  const sys = systemDef(sysId);
  const pos = { x: sys.x, y: 0, z: sys.z };
  if (dy.shield && shieldAbsorbs(dy.shield, pos, sys.r)) {
    spaceLaserFx(s, pos, true);
    sfx("rail");
    return true;
  }
  destroyDyson(sysId, s.owner);
  spaceLaserFx(s, pos, true);
  return true;
}
// Update §13: the core cannon can hammer the Harvester — massive damage, the
// shield soaks it first, and it NEVER one-shots. The black hole is untouched.
function sdStrikeHarvester(s) {
  const bhH = G.space.bhH, bh = galaxyBH();
  if (!bhH || bhH.ruins || !isSD(s) || !bh) return false;
  if (bhH.owner === s.owner) { if (s.owner === G.playerId) toast("That is your own Harvester."); return false; }
  if (!shipNearBH(s)) { if (s.owner === G.playerId) toast("Close on the black hole first."); return false; }
  if (!paySDLaser(s)) return false;
  sdDeclareWarIfNeeded(s.owner, bhH.owner);
  const pos = { x: bh.x, y: 0, z: bh.z };
  spaceLaserFx(s, pos, true);
  spaceBoom(pos, 40, "invade");
  sfx("rail");
  bhHarvesterHit(SD_LASER.dmg * 1.5, s.owner);
  log(`🌠 ${G.countries[s.owner].name}'s core cannon hammers the ${BH_HARVESTER.n}!`, "war");
  return true;
}

// ============ Small Update — stellar harvesting & the Omni Laser ============
// A sun can be Harvested exactly STELLAR_HARVEST.max times. Each harvest is a
// slow, visible energy transfer that leaves the star permanently dimmer and
// stores one solar-system-destroying charge aboard the Star Destroyer. The
// third harvest collapses the sun. One charge fires one Omni-Hypercharged
// Orbital Laser Strike: the target system dies, a permanent nebula remains,
// and debris rains across the galaxy for a while afterwards.
function sysState(sysId) {
  ensureSpaceState();
  return G.space.systems[sysId] || (G.space.systems[sysId] = { revealed: false });
}
function sysHarvestsLeft(sysId) {
  const st = sysState(sysId);
  return Math.max(0, STELLAR_HARVEST.max - (st.harvests || 0));
}
// dead = collapsed by the third harvest OR erased by the Omni Laser (nova)
function sunDead(sysId) {
  const st = G.space && G.space.systems && G.space.systems[sysId];
  return !!(st && (st.dead || st.nova));
}
// Update §1: the four clearly distinct sun states. A Dead Sun is NOT a
// destroyed system — the star went out, but its worlds remain in the dark.
function sysLightState(sysId) {
  const st = (G.space && G.space.systems && G.space.systems[sysId]) || {};
  if (st.nova) return "nova";           // Completely Destroyed Solar System
  if (st.dead) return "dead";           // Dead Sun
  if (st.harvests > 0) return "dimmed"; // Partially Harvested Sun
  return "active";                      // Active Sun
}

// ---------------- Update §5-16: the galactic core ----------------
function galaxyBH() { return G && G.space && G.space.gen ? G.space.gen.bh : null; }
function shipNearBH(s) {
  const bh = galaxyBH();
  if (!bh) return false;
  return (s.x - bh.x) ** 2 + (s.y || 0) ** 2 + (s.z - bh.z) ** 2 <= BH_HARVESTER.nearR * BH_HARVESTER.nearR;
}
// every hit on the Harvester funnels through here: the great shield soaks it
// first, construction crews shelter (§9 pause), and only exhausted hull ends it
function bhHarvesterHit(dmg, byId) {
  const bhH = G.space.bhH;
  if (!bhH || bhH.ruins) return;
  if (bhH.shield && bhH.shield.hp > 0) {
    bhH.shield.hp -= dmg;
    if (bhH.shield.hp <= 0) { bhH.shield.hp = 0; log(`🛡 The Harvester's great shield COLLAPSES!`, "war"); }
    spacePanelDirty = true;
    return;
  }
  bhH.hp -= dmg;
  if (bhH.building && !bhH.paused) {
    bhH.paused = true; // §9: progress holds — construction can resume later
    log(`🚧 Construction of the ${BH_HARVESTER.n} is interrupted by enemy fire — the crews shelter, progress is kept.`, bhH.owner === G.playerId ? "bad" : "sys");
    if (bhH.owner === G.playerId) toast("🚧 Harvester construction paused under fire — resume it when the area is safe.");
  }
  if (bhH.hp <= 0) destroyBHHarvester(byId);
  spacePanelDirty = true;
}
function destroyBHHarvester(byId) {
  const bhH = G.space.bhH, bh = galaxyBH();
  if (!bhH || bhH.ruins) return;
  const O = G.countries[bhH.owner];
  bhH.ruins = true; bhH.hp = 0; bhH.shield = null; bhH.building = false; bhH.paused = false; bhH.connected = null; bhH.cd = 0;
  if (bh) spaceBoom({ x: bh.x, y: 0, z: bh.z }, 90, "invade");
  sfx("nukeBoom");
  // §14: ruins remain; the site is open — the black hole itself is untouched
  log(`🕳 THE ${BH_HARVESTER.n.toUpperCase()} IS DESTROYED${G.countries[byId] ? ` by ${G.countries[byId].name}` : ""} — its ruins drift around the untouched black hole. The site lies open to whoever builds next.`, "war");
  if (bhH.owner === G.playerId) toast("🕳 Your Black Hole Energy Harvester has been destroyed!");
  if (O) O.morale = clamp(O.morale - 8, 0, 100);
  spacePanelDirty = true;
}
// §8-9: staged, enormous, vulnerable construction — no territorial control
// needed, but (Critical Bug-Fix Update §1) PHYSICAL PRESENCE is: construction
// can only be started while one of the civilization's spaceships holds at the
// black hole — the same rule for the player, AI countries, aliens and
// multiplayer clients, because everyone funds stages through this function.
function bhShipPresent(cid) {
  ensureSpaceState();
  cid = Number(cid);
  return (G.space.ships || []).some(s => Number(s.owner) === cid && s.hp > 0 && shipNearBH(s));
}
function startBHStage(cid, silent) {
  ensureSpaceState();
  const c = G.countries[cid];
  const B = BH_HARVESTER;
  if (!c) return false;
  if (c.era < 9) { if (!silent && cid === G.playerId) toast("The Harvester awaits the Megastructure Era."); return false; }
  if (!c.researched[B.tech]) { if (!silent && cid === G.playerId) toast("Requires the 🕳 Black Hole Energy Harvesting technology (after Dyson Sphere and Halo Ring)."); return false; }
  if (!bhShipPresent(cid)) {
    spDbg(`Harvester blocked: no owned spaceship near black hole (${c.name})`);
    if (!silent && cid === G.playerId) toast("A spaceship must reach the black hole before construction can begin.");
    return false;
  }
  let bhH = G.space.bhH;
  if (bhH && !bhH.ruins && bhH.owner !== Number(cid)) {
    if (!silent && cid === G.playerId) toast(`${G.countries[bhH.owner] ? G.countries[bhH.owner].name : "Another power"} already builds around the black hole — only one Harvester may exist.`);
    return false;
  }
  if (bhH && !bhH.ruins && bhH.stage >= B.stages) { if (!silent && cid === G.playerId) toast("The Harvester is complete."); return false; }
  if (bhH && !bhH.ruins && bhH.building) { if (!silent && cid === G.playerId) toast(bhH.paused ? "Construction is paused — resume it instead." : "A construction stage is already underway."); return false; }
  const free = cid === G.playerId && sbFree(cid);
  const cost = free ? { money: 0, mat: 0, energy: 0 } : B.cost;
  if (c.res.money < cost.money || c.res.mat < cost.mat || c.res.energy < cost.energy) {
    if (!silent && cid === G.playerId) toast(`A construction stage needs ${B.cost.money}💰 ${B.cost.mat}⛏ ${B.cost.energy}⚡.`);
    return false;
  }
  c.res.money -= cost.money; c.res.mat -= cost.mat; c.res.energy = Math.max(0, c.res.energy - cost.energy);
  if (!bhH || bhH.ruins) {
    G.space.bhH = bhH = { owner: Number(cid), stage: 0, prog: 0, building: true, paused: false,
      hp: B.hp, maxHp: B.hp, shield: null, cd: 0, share: false, connected: null, ruins: false };
    log(`🕳 ${c.name} begins the ${B.n} around the galactic core — stage 1 of ${B.stages}.`, Number(cid) === G.playerId ? "good" : "sys");
  } else {
    bhH.building = true; bhH.prog = 0; bhH.paused = false;
    log(`🕳 ${c.name} funds stage ${bhH.stage + 1} of ${B.stages} of the ${B.n}.`, Number(cid) === G.playerId ? "good" : "sys");
  }
  spacePanelDirty = true;
  return true;
}
function resumeBH(cid, silent) {
  const bhH = G.space.bhH;
  if (!bhH || bhH.ruins || bhH.owner !== Number(cid) || !bhH.building || !bhH.paused) return false;
  bhH.paused = false;
  log(`🚧 Construction of the ${BH_HARVESTER.n} resumes.`, Number(cid) === G.playerId ? "good" : "sys");
  spacePanelDirty = true;
  return true;
}
function bhToggleShare(cid) {
  const bhH = G.space.bhH;
  if (!bhH || bhH.ruins || bhH.owner !== Number(cid)) return false;
  bhH.share = !bhH.share;
  log(bhH.share ? `🤝 ${G.countries[cid].name} opens its Harvester to allied Star Destroyers.` : `🤝 ${G.countries[cid].name} closes its Harvester to allies.`, "sys");
  spacePanelDirty = true;
  return true;
}
// §10-11: infinite charging under strict cooldowns — the black hole never weakens
function canBHCharge(s) {
  const bhH = G.space.bhH;
  if (!isSD(s)) return { ok: false, why: "Only a Star Destroyer can take a black-hole charge." };
  const C = G.countries[s.owner];
  if (!C || C.era < 9) return { ok: false, why: "Needs the Megastructure Era." };
  if (!C.researched.doomdevice) return { ok: false, why: "Requires the ☠ DOOM Device technology." };
  if (!bhH || bhH.ruins || bhH.stage < BH_HARVESTER.stages) return { ok: false, why: "No completed Black Hole Energy Harvester circles the black hole." };
  if (bhH.owner !== s.owner && !(bhH.share && typeof allied === "function" && allied(bhH.owner, s.owner))) {
    return { ok: false, why: `Only ${G.countries[bhH.owner] ? G.countries[bhH.owner].name : "its owner"}${bhH.share ? " and its allies" : ""} may draw from the Harvester.` };
  }
  if (bhH.connected) return { ok: false, why: "Another Star Destroyer is already connected." };
  if (bhH.cd > 0) return { ok: false, why: `The Harvester's charge cycle is cooling — ${bhH.cd} tick${bhH.cd > 1 ? "s" : ""} left.` };
  if (s.harvestCd > 0) return { ok: false, why: `The ship's harvest systems are recharging — ${s.harvestCd} tick${s.harvestCd > 1 ? "s" : ""}.` };
  if (s.harvest) return { ok: false, why: "A harvest is already in progress." };
  if (!shipNearBH(s)) return { ok: false, why: "Hold the ship beside the Harvester first." };
  return { ok: true };
}
function startBHCharge(s) {
  const chk = canBHCharge(s);
  if (!chk.ok) { if (s.owner === G.playerId && chk.why) toast(chk.why); return false; }
  s.harvest = { bh: 1, prog: 0, need: BH_HARVESTER.chargeTime };
  s.target = null; s.free = null; s.chase = null; s.orbit = null;
  G.space.bhH.connected = s.id;
  log(`🕳 ${G.countries[s.owner].name}'s Star Destroyer connects to the Harvester — black-hole energy pours into the weapon.`, s.owner === G.playerId ? "good" : "war");
  if (s.owner === G.playerId) sfx("beam");
  spacePanelDirty = true;
  return true;
}
function finishBHCharge(s) {
  const bhH = G.space.bhH;
  s.harvest = null;
  s.omniCharges = (s.omniCharges || 0) + 1;
  s.harvestCd = BH_HARVESTER.shipCd;         // §11: the ship's own harvest cooldown
  if (bhH) { bhH.cd = BH_HARVESTER.chargeCd; bhH.connected = null; } // …and the shared one
  // the black hole itself is NEVER weakened — no counter, no dimming, ever
  log(`⚡ Black-hole charge complete — the Star Destroyer stores ${s.omniCharges} charge${s.omniCharges === 1 ? "" : "s"}. The black hole is unweakened.`, s.owner === G.playerId ? "good" : "sys");
  if (s.owner === G.playerId) { toast(`⚡ Omni-Laser charge secured from the black hole (${s.omniCharges} stored).`); sfx("era"); }
  spacePanelDirty = true;
}
// §6/§20: how the core's alien presence answers a completed Harvester
function bhAliensReact() {
  for (const rec of G.space.aliens || []) {
    if (rec.defeated) continue;
    if (rec.bhGuard) { rec.bhAlert = true; rec.posture = "defensive"; } // more alert, not at war
    // fearful or careful civilizations may vanish behind Phantom Step
    if ((rec.per === "peaceful" || rec.per === "cautious") && Math.random() < 0.5) {
      activatePhantom(rec.aid, rec.sys, true);
    }
  }
}

// ---------------- Update §17-21: Phantom Step ----------------
function phantomActive(sysId) {
  const st = G.space && G.space.systems && G.space.systems[sysId];
  return !!(st && st.phantom);
}
// is this SYSTEM hidden from this viewer? (war does NOT reveal the system —
// only military activity; ships are handled separately below)
function phantomHiddenFrom(sysId, viewer) {
  const st = G.space && G.space.systems && G.space.systems[sysId];
  return !!(st && st.phantom && st.phantom.owner !== Number(viewer));
}
// §18.1-18.2: a cloaked civilization's ships INSIDE its cloaked system are
// unseen — but leaving the system exposes them, and war exposes them anywhere
function phantomShipHiddenFrom(s, viewer) {
  if (s.owner === Number(viewer)) return false;
  const sysId = systemAt(s.x, s.z).id;
  const st = G.space && G.space.systems && G.space.systems[sysId];
  if (!st || !st.phantom || st.phantom.owner !== s.owner) return false;
  return !atWar(Number(viewer), s.owner);
}
function hasDeepResearcher(cid) {
  return (G.space && G.space.researchers || []).some(r => r.owner === Number(cid) && !r.destroyed && r.deep);
}
// ============ BUG REPORT (Critical Bug-Fix Update §4) — Phantom Step controller ============
// THE single source of truth for Phantom Step. The station console, the star
// panel, the AI, the aliens and the multiplayer handler all ask these three
// functions — no other code decides availability or flips the cloak.
// Requirements: researched tech + a FULLY BUILT Dyson Sphere + a Deep Space
// Research Station (era-9 aliens carry all three innately). Cycle: 50 turns
// active, 25 turns cooldown, ticked in tickPhantom(), stored in plain state
// (G.space.systems[sys].phantom + country.phantomCdUntil) so saves, loads and
// multiplayer snapshots carry it unchanged.
function phantomFullDyson(cid) {
  cid = Number(cid);
  if (!G || !G.space) return false;
  const full = dy => !!(dy && Number(dy.owner) === cid && dy.stage >= MEGA_DEFS.dyson.stages);
  if (full(G.space.dyson)) return true;
  for (const sysId of Object.keys(G.space.systems || {})) {
    if (full((G.space.systems[sysId] || {}).dyson)) return true;
  }
  return false;
}
// systems this civilization could cloak right now: it holds a colony there, or
// its Deep Space Research Station is stationed there. Never the shared home
// system, never a destroyed system, never one already cloaked.
function phantomEligibleSystems(cid) {
  cid = Number(cid);
  ensureSpaceState();
  const out = [];
  const consider = sid => {
    if (!sid || out.includes(sid)) return;
    const s3 = G.space.systems[sid] || {};
    if (s3.nova || s3.phantom) return;
    out.push(sid);
  };
  // Final Space Fixes §1: the HOMELAND system is a legal Phantom Step target.
  // A map nation's provinces on the Homeworld ARE its presence there; aliens
  // and rebels still qualify only through a real colony or station in a system.
  const c = G.countries[cid];
  if (c && c.alive && !c.alien && !c.rebel) consider("home");
  for (const d of SPACE_PLANETS) {
    const pst = G.space.planets[d.id];
    if (pst && !pst.destroyed && pst.colony && Number(pst.colony.owner) === cid) consider(planetSysId(d));
  }
  for (const r of G.space.researchers || []) {
    if (Number(r.owner) === cid && !r.destroyed && r.deep) consider(systemAt(r.x, r.z).id);
  }
  return out;
}
// the ONE availability readout — {researched, dyson, station, cdLeft, activeSys,
// activeLeft, ready, why}. "ready" means the next activation only needs a target.
function phantomStatus(cid) {
  cid = Number(cid);
  const c = G && G.countries ? G.countries[cid] : null;
  const alien = typeof alienById === "function" && !!alienById(cid);
  const st = { alien, researched: false, dyson: false, station: false,
    cdLeft: 0, activeSys: null, activeLeft: 0, ready: false, why: "no such civilization" };
  if (!c || !c.alive) return st;
  const innate = alien && (c.era || 0) >= 9; // hyper-advanced aliens
  st.researched = innate || (!alien && !!c.researched[PHANTOM.tech]);
  st.dyson = innate || (!alien && phantomFullDyson(cid));
  st.station = innate || (!alien && hasDeepResearcher(cid));
  st.cdLeft = Math.max(0, (c.phantomCdUntil || 0) - G.turn);
  if (c.phantomSys && G.space && G.space.systems[c.phantomSys] && G.space.systems[c.phantomSys].phantom &&
      Number(G.space.systems[c.phantomSys].phantom.owner) === cid) {
    st.activeSys = c.phantomSys;
    st.activeLeft = Math.max(0, G.space.systems[c.phantomSys].phantom.until - G.turn);
  }
  st.why = !st.researched ? "the 🌫 Phantom Step technology is not researched"
    : !st.dyson ? "a fully built ☀ Dyson Sphere is required"
    : !st.station ? "Deep Space Research Station required"
    : st.activeSys ? "a Phantom Step field is already active"
    : st.cdLeft > 0 ? `cooldown — ${st.cdLeft} turn${st.cdLeft > 1 ? "s" : ""} left`
    : null;
  st.ready = !st.why;
  if (st.why) spDbg(`Phantom Step blocked (${c.name}): ${st.why}`);
  return st;
}
// §18.3.3: the Researcher's Deep Space upgrade — gate for USING Phantom Step
// and the only instrument that can DETECT or DISRUPT it
function upgradeResearcherDeep(cid, rid, silent) {
  const r = researcherById(rid);
  const c = G.countries[cid];
  if (!r || r.owner !== Number(cid) || r.destroyed || r.deep) return false;
  if (r.lvl < PHANTOM.deepLvl) { if (!silent && cid === G.playerId) toast(`The Deep Space upgrade needs a level-${PHANTOM.deepLvl} Researcher.`); return false; }
  const free = cid === G.playerId && sbFree(cid);
  const cost = free ? { money: 0, mat: 0 } : PHANTOM.deepCost;
  if (c.res.money < cost.money || c.res.mat < cost.mat) {
    if (!silent && cid === G.playerId) toast(`The upgrade needs ${PHANTOM.deepCost.money}💰 ${PHANTOM.deepCost.mat}⛏.`);
    return false;
  }
  c.res.money -= cost.money; c.res.mat -= cost.mat;
  r.deep = true;
  log(`🔭 ${c.name}'s Researcher becomes a DEEP SPACE RESEARCH STATION — the fabric of the void is readable now.`, Number(cid) === G.playerId ? "good" : "sys");
  spacePanelDirty = true;
  return true;
}
// §17+§19: activate the cloak — strict 50-turn field, then a 25-turn cooldown.
// Rewritten (Critical Bug-Fix Update §4): every gate now comes from the
// controller above, so the console, the AI, the aliens and multiplayer can
// never disagree about what is allowed.
function activatePhantom(cid, sysId, silent) {
  ensureSpaceState();
  cid = Number(cid);
  const c = G.countries[cid];
  if (!c || !c.alive) return false;
  const say = m => { if (!silent && cid === G.playerId) toast(m); spDbg(`Phantom Step blocked (${c.name} → ${sysId}): ${m}`); return false; };
  const st = phantomStatus(cid);
  if (!st.researched) return say("Phantom Step must be researched first (🌫 Phantom Step, Megastructure Era).");
  if (!st.dyson) return say("Phantom Step needs a fully built ☀ Dyson Sphere feeding it.");
  if (!st.station) return say("Phantom Step needs a 🌆 Researcher completed as a 🔭 Deep Space Research Station.");
  if (st.activeSys) return say(`Your Phantom Step field already cloaks the ${systemDef(st.activeSys).n} system.`);
  if (st.cdLeft > 0) return say(`Phantom Step is on cooldown — ${st.cdLeft} turn${st.cdLeft > 1 ? "s" : ""} left.`);
  const sys = systemDef(sysId);
  const stS = sysState(sysId);
  // Final Space Fixes §1: the homeland system cloaks like any other system now
  if (stS.nova) return say("There is nothing left there to hide.");
  if (stS.phantom) return say("A Phantom Step field already cloaks that system.");
  if (!phantomEligibleSystems(cid).includes(sysId)) {
    return say("Phantom Step can only cloak a system where you hold a colony or a Deep Space Research Station.");
  }
  if (!st.alien) {
    const free = cid === G.playerId && sbFree(cid);
    const cost = free ? { money: 0, energy: 0 } : PHANTOM.cost;
    if (c.res.money < cost.money || c.res.energy < cost.energy) {
      return say(`Activation needs ${PHANTOM.cost.money}💰 ${PHANTOM.cost.energy}⚡.`);
    }
    c.res.money -= cost.money; c.res.energy = Math.max(0, c.res.energy - cost.energy);
  }
  stS.phantom = { owner: cid, until: G.turn + PHANTOM.active };
  c.phantomSys = sysId;
  spDbg(`Phantom Step ACTIVE (${c.name}): ${sysId} cloaked until turn ${stS.phantom.until}`);
  log(`🌫 ${c.name} activates PHANTOM STEP — the ${sys.n} system fades from the galaxy's eyes (${PHANTOM.active} turns).`, cid === G.playerId ? "good" : "sys");
  if (cid === G.playerId) { toast(`🌫 The ${sys.n} system is cloaked for ${PHANTOM.active} turns.`); sfx("era"); }
  spacePanelDirty = true;
  return true;
}
// §19.2-19.3: the automatic shutdown — EVERYTHING ends at once, then cooldown
function tickPhantom() {
  if (!G.space || !G.space.systems) return;
  for (const sysId of Object.keys(G.space.systems)) {
    const stS = G.space.systems[sysId];
    const ph = stS.phantom;
    if (!ph) continue;
    const c = G.countries[ph.owner];
    const alien = typeof alienById === "function" && !!alienById(ph.owner);
    // §18.3 + Critical Bug-Fix §4: the field needs BOTH its instruments alive —
    // lose the Deep Space Research Station or the full Dyson Sphere and it falls
    const lost = !c || !c.alive || (!alien && !(hasDeepResearcher(ph.owner) && phantomFullDyson(ph.owner)));
    if (G.turn >= ph.until || lost) {
      delete stS.phantom; // full shutdown — no lingering state of any kind
      if (c) { c.phantomCdUntil = G.turn + PHANTOM.cooldown; c.phantomSys = null; }
      log(`🌫 The Phantom Step field over ${systemDef(sysId).n} collapses — the system snaps back onto the galaxy map${lost ? "" : ` (cooldown ${PHANTOM.cooldown} turns)`}.`, "sys");
      spacePanelDirty = true;
    }
  }
}
// §18.3.4: the Deep Space Research Station's disruption sweep
function deepScanPhantom(cid, rid, silent) {
  const r = researcherById(rid);
  const c = G.countries[cid];
  if (!r || r.owner !== Number(cid) || r.destroyed || !r.deep) return false;
  if (r.cd > 0) { if (!silent && cid === G.playerId) toast(`🔭 The deep array is recharging — ${r.cd} tick${r.cd > 1 ? "s" : ""} left.`); return false; }
  const free = cid === G.playerId && sbFree(cid);
  const cost = free ? { money: 0, energy: 0 } : PHANTOM.scanCost;
  if (c.res.money < cost.money || c.res.energy < cost.energy) {
    if (!silent && cid === G.playerId) toast(`The sweep needs ${PHANTOM.scanCost.money}💰 ${PHANTOM.scanCost.energy}⚡.`);
    return false;
  }
  c.res.money -= cost.money; c.res.energy = Math.max(0, c.res.energy - cost.energy);
  r.cd = PHANTOM.scanCd;
  const targets = Object.keys(G.space.systems).filter(id => {
    const ph = G.space.systems[id].phantom;
    return ph && ph.owner !== Number(cid);
  });
  if (!targets.length) {
    log(`🔭 ${c.name}'s deep sweep finds no Phantom Step signatures anywhere in the galaxy.`, "sys");
    if (Number(cid) === G.playerId) toast("🔭 No Phantom Step signatures detected.");
    return true;
  }
  let broken = 0;
  for (const id of targets) {
    if (Math.random() < PHANTOM.scanChance) { // 25% per hidden system
      const ph = G.space.systems[id].phantom;
      const o = G.countries[ph.owner];
      delete G.space.systems[id].phantom;
      if (o) { o.phantomCdUntil = G.turn + PHANTOM.cooldown; o.phantomSys = null; }
      broken++;
      log(`🔭 DEEP SCAN BREAKTHROUGH — the Phantom Step field over ${systemDef(id).n} is DISRUPTED! The system snaps back onto the galaxy map.`, "sys");
      if (Number(cid) === G.playerId) sfx("era");
    }
  }
  if (!broken) {
    log(`🔭 ${c.name}'s deep sweep brushes faint phase signatures — but fails to disrupt them.`, "sys");
    if (Number(cid) === G.playerId) toast("🔭 Faint signatures detected… the disruption failed.");
  } else if (Number(cid) === G.playerId) toast(`🔭 ${broken} Phantom Step field${broken > 1 ? "s" : ""} disrupted!`);
  spacePanelDirty = true;
  return true;
}
function shipNearStar(s, sysId) {
  const sys = systemDef(sysId);
  return (s.x - sys.x) ** 2 + (s.y || 0) ** 2 + (s.z - sys.z) ** 2 <= STELLAR_HARVEST.rng * STELLAR_HARVEST.rng;
}
function canHarvestStar(s, sysId) {
  if (!isSD(s)) return { ok: false, why: "Only a Star Destroyer can harvest a sun." };
  const C = G.countries[s.owner];
  if (!C || C.era < 9) return { ok: false, why: "Stellar harvesting needs the Megastructure Era." };
  // AI Update §17: era-9 aliens carry the technology innately (like their spheres)
  const innate = C.alien && (C.era || 0) >= 9;
  if (!innate && !C.researched.doomdevice) return { ok: false, why: "Requires the ☠ DOOM Device technology — the era's hardest research." };
  if (s.harvestCd > 0) return { ok: false, why: `The ship's harvest systems are recharging — ${s.harvestCd} tick${s.harvestCd > 1 ? "s" : ""}.` };
  const st = sysState(sysId);
  if (st.nova) return { ok: false, why: "Only a nebula remains where that sun once burned." };
  if (st.dead) return { ok: false, why: "That star is a dead cinder — there is nothing left to harvest." };
  if (sysHarvestsLeft(sysId) <= 0) return { ok: false, why: "That sun has nothing left to give." };
  if (s.harvest) return { ok: false, why: "A harvest is already in progress." };
  if (!shipNearStar(s, sysId)) return { ok: false, why: "The ship must hold close beside the sun to harvest it." };
  return { ok: true };
}
function startStellarHarvest(s, sysId) {
  const chk = canHarvestStar(s, sysId);
  if (!chk.ok) { if (s.owner === G.playerId && chk.why) toast(chk.why); return false; }
  const sys = systemDef(sysId);
  s.harvest = { sys: sysId, prog: 0, need: STELLAR_HARVEST.time };
  s.target = null; s.free = null; s.chase = null; s.orbit = null; // hold station by the star
  log(`🌞 ${G.countries[s.owner].name}'s Star Destroyer begins to Harvest Stellar Energy from ${sys.n}.`, s.owner === G.playerId ? "good" : "war");
  if (s.owner === G.playerId) { toast(`🌞 Harvesting stellar energy from ${sys.n} — the sun dims as the weapon charges.`); sfx("beam"); }
  spacePanelDirty = true;
  return true;
}
// real-time progress (called from spaceTick): the transfer takes time, is
// clearly visible (beam + dimming sun) and aborts if the ship drifts away
function tickStellarHarvests(dt) {
  if (!G.space || !G.space.ships) return;
  for (const s of G.space.ships) {
    if (!s.harvest) continue;
    // Update §10: black-hole charging shares the machinery but never drains a sun
    if (s.harvest.bh) {
      const bhH = G.space.bhH;
      if (!bhH || bhH.ruins || bhH.stage < BH_HARVESTER.stages || s.hp <= 0 || !shipNearBH(s)) {
        if (s.owner === G.playerId) toast("🕳 The black-hole charge is interrupted.");
        if (bhH && bhH.connected === s.id) bhH.connected = null;
        s.harvest = null; spacePanelDirty = true; continue;
      }
      s.harvest.prog += dt;
      if (s.harvest.prog >= s.harvest.need) finishBHCharge(s);
      continue;
    }
    const st = sysState(s.harvest.sys);
    if (st.dead || st.nova || s.hp <= 0 || !shipNearStar(s, s.harvest.sys)) {
      if (s.owner === G.playerId) toast("🌞 The stellar harvest is interrupted — the beam collapses.");
      s.harvest = null; spacePanelDirty = true; continue;
    }
    s.harvest.prog += dt;
    if (s.harvest.prog >= s.harvest.need) finishStellarHarvest(s);
  }
}
function finishStellarHarvest(s) {
  const sysId = s.harvest.sys, sys = systemDef(sysId), st = sysState(sysId);
  s.harvest = null;
  st.harvests = (st.harvests || 0) + 1;
  s.omniCharges = (s.omniCharges || 0) + 1;
  s.harvestCd = BH_HARVESTER.shipCd; // Update §11: the ship's own harvest cooldown
  const left = sysHarvestsLeft(sysId);
  if (st.harvests >= STELLAR_HARVEST.max) {
    // the third harvest strips the last energy — the sun collapses, forever
    st.dead = true;
    spaceBoom({ x: sys.x, y: 0, z: sys.z }, sys.r * 2.2, "invade");
    sfx("nukeBoom");
    log(`🌑 ${sys.n} GOES DARK — the final harvest strips the sun's last energy and the star collapses. It will never shine again.`, "war");
    if (dysonOfSystem(sysId) || (sysId === "home" && G.space.dyson)) {
      log(`☀ The Dyson Sphere around ${sys.n} now wraps a cold cinder — its output is gone with the star.`, "war");
    }
    // BUG REPORT (Critical Bug-Fix Update §5): the system economy falls with
    // the star — every planet here now produces at 20% of normal (the Dead Sun
    // Production Multiplier is applied inside colonyProduction, the halo/pop
    // paths and the Homeworld's map economy, so the very next economic tick
    // credits the reduced amounts; the colonies still cannot grow or build)
    spDbg(`Dead Sun multiplier applied: ${sys.n} system output × ${DEAD_SUN.prodMult}`);
    const frozen = {};
    for (const d of SPACE_PLANETS) {
      if (planetSysId(d) !== sysId) continue;
      const pst = G.space.planets[d.id];
      if (pst && !pst.destroyed && pst.colony) frozen[pst.colony.owner] = (frozen[pst.colony.owner] || 0) + 1;
    }
    for (const oid of Object.keys(frozen)) {
      const O = G.countries[oid];
      if (!O) continue;
      log(`🌑 ${O.name}'s ${frozen[oid]} colon${frozen[oid] > 1 ? "ies" : "y"} in the ${sys.n} system freeze in the dark — production there falls to ${Math.round(DEAD_SUN.prodMult * 100)}% of normal.`, Number(oid) === G.playerId ? "bad" : "sys");
      if (Number(oid) === G.playerId) toast(`🌑 Your colonies in the ${sys.n} system have gone dark — production there drops by ${Math.round((1 - DEAD_SUN.prodMult) * 100)}%.`);
    }
    if (sysId === "home") {
      log(`🌑 The homeland itself falls into the dark — every city, farm, mine and lab on the Homeworld drops to ${Math.round(DEAD_SUN.prodMult * 100)}% output.`, "war");
    }
  } else {
    log(`🌞 Harvest complete — ${sys.n} burns dimmer. Stellar Harvests Remaining: ${left}/${STELLAR_HARVEST.max}.`, s.owner === G.playerId ? "good" : "sys");
  }
  if (s.owner === G.playerId) { toast(`⚡ Stellar charge secured (${s.omniCharges} stored)${left ? "" : " — the sun is spent"}.`); sfx("era"); }
  spacePanelDirty = true;
}
// ---- the Omni-Hypercharged Orbital Laser Strike ----
function omniStatus(s) {
  const C = G.countries[s.owner];
  const free = s.owner === G.playerId && sbFree(s.owner);
  const cost = free ? { money: 0, mat: 0, energy: 0 } : OMNI_LASER;
  const afford = !!C && C.res.money >= cost.money && C.res.mat >= cost.mat && C.res.energy >= cost.energy;
  return { charges: s.omniCharges || 0, cd: s.omniCd || 0, cost, afford,
    ready: (s.omniCharges || 0) > 0 && (s.omniCd || 0) <= 0 && afford && !s.harvest };
}
function canOmniStrike(s, sysId) {
  if (!isSD(s)) return { ok: false, why: "Only a completed Star Destroyer mounts the Omni Laser." };
  const C = G.countries[s.owner];
  if (!C || C.era < 9) return { ok: false, why: "The Omni-Hypercharged Orbital Laser Strike needs the Megastructure Era." };
  // AI Update §17: era-9 aliens fire the solar-system weapon innately
  const innate = C.alien && (C.era || 0) >= 9;
  if (!innate && !C.researched.doomdevice) return { ok: false, why: "Firing requires the ☠ DOOM Device technology." };
  if (s.harvest) return { ok: false, why: "The weapon cannot fire while harvesting energy." };
  const os = omniStatus(s);
  if (!os.charges) return { ok: false, why: "No stellar charge aboard — Harvest Stellar Energy from a sun first." };
  if (os.cd > 0) return { ok: false, why: `The Omni Laser is recharging — ${os.cd} tick${os.cd > 1 ? "s" : ""} left.` };
  if (!os.afford) return { ok: false, why: `Firing needs ${os.cost.money}💰 ${os.cost.mat}⛏ ${os.cost.energy}⚡ on top of the charge.` };
  const st = sysState(sysId);
  if (st.nova) return { ok: false, why: "That solar system has already been destroyed." };
  // the revealed flag is the PLAYER's star chart — alien dominions read their own
  if (!C.alien && !systemRevealed(sysId)) return { ok: false, why: "The target system is uncharted." };
  return { ok: true };
}
// everything the oversized blast will catch — feeds the warning AND the shot
function omniBlastPlan(s, sysId) {
  const sys = systemDef(sysId);
  let sysR = sys.r + 120;
  for (const d of SPACE_PLANETS) if (planetSysId(d) === sysId) sysR = Math.max(sysR, d.dist + 60);
  const R = sysR * OMNI_LASER.blast; // the explosion reaches far beyond the system
  const inside = [], outer = [];
  for (const t of G.space.ships) {
    if (t === s) continue; // the firing ship holds at the beam's safe stand-off
    const d2 = (t.x - sys.x) ** 2 + (t.y || 0) ** 2 + (t.z - sys.z) ** 2;
    if (d2 <= sysR * sysR) inside.push(t);
    else if (d2 <= R * R) outer.push(t);
  }
  const stations = (G.space.researchers || []).filter(r => !r.destroyed &&
    (r.x - sys.x) ** 2 + (r.y || 0) ** 2 + (r.z - sys.z) ** 2 <= R * R);
  const friendly = inside.filter(t => t.owner === s.owner).length +
    outer.filter(t => t.owner === s.owner).length +
    stations.filter(r => r.owner === s.owner).length;
  return { sys, sysR, R, inside, outer, stations, friendly };
}
function omniStrike(s, sysId) {
  const chk = canOmniStrike(s, sysId);
  if (!chk.ok) { if (s.owner === G.playerId && chk.why) toast(chk.why); return false; }
  const C = G.countries[s.owner];
  const os = omniStatus(s);
  C.res.money -= os.cost.money; C.res.mat -= os.cost.mat; C.res.energy = Math.max(0, C.res.energy - os.cost.energy);
  s.omniCharges--; s.omniCd = OMNI_LASER.cd; s.omniTarget = null;
  const plan = omniBlastPlan(s, sysId);
  const sys = plan.sys, st = sysState(sysId);
  const victims = new Set();
  spaceLaserFx(s, { x: sys.x, y: 0, z: sys.z }, true);
  spaceBoom({ x: sys.x, y: 0, z: sys.z }, plan.sysR * 0.6, "invade");
  sfx("nukeBoom");
  // every world of the system dies. The Homeworld keeps its existing special
  // rule — it can never be completely destroyed, so it burns instead.
  let coloniesLost = 0;
  for (const d of SPACE_PLANETS) {
    if (planetSysId(d) !== sysId) continue;
    const pst = G.space.planets[d.id];
    if (!pst) continue;
    if (d.type === "main") {
      if (!pst.scorched) {
        pst.scorched = true;
        // BUG REPORT morale fix: noGlory — an omni-blast massacre rallies no one
        for (const a of G.armies.slice()) if (typeof killArmy === "function") killArmy(a, s.owner, true);
        for (const cid of Object.keys(G.countries)) {
          const c2 = G.countries[cid];
          if (isSynthetic(c2)) continue;
          for (const p2 of c2.provinces) { p2.b = {}; p2.bq = []; p2.rq = []; }
          c2.morale = clamp(c2.morale - 25, 0, 100);
          c2.stability = clamp(c2.stability - 15, 0, 100);
          c2.pop = Math.max(0.3, c2.pop * 0.7);
        }
        if (typeof cityLayerDirty !== "undefined") cityLayerDirty = true;
        if (typeof mapOwnershipChanged === "function") mapOwnershipChanged();
        log(`🔥 The Homeworld is caught in the omni-blast — its surface burns, but the world itself endures.`, "war");
      }
      continue;
    }
    if (pst.destroyed) continue;
    if (pst.colony) { victims.add(pst.colony.owner); coloniesLost++; }
    if (pst.halo && pst.halo.owner !== undefined) victims.add(pst.halo.owner);
    pst.destroyed = true; pst.colony = null; pst.halo = null; pst.shield = null; pst.rehab = null;
    for (const c2 of Object.keys(G.countries)) {
      if (G.countries[c2].spaceCapital === d.id) G.countries[c2].spaceCapital = null;
    }
    spaceShatter(planetPos(d.id), d);
    alienCapitalFalls(d.id, s.owner, "destroyed"); // an alien capital in the system fells its civilization
  }
  // the star itself is gone — and any Dyson Sphere that wrapped it
  const dy = dysonOfSystem(sysId) || (sysId === "home" ? G.space.dyson : null);
  if (dy) { victims.add(dy.owner); destroyDyson(sysId, s.owner); }
  st.dead = true; st.nova = true; st.harvests = STELLAR_HARVEST.max;
  // §7: the permanent nebula — visual proof, and a hard ban on reconstruction
  st.nebula = { seed: ((sys.id.charCodeAt(0) || 7) * 131 + sys.id.length * 17) % 2147483000 || 7 };
  // §6: massive area damage — vaporised inside the system, mauled in the
  // oversized shockwave outside it
  let vaporised = 0, mauled = 0;
  for (const t of plan.inside.slice()) {
    victims.add(t.owner); vaporised++;
    if (t.owner === G.playerId) toast(`💥 Your ${UNITS[t.unit].n} is vaporised in the omni-blast!`);
    spaceBoom(t, 16, "ship");
    removeShip(t);
  }
  for (const t of plan.outer.slice()) {
    victims.add(t.owner); mauled++;
    t.hp -= t.maxHp * OMNI_LASER.blastDmgFrac * rnd(0.8, 1.2);
    spaceBoom(t, 12, "ship");
    if (t.hp <= 0) { vaporised++; mauled--; removeShip(t); }
  }
  for (const r of plan.stations) {
    victims.add(r.owner);
    r.destroyed = true; r.shield = null;
    spaceBoom(r, 26, "ship");
    if (r.owner === G.playerId) toast("🌆 Your Researcher megastructure is destroyed by the shockwave!");
  }
  // Update §13: the blast can wound a Harvester caught in its reach — but the
  // black hole itself is completely unaffected, always
  const bhSpl = galaxyBH(), bhHSpl = G.space.bhH;
  if (bhSpl && bhHSpl && !bhHSpl.ruins && (bhSpl.x - sys.x) ** 2 + (bhSpl.z - sys.z) ** 2 <= plan.R * plan.R) {
    victims.add(bhHSpl.owner);
    bhHarvesterHit(bhHSpl.maxHp * 0.4, s.owner);
    log(`💥 The omni-blast washes over the ${BH_HARVESTER.n} — the black hole behind it does not so much as flicker.`, "war");
  }
  // consequences: war with every victim, and the whole galaxy recoils
  for (const v of victims) sdDeclareWarIfNeeded(s.owner, v);
  for (const oid of Object.keys(G.countries)) {
    const o = Number(oid);
    if (o === s.owner || !G.countries[o].alive) continue;
    G.rel[o][s.owner] = clamp(G.rel[o][s.owner] - (victims.has(o) ? 70 : 45), -100, 100);
    G.trust[o][s.owner] = clamp(G.trust[o][s.owner] - (victims.has(o) ? 50 : 30), 0, 100);
    if (victims.has(o) && G.countries[o]) G.countries[o].morale = clamp(G.countries[o].morale - 18, 0, 100);
  }
  C.stability = clamp(C.stability - 14, 0, 100);
  // BUG REPORT morale fix: annihilating a solar system weighs on the firing
  // nation's OWN morale — heavier when inhabited worlds died in the blast
  C.morale = clamp(C.morale - (coloniesLost || sysId === "home" ? 10 : 4), 0, 100);
  log(`💥 ${C.name} fires the OMNI-HYPERCHARGED ORBITAL LASER STRIKE — the ${sys.n} system is ANNIHILATED${coloniesLost ? `, taking ${coloniesLost} colon${coloniesLost > 1 ? "ies" : "y"} with it` : ""}. Only a vast nebula remains.`, "war");
  if (vaporised || mauled) log(`💥 The oversized shockwave reaches far beyond ${sys.n}: ${vaporised} spacecraft vaporised${mauled ? `, ${mauled} more crippled` : ""}.`, "war");
  if (victims.has(G.playerId)) toast(`💥 ${C.name}'s Omni Laser has destroyed the ${sys.n} system — your holdings there are gone!`);
  // §8: the debris begins a galaxy-wide meteor shower
  startMeteorShower(sysId);
  spacePanelDirty = true;
  return true;
}
// ---- §8: the meteor-shower event ----
function startMeteorShower(sysId) {
  const sys = systemDef(sysId);
  G.space.meteor = { ticks: OMNI_LASER.meteorTicks, total: OMNI_LASER.meteorTicks, from: sysId };
  log(`☄ The destruction of a solar system has released massive debris fields across the galaxy.`, "war");
  if (typeof toast === "function") toast(`☄ Debris from ${sys.n} rains across the galaxy — impacts will slowly fade.`);
}
// one economic tick of random meteor strikes; the chance decays until the event ends
function tickMeteorShower() {
  const m = G.space && G.space.meteor;
  if (!m) return;
  m.ticks--;
  const p = Math.max(0.15, m.ticks / Math.max(1, m.total)); // impacts thin out over time
  // the homeland: a building is flattened in a random province
  if (Math.random() < 0.35 * p) {
    const owners = Object.keys(G.countries).filter(k => G.countries[k].alive && !isSynthetic(G.countries[k]));
    if (owners.length) {
      const cA = G.countries[pick(owners)];
      const provs = (cA.provinces || []).filter(p2 => Object.keys(p2.b || {}).some(k => p2.b[k] > 0));
      if (provs.length) {
        const pr = pick(provs);
        const keys = Object.keys(pr.b).filter(k => pr.b[k] > 0);
        const k = pick(keys);
        pr.b[k]--; if (pr.b[k] <= 0) delete pr.b[k];
        if (typeof cityLayerDirty !== "undefined") cityLayerDirty = true;
        const bn = typeof BLDGS !== "undefined" && BLDGS[k] ? BLDGS[k].n : k;
        log(`☄ A meteor slams into ${cA.name}${pr.city ? ` near ${pr.city}` : ""} — a ${bn} is flattened.`, cA.id === G.playerId ? "bad" : "sys");
        if (cA.id === G.playerId) toast(`☄ Meteor impact on the homeland — a ${bn} is destroyed!`);
      }
    }
  }
  // colonies: garrisons battered, the odd colony building smashed
  if (Math.random() < 0.30 * p) {
    const cols = [];
    for (const d of SPACE_PLANETS) {
      const stC = G.space.planets[d.id];
      if (stC && stC.colony && !stC.destroyed) cols.push({ d, stC });
    }
    if (cols.length) {
      const hit = pick(cols);
      for (const g of hit.stC.colony.garrison) g.hp = Math.max(1, g.hp - rnd(15, 45));
      const bk = Object.keys(hit.stC.colony.b || {}).filter(k => hit.stC.colony.b[k] > 0);
      let smashed = null;
      if (bk.length && Math.random() < 0.4) {
        smashed = pick(bk);
        hit.stC.colony.b[smashed]--; if (hit.stC.colony.b[smashed] <= 0) delete hit.stC.colony.b[smashed];
      }
      spaceBoom(planetPos(hit.d.id), hit.d.r + 6, "invade");
      log(`☄ Meteorites batter the colony on ${hit.d.n}${smashed ? ` — a ${COLONY_BLDGS[smashed] ? COLONY_BLDGS[smashed].n : smashed} is wrecked` : ""}.`, hit.stC.colony.owner === G.playerId ? "bad" : "sys");
      if (hit.stC.colony.owner === G.playerId) toast(`☄ Meteor strike on your colony at ${hit.d.n}!`);
    }
  }
  // ships in the debris lanes
  if (Math.random() < 0.35 * p && G.space.ships.length) {
    const t = pick(G.space.ships);
    t.hp -= rnd(90, 220);
    spaceBoom(t, 14, "ship");
    if (t.hp <= 0) {
      log(`☄ A debris swarm tears ${G.countries[t.owner] ? G.countries[t.owner].name : "?"}'s ${UNITS[t.unit].n} apart.`, t.owner === G.playerId ? "bad" : "sys");
      if (t.owner === G.playerId) toast(`☄ Your ${UNITS[t.unit].n} is lost to the meteor shower!`);
      removeShip(t);
    } else if (t.owner === G.playerId) {
      log(`☄ Your ${UNITS[t.unit].n} is struck by meteor debris (${Math.round(t.hp)}/${t.maxHp} hull).`, "bad");
    }
  }
  // megastructures: Researcher cities take a pounding
  if (Math.random() < 0.15 * p) {
    const live = (G.space.researchers || []).filter(r => !r.destroyed);
    if (live.length) {
      const r = pick(live);
      const sh = r.shield && r.shield.hp > 0 ? r.shield : null;
      if (sh) sh.hp = Math.max(0, sh.hp - 400);
      else r.hp -= 400;
      spaceBoom(r, 20, sh ? "shield" : "ship");
      if (!sh && r.hp <= 0) {
        r.destroyed = true;
        log(`☄ The Researcher megastructure of ${G.countries[r.owner] ? G.countries[r.owner].name : "?"} breaks apart under the meteor storm.`, r.owner === G.playerId ? "bad" : "war");
        if (r.owner === G.playerId) toast("☄ Your Researcher megastructure has been destroyed by meteors!");
      } else {
        log(`☄ Meteorites hammer ${G.countries[r.owner] ? G.countries[r.owner].name : "?"}'s ${sh ? "Researcher shield" : "Researcher megastructure"}.`, r.owner === G.playerId ? "bad" : "sys");
      }
    }
  }
  // and some land harmlessly on empty worlds
  if (Math.random() < 0.18 * p) {
    const empty = SPACE_PLANETS.filter(d => {
      const stE = G.space.planets[d.id];
      return d.type !== "main" && stE && !stE.destroyed && !stE.colony;
    });
    if (empty.length) {
      const d = pick(empty);
      spaceBoom(planetPos(d.id), d.r + 4, "invade");
      log(`☄ A meteor storm lands harmlessly on the empty surface of ${d.n}.`, "sys");
    }
  }
  if (m.ticks <= 0) {
    delete G.space.meteor;
    log("☄ The debris fields disperse — the meteor shower has ended.", "sys");
  }
}
function dysonOfSystem(sysId) {
  if (sysId === "home") return G.space.dyson && G.space.dyson.stage > 0 ? G.space.dyson : null;
  const sys = G.space.systems[sysId];
  return sys && sys.dyson ? sys.dyson : null;
}
function destroyDyson(sysId, attackerId) {
  const sys = systemDef(sysId);
  const dy = dysonOfSystem(sysId);
  if (!dy) return;
  const ownerName = G.countries[dy.owner] ? G.countries[dy.owner].name : "an unknown power";
  spaceBoom({ x: sys.x, y: 0, z: sys.z }, sys.r * 2, "invade");
  sfx("nukeBoom");
  if (sysId === "home") G.space.dyson = null;
  else G.space.systems[sysId].dyson = null;
  log(`☀ The Dyson Sphere of ${ownerName} around ${sys.n} SHATTERS — its colossal energy output is gone.`, "war");
  if (dy.owner === G.playerId) toast(`☀ Your Dyson Sphere has been destroyed by ${G.countries[attackerId] ? G.countries[attackerId].name : "the enemy"}!`);
  spacePanelDirty = true;
}
// normal warship fire can also whittle a Dyson Sphere down (several attacks)
function shipAttackDyson(s, dt) {
  const dy = dysonOfSystem(s.dysonTarget);
  if (!dy || dy.owner === s.owner || !atWar(s.owner, dy.owner)) { s.dysonTarget = null; return; }
  const sys = systemDef(s.dysonTarget);
  const pos = { x: sys.x, y: 0, z: sys.z };
  const d2 = (s.x - pos.x) ** 2 + (s.y - pos.y) ** 2 + (s.z - pos.z) ** 2;
  if (d2 > STAR_NEAR * STAR_NEAR) { // close in first
    s.free = { x: pos.x + (s.x - pos.x) * 0.3, y: 0, z: pos.z + (s.z - pos.z) * 0.3 };
    return;
  }
  s.cd = (s.cd || 0) - dt;
  if (s.cd > 0) return;
  const u = UNITS[s.unit];
  s.cd = u.atk >= 1000 ? 3.0 : 1.6;
  let dmg = u.atk * 0.5 * (s.stack || 1) * milDmgMult(G.countries[s.owner]);
  const target = dy.shield && dy.shield.hp > 0 ? dy.shield : dy;
  target.hp = (target.hp !== undefined ? target.hp : DYSON_HP) - dmg;
  if (spaceFx.length < 200) spaceFx.push({ kind: "laser", x1: s.x, y1: s.y, z1: s.z, x2: pos.x, y2: pos.y, z2: pos.z, ttl: 0.18, max: 0.18, big: u.atk >= 1000 });
  if (spaceOpen && (s.owner === G.playerId || dy.owner === G.playerId)) sfx("beam");
  if (target === dy && dy.hp <= 0) { destroyDyson(s.dysonTarget, s.owner); s.dysonTarget = null; }
  if (target !== dy && target.hp <= 0) { target.hp = 0; log("🛡 The Dyson Sphere's Giant Shield collapses!", "war"); }
}
function spaceLaserFx(s, pos, big) {
  spaceFx.push({ kind: "laser", x1: s.x, y1: s.y, z1: s.z, x2: pos.x, y2: pos.y, z2: pos.z, ttl: 0.5, max: 0.5, big: !!big, mega: !!big });
}

// ---------------- Giant Shields (Part 4) ----------------
function makeShield(owner) { return { owner: Number(owner), hp: MEGA_DEFS.shield.hp, maxHp: MEGA_DEFS.shield.hp }; }
function shieldTargetRef(kind, id) {
  if (kind === "planet") return planetState(id);
  if (kind === "dyson") return dysonOfSystem(id);
  if (kind === "researcher") return researcherById(id);
  return null;
}
function buildShield(cid, kind, id, silent) {
  const c = G.countries[cid];
  const d = MEGA_DEFS.shield;
  if (!c.researched[d.tech]) { if (!silent && cid === G.playerId) toast("Requires the Giant Shield technology."); return false; }
  const t = shieldTargetRef(kind, id);
  if (!t) return false;
  if (t.shield && t.shield.hp > 0) { if (!silent && cid === G.playerId) toast("A shield already protects it."); return false; }
  // you may only shield what is yours
  const owner = kind === "planet" ? (t.colony ? t.colony.owner : (id === "home" ? cid : null)) : t.owner;
  if (owner !== Number(cid) && !(kind === "planet" && id === "home")) {
    if (!silent && cid === G.playerId) toast("Shields can only be raised over your own worlds and structures.");
    return false;
  }
  const free = cid === G.playerId && sbFree(cid);
  const cost = free ? { money: 0, mat: 0, energy: 0 } : d.cost;
  if (c.res.money < cost.money || c.res.mat < cost.mat || c.res.energy < (cost.energy || 0)) {
    if (!silent && cid === G.playerId) toast(`A Giant Shield needs ${d.cost.money}💰 ${d.cost.mat}⛏ ${d.cost.energy}⚡.`);
    return false;
  }
  c.res.money -= cost.money; c.res.mat -= cost.mat; c.res.energy = Math.max(0, c.res.energy - (cost.energy || 0));
  t.shield = makeShield(cid);
  log(`🛡 ${c.name} raises a Giant Shield.`, Number(cid) === G.playerId ? "good" : "sys");
  if (Number(cid) === G.playerId) sfx("era");
  spacePanelDirty = true;
  return true;
}
function repairShield(cid, kind, id, silent) {
  const c = G.countries[cid];
  const t = shieldTargetRef(kind, id);
  if (!t || !t.shield) return false;
  if (t.shield.owner !== Number(cid)) return false;
  if (t.shield.hp >= t.shield.maxHp) { if (!silent && cid === G.playerId) toast("The shield is at full charge."); return false; }
  const d = MEGA_DEFS.shield;
  const free = cid === G.playerId && sbFree(cid);
  const cost = free ? { money: 0, mat: 0 } : { money: Math.round(d.cost.money * d.repairFrac), mat: Math.round(d.cost.mat * d.repairFrac) };
  if (c.res.money < cost.money || c.res.mat < cost.mat) {
    if (!silent && cid === G.playerId) toast(`Repairs need ${cost.money}💰 ${cost.mat}⛏.`);
    return false;
  }
  c.res.money -= cost.money; c.res.mat -= cost.mat;
  t.shield.hp = t.shield.maxHp;
  if (Number(cid) === G.playerId) { toast("🛡 Shield restored to full charge."); sfx("coin"); }
  spacePanelDirty = true;
  return true;
}

// ---------------- Rehabilitator (Part 3) ----------------
function startRehab(cid, planetId, silent) {
  const c = G.countries[cid];
  const d = MEGA_DEFS.rehab;
  const st = planetState(planetId), def = planetDef(planetId);
  if (!c.researched[d.tech]) { if (!silent && cid === G.playerId) toast("Requires the Rehabilitator technology."); return false; }
  if (!st) return false;
  if (st.rehab) { if (!silent && cid === G.playerId) toast("A Rehabilitator already works on this world."); return false; }
  const rebuild = st.destroyed;
  const scorch = def.type === "main" && st.scorched;
  if (!rebuild && !scorch) { if (!silent && cid === G.playerId) toast("This world needs no rehabilitation."); return false; }
  // Small Update §7: a system erased by the Omni Laser is gone for good — the
  // permanent nebula cannot be rebuilt by the Rehabilitator or anything else
  // (the surviving, scorched Homeworld may still be extinguished)
  if (rebuild && sunDead(planetSysId(def)) && (G.space.systems[planetSysId(def)] || {}).nova) {
    if (!silent && cid === G.playerId) toast("Nothing can be reconstructed inside the nebula — that solar system is gone forever.");
    return false;
  }
  const mult = rebuild ? d.rebuildMult : 1;
  const free = cid === G.playerId && sbFree(cid);
  const cost = free ? { money: 0, mat: 0 } : { money: d.cost.money * mult, mat: d.cost.mat * mult };
  if (c.res.money < cost.money || c.res.mat < cost.mat) {
    if (!silent && cid === G.playerId) toast(`${rebuild ? "Reconstructing a destroyed planet" : "Rehabilitation"} needs ${cost.money}💰 ${cost.mat}⛏.`);
    return false;
  }
  c.res.money -= cost.money; c.res.mat -= cost.mat;
  st.rehab = { owner: Number(cid), prog: 0, need: d.ticks * (rebuild ? 2 : 1), rebuild };
  log(`♻ ${c.name} deploys a Rehabilitator ${rebuild ? `to reassemble the shattered ${def.n}` : `over the burning ${def.n}`}.`, Number(cid) === G.playerId ? "good" : "sys");
  spacePanelDirty = true;
  return true;
}
function finishRehab(planetId) {
  const st = planetState(planetId), def = planetDef(planetId);
  const r = st.rehab;
  st.rehab = null;
  if (!r) return;
  if (r.rebuild) {
    st.destroyed = false;
    st.colony = null; st.halo = null; st.shield = null;
    log(`♻ ${def.n} IS REBORN — the Rehabilitator has reassembled a habitable world from the debris.`, r.owner === G.playerId ? "good" : "sys");
  } else {
    st.scorched = false;
    log(`♻ The fires on ${def.n} die out — the surface is habitable again. Cities may be rebuilt.`, r.owner === G.playerId ? "good" : "sys");
    if (def.type === "main") {
      toast("♻ The Homeworld is restored — construction and troops are possible again. The ruins await rebuilding.");
      if (typeof cityLayerDirty !== "undefined") cityLayerDirty = true;
      if (typeof mapOwnershipChanged === "function") mapOwnershipChanged();
    }
  }
  if (r.owner === G.playerId) sfx("era");
  spacePanelDirty = true;
}

// ---------------- Researcher megastructure (Parts 9-10) ----------------
// BUG REPORT (Alien Discovery & Researcher Restrictions §5-9) — where may a
// Researcher rise? Never in random deep space. Only inside a solar system the
// builder actually controls — the homeland system (aliens: their spawn
// system) or one holding at least one of the builder's colonies — anchored
// reasonably close to that system's star or an owned world, clear of other
// structures, and never in a system an alien civilization still actively
// controls (permanent presence: a colony, capital, station or megastructure —
// a fleet merely passing through does not block). ONE validator serves every
// path: the player's placement click, the AI, aliens and the multiplayer
// command handler (net.js) all ask researcherSiteCheck(), and every refusal
// carries its exact reason — nothing is ever silently hidden.
const RESEARCHER_SITE = { nearR: 400, sysR: 800, gap: 70 };
// the permanent alien presence (if any) that keeps a system closed (§7)
function alienControlsSystem(sysId, cid) {
  cid = Number(cid);
  for (const rec of G.space.aliens || []) {
    if (rec.defeated || rec.aid === cid) continue;
    const A = G.countries[rec.aid];
    if (!A || !A.alive) continue;
    for (const d of SPACE_PLANETS) {
      if (planetSysId(d) !== sysId) continue;
      const st = G.space.planets[d.id];
      if (st && !st.destroyed && st.colony && st.colony.owner === rec.aid) return rec;
    }
    const dy = G.space.systems[sysId] && G.space.systems[sysId].dyson;
    if (dy && Number(dy.owner) === rec.aid) return rec;
  }
  return null;
}
// valid anchor points inside one system: the star, every colony the builder
// owns there — and the Homeworld itself for the land nations that live on it
function researcherAnchors(cid, sysId) {
  cid = Number(cid);
  const sy = systemDef(sysId);
  const pts = [{ x: sy.x, y: 0, z: sy.z }];
  for (const d of SPACE_PLANETS) {
    if (planetSysId(d) !== sysId) continue;
    const st = G.space.planets[d.id];
    if (!st || st.destroyed) continue;
    if ((st.colony && st.colony.owner === cid) || (d.id === "home" && !alienById(cid))) pts.push(planetPos(d.id));
  }
  return pts;
}
function researcherSiteCheck(cid, x, y, z) {
  cid = Number(cid);
  ensureSpaceState();
  const c = G.countries[cid], d = MEGA_DEFS.researcher;
  y = y || 0;
  if (!c || !c.alive) return { ok: false, why: "Researcher unavailable: the builder no longer exists." };
  if (!c.researched[d.tech]) return { ok: false, why: "Researcher unavailable: required technology not researched." };
  // §6: the systems this civilization may build in at all
  const rec = alienById(cid);
  const valid = new Set([rec ? rec.sys : "home"]);
  for (const col of coloniesOfNation(cid)) valid.add(planetSysId(col.def));
  // the nearest legal anchor across every controlled system
  let aSys = null, aD2 = Infinity;
  for (const sysId of valid) {
    for (const p of researcherAnchors(cid, sysId)) {
      const d2 = (p.x - x) ** 2 + ((p.y || 0) - y) ** 2 + (p.z - z) ** 2;
      if (d2 < aD2) { aD2 = d2; aSys = sysId; }
    }
  }
  const anchored = aSys !== null && aD2 <= RESEARCHER_SITE.nearR * RESEARCHER_SITE.nearR;
  // which system's space does the point actually lie in?
  const near = systemAt(x, z);
  const inSpace = near && (near.x - x) ** 2 + (near.z - z) ** 2 <= RESEARCHER_SITE.sysR * RESEARCHER_SITE.sysR;
  // §7 outranks everything else: alien-held space stays closed until liberated
  for (const sysId of new Set([anchored ? aSys : null, inSpace ? near.id : null])) {
    if (sysId && alienControlsSystem(sysId, cid)) {
      return { ok: false, why: "Researcher unavailable: an alien civilization still controls this solar system." };
    }
  }
  if (!anchored) {
    if (!inSpace) return { ok: false, why: "Researcher unavailable: location is outside a valid solar system." };
    if (!valid.has(near.id)) return { ok: false, why: "Researcher unavailable: no owned colony in this solar system." };
    return { ok: false, why: "Researcher unavailable: move the structure closer to an owned colony or star." };
  }
  // never atop the star or another standing structure
  const sy = systemDef(aSys);
  if ((sy.x - x) ** 2 + (sy.z - z) ** 2 < (sy.r + 40) ** 2) {
    return { ok: false, why: "Researcher unavailable: the location overlaps the star." };
  }
  for (const r of G.space.researchers || []) {
    if (!r.destroyed && (r.x - x) ** 2 + ((r.y || 0) - y) ** 2 + (r.z - z) ** 2 < RESEARCHER_SITE.gap * RESEARCHER_SITE.gap) {
      return { ok: false, why: "Researcher unavailable: the location overlaps another structure." };
    }
  }
  const free = cid === G.playerId && sbFree(cid);
  if (!free && (c.res.money < d.cost.money || c.res.mat < d.cost.mat)) {
    return { ok: false, why: `A Researcher needs ${d.cost.money}💰 ${d.cost.mat}⛏.` };
  }
  return { ok: true, sys: aSys };
}
function buildResearcher(cid, x, y, z, silent) {
  const chk = researcherSiteCheck(cid, x, y, z);
  if (!chk.ok) {
    if (!silent && Number(cid) === G.playerId) toast(chk.why);
    spDbg(`researcher build blocked for ${cid}: ${chk.why}`);
    return false;
  }
  const c = G.countries[cid];
  const d = MEGA_DEFS.researcher;
  const free = Number(cid) === G.playerId && sbFree(cid);
  const cost = free ? { money: 0, mat: 0 } : d.cost;
  c.res.money -= cost.money; c.res.mat -= cost.mat;
  const r = {
    id: "R" + (G.space.shipSeq++), owner: Number(cid), x, y: y || 0, z,
    lvl: 1, hp: d.hp, maxHp: d.hp, shield: null, cd: 0, destroyed: false,
  };
  G.space.researchers.push(r);
  log(`🌆 ${c.name} completes a Researcher over the ${systemDef(chk.sys).n} system — an entire city adrift in space.`, Number(cid) === G.playerId ? "good" : "sys");
  if (Number(cid) === G.playerId) sfx("era");
  spacePanelDirty = true;
  return r;
}
function upgradeResearcher(cid, rid, silent) {
  const r = researcherById(rid);
  const c = G.countries[cid];
  if (!r || r.owner !== Number(cid) || r.destroyed) return false;
  if (r.lvl >= MEGA_DEFS.researcher.maxLvl) { if (!silent && cid === G.playerId) toast("The Researcher is fully expanded."); return false; }
  const free = cid === G.playerId && sbFree(cid);
  const cost = free ? { money: 0, mat: 0 } : RESEARCHER_UP(r.lvl);
  if (c.res.money < cost.money || c.res.mat < cost.mat) {
    if (!silent && cid === G.playerId) toast(`The next expansion needs ${cost.money}💰 ${cost.mat}⛏.`);
    return false;
  }
  c.res.money -= cost.money; c.res.mat -= cost.mat;
  r.lvl++;
  r.maxHp = MEGA_DEFS.researcher.hp + (r.lvl - 1) * 800;
  r.hp = Math.min(r.maxHp, r.hp + 800);
  if (Number(cid) === G.playerId) { log(`🌆 The Researcher expands to level ${r.lvl} (+research).`, "good"); sfx("coin"); }
  spacePanelDirty = true;
  return true;
}
function repairResearcher(cid, rid, silent) {
  const r = researcherById(rid);
  const c = G.countries[cid];
  if (!r || r.owner !== Number(cid) || r.destroyed) return false;
  if (r.hp >= r.maxHp) { if (!silent && cid === G.playerId) toast("The Researcher needs no repairs."); return false; }
  const dmgFrac = 1 - r.hp / r.maxHp;
  const free = cid === G.playerId && sbFree(cid);
  const cost = free ? { money: 0, mat: 0 } : { money: Math.round(MEGA_DEFS.researcher.cost.money * 0.4 * dmgFrac), mat: Math.round(MEGA_DEFS.researcher.cost.mat * 0.4 * dmgFrac) };
  if (c.res.money < cost.money || c.res.mat < cost.mat) {
    if (!silent && cid === G.playerId) toast(`Repairs need ${cost.money}💰 ${cost.mat}⛏.`);
    return false;
  }
  c.res.money -= cost.money; c.res.mat -= cost.mat;
  r.hp = r.maxHp;
  if (Number(cid) === G.playerId) { toast("🌆 Researcher fully repaired."); sfx("coin"); }
  spacePanelDirty = true;
  return true;
}
// revive a wreck at 60% of build cost — its upgrades survive restoration
function reviveResearcher(cid, rid, silent) {
  const r = researcherById(rid);
  const c = G.countries[cid];
  if (!r || r.owner !== Number(cid) || !r.destroyed) return false;
  const free = cid === G.playerId && sbFree(cid);
  const cost = free ? { money: 0, mat: 0 } : {
    money: Math.round(MEGA_DEFS.researcher.cost.money * RESEARCHER_REVIVE_FRAC),
    mat: Math.round(MEGA_DEFS.researcher.cost.mat * RESEARCHER_REVIVE_FRAC),
  };
  if (c.res.money < cost.money || c.res.mat < cost.mat) {
    if (!silent && cid === G.playerId) toast(`Restoration needs ${cost.money}💰 ${cost.mat}⛏.`);
    return false;
  }
  c.res.money -= cost.money; c.res.mat -= cost.mat;
  r.destroyed = false;
  r.hp = Math.round(r.maxHp * 0.6);
  log(`🌆 ${c.name} restores its ruined Researcher — level ${r.lvl} systems come back online.`, Number(cid) === G.playerId ? "good" : "sys");
  spacePanelDirty = true;
  return true;
}
function locateInterstellarLife(cid, rid, silent) {
  const r = researcherById(rid);
  const c = G.countries[cid];
  if (!r || r.owner !== Number(cid) || r.destroyed) return false;
  if (r.cd > 0) { if (!silent && cid === G.playerId) toast(`📡 Deep scan recharging — ${r.cd} tick${r.cd > 1 ? "s" : ""} left.`); return false; }
  const free = cid === G.playerId && sbFree(cid);
  const cost = free ? { money: 0, energy: 0 } : LOCATE_LIFE;
  if (c.res.money < cost.money || c.res.energy < cost.energy) {
    if (!silent && cid === G.playerId) toast(`The deep scan needs ${LOCATE_LIFE.money}💰 and ${LOCATE_LIFE.energy}⚡.`);
    return false;
  }
  c.res.money -= cost.money; c.res.energy = Math.max(0, c.res.energy - cost.energy);
  r.cd = LOCATE_LIFE.cd; // a failed attempt still burns the cooldown
  if (Math.random() < LOCATE_LIFE.chance) {
    // Update §18.3.2: the ordinary array is BLIND to Phantom Step — cloaked
    // civilizations simply do not exist to it ("no life detected")
    const hidden = (G.space.aliens || []).filter(a => !a.defeated && !systemRevealed(a.sys) && !phantomActive(a.sys));
    if (hidden.length) {
      const found = pick(hidden);
      log(`📡 CONTACT — the Researcher pinpoints an alien civilization in the ${systemDef(found.sys).n} system!`, "sys");
      if (Number(cid) === G.playerId) { toast(`📡 Alien civilization located in the ${systemDef(found.sys).n} system!`); sfx("era"); }
      alienMeet(found, Number(cid), "located");
      revealSystem(found.sys); // §1-4: co-resident civilizations register too
    } else {
      const unrevealed = SPACE_SYSTEMS.filter(sy => !systemRevealed(sy.id) && !phantomActive(sy.id));
      if (unrevealed.length) {
        const sy = pick(unrevealed);
        // BUG REPORT §1-2: a charted system is scanned for alien owners on the
        // spot — colonies of an already-located civilization included. Never
        // again "no intelligent signals" over a clearly inhabited world.
        const lived = (G.space.aliens || []).some(a => !a.defeated && alienAssetSystems(a).has(sy.id));
        revealSystem(sy.id);
        log(lived
          ? `📡 CONTACT — the Researcher charts the ${sy.n} system and finds it inhabited!`
          : `📡 The Researcher charts the ${sy.n} system — no intelligent signals, but new worlds await.`, "sys");
        if (Number(cid) === G.playerId) toast(lived ? `📡 Alien presence charted in the ${sy.n} system!` : `📡 The ${sy.n} system has been charted.`);
      } else {
        if (Number(cid) === G.playerId) toast("📡 The scan sweeps the void… every known signal is already charted.");
      }
    }
  } else {
    log(`📡 ${c.name}'s deep scan finds only static.`, "sys");
    if (Number(cid) === G.playerId) toast("📡 Only static. The array must recharge before the next attempt.");
  }
  spacePanelDirty = true;
  return true;
}

// ---------------- capital planet (Part 12) ----------------
function setCapitalPlanet(cid, planetId, silent) {
  const c = G.countries[cid];
  const st = planetState(planetId), def = planetDef(planetId);
  if (!st || !st.colony || st.colony.owner !== Number(cid) || st.destroyed) {
    if (!silent && cid === G.playerId) toast("Only one of your own colonies can become the capital planet.");
    return false;
  }
  if (c.spaceCapital === planetId) { if (!silent && cid === G.playerId) toast("That colony is already your capital."); return false; }
  if ((c.capitalCd || 0) > 0) {
    if (!silent && cid === G.playerId) toast(`The government is still relocating — try again in ${c.capitalCd} tick${c.capitalCd > 1 ? "s" : ""}.`);
    return false;
  }
  const free = cid === G.playerId && sbFree(cid);
  const cost = free ? { money: 0, mat: 0 } : CAPITAL_PLANET.cost;
  if (c.res.money < cost.money || c.res.mat < cost.mat) {
    if (!silent && cid === G.playerId) toast(`Moving the capital needs ${CAPITAL_PLANET.cost.money}💰 ${CAPITAL_PLANET.cost.mat}⛏.`);
    return false;
  }
  c.res.money -= cost.money; c.res.mat -= cost.mat;
  c.spaceCapital = planetId;
  c.capitalCd = CAPITAL_PLANET.cd;
  // the move shakes the whole civilization (temporary unrest)
  c.morale = clamp(c.morale - CAPITAL_PLANET.shockMorale, 0, 100);
  c.stability = clamp(c.stability - CAPITAL_PLANET.shockStab, 0, 100);
  for (const p of provsOwned(cid)) p.unrest = Math.min(30, (p.unrest || 0) + 4);
  log(`★ ${c.name} proclaims ${def.n} its CAPITAL PLANET — production there triples, but the move unsettles the nation.`, Number(cid) === G.playerId ? "good" : "sys");
  if (Number(cid) === G.playerId) sfx("era");
  spacePanelDirty = true;
  return true;
}

// ---------------- alien civilizations (Parts 7, 8 & 11) ----------------
// Aliens are lightweight synthetic countries (alive in G.countries so combat,
// wars and relations work) whose entire existence is in space: colonies in
// foreign systems, fleets in G.space.ships, no land on the world map. They
// are ALWAYS AI-controlled — in multiplayer too.
const ALIEN_SPECIES = ["Vrethari", "Xul'Qan", "Ommatid", "Serelim", "Krellax", "Nhy-Voth"];
function genAlienName(seed) {
  const a = ["Vre", "Xul", "Om", "Ser", "Krel", "Nhy", "Zar", "Qir"], b = ["th", "q", "l", "x", "r"], c = ["ari", "an", "atid", "elim", "ax", "oth", "uun", "eth"];
  return a[seed % a.length] + b[(seed * 7) % b.length] + c[(seed * 13) % c.length];
}
function registerAlienNation(c) {
  NATIONS[c.id] = {
    n: c.name, sp: c.species || "Unknown Xenos", per: c.personality || "aggressive", gov: "emperor",
    st: [8, 6, 6, 6, 5, 6, 3, 7, 6],
    ab: { n: "Xenos", d: "Beyond the reach of the world's diplomacy." },
    lg: "Xeno-signal", ap: "Unknowable.", cu: "Unknowable.", ts: "Alien.", str: [], wk: [], hi: "",
  };
}
function makeAlienCountry(aid, name, species, tier, per, col) {
  const c = {
    id: aid, alien: true, name, species,
    leaderName: genAlienName(aid * 3 + 1), leaderTitle: "Overmind",
    gov: "emperor", lang: "Xeno-signal", flag: { bg: col, glyph: "👁" }, capital: 0,
    alive: true, annexedBy: null, vassalOf: null, provinces: [], homeBiome: "green",
    pop: tier * 3, morale: 85, stability: 95,
    res: { food: 9999, mat: 40000 * tier, money: 60000 * tier, energy: 6000 },
    researched: {}, researching: null, rp: 0, era: ALIEN_TIERS[tier].era,
    policies: { tax: 1, edu: 1, mil: 1, health: 1, trade: 0, consc: 0 },
    personality: per, lastWarTurn: -99, warWeariness: 0, govCooldown: 0,
    revealTo: {}, sabotage: 0, customName: true, missiles: {}, warBias: 0, revCd: 0,
  };
  G.countries[aid] = c;
  registerAlienNation(c);
  G.rel[aid] = {}; G.trust[aid] = {};
  for (const k of Object.keys(G.countries)) {
    if (Number(k) === aid) continue;
    G.rel[aid][k] = 0; G.trust[aid][k] = 20;
    if (G.rel[k]) G.rel[k][aid] = 0;
    if (G.trust[k]) G.trust[k][aid] = 20;
  }
  return c;
}
function alienById(aid) { return (G.space.aliens || []).find(a => a.aid === Number(aid)); }

// ============ Final Alien Update — capitals & the fall of a civilization ============
// Every alien civilization has exactly ONE capital planet (rec.capital). While
// it stands, the civilization can produce; when it is conquered or destroyed,
// the civilization is DEFEATED: production stops forever, its colonies
// surrender to the victor, and only its existing fleets fight on as remnants.
function alienCapitalPlanet(rec) {
  if (!rec || rec.defeated || !rec.capital) return null;
  const st = G.space.planets[rec.capital];
  return st && !st.destroyed && st.colony && st.colony.owner === rec.aid ? rec.capital : null;
}
// a world the civilization can still build ships and recruit troops at —
// the capital first, else any surviving colony (Part 6: no source, no units)
function alienProductionWorld(rec) {
  if (!rec || rec.defeated) return null;
  const cap = alienCapitalPlanet(rec);
  if (cap) return cap;
  for (const d of SPACE_PLANETS) {
    const st = G.space.planets[d.id];
    if (st && !st.destroyed && st.colony && st.colony.owner === rec.aid) return d.id;
  }
  return null;
}
// older saves: give every civilization a capital and the new flags
function alienMigrate(rec) {
  if (rec.defeated === undefined) rec.defeated = false;
  if (!rec.grudge) rec.grudge = {};
  if (!rec.capital && !rec.defeated) {
    const held = SPACE_PLANETS.filter(d => {
      const st = G.space.planets[d.id];
      return st && !st.destroyed && st.colony && st.colony.owner === rec.aid;
    });
    if (held.length) {
      const best = held.find(d => d.id === rec.home) ||
        held.slice().sort((a, b) => G.space.planets[b.id].colony.lvl - G.space.planets[a.id].colony.lvl)[0];
      rec.capital = best.id;
    } else {
      // dispossessed before the update — they can never produce again
      rec.defeated = true; rec.defeatedBy = null;
    }
  }
}
// the grudges that justify an alien counterstroke (Part 1)
function alienNoteLoss(victimId, byId) {
  const rec = alienById(victimId);
  const B = G.countries[byId];
  if (!rec || !B || isSynthetic(B)) return;
  rec.grudge = rec.grudge || {};
  rec.grudge[byId] = (rec.grudge[byId] || 0) + 1;
}
// Part 7: conquering (never destroying) the capital pays enormous spoils —
// alien technology stockpiles, rare matter, energy reserves
function alienCapitalSpoils(rec, victorId) {
  const V = G.countries[victorId];
  if (!V || !V.alive || isSynthetic(V)) return;
  const t = rec.tier;
  V.res.money += ALIEN_CAPITAL.money * t;
  V.res.mat += ALIEN_CAPITAL.mat * t;
  V.res.energy += ALIEN_CAPITAL.energy * t;
  V.rp = (V.rp || 0) + ALIEN_CAPITAL.research * t;
  log(`💎 The vaults of the alien capital yield ${fmt ? fmt(ALIEN_CAPITAL.money * t) : ALIEN_CAPITAL.money * t}💰, ${fmt ? fmt(ALIEN_CAPITAL.mat * t) : ALIEN_CAPITAL.mat * t}⛏, ${fmt ? fmt(ALIEN_CAPITAL.energy * t) : ALIEN_CAPITAL.energy * t}⚡ and alien research to ${V.name}!`, victorId === G.playerId ? "good" : "sys");
  if (victorId === G.playerId) { toast(`💎 Alien capital spoils: +${ALIEN_CAPITAL.money * t}💰 +${ALIEN_CAPITAL.mat * t}⛏ +${ALIEN_CAPITAL.energy * t}⚡!`); if (typeof renderTopbar === "function") renderTopbar(); }
}
// Parts 4-5: the capital has fallen — the civilization is defeated.
// One simple, consistent result: every remaining colony surrenders to the
// power that defeated the capital (or falls silent if there is none), all
// production stops forever, and the surviving fleets become remnants.
function alienDefeated(rec, byId, how) {
  if (!rec || rec.defeated) return;
  rec.defeated = true;
  rec.defeatedBy = byId === undefined ? null : byId;
  rec.warPlan = null; rec.wantCarrier = false; rec.posture = null;
  const c = G.countries[rec.aid];
  const A = c ? c.name : "the aliens";
  if (c) { c.res.money = 0; c.res.mat = 0; c.res.energy = 0; c.researching = null; } // treasuries seized, queues die
  const V = byId !== null && byId !== undefined && G.countries[byId] && G.countries[byId].alive && !isSynthetic(G.countries[byId]) ? Number(byId) : null;
  let handed = 0, silent = 0;
  for (const d of SPACE_PLANETS) {
    const st = G.space.planets[d.id];
    if (!st || st.destroyed || !st.colony || st.colony.owner !== rec.aid) continue;
    if (V !== null) {
      st.colony.owner = V;
      st.colony.garrison = []; // the alien garrisons lay down their arms
      if (st.halo) st.halo.owner = V;
      if (st.shield) st.shield.owner = V;
      handed++;
    } else { st.colony = null; st.shield = null; silent++; }
  }
  // remnant fleets keep fighting but abandon every settling / invasion errand
  for (const s of G.space.ships) {
    if (s.owner !== rec.aid) continue;
    s.settle = null; s.landing = null; s.loadFrom = null;
    s.colInv = null; s.escortOf = null; s.guard = null;
  }
  log(`👁 ${how === "destroyed" ? `The capital world of the ${A} is GONE` : `Alien capital conquered`} — the alien civilization has fallen.`, "war");
  if (handed) log(`🏳 ${handed} alien colon${handed > 1 ? "ies" : "y"} surrender${handed > 1 ? "" : "s"} to ${G.countries[V].name}.`, V === G.playerId ? "good" : "sys");
  if (silent) log(`🏚 ${silent} leaderless alien colon${silent > 1 ? "ies" : "y"} fall${silent > 1 ? "" : "s"} silent — empty ruins under alien stars.`, "sys");
  const remn = G.space.ships.filter(s => s.owner === rec.aid).length + (G.armies || []).filter(a => a.owner === rec.aid).length;
  if (remn) log(`👁 ${remn} alien unit${remn > 1 ? "s" : ""} fight${remn > 1 ? "" : "s"} on as scattered remnants — they will never be reinforced.`, "sys");
  if (byId === G.playerId) {
    toast(`👁 VICTORY — the ${A} have fallen! ${how === "destroyed" ? "Their capital is dust." : "Their capital — and their empire — is yours."}`);
    sfx("era");
  } else if (rec.contacted.includes(G.playerId)) {
    toast(`👁 The ${A} have fallen${G.countries[V] ? ` to ${G.countries[V].name}` : ""}.`);
  }
  spacePanelDirty = true;
}
// central hook: a colony changed hands or a planet died — was it a capital?
function alienCapitalFalls(planetId, byId, how) {
  const rec = (G.space.aliens || []).find(a => !a.defeated && a.capital === planetId);
  if (rec) alienDefeated(rec, byId, how);
}

// SU2 Part 7: every new galaxy holds at least 1 hyper-advanced and 5 normal
// alien civilizations, spread across different systems, plus a low-chance
// scattering of extras. None of them is placed close to the starting system.
// ============ Alien War AI Fix §0 — the space unlock condition ============
// The universe is completely alien-free until the FIRST spacecraft of any
// civilization (player, AI or NPC) rises into space: no factions, no fleets,
// no diplomacy, no background simulation. That first launch is THE milestone —
// markSpaceReached() fires once, quietly generates the alien civilizations and
// switches their AI on. No reveal, no announcement; the galaxy simply stops
// being empty. The flag lives in G.space, so it rides saves and MP snapshots.
function spaceReached() { return !!(G && G.space && G.space.reached); }
function markSpaceReached() {
  ensureSpaceState();
  if (G.space.reached) return;
  G.space.reached = Math.max(1, G.turn || 1); // remembers the milestone turn
  ensureAliens(); // §0.3: generate & initialize the alien civilizations NOW
}
function ensureAliens() {
  if (!G || !G.space) return;
  if (G.space.aliens) {
    // re-register NATIONS rows after a page reload
    for (const a of G.space.aliens) {
      const c = G.countries[a.aid];
      if (c && !NATIONS[a.aid]) registerAlienNation(c);
      alienMigrate(a); // Final Alien Update: capitals & defeat flags for older saves
    }
    // §0 migration: a save from before the Alien War AI Fix (it carries no
    // aliensGen bookkeeping) generated its aliens at galaxy birth — for that
    // game the milestone is long past and its civilizations stand as they are
    if (G.space.aliensGen === undefined) { G.space.aliensGen = 1; if (!G.space.reached) G.space.reached = 1; }
  }
  // §0 migration: a real nation's spacecraft already aloft proves the
  // milestone too (alien and rebel craft don't count — they never launched)
  if (!G.space.reached && (G.space.ships || []).some(s => { const C = G.countries[s.owner]; return C && !isSynthetic(C); })) G.space.reached = 1;
  if (!G.space.reached) return; // §0.2: the universe stays alien-free before space
  if (G.space.aliensGen) return; // this galaxy's civilizations already exist
  G.space.aliensGen = 1;
  G.space.aliens = G.space.aliens || []; // keep any sandbox-seeded civilizations
  // candidate systems ranked by distance from Aurelia — measured from the
  // homeland's ROLLED position (Critical Bug-Fix §2), not the galaxy origin;
  // each alien needs enough planets in its system to hold its starting colonies
  const homeSys0 = systemDef("home");
  const homeDist = s => Math.hypot(s.x - homeSys0.x, s.z - homeSys0.z);
  const planetsOf = sysId => SPACE_PLANETS.filter(d => planetSysId(d) === sysId);
  const taken = {};
  const candidates = SPACE_SYSTEMS.filter(s => s.id !== "home" && planetsOf(s.id).length > 0)
    .sort((a, b) => homeDist(a) - homeDist(b));
  const pickSystem = (minPlanets, far) => {
    let pool = candidates.filter(s => !taken[s.id] && planetsOf(s.id).length >= minPlanets);
    if (far) pool = pool.filter(s => homeDist(s) > 5200);
    if (!pool.length) pool = candidates.filter(s => !taken[s.id] && planetsOf(s.id).length >= 1);
    if (!pool.length) return null;
    const sys = far ? pick(pool.slice(-Math.min(6, pool.length)))       // the far tail
      : pick(pool.slice(Math.min(2, pool.length - 1)));                 // skip the closest couple
    taken[sys.id] = 1;
    return sys;
  };
  const plans = [];
  const hyperSys = pickSystem(3, true);                                  // ≥1 hyper-advanced, far away
  if (hyperSys) plans.push({ sys: hyperSys.id, tier: 4 });
  const normalTiers = [pick([1, 2]), pick([2, 3]), pick([1, 2]), pick([2, 3]), pick([1, 2, 3])];
  for (const t of normalTiers) {                                         // ≥5 normal civilizations
    const sys = pickSystem(ALIEN_TIERS[t].colonies, false);
    if (sys) plans.push({ sys: sys.id, tier: t });
  }
  // extra civilizations spawn with a LOW chance (SU2 §7)
  for (const sys of candidates) {
    if (taken[sys.id] || plans.length >= 10) continue;
    if (Math.random() < 0.06) { taken[sys.id] = 1; plans.push({ sys: sys.id, tier: pick([1, 1, 2, 2, 3]) }); }
  }
  const alienCols = [[235, 120, 200], [130, 240, 190], [255, 180, 90], [150, 200, 255], [220, 130, 130], [190, 255, 140], [255, 240, 130], [180, 150, 255], [140, 230, 230], [255, 150, 170]];
  let aid = ALIEN_BASE_ID, ci = 0;
  for (const plan of plans) {
    while (G.countries[aid]) aid++;
    const tier = plan.tier;
    const perPool = tier === 1 ? ["peaceful"] :
      tier === 2 ? ["peaceful", "cautious", "aggressive"] :
      tier === 3 ? ["cautious", "aggressive"] : ["cautious", "aggressive", "warlord"];
    const per = pick(perPool);
    const species = pick(ALIEN_SPECIES);
    const name = genAlienName(aid) + (tier >= 3 ? " Dominion" : tier === 2 ? " Combine" : " Tribes");
    const c = makeAlienCountry(aid, name, species, tier, per, alienCols[ci++ % alienCols.length]);
    const sysPlanets = SPACE_PLANETS.filter(d => planetSysId(d) === plan.sys);
    const T = ALIEN_TIERS[tier];
    const rec = { aid, sys: plan.sys, tier, per, contacted: [], knows: {}, fleetCd: 0, sdCd: 30, talkCd: 0, tradeCd: 0, expandCd: irnd(4, 12), invadeCd: irnd(6, 16), grudge: {}, defeated: false };
    G.space.aliens.push(rec);
    // colonies (primitive aliens hold exactly one world)
    let placed = 0;
    for (const d of sysPlanets) {
      if (placed >= T.colonies) break;
      const st = G.space.planets[d.id];
      if (!st || st.colony) continue;
      st.colony = { owner: aid, lvl: Math.min(5, tier + placed), garrison: [] };
      const gu = tier >= 3 ? "orbmarines" : tier === 2 ? "cyberops" : "spearman";
      // Final Alien Update Part 3: the FIRST world is the capital — the seat of
      // the Overmind, its main production centre and its strongest fortress
      for (let i = 0; i < 1 + tier + (placed === 0 ? 2 : 0); i++) st.colony.garrison.push({ unit: gu, hp: unitMaxHp(gu), maxHp: unitMaxHp(gu) });
      if (T.shield && placed === 0) st.shield = makeShield(aid);
      if (!rec.home) { rec.home = d.id; rec.capital = d.id; }
      placed++;
    }
    // fleets — Alien War AI Fix §3: any dominion advanced enough for a navy
    // keeps a real troop transport in it from the very start
    for (let i = 0; i < T.ships; i++) alienSpawnShip(rec, i === 0 && T.sd ? "stardestroyer" : (i === 1 && tier >= 2 ? "cargoship" : "starfleet"));
    // a hyper-advanced power may already have harnessed its star
    if (T.dyson) G.space.systems[plan.sys].dyson = { owner: aid, stage: 3, hp: DYSON_HP, alien: true };
  }
  // Update §6: in one galaxy in ten, an alien presence already dwells at the
  // galactic core — the civilization nearest the black hole keeps a passive,
  // semi-neutral watch there (it defends itself, it does not hunt)
  const bh = galaxyBH();
  if (bh && bh.aliens && G.space.aliens.length) {
    let guard = null, gd = Infinity;
    for (const rec of G.space.aliens) {
      const sys = systemDef(rec.sys);
      const d = (sys.x - bh.x) ** 2 + (sys.z - bh.z) ** 2;
      if (d < gd) { gd = d; guard = rec; }
    }
    if (guard) {
      guard.bhGuard = true;
      if (guard.per === "warlord" || guard.per === "aggressive") guard.per = "cautious";
    }
  }
}
function alienSpawnShip(rec, unit) {
  // Final Alien Update Part 6: a ship can only be laid down at a REAL surviving
  // production world. Capital fallen / no colonies left → nothing ever spawns.
  const home = alienProductionWorld(rec);
  if (!home) return null;
  const p = planetPos(home);
  const ang = rnd(0, Math.PI * 2);
  const sh = {
    id: G.space.shipSeq++, owner: rec.aid, unit: unit || "starfleet",
    hp: unitMaxHp(unit || "starfleet"), maxHp: unitMaxHp(unit || "starfleet"), stack: 1, cargo: [],
    x: p.x + Math.cos(ang) * 50, y: rnd(-10, 10), z: p.z + Math.sin(ang) * 50,
    target: null, chase: null, orbit: home, orbitAng: rnd(0, Math.PI * 2), cd: rnd(0, 1),
  };
  G.space.ships.push(sh);
  return sh;
}
// the unit an alien civilization fields, by development tier
function alienUnitOf(tier) { return tier >= 3 ? "orbmarines" : tier === 2 ? "cyberops" : "spearman"; }
// SU2 Part 2: aliens found new colonies with their own hands — no human techs,
// no treasuries, just an expanding dominion
function alienFound(rec, planetId) {
  const st = G.space.planets[planetId], def = planetDef(planetId);
  if (!st || st.destroyed || st.colony || !def || def.type === "main") return false;
  // BUG REPORT (star death): a settler arriving at a freshly dead system turns away
  if (sunDead(planetSysId(def))) return false;
  // AI Update §13.3: an active Void Shield makes alien colonization impossible
  if (typeof voidShieldBlocks === "function" && voidShieldBlocks(planetSysId(def), rec.aid)) return false;
  const gu = alienUnitOf(rec.tier);
  st.colony = { owner: rec.aid, lvl: 1, garrison: [] };
  for (let i = 0; i < 1 + Math.min(2, rec.tier); i++) st.colony.garrison.push({ unit: gu, hp: unitMaxHp(gu), maxHp: unitMaxHp(gu) });
  if (systemRevealed(planetSysId(def))) {
    log(`👁 The ${G.countries[rec.aid].name} claim ${def.n} — an alien colony takes root.`, "sys");
  }
  spacePanelDirty = true;
  return true;
}
// SU2 Part 3, reworked by AI Improvements Parts 9-10: an alien CARGO craft
// deploys only the troops it actually carries. Nothing spawns from nowhere —
// the troops were recruited into a colony garrison, loaded aboard (limited
// capacity), flown across space, and they die with the ship if it is
// intercepted before deployment. No cargo craft in orbit → no alien troops.
function alienLandTroops(rec, ship, foeId) {
  if (typeof homeworldScorched === "function" && homeworldScorched()) return false;
  const F = G.countries[foeId];
  if (!F || !F.alive || !atWar(rec.aid, foeId)) return false;
  if (!ship || !(ship.cargo || []).length) return false;   // empty bays — no landing
  if (!shipNearPlanet(ship, "home")) return false;         // must be in orbit overhead
  const entries = provsOfNation(foeId).filter(e => e.p.occ !== rec.aid);
  if (!entries.length) return false;
  const target = pick(entries).p;
  let dropped = 0;
  while (ship.cargo.length && dropped < 4) {
    const cu = ship.cargo[ship.cargo.length - 1];
    const spot = typeof findLandNear === "function"
      ? findLandNear(target.px + rnd(-60, 60), target.py + rnd(-60, 60), 90) : null;
    if (!spot) break;
    ship.cargo.pop(); // the bay count drops with every deployment
    const a = spawnArmy(rec.aid, cu.unit, spot.x, spot.y);
    if (a) {
      a.hp = Math.min(cu.hp, a.maxHp);
      a.tx = target.px + rnd(-10, 10); a.ty = target.py + rnd(-10, 10);
      dropped++;
    }
  }
  if (!dropped) return false;
  ship.orbit = "home"; ship.target = null; ship.free = null; // stay visible over the surface
  const A = G.countries[rec.aid];
  log(`👁 ALIEN LANDING — a ${UNITS[ship.unit].n} of the ${A.name} deploys ${dropped} unit${dropped > 1 ? "s" : ""} on ${F.name} near ${target.city}!`, "war");
  if (foeId === G.playerId) { toast(`👁 Alien troops are landing near ${target.city}!`); sfx("warhorn"); }
  alienLandfallReaction(rec, target); // Final Alien Update Part 2: the world reacts
  if (typeof mapOwnershipChanged === "function") mapOwnershipChanged();
  return true;
}
// ============ Final Alien Update Part 2 — the world reacts to a landfall ============
// Most nations recognise the landing as a serious — but not automatically
// world-ending — threat. Everyone hardens against the invader; who actually
// takes up arms depends on proximity, strength and temperament. Some watch and
// wait. Ongoing wars between countries continue unless the invasion is huge.
function alienLandfallReaction(rec, prov) {
  G.alienLandfall = G.alienLandfall || {};
  const fresh = G.alienLandfall[rec.aid] === undefined || G.turn - G.alienLandfall[rec.aid] >= 20;
  G.alienLandfall[rec.aid] = G.turn;
  if (!fresh) return; // one coordinated response per invasion wave
  const A = G.countries[rec.aid];
  log(`👁 Alien forces have landed on the homeland. Nations are assessing the threat and preparing responses.`, "war");
  toast(`👁 Alien forces have landed on the homeland!`);
  sfx("event");
  const declared = [], watching = [];
  for (const cid of Object.keys(G.countries)) {
    const o = Number(cid), C = G.countries[cid];
    if (!C.alive || isSynthetic(C) || o === rec.aid) continue;
    // every nation hardens against the invader
    G.rel[o][rec.aid] = clamp((G.rel[o][rec.aid] || 0) - irnd(25, 45), -100, 100);
    if (G.rel[rec.aid]) G.rel[rec.aid][o] = clamp((G.rel[rec.aid][o] || 0) - 10, -100, 100);
    if (G.trust[o]) G.trust[o][rec.aid] = Math.min(G.trust[o][rec.aid] || 20, 5);
    if (o === G.playerId || atWar(o, rec.aid)) continue; // the player decides alone
    if (typeof isDisconnectedHuman === "function" && isDisconnectedHuman(o)) continue;
    // proximity, strength and temperament decide who takes up arms now
    const m = metaOf(o);
    const dist = m ? Math.hypot(m.cx - prov.px, m.cy - prov.py) : 9999;
    let chance = 0.2 + (dist < 260 ? 0.35 : dist < 520 ? 0.15 : 0) +
      (C.era >= 7 ? 0.15 : C.era >= 5 ? 0.05 : -0.1) +
      (C.personality === "aggressive" || C.personality === "defensive" ? 0.1 : 0) +
      (C.personality === "peaceful" ? -0.15 : 0);
    if (Math.random() < chance) { declareWar(o, rec.aid, true); declared.push(C.name); }
    else if (dist < 520 && Math.random() < 0.35) watching.push(C.name);
  }
  if (declared.length) {
    log(`⚔ ${declared.slice(0, 6).join(", ")}${declared.length > 6 ? ` and ${declared.length - 6} more` : ""} declare war on the ${A.name} invaders!`, "war");
    // nearby co-belligerents close ranks (occasional cooperation)
    for (const w1 of G.wars) {
      if (w1.b !== rec.aid) continue;
      for (const w2 of G.wars) {
        if (w2.b !== rec.aid || w1.a === w2.a) continue;
        if (G.rel[w1.a] && G.rel[w1.a][w2.a] !== undefined) G.rel[w1.a][w2.a] = clamp(G.rel[w1.a][w2.a] + 6, -100, 100);
      }
    }
  }
  if (watching.length) log(`🕊 ${watching.slice(0, 5).join(", ")}${watching.length > 5 ? "…" : ""} mobilize but hold back, assessing the alien threat.`, "sys");
  // only a LARGE invasion freezes the world's internal wars
  const aliensGround = (G.armies || []).filter(a => a.owner === rec.aid).length;
  if (aliensGround >= 8) {
    let ceasefires = 0;
    for (const w of G.wars.slice()) {
      const CA = G.countries[w.a], CB = G.countries[w.b];
      if (!CA || !CB || isSynthetic(CA) || isSynthetic(CB)) continue;
      if (w.a === G.playerId || w.b === G.playerId) continue; // never force the player's wars shut
      if (Math.random() < 0.5) { makePeace(w.a, w.b, true); ceasefires++; }
    }
    if (ceasefires) log(`🤝 The scale of the alien invasion forces old rivals to lay down their arms — ${ceasefires} war${ceasefires > 1 ? "s" : ""} halted.`, "sys");
  }
  spacePanelDirty = true;
}
function alienEconTick(c) {
  const rec = alienById(c.id);
  if (!rec) return;
  // Final Alien Update Parts 4+6: a defeated or dispossessed civilization has
  // no economy — remnant fleets fly on whatever is left in their bunkers
  const prodWorld = alienProductionWorld(rec);
  if (rec.defeated || !prodWorld) return;
  // Critical Bug-Fix §5: alien colonies obey the Dead Sun rule too — an
  // economy running on a dead production world drops to 20% of normal
  const dm = sunDead(planetSysId(planetDef(prodWorld))) ? DEAD_SUN.prodMult : 1;
  c.res.money += 400 * rec.tier * dm;
  c.res.mat += 250 * rec.tier * dm;
  c.res.energy = Math.max(c.res.energy, dm < 1 ? 400 : 2000);
}
// quiet = registration only (the caller announces): used by the centralized
// discovery scan so ten nations don't produce ten FIRST CONTACT lines
function alienMeet(rec, cid, how, quiet) {
  cid = Number(cid);
  if (rec.contacted.includes(cid)) return;
  rec.contacted.push(cid);
  const A = G.countries[rec.aid], C = G.countries[cid];
  const start = { peaceful: 25, cautious: 0, aggressive: -30, warlord: -55 }[rec.per] || 0;
  // a first handshake never overwrites a live war footing (landfall wars etc.)
  if (!atWar(rec.aid, cid)) { G.rel[rec.aid][cid] = start; G.rel[cid][rec.aid] = start; }
  spacePanelDirty = true;
  if (quiet) return;
  const tierN = ALIEN_TIERS[rec.tier].n.toLowerCase();
  const phrase = how === "located" ? `has been located by ${C.name}` :
    how === "encountered" ? `has been encountered by ${C.name}'s ships` :
    how === "revealed" ? `stands revealed on ${C.name}'s star charts` :
    `has detected ${C.name}'s Dyson signature`;
  log(`👁 FIRST CONTACT — the ${A.name}, a ${tierN} alien civilization, ${phrase}.`, "sys");
  if (cid === G.playerId) {
    toast(`👁 First contact with the ${A.name} (${ALIEN_TIERS[rec.tier].n}). Open the Space view to parley.`);
    sfx("event");
  }
}
// ============ BUG REPORT (Alien Discovery & Researcher Restrictions §1-4) ============
// THE centralized discovery rule: a visible alien-owned object IS a discovered
// civilization. Technology tier never factors into it — tribal or
// hyper-advanced, one revealed colony, capital, station, megastructure, fleet
// or landed army is enough. revealSystem() is the single entry point for
// "this system is now visible" (ship arrivals, flybys, Researcher scans);
// every reveal immediately sweeps the system for alien owners, alienTick()
// re-sweeps charted space each turn (civilizations that expand or fly INTO
// already-revealed systems), and ensureSpaceState() sweeps once on load so a
// save with alien territory already in view registers it at once. Each
// civilization registers exactly once per nation — never a duplicate entry.
// Phantom-cloaked systems stay undetectable (§18.3.2).

// every system in which this civilization owns something that can be seen:
// colonies (home & capital included), Dyson Spheres, Researchers, fleets —
// and the Homeworld itself while its ground troops stand on the surface
function alienAssetSystems(rec) {
  const held = new Set();
  if (!rec) return held;
  for (const d of SPACE_PLANETS) {
    const st = G.space.planets[d.id];
    if (st && !st.destroyed && st.colony && st.colony.owner === rec.aid) held.add(planetSysId(d));
  }
  for (const sysId of Object.keys(G.space.systems || {})) {
    const dy = G.space.systems[sysId].dyson;
    if (dy && Number(dy.owner) === rec.aid) held.add(sysId);
  }
  for (const r of G.space.researchers || []) if (!r.destroyed && r.owner === rec.aid) held.add(systemAt(r.x, r.z).id);
  for (const s of G.space.ships) if (s.owner === rec.aid) held.add(systemAt(s.x, s.z).id);
  if ((G.armies || []).some(a => a.owner === rec.aid)) held.add("home");
  return held;
}
// one discovery moment per civilization: every living nation reads the same
// star charts, so all of them register the newcomer at once — quietly, behind
// a single shared announcement (and the player's first-contact notification)
function alienRegisterEverywhere(rec, sysId) {
  const A = G.countries[rec.aid];
  if (!A || !A.alive) return false;
  const brandNew = rec.contacted.length === 0;
  const fresh = [];
  for (const k of Object.keys(G.countries)) {
    const n = Number(k), C = G.countries[k];
    if (!C || !C.alive || isSynthetic(C) || n === rec.aid) continue;
    if (rec.contacted.includes(n)) continue;
    fresh.push(n);
    alienMeet(rec, n, "revealed", true);
  }
  if (!fresh.length) return false;
  const tierN = ALIEN_TIERS[rec.tier].n;
  if (brandNew || fresh.includes(G.playerId)) {
    log(`👁 New civilization discovered: the ${A.name} — a ${tierN.toLowerCase()} alien civilization revealed in the ${systemDef(sysId).n} system.`, fresh.includes(G.playerId) ? "good" : "sys");
  }
  if (fresh.includes(G.playerId)) {
    toast(`👁 New civilization discovered: the ${A.name} (${tierN}). Open the Space view to parley.`);
    sfx("event");
  }
  spacePanelDirty = true;
  return true;
}
// sweep charted space for alien-controlled objects; onlySysId narrows the
// sweep to one freshly revealed system. Returns how many civilizations were
// newly registered. Re-running it is free — no duplicates are ever created.
function alienDiscoveryScan(onlySysId) {
  if (!G || !G.space || !G.space.aliens) return 0;
  let found = 0;
  for (const rec of G.space.aliens) {
    if (rec.defeated) continue;
    const A = G.countries[rec.aid];
    if (!A || !A.alive) continue;
    for (const sysId of alienAssetSystems(rec)) {
      if (onlySysId && sysId !== onlySysId) continue;
      if (!systemRevealed(sysId) || phantomActive(sysId)) continue;
      if (alienRegisterEverywhere(rec, sysId)) found++;
      break; // registered (or already known everywhere) — the rest add nothing
    }
  }
  return found;
}
// THE single entry point for "this system is now visible" (§4): reveals it if
// new and immediately scans it for alien owners. Returns true when the system
// was newly revealed (callers use that for their own log flavor).
function revealSystem(sysId) {
  const st = sysState(sysId);
  const fresh = !st.revealed;
  if (fresh) { st.revealed = true; spacePanelDirty = true; }
  alienDiscoveryScan(sysId);
  return fresh;
}
// Part 8 — a completed Dyson stage shines across the void: every tick each
// undetected alien has a 0.1% chance of tracing it to its builder.
// Final Space Fixes §2: EVERY sphere shines — home or any system star.
function alienDetectionRoll() {
  const owners = new Set();
  if (G.space.dyson && G.space.dyson.stage >= 1) owners.add(Number(G.space.dyson.owner));
  for (const sysId of Object.keys(G.space.systems || {})) {
    const sdy = G.space.systems[sysId].dyson;
    if (sdy && sdy.stage >= 1) owners.add(Number(sdy.owner));
  }
  for (const owner of owners) {
    const O = G.countries[owner];
    if (!O || !O.alive || O.alien) continue; // aliens don't "detect" their own kind
    for (const rec of G.space.aliens || []) {
      if (rec.knows[owner]) continue;
      if (Math.random() >= ALIEN_DETECT_CHANCE) continue;
      rec.knows[owner] = true;
      alienMeet(rec, owner, "detected");
      // detection may spark anything from curiosity to invasion — but a Dyson
      // signature alone is no longer a guaranteed war (Final Alien Update Part 1):
      // only warlords commit outright; aggressive powers weigh the odds first
      if ((rec.per === "aggressive" || rec.per === "warlord") && rec.tier >= 2 &&
          (rec.per === "warlord" || Math.random() < 0.45)) {
        const delay = rec.per === "warlord" ? irnd(8, 18) : irnd(20, 45);
        rec.warPlan = { target: owner, at: G.turn + delay };
        log(`👁 Ominous signals rise from the ${G.countries[rec.aid].name}…`, "sys");
      }
    }
  }
}
// BUG REPORT (Alien Detection on First Contact) — passive discovery. A flyby
// is enough: every turn, any non-alien nation's ship inside a system holding
// that civilization's assets (their home, a colony, or their fleet), or within
// sensor range of one of their ships in the open void, triggers the same
// alienMeet() as a Researcher scan — diplomacy, war and the 👁 Known
// Civilizations list all open up. Each civilization sharing a system registers
// individually (revealSystem's central scan picks up the co-residents);
// Phantom-cloaked systems stay undetectable (§18.3.2).
const FLYBY_SYS_R = 800;      // "inside the system" — past the outermost orbit
const FLYBY_SENSOR_RNG = 260; // open-void sensor bubble around an alien ship
function alienProximityContacts() {
  for (const rec of G.space.aliens || []) {
    if (rec.defeated) continue;
    const A = G.countries[rec.aid];
    if (!A || !A.alive) continue;
    // every system this civilization currently holds assets in (§1-4 helper)
    const held = alienAssetSystems(rec);
    const fleet = G.space.ships.filter(f => f.owner === rec.aid);
    for (const s of G.space.ships) {
      const cid = Number(s.owner);
      const C = G.countries[cid];
      if (!C || !C.alive || C.alien || rec.contacted.includes(cid)) continue;
      const sys = systemAt(s.x, s.z);
      const inHeld = held.has(sys.id) && !phantomActive(sys.id) &&
        (sys.x - s.x) ** 2 + (sys.z - s.z) ** 2 < FLYBY_SYS_R * FLYBY_SYS_R;
      const nearFleet = !inHeld && fleet.some(f =>
        (f.x - s.x) ** 2 + (f.y - s.y) ** 2 + (f.z - s.z) ** 2 < FLYBY_SENSOR_RNG * FLYBY_SENSOR_RNG &&
        !phantomActive(systemAt(f.x, f.z).id));
      if (!inHeld && !nearFleet) continue;
      rec.knows[cid] = true; // sensors work both ways — they saw you too
      alienMeet(rec, cid, "encountered");
      // a flyby discovery charts the system it happened in; the central scan
      // inside revealSystem registers every OTHER civilization living there
      if (inHeld && G.space.systems[sys.id] && !G.space.systems[sys.id].revealed) {
        log(`🛰 ${C.name}'s ships chart the ${sys.n} system — and find it inhabited.`, "sys");
        revealSystem(sys.id);
      }
    }
  }
}
// ============ AI Update §12.4 — the alien political ecosystem ============
// Aliens are mostly peaceful and cooperative with each other. Contact opens
// when dominions share space (or either side is warp-capable), relations then
// drift by temperament, trade builds ties, shared enemies forge defensive
// alliances — and WAR between dominions is rare: a late-game product of
// contested systems, blocked expansion and personality, never a default.
function alienFreeWorldCount() {
  let n = 0;
  for (const d of SPACE_PLANETS) {
    if (d.type === "main") continue;
    const st = G.space.planets[d.id];
    if (st && !st.destroyed && !st.colony && !sunDead(planetSysId(d))) n++;
  }
  return n;
}
function alienAliensTick(rec) {
  const c = G.countries[rec.aid];
  if (!c || !c.alive || rec.defeated) return;
  rec.knowsAlien = rec.knowsAlien || {};
  const mySys = alienAssetSystems(rec);
  const myColonies = SPACE_PLANETS.filter(d => {
    const st = G.space.planets[d.id];
    return st && !st.destroyed && st.colony && st.colony.owner === rec.aid;
  });
  const freeWorlds = alienFreeWorldCount();
  const living = (G.space.aliens || []).filter(a => !a.defeated && a !== rec && G.countries[a.aid] && G.countries[a.aid].alive);
  // expansion pressure: a dominion that still wants worlds but finds none free
  const colonyCap = rec.tier >= 4 ? 7 : rec.tier * 2;
  const blocked = myColonies.length < colonyCap && freeWorlds === 0;
  for (const other of living) {
    const oc = G.countries[other.aid];
    // ---- contact ----
    if (!rec.knowsAlien[other.aid]) {
      let meet = rec.tier >= 3 || other.tier >= 3;
      if (!meet) { const theirs = alienAssetSystems(other); for (const sSys of mySys) if (theirs.has(sSys)) { meet = true; break; } }
      if (!meet) continue;
      rec.knowsAlien[other.aid] = true;
      const base = { peaceful: 20, cautious: 5, aggressive: -10, warlord: -25 };
      const start = Math.round((((base[rec.per] || 0) + (base[other.per] || 0)) / 2));
      if (!atWar(rec.aid, other.aid)) {
        G.rel[rec.aid][other.aid] = clamp((G.rel[rec.aid][other.aid] || 0) + start, -100, 100);
      }
    }
    const rel = G.rel[rec.aid][other.aid] || 0;
    const war = atWar(rec.aid, other.aid);
    // ---- contested space: colonies of both dominions in the same system ----
    const theirs = alienAssetSystems(other);
    let contested = false;
    for (const d of myColonies) if (theirs.has(planetSysId(d))) { contested = true; break; }
    if (!war) {
      // peacetime drift: gentle temperaments warm to each other, warlords sour,
      // border friction and blocked expansion grind relations down
      let drift = 0;
      if ((rec.per === "peaceful" || rec.per === "cautious") && rel < 40) drift += 0.3;
      if (rec.per === "warlord") drift -= 0.2;
      if (contested) drift -= 0.8;
      if (blocked) drift -= 0.3;
      if (drift) G.rel[rec.aid][other.aid] = clamp(rel + drift, -100, 100);
      // trade & cooperation between friendly dominions
      if (rel > 10 && (rec.per === "peaceful" || rec.per === "cautious") && Math.random() < 0.05) {
        G.rel[rec.aid][other.aid] = clamp(rel + 2, -100, 100);
        G.rel[other.aid][rec.aid] = clamp((G.rel[other.aid][rec.aid] || 0) + 2, -100, 100);
        c.res.mat += 150 * other.tier; oc.res.money += 150 * rec.tier;
      }
      // defensive alliances against a shared enemy
      if (rel > 20 && !allied(rec.aid, other.aid) && Math.random() < 0.08) {
        const sharedFoe = G.wars.some(w1 => (w1.a === rec.aid || w1.b === rec.aid) &&
          G.wars.some(w2 => (w2.a === other.aid || w2.b === other.aid) &&
            (w1.a === rec.aid ? w1.b : w1.a) === (w2.a === other.aid ? w2.b : w2.a)));
        if (sharedFoe) {
          G.alliances.push([rec.aid, other.aid]);
          log(`👁 The ${c.name} and the ${oc.name} form a defensive pact against their common enemy.`, "sys");
        }
      }
      // ---- war: RARE, late, and always about something (§12.4) ----
      if (!sandboxOn("noAIWars") && rel < -25 && G.turn >= 40) {
        let chance = { warlord: 0.02, aggressive: 0.012, cautious: 0.005, peaceful: 0.002 }[rec.per] || 0.005;
        if (contested) chance *= 2;                      // territorial dispute
        if (blocked) chance *= 2;                        // expansion path blocked
        if (G.turn < 90 && !contested && !blocked) chance *= 0.25; // early galaxy stays quiet
        const myFleet = G.space.ships.filter(s2 => s2.owner === rec.aid).length;
        const theirFleet = G.space.ships.filter(s2 => s2.owner === other.aid).length;
        if (myFleet < theirFleet * 0.7) chance *= 0.3;   // never a suicidal war lightly
        if (Math.random() < chance) {
          G.alliances = G.alliances.filter(p => !(p.includes(rec.aid) && p.includes(other.aid)));
          declareWar(rec.aid, other.aid);
          log(`👁 ALIEN WAR — the ${c.name} turn their fleets on the ${oc.name}${contested ? " over contested systems" : blocked ? " for room to grow" : ""}!`, "war");
        }
      }
      // alliances break when survival or ambition demands it
      if (allied(rec.aid, other.aid) && rel < -10 && Math.random() < 0.05) {
        G.alliances = G.alliances.filter(p => !(p.includes(rec.aid) && p.includes(other.aid)));
        log(`👁 The pact between the ${c.name} and the ${oc.name} dissolves.`, "sys");
      }
    } else {
      // ---- ending an alien-vs-alien war: exhaustion or a settled dispute ----
      const w = G.wars.find(x => (x.a === rec.aid && x.b === other.aid) || (x.b === rec.aid && x.a === other.aid));
      const long = w && G.turn - (w.start || 0) > 30;
      const noPeace = w && w.noPeace && G.turn < w.noPeace; // forced wars burn on (Sandbox §13)
      if (!noPeace && long && (rec.posture === "defensive" || other.posture === "defensive" || rel > -30) && Math.random() < 0.08) {
        makePeace(rec.aid, other.aid, false);
        G.rel[rec.aid][other.aid] = clamp(rel + 15, -100, 100);
        G.rel[other.aid][rec.aid] = clamp((G.rel[other.aid][rec.aid] || 0) + 15, -100, 100);
      }
    }
  }
}
// ============ AI Update §17 — the alien Star Destroyer war brain ============
// Not just a big gun: it escorts invasions, besieges Void Shields, cracks
// Dyson Spheres, harvests suns for Omni charges and — in long, justified,
// major wars — erases whole enemy systems. Every ability pays the same costs
// and cooldowns as the player's (§22), drawn from the dominion's own treasury.
function alienSDWar(rec, c, sd, fleet, foes, targets, sealedFronts) {
  if (sd.dysonTarget || sd.vsTarget) return; // already committed to a siege
  // Alien War AI Fix §7: what justifies the superweapon AT ALL — a forced
  // assault, a deep grudge, a war that has ground on for decades… or one that
  // is being LOST. Outside of that, the Star Destroyer escorts and besieges.
  const T9 = ALIEN_TIERS[rec.tier];
  const majorWar = rec.assault ||
    Object.keys(rec.grudge || {}).some(f => foes.includes(Number(f)) && rec.grudge[f] >= 3) ||
    G.wars.some(w => (w.a === rec.aid || w.b === rec.aid) && foes.includes(w.a === rec.aid ? w.b : w.a) && G.turn - (w.start || 0) > 30);
  const losing = (T9.ships || 0) > 0 && fleet.length <= Math.max(2, Math.round(T9.ships * 0.45));
  const wronged = Object.keys(rec.grudge || {}).some(f => foes.includes(Number(f)) && rec.grudge[f] >= 4);
  // 1. coordinate with a landing in progress — orbital fire support (§17)
  const carrier = fleet.find(s2 => s2.colInv);
  if (carrier && carrier.colInv && Math.random() < 0.5) {
    if (!shipNearPlanet(sd, carrier.colInv) && !sd.target) { sd.target = carrier.colInv; sd.orbit = null; }
    return;
  }
  // 2. besiege a Void Shield sealing a front (§13.3 / §16)
  if (sealedFronts.length && Math.random() < 0.5) {
    const front = pick(sealedFronts);
    const sys = systemDef(front);
    const near = (sd.x - sys.x) ** 2 + (sd.z - sys.z) ** 2 <= (voidShieldRadius(front) + 200) ** 2;
    if (near && sdLaserStatus(sd).ready) sdStrikeVoidShield(sd, front);
    else sd.vsTarget = front;
    return;
  }
  // 3. crack an enemy Dyson Sphere (§16) — §7: a dangerous megastructure is
  // one of the few targets that justify the weapon, in a war that calls for it
  for (const sysId of Object.keys(G.space.systems || {})) {
    const dy = dysonOfSystem(sysId);
    if (!dy || dy.stage < 1 || !foes.includes(Number(dy.owner))) continue;
    if (phantomHiddenFrom(sysId, rec.aid)) continue;
    if ((majorWar || losing) && Math.random() < (rec.per === "warlord" ? 0.25 : 0.15)) {
      const sys = systemDef(sysId);
      const near = (sd.x - sys.x) ** 2 + (sd.z - sys.z) ** 2 < 600 * 600;
      if (near && sdLaserStatus(sd).ready) attackDyson(sd, sysId);
      else sd.dysonTarget = sysId; // whittle it down with the main batteries
      return;
    }
    break;
  }
  const era9 = (c.era || 0) >= 9;
  // 4. §8: the Omni-Hypercharged strike is EXTREMELY rare — a losing or
  // deeply wronged dominion in a major war, a system genuinely worth the
  // charge (several enemy worlds), never one holding its own colonies or
  // ships, and never the shared homeland (short of an ordered total war)
  if (era9 && (sd.omniCharges || 0) > 0 && majorWar &&
      (losing || wronged || (rec.assault && rec.assault.intensity === "total")) && Math.random() < 0.06) {
    const bySys = {};
    for (const d of targets) {
      const sid = planetSysId(d);
      if (sid === "home" && !(rec.assault && rec.assault.intensity === "total" && rec.per === "warlord")) continue;
      // never a system holding the dominion's own colonies
      const ownHere = SPACE_PLANETS.some(d2 => planetSysId(d2) === sid && G.space.planets[d2.id] &&
        G.space.planets[d2.id].colony && G.space.planets[d2.id].colony.owner === rec.aid);
      if (ownHere) continue;
      bySys[sid] = (bySys[sid] || 0) + 1;
    }
    const best = Object.keys(bySys).filter(k => bySys[k] >= 2).sort((a, b) => bySys[b] - bySys[a])[0];
    if (best && canOmniStrike(sd, best).ok && omniBlastPlan(sd, best).friendly === 0) {
      log(`👁 The ${c.name} charge their Omni-Hypercharged Orbital Laser…`, "war");
      omniStrike(sd, best);
      return;
    }
  }
  // 5. no charge aboard: harvesting a sun for one is itself a war measure —
  // only a major war going badly (or a burning grudge) reaches for it, and
  // never a sun warming the dominion's own colonies or the homeland's
  if (era9 && (sd.omniCharges || 0) === 0 && majorWar && (losing || wronged) &&
      (sd.harvestCd || 0) <= 0 && Math.random() < 0.12) {
    const cands = SPACE_SYSTEMS.filter(sy => {
      if (sy.id === "home" || sunDead(sy.id)) return false;
      if (sysHarvestsLeft(sy.id) <= 0) return false;
      if (SPACE_PLANETS.some(d2 => planetSysId(d2) === sy.id && G.space.planets[d2.id] &&
        G.space.planets[d2.id].colony && G.space.planets[d2.id].colony.owner === rec.aid)) return false;
      return true;
    });
    if (cands.length) {
      cands.sort((a, b) => ((a.x - sd.x) ** 2 + (a.z - sd.z) ** 2) - ((b.x - sd.x) ** 2 + (b.z - sd.z) ** 2));
      const sun = cands[0];
      if (shipNearStar(sd, sun.id)) { if (canHarvestStar(sd, sun.id).ok) startStellarHarvest(sd, sun.id); }
      else if (!sd.target && !sd.free) sd.free = { x: sun.x + rnd(-140, 140), y: 0, z: sun.z + rnd(-140, 140) };
      return;
    }
  }
  // 6. §7-§8: erasing a colonized WORLD is the last rung of escalation, not a
  // habit. It takes real cause — repeated failed invasions there, a fortress
  // too strong to storm, or a war being lost — and NEVER touches a weak
  // colony the dominion could simply capture, a world its own invasion is
  // heading for, or one with alien ships close enough to die in the blast.
  if (rec.sdCd <= 0 && targets.length && (majorWar || losing) &&
      Math.random() < (rec.per === "warlord" ? 0.04 : 0.012)) {
    const gu = alienUnitOf(rec.tier);
    const punch = (UNITS[gu].atk + UNITS[gu].def * 0.3) * 0.5 * (1 + rec.tier);
    const fails = rec.invFail || {};
    const prey = targets.filter(d => {
      const defc = colonyDefence(d.id);
      if (defc <= punch * 1.2 && (fails[d.id] || 0) < 2) return false; // capturable — take it, don't burn it
      if (!((fails[d.id] || 0) >= 2 || defc >= punch * 2.4 || losing)) return false; // no cause to erase it
      if (fleet.some(s2 => s2.colInv === d.id)) return false;          // our own invasion is inbound
      const p = planetPos(d.id);
      const R2 = (PLANET_BLAST_R + d.r) ** 2 * 1.2;
      if (fleet.some(s2 => s2 !== sd && (s2.x - p.x) ** 2 + (s2.y - p.y) ** 2 + (s2.z - p.z) ** 2 <= R2)) return false; // friends in the shockwave
      return true;
    }).sort((a, b) => ((fails[b.id] || 0) - (fails[a.id] || 0)) || (colonyDefence(b.id) - colonyDefence(a.id)))[0];
    if (prey) {
      if (shipNearPlanet(sd, prey.id)) {
        rec.sdCd = 40;
        destroyPlanet(sd, prey.id);
      } else if (!sd.target) { sd.target = prey.id; sd.orbit = null; }
      return;
    }
  }
  // 7. the last resort of a wronged warlord: scorch the Homeworld itself.
  // Vanishingly rare — a grudge-fuelled, decades-long war, and never through
  // an active Void Shield.
  if (rec.per === "warlord" && rec.tier >= 4 && !homeworldScorched() &&
      !voidShieldBlocks("home", rec.aid) &&
      Object.keys(rec.grudge || {}).some(f => foes.includes(Number(f)) && rec.grudge[f] >= 4) &&
      G.wars.some(w => (w.a === rec.aid || w.b === rec.aid) && G.turn - (w.start || 0) > 40) &&
      Math.random() < 0.02) {
    if (shipNearPlanet(sd, "home")) { if (sdLaserStatus(sd).ready) bombardHomeworld(sd); }
    else if (!sd.target) { sd.target = "home"; sd.orbit = null; }
  }
}
function alienTick() {
  for (const rec of G.space.aliens || []) {
    const c = G.countries[rec.aid];
    if (!c || !c.alive) continue;
    if (rec.talkCd > 0) rec.talkCd--;
    if (rec.tradeCd > 0) rec.tradeCd--;
    if (rec.sdCd > 0) rec.sdCd--;
    const fleet = G.space.ships.filter(s => s.owner === rec.aid);
    const ground = (G.armies || []).filter(a => a.owner === rec.aid);
    // Final Alien Update Part 4 catch-all: the capital is gone → defeat,
    // whatever back road it fell by (explicit conquest paths attribute a victor)
    if (!rec.defeated && !alienCapitalPlanet(rec)) alienDefeated(rec, null, "lost");
    // ---- Part 5: a DEFEATED civilization only manages its remnants ----
    if (rec.defeated) {
      if (!fleet.length && !ground.length) {
        c.alive = false;
        G.wars = G.wars.filter(w => w.a !== rec.aid && w.b !== rec.aid);
        log(`👁 The last remnants of the ${c.name} are gone — the alien threat is eliminated.`, "sys");
        spacePanelDirty = true;
        continue;
      }
      for (const s of fleet) {
        s.settle = null; s.landing = null; s.loadFrom = null; // never a new errand
        s.colInv = null; s.escortOf = null; s.guard = null;
        // final defensive retreat: idle remnants rally at the old home world
        if (!s.chase && !s.target && !s.orbit && !s.free) {
          if (rec.home && G.space.planets[rec.home] && !G.space.planets[rec.home].destroyed) s.target = rec.home;
        }
        // surrender if overwhelmed: hurt and outgunned, a remnant strikes its colors
        if (s.hp < s.maxHp * 0.45 && Math.random() < 0.02) {
          const foesNear = G.space.ships.filter(t => t.owner !== rec.aid && atWar(rec.aid, t.owner) &&
            (t.x - s.x) ** 2 + (t.y - s.y) ** 2 + (t.z - s.z) ** 2 < 320 * 320);
          if (foesNear.length >= 3) {
            log(`🏳 A remnant ${UNITS[s.unit].n} of the fallen ${c.name} strikes its colors and powers down.`, "sys");
            removeShip(s);
          }
        }
      }
      continue; // no production, no expansion, no plans — ever again (Part 6)
    }
    // does the civilization still hold anything? (everything lost = extinct)
    const colonies = SPACE_PLANETS.filter(d => {
      const st = G.space.planets[d.id];
      return st.colony && st.colony.owner === rec.aid && !st.destroyed;
    });
    if (!colonies.length && !fleet.length && !ground.length) {
      c.alive = false;
      G.wars = G.wars.filter(w => w.a !== rec.aid && w.b !== rec.aid);
      log(`👁 The ${c.name} have been wiped from the galaxy.`, "war");
      continue;
    }
    // a forced assault expires with its war (Sandbox §13-§14)
    if (rec.assault && (!G.countries[rec.assault.target] || !G.countries[rec.assault.target].alive ||
        !atWar(rec.aid, rec.assault.target))) rec.assault = null;
    // AI Update §12.4: the dominions talk, trade, ally — and occasionally clash
    alienAliensTick(rec);
    // ---- Part 1: posture — heavy losses push the civilization onto the
    // defensive: the fleet comes home, rebuilds, and only returns to the
    // offensive once it stands near full strength again ----
    const T = ALIEN_TIERS[rec.tier];
    if (T.ships > 0) {
      if (fleet.length <= Math.max(1, T.ships) * 0.35) rec.posture = "defensive";
      else if (fleet.length >= T.ships * 0.8) rec.posture = null;
    }
    // scheduled invasions begin (Sandbox §10: never while AI wars are disabled)
    if (rec.warPlan && G.turn >= rec.warPlan.at && !sandboxOn("noAIWars")) {
      const t = rec.warPlan.target;
      rec.warPlan = null;
      if (G.countries[t] && G.countries[t].alive && !atWar(rec.aid, t)) {
        declareWar(rec.aid, t);
        log(`👁 THE ${c.name.toUpperCase()} DESCEND — alien warfleets move against ${G.countries[t].name}!`, "war");
        if (t === G.playerId) { toast(`👁 The ${c.name} have declared war on you!`); sfx("warhorn"); }
      }
    }
    // rebuild fleets slowly (up to the tier cap) — Part 6: only while a real
    // production world survives; the yards died with the colonies
    if (colonies.length && fleet.length < T.ships && --rec.fleetCd <= 0) {
      rec.fleetCd = rec.tier >= 3 ? 7 : 14;
      const wantSD = T.sd && !fleet.some(s => s.unit === "stardestroyer");
      // Alien War AI Fix §3: the dominion keeps a standing transport arm —
      // about one cargo craft per four warships (always one from tier 2 up) —
      // plus any explicit request from a planned invasion (Part 9)
      const cargoN = fleet.filter(s => (UNITS[s.unit].cap || 0) > 0).length;
      const wantCargo = rec.wantCarrier || (rec.tier >= 2 && cargoN < Math.max(1, Math.floor(T.ships / 4)));
      if (rec.wantCarrier) rec.wantCarrier = false;
      alienSpawnShip(rec, wantSD ? "stardestroyer" : wantCargo ? "cargoship" : "starfleet");
    }
    // ---- expansion drive (SU2 Part 2, tempered by Final Alien Update Part 1):
    // the dominion still grows, but deliberately — never while on the defensive
    rec.expandCd = (rec.expandCd || 0) - 1;
    const colonyCap = rec.tier >= 4 ? 7 : rec.tier * 2;
    if (colonies.length && colonies.length < colonyCap && rec.expandCd <= 0 && rec.posture !== "defensive") {
      rec.expandCd = rec.tier >= 3 ? 8 : 13;
      const free = SPACE_PLANETS.filter(d => {
        const st = G.space.planets[d.id];
        // BUG REPORT (star death): aliens shun dead systems too;
        // AI Update §13.3: Void-Shielded systems cannot be settled by aliens
        return d.type !== "main" && st && !st.destroyed && !st.colony && !sunDead(planetSysId(d)) &&
          !voidShieldBlocks(planetSysId(d), rec.aid);
      });
      if (free.length) {
        // prefer worlds in systems they already hold, then push into new systems
        const held = free.filter(d => colonies.some(cd => planetSysId(cd) === planetSysId(d)));
        const dest = pick(held.length && Math.random() < 0.5 ? held : free);
        const settler = fleet.find(s => !s.chase && !s.settle && !s.landing && s.unit !== "stardestroyer");
        if (settler) { settler.settle = dest.id; settler.target = dest.id; settler.orbit = null; }
      }
    }
    // settlers found their colony on arrival
    for (const s of fleet) {
      if (!s.settle) continue;
      const stS = G.space.planets[s.settle];
      if (!stS || stS.destroyed || sunDead(planetSysId(planetDef(s.settle))) ||
          (stS.colony && stS.colony.owner !== rec.aid)) { s.settle = null; continue; }
      if (!stS.colony && shipNearPlanet(s, s.settle)) { alienFound(rec, s.settle); s.settle = null; }
    }
    // Alien War AI Fix §11: a transport with no errand never drifts — loaded,
    // it returns to the nearest colony and unloads into the garrison (evacuees
    // from a failed landing come home this way too); empty, it parks there
    for (const s of fleet) {
      if (!((UNITS[s.unit].cap || 0) > 0)) continue;
      if (s.colInv || s.loadFrom || s.settle || (s.landing !== undefined && s.landing !== null)) continue;
      const nearestColony = () => {
        let bestD = null, bd2 = Infinity;
        for (const d2 of colonies) {
          const p2 = planetPos(d2.id);
          const dd = (s.x - p2.x) ** 2 + (s.z - p2.z) ** 2;
          if (dd < bd2) { bd2 = dd; bestD = d2; }
        }
        return bestD;
      };
      if (!(s.cargo || []).length) {
        if (!s.target && !s.free && !s.orbit && colonies.length) {
          const bestD = nearestColony();
          if (bestD) s.target = bestD.id;
        }
        continue;
      }
      const here = colonies.find(d2 => shipNearPlanet(s, d2.id));
      if (here) {
        if (!battleOn(here.id)) {
          const stH = G.space.planets[here.id];
          while (s.cargo.length) stH.colony.garrison.push(s.cargo.pop());
        }
      } else if (!s.target && !s.free && colonies.length) {
        const bestD = nearestColony();
        if (bestD) { s.target = bestD.id; s.orbit = null; }
      }
    }
    // Final Space Fixes §5: a hyper-advanced dominion may wrap ANOTHER of its
    // secured suns — same rulebook as everyone (colony in system, no rival
    // alien control, one sphere per star; era-9 tech is innate)
    if (rec.tier >= 4 && colonies.length && Math.random() < 0.02) {
      const seenSys = {};
      for (const cd of colonies) {
        const sid = planetSysId(cd);
        if (seenSys[sid]) continue;
        seenSys[sid] = 1;
        if (canBuildDyson(rec.aid, sid).ok && c.res.money > MEGA_DEFS.dyson.cost.money * 1.5 &&
            c.res.mat > MEGA_DEFS.dyson.cost.mat * 1.2) { payDysonStage(rec.aid, sid); break; }
      }
    }
    // develop existing colonies and top their garrisons back up — the CAPITAL
    // is garrisoned first and deepest (Part 3: its major defensive forces)
    if (colonies.length && Math.random() < 0.25) {
      const capId = alienCapitalPlanet(rec);
      const capSt = capId ? G.space.planets[capId] : null;
      if (capSt && !battleOn(capId) && capSt.colony.garrison.length < 3 + rec.tier) {
        const gu = alienUnitOf(rec.tier);
        capSt.colony.garrison.push({ unit: gu, hp: unitMaxHp(gu), maxHp: unitMaxHp(gu) });
      } else {
        const d = pick(colonies);
        const stC = G.space.planets[d.id];
        if (stC.colony.lvl < COLONY_MAX_LVL && Math.random() < 0.5) {
          stC.colony.lvl++;
          spacePanelDirty = true;
        } else if (!battleOn(d.id) && stC.colony.garrison.length < 2 + rec.tier) {
          const gu = alienUnitOf(rec.tier);
          stC.colony.garrison.push({ unit: gu, hp: unitMaxHp(gu), maxHp: unitMaxHp(gu) });
        }
      }
    }
    // wartime: hunt the enemy's colonies; peacetime: patrol home
    const foes = G.wars.filter(w => w.a === rec.aid || w.b === rec.aid).map(w => (w.a === rec.aid ? w.b : w.a))
      .filter(f => G.countries[f] && G.countries[f].alive);
    if (foes.length && rec.posture === "defensive") {
      // Part 1: bloodied — the fleet abandons the offensive, retreats and
      // screens its own worlds until it is rebuilt
      for (const s of fleet) {
        if (s.escortOf) s.escortOf = null; // formation duties end at home
        if (s.settle || s.landing || s.chase) continue;
        if (!s.orbit && !s.target && !s.free) s.target = colonies.length ? pick(colonies).id : (rec.home || null);
      }
    } else if (foes.length) {
      const targets = SPACE_PLANETS.filter(d => {
        const st = G.space.planets[d.id];
        // Update §17.2: a Phantom-Step-cloaked system does not exist to them;
        // AI Update §13.3: a Void-Shielded system is unreachable until broken
        return st.colony && foes.includes(st.colony.owner) && !st.destroyed &&
          !phantomHiddenFrom(planetSysId(d), rec.aid) &&
          !voidShieldBlocks(planetSysId(d), rec.aid);
      });
      // §13.3: fronts sealed behind Void Shields — send the fleet to break the
      // generator down; only then can raids and landings resume there
      const sealedFronts = [];
      for (const sysId2 of Object.keys(G.space.systems || {})) {
        const vs2 = G.space.systems[sysId2].voidShield;
        if (vs2 && !vs2.building && vs2.hp > 0 && foes.includes(Number(vs2.owner)) &&
            voidShieldBlocks(sysId2, rec.aid)) sealedFronts.push(sysId2);
      }
      // §12.3: mauled ships break off and limp home to regroup
      for (const s of fleet) {
        if (s.hp < s.maxHp * 0.35 && !s.settle && !s.harvest && (s.landing === undefined || s.landing === null)) {
          if (s.colInv) { s.colInv = null; s.loadFrom = null; }
          s.chase = null; s.vsTarget = null; s.escortOf = null; s.guard = null;
          if (!s.target && !s.orbit) s.target = colonies.length ? pick(colonies).id : (rec.home || null);
        }
      }
      // ---- §12.1: STANDING ORDERS — at war, the fleet is never idle. Idle
      // warships are committed in small battle groups: raid enemy colonies,
      // hunt enemy fleets (transports first), blockade the enemy homeland,
      // crack Dyson Spheres and besiege Void Shields.
      const foeShips = G.space.ships.filter(t => foes.includes(t.owner) &&
        !phantomShipHiddenFrom(t, rec.aid));
      const foeTransports = foeShips.filter(t => (UNITS[t.unit].cap || 0) > 0);
      // §12.4: enemy warships over the dominion's own worlds are met head-on
      const homeThreats = [];
      for (const cd of colonies) {
        const p2 = planetPos(cd.id);
        for (const t of foeShips) {
          if ((t.x - p2.x) ** 2 + (t.y - p2.y) ** 2 + (t.z - p2.z) ** 2 < 300 * 300) { homeThreats.push(t); break; }
        }
      }
      const homelandFoe = foes.some(f => { const F = G.countries[f]; return F && !isSynthetic(F); }) &&
        !voidShieldBlocks("home", rec.aid);
      // Alien War AI Fix §1: does the dominion have any BUSINESS at the
      // Homeworld right now? Troops fighting on the surface, a loaded landing
      // run inbound, or enemy warships in orbit to engage. A blockade of
      // nothing is no mission — without one of these, nobody flies there.
      const homelandBusy = homelandFoe && (ground.length > 0 ||
        fleet.some(s2 => s2.landing !== undefined && s2.landing !== null && (s2.cargo || []).length));
      const homelandFight = homelandFoe && foeShips.some(t => shipNearPlanet(t, "home"));
      // ---- §1: NO FLEET EVER HOLDS STATION OVER NOTHING. Every orbit and
      // planet errand is re-validated each turn — a world whose colony died,
      // flipped or never existed, a homeland with nothing left to do — the
      // ships drop it and are re-tasked to a REAL objective this same turn.
      for (const s of fleet) {
        if (s.settle || s.colInv || s.loadFrom || s.harvest ||
            (s.landing !== undefined && s.landing !== null)) continue; // those errands validate themselves below
        const spot = s.orbit || s.target;
        if (!spot) continue;
        if (s.unit === "stardestroyer") { // the war brain manages SD errands — only stale orbits are dropped
          if (s.orbit && s.orbit !== "home") {
            const stO = G.space.planets[s.orbit];
            if (!stO || stO.destroyed || !stO.colony ||
                (stO.colony.owner !== rec.aid && !foes.includes(stO.colony.owner))) s.orbit = null;
          }
          continue;
        }
        if (spot === "home") {
          if (!homelandBusy && !homelandFight) { s.orbit = null; s.target = null; }
          continue;
        }
        const dSpot = planetDef(spot), stSpot = G.space.planets[spot];
        const live = dSpot && stSpot && !stSpot.destroyed && stSpot.colony &&
          (stSpot.colony.owner === rec.aid || foes.includes(stSpot.colony.owner));
        if (!live) { s.orbit = null; s.target = null; }
      }
      // ---- §10: escorts hold formation on their charge — a loaded transport
      // or a hunting Star Destroyer never crosses the void alone. They engage
      // whatever menaces the ward and otherwise keep station beside it. ----
      for (const s of fleet) {
        if (!s.escortOf) continue;
        const ward = shipById(s.escortOf);
        const wardBusy = ward && ward.owner === rec.aid && (ward.colInv ||
          (ward.landing !== undefined && ward.landing !== null) ||
          (ward.cargo || []).length > 0 || ward.unit === "stardestroyer");
        if (!wardBusy) { s.escortOf = null; continue; } // the errand is over — stand down
        const menace = foeShips.find(t => (t.x - ward.x) ** 2 + (t.y - ward.y) ** 2 + (t.z - ward.z) ** 2 < 340 * 340);
        if (menace) { if (!s.chase) { s.chase = menace.id; s.orbit = null; s.target = null; s.free = null; } }
        else if (!s.chase) {
          s.orbit = null; s.target = null;
          s.free = { x: ward.x + rnd(-48, 48), y: ward.y + rnd(-10, 10), z: ward.z + rnd(-48, 48) };
        }
      }
      // draft the nearest free warships into an escort screen, n strong
      const assignEscorts = (ward, n) => {
        let have = fleet.filter(s2 => s2.escortOf === ward.id).length;
        if (have >= n) return;
        const free2 = fleet.filter(s2 => s2 !== ward && !s2.escortOf && !s2.guard && !s2.chase &&
          s2.unit !== "stardestroyer" && !((UNITS[s2.unit].cap || 0) > 0) && !s2.settle && !s2.colInv &&
          (s2.landing === undefined || s2.landing === null) && !s2.harvest && !s2.vsTarget &&
          !s2.dysonTarget && s2.hp > s2.maxHp * 0.4)
          .sort((a2, b2) => ((a2.x - ward.x) ** 2 + (a2.z - ward.z) ** 2) - ((b2.x - ward.x) ** 2 + (b2.z - ward.z) ** 2));
        while (have < n && free2.length) {
          const e = free2.shift();
          e.escortOf = ward.id; e.orbit = null; e.target = null;
          e.free = { x: ward.x + rnd(-48, 48), y: ward.y, z: ward.z + rnd(-48, 48) };
          have++;
        }
      };
      // ---- §2: the defence reserve — a share of the navy always stays home,
      // screening the capital and the colonies while the rest campaigns ----
      const warships = fleet.filter(s => s.unit !== "stardestroyer" && !((UNITS[s.unit].cap || 0) > 0));
      const wantGuards = Math.min(warships.length, Math.max(1,
        Math.round(warships.length * ({ warlord: 0.2, aggressive: 0.25 }[rec.per] || 0.34))));
      for (const s of fleet) { // posts that fell release their guards
        if (!s.guard) continue;
        const gst = G.space.planets[s.guard];
        if (!gst || gst.destroyed || !gst.colony || gst.colony.owner !== rec.aid ||
            s.unit === "stardestroyer" || (UNITS[s.unit].cap || 0) > 0) s.guard = null;
      }
      const guards = warships.filter(s => s.guard);
      if (guards.length > wantGuards) for (const s of guards.slice(wantGuards)) s.guard = null;
      if (guards.length < wantGuards && colonies.length) {
        const posts = [];
        const capPost = alienCapitalPlanet(rec);
        if (capPost) posts.push(capPost);
        for (const cd of colonies) if (cd.id !== capPost) posts.push(cd.id);
        const freeG = warships.filter(s2 => !s2.guard && !s2.escortOf && !s2.chase && !s2.settle &&
          !s2.vsTarget && !s2.dysonTarget && !s2.harvest && s2.hp > s2.maxHp * 0.35);
        let pi = 0, gn = guards.length;
        while (gn < wantGuards && freeG.length) {
          const g = freeG.shift();
          g.guard = posts[pi++ % posts.length];
          gn++;
        }
      }
      // guards hold station over their post and pounce on whatever comes close
      for (const s of fleet) {
        if (!s.guard) continue;
        const pG = planetPos(s.guard);
        const menace = foeShips.find(t => (t.x - pG.x) ** 2 + (t.y - pG.y) ** 2 + (t.z - pG.z) ** 2 < 420 * 420);
        if (menace) { if (!s.chase) { s.chase = menace.id; s.orbit = null; s.target = null; s.free = null; } }
        else if (!s.chase && s.orbit !== s.guard && s.target !== s.guard) { s.target = s.guard; s.orbit = null; s.free = null; }
      }
      // ---- §1-§2 STANDING ORDERS, rebuilt: idle warships are matched to
      // REAL objectives, each sized to its target — never the whole navy on
      // one small errand, and never a wave into empty space ----
      const raiding = s2 => { // parked over an enemy colony = mid-raid, working
        if (!s2.orbit || s2.orbit === "home") return false;
        const st2 = G.space.planets[s2.orbit];
        return !!(st2 && st2.colony && foes.includes(st2.colony.owner));
      };
      const idleWar = warships.filter(s => !s.guard && !s.escortOf && s.hp > s.maxHp * 0.35 &&
        !s.chase && !s.target && !s.free && !s.settle && !s.vsTarget && !s.dysonTarget &&
        !s.harvest && !raiding(s));
      if (idleWar.length) {
        const jobs = [];
        const enroute = pid => fleet.filter(s2 => s2.target === pid || s2.orbit === pid).length;
        // 1. drive enemy warships out of the dominion's own skies
        if (homeThreats.length) {
          jobs.push({ score: 100, need: homeThreats.length + 1, at: homeThreats[0],
            go: (s2, i2) => { s2.chase = homeThreats[i2 % homeThreats.length].id; } });
        }
        // 2. hunt enemy troop transports before they can land anything
        for (const t of foeTransports.slice(0, 2)) {
          jobs.push({ score: 46, need: 1, at: t, go: s2 => { s2.chase = t.id; } });
        }
        // 3. the Homeworld — ONLY while there is real business there (§1)
        if (homelandBusy || homelandFight) {
          const hpos = planetPos("home");
          const nearFoes = foeShips.filter(t => shipNearPlanet(t, "home")).length;
          jobs.push({ score: 42, need: Math.min(4, nearFoes + 2), at: hpos,
            have: enroute("home"), go: s2 => { s2.target = "home"; } });
        }
        // 4. break a Void Shield sealing a front
        for (const front of sealedFronts) {
          jobs.push({ score: 34, need: 3, at: systemDef(front),
            have: fleet.filter(s2 => s2.vsTarget === front).length,
            go: s2 => { s2.vsTarget = front; } });
        }
        // 5. besiege an enemy Dyson Sphere (a dangerous megastructure, §8)
        for (const sysId3 of Object.keys(G.space.systems || {})) {
          const dy3 = dysonOfSystem(sysId3);
          if (!dy3 || dy3.stage < 1 || !foes.includes(Number(dy3.owner))) continue;
          if (phantomHiddenFrom(sysId3, rec.aid)) continue;
          jobs.push({ score: 30, need: 3, at: systemDef(sysId3),
            have: fleet.filter(s2 => s2.dysonTarget === sysId3).length,
            go: s2 => { s2.dysonTarget = sysId3; } });
        }
        // 6. tear down an enemy Researcher station
        for (const r3 of (G.space.researchers || [])) {
          if (r3.destroyed || !foes.includes(Number(r3.owner))) continue;
          if (phantomHiddenFrom(systemAt(r3.x, r3.z).id, rec.aid)) continue;
          jobs.push({ score: 24, need: 2, at: r3,
            have: fleet.filter(s2 => s2.free && (s2.free.x - r3.x) ** 2 + (s2.free.z - r3.z) ** 2 < 90 * 90).length,
            go: s2 => { s2.free = { x: r3.x + rnd(-40, 40), y: r3.y || 0, z: r3.z + rnd(-40, 40) }; } });
        }
        // 7. the enemy's Black Hole Harvester
        const bh3 = G.space.bhH, bhp3 = galaxyBH();
        if (bh3 && !bh3.ruins && bhp3 && foes.includes(Number(bh3.owner))) {
          jobs.push({ score: 28, need: 3, at: bhp3,
            have: fleet.filter(s2 => s2.free && (s2.free.x - bhp3.x) ** 2 + (s2.free.z - bhp3.z) ** 2 < 200 * 200).length,
            go: s2 => { s2.free = { x: bhp3.x + rnd(-150, 150), y: rnd(-16, 16), z: bhp3.z + rnd(-150, 150) }; } });
        }
        // 8. raid enemy colonies — squads sized to the orbital defence, with
        //    richer, weaker and closer worlds first (§2, §5)
        for (const d of targets) {
          const stT2 = G.space.planets[d.id];
          const pT = planetPos(d.id);
          const orbitGuards = foeShips.filter(t => (t.x - pT.x) ** 2 + (t.y - pT.y) ** 2 + (t.z - pT.z) ** 2 < (planetNearR(d) * 1.7) ** 2).length;
          let v = 16 + stT2.colony.lvl * 2 + (stT2.halo && stT2.halo.done ? 5 : 0) - orbitGuards * 3;
          if (colonies.some(cd2 => planetSysId(cd2) === planetSysId(d))) v += 6; // on the doorstep
          jobs.push({ score: v, need: Math.min(4, orbitGuards + (orbitGuards ? 2 : 1)), at: pT,
            have: enroute(d.id), go: s2 => { s2.target = d.id; } });
        }
        // 9. hunt the enemy fleet at large
        if (foeShips.length) {
          jobs.push({ score: 12, need: 2, at: foeShips[0],
            go: (s2, i2) => { s2.chase = foeShips[i2 % foeShips.length].id; } });
        }
        jobs.sort((a2, b2) => b2.score - a2.score);
        const pool = idleWar.slice();
        for (const job of jobs) {
          let slots = job.need - (job.have || 0);
          while (slots > 0 && pool.length) {
            pool.sort((a2, b2) => ((a2.x - job.at.x) ** 2 + (a2.z - job.at.z) ** 2) - ((b2.x - job.at.x) ** 2 + (b2.z - job.at.z) ** 2));
            const s2 = pool.shift();
            s2.orbit = null; s2.target = null; s2.free = null;
            job.go(s2, job.need - slots);
            slots--;
          }
          if (!pool.length) break;
        }
        // §1/§11: whatever found no worthy objective falls back to screening
        // the dominion's own worlds — never a fleet loitering in the void
        for (const s2 of pool) {
          if (colonies.length) s2.target = pick(colonies).id;
          else if (rec.home && G.space.planets[rec.home] && !G.space.planets[rec.home].destroyed) s2.target = rec.home;
        }
      }
      // raids: alien ships parked over an enemy colony grind its garrison down.
      // BUG REPORT (Final Fixes §4-§6): orbital fire only SOFTENS a colony — it
      // can never capture one. Ownership changes only when real alien troops,
      // carried in by a real cargo craft, land and win the ground battle below.
      for (const d of targets) {
        const st = G.space.planets[d.id];
        if (battleOn(d.id)) continue; // a ground battle rages — the garrison is engaged below
        if (!st.colony.garrison.length) continue; // silenced — now the troops must land
        const p = planetPos(d.id);
        const over = fleet.filter(s => (s.x - p.x) ** 2 + (s.y - p.y) ** 2 + (s.z - p.z) ** 2 < (PLANET_NEAR * 1.4) ** 2);
        if (!over.length) continue;
        let dmg = over.reduce((sum, s) => sum + UNITS[s.unit].atk * 0.15, 0);
        for (const g of st.colony.garrison) { g.hp -= dmg / Math.max(1, st.colony.garrison.length); }
        st.colony.garrison = st.colony.garrison.filter(g => g.hp > 0);
        spaceBoom(p, d.r + 6, "invade");
        if (!st.colony.garrison.length && st.colony.owner === G.playerId) {
          toast(`👁 The ${c.name} have silenced the garrison on ${d.n} — expect a landing!`);
        }
      }
      // BUG REPORT Final Fixes §4+§6: the REAL colony-invasion path. A cargo
      // craft loads troops out of an alien garrison, crosses to the enemy
      // colony and lands them there. resolveInvasion opens the same real-time
      // ground battle the player gets — the aliens attack from the drop zone,
      // and the colony's actual owner defends with its own garrison, turrets
      // and defensive structures. AI-vs-AI landings use the fast resolution.
      // The cargo bay empties into the battle line, so troop counts stay real.
      rec.colCd = (rec.colCd || 0) - 1;
      // Alien War AI Fix §3-§6/§9: the dominion picks the WORTHIEST enemy
      // colony (weakly held, valuable, close to its own space, winnable — not
      // a random draw), loads real troops out of a garrison into a real cargo
      // craft and sails it there behind an escort screen sized to the orbital
      // defence. §4: a CLEAR orbit gets a token escort and a cargo-first run —
      // occupation, not an armada. Advanced dominions run two landings at once.
      const maxOps = 1 + (rec.tier >= 3 ? 1 : 0);
      const opsNow = fleet.filter(s => s.colInv).length;
      if (targets.length && rec.colCd <= 0 && opsNow < maxOps) {
        // a forced assault (Sandbox §13) keeps the landings coming faster
        rec.colCd = rec.assault ? (rec.assault.intensity === "total" ? 6 : 10)
          : rec.per === "warlord" ? 10 : rec.per === "aggressive" ? 14 : 18;
        const invCarriers = fleet.filter(s => UNITS[s.unit].cap && !s.settle &&
          (s.landing === undefined || s.landing === null) && !s.colInv);
        if (!invCarriers.length) {
          rec.wantCarrier = true; // the shipyards must lay down a transport first
        } else {
          const preloaded = invCarriers.find(s => (s.cargo || []).length >= 2);
          const carrier = preloaded || invCarriers.find(s => !(s.cargo || []).length);
          const src = colonies.find(d2 => G.space.planets[d2.id].colony.garrison.length >= 2);
          if (carrier && (preloaded || src)) {
            const gu2 = alienUnitOf(rec.tier);
            const punch = (UNITS[gu2].atk + UNITS[gu2].def * 0.3) * 0.5 * Math.min(UNITS[carrier.unit].cap || 1, 1 + rec.tier);
            let best = null, bv = -Infinity, bGuards = 0;
            for (const d of targets) {
              if (battleOn(d.id)) continue;
              const stV = G.space.planets[d.id];
              const pV = planetPos(d.id);
              const orbitGuards = foeShips.filter(t => (t.x - pV.x) ** 2 + (t.y - pV.y) ** 2 + (t.z - pV.z) ** 2 < (planetNearR(d) * 1.7) ** 2).length;
              const defc = colonyDefence(d.id);
              let v = stV.colony.lvl * 3 + (stV.halo && stV.halo.done ? 4 : 0) +
                ((G.countries[stV.colony.owner] || {}).spaceCapital === d.id ? 5 : 0);
              v -= orbitGuards * 4;                                          // §5: weakly defended first
              v += defc <= punch * 1.2 ? 6 : defc >= punch * 2.4 ? -8 : 0;   // §6: winnable beats fortress
              if (colonies.some(cd2 => planetSysId(cd2) === planetSysId(d))) v += 4; // near alien territory
              v -= ((rec.invFail || {})[d.id] || 0) * 3;                     // bled there before
              if (v > bv) { bv = v; best = d; bGuards = orbitGuards; }
            }
            if (best) {
              carrier.colInv = best.id;
              if (preloaded) { carrier.loadFrom = null; carrier.target = best.id; }
              else { carrier.loadFrom = src.id; carrier.target = src.id; }
              carrier.orbit = null;
              assignEscorts(carrier, bGuards === 0 ? 1 : Math.min(3, bGuards + 1));
            }
          }
        }
      }
      for (const s of fleet) {
        if (!s.colInv) continue;
        if (!UNITS[s.unit].cap) { s.colInv = null; continue; }
        const stT = G.space.planets[s.colInv];
        if (!stT || stT.destroyed || !stT.colony || stT.colony.owner === rec.aid ||
            !atWar(rec.aid, stT.colony.owner)) {
          // §1: the target is gone (destroyed, flipped, peace) — stand down
          s.colInv = null; s.loadFrom = null; s.invWait = 0; continue;
        }
        // step 1: load real troops OUT of one of their own colony garrisons
        if (s.loadFrom) {
          const stC = G.space.planets[s.loadFrom];
          if (!stC || !stC.colony || stC.colony.owner !== rec.aid) { s.loadFrom = null; s.colInv = null; continue; }
          if (shipNearPlanet(s, s.loadFrom)) {
            s.cargo = s.cargo || [];
            const cap = Math.min(UNITS[s.unit].cap || 0, 1 + rec.tier);
            while (s.cargo.length < cap && stC.colony.garrison.length > 1) s.cargo.push(stC.colony.garrison.pop());
            s.loadFrom = null;
            if (s.cargo.length) { s.target = s.colInv; s.orbit = null; }
            else s.colInv = null; // the garrison had nothing to spare
          } else if (!s.target && !s.free) { s.target = s.loadFrom; s.orbit = null; }
          continue;
        }
        // step 2: no troops aboard = no invasion, ever — attackers are never
        // conjured inside the battle (§3)
        if (!(s.cargo || []).length) { s.colInv = null; continue; }
        // step 3: arrive and land — the battle takes its troops from the bays
        if (shipNearPlanet(s, s.colInv)) {
          if (resolveInvasion(s, s.colInv)) { s.colInv = null; s.invWait = 0; }
          else if ((s.invWait = (s.invWait || 0) + 1) > 6) {
            // §11: the window never opened (orbit still held against us) —
            // abort and carry the troops home instead of dying on station
            s.colInv = null; s.invWait = 0;
            if (colonies.length) { s.target = colonies[0].id; s.orbit = null; }
          }
          // else: hold on station while the escorts clear the orbit —
          // startPlanetBattle refuses to land under enemy guns
        } else if (!s.target && !s.free) { s.target = s.colInv; s.orbit = null; }
      }
      // ---- AI Update §17: the Star Destroyer is a strategic superweapon,
      // not a damage ship — the full ability set, used deliberately ----
      const sd = fleet.find(s => s.unit === "stardestroyer");
      if (sd && !sd.harvest) {
        alienSDWar(rec, c, sd, fleet, foes, targets, sealedFronts);
        // §10: a Star Destroyer on the move hunts behind an escort screen
        if (sd.target || sd.free || sd.dysonTarget || sd.vsTarget) assignEscorts(sd, rec.tier >= 4 ? 2 : 1);
      }
      // ---- invasion of the Homeworld (Parts 9-10: real transport logistics) ----
      // 1. recruit troops into a colony garrison (the develop tick above)
      // 2. fly a CARGO craft there and load them (limited capacity)
      // 3. cross to the Homeworld  4. deploy what is aboard
      // Reinforcements repeat the whole journey; a transport shot down on the
      // way takes its troops with it, and no cargo craft in orbit = no landing.
      const landFoes = foes.filter(f => {
        const F = G.countries[f];
        return F && !isSynthetic(F) && provsOfNation(f).length;
      });
      // AI Update §13.3: a Void Shield over the homeland stops every landing —
      // the standing orders above are already battering the generator down
      if (landFoes.length && rec.tier >= 2 && !homeworldScorched() && !voidShieldBlocks("home", rec.aid)) {
        rec.invadeCd = (rec.invadeCd || 0) - 1;
        const groundForce = ground.length;
        const carriers = fleet.filter(s => UNITS[s.unit].cap && !s.settle);
        // Final Alien Update Part 1: landings are RARE and need justification —
        // smaller waves, longer pauses, and a real cause to cross the void.
        // A forced mainland assault (Sandbox §14) IS the justification, and it
        // fields bigger waves at a faster drumbeat.
        const assaultHere = rec.assault && rec.assault.mainland && landFoes.includes(rec.assault.target) ? rec.assault : null;
        const groundCap = (rec.per === "warlord" ? rec.tier * 3 : rec.tier * 2) *
          (assaultHere && assaultHere.intensity === "total" ? 2 : 1);
        if (rec.invadeCd <= 0 && groundForce < groundCap) {
          rec.invadeCd = assaultHere ? (assaultHere.intensity === "total" ? 8 : 14)
            : rec.per === "warlord" ? 15 : 24;
          const justified = f => {
            if (assaultHere && assaultHere.target === f) return true; // ordered from above
            if (rec.per === "warlord") return true;                 // hunger is cause enough
            if ((rec.grudge || {})[f] >= 2) return true;            // they bled us in space
            const w = G.wars.find(x => (x.a === rec.aid && x.b === f) || (x.b === rec.aid && x.a === f));
            if (w && w.a === f) return true;                        // they declared this war
            return !!w && (w.start || 0) <= G.turn - 25;            // a long, grinding war
          };
          const okFoes = landFoes.filter(justified);
          // Alien War AI Fix §5: with enemy COLONIES on the board, the
          // homeland is no longer the default — the transports usually go to
          // the colony front first (warlords and ordered assaults excepted)
          const colonyFirst = targets.length > 0 && !assaultHere && rec.per !== "warlord" && Math.random() < 0.5;
          if (!okFoes.length || colonyFirst) {
            // no strong cause yet (or the colonies come first) — hold in own space
          } else if (!carriers.length) {
            rec.wantCarrier = true; // the shipyards lay down a transport first
          } else {
            const idle = carriers.find(s => (s.landing === undefined || s.landing === null) && !s.colInv && !(s.cargo || []).length);
            if (idle) {
              // pick a colony that can spare soldiers (one always stays behind)
              const src = colonies.find(d => G.space.planets[d.id].colony.garrison.length >= 2);
              const mark = assaultHere && okFoes.includes(assaultHere.target) ? assaultHere.target : pick(okFoes);
              if (src) {
                idle.loadFrom = src.id; idle.landing = mark; idle.target = src.id; idle.orbit = null;
                // §2/§4: a homeland run is a major operation — escort it like
                // one when the orbit is held, lightly when the window is clear
                const homeGuards = foeShips.filter(t => shipNearPlanet(t, "home")).length;
                assignEscorts(idle, homeGuards === 0 ? 1 : Math.min(3, homeGuards + 1));
              }
            }
          }
        }
        for (const s of carriers) {
          if (s.landing === undefined || s.landing === null) continue;
          if (!atWar(rec.aid, s.landing) || !G.countries[s.landing] || !G.countries[s.landing].alive) {
            s.landing = null; s.loadFrom = null; continue;
          }
          // step 2: load troops OUT of the source colony's garrison
          if (s.loadFrom) {
            const stC = G.space.planets[s.loadFrom];
            if (!stC || !stC.colony || stC.colony.owner !== rec.aid) { s.loadFrom = null; s.landing = null; continue; }
            if (shipNearPlanet(s, s.loadFrom)) {
              s.cargo = s.cargo || [];
              const cap = Math.min(UNITS[s.unit].cap || 0, 1 + rec.tier);
              while (s.cargo.length < cap && stC.colony.garrison.length > 1) {
                s.cargo.push(stC.colony.garrison.pop());
              }
              s.loadFrom = null;
              if (s.cargo.length) { s.target = "home"; s.orbit = null; }
              else s.landing = null; // the garrison had nothing to spare
            } else if (!s.target && !s.free) { s.target = s.loadFrom; s.orbit = null; }
            continue;
          }
          // steps 3-4: cross to the Homeworld and deploy the troops aboard
          if (!(s.cargo || []).length) { s.landing = null; continue; }
          if (shipNearPlanet(s, "home")) { alienLandTroops(rec, s, s.landing); s.landing = null; }
          else if (!s.target && !s.free) { s.target = "home"; s.orbit = null; }
        }
      }
    } else {
      // peacetime: the fleet spreads out and patrols the dominion's worlds —
      // a black-hole guard presence (Update §6) loiters at the core instead
      for (const s of fleet) {
        if (s.colInv) { s.colInv = null; s.loadFrom = null; } // the war is over — stand the landing down
        if (s.escortOf) s.escortOf = null;                    // formations dissolve
        if (s.guard) s.guard = null;                          // guard posts stand down
        if (s.invWait) s.invWait = 0;
        if (s.settle || s.landing) continue;
        if (rec.bhGuard && !s.orbit && !s.target && !s.chase && !s.free && Math.random() < 0.5) {
          const bh2 = galaxyBH();
          if (bh2) { s.free = { x: bh2.x + rnd(-170, 170), y: rnd(-18, 18), z: bh2.z + rnd(-170, 170) }; continue; }
        }
        if (!s.orbit && !s.target && !s.chase) {
          s.target = colonies.length ? pick(colonies).id : (rec.home || null);
        }
      }
    }
  }
  alienDetectionRoll();
  alienProximityContacts();
  // BUG REPORT §2 "exploration data is updated": re-sweep charted space every
  // turn, so civilizations that expand or fly INTO revealed systems register
  alienDiscoveryScan();
}
// player ↔ alien parley (Part 11) — simple, personality-driven outcomes
function alienTalk(cid, aid, act) {
  const rec = alienById(aid);
  const c = G.countries[cid], A = G.countries[aid];
  if (!rec || !A || !A.alive) return { ok: false, msg: "No signal." };
  if (rec.defeated) return { ok: false, msg: "Only broken static answers — this civilization has fallen. Its remnants take no orders and make no deals." };
  if (!rec.contacted.includes(Number(cid))) return { ok: false, msg: "No contact has been established with them." };
  const rel = G.rel[aid][cid] || 0;
  switch (act) {
    case "hail": {
      if (rec.talkCd > 0) return { ok: false, msg: "The channel is silent — try again later." };
      rec.talkCd = 3;
      G.rel[aid][cid] = clamp(rel + 3, -100, 100);
      const lines = {
        peaceful: "A warm cascade of light answers: the void is wide enough for all.",
        cautious: "A measured pulse returns: they are watching. Watching very closely.",
        aggressive: "A curt burst of static — then coordinates of your colonies, repeated back to you. A warning.",
        warlord: "A single image returns: a shattered planet. Then silence.",
      };
      return { ok: true, msg: lines[rec.per] + " (+3 relations)" };
    }
    case "trade": {
      if (atWar(aid, Number(cid))) return { ok: false, msg: "They do not trade with enemies." };
      if (rec.tradeCd > 0) return { ok: false, msg: "Their convoys will not return for a while." };
      if (rel < -10) return { ok: false, msg: "They do not trust you enough to trade." };
      if (c.res.money < 2000) return { ok: false, msg: "An exchange needs 2000💰." };
      c.res.money -= 2000;
      c.res.mat += 1800; c.res.energy += 400;
      rec.tradeCd = 5;
      G.rel[aid][cid] = clamp(rel + 5, -100, 100);
      return { ok: true, msg: "Alien convoys deliver exotic matter: +1800⛏ +400⚡ (+5 relations).", sfx: "coin" };
    }
    case "ally": {
      if (atWar(aid, Number(cid))) return { ok: false, msg: "There is a war between you." };
      if (rel < 50) return { ok: false, msg: "They are not close enough to you for that (relations 50+)." };
      if (!allied(Number(cid), Number(aid))) {
        G.alliances.push([Number(cid), Number(aid)]);
        return { ok: true, msg: `The ${A.name} accept — an alliance across the stars!` };
      }
      return { ok: false, msg: "Already allied." };
    }
    case "threat": {
      const myFleet = shipsOfNation(cid).length;
      const theirFleet = G.space.ships.filter(s => s.owner === Number(aid)).length;
      G.rel[aid][cid] = clamp(rel - 15, -100, 100);
      if ((rec.per === "aggressive" || rec.per === "warlord") && rec.tier >= 2 && Math.random() < 0.5) {
        if (!atWar(aid, Number(cid))) declareWar(Number(aid), Number(cid));
        return { ok: true, msg: "They answer threats the only way they know: WAR." };
      }
      if (myFleet > theirFleet * 2) return { ok: true, msg: "Their signals dim. They have taken your measure — and are afraid. (−15 relations)" };
      return { ok: true, msg: "Your threat is archived. They are not impressed. (−15 relations)" };
    }
    case "war": {
      if (atWar(aid, Number(cid))) return { ok: false, msg: "Already at war." };
      declareWar(Number(cid), Number(aid));
      return { ok: true, msg: `War declared on the ${A.name}.` };
    }
    case "peace": {
      if (!atWar(aid, Number(cid))) return { ok: false, msg: "You are not at war." };
      const tribute = 3000 * rec.tier;
      const accept = rec.per === "peaceful" || (rec.per === "cautious" && rel > -40) ||
        (rec.per !== "warlord" && c.res.money >= tribute && rel > -60);
      if (!accept) return { ok: false, msg: "They fight on. Their answer is fire." };
      if (rec.per !== "peaceful" && rec.per !== "cautious") {
        if (c.res.money < tribute) return { ok: false, msg: `They demand a tribute of ${tribute}💰 for peace.` };
        c.res.money -= tribute;
      }
      makePeace(Number(cid), Number(aid), false);
      return { ok: true, msg: `Peace with the ${A.name}${rec.per !== "peaceful" && rec.per !== "cautious" ? ` — for a tribute of ${tribute}💰` : ""}.` };
    }
  }
  return { ok: false, msg: "…" };
}

// ============ Sandbox Improvement §4-§8 — the galaxy tools ============
// Single-player creative tools (Sandbox is disabled in multiplayer). Every
// tool routes through the same state the real game uses, so nothing here can
// desynchronise saves — it only skips the waiting.

// §4: zero every ability cooldown belonging to one nation (default: the player)
function sandboxSkipCooldowns(cid) {
  if (!G) return 0;
  cid = Number(cid === undefined ? G.playerId : cid);
  let n = 0;
  const zero = (o, k) => { if (o && o[k] > 0) { o[k] = 0; n++; } };
  for (const s of (G.space && G.space.ships) || []) if (s.owner === cid) { zero(s, "novaCd"); zero(s, "hlCd"); zero(s, "omniCd"); zero(s, "harvestCd"); }
  for (const a of G.armies || []) if (a.owner === cid) { zero(a, "novaCd"); zero(a, "hlCd"); zero(a, "omniCd"); zero(a, "harvestCd"); }
  for (const r of (G.space && G.space.researchers) || []) if (r.owner === cid) zero(r, "cd");
  const c = G.countries[cid];
  if (c) {
    zero(c, "capitalCd"); zero(c, "recruitCd"); zero(c, "govCooldown"); zero(c, "revCd");
    if ((c.phantomCdUntil || 0) > G.turn) { c.phantomCdUntil = 0; n++; } // Phantom Step ready again
  }
  const bhH = G.space && G.space.bhH;
  if (bhH && Number(bhH.owner) === cid) zero(bhH, "cd");
  for (const sysId of Object.keys((G.space && G.space.systems) || {})) {
    const st = G.space.systems[sysId];
    if (st.harvestCd > 0) { st.harvestCd = 0; n++; } // per-sun harvest rest, if present
  }
  return n;
}
// §5: reveal every solar system, star, planet and known structure at once —
// revealSystem() runs the centralized alien-discovery scan for each, so every
// visible civilization lands in 👁 Known Civilizations immediately
function sandboxRevealAll() {
  ensureSpaceState();
  let fresh = 0;
  for (const sys of SPACE_SYSTEMS) if (revealSystem(sys.id)) fresh++;
  log(`🧪 Sandbox: the entire galaxy stands revealed${fresh ? ` — ${fresh} new system${fresh > 1 ? "s" : ""} charted` : ""}.`, "sys");
  spacePanelDirty = true;
  return fresh;
}
// §7: create an alien civilization on a chosen valid planet. Mirrors the
// natural spawner (ensureAliens): a real country, a capital colony with a
// garrison, a tier-appropriate fleet — and registration in Known Civilizations
// the moment its system is visible.
const SANDBOX_ALIEN_COLS = [[235, 120, 200], [130, 240, 190], [255, 180, 90], [150, 200, 255], [220, 130, 130], [190, 255, 140], [255, 240, 130], [180, 150, 255]];
function sandboxAddAlien(planetId, tier) {
  ensureSpaceState();
  const def = planetDef(planetId), st = planetState(planetId);
  if (!def || def.type === "main") return { ok: false, msg: "Aliens cannot be seeded on the Homeworld." };
  if (!st || st.destroyed) return { ok: false, msg: "Only debris remains of that world — pick an intact planet." };
  if (st.colony) return { ok: false, msg: "That world is already colonized." };
  const sysId = planetSysId(def);
  if (sunDead(sysId)) return { ok: false, msg: "The system's star is dead — nothing can live there." };
  tier = clamp(Number(tier) || irnd(1, 4), 1, 4);
  let aid = ALIEN_BASE_ID;
  while (G.countries[aid]) aid++;
  const perPool = tier === 1 ? ["peaceful"] :
    tier === 2 ? ["peaceful", "cautious", "aggressive"] :
    tier === 3 ? ["cautious", "aggressive"] : ["cautious", "aggressive", "warlord"];
  const per = pick(perPool);
  const species = pick(ALIEN_SPECIES);
  const name = genAlienName(aid) + (tier >= 3 ? " Dominion" : tier === 2 ? " Combine" : " Tribes");
  const c = makeAlienCountry(aid, name, species, tier, per, pick(SANDBOX_ALIEN_COLS));
  const T = ALIEN_TIERS[tier];
  const rec = { aid, sys: sysId, tier, per, contacted: [], knows: {}, fleetCd: 0, sdCd: 30, talkCd: 0, tradeCd: 0, expandCd: irnd(4, 12), invadeCd: irnd(6, 16), grudge: {}, defeated: false };
  // §0: a hand-seeded civilization may predate the space milestone — it must
  // never mark the galaxy's natural generation as already done
  G.space.aliens = G.space.aliens || [];
  if (G.space.aliensGen === undefined) G.space.aliensGen = 0;
  G.space.aliens.push(rec);
  st.colony = { owner: aid, lvl: Math.min(5, tier), garrison: [] };
  const gu = alienUnitOf(tier);
  for (let i = 0; i < 3 + tier; i++) st.colony.garrison.push({ unit: gu, hp: unitMaxHp(gu), maxHp: unitMaxHp(gu) });
  if (T.shield) st.shield = makeShield(aid);
  rec.home = def.id; rec.capital = def.id;
  for (let i = 0; i < T.ships; i++) alienSpawnShip(rec, i === 0 && T.sd ? "stardestroyer" : (i === 1 && tier >= 2 ? "cargoship" : "starfleet"));
  if (T.dyson && !dysonAt(sysId) && !sunDead(sysId)) G.space.systems[sysId].dyson = { owner: aid, stage: 3, hp: DYSON_HP, alien: true };
  log(`🧪 Sandbox: the ${name} — a ${ALIEN_TIERS[tier].n.toLowerCase()} alien civilization — awaken on ${def.n}.`, "sys");
  if (systemRevealed(sysId) && !phantomActive(sysId)) alienRegisterEverywhere(rec, sysId);
  spacePanelDirty = true;
  return { ok: true, msg: `The ${name} (${ALIEN_TIERS[tier].n}) now dwell on ${def.n}.`, aid };
}
// §8: instant destruction — bypasses health, shields and combat entirely.
// The black hole (and the Homeworld, which the game already protects) stay
// indestructible; alien capitals falling this way still fell their empires.
function sandboxDestroyShip(s) {
  if (!s) return false;
  spaceBoom(s, 16, "ship");
  log(`🧪 Sandbox: ${UNITS[s.unit].n} of ${G.countries[s.owner] ? G.countries[s.owner].name : "?"} deleted.`, "sys");
  removeShip(s);
  spacePanelDirty = true;
  return true;
}
function sandboxDestroyColony(planetId) {
  const st = planetState(planetId), def = planetDef(planetId);
  if (!st || !st.colony) return false;
  const owner = st.colony.owner;
  st.colony = null; st.halo = null;
  spaceBoom(planetPos(planetId), def.r + 8, "invade");
  log(`🧪 Sandbox: the colony on ${def.n} is erased.`, "sys");
  alienCapitalFalls(planetId, null, "destroyed");
  if (owner === G.playerId && G.countries[owner].spaceCapital === planetId) G.countries[owner].spaceCapital = null;
  spacePanelDirty = true;
  return true;
}
function sandboxDestroyPlanet(planetId) {
  const st = planetState(planetId), def = planetDef(planetId);
  if (!st || !def || def.type === "main" || st.destroyed) return false;
  st.destroyed = true; st.colony = null; st.halo = null; st.shield = null; st.rehab = null;
  for (const c2 of Object.keys(G.countries)) {
    if (G.countries[c2].spaceCapital === planetId) G.countries[c2].spaceCapital = null;
  }
  spaceShatter(planetPos(planetId), def);
  sfx("nukeBoom");
  log(`🧪 Sandbox: ${def.n} is deleted from the heavens.`, "sys");
  alienCapitalFalls(planetId, null, "destroyed");
  spacePanelDirty = true;
  return true;
}
function sandboxDestroyResearcher(rid) {
  const r = researcherById(rid);
  if (!r || r.destroyed) return false;
  r.destroyed = true; r.shield = null;
  spaceBoom(r, 26, "ship");
  log(`🧪 Sandbox: the Researcher megastructure is deleted.`, "sys");
  spacePanelDirty = true;
  return true;
}
function sandboxDestroyDyson(sysId) {
  if (!dysonAt(sysId)) return false;
  destroyDyson(sysId, G.playerId);
  return true;
}
function sandboxDestroyVoidShield(sysId) {
  if (!voidShieldAt(sysId)) return false;
  destroyVoidShield(sysId, G.playerId);
  return true;
}
function sandboxDestroyHarvester() {
  if (!G.space.bhH || G.space.bhH.ruins) return false;
  destroyBHHarvester(G.playerId);
  return true;
}

// ---------------- per-economic-tick work (called from endTurn) ----------------
function spaceTurnTick() {
  if (!G.space) return;
  ensureSpaceState();
  // halo construction advances
  for (const def of SPACE_PLANETS) {
    const st = G.space.planets[def.id];
    if (st && st.halo && !st.halo.done) {
      st.halo.prog++;
      if (st.halo.prog >= st.halo.need) {
        st.halo.done = true;
        log(`⭕ The Halo Ring over ${def.n} is complete — a new world in the sky.`, st.halo.owner === G.playerId ? "good" : "sys");
        if (st.halo.owner === G.playerId) sfx("era");
        spacePanelDirty = true;
      }
    }
    // Rehabilitators grind on (Part 3)
    if (st && st.rehab) {
      st.rehab.prog++;
      if (st.rehab.prog >= st.rehab.need) finishRehab(def.id);
    }
    // garrisons rest and heal between battles (never during one — Part 8)
    if (st && st.colony && !battleOn(def.id)) for (const g of st.colony.garrison) g.hp = Math.min(g.maxHp, g.hp + g.maxHp * 0.02);
  }
  // dyson stages advance — the home sphere and every system sphere alike
  // (Final Space Fixes §2: spheres can rise around any secured star)
  const dySites = [["home", G.space.dyson]];
  for (const sysId of Object.keys(G.space.systems || {})) {
    if (G.space.systems[sysId].dyson) dySites.push([sysId, G.space.systems[sysId].dyson]);
  }
  for (const [dySys, dy] of dySites) {
    if (!dy || !dy.building) continue;
    dy.prog++;
    if (dy.prog >= MEGA_DEFS.dyson.ticks) {
      dy.stage++; dy.prog = 0; dy.building = false;
      if (dy.hp === undefined) dy.hp = DYSON_HP;
      const done = dy.stage >= MEGA_DEFS.dyson.stages;
      log(done
        ? `☀ ${G.countries[dy.owner].name} COMPLETES THE DYSON SPHERE around ${systemDef(dySys).n} — the star is harnessed!`
        : `☀ Dyson Sphere stage ${dy.stage}/${MEGA_DEFS.dyson.stages} around ${systemDef(dySys).n} complete (+${MEGA_DEFS.dyson.energyPerStage}⚡).`,
        dy.owner === G.playerId ? "good" : "sys");
      if (dy.owner === G.playerId) sfx("era");
      spacePanelDirty = true;
    }
  }
  // AI Update §13: Void Shield generators rise stage by stage; a completed
  // barrier expels alien fleets caught inside — they withdraw past the edge
  for (const sysId of Object.keys(G.space.systems || {})) {
    const vs = G.space.systems[sysId].voidShield;
    if (!vs || !vs.building) continue;
    vs.prog++;
    if (vs.prog >= (vs.need || VOID_SHIELD.ticks)) {
      vs.building = false; vs.prog = 0; vs.hp = vs.maxHp;
      const sys = systemDef(sysId);
      log(`🌐 THE VOID SHIELD around ${sys.n} IS COMPLETE — alien fleets can no longer enter, colonize or invade the system.`, vs.owner === G.playerId ? "good" : "sys");
      if (vs.owner === G.playerId) sfx("era");
      const R = voidShieldRadius(sysId);
      for (const s of G.space.ships) {
        if (!voidShieldBlocks(sysId, s.owner)) continue;
        const dx = s.x - sys.x, dz = s.z - sys.z;
        const d = Math.sqrt(dx * dx + dz * dz) || 1;
        if (d < R) { // pushed out through the nearest point of the barrier
          s.target = null; s.orbit = null; s.settle = null; s.chase = null;
          if (s.landing !== undefined) s.landing = null;
          if (s.colInv) { s.colInv = null; s.loadFrom = null; }
          s.free = { x: sys.x + dx / d * (R + 120), y: s.y, z: sys.z + dz / d * (R + 120) };
        }
      }
      spacePanelDirty = true;
    }
  }
  // Star Destroyer core cannons & hyper lazers recharge; researchers and capitals tick
  for (const s of G.space.ships) { if (s.novaCd > 0) s.novaCd--; if (s.hlCd > 0) s.hlCd--; if (s.omniCd > 0) s.omniCd--; if (s.harvestCd > 0) s.harvestCd--; }
  for (const a of G.armies || []) { if (a.novaCd > 0) a.novaCd--; if (a.hlCd > 0) a.hlCd--; if (a.omniCd > 0) a.omniCd--; if (a.harvestCd > 0) a.harvestCd--; }
  // Small Update §8: debris from a murdered solar system rains across the galaxy
  tickMeteorShower();
  // Update §9: the Harvester rises in visible stages (unless paused under fire)
  const bhH = G.space.bhH;
  if (bhH && !bhH.ruins) {
    if (bhH.cd > 0) bhH.cd--;
    if (bhH.building && !bhH.paused) {
      bhH.prog++;
      if (bhH.prog >= BH_HARVESTER.ticksPerStage) {
        bhH.building = false; bhH.prog = 0; bhH.stage++;
        if (bhH.stage >= BH_HARVESTER.stages) {
          bhH.shield = { owner: bhH.owner, hp: BH_HARVESTER.shield, maxHp: BH_HARVESTER.shield };
          bhH.hp = bhH.maxHp;
          log(`🕳 THE ${BH_HARVESTER.n.toUpperCase()} IS COMPLETE — ${G.countries[bhH.owner] ? G.countries[bhH.owner].name : "?"} taps the galactic core for unlimited Omni-Laser charges.`, "war");
          if (bhH.owner === G.playerId) { toast("🕳 The Black Hole Energy Harvester is OPERATIONAL."); sfx("era"); }
          bhAliensReact(); // §6/§20: the core's aliens take note
        } else {
          log(`🕳 Harvester construction stage ${bhH.stage}/${BH_HARVESTER.stages} complete.`, bhH.owner === G.playerId ? "good" : "sys");
        }
        spacePanelDirty = true;
      }
    }
  }
  // Update §19: the Phantom Step clock — 50 turns active, 25 turns cooldown
  tickPhantom();
  for (const r of G.space.researchers || []) if (r.cd > 0) r.cd--;
  for (const cid of Object.keys(G.countries)) {
    const c = G.countries[cid];
    if (c.capitalCd > 0) c.capitalCd--;
  }
  // Sandbox Improvement §10: pausing the AI silences the alien civilizations too
  if (!sandboxOn("aiOff")) alienTick();
}

// ---------------- §14: the AI cargo-loading process ----------------
// The AI mans its cargo craft the way a player does: pick the craft, check
// capacity, MARCH the soldiers to the pad, board through the shared rulebook
// (canBoardTransport within TRANSPORT_LOAD_R — the player's E key radius),
// and only then lift off. Troops are never teleported into a hold.
function aiCargoTroopsWanted(id, c, myColonies, wars) {
  if (wars.length) return 3;                                            // invasions and counterattacks
  if (myColonies.some(col => col.st.colony.garrison.length < 3)) return 2; // thin garrisons want relief
  if (myColonies.length < 2) return 2;                                  // young colonies like guards
  return 0;
}
function aiLoadCargoCraft(id, c, a, want) {
  const cap = UNITS[a.unit].cap;
  a.cargo = a.cargo || [];
  const goal = Math.min(cap, want);
  if (a.cargo.length >= goal) return "ready";
  const pool = G.armies.filter(m => m.owner === id && m !== a && canBoardTransport(a, m.unit))
    .sort((m1, m2) => (UNITS[m2.unit].atk + UNITS[m2.unit].def) - (UNITS[m1.unit].atk + UNITS[m1.unit].def))
    .slice(0, goal * 2);
  if (!pool.length) {
    if (!a.cargo.length) spDbg(`AI ${c.name}: cargo mission stands down — no troops available to load`);
    return a.cargo.length ? "ready" : "none";
  }
  spDbg(`AI ${c.name}: cargo mission — ${goal} troops requested for ${UNITS[a.unit].n}`);
  let marching = 0;
  for (const m of pool) {
    if (a.cargo.length >= goal) break;
    const d2 = (m.x - a.x) ** 2 + (m.y - a.y) ** 2;
    if (d2 <= TRANSPORT_LOAD_R * TRANSPORT_LOAD_R) {
      a.cargo.push({ unit: m.unit, hp: m.hp, maxHp: m.maxHp });
      removeArmyQuiet(m);
      spDbg(`AI ${c.name}: cargo loaded ${UNITS[m.unit].n} (${a.cargo.length}/${cap})`);
    } else if (marching < goal && d2 < 700 * 700) {
      m.tx = a.x + rnd(-10, 10); m.ty = a.y + rnd(-10, 10); // §14.3: move close enough
      marching++; // distant garrisons keep their own orders — no continental strip-mining
    }
  }
  if (a.cargo.length >= goal) return "ready";
  if (marching) { spDbg(`AI ${c.name}: loading blocked — ${marching} troops still outside loading range, marching`); return "loading"; }
  return a.cargo.length ? "ready" : "none";
}

// ---------------- space AI (called from aiTurn, era 8+) ----------------
function aiSpaceTurn(id, c) {
  ensureSpaceState();
  const per = c.personality;
  const site = spaceProgramCity(id);
  const ships = shipsOfNation(id);
  const myColonies = coloniesOfNation(id);
  const wars = G.wars.filter(w => w.a === id || w.b === id).map(w => (w.a === id ? w.b : w.a));

  // 1. launch space-capable craft waiting on the ground (Update Part 1 §2:
  // the same central path as the player — Space Program city, launch money,
  // spare energy, launchArmyToSpace). Cargo craft first walk their troops
  // aboard through the shared rulebook (§14) and hold the countdown until
  // the soldiers are in — no craft launches empty while troops are marching.
  if (site) {
    const grounded = G.armies.filter(a => a.owner === id && UNITS[a.unit].space);
    if (grounded.length && c.res.money > SPACE_COSTS.launch.money * 2 && c.res.energy >= SPACE_COSTS.launch.energy) {
      let toLaunch = null;
      for (const a of grounded) {
        if (UNITS[a.unit].cap) {
          const want = aiCargoTroopsWanted(id, c, myColonies, wars);
          if (want > 0) {
            const st = aiLoadCargoCraft(id, c, a, want);
            if (st === "loading") continue; // troops on the way — hold this pad
          }
        }
        toLaunch = a;
        break;
      }
      if (toLaunch) {
        c.res.money -= SPACE_COSTS.launch.money;
        c.res.energy = Math.max(0, c.res.energy - SPACE_COSTS.launch.energy);
        spDbg(`AI ${c.name}: ${UNITS[toLaunch.unit].n} lifts off${(toLaunch.cargo || []).length ? ` with ${toLaunch.cargo.length} troops aboard` : ""}`);
        launchArmyToSpace(toLaunch);
      }
    } else if (grounded.length && c.res.energy < SPACE_COSTS.launch.energy) {
      // the pad is dark — the launch-blocking energy gap the city AI now
      // answers with Power Plants (Update Part 1 §1)
      spDbg(`AI ${c.name}: launch blocked — needs ${SPACE_COSTS.launch.energy}⚡ spare, has ${Math.round(c.res.energy)}⚡`);
    }
    // 2. lay down new spacecraft when the fleet is thin
    const grounded2 = G.armies.filter(a => a.owner === id && UNITS[a.unit].space).length;
    const want = 2 + (c.era >= 9 ? 1 : 0) + Math.min(2, myColonies.length);
    if (ships.length + grounded2 < want && (site.rq || []).length < 2) {
      const pickU = c.researched.colonyships && Math.random() < 0.6 ? "cargoship"
        : (unitAvailable(c, "starfleet") && Math.random() < 0.5 ? "starfleet" : "rocket");
      if (unitAvailable(c, pickU)) {
        const cost = recruitCost(c, pickU);
        if (c.res.money > cost.money * 2.5 && c.res.mat > cost.mat * 1.2) {
          c.res.money -= cost.money; c.res.mat -= cost.mat;
          queueRecruit(id, pickU, site);
        }
      }
    }
  }

  // 3. colonize free worlds (foreign systems only once the warp drive exists).
  // SU2 Part 4: the AI runs its own exploration — it does not wait for a HUMAN
  // to chart a system before daring to fly there.
  if (c.researched.colonyships) {
    // BUG REPORT (star death): the AI never settles a dead system
    const freeWorlds = SPACE_PLANETS.filter(d => d.type !== "main" && !G.space.planets[d.id].destroyed && !G.space.planets[d.id].colony &&
      !sunDead(planetSysId(d)) && (planetSysId(d) === "home" || c.researched.warp));
    if (freeWorlds.length) {
      for (const s of ships) {
        if (s.chase) continue;
        const nearFree = freeWorlds.find(d => shipNearPlanet(s, d.id));
        if (nearFree && c.res.money > SPACE_COSTS.colonize.money * 1.4) {
          colonizePlanet(id, nearFree.id, true);
          break;
        }
        if (!s.target && (!s.orbit || s.orbit === "home") && Math.random() < 0.5) {
          // favour close worlds so young space programs settle their own system first
          const sorted = freeWorlds.slice().sort((d1, d2) => {
            const p1 = planetPos(d1.id), p2 = planetPos(d2.id);
            return ((p1.x - s.x) ** 2 + (p1.z - s.z) ** 2) - ((p2.x - s.x) ** 2 + (p2.z - s.z) ** 2);
          });
          s.target = (Math.random() < 0.7 ? sorted[0] : pick(sorted)).id;
          s.orbit = null;
          break;
        }
      }
    }
  }

  // 4. develop colonies
  if (myColonies.length && Math.random() < 0.3) {
    const pickC = pick(myColonies);
    const uc = SPACE_COSTS.colonyUp(pickC.st.colony.lvl);
    if (pickC.st.colony.lvl < COLONY_MAX_LVL && c.res.money > uc.money * 2.5 && c.res.mat > uc.mat * 1.5) {
      upgradeColony(id, pickC.def.id, true);
    }
  }
  // 4b. colony industry (Part 14.6): a mine first, refineries once raw stock
  // piles up, industrial plants for war economies, orbital fabricators late —
  // colonies are no longer mines-only
  if (myColonies.length && Math.random() < 0.35) {
    const col = pick(myColonies);
    const colB = col.st.colony.b || {};
    if (colonyBldgCount(col.st.colony) < COLONY_BLDG_SLOTS(col.st.colony.lvl)) {
      let want = null;
      if (!colB.mine) want = "mine";
      else if (!colB.refinery && c.res.mat > 3000) want = "refinery";
      else if (c.researched.autofactories && (wars.length || Math.random() < 0.4)) want = "industrial";
      if (c.researched.megaeng && (c.era >= 9 || myColonies.length >= 3) && Math.random() < 0.5) want = "orbfab";
      if (want) {
        const B = COLONY_BLDGS[want];
        if ((!B.tech || c.researched[B.tech]) && c.res.money > B.cost.money * 2 && c.res.mat > B.cost.mat * 1.5) {
          buildColonyBldg(id, col.def.id, want, true);
        }
      }
    }
  }

  // 5. defend colonies under threat / 6. invade enemy colonies
  const threats = [];
  for (const col of myColonies) {
    const p = planetPos(col.def.id);
    for (const s2 of G.space.ships) {
      if (s2.owner !== id && atWar(id, s2.owner) &&
          (s2.x - p.x) ** 2 + (s2.y - p.y) ** 2 + (s2.z - p.z) ** 2 < 200 * 200) { threats.push(col.def.id); break; }
    }
  }
  for (const s of ships) {
    const u = UNITS[s.unit];
    if (threats.length && u.atk >= 100 && !s.chase) { s.target = threats[0]; s.orbit = null; continue; }
    // §14: an empty transport with an invasion to fly returns home, lands
    // through the shared landing system, boards troops next pass and lifts
    // off again loaded — no empty cargo runs while soldiers wait at home
    if (wars.length && u.cap && !(s.cargo || []).length && !s.chase && !homeworldScorched()) {
      const invasionWaits = SPACE_PLANETS.some(d => {
        const st2 = G.space.planets[d.id];
        return st2.colony && wars.includes(st2.colony.owner) && !st2.destroyed &&
          !phantomHiddenFrom(planetSysId(d), id);
      });
      const troopsHome = G.armies.some(m => m.owner === id && canBoardTransport(s, m.unit));
      if (invasionWaits && troopsHome) {
        if (shipNearPlanet(s, "home")) {
          spDbg(`AI ${c.name}: ${u.n} lands to board invasion troops`);
          if (landShip(s)) continue;
        } else if (!s.target && !s.free) { s.target = "home"; s.orbit = null; }
        continue;
      }
    }
    if (wars.length && u.cap && (s.cargo || []).length) {
      const targetCol = SPACE_PLANETS.find(d => {
        const st = G.space.planets[d.id];
        return st.colony && wars.includes(st.colony.owner) && !st.destroyed &&
          !phantomHiddenFrom(planetSysId(d), id); // Update §17.2: cloaked = untargetable
      });
      if (targetCol) {
        if (shipNearPlanet(s, targetCol.id)) resolveInvasion(s, targetCol.id);
        else if (!s.target) { s.target = targetCol.id; s.orbit = null; }
        continue;
      }
    }
    // peacetime garrison runs (SU2 Part 4): troops aboard strengthen a
    // thinly-held colony instead of idling in orbit
    if (!wars.length && u.cap && (s.cargo || []).length && myColonies.length) {
      const weak = myColonies.find(col => col.st.colony.garrison.length < 3);
      if (weak) {
        if (shipNearPlanet(s, weak.def.id)) deployCargoToColony(s, weak.def.id);
        else if (!s.target) { s.target = weak.def.id; s.orbit = null; }
      }
    }
  }

  // 7. megastructures for the truly advanced
  const caretakerAI = typeof isDisconnectedHuman === "function" && isDisconnectedHuman(id);
  if (c.era >= 9) {
    if (c.researched.dysonsphere && c.res.money > MEGA_DEFS.dyson.cost.money * 1.5 && c.res.mat > MEGA_DEFS.dyson.cost.mat * 1.2) {
      // Final Space Fixes §5: the AI walks the same rulebook — home star first,
      // then any system it holds a colony in (never remotely, never under
      // hostile alien control; canBuildDyson enforces all of it)
      if (canBuildDyson(id, "home").ok) payDysonStage(id, "home");
      else if (Math.random() < 0.35) {
        const seen = {};
        for (const e of coloniesOfNation(id)) {
          const sid = planetSysId(e.def);
          if (seen[sid]) continue;
          seen[sid] = 1;
          if (canBuildDyson(id, sid).ok) { payDysonStage(id, sid); break; }
        }
      }
    }
    if (c.researched.haloring && Math.random() < 0.3) {
      const target = myColonies.find(col => !col.st.halo);
      if (target && c.res.money > MEGA_DEFS.halo.cost.money * 1.5 && c.res.mat > MEGA_DEFS.halo.cost.mat * 1.2) {
        startHalo(id, target.def.id);
      }
    }
    // a scorched Homeworld: any capable nation works to rehabilitate it
    if (homeworldScorched() && c.researched.rehab_t && !planetState("home").rehab &&
        c.res.money > MEGA_DEFS.rehab.cost.money * 1.2 && c.res.mat > MEGA_DEFS.rehab.cost.mat * 1.1) {
      startRehab(id, "home", true);
    }
    // shield the crown jewels (Part 4)
    if (c.researched.shield_t && Math.random() < 0.25) {
      if (G.space.dyson && G.space.dyson.owner === id && G.space.dyson.stage > 0 && !(G.space.dyson.shield && G.space.dyson.shield.hp > 0)) {
        buildShield(id, "dyson", "home", true);
      } else {
        const unshielded = myColonies.find(col => !(col.st.shield && col.st.shield.hp > 0));
        if (unshielded && c.res.money > MEGA_DEFS.shield.cost.money * 1.5) buildShield(id, "planet", unshielded.def.id, true);
      }
    }
    // researchers for the curious (Part 9)
    if (c.researched.researcher_t && Math.random() < 0.2 &&
        !(G.space.researchers || []).some(r => r.owner === id && !r.destroyed) &&
        c.res.money > MEGA_DEFS.researcher.cost.money * 1.6) {
      const hp = planetPos("home");
      buildResearcher(id, hp.x + rnd(-260, 260), rnd(-30, 30), hp.z + rnd(-260, 260), true);
    }
    // BUG REPORT: the AI walks the same road to Phantom Step as the player —
    // expand its Researcher to the Deep Space level, complete the upgrade,
    // and only then may the wartime cloak below ever fire
    const rAI = (G.space.researchers || []).find(r2 => r2.owner === id && !r2.destroyed);
    if (rAI && !rAI.deep && c.researched[PHANTOM.tech] && Math.random() < 0.3) {
      if (rAI.lvl < PHANTOM.deepLvl) {
        const uc2 = RESEARCHER_UP(rAI.lvl);
        if (c.res.money > uc2.money * 2 && c.res.mat > uc2.mat * 1.5) upgradeResearcher(id, rAI.id, true);
      } else if (c.res.money > PHANTOM.deepCost.money * 1.5 && c.res.mat > PHANTOM.deepCost.mat * 1.2) {
        upgradeResearcherDeep(id, rAI.id, true);
      }
    }
    // the planet killer — only the ruthless build it, and only wartime fires it.
    // A caretaker AI (disconnected player) never touches the big red button.
    if ((per === "aggressive" || per === "expansionist") && c.researched.stardestroyer_t && site && !caretakerAI) {
      const hasSD = ships.some(s => s.unit === "stardestroyer") ||
        G.armies.some(a => a.owner === id && a.unit === "stardestroyer") ||
        provsOwned(id).some(p => (p.rq || []).some(q => q.u === "stardestroyer"));
      const cost = recruitCost(c, "stardestroyer");
      if (!hasSD && c.res.money > cost.money * 1.3 && c.res.mat > cost.mat * 1.1) {
        c.res.money -= cost.money; c.res.mat -= cost.mat;
        queueRecruit(id, "stardestroyer", site);
      }
      const sd = ships.find(s => s.unit === "stardestroyer");
      if (sd && wars.length) {
        const prey = SPACE_PLANETS.find(d => {
          const st = G.space.planets[d.id];
          return d.type !== "main" && st.colony && wars.includes(st.colony.owner) && !st.destroyed &&
            !phantomHiddenFrom(planetSysId(d), id); // Update §17.2: cloaked = untargetable
        });
        if (prey) {
          if (shipNearPlanet(sd, prey.id)) {
            if (Math.random() < 0.4 && sdLaserStatus(sd).ready) destroyPlanet(sd, prey.id);
          }
          else if (!sd.target) { sd.target = prey.id; sd.orbit = null; }
        }
      }
    }
    // Update §15: the AI understands the Harvester — as a prize and as a target.
    // Critical Bug-Fix §1: the AI obeys the same presence rule as the player —
    // no ship at the core means it first ORDERS one there, and only funds the
    // stage on a later pass once the ship has actually arrived.
    const bhAI = G.space.bhH;
    const aiFundBH = () => {
      if (bhShipPresent(id)) { startBHStage(id, true); return; }
      const bhp2 = galaxyBH();
      if (!bhp2) return;
      const runner = ships.find(s2 => s2.hp > 0 && !s2.harvest &&
        !(s2.free && (s2.free.x - bhp2.x) ** 2 + (s2.free.z - bhp2.z) ** 2 < 400 * 400));
      const already = ships.some(s2 => s2.free && (s2.free.x - bhp2.x) ** 2 + (s2.free.z - bhp2.z) ** 2 < 400 * 400);
      if (runner && !already) {
        runner.free = { x: bhp2.x + rnd(-120, 120), y: rnd(-14, 14), z: bhp2.z + rnd(-120, 120) };
        runner.target = null; runner.orbit = null; runner.chase = null;
        spDbg(`AI ${c.name}: dispatching a ship to the black hole before Harvester construction`);
      }
    };
    if (!caretakerAI) {
      if (c.researched[BH_HARVESTER.tech] && (!bhAI || bhAI.ruins) &&
          c.res.money > BH_HARVESTER.cost.money * 2 && c.res.mat > BH_HARVESTER.cost.mat * 1.5 && Math.random() < 0.2) {
        aiFundBH();
      } else if (bhAI && !bhAI.ruins && bhAI.owner === id) {
        if (bhAI.paused && Math.random() < 0.5) resumeBH(id, true);
        else if (!bhAI.building && bhAI.stage < BH_HARVESTER.stages &&
            c.res.money > BH_HARVESTER.cost.money * 1.5 && c.res.mat > BH_HARVESTER.cost.mat * 1.2) {
          aiFundBH();
        }
      }
      if (bhAI && !bhAI.ruins && bhAI.owner !== id && wars.includes(bhAI.owner)) {
        const sd2 = ships.find(s => s.unit === "stardestroyer");
        const bhp = galaxyBH();
        if (sd2 && bhp) {
          if (shipNearBH(sd2)) { if (sdLaserStatus(sd2).ready && Math.random() < 0.5) sdStrikeHarvester(sd2); }
          else if (!sd2.target && !sd2.free && Math.random() < 0.4) {
            sd2.free = { x: bhp.x + rnd(-120, 120), y: 0, z: bhp.z + rnd(-120, 120) };
          }
        }
      }
      // §19.4 + Critical Bug-Fix §4: AI civilizations may cloak a colony system
      // in wartime — and they ask the SAME Phantom Step controller the player's
      // console uses (tech, full Dyson, Deep Space station, 50/25 cycle)
      if (wars.length && Math.random() < 0.05 && phantomStatus(id).ready) {
        const cands = phantomEligibleSystems(id);
        if (cands.length) activatePhantom(id, pick(cands), true);
      }
    }
  }
  // ============ AI Update §7-§11/§16 — space statecraft ============
  if (!caretakerAI) aiSpaceStatecraft(id, c, ships, myColonies, wars, per);
}

// ============ AI Update §7/§9/§10/§11/§16 — the space-age state ============
// Research stations where they are legal, active alien discovery and
// diplomacy, wars fought FOR colonies when expansion is blocked, Dyson
// disputes answered sensibly, Void Shields raised against alien threats, and
// Star Destroyer superweapons used with strategy rather than left to rust.
function aiSpaceStatecraft(id, c, ships, myColonies, wars, per) {
  // ---- §10: a second Research Station once the nation spans systems ----
  const myRes = (G.space.researchers || []).filter(r => r.owner === id && !r.destroyed);
  if (c.researched.researcher_t && Math.random() < 0.12 &&
      myRes.length === 1 && c.res.money > MEGA_DEFS.researcher.cost.money * 2) {
    const away = myColonies.find(col => planetSysId(col.def) !== "home" &&
      !alienControlsSystem(planetSysId(col.def), id));
    if (away) {
      const p = planetPos(away.def.id);
      buildResearcher(id, p.x + rnd(-160, 160), rnd(-24, 24), p.z + rnd(-160, 160), true);
    }
  }
  // ---- §11: actively search for alien life with the station's deep sweep ----
  const knownAliens = (G.space.aliens || []).filter(a => !a.defeated && a.contacted.includes(id));
  if (myRes.length && Math.random() < 0.15 && c.res.money > LOCATE_LIFE.money * 2 &&
      (per === "scientific" || per === "expansionist" || !knownAliens.length)) {
    const r = myRes.find(r2 => (r2.cd || 0) <= 0);
    if (r) locateInterstellarLife(id, r.id, true);
  }
  // ---- §11: after discovery — communicate, trade or keep a wary distance ----
  if (knownAliens.length && Math.random() < 0.1) {
    const rec = pick(knownAliens);
    const rel = (G.rel[rec.aid] || {})[id] || 0;
    if (!atWar(id, rec.aid)) {
      if ((per === "peaceful" || per === "mercantile") && rel > -10 && c.res.money > 5000 && (rec.tradeCd || 0) <= 0) {
        alienTalk(id, rec.aid, "trade");
      } else if (rel < 30 && per !== "aggressive" && (rec.talkCd || 0) <= 0) {
        alienTalk(id, rec.aid, "hail");
      }
    }
  }
  // ---- §13: raise Void Shields where the alien threat is real ----
  if (c.researched[VOID_SHIELD.tech] && Math.random() < 0.15 &&
      c.res.money > VOID_SHIELD.cost.money * 1.5 && c.res.mat > VOID_SHIELD.cost.mat * 1.2) {
    const alienThreat = (G.space.aliens || []).some(a => !a.defeated && G.countries[a.aid] && G.countries[a.aid].alive &&
      (atWar(id, a.aid) || ((G.rel[a.aid] || {})[id] || 0) < -20 || a.per === "warlord"));
    if (alienThreat) {
      const seen = {};
      const sysIds = ["home"].concat(myColonies.map(col => planetSysId(col.def)));
      for (const sysId of sysIds) {
        if (seen[sysId]) continue;
        seen[sysId] = 1;
        if (canBuildVoidShield(id, sysId).ok) { payVoidShield(id, sysId); break; }
      }
    }
  }
  // ---- §7: wars FOR colonies when the stars run out ----
  aiConsiderColonyWar(id, c, ships, myColonies, wars, per);
  // ---- §9: an existing Dyson dispute, answered by temperament ----
  if (c.researched.dysonsphere && !wars.length && Math.random() < 0.02 && !sandboxOn("noAIWars")) {
    const homeDy = dysonAt("home");
    if (homeDy && Number(homeDy.owner) !== id && !c.researched.warp &&
        (per === "aggressive" || per === "expansionist")) {
      const owner = Number(homeDy.owner);
      const O = G.countries[owner];
      // grounded ambitions: without a Warp Drive the only sphere in reach is
      // taken — the aggressive consider taking it by force
      if (O && O.alive && powerEstimate(c) > powerEstimate(O) * 1.2 && (G.rel[id][owner] || 0) < 10) {
        declareWar(id, owner);
        log(`⚔ ${c.name} covets the harnessed star — war over the Dyson Sphere!`, "war");
      }
    }
  }
  // ---- §16/§18: Star Destroyer strategy for nations that own one ----
  const sd = ships.find(s => s.unit === "stardestroyer");
  if (sd && wars.length && !sd.harvest) aiSDSuperweapons(id, c, sd, wars);
}
// §7: declare war to obtain colonies — personality, power, tech, transport
// capability and strategic value all weigh in; peaceful nations wait for warp
function aiConsiderColonyWar(id, c, ships, myColonies, wars, per) {
  if (wars.length || sandboxOn("noAIWars")) return;
  if (!c.researched.colonyships) return;
  if (per === "peaceful" || per === "defensive" || per === "scientific") return; // prefer diplomacy / warp
  const ts = warTurnScale();
  if (G.turn - c.lastWarTurn < 14 * ts) return;
  if (c.res.money < 3000 || Math.random() > 0.1) return;
  const wantMore = myColonies.length < (per === "expansionist" ? 4 : 2);
  if (!wantMore) return;
  // free worlds in reach? then there is no cause for war
  const anyFree = SPACE_PLANETS.some(d => {
    if (d.type === "main") return false;
    const st = G.space.planets[d.id];
    return st && !st.destroyed && !st.colony && !sunDead(planetSysId(d)) &&
      (planetSysId(d) === "home" || c.researched.warp);
  });
  if (anyFree) return;
  // transport capability: an invasion needs a troop bay in space or on the pad
  const canLift = ships.some(s => (UNITS[s.unit].cap || 0) > 0) ||
    G.armies.some(a => a.owner === id && UNITS[a.unit].space && (UNITS[a.unit].cap || 0) > 0) ||
    (unitAvailable(c, "cargoship") && spaceProgramCity(id));
  if (!canLift) return;
  // score the colony holders in reach
  let best = null, bestScore = 0;
  const holders = {};
  for (const d of SPACE_PLANETS) {
    const st = G.space.planets[d.id];
    if (!st || st.destroyed || !st.colony) continue;
    const o = Number(st.colony.owner);
    if (o === id || !G.countries[o] || !G.countries[o].alive) continue;
    if (planetSysId(d) !== "home" && !c.researched.warp) continue; // out of reach
    if (phantomHiddenFrom(planetSysId(d), id)) continue;
    holders[o] = (holders[o] || 0) + 1;
  }
  for (const ok of Object.keys(holders)) {
    const o = Number(ok), O = G.countries[o];
    if (allied(id, o) || atWar(id, o)) continue;
    if (O.alien && !(G.space.aliens || []).some(a => a.aid === o && a.contacted.includes(id))) continue; // undiscovered
    const rel = (G.rel[id] || {})[o] || 0;
    if (rel > 20) continue;
    let s = (per === "aggressive" ? 2 : 1.6);
    s += Math.min(2, holders[o] * 0.5);                       // strategic value
    s += Math.min(1.6, (powerEstimate(c) / (powerEstimate(O) + 25) - 1));
    s += (c.era - O.era) * 0.3;
    s += -rel / 50;
    s += rnd(-0.8, 0.8);
    if (s > bestScore) { bestScore = s; best = o; }
  }
  if (best !== null && bestScore >= 3) {
    declareWar(id, best);
    log(`⚔ ${c.name} goes to war for living space among the stars — target: ${G.countries[best].name}'s colonies.`, "war");
  }
}
// §16: harvest, omni, dyson-cracking, shield-breaking and the hyper lazer —
// every ability behind the same costs, cooldowns and friendly-fire checks
function aiSDSuperweapons(id, c, sd, wars) {
  if (sd.dysonTarget || sd.vsTarget) return;
  // enemy Dyson Spheres are prime targets
  for (const sysId of Object.keys(G.space.systems || {}).concat(["home"])) {
    const dy = dysonOfSystem(sysId);
    if (!dy || dy.stage < 1 || !wars.includes(Number(dy.owner))) continue;
    if (phantomHiddenFrom(sysId, id)) continue;
    if (Math.random() < 0.25) {
      const sys = systemDef(sysId);
      const near = (sd.x - sys.x) ** 2 + (sd.z - sys.z) ** 2 < 600 * 600;
      if (near && sdLaserStatus(sd).ready) attackDyson(sd, sysId);
      else sd.dysonTarget = sysId;
      return;
    }
    break;
  }
  // enemy Void Shields fall to the cannon too (§18)
  for (const sysId of Object.keys(G.space.systems || {})) {
    const vs = G.space.systems[sysId].voidShield;
    if (!vs || vs.building || vs.hp <= 0 || !wars.includes(Number(vs.owner))) continue;
    if (Math.random() < 0.15) { sd.vsTarget = sysId; return; }
    break;
  }
  // §16: the hyper lazer against massed troops (from Homeworld orbit only)
  if (typeof hyperLazerStatus === "function" && shipNearPlanet(sd, "home") && Math.random() < 0.2) {
    const hs = hyperLazerStatus(sd);
    if (hs.ready) {
      const hostiles = G.armies.filter(a => wars.includes(a.owner));
      let bestSpot = null, bestN = 2; // at least 3 troops to justify the cost
      for (const a of hostiles) {
        const n = hostiles.filter(b => (b.x - a.x) ** 2 + (b.y - a.y) ** 2 <= (HYPER_LAZER.radius * 0.8) ** 2).length;
        const friendly = G.armies.some(b => b.owner === id && (b.x - a.x) ** 2 + (b.y - a.y) ** 2 <= HYPER_LAZER.radius ** 2);
        if (n > bestN && !friendly) { bestN = n; bestSpot = a; }
      }
      if (bestSpot) {
        c.res.money -= HYPER_LAZER.money;
        c.res.energy = Math.max(0, c.res.energy - HYPER_LAZER.energy);
        sd.hlCd = HYPER_LAZER.cd;
        hyperStrikes.push({ x: bestSpot.x, y: bestSpot.y, t: 0, dur: HYPER_LAZER.delay, owner: id, shipId: sd.id });
        log(`🔦 ${c.name}'s Star Destroyer paints a target from orbit!`, "war");
        return;
      }
    }
  }
  // the solar-system weapon: only with the DOOM Device, only in long wars,
  // never the homeland system, never a system holding its own colonies
  if (!c.researched.doomdevice) return;
  const majorWar = G.wars.some(w => (w.a === id || w.b === id) && G.turn - (w.start || 0) > 30 * (isRealtime() ? 1 : 0.4));
  if (!majorWar) return;
  if ((sd.omniCharges || 0) > 0 && Math.random() < 0.1) {
    const bySys = {};
    for (const d of SPACE_PLANETS) {
      const st = G.space.planets[d.id];
      if (!st || st.destroyed || !st.colony || !wars.includes(Number(st.colony.owner))) continue;
      const sid = planetSysId(d);
      if (sid === "home") continue;                     // never the shared homeland
      if (phantomHiddenFrom(sid, id)) continue;
      const ownHere = SPACE_PLANETS.some(d2 => planetSysId(d2) === sid && G.space.planets[d2.id] &&
        G.space.planets[d2.id].colony && Number(G.space.planets[d2.id].colony.owner) === id);
      if (ownHere) continue;
      bySys[sid] = (bySys[sid] || 0) + 1;
    }
    const best = Object.keys(bySys).sort((a, b) => bySys[b] - bySys[a])[0];
    if (best && canOmniStrike(sd, best).ok && omniBlastPlan(sd, best).friendly === 0) {
      omniStrike(sd, best);
      return;
    }
  }
  // charge the weapon: harvest a sun that warms neither the homeland nor
  // any of the nation's own colonies
  if ((sd.omniCharges || 0) === 0 && (sd.harvestCd || 0) <= 0 && Math.random() < 0.2) {
    const cands = SPACE_SYSTEMS.filter(sy => {
      if (sy.id === "home" || sunDead(sy.id) || sysHarvestsLeft(sy.id) <= 0) return false;
      if (!systemRevealed(sy.id)) return false;
      return !SPACE_PLANETS.some(d2 => planetSysId(d2) === sy.id && G.space.planets[d2.id] &&
        G.space.planets[d2.id].colony && Number(G.space.planets[d2.id].colony.owner) === id);
    });
    if (cands.length) {
      cands.sort((a, b) => ((a.x - sd.x) ** 2 + (a.z - sd.z) ** 2) - ((b.x - sd.x) ** 2 + (b.z - sd.z) ** 2));
      const sun = cands[0];
      if (shipNearStar(sd, sun.id)) { if (canHarvestStar(sd, sun.id).ok) startStellarHarvest(sd, sun.id); }
      else if (!sd.target && !sd.free) sd.free = { x: sun.x + rnd(-140, 140), y: 0, z: sun.z + rnd(-140, 140) };
    }
  }
}

// ---------------- the simulation (every frame, via warFrame) ----------------
// "near a planet" scales with the planet's size: orbit slots reach r+45, so a
// flat radius left ships IN ORBIT counting as "not near" — the root cause of
// Star Destroyers that could not fire and craft that could not land (SU2 §10-12)
function planetNearR(def) { return PLANET_NEAR + (def ? def.r : 0); }
function shipNearPlanet(s, planetId) {
  const def = planetDef(planetId);
  if (!def) return false;
  const p = planetPos(planetId);
  const R = planetNearR(def);
  return (s.x - p.x) ** 2 + (s.y - p.y) ** 2 + (s.z - p.z) ** 2 <= R * R;
}
// the NEAREST world in reach — never "first in the array", which used to make
// ships land on the Homeworld when they meant a planet drifting past it
function shipNearestPlanet(s) {
  let best = null, bd = Infinity;
  for (const def of SPACE_PLANETS) {
    const st = G.space.planets[def.id];
    if (!st) continue;
    const p = planetPos(def.id);
    const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2 + (s.z - p.z) ** 2;
    const R = planetNearR(def);
    if (d <= R * R && d < bd) { bd = d; best = def; }
  }
  return best;
}
function spaceTick(dt) {
  if (!G || !G.space) return;
  // Sandbox Improvement §4: Disable Cooldowns keeps every player ability ready
  if (typeof sandboxOn === "function" && sandboxOn("noCd") && typeof sandboxSkipCooldowns === "function") {
    sandboxSkipCooldowns(G.playerId);
  }
  // planets orbit; war smoke fades once the guns below fall silent (Part 8)
  for (const def of SPACE_PLANETS) {
    const st = G.space.planets[def.id];
    if (!st) continue;
    st.ang += def.speed * dt;
    if (st.warSmoke > 0 && !battleOn(def.id)) {
      st.warSmoke -= dt * 0.02;
      if (st.warSmoke <= 0) delete st.warSmoke;
    }
  }
  // ground battles rage on the surfaces (Final Alien Update Part 8)
  tickPlanetBattles(dt);
  // Small Update §3: stellar harvests pour sun-energy into Star Destroyers
  tickStellarHarvests(dt);
  // Update §12: the Harvester's built-in defences fire on hostiles in range —
  // partial structures shoot weakly, ruins not at all
  const bhDef = G.space.bhH;
  if (bhDef && !bhDef.ruins) {
    bhDef.defCd = (bhDef.defCd || 0) - dt;
    if (bhDef.defCd <= 0) {
      const bp = galaxyBH();
      const pow = Math.max(0.15, bhDef.stage / BH_HARVESTER.stages);
      let tgt = null, bdD = BH_HARVESTER.defRng * BH_HARVESTER.defRng;
      if (bp) for (const t of G.space.ships) {
        if (t.owner === bhDef.owner || !atWar(bhDef.owner, t.owner)) continue;
        const d = (t.x - bp.x) ** 2 + (t.y || 0) ** 2 + (t.z - bp.z) ** 2;
        if (d < bdD) { bdD = d; tgt = t; }
      }
      if (tgt) {
        bhDef.defCd = BH_HARVESTER.defCd;
        tgt.hp -= BH_HARVESTER.defDmg * pow * rnd(0.85, 1.15);
        if (spaceFx.length < 200) spaceFx.push({ kind: "laser", x1: bp.x, y1: 0, z1: bp.z, x2: tgt.x, y2: tgt.y, z2: tgt.z, ttl: 0.14, max: 0.14, big: true });
        if (spaceOpen && (tgt.owner === G.playerId || bhDef.owner === G.playerId)) sfx("beam");
        if (tgt.hp <= 0) {
          spaceBoom(tgt, 14, "ship");
          log(`🕳 The Harvester's defence grid destroys a ${UNITS[tgt.unit].n} of ${G.countries[tgt.owner] ? G.countries[tgt.owner].name : "?"}.`, tgt.owner === G.playerId ? "bad" : "sys");
          if (tgt.owner === G.playerId) toast(`🕳 Your ${UNITS[tgt.unit].n} was shot down by the Harvester's defences!`);
          alienNoteLoss(tgt.owner, bhDef.owner);
          removeShip(tgt);
        }
      } else bhDef.defCd = 0.5;
    }
  }
  // ships move & fight
  const warSet = new Set();
  for (const w of G.wars) { warSet.add(w.a * 1024 + w.b); warSet.add(w.b * 1024 + w.a); }
  for (const s of G.space.ships.slice()) {
    const u = UNITS[s.unit];
    let speed = (u.spd || 40) * 1.6 * (typeof milSpeedMult === "function" ? milSpeedMult(G.countries[s.owner]) : 1);
    let dest = null;
    if (s.dysonTarget) { shipAttackDyson(s, dt); }
    if (s.vsTarget) { shipAttackVoidShield(s, dt); } // AI Update §13: batter the barrier
    if (s.chase) {
      const t = shipById(s.chase);
      if (!t || !warSet.has(s.owner * 1024 + t.owner)) s.chase = null;
      else dest = t;
    }
    if (!dest && s.target) {
      const p = planetPos(s.target);
      dest = p;
      if (shipNearPlanet(s, s.target)) { s.orbit = s.target; s.orbitAng = Math.atan2(s.z - p.z, s.x - p.x); s.target = null; dest = null; spacePanelDirty = true; }
    }
    if (!dest && s.free) { // free 3D movement (Part 6): fly to any point in space
      dest = s.free;
      const dd = (s.x - dest.x) ** 2 + (s.y - dest.y) ** 2 + (s.z - dest.z) ** 2;
      if (dd <= SHIP_ARRIVE * SHIP_ARRIVE) { s.free = null; dest = null; spacePanelDirty = true; }
    }
    if (dest) {
      // crossing between systems engages the warp drive
      const hereSys = systemAt(s.x, s.z), thereSys = systemAt(dest.x, dest.z);
      // AI Update §13.1: an active Void Shield turns alien fleets away at the
      // barrier — errands into the system are cancelled; a fleet at war with
      // the shield's owner turns its guns on the generator instead
      if (typeof voidShieldBlocks === "function" && voidShieldBlocks(thereSys.id, s.owner)) {
        const R = voidShieldRadius(thereSys.id);
        const dIn = (s.x - thereSys.x) ** 2 + (s.z - thereSys.z) ** 2;
        const destIn = (dest.x - thereSys.x) ** 2 + (dest.z - thereSys.z) ** 2;
        if (destIn < R * R && dIn > R * R * 0.98) {
          s.target = null; s.free = null; s.settle = null; s.chase = null;
          if (s.landing !== undefined) s.landing = null;
          if (s.colInv) { s.colInv = null; s.loadFrom = null; }
          const vs = voidShieldAt(thereSys.id);
          if (vs && atWar(s.owner, vs.owner)) s.vsTarget = thereSys.id;
          dest = null;
        }
      }
      if (!dest) continue;
      if (hereSys.id !== thereSys.id) speed *= WARP_SPEED;
      const dx = dest.x - s.x, dy = dest.y - s.y, dz = dest.z - s.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      if (d > SHIP_ARRIVE) {
        const step = Math.min(speed * dt, d);
        s.x += dx / d * step; s.y += dy / d * step; s.z += dz / d * step;
      }
      // arriving in a system reveals it — and the centralized discovery scan
      // (BUG REPORT §1-4) registers every alien civilization visible there at
      // once, even on a pure pass-through at warp speed
      if (hereSys.id !== "home" && G.space.systems[hereSys.id] && !G.space.systems[hereSys.id].revealed &&
          isHumanControlled(s.owner)) {
        log(`🌌 ${G.countries[s.owner].name}'s ships enter the ${hereSys.n} system.`, "sys");
        revealSystem(hereSys.id);
      }
    } else if (s.orbit) {
      // hold a slow orbit around the planet
      const def = planetDef(s.orbit), st = planetState(s.orbit);
      if (!def || !st) { s.orbit = null; continue; }
      s.orbitAng = (s.orbitAng || 0) + dt * 0.25;
      const p = planetPos(s.orbit);
      const r = def.r + 18 + (s.id % 4) * 7;
      s.x = p.x + Math.cos(s.orbitAng) * r;
      s.z = p.z + Math.sin(s.orbitAng) * r;
      s.y = p.y + Math.sin(s.orbitAng * 0.7 + s.id) * 6;
    }
    // combat — enemy ships first, then enemy Researcher megastructures
    s.cd = (s.cd || 0) - dt;
    // Part 12: multi-weapon ships — secondary batteries fire on their own clock
    if (u.sec && u.atk > 5 && !s.dysonTarget) {
      s.cd2 = (s.cd2 === undefined ? rnd(0, u.sec.cd) : s.cd2) - dt;
      if (s.cd2 <= 0) {
        let t2 = null, bd2 = (u.sec.rng || 80) ** 2;
        for (const t of G.space.ships) {
          if (t.owner === s.owner || !warSet.has(s.owner * 1024 + t.owner)) continue;
          const d = (t.x - s.x) ** 2 + (t.y - s.y) ** 2 + (t.z - s.z) ** 2;
          if (d < bd2) { bd2 = d; t2 = t; }
        }
        if (t2) {
          s.cd2 = u.sec.cd;
          const A2 = G.countries[s.owner], D2 = G.countries[t2.owner];
          let dmg2 = u.atk * (u.dmgMul || 1) * u.sec.f * SPACE_DMG_MULT * (s.stack || 1);
          dmg2 *= (typeof milDmgMult === "function" ? milDmgMult(A2) : 1) * rnd(0.85, 1.15);
          dmg2 *= 100 / (100 + UNITS[t2.unit].def * (typeof milArmMult === "function" ? milArmMult(D2) : 1) * SPACE_DEF_MIT);
          t2.hp -= dmg2;
          if (spaceFx.length < 200) spaceFx.push({ kind: "laser", x1: s.x, y1: s.y, z1: s.z, x2: t2.x, y2: t2.y, z2: t2.z, ttl: 0.12, max: 0.12 });
          if (t2.hp <= 0) {
            spaceBoom(t2, 14, "ship");
            log(`🌌 ${A2.name}'s point-defence batteries destroy a ${UNITS[t2.unit].n} of ${D2.name}.`, t2.owner === G.playerId ? "bad" : "sys");
            if (t2.owner === G.playerId) toast(`🌌 Your ${UNITS[t2.unit].n} was destroyed in space!`);
            alienNoteLoss(t2.owner, s.owner); // aliens remember who bleeds them (Part 1)
            removeShip(t2);
            D2.morale = clamp(D2.morale - 1.5, 0, 100);
          }
        } else s.cd2 = u.sec.cd * 0.6;
      }
    }
    if (s.cd <= 0 && u.atk > 5 && !s.dysonTarget) {
      let target = null, bd = SHIP_RNG * SHIP_RNG, targetR = null, targetB = null;
      for (const t of G.space.ships) {
        if (t.owner === s.owner || !warSet.has(s.owner * 1024 + t.owner)) continue;
        const d = (t.x - s.x) ** 2 + (t.y - s.y) ** 2 + (t.z - s.z) ** 2;
        if (d < bd) { bd = d; target = t; targetR = null; }
      }
      for (const r of G.space.researchers || []) {
        if (r.destroyed || r.owner === s.owner || !warSet.has(s.owner * 1024 + r.owner)) continue;
        const d = (r.x - s.x) ** 2 + (r.y - s.y) ** 2 + (r.z - s.z) ** 2;
        if (d < bd) { bd = d; target = null; targetR = r; }
      }
      // Update §13: the Black Hole Energy Harvester is a legitimate war target
      const bhW = G.space.bhH, bhP = galaxyBH();
      if (bhW && !bhW.ruins && bhP && bhW.owner !== s.owner && warSet.has(s.owner * 1024 + bhW.owner)) {
        const d = (bhP.x - s.x) ** 2 + (s.y || 0) ** 2 + (bhP.z - s.z) ** 2;
        if (d < bd) { bd = d; target = null; targetR = null; targetB = bhW; }
      }
      if (targetB) {
        s.cd = u.atk >= 1000 ? 3.0 : 1.6;
        const dmgB = u.atk * 0.45 * (s.stack || 1) * milDmgMult(G.countries[s.owner]);
        bhHarvesterHit(dmgB, s.owner);
        if (spaceFx.length < 200) spaceFx.push({ kind: "laser", x1: s.x, y1: s.y, z1: s.z, x2: bhP.x, y2: 0, z2: bhP.z, ttl: 0.18, max: 0.18, big: u.atk >= 1000 });
        if (spaceOpen && (s.owner === G.playerId || bhW.owner === G.playerId)) sfx(u.atk >= 1000 ? "rail" : "beam");
      } else if (target) {
        // Part 12: per-unit cooldowns in space too — star fleets rattle off
        // rapid low-damage volleys, Star Destroyers thunder slowly
        s.cd = u.cd || (u.atk >= 1000 ? 3.0 : 1.6);
        const A = G.countries[s.owner], D = G.countries[target.owner];
        // SU2 Part 9 rebalance: real weapon output vs softer mitigation, so
        // equal fleets resolve in reasonable time; military upgrades count
        let dmg = u.atk * (u.dmgMul || 1) * SPACE_DMG_MULT * (s.stack || 1);
        dmg *= milDmgMult(A);
        dmg *= Math.pow(1.15, A.era - D.era);
        dmg *= rnd(0.85, 1.15);
        dmg *= 100 / (100 + UNITS[target.unit].def * milArmMult(D) * SPACE_DEF_MIT);
        target.hp -= dmg;
        if (spaceFx.length < 200) spaceFx.push({ kind: "laser", x1: s.x, y1: s.y, z1: s.z, x2: target.x, y2: target.y, z2: target.z, ttl: 0.18, max: 0.18, big: u.atk >= 1000 });
        if (spaceOpen && (s.owner === G.playerId || target.owner === G.playerId)) sfx(u.atk >= 1000 ? "rail" : "beam");
        if (target.hp <= 0) {
          spaceBoom(target, 14, "ship");
          if (target.cargo && target.cargo.length) log(`🌌 A ${UNITS[target.unit].n} of ${D.name} dies in orbit with ${target.cargo.length} unit${target.cargo.length > 1 ? "s" : ""} aboard.`, target.owner === G.playerId ? "bad" : "sys");
          else log(`🌌 ${A.name} destroys a ${UNITS[target.unit].n} of ${D.name} in space.`, target.owner === G.playerId ? "bad" : "sys");
          if (target.owner === G.playerId) toast(`🌌 Your ${UNITS[target.unit].n} was destroyed in space!`);
          alienNoteLoss(target.owner, s.owner); // aliens remember who bleeds them (Part 1)
          removeShip(target);
          D.morale = clamp(D.morale - 1.5, 0, 100);
        }
      } else if (targetR) {
        s.cd = u.atk >= 1000 ? 3.0 : 1.6;
        let dmg = u.atk * 0.45 * (s.stack || 1) * milDmgMult(G.countries[s.owner]);
        // a Giant Shield soaks the fire first (Part 10)
        const hitObj = targetR.shield && targetR.shield.hp > 0 ? targetR.shield : targetR;
        hitObj.hp -= dmg;
        if (spaceFx.length < 200) spaceFx.push({ kind: "laser", x1: s.x, y1: s.y, z1: s.z, x2: targetR.x, y2: targetR.y, z2: targetR.z, ttl: 0.18, max: 0.18, big: u.atk >= 1000 });
        if (hitObj !== targetR && hitObj.hp <= 0) { hitObj.hp = 0; log(`🛡 The Giant Shield around a Researcher collapses!`, "war"); }
        if (hitObj === targetR && targetR.hp <= 0) {
          targetR.hp = 0;
          targetR.destroyed = true;
          spaceBoom(targetR, 30, "invade");
          sfx("mBoom");
          log(`🌆 The Researcher of ${G.countries[targetR.owner].name} IS DESTROYED — a city of a million lights goes dark.`, "war");
          if (targetR.owner === G.playerId) toast(`🌆 Your Researcher has been destroyed! It can be restored from its wreck.`);
          spacePanelDirty = true;
        }
      }
    }
  }
  // effects age out
  spaceFx = spaceFx.filter(f => {
    f.ttl -= dt;
    if (f.chunks) for (const ch of f.chunks) { ch.x += ch.vx * dt; ch.y += ch.vy * dt; ch.z += ch.vz * dt; }
    return f.ttl > 0;
  });
  if (spaceMsgTimer > 0) spaceMsgTimer -= dt;
  // the panel refreshes on a slow clock so numbers stay current
  if (spaceOpen && spacePanelDirty) { spacePanelDirty = false; renderSpacePanel(); }
}
function spaceBoom(pos, r, kind) {
  spaceFx.push({ kind: "boom", x: pos.x, y: pos.y, z: pos.z, r: r || 14, ttl: 0.8, max: 0.8, sub: kind });
}
function spaceShatter(pos, def) {
  const chunks = [];
  for (let i = 0; i < 26; i++) {
    const a = rnd(0, Math.PI * 2), b = rnd(-1, 1), v = rnd(12, 70);
    chunks.push({
      x: pos.x, y: pos.y, z: pos.z,
      vx: Math.cos(a) * v, vy: b * v * 0.5, vz: Math.sin(a) * v,
      r: rnd(1.5, def.r * 0.28),
    });
  }
  spaceFx.push({ kind: "shatter", x: pos.x, y: pos.y, z: pos.z, r: def.r, ttl: 3.2, max: 3.2, chunks, col: def.col });
}

// ---------------- view: enter / exit ----------------
function spaceSessionStart() {
  ensureSpaceState();
  spaceSel = null; spaceFx = []; spaceDrag = null; spacePlacing = null;
  // Critical Bug-Fix §2: the camera opens on the homeland system, wherever
  // this galaxy rolled it — no more staring at the empty galactic centre
  const homeSys = systemDef("home");
  spaceCam.x = homeSys ? homeSys.x : 0; spaceCam.y = 0; spaceCam.z = homeSys ? homeSys.z : 0;
  spaceCam.follow = null; spaceKeys = {};
  spacePanelDirty = true;
  if (spaceOpen) exitSpace(true);
}
function enterSpace() {
  if (!G) return;
  ensureSpaceState();
  spaceOpen = true;
  const vp = document.getElementById("space-vp");
  if (vp) vp.style.display = "block";
  for (const id of ["map-tools", "logfeed", "war-hint", "sel-bar"]) {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  }
  spacePanelDirty = true;
  if (typeof renderTopbar === "function") renderTopbar();
  sfx("click");
}
function exitSpace(silent) {
  spaceOpen = false;
  const vp = document.getElementById("space-vp");
  if (vp) vp.style.display = "none";
  const mt = document.getElementById("map-tools");
  if (mt && typeof screen === "string" && screen === "game") mt.style.display = "flex";
  const lf = document.getElementById("logfeed");
  if (lf && typeof screen === "string" && screen === "game") lf.style.display = "";
  if (typeof updateWarHint === "function") updateWarHint();
  if (!silent && typeof renderTopbar === "function") renderTopbar();
}
// does this nation have any business in space yet? (controls the topbar button)
function spaceUnlocked(c) {
  if (!G || !G.space) return false;
  if (shipsOfNation(c.id).length || coloniesOfNation(c.id).length) return true;
  if (spaceProgramCity(c.id)) return true;
  return countBldg(c, "spaceprogram") > 0;
}

// ---------------- projection & rendering ----------------
function spaceProject(x, y, z, W, H) {
  x -= spaceCam.x; y -= spaceCam.y; z -= spaceCam.z; // free camera centre (SU2 §5)
  const cy = Math.cos(spaceCam.yaw), sy = Math.sin(spaceCam.yaw);
  const cp = Math.cos(spaceCam.pitch), sp = Math.sin(spaceCam.pitch);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const y2 = y * cp - z1 * sp;
  const z2 = y * sp + z1 * cp;
  const F = 950;
  // denominator clamped so objects behind the camera can't flip across the screen
  const s = F / Math.max(140, F + z2 + 700) * spaceCam.zoom;
  return { sx: W / 2 + x1 * s, sy: H / 2 + y2 * s, s, depth: z2 };
}
// where is the camera focused / what is it following (SU2 Part 5)
function spaceCamResolveFollow() {
  const f = spaceCam.follow;
  if (!f) return;
  let p = null;
  if (f.kind === "ship") { const s = shipById(f.id); if (s) p = { x: s.x, y: s.y, z: s.z }; }
  else if (f.kind === "planet") { if (planetDef(f.id)) p = planetPos(f.id); }
  else if (f.kind === "star") { const sys = systemDef(f.sys || "home"); p = { x: sys.x, y: 0, z: sys.z }; }
  else if (f.kind === "bh") { const bh = galaxyBH(); if (bh) p = { x: bh.x, y: 0, z: bh.z }; }
  else if (f.kind === "researcher") { const r = researcherById(f.id); if (r) p = { x: r.x, y: r.y, z: r.z }; }
  if (!p) { spaceCam.follow = null; return; }
  // glide toward the object — snappy but not teleporting
  spaceCam.x += (p.x - spaceCam.x) * 0.25;
  spaceCam.y += (p.y - spaceCam.y) * 0.25;
  spaceCam.z += (p.z - spaceCam.z) * 0.25;
}
function spaceFocusSel() {
  if (!spaceSel) return;
  spaceCam.follow = { kind: spaceSel.kind === "alien" ? "star" : spaceSel.kind, id: spaceSel.id, sys: spaceSel.sys };
  if (spaceSel.kind === "alien") { // focus an alien = focus its home system
    const rec = alienById(spaceSel.id);
    if (rec) spaceCam.follow = { kind: "star", sys: rec.sys };
  }
  spacePanelDirty = true;
}
function spaceStopFollow(silent) {
  if (!spaceCam.follow) return;
  spaceCam.follow = null;
  spacePanelDirty = true;
  if (!silent) toast("🎥 Free camera.");
}
// WASD / arrow-key panning, applied every frame while the view is open
function spaceCamKeyTick(dt) {
  const k = spaceKeys;
  const dx = (k.right ? 1 : 0) - (k.left ? 1 : 0);
  const dz = (k.down ? 1 : 0) - (k.up ? 1 : 0);
  if (!dx && !dz) return;
  spaceStopFollow(true); // manual movement always breaks a follow
  const sp = 900 / Math.max(0.12, spaceCam.zoom) * dt;
  const cy = Math.cos(spaceCam.yaw), sy = Math.sin(spaceCam.yaw);
  // screen-right and screen-forward on the ecliptic plane
  spaceCam.x += (dx * cy - dz * sy) * sp;
  spaceCam.z += (dx * sy + dz * cy) * sp;
}
let spaceCamLastT = 0;
function spaceRender() {
  if (!spaceOpen || !G || !G.space) return;
  const cv = document.getElementById("space-cv");
  if (!cv) return;
  // camera motion runs on render time, so panning works even while paused
  const nowT = performance.now();
  const camDt = Math.min(0.05, (nowT - spaceCamLastT) / 1000 || 0.016);
  spaceCamLastT = nowT;
  spaceCamKeyTick(camDt);
  spaceCamResolveFollow();
  const vp = document.getElementById("space-vp");
  const W = vp.clientWidth, H = vp.clientHeight;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#04070f";
  ctx.fillRect(0, 0, W, H);
  // starfield
  if (!spaceStars) {
    spaceStars = [];
    let seed = 42;
    const rng = () => (seed = seed * 16807 % 2147483647) / 2147483647;
    for (let i = 0; i < 340; i++) {
      const a = rng() * Math.PI * 2, b = Math.acos(rng() * 2 - 1);
      spaceStars.push({ x: Math.sin(b) * Math.cos(a) * 5200, y: Math.cos(b) * 5200, z: Math.sin(b) * Math.sin(a) * 5200, m: rng() });
    }
  }
  for (const st of spaceStars) {
    // the starfield is an infinite backdrop: anchor it to the camera so panning
    // across the galaxy never leaves it behind
    const p = spaceProject(st.x + spaceCam.x, st.y + spaceCam.y, st.z + spaceCam.z, W, H);
    if (p.depth > 5200) continue;
    ctx.fillStyle = `rgba(210,225,255,${0.25 + st.m * 0.5})`;
    ctx.fillRect(p.sx, p.sy, st.m > 0.92 ? 2 : 1, st.m > 0.92 ? 2 : 1);
  }
  // orbit rings (revealed systems only, and only when the system is close
  // enough to matter — distant systems collapse to simple dots, SU2 §6)
  ctx.lineWidth = 1;
  for (const def of SPACE_PLANETS) {
    if (!systemRevealed(planetSysId(def))) continue;
    if (phantomHiddenFrom(planetSysId(def), G.playerId)) continue; // Update §17: cloaked
    const sys = systemDef(planetSysId(def));
    const sp = spaceProject(sys.x, 0, sys.z, W, H);
    if (sp.s * def.dist < 26) continue;                     // too small to read
    if (sp.sx < -700 || sp.sx > W + 700 || sp.sy < -700 || sp.sy > H + 700) continue; // off-screen
    ctx.strokeStyle = "rgba(110,190,255,.10)";
    ctx.beginPath();
    let first = true;
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const p = spaceProject(sys.x + Math.cos(a) * def.dist, Math.sin(a * 1.7 + def.dist) * def.dist * 0.05, sys.z + Math.sin(a) * def.dist, W, H);
      if (first) { ctx.moveTo(p.sx, p.sy); first = false; } else ctx.lineTo(p.sx, p.sy);
    }
    ctx.stroke();
  }
  // ambient interplanetary traffic (QoL §15): stateless glints between colonies
  if (typeof viewOpts === "undefined" || viewOpts.ambient !== false) drawColonyTraffic(ctx, W, H);
  // build the draw list, far → near
  const items = [];
  for (const sys of SPACE_SYSTEMS) {
    items.push({ kind: "star", sys, depth: spaceProject(sys.x, 0, sys.z, W, H).depth });
  }
  for (const def of SPACE_PLANETS) {
    if (!systemRevealed(planetSysId(def))) continue;
    if (phantomHiddenFrom(planetSysId(def), G.playerId)) continue; // Update §17: cloaked systems show nothing
    const pos = planetPos(def.id);
    const pr = spaceProject(pos.x, pos.y, pos.z, W, H);
    items.push({ kind: "planet", def, pos, pr, depth: pr.depth });
  }
  for (const r of G.space.researchers || []) {
    if (phantomHiddenFrom(systemAt(r.x, r.z).id, G.playerId)) continue; // stations hide too
    const pr = spaceProject(r.x, r.y, r.z, W, H);
    items.push({ kind: "researcher", r, pr, depth: pr.depth });
  }
  // Update §5: the galactic core — always part of the scene
  const bhDraw = galaxyBH();
  if (bhDraw) items.push({ kind: "bh", depth: spaceProject(bhDraw.x, 0, bhDraw.z, W, H).depth });
  for (const s of G.space.ships) {
    if (!shipVisibleToPlayer(s)) continue; // uncharted systems + troop-visibility setting (SU2 §4)
    const pr = spaceProject(s.x, s.y, s.z, W, H);
    items.push({ kind: "ship", s, pr, depth: pr.depth });
  }
  for (const f of spaceFx) {
    const pr = spaceProject(f.x !== undefined ? f.x : f.x1, f.y !== undefined ? f.y : f.y1, f.z !== undefined ? f.z : f.z1, W, H);
    items.push({ kind: "fx", f, pr, depth: pr.depth });
  }
  items.sort((a, b) => b.depth - a.depth);
  for (const it of items) {
    if (it.kind === "star") drawStar(ctx, it, W, H);
    else if (it.kind === "planet") drawPlanet(ctx, it, spaceProject(systemDef(planetSysId(it.def)).x, 0, systemDef(planetSysId(it.def)).z, W, H), W, H);
    else if (it.kind === "researcher") drawResearcher(ctx, it, W, H);
    else if (it.kind === "ship") drawShip(ctx, it, W, H);
    else if (it.kind === "bh") drawBlackHole(ctx, W, H);
    else drawSpaceFx(ctx, it, W, H);
  }
  // Update §21: camera transitions in/out of cloaked space ripple and smear
  phantomCamFx();
  // Update §3: a dead-sun system wraps the whole view in frozen, dusty cold
  const camSysD = systemAt(spaceCam.x, spaceCam.z);
  if (sysLightState(camSysD.id) === "dead" &&
      (spaceCam.x - camSysD.x) ** 2 + (spaceCam.z - camSysD.z) ** 2 < 900 * 900) {
    drawDeadSystemHaze(ctx, camSysD, W, H);
  }
  // Update §21.3: inside your own cloaked system, space itself feels softened
  if (phantomActive(camSysD.id) && !phantomHiddenFrom(camSysD.id, G.playerId) &&
      (spaceCam.x - camSysD.x) ** 2 + (spaceCam.z - camSysD.z) ** 2 < 900 * 900) {
    drawPhantomInterior(ctx, W, H);
  }
  // Small Update §3: the great harvesting beams — energy streaming from suns
  // into Star Destroyers, inspired by a planet-sized superweapon feeding
  for (const s of G.space.ships) {
    if (s.harvest && shipVisibleToPlayer(s)) drawHarvestBeam(ctx, s, W, H);
  }
  // AI Update §21: the drag-selection box (Ctrl + drag over your fleet)
  if (spaceDrag && spaceDrag.box && spaceDrag.moved) {
    const vpEl = document.getElementById("space-vp");
    const rect = vpEl.getBoundingClientRect();
    const ax = Math.min(spaceDrag.sx, spaceDrag.cx || spaceDrag.sx) - rect.left;
    const ay = Math.min(spaceDrag.sy, spaceDrag.cy || spaceDrag.sy) - rect.top;
    const bw = Math.abs((spaceDrag.cx || spaceDrag.sx) - spaceDrag.sx);
    const bh2 = Math.abs((spaceDrag.cy || spaceDrag.sy) - spaceDrag.sy);
    ctx.strokeStyle = "rgba(120,210,255,.9)";
    ctx.fillStyle = "rgba(120,210,255,.12)";
    ctx.lineWidth = 1;
    ctx.fillRect(ax, ay, bw, bh2);
    ctx.strokeRect(ax, ay, bw, bh2);
  }
  // HUD footer
  ctx.font = "12px 'Segoe UI', sans-serif";
  ctx.fillStyle = "rgba(125,147,173,.9)";
  ctx.textAlign = "center";
  ctx.fillText("Drag: rotate · right-drag / WASD: move · wheel: zoom · Ctrl-drag: select fleet · Shift-click ship: add to fleet · ship + click: fly · E near a planet: land / deploy", W / 2, H - 12);
  if (spaceSelFleet.length > 1) {
    ctx.fillStyle = "rgba(150,220,255,.85)";
    ctx.fillText(`⛿ fleet of ${spaceSelFleet.length} selected — click a destination to move as one`, W / 2, H - 28);
  } else if (spaceCam.follow) {
    ctx.fillStyle = "rgba(150,220,255,.85)";
    ctx.fillText("🎥 following — pan, WASD or Esc to break away", W / 2, H - 28);
  }
}
// small glints travelling between a nation's colonies — pure decoration
function drawColonyTraffic(ctx, W, H) {
  const byOwner = {};
  for (const def of SPACE_PLANETS) {
    if (!systemRevealed(planetSysId(def))) continue;
    const st = G.space.planets[def.id];
    if (!st || st.destroyed) continue;
    if (def.type === "main" || st.colony) {
      const owner = def.type === "main" ? -1 : st.colony.owner;
      (byOwner[owner] = byOwner[owner] || []).push(def.id);
    }
  }
  const t = warNowSafe();
  ctx.fillStyle = "rgba(170,220,255,.85)";
  for (const key of Object.keys(byOwner)) {
    if (key === "-1") continue;
    const owner = Number(key);
    const list = byOwner[key].concat(byOwner["-1"] || []); // colonies + the Homeworld
    if (list.length < 2) continue;
    for (let i = 0; i < Math.min(3, list.length - 1); i++) {
      const a = planetPos(list[i]), b = planetPos(list[(i + 1) % list.length]);
      for (let k = 0; k < 2; k++) {
        const f = ((t * (0.04 + k * 0.023) + i * 0.37 + owner * 0.11 + k * 0.5) % 1);
        const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f + Math.sin(f * Math.PI) * 8, z = a.z + (b.z - a.z) * f;
        const p = spaceProject(x, y, z, W, H);
        ctx.globalAlpha = 0.35 + 0.4 * Math.sin(f * Math.PI);
        ctx.fillRect(p.sx, p.sy, 1.6, 1.6);
      }
    }
  }
  ctx.globalAlpha = 1;
}
function drawStar(ctx, it, W, H) {
  const sys = it.sys;
  const p = spaceProject(sys.x, 0, sys.z, W, H);
  if (p.sx < -300 || p.sx > W + 300 || p.sy < -300 || p.sy > H + 300) return; // off-screen (SU2 §6)
  const revealed = systemRevealed(sys.id);
  const zoomedOut = spaceCam.zoom < 0.12;
  const r = Math.max(revealed ? (zoomedOut ? 2.5 : 8) : (zoomedOut ? 2 : 4), sys.r * p.s);
  const col = sys.col;
  const stS = (G.space.systems && G.space.systems[sys.id]) || {};
  // Update §17/§21.1: a system cloaked from this viewer is a soft void
  // distortion — unfocusable, flickering between haze and empty space
  if (phantomHiddenFrom(sys.id, G.playerId)) { drawPhantomFog(ctx, sys, p, r, zoomedOut); return; }
  // Small Update §7: a system erased by the Omni Laser is a permanent nebula —
  // visible even from the galaxy view, and the only thing left to see here
  if (stS.nova) { drawNebula(ctx, sys, stS, p, r, zoomedOut); return; }
  // Small Update §3-4: harvested suns burn visibly dimmer — a running harvest
  // dims the star as you watch, and the third harvest leaves a dead cinder
  let hDim = stS.harvests || 0;
  const hvShip = stS.dead ? null : G.space.ships.find(x => x.harvest && x.harvest.sys === sys.id);
  if (hvShip) hDim += clamp(hvShip.harvest.prog / hvShip.harvest.need, 0, 1);
  const dimF = stS.dead ? 0 : clamp(1 - STELLAR_HARVEST.dim * hDim, 0.08, 1);
  if (r >= 3 && dimF > 0.1) { // full glow only when the star is big enough to matter
    const g = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, r * 2.4);
    g.addColorStop(0, `rgba(255,240,190,${(0.95 * dimF).toFixed(3)})`);
    g.addColorStop(0.35, `rgba(${col[0]},${col[1]},${col[2]},${(0.55 * dimF).toFixed(3)})`);
    g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, r * 2.4, 0, Math.PI * 2); ctx.fill();
  }
  if (stS.dead) {
    // a collapsed sun: a small dark remnant with a last cooling ember ring
    ctx.fillStyle = "rgba(58,50,48,.9)";
    ctx.beginPath(); ctx.arc(p.sx, p.sy, Math.max(2, r * 0.55), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(180,90,60,.35)";
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, Math.max(3, r * 0.7), 0, Math.PI * 2); ctx.stroke();
  } else {
    const coreA = (revealed ? 1 : 0.6) * (0.3 + 0.7 * dimF);
    ctx.fillStyle = `rgba(255,233,176,${coreA.toFixed(3)})`;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2); ctx.fill();
  }
  // AI Update §13: an active (or rising) Void Shield wraps the whole system in
  // a faint dashed barrier — its glow fades as the generator takes damage
  if (revealed && stS.voidShield && (stS.voidShield.hp > 0 || stS.voidShield.building)) {
    const vs = stS.voidShield;
    const vR = Math.max(r * 1.6, voidShieldRadius(sys.id) * p.s);
    const frac = vs.building ? 0.35 : 0.35 + 0.65 * clamp(vs.hp / vs.maxHp, 0, 1);
    ctx.save();
    ctx.strokeStyle = `rgba(110,220,255,${(0.5 * frac).toFixed(3)})`;
    ctx.lineWidth = vs.building ? 1 : 1.6;
    ctx.setLineDash(vs.building ? [3, 9] : [8, 5]);
    ctx.beginPath(); ctx.arc(p.sx, p.sy, vR, 0, Math.PI * 2); ctx.stroke();
    if (!vs.building && !zoomedOut) {
      ctx.strokeStyle = `rgba(110,220,255,${(0.16 * frac).toFixed(3)})`;
      ctx.lineWidth = 5;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(p.sx, p.sy, vR * 0.985, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  // Dyson Sphere lattice (home star: player-built; foreign stars: alien-built)
  const dy = dysonOfSystem(sys.id) || (sys.id === "home" && G.space.dyson ? G.space.dyson : null);
  if (dy && revealed && (dy.stage > 0 || dy.building)) {
    const dcol = G.countries[dy.owner] ? G.countries[dy.owner].flag.bg : [160, 200, 255];
    ctx.strokeStyle = `rgba(${dcol[0]},${dcol[1]},${dcol[2]},.8)`;
    ctx.lineWidth = Math.max(1.5, 3 * p.s);
    const frac = clamp((dy.stage + (dy.building ? dy.prog / MEGA_DEFS.dyson.ticks : 0)) / MEGA_DEFS.dyson.stages, 0, 1);
    const R = r * 1.7;
    for (let ring = 0; ring < 3; ring++) {
      const tilt = ring * 1.05 + warNowSafe() * 0.1;
      ctx.beginPath();
      ctx.ellipse(p.sx, p.sy, R, R * Math.abs(Math.sin(tilt)) * 0.9 + R * 0.08, tilt, 0, Math.PI * 2 * frac);
      ctx.stroke();
    }
    if (dy.stage >= MEGA_DEFS.dyson.stages) {
      ctx.strokeStyle = `rgba(${dcol[0]},${dcol[1]},${dcol[2]},.35)`;
      ctx.beginPath(); ctx.arc(p.sx, p.sy, R * 1.12, 0, Math.PI * 2); ctx.stroke();
    }
    if (dy.shield && dy.shield.hp > 0) drawShieldBubble(ctx, p.sx, p.sy, R * 1.3, dy.shield);
  }
  if (spaceSel && spaceSel.kind === "star" && (spaceSel.sys || "home") === sys.id) drawSelRing(ctx, p.sx, p.sy, r * 1.3);
  ctx.font = zoomedOut ? "9px 'Segoe UI', sans-serif" : "600 12px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = stS.dead ? "rgba(200,170,160,.7)" : zoomedOut ? "rgba(255,230,170,.55)" : "rgba(255,230,170,.85)";
  ctx.fillText(revealed ? (stS.dead ? sys.n + " — dead star" : sys.n) : "Unknown Star", p.sx, p.sy - r * 2.5 - 6);
  if (!revealed && !zoomedOut) {
    ctx.font = "10px 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(150,170,200,.6)";
    ctx.fillText("uncharted system", p.sx, p.sy - r * 2.5 + 6);
  } else if (revealed && stS.dead && !zoomedOut) {
    ctx.font = "10px 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(180,140,130,.6)";
    ctx.fillText("harvested to collapse — it will never shine again", p.sx, p.sy - r * 2.5 + 6);
  }
}
// Small Update §7: the permanent nebula left where a solar system was destroyed.
// Drawn in place of the star at every zoom level — evidence the weapon was used.
function drawNebula(ctx, sys, stS, p, r, zoomedOut) {
  const R = Math.max(zoomedOut ? 5 : 12, sys.r * 2.6 * p.s);
  let seed = (stS.nebula && stS.nebula.seed) || 7;
  const rng = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const t = warNowSafe();
  const cols = [[168, 90, 210], [90, 140, 230], [232, 120, 176]];
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2 + t * 0.008 * (i % 2 ? 1 : -1); // the cloud slowly churns
    const d = rng() * R * 0.55;
    const cx = p.sx + Math.cos(a) * d, cy = p.sy + Math.sin(a) * d * 0.7;
    const cr = R * (0.35 + rng() * 0.5);
    const c = cols[i % cols.length];
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
    g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},.30)`);
    g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();
  }
  // embers of the murdered star drift in the cloud
  ctx.fillStyle = "rgba(255,190,160,.5)";
  for (let i = 0; i < 12; i++) {
    const a = rng() * Math.PI * 2, d = rng() * R * 0.8;
    ctx.fillRect(p.sx + Math.cos(a) * d, p.sy + Math.sin(a) * d * 0.7, 1.5, 1.5);
  }
  if (spaceSel && spaceSel.kind === "star" && (spaceSel.sys || "home") === sys.id) drawSelRing(ctx, p.sx, p.sy, R * 0.6);
  ctx.font = zoomedOut ? "9px 'Segoe UI', sans-serif" : "600 12px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(215,170,255,.8)";
  ctx.fillText(`${sys.n} Nebula`, p.sx, p.sy - R - 6);
  if (!zoomedOut) {
    ctx.font = "10px 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(185,150,215,.65)";
    ctx.fillText("a solar system died here — nothing can be rebuilt", p.sx, p.sy - R + 8);
  }
}
// Update §21.1: the void distortion cloud over a Phantom Step system — not
// fully invisible, just impossible to focus on
function drawPhantomFog(ctx, sys, p, r, zoomedOut) {
  const t = warNowSafe();
  const R = Math.max(zoomedOut ? 4 : 10, sys.r * 1.8 * p.s);
  // flicker between empty space, dim haze and subtle starfield warping
  const phase = 0.5 + 0.5 * Math.sin(t * 0.7 + (sys.x + sys.z) * 0.001);
  if (phase > 0.25) {
    const g = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, R);
    g.addColorStop(0, `rgba(90,105,140,${(0.10 + phase * 0.10).toFixed(3)})`);
    g.addColorStop(0.7, `rgba(60,70,100,${(0.05 + phase * 0.07).toFixed(3)})`);
    g.addColorStop(1, "rgba(40,45,70,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, R, 0, Math.PI * 2); ctx.fill();
  }
  // warped star-streaks bending around the unseeable
  ctx.strokeStyle = `rgba(150,165,205,${(0.08 + phase * 0.12).toFixed(3)})`;
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + t * 0.05 * (i % 2 ? 1 : -1);
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, R * (0.45 + i * 0.16), a, a + 1.2 + phase * 0.7);
    ctx.stroke();
  }
  if (spaceSel && spaceSel.kind === "star" && (spaceSel.sys || "home") === sys.id) drawSelRing(ctx, p.sx, p.sy, R * 0.7);
  // no name — as far as the galaxy knows, nothing is here
}
// Update §3: the frozen-space atmosphere of a dead-sun system — cold grading,
// drifting dust, a faint shimmer. Pure mood, no UI penalty.
function drawDeadSystemHaze(ctx, sys, W, H) {
  const t = warNowSafe();
  // cold blue-gray colour grading over the whole view
  const veil = ctx.createLinearGradient(0, 0, 0, H);
  veil.addColorStop(0, "rgba(40,58,86,.14)");
  veil.addColorStop(0.5, "rgba(24,34,54,.10)");
  veil.addColorStop(1, "rgba(12,18,34,.16)");
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, W, H);
  // slow drifting dust motes
  ctx.fillStyle = "rgba(170,190,215,.20)";
  let seed = 13;
  const rng = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  for (let i = 0; i < 26; i++) {
    const x = ((rng() * W + t * (2 + rng() * 5)) % (W + 20)) - 10;
    const y = ((rng() * H + t * (1 + rng() * 2.4)) % (H + 20)) - 10;
    ctx.globalAlpha = 0.08 + rng() * 0.16;
    ctx.fillRect(x, y, rng() < 0.2 ? 2 : 1, rng() < 0.2 ? 2 : 1);
  }
  ctx.globalAlpha = 1;
  // the faint "frozen space" shimmer — a slow band of cold light
  const bandY = (t * 6) % (H * 1.4) - H * 0.2;
  const sg = ctx.createLinearGradient(0, bandY - 30, 0, bandY + 30);
  sg.addColorStop(0, "rgba(150,190,230,0)");
  sg.addColorStop(0.5, "rgba(150,190,230,.045)");
  sg.addColorStop(1, "rgba(150,190,230,0)");
  ctx.fillStyle = sg;
  ctx.fillRect(0, bandY - 30, W, 60);
}
// Update §21.3: inside a cloaked system — softened light, a faint phase shimmer
function drawPhantomInterior(ctx, W, H) {
  const t = warNowSafe();
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.85);
  g.addColorStop(0, "rgba(120,130,175,.045)");
  g.addColorStop(1, `rgba(70,80,130,${(0.10 + 0.03 * Math.sin(t * 1.4)).toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = `rgba(160,175,225,${(0.05 + 0.03 * Math.sin(t * 2.3)).toFixed(3)})`;
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const y = ((t * 9 + i * H / 3) % (H + 40)) - 20;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y + Math.sin(t + i) * 6); ctx.stroke();
  }
}
// Update §21.2/§21.4: ripple on entering cloaked space, light-smear on leaving
let phantomCamSys = null;
function phantomCamFx() {
  const sys = systemAt(spaceCam.x, spaceCam.z);
  const inP = phantomActive(sys.id) && !phantomHiddenFrom(sys.id, G.playerId) ? sys.id : null;
  if (inP !== phantomCamSys) {
    if (inP) spaceFx.push({ kind: "ripple", x: spaceCam.x, y: 0, z: spaceCam.z, ttl: 1.1, max: 1.1 });
    else if (phantomCamSys) spaceFx.push({ kind: "streak", x: spaceCam.x, y: 0, z: spaceCam.z, ttl: 0.9, max: 0.9 });
    phantomCamSys = inP;
  }
}
// Update §5+§7: the supermassive black hole — and whatever mankind (or others)
// have dared to wrap around it
function drawBlackHole(ctx, W, H) {
  const bh = galaxyBH();
  if (!bh) return;
  const p = spaceProject(bh.x, 0, bh.z, W, H);
  if (p.sx < -400 || p.sx > W + 400 || p.sy < -400 || p.sy > H + 400) return;
  const zoomedOut = spaceCam.zoom < 0.12;
  const r = Math.max(zoomedOut ? 3.5 : 11, bh.r * p.s);
  const t = warNowSafe();
  // gravitational glow — visible even from the galaxy view
  const gg = ctx.createRadialGradient(p.sx, p.sy, r * 0.6, p.sx, p.sy, r * 3.2);
  gg.addColorStop(0, "rgba(255,150,70,.30)");
  gg.addColorStop(0.4, "rgba(190,110,255,.14)");
  gg.addColorStop(1, "rgba(120,60,200,0)");
  ctx.fillStyle = gg;
  ctx.beginPath(); ctx.arc(p.sx, p.sy, r * 3.2, 0, Math.PI * 2); ctx.fill();
  // accretion disk: hot tilted rings, slowly turning
  for (let i = 0; i < 3; i++) {
    const tilt = 0.5 + i * 0.06;
    ctx.strokeStyle = i === 0 ? "rgba(255,220,160,.75)" : i === 1 ? "rgba(255,160,90,.55)" : "rgba(200,120,255,.35)";
    ctx.lineWidth = Math.max(1, r * (0.16 - i * 0.04));
    ctx.beginPath();
    ctx.ellipse(p.sx, p.sy, r * (1.5 + i * 0.45), r * (0.42 + i * 0.14), tilt + Math.sin(t * 0.1 + i) * 0.02, 0, Math.PI * 2);
    ctx.stroke();
  }
  // the event horizon and its photon ring
  ctx.fillStyle = "#000";
  ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,235,200,.9)";
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.beginPath(); ctx.arc(p.sx, p.sy, r * 1.06, 0, Math.PI * 2); ctx.stroke();
  // ---- the Black Hole Energy Harvester (Update §7) ----
  const bhH = G.space.bhH;
  if (bhH && !zoomedOut) {
    const col = G.countries[bhH.owner] ? G.countries[bhH.owner].flag.bg : [170, 200, 240];
    const R1 = r * 2.1, R2 = r * 2.6;
    if (bhH.ruins) {
      // §14: broken arcs drift around the untouched core
      ctx.strokeStyle = "rgba(120,115,125,.55)";
      ctx.lineWidth = Math.max(1.5, r * 0.09);
      for (let i = 0; i < 4; i++) {
        const a = i * 1.7 + 0.4;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, R1 + (i % 2) * r * 0.3, a, a + 0.55); ctx.stroke();
      }
    } else {
      const frac = clamp((bhH.stage + (bhH.building ? bhH.prog / BH_HARVESTER.ticksPerStage : 0)) / BH_HARVESTER.stages, 0, 1);
      const spin = t * 0.15;
      // rotating structure sections — arcs sweep further as stages complete
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},.9)`;
      ctx.lineWidth = Math.max(2, r * 0.11);
      for (let i = 0; i < 3; i++) {
        const a = spin * (i % 2 ? 1 : -1) + i * 2.1;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, R1 + i * r * 0.22, a, a + Math.PI * 0.6 * frac); ctx.stroke();
      }
      // collector pylons with lit tips
      ctx.lineWidth = Math.max(1.2, r * 0.05);
      const nPy = Math.max(1, Math.round(6 * frac));
      for (let i = 0; i < nPy; i++) {
        const a = i * (Math.PI * 2 / 6) + spin * 0.4;
        const x1 = p.sx + Math.cos(a) * R1 * 0.96, y1 = p.sy + Math.sin(a) * R1 * 0.6;
        const x2 = p.sx + Math.cos(a) * R2, y2 = p.sy + Math.sin(a) * R2 * 0.62;
        ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},.75)`;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.fillStyle = "rgba(255,240,190,.95)";
        ctx.beginPath(); ctx.arc(x2, y2, Math.max(1, r * 0.07), 0, Math.PI * 2); ctx.fill();
        // defensive platforms blink on the outer ring
        if (bhH.stage >= BH_HARVESTER.stages && Math.sin(t * 3 + i * 2.2) > 0.3) {
          ctx.fillStyle = "rgba(255,120,120,.8)";
          ctx.fillRect(x2 - 1, y2 - 4, 2, 2);
        }
      }
      // energy beams: the visible connection to the black hole's power
      if (bhH.stage >= BH_HARVESTER.stages) {
        for (let i = 0; i < 3; i++) {
          const a = spin * 0.7 + i * 2.1;
          const bx = p.sx + Math.cos(a) * R1 * 0.9, by = p.sy + Math.sin(a) * R1 * 0.58;
          const g2 = ctx.createLinearGradient(p.sx, p.sy, bx, by);
          g2.addColorStop(0, "rgba(255,190,110,.65)");
          g2.addColorStop(1, "rgba(160,240,255,.25)");
          ctx.strokeStyle = g2;
          ctx.lineWidth = 1.6 + Math.sin(t * 11 + i) * 0.7;
          ctx.beginPath(); ctx.moveTo(p.sx + Math.cos(a) * r * 1.1, p.sy + Math.sin(a) * r * 0.7); ctx.lineTo(bx, by); ctx.stroke();
        }
      }
      if (bhH.shield && bhH.shield.hp > 0) drawShieldBubble(ctx, p.sx, p.sy, R2 * 1.12, bhH.shield);
      // hull bar when hurt
      if (bhH.hp < bhH.maxHp) {
        const w2 = Math.max(26, r * 2.4);
        ctx.fillStyle = "rgba(0,0,0,.6)";
        ctx.fillRect(p.sx - w2 / 2, p.sy - R2 - 10, w2, 3);
        ctx.fillStyle = bhH.hp / bhH.maxHp > 0.45 ? "#5ce0a2" : "#ff9264";
        ctx.fillRect(p.sx - w2 / 2, p.sy - R2 - 10, w2 * clamp(bhH.hp / bhH.maxHp, 0, 1), 3);
      }
    }
  }
  if (spaceSel && spaceSel.kind === "bh") drawSelRing(ctx, p.sx, p.sy, r * 1.6);
  ctx.font = zoomedOut ? "9px 'Segoe UI', sans-serif" : "600 12px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,200,150,.85)";
  const bhLabel = bhH && !bhH.ruins
    ? (bhH.stage >= BH_HARVESTER.stages ? `Black Hole — ${G.countries[bhH.owner] ? G.countries[bhH.owner].name : "?"}'s Harvester` : "Black Hole — Harvester under construction")
    : bhH && bhH.ruins ? "Black Hole — Harvester ruins" : "Supermassive Black Hole";
  ctx.fillText(bhLabel, p.sx, p.sy - r * 3.2 - 6);
  if (!zoomedOut && bh.aliens && (G.space.aliens || []).some(a => a.bhGuard && !a.defeated)) {
    ctx.font = "10px 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(235,160,255,.7)";
    ctx.fillText("👁 an alien presence keeps watch here", p.sx, p.sy - r * 3.2 + 8);
  }
}
// Small Update §3: the visible energy transfer of a stellar harvest — a broad
// beam from the sun into the Star Destroyer with motes streaming along it,
// plus a progress ring on the ship so the charge-up is unmistakable
function drawHarvestBeam(ctx, s, W, H) {
  const src = s.harvest.bh ? galaxyBH() : systemDef(s.harvest.sys);
  if (!src) return;
  const sys = src;
  const p1 = spaceProject(sys.x, 0, sys.z, W, H);
  const p2 = spaceProject(s.x, s.y, s.z, W, H);
  if (p1.depth <= -600 && p2.depth <= -600) return;
  const t = warNowSafe();
  const g = ctx.createLinearGradient(p1.sx, p1.sy, p2.sx, p2.sy);
  g.addColorStop(0, "rgba(255,220,120,.16)");
  g.addColorStop(1, "rgba(160,240,255,.5)");
  ctx.strokeStyle = g;
  ctx.lineWidth = 7 + Math.sin(t * 14) * 2;
  ctx.beginPath(); ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy); ctx.stroke();
  ctx.strokeStyle = "rgba(255,250,220,.85)";
  ctx.lineWidth = 1.6 + Math.sin(t * 22) * 0.7;
  ctx.beginPath(); ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy); ctx.stroke();
  // energy motes travel SUN → SHIP
  ctx.fillStyle = "rgba(255,245,200,.95)";
  for (let i = 0; i < 8; i++) {
    const f = (t * 0.5 + i / 8) % 1;
    const mx = p1.sx + (p2.sx - p1.sx) * f, my = p1.sy + (p2.sy - p1.sy) * f;
    ctx.beginPath(); ctx.arc(mx, my, 2.6 - f * 1.4, 0, Math.PI * 2); ctx.fill();
  }
  // the weapon-charge meter fills as the harvest runs
  const frac = clamp(s.harvest.prog / s.harvest.need, 0, 1);
  ctx.strokeStyle = "rgba(160,240,255,.9)";
  ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.arc(p2.sx, p2.sy, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
  ctx.font = "10px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(190,245,255,.9)";
  ctx.fillText(`${s.harvest.bh ? "🕳 charging" : "🌞 harvesting"} ${Math.round(frac * 100)}%`, p2.sx, p2.sy - 16);
}
// the translucent energy barrier of a Giant Shield (Part 4)
function drawShieldBubble(ctx, sx, sy, r, shield) {
  const frac = clamp(shield.hp / shield.maxHp, 0, 1);
  const pulse = 0.75 + 0.25 * Math.sin(warNowSafe() * 2.2);
  ctx.strokeStyle = `rgba(120,220,255,${(0.3 + 0.4 * frac) * pulse})`;
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
  const g = ctx.createRadialGradient(sx, sy, r * 0.8, sx, sy, r);
  g.addColorStop(0, "rgba(120,220,255,0)");
  g.addColorStop(1, `rgba(120,220,255,${0.14 * frac * pulse})`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
}
// the Researcher: an enormous glittering city adrift in space (Part 9)
function drawResearcher(ctx, it, W, H) {
  const { r, pr } = it;
  const size = Math.max(4, 22 * pr.s);
  const col = G.countries[r.owner] ? G.countries[r.owner].flag.bg : [180, 200, 230];
  ctx.save();
  ctx.translate(pr.sx, pr.sy);
  if (r.destroyed) {
    ctx.rotate(0.4);
    ctx.fillStyle = "rgba(90,85,95,.8)";
    ctx.fillRect(-size * 0.7, -size * 0.2, size * 1.4, size * 0.4);
    ctx.fillStyle = "rgba(60,55,65,.8)";
    ctx.fillRect(-size * 0.3, -size * 0.45, size * 0.5, size * 0.9);
    ctx.restore();
    ctx.font = "10px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(200,170,170,.75)";
    ctx.fillText(`🌆 Researcher — destroyed (${G.countries[r.owner] ? G.countries[r.owner].name : "?"})`, pr.sx, pr.sy + size + 12);
    return;
  }
  ctx.rotate(warNowSafe() * 0.05 + (typeof r.id === "string" ? r.id.length : 0));
  // hull: a broad plate city
  ctx.fillStyle = `rgb(${Math.min(255, col[0] + 40)},${Math.min(255, col[1] + 40)},${Math.min(255, col[2] + 40)})`;
  ctx.fillRect(-size, -size * 0.22, size * 2, size * 0.44);
  ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
  ctx.fillRect(-size * 0.55, -size * 0.5, size * 1.1, size);
  // city lights
  ctx.fillStyle = "rgba(255,238,170,.95)";
  for (let i = 0; i < 4 + r.lvl * 4; i++) {
    const lx = ((i * 37) % 100 / 100 - 0.5) * size * 1.8;
    const ly = ((i * 53) % 100 / 100 - 0.5) * size * 0.8;
    const on = Math.sin(warNowSafe() * (1 + i * 0.13) + i) > -0.4;
    if (on) ctx.fillRect(lx, ly, Math.max(0.8, size * 0.05), Math.max(0.8, size * 0.05));
  }
  ctx.restore();
  // shield bubble
  if (r.shield && r.shield.hp > 0) drawShieldBubble(ctx, pr.sx, pr.sy, size * 1.5, r.shield);
  // hp bar
  const hpw = Math.max(14, size * 2);
  ctx.fillStyle = "rgba(0,0,0,.6)";
  ctx.fillRect(pr.sx - hpw / 2, pr.sy - size - 8, hpw, 3);
  ctx.fillStyle = r.owner === G.playerId ? "#5ce0a2" : "#ffb054";
  ctx.fillRect(pr.sx - hpw / 2, pr.sy - size - 8, hpw * clamp(r.hp / r.maxHp, 0, 1), 3);
  if (spaceSel && spaceSel.kind === "researcher" && spaceSel.id === r.id) drawSelRing(ctx, pr.sx, pr.sy, size + 8);
  ctx.font = "10px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(220,235,255,.9)";
  ctx.fillText(`🌆 Researcher L${r.lvl} · ${G.countries[r.owner] ? G.countries[r.owner].name : "?"}`, pr.sx, pr.sy + size + 12);
}
function warNowSafe() { return typeof warNow === "number" ? warNow : 0; }
function drawPlanet(ctx, it, starP, W, H) {
  const { def, pr } = it;
  if (pr.sx < -200 || pr.sx > W + 200 || pr.sy < -200 || pr.sy > H + 200) return;
  const st = planetState(def.id);
  // simplified distant model (SU2 §6): far planets are a plain tinted dot
  if (def.r * pr.s < 2.1) {
    ctx.fillStyle = `rgb(${def.col[0]},${def.col[1]},${def.col[2]})`;
    ctx.beginPath(); ctx.arc(pr.sx, pr.sy, Math.max(1, def.r * pr.s), 0, Math.PI * 2); ctx.fill();
    if (st.colony && G.countries[st.colony.owner]) {
      const oc = G.countries[st.colony.owner].flag.bg;
      ctx.strokeStyle = `rgba(${oc[0]},${oc[1]},${oc[2]},.8)`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(pr.sx, pr.sy, 2.6, 0, Math.PI * 2); ctx.stroke();
    }
    if (spaceSel && spaceSel.kind === "planet" && spaceSel.id === def.id) drawSelRing(ctx, pr.sx, pr.sy, 6);
    return;
  }
  const r = Math.max(3, def.r * pr.s);
  if (st.destroyed) {
    // shattered world: dead chunks and a dust ring
    ctx.strokeStyle = "rgba(150,140,140,.3)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(pr.sx, pr.sy, r * 1.8, r * 0.5, 0.4, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(120,110,110,.8)";
    for (let i = 0; i < 6; i++) {
      const a = i * 1.9 + def.dist;
      ctx.beginPath();
      ctx.arc(pr.sx + Math.cos(a) * r * 0.9, pr.sy + Math.sin(a) * r * 0.55, Math.max(1, r * (0.12 + (i % 3) * 0.08)), 0, Math.PI * 2);
      ctx.fill();
    }
    // a Rehabilitator reassembling the debris (Part 3)
    if (st.rehab) {
      ctx.strokeStyle = "rgba(120,240,170,.85)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pr.sx, pr.sy, r * 1.3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * st.rehab.prog / st.rehab.need); ctx.stroke();
    }
    ctx.font = "11px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(190,170,170,.7)";
    ctx.fillText(`${def.n} — destroyed${st.rehab ? ` · ♻ ${Math.round(100 * st.rehab.prog / st.rehab.need)}%` : ""}`, pr.sx, pr.sy - r * 2 - 4);
    return;
  }
  // ownership halo (Part 13): the owner's colour glows far beyond the planet
  const showOwners = typeof viewOpts === "undefined" || viewOpts.spaceOwners !== false;
  if (showOwners && st.colony && G.countries[st.colony.owner]) {
    const oc = G.countries[st.colony.owner].flag.bg;
    const og = ctx.createRadialGradient(pr.sx, pr.sy, r, pr.sx, pr.sy, r * 2.2);
    og.addColorStop(0, `rgba(${oc[0]},${oc[1]},${oc[2]},.30)`);
    og.addColorStop(1, `rgba(${oc[0]},${oc[1]},${oc[2]},0)`);
    ctx.fillStyle = og;
    ctx.beginPath(); ctx.arc(pr.sx, pr.sy, r * 2.2, 0, Math.PI * 2); ctx.fill();
  }
  // lit sphere: gradient offset toward the star
  const lx = starP.sx - pr.sx, ly = starP.sy - pr.sy;
  const ld = Math.hypot(lx, ly) || 1;
  const ox = lx / ld * r * 0.45, oy = ly / ld * r * 0.45;
  const g = ctx.createRadialGradient(pr.sx + ox, pr.sy + oy, r * 0.15, pr.sx, pr.sy, r * 1.15);
  g.addColorStop(0, `rgb(${def.col[0]},${def.col[1]},${def.col[2]})`);
  g.addColorStop(0.75, `rgb(${def.col2[0]},${def.col2[1]},${def.col2[2]})`);
  g.addColorStop(1, "rgba(6,10,18,.9)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(pr.sx, pr.sy, r, 0, Math.PI * 2); ctx.fill();
  if (def.type === "main") { // the Homeworld gets a soft atmosphere
    ctx.strokeStyle = "rgba(140,210,255,.35)";
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath(); ctx.arc(pr.sx, pr.sy, r * 1.08, 0, Math.PI * 2); ctx.stroke();
  }
  if (def.ring) { // natural ring (Veloria)
    ctx.strokeStyle = "rgba(230,210,170,.4)";
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.beginPath(); ctx.ellipse(pr.sx, pr.sy, r * 1.7, r * 0.5, 0.35, 0, Math.PI * 2); ctx.stroke();
  }
  // Update §2+§4: a world under a dead sun sits in permanent, unstable dark —
  // weak bluish-gray light, muted colours, a nervous flicker. Pure atmosphere.
  const sysIdP = planetSysId(def);
  if (sysLightState(sysIdP) === "dead") {
    const t3 = warNowSafe();
    const flick = 0.82 + 0.06 * Math.sin(t3 * 7 + def.dist) + 0.04 * Math.sin(t3 * 23 + def.r);
    ctx.fillStyle = `rgba(16,24,40,${(0.55 * flick).toFixed(3)})`; // the long cold shadow
    ctx.beginPath(); ctx.arc(pr.sx, pr.sy, r + 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(150,180,215,${(0.10 * flick).toFixed(3)})`; // weak blue-gray rim light
    ctx.beginPath(); ctx.arc(pr.sx - r * 0.32, pr.sy - r * 0.32, r * 0.72, 0, Math.PI * 2); ctx.fill();
    // colony lights of a permanently dark world glimmer faintly through
    if (st.colony) {
      ctx.fillStyle = "rgba(255,235,160,.5)";
      for (let i = 0; i < 5; i++) {
        const a4 = i * 1.26 + def.dist;
        if (Math.sin(t3 * (1.4 + i * 0.3) + i) > -0.3) {
          ctx.fillRect(pr.sx + Math.cos(a4) * r * 0.5, pr.sy + Math.sin(a4) * r * 0.45, 1.2, 1.2);
        }
      }
    }
  }
  // Update §21.3: objects inside your own cloaked system carry a phase shimmer
  if (phantomActive(sysIdP) && !phantomHiddenFrom(sysIdP, G.playerId)) {
    const t4 = warNowSafe();
    ctx.strokeStyle = `rgba(170,185,235,${(0.18 + 0.1 * Math.sin(t4 * 3 + def.dist)).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(pr.sx, pr.sy, r * 1.16 + Math.sin(t4 * 5 + def.r) * 0.8, 0, Math.PI * 2); ctx.stroke();
  }
  // Halo Ring megastructure
  if (st.halo) {
    const hcol = G.countries[st.halo.owner] ? G.countries[st.halo.owner].flag.bg : [200, 200, 200];
    ctx.strokeStyle = st.halo.done ? `rgba(${hcol[0]},${hcol[1]},${hcol[2]},.95)` : `rgba(${hcol[0]},${hcol[1]},${hcol[2]},.45)`;
    ctx.lineWidth = Math.max(1.5, r * (st.halo.done ? 0.2 : 0.1));
    ctx.beginPath(); ctx.ellipse(pr.sx, pr.sy, r * 2.1, r * 0.62, -0.3, 0, Math.PI * 2 * (st.halo.done ? 1 : st.halo.prog / st.halo.need)); ctx.stroke();
  }
  // the burning Homeworld (Part 2): licking flames and an ember shroud
  if (def.type === "main" && st.scorched) {
    const t = warNowSafe();
    const fg = ctx.createRadialGradient(pr.sx, pr.sy, r * 0.2, pr.sx, pr.sy, r * 1.25);
    fg.addColorStop(0, "rgba(255,120,30,.55)");
    fg.addColorStop(0.8, "rgba(200,60,10,.35)");
    fg.addColorStop(1, "rgba(160,40,0,0)");
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(pr.sx, pr.sy, r * 1.25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,200,90,.85)";
    for (let i = 0; i < 10; i++) {
      const a = i * 0.63 + t * 0.4;
      const rr = r * (0.4 + 0.5 * ((i * 37) % 10) / 10);
      const flick = 0.5 + 0.5 * Math.sin(t * (2.5 + i * 0.6) + i);
      ctx.globalAlpha = 0.3 + flick * 0.55;
      ctx.beginPath(); ctx.arc(pr.sx + Math.cos(a) * rr, pr.sy + Math.sin(a) * rr * 0.85, Math.max(0.7, r * 0.07 * (0.6 + flick)), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // Final Alien Update Part 8: a world at war burns visibly from orbit — the
  // same fire language as Star Destroyer bombardment, scaled to the fighting
  const ws = st.warSmoke || 0;
  if (ws > 0.02) {
    const t2 = warNowSafe();
    ctx.fillStyle = `rgba(58,52,54,${(0.36 * ws).toFixed(3)})`; // war-smoke shroud
    ctx.beginPath(); ctx.arc(pr.sx, pr.sy, r * 1.06, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,170,70,.9)";
    const nF = Math.round(3 + ws * 7);
    for (let i = 0; i < nF; i++) {
      const a2 = i * 2.39 + def.dist;
      const rr2 = r * (0.25 + 0.55 * ((i * 53) % 10) / 10);
      const flick2 = 0.5 + 0.5 * Math.sin(t2 * (3 + i * 0.7) + i * 1.3);
      ctx.globalAlpha = ws * (0.25 + flick2 * 0.6);
      ctx.beginPath(); ctx.arc(pr.sx + Math.cos(a2) * rr2, pr.sy + Math.sin(a2) * rr2 * 0.9, Math.max(0.6, r * 0.055 * (0.5 + flick2)), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // plumes curling up toward space
    ctx.fillStyle = `rgba(120,115,112,${(0.3 * ws).toFixed(3)})`;
    for (let i = 0; i < 3; i++) {
      const a3 = i * 2.1 + 0.5;
      const drift = (t2 * 6 + i * 17) % 26;
      ctx.beginPath(); ctx.arc(pr.sx + Math.cos(a3) * r * 0.7, pr.sy + Math.sin(a3) * r * 0.7 - drift * 0.45, 1.6 + drift * 0.16, 0, Math.PI * 2); ctx.fill();
    }
  }
  // colony marker
  if (st.colony) {
    const col = G.countries[st.colony.owner].flag.bg;
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},.95)`;
    ctx.beginPath(); ctx.arc(pr.sx, pr.sy, r + 3.5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    ctx.beginPath(); ctx.arc(pr.sx + r * 0.8, pr.sy - r * 0.8, Math.max(2.5, r * 0.18), 0, Math.PI * 2); ctx.fill();
    // the owner's flag glyph beside the world (Part 13)
    if (showOwners) {
      ctx.font = `600 ${Math.max(8, Math.round(r * 0.55))}px "Segoe UI", sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      ctx.fillText(G.countries[st.colony.owner].flag.glyph, pr.sx + r * 0.8, pr.sy - r * 0.8 + Math.max(3, r * 0.2));
    }
  }
  // Giant Shield barrier (Part 4)
  if (st.shield && st.shield.hp > 0) drawShieldBubble(ctx, pr.sx, pr.sy, r * 1.55 + 3, st.shield);
  // Rehabilitator working on a scorched surface
  if (st.rehab && !st.destroyed) {
    ctx.strokeStyle = "rgba(120,240,170,.85)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(pr.sx, pr.sy, r + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * st.rehab.prog / st.rehab.need); ctx.stroke();
  }
  if (spaceSel && spaceSel.kind === "planet" && spaceSel.id === def.id) drawSelRing(ctx, pr.sx, pr.sy, r + 8);
  // label — Final Alien Update Part 3: alien capitals are CLEARLY marked
  const capOf = Object.keys(G.countries).find(k => G.countries[k].spaceCapital === def.id && G.countries[k].alive);
  const aCap = st.colony && (G.space.aliens || []).find(a2 => !a2.defeated && a2.capital === def.id && st.colony.owner === a2.aid);
  const inBattle = battleOn(def.id);
  ctx.font = "600 12px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = capOf ? "rgba(255,224,130,.95)" : aCap ? "rgba(255,150,190,.95)" : "rgba(230,240,255,.9)";
  ctx.fillText((capOf ? "★ " : aCap ? "👁★ " : "") + def.n + (def.type === "main" && st.scorched ? " — BURNING" : inBattle ? " — ⚔ BATTLE" : ""), pr.sx, pr.sy - r - 8);
  if (st.colony) {
    ctx.font = "10px 'Segoe UI', sans-serif";
    ctx.fillStyle = aCap ? "rgba(255,170,200,.9)" : "rgba(180,205,230,.85)";
    const ownName = G.countries[st.colony.owner].name;
    ctx.fillText(`${ownName}${capOf ? " · CAPITAL" : aCap ? " · ALIEN CAPITAL" : ""} · L${st.colony.lvl}${st.colony.garrison.length ? " · 👾" + st.colony.garrison.length : ""}${st.shield && st.shield.hp > 0 ? " · 🛡" : ""}`, pr.sx, pr.sy + r + 13);
  }
}
// BUG REPORT fix: ships in space now match the quality they show on the ground
// — proper hulls, plating, bridge towers, engine fire and running lights, and
// they FACE where they fly instead of spinning like tossed coins.
function shipHeading(s, W, H) {
  // world-space direction of travel
  let dx = 0, dz = 0;
  if (s.chase) { const t = shipById(s.chase); if (t) { dx = t.x - s.x; dz = t.z - s.z; } }
  else if (s.target) { const p = planetPos(s.target); dx = p.x - s.x; dz = p.z - s.z; }
  else if (s.free) { dx = s.free.x - s.x; dz = s.free.z - s.z; }
  else if (s.orbit) { const a = s.orbitAng || 0; dx = -Math.sin(a); dz = Math.cos(a); } // orbit tangent
  if (!dx && !dz) { dx = Math.cos(s.id); dz = Math.sin(s.id); } // parked: stable per-ship pose
  const d = Math.hypot(dx, dz) || 1;
  const p1 = spaceProject(s.x, s.y, s.z, W, H);
  const p2 = spaceProject(s.x + dx / d * 20, s.y, s.z + dz / d * 20, W, H);
  return Math.atan2(p2.sy - p1.sy, p2.sx - p1.sx);
}
function drawShip(ctx, it, W, H) {
  const { s, pr } = it;
  if (pr.sx < -160 || pr.sx > W + 160 || pr.sy < -160 || pr.sy > H + 160) return;
  const u = UNITS[s.unit];
  const col = G.countries[s.owner] ? G.countries[s.owner].flag.bg : [200, 200, 200];
  const mine = s.owner === G.playerId;
  const size = Math.max(3, (u.big ? 20 : u.cap ? 8 : 7) * pr.s);
  const t = warNowSafe();
  const moving = !!(s.target || s.free || s.chase);
  const lite = c => `rgb(${Math.min(255, c[0] + 70)},${Math.min(255, c[1] + 70)},${Math.min(255, c[2] + 70)})`;
  const base = c => `rgb(${c[0]},${c[1]},${c[2]})`;
  const dark = c => `rgb(${Math.max(0, c[0] - 60)},${Math.max(0, c[1] - 60)},${Math.max(0, c[2] - 60)})`;
  ctx.save();
  ctx.translate(pr.sx, pr.sy);
  ctx.rotate(shipHeading(s, W, H));
  if (size < 4.5) {
    // distant-model LOD: a clean dart, no detail work
    ctx.fillStyle = base(col);
    ctx.beginPath();
    ctx.moveTo(size * 1.2, 0); ctx.lineTo(-size, -size * 0.6); ctx.lineTo(-size * 0.6, 0); ctx.lineTo(-size, size * 0.6);
    ctx.closePath(); ctx.fill();
  } else if (u.big) {
    // ---- the Star Destroyer: a layered dreadnought wedge ----
    const eng = 0.75 + 0.25 * Math.sin(t * 7 + s.id);
    // triple engine wash
    for (let i = -1; i <= 1; i++) {
      const g = ctx.createRadialGradient(-size * 1.05, i * size * 0.22, 0, -size * 1.05, i * size * 0.22, size * (0.5 + eng * 0.25));
      g.addColorStop(0, "rgba(180,225,255,.95)");
      g.addColorStop(0.4, "rgba(90,160,255,.5)");
      g.addColorStop(1, "rgba(90,160,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(-size * 1.05, i * size * 0.22, size * (0.5 + eng * 0.25), 0, Math.PI * 2); ctx.fill();
    }
    // lower hull (shadow wedge)
    ctx.fillStyle = dark(col);
    ctx.beginPath();
    ctx.moveTo(size * 1.55, 0); ctx.lineTo(-size * 1.0, -size * 0.62); ctx.lineTo(-size * 0.78, 0); ctx.lineTo(-size * 1.0, size * 0.62);
    ctx.closePath(); ctx.fill();
    // upper plating (lit wedge, offset up for depth)
    ctx.fillStyle = lite(col);
    ctx.beginPath();
    ctx.moveTo(size * 1.45, -size * 0.04); ctx.lineTo(-size * 0.92, -size * 0.5); ctx.lineTo(-size * 0.72, -size * 0.04);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = base(col);
    ctx.beginPath();
    ctx.moveTo(size * 1.45, -size * 0.04); ctx.lineTo(-size * 0.72, -size * 0.04); ctx.lineTo(-size * 0.92, size * 0.5);
    ctx.closePath(); ctx.fill();
    // panel seams
    ctx.strokeStyle = "rgba(255,255,255,.28)";
    ctx.lineWidth = Math.max(0.6, size * 0.03);
    ctx.beginPath(); ctx.moveTo(size * 1.35, 0); ctx.lineTo(-size * 0.8, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(size * 0.6, -size * 0.18); ctx.lineTo(-size * 0.75, -size * 0.34); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(size * 0.6, size * 0.18); ctx.lineTo(-size * 0.75, size * 0.34); ctx.stroke();
    // bridge tower with twin command domes
    ctx.fillStyle = dark(col);
    ctx.fillRect(-size * 0.62, -size * 0.16, size * 0.34, size * 0.32);
    ctx.fillStyle = lite(col);
    ctx.fillRect(-size * 0.56, -size * 0.1, size * 0.22, size * 0.2);
    ctx.fillStyle = "rgba(190,235,255,.95)";
    ctx.beginPath(); ctx.arc(-size * 0.45, -size * 0.13, size * 0.045, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-size * 0.45, size * 0.13, size * 0.045, 0, Math.PI * 2); ctx.fill();
    // the core cannon aperture glows as it charges
    const ls = sdLaserStatus(s);
    ctx.fillStyle = ls.ready ? `rgba(255,150,235,${0.65 + 0.35 * Math.sin(t * 5)})` : "rgba(120,90,120,.7)";
    ctx.beginPath(); ctx.arc(size * 1.02, 0, size * 0.11, 0, Math.PI * 2); ctx.fill();
    // running lights down the spine
    for (let i = 0; i < 4; i++) {
      const on = Math.sin(t * 2.4 + i * 1.7 + s.id) > 0;
      if (!on) continue;
      ctx.fillStyle = "rgba(255,240,190,.9)";
      ctx.fillRect(size * (0.85 - i * 0.45), -size * 0.02, size * 0.045, size * 0.045);
    }
  } else if (u.cap) {
    // ---- cargo / transport spacecraft: a broad-shouldered hauler ----
    const eng = 0.7 + 0.3 * Math.sin(t * 6 + s.id);
    if (moving) {
      ctx.fillStyle = `rgba(140,200,255,${0.45 * eng})`;
      ctx.beginPath(); ctx.ellipse(-size * 1.05, 0, size * 0.5 * eng, size * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = dark(col);
    ctx.beginPath();
    ctx.moveTo(size * 1.1, 0); ctx.lineTo(size * 0.5, -size * 0.42); ctx.lineTo(-size * 0.9, -size * 0.42);
    ctx.lineTo(-size * 0.9, size * 0.42); ctx.lineTo(size * 0.5, size * 0.42);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = base(col);
    ctx.beginPath();
    ctx.moveTo(size * 1.1, 0); ctx.lineTo(size * 0.5, -size * 0.42); ctx.lineTo(-size * 0.9, -size * 0.42); ctx.lineTo(-size * 0.9, 0);
    ctx.closePath(); ctx.fill();
    // cargo containers along the spine
    const held = (s.cargo || []).length;
    for (let i = 0; i < Math.min(4, u.cap); i++) {
      ctx.fillStyle = i < held ? "rgba(255,220,140,.95)" : "rgba(255,255,255,.28)";
      ctx.fillRect(-size * 0.7 + i * size * 0.34, -size * 0.2, size * 0.26, size * 0.4);
    }
    // cockpit
    ctx.fillStyle = "rgba(190,235,255,.95)";
    ctx.beginPath(); ctx.arc(size * 0.78, 0, size * 0.12, 0, Math.PI * 2); ctx.fill();
  } else {
    // ---- warships (Star Fleet & rockets): a sleek winged cruiser ----
    const eng = 0.7 + 0.3 * Math.sin(t * 8 + s.id);
    if (moving) {
      ctx.fillStyle = `rgba(150,210,255,${0.5 * eng})`;
      ctx.beginPath(); ctx.ellipse(-size * 0.95, 0, size * 0.55 * eng, size * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    }
    // wings
    ctx.fillStyle = dark(col);
    ctx.beginPath();
    ctx.moveTo(size * 0.1, 0); ctx.lineTo(-size * 0.85, -size * 0.75); ctx.lineTo(-size * 0.55, -size * 0.08);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(size * 0.1, 0); ctx.lineTo(-size * 0.85, size * 0.75); ctx.lineTo(-size * 0.55, size * 0.08);
    ctx.closePath(); ctx.fill();
    // fuselage
    ctx.fillStyle = base(col);
    ctx.beginPath();
    ctx.moveTo(size * 1.15, 0); ctx.lineTo(size * 0.2, -size * 0.26); ctx.lineTo(-size * 0.75, -size * 0.18);
    ctx.lineTo(-size * 0.75, size * 0.18); ctx.lineTo(size * 0.2, size * 0.26);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.lineWidth = Math.max(0.5, size * 0.04);
    ctx.stroke();
    // canopy
    ctx.fillStyle = "rgba(190,235,255,.95)";
    ctx.beginPath(); ctx.ellipse(size * 0.45, 0, size * 0.2, size * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    // wingtip lights
    const on = Math.sin(t * 3 + s.id) > 0.2;
    if (on) {
      ctx.fillStyle = "rgba(255,120,120,.9)";
      ctx.fillRect(-size * 0.85, -size * 0.78, size * 0.07, size * 0.07);
      ctx.fillStyle = "rgba(140,255,170,.9)";
      ctx.fillRect(-size * 0.85, size * 0.71, size * 0.07, size * 0.07);
    }
  }
  ctx.restore();
  // hp bar + cargo + stack
  const hpw = Math.max(10, size * 2.4);
  ctx.fillStyle = "rgba(0,0,0,.6)";
  ctx.fillRect(pr.sx - hpw / 2, pr.sy - size - 8, hpw, 3);
  ctx.fillStyle = mine ? "#5ce0a2" : "#ff5468";
  ctx.fillRect(pr.sx - hpw / 2, pr.sy - size - 8, hpw * clamp(s.hp / s.maxHp, 0, 1), 3);
  if (size >= 4) {
    ctx.font = "10px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = mine ? "rgba(190,235,255,.95)" : "rgba(255,200,205,.9)";
    const tags = [];
    if ((s.stack || 1) > 1) tags.push("×" + s.stack);
    if (s.cargo && s.cargo.length) tags.push("👾" + s.cargo.length);
    ctx.fillText(u.n + (tags.length ? " " + tags.join(" ") : ""), pr.sx, pr.sy + size + 12);
  }
  if (spaceSel && spaceSel.kind === "ship" && spaceSel.id === s.id) drawSelRing(ctx, pr.sx, pr.sy, size + 6);
  else if (spaceSelFleet.length && spaceSelFleet.includes(s.id)) drawSelRing(ctx, pr.sx, pr.sy, size + 5); // §21: fleet members ring up too
}
function drawSpaceFx(ctx, it, W, H) {
  const f = it.f;
  const alpha = clamp(f.ttl / f.max, 0, 1);
  if (f.kind === "laser") {
    const p1 = spaceProject(f.x1, f.y1, f.z1, W, H);
    const p2 = spaceProject(f.x2, f.y2, f.z2, W, H);
    if (f.mega) { // the planet-killing beam: a blinding lance with a halo
      ctx.strokeStyle = `rgba(255,120,220,${alpha * 0.4})`;
      ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy); ctx.stroke();
      ctx.strokeStyle = `rgba(255,235,255,${alpha})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy); ctx.stroke();
    } else {
      ctx.strokeStyle = f.big ? `rgba(255,120,220,${alpha})` : `rgba(130,255,255,${alpha})`;
      ctx.lineWidth = f.big ? 3 : 1.6;
      ctx.beginPath(); ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy); ctx.stroke();
    }
  } else if (f.kind === "boom") {
    const p = spaceProject(f.x, f.y, f.z, W, H);
    const R = (f.r || 14) * p.s * (1.4 - alpha * 0.4);
    const shieldHit = f.sub === "shield";
    ctx.strokeStyle = shieldHit ? `rgba(120,220,255,${alpha})` : `rgba(255,170,80,${alpha})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, Math.max(2, R * (1.2 - alpha)), 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = shieldHit ? `rgba(170,235,255,${alpha * 0.5})` : `rgba(255,220,150,${alpha * 0.5})`;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, Math.max(1.5, R * 0.4), 0, Math.PI * 2); ctx.fill();
  } else if (f.kind === "ripple") {
    // Update §21.2: entering cloaked space — a distortion ripple, stars bending
    const prog = 1 - alpha;
    ctx.strokeStyle = `rgba(170,190,240,${(alpha * 0.5).toFixed(3)})`;
    for (let i = 0; i < 3; i++) {
      ctx.lineWidth = 2 - i * 0.5;
      const R = (H * 0.12) + prog * H * (0.5 + i * 0.22);
      ctx.beginPath(); ctx.arc(W / 2, H / 2, R, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = `rgba(140,160,220,${(alpha * 0.08).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  } else if (f.kind === "streak") {
    // Update §21.4: leaving — the view smears into streaked light
    const prog = 1 - alpha;
    ctx.strokeStyle = `rgba(210,225,255,${(alpha * 0.45).toFixed(3)})`;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 14; i++) {
      const a = i * 0.449 + 0.2;
      const r1 = H * 0.08 + prog * H * 0.5, r2 = r1 + 30 + prog * 90;
      ctx.beginPath();
      ctx.moveTo(W / 2 + Math.cos(a) * r1, H / 2 + Math.sin(a) * r1);
      ctx.lineTo(W / 2 + Math.cos(a) * r2, H / 2 + Math.sin(a) * r2);
      ctx.stroke();
    }
  } else if (f.kind === "shatter") {
    const p = spaceProject(f.x, f.y, f.z, W, H);
    const prog = 1 - alpha;
    if (prog < 0.2) { // blinding flash
      ctx.fillStyle = `rgba(255,255,235,${(1 - prog / 0.2) * 0.9})`;
      ctx.beginPath(); ctx.arc(p.sx, p.sy, f.r * p.s * 3.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = `rgba(255,180,120,${alpha})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, f.r * p.s * (0.5 + prog * 4), 0, Math.PI * 2); ctx.stroke();
    for (const ch of f.chunks) {
      const cp = spaceProject(ch.x, ch.y, ch.z, W, H);
      ctx.fillStyle = `rgba(${f.col[0]},${f.col[1]},${f.col[2]},${alpha})`;
      ctx.beginPath(); ctx.arc(cp.sx, cp.sy, Math.max(1, ch.r * cp.s), 0, Math.PI * 2); ctx.fill();
    }
  }
}
function drawSelRing(ctx, x, y, r) {
  ctx.strokeStyle = "rgba(255,255,255,.9)";
  ctx.lineWidth = 1.6;
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
}

// ---------------- input ----------------
function initSpaceInput() {
  const vp = document.getElementById("space-vp");
  if (!vp || vp._wired) return;
  vp._wired = true;
  vp.addEventListener("contextmenu", e => e.preventDefault()); // right button pans (SU2 §5)
  vp.addEventListener("mousedown", e => {
    if (e.target.closest && e.target.closest("#space-panel")) return;
    const pan = e.button === 2 || e.button === 1 || e.shiftKey;
    // AI Update §21: Ctrl + left-drag opens a fleet selection box
    const box = !pan && e.button === 0 && e.ctrlKey;
    spaceDrag = { sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, yaw: spaceCam.yaw, pitch: spaceCam.pitch, moved: false, pan, box };
    if (pan || box) e.preventDefault();
  });
  window.addEventListener("mousemove", e => {
    if (!spaceDrag) return;
    const dx = e.clientX - spaceDrag.sx, dy = e.clientY - spaceDrag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) spaceDrag.moved = true;
    if (spaceDrag.box) { spaceDrag.cx = e.clientX; spaceDrag.cy = e.clientY; return; }
    if (spaceDrag.pan) {
      // drag the world: the point under the cursor stays under the cursor
      const rect = vp.getBoundingClientRect();
      const W = vp.clientWidth, H = vp.clientHeight;
      const p1 = spaceUnproject(spaceDrag.lx - rect.left, spaceDrag.ly - rect.top, W, H);
      const p2 = spaceUnproject(e.clientX - rect.left, e.clientY - rect.top, W, H);
      spaceStopFollow(true);
      spaceCam.x -= p2.x - p1.x;
      spaceCam.z -= p2.z - p1.z;
      spaceDrag.lx = e.clientX; spaceDrag.ly = e.clientY;
    } else {
      spaceCam.yaw = spaceDrag.yaw + dx * 0.006;
      spaceCam.pitch = clamp(spaceDrag.pitch + dy * 0.005, -1.2, 1.2);
    }
  });
  window.addEventListener("mouseup", e => {
    if (!spaceDrag) return;
    const moved = spaceDrag.moved, wasPan = spaceDrag.pan, wasBox = spaceDrag.box;
    const bx0 = spaceDrag.sx, by0 = spaceDrag.sy;
    spaceDrag = null;
    if (wasBox && moved && spaceOpen) { spaceBoxSelect(bx0, by0, e.clientX, e.clientY); return; }
    // a motionless Shift-click still counts as a click (fleet add — §21)
    if (!moved && (!wasPan || (e.button === 0 && e.shiftKey)) && spaceOpen &&
        !(e.target.closest && e.target.closest("#space-panel"))) spaceClick(e);
  });
  vp.addEventListener("wheel", e => {
    e.preventDefault();
    // zooming far out shows the whole galaxy and its solar systems (SU2 §5-6)
    spaceCam.zoom = clamp(spaceCam.zoom * (e.deltaY < 0 ? 1.12 : 0.89), 0.02, 3.2);
  }, { passive: false });
  // ---- touch camera (Diagnostic Update §8) ----
  // One finger orbits, two fingers pinch-zoom and pan. Listeners stay passive
  // (touch-action:none already suppresses browser gestures) so taps keep
  // producing the compatibility click that the mouse handlers above turn into
  // spaceClick — the same recipe as the planet map in ui.js.
  let stouch = null;
  const touchMid = e => ({ x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                           y: (e.touches[0].clientY + e.touches[1].clientY) / 2 });
  const touchDist = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                                    e.touches[0].clientY - e.touches[1].clientY);
  vp.addEventListener("touchstart", e => {
    if (e.target.closest && e.target.closest("#space-panel")) return;
    if (e.touches.length === 1) {
      const t = e.touches[0];
      stouch = { mode: "orbit", sx: t.clientX, sy: t.clientY, yaw: spaceCam.yaw, pitch: spaceCam.pitch };
    } else if (e.touches.length >= 2) {
      const m = touchMid(e);
      stouch = { mode: "pinch", d0: touchDist(e), z0: spaceCam.zoom, mx: m.x, my: m.y };
    }
  }, { passive: true });
  vp.addEventListener("touchmove", e => {
    if (!stouch) return;
    if (stouch.mode === "orbit" && e.touches.length === 1) {
      const t = e.touches[0];
      spaceCam.yaw = stouch.yaw + (t.clientX - stouch.sx) * 0.006;
      spaceCam.pitch = clamp(stouch.pitch + (t.clientY - stouch.sy) * 0.005, -1.2, 1.2);
    } else if (stouch.mode === "pinch" && e.touches.length >= 2) {
      if (stouch.d0 > 0) spaceCam.zoom = clamp(stouch.z0 * (touchDist(e) / stouch.d0), 0.02, 3.2);
      // two-finger drag pans like the mouse pan: the midpoint stays put
      const m = touchMid(e);
      const rect = vp.getBoundingClientRect(), W = vp.clientWidth, H = vp.clientHeight;
      const p1 = spaceUnproject(stouch.mx - rect.left, stouch.my - rect.top, W, H);
      const p2 = spaceUnproject(m.x - rect.left, m.y - rect.top, W, H);
      spaceStopFollow(true);
      spaceCam.x -= p2.x - p1.x;
      spaceCam.z -= p2.z - p1.z;
      stouch.mx = m.x; stouch.my = m.y;
    }
  }, { passive: true });
  vp.addEventListener("touchend", e => {
    if (e.touches.length === 0) stouch = null;
    else if (e.touches.length === 1) {
      // pinch ended with one finger still down — continue as an orbit
      const t = e.touches[0];
      stouch = { mode: "orbit", sx: t.clientX, sy: t.clientY, yaw: spaceCam.yaw, pitch: spaceCam.pitch };
    }
  }, { passive: true });
  const keyOf = e => ({
    w: "up", W: "up", ArrowUp: "up",
    s: "down", S: "down", ArrowDown: "down",
    a: "left", A: "left", ArrowLeft: "left",
    d: "right", D: "right", ArrowRight: "right",
  })[e.key];
  window.addEventListener("keydown", e => {
    if (!spaceOpen || typeof screen !== "string" || screen !== "game") return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const pk = keyOf(e);
    if (pk) { spaceKeys[pk] = true; e.preventDefault(); }
    if (e.key === "f" || e.key === "F") { if (spaceSel) spaceFocusSel(); }
    if (e.key === "Escape") {
      if (spacePlacing) { spacePlacing = null; spacePanelDirty = true; toast("Placement cancelled."); }
      else if (spaceSelFleet.length) { spaceSelFleet = []; spacePanelDirty = true; toast("Fleet selection cleared."); }
      else if (spaceCam.follow) spaceStopFollow();
      else if (spaceSel) { spaceSel = null; spacePanelDirty = true; }
      else exitSpace();
    }
    if (e.key === "e" || e.key === "E") spaceEKey();
  });
  window.addEventListener("keyup", e => {
    const pk = keyOf(e);
    if (pk) spaceKeys[pk] = false;
  });
  window.addEventListener("blur", () => { spaceKeys = {}; });
}
// invert the projection for a click in empty space (Part 6): the point is
// resolved on the camera plane through the origin, then flattened toward the
// ecliptic so fleets stay near the traffic lanes
function spaceUnproject(mx, my, W, H) {
  const s0 = 950 / Math.max(140, 950 + 700) * spaceCam.zoom;
  const x1 = (mx - W / 2) / s0;
  const y2 = (my - H / 2) / s0;
  const cp = Math.cos(spaceCam.pitch), sp = Math.sin(spaceCam.pitch);
  const y = y2 * cp;
  const z1 = -y2 * sp;
  const cy = Math.cos(spaceCam.yaw), sy = Math.sin(spaceCam.yaw);
  // offset by the free-camera centre so clicks land where the player looks (SU2 §5)
  return { x: spaceCam.x + x1 * cy - z1 * sy, y: clamp(y * 0.3, -60, 60), z: spaceCam.z + x1 * sy + z1 * cy };
}
// ============ AI Update §21 — fleet multi-select ============
// Ctrl-drag sweeps a screen box over your own ships; Shift-click adds or
// removes one; every selected ship then answers movement clicks as one fleet.
function spaceBoxSelect(x0, y0, x1, y1) {
  const vp = document.getElementById("space-vp");
  if (!vp) return;
  const rect = vp.getBoundingClientRect();
  const W = vp.clientWidth, H = vp.clientHeight;
  const ax = Math.min(x0, x1) - rect.left, bx = Math.max(x0, x1) - rect.left;
  const ay = Math.min(y0, y1) - rect.top, by = Math.max(y0, y1) - rect.top;
  spaceSelFleet = [];
  for (const s of G.space.ships) {
    if (s.owner !== G.playerId) continue;
    const p = spaceProject(s.x, s.y, s.z, W, H);
    if (p.sx >= ax && p.sx <= bx && p.sy >= ay && p.sy <= by) spaceSelFleet.push(s.id);
  }
  if (spaceSelFleet.length) {
    spaceSel = { kind: "ship", id: spaceSelFleet[0] };
    toast(`⛿ ${spaceSelFleet.length} ship${spaceSelFleet.length > 1 ? "s" : ""} selected — click a destination to move the fleet (Esc clears).`);
    sfx("click");
  }
  spacePanelDirty = true;
}
// the ships a movement order applies to: the whole fleet when the clicked-on
// selection belongs to it, otherwise just the one selected ship
function spaceOrderGroup(sel) {
  return spaceSelFleet.length > 1 && spaceSelFleet.includes(sel.id)
    ? spaceSelFleet.map(shipById).filter(s2 => s2 && s2.owner === G.playerId)
    : [sel];
}
// may this nation's ships travel to that position? (Warp Drive gate, Part 5)
function canTravelTo(cid, x, z) {
  const sys = systemAt(x, z);
  if (sys.id === "home") return { ok: true };
  const c = G.countries[cid];
  if (!c.researched.warp && !(cid === G.playerId && sandboxOn("research"))) {
    return { ok: false, why: `Reaching the ${systemRevealed(sys.id) ? sys.n : "far"} system requires the 🌀 Warp Drive technology.` };
  }
  return { ok: true };
}
function spaceClick(e) {
  const vp = document.getElementById("space-vp");
  const rect = vp.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const W = vp.clientWidth, H = vp.clientHeight;
  // pick the nearest object under the cursor: ships, researchers, planets, stars
  let best = null, bd = 26 * 26;
  for (const s of G.space.ships) {
    if (!shipVisibleToPlayer(s)) continue; // can't click what the view settings hide
    const p = spaceProject(s.x, s.y, s.z, W, H);
    const d = (p.sx - mx) ** 2 + (p.sy - my) ** 2;
    if (d < bd) { bd = d; best = { kind: "ship", id: s.id }; }
  }
  if (!best) {
    bd = 30 * 30;
    for (const r of G.space.researchers || []) {
      const p = spaceProject(r.x, r.y, r.z, W, H);
      const d = (p.sx - mx) ** 2 + (p.sy - my) ** 2;
      if (d < bd) { bd = d; best = { kind: "researcher", id: r.id }; }
    }
  }
  if (!best) {
    bd = 34 * 34;
    for (const def of SPACE_PLANETS) {
      if (!systemRevealed(planetSysId(def))) continue;
      const pos = planetPos(def.id);
      const p = spaceProject(pos.x, pos.y, pos.z, W, H);
      const rr = Math.max(16, def.r * p.s + 10);
      const d = (p.sx - mx) ** 2 + (p.sy - my) ** 2;
      if (d < Math.max(bd, rr * rr)) { bd = d; best = { kind: "planet", id: def.id }; }
    }
  }
  if (!best) {
    // Update §5: the galactic core is selectable like any celestial body
    const bh = galaxyBH();
    if (bh) {
      const p = spaceProject(bh.x, 0, bh.z, W, H);
      if ((p.sx - mx) ** 2 + (p.sy - my) ** 2 < Math.max(24 * 24, (bh.r * p.s * 1.6) ** 2)) best = { kind: "bh" };
    }
  }
  if (!best) {
    for (const sys of SPACE_SYSTEMS) {
      const p = spaceProject(sys.x, 0, sys.z, W, H);
      if ((p.sx - mx) ** 2 + (p.sy - my) ** 2 < Math.max(20 * 20, (sys.r * p.s * 1.4) ** 2)) { best = { kind: "star", sys: sys.id }; break; }
    }
  }
  // §21: Shift-click toggles an own ship in/out of the fleet selection
  if (best && best.kind === "ship" && e.shiftKey) {
    const t = shipById(best.id);
    if (t && t.owner === G.playerId) {
      const i = spaceSelFleet.indexOf(t.id);
      if (i >= 0) spaceSelFleet.splice(i, 1);
      else {
        // seed the fleet with the previously selected own ship
        if (!spaceSelFleet.length && spaceSel && spaceSel.kind === "ship") {
          const cur = shipById(spaceSel.id);
          if (cur && cur.owner === G.playerId && cur.id !== t.id) spaceSelFleet.push(cur.id);
        }
        spaceSelFleet.push(t.id);
      }
      spaceSel = { kind: "ship", id: t.id };
      spacePanelDirty = true;
      sfx("click");
      return;
    }
  }
  // placing a Researcher megastructure (Part 9)
  if (!best && spacePlacing === "researcher") {
    const pt = spaceUnproject(mx, my, W, H);
    spacePlacing = null;
    if (typeof netIntercept === "function" && netIntercept("researcherBuild", { x: pt.x, y: pt.y, z: pt.z })) { sfx("build"); return; }
    if (buildResearcher(G.playerId, pt.x, pt.y, pt.z)) { sfx("build"); renderTopbar(); }
    spacePanelDirty = true;
    return;
  }
  // an own ship (or fleet — §21) is selected and the player clicks a destination
  if (spaceSel && spaceSel.kind === "ship") {
    const sel = shipById(spaceSel.id);
    if (sel && sel.owner === G.playerId) {
      const grp = spaceOrderGroup(sel);
      const many = grp.length > 1;
      if (best && best.kind === "planet") {
        const pos = planetPos(best.id);
        const trav = canTravelTo(G.playerId, pos.x, pos.z);
        if (!trav.ok) { toast(trav.why); return; }
        for (const sh of grp) {
          if (typeof netIntercept === "function" && netIntercept("shipMove", { id: sh.id, planet: best.id })) continue;
          sh.target = best.id; sh.orbit = null; sh.chase = null; sh.free = null;
        }
        toast(`${many ? `⛿ fleet of ${grp.length} ` : ""}→ ${planetDef(best.id).n}`);
        sfx("move");
        spacePanelDirty = true;
        return;
      }
      if (best && best.kind === "bh") {
        // fly to the black hole — a Star Destroyer must hold here to connect
        const bh = galaxyBH();
        const trav = canTravelTo(G.playerId, bh.x, bh.z);
        if (!trav.ok) { toast(trav.why); return; }
        grp.forEach((sh, i) => {
          const pt = { x: bh.x + rnd(-120, 120), y: rnd(-14, 14), z: bh.z + rnd(-120, 120) };
          if (typeof netIntercept === "function" && netIntercept("shipFree", { id: sh.id, x: pt.x, y: pt.y, z: pt.z })) return;
          sh.free = pt; sh.target = null; sh.orbit = null; sh.chase = null;
        });
        toast(`${many ? `⛿ fleet of ${grp.length} ` : ""}→ the black hole`);
        sfx("move");
        spacePanelDirty = true;
        return;
      }
      if (best && best.kind === "ship" && best.id !== sel.id) {
        const t = shipById(best.id);
        if (t && t.owner !== G.playerId && atWar(G.playerId, t.owner)) {
          for (const sh of grp) {
            if (typeof netIntercept === "function" && netIntercept("shipChase", { id: sh.id, target: t.id })) continue;
            sh.chase = t.id; sh.target = null; sh.orbit = null; sh.free = null;
          }
          toast(`⚔ ${many ? `Fleet of ${grp.length} pursuing` : "Pursuing"} the enemy ${UNITS[t.unit].n}.`);
          sfx("move");
          return;
        }
      }
      if (!best) {
        // free 3D movement (Part 6): click any open point in space.
        // §21: a fleet spreads into a loose ring formation around the point.
        const pt = spaceUnproject(mx, my, W, H);
        const trav = canTravelTo(G.playerId, pt.x, pt.z);
        if (!trav.ok) { toast(trav.why); return; }
        grp.forEach((sh, i) => {
          const ang = (i / Math.max(1, grp.length)) * Math.PI * 2;
          const r = many ? 26 + 10 * Math.floor(i / 8) : 0;
          const p2 = { x: pt.x + Math.cos(ang) * r, y: pt.y, z: pt.z + Math.sin(ang) * r };
          if (typeof netIntercept === "function" && netIntercept("shipFree", { id: sh.id, x: p2.x, y: p2.y, z: p2.z })) return;
          sh.free = p2; sh.target = null; sh.orbit = null; sh.chase = null;
        });
        toast(many ? `⛿ fleet of ${grp.length} → open space (formation)` : "→ moving through open space");
        sfx("move");
        spacePanelDirty = true;
        return;
      }
    }
  }
  spaceSel = best;
  // clicking something outside the fleet dissolves the multi-selection (§21)
  if (!(best && best.kind === "ship" && spaceSelFleet.includes(best.id))) spaceSelFleet = [];
  spacePanelDirty = true;
  if (best) sfx("click");
  if (best && e.detail >= 2) spaceFocusSel(); // double-click = focus the camera (SU2 §5)
}
// E near a planet: land on the Homeworld, or deploy/load troops at a colony.
// §21: with a fleet selected, every member acts (invasions stay one-at-a-time).
function spaceEKey() {
  if (!spaceSel || spaceSel.kind !== "ship") return;
  const s0 = shipById(spaceSel.id);
  if (!s0 || s0.owner !== G.playerId) return;
  const grp = spaceOrderGroup(s0);
  for (const s of grp) {
    const near = shipNearestPlanet(s); // the CLOSEST world, never array order (SU2 §10/§12)
    if (!near) { if (s === s0) toast("Fly next to a planet first."); continue; }
    if (typeof netIntercept === "function" && netIntercept("spaceE", { id: s.id })) continue;
    if (near.type === "main") { landShip(s); spacePanelDirty = true; continue; }
    const st = planetState(near.id);
    if (st.colony && st.colony.owner === G.playerId) {
      if (s.cargo && s.cargo.length) deployCargoToColony(s, near.id);
      else loadGarrison(s, near.id);
    } else if (st.colony && atWar(G.playerId, st.colony.owner)) {
      if (s === s0) resolveInvasion(s, near.id); // a landing is a deliberate, single order
    } else if (s === s0) toast("Nothing to do here — colonize the planet first (see the panel).");
  }
}

// ---------------- the side panel ----------------
function spaceRefreshPanel() { spacePanelDirty = true; }
function renderSpacePanel() {
  const el = document.getElementById("space-panel");
  if (!el || !G) return;
  const P = G.countries[G.playerId];
  const myShips = shipsOfNation(G.playerId);
  const myCols = coloniesOfNation(G.playerId);
  let html = `<div class="sp-head"><h3>🌌 Space Command</h3>
    <button class="btn small" id="sp-exit" title="Return to the planetary map.">🌍 Return to Map</button></div>
    <div class="dim small">Fleet: ${myShips.length} craft · Colonies: ${myCols.length}${P.researched.warp ? " · 🌀 warp-capable" : ""}</div>`;
  if (spacePlacing === "researcher") {
    html += `<div class="warbox small">🌆 <b>Placing Researcher</b> — click a spot inside your homeland system or a system holding one of your colonies, near the star or an owned world. Alien-controlled systems are off limits. Esc cancels.</div>`;
  }
  // free camera controls (SU2 Part 5): focus follows the selection, never locks
  if (spaceSel) {
    html += spaceCam.follow
      ? `<button class="btn small" id="sp-focus" title="Return to the free camera (Esc does the same).">🎥 Stop following</button>`
      : `<button class="btn small" id="sp-focus" title="Centre the camera on the selection and follow it. Pan, WASD or Esc breaks away — the camera never locks permanently.">🎥 Focus camera (F)</button>`;
  }
  // fleet list (§21: chips highlight fleet membership; Shift-click a chip adds)
  if (myShips.length) {
    html += `<div class="sp-list">` + myShips.map(s => {
      const u = UNITS[s.unit];
      const where = s.orbit === "home" ? "in Homeland Orbit" : s.orbit ? `orbiting ${planetDef(s.orbit) ? planetDef(s.orbit).n : "?"}` : s.target ? `→ ${planetDef(s.target) ? planetDef(s.target).n : "?"}` : s.free ? "→ open space" : s.chase ? "in pursuit" : s.dysonTarget ? "engaging Dyson Sphere" : s.vsTarget ? "besieging Void Shield" : "adrift";
      const inFleet = spaceSelFleet.includes(s.id);
      return `<button class="chip ${spaceSel && spaceSel.kind === "ship" && spaceSel.id === s.id ? "active" : ""}" data-shipsel="${s.id}"
        title="${esc(u.n)} — ${esc(where)}. HP ${fmt(s.hp)}/${fmt(s.maxHp)}${s.cargo && s.cargo.length ? ` · carrying ${s.cargo.length} unit(s)` : ""}${inFleet ? " · in fleet selection" : ""}. Shift-click: add to / remove from the fleet.">${inFleet ? "⛿ " : ""}${u.icon} ${esc(u.n)}${s.cargo && s.cargo.length ? ` 👾${s.cargo.length}` : ""}</button>`;
    }).join("") + `</div>`;
    // §21: fleet command strip — grouping, formation moves, fleet-wide stop
    if (myShips.length > 1) {
      html += `<div class="diplo-actions">
        <button class="btn small" id="sp-fleet-all" title="Select every one of your ships as one fleet. Movement clicks, E and Stop then apply to all of them.">⛿ Select all (${myShips.length})</button>
        ${spaceSelFleet.length ? `<button class="btn small" id="sp-fleet-stop" title="The whole fleet holds position — every order is cancelled.">🛑 Stop fleet</button>
        <button class="btn small" id="sp-fleet-clear" title="Dissolve the fleet selection (ships keep their current orders).">✕ Clear (${spaceSelFleet.length})</button>` : ""}
      </div>
      ${spaceSelFleet.length > 1 ? `<div class="hint small">⛿ Fleet of ${spaceSelFleet.length}: click a planet, ship or open space to move as one. Ctrl-drag re-selects, Shift-click edits, Esc clears.</div>` : ""}`;
    }
  } else {
    html += `<div class="hint small">No craft in orbit. Build 🚀/🛸 spacecraft in a Space Program city (Military tab), select them on the map and press <b>🌌 Go to Space</b>.</div>`;
  }
  // global megastructure actions
  const rd = MEGA_DEFS.researcher;
  if (P.researched[rd.tech]) {
    html += `<button class="btn small" id="sp-buildres" title="${esc(rd.d)} Cost: ${rd.cost.money}💰 ${rd.cost.mat}⛏. After pressing, click a spot in a solar system you control — the homeland or one with your colony, near the star or an owned world. Alien-controlled systems are off limits.">🌆 Build Researcher <i>${rd.cost.money}💰 ${rd.cost.mat}⛏</i></button>`;
  }
  // known alien civilizations (Parts 7-8, 11)
  const knownAliens = (G.space.aliens || []).filter(a => {
    const c = G.countries[a.aid];
    return c && c.alive && a.contacted.includes(G.playerId);
  });
  if (knownAliens.length) {
    html += `<h4>👁 Known Civilizations</h4><div class="sp-list">` + knownAliens.map(a => {
      const c = G.countries[a.aid];
      const war = atWar(G.playerId, a.aid);
      return `<button class="chip ${spaceSel && spaceSel.kind === "alien" && spaceSel.id === a.aid ? "active" : ""} ${war || a.defeated ? "off" : ""}" data-aliensel="${a.aid}"
        title="${esc(ALIEN_TIERS[a.tier].n)} · ${esc(a.per)} · relations ${Math.round(G.rel[a.aid][G.playerId] || 0)}${war ? " · AT WAR" : ""}${a.defeated ? " · FALLEN — only remnants remain" : ""}">👁 ${esc(c.name)}${a.defeated ? " ☠" : war ? " ⚔" : ""}</button>`;
    }).join("") + `</div>`;
  }
  // selection details
  if (spaceSel && spaceSel.kind === "alien") {
    const rec = alienById(spaceSel.id);
    const A = rec && G.countries[rec.aid];
    if (rec && A && A.alive) {
      const rel = Math.round(G.rel[rec.aid][G.playerId] || 0);
      const war = atWar(G.playerId, rec.aid);
      // Final Alien Update Part 3: once their system is charted, the capital is public knowledge
      const capD = alienCapitalPlanet(rec) ? planetDef(rec.capital) : null;
      html += `<h4>👁 ${esc(A.name)}${rec.defeated ? ' — <span class="bad">FALLEN</span>' : ""}</h4>
        <div class="kv"><span>Species</span>${esc(A.species || "Unknown")}</div>
        <div class="kv"><span>Development</span>${esc(ALIEN_TIERS[rec.tier].n)}</div>
        <div class="kv"><span>Disposition</span>${esc(rec.per)}</div>
        <div class="kv"><span>Home system</span>${systemRevealed(rec.sys) ? esc(systemDef(rec.sys).n) : "unknown — locate them with a 🌆 Researcher"}</div>
        ${rec.defeated ? `<div class="bad small">☠ Their capital has fallen — the civilization is defeated. Scattered remnant fleets fight on without reinforcement.</div>`
          : `<div class="kv"><span>👁★ Capital</span>${systemRevealed(rec.sys) && capD ? esc(capD.n) + " — conquer or destroy it to defeat them" : "unrevealed"}</div>`}
        <div class="kv"><span>Relations</span><b class="${rel > 15 ? "good" : rel < -15 ? "bad" : ""}">${rel > 0 ? "+" : ""}${rel}</b>${war ? ' · <b class="bad">AT WAR</b>' : ""}</div>
        <div class="diplo-actions">
          <button class="btn small" data-alien-act="hail" title="Open a channel. Small relations gain; their answer depends on who they are.">📡 Communicate</button>
          <button class="btn small" data-alien-act="trade" title="Exchange 2000💰 for exotic materials and energy. Needs peace and non-hostile relations.">⚖ Trade <i>2000💰</i></button>
          <button class="btn small" data-alien-act="ally" title="Propose an alliance across the stars (relations 50+).">🤝 Alliance</button>
          <button class="btn small" data-alien-act="threat" title="Threaten them. Aggressive civilizations may answer with war.">☠ Threaten</button>
          ${war ? `<button class="btn small" data-alien-act="peace" title="Sue for peace. Warlike aliens demand tribute.">🕊 Sue for peace</button>`
                : `<button class="btn small danger" data-alien-act="war" title="Declare war on this civilization.">⚔ Declare war</button>`}
          ${G.sandbox ? `<button class="btn small" id="sbx-inspect-alien" title="Sandbox §12: open the full inspection panel — military, economy, technology and colonies.">🔍 Inspect</button>` : ""}
        </div>
        <div id="sp-alien-reply" class="small dim"></div>`;
    }
  } else if (spaceSel && spaceSel.kind === "researcher") {
    const r = researcherById(spaceSel.id);
    if (r) {
      const own = r.owner === G.playerId;
      const C = G.countries[r.owner];
      html += `<h4>${r.deep ? "🔭 Deep Space Research Station" : "🌆 Researcher"}${r.destroyed ? " — DESTROYED" : ""}</h4>
        <div class="kv"><span>Owner</span>${esc(C ? C.name : "?")}${own ? " (you)" : ""}</div>
        <div class="kv"><span>Level</span>${r.lvl}/${MEGA_DEFS.researcher.maxLvl} — +${RESEARCHER_RP(r.lvl)}🔬 per tick</div>
        <div class="kv"><span>Hull</span>${fmt(r.hp)}/${fmt(r.maxHp)}</div>
        ${r.shield ? `<div class="kv"><span>Giant Shield</span>${r.shield.hp > 0 ? fmtShield(r.shield) + " charge" : '<span class="bad">collapsed</span>'}</div>` : ""}`;
      if (own && !r.destroyed) {
        if (r.lvl < MEGA_DEFS.researcher.maxLvl) {
          const uc = RESEARCHER_UP(r.lvl);
          html += `<button class="btn small" id="sp-res-up" title="Each expansion produces more research and toughens the city.">⬆ Expand to L${r.lvl + 1} <i>${uc.money}💰 ${uc.mat}⛏</i></button>`;
        }
        const ready = r.cd <= 0;
        html += `<button class="btn small ${ready ? "primary" : "off"}" id="sp-res-locate"
          title="Sweep the deep void for alien signals: ${LOCATE_LIFE.money}💰 ${LOCATE_LIFE.energy}⚡, ${Math.round(LOCATE_LIFE.chance * 100)}% success, ${LOCATE_LIFE.cd}-tick cooldown. A failed scan still spends the cooldown. ⚠ BLIND to Phantom Step — cloaked civilizations return 'no life detected'.">📡 Locate Interstellar Life ${ready ? "" : `<i>ready in ${r.cd}</i>`}</button>`;
        // Update §18.3: the Deep Space Research upgrade path
        if (!r.deep && r.lvl >= PHANTOM.deepLvl) {
          html += `<button class="btn small" id="sp-res-deep"
            title="Complete the Deep Space Research upgrade path. Only a Deep Space Research Station can detect and disrupt Phantom Step — and only its owner may activate Phantom Step at all.">🔭 Upgrade: Deep Space Research Station <i>${PHANTOM.deepCost.money}💰 ${PHANTOM.deepCost.mat}⛏</i></button>`;
        } else if (!r.deep) {
          html += `<div class="dim small">🔭 Expand the city to level ${PHANTOM.deepLvl} to unlock the Deep Space Research Station upgrade (the gate to 🌫 Phantom Step).</div>`;
        }
        if (r.deep) {
          html += `<button class="btn small ${ready ? "primary" : "off"}" id="sp-res-scan"
            title="Sweep the galaxy for Phantom Step signatures: ${PHANTOM.scanCost.money}💰 ${PHANTOM.scanCost.energy}⚡, a ${Math.round(PHANTOM.scanChance * 100)}% chance per hidden system to DISRUPT its field and snap it back onto the map. ${PHANTOM.scanCd}-tick cooldown.">🔭 Deep Scan: disrupt Phantom Step ${ready ? "" : `<i>ready in ${r.cd}</i>`}</button>`;
        }
        // ---- BUG REPORT (Critical Bug-Fix Update §4): the Phantom Step ----
        // console lives ON the station, and everything it shows comes from the
        // phantomStatus() controller — requirement checklist, cycle state and
        // the Activate Phantom Step button in one place.
        {
          const phSt = phantomStatus(G.playerId);
          const req = (ok, label) => `<div class="kv"><span>${ok ? "✅" : "❌"}</span>${label}${ok ? "" : ' <span class="warn">— missing</span>'}</div>`;
          html += `<div class="kv"><span>🌫 Phantom Step</span>${phSt.ready ? '<b class="good">READY</b>' : phSt.activeSys ? '<b class="good">ACTIVE</b>' : phSt.cdLeft > 0 ? '<span class="warn">COOLDOWN</span>' : '<span class="warn">requirements missing</span>'}</div>`
            + req(phSt.researched, "🌫 Phantom Step technology researched")
            + req(phSt.dyson, "☀ Dyson Sphere fully built")
            + req(phSt.station, "🔭 Deep Space Research Station upgrade");
          if (phSt.activeSys) {
            html += `<div class="kv"><span>Status</span><b class="good">ACTIVE</b> — ${phSt.activeLeft} turn${phSt.activeLeft === 1 ? "" : "s"} remaining</div>
              <div class="kv"><span>Hidden system</span>${esc(systemDef(phSt.activeSys).n)}</div>
              <div class="dim small">The field shuts down by itself after ${PHANTOM.active} turns, then needs a ${PHANTOM.cooldown}-turn cooldown before it can be raised again.</div>`;
          } else if (phSt.cdLeft > 0) {
            html += `<div class="kv"><span>Status</span><span class="warn">cooldown — ${phSt.cdLeft} turn${phSt.cdLeft > 1 ? "s" : ""} remaining</span></div>`;
          } else if (phSt.ready) {
            // the controller says GO — offer the target list (the station's own
            // system is preselected when it qualifies) and the activation button
            const phCands = phantomEligibleSystems(G.playerId);
            const hereSys = systemAt(r.x, r.z).id;
            if (phCands.length) {
              const selSys = phCands.includes(phantomSelSys) ? phantomSelSys : (phCands.includes(hereSys) ? hereSys : phCands[0]);
              html += `<div class="kv"><span>System to hide</span><select id="sp-ph-sys">${phCands.map(sid =>
                  `<option value="${sid}"${sid === selSys ? " selected" : ""}>${esc(systemDef(sid).n)}${sid === "home" ? " (homeland)" : sid === hereSys ? " (this system)" : ""}</option>`).join("")}</select></div>
                <button class="btn small primary" id="sp-phantom-st"
                  title="Cloak the chosen solar system from the galaxy for ${PHANTOM.active} turns (then a strict ${PHANTOM.cooldown}-turn cooldown). Others cannot see or target its planets, fleets or stations. Leaving fleets become visible; war exposes military activity; an enemy Deep Space Research Station has a ${Math.round(PHANTOM.scanChance * 100)}% chance to disrupt the field.">🌫 Activate Phantom Step <i>${PHANTOM.cost.money}💰 ${PHANTOM.cost.energy}⚡</i></button>`;
            } else {
              html += `<button class="btn small off" id="sp-phantom-st"
                  title="Phantom Step cloaks a system where your civilization has presence — the homeland, a system with your colony, or one holding a Deep Space Research Station.">🌫 Activate Phantom Step <i>${PHANTOM.cost.money}💰 ${PHANTOM.cost.energy}⚡</i></button>
                <div class="dim small">No eligible system right now — every candidate is destroyed or already cloaked.</div>`;
            }
          } else if (!r.deep) {
            html += `<div class="dim small">Complete the 🔭 Deep Space Research Station upgrade above to bring this console online.</div>`;
          } else if (!phSt.researched) {
            html += `<div class="dim small">Research 🌫 Phantom Step (Megastructure Era, Technology tab) to cloak a solar system from this console.</div>`;
          } else if (!phSt.dyson) {
            html += `<div class="dim small">Complete every stage of the ☀ Dyson Sphere — the cloak drinks a star's worth of power.</div>`;
          }
        }
        if (r.hp < r.maxHp) html += `<button class="btn small" id="sp-res-repair" title="Restore the city's hull.">🔧 Repair</button>`;
        if (P.researched[MEGA_DEFS.shield.tech] && !(r.shield && r.shield.hp > 0)) {
          html += `<button class="btn small" id="sp-shield-res" title="${esc(MEGA_DEFS.shield.d)}">🛡 Raise Giant Shield <i>${MEGA_DEFS.shield.cost.money}💰 ${MEGA_DEFS.shield.cost.mat}⛏</i></button>`;
        }
        if (r.shield && r.shield.hp < r.shield.maxHp) {
          html += `<button class="btn small" id="sp-shieldfix-res" title="Recharge the shield to full.">🛡 Repair shield <i>${Math.round(MEGA_DEFS.shield.cost.money * MEGA_DEFS.shield.repairFrac)}💰</i></button>`;
        }
      } else if (own && r.destroyed) {
        const rc = { money: Math.round(MEGA_DEFS.researcher.cost.money * RESEARCHER_REVIVE_FRAC), mat: Math.round(MEGA_DEFS.researcher.cost.mat * RESEARCHER_REVIVE_FRAC) };
        html += `<div class="dim small">The city is a dark wreck — but its level-${r.lvl} systems can be revived.</div>
          <button class="btn small primary" id="sp-res-revive">♻ Restore Researcher <i>${rc.money}💰 ${rc.mat}⛏</i></button>`;
      }
      if (G.sandbox && !r.destroyed) {
        html += `<div class="diplo-actions"><button class="btn small danger" id="sbx-del-res" title="Instantly destroy this Researcher megastructure.">💥 Destroy Researcher</button></div>`;
      }
    }
  } else if (spaceSel && spaceSel.kind === "bh") {
    // ---- Update §5-16: the galactic core ----
    const bh = galaxyBH(), bhH = G.space.bhH;
    const B = BH_HARVESTER;
    html += `<h4>🕳 Supermassive Black Hole</h4>
      <div class="dim small">The still heart of the galaxy. It cannot be destroyed, colonized, moved or rebuilt — only harnessed. A completed Harvester grants unlimited ⚡ Omni-Laser charges without ever weakening it.</div>`;
    const guard = (G.space.aliens || []).find(a => a.bhGuard && !a.defeated);
    html += `<div class="kv"><span>Presence</span>${bh && bh.aliens && guard
      ? `<span class="warn">👁 alien presence — ${esc(G.countries[guard.aid] ? G.countries[guard.aid].name : "unknown")}${guard.bhAlert ? ' <span class="bad">(alerted)</span>' : " (passive)"}</span>`
      : "unclaimed"}</div>`;
    if (bhH && !bhH.ruins) {
      const ownerN = G.countries[bhH.owner] ? G.countries[bhH.owner].name : "?";
      const mine = bhH.owner === G.playerId;
      const done = bhH.stage >= B.stages;
      html += `<div class="kv"><span>Harvester</span>${esc(ownerN)}${mine ? " (you)" : ""} — ${done ? '<b class="good">OPERATIONAL</b>'
          : `stage ${bhH.stage}/${B.stages}${bhH.building ? (bhH.paused ? ' · <span class="bad">PAUSED under fire</span>' : ` · building ${Math.round(100 * bhH.prog / B.ticksPerStage)}%`) : " · awaiting the next stage"}`}</div>
        <div class="kv"><span>Hull</span>${fmt(Math.max(0, Math.round(bhH.hp)))}/${fmt(bhH.maxHp)}</div>
        ${bhH.shield ? `<div class="kv"><span>Shield</span>${bhH.shield.hp > 0 ? fmtShield(bhH.shield) + " charge" : '<span class="bad">collapsed</span>'}</div>` : ""}`;
      if (done) {
        const conn = bhH.connected ? shipById(bhH.connected) : null;
        html += `<div class="kv"><span>Charge cycle</span>${bhH.cd > 0 ? `<span class="warn">cooling — ${bhH.cd} tick${bhH.cd > 1 ? "s" : ""}</span>` : '<b class="good">READY</b>'}</div>
          <div class="kv"><span>Connected</span>${conn ? `${UNITS[conn.unit].icon} ${esc(G.countries[conn.owner] ? G.countries[conn.owner].name : "?")} — ${conn.harvest ? Math.round(100 * conn.harvest.prog / conn.harvest.need) + "% charged" : "linking…"}` : "no Star Destroyer connected"}</div>`;
      }
      if (mine) {
        // Critical Bug-Fix §1: every construction stage needs one of your
        // spaceships physically holding at the black hole
        const shipHere = bhShipPresent(G.playerId);
        if (bhH.paused) html += `<button class="btn small primary" id="sp-bh-resume" title="Send the construction crews back out — progress was kept.">🚧 Resume construction</button>`;
        if (!done && !bhH.building && !bhH.paused) {
          html += shipHere
            ? `<button class="btn small primary" id="sp-bh-stage" title="Fund construction stage ${bhH.stage + 1}/${B.stages}: ${B.cost.money}💰 ${B.cost.mat}⛏ ${B.cost.energy}⚡ and ${B.ticksPerStage} ticks of work. The site is vulnerable while building.">🕳 Next stage <i>${B.cost.money}💰 ${B.cost.mat}⛏</i></button>`
            : `<div class="warn small">🛸 A spaceship must reach the black hole before construction can begin. (Select a ship, click the black hole.)</div>`;
        }
        if (done) html += `<button class="btn small" id="sp-bh-share" title="Update §15: optionally allow allied Star Destroyers to draw charges from your Harvester.">🤝 Ally charging: <b>${bhH.share ? "ALLOWED" : "OFF"}</b></button>`;
      } else {
        html += `<div class="dim small">Only its owner${bhH.share ? " and its allies" : ""} may draw charges. It can be besieged — its shield and massive hull soak even Star Destroyer fire.</div>`;
      }
    } else {
      if (bhH && bhH.ruins) html += `<div class="bad small">🕳 Ruins of a destroyed Harvester drift around the untouched black hole. The site lies open — any civilization may build the next one.</div>`;
      const can = P.era >= 9 && P.researched[B.tech];
      // Critical Bug-Fix §1: like colonization, the Harvester takes a ship ON
      // SITE — with the tech but no ship at the core, the panel says exactly why
      html += !can
        ? `<div class="dim small">Research ☀ Dyson Sphere, ⭕ Halo Rings and then 🕳 Black Hole Energy Harvesting to harness the core.</div>`
        : bhShipPresent(G.playerId)
          ? `<button class="btn small primary" id="sp-bh-stage" title="Begin the ${B.n}: ${B.stages} stages of ${B.cost.money}💰 ${B.cost.mat}⛏ ${B.cost.energy}⚡, each ${B.ticksPerStage} ticks. No territorial control is needed — but the site must be protected while it builds.">🕳 Construct Black Hole Energy Harvester <i>${B.cost.money}💰 ${B.cost.mat}⛏</i></button>`
          : `<div class="warn small">🛸 A spaceship must reach the black hole before construction can begin. (Select a ship, click the black hole, wait for it to arrive.)</div>`;
    }
    if (G.sandbox && bhH && !bhH.ruins) {
      html += `<div class="diplo-actions"><button class="btn small danger" id="sbx-del-bhh" title="Instantly destroy the Black Hole Energy Harvester (the black hole itself is untouchable).">💥 Destroy Harvester</button></div>`;
    }
  } else if (spaceSel && spaceSel.kind === "star" && phantomHiddenFrom(spaceSel.sys || "home", G.playerId)) {
    // Update §17: to outside eyes a cloaked system is just… wrong, somehow
    html += `<h4>🌫 Void Distortion</h4>
      <div class="dim small">Scans slide off this region of space — instruments return only empty static and a faint gravitational haze. As far as the galaxy's charts are concerned, nothing is here.</div>`;
  } else if (spaceSel && spaceSel.kind === "star") {
    const sysId = spaceSel.sys || "home";
    const sys = systemDef(sysId);
    const revealed = systemRevealed(sysId);
    const stSys = (G.space.systems && G.space.systems[sysId]) || {};
    html += `<h4>${stSys.nova ? "🌌" : stSys.dead ? "🌑" : "☀"} ${esc(revealed ? (stSys.nova ? sys.n + " Nebula" : sys.n) : "Unknown Star")}</h4><div class="dim small">${sysId === "home" ? "Your home system's star." : revealed ? (stSys.nova ? "The grave of a solar system." : "A foreign sun.") : "An uncharted system — travel there or locate it with a 🌆 Researcher."}</div>`;
    // Update §1: the four sun states, named without ambiguity
    if (revealed) {
      const stateN = { active: "☀ Active Sun", dimmed: "🌗 Partially Harvested Sun", dead: "🌑 Dead Sun", nova: "💥 Completely Destroyed Solar System" }[sysLightState(sysId)];
      html += `<div class="kv"><span>Status</span>${stateN}</div>`;
    }
    // Small Update §4+§7: the sun's harvest ledger, or what remains of it
    if (revealed && stSys.nova) {
      html += `<div class="bad small">💥 This solar system was destroyed by an Omni-Hypercharged Orbital Laser Strike. A permanent nebula fills the void — no planet or star can ever be reconstructed here, by Rehabilitator or anything else.</div>`;
    } else if (revealed && stSys.dead) {
      html += `<div class="bad small">🌑 A dead star — three stellar harvests stripped it of every last joule. It will never recover; the worlds it warmed now freeze in the dark.</div>`;
    } else if (revealed) {
      html += `<div class="kv"><span>Stellar Harvests</span>Remaining: ${sysHarvestsLeft(sysId)}/${STELLAR_HARVEST.max}${(stSys.harvests || 0) ? ' · <span class="warn">visibly dimmed</span>' : ""}</div>`;
      if ((stSys.harvests || 0) === STELLAR_HARVEST.max - 1) html += `<div class="warn small">⚠ One more harvest will collapse this sun forever.</div>`;
    }
    // ---- Update §17-19: Phantom Step controls ----
    const phSt = stSys.phantom;
    if (phSt && phSt.owner === G.playerId) {
      html += `<div class="kv"><span>🌫 Phantom Step</span><b class="good">ACTIVE</b> — ${Math.max(0, phSt.until - G.turn)} turn${phSt.until - G.turn === 1 ? "" : "s"} left</div>
        <div class="dim small">The system is hidden from the galaxy. Fleets that leave it become visible; war exposes your military; Deep Space Research Stations may disrupt the field. It shuts down automatically, then needs a ${PHANTOM.cooldown}-turn cooldown.</div>`;
    } else if (!phSt && revealed && !stSys.nova) {
      // Critical Bug-Fix §4: NO duplicate activation button here — the one and
      // only Phantom Step console lives on the Deep Space Research Station.
      // The star panel just reports the controller's state for this system
      // (Final Space Fixes §1: the homeland system included).
      if (phantomEligibleSystems(G.playerId).includes(sysId)) {
        const phCtl = phantomStatus(G.playerId);
        html += `<div class="kv"><span>🌫 Phantom Step</span>${
          phCtl.cdLeft > 0 ? `<span class="warn">cooldown — ${phCtl.cdLeft} turn${phCtl.cdLeft > 1 ? "s" : ""}</span>`
          : phCtl.ready ? '<span class="dim">this system can be cloaked — use your 🔭 Deep Space Research Station console</span>'
          : `<span class="dim">${esc(phCtl.why || "unavailable")}</span>`}</div>`;
      }
    }
    const dy = dysonOfSystem(sysId) || (sysId === "home" ? G.space.dyson : null);
    const d = MEGA_DEFS.dyson;
    if (dy && revealed) {
      const ownerName = G.countries[dy.owner] ? G.countries[dy.owner].name : "?";
      html += `<div class="kv"><span>Dyson Sphere</span>${esc(ownerName)} — stage ${dy.stage}/${d.stages}${dy.building ? ` (building ${Math.round(100 * dy.prog / d.ticks)}%)` : ""}${dy.hp !== undefined && dy.stage > 0 ? ` · hull ${fmt(Math.max(0, dy.hp))}/${DYSON_HP}` : ""}</div>`;
      if (dy.stage > 0) {
        // Part 3: the number shown here is what colonyIncome actually credits
        const out = dysonOutput(dy);
        const full = d.energyPerStage * dy.stage;
        const hurt = out < full;
        html += `<div class="kv"><span>Energy output</span><b class="good">+${fmt(out)}⚡ per tick</b>${hurt ? ` <span class="warn">(−${Math.round(100 - 100 * out / full)}% damage penalty)</span>` : ""}</div>
          <div class="kv"><span>Production</span><b class="good">ACTIVE</b> — added to ${esc(ownerName)}'s energy every tick${dy.building ? ' <span class="dim">(next stage under construction)</span>' : ""}</div>`;
        if (dy.total) html += `<div class="kv"><span>Total delivered</span>${fmt(dy.total)}⚡</div>`;
      }
      if (dy.shield) html += `<div class="kv"><span>Giant Shield</span>${dy.shield.hp > 0 ? fmtShield(dy.shield) + " charge" : '<span class="bad">collapsed</span>'}</div>`;
      if (dy.owner === G.playerId) {
        if (P.researched[MEGA_DEFS.shield.tech] && !(dy.shield && dy.shield.hp > 0)) {
          html += `<button class="btn small" id="sp-shield-dyson" title="${esc(MEGA_DEFS.shield.d)}">🛡 Shield the Dyson Sphere <i>${MEGA_DEFS.shield.cost.money}💰 ${MEGA_DEFS.shield.cost.mat}⛏</i></button>`;
        }
        if (dy.shield && dy.shield.hp < dy.shield.maxHp) {
          html += `<button class="btn small" id="sp-shieldfix-dyson" title="Recharge the shield to full.">🛡 Repair shield <i>${Math.round(MEGA_DEFS.shield.cost.money * MEGA_DEFS.shield.repairFrac)}💰</i></button>`;
        }
      }
    }
    // Final Space Fixes §2-3: a sphere can rise around ANY star the nation has
    // secured — one rulebook (canBuildDyson) decides and names every blocker
    if (revealed && !stSys.nova) {
      const dchk = canBuildDyson(G.playerId, sysId);
      const dyMine = dysonAt(sysId);
      if (dchk.ok) {
        html += `<button class="btn small primary" id="sp-dyson" title="${esc(d.d)} Stage cost: ${d.cost.money}💰 ${d.cost.mat}⛏, ${d.ticks} ticks of construction. A colony in the system proves construction access. ⚠ Its energy signature can be detected by alien civilizations.">☀ ${dyMine ? "Next Dyson stage" : "Begin Dyson Sphere"} <i>${d.cost.money}💰 ${d.cost.mat}⛏</i></button>`;
      } else if (!P.researched[d.tech]) {
        if (sysId === "home") html += `<div class="dim small">Research ☀ Dyson Sphere (Megastructure Era) to harness the star.</div>`;
      } else if (dchk.why && !sunDead(sysId) && (!dyMine || Number(dyMine.owner) === G.playerId) &&
          !(dyMine && (dyMine.building || dyMine.stage >= d.stages))) {
        html += `<div class="warn small">☀ ${esc(dchk.why)}</div>`;
      }
    }
    // ---- AI Update §13: the Void Shield console for this system ----
    if (revealed && !stSys.nova) {
      const vs = voidShieldAt(sysId);
      if (vs) {
        const vOwner = G.countries[vs.owner] ? G.countries[vs.owner].name : "?";
        html += `<div class="kv"><span>🌐 Void Shield</span>${esc(vOwner)}${vs.owner === G.playerId ? " (you)" : ""} — ${vs.building
          ? `raising ${Math.round(100 * vs.prog / (vs.need || VOID_SHIELD.ticks))}%`
          : vs.hp > 0 ? `<b class="good">ACTIVE</b> · ${fmt(Math.max(0, Math.round(vs.hp)))}/${fmt(vs.maxHp)}` : '<span class="bad">collapsed</span>'}</div>
          <div class="dim small">While it stands, alien fleets cannot enter this system, and alien colonization and invasions here are impossible. Planetary nations pass freely. Aliens must destroy the generator to break in.</div>`;
        if (vs.owner === G.playerId && !vs.building && vs.hp < vs.maxHp) {
          html += `<button class="btn small" id="sp-vshield-fix" title="Restore the generator to full strength.">🌐 Repair Void Shield <i>${Math.round(VOID_SHIELD.cost.money * VOID_SHIELD.repairFrac)}💰 ${Math.round(VOID_SHIELD.cost.mat * VOID_SHIELD.repairFrac)}⛏</i></button>`;
        }
      } else {
        const vchk = canBuildVoidShield(G.playerId, sysId);
        if (vchk.ok) {
          html += `<button class="btn small" id="sp-vshield" title="Raise a system-wide barrier: alien fleets cannot enter, colonize or invade while it stands (homeland nations are unaffected). ${VOID_SHIELD.ticks} ticks of construction; aliens can besiege and destroy the generator.">🌐 Raise Void Shield <i>${VOID_SHIELD.cost.money}💰 ${VOID_SHIELD.cost.mat}⛏ ${VOID_SHIELD.cost.energy}⚡</i></button>`;
        } else if (P.researched[VOID_SHIELD.tech] && vchk.why && !sunDead(sysId)) {
          html += `<div class="dim small">🌐 ${esc(vchk.why)}</div>`;
        }
      }
    }
    // ---- Sandbox Improvement §6-§8: star tools ----
    if (G.sandbox) {
      html += `<h4>🧪 Sandbox</h4><div class="diplo-actions">`;
      if (!revealed) html += `<button class="btn small" id="sbx-reveal-sys" title="Reveal every planet and object in this system only.">🔭 Reveal Solar System</button>`;
      const seedable = SPACE_PLANETS.filter(d2 => planetSysId(d2) === sysId && d2.type !== "main" &&
        G.space.planets[d2.id] && !G.space.planets[d2.id].destroyed && !G.space.planets[d2.id].colony);
      if (seedable.length && !sunDead(sysId)) {
        html += `</div>
          <div class="kv"><span>Add aliens</span></div>
          <select id="sbx-alien-planet">${seedable.map(d2 => `<option value="${d2.id}">${esc(d2.n)}</option>`).join("")}</select>
          <select id="sbx-alien-tier">
            <option value="1">Primitive</option><option value="2" selected>Normal</option>
            <option value="3">Advanced</option><option value="4">Hyper-Advanced</option><option value="0">Random</option>
          </select>
          <div class="diplo-actions"><button class="btn small" id="sbx-alien-add" title="Create an alien civilization on the chosen planet: capital colony, garrison, fleet and tier-appropriate technology. It registers under 👁 Known Civilizations once visible.">👁 Add Alien Civilization</button>`;
      }
      if (dysonAt(sysId)) html += `<button class="btn small danger" id="sbx-del-dyson" title="Instantly destroy the Dyson Sphere around this star.">💥 Destroy Dyson Sphere</button>`;
      if (voidShieldAt(sysId)) html += `<button class="btn small danger" id="sbx-del-vshield" title="Instantly destroy the Void Shield around this system.">💥 Destroy Void Shield</button>`;
      html += `</div>`;
    }
  } else if (spaceSel && spaceSel.kind === "planet") {
    const def = planetDef(spaceSel.id), st = planetState(spaceSel.id);
    const typeName = { main: "the Homeworld", lava: "volcanic world", rock: "rocky world", ice: "frozen world", gas: "gas giant", dark: "distant dark world" }[def.type];
    const sysN = systemDef(planetSysId(def)).n;
    html += `<h4>🪐 ${esc(def.n)}</h4><div class="dim small">${esc(typeName)} · ${esc(sysN)} system${def.bias ? ` · rich in ${def.bias === "mat" ? "materials" : def.bias}` : ""}</div>`;
    if (st.shield) html += `<div class="kv"><span>Giant Shield</span>${st.shield.hp > 0 ? `${fmtShield(st.shield)} charge (${esc(G.countries[st.shield.owner] ? G.countries[st.shield.owner].name : "?")})` : '<span class="bad">collapsed</span>'}</div>`;
    if (st.rehab) html += `<div class="kv"><span>Rehabilitator</span>${Math.round(100 * st.rehab.prog / st.rehab.need)}% — ${st.rehab.rebuild ? "reassembling the planet" : "extinguishing the surface"}</div>`;
    if (st.destroyed) {
      html += `<div class="bad small">Destroyed. Only debris remains.</div>`;
      if (P.researched[MEGA_DEFS.rehab.tech] && !st.rehab) {
        const rc = { money: MEGA_DEFS.rehab.cost.money * MEGA_DEFS.rehab.rebuildMult, mat: MEGA_DEFS.rehab.cost.mat * MEGA_DEFS.rehab.rebuildMult };
        html += `<button class="btn small" id="sp-rehab" title="Reassemble the shattered world into a fresh, colonizable planet. Extremely expensive.">♻ Rebuild ${esc(def.n)} <i>${rc.money}💰 ${rc.mat}⛏</i></button>`;
      }
    } else if (def.type === "main") {
      html += st.scorched
        ? `<div class="bad small">🔥 THE SURFACE BURNS. Troops die on landing, nothing can be built, the cities are ruins. A ♻ Rehabilitator can restore it.</div>`
        : `<div class="hint small">Your entire map lives here. Ships orbiting the Homeworld can 🌍 Land (select the ship, press E).</div>`;
      if (st.scorched && P.researched[MEGA_DEFS.rehab.tech] && !st.rehab) {
        html += `<button class="btn small primary" id="sp-rehab" title="${esc(MEGA_DEFS.rehab.d)}">♻ Rehabilitate the Homeworld <i>${MEGA_DEFS.rehab.cost.money}💰 ${MEGA_DEFS.rehab.cost.mat}⛏</i></button>`;
      }
      if (P.researched[MEGA_DEFS.shield.tech] && !(st.shield && st.shield.hp > 0)) {
        html += `<button class="btn small" id="sp-shieldp" title="${esc(MEGA_DEFS.shield.d)}">🛡 Shield the Homeworld <i>${MEGA_DEFS.shield.cost.money}💰 ${MEGA_DEFS.shield.cost.mat}⛏</i></button>`;
      }
      if (st.shield && st.shield.owner === G.playerId && st.shield.hp < st.shield.maxHp) {
        html += `<button class="btn small" id="sp-shieldfixp" title="Recharge the shield to full.">🛡 Repair shield <i>${Math.round(MEGA_DEFS.shield.cost.money * MEGA_DEFS.shield.repairFrac)}💰</i></button>`;
      }
    } else if (st.colony && G.countries[st.colony.owner] && G.countries[st.colony.owner].alien) {
      const A = G.countries[st.colony.owner];
      const rec = alienById(st.colony.owner);
      const isAlienCap = rec && !rec.defeated && rec.capital === def.id;
      const bHere = battleOn(def.id);
      html += `<div class="kv"><span>Alien colony</span>${esc(A.name)} — level ${st.colony.lvl}</div>
        ${isAlienCap ? `<div class="kv"><span>👁★ CAPITAL</span><b>the heart of the ${esc(A.name)}</b></div>
        <div class="warn small">Seat of the Overmind, centre of production and identity. Conquer or destroy this world and the whole civilization falls — its other colonies with it. Conquest (not destruction) yields immense spoils of alien technology.</div>` : ""}
        <div class="kv"><span>Garrison</span>${st.colony.garrison.length ? st.colony.garrison.map(g2 => UNITS[g2.unit].icon).join(" ") : bHere ? "⚔ fighting on the surface" : "undefended"}</div>
        ${bHere ? `<div class="bad small">⚔ A ground battle is being fought for this world right now.</div>` : ""}
        <div class="dim small">${rec && rec.contacted.includes(G.playerId) ? "Select them under 👁 Known Civilizations to parley." : "An alien world. They do not yet answer your signals."}</div>`;
      // BUG REPORT §3: the Invade button lives ON the alien planet again —
      // shown whenever the invasion-entry module clears the landing, otherwise
      // the exact blocking reason is named in its place
      if (atWar(G.playerId, st.colony.owner) && !bHere) {
        const ichk = invasionCheck(G.playerId, def.id);
        html += ichk.ok
          ? `<button class="btn small danger" id="sp-invade-p"
              title="Land the troops aboard your nearby transport and open a real-time ground battle for ${esc(def.n)}. The defending fleet must be cleared from orbit first; warships overhead add orbital fire support, loaded transports drop reinforcements.">⚔ Invade ${esc(def.n)}</button>`
          : `<div class="bad small">⚔ At war — invasion blocked: ${esc(ichk.why)}.</div>`;
      }
    } else if (st.colony) {
      const own = st.colony.owner === G.playerId;
      const C = G.countries[st.colony.owner];
      const darkSys = sunDead(planetSysId(def)); // BUG REPORT (star death)
      html += `<div class="kv"><span>Colony</span>${esc(C.name)} — level ${st.colony.lvl}/${COLONY_MAX_LVL}</div>
        <div class="kv"><span>Garrison</span>${st.colony.garrison.length ? st.colony.garrison.map(g2 => UNITS[g2.unit].icon).join(" ") : "undefended"}</div>`;
      if (st.halo) html += `<div class="kv"><span>Halo Ring</span>${darkSys ? `<span class="bad">dimmed — the star is dead (output × ${DEAD_SUN.prodMult})</span>` : st.halo.done ? "complete" : `under construction ${Math.round(100 * st.halo.prog / st.halo.need)}%`}</div>`;
      if (darkSys) html += `<div class="bad small">🌑 The system's sun is dead — the colony endures in the dark at ${Math.round(DEAD_SUN.prodMult * 100)}% production (−${Math.round((1 - DEAD_SUN.prodMult) * 100)}% to every output), and nothing new can be founded or built.</div>`;
      if (own) {
        // Part 2: exactly what this colony pays out — and has paid in total
        const M2 = MODES[G.mode].res;
        const cp = colonyProduction(def, st, P);
        html += `<div class="kv"><span>Production/tick</span><b class="${darkSys ? "bad" : "good"}">+${fmt(cp.money * M2)}💰 +${fmt(cp.mat * M2)}⛏ +${fmt(cp.energy)}⚡ +${fmt(cp.research * M2)}🔬 +${fmt(cp.food * M2)}🍞</b> → ${esc(P.name)}</div>`;
        if (st.colony.total) {
          const tot = st.colony.total;
          html += `<div class="kv"><span>Total produced${darkSys ? " (dark — at 20%)" : ""}</span>${fmt(tot.money)}💰 · ${fmt(tot.mat)}⛏ · ${fmt(tot.energy)}⚡ · ${fmt(tot.research)}🔬</div>`;
        }
        // Part 14.3: colony industry — mines, refineries, plants, fabricators
        // (a dead-sun colony shows its silent industry but offers no buttons)
        const cb = st.colony.b || {};
        const slots = COLONY_BLDG_SLOTS(st.colony.lvl);
        const usedB = colonyBldgCount(st.colony);
        html += `<div class="kv"><span>Industry</span>${usedB}/${slots} slots${usedB ? " — " + Object.keys(cb).filter(k => cb[k]).map(k => `${COLONY_BLDGS[k].icon}×${cb[k]}`).join(" ") : " — none built"}${darkSys && usedB ? ' <span class="bad">(running at 20%)</span>' : ""}</div>`;
        if (!darkSys) {
          for (const bId of Object.keys(COLONY_BLDGS)) {
            const B = COLONY_BLDGS[bId];
            if (B.tech && !P.researched[B.tech]) continue;
            html += `<button class="btn small ${usedB >= slots ? "off" : ""}" data-colbld="${bId}"
              title="${esc(B.d)}${bId === "refinery" ? " Bonus tip: pair it with a Mine here." : ""}">${B.icon} Build ${esc(B.n)} <i>${B.cost.money}💰 ${B.cost.mat}⛏</i></button>`;
          }
          if (st.colony.lvl < COLONY_MAX_LVL) {
            const uc = SPACE_COSTS.colonyUp(st.colony.lvl);
            html += `<button class="btn small" id="sp-upg" title="Each level produces more money, materials, energy and research, houses more people and adds an industry slot. Every upgrade costs more than the last.">⬆ Upgrade colony to L${st.colony.lvl + 1} <i>${uc.money}💰 ${uc.mat}⛏</i></button>`;
          }
          const h = MEGA_DEFS.halo;
          if (!st.halo && P.researched[h.tech]) {
            html += `<button class="btn small" id="sp-halo" title="${esc(h.d)} Takes ${h.ticks} ticks to complete.">⭕ Build Halo Ring <i>${h.cost.money}💰 ${h.cost.mat}⛏</i></button>`;
          }
        }
        // capital planet (Part 12) — never offered on a frozen world
        if (P.spaceCapital === def.id) {
          html += `<div class="kv"><span>★ Capital</span><b class="good">This is your capital planet (+${Math.round(CAPITAL_PLANET.bonus * 100)}% production here)</b></div>`;
        } else if (!darkSys) {
          const cdLeft = P.capitalCd || 0;
          html += `<button class="btn small ${cdLeft > 0 ? "off" : ""}" id="sp-capital"
            title="Proclaim this colony your capital planet: +${Math.round(CAPITAL_PLANET.bonus * 100)}% money, materials and energy from it — but the move costs ${CAPITAL_PLANET.cost.money}💰 ${CAPITAL_PLANET.cost.mat}⛏, shakes morale and stability, and has a long cooldown.">★ Make capital planet ${cdLeft > 0 ? `<i>wait ${cdLeft}</i>` : `<i>${CAPITAL_PLANET.cost.money}💰 ${CAPITAL_PLANET.cost.mat}⛏</i>`}</button>`;
        }
        // Giant Shield (Part 4)
        if (P.researched[MEGA_DEFS.shield.tech] && !(st.shield && st.shield.hp > 0)) {
          html += `<button class="btn small" id="sp-shieldp" title="${esc(MEGA_DEFS.shield.d)}">🛡 Raise Giant Shield <i>${MEGA_DEFS.shield.cost.money}💰 ${MEGA_DEFS.shield.cost.mat}⛏</i></button>`;
        }
        if (st.shield && st.shield.owner === G.playerId && st.shield.hp < st.shield.maxHp) {
          html += `<button class="btn small" id="sp-shieldfixp" title="Recharge the shield to full.">🛡 Repair shield <i>${Math.round(MEGA_DEFS.shield.cost.money * MEGA_DEFS.shield.repairFrac)}💰</i></button>`;
        }
        html += `<div class="dim small">Ships in orbit: press <b>E</b> to deploy troops to the garrison (or load them back aboard).</div>`;
      } else {
        // BUG REPORT §3: enemy colonies of ordinary nations get the same
        // invasion entry as alien worlds — one module, one rule
        if (battleOn(def.id)) html += `<div class="bad small">⚔ A ground battle is being fought for this world right now.</div>`;
        else if (atWar(G.playerId, st.colony.owner)) {
          const ichk2 = invasionCheck(G.playerId, def.id);
          html += ichk2.ok
            ? `<button class="btn small danger" id="sp-invade-p"
                title="Land the troops aboard your nearby transport and open a real-time ground battle for ${esc(def.n)}.">⚔ Invade ${esc(def.n)}</button>`
            : `<div class="bad small">⚔ At war — invasion blocked: ${esc(ichk2.why)}.</div>`;
        } else html += `<div class="dim small">Foreign colony — you are not at war.</div>`;
      }
    } else {
      const near = myShips.some(s => shipNearPlanet(s, def.id));
      const cc = SPACE_COSTS.colonize;
      html += `<div class="kv"><span>Status</span>uncolonized</div>`;
      if (sunDead(planetSysId(def))) html += `<div class="bad small">🌑 The system's star is dead — no colony can live in its frozen dark.</div>`;
      else if (!P.researched.colonyships) html += `<div class="dim small">Research 🚀 Colony Ships to settle new worlds.</div>`;
      else if (!near) html += `<div class="dim small">Send a ship to this planet (select the ship, click the planet), then colonize.</div>`;
      else html += `<button class="btn small primary" id="sp-colonize" title="Found a level 1 colony. Colonies produce money, materials, energy and research each tick — more with every upgrade.">🪐 Colonize <i>${cc.money}💰 ${cc.mat}⛏</i></button>`;
    }
    // ---- Sandbox Improvement §8: instant destruction on this world ----
    if (G.sandbox && def.type !== "main") {
      html += `<div class="diplo-actions">`;
      if (st.colony && !st.destroyed) html += `<button class="btn small danger" id="sbx-del-colony" title="Instantly erase the colony (buildings, garrison and Halo Ring included). Alien capitals falling this way still defeat their civilization.">💥 Destroy colony</button>`;
      if (!st.destroyed) html += `<button class="btn small danger" id="sbx-del-planet" title="Instantly delete the entire planet — bypasses health, shields and combat.">💥 Destroy ${esc(def.n)}</button>`;
      html += `</div>`;
    }
  } else if (spaceSel && spaceSel.kind === "ship") {
    const s = shipById(spaceSel.id);
    if (s) {
      const u = UNITS[s.unit];
      const mine = s.owner === G.playerId;
      html += `<h4>${u.icon} ${esc(u.n)}${(s.stack || 1) > 1 ? ` ×${s.stack}` : ""}</h4>
        <div class="kv"><span>Owner</span>${esc(G.countries[s.owner].name)}${mine ? " (you)" : ""}</div>
        <div class="kv"><span>Hull</span>${fmt(s.hp)}/${fmt(s.maxHp)}</div>
        ${u.cap ? `<div class="kv"><span>Troop bays</span>${(s.cargo || []).length}/${u.cap}${(s.cargo || []).length ? " — " + s.cargo.map(cu => UNITS[cu.unit].icon).join(" ") : ""}</div>` : ""}`;
      if (mine) {
        const near = shipNearestPlanet(s);
        html += `<div class="dim small">Click a planet to travel there. Click an enemy ship to pursue it. Click <b>open space</b> to fly anywhere.</div>`;
        if (near && near.type === "main" && !homeworldScorched()) html += `<button class="btn small primary" id="sp-land" title="Land at one of your Space Program cities and return to the map. Health, cargo and weapon cooldowns are kept; troops aboard step off onto the surface.">🌍 Land on the Homeworld</button>`;
        if (near && near.type === "main" && homeworldScorched()) html += `<div class="bad small">🔥 The surface burns — the ship holds in Homeland Orbit until the planet is rehabilitated.</div>`;
        if (near && near.type !== "main") {
          const st = planetState(near.id);
          if (st.colony && st.colony.owner === G.playerId) {
            if ((s.cargo || []).length) html += `<button class="btn small" id="sp-deploy" title="Move the troops aboard into the colony's garrison (same as pressing E).">👾 Deploy troops to ${esc(near.n)}</button>`;
            if (u.cap && st.colony.garrison.length) html += `<button class="btn small" id="sp-loadg" title="Load garrison troops back aboard, up to capacity.">⛴ Load garrison</button>`;
          }
          if (st.colony && st.colony.owner !== G.playerId && atWar(G.playerId, st.colony.owner) && (s.cargo || []).length) {
            html += `<button class="btn small danger" id="sp-invade" title="Land the troops aboard and open a real-time ground battle for the colony. The defending fleet must be cleared from orbit first; your warships overhead add orbital fire support (blocked by Giant Shields), and cargo craft in orbit drop reinforcements.">⚔ Invade ${esc(near.n)}</button>`;
          }
          if (!st.colony && !st.destroyed && P.researched.colonyships && !sunDead(planetSysId(near))) {
            const cc = SPACE_COSTS.colonize;
            html += `<button class="btn small primary" id="sp-colonize" title="Found a level 1 colony here.">🪐 Colonize ${esc(near.n)} <i>${cc.money}💰 ${cc.mat}⛏</i></button>`;
          }
        }
        // ---- Star Destroyer weapons console (Parts 1-2, SU2 §10-11) ----
        // every Star Destroyer keeps its OWN ready-state, cooldown and target —
        // nothing here is shared between ships
        if (isSD(s)) {
          const ls = sdLaserStatus(s);
          html += `<h4>🌠 Core Cannon</h4>
            <div class="kv"><span>Firing cost</span>${SD_LASER.money}💰 ${SD_LASER.mat}⛏ ${SD_LASER.energy}⚡</div>
            <div class="kv"><span>Status</span>${ls.cd > 0 ? `<span class="warn">recharging — ${ls.cd} tick${ls.cd > 1 ? "s" : ""} left</span>` : ls.afford ? '<b class="good">READY</b>' : '<span class="bad">insufficient resources</span>'}</div>`;
          // this ship's own target ledger: every intact world in the system it
          // is in right now (destroyed planets drop off the list automatically)
          const hereSys = systemAt(s.x, s.z);
          const targets = SPACE_PLANETS.filter(d => planetSysId(d) === hereSys.id &&
            !G.space.planets[d.id].destroyed && (!near || d.id !== near.id));
          if (s.sdTarget && (!planetDef(s.sdTarget) || planetState(s.sdTarget).destroyed)) s.sdTarget = null;
          if (s.sdTarget) html += `<div class="kv"><span>Locked target</span>${esc(planetDef(s.sdTarget).n)}${shipNearPlanet(s, s.sdTarget) ? ' — <b class="good">in range</b>' : " — closing in"}</div>`;
          if (near && near.type !== "main") {
            const st = planetState(near.id);
            if (!st.destroyed) {
              const chk = canDestroyPlanet(s, near.id);
              const who = st.colony ? (st.colony.owner === G.playerId ? "your own colony" : `the colony of ${G.countries[st.colony.owner].name}`) : "an uncolonized world";
              html += `<button class="btn small danger ${chk.ok ? "" : "off"}" id="sp-nova"
                title="${chk.ok ? `Fire the core cannon and destroy this world utterly (${who}). Firing on a foreign colony means WAR; the whole galaxy will despise you.` : esc(chk.why || "Unavailable.")}">🌠 DESTROY ${esc(near.n).toUpperCase()}${st.shield && st.shield.hp > 0 ? " (shielded)" : ""}</button>`;
            }
          }
          if (targets.length) {
            html += `<div class="dim small">Order an approach — the cannon fires once the ship arrives:</div><div class="sp-list">` +
              targets.map(d => {
                const stT = planetState(d.id);
                const who = d.type === "main" ? "the Homeworld" : stT.colony ? esc(G.countries[stT.colony.owner].name) : "uncolonized";
                return `<button class="chip ${s.sdTarget === d.id ? "active" : ""}" data-sdtarget="${d.id}"
                  title="Fly to ${esc(d.n)} (${who}) and train the core cannon on it.">🎯 ${esc(d.n)}</button>`;
              }).join("") + `</div>`;
          }
          if (near && near.type === "main") {
            const st = planetState("home");
            html += st.scorched
              ? `<div class="dim small">The Homeworld already burns.</div>`
              : `<button class="btn small danger ${ls.ready ? "" : "off"}" id="sp-bombard"
                  title="Rake the Homeworld with the core cannon. The planet survives, but EVERY army on it dies (yours included), every building burns, and the surface becomes uninhabitable fire until a ♻ Rehabilitator restores it.">🔥 BOMBARD THE HOMEWORLD${st.shield && st.shield.hp > 0 ? " (shielded)" : ""}</button>`;
            // ---- Hyper Lazer (AI Improvements Part 12): space-only surface strike ----
            const hs = hyperLazerStatus(s);
            html += `<h4>🔦 Hyper Lazer</h4>
              <div class="kv"><span>Firing cost</span>${HYPER_LAZER.money}💰 ${HYPER_LAZER.energy}⚡ · cooldown ${HYPER_LAZER.cd} ticks</div>
              <div class="kv"><span>Status</span>${!hs.nearHome ? '<span class="warn">needs Homeworld orbit</span>' : hs.cd > 0 ? `<span class="warn">recharging — ${hs.cd} tick${hs.cd > 1 ? "s" : ""} left</span>` : hs.afford ? '<b class="good">READY</b>' : '<span class="bad">insufficient resources</span>'}</div>
              <button class="btn small danger ${hs.ready ? "" : "off"}" id="sp-hyper"
                title="Space-only ability: pick a point on the surface and an orbital hyper lazer annihilates the TROOPS in a huge area — any owner's, with a warning if yours are inside. It cannot damage cities, buildings or the planet itself, and it aborts if the ship leaves orbit.">🔦 Fire Hyper Lazer at the surface</button>`;
          }
          // ---- Small Update: Stellar Harvest & the Omni-Hypercharged Orbital
          // Laser Strike (Megastructure Era). The console shows everything §9
          // demands: charges, harvest progress, cooldown, cost, current target.
          html += `<h4>🌟 Omni-Hypercharged Orbital Laser Strike</h4>`;
          if (P.era < 9) {
            html += `<div class="dim small">The solar-system weapon awaits the Megastructure Era.</div>`;
          } else if (!P.researched.doomdevice) {
            html += `<div class="dim small">☠ Research the <b>DOOM Device</b> — the era's hardest technology — to harvest suns and fire the solar-system weapon.</div>`;
          } else {
            const os = omniStatus(s);
            html += `<div class="kv"><span>Stored charges</span><b class="${os.charges ? "good" : ""}">${os.charges}</b> stellar charge${os.charges === 1 ? "" : "s"}</div>
              <div class="kv"><span>Firing cost</span>1 charge + ${OMNI_LASER.money}💰 ${OMNI_LASER.mat}⛏ ${OMNI_LASER.energy}⚡</div>
              <div class="kv"><span>Cooldown</span>${os.cd > 0 ? `<span class="warn">${os.cd} tick${os.cd > 1 ? "s" : ""} left</span>` : "ready to cycle"}</div>
              <div class="kv"><span>Status</span>${s.harvest ? `<span class="warn">harvesting — cannot fire</span>` : os.cd > 0 ? `<span class="warn">recharging</span>` : !os.charges ? '<span class="dim">no stellar charge aboard</span>' : os.afford ? '<b class="good">READY</b>' : '<span class="bad">insufficient resources</span>'}</div>`;
            if (s.omniTarget && systemDef(s.omniTarget)) html += `<div class="kv"><span>Current target</span>💥 ${esc(systemDef(s.omniTarget).n)} system</div>`;
            // harvesting: the sun this ship is parked beside
            const hereSun = systemAt(s.x, s.z);
            const nearSun = shipNearStar(s, hereSun.id);
            if (s.harvest) {
              html += `<div class="kv"><span>Harvest</span><b class="good">${Math.round(100 * s.harvest.prog / s.harvest.need)}%</b> — draining ${esc(systemDef(s.harvest.sys).n)}</div>
                <div class="dim small">🌞 Energy streams from the dimming sun into the weapon-charge meter.</div>`;
            } else if (nearSun && systemRevealed(hereSun.id) && !sunDead(hereSun.id)) {
              const hLeft = sysHarvestsLeft(hereSun.id);
              html += `<div class="kv"><span>${esc(hereSun.n)}</span>Stellar Harvests Remaining: ${hLeft}/${STELLAR_HARVEST.max}</div>
                <button class="btn small primary ${hLeft ? "" : "off"}" id="sp-harvest"
                  title="${hLeft ? `Harvest Stellar Energy from ${esc(hereSun.n)}: a slow, visible energy transfer that stores one solar-system-destroying charge. The sun grows permanently dimmer with each harvest — the third collapses it forever.` : "This sun has nothing left to give."}">🌞 Harvest Stellar Energy</button>`;
            } else if (nearSun && sunDead(hereSun.id)) {
              html += `<div class="bad small">🌑 ${esc(hereSun.n)} is spent — find another sun to harvest.</div>`;
            } else {
              html += `<div class="dim small">Fly the ship close to a sun to 🌞 Harvest Stellar Energy for charges.</div>`;
            }
            // Update §10: the black hole never runs dry — charge here instead
            const bhHc = G.space.bhH;
            if (bhHc && !bhHc.ruins && bhHc.stage >= BH_HARVESTER.stages && shipNearBH(s)) {
              const cchk = canBHCharge(s);
              html += `<button class="btn small primary ${cchk.ok ? "" : "off"}" id="sp-bh-charge"
                title="${cchk.ok ? `Draw one Omni-Laser charge from the ${BH_HARVESTER.n}. The black hole is never weakened — but the Harvester's charge cycle (${BH_HARVESTER.chargeCd} ticks) and this ship's harvest systems (${BH_HARVESTER.shipCd} ticks) both need cooldowns afterwards.` : esc(cchk.why || "Unavailable.")}">🕳 Harvest Black Hole Energy</button>`;
            }
            if (bhHc && !bhHc.ruins && bhHc.owner !== s.owner && shipNearBH(s)) {
              html += `<button class="btn small danger" id="sp-bh-strike"
                title="Fire the core cannon at the ${BH_HARVESTER.n} (${SD_LASER.money}💰 ${SD_LASER.mat}⛏ ${SD_LASER.energy}⚡). Massive damage — its shield absorbs first and several major attacks will be needed. Firing means WAR. The black hole itself cannot be harmed.">🌠 Fire at the Harvester</button>`;
            }
            // firing: pick a target system, then fire
            if (os.charges > 0 && !s.harvest) {
              const sysTgts = SPACE_SYSTEMS.filter(sy => systemRevealed(sy.id) && !((G.space.systems[sy.id] || {}).nova));
              if (sysTgts.length) {
                html += `<div class="dim small">Select a target solar system — one charge erases it completely:</div><div class="sp-list">` +
                  sysTgts.map(sy => `<button class="chip ${s.omniTarget === sy.id ? "active" : ""}" data-omni="${sy.id}"
                    title="Target the ${esc(sy.n)} system for the Omni-Hypercharged Orbital Laser Strike.">💥 ${esc(sy.n)}</button>`).join("") + `</div>`;
              }
              if (s.omniTarget && systemDef(s.omniTarget) && !((G.space.systems[s.omniTarget] || {}).nova)) {
                html += `<button class="btn small danger ${os.ready ? "" : "off"}" id="sp-omni"
                  title="Fire the Omni-Hypercharged Orbital Laser Strike at the ${esc(systemDef(s.omniTarget).n)} system — its star, planets, colonies and megastructures will be destroyed forever, and the oversized blast endangers everything nearby.">💥 FIRE at ${esc(systemDef(s.omniTarget).n).toUpperCase()}</button>`;
              }
            }
          }
          // enemy Dyson Spheres in reach
          for (const sys of SPACE_SYSTEMS) {
            const dy = dysonOfSystem(sys.id);
            if (!dy || dy.stage < 1 || dy.owner === G.playerId || !systemRevealed(sys.id)) continue;
            const dName = G.countries[dy.owner] ? G.countries[dy.owner].name : "?";
            const nearStar = (s.x - sys.x) ** 2 + (s.z - sys.z) ** 2 < 600 * 600;
            html += `<button class="btn small danger ${nearStar && ls.ready ? "" : ""}" data-sddyson="${sys.id}"
              title="${nearStar ? `Fire the core cannon at ${dName}'s Dyson Sphere (declares war). A Giant Shield absorbs the beam first.` : `The ship must first close on the ${sys.n} star — this orders the approach, then fire when ready.`}">☀ ${nearStar ? "DESTROY" : "Move on"} ${esc(dName)}'s Dyson Sphere</button>`;
          }
          // enemy Void Shield generators in reach (AI Update §13/§16)
          for (const sys of SPACE_SYSTEMS) {
            const vsE = voidShieldAt(sys.id);
            if (!vsE || vsE.building || vsE.hp <= 0 || Number(vsE.owner) === G.playerId || !systemRevealed(sys.id)) continue;
            const vName = G.countries[vsE.owner] ? G.countries[vsE.owner].name : "?";
            const nearBar = (s.x - sys.x) ** 2 + (s.z - sys.z) ** 2 < (voidShieldRadius(sys.id) + 200) ** 2;
            html += `<button class="btn small danger" data-sdvshield="${sys.id}"
              title="${nearBar ? `Hammer ${vName}'s Void Shield generator with the core cannon (${SD_LASER.money}💰 ${SD_LASER.mat}⛏ ${SD_LASER.energy}⚡ — declares war). Massive damage; several strikes to collapse it.` : `The ship must first close on the ${sys.n} barrier — this orders the approach.`}">🌐 ${nearBar ? "STRIKE" : "Move on"} ${esc(vName)}'s Void Shield</button>`;
          }
        }
      }
      // ---- Sandbox Improvement §8: instant ship deletion ----
      if (G.sandbox) {
        html += `<div class="diplo-actions"><button class="btn small danger" id="sbx-del-ship" title="Instantly delete this spacecraft — any owner, no combat, no wreck.">💥 Delete ${esc(u.n)}</button></div>`;
      }
    }
  } else {
    html += `<div class="hint small">Click the star, a planet or a ship to inspect it.<br><br>
      🪐 Colonies feed money, materials, energy and research back to your nation every tick.<br>
      ⭕ Halo Rings and ☀ the Dyson Sphere await in the Megastructure Era.</div>`;
  }
  el.innerHTML = html;
  // wire the buttons
  const wire = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = ev => { ev.stopPropagation(); fn(); }; };
  const NI = (fn, args, cb) => typeof netIntercept === "function" && netIntercept(fn, args, cb);
  wire("sp-exit", () => exitSpace());
  wire("sp-dyson", () => {
    // Final Space Fixes §2: the button funds the sphere of the SELECTED star
    const sysD = spaceSel && spaceSel.kind === "star" ? (spaceSel.sys || "home") : "home";
    if (NI("dyson", { sys: sysD })) return;
    if (payDysonStage(G.playerId, sysD)) { sfx("coin"); renderTopbar(); } spacePanelDirty = true;
  });
  wire("sp-colonize", () => {
    const pid2 = spaceSel.kind === "planet" ? spaceSel.id : (() => { const s = spaceSel2Ship(); const near = s && shipNearestPlanet(s); return near && near.id; })();
    if (pid2 && NI("colonize", { planet: pid2 })) return;
    if (pid2 && colonizePlanet(G.playerId, pid2)) { renderTopbar(); }
    spacePanelDirty = true;
  });
  wire("sp-upg", () => {
    if (NI("colonyUp", { planet: spaceSel.id })) return;
    if (upgradeColony(G.playerId, spaceSel.id)) renderTopbar(); spacePanelDirty = true;
  });
  wire("sp-halo", () => {
    if (NI("halo", { planet: spaceSel.id })) return;
    if (startHalo(G.playerId, spaceSel.id)) { sfx("coin"); renderTopbar(); } spacePanelDirty = true;
  });
  wire("sp-land", () => { const s = spaceSel2Ship(); if (!s) return; if (NI("spaceE", { id: s.id })) return; landShip(s); spacePanelDirty = true; });
  wire("sp-deploy", () => { const s = spaceSel2Ship(); const near = s && shipNearestPlanet(s); if (!s || !near) return; if (NI("spaceDeploy", { id: s.id, planet: near.id })) return; deployCargoToColony(s, near.id); });
  wire("sp-loadg", () => { const s = spaceSel2Ship(); const near = s && shipNearestPlanet(s); if (!s || !near) return; if (NI("spaceLoad", { id: s.id, planet: near.id })) return; loadGarrison(s, near.id); });
  // BUG REPORT §3: both Invade buttons (ship panel and planet panel) run the
  // same confirm-then-land flow through the invasion-entry module
  wire("sp-invade", () => {
    const s = spaceSel2Ship(); const near = s && shipNearestPlanet(s);
    if (!s || !near) return;
    confirmInvasion(near.id);
  });
  wire("sp-invade-p", () => {
    if (spaceSel && spaceSel.kind === "planet") confirmInvasion(spaceSel.id);
  });
  wire("sp-nova", () => {
    const s = spaceSel2Ship(); const near = s && shipNearestPlanet(s);
    if (!s || !near) return;
    const chk = canDestroyPlanet(s, near.id);
    if (!chk.ok) { if (chk.why) toast(chk.why); return; }
    const st = planetState(near.id);
    const shielded = st.shield && st.shield.hp > 0;
    // Part 11: count the ships the shockwave will vaporise — friendlies first
    const blast = planetBlastVictims(s, near.id);
    // Final Alien Update Part 9: firing on an alien CAPITAL ends a civilization
    const capRec = (G.space.aliens || []).find(a => !a.defeated && a.capital === near.id && st.colony && st.colony.owner === a.aid);
    openModal(`<h2>🌠 Destroy ${esc(near.n)}?</h2>
      ${capRec ? `<p class="bad">👁 Destroying this capital planet will defeat the alien civilization and destroy everything near the planet.</p>
      <p class="warn">Conquering it instead would win you its stockpiles — destruction leaves only dust.</p>` : ""}
      <p>Firing costs <b>${SD_LASER.money}💰 ${SD_LASER.mat}⛏ ${SD_LASER.energy}⚡</b> and the cannon needs <b>${SD_LASER.cd} ticks</b> to recharge.</p>
      ${shielded ? `<p class="warn">🛡 A Giant Shield protects this world — the beam will strike the shield first.</p>` : `<p>The planet${st.colony ? ", its colony" : ""} and everything on it will be gone <b>forever</b>.</p>`}
      ${!shielded && blast.friendly ? `<p class="bad">⚠ Warning: ${blast.friendly} friendly spacecraft will be destroyed by the shockwave.</p>` : ""}
      ${!shielded && blast.ships.length ? `<p class="warn">💥 The explosion will vaporise ${blast.ships.length} spacecraft near the planet — friend, foe and neutral alike. Ships far enough away survive.</p>` : ""}
      ${st.colony && st.colony.owner !== G.playerId && !atWar(G.playerId, st.colony.owner) ? `<p class="bad">⚠ You are not at war with ${esc(G.countries[st.colony.owner].name)} — firing means WAR.</p>` : ""}
      <p class="bad">Every nation in the world will turn against you — relations and trust will collapse far beyond a nuclear strike.</p>
      <button class="btn danger" id="nova-yes">Fire the core cannon</button>
      <button class="btn" data-close>Stand down</button>`);
    document.getElementById("nova-yes").onclick = () => {
      closeModal();
      if (NI("nova", { id: s.id, planet: near.id })) return;
      destroyPlanet(s, near.id);
      renderTopbar();
    };
  });
  wire("sp-bombard", () => {
    const s = spaceSel2Ship();
    if (!s || !isSD(s)) return;
    const ls = sdLaserStatus(s);
    if (!ls.ready) { toast(ls.cd > 0 ? `⌛ Recharging — ${ls.cd} ticks left.` : `Firing needs ${SD_LASER.money}💰 ${SD_LASER.mat}⛏ ${SD_LASER.energy}⚡.`); return; }
    openModal(`<h2>🔥 Bombard the Homeworld?</h2>
      <p>The planet cannot be destroyed — but the beam will:</p>
      <p class="bad">· kill EVERY military unit on the surface, including your own<br>
      · burn every building in every city on the planet<br>
      · leave the surface an uninhabitable sea of fire</p>
      <p>No troops can survive there and nothing can be built until a ♻ Rehabilitator restores the world. Cost: <b>${SD_LASER.money}💰 ${SD_LASER.mat}⛏ ${SD_LASER.energy}⚡</b>.</p>
      <button class="btn danger" id="bombard-yes">Fire on the Homeworld</button>
      <button class="btn" data-close>Stand down</button>`);
    document.getElementById("bombard-yes").onclick = () => {
      closeModal();
      if (NI("sdBombard", { id: s.id })) return;
      bombardHomeworld(s);
      renderTopbar();
    };
  });
  wire("sp-rehab", () => {
    if (!spaceSel || spaceSel.kind !== "planet") return;
    if (NI("rehab", { planet: spaceSel.id })) return;
    if (startRehab(G.playerId, spaceSel.id)) { sfx("build"); renderTopbar(); }
    spacePanelDirty = true;
  });
  // Part 12: Hyper Lazer — jump to the map in targeting mode
  wire("sp-hyper", () => {
    const s = spaceSel2Ship();
    if (!s || !isSD(s)) return;
    startHyperTargeting(s.id);
  });
  // Part 14.3: colony industry construction
  document.querySelectorAll("#space-panel [data-colbld]").forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    if (!spaceSel || spaceSel.kind !== "planet") return;
    const bId = b.dataset.colbld;
    if (NI("colonyBld", { planet: spaceSel.id, b: bId })) return;
    if (buildColonyBldg(G.playerId, spaceSel.id, bId)) renderTopbar();
    spacePanelDirty = true;
  });
  wire("sp-capital", () => {
    if (!spaceSel || spaceSel.kind !== "planet") return;
    const def = planetDef(spaceSel.id);
    openModal(`<h2>★ Proclaim ${esc(def.n)} the capital planet?</h2>
      <p>Production on ${esc(def.n)} rises by <b>+${Math.round(CAPITAL_PLANET.bonus * 100)}%</b> (money, materials, energy). The original Homeworld remains important, but it is no longer the economic centre.</p>
      <p class="warn">The move costs ${CAPITAL_PLANET.cost.money}💰 ${CAPITAL_PLANET.cost.mat}⛏, temporarily shakes morale and stability across all your worlds, and cannot be repeated for ${CAPITAL_PLANET.cd} ticks.</p>
      <button class="btn primary" id="cap-yes">Proclaim the capital</button>
      <button class="btn" data-close>Not yet</button>`);
    document.getElementById("cap-yes").onclick = () => {
      closeModal();
      if (NI("capital", { planet: spaceSel.id })) return;
      if (setCapitalPlanet(G.playerId, spaceSel.id)) renderTopbar();
      spacePanelDirty = true;
    };
  });
  const shieldWire = (btnId, kind, idOf, repair) => wire(btnId, () => {
    const id = idOf();
    if (id === null || id === undefined) return;
    if (NI(repair ? "shieldRepair" : "shieldBuild", { kind, id })) return;
    if (repair ? repairShield(G.playerId, kind, id) : buildShield(G.playerId, kind, id)) { sfx("era"); renderTopbar(); }
    spacePanelDirty = true;
  });
  shieldWire("sp-shieldp", "planet", () => spaceSel && spaceSel.kind === "planet" ? spaceSel.id : null, false);
  shieldWire("sp-shieldfixp", "planet", () => spaceSel && spaceSel.kind === "planet" ? spaceSel.id : null, true);
  shieldWire("sp-shield-dyson", "dyson", () => spaceSel && spaceSel.kind === "star" ? (spaceSel.sys || "home") : null, false);
  shieldWire("sp-shieldfix-dyson", "dyson", () => spaceSel && spaceSel.kind === "star" ? (spaceSel.sys || "home") : null, true);
  shieldWire("sp-shield-res", "researcher", () => spaceSel && spaceSel.kind === "researcher" ? spaceSel.id : null, false);
  shieldWire("sp-shieldfix-res", "researcher", () => spaceSel && spaceSel.kind === "researcher" ? spaceSel.id : null, true);
  wire("sp-buildres", () => {
    spacePlacing = spacePlacing === "researcher" ? null : "researcher";
    toast(spacePlacing ? "🌆 Click a spot in a solar system you control — near its star or one of your worlds (Esc cancels)." : "Placement cancelled.");
    spacePanelDirty = true;
  });
  wire("sp-res-up", () => {
    if (NI("researcherUp", { id: spaceSel.id })) return;
    if (upgradeResearcher(G.playerId, spaceSel.id)) renderTopbar();
    spacePanelDirty = true;
  });
  wire("sp-res-locate", () => {
    if (NI("researcherLocate", { id: spaceSel.id })) return;
    if (locateInterstellarLife(G.playerId, spaceSel.id)) renderTopbar();
    spacePanelDirty = true;
  });
  wire("sp-res-repair", () => {
    if (NI("researcherRepair", { id: spaceSel.id })) return;
    if (repairResearcher(G.playerId, spaceSel.id)) renderTopbar();
    spacePanelDirty = true;
  });
  wire("sp-res-revive", () => {
    if (NI("researcherRevive", { id: spaceSel.id })) return;
    if (reviveResearcher(G.playerId, spaceSel.id)) renderTopbar();
    spacePanelDirty = true;
  });
  document.querySelectorAll("#space-panel [data-sddyson]").forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const s = spaceSel2Ship();
    if (!s || !isSD(s)) return;
    const sysId = b.dataset.sddyson;
    const sys = systemDef(sysId);
    const nearStar = (s.x - sys.x) ** 2 + (s.z - sys.z) ** 2 < 600 * 600;
    if (!nearStar) {
      // order the approach (free-move to the star's vicinity)
      const trav = canTravelTo(G.playerId, sys.x, sys.z);
      if (!trav.ok) { toast(trav.why); return; }
      if (NI("shipFree", { id: s.id, x: sys.x + 120, y: 0, z: sys.z + 120 })) { sfx("move"); return; }
      s.free = { x: sys.x + 120, y: 0, z: sys.z + 120 };
      s.target = null; s.orbit = null; s.chase = null;
      toast(`→ Closing on the ${sys.n} star.`);
      sfx("move");
      return;
    }
    const dy = dysonOfSystem(sysId);
    if (!dy) return;
    const dName = G.countries[dy.owner] ? G.countries[dy.owner].name : "?";
    openModal(`<h2>☀ Destroy ${esc(dName)}'s Dyson Sphere?</h2>
      <p>One core-cannon shot will shatter the sphere${dy.shield && dy.shield.hp > 0 ? " — but its 🛡 Giant Shield will absorb the beam first" : ""}, erasing its massive energy production.</p>
      ${!atWar(G.playerId, dy.owner) ? `<p class="bad">⚠ You are not at war with ${esc(dName)} — firing means WAR.</p>` : ""}
      <p>Cost: <b>${SD_LASER.money}💰 ${SD_LASER.mat}⛏ ${SD_LASER.energy}⚡</b> + long recharge.</p>
      <button class="btn danger" id="dyson-yes">Fire</button>
      <button class="btn" data-close>Stand down</button>`);
    document.getElementById("dyson-yes").onclick = () => {
      closeModal();
      if (NI("sdDyson", { id: s.id, sys: sysId })) return;
      attackDyson(s, sysId);
      renderTopbar();
    };
  });
  document.querySelectorAll("#space-panel [data-alien-act]").forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    if (!spaceSel || spaceSel.kind !== "alien") return;
    const act = b.dataset.alienAct;
    const doLocal = () => {
      const r = alienTalk(G.playerId, spaceSel.id, act);
      const out = document.getElementById("sp-alien-reply");
      if (out && r) out.innerHTML = `<div class="${r.ok ? "good" : "warn"}">${esc(r.msg || "")}</div>`;
      if (r && r.sfx) sfx(r.sfx);
      renderTopbar();
      if (act !== "hail") spacePanelDirty = true;
    };
    if (NI("alienTalk", { aid: spaceSel.id, act }, r => {
      const out = document.getElementById("sp-alien-reply");
      if (out && r) out.innerHTML = `<div class="${r.ok ? "good" : "warn"}">${esc(r.msg || "")}</div>`;
    })) return;
    doLocal();
  });
  document.querySelectorAll("#space-panel [data-aliensel]").forEach(b => b.onclick = () => {
    spaceSel = { kind: "alien", id: Number(b.dataset.aliensel) };
    spacePanelDirty = true;
    sfx("click");
  });
  document.querySelectorAll("#space-panel [data-shipsel]").forEach(b => b.onclick = ev => {
    const sid = Number(b.dataset.shipsel);
    if (ev.shiftKey) { // §21: build the fleet straight from the roster
      const i = spaceSelFleet.indexOf(sid);
      if (i >= 0) spaceSelFleet.splice(i, 1);
      else {
        if (!spaceSelFleet.length && spaceSel && spaceSel.kind === "ship" && spaceSel.id !== sid) spaceSelFleet.push(spaceSel.id);
        spaceSelFleet.push(sid);
      }
    }
    spaceSel = { kind: "ship", id: sid };
    spacePanelDirty = true;
    sfx("click");
  });
  // ---- §21: fleet command strip ----
  wire("sp-fleet-all", () => {
    spaceSelFleet = shipsOfNation(G.playerId).map(s => s.id);
    if (spaceSelFleet.length) spaceSel = { kind: "ship", id: spaceSelFleet[0] };
    toast(`⛿ ${spaceSelFleet.length} ships selected as one fleet.`);
    spacePanelDirty = true;
  });
  wire("sp-fleet-stop", () => {
    for (const sid of spaceSelFleet) {
      const s = shipById(sid);
      if (!s || s.owner !== G.playerId) continue;
      if (typeof netIntercept === "function" && netIntercept("shipFree", { id: s.id, x: s.x, y: s.y, z: s.z })) continue;
      s.target = null; s.free = null; s.chase = null; s.dysonTarget = null; s.vsTarget = null;
    }
    toast("🛑 The fleet holds position.");
    spacePanelDirty = true;
  });
  wire("sp-fleet-clear", () => { spaceSelFleet = []; spacePanelDirty = true; });
  // ---- AI Update §13: Void Shield construction & repair ----
  wire("sp-vshield", () => {
    const sysV = spaceSel && spaceSel.kind === "star" ? (spaceSel.sys || "home") : null;
    if (!sysV) return;
    if (NI("vshield", { sys: sysV })) return;
    if (payVoidShield(G.playerId, sysV)) { sfx("build"); renderTopbar(); }
    spacePanelDirty = true;
  });
  wire("sp-vshield-fix", () => {
    const sysV = spaceSel && spaceSel.kind === "star" ? (spaceSel.sys || "home") : null;
    if (!sysV) return;
    if (NI("vshieldFix", { sys: sysV })) return;
    if (repairVoidShield(G.playerId, sysV)) renderTopbar();
    spacePanelDirty = true;
  });
  // SD vs Void Shield generators — approach, then hammer (§13.3/§16)
  document.querySelectorAll("#space-panel [data-sdvshield]").forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const s = spaceSel2Ship();
    if (!s || !isSD(s)) return;
    const sysId = b.dataset.sdvshield;
    const sys = systemDef(sysId);
    const nearBar = (s.x - sys.x) ** 2 + (s.z - sys.z) ** 2 < (voidShieldRadius(sysId) + 200) ** 2;
    if (!nearBar) {
      const trav = canTravelTo(G.playerId, sys.x, sys.z);
      if (!trav.ok) { toast(trav.why); return; }
      const dx = s.x - sys.x, dz = s.z - sys.z;
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      const R = voidShieldRadius(sysId);
      const pt = { x: sys.x + dx / d * (R + 80), y: 0, z: sys.z + dz / d * (R + 80) };
      if (NI("shipFree", { id: s.id, x: pt.x, y: pt.y, z: pt.z })) { sfx("move"); return; }
      s.free = pt; s.target = null; s.orbit = null; s.chase = null;
      toast(`→ Closing on the ${sys.n} barrier.`);
      sfx("move");
      return;
    }
    if (NI("sdVShield", { id: s.id, sys: sysId })) return;
    if (sdStrikeVoidShield(s, sysId)) renderTopbar();
    spacePanelDirty = true;
  });
  // ---- Sandbox Improvement §6-§8: star, planet, ship & structure tools ----
  wire("sbx-reveal-sys", () => {
    const sysV = spaceSel && spaceSel.kind === "star" ? (spaceSel.sys || "home") : null;
    if (!sysV) return;
    revealSystem(sysV);
    log(`🧪 Sandbox: the ${systemDef(sysV).n} system is revealed.`, "sys");
    toast(`🔭 ${systemDef(sysV).n} revealed.`);
    spacePanelDirty = true;
  });
  wire("sbx-alien-add", () => {
    const pSel = document.getElementById("sbx-alien-planet");
    const tSel = document.getElementById("sbx-alien-tier");
    if (!pSel || !tSel) return;
    const r = sandboxAddAlien(pSel.value, Number(tSel.value));
    toast(r.msg);
    if (r.ok) sfx("event");
    spacePanelDirty = true;
  });
  const sbxConfirm = (title, body, fn) => {
    openModal(`<h2>💥 ${title}</h2><p>${body}</p>
      <button class="btn danger" id="sbx-yes">💥 Destroy</button>
      <button class="btn" data-close>Cancel</button>`);
    const y = document.getElementById("sbx-yes");
    if (y) y.onclick = () => { closeModal(); fn(); spacePanelDirty = true; };
  };
  wire("sbx-del-dyson", () => {
    const sysV = spaceSel && spaceSel.kind === "star" ? (spaceSel.sys || "home") : null;
    if (!sysV) return;
    sbxConfirm("Destroy the Dyson Sphere?", "The sphere and its entire energy output are erased instantly.", () => sandboxDestroyDyson(sysV));
  });
  wire("sbx-del-vshield", () => {
    const sysV = spaceSel && spaceSel.kind === "star" ? (spaceSel.sys || "home") : null;
    if (!sysV) return;
    sbxConfirm("Destroy the Void Shield?", "The barrier collapses instantly — alien fleets may enter again.", () => sandboxDestroyVoidShield(sysV));
  });
  wire("sbx-del-colony", () => {
    if (!spaceSel || spaceSel.kind !== "planet") return;
    const pid3 = spaceSel.id;
    sbxConfirm(`Destroy the colony on ${esc(planetDef(pid3).n)}?`, "The colony, its garrison and any Halo Ring are erased. An alien capital falling this way defeats its civilization.", () => sandboxDestroyColony(pid3));
  });
  wire("sbx-del-planet", () => {
    if (!spaceSel || spaceSel.kind !== "planet") return;
    const pid3 = spaceSel.id;
    sbxConfirm(`Destroy ${esc(planetDef(pid3).n)}?`, "The entire planet is deleted — colony, structures and all. This bypasses shields and combat.", () => sandboxDestroyPlanet(pid3));
  });
  wire("sbx-del-ship", () => {
    const s = spaceSel2Ship();
    if (s) sandboxDestroyShip(s);
  });
  wire("sbx-del-res", () => {
    if (!spaceSel || spaceSel.kind !== "researcher") return;
    const rid3 = spaceSel.id;
    sbxConfirm("Destroy the Researcher?", "The megastructure is deleted instantly.", () => sandboxDestroyResearcher(rid3));
  });
  wire("sbx-del-bhh", () => {
    sbxConfirm("Destroy the Black Hole Energy Harvester?", "The Harvester is reduced to ruins instantly. The black hole itself is untouchable.", () => sandboxDestroyHarvester());
  });
  wire("sbx-inspect-alien", () => {
    if (spaceSel && spaceSel.kind === "alien" && typeof showInspect === "function") showInspect(spaceSel.id);
  });
  // Small Update: Harvest Stellar Energy from the sun the ship holds beside
  wire("sp-harvest", () => {
    const s = spaceSel2Ship();
    if (!s || !isSD(s)) return;
    const hereSun = systemAt(s.x, s.z);
    const chk = canHarvestStar(s, hereSun.id);
    if (!chk.ok) { if (chk.why) toast(chk.why); return; }
    if (NI("harvest", { id: s.id, sys: hereSun.id })) return;
    if (startStellarHarvest(s, hereSun.id)) renderTopbar();
  });
  // Small Update: fire the Omni-Hypercharged Orbital Laser Strike (with the
  // §6 warning about the oversized blast and anything friendly inside it)
  wire("sp-omni", () => {
    const s = spaceSel2Ship();
    if (!s || !isSD(s) || !s.omniTarget) return;
    const sysId2 = s.omniTarget;
    const chk = canOmniStrike(s, sysId2);
    if (!chk.ok) { if (chk.why) toast(chk.why); return; }
    const plan = omniBlastPlan(s, sysId2);
    const nIn = plan.inside.length, nOut = plan.outer.length + plan.stations.length;
    const colsHit = SPACE_PLANETS.filter(d => planetSysId(d) === sysId2 && G.space.planets[d.id] &&
      G.space.planets[d.id].colony && !G.space.planets[d.id].destroyed).length;
    openModal(`<h2>💥 Omni-Hypercharged Orbital Laser Strike</h2>
      <p class="bad">Warning: This strike will destroy the target solar system and may damage nearby fleets and structures.</p>
      <p>The <b>${esc(plan.sys.n)}</b> system — its star, every planet${colsHit ? `, ${colsHit} colon${colsHit > 1 ? "ies" : "y"}` : ""} and every megastructure — will be erased <b>forever</b>. A permanent nebula will remain, and debris will rain across the galaxy as a meteor shower.</p>
      ${plan.friendly ? `<p class="bad">⚠ ${plan.friendly} friendly ship${plan.friendly > 1 ? "s" : ""} or structure${plan.friendly > 1 ? "s" : ""} of yours ${plan.friendly > 1 ? "are" : "is"} inside the danger area.</p>` : ""}
      ${nIn ? `<p class="warn">${nIn} spacecraft inside the system will be vaporised outright.</p>` : ""}
      ${nOut ? `<p class="warn">The blast reaches far beyond the system — ${nOut} more ship${nOut > 1 ? "s" : ""}/station${nOut > 1 ? "s" : ""} will be caught in the shockwave.</p>` : ""}
      <p>Cost: <b>1 stellar charge + ${OMNI_LASER.money}💰 ${OMNI_LASER.mat}⛏ ${OMNI_LASER.energy}⚡</b> · cooldown <b>${OMNI_LASER.cd} ticks</b>.</p>
      <p class="bad">The whole galaxy will remember this. Relations and trust will collapse everywhere.</p>
      <button class="btn danger" id="omni-yes">FIRE THE OMNI LASER</button>
      <button class="btn" data-close>Stand down</button>`);
    document.getElementById("omni-yes").onclick = () => {
      closeModal();
      if (NI("omni", { id: s.id, sys: sysId2 })) return;
      if (omniStrike(s, sysId2)) renderTopbar();
    };
  });
  // ---- Update: the galactic core & Phantom Step ----
  wire("sp-bh-stage", () => {
    if (NI("bhStage", {})) return;
    if (startBHStage(G.playerId)) { sfx("build"); renderTopbar(); }
    spacePanelDirty = true;
  });
  wire("sp-bh-resume", () => {
    if (NI("bhResume", {})) return;
    if (resumeBH(G.playerId)) sfx("build");
    spacePanelDirty = true;
  });
  wire("sp-bh-share", () => {
    if (NI("bhShare", {})) return;
    bhToggleShare(G.playerId);
  });
  wire("sp-bh-charge", () => {
    const s = spaceSel2Ship();
    if (!s) return;
    if (NI("bhCharge", { id: s.id })) return;
    if (startBHCharge(s)) renderTopbar();
  });
  wire("sp-bh-strike", () => {
    const s = spaceSel2Ship();
    if (!s) return;
    if (NI("bhStrike", { id: s.id })) return;
    if (sdStrikeHarvester(s)) renderTopbar();
  });
  // Critical Bug-Fix §4: the star-panel "sp-phantom" remote is GONE — the Deep
  // Space Research Station console below is the only activation surface, and it
  // routes through the same NI("phantom") command multiplayer uses
  const phSel = document.getElementById("sp-ph-sys");
  if (phSel) phSel.onchange = () => { phantomSelSys = phSel.value; };
  wire("sp-phantom-st", () => {
    if (!spaceSel || spaceSel.kind !== "researcher") return;
    const sel2 = document.getElementById("sp-ph-sys");
    if (!sel2) { toast("Phantom Step blocked: no eligible system — every candidate is destroyed or already cloaked."); return; }
    const sysId4 = sel2.value || phantomSelSys;
    const sy4 = sysId4 ? systemDef(sysId4) : null;
    if (!sy4) return;
    openModal(`<h2>🌫 Phantom Step</h2>
      <p>The Deep Space Research Station will fold light and signal around the <b>${esc(sy4.n)}</b> system. For <b>${PHANTOM.active} turns</b> no other civilization can see or target its planets, fleets or stations.</p>
      <p class="warn">Fleets that leave the system become visible, war exposes your military, and an enemy Deep Space Research Station can disrupt the field. After shutdown the cloak needs a strict <b>${PHANTOM.cooldown}-turn</b> cooldown.</p>
      <p>Cost: <b>${PHANTOM.cost.money}💰 ${PHANTOM.cost.energy}⚡</b>.</p>
      <button class="btn primary" id="ph-yes">🌫 Activate Phantom Step</button>
      <button class="btn" data-close>Stand down</button>`);
    document.getElementById("ph-yes").onclick = () => {
      closeModal();
      if (NI("phantom", { sys: sysId4 })) return;
      if (activatePhantom(G.playerId, sysId4)) renderTopbar();
    };
  });
  wire("sp-res-deep", () => {
    if (!spaceSel || spaceSel.kind !== "researcher") return;
    if (NI("resDeep", { id: spaceSel.id })) return;
    if (upgradeResearcherDeep(G.playerId, spaceSel.id)) { sfx("build"); renderTopbar(); }
    spacePanelDirty = true;
  });
  wire("sp-res-scan", () => {
    if (!spaceSel || spaceSel.kind !== "researcher") return;
    if (NI("deepScan", { id: spaceSel.id })) return;
    if (deepScanPhantom(G.playerId, spaceSel.id)) renderTopbar();
  });
  // Small Update: pick the Omni Laser's target system (a local aiming choice)
  document.querySelectorAll("#space-panel [data-omni]").forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const s = spaceSel2Ship();
    if (!s || !isSD(s)) return;
    s.omniTarget = b.dataset.omni;
    const sy = systemDef(s.omniTarget);
    toast(`💥 Omni Laser target: the ${sy ? sy.n : "?"} system.`);
    spacePanelDirty = true;
    sfx("click");
  });
  // per-Star-Destroyer target orders (SU2 §10): approach, then fire when near
  document.querySelectorAll("#space-panel [data-sdtarget]").forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const s = spaceSel2Ship();
    if (!s || !isSD(s)) return;
    const pid2 = b.dataset.sdtarget;
    const def = planetDef(pid2);
    if (!def || planetState(pid2).destroyed) return;
    const pos = planetPos(pid2);
    const trav = canTravelTo(G.playerId, pos.x, pos.z);
    if (!trav.ok) { toast(trav.why); return; }
    s.sdTarget = pid2;
    if (NI("shipMove", { id: s.id, planet: pid2 })) { toast(`🎯 Closing on ${def.n}.`); sfx("move"); return; }
    s.target = pid2; s.orbit = null; s.chase = null; s.free = null;
    toast(`🎯 Closing on ${def.n} — fire when in range.`);
    sfx("move");
    spacePanelDirty = true;
  });
  wire("sp-focus", () => { if (spaceCam.follow) spaceStopFollow(); else spaceFocusSel(); });
}
function spaceSel2Ship() { return spaceSel && spaceSel.kind === "ship" ? shipById(spaceSel.id) : null; }

// ============ Final Alien Update Part 8 — the battle WINDOW (view only) ============
// Pure presentation over G.space.battles: the simulation lives in
// tickPlanetBattles. The window auto-opens for battles that involve the player,
// toggles between a small overlay (anchored above the planet in the space view)
// and full screen, and renders a planet-coloured battlefield with advancing
// troops, tracer fire, explosions, spreading fires and rising smoke.
let pbUI = { open: null, mode: "min", seen: {}, lastIds: {}, fx: [], shake: 0, bgCache: {}, wired: false, sndCd: 0 };
function pbWire() {
  if (pbUI.wired) return;
  const md = document.getElementById("pb-mode"), hd = document.getElementById("pb-hide"),
    rt = document.getElementById("pb-retreat"), ch = document.getElementById("pb-chip");
  if (!md || !hd || !rt || !ch) return;
  pbUI.wired = true;
  md.onclick = () => { pbUI.mode = pbUI.mode === "min" ? "full" : "min"; sfx("click"); };
  hd.onclick = () => { pbUI.open = null; sfx("click"); };
  rt.onclick = () => {
    const b = (G.space.battles || []).find(x => x.id === pbUI.open);
    if (!b || b.done || b.att !== G.playerId) return;
    if (typeof netIntercept === "function" && netIntercept("pbRetreat", { planet: b.planet })) { toast("🏳 Retreat ordered."); return; }
    b.ret = 1;
    toast("🏳 Retreat ordered — the landing force falls back to the drop zone.");
  };
  ch.onclick = () => {
    const b = (G.space.battles || []).find(x => !x.done && (x.att === G.playerId || x.def === G.playerId)) || (G.space.battles || [])[0];
    if (b) { pbUI.open = b.id; sfx("click"); }
  };
}
function pbRender() {
  const el = document.getElementById("pbattle");
  // (screen is the game's own string when ui.js is loaded — not window.screen)
  if (!el || !G || !G.space || (typeof screen === "string" && screen !== "game")) { if (el) el.style.display = "none"; return; }
  pbWire();
  const battles = G.space.battles || [];
  // auto-open battles that involve the player (each battle only forces itself once)
  for (const b2 of battles) {
    if (!pbUI.seen[b2.id] && (b2.att === G.playerId || b2.def === G.playerId)) {
      pbUI.seen[b2.id] = true;
      pbUI.open = b2.id;
      if (pbUI.mode !== "full") pbUI.mode = "min";
    }
  }
  let b = pbUI.open !== null ? battles.find(x => x.id === pbUI.open) : null;
  if (b && b.done && b.endT > 6.5) { pbUI.open = null; b = null; } // linger on the result, then close
  const chip = document.getElementById("pb-chip");
  if (!b) {
    pbUI.open = null;
    el.style.display = "none";
    const any = battles.find(x => !x.done && (x.att === G.playerId || x.def === G.playerId));
    if (chip) {
      chip.style.display = any ? "block" : "none";
      if (any) chip.textContent = `⚔ Battle for ${planetDef(any.planet) ? planetDef(any.planet).n : "?"}`;
    }
    return;
  }
  if (chip) chip.style.display = "none";
  el.style.display = "flex";
  el.classList.toggle("full", pbUI.mode === "full");
  const def = planetDef(b.planet);
  // small mode: hover above the planet while the space view is open, else dock
  if (pbUI.mode === "min") {
    el.style.right = ""; el.style.bottom = "";
    let placed = false;
    if (typeof spaceOpen !== "undefined" && spaceOpen) {
      const vp = document.getElementById("space-vp");
      if (vp && def) {
        const W = vp.clientWidth, H = vp.clientHeight;
        const p = planetPos(b.planet);
        const pr = spaceProject(p.x, p.y, p.z, W, H);
        if (pr.depth > 0) {
          const bw = el.offsetWidth || 460, bh = el.offsetHeight || 330;
          el.style.left = clamp(pr.sx - bw / 2, 8, Math.max(8, W - bw - 8)) + "px";
          el.style.top = clamp(pr.sy - bh - def.r * pr.s - 24, 52, Math.max(52, H - bh - 8)) + "px";
          placed = true;
        }
      }
    }
    if (!placed) {
      el.style.left = "12px";
      el.style.top = Math.max(52, window.innerHeight - (el.offsetHeight || 330) - 90) + "px";
    }
  }
  // header & footer
  const A = G.countries[b.att], D = G.countries[b.def];
  const recD = alienById(b.def);
  const isCap = recD && recD.capital === b.planet;
  const tt = document.getElementById("pb-title");
  if (tt) tt.textContent = `Battle for ${def ? def.n : "?"}${isCap ? " — ALIEN CAPITAL" : ""}: ${A ? A.name : "?"} vs ${D ? D.name : "?"}`;
  const a0 = b.units.filter(u => u.side === 0 && u.hp > 0).length;
  const d1 = b.units.filter(u => u.side === 1 && u.hp > 0).length;
  const sc = document.getElementById("pb-score");
  if (sc) sc.textContent = b.done
    ? (b.winner === b.att ? `🏆 ${A ? A.name : "?"} takes the colony!${isCap ? " The alien civilization has fallen." : ""}`
      : b.winner === b.def ? `🛡 The garrison holds — the invasion is repelled.` : `The battle is over.`)
    : `${A ? A.name : "?"} ⚔ ${a0} vs ${d1} 🛡 ${D ? D.name : "?"} · ${def ? def.type : "?"} terrain${b.ret ? " · 🏳 RETREATING" : ""}`;
  const rt = document.getElementById("pb-retreat");
  if (rt) rt.style.display = !b.done && b.att === G.playerId && !b.ret ? "" : "none";
  // canvas — BUG REPORT §1: the backing store follows the canvas's OWN css box
  // (fixed 320:180 aspect in minimal view, flex-filled in full screen). The old
  // code derived it from el.clientHeight, which the canvas itself was part of —
  // a feedback loop that stretched the minimal window downward forever.
  const cv = document.getElementById("pb-cv");
  if (!cv) return;
  const rc = cv.getBoundingClientRect();
  const wantW = Math.max(160, Math.round(rc.width) || 452);
  const wantH = Math.max(90, Math.round(rc.height) || 254);
  if (cv.width !== wantW || cv.height !== wantH) { cv.width = wantW; cv.height = wantH; }
  pbDraw(b, cv, def, A, D);
}
// seeded per-planet backdrop: sky, sun, hills, ground, cover and the colony
function pbBg(def, W, H) {
  // Update §4: a colony under a dead sun fights in permanent night — dark cold
  // sky, no local sun, stars overhead (part of the seeded, cached backdrop)
  const dead = def && typeof sunDead === "function" && sunDead(planetSysId(def));
  const key = (def ? def.id : "x") + "_" + W + "x" + H + (dead ? "_dark" : "");
  let bg = pbUI.bgCache[key];
  if (bg) return bg;
  const keys = Object.keys(pbUI.bgCache);
  if (keys.length > 6) delete pbUI.bgCache[keys[0]];
  bg = document.createElement("canvas"); bg.width = W; bg.height = H;
  const c2 = bg.getContext("2d");
  const co = def ? def.col : [120, 120, 130], c2o = def ? def.col2 : [70, 70, 80];
  const type = def ? def.type : "rock";
  let seed = 7; for (const ch of (def ? def.id : "x")) seed = (seed * 31 + ch.charCodeAt(0)) % 65521 || 7;
  const rng = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const hor = H * 0.4;
  const LM = dead ? 0.42 : 1; // dead-sun light multiplier: everything colder, darker
  const shade = (c, f) => `rgb(${Math.round(c[0] * f * LM)},${Math.round(c[1] * f * LM)},${Math.round(c[2] * f * LM + (dead ? 10 : 0))})`;
  // sky: the planet's shadow colour deepening to near-black space
  const sky = c2.createLinearGradient(0, 0, 0, hor);
  sky.addColorStop(0, shade(c2o, 0.22));
  sky.addColorStop(1, shade(co, 0.78));
  c2.fillStyle = sky; c2.fillRect(0, 0, W, hor);
  // gas giants get banded skies
  if (type === "gas") {
    for (let i = 0; i < 5; i++) {
      c2.fillStyle = `rgba(${co[0]},${co[1]},${co[2]},${0.08 + 0.07 * (i % 2)})`;
      c2.fillRect(0, hor * (0.1 + i * 0.17), W, hor * 0.07);
    }
  }
  // cold / dark worlds show stars even by day — under a dead sun, everyone does
  if (type === "ice" || type === "dark" || dead) {
    c2.fillStyle = "rgba(235,240,255,.8)";
    for (let i = 0; i < (dead ? 70 : 40); i++) c2.fillRect(rng() * W, rng() * hor * 0.8, rng() < 0.15 ? 2 : 1, 1);
  }
  if (dead) {
    // the corpse of the sun: a barely-visible dark disc with a cooling rim
    const dx = W * (0.16 + rng() * 0.2), dy = hor * 0.3;
    c2.fillStyle = "rgba(30,26,28,.9)";
    c2.beginPath(); c2.arc(dx, dy, Math.max(6, W * 0.03), 0, Math.PI * 2); c2.fill();
    c2.strokeStyle = "rgba(150,70,50,.35)";
    c2.lineWidth = 1.2;
    c2.beginPath(); c2.arc(dx, dy, Math.max(7, W * 0.034), 0, Math.PI * 2); c2.stroke();
  } else {
    // a pale local sun and a moon
    c2.fillStyle = "rgba(255,245,215,.85)";
    c2.beginPath(); c2.arc(W * (0.16 + rng() * 0.2), hor * 0.3, Math.max(6, W * 0.03), 0, Math.PI * 2); c2.fill();
    c2.fillStyle = "rgba(215,220,240,.35)";
    c2.beginPath(); c2.arc(W * (0.6 + rng() * 0.3), hor * (0.2 + rng() * 0.3), Math.max(3, W * 0.014), 0, Math.PI * 2); c2.fill();
  }
  // distant ridges
  for (let L = 0; L < 2; L++) {
    c2.fillStyle = shade(c2o, 0.4 + L * 0.18);
    c2.beginPath(); c2.moveTo(0, hor);
    const amp = (0.06 + L * 0.05) * H, ph = rng() * 9;
    for (let x = 0; x <= W; x += 6) c2.lineTo(x, hor - amp * (0.35 + Math.abs(Math.sin(x * 0.017 + ph)) * 0.65) * (L ? 0.6 : 1));
    c2.lineTo(W, hor); c2.closePath(); c2.fill();
  }
  // ground
  const gr = c2.createLinearGradient(0, hor, 0, H);
  gr.addColorStop(0, shade(co, 0.62));
  gr.addColorStop(1, shade(c2o, 0.34));
  c2.fillStyle = gr; c2.fillRect(0, hor, W, H - hor);
  // mottled terrain patches
  for (let i = 0; i < 42; i++) {
    const f = 0.5 + rng() * 0.35;
    c2.fillStyle = `rgba(${Math.round(co[0] * f)},${Math.round(co[1] * f)},${Math.round(co[2] * f)},.35)`;
    const y = hor + rng() * (H - hor);
    c2.beginPath(); c2.ellipse(rng() * W, y, 6 + rng() * 26, 2 + rng() * 6, 0, 0, Math.PI * 2); c2.fill();
  }
  // lava worlds: glowing cracks; ice worlds: pale sheets
  if (type === "lava") {
    c2.strokeStyle = "rgba(255,140,50,.55)"; c2.lineWidth = 1.4;
    for (let i = 0; i < 7; i++) {
      c2.beginPath();
      let x = rng() * W, y = hor + rng() * (H - hor);
      c2.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (rng() - 0.5) * 40; y += rng() * 14; c2.lineTo(x, y); }
      c2.stroke();
    }
  }
  if (type === "ice") {
    c2.fillStyle = "rgba(235,245,255,.16)";
    for (let i = 0; i < 9; i++) {
      const y = hor + rng() * (H - hor);
      c2.beginPath(); c2.ellipse(rng() * W, y, 20 + rng() * 50, 4 + rng() * 8, 0, 0, Math.PI * 2); c2.fill();
    }
  }
  // scattered cover rocks
  for (let i = 0; i < 15; i++) {
    const x = rng() * W * 0.78, y = hor + 8 + rng() * (H - hor - 14), s = 2 + rng() * 5;
    c2.fillStyle = shade(c2o, 0.55);
    c2.beginPath(); c2.moveTo(x - s, y + s * 0.5); c2.lineTo(x, y - s); c2.lineTo(x + s * 1.2, y + s * 0.5); c2.closePath(); c2.fill();
  }
  // the colony itself: domes, a tower, hab-blocks on the defender's flank
  const bx = W * 0.855;
  c2.fillStyle = "rgba(52,64,84,.95)";
  c2.beginPath(); c2.arc(bx, hor + (H - hor) * 0.35, Math.max(8, W * 0.032), Math.PI, 0); c2.fill();
  c2.beginPath(); c2.arc(bx + W * 0.05, hor + (H - hor) * 0.6, Math.max(6, W * 0.024), Math.PI, 0); c2.fill();
  c2.fillRect(bx + W * 0.085, hor + (H - hor) * 0.22, Math.max(4, W * 0.012), (H - hor) * 0.5);
  c2.fillRect(bx - W * 0.03, hor + (H - hor) * 0.66, Math.max(10, W * 0.05), (H - hor) * 0.16);
  c2.fillStyle = "rgba(255,235,160,.9)";
  for (let i = 0; i < 7; i++) c2.fillRect(bx - W * 0.028 + i * W * 0.011, hor + (H - hor) * (0.7 + (i % 2) * 0.05), 1.5, 1.5);
  pbUI.bgCache[key] = bg;
  return bg;
}
function pbDraw(b, cv, def, A, D) {
  const W = cv.width, H = cv.height;
  const kx = W / PBATTLE.W, ky = H / PBATTLE.H;
  const ctx = cv.getContext("2d");
  const t = warNowSafe();
  // deaths → explosions & screen shake (state-diff so it works for MP clients too)
  const ids = new Map();
  for (const u of b.units) if (u.hp > 0) ids.set(u.id, u);
  const last = pbUI.lastIds[b.id];
  if (last) {
    for (const [id, pos] of last) {
      if (!ids.has(id)) {
        pbUI.fx.push({ x: pos.x, y: pos.y, t0: t, max: 0.75, gone: pos.gone });
        if (!pos.gone) {
          pbUI.shake = Math.min(6, pbUI.shake + 2.2);
          if (pbUI.sndCd <= 0) { sfx("boom"); pbUI.sndCd = 0.3; }
        }
      }
    }
  }
  pbUI.sndCd -= 0.016;
  const cur = new Map();
  for (const [id, u] of ids) cur.set(id, { x: u.x, y: u.y, gone: u.gone });
  pbUI.lastIds[b.id] = cur;
  pbUI.fx = pbUI.fx.filter(f => t - f.t0 < f.max);
  let sx = 0, sy = 0;
  if (pbUI.shake > 0) { pbUI.shake = Math.max(0, pbUI.shake - 0.35); sx = rnd(-1, 1) * pbUI.shake; sy = rnd(-1, 1) * pbUI.shake * 0.6; }
  ctx.save();
  ctx.translate(sx, sy);
  ctx.drawImage(pbBg(def, W, H), 0, 0);
  const horY = H * 0.4;
  // ground scorch under every fire
  for (const f of b.fires) {
    ctx.fillStyle = "rgba(20,14,10,.5)";
    ctx.beginPath(); ctx.ellipse(f.x * kx, Math.max(horY + 4, f.y * ky), f.r * kx * 0.9, f.r * ky * 0.34, 0, 0, Math.PI * 2); ctx.fill();
  }
  // units
  const colA = A ? A.flag.bg : [220, 220, 220], colD = D ? D.flag.bg : [255, 130, 130];
  for (const u of b.units) {
    if (u.hp <= 0) continue;
    const px = u.x * kx, py = Math.max(horY + 3, u.y * ky);
    const col = u.side === 0 ? colA : colD;
    if (u.drop > 0) { // descending drop pod with a retro-burn streak
      const f = clamp(u.drop / 1.2, 0, 1);
      const dy = py - f * (py - 6);
      ctx.strokeStyle = "rgba(190,225,255,.5)";
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(px, Math.max(0, dy - 26)); ctx.lineTo(px, dy); ctx.stroke();
      ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      ctx.beginPath(); ctx.arc(px, dy, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,200,110,.9)";
      ctx.beginPath(); ctx.arc(px, dy + 3.4, 1.4 + Math.sin(t * 30 + u.id) * 0.6, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    // nearest living enemy (for aiming & muzzle flashes — pure cosmetics)
    let aim = null, bd = Infinity;
    for (const v of b.units) {
      if (v.hp <= 0 || v.side === u.side) continue;
      const d2 = (v.x - u.x) ** 2 + (v.y - u.y) ** 2;
      if (d2 < bd) { bd = d2; aim = v; }
    }
    const dist = Math.sqrt(bd);
    const dirX = aim ? (aim.x - u.x) / (dist || 1) : (u.side === 0 ? 1 : -1);
    const dirY = aim ? (aim.y - u.y) / (dist || 1) : 0;
    if (u.turret) { // bunker: block, dome and a traversing barrel
      const s3 = Math.max(3.6, 4.6 * kx);
      ctx.fillStyle = "rgba(58,70,90,.95)";
      ctx.fillRect(px - s3, py - s3 * 0.7, s3 * 2, s3 * 0.9);
      ctx.beginPath(); ctx.arc(px, py - s3 * 0.6, s3 * 0.66, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = "rgba(150,170,200,.95)";
      ctx.lineWidth = Math.max(1.2, kx);
      ctx.beginPath(); ctx.moveTo(px, py - s3 * 0.7); ctx.lineTo(px + dirX * s3 * 1.7, py - s3 * 0.7 + dirY * s3 * 1.2); ctx.stroke();
      ctx.fillStyle = `rgba(${colD[0]},${colD[1]},${colD[2]},.9)`;
      ctx.fillRect(px - s3, py - s3 * 1.45, s3 * 0.8, s3 * 0.5);
    } else { // infantry: bobbing capsule body, head, weapon line
      const bob = Math.sin(t * 9 + u.id * 2.1) * (aim && dist > pbStat(u).rng ? 0.9 : 0.2);
      const hS = Math.max(2.6, 3.2 * kx);
      ctx.fillStyle = `rgb(${Math.round(col[0] * 0.8)},${Math.round(col[1] * 0.8)},${Math.round(col[2] * 0.8)})`;
      ctx.fillRect(px - hS * 0.4, py - hS * 1.5 + bob, hS * 0.8, hS * 1.5);
      ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      ctx.beginPath(); ctx.arc(px, py - hS * 1.7 + bob, hS * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(210,220,235,.9)";
      ctx.lineWidth = Math.max(1, kx * 0.8);
      ctx.beginPath(); ctx.moveTo(px, py - hS + bob); ctx.lineTo(px + dirX * hS * 1.5, py - hS + bob + dirY * hS * 1.5); ctx.stroke();
    }
    // muzzle flash & tracer when in range — flickers, not synced, same look everywhere
    if (aim && dist <= pbStat(u).rng * 1.06 && Math.sin(t * (6 + (u.id % 5)) + u.id * 1.7) > 0.55) {
      const ax = aim.x * kx, ay = Math.max(horY + 3, aim.y * ky);
      ctx.strokeStyle = u.side === 0 ? "rgba(255,230,150,.75)" : "rgba(255,170,150,.75)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px + dirX * 4, py - 3 + dirY * 4); ctx.lineTo(ax + rnd(-1.5, 1.5), ay + rnd(-1.5, 1.5)); ctx.stroke();
      ctx.fillStyle = "rgba(255,245,200,.9)";
      ctx.beginPath(); ctx.arc(px + dirX * 4.5, py - 3 + dirY * 4.5, 1.3, 0, Math.PI * 2); ctx.fill();
    }
    // hp pip when hurt
    if (u.hp < u.maxHp * 0.98) {
      const w2 = Math.max(7, 9 * kx);
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillRect(px - w2 / 2, py - 12, w2, 2);
      ctx.fillStyle = u.hp / u.maxHp > 0.45 ? "#5ce0a2" : "#ff9264";
      ctx.fillRect(px - w2 / 2, py - 12, w2 * clamp(u.hp / u.maxHp, 0, 1), 2);
    }
  }
  // fires: licking flames + smoke columns leaning with the wind
  for (const f of b.fires) {
    const px = f.x * kx, py = Math.max(horY + 4, f.y * ky);
    for (let i = 0; i < 3; i++) {
      const fl = 0.5 + 0.5 * Math.sin(t * (5 + f.s * 4 + i * 1.7) + f.x + i);
      ctx.fillStyle = i === 0 ? `rgba(255,120,40,${0.5 + fl * 0.3})` : i === 1 ? `rgba(255,190,80,${0.4 + fl * 0.4})` : `rgba(255,240,160,${0.3 + fl * 0.4})`;
      const fr = f.r * kx * (0.5 - i * 0.13) * (0.7 + fl * 0.5);
      ctx.beginPath();
      ctx.moveTo(px - fr, py);
      ctx.quadraticCurveTo(px - fr * 0.3, py - fr * (1.6 + fl), px + rnd(-0.5, 0.5), py - fr * (2.3 + fl * 0.8));
      ctx.quadraticCurveTo(px + fr * 0.5, py - fr * 1.2, px + fr, py);
      ctx.closePath(); ctx.fill();
    }
    for (let k = 0; k < 3; k++) { // smoke
      const age = ((t * 9 + k * 13 + f.x * 3) % 34);
      const alpha = Math.max(0, 0.34 - age * 0.011) * (0.6 + f.s * 0.4);
      if (alpha <= 0.01) continue;
      ctx.fillStyle = `rgba(70,66,64,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(px + age * 0.5 + Math.sin((age + k * 5) * 0.4) * 2, py - f.r * kx * 1.6 - age, 2 + age * 0.26, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // orbital support beam
  if (b.sup) {
    const bx = b.sup.x * kx, by = Math.max(horY + 3, b.sup.y * ky);
    const g2 = ctx.createLinearGradient(bx, 0, bx, by);
    g2.addColorStop(0, "rgba(140,230,255,.05)");
    g2.addColorStop(1, "rgba(190,245,255,.85)");
    ctx.fillStyle = g2;
    const bw2 = 2.5 + Math.sin(t * 40) * 1.2;
    ctx.fillRect(bx - bw2 / 2, 0, bw2, by);
    ctx.fillStyle = "rgba(220,250,255,.9)";
    ctx.beginPath(); ctx.arc(bx, by, 4 + Math.sin(t * 30) * 1.5, 0, Math.PI * 2); ctx.fill();
  }
  // explosions
  for (const f of pbUI.fx) {
    const age = (t - f.t0) / f.max;
    const px = f.x * kx, py = Math.max(horY + 3, f.y * ky);
    if (f.gone) { // an evacuation streak, not a death
      ctx.strokeStyle = `rgba(190,225,255,${(1 - age) * 0.6})`;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - age * 30); ctx.stroke();
      continue;
    }
    ctx.fillStyle = `rgba(255,${Math.round(190 - age * 120)},60,${(1 - age) * 0.75})`;
    ctx.beginPath(); ctx.arc(px, py, 2 + age * 11, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(255,235,180,${(1 - age) * 0.6})`;
    ctx.beginPath(); ctx.arc(px, py, 3 + age * 15, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
  // heavy-bombardment vignette as the surface burns
  const heat = clamp(b.fires.length / 26, 0, 1);
  if (heat > 0.12) {
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H * 0.85);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, `rgba(120,30,0,${(heat * 0.33).toFixed(3)})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }
  // outcome banner
  if (b.done) {
    ctx.fillStyle = "rgba(4,8,14,.55)";
    ctx.fillRect(0, H * 0.34, W, H * 0.32);
    ctx.textAlign = "center";
    ctx.font = `700 ${Math.max(15, Math.round(W / 22))}px 'Segoe UI', sans-serif`;
    const win = b.winner === b.att;
    const mine = b.att === G.playerId ? win : b.def === G.playerId ? !win : null;
    ctx.fillStyle = mine === null ? "#cfe0f4" : mine ? "#5ce0a2" : "#ff7a8a";
    const recD2 = alienById(b.def);
    ctx.fillText(b.winner === null ? "THE BATTLEFIELD IS GONE"
      : win ? (recD2 && recD2.capital === b.planet ? "ALIEN CAPITAL CONQUERED" : "COLONY CAPTURED")
      : "INVASION REPELLED", W / 2, H * 0.47);
    ctx.font = `12px 'Segoe UI', sans-serif`;
    ctx.fillStyle = "rgba(210,225,245,.85)";
    ctx.fillText(b.winner === null ? "The planet itself was destroyed under the fighting."
      : win ? (recD2 && recD2.capital === b.planet ? "The alien civilization has fallen." : `${A ? A.name : "?"} raises its flag over the colony.`)
      : `${D ? D.name : "?"}'s garrison holds the surface.`, W / 2, H * 0.47 + Math.max(16, H * 0.08));
  }
}

// wire input as soon as the DOM exists
window.addEventListener("DOMContentLoaded", initSpaceInput);
