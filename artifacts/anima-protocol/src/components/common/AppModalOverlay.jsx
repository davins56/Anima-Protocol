import { createPortal } from "react-dom";

/**
 * Full-screen modal backdrop rendered on document.body so page headers,
 * overflow-hidden layout chrome and transformed ancestors cannot clip it.
 *
 * It stops at the top of the z-[999] bottom tab bar (`--tab-bar-height`) and
 * below the notch, so footer actions (Save / Forge / Close) are never hidden
 * under the tab bar on phones. It stays at z-50 so Radix Select / popover
 * content (also z-50, portaled later) still opens on top of it.
 */
export default function AppModalOverlay({ children, className = "", onClick, ...rest }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      {...rest}
      onClick={onClick}
      className={`fixed inset-x-0 top-0 z-50 flex bg-black/80 backdrop-blur-sm ${className}`}
      style={{
        bottom: "var(--tab-bar-height, 0px)",
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
