// 用法: node scripts/verify.mjs <step>
// 启动 vite dev server -> Playwright 打开页面 -> 截图 artifacts/step<N>.png -> 检查 console error -> 跑该步断言
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { checks } from "./checks.mjs";

const step = Number(process.argv[2] ?? 1);
const PORT = Number(process.env.VERIFY_PORT ?? 5391);
const URL = `http://localhost:${PORT}/`;

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

  for (const c of checks[step] ?? []) {
    const r = await c.run(page);
    console.log(`${r.ok ? "PASS" : "FAIL"} ${c.name} ${r.info ?? ""}`);
    if (!r.ok) code = 1;
  }

  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({ path: `artifacts/step${step}.png` });
  console.log(`screenshot artifacts/step${step}.png`);
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
