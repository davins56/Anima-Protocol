/**
 * Lets vessel parts ask their host canvas for frames. Hosts that render
 * continuously (battle, presence) leave the no-op default in place.
 */
import { createContext, useContext } from "react";

export type RenderDemand = {
  /** Render continuously for at least `ms` (model load, expression change). */
  pulse(ms: number): void;
  /** Render continuously while held (e.g. an animation clip is playing). */
  hold(key: string): void;
  release(key: string): void;
};

const NOOP: RenderDemand = { pulse() {}, hold() {}, release() {} };

export const RenderDemandContext = createContext<RenderDemand>(NOOP);

export function useRenderDemand(): RenderDemand {
  return useContext(RenderDemandContext);
}
