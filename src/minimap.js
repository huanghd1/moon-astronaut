// 圆形雷达小地图：纯 Canvas 2D，不开第二个 3D 相机。
// “航向朝上”雷达：玩家箭头固定在中心指向上方，底图（坑、跟班、北向标记）随玩家位置和朝向反向移动/旋转。
export const MINIMAP = { size: 200, range: 140, maxCraters: 60 };

export function createMinimap(craters) {
  const S = MINIMAP.size, R = S / 2;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  canvas.id = "minimap";
  canvas.width = canvas.height = S * dpr;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "雷达小地图：显示玩家位置、朝向、附近陨石坑和机器人跟班");
  document.body.appendChild(canvas);
  const g = canvas.getContext("2d");
  g.scale(dpr, dpr);
  // 地标：只取较大的坑（半径 ≥ 10m），按大小分色，数量封顶，每帧只画在雷达范围内的
  const marks = craters
    .filter((c) => c.r >= 10)
    .sort((a, b) => b.r - a.r)
    .slice(0, MINIMAP.maxCraters)
    .map((c) => ({ x: c.x, z: c.z, r: c.r, big: c.r >= 35 }));
  const k = (R - 10) / MINIMAP.range; // 米 -> 像素
  // 世界坐标 -> 雷达坐标：前方 = 屏幕上方，右手 = 屏幕右侧
  // 右手向量 = forward × up = (-fz, fx)（面朝 +Z 时右手为 -X，与 companion.js 一致）
  const toRadar = (p, wx, wz) => {
    const dx = wx - p.x, dz = wz - p.z;
    return [R + (-dx * p.fz + dz * p.fx) * k, R - (dx * p.fx + dz * p.fz) * k];
  };
  // 静态底盘：深灰半透明圆 + 距离环 + 十字刻度，只画一次缓存起来
  const base = document.createElement("canvas");
  base.width = base.height = S * dpr;
  const b = base.getContext("2d");
  b.scale(dpr, dpr);
  const bg = b.createRadialGradient(R, R, 0, R, R, R);
  bg.addColorStop(0, "rgba(38, 42, 48, 0.62)");
  bg.addColorStop(1, "rgba(14, 16, 20, 0.78)");
  b.fillStyle = bg;
  b.beginPath(); b.arc(R, R, R - 1, 0, Math.PI * 2); b.fill();
  b.strokeStyle = "rgba(160, 200, 230, 0.16)";
  b.lineWidth = 1;
  for (const f of [1 / 3, 2 / 3]) { b.beginPath(); b.arc(R, R, (R - 10) * f, 0, Math.PI * 2); b.stroke(); }
  b.beginPath(); b.moveTo(R, 8); b.lineTo(R, S - 8); b.moveTo(8, R); b.lineTo(S - 8, R); b.stroke();
  b.strokeStyle = "rgba(200, 225, 245, 0.45)";
  b.lineWidth = 1.5;
  b.beginPath(); b.arc(R, R, R - 1.5, 0, Math.PI * 2); b.stroke();
  b.fillStyle = "rgba(200, 225, 245, 0.5)";
  b.font = "10px system-ui, sans-serif";
  b.fillText(`${MINIMAP.range}m`, R + 4, 14);
  let visibleMarks = 0;
  // p = { x, z, fx, fz }（玩家位置 + 水平朝向单位向量）；buddy = { x, z } 或 null
  function draw(p, buddy) {
    g.clearRect(0, 0, S, S);
    g.drawImage(base, 0, 0, S, S);
    g.save();
    g.beginPath(); g.arc(R, R, R - 3, 0, Math.PI * 2); g.clip();
    // 陨石坑地标：大坑琥珀色、中坑青色，圈的大小按真实半径
    visibleMarks = 0;
    for (const m of marks) {
      const [sx, sy] = toRadar(p, m.x, m.z);
      const rr = Math.max(2.5, m.r * k);
      if (Math.hypot(sx - R, sy - R) > R + rr) continue;
      visibleMarks++;
      g.strokeStyle = m.big ? "rgba(255, 184, 92, 0.85)" : "rgba(110, 214, 230, 0.75)";
      g.fillStyle = m.big ? "rgba(255, 184, 92, 0.12)" : "rgba(110, 214, 230, 0.1)";
      g.lineWidth = 1.2;
      g.beginPath(); g.arc(sx, sy, rr, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // 机器人跟班：绿色小点
    if (buddy) {
      const [bx, by] = toRadar(p, buddy.x, buddy.z);
      g.fillStyle = "#7dffa8";
      g.beginPath(); g.arc(bx, by, 3.5, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    // 北向标记 N（世界 -Z 为北），贴着外圈随朝向转动
    const [nx, ny] = toRadar(p, p.x, p.z - 1);
    const nl = Math.hypot(nx - R, ny - R) || 1;
    g.fillStyle = "rgba(255, 120, 100, 0.95)";
    g.font = "bold 11px system-ui, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("N", R + ((nx - R) / nl) * (R - 13), R + ((ny - R) / nl) * (R - 13));
    g.textAlign = "start"; g.textBaseline = "alphabetic";
    // 玩家：固定在中心、指向上方的白色箭头
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(R, R - 9); g.lineTo(R + 6, R + 6); g.lineTo(R, R + 3); g.lineTo(R - 6, R + 6);
    g.closePath(); g.fill();
  }
  return {
    canvas,
    draw,
    toRadar, // 供测试：验证世界坐标到雷达坐标的映射
    get visibleMarks() { return visibleMarks; },
    get markCount() { return marks.length; },
  };
}
