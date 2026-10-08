// Pure CSV parsers for the assistant's file-upload propose tools (task 004).
// Mirror public/reviews.html's parseCsv convention: comma-split, trim,
// case-insensitive header-row skip, skip malformed lines silently rather
// than throwing. None of these touch the DB.

/** Splits text into trimmed, non-empty lines (same as reviews.html's parseCsv). */
function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export interface ParseReviewsCsvResult {
  items: { cleaner_id: number; stars: number }[];
  unknownUsernames: string[];
}

/**
 * Parses a `username,stars` CSV against the known cleaner list (case-
 * insensitive username lookup), skipping a "username" header row. Stars
 * must be an integer 1-5; malformed lines are skipped silently. Unknown
 * usernames are collected (in first-seen order, deduplicated) rather than
 * causing a failure.
 */
export function parseReviewsCsv(
  text: string,
  cleaners: { cleaner_id: number; username: string }[],
): ParseReviewsCsvResult {
  const byUsername = new Map(cleaners.map((c) => [c.username.toLowerCase(), c.cleaner_id]));
  const items: { cleaner_id: number; stars: number }[] = [];
  const unknown = new Set<string>();

  for (const line of splitLines(text)) {
    const [rawUsername, rawStars] = line.split(",").map((v) => v.trim());
    if (!rawUsername || !rawStars) continue;
    if (rawUsername.toLowerCase() === "username") continue; // header row

    const cleanerId = byUsername.get(rawUsername.toLowerCase());
    if (!cleanerId) {
      unknown.add(rawUsername);
      continue;
    }

    const stars = Number(rawStars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) continue;

    items.push({ cleaner_id: cleanerId, stars });
  }

  return { items, unknownUsernames: [...unknown] };
}

export interface ParseCleanersCsvResult {
  rows: { username: string; password: string }[];
  invalidLines: string[];
}

/**
 * Parses a `username,password` CSV, skipping a "username" header row.
 * Empty or malformed lines are collected in `invalidLines` rather than
 * thrown on.
 */
export function parseCleanersCsv(text: string): ParseCleanersCsvResult {
  const rows: { username: string; password: string }[] = [];
  const invalidLines: string[] = [];

  for (const line of splitLines(text)) {
    const [rawUsername, rawPassword] = line.split(",").map((v) => v.trim());
    if (rawUsername && rawUsername.toLowerCase() === "username") continue; // header row
    if (!rawUsername || !rawPassword) {
      invalidLines.push(line);
      continue;
    }
    rows.push({ username: rawUsername, password: rawPassword });
  }

  return { rows, invalidLines };
}

export interface ParsePropertiesCsvResult {
  rows: { name: string; address: string }[];
  invalidLines: string[];
}

/**
 * Parses a `name,address` CSV, skipping a "name" header row. Empty or
 * malformed lines are collected in `invalidLines` rather than thrown on.
 */
export function parsePropertiesCsv(text: string): ParsePropertiesCsvResult {
  const rows: { name: string; address: string }[] = [];
  const invalidLines: string[] = [];

  for (const line of splitLines(text)) {
    const [rawName, rawAddress] = line.split(",").map((v) => v.trim());
    if (rawName && rawName.toLowerCase() === "name") continue; // header row
    if (!rawName || !rawAddress) {
      invalidLines.push(line);
      continue;
    }
    rows.push({ name: rawName, address: rawAddress });
  }

  return { rows, invalidLines };
}
