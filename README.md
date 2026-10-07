# KampusConnect API — Sprint 1 & 2

ElysiaJS + Bun + Neon PostgreSQL. Base path: `/api/v1`.

- **Sprint 1**: auth + profile (register/login/verify, `/me`, `/users/:id`)
- **Sprint 2**: categories, listings CRUD, search/filter/sort + pagination, listing detail, seller reputation

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
| GET | `/api/v1/users/:id/reviews` | — | placeholder Sprint 1 (`items: []`, penuh di Sprint 3) |
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
| GET | `/api/v1/users/:id/reputation` | — | avg rating + completed + positive rate |

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
`FORBIDDEN`/`NOT_VERIFIED`/`ACCOUNT_SUSPENDED`/`NOT_LISTING_OWNER` (403),
`NOT_FOUND`/`USER_NOT_FOUND`/`LISTING_NOT_FOUND`/`CATEGORY_NOT_FOUND`/`ROUTE_NOT_FOUND` (404),
`CONFLICT`/`EMAIL_TAKEN`/`STUDENT_ID_TAKEN`/`STATUS_UNCHANGED` (409), `RATE_LIMITED` (429).

## Struktur

```text
src/
├── config/env.ts            # validasi env wajib
├── db/{client,migrate,seed}.ts
├── plugins/{api,error-handler}.ts  # JWT, mapError (.onError per router), requestId
├── shared/{errors,utils}    # AppError hierarchy, respond ok/fail, rateLimit
├── modules/
│   ├── auth/{auth.routes,auth.service}.ts
│   ├── users/{users.routes,users.service}.ts      # profil + reputasi
│   ├── categories/{categories.routes,categories.service}.ts
│   └── listings/{listings.routes,listings.service}.ts
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
