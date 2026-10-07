import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { sunDirection, moonDirection } from "./timeOfDay";
import type { Lighting } from "./timeOfDay";

// The high openings expose sky and palm crowns; no ground is built here.
export function createOutside(scene: THREE.Scene) {
  const skyUniforms = {
    skyZenith: { value: new THREE.Color() },
    skyHorizon: { value: new THREE.Color() },
    sunColor: { value: new THREE.Color() },
    cloudColor: { value: new THREE.Color() },
    cloudCover: { value: 0 },
    starOpacity: { value: 0 },
    elapsed: { value: 0 },
    sunDir: { value: new THREE.Vector3() },
    moonDir: { value: new THREE.Vector3() },
  };
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    uniforms: skyUniforms,
    vertexShader: `
      varying vec3 worldPosition;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        worldPosition = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 skyZenith, skyHorizon, sunColor, cloudColor, sunDir, moonDir;
      uniform float cloudCover, starOpacity, elapsed;
      varying vec3 worldPosition;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
      }
      void main() {
        // Direction from the eye, rather than dome UVs: no parallax in the sky.
        vec3 dir = normalize(worldPosition - cameraPosition);
        float elevation = max(dir.y, 0.0);
        vec3 color = mix(skyHorizon, skyZenith, smoothstep(0.0, 1.0, elevation));
        float haze = exp(-abs(dir.y - 0.035)*10.0)*0.08;
        color = mix(color, mix(skyHorizon, sunColor, 0.18), haze);
        vec2 p = dir.xz / max(dir.y, 0.08) * 1.4 + vec2(elapsed*0.0015, elapsed*0.0005);
        float cloudNoise = noise(p)*0.7 + noise(p*2.0+17.0)*0.3;
        float cloud = smoothstep(0.79-cloudCover*0.45, 0.94-cloudCover*0.35, cloudNoise);
        cloud *= smoothstep(0.06, 0.24, dir.y)*0.48;
        color = mix(color, cloudColor, cloud);
        float sunDot = max(dot(dir, sunDir), 0.0);
        float sun = smoothstep(cos(0.012), cos(0.0065), sunDot);
        float sunUp = smoothstep(-0.025, 0.06, sunDir.y);
        color += sunColor * (sun*1.9 + pow(sunDot, 700.0)*0.09) * sunUp;
        float moonDot = max(dot(dir, moonDir), 0.0);
        float moon = smoothstep(cos(0.011), cos(0.008), moonDot);
        color += sunColor * moon * 0.85 * starOpacity * smoothstep(0.0,0.06,moonDir.y);
        vec2 grid = vec2(atan(dir.z,dir.x)/6.2831853+0.5, asin(clamp(dir.y,-1.0,1.0))/3.1415927+0.5)*vec2(600.0,300.0);
        vec2 cell = floor(grid), point = 0.2+vec2(hash(cell+11.0),hash(cell+37.0))*0.6;
        float star = (1.0-smoothstep(0.025,0.12,length(fract(grid)-point))) * step(0.9978,hash(cell));
        color += vec3(star*(0.6+hash(cell+4.0)*0.4)*starOpacity*(1.0-smoothstep(-0.05,0.08,sunDir.y)));
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(65, 32, 16),
    skyMaterial,
  );
  dome.name = "Outside sky";
  // Fill only remaining opening pixels after room and alpha-tested palms.
  dome.renderOrder = 1000;
  scene.add(dome);

  let seed = 0x51a7;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "white";
  // Slightly tapered, painted trunk and a round crown of Borassus fan leaves.
  ctx.beginPath();
  ctx.moveTo(181, 1024);
  ctx.lineTo(198, 1024);
  ctx.bezierCurveTo(187, 730, 205, 455, 194, 207);
  ctx.lineTo(186, 207);
  ctx.bezierCurveTo(188, 470, 178, 740, 181, 1024);
  ctx.fill();
  for (let i = 0; i < 22; i++) {
    const angle = (i / 22) * Math.PI * 2,
      radius = 65 + random() * 38;
    const x = 192 + Math.cos(angle) * radius,
      y = 151 + Math.sin(angle) * radius * 0.7;
    ctx.beginPath();
    ctx.moveTo(192, 184);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "white";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k <= 8; k++) {
      const a = angle - 1.2 + (k / 8) * 2.4,
        r = 38 + (k % 2 ? 4 : 0);
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.85);
    }
    ctx.closePath();
    ctx.fill();
  }
  const mask = new THREE.CanvasTexture(canvas);
  mask.generateMipmaps = true;
  const palmUniforms = {
    mask: { value: mask },
    palmColor: { value: new THREE.Color() },
    skyHorizon: { value: new THREE.Color() },
    elapsed: { value: 0 },
    alphaTest: { value: 0.45 },
  };
  const palmMaterial = new THREE.ShaderMaterial({
    uniforms: palmUniforms,
    side: THREE.DoubleSide,
    alphaTest: 0.45,
    vertexShader: `
      uniform float elapsed;
      varying vec2 palmUV;
      varying float palmDistance;
      void main() {
        palmUV = uv;
        vec4 world = modelMatrix * instanceMatrix * vec4(position,1.0);
        float phase = instanceMatrix[3].x*0.37 + instanceMatrix[3].z*0.23;
        world.x += sin(elapsed*0.35+phase)*0.10*position.y*position.y;
        world.z += cos(elapsed*0.27+phase)*0.06*position.y*position.y;
        palmDistance = length(world.xz-cameraPosition.xz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform sampler2D mask;
      uniform vec3 palmColor, skyHorizon;
      varying vec2 palmUV;
      varying float palmDistance;
      #include <alphatest_pars_fragment>
      void main() {
        vec4 diffuseColor = vec4(mix(palmColor,skyHorizon,smoothstep(25.0,60.0,palmDistance)*0.42),texture2D(mask,palmUV).a);
        #include <alphatest_fragment>
        // Alpha-tested palms are opaque after the cutout; keep the canvas opaque too.
        gl_FragColor = vec4(diffuseColor.rgb, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const a = new THREE.PlaneGeometry(1, 1);
  a.translate(0, 0.5, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  const geometry = mergeGeometries([a, b])!;
  a.dispose();
  b.dispose();
  const palms = new THREE.InstancedMesh(geometry, palmMaterial, 36);
  palms.name = "Sugar palm crowns";
  palms.renderOrder = 50;
  const transform = new THREE.Object3D();
  let index = 0;
  for (const side of [-1, 1])
    for (const windowZ of [-5.5, 0, 5.5])
      for (let i = 0; i < 6; i++) {
        const radius = 49 + random() * 5;
        const angle = Math.atan2(windowZ, 4.5) + (random() - 0.5) * 0.15;
        // At oblique end windows the sightline meets shorter, farther crowns.
        const height = windowZ === 0 ? 20 + random() * 4 : 15.5 + random() * 3;
        transform.position.set(
          side * Math.cos(angle) * radius,
          0,
          Math.sin(angle) * radius,
        );
        transform.rotation.y = random() * Math.PI;
        transform.scale.set(6.5 + random() * 1.7, height, 6.5 + random() * 1.7);
        transform.updateMatrix();
        palms.setMatrixAt(index++, transform.matrix);
      }
  palms.instanceMatrix.needsUpdate = true;
  palms.computeBoundingSphere();
  scene.add(palms);
  let lastMinutes = NaN;
  return {
    dome,
    palms,
    update(lighting: Lighting, minutes: number, elapsed: number) {
      if (minutes !== lastMinutes) {
        lastMinutes = minutes;
        skyUniforms.skyZenith.value.copy(lighting.skyZenith);
        skyUniforms.skyHorizon.value.copy(lighting.skyHorizon);
        skyUniforms.sunColor.value.copy(lighting.sunColor);
        skyUniforms.cloudColor.value.copy(lighting.cloudColor);
        skyUniforms.cloudCover.value = lighting.cloudCover;
        skyUniforms.starOpacity.value = lighting.starOpacity;
        sunDirection(minutes, skyUniforms.sunDir.value);
        moonDirection(minutes, skyUniforms.moonDir.value);
        palmUniforms.palmColor.value.copy(lighting.palmColor);
        palmUniforms.skyHorizon.value.copy(lighting.skyHorizon);
      }
      skyUniforms.elapsed.value = palmUniforms.elapsed.value = elapsed;
    },
    dispose() {
      palms.dispose();
      mask.dispose();
    },
  };
}
