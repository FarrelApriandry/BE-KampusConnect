import { sql } from "../../db/client";
import {
  AuthorizationError,
  BusinessRuleError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors/app-error";
import type { CurrentUser } from "../../plugins/api";
import { requireVerified } from "../../plugins/api";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TRANSACTION_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "REJECTED",
  "COMPLETED",
  "CANCELLED",
] as const;

/**
 * SDD §9 — transisi yang sah. Client tidak boleh mengirim status arbitrer
 * (mis. PENDING → COMPLETED langsung).
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["COMPLETED", "CANCELLED"],
  REJECTED: [],
  COMPLETED: [],
  CANCELLED: [],
};

/** Aksi ini hanya boleh dilakukan seller terkait (BR-05). */
const SELLER_ONLY = ["ACCEPTED", "REJECTED"];

/** Listing yang masih boleh menerima transaction request baru (BR-03). */
const TRANSACTABLE_STATUSES = ["ACTIVE"];

interface TransactionRow {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  agreed_price: string | number;
  status: string;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
}

function assertUuid(id: string, code = "TRANSACTION_NOT_FOUND"): void {
  if (!UUID_RE.test(id)) throw new NotFoundError("Transaksi tidak ditemukan", code);
}

function shape(t: TransactionRow, me: CurrentUser) {
  return {
    ...t,
    // NUMERIC dari driver postgres datang sebagai string (lihat catatan listings).
    agreed_price: Number(t.agreed_price),
    role: t.buyer_id === me.id ? "BUYER" : "SELLER",
  };
}

async function participantsByIds(ids: string[]) {
  const map = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return map;
  const rows = await sql`
    select id, name, avatar_url, faculty, major, verification_status
    from users where id in ${sql(ids)}`;
  for (const r of rows as unknown as Record<string, unknown>[]) {
    map.set(r.id as string, r);
  }
  return map;
}

async function listingsByIds(ids: string[]) {
  const map = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return map;
  const rows = await sql`
    select id, title, price, status, seller_id, category_id from listings
    where id in ${sql(ids)}`;
  for (const r of rows as unknown as Record<string, unknown>[]) {
    map.set(r.id as string, { ...r, price: Number(r.price) });
  }
  return map;
}

async function loadFor(me: CurrentUser, id: string): Promise<TransactionRow> {
  assertUuid(id);
  const rows = await sql`
    select id, listing_id, buyer_id, seller_id, agreed_price, status,
           created_at, accepted_at, completed_at
    from transactions where id = ${id}`;
  const t = rows[0] as unknown as TransactionRow | undefined;
  if (!t) throw new NotFoundError("Transaksi tidak ditemukan", "TRANSACTION_NOT_FOUND");
  if (t.buyer_id !== me.id && t.seller_id !== me.id && me.role !== "ADMIN") {
    throw new AuthorizationError("Bukan partisipan transaksi ini", "NOT_TRANSACTION_PARTICIPANT");
  }
  return t;
}

/**
 * POST /listings/:id/transactions — buyer membuat transaction request (FR-09).
 * Validasi sesuai SDD §10: listing ada, seller aktif, buyer != seller,
 * status listing mengizinkan, harga wajar.
 */
export async function createTransaction(
  me: CurrentUser,
  listingId: string,
  input: { agreedPrice?: number },
) {
  requireVerified(me);
  if (!UUID_RE.test(listingId)) {
    throw new NotFoundError("Listing tidak ditemukan", "LISTING_NOT_FOUND");
  }

  const agreedPrice = Number(input?.agreedPrice);
  if (Number.isNaN(agreedPrice) || agreedPrice < 0) {
    throw new ValidationError("agreedPrice harus angka >= 0");
  }

  const rows = await sql`
    select id, seller_id, title, price, status from listings where id = ${listingId}`;
  const listing = rows[0] as unknown as
    | { id: string; seller_id: string; title: string; price: string; status: string }
    | undefined;
  if (!listing) throw new NotFoundError("Listing tidak ditemukan", "LISTING_NOT_FOUND");

  // BR-04: buyer tidak dapat membuat transaction request untuk listing miliknya.
  if (listing.seller_id === me.id) {
    throw new BusinessRuleError(
      "Tidak bisa bertransaksi pada listing milik sendiri",
      "CANNOT_BUY_OWN_LISTING",
      409,
    );
  }
  // BR-03: listing inactive/sold tidak menerima transaksi baru.
  if (!TRANSACTABLE_STATUSES.includes(listing.status)) {
    throw new BusinessRuleError(
      `Listing berstatus ${listing.status} tidak menerima transaksi baru`,
      "LISTING_NOT_TRANSACTABLE",
      409,
    );
  }
  // Seller harus akun aktif & terverifikasi (SDD §10 "belongs to active seller").
  const sellerRows = await sql`
    select id, account_status, verification_status from users where id = ${listing.seller_id}`;
  const seller = sellerRows[0] as unknown as
    | { id: string; account_status: string; verification_status: string }
    | undefined;
  if (!seller || seller.account_status !== "ACTIVE" || seller.verification_status !== "VERIFIED") {
    throw new BusinessRuleError("Seller tidak aktif atau belum terverifikasi", "SELLER_NOT_ACTIVE", 409);
  }

  const inserted = await sql`
    insert into transactions (listing_id, buyer_id, seller_id, agreed_price)
    values (${listingId}, ${me.id}, ${listing.seller_id}, ${agreedPrice})
    returning id`;
  const id = (inserted[0] as unknown as { id: string }).id;
  return getTransaction(me, id);
}

export interface ListTransactionsQuery {
  page?: number;
  limit?: number;
  status?: string;
  role?: string;
}

/** GET /transactions — transaksi tempat user jadi buyer atau seller. */
export async function listTransactions(me: CurrentUser, q: ListTransactionsQuery) {
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const limit = Math.min(50, Math.max(1, Number(q.limit ?? 20) || 20));
  const offset = (page - 1) * limit;

  if (q.status && !(TRANSACTION_STATUSES as readonly string[]).includes(q.status)) {
    throw new ValidationError(`status harus salah satu dari: ${TRANSACTION_STATUSES.join(", ")}`);
  }
  if (q.role && !["BUYER", "SELLER"].includes(q.role)) {
    throw new ValidationError("role harus BUYER atau SELLER");
  }

  const scope = sql`
    ${q.role === "BUYER"
      ? sql`and t.buyer_id = ${me.id}`
      : q.role === "SELLER"
        ? sql`and t.seller_id = ${me.id}`
        : sql`and (t.buyer_id = ${me.id} or t.seller_id = ${me.id})`}
    ${q.status ? sql`and t.status = ${q.status}` : sql``}`;

  const countRows = await sql`
    select count(*)::int as total from transactions t where true ${scope}`;
  const total = (countRows[0] as unknown as { total: number }).total;

  const rows = await sql`
    select t.id, t.listing_id, t.buyer_id, t.seller_id, t.agreed_price, t.status,
           t.created_at, t.accepted_at, t.completed_at
    from transactions t
    where true ${scope}
    order by t.created_at desc
    limit ${limit} offset ${offset}`;
  const items = rows as unknown as TransactionRow[];
  if (items.length === 0) {
    return { items: [], page, limit, total, hasNext: false };
  }

  const [participants, listings] = await Promise.all([
    participantsByIds([
      ...new Set(items.flatMap((t) => [t.buyer_id, t.seller_id])),
    ]),
    listingsByIds([...new Set(items.map((t) => t.listing_id))]),
  ]);

  return {
    items: items.map((t) => ({
      ...shape(t, me),
      buyer: participants.get(t.buyer_id) ?? null,
      seller: participants.get(t.seller_id) ?? null,
      listing: listings.get(t.listing_id) ?? null,
    })),
    page,
    limit,
    total,
    hasNext: offset + items.length < total,
  };
}

/** GET /transactions/:id */
export async function getTransaction(me: CurrentUser, id: string) {
  const t = await loadFor(me, id);
  const [participants, listings, reviewRows] = await Promise.all([
    participantsByIds([t.buyer_id, t.seller_id]),
    listingsByIds([t.listing_id]),
    sql`select id, rating, comment, created_at from reviews where transaction_id = ${t.id}`,
  ]);
  return {
    ...shape(t, me),
    buyer: participants.get(t.buyer_id) ?? null,
    seller: participants.get(t.seller_id) ?? null,
    listing: listings.get(t.listing_id) ?? null,
    review: (reviewRows[0] as unknown as Record<string, unknown>) ?? null,
  };
}

export interface UpdateStatusInput {
  status: string;
}

/**
 * PATCH /transactions/:id/status — state machine SDD §9.
 * BR-05: hanya seller yang boleh accept/reject.
 * Transisi COMPLETED juga menyetir lifecycle listing (SDD §8).
 */
export async function updateTransactionStatus(
  me: CurrentUser,
  id: string,
  input: UpdateStatusInput,
) {
  const target = input?.status;
  if (!target || !(TRANSACTION_STATUSES as readonly string[]).includes(target)) {
    throw new ValidationError(`status harus salah satu dari: ${TRANSACTION_STATUSES.join(", ")}`);
  }

  const t = await loadFor(me, id);
  const isSeller = t.seller_id === me.id;
  const isBuyer = t.buyer_id === me.id;

  const allowed = ALLOWED_TRANSITIONS[t.status] ?? [];
  if (!allowed.includes(target)) {
    throw new BusinessRuleError(
      `Transisi ${t.status} → ${target} tidak sah`,
      "INVALID_STATUS_TRANSITION",
      409,
    );
  }
  if (SELLER_ONLY.includes(target) && !isSeller) {
    throw new AuthorizationError("Hanya seller yang dapat menerima/menolak transaksi", "SELLER_ONLY");
  }
  // COMPLETED & CANCELLED terbuka untuk kedua partisipan (kesepakatan bersama).
  if (!isSeller && !isBuyer) {
    throw new AuthorizationError("Bukan partisipan transaksi ini", "NOT_TRANSACTION_PARTICIPANT");
  }

  const acceptedAt = target === "ACCEPTED" ? sql`now()` : sql`accepted_at`;
  const completedAt = target === "COMPLETED" ? sql`now()` : sql`completed_at`;

  await sql.begin(async (tx) => {
    await tx`
      update transactions set
        status = ${target},
        accepted_at = ${acceptedAt},
        completed_at = ${completedAt}
      where id = ${id}`;

    // SDD §8 lifecycle: ACCEPTED → RESERVED, COMPLETED → SOLD.
    if (target === "ACCEPTED") {
      await tx`
        update listings set status = 'RESERVED', updated_at = now()
        where id = ${t.listing_id} and status = 'ACTIVE'`;
    } else if (target === "COMPLETED") {
      await tx`
        update listings set status = 'SOLD', updated_at = now()
        where id = ${t.listing_id} and status in ('ACTIVE', 'RESERVED')`;
      // Transaksi PENDING lain untuk listing yang sama tidak bisa lanjut.
      await tx`
        update transactions set status = 'REJECTED'
        where listing_id = ${t.listing_id} and status = 'PENDING' and id <> ${id}`;
    } else if (target === "REJECTED" || target === "CANCELLED") {
      // Kembalikan listing ke ACTIVE bila tidak ada transaksi aktif lain.
      const active = await tx`
        select count(*)::int as n from transactions
        where listing_id = ${t.listing_id}
          and status in ('PENDING', 'ACCEPTED') and id <> ${id}`;
      if ((active[0] as unknown as { n: number }).n === 0) {
        await tx`
          update listings set status = 'ACTIVE', updated_at = now()
          where id = ${t.listing_id} and status = 'RESERVED'`;
      }
    }
  });

  return getTransaction(me, id);
}
