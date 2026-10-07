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

/** FR-12 — alasan minimum sesuai schema reports.reason. */
export const REPORT_REASONS = [
  "SCAM",
  "MISLEADING",
  "PROHIBITED_ITEM",
  "SPAM",
  "HARASSMENT",
  "OTHER",
] as const;

/** FR-13 — status minimum sesuai schema reports.status. */
export const REPORT_STATUSES = ["OPEN", "UNDER_REVIEW", "RESOLVED", "DISMISSED"] as const;

export const MAX_DESCRIPTION_LENGTH = 2000;

interface ReportRow {
  id: string;
  reporter_id: string;
  listing_id: string | null;
  target_user_id: string | null;
  reason: string;
  description: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

function assertUuid(id: string, code = "REPORT_NOT_FOUND"): void {
  if (!UUID_RE.test(id)) throw new NotFoundError("Laporan tidak ditemukan", code);
}

function shape(r: ReportRow) {
  return { ...r };
}

/** Laporan bisa menyasar listing, akun, atau keduanya — minimal salah satu. */
export interface CreateReportInput {
  listingId?: string | null;
  targetUserId?: string | null;
  reason: string;
  description?: string;
}

/**
 * POST /reports — FR-12.
 * BR-09: listing yang dilaporkan TIDAK otomatis dianggap bersalah;
 * laporan hanya masuk antrean moderasi berstatus OPEN.
 */
export async function createReport(me: CurrentUser, input: CreateReportInput) {
  requireVerified(me);

  const reason = input?.reason;
  if (!reason || !(REPORT_REASONS as readonly string[]).includes(reason)) {
    throw new ValidationError(`reason harus salah satu dari: ${REPORT_REASONS.join(", ")}`);
  }
  const description = (input?.description ?? "").trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new ValidationError(`Deskripsi maksimal ${MAX_DESCRIPTION_LENGTH} karakter`);
  }

  const listingId = input?.listingId ?? null;
  const targetUserId = input?.targetUserId ?? null;
  if (!listingId && !targetUserId) {
    throw new ValidationError("Laporan harus menyertakan listingId atau targetUserId");
  }
  if (listingId && !UUID_RE.test(listingId)) {
    throw new ValidationError("listingId harus berupa UUID");
  }
  if (targetUserId && !UUID_RE.test(targetUserId)) {
    throw new ValidationError("targetUserId harus berupa UUID");
  }

  if (listingId) {
    const rows = await sql`select id, seller_id from listings where id = ${listingId}`;
    const listing = rows[0] as unknown as { id: string; seller_id: string } | undefined;
    if (!listing) throw new NotFoundError("Listing tidak ditemukan", "LISTING_NOT_FOUND");
    if (listing.seller_id === me.id) {
      throw new BusinessRuleError("Tidak bisa melaporkan listing milik sendiri", "CANNOT_REPORT_SELF", 409);
    }
  }
  if (targetUserId) {
    if (targetUserId === me.id) {
      throw new BusinessRuleError("Tidak bisa melaporkan diri sendiri", "CANNOT_REPORT_SELF", 409);
    }
    const rows = await sql`select id from users where id = ${targetUserId}`;
    if (rows.length === 0) throw new NotFoundError("User tidak ditemukan", "USER_NOT_FOUND");
  }

  const inserted = await sql`
    insert into reports (reporter_id, listing_id, target_user_id, reason, description)
    values (${me.id}, ${listingId}, ${targetUserId}, ${reason}, ${description})
    returning id, reporter_id, listing_id, target_user_id, reason, description,
              status, created_at, resolved_at`;
  return inserted[0];
}

/** GET /reports — laporan yang dibuat user sendiri. */
export async function listMyReports(
  me: CurrentUser,
  q: { page?: number; limit?: number; status?: string } = {},
) {
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const limit = Math.min(50, Math.max(1, Number(q.limit ?? 20) || 20));
  const offset = (page - 1) * limit;

  if (q.status && !(REPORT_STATUSES as readonly string[]).includes(q.status)) {
    throw new ValidationError(`status harus salah satu dari: ${REPORT_STATUSES.join(", ")}`);
  }

  const filters = sql`
    and r.reporter_id = ${me.id}
    ${q.status ? sql`and r.status = ${q.status}` : sql``}`;

  const countRows = await sql`
    select count(*)::int as total from reports r where true ${filters}`;
  const total = (countRows[0] as unknown as { total: number }).total;

  const rows = await sql`
    select r.id, r.reporter_id, r.listing_id, r.target_user_id, r.reason,
           r.description, r.status, r.created_at, r.resolved_at
    from reports r
    where true ${filters}
    order by r.created_at desc
    limit ${limit} offset ${offset}`;
  const items = rows as unknown as ReportRow[];

  return { items: items.map(shape), page, limit, total, hasNext: offset + items.length < total };
}

/** GET /reports/:id — hanya pelapor atau admin. */
export async function getReport(me: CurrentUser, id: string) {
  assertUuid(id);
  const rows = await sql`
    select id, reporter_id, listing_id, target_user_id, reason, description,
           status, created_at, resolved_at
    from reports where id = ${id}`;
  const report = rows[0] as unknown as ReportRow | undefined;
  if (!report) throw new NotFoundError("Laporan tidak ditemukan", "REPORT_NOT_FOUND");
  if (report.reporter_id !== me.id && me.role !== "ADMIN") {
    throw new AuthorizationError("Bukan laporan milik kamu", "NOT_REPORT_OWNER");
  }
  return shape(report);
}
