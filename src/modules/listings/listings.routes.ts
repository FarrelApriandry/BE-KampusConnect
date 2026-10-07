import { Elysia, t } from "elysia";
import { apiPlugin, requireUser, verifyToken } from "../../plugins/api";
import { mapError } from "../../plugins/error-handler";
import { ok } from "../../shared/utils/respond";
import {
  archiveListing,
  createListing,
  getListingById,
  listListings,
  LISTING_CONDITIONS,
  LISTING_TYPES,
  SORTS,
  updateListing,
} from "./listings.service";

const createListingBody = t.Object({
  title: t.String({ minLength: 3, maxLength: 120 }),
  description: t.Optional(t.String({ maxLength: 4000 })),
  categoryId: t.Optional(t.Union([t.String(), t.Null()])),
  type: t.Optional(t.Union([t.Literal("PRODUCT"), t.Literal("SERVICE")])),
  price: t.Number({ minimum: 0 }),
  condition: t.Optional(t.Union([t.String(), t.Null()])),
  meetupLocation: t.Optional(t.String({ maxLength: 200 })),
  images: t.Optional(t.Array(t.String({ maxLength: 500 }), { maxItems: 8 })),
});

const updateListingBody = t.Partial(
  t.Object({
    ...createListingBody.properties,
    status: t.Union([
      t.Literal("ACTIVE"),
      t.Literal("RESERVED"),
      t.Literal("SOLD"),
      t.Literal("ARCHIVED"),
    ]),
  }),
);

const listQuery = t.Object({
  page: t.Optional(t.Numeric({ minimum: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
  search: t.Optional(t.String({ maxLength: 120 })),
  category: t.Optional(t.String()),
  type: t.Optional(t.String()),
  condition: t.Optional(t.String()),
  status: t.Optional(t.String()),
  minPrice: t.Optional(t.Numeric({ minimum: 0 })),
  maxPrice: t.Optional(t.Numeric({ minimum: 0 })),
  sort: t.Optional(t.String()),
  sellerId: t.Optional(t.String()),
});

/** GET /listings — public. Token opsional supaya `isOwner` ikut terisi bila login. */
export const listingsRoutes = new Elysia({ prefix: "/api/v1" })
  .onError(mapError)
  .use(apiPlugin)
  .get("/listings", async (ctx: any) => {
    const result = await listListings(ctx.query as any);
    // FR-06/FR-07 tidak mewajibkan isOwner di feed; biar ringan tetap tanpa itu.
    return ok(result);
  }, { query: listQuery, detail: { tags: ["Listings"] } })
  .get("/listings/:id", async (ctx: any) => {
    const viewer = await verifyToken(ctx).then((p: any) =>
      p ? requireUser(ctx).catch(() => undefined) : undefined,
    );
    return ok(await getListingById(ctx.params.id, viewer, { withReputation: true }));
  }, { detail: { tags: ["Listings"] } })
  .post("/listings", async (ctx: any) => {
    const me = await requireUser(ctx);
    // 201 Created (tugas Pertemuan 7 Tahap 8).
    ctx.set.status = 201;
    return ok(await createListing(me, ctx.body));
  }, { body: createListingBody, detail: { tags: ["Listings"] } })
  .patch("/listings/:id", async (ctx: any) => {
    const me = await requireUser(ctx);
    return ok(await updateListing(me, ctx.params.id, ctx.body));
  }, { body: updateListingBody, detail: { tags: ["Listings"] } })
  .delete("/listings/:id", async (ctx: any) => {
    const me = await requireUser(ctx);
    return ok(await archiveListing(me, ctx.params.id));
  }, { detail: { tags: ["Listings"] } });
