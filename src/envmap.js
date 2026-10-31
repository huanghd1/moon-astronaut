import * as THREE from "three";

// 宇航员专用反射环境：漆黑天空 + 一颗刺眼太阳 + 暖灰月面，用 PMREM 烘焙
// 只给宇航服/面罩用，不改变地形光照
export function bakeReflectionEnv(renderer, sunDir) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x000000);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(50, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.32, 0.3, 0.28) })
  );
  ground.position.y = -2;
  // HDR 太阳亮点：反射到金色面罩上会超过 bloom 阈值
  const sunMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(60, 56, 50) });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 8), sunMat);
  sun.position.copy(sunDir).multiplyScalar(20);
  env.add(ground, sun);
  // 一点冷色地球光，让暗面不至于纯黑
  const earthMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.8, 1.4) });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 8), earthMat);
  earth.position.set(10, 8, 14);
  env.add(earth);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.02);
  pmrem.dispose();
  return rt.texture;
}
