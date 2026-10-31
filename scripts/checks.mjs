// 每一步的最小功能断言；后续步骤在此追加，旧步骤断言保留做回归
const step1 = [
  {
    name: "player stands on terrain",
    async run(page) {
      const s = await page.evaluate(() => ({ on: window.__game.onGround, p: window.__game.playerPos() }));
      return { ok: s.on === true && Math.abs(s.p.y) < 5, info: JSON.stringify(s) };
    },
  },
  {
    name: "W key moves player",
    async run(page) {
      const a = await page.evaluate(() => window.__game.playerPos());
      await page.mouse.click(960, 540);
      await page.keyboard.down("w");
      await page.waitForTimeout(1500);
      await page.keyboard.up("w");
      await page.waitForTimeout(300);
      const b = await page.evaluate(() => window.__game.playerPos());
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      return { ok: d > 1, info: `moved ${d.toFixed(2)}` };
    },
  },
];

export const checks = { 1: step1 };
