// Connection/schema module for tasks 002-006: import `db` for the live
// singleton (path resolved from DB_PATH/DATA_DIR, see connection.ts), or call
// `createConnection` directly to open an isolated DB (tests, scripts) — e.g.
// `createConnection(":memory:")` for a throwaway in-memory DB.
export { createConnection, resolveDbPath } from "./connection.ts";
export { migrate } from "./schema.ts";
export type { CleanerRow, PickRow, PropertyRow, Rank, ReviewRow, Role, UserRow } from "./types.ts";

import { createConnection, resolveDbPath } from "./connection.ts";

/** The live connection, opened (and migrated) once, at import time. */
export const db = createConnection(resolveDbPath());
