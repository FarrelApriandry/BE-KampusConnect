import { sql } from "../../db/client";
import { NotFoundError, ValidationError } from "../../shared/errors/app-error";
import type { CurrentUser } from "../../plugins/api";
import { TRUST_SCORE_MAX, TRUST_SCORE_MIN, TRUST_WEIGHTS, trustLabel } from "../../config/trust";

const PUBLIC_COLUMNS = `id, name, email, student_id, faculty, major, academic_year,
  avatar_url, bio, role, verification_status, account_status, created_at, updated_at`;

export async function getPublicUser(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("User tidak ditemukan", "USER_NOT_FOUND");
  const rows = await sql`select ${sql.unsafe(PUBLIC_COLUMNS)} from users where id = ${id}`;
  const user = rows[0] as unknown as Record<string, unknown> | undefined;
  if (!user) throw new NotFoundError("User tidak ditemukan", "USER_NOT_FOUND");
  return user;
}

/**
 * FR-11 + SDD §14: reputasi & trust score seller.
 * trustScore = verification + transaksi selesai + review positif + umur akun
 *              - penalti pembatalan - penalti moderasi  (0..100)
 */
export async function getSellerReputation(userId: string) {
  const user = await getPublicUser(userId);

  const stats = await sql`
    select
      (select count(*)::int from transactions t
         where t.seller_id = ${userId} and t.status = 'COMPLETED') as completed,
      (select count(*)::int from transactions t
         where t.seller_id = ${userId} and t.status = 'CANCELLED') as cancelled,
      (select coalesce(avg(r.rating), 0)::float from reviews r
         join transactions t on t.id = r.transaction_id
         where t.seller_id = ${userId} and t.status = 'COMPLETED') as avg_rating,
      (select count(*)::int from reviews r
         join transactions t on t.id = r.transaction_id
         where t.seller_id = ${userId} and r.rating >= 4) as positive,
      (select count(*)::int from reviews r
         join transactions t on t.id = r.transaction_id
         where t.seller_id = ${userId} and r.rating <= 2) as negative,
      (select count(*)::int from moderation_actions m
         where m.target_user_id = ${userId}
           and m.action in ('WARN', 'SUSPEND_USER')) as moderation_actions,
      (select floor(extract(epoch from (now() - u.created_at)) / 2592000)::int
         from users u where u.id = ${userId}) as account_months`;

  const s = stats[0] as unknown as {
    completed: number;
    cancelled: number;
    avg_rating: number;
    positive: number;
    negative: number;
    moderation_actions: number;
    account_months: number;
  };

  const w = TRUST_WEIGHTS;
  const verificationWeight = user.verification_status === "VERIFIED" ? w.verified : 0;
  const transactionWeight = Math.min(s.completed * w.perTransaction, w.maxTransactions);
  const reviewWeight = Math.min(s.positive * w.perReview, w.maxReviews);
  const accountAgeWeight = Math.min(Math.max(s.account_months, 0) * w.perAccountMonth, w.maxAccountAge);
  const cancellationPenalty = Math.min(s.cancelled * w.perCancellation, w.maxCancellation);
  const moderationPenalty = Math.min(
    s.moderation_actions * w.perModerationAction,
    w.maxModeration,
  );

  const raw =
    verificationWeight +
    transactionWeight +
    reviewWeight +
    accountAgeWeight -
    cancellationPenalty -
    moderationPenalty;
  const trustScore = Math.max(TRUST_SCORE_MIN, Math.min(TRUST_SCORE_MAX, raw));

  const reviewed = s.positive + s.negative;
  return {
    userId,
    // -- indikator (FR-11) --
    averageRating: Math.round((s.avg_rating ?? 0) * 10) / 10,
    completedTransactions: s.completed,
    cancelledTransactions: s.cancelled,
    positiveReviewRate: reviewed > 0 ? Math.round((s.positive / reviewed) * 100) / 100 : 0,
    campusVerified: user.verification_status === "VERIFIED",
    accountStatus: user.account_status,
    // -- trust score (SDD §14) --
    trustScore,
    trustLabel: trustLabel(trustScore),
    breakdown: {
      verificationWeight,
      transactionWeight,
      reviewWeight,
      accountAgeWeight,
      cancellationPenalty,
      moderationPenalty,
    },
  };
}

/** GET /users/:id/trust-score — hanya angka + rincian (payload ringkas). */
export async function getTrustScore(userId: string) {
  const reputation = await getSellerReputation(userId);
  return {
    userId: reputation.userId,
    trustScore: reputation.trustScore,
    trustLabel: reputation.trustLabel,
    breakdown: reputation.breakdown,
  };
}

export interface PatchMeInput {
  name?: string;
  student_id?: string | null;
  faculty?: string | null;
  major?: string | null;
  academic_year?: number | null;
  avatar_url?: string | null;
  bio?: string | null;
}

export async function patchMe(me: CurrentUser, input: PatchMeInput) {
  if (input.name !== undefined && input.name.trim().length < 2) {
    throw new ValidationError("Nama minimal 2 karakter");
  }
  const rows = await sql`
    update users set
      name = coalesce(${input.name?.trim() ?? null}, name),
      student_id = ${input.student_id === undefined ? sql`student_id` : (input.student_id ?? null)},
      faculty = ${input.faculty === undefined ? sql`faculty` : (input.faculty ?? null)},
      major = ${input.major === undefined ? sql`major` : (input.major ?? null)},
      academic_year = ${input.academic_year === undefined ? sql`academic_year` : (input.academic_year ?? null)},
      avatar_url = ${input.avatar_url === undefined ? sql`avatar_url` : (input.avatar_url ?? null)},
      bio = ${input.bio === undefined ? sql`bio` : (input.bio ?? null)},
      updated_at = now()
    where id = ${me.id}
    returning ${sql.unsafe(PUBLIC_COLUMNS)}`;
  return rows[0];
}
