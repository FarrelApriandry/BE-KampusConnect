import { Elysia, t } from "elysia";
import { apiPlugin, requireUser } from "../../plugins/api";
import { mapError } from "../../plugins/error-handler";
import { ok } from "../../shared/utils/respond";
import {
  createTransaction,
  getTransaction,
  listTransactions,
  TRANSACTION_STATUSES,
  updateTransactionStatus,
} from "./transactions.service";

const createTransactionBody = t.Object({
  agreedPrice: t.Number({ minimum: 0 }),
});

const updateStatusBody = t.Object({
  status: t.Union(
    TRANSACTION_STATUSES.map((s) => t.Literal(s)) as [
      ReturnType<typeof t.Literal>,
      ...ReturnType<typeof t.Literal>[],
    ],
  ),
});

const listQuery = t.Object({
  page: t.Optional(t.Numeric({ minimum: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
  status: t.Optional(t.String()),
  role: t.Optional(t.String()),
});

/** FR-09 Transaction — state machine divalidasi backend (SDD §9). */
export const transactionsRoutes = new Elysia({ prefix: "/api/v1" })
  .onError(mapError)
  .use(apiPlugin)
  .get(
    "/transactions",
    async (ctx: any) => ok(await listTransactions(await requireUser(ctx), ctx.query)),
    { query: listQuery, detail: { tags: ["Transactions"] } },
  )
  .get(
    "/transactions/:id",
    async (ctx: any) => ok(await getTransaction(await requireUser(ctx), ctx.params.id)),
    { detail: { tags: ["Transactions"] } },
  )
  .post(
    "/listings/:id/transactions",
    async (ctx: any) =>
      ok(await createTransaction(await requireUser(ctx), ctx.params.id, ctx.body)),
    { body: createTransactionBody, detail: { tags: ["Transactions"] } },
  )
  .patch(
    "/transactions/:id/status",
    async (ctx: any) =>
      ok(await updateTransactionStatus(await requireUser(ctx), ctx.params.id, ctx.body)),
    { body: updateStatusBody, detail: { tags: ["Transactions"] } },
  );
