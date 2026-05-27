import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { getConfig } from "../config.js";

export type QueryResult = {
  rows: Record<string, unknown>[];
  rowCount: number | null;
};

export type DbClient = {
  query: (sql: string, params?: unknown[]) => Promise<QueryResult>;
  exec: (sql: string) => Promise<void>;
  end: () => Promise<void>;
};

const sqlitePath = resolve(process.cwd(), getConfig().sqlitePath);
mkdirSync(dirname(sqlitePath), { recursive: true });

const db = new Database(sqlitePath, { create: true });
db.exec("pragma foreign_keys = on");
db.exec("pragma journal_mode = wal");
db.exec("pragma busy_timeout = 5000");

const nowExpression = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export const pool: DbClient = {
  async query(sql: string, params: unknown[] = []) {
    const { sql: normalizedSql, params: normalizedParams } = normalizeSql(sql, params);
    const statement = db.query(normalizedSql);
    const isReader =
      /^\s*(select|pragma|with)\b/i.test(normalizedSql) ||
      /\breturning\b/i.test(normalizedSql);

    if (isReader) {
      const rows = statement.all(...normalizedParams) as Record<string, unknown>[];
      return { rows, rowCount: rows.length };
    }

    const result = statement.run(...normalizedParams);
    return { rows: [], rowCount: result.changes };
  },

  async exec(sql: string) {
    db.exec(normalizeSql(sql, []).sql);
  },

  async end() {
    db.close();
  },
};

export async function transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  await pool.query("begin immediate");
  try {
    const value = await fn(pool);
    await pool.query("commit");
    return value;
  } catch (error) {
    await pool.query("rollback");
    throw error;
  }
}

function normalizeSql(sql: string, params: unknown[]) {
  const normalizedParams: unknown[] = [];
  const normalizedSql = sql
    .replace(/\bfor\s+update\b/gi, "")
    .replace(/\bnow\(\)/gi, nowExpression)
    .replace(/\$(\d+)/g, (_match, index: string) => {
      normalizedParams.push(normalizeParam(params[Number(index) - 1]));
      return "?";
    });

  return { sql: normalizedSql, params: normalizedParams };
}

function normalizeParam(value: unknown) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}
