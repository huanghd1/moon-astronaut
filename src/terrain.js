import * as THREE from "three";
import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise.js";
import { mulberry32, smoothstep } from "./rng.js";

// 程序化月面：分形噪声起伏 + 多尺度陨石坑（碗形+坑缘+溅射物）+ 夸张曲率地平线 + 碎石
export const TERRAIN = {
  half: 1000, // 地形半宽（米），总宽 2km
  segments: 512,
  centerWarp: 0.25, // 网格中心加密：中心约 1m 间距，边缘约 10m
  curvatureR: 9000, // 夸张的星球曲率半径，用来做出电影感的弧形地平线
  spawnClear: 10, // 出生点附近不放大坑
};

export function createTerrain(seed = 1969) {
  const rand = mulberry32(seed);
  const simplex = new SimplexNoise({ random: rand });

  const fbm = (x, z, oct, freq, gain = 0.5) => {
    let a = 1, f = freq, s = 0, n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * simplex.noise(x * f, z * f);
      n += a; a *= gain; f *= 2.03;
    }
    return s / n;
  };

  // ---- 陨石坑：幂律分布，小坑集中在玩家活动区 ----
  const craters = [];
  const addCraters = (count, rMin, rMax, spread) => {
    for (let i = 0; i < count; i++) {
      const r = rMin * Math.pow(rMax / rMin, Math.pow(rand(), 2.2));
      const ang = rand() * Math.PI * 2;
      const dist = Math.sqrt(rand()) * spread;
      const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
      if (Math.hypot(x, z) < TERRAIN.spawnClear + r * 1.8) continue;
      // 新鲜度：越新坑越深、坑缘越亮
      const fresh = rand();
      craters.push({ x, z, r, depth: r * (0.12 + 0.1 * fresh), fresh });
    }
  };
  addCraters(10, 35, 120, 900);
  addCraters(160, 6, 30, 700);
  addCraters(1400, 0.6, 6, 260);

  // 空间哈希，避免每个顶点遍历所有坑
  const CELL = 24;
  const grid = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  for (const c of craters) {
    const reach = c.r * 2.2;
    for (let i = Math.floor((c.x - reach) / CELL); i <= Math.floor((c.x + reach) / CELL); i++)
      for (let j = Math.floor((c.z - reach) / CELL); j <= Math.floor((c.z + reach) / CELL); j++) {
        const k = key(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(c);
      }
  }

  // 返回 [高度, 坑缘亮度]
  const craterAt = (x, z) => {
    const list = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    let h = 0, bright = 0;
    if (!list) return [0, 0];
    for (const c of list) {
      const d = Math.hypot(x - c.x, z - c.z) / c.r;
      if (d > 2.2) continue;
      // 平底碗 + 高斯坑缘 + 向外衰减的溅射物
      const bowl = d < 1 ? Math.max(d * d - 1, -0.75) * c.depth : 0;
      const rim = c.depth * 0.32 * Math.exp(-(((d - 1) / 0.28) ** 2));
      const ejecta = d > 1 ? c.depth * 0.06 * (1 - smoothstep(1, 2.2, d)) : 0;
      h += bowl + rim + ejecta;
      bright = Math.max(bright, c.fresh * (1 - smoothstep(0.8, 2.0, d)) * (d > 0.6 ? 1 : 0.5));
    }
    return [h, bright];
  };

  const baseHeight = (x, z) => {
    const big = fbm(x, z, 4, 0.0018) * 14; // 远处缓坡丘陵
    const mid = fbm(x + 311, z - 97, 4, 0.02) * 1.2;
    const fine = fbm(x - 51, z + 733, 3, 0.25) * 0.08;
    return big + mid + fine;
  };
  const curvature = (x, z) => -(x * x + z * z) / (2 * TERRAIN.curvatureR);

  const h0 = baseHeight(0, 0);
  const heightAt = (x, z) => baseHeight(x, z) - h0 + craterAt(x, z)[0] + curvature(x, z);

  // ---- 网格 ----
  const { half, segments, centerWarp: a } = TERRAIN;
  const warp = (u) => half * (a * u + (1 - a) * u * u * u);
  const n = segments + 1;
  const positions = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  const albedo = new THREE.Color();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = warp((i / segments) * 2 - 1);
      const z = warp((j / segments) * 2 - 1);
      const [ch, bright] = craterAt(x, z);
      const y = baseHeight(x, z) - h0 + ch + curvature(x, z);
      const idx = j * n + i;
      positions.set([x, y, z], idx * 3);
      uvs.set([x / 3, z / 3], idx * 2); // 细节法线 3m 一个周期

      // 反照率：大块"月海"暗斑 + 斑驳 + 新坑亮色溅射物；中性略暖的灰
      const mare = smoothstep(-0.2, 0.4, fbm(x + 900, z, 3, 0.0025));
      const mottle = fbm(x, z + 400, 3, 0.06) * 0.05;
      const v = THREE.MathUtils.clamp(0.3 - mare * 0.09 + mottle + bright * 0.13, 0.12, 0.5);
      albedo.setRGB(v * 1.02, v, v * 0.95);
      colors.set([albedo.r, albedo.g, albedo.b], idx * 3);
    }
  }
  const indices = new Uint32Array(segments * segments * 6);
  let p = 0;
  for (let j = 0; j < segments; j++)
    for (let i = 0; i < segments; i++) {
      const v0 = j * n + i, v1 = v0 + 1, v2 = v0 + n, v3 = v2 + 1;
      indices.set([v0, v2, v1, v1, v2, v3], p);
      p += 6;
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.97,
    metalness: 0,
    normalMap: createRegolithNormalMap(simplex),
    normalScale: new THREE.Vector2(0.9, 0.9),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "moonTerrain";
  mesh.receiveShadow = true;

  const rocks = createRocks(rand, simplex, heightAt);

  let hMin = Infinity, hMax = -Infinity;
  for (let k = 1; k < positions.length; k += 3) {
    hMin = Math.min(hMin, positions[k]); hMax = Math.max(hMax, positions[k]);
  }
  const stats = {
    vertexCount: n * n,
    craterCount: craters.length,
    rockCount: rocks.count,
    heightRange: hMax - hMin,
  };
  return { mesh, rocks, heightAt, stats };
}

// 可平铺的细碎月壤法线贴图（4D 噪声绕环面采样实现无缝）
function createRegolithNormalMap(simplex, size = 512) {
  const H = new Float32Array(size * size);
  const TAU = Math.PI * 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x / size) * TAU, v = (y / size) * TAU;
      let h = 0, amp = 1, R = 1.2;
      for (let o = 0; o < 5; o++) {
        h += amp * simplex.noise4d(Math.cos(u) * R, Math.sin(u) * R, Math.cos(v) * R, Math.sin(v) * R);
        amp *= 0.55; R *= 2.1;
      }
      // 小凹坑颗粒感
      h -= Math.max(0, simplex.noise4d(Math.cos(u) * 9, Math.sin(u) * 9, Math.cos(v) * 9, Math.sin(v) * 9) - 0.55) * 2.5;
      H[y * size + x] = h;
    }
  const data = new Uint8Array(size * size * 4);
  const s = 2.2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const at = (xx, yy) => H[((yy + size) % size) * size + ((xx + size) % size)];
      const dx = (at(x + 1, y) - at(x - 1, y)) * s;
      const dy = (at(x, y + 1) - at(x, y - 1)) * s;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = (-dx * inv * 0.5 + 0.5) * 255;
      data[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      data[i + 2] = (inv * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// 散落碎石：幂律尺寸，小石子多、巨石少
function createRocks(rand, simplex, heightAt, count = 1800) {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + 0.35 * simplex.noise3d(v.x * 1.3, v.y * 1.3, v.z * 1.3) + 0.12 * simplex.noise3d(v.x * 4, v.y * 4, v.z * 4);
    v.multiplyScalar(k);
    v.y *= 0.62;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x77736d, roughness: 0.92 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = "rocks";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), t = new THREE.Vector3();
  let placed = 0;
  while (placed < count) {
    const ang = rand() * Math.PI * 2;
    const dist = 3 + Math.pow(rand(), 0.8) * 320;
    const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
    const size = 0.06 + 1.1 * Math.pow(rand(), 5);
    e.set(rand() * 0.6, rand() * Math.PI * 2, rand() * 0.6);
    q.setFromEuler(e);
    s.set(size * (0.8 + rand() * 0.5), size, size * (0.8 + rand() * 0.5));
    t.set(x, heightAt(x, z) - size * 0.2, z);
    mesh.setMatrixAt(placed++, m.compose(t, q, s));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
