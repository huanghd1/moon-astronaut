import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

// 电影感调色（参考《星际穿越》/《阿波罗13号》）：暗部偏冷青、高光偏暖、轻微去饱和、胶片颗粒、暗角
export const POST_DEFAULTS = {
  enabled: true,
  exposure: 1.05,
  bloomStrength: 0.25, // 第 10 步从 0.42 调低：太阳不再糊成一大片白光
  bloomRadius: 0.3,
  bloomThreshold: 2.2, // HDR 线性亮度，只让太阳、亮星、高光泛光
  vignette: 0.42,
  grain: 0.045,
  saturation: 0.86,
  contrast: 1.08,
  shadowTint: [0.93, 1.0, 1.07], // 冷
  highlightTint: [1.06, 1.0, 0.9], // 暖
  aberration: 0.0018,
  letterbox: 0, // 0 关闭；如 2.39 为宽银幕遮幅
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0 },
    uGrain: { value: 0 },
    uSaturation: { value: 1 },
    uContrast: { value: 1 },
    uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
    uHighlightTint: { value: new THREE.Vector3(1, 1, 1) },
    uAberration: { value: 0 },
    uAspect: { value: 16 / 9 },
    uLetterbox: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uSaturation, uContrast, uAberration, uAspect, uLetterbox;
    uniform vec3 uShadowTint, uHighlightTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      // 镜头边缘轻微色散
      vec2 off = c * uAberration * dot(c, c) * 4.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      // 分离色调：暗部冷、亮部暖
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col *= mix(uShadowTint, uHighlightTint, smoothstep(0.05, 0.7, l));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      // 椭圆暗角
      vec2 vc = c * vec2(uAspect, 1.0) / uAspect * 2.0;
      col *= mix(1.0, smoothstep(1.25, 0.2, length(vc)), uVignette);
      // 胶片颗粒：暗部更明显
      float g = hash(vUv * 1000.0 + fract(uTime) * 61.0) - 0.5;
      col += g * uGrain * (1.0 - l * 0.6);
      // 宽银幕遮幅
      if (uLetterbox > 0.0) {
        float bar = (1.0 - uAspect / uLetterbox) * 0.5;
        if (vUv.y < bar || vUv.y > 1.0 - bar) col = vec3(0.0);
      }
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export function createPost(renderer, scene, camera) {
  const settings = { ...POST_DEFAULTS, shadowTint: [...POST_DEFAULTS.shadowTint], highlightTint: [...POST_DEFAULTS.highlightTint] };
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  // HDR + MSAA 渲染目标，让泛光读取真实亮度
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0, 0, 0);
  const output = new OutputPass(); // ACES 色调映射 + sRGB
  const grade = new ShaderPass(GradeShader);
  renderPass.name = "render"; bloom.name = "bloom"; output.name = "output"; grade.name = "grade";
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(grade);

  function apply() {
    renderer.toneMappingExposure = settings.exposure;
    bloom.strength = settings.bloomStrength;
    bloom.radius = settings.bloomRadius;
    bloom.threshold = settings.bloomThreshold;
    const u = grade.uniforms;
    u.uVignette.value = settings.vignette;
    u.uGrain.value = settings.grain;
    u.uSaturation.value = settings.saturation;
    u.uContrast.value = settings.contrast;
    u.uShadowTint.value.fromArray(settings.shadowTint);
    u.uHighlightTint.value.fromArray(settings.highlightTint);
    u.uAberration.value = settings.aberration;
    u.uLetterbox.value = settings.letterbox;
  }
  apply();

  return {
    composer,
    settings,
    passes: composer.passes.map((p) => p.name),
    set(patch) { Object.assign(settings, patch); apply(); },
    setSize(w, h) {
      composer.setSize(w, h);
      grade.uniforms.uAspect.value = w / h;
    },
    render(t) {
      grade.uniforms.uTime.value = t;
      if (settings.enabled) composer.render();
      else renderer.render(scene, camera);
    },
  };
}
