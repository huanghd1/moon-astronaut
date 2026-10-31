// 每一步的最小功能断言；verify.mjs 会跑 1..N 全部步骤做回归
const pos = (page) => page.evaluate(() => window.__game.playerPos());

async function holdKey(page, key, ms) {
  await page.mouse.click(960, 540);
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(300);
}

const step1 = [
  {
    name: "player stands on terrain",
    async run(page) {
      const s = await page.evaluate(() => {
        const p = window.__game.playerPos();
        const g = window.__game.heightAt ? window.__game.heightAt(p.x, p.z) : 0;
        return { on: window.__game.onGround, dy: p.y - g };
      });
      return { ok: s.on === true && Math.abs(s.dy) < 0.6, info: JSON.stringify(s) };
    },
  },
  {
    name: "W key moves player",
    async run(page) {
      const a = await pos(page);
      await holdKey(page, "w", 1500);
      const b = await pos(page);
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      return { ok: d > 1, info: `moved ${d.toFixed(2)}` };
    },
  },
];

const step2 = [
  {
    name: "procedural terrain has craters, rocks and relief",
    async run(page) {
      const s = await page.evaluate(() => window.__game.terrainStats);
      const ok = s.craterCount > 500 && s.rockCount > 1000 && s.vertexCount > 200000 && s.heightRange > 5;
      return { ok, info: JSON.stringify(s) };
    },
  },
  {
    name: "player follows uneven ground while walking",
    async run(page) {
      await page.mouse.click(960, 540);
      await page.keyboard.down("d");
      const samples = [];
      for (let i = 0; i < 8; i++) {
        await page.waitForTimeout(250);
        samples.push(await page.evaluate(() => {
          const p = window.__game.playerPos();
          return { y: p.y, g: window.__game.heightAt(p.x, p.z) };
        }));
      }
      await page.keyboard.up("d");
      // 没有掉穿地面，也没有浮空
      const maxGap = Math.max(...samples.map((s) => Math.abs(s.y - s.g)));
      return { ok: maxGap < 0.8, info: `maxGap ${maxGap.toFixed(2)}` };
    },
  },
];

const step3 = [
  {
    name: "lunar gravity: floaty high jump",
    async run(page) {
      await page.waitForTimeout(800); // 等上一步的移动停稳
      await page.mouse.click(960, 540);
      // 页面内逐帧采样，避免 Playwright 往返延迟影响计时
      const sampling = page.evaluate(() => new Promise((resolve) => {
        const g = window.__game, y0 = g.playerPos().y, t0 = performance.now();
        let apex = 0, left = null, landed = null;
        const tick = () => {
          const t = performance.now() - t0;
          apex = Math.max(apex, g.playerPos().y - y0);
          if (left === null && !g.onGround) left = t;
          if (left !== null && landed === null && g.onGround && t - left > 200) landed = t;
          if (landed !== null || t > 5000) resolve({ apex, air: (landed ?? t) - (left ?? 0) });
          else requestAnimationFrame(tick);
        };
        tick();
      }));
      await page.keyboard.down("Space");
      await page.waitForTimeout(120);
      await page.keyboard.up("Space");
      const r = await sampling;
      // 地球重力下同角色约 0.6m / 0.6s；月面要明显更高更久
      return { ok: r.apex > 1.2 && r.air > 1500, info: `apex ${r.apex.toFixed(2)}m air ${(r.air / 1000).toFixed(2)}s` };
    },
  },
  {
    name: "cinematic wide camera",
    async run(page) {
      const c = await page.evaluate(() => window.__game.camera());
      return { ok: c.fov >= 55 && c.dist > 3 && c.pitchDeg < 20, info: `fov ${c.fov} dist ${c.dist.toFixed(2)} pitch ${c.pitchDeg.toFixed(1)}°` };
    },
  },
];

export const checks = { 1: step1, 2: step2, 3: step3 };
