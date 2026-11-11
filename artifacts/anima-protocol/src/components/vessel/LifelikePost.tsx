/** Post chain for lifelike vessels (lazy chunk): SMAA, a light bloom on emissive accents, AgX tone mapping. */
import { Bloom, EffectComposer, SMAA, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";

export default function LifelikePost({ high }: { high: boolean }) {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <SMAA />
      <Bloom luminanceThreshold={1.0} luminanceSmoothing={0.2} intensity={high ? 0.28 : 0.2} mipmapBlur />
      <ToneMapping mode={ToneMappingMode.AGX} />
    </EffectComposer>
  );
}
