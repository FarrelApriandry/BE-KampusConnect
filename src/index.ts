import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { env } from "./config/env";
import { checkDb } from "./db/client";
import { mapError } from "./plugins/error-handler";
import { authRoutes } from "./modules/auth/auth.routes";
import { usersRoutes } from "./modules/users/users.routes";
// Legacy Pertemuan-4 demo endpoint (GET /api/dramas) — kept until FE migrates.
import { dramaRoutes } from "./routes/drama.routes";

const app: any = new Elysia()
  .use(cors({ origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",") }))
  .onError(mapError)
  .get("/", () => ({ status: "ok", service: "kampusconnect-api", version: "1.0.0" }))
  .get("/health", async () => {
    const db = await checkDb();
    return { status: "ok", db };
  })
  .use(authRoutes)
  .use(usersRoutes)
  .use(dramaRoutes);

app.listen(env.PORT);

console.log(`🦊 KampusConnect API running at ${app.server?.hostname}:${app.server?.port}`);
