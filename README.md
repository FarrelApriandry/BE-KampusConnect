# KampusConnect API — Sprint 1 (Auth + Profile)

ElysiaJS + Bun + Neon PostgreSQL. Base path Sprint 1: `/api/v1`.

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

## Error envelope (SRS §12)

```json
{ "success": false, "error": { "code": "EMAIL_TAKEN", "message": "...", "details": null }, "requestId": "..." }
```

Kode: `EMAIL_DOMAIN_NOT_ALLOWED` (400), `VALIDATION_ERROR` (422),
`UNAUTHORIZED`/`INVALID_CREDENTIALS`/`NOT_ADMIN`/`SESSION_INVALID` (401),
`FORBIDDEN`/`NOT_VERIFIED`/`ACCOUNT_SUSPENDED` (403),
`NOT_FOUND`/`USER_NOT_FOUND`/`ROUTE_NOT_FOUND` (404),
`CONFLICT`/`EMAIL_TAKEN`/`STUDENT_ID_TAKEN` (409), `RATE_LIMITED` (429).

## Struktur

```text
src/
├── config/env.ts            # validasi env wajib
├── db/{client,migrate,seed}.ts
├── plugins/{api,error-handler}.ts  # JWT, mapError (.onError per router), requestId
├── shared/{errors,utils}    # AppError hierarchy, respond ok/fail, rateLimit
├── modules/
│   ├── auth/{auth.routes,auth.service}.ts
│   └── users/{users.routes,users.service}.ts
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
