import { Component } from "react";

/**
 * Isolates a WebGL/R3F crash so it cannot take down the rest of NetBattle.
 * On failure, renders the 2D panel field instead.
 */
export default class WebGLFallback extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.warn("[NetBattle] 3D arena unavailable, using 2D field.", error);
  }

  render() {
    if (this.state.failed) return this.props.fallback || null;
    return this.props.children;
  }
}
