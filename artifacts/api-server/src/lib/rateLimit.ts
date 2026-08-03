import type { Request, Response, NextFunction } from "express";

const windowMs = 60_000;
const maxRequests = 30;

const counts = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const entry = counts.get(ip);

  if (!entry || now > entry.resetAt) {
    counts.set(ip, { count: 1, resetAt: now + windowMs });
    return next();
  }

  entry.count += 1;
  if (entry.count > maxRequests) {
    res.status(429).json({ error: "Too many requests. Please slow down." });
    return;
  }

  next();
}
