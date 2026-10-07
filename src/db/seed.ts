// Usage: bun src/db/seed.ts
// Applies all *.sql in database/seeds in filename order (seeds must be idempotent).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "./client";

const dir = join(import.meta.dir, "..", "..", "database", "seeds");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

if (files.length === 0) {
  console.log("No seeds found.");
  await sql.end();
  process.exit(0);
}

for (const file of files) {
  const content = await readFile(join(dir, file), "utf-8");
  console.log(`Seeding ${file}...`);
  await sql.unsafe(content);
  console.log(`Done: ${file}`);
}

await sql.end();
console.log("All seeds applied.");
