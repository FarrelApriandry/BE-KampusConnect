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

const req = (method: string) => (p: string, b?: unknown, t?: string) =>
  fetch(B + p, {
    method,
    headers: { "Content-Type": "application/json", ...(t ? auth(t) : {}) },
    ...(b !== undefined ? { body: JSON.stringify(b) } : {}),
  });

const post = req("POST");
const patch = req("PATCH");
const get = (p: string, t?: string) => fetch(B + p, { headers: t ? auth(t) : {} });

const reg = async (email: string, name: string) =>
  (await J(await post("/auth/register", {
    name,
    email,
    password: "Secret123!",
    confirmPassword: "Secret123!",
  }))).data.token;

const login = async (email: string, password = "Secret123!") =>
  (await J(await post("/auth/login", { email, password }))).data.token;

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
const EMAIL_S = `s4.seller${stamp}@students.untidar.ac.id`;
const EMAIL_B = `s4.buyer${stamp}@students.untidar.ac.id`;

const tS = await reg(EMAIL_S, "S4 Seller");
const tB = await reg(EMAIL_B, "S4 Buyer");
const meS = (await J(await get("/me", tS))).data;
const meB = (await J(await get("/me", tB))).data;
const tAdmin = await login("admin@untidar.ac.id", "Admin123!");

const cats = (await J(await get("/categories"))).data.items;
const mk = async (t: string, title: string) =>
  (await J(await post("/listings", {
    title,
    description: "test sprint 4",
    categoryId: cats[0].id,
    type: "PRODUCT",
    price: 25000,
    condition: "USED_GOOD",
  }, t))).data;

// ============ FR-12 REPORT ============
console.log("########## FR-12 REPORT ##########");
const listing = await mk(tS, `Listing Dilaporkan ${stamp}`);

const r1 = await post("/reports", { listingId: listing.id, reason: "SCAM", description: "harga tidak wajar" }, tB);
check("POST /reports -> 201 Created", 201, r1.status);
const rep1 = (await J(r1)).data;
check("  status OPEN (BR-09 belum dihukum)", "OPEN", rep1.status);
check("  reason SCAM", "SCAM", rep1.reason);

// BR-09: listing yang dilaporkan TIDAK otomatis dianggap bersalah.
const still = (await J(await get(`/listings/${listing.id}`))).data;
check("  listing masih ACTIVE (BR-09)", "ACTIVE", still.status);

// Report akun
const r2 = await post("/reports", { targetUserId: meS.id, reason: "HARASSMENT", description: "chat kasar" }, tB);
check("POST /reports (target akun) -> 201", 201, r2.status);
const rep2 = (await J(r2)).data;

// Validasi reason
const r3 = await post("/reports", { listingId: listing.id, reason: "NGASAL" }, tB);
check("reason tidak valid -> 422", 422, r3.status);
// Tanpa target
const r4 = await post("/reports", { reason: "SPAM" }, tB);
check("tanpa listingId/targetUserId -> 422", 422, r4.status);
check("  code VALIDATION_ERROR", "VALIDATION_ERROR", (await J(r4)).error?.code);
// Lapor diri sendiri
const r5 = await post("/reports", { listingId: listing.id, reason: "SCAM" }, tS);
check("lapor listing sendiri -> 409", 409, r5.status);
check("  code CANNOT_REPORT_SELF", "CANNOT_REPORT_SELF", (await J(r5)).error?.code);

// GET list & detail
const r6 = await get("/reports", tB);
check("GET /reports (pelapor)", 200, r6.status);
check("  total 2", 2, (await J(r6)).data.total);
const r7 = await get(`/reports/${rep1.id}`, tB);
check("GET /reports/:id (pelapor)", 200, r7.status);
// Orang lain tidak boleh baca
const tOther = await reg(`s4.other${stamp}@students.untidar.ac.id`, "S4 Other");
const r8 = await get(`/reports/${rep1.id}`, tOther);
check("GET /reports/:id (bukan pelapor) -> 403", 403, r8.status);
check("  code NOT_REPORT_OWNER", "NOT_REPORT_OWNER", (await J(r8)).error?.code);

// ============ FR-13 MODERASI ============
console.log("\n########## FR-13 MODERASI ##########");
// User biasa tidak boleh akses admin
const a0 = await get("/admin/reports", tB);
check("GET /admin/reports (user biasa) -> 403", 403, a0.status);
check("  code ADMIN_ONLY", "ADMIN_ONLY", (await J(a0)).error?.code);

const a1 = await get("/admin/reports", tAdmin);
check("GET /admin/reports (admin)", 200, a1.status);
const queue = (await J(a1)).data;
check("  total 2", 2, queue.total);
check("  summary.OPEN 2", 2, queue.summary?.OPEN);

const a2 = await get(`/admin/reports/${rep1.id}`, tAdmin);
check("GET /admin/reports/:id (admin)", 200, a2.status);
check("  reporter_name terisi", "S4 Buyer", (await J(a2)).data.reporter_name);

// Transisi tidak sah: OPEN -> OPEN
const a3 = await patch(`/admin/reports/${rep1.id}/status`, { status: "OPEN" }, tAdmin);
check("transisi OPEN->OPEN -> 409", 409, a3.status);
check("  code INVALID_REPORT_TRANSITION", "INVALID_REPORT_TRANSITION", (await J(a3)).error?.code);

// OPEN -> UNDER_REVIEW
const a4 = await patch(`/admin/reports/${rep1.id}/status`, { status: "UNDER_REVIEW", note: "sedang ditinjau" }, tAdmin);
const a4Body = await J(a4);
check("OPEN -> UNDER_REVIEW", 200, a4.status);
check("  status UNDER_REVIEW", "UNDER_REVIEW", a4Body.data.status);
check("  ada 1 aksi tercatat", 1, a4Body.data.actions.length);

// Aksi HIDE_LISTING
const a5 = await post(`/admin/reports/${rep1.id}/actions`, { action: "HIDE_LISTING", note: "terbukti scam" }, tAdmin);
const a5Body = await J(a5);
check("POST HIDE_LISTING", 200, a5.status);
check("  laporan jadi RESOLVED", "RESOLVED", a5Body.data.status);
check("  resolved_at terisi", true, a5Body.data.resolved_at !== null);
const hidden = (await J(await get(`/listings/${listing.id}`))).data;
check("  listing jadi ARCHIVED", "ARCHIVED", hidden.status);

// Laporan yang sudah ditutup tidak bisa ditindak lagi
const a6 = await post(`/admin/reports/${rep1.id}/actions`, { action: "WARN" }, tAdmin);
check("aksi pada laporan tertutup -> 409", 409, a6.status);
check("  code REPORT_ALREADY_CLOSED", "REPORT_ALREADY_CLOSED", (await J(a6)).error?.code);

// WARN via report kedua -> UNDER_REVIEW
const a7 = await post(`/admin/reports/${rep2.id}/actions`, { action: "WARN", note: "teguran pertama" }, tAdmin);
check("POST WARN", 200, a7.status);
check("  laporan jadi UNDER_REVIEW", "UNDER_REVIEW", (await J(a7)).data.status);

// SUSPEND_USER
const a8 = await post(`/admin/reports/${rep2.id}/actions`, { action: "SUSPEND_USER", note: "pelanggaran berat" }, tAdmin);
check("POST SUSPEND_USER", 200, a8.status);
check("  laporan jadi RESOLVED", "RESOLVED", (await J(a8)).data.status);
const meAfter = await get("/me", tS);
check("  seller SUSPENDED -> 403 di /me", 403, meAfter.status);
check("  code ACCOUNT_SUSPENDED", "ACCOUNT_SUSPENDED", (await J(meAfter)).error?.code);
// BR-10: tidak bisa buat listing baru
const a9 = await post("/listings", {
  title: "Listing setelah suspend",
  description: "harus gagal",
  categoryId: cats[0].id,
  type: "PRODUCT",
  price: 1000,
  condition: "USED_GOOD",
}, tS);
check("  SUSPENDED tidak bisa buat listing", 403, a9.status);

// Aktifkan kembali lewat admin
const a10 = await patch(`/admin/users/${meS.id}/status`, { status: "ACTIVE", note: "banding diterima" }, tAdmin);
check("PATCH /admin/users/:id/status -> ACTIVE", 200, a10.status);
check("  account_status ACTIVE", "ACTIVE", (await J(a10)).data.account_status);
const meBack = await get("/me", tS);
check("  seller bisa akses lagi", 200, meBack.status);

// Status sama -> 409
const a11 = await patch(`/admin/users/${meS.id}/status`, { status: "ACTIVE" }, tAdmin);
check("status sama -> 409", 409, a11.status);
check("  code STATUS_UNCHANGED", "STATUS_UNCHANGED", (await J(a11)).error?.code);

// Tidak bisa suspend diri sendiri
const a12 = await patch(`/admin/users/${(await J(await get("/me", tAdmin))).data.id}/status`, { status: "SUSPENDED" }, tAdmin);
check("suspend diri sendiri -> 409", 409, a12.status);
check("  code CANNOT_MODIFY_SELF", "CANNOT_MODIFY_SELF", (await J(a12)).error?.code);

// WARN endpoint
const a13 = await post(`/admin/users/${meB.id}/warn`, { note: "peringatan manual" }, tAdmin);
check("POST /admin/users/:id/warn", 200, a13.status);
check("  action WARN", "WARN", (await J(a13)).data.action);

// Riwayat aksi (FR-15 auditability)
const a14 = await get("/admin/actions", tAdmin);
const a14Body = await J(a14);
check("GET /admin/actions", 200, a14.status);
check("  ada aksi tercatat (>=5)", true, a14Body.data.total >= 5);
const firstAction = a14Body.data.items[0];
check("  admin_name terisi (actor)", true, Boolean(firstAction.admin_name));
check("  created_at terisi (timestamp)", true, Boolean(firstAction.created_at));

// ============ TRUST SCORE (SDD §14) ============
console.log("\n########## TRUST SCORE SDD §14 ##########");
const ts1 = await get(`/users/${meS.id}/trust-score`);
check("GET /users/:id/trust-score", 200, ts1.status);
const tsData = (await J(ts1)).data;
check("  ada trustScore", true, typeof tsData.trustScore === "number");
check("  ada trustLabel", true, typeof tsData.trustLabel === "string");
check("  breakdown lengkap", 6, Object.keys(tsData.breakdown).length);
check("  verified +20", 20, tsData.breakdown.verificationWeight);

// Reputasi lengkap
const rep = (await J(await get(`/users/${meS.id}/reputation`))).data;
check("GET /users/:id/reputation", true, typeof rep.trustScore === "number");
check("  campusVerified", true, rep.campusVerified);
check("  ada breakdown", true, Boolean(rep.breakdown));

// Akun baru tanpa aktivitas: hanya bobot verifikasi (+20).
// Pakai user bersih supaya tidak terpengaruh penalti moderasi user lain.
const tFresh = await reg(`s4.fresh${stamp}@students.untidar.ac.id`, "S4 Fresh");
const tsFresh = (await J(await get(`/users/${(await J(await get("/me", tFresh))).data.id}/trust-score`))).data;
check("akun baru: trustScore 20 (verified saja)", 20, tsFresh.trustScore);
check("  label RENDAH", "RENDAH", tsFresh.trustLabel);
check("  breakdown lain 0", 0,
  tsFresh.breakdown.transactionWeight + tsFresh.breakdown.reviewWeight +
  tsFresh.breakdown.accountAgeWeight + tsFresh.breakdown.cancellationPenalty +
  tsFresh.breakdown.moderationPenalty);

// Buyer kena WARN di atas -> penalti moderasi -10 (bukti penalti benar-benar jalan).
const tsWarned = (await J(await get(`/users/${meB.id}/trust-score`))).data;
check("buyer yang di-WARN: penalti moderasi 10", 10, tsWarned.breakdown.moderationPenalty);
check("  trustScore 10 (20 - 10)", 10, tsWarned.trustScore);

// ============ 201 Created SEMUA POST ============
console.log("\n########## STATUS 201 CREATED ##########");
const l2 = await mk(tS, `Listing Status 201 ${stamp}`);
check("POST /listings -> 201", 201, (await post("/listings", {
  title: `Cek 201 ${stamp}`,
  description: "cek status",
  categoryId: cats[0].id,
  type: "PRODUCT",
  price: 1000,
  condition: "USED_GOOD",
}, tS)).status);

const ch = await post("/chats", { listingId: l2.id }, tB);
check("POST /chats -> 201", 201, ch.status);
const room = (await J(ch)).data;
check("POST /chats/:id/messages -> 201", 201, (await post(`/chats/${room.id}/messages`, { message: "hai" }, tB)).status);

const tx = await post(`/listings/${l2.id}/transactions`, { agreedPrice: 20000 }, tB);
check("POST /listings/:id/transactions -> 201", 201, tx.status);
const txData = (await J(tx)).data;
await patch(`/transactions/${txData.id}/status`, { status: "ACCEPTED" }, tS);
await patch(`/transactions/${txData.id}/status`, { status: "COMPLETED" }, tB);
check("POST /transactions/:id/reviews -> 201", 201, (await post(`/transactions/${txData.id}/reviews`, { rating: 5, comment: "oke" }, tB)).status);

// ============ TRUST SCORE NAIK SETELAH TRANSAKSI ============
console.log("\n########## TRUST SCORE NAIK ##########");
const tsAfter = (await J(await get(`/users/${meS.id}/trust-score`))).data;
check("transaksi selesai +4", 4, tsAfter.breakdown.transactionWeight);
check("review positif +3", 3, tsAfter.breakdown.reviewWeight);
check("moderationPenalty > 0 (kena WARN+SUSPEND)", true, tsAfter.breakdown.moderationPenalty > 0);
check("trustScore dihitung ulang", true, tsAfter.trustScore !== tsData.trustScore);

// ============ SWAGGER ============
console.log("\n########## SWAGGER ##########");
const sw = await fetch("http://127.0.0.1:3001/docs/json");
check("GET /docs/json", 200, sw.status);
const spec = await sw.json();
check("  title KampusConnect API", "KampusConnect API", spec.info?.title);
check("  ada >=25 path", true, Object.keys(spec.paths ?? {}).length >= 25);
check("  tag Admin terdaftar", true, (spec.tags ?? []).some((t: any) => t.name === "Admin"));

console.log(`\nPASS: ${pass}   FAIL: ${fail}`);
process.exit(0);
