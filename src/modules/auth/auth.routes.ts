import { Elysia, t } from "elysia";
import { apiPlugin, requireUser } from "../../plugins/api";
import { mapError } from "../../plugins/error-handler";
import { ok } from "../../shared/utils/respond";
import { rateLimit } from "../../shared/utils/rate-limit";
import { login, register, verifyCampus } from "./auth.service";

const registerBody = t.Object({
  name: t.String({ minLength: 2, maxLength: 100 }),
  email: t.String({ format: "email", maxLength: 160 }),
  password: t.String({ minLength: 6, maxLength: 128 }),
  student_id: t.Optional(t.String({ maxLength: 40 })),
  faculty: t.Optional(t.String({ maxLength: 100 })),
  major: t.Optional(t.String({ maxLength: 100 })),
  academic_year: t.Optional(t.Number({ minimum: 2000, maximum: 2100 })),
});

const loginBody = t.Object({
  email: t.String({ format: "email", maxLength: 160 }),
  password: t.String({ minLength: 1, maxLength: 128 }),
  mode: t.Optional(t.Union([t.Literal("USER"), t.Literal("ADMIN")])),
});

export const authRoutes = new Elysia({ prefix: "/api/v1/auth" })
  .onError(mapError)
  .use(apiPlugin)
  .use(rateLimit({ windowMs: 60_000, max: 30 }))
  .post("/register", async (ctx: any) => {
    const result = await register(ctx.body, (payload) => (ctx.jwt as any).sign(payload));
    return ok(result);
  }, { body: registerBody, detail: { tags: ["Auth"] } })
  .post("/login", async (ctx: any) => {
    const result = await login(ctx.body, (payload) => (ctx.jwt as any).sign(payload));
    return ok(result);
  }, { body: loginBody, detail: { tags: ["Auth"] } })
  .post("/verify", async (ctx: any) => {
    const me = await requireUser(ctx);
    const user = await verifyCampus(me.id);
    return ok({ user });
  }, { detail: { tags: ["Auth"] } })
  .post("/refresh", async (ctx: any) => {
    const me = await requireUser(ctx);
    const token = await (ctx.jwt as any).sign({ sub: me.id, role: me.role });
    return ok({ token });
  }, { detail: { tags: ["Auth"] } })
  .post("/logout", async () => ok({ loggedOut: true }), {
    detail: { tags: ["Auth"] },
  });
