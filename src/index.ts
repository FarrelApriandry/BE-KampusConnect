import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { dramaRoutes } from "./routes/drama.routes";

const port = Number(process.env.PORT ?? 3000);

const app = new Elysia()
  .use(cors())
  .get("/", () => ({ status: "ok", message: "Hello Elysia" }))
  .use(dramaRoutes)
  .listen(port);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
