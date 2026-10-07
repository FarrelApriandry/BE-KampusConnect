import { sql } from "../../db/client";

export async function listCategories() {
  const rows = await sql`select id, name, type from categories order by name`;
  return rows;
}
