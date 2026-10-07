import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { env } from "./config/env";
import { checkDb } from "./db/client";
import { mapError } from "./plugins/error-handler";
import { authRoutes } from "./modules/auth/auth.routes";
import { usersRoutes } from "./modules/users/users.routes";
import { categoriesRoutes } from "./modules/categories/categories.routes";
import { listingsRoutes } from "./modules/listings/listings.routes";
import { chatsRoutes } from "./modules/chats/chats.routes";
import { transactionsRoutes } from "./modules/transactions/transactions.routes";
import { reviewsRoutes } from "./modules/reviews/reviews.routes";
import { reportsRoutes } from "./modules/reports/reports.routes";
import { adminRoutes } from "./modules/admin/admin.routes";
// Legacy Pertemuan-4 demo endpoint (GET /api/dramas) — kept until FE migrates.
import { dramaRoutes } from "./routes/drama.routes";

const app: any = new Elysia()
  .use(cors({ origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",") }))
  .use(
    swagger({
      path: "/docs",
      documentation: {
        info: {
          title: "KampusConnect API",
          version: "1.0.0",
          description:
            "Campus-exclusive marketplace — ElysiaJS + Bun + Neon PostgreSQL. " +
            "Semua response memakai envelope SRS §12: { success, data, requestId }.",
        },
        tags: [
          { name: "Auth", description: "FR-01/FR-02 registrasi & login (email kampus)" },
          { name: "Users", description: "FR-03 profil, FR-11 reputasi & trust score" },
          { name: "Listings", description: "FR-04..FR-07 listing, search, detail" },
          { name: "Chats", description: "FR-08 chat per listing" },
          { name: "Transactions", description: "FR-09 transaksi + state machine" },
          { name: "Reviews", description: "FR-10 review setelah transaksi selesai" },
          { name: "Reports", description: "FR-12 pelaporan listing/akun" },
          { name: "Admin", description: "FR-13 moderasi (butuh role ADMIN)" },
        ],
      },
    }),
  )
  .onError(mapError)
  .get("/", () => ({ status: "ok", service: "kampusconnect-api", version: "1.0.0" }))
  .get("/health", async () => {
    const db = await checkDb();
    return { status: "ok", db };
  })
  .use(authRoutes)
  .use(usersRoutes)
  .use(categoriesRoutes)
  .use(listingsRoutes)
  .use(chatsRoutes)
  .use(transactionsRoutes)
  .use(reviewsRoutes)
  .use(reportsRoutes)
  .use(adminRoutes)
  .use(dramaRoutes);

// Vercel tidak mendukung app.listen(); ia membaca instance Elysia lewat default
// export ini dan merutekan request ke Vercel Function. Jangan hapus export-nya.
export default app;

// Di luar Vercel (bun run dev / bun src/index.ts) tetap butuh server yang listen.
// Vercel men-set env VERCEL=1, jadi blok ini otomatis dilewati saat deployed.
if (!process.env.VERCEL) {
  app.listen(env.PORT);
  console.log(`🦊 KampusConnect API running at http://localhost:${env.PORT}`);
  console.log(`📚 API docs: http://localhost:${env.PORT}/docs`);
}
