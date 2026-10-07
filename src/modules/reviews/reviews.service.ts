import { sql } from "../../db/client";
import {
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors/app-error";
import type { CurrentUser } from "../../plugins/api";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MIN_RATING = 1;
export const MAX_RATING = 5;
export const MAX_COMMENT_LENGTH = 2000;

function assertUuid(id: string, code = "TRANSACTION_NOT_FOUND"): void {
  if (!UUID_RE.test(id)) throw new NotFoundError("Transaksi tidak ditemukan", code);
}

/**
 * POST /transactions/:id/reviews — FR-10.
 * BR-06: review hanya dari transaksi COMPLETED.
 * BR-07: satu transaksi hanya boleh punya satu review (UNIQUE di schema).
 */
export async function createReview(
  me: CurrentUser,
  transactionId: string,
  input: { rating?: number; comment?: string },
) {
  assertUuid(transactionId);

  const rating = Number(input?.rating);
  if (!Number.isInteger(rating) || rating < MIN_RATING || rating > MAX_RATING) {
    throw new ValidationError(`rating harus bilangan bulat ${MIN_RATING}-${MAX_RATING}`);
  }
  const comment = (input?.comment ?? "").trim();
  if (comment.length > MAX_COMMENT_LENGTH) {
    throw new ValidationError(`Komentar maksimal ${MAX_COMMENT_LENGTH} karakter`);
  }

  const rows = await sql`
    select id, buyer_id, seller_id, status from transactions where id = ${transactionId}`;
  const t = rows[0] as unknown as
    | { id: string; buyer_id: string; seller_id: string; status: string }
    | undefined;
  if (!t) throw new NotFoundError("Transaksi tidak ditemukan", "TRANSACTION_NOT_FOUND");

  // BR-06.
  if (t.status !== "COMPLETED") {
    throw new BusinessRuleError(
      `Review hanya untuk transaksi COMPLETED (sekarang ${t.status})`,
      "TRANSACTION_NOT_COMPLETED",
      409,
    );
  }
  // Hanya buyer yang mereview seller (FR-10).
  if (t.buyer_id !== me.id) {
    throw new AuthorizationError("Hanya buyer yang dapat memberi review", "REVIEWER_NOT_BUYER");
  }
  // BR-07 — cek eksplisit supaya pesannya jelas (UNIQUE tetap jadi jaring terakhir).
  const existing = await sql`
    select id from reviews where transaction_id = ${transactionId} and reviewer_id = ${me.id}`;
  if (existing.length > 0) {
    throw new ConflictError("Transaksi ini sudah kamu review", "REVIEW_ALREADY_EXISTS");
  }

  const inserted = await sql`
    insert into reviews (transaction_id, reviewer_id, reviewee_id, rating, comment)
    values (${transactionId}, ${me.id}, ${t.seller_id}, ${rating}, ${comment})
    returning id, transaction_id, reviewer_id, reviewee_id, rating, comment, created_at`;
  return inserted[0];
}

/** GET /users/:id/reviews — daftar review yang diterima user (FR-10/FR-11). */
export async function listReviewsForUser(
  userId: string,
  q: { page?: number; limit?: number } = {},
) {
  if (!UUID_RE.test(userId)) {
    throw new NotFoundError("User tidak ditemukan", "USER_NOT_FOUND");
  }
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const limit = Math.min(50, Math.max(1, Number(q.limit ?? 20) || 20));
  const offset = (page - 1) * limit;

  const countRows = await sql`
    select count(*)::int as total,
           coalesce(avg(rating), 0)::float as avg_rating
    from reviews where reviewee_id = ${userId}`;
  const agg = countRows[0] as unknown as { total: number; avg_rating: number };
  const total = agg.total;

  const rows = await sql`
    select r.id, r.transaction_id, r.rating, r.comment, r.created_at,
           u.id as reviewer_id, u.name as reviewer_name, u.avatar_url as reviewer_avatar_url
    from reviews r
    join users u on u.id = r.reviewer_id
    where r.reviewee_id = ${userId}
    order by r.created_at desc
    limit ${limit} offset ${offset}`;
  const items = rows as unknown as Record<string, unknown>[];

  return {
    items,
    page,
    limit,
    total,
    hasNext: offset + items.length < total,
    // Rata-rata dihitung dari SELURUH review, bukan hanya halaman ini.
    averageRating: Math.round((agg.avg_rating ?? 0) * 10) / 10,
  };
}

/** GET /reviews/:id */
export async function getReview(id: string) {
  if (!UUID_RE.test(id)) throw new NotFoundError("Review tidak ditemukan", "REVIEW_NOT_FOUND");
  const rows = await sql`
    select r.id, r.transaction_id, r.reviewer_id, r.reviewee_id, r.rating,
           r.comment, r.created_at,
           b.name as buyer_name, s.name as seller_name
    from reviews r
    join users b on b.id = r.reviewer_id
    join users s on s.id = r.reviewee_id
    where r.id = ${id}`;
  const review = rows[0] as unknown as Record<string, unknown> | undefined;
  if (!review) throw new NotFoundError("Review tidak ditemukan", "REVIEW_NOT_FOUND");
  return review;
}
