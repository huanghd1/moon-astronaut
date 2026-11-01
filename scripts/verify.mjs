// 用法: node scripts/verify.mjs <step>
// 启动 vite dev server -> Playwright 打开页面 -> 截图 artifacts/step<N>.png -> 检查 console error -> 跑该步断言
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { checks } from "./checks.mjs";

const step = Number(process.argv[2] ?? 1);
const PORT = Number(process.env.VERIFY_PORT ?? 5391);
const URL = `http://127.0.0.1:${PORT}/`;

const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(PORT), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("dev server timeout")), 30000);
  server.stdout.on("data", (d) => {
    if (d.toString().includes("Local")) { clearTimeout(t); resolve(); }
  });
  server.on("exit", (c) => reject(new Error("dev server exited " + c)));
});

const errors = [];
let code = 0;
// 优先本机 Edge，避免下载浏览器；GPU 走 ANGLE 以支持 WebGL
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? "msedge",
  args: ["--use-angle=default", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${m.text()} @ ${m.location().url}`); });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  // 先在出生点截图（画面稳定，便于逐步比对），再跑会移动角色的断言
  mkdirSync("artifacts", { recursive: true });
  const shot = `artifacts/step${step}.png`;
  await page.screenshot({ path: shot });
  console.log(`screenshot ${shot}`);
  // 第 10 步起：默认镜头前方的天空里放一颗彗星 + 几颗流星，另存一张天象截图
  if (step >= 10) {
    await page.evaluate(async () => {
      const { dirFromAngles } = await import("/src/sky/index.js");
      const e = window.__game.sky.events;
      e.set({ meteorRate: 0, cometRate: 0 }); e.clear();
      e.spawn("comet", 3, dirFromAngles(-8, 30));
      for (const [az, el] of [[20, 28], [-35, 22], [5, 40]]) e.spawn("meteor", 0.32, dirFromAngles(az, el));
    });
    await page.waitForTimeout(120);
    await page.screenshot({ path: `artifacts/step${step}-sky.png` });
    console.log(`screenshot artifacts/step${step}-sky.png`);
    await page.evaluate(() => { window.__game.gui.reset(); window.__game.sky.events.clear(); });
  }

  // 第 7 步起：另存一张展开环境面板的截图
  if (step >= 7) {
    await page.evaluate(() => window.__game.gui.open().foldersRecursive().forEach((f) => f.open()));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `artifacts/step${step}-panel.png` });
    console.log(`screenshot artifacts/step${step}-panel.png`);
    await page.evaluate(() => window.__game.gui.close());
  }

  // 回归：跑 1..N 步全部断言；atSpawn 的构图类断言先跑（角色还没被移动过）
  const all = [];
  for (let s = 1; s <= step; s++) for (const c of checks[s] ?? []) all.push({ s, c });
  all.sort((a, b) => Number(!!b.c.atSpawn) - Number(!!a.c.atSpawn));
  for (const { s, c } of all) {
    const r = await c.run(page);
    console.log(`${r.ok ? "PASS" : "FAIL"} [step${s}] ${c.name} ${r.info ?? ""}`);
    if (!r.ok) code = 1;
  }

  // 第 12 步起：从宇航员正侧面平视取景，看待机站姿（腿是否伸直）
  if (step >= 12) {
    await page.evaluate(() => window.__game.gui.close());
    await page.waitForTimeout(1500); // 回到待机，Idle 淡入完成
    await page.evaluate(() => {
      const g = window.__game, q = g.playerPos(), m = g.astronaut.root.matrixWorld.elements;
      // 模型局部 +Z 是正前方；侧面 = 水平面内与朝向垂直的方向
      const h = Math.hypot(m[8], m[10]), sx = m[10] / h, sz = -m[8] / h;
      const cx = q.x + sx * 4.5, cz = q.z + sz * 4.5;
      // 侧面地势可能比脚下高：镜头至少离那里的地面 1.2m，免得钻到地形下面
      const cy = Math.max(q.y + 1, g.heightAt(cx, cz) + 1.2);
      g.freeCamera([cx, cy, cz], [q.x, q.y + 0.9, q.z]);
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `artifacts/step${step}-legs.png` });
    console.log(`screenshot artifacts/step${step}-legs.png`);
  }

  // 第 11 步起：站在宇航员和地球之间回头看（背光面），地照开/关各存一张
  if (step >= 11) {
    await page.evaluate(() => {
      const g = window.__game, q = g.playerPos(), e = g.sky.earthDir, h = Math.hypot(e.x, e.z);
      g.freeCamera([q.x + e.x / h * 7, q.y + 2.2, q.z + e.z / h * 7], [q.x, q.y + 1, q.z]);
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `artifacts/step${step}-earthshine.png` });
    const es = await page.evaluate(() => { const l = window.__game.lights.earthshine, v = l.intensity; l.intensity = 0.1; return v; });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `artifacts/step${step}-earthshine-old.png` });
    await page.evaluate((v) => { window.__game.lights.earthshine.intensity = v; }, es);
    console.log(`screenshot artifacts/step${step}-earthshine.png (+ -old: intensity 0.1 for comparison)`);
  }

  // 第 9 步起：断言跑完后从地图角落外侧取景，另存一张地层侧壁截图
  if (step >= 9) {
    await page.evaluate(() => {
      const g = window.__game, h = g.slab.half, x = h - 4, z = h - 6;
      g.teleport(x, g.heightAt(x, z) + 1, z);
    });
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const g = window.__game, h = g.slab.half, y = g.heightAt(h - 4, h - 6);
      g.freeCamera([h + 14, y + 4, h + 10], [h - 3, y - 1.5, h - 4]);
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `artifacts/step${step}-edge.png` });
    console.log(`screenshot artifacts/step${step}-edge.png`);
  }

  // 截图比对：本步画面不能是空白，并与上一步有可见变化
  const prev = `artifacts/step${step - 1}.png`;
  const cmp = await compareImages(page, shot, existsSync(prev) ? prev : null);
  const okShot = cmp.std > 0.03 && cmp.mean > 0.02;
  console.log(`${okShot ? "PASS" : "FAIL"} screenshot not blank mean=${cmp.mean.toFixed(3)} std=${cmp.std.toFixed(3)}`);
  if (!okShot) code = 1;
  if (cmp.diff !== null) console.log(`INFO diff vs ${prev}: ${(cmp.diff * 100).toFixed(1)}% pixels changed`);
} catch (e) {
  console.error("FAIL", e.message);
  code = 1;
} finally {
  await browser.close();
  // Windows 下需要杀掉整个进程树
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"]);
  else server.kill();
}

if (errors.length) {
  console.log("FAIL console errors:\n" + errors.join("\n"));
  code = 1;
} else console.log("PASS no console errors");
process.exit(code);

// 在浏览器里用 canvas 解码 PNG，算亮度均值/标准差，以及与上一张的像素差异比例
async function compareImages(page, a, b) {
  const toUrl = (f) => "data:image/png;base64," + readFileSync(f).toString("base64");
  return page.evaluate(async ([ua, ub]) => {
    const load = (u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; });
    const W = 480, H = 270;
    const px = async (u) => {
      const c = new OffscreenCanvas(W, H), g = c.getContext("2d");
      g.drawImage(await load(u), 0, 0, W, H);
      return g.getImageData(0, 0, W, H).data;
    };
    const A = await px(ua);
    let sum = 0, sq = 0;
    const n = W * H;
    for (let i = 0; i < A.length; i += 4) {
      const l = (A[i] * 0.2126 + A[i + 1] * 0.7152 + A[i + 2] * 0.0722) / 255;
      sum += l; sq += l * l;
    }
    const mean = sum / n;
    let diff = null;
    if (ub) {
      const B = await px(ub);
      let c = 0;
      for (let i = 0; i < A.length; i += 4)
        if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 30) c++;
      diff = c / n;
    }
    return { mean, std: Math.sqrt(Math.max(sq / n - mean * mean, 0)), diff };
  }, [toUrl(a), b && toUrl(b)]);
}
