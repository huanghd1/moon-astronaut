import * as THREE from "three";

// 小宇航员：复用 CC0 机器人的骨骼与动画，去掉机器人外形，
// 用基础几何体拼出宇航服。部件先按“静止姿态的模型空间”摆好，再 attach 到骨骼上，之后自动跟随动画。

const SUIT = 0xe9e6df; // 略暖的白（阿波罗宇航服布料）

export function makeAstronautMaterials() {
  return {
    suit: new THREE.MeshStandardMaterial({ color: SUIT, roughness: 0.78, metalness: 0 }),
    seam: new THREE.MeshStandardMaterial({ color: 0x9a968e, roughness: 0.85 }),
    boot: new THREE.MeshStandardMaterial({ color: 0x8c8a86, roughness: 0.9 }),
    glove: new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.7 }),
    // 金色镀膜面罩：高金属度 + 低粗糙度，反射太阳时会触发泛光
    visor: new THREE.MeshPhysicalMaterial({
      color: 0xffc773,
      metalness: 1,
      roughness: 0.06,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 1.6,
    }),
    helmet: new THREE.MeshPhysicalMaterial({ color: 0xf2f0ea, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.1 }),
    pack: new THREE.MeshStandardMaterial({ color: 0xd9d5cc, roughness: 0.6, metalness: 0.1 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.35, metalness: 0.9 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xc8402c, roughness: 0.6 }), // 臂章红条
    // 胸口状态灯：HDR 自发光，配合 bloom 有一点小光点
    light: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x6fd6ff, emissiveIntensity: 6 }),
  };
}

// 用骨骼静止姿态的世界坐标（在 buildAstronaut 里转换为模型空间）摆放部件
function segment(from, to, radius, mat) {
  const len = Math.max(from.distanceTo(to), 1e-4);
  const geo = new THREE.CapsuleGeometry(radius, len, 6, 14);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(from).add(to).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  return m;
}
// GLTFLoader 会去掉节点名里的 "."（Foot.L -> FootL），这里只按骨骼匹配，避开同名的机器人网格节点
function findBone(root, name) {
  const key = name.replace(/\./g, "");
  let hit = null;
  // 重名节点会被加 _1 后缀（Torso 网格与 Torso 骨骼同名 -> Torso_1）
  const norm = (n) => n.replace(/[.\s]/g, "").replace(/_\d+$/, "");
  root.traverse((o) => { if (!hit && o.isBone && norm(o.name) === key) hit = o; });
  if (!hit) {
    const all = [];
    root.traverse((o) => { if (o.isBone) all.push(o.name); });
    throw new Error("bone not found: " + name + " in [" + all.join(",") + "]");
  }
  return hit;
}

export function buildAstronaut(root) {
  root.updateMatrixWorld(true);
  // 1) 去掉机器人外形（蒙皮网格 + 挂在骨骼上的静态网格），骨骼和动画保留
  const robotMeshes = [];
  root.traverse((o) => { if (o.isMesh) robotMeshes.push(o); });
  for (const m of robotMeshes) m.parent.remove(m);

  const bone = (n) => findBone(root, n);
  const wp = (n) => bone(n).getWorldPosition(new THREE.Vector3());
  const mats = makeAstronautMaterials();
  const parts = [];
  const add = (boneName, mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    bone(boneName).attach(mesh); // 保留当前世界变换挂到骨骼
    parts.push(mesh);
    return mesh;
  };
  // 部件先设模型空间位姿，再 attach（attach 会保留世界变换并换算成骨骼局部）
  const place = (boneName, mesh, pos) => { mesh.position.copy(pos); return add(boneName, mesh); };
  const sph = (r, mat, ws = 24, hs = 16) => new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), mat);

  const hips = wp("Hips"), neck = wp("Neck"), head = wp("Head");
  const H = head.y; // 以头部高度为比例基准
  const up = (v, k) => v.clone().add(new THREE.Vector3(0, k * H, 0));
  const ring = (r, t, mat) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, t, 10, 36), mat);
    m.rotation.x = Math.PI / 2;
    return m;
  };

  // 躯干（胶囊）+ 骨盆 + 腰带
  // 身体粗壮系数：只作用于躯干/四肢，头盔、面罩、颈环不动
  const BULK = 1.22;
  add("Torso", segment(up(hips, 0.08), up(neck, -0.06), 0.15 * H * BULK, mats.suit));
  place("Hips", sph(0.145 * H * BULK, mats.suit), hips);
  // 胸甲：压扁的椭球，宽肩厚胸的力量感
  const chestPlate = sph(0.17 * H, mats.suit, 28, 18);
  chestPlate.scale.set(1.45, 0.95, 1.0);
  place("Torso", chestPlate, hips.clone().lerp(neck, 0.68));
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.147 * H * BULK, 0.018 * H, 8, 32), mats.seam);
  belt.rotation.x = Math.PI / 2;
  place("Hips", belt, up(hips, 0.06));
  // 生命维持背包（PLSS）+ 两个氧气罐，在背后 -Z（角色面朝 +Z）
  const chest = hips.clone().lerp(neck, 0.6);
  place("Torso", new THREE.Mesh(new THREE.BoxGeometry(0.36 * H, 0.42 * H, 0.17 * H), mats.pack), chest.clone().add(new THREE.Vector3(0, 0.02 * H, -0.23 * H))); // 躯干变厚，背包后移
  const tankGeo = new THREE.CylinderGeometry(0.045 * H, 0.045 * H, 0.38 * H, 14);
  for (const sx of [-1, 1]) {
    const p = chest.clone().add(new THREE.Vector3(sx * 0.1 * H, 0.03 * H, -0.34 * H));
    place("Torso", new THREE.Mesh(tankGeo, mats.metal), p);
  }
  // 胸前控制盒 + 状态灯
  const boxPos = chest.clone().add(new THREE.Vector3(0, -0.04 * H, 0.18 * H)); // 贴在加厚的胸甲外
  const boxGeo = new THREE.BoxGeometry(0.17 * H, 0.09 * H, 0.06 * H);
  place("Torso", new THREE.Mesh(boxGeo, mats.pack), boxPos);
  const ledPos = boxPos.clone().add(new THREE.Vector3(0.05 * H, 0.015 * H, 0.032 * H));
  place("Torso", sph(0.012 * H, mats.light, 8, 6), ledPos);
  // 手臂：肩 -> 肘 -> 手（手腕点取前臂骨沿方向延长）
  for (const s of ["L", "R"]) {
    const sh = wp("UpperArm." + s), el = wp("LowerArm." + s);
    const hand = el.clone().add(el.clone().sub(sh).multiplyScalar(0.9));
    add("UpperArm." + s, segment(sh, el, 0.07 * H * BULK, mats.suit));
    place("UpperArm." + s, sph(0.085 * H * BULK * 1.08, mats.suit), sh); // 肩部护垫更厚
    add("LowerArm." + s, segment(el, hand, 0.062 * H * BULK, mats.suit));
    place("LowerArm." + s, sph(0.07 * H * BULK, mats.glove), hand);
  }
  // 腿：髋 -> 膝 -> 脚踝；靴子挂在 IK 脚骨上
  for (const s of ["L", "R"]) {
    const hip = wp("UpperLeg." + s), knee = wp("LowerLeg." + s), foot = wp("Foot." + s);
    add("UpperLeg." + s, segment(hip, knee, 0.085 * H * BULK, mats.suit));
    add("LowerLeg." + s, segment(knee, up(foot, 0.04), 0.075 * H * BULK, mats.suit));
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13 * H * BULK, 0.09 * H, 0.21 * H * BULK), mats.boot);
    place("Foot." + s, boot, foot.clone().add(new THREE.Vector3(0, 0.03 * H, 0.03 * H)));
  }
  // 头盔：大白壳 + 金色面罩（半球朝前 +Z）+ 颈环
  const hc = up(head, 0.1);
  place("Head", sph(0.2 * H, mats.suit, 32, 24), hc);
  place("Neck", ring(0.15 * H, 0.025 * H, mats.metal), up(neck, 0.02));
  // 面罩：球冠，轴向 +Z，比壳略大一点包在前脸
  const visorGeo = new THREE.SphereGeometry(0.205 * H, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.32);
  visorGeo.rotateX(Math.PI / 2);
  const visor = place("Head", new THREE.Mesh(visorGeo, mats.visor), hc.clone());
  visor.name = "visor";
  // 面罩边框：一圈金属环，法线朝 +Z
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.175 * H, 0.014 * H, 8, 40), mats.metal);
  place("Head", rim, hc.clone().add(new THREE.Vector3(0, 0, 0.105 * H)));
  // 左臂红色臂章
  const band = ring(0.074 * H, 0.012 * H, mats.accent);
  const shL = wp("UpperArm.L"), elL = wp("LowerArm.L");
  band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), elL.clone().sub(shL).normalize());
  place("UpperArm.L", band, shL.clone().lerp(elL, 0.45));
  root.name = "astronaut";
  return { root, materials: mats, parts, H };
}
