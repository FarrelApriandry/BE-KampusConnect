import { Elysia, t } from "elysia";
import { apiPlugin, requireUser } from "../../plugins/api";
import { mapError } from "../../plugins/error-handler";
import { ok } from "../../shared/utils/respond";
import {
  createReview,
  getReview,
  listReviewsForUser,
  MAX_COMMENT_LENGTH,
  MAX_RATING,
  MIN_RATING,
} from "./reviews.service";

const createReviewBody = t.Object({
  rating: t.Integer({ minimum: MIN_RATING, maximum: MAX_RATING }),
  comment: t.Optional(t.String({ maxLength: MAX_COMMENT_LENGTH })),
});

const listQuery = t.Object({
  page: t.Optional(t.Numeric({ minimum: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
});

/** FR-10 Review — hanya dari transaksi COMPLETED, sekali per transaksi. */
export const reviewsRoutes = new Elysia({ prefix: "/api/v1" })
  .onError(mapError)
  .use(apiPlugin)
  .post(
    "/transactions/:id/reviews",
    async (ctx: any) => {
      ctx.set.status = 201;
      return ok(await createReview(await requireUser(ctx), ctx.params.id, ctx.body));
    },
    { body: createReviewBody, detail: { tags: ["Reviews"] } },
  )
  .get(
    "/reviews/:id",
    async (ctx: any) => ok(await getReview(ctx.params.id)),
    { detail: { tags: ["Reviews"] } },
  )
  .get(
    "/users/:id/reviews",
    async (ctx: any) => ok(await listReviewsForUser(ctx.params.id, ctx.query)),
    { query: listQuery, detail: { tags: ["Reviews"] } },
  );
