import * as THREE from "three";

// 小机器人跟班：CC0 RobotExpressive，缩小到约 0.95m，跟在玩家右后方 2m，
// 位置用帧率无关的指数平滑插值，朝向平滑转向移动方向，按速度切换 Idle/Walking/Running 动画。
export const COMPANION = { height: 0.95, offsetRight: 1.4, offsetBack: 1.4, smooth: 3.2 };
// 右 1.4m + 后 1.4m ≈ 斜后方 2m

export function createCompanion(gltf, heightAt) {
  const root = gltf.scene;
  root.name = "companion";
  // 按包围盒高度缩放到目标身高
  const box = new THREE.Box3().setFromObject(root);
  root.scale.multiplyScalar(COMPANION.height / (box.max.y - box.min.y));
  root.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
  });
  const mixer = new THREE.AnimationMixer(root);
  const clip = (n) => gltf.animations.find((a) => a.name === n);
  const actions = {
    idle: mixer.clipAction(clip("Idle")),
    walk: mixer.clipAction(clip("Walking")),
    run: mixer.clipAction(clip("Running")),
  };
  let current = actions.idle;
  current.play();
  const fadeTo = (next) => {
    if (next === current) return;
    next.reset().play();
    current.crossFadeTo(next, 0.35, false);
    current = next;
  };
  const target = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
  const prev = new THREE.Vector3();
  // player: 宇航员根节点（面朝本地 +Z）
  function place(player) {
    fwd.set(0, 0, 1).applyQuaternion(player.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
    right.set(-fwd.z, 0, fwd.x); // fwd × up = (-fz, 0, fx)：面朝 +Z 时右手为 -X
    const p = player.getWorldPosition(target);
    p.addScaledVector(right, COMPANION.offsetRight).addScaledVector(fwd, -COMPANION.offsetBack);
    p.y = heightAt(p.x, p.z);
    return p;
  }
  const yAxis = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion();
  let spawned = false;
  function update(dt, player) {
    const goal = place(player);
    if (!spawned) { root.position.copy(goal); spawned = true; }
    prev.copy(root.position);
    // 帧率无关的指数平滑：1 - e^(-k·dt)
    root.position.lerp(goal, 1 - Math.exp(-COMPANION.smooth * dt));
    root.position.y = heightAt(root.position.x, root.position.z); // 始终贴地
    const speed = dt > 0 ? Math.hypot(root.position.x - prev.x, root.position.z - prev.z) / dt : 0;
    // 朝向：移动时朝移动方向，停下时与玩家同向（机器人本地 +Z 为正面）
    const moving = speed > 0.15;
    const yaw = moving ? Math.atan2(root.position.x - prev.x, root.position.z - prev.z) : Math.atan2(fwd.x, fwd.z);
    q.setFromAxisAngle(yAxis, yaw);
    root.quaternion.slerp(q, 1 - Math.exp(-6 * dt));
    fadeTo(speed > 2.2 ? actions.run : moving ? actions.walk : actions.idle);
    mixer.update(dt);
  }
  return {
    root,
    update,
    goal: (player) => place(player).clone(),
    get animation() { return current.getClip().name; },
  };
}
