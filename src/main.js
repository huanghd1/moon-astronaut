import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { playerController } from "three-player-controller";

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

// 月面：简单起伏地形（后续步骤替换为程序化陨石坑地形）
const terrainGeo = new THREE.PlaneGeometry(400, 400, 200, 200);
terrainGeo.rotateX(-Math.PI / 2);
const pos = terrainGeo.attributes.position;
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i);
  const z = pos.getZ(i);
  pos.setY(i, Math.sin(x * 0.05) * Math.cos(z * 0.04) * 1.2 + Math.sin(x * 0.17 + z * 0.13) * 0.3);
}
terrainGeo.computeVertexNormals();
const terrain = new THREE.Mesh(
  terrainGeo,
  new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 1 })
);
terrain.name = "moonTerrain";
terrain.receiveShadow = true;
scene.add(terrain);

scene.add(new THREE.HemisphereLight(0x8899aa, 0x222222, 0.4));
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.position.set(30, 40, 20);
sun.castShadow = true;
scene.add(sun);

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
  initPos: new THREE.Vector3(0, 3, 0),
  colliders: [{ motion: "static", shape: { kind: "mesh", source: terrain } }],
});

const clock = new THREE.Clock();
let frames = 0;
function animate() {
  requestAnimationFrame(animate);
  player.update(Math.min(clock.getDelta(), 0.05));
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
};
