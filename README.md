# KampusConnect API — BE Lengkap (Sprint 1–4)

ElysiaJS + Bun + Neon PostgreSQL. Base path: `/api/v1`. Dokumentasi interaktif: **`/docs`** (Swagger UI).

- **Sprint 1**: auth + profile (register/login/verify, `/me`, `/users/:id`)
- **Sprint 2**: categories, listings CRUD, search/filter/sort + pagination, listing detail, seller reputation
- **Sprint 3**: chat (FR-08), transaksi + state machine (FR-09), review (FR-10), reputasi diperluas (FR-11)
- **Sprint 4**: report (FR-12), moderasi admin (FR-13), trust score penuh (SDD §14), Swagger, `201 Created`

## Setup

```bash
cp .env.example .env   # isi DATABASE_URL + JWT_SECRET
bun install
bun run migrate        # database/migrations/*.sql
bun run seed           # categories + admin default
bun run dev            # PORT dari .env (default 3000)
```

Admin default (seed `002_admin.sql`): `admin@untidar.ac.id` / `Admin123!`
— ganti password setelah login pertama.

## Deploy ke Vercel

Elysia terdeteksi otomatis oleh Vercel (zero config) — cukup `export default app`
di `src/index.ts`. Tiga hal yang wajib, semuanya sudah terpasang:

1. **`export default app`** — Vercel tidak mendukung `app.listen()`. Blok listen
   di-guard `if (!process.env.VERCEL)`, jadi `bun run dev` lokal tetap jalan.
2. **`vercel.json` → `bunVersion: "1.4.x"`** — tanpa ini fungsi jalan di Node.js
   dan `Bun.password` (auth) `undefined` → register & login crash.
3. **Env vars** di dashboard Vercel (Production + Preview): `DATABASE_URL`,
   `JWT_SECRET`, `NODE_ENV=production`. `src/config/env.ts` melempar error saat
   import bila keduanya kosong → seluruh app gagal start, bukan satu endpoint.

Setelah deploy, cek berurutan: `/` → `/health` → `/api/v1/categories` → `/docs`.

Catatan runtime:

- **`prepare: false`** di `src/db/client.ts` — Neon pooler memakai PgBouncer
  transaction mode, prepared statement bernama bisa "hilang" di backend berbeda.
  Tanpa ini muncul `prepared statement does not exist` secara intermiten.
- **`max: 3` saat serverless** — tiap instance fungsi punya pool sendiri.
- Migrasi & seed **tidak** jalan otomatis di Vercel; jalankan dari laptop
  (`bun run migrate && bun run seed`) — DB Neon-nya sudah sama.
- Vercel Hobby: maksimum 12 function per deployment. Preset Bun mendeteksi satu
  server (`Bun.serve`), jadi ini tidak terpicu.

## Verifikasi kampus (keputusan Sprint 1)

Hanya cek domain allowlist: `@untidar.ac.id` / `@students.untidar.ac.id`
(`ALLOWED_CAMPUS_DOMAINS`). Domain valid → `VERIFIED` langsung saat register.
`POST /auth/verify` untuk re-check akun `PENDING`.

## Endpoints (Sprint 1)

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/` | — | info service |
| GET | `/health` | — | status + cek DB |
| POST | `/api/v1/auth/register` | — | name, email kampus, password, student_id?, faculty?, major?, academic_year? |
| POST | `/api/v1/auth/login` | — | email, password, mode? (`USER`/`ADMIN`; mode ADMIN ditolak bila role bukan ADMIN) |
| POST | `/api/v1/auth/verify` | Bearer | re-check verifikasi akun sendiri |
| POST | `/api/v1/auth/refresh` | Bearer | token baru |
| POST | `/api/v1/auth/logout` | — | stateless, client buang token |
| GET | `/api/v1/me` | Bearer | profil sendiri (fresh dari DB) |
| PATCH | `/api/v1/me` | Bearer | name, student_id, faculty, major, academic_year, avatar_url, bio |
| GET | `/api/v1/users/:id` | — | profil publik + badge verifikasi |
| GET | `/api/dramas` | — | legacy Pertemuan-4, dihapus saat FE migrasi |

## Endpoints (Sprint 2)

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/api/v1/categories` | — | daftar kategori (10 seed) |
| GET | `/api/v1/listings` | opsional | feed + search/filter/sort/pagination |
| GET | `/api/v1/listings/:id` | opsional | detail + images + seller + `sellerReputation` + `isOwner` |
| POST | `/api/v1/listings` | Bearer+VERIFIED | buat listing (BR-02) |
| PATCH | `/api/v1/listings/:id` | Bearer+owner | update field & status |
| DELETE | `/api/v1/listings/:id` | Bearer+owner | soft delete → `ARCHIVED` |
| GET | `/api/v1/users/:id/listings` | — | listing ACTIVE milik seller |
| GET | `/api/v1/users/:id/reputation` | — | indikator FR-11 + trust score + `breakdown` |
| GET | `/api/v1/users/:id/trust-score` | — | trust score ringkas (SDD §14) |

## Endpoints (Sprint 3)

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/api/v1/chats` | Bearer | semua room milik user (buyer atau seller) + lawan bicara + pesan terakhir |
| POST | `/api/v1/chats` | Bearer | buka/ambil room untuk `{ listingId }` — idempoten (UNIQUE listing+buyer) |
| GET | `/api/v1/chats/:roomId` | partisipan | detail room |
| GET | `/api/v1/chats/:roomId/messages` | partisipan | riwayat `page`/`limit` (max 100), urut `created_at ASC` (SDD §13) |
| POST | `/api/v1/chats/:roomId/messages` | partisipan | kirim pesan teks (max 2000 char), rate limit 120/menit |
| GET | `/api/v1/transactions` | Bearer | transaksi milik user + filter `role=BUYER\|SELLER`, `status` |
| GET | `/api/v1/transactions/:id` | partisipan | detail + buyer + seller + listing + review |
| POST | `/api/v1/listings/:id/transactions` | Bearer+VERIFIED | buyer membuat request `{ agreedPrice }` (FR-09) |
| PATCH | `/api/v1/transactions/:id/status` | partisipan | state machine (lihat bawah) |
| POST | `/api/v1/transactions/:id/reviews` | buyer | `{ rating: 1-5, comment? }` (FR-10) |
| GET | `/api/v1/reviews/:id` | — | detail review |
| GET | `/api/v1/users/:id/reviews` | — | review yang diterima user + `averageRating` (seluruh halaman) |

### State machine transaksi (SDD §9)

```text
PENDING → ACCEPTED → COMPLETED
PENDING → REJECTED
ACCEPTED → CANCELLED
```

- Transisi di luar daftar itu → `409 INVALID_STATUS_TRANSITION` (mis. `PENDING → COMPLETED`)
- `ACCEPTED`/`REJECTED` hanya seller → `403 SELLER_ONLY` (BR-05)
- `COMPLETED`/`CANCELLED` boleh buyer atau seller
- Transisi menyetir lifecycle listing (SDD §8): `ACCEPTED` → `RESERVED`,
  `COMPLETED` → `SOLD`, `REJECTED`/`CANCELLED` → balik `ACTIVE` bila tak ada
  transaksi aktif lain. `COMPLETED` juga menolak transaksi `PENDING` lain di
  listing yang sama. Semua dalam satu `sql.begin` transaction.

### Aturan bisnis Sprint 3

- BR-03: listing non-`ACTIVE` menolak transaksi & chat baru (`409`)
- BR-04: seller tidak bisa beli listing sendiri (`409 CANNOT_BUY_OWN_LISTING`)
- BR-05: hanya seller boleh accept/reject (`403 SELLER_ONLY`)
- BR-06: review hanya dari transaksi `COMPLETED` (`409 TRANSACTION_NOT_COMPLETED`)
- BR-07: satu review per transaksi (`409 REVIEW_ALREADY_EXISTS`)
- BR-10: akun `SUSPENDED` ditolak di semua operasi marketplace (`403 ACCOUNT_SUSPENDED`)
- Chat: non-partisipan tidak bisa baca/tulis (`403 NOT_CHAT_PARTICIPANT`)

## Endpoints (Sprint 4)

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/api/v1/reports` | Bearer | laporan yang dibuat user sendiri |
| GET | `/api/v1/reports/:id` | pelapor/admin | detail laporan |
| POST | `/api/v1/reports` | Bearer+VERIFIED | buat laporan `{ listingId? , targetUserId?, reason, description? }` |
| GET | `/api/v1/admin/reports` | ADMIN | antrean moderasi + `summary` per status |
| GET | `/api/v1/admin/reports/:id` | ADMIN | detail + riwayat aksi moderasi |
| PATCH | `/api/v1/admin/reports/:id/status` | ADMIN | `{ status, note? }` — transisi tervalidasi |
| POST | `/api/v1/admin/reports/:id/actions` | ADMIN | `{ action, note? }` — WARN / HIDE_LISTING / SUSPEND_USER / DISMISS / OTHER |
| GET | `/api/v1/admin/actions` | ADMIN | riwayat aksi moderasi (FR-15 auditability) |
| POST | `/api/v1/admin/users/:id/warn` | ADMIN | teguran tanpa laporan |
| PATCH | `/api/v1/admin/users/:id/status` | ADMIN | `{ status: ACTIVE\|SUSPENDED, note? }` |

### Reason & status laporan (FR-12 / FR-13)

```text
reason : SCAM · MISLEADING · PROHIBITED_ITEM · SPAM · HARASSMENT · OTHER
status : OPEN → UNDER_REVIEW → RESOLVED | DISMISSED
```

- `OPEN`/`UNDER_REVIEW` boleh langsung ke `RESOLVED`/`DISMISSED`; status akhir tidak bisa dibalik
- Transisi di luar itu → `409 INVALID_REPORT_TRANSITION`
- Laporan tertutup tidak bisa ditindak lagi → `409 REPORT_ALREADY_CLOSED`
- BR-09: melaporkan listing **tidak** mengubah statusnya — hanya admin yang memutuskan
- Aksi `HIDE_LISTING` → listing jadi `ARCHIVED`; `SUSPEND_USER` → akun jadi `SUSPENDED`
- `WARN`/`OTHER` memindahkan laporan ke `UNDER_REVIEW`; `HIDE_LISTING`/`SUSPEND_USER`/`DISMISS` menutupnya
- Admin tidak bisa menangguhkan/menegur dirinya sendiri (`409 CANNOT_MODIFY_SELF`)
- Setiap aksi tercatat di `moderation_actions` (actor + timestamp + target) — FR-15

### Trust score (SDD §14)

```text
trustScore = verificationWeight + transactionWeight + reviewWeight + accountAgeWeight
           - cancellationPenalty - moderationPenalty      (dibulatkan ke 0..100)
```

| Komponen | Bobot | Catatan |
|---|---:|---|
| Akun terverifikasi | +20 | `verification_status = VERIFIED` |
| Transaksi `COMPLETED` (seller) | +4 each | maksimum +40 |
| Review positif (rating ≥ 4) | +3 each | maksimum +30 |
| Umur akun | +1/bulan | maksimum +10 |
| Transaksi `CANCELLED` | −2 each | maksimum −10 |
| Aksi moderasi (WARN/SUSPEND) | −10 each | maksimum −30 |

Bobot **configurable** lewat env (`TRUST_W_VERIFIED`, `TRUST_W_PER_TXN`, …) —
lihat `src/config/trust.ts`. Label: `BARU` < 20 ≤ `RENDAH` < 40 ≤ `CUKUP` < 60 ≤ `TERPERCAYA` < 80 ≤ `SANGAT_TERPERCAYA`.

## Status HTTP

Semua operasi pembuatan resource mengembalikan **`201 Created`**:
`POST /auth/register`, `/listings`, `/chats`, `/chats/:id/messages`,
`/listings/:id/transactions`, `/transactions/:id/reviews`, `/reports`.

## Testing

```bash
PORT=3001 bun src/index.ts &   # server harus hidup
bun tests/run-all.sh           # 4 suite, reset DB otomatis sebelum tiap suite
```

Suite: `regression.smoke.ts` (Sprint 1–3), `sprint3.smoke.sh` + `sprint3.smoke.ts`,
`sprint4.smoke.ts`. Total 227 assertion. `tests/reset-test-data.ts` mengembalikan
DB ke kondisi bersih (admin + 10 kategori).

### Query `GET /listings`

```text
page, limit (max 50), search, category, type, condition, status,
minPrice, maxPrice, sort, sellerId
```

- `sort`: `newest` (default) · `oldest` · `price_asc` · `price_desc` · `relevance`
- `sort` tak dikenal → fallback `newest`; filter enum salah → `422`
- Default hanya `status=ACTIVE`; kirim `status=SOLD|ARCHIVED|...` untuk melihat lainnya
- Response: `{ items, page, limit, total, hasNext }`; `price` selalu `number`

### Aturan bisnis yang ditegakkan

- BR-02: hanya akun `VERIFIED` + `ACTIVE` boleh membuat listing (`403 NOT_VERIFIED`)
- BR-03: listing non-`ACTIVE` tidak muncul di feed default
- BR-08: hanya owner (atau admin) boleh PATCH/DELETE (`403 NOT_LISTING_OWNER`)
- Transisi status tidak boleh sama dengan status saat ini (`409 STATUS_UNCHANGED`)

## Error envelope (SRS §12)

```json
{ "success": false, "error": { "code": "EMAIL_TAKEN", "message": "...", "details": null }, "requestId": "..." }
```

Kode: `EMAIL_DOMAIN_NOT_ALLOWED` (400), `VALIDATION_ERROR` (422),
`UNAUTHORIZED`/`INVALID_CREDENTIALS`/`NOT_ADMIN`/`SESSION_INVALID` (401),
`FORBIDDEN`/`NOT_VERIFIED`/`ACCOUNT_SUSPENDED`/`NOT_LISTING_OWNER`/
`NOT_CHAT_PARTICIPANT`/`NOT_TRANSACTION_PARTICIPANT`/`SELLER_ONLY`/
`REVIEWER_NOT_BUYER`/`NOT_REPORT_OWNER`/`ADMIN_ONLY` (403),
`NOT_FOUND`/`USER_NOT_FOUND`/`LISTING_NOT_FOUND`/`CATEGORY_NOT_FOUND`/
`CHAT_NOT_FOUND`/`TRANSACTION_NOT_FOUND`/`REVIEW_NOT_FOUND`/`REPORT_NOT_FOUND`/
`ROUTE_NOT_FOUND` (404),
`CONFLICT`/`EMAIL_TAKEN`/`STUDENT_ID_TAKEN`/`STATUS_UNCHANGED`/
`CANNOT_CHAT_SELF`/`CANNOT_BUY_OWN_LISTING`/`CANNOT_REPORT_SELF`/
`CANNOT_MODIFY_SELF`/`CANNOT_WARN_SELF`/`CANNOT_SUSPEND_ADMIN`/
`LISTING_NOT_CHATTABLE`/`LISTING_NOT_TRANSACTABLE`/`INVALID_STATUS_TRANSITION`/
`INVALID_REPORT_TRANSITION`/`REPORT_ALREADY_CLOSED`/`NO_LISTING_TARGET`/
`NO_USER_TARGET`/`TRANSACTION_NOT_COMPLETED`/`REVIEW_ALREADY_EXISTS`/
`SELLER_NOT_ACTIVE` (409), `RATE_LIMITED` (429).

## Struktur

```text
src/
├── config/{env,trust}.ts    # env wajib + bobot trust score (SDD §14)
├── db/{client,migrate,seed}.ts
├── plugins/{api,error-handler}.ts  # JWT, mapError (.onError per router), requestId
├── shared/{errors,utils}    # AppError hierarchy, respond ok/fail, rateLimit
├── modules/
│   ├── auth/{auth.routes,auth.service}.ts
│   ├── users/{users.routes,users.service}.ts      # profil + reputasi + trust score
│   ├── categories/{categories.routes,categories.service}.ts
│   ├── listings/{listings.routes,listings.service}.ts
│   ├── chats/{chats.routes,chats.service}.ts      # FR-08
│   ├── transactions/{transactions.routes,transactions.service}.ts  # FR-09
│   ├── reviews/{reviews.routes,reviews.service}.ts                 # FR-10
│   ├── reports/{reports.routes,reports.service}.ts                 # FR-12
│   └── admin/{admin.routes,admin.service}.ts                       # FR-13
└── routes/drama.routes.ts   # legacy, hapus saat FE migrasi
tests/                       # smoke test + runner (bun tests/run-all.sh)
database/
├── migrations/001_initial.sql   # 10 tabel MVP + index SDD §6.2 (+ .down.sql rollback)
└── seeds/{001_categories,002_admin}.sql
```

Catatan Elysia: error hook harus `.onError(mapError)` langsung di tiap
instance (main app + tiap router) — `.use()` plugin tidak merambatkan error
hook ke sub-router ter-mount di versi ini. Auth membaca token langsung dari
`ctx.request.headers` + `ctx.jwt` di handler (derive token tidak terlihat di
sub-router).
