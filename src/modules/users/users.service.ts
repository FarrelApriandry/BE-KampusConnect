import { sql } from "../../db/client";
import { NotFoundError, ValidationError } from "../../shared/errors/app-error";
import type { CurrentUser } from "../../plugins/api";

const PUBLIC_COLUMNS = `id, name, email, student_id, faculty, major, academic_year,
  avatar_url, bio, role, verification_status, account_status, created_at, updated_at`;

export async function getPublicUser(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("User tidak ditemukan", "USER_NOT_FOUND");
  const rows = await sql`select ${sql.unsafe(PUBLIC_COLUMNS)} from users where id = ${id}`;
  const user = rows[0] as unknown as Record<string, unknown> | undefined;
  if (!user) throw new NotFoundError("User tidak ditemukan", "USER_NOT_FOUND");
  return user;
}

/** FR-11: indikator reputasi seller — avg rating, transaksi selesai, positive rate, status kampus. */
export async function getSellerReputation(userId: string) {
  const user = await getPublicUser(userId);
  const rows = await sql`
    select count(*)::int as completed,
           coalesce(avg(r.rating), 0)::float as avg_rating,
           coalesce(sum(case when r.rating >= 4 then 1 else 0 end), 0)::int as positive,
           coalesce(sum(case when r.rating < 3 then 1 else 0 end), 0)::int as negative
    from transactions t
    left join reviews r on r.transaction_id = t.id
    where t.seller_id = ${userId} and t.status = 'COMPLETED'`;
  const r = rows[0] as unknown as {
    completed: number;
    avg_rating: number;
    positive: number;
    negative: number;
  };
  const avg = Math.round((r.avg_rating ?? 0) * 10) / 10;
  const reviewed = r.positive + r.negative;
  return {
    userId,
    averageRating: avg,
    completedTransactions: r.completed,
    positiveReviewRate: reviewed > 0 ? Math.round((r.positive / reviewed) * 100) / 100 : 0,
    // FR-11 minimum indicators mencakup status verifikasi kampus.
    campusVerified: user.verification_status === "VERIFIED",
    accountStatus: user.account_status,
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
