/* ==========================================================================
   JOYEUX 23ᵉ ANNIVERSAIRE, ASHLEY ✨
   --------------------------------------------------------------------------
   Moteur d'animation Canvas (étoiles / particules / formation de texte)
   + Sound design Web Audio (carillons, whoosh, piste de fond)
   + Orchestration scénaristique pas à pas.
   Aucune dépendance externe : JavaScript ES6+ pur.
   ========================================================================== */

'use strict';

/* ==========================================================================
   0. HELPERS & CONFIGURATION
   ========================================================================== */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/* Animation réduite (accessibilité) */
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Texte actuellement formé sur le canvas (pour re-échantillonnage au resize) */
let currentForm = null;

/* La strophe affichée déborde-t-elle de la carte ? (pour l'avance au scroll) */
let poemOverflowing = false;

/* Précharge la police Cinzel pour un échantillonnage fidèle, sans jamais bloquer */
function preloadFonts(timeout = 2500) {
  try {
    if (document.fonts && typeof document.fonts.load === 'function') {
      return Promise.race([
        document.fonts.load('700 120px Cinzel').catch(() => {}),
        new Promise((r) => setTimeout(r, timeout)),
      ]);
    }
  } catch (e) { /* vieux navigateurs : pas de FontFaceSet */ }
  return Promise.resolve();
}

/* Contrôleur de "skip" : permet d'accélérer le typewriter en un tap */
function buildSkip() {
  const fns = new Set();
  return {
    add: (fn) => fns.add(fn),
    remove: (fn) => fns.delete(fn),
    fire: () => fns.forEach((fn) => fn()),
  };
}

/* Palette : or dominant, avec éclats blancs, violets et roses */
const COLORS = ['#fef08a', '#fff7cc', '#fde68a', '#f8fafc', '#c7d2fe', '#a78bfa', '#f9a8d4'];

/* ==========================================================================
   1. RÉFÉRENCES DOM
   ========================================================================== */
const el = {
  canvas: $('#sky'),
  boot: $('#screen-boot'),
  intro: $('#screen-intro'),
  introLine: $('#intro-line'),
  caret: $('#caret'),
  fallback: $('#fallback-form'),
  poem: $('#screen-poem'),
  poemCard: $('#poem-card'),
  poemTitle: $('#poem-title'),
  poemCount: $('#poem-count'),
  poemLines: $('#poem-lines'),
  poemNext: $('#poem-next'),
  flower: $('#flower'),
  glow: $('#glowlayer'),
  pulse23: $('#pulse23'),
  final: $('#screen-final'),
  finalCard: $('#final-card'),
  replay: $('#replay'),
  hint: $('#hint'),
  music: $('#music'),
};

/* ==========================================================================
   2. WEB AUDIO — Sound design
   --------------------------------------------------------------------------
   Tous les effets sonores sont générés en temps réel (aucun fichier requis).
   La musique de fond : fichier assets/audio/music.mp3 si présent, sinon un
   pad ambiant généré en secours pour ne jamais laisser le site muet.
   ========================================================================== */
const Sound = (() => {
  let ctx = null;
  let master = null;      // bus final
  let noiseBuf = null;    // buffer de bruit blanc réutilisé
  let musicGain = null;   // gain pour la piste (fade-in/out)
  let musicSrc = null;    // source MediaElement
  let padNodes = [];      // nœuds du pad de secours
  let usingPad = false;

  /* Création / reprise du contexte — DOIT être appelé depuis un geste utilisateur */
  function unlock() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 1;
        master.connect(ctx.destination);
        // Pré-génération du buffer de bruit
        const len = ctx.sampleRate * 2;
        noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch (err) {
      console.warn('AudioContext indisponible :', err);
    }
  }

  /* Enveloppe d'amplitude exponentielle (plop sans clic) */
  function env(gain, peak, dur, when = 0) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime + when);
    g.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
    return g;
  }

  /* Carillon céleste — sinusoïdes + harmoniques brillantes */
  function chime(freq, vol = 0.12, when = 0) {
    if (!ctx) return;
    const parts = [1, 2.01, 3.05];
    parts.forEach((mult, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = freq * mult;
      const g = env(vol / (i + 1), 1.4, when);
      o.connect(g); g.connect(master);
      o.start(ctx.currentTime + when);
      o.stop(ctx.currentTime + when + 1.6);
    });
  }

  /* Carillons pour "scintillements" */
  function sparkle() {
    const base = rand(1800, 2600);
    [0, 0.07, 0.15].forEach((d, i) => chime(base * Math.pow(1.25, i), 0.07, d));
  }

  /* Arpège magique (cristal) — au moment où le prénom se forme */
  function shimmer() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]; // Do Mi Sol Do Mi
    notes.forEach((f, i) => chime(f, 0.11, i * 0.16));
  }

  /* Whoosh féérique (transition, premier geste) */
  function whoosh(dur = 1.6, vol = 0.18) {
    if (!ctx || !noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(300, ctx.currentTime);
    bp.frequency.exponentialRampToValueAtTime(3200, ctx.currentTime + dur * 0.55);
    bp.frequency.exponentialRampToValueAtTime(250, ctx.currentTime + dur);
    const g = env(vol, dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(); src.stop(ctx.currentTime + dur + 0.1);
  }

  /* Bruit de "page qui tourne" — navigation du poème (aérien et doux) */
  function pageTurn() {
    if (!ctx || !noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1200;
    const g = ctx.createGain();
    const t0 = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.02, t0 + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
    src.connect(hp); hp.connect(g); g.connect(master);
    src.start(); src.stop(t0 + 0.7);
  }

  /* Confettis dorés — petites notes éparses */
  function diplomaChime() {
    const base = rand(900, 1400);
    chime(base, 0.05); chime(base * 1.5, 0.04, 0.09); chime(base * 2, 0.035, 0.18);
  }

  /* ---------- Musique de fond ---------- */
  function initMusic() {
    if (!ctx || musicGain) return;
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.0001;
    musicGain.connect(master);
    // Enveloppe la balise <audio> pour un contrôle de volume doux
    musicSrc = ctx.createMediaElementSource(el.music);
    musicSrc.connect(musicGain);
  }

  function startMusic() {
    if (!ctx) return;
    initMusic();
    const p = el.music.play();
    if (p) p.catch(() => { /* sera géré par 'error' + secours pad */ });
    fadeMusic(0.9, 7); // fade-in très progressif
  }

  function fadeMusic(target, seconds) {
    if (!musicGain) return;
    const t = ctx.currentTime;
    musicGain.gain.cancelScheduledValues(t);
    musicGain.gain.setValueAtTime(musicGain.gain.value, t);
    musicGain.gain.linearRampToValueAtTime(target, t + seconds);
  }

  /* Pad ambiant de secours (si la musique n'est pas chargée) */
  function startPad() {
    if (!ctx || usingPad) return;
    usingPad = true;
    const mk = (freq, detune, type) => {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = freq; o.detune.value = detune;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 2;
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 6);
      o.connect(f); f.connect(g); g.connect(master);
      o.start();
      return { o, g };
    };
    // Accord doux de LA majeur (La3 + Mi4) avec dérive lente
    padNodes.push(mk(220, 0, 'sine'));
    padNodes.push(mk(329.63, 4, 'sine'));
    padNodes.push(mk(659.26, -3, 'sine'));
    // LFO lent sur le gain → respiration naturelle
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.02;
    lfo.connect(lfoG);
    padNodes.forEach((n) => lfoG.connect(n.g.gain));
    lfo.start();
  }

  function stopPad() {
    padNodes.forEach((n) => {
      try { n.o.stop(); } catch (e) {}
      n.g.disconnect();
    });
    padNodes = [];
    usingPad = false;
  }

  return (() => {
    // EXPOSITION PROTÉGÉE : aucune erreur audio ne doit jamais bloquer
    // le déroulement visuel de l'expérience.
    const raw = { unlock, chime, sparkle, shimmer, whoosh, pageTurn, diplomaChime, startMusic, fadeMusic, startPad, stopPad };
    const api = {};
    Object.keys(raw).forEach((k) => {
      api[k] = (...args) => {
        try { return raw[k](...args); }
        catch (err) { console.warn('WebAudio[' + k + ']', err); }
      };
    });
    return api;
  })();
})();

/* ==========================================================================
   3. MOTEUR D'ÉTOILES (Canvas)
   --------------------------------------------------------------------------
   - Piscine d'étoiles persistantes (dérive douce)
   - Mode "formation de texte" : chaque étoile rejoint une cible
   - Effets transitoires : poussière d'étoiles, météores, confettis
   ========================================================================== */
const Sky = (() => {
  const c = el.canvas;
  const x = c.getContext('2d');
  let W = 0, H = 0, DPR = 1;

  /* Paramètres d'exposition — adaptés à l'écran */
  const maxStars = REDUCED ? 500 : 2200;
  const minStars = 380;

  let stars = [];
  let fx = { dust: [], meteors: [], confetti: [] };

  /* Formation de texte */
  let forming = null;   // { pts, bbox } ou null

  /* Interaction : les étoiles fuient doucement le doigt/curseur */
  let pointer = { active: false, x: -9999, y: -9999 };

  function resize() {
    DPR = clamp(window.devicePixelRatio || 1, 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    c.width = Math.round(W * DPR);
    c.height = Math.round(H * DPR);
    x.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function targetCount() {
    return clamp(Math.round((W * H) / 2100), minStars, maxStars);
  }

  function makeStar(randPos = true) {
    const z = rand(0.4, 1.4); // profondeur (parallaxe)
    return {
      x: randPos ? rand(0, W) : W / 2 + rand(-60, 60),
      y: randPos ? rand(0, H) : H / 2 + rand(-60, 60),
      vx: 0, vy: 0,
      z,
      r: rand(0.6, 2.1) * z,
      base: rand(0.25, 0.95),
      phase: rand(0, TAU),
      tw: rand(0.6, 2.4),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      fad: 0,            // fade d'apparition
      form: 0,           // progression vers la cible (formation)
      target: null,
      settled: false,
    };
  }

  function seed() {
    const n = targetCount();
    stars = [];
    for (let i = 0; i < n; i++) stars.push(makeStar(true));
  }

  /* Étoile supplémentaire isolée (naissance "une par une") */
  function addStarAt(xP, yP) {
    const s = makeStar(false);
    s.x = xP; s.y = yP;
    stars.push(s);
    if (stars.length > maxStars * 1.2) stars.splice(0, stars.length - maxStars * 1.2);
  }

  /* ------------------------------------------------------------------
     3a. ÉCHANTILLONNAGE DU TEXTE → points-cibles
     ------------------------------------------------------------------ */
  function sampleText(text, { maxW = 0.76 * W, maxH = 0.5 * H, font = 'Cinzel', weight = 700 } = {}) {
    const off = document.createElement('canvas');
    const o = off.getContext('2d');

    // Ajuste la taille de police pour tenir dans l'écran
    let size = 40;
    const fit = (sz) => {
      o.font = `${weight} ${sz}px ${font}, serif`;
      return o.measureText(text).width;
    };
    while (fit(size) < maxW * 0.7 && size < 400) size += 6;
    let px = size * 1.35;
    if (px > maxH) { size *= maxH / px; px = maxH; }
    const wText = fit(size);

    const pad = 10;
    const cw = Math.ceil(wText) + pad * 2;
    const ch = Math.ceil(px) + pad * 2;
    off.width = cw; off.height = ch;

    o.font = `${weight} ${size}px ${font}, serif`;
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    o.fillStyle = '#fff';
    o.fillText(text, cw / 2, ch / 2);

    const img = o.getImageData(0, 0, cw, ch).data;
    const pts = [];
    let step = 2; // pas d'échantillonnage adaptatif
    const wanted = targetCount() * 1.0;
    for (let y = 0; y < ch; y += step) {
      for (let tx = 0; tx < cw; tx += step) {
        const a = img[(y * cw + tx) * 4 + 3];
        if (a > 110) pts.push({ x: tx - cw / 2, y: y - ch / 2 });
      }
    }
    // Décime aléatoirement si trop de points pour la taille de la piscine
    if (pts.length > wanted) {
      for (let i = pts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = pts[i]; pts[i] = pts[j]; pts[j] = tmp;
      }
      pts.length = Math.round(wanted);
    }
    return {
      pts,
      bbox: { cx: 0, cy: 0, w: cw, h: ch },
      size,
    };
  }

  /* Formation : assigne une cible à chaque étoile */
  function formText(data) {
    forming = data;
    const pts = data.pts;
    // Crée des étoiles supplémentaires si nécessaire (au maximum raisonnable)
    while (stars.length < Math.min(pts.length, maxStars)) {
      stars.push(makeStar(false));
    }
    const shuf = pts.slice().sort(() => Math.random() - 0.5);
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      s.target = shuf[i % shuf.length];
      s.form = 0;
      s.settled = false;
      s.ox = s.x; s.oy = s.y;
    }
  }

  function clearForm() {
    if (forming) {
      // Dissolution : petite impulsion vers l'extérieur
      stars.forEach((s) => {
        if (s.target) {
          s.vx = (s.x - W / 2) * 0.04 + rand(-0.6, 0.6);
          s.vy = (s.y - H / 2) * 0.04 + rand(-0.6, 0.6);
        }
        s.target = null;
        s.form = 0;
      });
    }
    forming = null;
  }

  /* ------------------------------------------------------------------
     3b. EFFETS TRANSITOIRES
     ------------------------------------------------------------------ */
  function spawnDust() {
    const n = Math.round(rand(1, 4));
    for (let i = 0; i < n; i++) {
      fx.dust.push({
        x: rand(0, W),
        y: -8,
        z: rand(0.3, 1.2),
        vy: rand(0.5, 1.8),
        r: rand(0.6, 1.8) * 0.7,
        a: rand(0.3, 0.9),
        color: COLORS[Math.floor(Math.random() * 3)],
        life: rand(300, 700),
      });
    }
  }

  function spawnMeteor(from, to, delay = 0) {
    fx.meteors.push({
      x: from[0], y: from[1],
      tx: to[0], ty: to[1],
      t: 0, delay,
      life: 1,       // progrès 0→1
      color: Math.random() > 0.35 ? '#fef08a' : '#a78bfa',
      len: rand(60, 130),
    });
  }

  function spawnConfetti() {
    for (let i = 0; i < 26; i++) {
      fx.confetti.push({
        x: rand(0, W),
        y: -rand(10, 120),
        vx: rand(-0.5, 0.5),
        vy: rand(1.2, 3),
        rot: rand(0, TAU),
        vr: rand(-0.12, 0.12),
        w: rand(2, 5),
        h: rand(6, 13),
        color: ['#fef08a', '#fcd34d', '#fff7cc', '#a78bfa'][Math.floor(Math.random() * 4)],
        life: rand(90, 170),
        sway: rand(0, TAU),
      });
    }
  }

  /* ------------------------------------------------------------------
     3c. BOUCLE DE RENDU
     ------------------------------------------------------------------ */
  let now = 0;

  function update() {
    now += 0.016;
    const t = now;

    /* Étoiles */
    for (const s of stars) {
      s.fad = Math.min(1, s.fad + 0.02);

      if (forming && s.target) {
        /* --- Mode formation : approche + micro-orbite --- */
        const dx = s.target.x - s.x;
        const dy = s.target.y - s.y;
        const dist = Math.hypot(dx, dy);
        s.x += dx * 0.07 + Math.sin(t * 0.9 + s.phase) * 0.12;
        s.y += dy * 0.07 + Math.cos(t * 0.8 + s.phase) * 0.12;
        s.form = dist < 1.5 ? 1 : s.form;
      } else {
        /* --- Mode dérive : marche aléatoire douce (parallaxe) --- */
        s.vx += (Math.sin(t * 0.25 + s.phase) * 0.12 - s.vx * 0.02) * s.z;
        s.vy += (Math.cos(t * 0.22 + s.phase) * 0.1 - s.vy * 0.02) * s.z;
        // Répulsion au doigt / curseur
        if (pointer.active) {
          const dx = s.x - pointer.x;
          const dy = s.y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 8100 && d2 > 0.01) {
            const f = (8100 - d2) / 8100 * 0.35;
            const d = Math.sqrt(d2);
            s.vx += (dx / d) * f;
            s.vy += (dy / d) * f;
          }
        }
        s.x += s.vx; s.y += s.vy;
        // Reste dans le cadre
        if (s.x < -20) s.x = W + 20;
        if (s.x > W + 20) s.x = -20;
        if (s.y < -20) s.y = H + 20;
        if (s.y > H + 20) s.y = -20;
      }
    }

    /* Poussière d'étoiles (pluie) */
    for (let i = fx.dust.length - 1; i >= 0; i--) {
      const d = fx.dust[i];
      d.y += d.vy * d.z * 1.6;
      d.x += Math.sin(t * 0.9 + i) * 0.25 * d.z;
      d.life--;
      if (d.life <= 0 || d.y > H + 10) fx.dust.splice(i, 1);
    }

    /* Météores */
    for (let i = fx.meteors.length - 1; i >= 0; i--) {
      const m = fx.meteors[i];
      if (m.delay > 0) { m.delay -= 0.016; continue; }
      m.t += 0.012;
      if (m.t >= 1) { fx.meteors.splice(i, 1); continue; }
    }

    /* Confettis */
    for (let i = fx.confetti.length - 1; i >= 0; i--) {
      const cf = fx.confetti[i];
      cf.vy += 0.02;
      cf.x += cf.vx + Math.sin(cf.sway + t * 2) * 0.5;
      cf.y += cf.vy;
      cf.rot += cf.vr;
      cf.life--;
      if (cf.life <= 0 || cf.y > H + 20) fx.confetti.splice(i, 1);
    }

    /* Pluie de poussière d'étoiles (pendant l'intro) */
    if (rainOn) {
      rainTimer += 0.016;
      if (rainTimer > 0.09) { spawnDust(); rainTimer = 0; }
    }
  }

  function draw() {
    const t = now;
    x.clearRect(0, 0, W, H);

    /* Halo pulsant derrière le texte formé */
    if (forming) {
      const b = forming.bbox;
      const pulse = 1 + Math.sin(t * 2) * 0.06;
      const grad = x.createRadialGradient(0, 0, 0, 0, 0, (b.w * 0.42) * pulse);
      grad.addColorStop(0, 'rgba(254, 240, 138, 0.10)');
      grad.addColorStop(0.5, 'rgba(167, 139, 250, 0.05)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      x.save();
      x.translate(W / 2, H / 2);
      x.fillStyle = grad;
      x.fillRect(-b.w, -b.h, b.w * 2, b.h * 2);
      x.restore();
    }

    /* Étoiles */
    x.globalCompositeOperation = 'lighter';
    const boost = forming ? 1.28 : 1; // étoiles plus affirmées pendant la formation
    for (const s of stars) {
      const tw = 0.55 + 0.45 * Math.sin(t * s.tw + s.phase);
      const a = clamp(s.base * tw * s.fad * boost, 0, 1);
      if (a <= 0.02) continue;
      const r = s.r * (0.7 + tw * 0.7) * boost;

      /* Halo externe */
      x.globalAlpha = a * 0.14;
      x.fillStyle = s.color;
      x.beginPath();
      x.arc(s.x, s.y, r * 3.4, 0, TAU);
      x.fill();

      /* Cœur */
      x.globalAlpha = a;
      x.beginPath();
      x.arc(s.x, s.y, r, 0, TAU);
      x.fill();

      /* Croix de lumière pour les étoiles brillantes */
      if (s.z > 1.15 && !forming) {
        x.globalAlpha = a * 0.35;
        const l = r * 5.2;
        x.fillRect(s.x - l / 2, s.y - 0.6, l, 1.2);
        x.fillRect(s.x - 0.6, s.y - l / 2, 1.2, l);
      }
    }

    /* Poussière d'étoiles */
    for (const d of fx.dust) {
      x.globalAlpha = d.a * 0.8;
      x.fillStyle = d.color;
      x.beginPath();
      x.arc(d.x, d.y, d.r, 0, TAU);
      x.fill();
    }

    /* Météores — traînées */
    for (const m of fx.meteors) {
      if (m.delay > 0) continue;
      const cx = lerp(m.x, m.tx, m.t);
      const cy = lerp(m.y, m.ty, m.t);
      const dx = m.tx - m.x, dy = m.ty - m.y;
      const dl = Math.hypot(dx, dy) || 1;
      const tail = 0.35;
      const tx = cx - (dx / dl) * m.len * tail;
      const ty = cy - (dy / dl) * m.len * tail;
      const grad = x.createLinearGradient(tx, ty, cx, cy);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, m.color);
      x.globalAlpha = Math.max(0, 1 - m.t * 2) * 0.9;
      x.strokeStyle = grad;
      x.lineWidth = 1.6;
      x.lineCap = 'round';
      x.beginPath();
      x.moveTo(tx, ty);
      x.lineTo(cx, cy);
      x.stroke();
    }

    /* Confettis élégants */
    for (const cf of fx.confetti) {
      x.save();
      x.translate(cf.x, cf.y);
      x.rotate(cf.rot);
      x.globalAlpha = Math.min(1, cf.life / 40) * 0.85;
      x.fillStyle = cf.color;
      x.fillRect(-cf.w / 2, -cf.h / 2, cf.w, cf.h);
      x.restore();
    }

    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
  }

  function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
  }

  /* Boucle de pluie de poussière pendant l'intro */
  let rainOn = false;
  let rainTimer = 0;
  function setRain(on) { rainOn = on; }

  /* ------------------ API publique ------------------ */
  return {
    resize, seed, loop,
    addStarAt, formText, clearForm,
    spawnDust, spawnMeteor, spawnConfetti,
    setRain,
    get W() { return W; },
    get H() { return H; },
    set pointerActive(v) { pointer.active = v; },
    set pointerPos(p) { pointer.x = p.x; pointer.y = p.y; },
    get maxStars() { return maxStars; },
  };
})();

/* ==========================================================================
   4. DONNÉES — Le Poème (intégral, issu de conception.md)
   ========================================================================== */
const POEM = [
  {
    title: 'L’Introduction Céleste',
    anim: 'shooting',
    lines: [
      { text: 'À Ashley Julienne Wend Panga Sawadogo', cls: 'name' },
      { text: 'Cette nuit, les étoiles avaient rendez-vous.' },
      { text: 'Elles parlaient d’une lumière qu’aucune constellation ne parvenait à égaler.' },
      { text: 'L’une disait : « Je crois qu’elle habite sur Terre. »' },
      { text: 'Une autre répondit : « Oui... et aujourd’hui est le jour où elle est arrivée parmi nous. »' },
    ],
  },
  {
    title: 'La Douceur & Le Sourire',
    anim: 'glow',
    lines: [
      { text: 'Alors le vent s’est arrêté. La lune a souri.' },
      { text: 'Même le temps a ralenti, simplement pour contempler une nouvelle fois... Ashley.' },
      { text: 'Votre sourire... possède ce drôle de pouvoir de rassurer sans bruit, d’illuminer sans effort, et de rendre les journées un peu plus belles sans même s’en rendre compte.' },
    ],
  },
  {
    title: 'Le Regard, La Timidité & Les Fleurs Rares',
    anim: 'flower',
    lines: [
      { text: 'Votre regard, si discret, cache une douceur que peu de personnes savent réellement voir.' },
      { text: 'Votre timidité n’a jamais été une faiblesse. Elle ressemble davantage à ces fleurs rares qui ne s’ouvrent qu’aux personnes patientes.' },
    ],
  },
  {
    title: 'La Parenthèse Humoristique (Le Vouvoiement)',
    anim: 'treaty',
    lines: [
      { text: 'Votre respect... Ah... Parlons-en.' },
      { text: 'Même moi, vous continuez à me vouvoyer.' },
      { text: 'Je commence sérieusement à croire qu’il faudra un <span class="hl">traité diplomatique<span class="spark">✦</span></span> signé devant notaire pour espérer entendre un simple « tu ».' },
      { text: 'Et finalement... en y réfléchissant... cela vous ressemble parfaitement. Une élégance qui ne cherche jamais à se faire remarquer.' },
    ],
  },
  {
    title: 'La Beauté Intérieure & La Petite Taille',
    anim: 'ange',
    lines: [
      { text: 'Votre écoute, votre calme, votre manière de toujours considérer les autres avant vous-même, racontent une beauté que les yeux seuls ne peuvent pas voir.' },
      { text: 'Puis il y a cette petite taille... qui donne presque l’impression qu’un <span class="ange">ange<span class="ange-star">✦</span></span> a décidé, le temps d’une vie, d’emprunter quelques centimètres de moins pour passer inaperçu.' },
      { text: 'Pourtant... impossible. Les étoiles vous repèrent toujours. Elles jalousent même parfois cette lumière qu’elles ne possèdent pas.' },
    ],
  },
  {
    title: 'La Victoire (Diplôme de Gestion)',
    anim: 'diploma',
    lines: [
      { text: 'Aujourd’hui, une nouvelle page s’ouvre.' },
      { text: 'Vous voilà diplômée en Gestion. Une étape franchie. Une victoire méritée.' },
      { text: 'Et, je n’en doute pas une seule seconde, le début de nombreuses autres.' },
    ],
  },
  {
    title: 'Les Vœux & La Conclusion',
    anim: 'final',
    lines: [
      { text: 'Continuez d’avancer avec cette douceur, cette force tranquille, cette simplicité qui vous rendent si unique.' },
      { text: 'Que cette nouvelle année vous apporte encore plus de rires, encore plus de rêves, encore plus de souvenirs et surtout... tout le bonheur que votre cœur mérite.' },
      { text: 'Parce qu’aujourd’hui... ce n’est pas seulement votre anniversaire. C’est aussi le jour où le monde peut remercier d’avoir eu la chance de vous accueillir.' },
      { text: 'Joyeux anniversaire, Ashley.', cls: 'hero' },
      { text: 'Continuez simplement d’être vous. C’est déjà une très belle façon d’illuminer le monde.' },
    ],
  },
];

/* ==========================================================================
   5. ORCHESTRATION DU SCÉNARIO
   ========================================================================== */
const Stage = (() => {
  let poemIndex = 0;
  let poemUnlocked = false; // débloqué après le premier tap (fin du typewriter)

  /* ---------- Gestion d'écrans ---------- */
  function show(sec) {
    $$('.screen').forEach((s) => s.classList.add('hidden'));
    if (sec) sec.classList.remove('hidden');
  }

  /* ---------- Effet machine à écrire ---------- */
  function typewrite(text, { speed = 38, skip } = {}) {
    return new Promise((resolve) => {
      el.introLine.textContent = '';
      el.introLine.classList.remove('fade-up');
      el.caret.classList.remove('off'); // curseur visible pendant la saisie
      let i = 0;
      const chunk = 1;
      let ff = false;
      const finish = () => {
        el.caret.classList.add('off');
        if (skip) skip.remove(onSkip);
        resolve();
      };
      const onSkip = () => { ff = true; };

      if (skip) skip.add(onSkip);

      const step = () => {
        if (ff) {
          el.introLine.textContent = text;
          finish();
          return;
        }
        i += chunk;
        el.introLine.textContent = text.slice(0, i);
        if (i < text.length) {
          setTimeout(step, REDUCED ? 0 : rand(speed * 0.6, speed * 1.3));
        } else {
          finish();
        }
      };
      step();
    });
  }

  function fadeIntroLineUp() {
    return new Promise((resolve) => {
      el.introLine.classList.add('fade-up');
      setTimeout(resolve, 800);
    });
  }

  /* ---------- Affichage d'une strophe ---------- */
  function renderStrophe(i) {
    const st = POEM[i];
    el.poemCount.textContent = `Strophe ${i + 1} / ${POEM.length}`;
    el.poemTitle.textContent = st.title;

    // Nettoyage des animations de fond précédentes
    el.glow.classList.remove('show');
    el.flower.classList.remove('show');
    el.flower.style.display = '';
    $$('.ange-star').forEach((s) => s.classList.remove('show'));

    el.poemLines.innerHTML = '';
    st.lines.forEach((line, li) => {
      const p = document.createElement('p');
      p.className = 'pl' + (line.cls ? ' ' + line.cls : '');
      p.style.setProperty('--i', li);
      p.innerHTML = line.text; // contenu contrôlé (aucune saisie utilisateur)
      el.poemLines.appendChild(p);
    });

    // Détermine si la strophe déborde (utile pour l'avance au scroll)
    requestAnimationFrame(() => {
      poemOverflowing = el.poemLines.scrollHeight > el.poemLines.clientHeight + 4;
    });

    // Applique les animations de fond associées à la strophe
    setTimeout(() => applyStropheAnim(st.anim), 140);

    // Bouton
    el.poemNext.innerHTML =
      i < POEM.length - 1
        ? 'La suite <span class="btn-arrow">→</span>'
        : 'Découvrir la fin <span class="btn-arrow">✦</span>';
  }

  function applyStropheAnim(anim) {
    switch (anim) {
      case 'shooting':
        // Deux étoiles filantes qui se croisent
        Sky.spawnMeteor([-50, Sky.H * 0.18], [Sky.W * 0.5, Sky.H * 0.28]);
        Sky.spawnMeteor([Sky.W + 40, Sky.H * 0.55], [Sky.W * 0.45, Sky.H * 0.42], 0.6);
        Sound.whoosh(1.4, 0.1);
        break;
      case 'glow':
        el.glow.classList.add('show');
        break;
      case 'flower':
        el.flower.style.display = '';
        el.flower.classList.add('show');
        break;
      case 'treaty':
        // Le mot clé scintille déjà en CSS
        Sound.sparkle();
        break;
      case 'ange':
        // L'étoile descend se poser près du mot "ange"
        setTimeout(() => $$('.ange-star').forEach((s) => s.classList.add('show')), 500);
        Sound.chime(1600, 0.06);
        break;
      case 'diploma':
        // Pluie fine d'étincelles dorées
        Sky.spawnConfetti();
        Sound.diplomaChime();
        setTimeout(() => Sky.spawnConfetti(), 700);
        setTimeout(() => Sky.spawnConfetti(), 1400);
        break;
      case 'final':
        Sound.shimmer();
        break;
    }
  }

  /* ---------- Passe à la strophe suivante ---------- */
  let lastAdvance = 0; // anti double-déclenchement (bouton + tap global)
  function nextStrophe() {
    const nowTap = Date.now();
    if (!poemUnlocked || poemIndex >= POEM.length) return;
    if (nowTap - lastAdvance < 380) return;
    lastAdvance = nowTap;
    poemIndex++;
    if (poemIndex >= POEM.length) {
      // Fin du poème → transition vers le final
      show(null);
      beginFinal();
    } else {
      Sound.pageTurn();
      renderStrophe(poemIndex);
      // Re-scrolle la carte en haut
      el.poemLines.scrollTop = 0;
    }
  }

  /* ---------- PHASE 1 — Intro céleste ---------- */
  async function playIntro(skip) {
    show(el.intro);

    // Les étoiles naissent une par une (3 carillons)
    for (let i = 0; i < 3; i++) {
      Sky.addStarAt(rand(0.12, 0.28) * Sky.W, rand(0.1, 0.3) * Sky.H);
      Sound.chime(rand(1400, 2200), 0.09);
      await wait(REDUCED ? 200 : 1000);
    }
    // Pluie de poussière d'étoiles
    Sky.setRain(true);
    await wait(REDUCED ? 400 : 2800);
    Sky.setRain(false);

    // Phrase 1
    await typewrite('Certaines personnes naissent un jour...', { skip });
    await wait(REDUCED ? 200 : 2200);
    await fadeIntroLineUp();

    // Phrase 2
    await typewrite('...d’autres donnent un peu plus de lumière au monde à la date de leur naissance.', { skip });
    await wait(REDUCED ? 200 : 1800);
    await fadeIntroLineUp();

    // CLIMAX 1 : assemblage du prénom ASHLEY
    await wait(REDUCED ? 100 : 700);
    if (REDUCED) {
      el.fallback.textContent = 'ASHLEY';
      el.fallback.classList.remove('hidden');
    } else {
      await preloadFonts();
      const data = Sky.sampleText('ASHLEY', { font: 'Cinzel' });
      Sky.formText(data);
      currentForm = { text: 'ASHLEY', cfg: { font: 'Cinzel' } };
      Sound.shimmer();
    }
    await wait(REDUCED ? 400 : 3200);

    // Phrase de transition
    el.fallback.classList.add('hidden');
    await typewrite('Aujourd’hui... le ciel a décidé de raconter pourquoi il brille autant.', { skip });
    await wait(REDUCED ? 200 : 1600);
    await fadeIntroLineUp();

    // Le prénom se dissout → place au poème
    Sky.clearForm();
    currentForm = null;
    await wait(500);
    beginPoem();
  }

  /* ---------- PHASE 2 — Le Poème ---------- */
  function beginPoem() {
    poemIndex = 0;
    poemUnlocked = true;
    show(el.poem);
    renderStrophe(0);
    hint('Touche l’écran ou la carte pour avancer');
  }

  /* ---------- PHASE 3 — Le Final ---------- */
  async function beginFinal() {
    el.hint.classList.add('hidden');
    el.pulse23.classList.add('show');
    Sound.fadeMusic(1, 4); // crescendo doux de la musique

    // Les étoiles se rassemblent pour former le 23
    if (REDUCED) {
      el.fallback.textContent = '23';
      el.fallback.classList.remove('hidden');
    } else {
      const data = Sky.sampleText('23', { font: 'Cinzel', maxW: 0.7 * Sky.W, maxH: 0.52 * Sky.H });
      Sky.formText(data);
      currentForm = { text: '23', cfg: { font: 'Cinzel', maxW: 0.7 * Sky.W, maxH: 0.52 * Sky.H } };
      Sound.shimmer();
    }
    await wait(REDUCED ? 400 : 4200);

    // Le 23 se dissipe comme une fumée d'étoiles
    Sky.clearForm();
    currentForm = null;
    el.pulse23.classList.remove('show');
    await wait(700);

    // Carte finale
    el.fallback.classList.add('hidden');
    show(el.final);
    el.finalCard.classList.add('show');
    Sound.whoosh(1.6, 0.14);
    Sound.chime(523.25, 0.08); Sound.chime(659.25, 0.08, 0.12);
  }

  /* ---------- Indice ---------- */
  function hint(text) {
    el.hint.textContent = text;
    el.hint.classList.remove('hidden');
  }

  return { playIntro, beginPoem, beginFinal, nextStrophe, hint, get unlocked() { return poemUnlocked; } };
})();

/* ==========================================================================
   6. INTERACTIONS & DÉMARRAGE
   ========================================================================== */

/* Détection de tap (sans confondre avec un scroll / swipe) */
const gesture = (() => {
  let sx = 0, sy = 0, moved = false;
  window.addEventListener('pointerdown', (e) => {
    sx = e.clientX; sy = e.clientY; moved = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 12) moved = true;
    Sky.pointerActive = true;
    Sky.pointerPos = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('pointerup', () => {
    setTimeout(() => (Sky.pointerActive = false), 300);
  });
  return { isTap: () => !moved };
})();

/* Tap global : avance dans le poème (pointerup + click pour compatibilité maximale) */
const advancePoem = () => {
  if (!Stage.unlocked) return;
  if (el.finalCard.classList.contains('show')) return;
  Stage.nextStrophe();
};
window.addEventListener('pointerup', (e) => {
  if (!gesture.isTap()) return;
  advancePoem();
});
window.addEventListener('click', () => {
  if (!gesture.isTap()) return;
  advancePoem();
});

/* Scroll doux : en atteignant le bas d'une strophe qui déborde → strophe suivante */
el.poemLines.addEventListener('scroll', () => {
  if (!Stage.unlocked || !poemOverflowing) return;
  if (el.poemLines.scrollTop + el.poemLines.clientHeight >= el.poemLines.scrollHeight - 8) {
    Stage.nextStrophe();
  }
});

/* Bouton "La suite" */
el.poemNext.addEventListener('click', (e) => {
  e.stopPropagation();
  Stage.nextStrophe();
});

/* Revoir l'histoire */
el.replay.addEventListener('click', () => location.reload());

/* ---------- Phase 0 — Écran d'accueil ---------- */
let experienceStarted = false;
let skipCtl = buildSkip();
const introSkipListener = () => skipCtl.fire();

/* Premier geste : déverrouille l'audio et démarre l'expérience.
   Toute erreur audio est attrapée : le visuel ne doit JAMAIS être bloqué. */
async function startExperience() {
  if (experienceStarted) return;
  experienceStarted = true;

  try {
    Sound.unlock();
    Sound.whoosh(1.6, 0.14);
  } catch (e) { console.warn(e); }

  el.boot.classList.add('hidden');

  try {
    Sound.startMusic();
    // Secours : pad ambiant si la piste ne se charge pas
    el.music.addEventListener('error', () => Sound.startPad());
    if (el.music.readyState >= 2) Sound.stopPad();
  } catch (e) { console.warn('Musique de fond :', e); }

  // Lancement du scénario ; un tap accélère la saisie pendant l'intro
  Sky.setRain(false);
  Stage.hint('Touche l’écran pour accélérer');
  window.addEventListener('pointerdown', introSkipListener);
  await Stage.playIntro(skipCtl).catch((err) => {
    // Filet de sécurité : même si l'intro échoue, on amène jusqu'au poème
    console.error('Intro interrompue :', err);
    Sky.setRain(false);
    Sky.clearForm();
    Stage.beginPoem();
  });
  window.removeEventListener('pointerdown', introSkipListener);
}

/* Tap sur l'écran d'accueil — multi-événements pour couvrir
   pointer events (iOS 13+ / Android), touchstart et click (anciens navigateurs) */
const bootStart = () => startExperience();
['pointerdown', 'touchstart', 'click'].forEach((ev) => {
  el.boot.addEventListener(ev, bootStart, { passive: true });
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') startExperience();
});

/* ---------- Initialisation du moteur ---------- */
function init() {
  Sky.resize();
  Sky.seed();
  Sky.loop();
  window.addEventListener('resize', () => {
    Sky.resize();
    // Re-échantillonne le texte en cours de formation si besoin
    if (currentForm) {
      Sky.formText(Sky.sampleText(currentForm.text, currentForm.cfg));
    }
  });
  // Touche mobile : cache la répulsion fantôme
  document.addEventListener('touchmove', (e) => {
    Sky.pointerPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
}

/* ---------- Diagnostic discret (ne s'affiche qu'en cas d'erreur) ---------- */
(function debugToast() {
  const host = document.getElementById('err-toast');
  if (!host) return;
  const show = (msg) => {
    host.textContent = '⚠ ' + msg;
    host.classList.add('show');
    clearTimeout(host._t);
    host._t = setTimeout(() => host.classList.remove('show'), 9000);
  };
  window.addEventListener('error', (e) => show(e.message || 'Erreur JavaScript'));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    show(r && r.message ? r.message : String(r));
  });
})();

init();
