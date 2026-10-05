// Row shapes for every table. Shared source of truth for tasks 002-005 —
// import these instead of re-declaring the same fields elsewhere.

export type Role = "admin" | "cleaner";

export type Rank = "legend" | "awesome" | "normal";

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
}

export interface CleanerRow {
  user_id: number;
  rank: Rank;
}

export interface ReviewRow {
  id: number;
  cleaner_id: number;
  stars: number;
  /** "YYYY-MM" */
  period: string;
  created_at: string;
}

export interface PropertyRow {
  id: number;
  name: string;
  address: string;
}

export interface PickRow {
  id: number;
  cleaner_id: number;
  property_id: number;
  /** 1-5, unique per cleaner_id */
  slot: number;
}
