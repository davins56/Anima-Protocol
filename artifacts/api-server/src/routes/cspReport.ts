/**
 * POST /api/csp-report — receives Content-Security-Policy-Report-Only
 * violations (lib/securityHeaders.ts) so the document CSP can be tightened and
 * enforced later. Public (browsers send these without credentials), size
 * capped, IP rate-limited, logs a short summary only, always 204.
 */
import { Router, type IRouter } from "express";
import { createRateLimit } from "../lib/rateLimit";
import { logger } from "../lib/logger";

declare const require: (moduleName: string) => any;
const express: any = require("express");

const router: IRouter = Router();
const limit = createRateLimit({ name: "csp-report", max: 30, identity: "ip" });
const parse = express.json({
  limit: "16kb",
  type: ["application/csp-report", "application/reports+json", "application/json"],
});

function clip(value: unknown, max = 200): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value.slice(0, max);
}

/** Path + host only: never log query strings (they can carry tokens). */
function urlSummary(value: unknown): string | undefined {
  const raw = clip(value, 500);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname}`.slice(0, 200);
  } catch {
    return raw.split("?")[0]?.slice(0, 200);
  }
}

export function summarizeCspReport(body: unknown): Array<Record<string, string | undefined>> {
  const items = Array.isArray(body) ? body : [body];
  const out: Array<Record<string, string | undefined>> = [];
  for (const item of items.slice(0, 10)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, any>;
    const report = (record["csp-report"] ?? record.body ?? record) as Record<string, unknown>;
    out.push({
      directive: clip(report["effective-directive"] ?? report.effectiveDirective ?? report["violated-directive"]),
      blocked: urlSummary(report["blocked-uri"] ?? report.blockedURL) ?? clip(report["blocked-uri"] ?? report.blockedURL),
      document: urlSummary(report["document-uri"] ?? report.documentURL),
      disposition: clip(report.disposition),
    });
  }
  return out;
}

router.post("/csp-report", limit, parse, (req, res) => {
  const reports = summarizeCspReport(req.body);
  if (reports.length) logger.info({ cspReports: reports }, "CSP report-only violation");
  res.status(204).end();
});

export default router;
