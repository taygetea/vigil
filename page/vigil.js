/* vigil — synced lyric renderer: a candle flame that listens.
 *
 * Everything on screen is a pure function of t (seconds) and the song
 * manifest (ground-truth word timing exported by etudes; no alignment).
 * No Math.random, no Date.now — renderFrame(t) is deterministic so the
 * offline frame-stepper (tools/render.mjs) produces identical video on
 * every run. Preview mode drives t from the <audio> clock instead.
 */
"use strict";

const W = 1280, H = 720;
const CX = 640, BASE_Y = 552;          // flame root
const cv = document.getElementById("stage");
const ctx = cv.getContext("2d");

const params = new URLSearchParams(location.search);
const SONG = params.get("song") || "lights_were_on";
const EXPORT = params.get("export") === "1";
if (EXPORT) document.body.classList.add("export");

let M = null;                           // manifest
let textLines = [];                     // lines sung by a lead voice
let klattschSpans = [];                 // [t0, t1] where the ancestor sings

// ---------------------------------------------------------------- helpers

function hash(n) { const s = Math.sin(n) * 43758.5453123; return s - Math.floor(s); }
function noise1(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
}
function fbm(x) {
  return (0.5 * noise1(x) + 0.25 * noise1(x * 2.03 + 17.7)
          + 0.125 * noise1(x * 4.09 + 41.3)) / 0.875;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, u) => a + (b - a) * u;
function smoothstep(a, b, x) {
  const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u);
}

function env(t, arr) {
  if (!arr || !arr.length) return 0;
  return arr[clamp(Math.round(t * M.env_rate), 0, arr.length - 1)];
}

// section -> flame energy (choruses burn brighter; the bridge gutters)
const SECTION_B = { intro: 0.55, verse1: 0.75, pre1: 0.85, chorus1: 1.0,
                    verse2: 0.78, pre2: 0.88, chorus2: 1.02, bridge: 0.62,
                    final1: 1.06, final2: 1.16, outro: 0.6 };

function sectionAt(t) {
  for (const s of M.sections) if (t >= s.t0 && t < s.t1) return s;
  return null;
}

function sectionBrightness(t) {
  const XF = 1.4;                       // crossfade seconds at boundaries
  let b = 0.55;
  for (let i = 0; i < M.sections.length; i++) {
    const s = M.sections[i];
    const bs = SECTION_B[s.name] ?? 0.8;
    if (t >= s.t0 && t < s.t1) {
      b = bs;
      const nxt = M.sections[i + 1];
      if (nxt && t > s.t1 - XF) {
        const bn = SECTION_B[nxt.name] ?? 0.8;
        b = lerp(bs, bn, smoothstep(s.t1 - XF, s.t1, t));
      }
    }
  }
  // after the last section: ember, held — the flame does not go out
  const last = M.sections[M.sections.length - 1];
  if (t >= last.t1) b = 0.35;
  else if (t > last.t1 - 6) b = lerp(SECTION_B[last.name] ?? 0.6, 0.35,
                                     smoothstep(last.t1 - 6, last.t1, t));
  return b;
}

// how strongly the ancestor voice holds the room right now
function gutter(t) {
  let g = 0;
  for (const [a, b] of klattschSpans)
    g = Math.max(g, smoothstep(a - 0.4, a + 0.3, t) *
                    (1 - smoothstep(b, b + 0.9, t)));
  return g;
}

// ---------------------------------------------------------------- flame

function drawFlame(t) {
  const e = env(t, M.env.vox_smooth);
  const transient = clamp(env(t, M.env.vox) - e, 0, 1);
  const b = sectionBrightness(t);
  const g = gutter(t);
  const calm = smoothstep(M.duration_s - 14, M.duration_s - 4, t); // ember calm

  const speed = (1 + 1.9 * g + 1.2 * transient) * (1 - 0.55 * calm);
  const h = (92 + 78 * e) * (0.8 + 0.34 * b) * (1 - 0.52 * g) * (1 - 0.45 * calm);
  const lean = (fbm(t * 0.7 * speed) - 0.5) * 2 * (7 + 26 * g)
             + (fbm(t * 3.1 * speed + 9.1) - 0.5) * 2 * (3 + 11 * transient);
  const w0 = (24 + 10 * e) * (1 - 0.35 * g) * (1 - 0.3 * calm);
  const flick = 0.92 + 0.08 * fbm(t * 7.3 * speed + 3.3);

  // room glow
  const glowR = (300 + 200 * e) * b * (1 - 0.4 * g) * (1 - 0.5 * calm) + 90;
  const gy = BASE_Y - h * 0.55;
  let grad = ctx.createRadialGradient(CX, gy, 10, CX, gy, glowR);
  const warmth = 1 - 0.55 * g;
  grad.addColorStop(0, `rgba(255,${Math.round(168 * warmth + 40)},${Math.round(60 * warmth + 60 * g)},${0.30 * b * flick})`);
  grad.addColorStop(0.5, `rgba(210,${Math.round(120 * warmth + 30)},30,${0.10 * b})`);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // candle body
  const wax = ctx.createLinearGradient(CX - 44, 0, CX + 44, 0);
  wax.addColorStop(0, "#2e2118");
  wax.addColorStop(0.45, `rgb(${86 + 40 * b},${64 + 28 * b},${40 + 16 * b})`);
  wax.addColorStop(1, "#241a12");
  ctx.fillStyle = wax;
  ctx.beginPath();
  ctx.roundRect(CX - 44, BASE_Y + 6, 88, 148, 7);
  ctx.fill();
  ctx.fillStyle = `rgba(255,190,110,${0.13 * b})`;   // lit rim of the wax
  ctx.beginPath();
  ctx.ellipse(CX, BASE_Y + 8, 44, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#1a1208";
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(CX, BASE_Y + 6);
  ctx.lineTo(CX + lean * 0.06, BASE_Y - 12);
  ctx.stroke();

  const tipX = CX + lean, tipY = BASE_Y - h;
  function tongue(scale, fill) {
    const ww = w0 * scale, hh = h * scale;
    const ty = BASE_Y - hh, tx = CX + lean * scale;
    const sway = (fbm(t * 2.2 * speed + scale * 31) - 0.5) * 10 * scale;
    ctx.beginPath();
    ctx.moveTo(CX - ww, BASE_Y - 6);
    ctx.bezierCurveTo(CX - ww, BASE_Y - hh * 0.48,
                      tx - ww * 0.42 + sway, BASE_Y - hh * 0.82, tx, ty);
    ctx.bezierCurveTo(tx + ww * 0.42 + sway, BASE_Y - hh * 0.82,
                      CX + ww, BASE_Y - hh * 0.48, CX + ww, BASE_Y - 6);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const outer = ctx.createLinearGradient(0, BASE_Y, 0, tipY);
  outer.addColorStop(0, `rgba(${255 - 60 * g},${110 - 20 * g},${18 + 120 * g},${0.55 * flick})`);
  outer.addColorStop(1, `rgba(${255 - 40 * g},${205 - 30 * g},${110 + 90 * g},${0.85 * flick})`);
  ctx.fillStyle = outer;
  tongue(1.0, outer);
  const core = ctx.createLinearGradient(0, BASE_Y, 0, BASE_Y - h * 0.62);
  core.addColorStop(0, `rgba(255,236,180,${0.9 * flick})`);
  core.addColorStop(1, `rgba(255,255,235,${0.95 * flick})`);
  tongue(0.55, core);
  ctx.fillStyle = `rgba(70,110,255,${0.5 - 0.25 * g})`;   // blue root
  ctx.beginPath();
  ctx.ellipse(CX, BASE_Y - 8, w0 * 0.62, 13 + 5 * e, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- lyrics

function currentLine(t) {
  let best = null;
  for (const ln of textLines)
    if (t >= ln.t0 - 0.6 && t <= ln.t1 + 1.1 && (!best || ln.t0 > best.t0))
      best = ln;
  return best;
}

function drawLyrics(t) {
  const ln = currentLine(t);
  if (!ln) return;
  const isK = ln.voice === "klattsch";
  const alpha = smoothstep(ln.t0 - 0.55, ln.t0 - 0.1, t)
              * (1 - smoothstep(ln.t1 + 0.35, ln.t1 + 1.1, t));
  if (alpha <= 0.01) return;

  const size = isK ? 34 : 44;
  ctx.font = `${size}px ${isK ? "CourierPrime" : "Garamond"}`;
  const gap = isK ? 16 : 19;
  const widths = ln.words.map(w => ctx.measureText(w.text).width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (ln.words.length - 1);
  let x = CX - total / 2;
  const y = 236;

  ln.words.forEach((w, i) => {
    const sung = t >= w.t0;
    const now = t >= w.t0 && t <= w.t1 + 0.12;
    const jit = isK ? (hash(i * 7.31 + Math.floor(t * 16) * 0.37) - 0.5) * 4 : 0;
    ctx.save();
    ctx.globalAlpha = alpha * (sung ? 1.0 : 0.32);
    ctx.fillStyle = isK ? "#d7e3ee" : (sung ? "#f4e3c2" : "#a9987b");
    if (now) {
      ctx.shadowColor = isK ? "rgba(160,200,255,0.9)" : "rgba(255,190,90,0.9)";
      ctx.shadowBlur = 22;
      ctx.fillStyle = isK ? "#f2f7ff" : "#fff3da";
    }
    ctx.fillText(w.text, x, y + jit - (now ? 3 : 0));
    ctx.restore();
    x += widths[i] + gap;
  });
}

// ---------------------------------------------------------------- cards

function drawCards(t) {
  const intro = M.sections[0];
  const a1 = smoothstep(1.2, 3.2, t) * (1 - smoothstep(intro.t1 - 3.5, intro.t1 - 1, t));
  if (a1 > 0.01) {
    ctx.save();
    ctx.globalAlpha = a1;
    ctx.fillStyle = "#e8d5ae";
    ctx.font = "46px Garamond";
    ctx.letterSpacing = "10px";
    const s = M.title.toUpperCase();
    ctx.fillText(s, CX - ctx.measureText(s).width / 2, 200);
    ctx.letterSpacing = "3px";
    ctx.font = "19px Garamond";
    ctx.fillStyle = "#9b8a6d";
    const sub = "an etude for voice, formant synth, and band";
    ctx.fillText(sub, CX - ctx.measureText(sub).width / 2, 244);
    ctx.restore();
    ctx.letterSpacing = "0px";
  }
}

function drawEndCard(t) {
  const a = smoothstep(M.duration_s - 8.5, M.duration_s - 5.5, t);
  if (a <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = "#d9c69e";
  ctx.font = "30px Garamond";
  const s1 = M.title;
  ctx.fillText(s1, CX - ctx.measureText(s1).width / 2, 208);
  ctx.font = "18px Garamond";
  ctx.fillStyle = "#94836a";
  const s2 = "voice: Albus Korde from LUNAI Project";
  ctx.fillText(s2, CX - ctx.measureText(s2).width / 2, 244);
  const s3 = "formant voice: klattsch (1980) · band: claudewave";
  ctx.fillText(s3, CX - ctx.measureText(s3).width / 2, 270);
  ctx.restore();
}

// ---------------------------------------------------------------- frame

function renderFrame(t) {
  ctx.fillStyle = "#070503";
  ctx.fillRect(0, 0, W, H);
  drawFlame(t);
  drawLyrics(t);
  drawCards(t);
  drawEndCard(t);
  return true;
}
window.renderFrame = renderFrame;

// ---------------------------------------------------------------- boot

window.vigilReady = (async () => {
  const r = await fetch(`../songs/${SONG}/manifest.json`);
  M = await r.json();
  textLines = M.lines.filter(l => M.lead_voices.includes(l.voice));
  klattschSpans = M.lines.filter(l => l.voice === "klattsch")
                         .map(l => [l.t0, l.t1]);
  await document.fonts.load("44px Garamond");
  await document.fonts.load("34px CourierPrime");
  renderFrame(0);
  return true;
})();

// ---------------------------------------------------------------- preview

if (!EXPORT) (async () => {
  await window.vigilReady;
  const audio = new Audio(`../songs/${SONG}/audio.mp3`);
  audio.preload = "auto";
  const btn = document.getElementById("playbtn");
  const seek = document.getElementById("seek");
  const clock = document.getElementById("clock");
  const secname = document.getElementById("secname");
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  btn.onclick = () => audio.paused ? audio.play() : audio.pause();
  cv.onclick = btn.onclick;
  audio.onplay = () => btn.textContent = "⏸ pause";
  audio.onpause = () => btn.textContent = "▶ play";
  seek.oninput = () => { audio.currentTime = seek.value / 1000 * M.duration_s; };
  document.addEventListener("keydown", e => {
    if (e.key === " ") { e.preventDefault(); btn.onclick(); }
    if (e.key === "ArrowRight") audio.currentTime += 5;
    if (e.key === "ArrowLeft") audio.currentTime -= 5;
  });
  (function loop() {
    const t = audio.currentTime;
    renderFrame(t);
    seek.value = Math.round(t / M.duration_s * 1000);
    clock.textContent = `${fmt(t)} / ${fmt(M.duration_s)}`;
    const s = sectionAt(t);
    secname.textContent = s ? s.name : "";
    requestAnimationFrame(loop);
  })();
})();
