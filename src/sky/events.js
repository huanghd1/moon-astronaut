import * as THREE from "three";
import { OUTPUT_GLSL } from "./glsl.js";

// 天象：流星（快、短尾）+ 彗星（慢、长尾）。
// 每种只有一个 Mesh、一次 draw call：每条光尾是一段朝向相机的四边形飘带（4 顶点），
// 顶点在 CPU 端按“头-尾”两个天球方向更新；着色器把深度压到远平面，永远在地形和角色后面。
export const METEOR_SPEED = 0.35; // 流星角速度（弧度/秒）：约 0.5 秒划过 10°
export const COMET_SPEED_RATIO = 0.25; // 彗星速度 = 流星的 1/4
export const COMET_SPEED = METEOR_SPEED * COMET_SPEED_RATIO;

export const EVENTS_DEFAULTS = {
  meteorRate: 0.5, // 流星：平均每秒出现几颗
  meteorIntensity: 1, // 流星亮度 + 尾长倍率
  cometRate: 0.04, // 彗星：平均每秒出现几颗（约 25 秒一颗）
  cometIntensity: 1, // 彗星亮度 + 尾长倍率
};

const METEOR = { max: 12, tailRad: 0.09, width: 0.0028, life: [0.6, 1.1], color: [0.85, 0.92, 1.0], bright: 3.2 };
const COMET = { max: 3, tailRad: 0.42, width: 0.008, life: [10, 16], color: [0.62, 0.86, 1.0], bright: 0.8 };
const MIN_EL = 0.12; // 只在地平线以上约 7° 生成，留给地面/角色的画面不被遮

function createStreaks(name, cfg, radius) {
  const n = cfg.max;
  const pos = new Float32Array(n * 4 * 3);
  const uv = new Float32Array(n * 4 * 2);
  const alpha = new Float32Array(n * 4);
  const index = [];
  for (let i = 0; i < n; i++) {
    // u: 0 = 头，1 = 尾；v: -1..1 横向
    uv.set([0, -1, 0, 1, 1, -1, 1, 1], i * 8);
    const a = i * 4;
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("alpha", new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(index);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(...cfg.color) },
      uBright: { value: cfg.bright },
      uComet: { value: name === "comets" ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      attribute float alpha;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vUv = uv; vAlpha = alpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w * 0.99998; // 天穹层，和星点一样在最远处
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uBright, uComet;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        // 插值后 u 可能略超出 [0,1]，pow(负数) = NaN，一个 NaN 像素会被泛光扩散成整屏黑
        float u = clamp(vUv.x, 0.0, 1.0), v = min(abs(vUv.y), 1.0);
        // 尾巴：越往后越暗、越细；彗星尾更宽更柔
        float fall = pow(1.0 - u, mix(1.6, 2.4, uComet));
        float core = exp(-v * v / max(0.02, mix(0.12, 0.35, uComet) * (1.0 - u * 0.7)));
        // 头部亮核：流星是一个小白点，彗星是更大的彗发
        float head = exp(-u * mix(40.0, 14.0, uComet)) * mix(1.6, 2.2, uComet);
        vec3 col = mix(uColor, vec3(1.0, 0.98, 0.95), head / 2.2);
        gl_FragColor = vec4(clamp(col * (fall + head) * core * uBright * vAlpha, 0.0, 64.0), 1.0);
        ${OUTPUT_GLSL}
      }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.renderOrder = -7;
  mesh.frustumCulled = false; // 顶点每帧变，包围盒没意义；本来就只有一个 draw call
  return { name, mesh, geo, mat, radius, cfg, items: [] };
}

// --- 天球上的运动：头沿一条大圆弧以恒定角速度移动 ---
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _side = new THREE.Vector3(), _v = new THREE.Vector3();

function spawn(rand, s, speed, at) {
  // 天球上随机起点（地平线以上，均匀分布在方位角上）；at 可指定起点方向（测试/截图用）
  const az = rand() * Math.PI * 2;
  const el = Math.asin(MIN_EL + rand() * (0.9 - MIN_EL));
  const start = at ? at.clone().normalize() : new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  // 随机切向方向，略偏向下方（像在往地平线掉）
  const t1 = new THREE.Vector3(0, 1, 0).cross(start).normalize();
  const t2 = start.clone().cross(t1).normalize(); // 在天球上指向“上”
  const ang = rand() * Math.PI * 2;
  const tangent = t1.multiplyScalar(Math.cos(ang)).addScaledVector(t2, Math.sin(ang) * 0.6 - 0.4).normalize();
  const axis = start.clone().cross(tangent).normalize(); // 大圆转轴
  const life = s.cfg.life[0] + rand() * (s.cfg.life[1] - s.cfg.life[0]);
  return { start, axis, speed, age: 0, life };
}

// 把每条光尾写进飘带顶点。轴向量（大圆转轴）同时垂直于视线和运动方向，正好当飘带的横向
function write(s, intensity) {
  const pos = s.geo.attributes.position.array, alpha = s.geo.attributes.alpha.array;
  const R = s.radius, k = Math.max(intensity, 0);
  const tailLen = s.cfg.tailRad * Math.sqrt(k); // 尾长随强度增长，但比亮度增长得慢
  const w = s.cfg.width * R * (0.6 + 0.4 * Math.sqrt(k));
  alpha.fill(0);
  s.items.forEach((it, i) => {
    const travelled = it.speed * it.age;
    _a.copy(it.start).applyAxisAngle(it.axis, travelled); // 头
    _b.copy(it.start).applyAxisAngle(it.axis, Math.max(0, travelled - tailLen)); // 尾（刚出现时尾巴从 0 长出来）
    _side.copy(it.axis);
    const x = it.age / it.life;
    const fade = THREE.MathUtils.smoothstep(x, 0, 0.12) * (1 - THREE.MathUtils.smoothstep(x, 0.7, 1));
    const tailW = s.name === "comets" ? 2.2 : 0.7; // 彗尾向后散开，流星尾向后收细
    let o = i * 12;
    for (const [p, ww] of [[_a, w], [_b, w * tailW]]) {
      _v.copy(p).multiplyScalar(R);
      pos[o++] = _v.x - _side.x * ww; pos[o++] = _v.y - _side.y * ww; pos[o++] = _v.z - _side.z * ww;
      pos[o++] = _v.x + _side.x * ww; pos[o++] = _v.y + _side.y * ww; pos[o++] = _v.z + _side.z * ww;
    }
    alpha.fill(fade * k, i * 4, i * 4 + 4);
  });
  // 空槽位的顶点塌到原点、alpha 为 0，不产生像素
  pos.fill(0, s.items.length * 12);
  s.geo.attributes.position.needsUpdate = true;
  s.geo.attributes.alpha.needsUpdate = true;
}

export function createSkyEvents(radius, rand, params = {}) {
  const settings = { ...EVENTS_DEFAULTS, ...params };
  const meteors = createStreaks("meteors", METEOR, radius);
  const comets = createStreaks("comets", COMET, radius * 0.995);
  meteors.speed = METEOR_SPEED; comets.speed = COMET_SPEED;
  const group = new THREE.Group();
  group.name = "skyEvents";
  group.add(comets.mesh, meteors.mesh);
  const kinds = { meteor: meteors, comet: comets };
  // 泊松过程：累计“期望个数”，超过一个指数分布阈值就生成一颗。改频率滑块下一帧就生效
  const clocks = { meteor: { acc: 0, thr: 1 }, comet: { acc: 0, thr: 1 } };
  const expo = () => -Math.log(1 - rand() * 0.999);
  const spawned = { meteor: 0, comet: 0 };

  function add(kind, at) {
    const s = kinds[kind];
    if (s.items.length >= s.cfg.max) return null;
    const it = spawn(rand, s, s.speed, at);
    s.items.push(it);
    spawned[kind]++;
    return it;
  }

  let last = null;
  function update(t) {
    const dt = last === null ? 0 : Math.min(Math.max(t - last, 0), 0.1);
    last = t;
    const rate = { meteor: settings.meteorRate, comet: settings.cometRate };
    for (const kind of ["meteor", "comet"]) {
      const c = clocks[kind];
      c.acc += dt * rate[kind];
      if (rate[kind] > 0 && c.acc >= c.thr) { add(kind); c.acc = 0; c.thr = expo(); }
      const s = kinds[kind];
      for (const it of s.items) it.age += dt;
      s.items = s.items.filter((it) => it.age < it.life);
    }
    write(meteors, settings.meteorIntensity);
    write(comets, settings.cometIntensity);
  }

  return {
    group,
    settings,
    meteors: meteors.mesh,
    comets: comets.mesh,
    set(patch) { Object.assign(settings, patch); },
    update,
    // 供测试/截图：立刻生成一颗（可指定已经飞了多久、起点方向）
    spawn(kind, age = 0, at = null) { const it = add(kind, at); if (it) it.age = Math.min(age, it.life * 0.5); return !!it; },
    clear() { meteors.items = []; comets.items = []; },
    // 供测试：第 i 颗的头部方向（天球单位向量）
    head(kind, i = 0) {
      const it = (kind === "comet" ? comets : meteors).items[i];
      return it ? it.start.clone().applyAxisAngle(it.axis, it.speed * it.age).toArray() : null;
    },
    get meteorItems() { return meteors.items; },
    get cometItems() { return comets.items; },
    // 供测试：第 0 条光尾实际写进 GPU 的长度（弧度）和亮度，用来验证“强度”滑块
    streak(kind) {
      const s = kinds[kind], p = s.geo.attributes.position.array, a = s.geo.attributes.alpha.array;
      if (!s.items.length) return null;
      // 顶点 0/1 在头部，2/3 在尾部（见 write）
      const head = new THREE.Vector3(p[0] + p[3], p[1] + p[4], p[2] + p[5]);
      const tail = new THREE.Vector3(p[6] + p[9], p[7] + p[10], p[8] + p[11]);
      return { length: head.angleTo(tail), alpha: a[0] };
    },
    stats: () => ({
      meteors: meteors.items.length, comets: comets.items.length,
      spawnedMeteors: spawned.meteor, spawnedComets: spawned.comet,
      meteorSpeed: meteors.speed, cometSpeed: comets.speed,
    }),
  };
}
