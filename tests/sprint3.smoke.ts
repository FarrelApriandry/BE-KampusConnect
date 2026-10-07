import { sql } from "../src/db/client";

const B = "http://127.0.0.1:3001/api/v1";
const J = async (r: Response) => {
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};

const auth = (t: string) => ({ Authorization: ["Bearer", t].join(" ") });

const post = (p: string, b: unknown, t?: string) =>
  fetch(B + p, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(t ? auth(t) : {}) },
    body: JSON.stringify(b),
  });

const patch = (p: string, b: unknown, t: string) =>
  fetch(B + p, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...auth(t) },
    body: JSON.stringify(b),
  });

const del = (p: string, t: string) => fetch(B + p, { method: "DELETE", headers: auth(t) });
const get = (p: string, t?: string) => fetch(B + p, { headers: t ? auth(t) : {} });

const reg = async (email: string, name: string) =>
  (await J(await post("/auth/register", {
    name,
    email,
    password: "Secret123!",
    confirmPassword: "Secret123!",
  }))).data.token;

let pass = 0;
let fail = 0;
const check = (label: string, exp: unknown, act: unknown) => {
  if (String(exp) === String(act)) {
    console.log(`  PASS  ${label} (=${act})`);
    pass++;
  } else {
    console.log(`  FAIL  ${label} (harap ${exp}, dapat ${act})`);
    fail++;
  }
};

const stamp = String(Date.now());
// Email disimpan utuh supaya update DB memakai pencocokan persis (bukan LIKE).
const EMAIL_S = `s3.susp${stamp}@students.untidar.ac.id`;
const EMAIL_B = `s3.buy${stamp}@students.untidar.ac.id`;
const EMAIL_X = `s3.x${stamp}@students.untidar.ac.id`;

const tS = await reg(EMAIL_S, "S3 Susp");
const tB = await reg(EMAIL_B, "S3 Buy");
const tX = await reg(EMAIL_X, "S3 X");

const cats = (await J(await get("/categories"))).data.items;
const mk = async (t: string, title: string) =>
  (await J(await post("/listings", {
    title,
    description: "test sprint 3",
    categoryId: cats[0].id,
    type: "PRODUCT",
    price: 10000,
    condition: "USED_GOOD",
  }, t))).data.id;

const suspend = (email: string, status: string) =>
  sql`update users set account_status = ${status} where email = ${email}`;

// ---------- BR-10: akun SUSPENDED ditolak ----------
console.log("########## BR-10 SUSPENDED ##########");
await mk(tS, `Listing Seller Suspend ${stamp}`);

// Buyer di-suspend: harus 403 ACCOUNT_SUSPENDED (dicek sebelum resource apapun).
await suspend(EMAIL_B, "SUSPENDED");
const r1 = await get("/me", tB);
check("SUSPENDED buyer -> GET /me 403", 403, r1.status);
check("  code ACCOUNT_SUSPENDED", "ACCOUNT_SUSPENDED", (await J(r1)).error?.code);

const r1b = await patch("/transactions/00000000-0000-0000-0000-000000000000/status", { status: "ACCEPTED" }, tB);
check("SUSPENDED buyer -> PATCH status 403 (bukan 404)", 403, r1b.status);
check("  code ACCOUNT_SUSPENDED", "ACCOUNT_SUSPENDED", (await J(r1b)).error?.code);

// Seller di-suspend: tidak boleh membuat listing baru.
await suspend(EMAIL_S, "SUSPENDED");
const r2 = await post("/listings", {
  title: "Listing dari akun suspend",
  description: "harusnya gagal",
  categoryId: cats[0].id,
  type: "PRODUCT",
  price: 5000,
  condition: "USED_GOOD",
}, tS);
check("SUSPENDED seller -> buat listing 403", 403, r2.status);
check("  code ACCOUNT_SUSPENDED", "ACCOUNT_SUSPENDED", (await J(r2)).error?.code);

// Tidak boleh chat juga.
const r2b = await post("/chats", { listingId: "00000000-0000-0000-0000-000000000000" }, tS);
check("SUSPENDED seller -> chat 403", 403, r2b.status);

// Pulihkan.
await suspend(EMAIL_S, "ACTIVE");
await suspend(EMAIL_B, "ACTIVE");
const r2c = await get("/me", tB);
check("setelah ACTIVE -> GET /me 200", 200, r2c.status);

// ---------- Jalur REJECTED / CANCELLED ----------
console.log("\n########## JALUR REJECTED / CANCELLED ##########");
const lid2 = await mk(tS, `Listing Jalur Reject ${stamp}`);
const tx2 = (await J(await post(`/listings/${lid2}/transactions`, { agreedPrice: 9000 }, tX))).data;
check("transaksi baru PENDING", "PENDING", tx2.status);
check("  buyer = tX", true, tx2.buyer_id === (await J(await get("/me", tX))).data.id);

const r3 = await patch(`/transactions/${tx2.id}/status`, { status: "REJECTED" }, tS);
check("seller REJECT -> 200", 200, r3.status);
check("  status REJECTED", "REJECTED", (await J(r3)).data.status);
check("  listing tetap ACTIVE", "ACTIVE", (await J(await get(`/listings/${lid2}`))).data.status);

const lid3 = await mk(tS, `Listing Jalur Cancel ${stamp}`);
const tx3 = (await J(await post(`/listings/${lid3}/transactions`, { agreedPrice: 9000 }, tX))).data;
await patch(`/transactions/${tx3.id}/status`, { status: "ACCEPTED" }, tS);
check("ACCEPTED -> listing RESERVED", "RESERVED", (await J(await get(`/listings/${lid3}`))).data.status);
// Pembatalan oleh BUYER (tX) — bukan tB, tB bukan partisipan transaksi ini.
const r4 = await patch(`/transactions/${tx3.id}/status`, { status: "CANCELLED" }, tX);
check("buyer (partisipan) CANCEL -> 200", 200, r4.status);
check("  status CANCELLED", "CANCELLED", (await J(r4)).data.status);
check("  listing kembali ACTIVE", "ACTIVE", (await J(await get(`/listings/${lid3}`))).data.status);

// Non-partisipan memang harus ditolak.
const r4b = await patch(`/transactions/${tx3.id}/status`, { status: "CANCELLED" }, tB);
check("non-partisipan CANCEL -> 403", 403, r4b.status);
check("  code NOT_TRANSACTION_PARTICIPANT", "NOT_TRANSACTION_PARTICIPANT", (await J(r4b)).error?.code);

// ---------- BR-03: listing ARCHIVED ----------
console.log("\n########## BR-03 ARCHIVED ##########");
const lid4 = await mk(tS, `Listing Arsip ${stamp}`);
await del(`/listings/${lid4}`, tS);
const r5 = await post(`/listings/${lid4}/transactions`, { agreedPrice: 9000 }, tX);
check("ARCHIVED -> transaksi ditolak 409", 409, r5.status);
check("  code LISTING_NOT_TRANSACTABLE", "LISTING_NOT_TRANSACTABLE", (await J(r5)).error?.code);

// ---------- Chat pada listing tidak aktif ----------
console.log("\n########## CHAT LISTING TIDAK AKTIF ##########");
const r6 = await post("/chats", { listingId: lid4 }, tX);
check("chat listing ARCHIVED ditolak 409", 409, r6.status);
check("  code LISTING_NOT_CHATTABLE", "LISTING_NOT_CHATTABLE", (await J(r6)).error?.code);

// ---------- 404 ----------
console.log("\n########## 404 ##########");
const ZERO = "00000000-0000-0000-0000-000000000000";
check("GET /chats/:id ngawur", 404, (await get(`/chats/${ZERO}`, tS)).status);
check("GET /transactions/:id ngawur", 404, (await get(`/transactions/${ZERO}`, tS)).status);
check("GET /reviews/:id ngawur", 404, (await get(`/reviews/${ZERO}`)).status);
check("POST /chats listing ngawur", 404, (await post("/chats", { listingId: ZERO }, tX)).status);

console.log(`\nPASS: ${pass}   FAIL: ${fail}`);
process.exit(0);
