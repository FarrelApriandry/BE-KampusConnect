import { Elysia, t } from "elysia";
import { apiPlugin, requireUser } from "../../plugins/api";
import { mapError } from "../../plugins/error-handler";
import { ok } from "../../shared/utils/respond";
import { rateLimit } from "../../shared/utils/rate-limit";
import {
  createReport,
  getReport,
  listMyReports,
  MAX_DESCRIPTION_LENGTH,
  REPORT_REASONS,
} from "./reports.service";

const createReportBody = t.Object({
  listingId: t.Optional(t.Union([t.String(), t.Null()])),
  targetUserId: t.Optional(t.Union([t.String(), t.Null()])),
  reason: t.Union(REPORT_REASONS.map((r) => t.Literal(r)) as [ReturnType<typeof t.Literal>, ...ReturnType<typeof t.Literal>[]]),
  description: t.Optional(t.String({ maxLength: MAX_DESCRIPTION_LENGTH })),
});

const listQuery = t.Object({
  page: t.Optional(t.Numeric({ minimum: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
  status: t.Optional(t.String()),
});

/** FR-12 Report — pelaporan listing/akun oleh pengguna. */
export const reportsRoutes = new Elysia({ prefix: "/api/v1" })
  .onError(mapError)
  .use(apiPlugin)
  .get("/reports", async (ctx: any) => ok(await listMyReports(await requireUser(ctx), ctx.query)), {
    query: listQuery,
    detail: { tags: ["Reports"] },
  })
  .get("/reports/:id", async (ctx: any) => ok(await getReport(await requireUser(ctx), ctx.params.id)), {
    detail: { tags: ["Reports"] },
  })
  .use(rateLimit({ windowMs: 60_000, max: 30 }))
  .post("/reports", async (ctx: any) => {
    // 201 Created — pembuatan resource (tugas Pertemuan 7 Tahap 8).
    ctx.set.status = 201;
    return ok(await createReport(await requireUser(ctx), ctx.body));
  }, {
    body: createReportBody,
    detail: { tags: ["Reports"] },
  });
