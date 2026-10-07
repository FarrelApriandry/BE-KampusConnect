import { Elysia, t } from "elysia";
import { apiPlugin, requireUser } from "../../plugins/api";
import { mapError } from "../../plugins/error-handler";
import { ok } from "../../shared/utils/respond";
import { rateLimit } from "../../shared/utils/rate-limit";
import {
  getRoom,
  listMessages,
  listRooms,
  MAX_MESSAGE_LENGTH,
  openRoom,
  sendMessage,
} from "./chats.service";

const openRoomBody = t.Object({ listingId: t.String() });

const sendMessageBody = t.Object({
  message: t.String({ minLength: 1, maxLength: MAX_MESSAGE_LENGTH }),
});

const historyQuery = t.Object({
  page: t.Optional(t.Numeric({ minimum: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
});

/**
 * FR-08 Chat — REST based (SDD §13, WebSocket ditunda ke Phase 3).
 * Rate limit dipasang di endpoint kirim pesan (SDD §15).
 */
export const chatsRoutes = new Elysia({ prefix: "/api/v1" })
  .onError(mapError)
  .use(apiPlugin)
  .get("/chats", async (ctx: any) => ok(await listRooms(await requireUser(ctx))), {
    detail: { tags: ["Chats"] },
  })
  .post(
    "/chats",
    async (ctx: any) => ok(await openRoom(await requireUser(ctx), ctx.body.listingId)),
    { body: openRoomBody, detail: { tags: ["Chats"] } },
  )
  .get(
    "/chats/:roomId",
    async (ctx: any) => ok(await getRoom(await requireUser(ctx), ctx.params.roomId)),
    { detail: { tags: ["Chats"] } },
  )
  .get(
    "/chats/:roomId/messages",
    async (ctx: any) =>
      ok(await listMessages(await requireUser(ctx), ctx.params.roomId, ctx.query)),
    { query: historyQuery, detail: { tags: ["Chats"] } },
  )
  .use(rateLimit({ windowMs: 60_000, max: 120 }))
  .post(
    "/chats/:roomId/messages",
    async (ctx: any) =>
      ok(await sendMessage(await requireUser(ctx), ctx.params.roomId, ctx.body.message)),
    { body: sendMessageBody, detail: { tags: ["Chats"] } },
  );
