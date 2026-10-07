import { sql } from "../src/db/client";

// Bersihkan SELURUH data uji, sisakan admin + 10 kategori seed.
await sql`delete from reviews`;
await sql`delete from messages`;
await sql`delete from chat_rooms`;
await sql`delete from transactions`;
await sql`delete from listing_images`;
await sql`delete from listings`;
await sql`delete from reports`;
await sql`delete from moderation_actions`;
await sql`delete from users where email <> 'admin@untidar.ac.id'`;

const u = await sql`select email, role, verification_status from users order by email`;
const c = await sql`select count(*)::int as n from categories`;
const counts = await sql`
  select
    (select count(*)::int from listings) as listings,
    (select count(*)::int from transactions) as transactions,
    (select count(*)::int from reviews) as reviews,
    (select count(*)::int from chat_rooms) as chat_rooms,
    (select count(*)::int from messages) as messages`;

console.log("USERS:", JSON.stringify(u));
console.log("CATEGORIES:", c[0].n, "| sisa data uji:", JSON.stringify(counts[0]));
process.exit(0);
