import { base44 } from "@/api/base44Client";
import { whenBootstrapReady } from "@/lib/syncBootstrap";
import { classifyEmptyCustomiseAnimaLoad } from "@/lib/customiseAnimaLoad";
import {
  awaitCompanionStoreAuth,
  listPersonalAnimas,
} from "@/lib/listPersonalAnimas";

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

  try {
    await whenBootstrapReady();
  } catch {
    /* bootstrap is fail-open — still try the companion list */
  }
  token = await awaitCompanionStoreAuth();
  if (!token) {
    authWaitError = new Error("Store auth token not available");
  }

  let me = meFallback || null;
  try {
    me = (await base44.auth.me()) || meFallback || null;
  } catch {
    me = meFallback || null;
  }
  const list = await listPersonalAnimas(limit);

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
