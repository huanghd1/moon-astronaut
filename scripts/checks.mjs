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

export const checks = { 1: step1, 2: step2 };
