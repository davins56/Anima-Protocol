/** Chat upgrade 3 flag. Off unless VITE_ANIMA_ON_DEVICE_MIND is "1", "true" or "on". */
export function onDeviceMindEnabled(env: Record<string, unknown> | undefined = import.meta.env): boolean {
  const raw = String(env?.VITE_ANIMA_ON_DEVICE_MIND ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}
