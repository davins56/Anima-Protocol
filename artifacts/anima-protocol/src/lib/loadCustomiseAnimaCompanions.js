import { base44, waitForStoreAuth } from "@/api/base44Client";
import { STORE_AUTH_WAIT_MS } from "@/lib/storeTimeouts";
import { whenBootstrapReady } from "@/lib/syncBootstrap";
import { classifyEmptyCustomiseAnimaLoad } from "@/lib/customiseAnimaLoad";
import { listPersonalAnimas } from "@/lib/listPersonalAnimas";

/**
 * Shared Settings + Customise Anima companion fetch.
 *
 * iPad Safari often has a Clerk session (Settings already rendered) while
 * getToken() is still minting. Do not abort the page as unsigned when the
 * auth wait times out — try the store list, then classify empty+no-token.
 */
export async function loadCustomiseAnimaCompanions({
  meFallback = null,
  limit = 500,
} = {}) {
  let token = null;
  let authWaitError = null;

  await Promise.all([
    whenBootstrapReady().catch(() => undefined),
    waitForStoreAuth(STORE_AUTH_WAIT_MS)
      .then((value) => {
        token = value;
        return value;
      })
      .catch((err) => {
        authWaitError = err;
        return null;
      }),
  ]);

  const [me, list] = await Promise.all([
    base44.auth.me().catch(() => meFallback || null),
    listPersonalAnimas(limit),
  ]);

  const rows = Array.isArray(list) ? list : [];
  if (rows.length) {
    return { rows, me, token, kind: "", message: "" };
  }

  const kind = classifyEmptyCustomiseAnimaLoad({ token });
  return {
    rows,
    me,
    token,
    kind,
    message:
      kind === "unsigned"
        ? authWaitError?.message || "Store auth token not available"
        : "",
  };
}
