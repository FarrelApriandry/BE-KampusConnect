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

// Di serverless (Vercel) setiap instance fungsi punya pool sendiri, jadi `max`
// kecil supaya banyak instance tidak menghabiskan koneksi Neon.
const IS_SERVERLESS = Boolean(process.env.VERCEL);

export const sql = postgres(env.DATABASE_URL, {
  max: IS_SERVERLESS ? 3 : 10,
  idle_timeout: 20,
  // Neon pooler memakai PgBouncer transaction mode: satu koneksi logis bisa
  // mendarat di backend Postgres yang berbeda tiap transaksi. Prepared statement
  // bernama (default postgres.js) jadi tidak konsisten → "prepared statement
  // does not exist" secara intermiten. Matikan supaya aman.
  prepare: false,
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
