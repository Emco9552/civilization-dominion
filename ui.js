// ============================================================
// CIVILIZATION: DOMINION — UI, map rendering, screens
// ============================================================
"use strict";

const MW = MAP_META.w, MH = MAP_META.h;
let ID_ARR = null, LAND_ARR = null;
const maskCache = {};
let view = { x: 0, y: 0, z: 0.6 };
let hoverId = 0, selectedId = 0, pickedId = 0; // pickedId used on select screen
let uiTab = "overview";
let uiMilTab = "forces"; // Military sub-tab: "forces" | "up" (SU2 §13 Upgrades)
let diploTarget = 0, talkKind = "citizen", talkTarget = 0, espTarget = 0;
let screen = "menu";
let missileTargeting = null; // {type, fromProv} while picking a missile target
let foundMode = null;        // {phase:'draw'|'place', mask, area, brush} while founding a city
let sandboxTransfer = null;  // {to, whole} while sandbox territory transfer is armed
let sandboxDestroyMode = false; // Sandbox §8: click armies/cities to delete them

// map view options — presentation only, persisted outside the save
// (cityLights / ambient / buildFx / spaceOwners are the QoL §16 visual settings)
let viewOpts = { armyMode: "all", smallArmies: false, countryMode: "all", showProvinces: false, dayNight: true,
  cityLights: true, ambient: true, buildFx: true, spaceOwners: true, quality: "auto" };
try { Object.assign(viewOpts, JSON.parse(localStorage.getItem("civdom_viewopts") || "{}")); } catch (e) {}
function saveViewOpts() { try { localStorage.setItem("civdom_viewopts", JSON.stringify(viewOpts)); } catch (e) {} }

// ---------- performance mode (BUG REPORT Bug 2: mobile) ----------
// PERF.low trims particles, city lights, ambient craft and night effects so
// phones and weak devices keep a playable framerate without losing any
// gameplay feature. "auto" switches it on for mobile hardware; the player can
// force High or Low in the map tools (⚙ Quality).
const PERF = { low: false };
function isMobileDevice() {
  try {
    const coarse = window.matchMedia && matchMedia("(pointer: coarse)").matches;
    const ua = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent || "");
    // window.screen explicitly — the game's own `screen` variable (the current
    // UI screen name) shadows it here, which silently disabled this check
    const sw = window.screen || {};
    const small = Math.min(sw.width || 9999, sw.height || 9999) < 820;
    const lowMem = navigator.deviceMemory !== undefined && navigator.deviceMemory <= 4;
    return ua || (coarse && (small || lowMem));
  } catch (e) { return false; }
}
function applyQuality() {
  const q = viewOpts.quality || "auto";
  PERF.low = q === "low" || (q === "auto" && isMobileDevice());
  document.body.classList.toggle("perf-low", PERF.low);
}

// which nations stay visible when "only my country" is on: you + everyone at war with you
function warVisSet() {
  const s = {};
  if (!G) return s;
  s[G.playerId] = 1;
  for (const w of G.wars) { if (w.a === G.playerId) s[w.b] = 1; if (w.b === G.playerId) s[w.a] = 1; }
  return s;
}

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
function fmt(n) { return Math.round(n).toLocaleString("en"); }
function fmt1(n) { return (Math.round(n * 10) / 10).toFixed(1); }
// Final Alien Update Part 10: abbreviated numbers for the top bar — 1,000 → 1K,
// 1,000,000 → 1M, 1,000,000,000 → 1B — so huge treasuries can never stretch or
// wrap the bar. Full precision lives in the tooltips (fmt).
function fmtS(n) {
  const v = Math.round(n), a = Math.abs(v), sign = v < 0 ? "-" : "";
  const cut = (x, d) => {
    const p = Math.pow(10, d), r = Math.round(x * p) / p;
    return String(r);
  };
  if (a < 1000) return String(v);
  if (a < 1e6) return sign + cut(a / 1e3, a < 1e4 ? 1 : 0) + "K";
  if (a < 1e9) return sign + cut(a / 1e6, a < 1e7 ? 2 : a < 1e8 ? 1 : 0) + "M";
  if (a < 1e12) return sign + cut(a / 1e9, a < 1e10 ? 2 : a < 1e11 ? 1 : 0) + "B";
  return sign + cut(a / 1e12, 1) + "T";
}
// signed variant for income deltas
function fmtSd(n) { return (n >= 0 ? "+" : "") + fmtS(n); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function rgba(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }

// ============ MAP BOOT ============
const imgRL = new Image();
const imgRG = new Image();

// ---- loading screen (BUG 2): real steps, real errors, never an eternal spinner ----
function loadStep(msg) {
  const el = document.getElementById("load-step");
  if (el) el.textContent = msg;
  if (window.BOOT) window.BOOT.stage = String(msg).replace("…", ""); // feeds the debug report
}
function loadFail(detail) {
  if (window.BOOT) {
    window.BOOT.failed = true; // stop the stage marks from overwriting the error
    if (window.BOOT.errors.length < 20) window.BOOT.errors.push(String(detail));
  }
  const loading = document.getElementById("loading");
  if (!loading || loading.style.display === "none") return; // already in the game
  const st = document.getElementById("load-step");
  const de = document.getElementById("load-detail");
  const ac = document.getElementById("load-actions");
  const sp = loading.querySelector(".spinner");
  if (sp) sp.style.display = "none";
  if (st) st.innerHTML = '<span class="bad">LOADING FAILED</span>';
  if (de) de.textContent = detail || "Something went wrong while starting the game.";
  if (ac) {
    ac.style.display = "";
    const rb = document.getElementById("load-retry");
    if (rb) rb.onclick = () => location.reload();
  }
}
function bootAssets(cb) {
  let done = 0, failed = false;
  loadStep("Loading map…");
  const step = () => {
    if (failed) return;
    if (++done < 2) return;
    loadStep("Loading countries…");
    // yield one frame so the step text actually paints before the heavy work
    setTimeout(() => {
      try {
        buildRegionArrays();
        loadStep("Loading game data…");
        cb();
      } catch (e) {
        failed = true;
        loadFail("World build failed: " + (e && e.message ? e.message : e));
      }
    }, 30);
  };
  imgRL.onload = step; imgRG.onload = step;
  imgRL.onerror = () => { failed = true; loadFail("Could not load RLmap.png — keep all game files together in one folder."); };
  imgRG.onerror = () => { failed = true; loadFail("Could not decode the region map — mapdata.js may be damaged."); };
  imgRL.src = "RLmap.png";
  imgRG.src = "data:image/png;base64," + MAP_REGIONS_B64;
}

function buildRegionArrays() {
  const cv = document.createElement("canvas");
  cv.width = MW; cv.height = MH;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(imgRG, 0, 0);
  const d = ctx.getImageData(0, 0, MW, MH).data;
  ID_ARR = new Uint16Array(MW * MH);
  LAND_ARR = new Uint8Array(MW * MH);
  for (let i = 0; i < MW * MH; i++) {
    const raw = d[i * 4] + (d[i * 4 + 1] << 8);
    // merged countries: their pixels all answer to the surviving nation
    ID_ARR[i] = (typeof MERGE_TARGET !== "undefined" && MERGE_TARGET[raw]) || raw;
    LAND_ARR[i] = d[i * 4 + 2] > 127 ? 1 : 0;
  }
  buildLandComponents();
  drawBase();
}

// connected landmasses — armies may only walk within their own component;
// crossing to another one takes a Transport Ship (see war.js)
let COMP_ARR = null;
function buildLandComponents() {
  COMP_ARR = new Uint16Array(MW * MH);
  const stack = new Int32Array(MW * MH);
  let comp = 0;
  for (let s = 0; s < MW * MH; s++) {
    if (!LAND_ARR[s] || COMP_ARR[s]) continue;
    comp++;
    let top = 0;
    stack[top++] = s; COMP_ARR[s] = comp;
    while (top) {
      const i = stack[--top];
      const x = i % MW, y = (i / MW) | 0;
      if (x > 0 && LAND_ARR[i - 1] && !COMP_ARR[i - 1]) { COMP_ARR[i - 1] = comp; stack[top++] = i - 1; }
      if (x < MW - 1 && LAND_ARR[i + 1] && !COMP_ARR[i + 1]) { COMP_ARR[i + 1] = comp; stack[top++] = i + 1; }
      if (y > 0 && LAND_ARR[i - MW] && !COMP_ARR[i - MW]) { COMP_ARR[i - MW] = comp; stack[top++] = i - MW; }
      if (y < MH - 1 && LAND_ARR[i + MW] && !COMP_ARR[i + MW]) { COMP_ARR[i + MW] = comp; stack[top++] = i + MW; }
    }
  }
}
function compAt(x, y) {
  const i = (y | 0) * MW + (x | 0);
  return (COMP_ARR && i >= 0 && i < MW * MH) ? COMP_ARR[i] : 0;
}

function drawBase() {
  const cv = $("#cv-base");
  cv.width = MW; cv.height = MH;
  cv.getContext("2d").drawImage(imgRL, 0, 0, MW, MH);
}

// tint + political borders, drawn per city patch so captured land visibly changes hands
function repaintTint() {
  const tintCv = $("#cv-tint");
  tintCv.width = MW; tintCv.height = MH;
  const tctx = tintCv.getContext("2d");
  const tim = tctx.createImageData(MW, MH);
  const td = tim.data;

  const borderCv = $("#cv-border");
  borderCv.width = MW; borderCv.height = MH;
  const bctx = borderCv.getContext("2d");
  const bim = bctx.createImageData(MW, MH);
  const bd = bim.data;

  // colors per country (vassals blend toward their overlord)
  const colors = {};
  for (const meta of MAP_META.countries) {
    const id = meta.id;
    let col;
    if (G) {
      col = G.countries[id].flag.bg;
      if (G.vassals[id]) {
        const oc = G.countries[G.vassals[id]].flag.bg;
        col = [(col[0] + oc[0] * 2) / 3, (col[1] + oc[1] * 2) / 3, (col[2] + oc[2] * 2) / 3];
      }
    } else col = tintColor(id);
    colors[id] = col;
  }
  // synthetic countries (rebel enclaves) paint with their own banner colour
  if (G) {
    for (const cid of Object.keys(G.countries)) {
      if (!colors[cid] && G.countries[cid].flag) colors[cid] = G.countries[cid].flag.bg;
    }
  }

  // per-pixel political controller (city patch granularity in game)
  const haveCities = G && typeof CITY_ARR !== "undefined" && CITY_ARR;
  const cityCtrl = [], cityOcc = [], cityOwn = [];
  if (haveCities) {
    for (const c of CITIES) {
      cityOwn.push(c.prov.own);
      cityOcc.push(c.prov.occ || 0);
      cityCtrl.push(c.prov.occ || c.prov.own);
    }
  }
  // "only my country" hides other nations' overlays — war enemies stay visible
  const onlyMine = G && viewOpts.countryMode === "mine";
  const visSet = onlyMine ? warVisSet() : null;
  const ctrlArr = new Uint16Array(MW * MH);
  for (let i = 0; i < MW * MH; i++) {
    const id = ID_ARR[i];
    if (!id) continue;
    let ctrl = id;
    let occ = 0;
    if (haveCities && CITY_ARR[i]) {
      const gi = CITY_ARR[i] - 1;
      ctrl = cityCtrl[gi]; occ = cityOcc[gi];
    } else if (G) ctrl = controllerOf(id);
    if (onlyMine) {
      const ownPix = haveCities && CITY_ARR[i] ? cityOwn[CITY_ARR[i] - 1] : id;
      if (!visSet[ctrl] && !visSet[ownPix]) continue; // hidden: no tint, no borders
    }
    ctrlArr[i] = ctrl;
    if (!LAND_ARR[i]) continue;
    const x = i % MW, y = (i / MW) | 0;
    let col = colors[ctrl], alpha = 95;
    if (occ) {
      // occupied: war-stripes alternating occupier / rightful owner
      const stripe = ((x + y) >> 3) & 1;
      if (stripe) { alpha = 150; }
      else { col = colors[haveCities ? cityOwn[CITY_ARR[i] - 1] : id]; alpha = 80; }
    }
    if (!col) continue;
    const j = i * 4;
    td[j] = col[0]; td[j + 1] = col[1]; td[j + 2] = col[2]; td[j + 3] = alpha;
  }
  // political borders where controller changes
  for (let y = 0; y < MH - 1; y++) {
    for (let x = 0; x < MW - 1; x++) {
      const i = y * MW + x;
      const a = ctrlArr[i];
      if (a !== ctrlArr[i + 1] || a !== ctrlArr[i + MW]) {
        const j = i * 4;
        bd[j] = 8; bd[j + 1] = 12; bd[j + 2] = 20; bd[j + 3] = 200;
      }
    }
  }
  tctx.putImageData(tim, 0, 0);
  bctx.putImageData(bim, 0, 0);
  drawLabels();
  repaintProvinces();
}

// province overlay: dashed internal borders showing which land belongs to which city
function repaintProvinces() {
  const cv = $("#cv-prov");
  if (!cv) return;
  cv.width = MW; cv.height = MH;
  if (!viewOpts.showProvinces || !G || typeof CITY_ARR === "undefined" || !CITY_ARR) return;
  const ctx = cv.getContext("2d");
  const im = ctx.createImageData(MW, MH);
  const d = im.data;
  const onlyMine = viewOpts.countryMode === "mine";
  const visSet = onlyMine ? warVisSet() : null;
  const provVis = [];
  for (const c of CITIES) {
    provVis.push(!onlyMine || !!(visSet[c.prov.own] || visSet[provCtrl(c.prov)]));
  }
  for (let y = 0; y < MH - 1; y++) {
    for (let x = 0; x < MW - 1; x++) {
      const i = y * MW + x;
      const a = CITY_ARR[i];
      if (!a || !provVis[a - 1] || !LAND_ARR[i]) continue;
      const r = CITY_ARR[i + 1], dn = CITY_ARR[i + MW];
      const diff = (r && r !== a && ID_ARR[i + 1] === ID_ARR[i]) || (dn && dn !== a && ID_ARR[i + MW] === ID_ARR[i]);
      if (diff && ((x + y) & 7) < 5) { // dashed line
        const j = i * 4;
        d[j] = 240; d[j + 1] = 250; d[j + 2] = 255; d[j + 3] = 135;
      }
    }
  }
  ctx.putImageData(im, 0, 0);
}

function drawLabels() {
  const cv = $("#cv-label");
  cv.width = MW; cv.height = MH;
  const ctx = cv.getContext("2d");
  ctx.textAlign = "center";
  const onlyMine = G && viewOpts.countryMode === "mine";
  const visSet = onlyMine ? warVisSet() : null;
  for (const meta of MAP_META.countries) {
    if (meta.area < 2300) continue;
    if (G && !G.countries[meta.id].alive) continue;
    if (onlyMine) {
      const ctrlId = controllerOf(meta.id);
      const anyMine = G.countries[meta.id].provinces.some(p => p.own === G.playerId || p.occ === G.playerId);
      if (!visSet[meta.id] && !visSet[ctrlId] && !anyMine) continue;
    }
    const name = G ? G.countries[meta.id].name.toUpperCase() : NATIONS[meta.id].n.toUpperCase();
    const size = meta.area > 30000 ? 26 : meta.area > 8000 ? 19 : 13;
    ctx.font = `600 ${size}px "Segoe UI", sans-serif`;
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(5,10,18,.75)";
    ctx.fillStyle = "rgba(235,244,255,.88)";
    ctx.strokeText(name, meta.cx, meta.cy);
    ctx.fillText(name, meta.cx, meta.cy);
    if (G && G.playerId === meta.id) {
      ctx.font = "13px \"Segoe UI\"";
      ctx.strokeText("★ YOU", meta.cx, meta.cy + 17);
      ctx.fillStyle = "#ffd76a";
      ctx.fillText("★ YOU", meta.cx, meta.cy + 17);
    }
  }
}

function countryMask(id, color, alpha) {
  const key = id + "," + color + "," + alpha;
  if (maskCache[key]) return maskCache[key];
  const meta = metaOf(id);
  const [x0, y0, x1, y1] = meta.bbox;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  const im = ctx.createImageData(w, h);
  const d = im.data;
  const [r, g, b] = color;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gi = (y0 + y) * MW + (x0 + x);
      if (ID_ARR[gi] === id && LAND_ARR[gi]) {
        const j = (y * w + x) * 4;
        d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = alpha;
      }
    }
  }
  ctx.putImageData(im, 0, 0);
  maskCache[key] = cv;
  return cv;
}

function repaintHover() {
  const cv = $("#cv-hover");
  cv.width = MW; cv.height = MH;
  const ctx = cv.getContext("2d");
  // synthetic countries (rebels/aliens) own no map region — nothing to mask
  if (selectedId && metaOf(selectedId)) {
    const meta = metaOf(selectedId);
    ctx.drawImage(countryMask(selectedId, [80, 220, 255], 80), meta.bbox[0], meta.bbox[1]);
  }
  if (hoverId && hoverId !== selectedId && metaOf(hoverId)) {
    const meta = metaOf(hoverId);
    ctx.drawImage(countryMask(hoverId, [255, 255, 255], 60), meta.bbox[0], meta.bbox[1]);
  }
}

// ============ VIEWPORT ============
function applyView() {
  $("#map-stage").style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
}
function fitView() {
  const vp = $("#map-vp").getBoundingClientRect();
  view.z = Math.min(vp.width / MW, vp.height / MH);
  view.x = (vp.width - MW * view.z) / 2;
  view.y = (vp.height - MH * view.z) / 2;
  applyView();
}
function initViewport() {
  const vp = $("#map-vp");
  let drag = null, painting = false, boxing = false;
  vp.addEventListener("mousedown", e => {
    if (e.button === 2 && foundMode) {
      // right-drag pans the map while drawing a province
      drag = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
      return;
    }
    if (e.button !== 0) return;
    if (foundMode && foundMode.phase === "draw" && screen === "game") {
      painting = true;
      paintProvinceAt(e);
      return;
    }
    // Shift+drag: rubber-band selection box for own armies
    if (screen === "game" && e.shiftKey && !foundMode && !missileTargeting &&
        !(typeof placingUnit !== "undefined" && placingUnit)) {
      const m = mapXY(e);
      if (m) { boxing = true; selBox = { x0: m.x, y0: m.y, x1: m.x, y1: m.y }; return; }
    }
    drag = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
  });
  window.addEventListener("mousemove", e => {
    if (boxing) { const m = mapXY(e); if (m) { selBox.x1 = m.x; selBox.y1 = m.y; } return; }
    if (painting) { paintProvinceAt(e); return; }
    if (drag) {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
      view.x = drag.vx + dx; view.y = drag.vy + dy;
      applyView();
      return;
    }
    handleHover(e);
  });
  window.addEventListener("mouseup", e => {
    if (boxing) {
      boxing = false;
      if (selBox && typeof warBoxSelect === "function") warBoxSelect(selBox, e.ctrlKey);
      selBox = null;
      return;
    }
    if (painting) { painting = false; return; }
    if (e.button !== 0) { drag = null; return; }
    if (drag && !drag.moved) handleClick(e);
    drag = null;
  });
  vp.addEventListener("contextmenu", e => {
    e.preventDefault();
    if (screen !== "game" || foundMode || typeof selArmies === "undefined" || !selArmies.length) return;
    const m = mapXY(e);
    if (m) orderMove(m.x, m.y);
  });
  vp.addEventListener("wheel", e => {
    e.preventDefault();
    const rect = vp.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const oldZ = view.z;
    view.z = clamp(view.z * (e.deltaY < 0 ? 1.15 : 0.87), 0.3, 5);
    view.x = mx - (mx - view.x) * (view.z / oldZ);
    view.y = my - (my - view.y) * (view.z / oldZ);
    applyView();
  }, { passive: false });

  // ---- touch controls (BUG 2): one finger pans, pinch zooms, tap clicks
  // (via the browser's compatibility click), long-press = move order ----
  let touch = null, pinch = null, lpTimer = null;
  vp.addEventListener("touchstart", e => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touch = { sx: t.clientX, sy: t.clientY, vx: view.x, vy: view.y, moved: false };
      if (lpTimer) clearTimeout(lpTimer);
      lpTimer = setTimeout(() => {
        lpTimer = null;
        // long-press: the touch equivalent of right-click — move selected troops
        if (touch && !touch.moved && screen === "game" && typeof selArmies !== "undefined" && selArmies.length) {
          const m = mapXY({ clientX: touch.sx, clientY: touch.sy });
          if (m && typeof orderMove === "function") {
            orderMove(m.x, m.y);
            lpSuppressUntil = Date.now() + 500; // swallow the tap-click that follows
            if (navigator.vibrate) try { navigator.vibrate(25); } catch (err) {}
          }
        }
      }, 450);
    } else if (e.touches.length === 2) {
      touch = null;
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
      const a = e.touches[0], b = e.touches[1];
      pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: view.z,
        cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2, vx: view.x, vy: view.y };
    }
  }, { passive: true });
  vp.addEventListener("touchmove", e => {
    if (pinch && e.touches.length === 2) {
      const a = e.touches[0], b = e.touches[1];
      const nd = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const rect = vp.getBoundingClientRect();
      const mx = pinch.cx - rect.left, my = pinch.cy - rect.top;
      view.z = clamp(pinch.z * (nd / Math.max(1, pinch.d)), 0.3, 5);
      view.x = mx - (mx - pinch.vx) * (view.z / pinch.z);
      view.y = my - (my - pinch.vy) * (view.z / pinch.z);
      applyView();
      return;
    }
    if (touch && e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - touch.sx, dy = t.clientY - touch.sy;
      if (Math.abs(dx) + Math.abs(dy) > 8) {
        touch.moved = true;
        if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
      }
      if (touch.moved) { view.x = touch.vx + dx; view.y = touch.vy + dy; applyView(); }
    }
  }, { passive: true });
  vp.addEventListener("touchend", e => {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    if (e.touches.length < 2) pinch = null;
    if (touch && touch.moved) lpSuppressUntil = Date.now() + 400; // a pan is not a click
    if (e.touches.length === 0) touch = null;
  }, { passive: true });
}
// taps arrive as compatibility clicks; this timestamp swallows the ones that
// were really the tail end of a long-press or a pan gesture
let lpSuppressUntil = 0;
function mapXY(e) {
  const rect = $("#map-vp").getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left - view.x) / view.z);
  const y = Math.floor((e.clientY - rect.top - view.y) / view.z);
  if (x < 0 || y < 0 || x >= MW || y >= MH) return null;
  return { x, y };
}
function mapCoords(e) {
  const m = mapXY(e);
  return m ? ID_ARR[m.y * MW + m.x] : 0;
}
function handleHover(e) {
  if (!ID_ARR || (screen !== "select" && screen !== "game")) return;
  if (!e.target.closest || !e.target.closest("#map-vp")) { if (hoverId) { hoverId = 0; repaintHover(); hideTip(); } return; }
  if (e.target.closest && e.target.closest(".army")) { hideTip(); return; }
  const id = mapCoords(e);
  if (id !== hoverId) { hoverId = id; repaintHover(); }
  if (id) showTip(e, id); else hideTip();
}
function handleClick(e) {
  if (Date.now() < lpSuppressUntil) return; // tail of a touch pan / long-press
  if (!e.target.closest || !e.target.closest("#map-vp")) return;
  if (e.target.closest && e.target.closest(".army")) return;
  const m = mapXY(e);
  if (!m) return;
  if (screen === "game" && typeof hyperTargeting !== "undefined" && hyperTargeting) { hyperClickTarget(m.x, m.y); return; }
  if (screen === "game" && missileTargeting) { missileClickTarget(m.x, m.y); return; }
  if (screen === "game" && foundMode) { foundClick(m.x, m.y); return; }
  if (screen === "game" && sandboxTransfer) { sandboxTransferClick(m.x, m.y); return; }
  if (screen === "game" && sandboxDestroyMode) { sandboxDestroyClick(m.x, m.y); return; }
  if (screen === "game" && typeof warMapClick === "function") {
    if (warMapClick(m.x, m.y, e)) return;
  }
  const id = ID_ARR[m.y * MW + m.x];
  if (!id) return;
  if (screen === "select") { pickedId = id; renderPickPanel(); if (typeof S !== "undefined") S.play("click"); }
  else if (screen === "game") {
    // focus whoever actually controls the clicked ground — annexed and
    // conquered land answers to its current holder, not the old map name
    let cid = controllerOf(id);
    if (typeof cityAt === "function") {
      const c = cityAt(m.x, m.y, 14);
      if (c) cid = (c.prov.occ || c.prov.own);
      else if (typeof CITY_ARR !== "undefined" && CITY_ARR && CITY_ARR[m.y * MW + m.x]) {
        cid = provCtrl(CITIES[CITY_ARR[m.y * MW + m.x] - 1].prov);
      }
    }
    if (!G.countries[cid] || !G.countries[cid].alive) cid = controllerOf(cid);
    selectedId = cid;
    repaintHover();
    if (cid === G.playerId || controllerOf(cid) === G.playerId) { uiTab = "country"; }
    else { uiTab = "diplo"; diploTarget = cid; }
    renderSidebar();
  }
}

// sandbox: hand the clicked city (or the whole realm) to the chosen nation
function sandboxTransferClick(mx, my) {
  if (!G.sandbox || !sandboxTransfer) return;
  const to = sandboxTransfer.to;
  if (!G.countries[to] || !G.countries[to].alive) { sandboxTransfer = null; return; }
  const gi = (typeof CITY_ARR !== "undefined" && CITY_ARR) ? CITY_ARR[my * MW + mx] : 0;
  if (!gi) { toast("Click on land."); return; }
  const p = CITIES[gi - 1].prov;
  const src = provCtrl(p);
  if (src === to) { toast("They already control that."); return; }
  const list = sandboxTransfer.whole ? allProvs().filter(e => e.p.own === src).map(e => e.p) : [p];
  for (const pp of list) { pp.own = to; pp.occ = null; pp.capBy = 0; pp.capProg = 0; pp.unrest = 0; }
  if (typeof mapOwnershipChanged === "function") mapOwnershipChanged();
  toast(`🖐 ${list.length} cit${list.length > 1 ? "ies" : "y"} transferred from ${G.countries[src] ? G.countries[src].name : "?"} to ${G.countries[to].name}.`);
  if (typeof renderSidebar === "function") renderSidebar();
}

// Sandbox Improvement §8: click-to-destroy on the map — armies vanish at once,
// cities ask for confirmation (a nation's LAST city ends the nation with it)
function sandboxDestroyClick(mx, my) {
  if (!G.sandbox || !sandboxDestroyMode) return;
  // nearest army within reach dies first
  let best = null, bd = 15 * 15;
  for (const a of G.armies) {
    const d = (a.x - mx) ** 2 + (a.y - my) ** 2;
    if (d < bd) { bd = d; best = a; }
  }
  if (best) {
    if (typeof boomFx !== "undefined") boomFx.push({ x: best.x, y: best.y, ttl: 0.5, max: 0.5, kind: "missile", r: 14 });
    const nm = `${UNITS[best.unit].n} of ${G.countries[best.owner] ? G.countries[best.owner].name : "?"}`;
    if (typeof removeArmyQuiet === "function") removeArmyQuiet(best);
    else G.armies.splice(G.armies.indexOf(best), 1);
    log(`🧪 Sandbox: ${nm} deleted.`, "sys");
    toast(`💥 ${nm} deleted.`);
    return;
  }
  const c = typeof cityAt === "function" ? cityAt(mx, my, 22) : null;
  if (!c) { toast("💥 Click an army or a city (Esc exits destruction mode)."); return; }
  const p = c.prov;
  const holder = G.countries[p.own];
  const last = holder && holder.provinces.filter(pp => pp.own === p.own).length <= 1 &&
    !allProvs().some(e2 => e2.p.own === p.own && e2.p !== p);
  openModal(`<h2>💥 Destroy ${esc(p.city)}?</h2>
    <p>The city and its province are deleted from the map — buildings, queues and all.</p>
    ${last ? `<p class="bad">⚠ This is ${esc(holder.name)}'s LAST city — the nation falls with it.</p>` : ""}
    <button class="btn danger" id="sbxd-yes">💥 Destroy the city</button>
    <button class="btn" data-close>Cancel</button>`);
  $("#sbxd-yes").onclick = () => {
    closeModal();
    const owner = p.own;
    if (typeof destroyCity === "function") destroyCity(p);
    log(`🧪 Sandbox: ${p.city} is wiped from the map.`, "sys");
    const O = G.countries[owner];
    if (O && !provsOfNation(owner).length && O.alive) {
      O.alive = false;
      G.armies = G.armies.filter(a => a.owner !== Number(owner));
      G.wars = G.wars.filter(w => w.a !== Number(owner) && w.b !== Number(owner));
      log(`🧪 Sandbox: with its last city gone, ${O.name} ceases to exist.`, "sys");
      if (typeof mapOwnershipChanged === "function") mapOwnershipChanged();
    }
    toast(`💥 ${p.city} destroyed.`);
    renderAll();
  };
}

// ============ TOOLTIP ============
function showTip(e, id) {
  const tip = $("#tooltip");
  const N = NATIONS[id];
  let html = "";
  if (!G) {
    html = `<b>${esc(N.n)}</b><span class="dim">${esc(N.sp)}</span>
      <div class="tiprow">${esc(GOVS[N.gov].n)} · ${esc(N.per)}</div>
      <div class="tiprow dim">Click to inspect</div>`;
  } else {
    // the hovered pixel's actual controller (annexed / occupied / ceded land)
    let ctrl = controllerOf(id);
    let patch = null;
    const mm = mapXY(e);
    if (mm && typeof CITY_ARR !== "undefined" && CITY_ARR && CITY_ARR[mm.y * MW + mm.x]) {
      patch = CITIES[CITY_ARR[mm.y * MW + mm.x] - 1].prov;
      ctrl = provCtrl(patch);
    }
    if (!G.countries[ctrl] || (!G.countries[ctrl].alive && controllerOf(ctrl) !== ctrl)) ctrl = controllerOf(ctrl);
    const rel = ctrl === G.playerId ? null : Math.round(G.rel[ctrl][G.playerId]);
    const known = ctrl === G.playerId || (G.countries[G.playerId].revealTo || {})[ctrl] || mods(G.countries[G.playerId]).vision;
    const pw = known ? fmt(powerEstimate(G.countries[ctrl])) : "~" + fmt(powerEstimate(G.countries[ctrl]) * rnd(0.6, 1.5));
    html = `<b>${esc(G.countries[ctrl].name)}</b><span class="dim">${esc(NATIONS[ctrl].sp)}</span>`;
    if (patch && patch.occ) html += `<div class="tiprow warn">${esc(patch.name)} Province — occupied land of ${esc(G.countries[patch.own].name)}</div>`;
    else if (patch && patch.own !== id) html += `<div class="tiprow warn">${esc(patch.name)} Province — taken from the ${esc(NATIONS[id].sp)}</div>`;
    else if (!G.countries[id].alive) html += `<div class="tiprow warn">Annexed homeland of the ${esc(NATIONS[id].sp)}</div>`;
    if (G.vassals[id]) html += `<div class="tiprow warn">Subject of ${esc(G.countries[G.vassals[id]].name)}</div>`;
    html += `<div class="tiprow">${esc(GOVS[G.countries[ctrl].gov].n)} · ${esc(ERAS[G.countries[ctrl].era].n)}</div>
      <div class="tiprow">Military power: ${pw}</div>`;
    // multiplayer: who is really at the helm? (QoL §17)
    if (typeof NET !== "undefined" && NET.active && ctrl !== G.playerId) {
      const hv = typeof humanInfoOf === "function" ? humanInfoOf(ctrl) : null;
      if (hv) html += `<div class="tiprow ${hv.online ? "good" : "warn"}">🎮 ${hv.online ? "Player: " + esc(hv.name) : esc(hv.name) + " — disconnected (AI caretaker)"}</div>`;
      else html += `<div class="tiprow dim">🤖 AI-controlled</div>`;
    }
    if (rel !== null) {
      const cls = rel > 20 ? "good" : rel < -20 ? "bad" : "";
      html += `<div class="tiprow ${cls}">Relations: ${rel > 0 ? "+" : ""}${rel}${atWar(ctrl, G.playerId) ? " · AT WAR" : ""}</div>`;
    } else html += `<div class="tiprow good">Your nation</div>`;
  }
  tip.innerHTML = html;
  tip.style.display = "block";
  const px = Math.min(e.clientX + 16, innerWidth - 240);
  tip.style.left = px + "px";
  tip.style.top = Math.min(e.clientY + 14, innerHeight - 130) + "px";
}
function hideTip() { $("#tooltip").style.display = "none"; }

// ============ SCREENS ============
function show(id) {
  screen = id;
  document.body.dataset.screen = id; // mobile CSS keys off the active screen
  for (const s of ["menu", "mode", "select", "game", "mp"]) {
    $("#screen-" + s).style.display = s === id ? "" : "none";
  }
  $("#sidebar").style.display = id === "game" ? "" : "none";
  $("#topbar").style.display = id === "game" ? "" : "none";
  $("#logfeed").style.display = id === "game" ? "" : "none";
  $("#pick-panel").style.display = id === "select" ? "" : "none";
  $("#map-tools").style.display = id === "game" ? "flex" : "none";
  if (id !== "game") {
    $("#draw-bar").style.display = "none";
    const sb = $("#sel-bar"); if (sb) sb.style.display = "none";
    $("#war-hint").style.display = "none";
    if (typeof spaceOpen !== "undefined" && spaceOpen && typeof exitSpace === "function") exitSpace(true);
  }
}

let chosenMode = "standard";
function initMenu() {
  const sub = $("#screen-menu .subtitle");
  if (sub) sub.textContent = `${MAP_META.countries.length} nations · one world · one victor` +
    (typeof GAME_VERSION !== "undefined" ? ` · v${GAME_VERSION}` : "");
  $("#btn-new").onclick = () => { if (typeof S !== "undefined") { S.unlock(); S.play("click"); } show("mode"); };
  $("#btn-mp").onclick = () => {
    if (typeof S !== "undefined") { S.unlock(); S.play("click"); }
    show("mp");
    if (typeof netInitMpScreen === "function") netInitMpScreen();
  };
  const hasSave = !!localStorage.getItem(SAVE_KEY);
  $("#btn-continue").style.display = hasSave ? "" : "none";
  $("#btn-continue").onclick = () => {
    if (typeof S !== "undefined") S.unlock();
    if (loadSave()) { startGameUI(); }
  };
  $$("#screen-mode .modecard").forEach(card => {
    card.onclick = () => {
      chosenMode = card.dataset.mode;
      if (typeof S !== "undefined") S.play("click");
      show("select");
      pickedId = 2; // humans featured by default
      repaintTint(); repaintHover(); fitView();
      renderPickPanel();
    };
  });
}

// Humanity Balance Update Part 2: the mode the local player is previewing /
// about to confirm for the Humans. "super" keeps the classic featured look.
let humanityPick = "super";
function renderPickPanel() {
  const p = $("#pick-panel");
  if (!pickedId) { p.innerHTML = `<div class="pad dim">Click a country on the map to inspect its species.</div>`; return; }
  const N = NATIONS[pickedId];
  const meta = metaOf(pickedId);
  const col = tintColor(pickedId);
  const stats = STAT_KEYS.map((k, i) => {
    const labels = ["Intelligence","Strength","Durability","Agility","Growth","Productivity","Diplomacy","Morale","Adaptability"];
    // the preview prices the CHOSEN Humanity mode — Normal Humans show the
    // classic 10/10 with the plain bar, no Beyond-Maximum glow
    const v = (pickedId === HUMAN_NATION_ID && i === 0 && humanityPick === "normal")
      ? HUMANITY_MODES.normal.int : N.st[i];
    // Small Humanity Update §2: the one stat allowed past the species cap —
    // Humans' 11/10 Intelligence glows with an animated gradient; the white
    // notch marks where the normal maximum ends. No other species may pass 10.
    if (v > 10)
      return `<div class="statrow"><span>${labels[i]}</span><div class="statbar overbar"><i class="overfill" style="width:100%"></i><em class="overnotch" title="the normal species maximum"></em></div><b class="overval">${v}/10</b></div>
        <div class="overtag">✦ Beyond Maximum — no other species breaks the 10-point scale</div>`;
    // Tiny Visual Update: a maxed 10/10 gets a still gradient — every stat,
    // every species. Only the Humans' 11/10 above keeps animation + aura.
    if (v === 10)
      return `<div class="statrow"><span>${labels[i]}</span><div class="statbar maxbar"><i class="maxfill" style="width:100%"></i></div><b class="maxval">${v}/10</b></div>`;
    return `<div class="statrow"><span>${labels[i]}</span><div class="statbar"><i style="width:${v * 10}%;background:${v >= 8 ? "#5ce0a2" : v >= 5 ? "#4fd6ff" : "#f0a848"}"></i></div><b>${v}</b></div>`;
  }).join("");
  p.innerHTML = `
    <div class="pick-head" style="border-color:${rgba(col, 0.8)}">
      <div class="pick-flag" style="background:${rgba(col, 0.9)}">${FLAG_GLYPHS[pickedId % FLAG_GLYPHS.length]}</div>
      <div><h2>${esc(N.n)}</h2><span class="dim">${esc(N.sp)}${pickedId === 2 ? " — featured" : ""}</span></div>
    </div>
    <div class="pick-body">
      <p class="lore">${esc(N.hi)}</p>
      <div class="kv"><span>Appearance</span>${esc(N.ap)}</div>
      <div class="kv"><span>Language</span>${esc(N.lg)}</div>
      <div class="kv"><span>Culture</span>${esc(N.cu)}</div>
      <div class="kv"><span>Government</span>${esc(GOVS[N.gov].n)} — ${esc(GOVS[N.gov].eff)}</div>
      <div class="kv"><span>Technology</span>${esc(N.ts)}</div>
      <div class="kv"><span>Strengths</span><em class="good">${N.str.map(esc).join(" · ")}</em></div>
      <div class="kv"><span>Weaknesses</span><em class="bad">${N.wk.map(esc).join(" · ")}</em></div>
      <div class="kv"><span>Special ability</span><b>${esc(N.ab.n)}</b> — ${esc(pickedId === HUMAN_NATION_ID ? HUMANITY_MODES[humanityPick].d : N.ab.d)}</div>
      <div class="statgrid">${stats}</div>
      <div class="kv"><span>Cities</span>${provCount(meta.area)} · ${meta.coastal ? "coastal" : "landlocked"} · biome ${meta.snow > 0.4 ? "arctic" : meta.sand > 0.4 ? "desert" : "temperate"}</div>
      ${pickedId === HUMAN_NATION_ID ? humanityModeHtml() : ""}
    </div>
    ${mpButtonHtml(N)}`;
  const hn = $("#hum-mode-normal"), hs = $("#hum-mode-super");
  if (hn) hn.onclick = () => { if (humanityPick !== "normal") { humanityPick = "normal"; sfx("click"); renderPickPanel(); } };
  if (hs) hs.onclick = () => { if (humanityPick !== "super") { humanityPick = "super"; sfx("click"); renderPickPanel(); } };
  const bp = $("#btn-play");
  if (bp) bp.onclick = () => {
    // Humanity Balance Update: the player's own pick applies directly; when
    // the Humans will be AI-run, the player chooses their balance first (Part 3)
    const begin = () => { initGame(chosenMode, pickedId); startGameUI(); };
    if (pickedId === HUMAN_NATION_ID) { PENDING_HUMANITY_MODE = humanityPick; begin(); }
    else chooseAIHumanityThen(begin);
  };
  const bc = $("#btn-claim");
  if (bc) bc.onclick = () => { if (typeof netClaimCountry === "function") netClaimCountry(pickedId); };
}
// Humanity Balance Update Part 2: the two selectable modes, previewed before
// the country is confirmed. Only Super-Buffed keeps the Beyond-Maximum glow;
// in multiplayer the Super-Buffed claim goes to a vote (net.js).
function humanityModeHtml() {
  const inMp = typeof NET !== "undefined" && NET.active && NET.lobby;
  return `<div class="kv"><span>Balance</span>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
        <button class="btn small ${humanityPick === "normal" ? "primary" : ""}" id="hum-mode-normal">Normal — 10/10 · +20% RP</button>
        <button class="btn small ${humanityPick === "super" ? "primary" : ""}" id="hum-mode-super">Super-Buffed — 11/10 · +30% RP ✦</button>
      </div>
      <div class="dim small" style="margin-top:4px">${humanityPick === "super"
        ? "Beyond Maximum: 11/10 Intelligence and +30% Research Points." + (inMp ? " The other players vote on it when you claim." : "")
        : "The classic Humans: 10/10 Intelligence and +20% Research Points." + (inMp ? " No vote required." : "")}</div>
    </div>`;
}
// Part 3: when the Humans will be AI-controlled in a single-player game, the
// player decides their balance before the world is built.
function chooseAIHumanityThen(begin) {
  openModal(`<h2>🧬 Choose the Humanity AI balance</h2>
    <p>${esc(NATIONS[HUMAN_NATION_ID].n)} (the Humans) will be controlled by the AI this game. Which balance should they use?</p>
    <button class="btn" id="hum-ai-normal" style="width:100%;margin-top:6px">Normal Humanity AI — 10/10 Intelligence · +20% Research Points</button>
    <button class="btn primary" id="hum-ai-super" style="width:100%;margin-top:6px">Super-Buffed Humanity AI — 11/10 Intelligence · +30% Research Points ✦</button>`);
  const bn = $("#hum-ai-normal"), bs = $("#hum-ai-super");
  if (bn) bn.onclick = () => { PENDING_HUMANITY_MODE = "normal"; closeModal(); begin(); };
  if (bs) bs.onclick = () => { PENDING_HUMANITY_MODE = "super"; closeModal(); begin(); };
}
// in a multiplayer lobby the Play button becomes a claim button
function mpButtonHtml(N) {
  if (typeof NET === "undefined" || !NET.lobby) return `<button class="btn primary big" id="btn-play">▶ &nbsp;Play as ${esc(N.n)}</button>`;
  const claim = NET.lobby.players.find(p => p.cid === pickedId);
  const mine = NET.lobby.players.find(p => p.me);
  if (claim && !claim.me) return `<button class="btn big off">🔒 Taken by ${esc(claim.name)}</button>`;
  if (claim && claim.me) return `<button class="btn big off">✔ Your nation${NET.isHost ? " — press Start in the lobby panel" : " — waiting for the host"}</button>`;
  return `<button class="btn primary big" id="btn-claim">🚩 ${mine && mine.cid ? "Switch to" : "Claim"} ${esc(N.n)}</button>`;
}

function startGameUI() {
  show("game");
  selectedId = G.playerId;
  diploTarget = 0; espTarget = 0; talkTarget = 0;
  missileTargeting = null; foundMode = null;
  uiTab = "overview";
  applyEraTheme(G.countries[G.playerId].era);
  if (typeof warSessionStart === "function") warSessionStart();
  repaintTint(); repaintHover(); fitView();
  renderMapTools(); applyArmySize();
  renderAll();
  if (typeof netShowHud === "function") netShowHud();
  if (typeof S !== "undefined") S.ambient();
  if (G.eventPending) showEvent();
}

// ============ MAP VIEW TOOLS ============
const ARMY_MODE_LABEL = { all: "All visible", mine: "Only mine", none: "Hidden" };
function renderMapTools() {
  const mt = $("#map-tools");
  if (!mt) return;
  mt.innerHTML = `
    <button id="mt-army" title="Cycle army visibility: all → only yours → hidden. Armies of nations at war with you always stay visible.">🪖 Armies: <b>${ARMY_MODE_LABEL[viewOpts.armyMode]}</b></button>
    <button id="mt-size" class="${viewOpts.smallArmies ? "on" : ""}" title="Smaller army icons and unit boxes — useful when armies crowd the map.">🔍 Small icons: <b>${viewOpts.smallArmies ? "On" : "Off"}</b></button>
    <button id="mt-country" title="Show only your country's overlay and cities. Nations at war with you (and their provinces) stay visible. Purely visual — nothing is removed from the game.">🗺 Countries: <b>${viewOpts.countryMode === "mine" ? "Only mine" : "All"}</b></button>
    <button id="mt-prov" class="${viewOpts.showProvinces ? "on" : ""}" title="Show province borders — which land belongs to each city.">⬡ Provinces: <b>${viewOpts.showProvinces ? "On" : "Off"}</b></button>
    <button id="mt-night" class="${viewOpts.dayNight ? "on" : ""}" title="The planet cycles through day and night. At night, cities glow according to their era and energy — switch off for a permanently lit map.">🌗 Day/Night: <b>${viewOpts.dayNight ? "On" : "Off"}</b></button>
    <button id="mt-lights" class="${viewOpts.cityLights ? "on" : ""}" title="Night-time city lights. Visual only — switch off if performance suffers.">💡 City lights: <b>${viewOpts.cityLights ? "On" : "Off"}</b></button>
    <button id="mt-ambient" class="${viewOpts.ambient ? "on" : ""}" title="Ambient civilian planes and spaceships between cities and planets. Visual only.">✈ Air traffic: <b>${viewOpts.ambient ? "On" : "Off"}</b></button>
    <button id="mt-buildfx" class="${viewOpts.buildFx ? "on" : ""}" title="Construction-complete flashes and sparks. Visual only.">🏗 Build FX: <b>${viewOpts.buildFx ? "On" : "Off"}</b></button>
    <button id="mt-quality" class="${PERF.low ? "on" : ""}" title="Graphics quality. AUTO reduces particles, city lights and ambient effects on mobile and weak devices; LOW forces the reductions, HIGH forces full effects. Gameplay is never affected.">⚙ Quality: <b>${{ auto: "Auto", high: "High", low: "Low" }[viewOpts.quality || "auto"]}${(viewOpts.quality || "auto") === "auto" ? (PERF.low ? " (low)" : " (high)") : ""}</b></button>`;
  $("#mt-army").onclick = () => {
    viewOpts.armyMode = viewOpts.armyMode === "all" ? "mine" : viewOpts.armyMode === "mine" ? "none" : "all";
    saveViewOpts(); renderMapTools();
    if (typeof S !== "undefined") S.play("click");
  };
  $("#mt-size").onclick = () => {
    viewOpts.smallArmies = !viewOpts.smallArmies;
    applyArmySize(); saveViewOpts(); renderMapTools();
    if (typeof S !== "undefined") S.play("click");
  };
  $("#mt-country").onclick = () => {
    viewOpts.countryMode = viewOpts.countryMode === "all" ? "mine" : "all";
    saveViewOpts(); renderMapTools();
    repaintTint();
    if (typeof cityLayerDirty !== "undefined") cityLayerDirty = true;
    if (typeof S !== "undefined") S.play("click");
  };
  $("#mt-prov").onclick = () => {
    viewOpts.showProvinces = !viewOpts.showProvinces;
    saveViewOpts(); renderMapTools();
    repaintProvinces();
    if (typeof cityLayerDirty !== "undefined") cityLayerDirty = true;
    if (typeof S !== "undefined") S.play("click");
  };
  $("#mt-night").onclick = () => {
    viewOpts.dayNight = !viewOpts.dayNight;
    saveViewOpts(); renderMapTools();
    if (typeof S !== "undefined") S.play("click");
  };
  $("#mt-lights").onclick = () => {
    viewOpts.cityLights = !viewOpts.cityLights;
    saveViewOpts(); renderMapTools();
    if (typeof S !== "undefined") S.play("click");
  };
  $("#mt-ambient").onclick = () => {
    viewOpts.ambient = !viewOpts.ambient;
    saveViewOpts(); renderMapTools();
    if (typeof S !== "undefined") S.play("click");
  };
  $("#mt-buildfx").onclick = () => {
    viewOpts.buildFx = !viewOpts.buildFx;
    saveViewOpts(); renderMapTools();
    if (typeof S !== "undefined") S.play("click");
  };
  $("#mt-quality").onclick = () => {
    viewOpts.quality = viewOpts.quality === "auto" ? "high" : viewOpts.quality === "high" ? "low" : "auto";
    applyQuality(); saveViewOpts(); renderMapTools();
    if (typeof S !== "undefined") S.play("click");
  };
}
function applyArmySize() {
  const layer = $("#army-layer");
  if (layer) layer.classList.toggle("small", !!viewOpts.smallArmies);
}

// ============ FOUNDING CITIES (province drawing) ============
function startFoundMode() {
  const P = G.countries[G.playerId];
  const fc = foundCityCost();
  if (P.res.money < fc.money || P.res.mat < fc.mat) { toast(`Founding a city needs ${fc.money}💰 and ${fc.mat}⛏.`); return; }
  if (typeof warCancel === "function") warCancel();
  missileTargeting = null;
  foundMode = { phase: "draw", mask: new Uint8Array(MW * MH), area: 0, brush: 12 };
  const cv = $("#cv-draw"); cv.width = MW; cv.height = MH;
  $("#map-vp").classList.add("painting");
  renderDrawBar();
  toast("Paint the new province with the mouse (must stay inside your borders). Right-drag pans, mouse-wheel zooms.");
}

function paintProvinceAt(e) {
  const m = mapXY(e);
  if (!m || !foundMode) return;
  const fm = foundMode;
  if (fm.area >= PROV_MAX_AREA) return;
  const pid = G.playerId;
  const r = fm.brush;
  const ctx = $("#cv-draw").getContext("2d");
  ctx.fillStyle = "rgba(92,224,162,.4)";
  const cityPts = CITIES.map(c => [c.prov.px, c.prov.py]);
  let rejected = false;
  for (let y = Math.max(2, m.y - r); y <= Math.min(MH - 3, m.y + r); y++) {
    for (let x = Math.max(2, m.x - r); x <= Math.min(MW - 3, m.x + r); x++) {
      if ((x - m.x) ** 2 + (y - m.y) ** 2 > r * r) continue;
      const i = y * MW + x;
      if (fm.mask[i]) continue;
      if (fm.area >= PROV_MAX_AREA) { rejected = true; break; }
      if (!LAND_ARR[i] || !ID_ARR[i]) { rejected = true; continue; }       // land only
      const gi = CITY_ARR && CITY_ARR[i] ? CITY_ARR[i] - 1 : -1;
      if (gi < 0) { rejected = true; continue; }
      const p = CITIES[gi].prov;
      if (p.own !== pid || p.occ) { rejected = true; continue; }            // your unoccupied territory only
      if (p.drawn) { rejected = true; continue; }                           // no overlap with another drawn province
      let nearCity = false;                                                 // existing cities keep their ground
      for (const pt of cityPts) {
        if ((pt[0] - x) ** 2 + (pt[1] - y) ** 2 < 28 * 28) { nearCity = true; break; }
      }
      if (nearCity) { rejected = true; continue; }
      fm.mask[i] = 1; fm.area++;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  fm.rejected = fm.rejected || rejected;
  renderDrawBar();
}

function renderDrawBar() {
  const bar = $("#draw-bar");
  if (!foundMode) { bar.style.display = "none"; return; }
  bar.style.display = "flex";
  if (foundMode.phase === "draw") {
    const a = foundMode.area;
    const okA = a >= PROV_MIN_AREA && a <= PROV_MAX_AREA;
    bar.innerHTML = `<span>🖌 Province size: <b class="${okA ? "ok" : "no"}">${fmt(a)}</b> <span class="dim">(${fmt(PROV_MIN_AREA)}–${fmt(PROV_MAX_AREA)})</span></span>
      <span class="dim small">brush</span>
      <button class="chip ${foundMode.brush === 7 ? "active" : ""}" data-br="7">S</button>
      <button class="chip ${foundMode.brush === 12 ? "active" : ""}" data-br="12">M</button>
      <button class="chip ${foundMode.brush === 18 ? "active" : ""}" data-br="18">L</button>
      <button class="btn small ${okA ? "primary" : "off"}" id="db-ok">✔ Confirm province</button>
      <button class="btn small" id="db-clear">↺ Clear</button>
      <button class="btn small danger" id="db-cancel">✖ Cancel</button>`;
    $$("#draw-bar [data-br]").forEach(b => b.onclick = () => { foundMode.brush = Number(b.dataset.br); renderDrawBar(); });
    $("#db-ok").onclick = () => {
      if (!(foundMode.area >= PROV_MIN_AREA && foundMode.area <= PROV_MAX_AREA)) {
        toast(`The province must cover ${fmt(PROV_MIN_AREA)}–${fmt(PROV_MAX_AREA)} map pixels.`); return;
      }
      foundMode.phase = "place";
      $("#map-vp").classList.remove("painting");
      renderDrawBar();
      toast("Now click inside the drawn province to place the new city.");
    };
    $("#db-clear").onclick = () => {
      foundMode.mask.fill(0); foundMode.area = 0;
      const cv = $("#cv-draw"); cv.width = MW; cv.height = MH;
      renderDrawBar();
    };
    $("#db-cancel").onclick = endFoundMode;
  } else {
    bar.innerHTML = `<span>📍 Click inside the drawn province to place the city</span>
      <button class="btn small" id="db-back">← Edit shape</button>
      <button class="btn small danger" id="db-cancel">✖ Cancel</button>`;
    $("#db-back").onclick = () => { foundMode.phase = "draw"; $("#map-vp").classList.add("painting"); renderDrawBar(); };
    $("#db-cancel").onclick = endFoundMode;
  }
}

function foundClick(mx, my) {
  if (!foundMode || foundMode.phase !== "place") return;
  const i = my * MW + mx;
  if (!foundMode.mask[i]) { toast("The city must stand inside its own province — click on the painted area."); return; }
  for (const c of CITIES) {
    if ((c.prov.px - mx) ** 2 + (c.prov.py - my) ** 2 < CITY_MIN_DIST * CITY_MIN_DIST) {
      toast(`Too close to ${c.prov.city} — pick a spot further away.`); return;
    }
  }
  const fc = foundCityCost();
  openModal(`<h2>🏙 Found a new city</h2>
    <p>Cost: <b>${fc.money}💰 ${fc.mat}⛏</b>. The province will keep exactly the shape you drew (${fmt(foundMode.area)} px).</p>
    <input id="fc-name" maxlength="24" placeholder="City name" style="width:100%">
    <button class="btn primary" id="fc-go">Found city</button>
    <button class="btn" data-close>Keep placing</button>`);
  const inp = $("#fc-name"); inp.focus();
  $("#fc-go").onclick = () => {
    const name = inp.value.trim();
    if (!name) { toast("Give the city a name."); return; }
    const rle = maskToRLE(foundMode.mask);
    if (typeof netIntercept === "function" && netIntercept("found", { name, x: mx, y: my, rle })) {
      closeModal(); endFoundMode(); return;
    }
    const r = foundCity(G.playerId, name, mx, my, rle);
    closeModal();
    if (!r.ok) { toast(r.msg); return; }
    if (typeof S !== "undefined") S.play("capture");
    endFoundMode();
    renderAll();
  };
}

function maskToRLE(mask) {
  const rle = [];
  for (let y = 0; y < MH; y++) {
    let x = 0;
    while (x < MW) {
      if (mask[y * MW + x]) {
        const x0 = x;
        while (x < MW && mask[y * MW + x]) x++;
        rle.push(y, x0, x - x0);
      } else x++;
    }
  }
  return rle;
}

function endFoundMode() {
  foundMode = null;
  $("#map-vp").classList.remove("painting");
  $("#draw-bar").style.display = "none";
  const cv = $("#cv-draw");
  if (cv) { cv.width = MW; cv.height = MH; }
}

// ============ MISSILE TARGETING ============
function startMissileTargeting(mId) {
  const siloProvs = provsOwned(G.playerId).filter(p => p.b.silo);
  if (!siloProvs.length) { toast("No available silo — occupied cities cannot launch."); return; }
  if (foundMode) endFoundMode();
  if (typeof warCancel === "function") warCancel();
  const arm = prov => {
    missileTargeting = { type: mId, fromProv: prov };
    const el = $("#war-hint");
    const mt = MISSILE_TYPES[mId];
    el.style.display = "block";
    el.innerHTML = `${mt.icon} <b>${esc(mt.n)}</b> armed at ${esc(prov.city)} — click the target on the map${mt.homing ? " (or click an enemy army to lock on)" : ""} · Esc aborts`;
  };
  if (siloProvs.length === 1) arm(siloProvs[0]);
  else {
    openModal(`<h2>Select launch site</h2>` +
      siloProvs.map((p, i) => `<button class="btn" data-silo="${i}">🚀 ${esc(p.city)}</button>`).join("") +
      `<button class="btn" data-close>Cancel</button>`);
    $$("#modal [data-silo]").forEach(b => b.onclick = () => { closeModal(); arm(siloProvs[Number(b.dataset.silo)]); });
  }
}
function cancelMissileTargeting() {
  missileTargeting = null;
  if (typeof updateWarHint === "function") updateWarHint();
}
function missileClickTarget(mx, my) {
  const P = G.countries[G.playerId];
  const mt = MISSILE_TYPES[missileTargeting.type];
  let targetArmy = null;
  if (mt.homing) { // lock onto a visible enemy army near the click
    let bd = 30 * 30;
    for (const a of G.armies) {
      if (a.owner === G.playerId || !isVisibleToPlayer(a)) continue;
      const d = (a.x - mx) ** 2 + (a.y - my) ** 2;
      if (d < bd) { bd = d; targetArmy = a; }
    }
  }
  const tx = targetArmy ? targetArmy.x : mx, ty = targetArmy ? targetArmy.y : my;
  const cAt = typeof cityAt === "function" ? cityAt(tx, ty, mt.radius) : null;
  let victim = null;
  if (targetArmy) victim = targetArmy.owner;
  else if (cAt) victim = provCtrl(cAt.prov);
  else { const i = (ty | 0) * MW + (tx | 0); if (ID_ARR[i]) victim = controllerOf(ID_ARR[i]); }
  if (victim === G.playerId && !targetArmy) { toast("That would strike your own territory. Pick another target."); return; }
  const declares = victim !== null && victim !== G.playerId && !atWar(G.playerId, victim);
  openModal(`<h2>${mt.icon} Launch ${esc(mt.n)}?</h2>
    <p>Launch site: <b>${esc(missileTargeting.fromProv.city)}</b><br>
    Target: ${targetArmy ? `${esc(UNITS[targetArmy.unit].n)} of ${esc(G.countries[targetArmy.owner].name)}` :
      cAt ? `near ${esc(cAt.prov.city)} (${esc(G.countries[victim].name)})` :
      victim ? `territory of ${esc(G.countries[victim].name)}` : "open terrain"}</p>
    ${declares ? `<p class="bad">⚠ You are not at war with ${esc(G.countries[victim].name)} — launching means WAR.</p>` : ""}
    ${mt.nuke ? `<p class="bad">☢ A nuclear strike will horrify the entire world — relations and trust with every nation will collapse.</p>` : ""}
    <button class="btn danger" id="ml-go">🚀 Launch</button>
    <button class="btn" data-close>Hold fire</button>`);
  $("#ml-go").onclick = () => {
    closeModal();
    const type = missileTargeting.type;
    const ref = provRef(missileTargeting.fromProv);
    if (typeof netIntercept === "function" && netIntercept("mlaunch", {
      type, ph: ref && ref.ph, pi: ref && ref.pi, tx, ty, targetArmy: targetArmy ? targetArmy.id : null,
    })) { cancelMissileTargeting(); return; }
    const stock = missileStock(P);
    if ((stock[type] || 0) <= 0) { toast("No missile of that type in stock."); cancelMissileTargeting(); return; }
    if (declares) declareWar(G.playerId, victim);
    stock[type]--;
    launchMissile(G.playerId, missileTargeting.fromProv, type, tx, ty, targetArmy ? targetArmy.id : null);
    cancelMissileTargeting();
    renderAll();
  };
}

window.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (missileTargeting) { cancelMissileTargeting(); toast("Launch aborted."); }
    if (typeof hyperTargeting !== "undefined" && hyperTargeting) { cancelHyperTargeting(); toast("🔦 Hyper Lazer aborted."); }
    if (foundMode) endFoundMode();
    if (sandboxTransfer) { sandboxTransfer = null; toast("Transfer mode off."); }
    if (sandboxDestroyMode) { sandboxDestroyMode = false; toast("💥 Destruction mode off."); }
  }
});

// ============ TOP BAR ============
function renderTopbar() {
  const P = G.countries[G.playerId];
  if (G.sandbox && G.sandbox.money) { P.res.food = 99999; P.res.mat = 99999; P.res.money = 999999; P.res.energy = 999; }
  const prod = production(P);
  const pr = eraProgress(P, P.era);
  const need = foodNeed(P);
  // BUG FIX (Parts 2-4): the topbar now counts colony, Halo, Researcher and
  // Dyson income — before, space production was credited but never displayed,
  // which looked exactly like "colonies produce nothing"
  const M = MODES[G.mode].res;
  const spc = typeof spaceIncomeOf === "function" ? spaceIncomeOf(P) : null;
  const sMoney = spc ? (spc.colonies.money + spc.haloMoney) * M : 0;
  const sMat = spc ? spc.colonies.mat * M : 0;
  const sEnergy = spc ? spc.colonies.energy + spc.dysonEnergy : 0;
  const sRp = spc ? (spc.colonies.research + spc.haloResearch + spc.researcherRp) * M : 0;
  const sFood = spc ? spc.colonies.food * M : 0;
  const foodNet = prod.food + sFood - need;
  const energyNow = Math.max(0, prod.energy) + sEnergy;
  const mutedNow = typeof S !== "undefined" && S.muted;
  const tickS = typeof realtimeTickSeconds === "function" ? realtimeTickSeconds() : 3;
  const tickWord = isRealtime() ? `tick (${tickS}s)` : "turn";
  const sbSpeed = G.sandbox ? (SANDBOX_SPEEDS.find(sp => sp.s === (G.sandbox.tickS || 3)) || SANDBOX_SPEEDS[0]) : null;
  const inWarNow = G.wars.some(w => w.a === G.playerId || w.b === G.playerId);
  const wm = typeof warMoraleOf === "function" ? warMoraleOf(P) : 50;
  // Part 10 (Final Alien Update): stocks and deltas use fmtS — the abbreviated
  // form can never widen the fixed-height bar; the exact figures ride in the
  // tooltips instead.
  $("#topbar").innerHTML = `
    <div class="tb-flag" style="background:${rgba(P.flag.bg, 1)}">${P.flag.glyph}</div>
    <div class="tb-name">${esc(P.name)}<span class="dim">${G.sandbox ? `🧪 Sandbox · ${G.rtPaused ? "⏸ paused" : esc(sbSpeed.n)}` : `${esc(MODES[G.mode].n)}${isRealtime() ? " · ⏱ real-time" : ""}`} · Year ${G.year}</span></div>
    <div class="tb-res" title="Food stock: ${fmt(P.res.food)} (net ${foodNet >= 0 ? "+" : ""}${fmt(foodNet)} per ${tickWord}, colonies included)">🍞 ${fmtS(P.res.food)} <i class="${foodNet < 0 ? "bad" : "good"}">${fmtSd(foodNet)}</i></div>
    <div class="tb-res" title="Materials: ${fmt(P.res.mat)} (+${fmt(prod.mat + sMat)} per ${tickWord}, colonies & fabricators included)">⛏ ${fmtS(P.res.mat)} <i class="good">+${fmtS(prod.mat + sMat)}</i></div>
    <div class="tb-res" title="Energy available this ${tickWord}: ${fmt(P.res.energy)} — grid after demand + colonies + Dyson Sphere${sEnergy > 0 ? ` (+${fmt(sEnergy)} from space)` : ""}">⚡ <i class="${energyNow <= 0 ? "bad" : ""}">${fmtS(P.res.energy)}</i>${sEnergy > 0 ? ` <i class="good">(+${fmtS(sEnergy)})</i>` : ""}</div>
    <div class="tb-res" title="Money: ${fmt(P.res.money)} (${prod.money + sMoney >= 0 ? "+" : ""}${fmt(prod.money + sMoney)} per ${tickWord}, colonies & Halo Rings included)">💰 ${fmtS(P.res.money)} <i class="${prod.money + sMoney < 0 ? "bad" : "good"}">${fmtSd(prod.money + sMoney)}</i></div>
    <div class="tb-res" title="Research per ${tickWord}: +${fmt(prod.research + sRp)} (colonies & Researchers included)">🔬 +${fmtS(prod.research + sRp)}</div>
    <button class="btn small" id="btn-income" title="Income breakdown — exactly where every resource comes from and goes.">📊</button>
    <div class="tb-res" title="Population (millions)">👥 ${fmt1(P.pop)}M</div>
    <div class="tb-res" title="Morale">😊 ${fmt(P.morale)}</div>
    ${inWarNow ? `<div class="tb-res" title="War morale — the nation's will to fight (50 is neutral). War exhaustion: ${fmt(P.warWeariness)}">⚔ <i class="${wm >= 55 ? "good" : wm < 40 ? "bad" : ""}">${fmt(wm)}</i></div>` : ""}
    <div class="tb-res" title="Stability">🏛 ${fmt(P.stability)}</div>
    <div class="tb-era" title="${pr.done}/${pr.total} technologies">${esc(ERAS[P.era].n)}: ${pr.pct}%</div>
    ${typeof spaceUnlocked === "function" && spaceUnlocked(P) ? `<button class="btn small ${typeof spaceOpen !== "undefined" && spaceOpen ? "primary" : ""}" id="btn-space" title="Toggle the Space view: your solar system, colonies, fleets and megastructures.">${typeof spaceOpen !== "undefined" && spaceOpen ? "🌍 Planet" : "🌌 Space"}</button>` : ""}
    <button class="btn small" id="btn-mute" title="Toggle sound">${mutedNow ? "🔇" : "🔊"}</button>
    <button class="btn small" id="btn-music" title="Toggle music — each era has its own themes, and war brings its own drums.">${typeof S !== "undefined" && S.music && S.music.on ? "🎵" : "♪ off"}</button>
    <button class="btn small" id="btn-menu" title="Return to the main menu.">↩ Menu</button>
    ${typeof NET !== "undefined" && NET.active
      ? (NET.isHost
        ? `<span class="dim small" title="Multiplayer never pauses — the world advances every 3 seconds for everyone (QoL rule).">🌐 no pause</span>`
        : `<span class="dim small" title="In multiplayer the host's simulation is the official game state.">🌐 host tick</span>`)
      : G.sandbox
        ? `<button class="btn small ${G.rtPaused ? "primary" : ""}" id="btn-pause" title="Pause the Sandbox simulation — economy, battles, AI and space alike.">${G.rtPaused ? "▶" : "⏸"}</button>` +
          SANDBOX_SPEEDS.map(sp => `<button class="btn small ${!G.rtPaused && (G.sandbox.tickS || 3) === sp.s ? "primary" : ""}" data-sbspeed="${sp.s}"
            title="${sp.n} speed — one game tick every ${sp.s} second${sp.s === 1 ? "" : "s"} (Sandbox Improvement §2).">${sp.s === 3 ? "1×" : sp.s === 1 ? "3×" : sp.s === 0.5 ? "6×" : "12×"}</button>`).join("")
      : isRealtime()
        ? `<button class="btn primary" id="btn-pause" title="Realistic Mode runs in real time — the world advances every 3 seconds. Pause stops battles and the economy alike.">${G.rtPaused ? "▶ Resume" : "⏸ Pause"}</button>`
        : `<button class="btn primary" id="btn-endturn">End Turn ▸</button>`}`;
  const bi = $("#btn-income");
  if (bi) bi.onclick = showIncomeBreakdown;
  const be = $("#btn-endturn");
  if (be) be.onclick = doEndTurn;
  const bp = $("#btn-pause");
  if (bp) bp.onclick = () => {
    G.rtPaused = !G.rtPaused;
    if (typeof S !== "undefined") S.play("click");
    toast(G.rtPaused ? "⏸ World paused." : "▶ The world moves again.");
    renderTopbar();
  };
  // Sandbox Improvement §2: the speed chips switch the tick length instantly
  $$("#topbar [data-sbspeed]").forEach(b => b.onclick = () => {
    if (!G.sandbox) return;
    G.sandbox.tickS = Number(b.dataset.sbspeed) || 3;
    G.rtPaused = false;
    const sp = SANDBOX_SPEEDS.find(x => x.s === G.sandbox.tickS);
    toast(`⏱ Sandbox speed: ${sp ? sp.n : "Normal"} — one tick every ${G.sandbox.tickS}s.`);
    if (typeof S !== "undefined") S.play("click");
    renderTopbar();
  });
  $("#btn-mute").onclick = () => {
    if (typeof S !== "undefined") { S.unlock(); S.toggleMute(); }
    renderTopbar();
  };
  $("#btn-music").onclick = () => {
    if (typeof S !== "undefined" && S.music) { S.unlock(); S.music.check(); S.music.toggle(); }
    renderTopbar();
  };
  $("#btn-menu").onclick = backToMenu;
  const bs = $("#btn-space");
  if (bs) bs.onclick = () => {
    if (typeof spaceOpen !== "undefined" && spaceOpen) exitSpace();
    else enterSpace();
    renderTopbar();
  };
}

// ---------- income breakdown (AI Improvements Part 4) ----------
// One honest ledger per resource: cities, trade, colonies, megastructures and
// maintenance — the same numbers the engine actually credits each tick.
function showIncomeBreakdown() {
  const P = G.countries[G.playerId];
  const prod = production(P);
  const M = MODES[G.mode].res;
  const spc = typeof spaceIncomeOf === "function" ? spaceIncomeOf(P) : null;
  const cM = spc ? spc.colonies.money * M : 0, cMat = spc ? spc.colonies.mat * M : 0;
  const cE = spc ? spc.colonies.energy : 0, cR = spc ? spc.colonies.research * M : 0, cF = spc ? spc.colonies.food * M : 0;
  const hM = spc ? spc.haloMoney * M : 0, hR = spc ? spc.haloResearch * M : 0;
  const dE = spc ? spc.dysonEnergy : 0, rR = spc ? spc.researcherRp * M : 0;
  const trade = prod.trade || 0, upkeep = prod.upkeep || 0, bmaint = prod.bmaint || 0;
  const row = (label, v, unit) => Math.abs(v) < 0.5 ? "" :
    `<div class="kv"><span>${label}</span><b class="${v < 0 ? "bad" : "good"}">${v >= 0 ? "+" : "−"}${fmt(Math.abs(v))}${unit}</b></div>`;
  const total = (v, unit) => `<div class="kv"><span><b>Total</b></span><b class="${v < 0 ? "bad" : ""}">${v >= 0 ? "+" : "−"}${fmt(Math.abs(v))}${unit} per ${isRealtime() ? "tick" : "turn"}</b></div>`;
  openModal(`<h2>📊 Income breakdown</h2>
    <div class="dim small">Everything that feeds — or drains — your nation each ${isRealtime() ? "3-second tick" : "turn"}.</div>
    <h4>💰 Money</h4>
    ${row("Cities & buildings", prod.money + upkeep + bmaint - trade, "💰")}
    ${row("Trade pacts", trade, "💰")}
    ${row("Colonies", cM, "💰")}
    ${row("Halo Rings", hM, "💰")}
    ${row("Military maintenance", -upkeep, "💰")}
    ${row("Building upkeep", -bmaint, "💰")}
    ${total(prod.money + cM + hM, "💰")}
    <h4>⛏ Materials</h4>
    ${row("Cities & industry", prod.mat, "⛏")}
    ${row("Colonies & orbital fabricators", cMat, "⛏")}
    ${total(prod.mat + cMat, "⛏")}
    <h4>⚡ Energy</h4>
    ${row("Power grid (after demand)", prod.energy, "⚡")}
    ${row("Colonies", cE, "⚡")}
    ${row("Dyson Sphere", dE, "⚡")}
    ${total(Math.max(0, prod.energy) + cE + dE, "⚡")}
    <h4>🔬 Research</h4>
    ${row("Cities & universities", prod.research, "🔬")}
    ${row("Colonies", cR, "🔬")}
    ${row("Halo Rings", hR, "🔬")}
    ${row("Researcher megastructures", rR, "🔬")}
    ${total(prod.research + cR + hR + rR, "🔬")}
    <h4>🍞 Food</h4>
    ${row("Farms & cities", prod.food, "🍞")}
    ${row("Colonies", cF, "🍞")}
    ${row("Consumption", -foodNeed(P), "🍞")}
    ${total(prod.food + cF - foodNeed(P), "🍞")}
    <button class="btn primary" data-close style="margin-top:10px">Close</button>`);
}

// Back to Menu with confirmation (QoL §1). Single-player saves first; a
// multiplayer client leaves the room (their country reverts to AI); the host
// is warned that leaving ends the session for everyone.
function backToMenu() {
  const mp = typeof NET !== "undefined" && NET.active && NET.started;
  openModal(`<h2>↩ Back to Menu</h2>
    <p>Are you sure you want to return to the main menu?</p>
    ${mp
      ? (NET.isHost
        ? `<p class="bad">⚠ You are the HOST — leaving ends the multiplayer session for every player.</p>`
        : `<p class="dim small">Your country will be handed to a caretaker AI. You can rejoin with the same name and room code.</p>`)
      : `<p class="dim small">The game is saved automatically — Continue from the main menu to pick it up again.</p>`}
    <button class="btn danger" id="menu-yes">Yes, return to the menu</button>
    <button class="btn" data-close>Keep playing</button>`);
  $("#menu-yes").onclick = () => {
    closeModal();
    if (mp) {
      if (typeof netLeave === "function") netLeave();
      else location.reload();
      return;
    }
    autosave();
    location.reload();
  };
}

// refresh after each real-time tick — repaint numbers and logs, but never
// rebuild the sidebar while the player is typing into it
function realtimeAfterTick() {
  renderTopbar(); renderLog();
  if (typeof S !== "undefined" && S.music) S.music.check();
  if (typeof cityLayerDirty !== "undefined") cityLayerDirty = true; // construction arcs advance
  if (typeof spaceOpen !== "undefined" && spaceOpen && typeof spaceRefreshPanel === "function") spaceRefreshPanel();
  const ae = document.activeElement;
  const sb = $("#sidebar");
  const typing = ae && sb && sb.contains(ae) &&
    (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT");
  if (!typing) renderSidebar();
  if (G.defeated) { showEnd(false); return; }
  if (G.victory && !G.victory.announced) { showEnd(G.victory.by === G.playerId); return; }
  maybeShowEraTransition();
  const myOffers = (G.peaceOffers || []).filter(o => o.to === G.playerId);
  if (myOffers.length && !G.peaceNotified) {
    G.peaceNotified = true;
    toast(`${myOffers.map(o => G.countries[o.from].name).join(", ")} seek${myOffers.length > 1 ? "" : "s"} peace — see Diplomacy.`);
  }
  if (!myOffers.length) G.peaceNotified = false;
  if (G.eventPending) showEvent();
}

function doEndTurn() {
  if (isRealtime()) return; // real-time mode has no manual turns
  if (typeof S !== "undefined") S.play("endturn");
  endTurn();
  if (typeof S !== "undefined" && S.music) S.music.check();
  Object.keys(maskCache).forEach(k => delete maskCache[k]);
  repaintTint(); repaintHover();
  if (typeof cityLayerDirty !== "undefined") cityLayerDirty = true;
  if (typeof spaceOpen !== "undefined" && spaceOpen && typeof spaceRefreshPanel === "function") spaceRefreshPanel();
  renderAll();
  if (G.defeated) { showEnd(false); return; }
  if (G.victory && !G.victory.announced) { showEnd(G.victory.by === G.playerId); return; }
  maybeShowEraTransition();
  const myOffers = (G.peaceOffers || []).filter(o => o.to === G.playerId);
  if (myOffers.length) toast(`${myOffers.map(o => G.countries[o.from].name).join(", ")} seek peace — see Diplomacy.`);
  if (G.eventPending) showEvent();
}

// ============ SIDEBAR ============
const TABS = [
  ["overview", "Overview", "◈"], ["country", "Country", "🏙"], ["tech", "Technology", "🔬"],
  ["mil", "Military", "⚔"], ["diplo", "Diplomacy", "🕊"], ["esp", "Espionage", "🕵"],
  ["policies", "Policies", "⚖"], ["talk", "Talk", "💬"], ["nation", "Nation", "🚩"],
];
function renderSidebar() {
  const bar = $("#sidetabs");
  bar.innerHTML = "";
  const tabs = G.sandbox ? TABS.concat([["sandbox", "Sandbox", "🧪"]]) : TABS;
  for (const [id, label, icon] of tabs) {
    const b = el("button", "tab" + (uiTab === id ? " active" : ""), `${icon}<span>${label}</span>`);
    b.onclick = () => { uiTab = id; renderSidebar(); };
    bar.appendChild(b);
  }
  const c = $("#sidecontent");
  c.innerHTML = "";
  const P = G.countries[G.playerId];
  // spectator mode (QoL §20): defeated multiplayer players watch, never act
  if (G.defeated && typeof NET !== "undefined" && NET.active && NET.started) {
    bar.innerHTML = "";
    const alive = Object.keys(G.countries).map(Number)
      .filter(i => G.countries[i].alive && !G.countries[i].rebel && !G.countries[i].alien)
      .sort((a, b) => powerEstimate(G.countries[b]) - powerEstimate(G.countries[a]));
    c.innerHTML = `<h3>👁 Spectating</h3>
      <div class="hint">Your nation has fallen. You can watch the world unfold, but you can no longer act — no diplomacy, no armies, no economy.</div>
      <h4>Surviving nations</h4>
      ${alive.map(i => {
        const cc = G.countries[i];
        const hv = typeof humanInfoOf === "function" ? humanInfoOf(i) : null;
        return `<div class="kv"><span>${esc(cc.name)}</span>${hv ? "🎮 " + esc(hv.name) : "🤖 AI"} · ${esc(ERAS[cc.era].n)} · power ${fmt(powerEstimate(cc))}</div>`;
      }).join("")}
      <button class="btn small danger" id="spec-leave" style="margin-top:10px">Leave the game</button>`;
    const lv = $("#spec-leave");
    if (lv) lv.onclick = () => { if (typeof netLeave === "function") netLeave(); else location.reload(); };
    return;
  }
  switch (uiTab) {
    case "overview": renderOverview(c, P); break;
    case "country": renderCountry(c, P); break;
    case "tech": renderTech(c, P); break;
    case "mil": renderMil(c, P); break;
    case "diplo": renderDiplo(c, P); break;
    case "esp": renderEsp(c, P); break;
    case "policies": renderPolicies(c, P); break;
    case "talk": renderTalk(c, P); break;
    case "nation": renderNation(c, P); break;
    case "sandbox": renderSandbox(c, P); break;
  }
}
function renderAll() { renderTopbar(); renderSidebar(); renderLog(); }

// identify a province by home country + index (multiplayer commands need
// serializable references, not object pointers)
function provRef(prov) {
  for (const cid of Object.keys(G.countries)) {
    const idx = G.countries[cid].provinces.indexOf(prov);
    if (idx >= 0) return { ph: Number(cid), pi: idx };
  }
  return null;
}

// ---- Overview ----
function renderOverview(root, P) {
  const N = NATIONS[G.playerId];
  const wars = G.wars.filter(w => w.a === G.playerId || w.b === G.playerId)
    .map(w => G.countries[w.a === G.playerId ? w.b : w.a].name);
  const allies = G.alliances.filter(p => p.includes(G.playerId)).map(p => G.countries[p[0] === G.playerId ? p[1] : p[0]].name);
  const vassals = Object.keys(G.vassals).filter(v => G.vassals[v] === G.playerId).map(v => G.countries[v].name);
  const pr = eraProgress(P, P.era);
  const t = P.researching ? TECHS.find(t => t.id === P.researching) : null;
  const mine = provsOfNation(G.playerId);
  const held = mine.filter(e => !e.p.occ).length;
  root.innerHTML = `
    <h3>${esc(P.name)} <span class="dim">— ${esc(N.sp)}</span></h3>
    <div class="kv"><span>Leader</span>${esc(P.leaderTitle)} ${esc(P.leaderName)}</div>
    <div class="kv"><span>Government</span>${esc(GOVS[P.gov].n)}</div>
    <div class="kv"><span>Era</span>${esc(ERAS[P.era].n)} (${pr.done}/${pr.total} · ${pr.pct}%)${pr.pct >= 75 && P.era < 8 ? ' <b class="good">next era unlocked!</b>' : ""}</div>
    <div class="kv"><span>Researching</span>${t ? `${esc(t.n)} (${fmt(P.rp)}/${fmt(t.c)})` : '<i class="warn">nothing — open Technology!</i>'}</div>
    <div class="kv"><span>Ability</span><b>${esc(N.ab.n)}</b> — ${esc(N.ab.d)}</div>
    <div class="kv"><span>Cities</span>${held}/${mine.length} under your control</div>
    <div class="kv"><span>Armies</span>${armiesOf(G.playerId).length} in the field (power ${fmt(powerEstimate(P))})</div>
    ${typeof shipsOfNation === "function" && (shipsOfNation(G.playerId).length || coloniesOfNation(G.playerId).length) ? `<div class="kv"><span>Space</span>${shipsOfNation(G.playerId).length} craft in orbit · ${coloniesOfNation(G.playerId).length} colon${coloniesOfNation(G.playerId).length === 1 ? "y" : "ies"}</div>` : ""}
    <div class="kv"><span>Wars</span>${wars.length ? `<em class="bad">${wars.map(esc).join(", ")}</em>` : "at peace"}</div>
    <div class="kv"><span>Morale</span>${fmt(P.morale)} / 100</div>
    ${wars.length ? (() => {
      const wm = typeof warMoraleOf === "function" ? warMoraleOf(P) : 50;
      const ww = P.warWeariness || 0;
      return `<div class="kv"><span>War morale</span><b class="${wm >= 55 ? "good" : wm < 40 ? "bad" : ""}">${fmt(wm)} / 100</b> — ${wm >= 65 ? "the nation rallies behind the war" : wm >= 45 ? "the people hold steady" : "the war is breaking the people"}</div>
      <div class="kv"><span>War exhaustion</span><b class="${ww > 35 ? "bad" : ww > 20 ? "warn" : ""}">${fmt(ww)}</b>${ww > 35 ? ' — <em class="bad">revolution risk!</em>' : ww > 20 ? " — the war drags on" : ""}</div>`;
    })() : ""}
    <div class="kv"><span>Allies</span>${allies.length ? allies.map(esc).join(", ") : "none"}</div>
    <div class="kv"><span>Subjects</span>${vassals.length ? vassals.map(esc).join(", ") : "none"}</div>
    <div class="hint">Victory: conquer the world, control 60% of nations, or forge alliances with 60% of survivors. Reaching the top technology eras is a milestone, not an ending — the game continues into space.</div>
    ${G.mode === "realistic" ? '<div class="hint">⏱ Realistic Mode runs in <b>real time</b>: money, resources, research, construction and recruitment all advance every 3 seconds — there is no End Turn. Pause with the ⏸ button in the top bar.</div>' : ""}
    ${G.sandbox ? '<div class="hint">🧪 Sandbox game — open the Sandbox tab for creative tools.</div>' : ""}`;
}

// ---- Country / provinces ----
function renderCountry(root, P) {
  const M = MODES[G.mode];
  const pid = G.playerId;
  const entries = [];
  for (const e of allProvs()) if (e.p.own === pid) entries.push(e);
  const fc = foundCityCost();
  const canFound = P.res.money >= fc.money && P.res.mat >= fc.mat;
  let html = `<h3>${esc(P.name)} — Cities</h3>
    <div class="hint">Cities appear on the map — click Recruit in Military, then click a city to muster troops there. Lose your capital and the nation falls.</div>
    <div class="diplo-actions">
      <button class="btn small ${canFound ? "" : "off"}" id="btn-found" title="Draw a new province inside your borders, then place and name a new city in it.">🏙 Found new city <i>${fc.money}💰 ${fc.mat}⛏</i></button>
    </div>`;
  entries.forEach(e => {
    const p = e.p;
    const isCap = e.home.id === pid && e.idx === P.capital;
    const used = usedSlots(p);
    const lvl = p.lvl || 1;
    const foreignHome = e.home.id !== pid;
    const blds = Object.keys(p.b).map(b =>
      `<button class="chip" data-dem="${b}" data-ph="${e.home.id}" data-pi="${e.idx}"
        title="${esc(BLDGS[b].n)} — ${esc(BLDGS[b].d)}. Click to demolish one (frees a slot, salvages ${Math.round(BLDGS[b].cost.money * DEMOLISH_REFUND)}💰 ${Math.round(BLDGS[b].cost.mat * DEMOLISH_REFUND)}⛏).">${BLDGS[b].icon}×${p.b[b]}<i>✕</i></button>`).join("") || "<i class='dim small'>no buildings</i>";
    // construction sites & mustering grounds — progress every game tick
    const tickWord = isRealtime() ? null : "turn";
    const fmtLeft = left => tickWord ? `${left} ${tickWord}${left > 1 ? "s" : ""}` : `~${left * REALTIME_TICK_SECONDS}s`;
    const queueRows = (p.bq || []).map((it, qi) => {
      const pct = qi === 0 ? Math.round(100 * it.done / it.need) : 0;
      return `<div class="qrow" title="${esc(BLDGS[it.b].d)}">
        <span>🏗 ${BLDGS[it.b].icon} ${esc(BLDGS[it.b].n)}${qi > 0 ? ' <i class="dim">(queued)</i>' : ""}</span>
        <div class="qbar"><i style="width:${pct}%"></i></div>
        <span class="dim">${fmtLeft(buildTicksLeft(P, p, it))}</span>
        <button class="chip" data-cq-ph="${e.home.id}" data-cq-pi="${e.idx}" data-cq-i="${qi}" title="Cancel construction — full refund.">✕</button>
      </div>`;
    }).join("") + (p.rq || []).map((it, qi) => {
      const pct = qi === 0 ? Math.round(100 * it.done / it.need) : 0;
      return `<div class="qrow">
        <span>🎖 ${UNITS[it.u].icon} ${esc(UNITS[it.u].n)}${qi > 0 ? ' <i class="dim">(queued)</i>' : ""}</span>
        <div class="qbar mil"><i style="width:${pct}%"></i></div>
        <span class="dim">${fmtLeft(recruitTicksLeft(p, it))}</span>
        <button class="chip" data-rq-ph="${e.home.id}" data-rq-pi="${e.idx}" data-rq-i="${qi}" title="Cancel mustering — full refund.">✕</button>
      </div>`;
    }).join("");
    let upgRow = "";
    if (!p.occ && lvl < CITY_MAX_LVL) {
      const uc = cityUpgradeCost(p, pid);
      const can = P.res.money >= uc.money && P.res.mat >= uc.mat;
      upgRow = `<button class="btn small ${can ? "" : "off"}" data-upg-ph="${e.home.id}" data-upg-pi="${e.idx}"
        title="Each level: +2 building slots, +8% city production, more housing, sturdier defences. Prices climb steeply.">⬆ Upgrade city to L${lvl + 1} <i>${uc.money}💰 ${uc.mat}⛏</i></button>`;
    }
    html += `<div class="prov ${p.occ ? "occupied" : ""}">
      <div class="prov-head"><b>${esc(p.city)}</b>
        <span class="dim" title="City level ${lvl}/${CITY_MAX_LVL}">L${lvl}</span>
        ${isCap ? '<span class="cap">★ capital</span>' : ""}
        <span class="dim">${p.terrain}</span>
        ${foreignHome ? `<span class="warn">taken from ${esc(NATIONS[e.home.id].n)}</span>` : ""}
        ${p.occ ? `<span class="bad">occupied by ${esc(G.countries[p.occ].name)}</span>` : ""}
        ${p.unrest ? `<span class="warn">unrest ${p.unrest}</span>` : ""}
        <button class="chip" data-ren-ph="${e.home.id}" data-ren-pi="${e.idx}" title="Rename this city (${Math.round(30 * M.cost)}💰)">✎</button>
      </div>
      <div class="dim small">Province of ${esc(p.name)} · slots ${used}/${p.slots} · level ${lvl}/${CITY_MAX_LVL}</div>
      <div class="small">${blds}</div>
      ${queueRows}
      ${upgRow}
      ${!p.occ && used < p.slots ? `<div class="buildrow" data-ph="${e.home.id}" data-pi="${e.idx}"></div>` : ""}
    </div>`;
  });
  root.innerHTML = html;
  $("#btn-found").onclick = () => { if (canFound) startFoundMode(); else toast(`Needs ${fc.money}💰 and ${fc.mat}⛏.`); };
  $$(".buildrow").forEach(row => {
    const home = G.countries[Number(row.dataset.ph)];
    const prov = home.provinces[Number(row.dataset.pi)];
    for (const bId of Object.keys(BLDGS)) {
      if (!bldgAvailable(P, bId)) continue;
      const b = BLDGS[bId];
      // ports only make sense in coastal cities
      if (b.coastal && !(typeof findWaterNear === "function" && findWaterNear(prov.px, prov.py, 90))) continue;
      const cost = bldgCost(P, bId);
      const can = P.res.money >= cost.money && P.res.mat >= cost.mat;
      const ticks = buildTicksNeeded(bId);
      const timeTxt = (G.sandbox && G.sandbox.build) ? "instant" : (isRealtime() ? `~${ticks * REALTIME_TICK_SECONDS}s` : `${ticks} turn${ticks > 1 ? "s" : ""}`);
      const btn = el("button", "chip" + (can ? "" : " off"), `${b.icon} ${b.n} <i>${cost.money}💰 ${cost.mat}⛏ · ${timeTxt}</i>`);
      btn.title = `${b.d} — construction time: ${timeTxt}.`;
      btn.onclick = () => {
        if (!can) return;
        if (typeof netIntercept === "function" && netIntercept("build", { b: bId, ph: Number(row.dataset.ph), pi: Number(row.dataset.pi) })) return;
        const r = enqueueBuilding(P, prov, bId);
        if (!r.ok) { toast(r.msg); return; }
        if (typeof S !== "undefined") S.play("coin");
        renderAll();
      };
      row.appendChild(btn);
    }
  });
  $$("[data-cq-ph]").forEach(btn => btn.onclick = () => {
    if (typeof netIntercept === "function" && netIntercept("cancelB", { ph: Number(btn.dataset.cqPh), pi: Number(btn.dataset.cqPi), i: Number(btn.dataset.cqI) })) return;
    const home = G.countries[Number(btn.dataset.cqPh)];
    const prov = home.provinces[Number(btn.dataset.cqPi)];
    cancelBuilding(P, prov, Number(btn.dataset.cqI));
    toast("Construction cancelled — costs refunded.");
    renderAll();
  });
  $$("[data-rq-ph]").forEach(btn => btn.onclick = () => {
    if (typeof netIntercept === "function" && netIntercept("cancelR", { ph: Number(btn.dataset.rqPh), pi: Number(btn.dataset.rqPi), i: Number(btn.dataset.rqI) })) return;
    const home = G.countries[Number(btn.dataset.rqPh)];
    const prov = home.provinces[Number(btn.dataset.rqPi)];
    cancelRecruit(P, prov, Number(btn.dataset.rqI));
    toast("Mustering cancelled — costs refunded.");
    renderAll();
  });
  $$("[data-dem]").forEach(btn => btn.onclick = () => {
    const home = G.countries[Number(btn.dataset.ph)];
    const prov = home.provinces[Number(btn.dataset.pi)];
    const bId = btn.dataset.dem;
    if (!prov || prov.occ) { toast("Occupied cities cannot be managed."); return; }
    const doIt = () => {
      if (typeof netIntercept === "function" && netIntercept("demolish", { b: bId, ph: Number(btn.dataset.ph), pi: Number(btn.dataset.pi) })) return;
      const r = demolishBuilding(P, prov, bId);
      toast(r.ok ? r.msg : r.msg);
      if (r.ok && typeof S !== "undefined") S.play("coin");
      renderAll();
    };
    if (isImportantBldg(bId)) {
      openModal(`<h2>Demolish ${esc(BLDGS[bId].n)}?</h2>
        <p>${esc(prov.city)} will permanently lose this building's bonuses. The slot is freed and about
        ${Math.round(BLDGS[bId].cost.money * DEMOLISH_REFUND)}💰 ${Math.round(BLDGS[bId].cost.mat * DEMOLISH_REFUND)}⛏ will be salvaged.</p>
        <button class="btn danger" id="dem-yes">Demolish it</button>
        <button class="btn" data-close>Keep it</button>`);
      $("#dem-yes").onclick = () => { closeModal(); doIt(); };
    } else doIt();
  });
  $$("[data-ren-ph]").forEach(btn => btn.onclick = () => {
    const home = G.countries[Number(btn.dataset.renPh)];
    const prov = home.provinces[Number(btn.dataset.renPi)];
    openModal(`<h2>Rename ${esc(prov.city)}</h2>
      <p>A new name costs ${Math.round(30 * MODES[G.mode].cost)}💰 and appears everywhere the city is referenced.</p>
      <input id="ren-input" maxlength="24" value="${esc(prov.city)}" style="width:100%">
      <button class="btn primary" id="ren-yes">Rename</button>
      <button class="btn" data-close>Cancel</button>`);
    const inp = $("#ren-input"); inp.focus(); inp.select();
    const go = () => {
      if (typeof netIntercept === "function" && netIntercept("rename", { ph: Number(btn.dataset.renPh), pi: Number(btn.dataset.renPi), name: inp.value })) { closeModal(); return; }
      const r = renameCity(P, prov, inp.value);
      closeModal();
      toast(r.ok ? `City renamed to ${prov.city}.` : r.msg);
      if (r.ok) {
        if (typeof cityLayerDirty !== "undefined") cityLayerDirty = true;
        renderAll();
      }
    };
    inp.onkeydown = ev => { if (ev.key === "Enter") go(); };
    $("#ren-yes").onclick = go;
  });
  $$("[data-upg-ph]").forEach(btn => btn.onclick = () => {
    if (typeof netIntercept === "function" && netIntercept("upgrade", { ph: Number(btn.dataset.upgPh), pi: Number(btn.dataset.upgPi) })) return;
    const home = G.countries[Number(btn.dataset.upgPh)];
    const prov = home.provinces[Number(btn.dataset.upgPi)];
    const r = upgradeCity(P, prov);
    toast(r.ok ? `${prov.city} is now level ${prov.lvl}.` : r.msg);
    if (r.ok) {
      if (typeof S !== "undefined") S.play("coin");
      if (typeof cityLayerDirty !== "undefined") cityLayerDirty = true;
      renderAll();
    }
  });
}

// ---- Technology ----
function renderTech(root, P) {
  const pr = eraProgress(P, P.era);
  let html = `<h3>Technology</h3>
    <div class="kv"><span>${esc(ERAS[P.era].n)}</span>${pr.pct}% (${pr.done}/${pr.total}) — next era at 75%</div>`;
  if (P.researching) {
    const t = TECHS.find(t => t.id === P.researching);
    const prod = production(P);
    html += `<div class="kv"><span>Current</span>${esc(t.n)} — ${fmt(P.rp)}/${fmt(t.c)} (+${fmt(prod.research)}/turn, ~${Math.max(1, Math.ceil((t.c - P.rp) / Math.max(1, prod.research)))} turns)</div>`;
  }
  for (let e = 1; e < ERAS.length; e++) {
    const list = TECHS.filter(t => t.e === e);
    const locked = e > P.era;
    const ep = eraProgress(P, e);
    html += `<div class="era-block ${locked ? "locked" : ""}">
      <div class="era-head">${ERAS[e].icon} ${esc(ERAS[e].n)} <span class="dim">${ep.done}/${ep.total}</span>${locked ? ' <span class="dim">🔒 locked</span>' : ""}</div>
      <div class="tech-grid">`;
    for (const t of list) {
      const done = P.researched[t.id];
      const avail = !done && techUnlocked(P, t);
      const cur = P.researching === t.id;
      const reqTxt = t.req.length ? "Requires: " + t.req.map(r => TECHS.find(x => x.id === r).n).join(", ") : "";
      html += `<div class="tech ${done ? "done" : avail ? "avail" : "lockd"} ${cur ? "current" : ""}" data-t="${t.id}"
        title="${esc(t.d)}. Cost ${t.c} RP. ${esc(reqTxt)}" style="--cc:${CAT_COLORS[t.cat]}">
        <i>${CAT_NAMES[t.cat]}</i><b>${esc(t.n)}</b><span>${done ? "✓ researched" : cur ? `researching ${fmt(P.rp)}/${t.c}` : avail ? t.c + " RP" : "locked"}</span>
      </div>`;
    }
    html += `</div></div>`;
  }
  root.innerHTML = html;
  $$(".tech.avail, .tech.current").forEach(n => {
    n.onclick = () => {
      const tid = n.dataset.t;
      const P2 = G.countries[G.playerId];
      if (P2.researching === tid) return;
      if (typeof netIntercept === "function" && netIntercept("research", { tid })) return;
      P2.rpStored = P2.rpStored || {};
      if (P2.researching) P2.rpStored[P2.researching] = P2.rp;
      P2.researching = tid;
      P2.rp = P2.rpStored[tid] || 0;
      if (G.sandbox && G.sandbox.research) finishResearch(P2, tid); // sandbox: instant
      if (typeof S !== "undefined") S.play("click");
      renderSidebar(); renderTopbar();
    };
  });
}

// ---- Military ----
function renderMil(root, P) {
  const M = MODES[G.mode];
  const md = mods(P);
  const pid = G.playerId;
  const wars = G.wars.filter(w => w.a === pid || w.b === pid).map(w => w.a === pid ? w.b : w.a);
  const myArmies = armiesOf(pid);
  const byUnit = {};
  for (const a of myArmies) byUnit[a.unit] = (byUnit[a.unit] || 0) + 1;
  // sub-tabs: the classic forces view and the repeatable Upgrades lab (SU2 §13)
  const milTabs = `<div class="sp-list" style="margin:4px 0 8px">
    <button class="chip ${uiMilTab === "forces" ? "active" : ""}" id="miltab-forces">⚔ Forces</button>
    <button class="chip ${uiMilTab === "up" ? "active" : ""}" id="miltab-up">⬆ Upgrades</button></div>`;
  if (uiMilTab === "up") { renderMilUpgrades(root, P, milTabs); return; }
  let html = `<h3>Military</h3>` + milTabs + `
    <div class="kv"><span>Army power</span>${fmt(powerEstimate(P))} (${myArmies.length} armies)</div>
    <div class="kv"><span>Forces</span>${Object.keys(byUnit).length ? Object.keys(byUnit).map(u => `${UNITS[u].icon} ${esc(UNITS[u].n)} ×${byUnit[u]}`).join(", ") : '<i class="warn">no armies!</i>'}</div>
    <div class="hint">⚔ <b>How war works:</b> Recruit a unit below, then click one of your cities to deploy it.
    Click an army to select it — <b>Ctrl-click</b> adds, <b>double-click</b> or <b>⊕ Select nearby</b> grabs a group, <b>Shift-drag</b> draws a selection box.
    Selected troops move, attack and board transports together; the bar at the bottom also lets you <b>🏳 Disband</b> them (Delete key).
    Armies fire automatically at enemies in range. Stand next to an enemy city with no defenders nearby to capture it.
    Take the capital — or every city — to break a nation.</div>
    <div class="hint">⚓ <b>Navy:</b> Ships are laid down only by a <b>coastal city with a completed ⚓ Port</b> and launch into the water
    beside it — never inland, never on land. Land troops can NEVER cross water — neither yours nor the AI's.
    Select troops and click your Transport Ship (or press <b>E</b> beside it) to load; sail to another coast
    and press <b>E</b> to deploy. AI nations follow the same port rules for their overseas wars.
    If a loaded transport sinks, the troops aboard are lost.</div>
    ${P.era >= 8 ? `<div class="hint">🌌 <b>Space:</b> build a 🚀 <b>Space Program</b> in a city (Country tab), construct spacecraft there,
    then select them and press <b>🌌 Go to Space</b>. Cargo craft carry troops (load with <b>E</b> like transports) to colonize and invade other planets —
    👾 <b>Orbital Marines</b> board space cargo craft too: move them beside the craft and press <b>E</b>.</div>` : ""}
    <h4>Recruit</h4><div class="recruit">`;
  const shipyardOK = provsOwned(pid).some(p => canBuildShipAt(p));
  const anyCoastal = provsOwned(pid).some(p => cityIsCoastal(p));
  const spaceportOK = provsOwned(pid).some(p => (p.b.spaceprogram || 0) > 0 && !p.occ);
  for (const uId of Object.keys(UNITS)) {
    if (!unitAvailable(P, uId)) continue;
    const u = UNITS[uId];
    const cost = recruitCost(P, uId);
    // naval units lock until a coastal city has a finished port; rafts need
    // only a coastline (QoL §13); space units need a Space Program
    const navalLocked = u.naval && (u.raft ? !anyCoastal : !shipyardOK);
    const spaceLocked = u.space && !spaceportOK;
    const can = P.res.money >= cost.money && P.res.mat >= cost.mat && !navalLocked && !spaceLocked;
    const active = typeof placingUnit !== "undefined" && placingUnit === uId;
    const kindTag = u.raft ? ` · 🛶 raft ferry (1 early unit)` : u.naval ? (u.cap ? ` · ⚓ transport (${u.cap})` : " · ⚓ ship") : u.space ? (u.cap ? ` · 🚀 space cargo (${u.cap})` : " · 🚀 spacecraft") : (u.melee ? " · melee" : " · ranged");
    const lockTxt = navalLocked ? (u.raft ? " — 🔒 LOCKED: you have no coastal city" : anyCoastal ? " — 🔒 LOCKED: build a ⚓ Port in a coastal city first" : " — 🔒 LOCKED: you have no coastal city; ships need a coast and a Port")
      : spaceLocked ? " — 🔒 LOCKED: build a 🚀 Space Program first" : "";
    html += `<div class="ucard ${can ? "" : "off"} ${active ? "placing" : ""}" data-u="${uId}"
      title="Attack ${u.atk} · Defence ${u.def} · HP ${u.hp * 6} · speed ${u.spd} · range ${u.rng} · vision ${u.vis} · upkeep ${u.up}/turn${u.naval ? " · requires a coastal city with a completed Port" : ""}${u.space ? " · built in a Space Program city; can launch into orbit" : ""}${u.cap ? ` · carries ${u.cap} land armies (E to load/deploy)` : ""}${esc(lockTxt)}">
      <b>${u.icon} ${esc(u.n)}</b><span class="dim">era ${u.e}${kindTag}${navalLocked || spaceLocked ? " · 🔒" : ""}</span>
      <span>${u.atk}⚔ ${u.def}🛡 ${u.rng}🎯</span><i>${cost.money}💰 ${cost.mat}⛏</i></div>`;
  }
  html += `</div>`;
  // ---- Missile Command ----
  const silos = countBldg(P, "silo");
  const anyMissTech = Object.keys(MISSILE_TYPES).some(mId => missileAvailable(P, mId));
  if (anyMissTech) {
    html += `<h4>Missile Command</h4>`;
    if (!silos) {
      html += `<div class="hint">Build a 🚀 <b>Missile Silo</b> in one of your cities (Country tab) to construct and launch missiles.</div>`;
    } else {
      html += `<div class="kv"><span>Arsenal</span>${silos} silo${silos > 1 ? "s" : ""} · storage ${missileTotal(P)}/${silos * 3}</div><div class="recruit">`;
      for (const mId of Object.keys(MISSILE_TYPES)) {
        if (!missileAvailable(P, mId)) continue;
        const mt2 = MISSILE_TYPES[mId];
        const mc = missileCost(mId, G.playerId);
        const have = missileStock(P)[mId] || 0;
        const can = P.res.money >= mc.money && P.res.mat >= mc.mat && missileTotal(P) < silos * 3;
        html += `<div class="ucard" title="${esc(mt2.d)}">
          <b>${mt2.icon} ${esc(mt2.n)}</b><span class="dim">damage ${mt2.dmg} · blast ${mt2.radius}px</span>
          <span>in stock: <b class="${have ? "good" : "dim"}">${have}</b></span>
          <span><button class="btn small ${can ? "" : "off"}" data-mbuild="${mId}">Construct <i>${mc.money}💰 ${mc.mat}⛏</i></button>
          ${have ? `<button class="btn small danger" data-mlaunch="${mId}">Launch ▸</button>` : ""}</span></div>`;
      }
      html += `</div><div class="hint">Launching: press <b>Launch</b>, pick the silo city, then click a target on the map and confirm.
      Cities with a 🛰 Anti-Missile Battery can intercept incoming missiles.${missileAvailable(P, "nuke") ? " ☢ Nuclear strikes carry severe diplomatic consequences." : ""}</div>`;
    }
  }
  html += `<h4>Warfare</h4>`;
  if (!wars.length) html += `<div class="hint">Not at war. Declare war from the Diplomacy tab (or click an enemy country).</div>`;
  for (const enemy of wars) {
    const E = G.countries[enemy];
    if (!E.alive) continue;
    const theirCities = provsOfNation(enemy);
    const occByMe = theirCities.filter(e => e.p.occ === pid).length;
    html += `<div class="warbox"><div class="prov-head"><b class="bad">War with ${esc(E.name)}</b>
      <span class="dim">their power ~${fmt(powerEstimate(E))}</span></div>
      <div class="small">Their cities: ${theirCities.length}, held by you: <b class="${occByMe ? "good" : ""}">${occByMe}</b></div>
      <button class="btn small" data-peace="${enemy}">Offer peace</button>
      ${occByMe ? `<button class="btn small" data-demandocc="${enemy}">Demand occupied lands & peace</button>` : ""}
    </div>`;
  }
  root.innerHTML = html;
  wireMilTabs();
  $$(".ucard[data-u]").forEach(card => {
    card.onclick = () => {
      const uId = card.dataset.u;
      const u = UNITS[uId];
      if (u.naval && (u.raft ? !anyCoastal : !shipyardOK)) {
        toast(u.raft ? "🔒 Your nation has no coastal city — rafts need a coastline."
          : anyCoastal ? "🔒 Ships need a coastal city with a completed ⚓ Port — build one first (Country tab)."
                       : "🔒 Your nation has no coastal city — naval units cannot be built.");
        return;
      }
      if (u.space && !spaceportOK) { toast("🔒 Spacecraft are built in a city with a completed 🚀 Space Program."); return; }
      const cost = recruitCost(P, uId);
      if (P.res.money < cost.money || P.res.mat < cost.mat) { toast("Not enough resources."); return; }
      if (typeof warStartPlacing === "function") {
        warStartPlacing(uId);
        toast(u.raft ? `Click one of your COASTAL cities to lash the ${u.n} together — it carries one Primitive/Ancient era unit.`
          : u.naval ? `Click one of your PORT cities to lay down the ${u.n} — it will launch into the water beside it.`
          : u.space ? `Click your 🚀 Space Program city to build the ${u.n}.`
          : `Click one of your cities to deploy ${u.n}.`);
        renderSidebar();
      }
    };
  });
  $$("[data-mbuild]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    if (typeof netIntercept === "function" && netIntercept("mbuild", { m: b.dataset.mbuild })) return;
    const r = buildMissile(P, b.dataset.mbuild);
    toast(r.ok ? `${MISSILE_TYPES[b.dataset.mbuild].n} constructed.` : r.msg);
    if (r.ok && typeof S !== "undefined") S.play("recruit");
    renderTopbar(); renderSidebar();
  });
  $$("[data-mlaunch]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    startMissileTargeting(b.dataset.mlaunch);
  });
  $$("[data-peace]").forEach(b => b.onclick = () => {
    const eid = Number(b.dataset.peace);
    if (typeof netIntercept === "function" && netIntercept("diplo", { act: "peace", target: eid })) return;
    if (aiAccepts(eid, G.playerId, "peace")) { makePeace(G.playerId, eid, false); toast("Peace agreed."); }
    else toast(`${G.countries[eid].name} rejects your peace offer — for now.`);
    renderAll(); repaintTint();
  });
  $$("[data-demandocc]").forEach(b => b.onclick = () => {
    const eid = Number(b.dataset.demandocc);
    if (typeof netIntercept === "function" && netIntercept("diplo", { act: "demandocc", target: eid })) return;
    if (aiAccepts(eid, G.playerId, "surrender_demand")) {
      makePeace(G.playerId, eid, true);
      toast("They cede the occupied lands. Peace.");
      Object.keys(maskCache).forEach(k => delete maskCache[k]);
      repaintTint();
    } else toast(`${G.countries[eid].name} refuses your terms.`);
    renderAll();
  });
}

// ---- Military ▸ Upgrades (Space Update 2 Part 13) ----
// A research-style, endlessly repeatable lab: Speed, Damage and Armor tracks,
// each up to level 500 with climbing costs. Resources start a level; research
// points finish it (an era technology in progress always gets the science
// first) — so Researcher stations stay valuable long after the last era.
function wireMilTabs() {
  const f = $("#miltab-forces"), u = $("#miltab-up");
  if (f) f.onclick = () => { uiMilTab = "forces"; renderSidebar(); };
  if (u) u.onclick = () => { uiMilTab = "up"; renderSidebar(); };
}
function renderMilUpgrades(root, P, milTabs) {
  const up = typeof milUpOf === "function" ? milUpOf(P) : { spd: 0, dmg: 0, arm: 0 };
  const cur = P.milResearching;
  let html = `<h3>Military</h3>` + milTabs + `
    <div class="hint">⬆ <b>Upgrades</b> work like era research: pay the starting cost, then your nation's
    research output completes the level — an era technology in progress is always finished first.
    Every level costs more than the last, up to <b>level ${MIL_UP_MAX_LVL}</b> per track.
    Effects apply to ALL your units and spacecraft, on the ground and in space.</div>`;
  if (cur) {
    const U = MIL_UPGRADES[cur.k];
    html += `<div class="warbox small">${U.icon} <b>${esc(U.n)}</b> — level ${up[cur.k] + 1} in progress:
      ${fmt(Math.min(cur.rp, cur.need))}/${fmt(cur.need)}🔬
      ${P.researching ? ' · <span class="warn">paused while a technology is researched</span>' : ""}
      <button class="btn small danger" id="milup-cancel" title="Abandon the level. The starting resources are lost.">✕ Abandon</button></div>`;
  } else if (P.researching) {
    html += `<div class="dim small">Your labs are busy with a technology — an upgrade started now waits its turn.</div>`;
  }
  for (const k of Object.keys(MIL_UPGRADES)) {
    const U = MIL_UPGRADES[k];
    const lvl = up[k] || 0;
    const cost = MIL_UP_COST(lvl);
    const maxed = lvl >= MIL_UP_MAX_LVL;
    const bonus = Math.round(lvl * U.perLvl * 1000) / 10;
    html += `<div class="warbox"><div class="prov-head"><b>${U.icon} ${esc(U.n)}</b>
      <span class="dim">level <b>${lvl}</b>/${MIL_UP_MAX_LVL}</span></div>
      <div class="small">${esc(U.d)} Current bonus: <b class="good">+${bonus}%</b></div>
      ${maxed ? `<div class="good small">Fully developed.</div>`
        : `<button class="btn small ${cur ? "off" : ""}" data-milup="${k}"
            title="Start researching level ${lvl + 1}: ${cost.money}💰 ${cost.mat}⛏ up front, then ${fmt(cost.rp)}🔬 of research to complete. Only one upgrade can be researched at a time.">
            ⬆ Research level ${lvl + 1} <i>${cost.money}💰 ${cost.mat}⛏ + ${fmt(cost.rp)}🔬</i></button>`}
    </div>`;
  }
  html += `<div class="hint">🌆 Researcher megastructures and colony labs pour their science into upgrades whenever no technology is queued — the research station stays useful after every era is complete.</div>`;
  root.innerHTML = html;
  wireMilTabs();
  $$("[data-milup]").forEach(b => b.onclick = () => {
    const k = b.dataset.milup;
    if (typeof netIntercept === "function" && netIntercept("milup", { k })) return;
    const r = startMilUpgrade(G.playerId, k);
    toast(r.msg);
    if (r.ok && typeof S !== "undefined") S.play("coin");
    renderTopbar(); renderSidebar();
  });
  const cancel = $("#milup-cancel");
  if (cancel) cancel.onclick = () => {
    if (typeof netIntercept === "function" && netIntercept("milupCancel", {})) return;
    P.milResearching = null;
    toast("Upgrade research abandoned.");
    renderSidebar();
  };
}

function showConquest(defId) {
  const D = G.countries[defId];
  openModal(`<h2>🏴 ${esc(D.name)} is broken</h2>
    <p>Their capital lies in your hands and their armies are scattered. Decide their fate:</p>
    <button class="btn danger" data-act="annex">Annex — absorb the nation entirely (world reputation −)</button>
    <button class="btn" data-act="vassal">Subject state — they keep their name, pay tribute, follow you to war</button>
    <button class="btn" data-act="demand">Demand occupied territory — keep what you hold, then peace</button>
    <button class="btn" data-act="peace">Magnanimous peace — return everything (+relations, +trust)</button>`);
  $$("#modal [data-act]").forEach(b => b.onclick = () => {
    const how = b.dataset.act;
    if (typeof netIntercept === "function" && netIntercept("conquest", { def: defId, how })) { closeModal(); return; }
    G.brokenPending = null;
    resolveConquest(G.playerId, defId, how);
    if (how === "peace") {
      G.rel[defId][G.playerId] = clamp(G.rel[defId][G.playerId] + 30, -100, 100);
      G.trust[defId][G.playerId] = clamp(G.trust[defId][G.playerId] + 20, 0, 100);
    }
    closeModal();
    Object.keys(maskCache).forEach(k => delete maskCache[k]);
    repaintTint(); renderAll();
    checkVictory();
    if (G.victory && !G.victory.announced) showEnd(G.victory.by === G.playerId);
  });
}

// which human player (if any) leads this country right now? (QoL §17)
function humanInfoOf(cid) {
  cid = Number(cid);
  if (typeof NET === "undefined" || !NET.active || !G) return null;
  const p = (G.mpPlayers || []).find(q => q.cid === cid);
  if (p) return { name: p.name, online: p.online !== false };
  return null;
}
function humanBadge(cid) {
  const info = humanInfoOf(cid);
  if (!info) return "";
  if (!info.online) return ` <span class="warn" title="This player is temporarily disconnected — a caretaker AI protects the nation.">🎮 ${esc(info.name)} (disconnected)</span>`;
  return ` <span class="good" title="Controlled by a human player.">🎮 ${esc(info.name)}</span>`;
}

// ---- Diplomacy ----
function renderDiplo(root, P) {
  const others = Object.keys(G.countries).map(Number)
    .filter(i => i !== G.playerId && G.countries[i].alive && !G.countries[i].rebel && !G.countries[i].alien)
    .sort((a, b) => G.rel[b][G.playerId] - G.rel[a][G.playerId]);
  if (!diploTarget || !G.countries[diploTarget] || !G.countries[diploTarget].alive ||
      G.countries[diploTarget].rebel || G.countries[diploTarget].alien || diploTarget === G.playerId) diploTarget = others[0];
  let html = `<h3>Diplomacy</h3>`;
  // ---- diplomacy inbox (QoL §6): requests wait here until answered ----
  const inbox = (G.diploInbox || []).filter(o => o.to === G.playerId && o.status === "pending");
  const myOffers = (G.peaceOffers || []).filter(o => o.to === G.playerId);
  if (inbox.length || myOffers.length) {
    html += `<div class="warbox"><b>📨 Diplomacy inbox</b>`;
    for (const o of inbox) {
      const F = G.countries[o.from];
      if (!F) continue;
      const label = (typeof DIPLO_ACT_LABEL !== "undefined" && DIPLO_ACT_LABEL[o.kind]) || o.kind;
      html += `<div class="kv" style="align-items:center"><span>${esc(label)}</span>
        <b>${esc(F.name)}</b>${humanBadge(o.from)}
        <button class="chip" data-inbox-yes="${o.id}" title="Accept the ${esc(label.toLowerCase())}.">✔ Accept</button>
        <button class="chip" data-inbox-no="${o.id}" title="Decline it.">✖ Reject</button></div>`;
    }
    for (const o of myOffers) html += `<button class="chip" data-acceptpeace="${o.from}">🕊 Accept peace with ${esc(G.countries[o.from].name)}</button>`;
    html += `</div>`;
  }
  html += `<select id="diplo-sel">${others.map(i =>
    `<option value="${i}" ${i === diploTarget ? "selected" : ""}>${humanInfoOf(i) ? "🎮 " : ""}${esc(G.countries[i].name)} (${Math.round(G.rel[i][G.playerId])})</option>`).join("")}</select>`;
  const T = G.countries[diploTarget];
  if (T) {
    const rel = Math.round(G.rel[diploTarget][G.playerId]);
    const trust = Math.round(G.trust[diploTarget][G.playerId]);
    const war = atWar(G.playerId, diploTarget);
    const relCls = rel > 20 ? "good" : rel < -20 ? "bad" : "";
    const hinfo = humanInfoOf(diploTarget);
    const pacts = [];
    if (hasTrade(G.playerId, diploTarget)) pacts.push("trade");
    if (allied(G.playerId, diploTarget)) pacts.push("alliance");
    if (hasRP(G.playerId, diploTarget)) pacts.push("research pact");
    if (hasAccess(G.playerId, diploTarget)) pacts.push("military access");
    if (G.vassals[diploTarget] === G.playerId) pacts.push("your subject");
    html += `
      <div class="kv"><span>${esc(T.name)}</span>${esc(NATIONS[diploTarget].sp)} · ${esc(GOVS[T.gov].n)} · ${esc(ERAS[T.era].n)}</div>
      <div class="kv"><span>Controlled by</span>${hinfo ? (hinfo.online ? `<b class="good">🎮 Human player — ${esc(hinfo.name)}</b>` : `<b class="warn">🎮 ${esc(hinfo.name)} (disconnected — caretaker AI)</b>`) : "🤖 AI"}</div>
      <div class="kv"><span>Personality</span>${esc(T.personality)}</div>
      <div class="kv"><span>Relations</span><b class="${relCls}">${rel > 0 ? "+" : ""}${rel}</b> · trust ${trust}${war ? ' · <b class="bad">AT WAR</b>' : ""}</div>
      <div class="kv"><span>Pacts</span>${pacts.length ? pacts.join(", ") : "none"}</div>
      ${hinfo && hinfo.online ? `<div class="hint small">📨 Requests to a human player go to their diplomacy inbox — they answer personally. War declarations take effect immediately (they are notified).</div>` : ""}
      <div class="diplo-actions">`;
    const acts = [];
    if (!war) {
      acts.push(["improve", `Improve relations (${diploCost(80)}💰)`, true]);
      acts.push(["gift", `Send aid: 200💰`, P.res.money >= 200]);
      if (!hasTrade(G.playerId, diploTarget)) acts.push(["trade", "Propose trade agreement", true]);
      if (!allied(G.playerId, diploTarget)) acts.push(["alliance", "Propose alliance", true]);
      if (!hasAccess(G.playerId, diploTarget)) acts.push(["access", "Request military access", true]);
      if (!hasRP(G.playerId, diploTarget)) acts.push(["research", "Research agreement", true]);
      acts.push(["demand", "Demand territory", true]);
      if (!G.vassals[diploTarget]) acts.push(["vassal", "Demand subjugation", true]);
      acts.push(["war", "⚔ Declare war", true]);
    } else {
      acts.push(["peace", "Offer white peace", true]);
      if (provsOfNation(diploTarget).some(e => e.p.occ === G.playerId)) acts.push(["demandocc", "Demand occupied lands & peace", true]);
    }
    for (const [id, label, can] of acts) {
      html += `<button class="btn small ${id === "war" ? "danger" : ""} ${can ? "" : "off"}" data-dip="${id}">${label}</button>`;
    }
    html += `</div>`;
  }
  root.innerHTML = html;
  $("#diplo-sel").onchange = e => { diploTarget = Number(e.target.value); renderSidebar(); };
  $$("[data-acceptpeace]").forEach(b => b.onclick = () => {
    const id = Number(b.dataset.acceptpeace);
    if (typeof netIntercept === "function" && netIntercept("acceptPeace", { from: id })) return;
    makePeace(G.playerId, id, false);
    G.peaceOffers = G.peaceOffers.filter(o => !(o.from === id && o.to === G.playerId));
    renderAll(); repaintTint();
  });
  const inboxAnswer = (id, accept) => {
    if (typeof netIntercept === "function" && netIntercept("inbox", { id, accept }, r => {
      if (r && r.msg) toast(r.msg);
      renderSidebar(); renderTopbar();
    })) return;
    const r = netInboxAnswer(G.playerId, id, accept);
    if (r && r.msg) toast(r.msg);
    renderAll(); repaintTint();
  };
  $$("[data-inbox-yes]").forEach(b => b.onclick = () => inboxAnswer(Number(b.dataset.inboxYes), true));
  $$("[data-inbox-no]").forEach(b => b.onclick = () => inboxAnswer(Number(b.dataset.inboxNo), false));
  $$("[data-dip]").forEach(b => b.onclick = () => doDiplo(b.dataset.dip));
}

function doDiplo(act) {
  const P = G.countries[G.playerId], t = diploTarget, T = G.countries[t];
  // multiplayer clients: every diplomatic act runs on the host (war has its own confirm below)
  if (act !== "war" && typeof netIntercept === "function" && netIntercept("diplo", { act, target: t })) return;
  // the HOST's own requests to another human also route through the shared
  // player-to-player path (QoL §3) — never through instant AI acceptance
  if (act !== "war" && typeof NET !== "undefined" && NET.active && NET.isHost && isHumanControlled(t) &&
      typeof netDiploHost === "function") {
    const r = netDiploHost(G.playerId, act, t);
    if (r && r.msg) toast(r.msg);
    if (r && r.sfx && typeof S !== "undefined") S.play(r.sfx);
    renderAll();
    return;
  }
  switch (act) {
    case "improve": { const r = actImprove(G.playerId, t); toast(r.msg); break; }
    case "gift": {
      if (P.res.money < 200) { toast("Not enough money."); break; }
      P.res.money -= 200; T.res.money += 200;
      G.rel[t][G.playerId] = clamp(G.rel[t][G.playerId] + 10, -100, 100);
      for (const pr of G.promises) if (pr.type === "aid" && pr.from === G.playerId && pr.to === t && !pr.done && !pr.broken) pr.data.paid = true;
      if (typeof S !== "undefined") S.play("coin");
      toast(`Aid sent to ${T.name} (+10 relations).`); break;
    }
    case "trade":
      if (aiAccepts(t, G.playerId, "trade")) { G.trades.push([G.playerId, t]); toast("Trade agreement signed."); }
      else toast(`${T.name} declines.`); break;
    case "alliance":
      if (aiAccepts(t, G.playerId, "alliance")) { G.alliances.push([G.playerId, t]); toast("Alliance formed!"); }
      else toast(`${T.name} declines — build relations (55+) and trust (40+).`); break;
    case "access":
      if (aiAccepts(t, G.playerId, "access")) { G.accessPacts.push([G.playerId, t]); toast("Military access granted."); }
      else toast(`${T.name} declines.`); break;
    case "research":
      if (aiAccepts(t, G.playerId, "research")) { G.researchPacts.push([G.playerId, t]); bumpMods(); toast("Research agreement signed (+8% research both)."); }
      else toast(`${T.name} declines.`); break;
    case "demand":
      if (aiAccepts(t, G.playerId, "demand")) {
        const entries = provsOfNation(t).filter(e => !(e.home.id === t && e.idx === T.capital));
        if (entries.length) {
          const e2 = entries[0];
          e2.p.own = G.playerId; e2.p.occ = null; e2.p.unrest = 6;
          G.rel[t][G.playerId] = clamp(G.rel[t][G.playerId] - 40, -100, 100);
          toast(`${T.name} cedes ${e2.p.name}!`);
          if (typeof mapOwnershipChanged === "function") mapOwnershipChanged();
        }
      } else { G.rel[t][G.playerId] = clamp(G.rel[t][G.playerId] - 20, -100, 100); toast(`${T.name} refuses. Relations suffer.`); }
      break;
    case "vassal":
      if (aiAccepts(t, G.playerId, "vassal")) { G.vassals[t] = G.playerId; toast(`${T.name} submits as your subject!`); repaintTint(); }
      else { G.rel[t][G.playerId] = clamp(G.rel[t][G.playerId] - 30, -100, 100); toast(`${T.name} defies you.`); }
      break;
    case "war":
      openModal(`<h2>Declare war on ${esc(T.name)}?</h2>
        <p>Their power: ~${fmt(powerEstimate(T))}. Yours: ${fmt(powerEstimate(P))}.</p>
        ${G.promises.some(p2 => p2.from === G.playerId && p2.to === t && p2.type === "peace" && !p2.done && !p2.broken) ? '<p class="bad">⚠ You promised peace — declaring war will break your word!</p>' : ""}
        <button class="btn danger" id="cw">Declare war</button> <button class="btn" data-close>Cancel</button>`);
      $("#cw").onclick = () => {
        if (typeof netIntercept === "function" && netIntercept("diplo", { act: "war", target: t })) { closeModal(); uiTab = "mil"; renderSidebar(); return; }
        declareWar(G.playerId, t); closeModal(); uiTab = "mil"; renderAll();
      };
      return;
    case "peace":
      if (aiAccepts(t, G.playerId, "peace")) { makePeace(G.playerId, t, false); toast("Peace agreed."); repaintTint(); }
      else toast(`${T.name} fights on.`); break;
    case "demandocc":
      if (aiAccepts(t, G.playerId, "surrender_demand")) { makePeace(G.playerId, t, true); toast("Territory ceded. Peace."); repaintTint(); }
      else toast(`${T.name} refuses your terms.`); break;
  }
  renderAll();
}

// ---- Espionage ----
function renderEsp(root, P) {
  const others = Object.keys(G.countries).map(Number)
    .filter(i => i !== G.playerId && G.countries[i].alive && !G.countries[i].rebel && !G.countries[i].alien);
  if (!espTarget || !others.includes(espTarget)) espTarget = others[0];
  const M = MODES[G.mode];
  const actions = [
    ["steal", "Steal technology", Math.round(250 * M.cost), "Acquire one technology the target has and you lack."],
    ["reveal", "Reveal armies", Math.round(120 * M.cost), "See their exact military for 20 turns."],
    ["sabotage", "Sabotage production", Math.round(200 * M.cost), "−30% production for 3 turns."],
    ["unrest", "Support unrest", Math.round(220 * M.cost), "−10 stability, −8 morale in the target nation."],
  ];
  root.innerHTML = `<h3>Espionage</h3>
    <select id="esp-sel">${others.map(i => `<option value="${i}" ${i === espTarget ? "selected" : ""}>${esc(G.countries[i].name)}</option>`).join("")}</select>
    <div class="hint">Success depends on intelligence and technology. Failed agents may be captured, damaging relations.</div>
    <div class="esp-actions">${actions.map(([id, n, c, d]) =>
      `<button class="btn ${P.res.money >= c ? "" : "off"}" data-spy="${id}" title="${esc(d)}">${n} <i>${c}💰</i></button>`).join("")}</div>
    <div id="esp-result"></div>`;
  $("#esp-sel").onchange = e => { espTarget = Number(e.target.value); };
  $$("[data-spy]").forEach(b => b.onclick = () => {
    if (typeof netIntercept === "function" && netIntercept("spy", { target: espTarget, action: b.dataset.spy }, r => {
      const el2 = $("#esp-result");
      if (el2 && r) el2.innerHTML = `<div class="${r.ok && r.success ? "good" : "bad"} pad">${esc(r.msg || "")}</div>`;
    })) return;
    const r = spy(G.playerId, espTarget, b.dataset.spy);
    $("#esp-result").innerHTML = `<div class="${r.ok && r.success ? "good" : "bad"} pad">${esc(r.msg)}</div>`;
    renderTopbar(); renderLog();
  });
}

// ---- Policies ----
function renderPolicies(root, P) {
  let html = `<h3>Laws & Policies</h3>`;
  const keys = { tax: "tax", edu: "edu", mil: "mil", health: "health", trade: "trade", consc: "consc" };
  for (const [pk, gk] of Object.entries(keys)) {
    const pol = POLICIES[pk];
    html += `<div class="polrow"><b>${esc(pol.n)}</b><div class="seg">`;
    pol.opts.forEach((o, i) => {
      html += `<button class="segbtn ${P.policies[gk] === i ? "active" : ""}" data-pol="${gk}" data-v="${i}" title="${esc(pol.d[i])}">${o}</button>`;
    });
    html += `</div><div class="dim small">${esc(pol.d[P.policies[gk]])}</div></div>`;
  }
  html += `<h4>Government — ${esc(GOVS[P.gov].n)}</h4>
    <div class="dim small">${esc(GOVS[P.gov].eff)}</div>`;
  if (P.govCooldown > 0) html += `<div class="warn small">Recent reform — wait ${P.govCooldown} turns.</div>`;
  else {
    html += `<div class="diplo-actions">`;
    for (const [gid, g] of Object.entries(GOVS)) {
      if (gid === P.gov) continue;
      html += `<button class="btn small" data-gov="${gid}" title="${esc(g.eff)}">Become ${esc(g.n)} (${Math.round(400 * MODES[G.mode].cost)}💰, −15 stability)</button>`;
    }
    html += `</div>`;
  }
  root.innerHTML = html;
  $$("[data-pol]").forEach(b => b.onclick = () => {
    if (typeof netIntercept === "function" && netIntercept("policy", { k: b.dataset.pol, v: Number(b.dataset.v) })) return;
    P.policies[b.dataset.pol] = Number(b.dataset.v);
    renderAll();
  });
  $$("[data-gov]").forEach(b => b.onclick = () => {
    if (typeof netIntercept === "function" && netIntercept("customize", { kind: "gov", value: b.dataset.gov })) return;
    const r = customize("gov", b.dataset.gov);
    toast(r.msg === "Done." ? `Government reformed.` : r.msg);
    renderAll();
  });
}

// ---- Talk ----
let chatLog = { citizen: [], mayor: [], leader: [] };
// player-to-player chat history, per country id (QoL §5) — session only
let pchatLog = {};
function pchatDeliver(fromCid, name, text) {
  (pchatLog[fromCid] = pchatLog[fromCid] || []).push({ who: "them", name, text });
  if (pchatLog[fromCid].length > 60) pchatLog[fromCid] = pchatLog[fromCid].slice(-60);
  const cname = G.countries[fromCid] ? G.countries[fromCid].name : "?";
  toast(`💬 ${name} (${cname}): ${text.length > 60 ? text.slice(0, 60) + "…" : text}`);
  if (typeof S !== "undefined") S.play("toast");
  if (uiTab === "talk" && talkKind === "leader" && talkTarget === Number(fromCid)) renderSidebar();
}
function renderTalk(root, P) {
  const others = Object.keys(G.countries).map(Number)
    .filter(i => i !== G.playerId && G.countries[i].alive && !G.countries[i].rebel && !G.countries[i].alien);
  if (!talkTarget || !others.includes(talkTarget)) talkTarget = others[0];
  const kinds = [["citizen", "Citizen"], ["mayor", "City leader"], ["leader", "Foreign leader"]];
  const chips = {
    citizen: ["How is life?", "What about the taxes?", "How is the food supply?", "What do you think of the war?"],
    mayor: ["What does the city need?", "How are our defences?", "How is the mood of the people?", "How is production?"],
    leader: ["Greetings.", "Let us make peace.", "I propose a trade deal.", "Let us form an alliance.", "I promise peace between us.", "I promise military support.", "Surrender or be destroyed!"],
  };
  // a human-led country gets a REAL chat with that player (QoL §5)
  const hinfo = talkKind === "leader" ? humanInfoOf(talkTarget) : null;
  const humanChat = !!(hinfo && hinfo.online);
  const talkLabel = talkKind === "leader"
    ? (hinfo
      ? (hinfo.online ? `<div class="kv"><span>Channel</span><b class="good">🎮 Human Player — ${esc(hinfo.name)}</b></div>`
                      : `<div class="kv"><span>Channel</span><b class="warn">🎮 ${esc(hinfo.name)} is disconnected — a caretaker AI answers</b></div>`)
      : `<div class="kv"><span>Channel</span>🤖 AI Leader</div>`)
    : "";
  const historyHtml = humanChat
    ? (pchatLog[talkTarget] || []).map(m =>
        `<div class="msg ${m.who}"><span>${m.who === "them" ? `<b class="small">${esc(m.name)}:</b> ` : ""}${esc(m.text)}</span></div>`).join("")
    : chatLog[talkKind].map(m =>
        `<div class="msg ${m.who}"><span>${esc(m.text)}</span>${m.fx && m.fx.length ? `<i class="fx">${m.fx.map(esc).join(" · ")}</i>` : ""}</div>`).join("");
  root.innerHTML = `<h3>Conversations</h3>
    ${G.mode === "standard" ? '<div class="hint">In Realistic Mode conversations also sway morale and stability.</div>' : '<div class="hint">Listening to your people improves morale. Words to foreign leaders carry real weight — including promises.</div>'}
    <div class="seg" id="talk-kinds">${kinds.map(([k, n]) => `<button class="segbtn ${talkKind === k ? "active" : ""}" data-k="${k}">${n}</button>`).join("")}</div>
    ${talkKind === "leader" ? `<select id="talk-sel">${others.map(i => `<option value="${i}" ${i === talkTarget ? "selected" : ""}>${humanInfoOf(i) ? "🎮 " : ""}${esc(G.countries[i].name)} — ${esc(G.countries[i].leaderTitle)} ${esc(G.countries[i].leaderName)}</option>`).join("")}</select>` : ""}
    ${talkLabel}
    ${humanChat ? `<div class="hint small">💬 Direct line to a human player — everything you type is delivered to them personally.</div>` : ""}
    <div class="chat" id="chatbox">${historyHtml}</div>
    ${humanChat ? "" : `<div class="chiprow">${chips[talkKind].map(c => `<button class="chip" data-say="${esc(c)}">${esc(c)}</button>`).join("")}</div>`}
    <div class="sendrow"><input id="talk-input" placeholder="${humanChat ? "Message the player…" : "Type a message…"}" maxlength="140"><button class="btn primary" id="talk-send">Send</button></div>`;
  const box = $("#chatbox"); box.scrollTop = box.scrollHeight;
  $$("#talk-kinds .segbtn").forEach(b => b.onclick = () => { talkKind = b.dataset.k; renderSidebar(); });
  const sel = $("#talk-sel"); if (sel) sel.onchange = e => { talkTarget = Number(e.target.value); renderSidebar(); };
  const send = text => {
    if (!text.trim()) return;
    if (humanChat) {
      (pchatLog[talkTarget] = pchatLog[talkTarget] || []).push({ who: "you", text });
      if (typeof netPchatSend === "function") netPchatSend(talkTarget, text);
      renderSidebar();
      return;
    }
    chatLog[talkKind].push({ who: "you", text });
    const kindNow = talkKind;
    if (typeof netIntercept === "function" && netIntercept("talk", { kind: talkKind, target: talkKind === "leader" ? talkTarget : null, text }, r => {
      if (!r) return;
      chatLog[kindNow].push({ who: "them", text: r.reply, fx: r.effects });
      if (chatLog[kindNow].length > 40) chatLog[kindNow] = chatLog[kindNow].slice(-40);
      if (typeof S !== "undefined") S.play("toast");
      if (uiTab === "talk") renderSidebar();
    })) { renderSidebar(); return; }
    const r = converse(talkKind, talkKind === "leader" ? talkTarget : null, text);
    chatLog[talkKind].push({ who: "them", text: r.reply, fx: r.effects });
    if (chatLog[talkKind].length > 40) chatLog[talkKind] = chatLog[talkKind].slice(-40);
    if (typeof S !== "undefined") S.play("toast");
    renderAll(); repaintTint();
  };
  $$("[data-say]").forEach(b => b.onclick = () => send(b.dataset.say));
  $("#talk-send").onclick = () => send($("#talk-input").value);
  $("#talk-input").onkeydown = e => { if (e.key === "Enter") send(e.target.value); };
}

// ---- Nation (customization) ----
function renderNation(root, P) {
  const M = MODES[G.mode].cost;
  const proms = G.promises.filter(p => p.from === G.playerId || p.to === G.playerId);
  root.innerHTML = `<h3>Nation</h3>
    <div class="kv"><span>Flag</span><div class="tb-flag big" style="background:${rgba(P.flag.bg, 1)}">${P.flag.glyph}</div></div>
    <div class="kv"><span>Name</span><input id="cn-name" value="${esc(P.name)}" maxlength="24"> <button class="btn small" id="cn-name-b">Rename (${Math.round(50 * M)}💰)</button></div>
    <div class="kv"><span>Leader title</span><input id="cn-title" value="${esc(P.leaderTitle)}" maxlength="18"> <button class="btn small" id="cn-title-b">Change (${Math.round(40 * M)}💰)</button></div>
    <div class="kv"><span>Language</span><input id="cn-lang" value="${esc(P.lang)}" maxlength="18"> <button class="btn small" id="cn-lang-b">Change (${Math.round(300 * M)}💰, −5 morale)</button></div>
    <div class="kv"><span>Flag glyph</span><div class="chiprow">${FLAG_GLYPHS.map(g => `<button class="chip ${P.flag.glyph === g ? "active" : ""}" data-glyph="${g}">${g}</button>`).join("")} <i class="dim">(${Math.round(30 * M)}💰)</i></div></div>
    <div class="kv"><span>Capital</span><div class="chiprow">${P.provinces.map((p, i) => `<button class="chip ${i === P.capital ? "active" : ""}" data-cap="${i}" ${p.occ || p.own !== G.playerId ? "disabled" : ""}>${esc(p.city)}</button>`).join("")} <i class="dim">(${Math.round(150 * M)}💰)</i></div></div>
    <div class="hint">Species, appearance, natural strengths and weaknesses, geography and history are permanent — though technology can offset weaknesses (see Powered Exosuits).</div>
    <h4>Promises</h4>
    ${proms.length ? proms.map(p => `<div class="small ${p.broken ? "bad" : p.done ? "good" : ""}">${esc(G.countries[p.from].name)} → ${esc(G.countries[p.to].name)}: ${p.type}${p.type === "aid" ? ` (${p.data.paid ? "paid" : "unpaid"})` : ""} · due turn ${p.due} · ${p.broken ? "BROKEN" : p.done ? "kept" : "active"}</div>`).join("") : '<div class="dim small">No promises recorded.</div>'}
    <h4>Save</h4>
    <div class="diplo-actions">
      ${typeof NET !== "undefined" && NET.active && !NET.isHost
        ? `<button class="btn small danger" id="cn-leave">🌐 Leave multiplayer game</button>`
        : `<button class="btn small" id="cn-save">💾 Save now</button>
           <button class="btn small danger" id="cn-abandon">Abandon game</button>`}
    </div>`;
  const tryCust = (kind, val) => {
    if (typeof netIntercept === "function" && netIntercept("customize", { kind, value: val })) return;
    const r = customize(kind, val); toast(r.ok ? "Done." : r.msg); renderAll();
    if (kind === "name" || kind === "capital") { repaintTint(); if (typeof mapOwnershipChanged === "function") mapOwnershipChanged(); }
  };
  $("#cn-name-b").onclick = () => tryCust("name", $("#cn-name").value.trim() || P.name);
  $("#cn-title-b").onclick = () => tryCust("title", $("#cn-title").value.trim() || P.leaderTitle);
  $("#cn-lang-b").onclick = () => tryCust("lang", $("#cn-lang").value.trim() || P.lang);
  $$("[data-glyph]").forEach(b => b.onclick = () => tryCust("flag", { glyph: b.dataset.glyph }));
  $$("[data-cap]").forEach(b => b.onclick = () => tryCust("capital", Number(b.dataset.cap)));
  const sv = $("#cn-save"); if (sv) sv.onclick = () => { autosave(); toast("Saved."); };
  const ab = $("#cn-abandon"); if (ab) ab.onclick = () => { clearSave(); location.reload(); };
  const lv = $("#cn-leave"); if (lv) lv.onclick = () => { if (typeof netLeave === "function") netLeave(); else location.reload(); };
}

// ---- Sandbox (Sandbox Improvement §9: one clear control panel) ----
function renderSandbox(root, P) {
  const sb = G.sandbox;
  if (!sb) { root.innerHTML = "<div class='pad dim'>Sandbox tools are only available in Sandbox Mode.</div>"; return; }
  const others = Object.keys(G.countries).map(Number).filter(i => G.countries[i].alive);
  const inspectable = others.filter(i => !G.countries[i].rebel);
  if (!sb.transferTo || !G.countries[sb.transferTo] || !G.countries[sb.transferTo].alive) sb.transferTo = G.playerId;
  if (!sb.inspectTo || !G.countries[sb.inspectTo] || !G.countries[sb.inspectTo].alive) sb.inspectTo = G.playerId;
  if (!sb.warA || !G.countries[sb.warA] || !G.countries[sb.warA].alive) sb.warA = inspectable.find(i => i !== G.playerId) || G.playerId;
  if (!sb.warB || !G.countries[sb.warB] || !G.countries[sb.warB].alive || sb.warB === sb.warA) sb.warB = inspectable.find(i => i !== sb.warA) || G.playerId;
  const civName = i => `${G.countries[i].alien ? "👁 " : ""}${esc(G.countries[i].name)}${i === G.playerId ? " (you)" : ""}`;
  const civOpts = (selVal, pool) => (pool || inspectable).map(i => `<option value="${i}" ${i === selVal ? "selected" : ""}>${civName(i)}</option>`).join("");
  const seg = (k, on, off) => `<div class="seg">
      <button class="segbtn ${sb[k] ? "active" : ""}" data-sb="${k}" data-v="1">${on || "On"}</button>
      <button class="segbtn ${!sb[k] ? "active" : ""}" data-sb="${k}" data-v="0">${off || "Off"}</button>
    </div>`;
  // inverted display: the stored flags are negative (aiOff/noAIWars/noEvents),
  // the panel shows the positive question the spec asks for (§10-§11)
  const segInv = k => `<div class="seg">
      <button class="segbtn ${!sb[k] ? "active" : ""}" data-sb="${k}" data-v="0">On</button>
      <button class="segbtn ${sb[k] ? "active" : ""}" data-sb="${k}" data-v="1">Off</button>
    </div>`;
  const sp = SANDBOX_SPEEDS.find(x => x.s === (sb.tickS || 3)) || SANDBOX_SPEEDS[0];
  root.innerHTML = `<h3>🧪 Sandbox Control Panel</h3>
    <div class="hint">Creative & testing tools — nothing here is balanced, everything is allowed. Sandbox runs in real time (no End Turn): the world ticks automatically at the speed below.</div>
    <h4>⏱ Simulation</h4>
    <div class="kv"><span>Speed</span><b>${G.rtPaused ? "⏸ PAUSED" : `${esc(sp.n)} — 1 tick / ${sp.s}s`}</b></div>
    <div class="diplo-actions">
      <button class="btn small ${G.rtPaused ? "primary" : ""}" id="sbx-pause">${G.rtPaused ? "▶ Resume" : "⏸ Pause simulation"}</button>
      ${SANDBOX_SPEEDS.map(x => `<button class="btn small ${!G.rtPaused && (sb.tickS || 3) === x.s ? "primary" : ""}" data-sbspeed2="${x.s}" title="One game tick every ${x.s}s.">${x.n} (${x.s}s)</button>`).join("")}
    </div>
    <div class="polrow"><b>AI Enabled</b>${segInv("aiOff")}<div class="dim small">Off pauses every AI decision — nations and aliens stop thinking, building and fighting (economies still tick).</div></div>
    <div class="polrow"><b>AI Wars Enabled</b>${segInv("noAIWars")}<div class="dim small">Off stops ALL new AI war declarations — nations and alien civilizations alike (existing wars continue until peace).</div></div>
    <div class="polrow"><b>Events Enabled</b>${segInv("noEvents")}<div class="dim small">Off: no random events trigger at all — no pop-ups, no forced choices, no interruptions (§11).</div></div>
    <div class="polrow"><b>Auto-Resolve Events</b>${seg("autoEvents")}<div class="dim small">Events still happen, but the default option is taken silently — nothing pauses fast-forward.</div></div>
    <h4>🎛 Cheats</h4>
    ${[["money", "Unlimited resources", "Money, food, materials and energy stay topped up."],
       ["research", "Instant research", "A technology finishes the moment you pick it."],
       ["build", "Instant construction", "Buildings and recruits appear immediately, no queues."],
       ["freeCost", "Everything is free", "Units, buildings, missiles, upgrades and new cities cost nothing."],
       ["noCd", "Disable Cooldowns", "Abilities are ready again immediately after use — Star Destroyer weapons, Omni Laser, harvesting, Phantom Step, everything (§4)."],
       ["vision", "Reveal all armies", "Every army in the world is visible to you."]]
      .map(([k, n, d]) => `<div class="polrow"><b>${n}</b>${seg(k)}<div class="dim small">${d}</div></div>`).join("")}
    <h4>⚡ Instant actions</h4>
    <div class="diplo-actions">
      <button class="btn small primary" id="sbx-eras" title="Complete EVERY technology of every era at once: all units, buildings, space travel, megastructures and abilities unlock, no prerequisites left (§3).">✨ Unlock All Eras and Technologies</button>
      <button class="btn small" id="sbx-cds" title="Immediately reset every active cooldown of yours — Star Destroyer weapons, Omni Laser, stellar harvesting, Black Hole charging, Phantom Step, Researcher abilities, capital moves (§4).">⏳ Skip Cooldowns</button>
      <button class="btn small" id="sbx-reveal" title="Reveal every solar system, star, planet, colony and structure in the galaxy — visible alien civilizations register in 👁 Known Civilizations (§5).">🌌 Reveal All Solar Systems</button>
      <button class="btn small" id="sbx-cash">💰 +10,000 of everything</button>
      <button class="btn small" id="sbx-heal">❤ Heal all my armies</button>
      <button class="btn small" id="sbx-peace">🕊 End all my wars</button>
    </div>
    <h4>🔍 Civilization inspection</h4>
    <div class="dim small">Open any nation or alien empire: military, economy, technology, cities and every building (§12).</div>
    <select id="sbx-inspect-sel">${civOpts(sb.inspectTo)}</select>
    <div class="diplo-actions"><button class="btn small" id="sbx-inspect">🔍 Inspect civilization</button></div>
    <h4>⚔ Force War</h4>
    <div class="dim small">Instantly set two civilizations — nations or alien empires — at war (§13). "Attack Mainland" orders the attacker onto the defender's home ground, capital first, through normal transports and battles (§14).</div>
    <div class="kv"><span>Attacker</span></div><select id="sbx-war-a">${civOpts(sb.warA)}</select>
    <div class="kv"><span>Defender</span></div><select id="sbx-war-b">${civOpts(sb.warB)}</select>
    <div class="kv"><span>Intensity</span></div>
    <select id="sbx-war-int"><option value="low">Low — short forced war</option><option value="normal" selected>Normal</option><option value="total">Total war — long, all-out</option></select>
    <div class="polrow"><b>Attack Mainland</b><div class="seg">
      <button class="segbtn ${sb.warMainland ? "active" : ""}" data-sbw="1">On</button>
      <button class="segbtn ${!sb.warMainland ? "active" : ""}" data-sbw="0">Off</button>
    </div></div>
    <div class="diplo-actions"><button class="btn small danger" id="sbx-forcewar">⚔ Force War</button></div>
    <h4>🖐 Country ownership</h4>
    <div class="kv"><span>Give land to</span></div>
    <select id="sbx-nation">${others.map(i => `<option value="${i}" ${i === sb.transferTo ? "selected" : ""}>${civName(i)}</option>`).join("")}</select>
    <div class="diplo-actions">
      <button class="btn small" id="sbx-transfer">🖐 Click cities to transfer them</button>
      <button class="btn small" id="sbx-transfer-all">🌍 Click a country to transfer it whole</button>
    </div>
    <h4>💥 Instant destruction</h4>
    <div class="dim small">Arm the tool, then click armies or cities on the map to delete them (major targets ask for confirmation). Space objects — ships, colonies, planets, Dyson Spheres, stations — have their own 💥 buttons in the 🌌 Space view (§8).</div>
    <div class="diplo-actions"><button class="btn small danger ${sandboxDestroyMode ? "primary" : ""}" id="sbx-destroy">${sandboxDestroyMode ? "💥 Destruction armed — Esc stops" : "💥 Click units/cities to destroy"}</button></div>
    <h4>🎖 Spawn units anywhere</h4>
    <div class="hint">Pick a unit, then click any spot on the map to drop it there (Shift-click keeps placing, Esc stops). Ships drop onto water.</div>
    <div class="recruit">${Object.keys(UNITS).map(uId => {
      const u = UNITS[uId];
      return `<div class="ucard" data-sbu="${uId}" title="${u.atk}⚔ ${u.def}🛡 ${u.hp * 6}HP"><b>${u.icon} ${esc(u.n)}</b><span class="dim">era ${u.e}${u.naval ? " · ⚓" : ""}</span></div>`;
    }).join("")}</div>`;
  $$("#sidecontent [data-sb]").forEach(b => b.onclick = () => {
    sb[b.dataset.sb] = Number(b.dataset.v);
    if (typeof S !== "undefined") S.play("click");
    renderSidebar(); renderTopbar();
  });
  $$("#sidecontent [data-sbspeed2]").forEach(b => b.onclick = () => {
    sb.tickS = Number(b.dataset.sbspeed2) || 3;
    G.rtPaused = false;
    if (typeof S !== "undefined") S.play("click");
    renderSidebar(); renderTopbar();
  });
  $$("#sidecontent [data-sbw]").forEach(b => b.onclick = () => {
    sb.warMainland = Number(b.dataset.sbw);
    renderSidebar();
  });
  $("#sbx-pause").onclick = () => {
    G.rtPaused = !G.rtPaused;
    toast(G.rtPaused ? "⏸ Sandbox paused." : "▶ The world moves again.");
    renderSidebar(); renderTopbar();
  };
  $("#sbx-eras").onclick = () => {
    // Sandbox §3: not just era names — every TECHNOLOGY completes too
    const n = sandboxUnlockAll(G.playerId);
    toast(`✨ Every era unlocked — ${n} technolog${n === 1 ? "y" : "ies"} completed.`);
    if (typeof S !== "undefined") S.play("era");
    renderAll();
  };
  $("#sbx-cds").onclick = () => {
    const n = typeof sandboxSkipCooldowns === "function" ? sandboxSkipCooldowns(G.playerId) : 0;
    toast(n ? `⏳ ${n} cooldown${n > 1 ? "s" : ""} reset — everything is ready.` : "⏳ Nothing was cooling down.");
    if (typeof spaceRefreshPanel === "function") spaceRefreshPanel();
  };
  $("#sbx-reveal").onclick = () => {
    if (typeof sandboxRevealAll === "function") sandboxRevealAll();
    toast("🌌 The entire galaxy is revealed — open the Space view.");
    if (typeof S !== "undefined") S.play("event");
  };
  $("#sbx-cash").onclick = () => {
    P.res.money += 10000; P.res.mat += 10000; P.res.food += 10000; P.res.energy += 1000;
    renderTopbar();
  };
  $("#sbx-heal").onclick = () => {
    for (const a of armiesOf(G.playerId)) a.hp = a.maxHp;
    toast("All your armies fully healed.");
  };
  $("#sbx-peace").onclick = () => {
    const foes = G.wars.filter(w => w.a === G.playerId || w.b === G.playerId).map(w => w.a === G.playerId ? w.b : w.a);
    for (const f of foes) makePeace(G.playerId, f, false);
    if (foes.length) toast("All your wars ended in white peace.");
    renderAll();
  };
  $("#sbx-inspect-sel").onchange = e => { sb.inspectTo = Number(e.target.value); };
  $("#sbx-inspect").onclick = () => showInspect(sb.inspectTo);
  $("#sbx-war-a").onchange = e => { sb.warA = Number(e.target.value); };
  $("#sbx-war-b").onchange = e => { sb.warB = Number(e.target.value); };
  $("#sbx-forcewar").onclick = () => {
    const intSel = $("#sbx-war-int");
    const r = sandboxForceWar(sb.warA, sb.warB, intSel ? intSel.value : "normal", !!sb.warMainland);
    toast(r.msg);
    if (r.ok && typeof S !== "undefined") S.play("warhorn");
    renderSidebar();
  };
  $("#sbx-nation").onchange = e => { sb.transferTo = Number(e.target.value); };
  $("#sbx-transfer").onclick = () => {
    sandboxTransfer = { to: sb.transferTo, whole: false };
    toast(`🖐 Transfer mode: click cities to give them to ${G.countries[sb.transferTo].name}. Esc stops.`);
  };
  $("#sbx-transfer-all").onclick = () => {
    sandboxTransfer = { to: sb.transferTo, whole: true };
    toast(`🌍 Transfer mode: click any city to hand its ENTIRE nation to ${G.countries[sb.transferTo].name}. Esc stops.`);
  };
  $("#sbx-destroy").onclick = () => {
    sandboxDestroyMode = !sandboxDestroyMode;
    toast(sandboxDestroyMode ? "💥 Destruction mode: click armies or cities to delete them. Esc stops." : "💥 Destruction mode off.");
    renderSidebar();
  };
  $$(".ucard[data-sbu]").forEach(card => card.onclick = () => {
    if (typeof warStartPlacing === "function") {
      warStartPlacing(card.dataset.sbu);
      sandboxSpawnMode = true;
      toast(`Click anywhere to spawn ${UNITS[card.dataset.sbu].n} (Shift-click keeps placing, Esc cancels).`);
    }
  });
}

// ============ Sandbox Improvement §12 — civilization inspection ============
// One data gatherer serves the panel and the test battery: everything known
// about a civilization — military, economy, technology, cities and buildings.
function inspectData(cid) {
  cid = Number(cid);
  const c = G.countries[cid];
  if (!c) return null;
  const armies = armiesOf(cid);
  const ships = typeof shipsOfNation === "function" ? shipsOfNation(cid) : [];
  const stock = missileStock(c);
  const cols = typeof coloniesOfNation === "function" ? coloniesOfNation(cid) : [];
  const d = {
    id: cid, name: c.name, alien: !!c.alien, rebel: !!c.rebel, alive: c.alive,
    personality: c.personality, era: c.era, eraName: ERAS[c.era] ? ERAS[c.era].n : "?",
    military: {
      armies: armies.length,
      ground: armies.filter(a => !UNITS[a.unit].naval && !UNITS[a.unit].air).length,
      navy: armies.filter(a => UNITS[a.unit].naval).length,
      air: armies.filter(a => UNITS[a.unit].air && !UNITS[a.unit].space).length,
      fleet: ships.length,
      starDestroyers: ships.filter(s => s.unit === "stardestroyer").length +
        armies.filter(a => a.unit === "stardestroyer").length,
      missiles: missileTotal(c), nukes: stock.nuke || 0,
      power: Math.round(powerEstimate(c)),
      defence: Math.round(armyPower(c, true)),
    },
    economy: null,
    tech: {
      era: c.era, researched: Object.keys(c.researched).length, total: TECHS.length,
      researching: c.researching ? (techById(c.researching) || {}).n || c.researching : null,
      rp: Math.round(c.rp || 0),
    },
    morale: Math.round(c.morale), stability: Math.round(c.stability),
    pop: Math.round(c.pop * 10) / 10,
    res: { money: Math.round(c.res.money), mat: Math.round(c.res.mat), food: Math.round(c.res.food), energy: Math.round(c.res.energy) },
    cities: [], colonies: [],
  };
  if (!c.alien && !c.rebel) {
    const prod = production(c);
    d.economy = { money: Math.round(prod.money), mat: Math.round(prod.mat), food: Math.round(prod.food),
      energy: Math.round(prod.energy), research: Math.round(prod.research), upkeep: Math.round(prod.upkeep),
      trade: Math.round(prod.trade || 0) };
    for (const e of provsOfNation(cid)) {
      const p = e.p;
      d.cities.push({
        name: p.city, lvl: p.lvl || 1, capital: c.provinces[c.capital] === p,
        occupied: p.occ ? (G.countries[p.occ] ? G.countries[p.occ].name : "?") : null,
        unrest: p.unrest || 0, slots: p.slots, used: usedSlots(p),
        buildings: Object.keys(p.b).map(k => ({ b: k, n: BLDGS[k] ? BLDGS[k].n : k, icon: BLDGS[k] ? BLDGS[k].icon : "?", count: p.b[k] })),
        queue: (p.bq || []).map(q => BLDGS[q.b] ? BLDGS[q.b].n : q.b),
        spec: p.b.spaceprogram ? "space" : (p.b.lab || 0) + (p.b.university || 0) >= 2 ? "research"
          : (p.b.megafactory || 0) + (p.b.industrial || 0) + (p.b.factory || 0) >= 2 ? "industrial"
          : (p.b.base || 0) + (p.b.fortress || 0) >= 2 ? "military"
          : (p.b.bank || 0) + (p.b.commerce || 0) + (p.b.tradehub || 0) >= 2 ? "trade" : "mixed",
      });
    }
  } else if (c.alien) {
    const rec = typeof alienById === "function" ? alienById(cid) : null;
    d.alienTier = rec ? rec.tier : null;
    d.alienTierName = rec ? ALIEN_TIERS[rec.tier].n : null;
    d.defeated = rec ? !!rec.defeated : false;
    d.capital = rec ? rec.capital : null;
    d.economy = rec && !rec.defeated ? { money: 400 * rec.tier, mat: 250 * rec.tier, note: "abstracted alien economy per tick" } : { money: 0, mat: 0, note: "defeated — no production" };
  }
  for (const col of cols) {
    d.colonies.push({
      planet: col.def.n, lvl: col.st.colony.lvl, garrison: col.st.colony.garrison.length,
      halo: !!(col.st.halo && col.st.halo.done), shield: !!(col.st.shield && col.st.shield.hp > 0),
      capitalPlanet: c.spaceCapital === col.def.id || (d.capital === col.def.id),
      buildings: Object.keys(col.st.colony.b || {}).filter(k => (col.st.colony.b || {})[k])
        .map(k => ({ b: k, n: COLONY_BLDGS[k] ? COLONY_BLDGS[k].n : k, count: col.st.colony.b[k] })),
    });
  }
  return d;
}
function showInspect(cid) {
  const d = inspectData(cid);
  if (!d) return;
  const M = d.military;
  const cityRow = ct => `<details style="margin:4px 0"><summary><b>${ct.capital ? "★ " : ""}${esc(ct.name)}</b> — L${ct.lvl}${ct.occupied ? ` · <span class="bad">occupied by ${esc(ct.occupied)}</span>` : ""} · ${ct.used}/${ct.slots} slots${ct.spec !== "mixed" ? ` · <i>${ct.spec}</i>` : ""}</summary>
    <div class="small" style="margin:4px 0 4px 14px">
      ${ct.buildings.length ? ct.buildings.map(b => `${b.icon} ${esc(b.n)}${b.count > 1 ? ` ×${b.count}` : ""}`).join(" · ") : "<span class='dim'>no buildings</span>"}
      ${ct.queue.length ? `<div class="dim">🏗 building: ${ct.queue.map(esc).join(", ")}</div>` : ""}
      ${ct.unrest ? `<div class="warn">unrest ${ct.unrest}</div>` : ""}
    </div></details>`;
  const colRow = cl => `<div class="kv"><span>${cl.capitalPlanet ? "👁★" : "🪐"} ${esc(cl.planet)}</span>L${cl.lvl} · garrison ${cl.garrison}${cl.halo ? " · ⭕" : ""}${cl.shield ? " · 🛡" : ""}${cl.buildings.length ? " · " + cl.buildings.map(b => `${esc(b.n)}${b.count > 1 ? `×${b.count}` : ""}`).join(", ") : ""}</div>`;
  openModal(`<h2>🔍 ${esc(d.name)}</h2>
    <div class="dim small">${d.alien ? `${esc(d.alienTierName || "Alien")} alien civilization${d.defeated ? " — FALLEN" : ""}` : esc(d.eraName)} · ${esc(d.personality || "?")}${d.alive ? "" : " · <b class='bad'>destroyed</b>"}</div>
    <h4>⚔ Military</h4>
    <div class="kv"><span>Total strength</span><b>${fmt(M.power)}</b> (defence rating ${fmt(M.defence)})</div>
    <div class="kv"><span>Armies</span>${M.armies} (${M.ground} ground · ${M.navy} naval · ${M.air} air)</div>
    <div class="kv"><span>Space fleet</span>${M.fleet} craft${M.starDestroyers ? ` · <b>${M.starDestroyers} 🌠 Star Destroyer${M.starDestroyers > 1 ? "s" : ""}</b>` : ""}</div>
    <div class="kv"><span>Missiles</span>${M.missiles}${M.nukes ? ` · <b class="bad">☢ ${M.nukes} nuclear</b>` : ""}</div>
    <h4>💰 Economy</h4>
    ${d.economy ? (d.economy.note
      ? `<div class="kv"><span>Income</span>+${fmt(d.economy.money)}💰 +${fmt(d.economy.mat)}⛏ per tick <span class="dim">(${d.economy.note})</span></div>`
      : `<div class="kv"><span>Income/tick</span>${d.economy.money >= 0 ? "+" : ""}${fmt(d.economy.money)}💰 · +${fmt(d.economy.mat)}⛏ · +${fmt(d.economy.food)}🍞 · ${fmt(d.economy.energy)}⚡ · +${fmt(d.economy.research)}🔬</div>
        <div class="kv"><span>Military upkeep</span>−${fmt(d.economy.upkeep)}💰</div>
        ${d.economy.trade ? `<div class="kv"><span>Trade income</span>+${fmt(d.economy.trade)}💰</div>` : ""}`) : ""}
    <div class="kv"><span>Treasury</span>${fmt(d.res.money)}💰 · ${fmt(d.res.mat)}⛏ · ${fmt(d.res.food)}🍞 · ${fmt(d.res.energy)}⚡</div>
    <div class="kv"><span>Population</span>${d.pop}M · morale ${d.morale} · stability ${d.stability}</div>
    <h4>🔬 Technology</h4>
    <div class="kv"><span>Era</span>${d.alien ? esc(d.alienTierName || "?") + " (era " + d.tech.era + ")" : esc(d.eraName)}</div>
    <div class="kv"><span>Researched</span>${d.alien ? "innate alien technology" : `${d.tech.researched}/${d.tech.total} technologies`}</div>
    ${d.tech.researching ? `<div class="kv"><span>Researching</span>${esc(d.tech.researching)} (${fmt(d.tech.rp)} rp)</div>` : ""}
    ${d.cities.length ? `<h4>🏙 Cities (${d.cities.length})</h4>` + d.cities.map(cityRow).join("") : ""}
    ${d.colonies.length ? `<h4>🪐 Colonies (${d.colonies.length})</h4>` + d.colonies.map(colRow).join("") : ""}
    <button class="btn primary" data-close style="margin-top:10px">Close</button>`);
}

// ============ LOG / TOAST / MODAL ============
function renderLog() {
  const feed = $("#logfeed");
  feed.innerHTML = G.log.slice(-9).map(l => `<div class="logline ${l.c}"><i>Y${l.t}</i> ${esc(l.x)}</div>`).join("");
  feed.scrollTop = feed.scrollHeight;
}
let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = "none"; }, 3200);
}
let modalCloseCb = null;
function openModal(html, onClose) {
  modalCloseCb = onClose || null;
  $("#modal-inner").innerHTML = html;
  $("#modal").style.display = "flex";
  $$("#modal [data-close]").forEach(b => b.onclick = closeModal);
}
function closeModal() {
  $("#modal").style.display = "none";
  const cb = modalCloseCb; modalCloseCb = null;
  if (cb) cb();
  if (typeof maybeShowEraTransition === "function") maybeShowEraTransition();
}

// ============ ERA TRANSITIONS (Part 3 §4) ============
// Entering a new era is a moment: fanfare, a themed overlay listing what the
// age brings, an era-tinted interface, and restyled roads/lights/city markers.
const ERA_FLAVOR = [null, "",
  "Stone gives way to bronze. Writing, planted fields and the first true armies appear.",
  "Castles rise, guilds bargain, and steel settles arguments.",
  "Steam and smoke: factories thunder, railways stitch the provinces together and gaslight flickers in the streets.",
  "Electricity floods the cities. Highways, tanks and aircraft redraw the rules of war.",
  "The world becomes a network. Information — and precision missiles — move at the speed of light.",
  "Energy weapons hum, hover armour drifts over old borders, and cities shine like circuit boards.",
  "The sky is no longer a ceiling. A Space Program can carry your nation to other worlds.",
  "Your civilisation begins engineering on the scale of stars themselves.",
];
const ERA_SIGHTS = [null, "",
  "", "",
  "Watch the map: your roads gain railways, and your cities grow smokestacks.",
  "At night your cities now blaze with electric light, and your roads become marked highways.",
  "Brighter city lights, wider highways — and new vehicle silhouettes on the battlefield.",
  "Your roads become glowing transit lines and your cities light up in neon.",
  "Your cities become glowing arcologies. Build a 🚀 Space Program, then spacecraft, and press 🌌 Go to Space.",
  "Megastructures await in the space view: the ☀ Dyson Sphere, ⭕ Halo Rings and the 🌠 Star Destroyer.",
];
let pendingEra = null;
function applyEraTheme(era) { document.body.dataset.era = era || ""; }
function queueEraCelebration(era) {
  pendingEra = era;
  applyEraTheme(era);
  maybeShowEraTransition();
}
function maybeShowEraTransition() {
  if (pendingEra == null || screen !== "game") return;
  if ($("#modal").style.display === "flex") return; // let the open dialog finish first
  const e = pendingEra;
  pendingEra = null;
  showEraTransition(e);
}
function showEraTransition(era) {
  const units = Object.keys(UNITS).filter(u => UNITS[u].e === era).slice(0, 7);
  const blds = Object.keys(BLDGS).filter(b => BLDGS[b].tech && techById(BLDGS[b].tech) && techById(BLDGS[b].tech).e === era).slice(0, 7);
  const sights = ERA_SIGHTS[era] || "";
  openModal(`
    <div class="era-big">${ERAS[era].icon}</div>
    <h2>${esc(ERAS[era].n)}</h2>
    <div class="era-sub">${esc(ERA_FLAVOR[era] || "A new age dawns.")}</div>
    <div class="era-unlocks">
      ${units.length ? `<div><b>New forces:</b> ${units.map(u => `${UNITS[u].icon} ${esc(UNITS[u].n)}`).join(" · ")}</div>` : ""}
      ${blds.length ? `<div><b>New works:</b> ${blds.map(b => `${BLDGS[b].icon} ${esc(BLDGS[b].n)}`).join(" · ")}</div>` : ""}
      ${sights ? `<div><b>On the map:</b> ${esc(sights)}</div>` : ""}
    </div>
    <button class="btn primary" data-close style="text-align:center">${era >= 8 ? "To the stars ▸" : "Lead the way ▸"}</button>`,
    () => {
      const inner = $("#modal-inner");
      inner.classList.remove("era-modal", "space-era");
      maybeShowEraTransition();
    });
  const inner = $("#modal-inner");
  inner.classList.add("era-modal");
  if (era >= 8) inner.classList.add("space-era");
  if (typeof S !== "undefined") S.play("eraBig");
}

function showEvent() {
  const ev = G.eventPending;
  if (!ev) return;
  G.eventPending = null;
  // Sandbox Improvement §11: Auto-Resolve — the event still happens (visible in
  // the log and a toast), but the default option is taken with no pop-up, no
  // pause and no interruption of fast-forward
  if (sandboxOn("autoEvents")) {
    applyEventChoice(ev, 0);
    toast(`📜 ${ev.ev.n} — auto-resolved: ${ev.ev.ch[0].t}`);
    renderTopbar();
    return;
  }
  if (typeof S !== "undefined") S.play("event");
  openModal(`<h2>${esc(ev.ev.n)}</h2><p>${esc(ev.text)}</p>` +
    ev.ev.ch.map((c, i) => `<button class="btn" data-ev="${i}">${esc(c.t)}</button>`).join(""));
  $$("#modal [data-ev]").forEach(b => b.onclick = () => {
    applyEventChoice(ev, Number(b.dataset.ev));
    closeModal(); renderAll();
  });
}

function showEnd(victory, extra) {
  if (G.victory) G.victory.announced = true;
  const P = G.countries[G.playerId];
  const names = { domination: "Domination Victory", hegemony: "Hegemony Victory", alliance: "Diplomatic Victory", tech: "Technology Victory" };
  if (typeof S !== "undefined") S.play(victory ? "victory" : "defeat");
  if (victory) {
    const v = G.victory;
    const byYou = v.by === G.playerId;
    if (byYou) {
      openModal(`<h2>🏆 ${names[v.type]}</h2>
        <p>${v.type === "tech" ? `${esc(P.name)} reaches the Interplanetary Era — the first civilisation to touch the stars.` :
           v.type === "domination" ? "No free nation remains to oppose you. The world is yours." :
           v.type === "hegemony" ? "You control the majority of the world's nations." :
           "The great alliance you forged now spans the world."}</p>
        <button class="btn primary" data-close>Continue playing</button>
        <button class="btn" id="end-menu">Main menu</button>`);
    } else {
      openModal(`<h2>💀 ${names[v.type]} — ${esc(G.countries[v.by].name)}</h2>
        <p>${esc(G.countries[v.by].name)} has won the age. Your story continues only as a footnote… unless you fight on.</p>
        <button class="btn primary" data-close>Fight on</button>
        <button class="btn" id="end-menu">Main menu</button>`);
    }
  } else {
    // multiplayer defeat (QoL §20): the fallen may spectate or leave
    const mp = typeof NET !== "undefined" && NET.active && NET.started;
    openModal(`<h2>💀 Defeat</h2><p>${esc(extra || "Your nation has fallen.")}</p>
      ${mp ? `<p class="dim small">You were eliminated through conquest. You may keep watching the world unfold as a spectator — without influencing it — or leave the game.</p>
              <button class="btn primary" id="end-spectate">👁 Continue as spectator</button>` : ""}
      <button class="btn" id="end-menu">${mp ? "Leave the game" : "Main menu"}</button>`);
    const sp = $("#end-spectate");
    if (sp) sp.onclick = () => { closeModal(); toast("👁 Spectating — you can watch, but no longer act."); };
  }
  const b = $("#end-menu");
  if (b) b.onclick = () => {
    if (typeof NET !== "undefined" && NET.active) { if (typeof netLeave === "function") netLeave(); else location.reload(); return; }
    clearSave(); location.reload();
  };
}

// ============ BOOT ============
window.addEventListener("DOMContentLoaded", () => {
  // BUG 2: a stalled start must end in an explanation, never an eternal spinner
  const bootWatchdog = setTimeout(() => {
    loadFail("Loading is taking far too long — a slow connection or a missing file. Retry, and make sure every game file is present.");
  }, 25000);
  // errors that would otherwise hide behind the loading screen become visible
  window.addEventListener("error", e => {
    loadFail("Startup error: " + (e.message || "unknown") +
      (e.filename ? ` (${String(e.filename).split("/").pop()}:${e.lineno})` : ""));
  });
  bootAssets(() => {
    clearTimeout(bootWatchdog);
    // the overlay hides LAST: a throw in any init below now surfaces as a
    // visible LOADING FAILED instead of a pretty menu with dead buttons
    loadStep("Starting main menu…");
    initViewport();
    initMenu();
    applyQuality(); // BUG 2: automatic performance mode for mobile devices
    repaintTint();
    fitView();
    show("menu");
    $("#loading").style.display = "none";
    if (window.BOOT) window.BOOT.done(); // cancels the inline last-resort watchdog
  });
  const sideT = document.getElementById("side-toggle");
  if (sideT) sideT.onclick = () => document.body.classList.toggle("sb-open");
  window.addEventListener("mousedown", () => { if (typeof S !== "undefined") S.unlock(); }, { once: true });
  window.addEventListener("touchstart", () => { if (typeof S !== "undefined") S.unlock(); }, { once: true });
});
