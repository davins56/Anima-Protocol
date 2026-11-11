import { Suspense, useState } from "react";

/**
 * Mount `children` (typically a React.lazy modal) the first time `when` is
 * truthy, then keep it mounted so the modal's own close/exit animation and
 * internal state behave exactly as before. Until then nothing is rendered and
 * the lazy chunk is never requested.
 *
 * @param {{ when: unknown, children: import("react").ReactNode }} props
 */
export default function DeferredMount({ when, children }) {
  const [mounted, setMounted] = useState(Boolean(when));
  if (when && !mounted) setMounted(true);
  if (!mounted && !when) return null;
  return <Suspense fallback={null}>{children}</Suspense>;
}
