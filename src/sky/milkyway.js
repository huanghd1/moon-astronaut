import * as THREE from "three";
import { NOISE_GLSL, OUTPUT_GLSL } from "./glsl.js";
import { mulberry32 } from "../rng.js";

// 银道面法线：银河带斜跨天空
export const GALACTIC_NORMAL = new THREE.Vector3(0.85, 0.42, -0.12).normalize();
const GALACTIC_CENTER = new THREE.Vector3(1, 0, 0)
  .projectOnPlane(GALACTIC_NORMAL).normalize()
  .applyAxisAngle(GALACTIC_NORMAL, 0.6);

// 天穹：银河辉光 + 暗尘带 + 暖色银心 + 极淡的冷色星云
export function createMilkyWay(radius) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uIntensity: { value: 1 },
      uNormal: { value: GALACTIC_NORMAL },
      uCenter: { value: GALACTIC_CENTER },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w; // 永远在最远处
      }`,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      uniform vec3 uNormal, uCenter;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float lat = dot(d, uNormal);           // 距银道面的"纬度"
        float toCore = dot(d, uCenter) * 0.5 + 0.5;
        float band = exp(-lat * lat / 0.018);
        float core = pow(toCore, 6.0) * exp(-lat * lat / 0.05);
        float clouds = fbm(d * 5.0);
        float dust = smoothstep(0.45, 0.75, fbm(d * 9.0 + 3.1)) * exp(-lat * lat / 0.004);
        float glow = band * (0.35 + 0.9 * clouds) * (1.0 - 0.85 * dust) + core * 1.4 * (1.0 - 0.7 * dust);
        vec3 col = mix(vec3(0.55, 0.62, 0.85), vec3(1.0, 0.82, 0.62), clamp(core * 2.0 + toCore * 0.3, 0.0, 1.0));
        vec3 neb = vec3(0.25, 0.35, 0.6) * smoothstep(0.55, 0.9, fbm(d * 3.0 + 9.0)) * 0.05;
        gl_FragColor = vec4((col * glow * 0.15 + neb) * uIntensity, 1.0);
        ${OUTPUT_GLSL}
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), mat);
  mesh.name = "milkyWay";
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

// 星点：约 1.4 万颗，按黑体色温上色，亮度幂律分布，集中在银河带
export function createStars(radius, count = 14000, seed = 7) {
  const rand = mulberry32(seed);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  const temps = [0xffb46b, 0xffd2a1, 0xfff4ea, 0xf8f7ff, 0xcad7ff, 0x9bb0ff];
  for (let i = 0; i < count; i++) {
    // 60% 均匀分布，40% 偏向银道面
    do {
      v.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
    } while (v.lengthSq() > 1 || v.lengthSq() < 1e-4);
    v.normalize();
    if (rand() < 0.4) {
      const lat = v.dot(GALACTIC_NORMAL);
      v.addScaledVector(GALACTIC_NORMAL, -lat * (0.85 + rand() * 0.15)).normalize();
    }
    pos.set([v.x * radius, v.y * radius, v.z * radius], i * 3);
    const mag = Math.pow(rand(), 9); // 绝大多数很暗，少数很亮
    c.setHex(temps[Math.floor(rand() * temps.length)]);
    const b = 0.25 + mag * 3.5;
    col.set([c.r * b, c.g * b, c.b * b], i * 3);
    size[i] = 1.2 + mag * 4.5;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("size", new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uIntensity: { value: 1 }, uPixelRatio: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float size;
      attribute vec3 color;
      uniform float uPixelRatio;
      varying vec3 vColor;
      void main() {
        vColor = color;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w * 0.99999;
        gl_PointSize = size * uPixelRatio;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      varying vec3 vColor;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(q, q);
        if (r2 > 1.0) discard;
        float a = exp(-r2 * 5.0);
        gl_FragColor = vec4(vColor * a * uIntensity, 1.0);
        ${OUTPUT_GLSL}
      }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = "stars";
  pts.renderOrder = -9;
  pts.frustumCulled = false;
  return pts;
}
