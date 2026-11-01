import GUI from "lil-gui";

// 环境配置存档在 localStorage 里的键名（带版本号，参数结构大改时换个键即可让旧存档失效）
export const GUI_STORAGE_KEY = "moon-astronaut.gui.v1";

// 环境面板：每个控件 onChange 直接改 uniform / 材质 / 灯光，画面实时变化
export function createGui({ sky, post, terrain, sunLight, earthshine, renderer, onSkyChange = () => {} }) {
  const gui = new GUI({ title: "环境 Environment" });
  gui.close(); // 默认折叠，不遮挡右上角的太阳构图
  const s = sky.settings;
  const applySky = () => { sky.set({}); onSkyChange(); };
  const fSky = gui.addFolder("天空 Sky");
  fSky.add(s, "sunAzimuth", -180, 180, 1).name("太阳方位角").onChange(applySky);
  fSky.add(s, "sunElevation", -5, 80, 0.5).name("太阳仰角").onChange(applySky);
  fSky.add(s, "earthAzimuth", -180, 180, 1).name("地球方位角").onChange(applySky);
  fSky.add(s, "earthElevation", -5, 80, 0.5).name("地球仰角").onChange(applySky);
  fSky.add(s, "earthSizeDeg", 1, 12, 0.1).name("地球大小°").onChange(applySky);
  fSky.add(s, "starIntensity", 0, 3, 0.05).name("星空亮度").onChange(applySky);
  fSky.add(s, "milkyWay", 0, 3, 0.05).name("银河亮度").onChange(applySky);
  fSky.add(sunLight, "intensity", 0, 10, 0.1).name("太阳光强");
  fSky.add(earthshine, "intensity", 0, 3, 0.05).name("地照强度");
  // 天象：直接改 events.settings，下一帧生效（频率=泊松过程的速率，强度=亮度+尾长）
  const ev = sky.events.settings;
  const fEvents = gui.addFolder("天象 Sky Events");
  fEvents.add(ev, "meteorRate", 0, 4, 0.05).name("流星出现频率");
  fEvents.add(ev, "meteorIntensity", 0, 3, 0.05).name("流星强度");
  fEvents.add(ev, "cometRate", 0, 0.5, 0.01).name("彗星出现频率");
  fEvents.add(ev, "cometIntensity", 0, 3, 0.05).name("彗星强度");
  const p = post.settings;
  const applyPost = () => post.set({});
  const fPost = gui.addFolder("镜头 Post");
  fPost.add(p, "exposure", 0.2, 3, 0.01).name("曝光度").onChange(applyPost);
  fPost.add(p, "bloomStrength", 0, 2, 0.01).name("泛光强度").onChange(applyPost);
  fPost.add(p, "bloomRadius", 0, 1, 0.01).name("泛光半径").onChange(applyPost);
  fPost.add(p, "vignette", 0, 1.5, 0.01).name("暗角").onChange(applyPost);
  fPost.add(p, "grain", 0, 0.2, 0.005).name("胶片颗粒").onChange(applyPost);
  fPost.add(p, "saturation", 0, 1.5, 0.01).name("饱和度").onChange(applyPost);
  fPost.add(p, "contrast", 0.5, 1.8, 0.01).name("对比度").onChange(applyPost);
  fPost.add(p, "letterbox", { 关闭: 0, "2.39 宽银幕": 2.39, "1.85": 1.85 }).name("遮幅").onChange(applyPost);
  const tm = terrain.material;
  const surf = { roughness: tm.roughness, bump: tm.normalScale.x, tint: "#" + tm.color.getHexString() };
  const fSurf = gui.addFolder("月面 Surface");
  fSurf.add(surf, "roughness", 0, 1, 0.01).name("月面粗糙度").onChange((v) => (tm.roughness = v));
  fSurf.add(surf, "bump", 0, 3, 0.01).name("表面颗粒凹凸").onChange((v) => tm.normalScale.set(v, v));
  fSurf.addColor(surf, "tint").name("月面色调").onChange((v) => tm.color.set(v));
  // 存档：lil-gui 自带 save()/load()，按“文件夹标题/控件名”序列化全部参数（按钮不参与）
  const persist = {
    key: GUI_STORAGE_KEY,
    loaded: false, // 本次启动是否读到了存档（供测试）
    save() {
      try { localStorage.setItem(GUI_STORAGE_KEY, JSON.stringify(gui.save())); }
      catch (e) { console.warn("保存环境配置失败：", e); }
    },
    // 清除存档并刷新：页面重新以默认值启动
    clear() {
      try { localStorage.removeItem(GUI_STORAGE_KEY); } catch {}
      location.reload();
    },
  };
  // 启动时自动加载：控件 load 会走 onChange，场景随之更新；没有存档或存档损坏就保持默认值
  try {
    const raw = localStorage.getItem(GUI_STORAGE_KEY);
    if (raw) { gui.load(JSON.parse(raw)); persist.loaded = true; }
  } catch (e) { console.warn("环境配置存档无法读取，使用默认值：", e); }
  // 面板最下方两个按钮
  gui.add(persist, "save").name("💾 保存当前环境配置");
  gui.add(persist, "clear").name("🗑️ 恢复默认（清除存档）");
  gui.persist = persist;
  return gui;
}
