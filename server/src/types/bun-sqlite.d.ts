declare module "bun:sqlite" {
  export class Database {
    constructor(path: string, options?: { create?: boolean });
    exec(sql: string): void;
    query(sql: string): Statement;
    close(): void;
  }

  export class Statement {
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  }
}
