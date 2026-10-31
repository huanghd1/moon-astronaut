import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { playerController } from "three-player-controller";
import { createTerrain } from "./terrain.js";

// 角色高度 = 180 * SCALE（控制器内部按 180 归一化）
const SCALE = 0.01;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 5000);
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

scene.add(new THREE.HemisphereLight(0x8899aa, 0x222222, 0.4));
const sun = new THREE.DirectionalLight(0xffffff, 3);
const SUN_DIR = new THREE.Vector3(-0.8, 0.28, -0.45).normalize();
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
  },
  initPos: new THREE.Vector3(0, moon.heightAt(0, 0) + 2, 0),
  colliders: [{ motion: "static", shape: { kind: "mesh", source: terrain } }],
});

const clock = new THREE.Clock();
let frames = 0;
function animate() {
  requestAnimationFrame(animate);
  player.update(Math.min(clock.getDelta(), 0.05));
  if (player.playerModel) followSun(player.playerModel.position);
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
  heightAt: moon.heightAt,
};
