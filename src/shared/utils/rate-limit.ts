import { Elysia } from "elysia";
import { AppError } from "../errors/app-error";

/** Tiny in-memory sliding-window rate limiter (per IP). Good enough for MVP auth endpoints. */
const hits = new Map<string, number[]>();

export const rateLimit = ({ windowMs, max }: { windowMs: number; max: number }) =>
  new Elysia({ name: "rate-limit" }).onBeforeHandle(({ request }) => {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const now = Date.now();
    const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      throw new AppError(429, "RATE_LIMITED", "Terlalu banyak permintaan, coba lagi nanti");
    }
    arr.push(now);
    hits.set(ip, arr);
  });
