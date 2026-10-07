import { Elysia, t } from "elysia";
import { apiPlugin, requireAdmin } from "../../plugins/api";
import { mapError } from "../../plugins/error-handler";
import { ok } from "../../shared/utils/respond";
import { REPORT_STATUSES } from "../reports/reports.service";
import {
  applyModerationAction,
  getReportForAdmin,
  listModerationActions,
  listReportsForAdmin,
  MAX_NOTE_LENGTH,
  MODERATION_ACTIONS,
  setUserAccountStatus,
  updateReportStatus,
  warnUser,
} from "./admin.service";

const listQuery = t.Object({
  page: t.Optional(t.Numeric({ minimum: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
  status: t.Optional(t.String()),
  reason: t.Optional(t.String()),
});

const actionsQuery = t.Object({
  page: t.Optional(t.Numeric({ minimum: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
  targetUserId: t.Optional(t.String()),
});

const updateStatusBody = t.Object({
  status: t.Union(
    REPORT_STATUSES.map((s) => t.Literal(s)) as [
      ReturnType<typeof t.Literal>,
      ...ReturnType<typeof t.Literal>[],
    ],
  ),
  note: t.Optional(t.String({ maxLength: MAX_NOTE_LENGTH })),
});

const actionBody = t.Object({
  action: t.Union(
    MODERATION_ACTIONS.map((a) => t.Literal(a)) as [
      ReturnType<typeof t.Literal>,
      ...ReturnType<typeof t.Literal>[],
    ],
  ),
  note: t.Optional(t.String({ maxLength: MAX_NOTE_LENGTH })),
});

const warnBody = t.Object({
  note: t.Optional(t.String({ maxLength: MAX_NOTE_LENGTH })),
});

const accountStatusBody = t.Object({
  status: t.Union([t.Literal("ACTIVE"), t.Literal("SUSPENDED")]),
  note: t.Optional(t.String({ maxLength: MAX_NOTE_LENGTH })),
});

/**
 * FR-13 Moderation — seluruh route butuh role ADMIN.
 * requireAdmin sudah melempar 403 ADMIN_ONLY untuk user biasa.
 */
export const adminRoutes = new Elysia({ prefix: "/api/v1/admin" })
  .onError(mapError)
  .use(apiPlugin)
  .get(
    "/reports",
    async (ctx: any) => {
      await requireAdmin(ctx);
      return ok(await listReportsForAdmin(ctx.query));
    },
    { query: listQuery, detail: { tags: ["Admin"] } },
  )
  .get(
    "/reports/:id",
    async (ctx: any) => {
      await requireAdmin(ctx);
      return ok(await getReportForAdmin(ctx.params.id));
    },
    { detail: { tags: ["Admin"] } },
  )
  .patch(
    "/reports/:id/status",
    async (ctx: any) =>
      ok(await updateReportStatus(await requireAdmin(ctx), ctx.params.id, ctx.body)),
    { body: updateStatusBody, detail: { tags: ["Admin"] } },
  )
  .post(
    "/reports/:id/actions",
    async (ctx: any) =>
      ok(await applyModerationAction(await requireAdmin(ctx), ctx.params.id, ctx.body)),
    { body: actionBody, detail: { tags: ["Admin"] } },
  )
  .get(
    "/actions",
    async (ctx: any) => {
      await requireAdmin(ctx);
      return ok(await listModerationActions(ctx.query));
    },
    { query: actionsQuery, detail: { tags: ["Admin"] } },
  )
  .post(
    "/users/:id/warn",
    async (ctx: any) =>
      ok(await warnUser(await requireAdmin(ctx), ctx.params.id, ctx.body?.note ?? "")),
    { body: warnBody, detail: { tags: ["Admin"] } },
  )
  .patch(
    "/users/:id/status",
    async (ctx: any) =>
      ok(
        await setUserAccountStatus(
          await requireAdmin(ctx),
          ctx.params.id,
          ctx.body.status,
          ctx.body.note ?? "",
        ),
      ),
    { body: accountStatusBody, detail: { tags: ["Admin"] } },
  );
