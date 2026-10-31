import * as THREE from "three";
import { createMilkyWay, createStars } from "./milkyway.js";
import { createEarth, createSun, createPlanets } from "./bodies.js";

const R = 4000; // 天穹半径（相机 far = 5000）
const deg = THREE.MathUtils.degToRad;

// 方位角以默认镜头朝向为 0°，正值向画面右侧；仰角从地平线算起
export function dirFromAngles(azDeg, elDeg, out = new THREE.Vector3()) {
  const az = deg(azDeg), el = deg(elDeg);
  return out.set(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

// 电影感默认值：低角度硬光太阳在画面右侧框外，地球悬在左上
export const SKY_DEFAULTS = {
  sunAzimuth: 42,
  sunElevation: 10,
  earthAzimuth: -27,
  earthElevation: 12,
  earthSizeDeg: 3.6, // 真实约 1.9°，电影里通常放大
  starIntensity: 1,
  milkyWay: 1,
};

export function createSky(params = {}) {
  const settings = { ...SKY_DEFAULTS, ...params };
  const group = new THREE.Group();
  group.name = "sky";

  const milkyWay = createMilkyWay(R);
  const stars = createStars(R * 0.98);
  const sun = createSun(1);
  const earthDist = R * 0.75;
  const earth = createEarth(1);
  const planets = createPlanets(R * 0.97, [
    { name: "venus", dir: dirFromAngles(70, 18), color: 0xfff6e0, bright: 1.4, size: 0.006 },
    { name: "jupiter", dir: dirFromAngles(-70, 38), color: 0xffe6c4, bright: 1.0, size: 0.005 },
    { name: "mars", dir: dirFromAngles(-120, 30), color: 0xff8a5c, bright: 0.8, size: 0.004 },
    { name: "saturn", dir: dirFromAngles(150, 45), color: 0xffe9b0, bright: 0.7, size: 0.004 },
  ]);
  group.add(milkyWay, stars, planets, sun, earth);

  const sunDir = new THREE.Vector3();
  const earthDir = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();

  function apply() {
    dirFromAngles(settings.sunAzimuth, settings.sunElevation, sunDir);
    dirFromAngles(settings.earthAzimuth, settings.earthElevation, earthDir);
    sun.position.copy(sunDir).multiplyScalar(R * 0.9);
    sun.scale.setScalar(R * 0.9 * Math.tan(deg(0.45)) * 8); // 日面视直径约 0.9°
    earth.position.copy(earthDir).multiplyScalar(earthDist);
    earth.scale.setScalar(earthDist * Math.tan(deg(settings.earthSizeDeg / 2)));
    stars.material.uniforms.uIntensity.value = settings.starIntensity;
    milkyWay.material.uniforms.uIntensity.value = settings.milkyWay;
  }
  apply();

  return {
    group,
    settings,
    sunDir,
    earthDir,
    earth,
    sun,
    stars,
    set(patch) {
      Object.assign(settings, patch);
      apply();
    },
    update(camera, renderer, t) {
      group.position.copy(camera.position); // 天空无限远：始终以相机为中心
      stars.material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
      // 地球的光照方向换算到地球局部坐标
      earth.rotation.y = t * 0.01;
      tmpQ.copy(earth.quaternion).invert();
      earth.material.uniforms.uSunDir.value.copy(sunDir).applyQuaternion(tmpQ);
      earth.material.uniforms.uTime.value = t;
    },
  };
}
