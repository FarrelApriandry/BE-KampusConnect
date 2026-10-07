// Usage: bun src/db/migrate.ts
// Applies all *.sql (excluding *.down.sql) in database/migrations in filename order.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "./client";

const dir = join(import.meta.dir, "..", "..", "database", "migrations");
const files = (await readdir(dir))
  .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
  .sort();

if (files.length === 0) {
  console.log("No migrations found.");
  await sql.end();
  process.exit(0);
}

for (const file of files) {
  const content = await readFile(join(dir, file), "utf-8");
  console.log(`Applying ${file}...`);
  await sql.unsafe(content);
  console.log(`Done: ${file}`);
}

await sql.end();
console.log("All migrations applied.");
