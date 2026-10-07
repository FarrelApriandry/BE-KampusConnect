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
const post = (p: string, b?: unknown, t?: string) =>
  fetch(B + p, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(t ? auth(t) : {}) },
    ...(b !== undefined ? { body: JSON.stringify(b) } : {}),
  });
const patch = (p: string, b: unknown, t: string) =>
  fetch(B + p, { method: "PATCH", headers: { "Content-Type": "application/json", ...auth(t) }, body: JSON.stringify(b) });
const get = (p: string, t?: string) => fetch(B + p, { headers: t ? auth(t) : {} });

const reg = async (email: string, name: string) =>
  (await J(await post("/auth/register", { name, email, password: "Secret123!", confirmPassword: "Secret123!" }))).data.token;

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
const tS = await reg(`rg.seller${stamp}@students.untidar.ac.id`, "RG Seller");
const tB = await reg(`rg.buyer${stamp}@students.untidar.ac.id`, "RG Buyer");

console.log("########## REGRESI SPRINT 1 (auth & profil) ##########");
check("POST /auth/register -> 201", 201, (await post("/auth/register", {
  name: "RG Baru", email: `rg.new${stamp}@students.untidar.ac.id`,
  password: "Secret123!", confirmPassword: "Secret123!",
})).status);
const badDomain = await post("/auth/register", {
  name: "RG Luar", email: `rg.luar${stamp}@gmail.com`,
  password: "Secret123!", confirmPassword: "Secret123!",
});
check("domain non-kampus -> 400", 400, badDomain.status);
check("  code EMAIL_DOMAIN_NOT_ALLOWED", "EMAIL_DOMAIN_NOT_ALLOWED", (await J(badDomain)).error?.code);
const dup = await post("/auth/register", {
  name: "RG Dup", email: `rg.seller${stamp}@students.untidar.ac.id`,
  password: "Secret123!", confirmPassword: "Secret123!",
});
check("email duplikat -> 409", 409, dup.status);
const badLogin = await post("/auth/login", { email: `rg.seller${stamp}@students.untidar.ac.id`, password: "Salah123!" });
check("password salah -> 401", 401, badLogin.status);
check("GET /me", 200, (await get("/me", tS)).status);
check("PATCH /me", 200, (await patch("/me", { bio: "halo" }, tS)).status);
check("GET /users/:id", 200, (await get(`/users/${(await J(await get("/me", tS))).data.id}`)).status);
check("POST /auth/refresh", 200, (await post("/auth/refresh", undefined, tS)).status);
check("GET /health", 200, (await fetch("http://127.0.0.1:3001/health")).status);
check("GET /api/dramas (legacy)", 200, (await fetch("http://127.0.0.1:3001/api/dramas")).status);

console.log("\n########## REGRESI SPRINT 2 (listings) ##########");
const cats = (await J(await get("/categories"))).data.items;
check("GET /categories", true, cats.length === 10);
const l = await post("/listings", {
  title: `RG Listing ${stamp}`, description: "regresi", categoryId: cats[0].id,
  type: "PRODUCT", price: 45000, condition: "USED_GOOD", meetupLocation: "Gedung C",
  images: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
}, tS);
check("POST /listings -> 201", 201, l.status);
const listing = (await J(l)).data;
check("  price number", 45000, listing.price);
check("  images 2", 2, listing.images.length);
check("  isOwner true", true, listing.isOwner);

const feed = await J(await get(`/listings?search=RG%20Listing%20${stamp}`));
check("GET /listings search", 1, feed.data.total);
check("  price number di feed", 45000, feed.data.items[0].price);
const sortFeed = await J(await get("/listings?sort=price_asc&limit=5"));
check("GET /listings sort=price_asc", 200, sortFeed.success ? 200 : 0);
const detail = await J(await get(`/listings/${listing.id}`));
check("GET /listings/:id", 200, detail.success ? 200 : 0);
check("  sellerReputation ada", true, detail.data.sellerReputation !== null);
check("  sellerReputation punya trustScore", true, typeof detail.data.sellerReputation.trustScore === "number");
const upd = await patch(`/listings/${listing.id}`, { price: 40000 }, tS);
check("PATCH /listings/:id", 200, upd.status);
const notOwner = await patch(`/listings/${listing.id}`, { price: 1000 }, tB);
check("PATCH bukan owner -> 403", 403, notOwner.status);
check("  code NOT_LISTING_OWNER", "NOT_LISTING_OWNER", (await J(notOwner)).error?.code);
check("GET /users/:id/listings", 200, (await get(`/users/${(await J(await get("/me", tS))).data.id}/listings`)).status);
check("GET /users/:id/reputation", 200, (await get(`/users/${(await J(await get("/me", tS))).data.id}/reputation`)).status);

console.log("\n########## REGRESI SPRINT 3 (chat/transaksi/review) ##########");
const ch = await post("/chats", { listingId: listing.id }, tB);
check("POST /chats -> 201", 201, ch.status);
const room = (await J(ch)).data;
check("POST pesan -> 201", 201, (await post(`/chats/${room.id}/messages`, { message: "halo" }, tB)).status);
check("GET /chats", 200, (await get("/chats", tB)).status);
const hist = await J(await get(`/chats/${room.id}/messages`, tB));
check("GET riwayat pesan", 1, hist.data.total);

const tx = await post(`/listings/${listing.id}/transactions`, { agreedPrice: 40000 }, tB);
check("POST transaksi -> 201", 201, tx.status);
const txn = (await J(tx)).data;
check("  status PENDING", "PENDING", txn.status);
const badTx = await patch(`/transactions/${txn.id}/status`, { status: "COMPLETED" }, tS);
check("PENDING->COMPLETED ditolak 409", 409, badTx.status);
const badAccept = await patch(`/transactions/${txn.id}/status`, { status: "ACCEPTED" }, tB);
check("buyer accept ditolak 403", 403, badAccept.status);
check("seller accept", 200, (await patch(`/transactions/${txn.id}/status`, { status: "ACCEPTED" }, tS)).status);
check("  listing RESERVED", "RESERVED", (await J(await get(`/listings/${listing.id}`))).data.status);
check("buyer complete", 200, (await patch(`/transactions/${txn.id}/status`, { status: "COMPLETED" }, tB)).status);
check("  listing SOLD", "SOLD", (await J(await get(`/listings/${listing.id}`))).data.status);
const rv = await post(`/transactions/${txn.id}/reviews`, { rating: 5, comment: "mantap" }, tB);
check("POST review -> 201", 201, rv.status);
const dupRv = await post(`/transactions/${txn.id}/reviews`, { rating: 4 }, tB);
check("review duplikat -> 409", 409, dupRv.status);
check("GET /transactions", 200, (await get("/transactions", tB)).status);
const sellerId = (await J(await get("/me", tS))).data.id;
check("GET /users/:id/reviews", 200, (await get(`/users/${sellerId}/reviews`)).status);
const repAfter = (await J(await get(`/users/${sellerId}/reputation`))).data;
check("reputasi: completed 1", 1, repAfter.completedTransactions);
check("reputasi: avg 5", 5, repAfter.averageRating);
check("reputasi: trustScore naik dari 20", true, repAfter.trustScore > 20);

console.log("\n########## REGRESI ERROR PATH ##########");
check("404 route ngawur", 404, (await get("/tidak-ada-endpoint")).status);
check("401 tanpa token", 401, (await get("/me")).status);
check("422 body invalid", 422, (await post("/listings", { title: "x" }, tS)).status);

console.log(`\nPASS: ${pass}   FAIL: ${fail}`);
process.exit(0);
