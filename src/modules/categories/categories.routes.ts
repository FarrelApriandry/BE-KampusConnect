import { Elysia } from "elysia";
import { apiPlugin } from "../../plugins/api";
import { mapError } from "../../plugins/error-handler";
import { ok } from "../../shared/utils/respond";
import { listCategories } from "./categories.service";

export const categoriesRoutes = new Elysia({ prefix: "/api/v1" })
  .onError(mapError)
  .use(apiPlugin)
  .get("/categories", async () => ok({ items: await listCategories() }), {
    detail: { tags: ["Categories"] },
  });
