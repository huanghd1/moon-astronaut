import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { playerController } from "three-player-controller";
import { createTerrain } from "./terrain.js";
import { createSky } from "./sky/index.js";
import { createPost } from "./post.js";
import { buildAstronaut } from "./astronaut.js";
import { createReflectionEnv } from "./envmap.js";
import { createGui } from "./gui.js";
import { createCompanion } from "./companion.js";
import { createSlab } from "./slab.js";
import { TERRAIN } from "./terrain.js";

// 角色高度 = 180 * SCALE（控制器内部按 180 归一化）
const SCALE = 0.01;

// 月球手感（游戏化低重力，单位 m、m/s、m/s²）：起跳 3.4m/s、重力 -3.2 → 跳高约 1.8m、滞空约 2.1s
export const LUNAR = { gravity: -3.2, jumpSpeed: 3.4, walk: 1.5, run: 3.6 };
// 电影感大广角：35mm 全画幅下约 18mm 镜头（垂直 FOV 62°），镜头略远、看向点偏低让地平线入画
export const CINE = { fov: 62, minDist: 2.2, maxDist: 9, lookAtHeight: 0.85, pitchDeg: 9 };
const toCtrl = (v) => v / SCALE; // 控制器参数以 1/SCALE 为基准单位

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(CINE.fov, window.innerWidth / window.innerHeight, 0.05, 5000);
camera.position.set(0, 3, 6);
const controls = new OrbitControls(camera, renderer.domElement);
// 指针锁定后视角由控制器处理；此时再点击会让 OrbitControls 的 setPointerCapture 抛 InvalidStateError
renderer.domElement.addEventListener(
  "pointerdown",
  (e) => { if (document.pointerLockElement) e.stopImmediatePropagation(); },
  { capture: true }
);

// 程序化月面 + 碎石
const moon = createTerrain();
const terrain = moon.mesh;
scene.add(terrain, moon.rocks);
// 地层实体：5m 岩石侧壁 + 底面；四周隐形墙 + 托底平面（地形尺寸不变）
const slab = createSlab(terrain, TERRAIN.half, TERRAIN.segments);
scene.add(slab.group);

// 太阳系天空：银河、星点、太阳、地球、行星
const sky = createSky();
scene.add(sky.group);

// 月面光照：真空里只有硬朗的太阳直射光 + 很弱的冷色地照/天光补光
scene.add(new THREE.HemisphereLight(0x6f86b8, 0x1a1a1a, 0.12));
const earthshine = new THREE.DirectionalLight(0x9db8ff, 0.1);
scene.add(earthshine);
const sun = new THREE.DirectionalLight(0xfff2e0, 4.2);
const SUN_DIR = sky.sunDir;
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 400 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
function followSun(p) {
  sun.target.position.copy(p);
  sun.position.copy(p).addScaledVector(SUN_DIR, 150);
  rimLight.target.position.copy(p);
  rimLight.position.copy(p).add(new THREE.Vector3(-SUN_DIR.x, 0.6, -SUN_DIR.z).multiplyScalar(50));
}

// 冷色轮廓光：从太阳对侧偏上打来，逆光时勾出宇航服边缘（不投影）
const rimLight = new THREE.DirectionalLight(0x9fc4ff, 0.6);
scene.add(rimLight, rimLight.target);

// 骨骼与动画来自 CC0 机器人，外形替换为几何体拼的小宇航员
const gltf = await new GLTFLoader().loadAsync("/models/RobotExpressive.glb");
const astronaut = buildAstronaut(gltf.scene);
// 面罩反射环境：跟随太阳/地球方向，方向变化时重新烘焙 PMREM
const astroEnv = createReflectionEnv(renderer, sky.sunDir, sky.earthDir);
astroEnv.bind(Object.values(astronaut.materials));
astroEnv.update();

// 小机器人跟班：另载一份 CC0 RobotExpressive（宇航员那份的外形已被替换）
const buddyGltf = await new GLTFLoader().loadAsync("/models/RobotExpressive.glb");
const buddy = createCompanion(buddyGltf, moon.heightAt);
scene.add(buddy.root);

const player = new playerController();
await player.init({
  scene,
  camera,
  controls,
  playerModelConfig: {
    model: gltf.scene,
    animations: gltf.animations,
    scale: SCALE,
    idleAnim: "Idle",
    walkAnim: "Walking",
    runAnim: "Running",
    jumpAnim: "Jump",
    gravity: toCtrl(LUNAR.gravity),
    jumpHeight: toCtrl(LUNAR.jumpSpeed),
    speed: toCtrl(LUNAR.walk),
    runSpeed: toCtrl(LUNAR.run),
    acceleration: 6, // 月面上起步/停下更"飘"
    deceleration: 4,
  },
  minCamDistance: toCtrl(CINE.minDist),
  maxCamDistance: toCtrl(CINE.maxDist),
  camLookAtHeightRatio: CINE.lookAtHeight,
  enableZoom: true,
  enableSpringCamera: true,
  springCameraTime: 0.18,
  followPlayerDirection: true,
  playerDirectionFollowSpeed: 1.2,
  initPos: new THREE.Vector3(0, moon.heightAt(0, 0) + 2, 0),
  colliders: [
    { motion: "static", shape: { kind: "mesh", source: terrain } },
    // 不可见的 Box 网格作为边界墙 / 托底碰撞体（控制器按网格收集，与可见性无关）
    { motion: "static", shape: { kind: "mesh", source: slab.walls } },
    { motion: "static", shape: { kind: "mesh", source: slab.floor } },
  ],
});

// 低机位：控制器默认俯角约 27°，改成贴地仰望感，让地平线和天空进入画面上 1/3
function setCinematicPitch(deg) {
  const off = camera.position.clone().sub(controls.target);
  const d = off.length();
  const flat = off.setY(0).normalize();
  const e = THREE.MathUtils.degToRad(deg);
  camera.position.copy(controls.target).addScaledVector(flat, d * Math.cos(e)).setY(controls.target.y + d * Math.sin(e));
  camera.lookAt(controls.target);
}
// 控制器 init 里用 rAF 设定初始相机，这里排在它之后
requestAnimationFrame(() => setCinematicPitch(CINE.pitchDeg));

const post = createPost(renderer, scene, camera);
post.setSize(window.innerWidth, window.innerHeight);

// 环境面板（右上角，可折叠）
const gui = createGui({ sky, post, terrain, sunLight: sun, renderer, onSkyChange: () => astroEnv.invalidate() });

const clock = new THREE.Clock();
let frames = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  player.update(dt);
  if (player.playerModel) {
    followSun(player.playerModel.position);
    buddy.update(dt, player.playerModel);
  }
  earthshine.position.copy(sky.earthDir);
  sky.update(camera, renderer, clock.elapsedTime);
  astroEnv.update(); // 仅在太阳/地球方向变了之后烘焙一次
  post.render(clock.elapsedTime);
  frames++;
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});

// 供自动化测试读取的只读状态
window.__game = {
  get ready() { return frames > 10; },
  get frames() { return frames; },
  playerPos() {
    const p = player.playerModel.getWorldPosition(new THREE.Vector3());
    return { x: p.x, y: p.y, z: p.z };
  },
  get onGround() { return player.playerIsOnGround; },
  terrainStats: moon.stats,
  terrainMaterial: terrain.material,
  physics: () => ({ gravity: player.gravity, jump: player.jumpHeight, walk: player.playerSpeed, run: player.playerRunSpeed }),
  camera: () => {
    const off = camera.position.clone().sub(controls.target);
    return { fov: camera.fov, dist: off.length(), pitchDeg: THREE.MathUtils.radToDeg(Math.asin(off.y / off.length())) };
  },
  heightAt: moon.heightAt,
  slab: slab.info,
  // 测试用：把玩家瞬移到指定位置（用于验证边界墙、托底）
  teleport(x, y, z) { player.reset(new THREE.Vector3(x, y, z)); },
  // 测试用：交出相机控制权，从地图外取景（截地层侧面）
  freeCamera(from, to) {
    player.setManageCamera(false);
    camera.position.set(...from);
    controls.target.set(...to);
    camera.lookAt(controls.target);
  },
  astronaut,
  gui,
  astroEnv,
  buddy,
  // 读真实几何参数（以头部高度 H 归一化），验证"身体加粗、头不动"
  bodyMetrics() {
    const H = astronaut.H, onBone = (re) => astronaut.parts.filter((m) => re.test(m.parent.name));
    const isCap = (m) => m.geometry.type === "CapsuleGeometry";
    const cap = (re) => Math.max(...onBone(re).filter(isCap).map((m) => m.geometry.parameters.radius)) / H;
    const head = onBone(/^Head/).filter((m) => m.geometry.type === "SphereGeometry");
    const visor = astronaut.root.getObjectByName("visor");
    const shell = head.find((m) => m !== visor);
    return {
      helmet: shell.geometry.parameters.radius / H,
      visor: visor.geometry.parameters.radius / H,
      torso: cap(/^Torso/), upperArm: cap(/^UpperArm/), thigh: cap(/^UpperLeg/),
    };
  },
  buddyInfo() {
    const goal = buddy.goal(player.playerModel);
    const p = buddy.root.position, me = player.playerModel.getWorldPosition(new THREE.Vector3());
    // 换算到玩家坐标系：right>0 在右手边，back>0 在身后
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(player.playerModel.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
    const dx = p.x - me.x, dz = p.z - me.z;
    const right = -dx * f.z + dz * f.x;
    const back = -(dx * f.x + dz * f.z);
    return {
      dist: Math.hypot(dx, dz), right, back,
      goalGap: Math.hypot(p.x - goal.x, p.z - goal.z),
      groundGap: Math.abs(p.y - moon.heightAt(p.x, p.z)),
      anim: buddy.animation,
    };
  },
  astronautInfo() {
    let robotMeshes = 0;
    const own = new Set(astronaut.parts);
    astronaut.root.traverse((o) => { if (o.isMesh && !own.has(o)) robotMeshes++; });
    const visor = astronaut.root.getObjectByName("visor");
    const visorMetal = visor?.material.metalness ?? 0;
    return { parts: astronaut.parts.length, visor: !!visor, visorMetal, robotMeshes };
  },
  astronautScreen() {
    const b = new THREE.Box3().setFromObject(astronaut.root);
    const top = b.getCenter(new THREE.Vector3()).setY(b.max.y).project(camera);
    const bot = b.getCenter(new THREE.Vector3()).setY(b.min.y).project(camera);
    return { frac: Math.abs(top.y - bot.y) / 2, heightM: b.max.y - b.min.y };
  },
  playerHeight() {
    const b = new THREE.Box3().setFromObject(astronaut.root);
    return b.max.y - b.min.y;
  },
  sky,
  post,
  // 天体在屏幕上的归一化坐标（0..1，左上为原点），用于断言构图
  project(name) {
    const o = sky.group.getObjectByName(name);
    const v = o.getWorldPosition(new THREE.Vector3()).project(camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, inFront: v.z < 1 };
  },
};
