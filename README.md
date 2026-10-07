# KampusConnect API — Sprint 1, 2 & 3

ElysiaJS + Bun + Neon PostgreSQL. Base path: `/api/v1`.

- **Sprint 1**: auth + profile (register/login/verify, `/me`, `/users/:id`)
- **Sprint 2**: categories, listings CRUD, search/filter/sort + pagination, listing detail, seller reputation
- **Sprint 3**: chat (FR-08), transaksi + state machine (FR-09), review (FR-10), reputasi diperluas (FR-11)

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
| GET | `/api/v1/users/:id/reputation` | — | avg rating + completed + positive rate + `campusVerified` |

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
`REVIEWER_NOT_BUYER`/`ADMIN_ONLY` (403),
`NOT_FOUND`/`USER_NOT_FOUND`/`LISTING_NOT_FOUND`/`CATEGORY_NOT_FOUND`/
`CHAT_NOT_FOUND`/`TRANSACTION_NOT_FOUND`/`REVIEW_NOT_FOUND`/`ROUTE_NOT_FOUND` (404),
`CONFLICT`/`EMAIL_TAKEN`/`STUDENT_ID_TAKEN`/`STATUS_UNCHANGED`/
`CANNOT_CHAT_SELF`/`CANNOT_BUY_OWN_LISTING`/`LISTING_NOT_CHATTABLE`/
`LISTING_NOT_TRANSACTABLE`/`INVALID_STATUS_TRANSITION`/
`TRANSACTION_NOT_COMPLETED`/`REVIEW_ALREADY_EXISTS`/`SELLER_NOT_ACTIVE` (409),
`RATE_LIMITED` (429).

## Struktur

```text
src/
├── config/env.ts            # validasi env wajib
├── db/{client,migrate,seed}.ts
├── plugins/{api,error-handler}.ts  # JWT, mapError (.onError per router), requestId
├── shared/{errors,utils}    # AppError hierarchy, respond ok/fail, rateLimit
├── modules/
│   ├── auth/{auth.routes,auth.service}.ts
│   ├── users/{users.routes,users.service}.ts      # profil + reputasi (FR-11)
│   ├── categories/{categories.routes,categories.service}.ts
│   ├── listings/{listings.routes,listings.service}.ts
│   ├── chats/{chats.routes,chats.service}.ts      # FR-08
│   ├── transactions/{transactions.routes,transactions.service}.ts  # FR-09
│   └── reviews/{reviews.routes,reviews.service}.ts                 # FR-10
└── routes/drama.routes.ts   # legacy, hapus saat FE migrasi
database/
├── migrations/001_initial.sql   # 10 tabel MVP + index SDD §6.2 (+ .down.sql rollback)
└── seeds/{001_categories,002_admin}.sql
```

Catatan Elysia: error hook harus `.onError(mapError)` langsung di tiap
instance (main app + tiap router) — `.use()` plugin tidak merambatkan error
hook ke sub-router ter-mount di versi ini. Auth membaca token langsung dari
`ctx.request.headers` + `ctx.jwt` di handler (derive token tidak terlihat di
sub-router).
