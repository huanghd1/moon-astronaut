import * as THREE from "three";
import { NOISE_GLSL, OUTPUT_GLSL } from "./glsl.js";

// 天体都挂在跟随相机的 skyGroup 下，距离只决定视角大小，不影响画面

// 程序化地球：大陆/海洋/冰盖/云层 + 镜面海洋高光 + 大气边缘散射 + 夜面城市灯光
export function createEarth(radius) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: new THREE.Vector3(1, 0, 0) }, // 物体局部坐标系下
      uTime: { value: 0 },
      uIntensity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform vec3 uSunDir;
      varying vec3 vObjNormal, vViewNormal, vViewPos, vSunView;
      void main() {
        vObjNormal = normalize(position);
        vSunView = normalize((modelViewMatrix * vec4(uSunDir, 0.0)).xyz);
        vViewNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform float uTime, uIntensity;
      varying vec3 vObjNormal, vViewNormal, vViewPos, vSunView;
      ${NOISE_GLSL}
      void main() {
        vec3 n = normalize(vObjNormal);
        float land = smoothstep(0.52, 0.56, fbm(n * 2.2 + 4.0));
        float lat = abs(n.y);
        float ice = smoothstep(0.78, 0.86, lat + fbm(n * 6.0) * 0.12);
        vec3 ocean = vec3(0.01, 0.05, 0.16);
        vec3 ground = mix(vec3(0.12, 0.16, 0.06), vec3(0.32, 0.25, 0.14), fbm(n * 8.0));
        vec3 albedo = mix(mix(ocean, ground, land), vec3(0.85), ice);
        vec3 cn = n + vec3(uTime * 0.004, 0.0, 0.0);
        float cloud = smoothstep(0.5, 0.75, fbm(cn * 3.5 + 11.0) * 0.7 + fbm(cn * 12.0) * 0.4);
        albedo = mix(albedo, vec3(0.95), cloud * 0.9);

        float ndl = dot(n, uSunDir);
        float day = smoothstep(-0.08, 0.25, ndl);
        vec3 col = albedo * max(ndl, 0.0) * 2.2;
        // 海洋太阳高光
        vec3 V = normalize(-vViewPos);
        vec3 vn = normalize(vViewNormal);
        vec3 H = normalize(normalize(vSunView) + V);
        col += vec3(1.0, 0.9, 0.75) * pow(max(dot(vn, H), 0.0), 60.0) * (1.0 - land) * (1.0 - cloud) * day * 1.5;
        // 夜面城市灯光
        float city = smoothstep(0.62, 0.8, fbm(n * 30.0)) * land * (1.0 - ice);
        col += vec3(1.0, 0.65, 0.3) * city * (1.0 - day) * 0.35;
        // 大气：边缘菲涅尔 + 晨昏线暖色
        float fres = pow(1.0 - max(dot(vn, V), 0.0), 3.0);
        vec3 atm = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.55, 0.3), smoothstep(0.25, -0.05, ndl) * step(-0.15, ndl));
        col += atm * fres * smoothstep(-0.2, 0.35, ndl) * 1.6;
        gl_FragColor = vec4(col * uIntensity, 1.0);
        ${OUTPUT_GLSL}
      }`,
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 48), mat);
  earth.name = "earth";
  earth.rotation.z = 0.41; // 黄赤交角
  return earth;
}

// 太阳：亮圆盘 + 指数衰减日冕 + 细长衍射星芒（真空中没有大气散射，太阳边缘很硬）
export function createSun(radius) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uIntensity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        // 公告板：始终面向相机
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float s = length(modelMatrix[0].xyz);
        mv.xy += position.xy * s;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      varying vec2 vUv;
      void main() {
        float r = length(vUv) * 8.0;  // 1.0 = 日面边缘
        float disc = 1.0 - smoothstep(0.96, 1.0, r);
        float limb = mix(0.75, 1.0, sqrt(max(1.0 - r * r, 0.0)));
        // 第 10 步调暗：日面 HDR 30 -> 12，日冕/星芒同比例降，泛光只剩贴着边缘的一圈柔光
        float corona = exp(-(r - 1.0) * 1.6) * step(1.0, r) * 0.24 + exp(-r * 0.35) * 0.03;
        float ang = atan(vUv.y, vUv.x);
        float rays = pow(abs(cos(ang * 3.0 + 0.4)), 400.0) * exp(-r * 0.6) * 0.14;
        vec3 col = vec3(1.0, 0.97, 0.92) * disc * limb * 12.0 + vec3(1.0, 0.86, 0.68) * (corona + rays);
        gl_FragColor = vec4(col * uIntensity, 1.0);
        ${OUTPUT_GLSL}
      }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  sun.scale.setScalar(radius * 8); // 平面边长 = 8 倍日面半径，留出日冕
  sun.name = "sunDisc";
  sun.frustumCulled = false;
  sun.renderOrder = -8;
  return sun;
}

// 远处行星：亮点 + 柔光，带一点颜色（金星/木星/火星/土星）
export function createPlanets(radius, dirs) {
  const group = new THREE.Group();
  group.name = "planets";
  for (const p of dirs) {
    const mat = new THREE.SpriteMaterial({
      map: glowTexture(),
      color: new THREE.Color(p.color).multiplyScalar(p.bright),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const s = new THREE.Sprite(mat);
    s.position.copy(p.dir).normalize().multiplyScalar(radius);
    s.scale.setScalar(radius * p.size);
    s.name = p.name;
    s.renderOrder = -8;
    group.add(s);
  }
  return group;
}

let _glow;
function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.08, "rgba(255,255,255,0.9)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.15)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _glow = new THREE.CanvasTexture(c);
  _glow.colorSpace = THREE.SRGBColorSpace;
  return _glow;
}
