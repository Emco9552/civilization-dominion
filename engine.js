// ============================================================
// CIVILIZATION: DOMINION — game engine (state, turns, AI)
// Provinces have a fixed home country; p.own = permanent owner,
// p.occ = wartime occupier. Armies are real-time map entities
// living in G.armies (see war.js for the battle simulation).
// ============================================================
"use strict";

let G = null; // global game state

const MODES = {
  standard:  { n:"Standard",  res:1.5,  cost:0.8,  growth:1.25, warCas:0.85, morale:0.7, occup:0.7, spy:1.0, aiWarDelay:24, build:0.7 },
  realistic: { n:"Realistic", res:0.75, cost:1.25, growth:0.9,  warCas:1.25, morale:1.4, occup:1.5, spy:0.9, aiWarDelay:16, build:1.15 },
};

// Realistic Mode runs in real time: the war layer drives one economic tick
// (a full endTurn) every REALTIME_TICK_SECONDS. Standard keeps manual turns.
// Sandbox Improvement §1: SANDBOX is real-time too — there is no End Turn
// button any more; the world advances automatically at a selectable speed.
const REALTIME_TICK_SECONDS = 3;
function isRealtime() { return !!G && (G.mode === "realistic" || !!G.sandbox); }
// seconds per economic tick right now — Sandbox reads its speed control
// (Sandbox Improvement §2), every other real-time game stays at 3 seconds
function realtimeTickSeconds() {
  if (G && G.sandbox) return G.sandbox.tickS || REALTIME_TICK_SECONDS;
  return REALTIME_TICK_SECONDS;
}
// AI pacing constants are written in "turns"; a real-time turn is only 3s,
// so time-based cooldowns get stretched by this factor there.
function warTurnScale() { return isRealtime() ? 3 : 1; }
// sandbox helpers — G.sandbox is null outside Sandbox games
function sandboxOn(k) { return !!(G && G.sandbox && G.sandbox[k]); }
function sbFree(cid) { return sandboxOn("freeCost") && Number(cid) === G.playerId; }

// multiplayer: countries steered by a human (host, or a connected client).
// The AI must leave them alone; everything else treats them like the player.
function isHumanControlled(id) {
  id = Number(id);
  if (G && id === G.playerId) return true;
  return typeof NET !== "undefined" && NET.active && NET.humans && NET.humans.includes(id);
}
// a human player's country while that player is disconnected (QoL §18):
// the caretaker AI defends it but makes no major decisions
function isDisconnectedHuman(id) {
  if (!G || !G.mpPlayers) return false;
  const p = G.mpPlayers.find(q => q.cid === Number(id));
  return !!(p && !p.online);
}
// rebels and aliens are real G.countries entries but have no homeland on the
// 2D map (no MAP_META row) — most strategic systems must skip them
function isSynthetic(c) { return !!(c && (c.rebel || c.alien)); }

const ARMY_HP_MULT = 6; // unit hp -> army entity hp

// fast tech lookup — TECHS.find() in hot paths was a measurable cost
const TECH_BY_ID = {};
for (const t of TECHS) TECH_BY_ID[t.id] = t;
function techById(id) { return TECH_BY_ID[id]; }

const STAT_KEYS = ["int","str","dur","agi","gro","pro","dip","mor","ada"];
// ---------- Humanity Balance Update ----------
// The active Humanity mode. NATIONS keeps the Super-Buffed values; Normal mode
// caps them at runtime so the choice needs no data rewrite and never stacks.
function humanityMode() {
  return (typeof G !== "undefined" && G && G.humanityMode === "normal") ? "normal" : "super";
}
function isHumanSpecies(id) { const N = NATIONS[id]; return !!N && N.sp === "Humans"; } // rebels share the species row
// the species research gift, mode-aware — Normal caps the Humans at +20%
function speciesAbilityResearch(id) {
  const N = NATIONS[id], ab = N && N.ab;
  let r = (ab && ab.research) || 0;
  if (r > 0 && isHumanSpecies(id) && humanityMode() === "normal") r = Math.min(r, HUMANITY_MODES.normal.research);
  return r;
}
function stat(c, k) {
  const v = NATIONS[c.id].st[STAT_KEYS.indexOf(k)];
  if (k === "int" && v > 10 && isHumanSpecies(c.id) && humanityMode() === "normal") return HUMANITY_MODES.normal.int;
  return v;
}
function rnd(a, b) { return a + Math.random() * (b - a); }
function irnd(a, b) { return Math.floor(rnd(a, b + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

// ---------- war morale (AI Improvements Part 1) ----------
// A separate wartime spirit: 50 is neutral, rallies push it up, defeats and
// long exhaustion pull it down. It buffers NORMAL morale during wars so a war
// no longer drains morale straight into revolution territory.
function inAnyWar(cid) { return G.wars.some(w => w.a === Number(cid) || w.b === Number(cid)); }
function warMoraleOf(c) { return c.warMorale === undefined ? 50 : c.warMorale; }
function bumpWarMorale(c, d) {
  if (!c || isSynthetic(c)) return;
  c.warMorale = clamp(warMoraleOf(c) + d, 0, 100);
}
// morale figure used by combat & army strength: blends both while at war
function combatMorale(c) {
  return inAnyWar(c.id) ? c.morale * 0.6 + warMoraleOf(c) * 0.4 : c.morale;
}
function sfx(name) { if (typeof S !== "undefined") S.play(name); }

// ---------- name generation ----------
const SYL_END = ["a","ia","or","en","um","eth","ar","is","on","und","el","ath"];
function genName(seedStr, salt) {
  const base = NATIONS[seedStr] ? NATIONS[seedStr].sp : String(seedStr);
  let h = salt * 2654435761 % 4294967296;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) % 4294967296;
  const cons = "brdkstvlmnghz", vow = "aeiou";
  let n = "";
  const len = 2 + (h % 2);
  for (let i = 0; i < len; i++) {
    n += cons[(h = h * 48271 % 2147483647) % cons.length];
    n += vow[(h = h * 48271 % 2147483647) % vow.length];
  }
  n = n[0].toUpperCase() + n.slice(1);
  return n + SYL_END[h % SYL_END.length];
}

// ---------- game creation ----------
// Humanity Balance Update: the start-flow UI (single-player choice, host after
// the multiplayer vote) parks the decided mode here; initGame consumes it.
let PENDING_HUMANITY_MODE = null;
function provCount(area) { return clamp(2 + Math.floor(area / 12000), 2, 6); }

function makeCountry(meta) {
  const id = meta.id, N = NATIONS[id];
  const np = provCount(meta.area);
  const provinces = [];
  const terrains = [];
  for (let i = 0; i < np; i++) {
    const r = i / np;
    terrains.push(r < meta.snow ? "snow" : (r < meta.snow + meta.sand ? "sand" : "green"));
  }
  for (let i = 0; i < np; i++) {
    provinces.push({
      name: genName(id, i * 7 + 1), city: genName(id, i * 13 + 5),
      terrain: terrains[i], b: {}, own: id, occ: null, unrest: 0, slots: 6,
      px: 0, py: 0, capBy: 0, capProg: 0, lvl: 1, bq: [], rq: [],
    });
  }
  const dom = meta.snow > 0.4 ? "snow" : (meta.sand > 0.4 ? "sand" : "green");
  return {
    id, name: N.n, leaderName: genName(id, 99), leaderTitle: GOVS[N.gov].title,
    gov: N.gov, lang: NATIONS[id].lg.split(" ")[0], flag: null, capital: 0,
    alive: true, annexedBy: null, vassalOf: null, provinces, homeBiome: dom,
    pop: Math.round((1.5 + meta.area / 14000) * 10) / 10,
    morale: 70, stability: 70, warMorale: 50,
    res: { food: 120, mat: 80, money: 200, energy: 15 },
    researched: {}, researching: null, rp: 0, era: 1,
    policies: { tax: 1, edu: 1, mil: 1, health: 1, trade: 1, consc: 0 },
    personality: N.per, lastWarTurn: -99, warWeariness: 0, govCooldown: 0,
    revealTo: {}, sabotage: 0, customName: false, missiles: {},
    warBias: irnd(0, 14), // desynchronises AI war timing between simulations
    milUp: { spd: 0, dmg: 0, arm: 0 }, milResearching: null, // Military ▸ Upgrades (SU2 §13)
  };
}

// ---------- military upgrades (Space Update 2 Part 13) ----------
// Research-style repeatable improvements. Paying resources starts a level;
// research points finish it — but an era technology in progress always gets
// the research first, so upgrades soak up the surplus of late-game science.
function milUpOf(c) {
  if (!c.milUp) c.milUp = { spd: 0, dmg: 0, arm: 0 };
  return c.milUp;
}
function milSpeedMult(c) { return 1 + milUpOf(c).spd * MIL_UPGRADES.spd.perLvl; }
function milDmgMult(c)   { return 1 + milUpOf(c).dmg * MIL_UPGRADES.dmg.perLvl; }
function milArmMult(c)   { return 1 + milUpOf(c).arm * MIL_UPGRADES.arm.perLvl; }
function startMilUpgrade(cid, key, silent) {
  const c = G.countries[cid];
  if (!c || !MIL_UPGRADES[key]) return { ok: false, msg: "Unknown upgrade." };
  const up = milUpOf(c);
  if (c.milResearching) return { ok: false, msg: `${MIL_UPGRADES[c.milResearching.k].n} is already being researched.` };
  if (up[key] >= MIL_UP_MAX_LVL) return { ok: false, msg: "That upgrade is at its maximum level." };
  const free = sbFree(cid);
  const cost = MIL_UP_COST(up[key]);
  if (!free && (c.res.money < cost.money || c.res.mat < cost.mat)) {
    return { ok: false, msg: `Level ${up[key] + 1} needs ${cost.money}💰 ${cost.mat}⛏ up front.` };
  }
  if (!free) { c.res.money -= cost.money; c.res.mat -= cost.mat; }
  c.milResearching = { k: key, rp: 0, need: cost.rp };
  if (Number(cid) === G.playerId && !silent) log(`${MIL_UPGRADES[key].icon} ${MIL_UPGRADES[key].n} level ${up[key] + 1} research begins.`, "sys");
  return { ok: true, msg: `${MIL_UPGRADES[key].n} level ${up[key] + 1} research begins.` };
}
// pour research points into the running upgrade; completes levels as needed
function feedMilUpgrade(c, rp) {
  const m = c.milResearching;
  if (!m || rp <= 0) return;
  m.rp += rp;
  if (m.rp < m.need) return;
  const up = milUpOf(c);
  up[m.k] = Math.min(MIL_UP_MAX_LVL, (up[m.k] || 0) + 1);
  const U = MIL_UPGRADES[m.k];
  c.milResearching = null;
  bumpMods(); // damage/armour bonuses live in mods()
  if (c.id === G.playerId) {
    log(`${U.icon} ${U.n} reaches level ${up[m.k]} — ${U.d}`, "good");
    sfx("research");
    if (typeof renderTopbar === "function") renderTopbar();
  }
}

function initGame(mode, playerId) {
  const sandbox = mode === "sandbox";
  if (sandbox) mode = "standard"; // sandbox plays on Standard rules + cheats
  G = {
    mode, playerId, turn: 1, year: 1,
    countries: {}, wars: [], rel: {}, trust: {},
    alliances: [], vassals: {}, trades: [], accessPacts: [], researchPacts: [],
    promises: [], log: [], victory: null, defeated: false,
    eventPending: null, talkedThisTurn: {},
    // Humanity Balance Update: "super" (11/10, +30%) or "normal" (10/10, +20%)
    humanityMode: PENDING_HUMANITY_MODE === "normal" ? "normal" : "super",
    armies: [], armySeq: 1,
    // Sandbox Improvement: tickS = seconds per tick (§2), noEvents/autoEvents =
    // event control (§11), noCd = Disable Cooldowns (§4), aiOff = pause AI (§10)
    sandbox: sandbox ? { money: 1, research: 1, build: 1, freeCost: 1, noAIWars: 1, vision: 0,
      tickS: 3, noEvents: 0, autoEvents: 0, noCd: 0, aiOff: 0 } : null,
  };
  for (const meta of MAP_META.countries) {
    G.countries[meta.id] = makeCountry(meta);
    G.countries[meta.id].flag = { bg: tintColor(meta.id), glyph: FLAG_GLYPHS[meta.id % FLAG_GLYPHS.length] };
  }
  for (const a of Object.keys(G.countries)) {
    G.rel[a] = {}; G.trust[a] = {};
    for (const b of Object.keys(G.countries)) if (a !== b) { G.rel[a][b] = 0; G.trust[a][b] = 30; }
  }
  for (const meta of MAP_META.countries) {
    for (const nb of meta.neighbors) {
      G.rel[meta.id][nb] = -5;
      if (NATIONS[meta.id].per === "aggressive") G.rel[nb][meta.id] -= 15;
    }
  }
  PENDING_HUMANITY_MODE = null; // consumed — the next game chooses afresh
  if (typeof ensureSpaceState === "function") ensureSpaceState();
  bumpMods();
  log(`${G.countries[playerId].name} awakens. The ${ERAS[1].n} begins.`, "sys");
  if (G.humanityMode === "normal")
    log(`🧬 Humanity plays with the Normal balance — 10/10 Intelligence, +20% research points.`, "sys");
  return G;
}

function metaOf(id) { return MAP_META.countries.find(c => c.id === Number(id)); }

function tintColor(id) {
  const c = metaOf(id).color;
  const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
  const boost = mx - mn < 30 ? 2.2 : 1.6;
  const avg = (c[0] + c[1] + c[2]) / 3;
  const r = clamp(Math.round(avg + (c[0] - avg) * boost + 30), 40, 235);
  const g = clamp(Math.round(avg + (c[1] - avg) * boost + 30), 40, 235);
  const b = clamp(Math.round(avg + (c[2] - avg) * boost + 30), 40, 235);
  return [r, g, b];
}

function controllerOf(id) {
  let c = G.countries[id], guard = 0;
  while (c.annexedBy && guard++ < 10) c = G.countries[c.annexedBy];
  return c.id;
}

function log(text, cls) {
  G.log.push({ t: G.turn, x: text, c: cls || "" });
  if (G.log.length > 300) G.log.shift();
}

// ---------- provinces / ownership ----------
function ctrlOfProv(p) { return p.occ || p.own; }
function allProvs() {
  const out = [];
  for (const cid of Object.keys(G.countries)) {
    const c = G.countries[cid];
    for (let i = 0; i < c.provinces.length; i++) out.push({ p: c.provinces[i], home: c, idx: i });
  }
  return out;
}
// provinces the nation currently draws production from (owned & not occupied by an enemy)
function provsOwned(cid) {
  const out = [];
  for (const e of allProvs()) if (e.p.own === Number(cid) && !e.p.occ) out.push(e.p);
  return out;
}
function provsOfNation(cid) { // all provinces permanently owned, occupied or not
  const out = [];
  for (const e of allProvs()) if (e.p.own === Number(cid)) out.push(e);
  return out;
}
function armiesOf(cid) { return G.armies.filter(a => a.owner === Number(cid)); }

// Occupations and capture claims held by dead (annexed) nations froze cities
// forever — nobody can be at war with a dead country, so tickCapture never let
// anyone take those cities back. Hand them to the annexer while the war goes
// on, otherwise return them to their rightful owner. Runs on every tick, on
// load (heals old saves) and after every conquest.
function sweepStaleOccupations() {
  let changed = false;
  for (const e of allProvs()) {
    const p = e.p;
    if (p.capBy && (!G.countries[p.capBy] || !G.countries[p.capBy].alive)) { p.capBy = 0; p.capProg = 0; }
    if (!p.occ) continue;
    const holder = G.countries[p.occ];
    if (holder && holder.alive) continue;
    const heir = holder ? controllerOf(p.occ) : 0; // follows the annexedBy chain
    if (heir && heir !== p.own && G.countries[heir] && G.countries[heir].alive && atWar(heir, p.own)) {
      p.occ = heir; // the annexer inherits the occupation while the war lasts
    } else {
      p.occ = null; p.unrest = 0; // liberated — back under its rightful owner
    }
    p.capBy = 0; p.capProg = 0;
    changed = true;
  }
  if (changed && typeof mapOwnershipChanged === "function") mapOwnershipChanged();
}

// ---------- modifiers ----------
// mods() is extremely hot (combat, visibility, production preview). The result
// only changes when research, government or research pacts change, so it is
// cached per country and invalidated via bumpMods() at those points (and once
// per economic tick as a safety net). The cache lives outside G so saves stay
// clean.
let MODS_VER = 1;
const MODS_CACHE = {};
function bumpMods() { MODS_VER++; }
function mods(c) {
  const hit = MODS_CACHE[c.id];
  if (hit && hit.v === MODS_VER) return hit.m;
  const m = { food:0, mat:0, money:0, energy:0, research:0, prod:0, growth:0, atk:0, def:0,
    fort:0, esp:0, counterEsp:0, stab:0, moraleB:0, navy:0, cheapUnits:0, vision:0, occup:0,
    dipB:0, cas:0, selfCas:0, atkOnly:0, noTerrain:false, moraleR:0, earlyNavy:false };
  for (const tid of Object.keys(c.researched)) {
    const t = TECH_BY_ID[tid]; if (!t) continue;
    for (const k of Object.keys(t.eff)) {
      if (k === "unlockB" || k === "unlockU") continue;
      if (k === "navy") m.navy = Math.max(m.navy, t.eff.navy);
      else if (k === "vision") m.vision = 1;
      else m[k] = (m[k] || 0) + t.eff[k];
    }
  }
  const ab = NATIONS[c.id].ab;
  for (const k of Object.keys(ab)) {
    if (k === "n" || k === "d") continue;
    if (k === "noTerrain" || k === "earlyNavy") m[k] = true;
    else if (k === "fortB") m.fort += ab[k];
    else if (k === "vision") m.vision = 1;
    else if (k === "research") m.research += speciesAbilityResearch(c.id); // Humanity mode caps the gift
    else m[k] = (m[k] || 0) + ab[k];
  }
  if (m.earlyNavy) m.navy = Math.max(m.navy, 1);
  const gv = GOVS[c.gov];
  if (gv.research) m.research += gv.research;
  if (gv.atk) m.atk += gv.atk;
  if (gv.prod) m.prod += gv.prod;
  if (gv.dip) m.dipB += gv.dip * 10;
  if (gv.occup) m.occup += gv.occup;
  for (const p of G.researchPacts) if (p.includes(c.id)) m.research += 0.08;
  // military upgrade levels (Space Update 2 Part 13) — damage & armour stack here
  if (c.milUp) {
    m.atk += (c.milUp.dmg || 0) * MIL_UPGRADES.dmg.perLvl;
    m.def += (c.milUp.arm || 0) * MIL_UPGRADES.arm.perLvl;
  }
  MODS_CACHE[c.id] = { v: MODS_VER, m };
  return m;
}

// Small Humanity Update §3: the species research gift (the Humans' Ingenuity,
// +30%) multiplies EVERY research source exactly once. Map production applies
// it inside mods() → production(); space colonies, Halo Rings and Researcher
// stations apply it at their own source through this helper. Species-bound:
// it follows the nation, not the controller — AI or multiplayer humans alike.
function speciesResearchMult(c) {
  return 1 + speciesAbilityResearch(c.id); // Humanity Balance Update: mode-aware
}

function techUnlocked(c, t) {
  if (t.e > c.era) return false;
  return t.req.every(r => c.researched[r]);
}
function bldgAvailable(c, bId) {
  const b = BLDGS[bId];
  return !b.tech || c.researched[b.tech];
}
function unitAvailable(c, uId) {
  const u = UNITS[uId];
  if (u.e > c.era) return false;
  return !u.tech || c.researched[u.tech];
}
function eraProgress(c, e) {
  const all = TECHS.filter(t => t.e === e);
  const done = all.filter(t => c.researched[t.id]).length;
  return { done, total: all.length, pct: Math.round(100 * done / all.length) };
}

// ---------- economy ----------
function countBldg(c, bId) {
  let n = 0;
  for (const p of provsOwned(c.id)) n += p.b[bId] || 0;
  return n;
}

function biomeMult(c, terrain, kind) {
  const table = { green: { food: 1.25, mat: 0.9 }, sand: { food: 0.6, mat: 1.2 }, snow: { food: 0.45, mat: 1.1 } };
  let m = table[terrain][kind];
  if (m < 1) m = 1 - (1 - m) * (1 - stat(c, "ada") / 12);
  return m;
}

function production(c) {
  const M = MODES[G.mode], md = mods(c);
  const taxMult = [0.7, 1, 1.4][c.policies.tax];
  const eduM = [0.85, 1, 1.2][c.policies.edu];
  const eduMoney = [1.10, 1, 0.88][c.policies.edu];
  const healthMoney = [1.08, 1, 0.90][c.policies.health];
  const tradeOpen = c.policies.trade === 1;
  const myProvs = provsOwned(c.id);
  let food = 0, mat = 0, energy = 2, research = 0, money = 0, cityTaxBase = 0;
  for (const p of myProvs) {
    const unrestM = p.unrest > 0 ? 0.5 : 1;
    const lvlM = 1 + 0.08 * ((p.lvl || 1) - 1); // upgraded cities produce more
    food += (4 + (p.b.farm || 0) * 6 * biomeMult(c, p.terrain, "food") + (p.b.port || 0) * 4) * unrestM * lvlM;
    // Part 14: refined material chain — Refinery (bonus beside a Mine),
    // Industrial Plant and Mega Factory scale materials into the late game
    mat += (2 + (p.b.mine || 0) * 5 * biomeMult(c, p.terrain, "mat") + (p.b.factory || 0) * 12 +
            (p.b.refinery || 0) * 9 * ((p.b.mine || 0) > 0 ? 1.25 : 1) +
            (p.b.industrial || 0) * 18 + (p.b.megafactory || 0) * 60) * unrestM * lvlM;
    energy += (p.b.power || 0) * 15;
    research += ((p.b.school || 0) * 2 + (p.b.university || 0) * 6 + (p.b.lab || 0) * 14) * lvlM;
    money += ((p.b.factory || 0) * 8 + (p.b.market || 0) * 6 + (p.b.taxoffice || 0) * 8 + (p.b.tradehub || 0) * 12 +
              (p.b.port || 0) * 10 + (p.b.bank || 0) * 20 + (p.b.commerce || 0) * 32 +
              (p.b.industrial || 0) * 6 + (p.b.megafactory || 0) * 25) * unrestM * lvlM;
    cityTaxBase += 3 + ((p.lvl || 1) - 1) * 2;
  }
  let demand = 0;
  for (const b of Object.keys(BLDG_ENERGY)) demand += countBldg(c, b) * BLDG_ENERGY[b];
  const energyOK = energy >= demand ? 1 : 0.55;
  mat *= energyOK; research = research * energyOK;
  research += 1 + c.pop * 0.30;
  research *= (stat(c, "int") / 5) * (1 + md.research) * eduM * M.res;
  // Small Update §10: the era bonus was 0.35/era — with the raised tech costs it
  // made the late game instant; 0.12 keeps knowledge compounding, gently
  research *= 1 + 0.12 * (c.era - 1);
  food *= (1 + md.food) * M.res * (stat(c, "pro") / 6 + 0.55);
  mat *= (1 + md.mat + md.prod * 0.5) * M.res * (stat(c, "pro") / 6 + 0.55);
  energy = energy * (1 + md.energy) - demand;
  money += (c.pop * (2.0 + c.era * 0.8) + cityTaxBase) * taxMult;
  // road network: connected cities trade a little better as the era advances
  if (c.era >= 2 && myProvs.length > 1) money *= 1 + Math.min(0.06, 0.012 * (myProvs.length - 1)) * (1 + (c.era - 2) * 0.12);
  money *= (1 + md.money) * (tradeOpen ? 1.15 : 0.85) * eduMoney * healthMoney * M.res;
  if (!tradeOpen) mat *= 1.10;
  let tradeMoney = 0;
  for (const t of G.trades) if (t.includes(c.id)) tradeMoney += 15 + c.era * 12;
  money += tradeMoney;
  for (const vid of Object.keys(G.vassals)) {
    if (G.vassals[vid] === c.id) money += production_moneyRaw(G.countries[vid]) * 0.25;
    if (Number(vid) === c.id) money *= 0.75;
  }
  let upkeep = 0;
  for (const a of armiesOf(c.id)) upkeep += UNITS[a.unit].up * (a.stack || 1);
  upkeep *= [0.75, 1, 1.3][c.policies.mil];
  upkeep *= 1 - Math.min(0.4, countBldg(c, "base") * 0.10);
  let bmaint = 0;
  for (const p of myProvs) for (const b of Object.keys(p.b)) bmaint += (BLDG_MAINT[b] || 0.5) * p.b[b];
  money -= upkeep + bmaint;
  if (c.sabotage > 0) { mat *= 0.7; money *= 0.7; }
  // a Star-Destroyer-scorched Homeworld: ruined cities produce almost nothing
  // until a Rehabilitator restores the surface (Space Update Part 2)
  if (typeof homeworldScorched === "function" && homeworldScorched()) {
    food *= 0.1; mat *= 0.1; money *= 0.15; research *= 0.2;
  }
  // BUG REPORT (Critical Bug-Fix Update §5): the Homeworld lives in the home
  // system — when its sun is fully harvested and dies, EVERY planetary output
  // of the whole map economy (money incl. trade, materials, food, research,
  // surplus energy) falls to the Dead Sun Production Multiplier. Applied here,
  // in the real calculation, before resources are credited — Sandbox included.
  if (typeof sunDead === "function" && sunDead("home")) {
    const dsm = typeof DEAD_SUN !== "undefined" ? DEAD_SUN.prodMult : 0.2;
    food *= dsm; mat *= dsm; money *= dsm; research *= dsm; tradeMoney *= dsm;
    if (energy > 0) energy *= dsm; // production shrinks; existing deficits do not
  }
  const moraleM = c.morale < 35 ? 0.75 : (c.morale > 75 ? 1.1 : 1);
  return { food: food * moraleM, mat: mat * moraleM, energy, research, money: money * moraleM,
    upkeep, demand, bmaint, trade: tradeMoney };
}
function production_moneyRaw(c) { return c.pop * (1.2 + c.era * 0.8); }

function foodNeed(c) { return c.pop * 1.05; }

// aggregate army strength (AI decisions, tooltips)
function armyPower(c, defending) {
  const md = mods(c);
  let p = 0;
  for (const a of armiesOf(c.id)) {
    const u = UNITS[a.unit];
    let base = defending ? u.def : u.atk;
    let sp = u.melee ? (0.7 + stat(c, "str") * 0.06) : (0.8 + stat(c, "agi") * 0.025 + (u.e >= 4 ? stat(c, "int") * 0.015 : 0));
    p += base * sp * (a.hp / a.maxHp) * (a.stack || 1);
  }
  const moraleM = 0.65 + combatMorale(c) / 200 + stat(c, "mor") * 0.015;
  p *= moraleM;
  p *= [0.9, 1, 1.15][c.policies.mil];
  p *= 1 + (defending ? md.def : md.atk);
  return p;
}
function fortLevel(c, prov) {
  const md = mods(c);
  return md.fort + (prov ? (prov.b.fortress || 0) + Math.floor(((prov.lvl || 1) - 1) / 2) : 0);
}

function powerEstimate(c) {
  let p = 0;
  for (const a of armiesOf(c.id)) p += (UNITS[a.unit].atk + UNITS[a.unit].def) / 2 * (a.hp / a.maxHp) * (a.stack || 1);
  return Math.round(p);
}

// hard ceiling on standing armies — identical for the player and the AI.
// Prevents the endless AI troop spam that made realistic wars unwinnable and
// keeps long sessions from drowning in thousands of map entities.
function armyCap(c) {
  const cities = provsOwned(c.id).length;
  return clamp(10 + cities * 3 + c.era * 2, 12, 40);
}
function armyCount(cid) {
  let n = armiesOf(cid).length;
  for (const p of provsOwned(cid)) n += (p.rq || []).length;
  return n;
}

// ---------- city management ----------
const CITY_MAX_LVL = 5;
function cityUpgradeCost(p, cid) {
  if (cid !== undefined && sbFree(cid)) return { money: 0, mat: 0 };
  const lvl = p.lvl || 1, M = MODES[G.mode].cost;
  return { money: Math.round(180 * Math.pow(1.9, lvl - 1) * M), mat: Math.round(70 * Math.pow(1.9, lvl - 1) * M) };
}
function upgradeCity(c, p) {
  const lvl = p.lvl || 1;
  if (lvl >= CITY_MAX_LVL) return { ok: false, msg: "City is already at maximum level." };
  const cost = cityUpgradeCost(p, c.id);
  if (c.res.money < cost.money || c.res.mat < cost.mat) return { ok: false, msg: `Needs ${cost.money}💰 and ${cost.mat}⛏.` };
  c.res.money -= cost.money; c.res.mat -= cost.mat;
  p.lvl = lvl + 1;
  p.slots = 6 + (p.lvl - 1) * 2;
  if (c.id === G.playerId) log(`🏗 ${p.city} upgraded to level ${p.lvl} — more slots, housing, production and defence.`, "good");
  return { ok: true };
}

const DEMOLISH_REFUND = 0.35;
function isImportantBldg(bId) { return BLDGS[bId].cost.money >= 240 || bId === "silo" || bId === "abm" || bId === "fortress"; }
function demolishBuilding(c, p, bId) {
  if (!p.b[bId]) return { ok: false, msg: "No such building." };
  p.b[bId]--; if (!p.b[bId]) delete p.b[bId];
  const b = BLDGS[bId];
  const rm = Math.round(b.cost.money * DEMOLISH_REFUND), rmat = Math.round(b.cost.mat * DEMOLISH_REFUND);
  c.res.money += rm; c.res.mat += rmat;
  if (c.id === G.playerId) log(`🧱 ${b.n} demolished in ${p.city} (+${rm}💰 +${rmat}⛏ salvaged).`, "sys");
  return { ok: true, msg: `Demolished. Salvaged ${rm}💰 ${rmat}⛏.` };
}

function renameCity(c, p, name) {
  const cost = Math.round(30 * MODES[G.mode].cost);
  if (c.res.money < cost) return { ok: false, msg: `Needs ${cost}💰.` };
  if (!name || !name.trim()) return { ok: false, msg: "The city needs a name." };
  c.res.money -= cost;
  const old = p.city;
  p.city = name.trim().slice(0, 24);
  log(`✎ ${old} is now known as ${p.city}.`, "sys");
  return { ok: true };
}

// founding new cities — the province shape is drawn by the player (see ui.js)
const PROV_MIN_AREA = 400, PROV_MAX_AREA = 9000, CITY_MIN_DIST = 45;
function foundCityCost() {
  if (sandboxOn("freeCost")) return { money: 0, mat: 0 }; // sandbox: free city founding
  const M = MODES[G.mode].cost;
  return { money: Math.round(500 * M), mat: Math.round(200 * M) };
}
function foundCity(cid, name, cx, cy, strokes) {
  const c = G.countries[cid];
  if (typeof homeworldScorched === "function" && homeworldScorched())
    return { ok: false, msg: "🔥 No city can rise on the burning surface — rehabilitate the planet first." };
  const cost = foundCityCost();
  if (c.res.money < cost.money || c.res.mat < cost.mat) return { ok: false, msg: `Needs ${cost.money}💰 and ${cost.mat}⛏.` };
  c.res.money -= cost.money; c.res.mat -= cost.mat;
  const nm = (name || "New City").trim().slice(0, 24) || "New City";
  c.provinces.push({
    name: nm, city: nm, terrain: c.homeBiome, b: {}, own: Number(cid), occ: null, unrest: 0, slots: 6,
    px: cx, py: cy, capBy: 0, capProg: 0, lvl: 1, drawn: strokes, bq: [], rq: [],
  });
  log(`🏙 ${nm} founded!`, "good");
  if (typeof rebuildCityIndex === "function") rebuildCityIndex();
  if (typeof mapOwnershipChanged === "function") mapOwnershipChanged();
  return { ok: true };
}

// ---------- construction & recruitment queues ----------
// Buildings are no longer instant: they enter the city's build queue (p.bq)
// and gain progress every game tick (End Turn in Standard, every 3s in
// Realistic). Productivity, technology and city level speed construction up.
function usedSlots(p) {
  return Object.keys(p.b).reduce((n, k) => n + p.b[k], 0) + (p.bq ? p.bq.length : 0);
}
function bldgCost(c, bId) {
  if (sbFree(c.id)) return { money: 0, mat: 0 };
  const b = BLDGS[bId], M = MODES[G.mode].cost;
  return { money: Math.round(b.cost.money * M), mat: Math.round(b.cost.mat * M) };
}
function buildTicksNeeded(bId) {
  const b = BLDGS[bId];
  // capped so megaprojects (Space Program) stay long but not absurd
  const base = Math.min(12, 1 + Math.round(b.cost.money / 150 + b.cost.mat / 120));
  return Math.max(1, Math.round(base * (MODES[G.mode].build || 1)));
}
function buildRate(c, p) {
  const md = mods(c);
  return (1 + (md.prod || 0)) * (stat(c, "pro") / 6 + 0.55) * (1 + 0.08 * ((p.lvl || 1) - 1));
}
function buildTicksLeft(c, p, item) {
  return Math.max(1, Math.ceil((item.need - item.done) / Math.max(0.1, buildRate(c, p))));
}
function enqueueBuilding(c, p, bId) {
  if (typeof homeworldScorched === "function" && homeworldScorched())
    return { ok: false, msg: "🔥 The surface burns — construction is impossible until a Rehabilitator restores the planet." };
  if (p.occ) return { ok: false, msg: "Occupied cities cannot build." };
  if (usedSlots(p) >= p.slots) return { ok: false, msg: "No free building slots." };
  const cost = bldgCost(c, bId);
  if (c.res.money < cost.money || c.res.mat < cost.mat) return { ok: false, msg: `Needs ${cost.money}💰 and ${cost.mat}⛏.` };
  c.res.money -= cost.money; c.res.mat -= cost.mat;
  p.bq = p.bq || [];
  if (sandboxOn("build") && Number(c.id) === G.playerId) {
    p.b[bId] = (p.b[bId] || 0) + 1; // sandbox: instant construction
    return { ok: true, msg: `${BLDGS[bId].n} built instantly.` };
  }
  p.bq.push({ b: bId, done: 0, need: buildTicksNeeded(bId) });
  return { ok: true, msg: `${BLDGS[bId].n} under construction.` };
}
function cancelBuilding(c, p, idx) {
  if (!p.bq || !p.bq[idx]) return;
  const it = p.bq.splice(idx, 1)[0];
  const cost = bldgCost(c, it.b);
  c.res.money += cost.money; c.res.mat += cost.mat; // full refund — nothing stood yet
}
function tickBuildQueue(c, p) {
  if (!p.bq || !p.bq.length) return;
  let work = buildRate(c, p);
  while (work > 0 && p.bq.length) {
    const it = p.bq[0];
    it.done += work;
    if (it.done >= it.need) {
      work = it.done - it.need;
      p.b[it.b] = (p.b[it.b] || 0) + 1;
      p.bq.shift();
      if (typeof buildCompleteFx === "function") buildCompleteFx(p); // Part 3 §6
      if (c.id === G.playerId) { log(`🏗 ${BLDGS[it.b].n} completed in ${p.city}.`, "good"); sfx("build"); }
    } else work = 0;
  }
}

// ---------- naval construction rules ----------
// Ships may only be laid down by a coastal city with a completed Port, and
// they launch into open water beside it. The same rules bind player and AI;
// ships already afloat are unaffected.
function cityIsCoastal(prov) {
  return typeof findWaterNear === "function" && !!findWaterNear(prov.px, prov.py, 90);
}
function navalStatus(prov) {
  const coastal = cityIsCoastal(prov);
  const port = (prov.b.port || 0) > 0;
  return { coastal, port, ok: coastal && port };
}
function canBuildShipAt(prov) { return navalStatus(prov).ok; }
// rafts (QoL §13) predate harbours: any coastal city can lash one together;
// every other ship still demands a completed Port
function canBuildUnitAt(prov, uId) {
  const u = UNITS[uId];
  if (!u.naval) return true;
  const st = navalStatus(prov);
  return u.raft ? st.coastal : st.ok;
}
function anyShipyardCity(cid) { return provsOwned(cid).some(p => canBuildShipAt(p)); }
// a clear patch of water beside the city; null while every berth is jammed
function navalSpawnSpot(prov) {
  if (typeof findWaterNear !== "function") return null;
  const w = findWaterNear(prov.px, prov.py, 90);
  if (!w) return null;
  const crowded = (x, y) => {
    let n = 0;
    for (const a of G.armies) {
      if (UNITS[a.unit].naval && (a.x - x) ** 2 + (a.y - y) ** 2 < 14 * 14 && ++n >= 5) return true;
    }
    return false;
  };
  if (!crowded(w.x, w.y)) return w;
  for (let r = 10; r <= 70; r += 12) {
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      const px = Math.round(w.x + Math.cos(ang) * r), py = Math.round(w.y + Math.sin(ang) * r);
      if (px < 2 || py < 2 || px >= MW - 2 || py >= MH - 2) continue;
      if (!isLand(px, py) && !crowded(px, py)) return { x: px, y: py };
    }
  }
  return null;
}

// Units muster over a few ticks in Realistic Mode (instant in Standard).
function recruitTicksNeeded(uId) {
  const u = UNITS[uId];
  if (u.slow) return u.slow; // megaprojects like the Star Destroyer take far longer
  return clamp(1 + Math.round(u.up / 10), 1, 8);
}
function recruitTicksLeft(p, item) {
  const rate = 1 + 0.25 * Math.min(2, (p.b && p.b.base) || 0);
  return Math.max(1, Math.ceil((item.need - item.done) / rate));
}
// pay-first entry point used by the player UI and the AI
function queueRecruit(cid, uId, prov) {
  if (!isRealtime() || (sandboxOn("build") && Number(cid) === G.playerId)) {
    // ships with no clear berth wait in the yard instead of being lost
    if (UNITS[uId].naval && !navalSpawnSpot(prov)) {
      prov.rq = prov.rq || [];
      prov.rq.push({ u: uId, done: 0, need: 1 });
      return null;
    }
    return recruitAt(cid, uId, prov);
  }
  prov.rq = prov.rq || [];
  prov.rq.push({ u: uId, done: 0, need: recruitTicksNeeded(uId) });
  return null;
}
function cancelRecruit(c, p, idx) {
  if (!p.rq || !p.rq[idx]) return;
  const it = p.rq.splice(idx, 1)[0];
  const cost = recruitCost(c, it.u);
  c.res.money += cost.money; c.res.mat += cost.mat;
}
function tickRecruitQueue(c, p) {
  if (!p.rq || !p.rq.length) return;
  const rate = 1 + 0.25 * Math.min(2, p.b.base || 0); // military bases drill faster
  const it = p.rq[0];
  it.done += rate;
  if (it.done >= it.need) {
    // finished ships hold at the slip until a clear stretch of water opens up
    if (UNITS[it.u].naval && !navalSpawnSpot(p)) {
      it.done = it.need;
      if (c.id === G.playerId && !it.waitWarned) {
        it.waitWarned = true;
        log(`⚓ ${UNITS[it.u].n} is ready at ${p.city} but the harbour is blocked — waiting for open water.`, "sys");
      }
      return;
    }
    p.rq.shift();
    const a = recruitAt(c.id, it.u, p);
    if (a && c.id === G.playerId) log(`🎖 ${UNITS[it.u].n} mustered at ${p.city}.`, "good");
    if (!a && c.id === G.playerId) log(`⚠ ${UNITS[it.u].n} could not deploy at ${p.city} (no harbour).`, "bad");
  }
}

// ---------- missiles (stockpile & consequences; flight lives in war.js) ----------
function missileAvailable(c, mId) { return !!c.researched[MISSILE_TYPES[mId].tech]; }
function missileCost(mId, cid) {
  if (cid !== undefined && sbFree(cid)) return { money: 0, mat: 0 };
  const m = MISSILE_TYPES[mId], M = MODES[G.mode].cost;
  return { money: Math.round(m.cost.money * M), mat: Math.round(m.cost.mat * M) };
}
function missileStock(c) { c.missiles = c.missiles || {}; return c.missiles; }
function missileTotal(c) { const s = missileStock(c); return Object.keys(s).reduce((n, k) => n + s[k], 0); }
function buildMissile(c, mId) {
  if (!missileAvailable(c, mId)) return { ok: false, msg: "Technology required." };
  const silos = countBldg(c, "silo");
  if (!silos) return { ok: false, msg: "Requires a Missile Silo in one of your cities." };
  const cap = silos * 3;
  if (missileTotal(c) >= cap) return { ok: false, msg: `Silo storage full (${cap}). Build more silos.` };
  const cost = missileCost(mId, c.id);
  if (c.res.money < cost.money || c.res.mat < cost.mat) return { ok: false, msg: `Needs ${cost.money}💰 and ${cost.mat}⛏.` };
  c.res.money -= cost.money; c.res.mat -= cost.mat;
  c.missiles[mId] = (c.missiles[mId] || 0) + 1;
  if (c.id === G.playerId) log(`${MISSILE_TYPES[mId].icon} ${MISSILE_TYPES[mId].n} constructed.`, "good");
  return { ok: true };
}
function nukeDiplomaticFallout(aId, bId) {
  for (const oid of Object.keys(G.countries)) {
    const o = Number(oid);
    if (o === aId || !G.countries[o].alive) continue;
    G.rel[o][aId] = clamp(G.rel[o][aId] - (o === bId ? 40 : 25), -100, 100);
    G.trust[o][aId] = clamp(G.trust[o][aId] - (o === bId ? 30 : 15), 0, 100);
  }
  const A = G.countries[aId];
  A.stability = clamp(A.stability - 8, 0, 100);
  // BUG REPORT morale fix: the atrocity horrifies the perpetrator's OWN streets
  // too — using a nuke now LOWERS your morale (it used to creep upward, because
  // every army the blast erased was credited as a rallying "battle win")
  A.morale = clamp(A.morale - 6, 0, 100);
  log(`☢ The world recoils in horror at ${A.name}'s nuclear strike.`, "war");
}

// ---------- recruiting ----------
function unitMaxHp(uId) { return UNITS[uId].hp * ARMY_HP_MULT; }

function recruitCost(c, uId) {
  if (sbFree(c.id)) return { money: 0, mat: 0 };
  const u = UNITS[uId], md = mods(c), M = MODES[G.mode];
  let cm = Math.round(u.cost.money * M.cost * (1 - (md.cheapUnits || 0)));
  if (c.policies.consc === 1) cm = Math.round(cm * 0.75);
  const cmat = Math.round((u.cost.mat || 0) * M.cost);
  return { money: cm, mat: cmat };
}

function spawnArmy(cid, uId, x, y) {
  // a Star-Destroyer-scorched Homeworld kills anything that sets foot on it
  // (Space Update Part 2). Sealed spacecraft survive on their launch pads.
  if (typeof homeworldScorched === "function" && homeworldScorched() && !UNITS[uId].space) {
    if (Number(cid) === G.playerId) log(`🔥 ${UNITS[uId].n} perished on the burning surface — the planet must be rehabilitated first.`, "bad");
    if (typeof boomFx !== "undefined") boomFx.push({ x, y, ttl: 0.5, max: 0.5 });
    return null;
  }
  const a = {
    id: G.armySeq++, owner: Number(cid), unit: uId,
    hp: unitMaxHp(uId), maxHp: unitMaxHp(uId),
    x, y, tx: x, ty: y, cd: rnd(0, 1), order: null,
  };
  if (UNITS[uId].cap) a.cargo = [];
  G.armies.push(a);
  return a;
}

// recruit at a province's city (assumes affordability already checked for player)
// naval units launch into clear water beside the port, never onto land
function recruitAt(cid, uId, prov) {
  if (UNITS[uId].naval) {
    const w = navalSpawnSpot(prov);
    if (!w) return null;
    return spawnArmy(cid, uId, w.x, w.y);
  }
  const ang = rnd(0, Math.PI * 2), d = rnd(14, 22);
  return spawnArmy(cid, uId, prov.px + Math.cos(ang) * d, prov.py + Math.sin(ang) * d);
}

// ---------- reach / war ----------
function atWar(a, b) { return G.wars.some(w => (w.a === a && w.b === b) || (w.a === b && w.b === a)); }
function warOf(a, b) { return G.wars.find(w => (w.a === a && w.b === b) || (w.a === b && w.b === a)); }
function allied(a, b) { return G.alliances.some(p => p.includes(a) && p.includes(b)); }
function hasTrade(a, b) { return G.trades.some(p => p.includes(a) && p.includes(b)); }
function hasAccess(a, b) { return G.accessPacts.some(p => p[0] === a && p[1] === b); }
function hasRP(a, b) { return G.researchPacts.some(p => p.includes(a) && p.includes(b)); }

function canReach(a, b) {
  const ma = metaOf(a), mb = metaOf(b), ca = G.countries[a];
  if (!ma || !mb) return false; // rebels & aliens hold no ground on the world map
  if (ma.neighbors.includes(Number(b))) return true;
  const navy = mods(ca).navy;
  if (navy >= 2 && ma.coastal && mb.coastal) return true;
  if (navy >= 1 && ma.coastal && mb.coastal) {
    const d = Math.hypot(ma.cx - mb.cx, ma.cy - mb.cy);
    if (d < 330) return true;
  }
  for (const p of G.accessPacts) {
    if (p[0] === a) {
      const g = metaOf(p[1]);
      if (g.neighbors.includes(Number(b)) && (ma.neighbors.includes(p[1]) || canReachSimple(ma, metaOf(p[1]), navy))) return true;
    }
  }
  return false;
}
function canReachSimple(ma, mb, navy) {
  if (ma.neighbors.includes(mb.id)) return true;
  if (navy >= 1 && ma.coastal && mb.coastal) return Math.hypot(ma.cx - mb.cx, ma.cy - mb.cy) < 330;
  return false;
}

function declareWar(a, b, silent) {
  if (atWar(a, b)) return;
  breakPromiseIf(a, b, "peace");
  G.wars.push({ a, b, start: G.turn });
  G.rel[a][b] = Math.min(G.rel[a][b], -70); G.rel[b][a] = Math.min(G.rel[b][a], -70);
  G.trades = G.trades.filter(p => !(p.includes(a) && p.includes(b)));
  G.researchPacts = G.researchPacts.filter(p => !(p.includes(a) && p.includes(b)));
  G.accessPacts = G.accessPacts.filter(p => !(p.includes(a) && p.includes(b)));
  G.alliances = G.alliances.filter(p => !(p.includes(a) && p.includes(b)));
  bumpMods(); // research pacts may have been dissolved
  G.countries[a].lastWarTurn = G.turn; G.countries[b].lastWarTurn = G.turn;
  // war morale rally (Part 1): citizens close ranks — the defender more so
  bumpWarMorale(G.countries[a], WAR_MORALE.attackBoost);
  bumpWarMorale(G.countries[b], WAR_MORALE.defendBoost);
  if (!silent) log(`⚔ ${G.countries[a].name} declares war on ${G.countries[b].name}!`, "war");
  if (a === G.playerId || b === G.playerId) sfx("warhorn");
  if (typeof netNotifyWar === "function") netNotifyWar(a, b); // targeted player gets a direct notice (QoL §4)
  if (typeof S !== "undefined" && S.music && (a === G.playerId || b === G.playerId)) S.music.check();
  for (const p of G.alliances) {
    if (p.includes(b)) {
      const ally = p[0] === b ? p[1] : p[0];
      if (ally !== a && !atWar(ally, a) && G.countries[ally].alive) {
        G.wars.push({ a: ally, b: a, start: G.turn });
        log(`${G.countries[ally].name} joins the war to defend ${G.countries[b].name}.`, "war");
      }
    }
  }
  for (const pr of G.promises) {
    if (pr.type === "support" && pr.to === b && !pr.done && G.countries[pr.from].alive) pr.trigger = G.turn;
  }
}

function makePeace(a, b, keepOccupied) {
  G.wars = G.wars.filter(w => !((w.a === a && w.b === b) || (w.a === b && w.b === a)));
  const ca = G.countries[a], cb = G.countries[b];
  if (keepOccupied) {
    transferOccupied(a, b); transferOccupied(b, a);
  } else {
    for (const e of allProvs()) {
      const p = e.p;
      if ((p.own === a && p.occ === b) || (p.own === b && p.occ === a)) { p.occ = null; p.unrest = 0; p.capBy = 0; p.capProg = 0; }
    }
  }
  G.rel[a][b] = Math.max(G.rel[a][b], -20); G.rel[b][a] = Math.max(G.rel[b][a], -20);
  ca.warWeariness = Math.max(0, ca.warWeariness - 15); cb.warWeariness = Math.max(0, cb.warWeariness - 15);
  log(`🕊 Peace between ${ca.name} and ${cb.name}.`, "good");
  if (typeof mapOwnershipChanged === "function") mapOwnershipChanged();
  if (typeof S !== "undefined" && S.music && (a === G.playerId || b === G.playerId)) S.music.check();
}
function transferOccupied(winner, loser) {
  const cw = G.countries[winner], cl = G.countries[loser];
  for (const e of allProvs()) {
    const p = e.p;
    if (p.own !== loser || p.occ !== winner) continue;
    // the capital province itself is never signed away in a partial peace
    if (e.home.id === loser && e.idx === cl.capital) continue;
    p.own = winner; p.occ = null; p.capBy = 0; p.capProg = 0;
    p.unrest = Math.round(10 * MODES[G.mode].occup);
    const popMove = cl.pop * 0.15;
    cl.pop = Math.max(0.3, cl.pop - popMove); cw.pop += popMove;
    log(`${cw.name} takes the province of ${p.name} from ${cl.name}.`, "war");
  }
  // if the loser's chosen capital somehow no longer belongs to them, move it home
  const capP = cl.provinces[cl.capital];
  if (!capP || capP.own !== loser) {
    const idx = cl.provinces.findIndex(p => p.own === loser);
    if (idx >= 0) cl.capital = idx;
  }
}

// a nation is broken when its capital falls, or every city it owns is occupied
function checkBroken(defId) {
  const D = G.countries[defId];
  const mine = provsOfNation(defId);
  if (!mine.length) return true;
  const cap = D.provinces[D.capital];
  if (cap && cap.own === Number(defId) && cap.occ) return true;
  return mine.every(e => e.p.occ);
}

// conquest resolution: how = annex | vassal | demand | peace
function resolveConquest(attId, defId, how) {
  const A = G.countries[attId], D = G.countries[defId];
  if (how === "annex") {
    D.alive = false; D.annexedBy = attId;
    delete G.vassals[defId];
    for (const e of provsOfNation(defId)) {
      e.p.own = attId; e.p.occ = null; e.p.capBy = 0; e.p.capProg = 0;
      e.p.unrest = Math.round(12 * MODES[G.mode].occup * (1 - (mods(A).occup || 0)));
    }
    A.pop += D.pop * 0.85; D.pop = 0;
    G.armies = G.armies.filter(a => a.owner !== Number(defId));
    G.wars = G.wars.filter(w => w.a !== defId && w.b !== defId);
    if (typeof spaceAbsorb === "function") spaceAbsorb(Number(defId), Number(attId)); // colonies & ships change hands
    sweepStaleOccupations(); // provinces D was occupying elsewhere must not stay frozen
    for (const oid of Object.keys(G.countries)) {
      if (Number(oid) !== attId && G.countries[oid].alive) G.rel[oid][attId] = clamp(G.rel[oid][attId] - 12, -100, 100);
    }
    log(`🏴 ${A.name} annexes ${D.name}! The world takes note.`, "war");
    sfx("conquest");
  } else if (how === "vassal") {
    G.vassals[defId] = attId;
    makePeace(attId, defId, false);
    G.rel[attId][defId] = 20; G.rel[defId][attId] = -10;
    D.morale = clamp(D.morale - 10, 0, 100);
    log(`⛓ ${D.name} becomes a subject of ${A.name}.`, "war");
  } else if (how === "demand") {
    makePeace(attId, defId, true);
  } else {
    makePeace(attId, defId, false);
  }
  if (typeof mapOwnershipChanged === "function") mapOwnershipChanged();
}

// ---------- research ----------
function startResearch(c, techId) {
  const t = TECHS.find(t => t.id === techId);
  if (!t || c.researched[techId] || !techUnlocked(c, t)) return false;
  if (c.researching !== techId) { c.researching = techId; c.rp = c.rpStored && c.rpStored[techId] || 0; }
  return true;
}
function finishResearch(c, techId) {
  const t = TECH_BY_ID[techId];
  c.researched[techId] = true;
  c.researching = null; c.rp = 0;
  bumpMods();
  if (t.eff.stab) c.stability = clamp(c.stability + t.eff.stab, 0, 100);
  if (t.eff.moraleB) c.morale = clamp(c.morale + t.eff.moraleB, 0, 100);
  if (c.id === G.playerId) { log(`🔬 Research complete: ${t.n}.`, "good"); sfx("research"); }
  if (c.era < ERAS.length - 1) {
    const pr = eraProgress(c, c.era);
    if (pr.pct >= 75) {
      c.era++;
      log(`✨ ${c.name} enters the ${ERAS[c.era].n}!`, c.id === G.playerId ? "good" : "sys");
      eraAdvanced(c);
      if (c.era === 8 && !G.techMilestone) {
        // Small Update §1: reaching the top eras is a MILESTONE, never an ending
        // — in every mode the game continues on into megastructures, space
        // expansion, alien wars and the late-game weapons. Victory comes only
        // from the real conditions in checkVictory (conquest, hegemony, allies).
        G.techMilestone = c.id;
        log(`🔬 Technological Milestone Reached — ${c.name} touches the stars first!`, "sys");
      }
    }
  }
}

// a nation moved up an era: restyle its roads/lights/cities, and celebrate
// if it's the player (the UI shows the era transition — Part 3 §4)
function eraAdvanced(c) {
  if (typeof roadsMarkDirty === "function") roadsMarkDirty();
  if (typeof cityLayerDirty !== "undefined") cityLayerDirty = true;
  if (c.id === G.playerId && typeof queueEraCelebration === "function") queueEraCelebration(c.era);
  if (c.id === G.playerId && typeof S !== "undefined" && S.music) S.music.check(); // era themes (QoL §21)
}

// ---------- espionage ----------
function spy(aId, bId, action) {
  const A = G.countries[aId], B = G.countries[bId];
  const costs = { steal: 250, reveal: 120, sabotage: 200, unrest: 220 };
  const cost = costs[action] * MODES[G.mode].cost;
  if (A.res.money < cost) return { ok: false, msg: "Not enough money." };
  A.res.money -= cost;
  const mdA = mods(A), mdB = mods(B);
  let p = 0.55 + (mdA.esp || 0) - (mdB.counterEsp || 0) + (stat(A, "int") - stat(B, "int")) * 0.02;
  p = clamp(p * MODES[G.mode].spy, 0.15, 0.92);
  const success = Math.random() < p;
  let msg;
  if (success) {
    if (action === "steal") {
      const candidates = TECHS.filter(t => B.researched[t.id] && !A.researched[t.id] && t.e <= A.era + 1);
      if (candidates.length) {
        const t = candidates.sort((x, y) => x.e - y.e)[0];
        A.researched[t.id] = true;
        bumpMods();
        msg = `Agents stole ${t.n} from ${B.name}!`;
        const pr = eraProgress(A, A.era);
        if (A.era < ERAS.length - 1 && pr.pct >= 75) { A.era++; log(`✨ ${A.name} enters the ${ERAS[A.era].n}!`, "good"); eraAdvanced(A); }
      } else msg = `${B.name} has no technology worth stealing.`;
    } else if (action === "reveal") {
      A.revealTo[bId] = 20;
      msg = `Agents mapped ${B.name}'s armies (visible for 20 turns).`;
    } else if (action === "sabotage") {
      B.sabotage = 3;
      msg = `Sabotage! ${B.name}'s production crippled for 3 turns.`;
    } else {
      B.stability = clamp(B.stability - 10, 0, 100); B.morale = clamp(B.morale - 8, 0, 100);
      msg = `Unrest spreads in ${B.name}.`;
    }
    if (aId === G.playerId) log(`🕵 ${msg}`, "good");
  } else {
    const caught = Math.random() < 0.5;
    if (caught) {
      G.rel[bId][aId] = clamp(G.rel[bId][aId] - 15, -100, 100);
      G.trust[bId][aId] = clamp(G.trust[bId][aId] - 10, 0, 100);
      msg = `Mission failed — agents captured! ${B.name} is furious.`;
    } else msg = "Mission failed, but the agents escaped unseen.";
    if (aId === G.playerId) log(`🕵 ${msg}`, "bad");
  }
  return { ok: true, success, msg };
}

// ---------- promises ----------
function addPromise(from, to, type, data, dueIn) {
  G.promises.push({ from, to, type, data: data || {}, due: G.turn + (dueIn || 10), done: false, broken: false });
}
function breakPromiseIf(a, b, type) {
  for (const p of G.promises) {
    if (!p.done && !p.broken && p.from === a && p.to === b && p.type === type) {
      p.broken = true;
      G.trust[b][a] = clamp(G.trust[b][a] - 30, 0, 100);
      G.rel[b][a] = clamp(G.rel[b][a] - 25, -100, 100);
      if (G.mode === "realistic" && a === G.playerId) {
        const c = G.countries[a]; c.stability = clamp(c.stability - 5, 0, 100);
      }
      log(`💔 ${G.countries[a].name} broke a promise (${p.type}) to ${G.countries[b].name}.`, "bad");
    }
  }
}
function checkPromises() {
  for (const p of G.promises) {
    if (p.done || p.broken) continue;
    if (p.type === "aid") {
      if (p.data.paid) { fulfilPromise(p); continue; }
      if (G.turn >= p.due) breakPromiseNow(p);
    } else if (p.type === "peace") {
      if (G.turn >= p.due) fulfilPromise(p);
      else if (atWar(p.from, p.to)) breakPromiseNow(p);
    } else if (p.type === "support") {
      if (p.trigger && G.turn > p.trigger + 2 && !atWarWithEnemiesOf(p.from, p.to)) breakPromiseNow(p);
      else if (G.turn >= p.due) fulfilPromise(p);
    } else if (p.type === "territory") {
      if (G.turn >= p.due) breakPromiseNow(p);
    }
  }
}
function atWarWithEnemiesOf(a, b) {
  return G.wars.some(w => (w.a === a || w.b === a) && G.wars.some(w2 => (w2.a === b || w2.b === b) &&
    ((w.a === a ? w.b : w.a) === (w2.a === b ? w2.b : w2.a))));
}
function fulfilPromise(p) {
  p.done = true;
  G.trust[p.to][p.from] = clamp(G.trust[p.to][p.from] + 15, 0, 100);
  G.rel[p.to][p.from] = clamp(G.rel[p.to][p.from] + 10, -100, 100);
  if (p.from === G.playerId || p.to === G.playerId) log(`🤝 A promise (${p.type}) was kept between ${G.countries[p.from].name} and ${G.countries[p.to].name}.`, "good");
}
function breakPromiseNow(p) {
  p.broken = true;
  G.trust[p.to][p.from] = clamp(G.trust[p.to][p.from] - 30, 0, 100);
  G.rel[p.to][p.from] = clamp(G.rel[p.to][p.from] - 25, -100, 100);
  if (G.mode === "realistic" && p.from === G.playerId) {
    const c = G.countries[p.from]; c.stability = clamp(c.stability - 5, 0, 100);
  }
  log(`💔 ${G.countries[p.from].name} broke a promise (${p.type}) to ${G.countries[p.to].name}.`, "bad");
}

// ---------- diplomacy actions ----------
function diploCost(base) { return Math.round(base * MODES[G.mode].cost); }

function actImprove(a, b) {
  const A = G.countries[a];
  const cost = diploCost(80);
  if (A.res.money < cost) return { ok: false, msg: "Not enough money." };
  A.res.money -= cost;
  const gain = Math.round(6 + stat(A, "dip") * 0.6 + (mods(A).dipB || 0));
  G.rel[b][a] = clamp(G.rel[b][a] + gain, -100, 100);
  G.rel[a][b] = clamp(G.rel[a][b] + Math.round(gain / 2), -100, 100);
  return { ok: true, msg: `Relations with ${G.countries[b].name} improved by ${gain}.` };
}
function aiAccepts(b, a, kind) {
  // a disconnected player's caretaker AI never surrenders, cedes land or
  // submits on their behalf (QoL §18)
  if (isDisconnectedHuman(b) && (kind === "demand" || kind === "vassal" || kind === "surrender_demand")) return false;
  const B = G.countries[b], rel = G.rel[b][a], trust = G.trust[b][a];
  const pa = powerEstimate(G.countries[a]), pb = powerEstimate(B) + 1;
  const ratio = pa / pb;
  const mineB = provsOfNation(b);
  const occFracB = mineB.length ? mineB.filter(e => e.p.occ).length / mineB.length : 1;
  switch (kind) {
    case "trade": return rel >= -10 && !atWar(a, b);
    case "alliance": return rel >= 55 && trust >= 40 && !atWar(a, b);
    case "access": return rel >= 20 && trust >= 30 && !atWar(a, b);
    case "research": return rel >= 35 && !atWar(a, b);
    case "peace": {
      const w = warOf(a, b); if (!w) return false;
      if (w.noPeace && G.turn < w.noPeace) return false; // forced wars refuse early peace (Sandbox §13)
      return B.warWeariness > 20 || occFracB > 0.25 || ratio > 2 || G.turn - w.start > 12;
    }
    case "surrender_demand": {
      const lostB2 = mineB.filter(e => e.p.occ).length;
      return lostB2 > 0 && (B.warWeariness > 25 || ratio > 1.8);
    }
    case "demand": return ratio > 2.5 && B.personality !== "aggressive" && mineB.length > 2;
    case "vassal": return ratio > 3.5 && mineB.length <= 3 && B.warWeariness > 15;
  }
  return false;
}

// ---------- conversations ----------
function converse(kind, targetId, text) {
  const P = G.countries[G.playerId];
  const T = targetId ? G.countries[targetId] : null;
  const s = text.toLowerCase();
  const has = (...words) => words.some(w => s.includes(w));
  const M = G.mode === "realistic";
  const effects = [];
  let reply = "";

  const prod = production(P);
  const hungry = prod.food < foodNeed(P);
  const inWar = G.wars.some(w => w.a === G.playerId || w.b === G.playerId);

  if (kind === "citizen") {
    const moodWord = P.morale > 70 ? "hopeful" : P.morale > 45 ? "weary but steady" : "angry";
    if (has("how", "feel", "life", "morale", "happy")) {
      reply = `We are ${moodWord}, ${P.leaderTitle}. ` +
        (hungry ? "The granaries echo — children go to bed hungry. " : "There is bread on the table. ") +
        (inWar ? "The war takes our sons and daughters. We ask: for what?" : "We are grateful for the peace.") ;
    } else if (has("tax")) {
      reply = P.policies.tax === 2 ? "The taxes crush us, honestly. Every coin goes to your treasury." :
              P.policies.tax === 0 ? "Taxes are light — bless you for it." : "The taxes are bearable, we manage.";
    } else if (has("war", "fight", "enemy")) {
      reply = inWar ? (P.morale > 55 ? "If we must fight, we will fight. Just bring them home after." : "End it, please. We have buried enough.") :
        "May the peace hold. We want harvests, not medals.";
    } else if (has("food", "harvest", "bread")) {
      reply = hungry ? "There is not enough. The market stalls are half empty." : "The harvest was decent this year.";
    } else if (has("promise")) {
      reply = "Words are easy, " + P.leaderTitle + ". We will remember whether you keep them.";
    } else {
      reply = `An honour to speak with you, ${P.leaderTitle}. Ask us of food, taxes, the war — we will answer honestly.`;
    }
    if (M && !G.talkedThisTurn.citizen) {
      G.talkedThisTurn.citizen = true;
      P.morale = clamp(P.morale + 1.5, 0, 100);
      effects.push("+1.5 morale (the people feel heard)");
    }
  } else if (kind === "mayor") {
    const cap = P.provinces[P.capital];
    const nb = Object.keys(cap.b).reduce((n, k) => n + cap.b[k], 0);
    if (has("build", "city", "need")) {
      const want = !cap.b.farm ? "farms" : !cap.b.school ? "a school" : !cap.b.hospital ? "a hospital" : "more housing";
      reply = `${cap.city} grows, but we need ${want}. Fund it and the district will thrive.`;
    } else if (has("defense", "defence", "fort", "army", "safe")) {
      reply = fortLevel(P, cap) > 1 ? "Our walls are strong. The garrison sleeps well." :
        "Between us — our defences are thin. A determined enemy would walk in.";
    } else if (has("people", "mood", "morale", "unrest")) {
      reply = P.stability > 60 ? "The districts are orderly. Complaints, yes; riots, no." :
        "There is grumbling in the market squares. Watch the stability, I beg you.";
    } else if (has("production", "economy", "money")) {
      reply = `The city produces steadily. ${nb} works stand in ${cap.city}. With more energy and factories we could double it.`;
    } else {
      reply = `Welcome to ${cap.city}, ${P.leaderTitle}. Ask about our needs, defences, the people, or production.`;
    }
    if (M && !G.talkedThisTurn.mayor) {
      G.talkedThisTurn.mayor = true;
      P.stability = clamp(P.stability + 1, 0, 100);
      effects.push("+1 stability (local government aligned)");
    }
  } else if (kind === "leader" && T) {
    const rel = G.rel[targetId][G.playerId], trust = G.trust[targetId][G.playerId];
    const tone = rel > 50 ? "warm" : rel > 10 ? "cordial" : rel > -30 ? "cool" : "hostile";
    const lname = `${T.leaderTitle} ${T.leaderName}`;
    const war = atWar(G.playerId, targetId);
    const pRatio = powerEstimate(P) / (powerEstimate(T) + 1);

    if (has("promise")) {
      if (has("peace", "attack")) {
        addPromise(G.playerId, targetId, "peace", {}, 15);
        G.rel[targetId][G.playerId] = clamp(rel + 8, -100, 100);
        reply = `${lname}: A promise of peace, witnessed and recorded. Break it and every court on this world will hear of it.`;
        effects.push("Promise stored: no war for 15 turns (+8 relations)");
      } else if (has("support", "defend", "protect")) {
        addPromise(G.playerId, targetId, "support", {}, 20);
        G.rel[targetId][G.playerId] = clamp(rel + 6, -100, 100);
        reply = `${lname}: If enemies come for us, we will look to your banners. Do not be late.`;
        effects.push("Promise stored: military support (+6 relations)");
      } else if (has("money", "aid", "resource", "gold")) {
        addPromise(G.playerId, targetId, "aid", { amount: 200, paid: false }, 5);
        reply = `${lname}: 200 in coin within five years — we will hold you to it.`;
        effects.push("Promise stored: send 200 money within 5 turns (use Diplomacy → Send Aid)");
      } else {
        reply = `${lname}: Promise what, exactly? Peace? Support? Aid? Speak plainly.`;
      }
    } else if (has("peace", "truce", "ceasefire")) {
      if (!war) reply = `${lname}: We are not at war. Let us keep it so.`;
      else if (aiAccepts(targetId, G.playerId, "peace")) {
        makePeace(G.playerId, targetId, false);
        reply = `${lname}: Enough blood has been spilled. ${T.name} accepts peace.`;
        effects.push("Peace agreed");
      } else reply = `${lname}: You started this — or your armies did. ${T.name} fights on.`;
    } else if (has("trade", "deal", "goods")) {
      if (hasTrade(G.playerId, targetId)) reply = `${lname}: Our merchants already prosper together.`;
      else if (aiAccepts(targetId, G.playerId, "trade")) {
        G.trades.push([G.playerId, targetId]);
        reply = `${lname}: Agreed. Let the caravans roll.`;
        effects.push("Trade agreement signed");
      } else reply = `${lname}: Trade requires trust we do not currently share.`;
    } else if (has("ally", "alliance")) {
      if (allied(G.playerId, targetId)) reply = `${lname}: Our banners already fly together.`;
      else if (aiAccepts(targetId, G.playerId, "alliance")) {
        G.alliances.push([G.playerId, targetId]);
        reply = `${lname}: Then let it be written: our nations stand as one.`;
        effects.push("Alliance formed");
      } else reply = `${lname}: An alliance? ` + (rel < 55 ? "Earn our friendship first." : "Our trust in you is... incomplete.");
    } else if (has("territory", "land", "return", "region")) {
      reply = war ? `${lname}: Territory is settled by treaties — or armies. Offer peace terms and we shall see.` :
        `${lname}: Our borders were drawn in older blood than yours. They stand.`;
    } else if (has("threat", "destroy", "crush", "surrender", "or else")) {
      if (pRatio > 2.5) {
        G.rel[targetId][G.playerId] = clamp(rel - 10, -100, 100);
        T.morale = clamp(T.morale - 3, 0, 100);
        reply = `${lname}: ...Your strength is known to us. Do not mistake caution for fear.`;
        effects.push("They are shaken (−10 relations, their morale −3)");
      } else {
        G.rel[targetId][G.playerId] = clamp(rel - 15, -100, 100);
        reply = `${lname}: Empty words from a lesser power. This conversation is over.`;
        effects.push("−15 relations");
      }
    } else if (has("war")) {
      reply = war ? `${lname}: The war goes as wars go — badly for someone. Offer peace, or stop wasting my time.` :
        `${lname}: There is no war between us. I advise you not to change that.`;
    } else if (has("great", "admire", "respect", "beautiful", "honor", "honour")) {
      G.rel[targetId][G.playerId] = clamp(rel + 3, -100, 100);
      reply = `${lname}: Flattery is a currency we accept in small denominations. (+3 relations)`;
      effects.push("+3 relations");
    } else if (has("hello", "greetings", "hi ")) {
      reply = `${lname}: Greetings, ${P.leaderTitle} of ${P.name}. Our relations are ${tone} (${rel}). Speak your business.`;
    } else {
      reply = `${lname}: (${tone}, trust ${trust}) You may speak of peace, trade, alliances, promises, territory — or make threats, if you feel lucky.`;
    }
  } else {
    reply = "...";
  }
  return { reply, effects };
}

// ---------- customization ----------
function customize(kind, value) {
  const P = G.countries[G.playerId];
  const M = MODES[G.mode].cost;
  const costs = { name: 50, flag: 30, title: 40, lang: 300, gov: 400, capital: 150 };
  const cost = Math.round((costs[kind] || 50) * M);
  if (P.res.money < cost) return { ok: false, msg: `Needs ${cost} money.` };
  P.res.money -= cost;
  if (kind === "name") { P.name = value; P.customName = true; log(`The nation is now known as ${value}.`, "sys"); }
  else if (kind === "flag") { P.flag.glyph = value.glyph; if (value.bg) P.flag.bg = value.bg; }
  else if (kind === "title") P.leaderTitle = value;
  else if (kind === "lang") { P.lang = value; P.morale = clamp(P.morale - 5, 0, 100); log(`Official language changed to ${value}.`, "sys"); }
  else if (kind === "gov") {
    P.gov = value; P.leaderTitle = GOVS[value].title;
    P.stability = clamp(P.stability - 15, 0, 100); P.govCooldown = 10;
    bumpMods();
    log(`Government reformed: ${GOVS[value].n}. Stability shaken.`, "sys");
  }
  else if (kind === "capital") { P.capital = value; log(`Capital moved to ${P.provinces[value].name}.`, "sys"); }
  return { ok: true, msg: "Done." };
}

// ---------- revolutions (QoL update §7) ----------
// When BOTH morale and stability fall below REV_THRESHOLD, each tick risks a
// city rising up: the province is seized by a rebel state (a real, synthetic
// country) defended by units of the newest era the mother nation unlocked.
// The original country must reconquer the province to regain it.
function cityMoraleBonus(c) {
  let m = 0;
  for (const p of provsOwned(c.id)) {
    for (const b of Object.keys(BLDG_MORALE)) m += (p.b[b] || 0) * BLDG_MORALE[b];
  }
  return Math.min(15, m);
}
function makeRebelCountry(origin) {
  let rid = REBEL_BASE_ID;
  while (G.countries[rid]) rid++;
  NATIONS[rid] = NATIONS[origin.id]; // stat()/mods() lookups share the origin species
  const c = {
    id: rid, rebel: true, rebelOf: origin.id,
    name: origin.name + " Rebels", leaderName: genName(origin.id, irnd(100, 999)), leaderTitle: "Insurgent",
    gov: "council", lang: origin.lang, flag: { bg: [205, 62, 48], glyph: "✊" }, capital: 0,
    alive: true, annexedBy: null, vassalOf: null, provinces: [], homeBiome: origin.homeBiome,
    pop: 0.5, morale: 75, stability: 50,
    res: { food: 200, mat: 100, money: 200, energy: 10 },
    researched: Object.assign({}, origin.researched), researching: null, rp: 0, era: origin.era,
    policies: { tax: 1, edu: 1, mil: 1, health: 1, trade: 0, consc: 0 },
    personality: "aggressive", lastWarTurn: G.turn, warWeariness: 0, govCooldown: 0,
    revealTo: {}, sabotage: 0, customName: true, missiles: {}, warBias: 0, revCd: 0,
  };
  G.countries[rid] = c;
  G.rel[rid] = {}; G.trust[rid] = {};
  for (const k of Object.keys(G.countries)) {
    if (Number(k) === rid) continue;
    G.rel[rid][k] = -20; G.trust[rid][k] = 10;
    if (G.rel[k]) G.rel[k][rid] = -20;
    if (G.trust[k]) G.trust[k][rid] = 10;
  }
  return c;
}
function bestRebelUnit(origin) {
  const list = Object.keys(UNITS).filter(u => !UNITS[u].naval && !UNITS[u].space && !UNITS[u].air && unitAvailable(origin, u));
  list.sort((a, b) => (UNITS[b].e - UNITS[a].e) || ((UNITS[b].atk + UNITS[b].def) - (UNITS[a].atk + UNITS[a].def)));
  return list[0] || "club";
}
function startRevolution(c, p) {
  let reb = null;
  for (const k of Object.keys(G.countries)) {
    const r = G.countries[k];
    if (r.rebel && r.rebelOf === c.id && r.alive) { reb = r; break; }
  }
  if (!reb) reb = makeRebelCountry(c);
  reb.era = c.era;
  reb.researched = Object.assign({}, c.researched);
  p.occ = reb.id; p.unrest = 12; p.capBy = 0; p.capProg = 0;
  p.bq = []; p.rq = [];
  if (!atWar(reb.id, Number(p.own))) G.wars.push({ a: reb.id, b: Number(p.own), start: G.turn });
  const u = bestRebelUnit(c);
  const n = 3 + ((p.lvl || 1) > 2 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const a = spawnArmy(reb.id, u, p.px + rnd(-14, 14), p.py + rnd(-14, 14));
    if (a) a.holdAt = { x: p.px, y: p.py }; // rebels defend their province, never march out
  }
  c.revCd = REV_COOLDOWN;
  c.stability = clamp(c.stability - 5, 0, 100);
  log(`✊ REVOLUTION! ${p.city} rises against ${c.name} — rebels of the ${ERAS[c.era].n} seize the province.`, c.id === G.playerId ? "bad" : "war");
  if (c.id === G.playerId) {
    sfx("alarm");
    if (typeof toast === "function") toast(`✊ Revolution in ${p.city}! Reconquer the province to restore order.`);
  }
  if (typeof mapOwnershipChanged === "function") mapOwnershipChanged();
}
function tickRevolutions() {
  for (const cid of Object.keys(G.countries)) {
    const c = G.countries[cid];
    if (!c.alive || isSynthetic(c)) continue;
    if (c.revCd > 0) { c.revCd--; continue; }
    if (c.morale >= REV_THRESHOLD || c.stability >= REV_THRESHOLD) continue;
    // Part 1: war alone is not a revolution. While the nation still rallies
    // behind the war (no deep exhaustion, war morale holding, not starving),
    // the streets stay loyal — only truly broken war efforts revolt.
    if (inAnyWar(c.id)) {
      const desperate = c.warWeariness > 35 || warMoraleOf(c) < 30 || c.morale < 22 || c.res.food <= 0;
      if (!desperate) continue;
    }
    const sev = ((REV_THRESHOLD - c.morale) + (REV_THRESHOLD - c.stability)) / 80; // 0..1
    if (Math.random() > REV_BASE_CHANCE + sev * 0.05) continue;
    const mine = provsOfNation(c.id).filter(e => !e.p.occ && !(e.home.id === Number(cid) && e.idx === c.capital));
    if (!mine.length) continue;
    startRevolution(c, pick(mine).p);
  }
}
// crushed rebellions dissolve; rebellions that lost their armies fade away
function sweepRebels() {
  for (const k of Object.keys(G.countries)) {
    const r = G.countries[k];
    if (!r.rebel || !r.alive) continue;
    const holds = allProvs().some(e => e.p.occ === r.id || e.p.own === r.id);
    const troops = armiesOf(r.id).length;
    if (!holds && !troops) {
      r.alive = false;
      G.wars = G.wars.filter(w => w.a !== r.id && w.b !== r.id);
      log(`✊ The rebellion of ${r.name} collapses.`, "sys");
      if (typeof mapOwnershipChanged === "function") mapOwnershipChanged();
    }
  }
}

// ---------- turn processing ----------
function collectIncome(c) {
  if (c.rebel) return;                       // rebel enclaves live off the land
  if (c.alien) {                             // alien economies are abstracted (space.js)
    if (typeof alienEconTick === "function") alienEconTick(c);
    return;
  }
  const p = production(c);
  c.res.food = clamp(c.res.food + p.food - foodNeed(c), 0, 2000 + c.pop * 50);
  c.res.mat = Math.max(0, c.res.mat + p.mat);
  c.res.money = c.res.money + p.money;
  c.res.energy = Math.max(0, p.energy);
  // space colonies, Dyson Sphere and Halo Rings pay their dividends
  if (typeof colonyIncome === "function") colonyIncome(c);
  const M = MODES[G.mode];
  if (c.researching) {
    c.rp += p.research;
    const t = TECH_BY_ID[c.researching];
    if (t && c.rp >= t.c) finishResearch(c, c.researching);
  } else if (c.milResearching) {
    // no technology queued: the labs work on military upgrades (SU2 §13)
    feedMilUpgrade(c, p.research);
  }
  const hungry = p.food < foodNeed(c) && c.res.food <= 0;
  if (hungry) {
    c.morale = clamp(c.morale - 3 * M.morale, 0, 100);
    c.pop = Math.max(0.3, c.pop * 0.985);
    if (c.id === G.playerId) log("⚠ Famine! The nation starves.", "bad");
  } else {
    let g = 0.015 * (stat(c, "gro") / 5) * M.growth;
    g *= 1 + (mods(c).growth || 0);
    g *= [0.9, 1, 1.15][c.policies.health];
    g += countBldg(c, "hospital") * 0.002;
    if (c.morale < 40) g *= 0.5;
    // Critical Bug-Fix §5: population growth under a dead home sun slows to 20%
    if (typeof sunDead === "function" && sunDead("home")) g *= typeof DEAD_SUN !== "undefined" ? DEAD_SUN.prodMult : 0.2;
    const myp = provsOwned(c.id);
    const lvlCap = myp.reduce((s, p2) => s + ((p2.lvl || 1) - 1) * 0.8, 0);
    const spaceCap = typeof colonyPopCap === "function" ? colonyPopCap(c) : 0;
    const cap = 6 + myp.length * 2.5 + countBldg(c, "house") * 0.6 + c.era * 1.5 + lvlCap + spaceCap;
    c.pop = Math.min(cap, c.pop * (1 + g));
  }
  if (c.res.money < 0) {
    c.morale = clamp(c.morale - (G.mode === "realistic" ? 4 : 2), 0, 100);
    c.stability = clamp(c.stability - (G.mode === "realistic" ? 3 : 1), 0, 100);
    c.res.money = Math.max(c.res.money, -200);
    if (c.id === G.playerId) log("⚠ The treasury is empty — debt erodes morale and stability.", "bad");
  }
  const inWar = inAnyWar(c.id);
  if (inWar) {
    // ---- war morale & exhaustion (AI Improvements Part 1) ----
    // The initial rally fades toward neutral; LONG wars build exhaustion which
    // then eats into war morale; hunger and defeats (killArmy/completeCapture)
    // hit it too. Normal morale only bleeds once the war spirit actually sours,
    // so a fresh war no longer slides straight into revolution.
    if (c.warMorale === undefined) c.warMorale = 50;
    const warsN = G.wars.filter(w => w.a === c.id || w.b === c.id).length;
    c.warWeariness += (0.35 + Math.min(0.45, (warsN - 1) * 0.15)) * M.morale;
    c.warMorale += clamp((50 - c.warMorale) * 0.02, -1.2, 1.2);           // rally fades
    if (c.warWeariness > WAR_MORALE.exhaustStart)
      c.warMorale -= (c.warWeariness - WAR_MORALE.exhaustStart) * 0.025 * M.morale;
    if (hungry) c.warMorale -= 2;                                          // hungry soldiers, angry streets
    if (c.res.energy <= 0 && c.era >= 4) c.warMorale -= 0.4;               // blackouts sap the war effort
    c.warMorale = clamp(c.warMorale, 0, 100);
    const drain = c.warMorale < 45 ? (45 - c.warMorale) * 0.045 : (c.warMorale > 65 ? -0.25 : 0.1);
    c.morale = clamp(c.morale - drain * M.morale, 0, 100);
  } else {
    c.warWeariness = Math.max(0, c.warWeariness - 2);
    // peacetime: the war spirit settles back to neutral
    if (c.warMorale !== undefined && c.warMorale !== 50)
      c.warMorale = Math.abs(c.warMorale - 50) < 1 ? 50 : c.warMorale + (50 - c.warMorale) * 0.15;
    // advanced infrastructure calms the streets (QoL §7): hospitals,
    // universities and similar works raise the morale a nation settles at
    const target = 65 + (mods(c).moraleB || 0) + [4, 0, -6][c.policies.tax] + (GOVS[c.gov].moraleB || 0) + cityMoraleBonus(c);
    c.morale += clamp((target - c.morale) * 0.08, -2, 2) + (mods(c).moraleR || 0) * 0.1;
    c.morale = clamp(c.morale, 0, 100);
  }
  const stabTarget = 60 + (GOVS[c.gov].stab || 0) + (c.morale - 60) * 0.3;
  c.stability = clamp(c.stability + clamp((stabTarget - c.stability) * 0.06, -2, 2), 0, 100);
  if (c.govCooldown > 0) c.govCooldown--;
  if (c.sabotage > 0) c.sabotage--;
  for (const k of Object.keys(c.revealTo)) {
    c.revealTo[k]--; if (c.revealTo[k] <= 0) delete c.revealTo[k];
  }
  for (const p2 of c.provinces) if (p2.unrest > 0) p2.unrest--;
  // construction sites and mustering grounds advance every tick
  for (const p2 of provsOwned(c.id)) { tickBuildQueue(c, p2); tickRecruitQueue(c, p2); }
  // sandbox cheats for the player
  if (c.id === G.playerId && G.sandbox) {
    if (G.sandbox.money) { c.res.food = 99999; c.res.mat = 99999; c.res.money = 999999; c.res.energy = 999; }
    if (G.sandbox.research && c.researching) {
      const t = TECHS.find(t => t.id === c.researching);
      if (t) finishResearch(c, c.researching);
    }
  }
}

// ---------- AI (strategic layer — tactics live in war.js) ----------
// research selection, shared by full AI passes and "thinking" ticks (Part 8)
function aiPickResearch(id, c) {
  if (c.researching) return;
  const per = c.personality;
  const avail = TECHS.filter(t => !c.researched[t.id] && techUnlocked(c, t));
  if (avail.length) {
    const w = { MIL: 1, ECO: 1, EDU: 1, SCI: 1, MED: 0.8, GOV: 0.8, ENE: 1, SPA: 1 };
    if (per === "aggressive") w.MIL = 2.2;
    if (per === "defensive") { w.MIL = 1.6; w.GOV = 1.2; }
    if (per === "scientific") { w.EDU = 2; w.SCI = 2; }
    if (per === "mercantile") w.ECO = 2.2;
    if (per === "expansionist") { w.MIL = 1.6; w.ECO = 1.4; }
    // interplanetary nations chase the space techs that open colonization
    // and warp travel (SU2 §4) — without them the AI never leaves the ground
    if (c.era >= 8 && !c.researched.colonyships) w.SPA = Math.max(w.SPA, 2.6);
    else if (c.era >= 9 && !c.researched.warp) w.SPA = Math.max(w.SPA, 2.0);
    avail.sort((a, b) => (a.c / (w[a.cat] || 1)) - (b.c / (w[b.cat] || 1)));
    c.researching = avail[0].id; c.rp = 0;
  } else if (!c.milResearching && c.era >= 8 && Math.random() < 0.4) {
    // every era researched: the labs turn to military upgrades (SU2 §13)
    const keys = Object.keys(MIL_UPGRADES);
    const up = milUpOf(c);
    keys.sort((a, b) => up[a] - up[b]); // level the lowest track first
    const cost = MIL_UP_COST(up[keys[0]]);
    if (aiSpendableMoney(c) > cost.money * 2 && aiSpendableMat(c) > cost.mat * 1.5) startMilUpgrade(id, keys[0], true);
  }
}

// ============ Old Bugs rewrite — the AI City Development Controller ============
// "Homeland AI does not modernize cities" survived several patch-on-patch
// fixes; this controller replaces them all (the old wish-list chooser, the
// hardcoded AI_OBSOLETE successor map and the random replace/upgrade rolls).
// Principles:
//  · ONE building registry — the AI iterates the same BLDGS + bldgAvailable()
//    the player uses, re-read every pass, so each newly researched structure
//    joins its options the moment the tech completes. Nothing is player-only.
//  · EMPIRICAL pricing — a candidate is valued by temporarily placing it in
//    the city and running the real production(): biome, city level, the
//    refinery-beside-mine synergy, energy-demand cliffs and maintenance all
//    price themselves. No invented upgrade chains, no stale value tables.
//  · A saved PLAN (c.aiPlan, plain data in every save/snapshot) reserves the
//    funds for one expensive project at a time; other spending waits.
//  · Cities are REVIEWED round-robin: a full (or farm-flooded late-era) city
//    may swap its weakest outdated work for a clearly better one — demolition
//    only ever happens with a validated, affordable replacement queued in the
//    same breath.
const AI_DEV = {
  planTimeout: 60,      // drop a plan nobody could afford for this many turns
  minScore: 8,          // below this, building nothing beats building filler
  planScore: 25,        // a project this valuable is worth saving up for
  replaceEdge: 1.6,     // a successor must beat the old work by this factor
  floodFrac: 0.55,      // farm+house+mine share that triggers a modern review
};

// built + queued, nation-wide / in one city — the unique-structure rules count
// construction sites too, so two passes can never order a second Space Program
function countBldgQ(c, bId) {
  let n = 0;
  for (const p of provsOwned(c.id)) n += (p.b[bId] || 0) + (p.bq || []).filter(q => q.b === bId).length;
  return n;
}
function cityBldgQ(p, bId) { return (p.b[bId] || 0) + (p.bq || []).filter(q => q.b === bId).length; }

// copy limits (Old Bugs §8): the Space Program is ONE per civilization; ports,
// silos and missile batteries one per city; fortresses two. An existing copy
// is a completed objective, never a reason to build a duplicate.
function aiCopyAllowed(c, p, bId) {
  if (bId === "spaceprogram") return countBldgQ(c, "spaceprogram") === 0;
  if ((bId === "port" || bId === "silo" || bId === "abm") && cityBldgQ(p, bId) >= 1) return false;
  if (bId === "fortress" && cityBldgQ(p, bId) >= 2) return false;
  if (bId === "abm" && countBldgQ(c, "abm") >= 2) return false;
  if (bId === "silo" && countBldgQ(c, "silo") >= Math.max(1, Math.floor(provsOwned(c.id).length / 3))) return false;
  if (bId === "house" && cityBldgQ(p, "house") >= Math.ceil(p.slots * 0.4)) return false;
  return true;
}
function aiPopCap(c, myp) {
  const lvlCap = myp.reduce((s, p2) => s + ((p2.lvl || 1) - 1) * 0.8, 0);
  const spaceCap = typeof colonyPopCap === "function" ? colonyPopCap(c) : 0;
  return 6 + myp.length * 2.5 + countBldg(c, "house") * 0.6 + c.era * 1.5 + lvlCap + spaceCap;
}

// what the nation is actually short of — per-unit worths for the empirical
// deltas. Once a need is covered the worth collapses, so the AI stops
// repeating cheap early-game construction (§5) instead of flooding cities
// with farms. Personalities tilt the long-term composition (§6): aggressive →
// industry & arms, scientific → research, peaceful/mercantile → economy and
// wellbeing, defensive → protection and sustained output.
function aiNeedWeights(c, prod) {
  const per = c.personality, era = c.era;
  const w = { food: 0.15, mat: 0.6, money: 0.9, research: 0.8, energy: 0.25 };
  const fr = prod.food / Math.max(1, foodNeed(c));
  if (fr < 1) w.food = 3 + (1 - fr) * 10; else if (fr < 1.3) w.food = 1.2;
  // ENERGY (the University-spam fix, part 1): the target scales with what the
  // nation actually wants to power — its biggest unlocked consumer plus
  // headroom, and from the space age the spare ⚡ one launch needs. Below the
  // target the worth climbs steeply; the old flat 1.5 left Power Plants
  // forever outbid while Laboratories priced at the energy cliff.
  let eTarget = 4 + era * 2;
  for (const b of Object.keys(BLDG_ENERGY)) if (bldgAvailable(c, b)) eTarget = Math.max(eTarget, BLDG_ENERGY[b] + 6);
  if (era >= 8 && c.researched.shipyards) eTarget = Math.max(eTarget, SPACE_COSTS.launch.energy + 8);
  if (prod.energy < 0) w.energy = 6;
  else if (prod.energy < eTarget) w.energy = 1.5 + 2.5 * (1 - prod.energy / eTarget);
  // once a flow is well past its target the worth DECAYS with the surplus —
  // this is what finally stops the one-building monocultures (§5): the tenth
  // megafactory of a nation drowning in materials is worth almost nothing
  const matTarget = 15 + era * 14 + (era >= 8 ? (era - 7) * 60 : 0); // spacecraft and megaprojects eat materials (§7)
  if (prod.mat < matTarget) w.mat = prod.mat < matTarget * 0.5 ? 2.2 : 1.5;
  else w.mat = 0.6 / Math.max(1, prod.mat / (matTarget * 1.5));
  const moneyTarget = 400 + era * 250;
  if (prod.money < 0) w.money = 4;
  else if (c.res.money < 250 + era * 150) w.money = 1.6;
  else w.money = 0.9 / Math.max(1, prod.money / moneyTarget);
  // RESEARCH decays past its target exactly like money and materials (§13).
  // The missing decay was the University-spam engine: with a permanent 0.8+
  // floor, +research outbid every other ledger from era 5 to the credits.
  const researchTarget = 6 * Math.pow(2.1, era - 1);
  if (prod.research < researchTarget) w.research = 2.2;
  else w.research = 0.8 / Math.max(1, prod.research / (researchTarget * 1.5));
  if (per === "scientific") w.research *= 1.6;
  if (per === "mercantile") w.money *= 1.5;
  if (per === "peaceful") { w.money *= 1.2; w.food *= 1.15; }
  if (per === "aggressive" || per === "expansionist") w.mat *= 1.35;
  if (per === "defensive") { w.food *= 1.1; w.energy *= 1.2; }
  return w;
}

// the empirical core: what one bId ADDED to (dir +1) or REMOVED from (dir −1)
// city p is worth per tick, priced through the real production() against the
// baseline `base`. Removal returns the KEEP value of the standing building.
function aiProdDelta(c, p, bId, dir, base, W) {
  p.b[bId] = (p.b[bId] || 0) + dir;
  if (p.b[bId] <= 0) delete p.b[bId];
  const after = production(c);
  if (dir > 0) { p.b[bId]--; if (!p.b[bId]) delete p.b[bId]; }
  else p.b[bId] = (p.b[bId] || 0) + 1;
  const d = (after.food - base.food) * W.food + (after.mat - base.mat) * W.mat +
    (after.money - base.money) * W.money + (after.research - base.research) * W.research +
    (after.energy - base.energy) * W.energy;
  return dir > 0 ? d : -d;
}

// ---- the University-spam fix (AI building bug) ----
// §15: diagnostic logging — silent by default; tests and the console flip it
// on with AI_DEV_LOG.on = true (or window.AI_DEV_LOG = true).
const AI_DEV_LOG = { on: false };
function aiDevLog(id, msg) {
  if (!AI_DEV_LOG.on && !(typeof window !== "undefined" && window.AI_DEV_LOG)) return;
  const c = typeof G !== "undefined" && G && G.countries[id];
  if (typeof console !== "undefined") console.log(`[AI-DEV ${c ? c.name : id}] ${msg}`);
}
// §2: duplicates decay — the Nth copy of one structure in one city is worth
// less than the (N−1)th. Real shortages re-inflate the need weights, so a
// hungry nation still raises its farms; what dies is the 13-University city.
function aiDupPenalty(p, bId) {
  const n = cityBldgQ(p, bId);
  return n <= 1 ? 1 : Math.pow(0.85, n - 1);
}
// §10: every city leans into what it already is — derived from its real
// buildings, never a fixed layout. Cities with no clear character rotate
// through the core roles so a nation's cities stop developing in lockstep.
const AI_ROLE_SETS = {
  research:   { school: 1, university: 1, lab: 1 },
  economy:    { market: 1, taxoffice: 1, tradehub: 1, bank: 1, commerce: 1, port: 1 },
  production: { mine: 1, factory: 1, refinery: 1, industrial: 1, megafactory: 1 },
  military:   { base: 1, fortress: 1, silo: 1, abm: 1 },
  space:      { spaceprogram: 1 },
};
// One specialist per role: the city with the strongest claim keeps its
// character; the rest take the next open role. Without this, a nation spammed
// into 13-University cities derives "research" EVERYWHERE and the role bonus
// entrenches the very monoculture it should be breaking up.
function aiCityRoles(c, provs) {
  const roles = new Map(), claimed = {};
  const scored = provs.map(p => {
    if (p.b.spaceprogram) return { p, role: "space", n: 99 };
    if (c.provinces[c.capital] === p) return { p, role: "capital", n: 98 }; // the capital stays balanced
    let best = null, bestN = 1;                       // 2+ works make a character
    for (const role of Object.keys(AI_ROLE_SETS)) {
      let n = 0;
      for (const b of Object.keys(AI_ROLE_SETS[role])) n += p.b[b] || 0;
      if (n > bestN) { best = role; bestN = n; }
    }
    return { p, role: best, n: best ? bestN : 0 };
  }).sort((a, b) => b.n - a.n);
  const rot = ["production", "research", "economy", "military"];
  for (const e of scored) {
    let r = e.role;
    if (r && r !== "space" && r !== "capital" && claimed[r]) r = null;
    if (!r) {
      const i = c.provinces.indexOf(e.p);
      r = rot.find(x => !claimed[x]) || rot[(i >= 0 ? i : 0) % rot.length];
    }
    if (r !== "space" && r !== "capital") claimed[r] = 1;
    roles.set(e.p, r);
  }
  return roles;
}
function aiRoleAffinity(role, bId) {
  if (!role || role === "capital") return 1;
  if (AI_ROLE_SETS[role] && AI_ROLE_SETS[role][bId]) return 1.2;
  for (const r of Object.keys(AI_ROLE_SETS)) if (r !== role && AI_ROLE_SETS[r][bId]) return 0.85;
  return 1; // houses, farms, power, hospitals fit every city
}
// §3/§5/§9: the energy-cliff trap. An unlocked Laboratory or Mega Factory
// priced while the grid is short looks WORSE than nothing (the 0.55 penalty
// hits the whole nation's materials and research), so the old AI never built
// one — and a Power Plant's own +15⚡ never outbid another University. Pricing
// the PAIR breaks the trap: when a blocked candidate priced with temporary
// plants is the best argument in the nation, the Power Plant goes first and
// inherits that argument at a discount.
// raw grid ledger — the same numbers production()'s energyOK cliff compares
function aiEnergyRaw(c) {
  let supply = 2, demand = 0;
  for (const p of provsOwned(c.id)) supply += (p.b.power || 0) * 15;
  for (const b of Object.keys(BLDG_ENERGY)) demand += countBldg(c, b) * BLDG_ENERGY[b];
  return { supply, demand };
}
function aiPowerFirst(id, c, p, bId, base, W, provs, ctx, role, forceSite) {
  if (!bldgAvailable(c, "power")) return null;
  const need = BLDG_ENERGY[bId] || 0;
  if (!need) return null;
  const raw = aiEnergyRaw(c);
  if (raw.supply >= raw.demand + need + 2) return null; // the grid already carries it
  const site = forceSite || aiSiteFor(c, provs, "power");
  if (!site) return null;
  const k = Math.max(1, Math.ceil((raw.demand + need + 4 - raw.supply) / 15));
  site.b.power = (site.b.power || 0) + k;               // plants stand for a heartbeat
  const base2 = production(c);
  const s2 = aiProdDelta(c, p, bId, 1, base2, W);
  site.b.power -= k; if (!site.b.power) delete site.b.power;
  if (s2 <= 0) return null;
  const s = (s2 + aiRoleScore(id, c, p, bId, ctx)) * aiDupPenalty(p, bId) * aiRoleAffinity(role, bId) * 0.85;
  return { b: "power", p: site, s, forB: bId };
}

// value the ledgers cannot see: housing, growth, morale works, defence and the
// strategic buildings. Scored on the same scale as the production deltas.
function aiRoleScore(id, c, p, bId, ctx) {
  const per = c.personality;
  let s = 0;
  if (bId === "house") {
    const cap = aiPopCap(c, ctx.myp);
    if (c.pop > cap * 0.92) s += 55; else if (c.pop > cap * 0.82) s += 22;
  }
  if (bId === "hospital" && countBldgQ(c, "hospital") < ctx.myp.length)
    s += 14 + (per === "peaceful" ? 10 : 0) + (c.pop < aiPopCap(c, ctx.myp) * 0.85 ? 6 : 0);
  if (BLDG_MORALE[bId]) s += BLDG_MORALE[bId] * 6;
  if (bId === "base") s += ctx.war ? 30 : ctx.threat ? 16 : (per === "aggressive" || per === "defensive") ? 8 : 0;
  if (bId === "fortress") s += (ctx.war ? 26 : ctx.threat ? 14 : per === "defensive" ? 10 : 0) * (per === "defensive" ? 1.4 : 1);
  if (bId === "silo") s += ctx.war ? 40 : ctx.threat ? 18 : per === "aggressive" ? 10 : 0;
  if (bId === "abm") s += ctx.war ? 25 : ctx.threat ? 12 : 0;
  // the road to space: one Space Program is the era-8 strategic objective
  if (bId === "spaceprogram" && c.era >= 8)
    s += 200 * (per === "scientific" || per === "expansionist" ? 1.3 : 1);
  return s;
}

// where a work would stand: coastal rules, copy limits, a free slot and a
// short queue; farms follow fertile ground, mines rich ground, advanced works
// the greatest cities
function aiSiteFor(c, provs, bId) {
  let free = provs.filter(p => usedSlots(p) < p.slots && (p.bq || []).length < 2 && aiCopyAllowed(c, p, bId));
  if (BLDGS[bId].coastal) free = free.filter(p => cityIsCoastal(p));
  if (!free.length) return null;
  if (bId === "farm") return free.sort((a, b) => biomeMult(c, b.terrain, "food") - biomeMult(c, a.terrain, "food"))[0];
  if (bId === "mine") return free.sort((a, b) => biomeMult(c, b.terrain, "mat") - biomeMult(c, a.terrain, "mat"))[0];
  // §5: the refinery's +25% beside a Mine is real money — site it there
  if (bId === "refinery") return free.sort((a, b) => (b.b.mine || 0) - (a.b.mine || 0) || (b.lvl || 1) - (a.lvl || 1))[0];
  if (["lab", "university", "spaceprogram", "megafactory", "commerce", "bank", "industrial", "factory"].includes(bId))
    return free.sort((a, b) => (b.lvl || 1) - (a.lvl || 1))[0];
  return pick(free);
}

// score every unlocked structure on its best site. `prod` feeds the need
// weights; the deltas run against a fresh baseline so the pricing is exact.
function aiSelectProject(id, c, prod, provs) {
  const W = aiNeedWeights(c, prod);
  // the road to space is destiny (§8): from era 8, ONE Space Program outranks
  // every ledger argument until it stands — deterministic, no dice
  if (c.era >= 8 && bldgAvailable(c, "spaceprogram") && countBldgQ(c, "spaceprogram") === 0) {
    const sp = aiSiteFor(c, provs, "spaceprogram");
    if (sp) return { b: "spaceprogram", p: sp, s: 400 };
  }
  const base = production(c);
  const meta = metaOf(id) || { neighbors: [] };
  const ctx = { myp: provs, war: inAnyWar(id),
    threat: meta.neighbors.some(n => G.countries[n] && G.countries[n].alive && G.rel[id] && G.rel[id][n] < -30) };
  const roleOf = aiCityRoles(c, provs);
  let best = null;
  for (const bId of Object.keys(BLDGS)) {
    if (!bldgAvailable(c, bId)) continue;
    const p = aiSiteFor(c, provs, bId);
    if (!p) continue;
    // §2/§10: duplicate copies decay, city roles gently tilt the choice
    let s = (aiProdDelta(c, p, bId, 1, base, W) + aiRoleScore(id, c, p, bId, ctx))
      * aiDupPenalty(p, bId) * aiRoleAffinity(roleOf.get(p), bId);
    // a candidate starved by the grid can still be the nation's best argument —
    // then the Power Plant goes first and takes the score (§3/§5/§9)
    if (s <= AI_DEV.minScore && BLDG_ENERGY[bId]) {
      const viaPower = aiPowerFirst(id, c, p, bId, base, W, provs, ctx, roleOf.get(p), null);
      if (viaPower && viaPower.s > s && (!best || viaPower.s > best.s)) {
        aiDevLog(id, `Power Plant selected: energy below what ${BLDGS[bId].n} needs (unblocked score ${viaPower.s.toFixed(1)})`);
        best = viaPower;
        continue;
      }
    }
    if (s <= 0) continue;
    s *= rnd(0.85, 1.18); // nations don't all build in lockstep
    if (!best || s > best.s) best = { b: bId, p, s };
  }
  return best;
}
// ---- the saved plan (§7, §11): one expensive project, funds reserved ----
// c.aiPlan = { b, city, replace, need:{money,mat}, since } — plain data, so it
// rides through saves and multiplayer snapshots untouched and is re-validated
// before every step after loading.
function aiReserved(c) { return c.aiPlan ? c.aiPlan.need : null; }
function aiSpendableMoney(c) { const r = aiReserved(c); return c.res.money - (r ? r.money : 0); }
function aiSpendableMat(c) { const r = aiReserved(c); return c.res.mat - (r ? r.mat : 0); }
function aiPlanCity(id, plan) {
  for (const p of provsOwned(id)) if (p.city === plan.city) return p;
  return null;
}
function aiMakePlan(c, best, replace) {
  const cost = bldgCost(c, best.b);
  c.aiPlan = { b: best.b, city: best.p.city, replace: replace || null,
    need: { money: cost.money, mat: cost.mat }, since: G.turn };
}
// a plan survives only while it is real: the structure still unlocked, the
// city still held, the doomed building still standing, the slot still there
function aiPlanValid(id, c) {
  const plan = c.aiPlan;
  if (!plan || !BLDGS[plan.b] || !bldgAvailable(c, plan.b)) return null;
  const p = aiPlanCity(id, plan);
  if (!p) return null;
  if (BLDGS[plan.b].coastal && !cityIsCoastal(p)) return null;
  if (plan.replace && !(p.b[plan.replace] > 0)) return null;
  if (!plan.replace && usedSlots(p) >= p.slots) return null;
  if (!aiCopyAllowed(c, p, plan.b)) return null;
  return p;
}
// keep saving → execute when funded. §3's exact sequence: the replacement was
// selected and validated, its resources are reserved — only then delete the
// old work, and queue the successor in the same breath. Any failed check
// keeps the original structure; nothing was spent. Returns true while the
// plan holds this pass's build action (saving or executing).
function aiPlanStep(id, c) {
  const plan = c.aiPlan;
  if (!plan) return false;
  const p = aiPlanValid(id, c);
  const mine = provsOfNation(id);
  const overrun = mine.length ? mine.filter(e => e.p.occ).length / mine.length : 0;
  if (!p || G.turn - (plan.since || 0) > AI_DEV.planTimeout || overrun > 0.3) {
    c.aiPlan = null; // invalid, hopeless, or a war emergency outranks it (§7)
    return false;
  }
  const cost = bldgCost(c, plan.b);
  plan.need = { money: cost.money, mat: cost.mat }; // live prices
  if (c.res.money < cost.money || c.res.mat < cost.mat) return true; // still saving
  if (typeof homeworldScorched === "function" && homeworldScorched()) return true; // wait out the fire
  if (plan.replace) demolishBuilding(c, p, plan.replace);
  const r = enqueueBuilding(c, p, plan.b);
  c.aiPlan = null;
  return !!(r && r.ok);
}

// ---- the modern review (§9-§10): one city per pass, round-robin ----
// A full city may swap its weakest outdated work for a clearly better one; a
// late-era city drowning in baseline farms/houses/mines thins them out. Hard
// guards: strategic works are untouchable, fortresses hold while at war, and
// a demolition may never starve or black out the nation.
const AI_NEVER_DEMOLISH = { spaceprogram: 1, silo: 1, abm: 1 };
function aiReviewCity(id, c, prod, provs) {
  if (c.aiPlan || !provs.length) return false;   // one project at a time (§9)
  c.aiModCity = ((c.aiModCity || 0) + 1) % provs.length;
  const p = provs[c.aiModCity];
  if ((p.bq || []).length) return false;         // let the cranes finish first
  const full = usedSlots(p) >= p.slots;
  const baseline = (p.b.farm || 0) + (p.b.house || 0) + (p.b.mine || 0);
  const flooded = c.era >= 5 && baseline > p.slots * AI_DEV.floodFrac;
  if (!full && !flooded) return false;
  const W = aiNeedWeights(c, prod);
  const base = production(c);
  const war = inAnyWar(id);
  const meta = metaOf(id) || { neighbors: [] };
  const ctx = { myp: provs, war,
    threat: meta.neighbors.some(n => G.countries[n] && G.countries[n].alive && G.rel[id] && G.rel[id][n] < -30) };
  const role = aiCityRoles(c, provs).get(p);
  // every structure we may lawfully lose, cheapest KEEP first (real data, §4).
  // Surplus copies pay the same duplicate discount they earned on the way in —
  // the 13th University prices as the filler it is, not as fresh research.
  const keeps = [];
  for (const bId of Object.keys(p.b)) {
    if (AI_NEVER_DEMOLISH[bId] || !(p.b[bId] > 0)) continue;
    if (bId === "fortress" && (war || ctx.threat)) continue; // not while shells threaten
    if (bId === "base" && war) continue;                     // §6: no disarming mid-war
    const keep = (aiProdDelta(c, p, bId, -1, base, W) + aiRoleScore(id, c, p, bId, ctx)) * aiDupPenalty(p, bId);
    keeps.push({ b: bId, keep });
  }
  keeps.sort((a, b) => a.keep - b.keep);
  for (const worst of keeps) {
    // price every successor as if the old work were already gone
    p.b[worst.b]--; if (!p.b[worst.b]) delete p.b[worst.b];
    const baseW = production(c);
    // shortage guard (§3/§6): losing THIS work may not cause famine or
    // blackout — if it would, the next-weakest candidate gets its turn
    if ((baseW.food < foodNeed(c) * 1.05 && baseW.food < base.food) ||
        (baseW.energy < 0 && baseW.energy < base.energy)) {
      p.b[worst.b] = (p.b[worst.b] || 0) + 1;
      aiDevLog(id, `Building deletion cancelled: removing ${BLDGS[worst.b].n} in ${p.city} would cause a ${baseW.energy < 0 && baseW.energy < base.energy ? "blackout" : "food shortage"}`);
      continue;
    }
    let cand = null;
    for (const bId of Object.keys(BLDGS)) {
      if (!bldgAvailable(c, bId) || bId === worst.b) continue;
      if (BLDGS[bId].coastal && !cityIsCoastal(p)) continue;
      if (!aiCopyAllowed(c, p, bId)) continue;
      let s = (aiProdDelta(c, p, bId, 1, baseW, W) + aiRoleScore(id, c, p, bId, ctx))
        * aiDupPenalty(p, bId) * aiRoleAffinity(role, bId);
      // an energy-blocked successor argues for a Power Plant on this very
      // slot instead (§3/§9) — the plan stays within one city, so the
      // demolish-and-replace bookkeeping holds
      if (s <= AI_DEV.minScore && BLDG_ENERGY[bId]) {
        const viaPower = aiPowerFirst(id, c, p, bId, baseW, W, provs, ctx, role, p);
        if (viaPower && viaPower.s > s) { if (!cand || viaPower.s > cand.s) cand = viaPower; continue; }
      }
      if (!cand || s > cand.s) cand = { b: bId, s };
    }
    p.b[worst.b] = (p.b[worst.b] || 0) + 1;      // the city back exactly as found
    if (!cand || cand.s < worst.keep * AI_DEV.replaceEdge + 5) return false;
    aiDevLog(id, `City review ${p.city} (${role}): ${BLDGS[cand.b].n}${cand.forB ? ` (to unblock ${BLDGS[cand.forB].n})` : ""} replaces ${BLDGS[worst.b].n} — keep ${worst.keep.toFixed(1)} vs gain ${cand.s.toFixed(1)}`);
    aiMakePlan(c, { b: cand.b, p }, worst.b);
    aiPlanStep(id, c); // usually funded already — demolish & queue this pass
    return true;
  }
  return false;
}

// ---- the controller: one strategic pass of city development (§12) ----
// Per pass it may execute/advance the plan OR start a build, review one city
// for modernization, and consider a city upgrade — never a demolition storm.
// A caretaker AI (dropped multiplayer human, QoL §18) builds for needs but
// never demolishes and never gambles the player's treasury on plans.
function aiDevelop(id, c, prod, provs, caretaker) {
  if (caretaker && c.aiPlan && c.aiPlan.replace) c.aiPlan = null;
  const acted = aiPlanStep(id, c);
  if (!acted) {
    const best = aiSelectProject(id, c, prod, provs);
    if (best && best.s >= AI_DEV.minScore) {
      const cost = bldgCost(c, best.b);
      if (c.res.money >= cost.money * 1.25 && c.res.mat >= cost.mat * 1.05) {
        const r = enqueueBuilding(c, best.p, best.b);
        if (r && r.ok) aiDevLog(id, `${BLDGS[best.b].n} queued in ${best.p.city}${best.forB ? ` to power a future ${BLDGS[best.forB].n}` : ""} (score ${best.s.toFixed(1)})`);
      } else if (!caretaker && best.s >= AI_DEV.planScore && prod.money > 0) {
        aiMakePlan(c, best, null); // too dear today — reserve and save (§7)
        aiDevLog(id, `${BLDGS[best.b].n} planned for ${best.p.city} — reserving ${cost.money}💰 ${cost.mat}⛏`);
      }
    }
  } else if (c.aiPlan && (prod.food < foodNeed(c) || prod.energy < 0)) {
    // while saving, only survival works may spend — famine and blackouts
    // outrank any reservation
    const eb = prod.energy < 0 ? "power" : "farm";
    if (bldgAvailable(c, eb)) {
      const p2 = aiSiteFor(c, provs, eb);
      const ecost = bldgCost(c, eb);
      if (p2 && c.res.money >= ecost.money * 1.25 && c.res.mat >= ecost.mat) enqueueBuilding(c, p2, eb);
    }
  }
  if (!caretaker) aiReviewCity(id, c, prod, provs);
  if (Math.random() < 0.25) aiUpgradeCities(id, c, provs);
}
// ============ AI Update §3 — upgrading the cities that matter ============
// Capitals, big developed cities, industrial hubs, research towns, ports and
// Space Program sites come first; the exponential cost curve keeps any single
// city from swallowing the treasury forever.
function aiUpgradeCities(id, c, provs) {
  const cands = provs.filter(p => (p.lvl || 1) < CITY_MAX_LVL);
  if (!cands.length) return false;
  const scored = cands.map(p => {
    let s = (p.lvl || 1) + Object.keys(p.b).reduce((n, k) => n + p.b[k], 0) * 0.35;
    if (c.provinces[c.capital] === p) s += 3;
    if (p.b.spaceprogram) s += 4;
    if (p.b.port) s += 1.2;
    if ((p.b.lab || 0) + (p.b.university || 0)) s += 1.2;
    if ((p.b.industrial || 0) + (p.b.megafactory || 0) + (p.b.factory || 0)) s += 1;
    return { p, s: s * rnd(0.9, 1.1) };
  }).sort((a, b) => b.s - a.s);
  const t = scored[0].p;
  const uc = cityUpgradeCost(t, c.id);
  // an active construction plan keeps its reservation (§7)
  if (aiSpendableMoney(c) > uc.money * 2.2 && aiSpendableMat(c) > uc.mat * 1.6) { upgradeCity(c, t); return true; }
  return false;
}
// ============ AI Update §15 — missiles & nuclear weapons ============
// A silo-owning AI keeps a mixed stockpile, fires ballistic and homing
// missiles at strategic targets while at war, and holds nuclear weapons as a
// rare last argument — used only in desperate or existential wars, in full
// knowledge of the diplomatic price.
function aiMissilesTurn(id, c, myWars, myPow) {
  if (!countBldg(c, "silo")) return;
  const stock = missileStock(c);
  const foes = myWars.map(w => (w.a === id ? w.b : w.a))
    .filter(f => G.countries[f] && G.countries[f].alive && !isSynthetic(G.countries[f]));
  const cap = countBldg(c, "silo") * 3;
  const mine = provsOfNation(id);
  const lostFrac = mine.length ? mine.filter(e => e.p.occ).length / mine.length : 0;
  const foePow = foes.length ? Math.max(...foes.map(f => powerEstimate(G.countries[f]))) : 0;
  const desperate = lostFrac > 0.3 || (foes.length && foePow > myPow * 1.6);
  // --- stockpile ---
  if (missileTotal(c) < cap && (myWars.length ? c.res.money : aiSpendableMoney(c)) > 1200) {
    if (missileAvailable(c, "homing") && (stock.homing || 0) < (stock.ballistic || 0) && Math.random() < 0.5) buildMissile(c, "homing");
    else if (missileAvailable(c, "ballistic") && (stock.ballistic || 0) < 2 + (myWars.length ? 2 : 0)) buildMissile(c, "ballistic");
    if (missileAvailable(c, "nuke") && myWars.length && desperate && !(stock.nuke > 0) &&
        (c.personality === "aggressive" || c.personality === "expansionist" || lostFrac > 0.45) &&
        c.res.money > missileCost("nuke").money * 1.8 && Math.random() < 0.15) buildMissile(c, "nuke");
  }
  if (!foes.length || typeof launchMissile !== "function") return;
  // --- conventional fire: armies for homing, strategic cities for ballistic ---
  if (Math.random() < 0.35) {
    const f = pick(foes);
    if ((stock.homing || 0) > 0 && Math.random() < 0.5) {
      const armies = armiesOf(f).filter(a => !UNITS[a.unit].naval);
      if (armies.length) {
        const t = armies.sort((x, y) => (UNITS[y.unit].atk + UNITS[y.unit].def) - (UNITS[x.unit].atk + UNITS[x.unit].def))[0];
        stock.homing--;
        launchMissile(id, null, "homing", t.x, t.y, t.id);
      }
    } else if ((stock.ballistic || 0) > 0) {
      const targets = provsOfNation(f).filter(e => !e.p.occ);
      if (targets.length) {
        // production hubs, silos and Space Programs before ordinary towns
        const strat = targets.filter(e => e.p.b.silo || e.p.b.spaceprogram || e.p.b.megafactory || e.p.b.industrial || e.p.b.abm);
        const t = (strat.length && Math.random() < 0.65 ? pick(strat) : pick(targets)).p;
        stock.ballistic--;
        launchMissile(id, null, "ballistic", t.px, t.py, null);
      }
    }
  }
  // --- the last argument: rare, strategic, desperate ---
  if ((stock.nuke || 0) > 0 && desperate && Math.random() < 0.06) {
    const f = pick(foes);
    const targets = provsOfNation(f).filter(e => !e.p.occ);
    if (targets.length) {
      const big = targets.slice().sort((a, b) => Object.keys(b.p.b).length - Object.keys(a.p.b).length)[0];
      stock.nuke--;
      launchMissile(id, null, "nuke", big.p.px, big.p.py, null);
    }
  }
}

function aiTurn(id) {
  const c = G.countries[id];
  if (!c.alive || isHumanControlled(id)) return;
  if (isSynthetic(c)) return; // rebels defend (war.js); aliens act in space (space.js)
  const caretaker = isDisconnectedHuman(id); // QoL §18: protect, never gamble
  const per = c.personality;

  // ---- decision pacing (Part 8) ----
  // In Realistic Mode the AI no longer takes major action on every 3-second
  // tick. After each full strategic pass it "thinks" for a random 0-3 ticks —
  // on those ticks it only keeps research running (a small action) — so it
  // feels deliberate but is never idle for long. A clear military emergency
  // (badly outgunned in an active war) cuts the thinking short.
  if (isRealtime()) {
    if (c.aiRest === undefined) c.aiRest = irnd(0, 2);
    if (c.aiRest > 0) {
      c.aiRest--;
      let emergency = false;
      if (inAnyWar(id)) {
        const foes = G.wars.filter(w => w.a === id || w.b === id).map(w => (w.a === id ? w.b : w.a))
          .filter(f => G.countries[f] && G.countries[f].alive);
        const foePow = foes.length ? Math.max(...foes.map(f => powerEstimate(G.countries[f]))) : 0;
        emergency = powerEstimate(c) < foePow * 0.55;
      }
      if (!emergency) { aiPickResearch(id, c); return; }
      c.aiRest = 0;
    } else {
      c.aiRest = irnd(0, 3); // never rests 4+ ticks in a row
    }
  }
  const prod = production(c);

  // --- research ---
  aiPickResearch(id, c);

  // --- build & modernize (Old Bugs rewrite): ONE clean development controller ---
  const provs = provsOwned(id);
  if (provs.length) aiDevelop(id, c, prod, provs, caretaker);

  // --- recruit (Parts 5-6): strategic, budgeted, and never every tick ---
  // Every AI unit goes through the same recruitment queue and muster time as
  // the player's (queueRecruit); between recruitment decisions the AI now
  // waits several ticks, saves money when its economy or upkeep is strained,
  // and stands down entirely once its army matches the threats around it.
  const myWars = G.wars.filter(w => w.a === id || w.b === id);
  const threat = Math.max(0, ...metaOf(id).neighbors.map(n => G.countries[n].alive ? powerEstimate(G.countries[n]) : 0));
  const myPow = powerEstimate(c);
  const wantPow = myWars.length ? threat * 1.3 : threat * (per === "aggressive" ? 1.2 : 0.8) + 20;
  const capN = armyCap(c);
  const surfaceBurns = typeof homeworldScorched === "function" && homeworldScorched();
  if (c.recruitCd > 0) c.recruitCd--;
  const grossMoney = prod.money + prod.upkeep + (prod.bmaint || 0);
  const upkeepPressure = prod.upkeep > Math.max(40, grossMoney * 0.45); // army already eats the budget
  const weakEconomy = prod.money < 0 && c.res.money < 400;              // save, don't spend
  if (myPow < wantPow && provs.length && armyCount(id) < capN && !surfaceBurns &&
      !(c.recruitCd > 0) && !upkeepPressure && !weakEconomy) {
    const pool = Object.keys(UNITS).filter(u => unitAvailable(c, u) && !UNITS[u].naval && !UNITS[u].space)
      .sort((a, b) => (UNITS[b].atk + UNITS[b].def) - (UNITS[a].atk + UNITS[a].def));
    // mostly the strongest unit, sometimes the runner-up — a mixed force
    const best = pool.length > 1 && Math.random() < 0.3 ? pool[1] : pool[0];
    if (best) {
      const cost = recruitCost(c, best);
      // a saved-for construction plan reserves its funds (Old Bugs §7) —
      // peacetime recruitment spends only what stands above the reservation
      const bm = myWars.length ? c.res.money : aiSpendableMoney(c);
      const bmat = myWars.length ? c.res.mat : aiSpendableMat(c);
      let n = Math.min(isRealtime() ? (myWars.length ? 2 : 1) : 4, capN - armyCount(id),
        Math.floor(bm * 0.5 / Math.max(1, cost.money)), Math.floor(bmat / Math.max(1, cost.mat)));
      // muster where the queues are shortest, spreading orders across cities
      const sites = provs.slice().sort((p1, p2) => (p1.rq || []).length - (p2.rq || []).length);
      let si = 0, queued = 0;
      while (n-- > 0) {
        c.res.money -= cost.money; c.res.mat -= cost.mat;
        queueRecruit(id, best, sites[si++ % sites.length]);
        queued++;
      }
      // wait between recruitment decisions; wars and aggression shorten the wait
      if (queued) c.recruitCd = !isRealtime() ? (per === "aggressive" ? 0 : 1)
        : myWars.length ? irnd(1, 3)
        : per === "aggressive" ? irnd(2, 4) : irnd(3, 6);
    }
  }

  // --- army modernization (Part 7): retire troops of long-gone eras ---
  if (!caretaker && Math.random() < 0.3) aiModernizeArmy(id, c, prod);

  // --- navy: build transports when a war can only be reached across the sea ---
  if (myWars.length && metaOf(id).coastal && unitAvailable(c, "transport")) {
    const foes = myWars.map(w => (w.a === id ? w.b : w.a)).filter(f => G.countries[f].alive);
    const needSea = typeof sharesLandComp === "function" && foes.some(f => !sharesLandComp(id, f));
    if (needSea) {
      const have = armiesOf(id).filter(a => UNITS[a.unit].cap).length +
        provsOwned(id).reduce((n, p) => n + (p.rq || []).filter(q => UNITS[q.u].cap).length, 0);
      const landArm = armiesOf(id).filter(a => !UNITS[a.unit].naval).length;
      const want = Math.min(2, Math.max(1, Math.ceil(landArm / 5)));
      if (have < want) {
        const cost = recruitCost(c, "transport");
        if (c.res.money > cost.money * 1.5 && c.res.mat > cost.mat) {
          // same rule as the player: only a coastal city with a finished Port
          const harbours = provsOwned(id).filter(p => canBuildShipAt(p));
          if (harbours.length) {
            c.res.money -= cost.money; c.res.mat -= cost.mat;
            queueRecruit(id, "transport", pick(harbours));
          }
        }
      }
    }
  }

  // --- missiles & nukes (AI Update §15): mixed stockpiles, strategic targets ---
  if (c.researched.rocketry) aiMissilesTurn(id, c, myWars, myPow);

  // --- wars: seek peace when losing ---
  for (const w of myWars) {
    if (w.noPeace && G.turn < w.noPeace) continue; // a forced war burns on (Sandbox §13)
    const other = w.a === id ? w.b : w.a;
    const O = G.countries[other];
    if (!O.alive) continue;
    const mine = provsOfNation(id);
    const lostFrac = mine.length ? mine.filter(e => e.p.occ).length / mine.length : 1;
    if (c.warWeariness > 30 || lostFrac > 0.4 || (myPow < powerEstimate(O) * 0.4 && G.turn - w.start > 4)) {
      if (isHumanControlled(other)) {
        // peace offers are addressed to a specific human (host or client)
        if (!G.peaceOffers) G.peaceOffers = [];
        if (!G.peaceOffers.some(o => o.from === id && o.to === other)) {
          G.peaceOffers.push({ from: id, to: other });
          log(`${c.name} seeks peace with ${G.countries[other].name}.`, "sys");
        }
      } else if (aiAccepts(other, id, "peace")) { makePeace(id, other, false); continue; }
    }
  }

  // --- new war? — a scored, randomised decision instead of a fixed script ---
  // caretaker AI for a disconnected player never starts wars (QoL §18)
  if (!myWars.length && !caretaker) maybeDeclareWar(id, c, myPow, prod);

  // --- diplomacy ---
  if (Math.random() < 0.3) {
    const others = Object.keys(G.countries).map(Number)
      .filter(t => t !== id && G.countries[t].alive && !isSynthetic(G.countries[t]) && !atWar(id, t));
    if (others.length) {
      const t = pick(others);
      if ((per === "peaceful" || per === "mercantile") && c.res.money > 200) {
        c.res.money -= 60;
        G.rel[t][id] = clamp(G.rel[t][id] + 5, -100, 100);
      }
      if (per === "mercantile" && !hasTrade(id, t) && G.rel[id][t] > 0 && G.rel[t][id] > 0 && Math.random() < 0.5) {
        // offers to human players go to their diplomacy inbox (QoL §3/§6)
        if (isHumanControlled(t) && typeof netOfferToHuman === "function") netOfferToHuman(id, "trade", t);
        else G.trades.push([id, t]);
      }
      const myAlliances = G.alliances.filter(p => p.includes(id)).length;
      const theirAlliances = G.alliances.filter(p => p.includes(t)).length;
      if (G.rel[id][t] > 50 && G.rel[t][id] > 50 && !allied(id, t) && myAlliances < 3 && theirAlliances < 3 && Math.random() < 0.2) {
        if (isHumanControlled(t) && typeof netOfferToHuman === "function") netOfferToHuman(id, "alliance", t);
        else {
          G.alliances.push([id, t]);
          log(`${G.countries[id].name} and ${G.countries[t].name} form an alliance.`, "sys");
        }
      }
    }
  }

  // --- espionage ---
  if (per === "scientific" && c.era >= 2 && c.res.money > 600 && Math.random() < 0.15) {
    const leaders = Object.keys(G.countries).map(Number)
      .filter(t => t !== id && G.countries[t].alive && !isSynthetic(G.countries[t]) && G.countries[t].era > c.era);
    if (leaders.length) spy(id, pick(leaders), "steal");
  }

  // --- space: launches, colonies, fleets, megastructures (space.js) ---
  if (c.era >= 8 && typeof aiSpaceTurn === "function") aiSpaceTurn(id, c);
}

// ---------- AI war decisions ----------
// Every personality weighs war differently; the final call mixes personality,
// relations, strength difference, proximity, tech edge, the target's existing
// wars, own resources and a random factor. No nation attacks on a fixed
// schedule, and different simulations produce different wars.
const PER_WAR = {
  aggressive:   { base: 2.6,  cd: 9 },
  expansionist: { base: 2.2,  cd: 11 },
  mercantile:   { base: 0.9,  cd: 16 },
  defensive:    { base: 0.7,  cd: 18 },
  scientific:   { base: 0.7,  cd: 18 },
  peaceful:     { base: 0.35, cd: 24 },
};
function maybeDeclareWar(id, c, myPow, prod) {
  if (sandboxOn("noAIWars")) return;
  const per = PER_WAR[c.personality] || PER_WAR.defensive;
  const ts = warTurnScale();
  if (G.turn - c.lastWarTurn < per.cd * ts) return;
  if (G.turn < (6 + (c.warBias || 0)) * ts) return;     // randomised settling-in period
  if (c.morale < 40 || c.warWeariness > 15) return;
  if (Math.random() > (isRealtime() ? 0.2 : 0.5)) return; // most turns nations simply don't consider war
  if (prod.money < 0 || c.res.money < 150) return;        // no war chest, no war
  const meta = metaOf(id);
  let best = null, bestScore = 0;
  for (const tk of Object.keys(G.countries)) {
    const t = Number(tk);
    if (t === id) continue;
    const T = G.countries[t];
    if (!T.alive || G.vassals[t] || allied(id, t) || !canReach(id, t)) continue;
    if (typeof sharesLandComp === "function" && !sharesLandComp(id, t) && !unitAvailable(c, "transport")) continue;
    if (G.promises.some(p => p.from === id && p.to === t && p.type === "peace" && !p.done && !p.broken)) continue;
    const rel = G.rel[id][t];
    if (rel > 25) continue;
    const ratio = myPow / (powerEstimate(T) + 25);
    if (ratio < 1.15) continue;                            // never pick fights it expects to lose
    let s = per.base;
    s += Math.min(2.2, (ratio - 1) * 1.1);                 // military strength difference
    s += -rel / 45;                                        // grudges pull the trigger
    s += meta.neighbors.includes(t) ? 1.1 : -0.4;          // nearby territory tempts
    s += (c.era - T.era) * 0.45;                           // technology edge
    s += Math.min(1, G.wars.filter(w => w.a === t || w.b === t).length * 0.5); // pile on the embattled
    if (G.trust[id][t] < 25) s += 0.4;
    s += rnd(-1.4, 1.4);                                   // the small random factor
    if (s > bestScore) { bestScore = s; best = t; }
  }
  if (best !== null && bestScore >= 3.6 && Math.random() < 0.5) declareWar(id, best);
}

// ---------- AI army modernization (AI Improvements Part 7) ----------
// Once clearly better units exist, the AI gradually disbands troops from
// long-gone eras — freeing army-cap room and upkeep for a modern force. Old
// units are kept while money is short (unless upkeep is crushing the budget),
// and nothing is scrapped mid-battle. Transports and ships keep serving.
function aiModernizeArmy(id, c, prod) {
  let bestE = 1, best = null, bestScore = 0;
  for (const u of Object.keys(UNITS)) {
    if (UNITS[u].naval || UNITS[u].space || !unitAvailable(c, u)) continue;
    bestE = Math.max(bestE, UNITS[u].e);
    const s = UNITS[u].atk + UNITS[u].def;
    if (s > bestScore) { bestScore = s; best = u; }
  }
  if (bestE < 4) return;                       // early armies field whatever exists
  const gap = c.era >= 8 ? 2 : 3;              // high-tech nations tolerate less rust
  const obsolete = armiesOf(id).filter(a => {
    const u = UNITS[a.unit];
    if (u.naval || u.space || u.cap) return false;
    if ((a.cargo || []).length) return false;
    if (typeof warNow !== "undefined" && a.lc && warNow - a.lc < 12) return false; // in combat
    return u.e <= bestE - gap;
  });
  if (!obsolete.length) return;
  const grossMoney = prod.money + prod.upkeep + (prod.bmaint || 0);
  const canReplace = best && c.res.money > recruitCost(c, best).money * 1.5;
  const upkeepHeavy = prod.upkeep > Math.max(30, grossMoney * 0.5);
  if (!canReplace && !upkeepHeavy) return;     // too poor to modernise — keep the museum pieces
  obsolete.sort((a, b) => UNITS[a.unit].e - UNITS[b.unit].e); // oldest first
  let n = Math.min(2, obsolete.length);        // gradual replacement, not a purge
  while (n-- > 0) {
    const a = obsolete.shift();
    if (typeof removeArmyQuiet === "function") removeArmyQuiet(a);
    else G.armies.splice(G.armies.indexOf(a), 1);
  }
}

// ---------- events ----------
function rollEvent() {
  // multiplayer v1: no random events — they are single-player modals and
  // would desynchronise the host's pause behaviour from the clients
  if (typeof NET !== "undefined" && NET.active) return null;
  // Sandbox Improvement §11: with Events disabled nothing ever triggers —
  // no pop-ups, no forced choices, no interruptions
  if (sandboxOn("noEvents")) return null;
  if (Math.random() > (isRealtime() ? 0.05 : 0.22)) return null;
  const P = G.countries[G.playerId];
  const pool = G.playerId === 2 ? EVENTS.concat(HUMAN_EVENTS) : EVENTS;
  const ev = pick(pool);
  const mine = provsOwned(G.playerId);
  const prov = pick(mine.length ? mine : P.provinces);
  const othersAlive = Object.keys(G.countries).map(Number).filter(i => i !== G.playerId && G.countries[i].alive);
  const other = othersAlive.length ? G.countries[pick(othersAlive)] : P;
  return {
    ev, provName: prov.name, otherId: other.id,
    text: ev.d.replace("{prov}", prov.name).replace("{other}", other.name),
  };
}
// ============ Sandbox Improvement §3 — Unlock All Eras and Technologies ============
// One stroke completes every technology: every era, unit, building, missile,
// megastructure and researched ability opens at once — no prerequisites left.
function sandboxUnlockAll(cid) {
  const c = G.countries[cid === undefined ? G.playerId : cid];
  if (!c) return 0;
  let n = 0;
  for (const t of TECHS) if (!c.researched[t.id]) { c.researched[t.id] = true; n++; }
  c.researching = null; c.rp = 0;
  c.era = ERAS.length - 1;
  bumpMods();
  eraAdvanced(c);
  log(`✨ Sandbox: every era and all ${TECHS.length} technologies unlocked — units, buildings, space travel, megastructures and abilities included.`, "sys");
  return n;
}

// ============ Sandbox Improvement §13-§14 — the Forced War system ============
// Instantly creates a war between any two living civilizations — countries,
// AI nations or alien empires. Intensity sets how long peace stays off the
// table; "Attack Mainland" orders the attacker to carry the war onto the
// defender's home ground (transports, landings and capital-first assaults all
// through the normal mechanics — no instant conquest).
function sandboxForceWar(a, b, intensity, mainland) {
  a = Number(a); b = Number(b);
  const A = G.countries[a], B = G.countries[b];
  if (a === b || !A || !B || !A.alive || !B.alive) return { ok: false, msg: "Pick two different living civilizations." };
  if (!atWar(a, b)) declareWar(a, b);
  const w = warOf(a, b);
  const dur = intensity === "total" ? 60 : intensity === "low" ? 12 : 30;
  w.forced = true; w.intensity = intensity || "normal"; w.noPeace = G.turn + dur;
  // alien attackers get a standing assault plan; alien defenders wake up too
  for (const [x, y] of [[a, b], [b, a]]) {
    const rec = typeof alienById === "function" ? alienById(x) : null;
    if (rec) {
      rec.invadeCd = 0; rec.colCd = 0;
      if (x === a) rec.assault = { target: y, mainland: !!mainland && !isSynthetic(G.countries[y]), intensity: w.intensity };
    } else if (x === a && mainland) {
      G.countries[x].assault = { target: y, until: w.noPeace }; // capital-first land campaign (war.js)
    }
  }
  log(`🧪 Sandbox: FORCED WAR — ${A.name} vs ${B.name} (${w.intensity}${mainland ? ", mainland assault ordered" : ""}).`, "war");
  return { ok: true, msg: `${A.name} and ${B.name} are now at war (${w.intensity}).` };
}

function applyEventChoice(pending, choiceIdx) {
  const P = G.countries[G.playerId];
  const eff = pending.ev.ch[choiceIdx].eff;
  if (eff.money) P.res.money += eff.money;
  if (eff.mat) P.res.mat = Math.max(0, P.res.mat + eff.mat);
  if (eff.morale) P.morale = clamp(P.morale + eff.morale, 0, 100);
  if (eff.stab) P.stability = clamp(P.stability + eff.stab, 0, 100);
  if (eff.rp && P.researching) P.rp += eff.rp;
  else if (eff.rp) P.res.money += eff.rp * 0.5;
  if (eff.pop) P.pop = Math.max(0.3, P.pop + eff.pop);
  if (eff.rel) {
    G.rel[pending.otherId][G.playerId] = clamp(G.rel[pending.otherId][G.playerId] + eff.rel, -100, 100);
  }
  log(`Event: ${pending.ev.n} — ${pending.ev.ch[choiceIdx].t}`, "sys");
}

// ---------- victory ----------
function checkVictory() {
  if (G.victory && G.victory.announced) return;
  // rebels and aliens never count toward (or block) victory conditions
  const alive = Object.keys(G.countries).map(Number)
    .filter(i => G.countries[i].alive && !isSynthetic(G.countries[i]));
  const total = MAP_META.countries.length;
  if (!G.countries[G.playerId].alive) { G.defeated = true; return; }
  // every human-controlled nation (host and multiplayer clients) can win
  const pids = [G.playerId];
  if (typeof NET !== "undefined" && NET.active && NET.humans) {
    for (const h of NET.humans) if (!pids.includes(h) && G.countries[h] && G.countries[h].alive) pids.push(h);
  }
  for (const pid of pids) {
    const freeOthers = alive.filter(i => i !== pid && G.vassals[i] !== pid && controllerOf(i) !== pid);
    if (freeOthers.length === 0) { G.victory = { type: "domination", by: pid }; return; }
    let controlled = 0;
    for (const meta of MAP_META.countries) {
      const cid = meta.id;
      if (controllerOf(cid) === pid || G.vassals[cid] === pid) controlled++;
    }
    if (controlled / total >= 0.6) { G.victory = { type: "hegemony", by: pid }; return; }
    const others = alive.filter(i => i !== pid);
    if (others.length > 3) {
      const alliesN = others.filter(o => allied(pid, o)).length;
      if (alliesN / others.length >= 0.6) { G.victory = { type: "alliance", by: pid }; return; }
    }
  }
}

// ---------- end turn ----------
function endTurn() {
  const P = G.countries[G.playerId];
  G.talkedThisTurn = {};
  bumpMods(); // safety net: any modifier drift is picked up once per tick
  // in real time, standing peace offers stay on the table while the war lasts
  if (isRealtime()) G.peaceOffers = (G.peaceOffers || []).filter(o => o && o.from !== undefined &&
    G.countries[o.from] && G.countries[o.from].alive && atWar(o.to, o.from));
  else G.peaceOffers = [];
  sweepStaleOccupations();
  collectIncome(P);
  // Sandbox Improvement §10: "AI Enabled" off pauses every AI decision — the
  // economies still tick, but no nation thinks, builds, recruits or acts
  const aiPaused = sandboxOn("aiOff");
  const ids = Object.keys(G.countries).map(Number).filter(i => i !== G.playerId);
  for (const id of ids) {
    const c = G.countries[id];
    if (!c.alive) continue;
    collectIncome(c);
    if (!aiPaused) aiTurn(id);
  }
  for (const a of Object.keys(G.countries)) for (const b of Object.keys(G.countries)) {
    if (a === b) continue;
    const r = G.rel[a][b];
    G.rel[a][b] = r > 0 ? r - 0.3 : (r < 0 ? r + 0.3 : r);
    if (hasTrade(Number(a), Number(b))) G.rel[a][b] = clamp(G.rel[a][b] + 0.5, -100, 100);
    if (allied(Number(a), Number(b))) G.rel[a][b] = clamp(G.rel[a][b] + 0.5, -100, 100);
    const pa = G.countries[a].personality, pb = G.countries[b].personality;
    if ((pa === "peaceful" || pa === "mercantile") && (pb === "peaceful" || pb === "mercantile") &&
        !atWar(Number(a), Number(b)) && G.rel[a][b] < 55) G.rel[a][b] += 0.8;
  }
  checkPromises();
  // settled promises pile up over very long games — keep the ledger short
  if (G.promises.length > 60) {
    const open = G.promises.filter(p => !p.done && !p.broken);
    G.promises = open.concat(G.promises.filter(p => p.done || p.broken).slice(-20));
  }
  tickRevolutions();
  sweepRebels();
  // stale diplomacy offers expire quietly (QoL §6)
  if (G.diploInbox) G.diploInbox = G.diploInbox.filter(o => o.status === "pending" && G.turn - o.turn < 40);
  // megastructure yards, colony garrisons and space AI production
  if (typeof spaceTurnTick === "function") spaceTurnTick();
  checkVictory();
  G.turn++; G.year++;
  G.eventPending = G.defeated || G.victory ? null : rollEvent();
  // don't hammer localStorage — roughly one autosave per 15 real seconds,
  // whatever the tick speed (Sandbox fast-forward included)
  const saveEvery = isRealtime() ? Math.max(5, Math.round(15 / realtimeTickSeconds())) : 1;
  if (!isRealtime() || G.turn % saveEvery === 0) autosave();
}

// ---------- save / load ----------
const SAVE_KEY = "civdom_save2"; // v2: new map + real-time armies (old saves incompatible)
function serialize() { return JSON.stringify(G); }
function autosave() { try { localStorage.setItem(SAVE_KEY, serialize()); } catch (e) {} }
function loadSave() {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    if (!s) return false;
    G = JSON.parse(s);
    migrateSave();
    return true;
  } catch (e) { return false; }
}
// older saves predate city levels, missiles, transports, queues and merges —
// fill in the new fields and fold absorbed countries into their survivors
function migrateSave() {
  if (G.sandbox === undefined) G.sandbox = null;
  // Humanity Balance Update Part 5: pre-mode saves were playing the buffed
  // values — they keep them. A saved mode returns exactly as chosen; loading
  // never reruns a poll.
  if (G.humanityMode === undefined) G.humanityMode = "super";
  if (G.sandbox) { // Sandbox Improvement: older sandbox saves gain the new controls
    if (G.sandbox.tickS === undefined) G.sandbox.tickS = 3;
    if (G.sandbox.noEvents === undefined) G.sandbox.noEvents = 0;
    if (G.sandbox.autoEvents === undefined) G.sandbox.autoEvents = 0;
    if (G.sandbox.noCd === undefined) G.sandbox.noCd = 0;
    if (G.sandbox.aiOff === undefined) G.sandbox.aiOff = 0;
  }
  if (typeof COUNTRY_MERGES !== "undefined") {
    for (const g of COUNTRY_MERGES) for (let i = 1; i < g.length; i++) mergeSavedCountry(g[i], g[0]);
  }
  for (const cid of Object.keys(G.countries)) {
    const c = G.countries[cid];
    if (!c.missiles) c.missiles = {};
    if (c.warBias === undefined) c.warBias = irnd(0, 14);
    if (c.revCd === undefined) c.revCd = 0;
    if (!c.milUp) c.milUp = { spd: 0, dmg: 0, arm: 0 };            // SU2 §13
    if (c.milResearching === undefined) c.milResearching = null;
    if (c.warMorale === undefined) c.warMorale = 50;               // AI Improvements Part 1
    if (c.recruitCd === undefined) c.recruitCd = 0;                // Part 6
    if (c.aiRest === undefined) c.aiRest = 0;                      // Part 8
    // synthetic countries (rebels, aliens) need their NATIONS row re-registered
    if (c.rebel && !NATIONS[c.id]) NATIONS[c.id] = NATIONS[c.rebelOf] || NATIONS[2];
    if (c.alien && !NATIONS[c.id] && typeof registerAlienNation === "function") registerAlienNation(c);
    for (const p of c.provinces) {
      if (!p.lvl) p.lvl = 1;
      if (!p.slots) p.slots = 6;
      if (!p.bq) p.bq = [];
      if (!p.rq) p.rq = [];
    }
  }
  G.armies = G.armies || [];
  for (const a of G.armies) {
    if (UNITS[a.unit] && UNITS[a.unit].cap && !a.cargo) a.cargo = [];
  }
  // peace offers used to be a plain list of country ids aimed at the player
  if (G.peaceOffers && G.peaceOffers.length && typeof G.peaceOffers[0] === "number") {
    G.peaceOffers = G.peaceOffers.map(i => ({ from: i, to: G.playerId }));
  }
  if (typeof ensureSpaceState === "function") ensureSpaceState(); // pre-space saves gain the solar system
  bumpMods(); // caches from a previous session in this page are stale now
  sweepStaleOccupations(); // heals saves where a dead nation still occupies cities
}

// fold a saved country (src) into its merge survivor (dst): provinces, armies,
// treasury, technologies and every id reference across the game state
function mergeSavedCountry(srcId, dstId) {
  const S0 = G.countries[srcId], D0 = G.countries[dstId];
  if (!S0 || !D0) return;
  if (G.playerId === srcId) G.playerId = dstId;
  const remap = x => Number(x) === srcId ? dstId : Number(x);
  for (const p of S0.provinces) D0.provinces.push(p);
  for (const cid of Object.keys(G.countries)) {
    for (const p of G.countries[cid].provinces) {
      if (p.own === srcId) p.own = dstId;
      if (p.occ === srcId) p.occ = dstId;
      if (p.occ && p.occ === p.own) p.occ = null;
      if (p.capBy === srcId) { p.capBy = 0; p.capProg = 0; }
    }
  }
  D0.pop += S0.pop;
  for (const k of Object.keys(D0.res)) D0.res[k] += S0.res[k] || 0;
  for (const t of Object.keys(S0.researched || {})) D0.researched[t] = true;
  D0.era = Math.max(D0.era, S0.era);
  D0.alive = D0.alive || S0.alive;
  for (const cid of Object.keys(G.countries)) {
    const c = G.countries[cid];
    if (c.annexedBy === srcId) c.annexedBy = dstId;
    if (c.vassalOf === srcId) c.vassalOf = dstId;
  }
  if (D0.annexedBy === dstId) D0.annexedBy = null;
  for (const a of G.armies || []) if (a.owner === srcId) a.owner = dstId;
  if (typeof spaceAbsorb === "function") spaceAbsorb(srcId, dstId); // orbital assets follow the merge
  G.wars = (G.wars || []).map(w => ({ a: remap(w.a), b: remap(w.b), start: w.start })).filter(w => w.a !== w.b);
  const seenW = {};
  G.wars = G.wars.filter(w => { const k = Math.min(w.a, w.b) + "_" + Math.max(w.a, w.b); if (seenW[k]) return false; seenW[k] = 1; return true; });
  const dedupePairs = list => {
    const out = [], seen = {};
    for (const p of list || []) {
      const a = remap(p[0]), b = remap(p[1]);
      if (a === b) continue;
      const k = Math.min(a, b) + "_" + Math.max(a, b);
      if (!seen[k]) { seen[k] = 1; out.push([a, b]); }
    }
    return out;
  };
  G.alliances = dedupePairs(G.alliances);
  G.trades = dedupePairs(G.trades);
  G.researchPacts = dedupePairs(G.researchPacts);
  G.accessPacts = (G.accessPacts || []).map(p => [remap(p[0]), remap(p[1])]).filter(p => p[0] !== p[1]);
  for (const pr of G.promises || []) { pr.from = remap(pr.from); pr.to = remap(pr.to); }
  G.promises = (G.promises || []).filter(pr => pr.from !== pr.to);
  const v = {};
  for (const k of Object.keys(G.vassals || {})) {
    const kk = remap(k), vv = remap(G.vassals[k]);
    if (kk !== vv) v[kk] = vv;
  }
  G.vassals = v;
  delete G.rel[srcId]; delete G.trust[srcId];
  for (const k of Object.keys(G.rel)) delete G.rel[k][srcId];
  for (const k of Object.keys(G.trust)) delete G.trust[k][srcId];
  for (const cid of Object.keys(G.countries)) {
    const rt = G.countries[cid].revealTo || {};
    if (rt[srcId]) { rt[dstId] = Math.max(rt[dstId] || 0, rt[srcId]); delete rt[srcId]; }
  }
  if (G.peaceOffers) {
    G.peaceOffers = G.peaceOffers
      .map(o => typeof o === "number" ? remap(o) : { from: remap(o.from), to: remap(o.to) })
      .filter((o, i, arr) => {
        const from = typeof o === "number" ? o : o.from, to = typeof o === "number" ? G.playerId : o.to;
        if (from === to) return false;
        return arr.findIndex(x => (typeof x === "number" ? x : x.from) === from &&
          (typeof x === "number" ? G.playerId : x.to) === to) === i;
      });
  }
  delete G.countries[srcId];
  log(`${D0.name} unites with its splintered lands.`, "sys");
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
