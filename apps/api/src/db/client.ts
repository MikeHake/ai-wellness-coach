import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema.js";

/** Any Drizzle Postgres database on our schema: postgres.js in production, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(url: string) {
  // A small pool is plenty for a single long-lived API instance.
  const client = postgres(url, { max: 5 });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}
