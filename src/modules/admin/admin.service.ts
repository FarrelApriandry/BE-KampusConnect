import { sql } from "../../db/client";
import {
  BusinessRuleError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors/app-error";
import type { CurrentUser } from "../../plugins/api";
import { REPORT_STATUSES } from "../reports/reports.service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** FR-13 — aksi admin sesuai schema moderation_actions.action. */
export const MODERATION_ACTIONS = [
  "WARN",
  "HIDE_LISTING",
  "SUSPEND_USER",
  "DISMISS",
  "OTHER",
] as const;

export const MAX_NOTE_LENGTH = 1000;

/**
 * Transisi status report yang sah (FR-13).
 * Status akhir RESOLVED/DISMISSED bisa dicapai dari OPEN maupun UNDER_REVIEW,
 * tapi tidak bisa dibalik ke OPEN.
 */
const REPORT_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["UNDER_REVIEW", "RESOLVED", "DISMISSED"],
  UNDER_REVIEW: ["RESOLVED", "DISMISSED"],
  RESOLVED: [],
  DISMISSED: [],
};

/** Aksi yang otomatis menyelesaikan laporan. */
const TERMINAL_STATUSES = ["RESOLVED", "DISMISSED"];

function assertUuid(id: string, code = "REPORT_NOT_FOUND"): void {
  if (!UUID_RE.test(id)) throw new NotFoundError("Laporan tidak ditemukan", code);
}

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

/** Catat aksi moderasi (FR-15 auditability: actor + timestamp + target). */
async function recordAction(
  tx: any,
  opts: {
    adminId: string;
    action: string;
    reportId?: string | null;
    targetUserId?: string | null;
    note?: string;
  },
) {
  await tx`
    insert into moderation_actions (admin_id, action, report_id, target_user_id, note)
    values (${opts.adminId}, ${opts.action}, ${opts.reportId ?? null},
            ${opts.targetUserId ?? null}, ${opts.note ?? ""})`;
}

async function loadReport(reportId: string): Promise<ReportRow> {
  assertUuid(reportId);
  const rows = await sql`
    select id, reporter_id, listing_id, target_user_id, reason, description,
           status, created_at, resolved_at
    from reports where id = ${reportId}`;
  const report = rows[0] as unknown as ReportRow | undefined;
  if (!report) throw new NotFoundError("Laporan tidak ditemukan", "REPORT_NOT_FOUND");
  return report;
}

/** GET /admin/reports — antrean moderasi + filter status/reason. */
export async function listReportsForAdmin(
  q: { page?: number; limit?: number; status?: string; reason?: string } = {},
) {
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const limit = Math.min(50, Math.max(1, Number(q.limit ?? 20) || 20));
  const offset = (page - 1) * limit;

  if (q.status && !(REPORT_STATUSES as readonly string[]).includes(q.status)) {
    throw new ValidationError(`status harus salah satu dari: ${REPORT_STATUSES.join(", ")}`);
  }

  const filters = sql`
    ${q.status ? sql`and r.status = ${q.status}` : sql``}
    ${q.reason ? sql`and r.reason = ${q.reason}` : sql``}`;

  const countRows = await sql`
    select count(*)::int as total from reports r where true ${filters}`;
  const total = (countRows[0] as unknown as { total: number }).total;

  const rows = await sql`
    select r.id, r.reporter_id, r.listing_id, r.target_user_id, r.reason,
           r.description, r.status, r.created_at, r.resolved_at,
           rep.name as reporter_name,
           l.title as listing_title,
           tu.name as target_user_name
    from reports r
    left join users rep on rep.id = r.reporter_id
    left join listings l on l.id = r.listing_id
    left join users tu on tu.id = r.target_user_id
    where true ${filters}
    order by r.created_at desc
    limit ${limit} offset ${offset}`;
  const items = rows as unknown as Record<string, unknown>[];

  // Ringkasan antrean supaya dashboard admin bisa menampilkan angka tanpa query terpisah.
  const summaryRows = await sql`
    select status, count(*)::int as n from reports group by status`;
  const summary: Record<string, number> = {
    OPEN: 0,
    UNDER_REVIEW: 0,
    RESOLVED: 0,
    DISMISSED: 0,
  };
  for (const s of summaryRows as unknown as { status: string; n: number }[]) {
    summary[s.status] = s.n;
  }

  return { items, page, limit, total, hasNext: offset + items.length < total, summary };
}

export interface UpdateReportStatusInput {
  status: string;
  note?: string;
}

/**
 * PATCH /admin/reports/:id/status — FR-13.
 * Transisi divalidasi; setiap perubahan dicatat ke moderation_actions.
 */
export async function updateReportStatus(
  admin: CurrentUser,
  reportId: string,
  input: UpdateReportStatusInput,
) {
  const target = input?.status;
  if (!target || !(REPORT_STATUSES as readonly string[]).includes(target)) {
    throw new ValidationError(`status harus salah satu dari: ${REPORT_STATUSES.join(", ")}`);
  }
  const note = (input?.note ?? "").trim();
  if (note.length > MAX_NOTE_LENGTH) {
    throw new ValidationError(`Catatan maksimal ${MAX_NOTE_LENGTH} karakter`);
  }

  const report = await loadReport(reportId);
  const allowed = REPORT_TRANSITIONS[report.status] ?? [];
  if (!allowed.includes(target)) {
    throw new BusinessRuleError(
      `Transisi laporan ${report.status} → ${target} tidak sah`,
      "INVALID_REPORT_TRANSITION",
      409,
    );
  }

  const action = target === "DISMISSED" ? "DISMISS" : "OTHER";
  await sql.begin(async (tx) => {
    await tx`
      update reports set
        status = ${target},
        resolved_at = ${TERMINAL_STATUSES.includes(target) ? sql`now()` : sql`resolved_at`}
      where id = ${reportId}`;
    await recordAction(tx, {
      adminId: admin.id,
      action,
      reportId,
      targetUserId: report.target_user_id,
      note: note || `Status laporan diubah ke ${target}`,
    });
  });

  return getReportForAdmin(reportId);
}

/** GET /admin/reports/:id — detail + riwayat aksi moderasi. */
export async function getReportForAdmin(reportId: string) {
  assertUuid(reportId);
  const rows = await sql`
    select r.id, r.reporter_id, r.listing_id, r.target_user_id, r.reason,
           r.description, r.status, r.created_at, r.resolved_at,
           rep.name as reporter_name,
           l.title as listing_title,
           tu.name as target_user_name
    from reports r
    left join users rep on rep.id = r.reporter_id
    left join listings l on l.id = r.listing_id
    left join users tu on tu.id = r.target_user_id
    where r.id = ${reportId}`;
  const report = rows[0] as unknown as Record<string, unknown> | undefined;
  if (!report) throw new NotFoundError("Laporan tidak ditemukan", "REPORT_NOT_FOUND");

  const actions = await sql`
    select m.id, m.action, m.note, m.created_at,
           a.name as admin_name,
           tu.name as target_user_name
    from moderation_actions m
    left join users a on a.id = m.admin_id
    left join users tu on tu.id = m.target_user_id
    where m.report_id = ${reportId}
    order by m.created_at asc`;
  return { ...report, actions };
}

/**
 * POST /admin/reports/:id/actions — aksi moderasi (FR-13).
 * BR-09: laporan tidak otomatis menghukum; admin yang memutuskan.
 */
export async function applyModerationAction(
  admin: CurrentUser,
  reportId: string,
  input: { action: string; note?: string; suspend?: boolean },
) {
  const action = input?.action;
  if (!action || !(MODERATION_ACTIONS as readonly string[]).includes(action)) {
    throw new ValidationError(`action harus salah satu dari: ${MODERATION_ACTIONS.join(", ")}`);
  }
  const note = (input?.note ?? "").trim();
  if (note.length > MAX_NOTE_LENGTH) {
    throw new ValidationError(`Catatan maksimal ${MAX_NOTE_LENGTH} karakter`);
  }

  const report = await loadReport(reportId);
  if (TERMINAL_STATUSES.includes(report.status)) {
    throw new BusinessRuleError(
      `Laporan sudah ${report.status}, tidak bisa ditindak lagi`,
      "REPORT_ALREADY_CLOSED",
      409,
    );
  }

  await sql.begin(async (tx) => {
    if (action === "HIDE_LISTING") {
      if (!report.listing_id) {
        throw new BusinessRuleError("Laporan ini tidak menargetkan listing", "NO_LISTING_TARGET", 409);
      }
      // Soft-hide: ARCHIVED, riwayat transaksi tetap utuh.
      await tx`
        update listings set status = 'ARCHIVED', updated_at = now()
        where id = ${report.listing_id}`;
    } else if (action === "SUSPEND_USER") {
      const targetUserId = report.target_user_id ?? (await sellerOf(tx, report.listing_id));
      if (!targetUserId) {
        throw new BusinessRuleError("Laporan ini tidak menargetkan akun", "NO_USER_TARGET", 409);
      }
      if (targetUserId === admin.id) {
        throw new BusinessRuleError("Tidak bisa menangguhkan akun sendiri", "CANNOT_SUSPEND_SELF", 409);
      }
      await tx`
        update users set account_status = 'SUSPENDED', updated_at = now()
        where id = ${targetUserId}`;
    }

    await recordAction(tx, {
      adminId: admin.id,
      action,
      reportId,
      targetUserId: report.target_user_id,
      note,
    });

    // Aksi selain WARN/OTHER dianggap menyelesaikan laporan.
    if (["HIDE_LISTING", "SUSPEND_USER", "DISMISS"].includes(action)) {
      const next = action === "DISMISS" ? "DISMISSED" : "RESOLVED";
      await tx`
        update reports set status = ${next}, resolved_at = now() where id = ${reportId}`;
    } else if (report.status === "OPEN") {
      // WARN/OTHER memindahkan laporan ke UNDER_REVIEW.
      await tx`
        update reports set status = 'UNDER_REVIEW' where id = ${reportId}`;
    }
  });

  return getReportForAdmin(reportId);
}

async function sellerOf(tx: any, listingId: string | null): Promise<string | null> {
  if (!listingId) return null;
  const rows = await tx`select seller_id from listings where id = ${listingId}`;
  return (rows[0] as unknown as { seller_id: string } | undefined)?.seller_id ?? null;
}

/** POST /admin/users/:id/warn — teguran tanpa laporan. */
export async function warnUser(admin: CurrentUser, userId: string, note: string) {
  assertUuid(userId, "USER_NOT_FOUND");
  const rows = await sql`select id from users where id = ${userId}`;
  if (rows.length === 0) throw new NotFoundError("User tidak ditemukan", "USER_NOT_FOUND");
  if (userId === admin.id) {
    throw new BusinessRuleError("Tidak bisa menegur diri sendiri", "CANNOT_WARN_SELF", 409);
  }
  const trimmed = (note ?? "").trim();
  if (trimmed.length > MAX_NOTE_LENGTH) {
    throw new ValidationError(`Catatan maksimal ${MAX_NOTE_LENGTH} karakter`);
  }
  const inserted = await sql`
    insert into moderation_actions (admin_id, action, target_user_id, note)
    values (${admin.id}, 'WARN', ${userId}, ${trimmed})
    returning id, admin_id, target_user_id, action, note, created_at`;
  return inserted[0];
}

/** PATCH /admin/users/:id/status — suspend / aktifkan kembali akun (BR-10). */
export async function setUserAccountStatus(
  admin: CurrentUser,
  userId: string,
  status: string,
  note = "",
) {
  if (!["ACTIVE", "SUSPENDED"].includes(status)) {
    throw new ValidationError("status harus ACTIVE atau SUSPENDED");
  }
  assertUuid(userId, "USER_NOT_FOUND");
  const rows = await sql`select id, account_status, role from users where id = ${userId}`;
  const user = rows[0] as unknown as
    | { id: string; account_status: string; role: string }
    | undefined;
  if (!user) throw new NotFoundError("User tidak ditemukan", "USER_NOT_FOUND");
  if (userId === admin.id) {
    throw new BusinessRuleError("Tidak bisa mengubah status akun sendiri", "CANNOT_MODIFY_SELF", 409);
  }
  if (user.account_status === status) {
    throw new BusinessRuleError(`Akun sudah berstatus ${status}`, "STATUS_UNCHANGED", 409);
  }
  // Cegah admin menangguhkan sesama admin.
  if (status === "SUSPENDED" && user.role === "ADMIN") {
    throw new BusinessRuleError("Tidak bisa menangguhkan akun admin lain", "CANNOT_SUSPEND_ADMIN", 409);
  }

  await sql.begin(async (tx) => {
    await tx`
      update users set account_status = ${status}, updated_at = now()
      where id = ${userId}`;
    await recordAction(tx, {
      adminId: admin.id,
      action: status === "SUSPENDED" ? "SUSPEND_USER" : "OTHER",
      targetUserId: userId,
      note: (note ?? "").trim() || `Status akun diubah ke ${status}`,
    });
  });

  const updated = await sql`
    select id, name, email, role, verification_status, account_status
    from users where id = ${userId}`;
  return updated[0];
}

/** GET /admin/actions — riwayat aksi moderasi (FR-15). */
export async function listModerationActions(
  q: { page?: number; limit?: number; targetUserId?: string } = {},
) {
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const limit = Math.min(50, Math.max(1, Number(q.limit ?? 20) || 20));
  const offset = (page - 1) * limit;

  const filters = sql`
    ${q.targetUserId ? sql`and m.target_user_id = ${q.targetUserId}` : sql``}`;

  const countRows = await sql`
    select count(*)::int as total from moderation_actions m where true ${filters}`;
  const total = (countRows[0] as unknown as { total: number }).total;

  const rows = await sql`
    select m.id, m.admin_id, m.target_user_id, m.report_id, m.action, m.note, m.created_at,
           a.name as admin_name, tu.name as target_user_name
    from moderation_actions m
    left join users a on a.id = m.admin_id
    left join users tu on tu.id = m.target_user_id
    where true ${filters}
    order by m.created_at desc
    limit ${limit} offset ${offset}`;
  const items = rows as unknown as Record<string, unknown>[];

  return { items, page, limit, total, hasNext: offset + items.length < total };
}
