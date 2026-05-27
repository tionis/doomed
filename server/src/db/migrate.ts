import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

await pool.query(`
  create table if not exists schema_migrations (
    name text primary key,
    applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )
`);

const migrations = ["001_initial.sql"];

for (const migration of migrations) {
  const applied = await pool.query("select 1 from schema_migrations where name = $1", [
    migration,
  ]);
  if (applied.rowCount) continue;
  const sql = await readFile(join(root, "db", "migrations", migration), "utf8");
  await pool.exec(sql);
  await pool.query("insert into schema_migrations(name) values ($1)", [migration]);
  console.log(`applied ${migration}`);
}

await pool.end();
