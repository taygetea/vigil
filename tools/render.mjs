#!/usr/bin/env node
/* vigil offline renderer: drives page/vigil.js frame-by-frame in headless
 * chromium over CDP and pipes PNG frames into ffmpeg. The page's
 * renderFrame(t) is pure, so the driver owns time — no wall clock, no
 * rAF, no virtual-time-budget traps. Identical output on every run.
 *
 *     node tools/render.mjs <song> [fps]        (default 30)
 *
 * Needs: chromium, ffmpeg, python3 (spawns tools/serve.py). No npm deps —
 * node >= 22 has a native WebSocket client.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SONG = process.argv[2] || "lights_were_on";
const FPS = Number(process.argv[3] || 30);
const PORT = 8391, CDP_PORT = 9377;

const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, "songs", SONG, "manifest.json"), "utf8"));
const FRAMES = Math.ceil(manifest.duration_s * FPS);

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageTarget() {
  for (let i = 0; i < 150; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error("chromium CDP endpoint never came up");
}

const server = spawn("python3", [path.join(ROOT, "tools", "serve.py"),
                                "--port", String(PORT)], { stdio: "ignore" });
const profile = fs.mkdtempSync("/tmp/vigil-chrome-");
const chrome = spawn("chromium", [
  "--headless=new", `--remote-debugging-port=${CDP_PORT}`,
  "--window-size=1280,720", "--hide-scrollbars", "--disable-gpu",
  "--force-device-scale-factor=1", `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

function cleanup() {
  chrome.kill(); server.kill();
  fs.rmSync(profile, { recursive: true, force: true });
}
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));

const target = await pageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await once(ws, "open");
const cdp = new CDP(ws);

await cdp.send("Page.enable");
await cdp.send("Emulation.setDeviceMetricsOverride",
               { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await cdp.send("Page.navigate",
               { url: `http://127.0.0.1:${PORT}/page/?song=${SONG}&export=1` });

for (let i = 0; ; i++) {
  const r = await cdp.send("Runtime.evaluate",
    { expression: "window.vigilReady || false", awaitPromise: true });
  if (r.result.value === true) break;
  if (i > 100) throw new Error("page never became ready");
  await sleep(200);
}

fs.mkdirSync(path.join(ROOT, "out"), { recursive: true });
const outPath = path.join(ROOT, "out", `${SONG}.mp4`);
const ffmpeg = spawn("ffmpeg", [
  "-y", "-loglevel", "error",
  "-f", "image2pipe", "-framerate", String(FPS), "-i", "pipe:0",
  "-i", path.join(ROOT, "songs", SONG, "audio.mp3"),
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "192k", "-shortest", outPath,
], { stdio: ["pipe", "inherit", "inherit"] });

const t0 = Date.now();
for (let i = 0; i < FRAMES; i++) {
  const t = i / FPS;
  await cdp.send("Runtime.evaluate", { expression: `renderFrame(${t})` });
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  const buf = Buffer.from(shot.data, "base64");
  if (!ffmpeg.stdin.write(buf)) await once(ffmpeg.stdin, "drain");
  if (i % 300 === 0) {
    const fps = i / ((Date.now() - t0) / 1000) || 0;
    console.log(`frame ${i}/${FRAMES}  (${fps.toFixed(1)} fps capture)`);
  }
}
ffmpeg.stdin.end();
await once(ffmpeg, "exit");
ws.close();
console.log(`wrote ${outPath}`);
process.exit(0);
