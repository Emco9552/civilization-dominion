// ============================================================
// CIVILIZATION: DOMINION — sound (WebAudio, fully synthesized)
// ============================================================
"use strict";

const S = (() => {
  let ctx = null, master = null;
  let muted = false;
  try { muted = localStorage.getItem("civdom_muted") === "1"; } catch (e) {}

  function ensure() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return true; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      return true;
    } catch (e) { return false; }
  }

  function tone(freq, dur, opts) {
    if (!ensure() || muted) return;
    const o = opts || {};
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || "sine";
    const t = ctx.currentTime + (o.delay || 0);
    osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t + dur);
    const v = o.vol || 0.2;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + (o.att || 0.005));
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  function noise(dur, opts) {
    if (!ensure() || muted) return;
    const o = opts || {};
    const t = ctx.currentTime + (o.delay || 0);
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = o.hp ? "highpass" : "lowpass";
    f.frequency.value = o.freq || 800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.vol || 0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  }

  function chord(freqs, dur, type, vol, gap) {
    freqs.forEach((f, i) => tone(f, dur, { type: type || "sine", vol: vol || 0.12, delay: (gap || 0.09) * i }));
  }

  const fx = {
    click:      () => tone(680, 0.06, { type: "square", vol: 0.05 }),
    move:       () => { tone(340, 0.07, { type: "square", vol: 0.06 }); tone(430, 0.06, { type: "square", vol: 0.05, delay: 0.06 }); },
    recruit:    () => { noise(0.12, { freq: 500, vol: 0.15 }); tone(196, 0.18, { type: "triangle", vol: 0.18 }); tone(294, 0.2, { type: "triangle", vol: 0.14, delay: 0.09 }); },
    endturn:    () => { tone(520, 0.08, { type: "sine", vol: 0.1 }); tone(780, 0.12, { type: "sine", vol: 0.09, delay: 0.07 }); },
    research:   () => chord([523, 659, 784], 0.35, "sine", 0.1),
    era:        () => chord([392, 494, 587, 784], 0.6, "triangle", 0.12, 0.13),
    eraBig:     () => { chord([196, 262, 330, 392], 1.0, "triangle", 0.12, 0.16); chord([523, 659, 784, 1047], 0.9, "sine", 0.09, 0.14); noise(1.2, { freq: 900, hp: 1, vol: 0.03, delay: 0.3 }); },
    build:      () => { noise(0.06, { freq: 1800, hp: 1, vol: 0.1 }); noise(0.06, { freq: 1800, hp: 1, vol: 0.08, delay: 0.12 }); chord([659, 880], 0.25, "sine", 0.07, 0.08); },
    warhorn:    () => { tone(147, 0.9, { type: "sawtooth", vol: 0.16, att: 0.05 }); tone(110, 1.1, { type: "sawtooth", vol: 0.14, att: 0.05, delay: 0.15 }); noise(0.8, { freq: 300, vol: 0.06, delay: 0.1 }); },
    alarm:      () => { tone(660, 0.14, { type: "square", vol: 0.09 }); tone(520, 0.14, { type: "square", vol: 0.09, delay: 0.16 }); tone(660, 0.14, { type: "square", vol: 0.09, delay: 0.32 }); },
    melee:      () => { noise(0.07, { freq: 2600, hp: 1, vol: 0.08 }); tone(220, 0.05, { type: "square", vol: 0.04 }); },
    arrow:      () => noise(0.1, { freq: 1800, hp: 1, vol: 0.06 }),
    gun:        () => { noise(0.09, { freq: 900, vol: 0.14 }); tone(140, 0.07, { type: "square", vol: 0.06 }); },
    beam:       () => tone(1200, 0.16, { type: "sawtooth", vol: 0.06, slide: 300 }),
    boom:       () => { noise(0.5, { freq: 350, vol: 0.22 }); tone(70, 0.4, { type: "sine", vol: 0.18, slide: 35 }); },
    die:        () => { noise(0.3, { freq: 500, vol: 0.14 }); tone(200, 0.3, { type: "sawtooth", vol: 0.08, slide: 60 }); },
    capture:    () => { chord([392, 523, 659, 784], 0.45, "triangle", 0.12, 0.1); noise(0.25, { freq: 700, vol: 0.08 }); },
    captureFar: () => tone(392, 0.25, { type: "triangle", vol: 0.07 }),
    conquest:   () => chord([262, 330, 392, 523, 659], 0.8, "triangle", 0.13, 0.12),
    victory:    () => chord([392, 494, 587, 784, 988], 1.1, "triangle", 0.14, 0.15),
    defeat:     () => { chord([311, 262, 208, 156], 0.9, "sawtooth", 0.09, 0.22); },
    event:      () => chord([587, 740], 0.3, "sine", 0.1),
    toast:      () => tone(880, 0.08, { type: "sine", vol: 0.05 }),
    coin:       () => { tone(988, 0.1, { type: "square", vol: 0.05 }); tone(1319, 0.14, { type: "square", vol: 0.05, delay: 0.06 }); },
    shell:      () => { tone(900, 0.25, { type: "sine", vol: 0.04, slide: 300 }); noise(0.22, { freq: 420, vol: 0.16, delay: 0.28 }); tone(90, 0.2, { type: "sine", vol: 0.1, slide: 45, delay: 0.28 }); },
    rail:       () => { tone(2200, 0.12, { type: "sawtooth", vol: 0.07, slide: 700 }); noise(0.1, { freq: 3200, hp: 1, vol: 0.08 }); tone(120, 0.14, { type: "square", vol: 0.06, delay: 0.05 }); },
    launch:     () => { noise(0.9, { freq: 600, vol: 0.16 }); tone(90, 0.9, { type: "sawtooth", vol: 0.1, slide: 260, att: 0.08 }); noise(0.5, { freq: 1400, hp: 1, vol: 0.05, delay: 0.15 }); },
    mBoom:      () => { noise(0.7, { freq: 300, vol: 0.28 }); tone(60, 0.55, { type: "sine", vol: 0.22, slide: 30 }); noise(0.35, { freq: 1200, hp: 1, vol: 0.08 }); },
    nukeBoom:   () => { noise(1.6, { freq: 200, vol: 0.34 }); tone(45, 1.4, { type: "sine", vol: 0.26, slide: 22 }); noise(1.0, { freq: 90, vol: 0.2, delay: 0.35 }); tone(30, 1.8, { type: "sine", vol: 0.14, slide: 18, delay: 0.5 }); },
    intercept:  () => { noise(0.16, { freq: 2600, hp: 1, vol: 0.12 }); tone(1500, 0.2, { type: "square", vol: 0.06, slide: 500 }); noise(0.25, { freq: 700, vol: 0.1, delay: 0.08 }); },
  };

  // The old droning "ambient pad" (four endless sine oscillators) is GONE
  // (Space Update 2 Part 8). The era/war music below is the only background
  // track; the 🎵 button toggles it and the 🔊 button controls all audio.

  // ---- procedural era & war music (QoL update §21) ----
  // Fully synthesized, no audio files: each era group has its own scale,
  // tempo and timbre; war swaps in driving percussion and a minor pulse that
  // grows with the scale of the conflict. Crossfades when the state changes.
  const music = (() => {
    let on = true;
    try { on = localStorage.getItem("civdom_music") !== "0"; } catch (e) {}
    let mGain = null, timer = null, step = 0, nextT = 0;
    let cur = { era: 1, war: false, intensity: 1 };
    const N = f => f; // semitone helper below works in Hz directly
    const scale = (root, steps) => steps.map(s => root * Math.pow(2, s / 12));
    // era styles: [scale notes], seconds-per-step, lead wave, bass wave, drums
    const STYLES = {
      tribal:     { sc: scale(196, [0, 3, 5, 7, 10]),          spb: 0.42, lead: "triangle", bass: "sine",     drums: "toms",  leadVol: 0.05, dens: 0.35 },
      ancient:    { sc: scale(220, [0, 2, 3, 7, 8, 12]),       spb: 0.40, lead: "triangle", bass: "triangle", drums: null,    leadVol: 0.05, dens: 0.4 },
      medieval:   { sc: scale(196, [0, 2, 3, 5, 7, 10, 12]),   spb: 0.36, lead: "triangle", bass: "triangle", drums: null,    leadVol: 0.055, dens: 0.45 },
      industrial: { sc: scale(147, [0, 3, 5, 7, 10, 12]),      spb: 0.30, lead: "square",   bass: "square",   drums: "hats",  leadVol: 0.03, dens: 0.5 },
      modern:     { sc: scale(220, [0, 4, 7, 11, 14]),         spb: 0.34, lead: "sine",     bass: "triangle", drums: "hats",  leadVol: 0.055, dens: 0.45 },
      information:{ sc: scale(233, [0, 3, 7, 10, 12, 15]),     spb: 0.22, lead: "square",   bass: "sawtooth", drums: "hats",  leadVol: 0.025, dens: 0.55 },
      futuristic: { sc: scale(261, [0, 4, 6, 7, 11, 12]),      spb: 0.5,  lead: "sine",     bass: "sine",     drums: null,    leadVol: 0.06, dens: 0.35 },
      cosmic:     { sc: scale(130, [0, 7, 12, 16, 19, 24]),    spb: 0.55, lead: "sine",     bass: "sine",     drums: "deep",  leadVol: 0.065, dens: 0.4 },
      war:        { sc: scale(110, [0, 2, 3, 5, 6]),           spb: 0.24, lead: "sawtooth", bass: "square",   drums: "war",   leadVol: 0.03, dens: 0.5 },
    };
    function styleFor(era, war) {
      if (war) return STYLES.war;
      if (era <= 1) return STYLES.tribal;
      if (era === 2) return STYLES.ancient;
      if (era === 3) return STYLES.medieval;
      if (era === 4) return STYLES.industrial;
      if (era === 5) return STYLES.modern;
      if (era === 6) return STYLES.information;
      if (era === 7) return STYLES.futuristic;
      return STYLES.cosmic;
    }
    function ensureM() {
      if (!ensure()) return false;
      if (!mGain) {
        mGain = ctx.createGain();
        mGain.gain.value = 0.9;
        mGain.connect(master);
      }
      return true;
    }
    function mNote(freq, t, dur, type, vol) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(mGain);
      o.start(t); o.stop(t + dur + 0.05);
    }
    function mThump(t, freq, vol, dur) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(25, freq * 0.4), t + (dur || 0.16));
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (dur || 0.18));
      o.connect(g); g.connect(mGain);
      o.start(t); o.stop(t + (dur || 0.2) + 0.05);
    }
    function mHat(t, vol) {
      const len = Math.floor(ctx.sampleRate * 0.05);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 5500;
      const g = ctx.createGain(); g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(mGain);
      src.start(t);
    }
    // deterministic per-step randomness so the melody feels composed
    function h(i, k) { const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return s - Math.floor(s); }
    function playStep(s, i, t) {
      const beat = i % 8;
      const bar = (i / 8) | 0;
      const inten = cur.war ? cur.intensity : 1;
      // bass root movement per bar
      if (beat === 0) {
        const root = s.sc[[0, 3, 1, 2][bar % 4] % s.sc.length] / 2;
        mNote(root, t, s.spb * (cur.war ? 3.5 : 7.5), s.bass, cur.war ? 0.05 + inten * 0.012 : 0.045);
        if (cur.war) mNote(root * 1.5, t, s.spb * 3.5, s.bass, 0.02);
      }
      if (cur.war && beat === 4) mNote(s.sc[0] / 2, t, s.spb * 3, s.bass, 0.05);
      // melody / arps
      if (h(i, 1) < s.dens) {
        const deg = Math.floor(h(bar, 2) * 2 + h(i, 3) * (s.sc.length - 1));
        const oct = h(i, 4) < 0.25 ? 2 : 1;
        mNote(s.sc[deg % s.sc.length] * oct, t, s.spb * (2 + h(i, 5) * 3), s.lead, s.leadVol);
      }
      // pads for slow styles
      if ((s === STYLES.futuristic || s === STYLES.cosmic || s === STYLES.modern) && i % 16 === 0) {
        const r = s.sc[(bar * 2) % s.sc.length];
        mNote(r, t, s.spb * 14, "sine", 0.035);
        mNote(r * 1.498, t, s.spb * 14, "sine", 0.028);
      }
      // drums
      if (s.drums === "toms") {
        if (beat === 0 || beat === 3 || (beat === 5 && h(i, 6) < 0.5)) mThump(t, 88, 0.11, 0.2);
      } else if (s.drums === "hats") {
        if (beat % 2 === 0) mHat(t, 0.018);
        if (beat === 0) mThump(t, 70, 0.07, 0.14);
      } else if (s.drums === "deep") {
        if (beat === 0 && bar % 2 === 0) mThump(t, 55, 0.12, 0.5);
      } else if (s.drums === "war") {
        if (beat === 0 || beat === 4) mThump(t, 75, 0.13 + inten * 0.02, 0.16);
        if (beat === 2 || beat === 6 || (inten >= 2 && beat === 7)) mThump(t, 130, 0.07, 0.1);
        if (inten >= 2 && beat % 2 === 1) mHat(t, 0.02);
        if (inten >= 3 && beat === 6) mThump(t, 50, 0.1, 0.3);
      }
    }
    function schedule() {
      if (!on || muted || !ctx || document.hidden) return;
      const s = styleFor(cur.era, cur.war);
      if (nextT < ctx.currentTime - 0.5) { nextT = ctx.currentTime + 0.05; } // resync after a stall
      while (nextT < ctx.currentTime + 1.2) {
        try { playStep(s, step, nextT); } catch (e) {}
        nextT += s.spb;
        step++;
      }
    }
    return {
      start() {
        if (!on || !ensureM()) return;
        if (timer) return;
        nextT = 0; step = 0;
        timer = setInterval(schedule, 350);
      },
      stop() { if (timer) { clearInterval(timer); timer = null; } },
      set(era, war, intensity) {
        if (era === cur.era && war === cur.war && (intensity || 1) === cur.intensity) return;
        cur = { era, war, intensity: intensity || 1 };
        step = 0; // new theme starts on a downbeat
      },
      // derive the right theme from the game state (era, at war, war scale)
      check() {
        if (typeof G === "undefined" || !G || !G.countries || !G.countries[G.playerId]) return;
        const P = G.countries[G.playerId];
        // wars against a DEFEATED alien civilization linger until its remnants
        // are hunted down — they shouldn't keep the battle theme going
        const fallen = id => ((G.space && G.space.aliens) || []).some(a => a.defeated && a.aid === id);
        const wars = G.wars.filter(w => !fallen(w.a) && !fallen(w.b));
        const myWars = wars.filter(w => w.a === G.playerId || w.b === G.playerId).length;
        let allyWars = 0;
        for (const p of G.alliances || []) {
          if (!p.includes(G.playerId)) continue;
          const ally = p[0] === G.playerId ? p[1] : p[0];
          allyWars += wars.filter(w => w.a === ally || w.b === ally).length;
        }
        const intensity = myWars ? (myWars >= 3 || allyWars >= 2 ? 3 : myWars >= 2 ? 2 : 1) : 1;
        this.set(P.era, myWars > 0, intensity);
      },
      get on() { return on; },
      toggle() {
        on = !on;
        try { localStorage.setItem("civdom_music", on ? "1" : "0"); } catch (e) {}
        if (on) this.start(); else this.stop();
        return on;
      },
    };
  })();

  return {
    play(name) { if (fx[name]) { try { fx[name](); } catch (e) {} } },
    ambient() { try { music.check(); music.start(); } catch (e) {} }, // music only — the buzzing pad is history
    unlock() { ensure(); },
    music,
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      try { localStorage.setItem("civdom_muted", muted ? "1" : "0"); } catch (e) {}
      return muted;
    },
  };
})();
