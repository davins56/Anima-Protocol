// @ts-check
/**
 * Bug Squasher HTTP client: manual reports, "my reports", and the admin
 * triage endpoints (artifacts/api-server/src/routes/bugSquasher.ts).
 */
import { authHeaders } from "@/api/authBridge";
import { apiUrl } from "@/lib/apiOrigin";
import { buildDiagnosticContext, readAppVersion } from "./capture.js";
import { scrubText, scrubValue } from "./scrub.js";

export const BUG_STATUSES = /** @type {const} */ (["new", "triaged", "fixed", "ignored"]);

/** Friendly copy for each server error code. */
const CODE_COPY = {
  bug_squasher_schema_missing:
    "Bug reports aren't switched on yet (the database migration hasn't been applied).",
  bug_report_quota: "You've sent a lot of reports today. Please try again tomorrow.",
  forbidden: "Only admins can open Bug Squasher triage.",
};

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function request(path, init = {}) {
  const headers = await authHeaders({
    Accept: "application/json",
    ...(init.body ? { "Content-Type": "application/json" } : {}),
  });
  if (!headers?.Authorization) {
    const err = /** @type {Error & { status?: number }} */ (new Error("Sign in to use Bug Squasher."));
    err.status = 401;
    throw err;
  }
  const res = await fetch(apiUrl(`/bug-squasher${path}`), {
    ...init,
    headers,
    credentials: "same-origin",
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = typeof payload?.code === "string" ? payload.code : "";
    const err = /** @type {Error & { status?: number, code?: string }} */ (
      new Error(CODE_COPY[code] || payload?.error || `Request failed (${res.status})`)
    );
    err.status = res.status;
    err.code = code;
    throw err;
  }
  return payload;
}

/**
 * Build the body for a manual report. Exported for tests.
 * @param {{ description: string, includeContext?: boolean, screenshot?: string | null, extraContext?: Record<string, unknown> }} input
 */
export function buildManualReport(input) {
  const description = scrubText(input.description, 4000).trim();
  const firstLine = description.split("\n")[0] || "Bug report";
  /** @type {Record<string, unknown>} */
  const body = {
    kind: "manual",
    title: firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine,
    description,
    app_version: readAppVersion(),
    user_agent: typeof navigator !== "undefined" ? scrubText(navigator.userAgent, 300) : "",
  };
  try {
    body.route = `${window.location.pathname}`;
  } catch {
    /* non-browser */
  }
  if (input.includeContext !== false) {
    body.context = scrubValue({ ...buildDiagnosticContext(), ...(input.extraContext || {}) });
  } else {
    body.context = {};
  }
  if (input.screenshot) body.screenshot = input.screenshot;
  return body;
}

/** @param {Parameters<typeof buildManualReport>[0]} input */
export async function submitManualReport(input) {
  const body = buildManualReport(input);
  if (String(body.description || "").length < 3) {
    throw new Error("Tell us a little about what went wrong.");
  }
  const payload = await request("/reports", { method: "POST", body: JSON.stringify(body) });
  return payload.report;
}

export async function listMyReports() {
  const payload = await request("/reports/mine");
  return Array.isArray(payload.reports) ? payload.reports : [];
}

/** @param {{ status?: string | null, q?: string }} [opts] */
export async function listBugGroups(opts = {}) {
  const params = new URLSearchParams();
  if (opts.status) params.set("status", opts.status);
  if (opts.q) params.set("q", opts.q);
  const qs = params.toString();
  const payload = await request(`/admin/groups${qs ? `?${qs}` : ""}`);
  return Array.isArray(payload.groups) ? payload.groups : [];
}

/** @param {string} fingerprint */
export async function getBugGroup(fingerprint) {
  const payload = await request(`/admin/groups/${encodeURIComponent(fingerprint)}`);
  return Array.isArray(payload.reports) ? payload.reports : [];
}

/**
 * @param {string} fingerprint
 * @param {string} status
 * @param {string | null} [note]
 */
export async function setBugGroupStatus(fingerprint, status, note = null) {
  return request(`/admin/groups/${encodeURIComponent(fingerprint)}`, {
    method: "PATCH",
    body: JSON.stringify({ status, ...(note ? { note } : {}) }),
  });
}

/** @param {string} id */
export async function getBugScreenshot(id) {
  const payload = await request(`/admin/reports/${encodeURIComponent(id)}/screenshot`);
  return typeof payload.screenshot === "string" ? payload.screenshot : null;
}

const MAX_SCREENSHOT_CHARS = 650_000;

/**
 * Screenshot of the current screen as a JPEG data URL, skipping any element
 * marked `data-bug-squasher-ui` (the report dialog itself). Returns null when
 * the page cannot be captured or the image stays too large.
 * @returns {Promise<string | null>}
 */
export async function captureScreenshot() {
  try {
    const { default: html2canvas } = await import("html2canvas");
    const target = document.body;
    const scale = Math.min(1, 1280 / Math.max(1, window.innerWidth));
    const canvas = await html2canvas(target, {
      backgroundColor: "#05050b",
      logging: false,
      useCORS: true,
      scale,
      width: window.innerWidth,
      height: window.innerHeight,
      x: window.scrollX,
      y: window.scrollY,
      ignoreElements: (el) => Boolean(el?.closest?.("[data-bug-squasher-ui]")),
    });
    for (const quality of [0.7, 0.5, 0.35]) {
      const url = canvas.toDataURL("image/jpeg", quality);
      if (url.length <= MAX_SCREENSHOT_CHARS && url.startsWith("data:image/jpeg;base64,")) return url;
    }
    return null;
  } catch {
    return null;
  }
}

/** Ask the app shell to open the Report a bug panel. */
export const OPEN_BUG_REPORT_EVENT = "anima:report-bug";

/**
 * @param {{ description?: string, context?: Record<string, unknown> }} [detail]
 * @returns {boolean} true when the panel is mounted and opened
 */
export function openBugReport(detail = {}) {
  try {
    const payload = { ...detail, handled: false };
    window.dispatchEvent(new CustomEvent(OPEN_BUG_REPORT_EVENT, { detail: payload }));
    return payload.handled === true;
  } catch {
    return false;
  }
}
