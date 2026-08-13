import { useEffect, useState } from "react";
import * as THREE from "three";

/** Loads an Anima portrait into a Three.js texture (SRGB). */
export default function useFaceTexture(url) {
  const [map, setMap] = useState(null);

  useEffect(() => {
    if (!url) {
      setMap(null);
      return undefined;
    }
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    let cancelled = false;
    loader.load(
      url,
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        setMap(tex);
      },
      undefined,
      () => {
        if (!cancelled) setMap(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  return map;
}
