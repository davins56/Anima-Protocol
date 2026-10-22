/** GLSL for the MMBN-style scan grid and instanced signal beacons (with glitch). */
import * as THREE from "three";

export function makeGridMaterial(color = "#22d3ee") {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: /* glsl */ `
      varying vec2 vPos;
      void main() {
        vPos = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; varying vec2 vPos;
      void main() {
        vec2 g = abs(fract(vPos) - 0.5);
        float line = smoothstep(0.47, 0.5, max(g.x, g.y));
        float r = length(vPos);
        float sweep = smoothstep(0.6, 0.0, abs(mod(r - uTime * 3.0, 14.0) - 0.3));
        float fade = smoothstep(16.0, 2.0, r);
        float a = (line * 0.35 + sweep * 0.25) * fade;
        gl_FragColor = vec4(uColor * (0.6 + sweep), a);
      }`,
  });
}

export function makeBeaconMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aStrength; attribute float aGlitch;
      uniform float uTime;
      varying vec3 vColor; varying float vStrength; varying float vGlitch; varying float vY;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        vColor = aColor; vStrength = aStrength; vGlitch = aGlitch; vY = position.y;
        vec3 p = position;
        float jitter = (1.0 - aStrength) * 0.25 + aGlitch * 0.35;
        float slice = floor((p.y + uTime * 4.0) * 6.0);
        p.x += (hash(slice + float(gl_InstanceID)) - 0.5) * jitter * step(0.6, hash(floor(uTime * 12.0) + slice));
        p.y += sin(uTime * 1.5 + float(gl_InstanceID)) * 0.08;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vColor; varying float vStrength; varying float vGlitch; varying float vY;
      void main() {
        float scan = 0.65 + 0.35 * sin(vY * 40.0 - uTime * 8.0);
        float flicker = mix(1.0, step(0.3, fract(sin(uTime * 37.0) * 9.1)), vGlitch);
        vec3 c = vColor;
        c.r += vGlitch * 0.4 * sin(uTime * 23.0);
        float a = (0.08 + vStrength * 0.92) * scan * flicker;
        gl_FragColor = vec4(c * (0.4 + vStrength), a);
      }`,
  });
}
