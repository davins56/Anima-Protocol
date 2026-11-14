import { Component, type ReactNode } from "react";

/**
 * Isolates an optional piece of the 3D scene (bloom, thought text, a
 * resident's figure, the light trail): if it throws while rendering, only that
 * feature disappears and a warning is logged; the world keeps running.
 */
export class FeatureBoundary extends Component<{ name: string; children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn(`[cyberworld] ${this.props.name} disabled:`, error);
  }
  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
