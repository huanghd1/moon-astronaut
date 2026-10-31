import * as THREE from "three";

// 宇航员专用反射环境：漆黑天空 + 一颗刺眼太阳 + 冷色地球 + 暖灰月面，用 PMREM 烘焙
// 只给宇航服/面罩用，不改变地形光照。太阳/地球方向变化时重新烘焙（每帧最多一次）
export function createReflectionEnv(renderer, sunDir, earthDir) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x000000);
  const groundMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.32, 0.3, 0.28) });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(50, 32).rotateX(-Math.PI / 2), groundMat);
  ground.position.y = -2;
  // HDR 太阳亮点：反射到金色面罩上会超过 bloom 阈值
  const sunMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(60, 56, 50) });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 8), sunMat);
  const earthMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.8, 1.4) });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 8), earthMat);
  env.add(ground, sun, earth);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const bound = [];
  let rt = null, dirty = true, bakes = 0;
  function bake() {
    sun.position.copy(sunDir).multiplyScalar(20);
    earth.position.copy(earthDir).multiplyScalar(20);
    const old = rt;
    rt = pmrem.fromScene(env, 0.02);
    for (const m of bound) { m.envMap = rt.texture; m.needsUpdate = true; }
    old?.dispose();
    dirty = false;
    bakes++;
  }
  return {
    bind(materials) { bound.push(...materials); if (rt) for (const m of materials) m.envMap = rt.texture; },
    invalidate() { dirty = true; }, // 拖动滑块时调用，合并到下一帧只烘焙一次
    update() { if (dirty) bake(); },
    get texture() { return rt?.texture; },
    get bakes() { return bakes; },
    sunMesh: sun,
  };
}
