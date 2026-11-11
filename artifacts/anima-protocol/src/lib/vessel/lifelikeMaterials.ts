/**
 * Material upgrades for lifelike vessel bases. The GLB ships plain glTF PBR
 * materials named by role (VesselSkin, VesselEye, VesselCornea, VesselHair*,
 * VesselBrow, VesselLash, VesselCloth_*, VesselGem); here they become
 * MeshPhysicalMaterials tuned for skin, eyes and hair, scaled to the device tier.
 */
import * as THREE from "three";

export type LifelikeTier = { name: string; transmission: number };

/**
 * Cheap subsurface approximation for skin: wrapped diffuse lighting tinted
 * toward a warm scatter colour, so terminator edges glow instead of going grey.
 * No-op when the three.js chunk changes shape.
 */
export function applySkinScatter(mat: THREE.MeshPhysicalMaterial, tint = new THREE.Color("#ff6a4d"), wrap = 0.35, mix = 0.45) {
  const target = "vec3 irradiance = dotNL * directLight.color;";
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.sssTint = { value: tint };
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_physical_pars_fragment>",
      THREE.ShaderChunk.lights_physical_pars_fragment.replace(
        target,
        `float wrapNL = saturate( ( dot( geometryNormal, directLight.direction ) + ${wrap.toFixed(3)} ) / ${(1 + wrap).toFixed(3)} );
	vec3 irradiance = mix( vec3( dotNL ), wrapNL * sssTint, ${mix.toFixed(3)} * ( 1.0 - dotNL ) ) * directLight.color;`,
      ),
    );
    shader.fragmentShader = "uniform vec3 sssTint;\n" + shader.fragmentShader;
  };
  mat.customProgramCacheKey = () => `vessel-skin-sss-${wrap}-${mix}`;
}

type Std = THREE.MeshStandardMaterial;

function physicalFrom(src: Std, extra: THREE.MeshPhysicalMaterialParameters): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    name: src.name,
    color: src.color,
    map: src.map,
    normalMap: src.normalMap,
    normalScale: src.normalScale,
    roughnessMap: src.roughnessMap,
    metalnessMap: src.metalnessMap,
    roughness: src.roughness,
    metalness: src.metalness,
    alphaMap: src.alphaMap,
    transparent: src.transparent,
    opacity: src.opacity,
    alphaTest: src.alphaTest,
    side: src.side,
    ...extra,
  });
  return m;
}

/** Role of a material by its exported name. */
export function lifelikeRole(name: string): "skin" | "eye" | "cornea" | "hair" | "brow" | "lash" | "cloth" | "gem" | "mouth" | null {
  if (name.startsWith("VesselSkin")) return "skin";
  if (name.startsWith("VesselEye")) return "eye";
  if (name.startsWith("VesselCornea")) return "cornea";
  if (name.startsWith("VesselHair")) return "hair";
  if (name.startsWith("VesselBrow")) return "brow";
  if (name.startsWith("VesselLash")) return "lash";
  if (name.startsWith("VesselCloth")) return "cloth";
  if (name.startsWith("VesselGem")) return "gem";
  if (name.startsWith("VesselTeeth") || name.startsWith("VesselTongue")) return "mouth";
  return null;
}

/**
 * Upgrade every role-named material under `root` in place (the root must be
 * this renderer's own clone; SkeletonUtils clones share materials, so the
 * sources are swapped out, never disposed). Returns the new materials for disposal.
 */
export function upgradeLifelikeMaterials(root: THREE.Object3D, tier: LifelikeTier, opts: { shadows: boolean; eyeGlow?: string | null } = { shadows: false }): THREE.Material[] {
  const made = new Map<THREE.Material, THREE.Material>();
  const hi = tier.name === "high";
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false; // skinned + morphed: the bind-pose bounds lie
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = mats.map((m0) => {
      const src = m0 as Std;
      if (made.has(src)) return made.get(src)!;
      const role = lifelikeRole(src.name || "");
      let m: THREE.Material = src;
      switch (role) {
        case "skin": {
          const p = physicalFrom(src, {
            sheen: 0.3,
            sheenRoughness: 0.55,
            sheenColor: new THREE.Color("#ffb59c"),
            clearcoat: hi ? 0.05 : 0,
            clearcoatRoughness: 0.45,
            specularIntensity: 0.55,
            ior: 1.4,
            envMapIntensity: 0.85,
          });
          p.normalScale = new THREE.Vector2(0.55, 0.55);
          applySkinScatter(p);
          m = p;
          break;
        }
        case "eye":
          // The eye mesh carries an outer shell mapped to transparent texels: clip it away.
          m = physicalFrom(src, {
            alphaTest: 0.5,
            transparent: false,
            roughness: 0.3,
            clearcoat: 1,
            clearcoatRoughness: 0.04,
            emissive: opts.eyeGlow ? new THREE.Color(opts.eyeGlow) : new THREE.Color(0),
            emissiveIntensity: opts.eyeGlow ? 0.12 : 0,
            emissiveMap: opts.eyeGlow ? src.map : null,
          });
          break;
        case "cornea":
          // A clear glossy shell: the specular glint and wet rim sell the eye. Plain alpha (no
          // transmission pass) on every tier: transmission darkened the iris behind it.
          m = new THREE.MeshPhysicalMaterial({
            name: src.name,
            color: 0xffffff,
            roughness: 0.04,
            metalness: 0,
            ior: 1.376,
            clearcoat: 1,
            clearcoatRoughness: 0.03,
            specularIntensity: 1,
            envMapIntensity: 1.0,
            transparent: true,
            opacity: 0.06,
            depthWrite: false,
          });
          break;
        case "hair": {
          const curls = src.name.startsWith("VesselHairCurls");
          m = physicalFrom(src, {
            alphaTest: 0.42,
            transparent: false,
            side: THREE.DoubleSide,
            // Helicoid ringlet cards catch razor-thin highlights on their edges: keep them matte.
            roughness: curls ? 0.8 : 0.66,
            specularIntensity: curls ? 0.06 : 0.18,
            envMapIntensity: curls ? 0.35 : 0.55,
            anisotropy: hi ? 0.35 : 0,
            alphaToCoverage: hi,
          });
          break;
        }
        case "brow":
        case "lash":
          m = physicalFrom(src, { transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.8 });
          break;
        case "cloth":
          m = physicalFrom(src, { sheen: 0.18, sheenRoughness: 0.7, sheenColor: new THREE.Color("#3a3438"), envMapIntensity: 0.7 });
          break;
        case "gem":
          m = new THREE.MeshPhysicalMaterial({
            name: src.name,
            color: src.color,
            roughness: 0.02,
            ior: 1.77,
            clearcoat: 1,
            specularIntensity: 1,
            emissive: src.color,
            emissiveIntensity: 0.25,
            ...(tier.transmission > 0.3 ? { transmission: 0.6, thickness: 0.01 } : {}),
          });
          break;
        case "mouth":
          m = physicalFrom(src, { roughness: 0.35 });
          break;
        default:
          break;
      }
      made.set(src, m);
      return m;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
    mesh.castShadow = opts.shadows;
    mesh.receiveShadow = opts.shadows;
  });
  // Only the new materials: the sources (and every texture) stay owned by the GLTF cache.
  return [...made.entries()].filter(([src, m]) => m !== src).map(([, m]) => m);
}
