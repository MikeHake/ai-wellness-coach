import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/** Any Drizzle Postgres database on our schema: postgres.js in production, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(
  url: string,
  options: postgres.Options<Record<string, never>> = {},
) {
  // A small pool is plenty for a single API instance.
  const client = postgres(url, { max: 5, ...options });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}
