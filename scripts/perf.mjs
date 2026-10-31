// 用法: node scripts/perf.mjs [url]   —— 在 1920x1080 下测平均 FPS（需要 dev server 已运行）
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:5391/";
const b = await chromium.launch({ channel: "msedge", args: ["--use-angle=default", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto(url);
await p.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
await p.waitForTimeout(1500);
const r = await p.evaluate(() => new Promise((res) => {
  const t0 = performance.now(), f0 = window.__game.frames;
  setTimeout(() => {
    const dt = (performance.now() - t0) / 1000;
    res({ fps: (window.__game.frames - f0) / dt });
  }, 4000);
}));
const gpu = await p.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const ext = gl?.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
});
console.log(`fps ${r.fps.toFixed(1)} gpu ${gpu}`);
await b.close();
