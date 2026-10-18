// Fixed value sets shared by the database, API validation, and the web app.
// Each list is defined once here so the three can never drift apart.

export const EFFORTS = ["easy", "moderate", "hard"] as const;
export type Effort = (typeof EFFORTS)[number];

export const SETTINGS = ["indoor", "outdoor"] as const;
export type Setting = (typeof SETTINGS)[number];

export const COMPANIONS = ["solo", "with_others", "group"] as const;
export type Companions = (typeof COMPANIONS)[number];

export const UNITS = ["imperial", "metric"] as const;
export type Units = (typeof UNITS)[number];

/** Feelings are scored from 1 (low) to 5 (high). */
export const SCORE_MIN = 1;
export const SCORE_MAX = 5;
