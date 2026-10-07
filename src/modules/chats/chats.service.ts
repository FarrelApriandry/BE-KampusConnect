import { sql } from "../../db/client";
import {
  AuthorizationError,
  BusinessRuleError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors/app-error";
import type { CurrentUser } from "../../plugins/api";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Batas pesan mengikuti CHECK constraint di messages.message. */
export const MAX_MESSAGE_LENGTH = 2000;

/** Status listing yang masih boleh menerima chat baru. */
const CHATTABLE_STATUSES = ["ACTIVE", "RESERVED"];

interface RoomRow {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  created_at: string;
}

function assertUuid(id: string, code = "CHAT_NOT_FOUND"): void {
  if (!UUID_RE.test(id)) throw new NotFoundError("Chat tidak ditemukan", code);
}

/** Ambil room + pastikan pemanggil adalah partisipannya (FR-08 / FR-14). */
async function loadRoomFor(me: CurrentUser, roomId: string): Promise<RoomRow> {
  assertUuid(roomId);
  const rows = await sql`
    select id, listing_id, buyer_id, seller_id, created_at
    from chat_rooms where id = ${roomId}`;
  const room = rows[0] as unknown as RoomRow | undefined;
  if (!room) throw new NotFoundError("Chat tidak ditemukan", "CHAT_NOT_FOUND");
  if (room.buyer_id !== me.id && room.seller_id !== me.id) {
    throw new AuthorizationError("Bukan partisipan chat ini", "NOT_CHAT_PARTICIPANT");
  }
  return room;
}

async function participantsByIds(ids: string[]) {
  const map = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return map;
  const rows = await sql`
    select id, name, avatar_url, faculty, major, verification_status
    from users where id in ${sql(ids)}`;
  for (const r of rows as unknown as Record<string, unknown>[]) {
    map.set(r.id as string, r);
  }
  return map;
}

async function listingsByIds(ids: string[]) {
  const map = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return map;
  const rows = await sql`
    select id, title, price, status, seller_id from listings where id in ${sql(ids)}`;
  for (const r of rows as unknown as Record<string, unknown>[]) {
    map.set(r.id as string, { ...r, price: Number(r.price) });
  }
  return map;
}

/** Pesan terakhir tiap room (DISTINCT ON menghindari N+1). */
async function lastMessagesByRoomIds(ids: string[]) {
  const map = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return map;
  const rows = await sql`
    select distinct on (room_id) room_id, id, sender_id, message, created_at
    from messages
    where room_id in ${sql(ids)}
    order by room_id, created_at desc, id desc`;
  for (const r of rows as unknown as Record<string, unknown>[]) {
    map.set(r.room_id as string, r);
  }
  return map;
}

function shapeRoom(
  room: RoomRow,
  me: CurrentUser,
  participants: Map<string, Record<string, unknown>>,
  listings: Map<string, Record<string, unknown>>,
  lasts: Map<string, Record<string, unknown>>,
) {
  const counterpartId = room.buyer_id === me.id ? room.seller_id : room.buyer_id;
  return {
    id: room.id,
    role: room.buyer_id === me.id ? "BUYER" : "SELLER",
    created_at: room.created_at,
    listing: listings.get(room.listing_id) ?? null,
    counterpart: participants.get(counterpartId) ?? null,
    lastMessage: lasts.get(room.id) ?? null,
  };
}

/**
 * POST /chats — buka (atau ambil kembali) room untuk sebuah listing.
 * Satu room per pasangan (listing, buyer) — UNIQUE constraint di schema.
 */
export async function openRoom(me: CurrentUser, listingId: string) {
  if (!UUID_RE.test(listingId)) {
    throw new NotFoundError("Listing tidak ditemukan", "LISTING_NOT_FOUND");
  }
  const rows = await sql`
    select id, seller_id, title, status from listings where id = ${listingId}`;
  const listing = rows[0] as unknown as
    | { id: string; seller_id: string; title: string; status: string }
    | undefined;
  if (!listing) throw new NotFoundError("Listing tidak ditemukan", "LISTING_NOT_FOUND");

  if (listing.seller_id === me.id) {
    throw new BusinessRuleError(
      "Tidak bisa memulai chat pada listing milik sendiri",
      "CANNOT_CHAT_SELF",
      409,
    );
  }
  if (!CHATTABLE_STATUSES.includes(listing.status)) {
    throw new BusinessRuleError(
      `Listing berstatus ${listing.status} tidak menerima chat baru`,
      "LISTING_NOT_CHATTABLE",
      409,
    );
  }

  // DO UPDATE dipakai supaya RETURNING tetap mengembalikan baris saat conflict.
  const inserted = await sql`
    insert into chat_rooms (listing_id, buyer_id, seller_id)
    values (${listingId}, ${me.id}, ${listing.seller_id})
    on conflict (listing_id, buyer_id) do update set listing_id = excluded.listing_id
    returning id`;
  const roomId = (inserted[0] as unknown as { id: string }).id;
  return getRoom(me, roomId);
}

/** GET /chats — semua room tempat user jadi buyer atau seller. */
export async function listRooms(me: CurrentUser) {
  const rows = await sql`
    select id, listing_id, buyer_id, seller_id, created_at
    from chat_rooms
    where buyer_id = ${me.id} or seller_id = ${me.id}
    order by created_at desc`;
  const rooms = rows as unknown as RoomRow[];
  if (rooms.length === 0) return { items: [], total: 0 };

  const roomIds = rooms.map((r) => r.id);
  const listingIds = [...new Set(rooms.map((r) => r.listing_id))];
  const counterpartIds = [
    ...new Set(rooms.map((r) => (r.buyer_id === me.id ? r.seller_id : r.buyer_id))),
  ];

  const [participants, listings, lasts] = await Promise.all([
    participantsByIds(counterpartIds),
    listingsByIds(listingIds),
    lastMessagesByRoomIds(roomIds),
  ]);

  return {
    items: rooms.map((r) => shapeRoom(r, me, participants, listings, lasts)),
    total: rooms.length,
  };
}

/** GET /chats/:roomId — detail room + lawan bicara. */
export async function getRoom(me: CurrentUser, roomId: string) {
  const room = await loadRoomFor(me, roomId);
  const counterpartId = room.buyer_id === me.id ? room.seller_id : room.buyer_id;
  const [participants, listings] = await Promise.all([
    participantsByIds([me.id, counterpartId]),
    listingsByIds([room.listing_id]),
  ]);
  return shapeRoom(room, me, participants, listings, new Map());
}

/** POST /chats/:roomId/messages — kirim pesan teks. */
export async function sendMessage(me: CurrentUser, roomId: string, message: string) {
  const room = await loadRoomFor(me, roomId);
  const text = (message ?? "").trim();
  if (text.length < 1) throw new ValidationError("Pesan tidak boleh kosong");
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new ValidationError(`Pesan maksimal ${MAX_MESSAGE_LENGTH} karakter`);
  }

  const rows = await sql`
    insert into messages (room_id, sender_id, message)
    values (${room.id}, ${me.id}, ${text})
    returning id, room_id, sender_id, message, created_at`;
  return rows[0];
}

/** GET /chats/:roomId/messages?page=1&limit=30 — riwayat ASC (SDD §13). */
export async function listMessages(
  me: CurrentUser,
  roomId: string,
  q: { page?: number; limit?: number } = {},
) {
  const room = await loadRoomFor(me, roomId);
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit ?? 30) || 30));
  const offset = (page - 1) * limit;

  const countRows = await sql`
    select count(*)::int as total from messages where room_id = ${room.id}`;
  const total = (countRows[0] as unknown as { total: number }).total;

  const rows = await sql`
    select id, room_id, sender_id, message, created_at
    from messages
    where room_id = ${room.id}
    order by created_at asc, id asc
    limit ${limit} offset ${offset}`;

  const items = rows as unknown as Record<string, unknown>[];
  return {
    roomId: room.id,
    items,
    page,
    limit,
    total,
    hasNext: offset + items.length < total,
  };
}
