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
const step9 = [];
step9.push({
  name: "moon slab: 5m dark rock skirt + bottom, terrain size unchanged",
  atSpawn: true,
  async run(page) {
    const r = await page.evaluate(() => {
      const g = window.__game, sc = g.astronaut.root.parent;
      let root = sc; while (root.parent) root = root.parent;
      const skirt = root.getObjectByName("slabSkirt"), bottom = root.getObjectByName("slabBottom");
      const t = root.getObjectByName("moonTerrain");
      t.geometry.computeBoundingBox();
      const tb = t.geometry.boundingBox;
      skirt.geometry.computeBoundingBox();
      const sb = skirt.geometry.boundingBox;
      const c = skirt.material.color;
      return {
        terrainW: tb.max.x - tb.min.x, skirtW: sb.max.x - sb.min.x, depth: tb.min.y - sb.min.y,
        luma: 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, bottom: !!bottom, thickness: g.slab.thickness,
      };
    });
    const ok = Math.abs(r.terrainW - 2000) < 1 && Math.abs(r.skirtW - r.terrainW) < 0.01 &&
      Math.abs(r.depth - 5) < 0.01 && r.thickness === 5 && r.bottom && r.luma < 0.1;
    return { ok, info: JSON.stringify(r) };
  },
});
// 在页面里逐帧记录玩家 |x|、|z| 的最大值
const trackMax = (page) => page.evaluate(() => {
  const g = window.__game;
  window.__maxXZ = { x: 0, z: 0 };
  const tick = () => {
    const m = window.__maxXZ;
    if (!m) return; // 读数后置空即停止
    const p = g.playerPos();
    m.x = Math.max(m.x, Math.abs(p.x));
    m.z = Math.max(m.z, Math.abs(p.z));
    requestAnimationFrame(tick);
  };
  tick();
});
step9.push({
  name: "invisible edge walls stop the player at the map border",
  async run(page) {
    const half = await page.evaluate(() => {
      const g = window.__game, h = g.slab.half, x = h - 2, z = h - 2;
      g.teleport(x, g.heightAt(x, z) + 1, z);
      return h;
    });
    await page.waitForTimeout(1500);
    await trackMax(page);
    // 角落出发，四个方向各跑一段：总有两个方向直接顶到墙上
    for (const k of ["KeyW", "KeyA", "KeyS", "KeyD"]) {
      await page.mouse.click(960, 540);
      await page.keyboard.down("ShiftLeft");
      await page.keyboard.down(k);
      await page.waitForTimeout(2200);
      await page.keyboard.up(k);
      await page.keyboard.up("ShiftLeft");
    }
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const g = window.__game, p = g.playerPos(), m = window.__maxXZ;
      window.__maxXZ = null;
      return { maxX: m.x, maxZ: m.z, gap: p.y - g.heightAt(p.x, p.z), onGround: g.onGround };
    });
    const ok = r.maxX <= half && r.maxZ <= half && Math.max(r.maxX, r.maxZ) > half - 1 && Math.abs(r.gap) < 0.8;
    return { ok, info: JSON.stringify({ half, ...r, maxX: +r.maxX.toFixed(2), maxZ: +r.maxZ.toFixed(2), gap: +r.gap.toFixed(2) }) };
  },
});
step9.push({
  name: "invisible floor catches a player below the slab",
  async run(page) {
    const r0 = await page.evaluate(() => {
      const g = window.__game, x = g.slab.half - 20, z = g.slab.half - 20;
      g.teleport(x, g.heightAt(x, z) - 5, z);
      return { floorY: g.slab.floorY };
    });
    await page.waitForTimeout(6000);
    const a = await pos(page);
    await page.waitForTimeout(500);
    const b = await pos(page);
    const ok = a.y > r0.floorY - 1 && a.y < r0.floorY + 3 && Math.abs(b.y - a.y) < 0.02;
    return { ok, info: `floorY ${r0.floorY.toFixed(2)} y ${a.y.toFixed(2)} -> ${b.y.toFixed(2)}` };
  },
});
step9.push({
  name: "astronaut back at spawn stands on surface (not underground)",
  async run(page) {
    await page.evaluate(() => { const g = window.__game; g.teleport(0, g.heightAt(0, 0) + 2, 0); });
    await page.waitForTimeout(2500);
    const s = await page.evaluate(() => {
      const g = window.__game, p = g.playerPos();
      return { on: g.onGround, dy: p.y - g.heightAt(p.x, p.z) };
    });
    return { ok: s.on === true && Math.abs(s.dy) < 0.6, info: JSON.stringify(s) };
  },
});
// 第 10 步：太阳光斑收紧；流星/彗星；天象面板
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const quiet = (page) => ev(page, () => {
  const e = window.__game.sky.events;
  e.settings.meteorRate = 0; e.settings.cometRate = 0; e.clear();
});
// 恢复面板默认值（含天象），并清空正在飞的流星/彗星
const restore = (page) => ev(page, () => { window.__game.gui.reset(); window.__game.sky.events.clear(); });

const step10 = [];
step10.push({
  name: "sun glare tightened: bloom lowered, halo falls off fast, disc still bright",
  atSpawn: true, // 要在默认镜头下量太阳，必须排在会移动玩家的断言之前
  async run(page) {
    await restore(page);
    await quiet(page);
    await page.waitForTimeout(400);
    const r = await ev(page, () => ({ sun: window.__game.project("sunDisc"), bloom: window.__game.post.settings.bloomStrength }));
    if (!r.sun || !r.sun.inFront) return { ok: false, info: "sun not in view " + JSON.stringify(r) };
    const W = 1920, H = 1080, cx = r.sun.x * W, cy = r.sun.y * H;
    const box = (x, y, h) => [(x - h) / W, (y - h) / H, (x + h) / W, (y + h) / H];
    const disc = await regionLuma(page, box(cx, cy, 3));
    const ring60 = await regionLuma(page, box(cx - 60, cy, 4));
    await restore(page);
    const ok = r.bloom <= 0.3 && disc > 0.55 && ring60 < 0.3;
    return { ok, info: `bloom ${r.bloom} disc ${disc.toFixed(3)} ring@60px ${ring60.toFixed(3)} (step9 ~0.44)` };
  },
});
step10.push({
  name: "comet angular speed is exactly 1/4 of meteor speed (measured in flight)",
  async run(page) {
    await quiet(page);
    const r = await ev(page, () => new Promise((res) => {
      const e = window.__game.sky.events;
      e.spawn("meteor", 0.1); e.spawn("comet", 1);
      const ang = (a, b) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
      const m0 = e.head("meteor"), c0 = e.head("comet");
      setTimeout(() => {
        const m1 = e.head("meteor"), c1 = e.head("comet");
        res({ m: m1 && ang(m0, m1), c: c1 && ang(c0, c1), cfg: [e.stats().meteorSpeed, e.stats().cometSpeed] });
      }, 250);
    }));
    await restore(page);
    const ratio = r.c / r.m;
    const ok = r.cfg[1] === r.cfg[0] / 4 && Math.abs(ratio - 0.25) < 0.02;
    return { ok, info: `meteor ${r.m?.toFixed(4)} rad, comet ${r.c?.toFixed(4)} rad, ratio ${ratio.toFixed(3)}` };
  },
});
step10.push({
  name: "Sky Events folder has the 4 sliders; rate sliders change spawning live",
  async run(page) {
    await quiet(page);
    const names = await ev(page, () => {
      const f = window.__game.gui.folders.find((x) => x._title.includes("天象"));
      return f ? f.controllers.map((c) => c.property) : [];
    });
    const count = (prop, v, ms) => ev(page, ([p, val, t]) => new Promise((res) => {
      const g = window.__game.gui, e = window.__game.sky.events;
      g.controllersRecursive().find((c) => c.property === p).setValue(val);
      const k = p === "meteorRate" ? "spawnedMeteors" : "spawnedComets";
      const n0 = e.stats()[k];
      setTimeout(() => res(e.stats()[k] - n0), t);
    }), [prop, v, ms]);
    const mOff = await count("meteorRate", 0, 1500), mOn = await count("meteorRate", 4, 1500);
    await count("meteorRate", 0, 0);
    const cOff = await count("cometRate", 0, 1500), cOn = await count("cometRate", 0.5, 3000);
    await restore(page);
    const want = ["meteorRate", "meteorIntensity", "cometRate", "cometIntensity"];
    const ok = want.every((w) => names.includes(w)) && mOff === 0 && mOn >= 2 && cOff === 0 && cOn >= 1;
    return { ok, info: `sliders[${names}] meteors off ${mOff} on ${mOn}, comets off ${cOff} on ${cOn}` };
  },
});
step10.push({
  name: "intensity sliders change brightness and tail length live",
  async run(page) {
    await quiet(page);
    // 生成一颗、读它写进 GPU 的尾长和亮度；改强度后下一帧再读
    const probe = (kind, prop, v) => ev(page, async ([k, p, val]) => {
      const g = window.__game, e = g.sky.events;
      const c = g.gui.controllersRecursive().find((x) => x.property === p);
      c.setValue(val);
      e.clear();
      // 彗星飞满 6 秒、流星 0.4 秒：头已跑过最长尾长，尾巴已完全展开，量到的才是强度决定的尾长
      e.spawn(k, k === "comet" ? 6 : 0.4);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return e.streak(k);
    }, [kind, prop, v]);
    // 0.3 -> 1：两种强度下尾巴都已完全展开（spawn 把年龄截到寿命一半，太高的强度尾巴还没长满）
    const m1 = await probe("meteor", "meteorIntensity", 0.3), m2 = await probe("meteor", "meteorIntensity", 1);
    const c1 = await probe("comet", "cometIntensity", 0.3), c2 = await probe("comet", "cometIntensity", 1);
    await restore(page);
    const up = (a, b) => a && b && b.alpha > a.alpha * 1.5 && b.length > a.length * 1.2;
    const f = (s) => s ? `${s.length.toFixed(3)}rad/a${s.alpha.toFixed(2)}` : "none";
    return { ok: !!(up(m1, m2) && up(c1, c2)), info: `meteor ${f(m1)} -> ${f(m2)}, comet ${f(c1)} -> ${f(c2)}` };
  },
});
step10.push({
  name: "sky events stay out of the way: far-plane depth, random above horizon, 1 mesh each",
  async run(page) {
    await quiet(page);
    const r = await ev(page, () => {
      const e = window.__game.sky.events;
      const ys = [], az = [];
      for (let i = 0; i < 40; i++) {
        e.clear(); e.spawn("meteor");
        const h = e.head("meteor");
        ys.push(h[1]); az.push(Math.atan2(h[0], h[2]));
      }
      e.clear();
      const vs = e.meteors.material.vertexShader + e.comets.material.vertexShader;
      return {
        minY: Math.min(...ys),
        azSpread: Math.max(...az) - Math.min(...az),
        farDepth: (vs.match(/gl_Position\.z = gl_Position\.w/g) || []).length,
        meshes: e.group.children.length,
        noDepthWrite: !e.meteors.material.depthWrite && !e.comets.material.depthWrite,
      };
    });
    await restore(page);
    // sin(7°)≈0.12：起点都在地平线以上；方位角铺满大半圈说明是随机分布而不是固定位置
    const ok = r.minY > 0.11 && r.azSpread > 4 && r.farDepth === 2 && r.meshes === 2 && r.noDepthWrite;
    return { ok, info: JSON.stringify(r) };
  },
});
// 固定时间窗里数渲染帧
const fpsOver = (page, ms) => ev(page, (t) => new Promise((res) => {
  const f0 = window.__game.frames, t0 = performance.now();
  setTimeout(() => res((window.__game.frames - f0) / ((performance.now() - t0) / 1000)), t);
}), ms);
step10.push({
  name: "frame rate holds with sky events maxed out (vs events off)",
  async run(page) {
    await quiet(page);
    const off = await fpsOver(page, 2500);
    // 拉满：流星 4 颗/秒、强度 3，彗星 0.5 颗/秒、强度 3，再先塞满所有槽位
    await ev(page, () => {
      const e = window.__game.sky.events;
      e.set({ meteorRate: 4, meteorIntensity: 3, cometRate: 0.5, cometIntensity: 3 });
      for (let i = 0; i < 12; i++) e.spawn("meteor", Math.random() * 0.5);
      for (let i = 0; i < 3; i++) e.spawn("comet", Math.random() * 5);
    });
    const on = await fpsOver(page, 2500);
    const n = await ev(page, () => window.__game.sky.events.stats());
    await restore(page);
    // 天象只是两张动态 Mesh：帧率掉幅不能超过 15%（无头浏览器帧率有抖动，留点余量）
    const ok = on >= off * 0.85 && n.meteors > 0;
    return { ok, info: `fps off ${off.toFixed(1)} -> maxed ${on.toFixed(1)}, live meteors ${n.meteors} comets ${n.comets}` };
  },
});
// 第 11 步：地照（Earthshine）
const step11 = [];
step11.push({
  name: "earthshine: cool blue, no shadows, comes from the Earth, GUI slider",
  async run(page) {
    const r = await ev(page, () => {
      const g = window.__game, l = g.lights.earthshine;
      const dir = l.position.clone().sub(l.target.position).normalize();
      const c = g.gui.controllersRecursive().find((x) => x.object === l && x.property === "intensity");
      return {
        intensity: l.intensity, castShadow: l.castShadow,
        blueBias: l.color.b - l.color.r,
        fromEarth: dir.dot(g.sky.earthDir),
        slider: c ? c._name : null,
      };
    });
    const ok = r.intensity >= 0.6 && r.intensity <= 2 && !r.castShadow && r.blueBias > 0.3 && r.fromEarth > 0.999 && !!r.slider;
    return { ok, info: JSON.stringify(r) };
  },
});
export const checks = { 1: step1, 2: step2, 3: step3, 4: step4, 5: step5, 6: step6, 7: step7, 8: step8, 9: step9, 10: step10, 11: step11 };
