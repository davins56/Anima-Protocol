// @ts-check
import { createContext, useContext } from "react";

/**
 * Talk-screen situational scene (#763, ANIMA_SITUATIONAL_SCENES). The
 * default is "off", so anything rendered outside the provider (or with the
 * flag off) renders exactly as before.
 *
 * @typedef {{
 *   enabled: boolean,
 *   narrator: boolean,
 *   nameOf: (id: string) => string,
 * }} SituationalSceneValue
 */

/** @type {SituationalSceneValue} */
export const SITUATIONAL_SCENE_OFF = Object.freeze({
  enabled: false,
  narrator: false,
  nameOf: () => "",
});

export const SituationalSceneContext = createContext(SITUATIONAL_SCENE_OFF);

export function useSituationalSceneView() {
  return useContext(SituationalSceneContext);
}
