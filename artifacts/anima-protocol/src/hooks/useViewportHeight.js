// @ts-check
import { useEffect } from "react";

/**
 * Keeps `--app-height` and `--vh` CSS variables in sync with the *visible*
 * viewport height.
 *
 * Mobile browsers report `100vh` as the LARGE viewport — the height with the
 * address/navigation chrome hidden — so fixed-height and `vh`-based layouts get
 * clipped behind the bottom toolbar (e.g. the modal footer pushed off-screen).
 * We measure the real visible height from `window.visualViewport` (falling back
 * to `window.innerHeight`) and expose it so layouts can fill exactly the visible
 * area. Modern `dvh`/`svh` units act as the CSS-level fallback before this hook
 * runs; once it runs, `--app-height` wins for pixel-accurate iOS/Android sizing.
 *
 * Mount once near the app root.
 */
export default function useViewportHeight() {
  useEffect(() => {
    const root = document.documentElement;

    const update = () => {
      const vp = window.visualViewport;
      const height = vp ? vp.height : window.innerHeight;
      root.style.setProperty("--app-height", `${height}px`);
      root.style.setProperty("--vh", `${height * 0.01}px`);
    };

    update();

    const vp = window.visualViewport;
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    vp?.addEventListener("resize", update);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      vp?.removeEventListener("resize", update);
    };
  }, []);
}
