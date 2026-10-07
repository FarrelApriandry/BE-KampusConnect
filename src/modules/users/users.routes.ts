import { Elysia, t } from "elysia";
import { apiPlugin, requireUser } from "../../plugins/api";
import { mapError } from "../../plugins/error-handler";
import { ok } from "../../shared/utils/respond";
import { getPublicUser, getSellerReputation, patchMe } from "./users.service";

const patchMeBody = t.Object({
  name: t.Optional(t.String({ minLength: 2, maxLength: 100 })),
  student_id: t.Optional(t.Union([t.String({ maxLength: 40 }), t.Null()])),
  faculty: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
  major: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
  academic_year: t.Optional(t.Union([t.Number({ minimum: 2000, maximum: 2100 }), t.Null()])),
  avatar_url: t.Optional(t.Union([t.String({ maxLength: 500 }), t.Null()])),
  bio: t.Optional(t.Union([t.String({ maxLength: 500 }), t.Null()])),
});

export const usersRoutes = new Elysia({ prefix: "/api/v1" })
  .onError(mapError)
  .use(apiPlugin)
  .get("/me", async (ctx: any) => ok(await requireUser(ctx)), {
    detail: { tags: ["Users"] },
  })
  .patch("/me", async (ctx: any) => {
    const me = await requireUser(ctx);
    return ok(await patchMe(me, ctx.body));
  }, { body: patchMeBody, detail: { tags: ["Users"] } })
  .get("/users/:id", async ({ params }: any) => ok(await getPublicUser(params.id)), {
    detail: { tags: ["Users"] },
  })
  .get("/users/:id/reviews", async ({ params }: any) => {
    // Placeholder Sprint 1: review list penuh mendarat di Sprint 3.
    await getPublicUser(params.id);
    return ok({ items: [], total: 0 });
  }, { detail: { tags: ["Users"] } });
