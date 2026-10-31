import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { playerController } from "three-player-controller";
import { createTerrain } from "./terrain.js";
import { createSky } from "./sky/index.js";

// 角色高度 = 180 * SCALE（控制器内部按 180 归一化）
const SCALE = 0.01;

// 月球手感（游戏化低重力，单位 m、m/s、m/s²）：起跳 3.4m/s、重力 -3.2 → 跳高约 1.8m、滞空约 2.1s
export const LUNAR = { gravity: -3.2, jumpSpeed: 3.4, walk: 1.5, run: 3.6 };
// 电影感大广角：35mm 全画幅下约 18mm 镜头（垂直 FOV 62°），镜头略远、看向点偏低让地平线入画
export const CINE = { fov: 62, minDist: 2.2, maxDist: 6.5, lookAtHeight: 0.85, pitchDeg: 9 };
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
}

const gltf = await new GLTFLoader().loadAsync("/models/RobotExpressive.glb");

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
  colliders: [{ motion: "static", shape: { kind: "mesh", source: terrain } }],
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

const clock = new THREE.Clock();
let frames = 0;
function animate() {
  requestAnimationFrame(animate);
  player.update(Math.min(clock.getDelta(), 0.05));
  if (player.playerModel) followSun(player.playerModel.position);
  earthshine.position.copy(sky.earthDir);
  sky.update(camera, renderer, clock.elapsedTime);
  renderer.render(scene, camera);
  frames++;
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
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
  physics: () => ({ gravity: player.gravity, jump: player.jumpHeight, walk: player.playerSpeed, run: player.playerRunSpeed }),
  camera: () => {
    const off = camera.position.clone().sub(controls.target);
    return { fov: camera.fov, dist: off.length(), pitchDeg: THREE.MathUtils.radToDeg(Math.asin(off.y / off.length())) };
  },
  heightAt: moon.heightAt,
  sky,
  // 天体在屏幕上的归一化坐标（0..1，左上为原点），用于断言构图
  project(name) {
    const o = sky.group.getObjectByName(name);
    const v = o.getWorldPosition(new THREE.Vector3()).project(camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, inFront: v.z < 1 };
  },
};
