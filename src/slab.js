import * as THREE from "three";

// 月面“石块”：沿地形四条边向下拉出 5m 厚的岩石侧壁 + 底面封口，
// 再加四面隐形碰撞墙和一张隐形托底平面。不改变地形尺寸。
export const SLAB = { thickness: 5, wallHeight: 40, wallThick: 2, floorBelow: 5 };

// 按顺时针取地形网格最外圈顶点（网格为 n×n，行优先）
function perimeter(pos, n) {
  const idx = [];
  for (let i = 0; i < n - 1; i++) idx.push(i); // 第一行
  for (let j = 0; j < n - 1; j++) idx.push(j * n + n - 1); // 最右列
  for (let i = n - 1; i > 0; i--) idx.push((n - 1) * n + i); // 最后一行
  for (let j = n - 1; j > 0; j--) idx.push(j * n); // 最左列
  return idx.map((k) => new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)));
}

function buildSkirt(ring, thickness) {
  const m = ring.length;
  const pos = new Float32Array(m * 2 * 3);
  const uv = new Float32Array(m * 2 * 2);
  let along = 0;
  for (let k = 0; k < m; k++) {
    const p = ring[k];
    if (k > 0) along += p.distanceTo(ring[k - 1]);
    pos.set([p.x, p.y, p.z, p.x, p.y - thickness, p.z], k * 6);
    uv.set([along / 4, 0, along / 4, thickness / 4], k * 4);
  }
  // 闭合环：第 k 段连接 k 与 k+1（最后一段回到 0）
  const index = [];
  for (let k = 0; k < m; k++) {
    const a = k * 2, b = ((k + 1) % m) * 2;
    index.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

// 底面封口：下沿环 -> 中心点的三角扇
function buildBottom(ring, thickness) {
  const c = new THREE.Vector3();
  for (const p of ring) c.add(p);
  c.divideScalar(ring.length).y -= thickness;
  const pos = [c.x, c.y, c.z];
  for (const p of ring) pos.push(p.x, p.y - thickness, p.z);
  const m = ring.length, index = [];
  for (let k = 0; k < m; k++) index.push(0, 1 + ((k + 1) % m), 1 + k);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

export function createSlab(terrainMesh, half, segments) {
  const ring = perimeter(terrainMesh.geometry.attributes.position, segments + 1);
  // 深灰岩石：复用月面的细碎法线贴图，粗糙、无金属感，双面避免绕序问题
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x34322f,
    roughness: 0.95,
    metalness: 0,
    normalMap: terrainMesh.material.normalMap,
    normalScale: new THREE.Vector2(1.6, 1.6),
    side: THREE.DoubleSide,
  });
  const group = new THREE.Group();
  group.name = "moonSlab";
  const skirt = new THREE.Mesh(buildSkirt(ring, SLAB.thickness), rockMat);
  skirt.name = "slabSkirt";
  const bottom = new THREE.Mesh(buildBottom(ring, SLAB.thickness), rockMat);
  bottom.name = "slabBottom";
  skirt.receiveShadow = bottom.receiveShadow = true;
  group.add(skirt, bottom);

  // 隐形碰撞墙：控制器的玩家胶囊只和 mesh 碰撞体相交（box 形状不参与角色碰撞），
  // 所以用不可见的 BoxGeometry 网格作为“Box Collider”。墙内侧贴着地形边缘。
  const invisible = new THREE.MeshBasicMaterial({ visible: false });
  let minY = Infinity, maxY = -Infinity;
  for (const p of ring) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const y0 = minY - SLAB.thickness - 2, y1 = maxY + SLAB.wallHeight;
  const H = y1 - y0, T = SLAB.wallThick, L = half * 2 + T * 2;

  const walls = new THREE.Group();
  walls.name = "slabWalls";
  // [x, z, 宽(x 向), 深(z 向)]：墙内侧正好在 ±half
  const specs = [
    [0, -half - T / 2, L, T],
    [0, half + T / 2, L, T],
    [-half - T / 2, 0, T, L],
    [half + T / 2, 0, T, L],
  ];
  for (const [x, z, w, d] of specs) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), invisible);
    wall.position.set(x, (y0 + y1) / 2, z);
    walls.add(wall);
  }

  // 隐形托底平面：万一穿过地形，落在石块下方这块板上，不会无限下坠
  const floorY = minY - SLAB.thickness - SLAB.floorBelow;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(L, 1, L), invisible);
  floor.name = "slabFloor";
  floor.position.set(0, floorY - 0.5, 0);

  group.add(walls, floor);
  return {
    group,
    walls,
    floor,
    // 供测试：墙内侧坐标、托底高度、侧壁最低点
    info: { half, wallInner: half, wallTop: y1, floorY, skirtMinY: minY - SLAB.thickness, thickness: SLAB.thickness },
  };
}
