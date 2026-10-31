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
    atSpawn: true,
    async run(page) {
      const c = await page.evaluate(() => window.__game.camera());
      return { ok: c.fov >= 55 && c.dist > 3 && c.pitchDeg < 20, info: `fov ${c.fov} dist ${c.dist.toFixed(2)} pitch ${c.pitchDeg.toFixed(1)}°` };
    },
  },
];

const step4 = [
  {
    name: "solar-system sky objects exist",
    async run(page) {
      const names = await page.evaluate(() =>
        ["milkyWay", "stars", "sunDisc", "earth", "venus", "jupiter", "mars", "saturn"].filter(
          (n) => !window.__game.sky.group.getObjectByName(n)
        )
      );
      return { ok: names.length === 0, info: names.length ? `missing ${names}` : "all present" };
    },
  },
  {
    name: "earth and sun framed in default shot",
    atSpawn: true,
    async run(page) {
      const r = await page.evaluate(() => ({ earth: window.__game.project("earth"), sun: window.__game.project("sunDisc") }));
      const inFrame = (p) => p.inFront && p.x > 0 && p.x < 1 && p.y > 0 && p.y < 0.5;
      return { ok: inFrame(r.earth) && inFrame(r.sun), info: JSON.stringify(r) };
    },
  },
  {
    name: "sky is adjustable at runtime",
    async run(page) {
      const r = await page.evaluate(() => {
        const s = window.__game.sky;
        const before = s.sunDir.clone();
        const st0 = s.stars.material.uniforms.uIntensity.value;
        s.set({ sunElevation: 40, starIntensity: 0.3 });
        const moved = before.angleTo(s.sunDir);
        const st1 = s.stars.material.uniforms.uIntensity.value;
        s.set({ sunElevation: 10, starIntensity: st0 });
        return { moved, st0, st1 };
      });
      return { ok: r.moved > 0.4 && r.st1 === 0.3, info: JSON.stringify(r) };
    },
  },
];

// 截屏后在浏览器里取平均亮度：区域 [x0,y0,x1,y1] 为 0..1 归一化坐标
async function regionLuma(page, box) {
  const png = (await page.screenshot()).toString("base64");
  return page.evaluate(async ([u, b]) => {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = "data:image/png;base64," + u; });
    const W = img.width, H = img.height;
    const c = new OffscreenCanvas(W, H), g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const x0 = Math.floor(b[0] * W), y0 = Math.floor(b[1] * H);
    const d = g.getImageData(x0, y0, Math.max(1, Math.floor((b[2] - b[0]) * W)), Math.max(1, Math.floor((b[3] - b[1]) * H))).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
    return s / (d.length / 4) / 255;
  }, [png, box]);
}

const step5 = [
  {
    name: "post pipeline: render -> bloom -> output -> grade",
    async run(page) {
      const p = await page.evaluate(() => window.__game.post.passes);
      return { ok: p.join(",") === "render,bloom,output,grade", info: p.join(",") };
    },
  },
  {
    name: "bloom halo around sun + vignette darkens corners",
    atSpawn: true,
    async run(page) {
      const sun = await page.evaluate(() => window.__game.project("sunDisc"));
      // 日面外的一圈（避开日面本身）
      const ring = [sun.x + 0.012, sun.y - 0.01, sun.x + 0.03, sun.y + 0.01];
      const corner = [0, 0.9, 0.06, 1];
      const on = { halo: await regionLuma(page, ring), corner: await regionLuma(page, corner) };
      await page.evaluate(() => window.__game.post.set({ enabled: false }));
      await page.waitForTimeout(200);
      const off = { halo: await regionLuma(page, ring), corner: await regionLuma(page, corner) };
      await page.evaluate(() => window.__game.post.set({ enabled: true }));
      await page.waitForTimeout(200);
      const ok = on.halo > off.halo * 1.15 && on.corner < off.corner;
      return { ok, info: JSON.stringify({ on, off }) };
    },
  },
];

const step6 = [
  {
    name: "astronaut replaces robot (visor + parts, no robot meshes)",
    atSpawn: true,
    async run(page) {
      const r = await page.evaluate(() => window.__game.astronautInfo());
      const ok = r.parts >= 20 && r.visor && r.visorMetal >= 0.9 && r.robotMeshes === 0;
      return { ok, info: JSON.stringify(r) };
    },
  },
  {
    name: "astronaut small in wide frame (cosmic scale)",
    atSpawn: true,
    async run(page) {
      const r = await page.evaluate(() => window.__game.astronautScreen());
      // 画面高度占比 8%~30%：看得清，但人在宇宙里显得渺小
      const ok = r.frac > 0.08 && r.frac < 0.3 && r.heightM > 1.2 && r.heightM < 2.4;
      return { ok, info: `screen ${(r.frac * 100).toFixed(1)}% height ${r.heightM.toFixed(2)}m` };
    },
  },
];
// 通过 lil-gui 控件 setValue（与用户拖滑块走同一条 onChange 路径）
const guiSet = (page, prop, v) =>
  page.evaluate(([p, val]) => {
    const c = window.__game.gui.controllersRecursive().find((c) => c.property === p);
    c.setValue(val);
  }, [prop, v]);
const GUI_PROPS = ["sunAzimuth", "sunElevation", "earthSizeDeg", "starIntensity", "milkyWay",
  "exposure", "bloomStrength", "vignette", "grain", "roughness", "bump", "tint"];
const step7 = [
  {
    name: "lil-gui panel exposes environment params",
    async run(page) {
      const have = await page.evaluate(() =>
        window.__game.gui.controllersRecursive().map((c) => c.property));
      const missing = GUI_PROPS.filter((p) => !have.includes(p));
      const info = missing.length ? "missing " + missing.join(",") : have.length + " controls";
      return { ok: missing.length === 0, info };
    },
  },
  {
    name: "GUI exposure change updates frame live",
    async run(page) {
      const full = [0, 0, 1, 1];
      const before = await regionLuma(page, full);
      await guiSet(page, "exposure", 2.2);
      await page.waitForTimeout(300);
      const after = await regionLuma(page, full);
      await guiSet(page, "exposure", 1.05);
      const ok = after > before * 1.25;
      return { ok, info: `luma ${before.toFixed(3)} -> ${after.toFixed(3)}` };
    },
  },
  {
    name: "GUI sun/earth/roughness drive scene live",
    async run(page) {
      const g = () => page.evaluate(() => ({
        sun: window.__game.sky.sunDir.toArray(), es: window.__game.sky.earth.scale.x,
        r: window.__game.terrainMaterial.roughness,
      }));
      const a = await g();
      await guiSet(page, "sunAzimuth", -60);
      await guiSet(page, "earthSizeDeg", 8);
      await guiSet(page, "roughness", 0.4);
      const b = await g();
      // 恢复电影感默认，避免影响之后的截图
      await page.evaluate(() => window.__game.gui.reset());
      const sunMoved = Math.hypot(...a.sun.map((v, i) => v - b.sun[i])) > 0.5;
      const ok = sunMoved && b.es > a.es * 2 && Math.abs(b.r - 0.4) < 1e-6;
      return { ok, info: `sunMoved ${sunMoved} earth x${(b.es / a.es).toFixed(2)} rough ${b.r}` };
    },
  },
];
step7.push({
  name: "visor reflection re-bakes when sun moves",
  async run(page) {
    const st = () => page.evaluate(() => {
      const e = window.__game.astroEnv;
      const v = window.__game.astronaut.root.getObjectByName("visor").material;
      return { bakes: e.bakes, tex: v.envMap?.uuid, same: v.envMap === e.texture, sun: e.sunMesh.position.toArray() };
    });
    const a = await st();
    await guiSet(page, "sunAzimuth", -90);
    await page.waitForTimeout(200);
    const b = await st();
    await page.evaluate(() => window.__game.gui.reset());
    const moved = Math.hypot(...a.sun.map((v, i) => v - b.sun[i])) > 5;
    const ok = b.bakes > a.bakes && b.tex !== a.tex && b.same && moved;
    return { ok, info: `bakes ${a.bakes}->${b.bakes} newTex ${b.tex !== a.tex} envSun moved ${moved}` };
  },
});
const step8 = [];
step8.push({
  name: "minimap: round 2D canvas, upper-right, not covering sun",
  atSpawn: true,
  async run(page) {
    const r = await page.evaluate(() => {
      const c = document.getElementById("minimap");
      if (!c) return null;
      const b = c.getBoundingClientRect(), s = getComputedStyle(c);
      const sun = window.__game.project("sunDisc");
      const sx = sun.x * innerWidth, sy = sun.y * innerHeight;
      // 太阳与雷达外接矩形的最小距离（含 40px 光晕余量）
      const gap = Math.hypot(Math.max(b.left - sx, 0, sx - b.right), Math.max(b.top - sy, 0, sy - b.bottom));
      return {
        w: b.width, h: b.height, right: innerWidth - b.right, top: b.top,
        round: s.borderRadius === "50%", ctx2d: !!c.getContext("2d"), gap,
      };
    });
    if (!r) return { ok: false, info: "no #minimap" };
    const ok = r.round && r.ctx2d && r.w >= 120 && Math.abs(r.w - r.h) < 1 &&
      r.right < 60 && r.top < 1080 * 0.45 && r.gap > 40;
    return { ok, info: JSON.stringify({ ...r, gap: Math.round(r.gap) }) };
  },
});
step8.push({
  name: "minimap tracks WASD movement and heading",
  async run(page) {
    const mm = () => page.evaluate(() => window.__game.minimapState());
    const a = await mm();
    await holdKey(page, "KeyW", 1200);
    const b = await mm();
    // 玩家正前方 10m 的点必须画在雷达中心正上方（航向朝上）
    const ahead = await page.evaluate((s) => window.__game.minimap.toRadar(s, s.x + s.fx * 10, s.z + s.fz * 10), b);
    await holdKey(page, "KeyD", 1200);
    const c = await mm();
    const moved = Math.hypot(b.x - a.x, b.z - a.z);
    const turnDeg = (Math.acos(Math.min(1, Math.max(-1, b.fx * c.fx + b.fz * c.fz))) * 180) / Math.PI;
    const R = 100; // 雷达半径（CSS 200px / 2）
    const upOk = Math.abs(ahead[0] - R) < 1 && ahead[1] < R - 5;
    const ok = moved > 1 && turnDeg > 20 && upOk;
    return { ok, info: `moved ${moved.toFixed(2)}m turn ${turnDeg.toFixed(0)}° ahead→(${ahead.map((v) => v.toFixed(0))})` };
  },
});
step8.push({
  name: "robot buddy follows ~2m behind-right, grounded, smooth",
  async run(page) {
    const info = () => page.evaluate(() => window.__game.buddyInfo());
    await page.waitForTimeout(1500); // 停稳，跟班追上
    const rest = await info();
    // 行走途中采样：平滑插值意味着会略微落后于目标点（但不会丢）
    await page.mouse.click(960, 540);
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(900);
    const walking = await info();
    await page.keyboard.up("KeyW");
    await page.waitForTimeout(2000);
    const settled = await info();
    const placeOk = rest.right > 0.8 && rest.back > 0.8 && Math.abs(rest.dist - 2) < 0.4;
    const smoothOk = walking.goalGap > 0.05 && walking.goalGap < 3 && walking.anim !== "Idle";
    const settleOk = settled.goalGap < 0.15 && settled.groundGap < 0.01;
    const f = (o) => `d${o.dist.toFixed(2)} r${o.right.toFixed(2)} b${o.back.toFixed(2)} gap${o.goalGap.toFixed(2)} ${o.anim}`;
    return { ok: placeOk && smoothOk && settleOk, info: `rest[${f(rest)}] walk[${f(walking)}] settled[${f(settled)}]` };
  },
});
step8.push({
  name: "astronaut body bulkier, helmet unchanged",
  atSpawn: true,
  async run(page) {
    const r = await page.evaluate(() => window.__game.bodyMetrics());
    // 原头盔壳半径 0.2H、面罩 0.205H；原上臂 0.07H、大腿 0.085H
    const headOk = Math.abs(r.helmet - 0.2) < 1e-6 && Math.abs(r.visor - 0.205) < 1e-6;
    const bulkOk = r.upperArm > 0.07 * 1.15 && r.thigh > 0.085 * 1.15 && r.torso > 0.15 * 1.15;
    return { ok: headOk && bulkOk, info: JSON.stringify(r) };
  },
});
export const checks = { 1: step1, 2: step2, 3: step3, 4: step4, 5: step5, 6: step6, 7: step7, 8: step8 };
