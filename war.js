// ============================================================
// CIVILIZATION: DOMINION — real-time war layer
// Cities live on the map; armies are draggable boxes that move,
// see, shoot and capture in real time. Turn-based economy stays
// in engine.js; this file is the battlefield.
// ============================================================
"use strict";

const CAP_R = 26;        // how close an army must stand to capture a city
const CITY_VIS = 85;     // vision radius provided by an owned city
const HEAL_R = 42;       // heal when resting near an own city

let CITIES = [];         // [{cid, pi, prov}] flattened city list
let CITY_ARR = null;     // Uint16 per map pixel: city index + 1 (voronoi patch within each country)
let selArmies = [];      // selected army ids (player)
let placingUnit = null;  // unit id being placed via Recruit
let shotsFx = [];        // {x1,y1,x2,y2,ttl,max,kind}
let boomFx = [];         // {x,y,ttl,max,kind?,r?}
let missilesFly = [];    // strategic missiles in flight (see launchMissile)
let smokeFx = [];        // {x,y,ttl,max,r} — trails
let sparkFx = [];        // {x,y,ttl,max,kind} — muzzle flashes & impacts
let debrisFx = [];       // {x,y,vx,vy,ttl,max,col} — debris & rubble
let warLoopStarted = false;
let lastTs = 0, cbTimer = 0, aiTimer = 0, sndTimer = 0, econTimer = 0;
let cityLayerDirty = true, cityZoomBig = null;
let selBox = null;       // {x0,y0,x1,y1} while shift-dragging a selection box (ui.js)
let warNow = 0;          // battlefield clock (seconds, pauses with the game)
const armyEls = new Map();  // army id -> DOM element (per-frame lookups were costing real time)
const visCache = new Map(); // army id -> visible-to-player, refreshed a few times per second
let visTimer = 0;

// ---------------- city placement ----------------
function placeCities() {
  // farthest-point sampling of each country's land pixels
  for (const meta of MAP_META.countries) {
    const c = G.countries[meta.id];
    const pts = [];
    const [x0, y0, x1, y1] = meta.bbox;
    const step = Math.max(2, Math.round(Math.sqrt(meta.area) / 26));
    for (let y = y0; y <= y1; y += step) {
      for (let x = x0; x <= x1; x += step) {
        const i = y * MW + x;
        if (ID_ARR[i] === meta.id && LAND_ARR[i]) pts.push([x, y]);
      }
    }
    if (!pts.length) pts.push([meta.cx, meta.cy]);
    const chosen = [[meta.cx, meta.cy]];
    while (chosen.length < c.provinces.length) {
      let best = null, bestD = -1;
      for (const pt of pts) {
        let d = Infinity;
        for (const ch of chosen) d = Math.min(d, (pt[0] - ch[0]) ** 2 + (pt[1] - ch[1]) ** 2);
        if (d > bestD) { bestD = d; best = pt; }
      }
      chosen.push(best || pts[Math.floor(Math.random() * pts.length)]);
    }
    c.provinces.forEach((p, i) => { p.px = chosen[i][0]; p.py = chosen[i][1]; });
  }
}

function rebuildCityIndex() {
  CITIES = [];
  const byCountry = {};
  for (const cid of Object.keys(G.countries)) {
    const c = G.countries[cid];
    byCountry[cid] = [];
    c.provinces.forEach((p, pi) => {
      byCountry[cid].push(CITIES.length);
      CITIES.push({ cid: Number(cid), pi, prov: p });
    });
  }
  CITY_ARR = new Uint16Array(MW * MH);
  // player-drawn provinces own exactly their painted shape (stored as RLE runs)
  const drawnOwner = new Uint16Array(MW * MH);
  for (let gi = 0; gi < CITIES.length; gi++) {
    const p = CITIES[gi].prov;
    if (!p.drawn) continue;
    for (let k = 0; k + 2 < p.drawn.length; k += 3) {
      const y = p.drawn[k], x0 = p.drawn[k + 1], len = p.drawn[k + 2];
      if (y < 0 || y >= MH) continue;
      for (let x = Math.max(0, x0); x < Math.min(MW, x0 + len); x++) {
        const i = y * MW + x;
        if (LAND_ARR[i]) drawnOwner[i] = gi + 1;
      }
    }
  }
  for (let i = 0; i < MW * MH; i++) {
    const id = ID_ARR[i];
    if (!id || !LAND_ARR[i]) continue;
    if (drawnOwner[i]) { CITY_ARR[i] = drawnOwner[i]; continue; }
    const list = byCountry[id];
    if (!list || !list.length) continue;
    const x = i % MW, y = (i / MW) | 0;
    let best = -1, bestD = Infinity;
    for (const gi of list) {
      const p = CITIES[gi].prov;
      if (p.drawn) continue; // drawn provinces never spread beyond their shape
      const d = (p.px - x) ** 2 + (p.py - y) ** 2;
      if (d < bestD) { bestD = d; best = gi; }
    }
    if (best < 0) best = list[0];
    CITY_ARR[i] = best + 1;
  }
  if (typeof roadsMarkDirty === "function") roadsMarkDirty();
}

// Every nation — the player included — starts with the same competitive
// garrison: warriors and a guard in every city, a stronger capital.
function initialGarrisons() {
  for (const cid of Object.keys(G.countries)) {
    const c = G.countries[cid];
    c.provinces.forEach((p, i) => {
      recruitAt(cid, "club", p);
      recruitAt(cid, "guard", p);
      if (i === c.capital) { recruitAt(cid, "guard", p); recruitAt(cid, "club", p); recruitAt(cid, "club", p); }
    });
  }
}

// called by ui.js when a game starts (new or loaded)
function warSessionStart() {
  const firstId = MAP_META.countries[0].id;
  if (!G.countries[firstId].provinces[0].px) placeCities();
  rebuildCityIndex();
  if (!G.armies || !G.armies.length) { G.armies = G.armies || []; if (G.turn <= 1) initialGarrisons(); }
  // legacy saves could leave land troops mid-ocean — bring them ashore
  for (const a of G.armies) {
    if (!UNITS[a.unit].naval && !UNITS[a.unit].air && !isLand(a.x, a.y)) {
      const l = findLandNear(a.x, a.y, 160);
      if (l) { a.x = l.x; a.y = l.y; a.tx = l.x; a.ty = l.y; a.order = null; }
    }
    a.boarding = null; // ferry bookkeeping is rebuilt live by the AI
    if (a.mission && (!UNITS[a.unit].cap)) a.mission = null;
  }
  selArmies = []; placingUnit = null; shotsFx = []; boomFx = [];
  missilesFly = []; smokeFx = []; sparkFx = []; debrisFx = [];
  selBox = null; econTimer = 0;
  armyEls.clear(); visCache.clear();
  const layer = document.getElementById("army-layer");
  if (layer) layer.innerHTML = "";
  cityLayerDirty = true;
  if (typeof spaceSessionStart === "function") spaceSessionStart();
  if (!warLoopStarted) { warLoopStarted = true; requestAnimationFrame(warFrame); }
}

function mapOwnershipChanged() {
  cityLayerDirty = true;
  if (typeof roadsMarkDirty === "function") roadsMarkDirty();
  if (typeof NET !== "undefined" && NET.active && NET.isHost) NET.mapDirty = true;
  if (typeof repaintTint === "function" && typeof ID_ARR !== "undefined" && ID_ARR) repaintTint();
}

// ---------------- helpers ----------------
function provCtrl(p) { return p.occ || p.own; }
function isLand(x, y) {
  const i = (y | 0) * MW + (x | 0);
  return i >= 0 && i < MW * MH && !!LAND_ARR[i];
}
// spiral-search for the nearest land / water pixel
function findTerrainNear(x, y, maxR, wantLand) {
  x = clamp(Math.round(x), 2, MW - 3); y = clamp(Math.round(y), 2, MH - 3);
  if (isLand(x, y) === !!wantLand) return { x, y };
  for (let r = 4; r <= maxR; r += 4) {
    const n = Math.max(8, Math.round(r * 1.2));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = Math.round(x + Math.cos(a) * r), py = Math.round(y + Math.sin(a) * r);
      if (px < 2 || py < 2 || px >= MW - 2 || py >= MH - 2) continue;
      if (isLand(px, py) === !!wantLand) return { x: px, y: py };
    }
  }
  return null;
}
function findWaterNear(x, y, maxR) { return findTerrainNear(x, y, maxR, 0); }
function findLandNear(x, y, maxR) { return findTerrainNear(x, y, maxR, 1); }
function cityAt(x, y, r) {
  let best = null, bestD = (r || 14) ** 2;
  for (const c of CITIES) {
    const d = (c.prov.px - x) ** 2 + (c.prov.py - y) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}
function armyById(id) { return G.armies.find(a => a.id === id); }
function homeOf(gi) { return G.countries[CITIES[gi].cid]; }

// do two nations hold cities on a common landmass? (COMP_ARR from ui.js)
function sharesLandComp(a, b) {
  if (typeof COMP_ARR === "undefined" || !COMP_ARR) return true;
  const mine = {};
  for (const e of provsOfNation(a)) mine[compAt(e.p.px, e.p.py)] = 1;
  for (const e of provsOfNation(b)) if (mine[compAt(e.p.px, e.p.py)]) return true;
  return false;
}

function isVisibleToPlayer(a) {
  const pid = G.playerId;
  if (a.owner === pid) return true;
  if (G.sandbox && G.sandbox.vision) return true;
  const P = G.countries[pid];
  if (mods(P).vision) return true;
  if ((P.revealTo || {})[a.owner]) return true;
  for (const m of G.armies) {
    if (m.owner !== pid) continue;
    const v = UNITS[m.unit].vis;
    if ((m.x - a.x) ** 2 + (m.y - a.y) ** 2 <= v * v) return true;
  }
  for (const c of CITIES) {
    if (provCtrl(c.prov) !== pid) continue;
    if ((c.prov.px - a.x) ** 2 + (c.prov.py - a.y) ** 2 <= CITY_VIS * CITY_VIS) return true;
  }
  return false;
}

// ---------------- vehicle art (Part 3 §1) ----------------
// Vehicles are no longer emoji-in-a-box: each gets a small SVG silhouette,
// hull-tinted with its owner's colour. Infantry keeps the classic box.
const VEHICLE_UNITS = new Set(["chariot","galley","transport","frigate","tanks","mechinf","aircraft",
  "destroyer","drones","missiles","cruiser","hover","starfleet","railgun","rocket","cargoship","stardestroyer"]);
function shadeCol(c, f) {
  return `rgb(${clamp(Math.round(c[0] * f), 0, 255)},${clamp(Math.round(c[1] * f), 0, 255)},${clamp(Math.round(c[2] * f), 0, 255)})`;
}
function vehicleSVG(uId, col) {
  const hull = shadeCol(col, 1.0), dark = shadeCol(col, 0.52), lite = shadeCol(col, 1.55);
  const glow = "#7fdfff", outline = `stroke="rgba(0,0,0,.4)" stroke-width=".6"`;
  let s = "";
  switch (uId) {
    case "chariot":
      s = `<polygon points="6,10 24,10 26,14 4,14" fill="${hull}" ${outline}/>
        <circle cx="10" cy="17" r="4.4" fill="none" stroke="${dark}" stroke-width="2"/>
        <circle cx="21" cy="17" r="3.2" fill="none" stroke="${dark}" stroke-width="1.8"/>
        <circle cx="12" cy="6" r="2.4" fill="${lite}"/>
        <line x1="14" y1="8" x2="33" y2="3" stroke="${lite}" stroke-width="1.4"/>`;
      break;
    case "galley":
      s = `<path d="M3,15 Q18,23 33,15 L30,12 L6,12 Z" fill="${hull}" ${outline}/>
        <line x1="18" y1="12" x2="18" y2="2" stroke="${dark}" stroke-width="1.4"/>
        <polygon points="18,3 29,8 18,11" fill="${lite}"/>
        <line x1="8" y1="16" x2="6" y2="20" stroke="${dark}" stroke-width="1"/>
        <line x1="14" y1="17" x2="12" y2="21" stroke="${dark}" stroke-width="1"/>
        <line x1="21" y1="17" x2="19" y2="21" stroke="${dark}" stroke-width="1"/>`;
      break;
    case "transport":
      s = `<polygon points="2,18 32,18 35,12 5,12" fill="${hull}" ${outline}/>
        <rect x="8" y="8" width="5" height="4" fill="${dark}"/>
        <rect x="14" y="8" width="5" height="4" fill="${lite}"/>
        <rect x="20" y="8" width="5" height="4" fill="${dark}"/>
        <rect x="27" y="6" width="5" height="6" fill="${lite}"/>
        <rect x="29" y="3" width="1.4" height="3" fill="${dark}"/>`;
      break;
    case "frigate":
      s = `<polygon points="2,17 30,17 35,11 4,11" fill="${hull}" ${outline}/>
        <line x1="12" y1="11" x2="12" y2="2" stroke="${dark}" stroke-width="1.3"/>
        <line x1="22" y1="11" x2="22" y2="3" stroke="${dark}" stroke-width="1.3"/>
        <polygon points="12,2 19,6 12,9" fill="${lite}"/>
        <polygon points="22,3 28,6.5 22,9" fill="${lite}"/>
        <line x1="30" y1="11" x2="36" y2="9" stroke="${dark}" stroke-width="1.2"/>`;
      break;
    case "tanks":
      s = `<rect x="4" y="14" width="27" height="7" rx="3.5" fill="${dark}" ${outline}/>
        <circle cx="10" cy="17.5" r="2" fill="${hull}"/><circle cx="17" cy="17.5" r="2" fill="${hull}"/><circle cx="24" cy="17.5" r="2" fill="${hull}"/>
        <polygon points="6,14 29,14 26,9 9,9" fill="${hull}" ${outline}/>
        <rect x="13" y="5" width="9" height="5" rx="1.5" fill="${hull}" ${outline}/>
        <rect x="21" y="6.6" width="13" height="1.8" fill="${dark}"/>`;
      break;
    case "mechinf":
      s = `<polygon points="4,16 31,16 33,10 26,6 9,6 3,10" fill="${hull}" ${outline}/>
        <circle cx="9" cy="17" r="3" fill="${dark}"/><circle cx="17" cy="17" r="3" fill="${dark}"/><circle cx="25" cy="17" r="3" fill="${dark}"/>
        <rect x="14" y="3.6" width="6" height="3" fill="${dark}"/>
        <line x1="20" y1="4.8" x2="27" y2="3" stroke="${dark}" stroke-width="1.2"/>
        <rect x="27" y="10" width="4" height="2.4" fill="${lite}"/>`;
      break;
    case "aircraft":
      s = `<polygon points="35,12 22,8.6 5,10.4 2,12 5,13.6 22,15.4" fill="${hull}" ${outline}/>
        <polygon points="18,11 8,2 14,11.4" fill="${dark}"/>
        <polygon points="18,13 8,22 14,12.6" fill="${dark}"/>
        <polygon points="6,11 1,6 5,11.4" fill="${dark}"/>
        <circle cx="28" cy="11.6" r="1.4" fill="${lite}"/>`;
      break;
    case "destroyer":
      s = `<polygon points="1,17 31,17 35,12 4,12" fill="${hull}" ${outline}/>
        <rect x="11" y="7" width="10" height="5" fill="${dark}"/>
        <rect x="14" y="4" width="4" height="3" fill="${dark}"/>
        <line x1="16" y1="4" x2="16" y2="1" stroke="${dark}" stroke-width="1"/>
        <rect x="25" y="9.4" width="4.4" height="2.6" fill="${dark}"/>
        <line x1="29" y1="10.4" x2="35" y2="9.4" stroke="${dark}" stroke-width="1.3"/>`;
      break;
    case "drones":
      s = `<ellipse cx="8" cy="6.5" rx="5.5" ry="1.5" fill="${lite}" opacity=".8"/>
        <ellipse cx="28" cy="6.5" rx="5.5" ry="1.5" fill="${lite}" opacity=".8"/>
        <line x1="10" y1="8" x2="16" y2="12" stroke="${dark}" stroke-width="1.4"/>
        <line x1="26" y1="8" x2="20" y2="12" stroke="${dark}" stroke-width="1.4"/>
        <ellipse cx="18" cy="13.5" rx="4.5" ry="3.4" fill="${hull}" ${outline}/>
        <circle cx="18" cy="17.5" r="1.1" fill="${glow}"/>`;
      break;
    case "missiles":
      s = `<rect x="3" y="12.6" width="7" height="5.4" rx="1" fill="${hull}" ${outline}/>
        <rect x="10" y="14" width="21" height="4" fill="${dark}"/>
        <circle cx="8" cy="19.4" r="2" fill="${dark}"/><circle cx="16" cy="19.4" r="2" fill="${dark}"/><circle cx="24" cy="19.4" r="2" fill="${dark}"/><circle cx="29" cy="19.4" r="2" fill="${dark}"/>
        <polygon points="12,15.6 29,4.4 31,6.2 14,17.4" fill="${hull}" ${outline}/>
        <polygon points="27,4.4 32,1.6 33.4,3.4 30,7" fill="#e8eef6"/>`;
      break;
    case "cruiser":
      s = `<polygon points="0,17 33,17 36,12.4 3,12.4" fill="${hull}" ${outline}/>
        <polygon points="9,12.4 9,6 19,6 23,9.4 23,12.4" fill="${dark}"/>
        <rect x="12" y="3" width="4.6" height="3" fill="${lite}"/>
        <rect x="25" y="10.6" width="1.7" height="1.8" fill="${dark}"/><rect x="27.6" y="10.6" width="1.7" height="1.8" fill="${dark}"/><rect x="30.2" y="10.6" width="1.7" height="1.8" fill="${dark}"/>`;
      break;
    case "hover":
      s = `<ellipse cx="18" cy="19.6" rx="12" ry="2.4" fill="${glow}" opacity=".4"/>
        <polygon points="5,14 31,14 35,10 24,5.4 11,5.4 1,10" fill="${hull}" ${outline}/>
        <rect x="9" y="14.6" width="5" height="2" fill="${dark}"/><rect x="22" y="14.6" width="5" height="2" fill="${dark}"/>
        <rect x="26" y="8.4" width="6" height="2" fill="${lite}"/>`;
      break;
    case "starfleet":
      s = `<polygon points="35,12 25,7.6 6,8.8 1.6,12 6,15.2 25,16.4" fill="${hull}" ${outline}/>
        <polygon points="15,8.8 10,2 19,8.2" fill="${dark}"/>
        <circle cx="28.6" cy="11.6" r="1.5" fill="${lite}"/>
        <circle cx="3.6" cy="10.6" r="1.3" fill="${glow}"/><circle cx="3.6" cy="13.4" r="1.3" fill="${glow}"/>`;
      break;
    case "railgun":
      s = `<ellipse cx="16" cy="20" rx="9" ry="1.6" fill="${glow}" opacity=".3"/>
        <rect x="7" y="13" width="19" height="4.6" rx="2" fill="${hull}" ${outline}/>
        <polygon points="11,13 30,3.4 32,5 14,14.4" fill="${dark}"/>
        <line x1="12" y1="14.6" x2="33" y2="3.6" stroke="${lite}" stroke-width="1"/>
        <circle cx="32.4" cy="4" r="1.5" fill="${glow}"/>`;
      break;
    case "rocket":
      s = `<polygon points="15.4,5 20.6,5 18,0.6" fill="${lite}"/>
        <rect x="15.4" y="5" width="5.2" height="13" rx="1.6" fill="${hull}" ${outline}/>
        <circle cx="18" cy="8.6" r="1.3" fill="${glow}"/>
        <polygon points="15.4,14 11,20 15.4,18" fill="${dark}"/>
        <polygon points="20.6,14 25,20 20.6,18" fill="${dark}"/>
        <rect x="16.4" y="18" width="3.2" height="2.4" fill="${dark}"/>`;
      break;
    case "cargoship":
      s = `<rect x="7" y="7.6" width="22" height="9.4" rx="4.4" fill="${hull}" ${outline}/>
        <rect x="4" y="9.6" width="3.4" height="5.4" rx="1" fill="${dark}"/>
        <rect x="28.6" y="9.6" width="3.4" height="5.4" rx="1" fill="${dark}"/>
        <circle cx="26.6" cy="12.2" r="1.6" fill="${lite}"/>
        <circle cx="3" cy="11" r="1.2" fill="${glow}"/><circle cx="3" cy="14" r="1.2" fill="${glow}"/>`;
      break;
    case "stardestroyer":
      s = `<polygon points="35.4,12 4,2.6 8.4,12 4,21.4" fill="${hull}" ${outline}/>
        <polygon points="35.4,12 11,9 11,15" fill="${lite}" opacity=".5"/>
        <rect x="8.4" y="9.8" width="4.4" height="4.4" fill="${dark}"/>
        <circle cx="10.6" cy="12" r="1" fill="${glow}"/>
        <circle cx="5.4" cy="6.4" r="1.2" fill="${glow}"/><circle cx="7" cy="12" r="1.2" fill="${glow}"/><circle cx="5.4" cy="17.6" r="1.2" fill="${glow}"/>`;
      break;
    default: return null;
  }
  return `<svg viewBox="0 0 36 24" xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
}

// ---------------- roads (Part 3 §2) ----------------
// Every nation's cities on a landmass are linked by a small spanning network.
// Roads restyle as their owner advances: dirt path → stone road → road +
// railway → highway → glowing transit line. Armies on a road march a little
// faster, and connected cities pay a small economy bonus (see production()).
let ROAD_ARR = null;
let roadsDirtyFlag = true;
const ROAD_SPEED_BONUS = 1.18;
function roadsMarkDirty() { roadsDirtyFlag = true; }

// greedy land-following walk from city to city; gives up instead of bridging oceans
function roadPathBetween(ax, ay, bx, by) {
  const pts = [[ax, ay]];
  let x = ax, y = ay;
  for (let step = 0; step < 420; step++) {
    const dx = bx - x, dy = by - y;
    const d = Math.hypot(dx, dy);
    if (d < 8) { pts.push([bx, by]); return pts; }
    const base = Math.atan2(dy, dx);
    let moved = false;
    for (const off of [0, 0.45, -0.45, 0.95, -0.95, 1.5, -1.5]) {
      const nx = x + Math.cos(base + off) * 6, ny = y + Math.sin(base + off) * 6;
      if (nx < 2 || ny < 2 || nx >= MW - 2 || ny >= MH - 2) continue;
      if (isLand(nx, ny)) { x = nx; y = ny; moved = true; break; }
    }
    if (!moved) return null;
    pts.push([x, y]);
  }
  return null;
}

// QoL §11-12: every city joins a connected national network (the capital
// links the majors, big cities earn extra spurs, no duplicate roads), and
// trading neighbours at peace grow international roads across the border.
function rebuildRoads() {
  roadsDirtyFlag = false;
  const cv = document.getElementById("cv-road");
  if (!cv) return;
  cv.width = MW; cv.height = MH;
  const ctx = cv.getContext("2d");
  ROAD_ARR = new Uint8Array(MW * MH);
  const linked = new Set();
  const linkKey = (a, b) => a.px < b.px || (a.px === b.px && a.py <= b.py)
    ? a.px + "," + a.py + "|" + b.px + "," + b.py
    : b.px + "," + b.py + "|" + a.px + "," + a.py;
  const tryLink = (a, b, era, style) => {
    if (!a || !b || a === b) return false;
    const k = linkKey(a, b);
    if (linked.has(k)) return true; // already connected — no duplicate roads
    const path = roadPathBetween(a.px, a.py, b.px, b.py);
    if (!path) return false;
    linked.add(k);
    drawRoad(ctx, path, era, style);
    return true;
  };
  const groups = {};
  for (const c of CITIES) {
    const ctrl = provCtrl(c.prov);
    const cc = G.countries[ctrl];
    if (!cc || !cc.alive) continue;
    const key = ctrl + "_" + compAt(c.prov.px, c.prov.py);
    (groups[key] = groups[key] || { era: cc.era, ctrl, pts: [] }).pts.push(c.prov);
  }
  for (const key of Object.keys(groups)) {
    const g = groups[key];
    if (g.pts.length < 2) continue;
    // spanning network — every city gains at least one connection
    const inTree = [g.pts[0]], out = g.pts.slice(1);
    while (out.length) {
      let bi = 0, bj = 0, bd = Infinity;
      for (let i = 0; i < inTree.length; i++) for (let j = 0; j < out.length; j++) {
        const d = (inTree[i].px - out[j].px) ** 2 + (inTree[i].py - out[j].py) ** 2;
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
      const b = out.splice(bj, 1)[0];
      // the nearest tree member may be unreachable over land — try the next-closest few
      const cand = inTree.slice().sort((p1, p2) =>
        ((p1.px - b.px) ** 2 + (p1.py - b.py) ** 2) - ((p2.px - b.px) ** 2 + (p2.py - b.py) ** 2));
      for (let i = 0; i < Math.min(4, cand.length); i++) if (tryLink(cand[i], b, g.era)) break;
      inTree.push(b);
    }
    // capitals and large cities earn extra connections
    const home = G.countries[g.ctrl];
    if (g.pts.length >= 3) {
      for (const p of g.pts) {
        const major = (p.lvl || 1) >= 3 || (home && home.provinces[home.capital] === p);
        if (!major) continue;
        const near = g.pts.filter(q => q !== p).sort((q1, q2) =>
          ((q1.px - p.px) ** 2 + (q1.py - p.py) ** 2) - ((q2.px - p.px) ** 2 + (q2.py - p.py) ** 2));
        let added = 0;
        for (const q of near) { if (tryLink(p, q, g.era) && ++added >= 2) break; }
      }
    }
  }
  // international roads: an active trade agreement, peace, and a shared border
  for (const t of G.trades || []) {
    const a = t[0], b = t[1];
    const A = G.countries[a], B = G.countries[b];
    if (!A || !B || !A.alive || !B.alive || atWar(a, b)) continue;
    const ma = metaOf(a), mb = metaOf(b);
    if (!ma || !mb || !ma.neighbors.includes(Number(b))) continue;
    const pa = provsOwned(a), pb = provsOwned(b);
    if (!pa.length || !pb.length) continue;
    let best = null, bd = Infinity;
    for (const p1 of pa) for (const p2 of pb) {
      const d = (p1.px - p2.px) ** 2 + (p1.py - p2.py) ** 2;
      if (d < bd) { bd = d; best = [p1, p2]; }
    }
    if (best && bd < 380 * 380) tryLink(best[0], best[1], Math.min(A.era, B.era), "trade");
  }
}

function drawRoad(ctx, pts, era, style) {
  const poly = (list, ox, oy) => {
    ctx.beginPath();
    ctx.moveTo(list[0][0] + (ox || 0), list[0][1] + (oy || 0));
    for (let i = 1; i < list.length; i++) ctx.lineTo(list[i][0] + (ox || 0), list[i][1] + (oy || 0));
    ctx.stroke();
  };
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (era <= 1) {           // primitive footpath
    ctx.strokeStyle = "rgba(122,92,56,.42)"; ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]); poly(pts); ctx.setLineDash([]);
  } else if (era <= 3) {    // ancient / medieval stone road
    ctx.strokeStyle = "rgba(170,142,98,.55)"; ctx.lineWidth = 1.6; poly(pts);
  } else if (era === 4) {   // industrial road + railway alongside
    ctx.strokeStyle = "rgba(94,76,54,.75)"; ctx.lineWidth = 2; poly(pts);
    ctx.strokeStyle = "rgba(38,38,44,.85)"; ctx.lineWidth = 1.1; poly(pts, 2.5, 2.5);
    ctx.lineWidth = 1;
    for (let i = 3; i < pts.length; i += 3) {
      const x = pts[i][0] + 2.5, y = pts[i][1] + 2.5;
      ctx.beginPath(); ctx.moveTo(x - 1.6, y - 1.6); ctx.lineTo(x + 1.6, y + 1.6); ctx.stroke();
    }
  } else if (era <= 6) {    // modern asphalt & marked highways
    ctx.strokeStyle = era === 5 ? "rgba(52,56,64,.85)" : "rgba(42,48,58,.9)";
    ctx.lineWidth = era === 5 ? 2.4 : 3; poly(pts);
    ctx.strokeStyle = era === 5 ? "rgba(240,190,90,.8)" : "rgba(235,240,255,.85)";
    ctx.lineWidth = 0.7; ctx.setLineDash([4, 5]); poly(pts); ctx.setLineDash([]);
  } else {                  // futuristic energy transit lines
    const soft = era >= 9 ? "rgba(255,127,227,.25)" : "rgba(90,220,255,.25)";
    const core = era >= 9 ? "rgba(255,196,242,.9)" : "rgba(172,240,255,.9)";
    ctx.strokeStyle = soft; ctx.lineWidth = 3.6; poly(pts);
    ctx.strokeStyle = core; ctx.lineWidth = 1.1; poly(pts);
  }
  if (style === "trade") { // international trade road: golden caravan markings
    ctx.strokeStyle = "rgba(240,196,90,.6)";
    ctx.lineWidth = 0.8;
    ctx.setLineDash([1.5, 6]); poly(pts); ctx.setLineDash([]);
  }
  for (const pt of pts) { // stamp into ROAD_ARR for the march bonus
    const xi = pt[0] | 0, yi = pt[1] | 0;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const i = (yi + oy) * MW + (xi + ox);
      if (i >= 0 && i < MW * MH) ROAD_ARR[i] = 1;
    }
  }
}
function onRoad(x, y) {
  if (!ROAD_ARR) return false;
  const i = (y | 0) * MW + (x | 0);
  return i >= 0 && i < MW * MH && !!ROAD_ARR[i];
}

// ---------------- day & night (Part 3 §3) ----------------
// The planet fades through a gentle day/night cycle. At night, cities glow
// according to their owner's era and energy situation — a primitive village is
// one ember, a megastructure-age capital is a lit-up region.
const DAY_CYCLE = 150, NIGHT_MAX_ALPHA = 0.42;
let lightsRedrawTimer = 99;
function dayClock() {
  if (typeof NET !== "undefined" && NET.active && !NET.isHost) return NET.hostNow || 0;
  return warNow;
}
function nightness() {
  // Update §4: a dead (fully harvested) home sun means PERMANENT night — the
  // day cycle stops and no view toggle brings the daylight back
  if (typeof sunDead === "function" && sunDead("home")) return 1;
  if (typeof viewOpts !== "undefined" && viewOpts.dayNight === false) return 0;
  const t = (dayClock() % DAY_CYCLE) / DAY_CYCLE;
  if (t < 0.45) return 0;
  if (t < 0.55) return (t - 0.45) / 0.1;
  if (t < 0.9) return 1;
  return 1 - (t - 0.9) / 0.1;
}
function renderNight(dt) {
  const veil = document.getElementById("night-veil");
  const lights = document.getElementById("cv-lights");
  if (!veil || !lights) return;
  const n = nightness();
  // Update §4: under a dead sun the veil is deeper and colder, but city lights
  // still glow below whenever the grid has energy
  const deadSun = typeof sunDead === "function" && sunDead("home");
  veil.style.background = deadSun ? "#020610" : "";
  veil.style.opacity = (n * (deadSun ? 0.6 : NIGHT_MAX_ALPHA)).toFixed(3);
  // the city-lights layer honours its own visual setting (QoL §16)
  const lightsOn = typeof viewOpts === "undefined" || viewOpts.cityLights !== false;
  lights.style.opacity = lightsOn ? n.toFixed(3) : "0";
  if (n <= 0.02 || !lightsOn) { lightsRedrawTimer = 99; return; }
  lightsRedrawTimer += dt;
  if (lightsRedrawTimer < 2) return;
  lightsRedrawTimer = 0;
  drawCityLights(lights);
}
function lightSeed(x, y, k) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
}
// City lighting follows technology and energy (QoL §8-9):
//   era 1-2 dark · era 3 a few torches · era 4 limited industrial gaslight
//   (major powered cities only) · era 5 electric · era 6 bright · era 7 neon
//   · era 8-9 blazing arcologies. An energy shortage still means blackout.
function drawCityLights(cv) {
  cv.width = MW; cv.height = MH;
  const ctx = cv.getContext("2d");
  const energyOK = {};
  for (const c of CITIES) {
    const ctrl = provCtrl(c.prov);
    const cc = G.countries[ctrl];
    if (!cc || !cc.alive) continue;
    if (energyOK[ctrl] === undefined) energyOK[ctrl] = production(cc).energy >= 0;
    const era = cc.era, lvl = c.prov.lvl || 1;
    const px = c.prov.px, py = c.prov.py;
    const dim = energyOK[ctrl] ? 1 : 0.35; // energy shortage = blackout
    if (era <= 2) continue; // no electric light before the Medieval Era
    if (era === 3) {        // medieval: nothing but small fires and torches
      ctx.fillStyle = `rgba(255,178,96,${0.5 * dim})`;
      for (let i = 0; i < 1 + (lvl > 2 ? 1 : 0); i++) {
        const a = lightSeed(px, py, i) * Math.PI * 2;
        ctx.beginPath(); ctx.arc(px + Math.cos(a) * 2.5, py + Math.sin(a) * 2.5, 1, 0, Math.PI * 2); ctx.fill();
      }
      continue;
    }
    if (era === 4) {        // industrial: limited light, only in developed powered cities
      const isCap = G.countries[c.cid].capital === c.pi && c.prov.own === c.cid;
      const powered = (c.prov.b.power || 0) > 0 || (c.prov.b.factory || 0) > 0;
      if (!powered && !isCap && lvl < 2) continue;
      const g4 = ctx.createRadialGradient(px, py, 0, px, py, 4 + lvl);
      g4.addColorStop(0, `rgba(255,190,110,${0.32 * dim})`);
      g4.addColorStop(1, "rgba(255,190,110,0)");
      ctx.fillStyle = g4;
      ctx.beginPath(); ctx.arc(px, py, 4 + lvl, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,200,120,${0.8 * dim})`;
      for (let i = 0; i < 2 + lvl; i++) {
        const a = lightSeed(px, py, i) * Math.PI * 2;
        ctx.fillRect(px + Math.cos(a) * (2 + lightSeed(px, py, i + 9) * 3), py + Math.sin(a) * (2 + lightSeed(px, py, i + 17) * 3), 1, 1);
      }
      continue;
    }
    // era 5+: real electric cityscapes, growing with every age
    const glowR = (era >= 8 ? 16 : era === 7 ? 12 : era === 6 ? 9 : 6) + lvl;
    const glowCol = era >= 8 ? "127,190,255" : era === 7 ? "110,235,255" : era === 6 ? "220,235,255" : "255,214,130";
    const g = ctx.createRadialGradient(px, py, 0, px, py, glowR);
    g.addColorStop(0, `rgba(${glowCol},${(era >= 7 ? 0.55 : era === 6 ? 0.45 : 0.38) * dim})`);
    g.addColorStop(1, `rgba(${glowCol},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(px, py, glowR, 0, Math.PI * 2); ctx.fill();
    const nDots = Math.min(typeof PERF !== "undefined" && PERF.low ? 10 : 26, (era - 3) * 3 + lvl * 2);
    ctx.fillStyle = `rgba(${glowCol},${0.9 * dim})`;
    for (let i = 0; i < nDots; i++) {
      const a = lightSeed(px, py, i) * Math.PI * 2;
      const r = 2 + lightSeed(px, py, i + 50) * glowR * 0.85;
      ctx.fillRect(px + Math.cos(a) * r, py + Math.sin(a) * r, era >= 6 ? 1.2 : 1, era >= 6 ? 1.2 : 1);
    }
    // lit roads leading out of advanced cities (QoL §9) — skipped in performance mode
    if (era >= 6 && ROAD_ARR && !(typeof PERF !== "undefined" && PERF.low)) {
      ctx.fillStyle = `rgba(${glowCol},${0.35 * dim})`;
      const R = glowR + 14;
      for (let oy = -R; oy <= R; oy += 2) for (let ox = -R; ox <= R; ox += 2) {
        if (ox * ox + oy * oy > R * R) continue;
        const i = (py + oy) * MW + (px + ox);
        if (i >= 0 && i < MW * MH && ROAD_ARR[i]) ctx.fillRect(px + ox, py + oy, 1, 1);
      }
    }
    if (era >= 9 && (((c.prov.b || {}).spaceprogram || 0) > 0 || lvl >= 4)) {
      ctx.strokeStyle = `rgba(255,160,240,${0.5 * dim})`; // arcology beacon ring
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(px, py, glowR * 0.6, 0, Math.PI * 2); ctx.stroke();
    }
    if (era >= 8) { // futuristic energy shimmer
      ctx.strokeStyle = `rgba(${glowCol},${0.25 * dim})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(px, py, glowR * 0.85, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

// ---------------- construction effects (Part 3 §6) ----------------
function buildCompleteFx(prov) {
  if (typeof viewOpts !== "undefined" && viewOpts.buildFx === false) return; // QoL §16
  if (boomFx.length < 200) boomFx.push({ x: prov.px, y: prov.py, ttl: 0.7, max: 0.7, kind: "build", r: 16 });
}

// ---------------- ambient traffic (QoL §14-15) ----------------
// Purely visual: once a nation researches Flight, small planes drift between
// its cities; in the Interplanetary Era some become civilian spaceships that
// climb out of the atmosphere. Never clickable, never simulated, never synced.
let ambientCraft = [];
let ambientTimer = 2;
const AMBIENT_CAP = 10;
// BUG 2 (mobile performance mode): particle & effect budgets shrink on weak
// devices — purely visual, no gameplay effect
function fxCap(n) { return (typeof PERF !== "undefined" && PERF.low) ? Math.ceil(n * 0.35) : n; }
function tickAmbient(dt) {
  if (typeof viewOpts !== "undefined" && viewOpts.ambient === false) { ambientCraft = []; return; }
  if (typeof PERF !== "undefined" && PERF.low && ambientCraft.length >= 3) return; // performance mode: a couple at most
  if (typeof homeworldScorched === "function" && homeworldScorched()) { ambientCraft = []; return; }
  ambientTimer -= dt;
  if (ambientTimer <= 0 && ambientCraft.length < AMBIENT_CAP) {
    ambientTimer = rnd(1.6, 3.6);
    spawnAmbientCraft();
  }
  ambientCraft = ambientCraft.filter(a => (a.t += dt / a.dur) < 1);
}
function spawnAmbientCraft() {
  const ids = Object.keys(G.countries).map(Number).filter(i => {
    const c = G.countries[i];
    return c.alive && !c.rebel && !c.alien && c.researched && c.researched.flight;
  });
  if (!ids.length) return;
  const cid = pick(ids);
  const c = G.countries[cid];
  const cities = provsOwned(cid);
  if (cities.length < 2) return;
  const a = pick(cities), b = pick(cities);
  if (a === b) return;
  const spacefaring = c.era >= 8 && c.researched.colonyships && Math.random() < 0.45;
  const d = Math.hypot(b.px - a.px, b.py - a.py);
  ambientCraft.push({
    x0: a.px, y0: a.py, x1: b.px, y1: b.py, t: 0,
    dur: clamp(d / 70, 3.5, 12), kind: spacefaring ? "ship" : "plane",
    col: c.flag.bg, up: spacefaring && Math.random() < 0.5, // some ships leave the atmosphere
  });
}
function drawAmbientCraft(ctx) {
  for (const a of ambientCraft) {
    const t = a.t;
    const x = a.x0 + (a.x1 - a.x0) * t, y = a.y0 + (a.y1 - a.y0) * t;
    const climb = a.up ? t * 26 : Math.sin(Math.PI * t) * 5; // planes hop, departing ships climb away
    const alpha = a.up ? Math.max(0, 1 - t * 1.15) : Math.min(1, Math.sin(Math.PI * t) * 3);
    if (alpha <= 0.02) continue;
    const ang = Math.atan2(a.y1 - a.y0, a.x1 - a.x0);
    ctx.save();
    ctx.translate(x, y - climb);
    ctx.rotate(a.up ? ang - 0.5 : ang);
    ctx.globalAlpha = alpha * 0.85;
    if (a.kind === "ship") {
      ctx.fillStyle = "rgba(160,220,255,.9)";
      ctx.beginPath(); ctx.moveTo(3.2, 0); ctx.lineTo(-2.4, -1.3); ctx.lineTo(-1.4, 0); ctx.lineTo(-2.4, 1.3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(120,240,255,.8)"; // engine glow
      ctx.fillRect(-3.2, -0.5, 1.2, 1);
    } else {
      ctx.fillStyle = "rgba(225,235,245,.9)";
      ctx.beginPath(); ctx.moveTo(3, 0); ctx.lineTo(-2.5, -0.6); ctx.lineTo(-2.5, 0.6); ctx.closePath(); ctx.fill();
      ctx.fillRect(-0.6, -2.1, 1, 4.2); // wings
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    // a faint shadow keeps the craft readable over any terrain
    ctx.fillStyle = `rgba(0,0,0,${0.12 * alpha})`;
    ctx.beginPath(); ctx.ellipse(x, y + 2, 2.4, 1, 0, 0, Math.PI * 2); ctx.fill();
  }
}

// ---------------- planetary fire (Space Update Part 2) ----------------
// While the Homeworld is scorched, the whole map burns: an ember veil plus
// procedurally flickering flames near every ruined city.
function drawScorchedWorld(ctx) {
  ctx.fillStyle = "rgba(120,30,8,.30)";
  ctx.fillRect(0, 0, MW, MH);
  const t = warNow;
  for (const c of CITIES) {
    const p = c.prov;
    for (let i = 0; i < 5; i++) {
      const s1 = lightSeed(p.px, p.py, i), s2 = lightSeed(p.px, p.py, i + 33);
      const fx = p.px + (s1 - 0.5) * 26, fy = p.py + (s2 - 0.5) * 26;
      const flick = 0.5 + 0.5 * Math.sin(t * (3 + s1 * 4) + i * 2.1);
      const h = 2.5 + flick * 3.5;
      ctx.fillStyle = `rgba(255,${120 + (s2 * 80) | 0},40,${0.35 + flick * 0.4})`;
      ctx.beginPath();
      ctx.moveTo(fx - 1.4, fy);
      ctx.quadraticCurveTo(fx, fy - h, fx + 1.4, fy);
      ctx.closePath(); ctx.fill();
    }
    // smoke plume
    const sm = 0.5 + 0.5 * Math.sin(t * 0.7 + p.px);
    ctx.fillStyle = `rgba(60,50,50,${0.18 + sm * 0.12})`;
    ctx.beginPath(); ctx.ellipse(p.px + 3, p.py - 9 - sm * 3, 4 + sm * 2, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  }
}

// ---------------- player input (called from ui.js) ----------------
function warStartPlacing(uId) {
  placingUnit = uId;
  selArmies = [];
  updateWarHint();
}
function warCancel() {
  placingUnit = null; selArmies = [];
  sandboxSpawnMode = false;
  updateWarHint();
}
function warHasFocus() { return placingUnit !== null || selArmies.length > 0; }

// returns true if the click was consumed by the war layer
let sandboxSpawnMode = false; // sandbox: drop units anywhere on the map
function warMapClick(mx, my, e) {
  if (!G || G.defeated) return false;
  const pid = G.playerId;
  if (placingUnit) {
    const P = G.countries[pid];
    if (G.sandbox && sandboxSpawnMode) {
      const naval = !!UNITS[placingUnit].naval;
      const spot = naval ? (isLand(mx, my) ? findWaterNear(mx, my, 120) : { x: mx, y: my })
                         : (isLand(mx, my) ? { x: mx, y: my } : findLandNear(mx, my, 120));
      if (!spot) { toast(naval ? "No water near that spot." : "No land near that spot."); return true; }
      const cost = recruitCost(P, placingUnit);
      if (P.res.money < cost.money || P.res.mat < cost.mat) { toast("Not enough resources."); warCancel(); return true; }
      P.res.money -= cost.money; P.res.mat -= cost.mat;
      spawnArmy(pid, placingUnit, spot.x, spot.y);
      sfx("recruit");
      if (!e.shiftKey) { placingUnit = null; sandboxSpawnMode = false; }
      updateWarHint();
      if (typeof renderTopbar === "function") renderTopbar();
      return true;
    }
    const c = cityAt(mx, my, 18);
    if (c && provCtrl(c.prov) === pid) {
      const pu = UNITS[placingUnit];
      if (pu.naval) {
        const st = navalStatus(c.prov);
        if (!st.coastal) { toast(`${c.prov.city} is inland — ships can only be built by coastal cities.`); return true; }
        if (!st.port && !pu.raft) { toast(`${c.prov.city} has no ⚓ Port. Build one first — every shipyard needs a completed port.`); return true; }
      }
      if (pu.space && !((c.prov.b.spaceprogram || 0) > 0)) {
        toast(`${c.prov.city} has no 🚀 Space Program — spacecraft can only be built in a Space Program city.`);
        return true;
      }
      if (armyCount(pid) >= armyCap(P)) {
        toast(`Army cap reached (${armyCap(P)}). Merge stacks or disband forces before mustering more.`);
        return true;
      }
      const cost = recruitCost(P, placingUnit);
      if (P.res.money < cost.money || P.res.mat < cost.mat) { toast("Not enough resources."); warCancel(); return true; }
      if (typeof netIntercept === "function" && netIntercept("recruit", { u: placingUnit, ph: c.cid, pi: c.pi })) {
        sfx("recruit");
        toast(`${UNITS[placingUnit].n} ordered at ${c.prov.city}.`);
        if (!e.shiftKey) placingUnit = null;
        updateWarHint();
        return true;
      }
      P.res.money -= cost.money; P.res.mat -= cost.mat;
      const queued = isRealtime() && !(G.sandbox && G.sandbox.build);
      queueRecruit(pid, placingUnit, c.prov);
      sfx("recruit");
      toast(queued
        ? `${UNITS[placingUnit].n} mustering at ${c.prov.city} — ready in ~${recruitTicksNeeded(placingUnit) * REALTIME_TICK_SECONDS}s.`
        : `${UNITS[placingUnit].n} mustered at ${c.prov.city}.`);
      if (!e.shiftKey) placingUnit = null;
      updateWarHint();
      if (typeof renderTopbar === "function") renderTopbar();
      if (typeof renderSidebar === "function" && uiTab === "mil") renderSidebar();
      return true;
    }
    toast("Click one of YOUR cities to deploy (Shift-click keeps recruiting, Esc cancels).");
    return true;
  }
  if (selArmies.length) {
    orderMove(mx, my);
    return true;
  }
  return false;
}

function orderMove(mx, my) {
  if (typeof netIntercept === "function" && netIntercept("move", { ids: selArmies.slice(), x: mx, y: my })) { sfx("move"); return; }
  const list = selArmies.map(armyById).filter(Boolean);
  const n = list.length;
  const cols = Math.ceil(Math.sqrt(n));
  list.forEach((a, i) => {
    const ox = (i % cols - (cols - 1) / 2) * 18;
    const oy = (Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2) * 18;
    a.tx = clamp(mx + ox, 2, MW - 2); a.ty = clamp(my + oy, 2, MH - 2);
    a.order = { type: "move" };
  });
  sfx("move");
}

function armyClicked(id, e) {
  const a = armyById(id);
  if (!a || placingUnit) return;
  if (typeof missileTargeting !== "undefined" && missileTargeting) { missileClickTarget(a.x, a.y); return; }
  const pid = G.playerId;
  if (a.owner === pid) {
    // clicking an own transport while troops are selected sends them aboard —
    // land troops for sea transports, land AND air-mobile troops (Orbital
    // Marines) for space cargo craft (SU2 Part 1)
    let landSel = selArmies.map(armyById).filter(s => s && s.id !== id && !UNITS[s.unit].naval && !UNITS[s.unit].space &&
      (!UNITS[s.unit].air || (UNITS[a.unit].cap && UNITS[a.unit].space)));
    if (UNITS[a.unit].cap && landSel.length && landSel.some(s => !canBoardTransport(a, s.unit))) {
      const before = landSel.length;
      landSel = landSel.filter(s => canBoardTransport(a, s.unit));
      if (landSel.length < before) toast(`🛶 Rafts only carry Primitive and Ancient Era troops — ${before - landSel.length} unit${before - landSel.length > 1 ? "s" : ""} cannot board.`);
    }
    if (UNITS[a.unit].cap && landSel.length && !e.ctrlKey && e.detail < 2) {
      if (typeof netIntercept === "function" && netIntercept("board", { ids: landSel.map(s => s.id), ship: a.id })) {
        toast(`${landSel.length} arm${landSel.length > 1 ? "ies" : "y"} moving to board the transport.`);
        sfx("move"); updateWarHint(); return;
      }
      for (const s of landSel) s.order = { type: "board", id: a.id };
      toast(`${landSel.length} arm${landSel.length > 1 ? "ies" : "y"} moving to board the transport.`);
      sfx("move");
      updateWarHint();
      return;
    }
    if (e.ctrlKey) {
      const i = selArmies.indexOf(id);
      if (i >= 0) selArmies.splice(i, 1); else selArmies.push(id);
    } else if (e.detail >= 2) {
      // double click: select all own armies nearby
      selArmies = G.armies.filter(m => m.owner === pid && (m.x - a.x) ** 2 + (m.y - a.y) ** 2 < 3600).map(m => m.id);
    } else {
      selArmies = [id];
    }
    sfx("click");
  } else if (selArmies.length && atWar(pid, a.owner)) {
    if (typeof netIntercept === "function" && netIntercept("attack", { ids: selArmies.slice(), target: a.id })) {
      sfx("move"); updateWarHint(); return;
    }
    for (const sid of selArmies) {
      const s = armyById(sid);
      if (s) { s.order = { type: "attack", id: a.id }; }
    }
    sfx("move");
  }
  updateWarHint();
}

// grow the current selection: every own army near any selected one joins it
function selectNearbySelected() {
  const base = selArmies.map(armyById).filter(Boolean);
  if (!base.length) return;
  for (const m of G.armies) {
    if (m.owner !== G.playerId || selArmies.includes(m.id)) continue;
    if (base.some(b => (m.x - b.x) ** 2 + (m.y - b.y) ** 2 < 90 * 90)) selArmies.push(m.id);
  }
  sfx("click");
  updateWarHint();
}

// rectangle selection from ui.js (shift+drag)
function warBoxSelect(box, additive) {
  const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1);
  const y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
  const ids = G.armies.filter(a => a.owner === G.playerId &&
    a.x >= x0 && a.x <= x1 && a.y >= y0 && a.y <= y1).map(a => a.id);
  if (!additive) selArmies = [];
  for (const id of ids) if (!selArmies.includes(id)) selArmies.push(id);
  if (ids.length) sfx("click");
  updateWarHint();
}

// ---------------- unit merging ----------------
// Part 2 §6: same-type units standing together can merge into one stronger
// stack (up to MERGE_MAX_STACK). Costs money, transports never merge, and
// units fresh out of combat must disengage first. The AI plays by the same
// rules in aiTryMerge().
const MERGE_RADIUS = 60, MERGE_COMBAT_LOCK = 4; // px / seconds since last combat
function mergeCheck(list) {
  if (list.length < 2) return { ok: false, why: "Select at least two units of the same type." };
  const u0 = list[0].unit;
  if (list.some(a => a.unit !== u0)) return { ok: false, why: "Only units of the same type can merge." };
  if (UNITS[u0].cap) return { ok: false, why: "Transport ships and cargo craft can never be merged." };
  const total = list.reduce((s, a) => s + (a.stack || 1), 0);
  if (total > MERGE_MAX_STACK) return { ok: false, why: `At most ${MERGE_MAX_STACK} units can form one stack.` };
  const cx = list.reduce((s, a) => s + a.x, 0) / list.length;
  const cy = list.reduce((s, a) => s + a.y, 0) / list.length;
  if (list.some(a => (a.x - cx) ** 2 + (a.y - cy) ** 2 > MERGE_RADIUS ** 2)) return { ok: false, why: "The units must stand close together to merge." };
  if (list.some(a => warNow - (a.lc || -99) < MERGE_COMBAT_LOCK)) return { ok: false, why: "Units currently in combat cannot merge." };
  const cost = Math.round(recruitCost(G.countries[list[0].owner], u0).money * MERGE_COST_FRAC) * (list.length - 1);
  return { ok: true, total, cost };
}
function mergeArmies(list) { // assumes mergeCheck passed and the cost is paid
  list.sort((a, b) => b.hp - a.hp);
  const lead = list[0];
  const total = list.reduce((s, a) => s + (a.stack || 1), 0);
  const hpSum = list.reduce((s, a) => s + a.hp, 0);
  lead.stack = total;
  lead.maxHp = unitMaxHp(lead.unit) * total;
  lead.hp = Math.min(lead.maxHp, hpSum * 1.05); // the whole ends up slightly stronger than its parts
  lead.order = null; lead.tx = lead.x; lead.ty = lead.y;
  for (let i = 1; i < list.length; i++) removeArmyQuiet(list[i]);
  return lead;
}
function mergeSelected() {
  const list = selArmies.map(armyById).filter(a => a && a.owner === G.playerId);
  if (typeof netIntercept === "function" && netIntercept("merge", { ids: list.map(a => a.id) })) return;
  const chk = mergeCheck(list);
  if (!chk.ok) { toast(chk.why); return; }
  const P = G.countries[G.playerId];
  const cost = sbFree(G.playerId) ? 0 : chk.cost;
  if (P.res.money < cost) { toast(`Merging these units costs ${cost}💰.`); return; }
  P.res.money -= cost;
  const lead = mergeArmies(list);
  selArmies = [lead.id];
  boomFx.push({ x: lead.x, y: lead.y, ttl: 0.4, max: 0.4, kind: "intercept", r: 18 });
  sfx("recruit");
  toast(`⚔ Merged into a ×${lead.stack} ${UNITS[lead.unit].n} stack — one banner, harder hitting, tougher${cost ? ` (−${cost}💰)` : ""}.`);
  updateWarHint();
  if (typeof renderTopbar === "function") renderTopbar();
}
// AI counterpart — clusters of idle same-type units merge under the same rules
function aiTryMerge(id, myArmies) {
  const c = G.countries[id];
  for (const a of myArmies) {
    if (!armyById(a.id)) continue; // absorbed earlier in this pass
    const u = UNITS[a.unit];
    if (u.cap || u.space || (a.stack || 1) >= MERGE_MAX_STACK) continue;
    const grp = [a];
    let total = a.stack || 1;
    for (const b of myArmies) {
      if (b === a || !armyById(b.id) || b.unit !== a.unit) continue;
      if ((b.stack || 1) + total > MERGE_MAX_STACK) continue;
      if ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 > 50 * 50) continue;
      grp.push(b); total += b.stack || 1;
      if (total >= MERGE_MAX_STACK) break;
    }
    if (grp.length < 2) continue;
    const chk = mergeCheck(grp);
    if (!chk.ok || c.res.money < chk.cost * 2) continue; // keeps a war chest
    c.res.money -= chk.cost;
    mergeArmies(grp);
    break; // one merge per pass keeps the tick cheap
  }
}

// ---------------- disbanding ----------------
function disbandSelected() {
  const list = selArmies.map(armyById).filter(a => a && a.owner === G.playerId);
  if (!list.length) return;
  const P = G.countries[G.playerId];
  const units = list.reduce((n, a) => n + (a.stack || 1), 0) + list.reduce((n, a) => n + ((a.cargo && a.cargo.length) || 0), 0);
  const upkeep = list.reduce((s, a) => s + UNITS[a.unit].up * (a.stack || 1) +
    ((a.cargo || []).reduce((s2, cu) => s2 + UNITS[cu.unit].up, 0)), 0);
  const doIt = () => {
    if (typeof netIntercept === "function" && netIntercept("disband", { ids: list.map(a => a.id) })) { updateWarHint(); return; }
    let pop = 0;
    for (const a of list) {
      pop += Math.min(0.3, 0.02 + UNITS[a.unit].up * 0.002) * (a.stack || 1);
      for (const cu of a.cargo || []) pop += Math.min(0.3, 0.02 + UNITS[cu.unit].up * 0.002);
      removeArmyQuiet(a);
    }
    pop = Math.round(pop * 100) / 100;
    P.pop += pop;
    log(`🏳 ${units} unit${units > 1 ? "s" : ""} disbanded — upkeep ends, ${pop}M citizens return home.`, "sys");
    toast(`Disbanded ${units} unit${units > 1 ? "s" : ""} (+${pop}M population, upkeep saved: ${upkeep}/turn).`);
    sfx("click");
    updateWarHint();
    if (typeof renderTopbar === "function") renderTopbar();
    if (typeof renderSidebar === "function" && typeof uiTab !== "undefined" && uiTab === "mil") renderSidebar();
  };
  // deleting a sizeable force deserves a second thought
  if (list.length >= 3 || upkeep >= 25 || list.some(a => (a.cargo || []).length)) {
    openModal(`<h2>🏳 Disband ${units} unit${units > 1 ? "s" : ""}?</h2>
      <p>${list.map(a => UNITS[a.unit].icon + " " + esc(UNITS[a.unit].n)).join(", ")}${list.some(a => (a.cargo || []).length) ? "<br>⚠ Loaded transports disband their cargo too." : ""}</p>
      <p class="dim small">Their upkeep (${upkeep}/turn) stops and a small part of the soldiers rejoin the population.</p>
      <button class="btn danger" id="disb-yes">Disband them</button>
      <button class="btn" data-close>Keep the army</button>`);
    document.getElementById("disb-yes").onclick = () => { closeModal(); doIt(); };
  } else doIt();
}

function updateWarHint() {
  const el = document.getElementById("war-hint");
  const bar = document.getElementById("sel-bar");
  if (!el) return;
  if (placingUnit) {
    el.style.display = "block";
    el.innerHTML = `Deploy <b>${UNITS[placingUnit].n}</b> — click one of your cities (Shift-click: keep recruiting · Esc: cancel)`;
  } else if (selArmies.length) {
    el.style.display = "block";
    const single = selArmies.length === 1 ? armyById(selArmies[0]) : null;
    if (single && UNITS[single.unit].cap && single.owner === G.playerId) {
      const n = single.cargo ? single.cargo.length : 0;
      el.innerHTML = `⛴️ <b>Transport</b> selected (${n}/${UNITS[single.unit].cap} aboard) — click water to sail · <b>E</b> ${n ? "deploys troops ashore" : "loads nearby troops"} · Esc to deselect`;
    } else {
      el.innerHTML = `<b>${selArmies.length}</b> ${selArmies.length > 1 ? "armies" : "army"} selected — click to move · click an enemy to attack · click your transport to board · Shift-drag selects a box · Esc deselects`;
    }
  } else el.style.display = "none";
  // selection action bar
  if (bar) {
    if (!placingUnit && selArmies.length) {
      const mine = selArmies.map(armyById).filter(a => a && a.owner === G.playerId);
      const anyTransport = mine.some(a => UNITS[a.unit].cap);
      const chk = mine.length > 1 ? mergeCheck(mine) : { ok: false };
      const launch = typeof canLaunchSelected === "function" ? canLaunchSelected(mine) : { ok: false };
      bar.style.display = "flex";
      bar.innerHTML = `<span class="dim small">⚔ ${selArmies.length} selected</span>
        <button class="btn small" id="sb-near" title="Add every friendly army near the current selection.">⊕ Select nearby</button>
        ${anyTransport ? `<button class="btn small" id="sb-load" title="Transports load nearby troops or deploy their cargo ashore (same as pressing E).">⛴ Load / Deploy</button>` : ""}
        ${chk.ok ? `<button class="btn small" id="sb-merge" title="Merge the selected units into one ×${chk.total} stack: combined health, harder hitting, one banner. Costs ${chk.cost}💰. Transports never merge; units in combat must disengage first.">⚔ Merge ×${chk.total} <i>${chk.cost}💰</i></button>` : ""}
        ${launch.ok ? `<button class="btn small primary" id="sb-space" title="${esc(launch.why || "Send the selected spacecraft into orbit.")}">🌌 Go to Space</button>` : ""}
        <button class="btn small danger" id="sb-disband" title="Disband the selected troops: they are removed, their upkeep stops and some soldiers return to the population (Delete key).">🏳 Disband</button>`;
      const near = document.getElementById("sb-near");
      if (near) near.onclick = ev => { ev.stopPropagation(); selectNearbySelected(); };
      const load = document.getElementById("sb-load");
      if (load) load.onclick = ev => { ev.stopPropagation(); transportToggle(); };
      const mg = document.getElementById("sb-merge");
      if (mg) mg.onclick = ev => { ev.stopPropagation(); mergeSelected(); };
      const sp = document.getElementById("sb-space");
      if (sp) sp.onclick = ev => { ev.stopPropagation(); if (typeof launchSelectedToSpace === "function") launchSelectedToSpace(); };
      const dis = document.getElementById("sb-disband");
      if (dis) dis.onclick = ev => { ev.stopPropagation(); disbandSelected(); };
    } else bar.style.display = "none";
  }
}

window.addEventListener("keydown", e => {
  const tag = document.activeElement && document.activeElement.tagName;
  const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  if (e.key === "Escape" && (placingUnit || selArmies.length)) { warCancel(); }
  if (typing || typeof screen !== "string" || screen !== "game") return;
  if (typeof spaceOpen !== "undefined" && spaceOpen) return; // the space view owns the keys there
  if ((e.key === "e" || e.key === "E") && !e.ctrlKey && !e.altKey && !e.metaKey) transportToggle();
  if (e.key === "Delete" && selArmies.length) disbandSelected();
});

// ---------------- transport ships ----------------
const TRANSPORT_LOAD_R = 55, TRANSPORT_DEPLOY_R = 60;

// rafts only carry early troops (QoL §13): units above the transport's
// cargoEraMax era cannot board it.
// SU2 Part 1: air-mobile assault troops (Orbital Marines & co) may board SPACE
// cargo craft — they fly themselves over water, so sea transports still refuse
// them, and spacecraft never ride inside other spacecraft.
function canBoardTransport(t, uId) {
  const u = UNITS[uId], tu = UNITS[t.unit];
  if (u.naval || u.space) return false;               // ships sail, spacecraft launch themselves
  if (u.air && !tu.space) return false;               // flyers only board space cargo craft
  const max = tu.cargoEraMax;
  return !max || u.e <= max;
}

// E with own transports selected: each deploys its troops if it carries any
// and land is near, otherwise loads nearby friendly land troops
function transportToggle() {
  const ships = selArmies.map(armyById).filter(a => a && a.owner === G.playerId && UNITS[a.unit].cap);
  if (!ships.length) return;
  if (typeof netIntercept === "function" && netIntercept("etoggle", { ids: ships.map(s => s.id) })) return;
  for (const a of ships) {
    a.cargo = a.cargo || [];
    if (a.cargo.length && findLandNear(a.x, a.y, TRANSPORT_DEPLOY_R)) deployCargo(a);
    else loadNearby(a);
  }
}
function loadNearby(a) {
  const cap = UNITS[a.unit].cap;
  // canBoardTransport is the single rulebook: it refuses naval units, refuses
  // air troops on SEA transports but welcomes them aboard SPACE cargo craft
  // (Orbital Marines, SU2 Part 1), and enforces raft era limits.
  const near = G.armies.filter(m => m.owner === a.owner && m !== a &&
      canBoardTransport(a, m.unit) &&
      (m.x - a.x) ** 2 + (m.y - a.y) ** 2 <= TRANSPORT_LOAD_R ** 2)
    .sort((m1, m2) => ((m1.x - a.x) ** 2 + (m1.y - a.y) ** 2) - ((m2.x - a.x) ** 2 + (m2.y - a.y) ** 2));
  let loaded = 0;
  while (a.cargo.length < cap && near.length) {
    const m = near.shift();
    a.cargo.push({ unit: m.unit, hp: m.hp, maxHp: m.maxHp });
    removeArmyQuiet(m);
    loaded++;
  }
  if (loaded) {
    sfx("recruit");
    toast(`⛴️ Loaded ${loaded} arm${loaded > 1 ? "ies" : "y"} (${a.cargo.length}/${cap}). Sail near another coast and press E to deploy.`);
  } else if (a.cargo.length >= cap) toast("Transport is full.");
  else toast("No friendly land troops close enough — move them next to the ship, then press E.");
  updateWarHint();
}
function deployCargo(a) {
  let deployed = 0;
  while (a.cargo.length) {
    const spot = findLandNear(a.x + rnd(-10, 10), a.y + rnd(-10, 10), TRANSPORT_DEPLOY_R);
    if (!spot) break;
    const cu = a.cargo.pop();
    const na = spawnArmy(a.owner, cu.unit, spot.x, spot.y);
    na.hp = Math.min(cu.hp, na.maxHp);
    deployed++;
  }
  if (deployed) { sfx("move"); toast(`⛴️ ${deployed} arm${deployed > 1 ? "ies" : "y"} deployed ashore.`); }
  else toast("No land in reach — troops cannot be deployed into water. Sail closer to the coast.");
  updateWarHint();
}
// remove an army without death effects (used when loading onto a transport)
function removeArmyQuiet(m) {
  const idx = G.armies.indexOf(m);
  if (idx >= 0) G.armies.splice(idx, 1);
  const el = armyEls.get(m.id) || document.getElementById("army-" + m.id);
  if (el) el.remove();
  armyEls.delete(m.id);
  const si = selArmies.indexOf(m.id);
  if (si >= 0) selArmies.splice(si, 1);
}

// ---------------- the simulation ----------------
function warFrame(ts) {
  requestAnimationFrame(warFrame);
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
  lastTs = ts;
  if (!G || typeof screen === "undefined" || screen !== "game" || !CITY_ARR) return;
  sndTimer = Math.max(0, sndTimer - dt);
  const modalUp = document.getElementById("modal").style.display === "flex";
  visTimer += dt;
  if (visTimer >= 0.25) { visTimer = 0; visCache.clear(); }
  // multiplayer clients render only — the host's simulation is the official one
  const netClient = typeof NET !== "undefined" && NET.active && !NET.isHost;
  // QoL §2: multiplayer never pauses — not for menus, not for modals, not for
  // the pause button. The host's world advances every 3 seconds regardless.
  const netHost = typeof NET !== "undefined" && NET.active && NET.isHost && NET.started;
  if (netHost) { G.rtPaused = false; }
  if (netClient) {
    warNow += dt;
    if (typeof netClientFrame === "function") netClientFrame(dt);
  } else if ((!G.rtPaused && !modalUp) || netHost) {
    warNow += dt;
    tickMovement(dt);
    tickMissiles(dt);
    tickHyperStrikes(dt); // Part 12: charging orbital strikes land
    if (typeof spaceTick === "function") spaceTick(dt);
    cbTimer += dt;
    if (cbTimer >= 0.1) { tickCombat(cbTimer); tickCapture(cbTimer); cbTimer = 0; }
    aiTimer += dt;
    if (aiTimer >= 0.8) { tickAI(); aiTimer = 0; }
    // Realistic Mode is real-time: one full economic turn every 3 seconds.
    // Sandbox Improvement §1-§2: Sandbox ticks automatically too, at its own
    // selectable speed (realtimeTickSeconds reads the Sandbox speed control).
    if (typeof isRealtime === "function" && isRealtime() && !G.defeated) {
      econTimer += dt;
      if (econTimer >= (typeof realtimeTickSeconds === "function" ? realtimeTickSeconds() : REALTIME_TICK_SECONDS)) {
        econTimer = 0;
        endTurn();
        if (typeof realtimeAfterTick === "function") realtimeAfterTick();
        if (typeof netAfterHostTick === "function" && typeof NET !== "undefined" && NET.active && NET.isHost) netAfterHostTick();
      }
    }
    // hosts stream smooth army/fx updates between economic ticks
    if (typeof NET !== "undefined" && NET.active && NET.isHost) {
      NET.deltaT = (NET.deltaT || 0) + dt;
      if (NET.deltaT >= 0.2 && typeof netSendDelta === "function") { NET.deltaT = 0; netSendDelta(); }
    }
  }
  shotsFx = shotsFx.filter(s => {
    if ((s.ttl -= dt) > 0) return true;
    if (s.kind === "shell") { // the shell lands: a small blast where it hit
      boomFx.push({ x: s.x2, y: s.y2, ttl: 0.4, max: 0.4, kind: "missile", r: 12 });
      if (sndTimer <= 0) { sfx("boom"); sndTimer = 0.12; }
    }
    return false;
  });
  boomFx = boomFx.filter(b => (b.ttl -= dt) > 0);
  sparkFx = sparkFx.filter(s => { if (s.delay > 0) { s.delay -= dt; return true; } return (s.ttl -= dt) > 0; });
  smokeFx = smokeFx.filter(s => (s.ttl -= dt) > 0);
  debrisFx = debrisFx.filter(p => {
    p.ttl -= dt;
    if (p.ttl <= 0) return false;
    p.vy += 90 * dt; // gravity
    p.x += p.vx * dt; p.y += p.vy * dt;
    return true;
  });
  if (roadsDirtyFlag && CITY_ARR) rebuildRoads();
  tickAmbient(dt); // visual-only air & space traffic (runs on clients too)
  renderCities();
  renderNight(dt);
  renderArmies();
  renderFx();
  if (typeof spaceRender === "function") spaceRender(); // draws only while the space view is open
  if (typeof pbRender === "function") pbRender(); // Final Alien Update Part 8: the battle window (map & space alike)
}

// movement legality: ships stay in water; land armies stop at the coast;
// air units fly over everything. Only land troops need Transport Ships.
function moveSpeedFactor(a) {
  if (UNITS[a.unit].air) return 1; // flying — terrain below is irrelevant
  const onLand = isLand(a.x, a.y);
  if (UNITS[a.unit].naval) return onLand ? 0.5 : 1;
  if (onLand) {
    const i = (a.y | 0) * MW + (a.x | 0);
    const road = onRoad(a.x, a.y) ? ROAD_SPEED_BONUS : 1; // roads speed the march
    return (ID_ARR[i] ? 1 : 0.7) * road;
  }
  return 0.35; // stranded by an old save — wading back to shore
}
function canStepTo(a, x, y) {
  if (UNITS[a.unit].air) return true; // flying units cross land and water freely
  const destLand = isLand(x, y);
  const hereLand = isLand(a.x, a.y);
  if (UNITS[a.unit].naval) return hereLand ? true : !destLand; // beached ships may slip back to sea
  if (destLand) return true;
  return !hereLand; // land troops never enter water; the stranded may only head for shore
}

function tickMovement(dt) {
  for (const a of G.armies.slice()) { // slice: boarding removes armies mid-loop
    const u = UNITS[a.unit];
    // attack orders track the target
    if (a.order && a.order.type === "attack") {
      const t = armyById(a.order.id);
      if (!t || !atWar(a.owner, t.owner)) a.order = null;
      else {
        const d = Math.hypot(t.x - a.x, t.y - a.y);
        if (d > u.rng * 0.85) { a.tx = t.x; a.ty = t.y; } else { a.tx = a.x; a.ty = a.y; }
      }
    }
    // board orders walk the army to a transport and load it on arrival
    if (a.order && a.order.type === "board" && !u.naval) {
      const t = armyById(a.order.id);
      if (!t || t.owner !== a.owner || !UNITS[t.unit].cap) { a.order = null; }
      else if (!canBoardTransport(t, a.unit)) {
        a.order = null; a.tx = a.x; a.ty = a.y;
        if (a.owner === G.playerId) toast(UNITS[a.unit].air
          ? `${UNITS[a.unit].icon} ${UNITS[a.unit].n} fly themselves — they only board SPACE cargo craft.`
          : `🛶 ${UNITS[a.unit].n} is too advanced for a raft — only Primitive and Ancient Era troops fit aboard.`);
      }
      else if ((a.x - t.x) ** 2 + (a.y - t.y) ** 2 <= TRANSPORT_LOAD_R ** 2) {
        t.cargo = t.cargo || [];
        if (t.cargo.length < UNITS[t.unit].cap) {
          t.cargo.push({ unit: a.unit, hp: a.hp, maxHp: a.maxHp });
          removeArmyQuiet(a);
          if (a.owner === G.playerId) { toast(`⛴️ Loaded (${t.cargo.length}/${UNITS[t.unit].cap} aboard).`); updateWarHint(); }
          continue;
        }
        a.order = null; a.tx = a.x; a.ty = a.y;
        if (a.owner === G.playerId) toast("Transport is full.");
      } else {
        const spot = findLandNear(t.x, t.y, TRANSPORT_DEPLOY_R + 20);
        if (spot) { a.tx = spot.x; a.ty = spot.y; }
      }
    }
    const dx = a.tx - a.x, dy = a.ty - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 1.5) {
      // rest & heal near an own city
      const c = cityAt(a.x, a.y, HEAL_R);
      if (c && provCtrl(c.prov) === a.owner && a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + a.maxHp * 0.012 * dt);
      continue;
    }
    const sp = u.spd * moveSpeedFactor(a) * milSpeedMult(G.countries[a.owner]) * dt;
    const step = Math.min(sp, d);
    let nx = a.x + dx / d * step, ny = a.y + dy / d * step;
    if (!canStepTo(a, nx, ny)) {
      // slide along the obstacle: try each axis alone
      if (canStepTo(a, nx, a.y)) ny = a.y;
      else if (canStepTo(a, a.x, ny)) nx = a.x;
      else {
        a.tx = a.x; a.ty = a.y; // blocked — halt at the shoreline
        if (a.owner === G.playerId && !u.naval && !a.coastWarned) {
          a.coastWarned = true;
          toast("Land troops cannot cross water — load them onto a Transport Ship (select the ship, press E).");
        }
        continue;
      }
    }
    a.x = clamp(nx, 2, MW - 2);
    a.y = clamp(ny, 2, MH - 2);
  }
}

function armyDamage(att, def, outsideHome) {
  const ua = UNITS[att.unit], ud = UNITS[def.unit];
  const A = G.countries[att.owner], D = G.countries[def.owner];
  const mdA = mods(A), mdD = mods(D);
  const stA = att.stack || 1, stD = def.stack || 1;
  let sp = ua.melee ? (0.7 + stat(A, "str") * 0.06) : (0.8 + stat(A, "agi") * 0.025 + (ua.e >= 4 ? stat(A, "int") * 0.015 : 0));
  // Part 12: fast-firing units trade per-shot damage for their higher rate
  let dmg = ua.atk * (ua.dmgMul || 1) * sp;
  dmg *= stA * (1 + 0.05 * (stA - 1)); // merged stacks hit harder than the sum of their parts
  dmg *= 1 + mdA.atk + (outsideHome ? (mdA.atkOnly || 0) : 0);
  dmg *= Math.pow(1.15, A.era - D.era); // technology gap
  dmg *= [0.9, 1, 1.15][A.policies.mil];
  dmg *= 0.65 + combatMorale(A) / 200 + stat(A, "mor") * 0.015; // war morale counts (Part 1)
  // defence mitigation
  let spD = ud.melee ? (0.7 + stat(D, "dur") * 0.06) : (0.8 + stat(D, "agi") * 0.02);
  let defV = ud.def * spD * (1 + mdD.def);
  defV *= 1 + 0.45 * (stD - 1); // merged stacks hold the line better
  const c = cityAt(def.x, def.y, CAP_R + 14);
  if (c && provCtrl(c.prov) === def.owner) {
    defV *= 1 + fortLevel(D, c.prov) * 0.10 + Math.min(0.25, countBldg(D, "base") * 0.05);
  }
  dmg *= 100 / (100 + defV * 2.2);
  dmg *= MODES[G.mode].warCas;
  dmg *= rnd(0.85, 1.15);
  // thorns: some species hurt their attackers
  if (mdD.cas && Math.random() < 0.5) att.hp -= dmg * mdD.cas * 2;
  if (mdA.selfCas) att.hp -= dmg * mdA.selfCas;
  return dmg;
}

function tickCombat(dt) {
  const dead = [], deadBy = new Map();
  const markDead = (m, by) => { if (!dead.includes(m)) { dead.push(m); deadBy.set(m, by); } };
  if (!G.wars.length) return;
  // war lookup set — atWar() per army pair was a linear scan over G.wars,
  // which added up badly in large battles over long sessions
  const warSet = new Set();
  for (const w of G.wars) { warSet.add(w.a * 1024 + w.b); warSet.add(w.b * 1024 + w.a); }
  for (const a of G.armies) {
    a.cd -= dt;
    const u = UNITS[a.unit];
    // Part 12: secondary weapons run on their own faster clock — a light,
    // rapid mount (tank MG, point-defence) that picks off nearby weak targets
    if (u.sec) {
      a.cd2 = (a.cd2 === undefined ? rnd(0, u.sec.cd) : a.cd2) - dt;
      if (a.cd2 <= 0) {
        let t2 = null, best2 = Infinity;
        for (const b of G.armies) {
          if (b.owner === a.owner || !warSet.has(a.owner * 1024 + b.owner)) continue;
          const d = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
          if (d > u.sec.rng * u.sec.rng) continue;
          const score = b.hp * 0.02 + d * 0.001; // weakest & closest first
          if (score < best2) { best2 = score; t2 = b; }
        }
        if (t2) {
          a.cd2 = u.sec.cd;
          const sdmg = armyDamage(a, t2, false) * u.sec.f;
          t2.hp -= sdmg;
          a.lc = warNow; t2.lc = warNow;
          if (shotsFx.length < fxCap(320)) shotsFx.push({ x1: a.x, y1: a.y, x2: t2.x, y2: t2.y, ttl: 0.14, max: 0.14, kind: "gun" });
          if (t2.hp <= 0) markDead(t2, a.owner);
          if (a.hp <= 0) markDead(a, t2.owner); // thorn species bite back
        } else a.cd2 = u.sec.cd * 0.6; // nothing in range — scan again soon
      }
    }
    if (a.cd > 0) continue;
    let target = null, bestD = u.rng * u.rng;
    for (const b of G.armies) {
      if (b.owner === a.owner || !warSet.has(a.owner * 1024 + b.owner)) continue;
      const d = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      if (d <= bestD) { bestD = d; target = b; }
    }
    if (!target) continue;
    // Part 12: per-unit attack cooldowns — siege pieces thunder slowly,
    // drones and star fleets rattle off rapid volleys
    a.cd = u.cd || (u.rng > 60 ? 2.6 : (u.melee ? 1.2 : 1.8));
    const i = (a.y | 0) * MW + (a.x | 0);
    const pxCity = CITY_ARR[i] ? CITIES[CITY_ARR[i] - 1] : null;
    const outsideHome = !pxCity || provCtrl(pxCity.prov) !== a.owner;
    let dmg = armyDamage(a, target, outsideHome);
    // Part 12: a Star Destroyer's main gun simply erases ground troops
    const ut = UNITS[target.unit];
    if (u.sdGround && !ut.air && !ut.naval && !ut.space) dmg = Math.max(dmg, target.maxHp * 1.1);
    target.hp -= dmg;
    a.lc = warNow; target.lc = warNow; // both sides count as "in combat" (blocks merging)
    // Part 12: splash damage — explosive hits bleed onto enemies near the impact
    if (u.splash) {
      for (const b of G.armies) {
        if (b === target || b.owner === a.owner || !warSet.has(a.owner * 1024 + b.owner)) continue;
        const d2 = (b.x - target.x) ** 2 + (b.y - target.y) ** 2;
        if (d2 > u.splash * u.splash) continue;
        const fall = 1 - 0.7 * Math.sqrt(d2) / u.splash; // strongest at the centre
        b.hp -= dmg * 0.5 * fall;
        b.lc = warNow;
        if (b.hp <= 0) markDead(b, a.owner);
      }
      if (boomFx.length < 200) boomFx.push({ x: target.x, y: target.y, ttl: 0.35, max: 0.35, kind: "missile", r: u.splash });
    }
    // weapon-matched effects: melee clash, arrows, gunfire, arcing shells, energy beams, railgun lances
    // (capped so a continent-wide war can't drown the frame in effects)
    const heavy = !u.melee && u.rng >= 90 && u.e >= 4;
    const kind = u.melee ? "melee" : u.e >= 8 ? "rail" : u.e >= 7 ? "beam" : heavy ? "shell" : u.e >= 4 ? "gun" : "arrow";
    if (shotsFx.length < fxCap(320)) shotsFx.push({
      x1: a.x, y1: a.y, x2: target.x, y2: target.y,
      ttl: kind === "shell" ? 0.55 : 0.22, max: kind === "shell" ? 0.55 : 0.22, kind,
    });
    if (typeof netHostFx === "function") netHostFx(["s", kind, a.x | 0, a.y | 0, target.x | 0, target.y | 0]);
    if (sparkFx.length < fxCap(320)) {
      if (kind === "gun" || kind === "shell") sparkFx.push({ x: a.x, y: a.y, tx: target.x, ty: target.y, ttl: 0.09, max: 0.09, kind: "muzzle" });
      if (kind !== "shell") sparkFx.push({ x: target.x, y: target.y, ttl: 0.25, max: 0.25, kind: u.melee ? "clash" : "hit", delay: 0.05 });
    }
    if (target.hp <= 0) spawnDebris(target.x, target.y, 5);
    const audible = a.owner === G.playerId || target.owner === G.playerId ||
      isVisibleToPlayer(a) || isVisibleToPlayer(target);
    if (audible && sndTimer <= 0) {
      sfx(u.melee ? "melee" : kind === "rail" ? "rail" : kind === "beam" ? "beam" : kind === "shell" ? "shell" : kind === "gun" ? "gun" : "arrow");
      sndTimer = 0.12;
    }
    if (target.hp <= 0) markDead(target, a.owner);
    if (a.hp <= 0) markDead(a, target.owner);
  }
  for (const d of dead) killArmy(d, deadBy.get(d));
}

// shared death handling — combat, missiles and sunk transports all end here.
// killerId (optional) credits the destroyer with a war-morale boost (Part 1).
// noGlory (BUG REPORT morale fix): weapons of mass destruction pass true —
// erasing armies with a nuke, an orbital laser or a planetary bombardment is
// an atrocity, not a battle won, and must never RAISE the perpetrator's
// morale. Only real combat kills rally the home front.
function killArmy(d, killerId, noGlory) {
  if (G.armies.indexOf(d) < 0) return;
  boomFx.push({ x: d.x, y: d.y, ttl: 0.45, max: 0.45 });
  spawnDebris(d.x, d.y, 8, UNITS[d.unit].naval ? "#9ec8e8" : null);
  if (typeof netHostFx === "function") netHostFx(["b", d.x | 0, d.y | 0, UNITS[d.unit].naval ? 1 : 0]);
  G.armies.splice(G.armies.indexOf(d), 1);
  const el = armyEls.get(d.id) || document.getElementById("army-" + d.id);
  if (el) el.remove();
  armyEls.delete(d.id);
  const si = selArmies.indexOf(d.id);
  if (si >= 0) { selArmies.splice(si, 1); updateWarHint(); }
  const c = G.countries[d.owner];
  // Part 1: battle losses hit the WAR spirit hard but normal morale only
  // lightly — repeated defeats, not the war itself, break a nation
  c.morale = clamp(c.morale - 0.25 * (d.stack || 1), 0, 100);
  bumpWarMorale(c, -WAR_MORALE.battleLoss * (d.stack || 1));
  if (!noGlory && killerId !== undefined && killerId !== null && killerId !== d.owner && G.countries[killerId]) {
    bumpWarMorale(G.countries[killerId], WAR_MORALE.battleWin); // victories rally the home front
  }
  if (d.cargo && d.cargo.length) {
    // the transported troops go down with the ship
    c.morale = clamp(c.morale - 1.5, 0, 100);
    log(`🌊 A transport sank with ${d.cargo.length} arm${d.cargo.length > 1 ? "ies" : "y"} aboard.`, d.owner === G.playerId ? "bad" : "sys");
    if (d.owner === G.playerId) toast(`🌊 Transport lost at sea — ${d.cargo.length} embarked arm${d.cargo.length > 1 ? "ies" : "y"} lost.`);
  }
  if (d.owner === G.playerId) sfx("die");
}

function spawnDebris(x, y, n, col) {
  if (debrisFx.length > fxCap(350)) return;
  for (let i = 0; i < n; i++) {
    const a = rnd(0, Math.PI * 2), v = rnd(12, 55);
    debrisFx.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - rnd(10, 40),
      ttl: rnd(0.4, 0.9), max: 0.9,
      col: col || (Math.random() < 0.4 ? "#3a3a42" : "#b0713f"),
    });
  }
}

function tickCapture(dt) {
  const M = MODES[G.mode];
  for (const c of CITIES) {
    const p = c.prov;
    const ctrl = provCtrl(p);
    // find hostile armies and defenders near the city
    let attackers = 0, attOwner = 0, defenders = 0;
    for (const a of G.armies) {
      const d = (a.x - p.px) ** 2 + (a.y - p.py) ** 2;
      if (d > (CAP_R + 8) ** 2) continue;
      if (a.owner === ctrl) defenders++;
      // ships bombard and defend, but only boots on the ground can capture a city
      else if (!UNITS[a.unit].naval && atWar(a.owner, ctrl) && d <= CAP_R * CAP_R) { attackers++; attOwner = a.owner; }
    }
    if (attackers > 0 && defenders === 0) {
      const ctrlC = G.countries[ctrl];
      const rate = (10 / M.occup) * (1 + 0.35 * (attackers - 1)) / (1 + 0.35 * fortLevel(ctrlC, p));
      if (p.capBy !== attOwner) { p.capBy = attOwner; p.capProg = 0; if (ctrl === G.playerId) { toast(`⚠ ${p.city} is being captured!`); sfx("alarm"); } }
      p.capProg += rate * dt;
      if (p.capProg >= 100) completeCapture(c, attOwner);
    } else if (p.capProg > 0) {
      p.capProg = Math.max(0, p.capProg - 25 * dt);
      if (p.capProg === 0) p.capBy = 0;
    }
  }
}

function completeCapture(cityRef, attId) {
  const p = cityRef.prov;
  const prevCtrl = provCtrl(p);
  p.capProg = 0; p.capBy = 0;
  if (p.own === attId) {
    p.occ = null; // liberated own city
    log(`🎉 ${G.countries[attId].name} liberates ${p.city}!`, "good");
  } else {
    p.occ = attId;
    p.unrest = Math.round(8 * MODES[G.mode].occup * (1 - (mods(G.countries[attId]).occup || 0)));
    log(`🏴 ${G.countries[attId].name} captures ${p.city} (${G.countries[p.own].name})!`, attId === G.playerId ? "good" : "war");
  }
  // Part 1: cities won and lost move the WAR spirit; losing the capital
  // shatters it. Normal morale shifts stay small — war morale is the buffer.
  const attC = G.countries[attId], prevC = G.countries[prevCtrl];
  attC.morale = clamp(attC.morale + 2, 0, 100);
  prevC.morale = clamp(prevC.morale - 2, 0, 100);
  bumpWarMorale(attC, WAR_MORALE.cityWin);
  const homeC = G.countries[p.own];
  const wasCapital = homeC && homeC.provinces[homeC.capital] === p && p.own === prevCtrl;
  bumpWarMorale(prevC, -(wasCapital ? WAR_MORALE.capitalLoss : WAR_MORALE.cityLoss));
  if (wasCapital) prevC.stability = clamp(prevC.stability - 5, 0, 100);
  sfx(attId === G.playerId ? "capture" : "captureFar");
  mapOwnershipChanged();
  // did the losing nation break?
  const loser = p.own !== attId ? p.own : null;
  if (loser && G.countries[loser].alive && atWar(attId, loser) && checkBroken(loser)) {
    handleNationBroken(attId, loser);
  }
  if (typeof renderSidebar === "function") renderSidebar();
}

function handleNationBroken(attId, defId) {
  if (G.brokenPending) return;
  const A = G.countries[attId];
  if (defId === G.playerId) {
    resolveConquest(attId, defId, "annex");
    G.defeated = true;
    if (typeof showEnd === "function") showEnd(false, `Your capital has fallen to ${A.name}.`);
  } else if (attId === G.playerId) {
    G.brokenPending = defId;
    if (typeof showConquest === "function") showConquest(defId);
  } else if (isHumanControlled(attId)) {
    // a multiplayer client broke this nation — the choice is theirs
    G.brokenPending = defId;
    if (typeof netAskConquest === "function") netAskConquest(attId, defId);
  } else {
    const per = A.personality;
    const how = (per === "aggressive" || per === "expansionist") ? "annex"
      : (provsOfNation(defId).length > 2 ? "vassal" : "annex");
    resolveConquest(attId, defId, how);
    checkVictory();
    if (G.victory && !G.victory.announced && typeof showEnd === "function") showEnd(G.victory.by === G.playerId);
  }
}

// ---------------- strategic missiles ----------------
// Launch from a silo city. Ballistic & nuclear missiles fly a high arc to a
// map point; homing missiles chase a specific army. Cities with an
// Anti-Missile Battery may intercept incoming missiles on final approach.
function launchMissile(owner, fromProv, type, tx, ty, targetArmyId) {
  if (!fromProv) for (const p of provsOwned(owner)) if (p.b.silo) { fromProv = p; break; }
  if (!fromProv) return false;
  const mt = MISSILE_TYPES[type];
  const x0 = fromProv.px, y0 = fromProv.py;
  const dist = Math.max(40, Math.hypot(tx - x0, ty - y0));
  missilesFly.push({
    owner: Number(owner), type, x0, y0, tx, ty,
    t: 0, dur: dist / mt.spd, dist,
    targetArmy: targetArmyId || null, checked: false,
    gx: x0, gy: y0, alt: 0, f: 0,
  });
  sfx("launch");
  log(`${mt.icon} ${G.countries[owner].name} launches a ${mt.n}!`, Number(owner) === G.playerId ? "sys" : "war");
  return true;
}

function interceptionAt(tx, ty, attackerId) {
  const i = (ty | 0) * MW + (tx | 0);
  let c = (i >= 0 && i < MW * MH && CITY_ARR && CITY_ARR[i]) ? CITIES[CITY_ARR[i] - 1] : null;
  if (!c) c = cityAt(tx, ty, 60);
  if (!c) return null;
  const p = c.prov;
  if (!(p.b.abm > 0)) return null;
  const ctrl = provCtrl(p);
  if (ctrl === Number(attackerId) || !G.countries[ctrl].alive) return null;
  const chance = G.countries[ctrl].researched.lasershield ? ABM_LASER_CHANCE : ABM_BASE_CHANCE;
  return { chance, ownerId: ctrl };
}

function tickMissiles(dt) {
  for (const m of missilesFly) {
    m.t += dt;
    const mt = MISSILE_TYPES[m.type];
    if (m.targetArmy) { // homing: follow the target army
      const t = armyById(m.targetArmy);
      if (t) {
        m.tx = t.x; m.ty = t.y;
        m.dist = Math.max(40, Math.hypot(m.tx - m.x0, m.ty - m.y0));
        m.dur = Math.max(m.t + 0.15, m.dist / mt.spd);
      } else m.targetArmy = null;
    }
    const f = Math.min(1, m.t / m.dur);
    m.f = f;
    m.gx = m.x0 + (m.tx - m.x0) * f;
    m.gy = m.y0 + (m.ty - m.y0) * f;
    m.alt = Math.sin(Math.PI * f) * m.dist * (mt.homing ? 0.06 : 0.16);
    if (!m.checked && f > 0.8) { // final approach — the defenders get one shot
      m.checked = true;
      const ic = interceptionAt(m.tx, m.ty, m.owner);
      if (ic && Math.random() < ic.chance) {
        m.done = true;
        boomFx.push({ x: m.gx, y: m.gy - m.alt, ttl: 0.55, max: 0.55, kind: "intercept", r: 26 });
        spawnDebris(m.gx, m.gy - m.alt, 8, "#bfe6ff");
        sfx("intercept");
        log(`🛰 ${G.countries[ic.ownerId].name} intercepts an incoming ${mt.n}.`, ic.ownerId === G.playerId ? "good" : "sys");
        if (ic.ownerId === G.playerId) toast("🛰 Incoming missile intercepted!");
        continue;
      }
    }
    if (f >= 1) { m.done = true; missileImpact(m); }
  }
  missilesFly = missilesFly.filter(m => !m.done);
}

function missileImpact(m) {
  const mt = MISSILE_TYPES[m.type];
  const R = mt.radius;
  boomFx.push({ x: m.tx, y: m.ty, ttl: mt.nuke ? 2.4 : 0.9, max: mt.nuke ? 2.4 : 0.9, kind: mt.nuke ? "nuke" : "missile", r: R });
  spawnDebris(m.tx, m.ty, mt.nuke ? 26 : 12);
  if (typeof netHostFx === "function") netHostFx(["m", m.tx | 0, m.ty | 0, mt.nuke ? 1 : 0, R]);
  sfx(mt.nuke ? "nukeBoom" : "mBoom");
  // area damage to every army in the blast, friend or foe
  for (const a of G.armies.slice()) {
    const d = Math.hypot(a.x - m.tx, a.y - m.ty);
    if (d > R) continue;
    const fall = 1 - 0.65 * (d / R);
    a.hp -= mt.dmg * fall * rnd(0.85, 1.15);
    if (a.hp <= 0) killArmy(a, m.owner, true); // a missile kill is no rallying victory
  }
  // the city under the blast
  const c = cityAt(m.tx, m.ty, R);
  let victim = null;
  if (c) {
    const p = c.prov;
    const ctrl = provCtrl(p), ctrlC = G.countries[ctrl];
    victim = ctrl;
    const shielded = (p.b.abm || 0) > 0 || (p.b.fortress || 0) > 0 || (p.lvl || 1) >= 4;
    const holder = G.countries[c.cid];
    const isCap = holder.provinces[holder.capital] === p;
    const ownedElsewhere = provsOfNation(p.own).length > 1;
    if (mt.nuke && !isCap && !shielded && holder.provinces.length > 1 && ownedElsewhere) {
      // total destruction — the city is wiped from the map
      log(`☢ ${p.city} is annihilated by ${G.countries[m.owner].name}'s nuclear strike!`, "war");
      if (ctrl === G.playerId || p.own === G.playerId) toast(`☢ ${p.city} has been destroyed!`);
      ctrlC.morale = clamp(ctrlC.morale - 18, 0, 100);
      ctrlC.pop = Math.max(0.3, ctrlC.pop - rnd(0.8, 1.4));
      destroyCity(p);
    } else {
      const nDestroy = mt.nuke ? 99 : irnd(1, 2);
      let n = 0;
      while (n < nDestroy && Object.keys(p.b).length) {
        const k = pick(Object.keys(p.b));
        p.b[k]--; if (!p.b[k]) delete p.b[k];
        n++;
      }
      p.unrest = Math.min(30, (p.unrest || 0) + (mt.nuke ? 14 : 4));
      ctrlC.morale = clamp(ctrlC.morale - (mt.nuke ? 12 : 3), 0, 100);
      if (mt.nuke) ctrlC.pop = Math.max(0.3, ctrlC.pop - rnd(0.4, 0.9));
      if (ctrl === G.playerId) toast(`💥 ${p.city} hit by a ${mt.n.toLowerCase()}${n ? ` — ${n} building${n > 1 ? "s" : ""} destroyed` : ""}!`);
      log(`💥 Missile strike on ${p.city}${n ? ` destroys ${n} building${n > 1 ? "s" : ""}` : ""}.`, ctrl === G.playerId ? "bad" : "sys");
    }
    cityLayerDirty = true;
  }
  if (mt.nuke) {
    if (victim === null) {
      const i = (m.ty | 0) * MW + (m.tx | 0);
      if (i >= 0 && i < MW * MH && ID_ARR[i]) victim = controllerOf(ID_ARR[i]);
    }
    nukeDiplomaticFallout(m.owner, victim);
  }
  if (typeof renderSidebar === "function") renderSidebar();
  if (typeof renderTopbar === "function" && G.playerId === m.owner) renderTopbar();
}

// ---------------- Star Destroyer Hyper Lazer (AI Improvements Part 12) ----------------
// Space-only ability: a Star Destroyer holding orbit of the Homeworld paints a
// point on the surface; after a short delay an orbital beam annihilates the
// TROOPS in the area. It cannot destroy cities, buildings or the planet, it
// has a long cooldown, and it aborts if the ship leaves its firing position.
let hyperTargeting = null; // {shipId} while the player picks a surface target
let hyperStrikes = [];     // {x, y, t, dur, owner, shipId} beams charging

function hyperLazerStatus(s) {
  const C = G.countries[s.owner];
  const free = s.owner === G.playerId && typeof sbFree === "function" && sbFree(s.owner);
  const cost = free ? { money: 0, energy: 0 } : HYPER_LAZER;
  const inSpace = !!(G.space && G.space.ships.indexOf(s) >= 0); // grounded SDs cannot fire
  const nearHome = inSpace && typeof shipNearPlanet === "function" && shipNearPlanet(s, "home");
  const afford = C.res.money >= cost.money && C.res.energy >= cost.energy;
  return { cd: s.hlCd || 0, cost, inSpace, nearHome, afford,
    ready: inSpace && nearHome && (s.hlCd || 0) <= 0 && afford };
}
function startHyperTargeting(shipId) {
  const s = typeof shipById === "function" ? shipById(shipId) : null;
  if (!s || !isSD(s)) return;
  const st = hyperLazerStatus(s);
  if (!st.inSpace || !st.nearHome) { toast("🔦 The Hyper Lazer only fires from orbit of the Homeworld — space positioning is required."); return; }
  if (st.cd > 0) { toast(`🔦 Hyper Lazer recharging — ready in ${st.cd} tick${st.cd > 1 ? "s" : ""}.`); return; }
  if (!st.afford) { toast(`🔦 Firing needs ${st.cost.money}💰 and ${st.cost.energy}⚡.`); return; }
  hyperTargeting = { shipId };
  if (typeof spaceOpen !== "undefined" && spaceOpen && typeof exitSpace === "function") exitSpace(true);
  const wh = document.getElementById("war-hint");
  wh.style.display = "";
  wh.innerHTML = `🔦 <b>HYPER LAZER</b> — click the surface to target the orbital strike · <b>Esc</b> cancels`;
  document.getElementById("map-vp").classList.add("painting");
}
function cancelHyperTargeting() {
  if (!hyperTargeting) return;
  hyperTargeting = null;
  document.getElementById("map-vp").classList.remove("painting");
  updateWarHint();
}
function hyperClickTarget(mx, my) {
  const t = hyperTargeting;
  if (!t) return false;
  const s = shipById(t.shipId);
  const st = s ? hyperLazerStatus(s) : null;
  if (!s || !st.ready) { // landed, left orbit or ran out of funds while aiming
    cancelHyperTargeting();
    toast("🔦 Hyper Lazer aborted — the Star Destroyer is no longer ready in orbit.");
    return true;
  }
  const R = HYPER_LAZER.radius;
  const friendly = G.armies.filter(a => a.owner === s.owner &&
    (a.x - mx) ** 2 + (a.y - my) ** 2 <= R * R).length;
  const fire = () => {
    // multiplayer client: the host validates and runs the strike
    if (typeof netIntercept === "function" && netIntercept("hyper", { id: s.id, x: mx, y: my })) {
      cancelHyperTargeting();
      return;
    }
    if (!(s.owner === G.playerId && typeof sbFree === "function" && sbFree(s.owner))) {
      const C = G.countries[s.owner];
      C.res.money -= HYPER_LAZER.money;
      C.res.energy = Math.max(0, C.res.energy - HYPER_LAZER.energy);
    }
    s.hlCd = HYPER_LAZER.cd;
    hyperStrikes.push({ x: mx, y: my, t: 0, dur: HYPER_LAZER.delay, owner: s.owner, shipId: s.id });
    log(`🔦 ${G.countries[s.owner].name}'s Star Destroyer paints a target from orbit!`, "war");
    sfx("launch");
    cancelHyperTargeting();
    if (typeof renderTopbar === "function" && s.owner === G.playerId) renderTopbar();
  };
  if (friendly && s.owner === G.playerId) {
    openModal(`<h2>🔦 Hyper Lazer</h2>
      <p class="bad">Warning: ${friendly} friendly unit${friendly > 1 ? "s" : ""} inside the target area will be destroyed.</p>
      <button class="btn danger" id="hl-fire">Fire anyway</button>
      <button class="btn" data-close>Abort</button>`);
    document.getElementById("hl-fire").onclick = () => { closeModal(); fire(); };
  } else fire();
  return true;
}
function tickHyperStrikes(dt) {
  if (!hyperStrikes.length) return;
  for (const h of hyperStrikes) {
    h.t += dt;
    if (h.t < h.dur) continue;
    h.done = true;
    const s = shipById(h.shipId);
    if (!s || !shipNearPlanet(s, "home")) { // left orbit mid-charge
      log("🔦 The orbital strike fizzles — the Star Destroyer left its firing position.", "sys");
      continue;
    }
    const R = HYPER_LAZER.radius;
    boomFx.push({ x: h.x, y: h.y, ttl: 1.8, max: 1.8, kind: "hyper", r: R });
    spawnDebris(h.x, h.y, 24);
    if (typeof netHostFx === "function") netHostFx(["h", h.x | 0, h.y | 0, R]);
    sfx("nukeBoom");
    let killed = 0;
    for (const a of G.armies.slice()) {
      const d = Math.hypot(a.x - h.x, a.y - h.y);
      if (d > R) continue;
      // hitting a neutral nation's troops means war, exactly like the core cannon
      if (a.owner !== h.owner && typeof sdDeclareWarIfNeeded === "function") sdDeclareWarIfNeeded(h.owner, a.owner);
      const fall = 1 - 0.55 * (d / R);
      a.hp -= HYPER_LAZER.dmg * fall; // troops only — cities and buildings are untouched
      if (a.hp <= 0) { killed++; killArmy(a, h.owner, true); } // orbital lasing is no rallying victory
    }
    log(`🔦 ORBITAL STRIKE — the hyper lazer annihilates ${killed} unit${killed === 1 ? "" : "s"}.`, "war");
    if (h.owner === G.playerId) toast(`🔦 Orbital strike complete — ${killed} unit${killed === 1 ? "" : "s"} destroyed.`);
  }
  hyperStrikes = hyperStrikes.filter(h => !h.done);
}

// remove a province/city from the world entirely (nuclear annihilation)
function destroyCity(p) {
  for (const cid of Object.keys(G.countries)) {
    const cc = G.countries[cid];
    const idx = cc.provinces.indexOf(p);
    if (idx < 0) continue;
    cc.provinces.splice(idx, 1);
    if (cc.capital > idx) cc.capital--;
    else if (cc.capital >= cc.provinces.length) cc.capital = Math.max(0, cc.provinces.length - 1);
    break;
  }
  rebuildCityIndex();
  mapOwnershipChanged();
}

// ---------------- AI tactics ----------------
// Land armies never touch water. When every target lies across the sea the AI
// requests a transport: ships pick troops up at the shore, ferry them over and
// unload them onto valid land near the destination. With no transport, armies
// stick to their own landmass (land route) or stand down entirely.
function tickAI() {
  // Sandbox Improvement §10: "AI Enabled" off silences the tactical brain too —
  // no AI army takes a new order until the toggle comes back on
  if (typeof sandboxOn === "function" && sandboxOn("aiOff")) return;
  const cityComp = CITIES.map(c => compAt(c.prov.px, c.prov.py));
  for (const cid of Object.keys(G.countries)) {
    const id = Number(cid);
    if (isHumanControlled(id) || !G.countries[id].alive) continue;
    // SU2 Part 3: alien landing forces fight on the surface with the same
    // tactical brain as any nation — march, engage, capture, no special rules
    if (G.countries[id].rebel) {
      // rebels dig in: they defend their seized province and never march out
      for (const a of G.armies) {
        if (a.owner !== id) continue;
        const h = a.holdAt || a;
        if ((a.x - h.x) ** 2 + (a.y - h.y) ** 2 > 34 * 34) { a.tx = h.x + rnd(-10, 10); a.ty = h.y + rnd(-10, 10); }
      }
      continue;
    }
    const wars = G.wars.filter(w => w.a === id || w.b === id).map(w => (w.a === id ? w.b : w.a))
      .filter(f => G.countries[f] && G.countries[f].alive);
    // an ordered mainland assault expires with its war (Sandbox §14)
    const C9 = G.countries[id];
    if (C9.assault && (!wars.includes(C9.assault.target) || (C9.assault.until && G.turn > C9.assault.until))) C9.assault = null;
    const myArmies = G.armies.filter(a => a.owner === id);
    if (!myArmies.length) continue;
    const myCities = [], enemyCities = [];
    CITIES.forEach((c, gi) => {
      const ctrl = provCtrl(c.prov);
      if (ctrl === id) myCities.push({ c, comp: cityComp[gi] });
      else if (wars.includes(ctrl)) enemyCities.push({ c, comp: cityComp[gi] });
    });
    const transports = myArmies.filter(a => UNITS[a.unit].cap && !UNITS[a.unit].space);
    const ferryWanters = [];
    for (const a of myArmies) {
      const u = UNITS[a.unit];
      if (u.space) continue; // spacecraft answer to the space AI (space.js)
      if (u.naval) {
        if (u.cap) continue; // transports are steered by aiFerry below
        // warships: patrol home waters in peace, blockade enemy harbours in war
        if (wars.length && enemyCities.length) {
          const t = nearestOf(enemyCities, a.x, a.y);
          const w = findWaterNear(t.c.prov.px, t.c.prov.py, 130);
          if (w) { a.tx = w.x; a.ty = w.y; }
        } else if (myCities.length) {
          const t = nearestOf(myCities, a.x, a.y);
          if ((a.x - t.c.prov.px) ** 2 + (a.y - t.c.prov.py) ** 2 > 130 ** 2) {
            const w = findWaterNear(t.c.prov.px, t.c.prov.py, 130);
            if (w) { a.tx = w.x; a.ty = w.y; }
          }
        }
        continue;
      }
      if (a.boarding) { // committed to a pickup — aiFerry owns this army
        if (!transports.some(t => t.id === a.boarding)) a.boarding = null;
        else continue;
      }
      const myComp = compAt(a.x, a.y);
      const homeHere = myCities.filter(mc => mc.comp === myComp);
      // 1. badly hurt: fall back to a city on this landmass
      if (a.hp < a.maxHp * 0.3 && homeHere.length) {
        const t = nearestOf(homeHere, a.x, a.y);
        a.tx = t.c.prov.px; a.ty = t.c.prov.py; a.order = null;
        continue;
      }
      if (!wars.length) {
        if (homeHere.length) {
          const t = nearestOf(homeHere, a.x, a.y);
          if ((a.x - t.c.prov.px) ** 2 + (a.y - t.c.prov.py) ** 2 > 55 ** 2) { a.tx = t.c.prov.px; a.ty = t.c.prov.py; }
        }
        continue;
      }
      // 2. engage enemies nearby — on this landmass, or anything already in range
      let foe = null, fd = (u.vis + 40) ** 2;
      for (const b of G.armies) {
        if (!wars.includes(b.owner)) continue;
        const d = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
        if (d >= fd) continue;
        if (u.air || UNITS[b.unit].naval || compAt(b.x, b.y) === myComp || d <= u.rng * u.rng) { fd = d; foe = b; }
      }
      if (foe) {
        const d = Math.sqrt(fd);
        if (d > u.rng * 0.8) {
          if (u.air || compAt(foe.x, foe.y) === myComp) { a.tx = foe.x; a.ty = foe.y; }
          else { const sh = findLandNear(foe.x, foe.y, 60); if (sh && compAt(sh.x, sh.y) === myComp) { a.tx = sh.x; a.ty = sh.y; } }
        } else { a.tx = a.x; a.ty = a.y; }
        continue;
      }
      // 3. defend a city being captured on this landmass
      const threatened = homeHere.filter(mc => mc.c.prov.capProg > 0);
      if (threatened.length) {
        const t = nearestOf(threatened, a.x, a.y);
        a.tx = t.c.prov.px; a.ty = t.c.prov.py;
        continue;
      }
      // 4. march on the nearest enemy city with a land route (air flies to any).
      // Sandbox §14 "Attack Mainland": an ordered assault drives on the enemy
      // CAPITAL first — most armies converge there until it falls.
      const sameComp = u.air ? enemyCities : enemyCities.filter(ec => ec.comp === myComp);
      if (sameComp.length) {
        const C0 = G.countries[id];
        let t = null;
        if (C0.assault && wars.includes(C0.assault.target)) {
          const T = G.countries[C0.assault.target];
          const capProv = T && T.alive ? T.provinces[T.capital] : null;
          const capEntry = capProv ? sameComp.find(ec => ec.c.prov === capProv) : null;
          if (capEntry && Math.random() < 0.7) t = capEntry;
        }
        if (!t) t = nearestOf(sameComp, a.x, a.y);
        a.tx = t.c.prov.px + rnd(-8, 8); a.ty = t.c.prov.py + rnd(-8, 8);
      } else if (enemyCities.length && transports.length) {
        ferryWanters.push(a); // request sea lift — only if a transport actually exists
      } else if (homeHere.length) {
        // no land route and no transport: cancel the advance, hold the homeland
        const t = nearestOf(homeHere, a.x, a.y);
        if ((a.x - t.c.prov.px) ** 2 + (a.y - t.c.prov.py) ** 2 > 55 ** 2) { a.tx = t.c.prov.px; a.ty = t.c.prov.py; }
      }
    }
    if (transports.length) aiFerry(id, transports, ferryWanters, enemyCities, myCities);
    // consolidate clustered stacks now and then — same merge rules as the player
    if (Math.random() < 0.2) aiTryMerge(id, myArmies);
  }
}
function nearestOf(list, x, y) {
  let best = list[0], bd = Infinity;
  for (const e of list) {
    const d = (e.c.prov.px - x) ** 2 + (e.c.prov.py - y) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

// transport missions: pickup (sail to the shore where troops wait, load them)
// then carry (sail to waters near the target coast, unload onto valid land)
function aiFerry(id, transports, wanters, enemyCities, myCities) {
  if (!enemyCities.length) {
    // war ended: cancel pickups and bring embarked troops home ashore
    for (const t of transports) {
      t.mission = null;
      if ((t.cargo || []).length && myCities && myCities.length) {
        const home = nearestOf(myCities, t.x, t.y);
        const w = findWaterNear(home.c.prov.px, home.c.prov.py, 130);
        if (w) {
          t.tx = w.x; t.ty = w.y;
          if ((t.x - w.x) ** 2 + (t.y - w.y) ** 2 < 45 * 45) {
            while (t.cargo.length) {
              const spot = findLandNear(t.x + rnd(-12, 12), t.y + rnd(-12, 12), TRANSPORT_DEPLOY_R);
              if (!spot || compAt(spot.x, spot.y) !== home.comp) break;
              const cu = t.cargo.pop();
              const na = spawnArmy(t.owner, cu.unit, spot.x, spot.y);
              na.hp = Math.min(cu.hp, na.maxHp);
            }
          }
        }
      }
    }
    for (const a of G.armies) if (a.owner === id && a.boarding) a.boarding = null;
    return;
  }
  for (const t of transports) {
    if (t.mission && t.mission.list) {
      t.mission.list = t.mission.list.filter(aid => armyById(aid));
      if (t.mission.phase === "pickup" && !t.mission.list.length && !(t.cargo || []).length) t.mission = null;
    }
  }
  const unclaimed = wanters.filter(a => !a.boarding);
  const free = transports.filter(t => !t.mission && !(t.cargo || []).length);
  for (const t of free) {
    if (!unclaimed.length) break;
    unclaimed.sort((m1, m2) => ((m1.x - t.x) ** 2 + (m1.y - t.y) ** 2) - ((m2.x - t.x) ** 2 + (m2.y - t.y) ** 2));
    const first = unclaimed[0];
    const w = findWaterNear(first.x, first.y, 110);
    if (!w) { unclaimed.shift(); continue; }
    const grp = [];
    for (let i = 0; i < unclaimed.length && grp.length < UNITS[t.unit].cap; i++) {
      if (!canBoardTransport(t, unclaimed[i].unit)) continue; // rafts refuse late-era troops
      if ((unclaimed[i].x - first.x) ** 2 + (unclaimed[i].y - first.y) ** 2 < 140 * 140) grp.push(unclaimed[i]);
    }
    for (const m of grp) { m.boarding = t.id; unclaimed.splice(unclaimed.indexOf(m), 1); }
    t.mission = { phase: "pickup", list: grp.map(m => m.id), wx: w.x, wy: w.y };
  }
  for (const t of transports) {
    if (!t.mission) {
      if ((t.cargo || []).length && enemyCities.length) t.mission = { phase: "carry" };
      else continue;
    }
    if (t.mission.phase === "pickup") {
      t.tx = t.mission.wx; t.ty = t.mission.wy; t.order = null;
      const shore = findLandNear(t.mission.wx, t.mission.wy, 60);
      for (const aid of t.mission.list.slice()) {
        const a = armyById(aid);
        if (!a) continue;
        if (shore) { a.tx = shore.x; a.ty = shore.y; }
        if ((t.cargo || []).length < UNITS[t.unit].cap && canBoardTransport(t, a.unit) &&
            (a.x - t.x) ** 2 + (a.y - t.y) ** 2 <= TRANSPORT_LOAD_R ** 2) {
          t.cargo = t.cargo || [];
          t.cargo.push({ unit: a.unit, hp: a.hp, maxHp: a.maxHp });
          removeArmyQuiet(a);
          t.mission.list.splice(t.mission.list.indexOf(aid), 1);
        }
      }
      if ((t.cargo || []).length >= UNITS[t.unit].cap ||
          ((t.cargo || []).length && !t.mission.list.length)) {
        t.mission = { phase: "carry" };
      }
    }
    if (t.mission && t.mission.phase === "carry") {
      if (!(t.cargo || []).length) { t.mission = null; continue; }
      if (!enemyCities.length) { t.mission = null; continue; } // war over mid-crossing: hold cargo
      const tc = nearestOf(enemyCities, t.x, t.y);
      const w = findWaterNear(tc.c.prov.px, tc.c.prov.py, 150);
      if (!w) { t.mission = null; continue; }
      t.tx = w.x; t.ty = w.y; t.order = null;
      if ((t.x - w.x) ** 2 + (t.y - w.y) ** 2 < 45 * 45) {
        // unload only onto land that belongs to the target's landmass
        let deployed = 0;
        while ((t.cargo || []).length) {
          const spot = findLandNear(t.x + rnd(-12, 12), t.y + rnd(-12, 12), TRANSPORT_DEPLOY_R);
          if (!spot || compAt(spot.x, spot.y) !== tc.comp) break;
          const cu = t.cargo.pop();
          const na = spawnArmy(t.owner, cu.unit, spot.x, spot.y);
          na.hp = Math.min(cu.hp, na.maxHp);
          na.tx = tc.c.prov.px + rnd(-8, 8); na.ty = tc.c.prov.py + rnd(-8, 8);
          deployed++;
        }
        if (deployed && !(t.cargo || []).length) t.mission = null;
      }
    }
  }
}
function nearestCity(list, x, y) {
  let best = list[0], bd = Infinity;
  for (const c of list) {
    const d = (c.prov.px - x) ** 2 + (c.prov.py - y) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// ---------------- rendering ----------------
function renderCities() {
  const zoomBig = view.z >= 0.85;
  if (!cityLayerDirty && zoomBig === cityZoomBig) return;
  cityLayerDirty = false; cityZoomBig = zoomBig;
  const cv = document.getElementById("cv-city");
  cv.width = MW; cv.height = MH;
  const ctx = cv.getContext("2d");
  ctx.textAlign = "center";
  const pid = G.playerId;
  const vo = typeof viewOpts !== "undefined" ? viewOpts : null;
  const onlyMine = vo && vo.countryMode === "mine";
  for (const c of CITIES) {
    const p = c.prov;
    const ctrl = provCtrl(p);
    // "show only my country": keep own cities and cities of nations we fight
    if (onlyMine && !(ctrl === pid || p.own === pid || atWar(pid, ctrl) || atWar(pid, p.own))) continue;
    const holder = G.countries[ctrl];
    const col = holder.flag.bg;
    const era = holder.era;
    const isCap = G.countries[c.cid].capital === c.pi && p.own === c.cid;
    const r = isCap ? 6.5 : 4.5;
    // the marker itself evolves with its owner's era (Part 3 §4)
    ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = p.occ ? "#ff5468" : "rgba(8,14,24,.9)";
    if (era <= 3) {                       // early ages: the classic round settlement
      ctx.beginPath(); ctx.arc(p.px, p.py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (era <= 6) {                // industrial→information: a built-up block
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(p.px - r, p.py - r, r * 2, r * 2, 1.5);
      else ctx.rect(p.px - r, p.py - r, r * 2, r * 2);
      ctx.fill(); ctx.stroke();
      if (era === 4) {                    // industrial smokestack
        ctx.fillStyle = "rgba(70,66,74,.95)";
        ctx.fillRect(p.px + r - 2, p.py - r - 3, 2, 3);
        ctx.fillStyle = "rgba(200,200,210,.4)";
        ctx.beginPath(); ctx.arc(p.px + r - 0.5, p.py - r - 4.5, 1.6, 0, Math.PI * 2); ctx.fill();
      }
    } else {                              // futuristic+: hex arcology
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const ang = k * Math.PI / 3 - Math.PI / 6;
        const hx = p.px + Math.cos(ang) * (r + 0.8), hy = p.py + Math.sin(ang) * (r + 0.8);
        if (k === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = era >= 9 ? "rgba(255,127,227,.75)" : "rgba(110,235,255,.75)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.lineWidth = 1.6;
    }
    if (isCap) {
      ctx.beginPath();
      ctx.arc(p.px, p.py, r + 2.6, 0, Math.PI * 2);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = "rgba(255,215,106,.95)";
      ctx.stroke();
    }
    // construction site: progress arc + a tiny crane while the queue works (Part 3 §6)
    if (!p.occ && p.bq && p.bq.length) {
      const it = p.bq[0];
      const f = clamp(it.done / it.need, 0, 1);
      ctx.strokeStyle = "rgba(240,168,72,.9)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.px, p.py, r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); ctx.stroke();
      const cx = p.px + r + 7, cy = p.py - r - 3;
      ctx.strokeStyle = "rgba(255,200,120,.95)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx, cy + 8); ctx.lineTo(cx, cy);          // tower
      ctx.moveTo(cx - 2, cy + 2); ctx.lineTo(cx + 6, cy);  // jib
      ctx.moveTo(cx + 5, cy + 0.5); ctx.lineTo(cx + 5, cy + 4); // cable
      ctx.stroke();
      ctx.fillStyle = "rgba(255,200,120,.95)";
      ctx.fillRect(cx + 4, cy + 4, 2, 2);
    }
    const nameSize = zoomBig ? 10 : 12;
    if (zoomBig || isCap || ctrl === pid) {
      const lvlTag = (p.lvl || 1) > 1 ? ` ▲${p.lvl}` : "";
      ctx.font = `600 ${nameSize}px "Segoe UI", sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(5,10,18,.8)";
      ctx.fillStyle = p.occ ? "#ffb9c2" : "#eef5ff";
      ctx.strokeText(p.city + lvlTag, p.px, p.py - r - 4);
      ctx.fillText(p.city + lvlTag, p.px, p.py - r - 4);
      if (vo && vo.showProvinces) {
        ctx.font = `${nameSize - 2}px "Segoe UI", sans-serif`;
        ctx.fillStyle = "rgba(190,214,238,.85)";
        ctx.strokeText(p.name + " Province", p.px, p.py + r + 10);
        ctx.fillText(p.name + " Province", p.px, p.py + r + 10);
      }
    }
  }
}

function renderArmies() {
  const layer = document.getElementById("army-layer");
  if (!layer) return;
  const pid = G.playerId;
  const vo = typeof viewOpts !== "undefined" ? viewOpts : null;
  const armyMode = vo ? vo.armyMode : "all";
  const foesAtWar = {};
  for (const w of G.wars) { if (w.a === pid) foesAtWar[w.b] = 1; if (w.b === pid) foesAtWar[w.a] = 1; }
  const seen = new Set();
  for (const a of G.armies) {
    // visibility is throttled (visCache refreshes a few times per second) —
    // the exact per-frame check was quadratic in army count
    let visible = visCache.get(a.id);
    if (visible === undefined) { visible = isVisibleToPlayer(a); visCache.set(a.id, visible); }
    // visibility filter — but armies of nations at war with us are always shown
    if (visible && armyMode !== "all" && !foesAtWar[a.owner]) {
      visible = a.owner === pid ? armyMode === "mine" : false;
    }
    if (!visible) continue;
    seen.add(a.id);
    let el = armyEls.get(a.id);
    if (!el || !el.isConnected) {
      const u = UNITS[a.unit];
      const col = G.countries[a.owner].flag.bg;
      const veh = VEHICLE_UNITS.has(a.unit) ? vehicleSVG(a.unit, col) : null;
      el = document.createElement("div");
      el.id = "army-" + a.id;
      el.className = "army" + (a.owner === pid ? " mine" : "") + (u.big ? " big" : "") + (veh ? " vehicle" : "");
      el.innerHTML = `<div class="a-name"></div><div class="a-hpbar"><i></i></div><div class="a-box">${veh || u.icon}</div><div class="a-info"></div><div class="a-cargo"></div><div class="a-stack"></div>`;
      if (!veh) el.querySelector(".a-box").style.borderColor = a.owner === pid ? "#4fd6ff" : `rgb(${col[0]},${col[1]},${col[2]})`;
      el.addEventListener("mousedown", e => e.stopPropagation());
      el.addEventListener("click", e => { e.stopPropagation(); armyClicked(a.id, e); });
      layer.appendChild(el);
      armyEls.set(a.id, el);
      el._q = {
        name: el.querySelector(".a-name"), hp: el.querySelector(".a-hpbar i"),
        cargo: el.querySelector(".a-cargo"), stack: el.querySelector(".a-stack"),
        info: el.querySelector(".a-info"),
      };
    }
    const q = el._q;
    // enemy styling may change as wars start/end
    const hostile = a.owner !== pid && !!foesAtWar[a.owner];
    el.classList.toggle("enemy", hostile);
    const isSel = selArmies.includes(a.id);
    el.classList.toggle("sel", isSel);
    el.style.transform = `translate(${a.x}px, ${a.y}px)`;
    // small status readout under a selected unit (Part 3 §1)
    if (isSel && q.info) {
      const ord = a.order
        ? (a.order.type === "attack" ? "⚔ engaging" : a.order.type === "board" ? "⛴ boarding" : "➜ moving")
        : (Math.abs(a.tx - a.x) > 3 || Math.abs(a.ty - a.y) > 3 ? "➜ moving" : "■ holding");
      const info = `${Math.round(a.hp)}/${Math.round(a.maxHp)} hp · ${ord}` +
        (a.cargo && a.cargo.length ? ` · 👾${a.cargo.length}` : "");
      if (el._info !== info) { el._info = info; q.info.textContent = info; }
    }
    // DOM writes only when a value actually changed — style/text churn was
    // a large share of the long-session frame cost
    const st = a.stack || 1;
    const nm = UNITS[a.unit].n + (st > 1 ? " ×" + st : "");
    if (el._nm !== nm) { el._nm = nm; q.name.textContent = nm; }
    const hpPct = Math.max(0, Math.round(a.hp / a.maxHp * 100));
    if (el._hp !== hpPct) { el._hp = hpPct; q.hp.style.width = hpPct + "%"; }
    if (el._st !== st) {
      el._st = st;
      q.stack.style.display = st > 1 ? "" : "none";
      if (st > 1) q.stack.textContent = "×" + st;
      el.classList.toggle("stacked", st > 1);
    }
    const n = a.cargo ? a.cargo.length : 0;
    if (el._cg !== n) {
      el._cg = n;
      q.cargo.style.display = n ? "" : "none";
      if (n) q.cargo.textContent = n + "/" + UNITS[a.unit].cap;
    }
  }
  // remove stale / hidden elements
  for (const [id, el] of armyEls) {
    if (!seen.has(id)) { el.remove(); armyEls.delete(id); }
  }
}

function renderFx() {
  const cv = document.getElementById("cv-fx");
  if (!cv) return;
  if (cv.width !== MW) { cv.width = MW; cv.height = MH; }
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, MW, MH);
  // a scorched Homeworld burns beneath everything else (Space Update Part 2)
  if (typeof homeworldScorched === "function" && homeworldScorched()) drawScorchedWorld(ctx);
  // vision + range circle for a single selected army
  if (selArmies.length === 1) {
    const a = armyById(selArmies[0]);
    if (a) {
      const u = UNITS[a.unit];
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(a.x, a.y, u.vis, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(79,214,255,.4)"; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.beginPath(); ctx.arc(a.x, a.y, u.rng, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,84,104,.5)"; ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // move target markers
  for (const sid of selArmies) {
    const a = armyById(sid);
    if (a && (Math.abs(a.tx - a.x) > 3 || Math.abs(a.ty - a.y) > 3)) {
      ctx.beginPath(); ctx.arc(a.tx, a.ty, 4, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(92,224,162,.8)"; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }
  // shift-drag selection box
  if (selBox) {
    const x = Math.min(selBox.x0, selBox.x1), y = Math.min(selBox.y0, selBox.y1);
    const w = Math.abs(selBox.x1 - selBox.x0), h = Math.abs(selBox.y1 - selBox.y0);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "rgba(79,214,255,.9)"; ctx.lineWidth = 1.4;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(79,214,255,.08)";
    ctx.fillRect(x, y, w, h);
  }
  // shots
  for (const s of shotsFx) {
    const f = s.ttl / s.max;
    if (s.kind === "melee") {
      ctx.beginPath(); ctx.arc(s.x2, s.y2, 5 * (1 - f) + 2, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,236,180,${f})`; ctx.lineWidth = 2; ctx.stroke();
    } else if (s.kind === "shell") {
      // arcing artillery shell with a faint tracer
      const p = 1 - f; // progress 0→1
      const sx = s.x1 + (s.x2 - s.x1) * p, sy = s.y1 + (s.y2 - s.y1) * p;
      const arc = Math.sin(Math.PI * p) * Math.max(10, Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * 0.22);
      ctx.beginPath(); ctx.moveTo(sx, sy - arc); ctx.lineTo(sx - (s.x2 - s.x1) * 0.04, sy - arc + 2);
      ctx.strokeStyle = "rgba(255,210,140,.7)"; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.beginPath(); ctx.arc(sx, sy - arc, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = "#ffd9a0"; ctx.fill();
    } else if (s.kind === "rail") {
      // railgun: blinding white-blue lance with a halo
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2);
      ctx.strokeStyle = `rgba(170,220,255,${0.5 * f})`; ctx.lineWidth = 5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2);
      ctx.strokeStyle = `rgba(255,255,255,${f})`; ctx.lineWidth = 1.8; ctx.stroke();
    } else if (s.kind === "beam") {
      // futuristic energy lance + impact splash
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2);
      ctx.strokeStyle = `rgba(130,255,255,${f})`; ctx.lineWidth = 2.4; ctx.stroke();
      ctx.beginPath(); ctx.arc(s.x2, s.y2, 3 + (1 - f) * 5, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(130,255,255,${0.7 * f})`; ctx.lineWidth = 1.2; ctx.stroke();
    } else if (s.kind === "gun") {
      // a short tracer racing along the firing line
      const p = 1 - f;
      const sx = s.x1 + (s.x2 - s.x1) * p, sy = s.y1 + (s.y2 - s.y1) * p;
      const bx = s.x1 + (s.x2 - s.x1) * Math.max(0, p - 0.2), by = s.y1 + (s.y2 - s.y1) * Math.max(0, p - 0.2);
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(sx, sy);
      ctx.strokeStyle = `rgba(255,199,123,${0.4 + 0.6 * f})`; ctx.lineWidth = 1.3; ctx.stroke();
    } else {
      // an actual arrow in flight, arcing to its target
      const p = 1 - f;
      const sx = s.x1 + (s.x2 - s.x1) * p, sy = s.y1 + (s.y2 - s.y1) * p;
      const arc = Math.sin(Math.PI * p) * Math.min(14, Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * 0.18);
      const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      ctx.save(); ctx.translate(sx, sy - arc); ctx.rotate(ang);
      ctx.strokeStyle = `rgba(222,238,255,${0.5 + 0.5 * f})`; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(3, 0); ctx.stroke();
      ctx.fillStyle = "#dceeff";
      ctx.beginPath(); ctx.moveTo(4.5, 0); ctx.lineTo(2, -1.4); ctx.lineTo(2, 1.4); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
  // muzzle flashes & impact sparks
  for (const s of sparkFx) {
    if (s.delay > 0) continue;
    const f = s.ttl / s.max;
    if (s.kind === "muzzle") {
      const ang = Math.atan2(s.ty - s.y, s.tx - s.x);
      ctx.beginPath(); ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + Math.cos(ang) * 6, s.y + Math.sin(ang) * 6);
      ctx.strokeStyle = `rgba(255,235,150,${f})`; ctx.lineWidth = 3; ctx.stroke();
    } else {
      const n = s.kind === "clash" ? 4 : 5;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + s.max;
        const r1 = 2 + (1 - f) * 6;
        ctx.beginPath(); ctx.moveTo(s.x + Math.cos(ang) * 2, s.y + Math.sin(ang) * 2);
        ctx.lineTo(s.x + Math.cos(ang) * r1, s.y + Math.sin(ang) * r1);
        ctx.strokeStyle = s.kind === "clash" ? `rgba(255,244,200,${f})` : `rgba(255,190,110,${f})`;
        ctx.lineWidth = 1.2; ctx.stroke();
      }
    }
  }
  // debris & rubble
  for (const p of debrisFx) {
    const f = p.ttl / p.max;
    ctx.fillStyle = p.col;
    ctx.globalAlpha = Math.min(1, f * 1.6);
    ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
  }
  ctx.globalAlpha = 1;
  drawAmbientCraft(ctx); // civilian planes & spaceships (QoL §14-15)
  // missile smoke trails
  for (const s of smokeFx) {
    const f = s.ttl / s.max;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r + (1 - f) * 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(180,180,190,${0.35 * f})`; ctx.fill();
  }
  // strategic missiles in flight — a real rocket, not a moving box
  for (const m of missilesFly) {
    const mt = MISSILE_TYPES[m.type];
    const gx = m.gx, gy = m.gy, alt = m.alt || 0;
    // ground shadow
    ctx.beginPath(); ctx.ellipse(gx, gy, 4, 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fill();
    const x = gx, y = gy - alt;
    const f2 = Math.min(1, m.f + 0.02);
    const nx2 = m.x0 + (m.tx - m.x0) * f2;
    const ny2 = m.y0 + (m.ty - m.y0) * f2 - Math.sin(Math.PI * f2) * m.dist * (mt.homing ? 0.06 : 0.16);
    const ang = Math.atan2(ny2 - y, nx2 - x);
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    const L = mt.nuke ? 13 : 10, W = mt.nuke ? 4 : 3;
    ctx.beginPath(); // exhaust flame
    ctx.moveTo(-L / 2 - 6 - rnd(0, 3), 0); ctx.lineTo(-L / 2, -W * 0.45); ctx.lineTo(-L / 2, W * 0.45); ctx.closePath();
    ctx.fillStyle = "rgba(255,190,80,.85)"; ctx.fill();
    ctx.fillStyle = mt.nuke ? "#f2e9d8" : "#d8e2ee"; // body
    ctx.fillRect(-L / 2, -W / 2, L, W);
    ctx.beginPath(); // nose cone
    ctx.moveTo(L / 2, -W / 2); ctx.lineTo(L / 2 + 4, 0); ctx.lineTo(L / 2, W / 2); ctx.closePath();
    ctx.fillStyle = mt.nuke ? "#d04040" : "#8fb7d8"; ctx.fill();
    if (mt.nuke) { ctx.fillStyle = "rgba(255,230,90,.9)"; ctx.fillRect(-1.5, -W / 2, 1.5, W); }
    ctx.restore();
    if (smokeFx.length < fxCap(240) && Math.random() < 0.7) {
      smokeFx.push({ x: x - Math.cos(ang) * L * 0.8, y: y - Math.sin(ang) * L * 0.8, ttl: rnd(0.5, 0.9), max: 0.9, r: rnd(1.5, 3) });
    }
  }
  // Part 12: hyper-lazer targeting indicator while the beam charges
  for (const h of hyperStrikes) {
    const f = Math.min(1, h.t / h.dur);
    const R = HYPER_LAZER.radius;
    ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.arc(h.x, h.y, R, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(160,220,255,${0.35 + 0.4 * Math.sin(h.t * 10)})`; ctx.lineWidth = 2; ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(h.x, h.y, R * (1 - f), 0, Math.PI * 2); // collapsing lock ring
    ctx.strokeStyle = "rgba(120,210,255,.8)"; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(h.x - 8, h.y); ctx.lineTo(h.x + 8, h.y);
    ctx.moveTo(h.x, h.y - 8); ctx.lineTo(h.x, h.y + 8);
    ctx.strokeStyle = "rgba(200,240,255,.9)"; ctx.stroke();
  }
  // explosions
  for (const b of boomFx) {
    const f = 1 - b.ttl / b.max; // 0 → 1
    if (b.kind === "hyper") {
      // Part 12: the orbital beam — a blinding column from the sky, then a ring
      const R = b.r || 110;
      if (f < 0.35) {
        const bw = 14 * (1 - f / 0.35) + 3;
        const grd = ctx.createLinearGradient(b.x, b.y - 400, b.x, b.y);
        grd.addColorStop(0, "rgba(160,220,255,0)");
        grd.addColorStop(1, `rgba(210,240,255,${0.9 * (1 - f / 0.35)})`);
        ctx.fillStyle = grd;
        ctx.fillRect(b.x - bw / 2, b.y - 400, bw, 400);
        ctx.beginPath(); ctx.arc(b.x, b.y, R * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(230,248,255,${0.85 * (1 - f / 0.35)})`; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(b.x, b.y, 8 + f * R, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(140,215,255,${1 - f})`; ctx.lineWidth = 3.5 * (1 - f) + 0.8; ctx.stroke();
      ctx.beginPath(); ctx.arc(b.x, b.y, 4 + f * R * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(120,200,255,${0.45 * (1 - f)})`; ctx.fill();
    } else if (b.kind === "missile") {
      const R = b.r || 24;
      if (f < 0.25) { // flash
        ctx.beginPath(); ctx.arc(b.x, b.y, R * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,240,200,${0.75 * (1 - f / 0.25)})`; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(b.x, b.y, 5 + f * R, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,150,60,${1 - f})`; ctx.lineWidth = 3.5 * (1 - f) + 0.6; ctx.stroke();
      ctx.beginPath(); ctx.arc(b.x, b.y, 3 + f * R * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,110,40,${0.5 * (1 - f)})`; ctx.fill();
    } else if (b.kind === "nuke") {
      const R = b.r || 85;
      if (f < 0.12) { // blinding initial flash
        ctx.beginPath(); ctx.arc(b.x, b.y, R * 1.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,240,${0.9 * (1 - f / 0.12)})`; ctx.fill();
      }
      // fireball
      const fb = Math.min(1, f * 2.2);
      ctx.beginPath(); ctx.arc(b.x, b.y, 6 + fb * R * 0.75, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,${140 - f * 80 | 0},40,${0.65 * (1 - f)})`; ctx.fill();
      // expanding shockwave
      ctx.beginPath(); ctx.arc(b.x, b.y, f * R * 2.1, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,200,140,${0.8 * (1 - f)})`; ctx.lineWidth = 2.5; ctx.stroke();
      // rising mushroom column & cap
      const rise = f * 34;
      ctx.fillStyle = `rgba(120,100,90,${0.55 * (1 - f)})`;
      ctx.fillRect(b.x - 4 - f * 3, b.y - rise, 8 + f * 6, rise);
      ctx.beginPath(); ctx.ellipse(b.x, b.y - rise, 14 + f * 22, 8 + f * 10, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(140,115,100,${0.6 * (1 - f)})`; ctx.fill();
      ctx.beginPath(); ctx.ellipse(b.x, b.y - rise, 9 + f * 12, 5 + f * 6, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,160,70,${0.4 * (1 - f)})`; ctx.fill();
    } else if (b.kind === "build") {
      // construction finished: a rising ring and a few sparks (Part 3 §6)
      const R = b.r || 16;
      ctx.beginPath(); ctx.arc(b.x, b.y, 4 + f * R, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(140,235,180,${0.9 * (1 - f)})`; ctx.lineWidth = 2 * (1 - f) + 0.5; ctx.stroke();
      const n = 5;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + 0.8;
        const rr = 3 + f * R * 0.8;
        ctx.fillStyle = `rgba(255,214,130,${1 - f})`;
        ctx.fillRect(b.x + Math.cos(ang) * rr - 1, b.y + Math.sin(ang) * rr - f * 6 - 1, 2, 2);
      }
    } else if (b.kind === "intercept") {
      const R = b.r || 26;
      const n = 7;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + 0.5;
        ctx.beginPath(); ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x + Math.cos(ang) * (4 + f * R * 0.8), b.y + Math.sin(ang) * (4 + f * R * 0.8));
        ctx.strokeStyle = `rgba(170,230,255,${1 - f})`; ctx.lineWidth = 1.6; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(b.x, b.y, 3 + f * R * 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(230,250,255,${1 - f})`; ctx.lineWidth = 2; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(b.x, b.y, 4 + f * 16, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,150,60,${1 - f})`; ctx.lineWidth = 3 * (1 - f) + 0.5; ctx.stroke();
    }
  }
  // capture progress rings
  for (const c of CITIES) {
    const p = c.prov;
    if (p.capProg > 0 && p.capBy) {
      const col = G.countries[p.capBy].flag.bg;
      ctx.beginPath();
      ctx.arc(p.px, p.py, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.capProg / 100);
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},.95)`;
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.px, p.py, 11, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,.25)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}
