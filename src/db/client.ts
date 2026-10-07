import dns from "node:dns";
import postgres from "postgres";
import { env } from "../config/env";

// Bun loads .env automatically, so DATABASE_URL is available.
// Laptop ini tidak punya konektivitas IPv6; tanpa baris di bawah, driver
// postgres mencoba alamat IPv6 Neon duluan dan selalu CONNECT_TIMEOUT.
// (Hostname asli tetap dipakai → SNI/TLS Neon tetap valid.)
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  /* Node < 17 — abaikan */
}

export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  // Neon cold-start dari Indonesia bisa 3-15 detik (pernah >30 detik).
  // Timeout longgar agar /health dan request pertama tidak langsung gagal.
  connect_timeout: 60,
});

export async function checkDb(retries = 2): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await sql`select 1`;
      return { ok: true, latencyMs: Date.now() - start };
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}
